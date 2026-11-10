import { z } from 'zod';
import { ProposalView } from './proposal.ts';
import { MetricsView, PitchView, Profile, ReactionView, TasteView } from './taste.ts';

/** ステージ定員（acceptance-criteria AC-01, AC-04） */
/** 新しいアイデアは1人ずつ登場する（#5）。合格した3人が最終オーディションへ */
export const LOWER_SLOT_COUNT = 1;
/** 1人の持ち時間（既定）。過ぎたら次の人と交代する。ロビーで変えられる */
export const CHALLENGE_MS = 60_000;
/** ロビーで選べる持ち時間（秒） */
export const CHALLENGE_SEC_OPTIONS = [15, 30, 60, 90] as const;
/** 決勝に進む人数（既定）。ロビーで変えられる */
export const UPPER_CAPACITY = 3;
/** 決勝に進む人数の上限 */
export const MAX_FINALISTS = 4;
export const MAX_JUDGES = 4;

export const CharacterLocation = z.enum(['lower', 'promoting', 'upper', 'exiting', 'archived']);
export type CharacterLocation = z.infer<typeof CharacterLocation>;

export const SessionStatus = z.enum(['lobby', 'audition_active', 'champion_selection', 'completed']);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const SessionMode = z.enum(['solo', 'team']);
export type SessionMode = z.infer<typeof SessionMode>;

/** AI のモード：本物の Gemini（クレジットを使う）か、固定データ（無料・デモ用） */
export const AiMode = z.enum(['gemini', 'fixture']);
export type AiMode = z.infer<typeof AiMode>;

export const FinalistStatus = z.enum(['refining', 'critiquing', 'ready']);
export type FinalistStatus = z.infer<typeof FinalistStatus>;

export const CharacterView = z.object({
  instanceId: z.string(),
  designId: z.number().int(),
  name: z.string(),
  accent: z.string(),
  location: CharacterLocation,
  ideaId: z.string(),
  /** 会話で取り上げられた回数 */
  mentions: z.number().int(),
  /** 退場予告中ならその時刻（ISO）。この時刻に下段から退場する */
  leavingAt: z.string().nullable(),
  /** 審査員の反応へのキャラの反応（🤔 など）。数秒で消える */
  reaction: ReactionView.nullable(),
  /** 深掘りタイム中（質問・議論・じっくり見ている間は交代のカウントを止める） */
  paused: z.boolean().optional(),
  /** 深掘りタイムで止めたときの残り時間（ミリ秒） */
  pausedLeftMs: z.number().nullable().optional(),
  /** 登場した時刻（これまでの挑戦者の並び順） */
  spawnedAt: z.string().optional(),
  /** 一時停止ボタンで止めた審査員（止めていなければ null） */
  holdBy: z.string().nullable().optional(),
});
export type CharacterView = z.infer<typeof CharacterView>;

export const RevisionView = z.object({
  revisionId: z.string(),
  version: z.number().int().min(1),
  title: z.string(),
  summary: z.string(),
  icon: z.string(),
  keepStrengths: z.array(z.string()),
  improvementPoints: z.array(z.string()),
  basedOnRevisionId: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: z.string(),
  /** 生成に使った合意台帳の版（ADR-0007） */
  basedOnConsensus: z.number().int().nullable(),
  /** どの論点を受けて作られたか（系譜） */
  inspiredBy: z.object({ claimLabels: z.array(z.string()), note: z.string() }).nullable(),
  /** 8軸のプロフィール（ADR-0009） */
  profile: Profile.nullable(),
  /** 詳細画面の3行：誰の・何の困りごとを・どう解くか（無い版もある） */
  outline: z.object({ who: z.string(), pain: z.string(), how: z.string() }).nullable().optional(),
});
export type RevisionView = z.infer<typeof RevisionView>;

export const IdeaView = z.object({
  ideaId: z.string(),
  revisions: z.array(RevisionView).min(1),
  /** なぜこの案が出てきたか（💡 🤝 🧭 🎲） */
  pitch: PitchView.nullable(),
  /** 発想の型（例：逆転の発想） */
  persona: z.string().nullable(),
  /** 案のイメージ画像（決勝の案だけ。サーバーの /api/images/... を指す。まだ無ければ null） */
  imageUrl: z.string().nullable().optional(),
});
export type IdeaView = z.infer<typeof IdeaView>;

export const FinalistView = z.object({
  instanceId: z.string(),
  status: FinalistStatus,
});
export type FinalistView = z.infer<typeof FinalistView>;

