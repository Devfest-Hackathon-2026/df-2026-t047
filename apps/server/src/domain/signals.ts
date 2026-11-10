/**
 * 審査員の行動 → 好みへの効き（ADR-0009 §5）。
 * 強い意思表示（決勝に選ぶ・見送る）ほど大きく、曖昧な反応（見ていた・迷った）は小さく効く。
 */
export const SIGNAL_WEIGHTS = {
  promote: 1.0,
  vote: 0.8,
  champion: 1.0,
  mention: 0.35,
  ask: 0.3,
  detail: 0.3,
  /** 3秒以上見ていたときの最大値（見ていた時間に比例） */
  dwell: 0.15,
  positive: 0.4,
  laugh: 0.3,
  hesitation: -0.35,
  reject: -0.8,
} as const;
export type SignalKind = keyof typeof SIGNAL_WEIGHTS;

/** カーソルを乗せていた時間 → 重み。1.5秒未満は無視 */
export function dwellWeight(ms: number): number {
  if (ms < 1500) return 0;
  return SIGNAL_WEIGHTS.dwell * Math.min(1, ms / 3000);
}
