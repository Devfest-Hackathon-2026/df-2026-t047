import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { OAuth2Client } from 'google-auth-library';

const run = promisify(execFile);

/**
 * GCP の認証クライアント（Vertex AI と Firestore で共用）。
 * - Cloud Run：null を返し、各 SDK がサービスアカウントの認証（ADC）を自動で使う
 * - ローカル開発：LOCAL_GCLOUD_CONFIG（gcloud の設定名）のログインでトークンを取得・更新する。
 *   マシン全体の ADC を上書きせず、トークンをファイルにも残さない
 * - GOOGLE_OAUTH_ACCESS_TOKEN：一時的にトークンを直接渡す場合（約1時間で切れる）
 */
export function localAuthClient(env: NodeJS.ProcessEnv): OAuth2Client | null {
  const gcloudConfig = env.LOCAL_GCLOUD_CONFIG;
  if (gcloudConfig) {
    const client = new OAuth2Client();
    client.refreshHandler = () => gcloudAccessToken(gcloudConfig);
    return client;
  }
  if (env.GOOGLE_OAUTH_ACCESS_TOKEN) {
    const client = new OAuth2Client();
    client.setCredentials({ access_token: env.GOOGLE_OAUTH_ACCESS_TOKEN });
    return client;
  }
  return null;
}

async function gcloudAccessToken(configName: string) {
  // print-access-token は手元に残っている古いトークン（残り数分のこともある）を返すことがあり、
  // 有効期限が分からないまま使うと、切れたあとも更新されず 401 になる。
  // config-helper で新しいトークンと本当の有効期限を受け取り、その5分前に更新する
  const { stdout } = await run('gcloud', ['config', 'config-helper', '--format=json', '--force-auth-refresh'], {
    env: { ...process.env, CLOUDSDK_ACTIVE_CONFIG_NAME: configName },
  });
  const { credential } = JSON.parse(stdout) as { credential: { access_token: string; token_expiry?: string } };
  const expiry = credential.token_expiry ? Date.parse(credential.token_expiry) : Date.now() + 30 * 60_000;
  return { access_token: credential.access_token, expiry_date: expiry - 5 * 60_000 };
}
