import { describe, expect, it } from 'vitest';
import { CHARACTER_DESIGNS, CAMP_VERSION, type CommandMessage, type EventMessage, type EphemeralMessage } from '@idea-audition/protocol';
import {
  DEFAULT_ROTATION_POLICY,
  addAttention,
  detectMention,
  newAttention,
  pickExitCandidate,
  type ExitCandidate,
} from '../src/domain/attention.ts';
import { SessionActor } from '../src/application/session-actor.ts';
import { MemorySessionStore } from '../src/infrastructure/persistence/memory-store.ts';
import { StubAi, fakeConnection, manualScheduler, seqIds } from './helpers.ts';

const policy = { ...DEFAULT_ROTATION_POLICY, minStageMs: 10_000, baseIdleMs: 5_000, idlePerScoreMs: 2_000, maxIdleMs: 20_000 };

describe('会話での言及の検出', () => {
  const luna = { name: 'LUNA', readings: ['ルナ', 'るな'], title: '学食ガチャ' };
  it('名前（英字・カタカナ・ひらがな）を検出する', () => {
    expect(detectMention('ルナの案いいね', luna, '大学の学食')).toBe('name');
    expect(detectMention('るなさん', luna, '大学の学食')).toBe('name');
    expect(detectMention('luna推し', luna, '大学の学食')).toBe('name');
  });
  it('企画名の一部（3文字以上）を検出し、テーマの語やひらがなだけの部分は数えない', () => {
    expect(detectMention('ガチャのやつ面白い', luna, '大学の学食')).toBe('title');
    expect(detectMention('がちゃって楽しそう', luna, '大学の学食')).toBe('title');
    expect(detectMention('学食いいよね', luna, '大学の学食をもっと楽しく')).toBeNull();
    expect(detectMention('食べたい', { ...luna, title: 'ひとりでも食べたい' }, 'テーマ')).toBeNull();
    expect(detectMention('学食がいいね', luna, '大学の学食')).toBeNull();
    expect(detectMention('AR食堂の案', { ...luna, title: 'AR食堂ツアー' }, '大学の学食')).toBe('title');
  });
});

describe('退場させる案の選び方', () => {
  const now = 100_000;
  const c = (id: string, spawnedAgo: number, touchedAgo: number, score = 0): ExitCandidate => ({
    instanceId: id,
    spawnedAt: now - spawnedAgo,
    attention: { score, scoredAt: now, lastTouchAt: now - touchedAgo, mentions: 0 },
  });

  it('しばらく触れられていない案のうち、注目度が最も低い案を選ぶ', () => {
    const picked = pickExitCandidate([c('a', 60_000, 30_000, 3), c('b', 60_000, 30_000, 1), c('c', 60_000, 30_000, 2)], now, new Set(), policy);
    expect(picked).toBe('b');
  });

  it('登場したばかり・最近触れられた・保護中の案は選ばない', () => {
    expect(pickExitCandidate([c('new', 5_000, 5_000)], now, new Set(), policy)).toBeNull();
    expect(pickExitCandidate([c('touched', 60_000, 2_000)], now, new Set(), policy)).toBeNull();
    expect(pickExitCandidate([c('seen', 60_000, 30_000)], now, new Set(['seen']), policy)).toBeNull();
  });

  it('注目度が高いほど退場までの猶予が延びる', () => {
    // 触れられてから8秒：注目度0なら猶予5秒で候補、注目度3なら猶予11秒でまだ候補ではない
    expect(pickExitCandidate([c('cold', 60_000, 8_000, 0)], now, new Set(), policy)).toBe('cold');
    expect(pickExitCandidate([c('hot', 60_000, 8_000, 3)], now, new Set(), policy)).toBeNull();
  });

  it('注目度は時間とともに半減する', () => {
    const a = addAttention(newAttention(0), 'mentionName', 0, policy);
    expect(a.score).toBe(6);
    expect(a.mentions).toBe(1);
    const later = addAttention(a, 'hover', policy.halfLifeMs, policy);
    expect(later.score).toBeCloseTo(3 + 1);
  });
});

