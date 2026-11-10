import { Modality, type GoogleGenAI } from '@google/genai';
import { VOICE_SAMPLE_RATE } from '@idea-audition/protocol';
import type { SpeechTranscriptionPort, TranscriptionStream } from '../../application/ports.ts';

/**
 * Gemini Live による音声の文字起こし（ADR-0005 §7）。
 * 既定は gemini-3.5-transcribe-live（global）。文字起こし専用で音声の返答を作らないため、
 * 余計な費用がかからない。途中経過（interim）と確定（final）を返す。
 */
export class GeminiLiveTranscriber implements SpeechTranscriptionPort {
  readonly name: string;

  constructor(
    private readonly ai: GoogleGenAI,
    private readonly model: string,
    private readonly log: (msg: string) => void = () => {},
    private readonly silenceMs = 1200,
    /** 認識する言語（BCP-47）。指定しないと自動判定になり、日本語がスペイン語などに化けることがある */
    private readonly languageCodes: string[] = ['ja-JP'],
  ) {
    this.name = `gemini-live(${model})`;
  }

  async open(
    callbacks: {
      onInterim(text: string): void;
      onFinal(text: string): void;
      onClose(reason: string): void;
    },
    options: { vocabulary?: string[] } = {},
  ): Promise<TranscriptionStream> {
    const started = Date.now();
    const assembler = new UtteranceAssembler(
      { onInterim: callbacks.onInterim, onFinal: callbacks.onFinal },
      this.silenceMs,
    );
    const session = await this.ai.live.connect({
      model: this.model,
      config: {
        responseModalities: [Modality.TEXT],
        inputAudioTranscription: {
          ...(this.languageCodes.length ? { languageCodes: this.languageCodes } : {}),
          ...(options.vocabulary?.length ? { customVocabulary: options.vocabulary } : {}),
        },
      },
      callbacks: {
        onmessage: (m) => {
          const c = m.serverContent;
          const interim = c?.interimInputTranscription?.text;
          if (interim) assembler.interim(normalizeTranscript(interim));
          const final = c?.inputTranscription?.text;
          if (final) assembler.segment(normalizeTranscript(final));
          if (m.goAway) this.log(`[voice] goAway timeLeft=${m.goAway.timeLeft ?? '?'}`);
        },
        onerror: (e) => this.log(`[voice] error ${String(e.message ?? e)}`),
        onclose: (e) => {
          assembler.flush();
          callbacks.onClose(e.reason || `code ${e.code}`);
        },
      },
    });
    this.log(
      `[voice] live session opened ${Date.now() - started}ms model=${this.model} lang=${this.languageCodes.join(',') || 'auto'} vocab=${options.vocabulary?.length ?? 0}`,
    );
    const mimeType = `audio/pcm;rate=${VOICE_SAMPLE_RATE}`;
    return {
      sendAudio: (pcm) => session.sendRealtimeInput({ audio: { data: pcm.toString('base64'), mimeType } }),
      close: () => {
        assembler.flush();
        session.close();
      },
    };
  }
}

/**
 * 文字起こし結果を整える。モデルによって日本語の語の間に空白が入ったり、
 * "{}" のような記号が混ざったりするため取り除く。
 */
export function normalizeTranscript(text: string): string {
  return text
    .replace(/\{\s*\}/g, '')
    .trim()
    .replace(/(?<=[^\x00-\x7F])\s+(?=[^\x00-\x7F])/g, '')
    .replace(/\s*\?$/, '？')
    .replace(/\s+/g, ' ');
}

/**
 * 文字起こしの区切り（セグメント）を1つの発言にまとめる。
 * - Live の確定結果は発言の途中で細かく区切られることがあるため、無音が silenceMs 続くまで連結する
 * - 途中経過の更新や確定結果で、区切りの先頭が欠けることがある（例：「ルナ留学」→「留学生も楽しめる」）。
 *   直前の途中経過と重なる位置を探し、欠けた先頭を補う。
 *   代わりに、モデルが先頭の聞き間違いを直した場合も古い先頭が残る（宛先の名前を落とさないことを優先）
 */
export class UtteranceAssembler {
  private committed = '';
  private lastInterim = '';
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly out: { onInterim(text: string): void; onFinal(text: string): void },
    private readonly silenceMs: number,
    private readonly timers: {
      set(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
      clear(t: ReturnType<typeof setTimeout>): void;
    } = { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t) },
  ) {}

  interim(text: string) {
    if (!text) return;
    // 途中経過どうしでも先頭が落ちることがある（「ルナ留学」→「留学生も」）ため同じく補う
    this.lastInterim = mergeWithInterim(this.lastInterim, text);
    this.out.onInterim(this.committed + text);
    this.arm();
  }

  segment(text: string) {
    if (!text) return;
    this.committed += mergeWithInterim(this.lastInterim, text);
    this.lastInterim = '';
    this.out.onInterim(this.committed);
    this.arm();
  }

  /** 残っている内容を確定として出す */
  flush() {
    if (this.timer) this.timers.clear(this.timer);
    this.timer = null;
    const text = (this.committed + this.lastInterim).trim();
    this.committed = '';
    this.lastInterim = '';
    if (text) this.out.onFinal(text);
  }

  private arm() {
    if (this.timer) this.timers.clear(this.timer);
    this.timer = this.timers.set(() => this.flush(), this.silenceMs);
  }
}

/** 確定結果の先頭が欠けていたら、途中経過から補う */
export function mergeWithInterim(interim: string, final: string): string {
  if (!interim || final.startsWith(interim.slice(0, 2))) return final;
  const head = final.slice(0, 2);
  const at = head.length === 2 ? interim.indexOf(head) : -1;
  return at > 0 ? interim.slice(0, at) + final : final;
}
