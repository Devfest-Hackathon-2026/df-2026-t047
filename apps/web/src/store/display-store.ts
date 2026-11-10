import { create } from 'zustand';

/**
 * 表示状態（アニメーション・操作中の一時状態）。
 * 業務状態（サーバーの snapshot）とは別に持ち、アニメーションの完了を業務状態の根拠にしない（ADR-0002）。
 */

export interface Point {
  x: number;
  y: number;
}

export interface DragState {
  instanceId: string;
  designId: number;
  pointer: Point;
  /** 'dragging'：つかんで移動中、'pending'：上段にドロップしてサーバーの確定待ち */
  phase: 'dragging' | 'pending';
}

export interface Flight {
  flightId: string;
  instanceId: string;
  designId: number;
  from: Point;
  /** 'upper'：上段の位置へ飛ぶ、'return'：元の下段へ戻る、'box'：退場して Idea BOX へ入る */
  kind: 'upper' | 'return' | 'box';
}

export interface RemoteCursor {
  x: number;
  y: number;
  updatedAt: number;
}

export interface Bubble {
  text: string;
  toInstanceId: string;
  critiqueId: string;
}

/** テキストで打った発言の字幕（声の発言は、言い直したものも出さない、issue #2・#3） */
export interface Caption {
  id: string;
  judgeId: string;
  text: string;
  intent: 'question' | 'instruction' | 'reject' | 'hesitation' | 'positive' | 'comment';
  targetInstanceId: string | null;
}

/** チャット履歴の1件（テキストで打った発言。字幕と違って消えない） */
export interface ChatEntry extends Omit<Caption, 'id'> {
  id: string;
  at: number;
}

const CHAT_LOG_MAX = 200;

/** 知らせの文言。モードで言い方が違うものは両方を作っておき、表示のときに今のモードの方を出す */
export type ToastText = string | { casual: string; official: string };

const toastKey = (t: ToastText) => (typeof t === 'string' ? t : `${t.casual}\u0000${t.official}`);

export interface Toast {
  id: string;
  text: ToastText;
  tone: 'info' | 'warn' | 'gold';
}

interface DisplayState {
  drag: DragState | null;
  flights: Flight[];
  /** 飛行中のため上段に表示しない（同じキャラを2か所に出さない、AC-05） */
  arriving: Set<string>;
  /** 移動中のため下段に表示しない */
  departing: Set<string>;
  cursors: Record<string, RemoteCursor>;
  heldBy: Record<string, string>; // judgeId → instanceId
  bubbles: Record<string, Bubble>; // fromInstanceId → bubble
  toasts: Toast[];
  selected: string | null;
  ideaBoxOpen: boolean;
  consensusOpen: boolean;
  tasteOpen: boolean;
    /** 表示のかしこまり度（#36、表示専用でサーバーの状態には影響しない）。0=カジュアル、1=オフィシャル */
    formality: 0 | 1;
    setFormality(f: 0 | 1): void;

  setTasteOpen(open: boolean): void;
  setConsensusOpen(open: boolean): void;
  justUpdated: Record<string, number>; // instanceId → 改良版が公開された時刻
  /** 他の審査員のマイク状態（Ephemeral） */
  micOn: Record<string, boolean>;
  /** 予選の舞台を出しているか（予選は審査員の台にワイプを出すので、フッターには出さない） */
  prelimStage: boolean;
  setMic(judgeId: string, on: boolean): void;
  /** テキストで打った発言（直近のもの） */
  captions: Caption[];
  addCaption(c: Omit<Caption, 'id'>): void;
  dismissCaption(id: string): void;
  /** チャット履歴（このブラウザが部屋にいる間に届いたテキストの発言） */
  chatLog: ChatEntry[];
  chatOpen: boolean;
  setChatOpen(open: boolean): void;
  clearChatLog(): void;
  /** 自分の投票先（サーバーは締め切りまで投票先を公開しないため手元で持つ） */
  myVote: string | null;
  setMyVote(instanceId: string | null): void;

  setDrag(d: DragState | null): void;
  addFlight(f: Omit<Flight, 'flightId'>): void;
  finishFlight(flightId: string): void;
  setCursor(judgeId: string, c: RemoteCursor | null): void;
  setHeld(judgeId: string, instanceId: string | null): void;
  setBubble(from: string, b: Bubble | null): void;
  clearBubbles(): void;
  toast(text: ToastText, tone?: Toast['tone']): void;
  dismissToast(id: string): void;
  select(instanceId: string | null): void;
  setIdeaBoxOpen(open: boolean): void;
  markUpdated(instanceId: string): void;
}

