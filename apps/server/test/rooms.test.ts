/**
 * オーディションの部屋（Google Meet のようにリンクで入る方式）。
 * ホストが POST /api/rooms で部屋を作り、返った ID のリンクを開いた人だけが入れる。作られていない ID は ROOM_NOT_FOUND。
 */
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { CAMP_CLOSE, CAMP_VERSION } from '@idea-audition/protocol';
import { isRoomId } from '@camp-protocol/kit/server';
import { CreationLimiter, RoomDirectory } from '../src/application/room-directory.ts';
import { SessionActor } from '../src/application/session-actor.ts';
import { MemorySessionStore } from '../src/infrastructure/persistence/memory-store.ts';
import { nodeScheduler, randomIds, systemClock } from '../src/infrastructure/runtime.ts';
import { startServer, type CreateRoom } from '../src/presentation/ws-server.ts';
import { StubAi } from './helpers.ts';

const store = new MemorySessionStore();
const deps = {
  ai: new StubAi(),
  store,
  scheduler: nodeScheduler,
  clock: systemClock,
  ids: randomIds(),
  config: { stockTarget: 3, lowerSlotCount: 5, rotation: null, critiqueIntervalMs: 5, persistDelayMs: 5, consensus: null },
};

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function boot(opts: { perHour?: number; maxLiveRooms?: number } = {}) {
  const rooms = new RoomDirectory({
    open: (id, mode) => (mode === 'create' ? SessionActor.create(id, deps) : SessionActor.openExisting(id, deps)),
    idleReleaseMs: 60_000,
    maxLiveRooms: opts.maxLiveRooms ?? 10,
  });
  const limiter = new CreationLimiter(opts.perHour ?? 10);
  const createRoom: CreateRoom = async (key) => {
    if (!limiter.allow(key)) return { ok: false, status: 429, reason: 'TOO_MANY_REQUESTS' };
    const r = await rooms.create();
    return r.ok ? r : { ok: false, status: 503, reason: r.reason };
  };
  const s = startServer({ port: 0, registry: rooms, voice: null, createRoom, staticDir: null, log: () => {} });
  const port = await s.port;
  cleanups.push(async () => {
    await rooms.disposeAll();
    await s.close();
  });
  return { port, rooms };
}

const create = (port: number) => fetch(`http://127.0.0.1:${port}/api/rooms`, { method: 'POST' });

function hello(port: number, roomId: string) {
  return new Promise<{ kind: string; code?: string; closeCode?: number }>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/camp`);
    let first: { kind: string; code?: string } | null = null;
    ws.on('open', () => ws.send(JSON.stringify({ camp: CAMP_VERSION, kind: 'hello', sessionId: roomId })));
    ws.on('message', (raw) => {
      first ??= JSON.parse(raw.toString());
      if (first?.kind === 'welcome') {
        resolve(first);
        ws.close();
      }
    });
    ws.on('close', (closeCode) => resolve({ ...(first ?? { kind: 'none' }), closeCode }));
  });
}

describe('オーディションの部屋（リンクで入る）', () => {
  it('POST /api/rooms で部屋ができ、その ID のリンクで入れる', async () => {
    const { port } = await boot();
    const res = await create(port);
    expect(res.status).toBe(201);
    const { roomId } = (await res.json()) as { roomId: string };
    expect(isRoomId(roomId)).toBe(true);
    expect((await hello(port, roomId)).kind).toBe('welcome');
  });

  it('作られていない ID・形の違う ID には入れない（ROOM_NOT_FOUND、4404）', async () => {
    const { port } = await boot();
    for (const id of ['abc-defg-hij', 'demo']) {
      const r = await hello(port, id);
      expect(r).toMatchObject({ kind: 'protocol_error', code: 'ROOM_NOT_FOUND', closeCode: CAMP_CLOSE.ROOM_NOT_FOUND });
    }
  });

  it('作る回数には上限がある（送り手ごと）。同時に置ける部屋の数にも上限がある', async () => {
    const limited = await boot({ perHour: 2 });
    expect((await create(limited.port)).status).toBe(201);
    expect((await create(limited.port)).status).toBe(201);
    expect((await create(limited.port)).status).toBe(429);

    const full = await boot({ maxLiveRooms: 1 });
    expect((await create(full.port)).status).toBe(201);
    expect((await create(full.port)).status).toBe(503);
  });

  it('作った部屋はすぐ保存され、サーバーが再起動しても同じリンクで入れる', async () => {
    const first = await boot();
    const { roomId } = (await (await create(first.port)).json()) as { roomId: string };
    expect(store.sessions.has(roomId)).toBe(true);
    const second = await boot();
    expect((await hello(second.port, roomId)).kind).toBe('welcome');
  });

  it('知らないパスへの接続は HTTP 404 で断る（サーバーを落とさない）', async () => {
    const { port } = await boot();
    const status = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/nope`);
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('error', () => {});
    });
    expect(status).toBe(404);
    // そのあとも普通に部屋を作れる
    expect((await create(port)).status).toBe(201);
  });
});

describe('案のイメージ画像（GET /api/images）', () => {
  it('メモリにある部屋の画像だけを返し、無ければ 404', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const actor = { ideaImage: (id: string) => (id === 'idea_1' ? { mime: 'image/png', data: png } : null) };
    const registry = {
      get: async () => null,
      peek: async (room: string) => (room === 'abc-defg-hij' ? actor : null),
    } as unknown as Parameters<typeof startServer>[0]['registry'];
    const s = startServer({ port: 0, registry, voice: null, createRoom: null, staticDir: null, log: () => {} });
    const base = `http://localhost:${await s.port}`;
    try {
      const ok = await fetch(`${base}/api/images/abc-defg-hij/idea_1`);
      expect(ok.status).toBe(200);
      expect(ok.headers.get('content-type')).toBe('image/png');
      expect(Buffer.from(await ok.arrayBuffer())).toEqual(png);
      expect((await fetch(`${base}/api/images/abc-defg-hij/idea_2`)).status).toBe(404);
      expect((await fetch(`${base}/api/images/zzz-zzzz-zzz/idea_1`)).status).toBe(404);
      expect((await fetch(`${base}/api/images/abc-defg-hij/..%2F..%2Fetc`)).status).toBe(404);
    } finally {
      await s.close();
    }
  });
});

