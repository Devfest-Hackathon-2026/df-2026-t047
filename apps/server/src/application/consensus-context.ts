import { JUDGE_SLOTS } from '@idea-audition/protocol';
import type { AuditionSession } from '../domain/session.ts';
import type { LedgerOp } from '../domain/consensus.ts';
import type { ConsensusContext, ConsensusOpDraft, ConsensusUpdateInput } from './ports.ts';

/** 審査員の ID ↔ 表示ラベル（「審査員 A」）。LLM には ID を渡さない */
export function judgeLabels(s: AuditionSession) {
  const toLabel = new Map<string, string>(s.judges.map((j) => [j.judgeId, JUDGE_SLOTS[j.slotIndex]!.label]));
  const toId = new Map<string, string>([...toLabel.entries()].map(([id, label]) => [label, id]));
  return { toLabel, toId };
}

const RECENT_REMARKS = 6;

/** LLM に渡す審査の文脈（L1）を、合意台帳と行動の記録から作る */
export function buildConsensusContext(s: AuditionSession): ConsensusContext {
  const { toLabel } = judgeLabels(s);
  const names = (ids: string[]) => ids.map((id) => toLabel.get(id) ?? '審査員');
  const claims = s.ledger.claims;
  const stanceIds = (stances: Record<string, { stance: string }>, stance: string) =>
    Object.entries(stances)
      .filter(([, v]) => v.stance === stance)
      .map(([k]) => k);
  const unique = (xs: string[]) => [...new Set(xs)];
  const mentionedTitles = [...s.characters.values()]
    .filter((c) => c.attention.mentions >= 2)
    .map((c) => s.currentRevision(c.ideaId).title);
  return {
    version: s.ledger.version,
    agreed: claims
      .filter((c) => c.status === 'agreed')
      .map((c) => ({ label: c.label, text: c.text, supporters: names(stanceIds(c.stances, 'support')) })),
    proposed: claims
      .filter((c) => c.status === 'proposed')
      .map((c) => ({
        label: c.label,
        text: c.text,
        support: names(stanceIds(c.stances, 'support')),
        oppose: names(stanceIds(c.stances, 'oppose')),
      })),
    rejected: claims.filter((c) => c.status === 'rejected').map((c) => ({ label: c.label, text: c.text })),
    favoredIdeas: unique([
      ...s.decisions.filter((d) => d.kind === 'promoted' || d.kind === 'champion').map((d) => d.title),
      ...mentionedTitles,
    ]).slice(-8),
    rejectedIdeas: unique(s.decisions.filter((d) => d.kind === 'rejected').map((d) => d.title)).slice(-8),
    recentRemarks: s.utterances.slice(-RECENT_REMARKS).map((u) => ({ judge: toLabel.get(u.judgeId) ?? '審査員', text: u.text })),
  };
}

/** 台帳の差分を作るための入力（前回以降の発言と行動だけを渡す） */
export function buildConsensusUpdateInput(
  s: AuditionSession,
  decisionsSince: number,
  replyTo: ReadonlyMap<number, string>,
): ConsensusUpdateInput {
  const { toLabel } = judgeLabels(s);
  const titleOf = (id: string | null) => {
    const c = id ? s.characters.get(id) : undefined;
    return c ? s.currentRevision(c.ideaId).title : null;
  };
  return {
    theme: s.theme,
    nextClaimNumber: s.ledger.nextNumber,
    judges: s.judges.map((j) => toLabel.get(j.judgeId)!),
    claims: s.ledger.claims
      .filter((c) => c.status !== 'superseded')
      .map((c) => ({
        label: c.label,
        text: c.text,
        status: c.status,
        stances: Object.entries(c.stances).map(([j, v]) => ({ judge: toLabel.get(j) ?? '審査員', stance: v.stance })),
      })),
    utterances: s.pendingUtterances().map((u) => ({
      seq: u.seq,
      judge: toLabel.get(u.judgeId) ?? '審査員',
      text: u.text,
      target: titleOf(u.targetInstanceId),
      replyToClaim: replyTo.get(u.seq) ?? null,
    })),
    // 人の行動だけを渡す。下段の自動の入れ替え（timed_out）や AI の処理は、誰の判断でもないので根拠にしない
    decisions: s.decisions
      .filter((d) => d.at > decisionsSince && d.judgeId !== null && d.kind !== 'timed_out')
      .map((d) => ({ kind: d.kind, title: d.title, judge: d.judgeId ? (toLabel.get(d.judgeId) ?? null) : null })),
  };
}

/** LLM の提案（ラベル）を台帳の操作（ID）に直す。知らない審査員の op は捨てる */
export function toLedgerOps(s: AuditionSession, drafts: ConsensusOpDraft[]): LedgerOp[] {
  const { toId } = judgeLabels(s);
  const ops: LedgerOp[] = [];
  // 企画名そのものは論点（方針・条件）ではないので台帳に入れない
  const titles = new Set([...s.ideas.values()].flatMap((i) => i.revisions.map((r) => normalizeText(r.title))));
  for (const d of drafts) {
    if (d.op === 'add_claim') {
      const judgeId = d.judge ? (toId.get(d.judge) ?? null) : null;
      if (titles.has(normalizeText(d.text))) continue;
      // 発言に結び付かない（行動から作った）論点は、同じ人が2回以上選んだときだけ（1回の選抜で方針を決めつけない）
      if (d.seq === null) {
        const picks = s.decisions.filter((x) => x.kind === 'promoted' && x.judgeId === judgeId).length;
        if (!judgeId || picks < 2) continue;
      }
      ops.push({ op: 'add_claim', text: d.text, judgeId, stance: d.stance, seq: d.seq });
    } else if (d.op === 'set_stance') {
      const judgeId = toId.get(d.judge);
      if (judgeId) ops.push({ op: 'set_stance', label: d.label, judgeId, stance: d.stance, seq: d.seq });
    } else {
      ops.push({ op: 'supersede', label: d.label, byLabel: d.byLabel });
    }
  }
  return ops;
}

function normalizeText(t: string) {
  return t.replace(/[\s「」『』、。・！？!?]/g, '');
}
