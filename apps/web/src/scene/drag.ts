import type { PointerEvent as ReactPointerEvent } from 'react';
import { useDisplay } from '../store/display-store.ts';
import { useSession } from '../store/session-store.ts';

/** クリック（深掘り）とドラッグ（昇格）を分ける移動量のしきい値（AC-11） */
const DRAG_THRESHOLD_PX = 7;

let dropZone: HTMLElement | null = null;
export function registerDropZone(el: HTMLElement | null) {
  dropZone = el;
}

function isOverDropZone(x: number, y: number) {
  if (!dropZone) return false;
  const r = dropZone.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

let dragHover = false;
const hoverListeners = new Set<(over: boolean) => void>();
export function onDropHover(fn: (over: boolean) => void) {
  hoverListeners.add(fn);
  return () => hoverListeners.delete(fn);
}
function setHover(over: boolean) {
  if (over === dragHover) return;
  dragHover = over;
  hoverListeners.forEach((fn) => fn(over));
}

/**
 * 下段キャラ本体のポインター操作。
 * つかむ動きはローカルで即時に表示し（楽観的UI）、昇格の確定はサーバーに任せる（AC-13）。
 */
export function startCharacterPointer(e: ReactPointerEvent, instanceId: string, designId: number) {
  if (e.button !== 0) return;
  e.preventDefault();
  const start = { x: e.clientX, y: e.clientY };
  let dragging = false;
  const display = useDisplay.getState;
  const session = useSession.getState;

  const move = (ev: PointerEvent) => {
    const pointer = { x: ev.clientX, y: ev.clientY };
    if (!dragging) {
      if (Math.hypot(pointer.x - start.x, pointer.y - start.y) < DRAG_THRESHOLD_PX) return;
      dragging = true;
      session().client?.sendEphemeral('DRAG_PREVIEW', { instanceId });
    }
    display().setDrag({ instanceId, designId, pointer, phase: 'dragging' });
    setHover(isOverDropZone(pointer.x, pointer.y));
  };

  const up = async (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    setHover(false);
    if (!dragging) {
      display().select(instanceId);
      return;
    }
    session().client?.sendEphemeral('DRAG_PREVIEW', { instanceId: null });
    const pointer = { x: ev.clientX, y: ev.clientY };
    const returnHome = () => {
      display().setDrag(null);
      display().addFlight({ instanceId, designId, from: pointer, kind: 'return' });
    };
    if (ev.type === 'pointercancel' || !isOverDropZone(pointer.x, pointer.y)) {
      returnHome();
      return;
    }
    display().setDrag({ instanceId, designId, pointer, phase: 'pending' });
    const outcome = await session().send('REQUEST_PROMOTION', { instanceId });
    // 成功時は PROMOTION_CONFIRMED のイベント処理が drag を片付けて上段へ飛ばす
    if (!outcome.ok && display().drag?.instanceId === instanceId) returnHome();
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}
