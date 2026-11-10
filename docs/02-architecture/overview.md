# アーキテクチャ概要

- Status: Accepted（ADR-0001〜0005 をまとめた全体図）
- Owner: TBD
- Updated: 2026-11-09

本番：https://idea-audition-852280753109.asia-northeast1.run.app （Cloud Run。トップで「オーディションを作る」→ できたリンク `/a/<部屋 ID>` を送る。手順は `docs/05-platform/deployment.md`）。ここに書くのは完成形の姿。まだ作っている途中のものは「予定」と書く（一覧は `docs/00-product/feature-status.md`）。

## 全体図

```text
 ┌──────────── ブラウザ（審査員PC × 最大4台、5人目からは観覧）────────┐
 │  React + TypeScript + Vite                                       │
 │  ├ 画面：予選・決勝・キャラ・合意メモ（CSS Modules + Motion）       │
 │  ├ 状態：Zustand                                                  │
 │  │   ├ サーバーから届いた状態の写し（判定はしない）                 │
 │  │   └ 表示用の状態（移動演出・吹き出し・カーソル）                 │
 │  ├ 通信：CAMPクライアント（再接続・未確定の操作の再送）              │
 │  ├ 音声：マイク → 16kHz PCM（AudioWorklet）→ /voice                │
 │  └ 通話：WebRTC（ブラウザどうし直接。マイクは文字起こしと共有）      │
 └──────┬───────────────────────┬─────────────────┬─────────────────┘
        │ HTTPS：画面・部屋づくり │ WebSocket        │ 声（WebRTC）
        │ ・GET /api/ice          │ /camp（操作）    │ 直接つながらない
        │                        │ /voice（音声）   │ ときだけ中継
        ▼                        ▼                 ▼
 ┌────────────────────────────────────────┐  ┌──────────────────────┐
 │ Cloud Run（Node.js + TS、インスタンス1台） │  │ Cloudflare TURN        │
 │  ┌──────────────────────────────────┐  │  │ （Google Cloud の外）   │
 │  │ 画面の配信・部屋づくり・通話の鍵渡し  │──┼─▶│ 数時間で切れる接続情報  │
 │  │ WebSocket の窓口（/camp・/voice）   │  │  └──────────────────────┘
 │  └────────────────┬─────────────────┘  │   Google STUN：通話の経路探し
 │  ┌────────────────▼─────────────────┐  │
 │  │ セッションアクター（部屋ごと）       │  │
 │  │  ・操作を1件ずつ順に処理            │  │
 │  │  ・ステージのルール（ドメイン）      │  │
 │  │    ブザーの全員一致・持ち時間・決勝   │  │
 │  │  ・発言の仕分け・合意台帳・好み     │  │
 │  │  ・メモリ上の最新状態               │  │
 │  └───┬──────────────────────┬───────┘  │
 │  ┌───▼──────────┐ ┌─────────▼────────┐ │
 │  │ AIの差し替え口 │ │ 記録の差し替え口  │ │
 │  │ Gemini / 固定  │ │ Firestore        │ │
 │  └───┬──────────┘ └─────────┬────────┘ │
 └──────┼──────────────────────┼──────────┘
        ▼                      ▼
 ┌──────────────────────────┐ ┌──────────────────────┐
 │ Gemini（Vertex AI）        │ │ Firestore（東京）       │
 │ 3.5 Flash：案・回答・合意・  │ │ 確定イベントの記録      │
 │   発言の仕分けと言い直し     │ │ 最新のセッション状態    │
 │ 3.8 Flash：改良・相互批評・  │ └──────────────────────┘
 │   企画書                   │  Secret Manager：TURN のキーだけ
 │ Live：文字起こし（予定：声の │
 │   調子）・Embedding：似た案  │
 └──────────────────────────┘
 APIキーは持たない（Cloud Run のサービスアカウントで Vertex AI を認証）
```

コード上の対応：

