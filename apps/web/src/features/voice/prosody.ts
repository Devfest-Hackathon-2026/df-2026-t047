/**
 * 声の特徴から「うーん」を見つける（ADR-0009 ③）。文字起こしを待たず、ブラウザの中だけで判定する。
 *
 * 「うーん」「んー」は、言葉と違って音の大きさがほとんど揺れない（音節の切れ目が無い）まま
 * 0.5〜1.8 秒続き、そのあと黙る。20ms ごとの音量（dB）の並びからこの形を探す。
 * 送るのは判定結果と数値だけで、音声そのものは送らない。
 */

export interface HumEvent {
  durationMs: number;
  /** 続いていた間の平均の音量（0〜1） */
  rms: number;
  /** 後に続いた無音の長さ */
  silenceMs: number;
}

const FRAME_MS = 20;
const MIN_HUM_MS = 500;
const MAX_HUM_MS = 1800;
const MIN_SILENCE_AFTER_MS = 600;
/** 音量の揺れ（dB の標準偏差）がこれ以下なら「伸ばした声」 */
const MAX_STD_DB = 3.2;
/** 雑音の床から何 dB 上を「声」とみなすか */
const VOICE_ABOVE_FLOOR_DB = 14;

export class HumDetector {
  private floorDb = -60;
  private run: number[] = []; // 声が続いている間の dB
  private runRms: number[] = [];
  private silenceFrames = 0;
  private candidate: { db: number[]; rms: number[] } | null = null;

  constructor(private readonly onHum: (e: HumEvent) => void) {}

  /** 16kHz・16bit PCM の塊を受け取る（100ms ごと） */
  push(pcm: Int16Array) {
    const frame = (16000 * FRAME_MS) / 1000;
    for (let i = 0; i + frame <= pcm.length; i += frame) {
      let sum = 0;
      for (let k = i; k < i + frame; k++) sum += (pcm[k]! / 32768) ** 2;
      this.frame(Math.sqrt(sum / frame));
    }
  }

  private frame(rms: number) {
    const db = 20 * Math.log10(rms + 1e-9);
    // 雑音の床は、静かなときにゆっくり追いかける
    if (db < this.floorDb + 6) this.floorDb = this.floorDb * 0.98 + db * 0.02;
    else this.floorDb += 0.01;
    const voiced = db > this.floorDb + VOICE_ABOVE_FLOOR_DB;

    if (voiced) {
      if (this.candidate) this.candidate = null; // 黙りきる前にまた話し始めた → 言葉の一部
      this.silenceFrames = 0;
      this.run.push(db);
      this.runRms.push(rms);
      return;
    }
    if (this.run.length > 0) {
      const ms = this.run.length * FRAME_MS;
      if (ms >= MIN_HUM_MS && ms <= MAX_HUM_MS && std(this.run) <= MAX_STD_DB) {
        this.candidate = { db: this.run, rms: this.runRms };
      }
      this.run = [];
      this.runRms = [];
    }
    this.silenceFrames++;
    if (this.candidate && this.silenceFrames * FRAME_MS >= MIN_SILENCE_AFTER_MS) {
      const c = this.candidate;
      this.candidate = null;
      this.onHum({
        durationMs: c.db.length * FRAME_MS,
        rms: Math.min(1, c.rms.reduce((a, b) => a + b, 0) / c.rms.length),
        silenceMs: this.silenceFrames * FRAME_MS,
      });
    }
  }
}

function std(xs: number[]) {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}
