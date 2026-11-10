import { Loader2 } from 'lucide-react';
import type { SessionSnapshot } from '@idea-audition/protocol';
import styles from './Official.module.css';

/**
 * 質疑応答（オフィシャル会議モード）。カジュアルではキャラの吹き出しに出る答えを、会議の記録として出す。
 * 新しいものを上に limit 件まで。答えを考えている間は「回答中」
 */
export function QA({ snapshot, instanceId, limit = 2 }: { snapshot: SessionSnapshot; instanceId: string; limit?: number }) {
  const items = snapshot.answers.filter((a) => a.instanceId === instanceId).slice(-limit).reverse();
  if (items.length === 0) return null;
  return (
    <ul className={styles.qa} aria-label="質疑応答">
      {items.map((a, i) => (
        <li key={`${a.question}-${i}`}>
          <p className={styles.q}>
            <b>Q</b>
            {a.question}
          </p>
          <p className={styles.a}>
            <b>A</b>
            {a.answer ?? (
              <span className={styles.muted}>
                <Loader2 size={12} className={styles.spin} /> 回答中
              </span>
            )}
          </p>
        </li>
      ))}
    </ul>
  );
}
