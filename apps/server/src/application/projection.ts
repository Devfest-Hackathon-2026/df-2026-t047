import { CHARACTER_DESIGNS, JUDGE_SLOTS, type SessionSnapshot } from '@idea-audition/protocol';
import type { AuditionSession } from '../domain/session.ts';
import { computeMetrics } from '../domain/metrics.ts';
import { divergence, normalized, teamTaste } from '../domain/taste.ts';

/** キャラの反応（🤔）を見せておく時間 */
export const REACTION_VISIBLE_MS = 9_000;

const iso = (ms: number) => new Date(ms).toISOString();

/** ドメインの状態 → クライアント向けの投影（DTO は Entity と分ける、ADR-0002） */
export function toSnapshot(s: AuditionSession, seq: number, now = Date.now()): SessionSnapshot {
  const judgeIds = s.judges.map((j) => j.judgeId);
  const div = divergence(s.taste, judgeIds, now);
  return {
    sessionId: s.sessionId,
    seq,
    status: s.status,
    mode: s.mode,
    theme: s.theme,
    lowerSlots: [...s.lowerSlots],
    upper: s.upper.map((f) => ({ ...f })),
    finalists: s.finalistTarget,
    challengeMs: s.challengeMs ?? undefined,
    buzzer: { instanceId: s.lowerSlots[0] ?? null, judgeIds: [...s.buzzers] },
    spotlight: s.spotlight && s.upper.some((f) => f.instanceId === s.spotlight!.instanceId) ? { ...s.spotlight } : null,
    characters: Object.fromEntries(
      [...s.characters.values()].map((c) => {
        const design = CHARACTER_DESIGNS[c.designId]!;
        return [
          c.instanceId,
          {
            instanceId: c.instanceId,
            designId: c.designId,
            name: design.name,
            accent: design.accent,
            location: c.location,
            ideaId: c.ideaId,
            mentions: c.attention.mentions,
            leavingAt: c.leavingAt === null ? null : iso(c.leavingAt),
            spawnedAt: iso(c.spawnedAt),
            paused: c.pausedLeftMs != null,
            pausedLeftMs: c.pausedLeftMs ?? null,
            holdBy: c.holdBy ?? null,
            reaction:
              c.reaction && now - c.reaction.at < REACTION_VISIBLE_MS
                ? { kind: c.reaction.kind, judgeId: c.reaction.judgeId, text: c.reaction.text, at: iso(c.reaction.at) }
                : null,
          },
        ];
      }),
    ),
    ideas: Object.fromEntries(
      [...s.ideas.values()].map((i) => [
        i.ideaId,
        {
          ideaId: i.ideaId,
          revisions: i.revisions.map((r) => ({
            ...r,
            createdAt: iso(r.createdAt),
            basedOnConsensus: r.basedOnConsensus ?? null,
            inspiredBy: r.inspiredBy ?? null,
            profile: r.profile ?? null,
            outline: r.outline ?? null,
          })),
          pitch: i.pitch ?? null,
          persona: i.persona ?? null,
          imageUrl: i.imageUrl ?? null,
        },
      ]),
    ),
    critiques: s.critiques.map((c) => ({ ...c, postedAt: iso(c.postedAt) })),
    answers: s.answers.map((a) => ({ ...a, askedAt: iso(a.askedAt) })),
    ideaBox: s.ideaBox.map((a) => ({
      ideaId: a.ideaId,
      designId: a.designId,
      characterName: CHARACTER_DESIGNS[a.designId]!.name,
      reason: a.reason,
      archivedAt: iso(a.archivedAt),
    })),
    judges: s.judges
      .slice()
      .sort((a, b) => a.slotIndex - b.slotIndex)
      .map((j) => ({
        judgeId: j.judgeId,
        label: j.name || JUDGE_SLOTS[j.slotIndex]!.label,
        name: j.name ?? null,
        letter: JUDGE_SLOTS[j.slotIndex]!.label.slice(-1),
        color: JUDGE_SLOTS[j.slotIndex]!.color,
        isHost: j.isHost,
        connected: j.connected,
        joinedAt: iso(j.joinedAt),
      })),
    vote: s.vote
      ? {
          status: s.vote.status,
          votedJudgeIds: [...s.vote.ballots.keys()],
          tally: s.vote.status === 'open' ? null : s.vote.tally,
          tieInstanceIds: s.vote.tieInstanceIds,
        }
      : null,
    champion: s.champion,
    proposal: s.proposal
      ? {
          status: s.proposal.status,
          content: s.proposal.content,
          generatedAt: s.proposal.generatedAt === null ? null : iso(s.proposal.generatedAt),
          generatedBy: s.proposal.generatedBy,
        }
      : null,
    startedAt: s.startedAt === null ? null : iso(s.startedAt),
    ai: { mode: s.aiMode, available: [...s.aiAvailable] },
    taste: {
      version: s.taste.version,
      judges: Object.fromEntries(judgeIds.map((j) => [j, normalized(s.taste.judges[j], now)])),
      signals: Object.fromEntries(judgeIds.map((j) => [j, s.taste.judges[j]?.signals ?? 0])),
      team: teamTaste(s.taste, judgeIds, now),
      divergence: div,
    },
    metrics: computeMetrics({
      ideas: s.ideas.values(),
      characters: s.characters.values(),
      decisions: s.decisions,
      startedAt: s.startedAt,
      now,
    }),
    consensus: {
      version: s.ledger.version,
      claims: s.ledger.claims.map((c) => {
        const labelOf = new Map(s.ledger.claims.map((x) => [x.claimId, x.label]));
        return {
          label: c.label,
          text: c.text,
          status: c.status,
          pinned: c.pinned,
          stances: Object.fromEntries(Object.entries(c.stances).map(([j, st]) => [j, st.stance])),
          history: c.history.map((h) => ({ judgeId: h.judgeId, stance: h.stance, at: iso(h.at) })),
          supersededBy: c.supersededBy ? (labelOf.get(c.supersededBy) ?? null) : null,
          createdBy: c.createdBy,
          createdAt: iso(c.createdAt),
          updatedAt: iso(c.updatedAt),
        };
      }),
    },
  };
}
