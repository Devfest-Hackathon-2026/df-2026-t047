import {
  CHARACTER_DESIGNS,
  CAMP_VERSION,
  LOWER_SLOT_COUNT,
  CHALLENGE_MS,
  ResultCache,
  type ProposalContent,
  type AiMode,
  type CommandMessage,
  type CommandResultMessage,
  type EphemeralMessage,
  type EventMessage,
  type HelloMessage,
  type RejectReason,
  type ServerMessage,
  type SignalMessage,
} from '@idea-audition/protocol';
import { AuditionSession } from '../domain/session.ts';
import { DEFAULT_ROTATION_POLICY, detectMention, type RotationPolicy } from '../domain/attention.ts';
import { findProposalLetter } from '../domain/proposal-letter.ts';
import type { Clock, DomainEvent, DomainResult, IdProvider, SessionState } from '../domain/types.ts';
type GeneratedDraft = Awaited<ReturnType<IdeaGenerationPort['generateIdeas']>>[number];
import type { EmbeddingPort, IdeaGenerationPort, ProposalImageInput, ProposalInput, RefineOutput, Scheduler, SessionStorePort, StoredEvent, UtteranceTriage } from './ports.ts';
import { chooseFromStock, filterContextForGeneration, newPlannerState, planSlots, tasteHint, type ContextFilterStrategy, type PlannerState } from './generation-planner.ts';
import { HesitationGate, detectCue } from './hesitation.ts';
import { SIGNAL_WEIGHTS, dwellWeight, type SignalKind } from '../domain/signals.ts';
import { HESITATION_REVISION_REASON } from '../domain/metrics.ts';
import { localEmbedding } from '../infrastructure/local-taste.ts';
import { speechStageKey, speechVocabulary } from './speech-vocabulary.ts';
import { speechLexicon } from './speech-lexicon.ts';
import { repairTranscript, type Correction } from '../domain/transcript-repair.ts';
import { toSnapshot } from './projection.ts';
import { buildConsensusContext, buildConsensusUpdateInput, toLedgerOps } from './consensus-context.ts';

export interface Connection {
  readonly id: string;
  send(message: ServerMessage): void;
}

export interface ActorConfig {
  /** 発表待ちストックの目標件数（ADR-0005 §3） */
  stockTarget: number;
  /** 下段の自動入れ替え。null で無効（テスト用） */
  rotation: RotationConfig | null;
  /** 相互批評の吹き出しを順に出す間隔（読める速さ、AC-27） */
  critiqueIntervalMs: number;
  /** 確定イベントをまとめて保存するまでの待ち時間 */
  persistDelayMs: number;
  /** 合意台帳を更新するまでの待ち時間（発言のあと／行動のあと）。null で無効（テスト用） */
  consensus: { afterUtteranceMs: number; afterDecisionMs: number; flushAfterUtterances: number } | null;
  /** 下段の枠の数。省略すると1人ずつ（#5）。古いテストは5 */
  lowerSlotCount?: number;
  /** 合格者が出たあとの文脈フィルタ戦略（B2）。未指定時は 'reset_with_summary' */
  contextFilterStrategy?: ContextFilterStrategy;
  /**
   * 声の発言を AI で仕分け・言い直しする（issue #3）。審査の話題だけ残し、雑談・アプリの話・聞き間違いは捨てる。
   * 省略・false なら、声の発言もそのまま扱う（テスト用）
   */
  triage?: boolean;
}

export interface RotationConfig {
  /** 退場候補を確認する間隔 */
  checkMs: number;
  /** 退場予告から実際に退場するまで（この間に触れられたら取り消し） */
  warningMs: number;
  /** 退場予告と退場予告の最短間隔 */
  minGapMs: number;
  /** 同時に退場予告を出せる案の数（予告を長くしても入れ替えの速さを保つため） */
  maxConcurrentLeaving: number;
  policy: RotationPolicy;
}

/** 同じ人の同じ発言をこの時間内に重ねて受けない */
const DUPLICATE_UTTERANCE_MS = 3_000;
/** 深掘りタイム（#5）：キャラの体にカーソルを乗せたらすぐ止める（残り3秒でも止められる） */
const DWELL_PAUSE_MS = 0;
/** 質問・回答・話題にしたあと、議論の時間として止めておく長さ */
const DISCUSS_GRACE_MS = 8_000;
/** 再開したときに最低残す時間。止めたときの残りから再開するが、外した瞬間に交代しないよう少しだけ残す */
const RESUME_MIN_MS = 3_000;

export const DEFAULT_ROTATION: RotationConfig = {
  checkMs: 1_000,
  // 1人ずつの審査（#5）：1人の持ち時間。過ぎたら次の人と交代する
  warningMs: CHALLENGE_MS,
  // 入れ替えは18秒に1案まで、同時に予告するのは1案だけ（プレイテストで6秒に1案は速すぎ、読む前に消えた）
  minGapMs: 18_000,
  maxConcurrentLeaving: 1,
  policy: DEFAULT_ROTATION_POLICY,
};

export const DEFAULT_ACTOR_CONFIG: ActorConfig = {
  stockTarget: 3,
  rotation: DEFAULT_ROTATION,
  critiqueIntervalMs: 2_200,
  persistDelayMs: 300,
  consensus: { afterUtteranceMs: 2_500, afterDecisionMs: 1_200, flushAfterUtterances: 4 },
};

interface Deps {
  /** 既定の AI（aiModes が無いときに使う） */
  ai: IdeaGenerationPort;
  /** モードごとの AI。セッションのモードで使い分ける（例：gemini と fixture） */
  aiModes?: Partial<Record<AiMode, IdeaGenerationPort>>;
  /** モードごとの埋め込み（無ければブラウザ不要のローカル埋め込み） */
  embedders?: Partial<Record<AiMode, EmbeddingPort>>;
  /** 選抜の抽選に使う乱数（テストで固定する） */
  rng?: () => number;
  store: SessionStorePort;
  scheduler: Scheduler;
  clock: Clock;
  ids: IdProvider;
  config: ActorConfig;
  log?: (msg: string, extra?: unknown) => void;
}

/** 受け取った発言（補正まで済んだもの）。仕分けの前後で受け渡す */
interface UtteranceContext {
  judgeId: string;
  /** 聞こえたまま（補正は済み）の文。宛先・意図の判定に使う */
  text: string;
  /** 補正の前の文字起こし */
  rawText: string;
  corrections: Correction[];
  source: 'live' | 'text';
  fallbackTargetId: string | null;
  replyToClaim: string | null;
  meta: { actorJudgeId: string; correlationId: string };
  /** AI が言い直した文。仕分けをしなかった・言い直さなかったときは null */
  summary: string | null;
  /** 名前や記号を言わずに、中身で話した案（仕分けの AI が判断）。無ければ null */
  aiTarget?: string | null;
}

type RefineTrigger =
  | { kind: 'promotion'; instanceId: string }
  | { kind: 'instruction'; instanceId: string; text: string };

const QUESTION_PATTERN = /[?？]\s*$|どう|なぜ|なに|何|どれ|いくら|ですか|ますか|できる/;
/** 改良の頼み（「足して」「下げて」「〜にして」など）。質問と一緒に言われても改良する */
const REQUEST_PATTERN = /(足して|加えて|入れて|変えて|下げて|上げて|増やして|減らして|絞って|広げて|にして|して(?:ほしい|欲しい|みて|ください|下さい)?[。、！!]|してほしい|して欲しい|したい|ほしい|欲しい|お願い)/;
/** 見送りの言い方。名前を呼んだ下段の案にだけ使う（「少ないな」などで誤作動しないよう、はっきりした語に限る） */
const REJECT_PATTERN =
  /却下|ボツ|[はも]パス|パスで|パス[。！!]*\s*$|いらない|要らない|交代|退場|見送|次の人|[はも](ナシ|なし)|ないわ|ないな[ぁあ。！!]*\s*$/;
const RESULT_CACHE_LIMIT = 500;
/** ストック（選抜の候補）の上限。古いものから捨てる */
const STOCK_LIMIT = 12;
/** 決勝の案が落ち着いてから企画書を作り始めるまでの待ち時間 */
const PROPOSAL_DRAFT_DELAY_MS = 3_000;
/** 企画書の作り置きを見直すきっかけ */
const DRAFT_TRIGGERS = new Set<string>(['PRELIMINARY_ENDED', 'PROMOTION_CONFIRMED', 'FINALIST_VERSION_PUBLISHED', 'CHAMPION_VOTE_STARTED']);
/** 案の生成を1回で頼む件数の上限（多いと返事が遅く、時間切れになる） */
const GENERATION_CHUNK = 3;
/** ロビーでテーマの入力が止まってから、最初の案を作り始めるまでの待ち時間 */
const PREFETCH_DEBOUNCE_MS = 800;
/** ロビーで作り置きする案の数（最初の挑戦者＋次の1人） */
const PREFETCH_COUNT = 2;
/** 好みの更新をまとめて知らせるまでの待ち時間 */
const TASTE_EMIT_DELAY_MS = 1_200;
/** Signal は1人あたり毎秒この件数まで（§3.7） */
const SIGNAL_RATE_PER_SEC = 2;
const PERSIST_RETRY_MS = 5_000;

/**
 * セッションごとのアクター（ADR-0003）。
 * コマンドは Node.js のイベントループ上で1件ずつ同期的に処理される。
 * AI 呼び出しの完了も同じ経路で状態に反映されるため、ロックは不要。
 */
