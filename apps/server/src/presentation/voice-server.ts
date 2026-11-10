import { WebSocketServer, type WebSocket } from 'ws';
import { VoiceClientMessage, type VoiceServerMessage } from '@idea-audition/protocol';
import type { SpeechTranscriptionPort, TranscriptionStream } from '../application/ports.ts';
import type { ActorRegistry } from './ws-server.ts';

const MAX_FRAME_BYTES = 32 * 1024; // 16kHz・16bit なら約1秒分
const MAX_UTTERANCE_CHARS = 400;
const MIN_REFRESH_MS = 10_000; // 舞台が変わったときの語彙の作り直しは、これより頻繁にしない

/**
 * 音声チャンネル（/voice）。ブラウザのマイク音声を Gemini Live に中継し、
 * 確定した文字起こしを発言としてアクターに渡す（ADR-0005 §7、サーバー中継方式）。
 * 認証はサーバーだけが持つため、ブラウザにトークンを渡さない。
 */
export function createVoiceServer(opts: {
  registry: ActorRegistry;
  transcriber: SpeechTranscriptionPort | null;
  log: (m: string) => void;
  /** テスト用：時計と、語彙を作り直す最短の間隔 */
  now?: () => number;
  minRefreshMs?: number;
}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES * 2 });

  wss.on('connection', (ws: WebSocket) => {
    const send = (m: VoiceServerMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
    if (!opts.transcriber) {
      send({ kind: 'voice_unavailable', reason: '音声入力はこのサーバーでは無効です（AI_GATEWAY=gemini で有効）' });
      ws.close(1000);
      return;
    }
    const transcriber = opts.transcriber;
    let stream: TranscriptionStream | null = null;
    let opening = false;
    let closed = false;
    let target: string | null = null;
    let identity: { sessionId: string; judgeId: string } | null = null;

    // Live の語彙は接続時にしか渡せない。いま開いているセッションがどの舞台の語彙で開いたかを覚え、
    // 舞台が変わったら（発言が確定して無音の間に）開き直す。古いセッションからの通知は generation で見分けて無視する
    let generation = 0;
    let openedKey = '';
    let openedAt = 0;
    const now = opts.now ?? Date.now;
    const minRefreshMs = opts.minRefreshMs ?? MIN_REFRESH_MS;

    const openStream = async () => {
      if (stream || opening || closed || !identity) return;
      opening = true;
      const gen = ++generation;
      const { sessionId, judgeId } = identity;
      try {
        // いまのキャラ名・企画名・説明文の固有語を語彙として渡す
        const actor0 = await opts.registry.get(sessionId).catch(() => undefined);
        const vocabulary = actor0?.speechVocabulary() ?? [];
        openedKey = actor0?.speechStageKey() ?? '';
        openedAt = now();
        stream = await transcriber.open({
          onInterim: (text) => send({ kind: 'voice_interim', text }),
          onFinal: (text) => {
            send({ kind: 'voice_final', text });
            void opts.registry.get(sessionId).then((actor) => {
              actor?.receiveUtterance(judgeId, text.slice(0, MAX_UTTERANCE_CHARS), 'live', target);
              if (actor && gen === generation && actor.speechStageKey() !== openedKey) refreshStale(gen);
            });
          },
          onClose: (reason) => {
            if (gen !== generation) return; // 自分で開き直した古いセッションの終了。新しいほうを消さない
            stream = null;
            // Live のセッションは時間制限で切れることがある。マイクが ON のままなら次の音声で開き直す
            if (!closed) opts.log(`[voice] live closed (${reason}); will reopen on next audio`);
          },
        }, { vocabulary });
        if (closed) stream.close();
        else send({ kind: 'voice_ready' });
      } catch (e) {
        opts.log(`[voice] open failed: ${String(e)}`);
        send({ kind: 'voice_unavailable', reason: '音声認識に接続できませんでした。テキストで入力してください' });
        ws.close(1011);
      } finally {
        opening = false;
      }
    };

    /**
     * 舞台が変わって語彙が古くなったセッションを、新しい語彙で開き直す。
     * 発言の確定は無音（既定 1.2 秒）のあとなので、次の発言の頭を取りこぼしにくい。
     * 開き直しが続かないよう、前回から minRefreshMs はあける。
     */
    const refreshStale = (gen: number) => {
      if (gen !== generation || !stream || opening || closed) return;
      if (now() - openedAt < minRefreshMs) return;
      opts.log('[voice] stage changed; reopening live session with fresh vocabulary');
      const old = stream;
      stream = null;
      generation++; // 古いセッションの onClose を無視させる
      old.close();
      void openStream();
    };

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        if (!stream) {
          void openStream();
          return; // 接続中の数百ミリ秒分の音声は捨てる
        }
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        if (buf.length > 0 && buf.length <= MAX_FRAME_BYTES && buf.length % 2 === 0) stream.sendAudio(buf);
        return;
      }
      let json: unknown;
      try {
        json = JSON.parse(String(data));
      } catch {
        return;
      }
      const parsed = VoiceClientMessage.safeParse(json);
      if (!parsed.success) return;
      const msg = parsed.data;
      if (msg.kind === 'voice_target') {
        target = msg.instanceId;
        return;
      }
      if (identity) return;
      void opts.registry.get(msg.sessionId).then((actor) => {
        if (!actor || !actor.isJudge(msg.judgeId)) {
          send({ kind: 'voice_unavailable', reason: '審査員として参加していないため、音声入力は使えません' });
          ws.close(1008);
          return;
        }
        identity = { sessionId: msg.sessionId, judgeId: msg.judgeId };
        void openStream();
      });
    });

    ws.on('close', () => {
      closed = true;
      stream?.close();
      stream = null;
    });
  });

  return wss;
}
