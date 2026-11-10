import type { EventMessage, PitchRole, ProposalContent } from '@idea-audition/protocol';
import type { IdeaDraft, RevisionDraft, SessionState } from '../domain/types.ts';

/**
 * LLM に渡す「審査の文脈」（ADR-0007 の L1）。合意台帳と審査員の行動から作る。
 * 版（version）が変わるまで同じ内容になるので、プロンプトの前半に置いてキャッシュを効かせる。
 */
export interface ConsensusContext {
  version: number;
  agreed: { label: string; text: string; supporters: string[] }[];
  proposed: { label: string; text: string; support: string[]; oppose: string[] }[];
  rejected: { label: string; text: string }[];
  /** 上段に選ばれた・会話でよく話題になった案 */
  favoredIdeas: string[];
  /** 見送られた案 */
  rejectedIdeas: string[];
  /** 直近の発言（審査員ラベルつき） */
  recentRemarks: { judge: string; text: string }[];
}

/** 合意台帳の差分を作るための入力。ID は使わず、審査員は「審査員 A」、論点は C1 のラベルで渡す */
export interface ConsensusUpdateInput {
  theme: string;
  /** この回で add_claim した論点に振られる最初の番号（C{n}） */
  nextClaimNumber: number;
  judges: string[];
  claims: { label: string; text: string; status: string; stances: { judge: string; stance: 'support' | 'oppose' }[] }[];
  utterances: { seq: number; judge: string; text: string; target: string | null; replyToClaim: string | null }[];
  decisions: { kind: string; title: string; judge: string | null }[];
}

/** 企画書を作るための材料。審査の記録から作り、LLM には事実として渡す */
export interface ProposalInput {
  theme: string;
  context: ConsensusContext;
  champion: {
    characterName: string;
    revisions: { version: number; title: string; summary: string; keepStrengths: string[]; improvementPoints: string[]; reason: string | null }[];
    /** 最新版の「誰の・困りごと・どう解く」（今の仕様。旧版の内容と混ぜない） */
    outline?: { who: string; pain: string; how: string } | null;
  };
  critiques: string[];
  qa: { question: string; answer: string }[];
  otherFinalists: string[];
}

/** 企画書のイメージ画像を作るための入力（タイトル・課題・対象者・提供価値・概要） */
export interface ProposalImageInput {
  theme: string;
  title: string;
  catchphrase?: string;
  problem: string;
  target: string;
  value: string;
  overview: string;
  characterName?: string;
}

/** LLM が提案する台帳の操作（ラベルで指す。サーバーが ID に直して当てはめる） */
export type ConsensusOpDraft =
  | { op: 'add_claim'; text: string; judge: string | null; stance: 'support' | 'oppose' | null; seq: number | null }
  | { op: 'set_stance'; label: string; judge: string; stance: 'support' | 'oppose'; seq: number | null }
  | { op: 'supersede'; label: string; byLabel: string };

/** 生成を頼む1枠（ADR-0009）。役割・どちらに寄せるか・発想の型 */
export interface GenerationSlot {
  role: PitchRole;
  /** 「審査員 A は手軽さが高い案を好む」のような、生成の方向の指示 */
  direction: string;
  /** 発想の型の名前と説明 */
  persona: { name: string; how: string };
}

/** 生成に渡す好みの要約（審査員はラベルで渡し、ID は渡さない） */
export interface TasteHint {
  judges: { label: string; likes: string[]; dislikes: string[] }[];
  divergence: string | null;
  slots: GenerationSlot[];
}

/** 迷いを受けた別案づくりの入力 */
export interface VaryInput {
  theme: string;
  characterName: string;
  idea: { title: string; summary: string; profile: number[] | null };
  /** 何に迷ったか（発言そのもの、または「うーん」） */
  concern: string;
  context?: ConsensusContext;
}

/** 文章の埋め込み（ADR-0009）。似ている案の判定と、好んだ案との近さに使う */
export interface EmbeddingPort {
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}

/** 声の発言を、審査の話題かどうか判定してもらうための材料（issue #3） */
export interface UtteranceTriageInput {
  theme: string;
  /** 舞台にいるキャラと、その企画名・説明文（「ルナが言っていた案」のような言及や、企画の中身への質問の判断に使う） */
  stage: { characterName: string; title: string; summary: string; letter?: string }[];
  /** 直前の発言（「それは微妙」のような、前の話を受けた発言を落とさないため） */
  recentRemarks: { judge: string; text: string }[];
  /** 会議の語彙で聞き間違いを直したあとの文字起こし */
  text: string;
}