export class SessionActor {
  readonly session: AuditionSession;
  private seq = 0;
  private connections = new Map<string, { conn: Connection; judgeId: string | null; callId?: string }>();
  private results = new ResultCache<CommandResultMessage>(RESULT_CACHE_LIMIT);
  private held = new Map<string, string>(); // judgeId → instanceId（ドラッグ中）
  private focus = new Map<string, { hover: string | null; detail: string | null }>(); // judgeId → 注目中のキャラ
  private lastWarningAt = 0;
  private generating = false;
  private refineQueue: RefineTrigger[] = [];
  /** 決勝の案ごとに作っておいた企画書（どの版で作ったか） */
  private proposalDrafts = new Map<string, { revisionId: string; promise: Promise<ProposalContent> }>();
  private draftTimer: (() => void) | null = null;
  /**
   * 決勝の案のイメージ画像（案ごとに1枚だけ作り、決勝のフリップと企画書で使い回す）。
   * 画像は大きい（約270KB）ので状態には入れず、状態には /api/images/... の URL だけを入れる
   */
  private ideaImages = new Map<string, { promise: Promise<IdeaImage | null>; image: IdeaImage | null }>();
  private refining = false;
  private stopRotation: (() => void) | null = null;
  private pendingTimers = new Set<() => void>();
  /** ロビーで、入力中のテーマで作り置きしている最初の案（開始したら舞台に出す） */
  private prefetch: { theme: string; aiMode: AuditionSession['aiMode']; drafts: GeneratedDraft[] | null; done: Promise<void> } | null = null;
  private prefetchTimer: (() => void) | null = null;
  /** start / reset のたびに増やし、古い非同期結果を捨てる */
  private epoch = 0;
  /** 最後に合意が大きく動いたときの台帳の版。これより前の版で頼んだ案は、届いても作り置きに入れない */
  private staleBefore = 0;
  private unsaved: StoredEvent[] = [];
  // 合意台帳の更新（ADR-0007）
  private consensusRunning = false;
  private consensusTimer: (() => void) | null = null;
  private consensusDecisionsSince = 0;
  private replyTo = new Map<number, string>(); // 発言 seq → 返答先の論点ラベル
  private saving = false;
  private saveScheduled = false;
  private signalTimes = new Map<string, number[]>(); // judgeId → 直近1秒の Signal の時刻
  // 好みエンジン（ADR-0009）
  private planner: PlannerState = newPlannerState();
  private embeddings = new Map<string, number[]>(); // 企画名 → 埋め込み（メモリのみ）
  private hoverSince = new Map<string, { instanceId: string; at: number }>(); // judgeId → ホバー開始
  /** 深掘りタイム：この時刻までは議論中として交代を止める */
  private engagedUntil = new Map<string, number>();
  /** 同じ発言の二重送信を防ぐ（judgeId → 直前の発言） */
  private lastUtterance = new Map<string, { text: string; at: number }>();
  /** 仕分け待ちの声の発言を、審査員ごとに言った順で処理するための列（AI の返りが前後しても順番を守る） */
  private utteranceChain = new Map<string, Promise<void>>();
  private hesitation = new HesitationGate();
  private tasteTimer: (() => void) | null = null;

  constructor(
    sessionId: string,
    private readonly deps: Deps,
    restored?: { seq: number; state: SessionState },
  ) {
    const domainDeps = { ids: deps.ids, clock: deps.clock, lowerSlotCount: deps.config.lowerSlotCount };
    if (restored) {
      this.session = AuditionSession.fromState(sessionId, restored.state, domainDeps);
      this.seq = restored.seq;
    } else {
      this.session = new AuditionSession(sessionId, domainDeps);
    }
    // このサーバーで選べるモード。既定は「AI があればそれ（gemini）、無ければ固定データ」
    const available = (deps.aiModes ? (Object.keys(deps.aiModes) as AiMode[]) : [deps.ai.name === 'fixture' ? 'fixture' : 'gemini']) as AiMode[];
    const order: AiMode[] = ['gemini', 'fixture'];
    this.session.aiAvailable = order.filter((m) => available.includes(m));
    if (!this.session.aiAvailable.includes(this.session.aiMode) || !restored) {
      this.session.aiMode = this.session.aiAvailable[0] ?? 'fixture';
    }
    // 空いた枠に何を出すかは、そのときの好みで選ぶ
    this.session.slotChooser = (stock) =>
      chooseFromStock(this.session, this.planner, stock, (t) => this.embeddings.get(t) ?? null, this.deps.clock.now(), this.deps.rng ?? Math.random);
  }

  /** 音声認識に渡す語彙（キャラ名・テーマ・企画名など） */
  speechVocabulary(): string[] {
    return speechVocabulary(this.session);
  }

  /** 語彙が古くなったかの目印。舞台の企画やテーマが変わると値が変わる */
  speechStageKey(): string {
    return speechStageKey(this.session);
  }

  private get embedder(): EmbeddingPort | null {
    return this.deps.embedders?.[this.session.aiMode] ?? null;
  }

  /** いまのセッションのモードで使う AI */
  private get ai(): IdeaGenerationPort {
    return this.deps.aiModes?.[this.session.aiMode] ?? this.deps.ai;
  }

  /**
   * 保存済みの状態があれば復元してアクターを作る（サーバー再起動後の再開、ADR-0003）。
   * 読み込みに失敗しても、新しいセッションとして動かす。
   */
  static async open(sessionId: string, deps: Deps): Promise<SessionActor> {
    let restored: { seq: number; state: SessionState } | null = null;
    try {
      restored = await deps.store.load(sessionId);
    } catch (e) {
      deps.log?.(`session load failed (${deps.store.name}): ${sessionId}`, e);
    }
    return SessionActor.fromRestored(sessionId, deps, restored);
  }

  private static fromRestored(sessionId: string, deps: Deps, restored: { seq: number; state: SessionState } | null) {
    const actor = new SessionActor(sessionId, deps, restored ?? undefined);
    if (restored) {
      deps.log?.(`session restored: ${sessionId} seq=${restored.seq} status=${restored.state.status}`);
      if (actor.session.status === 'audition_active') actor.onStarted();
      // 再起動で企画書の作成が途切れていたら作り直す
      if (actor.session.proposal?.status === 'generating') actor.runProposal();
    }
    return actor;
  }

  /** 新しい部屋を作り、すぐ保存する（再起動後もリンクで入れるように） */
  static async create(sessionId: string, deps: Deps): Promise<SessionActor> {
    const actor = new SessionActor(sessionId, deps);
    try {
      await deps.store.commit(sessionId, actor.seq, actor.session.toState(), []);
    } catch (e) {
      deps.log?.(`session create save failed (${deps.store.name}): ${sessionId}`, e);
    }
    return actor;
  }

  /** 保存先にある部屋だけ開く（なければ null） */
  static async openExisting(sessionId: string, deps: Deps): Promise<SessionActor | null> {
    let restored: { seq: number; state: SessionState } | null;
    try {
      restored = await deps.store.load(sessionId);
    } catch (e) {
      deps.log?.(`session load failed (${deps.store.name}): ${sessionId}`, e);
      return null;
    }
    return restored ? SessionActor.fromRestored(sessionId, deps, restored) : null;
  }

  get connectionCount() {
    return this.connections.size;
  }

  /* --------------------------- 接続・切断 --------------------------- */

  attach(conn: Connection, hello: HelloMessage) {
    const joined = this.session.join(hello.participantId, hello.resumeToken);
    this.session.refreshLedgerStatuses();
    const judgeId = joined.ok ? joined.value.judgeId : null;
    const wasEmpty = this.connections.size === 0;
    this.connections.set(conn.id, { conn, judgeId });
    if (wasEmpty) this.resumeAfterEmpty();
    // 合言葉は本人の接続にだけ送る（snapshot には入れない）
    const resumeToken = joined.ok ? joined.value.resumeToken : null;
    conn.send({ camp: CAMP_VERSION, kind: 'welcome', participantId: judgeId, resumeToken, snapshot: toSnapshot(this.session, this.seq, this.deps.clock.now()) });
    if (joined.ok) this.emit(joined.events, { actorJudgeId: judgeId });
  }

  detach(conn: Connection) {
    const entry = this.connections.get(conn.id);
    this.connections.delete(conn.id);
    if (this.connections.size === 0) this.pauseWhileEmpty();
    if (entry?.callId) this.relayFrom(entry.callId, conn, { camp: CAMP_VERSION, kind: 'ephemeral', type: 'CALL_STATE', payload: { on: false } });
    if (!entry?.judgeId) return;
    const stillConnected = [...this.connections.values()].some((c) => c.judgeId === entry.judgeId);
    if (stillConnected) return;
    this.held.delete(entry.judgeId);
    this.focus.delete(entry.judgeId);
    this.relay(conn, { camp: CAMP_VERSION, kind: 'ephemeral', type: 'CURSOR_MOVED', payload: null });
    const left = this.session.leave(entry.judgeId);
    if (left.ok) this.emit(left.events, { actorJudgeId: entry.judgeId });
    // 抜けた人以外が全員ブザーを押していたら、その場で合格にする
    const challenger = this.session.lowerSlots[0];
    if (challenger && this.session.buzzerUnanimous()) {
      void this.promoteCharacter(challenger, [...this.session.buzzers], { actorJudgeId: null });
    }
  }

  dispose() {
    void this.persist();
    this.stopRotation?.();
    for (const cancel of this.pendingTimers) cancel();
    this.pendingTimers.clear();
  }

  /* ---------------------------- Ephemeral ---------------------------- */

  receiveEphemeral(conn: Connection, msg: EphemeralMessage) {
    const entry = this.connections.get(conn.id);
    if (!entry) return;
    if (!entry.judgeId) {
      // 観覧者は通話を聞くだけ。通話の受け渡しだけを、通話用の ID で中継する
      if (msg.type === 'CALL_STATE' && msg.payload.as && !entry.callId) entry.callId = msg.payload.as;
      if ((msg.type === 'CALL_STATE' || msg.type === 'RTC_SIGNAL') && entry.callId) this.relay(conn, msg);
      return;
    }
    if (msg.type === 'DRAG_PREVIEW') {
      if (msg.payload.instanceId) {
        this.held.set(entry.judgeId, msg.payload.instanceId);
        this.emit(this.session.touch(msg.payload.instanceId, 'hold'), { actorJudgeId: entry.judgeId });
      } else this.held.delete(entry.judgeId);
    }
    if (msg.type === 'THEME_DRAFT') this.schedulePrefetch(entry.judgeId, msg.payload.theme, msg.payload.aiMode);
    if (msg.type === 'FOCUS_CHANGED') {
      const prev = this.focus.get(entry.judgeId);
      const { hover, detail } = msg.payload;
      this.focus.set(entry.judgeId, { hover, detail });
      // いまの挑戦者に乗せた・開いたら、次の見回りを待たずにその場でカウントを止める
      const challenger = this.session.lowerSlots[0];
      if (challenger && (hover === challenger || detail === challenger)) {
        this.emit(this.session.pauseChallenge(challenger), { actorJudgeId: entry.judgeId });
      }
      this.trackDwell(entry.judgeId, hover);
      if (detail && detail !== prev?.detail) this.tasteSignal(entry.judgeId, detail, 'detail');
      const events = [];
      if (hover && hover !== prev?.hover) events.push(...this.session.touch(hover, 'hover'));
      if (detail && detail !== prev?.detail) events.push(...this.session.touch(detail, 'detail'));
      this.emit(events, { actorJudgeId: entry.judgeId });
      return; // 注目の情報は他の人に中継しない（カーソルで十分伝わる）
    }
    this.relay(conn, msg);
  }

