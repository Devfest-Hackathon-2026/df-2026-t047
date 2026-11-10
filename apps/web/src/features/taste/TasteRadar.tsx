import { X } from 'lucide-react';
import { TASTE_AXES, type SessionSnapshot } from '@idea-audition/protocol';
import { useDisplay } from '../../store/display-store.ts';
import { useSession } from '../../store/session-store.ts';
import { pick, useFormality } from '../../shared/formality.ts';
import { activeTasteJudges, isTasteRead, signalsUntilRead, tasteLeaning } from './taste-summary.ts';
import styles from './Taste.module.css';

const SIZE = 220;
const C = SIZE / 2;
const R = 78;
/** 小さい版の描く範囲：軸の名前（最大3文字・17px）が左右上下にはみ出す分を足す */
const COMPACT_VIEWBOX = '-50 -8 320 236';

/** 軸 i の値 v（-1〜+1）の座標。-1 が中心、+1 が外周 */
function point(i: number, v: number) {
  const angle = (Math.PI * 2 * i) / TASTE_AXES.length - Math.PI / 2;
  const r = R * ((v + 1) / 2);
  return [C + r * Math.cos(angle), C + r * Math.sin(angle)] as const;
}
const polygon = (vs: number[]) => vs.map((v, i) => point(i, v).join(',')).join(' ');

/**
 * 好みのレーダー（ADR-0009 ①）。審査員ごとの好みを色で重ね、いちばん割れている軸に印を付ける。
 * 「言ってないのに分かってくれた」を、目で見て確かめられるようにする。
 */
export function TastePanel() {
  const open = useDisplay((s) => s.tasteOpen);
  const setOpen = useDisplay((s) => s.setTasteOpen);
  const snapshot = useSession((s) => s.snapshot);
  const formality = useFormality();
  if (!open || !snapshot) return null;
  const title = pick(formality, 'みんなの好み', '評価の傾向');
  return (
    <section className={styles.panel} aria-label={title}>
      <header>
        <strong>{title}</strong>
        <small>反応から推定 · v{snapshot.taste.version}</small>
        <button aria-label="閉じる" onClick={() => setOpen(false)}>
          <X size={16} />
        </button>
      </header>
      <TasteRadar snapshot={snapshot} />
      <TasteNotes snapshot={snapshot} />
    </section>
  );
}

/**
 * compact：舞台の隅に常に出す小さい版。軸の名前を大きめにして、外に張り出す名前の分だけ描く範囲を広げる
 * （小さく縮めても名前が読めるように）
 */
export function TasteRadar({ snapshot, print = false, compact = false }: { snapshot: SessionSnapshot; print?: boolean; compact?: boolean }) {
  const { taste, judges } = snapshot;
  const div = taste.divergence;
  const active = new Set(activeTasteJudges(taste, judges).map((j) => j.judgeId));
  const viewBox = compact ? COMPACT_VIEWBOX : `0 0 ${SIZE} ${SIZE}`;
  const className = [styles.radar, print && styles.print, compact && styles.compact].filter(Boolean).join(' ');
  return (
    // 小さい版はボタンの中の飾り（中身は見出しと審査員名で読み上げる）。PDF 用（print）は大きさを直接書く（html2canvas で崩れないように）
    <svg
      className={className}
      width={print ? SIZE : undefined}
      height={print ? SIZE : undefined}
      viewBox={viewBox}
      {...(compact ? { 'aria-hidden': true } : { role: 'img', 'aria-label': '好みのレーダー' })}
    >
      {[-1, -0.5, 0, 0.5, 1].map((v) => (
        <polygon
          key={v}
          className={styles.grid}
          points={polygon(TASTE_AXES.map(() => v))}
          fill="none"
          stroke={print ? '#e2d9ec' : undefined}
        />
      ))}
      {TASTE_AXES.map((a, i) => {
        const [x, y] = point(i, 1);
        const [lx, ly] = point(i, 1.32);
        const isSplit = div?.axis === i;
        return (
          <g key={a.key}>
            <line className={styles.spoke} x1={C} y1={C} x2={x} y2={y} stroke={print ? '#ece5f3' : undefined} />
            <text
              className={styles.axisLabel}
              data-split={isSplit || undefined}
              x={lx}
              y={ly}
              fill={print ? (isSplit ? '#b07800' : '#4d3f5c') : undefined}
              fontSize={print ? 10 : undefined}
              fontWeight={print ? 600 : undefined}
              textAnchor={Math.abs(lx - C) < 6 ? 'middle' : lx > C ? 'start' : 'end'}
              dominantBaseline="middle"
            >
              {a.label}
            </text>
          </g>
        );
      })}
      {judges.map((j) => {
        const v = taste.judges[j.judgeId];
        if (!v || !active.has(j.judgeId)) return null;
        return (
          <polygon
            key={j.judgeId}
            className={styles.judgeShape}
            // 読み取り中（反応が少ない）の人は、薄い点線で描く
            data-reading={!isTasteRead(taste, j.judgeId) || undefined}
            points={polygon(v)}
            fill={j.color}
            fillOpacity={print ? 0.18 : 0.22}
            stroke={j.color}
            strokeWidth={1.6}
            style={{ ['--judge' as string]: j.color }}
          />
        );
      })}
      {div && (
        <circle
          className={styles.splitMark}
          cx={point(div.axis, 1)[0]}
          cy={point(div.axis, 1)[1]}
          r={5}
          fill="none"
          stroke={print ? '#d49a00' : undefined}
          strokeWidth={2}
        />
      )}
    </svg>
  );
}

function TasteNotes({ snapshot }: { snapshot: SessionSnapshot }) {
  const { taste, judges } = snapshot;
  const label = (id: string) => judges.find((j) => j.judgeId === id)?.label ?? '審査員';
  const active = activeTasteJudges(taste, judges);
  if (active.length === 0) return <p className={styles.empty}>まだ読み取れていません</p>;
  // 割れの表示は、2人とも読み取れてから（反応が少ないうちの差は、たまたまの差なので）
  const div = taste.divergence;
  const split = div && isTasteRead(taste, div.judgeA) && isTasteRead(taste, div.judgeB) ? div : null;
  return (
    <div className={styles.notes}>
      <ul className={styles.legend}>
        {active.map((j) => {
          const read = isTasteRead(taste, j.judgeId);
          const leaning = read ? tasteLeaning(taste.judges[j.judgeId]!) : [];
          return (
            <li key={j.judgeId} style={{ ['--judge' as string]: j.color }} data-reading={!read || undefined}>
              <span />
              <b>{j.label}</b> {read ? leaning.join('・') || '偏りなし' : `読み取り中（あと${signalsUntilRead(taste, j.judgeId)}回）`}
              <small>反応 {taste.signals[j.judgeId]}</small>
            </li>
          );
        })}
      </ul>
      {split && (
        <p className={styles.split}>
          🤝 {label(split.judgeA)}と{label(split.judgeB)}は「{TASTE_AXES[split.axis]!.label}」で好みが割れています。間をとる案を混ぜて出します。
        </p>
      )}
    </div>
  );
}
