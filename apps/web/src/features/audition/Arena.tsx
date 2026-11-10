import { MousePointer2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useDisplay } from '../../store/display-store.ts';
import { useSession } from '../../store/session-store.ts';
import { FinalStage } from '../../scene/FinalStage.tsx';
import { PASS_CEREMONY_MS, PreliminaryStage } from '../../scene/PreliminaryStage.tsx';
import { finalistTarget } from '../../shared/selectors.ts';
import { EMPTY, useMe } from '../../shared/selectors.ts';
import { ChatPanel } from '../chat/Chat.tsx';
import { OfficialPrelim } from '../../scene/official/OfficialPrelim.tsx';
import { OfficialFinal } from '../../scene/official/OfficialFinal.tsx';
import styles from './Arena.module.css';

const CURSOR_SEND_INTERVAL_MS = 66; // 約15Hz（仮説値。実測で調整する、ADR-0004）

export function Arena() {
  const ref = useRef<HTMLDivElement>(null);
  const theme = useSession((s) => s.snapshot?.theme);
  const client = useSession((s) => s.client);
  // 予選（1人ずつ）：合格者が3人そろうまで。そろったら最終オーディションに切り替わる（#5）
  const upperLen = useSession((s) => s.snapshot?.upper.length ?? 0);
  const target = useSession((s) => finalistTarget(s.snapshot));
  const active = useSession((s) => s.snapshot?.status === 'audition_active');
  // 3人目の合格の演出を見せてから最終オーディションに切り替える。
  // 3人目がそろった描画の時点で決めないと、予選の画面が一度消えて演出が出ない
  const fullAt = useRef<number | null>(null);
  const prevLen = useRef(upperLen);
  if (upperLen >= target && prevLen.current < target && upperLen > prevLen.current) fullAt.current = Date.now();
  prevLen.current = upperLen;
  const [, rerender] = useState(0);
  useEffect(() => {
    if (fullAt.current === null) return;
    const t = setTimeout(() => rerender((x) => x + 1), PASS_CEREMONY_MS + 100);
    return () => clearTimeout(t);
  }, [upperLen]);
  const holdPrelim = fullAt.current !== null && Date.now() - fullAt.current < PASS_CEREMONY_MS + 100;
  const prelim = active && (upperLen < target || holdPrelim);
  const official = useDisplay((s) => s.formality) === 1;
  // 予選は審査員の台に顔を出すので、フッターのワイプを隠す（Footer が読む）
  useEffect(() => {
    useDisplay.setState({ prelimStage: prelim });
    return () => useDisplay.setState({ prelimStage: false });
  }, [prelim]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !client) return;
    let last = 0;
    let wasInside = false;
    const onMove = (e: PointerEvent) => {
      const now = performance.now();
      if (now - last < CURSOR_SEND_INTERVAL_MS) return;
      last = now;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      const inside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
      if (inside) client.sendEphemeral('CURSOR_MOVED', { x, y });
      else if (wasInside) client.sendEphemeral('CURSOR_MOVED', null);
      wasInside = inside;
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [client]);

  return (
    <>
      {/* 予選はステージの囲いの中にテーマを出す。オフィシャル会議モードは会議の画面の上の帯に議題を出す */}
      {!prelim && !official && (
        <div className={styles.themeBar}>
          <span className={styles.live}>● LIVE</span>
          <span className={styles.themeLabel}>本日のテーマ</span>
          <strong>{theme}</strong>
        </div>
      )}
      <div className={styles.arena} ref={ref}>
        {official ? prelim ? <OfficialPrelim /> : <OfficialFinal /> : prelim ? <PreliminaryStage /> : <FinalStage />}
        <JudgeCursors />
        {/* ヘッダーとフッターの間（この領域）に収まるように、ここに置く */}
        <ChatPanel />
      </div>
    </>
  );
}

function JudgeCursors() {
  const cursors = useDisplay((s) => s.cursors);
  const judges = useSession((s) => s.snapshot?.judges ?? EMPTY);
  const { judgeId } = useMe();
  return (
    <>
      {Object.entries(cursors).map(([id, c]) => {
        if (id === judgeId) return null;
        const j = judges.find((x) => x.judgeId === id);
        if (!j || !j.connected) return null;
        return (
          <div
            key={id}
            className={styles.cursor}
            style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, ['--cursor' as string]: j.color }}
            aria-hidden
          >
            <MousePointer2 fill={j.color} />
            <span>{j.label}</span>
          </div>
        );
      })}
    </>
  );
}
