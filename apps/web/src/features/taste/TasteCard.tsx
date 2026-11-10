import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { useDisplay } from '../../store/display-store.ts';
import { useSession } from '../../store/session-store.ts';
import { pick, useFormality } from '../../shared/formality.ts';
import { TasteRadar } from './TasteRadar.tsx';
import { activeTasteJudges } from './taste-summary.ts';
import styles from './Taste.module.css';

/** 待機室との間（px） */
const DOCK_GAP = 10;

/**
 * 予選の舞台に常に出しておく、小さい「みんなの好み」（押すと下のバーの詳しいパネルが開く）。
 * 置き場所は待機室のすぐ下。待機室の位置と幅は画面の幅ごとに CSS で変わるので、実物を測って合わせる。
 */
export function TasteCard() {
  const snapshot = useSession((s) => s.snapshot);
  const open = useDisplay((s) => s.tasteOpen);
  const setOpen = useDisplay((s) => s.setTasteOpen);
  const ref = useRef<HTMLButtonElement>(null);
  const dock = useDockBelow(ref, '.waiting-room', !!snapshot);
  const formality = useFormality();
  if (!snapshot) return null;
  const active = activeTasteJudges(snapshot.taste, snapshot.judges);
  return (
    <button
      ref={ref}
      type="button"
      className={styles.card}
      style={dock}
      onClick={() => setOpen(!open)}
      aria-expanded={open}
      // 名前は中の文字（見出し・割れ・審査員名）から付く。固定の aria-label にすると中身が読み上げられない
      title="押すと詳しく見られます"
    >
      <span className={styles.cardHead}>
        {pick(formality, '🧭 みんなの好み', '評価の傾向')} {snapshot.taste.divergence ? <b>割れ</b> : null}
      </span>
      <TasteRadar snapshot={snapshot} compact />
      {active.length === 0 ? (
        <span className={styles.cardEmpty}>{pick(formality, '反応すると、ここに好みが出ます', '反応すると、ここに評価の傾向が出ます')}</span>
      ) : (
        <span className={styles.cardLegend}>
          {active.map((j) => (
            <i key={j.judgeId} style={{ ['--judge' as string]: j.color }}>
              {j.label}
            </i>
          ))}
        </span>
      )}
    </button>
  );
}

/**
 * ref の要素を、同じ親の中の selector の要素のすぐ下に、同じ左端・同じ幅で置く。
 * 測れるまでは隠しておく（左上に一瞬出てから動くのを防ぐ）。
 * mounted：ref の要素が描かれているか（描かれてから測り直す）。
 * 画面幅が変わると待機室は大きさを変えずに動くこともあるので、ウィンドウの大きさの変化でも測り直す。
 */
function useDockBelow(ref: RefObject<HTMLElement | null>, selector: string, mounted: boolean): CSSProperties {
  const [dock, setDock] = useState<CSSProperties>({ visibility: 'hidden' });
  useLayoutEffect(() => {
    if (!mounted) return;
    const anchor = ref.current?.parentElement?.querySelector<HTMLElement>(selector);
    if (!anchor) return;
    const measure = () =>
      setDock({ top: anchor.offsetTop + anchor.offsetHeight + DOCK_GAP, left: anchor.offsetLeft, width: anchor.offsetWidth });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(anchor);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [ref, selector, mounted]);
  return dock;
}
