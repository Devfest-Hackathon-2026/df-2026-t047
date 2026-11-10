import { Layers, RotateCcw, Users, ChevronRight, Wifi, WifiOff, Share2, Copy, Volume2, VolumeX, LogOut, FileDown, Headphones, HeadphoneOff } from 'lucide-react';
import { downloadMinutes } from '../../shared/minutes.ts';
import { useCall } from '../call/call-store.ts';
import { setMuted, useMuted } from '../../shared/sfx.ts';
import { canShareInvite, copyInvite, shareInvite } from '../../shared/invite.ts';
import { CallControls, CallMicButton, CameraButton, JudgeWipeBand } from '../call/CallControls.tsx';
import { useEffect } from 'react';
import { useDisplay } from '../../store/display-store.ts';
import { pick, useFormality } from '../../shared/formality.ts';
import { useSession } from '../../store/session-store.ts';
import { EMPTY, useMe } from '../../shared/selectors.ts';
import { MicButton } from '../voice/VoiceControls.tsx';
import { Captions, UtteranceInput } from '../chat/Chat.tsx';
import { ConsensusMemo } from '../consensus/ConsensusMemo.tsx';
import { TastePanel } from '../taste/TasteRadar.tsx';
import styles from './Chrome.module.css';

export function Header() {
  const sessionId = useSession((s) => s.sessionId);
  const connection = useSession((s) => s.connection);
  const room = useSession((s) => s.room);
  const judges = useSession((s) => s.snapshot?.judges ?? EMPTY);
  const lobby = useSession((s) => s.snapshot?.status === 'lobby');
  const connected = judges.filter((j) => j.connected).length;
  const { isSpectator } = useMe();
  const formality = useFormality();
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        {formality === 1 ? (
          <span className={styles.wordmark}>
            <img src="/icons/icon-192.png" alt="" /> IDEA AUDITION
          </span>
        ) : (
          <img className={styles.logo} src="/brand/logo-neon-sm.webp" alt="IDEA AUDITION" />
        )}
      </div>
      {formality === 1 && <FormalityToggle />}
      <div className={styles.tag}>{pick(formality, 'AIがプレゼン。あなたが審査員。', 'AIと議論し、チームでアイデアを前に進める')}</div>
      {formality === 0 && <FormalityToggle />}
      {room === 'active' && (
      <div className={styles.right}>
        {connection === 'open' ? (
          <span className={styles.status}>
            <span className={styles.onlineDot} /> {sessionId.toUpperCase()}
          </span>
        ) : (
          <span className={styles.statusWarn}>
            <WifiOff size={14} /> {pick(formality, '再接続中…', '再接続しています')}
          </span>
        )}
        <span className={styles.divider} />
        <Users size={15} />
        <span>{formality === 1 ? `${connected}人で会議中` : `${connected}人で参加中`}</span>
        {isSpectator && <span className={styles.spectator}>{pick(formality, '観覧モード', '観覧')}</span>}
        {import.meta.env.DEV && <AiModeBadge />}
        <CallControls />
        {/* 音の切り替えは、どの場面でもここにまとめる：自分のマイク・相手の声・効果音（#40）。
            オフィシャルの会議中は、自分のマイクを下のバー（ミュート）に置くので、ここはロビーだけ。効果音は鳴らさないので出さない */}
        {!isSpectator && (formality === 0 || lobby) && <CallMicButton />}
        <OthersVoiceToggle />
        {formality === 0 && <SoundToggle />}
        <button type="button" className={styles.copy} onClick={() => void copyInvite()} title="この部屋のリンクをコピー">
          <Copy size={14} /> コピー
        </button>
        {canShareInvite() && (
          <button type="button" className={styles.invite} onClick={() => void shareInvite()} title="この部屋のリンクを共有（AirDrop・LINE など）">
            <Share2 size={14} /> 招待
          </button>
        )}
        {connection === 'open' && <Wifi size={14} className={styles.wifi} />}
        <LeaveButton />
      </div>
      )}
    </header>
  );
}

/** オフィシャル会議モードの切り替え（#36）。表示だけを切り替え、進行には影響しない */
function FormalityToggle() {
  const formality = useDisplay((s) => s.formality);
  const setFormality = useDisplay((s) => s.setFormality);
  const official = formality === 1;
  return (
    <button
      type="button"
      className={official ? styles.modeSwitch : styles.copy}
      onClick={() => setFormality(official ? 0 : 1)}
      aria-pressed={official}
      title="表示モードを切り替える（カジュアル／オフィシャル会議モード）"
    >
      {official ? (
        <>
          <i aria-hidden /> 会議モード
        </>
      ) : (
        'カジュアル'
      )}
    </button>
  );
}

