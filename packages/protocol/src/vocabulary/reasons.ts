import { z } from 'zod';

/** 拒否理由コード（ADR-0004） */
export const RejectReason = z.enum([
  'UPPER_FULL',
  'NOT_IN_LOWER',
  'NOT_IN_UPPER',
  'UNKNOWN_CHARACTER',
  'STALE_VERSION',
  'NOT_AUTHORIZED',
  'NOT_HOST',
  'SESSION_NOT_ACTIVE',
  'VOTE_NOT_OPEN',
  'NOT_A_TIE_CANDIDATE',
  'ALREADY_REFINING',
  'INVALID_PAYLOAD',
  'SPECTATOR',
  'UNKNOWN_TYPE',
]);
export type RejectReason = z.infer<typeof RejectReason>;

/** UIに出す短い日本語 */
export const REJECT_REASON_LABEL: Record<RejectReason, string> = {
  UPPER_FULL: '最終オーディションは満席です',
  NOT_IN_LOWER: 'このキャラはもう下段にいません',
  NOT_IN_UPPER: 'このキャラは最終オーディションにいません',
  UNKNOWN_CHARACTER: 'キャラが見つかりません',
  STALE_VERSION: '状態が更新されました。もう一度お試しください',
  NOT_AUTHORIZED: 'この操作はできません',
  NOT_HOST: 'ホストだけが操作できます',
  SESSION_NOT_ACTIVE: 'いまはこの操作を受け付けていません',
  VOTE_NOT_OPEN: '投票は受付中ではありません',
  NOT_A_TIE_CANDIDATE: '同票の案から選んでください',
  ALREADY_REFINING: 'いまブラッシュアップ中です',
  INVALID_PAYLOAD: '入力を確認してください',
  SPECTATOR: '観覧モードでは操作できません',
  UNKNOWN_TYPE: 'この操作はサーバーが対応していません。画面を再読み込みしてください',
};
