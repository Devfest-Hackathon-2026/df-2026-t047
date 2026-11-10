import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { SpeechTranscriptionPort, TranscriptionStream } from '../src/application/ports.ts';
import { createVoiceServer } from '../src/presentation/voice-server.ts';

/** 舞台が変わったら、発言の確定のあとで Live を新しい語彙で開き直す */
describe('音声認識の語彙の更新', () => {
  function setup(minRefreshMs = 10_000) {
    let key = 'stage-1';
    let vocab = ['ルナ'];
    let clock = 0;
    const opened: { vocabulary: string[]; cb: Parameters<SpeechTranscriptionPort['open']>[0]; closed: boolean }[] = [];
    const transcriber: SpeechTranscriptionPort = {
      name: 'fake',
      async open(cb, options) {
        const s = { vocabulary: options?.vocabulary ?? [], cb, closed: false };
        opened.push(s);
        const stream: TranscriptionStream = {
          sendAudio() {},
          close() {
            s.closed = true;
            cb.onClose('closed by test');
          },
        };
        return stream;
      },
    };
    const actor = {
      isJudge: () => true,
      speechVocabulary: () => vocab,
      speechStageKey: () => key,
      receiveUtterance: () => ({ ok: true }),
    };
    const wss = createVoiceServer({
      registry: { get: async () => actor } as never,
      transcriber,
      log: () => {},
      now: () => clock,
      minRefreshMs,
    });
    const ws = Object.assign(new EventEmitter(), { OPEN: 1, readyState: 1, sent: [] as string[], send(m: string) { this.sent.push(m); }, close() {} });
    wss.emit('connection', ws);
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const hello = async () => {
      ws.emit('message', Buffer.from(JSON.stringify({ kind: 'voice_hello', sessionId: 's', judgeId: 'j' })), false);
      await tick();
      await tick();
    };
    const final = async (text: string) => {
      opened.at(-1)!.cb.onFinal(text);
      await tick();
      await tick();
    };
    return {
      opened, hello, final, tick,
      setStage: (k: string, v: string[]) => { key = k; vocab = v; },
      advance: (ms: number) => { clock += ms; },
    };
  }

  it('舞台が変わったら、発言の確定のあとに新しい語彙で開き直す', async () => {
    const t = setup();
    await t.hello();
    expect(t.opened).toHaveLength(1);
    expect(t.opened[0]!.vocabulary).toEqual(['ルナ']);

    t.setStage('stage-2', ['ルナ', 'スタンプラリー']);
    t.advance(20_000);
    await t.final('それはいいね');

    expect(t.opened).toHaveLength(2);
    expect(t.opened[0]!.closed).toBe(true);
    expect(t.opened[1]!.vocabulary).toEqual(['ルナ', 'スタンプラリー']);
  });

  it('舞台が変わっていなければ開き直さない', async () => {
    const t = setup();
    await t.hello();
    t.advance(20_000);
    await t.final('それはいいね');
    expect(t.opened).toHaveLength(1);
  });

  it('開き直したばかりなら、舞台が変わっても間をあける', async () => {
    const t = setup();
    await t.hello();
    t.setStage('stage-2', ['ルナ', 'スタンプラリー']);
    t.advance(3_000);
    await t.final('それはいいね');
    expect(t.opened).toHaveLength(1);
  });

  it('古いセッションの終了通知で、新しいセッションを消さない', async () => {
    const t = setup(0);
    await t.hello();
    t.setStage('stage-2', ['ルナ', 'スタンプラリー']);
    await t.final('それはいいね');
    expect(t.opened).toHaveLength(2);
    // 新しいセッションの確定でも、さらに開き直さない（舞台は同じ）
    t.advance(20_000);
    await t.final('もう一度');
    expect(t.opened).toHaveLength(2);
    expect(t.opened[1]!.closed).toBe(false);
  });
});
