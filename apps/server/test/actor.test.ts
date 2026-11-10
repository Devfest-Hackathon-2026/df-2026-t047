import { describe, expect, it } from 'vitest';
import { CAMP_VERSION, type CommandMessage, type EventMessage, type ServerMessage } from '@idea-audition/protocol';
import { SessionActor } from '../src/application/session-actor.ts';
import { MemorySessionStore } from '../src/infrastructure/persistence/memory-store.ts';
import { StubAi, fakeClock, fakeConnection, manualScheduler, seqIds } from './helpers.ts';

let cid = 0;
function cmd<T extends CommandMessage['type']>(type: T, payload: Extract<CommandMessage, { type: T }>['payload']) {
  return { camp: CAMP_VERSION, kind: 'command', type, commandId: `c${++cid}`, sentAt: '', payload } as CommandMessage;
}
const events = (msgs: ServerMessage[]) => msgs.filter((m): m is EventMessage => m.kind === 'event');
const results = (msgs: ServerMessage[]) => msgs.filter((m) => m.kind === 'result');

async function setup() {
  const { scheduler, advance } = manualScheduler();
  const ai = new StubAi();
  const actor = new SessionActor('demo', {
    ai,
    store: new MemorySessionStore(),
    scheduler,
    clock: fakeClock(),
    ids: seqIds(),
    config: { stockTarget: 3, lowerSlotCount: 5, rotation: null, critiqueIntervalMs: 1000, persistDelayMs: 50, consensus: null },
  });
  const a = fakeConnection('a');
  const b = fakeConnection('b');
  actor.attach(a.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'demo' });
  actor.attach(b.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'demo' });
  actor.receiveCommand(a.conn, cmd('START_AUDITION', { theme: '大学の学食', mode: 'team' }));
  await advance(0);
  return { actor, ai, a, b, advance };
}

