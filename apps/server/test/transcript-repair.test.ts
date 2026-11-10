import { describe, expect, it } from 'vitest';
import { phoneticSimilarity, repairTranscript, toKatakana, type LexiconEntry } from '../src/domain/transcript-repair.ts';

const lex: LexiconEntry[] = [
  { surface: 'スプラウト', reading: 'スプラウト', boost: 0.1 },
  { surface: 'ノヴァ', reading: 'ノヴァ', boost: 0.1 },
  { surface: '混雑予測ナビ', reading: 'コンザツヨソクナビ', boost: 0.1 },
  { surface: '学食スタンプラリー', reading: 'ガクショクスタンプラリー', boost: 0.1 },
  { surface: 'スタンプラリー', reading: 'スタンプラリー', boost: 0.1 },
];

describe('文字起こしの補正', () => {
  it('合成音声で実際に出た聞き間違いを、ステージ上のキャラ名に直す', () => {
    expect(repairTranscript('ブラウト、それって留学生も', lex)).toMatchObject({
      text: 'スプラウト、それって留学生も',
      corrections: [{ from: 'ブラウト', to: 'スプラウト' }],
    });
  });

  it('見ているキャラなら、もう少し離れた聞き間違い（スプラハ）も直す', () => {
    const focused = lex.map((e) => (e.surface === 'スプラウト' ? { ...e, boost: 0.15 } : e));
    expect(repairTranscript('スプラハとそれって', focused).text).toBe('スプラウトとそれって');
    // 見ていない・ステージにいないなら直さない
    const off = lex.map((e) => ({ ...e, boost: 0 }));
    expect(repairTranscript('スプラハとそれって', off).text).toBe('スプラハとそれって');
  });

  it('同音の漢字の取り違えを企画名に直す', () => {
    expect(repairTranscript('混雑予想ナビは却下で', lex).text).toBe('混雑予測ナビは却下で');
  });

  it('普通の言葉や、意味の違う言い換えは直さない', () => {
    for (const t of ['カフェテリアで食べたい', 'コストは高めでもいい', '学食スタンプカードがいい', 'スタンプを集める', 'プライスを下げて']) {
      expect(repairTranscript(t, lex).text).toBe(t);
    }
  });

  it('ひらがな→カタカナ、濁点の違いは近いとみなす', () => {
    expect(toKatakana('すぷらうと')).toBe('スプラウト');
    expect(phoneticSimilarity('ブラウト', 'プラウト')).toBeGreaterThan(phoneticSimilarity('ブラウト', 'カラウト'));
  });
});
