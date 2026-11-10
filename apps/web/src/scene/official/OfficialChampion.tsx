import { AlertCircle, ArrowRight, BookOpen, Copy, FileText, Lightbulb, Link2, Sparkles, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useDisplay } from '../../store/display-store.ts';
import { useSession } from '../../store/session-store.ts';
import { copyText } from '../../shared/copy-text.ts';
import { currentRevision, useMe } from '../../shared/selectors.ts';
import { ProposalButton, ProposalViewer } from '../../features/champion/ChampionScreen.tsx';
import { championText } from '../../features/champion/share-text.ts';
import { copyInvite } from '../../shared/invite.ts';
import { downloadMinutes } from '../../shared/minutes.ts';
import { PhaseDots } from './PhaseDots.tsx';
import styles from './Official.module.css';

/**
 * オフィシャル会議モードの優勝（採択）。トロフィー・観客・紙吹雪は出さず、会議の決定事項としてまとめる。
 * 採択した案・決め方・合意事項・次のアクション、企画書（その場でめくる・PDF）
 */
export function OfficialChampion() {
  const snapshot = useSession((s) => s.snapshot)!;
  const send = useSession((s) => s.send);
  const toast = useDisplay((s) => s.toast);
  const { isHost } = useMe();
  const [viewerOpen, setViewerOpen] = useState(false);
  const champ = snapshot.champion!;
  useEffect(() => setViewerOpen(false), [champ.revisionId]);
  const rev = currentRevision(snapshot, champ.instanceId);
  if (!rev) return null;
  const tally = snapshot.vote?.tally ?? null;
  const votes = tally ? (tally[champ.instanceId] ?? 0) : null;
  const ballots = tally ? Object.values(tally).reduce((a, b) => a + b, 0) : null;
  const decidedBy =
    votes !== null ? `投票（${votes} / ${ballots} 票）` : snapshot.mode === 'solo' ? '単独審査で決定' : 'ホストが決定';
  const agreed = snapshot.consensus.claims.filter((c) => c.status === 'agreed');
  const proposal = snapshot.proposal?.status === 'ready' ? snapshot.proposal.content : null;
  const reviewed = Object.keys(snapshot.characters).length;
  const minutes = snapshot.startedAt ? Math.max(1, Math.round((Date.now() - Date.parse(snapshot.startedAt)) / 60000)) : null;
  const people = snapshot.judges.map((j) => j.name ?? j.label).join('、');

  const imageUrl = proposal?.imageUrl ?? null;
  const copy = () => {
    const text = championText({
      theme: snapshot.theme,
      title: rev.title,
      summary: rev.summary,
      points: rev.outline ? [`対象：${rev.outline.who}`, `課題：${rev.outline.pain}`, `解決策：${rev.outline.how}`] : rev.improvementPoints,
      proposal,
    });
    void copyText(text).then((ok) => toast(ok ? '決定事項をコピーしました' : 'コピーできませんでした', ok ? 'gold' : 'warn'));
  };

  return (
    <div className={styles.decisionRoom}>
      <section className={styles.stageCard} aria-label="最終決定">
        <div className={styles.cardTop}>
          <PhaseDots phase={3} />
          <span className={styles.agendaInline}>
            議題 <b>{snapshot.theme}</b>
          </span>
          <span className={styles.tag}>{decidedBy}</span>
        </div>
        <article className={styles.proposal} data-noimage={!imageUrl || undefined}>
          {imageUrl && <img className={styles.decisionImage} src={imageUrl} alt="" />}
          <div className={styles.proposalBody}>
            <div className={styles.badges}>
              <span className={styles.decidedBadge}>企画の決定</span>
              <span className={styles.aiBadge}>
                <Sparkles size={13} /> AI 提案
              </span>
            </div>
            <h1 className={styles.proposalTitle}>{rev.title}</h1>
            <p className={styles.docSummary}>{rev.summary}</p>
            {rev.outline && (
              <ul className={styles.points}>
                <li>
                  <Users size={18} />
                  <span>
                    <small>対象</small>
                    {rev.outline.who}
                  </span>
                </li>
                <li>
                  <AlertCircle size={18} />
                  <span>
                    <small>課題</small>
                    {rev.outline.pain}
                  </span>
                </li>
                <li>
                  <Lightbulb size={18} />
                  <span>
                    <small>解決策</small>
                    {rev.outline.how}
                  </span>
                </li>
              </ul>
            )}
          </div>
        </article>
        <div className={styles.outputs}>
          <ProposalButton label="決定事項を出力（PDF）" />
          <button className={styles.secondary} onClick={() => downloadMinutes(snapshot, useDisplay.getState().chatLog)}>
            <FileText size={15} /> 議事録をダウンロード
          </button>
          <button className={styles.secondary} onClick={copy}>
            <Copy size={15} /> 内容をコピー
          </button>
          <button className={styles.secondary} onClick={() => void copyInvite().then((ok) => toast(ok ? '共有リンクをコピーしました' : 'コピーできませんでした', ok ? 'gold' : 'warn'))}>
            <Link2 size={15} /> 共有リンクを発行
          </button>
          {proposal && (
            <button className={styles.secondary} onClick={() => setViewerOpen(true)}>
              <BookOpen size={15} /> 企画書を見る
            </button>
          )}
        </div>
        <section className={styles.minutes} aria-label="決定の記録">
          <div>
            <h2>合意事項</h2>
            {agreed.length ? (
              <ul>
                {agreed.map((c) => (
                  <li key={c.label}>{c.text}</li>
                ))}
              </ul>
            ) : (
              <p className={styles.muted}>記録なし</p>
            )}
          </div>
          <div>
            <h2>次のアクション</h2>
            {proposal?.nextActions.length ? (
              <ul>
                {proposal.nextActions.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            ) : (
              <p className={styles.muted}>{snapshot.proposal?.status === 'generating' ? '企画書の作成中' : '記録なし'}</p>
            )}
          </div>
        </section>
      </section>
      <aside className={styles.discussion} aria-label="会議の概要">
        <div className={styles.summary}>
          <h3>会議の概要</h3>
          <dl className={styles.summaryList}>
            <div>
              <dt>参加者</dt>
              <dd>{people}</dd>
            </div>
            <div>
              <dt>審議した提案</dt>
              <dd>{reviewed} 件</dd>
            </div>
            <div>
              <dt>最終審議</dt>
              <dd>{snapshot.upper.length} 件</dd>
            </div>
            {minutes && (
              <div>
                <dt>所要時間</dt>
                <dd>約 {minutes} 分</dd>
              </div>
            )}
            <div>
              <dt>決定方法</dt>
              <dd>{decidedBy}</dd>
            </div>
          </dl>
          {isHost || snapshot.mode === 'solo' ? (
            <button className={styles.secondary} onClick={() => void send('RESET_SESSION', {})}>
              新しい会議を始める <ArrowRight size={15} />
            </button>
          ) : (
            <span className={styles.muted}>次の会議はホストが始めます</span>
          )}
        </div>
      </aside>
      {viewerOpen && <ProposalViewer onClose={() => setViewerOpen(false)} />}
    </div>
  );
}
