import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, Check, ChevronRight, Compass, Heart, Lightbulb, Loader2, MessageSquare, Pause, Play, Shuffle, Users, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { PitchRole, SessionSnapshot } from '@idea-audition/protocol';
import { useDisplay } from '../../store/display-store.ts';
import { useSession } from '../../store/session-store.ts';
import { EMPTY, currentRevision, finalistTarget, useMe } from '../../shared/selectors.ts';
import { setHoverFocus } from '../focus.ts';
import { DiscussionPanel } from './DiscussionPanel.tsx';
import { People } from './People.tsx';
import { PhaseDots } from './PhaseDots.tsx';
import { QA } from './QA.tsx';
import styles from './Official.module.css';

/**
 * オフィシャル会議モードの予選（提案の審議）。キャラ・舞台・効果音は出さない。
 * 左：参加者（顔と、賛成した人の印）。中：いまの提案と「賛成／見送り／質問・議論」。右：議論の要約（論点・合意・採用済み）。
 * 中身は予選と同じ：全員が賛成（＝ブザー）したら採用（＝合格）、見送ると次の提案（＝交代）
 */
export function OfficialPrelim() {
  const snapshot = useSession((s) => s.snapshot)!;
  const current = snapshot.lowerSlots[0] ?? null;
  const pressed = (current && snapshot.buzzer?.instanceId === current ? snapshot.buzzer.judgeIds : null) ?? (EMPTY as readonly string[]);
  return (
    <div className={styles.room}>
      <People approved={pressed} />
      <section className={styles.stageCard} aria-label="提案の審議">
        <div className={styles.cardTop}>
          <PhaseDots phase={0} />
          <span className={styles.agendaInline}>
            議題 <b>{snapshot.theme}</b>
          </span>
          {current && <Timer snapshot={snapshot} instanceId={current} />}
          {current && <HoldButton snapshot={snapshot} instanceId={current} />}
        </div>
        <AnimatePresence mode="wait" initial={false}>
          {current ? (
            <motion.div key={current} className={styles.proposalWrap} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
              <Proposal snapshot={snapshot} instanceId={current} />
              <Decision snapshot={snapshot} instanceId={current} approved={pressed} />
              <QA snapshot={snapshot} instanceId={current} />
            </motion.div>
          ) : (
            <motion.div key="prep" className={styles.preparing} initial={{ opacity: 0 }} animate={{ opacity: 1 }} role="status">
              <Loader2 size={18} className={styles.spin} />
              次の提案を準備しています
            </motion.div>
          )}
        </AnimatePresence>
        <ShortlistBar snapshot={snapshot} />
      </section>
      <DiscussionPanel />
    </div>
  );
}

const ROLE_ICON: Record<PitchRole, typeof Lightbulb> = { fit: Heart, bridge: Users, explore: Compass, wildcard: Shuffle };

/** いまの提案。左に絵（企画の向き）、右に AI 提案・企画名・説明・要点3つ。本文に乗せると確認中（交代のカウントが止まる） */
function Proposal({ snapshot, instanceId }: { snapshot: SessionSnapshot; instanceId: string }) {
  const revision = currentRevision(snapshot, instanceId);
  const character = snapshot.characters[instanceId];
  if (!revision || !character) return null;
  const pitch = snapshot.ideas[character.ideaId]?.pitch;
  const Icon = pitch ? ROLE_ICON[pitch.role] : Lightbulb;
  return (
    <article className={styles.proposal} data-noimage onPointerEnter={() => setHoverFocus(instanceId)} onPointerLeave={() => setHoverFocus(null)}>
      <div className={styles.proposalBody}>
        <div className={styles.badges}>
          <span className={styles.aiBadge}>
            <Icon size={13} /> AI 提案
          </span>
          {pitch?.reason && <span className={styles.tag}>{pitch.reason}</span>}
        </div>
        <h1 className={styles.proposalTitle}>{revision.title}</h1>
        <p className={styles.docSummary}>{revision.summary}</p>
        {revision.outline && (
          <ul className={styles.points}>
            <li>
              <Users size={18} />
              <span>
                <small>対象</small>
                {revision.outline.who}
              </span>
            </li>
            <li>
              <AlertCircle size={18} />
              <span>
                <small>課題</small>
                {revision.outline.pain}
              </span>
            </li>
            <li>
              <Lightbulb size={18} />
              <span>
                <small>解決策</small>
                {revision.outline.how}
              </span>
            </li>
          </ul>
        )}
      </div>
    </article>
  );
}