let n = 0;

export const useDisplay = create<DisplayState>((set) => ({
  drag: null,
  flights: [],
  arriving: new Set(),
  departing: new Set(),
  cursors: {},
  heldBy: {},
  bubbles: {},
  toasts: [],
  selected: null,
  ideaBoxOpen: false,
  consensusOpen: false,
  tasteOpen: false,
    formality: 0,
    setFormality: (formality) => set({ formality }),
  // 右側に出るパネルどうしが重ならないよう、1つ開いたらほかは閉じる
  setTasteOpen: (tasteOpen) => set({ tasteOpen, ...(tasteOpen ? { consensusOpen: false, chatOpen: false } : {}) }),
  setConsensusOpen: (consensusOpen) => set({ consensusOpen, ...(consensusOpen ? { chatOpen: false } : {}) }),
  justUpdated: {},
  micOn: {},
  prelimStage: false,
  setMic: (judgeId, on) => set((s) => ({ micOn: { ...s.micOn, [judgeId]: on } })),
  captions: [],
  addCaption: (c) =>
    set((s) => {
      const id = `c${++n}`;
      return {
        captions: [...s.captions.slice(-2), { ...c, id }],
        chatLog: [...s.chatLog.slice(-(CHAT_LOG_MAX - 1)), { ...c, id, at: Date.now() }],
      };
    }),
  dismissCaption: (id) => set((s) => ({ captions: s.captions.filter((c) => c.id !== id) })),
  chatLog: [],
  chatOpen: false,
  setChatOpen: (chatOpen) => set({ chatOpen, ...(chatOpen ? { consensusOpen: false, tasteOpen: false } : {}) }),
  clearChatLog: () => set({ chatLog: [] }),
  myVote: null,
  setMyVote: (myVote) => set({ myVote }),

  setDrag: (drag) => set({ drag }),
  addFlight: (f) =>
    set((s) => {
      const flight = { ...f, flightId: `f${++n}` };
      const arriving = new Set(s.arriving);
      const departing = new Set(s.departing);
      if (f.kind === 'upper') arriving.add(f.instanceId);
      else if (f.kind === 'return') departing.add(f.instanceId);
      return { flights: [...s.flights, flight], arriving, departing };
    }),
  finishFlight: (flightId) =>
    set((s) => {
      const f = s.flights.find((x) => x.flightId === flightId);
      if (!f) return {};
      const arriving = new Set(s.arriving);
      const departing = new Set(s.departing);
      arriving.delete(f.instanceId);
      departing.delete(f.instanceId);
      return { flights: s.flights.filter((x) => x.flightId !== flightId), arriving, departing };
    }),
  setCursor: (judgeId, c) =>
    set((s) => {
      const cursors = { ...s.cursors };
      if (c) cursors[judgeId] = c;
      else delete cursors[judgeId];
      return { cursors };
    }),
  setHeld: (judgeId, instanceId) =>
    set((s) => {
      const heldBy = { ...s.heldBy };
      if (instanceId) heldBy[judgeId] = instanceId;
      else delete heldBy[judgeId];
      return { heldBy };
    }),
  setBubble: (from, b) =>
    set((s) => {
      const bubbles = { ...s.bubbles };
      if (b) bubbles[from] = b;
      else delete bubbles[from];
      // 同時に表示する吹き出しは最大2つ（ADR-0005 §6）
      const keys = Object.keys(bubbles);
      while (keys.length > 2) delete bubbles[keys.shift()!];
      return { bubbles };
    }),
  clearBubbles: () => set({ bubbles: {} }),
  // 同じ知らせが出ているあいだは重ねない（同じ出来事を二度受けても1回だけ）
  toast: (text, tone = 'info') =>
    set((s) => (s.toasts.some((t) => toastKey(t.text) === toastKey(text)) ? {} : { toasts: [...s.toasts.slice(-2), { id: `t${++n}`, text, tone }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  select: (selected) => set({ selected }),
  setIdeaBoxOpen: (ideaBoxOpen) => set({ ideaBoxOpen }),
  markUpdated: (instanceId) => set((s) => ({ justUpdated: { ...s.justUpdated, [instanceId]: Date.now() } })),
}));
