import { TASTE_AXIS_COUNT } from '@idea-audition/protocol';

/**
 * 好みモデル（ADR-0009 §5）。純粋関数だけ。
 * 審査員ごとに8軸の好みを持ち、反応のたびに「案のプロフィール × 重み」を足す。
 * 古い反応ほど効きが弱くなる（半減期 90 秒）ので、会議の流れが変わると好みも追いかける。
 */

export type Vec = number[];

export interface JudgeTaste {
  /** 減衰つきの重み付き和（範囲は制限しない。表示するときに -1〜+1 にならす） */
  sum: Vec;
  /** 最後に更新した時刻 */
  at: number;
  /** これまでに効いた反応の数 */
  signals: number;
}

export interface TasteState {
  version: number;
  judges: Record<string, JudgeTaste>;
}

export const HALF_LIFE_MS = 90_000;
/** この数より反応が少ない審査員の好みは、選び方にあまり使わない */
export const CONFIDENT_SIGNALS = 5;

export const zeros = (): Vec => Array.from({ length: TASTE_AXIS_COUNT }, () => 0);

export function emptyTaste(): TasteState {
  return { version: 0, judges: {} };
}

export function decayed(t: JudgeTaste, now: number): Vec {
  const k = Math.pow(0.5, Math.max(0, now - t.at) / HALF_LIFE_MS);
  return t.sum.map((v) => v * k);
}

/** 好みに1件の反応を足す。weight が負なら「この方向は好きじゃない」 */
export function applySignal(state: TasteState, judgeId: string, profile: Vec, weight: number, now: number): TasteState {
  const prev = state.judges[judgeId];
  const base = prev ? decayed(prev, now) : zeros();
  const sum = base.map((v, i) => v + weight * (profile[i] ?? 0));
  return {
    version: state.version + 1,
    judges: { ...state.judges, [judgeId]: { sum, at: now, signals: (prev?.signals ?? 0) + 1 } },
  };
}

/** 好みの和をならすときの目安（この値で tanh(1)≒0.76） */
export const TASTE_SCALE = 0.9;

/** 表示・比較用に -1〜+1 にならす（tanh なので、反応が増えるほど端に寄る） */
export function normalized(t: JudgeTaste | undefined, now: number): Vec {
  if (!t) return zeros();
  return decayed(t, now).map((v) => Math.tanh(v / TASTE_SCALE));
}

export function teamTaste(state: TasteState, judgeIds: string[], now: number): Vec {
  const vs = judgeIds.map((j) => normalized(state.judges[j], now));
  if (vs.length === 0) return zeros();
  return zeros().map((_, i) => vs.reduce((a, v) => a + v[i]!, 0) / vs.length);
}

export interface Divergence {
  axis: number;
  judgeA: string;
  judgeB: string;
  gap: number;
}

/** いちばん好みが割れている軸と2人。どちらも反応が溜まっていて、差が十分大きいときだけ */
export function divergence(state: TasteState, judgeIds: string[], now: number, minGap = 0.6): Divergence | null {
  const confident = judgeIds.filter((j) => (state.judges[j]?.signals ?? 0) >= CONFIDENT_SIGNALS);
  let best: Divergence | null = null;
  for (let a = 0; a < confident.length; a++) {
    for (let b = a + 1; b < confident.length; b++) {
      const va = normalized(state.judges[confident[a]!], now);
      const vb = normalized(state.judges[confident[b]!], now);
      for (let i = 0; i < va.length; i++) {
        const gap = Math.abs(va[i]! - vb[i]!);
        if (gap >= minGap && (!best || gap > best.gap)) {
          const [hi, lo] = va[i]! >= vb[i]! ? [confident[a]!, confident[b]!] : [confident[b]!, confident[a]!];
          best = { axis: i, judgeA: hi, judgeB: lo, gap };
        }
      }
    }
  }
  return best;
}

export function cosine(a: Vec, b: Vec): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** 好みの強い軸を上から（符号つき）。プロンプトやカードの理由に使う */
export function strongestAxes(v: Vec, n = 2, threshold = 0.2): { axis: number; value: number }[] {
  return v
    .map((value, axis) => ({ axis, value }))
    .filter((x) => Math.abs(x.value) >= threshold)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, n);
}
