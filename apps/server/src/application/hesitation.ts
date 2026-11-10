/**
 * 迷いの判定（ADR-0009 ③）。
 * 文字（「うーん」「なんか違う」）と、ブラウザで計算した声の特徴（SOFT_SIGNAL）の両方から来る。
 * 反応しすぎると鬱陶しいので、同じ案には 25 秒、セッション全体では 8 秒あける。
 */

const HESITATION =
  /う[ーぅ〜~]+ん|うー+む|ん[ーー〜]{2,}|微妙|びみょう|どうかな[ぁあ]?|どうだろ|なんか違|ピンと(こ|来)な|うむむ|そうかな[ぁあ]|悩む|迷う/;
const POSITIVE = /いいね|いいじゃん|最高|面白い|おもしろ|好き|ありだな|アリだな|それいい|すごい/;

export type Cue = 'hesitation' | 'positive';

export function detectCue(text: string): Cue | null {
  if (HESITATION.test(text)) return 'hesitation';
  if (POSITIVE.test(text)) return 'positive';
  return null;
}

/** キャラが迷いに気づいたときの一言（キャラの名前で出す） */
export const HESITATION_LINES = [
  'どこが引っかかりました？ちょっと形を変えてみます',
  'うーん、ですよね…別の角度で考え直します',
  '迷わせちゃいました？別バージョンを出しますね',
];

export class HesitationGate {
  private lastByTarget = new Map<string, number>();
  private lastAny = -Infinity;
  private line = 0;

  constructor(
    private readonly perTargetMs = 25_000,
    private readonly anyMs = 8_000,
  ) {}

  /** 今この案に反応してよいか。よければ記録して一言を返す */
  tryReact(instanceId: string, now: number): string | null {
    if (now - this.lastAny < this.anyMs) return null;
    if (now - (this.lastByTarget.get(instanceId) ?? -Infinity) < this.perTargetMs) return null;
    this.lastAny = now;
    this.lastByTarget.set(instanceId, now);
    return HESITATION_LINES[this.line++ % HESITATION_LINES.length]!;
  }

  reset() {
    this.lastByTarget.clear();
    this.lastAny = -Infinity;
  }
}
