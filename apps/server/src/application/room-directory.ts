import { isRoomId, randomRoomId, type RoomRegistry } from '@camp-protocol/kit/server';
import type { vocabulary } from '@idea-audition/protocol';
import type { SessionActor } from './session-actor.ts';

/**
 * オーディションの部屋の一覧（Google Meet のようにリンクで入る方式）。
 *  - ホストが「作る」と、推測されにくい ID（例 kqd-rmzw-tbe）の部屋ができ、そのリンクを配る
 *  - リンクを開いた人は、その部屋に入れる。作られていない ID には入れない（ROOM_NOT_FOUND）
 *  - 部屋はメモリ上のアクターが持つ（ADR-0003、Cloud Run は1台）。保存先にあれば再起動後も戻せる
 *  - 全員が抜けても一定時間はメモリに残し、そのあと片付ける
 */
export interface RoomDirectoryOptions {
  /** 部屋を開く。create なら新しく作り、そうでなければ保存先から戻す（なければ null） */
  open(roomId: string, mode: 'create' | 'existing'): Promise<SessionActor | null>;
  idleReleaseMs: number;
  /** 同時にメモリに置く部屋の上限（クレジットを守るため） */
  maxLiveRooms: number;
  log?: (m: string) => void;
}

export type CreateRoomResult = { ok: true; roomId: string } | { ok: false; reason: 'TOO_MANY_ROOMS' };

export class RoomDirectory implements RoomRegistry<typeof vocabulary> {
  private rooms = new Map<string, { actor: Promise<SessionActor | null>; releaseTimer?: ReturnType<typeof setTimeout> }>();

  constructor(private readonly opts: RoomDirectoryOptions) {}

  async create(): Promise<CreateRoomResult> {
    if (this.rooms.size >= this.opts.maxLiveRooms) return { ok: false, reason: 'TOO_MANY_ROOMS' };
    let roomId = randomRoomId();
    while (this.rooms.has(roomId)) roomId = randomRoomId();
    const actor = this.opts.open(roomId, 'create');
    this.rooms.set(roomId, { actor });
    const opened = await actor;
    if (!opened) {
      this.rooms.delete(roomId);
      throw new Error(`could not create room ${roomId}`);
    }
    this.opts.log?.(`room created: ${roomId}`);
    // 作っただけで誰も入らなければ、そのまま片付ける
    this.release(roomId);
    return { ok: true, roomId };
  }

  /** いまメモリにある部屋だけを返す（保存先から開かない） */
  peek(roomId: string): Promise<SessionActor | null> {
    return this.rooms.get(roomId)?.actor ?? Promise.resolve(null);
  }

  get(roomId: string): Promise<SessionActor | null> {
    let entry = this.rooms.get(roomId);
    if (!entry) {
      if (!isRoomId(roomId)) return Promise.resolve(null);
      // 同時に来た接続が同じアクターを共有できるよう、Promise ごと持つ
      const actor = this.opts.open(roomId, 'existing');
      entry = { actor };
      this.rooms.set(roomId, entry);
      actor.then(
        (a) => {
          if (!a) this.rooms.delete(roomId);
        },
        () => this.rooms.delete(roomId),
      );
    }
    if (entry.releaseTimer) clearTimeout(entry.releaseTimer);
    entry.releaseTimer = undefined;
    return entry.actor;
  }

  release(roomId: string) {
    const entry = this.rooms.get(roomId);
    if (!entry) return;
    if (entry.releaseTimer) clearTimeout(entry.releaseTimer);
    entry.releaseTimer = setTimeout(() => {
      void entry.actor.then((a) => a?.dispose());
      this.rooms.delete(roomId);
      this.opts.log?.(`room released: ${roomId}`);
    }, this.opts.idleReleaseMs);
    entry.releaseTimer.unref?.();
  }

  /** 終了時に未保存の分を書き出すため */
  async persistAll() {
    await Promise.allSettled([...this.rooms.values()].map((e) => e.actor.then((a) => a?.persist())));
  }

  /** テスト用 */
  async disposeAll() {
    for (const e of this.rooms.values()) {
      if (e.releaseTimer) clearTimeout(e.releaseTimer);
      (await e.actor)?.dispose();
    }
    this.rooms.clear();
  }
}

/**
 * 部屋を作る回数の上限（送り手ごと、直近1時間）。公開の URL から誰でも作れるので、Gemini のクレジットを守る。
 */
export class CreationLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly perHour: number,
    private readonly now: () => number = Date.now,
  ) {}

  allow(key: string): boolean {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= this.perHour) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.hits.clear(); // 送り手が増えすぎたら忘れる（メモリを守る）
    return true;
  }
}
