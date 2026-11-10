import { describe, expect, it } from 'vitest';
import { CHARACTER_DESIGNS, CAMP_VERSION, type CommandMessage, type EventMessage, type WelcomeMessage } from '@idea-audition/protocol';
import { SessionActor } from '../src/application/session-actor.ts';
import { normalizeTranscript } from '../src/infrastructure/gemini/live-transcriber.ts';
import { MemorySessionStore } from '../src/infrastructure/persistence/memory-store.ts';
import { StubAi, fakeClock, fakeConnection, manualScheduler, seqIds } from './helpers.ts';

describe('文字起こしの整形', () => {
  it('日本語の間の空白と "{}" を取り除く', () => {
    expect(normalizeTranscript('{} る な もう 少し 実現 コスト を 下げ られ ない か な ? {}')).toBe(
      'るなもう少し実現コストを下げられないかな？',
    );
    expect(normalizeTranscript('ルナ、もう少し実現コストを下げられないかな？')).toBe('ルナ、もう少し実現コストを下げられないかな？');
    expect(normalizeTranscript('AR 食堂 ツアー')).toBe('AR 食堂ツアー');
  });
});

describe('発言の宛先と意図（AC-14）', () => {
  async function setup() {
    const { scheduler, advance } = manualScheduler();
    const ai = new StubAi();
    const actor = await SessionActor.open('v', {
      ai,
      store: new MemorySessionStore(),
      scheduler,
      clock: fakeClock(),
      ids: seqIds(),
      config: { stockTarget: 3, lowerSlotCount: 5, rotation: null, critiqueIntervalMs: 10, persistDelayMs: 10, consensus: null },
    });
    const a = fakeConnection('a');
    actor.attach(a.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'v' });
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

  it('名前（読み）を呼んだキャラが宛先になり、上段への指示は改良になる', async () => {
    const { actor, ai, judgeId, finalistId, nameOf, utterances, advance } = await setup();
    const reading = nameOf(finalistId).readings[0]!;
    const before = ai.refineCalls.length;
    actor.receiveUtterance(judgeId, `${reading}、もう少しコストを下げて`, 'live', null);
    await advance(100);
    expect(utterances().at(-1)!.detail).toMatchObject({ targetInstanceId: finalistId, intent: 'instruction' });
    expect(ai.refineCalls.length).toBe(before + 1);
    expect(ai.refineCalls.at(-1)!.instruction).toContain('コストを下げて');
  });

  it('記号（A案・エー案）で呼んだ決勝の案が宛先になる', async () => {
    const { actor, ai, judgeId, finalistId, utterances, advance } = await setup();
    const before = ai.refineCalls.length;
    actor.receiveUtterance(judgeId, 'エー案の費用はどれくらい？', 'live', null);
    await advance(100);
    expect(utterances().at(-1)!.detail).toMatchObject({ targetInstanceId: finalistId, intent: 'question' });
    expect(ai.refineCalls.length).toBe(before);
    actor.receiveUtterance(judgeId, 'A案、もう少しコストを下げて', 'text', null);
    await advance(100);
    expect(utterances().at(-1)!.detail).toMatchObject({ targetInstanceId: finalistId, intent: 'instruction' });
  });

  it('質問は回答だけで、案は変えない', async () => {
    const { actor, ai, judgeId, finalistId, utterances, advance } = await setup();
    const before = ai.refineCalls.length;
    actor.receiveUtterance(judgeId, '費用はどれくらい？', 'live', finalistId);
    await advance(100);
    expect(utterances().at(-1)!.detail).toMatchObject({ targetInstanceId: finalistId, intent: 'question' });
    expect(ai.refineCalls.length).toBe(before);
    expect(actor.session.answers.at(-1)).toMatchObject({ question: '費用はどれくらい？', answer: '回答:費用はどれくらい？' });
  });

  it('宛先がなければ発言として共有するだけ', async () => {
    const { actor, judgeId, utterances } = await setup();
    actor.receiveUtterance(judgeId, 'いい感じだね', 'text', null);
    expect(utterances().at(-1)!.detail).toMatchObject({ targetInstanceId: null, intent: 'comment' });
  });

  it('審査員でない人の発言は受け付けない', async () => {
    const { actor } = await setup();
    expect(actor.receiveUtterance('judge_unknown', 'こんにちは', 'live', null)).toEqual({ ok: false, reason: 'SPECTATOR' });
  });
});

import { UtteranceAssembler, mergeWithInterim } from '../src/infrastructure/gemini/live-transcriber.ts';

describe('文字起こしの区切りをまとめる', () => {
  it('確定結果で欠けた先頭を途中経過から補う', () => {
    expect(mergeWithInterim('ルナ留学', '留学生も楽しめる')).toBe('ルナ留学生も楽しめる');
    expect(mergeWithInterim('にして', 'して')).toBe('にして');
    expect(mergeWithInterim('ルナ、もう少し', 'ルナ、もう少し実現コスト')).toBe('ルナ、もう少し実現コスト');
    expect(mergeWithInterim('', 'こんにちは')).toBe('こんにちは');
  });

  it('無音が続くまで区切りを連結し、1つの発言として確定する', () => {
    let fire: (() => void) | null = null;
    const finals: string[] = [];
    const a = new UtteranceAssembler(
      { onInterim: () => {}, onFinal: (t) => finals.push(t) },
      1200,
      { set: (fn) => ((fire = fn), 1 as unknown as ReturnType<typeof setTimeout>), clear: () => (fire = null) },
    );
    a.interim('ルナ留学');
    a.interim('留学生も');
    a.segment('留学生も楽しめる');
    a.interim('にして');
    a.segment('して');
    expect(finals).toEqual([]);
    fire!();
    expect(finals).toEqual(['ルナ留学生も楽しめるにして']);
  });
});
