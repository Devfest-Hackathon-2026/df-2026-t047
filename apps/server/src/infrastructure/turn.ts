/**
 * 通話（WebRTC）の経路探しに使うサーバー（ICE サーバー）の一覧を渡す。
 *
 * ブラウザどうしが直接つながらない回線（テザリング・大学や会社の Wi-Fi など）では、間で音声を中継する TURN が要る。
 * Cloudflare の TURN を使い、長く使えるキー（TURN_KEY_ID / TURN_KEY_API_TOKEN）はサーバーだけが持ち、
 * ブラウザには数時間で切れる接続情報だけを渡す（https://developers.cloudflare.com/realtime/turn/generate-credentials/）。
 * キーが無ければ、今まで通り Google の STUN だけを返す（直接つながる回線ならこれで足りる）。
 */

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface IceServerProvider {
  /** TURN が使えるか（ログ用） */
  readonly turn: boolean;
  get(): Promise<IceServer[]>;
}

export const GOOGLE_STUN: IceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

/** 接続情報の有効期間。長い審査でも切れないようにする */
const CREDENTIAL_TTL_S = 6 * 60 * 60;
/** 同じ接続情報を配り続ける時間（有効期間より十分短く。通話の途中で切れないように） */
const REUSE_MS = 60 * 60 * 1000;

export function createIceServerProvider(opts: {
  keyId?: string;
  apiToken?: string;
  fetch?: typeof fetch;
  now?: () => number;
  log?: (m: string, e?: unknown) => void;
}): IceServerProvider {
  const { keyId, apiToken } = opts;
  if (!keyId || !apiToken) return { turn: false, get: async () => GOOGLE_STUN };
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  let cached: { at: number; servers: IceServer[] } | null = null;
  let inflight: Promise<IceServer[]> | null = null;

  const generate = async (): Promise<IceServer[]> => {
    const res = await doFetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl: CREDENTIAL_TTL_S }),
    });
    if (!res.ok) throw new Error(`cloudflare turn ${res.status}`);
    const body = (await res.json()) as { iceServers?: IceServer[] };
    const servers = (body.iceServers ?? [])
      .map((s) => ({ ...s, urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)) }))
      .filter((s) => s.urls.length > 0);
    if (!servers.some((s) => s.urls.some((u) => u.startsWith('turn')))) throw new Error('cloudflare turn: no TURN urls');
    // Cloudflare の STUN に加え、Google の STUN も残す（片方に届かない回線でも経路を探せるように）
    return [...servers, ...GOOGLE_STUN];
  };

  return {
    turn: true,
    async get() {
      if (cached && now() - cached.at < REUSE_MS) return cached.servers;
      inflight ??= generate()
        .then((servers) => {
          cached = { at: now(), servers };
          return servers;
        })
        .catch((e) => {
          opts.log?.('TURN credentials failed (fallback to STUN only)', e);
          // 取れなかったら、前の接続情報がまだ有効ならそれを、無ければ STUN だけを返す
          return cached && now() - cached.at < CREDENTIAL_TTL_S * 1000 - REUSE_MS ? cached.servers : GOOGLE_STUN;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
  };
}
