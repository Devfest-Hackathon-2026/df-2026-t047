/**
 * CAMP v1 の適合テスト（docs/protocol/camp-v1.md、ADR-0010 §4）。
 * 実際にサーバーを立て、WebSocket で話して、プロトコルとしての振る舞いを確かめる。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { CAMP_CLOSE, CAMP_VERSION, type EventMessage, type ServerMessage } from '@idea-audition/protocol';
import { SessionActor } from '../src/application/session-actor.ts';
import { MemorySessionStore } from '../src/infrastructure/persistence/memory-store.ts';
import { nodeScheduler, randomIds, systemClock } from '../src/infrastructure/runtime.ts';
import { startServer, type ActorRegistry } from '../src/presentation/ws-server.ts';
import { StubAi, drafts } from './helpers.ts';

/** generateIdeas を外から止めたり進めたりできる AI（古い AI の結果のテスト用） */
class GatedAi extends StubAi {
  gate: Promise<void> | null = null;
  open: (() => void) | null = null;
  hold() {
    this.gate = new Promise((r) => (this.open = r));
  }
  override async generateIdeas(input: { count: number }) {
    if (this.gate) await this.gate;
    return drafts(input.count, '遅れた案');
  }
}

const ai = new GatedAi();
let server: Awaited<ReturnType<typeof boot>>;

async function boot() {
  const actors = new Map<string, Promise<SessionActor>>();
  const registry: ActorRegistry = {
    get(sessionId) {
      let a = actors.get(sessionId);
      if (!a) {
        a = SessionActor.open(sessionId, {
          ai,
          store: new MemorySessionStore(),
          scheduler: nodeScheduler,
          clock: systemClock,
          ids: randomIds(),
          config: { stockTarget: 3, lowerSlotCount: 5, rotation: null, critiqueIntervalMs: 5, persistDelayMs: 5, consensus: null },
        });
        actors.set(sessionId, a);
      }
      return a;
    },
    release() {},
  };
  const s = startServer({ port: 0, registry, voice: null, createRoom: null, staticDir: null, helloTimeoutMs: 300, log: () => {} });
  return { ...s, port: await s.port, actors };
}

beforeAll(async () => {
  server = await boot();
});
afterAll(async () => {
  for (const a of server.actors.values()) (await a).dispose();
  await server.close();
});

/* ------------------------------ テスト用クライアント ------------------------------ */

interface Client {
  ws: WebSocket;
  received: ServerMessage[];
  judgeId: string | null;
  resumeToken: string | null;
  send(m: unknown): void;
  waitFor<T extends ServerMessage>(pred: (m: ServerMessage) => m is T, ms?: number): Promise<T>;
  waitFor(pred: (m: ServerMessage) => boolean, ms?: number): Promise<ServerMessage>;
  closed: Promise<number>;
}

