import { useDisplay } from '../store/display-store.ts';
import { useSession } from '../store/session-store.ts';

/**
 * 自分が注目しているキャラ（カーソルが乗っている・詳細を開いている）をサーバーに知らせる。
 * サーバーは注目中の案を退場させず、注目度を上げる（ADR-0006）。変化したときだけ送る。
 */
let hover: string | null = null;
let detail: string | null = null;
let sent = { hover: null as string | null, detail: null as string | null };

function flush() {
  if (sent.hover === hover && sent.detail === detail) return;
  sent = { hover, detail };
  useSession.getState().client?.sendEphemeral('FOCUS_CHANGED', { hover, detail });
}

/** いま自分が見ているキャラ（迷いの宛先に使う） */
export function currentFocus() {
  return { hover, detail };
}

export function setHoverFocus(instanceId: string | null) {
  hover = instanceId;
  flush();
}

useDisplay.subscribe((s, prev) => {
  if (s.selected === prev.selected) return;
  detail = s.selected;
  flush();
});

// 再接続したらサーバー側の注目情報は消えているので送り直す
useSession.subscribe((s, prev) => {
  if (s.connection === 'open' && prev.connection !== 'open') {
    sent = { hover: null, detail: null };
    flush();
  }
});
