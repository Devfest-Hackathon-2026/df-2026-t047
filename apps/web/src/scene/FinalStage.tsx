import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, Check, Crown, Plus, Trophy } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { SessionSnapshot } from '@idea-audition/protocol';
import { useDisplay } from '../store/display-store.ts';
import { useSession } from '../store/session-store.ts';
import { Mascot } from '../shared/Mascot.tsx';
import { EMPTY, currentRevision, finalistTarget, originalRevision, useMe } from '../shared/selectors.ts';
import { onDropHover, registerDropZone } from './drag.ts';
import { MentionBadge } from './LowerStage.tsx';
import styles from './Stage.module.css';
import { IdeaImage } from '../shared/IdeaImage.tsx';

export function FinalStage() {
  const ref = useRef<HTMLElement>(null);
  const upper = useSession((s) => s.snapshot?.upper ?? EMPTY);
  const isDragging = useDisplay((s) => s.drag?.phase === 'dragging');
  const [hover, setHover] = useState(false);

  useEffect(() => {
    registerDropZone(ref.current);
    const off = onDropHover(setHover);
    return () => {
      registerDropZone(null);
      off();
    };
  }, []);

  const target = useSession((s) => finalistTarget(s.snapshot));
  const full = upper.length >= target;
  const spotlight = useSession((s) => s.snapshot?.spotlight ?? null);
  const characters = useSession((s) => s.snapshot?.characters);
  const send = useSession((s) => s.send);
  const spotName = spotlight ? characters?.[spotlight.instanceId]?.name : null;

  return (
    <section
      ref={ref}
      className={styles.finalStage}
      data-drop={isDragging ? (full ? 'full' : 'active') : undefined}
      data-hover={hover || undefined}
      data-spotlight={spotlight ? true : undefined}
      aria-label="最終オーディション"
      onClick={(e) => {
        // 注目中に、キャラやボタン以外の場所を押したら注目をやめる
        if (!spotlight || (e.target as HTMLElement).closest('button, a, input, textarea, select')) return;
        void send('SET_SPOTLIGHT', { instanceId: null });
      }}
    >
      <div className={`${styles.floorGrid}`} aria-hidden />
      <img className={styles.backdrop} src="/brand/logo-neon.webp" alt="" aria-hidden />
      <div className={styles.heading}>
        <div>
          <Crown />
          <h2>
            最終オーディション <span>FINAL STAGE</span>
          </h2>
          <span className={`${styles.count} ${styles.gold}`}>
            {upper.length} / {target}
          </span>
        </div>
        <ChampionControls />
      </div>
      <AnimatePresence>
        {spotName && (
          <motion.div
            className={styles.spotBanner}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            role="status"
          >
            🔦 <b>{spotName}</b> に注目中
            <button onClick={() => void send('SET_SPOTLIGHT', { instanceId: null })} aria-label="注目をやめる">
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <div className={styles.finalLineup} data-count={target}>
        {Array.from({ length: target }, (_, i) => {
          const f = upper[i];
          return f ? (
            <FinalistCard
              key={f.instanceId}
              instanceId={f.instanceId}
              spotlight={spotlight ? (spotlight.instanceId === f.instanceId ? 'on' : 'off') : null}
            />
          ) : (
            <EmptySlot key={`empty-${i}`} index={i} dragging={isDragging} full={full} />
          );
        })}
      </div>
      {isDragging && full && <div className={styles.fullNotice}>満席です。いまは昇格できません</div>}
      <div className={`${styles.ring} ${styles.upperRing}`} />
      <div className={styles.upperDrum} aria-hidden />
    </section>
  );
}

function EmptySlot({ index, dragging, full }: { index: number; dragging: boolean; full: boolean }) {
  return (
    <div className={styles.emptySlot} data-anchor={`upper-slot:${index}`}>
      <div className={styles.emptyOrbit}>
        <Crown />
        <Plus size={16} />
      </div>
      <p>{dragging && !full ? 'ここにドロップして昇格' : '気になるキャラをここへ'}</p>
      <span>{dragging && !full ? 'DROP TO PROMOTE' : 'キャラクターをドラッグして選抜'}</span>
    </div>
  );
}

const STATUS_LABEL = {
  refining: '◌ 分析・ブラッシュアップ中',
  critiquing: '◌ 相互批評中',
  ready: '',
} as const;

function FinalistCard({ instanceId, spotlight }: { instanceId: string; spotlight: 'on' | 'off' | null }) {
  const snapshot = useSession((s) => s.snapshot)!;
  const send = useSession((s) => s.send);
  const finalist = snapshot.upper.find((f) => f.instanceId === instanceId)!;
  const character = snapshot.characters[instanceId];
  const revision = currentRevision(snapshot, instanceId);
  const original = originalRevision(snapshot, instanceId);
  const arriving = useDisplay((s) => s.arriving.has(instanceId));
  const bubble = useDisplay((s) => s.bubbles[instanceId]);
  const select = useDisplay((s) => s.select);
  const { isHost, isSpectator } = useMe();
  const myVote = useDisplay((s) => s.myVote);
  const setMyVote = useDisplay((s) => s.setMyVote);
  if (!character || !revision || !original) return null;

  const vote = snapshot.vote;
  const evolved = revision.version > 1;
  const thinking = thinkingLabel(snapshot, instanceId, finalist.status);
  const bubbleTarget = bubble ? snapshot.characters[bubble.toInstanceId]?.name : null;
  const isTieCandidate = vote?.status === 'tie' && vote.tieInstanceIds.includes(instanceId);
  // 「C1 を反映」ではなく、反映したみんなの意見そのものを出す
  const reflected = (revision.inspiredBy?.claimLabels ?? [])
    .map((label) => snapshot.consensus.claims.find((c) => c.label === label)?.text)
    .filter((t): t is string => !!t);

  return (
    <article
      className={`${styles.performer} ${styles.finalPerformer}`}
      data-status={finalist.status}
      data-busy={thinking ? true : undefined}
      data-arriving={arriving || undefined}
      data-spot={spotlight ?? undefined}
      style={{ '--accent': character.accent } as CSSProperties}
    >
      {spotlight === 'on' && <div className={styles.spotBeam} aria-hidden />}
      <AnimatePresence>
        {bubble && (
          <motion.div
            key={bubble.critiqueId}
            className={`${styles.speech} ${styles.critique}`}
            initial={{ opacity: 0, y: 6, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
          >
            {bubbleTarget && <b>→ {bubbleTarget}</b>}
            {bubble.text}
          </motion.div>
        )}
      </AnimatePresence>
      <button
        className={styles.character}
        data-anchor={`upper:${instanceId}`}
        aria-label={spotlight === 'on' ? `${character.name}への注目をやめる` : `${character.name}にスポットライトを当てる（みんなで注目して質問できる）`}
        disabled={isSpectator}
        onClick={() => void send('SET_SPOTLIGHT', { instanceId: spotlight === 'on' ? null : instanceId })}
      >
        <Mascot designId={character.designId} className={styles.mascot} />
        <AnimatePresence>
          {thinking && (
            <motion.span
              className={styles.thought}
              // ボタンの中なので読み上げは期待できない。札の「分析中」の表示が同じ状態を文字で伝える
              aria-hidden
              initial={{ opacity: 0, scale: 0.6, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.6 }}
            >
              <span className={styles.thoughtDots} aria-hidden>
                <i />
                <i />
                <i />
              </span>
              <small>{thinking}</small>
            </motion.span>
          )}
        </AnimatePresence>
      </button>
      <button className={`${styles.flip} ${styles.finalFlip}`} onClick={() => select(instanceId)}>
        {/* 案のイメージ画像（できたら出す。改良で版が変わっても同じ絵のまま） */}
        <IdeaImage ideaId={character.ideaId} className={styles.flipImage} />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={revision.revisionId}
            initial={{ rotateX: -80, opacity: 0 }}
            animate={{ rotateX: 0, opacity: 1 }}
            exit={{ rotateX: 80, opacity: 0 }}
            transition={{ duration: 0.45 }}
            className={styles.flipBody}
          >
            {/* 優先順位：企画名 → 説明 → 誰の・困りごと・どう解く → この版で変えたこと → 反映した意見 */}
            <div className={styles.flipTitle}>{revision.title}</div>
            <p>{revision.summary}</p>
            {revision.outline && (
              <dl className={styles.outline}>
                <dt>誰の</dt>
                <dd>{revision.outline.who}</dd>
                <dt>困りごと</dt>
                <dd>{revision.outline.pain}</dd>
                <dt>どう解く</dt>
                <dd>{revision.outline.how}</dd>
              </dl>
            )}
            {evolved && revision.improvementPoints.length > 0 && (
              <ul className={styles.points}>
                {revision.improvementPoints.slice(0, 3).map((t) => (
                  <li key={`i${t}`}>
                    <Check size={10} /> {t}
                  </li>
                ))}
              </ul>
            )}
            {reflected.length > 0 && (
              <div className={styles.reflected}>
                {reflected.map((t) => (
                  <span key={t}>💬 {t}</span>
                ))}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
        <div className={styles.improvement}>
          {finalist.status !== 'ready' ? (
            <BusyLabel label={STATUS_LABEL[finalist.status]} status={finalist.status} />
          ) : (
            <>Ver.{revision.version}{evolved && <span className={styles.originNote}>元：{original.title}</span>}</>
          )}
        </div>
      </button>
      <div className={styles.podium} />
      <div className={styles.name}>
        <span /> {character.name} <small>FINALIST</small>
        <MentionBadge count={character.mentions} />
      </div>

      {vote?.status === 'open' && !isSpectator && (
        <button
          className={styles.voteButton}
          data-chosen={myVote === instanceId || undefined}
          data-other={(myVote && myVote !== instanceId) || undefined}
          aria-pressed={myVote === instanceId}
          onClick={async () => {
            if (myVote === instanceId) return;
            const r = await send('CAST_VOTE', { instanceId });
            if (r.ok) setMyVote(instanceId);
          }}
        >
          {myVote === instanceId ? (
            <>
              <Check size={15} /> あなたの1票
            </>
          ) : myVote ? (
            'こちらに変える'
          ) : (
            <>
              <Crown size={15} /> この案に投票
            </>
          )}
        </button>
      )}
      {isTieCandidate &&
        (isHost ? (
          <button className={styles.voteButton} onClick={() => send('RESOLVE_TIE', { instanceId })}>
            この案に決定
          </button>
        ) : (
          <span className={styles.tieNote}>同票：ホストが決定中</span>
        ))}
    </article>
  );
}

/**
 * キャラが何を考えているか（C2）。改良中・批評中・質問への答えを待っているあいだは、
 * キャラの頭の横に「…」の吹き出しを出し、首をかしげさせる。考えていなければ null。
 */
function thinkingLabel(snapshot: SessionSnapshot, instanceId: string, status: 'refining' | 'critiquing' | 'ready') {
  if (status === 'refining') return '改良を考え中';
  if (status === 'critiquing') return '批評を考え中';
  if (snapshot.answers.some((a) => a.instanceId === instanceId && a.answer === null)) return '答えを考え中';
  return null;
}

/** 改良・批評の途中を、経過秒数と動くバーで見せる（何もしていないように見えないように） */
function BusyLabel({ label, status }: { label: string; status: string }) {
  const [since] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const sec = Math.floor((now - since) / 1000);
  return (
    <span className={styles.busy} key={status}>
      {label}
      {sec >= 2 && <small> {sec}秒</small>}
      <span className={styles.busyBar} />
    </span>
  );
}

function ChampionControls() {
  const snapshot = useSession((s) => s.snapshot)!;
  const send = useSession((s) => s.send);
  const select = useDisplay((s) => s.select);
  const toast = useDisplay((s) => s.toast);
  const { isHost, isSpectator } = useMe();
  const vote = snapshot.vote;
  const upper = snapshot.upper;
  const connected = snapshot.judges.filter((j) => j.connected).length;

  if (vote?.status === 'open') {
    // だれに入れたかは締め切るまで伏せ、「だれが投票済みか」だけを出す
    const judges = snapshot.judges.filter((j) => j.connected);
    const done = judges.filter((j) => vote.votedJudgeIds.includes(j.judgeId)).length;
    return (
      <div className={styles.ballot} role="status" aria-label={`投票 ${done} / ${judges.length}`}>
        <span className={styles.ballotTitle}>
          <Trophy size={14} /> 最終投票
        </span>
        <div className={styles.voters}>
          {judges.map((j) => {
            const voted = vote.votedJudgeIds.includes(j.judgeId);
            return (
              <span key={j.judgeId} className={styles.voter} data-voted={voted || undefined} style={{ '--judge': j.color } as CSSProperties} title={voted ? '投票済み' : 'まだ'}>
                <i>{voted ? <Check size={10} /> : null}</i>
                {j.name ?? j.label}
              </span>
            );
          })}
        </div>
        <span className={styles.ballotCount}>
          <b>{done}</b> / {judges.length}
          <span className={styles.ballotBar} aria-hidden>
            <i style={{ width: `${(done / Math.max(1, judges.length)) * 100}%` }} />
          </span>
        </span>
        {isHost && done < judges.length && (
          <button className={styles.finalButton} onClick={() => send('CLOSE_VOTE', {})}>
            ここで締め切る
          </button>
        )}
      </div>
    );
  }
  if (vote?.status === 'tie') return <div className={styles.voteStatus}>同票：ホストが選びます</div>;

  return (
    <button
      className={styles.finalButton}
      disabled={upper.length === 0 || isSpectator || snapshot.status !== 'audition_active'}
      onClick={() => {
        if (snapshot.mode === 'solo') {
          select(upper[0]!.instanceId);
          toast('優勝にしたい案を開いて「この案を優勝に」を押してください', 'gold');
          return;
        }
        if (!isHost) {
          toast('優勝の決定はホストが始めます', 'warn');
          return;
        }
        if (upper.length === 1) {
          select(upper[0]!.instanceId);
          return;
        }
        void send('START_CHAMPION_VOTE', {});
      }}
    >
      <Trophy size={14} /> 優勝を決める <ArrowUpRight size={14} />
    </button>
  );
}
