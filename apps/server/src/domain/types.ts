import type {
  CharacterLocation,
  EventType,
  FinalistStatus,
  RejectReason,
  SessionMode,
  SessionStatus,
} from '@idea-audition/protocol';
import type { Attention } from './attention.ts';
import type { Ledger } from './consensus.ts';
import type { AiMode, PitchRole, ProposalContent } from '@idea-audition/protocol';
import type { TasteState } from './taste.ts';

/** なぜこの案が下段に出てきたか（ADR-0009） */
export interface Pitch {
  role: PitchRole;
  judgeIds: string[];
  reason: string;
}

/** キャラの反応（🤔 など）。数秒で消える */
export interface Reaction {
  kind: 'hesitation' | 'revised';
  judgeId: string | null;
  text: string;
  at: number;
}

export interface Proposal {
  status: 'generating' | 'ready' | 'failed';
  content: ProposalContent | null;
  generatedAt: number | null;
  generatedBy: string | null;
}

/** Domain は React / Firebase / Gemini に依存しない（ADR-0002）。 */

export interface Clock {
  now(): number;
}

export interface IdProvider {
  next(prefix: string): string;
}

/** その案がどの合意・発言を受けて作られたか（系譜、ADR-0007） */
export interface Inspiration {
  /** 論点のラベル（C1 など） */
  claimLabels: string[];
  /** 何を受けたかの短い説明 */
  note: string;
}

export interface Outline {
  who: string;
  pain: string;
  how: string;
}

export interface IdeaDraft {
  title: string;
  summary: string;
  icon: string;
  /** 生成に使った合意台帳の版。作り置きが古くなったかの判定に使う */
  basedOnConsensus?: number;
  inspiredBy?: Inspiration | null;
  /** 8軸のプロフィール（-1〜+1、ADR-0009）。無ければ中立として扱う */
  profile?: number[];
  /** 発想の型（例：逆転の発想） */
  persona?: string;
  /** 企画名の読み（カタカナ）。音声の聞き間違いを直すのに使う */
  reading?: string;
  /** 審査員が企画名のかわりに口にしそうな短い呼び名（「ひとり飯ラウンジ」→「ひとり飯」）。音声認識の語彙に使う */
  aliases?: string[];
  /** 詳細画面の3行（誰の・何の困りごとを・どう解くか） */
  outline?: Outline;
  /** 別案（迷いを受けた版）で、元の案から残した良さ・変えた点・ひとことの理由 */
  keepStrengths?: string[];
  improvementPoints?: string[];
  changeNote?: string;
}

export interface RevisionDraft {
  title: string;
  summary: string;
  icon?: string;
  keepStrengths: string[];
  improvementPoints: string[];
  reason: string;
  inspiredBy?: Inspiration | null;
  /** 新しい版の「誰の・困りごと・どう解く」。改良で中身が変わったら必ず書き直す（旧版のものを残さない） */
  outline?: Outline | null;
}

/** 審査員の発言の記録（合意台帳の材料、時系列） */
export interface UtteranceRecord {
  seq: number;
  judgeId: string;
  text: string;
  source: 'live' | 'text';
  targetInstanceId: string | null;
  intent: string;
  at: number;
}

/** 審査員の行動（発言より強い意思表示として合意の材料にする） */
export interface DecisionRecord {
  kind: 'promoted' | 'rejected' | 'timed_out' | 'voted' | 'champion';
  instanceId: string;
  title: string;
  judgeId: string | null;
  at: number;
}

export interface Revision {
  revisionId: string;
  version: number;
  title: string;
  summary: string;
  icon: string;
  keepStrengths: string[];
  improvementPoints: string[];
  basedOnRevisionId: string | null;
  reason: string | null;
  createdAt: number;
  basedOnConsensus?: number | null;
  inspiredBy?: Inspiration | null;
  profile?: number[] | null;
  reading?: string | null;
  aliases?: string[] | null;
  outline?: Outline | null;
}

