import { TASTE_AXIS_COUNT } from '@idea-audition/protocol';
import type { EmbeddingPort } from '../application/ports.ts';

/**
 * Gemini を使わずに作る、案の8軸プロフィールと埋め込み（ADR-0009）。
 * 固定データのモードと、Gemini が失敗したときの代わりに使う。精度は低いが、無料で通しデモができる。
 */

/** 軸ごとに、上げる言葉・下げる言葉（TASTE_AXES と同じ順） */
const CUES: [RegExp, RegExp][] = [
  [/大規模|設備|改装|専用|ロボ|開発|建て|導入/, /無料|0円|ゼロ|安く|手作り|既存|紙|ポスター/],
  [/AI|アプリ|VR|AR|ロボ|自動|未知|初|新しい|ゲーム化|バトル/, /定番|昔ながら|いつもの|定食/],
  [/すぐ|手軽|1分|ワンタップ|気軽|立ち寄|スマホ|QR/, /予約|申込|講習|準備|審査/],
  [/SNS|投稿|写真|映え|バズ|ランキング|フェス|対決|イベント/, /静か|こっそり|個人|ひとり/],
  [/毎週|毎日|定期|サブスク|ポイント|スタンプ|続け|習慣|仕組み/, /1日|一度|限定|当日/],
  [/困|支援|地域|環境|健康|フードロス|留学生|バリア|子ども|ボランティア/, /遊び|娯楽|映え/],
  [/全学|全国|街|地域|大会|フェス|みんな/, /1人|ひとり|少人数|小さく/],
  [/誰でも|みんな|全員|初心者|留学生|地域の人/, /上級|マニア|限定|会員/],
];

function hash(text: string, seed: number) {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ((h >>> 0) % 2001) / 1000 - 1; // -1〜+1
}

/** 言葉の手がかり＋文字列から決まる揺らぎで、8軸を -1〜+1 で作る */
export function heuristicProfile(text: string): number[] {
  return Array.from({ length: TASTE_AXIS_COUNT }, (_, i) => {
    const [up, down] = CUES[i]!;
    const cue = (up.test(text) ? 0.6 : 0) - (down.test(text) ? 0.6 : 0);
    const v = cue + 0.35 * hash(text, i + 1);
    return Math.max(-1, Math.min(1, Math.round(v * 100) / 100));
  });
}

/** 文字の2-gram をハッシュして 256 次元にした埋め込み（似た言葉を含む案ほど近くなる） */
export function localEmbedding(text: string, dims = 256): number[] {
  const v = new Array<number>(dims).fill(0);
  const t = text.replace(/\s/g, '');
  for (let i = 0; i < t.length - 1; i++) {
    const k = Math.floor(((hash(t.slice(i, i + 2), 7) + 1) / 2) * (dims - 1));
    v[k]! += 1;
  }
  const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

export class LocalEmbedding implements EmbeddingPort {
  readonly name = 'local';
  async embed(texts: string[]) {
    return texts.map((t) => localEmbedding(t));
  }
}