/** オーディションを抜けてトップに戻る（D2）。通話も切る。審査の途中なので一度だけ確かめる */
function LeaveButton() {
  const leaveRoom = useSession((s) => s.leaveRoom);
  const formality = useFormality();
  const onLeave = () => {
    if (!window.confirm(pick(formality, 'オーディションから退出しますか？（同じリンクを開けば、また参加できます）', '会議から退出しますか？（同じリンクを開けば、また参加できます）'))) return;
    useCall.getState().leave();
    void leaveRoom();
  };
  return (
    <button type="button" className={styles.copy} onClick={onLeave} title={pick(formality, 'オーディションから退出する', '会議から退出する')}>
      <LogOut size={14} /> {pick(formality, '退出', '会議から退出')}
    </button>
  );
}

/** 相手の声のオン・オフ（通話はつないだまま、自分のスピーカーから出さないだけ） */
function OthersVoiceToggle() {
  const off = useCall((s) => s.othersMuted);
  const toggle = useCall((s) => s.toggleOthers);
  return (
    <button
      type="button"
      className={styles.copy}
      onClick={toggle}
      aria-pressed={!off}
      aria-label="相手の声"
      title={off ? '相手の声をオンにする' : '相手の声をオフにする'}
    >
      {off ? <HeadphoneOff size={14} /> : <Headphones size={14} />} 声
    </button>
  );
}

/** 効果音のオン・オフ（この端末に覚える） */
function SoundToggle() {
  const muted = useMuted();
  return (
    <button
      type="button"
      className={styles.copy}
      onClick={() => setMuted(!muted)}
      aria-pressed={!muted}
      aria-label="効果音"
      title={muted ? '効果音をオンにする' : '効果音をオフにする'}
    >
      {muted ? <VolumeX size={14} /> : <Volume2 size={14} />} 効果音
    </button>
  );
}

export function Footer() {
  const snapshot = useSession((s) => s.snapshot);
  const send = useSession((s) => s.send);
  const openBox = useDisplay((s) => s.setIdeaBoxOpen);
  const consensusOpen = useDisplay((s) => s.consensusOpen);
  const setConsensusOpen = useDisplay((s) => s.setConsensusOpen);
  const tasteOpen = useDisplay((s) => s.tasteOpen);
  const formality = useFormality();
  const setTasteOpen = useDisplay((s) => s.setTasteOpen);
  const { judgeId, isHost } = useMe();
  // 予選は審査員の顔を舞台の台に出すので、ここではワイプを出さない（決勝ではここに並べる）
  const prelimStage = useDisplay((s) => s.prelimStage);
  if (!snapshot) return null;
  if (formality === 1) return <OfficialFooter />;
  return (
    <footer
      className={styles.footer}
      data-compact={prelimStage || undefined}
      style={{ ['--n' as string]: Math.max(1, snapshot.judges.length) }}
    >
      <Captions />
      <div className={styles.judges}>
        {!prelimStage && <JudgeWipeBand />}
        {judgeId && (
          <div className={styles.myControls}>
            <CameraButton />
          </div>
        )}
      </div>
      {/* 右側：チャット欄とボタン（ワイプの下端にそろえる） */}
      <div className={styles.side}>
        <div className={styles.sideRow}>
      <UtteranceInput />
      <div className={styles.actions}>
        <TastePanel />
        <button onClick={() => setTasteOpen(!tasteOpen)} aria-expanded={tasteOpen} title={pick(formality, '反応から読み取ったみんなの好み', '反応から読み取った参加者の評価の傾向')}>
          {'🧭 '}<span className={styles.btnLabel}>{pick(formality, '好み', '評価の傾向')}</span> {snapshot.taste.divergence ? <b>割れ</b> : null}
        </button>
        <ConsensusMemo />
        <button
          onClick={() => {
            setConsensusOpen(!consensusOpen);
            if (!consensusOpen) setTasteOpen(false);
          }}
          aria-expanded={consensusOpen}
        >
          {'🤝 '}<span className={styles.btnLabel}>{pick(formality, '合意メモ', '合意事項メモ')}</span> <b>{snapshot.consensus.claims.filter((c) => c.status === 'agreed').length}</b>
        </button>
        <button onClick={() => openBox(true)} data-anchor="ideabox">
          <Layers size={16} /> <span className={styles.btnLabel}>{pick(formality, 'アイデアBOX', '提案一覧')}</span> <b>{snapshot.ideaBox.length}</b>
          <ChevronRight size={15} />
        </button>
        {isHost && (
          <button
            title={pick(formality, '最初からやり直す', 'セッションを最初から開始')}
            aria-label={pick(formality, '最初からやり直す', 'セッションを最初から開始')}
            onClick={() => {
              if (confirm(pick(formality, 'セッションを最初からやり直しますか？（全員の画面が開始画面に戻ります）', 'セッションを最初から開始しますか？（全員の画面が開始画面に戻ります）'))) {
                void send('RESET_SESSION', {});
              }
            }}
          >
            <RotateCcw size={16} />
          </button>
        )}
        </div>
        </div>
      </div>
    </footer>
  );
}

