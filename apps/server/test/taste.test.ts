import { describe, expect, it } from 'vitest';
import { CAMP_VERSION, type CommandMessage, type EventMessage, type ServerMessage } from '@idea-audition/protocol';
import { CONFIDENT_SIGNALS, applySignal, divergence, emptyTaste, normalized, HALF_LIFE_MS, TASTE_SCALE } from '../src/domain/taste.ts';
import { sample, type Candidate, type SelectionContext } from '../src/domain/selection.ts';
import { computeMetrics } from '../src/domain/metrics.ts';
import { detectCue, HesitationGate } from '../src/application/hesitation.ts';
import { SessionActor } from '../src/application/session-actor.ts';
import { MemorySessionStore } from '../src/infrastructure/persistence/memory-store.ts';
import { heuristicProfile, localEmbedding } from '../src/infrastructure/local-taste.ts';
import { cosine } from '../src/domain/taste.ts';
import { StubAi, fakeConnection, manualScheduler, seqIds } from './helpers.ts';

const axis = (i: number, v = 1) => Array.from({ length: 8 }, (_, k) => (k === i ? v : 0));

describe('好みモデル', () => {
  it('反応を足すと、その軸の好みが上がり、半減期で半分になる', () => {
    let t = applySignal(emptyTaste(), 'a', axis(2), 1, 0);
    const now = normalized(t.judges.a, 0)[2]!;
    const later = normalized(t.judges.a, HALF_LIFE_MS)[2]!;
    expect(now).toBeGreaterThan(0.5);
    expect(later).toBeCloseTo(Math.tanh(0.5 / TASTE_SCALE), 5);
    t = applySignal(t, 'a', axis(2), -1, 0);
    expect(normalized(t.judges.a, 0)[2]).toBeCloseTo(0, 5);
  });

  it('2人の好みが同じ軸で逆なら、その軸を「割れている」と判定する（反応が少ないうちは判定しない）', () => {
    let t = emptyTaste();
    for (let i = 0; i < CONFIDENT_SIGNALS - 1; i++) {
      t = applySignal(t, 'a', axis(0, 1), 1, 0);
      t = applySignal(t, 'b', axis(0, -1), 1, 0);
    }
    expect(divergence(t, ['a', 'b'], 0)).toBeNull();
    t = applySignal(t, 'a', axis(0, 1), 1, 0);
    t = applySignal(t, 'b', axis(0, -1), 1, 0);
    expect(divergence(t, ['a', 'b'], 0)).toMatchObject({ axis: 0, judgeA: 'a', judgeB: 'b' });
  });
});

describe('選抜', () => {
  const base: Omit<SelectionContext, 'role' | 'targets'> = { centroids: [], shown: [], mu: 0.35, temperature: 0.01 };
  const cands: Candidate[] = [
    { index: 0, profile: axis(0, 1), embedding: null }, // A 寄り
    { index: 1, profile: axis(0, -1), embedding: null }, // B 寄り
    { index: 2, profile: [0, 0, 0.9, 0, 0, 0, 0, 0], embedding: null }, // 両方が少し好む軸
  ];

  it('fit：狙った審査員の好みにいちばん近い候補を選ぶ', () => {
    expect(sample(cands, { ...base, role: 'fit', targets: [axis(0, 1)] }, () => 0.5)!.index).toBe(0);
  });

  it('bridge：2人のどちらにも遠すぎない候補を選ぶ（近さの小さいほうが最大）', () => {
    const a = [0.8, 0, 0.6, 0, 0, 0, 0, 0];
    const b = [-0.8, 0, 0.6, 0, 0, 0, 0, 0];
    expect(sample(cands, { ...base, role: 'bridge', targets: [a, b] }, () => 0.5)!.index).toBe(2);
  });

  it('explore と MMR：舞台にある案と似た候補は選ばれにくい', () => {
    const shown = [{ profile: axis(0, 1), embedding: null }];
    expect(sample(cands, { ...base, shown, role: 'explore', targets: [] }, () => 0.5)!.index).not.toBe(0);
  });

  it('ローカルの埋め込み：同じ言葉を含む案ほど近い', () => {
    const a = localEmbedding('学食のスタンプラリー');
    const b = localEmbedding('学食スタンプカード');
    const c = localEmbedding('屋上で映画上映会');
    expect(cosine(a, b)).toBeGreaterThan(cosine(a, c));
    expect(heuristicProfile('無料で手作り')[0]).toBeLessThan(0);
  });
});

