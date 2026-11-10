import { useDisplay } from '../store/display-store.ts';

/**
 * オフィシャル会議モード（#36）の表示用ヘルパー。
 * 文言の対応表は docs/plans/2026-11-09-meeting-formality-research.md（#35）を参照。
 * 表示専用で、バックエンドやデータモデルには影響しない。
 */
export type Formality = 0 | 1;

export function useFormality(): Formality {
  return useDisplay((s) => s.formality);
}

/** formality に応じて文言を選ぶ（0=カジュアル、1=オフィシャル） */
export function pick(formality: Formality, casual: string, official: string): string {
  return formality === 1 ? official : casual;
}
