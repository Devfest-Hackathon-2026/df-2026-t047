import type { SessionSnapshot } from '@idea-audition/protocol';
import type { ChatEntry } from '../store/display-store.ts';
import { proposalLabel } from './proposal-label.ts';
import { currentRevision, judgeById } from './selectors.ts';

const STANCE = { support: '賛成', oppose: '反対' } as const;

/**
 * 会議の議事録（Markdown）。議題・参加者・審議した提案と結果・合意事項・論点・質疑応答・発言・決定。
 * サーバーには残さず、いま画面にある記録（スナップショットと、この端末の発言ログ）から作る
 */
export function buildMinutes(snapshot: SessionSnapshot, log: readonly ChatEntry[], now = new Date()): string {
  const out: string[] = [];
  const label = (id: string) => proposalLabel(snapshot, id, 1);
  const name = (judgeId: string) => {
    const j = judgeById(snapshot, judgeId);
    return j?.name ?? j?.label ?? '参加者';
  };
  const started = snapshot.startedAt ? new Date(snapshot.startedAt) : null;
  const fmt = (d: Date) => d.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

  out.push(`# 議事録：${snapshot.theme}`, '');
  out.push(`- 日時：${started ? `${fmt(started)} 〜 ` : ''}${fmt(now)}`);
  out.push(`- 参加者：${snapshot.judges.map((j) => j.name ?? j.label).join('、')}`);
  out.push('');

  const champ = snapshot.champion ? currentRevision(snapshot, snapshot.champion.instanceId) : null;
  if (champ) {
    out.push('## 決定事項', '', `**${champ.title}**`, '', champ.summary, '');
    if (champ.outline) out.push(`- 対象：${champ.outline.who}`, `- 課題：${champ.outline.pain}`, `- 解決策：${champ.outline.how}`, '');
    const next = snapshot.proposal?.status === 'ready' ? (snapshot.proposal.content?.nextActions ?? []) : [];
    if (next.length) out.push('### 次のアクション', '', ...next.map((t) => `- ${t}`), '');
  }

  const upper = new Set(snapshot.upper.map((f) => f.instanceId));
  const ids = Object.keys(snapshot.characters);
  if (ids.length) {
    out.push('## 審議した提案', '');
    for (const id of ids) {
      const rev = currentRevision(snapshot, id);
      if (!rev) continue;
      const result =
        snapshot.champion?.instanceId === id ? '採択' : upper.has(id) ? '最終審議' : snapshot.lowerSlots.includes(id) ? '審議中' : '見送り';
      const tag = upper.has(id) ? `${label(id)}：` : '';
      out.push(`- ${tag}${rev.title}（${result}${rev.version > 1 ? `・版 ${rev.version}` : ''}）— ${rev.summary.replace(/\s*\n\s*/g, ' ')}`);
    }
    out.push('');
  }

  const claims = snapshot.consensus.claims.filter((c) => c.status === 'agreed' || c.status === 'proposed');
  if (claims.length) {
    out.push('## 合意事項と論点', '');
    for (const c of claims) {
      const stances = Object.entries(c.stances ?? {})
        .map(([judgeId, s]) => `${name(judgeId)} ${STANCE[s as keyof typeof STANCE] ?? s}`)
        .join('、');
      out.push(`- ${c.status === 'agreed' ? '【合意】' : '【論点】'}${c.text}${stances ? `（${stances}）` : ''}`);
    }
    out.push('');
  }

  const answers = snapshot.answers.filter((a) => a.answer);
  if (answers.length) {
    out.push('## 質疑応答', '');
    for (const a of answers) out.push(`- 〔${label(a.instanceId)}〕Q：${a.question}`, `  A：${a.answer}`);
    out.push('');
  }

  if (snapshot.critiques.length) {
    out.push('## 相互の指摘', '');
    for (const c of snapshot.critiques) out.push(`- ${label(c.fromInstanceId)} → ${label(c.toInstanceId)}：${c.text}`);
    out.push('');
  }

  if (log.length) {
    out.push('## 発言', '');
    for (const m of log) {
      const t = new Date(m.at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
      const target = m.targetInstanceId ? ` → ${label(m.targetInstanceId)}` : '';
      out.push(`- ${t} ${name(m.judgeId)}${target}：${m.text}`);
    }
    out.push('');
  }
  return out.join('\n');
}

/** 議事録をファイルにして保存する */
export function downloadMinutes(snapshot: SessionSnapshot, log: readonly ChatEntry[]) {
  const blob = new Blob([buildMinutes(snapshot, log)], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  a.href = url;
  a.download = `議事録_${stamp}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
