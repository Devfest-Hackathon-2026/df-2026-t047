# 実装計画（P0、締切 2026-11-10）

- Status: Proposed（実装開始の明示的な指示を待つ）
- Owner: TBD
- Updated: 2026-11-07
- 前提：ADR-0001〜0005（Accepted）、acceptance-criteria.md、open-questions.md（Q1〜Q5回答済み）

> 本計画は「何を・どの順で・どのファイルに」作るかの合意用。**実装は「実装して」の明示指示を受けてから着手する**。

## 1. 範囲

### P0（必ず作る）

| # | 機能 | 受け入れ条件 |
|---|---|---|
| 1 | テーマ入力 → セッション開始（ソロ／複数人、ホスト） | AC-32 |
| 2 | 下段5体の発表（キャラ＋フリップ）、先読みストックからの補充 | AC-01〜03 |
| 3 | キャラ本体のドラッグ昇格（クリックとドラッグの判別、拒否時に元の位置へ戻る、満席なら拒否） | AC-05〜07, 11, 13 |
| 4 | 上段で目に見える進化（元案→批評2〜3ラウンド→改善点→改良版、版の履歴） | AC-20〜24, 26, 27 |
| 5 | 4台の同期（カーソル、昇格、補充）、二重昇格の防止、再接続 | AC-30, 31 |
| 6 | 深掘り：キャラをクリックして質問、上段への改善指示 | AC-14 |
| 7 | 音声：Gemini Live＋テキスト入力（代わりの手段） | ADR-0005 §7 |
| 8 | 最終決定：ソロはクリック、複数人は投票、同票はホスト | AC-35〜37 |
| 9 | 優勝演出（スポットライト・クラウン・紙吹雪） | 22.7 |
| 10 | `FixtureGateway` だけで通しデモができる | AC-33 |
| 11 | Cloud Run（server）＋Firebase Hosting（web）へのデプロイ | 19.1 1a |

### P0から外すもの（余裕があればP1）

上段満席時の入れ替え（Q1のP1）、Idea BOXからの要素の継承（AC-25。落選案の保存と一覧表示まではP0に含める）、顔ワイプ、キャラのリグ付け、動画AIの演出、スマホ対応。

### 遅れたときに削る順番

1. 相互批評を2〜3ラウンドから1ラウンドに減らす
2. Idea BOXの一覧表示
3. 投票の細部（票の変更・ホスト交代）を簡略化する
4. Gemini Liveをテキスト入力＋押して話す方式に落とす
5. Firestoreへの追記を止め、メモリだけで動かす（再接続はサーバーが生きている間だけ）

**削らないもの**：下段5体 → ドラッグ昇格 → 上段で目に見えて進化、のコア体験（付録A §8）。

## 2. 技術の確定事項（ADRで未確定だった細部）

| 領域 | 採用 | 備考 |
|---|---|---|
| パッケージ管理 | pnpm workspaces | |
| Web | Vite + React + TypeScript | |
| スタイル | CSS Modules + CSS変数（デザイントークン） | ネオンやグローの細かい指定が多いため。Tailwindは使わない |
| 動き | Motion（`motion/react`） | |
| クライアントの状態 | Zustand。**業務状態のストアと表示状態のストアを分ける** | ADR-0002 |
| 契約 | Zod（`packages/protocol`） | |
| Server | Node.js + TypeScript、WebSocketは `ws` | Cloud Run（max=1, min=1） |
| 生成AI | Google Gen AI SDK（`@google/genai`、要確認） | モデル名は初日の試作で決める |
| 永続化 | Firestore（firebase-admin） | |
| テスト | Vitest（ドメイン・プロトコル）、Playwright（2ブラウザの同時操作） | |

## 3. 日程

時刻は目安。各マイルストーン（M）で全員の作業を合わせる。

### Day 0：11/7（今夜）— 土台と契約

- リポジトリの初期化（`git init`、pnpm workspaces、tsconfig、lint）
- `packages/protocol`：エンベロープ、Command / Event / Ephemeral / Snapshot、拒否理由コードを**決めて固める**
- ドメインの型：Session、CharacterInstance、Idea、Revision、StagePlacement、Vote
- キャラ素材の生成を始める（12〜16体×3ポーズ、透過WebP）
- **M0**：web と server が protocol を import してビルドが通る

### Day 1：11/8 — 試作と縦の一本通し（Fixtureのみ）

| 時間帯 | 内容 |
|---|---|
| 午前 | 試作：①Gemini Liveで日本語（1台→2台）②Cloud Run + WS（4台、再接続）③同時ドラッグ ④キャラの動き(a)(b)(c) ⑤構造化出力の待ち時間 |
| 午後 | セッションアクター＋昇格・補充・定員・一意性のドメイン（テストつき）。ステージUI（下段5体、上段リング、フリップ、ドラッグ） |
| 夜 | `FixtureGateway` で、下段→昇格→補充→上段に固定データの改良版が出るまでをつなぐ |

