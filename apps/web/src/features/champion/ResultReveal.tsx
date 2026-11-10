import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Crown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import './ceremony.css';

/** 結果発表のカウントダウンの長さ（3 → 2 → 1 → 表彰） */
export const REVEAL_MS = 2_400;

/**
 * 投票が締まって優勝が決まった瞬間（審査の画面 → 優勝の画面）に、少しだけ溜めを作る。
 * 画面を開き直したときや、最初から優勝の画面のときは出さない。
 */
export function useResultReveal(status: string | undefined) {
  const prev = useRef(status);
  const at = useRef<number | null>(null);
  if (prev.current !== status) {
    if ((prev.current === 'champion_selection' || prev.current === 'audition_active') && status === 'completed') at.current = Date.now();
    prev.current = status;
  }
  const [, rerender] = useState(0);
  useEffect(() => {
    if (at.current === null) return;
    const t = setTimeout(() => rerender((x) => x + 1), REVEAL_MS + 50);
    return () => clearTimeout(t);
  }, [status]);
  return at.current !== null && Date.now() - at.current < REVEAL_MS;
}

/** 「THE MOMENT OF TRUTH」：3・2・1 と数えてから表彰へ（ChatGPT 版の結果発表から） */
export function ResultReveal({ show }: { show: boolean }) {
  const reduced = useReducedMotion();
  const [count, setCount] = useState(3);
  useEffect(() => {
    if (!show) return;
    setCount(3);
    const t1 = setTimeout(() => setCount(2), 700);
    const t2 = setTimeout(() => setCount(1), 1_450);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [show]);
  return (
    <div className="ia-ceremony">
      <AnimatePresence>
        {show && (
          <motion.div className="ballot-reveal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="status">
            <div className="reveal-halo" />
            <Crown />
            <span>THE MOMENT OF TRUTH</span>
            <p>みんなが選んだ、最高のアイデアは。</p>
            <motion.strong key={count} initial={{ scale: 1.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
              {reduced ? '…' : count}
            </motion.strong>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
