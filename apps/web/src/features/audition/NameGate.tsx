import { UserRound } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '../../store/session-store.ts';
import { useMe } from '../../shared/selectors.ts';
import styles from './RoomNotFound.module.css';

const NAME_KEY = 'idea-audition:name';

function readName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* 保存できなくても続ける */
  }
}

/**
 * 参加したら最初に名前を入れてもらう。名前は審査員の札・通知・字幕・合意メモ・企画書に出る。
 * 前に入れた名前はこの端末に覚えておき、最初から入れておく。
 */
export function NameGate() {
  const room = useSession((s) => s.room);
  const connection = useSession((s) => s.connection);
  const send = useSession((s) => s.send);
  const { me, isSpectator } = useMe();
  const [name, setName] = useState(readName);
  const [busy, setBusy] = useState(false);
  if (room !== 'active' || connection !== 'open' || isSpectator || !me || me.name) return null;
  const clean = name.replace(/\s+/g, ' ').trim();
  return (
    <div className={styles.backdrop}>
      <form
        className={styles.card}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!clean || busy) return;
          setBusy(true);
          const r = await send('SET_JUDGE_NAME', { name: clean });
          if (r.ok) writeName(clean);
          setBusy(false);
        }}
      >
        <UserRound size={28} />
        <h2>あなたの名前を入れてください</h2>
        <p>審査員の札や通知に、この名前で出ます（16文字まで）。</p>
        <input
          id="judge-name"
          className={styles.input}
          autoFocus
          value={name}
          maxLength={16}
          autoComplete="nickname"
          placeholder="例：ゆうと"
          aria-label="あなたの名前"
          onChange={(e) => setName(e.target.value)}
        />
        <button disabled={!clean || busy}>この名前で参加する</button>
      </form>
    </div>
  );
}
