import { Agent, createServer, request } from 'node:http';
import { applyAnswer, applyOp, initialMeeting, type MeetingState, type Op } from '../meeting.ts';
import { backoff, observe, type BenchClient, type Impl } from './types.ts';

/**
 * HTTP の定期取得（REST＋ポーリング）。
 *  - 1秒ごとに GET /state で状態の全体を取りに行く
 *  - 操作は POST /op。失敗したら（接続が切れた・返事が来ない）同じ間隔で送り直す。サーバーは重複を捨てない
 *  - ブラウザと同じく、同時に開く接続は6本まで（keep-alive）
 *  - AI の答えは、届いたらそのまま反映する
 */
export const POLL_MS = 1000;

export const httpImpl: Impl = {
  name: 'HTTP',
  async startServer(ledger, ai) {
    const state = initialMeeting();
    let nextId = 0;
    const server = createServer((req, res) => {
      if (req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(state));
        return;
      }
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        const { op, actor } = JSON.parse(body) as { op: Op; actor: string };
        const q = applyOp(state, op, actor, ledger);
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(state));
        if (q) void ai(q.text).then((answer) => applyAnswer(state, q, answer, ledger));
      });
    });
    const port = await new Promise<number>((r) => server.listen(0, '127.0.0.1', () => r((server.address() as { port: number }).port)));
    return {
      port,
      state: () => state,
      close: async () => {
        server.closeAllConnections();
        await new Promise<void>((r) => server.close(() => r()));
      },
    };
  },
  connect(port) {
    let resolveReady!: () => void;
    let closed = false;
    const actor = `h_${Math.random().toString(36).slice(2, 8)}`;
    const agent = new Agent({ keepAlive: true, maxSockets: 6 });
    const call = (method: 'GET' | 'POST', path: string, body?: string) =>
      new Promise<MeetingState>((resolve, reject) => {
        c.messagesOut++;
        const req = request({ host: '127.0.0.1', port, path, method, agent, headers: body ? { 'content-type': 'application/json' } : {} }, (res) => {
          let data = '';
          res.on('data', (d) => (data += d));
          res.on('end', () => {
            try {
              c.messagesIn++;
              resolve(JSON.parse(data) as MeetingState);
            } catch (e) {
              reject(e);
            }
          });
          res.on('error', reject);
        });
        req.setTimeout(5000, () => req.destroy(new Error('timeout')));
        req.on('error', reject);
        req.end(body);
      });
    const poll = async () => {
      while (!closed) {
        try {
          observe(c, await call('GET', '/state'));
          resolveReady();
        } catch {
          // 取れなければ次の回に
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    };
    const post = async (op: Op) => {
      for (let tries = 0; !closed; tries++) {
        try {
          observe(c, await call('POST', '/op', JSON.stringify({ op, actor })));
          return;
        } catch {
          await new Promise((r) => setTimeout(r, backoff(tries)));
        }
      }
    };
    const c: BenchClient = {
      view: null,
      seen: new Map(),
      messagesIn: 0,
      messagesOut: 0,
      ready: new Promise((r) => (resolveReady = r)),
      send: (op) => void post(op),
      close() {
        closed = true;
        agent.destroy();
      },
    };
    void poll();
    return c;
  },
};