  private relay(from: Connection, msg: EphemeralMessage) {
    const entry = this.connections.get(from.id);
    const senderId = entry?.judgeId ?? entry?.callId;
    if (senderId) this.relayFrom(senderId, from, msg);
  }

  /** senderId の名前で、送り主以外に中継する（抜けた観覧者の分は、登録を消したあとに呼ぶ） */
  private relayFrom(senderId: string, from: Connection, msg: EphemeralMessage) {
    const out: EphemeralMessage = { ...msg, senderId };
    for (const { conn } of this.connections.values()) if (conn.id !== from.id) conn.send(out);
  }

  /* ------------------------------ Signal ------------------------------ */

  /** 返事をしない。間引いた残りだけを好みエンジンに渡す（§3.7） */
  receiveSignal(conn: Connection, msg: SignalMessage) {
    const judgeId = this.connections.get(conn.id)?.judgeId;
    if (!judgeId) return;
    const now = this.deps.clock.now();
    const recent = (this.signalTimes.get(judgeId) ?? []).filter((t) => now - t < 1000);
    if (recent.length >= SIGNAL_RATE_PER_SEC) return;
    recent.push(now);
    this.signalTimes.set(judgeId, recent);
    this.onSoftSignal(judgeId, msg.payload);
  }

  private onSoftSignal(judgeId: string, signal: SignalMessage['payload']) {
    const target = this.validTarget(signal.targetInstanceId) ?? this.focusedTarget(judgeId);
    if (!target) return;
    if (signal.kind === 'hesitation') this.reactToHesitation(judgeId, target, signal.cue ?? 'うーん');
    else if (signal.kind === 'positive') this.tasteSignal(judgeId, target, 'positive');
    else if (signal.kind === 'laugh') this.tasteSignal(judgeId, target, 'laugh');
    // silence は今は好みに使わない（迷いと区別できないため。声の特徴として記録だけする余地を残す）
  }

  /* --------------------------- 好みエンジン --------------------------- */

  private validTarget(instanceId: string | null | undefined): string | null {
    if (!instanceId) return null;
    const c = this.session.characters.get(instanceId);
    return c && c.location !== 'archived' ? instanceId : null;
  }

  /** その審査員が見ているキャラ（詳細を開いている＞カーソルが乗っている） */
  private focusedTarget(judgeId: string): string | null {
    const f = this.focus.get(judgeId);
    return this.validTarget(f?.detail) ?? this.validTarget(f?.hover);
  }

  /** 行動を好みに足し、少し待ってからまとめて全員に知らせる */
  private tasteSignal(judgeId: string, instanceId: string, kind: SignalKind, weight: number = SIGNAL_WEIGHTS[kind]) {
    if (!this.session.recordTasteSignal(judgeId, instanceId, weight)) return;
    if (this.tasteTimer) return;
    this.tasteTimer = this.later(() => {
      this.tasteTimer = null;
      this.emit([{ type: 'TASTE_UPDATED', detail: { version: this.session.taste.version } }], { actorJudgeId: null });
    }, TASTE_EMIT_DELAY_MS);
  }

  /** ホバーが終わったら、乗せていた時間に応じて好みに足す */
  private trackDwell(judgeId: string, hover: string | null) {
    const prev = this.hoverSince.get(judgeId);
    if (prev?.instanceId === hover) return;
    const now = this.deps.clock.now();
    if (prev) {
      const w = dwellWeight(now - prev.at);
      if (w > 0) this.tasteSignal(judgeId, prev.instanceId, 'dwell', w);
    }
    if (hover) this.hoverSince.set(judgeId, { instanceId: hover, at: now });
    else this.hoverSince.delete(judgeId);
  }

  /**
   * 迷いへの反応（ADR-0009 ③）：キャラが 🤔 で一言 → 好みに弱いマイナス → 下段の案なら別案に差し替える。
   */
  private reactToHesitation(judgeId: string, instanceId: string, concern: string) {
    const s = this.session;
    if (s.status !== 'audition_active') return;
    const line = this.hesitation.tryReact(instanceId, this.deps.clock.now());
    if (!line) return;
    this.tasteSignal(judgeId, instanceId, 'hesitation');
    this.emit([...s.touch(instanceId, 'detail'), ...s.setReaction(instanceId, { kind: 'hesitation', judgeId, text: line })], {
      actorJudgeId: judgeId,
    });
    const c = s.characters.get(instanceId);
    if (c?.location !== 'lower') return;
    const idea = s.ideaOf(instanceId)!;
    const base = idea.revisions.at(-1)!;
    const epoch = this.epoch;
    this.ai
      .varyIdea({
        theme: s.theme,
        characterName: this.characterName(instanceId),
        idea: { title: base.title, summary: base.summary, profile: base.profile ?? null },
        concern,
        context: buildConsensusContext(s),
      })
      .then((draft) => {
        if (epoch !== this.epoch) return;
        const r = s.reviseLower(instanceId, base.revisionId, draft, `${HESITATION_REVISION_REASON}：${draft.changeNote || 'ピンと来なかった点を変えた'}`);
        if (!r.ok) return; // その間に退場・昇格した
        this.emit([...r.events, ...s.touch(instanceId, 'detail')], { actorJudgeId: null });
        this.embedTexts([draft]);
      })
      .catch((e) => this.deps.log?.('varyIdea failed', e));
  }

  /** 案の文章を埋め込んで覚えておく。失敗したらローカルの埋め込みで代用する */
  private embedTexts(drafts: { title: string; summary: string }[]) {
    const fresh = drafts.filter((d) => !this.embeddings.has(d.title));
    if (fresh.length === 0) return;
    const texts = fresh.map((d) => `${d.title}\n${d.summary}`);
    const store = (vs: number[][]) => fresh.forEach((d, i) => vs[i] && this.embeddings.set(d.title, vs[i]));
    const embedder = this.embedder;
    if (!embedder) return store(texts.map((t) => localEmbedding(t)));
    embedder.embed(texts).then(store, (e) => {
      this.deps.log?.('embed failed, using local embedding', e);
      store(texts.map((t) => localEmbedding(t)));
    });
  }

  /* ----------------------------- Command ----------------------------- */

  receiveCommand(conn: Connection, cmd: CommandMessage) {
    const entry = this.connections.get(conn.id);
    const judgeId = entry?.judgeId ?? null;
    const sender = judgeId ?? conn.id;
    const cached = this.results.get(sender, cmd.commandId);
    if (cached) {
      conn.send(cached); // 重複排除：同じ結果を返し、再実行しない（ADR-0004）
      return;
    }
    const result = judgeId ? this.execute(judgeId, cmd) : { ok: false as const, reason: 'SPECTATOR' as const };
    const message: CommandResultMessage = {
      camp: CAMP_VERSION,
      kind: 'result',
      commandId: cmd.commandId,
      ok: result.ok,
      reason: result.ok ? null : result.reason,
    };
    this.results.set(sender, cmd.commandId, message);
    conn.send(message);
  }

