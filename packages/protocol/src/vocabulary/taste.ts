import { z } from 'zod';

/**
 * 好みエンジン（ADR-0009）の共有スキーマ。
 * 案は8つの軸で -1〜+1 のプロフィールを持ち、審査員の好みも同じ8軸で表す。
 */
export const TASTE_AXES = [
  { key: 'cost', label: 'コスト', description: '実現にかかるお金と手間（+ほど大がかり）' },
  { key: 'novelty', label: '新規性', description: '見たことのなさ（+ほど新しい）' },
  { key: 'ease', label: '手軽さ', description: 'すぐ参加・実行できるか（+ほど手軽）' },
  { key: 'buzz', label: '話題性', description: '人に話したくなるか（+ほど広がる）' },
  { key: 'sustain', label: '継続性', description: '一度きりで終わらないか（+ほど続く）' },
  { key: 'social', label: '社会性', description: '誰かの困りごとを解くか（+ほど役に立つ）' },
  { key: 'scale', label: '規模', description: '巻き込む範囲の大きさ（+ほど大きい）' },
  { key: 'reach', label: '広さ', description: '対象の広さ（+ほど誰でも）' },
] as const;
export type TasteAxisKey = (typeof TASTE_AXES)[number]['key'];
export const TASTE_AXIS_COUNT = TASTE_AXES.length;

/** 8軸のプロフィール（TASTE_AXES と同じ順） */
export const Profile = z.array(z.number().min(-1).max(1)).length(TASTE_AXIS_COUNT);
export type Profile = z.infer<typeof Profile>;

/** 下段の枠の役割：好みに寄せる／2人の間を取る／新しい方向／ワイルドカード */
export const PitchRole = z.enum(['fit', 'bridge', 'explore', 'wildcard']);
export type PitchRole = z.infer<typeof PitchRole>;

export const PITCH_ROLE_ICON: Record<PitchRole, string> = {
  fit: '💡',
  bridge: '🤝',
  explore: '🧭',
  wildcard: '🎲',
};

/** なぜこの案が出てきたか（カードに出す） */
export const PitchView = z.object({
  role: PitchRole,
  judgeIds: z.array(z.string()),
  reason: z.string(),
});
export type PitchView = z.infer<typeof PitchView>;

export const TasteView = z.object({
  version: z.number().int(),
  /** judgeId → 8軸の好み（-1〜+1） */
  judges: z.record(z.string(), Profile),
  /** judgeId → これまでに効いた反応の数（少ないうちは自信が無い） */
  signals: z.record(z.string(), z.number().int()),
  team: Profile,
  /** いちばん好みが割れている軸と2人（2人以上の好みが溜まってから） */
  divergence: z
    .object({ axis: z.number().int().min(0).max(TASTE_AXIS_COUNT - 1), judgeA: z.string(), judgeB: z.string(), gap: z.number() })
    .nullable(),
});
export type TasteView = z.infer<typeof TasteView>;

/** キャラの反応（「うーん」への 🤔 など） */
export const ReactionView = z.object({
  kind: z.enum(['hesitation', 'revised']),
  judgeId: z.string().nullable(),
  text: z.string(),
  at: z.string(),
});
export type ReactionView = z.infer<typeof ReactionView>;

const PickStat = z.object({ shown: z.number().int(), picked: z.number().int() });

/** 効果の指標（審査レポート用） */
export const MetricsView = z.object({
  firstHalf: PickStat,
  secondHalf: PickStat,
  byRole: z.record(z.string(), PickStat),
  /** 後半の選ばれた率が前半より何％高いか（どちらかが少なすぎるときは null） */
  liftPct: z.number().nullable(),
  /** 迷いに反応して別案を出した回数と、そのあと選ばれた数 */
  revisions: PickStat,
});
export type MetricsView = z.infer<typeof MetricsView>;
