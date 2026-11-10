/**
 * 下段のアイデアの「注目度」と、退場させる案の選び方（仕様書 22.4「下段は新規案を生成し続ける」）。
 *
 * - 触れられる（カーソル・詳細・つかむ・質問）・会話で取り上げられるたびに点数が加わり、時間とともに減る
 * - しばらく触れられていない案だけが退場の候補になる。点数が高いほど「しばらく」が長くなる
 * - 候補の中で点数が最も低い案から退場する
 */

export const ATTENTION_WEIGHTS = {
  hover: 1,
  detail: 3,
  hold: 4,
  question: 5,
  /** 会話でキャラ名を呼ばれた／話しかけられた */
  mentionName: 6,
  /** 会話で企画名（の一部）が出た */
  mentionTitle: 4,
} as const;
export type AttentionKind = keyof typeof ATTENTION_WEIGHTS;

export interface Attention {
  /** scoredAt 時点の点数（減衰前） */
  score: number;
  scoredAt: number;
  lastTouchAt: number;
  /** 会話で取り上げられた回数（表示用） */
  mentions: number;
}

export interface RotationPolicy {
  /** 登場してから退場候補になるまでの最短時間（読む時間） */
  minStageMs: number;
  /** 点数0の案が退場候補になるまでの「触れられていない時間」 */
  baseIdleMs: number;
  /** 点数1あたりに延びる猶予 */
  idlePerScoreMs: number;
  maxIdleMs: number;
  /** 点数が半分になる時間 */
  halfLifeMs: number;
}

export const DEFAULT_ROTATION_POLICY: RotationPolicy = {
  minStageMs: 10_000,
  baseIdleMs: 6_000,
  idlePerScoreMs: 4_000,
  maxIdleMs: 30_000,
  halfLifeMs: 30_000,
};

export function newAttention(now: number): Attention {
  return { score: 0, scoredAt: now, lastTouchAt: now, mentions: 0 };
}

export function currentScore(a: Attention, now: number, policy: RotationPolicy): number {
  return a.score * 0.5 ** (Math.max(0, now - a.scoredAt) / policy.halfLifeMs);
}

export function addAttention(a: Attention, kind: AttentionKind, now: number, policy: RotationPolicy): Attention {
  const isMention = kind === 'mentionName' || kind === 'mentionTitle';
  return {
    score: currentScore(a, now, policy) + ATTENTION_WEIGHTS[kind],
    scoredAt: now,
    lastTouchAt: now,
    mentions: a.mentions + (isMention ? 1 : 0),
  };
}

export function requiredIdleMs(score: number, policy: RotationPolicy) {
  return Math.min(policy.maxIdleMs, policy.baseIdleMs + score * policy.idlePerScoreMs);
}

export interface ExitCandidate {
  instanceId: string;
  spawnedAt: number;
  attention: Attention;
}

/**
 * 退場させる案を1つ選ぶ。該当がなければ null（全部が触れられている間は入れ替えない）。
 * ignoreIdle：手動の「次のアイデア」用。触れられていない時間の条件を外す（保護中の案は選ばない）。
 */
export function pickExitCandidate(
  candidates: ExitCandidate[],
  now: number,
  protectedIds: ReadonlySet<string>,
  policy: RotationPolicy,
  ignoreIdle = false,
): string | null {
  const ranked = candidates
    .filter((c) => !protectedIds.has(c.instanceId))
    .map((c) => ({ c, score: currentScore(c.attention, now, policy) }))
    .filter(({ c, score }) => {
      if (ignoreIdle) return true;
      if (now - c.spawnedAt < policy.minStageMs) return false;
      return now - c.attention.lastTouchAt >= requiredIdleMs(score, policy);
    })
    .sort((a, b) => a.score - b.score || a.c.spawnedAt - b.c.spawnedAt);
  return ranked[0]?.c.instanceId ?? null;
}

/* ------------------------- 会話での言及の検出 ------------------------- */

const toHiragana = (s: string) => s.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));

const strip = (s: string) => s.toLowerCase().replace(/[\s、。，．,.！!？?「」『』（）()・ー〜~]/g, '');
function normalize(s: string) {
  return toHiragana(strip(s));
}

const HIRAGANA = /[ぁ-ゖ]/;

/**
 * 発言の中で、このキャラ（名前）やこの企画（企画名の一部）が取り上げられたか。
 * 企画名は3文字以上の部分文字列で照合する。ただし、テーマに出てこない漢字・カタカナ・英字を
 * 2文字以上含む部分だけを使う（「学食が」「食べた」「ように」のような誰でも使う言葉で誤検出しないため）。
 */
export function detectMention(
  utterance: string,
  target: { name: string; readings: readonly string[]; title: string },
  theme: string,
): 'name' | 'title' | null {
  const u = normalize(utterance);
  if (!u) return null;
  if ([target.name, ...target.readings].some((w) => w && u.includes(normalize(w)))) return 'name';
  // 特徴的な文字かどうかは、カタカナをひらがなに寄せる前の文字で判定する（「ガチャ」は数える）
  const raw = strip(target.title);
  const title = toHiragana(raw);
  const t = normalize(theme);
  for (let len = Math.min(title.length, 8); len >= 3; len--) {
    for (let i = 0; i + len <= title.length; i++) {
      const part = title.slice(i, i + len);
      const distinctive = [...raw.slice(i, i + len)].filter((ch) => !HIRAGANA.test(ch) && !t.includes(toHiragana(ch)));
      if (distinctive.length < 2) continue;
      if (u.includes(part)) return 'title';
    }
  }
  return null;
}
