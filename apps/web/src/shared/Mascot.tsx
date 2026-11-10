import { CHARACTER_DESIGNS } from '@idea-audition/protocol';
import type { CSSProperties } from 'react';
import styles from './Mascot.module.css';

/** スプライトシートからキャラを1体切り出して表示する（ADR-0001：静止画＋コードの動き） */
export function Mascot(props: { designId: number; size?: number | string; className?: string; style?: CSSProperties }) {
  const design = CHARACTER_DESIGNS[props.designId] ?? CHARACTER_DESIGNS[0]!;
  const { col, row, cols, rows, sheet } = design.sprite;
  const x = cols > 1 ? (col * 100) / (cols - 1) : 0;
  const y = rows > 1 ? (row * 100) / (rows - 1) : 0;
  return (
    <div
      className={`${styles.mascot} ${props.className ?? ''}`}
      role="img"
      aria-label={`${design.name}のキャラクター`}
      data-mascot-design={design.designId}
      style={
        {
          backgroundImage: `url(${sheet})`,
          backgroundSize: `${cols * 100}% ${rows * 100}%`,
          backgroundPosition: `${x}% ${y}%`,
          '--accent': design.accent,
          '--accent-glow': `${design.accent}47`,
          width: props.size,
          height: props.size,
          ...props.style,
        } as CSSProperties
      }
    />
  );
}
