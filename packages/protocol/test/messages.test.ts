import { describe, expect, it } from 'vitest';
import { ClientMessage, CommandMessage, CAMP_VERSION } from '../src/index.ts';

describe('CAMP v1 契約', () => {
  it('正しい Command を受け付ける', () => {
    const msg = {
      camp: CAMP_VERSION,
      kind: 'command',
      type: 'REQUEST_PROMOTION',
      commandId: 'c1',
      sentAt: new Date().toISOString(),
      payload: { instanceId: 'ch_1' },
    };
    expect(CommandMessage.safeParse(msg).success).toBe(true);
    expect(ClientMessage.safeParse(msg).success).toBe(true);
  });

  it('payload が型と合わない Command を拒否する', () => {
    const msg = {
      camp: CAMP_VERSION,
      kind: 'command',
      type: 'REQUEST_PROMOTION',
      commandId: 'c1',
      sentAt: '',
      payload: { instanceId: 1 },
    };
    expect(CommandMessage.safeParse(msg).success).toBe(false);
  });

  it('異なる CAMP メジャーバージョンを拒否する', () => {
    const msg = { camp: '2', kind: 'hello', sessionId: 'demo' };
    expect(ClientMessage.safeParse(msg).success).toBe(false);
  });

  it('カーソル座標は 0〜1 に正規化されている必要がある', () => {
    const ok = { camp: CAMP_VERSION, kind: 'ephemeral', type: 'CURSOR_MOVED', payload: { x: 0.5, y: 0.2 } };
    const ng = { ...ok, payload: { x: 640, y: 200 } };
    expect(ClientMessage.safeParse(ok).success).toBe(true);
    expect(ClientMessage.safeParse(ng).success).toBe(false);
  });
});
