/**
 * 実験：人が同時に動き、遅い AI が割り込む会議を、従来の作りと CAMP で比べる。
 * 仕様：docs/experiments/2026-11-10-camp-vs-conventional.md
 *
 *   pnpm -C packages/camp bench            # 全部（数分）
 *   pnpm -C packages/camp bench -- s2      # 場面を選ぶ（s1 s2 s3 s4）
 *   BENCH_SEED=7 pnpm -C packages/camp bench
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeAi, Link, rng, sleep, type Rng } from './env.ts';
import { Ledger, type MeetingState, type Op } from './meeting.ts';
import { campImpl } from './impl/camp.ts';
import { httpImpl } from './impl/http.ts';
import type { BenchClient, BenchServer, Impl } from './impl/types.ts';
import { wsImpl } from './impl/ws.ts';

const IMPLS: Impl[] = [campImpl, wsImpl(false), wsImpl(true), httpImpl];
const SEED = Number(process.env.BENCH_SEED ?? 1);
const DELAY_MS = 40;

// ---------------------------------------------------------------- 部屋を用意する

interface Rig {
  impl: Impl;
  server: BenchServer;
  ledger: Ledger;
  links: Link[];
  clients: BenchClient[];
  sent: { op: Op; client: number; at: number }[];
  close(): Promise<void>;
}

async function rig(impl: Impl, n: number, delayMs: number, aiRng: Rng): Promise<Rig> {
  const ledger = new Ledger();
  const ai = fakeAi(aiRng);
  // AI を呼んだ回数（＝お金）は、どの作りでも呼んだ瞬間に数える
  const server = await impl.startServer(ledger, (q) => {
    ledger.aiCalls++;
    return ai(q);
  });
  const links = Array.from({ length: n }, () => new Link(server.port, delayMs));
  const clients: BenchClient[] = [];
  for (const l of links) {
    clients.push(impl.connect(await l.port));
  }
  await Promise.all(clients.map((c) => c.ready));
  const r: Rig = {
    impl,
    server,
    ledger,
    links,
    clients,
    sent: [],
    async close() {
      for (const c of clients) c.close();
      for (const l of links) l.close();
      await server.close();
    },
  };
  return r;
}

let opSeq = 0;
type OpInput = { type: 'REACT' } | { type: 'ASK'; text: string } | { type: 'NEXT' };
function send(r: Rig, client: number, op: OpInput) {
  const full = { ...op, opId: `o${++opSeq}` } as Op;
  r.sent.push({ op: full, client, at: performance.now() });
  r.clients[client]!.send(full);
  return full;
}

/** 全員の画面が、サーバーと同じになるまで待つ（最大 ms） */
async function settle(r: Rig, ms: number) {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    if (diverged(r) === 0) return;
    await sleep(50);
  }
}

/** サーバーと画面の状態が違う人数（提案・反応の数・質問・答え） */
function diverged(r: Rig) {
  const s = r.server.state();
  const same = (v: MeetingState | null) =>
    !!v && v.proposal === s.proposal && v.reactions === s.reactions && v.questions.length === s.questions.length && v.answers.length === s.answers.length;
  return r.clients.filter((c) => !same(c.view)).length;
}

/** 送った操作のうち、反映されなかった数・二重以上に反映された回数 */
function delivery(r: Rig) {
  let lost = 0;
  let duplicated = 0;
  for (const { op } of r.sent) {
    const n = r.ledger.applied.get(op.opId) ?? 0;
    if (n === 0) lost++;
    if (n > 1) duplicated += n - 1;
  }
  return { lost, duplicated };
}

const bytes = (r: Rig) => r.links.reduce((a, l) => a + l.bytesUp + l.bytesDown, 0);
const messages = (r: Rig) => r.clients.reduce((a, c) => a + c.messagesIn + c.messagesOut, 0);

function percentile(xs: number[], p: number) {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}

// ---------------------------------------------------------------- 場面

/** S1 同時操作：n 人で合わせて1,000回の反応を一度に送る。切断なし */
async function s1(impl: Impl, n: number) {
  const r = await rig(impl, n, DELAY_MS, rng(SEED));
  const total = 1000;
  const t0 = performance.now();
  for (let i = 0; i < total; i++) send(r, i % n, { type: 'REACT' });
  // 全員の画面が1,000になるまでの時間
  let allAt = NaN;
  const until = t0 + 30_000;
  while (performance.now() < until) {
    if (r.clients.every((c) => c.view?.reactions === total) && r.server.state().reactions === total) {
      allAt = performance.now() - t0;
      break;
    }
    await sleep(5);
  }
  await settle(r, 3000);
  const out = {
    impl: impl.name,
    people: n,
    sent: total,
    serverCount: r.server.state().reactions,
    clientCounts: [...new Set(r.clients.map((c) => c.view?.reactions ?? -1))],
    divergedClients: diverged(r),
    msUntilAllScreens: Math.round(allAt),
    ...delivery(r),
    bytes: bytes(r),
    messages: messages(r),
  };
  await r.close();
  return out;
}