/** 賛成（＝ブザー）・見送り・質問・議論（詳細を開く）。賛成の人数も出す */
function Decision({ snapshot, instanceId, approved }: { snapshot: SessionSnapshot; instanceId: string; approved: readonly string[] }) {
  const send = useSession((s) => s.send);
  const select = useDisplay((s) => s.select);
  const { judgeId, isSpectator } = useMe();
  const mine = !!judgeId && approved.includes(judgeId);
  const connected = snapshot.judges.filter((j) => j.connected).length;
  return (
    <div className={styles.decision}>
      {!isSpectator && (
        <>
          <button className={styles.agree} data-on={mine || undefined} aria-pressed={mine} onClick={() => void send('PRESS_BUZZER', { instanceId, on: !mine })}>
            <Check size={20} /> {mine ? '賛成済み' : '賛成'}
          </button>
          <button className={styles.pass} onClick={() => void send('REJECT_CANDIDATE', { instanceId })}>
            <X size={20} /> 見送り
          </button>
        </>
      )}
      <button className={styles.discuss} onClick={() => select(instanceId)}>
        <MessageSquare size={19} /> 質問・議論
      </button>
      <span className={styles.agreeCount} aria-label={`賛成 ${approved.length} / ${connected}`}>
        賛成 <b>{approved.length}</b> / {connected}
      </span>
    </div>
  );
}

/** 採用済み（＝合格）の数。そろったら最終審議へ。ホストは途中でも進められる */
function ShortlistBar({ snapshot }: { snapshot: SessionSnapshot }) {
  const send = useSession((s) => s.send);
  const { isHost } = useMe();
  const target = finalistTarget(snapshot);
  const n = snapshot.upper.length;
  if (!isHost || n === 0 || n >= target) return null;
  return (
    <div className={styles.shortlistBar}>
      <span>
        採用済み <b>{n}</b> / {target}
      </span>
      <button
        className={styles.secondary}
        onClick={() => {
          if (window.confirm(`いまの${n}件で比較・検討に進みますか？`)) void send('END_PRELIMINARY', {});
        }}
      >
        比較・検討へ進む <ChevronRight size={15} />
      </button>
    </div>
  );
}

function HoldButton({ snapshot, instanceId }: { snapshot: SessionSnapshot; instanceId: string }) {
  const send = useSession((s) => s.send);
  const { isSpectator } = useMe();
  const held = snapshot.characters[instanceId]?.holdBy != null;
  if (isSpectator) return null;
  return (
    <button
      className={styles.iconButton}
      data-on={held || undefined}
      aria-pressed={held}
      aria-label={held ? '再開する' : '一時停止する'}
      title={held ? '再開' : '一時停止'}
      onClick={() => void send('HOLD_CHALLENGE', { instanceId, on: !held })}
    >
      {held ? <Play size={16} /> : <Pause size={16} />}
    </button>
  );
}

/** 残り時間。確認中（本文に乗せている・詳細を開いている）や一時停止中は止まる */
function Timer({ snapshot, instanceId }: { snapshot: SessionSnapshot; instanceId: string }) {
  const c = snapshot.characters[instanceId];
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 250);
    return () => clearInterval(t);
  }, []);
  if (!c) return null;
  if (c.holdBy != null) return <span className={styles.timerPill} data-state="held">一時停止中</span>;
  const leftMs = c.pausedLeftMs ?? (c.leavingAt ? Date.parse(c.leavingAt) - Date.now() : null);
  if (leftMs == null) return null;
  const sec = Math.max(0, Math.ceil(leftMs / 1000));
  const text = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  return (
    <span className={styles.timerPill} data-state={c.pausedLeftMs != null ? 'paused' : sec <= 5 ? 'low' : undefined} role="timer" aria-label={`残り${sec}秒`}>
      {c.pausedLeftMs != null ? '確認中' : 'あと'} <b>{text}</b>
    </span>
  );
}
