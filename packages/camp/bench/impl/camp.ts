import { z } from 'zod';
import WebSocket from 'ws';
import { defineVocabulary } from '@camp-protocol/kit';
import { CampClient, type WebSocketLike } from '@camp-protocol/kit/client';
import { createCampServer } from '@camp-protocol/kit/server';
import { applyAnswer, applyOp, initialMeeting, type MeetingState } from '../meeting.ts';
import { observe, type BenchClient, type Impl } from './types.ts';

/**
 * CAMP：IDEA AUDITION と同じ部品（@camp-protocol/kit）で作った会議。
 * 守りは CAMP がもつ：1件ずつ順に処理・commandId で重複を捨てる・切れたら取り直して送り直す・reset をまたいだ AI の結果は捨てる。
 * アプリが書くのは、下の3つの操作のルールだけ。
 */
const id = z.string().min(1).max(80);
const meetingVocabulary = defineVocabulary({
  commands: {
    REACT: z.object({ opId: id }),
    ASK: z.object({ opId: id, text: z.string() }),
    NEXT: z.object({ opId: id }),
  },
  events: ['CHANGED'],
  rejectReasons: [],
  snapshot: z.object({
    seq: z.number(),
    proposal: z.number(),
    reactions: z.number(),
    questions: z.array(z.any()),
    answers: z.array(z.any()),
    recent: z.array(z.string()),
    participants: z.array(z.any()),
  }),
});

export const campImpl: Impl = {
  name: 'CAMP',
  async startServer(ledger, ai) {
    const server = createCampServer(meetingVocabulary, {
      port: 0,
      room: {
        initialState: initialMeeting,
        maxParticipants: 16,
        commands: {
          REACT(room, p, { actor }) {
            applyOp(room.state, { type: 'REACT', ...p }, actor, ledger);
            room.emit('CHANGED', {});
          },
          ASK(room, p, { actor }) {
            const q = applyOp(room.state, { type: 'ASK', ...p }, actor, ledger)!;
            room.emit('CHANGED', {});
            // 遅い AI。次の提案へ（reset）をまたいだ結果は、CAMP が捨てる
            room.task(
              () => ai(q.text),
              (answer) => {
                applyAnswer(room.state, q, answer, ledger);
                room.emit('CHANGED', {});
              },
            );
          },
          NEXT(room, p, { actor }) {
            applyOp(room.state, { type: 'NEXT', ...p }, actor, ledger);
            room.reset(room.state);
            room.emit('CHANGED', {});
          },
        },
      },
    });
    const port = await server.port;
    return {
      port,
      state: () => server.rooms.get('bench')!.state as MeetingState,
      close: () => server.close(),
    };
  },
  connect(port) {
    let resolveReady!: () => void;
    const c: BenchClient = {
      view: null,
      seen: new Map(),
      messagesIn: 0,
      messagesOut: 0,
      ready: new Promise((r) => (resolveReady = r)),
      send(op) {
        c.messagesOut++;
        const { type, ...payload } = op;
        void camp.send(type, payload as never);
      },
      close: () => camp.close(),
    };
    const camp = new CampClient(meetingVocabulary, {
      url: `ws://127.0.0.1:${port}/camp`,
      room: 'bench',
      // 送り直しの待ち時間などは既定のまま（アプリと同じ）
      createSocket: (url) => new WebSocket(url) as unknown as WebSocketLike,
    })
      .on({
        onSnapshot: (s) => {
          c.messagesIn++;
          observe(c, s as unknown as MeetingState);
          resolveReady();
        },
      })
      .connect();
    return c;
  },
};
