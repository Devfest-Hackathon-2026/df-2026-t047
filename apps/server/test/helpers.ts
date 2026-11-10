import type {
  ConsensusContext,
  ConsensusOpDraft,
  ConsensusUpdateInput,
  IdeaGenerationPort,
  ProposalImageInput,
  ProposalInput,
  RefineInput,
  RefineOutput,
  Scheduler,
  UtteranceTriage,
  UtteranceTriageInput,
  VaryInput,
} from '../src/application/ports.ts';
import type { IdeaDraft } from '../src/domain/types.ts';
import type { Connection } from '../src/application/session-actor.ts';
import type { ServerMessage } from '@idea-audition/protocol';

export function fakeClock() {
  let t = 1_700_000_000_000;
  return { now: () => (t += 1000) };
}

export function seqIds() {
  let n = 0;
  return { next: (p: string) => `${p}_${++n}` };
}

export function drafts(n: number, prefix = '案'): IdeaDraft[] {
  return Array.from({ length: n }, (_, i) => ({ title: `${prefix}${i + 1}`, summary: `説明${i + 1}`, icon: '◇' }));
}

/** 手動で進めるスケジューラー */
export function manualScheduler() {
  let now = 0;
  let id = 0;
  const timers = new Map<number, { at: number; fn: () => void; every?: number }>();
  const scheduler: Scheduler = {
    setTimeout(fn, ms) {
      const k = ++id;
      timers.set(k, { at: now + ms, fn });
      return () => timers.delete(k);
    },
    setInterval(fn, ms) {
      const k = ++id;
      timers.set(k, { at: now + ms, fn, every: ms });
      return () => timers.delete(k);
    },
  };
  async function advance(ms: number) {
    const end = now + ms;
    for (;;) {
      await flushPromises();
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [k, t] = due;
      now = t.at;
      if (t.every) t.at += t.every;
      else timers.delete(k);
      t.fn();
    }
    now = end;
    await flushPromises();
  }
  return { scheduler, advance };
}

export async function flushPromises() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** 即時に応答する AI スタブ */
export class StubAi implements IdeaGenerationPort {
  constructor(readonly name = 'stub') {}
  refineCalls: RefineInput[] = [];
  private n = 0;
  async generateIdeas(input: { count: number; context?: ConsensusContext }) {
    this.generateCalls.push({ context: input.context });
    return drafts(input.count, `生成${++this.n}-`);
  }
  async refine(input: RefineInput): Promise<RefineOutput> {
    this.refineCalls.push(input);
    const critiques = Array.from({ length: input.participants.length > 1 ? input.rounds : 0 }, (_, i) => ({
      round: i + 1,
      fromInstanceId: input.participants[i % input.participants.length]!.instanceId,
      toInstanceId: input.participants[(i + 1) % input.participants.length]!.instanceId,
      text: `批評${i + 1}`,
    }));
    const revisions = Object.fromEntries(
      input.targets.map((id) => [
        id,
        { title: '改良版', summary: '改良後', keepStrengths: ['強み'], improvementPoints: ['改善'], reason: '理由' },
      ]),
    );
    return { critiques, revisions };
  }
  proposalCalls: ProposalInput[] = [];
  proposalImageCalls: ProposalImageInput[] = [];
  failProposal = false;
  failProposalImage = false;
  async generateProposal(input: ProposalInput) {
    this.proposalCalls.push(input);
    if (this.failProposal) throw new Error('proposal failed');
    const t = input.champion.revisions.at(-1)!.title;
    return {
      title: t, catchphrase: 'c', background: 'b', problem: 'p', target: 't', value: 'v', overview: 'o',
      features: [], plan: [], resources: 'r', budget: 'b', risks: [], kpis: [], nextActions: [], assumptions: [],
    };
  }
  async generateProposalImage(input: ProposalImageInput) {
    this.proposalImageCalls.push(input);
    if (this.failProposalImage) throw new Error('proposal image failed');
    return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"><text>${encodeURIComponent(input.title)}</text></svg>`;
  }
  consensusCalls: ConsensusUpdateInput[] = [];
  nextConsensusOps: ConsensusOpDraft[] = [];
  generateCalls: { context?: ConsensusContext }[] = [];
  async updateConsensus(input: ConsensusUpdateInput) {
    this.consensusCalls.push(input);
    // 本物のモデルと同じく、発言から作った論点にはその発言の番号を付ける（番号の無い論点は行動から作ったものとして扱われる）
    const lastSeq = input.utterances.at(-1)?.seq ?? null;
    const ops = this.nextConsensusOps.map((o) => (o.op === 'add_claim' && o.seq === null && lastSeq !== null ? { ...o, seq: lastSeq } : o));
    this.nextConsensusOps = [];
    return ops;
  }
  answerCalls: string[] = [];
  async answer(input: { question: string }) {
    this.answerCalls.push(input.question);
    // 「もにゃもにゃ」を含む質問は、意味が通らないものとして扱う（聞き間違いのテスト用）
    if (input.question.includes('もにゃもにゃ')) return null;
    return `回答:${input.question}`;
  }
  triageCalls: UtteranceTriageInput[] = [];
  /** 次の仕分けの結果（テストで差し替える）。既定は「そのまま残す」 */
  nextTriage: (input: UtteranceTriageInput) => UtteranceTriage = () => ({ keep: true, summary: null });
  failTriage = false;
  async triageUtterance(input: UtteranceTriageInput) {
    this.triageCalls.push(input);
    if (this.failTriage) throw new Error('triage failed');
    return this.nextTriage(input);
  }
  varyCalls: VaryInput[] = [];
  async varyIdea(input: VaryInput) {
    this.varyCalls.push(input);
    return { title: `${input.idea.title}別案`, summary: '別案\n中身', icon: '◎', profile: input.idea.profile ?? undefined, keepStrengths: ['良さ'], improvementPoints: ['小さく試す'], changeNote: '小さく始める形に' };
  }
}

export function fakeConnection(id: string) {
  const received: ServerMessage[] = [];
  const conn: Connection = { id, send: (m) => received.push(m) };
  return { conn, received };
}