- **M1（昼）**：試作①〜⑤の結果を記録し、続行か代わりの手段かを判断する
- **M2（夜）**：ローカルの2ブラウザで、Fixtureを使って昇格・補充・上段の表示が同期する

### Day 2：11/9 — 本物のAI・音声・投票

| 時間帯 | 内容 |
|---|---|
| 午前 | GeminiGateway：下段の案の生成、上段の改良と相互批評（一括生成）。優先度つきキュー、先読みストック、古い応答の破棄 |
| 午後 | 上段の見せ方：吹き出しを順に出す → 改善点のハイライト → フリップの新しい版。深掘り（質問と指示） |
| 午後 | Gemini Liveの組み込み、テキスト入力への切り替え |
| 夜 | 投票・同票・優勝演出。Firestoreへの追記と再接続時の復元。Cloud Run と Firebase Hosting へ初回デプロイ |

- **M3（昼）**：本物のGeminiで、上段の進化が通しで見える
- **M4（夜）**：デプロイした環境で、4台でテーマ設定から優勝まで完走する

### Day 3：11/10 — 仕上げとリハーサル

- 午前：見た目の仕上げ（参照画像と並べて比較）、1366×768 と 1920×1080 での確認、reduced-motion
- 昼：**機能凍結**。以降はバグ修正だけ
- 午後：4台で通しリハーサルを3回以上（うち1回は Fixture モード、1回はLiveを切ってテキストだけ）。ピッチ資料と計測記録（生成の待ち時間、同期のp95）
- **M5**：提出

## 4. 担当（ADR-0002の目安を日程に当てはめたもの）

| 担当 | Day 0 | Day 1 | Day 2 | Day 3 |
|---|---|---|---|---|
| A：ステージUI | トークン、舞台の骨組み | 下段・上段・フリップ・ドラッグ | 上段の進化の見せ方、優勝演出 | 見た目の仕上げ |
| B：サーバー・同期 | protocol を固める | アクター、昇格・補充、WS、再接続 | 投票、Firestore、デプロイ | 負荷・切断のテスト |
| C：AI・音声 | Gemini と Live の接続確認 | 試作①⑤、FixtureGateway | GeminiGateway、キュー、Live の組み込み | プロンプトの調整 |
| D：素材・仕上げ | キャラ素材の生成 | 試作④、素材の切り抜きと書き出し | フリップの文言、テーマ例、ピッチ | リハーサルの進行と記録 |

3人の場合はDの作業をAとCで分ける。

## 5. 作るファイル（初期の骨組み）

```text
idea-audition/
├── package.json / pnpm-workspace.yaml / tsconfig.base.json
├── .gitignore / .env.example          # 秘密情報は .env に置き、コミットしない
├── packages/protocol/src/
│   ├── envelope.ts  commands.ts  events.ts  ephemeral.ts  snapshot.ts  reasons.ts  index.ts
│   └── fixtures/                      # 契約テスト用
├── apps/server/
│   ├── Dockerfile
│   └── src/
│       ├── main.ts
│       ├── domain/        session.ts  character.ts  idea.ts  revision.ts  stage.ts  vote.ts  events.ts
│       ├── application/   ports.ts  session-actor.ts  usecases/（promote, refill, refine, ask, vote …）
│       ├── infrastructure/ gemini/  live-token/  firestore/  fixture/  ids.ts  clock.ts
│       └── presentation/  ws-server.ts  http.ts
├── apps/web/
│   ├── public/assets/characters/      # 透過WebP（キャラごとのフォルダ）
│   └── src/
│       ├── app/           main.tsx  App.tsx
│       ├── net/           camp-client.ts（再接続・lastSeq）
│       ├── store/         session-store.ts（業務状態）  display-store.ts（表示状態）
│       ├── features/      audition/  candidate-inspection/  finalist-refinement/  collaboration/  champion/  voice/
│       ├── scene/         Stage  LowerStage  FinalRing  CharacterActor  FlipBoard  JudgeCursor  RefinementDiff  Spotlights
│       └── shared/        tokens.css  ui/
└── tests/e2e/                         # Playwright：2ブラウザで同時に操作
```

## 6. 着手前にユーザー・チームが用意するもの

| 項目 | 担当 | 備考 |
|---|---|---|
| `git init` と GitHub リポジトリの作成の許可 | ユーザー | |
| GCP プロジェクト、Gemini API の有効化、APIキー | チーム | キーは Secret Manager か `.env` に置き、チャットやコミットに貼らない |
| Firebase プロジェクト（Hosting と Firestore） | チーム | |
| Cloud Run のデプロイ権限 | チーム | |
| キャラ素材の生成ツールの決定と利用規約の確認 | D | |
| 締切の時刻と、提出物（URL、動画、資料）の確認 | ユーザー | |

## 7. 完了の判断

