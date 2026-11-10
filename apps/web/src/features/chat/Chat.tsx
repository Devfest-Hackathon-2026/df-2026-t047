import { MessageSquare, Send, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useDisplay } from '../../store/display-store.ts';
import { useSession } from '../../store/session-store.ts';
import { judgeById, useMe } from '../../shared/selectors.ts';
import { useVoice } from '../voice/voice-store.ts';
import { useFormality } from '../../shared/formality.ts';
import { proposalLabel } from '../../shared/proposal-label.ts';
import styles from './Chat.module.css';

/** 発言のテキスト入力（音声が使えないときの代わり、常に使える） */
export function UtteranceInput() {
  const send = useSession((s) => s.send);
  const snapshot = useSession((s) => s.snapshot);
  const selected = useDisplay((s) => s.selected);
  const voiceState = useVoice((s) => s.state);
  const chatOpen = useDisplay((s) => s.chatOpen);
  const setChatOpen = useDisplay((s) => s.setChatOpen);
  const chatCount = useDisplay((s) => s.chatLog.length);
  const { isSpectator } = useMe();
  const [text, setText] = useState('');
  const composing = useRef(false);
  const sending = useRef(false);
  const formality = useFormality();
  const spotId = snapshot?.spotlight?.instanceId ?? null;
  const targetName = (selected ?? spotId) && snapshot ? proposalLabel(snapshot, (selected ?? spotId)!, formality) || null : null;
  const listening = voiceState === 'listening' || voiceState === 'starting';

  return (
    <form
      className={styles.input}
      data-listening={listening || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        const t = text.trim();
        // 日本語入力の変換確定の Enter と、送信中の二度押しでは送らない（同じ発言が2回出ないように）
        if (!t || composing.current || sending.current) return;
        sending.current = true;
        setText('');
        void send('SUBMIT_UTTERANCE', { text: t, source: 'text', ...(selected ? { targetInstanceId: selected } : {}) })
          .then((r) => {
            if (!r.ok) setText((cur) => cur || t);
          })
          .finally(() => {
            sending.current = false;
          });
      }}
    >
      {/* 文字起こしは画面に出さない（ずっと記録されている感じが負担になるため、issue #2） */}
      <input
        value={text}
        maxLength={300}
        disabled={isSpectator}
        onChange={(e) => setText(e.target.value)}
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={() => (composing.current = false)}
        placeholder={
          listening
            ? formality === 1
              ? '話してください…'
              : '話してください…（キャラの名前を呼ぶと宛先になります）'
            : formality === 1
              ? `${targetName ? `${targetName}について` : 'この案について'}質問・意見を伝える…`
              : targetName
                ? `${targetName} に話しかける（質問・改善の指示）`
                : '発言する（「ルナ、コストを下げて」のように名前で呼べます）'
        }
        aria-label="発言"
      />
      <button disabled={isSpectator || !text.trim()} aria-label="送信">
        <Send size={15} />
      </button>
      <button
        type="button"
        className={styles.chatToggle}
        aria-label="チャット履歴を開く"
        aria-expanded={chatOpen}
        title="チャット履歴（テキストで打った発言）"
        onClick={() => setChatOpen(!chatOpen)}
      >
        <MessageSquare size={15} />
        {chatCount > 0 && <i>{chatCount > 99 ? '99+' : chatCount}</i>}
      </button>
    </form>
  );
}

/** テキストで打った発言を全員に表示する字幕（声の発言は出さない） */
export function Captions() {
  const captions = useDisplay((s) => s.captions);
  return (
    <div className={styles.captions} aria-live="polite">
      {captions.map((c) => (
        <CaptionItem key={c.id} id={c.id} />
      ))}
    </div>
  );
}

const INTENT_LABEL = { question: '質問', instruction: '改善の指示', reject: '見送り', hesitation: '迷い', positive: 'いいね', comment: '' } as const;

function CaptionItem({ id }: { id: string }) {
  const caption = useDisplay((s) => s.captions.find((c) => c.id === id));
  const dismiss = useDisplay((s) => s.dismissCaption);
  const snapshot = useSession((s) => s.snapshot);
  const formality = useFormality();
  useEffect(() => {
    const t = setTimeout(() => dismiss(id), 6000);
    return () => clearTimeout(t);
  }, [id, dismiss]);
  if (!caption || !snapshot) return null;
  const judge = judgeById(snapshot, caption.judgeId);
  const target = caption.targetInstanceId ? proposalLabel(snapshot, caption.targetInstanceId, formality) || null : null;
  return (
    <div className={styles.caption} style={{ ['--judge' as string]: judge?.color ?? '#c58cff' }}>
      <b>
        {judge?.label ?? '審査員'}
        {target ? ` → ${target}` : ''}
      </b>
      {INTENT_LABEL[caption.intent] && <em>{INTENT_LABEL[caption.intent]}</em>}
      <span>{caption.text}</span>
    </div>
  );
}

const clock = (at: number) => new Date(at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

/** チャット履歴：テキストで打った発言を、消えずに時系列で見られる右側のパネル */
export function ChatPanel() {
  const open = useDisplay((s) => s.chatOpen);
  const setOpen = useDisplay((s) => s.setChatOpen);
  const log = useDisplay((s) => s.chatLog);
  const snapshot = useSession((s) => s.snapshot);
  const formality = useFormality();
  const listEnd = useRef<HTMLDivElement>(null);
  // Esc で閉じる
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);
  // 開いたとき・新しい発言が来たときに、いちばん下（最新）へ
  useEffect(() => {
    if (open) listEnd.current?.scrollIntoView({ block: 'end' });
  }, [open, log.length]);
  if (!open || !snapshot) return null;
  return (
    <aside className={styles.chatPanel} aria-label="チャット履歴">
      <header>
        <strong>チャット履歴</strong>
        <small>テキストで打った発言</small>
        <button type="button" aria-label="閉じる" onClick={() => setOpen(false)}>
          <X size={16} />
        </button>
      </header>
      {log.length === 0 ? (
        <p className={styles.chatEmpty}>まだ発言はありません。下の入力欄に打った発言が、ここに残ります。</p>
      ) : (
        <ol className={styles.chatList}>
          {log.map((m) => {
            const judge = judgeById(snapshot, m.judgeId);
            const target = m.targetInstanceId ? proposalLabel(snapshot, m.targetInstanceId, formality) || null : null;
            return (
              <li key={m.id} style={{ ['--judge' as string]: judge?.color ?? '#c58cff' }}>
                <div>
                  <b>
                    {judge?.label ?? '審査員'}
                    {target ? ` → ${target}` : ''}
                  </b>
                  {INTENT_LABEL[m.intent] && <em>{INTENT_LABEL[m.intent]}</em>}
                  <time>{clock(m.at)}</time>
                </div>
                <p>{m.text}</p>
              </li>
            );
          })}
        </ol>
      )}
      <div ref={listEnd} />
    </aside>
  );
}