  private execute(judgeId: string, cmd: CommandMessage): { ok: true } | { ok: false; reason: RejectReason } {
    const s = this.session;
    const meta = { actorJudgeId: judgeId, correlationId: cmd.commandId };
    const apply = (r: DomainResult<unknown>) => {
      if (r.ok) this.emit(r.events, meta);
      return r.ok ? ({ ok: true } as const) : r;
    };

    switch (cmd.type) {
      case 'SET_JUDGE_NAME':
        return apply(s.setJudgeName(judgeId, cmd.payload.name));
      case 'START_AUDITION': {
        // テーマを決めて始めるのはホストだけ（ロビーでほかの人はホストの入力を見ている）
        if (!s.judges.some((j) => j.judgeId === judgeId && j.isHost)) return { ok: false, reason: 'NOT_HOST' };
        const { finalists, challengeSec } = cmd.payload;
        const r = apply(
          s.start(cmd.payload.theme, cmd.payload.mode, cmd.payload.aiMode, {
            finalists,
            challengeMs: challengeSec ? challengeSec * 1000 : (this.deps.config.rotation?.warningMs ?? CHALLENGE_MS),
          }),
        );
        if (r.ok) this.onStarted();
        return r;
      }
      case 'SET_AI_MODE': {
        const r = s.setAiMode(judgeId, cmd.payload.mode);
        if (!r.ok) return r;
        this.emit(r.events, meta);
        if (r.events.length > 0 && s.status === 'audition_active') {
          // 前のモードで作り置きした案は捨て、新しいモードで作り直す（すぐ補充できるよう1件だけ残す）
          s.stock = s.stock.slice(0, 1);
          this.ensureStock();
        }
        return { ok: true };
      }
      case 'RESET_SESSION': {
        const r = apply(s.reset(judgeId));
        if (r.ok) this.onStopped();
        return r;
      }
      case 'REQUEST_PROMOTION':
        return this.promoteCharacter(cmd.payload.instanceId, [judgeId], meta);
      case 'SET_SPOTLIGHT':
        return apply(s.setSpotlight(judgeId, cmd.payload.instanceId));
      case 'PRESS_BUZZER': {
        const { instanceId, on } = cmd.payload;
        const presser = s.buzzers;
        const r = s.pressBuzzer(judgeId, instanceId, on);
        if (!r.ok) return r;
        const pressers = [...presser];
        this.emit(r.events, meta);
        if (r.value.unanimous) return this.promoteCharacter(instanceId, pressers, meta);
        return { ok: true };
      }
      case 'LEAVE_SESSION': {
        this.held.delete(judgeId);
        this.focus.delete(judgeId);
        const r = apply(s.quit(judgeId));
        // 抜けた人以外が全員ブザーを押していたら、その場で合格にする
        const challenger = s.lowerSlots[0];
        if (challenger && s.buzzerUnanimous()) void this.promoteCharacter(challenger, [...s.buzzers], { actorJudgeId: null });
        return r;
      }
      case 'HOLD_CHALLENGE': {
        const { instanceId, on } = cmd.payload;
        const r = s.holdChallenge(judgeId, instanceId, on);
        if (!r.ok) return r;
        this.emit(r.events, meta);
        // 再開：深掘り中でなければ、止めたときの残りからすぐ数え直す
        if (!on && !this.isEngaged(instanceId, this.deps.clock.now())) this.emit(s.resumeChallenge(instanceId, RESUME_MIN_MS), meta);
        return { ok: true };
      }
      case 'END_PRELIMINARY': {
        const r = apply(s.endPreliminary(judgeId));
        if (r.ok) this.scheduleConsensus('decision');
        return r;
      }
      case 'NEXT_IDEA': {
        // 手動の「次のアイデア」：見られている案は残し、最も注目されていない案を入れ替える
        const target = cmd.payload.instanceId ?? s.pickExitCandidate(this.protectedIds(), true);
        if (!target) return { ok: true };
        const r = apply(s.rotate(target));
        this.ensureStock();
        return r;
      }
      case 'REJECT_CANDIDATE': {
        s.recordDecision('rejected', cmd.payload.instanceId, judgeId);
        this.tasteSignal(judgeId, cmd.payload.instanceId, 'reject');
        const r = apply(s.rejectCandidate(judgeId, cmd.payload.instanceId));
        if (r.ok) this.scheduleConsensus('decision');
        this.ensureStock();
        return r;
      }
      case 'PIN_CLAIM':
      case 'UNPIN_CLAIM': {
        const op = cmd.type === 'PIN_CLAIM' ? 'pin' : 'unpin';
        const result = s.applyLedgerOps([{ op, label: cmd.payload.label, judgeId }], null);
        if (result.applied.length === 0) return { ok: false, reason: 'STALE_VERSION' };
        this.emit(result.events, meta);
        this.onConsensusChanged(result.statusChanges.length > 0);
        return { ok: true };
      }
      case 'ASK_CANDIDATE': {
        // 詳細画面の質問欄でも「うーん、微妙かも」は迷いとして受け止め、別案を出す（質問として答えはしない）
        if (detectCue(cmd.payload.text) === 'hesitation' && s.characters.get(cmd.payload.instanceId)?.location === 'lower') {
          this.reactToHesitation(judgeId, cmd.payload.instanceId, cmd.payload.text);
          return { ok: true };
        }
        return this.ask(judgeId, cmd.payload.instanceId, cmd.payload.text, meta);
      }
      case 'REQUEST_REFINEMENT': {
        if (s.status !== 'audition_active') return { ok: false, reason: 'SESSION_NOT_ACTIVE' };
        if (!s.finalist(cmd.payload.instanceId)) return { ok: false, reason: 'NOT_IN_UPPER' };
        if (cmd.expected && !this.isCurrentRevision(cmd.payload.instanceId, cmd.expected.rev)) {
          return { ok: false, reason: 'STALE_VERSION' };
        }
        this.enqueueRefinement({ kind: 'instruction', instanceId: cmd.payload.instanceId, text: cmd.payload.text });
        return { ok: true };
      }
      case 'SUBMIT_UTTERANCE': {
        const { text, source, targetInstanceId, replyToClaim } = cmd.payload;
        return this.receiveUtterance(judgeId, text, source, targetInstanceId ?? null, cmd.commandId, replyToClaim ?? null);
      }
      case 'REGENERATE_PROPOSAL': {
        const r = apply(s.restartProposal());
        if (r.ok) this.runProposal();
        return r;
      }
      case 'REVERT_IDEA_REVISION':
        return apply(s.revertRevision(cmd.payload.characterId, cmd.payload.targetVersion));
      case 'START_CHAMPION_VOTE':
        return apply(s.startVote(judgeId));
      case 'CAST_VOTE':
        s.recordDecision('voted', cmd.payload.instanceId, judgeId);
        this.tasteSignal(judgeId, cmd.payload.instanceId, 'vote');
        return this.afterFinal(apply(s.castVote(judgeId, cmd.payload.instanceId)));
      case 'CLOSE_VOTE':
        return this.afterFinal(apply(s.closeVote(judgeId)));
      case 'RESOLVE_TIE':
        return this.afterFinal(apply(s.resolveTie(judgeId, cmd.payload.instanceId)));
      case 'SELECT_CHAMPION':
        return this.afterFinal(apply(s.selectChampion(judgeId, cmd.payload.instanceId)));
    }
  }

  /** 画面で見ていた版がいまの版か（§7.2 対象の版での判定） */
  private isCurrentRevision(instanceId: string, rev: string): boolean {
    const idea = this.session.ideaOf(instanceId);
    return !!idea && this.session.currentRevision(idea.ideaId).revisionId === rev;
  }

  /**
   * 審査員の発言（音声の文字起こし、またはテキスト入力）。
   * 宛先は「発言に含まれるキャラ名」→「詳細を開いていたキャラ」の順に決める。
   * 質問なら回答だけ、上段キャラへの指示なら改良を依頼する（AC-14）。
   */
  receiveUtterance(
    judgeId: string,
    text: string,
    source: 'live' | 'text',
    fallbackTargetId: string | null,
    correlationId?: string,
    replyToClaim: string | null = null,
  ): { ok: true } | { ok: false; reason: RejectReason } {
    const s = this.session;
    if (!s.judges.some((j) => j.judgeId === judgeId)) return { ok: false, reason: 'SPECTATOR' };
    // 同じ人の同じ発言が続けて届いたら（送信の二度押し・声とテキストの重なり）1回だけにする
    const now = this.deps.clock.now();
    const key = text.trim();
    const last = this.lastUtterance.get(judgeId);
    if (last && last.text === key && now - last.at < DUPLICATE_UTTERANCE_MS) return { ok: true };
    this.lastUtterance.set(judgeId, { text: key, at: now });
    const meta = { actorJudgeId: judgeId, correlationId: correlationId ?? this.deps.ids.next('utt') };
    // 音声の文字起こしは、会議の語彙（キャラ名・企画名・論点）に寄せて聞き間違いを直す
    const rawText = text;
    let corrections: Correction[] = [];
    if (source === 'live') {
      const f = this.focus.get(judgeId);
      const focused = new Set([f?.hover, f?.detail, fallbackTargetId].filter((x): x is string => !!x));
      const repaired = repairTranscript(text, speechLexicon(s, focused));
      text = repaired.text;
      corrections = repaired.corrections;
      if (corrections.length) this.deps.log?.(`[voice] repaired ${corrections.map((c) => `${c.from}→${c.to}(${c.score})`).join(', ')}`);
    }
    const ctx: UtteranceContext = { judgeId, text, rawText, corrections, source, fallbackTargetId, replyToClaim, meta, summary: null };
    // 声の発言は、審査の話題かを AI に仕分けてもらってから扱う（雑談・アプリの話・聞き間違いは捨てる、issue #3）。
    // キャラの名前を呼んでいる発言は、話しかけだと明らかなので待たずに扱う
    if (this.deps.config.triage && source === 'live' && !this.findAddressee(text)) {
      this.triageThenProcess(ctx);
      return { ok: true };
    }
    return this.processUtterance(ctx);
  }

  /**
   * 声の発言を AI で仕分け、残すものだけ本処理へ渡す。審査員ごとに言った順で処理する。
   * AI が失敗したときは、本物の発言を落とさないよう、そのまま本処理へ渡す。
   */
  private triageThenProcess(ctx: UtteranceContext) {
    const epoch = this.epoch;
    const previous = this.utteranceChain.get(ctx.judgeId) ?? Promise.resolve();
    const next = previous
      .then(async () => {
        const started = this.deps.clock.now();
        const verdict = await this.triage(ctx.text).catch((e): null => {
          this.deps.log?.('triageUtterance failed', e);
          return null;
        });
        if (epoch !== this.epoch) return;
        if (verdict && !verdict.keep) {
          // 審査の話題ではない・聞き取れない発言は、記録せず、好みにも合意台帳にも入れない
          this.deps.log?.(`[triage] dropped (${verdict.reason}) ${this.deps.clock.now() - started}ms`);
          return;
        }
        const aiTarget = verdict?.keep ? (verdict.target ?? null) : null;
        this.deps.log?.(
          `[triage] kept ${this.deps.clock.now() - started}ms${verdict?.summary ? ' (summarized)' : ''}${aiTarget ? ` target=${this.characterName(aiTarget)}` : ''}`,
        );
        this.processUtterance({ ...ctx, summary: verdict?.summary ?? null, aiTarget });
      })
      .catch((e) => this.deps.log?.('utterance failed', e));
    this.utteranceChain.set(ctx.judgeId, next);
  }

  /**
   * 仕分け。舞台の案は番号付きで渡し、発言が特定の案の話なら、その番号も返してもらう（名前を言わずに中身で話したときの宛先）。
   * 決勝の案には記号（A案・B案…）も添える
   */
  private async triage(text: string): Promise<UtteranceTriage & { target?: string | null }> {
    const s = this.session;
    const onStage = [...s.lowerSlots.filter((x): x is string => x !== null), ...s.upper.map((f) => f.instanceId)];
    const spotlight = this.validTarget(s.spotlight?.instanceId);
    if (spotlight && !onStage.includes(spotlight)) onStage.push(spotlight);
    const verdict = await this.ai.triageUtterance({
      theme: s.theme,
      stage: onStage.map((id) => {
        const rev = s.currentRevision(s.characters.get(id)!.ideaId);
        const letter = s.upper.findIndex((f) => f.instanceId === id);
        return { characterName: this.characterName(id), title: rev.title, summary: rev.summary, ...(letter >= 0 ? { letter: 'ABCD'[letter] } : {}) };
      }),
      recentRemarks: buildConsensusContext(s).recentRemarks.slice(-3),
      text,
    });
    if (!verdict.keep) return verdict;
    const n = verdict.targetIndex ?? 0;
    return { ...verdict, target: n >= 1 && n <= onStage.length ? onStage[n - 1]! : null };
  }

