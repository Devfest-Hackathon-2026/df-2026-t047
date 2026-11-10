import { describe, expect, it } from 'vitest';
import { activeTasteJudges, isTasteRead, signalsUntilRead, TASTE_MIN_SIGNALS, tasteLeaning } from './taste-summary.ts';

const judges = [
  { judgeId: 'a', label: 'ゆうと', color: '#f00' },
  { judgeId: 'b', label: 'さき', color: '#0f0' },
  { judgeId: 'c', label: 'けん', color: '#00f' },
];

describe('activeTasteJudges', () => {
  it('returns no judges when nobody has reacted yet', () => {
    const taste = { judges: {}, signals: {} };
    expect(activeTasteJudges(taste, judges)).toEqual([]);
  });

  it('returns only judges with at least one reaction and a taste vector, in judge order', () => {
    const v = [0, 0, 0, 0, 0, 0, 0, 0];
    const taste = { judges: { a: v, b: v, c: v }, signals: { a: 0, b: 3, c: 1 } };
    expect(activeTasteJudges(taste, judges).map((j) => j.judgeId)).toEqual(['b', 'c']);
  });

  it('skips a judge whose reaction count is positive but has no taste vector yet', () => {
    const taste = { judges: {}, signals: { a: 2 } };
    expect(activeTasteJudges(taste, judges)).toEqual([]);
  });
});

describe('isTasteRead / signalsUntilRead', () => {
  const v = [0, 0, 0, 0, 0, 0, 0, 0];
  it('reads a judge only after TASTE_MIN_SIGNALS reactions', () => {
    const taste = { judges: { a: v, b: v }, signals: { a: 2, b: TASTE_MIN_SIGNALS } };
    expect(isTasteRead(taste, 'a')).toBe(false);
    expect(signalsUntilRead(taste, 'a')).toBe(TASTE_MIN_SIGNALS - 2);
    expect(isTasteRead(taste, 'b')).toBe(true);
    expect(signalsUntilRead(taste, 'b')).toBe(0);
  });

  it('does not read a judge without a taste vector', () => {
    expect(isTasteRead({ judges: {}, signals: { a: 9 } }, 'a')).toBe(false);
  });
});

describe('tasteLeaning', () => {
  it('names the two strongest axes softly (〜寄り), and ignores small leanings', () => {
    const v = [0, 0.6, 0, -0.4, 0.1, 0, 0, 0];
    const words = tasteLeaning(v);
    expect(words).toHaveLength(2);
    expect(words.every((w) => w.endsWith('寄り'))).toBe(true);
    expect(words.some((w) => w.includes('高め'))).toBe(false);
    expect(tasteLeaning([0.1, -0.1, 0, 0, 0, 0, 0, 0])).toEqual([]);
  });
});
