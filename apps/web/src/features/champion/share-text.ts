import type { ProposalContent } from '@idea-audition/protocol';

/**
 * 優勝案を、チャットに貼って読みやすい文章にする（LINE・Slack・メールなど、どこでも）。
 * 企画書ができていればその中身、まだなら案の説明と改善点だけ。
 */
export function championText(input: {
  theme: string;
  title: string;
  summary: string;
  points: string[];
  proposal: ProposalContent | null;
}): string {
  const p = input.proposal;
  const lines: string[] = [`【IDEA AUDITION 優勝案】${p?.title ?? input.title}`];
  if (p) {
    lines.push(p.catchphrase, '', `テーマ：${input.theme}`, '', '■ 背景', p.background, '', '■ 解決したい課題', p.problem, '', `■ 対象者\n${p.target}`, '', `■ 提供する価値\n${p.value}`, '', '■ 企画の概要', p.overview);
    if (p.features.length) lines.push('', '■ 主な内容', ...p.features.map((f) => `・${f.name}：${f.detail}`));
    if (p.plan.length) lines.push('', '■ 進め方', ...p.plan.map((s) => `・${s.phase}（${s.period}）：${s.tasks}`));
    lines.push('', `■ 体制\n${p.resources}`, '', `■ 予算の目安\n${p.budget}`);
    if (p.kpis.length) lines.push('', '■ 成果の測り方', ...p.kpis.map((k) => `・${k}`));
    if (p.nextActions.length) lines.push('', '■ 次の一手', ...p.nextActions.map((a) => `・${a}`));
    if (p.assumptions.length) lines.push('', '■ 要検証の前提', ...p.assumptions.map((a) => `・${a}`));
  } else {
    lines.push(input.summary.replace(/\n/g, ' '), '', `テーマ：${input.theme}`);
    if (input.points.length) lines.push('', ...input.points.map((t) => `・${t}`));
  }
  return lines.join('\n');
}
