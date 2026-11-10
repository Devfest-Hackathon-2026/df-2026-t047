import { describe, expect, it } from 'vitest';
import { CAMP_VERSION, type CommandMessage, type EventMessage, type WelcomeMessage } from '@idea-audition/protocol';
import { SessionActor } from '../src/application/session-actor.ts';
import { AuditionSession } from '../src/domain/session.ts';
import { MemorySessionStore } from '../src/infrastructure/persistence/memory-store.ts';
import { StubAi, drafts, fakeClock, fakeConnection, manualScheduler, seqIds } from './helpers.ts';

let cid = 0;
const cmd = (type: CommandMessage['type'], payload: object) =>
  ({ camp: CAMP_VERSION, kind: 'command', type, commandId: `p${++cid}`, sentAt: '', payload }) as CommandMessage;

function deps(store: MemorySessionStore) {
  const { scheduler, advance } = manualScheduler();
  return {
    advance,
    deps: {
      ai: new StubAi(),
      store,
      scheduler,
      clock: fakeClock(),
      ids: seqIds(),
      config: { stockTarget: 3, lowerSlotCount: 5, rotation: null, critiqueIntervalMs: 100, persistDelayMs: 50, consensus: null },
    },
  };
}

describe('セッションの保存と復元（ADR-0003）', () => {
  it('toState → fromState で同じ状態に戻る', () => {
    const s = new AuditionSession('s', { ids: seqIds(), clock: fakeClock(), lowerSlotCount: 5 });
    s.join();
    s.start('テーマ', 'team');
    s.addToStock(drafts(10));
    s.fillEmptySlots();
    s.promote(s.lowerSlots[0]!);
    const restored = AuditionSession.fromState('s', JSON.parse(JSON.stringify(s.toState())), {
      ids: seqIds(),
      clock: fakeClock(),
      lowerSlotCount: 5,
    });
    expect(restored.lowerSlots).toEqual(s.lowerSlots);
    expect(restored.upper.map((f) => f.instanceId)).toEqual(s.upper.map((f) => f.instanceId));
    expect(restored.upper.every((f) => f.status === 'ready')).toBe(true);
    expect([...restored.ideas.keys()]).toEqual([...s.ideas.keys()]);
    expect(restored.judges.every((j) => !j.connected && !j.isHost)).toBe(true);
  });

  it('確定イベントはまとめて保存され、再起動後に同じ状態・同じ審査員で再開できる', async () => {
    const store = new MemorySessionStore();
    const first = deps(store);
    const actor = await SessionActor.open('demo', first.deps);
    const a = fakeConnection('a');
    actor.attach(a.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'demo' });
    actor.receiveCommand(a.conn, cmd('START_AUDITION', { theme: '学食', mode: 'team' }));
    await first.advance(0);
    const target = actor.session.lowerSlots[0]!;
    actor.receiveCommand(a.conn, cmd('REQUEST_PROMOTION', { instanceId: target }));
    await first.advance(500);

    const saved = store.sessions.get('demo')!;
    const lastEvent = a.received.filter((m): m is EventMessage => m.kind === 'event').at(-1)!;
    expect(saved.seq).toBe(lastEvent.seq);
    expect(store.events.get('demo')!.map((e) => e.seq)).toEqual(
      Array.from({ length: lastEvent.seq }, (_, i) => i + 1),
    );
    const firstWelcome = a.received.find((m) => m.kind === 'welcome') as WelcomeMessage;
    const judgeId = firstWelcome.participantId!;
    const resumeToken = firstWelcome.resumeToken!;

    // サーバー再起動：新しいアクターを保存先から開く
    const second = deps(store);
    const reopened = await SessionActor.open('demo', second.deps);
    const b = fakeConnection('b');
    reopened.attach(b.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'demo', participantId: judgeId, resumeToken });
    const welcome = b.received.find((m) => m.kind === 'welcome') as WelcomeMessage;
    expect(welcome.participantId).toBe(judgeId);
    expect(welcome.snapshot.seq).toBe(lastEvent.seq);
    expect(welcome.snapshot.upper.map((f) => f.instanceId)).toEqual([target]);
    expect(welcome.snapshot.lowerSlots).toEqual(lastEvent.snapshot.lowerSlots);
    // 再接続した審査員がホストに戻る
    const events = b.received.filter((m): m is EventMessage => m.kind === 'event');
    expect(events.at(-1)!.snapshot.judges.find((j) => j.judgeId === judgeId)!.isHost).toBe(true);
    // 再開後も操作でき、seq は続きから振られる
    reopened.receiveCommand(b.conn, cmd('REQUEST_PROMOTION', { instanceId: reopened.session.lowerSlots[1]! }));
    const after = b.received.filter((m): m is EventMessage => m.kind === 'event');
    expect(after.at(-1)!.seq).toBeGreaterThan(lastEvent.seq);
  });

  it('保存に失敗してもイベントは失われず、次の保存で書かれる', async () => {
    const store = new MemorySessionStore();
    let failNext = true;
    const realCommit = store.commit.bind(store);
    store.commit = async (...args) => {
      if (failNext) {
        failNext = false;
        throw new Error('network');
      }
      return realCommit(...args);
    };
    const d = deps(store);
    const actor = await SessionActor.open('x', d.deps);
    const a = fakeConnection('a');
    actor.attach(a.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'x' });
    await d.advance(100);
    expect(store.sessions.has('x')).toBe(false);
    await d.advance(6000);
    expect(store.events.get('x')!.length).toBeGreaterThan(0);
  });

  it('サーバーが再起動しても、元のホストが戻ればホストに戻る（先に戻った人は一時的なホスト）', async () => {
    const s = new AuditionSession('s', { ids: seqIds(), clock: fakeClock(), lowerSlotCount: 5 });
    const host = s.join(undefined);
    const guest = s.join(undefined);
    if (!host.ok || !guest.ok) throw new Error('join failed');
    const restored = AuditionSession.fromState('s', JSON.parse(JSON.stringify(s.toState())), { ids: seqIds(), clock: fakeClock(), lowerSlotCount: 5 });
    restored.join(guest.value.judgeId!, guest.value.resumeToken!);
    expect(restored.judges.find((j) => j.judgeId === guest.value.judgeId)!.isHost).toBe(true);
    restored.join(host.value.judgeId!, host.value.resumeToken!);
    expect(restored.judges.find((j) => j.judgeId === host.value.judgeId)!.isHost).toBe(true);
    expect(restored.judges.filter((j) => j.isHost)).toHaveLength(1);
  });
});