/** S2 切断しながら操作：4人が20秒で反応100回・質問10回ずつ。各人の接続を2〜5秒ごとに切る */
async function s2(impl: Impl, seed: number) {
  const n = 4;
  const r = await rig(impl, n, DELAY_MS, rng(seed * 1000 + 1));
  const plan = rng(seed);
  const DURATION = 20_000;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const t0 = performance.now();
  for (let c = 0; c < n; c++) {
    for (let i = 0; i < 100; i++) timers.push(setTimeout(() => send(r, c, { type: 'REACT' }), plan.between(0, DURATION)));
    for (let i = 0; i < 10; i++) timers.push(setTimeout(() => send(r, c, { type: 'ASK', text: `質問${c}-${i}` }), plan.between(0, DURATION)));
    // 切断の予定（2〜5秒ごと）
    for (let t = plan.between(2000, 5000); t < DURATION; t += plan.between(2000, 5000)) timers.push(setTimeout(() => r.links[c]!.cut(), t));
  }
  await sleep(DURATION + 200);
  // 送り直し・AI の答え（最大3秒）・HTTP の取得を待つ
  await sleep(4000);
  await settle(r, 8000);
  const asks = r.sent.filter((s) => s.op.type === 'ASK').length;
  const out = {
    impl: impl.name,
    seed,
    sent: r.sent.length,
    asks,
    cuts: r.links.reduce((a, l) => a + l.cuts, 0),
    ...delivery(r),
    aiCalls: r.ledger.aiCalls,
    extraAiCalls: r.ledger.aiCalls - new Set(r.sent.filter((s) => s.op.type === 'ASK' && r.ledger.applied.has(s.op.opId)).map((s) => s.op.opId)).size,
    divergedClients: diverged(r),
    seconds: Math.round((performance.now() - t0) / 100) / 10,
  };
  for (const t of timers) clearTimeout(t);
  await r.close();
  return out;
}

/** S3 AI の処理中に話題が変わる：質問 → 0.3〜0.9秒後に次の提案へ。30回 */
async function s3(impl: Impl) {
  const r = await rig(impl, 4, DELAY_MS, rng(SEED * 31));
  const plan = rng(SEED * 17);
  const trials = 30;
  for (let i = 0; i < trials; i++) {
    send(r, 1 + (i % 3), { type: 'ASK', text: `提案${i}への質問` });
    await sleep(plan.between(300, 900));
    send(r, 0, { type: 'NEXT' });
    await sleep(plan.between(200, 600));
  }
  await sleep(3500);
  await settle(r, 3000);
  // 画面に出ている答えのうち、いまの提案ではない答え（最後に全員の画面で数える）
  const shownStale = r.clients.reduce((a, c) => a + (c.view?.answers.filter((x) => x.proposal !== c.view!.proposal).length ?? 0), 0);
  const out = {
    impl: impl.name,
    trials,
    staleAnswersApplied: r.ledger.staleAnswers,
    staleShownAtEnd: shownStale,
    aiCalls: r.ledger.aiCalls,
    ...delivery(r),
  };
  await r.close();
  return out;
}

/** S4 反映までの時間：4人で200回、1秒に10回くらい。切断なし。片道 delayMs */
async function s4(impl: Impl, delayMs: number) {
  const n = 4;
  const r = await rig(impl, n, delayMs, rng(SEED));
  const plan = rng(SEED * 7);
  const ops: Op[] = [];
  for (let i = 0; i < 200; i++) {
    ops.push(send(r, i % n, { type: 'REACT' }));
    await sleep(plan.between(50, 150));
  }
  await sleep(2500);
  await settle(r, 3000);
  const latencies: number[] = [];
  let missing = 0;
  for (const op of ops) {
    const at = r.sent.find((s) => s.op === op)!.at;
    const seen = r.clients.map((c) => c.seen.get(op.opId));
    if (seen.some((x) => x === undefined)) {
      missing++;
      continue;
    }
    latencies.push(Math.max(...(seen as number[])) - at);
  }
  const out = {
    impl: impl.name,
    oneWayDelayMs: delayMs,
    ops: ops.length,
    p50: Math.round(percentile(latencies, 50)),
    p95: Math.round(percentile(latencies, 95)),
    max: Math.round(Math.max(...latencies)),
    notSeenBySomeone: missing,
    bytesPerOp: Math.round(bytes(r) / ops.length),
    messagesPerOp: Math.round((messages(r) / ops.length) * 10) / 10,
  };
  await r.close();
  return out;
}

// ---------------------------------------------------------------- 実行

const only = new Set(process.argv.slice(2).filter((a) => /^s\d$/.test(a)));
const want = (s: string) => only.size === 0 || only.has(s);
const results: Record<string, unknown[]> = {};
const log = (name: string, row: unknown) => {
  (results[name] ??= []).push(row);
  console.log(name, JSON.stringify(row));
};

if (want('s1')) for (const n of [4, 8, 16]) for (const impl of IMPLS) log('s1', await s1(impl, n));
if (want('s2')) for (let seed = 1; seed <= 5; seed++) for (const impl of IMPLS) log('s2', await s2(impl, seed));
if (want('s3')) for (const impl of IMPLS) log('s3', await s3(impl));
if (want('s4')) for (const d of [0, DELAY_MS]) for (const impl of IMPLS) log('s4', await s4(impl, d));

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });
const file = join(outDir, only.size ? `results-${[...only].join('-')}.json` : 'results.json');
writeFileSync(file, JSON.stringify({ seed: SEED, oneWayDelayMs: DELAY_MS, node: process.version, at: new Date().toISOString(), results }, null, 2));
console.log(`\n→ ${file}`);
process.exit(0);
