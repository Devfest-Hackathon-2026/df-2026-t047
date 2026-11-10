import { useState } from 'react';
import { useSession } from '../store/session-store.ts';

/**
 * 決勝の案のイメージ画像。サーバーが案ごとに1枚作り、できたら状態に URL が入る。
 * まだ無い・読めない（サーバーが再起動した など）ときは何も出さない
 */
export function IdeaImage({ ideaId, className }: { ideaId: string | undefined; className?: string }) {
  const url = useSession((s) => (ideaId ? (s.snapshot?.ideas[ideaId]?.imageUrl ?? null) : null));
  const [failed, setFailed] = useState<string | null>(null);
  if (!url || failed === url) return null;
  return <img className={className} src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed(url)} />;
}
