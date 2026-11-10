import type { SessionStorePort, StoredEvent } from '../../application/ports.ts';
import type { SessionState } from '../../domain/types.ts';

/** テストと、永続化を使わないときの実装 */
export class MemorySessionStore implements SessionStorePort {
  readonly name = 'memory';
  readonly sessions = new Map<string, { seq: number; state: SessionState }>();
  readonly events = new Map<string, StoredEvent[]>();
  commits = 0;

  async load(sessionId: string) {
    const s = this.sessions.get(sessionId);
    return s ? structuredClone(s) : null;
  }

  async commit(sessionId: string, seq: number, state: SessionState, events: StoredEvent[]) {
    this.commits++;
    this.sessions.set(sessionId, structuredClone({ seq, state }));
    this.events.set(sessionId, [...(this.events.get(sessionId) ?? []), ...structuredClone(events)]);
  }
}

/** 何も保存しない（AI と同じく fixture だけで動かすとき用） */
export class NoopSessionStore implements SessionStorePort {
  readonly name = 'none';
  async load() {
    return null;
  }
  async commit() {}
}
