import { DEFAULT_ACTOR_CONFIG, DEFAULT_ROTATION, SessionActor } from './application/session-actor.ts';
import type { EmbeddingPort, IdeaGenerationPort, SessionStorePort, SpeechTranscriptionPort } from './application/ports.ts';
import { GeminiEmbedding } from './infrastructure/gemini/embedding-gateway.ts';
import { LocalEmbedding } from './infrastructure/local-taste.ts';
import type { AiMode } from '@idea-audition/protocol';
import { FixtureGateway } from './infrastructure/fixture/fixture-gateway.ts';
import { GeminiGateway } from './infrastructure/gemini/gemini-gateway.ts';
import { createVertexClient, geminiConfigFromEnv } from './infrastructure/gemini/client.ts';
import { ResilientGateway } from './infrastructure/resilient-gateway.ts';
import { nodeScheduler, randomIds, systemClock } from './infrastructure/runtime.ts';
import { FirestoreSessionStore } from './infrastructure/persistence/firestore-store.ts';
import { NoopSessionStore } from './infrastructure/persistence/memory-store.ts';
import { startServer, type CreateRoom } from './presentation/ws-server.ts';
import { CreationLimiter, RoomDirectory } from './application/room-directory.ts';
import { createVoiceServer } from './presentation/voice-server.ts';
import { GeminiLiveTranscriber } from './infrastructure/gemini/live-transcriber.ts';
import { createIceServerProvider } from './infrastructure/turn.ts';

const log = (m: string, extra?: unknown) =>
  console.log(`[${new Date().toISOString()}] ${m}`, ...(extra === undefined ? [] : [extra]));

const env = (key: string, fallback: string) => process.env[key] ?? fallback;
const num = (key: string, fallback: number) => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && process.env[key] !== '' && process.env[key] !== undefined ? v : fallback;
};

/**
 * 使える AI のモード。固定データ（無料）は常に選べ、AI_GATEWAY=gemini なら Gemini も選べる。
 * どちらを使うかはセッションごとに開始画面・ヘッダーで切り替える（クレジットの節約・精度の比較用）。
 */
function createGateways(): Partial<Record<AiMode, IdeaGenerationPort>> {
  const fixture = new FixtureGateway(Number(env('FIXTURE_LATENCY_MS', '900')));
  const kind = env('AI_GATEWAY', 'fixture');
  if (kind !== 'gemini') {
    if (kind !== 'fixture') log(`AI_GATEWAY=${kind} は不明です。fixture だけを使います。`);
    log('AI modes: fixture');
    return { fixture };
  }
  const config = geminiConfigFromEnv(process.env);
  log(
    `AI modes: gemini (fast=${config.fast.model}/${config.fast.thinkingLevel}, refine=${config.refine.model}/${config.refine.thinkingLevel}, image=${config.image?.model ?? 'off'}), fixture`,
  );
  // Gemini が失敗したら固定データで応答し、デモを止めない
  const gemini = new ResilientGateway(new GeminiGateway(createVertexClient(process.env), config, log), fixture, log);
  return { gemini, fixture };
}

/** 埋め込み（ADR-0009）。Gemini のモードでは gemini-embedding、固定データではローカルの埋め込み */
function createEmbedders(): Partial<Record<AiMode, EmbeddingPort>> {
  const local = new LocalEmbedding();
  if (env('AI_GATEWAY', 'fixture') !== 'gemini') return { fixture: local };
  const model = env('GEMINI_EMBEDDING_MODEL', 'gemini-embedding-001');
  log(`embedding: ${model} (256 dims)`);
  return { gemini: new GeminiEmbedding(createVertexClient(process.env), model, 256, log), fixture: local };
}

function createStore(): SessionStorePort {
  const kind = env('PERSISTENCE', 'none');
  if (kind === 'firestore') {
    log(`persistence: firestore (database ${process.env.FIRESTORE_DATABASE ?? '(default)'})`);
    return FirestoreSessionStore.fromEnv(process.env);
  }
  if (kind !== 'none') log(`PERSISTENCE=${kind} は不明です。保存しません。`);
  return new NoopSessionStore();
}

/** 音声入力は Gemini 利用時のみ。使えないときはクライアントがテキスト入力に切り替える */
function createTranscriber(): SpeechTranscriptionPort | null {
  if (env('AI_GATEWAY', 'fixture') !== 'gemini' || env('VOICE', 'on') === 'off') return null;
  const model = env('GEMINI_LIVE_MODEL', 'gemini-3.5-transcribe-live');
  const location = env('GEMINI_LIVE_LOCATION', 'global');
  log(`voice: ${model} @ ${location}`);
  const languages = env('GEMINI_LIVE_LANGUAGES', 'ja-JP').split(',').map((x) => x.trim()).filter(Boolean);
  return new GeminiLiveTranscriber(createVertexClient(process.env, location), model, log, 1200, languages);
}