export interface Idea {
  ideaId: string;
  revisions: Revision[];
  pitch?: Pitch | null;
  persona?: string | null;
  /** 案のイメージ画像の URL（決勝の案だけ。画像そのものはアクターがメモリに持つ） */
  imageUrl?: string | null;
}

export interface CharacterInstance {
  instanceId: string;
  designId: number;
  location: CharacterLocation;
  ideaId: string;
  spawnedAt: number;
  /** 注目度（下段の入れ替えに使う、attention.ts） */
  attention: Attention;
  /** 退場予告中ならその時刻（この時刻に退場する） */
  leavingAt: number | null;
  /** 深掘りタイムで止めているあいだの、残り時間（止めていなければ null） */
  pausedLeftMs?: number | null;
  /** 一時停止ボタンで止めた審査員（止めていなければ null） */
  holdBy?: string | null;
  reaction?: Reaction | null;
}

export interface Finalist {
  instanceId: string;
  status: FinalistStatus;
}

export interface Critique {
  critiqueId: string;
  round: number;
  fromInstanceId: string;
  toInstanceId: string;
  text: string;
  postedAt: number;
}

export interface Judge {
  judgeId: string;
  /** 本人が入れた名前（未入力なら無し） */
  name?: string | null;
  slotIndex: number;
  isHost: boolean;
  connected: boolean;
  joinedAt: number;
  /** つなぎ直し用の合言葉（本人にだけ welcome で渡す。snapshot には出さない） */
  resumeToken?: string;
}

export interface Vote {
  status: 'open' | 'tie' | 'closed';
  ballots: Map<string, string>;
  tally: Record<string, number> | null;
  tieInstanceIds: string[];
}

export interface ArchivedIdea {
  ideaId: string;
  instanceId: string;
  designId: number;
  reason: 'rotated' | 'replaced' | 'rejected';
  archivedAt: number;
}

export interface Answer {
  answerId: string;
  instanceId: string;
  judgeId: string;
  question: string;
  answer: string | null;
  askedAt: number;
}

export interface DomainEvent {
  type: EventType;
  detail: Record<string, unknown>;
}

export type DomainResult<T = undefined> =
  | { ok: true; events: DomainEvent[]; value: T }
  | { ok: false; reason: RejectReason };

export const ok = <T = undefined>(events: DomainEvent[], value?: T): DomainResult<T> => ({
  ok: true,
  events,
  value: value as T,
});
export const reject = (reason: RejectReason): { ok: false; reason: RejectReason } => ({
  ok: false,
  reason,
});

export type { SessionMode, SessionStatus };

/** 永続化用のセッション状態（Map を配列にしたもの）。schemaVersion を変えたら移行処理を書く */
export interface SessionState {
  schemaVersion: 1;
  status: SessionStatus;
  mode: SessionMode;
  theme: string;
  lowerSlots: (string | null)[];
  upper: Finalist[];
  characters: CharacterInstance[];
  ideas: Idea[];
  critiques: Critique[];
  answers: Answer[];
  ideaBox: ArchivedIdea[];
  judges: Judge[];
  vote: (Omit<Vote, 'ballots'> & { ballots: [string, string][] }) | null;
  champion: { instanceId: string; ideaId: string; revisionId: string } | null;
  stock: IdeaDraft[];
  recentlyDeparted: number[];
  designLastUsedAt: [number, number][];
  /** 以下は ADR-0007 で追加（古い保存データには無い） */
  ledger?: Ledger;
  utterances?: UtteranceRecord[];
  decisions?: DecisionRecord[];
  ledgerCursor?: number;
  proposal?: Proposal | null;
  startedAt?: number | null;
  aiMode?: AiMode;
  /** ADR-0009 で追加 */
  taste?: TasteState;
  /** 決勝に進む人数と、1人の持ち時間（ロビーで選ぶ。古い保存データには無い） */
  finalistTarget?: number;
  challengeMs?: number | null;
}