export const CritiqueView = z.object({
  critiqueId: z.string(),
  round: z.number().int().min(1),
  fromInstanceId: z.string(),
  toInstanceId: z.string(),
  text: z.string(),
  postedAt: z.string(),
});
export type CritiqueView = z.infer<typeof CritiqueView>;

export const JudgeView = z.object({
  judgeId: z.string(),
  /** 画面に出す呼び名。名前を入れていれば名前、なければ「審査員 A」 */
  label: z.string(),
  /** 入れた名前（未入力なら null） */
  name: z.string().nullable().optional(),
  /** 席の記号（A〜D）。丸いアイコンに使う */
  letter: z.string().optional(),
  color: z.string(),
  isHost: z.boolean(),
  connected: z.boolean(),
  joinedAt: z.string(),
});
export type JudgeView = z.infer<typeof JudgeView>;

export const VoteView = z.object({
  status: z.enum(['open', 'tie', 'closed']),
  /** 締め切り前は「誰が投票したか」だけを公開する（ADR-0004） */
  votedJudgeIds: z.array(z.string()),
  tally: z.record(z.string(), z.number()).nullable(),
  tieInstanceIds: z.array(z.string()),
});
export type VoteView = z.infer<typeof VoteView>;

export const ArchivedIdeaView = z.object({
  ideaId: z.string(),
  designId: z.number().int(),
  characterName: z.string(),
  reason: z.enum(['rotated', 'replaced', 'rejected']),
  archivedAt: z.string(),
});
export type ArchivedIdeaView = z.infer<typeof ArchivedIdeaView>;

export const AnswerView = z.object({
  answerId: z.string(),
  instanceId: z.string(),
  judgeId: z.string(),
  question: z.string(),
  answer: z.string().nullable(),
  askedAt: z.string(),
});
export type AnswerView = z.infer<typeof AnswerView>;

export const ClaimView = z.object({
  label: z.string(),
  text: z.string(),
  status: z.enum(['proposed', 'agreed', 'rejected', 'superseded']),
  pinned: z.boolean(),
  /** judgeId → 最新の賛否 */
  stances: z.record(z.string(), z.enum(['support', 'oppose'])),
  /** 賛否の時系列（誰がいつ） */
  history: z.array(z.object({ judgeId: z.string(), stance: z.enum(['support', 'oppose']), at: z.string() })),
  supersededBy: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ClaimView = z.infer<typeof ClaimView>;

/**
 * セッションの投影（クライアントが持つのはこれだけ）。
 * 判定ロジックはサーバーにのみ存在する（ADR-0002）。
 */
export const SessionSnapshot = z.object({
  sessionId: z.string(),
  seq: z.number().int(),
  status: SessionStatus,
  mode: SessionMode,
  theme: z.string(),
  /** 長さ5。準備中の枠は null */
  lowerSlots: z.array(z.string().nullable()),
  /** 並びは昇格順。finalists 人そろうまでは「合格者待機室」 */
  upper: z.array(FinalistView),
  /** 決勝に進む人数（ロビーで選ぶ。ホストが途中で決勝に進めたら、その時点の人数） */
  finalists: z.number().int().optional(),
  /** 1人の持ち時間（ミリ秒） */
  challengeMs: z.number().int().optional(),
  /** いまの挑戦者に、ゴールデンブザーを押している審査員 */
  buzzer: z.object({ instanceId: z.string().nullable(), judgeIds: z.array(z.string()) }).optional(),
  /** 最終オーディションでみんなが注目しているキャラ（スポットライト）と、選んだ人 */
  spotlight: z.object({ instanceId: z.string(), byJudgeId: z.string().nullable() }).nullable().optional(),
  characters: z.record(z.string(), CharacterView),
  ideas: z.record(z.string(), IdeaView),
  critiques: z.array(CritiqueView),
  answers: z.array(AnswerView),
  ideaBox: z.array(ArchivedIdeaView),
  judges: z.array(JudgeView),
  vote: VoteView.nullable(),
  champion: z
    .object({ instanceId: z.string(), ideaId: z.string(), revisionId: z.string() })
    .nullable(),
  /** 合意台帳（ADR-0007） */
  consensus: z.object({ version: z.number().int(), claims: z.array(ClaimView) }),
  /** 優勝案の企画書（優勝が決まると自動で作り始める） */
  proposal: ProposalView.nullable(),
  /** セッション開始時刻（審査レポート用） */
  startedAt: z.string().nullable(),
  /** いまの AI のモードと、このサーバーで選べるモード */
  ai: z.object({ mode: AiMode, available: z.array(AiMode) }),
  /** 好みエンジン（ADR-0009） */
  taste: TasteView,
  metrics: MetricsView,
});
export type SessionSnapshot = z.infer<typeof SessionSnapshot>;
