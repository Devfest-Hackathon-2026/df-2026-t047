import { connect, createServer, type Server, type Socket } from 'node:net';

/** シードで決まる乱数（mulberry32）。同じシードなら同じ操作・同じ切断になる */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, between: (lo: number, hi: number) => lo + (hi - lo) * next() };
}
export type Rng = ReturnType<typeof rng>;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 偽の AI：1〜3秒（乱数）で答える。呼ばれた回数は台帳で数える */
export function fakeAi(r: Rng, minMs = 1000, maxMs = 3000) {
  return (question: string) => new Promise<string>((resolve) => setTimeout(() => resolve(`「${question}」への答え`), r.between(minMs, maxMs)));
}
export type Ai = ReturnType<typeof fakeAi>;

/**
 * クライアント1人ぶんの通信路（TCP の中継）。
 *  - 片道 delayMs の遅れを足す（向きごとに順番は保つ）
 *  - cut() でその瞬間の接続を全部切る。中継の途中にあるデータは捨てる（送ったつもりで届かない、が起きる）
 *  - 通った量（バイト）を数える
 */
export class Link {
  private server: Server;
  private pairs = new Set<{ a: Socket; b: Socket; timers: Set<ReturnType<typeof setTimeout>> }>();
  bytesUp = 0;
  bytesDown = 0;
  cuts = 0;
  port: Promise<number>;

  constructor(
    private readonly targetPort: number,
    private readonly delayMs: number,
  ) {
    this.server = createServer((a) => this.accept(a));
    this.port = new Promise((resolve) => this.server.listen(0, '127.0.0.1', () => resolve((this.server.address() as { port: number }).port)));
  }

  private accept(a: Socket) {
    const b: Socket = connect(this.targetPort, '127.0.0.1');
    const pair = { a, b, timers: new Set<ReturnType<typeof setTimeout>>() };
    this.pairs.add(pair);
    a.setNoDelay(true);
    b.setNoDelay(true);
    const pipe = (from: Socket, to: Socket, count: (n: number) => void) => {
      let last = 0;
      from.on('data', (chunk) => {
        count(chunk.length);
        if (this.delayMs === 0) return void (to.writable && to.write(chunk));
        const at = Math.max(Date.now() + this.delayMs, last);
        last = at;
        const t = setTimeout(() => {
          pair.timers.delete(t);
          if (to.writable) to.write(chunk);
        }, at - Date.now());
        pair.timers.add(t);
      });
    };
    pipe(a, b, (n) => (this.bytesUp += n));
    pipe(b, a, (n) => (this.bytesDown += n));
    const end = () => this.drop(pair);
    a.on('error', end).on('close', end);
    b.on('error', end).on('close', end);
  }

  private drop(pair: { a: Socket; b: Socket; timers: Set<ReturnType<typeof setTimeout>> }) {
    if (!this.pairs.delete(pair)) return;
    for (const t of pair.timers) clearTimeout(t);
    pair.a.destroy();
    pair.b.destroy();
  }

  /** いまつながっている接続を、途中のデータごと切る */
  cut() {
    if (this.pairs.size === 0) return;
    this.cuts++;
    for (const p of [...this.pairs]) this.drop(p);
  }

  close() {
    for (const p of [...this.pairs]) this.drop(p);
    this.server.close();
  }
}
