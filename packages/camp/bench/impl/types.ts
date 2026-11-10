import type { Ai } from '../env.ts';
import type { Ledger, MeetingState, Op } from '../meeting.ts';

/** 比べる作りの1つ（サーバーとクライアントの組） */
export interface Impl {
  name: string;
  startServer(ledger: Ledger, ai: Ai): Promise<BenchServer>;
  /** port は中継（Link）のポート */
  connect(port: number): BenchClient;
}

export interface BenchServer {
  port: number;
  state(): MeetingState;
  close(): Promise<void>;
}

export interface BenchClient {
  /** 画面が持っている最新の状態 */
  view: MeetingState | null;
  /** 操作が画面に出た時刻（performance.now）。recent に初めて現れたとき */
  seen: Map<string, number>;
  /** 届いたメッセージ・HTTP の回数 */
  messagesIn: number;
  messagesOut: number;
  /** 最初の状態が届いたら解決 */
  ready: Promise<void>;
  send(op: Op): void;
  close(): void;
}

/** 状態を受け取ったときの共通の処理（画面に出た時刻を記録する） */
export function observe(c: BenchClient, s: MeetingState) {
  c.view = s;
  const now = performance.now();
  for (const id of s.recent) if (!c.seen.has(id)) c.seen.set(id, now);
}

/** 再接続の待ち時間（4つの作りで同じ：400ms から倍々、最大5秒。CAMP のクライアントと同じ） */
export const backoff = (retry: number) => Math.min(5000, 400 * 2 ** retry);