| 図の箱 | 場所 |
|---|---|
| 画面・表示用の状態 | `apps/web/src/scene`（`PreliminaryStage.tsx`・`FinalStage.tsx`）、`apps/web/src/features`、`apps/web/src/store/display-store.ts` |
| サーバー状態の写し | `apps/web/src/store/session-store.ts` |
| CAMPクライアント | `apps/web/src/net/camp-client.ts` |
| 通話 | `apps/web/src/features/call/`（WebRTC）、`apps/server/src/infrastructure/turn.ts`（`GET /api/ice` の接続情報） |
| 通信の型（共有） | `packages/protocol` |
| CAMP の実装 | `packages/camp`（@camp-protocol/kit） |
| WebSocket の窓口・部屋づくり・`/api/ice` | `apps/server/src/presentation/ws-server.ts` |
| セッションアクター | `apps/server/src/application/session-actor.ts` |
| ステージのルール | `apps/server/src/domain/`（`session.ts` にブザー・持ち時間・一時停止・決勝の人数） |
| 差し替え口（ポート） | `apps/server/src/application/ports.ts` |
| 固定データのAI | `apps/server/src/infrastructure/fixture/` |
| 音声の中継・文字起こし | `apps/server/src/presentation/voice-server.ts`、`apps/server/src/infrastructure/gemini/live-transcriber.ts`、`apps/web/src/features/voice/` |
| 発言の仕分け・言い直し | `apps/server/src/application/session-actor.ts`（`triageThenProcess`）、`apps/server/src/domain/transcript-repair.ts`（語彙で聞き間違いを直す） |
| Firestore への保存 | `apps/server/src/infrastructure/persistence/` |
| 合意台帳（ADR-0007） | `apps/server/src/domain/consensus.ts`、`apps/server/src/application/consensus-context.ts`、`apps/web/src/features/consensus/` |
| 好みエンジン（ADR-0009） | `apps/server/src/domain/taste.ts`・`selection.ts`、`apps/server/src/application/generation-planner.ts`、`apps/web/src/features/taste/` |
| Gemini のAI・失敗時の切り替え | `apps/server/src/infrastructure/gemini/`、`apps/server/src/infrastructure/resilient-gateway.ts` |

## 技術スタック

| 層 | 技術 | 状態 |
|---|---|---|
| フロント | React 19 + TypeScript + Vite、CSS Modules + CSS変数、Motion、Zustand | 実装済み |
| 通信の型 | Zod（`packages/protocol` を web と server で共有） | 実装済み |
| リアルタイム通信 | WebSocket（`ws`）＋ 自作のプロトコル CAMP v1（`packages/camp`） | 実装済み |
| サーバー | Node.js + TypeScript（tsup で1ファイルにまとめる） | デプロイ済み |
| 実行環境 | Cloud Run（東京、最大1台、待機は通常0台・本番前だけ1台）。画面とサーバーを1つのコンテナから配る | デプロイ済み（rev 00026） |
| 画面の配信 | Cloud Run から直接配る（ハッシュ付きファイルは1年キャッシュ） | デプロイ済み |
| AI | Gemini（Vertex AI 経由。gemini-3.5-flash / gemini-3.8-flash、構造化出力）。失敗時は固定データ | デプロイ済み |
| 音声 | Gemini Live（gemini-3.5-transcribe-live、サーバー中継）→ 語彙で聞き間違いを直す → gemini-3.5-flash で仕分け・言い直し。文字起こしは画面に出さない。テキスト入力を常に併設 | デプロイ済み。声の調子（#4）は予定 |
| 通話 | WebRTC（ブラウザどうし直接）。経路探しは Google STUN、つながらない回線は Cloudflare TURN で中継 | デプロイ済み |
| 永続化 | Firestore（asia-northeast1）。セッション状態と確定イベント | 実装済み（再起動からの復元を確認） |
| 認証・秘密情報 | Vertex AI・Firestore はサービスアカウント認証で APIキー不要。Secret Manager には TURN のキーだけを置く | 実装済み |
| 効果の測定 | 会議の指標（#18）、終わったあとのアンケート（#20）、CAMP の効果の実測（#22） | 予定 |
| テスト | Vitest（ドメイン・通信の型・アクター）、Playwright（2ブラウザ同時操作） | Vitest のみ実装済み |

## キャッシュ

専用のキャッシュサーバー（Redis 等）は置かない。サーバーを1台に限るため、メモリ上の状態がそのままキャッシュを兼ねる。

