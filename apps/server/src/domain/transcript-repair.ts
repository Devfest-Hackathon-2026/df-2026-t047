/**
 * 文字起こしの補正（会議の語彙に寄せる）。純粋関数だけ。
 *
 * 音声認識は、会議の中だけで使われる言葉（キャラ名・企画名・論点）をよく聞き間違える
 * （例：「スプラウト」→「ブラウト」「スプラハ」、「混雑予測ナビ」→「混雑予想ナビ」）。
 * 認識の前に語彙を渡すだけでは直りきらないので、認識の後にも、セッションの辞書と比べて直す。
 *
 *  1. 読みの近さ：文字起こしのカタカナの並びを、辞書の言葉の読み（カタカナ）と編集距離で比べる
 *  2. 表記の近さ：漢字を含む企画名は、同じくらいの長さの部分と比べ、最初と最後の字が同じで1〜2字だけ違えば直す
 *     （同音の漢字の取り違え「予測→予想」を想定。意味が逆になる言い換えを避けるため、論点の文章には使わない）
 *  3. 文脈の重み：いまステージにいる・自分が見ている・最近話題になった言葉ほど、直すしきい値を下げる
 *  近さがしきい値に届かなければ直さない（普通の言葉を勝手に変えないことを優先する）。
 */

export interface LexiconEntry {
  /** 直したあとの表記 */
  surface: string;
  /** 読み（カタカナ）。分からなければ null */
  reading: string | null;
  /** 0〜0.15。大きいほど寄せやすい（ステージにいる・見ている・最近話題） */
  boost: number;
}

export interface Correction {
  from: string;
  to: string;
  score: number;
}

const KATAKANA_RUN = /[ァ-ヶー]{2,14}/g;
const HAS_KANJI = /[一-鿿]/;
/** 読みで直すときの基本のしきい値（似ている度合い 0〜1） */
const PHONETIC_THRESHOLD = 0.72;
/** 表記で直す企画名の最短の長さ */
const SURFACE_MIN_LENGTH = 5;

export function toKatakana(text: string): string {
  return text.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

/** 小さい字・長音・濁点の違いは聞き間違えやすいので、比べる前にならす */
function soften(kana: string): string {
  return kana
    .normalize('NFD')
    .replace(/[゙゚]/g, '') // 濁点・半濁点を外す（ブ→フ、プ→フ）
    .normalize('NFC')
    .replace(/[ァィゥェォャュョッ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 1))
    .replace(/ー/g, '');
}

export function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

/** 読みの似ている度合い（0〜1）。濁点などをならした比較と、そのままの比較の平均 */
export function phoneticSimilarity(a: string, b: string): number {
  const raw = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  const sa = soften(a);
  const sb = soften(b);
  const soft = 1 - levenshtein(sa, sb) / Math.max(sa.length, sb.length, 1);
  return (raw + soft) / 2;
}

function bigrams(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

/** 文字の2-gram の重なり（Dice 係数） */
export function surfaceSimilarity(a: string, b: string): number {
  const x = bigrams(a);
  const y = bigrams(b);
  if (x.length === 0 || y.length === 0) return 0;
  const rest = [...y];
  let hit = 0;
  for (const g of x) {
    const k = rest.indexOf(g);
    if (k >= 0) {
      hit++;
      rest.splice(k, 1);
    }
  }
  return (2 * hit) / (x.length + y.length);
}

export function repairTranscript(text: string, lexicon: readonly LexiconEntry[]): { text: string; corrections: Correction[] } {
  const corrections: Correction[] = [];
  let out = text;

  // 1. カタカナの並び × 読み
  const phonetic = lexicon.filter((e) => e.reading && e.reading.length >= 3);
  out = out.replace(KATAKANA_RUN, (run) => {
    if (run.length < 3 || lexicon.some((e) => e.surface === run || e.reading === run)) return run;
    let best: { entry: LexiconEntry; score: number } | null = null;
    for (const entry of phonetic) {
      const r = entry.reading!;
      if (Math.abs(r.length - run.length) > 2) continue;
      // 違う言葉どうし（スタンプカード／スタンプラリー）を寄せないよう、直すのは2字以内の違いまで
      if (levenshtein(run, r) > (r.length <= 3 ? 1 : 2)) continue;
      const score = phoneticSimilarity(run, r);
      if (score >= PHONETIC_THRESHOLD - entry.boost && (!best || score + entry.boost > best.score + best.entry.boost)) {
        best = { entry, score };
      }
    }
    if (!best) return run;
    corrections.push({ from: run, to: best.entry.surface, score: round(best.score) });
    return best.entry.surface;
  });

  // 2. 漢字を含む企画名 × 同じくらいの長さの部分の表記
  for (const entry of lexicon) {
    const target = entry.surface;
    if (!HAS_KANJI.test(target) || target.length < SURFACE_MIN_LENGTH || out.includes(target)) continue;
    const allowance = target.length >= 8 ? 2 : 1;
    let best: { start: number; len: number; dist: number } | null = null;
    for (let len = target.length - 1; len <= target.length + 1; len++) {
      for (let start = 0; start + len <= out.length; start++) {
        const part = out.slice(start, start + len);
        if (part[0] !== target[0] || part.at(-1) !== target.at(-1)) continue;
        // 違ってよいのは漢字だけ（かな・カタカナ・英字の部分は完全に同じ）。カタカナ語の途中で切らない
        if (stripKanji(part) !== stripKanji(target)) continue;
        if (/[ァ-ヶー]/.test(part.at(-1)!) && /[ァ-ヶー]/.test(out[start + len] ?? '')) continue;
        const dist = levenshtein(part, target);
        if (dist <= allowance && (!best || dist < best.dist)) best = { start, len, dist };
      }
    }
    if (!best) continue;
    const from = out.slice(best.start, best.start + best.len);
    corrections.push({ from, to: target, score: round(surfaceSimilarity(from, target)) });
    out = out.slice(0, best.start) + target + out.slice(best.start + best.len);
  }
  return { text: out, corrections };
}

const stripKanji = (t: string) => t.replace(/[\u4e00-\u9fff]/g, '');
const round = (x: number) => Math.round(x * 100) / 100;
