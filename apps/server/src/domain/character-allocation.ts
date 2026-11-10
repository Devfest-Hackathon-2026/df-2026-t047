/**
 * 補充キャラのデザインを選ぶ（AC-03, AC-05）。
 * 1. ステージ上（下段・上段）にいるデザインは使わない
 * 2. 直近に退場・昇格したデザインはできるだけ避ける（同じ見た目が同じ枠にすぐ戻らないように）
 * 3. 残りの中で最も長く使われていないものを選ぶ
 */
export function pickDesign(params: {
  designIds: readonly number[];
  onStage: ReadonlySet<number>;
  recentlyDeparted: readonly number[];
  lastUsedAt: ReadonlyMap<number, number>;
}): number | null {
  const free = params.designIds.filter((d) => !params.onStage.has(d));
  if (free.length === 0) return null;
  const fresh = free.filter((d) => !params.recentlyDeparted.includes(d));
  const pool = fresh.length > 0 ? fresh : free;
  return [...pool].sort((a, b) => {
    const ua = params.lastUsedAt.get(a) ?? -1;
    const ub = params.lastUsedAt.get(b) ?? -1;
    return ua - ub || a - b;
  })[0]!;
}
