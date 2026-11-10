import type { PitchRole } from '@idea-audition/protocol';
import { cosine, type Vec } from './taste.ts';

/**
 * 候補の選び方（ADR-0009 §5）。純粋関数だけ。乱数は外から渡す（テストで固定できるように）。
 *  - fit：狙った審査員の好みに近い
 *  - bridge：2人の両方に近い（= 近さの小さいほう）
 *  - explore：これまでに出た案から遠い
 *  - wildcard：新しさだけで選ぶ（好みは見ない）
 * どの役割でも、すでに舞台にいる案と似すぎた候補は MMR で減点する。
 */

export interface Candidate {
  index: number;
  profile: Vec;
  embedding: Vec | null;
}

export interface SelectionContext {
  role: PitchRole;
  /** 役割の相手（fit は1人またはチーム、bridge は2人） */
  targets: Vec[];
  /** 狙った審査員が好んだ案の埋め込みの重心（無ければ null） */
  centroids: (Vec | null)[];
  /** 舞台にいる・最近出た案（似すぎ防止） */
  shown: { profile: Vec; embedding: Vec | null }[];
  /** 決勝の案。探る枠・ワイルドカードでは、これに近い候補を強く減点する（同じ方向ばかりにしない） */
  finalists?: { profile: Vec; embedding: Vec | null }[];
  /** MMR の重み */
  mu: number;
  /** 抽選の温度（小さいほど1位に寄る） */
  temperature: number;
}

function similarity(a: { profile: Vec; embedding: Vec | null }, b: { profile: Vec; embedding: Vec | null }) {
  // 埋め込みがあれば文章の近さを主に、無ければプロフィールの近さで代用する
  if (a.embedding && b.embedding) return 0.7 * cosine(a.embedding, b.embedding) + 0.3 * cosine(a.profile, b.profile);
  return cosine(a.profile, b.profile);
}

export function fitTo(c: Candidate, target: Vec, centroid: Vec | null): number {
  const axes = cosine(c.profile, target);
  const text = centroid && c.embedding ? cosine(c.embedding, centroid) : 0;
  return axes + 0.5 * text;
}

export function novelty(c: Candidate, shown: SelectionContext['shown']): number {
  if (shown.length === 0) return 1;
  return 1 - Math.max(...shown.map((s) => similarity(c, s)));
}

/** 探る枠・ワイルドカードおよび好み枠で、決勝の案への近さを減点する重み */
export const FINALIST_AWAY = 0.8;

/** 決勝の案のどれかへの近さ（0〜1）。決勝が無ければ 0 */
export function closeness(c: Candidate, others: SelectionContext['finalists']): number {
  if (!others?.length) return 0;
  return Math.max(0, ...others.map((o) => similarity(c, o)));
}

export function roleScore(c: Candidate, ctx: SelectionContext): number {
  switch (ctx.role) {
    case 'fit':
      return fitTo(c, ctx.targets[0]!, ctx.centroids[0] ?? null) - FINALIST_AWAY * closeness(c, ctx.finalists);
    case 'bridge':
      return Math.min(...ctx.targets.map((t, i) => fitTo(c, t, ctx.centroids[i] ?? null))) - FINALIST_AWAY * closeness(c, ctx.finalists);
    case 'explore':
      return novelty(c, ctx.shown) - FINALIST_AWAY * closeness(c, ctx.finalists);
    case 'wildcard':
      // 新規性の軸が高いものを少し優遇
      return novelty(c, ctx.shown) + 0.3 * (c.profile[1] ?? 0) - FINALIST_AWAY * closeness(c, ctx.finalists);
  }
}

export function mmrScore(c: Candidate, ctx: SelectionContext): number {
  const redundancy = ctx.shown.length ? Math.max(...ctx.shown.map((s) => similarity(c, s))) : 0;
  return roleScore(c, ctx) - ctx.mu * Math.max(0, redundancy);
}

/** p ∝ exp(score / τ) で1つ選ぶ。候補が無ければ null */
export function sample(cands: Candidate[], ctx: SelectionContext, rng: () => number): { index: number; score: number } | null {
  if (cands.length === 0) return null;
  const scored = cands.map((c) => ({ index: c.index, score: mmrScore(c, ctx) }));
  const max = Math.max(...scored.map((s) => s.score));
  const weights = scored.map((s) => Math.exp((s.score - max) / Math.max(0.01, ctx.temperature)));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < scored.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return scored[i]!;
  }
  return scored.at(-1)!;
}