| 置き場所 | 何を持つか | 目的 | 状態 |
|---|---|---|---|
| サーバーのメモリ | セッションの最新状態一式 | 正本として最速で判定する。Firestore は控え | 実装済み |
| サーバーのメモリ | 処理済みの操作の結果（直近500件） | 再送された操作を二重に実行しない | 実装済み |
| サーバーのメモリ | 次の挑戦者の作り置き（3件） | 交代で Gemini の応答を待たせない | 実装済み |
| サーバーのメモリ | ロビーでの最初の挑戦者（2件） | テーマを入れている間に作り、開始と同時に出す（約1.6秒 → 約0.06秒） | 実装済み |
| サーバーのメモリ | 決勝の全員分の企画書 | 優勝と同時に出す（11〜13秒 → 0秒）。版が変わったら作り直す | 実装済み |
| サーバーのメモリ | TURN の接続情報（1時間使い回す。有効は6時間） | Cloudflare に毎回頼まない | 実装済み |
| サーバーのメモリ | 全員が抜けたあとのセッション（30分） | 一時的な切断から同じ状態に戻れる | 実装済み |
| ブラウザ | 自分の審査員ID（sessionStorage） | 再読み込みしても同じ審査員として戻る | 実装済み |
| ブラウザのキャッシュ（Cloud Run から配信） | 画面のファイルとキャラ画像 | ハッシュ付きファイルは1年、index.html はキャッシュしない | デプロイ済み |
| Gemini のコンテキストキャッシュ | 役割の指示と審査の文脈（合意台帳）を前半に固定順で置く | 待ち時間と料金を減らす | 形は実装済み。プロンプトが短く、実測ではまだ効いていない（ADR-0007） |
| Firestore | 確定イベントと最新のセッション状態 | サーバー再起動からの復元 | 実装済み |

**Redis（Memorystore）と Pub/Sub を検討する条件**：Cloud Run を2台以上に増やすとき。セッション状態をインスタンス間で共有する必要が出るため（ADR-0003）。

## データの流れ（例：ゴールデンブザーで合格）

1. ブラウザ：挑戦者が1人ずつ登場し、右上に「あと N 秒」（持ち時間はロビーで15・30・60・90秒から選ぶ。既定60秒）。カーソルを乗せる・詳細を開く・質問すると交代のカウントが止まる（深掘りタイム）。一時停止ボタンでも止められる
2. 審査員がそれぞれ自分のブザーを押す → `PRESS_BUZZER` をサーバーへ送る
3. アクター：押した人を数えて `BUZZER_PRESSED` を全員へ。参加中の審査員が全員押したら合格と判定し、`PROMOTION_CONFIRMED` と次の挑戦者の `CANDIDATE_SPAWNED` を、最新状態つきで全員へ配信（ほぼ同時に押されても、1件ずつ処理するので合格は1回だけ）
4. ブラウザ：届いた状態に置き換え、キャラが合格者待機室の枠へ飛んでいき、枠が光る
5. アクター：押した審査員ごとに好みを更新し、合格した案の会話を生成の文脈から外す（決まった条件と否定した方向は残す）。次の挑戦者は、好み・目新しさ・合格案と似ていないかで選ぶ
6. アクター：合格した案の改良を始める。ほかにも合格者がいれば全員で相互批評し、新しい版を作る（批評を間隔をあけて配信 → 改良版を公開）。決勝の全員分の企画書を作り置きする
7. 合格者が決勝の人数（ロビーで1〜4人、既定3人）にそろうか、ホストが `END_PRELIMINARY` で途中で決勝へ進めると決勝。スポットライト・質問・改良・版の巻き戻しのあと、投票で優勝（同票ならホスト、1人だけならホストがそのまま選ぶ）。企画書はすぐ出る

見送り（`REJECT_CANDIDATE`）と時間切れでは、その挑戦者は退場し、すぐ次の人と交代する。退出ボタン（`LEAVE_SESSION`）は席を空けて一覧からも消す。通信が切れただけなら席を残す。

合意メモ：発言から論点を作り、賛成・反対した人を名前で、賛成の人数をバーで出す。合意が大きく変わったら古い前提の作り置きを捨てて作り直す。ただし、合意が変わったあとに届いた古い前提の案がまだ入ることがある（実測計画 M2 で直す）。