/**
 * オフィシャル会議モードの下のバー：ミュート・カメラ・発言・議事録の出力（ホストはやり直しも）。
 * 顔・好み・合意・採用済みは画面の左右の列に出すので、ここには置かない
 */
function OfficialFooter() {
  const snapshot = useSession((s) => s.snapshot)!;
  const send = useSession((s) => s.send);
  const { judgeId, isHost } = useMe();
  return (
    <footer className={styles.officialFooter}>
      <Captions />
      {judgeId && (
        <div className={styles.officialControls}>
          <MicButton label />
          <CameraButton label />
        </div>
      )}
      <div className={styles.officialInput}>
        <UtteranceInput />
      </div>
      <button type="button" className={styles.minutesButton} onClick={() => downloadMinutes(snapshot, useDisplay.getState().chatLog)}>
        <FileDown size={17} /> 議事録を出力
      </button>
      {isHost && (
        <button
          type="button"
          className={styles.officialIcon}
          title="会議を最初からやり直す"
          aria-label="会議を最初からやり直す"
          onClick={() => {
            if (confirm('会議を最初からやり直しますか？（全員の画面が開始画面に戻ります）')) void send('RESET_SESSION', {});
          }}
        >
          <RotateCcw size={16} />
        </button>
      )}
    </footer>
  );
}

export function Toasts() {
  const toasts = useDisplay((s) => s.toasts);
  const dismiss = useDisplay((s) => s.dismissToast);
  const formality = useFormality();
  return (
    <div className={styles.toasts} role="status" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} id={t.id} text={typeof t.text === 'string' ? t.text : pick(formality, t.text.casual, t.text.official)} tone={t.tone} onDone={dismiss} />
      ))}
    </div>
  );
}

function ToastItem(props: { id: string; text: string; tone: string; onDone: (id: string) => void }) {
  const { id, onDone } = props;
  useEffect(() => {
    const t = setTimeout(() => onDone(id), 3800);
    return () => clearTimeout(t);
  }, [id, onDone]);
  return (
    <div className={styles.toast} data-tone={props.tone}>
      {props.text}
    </div>
  );
}

/** いまの AI のモード。ホストは押して切り替えられる（Gemini はクレジットを使う） */
function AiModeBadge() {
  const ai = useSession((s) => s.snapshot?.ai);
  const status = useSession((s) => s.snapshot?.status);
  const send = useSession((s) => s.send);
  const { isHost } = useMe();
  if (!ai || status === 'lobby') return null;
  const next = ai.mode === 'gemini' ? 'fixture' : 'gemini';
  const canSwitch = isHost && ai.available.includes(next);
  const label = ai.mode === 'gemini' ? 'AI：Gemini' : '固定データ';
  return (
    <button
      className={styles.aiBadge}
      data-mode={ai.mode}
      disabled={!canSwitch}
      title={
        canSwitch
          ? `${next === 'gemini' ? 'Gemini（クレジットを使う）' : '固定データ（無料）'}に切り替える`
          : ai.mode === 'gemini'
            ? 'Gemini で生成中（クレジットを使います）'
            : '固定データで動作中（無料）'
      }
      onClick={() => {
        const message =
          next === 'gemini'
            ? 'Gemini に切り替えますか？（クレジットを使います。作り置きの案は入れ替わります）'
            : '固定データに切り替えますか？（無料。作り置きの案は入れ替わります）';
        if (confirm(message)) void send('SET_AI_MODE', { mode: next });
      }}
    >
      {label}
    </button>
  );
}
