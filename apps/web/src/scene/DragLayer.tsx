import { motion } from 'motion/react';
import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDisplay, type Flight, type Point } from '../store/display-store.ts';
import { Mascot } from '../shared/Mascot.tsx';
import { anchorCenter } from '../shared/anchors.ts';
import styles from './DragLayer.module.css';

/**
 * つかんでいるキャラ（ゴースト）と、上段への移動・元の位置への戻りを描く層。
 * 1体のキャラは常にどこか1か所にだけ表示する（AC-05）。
 */
export function DragLayer() {
  const drag = useDisplay((s) => s.drag);
  const flights = useDisplay((s) => s.flights);
  return createPortal(
    <div className={styles.layer} aria-hidden>
      {drag && (
        <div
          className={styles.ghost}
          data-phase={drag.phase}
          style={{ transform: `translate(${drag.pointer.x}px, ${drag.pointer.y}px)` }}
        >
          <Mascot designId={drag.designId} className={styles.ghostMascot} />
        </div>
      )}
      {flights.map((f) => (
        <FlightSprite key={f.flightId} flight={f} />
      ))}
    </div>,
    document.body,
  );
}

function FlightSprite({ flight }: { flight: Flight }) {
  const finish = useDisplay((s) => s.finishFlight);
  const [to, setTo] = useState<Point | null>(null);

  // 画面が裏に回るとアニメーションが止まり、終わりの合図が来ないことがある。少し待っても終わらなければ片付ける
  useLayoutEffect(() => {
    const t = setTimeout(() => finish(flight.flightId), 2000);
    return () => clearTimeout(t);
  }, [flight.flightId, finish]);

  useLayoutEffect(() => {
    const anchor =
      flight.kind === 'upper' ? `upper:${flight.instanceId}` : flight.kind === 'box' ? 'ideabox' : `lower:${flight.instanceId}`;
    const target = anchorCenter(anchor);
    if (!target) {
      finish(flight.flightId);
      return;
    }
    setTo(target);
  }, [flight, finish]);

  if (!to) return null;
  const from = flight.from;
  const lift = flight.kind === 'upper' ? Math.min(140, Math.abs(from.y - to.y) * 0.5 + 40) : flight.kind === 'box' ? 60 : 30;
  const mid = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - lift };
  const scale =
    flight.kind === 'upper' ? [1.05, 1.15, 0.85] : flight.kind === 'box' ? [1, 0.7, 0.18] : [1.05, 1, 1];

  return (
    <motion.div
      className={styles.flight}
      data-kind={flight.kind}
      initial={{ x: from.x, y: from.y, scale: 1.05 }}
      animate={{
        x: [from.x, mid.x, to.x],
        y: [from.y, mid.y, to.y],
        scale,
        opacity: flight.kind === 'box' ? [1, 0.9, 0.2] : 1,
      }}
      transition={{ duration: flight.kind === 'return' ? 0.4 : 0.75, ease: 'easeInOut' }}
      onAnimationComplete={() => finish(flight.flightId)}
    >
      <Mascot designId={flight.designId} className={styles.flightMascot} />
      {flight.kind === 'upper' && <span className={styles.trail} />}
    </motion.div>
  );
}
