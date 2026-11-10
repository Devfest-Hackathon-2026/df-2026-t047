import { z } from 'zod';
import { defineVocabulary } from '@camp-protocol/kit';
import { AiMode, MAX_FINALISTS, SessionMode, SessionSnapshot } from './model.ts';
import { RejectReason } from './reasons.ts';

/**
 * IDEA AUDITION の語彙（vocabulary）。CAMP（@camp-protocol/kit）の defineVocabulary に Command・Event・理由コード・snapshot を渡し、
 * メッセージ一式を組み立てる。封筒・順序・重複排除・再接続は @camp-protocol/kit が受け持つ。
 */


const text = z.string().trim().min(1).max(400);
const id = z.string().min(1).max(80);

/* ------------------------------------------------------------------ */
/* Command: Client → Server（commandId で重複排除）                      */
/* ------------------------------------------------------------------ */

export const CommandPayloads = {
  /** 自分の名前（画面に出す呼び名）。参加したときに入れる。前後の空白は除く */
  SET_JUDGE_NAME: z.object({ name: z.string().trim().min(1).max(16) }),
  START_AUDITION: z.object({
    theme: text,
    mode: SessionMode,
    aiMode: AiMode.optional(),
    /** 決勝に進む人数 */
    finalists: z.number().int().min(1).max(MAX_FINALISTS).optional(),
    /** 1人の持ち時間（秒） */
    challengeSec: z.number().int().min(10).max(300).optional(),
  }),
  /** AI のモードを切り替える（ホストのみ。途中でも可） */
  SET_AI_MODE: z.object({ mode: AiMode }),
  REQUEST_PROMOTION: z.object({ instanceId: id }),
  /** ゴールデンブザー（押す・取り消す）。全員が押したら合格者待機室へ（#5） */
  PRESS_BUZZER: z.object({ instanceId: id, on: z.boolean() }),
  /** 最終オーディション：みんなで注目するキャラを選ぶ（null で解除）。名前を呼ばない質問はこのキャラに届く */
  SET_SPOTLIGHT: z.object({ instanceId: id.nullable() }),
  /** 退出ボタン：席を空けて、審査員の一覧からも消える（同じリンクで入り直すと新しい審査員として入る） */
  LEAVE_SESSION: z.object({}),
  /** 予選の一時停止（押した人が再開するか、だれかが再開するまで交代のカウントを止める） */
  HOLD_CHALLENGE: z.object({ instanceId: id, on: z.boolean() }),
  /** 合格者が決勝の人数に満たなくても、いまの合格者で決勝に進む（ホストのみ） */
  END_PRELIMINARY: z.object({}),
  NEXT_IDEA: z.object({ instanceId: id.optional() }),
  /** 審査員の「見送り」：この案はないと判断して、すぐ次のキャラと交代させる */
  REJECT_CANDIDATE: z.object({ instanceId: id }),
  /** 合意台帳の論点を人が「これで決まり」と確定する／取り消す（ADR-0007） */
  PIN_CLAIM: z.object({ label: z.string().regex(/^C\d+$/) }),
  UNPIN_CLAIM: z.object({ label: z.string().regex(/^C\d+$/) }),
  ASK_CANDIDATE: z.object({ instanceId: id, text }),
  REQUEST_REFINEMENT: z.object({ instanceId: id, text }),
  SUBMIT_UTTERANCE: z.object({
    text,
    source: z.enum(['live', 'text']),
    targetInstanceId: id.optional(),
    /** 合意メモの論点への返答（例：C3 に対して「賛成」） */
    replyToClaim: z.string().regex(/^C\d+$/).optional(),
  }),
  START_CHAMPION_VOTE: z.object({}),
  CAST_VOTE: z.object({ instanceId: id }),
  CLOSE_VOTE: z.object({}),
  RESOLVE_TIE: z.object({ instanceId: id }),
  SELECT_CHAMPION: z.object({ instanceId: id }),
  RESET_SESSION: z.object({}),
  /** 改良の履歴から前の版に戻す（B4） */
  REVERT_IDEA_REVISION: z.object({ characterId: id, targetVersion: z.number().int().min(1) }),
  /** 企画書の作成に失敗したときの作り直し */
  REGENERATE_PROPOSAL: z.object({}),
} as const;
export type CommandType = keyof typeof CommandPayloads;
export type CommandPayload<T extends CommandType> = z.infer<(typeof CommandPayloads)[T]>;


/* ------------------------------------------------------------------ */
/* Ephemeral: 永続化しない・最新値優先（カーソル、ドラッグ中の表示）        */
/* ------------------------------------------------------------------ */