describe('効果の指標', () => {
  it('前半と後半の選ばれた率と、増えた割合を出す', () => {
    const ideas = Array.from({ length: 10 }, (_, i) => ({
      ideaId: `i${i}`,
      revisions: [{ createdAt: i < 5 ? 10 : 90 } as never],
      pitch: { role: i % 2 ? 'fit' : 'explore', judgeIds: [], reason: '' } as const,
    }));
    const characters = ideas.map((i, n) => ({ ideaId: i.ideaId, instanceId: `c${n}` }) as never);
    const decisions = ['c0', 'c1', 'c2', 'c5', 'c6', 'c7', 'c8'].map((id) => ({ kind: 'promoted', instanceId: id }) as never);
    const m = computeMetrics({ ideas: ideas as never, characters, decisions, startedAt: 0, now: 100 });
    expect(m.firstHalf).toEqual({ shown: 5, picked: 3 });
    expect(m.secondHalf).toEqual({ shown: 5, picked: 4 });
    expect(m.liftPct).toBe(33);
  });

  it('選ばれた数が少ない（前半1件・後半2件など）ときは、％を出さない', () => {
    const ideas = Array.from({ length: 10 }, (_, i) => ({
      ideaId: `i${i}`,
      revisions: [{ createdAt: i < 5 ? 10 : 90 } as never],
      pitch: null,
    }));
    const characters = ideas.map((i, n) => ({ ideaId: i.ideaId, instanceId: `c${n}` }) as never);
    const decisions = ['c0', 'c5', 'c6'].map((id) => ({ kind: 'promoted', instanceId: id }) as never);
    const m = computeMetrics({ ideas: ideas as never, characters, decisions, startedAt: 0, now: 100 });
    expect(m.liftPct).toBeNull();
  });
});

describe('迷いの判定', () => {
  it('「うーん」「なんか違う」は迷い、「いいね」は好意', () => {
    expect(detectCue('うーん、それはどうかな')).toBe('hesitation');
    expect(detectCue('なんか違うんだよね')).toBe('hesitation');
    expect(detectCue('いいね、それ')).toBe('positive');
    expect(detectCue('次の案を見よう')).toBeNull();
  });

  it('同じ案には25秒、全体では8秒あけて反応する', () => {
    const g = new HesitationGate();
    expect(g.tryReact('x', 0)).not.toBeNull();
    expect(g.tryReact('y', 5_000)).toBeNull();
    expect(g.tryReact('y', 9_000)).not.toBeNull();
    expect(g.tryReact('x', 20_000)).toBeNull();
    expect(g.tryReact('x', 26_000)).not.toBeNull();
  });
});

/* ------------------------------ アクターでの通し ------------------------------ */

let cid = 0;
function cmd<T extends CommandMessage['type']>(type: T, payload: Extract<CommandMessage, { type: T }>['payload']) {
  return { camp: CAMP_VERSION, kind: 'command', type, commandId: `t${++cid}`, sentAt: '', payload } as CommandMessage;
}
const events = (msgs: ServerMessage[]) => msgs.filter((m): m is EventMessage => m.kind === 'event');

async function setup() {
  const { scheduler, advance } = manualScheduler();
  let t = 1_700_000_000_000;
  const clock = { now: () => t };
  const tick = async (ms: number) => {
    t += ms;
    await advance(ms);
  };
  const ai = new StubAi();
  const actor = new SessionActor('demo', {
    ai,
    store: new MemorySessionStore(),
    scheduler,
    clock,
    ids: seqIds(),
    rng: () => 0.5,
    config: { stockTarget: 3, lowerSlotCount: 5, rotation: null, critiqueIntervalMs: 1000, persistDelayMs: 50, consensus: null },
  });
  const a = fakeConnection('a');
  actor.attach(a.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'demo' });
  actor.receiveCommand(a.conn, cmd('START_AUDITION', { theme: '学食', mode: 'team' }));
  await tick(0);
  return { actor, ai, a, tick };
}

