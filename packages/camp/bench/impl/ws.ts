import { createServer } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { applyAnswer, applyOp, initialMeeting, type Op } from '../meeting.ts';
import { backoff, observe, type BenchClient, type Impl } from './types.ts';

/**
 * ふつうの WebSocket（Socket.IO と同じ作り）。
 *  - サーバーが状態を持ち、操作が来たら1件ずつ処理して、全員に状態の全体を配る
 *  - 切れたら同じ間隔で再接続し、つながったら状態の全体を受け取る
 *  - 切れている間の操作はためておき、つながったら送る（Socket.IO のクライアントと同じ）
 *
 * retry = false：返事を待たない（Socket.IO の既定。最大1回）
 * retry = true ：返事（ack）が来るまで送り直す（Socket.IO の retries。最低1回）。サーバーは重複を捨てない
 *
 * AI の答えは、届いたらそのまま反映する（守りを書かない、ふつうの書き方）
 */
export function wsImpl(retry: boolean): Impl {
  return {
    name: retry ? 'WS+再送' : 'WS',
    async startServer(ledger, ai) {
      const state = initialMeeting();
      const http = createServer();
      const wss = new WebSocketServer({ server: http });
      let nextId = 0;
      const broadcast = () => {
        const data = JSON.stringify({ t: 'state', state });
        for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(data);
      };
      wss.on('connection', (socket) => {
        const actor = `p_${++nextId}`;
        socket.send(JSON.stringify({ t: 'state', state }));
        socket.on('message', (raw) => {
          const m = JSON.parse(String(raw)) as { t: 'op'; op: Op };
          const q = applyOp(state, m.op, actor, ledger);
          if (retry) socket.send(JSON.stringify({ t: 'ack', opId: m.op.opId }));
          broadcast();
          if (q) {
            void ai(q.text).then((answer) => {
              applyAnswer(state, q, answer, ledger);
              broadcast();
            });
          }
        });
        socket.on('error', () => {});
      });
      const port = await new Promise<number>((r) => http.listen(0, '127.0.0.1', () => r((http.address() as { port: number }).port)));
      return {
        port,
        state: () => state,
        close: async () => {
          for (const c of wss.clients) c.terminate();
          await new Promise<void>((r) => wss.close(() => r()));
          await new Promise<void>((r) => http.close(() => r()));
        },
      };
    },
    connect(port) {
      let resolveReady!: () => void;
      let ws: WebSocket | null = null;
      let tries = 0;
      let closed = false;
      /** 切れている間にためた操作（Socket.IO の sendBuffer） */
      const buffer: Op[] = [];
      /** 返事待ち（retry のときだけ） */
      const pending = new Map<string, { op: Op; timer: ReturnType<typeof setTimeout> | null }>();
      const write = (op: Op) => {
        if (ws?.readyState === WebSocket.OPEN) {
          c.messagesOut++;
          ws.send(JSON.stringify({ t: 'op', op }));
          return true;
        }
        return false;
      };
      const sendWithRetry = (op: Op) => {
        const p = pending.get(op.opId) ?? { op, timer: null };
        pending.set(op.opId, p);
        if (p.timer) clearTimeout(p.timer);
        // ack が来なければ送り直す（Socket.IO の ackTimeout と同じ考え方）
        p.timer = setTimeout(() => pending.has(op.opId) && sendWithRetry(op), 2000);
        if (!write(op) && !buffer.includes(op)) buffer.push(op);
      };
      const open = () => {
        if (closed) return;
        const s = new WebSocket(`ws://127.0.0.1:${port}`);
        ws = s;
        s.on('open', () => {
          tries = 0;
          // つながったら、ためた操作を送る。retry なら返事の来ていない操作も送り直す
          const queued = buffer.splice(0);
          for (const op of queued) write(op);
          if (retry) for (const p of pending.values()) if (!queued.includes(p.op)) write(p.op);
        });
        s.on('message', (raw) => {
          c.messagesIn++;
          const m = JSON.parse(String(raw)) as { t: 'state'; state: never } | { t: 'ack'; opId: string };
          if (m.t === 'ack') {
            const p = pending.get(m.opId);
            if (p?.timer) clearTimeout(p.timer);
            pending.delete(m.opId);
            return;
          }
          observe(c, m.state);
          resolveReady();
        });
        s.on('error', () => {});
        s.on('close', () => {
          if (ws !== s || closed) return;
          ws = null;
          setTimeout(open, backoff(tries++));
        });
      };
      const c: BenchClient = {
        view: null,
        seen: new Map(),
        messagesIn: 0,
        messagesOut: 0,
        ready: new Promise((r) => (resolveReady = r)),
        send(op) {
          if (retry) return sendWithRetry(op);
          if (!write(op)) buffer.push(op);
        },
        close() {
          closed = true;
          for (const p of pending.values()) if (p.timer) clearTimeout(p.timer);
          ws?.terminate();
        },
      };
      open();
      return c;
    },
  };
}