export const EphemeralPayloads = {
  /** 座標はアリーナ要素に対して 0〜1 に正規化（null はアリーナ外） */
  CURSOR_MOVED: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).nullable(),
  DRAG_PREVIEW: z.object({ instanceId: id.nullable() }),
  /** 注目しているキャラ（カーソルが乗っている・詳細を開いている）。退場の判定に使う */
  FOCUS_CHANGED: z.object({ hover: id.nullable(), detail: id.nullable() }),
  MIC_STATE_CHANGED: z.object({ on: z.boolean() }),
  /** 通話に入った・抜けた（声は WebRTC でブラウザ同士が直接やり取りする。サーバーは中継しない） */
  CALL_STATE: z.object({
    on: z.boolean(),
    /** 観覧者（5人目以降）が聞くだけで入るときの通話用の ID。ブラウザで作る（spec_ で始まる） */
    as: z.string().regex(/^spec_[a-z0-9]{6,24}$/).optional(),
    /** カメラを映しているか（ワイプに顔を出すか、アイコンにするか） */
    cam: z.boolean().optional(),
  }),
  /** 通話をつなぐための受け渡し（offer / answer / 経路の候補 ice）。to で宛先の審査員を指定し、ほかの人は無視する */
  RTC_SIGNAL: z.object({
    to: id,
    kind: z.enum(['offer', 'answer', 'ice']),
    sdp: z.string().max(20_000).optional(),
    candidate: z.string().max(2_000).optional(),
    sdpMid: z.string().max(64).nullable().optional(),
    sdpMLineIndex: z.number().int().min(0).max(64).nullable().optional(),
  }),
  /** ロビーでホストが入力中のテーマと設定（ほかの人の画面にそのまま見せる。保存しない） */
  THEME_DRAFT: z.object({
    theme: z.string().max(120),
    mode: z.enum(['team', 'solo']),
    aiMode: z.enum(['gemini', 'fixture']).nullable(),
    finalists: z.number().int().min(1).max(MAX_FINALISTS).optional(),
    challengeSec: z.number().int().min(10).max(300).optional(),
  }),
} as const;
export type EphemeralType = keyof typeof EphemeralPayloads;

/* ------------------------------------------------------------------ */
/* Signal: Client → Server（返事なし・間引いてよい・状態はまとめた Event で返る）*/
/* ------------------------------------------------------------------ */

export const SoftSignalKind = z.enum(['hesitation', 'positive', 'laugh', 'silence']);
export type SoftSignalKind = z.infer<typeof SoftSignalKind>;

export const SignalPayloads = {
  /** 言葉にならない反応（「うーん」・沈黙・笑い）と、そのとき見ていたカード（ADR-0009） */
  SOFT_SIGNAL: z.object({
    kind: SoftSignalKind,
    targetInstanceId: id.nullable(),
    /** きっかけになった短い言葉（例：「うーん」）。音声そのものは送らない */
    cue: z.string().max(40).optional(),
    features: z
      .object({
        silenceMs: z.number().min(0).max(60_000).optional(),
        rms: z.number().min(0).max(1).optional(),
      })
      .optional(),
  }),
} as const;
export type SignalType = keyof typeof SignalPayloads;


/* ------------------------------------------------------------------ */
/* Event: Server → All（セッション単位の連番 seq）                        */
/* ------------------------------------------------------------------ */

export const EVENT_TYPES = [
  'JUDGE_RENAMED',
  'IDEA_IMAGE_READY',
  'SESSION_STARTED',
  'SESSION_RESET',
  'JUDGE_JOINED',
  'JUDGE_LEFT',
  'HOST_CHANGED',
  'CANDIDATE_SPAWNED',
  'CANDIDATE_ARCHIVED',
  'CANDIDATE_LEAVING',
  'BUZZER_PRESSED',
  'CHALLENGE_PAUSED',
  'CHALLENGE_RESUMED',
  'PRELIMINARY_ENDED',
  'SPOTLIGHT_CHANGED',
  'CANDIDATE_STAYED',
  'CONSENSUS_UPDATED',
  'PROPOSAL_UPDATED',
  'AI_MODE_CHANGED',
  'PROMOTION_CONFIRMED',
  'FINALIST_REFINEMENT_STARTED',
  'FINALIST_CRITIQUE_POSTED',
  'FINALIST_VERSION_PUBLISHED',
  'CANDIDATE_ANSWERED',
  'JUDGE_UTTERANCE_RECEIVED',
  'CHAMPION_VOTE_STARTED',
  'VOTE_CAST',
  'TIE_DETECTED',
  'CHAMPION_SELECTED',
  'TASTE_UPDATED',
  'CANDIDATE_REACTED',
  'CANDIDATE_REVISED',
] as const;

/**
 * 実装上の判断（ADR-0004 への補足）：
 * Event はその時点の snapshot を同梱する。クライアントは状態を自前で再計算せず、
 * snapshot を置き換え、type と detail は演出にのみ使う。
 */
export const vocabulary = defineVocabulary({
  commands: CommandPayloads,
  events: EVENT_TYPES,
  rejectReasons: RejectReason.options,
  snapshot: SessionSnapshot,
  ephemerals: EphemeralPayloads,
  signals: SignalPayloads,
});

export const EventType = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventType>;

export const CommandMessage = vocabulary.CommandMessage;
export type CommandMessage = z.infer<typeof CommandMessage>;
export const EphemeralMessage = vocabulary.EphemeralMessage;
export type EphemeralMessage = z.infer<typeof EphemeralMessage>;
export const SignalMessage = vocabulary.SignalMessage;
export type SignalMessage = z.infer<typeof SignalMessage>;
export const ClientMessage = vocabulary.ClientMessage;
export type ClientMessage = z.infer<typeof ClientMessage>;
export const EventMessage = vocabulary.EventMessage;
export type EventMessage = z.infer<typeof EventMessage>;
export const WelcomeMessage = vocabulary.WelcomeMessage;
export type WelcomeMessage = z.infer<typeof WelcomeMessage>;
export const CommandResultMessage = vocabulary.ResultMessage;
export type CommandResultMessage = z.infer<typeof CommandResultMessage>;
export const ServerMessage = vocabulary.ServerMessage;
export type ServerMessage = z.infer<typeof ServerMessage>;
export type { HelloMessage } from '@camp-protocol/kit';