- acceptance-criteria.md の AC のうち、P0の範囲がすべて満たされている。
- デプロイした環境で、4台の通しリハーサルが3回連続で止まらずに完走する。
- Fixture モードとテキストだけのモードでも完走する。
- 計測記録が残っている：生成の待ち時間（p50/p95）、昇格確定までの時間（p95）、FPS。

## 8. 進捗（2026-11-07 夜）

**M0・M2 相当まで完了**（Day 0 の土台＋ Day 1 の縦の一本通しを、固定データで先に実装）。

| 項目 | 状態 | 確認方法 |
|---|---|---|
| pnpm workspaces、protocol / server / web の3パッケージ | 完了 | `pnpm typecheck` `pnpm build` |
| CAMP v1 契約（Command / Event / Ephemeral / Hello / Welcome / Result、拒否理由コード） | 完了 | protocol のテスト4件 |
| ドメイン：下段5体・上段最大3体・一意性・補充デザインの選び方・Revision・投票・ホスト | 完了 | server のテスト（ドメイン15件） |
| セッションアクター：直列処理、重複排除、先読みストック、改良キュー、批評を順に配信、古い結果の破棄 | 完了 | server のテスト（アクター8件） |
| FixtureGateway（学食テーマは mock-app のデータを流用） | 完了 | 外部APIなしで通しデモ |
| Web：開始画面、2層ステージ、キャラ本体のドラッグ昇格（拒否時は元の位置へ戻る）、上段へ飛ぶ演出、新キャラの登場、上段の改良表示（元の案・残す強み・改善ポイント・版）、相互批評の吹き出し、深掘り（質問・改善依頼）、Idea BOX、投票・同票・優勝画面、共有カーソル、つかみ中の表示、再接続 | 完了 | ブラウザで 1366×768 / 1920×1080、2タブ同時に確認 |
| GeminiGateway（Vertex AI、失敗時は固定データ） | 完了 | テスト5件＋実際の Gemini でアプリから通し確認 |
| Gemini Live の音声入力（サーバー中継、名前で宛先、テキスト入力を併設） | 完了（実マイクは未確認） | 合成音声で質問・指示の両方を確認、テスト7件 |
| 下段の入れ替え（注目度・会話での言及・10秒カウントダウン・BOX への演出）と見送り（×・詳細・発言） | 完了 | テスト15件、ブラウザで予告・取り消し・言及バッジ・見送りを確認 |
| 合意台帳（会話の論点・賛否の時系列・合意の反映・作り置きの作り直し・合意メモ） | 完了 | テスト11件、本物の Gemini で合意→反映→意見の変更を確認 |
| 企画書＋審査レポートの PDF（優勝で自動作成、ダウンロードボタン） | 完了 | テスト3件、本物の Gemini で4ページの PDF を確認 |
| AI のモード切り替え（Gemini / 固定データ）とチーム向けクレジット利用ガイド | 完了 | テスト3件、ブラウザで固定データ→Gemini の切り替えを確認 |
| Firestore への保存・再起動からの復元 | 完了 | ローカルで再起動して復元を確認、テスト3件 |
| Cloud Run へのデプロイ（Dockerfile、専用サービスアカウント、合言葉は Secret Manager、予算アラート） | 完了（2026-11-08） | 本番URLで画面の配信・合言葉の拒否・起動ログを確認。Gemini/Firestore の本番動作は合言葉を入れての確認待ち |
| Playwright による2ブラウザ同時操作の自動テスト | 未着手 | — |

### 実装中に決めたこと（ADRへの補足）

- **Event は適用後の snapshot を同梱する**。クライアントは状態を再計算せず置き換えるだけにし、`type` と `detail` は演出にだけ使う（判定ロジックをクライアントに持たない、ADR-0002）。snapshot が大きくなったら差分配信を検討する。
- **`promoting` 状態は外に出さない**。昇格はサーバーの1回の同期処理で `lower → upper` まで確定するため。移動中の見た目はクライアントの表示状態（飛行アニメーション）で表現し、その間は上段側を非表示にして二重表示を防ぐ。
- **相互批評は「1ラウンド＝1つの吹き出し」**（R1 A→B、R2 B→A、R3 …）。2体なら2ラウンド、3体なら3ラウンド。吹き出しの配信間隔はサーバーが決め、全員が同じタイミングで見る。
- **下段の入れ替え**は注目度ベースに変更（ADR-0006）。会話での言及・カーソル・詳細・質問・つかむ操作で注目度が上がり、しばらく触れられていない案のうち最も注目度の低い案から、予告つきで退場する。
- 開発時のサーバーポートは `CAMP_PORT`（既定 8787）。Cloud Run では `PORT` を使う。

### 既知の課題

- キャラ素材が8体しかないため、上段3体＋下段5体が埋まった状態で入れ替えると、退場したキャラと同じデザインが戻ることがある（Q2の目標 12〜16体で解消）。
- 素材のスプライト画像の縁に、生成時のマゼンタのにじみが少し残っている。
- 質問か改善指示かの判定は、Gemini に置き換えるまで正規表現の仮実装。
