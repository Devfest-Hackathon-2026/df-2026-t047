import { Check, ChevronRight, ClipboardList, Compass, FileText, Layers, ListChecks, MessageSquareText, Target, Users } from 'lucide-react';
import { useState } from 'react';
import type { SessionSnapshot } from '@idea-audition/protocol';
import { useDisplay } from '../../store/display-store.ts';
import { useSession } from '../../store/session-store.ts';
import { currentRevision, finalistTarget, judgeById, useMe } from '../../shared/selectors.ts';
import { useFormality } from '../../shared/formality.ts';
import { proposalLabel } from '../../shared/proposal-label.ts';
import { TasteRadar } from '../../features/taste/TasteRadar.tsx';
import styles from './Official.module.css';

/**
 * 右の列：議論の要約（現在の論点・チームの合意・採用済みのアイデア・評価の傾向）と発言ログ。
 * 論点と合意はサーバーの合意台帳（会話から AI が作り、賛否は人が付ける）。発言ログはテキスト・仕分けで残った声の発言
 */
export function DiscussionPanel() {
  const [tab, setTab] = useState<'summary' | 'log'>('summary');
  const snapshot = useSession((s) => s.snapshot);
  if (!snapshot) return null;
  return (
    <aside className={styles.discussion} aria-label="議論">
      <div className={styles.tabs} role="tablist">
        <button role="tab" aria-selected={tab === 'summary'} data-on={tab === 'summary' || undefined} onClick={() => setTab('summary')}>
          <FileText size={15} /> 議論の要約
        </button>
        <button role="tab" aria-selected={tab === 'log'} data-on={tab === 'log' || undefined} onClick={() => setTab('log')}>
          <MessageSquareText size={15} /> 発言ログ
        </button>
      </div>
      {tab === 'summary' ? <Summary snapshot={snapshot} /> : <Log snapshot={snapshot} />}
    </aside>
  );
}

function Summary({ snapshot }: { snapshot: SessionSnapshot }) {
  const send = useSession((s) => s.send);
  const select = useDisplay((s) => s.select);
  const openBox = useDisplay((s) => s.setIdeaBoxOpen);
  const { judgeId, isSpectator } = useMe();
  const members = Math.max(1, snapshot.judges.filter((j) => j.connected).length);
  const open = snapshot.consensus.claims.filter((c) => c.status === 'proposed' || c.status === 'agreed').slice(-5).reverse();
  const agreed = snapshot.consensus.claims.filter((c) => c.status === 'agreed');
  const target = finalistTarget(snapshot);
  const support = (label: string, text: string) =>
    void send('SUBMIT_UTTERANCE', { text: `「${text}」に賛成`, source: 'text', replyToClaim: label });
  return (
    <div className={styles.summary}>
      <section>
        <h3>
          <Target size={16} /> 現在の論点
        </h3>
        {open.length === 0 ? (
          <p className={styles.muted}>会話から論点をまとめます</p>
        ) : (
          <ul className={styles.claims}>
            {open.map((c) => {
              const n = Object.values(c.stances).filter((s) => s === 'support').length;
              const mine = !!judgeId && c.stances[judgeId] === 'support';
              return (
                <li key={c.label} data-agreed={c.status === 'agreed' || undefined}>
                  <div className={styles.claimRow}>
                    <span>{c.text}</span>
                    {!isSpectator && (
                      <button
                        className={styles.claimAgree}
                        data-on={mine || undefined}
                        disabled={mine}
                        aria-label={mine ? '賛成済み' : `「${c.text}」に賛成`}
                        title={mine ? '賛成済み' : '賛成する'}
                        onClick={() => support(c.label, c.text)}
                      >
                        <Check size={13} />
                      </button>
                    )}
                  </div>
                  <div className={styles.meterRow}>
                    <span className={styles.meter}>
                      <i style={{ width: `${Math.min(100, (n / members) * 100)}%` }} />
                    </span>
                    <b>
                      {n} / {members}
                    </b>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h3>
          <Users size={16} /> チームの合意
        </h3>
        {agreed.length === 0 ? (
          <p className={styles.muted}>まだ合意はありません</p>
        ) : (
          <ul className={styles.agreed}>
            {agreed.map((c) => (
              <li key={c.label}>{c.text}</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>
          <ListChecks size={16} /> 採用済みのアイデア <span className={styles.count}>{snapshot.upper.length}件</span>
        </h3>
        <ul className={styles.adopted}>
          {snapshot.upper.map((f) => {
            const rev = currentRevision(snapshot, f.instanceId);
            return (
              <li key={f.instanceId}>
                <button onClick={() => select(f.instanceId)}>
                  <span className={styles.letterSm}>{proposalLabel(snapshot, f.instanceId, 1)}</span>
                  <span className={styles.adoptedTitle}>{rev?.title}</span>
                  <Check size={16} className={styles.ok} />
                  <ChevronRight size={15} />
                </button>
              </li>
            );
          })}
          {snapshot.status === 'audition_active' && snapshot.upper.length < target && (
            <li className={styles.adoptedRest}>あと {target - snapshot.upper.length} 案を採用</li>
          )}
        </ul>
      </section>

      <section>
        <h3>
          <Compass size={16} /> 評価の傾向
        </h3>
        <div className={styles.radar}>
          <TasteRadar snapshot={snapshot} compact />
        </div>
      </section>

      <button className={styles.linkButton} onClick={() => openBox(true)}>
        <Layers size={14} /> これまでの提案（{snapshot.ideaBox.length}件）
      </button>
    </div>
  );
}

const INTENT: Record<string, string> = { question: '質問', instruction: '修正依頼', reject: '見送り', positive: '賛成', hesitation: '迷い' };

function Log({ snapshot }: { snapshot: SessionSnapshot }) {
  const log = useDisplay((s) => s.chatLog);
  const formality = useFormality();
  if (log.length === 0) {
    return (
      <p className={styles.muted} style={{ padding: 16 }}>
        <ClipboardList size={14} /> 発言はまだありません
      </p>
    );
  }
  return (
    <ol className={styles.log}>
      {[...log].reverse().map((m) => {
        const judge = judgeById(snapshot, m.judgeId);
        const target = m.targetInstanceId ? proposalLabel(snapshot, m.targetInstanceId, formality) : null;
        return (
          <li key={m.id}>
            <div>
              <b>{judge?.name ?? judge?.label ?? '参加者'}</b>
              {target && <span>→ {target}</span>}
              {INTENT[m.intent] && <em>{INTENT[m.intent]}</em>}
              <time>{new Date(m.at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</time>
            </div>
            <p>{m.text}</p>
          </li>
        );
      })}
    </ol>
  );
}