  /**
   * 仕分けを通った発言を扱う。宛先・意図の判定は聞こえたままの文（text）で行い、
   * 記録・AI・キャラに渡す文は、言い直した文（summary があればそれ）にする。声の発言は画面には出さない。
   */
  private processUtterance(u: UtteranceContext): { ok: true } | { ok: false; reason: RejectReason } {
    const s = this.session;
    const { judgeId, text, rawText, corrections, source, fallbackTargetId, replyToClaim, meta, summary } = u;
    const shown = summary ?? text;
    // 中身で話した案（AI の判断）は、質問・頼み・反応のときだけ宛先にする（ただの感想で決勝の案の改良が走らないように）
    const aiTarget =
      u.aiTarget && s.characters.has(u.aiTarget) && (QUESTION_PATTERN.test(text) || REQUEST_PATTERN.test(text) || detectCue(text)) ? u.aiTarget : null;
    // 宛先：名前・記号（A案）・企画名で呼んだ案 → 中身で話した案 → 詳細を開いていた案 → （質問なら）いま見ている案 → スポットライトの案／予選の挑戦者
    const named = this.findAddressee(text) ?? aiTarget ?? (fallbackTargetId && s.characters.has(fallbackTargetId) ? fallbackTargetId : null);
    const stageTarget = this.validTarget(s.spotlight?.instanceId) ?? this.validTarget(s.lowerSlots[0]);
    const targetInstanceId = named ?? (QUESTION_PATTERN.test(text) ? (this.focusedTarget(judgeId) ?? stageTarget) : null);
    // 会話で取り上げられた案の注目度を上げる（名前・企画名）。宛先として話しかけた案も含める
    const mentions = s.registerUtterance(text);
    const mentionEvents = [...mentions.events];
    if (targetInstanceId && !mentions.mentioned.includes(targetInstanceId)) {
      mentionEvents.push(...s.touch(targetInstanceId, 'mentionName'));
    }
    for (const id of mentions.mentioned) this.tasteSignal(judgeId, id, 'mention');
    for (const id of [...mentions.mentioned, ...(targetInstanceId ? [targetInstanceId] : [])]) this.markEngaged(id);
    // 「うーん」「いいね」：宛先（名前）か、いま見ているキャラへの反応として扱う
    const cue = detectCue(text);
    const cueTarget = targetInstanceId ?? this.focusedTarget(judgeId);
    if (cue === 'positive' && cueTarget) this.tasteSignal(judgeId, cueTarget, 'positive');
    const isQuestion = QUESTION_PATTERN.test(text);
    const isRequest = REQUEST_PATTERN.test(text);
    // 決勝の案への頼みは改良する。「〜を足して。収益は？」のように質問と一緒でも、頼みがあれば改良し、質問にも答える
    const willRefine =
      !!targetInstanceId && (isRequest || !isQuestion) && !!s.finalist(targetInstanceId) && s.status === 'audition_active';
    const alsoAnswer = willRefine && isQuestion;
    // 「ルナは却下」「MOMOはパス」：名前を呼んだ下段の案を見送る
    const willReject =
      !!targetInstanceId &&
      !isQuestion &&
      REJECT_PATTERN.test(text) &&
      s.characters.get(targetInstanceId)?.location === 'lower' &&
      s.status === 'audition_active';
    // 「うーん」は迷い、「いいね」（質問・頼みを含まない）は好意として、質問とは分けて扱う（字幕の札も分ける）
    const isPositive = cue === 'positive' && !isQuestion && !willRefine && !willReject;
    const intent = !targetInstanceId && !cueTarget
      ? 'comment'
      : willReject
        ? 'reject'
        : willRefine
          ? 'instruction'
          : cue === 'hesitation'
            ? 'hesitation'
            : isPositive
              ? 'positive'
              : targetInstanceId
                ? 'question'
                : 'comment';
    const utteranceSeq = this.seq + 1; // 次に emit する最初のイベントがこの発言
    this.emit(
      [
        {
          type: 'JUDGE_UTTERANCE_RECEIVED',
          detail: {
            judgeId,
            text: shown,
            source,
            targetInstanceId,
            intent,
            mentioned: mentions.mentioned,
            ...(corrections.length || summary ? { rawText, ...(corrections.length ? { corrections } : {}) } : {}),
          },
        },
        ...mentionEvents,
      ],
      meta,
    );
    // 合意台帳の材料として時系列で記録し、少し待ってからまとめて台帳を更新する（ADR-0007）
    s.recordUtterance({
      seq: utteranceSeq,
      judgeId,
      text: shown,
      source,
      targetInstanceId,
      intent,
      at: this.deps.clock.now(),
    });
    if (replyToClaim) this.replyTo.set(utteranceSeq, replyToClaim);
    this.scheduleConsensus('utterance');
    if (cue === 'hesitation' && cueTarget && !willReject) {
      // 迷いはキャラが受け止めて別案を出す（質問として答えはしない）
      this.reactToHesitation(judgeId, cueTarget, text);
      if (!targetInstanceId || cueTarget !== targetInstanceId || !willRefine) return { ok: true };
    }
    if (!targetInstanceId) return { ok: true };
    // 「いいね」はほめ言葉なので、質問として答えない（好みには反映済み）
    if (isPositive) return { ok: true };
    if (willReject) {
      s.recordDecision('rejected', targetInstanceId, judgeId);
      this.tasteSignal(judgeId, targetInstanceId, 'reject');
      const r = s.rejectCandidate(judgeId, targetInstanceId);
      if (r.ok) this.emit(r.events, meta);
      this.ensureStock();
      return r.ok ? { ok: true } : r;
    }
    if (willRefine) {
      this.enqueueRefinement({ kind: 'instruction', instanceId: targetInstanceId, text: shown });
      if (alsoAnswer) return this.ask(judgeId, targetInstanceId, shown, meta);
      return { ok: true };
    }
    const target = s.characters.get(targetInstanceId);
    if (target?.location === 'archived') return { ok: true };
    return this.ask(judgeId, targetInstanceId, shown, meta, source === 'live');
  }

  /** 発言の中にステージ上のキャラ名（英字名か読み）があれば、そのキャラを宛先にする */
  /**
   * 発言で呼びかけた案。
   * 1. 記号（「A案」「案B」「エー案」）：決勝の並び順
   * 2. キャラの名前（読みも）：いちばん先に出てきた名前
   * 3. 企画名・呼び名の一部（「ガチャめし」「ひとり飯」）：1つの案にだけ当たるとき
   */
  private findAddressee(text: string): string | null {
    const s = this.session;
    const onStage = [...s.lowerSlots.filter((x): x is string => x !== null), ...s.upper.map((f) => f.instanceId)];
    const letter = findProposalLetter(text);
    if (letter !== null && s.upper[letter]) return s.upper[letter]!.instanceId;
    let best: { id: string; index: number } | null = null;
    const lower = text.toLowerCase();
    for (const id of onStage) {
      const design = CHARACTER_DESIGNS[s.characters.get(id)!.designId]!;
      for (const word of [design.name.toLowerCase(), ...design.readings]) {
        const index = lower.indexOf(word);
        if (index >= 0 && (!best || index < best.index)) best = { id, index };
      }
    }
    if (best) return best.id;
    const byTitle = onStage.filter((id) => {
      const rev = s.currentRevision(s.characters.get(id)!.ideaId);
      return [rev.title, ...(rev.aliases ?? [])].some((t) => detectMention(text, { name: '', readings: [], title: t }, s.theme) === 'title');
    });
    return byTitle.length === 1 ? byTitle[0]! : null;
  }

  isJudge(judgeId: string) {
    return this.session.judges.some((j) => j.judgeId === judgeId);
  }

  private afterFinal<R extends { ok: boolean }>(r: R): R {
    if (this.session.status === 'completed') {
      this.onStopped();
      // 優勝が決まったら、すぐ企画書を作り始める（優勝画面にダウンロードボタンが出る）
      if (this.session.proposal?.status === 'generating') this.runProposal();
    }
    return r;
  }

  /** 企画書の材料（審査の記録）。instanceId の案を優勝案として組み立てる */
  private proposalInput(instanceId: string): ProposalInput | null {
    const s = this.session;
    const character = s.characters.get(instanceId);
    const idea = character ? s.ideas.get(character.ideaId) : undefined;
    if (!character || !idea) return null;
    const nameOf = (id: string) => this.characterName(id);
    return {
      theme: s.theme,
      context: buildConsensusContext(s),
      champion: {
        characterName: CHARACTER_DESIGNS[character.designId]?.name ?? 'AI',
        revisions: idea.revisions.map((r) => ({
          version: r.version,
          title: r.title,
          summary: r.summary,
          keepStrengths: r.keepStrengths,
          improvementPoints: r.improvementPoints,
          reason: r.reason,
        })),
        outline: idea.revisions.at(-1)?.outline ?? null,
      },
      critiques: s.critiques
        .filter((c) => c.fromInstanceId === instanceId || c.toInstanceId === instanceId)
        .map((c) => `${nameOf(c.fromInstanceId)} → ${nameOf(c.toInstanceId)}：${c.text}`),
      qa: s.answers.filter((a) => a.instanceId === instanceId && a.answer).map((a) => ({ question: a.question, answer: a.answer! })),
      otherFinalists: s.upper
        .filter((f) => f.instanceId !== instanceId)
        .map((f) => s.currentRevision(s.characters.get(f.instanceId)!.ideaId).title),
    };
  }

  /**
   * 決勝の案ぶんの企画書を、優勝が決まる前に作っておく（誰が優勝しても、すぐ企画書を出せるように）。
   * 決勝の案が改良されたら、その案の分だけ作り直す。決勝がそろった・投票が始まった・ひとりで審査、のときだけ作る（費用を抑える）
   */
  private scheduleProposalDrafts() {
    this.draftTimer?.();
    this.draftTimer = this.later(() => {
      this.draftTimer = null;
      this.prepareProposalDrafts();
    }, PROPOSAL_DRAFT_DELAY_MS);
  }

  private prepareProposalDrafts() {
    const s = this.session;
    if (s.status !== 'audition_active' && s.status !== 'champion_selection') return;
    const worth = s.status === 'champion_selection' || s.finalsReady || s.mode === 'solo';
    if (!worth) return;
    for (const f of s.upper) {
      if (f.status !== 'ready') continue;
      this.ensureIdeaImage(f.instanceId);
      const revisionId = s.currentRevision(s.characters.get(f.instanceId)!.ideaId).revisionId;
      if (this.proposalDrafts.get(f.instanceId)?.revisionId === revisionId) continue;
      const input = this.proposalInput(f.instanceId);
      if (!input) continue;
      const epoch = this.epoch;
      const promise = this.generateProposalWithImage(f.instanceId, input);
      const entry = { revisionId, promise };
      this.proposalDrafts.set(f.instanceId, entry);
      promise.then(
        () => this.deps.log?.(`[proposal] draft ready for ${this.characterName(f.instanceId)}`),
        () => {
          if (epoch === this.epoch && this.proposalDrafts.get(f.instanceId) === entry) this.proposalDrafts.delete(f.instanceId);
        },
      );
    }
  }

