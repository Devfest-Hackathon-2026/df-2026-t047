import { describe, expect, it } from 'vitest';
import { CAMP_VERSION, type CommandMessage } from '@idea-audition/protocol';
import { DEFAULT_ROTATION_POLICY } from '../src/domain/attention.ts';
import { SessionActor } from '../src/application/session-actor.ts';
import { MemorySessionStore } from '../src/infrastructure/persistence/memory-store.ts';
import { StubAi, fakeConnection, manualScheduler, seqIds } from './helpers.ts';

let cid = 0;
const cmd = (type: CommandMessage['type'], payload: object) =>
  ({ camp: CAMP_VERSION, kind: 'command', type, commandId: `jc${++cid}`, sentAt: '', payload }) as CommandMessage;

/** 予選の操作（一時停止・持ち時間・決勝の人数・途中で決勝へ）。プレイテストの声から */
async function setup(start: object = {}) {
  const { scheduler, advance } = manualScheduler();
  let t = 1_700_000_000_000;
  const tick = async (ms: number) => {
    for (let i = 0; i < ms / 500; i++) {
      t += 500;
      await advance(500);
    }
  };
  const actor = await SessionActor.open('jc', {
    ai: new StubAi(),
    store: new MemorySessionStore(),
    scheduler,
    clock: { now: () => t },
    ids: seqIds(),
    config: {
      stockTarget: 3, lowerSlotCount: 1, critiqueIntervalMs: 10, persistDelayMs: 10, consensus: null,
      rotation: { checkMs: 500, warningMs: 2_000, minGapMs: 3_000, maxConcurrentLeaving: 1, policy: DEFAULT_ROTATION_POLICY },
    },
  });
  const host = fakeConnection('h');
  const guest = fakeConnection('g');
  actor.attach(host.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'jc' });
  actor.attach(guest.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'jc' });
  actor.receiveCommand(host.conn, cmd('START_AUDITION', { theme: 'テーマ', mode: 'team', ...start }));
  await advance(0);
  const challenger = () => actor.session.lowerSlots[0]!;
  const lastResult = (c: typeof host) => c.received.filter((m) => m.kind === 'result').at(-1)!;
  const passAll = () => {
    const id = challenger();
    actor.receiveCommand(host.conn, cmd('PRESS_BUZZER', { instanceId: id, on: true }));
    actor.receiveCommand(guest.conn, cmd('PRESS_BUZZER', { instanceId: id, on: true }));
  };
  return { actor, host, guest, tick, challenger, lastResult, passAll, advance };
}

describe('予選の操作', () => {
  it('ロビーで選んだ持ち時間で交代する', async () => {
    const { actor, tick, challenger } = await setup({ challengeSec: 30 });
    const first = challenger();
    await tick(1_000);
    expect(actor.session.challengeMs).toBe(30_000);
    await tick(20_000);
    expect(challenger()).toBe(first);
    await tick(11_000);
    expect(challenger()).not.toBe(first);
  });

  it('一時停止すると、深掘りが終わっても交代しない。再開すると止めたときの残りから数え直す', async () => {
    const { actor, guest, tick, challenger } = await setup();
    const first = challenger();
    await tick(1_000); // 持ち時間 2秒が始まる
    actor.receiveCommand(guest.conn, cmd('HOLD_CHALLENGE', { instanceId: first, on: true }));
    const c = actor.session.characters.get(first)!;
    expect(c.holdBy).toBeTruthy();
    expect(c.pausedLeftMs).not.toBeNull();
    await tick(10_000);
    expect(challenger()).toBe(first);
    actor.receiveCommand(guest.conn, cmd('HOLD_CHALLENGE', { instanceId: first, on: false }));
    expect(c.holdBy).toBeNull();
    expect(c.leavingAt).not.toBeNull();
    await tick(5_000);
    expect(challenger()).not.toBe(first);
  });

  it('一時停止した人が抜けたら、止めたままにしない', async () => {
    const { actor, guest, tick, challenger } = await setup();
    const first = challenger();
    await tick(1_000);
    actor.receiveCommand(guest.conn, cmd('HOLD_CHALLENGE', { instanceId: first, on: true }));
    actor.detach(guest.conn);
    await tick(8_000);
    expect(challenger()).not.toBe(first);
  });

  it('決勝の人数をロビーで選べる（2人そろったら決勝）', async () => {
    const { actor, passAll, advance } = await setup({ finalists: 2 });
    passAll();
    await advance(0);
    passAll();
    await advance(0);
    expect(actor.session.upper).toHaveLength(2);
    expect(actor.session.finalsReady).toBe(true);
    expect(actor.session.lowerSlots[0]).toBeNull(); // もう次の挑戦者は出ない
  });

  it('ホストは、合格者が足りなくても決勝に進められる。ホスト以外・合格者0人では進めない', async () => {
    const { actor, host, guest, passAll, advance, lastResult, challenger } = await setup();
    actor.receiveCommand(host.conn, cmd('END_PRELIMINARY', {}));
    expect(lastResult(host)).toMatchObject({ ok: false, reason: 'NOT_AUTHORIZED' });
    passAll();
    await advance(0);
    actor.receiveCommand(guest.conn, cmd('END_PRELIMINARY', {}));
    expect(lastResult(guest)).toMatchObject({ ok: false, reason: 'NOT_HOST' });
    const waiting = challenger();
    actor.receiveCommand(host.conn, cmd('END_PRELIMINARY', {}));
    expect(lastResult(host)).toMatchObject({ ok: true });
    expect(actor.session.finalistTarget).toBe(1);
    expect(actor.session.finalsReady).toBe(true);
    expect(actor.session.characters.get(waiting)!.location).toBe('archived');
    // 1人だけの決勝は、ホストがそのまま優勝に選べる
    actor.receiveCommand(host.conn, cmd('SELECT_CHAMPION', { instanceId: actor.session.upper[0]!.instanceId }));
    expect(actor.session.status).toBe('completed');
  });

  it('決勝の人数と持ち時間は保存され、再起動後も同じ', async () => {
    const { actor } = await setup({ finalists: 4, challengeSec: 90 });
    const state = actor.session.toState();
    expect(state.finalistTarget).toBe(4);
    expect(state.challengeMs).toBe(90_000);
  });
});

describe('退出ボタン', () => {
  it('退出した人は一覧から消え、ホストは次の人に移る。押していたブザーも消える', async () => {
    const { actor, host, guest, challenger } = await setup();
    const hostId = actor.session.judges.find((j) => j.isHost)!.judgeId;
    actor.receiveCommand(host.conn, cmd('PRESS_BUZZER', { instanceId: challenger(), on: true }));
    actor.receiveCommand(host.conn, cmd('LEAVE_SESSION', {}));
    expect(actor.session.judges.map((j) => j.judgeId)).not.toContain(hostId);
    expect(actor.session.judges).toHaveLength(1);
    expect(actor.session.judges[0]!.isHost).toBe(true);
    expect(actor.session.buzzers.has(hostId)).toBe(false);
    actor.detach(host.conn); // そのあと接続が切れても何も起きない
    expect(actor.session.judges).toHaveLength(1);
    expect(guest.received.some((m) => m.kind === 'event' && m.type === 'JUDGE_LEFT')).toBe(true);
  });

  it('切断（退出ボタンではない）は、戻ってこられるよう一覧に残す', async () => {
    const { actor, guest } = await setup();
    const guestId = actor.session.judges.find((j) => !j.isHost)!.judgeId;
    actor.detach(guest.conn);
    const g = actor.session.judges.find((j) => j.judgeId === guestId);
    expect(g?.connected).toBe(false);
  });
});
