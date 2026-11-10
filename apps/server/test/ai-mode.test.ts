import { describe, expect, it } from 'vitest';
import { CAMP_VERSION, type CommandMessage, type EventMessage } from '@idea-audition/protocol';
import { SessionActor } from '../src/application/session-actor.ts';
import { MemorySessionStore } from '../src/infrastructure/persistence/memory-store.ts';
import { StubAi, fakeClock, fakeConnection, manualScheduler, seqIds } from './helpers.ts';

let cid = 0;
const cmd = (type: CommandMessage['type'], payload: object) =>
  ({ camp: CAMP_VERSION, kind: 'command', type, commandId: `m${++cid}`, sentAt: '', payload }) as CommandMessage;

async function setup(aiMode?: 'gemini' | 'fixture') {
  const { scheduler, advance } = manualScheduler();
  const gemini = new StubAi('gemini');
  const fixture = new StubAi('fixture');
  const actor = await SessionActor.open('m', {
    ai: gemini,
    aiModes: { gemini, fixture },
    store: new MemorySessionStore(),
    scheduler,
    clock: fakeClock(),
    ids: seqIds(),
    config: { stockTarget: 3, lowerSlotCount: 5, critiqueIntervalMs: 10, persistDelayMs: 10, rotation: null, consensus: null },
  });
  const a = fakeConnection('a');
  const b = fakeConnection('b');
  actor.attach(a.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'm' });
  actor.attach(b.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'm' });
  actor.receiveCommand(a.conn, cmd('START_AUDITION', { theme: 't', mode: 'team', ...(aiMode ? { aiMode } : {}) }));
  await advance(0);
  const events = () => a.received.filter((m): m is EventMessage => m.kind === 'event');
  return { actor, gemini, fixture, a, b, advance, events };
}

describe('AIのモード（Gemini / 固定データ）', () => {
  it('Gemini が使えるサーバーでは既定は gemini。両方のモードが選べると snapshot に出る', async () => {
    const { gemini, fixture, events } = await setup();
    expect(events().at(-1)!.snapshot.ai).toEqual({ mode: 'gemini', available: ['gemini', 'fixture'] });
    expect(gemini.generateCalls.length).toBeGreaterThan(0);
    expect(fixture.generateCalls).toHaveLength(0);
  });

  it('開始時に固定データを選ぶと、Gemini を一度も呼ばない', async () => {
    const { gemini, fixture } = await setup('fixture');
    expect(fixture.generateCalls.length).toBeGreaterThan(0);
    expect(gemini.generateCalls).toHaveLength(0);
  });

  it('ホストは途中で切り替えられ、作り置きは新しいモードで作り直す。ホスト以外は切り替えられない', async () => {
    const { actor, gemini, fixture, a, b, advance, events } = await setup();
    actor.receiveCommand(b.conn, cmd('SET_AI_MODE', { mode: 'fixture' }));
    expect(b.received.filter((m) => m.kind === 'result').at(-1)).toMatchObject({ ok: false, reason: 'NOT_HOST' });
    const geminiCallsBefore = gemini.generateCalls.length;
    actor.receiveCommand(a.conn, cmd('SET_AI_MODE', { mode: 'fixture' }));
    expect(events().at(-1)).toMatchObject({ type: 'AI_MODE_CHANGED', detail: { mode: 'fixture' } });
    expect(actor.session.stock.length).toBeLessThanOrEqual(1);
    await advance(10);
    expect(fixture.generateCalls.length).toBeGreaterThan(0);
    // 下段の案の質問も固定データ側で答える
    actor.receiveCommand(a.conn, cmd('ASK_CANDIDATE', { instanceId: actor.session.lowerSlots[0]!, text: '費用は？' }));
    await advance(10);
    expect(gemini.generateCalls.length).toBe(geminiCallsBefore);
  });
});
