# Gemini（クレジット）の使い方 — チーム向け

- Owner: 牧 夢斗
- Updated: 2026-11-08

## まず知っておくこと

- Gemini は、GCP プロジェクト `idea-audition` を通して呼んでいます。料金は請求先 **VICTORY** に付き、ハッカソンでもらった **$20 のクレジット**から引かれます。**チーム全員で共有の財布**です。
- 予算アラートは ¥3,000（$20 相当）。50%・90%・100% で夢斗にメールが届きます。**自動で止まるわけではない**ので、使い方で節約します。
- アプリには **AI のモード**があり、いつでも切り替えられます。
  - **AI：Gemini**：本物の Gemini で案・改良・批評・回答・合意台帳・企画書を作る。**クレジットを使う**
  - **固定データ（無料）**：あらかじめ用意した案で動く。UI・アニメーション・操作の確認や、デモの練習向け
  - 切り替え方：開始画面の「AI：Gemini／固定データ（無料）」で選ぶ。審査の途中でも、ホストがヘッダー右上のバッジを押して切り替えられる

## 使い方は2通り

### A. 本番の URL で使う（設定いらず）

1. https://idea-audition-852280753109.asia-northeast1.run.app を開き、「オーディションを作る」で部屋を作る（できたリンクを送れば、他の人も同じ部屋に入れる）
2. 開始画面で「AI：Gemini」を選んで始める

これだけでクレジットを使った動作を試せます。プロンプトを変えて試したいときは B へ。

### B. 手元の開発で Gemini を使う（AI の精度を改善したい人向け）

**1. 夢斗に権限をもらう**
GitHub と同じでなくてよいので、**Google アカウントのメール**を夢斗に送る。夢斗が次を実行します。

```bash
scripts/grant-dev-access.sh member@example.com
```

付く権限は「Vertex AI の利用者」と「API 利用をこのプロジェクトに付ける」だけです（本番のサーバーや Firestore の設定は触れません）。

**2. gcloud を入れて、IDEA AUDITION 用の設定を作る**（自分の Mac で1回だけ）

[Google Cloud CLI](https://cloud.google.com/sdk/docs/install) を入れてから：

```bash
gcloud config configurations create idea-audition
```

```bash
gcloud auth login
```

```bash
gcloud config set project idea-audition
```

ほかの GCP プロジェクトを使っている人も、設定を分けているので影響しません。`gcloud auth application-default login` は**しなくてよい**です（アプリは下の `LOCAL_GCLOUD_CONFIG` で上の設定のログインを使います）。

**3. リポジトリ直下に `.env` を作る**（コミットされません）

```bash
AI_GATEWAY=gemini
GOOGLE_CLOUD_PROJECT=idea-audition
GOOGLE_CLOUD_LOCATION=global
LOCAL_GCLOUD_CONFIG=idea-audition
# 手元では保存しない（本番の Firestore にテストのセッションが混ざらないように）
# 保存も試したいときは PERSISTENCE=firestore と FIRESTORE_DATABASE=dev-local（開発用のデータベース。本番の (default) には絶対に向けない。権限は夢斗に頼む）
PERSISTENCE=none
# 下段の入れ替えが速いと Gemini を何度も呼ぶので、精度の確認中は止めてもよい
# ROTATION=off
```

**4. 起動する**

```bash
pnpm install
```

```bash
pnpm dev
```

http://localhost:5173 を開き、開始画面で「AI：Gemini」を選ぶ。ターミナルに `[ai] generateIdeas ok 1500ms model=...` のように、呼び出しごとの時間が出ます。

## 費用の目安と節約のルール

1回あたりの費用はごく小さく、通しのデモ1回で数円〜数十円の見込みです（実測ではない目安）。ただし $20 を全員で使うので、次を守ってください。

- **UI・アニメーション・操作の作業は「固定データ」で**。Gemini は AI の出力を見たいときだけ
- 精度の確認中は `ROTATION=off` にして、下段の自動入れ替え（そのたびに新しい案を作る）を止める
- **マイクは話すときだけ ON**（ON の間は音声認識の料金がかかる）
- 本番の常時起動（`--min-instances 1`）は夢斗がリハーサル・本番の前だけ入れる。勝手に入れない
- 使った量は夢斗が [請求レポート](https://console.cloud.google.com/billing) で確認する。気になったら聞く

## AI の精度を改善するときの手がかり

| 何を変えたいか | 場所 |
|---|---|
| 案・改良・批評・回答・合意台帳・企画書のプロンプト | `apps/server/src/infrastructure/gemini/gemini-gateway.ts` |
| 使うモデル・思考の深さ・待ち時間の上限 | `.env` の `GEMINI_MODEL_FAST` / `GEMINI_MODEL_REFINE` / `GEMINI_THINKING_*` / `GEMINI_TIMEOUT_*`（`.env.example` 参照） |
| LLM に渡す「審査の文脈」（合意台帳） | `apps/server/src/application/consensus-context.ts`、`renderContext`（`gemini-gateway.ts`） |
| 固定データ（比較の基準・デモ用） | `apps/server/src/infrastructure/fixture/fixture-gateway.ts` |
| 設計の背景 | `docs/adr/ADR-0005`（AI）、`ADR-0007`（合意台帳）、`ADR-0008`（企画書） |

- 同じテーマで「固定データ」と「Gemini」を切り替えて比べると、改善の効果が分かりやすいです。
- プロンプトを変えたら `pnpm test` を通してください（Gemini を呼ばない偽のクライアントで、出力の形の検証をテストしています）。
- テストユーザーからは「意外性が少ない」という声がありました（docs/backlog に起票予定）。キャラごとの発想のくせ、ワイルドカード枠、ひねりの注入などが改善候補です。

## 権限を外すとき

```bash
scripts/grant-dev-access.sh member@example.com --revoke
```
