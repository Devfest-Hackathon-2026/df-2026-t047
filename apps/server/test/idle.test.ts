import { describe, expect, it } from 'vitest';
import { DEFAULT_ROTATION_POLICY } from '../src/domain/attention.ts';
import { CAMP_VERSION, type CommandMessage, type EventMessage } from '@idea-audition/protocol';
import { SessionActor } from '../src/application/session-actor.ts';
import { MemorySessionStore } from '../src/infrastructure/persistence/memory-store.ts';
import { StubAi, fakeConnection, manualScheduler, seqIds } from './helpers.ts';

describe('誰も接続していない間は AI を使わない', () => {
  it('全員が抜けたら入れ替え・作り置きを止め、戻ったら再開する', async () => {
    const { scheduler, advance } = manualScheduler();
    let t = 1_700_000_000_000;
    const tick = async (ms: number) => {
      for (let i = 0; i < ms / 500; i++) {
        t += 500;
        await advance(500);
      }
    };
    const ai = new StubAi();
    const actor = await SessionActor.open('idle', {
      ai,
      store: new MemorySessionStore(),
      scheduler,
      clock: { now: () => t },
      ids: seqIds(),
      config: {
        stockTarget: 3, lowerSlotCount: 5,
        critiqueIntervalMs: 10,
        persistDelayMs: 10,
        consensus: { afterUtteranceMs: 500, afterDecisionMs: 500, flushAfterUtterances: 3 },
        rotation: {
          checkMs: 500,
          warningMs: 2_000,
          minGapMs: 3_000,
          maxConcurrentLeaving: 2,
          policy: { ...DEFAULT_ROTATION_POLICY, minStageMs: 5_000, baseIdleMs: 3_000 },
        },
      },
    });
    const a = fakeConnection('a');
    actor.attach(a.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'idle' });
    actor.receiveCommand(a.conn, {
      camp: CAMP_VERSION, kind: 'command', type: 'START_AUDITION', commandId: 'c1', sentAt: '', payload: { theme: 't', mode: 'solo' },
    } as CommandMessage);
    await tick(20_000);
    const archivedWhileHere = a.received.filter((m) => m.kind === 'event' && m.type === 'CANDIDATE_ARCHIVED').length;
    expect(archivedWhileHere).toBeGreaterThan(0); // いる間は入れ替わる

    // 全員が抜ける
    actor.detach(a.conn);
    const callsAtLeave = ai.generateCalls.length + ai.refineCalls.length + ai.consensusCalls.length;
    await tick(10 * 60_000); // 10分たっても
    expect(ai.generateCalls.length + ai.refineCalls.length + ai.consensusCalls.length).toBe(callsAtLeave);
    expect(actor.session.leavingCandidates()).toEqual([]);

    // 戻ってきたら再開する
    const b = fakeConnection('b');
    actor.attach(b.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'idle' });
    await tick(20_000);
    const events = b.received.filter((m): m is EventMessage => m.kind === 'event');
    expect(events.some((e) => e.type === 'CANDIDATE_ARCHIVED')).toBe(true);
    expect(ai.generateCalls.length).toBeGreaterThan(0);
  });
});
