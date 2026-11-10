import {
  CampClient as GenericCampClient,
  type CommandOutcome as GenericOutcome,
  type SendOptions,
} from '@camp-protocol/kit/client';
import {
  vocabulary,
  type CommandPayload,
  type CommandType,
  type EphemeralMessage,
  type EphemeralPayloads,
  type EphemeralType,
  type EventMessage,
  type ProtocolErrorMessage,
  type RejectReason,
  type SignalMessage,
  type WelcomeMessage,
} from '@idea-audition/protocol';
import type { z } from 'zod';

export type { SendOptions };
export type ConnectionState = 'connecting' | 'open' | 'reconnecting';
export type CommandOutcome = GenericOutcome<RejectReason>;

interface Handlers {
  /** リンクの部屋が見つからない（作られていない・期限切れ） */
  onRoomNotFound(): void;
  onWelcome(m: WelcomeMessage): void;
  onEvent(m: EventMessage): void;
  onEphemeral(m: EphemeralMessage): void;
  onState(s: ConnectionState): void;
  onProtocolError?(m: ProtocolErrorMessage): void;
}

function campUrl() {
  const configured = import.meta.env.VITE_CAMP_URL as string | undefined;
  if (configured) return configured;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/camp`;
}

/**
 * IDEA AUDITION 用の CAMP クライアント。再接続・再送・順序の管理は @camp-protocol/kit の CampClient が受け持ち、
 * ここでは接続先と、画面の store に合わせた呼び出し方だけを決める。
 */
export class CampClient {
  private readonly inner: GenericCampClient<typeof vocabulary>;

  constructor(sessionId: string, handlers: Handlers, saved?: { judgeId: string; resumeToken?: string }) {
    this.inner = new GenericCampClient(vocabulary, {
      url: campUrl(),
      room: sessionId,
      ...(saved ? { participantId: saved.judgeId } : {}),
      ...(saved?.resumeToken ? { resumeToken: saved.resumeToken } : {}),
    }).on({
      onRoomNotFound: handlers.onRoomNotFound,
      onWelcome: (m) => handlers.onWelcome(m as WelcomeMessage),
      onEvent: (m) => handlers.onEvent(m as EventMessage),
      onEphemeral: (m) => handlers.onEphemeral(m as EphemeralMessage),
      onState: (s) => {
        if (s !== 'closed') handlers.onState(s);
      },
      ...(handlers.onProtocolError ? { onProtocolError: handlers.onProtocolError } : {}),
    });
  }

  connect() {
    this.inner.connect();
  }

  close() {
    this.inner.close();
  }

  send<T extends CommandType>(type: T, payload: CommandPayload<T>, opts: SendOptions = {}): Promise<CommandOutcome> {
    return this.inner.send(type, payload as never, opts) as Promise<CommandOutcome>;
  }

  sendEphemeral<T extends EphemeralType>(type: T, payload: z.infer<(typeof EphemeralPayloads)[T]>) {
    this.inner.sendEphemeral(type, payload as never);
  }

  /** 返事の無い Signal。届かなくてもよい（§3.7） */
  sendSignal(payload: SignalMessage['payload']) {
    this.inner.signal('SOFT_SIGNAL', payload as never);
  }
}
