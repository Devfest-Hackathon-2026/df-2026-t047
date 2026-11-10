/**
 * 審査員どうしの通話（声）。WebRTC で、ブラウザ同士が直接つながる（4人までの総当たり）。
 *  - 声はサーバーを通らない。つなぐための受け渡し（offer / answer / ice）だけを CAMP の Ephemeral で送る
 *  - 2人のうち参加者 ID が小さいほうが offer を出す（両方から同時に出してぶつからないように）
 *  - エコーキャンセル・ノイズ抑制はブラウザに任せる
 *  - カメラの映像も同じ接続で送る（ワイプ用）。映像の枠は最初から作っておき、カメラのオン／オフは
 *    送る映像を差し替えるだけにする（つなぎ直さない）。4人の総当たりなので、小さく・低いフレームレートで送る
 *  - 観覧者は映像を受け取るだけ（送らない）
 * 会社や学校のネットワークでは直接つながらないことがある（中継サーバー TURN は用意していない）。
 */

export type CallSignal =
  | { to: string; kind: 'offer' | 'answer'; sdp: string }
  | { to: string; kind: 'ice'; candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null };

export interface CallTransport {
  /** 自分の参加者 ID */
  me(): string | null;
  /** cam：カメラを映しているか（ワイプにアイコンを出すかどうかを、相手が決める） */
  sendState(on: boolean, cam: boolean): void;
  sendSignal(signal: CallSignal): void;
}

export interface CallEvents {
  onPeers(ids: string[]): void;
  onSpeaking(speaking: Record<string, boolean>): void;
  /** 声の大きさ（0〜4 の段階。ワイプの波形に使う） */
  onLevels(levels: Record<string, number>): void;
  /** 相手のカメラの映像（届いた・切れた） */
  onVideo(id: string, stream: MediaStream | null): void;
  /** 自分のカメラ（映し始めた・止まった） */
  onCamera(stream: MediaStream | null): void;
  onError(message: string): void;
}

/** 観覧者（聞くだけ）の通話用の ID */
export const isSpectatorCall = (id: string | null) => !!id?.startsWith('spec_');

const STUN_ONLY: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

/**
 * 通話の経路探しのサーバーをサーバーから受け取る（Cloudflare の TURN があれば、その数時間だけ使える接続情報も入る）。
 * 直接つながらない回線（テザリング・大学や会社の Wi-Fi）では、TURN が音声を中継する。取れなければ Google の STUN だけで試す。
 */
async function loadIceServers(): Promise<RTCIceServer[]> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3_000);
    const res = await fetch('/api/ice', { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (!res.ok) return STUN_ONLY;
    const body = (await res.json()) as { iceServers?: RTCIceServer[] };
    return body.iceServers?.length ? body.iceServers : STUN_ONLY;
  } catch {
    return STUN_ONLY;
  }
}
/** ワイプ用のカメラ。ワイプでは顔のあたりを拡大して映すので少し大きめに撮り、4人の総当たりで送り合うのでフレームレートは抑える */
const CAMERA: MediaTrackConstraints = { width: { ideal: 480 }, height: { ideal: 360 }, frameRate: { ideal: 15, max: 15 }, facingMode: 'user' };
/** 1人に送る映像の上限（ビット毎秒）。3人に送っても 0.5Mbps ほど */
const VIDEO_MAX_BITRATE = 160_000;

/** この音量（0〜1 の RMS）を超えたら「話している」 */
const SPEAKING_RMS = 0.04;

interface Peer {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  /** 相手の説明（remote description）が届く前に来た経路の候補 */
  pendingIce: RTCIceCandidateInit[];
  analyser: AnalyserNode | null;
  /** カメラの映像を送る枠（offer を出す側が作る。受ける側は offer が届いてから決まる） */
  video: RTCRtpTransceiver | null;
}

