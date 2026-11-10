# IDEA AUDITION

AIがプレゼン。あなたが審査員。— アイデア出しをオーディション審査で終わらせる企画案決めツール。

- **本番**：https://idea-audition-852280753109.asia-northeast1.run.app （トップで「オーディションを作る」→ リンクを送って一緒に審査）
- **機能の一覧（完成形と今の状態）**：[docs/00-product/feature-status.md](docs/00-product/feature-status.md)
- **構成図**：[docs/02-architecture/system-map.html](docs/02-architecture/system-map.html)
- **CAMP（自作のプロトコル、OSS）**：[github.com/camp-protocol/camp](https://github.com/camp-protocol/camp)、npm [`@camp-protocol/kit`](https://www.npmjs.com/package/@camp-protocol/kit)。仕組みの説明は [docs/protocol/camp-guide.pdf](docs/protocol/camp-guide.pdf)
- **提出物**：[プロダクト説明](docs/submission/product-description.md)・[著作物利用シート](docs/submission/credits.md)
- 設計資料は [docs/README.md](docs/README.md)。実装計画は [docs/implementation-plan.md](docs/implementation-plan.md)

## 遊び方

1. ホストが部屋を作り、テーマ・持ち時間（15〜90秒）・合格者の人数（1〜4人）を決めてリンクを送る（審査員は4人まで。5人目からは聞くだけ）
2. **予選**：AI キャラが1人ずつ企画をプレゼン。気になったら話しかけて深掘り（その間は時間が止まる）。全員がゴールデンブザーを押したら合格
3. **決勝**：合格した案どうしが批評し合い、改良していく。注目したいキャラをタップして質問・改善を頼む。前の版にも戻せる
4. **優勝**：投票で決めると、企画書がすぐ出る（PDF・文章コピー・共有）

話した内容は合意メモ（賛成・反対した人と人数）にまとまり、次の案づくりに使われます。審査員どうしは声と顔（ワイプ）でつながり、マイク・相手の声・効果音はどの場面でもヘッダーで切り替えられます。ヘッダーの切り替えで、同じ仕組みのまま会議ツールの画面（オフィシャル会議モード）にもできます。

## 使っている Google の技術

Cloud Run（画面・WebSocket・音声の中継を1つのコンテナで）、Vertex AI の Gemini（3.5 Flash：案・回答・合意・発言の仕分け／3.8 Flash：改良・批評・企画書／Live：文字起こし／Embedding：似た案と好み／画像：企画書のイメージ）、Firestore（続きから再開）、Secret Manager、Cloud Build・Artifact Registry。API キーは持たず、サービスアカウントで認証します。

## 構成

```text
apps/web          React + TypeScript + Vite（ステージUI、CAMPクライアント、通話、声の入力）
apps/server       Node.js + TypeScript（セッションアクター、CAMP の WebSocket 終端、Gemini、音声の中継、通話の接続情報）
packages/camp     CAMP 本体（@camp-protocol/kit：人の操作と AI の結果を1つの順番で確定するプロトコル）
packages/protocol IDEA AUDITION の語彙（Command・Event・snapshot の形、キャラ素材カタログ）
```

## 起動

Node.js 22 以上と pnpm 10 以上を使います。

```bash
pnpm install
pnpm dev
```

- Web: http://localhost:5173 （`/camp` を Vite が server の 8787 番へプロキシ）
- Server: ws://localhost:8787/camp、ヘルスチェック http://localhost:8787/health
- トップの「オーディションを作る」で部屋のリンク（`/a/xxx-xxxx-xxx`）ができます。同じリンクを別のタブや端末で開くと、一緒に審査できます
- 審査員は1つの部屋に4人まで。5人目以降は観覧モード

AI は既定で固定データ（`FixtureGateway`）を使うので、GCP の権限が無くても全機能を試せます。

- **AI のモード**：本番は Gemini で固定です。開発サーバーでは、部屋の URL に `?ai=fixture` を付けると固定データ（Gemini を呼ばない）で始められます（Gemini はサーバーが `AI_GATEWAY=gemini` のときだけ使える）。
- **通話の中継（TURN）**：`.env` に Cloudflare の `TURN_KEY_ID`・`TURN_KEY_API_TOKEN` を入れると、直接つながらない回線でも声が届きます。無ければ Google の STUN だけで通話します。
- **手元で Gemini を使う・クレジットの使い方**：[docs/05-platform/gemini-credits.md](docs/05-platform/gemini-credits.md)
- **デプロイ手順**：[docs/05-platform/deployment.md](docs/05-platform/deployment.md)
- 設定の一覧は `.env.example`。

## テスト・ビルド

```bash
pnpm test
pnpm typecheck
pnpm build
```

## 素材のクレジット

全体の一覧は [著作物利用シート](docs/submission/credits.md)。

| 素材 | 使っている場所 | 出典・ライセンス |
|---|---|---|
| 効果音「タイマー02」（Timbre1・10秒版の最後の3.4秒を切り出し、終わりにフェードアウトを加えたもの） | 予選の残り3秒のカウントダウン（`apps/web/public/sfx/countdown-last3.mp3`） | [OtoLogic](https://otologic.jp/free/se/countdown01.html)（[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja)） |

そのほかの効果音（ブザー・合格・見送り・優勝）は、音のファイルを使わず、ブラウザでその場で作っている（`apps/web/src/shared/sfx.ts`）。
