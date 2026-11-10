/**
 * マイク音声（float32）を 16kHz・16bit PCM に変換し、約100msごとに送る。
 * 普段はブラウザが 16kHz で渡すので変換は素通し。対応していないブラウザ（48kHz など）のときだけ区間平均で間引く。
 * AudioWorklet の中で動く（メインスレッドを止めない）。
 */
const TARGET_RATE = 16000;
const CHUNK_SAMPLES = 1600; // 100ms

class PcmDownsampler extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE;
    this.acc = 0;
    this.accCount = 0;
    this.pos = 0;
    this.out = new Int16Array(CHUNK_SAMPLES);
    this.outIndex = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      // 区間平均で間引く（簡易なローパスを兼ねる）
      this.acc += channel[i];
      this.accCount++;
      this.pos += 1;
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio;
        const v = Math.max(-1, Math.min(1, this.acc / this.accCount));
        this.out[this.outIndex++] = v < 0 ? v * 0x8000 : v * 0x7fff;
        this.acc = 0;
        this.accCount = 0;
        if (this.outIndex === CHUNK_SAMPLES) {
          this.port.postMessage(this.out.buffer, [this.out.buffer]);
          this.out = new Int16Array(CHUNK_SAMPLES);
          this.outIndex = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-downsampler', PcmDownsampler);
