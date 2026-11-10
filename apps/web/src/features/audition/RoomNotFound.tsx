import { SearchX } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '../../store/session-store.ts';
import styles from './RoomNotFound.module.css';

/** リンクの部屋が見つからないとき（作られていない・時間が経って片付けられた） */
export function RoomNotFound() {
  const room = useSession((s) => s.room);
  const createRoom = useSession((s) => s.createRoom);
  const leaveRoom = useSession((s) => s.leaveRoom);
  const [busy, setBusy] = useState(false);
  if (room !== 'not_found') return null;
  return (
    <div className={styles.backdrop}>
      <div className={styles.card}>
        <SearchX size={28} />
        <h2>このオーディションは見つかりません</h2>
        <p>リンクが違うか、時間が経って終了した可能性があります。主催者にリンクを確かめてもらうか、新しく作ってください。</p>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await createRoom();
            setBusy(false);
          }}
        >
          新しいオーディションを作る
        </button>
        <button className={styles.secondary} onClick={leaveRoom}>
          トップに戻る
        </button>
      </div>
    </div>
  );
}