describe('アクターの入れ替え', () => {
  let cid = 0;
  const cmd = (type: CommandMessage['type'], payload: object) =>
    ({ camp: CAMP_VERSION, kind: 'command', type, commandId: `a${++cid}`, sentAt: '', payload }) as CommandMessage;
  const eph = (type: EphemeralMessage['type'], payload: object) => ({ camp: CAMP_VERSION, kind: 'ephemeral', type, payload }) as EphemeralMessage;

  async function setup() {
    const { scheduler, advance } = manualScheduler();
    let t = 1_700_000_000_000;
    const clock = { now: () => t };
    const tick = async (ms: number) => {
      for (let i = 0; i < ms / 500; i++) {
        t += 500;
        await advance(500);
      }
    };
    const actor = await SessionActor.open('r', {
      ai: new StubAi(),
      store: new MemorySessionStore(),
      scheduler,
      clock,
      ids: seqIds(),
      config: {
        stockTarget: 3, lowerSlotCount: 1,
        critiqueIntervalMs: 10,
        persistDelayMs: 10, consensus: null,
        rotation: { checkMs: 500, warningMs: 2_000, minGapMs: 3_000, maxConcurrentLeaving: 1, policy },
      },
    });
    const a = fakeConnection('a');
    actor.attach(a.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'r' });
    actor.receiveCommand(a.conn, cmd('START_AUDITION', { theme: 'テーマ', mode: 'team' }));
    await advance(0);
    const events = () => a.received.filter((m): m is EventMessage => m.kind === 'event');
    const judgeId = actor.session.judges[0]!.judgeId;
    return { actor, a, tick, events, judgeId };
  }

  const join = (actor: SessionActor, name: string) => {
    const c = fakeConnection(name);
    actor.attach(c.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'r' });
    return c;
  };
  const buzz = (actor: SessionActor, conn: ReturnType<typeof fakeConnection>, on = true) =>
    actor.receiveCommand(conn.conn, cmd('PRESS_BUZZER', { instanceId: actor.session.lowerSlots[0]!, on }));

  it('1人ずつ登場し、持ち時間が過ぎたら次の人と交代して Idea BOX に入る', async () => {
    const { actor, tick, events } = await setup();
    expect(actor.session.lowerSlots).toHaveLength(1);
    const first = actor.session.lowerSlots[0]!;
    expect(first).toBeTruthy();
    await tick(1_000);
    expect(events().find((e) => e.type === 'CANDIDATE_LEAVING')?.detail.instanceId).toBe(first);
    await tick(2_500);
    expect(events().some((e) => e.type === 'CANDIDATE_ARCHIVED' && e.detail.instanceId === first)).toBe(true);
    expect(actor.session.ideaBox.map((x) => x.instanceId)).toContain(first);
    expect(actor.session.lowerSlots[0]).not.toBe(first);
    expect(actor.session.lowerSlots[0]).toBeTruthy();
  });

  it('キャラから外れれば、止めたときの残りからカウントが進む（外した瞬間には交代しない）', async () => {
    const { actor, a, tick } = await setup();
    const first = actor.session.lowerSlots[0]!;
    await tick(1_500); // 残り約0.5秒
    actor.receiveEphemeral(a.conn, eph('FOCUS_CHANGED', { hover: first, detail: null }));
    expect(actor.session.characters.get(first)!.pausedLeftMs).not.toBeNull();
    actor.receiveEphemeral(a.conn, eph('FOCUS_CHANGED', { hover: null, detail: null }));
    await tick(2_000);
    expect(actor.session.characters.get(first)!.location).toBe('lower');
    await tick(2_500);
    expect(actor.session.characters.get(first)!.location).toBe('archived');
  });

  it('ゴールデンブザー：全員が押したら合格者待機室へ。1人だけでは上がらない', async () => {
    const { actor, a, events } = await setup();
    const b = join(actor, 'b');
    const first = actor.session.lowerSlots[0]!;
    buzz(actor, a);
    expect(actor.session.characters.get(first)!.location).toBe('lower');
    expect(events().at(-1)).toMatchObject({ type: 'BUZZER_PRESSED', snapshot: { buzzer: { instanceId: first } } });
    expect((events().at(-1)!.snapshot.buzzer!.judgeIds as string[]).length).toBe(1);
    buzz(actor, b);
    expect(actor.session.characters.get(first)!.location).toBe('upper');
    expect(actor.session.upper.map((f) => f.instanceId)).toEqual([first]);
    // 次の挑戦者が登場し、ブザーはまっさらに戻る
    expect(actor.session.lowerSlots[0]).not.toBe(first);
    expect(actor.session.buzzers.size).toBe(0);
  });

  it('ブザーは取り消せる', async () => {
    const { actor, a } = await setup();
    const b = join(actor, 'b');
    const first = actor.session.lowerSlots[0]!;
    buzz(actor, a);
    buzz(actor, a, false);
    buzz(actor, b);
    expect(actor.session.characters.get(first)!.location).toBe('lower');
    expect([...actor.session.buzzers]).toHaveLength(1);
  });

  it('押していない人が抜けたら、残りの全員が押していればその場で合格', async () => {
    const { actor, a } = await setup();
    const b = join(actor, 'b');
    const first = actor.session.lowerSlots[0]!;
    buzz(actor, a);
    actor.detach(b.conn);
    expect(actor.session.characters.get(first)!.location).toBe('upper');
  });

  it('深掘りタイム：質問すると交代のカウントが止まり、話し終わると止めたときの残りから再開する', async () => {
    const { actor, a, tick, events } = await setup();
    const first = actor.session.lowerSlots[0]!;
    await tick(1_000);
    actor.receiveCommand(a.conn, cmd('ASK_CANDIDATE', { instanceId: first, text: '費用はどのくらい？' }));
    await tick(1_000);
    expect(events().some((e) => e.type === 'CHALLENGE_PAUSED')).toBe(true);
    expect(events().at(-1)!.snapshot.characters[first]!.paused).toBe(true);
    // 持ち時間（2秒）を大きく過ぎても、議論の間は交代しない
    await tick(6_000);
    expect(actor.session.lowerSlots[0]).toBe(first);
    await tick(4_000);
    const resumed = events().find((e) => e.type === 'CHALLENGE_RESUMED');
    expect(resumed).toBeDefined();
    expect(actor.session.lowerSlots[0]).toBe(first);
  });

  it('深掘りタイム：キャラにカーソルを乗せるとすぐ止まる（残りわずかでも）', async () => {
    const { actor, a, tick } = await setup();
    const first = actor.session.lowerSlots[0]!;
    await tick(500);
    actor.receiveEphemeral(a.conn, eph('FOCUS_CHANGED', { hover: first, detail: null }));
    await tick(8_000);
    expect(actor.session.lowerSlots[0]).toBe(first);
    expect(actor.session.characters.get(first)!.pausedLeftMs).not.toBeNull();
    actor.receiveEphemeral(a.conn, eph('FOCUS_CHANGED', { hover: null, detail: null }));
    await tick(1_000);
    expect(actor.session.characters.get(first)!.pausedLeftMs ?? null).toBeNull();
  });

  it('3人合格したら、新しい挑戦者は出ない（最終オーディションへ）', async () => {
    const { actor, a } = await setup();
    for (let i = 0; i < 3; i++) buzz(actor, a);
    expect(actor.session.upper).toHaveLength(3);
    expect(actor.session.lowerSlots[0]).toBeNull();
  });
});

