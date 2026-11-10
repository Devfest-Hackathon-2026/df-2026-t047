import { ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { useEffect } from 'react';
import type { ClaimView, SessionSnapshot } from '@idea-audition/protocol';
import { useDisplay } from '../../store/display-store.ts';
import { useSession } from '../../store/session-store.ts';
import { judgeById, useMe } from '../../shared/selectors.ts';
import styles from './Consensus.module.css';

const time = (iso: string) => new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

/** 合意メモ：会話から生まれた論点と、誰がいつ賛成・反対したか（ADR-0007） */
export function ConsensusMemo() {
  const open = useDisplay((s) => s.consensusOpen);
  const setOpen = useDisplay((s) => s.setConsensusOpen);
  const snapshot = useSession((s) => s.snapshot);
  // Esc で閉じる
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);
  if (!open || !snapshot) return null;
  const claims = snapshot.consensus.claims;
  const groups: [string, ClaimView[]][] = [
    ['合意', claims.filter((c) => c.status === 'agreed')],
    ['提案中', claims.filter((c) => c.status === 'proposed')],
    ['却下・置き換え', claims.filter((c) => c.status === 'rejected' || c.status === 'superseded')],
  ];
  return (
    <section className={styles.panel} aria-label="合意メモ">
      <header>
        <strong>合意メモ</strong>
        <button aria-label="閉じる" onClick={() => setOpen(false)}>
          <X size={16} />
        </button>
      </header>
      {claims.length === 0 ? (
        <p className={styles.empty}>まだ論点はありません</p>
      ) : (
        <div className={styles.groups}>
          {groups.map(([title, items]) =>
            items.length === 0 ? null : (
              <div key={title}>
                <h3>{title}</h3>
                {items.map((c) => (
                  <ClaimRow key={c.label} claim={c} snapshot={snapshot} />
                ))}
              </div>
            ),
          )}
        </div>
      )}
    </section>
  );
}

function ClaimRow({ claim, snapshot }: { claim: ClaimView; snapshot: SessionSnapshot }) {
  const send = useSession((s) => s.send);
  const { isSpectator, judgeId: me } = useMe();
  const inactive = claim.status === 'superseded';
  const person = (judgeId: string | null) => {
    const j = judgeId ? judgeById(snapshot, judgeId) : null;
    return j ? { id: j.judgeId, name: j.name ?? j.label, color: j.color } : null;
  };
  const stances = Object.entries(claim.stances);
  const supporters = stances.filter(([, s]) => s === 'support').map(([id]) => person(id)).filter((p) => !!p);
  const opposers = stances.filter(([, s]) => s === 'oppose').map(([id]) => person(id)).filter((p) => !!p);
  const members = Math.max(1, snapshot.judges.filter((j) => j.connected).length);
  const creator = person(claim.createdBy);
  const replacement = claim.supersededBy ? snapshot.consensus.claims.find((c) => c.label === claim.supersededBy) : null;
  const myStance = me ? claim.stances[me] : undefined;
  const say = (stance: 'support' | 'oppose') =>
    void send('SUBMIT_UTTERANCE', {
      text: stance === 'support' ? `「${claim.text}」に賛成` : `「${claim.text}」には反対`,
      source: 'text',
      replyToClaim: claim.label,
    });
  return (
    <div className={styles.claim} data-status={claim.status}>
      <div className={styles.claimHead}>
        <p>{claim.text}</p>
      </div>
      {replacement && <p className={styles.replaced}>→ {replacement.text}</p>}
      <div className={styles.votes}>
        <div className={styles.meter} aria-hidden>
          <i style={{ width: `${Math.min(100, (supporters.length / members) * 100)}%` }} />
        </div>
        <span className={styles.count}>
          賛成 {supporters.length}/{members}
        </span>
      </div>
      {(supporters.length > 0 || opposers.length > 0) && (
        <div className={styles.people}>
          {supporters.map((p) => (
            <Person key={p.id} name={p.name} color={p.color} stance="support" />
          ))}
          {opposers.map((p) => (
            <Person key={p.id} name={p.name} color={p.color} stance="oppose" />
          ))}
        </div>
      )}
      <div className={styles.foot}>
        <small className={styles.meta}>
          {creator ? `${creator.name} · ` : ''}
          {time(claim.createdAt)}
        </small>
        {!isSpectator && !inactive && (
          <div className={styles.actions}>
            <button title="賛成" aria-pressed={myStance === 'support'} data-on={myStance === 'support' || undefined} onClick={() => say('support')}>
              <ThumbsUp size={14} />
            </button>
            <button title="反対" aria-pressed={myStance === 'oppose'} data-on={myStance === 'oppose' || undefined} onClick={() => say('oppose')}>
              <ThumbsDown size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Person({ name, color, stance }: { name: string; color: string; stance: 'support' | 'oppose' }) {
  return (
    <span className={styles.person} data-stance={stance} style={{ ['--judge' as string]: color }} title={stance === 'support' ? '賛成' : '反対'}>
      {stance === 'support' ? <ThumbsUp size={10} /> : <ThumbsDown size={10} />}
      {name}
    </span>
  );
}

/** フリップに「どの合意・論点を受けた案か」を出す */
export function InspiredBy({ note, labels }: { note: string; labels: string[] }) {
  return (
    <div className={styles.inspired} title={`${labels.join('・')} を受けた案`}>
      💡 {note}
    </div>
  );
}
