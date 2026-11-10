import { create } from 'zustand';
import {
  REJECT_REASON_LABEL,
  type CommandPayload,
  type CommandType,
  type EphemeralMessage,
  type EventMessage,
  type SessionSnapshot,
} from '@idea-audition/protocol';
import { CampClient, type CommandOutcome, type ConnectionState, type SendOptions } from '../net/camp-client.ts';
import { useDisplay } from './display-store.ts';
import { anchorCenter } from '../shared/anchors.ts';

/** 業務状態：サーバーから届いた snapshot をそのまま持つ（判定はしない） */
interface SessionState {
  /** いま入っている部屋の ID（URL の /a/<ID>）。部屋に入っていなければ '' */
  sessionId: string;
  judgeId: string | null;
  snapshot: SessionSnapshot | null;
  connection: ConnectionState;
  client: CampClient | null;
  /** none：部屋に入っていない（トップ）、active：部屋に入っている、not_found：リンクの部屋が見つからない */
  room: 'none' | 'active' | 'not_found';
  /** ロビーでホストが入力中のテーマ（ホスト以外の画面に見せる） */
  themeDraft: { theme: string; mode: 'team' | 'solo'; aiMode: 'gemini' | 'fixture' | null; finalists?: number; challengeSec?: number } | null;
  connect(sessionId: string): void;
  /** 部屋を作ってそのリンクに移り、入る（Google Meet の「新しい会議」と同じ） */
  createRoom(): Promise<boolean>;
  /** 部屋を出てトップに戻る */
  leaveRoom(): Promise<void>;
  send<T extends CommandType>(type: T, payload: CommandPayload<T>, opts?: SendOptions): Promise<CommandOutcome>;
}

const storageKey = (sessionId: string) => `idea-audition:judge:${sessionId}`;

/** 部屋のリンク（/a/kqd-rmzw-tbe） */
export const roomPath = (roomId: string) => `/a/${roomId}`;
export const roomUrl = (roomId: string) => `${location.origin}${roomPath(roomId)}`;

/** 開き直しても同じ審査員として戻るための、審査員 ID と合言葉（このタブのあいだだけ覚える） */
interface SavedSeat {
  judgeId: string;
  resumeToken?: string;
}

function readSeat(sessionId: string): SavedSeat | undefined {
  try {
    const raw = sessionStorage.getItem(storageKey(sessionId));
    if (!raw) return undefined;
    // 前の版は審査員 ID だけを文字列で保存していた（合言葉が無いので、新しい審査員として入り直す）
    return raw.startsWith('{') ? (JSON.parse(raw) as SavedSeat) : { judgeId: raw };
  } catch {
    return undefined;
  }
}

function writeSeat(sessionId: string, seat: SavedSeat) {
  try {
    sessionStorage.setItem(storageKey(sessionId), JSON.stringify(seat));
  } catch {
    /* プライベートモード等では保存しない */
  }
}

