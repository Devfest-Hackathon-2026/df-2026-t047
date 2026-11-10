import { Firestore } from '@google-cloud/firestore';
import type { SessionStorePort, StoredEvent } from '../../application/ports.ts';
import type { SessionState } from '../../domain/types.ts';
import { localAuthClient } from '../gcp-auth.ts';

/**
 * Firestore への保存（ADR-0003）。
 *   sessions/{sessionId}                ：最新のセッション状態（state は JSON 文字列）と seq
 *   sessions/{sessionId}/events/{seq}   ：確定イベントの記録（追記のみ）
 * state を JSON 文字列で持つのは、Firestore が入れ子の配列を扱えないため。
 */
export class FirestoreSessionStore implements SessionStorePort {
  readonly name = 'firestore';

  constructor(private readonly db: Firestore) {}

  static fromEnv(env: NodeJS.ProcessEnv) {
    const projectId = env.GOOGLE_CLOUD_PROJECT;
    if (!projectId) throw new Error('GOOGLE_CLOUD_PROJECT が未設定です');
    const authClient = localAuthClient(env);
    return new FirestoreSessionStore(
      new Firestore({
        projectId,
        databaseId: env.FIRESTORE_DATABASE ?? '(default)',
        preferRest: true,
        ...(authClient ? { authClient } : {}),
      }),
    );
  }

  private sessionDoc(sessionId: string) {
    return this.db.collection('sessions').doc(sessionId);
  }

  async load(sessionId: string) {
    const snap = await this.sessionDoc(sessionId).get();
    if (!snap.exists) return null;
    const data = snap.data() as { seq?: number; state?: string };
    if (typeof data.seq !== 'number' || typeof data.state !== 'string') return null;
    const state = JSON.parse(data.state) as SessionState;
    if (state.schemaVersion !== 1) return null;
    return { seq: data.seq, state };
  }

  async commit(sessionId: string, seq: number, state: SessionState, events: StoredEvent[]) {
    const doc = this.sessionDoc(sessionId);
    // 1回のバッチは最大500件。イベントは数件ずつしか来ない想定だが、念のため分割する
    for (let i = 0; i < events.length || i === 0; i += 400) {
      const batch = this.db.batch();
      for (const e of events.slice(i, i + 400)) {
        batch.set(doc.collection('events').doc(String(e.seq).padStart(8, '0')), {
          ...e,
          detail: JSON.stringify(e.detail),
        });
      }
      if (i + 400 >= events.length) {
        batch.set(doc, {
          seq,
          status: state.status,
          theme: state.theme,
          state: JSON.stringify(state),
          updatedAt: new Date().toISOString(),
        });
      }
      await batch.commit();
    }
  }
}
