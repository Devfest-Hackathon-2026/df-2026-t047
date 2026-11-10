import type { Point } from '../store/display-store.ts';

/**
 * キャラの表示位置を DOM から引くための目印。
 * data-anchor="lower:<instanceId>" / "upper:<instanceId>" / "upper-slot:<index>"
 */
export function anchorCenter(anchor: string): Point | null {
  const el = document.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(anchor)}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export function anchorRect(anchor: string): DOMRect | null {
  return document.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(anchor)}"]`)?.getBoundingClientRect() ?? null;
}
