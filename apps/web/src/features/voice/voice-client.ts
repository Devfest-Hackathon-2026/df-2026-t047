import { VoiceServerMessage } from '@idea-audition/protocol';
import workletUrl from './pcm-worklet.js?url&no-inline';
import { HumDetector, type HumEvent } from './prosody.ts';

export type VoiceState = 'off' | 'starting' | 'listening' | 'unavailable';

interface Handlers {
  onState(state: VoiceState, reason?: string): void;
  /** 声の特徴から「うーん」を見つけたとき */
  onHum?(e: HumEvent): void;
}

function voiceUrl() {
  const configured = import.meta.env.VITE_VOICE_URL as string | undefined;
  if (configured) return configured;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/voice`;
}

/**
 * マイク → 16kHz PCM → /voice（サーバー経由で Gemini Live）。
 * マイク OFF で接続ごと閉じる（音声を流している間だけ費用がかかる）。
 */
export class VoiceClient {
  private ws: WebSocket | null = null;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private target: string | null = null;
  private active = false;

  constructor(private readonly handlers: Handlers) {}

  /** shared：通話で開いているマイク。あれば同じマイクを複製して使い、もう一度マイクを開かない */
  async start(sessionId: string, judgeId: string, shared: MediaStream | null = null) {
    if (this.active) return;
    this.active = true;
    this.handlers.onState('starting');
    try {
      // 同じマイクを2回開くと、iPhone の Safari などでは先に開いた方（通話）の音が止まる。通話のマイクがあればそれを複製する
      const track = shared?.getAudioTracks().find((t) => t.readyState === 'live');
      this.stream = track
        ? new MediaStream([track.clone()])
        : await navigator.mediaDevices.getUserMedia({
            audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
    } catch {
      this.stop();
      this.handlers.onState('unavailable', 'マイクを使えません（ブラウザの許可を確認してください）');
      return;
    }
    if (!this.active) return;

    const ws = new WebSocket(voiceUrl());
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ kind: 'voice_hello', sessionId, judgeId }));
      ws.send(JSON.stringify({ kind: 'voice_target', instanceId: this.target }));
    };
    ws.onmessage = (e) => {
      let json: unknown;
      try {
        json = JSON.parse(String(e.data));
      } catch {
        return;
      }
      const parsed = VoiceServerMessage.safeParse(json);
      if (!parsed.success) return;
      const m = parsed.data;
      // voice_interim / voice_final（自分の文字起こし）は画面に出さないので読まない（issue #2）
      if (m.kind === 'voice_ready') this.handlers.onState('listening');
      else if (m.kind === 'voice_unavailable') {
        this.stop();
        this.handlers.onState('unavailable', m.reason);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      if (this.active) {
        this.stop();
        this.handlers.onState('unavailable', '音声の接続が切れました。もう一度マイクをONにするか、テキストで入力してください');
      }
    };

    // ブラウザに 16kHz へ変換させる（区間平均の間引きより、きちんとした低域通過フィルタがかかる）。
    // Firefox などマイクと違う周波数の AudioContext に繋げないブラウザでは、既定の周波数に戻して自前で間引く
    const { ctx, source } = this.createSource(this.stream);
    this.ctx = ctx;
    await this.ctx.audioWorklet.addModule(workletUrl);
    if (!this.active || !this.stream) return;
    this.node = new AudioWorkletNode(this.ctx, 'pcm-downsampler');
    const hum = new HumDetector((ev) => this.handlers.onHum?.(ev));
    this.node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      hum.push(new Int16Array(e.data));
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(e.data);
    };
    source.connect(this.node);
  }

  private createSource(stream: MediaStream) {
    try {
      const ctx = new AudioContext({ sampleRate: 16000 });
      try {
        return { ctx, source: ctx.createMediaStreamSource(stream) };
      } catch {
        void ctx.close();
      }
    } catch {
      /* sampleRate の指定に対応していない */
    }
    const ctx = new AudioContext();
    return { ctx, source: ctx.createMediaStreamSource(stream) };
  }

  setTarget(instanceId: string | null) {
    this.target = instanceId;
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ kind: 'voice_target', instanceId }));
  }

  stop() {
    const wasActive = this.active;
    this.active = false;
    this.node?.disconnect();
    this.node = null;
    void this.ctx?.close();
    this.ctx = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    if (wasActive) this.handlers.onState('off');
  }
}
