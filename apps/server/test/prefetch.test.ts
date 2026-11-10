import { describe, expect, it } from 'vitest';
import { CAMP_VERSION, type CommandMessage, type EphemeralMessage } from '@idea-audition/protocol';
import { SessionActor } from '../src/application/session-actor.ts';
import { MemorySessionStore } from '../src/infrastructure/persistence/memory-store.ts';
import { StubAi, fakeClock, fakeConnection, manualScheduler, seqIds } from './helpers.ts';

let cid = 0;
const cmd = (type: CommandMessage['type'], payload: object) =>
  ({ camp: CAMP_VERSION, kind: 'command', type, commandId: `p${++cid}`, sentAt: '', payload }) as CommandMessage;
const draft = (theme: string, aiMode: 'gemini' | 'fixture' | null = 'gemini') =>
  ({ camp: CAMP_VERSION, kind: 'ephemeral', type: 'THEME_DRAFT', payload: { theme, mode: 'team', aiMode } }) as EphemeralMessage;

/** 1回目の生成だけ、返事を手で返せる AI */
class SlowAi extends StubAi {
  themes: string[] = [];
  release: (() => void) | null = null;
  override async generateIdeas(input: { theme?: string; count: number }) {
    this.themes.push(input.theme ?? '');
    if (this.themes.length === 1) await new Promise<void>((r) => (this.release = r));
    return super.generateIdeas(input);
  }
}

async function setup(ai = new StubAi('gemini')) {
  const { scheduler, advance } = manualScheduler();
  const fixture = new StubAi('fixture');
  const actor = await SessionActor.open('pf', {
    ai,
    aiModes: { gemini: ai, fixture },
    store: new MemorySessionStore(),
    scheduler,
    clock: fakeClock(),
    ids: seqIds(),
    config: { stockTarget: 3, lowerSlotCount: 1, critiqueIntervalMs: 10, persistDelayMs: 10, rotation: null, consensus: null },
  });
  const host = fakeConnection('h');
  const guest = fakeConnection('g');
  actor.attach(host.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'pf' });
  actor.attach(guest.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'pf' });
  const title = () => {
    const id = actor.session.lowerSlots[0];
    const c = id ? actor.session.characters.get(id) : null;
    return c ? actor.session.ideas.get(c.ideaId)!.revisions[0]!.title : null;
  };
  return { actor, ai, fixture, host, guest, advance, title };
}

describe('ロビーでの作り置き（最初の挑戦者を待たせない）', () => {
  it('ホストのテーマ入力が止まったら、そのテーマで最初の案を作り、開始したら最初に出す', async () => {
    const { actor, ai, host, advance, title } = await setup();
    actor.receiveEphemeral(host.conn, draft('大学'));
    actor.receiveEphemeral(host.conn, draft('大学の学食'));
    await advance(500);
    expect(ai.generateCalls).toHaveLength(0); // 入力中はまだ頼まない
    await advance(800);
    expect(ai.generateCalls).toHaveLength(1); // 止まってから1回だけ
    actor.receiveCommand(host.conn, cmd('START_AUDITION', { theme: '大学の学食 ', mode: 'team', aiMode: 'gemini' }));
    expect(title()).toMatch(/^生成1-/); // 開始した瞬間に、作り置きの案が舞台に出ている
  });

  it('作り置きがまだ届いていなくても、届いたら最初に出す', async () => {
    const ai = new SlowAi('gemini');
    const { actor, host, advance, title } = await setup(ai);
    actor.receiveEphemeral(host.conn, draft('学食'));
    await advance(800);
    actor.receiveCommand(host.conn, cmd('START_AUDITION', { theme: '学食', mode: 'team', aiMode: 'gemini' }));
    await advance(0);
    ai.release!();
    await advance(0);
    expect(title()).toMatch(/^生成/);
    expect(actor.session.stock.every((d) => d.title !== title())).toBe(true);
  });

  it('開始したテーマが違えば作り置きは使わない。ホスト以外の入力では作らない', async () => {
    const { actor, ai, host, guest, advance } = await setup();
    actor.receiveEphemeral(guest.conn, draft('ゲストのテーマ'));
    await advance(1000);
    expect(ai.generateCalls).toHaveLength(0);
    actor.receiveEphemeral(host.conn, draft('学食'));
    await advance(1000);
    actor.receiveCommand(host.conn, cmd('START_AUDITION', { theme: '図書館', mode: 'team', aiMode: 'gemini' }));
    await advance(0);
    const shown = [...actor.session.ideas.values()].map((i) => i.revisions[0]!.title);
    expect(shown.some((t) => t.startsWith('生成1-'))).toBe(false);
  });

  it('固定データを選んでいれば、作り置きも固定データで作る（Gemini を呼ばない）', async () => {
    const { actor, ai, host, fixture, advance } = await setup();
    actor.receiveEphemeral(host.conn, draft('学食', 'fixture'));
    await advance(1000);
    expect(fixture.generateCalls).toHaveLength(1);
    expect(ai.generateCalls).toHaveLength(0);
  });
});
