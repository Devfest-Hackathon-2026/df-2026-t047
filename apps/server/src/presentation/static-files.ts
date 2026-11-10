import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/**
 * 本番で web のビルド結果（apps/web/dist）を同じサーバーから配る。
 * - ファイル名にハッシュが付く /assets/* は長期キャッシュ（CDN・ブラウザ、overview.md のキャッシュ表）
 * - index.html はキャッシュしない（デプロイ後すぐ新しい版になるように）
 * - 存在しないパスは index.html を返す（?s=xxx などの URL で開けるように）
 */
export function createStaticHandler(dir: string) {
  const root = resolve(dir);
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    const candidate = resolve(join(root, normalize(urlPath)));
    if (candidate !== root && !candidate.startsWith(root + sep)) return false; // ディレクトリの外は返さない
    const file = (await isFile(candidate)) ? candidate : join(root, 'index.html');
    if (!(await isFile(file))) return false;
    const isAsset = urlPath.startsWith('/assets/') && file === candidate;
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
    return true;
  };
}

async function isFile(p: string) {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}