describe('SessionActor', () => {
  it('開始後、両方の接続に同じ下段5体が届く', async () => {
    const { a, b } = await setup();
    const lastA = events(a.received).at(-1)!.snapshot;
    const lastB = events(b.received).at(-1)!.snapshot;
    expect(lastA.lowerSlots.filter(Boolean)).toHaveLength(5);
    expect(lastA).toEqual(lastB);
  });

  it('2人が同じキャラを同時に昇格しようとしても、確定は1回だけ（AC-31）', async () => {
    const { actor, a, b } = await setup();
    const target = actor.session.lowerSlots[0]!;
    actor.receiveCommand(a.conn, cmd('REQUEST_PROMOTION', { instanceId: target }));
    actor.receiveCommand(b.conn, cmd('REQUEST_PROMOTION', { instanceId: target }));
    const ra = results(a.received).at(-1)!;
    const rb = results(b.received).at(-1)!;
    expect(ra).toMatchObject({ ok: true });
    expect(rb).toMatchObject({ ok: false, reason: 'NOT_IN_LOWER' });
    const confirmed = events(a.received).filter((e) => e.type === 'PROMOTION_CONFIRMED');
    expect(confirmed).toHaveLength(1);
  });

  it('同じ commandId の再送は再実行せず同じ結果を返す', async () => {
    const { actor, a } = await setup();
    const c = cmd('REQUEST_PROMOTION', { instanceId: actor.session.lowerSlots[0]! });
    actor.receiveCommand(a.conn, c);
    actor.receiveCommand(a.conn, c);
    const rs = results(a.received).filter((r) => r.kind === 'result' && r.commandId === c.commandId);
    expect(rs).toHaveLength(2);
    expect(rs[0]).toEqual(rs[1]);
    expect(actor.session.upper).toHaveLength(1);
  });

  it('昇格すると改良版が公開され、元の版も残る（AC-20, AC-23）', async () => {
    const { actor, a, advance } = await setup();
    const target = actor.session.lowerSlots[0]!;
    actor.receiveCommand(a.conn, cmd('REQUEST_PROMOTION', { instanceId: target }));
    await advance(100);
    const published = events(a.received).filter((e) => e.type === 'FINALIST_VERSION_PUBLISHED');
    expect(published).toHaveLength(1);
    const snap = events(a.received).at(-1)!.snapshot;
    const idea = snap.ideas[snap.characters[target]!.ideaId]!;
    expect(idea.revisions.map((r) => r.version)).toEqual([1, 2]);
    expect(snap.upper[0]!.status).toBe('ready');
  });

  it('2体目の加入で相互批評が2ラウンド順に出て、その後に両方の改良版が出る（AC-27）', async () => {
    const { actor, a, ai, advance } = await setup();
    actor.receiveCommand(a.conn, cmd('REQUEST_PROMOTION', { instanceId: actor.session.lowerSlots[0]! }));
    await advance(100);
    actor.receiveCommand(a.conn, cmd('REQUEST_PROMOTION', { instanceId: actor.session.lowerSlots[0]! }));
    await advance(100);
    expect(ai.refineCalls.at(-1)).toMatchObject({ trigger: 'arrival', rounds: 2 });
    const types = () => events(a.received).map((e) => e.type);
    const countOf = (t: string) => types().filter((x) => x === t).length;
    expect(countOf('FINALIST_CRITIQUE_POSTED')).toBe(1);
    await advance(1000);
    expect(countOf('FINALIST_CRITIQUE_POSTED')).toBe(2);
    expect(countOf('FINALIST_VERSION_PUBLISHED')).toBe(1);
    await advance(1000);
    expect(countOf('FINALIST_VERSION_PUBLISHED')).toBe(3);
  });

  it('観覧者（5人目）の操作は SPECTATOR で拒否', async () => {
    const { actor } = await setup();
    const extra = ['c', 'd', 'e'].map((id) => fakeConnection(id));
    for (const x of extra) actor.attach(x.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'demo' });
    const fifth = extra[2]!;
    const welcome = fifth.received.find((m) => m.kind === 'welcome');
    expect(welcome).toMatchObject({ participantId: null });
    actor.receiveCommand(fifth.conn, cmd('NEXT_IDEA', {}));
    expect(results(fifth.received).at(-1)).toMatchObject({ ok: false, reason: 'SPECTATOR' });
  });

  it('質問は回答を返すだけで、案を変更しない（AC-14）', async () => {
    const { actor, a, advance } = await setup();
    const target = actor.session.lowerSlots[0]!;
    actor.receiveCommand(a.conn, cmd('ASK_CANDIDATE', { instanceId: target, text: '費用は？' }));
    await advance(10);
    const snap = events(a.received).at(-1)!.snapshot;
    expect(snap.answers.at(-1)).toMatchObject({ question: '費用は？', answer: '回答:費用は？' });
    expect(snap.ideas[snap.characters[target]!.ideaId]!.revisions).toHaveLength(1);
  });

  it('決勝の案に「〜を足して。〜は？」と言うと、改良もし、質問にも答える（プレイテスト P0-4）', async () => {
    const { actor, ai, a, advance } = await setup();
    const target = actor.session.lowerSlots[0]!;
    actor.receiveCommand(a.conn, cmd('REQUEST_PROMOTION', { instanceId: target }));
    await advance(3000);
    const before = ai.refineCalls.length;
    const name = actor.session.characters.get(target)!;
    actor.receiveCommand(a.conn, cmd('SUBMIT_UTTERANCE', { text: '毎週通いたくなる仕掛けを足して。収益はどうやって出す？', source: 'text', targetInstanceId: target }));
    await advance(3000);
    expect(ai.refineCalls.length).toBeGreaterThan(before);
    expect(ai.answerCalls.at(-1)).toContain('収益はどうやって出す？');
    expect(name.location).toBe('upper');
  });

  it('決勝の案への質問だけなら、答えるだけで改良しない', async () => {
    const { actor, ai, a, advance } = await setup();
    const target = actor.session.lowerSlots[0]!;
    actor.receiveCommand(a.conn, cmd('REQUEST_PROMOTION', { instanceId: target }));
    await advance(3000);
    const before = ai.refineCalls.length;
    actor.receiveCommand(a.conn, cmd('SUBMIT_UTTERANCE', { text: '収益はどうやって出すの？', source: 'text', targetInstanceId: target }));
    await advance(3000);
    expect(ai.refineCalls.length).toBe(before);
    expect(ai.answerCalls.at(-1)).toBe('収益はどうやって出すの？');
  });

  it('オーディションを始めるのはホストだけ（ロビーでほかの人はホストの入力を見ている）', async () => {
    const { scheduler } = manualScheduler();
    const actor = new SessionActor('lobby', {
      ai: new StubAi(),
      store: new MemorySessionStore(),
      scheduler,
      clock: fakeClock(),
      ids: seqIds(),
      config: { stockTarget: 3, lowerSlotCount: 5, rotation: null, critiqueIntervalMs: 1000, persistDelayMs: 50, consensus: null },
    });
    const host = fakeConnection('h');
    const guest = fakeConnection('g');
    actor.attach(host.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'lobby' });
    actor.attach(guest.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'lobby' });
    actor.receiveCommand(guest.conn, cmd('START_AUDITION', { theme: '学食', mode: 'team' }));
    expect(results(guest.received).at(-1)).toMatchObject({ ok: false, reason: 'NOT_HOST' });
    actor.receiveCommand(host.conn, cmd('START_AUDITION', { theme: '学食', mode: 'team' }));
    expect(results(host.received).at(-1)).toMatchObject({ ok: true });
  });

  it('審査員は名前を入れられ、全員の画面に名前で出る（席の記号は A〜D のまま）', async () => {
    const { actor, a, b, advance } = await setup();
    actor.receiveCommand(a.conn, cmd('SET_JUDGE_NAME', { name: '  ゆうと ' }));
    await advance(0);
    const ev = events(b.received).find((e) => e.type === 'JUDGE_RENAMED')!;
    const me = ev.snapshot.judges.find((j) => j.judgeId === ev.detail.judgeId)!;
    expect(me).toMatchObject({ label: 'ゆうと', name: 'ゆうと', letter: 'A' });
    // 名前を入れていない人は「審査員 B」のまま
    expect(ev.snapshot.judges.find((j) => j.judgeId !== ev.detail.judgeId)).toMatchObject({ label: '審査員 B', name: null, letter: 'B' });
    // 空の名前は断る
    actor.receiveCommand(a.conn, cmd('SET_JUDGE_NAME', { name: '   ' }));
    expect(results(a.received).at(-1)).toMatchObject({ ok: false, reason: 'INVALID_PAYLOAD' });
  });

  it('意味が通らない質問（聞き間違い）は記録に残さず、キャラが聞き直す', async () => {
    const { actor, a, advance } = await setup();
    const target = actor.session.lowerSlots[0]!;
    actor.receiveCommand(a.conn, cmd('ASK_CANDIDATE', { instanceId: target, text: '学食もにゃもにゃ分だけの？' }));
    await advance(10);
    const misheard = events(a.received).find((e) => e.type === 'CANDIDATE_ANSWERED' && e.detail.misheard === true)!;
    expect(misheard.detail).toMatchObject({ instanceId: target, pending: false });
    expect(misheard.snapshot.answers).toHaveLength(0);
    expect(actor.session.answers).toHaveLength(0);
  });

  it('宛先の無い質問は、いま見ているキャラに向ける', async () => {
    const { actor, ai, a, advance } = await setup();
    const target = actor.session.lowerSlots[1]!;
    actor.receiveEphemeral(a.conn, { camp: CAMP_VERSION, kind: 'ephemeral', type: 'FOCUS_CHANGED', payload: { hover: target, detail: null } });
    actor.receiveCommand(a.conn, cmd('SUBMIT_UTTERANCE', { text: '費用はどれくらい？', source: 'text' }));
    await advance(10);
    expect(ai.answerCalls.at(-1)).toBe('費用はどれくらい？');
    expect(actor.session.answers.at(-1)?.instanceId).toBe(target);
  });
});