const aiModes = createGateways();
const ai = aiModes.gemini ?? aiModes.fixture!;
const embedders = createEmbedders();
const transcriber = createTranscriber();
const store = createStore();
const config = {
  ...DEFAULT_ACTOR_CONFIG,
  // 声の発言を AI で仕分け・言い直しする（UTTERANCE_TRIAGE=off で無効。雑談・アプリの話・聞き間違いを捨てる、issue #3）
  triage: env('UTTERANCE_TRIAGE', 'on') !== 'off',
  // 下段の入れ替え（ROTATION=off で無効）。数値はすべてミリ秒
  rotation:
    env('ROTATION', 'on') === 'off'
      ? null
      : {
          checkMs: num('ROTATION_CHECK_MS', DEFAULT_ROTATION.checkMs),
          warningMs: num('ROTATION_WARNING_MS', DEFAULT_ROTATION.warningMs),
          minGapMs: num('ROTATION_MIN_GAP_MS', DEFAULT_ROTATION.minGapMs),
          maxConcurrentLeaving: num('ROTATION_MAX_CONCURRENT', DEFAULT_ROTATION.maxConcurrentLeaving),
          policy: {
            minStageMs: num('ROTATION_MIN_STAGE_MS', DEFAULT_ROTATION.policy.minStageMs),
            baseIdleMs: num('ROTATION_IDLE_MS', DEFAULT_ROTATION.policy.baseIdleMs),
            idlePerScoreMs: num('ROTATION_IDLE_PER_SCORE_MS', DEFAULT_ROTATION.policy.idlePerScoreMs),
            maxIdleMs: num('ROTATION_MAX_IDLE_MS', DEFAULT_ROTATION.policy.maxIdleMs),
            halfLifeMs: num('ROTATION_HALF_LIFE_MS', DEFAULT_ROTATION.policy.halfLifeMs),
          },
        },
};
const ids = randomIds();

/**
 * オーディションの部屋。ホストが作るとリンク（/a/<部屋 ID>）ができ、そのリンクを開いた人が入れる（Google Meet と同じ）。
 * 部屋はメモリ上のアクターが持ち（ADR-0003、Cloud Run max-instances=1 前提）、保存先にあれば再起動後も戻せる。
 */
const deps = { ai, aiModes, embedders, store, scheduler: nodeScheduler, clock: systemClock, ids, config, log };
const rooms = new RoomDirectory({
  open: (roomId, mode) => (mode === 'create' ? SessionActor.create(roomId, deps) : SessionActor.openExisting(roomId, deps)),
  idleReleaseMs: 30 * 60_000,
  maxLiveRooms: Number(env('MAX_LIVE_ROOMS', '20')),
  log,
});
// 公開の URL から誰でも部屋を作れるので、作る回数に上限をかけて Gemini のクレジットを守る
const limiter = new CreationLimiter(Number(env('ROOMS_PER_HOUR', '10')));
const createRoom: CreateRoom = async (clientKey) => {
  if (!limiter.allow(clientKey)) return { ok: false, status: 429, reason: 'TOO_MANY_REQUESTS' };
  const r = await rooms.create();
  return r.ok ? r : { ok: false, status: 503, reason: r.reason };
};

// 終了時（Cloud Run の入れ替え・デプロイ）に未保存のイベントを書き出す
process.on('SIGTERM', async () => {
  log('SIGTERM: saving sessions');
  await rooms.persistAll();
  process.exit(0);
});

// Cloud Run は PORT を渡す。開発時は CAMP_PORTで固定する（PORT が別用途で設定されていても衝突しない）
// 通話の中継（TURN）。Cloudflare のキーがあれば使い、無ければ Google の STUN だけ
const ice = createIceServerProvider({ keyId: process.env.TURN_KEY_ID, apiToken: process.env.TURN_KEY_API_TOKEN, log });
log(`call relay: ${ice.turn ? 'cloudflare turn' : 'stun only'}`);

startServer({
  port: Number(process.env.CAMP_PORT ?? env('PORT', '8787')),
  registry: rooms,
  voice: createVoiceServer({ registry: rooms, transcriber, log }),
  createRoom,
  ice,
  staticDir: process.env.STATIC_DIR ?? null,
  log,
});
