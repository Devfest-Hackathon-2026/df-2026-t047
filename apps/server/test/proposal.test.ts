import { describe, expect, it } from 'vitest';
import { CAMP_VERSION, type CommandMessage, type EventMessage } from '@idea-audition/protocol';
import { SessionActor } from '../src/application/session-actor.ts';
import { MemorySessionStore } from '../src/infrastructure/persistence/memory-store.ts';
import { StubAi, fakeClock, fakeConnection, manualScheduler, seqIds } from './helpers.ts';

let cid = 0;
const cmd = (type: CommandMessage['type'], payload: object) =>
  ({ camp: CAMP_VERSION, kind: 'command', type, commandId: `p${++cid}`, sentAt: '', payload }) as CommandMessage;

async function crowned(failFirst = false, store = new MemorySessionStore()) {
  const { scheduler, advance } = manualScheduler();
  const ai = new StubAi();
  ai.failProposal = failFirst;
  const deps = {
    ai,
    store,
    scheduler,
    clock: fakeClock(),
    ids: seqIds(),
    config: { stockTarget: 3, lowerSlotCount: 5, critiqueIntervalMs: 10, persistDelayMs: 10, rotation: null, consensus: null },
  };
  const actor = await SessionActor.open('pr', deps);
  const a = fakeConnection('a');
  actor.attach(a.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'pr' });
  actor.receiveCommand(a.conn, cmd('START_AUDITION', { theme: '学食', mode: 'solo' }));
  await advance(0);
  const id = actor.session.lowerSlots[0]!;
  actor.receiveCommand(a.conn, cmd('REQUEST_PROMOTION', { instanceId: id }));
  await advance(100);
  actor.receiveCommand(a.conn, cmd('SELECT_CHAMPION', { instanceId: id }));
  const events = () => a.received.filter((m): m is EventMessage => m.kind === 'event');
  return { actor, ai, a, advance, events, id, deps };
}

