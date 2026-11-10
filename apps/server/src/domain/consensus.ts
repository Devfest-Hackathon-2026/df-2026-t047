/**
 * 合意台帳（Consensus Ledger、ADR-0007）。
 *
 * 審査中の会話から「論点」を取り出し、審査員ごとの賛否を時系列で記録する。
 * - 元の出来事（発言・昇格・見送り・投票）はイベントとして追記のみで残り、台帳はそこから作る表
 * - 台帳は「操作（op）」の追記でだけ更新し、版番号（version）を上げる。LLM は op を提案するだけ
 * - 状態（提案中・合意・却下・置き換え）は賛否から決定的に計算する（LLM に決めさせない）
 */

export type Stance = 'support' | 'oppose';
export type ClaimStatus = 'proposed' | 'agreed' | 'rejected' | 'superseded';

export interface StanceRecord {
  stance: Stance;
  /** 根拠になった発言のイベント seq（行動・ピン留めなら null） */
  seq: number | null;
  at: number;
}

export interface Claim {
  claimId: string;
  /** 表示・LLM 用のラベル（C1, C2…） */
  label: string;
  text: string;
  /** 審査員ごとの最新の賛否（judgeId → 記録）。時系列は history に残す */
  stances: Record<string, StanceRecord>;
  history: { judgeId: string; stance: Stance; seq: number | null; at: number }[];
  /** 人が「これで決まり」と確定した */
  pinned: boolean;
  supersededBy: string | null;
  createdAt: number;
  createdBy: string | null;
  updatedAt: number;
  status: ClaimStatus;
}

export interface Ledger {
  version: number;
  claims: Claim[];
  nextNumber: number;
}

export function emptyLedger(): Ledger {
  return { version: 0, claims: [], nextNumber: 1 };
}

/** 台帳への操作。LLM が返す op は label（C1 など）で論点を指す */
export type LedgerOp =
  | { op: 'add_claim'; text: string; judgeId: string | null; stance: Stance | null; seq: number | null }
  | { op: 'set_stance'; label: string; judgeId: string; stance: Stance; seq: number | null }
  | { op: 'supersede'; label: string; byLabel: string }
  | { op: 'pin'; label: string; judgeId: string }
  | { op: 'unpin'; label: string; judgeId: string };

export interface ApplyResult {
  ledger: Ledger;
  /** 適用できた op（存在しない論点への op などは捨てる） */
  applied: LedgerOp[];
  /** 状態が変わった論点（合意になった等の通知用） */
  statusChanges: { label: string; text: string; from: ClaimStatus | null; to: ClaimStatus }[];
}

/** 合意に必要な賛成数：接続中の審査員の過半数（1人なら1、2人なら2、3人なら2、4人なら3） */
export function quorum(connectedJudges: number) {
  return Math.floor(Math.max(1, connectedJudges) / 2) + 1;
}

export function computeStatus(claim: Claim, connectedJudges: number): ClaimStatus {
  if (claim.supersededBy) return 'superseded';
  if (claim.pinned) return 'agreed';
  const values = Object.values(claim.stances);
  const support = values.filter((s) => s.stance === 'support').length;
  const oppose = values.filter((s) => s.stance === 'oppose').length;
  const need = quorum(connectedJudges);
  if (support >= need && support > oppose) return 'agreed';
  if (oppose >= need || (oppose > 0 && support === 0)) return 'rejected';
  return 'proposed';
}

const MAX_CLAIMS = 40;
const MAX_CLAIM_TEXT = 60;

/**
 * op を順番どおりに当てはめる（純粋関数）。
 * 1回の呼び出しで何件当てはめても version は1つだけ上がる。
 */
export function applyOps(
  ledger: Ledger,
  ops: LedgerOp[],
  ctx: { now: number; connectedJudges: number; newId: () => string; validJudgeIds: ReadonlySet<string> },
): ApplyResult {
  const claims = ledger.claims.map((c) => ({ ...c, stances: { ...c.stances }, history: [...c.history] }));
  let nextNumber = ledger.nextNumber;
  const before = new Map(claims.map((c) => [c.label, c.status]));
  const applied: LedgerOp[] = [];
  const byLabel = (label: string) => claims.find((c) => c.label === label.trim());

  const recordStance = (c: Claim, judgeId: string, stance: Stance, seq: number | null) => {
    const prev = c.stances[judgeId];
    if (prev?.stance === stance) return false;
    c.stances[judgeId] = { stance, seq, at: ctx.now };
    c.history.push({ judgeId, stance, seq, at: ctx.now });
    c.updatedAt = ctx.now;
    return true;
  };

  for (const op of ops) {
    switch (op.op) {
      case 'add_claim': {
        const text = op.text.trim().slice(0, MAX_CLAIM_TEXT);
        if (!text || claims.some((c) => c.text === text && c.status !== 'superseded')) continue;
        if (claims.filter((c) => c.status !== 'superseded').length >= MAX_CLAIMS) continue;
        const judgeId = op.judgeId && ctx.validJudgeIds.has(op.judgeId) ? op.judgeId : null;
        const claim: Claim = {
          claimId: ctx.newId(),
          label: `C${nextNumber++}`,
          text,
          stances: {},
          history: [],
          pinned: false,
          supersededBy: null,
          createdAt: ctx.now,
          createdBy: judgeId,
          updatedAt: ctx.now,
          status: 'proposed',
        };
        if (judgeId) recordStance(claim, judgeId, op.stance ?? 'support', op.seq);
        claims.push(claim);
        applied.push(op);
        break;
      }
      case 'set_stance': {
        const c = byLabel(op.label);
        if (!c || c.supersededBy || !ctx.validJudgeIds.has(op.judgeId)) continue;
        if (recordStance(c, op.judgeId, op.stance, op.seq)) applied.push(op);
        break;
      }
      case 'supersede': {
        const c = byLabel(op.label);
        const by = byLabel(op.byLabel);
        if (!c || !by || c === by || c.supersededBy) continue;
        c.supersededBy = by.claimId;
        c.pinned = false;
        c.updatedAt = ctx.now;
        applied.push(op);
        break;
      }
      case 'pin':
      case 'unpin': {
        const c = byLabel(op.label);
        if (!c || c.supersededBy) continue;
        const pinned = op.op === 'pin';
        if (c.pinned === pinned) continue;
        c.pinned = pinned;
        c.updatedAt = ctx.now;
        if (pinned && ctx.validJudgeIds.has(op.judgeId)) recordStance(c, op.judgeId, 'support', null);
        applied.push(op);
        break;
      }
    }
  }

  const statusChanges: ApplyResult['statusChanges'] = [];
  for (const c of claims) {
    const to = computeStatus(c, ctx.connectedJudges);
    const from = before.get(c.label) ?? null;
    c.status = to;
    if (from !== to) statusChanges.push({ label: c.label, text: c.text, from, to });
  }
  return {
    ledger: { version: applied.length > 0 ? ledger.version + 1 : ledger.version, claims, nextNumber },
    applied,
    statusChanges,
  };
}

/** 接続人数が変わったときなどに状態だけ計算し直す */
export function recomputeStatuses(ledger: Ledger, connectedJudges: number): Ledger {
  return {
    ...ledger,
    claims: ledger.claims.map((c) => ({ ...c, status: computeStatus(c, connectedJudges) })),
  };
}
