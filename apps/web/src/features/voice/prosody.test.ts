import { describe, expect, it } from 'vitest';
import { HumDetector, type HumEvent } from './prosody.ts';

/** 振幅の並び（20ms ごと）から 16kHz の PCM を作り、100ms ずつ流す */
function feed(detector: HumDetector, amps: number[]) {
  const pcm = new Int16Array(amps.length * 320);
  amps.forEach((a, f) => {
    for (let i = 0; i < 320; i++) pcm[f * 320 + i] = Math.round(a * 32767 * Math.sin((2 * Math.PI * 140 * (f * 320 + i)) / 16000));
  });
  for (let i = 0; i < pcm.length; i += 1600) detector.push(pcm.subarray(i, i + 1600));
}
const frames = (ms: number, amp: number | ((i: number) => number)) =>
  Array.from({ length: ms / 20 }, (_, i) => (typeof amp === 'number' ? amp : amp(i)));

describe('HumDetector', () => {
  it('揺れの少ない声が約1秒続いて黙ると「うーん」として1回知らせる', () => {
    const got: HumEvent[] = [];
    const d = new HumDetector((e) => got.push(e));
    feed(d, [...frames(1000, 0.001), ...frames(1000, 0.2), ...frames(800, 0.001)]);
    expect(got).toHaveLength(1);
    expect(got[0]!.durationMs).toBeGreaterThanOrEqual(900);
  });

  it('音節ごとに大きさが揺れる普通の話し声には反応しない', () => {
    const got: HumEvent[] = [];
    const d = new HumDetector((e) => got.push(e));
    feed(d, [...frames(1000, 0.001), ...frames(1200, (i) => (i % 8 < 4 ? 0.3 : 0.06)), ...frames(800, 0.001)]);
    expect(got).toHaveLength(0);
  });

  it('長すぎる声（2秒以上）や、すぐ話し続ける場合は反応しない', () => {
    const got: HumEvent[] = [];
    const d = new HumDetector((e) => got.push(e));
    feed(d, [...frames(1000, 0.001), ...frames(2400, 0.2), ...frames(800, 0.001)]);
    feed(d, [...frames(900, 0.2), ...frames(200, 0.001), ...frames(600, 0.25), ...frames(100, 0.001)]);
    expect(got).toHaveLength(0);
  });
});
