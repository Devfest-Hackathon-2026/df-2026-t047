import { describe, expect, it } from 'vitest';
import { CHARACTER_DESIGNS, CAMP_VERSION, type CommandMessage, type EventMessage, type WelcomeMessage } from '@idea-audition/protocol';
import { SessionActor } from '../src/application/session-actor.ts';
import type { UtteranceTriage, UtteranceTriageInput } from '../src/application/ports.ts';
import { MemorySessionStore } from '../src/infrastructure/persistence/memory-store.ts';
import { StubAi, fakeClock, fakeConnection, manualScheduler, seqIds } from './helpers.ts';

/** 仕分けの返事を外から止めて、返す順番を入れ替えられる AI（順番のテスト用） */
class SlowTriageAi extends StubAi {
  release: (() => void)[] = [];
  override async triageUtterance(input: UtteranceTriageInput): Promise<UtteranceTriage> {
    const result = await super.triageUtterance(input);
    if (input.text.startsWith('遅い')) await new Promise<void>((r) => this.release.push(r));
    return result;
  }
}

describe('声の発言の仕分けと言い直し（issue #3）', () => {
  async function setup(opts: { triage?: boolean; ai?: StubAi } = {}) {
    const { scheduler, advance } = manualScheduler();
    const ai = opts.ai ?? new StubAi();
    const actor = await SessionActor.open('t', {
      ai,
      store: new MemorySessionStore(),
      scheduler,
      clock: fakeClock(),
      ids: seqIds(),
      config: {
        stockTarget: 3,
        lowerSlotCount: 5,
        rotation: null,
        critiqueIntervalMs: 10,
        persistDelayMs: 10,
        consensus: null,
        triage: opts.triage ?? true,
      },
    });
    const a = fakeConnection('a');
    actor.attach(a.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 't' });
    const judgeId = (a.received.find((m) => m.kind === 'welcome') as WelcomeMessage).participantId!;
    actor.receiveCommand(a.conn, {
      camp: CAMP_VERSION, kind: 'command', type: 'START_AUDITION', commandId: 'c1', sentAt: '', payload: { theme: 't', mode: 'team' },
    } as CommandMessage);
    await advance(0);
    const finalistId = actor.session.lowerSlots[0]!;
    actor.receiveCommand(a.conn, {
      camp: CAMP_VERSION, kind: 'command', type: 'REQUEST_PROMOTION', commandId: 'c2', sentAt: '', payload: { instanceId: finalistId },
    } as CommandMessage);
    await advance(100);
    const nameOf = (id: string) => CHARACTER_DESIGNS[actor.session.characters.get(id)!.designId]!;
    const utterances = () =>
      a.received.filter((m): m is EventMessage => m.kind === 'event' && m.type === 'JUDGE_UTTERANCE_RECEIVED');
    return { actor, ai, judgeId, finalistId, nameOf, utterances, advance };
  }

  it('審査の話題なら言い直した文が、記録・キャラへの質問になる（聞こえたままの文は rawText に残す）', async () => {
    const { actor, ai, judgeId, finalistId, utterances, advance } = await setup();
    ai.nextTriage = () => ({ keep: true, summary: '費用はいくらかかりますか？' });
    actor.receiveUtterance(judgeId, 'えーと費用ってどれくらいかかるのかなぁ？', 'live', finalistId);
    await advance(100);
    expect(ai.triageCalls.at(-1)!.text).toBe('えーと費用ってどれくらいかかるのかなぁ？');
    // イベントの文は言い直した文。元の文は rawText に残る
    expect(utterances().at(-1)!.detail).toMatchObject({
      text: '費用はいくらかかりますか？',
      rawText: 'えーと費用ってどれくらいかかるのかなぁ？',
      targetInstanceId: finalistId,
      intent: 'question',
    });
    // 合意台帳・AI の文脈の材料と、キャラに渡る質問も言い直した文
    expect(actor.session.utterances.at(-1)!.text).toBe('費用はいくらかかりますか？');
    expect(ai.answerCalls.at(-1)).toBe('費用はいくらかかりますか？');
    expect(actor.session.answers.at(-1)).toMatchObject({ question: '費用はいくらかかりますか？' });
  });

  it('頼みの文を言い直しても、改良の指示は言い直した文で届く（種類の判定は聞こえたままの文）', async () => {
    const { actor, ai, judgeId, finalistId, utterances, advance } = await setup();
    ai.nextTriage = () => ({ keep: true, summary: 'コストを下げてほしい' });
    const before = ai.refineCalls.length;
    actor.receiveUtterance(judgeId, 'あのーコスト、もうちょっと下げてほしいなって', 'live', finalistId);
    await advance(100);
    expect(utterances().at(-1)!.detail).toMatchObject({ intent: 'instruction', text: 'コストを下げてほしい' });
    expect(ai.refineCalls.length).toBe(before + 1);
    expect(ai.refineCalls.at(-1)!.instruction).toBe('コストを下げてほしい');
  });

  it('雑談・アプリの話は捨てる：記録に残らず、好みにも合意台帳にも入らず、キャラも答えない', async () => {
    const { actor, ai, judgeId, finalistId, utterances, advance } = await setup();
    ai.nextTriage = () => ({ keep: false, reason: 'off_topic' });
    const utterancesBefore = actor.session.utterances.length;
    const answersBefore = actor.session.answers.length;
    const refinesBefore = ai.refineCalls.length;
    const tasteBefore = JSON.stringify(actor.session.taste);
    const eventsBefore = utterances().length;
    actor.receiveUtterance(judgeId, 'あれ、マイク聞こえてる？ 画面が重いんだけど', 'live', finalistId);
    await advance(100);
    expect(ai.triageCalls.length).toBe(1);
    expect(utterances().length).toBe(eventsBefore);
    expect(actor.session.utterances.length).toBe(utterancesBefore);
    expect(actor.session.answers.length).toBe(answersBefore);
    expect(ai.refineCalls.length).toBe(refinesBefore);
    expect(JSON.stringify(actor.session.taste)).toBe(tasteBefore);
  });

  it('聞き間違いで意味が通らない発言も捨てる', async () => {
    const { actor, ai, judgeId, utterances, advance } = await setup();
    ai.nextTriage = () => ({ keep: false, reason: 'garbled' });
    actor.receiveUtterance(judgeId, 'ミストにぶとう分だけの', 'live', null);
    await advance(100);
    expect(utterances().length).toBe(0);
    expect(actor.session.utterances.length).toBe(0);
  });

  it('キャラの名前を呼んだ発言は、仕分けを待たずにそのまま扱う', async () => {
    const { actor, ai, judgeId, finalistId, nameOf, utterances, advance } = await setup();
    ai.nextTriage = () => ({ keep: false, reason: 'off_topic' }); // 呼ばれたら捨てられてしまう設定
    const reading = nameOf(finalistId).readings[0]!;
    actor.receiveUtterance(judgeId, `${reading}、もう少しコストを下げて`, 'live', null);
    expect(ai.triageCalls.length).toBe(0);
    await advance(100);
    expect(utterances().at(-1)!.detail).toMatchObject({ targetInstanceId: finalistId, intent: 'instruction' });
    expect(utterances().at(-1)!.detail).not.toHaveProperty('rawText');
  });

  it('テキストで打った発言は仕分けない（打った人が自分で選んだ発言なので、そのまま出す）', async () => {
    const { actor, ai, judgeId, utterances } = await setup();
    ai.nextTriage = () => ({ keep: false, reason: 'off_topic' });
    actor.receiveUtterance(judgeId, 'いい感じだね', 'text', null);
    expect(ai.triageCalls.length).toBe(0);
    expect(utterances().at(-1)!.detail).toMatchObject({ text: 'いい感じだね', intent: 'comment' });
  });

  it('AI が言い直さなかったとき（summary なし）は、聞こえたままの文を使う', async () => {
    const { actor, judgeId, utterances, advance } = await setup();
    actor.receiveUtterance(judgeId, 'コストは低めがいいね', 'live', null);
    await advance(100);
    const detail = utterances().at(-1)!.detail;
    expect(detail).toMatchObject({ text: 'コストは低めがいいね' });
    expect(detail).not.toHaveProperty('rawText');
  });

  it('仕分けの AI が失敗しても、本物の発言を落とさずそのまま扱う', async () => {
    const { actor, ai, judgeId, utterances, advance } = await setup();
    ai.failTriage = true;
    actor.receiveUtterance(judgeId, 'コストは低めがいいね', 'live', null);
    await advance(100);
    expect(utterances().at(-1)!.detail).toMatchObject({ text: 'コストは低めがいいね' });
    expect(actor.session.utterances.at(-1)!.text).toBe('コストは低めがいいね');
  });

  it('仕分けを無効にしている（triage なし）ときは、これまでどおり待たずに扱う', async () => {
    const { actor, ai, judgeId, utterances } = await setup({ triage: false });
    actor.receiveUtterance(judgeId, 'コストは低めがいいね', 'live', null);
    expect(ai.triageCalls.length).toBe(0);
    expect(utterances().at(-1)!.detail).toMatchObject({ text: 'コストは低めがいいね' });
  });

  it('同じ人の発言は、AI の返事が前後しても言った順に処理する', async () => {
    const ai = new SlowTriageAi();
    const { actor, judgeId, utterances, advance } = await setup({ ai });
    actor.receiveUtterance(judgeId, '遅い返事の発言です', 'live', null);
    actor.receiveUtterance(judgeId, 'すぐ返る発言です', 'live', null);
    await advance(100);
    // 1つ目の返事を待っている間は、2つ目も出ない
    expect(utterances().length).toBe(0);
    ai.release[0]!();
    await advance(100);
    expect(utterances().map((m) => m.detail.text)).toEqual(['遅い返事の発言です', 'すぐ返る発言です']);
  });

  it('仕分けにはテーマ・舞台のキャラと企画名・直前の発言を渡す', async () => {
    const { actor, ai, judgeId, finalistId, advance } = await setup();
    actor.receiveUtterance(judgeId, 'コストは低めがいいね', 'text', null);
    actor.receiveUtterance(judgeId, 'それは微妙かも', 'live', null);
    await advance(100);
    const input = ai.triageCalls.at(-1)!;
    expect(input.theme).toBe('t');
    expect(input.stage.some((c) => c.title === actor.session.currentRevision(actor.session.characters.get(finalistId)!.ideaId).title)).toBe(true);
    expect(input.recentRemarks.at(-1)!.text).toBe('コストは低めがいいね');
  });
});