export const useSession = create<SessionState>((set, get) => ({
  sessionId: '',
  judgeId: null,
  snapshot: null,
  connection: 'connecting',
  client: null,
  room: 'none',
  themeDraft: null,

  connect(sessionId) {
    get().client?.close();
    const current = () => get().client === client;
    const client: CampClient = new CampClient(
      sessionId,
      {
        // 退出したあと（client を差し替えたあと）に古い接続から届いたものは無視する
        onRoomNotFound: () => current() && set({ room: 'not_found', client: null, snapshot: null, judgeId: null }),
        onWelcome: (m) => {
          if (!current()) return;
          if (m.participantId) writeSeat(sessionId, { judgeId: m.participantId, ...(m.resumeToken ? { resumeToken: m.resumeToken } : {}) });
          set({ judgeId: m.participantId, snapshot: m.snapshot, room: 'active' });
        },
        onEvent: (m) => current() && handleEvent(m, (snapshot) => set({ snapshot })),
        onEphemeral: (m) => current() && handleEphemeral(m),
        onState: (connection) => current() && set({ connection }),
        onProtocolError: (m) => {
          if (m.code === 'UNSUPPORTED_VERSION') {
            useDisplay.getState().toast('サーバーが新しくなりました。画面を再読み込みしてください', 'warn');
          }
        },
      },
      readSeat(sessionId),
    );
    set({ sessionId, client, room: 'active', connection: 'connecting', snapshot: null, judgeId: null, themeDraft: null });
    client.connect();
  },

  async createRoom() {
    try {
      const res = await fetch('/api/rooms', { method: 'POST' });
      if (!res.ok) {
        useDisplay
          .getState()
          .toast(res.status === 429 ? '作れる回数の上限です。しばらくしてからお試しください' : 'いまは新しく作れません。少し待ってからお試しください', 'warn');
        return false;
      }
      const { roomId } = (await res.json()) as { roomId: string };
      history.pushState(null, '', roomPath(roomId));
      get().connect(roomId);
      return true;
    } catch {
      useDisplay.getState().toast('サーバーにつながりません。通信を確かめてください', 'warn');
      return false;
    }
  },

  async leaveRoom() {
    const { client, sessionId, judgeId } = get();
    try {
      if (sessionId) sessionStorage.removeItem(storageKey(sessionId));
    } catch {
      // 保存できない環境では何もしない
    }
    // 画面はすぐトップに戻す
    if (location.pathname !== '/') history.pushState(null, '', '/');
    set({ sessionId: '', client: null, snapshot: null, judgeId: null, room: 'none', connection: 'connecting' });
    // 退出をサーバーに伝えてから切る（ほかの人の一覧から自分の名前が消える）。返事が来なくても1.5秒で切る
    if (client && judgeId) {
      await Promise.race([client.send('LEAVE_SESSION', {}).catch(() => undefined), new Promise((r) => setTimeout(r, 1_500))]);
    }
    client?.close();
  },

  async send(type, payload, opts) {
    const client = get().client;
    if (!client) return { ok: false, reason: 'TIMEOUT' };
    const outcome = await client.send(type, payload, opts);
    if (!outcome.ok) {
      const label =
        outcome.reason === 'TIMEOUT' ? '通信が不安定です。もう一度お試しください' : REJECT_REASON_LABEL[outcome.reason];
      useDisplay.getState().toast(label, 'warn');
    }
    return outcome;
  },
}));

/* ----------------------- イベント → 演出のつなぎ ----------------------- */

/** 操作した人の呼び方（自分なら「あなた」、ほかの人は「Bさん」）。わからなければ null */
function whoDid(snapshot: SessionSnapshot, actorId: string | null) {
  if (!actorId) return null;
  if (actorId === useSession.getState().judgeId) return 'あなた';
  const j = snapshot.judges.find((x) => x.judgeId === actorId);
  if (!j) return null;
  return `${j.name || j.letter || j.label.replace('審査員 ', '')}さん`;
}

function nameOf(snapshot: SessionSnapshot, instanceId: unknown) {
  return typeof instanceId === 'string' ? (snapshot.characters[instanceId]?.name ?? 'AI') : 'AI';
}

/** 案の企画名（オフィシャル会議モードの知らせはキャラの名前ではなく企画名で言う） */
function titleOf(snapshot: SessionSnapshot, instanceId: unknown) {
  if (typeof instanceId !== 'string') return '提案';
  const c = snapshot.characters[instanceId];
  const idea = c ? snapshot.ideas[c.ideaId] : undefined;
  return idea?.revisions.at(-1)?.title ?? '提案';
}

/** 🤔 の一言を最低限見せる時間と、いつ出したか */
const REACTION_MIN_MS = 2200;
const reactedAt = new Map<string, number>();

