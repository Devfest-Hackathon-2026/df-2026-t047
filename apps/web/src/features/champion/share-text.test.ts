import { describe, expect, it } from 'vitest';
import { championText } from './share-text.ts';

const proposal = {
  title: '常連だけの隠し味',
  catchphrase: '皿裏の暗号で秘密の味を',
  background: '背景の文',
  problem: '課題の文',
  target: '一人で学食に来る学生',
  value: '特別感',
  overview: '概要の文',
  features: [{ name: '皿裏の暗号', detail: '日替わりで印字' }],
  plan: [{ phase: '試作', period: '1〜2週目', tasks: 'シールのテスト' }],
  resources: '学生2名',
  budget: '約8万円',
  risks: [],
  kpis: ['週100件'],
  nextActions: ['厨房に相談'],
  assumptions: ['耐水シールが手に入る'],
};

describe('優勝案の共有文', () => {
  it('企画書ができていれば、見出しつきで中身をまとめる', () => {
    const t = championText({ theme: '学食', title: 'x', summary: 's', points: [], proposal });
    expect(t.split('\n')[0]).toBe('【IDEA AUDITION 優勝案】常連だけの隠し味');
    expect(t).toContain('■ 主な内容\n・皿裏の暗号：日替わりで印字');
    expect(t).toContain('■ 進め方\n・試作（1〜2週目）：シールのテスト');
    expect(t).toContain('■ 要検証の前提\n・耐水シールが手に入る');
  });

  it('企画書がまだなら、案の説明と改善点だけ', () => {
    const t = championText({ theme: '学食', title: 'ソロ席', summary: '一人でも\n気兼ねなく', points: ['仕切りを置く'], proposal: null });
    expect(t).toBe('【IDEA AUDITION 優勝案】ソロ席\n一人でも 気兼ねなく\n\nテーマ：学食\n\n・仕切りを置く');
  });
});