export class CallClient {
  private local: MediaStream | null = null;
  private iceServers: RTCIceServer[] = STUN_ONLY;
  private peers = new Map<string, Peer>();
  /** 自分が通話中だと伝えた相手（返事を何度も送り合わないように） */
  private announcedTo = new Set<string>();
  private audioCtx: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private meter: ReturnType<typeof setInterval> | null = null;
  private muted = false;
  /** 相手の声を消しているか（通話はつないだまま、自分のスピーカーから出さないだけ） */
  private othersMuted = false;
  /** ワイプ用のカメラ（映していないときは null） */
  private camera: MediaStream | null = null;
  /** マイクが使えず、聞くだけで参加している */
  listenOnly = false;

  constructor(
    private readonly transport: CallTransport,
    private readonly events: CallEvents,
  ) {}

  /** 動作確認用：相手ごとの接続状態と、届いている音量 */
  debug() {
    return [...this.peers].map(([id, p]) => ({ id, state: p.pc.connectionState, level: p.analyser ? Math.round(rms(p.analyser) * 1000) / 1000 : null }));
  }

  /** 確認用：TURN を受け取れたか、相手ごとに直接（host・srflx）か中継（relay）か */
  async route() {
    const turn = this.iceServers.some((s) => [s.urls].flat().some((u) => u.startsWith('turn')));
    const peers = await Promise.all(
      [...this.peers].map(async ([id, p]) => {
        const stats = await p.pc.getStats().catch(() => null);
        let via: string | null = null;
        stats?.forEach((r: { type: string; state?: string; nominated?: boolean; localCandidateId?: string }) => {
          if (r.type !== 'candidate-pair' || r.state !== 'succeeded' || !r.nominated || !r.localCandidateId) return;
          const local = stats.get(r.localCandidateId) as { candidateType?: string } | undefined;
          via = local?.candidateType ?? null;
        });
        return { id, state: p.pc.connectionState, via };
      }),
    );
    return { turn, peers };
  }

  get inCall() {
    return this.local !== null;
  }

  /** 通話で使っているマイク（聞くだけのとき・通話していないときは null）。文字起こしも同じマイクを使う */
  get microphone(): MediaStream | null {
    return this.local && this.local.getAudioTracks().some((t) => t.readyState === 'live') ? this.local : null;
  }

  /** 自分のカメラの映像（自分のワイプに映す） */
  get cameraStream(): MediaStream | null {
    return this.camera;
  }

  /** 観覧者は映像を送らない（受け取るだけ） */
  private get sendsVideo() {
    return !isSpectatorCall(this.transport.me());
  }

  /** カメラを開いている途中（同時に2回呼ばれても、カメラは1回だけ開く） */
  private cameraOpening: Promise<boolean> | null = null;

  /** カメラを映す。使えなければ false（ワイプはアイコンのまま） */
  startCamera(): Promise<boolean> {
    return (this.cameraOpening ??= this.openCamera().finally(() => (this.cameraOpening = null)));
  }

  private async openCamera(): Promise<boolean> {
    if (this.camera) return true;
    if (!this.sendsVideo) return false;
    try {
      this.camera = await navigator.mediaDevices.getUserMedia({ video: CAMERA, audio: false });
    } catch {
      this.events.onError('カメラが使えません。ブラウザでカメラを許可してください');
      return false;
    }
    // カメラの許可を待っているあいだに通話を抜けていたら、映さずに閉じる
    if (!this.local) {
      for (const t of this.camera.getTracks()) t.stop();
      this.camera = null;
      return false;
    }
    const track = this.camera.getVideoTracks()[0] ?? null;
    // ブラウザの設定などでカメラが止められたら、オフに戻す
    track?.addEventListener('ended', () => this.stopCamera());
    this.events.onCamera(this.camera);
    for (const p of this.peers.values()) void this.sendCamera(p);
    if (this.local) this.transport.sendState(true, true);
    return true;
  }

  stopCamera() {
    if (!this.camera) return;
    for (const t of this.camera.getTracks()) t.stop();
    this.camera = null;
    for (const p of this.peers.values()) void this.sendCamera(p);
    if (this.local) this.transport.sendState(true, false);
    this.events.onCamera(null);
  }

  /** 相手に送る映像を、いまのカメラに合わせる（カメラが無ければ何も送らない） */
  private async sendCamera(peer: Peer) {
    if (!peer.video || !this.sendsVideo) return;
    await peer.video.sender.replaceTrack(this.camera?.getVideoTracks()[0] ?? null).catch(() => {});
  }