describe('観覧者の通話（聞くだけ）', () => {
  it('5人目は通話の受け渡しだけ中継され、抜けたら通話を抜けたと伝わる', async () => {
    const { actor, a } = await setup();
    const c = fakeConnection('c');
    const d = fakeConnection('d');
    const e = fakeConnection('e');
    for (const x of [c, d, e]) actor.attach(x.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'demo' });
    const eph = (msgs: ServerMessage[]) => msgs.filter((m) => m.kind === 'ephemeral');
    // 観覧者のカーソルは中継しない
    actor.receiveEphemeral(e.conn, { camp: CAMP_VERSION, kind: 'ephemeral', type: 'CURSOR_MOVED', payload: { x: 0.5, y: 0.5 } });
    expect(eph(a.received)).toHaveLength(0);
    // 通話用の ID を名乗ってから、受け渡しを送る
    actor.receiveEphemeral(e.conn, { camp: CAMP_VERSION, kind: 'ephemeral', type: 'CALL_STATE', payload: { on: true, as: 'spec_abc123' } });
    actor.receiveEphemeral(e.conn, { camp: CAMP_VERSION, kind: 'ephemeral', type: 'RTC_SIGNAL', payload: { to: 'x', kind: 'answer', sdp: 'v=0' } });
    expect(eph(a.received).map((m) => [m.type, m.senderId])).toEqual([
      ['CALL_STATE', 'spec_abc123'],
      ['RTC_SIGNAL', 'spec_abc123'],
    ]);
    actor.detach(e.conn);
    expect(eph(a.received).at(-1)).toMatchObject({ type: 'CALL_STATE', senderId: 'spec_abc123', payload: { on: false } });
  });
});