  /** 企画書本文を作り、案のイメージ画像（決勝のフリップと同じもの）を添える。画像が無くても本文は返す */
  private async generateProposalWithImage(instanceId: string, input: ProposalInput): Promise<ProposalContent> {
    const [content, image] = await Promise.all([this.ai.generateProposal(input), this.ensureIdeaImage(instanceId)]);
    if (content.imageUrl || !image) return content;
    return { ...content, imageUrl: `data:${image.mime};base64,${image.data.toString('base64')}` };
  }

  /**
   * 決勝の案のイメージ画像を、案ごとに1回だけ作る（改良されても作り直さない。費用を抑える）。
   * できたら状態に URL を入れて全員に知らせる。失敗したら null（フリップは文字だけのまま）
   */
  private ensureIdeaImage(instanceId: string): Promise<IdeaImage | null> {
    const s = this.session;
    const c = s.characters.get(instanceId);
    if (!c || !this.ai.generateProposalImage) return Promise.resolve(null);
    const ideaId = c.ideaId;
    const existing = this.ideaImages.get(ideaId);
    if (existing) return existing.promise;
    const r = s.currentRevision(ideaId);
    const epoch = this.epoch;
    const entry: { promise: Promise<IdeaImage | null>; image: IdeaImage | null } = { promise: Promise.resolve(null), image: null };
    entry.promise = this.requestImage({
        theme: s.theme,
        title: r.title,
        catchphrase: r.summary,
        problem: r.outline?.pain ?? r.summary,
        target: r.outline?.who ?? '',
        value: r.keepStrengths?.join('・') || r.summary,
        overview: r.outline?.how ?? r.summary,
        characterName: CHARACTER_DESIGNS[c.designId]?.name ?? 'AI',
      })
      .then((url) => {
        const image = url ? parseDataUrl(url) : null;
        if (!image || epoch !== this.epoch || this.ideaImages.get(ideaId) !== entry) return null;
        entry.image = image;
        this.emit(s.setIdeaImage(ideaId, `/api/images/${s.sessionId}/${ideaId}`), { actorJudgeId: null });
        return image;
      })
      .catch((e) => {
        this.deps.log?.('generateIdeaImage failed', e);
        // 次のきっかけ（決勝がそろった・改良された）でもう一度頼めるように外す
        if (this.ideaImages.get(ideaId) === entry) this.ideaImages.delete(ideaId);
        return null;
      });
    this.ideaImages.set(ideaId, entry);
    return entry.promise;
  }