function open(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/camp`);
    const received: ServerMessage[] = [];
    const waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
    const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
    const client: Client = {
      ws,
      received,
      judgeId: null,
      resumeToken: null,
      send: (m) => ws.send(typeof m === 'string' ? m : JSON.stringify(m)),
      waitFor: ((pred: (m: ServerMessage) => boolean, ms = 2000) =>
        new Promise<ServerMessage>((res, rej) => {
          const hit = received.find(pred);
          if (hit) return res(hit);
          const timer = setTimeout(() => rej(new Error('timeout waiting for message')), ms);
          waiters.push({ pred, resolve: (m) => (clearTimeout(timer), res(m)) });
        })) as Client['waitFor'],
      closed,
    };
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString()) as ServerMessage;
      received.push(m);
      if (m.kind === 'welcome') {
        client.judgeId = m.participantId;
        client.resumeToken = m.resumeToken ?? null;
      }
      for (const w of [...waiters]) if (w.pred(m)) (waiters.splice(waiters.indexOf(w), 1), w.resolve(m));
    });
    ws.on('open', () => resolve(client));
    ws.on('error', reject);
  });
}

let sessionNo = 0;
async function join(sessionId: string, judgeId?: string, lastSeq?: number, resumeToken?: string) {
  const c = await open();
  c.send({ camp: CAMP_VERSION, kind: 'hello', sessionId, participantId: judgeId, resumeToken, lastSeq });
  await c.waitFor((m) => m.kind === 'welcome');
  return c;
}

let cid = 0;
const command = (type: string, payload: unknown, extra: Record<string, unknown> = {}) => ({
  camp: CAMP_VERSION,
  kind: 'command',
  type,
  commandId: `cmd-${++cid}`,
  sentAt: new Date().toISOString(),
  payload,
  ...extra,
});

const resultOf = (c: Client, commandId: string) =>
  c.waitFor((m): m is Extract<ServerMessage, { kind: 'result' }> => m.kind === 'result' && m.commandId === commandId);
const lastSnapshot = (c: Client) =>
  [...c.received].reverse().find((m): m is EventMessage => m.kind === 'event')?.snapshot;
const confirmedCount = (c: Client) =>
  c.received.filter((m) => m.kind === 'event' && m.type === 'PROMOTION_CONFIRMED').length;

/** 審査員 n 人でオーディションを始め、下段が5体そろうまで待つ */
async function startSession(n: number) {
  const sessionId = `conf-${++sessionNo}`;
  const clients: Client[] = [];
  for (let i = 0; i < n; i++) clients.push(await join(sessionId));
  const start = command('START_AUDITION', { theme: '学食', mode: 'team' });
  clients[0]!.send(start);
  await resultOf(clients[0]!, start.commandId);
  await clients[0]!.waitFor((m) => m.kind === 'event' && m.snapshot.lowerSlots.filter(Boolean).length === 5);
  return { sessionId, clients };
}

const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------- テスト ---------------------------------- */

describe('CAMP v1 適合テスト', () => {
  it('同時昇格：4人が同時に別々のキャラを昇格 → 成功は3人、1人は UPPER_FULL、上段は3体を超えない', async () => {
    const { clients } = await startSession(4);
    const lower = lastSnapshot(clients[0]!)!.lowerSlots.filter((x): x is string => !!x);
    const cmds = clients.map((_, i) => command('REQUEST_PROMOTION', { instanceId: lower[i] }));
    clients.forEach((c, i) => c.send(cmds[i]));
    const results = await Promise.all(clients.map((c, i) => resultOf(c, cmds[i]!.commandId)));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(results.filter((r) => !r.ok).map((r) => r.reason)).toEqual(['UPPER_FULL']);
    await settle();
    for (const c of clients) expect(lastSnapshot(c)!.upper.length).toBe(3);
  });

  it('取り合い：2人が同じキャラを同時に昇格 → 1人が成功、1人は NOT_IN_LOWER、確定は1回', async () => {
    const { clients } = await startSession(2);
    const target = lastSnapshot(clients[0]!)!.lowerSlots[0];
    const [a, b] = [command('REQUEST_PROMOTION', { instanceId: target }), command('REQUEST_PROMOTION', { instanceId: target })];
    clients[0]!.send(a);
    clients[1]!.send(b);
    const [ra, rb] = await Promise.all([resultOf(clients[0]!, a.commandId), resultOf(clients[1]!, b.commandId)]);
    expect([ra.ok, rb.ok].sort()).toEqual([false, true]);
    expect([ra, rb].find((r) => !r.ok)!.reason).toBe('NOT_IN_LOWER');
    await settle();
    expect(confirmedCount(clients[0]!)).toBe(1);
  });

  it('再送：同じ commandId を3回送る → result は3回とも同じ、確定の Event は1回', async () => {
    const { clients } = await startSession(1);
    const c = clients[0]!;
    const promote = command('REQUEST_PROMOTION', { instanceId: lastSnapshot(c)!.lowerSlots[0] });
    c.send(promote);
    c.send(promote);
    c.send(promote);
    await settle();
    const rs = c.received.filter((m) => m.kind === 'result' && m.commandId === promote.commandId);
    expect(rs).toHaveLength(3);
    expect(rs[1]).toEqual(rs[0]);
    expect(rs[2]).toEqual(rs[0]);
    expect(confirmedCount(c)).toBe(1);
  });

  it('ほかの審査員の ID を名乗っても、合言葉が無ければその人にはなれない（なりすまし防止）', async () => {
    const { sessionId, clients } = await startSession(2);
    const [host, guest] = clients as [typeof clients[number], typeof clients[number]];
    expect(host.resumeToken).toBeTruthy();
    // 審査員の ID は snapshot で全員に見えている。合言葉なし・違う合言葉で名乗っても別人として入る
    const noToken = await join(sessionId, host.judgeId!);
    expect(noToken.judgeId).not.toBe(host.judgeId);
    const wrongToken = await join(sessionId, host.judgeId!, undefined, guest.resumeToken!);
    expect(wrongToken.judgeId).not.toBe(host.judgeId);
    // 合言葉は snapshot に出ない
    expect(JSON.stringify(lastSnapshot(guest))).not.toContain(host.resumeToken!);
  });

  it('返事の前に切断 → 再接続して同じ commandId で再送しても二重に実行されない', async () => {
    const { sessionId, clients } = await startSession(1);
    const c = clients[0]!;
    const promote = command('REQUEST_PROMOTION', { instanceId: lastSnapshot(c)!.lowerSlots[0] });
    c.send(promote);
    c.ws.terminate();
    const again = await join(sessionId, c.judgeId!, undefined, c.resumeToken!);
    expect(again.judgeId).toBe(c.judgeId);
    again.send(promote);
    const r = await resultOf(again, promote.commandId);
    expect(r.ok).toBe(true);
    await settle();
    const welcome = again.received.find((m) => m.kind === 'welcome')!;
    const upper = lastSnapshot(again)?.upper ?? (welcome.kind === 'welcome' ? welcome.snapshot.upper : []);
    expect(upper).toHaveLength(1);
  });

  it('再接続：切断中に起きた変化が welcome の snapshot に入り、seq は戻らない', async () => {
    const { sessionId, clients } = await startSession(2);
    const [a, b] = clients as [Client, Client];
    const seqBefore = lastSnapshot(a)!.seq;
    a.ws.terminate();
    await a.closed;
    const promote = command('REQUEST_PROMOTION', { instanceId: lastSnapshot(b)!.lowerSlots[0] });
    b.send(promote);
    await resultOf(b, promote.commandId);
    await settle();
    const back = await join(sessionId, a.judgeId!, seqBefore, a.resumeToken!);
    const welcome = back.received.find((m) => m.kind === 'welcome');
    if (welcome?.kind !== 'welcome') throw new Error('no welcome');
    expect(welcome.snapshot.seq).toBeGreaterThan(seqBefore);
    expect(welcome.snapshot.upper).toHaveLength(1);
    expect(welcome.participantId).toBe(a.judgeId);
  });

  it('古い AI の結果：生成中にリセット → 遅れて返った案は反映されない', async () => {
    const sessionId = `conf-${++sessionNo}`;
    const host = await join(sessionId);
    ai.hold();
    const start = command('START_AUDITION', { theme: '学食', mode: 'team' });
    host.send(start);
    await resultOf(host, start.commandId);
    const reset = command('RESET_SESSION', {});
    host.send(reset);
    expect((await resultOf(host, reset.commandId)).ok).toBe(true);
    const spawnedBefore = host.received.filter((m) => m.kind === 'event' && m.type === 'CANDIDATE_SPAWNED').length;
    ai.open!();
    ai.gate = null;
    await settle(150);
    const spawnedAfter = host.received.filter((m) => m.kind === 'event' && m.type === 'CANDIDATE_SPAWNED').length;
    expect(spawnedAfter).toBe(spawnedBefore);
    expect(lastSnapshot(host)!.status).toBe('lobby');
    expect(lastSnapshot(host)!.lowerSlots.every((x) => x === null)).toBe(true);
  });

  it('古い版への指示：expected.rev が今の版と違う磨き込みは STALE_VERSION', async () => {
    const { clients } = await startSession(1);
    const c = clients[0]!;
    const target = lastSnapshot(c)!.lowerSlots[0]!;
    const promote = command('REQUEST_PROMOTION', { instanceId: target });
    c.send(promote);
    await resultOf(c, promote.commandId);
    await c.waitFor((m) => m.kind === 'event' && m.type === 'FINALIST_VERSION_PUBLISHED');
    const snap = lastSnapshot(c)!;
    const revisions = snap.ideas[snap.characters[target]!.ideaId]!.revisions;
    const stale = command('REQUEST_REFINEMENT', { instanceId: target, text: 'もっと安く' }, { expected: { rev: revisions[0]!.revisionId } });
    c.send(stale);
    expect(await resultOf(c, stale.commandId)).toMatchObject({ ok: false, reason: 'STALE_VERSION' });
    const fresh = command('REQUEST_REFINEMENT', { instanceId: target, text: 'もっと安く' }, { expected: { rev: revisions.at(-1)!.revisionId } });
    c.send(fresh);
    expect(await resultOf(c, fresh.commandId)).toMatchObject({ ok: true });
  });

  it('バージョン違い：camp "2" の hello → protocol_error UNSUPPORTED_VERSION と 4400 で切断', async () => {
    const c = await open();
    c.send({ camp: '2', kind: 'hello', sessionId: 'x' });
    const err = await c.waitFor((m) => m.kind === 'protocol_error');
    expect(err).toMatchObject({ code: 'UNSUPPORTED_VERSION', supported: [CAMP_VERSION] });
    expect(await c.closed).toBe(CAMP_CLOSE.UNSUPPORTED_VERSION);
  });

  it('知らない Command type には UNKNOWN_TYPE、形の違う Command には INVALID_PAYLOAD を返す', async () => {
    const c = await join(`conf-${++sessionNo}`);
    const unknown = command('TELEPORT_CANDIDATE', {});
    c.send(unknown);
    expect(await resultOf(c, unknown.commandId)).toMatchObject({ ok: false, reason: 'UNKNOWN_TYPE' });
    const bad = command('REQUEST_PROMOTION', { instanceId: 42 });
    c.send(bad);
    expect(await resultOf(c, bad.commandId)).toMatchObject({ ok: false, reason: 'INVALID_PAYLOAD' });
  });

  it('壊れたメッセージや hello 前の Command は黙って捨てず protocol_error を返す', async () => {
    const c = await open();
    c.send('not json');
    expect(await c.waitFor((m) => m.kind === 'protocol_error')).toMatchObject({ code: 'MALFORMED' });
    const early = command('NEXT_IDEA', {});
    c.send(early);
    expect(await resultOf(c, early.commandId)).toMatchObject({ ok: false, reason: 'NOT_AUTHORIZED' });
    expect(await c.waitFor((m) => m.kind === 'protocol_error' && m.code === 'NOT_JOINED')).toBeTruthy();
    c.ws.close();
  });

  it('hello が来なければ 4408 で切断', async () => {
    const c = await open();
    expect(await c.closed).toBe(CAMP_CLOSE.HELLO_TIMEOUT);
  });

  it('Signal は返事なしで間引かれ、続く Command は普通に処理される', async () => {
    const { clients } = await startSession(1);
    const c = clients[0]!;
    const before = c.received.length;
    for (let i = 0; i < 50; i++) {
      c.send({ camp: CAMP_VERSION, kind: 'signal', type: 'SOFT_SIGNAL', payload: { kind: 'hesitation', targetInstanceId: null } });
    }
    const next = command('NEXT_IDEA', {});
    c.send(next);
    expect(await resultOf(c, next.commandId)).toMatchObject({ ok: true });
    const replies = c.received.slice(before).filter((m) => m.kind === 'result' || m.kind === 'protocol_error');
    expect(replies).toHaveLength(1); // NEXT_IDEA の result だけ
  });

  it('送りすぎ：1秒に上限を超えて送ると RATE_LIMITED を返して 4429 で切断', async () => {
    const c = await join(`conf-${++sessionNo}`);
    for (let i = 0; i < 200; i++) {
      c.send({ camp: CAMP_VERSION, kind: 'ephemeral', type: 'CURSOR_MOVED', payload: { x: 0.5, y: 0.5 } });
    }
    expect(await c.waitFor((m) => m.kind === 'protocol_error')).toMatchObject({ code: 'RATE_LIMITED' });
    expect(await c.closed).toBe(CAMP_CLOSE.RATE_LIMITED);
  });
});