function handleEvent(e: EventMessage, apply: (s: SessionSnapshot) => void) {
  const display = useDisplay.getState();
  const myJudgeId = useSession.getState().judgeId;
  const d = e.detail;

  // DOM が新しい snapshot で描き変わる前に、移動元の位置を取っておく
  if (e.type === 'PROMOTION_CONFIRMED' && typeof d.instanceId === 'string') {
    const instanceId = d.instanceId;
    const character = e.snapshot.characters[instanceId];
    const drag = display.drag;
    const from =
      drag?.instanceId === instanceId ? drag.pointer : anchorCenter(`lower:${instanceId}`);
    if (drag?.instanceId === instanceId) display.setDrag(null);
    if (from && character) display.addFlight({ instanceId, designId: character.designId, from, kind: 'upper' });
  }

  // 退場した案は Idea BOX へ飛ばす（仕様書 22.7「落選：フリップを畳んで Idea BOX へ」）
  if (e.type === 'CANDIDATE_ARCHIVED' && typeof d.instanceId === 'string') {
    const from = anchorCenter(`lower:${d.instanceId}`);
    const character = e.snapshot.characters[d.instanceId];
    if (from && character) display.addFlight({ instanceId: d.instanceId, designId: character.designId, from, kind: 'box' });
  }

  apply(e.snapshot);

  if (e.type === 'CANDIDATE_ARCHIVED' && d.reason === 'rejected') {
    const by = typeof d.byJudgeId === 'string' ? e.snapshot.judges.find((j) => j.judgeId === d.byJudgeId)?.label : null;
    display.toast({
      casual: `${nameOf(e.snapshot, d.instanceId)} の案を見送りました${by ? `（${by}）` : ''}。次の人と交代します`,
      official: `「${titleOf(e.snapshot, d.instanceId)}」を見送りました${by ? `（${by}）` : ''}`,
    });
  }

  switch (e.type) {
    case 'PROMOTION_CONFIRMED': {
      // 全員のゴールデンブザーで合格（#5）。3人そろったら最終オーディション
      const full = e.snapshot.upper.length >= (e.snapshot.finalists ?? 3);
      display.toast(
        {
          casual: `${nameOf(e.snapshot, d.instanceId)} 合格！${full ? '最終オーディションへ' : ''}`,
          official: `「${titleOf(e.snapshot, d.instanceId)}」を採択候補に追加しました${full ? '。最終審議に進みます' : ''}`,
        },
        'gold',
      );
      break;
    }
    case 'FINALIST_CRITIQUE_POSTED':
      if (typeof d.fromInstanceId === 'string' && typeof d.toInstanceId === 'string') {
        display.setBubble(d.fromInstanceId, {
          text: String(d.text ?? ''),
          toInstanceId: d.toInstanceId,
          critiqueId: String(d.critiqueId ?? ''),
        });
      }
      break;
    case 'FINALIST_VERSION_PUBLISHED':
      if (typeof d.instanceId === 'string') {
        display.markUpdated(d.instanceId);
        const id = d.instanceId;
        setTimeout(() => useDisplay.getState().setBubble(id, null), 2500);
      }
      break;
    case 'CANDIDATE_ANSWERED': {
      // 質問を受けたらすぐ「考え中…」、答えが来たら吹き出しで見せる（全員の画面）
      const answerId = typeof d.answerId === 'string' ? d.answerId : null;
      const a = answerId ? e.snapshot.answers.find((x) => x.answerId === answerId) : null;
      const instanceId = a?.instanceId ?? (typeof d.instanceId === 'string' ? d.instanceId : null);
      if (!instanceId) break;
      const key = `answer:${answerId ?? e.seq}`;
      const text = d.misheard
        ? `🙉 ${String(d.text ?? 'うまく聞き取れなかったよ。もう一度言ってみて？')}`
        : d.pending
          ? '💭 考え中…'
          : a?.answer
            ? `💬 ${a.answer}`
            : null;
      if (!text) break;
      display.setBubble(instanceId, { text, toInstanceId: '', critiqueId: key });
      if (!d.pending) {
        const ms = Math.min(14_000, 4_000 + text.length * 80);
        setTimeout(() => {
          if (useDisplay.getState().bubbles[instanceId]?.critiqueId === key) useDisplay.getState().setBubble(instanceId, null);
        }, ms);
      }
      break;
    }
    case 'CANDIDATE_REACTED':
      // 「うーん」に気づいたキャラが 🤔 で一言（ADR-0009 ③）
      if (typeof d.instanceId === 'string') {
        const id = d.instanceId;
        const key = `react:${e.seq}`;
        reactedAt.set(id, Date.now());
        display.setBubble(id, { text: `🤔 ${String(d.text ?? '')}`, toInstanceId: '', critiqueId: key });
        setTimeout(() => {
          if (useDisplay.getState().bubbles[id]?.critiqueId === key) useDisplay.getState().setBubble(id, null);
        }, 6000);
      }
      break;
    case 'CANDIDATE_REVISED':
      if (typeof d.instanceId === 'string') {
        const id = d.instanceId;
        const key = `revised:${e.seq}`;
        // 🤔 の一言を読めるだけ見せてから、別案の一言に替える
        const wait = Math.max(0, REACTION_MIN_MS - (Date.now() - (reactedAt.get(id) ?? 0)));
        setTimeout(() => {
          useDisplay.getState().setBubble(id, { text: '💡 別のかたちにしてみました！', toInstanceId: '', critiqueId: key });
          setTimeout(() => {
            if (useDisplay.getState().bubbles[id]?.critiqueId === key) useDisplay.getState().setBubble(id, null);
          }, 3500);
        }, wait);
      }
      break;
    case 'JUDGE_UTTERANCE_RECEIVED':
      // 声の発言は、聞こえたままも AI が言い直したものも画面に出さない（issue #2・#3）。テキストで打った発言だけ字幕に出す
      if (d.source === 'text' && typeof d.judgeId === 'string' && typeof d.text === 'string') {
        display.addCaption({
          judgeId: d.judgeId,
          text: d.text,
          intent: (['instruction', 'question', 'reject', 'hesitation', 'positive'] as const).find((x) => x === d.intent) ?? 'comment',
          targetInstanceId: typeof d.targetInstanceId === 'string' ? d.targetInstanceId : null,
        });
      }
      // 声やテキストで質問しても詳細は開かない（開くのは本人のクリックだけ）。答えはキャラの吹き出しで出す
      break;
    case 'CONSENSUS_UPDATED': {
      const changes = Array.isArray(d.statusChanges) ? (d.statusChanges as { label: string; text: string; to: string }[]) : [];
      for (const c of changes) {
        if (c.to === 'agreed') display.toast(`合意：「${c.text}」`, 'gold');
        else if (c.to === 'rejected') display.toast(`却下：「${c.text}」`);
        else if (c.to === 'proposed' && !('from' in c && c.from)) display.toast(`新しい論点：「${c.text}」`);
      }
      break;
    }
    case 'AI_MODE_CHANGED':
      display.toast(d.mode === 'gemini' ? 'AI を Gemini に切り替えました（クレジットを使います）' : 'AI を固定データに切り替えました（無料）');
      break;
    case 'CHAMPION_VOTE_STARTED':
      // 投票の始まりは、見出しの「最終投票」の帯と各案の投票ボタンで分かる（お知らせは帯に重なるので出さない）
      display.setMyVote(null);
      break;
    case 'TIE_DETECTED':
      display.toast({ casual: '同票です。ホストが優勝を決めます', official: '同票です。ホストが採択する案を決めます' }, 'gold');
      break;
    case 'HOST_CHANGED':
      if (d.judgeId === myJudgeId) display.toast('あなたがホストになりました');
      break;
    case 'SESSION_STARTED':
    case 'SESSION_RESET':
      display.clearBubbles();
      if (e.type === 'SESSION_RESET') display.clearChatLog();
      display.select(null);
      break;
  }
}

/**
 * ほかの機能（通話など）が自分宛ての Ephemeral を受け取るための登録口。
 * session-store から各機能を import すると読み込みが循環するので、機能の側から登録してもらう
 */
const ephemeralListeners = new Map<string, (senderId: string, payload: unknown) => void>();
export function onEphemeral(type: EphemeralMessage['type'], listener: (senderId: string, payload: unknown) => void) {
  ephemeralListeners.set(type, listener);
}

function handleEphemeral(m: EphemeralMessage) {
  if (!m.senderId) return;
  const display = useDisplay.getState();
  switch (m.type) {
    case 'CURSOR_MOVED':
      display.setCursor(m.senderId, m.payload ? { ...m.payload, updatedAt: Date.now() } : null);
      break;
    case 'DRAG_PREVIEW':
      display.setHeld(m.senderId, m.payload.instanceId);
      break;
    case 'MIC_STATE_CHANGED':
      display.setMic(m.senderId, m.payload.on);
      break;
    case 'THEME_DRAFT':
      useSession.setState({ themeDraft: m.payload });
      break;
    default:
      ephemeralListeners.get(m.type)?.(m.senderId, m.payload);
  }
}