describe('見送り（審査員がこの案はないと判断）', () => {
  let cid = 0;
  const cmd = (type: CommandMessage['type'], payload: object) =>
    ({ camp: CAMP_VERSION, kind: 'command', type, commandId: `j${++cid}`, sentAt: '', payload }) as CommandMessage;

  async function setup(rotation: { maxConcurrentLeaving: number } | null = null) {
    const { scheduler, advance } = manualScheduler();
    let t = 1_700_000_000_000;
    const actor = await SessionActor.open('j', {
      ai: new StubAi(),
      store: new MemorySessionStore(),
      scheduler,
      clock: { now: () => t },
      ids: seqIds(),
      config: {
        stockTarget: 3, lowerSlotCount: 5,
        critiqueIntervalMs: 10,
        persistDelayMs: 10, consensus: null,
        rotation: rotation ? { checkMs: 500, warningMs: 10_000, minGapMs: 3_000, ...rotation, policy } : null,
      },
    });
    const a = fakeConnection('a');
    actor.attach(a.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'j' });
    actor.receiveCommand(a.conn, cmd('START_AUDITION', { theme: 'テーマ', mode: 'team' }));
    await advance(0);
    const tick = async (ms: number) => {
      for (let i = 0; i < ms / 500; i++) {
        t += 500;
        await advance(500);
      }
    };
    const events = () => a.received.filter((m): m is EventMessage => m.kind === 'event');
    return { actor, a, events, tick, judgeId: actor.session.judges[0]!.judgeId };
  }
  const reading = (actor: SessionActor, id: string) =>
    CHARACTER_DESIGNS[actor.session.characters.get(id)!.designId]!.readings[0]!;

  it('ボタンの見送りで、すぐ退場して Idea BOX に「見送り」で入り、次のキャラが入る', async () => {
    const { actor, a, events } = await setup();
    const target = actor.session.lowerSlots[2]!;
    actor.receiveCommand(a.conn, cmd('REJECT_CANDIDATE', { instanceId: target }));
    const archived = events().find((e) => e.type === 'CANDIDATE_ARCHIVED')!;
    expect(archived.detail).toMatchObject({ instanceId: target, reason: 'rejected' });
    expect(archived.snapshot.ideaBox.at(-1)).toMatchObject({ reason: 'rejected' });
    expect(actor.session.lowerSlots[2]).not.toBe(target);
    expect(actor.session.lowerSlots[2]).not.toBeNull();
  });

  it('上段の案は見送れない', async () => {
    const { actor, a } = await setup();
    const id = actor.session.lowerSlots[0]!;
    actor.receiveCommand(a.conn, cmd('REQUEST_PROMOTION', { instanceId: id }));
    actor.receiveCommand(a.conn, cmd('REJECT_CANDIDATE', { instanceId: id }));
    expect(a.received.filter((m) => m.kind === 'result').at(-1)).toMatchObject({ ok: false, reason: 'NOT_IN_LOWER' });
  });

  it('「（名前）は却下」と言うと見送りになる', async () => {
    const { actor, events, judgeId } = await setup();
    const id = actor.session.lowerSlots[1]!;
    actor.receiveUtterance(judgeId, `${reading(actor, id)}は却下で`, 'live', null);
    expect(events().find((e) => e.type === 'JUDGE_UTTERANCE_RECEIVED')!.detail.intent).toBe('reject');
    expect(actor.session.characters.get(id)!.location).toBe('archived');
  });

  it('見送りの語を含んでも、意味が違う言い方では見送らない', async () => {
    const { actor, judgeId } = await setup();
    const id = actor.session.lowerSlots[1]!;
    const name = reading(actor, id);
    for (const text of [`${name}、キャンパス全体でやろう`, `${name}の案、人数が少ないなと思う理由は？`, `${name}は没入感がある`]) {
      actor.receiveUtterance(judgeId, text, 'live', null);
    }
    expect(actor.session.characters.get(id)!.location).toBe('lower');
  });

});
