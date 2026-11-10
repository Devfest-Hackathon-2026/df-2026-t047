/**
 * 決勝の案の記号（A案・B案…）。並び順（上段の順）で A から振る。
 * 画面（オフィシャル会議モードの比較表など）と、声の宛先（「A案の費用は？」）で同じ記号を使う。
 */
export const PROPOSAL_LETTERS = ['A', 'B', 'C', 'D'] as const;

/** 全角の英字・読み（エー・ビー…）を、半角の大文字に寄せるための表 */
const READINGS: [RegExp, string][] = [
  [/エー|エイ|えー|えい/g, 'A'],
  [/ビー|びー/g, 'B'],
  [/シー|しー/g, 'C'],
  [/ディー|デー|でぃー|でー/g, 'D'],
];

/**
 * 発言から「A案」「案A」「エー案」「Aの案」のような記号での呼びかけを探し、記号の番号（0 始まり）を返す。無ければ null。
 * いちばん先に出てきた記号を使う
 */
export function findProposalLetter(text: string): number | null {
  let t = text.normalize('NFKC');
  for (const [re, to] of READINGS) t = t.replace(re, to);
  const re = /(?:^|[^A-Za-z])([A-Da-d])\s*(?:の)?\s*案|案\s*([A-Da-d])(?![A-Za-z])/g;
  let best: { index: number; at: number } | null = null;
  for (const m of t.matchAll(re)) {
    const letter = (m[1] ?? m[2])!.toUpperCase();
    const at = m.index ?? 0;
    if (!best || at < best.at) best = { index: PROPOSAL_LETTERS.indexOf(letter as (typeof PROPOSAL_LETTERS)[number]), at };
  }
  return best && best.index >= 0 ? best.index : null;
}