describe('企画書', () => {
  it('決勝の案の企画書は優勝が決まる前に作っておき、優勝が決まったらそれをすぐ使う（作り直さない）', async () => {
    const { scheduler, advance } = manualScheduler();
    const ai = new StubAi();
    const actor = await SessionActor.open('pre', {
      ai,
      store: new MemorySessionStore(),
      scheduler,
      clock: fakeClock(),
      ids: seqIds(),
      config: { stockTarget: 3, lowerSlotCount: 5, critiqueIntervalMs: 10, persistDelayMs: 10, rotation: null, consensus: null },
    });
    const a = fakeConnection('a');
    actor.attach(a.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'pre' });
    actor.receiveCommand(a.conn, cmd('START_AUDITION', { theme: '学食', mode: 'solo' }));
    await advance(0);
    const id = actor.session.lowerSlots[0]!;
    actor.receiveCommand(a.conn, cmd('REQUEST_PROMOTION', { instanceId: id }));
    await advance(5_000);
    expect(ai.proposalCalls).toHaveLength(1); // 優勝が決まる前に作っておいた
    expect(ai.proposalImageCalls).toHaveLength(1); // イメージ画像も先行生成しておいた
    actor.receiveCommand(a.conn, cmd('SELECT_CHAMPION', { instanceId: id }));
    await advance(0);
    expect(ai.proposalCalls).toHaveLength(1); // 作り直していない
    expect(ai.proposalImageCalls).toHaveLength(1);
    expect(actor.session.proposal?.status).toBe('ready');
    expect(actor.session.proposal?.content?.imageUrl).toContain('data:image/svg+xml');
  });

  it('決勝の案のイメージ画像は案ごとに1枚だけ作り、URL を状態に入れ、企画書でも同じ画像を使う', async () => {
    const { scheduler, advance } = manualScheduler();
    const ai = new StubAi();
    const actor = await SessionActor.open('img', {
      ai,
      store: new MemorySessionStore(),
      scheduler,
      clock: fakeClock(),
      ids: seqIds(),
      config: { stockTarget: 3, lowerSlotCount: 5, critiqueIntervalMs: 10, persistDelayMs: 10, rotation: null, consensus: null },
    });
    const a = fakeConnection('a');
    actor.attach(a.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'img' });
    actor.receiveCommand(a.conn, cmd('START_AUDITION', { theme: '大学の学食をもっと楽しくする企画', mode: 'solo' }));
    await advance(0);
    const id = actor.session.lowerSlots[0]!;
    const ideaId = actor.session.characters.get(id)!.ideaId;
    actor.receiveCommand(a.conn, cmd('REQUEST_PROMOTION', { instanceId: id }));
    await advance(5_000);
    const events = a.received.filter((m): m is EventMessage => m.kind === 'event');
    const ready = events.find((e) => e.type === 'IDEA_IMAGE_READY');
    expect(ready?.snapshot.ideas[ideaId]?.imageUrl).toBe(`/api/images/img/${ideaId}`);
    // 状態には URL だけ。画像そのものは入れない
    expect(JSON.stringify(ready!.snapshot)).not.toContain('data:image');
    expect(actor.ideaImage(ideaId)?.mime).toBe('image/svg+xml');
    expect(ai.proposalImageCalls).toHaveLength(1);
    // 企画書も同じ画像を使い、作り直さない
    actor.receiveCommand(a.conn, cmd('SELECT_CHAMPION', { instanceId: id }));
    await advance(0);
    expect(ai.proposalImageCalls).toHaveLength(1);
    expect(actor.session.proposal?.content?.imageUrl).toContain('data:image/svg+xml');
  });

  it('画像は合格した時点で作り始め、1枚ずつ順に頼み、混雑（429）なら待って頼み直す', async () => {
    const { scheduler, advance } = manualScheduler();
    const ai = new StubAi();
    let busy = 1;
    let running = 0;
    let maxRunning = 0;
    const original = ai.generateProposalImage.bind(ai);
    ai.generateProposalImage = async (input) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      try {
        await Promise.resolve();
        if (busy-- > 0) throw new Error('ApiError: {"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}');
        return await original(input);
      } finally {
        running--;
      }
    };
    const actor = await SessionActor.open('q', {
      ai,
      store: new MemorySessionStore(),
      scheduler,
      clock: fakeClock(),
      ids: seqIds(),
      config: { stockTarget: 3, lowerSlotCount: 5, critiqueIntervalMs: 10, persistDelayMs: 10, rotation: null, consensus: null },
    });
    const a = fakeConnection('a');
    actor.attach(a.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'q' });
    actor.receiveCommand(a.conn, cmd('START_AUDITION', { theme: '大学の学食をもっと楽しくする企画', mode: 'solo', finalists: 3 }));
    await advance(0);
    const first = actor.session.lowerSlots[0]!;
    actor.receiveCommand(a.conn, cmd('REQUEST_PROMOTION', { instanceId: first }));
    await advance(0);
    const second = actor.session.lowerSlots.find((x) => x && x !== first)!;
    actor.receiveCommand(a.conn, cmd('REQUEST_PROMOTION', { instanceId: second }));
    await advance(0);
    // 1枚目は混雑で断られ、5秒待ってから頼み直す。2枚目はその後
    const ideaOf = (id: string) => actor.session.characters.get(id)!.ideaId;
    expect(actor.ideaImage(ideaOf(first))).toBeNull();
    await advance(5_000);
    expect(actor.ideaImage(ideaOf(first))).not.toBeNull();
    expect(actor.ideaImage(ideaOf(second))).not.toBeNull();
    expect(maxRunning).toBe(1);
  });

  it('優勝が決まると自動で作り始め、できたら全員に配られる', async () => {
    const { ai, advance, events } = await crowned();
    const selected = events().find((e) => e.type === 'CHAMPION_SELECTED')!;
    expect(selected.snapshot.proposal).toMatchObject({ status: 'generating' });
    await advance(10);
    expect(ai.proposalCalls).toHaveLength(1);
    expect(ai.proposalCalls[0]!.champion.revisions.map((r) => r.version)).toEqual([1, 2]); // 改良の経緯を渡す
    const ready = events().find((e) => e.type === 'PROPOSAL_UPDATED')!;
    expect(ready.snapshot.proposal).toMatchObject({ status: 'ready', generatedBy: 'stub' });
    expect(ready.snapshot.proposal!.content!.title).toBe('改良版');
    expect(ready.snapshot.proposal!.content!.imageUrl).toContain('data:image/svg+xml');
  });

  it('イメージ画像の生成が失敗しても、企画書本文は ready として配られる', async () => {
    const { scheduler, advance } = manualScheduler();
    const ai = new StubAi();
    ai.failProposalImage = true;
    const actor = await SessionActor.open('img-fail', {
      ai,
      store: new MemorySessionStore(),
      scheduler,
      clock: fakeClock(),
      ids: seqIds(),
      config: { stockTarget: 3, lowerSlotCount: 5, critiqueIntervalMs: 10, persistDelayMs: 10, rotation: null, consensus: null },
    });
    const a = fakeConnection('a');
    actor.attach(a.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'img-fail' });
    actor.receiveCommand(a.conn, cmd('START_AUDITION', { theme: '学食', mode: 'solo' }));
    await advance(0);
    const id = actor.session.lowerSlots[0]!;
    actor.receiveCommand(a.conn, cmd('REQUEST_PROMOTION', { instanceId: id }));
    await advance(100);
    actor.receiveCommand(a.conn, cmd('SELECT_CHAMPION', { instanceId: id }));
    await advance(10);
    expect(actor.session.proposal?.status).toBe('ready');
    expect(actor.session.proposal?.content?.title).toBe('改良版');
    expect(actor.session.proposal?.content?.imageUrl).toBeUndefined();
  });

  it('失敗したら failed になり、作り直しできる', async () => {
    const { ai, a, actor, advance, events } = await crowned(true);
    await advance(10);
    expect(events().at(-1)!.snapshot.proposal!.status).toBe('failed');
    ai.failProposal = false;
    actor.receiveCommand(a.conn, cmd('REGENERATE_PROPOSAL', {}));
    await advance(10);
    expect(events().at(-1)!.snapshot.proposal!.status).toBe('ready');
  });

  it('作成中に再起動しても、復元時に作り直す', async () => {
    const store = new MemorySessionStore();
    const first = await crowned(true, store);
    await first.actor.persist();
    // 失敗する前の「作成中」の状態で保存されたことにする
    const saved = store.sessions.get('pr')!;
    saved.state.proposal = { status: 'generating', content: null, generatedAt: null, generatedBy: null };
    const ai = new StubAi();
    const reopened = await SessionActor.open('pr', { ...first.deps, ai });
    await first.advance(10);
    expect(ai.proposalCalls).toHaveLength(1);
    expect(reopened.session.proposal!.status).toBe('ready');
  });
});
