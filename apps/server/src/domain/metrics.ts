import type { MetricsView } from '@idea-audition/protocol';
import type { CharacterInstance, DecisionRecord, Idea } from './types.ts';

/** 迷いを受けて作った別案の版に付ける理由の書き出し（指標で数えるため） */
export const HESITATION_REVISION_REASON = '迷いを受けて';

/** 前半・後半で何％増えたかを出すのに必要な、それぞれの最低の登場数 */
const MIN_SHOWN_FOR_LIFT = 4;
/**
 * 同じく、それぞれの最低の「選ばれた数」。1件と2件の比較で「+100%」のように大きく見せないため
 * （プレイテスト 2026-11-08 で、前半1件・後半2件から +167% が出た）
 */
export const MIN_PICKED_FOR_LIFT = 3;

/**
 * 効果の指標（ADR-0009 §2-4）。純粋関数。
 * 「下段に出た案のうち、決勝に選ばれた割合」を、セッションの前半と後半、出した理由（💡🤝🧭🎲）ごとに数える。
 * 後半のほうが高ければ、好みを読んで出し方を変えたことが効いている、という証拠になる。
 */
export function computeMetrics(input: {
  ideas: Iterable<Idea>;
  characters: Iterable<CharacterInstance>;
  decisions: readonly DecisionRecord[];
  startedAt: number | null;
  now: number;
}): MetricsView {
  const ideaToInstance = new Map<string, string>();
  for (const c of input.characters) ideaToInstance.set(c.ideaId, c.instanceId);
  const promoted = new Set(input.decisions.filter((d) => d.kind === 'promoted').map((d) => d.instanceId));
  const mid = input.startedAt === null ? input.now : (input.startedAt + input.now) / 2;

  const firstHalf = { shown: 0, picked: 0 };
  const secondHalf = { shown: 0, picked: 0 };
  const byRole: Record<string, { shown: number; picked: number }> = {};
  const revisions = { shown: 0, picked: 0 };

  for (const idea of input.ideas) {
    const instanceId = ideaToInstance.get(idea.ideaId);
    if (!instanceId) continue;
    const picked = promoted.has(instanceId) ? 1 : 0;
    const half = idea.revisions[0]!.createdAt < mid ? firstHalf : secondHalf;
    half.shown++;
    half.picked += picked;
    const role = idea.pitch?.role;
    if (role) {
      const r = (byRole[role] ??= { shown: 0, picked: 0 });
      r.shown++;
      r.picked += picked;
    }
    if (idea.revisions.some((r) => r.reason?.startsWith(HESITATION_REVISION_REASON))) {
      revisions.shown++;
      revisions.picked += picked;
    }
  }

  const rate = (h: { shown: number; picked: number }) => (h.shown === 0 ? 0 : h.picked / h.shown);
  const liftPct =
    firstHalf.shown >= MIN_SHOWN_FOR_LIFT &&
    secondHalf.shown >= MIN_SHOWN_FOR_LIFT &&
    firstHalf.picked >= MIN_PICKED_FOR_LIFT &&
    secondHalf.picked >= MIN_PICKED_FOR_LIFT
      ? Math.round(((rate(secondHalf) - rate(firstHalf)) / rate(firstHalf)) * 100)
      : null;
  return { firstHalf, secondHalf, byRole, liftPct, revisions };
}
