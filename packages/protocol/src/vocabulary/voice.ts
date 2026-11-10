import { z } from 'zod';

/**
 * 音声チャンネル（/voice）。操作用の CAMP WebSocket とは別経路にする（仕様書 9.2）。
 * クライアントは最初に JSON の hello を送り、その後は 16kHz・モノラル・16bit リトルエンディアンの
 * PCM をバイナリフレームで送る。文字起こしの確定結果はサーバーが発言として処理する。
 */
export const VOICE_SAMPLE_RATE = 16_000;

export const VoiceClientMessage = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('voice_hello'),
    sessionId: z.string().min(1).max(80),
    judgeId: z.string().min(1).max(80),
  }),
  /** 話しかける相手（詳細を開いているキャラ）。名前を言った場合はそちらを優先する */
  z.object({ kind: z.literal('voice_target'), instanceId: z.string().max(80).nullable() }),
]);
export type VoiceClientMessage = z.infer<typeof VoiceClientMessage>;

export const VoiceServerMessage = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('voice_ready') }),
  z.object({ kind: z.literal('voice_interim'), text: z.string() }),
  z.object({ kind: z.literal('voice_final'), text: z.string() }),
  z.object({ kind: z.literal('voice_unavailable'), reason: z.string() }),
]);
export type VoiceServerMessage = z.infer<typeof VoiceServerMessage>;
