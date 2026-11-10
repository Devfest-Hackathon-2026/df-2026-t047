import { Check } from 'lucide-react';
import { useSession } from '../../store/session-store.ts';
import { EMPTY } from '../../shared/selectors.ts';
import { JudgeWipe } from '../../features/call/CallControls.tsx';
import styles from './Official.module.css';

/**
 * 左の列：参加者の顔（ワイプ）を縦に並べる。名前・マイク・声の波形はワイプの中、賛成した人には ✓。
 * approved：いまの提案に賛成した人（予選のブザー）
 */
export function People({ approved = EMPTY as readonly string[] }: { approved?: readonly string[] }) {
  const judges = useSession((s) => s.snapshot?.judges ?? EMPTY);
  return (
    <aside className={styles.people} aria-label="参加者">
      {judges.map((j) => {
        const on = approved.includes(j.judgeId);
        return (
          <div key={j.judgeId} className={styles.person} data-on={on || undefined} data-offline={!j.connected || undefined}>
            <JudgeWipe judgeId={j.judgeId} letter={j.letter ?? j.label.slice(-1)} name={j.name ?? j.label} color={j.color} host={j.isHost} />
            {on && (
              <span className={styles.personCheck} aria-label="賛成">
                <Check size={14} />
              </span>
            )}
          </div>
        );
      })}
    </aside>
  );
}
