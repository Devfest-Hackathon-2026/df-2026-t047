import { Mic, MicOff } from 'lucide-react';
import { useDisplay } from '../../store/display-store.ts';
import { useVoice } from './voice-store.ts';
import { useCall } from '../call/call-store.ts';
import styles from './Voice.module.css';

/**
 * 自分のマイク。既定はオン（みんなに声が届き、文字起こしもされる）。押すとミュートに切り替わる。
 */
/** label：オフィシャルの下のバーでは「ミュート」の文字も出す */
export function MicButton({ label = false }: { label?: boolean } = {}) {
  const state = useVoice((s) => s.state);
  const inCall = useCall((s) => s.inCall);
  const muted = useCall((s) => s.muted);
  const toggleMute = useCall((s) => s.toggleMute);
  const join = useCall((s) => s.join);
  const listenOnly = useCall((s) => s.listenOnly);
  const retryMic = useCall((s) => s.retryMic);
  const on = inCall && !muted && !listenOnly;
  return (
    <button
      className={styles.mic}
      data-state={on ? (state === 'off' ? 'listening' : state) : 'off'}
      onClick={() => {
        if (!inCall) {
          if (muted) toggleMute();
          void join();
          return;
        }
        // 聞くだけで参加しているときは、マイクの許可を取り直してつなぎ直す
        if (listenOnly) {
          void retryMic();
          return;
        }
        toggleMute();
      }}
      aria-pressed={on}
      aria-label={on ? 'ミュートする' : 'ミュートを解除する'}
      title={on ? 'ミュートする（声がみんなにも AI にも届かなくなります）' : 'ミュートを解除する（キャラの名前を呼ぶと、そのキャラ宛てになります）'}
    >
      {on ? <Mic size={16} /> : <MicOff size={16} />}
      {label && <span>{on ? 'ミュート' : 'ミュート解除'}</span>}
    </button>
  );
}

/** 他の審査員のマイク状態 */
export function MicIndicator({ judgeId }: { judgeId: string }) {
  const on = useDisplay((s) => !!s.micOn[judgeId]);
  if (!on) return null;
  return (
    <span className={styles.bars} aria-label="マイクON">
      <i />
      <i />
      <i />
    </span>
  );
}
