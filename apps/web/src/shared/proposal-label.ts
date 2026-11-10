import type { SessionSnapshot } from '@idea-audition/protocol';
import type { Formality } from './formality.ts';
import { currentRevision } from './selectors.ts';

const LETTERS = 'ABCD';

/** 決勝の案の記号（A・B・C…）。上段の並び順。決勝の案でなければ null（声の「A案」と同じ記号、サーバーの proposal-letter.ts） */
export function proposalLetter(snapshot: SessionSnapshot, instanceId: string): string | null {
  const i = snapshot.upper.findIndex((f) => f.instanceId === instanceId);
  return i >= 0 ? (LETTERS[i] ?? null) : null;
}

/**
 * 案の呼び方。カジュアルはキャラの名前、オフィシャル会議モードは「A案」（決勝）か企画名（予選）。
 * チャットの宛先・詳細の見出しなど、キャラの名前を出していた場所で使う
 */
export function proposalLabel(snapshot: SessionSnapshot, instanceId: string, formality: Formality): string {
  const character = snapshot.characters[instanceId];
  if (formality === 0) return character?.name ?? '';
  const letter = proposalLetter(snapshot, instanceId);
  if (letter) return `${letter}案`;
  const title = currentRevision(snapshot, instanceId)?.title ?? '提案';
  return title.length > 14 ? `${title.slice(0, 13)}…` : title;
}