/**
 * 発言の仕分け結果。
 * - keep=false：審査の話題ではない（雑談・アプリや機材の話）か、聞き間違いで意味が通らない。記録せず、誰にも渡さない
 * - keep=true：summary は言い直した1文。AI が言い直さなかったとき（固定データなど）は null で、元の文をそのまま使う
 */
export type UtteranceTriage =
  | {
      keep: true;
      summary: string | null;
      /** 発言が特定の案の話なら、stage の番号（1 始まり）。全体の話・決められないときは 0 か無し */
      targetIndex?: number;
    }
  | { keep: false; reason: 'off_topic' | 'garbled' };

/** AI 生成のポート（ADR-0005 §1）。GeminiGateway と FixtureGateway が実装する。 */
export interface IdeaGenerationPort {
  readonly name: string;
  generateIdeas(input: {
    theme: string;
    count: number;
    avoidTitles: string[];
    context?: ConsensusContext;
    /** 好みエンジンの指示。あれば slots の数だけ、枠の順に作る（profile と persona を付けて返す） */
    taste?: TasteHint;
  }): Promise<IdeaDraft[]>;
  /** 下段の案の別案（迷いへの反応、ADR-0009 ③） */
  varyIdea(input: VaryInput): Promise<IdeaDraft>;
  /** 優勝案の企画書（第1部）を作る */
  generateProposal(input: ProposalInput): Promise<ProposalContent>;
  /** 企画書の内容に基づき、企画を象徴するイメージ画像（data URL 等）を生成する */
  generateProposalImage?(input: ProposalImageInput): Promise<string | null>;
  /** 会話と行動から、合意台帳への操作を提案する（ADR-0007） */
  updateConsensus(input: ConsensusUpdateInput): Promise<ConsensusOpDraft[]>;
  /**
   * 上段の改良。相互批評を含めて1回の構造化出力で受け取る（ADR-0005 §4・§6 案A）。
   */
  refine(input: RefineInput): Promise<RefineOutput>;
  answer(input: {
    theme: string;
    idea: { title: string; summary: string };
    characterName: string;
    question: string;
    context?: ConsensusContext;
    /** 声の文字起こしか（聞き間違いで意味が通らないことがある） */
    spoken?: boolean;
  }): Promise<string | null>;
  // 戻り値が null：質問が聞き間違いなどで意味が通らなかった（答えず、聞き直す）
  /** 声の発言を仕分ける：審査の話題だけ残し、言い直して返す（issue #3） */
  triageUtterance(input: UtteranceTriageInput): Promise<UtteranceTriage>;
}

export interface RefineParticipant {
  instanceId: string;
  characterName: string;
  title: string;
  summary: string;
  version: number;
  /** 今の版の「誰の・困りごと・どう解く」 */
  outline?: { who: string; pain: string; how: string } | null;
}

export interface RefineInput {
  theme: string;
  trigger: 'promotion' | 'instruction' | 'arrival';
  participants: RefineParticipant[];
  /** 改良版を作る対象（arrival では全員） */
  targets: string[];
  rounds: number;
  instruction: string | null;
  context?: ConsensusContext;
}

export interface RefineOutput {
  critiques: { round: number; fromInstanceId: string; toInstanceId: string; text: string }[];
  revisions: Record<string, RevisionDraft>;
}

/** 確定イベントの記録（1件分） */
export interface StoredEvent {
  seq: number;
  type: EventMessage['type'];
  detail: Record<string, unknown>;
  actorJudgeId: string | null;
  correlationId: string | null;
  at: string;
}

/**
 * セッションの永続化（ADR-0003）。正本はメモリのアクターで、これは控え。
 * サーバー再起動時に load で復元する。
 */
export interface SessionStorePort {
  readonly name: string;
  load(sessionId: string): Promise<{ seq: number; state: SessionState } | null>;
  /** 確定イベントと、その時点のセッション状態をまとめて書く */
  commit(sessionId: string, seq: number, state: SessionState, events: StoredEvent[]): Promise<void>;
}

/** 音声の文字起こし（Gemini Live）。開いている間だけ音声を受け付ける */
export interface SpeechTranscriptionPort {
  readonly name: string;
  open(
    callbacks: {
      onInterim(text: string): void;
      onFinal(text: string): void;
      onClose(reason: string): void;
    },
    /** 聞き取りを寄せる言葉（キャラ名・企画名など） */
    options?: { vocabulary?: string[] },
  ): Promise<TranscriptionStream>;
}

export interface TranscriptionStream {
  /** 16kHz・モノラル・16bit PCM */
  sendAudio(pcm: Buffer): void;
  close(): void;
}

export interface Scheduler {
  setTimeout(fn: () => void, ms: number): () => void;
  setInterval(fn: () => void, ms: number): () => void;
}
