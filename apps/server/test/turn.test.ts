import { describe, expect, it } from 'vitest';
import { GOOGLE_STUN, createIceServerProvider } from '../src/infrastructure/turn.ts';

const cloudflareBody = {
  iceServers: [
    { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
    {
      urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'],
      username: 'u',
      credential: 'c',
    },
  ],
};

function fakeFetch(responses: (() => Response)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return responses[Math.min(calls.length - 1, responses.length - 1)]!();
  }) as unknown as typeof fetch;
  return { f, calls };
}
const ok = () => new Response(JSON.stringify(cloudflareBody), { status: 201 });
const fail = () => new Response('no', { status: 500 });

describe('通話の中継（Cloudflare TURN）', () => {
  it('キーが無ければ Google の STUN だけ', async () => {
    const p = createIceServerProvider({});
    expect(p.turn).toBe(false);
    expect(await p.get()).toEqual(GOOGLE_STUN);
  });

  it('キーがあれば Cloudflare に接続情報を頼み、ブラウザで使えないポート53を除き、Google の STUN も足す', async () => {
    const { f, calls } = fakeFetch([ok]);
    const p = createIceServerProvider({ keyId: 'kid', apiToken: 'tok', fetch: f });
    const servers = await p.get();
    expect(calls[0]!.url).toBe('https://rtc.live.cloudflare.com/v1/turn/keys/kid/credentials/generate-ice-servers');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    const urls = servers.flatMap((s) => s.urls);
    expect(urls.some((u) => u.includes(':53'))).toBe(false);
    expect(urls).toContain('turns:turn.cloudflare.com:443?transport=tcp');
    expect(servers.find((s) => s.username)).toMatchObject({ username: 'u', credential: 'c' });
    expect(servers.slice(-1)).toEqual(GOOGLE_STUN);
  });

  it('1時間は同じ接続情報を使い回し、Cloudflare を何度も呼ばない。同時に来ても1回だけ頼む', async () => {
    let t = 0;
    const { f, calls } = fakeFetch([ok]);
    const p = createIceServerProvider({ keyId: 'k', apiToken: 't', fetch: f, now: () => t });
    await Promise.all([p.get(), p.get(), p.get()]);
    t = 59 * 60_000;
    await p.get();
    expect(calls).toHaveLength(1);
    t = 61 * 60_000;
    await p.get();
    expect(calls).toHaveLength(2);
  });

  it('Cloudflare が失敗したら、前の接続情報（まだ有効なら）か STUN だけで続ける', async () => {
    let t = 0;
    const { f } = fakeFetch([ok, fail]);
    const p = createIceServerProvider({ keyId: 'k', apiToken: 't', fetch: f, now: () => t });
    const first = await p.get();
    t = 2 * 60 * 60_000;
    expect(await p.get()).toEqual(first);
    const { f: f2 } = fakeFetch([fail]);
    const p2 = createIceServerProvider({ keyId: 'k', apiToken: 't', fetch: f2 });
    expect(await p2.get()).toEqual(GOOGLE_STUN);
  });
});
