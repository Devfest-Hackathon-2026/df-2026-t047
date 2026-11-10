import { Crown, Mic, MicOff, Video, VideoOff, Volume2 } from 'lucide-react';
import { useDisplay } from '../../store/display-store.ts';
import { useEffect, useRef } from 'react';
import { useSession } from '../../store/session-store.ts';
import { EMPTY } from '../../shared/selectors.ts';
import { useMe } from '../../shared/selectors.ts';
import { useCall } from './call-store.ts';
import styles from './Call.module.css';

/**
 * 通話の様子（ヘッダー）。部屋に入ると自動で通話に入り、みんなの声が聞こえる。
 * ミュートはマイクのボタンで切り替える。ブラウザが音を止めているときだけ「音声をオンにする」を出す。
 */
export function CallControls() {
  const room = useSession((s) => s.room);
  const { me, isSpectator } = useMe();
  const blocked = useCall((s) => s.blocked);
  const unlock = useCall((s) => s.unlock);
  if (room !== 'active' || (!isSpectator && !me)) return null;
  if (blocked) {
    return (
      <button type="button" className={styles.join} onClick={() => void unlock()} title="ブラウザが音を止めています。押すとみんなの声が聞こえます">
        <Volume2 size={14} /> 音声をオンにする
      </button>
    );
  }
  // 通話の人数などの表示は出さない（音が止められているときの「音声をオンにする」だけ）
  return null;
}

/**
 * 審査員の顔のワイプ（1人分）。カメラを映していれば顔、映していなければ頭文字。
 * 枠はいつも残すので、カメラを切った人も誰が参加しているか分かる。
 * 名前・マイクのオン／オフ・声の波形を重ね、話していると枠が光る
 */
export function JudgeWipe({ judgeId, letter, name, color, host }: { judgeId: string; letter: string; name: string; color: string; host: boolean }) {
  const myId = useSession((s) => s.judgeId);
  const mine = judgeId === myId;
  const stream = useCall((s) => (mine ? s.camera : s.camOthers[judgeId] ? (s.videos[judgeId] ?? null) : null));
  const speaking = useCall((s) => !!s.speaking[judgeId]);
  const level = useCall((s) => s.levels[judgeId] ?? 0);
  const myMic = useCall((s) => s.inCall && !s.muted && !s.listenOnly);
  const otherMic = useDisplay((s) => !!s.micOn[judgeId]);
  const mic = mine ? myMic : otherMic;
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) void v.play().catch(() => {});
  }, [stream]);
  return (
    <div className={styles.wipe} data-speaking={speaking || undefined} data-you={mine || undefined} style={{ ['--judge' as string]: color }}>
      <span className={styles.wipeLetter}>{letter}</span>
      {stream && <video ref={ref} autoPlay playsInline muted data-mirror={mine || undefined} />}
      {host && <Crown size={12} className={styles.wipeCrown} aria-label="ホスト" />}
      <span className={styles.wipeName}>{name}</span>
      <span className={styles.wipeMic} data-on={mic || undefined} aria-label={mic ? 'マイクON' : 'ミュート'}>
        {mic ? <Mic size={11} /> : <MicOff size={11} />}
        {mic && (
          <span className={styles.wave} aria-hidden>
            {[0.6, 1, 0.75].map((k, i) => (
              <i key={i} style={{ height: `${20 + Math.round(level * 20 * k)}%` }} />
            ))}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * 審査員の顔を、テレビのワイプのように横一列に並べる帯。審査中は左下（札の代わり）、表彰では画面の下に浮かせる
 */
export function JudgeWipeBand({ floating = false }: { floating?: boolean }) {
  const judges = useSession((s) => s.snapshot?.judges ?? EMPTY);
  if (judges.length === 0) return null;
  return (
    <div className={styles.band} data-floating={floating || undefined}>
      {judges.map((j) => (
        <div key={j.judgeId} className={styles.bandItem} data-offline={!j.connected || undefined}>
          <JudgeWipe judgeId={j.judgeId} letter={j.letter ?? j.label.slice(-1)} name={j.label} color={j.color} host={j.isHost} />
        </div>
      ))}
    </div>
  );
}

/** 自分の札のカメラのボタン。押すとカメラを映す／止める */
export function CameraButton({ label = false }: { label?: boolean } = {}) {
  const on = useCall((s) => !!s.camera);
  const starting = useCall((s) => s.cameraStarting);
  const toggle = useCall((s) => s.toggleCamera);
  return (
    <button
      type="button"
      className={styles.cam}
      data-on={on || undefined}
      disabled={starting}
      onClick={() => void toggle()}
      aria-pressed={on}
      aria-label={on ? 'カメラを止める' : 'カメラを映す'}
      title={on ? 'カメラを止める' : 'カメラを映す'}
    >
      {on ? <Video size={15} /> : <VideoOff size={15} />}
      {label && <span>カメラ</span>}
    </button>
  );
}

/** ヘッダーのマイク（ロビーでも使えるように）。押すとミュートを切り替える */
export { MicButton as CallMicButton } from '../voice/VoiceControls.tsx';