  /** 映像の送り方を抑える（つないだあとでないと設定できない） */
  private async limitVideo(peer: Peer) {
    const sender = peer.video?.sender;
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings?.length) return;
    for (const e of params.encodings) {
      e.maxBitrate = VIDEO_MAX_BITRATE;
      e.maxFramerate = 15;
    }
    await sender.setParameters(params).catch(() => {});
  }

  /** listenOnly：最初からマイクを使わず聞くだけで入る（観覧者） */
  async join(opts: { listenOnly?: boolean } = {}) {
    if (this.local) return;
    // マイクの許可を待つあいだに、経路探しのサーバーも受け取っておく
    const ice = loadIceServers();
    if (opts.listenOnly) {
      this.local = new MediaStream();
      this.listenOnly = true;
    } else try {
      this.local = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.listenOnly = false;
    } catch {
      // マイクが使えなくても、ほかの人の声は聞こえるようにする（聞くだけで参加）
      this.local = new MediaStream();
      this.listenOnly = true;
      this.events.onError('マイクが使えないため、聞くだけで参加しています。話すにはブラウザでマイクを許可して、マイクのボタンを押してください');
    }
    this.audioCtx = new AudioContext();
    this.localAnalyser = this.analyse(this.local);
    this.setMuted(this.muted);
    this.meter = setInterval(() => this.measure(), 200);
    this.iceServers = await ice;
    this.announcedTo.clear();
    this.transport.sendState(true, !!this.camera);
  }

  leave() {
    if (!this.local) return;
    this.stopCamera();
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    for (const t of this.local.getTracks()) t.stop();
    this.local = null;
    if (this.meter) clearInterval(this.meter);
    this.meter = null;
    void this.audioCtx?.close();
    this.audioCtx = null;
    this.localAnalyser = null;
    this.announcedTo.clear();
    this.transport.sendState(false, false);
    this.events.onSpeaking({});
    this.events.onPeers([]);
  }

  /** ブラウザが音を止めているか（ページで一度もクリックしていないと、音を鳴らせない） */
  get audioBlocked() {
    return this.audioCtx?.state === 'suspended';
  }

  /** クリックのあとに呼ぶ：止められていた音を鳴らし始める */
  async resume() {
    await this.audioCtx?.resume().catch(() => {});
    for (const p of this.peers.values()) void p.audio.play().catch(() => {});
  }

  setOthersMuted(muted: boolean) {
    this.othersMuted = muted;
    for (const p of this.peers.values()) p.audio.muted = muted;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    for (const t of this.local?.getAudioTracks() ?? []) t.enabled = !muted;
  }

  /** ほかの人が通話に入った・抜けた */
  onState(from: string, on: boolean) {
    if (!this.local) return;
    // 観覧者どうしは、どちらも話さないのでつながない
    if (isSpectatorCall(from) && isSpectatorCall(this.transport.me())) return;
    if (!on) {
      this.closePeer(from);
      this.announcedTo.delete(from);
      return;
    }
    // 後から入った人にも、自分が通話中だと返す（1人に1回だけ）
    if (!this.announcedTo.has(from)) {
      this.announcedTo.add(from);
      this.transport.sendState(true, !!this.camera);
    }
    void this.ensurePeer(from);
  }

  /** 相手が部屋から抜けた（切断） */
  forget(id: string) {
    this.closePeer(id);
    this.announcedTo.delete(id);
  }

  async onSignal(from: string, signal: CallSignal) {
    const me = this.transport.me();
    if (!this.local || !me || signal.to !== me) return;
    if (signal.kind === 'offer') {
      const peer = await this.ensurePeer(from, false);
      await peer.pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
      // offer に入っていた映像の枠を、こちらの送り方に合わせる（観覧者は受け取るだけ）
      peer.video = peer.pc.getTransceivers().find((t) => t.receiver.track.kind === 'video') ?? null;
      if (peer.video) {
        peer.video.direction = this.sendsVideo ? 'sendrecv' : 'recvonly';
        await this.sendCamera(peer);
      }
      await this.flushIce(peer);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      this.transport.sendSignal({ to: from, kind: 'answer', sdp: answer.sdp ?? '' });
      void this.limitVideo(peer);
    } else if (signal.kind === 'answer') {
      const peer = this.peers.get(from);
      if (!peer || peer.pc.signalingState !== 'have-local-offer') return;
      await peer.pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
      await this.flushIce(peer);
      void this.limitVideo(peer);
    } else if (signal.kind === 'ice') {
      const peer = this.peers.get(from);
      if (!peer) return;
      const init: RTCIceCandidateInit = { candidate: signal.candidate, sdpMid: signal.sdpMid ?? null, sdpMLineIndex: signal.sdpMLineIndex ?? null };
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(init).catch(() => {});
      else peer.pendingIce.push(init);
    }
  }

  private async ensurePeer(id: string, mayOffer = true): Promise<Peer> {
    const existing = this.peers.get(id);
    if (existing) return existing;
    const me = this.transport.me();
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const audio = new Audio();
    audio.autoplay = true;
    audio.muted = this.othersMuted;
    const peer: Peer = { pc, audio, pendingIce: [], analyser: null, video: null };
    this.peers.set(id, peer);
    this.events.onPeers([...this.peers.keys()]);
    const tracks = this.local!.getTracks();
    for (const t of tracks) pc.addTrack(t, this.local!);
    // 聞くだけのときも、相手の声を受け取る枠は作る
    if (tracks.length === 0) pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.ontrack = (e) => {
      if (e.track.kind === 'video') {
        this.events.onVideo(id, new MediaStream([e.track]));
        return;
      }
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      audio.srcObject = stream;
      void audio.play().catch(() => {});
      peer.analyser = this.analyse(stream);
    };
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      this.transport.sendSignal({ to: id, kind: 'ice', candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        // つながらなかった。いったん閉じ、offer を出す側からつなぎ直す
        this.closePeer(id);
        if (me && me < id && this.local) setTimeout(() => void this.ensurePeer(id), 2000);
      }
    };
    if (mayOffer && me && me < id) {
      // 映像の枠は offer を出す側が作る（カメラが無くても枠だけ作り、あとで差し替える）
      peer.video = pc.addTransceiver('video', { direction: this.sendsVideo ? 'sendrecv' : 'recvonly' });
      await this.sendCamera(peer);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.transport.sendSignal({ to: id, kind: 'offer', sdp: offer.sdp ?? '' });
    }
    return peer;
  }

  private async flushIce(peer: Peer) {
    const queued = peer.pendingIce.splice(0);
    for (const c of queued) await peer.pc.addIceCandidate(c).catch(() => {});
  }

  private closePeer(id: string) {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.pc.close();
    peer.audio.srcObject = null;
    this.peers.delete(id);
    this.events.onVideo(id, null);
    this.events.onPeers([...this.peers.keys()]);
  }

  private analyse(stream: MediaStream): AnalyserNode | null {
    if (!this.audioCtx) return null;
    try {
      const node = this.audioCtx.createAnalyser();
      node.fftSize = 512;
      this.audioCtx.createMediaStreamSource(stream).connect(node);
      return node;
    } catch {
      return null;
    }
  }

  private measure() {
    const out: Record<string, boolean> = {};
    const levels: Record<string, number> = {};
    const me = this.transport.me();
    const take = (id: string, node: AnalyserNode) => {
      const v = rms(node);
      out[id] = v > SPEAKING_RMS;
      levels[id] = v <= SPEAKING_RMS ? 0 : Math.min(4, 1 + Math.floor((v - SPEAKING_RMS) / 0.04));
    };
    if (me && this.localAnalyser && !this.muted) take(me, this.localAnalyser);
    for (const [id, p] of this.peers) if (p.analyser) take(id, p.analyser);
    this.events.onSpeaking(out);
    this.events.onLevels(levels);
  }
}

function rms(node: AnalyserNode) {
  const buf = new Float32Array(node.fftSize);
  node.getFloatTimeDomainData(buf);
  let sum = 0;
  for (const v of buf) sum += v * v;
  return Math.sqrt(sum / buf.length);
}