describe('最終オーディションのスポットライト', () => {
  it('タップしたキャラにみんなで注目し、名前を呼ばない質問はそのキャラに届く', async () => {
    const { actor, a, b, advance } = await setup();
    const ids = [0, 1, 2].map(() => {
      const id = actor.session.lowerSlots.find((x) => x !== null)!;
      actor.receiveCommand(a.conn, cmd('REQUEST_PROMOTION', { instanceId: id }));
      return id;
    });
    actor.receiveCommand(a.conn, cmd('SET_SPOTLIGHT', { instanceId: ids[1]! }));
    const ev = events(b.received).at(-1)!;
    expect(ev.type).toBe('SPOTLIGHT_CHANGED');
    expect(ev.snapshot.spotlight).toMatchObject({ instanceId: ids[1] });
    const judgeB = actor.session.judges[1]!.judgeId;
    actor.receiveUtterance(judgeB, '実際にやるとしたら、費用はどのくらいかかるの？', 'text', null);
    await advance(0);
    expect(actor.session.answers.at(-1)?.instanceId).toBe(ids[1]);
    // 解除すると届かない（名前も詳細もないので質問の宛先が無い）
    actor.receiveCommand(a.conn, cmd('SET_SPOTLIGHT', { instanceId: null }));
    expect(events(a.received).at(-1)!.snapshot.spotlight).toBeNull();
  });

  it('決勝にいないキャラにはスポットライトを当てられない', async () => {
    const { actor, a } = await setup();
    actor.receiveCommand(a.conn, cmd('SET_SPOTLIGHT', { instanceId: actor.session.lowerSlots[0]! }));
    expect(results(a.received).at(-1)).toMatchObject({ ok: false });
  });
});

describe('発言の二重送信', () => {
  it('同じ人の同じ発言が続けて届いても、1回だけ扱う', async () => {
    const { scheduler, advance } = manualScheduler();
    const t = 1_700_000_000_000;
    const actor = new SessionActor('dup', {
      ai: new StubAi(),
      store: new MemorySessionStore(),
      scheduler,
      clock: { now: () => t },
      ids: seqIds(),
      config: { stockTarget: 3, lowerSlotCount: 5, rotation: null, critiqueIntervalMs: 1000, persistDelayMs: 50, consensus: null },
    });
    const a = fakeConnection('a');
    actor.attach(a.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'dup' });
    actor.receiveCommand(a.conn, cmd('START_AUDITION', { theme: '大学の学食', mode: 'team' }));
    await advance(0);
    const judgeId = actor.session.judges[0]!.judgeId;
    actor.receiveUtterance(judgeId, 'それって費用はどのくらい？', 'text', null);
    actor.receiveUtterance(judgeId, 'それって費用はどのくらい？', 'text', null);
    expect(events(a.received).filter((e) => e.type === 'JUDGE_UTTERANCE_RECEIVED')).toHaveLength(1);
  });
});

describe('リビジョンの巻き戻し（Issue #8 [B4]）', () => {
  it('REVERT_IDEA_REVISION コマンドで指定版に巻き戻され CHARACTER_REVISED が配信される', async () => {
    const { actor, a, b, advance } = await setup();
    const id = actor.session.lowerSlots[0]!;
    actor.receiveCommand(a.conn, cmd('REQUEST_PROMOTION', { instanceId: id }));
    await advance(0);
    const idea = actor.session.ideaOf(id)!;
    const v1Title = idea.revisions[0]!.title;

    // v2 に改良
    actor.session.publishRevision(id, idea.revisions[0]!.revisionId, {
      title: `${v1Title} 改`,
      summary: '改良後サマリー',
      keepStrengths: ['強み'],
      improvementPoints: ['改善'],
      reason: 'ユーザー要望',
    });
    expect(actor.session.ideaOf(id)!.revisions).toHaveLength(2);

    // REVERT_IDEA_REVISION コマンド送信
    actor.receiveCommand(a.conn, cmd('REVERT_IDEA_REVISION', { characterId: id, targetVersion: 1 }));
    await advance(0);

    const res = results(a.received).at(-1)!;
    expect(res).toMatchObject({ ok: true });

    // CANDIDATE_REVISED イベントが両方に配信されている
    const revisedA = events(a.received).filter((e) => e.type === 'CANDIDATE_REVISED');
    const revisedB = events(b.received).filter((e) => e.type === 'CANDIDATE_REVISED');
    expect(revisedA.length).toBeGreaterThan(0);
    expect(revisedB.length).toBeGreaterThan(0);

    // v3 が作られ、内容は v1 のタイトルと「v1 に巻き戻し」の reason を持つ
    const latest = actor.session.ideaOf(id)!.revisions.at(-1)!;
    expect(latest.version).toBe(3);
    expect(latest.title).toBe(v1Title);
    expect(latest.reason).toBe('v1 に巻き戻し');
  });
});