describe('好みエンジン（アクター）', () => {
  it('下段の案には8軸と「出した理由」が付く', async () => {
    const { a } = await setup();
    const snap = events(a.received).at(-1)!.snapshot;
    const ideas = snap.lowerSlots.map((id) => snap.ideas[snap.characters[id!]!.ideaId]!);
    expect(ideas.every((i) => i.pitch !== null)).toBe(true);
    // 好みが溜まる前は「探索」と「ワイルドカード」で広く探る
    expect(new Set(ideas.map((i) => i.pitch!.role))).toEqual(new Set(['explore', 'wildcard']));
  });

  it('決勝に選ぶと好みが更新され、TASTE_UPDATED がまとめて1回届く', async () => {
    const { actor, a, tick } = await setup();
    const judgeId = actor.session.judges[0]!.judgeId;
    // StubAi の案にはプロフィールが無いので、テスト用に付ける
    for (const idea of actor.session.ideas.values()) idea.revisions[0]!.profile = [0, 0, 1, 0, 0, 0, 0, 0];
    const [x, y] = actor.session.lowerSlots as string[];
    actor.receiveCommand(a.conn, cmd('REQUEST_PROMOTION', { instanceId: x! }));
    actor.receiveCommand(a.conn, cmd('ASK_CANDIDATE', { instanceId: y!, text: '費用は？' }));
    await tick(1500);
    const updates = events(a.received).filter((e) => e.type === 'TASTE_UPDATED');
    expect(updates).toHaveLength(1);
    expect(updates[0]!.snapshot.taste.judges[judgeId]![2]).toBeGreaterThan(0.5);
    expect(updates[0]!.snapshot.taste.signals[judgeId]).toBe(2);
  });

  it('見ている案に「うーん」と言うと、キャラが 🤔 で反応し、別案の版が足される', async () => {
    const { actor, ai, a, tick } = await setup();
    const target = actor.session.lowerSlots[1]!;
    actor.receiveEphemeral(a.conn, { camp: CAMP_VERSION, kind: 'ephemeral', type: 'FOCUS_CHANGED', payload: { hover: target, detail: null } });
    actor.receiveCommand(a.conn, cmd('SUBMIT_UTTERANCE', { text: 'うーん、なんか違うな', source: 'live' }));
    await tick(10);
    const reacted = events(a.received).find((e) => e.type === 'CANDIDATE_REACTED')!;
    expect(reacted.detail).toMatchObject({ instanceId: target, kind: 'hesitation' });
    expect(reacted.snapshot.characters[target]!.reaction?.kind).toBe('hesitation');
    const revised = events(a.received).find((e) => e.type === 'CANDIDATE_REVISED')!;
    expect(revised.detail).toMatchObject({ instanceId: target, version: 2 });
    const idea = revised.snapshot.ideas[revised.snapshot.characters[target]!.ideaId]!;
    expect(idea.revisions.at(-1)!.reason).toContain('迷いを受けて');
    expect(ai.varyCalls[0]!.concern).toBe('うーん、なんか違うな');
    // 質問としては扱わない（回答を作らない）
    expect(events(a.received).some((e) => e.type === 'CANDIDATE_ANSWERED')).toBe(false);
  });

  it('SOFT_SIGNAL の迷いでも反応し、続けて来ても間隔をあける', async () => {
    const { actor, a, tick } = await setup();
    const target = actor.session.lowerSlots[0]!;
    const signal = { camp: CAMP_VERSION, kind: 'signal', type: 'SOFT_SIGNAL', payload: { kind: 'hesitation', targetInstanceId: target, cue: 'hum' } } as const;
    actor.receiveSignal(a.conn, signal);
    await tick(600);
    actor.receiveSignal(a.conn, signal);
    await tick(10);
    expect(events(a.received).filter((e) => e.type === 'CANDIDATE_REACTED')).toHaveLength(1);
  });

  it('詳細画面の質問欄に「うーん、微妙かも」と入れても、迷いとして別案を出す（質問として答えない）', async () => {
    const { actor, ai, a, tick } = await setup();
    const target = actor.session.lowerSlots[2]!;
    actor.receiveCommand(a.conn, cmd('ASK_CANDIDATE', { instanceId: target, text: 'うーん、ちょっと微妙かも…' }));
    await tick(10);
    expect(events(a.received).some((e) => e.type === 'CANDIDATE_REVISED')).toBe(true);
    expect(events(a.received).some((e) => e.type === 'CANDIDATE_ANSWERED')).toBe(false);
    expect(ai.varyCalls).toHaveLength(1);
  });

  it('別案の版には、残した良さ・変えた点・ひとことの理由が入り、発言をそのまま貼らない', async () => {
    const { actor, a, tick } = await setup();
    const target = actor.session.lowerSlots[1]!;
    actor.receiveCommand(a.conn, cmd('SUBMIT_UTTERANCE', { text: 'うーん、なんか違うな', source: 'text', targetInstanceId: target }));
    await tick(10);
    const idea = actor.session.ideaOf(target)!;
    const rev = idea.revisions.at(-1)!;
    expect(rev.keepStrengths.length).toBeGreaterThan(0);
    expect(rev.improvementPoints.length).toBeGreaterThan(0);
    expect(rev.reason).toMatch(/^迷いを受けて：/);
    expect(rev.reason).not.toContain('なんか違うな');
  });

  it('「〇〇、いいね！」は質問として答えず、字幕の札も「いいね」。「うーん」の札は「迷い」', async () => {
    const { actor, ai, a, tick } = await setup();
    const [x, y] = actor.session.lowerSlots as string[];
    actor.receiveCommand(a.conn, cmd('SUBMIT_UTTERANCE', { text: 'これいいね！高齢者も使える', source: 'text', targetInstanceId: x! }));
    actor.receiveCommand(a.conn, cmd('SUBMIT_UTTERANCE', { text: 'うーん、なんか違うかも', source: 'text', targetInstanceId: y! }));
    await tick(10);
    const intents = events(a.received)
      .filter((e) => e.type === 'JUDGE_UTTERANCE_RECEIVED')
      .map((e) => e.detail.intent);
    expect(intents).toEqual(['positive', 'hesitation']);
    expect(ai.answerCalls).toHaveLength(0);
  });
});
