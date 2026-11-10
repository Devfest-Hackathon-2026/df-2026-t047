import { AnimatePresence, motion } from 'motion/react';
import { RotateCcw, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useDisplay } from '../store/display-store.ts';
import { useSession } from '../store/session-store.ts';
import { Mascot } from '../shared/Mascot.tsx';
import { EMPTY, currentRevision, judgeById, useMe } from '../shared/selectors.ts';
import { startCharacterPointer } from './drag.ts';
import { setHoverFocus } from './focus.ts';
import { InspiredBy } from '../features/consensus/ConsensusMemo.tsx';
import { PITCH_ROLE_ICON, type PitchView } from '@idea-audition/protocol';
import { useEffect, useState } from 'react';
import styles from './Stage.module.css';

export function LowerStage() {
  const slots = useSession((s) => s.snapshot?.lowerSlots ?? EMPTY);
  const status = useSession((s) => s.snapshot?.status);
  const send = useSession((s) => s.send);
  const { isSpectator } = useMe();

  return (
    <section
      className={styles.ideaStage}
      data-paused={status === 'champion_selection' || undefined}
      aria-label="新規アイデア発表ステージ"
    >
      <div className={styles.heading}>
        <div>
          <span className={styles.purpleDot} />
          <h2>
            新規アイデア発表ステージ <span>IDEA STAGE</span>
          </h2>
          <span className={styles.count}>5 AI</span>
        </div>
        <button
          className={styles.quietButton}
          disabled={isSpectator || status !== 'audition_active'}
          onClick={() => send('NEXT_IDEA', {})}
        >
          <RotateCcw size={13} /> 次のアイデア
        </button>
      </div>
      <div className={styles.lineup}>
        {slots.map((id, slot) => (
          <div className={styles.lowerSlot} key={slot}>
            <AnimatePresence mode="popLayout">
              {id ? <LowerPerformer key={id} instanceId={id} /> : <PreparingSlot key={`prep-${slot}`} />}
            </AnimatePresence>
          </div>
        ))}
      </div>
      <div className={`${styles.ring} ${styles.lowerRing}`} />
      <div className={styles.wordmark}>IDEA AUDITION</div>
    </section>
  );
}

function PreparingSlot() {
  return (
    <motion.div
      className={styles.preparing}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      aria-label="AIが次のアイデアを準備中"
    >
      <span className={styles.spinner} />
      <p>AIが準備中…</p>
    </motion.div>
  );
}

function LowerPerformer({ instanceId }: { instanceId: string }) {
  const snapshot = useSession((s) => s.snapshot)!;
  const character = snapshot.characters[instanceId];
  const revision = currentRevision(snapshot, instanceId);
  const isDragging = useDisplay((s) => s.drag?.instanceId === instanceId || s.departing.has(instanceId));
  const holderId = useDisplay((s) => Object.keys(s.heldBy).find((j) => s.heldBy[j] === instanceId) ?? null);
  const select = useDisplay((s) => s.select);
  const bubble = useDisplay((s) => s.bubbles[instanceId]);
  const send = useSession((s) => s.send);
  const { isSpectator } = useMe();
  const leavingIn = useCountdown(character?.leavingAt ?? null);
  if (!character || !revision) return null;
  const idea = snapshot.ideas[character.ideaId];
  const thinking = bubble?.critiqueId.startsWith('react:');
  const revisedForHesitation = revision.reason?.startsWith('迷いを受けて');
  const holder = holderId ? judgeById(snapshot, holderId) : null;
  // 投票中は入れ替えが止まっているので、交代の表示も出さない
  const leaving = character.leavingAt !== null && snapshot.status === 'audition_active';

  return (
    <motion.article
      className={styles.performer}
      data-dragging={isDragging || undefined}
      data-held={holder ? true : undefined}
      data-leaving={leaving || undefined}
      data-thinking={thinking || undefined}
      onPointerEnter={() => setHoverFocus(instanceId)}
      onPointerLeave={() => setHoverFocus(null)}
      style={{ '--accent': character.accent, '--holder': holder?.color } as CSSProperties}
      initial={{ opacity: 0, y: 26, scale: 0.86 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 18, scale: 0.9, transition: { duration: 0.25 } }}
      transition={{ delay: 0.35, type: 'spring', stiffness: 260, damping: 20 }}
    >
      <div className={styles.spotlight} aria-hidden />
      {bubble && <div className={styles.speech}>{bubble.text}</div>}
      <button
        className={styles.character}
        data-anchor={`lower:${instanceId}`}
        aria-label={`${character.name}：クリックで詳細、ドラッグで最終オーディションへ`}
        disabled={isSpectator}
        onPointerDown={(e) => startCharacterPointer(e, instanceId, character.designId)}
        onClick={(e) => {
          // キーボード操作（Enter / Space）のときだけ詳細を開く。マウスは pointerup で処理する
          if (e.detail === 0) select(instanceId);
        }}
      >
        <Mascot designId={character.designId} className={styles.mascot} />
      </button>
      {!isSpectator && (
        <button
          className={styles.rejectButton}
          title="この案は見送る（次の人と交代）"
          aria-label={`${character.name}の案を見送って、次の人と交代する`}
          onClick={() => void send('REJECT_CANDIDATE', { instanceId })}
        >
          <X size={13} />
        </button>
      )}
      {idea?.pitch && !holder && <PitchTag pitch={idea.pitch} />}
      <button className={styles.flip} data-revised={revisedForHesitation || undefined} onClick={() => select(instanceId)}>
        {revisedForHesitation && <span className={styles.revisedChip}>別案 v{revision.version}</span>}
        <div className={styles.flipTitle}>{revision.title}</div>
        <div className={styles.flipIcon}>{revision.icon}</div>
        <p>{revision.summary}</p>
        {revision.inspiredBy && <InspiredBy note={revision.inspiredBy.note} labels={revision.inspiredBy.claimLabels} />}
      </button>
      <div className={styles.podium} />
      <div className={styles.name}>
        <span /> {character.name}
        <MentionBadge count={character.mentions} />
      </div>
      {holder && <span className={styles.heldTag}>{holder.label} がつかみ中</span>}
      {leaving && !holder && (
        <div
          className={styles.leavingTag}
          role="status"
          title="カーソルを乗せる・クリックするなど、触れると残ります"
          aria-label={`あと${leavingIn}秒で交代。触れると残ります`}
        >
          ⏳ {leavingIn > 0 ? <>あと<b>{leavingIn}</b>秒で交代</> : '交代します'}
          <i
            key={character.leavingAt}
            style={{ animationDuration: `${Math.max(0, Date.parse(character.leavingAt!) - Date.now())}ms` }}
          />
        </div>
      )}
    </motion.article>
  );
}


/** なぜこの案が出てきたか（ADR-0009）：💡 好み / 🤝 両立 / 🧭 探索 / 🎲 ワイルド */
function PitchTag({ pitch }: { pitch: PitchView }) {
  return (
    <div className={styles.pitchTag} data-role={pitch.role} title={pitch.reason}>
      <span aria-hidden>{PITCH_ROLE_ICON[pitch.role]}</span> {pitch.reason}
    </div>
  );
}

/** 会話で取り上げられた回数 */
export function MentionBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className={styles.mentions} title={`会話で${count}回取り上げられました`}>
      💬{count}
    </span>
  );
}

/** 退場までの残り秒数（予告中のみ） */
function useCountdown(leavingAt: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!leavingAt) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [leavingAt]);
  return leavingAt ? Math.max(0, Math.ceil((Date.parse(leavingAt) - now) / 1000)) : 0;
}
