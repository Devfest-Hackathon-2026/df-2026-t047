import styles from './Official.module.css';

const STEPS = ['提案の審議', '比較・改良', '採決', '最終決定'] as const;

/** 会議の段階（点）。いまの段階の名前を横に出す。phase：0=提案の審議 1=比較・改良 2=採決 3=最終決定 */
export function PhaseDots({ phase }: { phase: 0 | 1 | 2 | 3 }) {
  return (
    <div className={styles.dots} role="list" aria-label="会議の段階">
      {STEPS.map((label, i) => (
        <span key={label} role="listitem" title={label} data-state={i < phase ? 'done' : i === phase ? 'now' : undefined} aria-current={i === phase ? 'step' : undefined}>
          <i />
        </span>
      ))}
      <b>{STEPS[phase]}</b>
    </div>
  );
}
