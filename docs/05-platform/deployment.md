# デプロイ手順（Cloud Run）

- Status: Accepted
- Owner: TBD
- Updated: 2026-11-08
- 関連：ADR-0003（サーバー権威・Cloud Run 1台）、`docs/02-architecture/overview.md`

## 構成

| 項目 | 値 |
|---|---|
| URL | https://idea-audition-852280753109.asia-northeast1.run.app （トップで「オーディションを作る」→ できたリンク `/a/<部屋 ID>` を参加者に送る） |
| GCP プロジェクト | `idea-audition`（請求先 VICTORY） |
| サービス | Cloud Run `idea-audition`（`asia-northeast1`） |
| 中身 | 1つのコンテナで、画面（`apps/web/dist`）と CAMP サーバー（`/camp`・`/voice`）を同じ URL から配る（`Dockerfile`） |
| 台数 | 最大1台（`--max-instances 1`）。待機は通常0台、本番前だけ1台（下記） |
| 接続の上限 | 60分（`--timeout 3600`、WebSocket 用）。セッションアフィニティ有効 |
| 実行アカウント | `idea-audition-run@idea-audition.iam.gserviceaccount.com`（Vertex AI 利用者・Firestore 利用者） |
| APIキー | 使わない（Vertex AI・Firestore はサービスアカウントで認証） |
| 入れる人 | 部屋のリンクを知っている人（合言葉は 2026-11-08 に廃止）。部屋を作るのは送り手ごとに1時間10回まで（`ROOMS_PER_HOUR`）、同時に置ける部屋は20まで（`MAX_LIVE_ROOMS`） |
| AI のモード | `AI_GATEWAY=gemini` なので Gemini と固定データの両方を選べる（既定は Gemini）。チーム向けの説明は `gemini-credits.md` |
| 環境変数 | `AI_GATEWAY=gemini`、`GOOGLE_CLOUD_PROJECT=idea-audition`、`GOOGLE_CLOUD_LOCATION=global`、`PERSISTENCE=firestore` |
| 保存先 | 本番は Firestore の `(default)` データベース。手元の開発は別のデータベース `dev-local`（`.env` の `FIRESTORE_DATABASE=dev-local`）。同じプロジェクト・同じ場所（asia-northeast1）だが、データは完全に別 |
| 予算アラート | 請求先 VICTORY に ¥3,000（クレジット $20 相当）、50%・90%・100% でメール通知（クレジット適用前の金額で判定） |

gcloud は IDEA AUDITION 用の設定 `victory` を使う。以下のコマンドはすべて先頭に `CLOUDSDK_ACTIVE_CONFIG_NAME=victory` を付けるか、先に `export` する。

```bash
export CLOUDSDK_ACTIVE_CONFIG_NAME=victory
```

## デプロイ

リポジトリ直下で実行する。**ビルド → デプロイの2段階**で行う（`--source` で一度に行うと、ビルドの途中で CLI が先に終わることがあったため）。

1. Cloud Build でイメージを作る（1〜2分）。タグはコミットの短いハッシュ：

```bash
gcloud builds submit --project idea-audition --region asia-northeast1 --tag asia-northeast1-docker.pkg.dev/idea-audition/cloud-run-source-deploy/idea-audition:$(git rev-parse --short HEAD) --quiet .
```

2. そのイメージを Cloud Run に出す：

```bash
gcloud run deploy idea-audition --image asia-northeast1-docker.pkg.dev/idea-audition/cloud-run-source-deploy/idea-audition:$(git rev-parse --short HEAD) --project idea-audition --region asia-northeast1 --service-account idea-audition-run@idea-audition.iam.gserviceaccount.com --allow-unauthenticated --max-instances 1 --min-instances 0 --timeout 3600 --session-affinity --cpu 1 --memory 1Gi --cpu-boost --set-env-vars "AI_GATEWAY=gemini,GOOGLE_CLOUD_PROJECT=idea-audition,GOOGLE_CLOUD_LOCATION=global,PERSISTENCE=firestore" --update-secrets "TURN_KEY_ID=turn-key-id:latest,TURN_KEY_API_TOKEN=turn-key-api-token:latest" --quiet
```

   - `--update-secrets` は通話の中継（Cloudflare の TURN）のキー。Secret Manager の `turn-key-id`・`turn-key-api-token` から渡す（サービスアカウントに読む権限を付けてある）。付け忘れると、通話は Google の STUN だけになり、テザリングや大学の Wi-Fi どうしで声が届かなくなる

3. 確認：`/health` が `ok` を返すこと、ログに `AI modes: gemini ..., fixture` と `persistence: firestore (database (default))`、`call relay: cloudflare turn` が出ること。トップで「オーディションを作る」とリンクができること。

```bash
curl -s https://idea-audition-852280753109.asia-northeast1.run.app/health
```

- URL の確認：

```bash
gcloud run services describe idea-audition --project idea-audition --region asia-northeast1 --format='value(status.url)'
```

## 部屋（リンク）

- ホストがトップで「オーディションを作る」を押すと、`POST /api/rooms` が部屋を作り、`/a/<部屋 ID>`（例 `/a/kqd-rmzw-tbe`）に移る。このリンクを参加者に送る。
- 部屋は作った時点で Firestore に保存されるので、デプロイや再起動のあとも同じリンクで入れる。誰もいない部屋は30分でメモリから片付ける。
- 合言葉は 2026-11-08 に廃止した。Cloud Run の `ACCESS_CODE` を外し（revision 00008）、Secret Manager の `idea-audition-access-code` も削除済み。

## 本番・リハーサルの前後

最初のアクセスの待ち時間（コールドスタート）をなくすため、本番とリハーサルの前だけ1台を常に起動しておく。終わったら0台に戻す（起動しっぱなしは費用がかかる）。

```bash
gcloud run services update idea-audition --project idea-audition --region asia-northeast1 --min-instances 1
```

```bash
gcloud run services update idea-audition --project idea-audition --region asia-northeast1 --min-instances 0
```

## ログ

```bash
gcloud run services logs read idea-audition --project idea-audition --region asia-northeast1 --limit 50
```

- `[ai] ... ok XXXms` で Gemini の待ち時間、`[proposal] ready` で企画書、`session restored` で再起動からの復元を確認できる。

## 注意

- ヘルスチェックは `/health`。Cloud Run は z で終わるパス（`/healthz` など）を予約しているので使わない。
- 以前は `gcloud run deploy --source .` で一度にデプロイしていたが、ビルドの途中で CLI が先に終わることがあったため、上の2段階に変えた（2026-11-08）。

- **最大1台が前提**（セッションの正本はメモリのアクター、ADR-0003）。台数を増やすとセッションが分かれるので増やさない。
- デプロイやインスタンスの入れ替えで接続が切れても、画面は自動で再接続し、Firestore から状態を戻す。
- マイク（音声入力）は https でのみ使える。Cloud Run の URL は https なので、どの PC からでも使える。
