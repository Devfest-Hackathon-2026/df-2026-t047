import { describe, expect, it } from 'vitest';
import { SFX_TONES, isMuted, playSfx, setMuted } from './sfx.ts';

describe('効果音', () => {
  it('消音を切り替えられる', () => {
    setMuted(true);
    expect(isMuted()).toBe(true);
    setMuted(false);
    expect(isMuted()).toBe(false);
  });

  it('音を出せない環境（AudioContext が無い）でも落ちない', () => {
    expect(() => playSfx('pass')).not.toThrow();
  });

  it('どの音も、長さと周波数が正の値', () => {
    for (const tones of Object.values(SFX_TONES)) {
      expect(tones.length).toBeGreaterThan(0);
      for (const t of tones) {
        expect(t.freq).toBeGreaterThan(0);
        expect(t.dur).toBeGreaterThan(0);
        expect(t.at).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
