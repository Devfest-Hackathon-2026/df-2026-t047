import { TASTE_AXES, type TasteView } from '@idea-audition/protocol';

type TasteSignals = Pick<TasteView, 'judges' | 'signals'>;

/**
 * 好みが読み取れている審査員（反応が1回以上あり、好みの値がある人）だけを、審査員の並び順のまま返す。
 * レーダーに形を描く人・凡例に出す人・「まだ分からない」と出すかの判定に使う。
 */
export function activeTasteJudges<J extends { judgeId: string }>(taste: TasteSignals, judges: readonly J[]): J[] {
  return judges.filter((j) => !!taste.judges[j.judgeId] && (taste.signals[j.judgeId] ?? 0) > 0);
}

/**
 * 好みを「読み取れた」と言えるまでの反応の回数（1人あたり）。
 * 2〜3回だと、たまたま押した案の特徴がそのまま好みに見えてしまうので、それまでは「読み取り中」と出す
 */
export const TASTE_MIN_SIGNALS = 5;

/** 好みを読み取れた（反応が TASTE_MIN_SIGNALS 回以上あり、好みの値がある） */
export function isTasteRead(taste: TasteSignals, judgeId: string): boolean {
  return !!taste.judges[judgeId] && (taste.signals[judgeId] ?? 0) >= TASTE_MIN_SIGNALS;
}

/** 読み取れるまで、あと何回の反応が要るか */
export function signalsUntilRead(taste: TasteSignals, judgeId: string): number {
  return Math.max(0, TASTE_MIN_SIGNALS - (taste.signals[judgeId] ?? 0));
}

/**
 * 好みの傾きを短い言葉にする（強い2軸まで）。断定しないよう「〜寄り」と言う。偏りが小さければ空
 */
export function tasteLeaning(v: readonly number[]): string[] {
  return v
    .map((x, i) => ({ x, i }))
    .sort((a, b) => Math.abs(b.x) - Math.abs(a.x))
    .slice(0, 2)
    .filter((t) => Math.abs(t.x) >= 0.2)
    .map((t) => `${TASTE_AXES[t.i]!.label}${t.x > 0 ? '' : '控えめ'}寄り`);
}