  /**
   * 画像を1枚ずつ順に頼む。一度に頼むと Gemini の画像モデルが 429（混雑）で断る。
   * 429 のときは少し待って頼み直す（5秒・15秒・30秒・60秒。画像モデルの1分あたりの上限が小さい）
   */
  private imageChain: Promise<unknown> = Promise.resolve();
  private requestImage(input: ProposalImageInput): Promise<string | null> {
    const generate = this.ai.generateProposalImage?.bind(this.ai);
    if (!generate) return Promise.resolve(null);
    const run = async (): Promise<string | null> => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await generate(input);
        } catch (e) {
          if (attempt >= IMAGE_RETRY_MS.length || !/429|RESOURCE_EXHAUSTED/.test(String(e))) throw e;
          this.deps.log?.(`[image] busy, retry in ${IMAGE_RETRY_MS[attempt]}ms`);
          await new Promise<void>((resolve) => this.later(resolve, IMAGE_RETRY_MS[attempt]!));
        }
      }
    };
    const p = this.imageChain.then(run, run);
    this.imageChain = p.catch(() => {});
    return p;
  }

  /** /api/images/<部屋>/<案> で返す画像（まだ無ければ null） */
  ideaImage(ideaId: string): IdeaImage | null {
    return this.ideaImages.get(ideaId)?.image ?? null;
  }

  /** 優勝案の企画書を出す。作っておいた分があればそれを使い、無ければ作る */
  private runProposal() {
    const s = this.session;
    const champion = s.champion;
    if (!champion) return;
    const revisionId = s.currentRevision(champion.ideaId).revisionId;
    const draft = this.proposalDrafts.get(champion.instanceId);
    const input = this.proposalInput(champion.instanceId);
    if (!input) return;
    const prepared = draft?.revisionId === revisionId;
    const promise = prepared
      ? draft!.promise.catch(() => this.generateProposalWithImage(champion.instanceId, input))
      : this.generateProposalWithImage(champion.instanceId, input);
    const epoch = this.epoch;
    const started = this.deps.clock.now();
    promise.then(
      (content) => {
        if (epoch !== this.epoch || s.champion?.ideaId !== champion.ideaId) return;
        this.deps.log?.(`[proposal] ready ${this.deps.clock.now() - started}ms (${prepared ? 'prepared' : 'fresh'}, ${this.ai.name})`);
        this.emit(s.finishProposal(content, this.ai.name), { actorJudgeId: null });
      },
      (e) => {
        this.deps.log?.('generateProposal failed', e);
        if (epoch !== this.epoch) return;
        this.emit(s.failProposal(), { actorJudgeId: null });
      },
    );
  }


  private ask(
    judgeId: string,
    instanceId: string,
    question: string,
    meta: { actorJudgeId: string; correlationId: string },
    spoken = false,
  ): { ok: true } | { ok: false; reason: RejectReason } {
    const s = this.session;
    const r = s.ask(judgeId, instanceId, question);
    if (!r.ok) return r;
    this.tasteSignal(judgeId, instanceId, 'ask');
    this.markEngaged(instanceId);
    this.emit([...r.events, ...s.touch(instanceId, 'question')], meta);
    const idea = s.ideaOf(instanceId)!;
    const rev = s.currentRevision(idea.ideaId);
    const epoch = this.epoch;
    const name = this.characterName(instanceId);
    const started = this.deps.clock.now();
    this.ai
      .answer({
        theme: s.theme,
        idea: { title: rev.title, summary: rev.summary },
        characterName: name,
        question,
        context: buildConsensusContext(s),
        spoken,
      })
      .catch((e): string | null | undefined => {
        this.deps.log?.('answer failed', e);
        return undefined;
      })
      .then((text) => {
        if (epoch !== this.epoch) return;
        this.deps.log?.(`[answer] ${this.deps.clock.now() - started}ms ${text === null ? '(misheard)' : ''}`);
        if (text === null) {
          // 聞き間違いで意味が通らない質問は、記録にも企画書にも残さず、キャラが聞き直す
          this.emit(s.dropAnswer(r.value.answerId, 'うまく聞き取れなかったよ。もう一度言ってみて？'), { actorJudgeId: null, correlationId: meta.correlationId });
          return;
        }
        const answer = text ?? 'ごめんなさい、いまうまく答えられませんでした。もう一度聞いてください。';
        this.markEngaged(instanceId);
        this.emit(s.fillAnswer(r.value.answerId, answer), { actorJudgeId: null, correlationId: meta.correlationId });
      });
    return { ok: true };
  }

  /* ------------------------ 下段：生成と入れ替え ------------------------ */

  private onStarted() {
    this.epoch++;
    this.planner = newPlannerState();
    this.hesitation.reset();
    this.hoverSince.clear();
    this.engagedUntil.clear();
    this.refineQueue = [];
    this.proposalDrafts.clear();
    this.ideaImages.clear();
    this.refining = false;
    this.usePrefetch();
    this.ensureStock();
    this.startRotation();
  }

  /**
   * ロビーでホストがテーマを入力しているあいだに、そのテーマで最初の案を作っておく。
   * 開始の直後に「準備中」で待たせないため。入力が止まってから頼み、同じテーマでは頼み直さない。
   */
  private schedulePrefetch(judgeId: string, rawTheme: string, aiMode: AuditionSession['aiMode'] | null) {
    const s = this.session;
    if (s.status !== 'lobby' && s.status !== 'completed') return;
    if (!s.judges.some((j) => j.judgeId === judgeId && j.isHost)) return;
    const theme = rawTheme.trim();
    const mode = aiMode && s.aiAvailable.includes(aiMode) ? aiMode : s.aiMode;
    this.prefetchTimer?.();
    this.prefetchTimer = null;
    if (theme.length < 2) return;
    if (this.prefetch && this.prefetch.theme === theme && this.prefetch.aiMode === mode) return;
    this.prefetchTimer = this.later(() => {
      this.prefetchTimer = null;
      if (s.status !== 'lobby' && s.status !== 'completed') return;
      const ai = this.deps.aiModes?.[mode] ?? this.deps.ai;
      const entry: NonNullable<typeof this.prefetch> = { theme, aiMode: mode, drafts: null, done: Promise.resolve() };
      entry.done = ai
        .generateIdeas({ theme, count: PREFETCH_COUNT, avoidTitles: [] })
        .then((drafts) => {
          entry.drafts = drafts;
        })
        .catch((e) => {
          this.deps.log?.('prefetch generateIdeas failed', e);
          if (this.prefetch === entry) this.prefetch = null;
        });
      this.prefetch = entry;
    }, PREFETCH_DEBOUNCE_MS);
  }

  /** 開始したテーマとモードがロビーの作り置きと同じなら、その案を最初に舞台へ出す（まだ届いていなければ、届いたときに出す） */
  private usePrefetch() {
    const s = this.session;
    const entry = this.prefetch;
    this.prefetch = null;
    this.prefetchTimer?.();
    this.prefetchTimer = null;
    if (!entry || entry.theme !== s.theme.trim() || entry.aiMode !== s.aiMode) return;
    const epoch = this.epoch;
    const add = () => {
      if (epoch !== this.epoch || s.status !== 'audition_active' || !entry.drafts) return;
      const taken = new Set([...s.ideas.values()].map((i) => i.revisions[0]!.title).concat(s.stock.map((d) => d.title)));
      const fresh = entry.drafts.filter((d) => !taken.has(d.title));
      if (fresh.length === 0) return;
      // 届いた作り置きは、先に頼んだ開始時の生成よりも前に並べる（最初の挑戦者にする）
      s.stock.unshift(...fresh.map((d) => ({ ...d, basedOnConsensus: 0 })));
      if (s.stock.length > STOCK_LIMIT) s.stock.splice(STOCK_LIMIT);
      this.embedTexts(fresh);
      this.emit(s.fillEmptySlots(), { actorJudgeId: null });
    };
    if (entry.drafts) add();
    else void entry.done.then(add);
  }

  /** 合格（全員のゴールデンブザー、または昇格の操作）：合格者待機室へ上げ、改良を始める */
  private promoteCharacter(instanceId: string, judgeIds: string[], meta: { actorJudgeId: string | null; correlationId?: string }) {
    const s = this.session;
    const r = s.promote(instanceId);
    if (!r.ok) return r;
    s.recordDecision('promoted', instanceId, judgeIds[0] ?? null);
    for (const j of judgeIds) this.tasteSignal(j, instanceId, 'promote');
    this.emit(r.events, meta);
    this.scheduleConsensus('decision');
    this.held.forEach((id, j) => id === instanceId && this.held.delete(j));
    this.enqueueRefinement({ kind: 'promotion', instanceId });
    // 合格した時点で画像を作り始める（決勝がそろうのを待たない。1枚ずつ順に作るので、合格が続いても間に合う）
    void this.ensureIdeaImage(instanceId);
    this.ensureStock();
    return { ok: true as const };
  }

  /** 下段の入れ替えを始める（誰も接続していなければ始めない） */
  private startRotation() {
    this.stopRotation?.();
    this.stopRotation = null;
    const rotation = this.deps.config.rotation;
    if (!rotation || this.session.status !== 'audition_active' || this.connections.size === 0) return;
    this.session.rotationPolicy = rotation.policy;
    this.lastWarningAt = this.deps.clock.now();
    this.stopRotation = this.deps.scheduler.setInterval(() => this.rotationTick(rotation), rotation.checkMs);
  }

  /**
   * 誰も接続していない間は止める：下段の入れ替え（そのたびに Gemini で補充する）と、
   * 合意台帳の更新の予約。動いている最中の AI 呼び出し（改良・企画書）は、その1回だけ最後まで行う。
   */
  private pauseWhileEmpty() {
    this.stopRotation?.();
    this.stopRotation = null;
    this.consensusTimer?.();
    this.consensusTimer = null;
    this.session.cancelAllLeaving();
    this.deps.log?.(`[idle] ${this.session.sessionId}: no one connected, paused rotation and generation`);
  }

  /** 誰かが戻ってきたら再開する */
  private resumeAfterEmpty() {
    if (this.session.status !== 'audition_active') return;
    this.startRotation();
    this.ensureStock();
    if (this.session.pendingUtterances().length > 0) this.scheduleConsensus('utterance');
  }

  private onStopped() {
    this.epoch++;
    this.consensusTimer?.();
    this.consensusTimer = null;
    this.replyTo.clear();
    this.stopRotation?.();
    this.stopRotation = null;
    this.refineQueue = [];
    this.refining = false;
    for (const cancel of this.pendingTimers) cancel();
    this.pendingTimers.clear();
    this.tasteTimer = null;
  }

  /**
   * 下段の入れ替え（約1秒ごと）。
   * 1. 退場予告の時刻が来た案を退場させる
   * 2. しばらく触れられていない案のうち最も注目度の低い案に退場予告を出す（同時に最大2件）
   * 見られている案（カーソル・詳細・つかみ中・回答待ち）は対象にしない。
   */
  private rotationTick(rotation: RotationConfig) {
    const s = this.session;
    if (s.status !== 'audition_active' || s.finalsReady) return;
    const id = s.lowerSlots[0];
    if (!id) return;
    const c = s.characters.get(id);
    if (!c) return;
    const now = this.deps.clock.now();
    // 一時停止ボタン：押した人がいなくなったら解除する。止めているあいだは何もしない
    if (c.holdBy != null) {
      if (s.judges.some((j) => j.judgeId === c.holdBy && j.connected)) {
        if (c.leavingAt !== null) this.emit(s.pauseChallenge(id), { actorJudgeId: null });
        return;
      }
      const released = s.holdChallenge(c.holdBy, id, false);
      if (released.ok) this.emit(released.events, { actorJudgeId: null });
    }
    // 深掘りタイム：質問・議論・じっくり見ている間はカウントを止め、終わったら再開する
    if (this.isEngaged(id, now)) {
      if (c.leavingAt !== null) this.emit(s.pauseChallenge(id), { actorJudgeId: null });
      return;
    }
    if (c.pausedLeftMs != null) {
      this.emit(s.resumeChallenge(id, RESUME_MIN_MS), { actorJudgeId: null });
      return;
    }
    // 登場したら持ち時間を決める（1人ずつの審査、#5）
    if (c.leavingAt === null) {
      this.emit(s.beginLeaving(id, s.challengeMs ?? rotation.warningMs), { actorJudgeId: null });
      return;
    }
    if (now < c.leavingAt || s.stock.length === 0) return; // 次の案が届くまで待つ
    s.recordDecision('timed_out', id, null);
    const r = s.rotate(id);
    if (r.ok) this.emit(r.events, { actorJudgeId: null });
    this.ensureStock();
  }

  /**
   * 深掘り中か：回答待ち、誰かが詳細を開いている、キャラの体にカーソルを乗せている、
   * 最後に質問・話題にしてから少しの間（議論の時間）
   */
  private isEngaged(instanceId: string, now: number) {
    if (this.session.answers.some((x) => x.instanceId === instanceId && x.answer === null)) return true;
    for (const f of this.focus.values()) if (f.detail === instanceId) return true;
    for (const h of this.hoverSince.values()) if (h.instanceId === instanceId && now - h.at >= DWELL_PAUSE_MS) return true;
    return (this.engagedUntil.get(instanceId) ?? 0) > now;
  }

  /** 質問・回答・話題にのぼった：その後しばらくは議論の時間として止めておく */
  private markEngaged(instanceId: string) {
    this.engagedUntil.set(instanceId, this.deps.clock.now() + DISCUSS_GRACE_MS);
  }

  /** いま誰かが見ている・触っている案 */
  private protectedIds() {
    const ids = new Set(this.held.values());
    for (const f of this.focus.values()) {
      if (f.hover) ids.add(f.hover);
      if (f.detail) ids.add(f.detail);
    }
    for (const a of this.session.answers) if (a.answer === null) ids.add(a.instanceId);
    return ids;
  }

  /** 空き枠＋目標ストック件数になるまで先読み生成する（ADR-0005 §3） */
  private ensureStock() {
    const s = this.session;
    // 誰も見ていないときは作り置きしない（戻ってきたら resumeAfterEmpty で再開）
    if (s.status !== 'audition_active' || this.generating || this.connections.size === 0) return;
    const empty = s.lowerSlots.filter((x) => x === null).length;
    const need = empty + this.deps.config.stockTarget - s.stock.length;
    if (need <= 0) return;
    this.generating = true;
    const epoch = this.epoch;
    const avoidTitles = [...s.ideas.values()].map((i) => i.revisions[0]!.title).concat(s.stock.map((d) => d.title));
    const rawContext = buildConsensusContext(s);
    const context = filterContextForGeneration(s, rawContext, {
      strategy: this.deps.config.contextFilterStrategy ?? 'reset_with_summary',
    });
    const now = this.deps.clock.now();
    // 枠ごとに役割（好み・両立・探索・ワイルド）と発想の型を決めて頼む（ADR-0009）
    const slots = planSlots(s, this.planner, Math.min(need, s.lowerSize + 3), now);
    // 一度にたくさん頼むと返事が遅い（最初の8案で12秒を超えた）。少しずつに分けて並べて頼み、届いた分から舞台に出す
    const chunks: (typeof slots)[] = [];
    for (let i = 0; i < slots.length; i += GENERATION_CHUNK) chunks.push(slots.slice(i, i + GENERATION_CHUNK));
    const taken = new Set<string>();
    Promise.allSettled(
      chunks.map((part, n) =>
        this.ai
          .generateIdeas({
            theme: s.theme,
            count: part.length,
            // 並べて頼むほかの組と同じ案にならないよう、組ごとに避ける名前を少し変える
            avoidTitles: n === 0 ? avoidTitles : [...avoidTitles, ...taken],
            context,
            taste: tasteHint(s, part, now),
          })
          .then((drafts) => {
            if (epoch !== this.epoch) return;
            let fresh = drafts.filter((d) => !taken.has(d.title));
            // 頼んだあとに合意が大きく動いていたら、古い前提の案は捨てる（届くのが遅れた分も含めて、M2）。
            // 作り置きが空のときだけ、舞台が止まらないよう1件残す（ADR-0007 ④と同じ）
            if (context.version < this.staleBefore) {
              const keep = s.stock.length === 0 ? fresh.slice(0, 1) : [];
              this.deps.log?.(`[consensus] v${context.version} < v${this.staleBefore}: dropped ${fresh.length - keep.length} late stale ideas`);
              fresh = keep;
              if (fresh.length === 0) return;
            }
            for (const d of fresh) taken.add(d.title);
            // どの版の合意をもとに作ったかを付けておく（古くなったら作り直す）
            s.addToStock(fresh.map((d) => ({ ...d, basedOnConsensus: context.version })));
            if (s.stock.length > STOCK_LIMIT) s.stock.splice(0, s.stock.length - STOCK_LIMIT);
            this.embedTexts(fresh);
            this.emit(s.fillEmptySlots(), { actorJudgeId: null });
          })
          .catch((e) => this.deps.log?.('generateIdeas failed', e)),
      ),
    )
      .finally(() => {
        if (epoch !== this.epoch) return;
        this.generating = false;
        // 失敗時の連続呼び出しを避けるため、少し待ってから再確認する
        this.later(() => this.ensureStock(), 1500);
      });
  }

  /* -------------------------- 上段：改良と批評 -------------------------- */

  private enqueueRefinement(t: RefineTrigger) {
    this.refineQueue.push(t);
    this.pumpRefinement();
  }

  private pumpRefinement() {
    if (this.refining) return;
    const s = this.session;
    let trigger = this.refineQueue.shift();
    while (trigger && !s.finalist(trigger.instanceId)) trigger = this.refineQueue.shift();
    if (!trigger || s.status !== 'audition_active') return;

    const others = s.upper.filter((f) => f.instanceId !== trigger.instanceId);
    // 新しい上段キャラの加入時は全員で相互批評（Q3）。待っている他の昇格もまとめて扱う。
    const isArrival = trigger.kind === 'promotion' && others.length > 0;
    if (isArrival) this.refineQueue = this.refineQueue.filter((t) => t.kind !== 'promotion');
    const participantIds = isArrival ? s.upper.map((f) => f.instanceId) : [trigger.instanceId];
    const rounds = isArrival ? (participantIds.length >= 3 ? 3 : 2) : 0;
    const base = new Map(participantIds.map((id) => [id, s.currentRevision(s.ideaOf(id)!.ideaId)]));

    this.refining = true;
    const epoch = this.epoch;
    this.emit(s.setFinalistStatus(participantIds, 'refining'), { actorJudgeId: null });

    this.ai
      .refine({
        theme: s.theme,
        trigger: isArrival ? 'arrival' : trigger.kind,
        participants: participantIds.map((id) => ({
          instanceId: id,
          characterName: this.characterName(id),
          title: base.get(id)!.title,
          summary: base.get(id)!.summary,
          version: base.get(id)!.version,
          outline: base.get(id)!.outline ?? null,
        })),
        targets: participantIds,
        rounds,
        instruction: trigger.kind === 'instruction' ? trigger.text : null,
        context: buildConsensusContext(s),
      })
      .then(
        (out) => epoch === this.epoch && this.presentRefinement(participantIds, base, out),
        (e) => {
          this.deps.log?.('refine failed', e);
          if (epoch !== this.epoch) return;
          this.emit(s.setFinalistStatus(participantIds, 'ready'), { actorJudgeId: null });
          this.finishRefinement();
        },
      );
  }

  /** 批評 → 改良版の公開を、全員が同じタイミングで見られるようサーバー側で順に出す */
  private presentRefinement(ids: string[], base: Map<string, { revisionId: string }>, out: RefineOutput) {
    const s = this.session;
    const critiques = out.critiques.filter((c) => ids.includes(c.fromInstanceId) && ids.includes(c.toInstanceId));
    if (critiques.length > 0) s.setFinalistStatus(ids, 'critiquing');
    const step = this.deps.config.critiqueIntervalMs;
    const epoch = this.epoch;

    critiques.forEach((c, i) => {
      this.later(() => {
        if (epoch !== this.epoch) return;
        this.emit(s.postCritique(c), { actorJudgeId: null });
      }, i * step);
    });

    this.later(() => {
      if (epoch !== this.epoch) return;
      const events: DomainEvent[] = [];
      for (const id of ids) {
        const draft = out.revisions[id];
        const baseRev = base.get(id);
        if (!draft || !baseRev) continue;
        const r = s.publishRevision(id, baseRev.revisionId, draft);
        if (r.ok) events.push(...r.events);
        else this.deps.log?.(`revision discarded (${r.reason})`, { id });
      }
      events.push(...s.setFinalistStatus(ids, 'ready'));
      this.emit(events, { actorJudgeId: null });
      this.finishRefinement();
    }, critiques.length * step);
  }

  private finishRefinement() {
    this.refining = false;
    this.pumpRefinement();
  }

  /* --------------------------- 合意台帳（ADR-0007） --------------------------- */

  /**
   * 台帳の更新を予約する。発言のたびには呼ばず、無音が少し続いたとき・行動の直後・
   * 発言が数件たまったときにまとめて LLM に差分を作らせる。実行中は1件だけ。
   */
  private scheduleConsensus(reason: 'utterance' | 'decision') {
    const cfg = this.deps.config.consensus;
    if (!cfg || this.session.status === 'lobby' || this.connections.size === 0) return;
    const pending = this.session.pendingUtterances().length;
    const delay =
      reason === 'decision' ? cfg.afterDecisionMs : pending >= cfg.flushAfterUtterances ? 200 : cfg.afterUtteranceMs;
    this.consensusTimer?.();
    this.consensusTimer = this.deps.scheduler.setTimeout(() => {
      this.consensusTimer = null;
      void this.runConsensus();
    }, delay);
  }

  private async runConsensus() {
    const s = this.session;
    if (this.consensusRunning) {
      this.scheduleConsensus('utterance');
      return;
    }
    const input = buildConsensusUpdateInput(s, this.consensusDecisionsSince, this.replyTo);
    if (input.utterances.length === 0 && input.decisions.length === 0) return;
    const uptoSeq = input.utterances.at(-1)?.seq ?? null;
    const startedAt = this.deps.clock.now();
    const epoch = this.epoch;
    this.consensusRunning = true;
    try {
      const drafts = await this.ai.updateConsensus(input);
      if (epoch !== this.epoch) return;
      const result = s.applyLedgerOps(toLedgerOps(s, drafts), uptoSeq);
      this.consensusDecisionsSince = startedAt;
      for (const seq of [...this.replyTo.keys()]) if (uptoSeq !== null && seq <= uptoSeq) this.replyTo.delete(seq);
      this.emit(result.events, { actorJudgeId: null });
      const significant =
        result.applied.some((o) => o.op === 'add_claim' || o.op === 'supersede') || result.statusChanges.length > 0;
      this.onConsensusChanged(significant);
    } catch (e) {
      this.deps.log?.('updateConsensus failed', e);
    } finally {
      this.consensusRunning = false;
      if (epoch === this.epoch && s.pendingUtterances().length > 0) this.scheduleConsensus('utterance');
    }
  }

  /**
   * 合意が大きく動いたら、古い合意で作った作り置きを捨てて作り直す。
   * すぐ補充できるよう1件だけは残す（ADR-0007 ④）。
   */
  private onConsensusChanged(significant: boolean) {
    if (!significant) return;
    const s = this.session;
    const version = s.ledger.version;
    this.staleBefore = version;
    const fresh = s.stock.filter((d) => (d.basedOnConsensus ?? 0) >= version);
    const stale = s.stock.filter((d) => (d.basedOnConsensus ?? 0) < version);
    s.stock = [...fresh, ...stale.slice(0, fresh.length > 0 ? 0 : 1)];
    if (stale.length > 0) this.deps.log?.(`[consensus] v${version}: dropped ${stale.length - (fresh.length > 0 ? 0 : 1)} stale ideas`);
    this.ensureStock();
  }

  /* ------------------------------ 共通 ------------------------------ */

  private characterName(instanceId: string) {
    const c = this.session.characters.get(instanceId);
    return c ? (CHARACTER_DESIGNS[c.designId]?.name ?? 'AI') : 'AI';
  }

  private later(fn: () => void, ms: number): () => void {
    const cancel = this.deps.scheduler.setTimeout(() => {
      this.pendingTimers.delete(cancel);
      fn();
    }, ms);
    this.pendingTimers.add(cancel);
    return () => {
      cancel();
      this.pendingTimers.delete(cancel);
    };
  }

  private emit(events: DomainEvent[], meta: { actorJudgeId: string | null; correlationId?: string }) {
    if (events.length === 0) return;
    if (events.some((e) => DRAFT_TRIGGERS.has(e.type))) this.scheduleProposalDrafts();
    const messages: EventMessage[] = events.map((e) => ({
      camp: CAMP_VERSION,
      kind: 'event',
      type: e.type,
      seq: ++this.seq,
      correlationId: meta.correlationId ?? null,
      actorId: meta.actorJudgeId,
      detail: e.detail,
      snapshot: undefined as never,
    }));
    // 同じバッチのイベントはすべて、バッチ適用後の snapshot を持つ
    const snapshot = toSnapshot(this.session, this.seq, this.deps.clock.now());
    const at = new Date(this.deps.clock.now()).toISOString();
    for (const m of messages) {
      m.snapshot = snapshot;
      this.unsaved.push({
        seq: m.seq,
        type: m.type,
        detail: m.detail,
        actorJudgeId: m.actorId,
        correlationId: m.correlationId,
        at,
      });
      for (const { conn } of this.connections.values()) conn.send(m);
    }
    this.schedulePersist();
  }

  /* ------------------------------ 永続化 ------------------------------ */

  /** 配信は保存を待たない。少し待ってまとめて書く（ADR-0003 Decision 2） */
  private schedulePersist() {
    if (this.saveScheduled) return;
    this.saveScheduled = true;
    this.deps.scheduler.setTimeout(() => {
      this.saveScheduled = false;
      void this.persist();
    }, this.deps.config.persistDelayMs);
  }

  /** テスト・終了時用：未保存のイベントを今すぐ書く */
  async persist(): Promise<void> {
    if (this.saving) {
      this.schedulePersist();
      return;
    }
    if (this.unsaved.length === 0) return;
    this.saving = true;
    const events = this.unsaved;
    this.unsaved = [];
    let failed = false;
    try {
      await this.deps.store.commit(this.session.sessionId, this.seq, this.session.toState(), events);
    } catch (e) {
      // 失敗してもデモは止めない。次の保存で一緒に書けるよう戻し、少し間をあけて再試行する
      failed = true;
      this.unsaved = [...events, ...this.unsaved];
      this.deps.log?.(`session save failed (${this.deps.store.name}): ${this.session.sessionId}`, e);
    } finally {
      this.saving = false;
      if (failed) this.later(() => void this.persist(), PERSIST_RETRY_MS);
      else if (this.unsaved.length > 0) this.schedulePersist();
    }
  }
}

/** 画像モデルが混雑（429）で断ったときに待つ時間 */
const IMAGE_RETRY_MS = [5_000, 15_000, 30_000, 60_000];

/** 案のイメージ画像（バイト列のまま持ち、HTTP で返す） */
export interface IdeaImage {
  mime: string;
  data: Buffer;
}

/** data:image/jpeg;base64,...（または base64 でない data:image/svg+xml;utf8,...）→ 画像の種類とバイト列。画像でなければ null */
export function parseDataUrl(url: string): IdeaImage | null {
  const m = /^data:(image\/[a-z0-9.+-]+)((?:;[a-z0-9=-]+)*),(.*)$/is.exec(url);
  if (!m) return null;
  const base64 = /;base64/i.test(m[2]!);
  try {
    return { mime: m[1]!.toLowerCase(), data: base64 ? Buffer.from(m[3]!, 'base64') : Buffer.from(decodeURIComponent(m[3]!), 'utf8') };
  } catch {
    return null;
  }
}
