# IDEA AUDITION — 設計ドキュメント

- Owner: チーム VICTORY
- Updated: 2026-11-09

> 実装は本番で動いている（README の本番 URL）。**いまの機能と完成形は [00-product/feature-status.md](00-product/feature-status.md) を正とする**。
> ADR・受け入れ条件・元資料は、設計を決めたときの記録（下段に5体並ぶ・ドラッグで昇格など、いまの作りと違う部分がある）。

## 元資料

- 統合企画・プロダクト・技術仕様書 v5（2026-11-07、このリポジトリには含めていない）
  - 優先順位：ユーザーの最新指示 ＞ 第22章（最新確定仕様）・第23〜28章 ＞ 第1〜21章（履歴）＞ 付録A（ビジュアル）
  - 失効した旧仕様：MediaPipeピンチ必須、合格控室、別画面の決勝、上下に同一キャラ表示、合格後に下段4体のまま
- 初期の画面モック（このリポジトリには含めていない）
- 参照画像：IDEA AUDITIONのキービジュアル（宣伝・開始画面向け。実ステージをポスター化しない）

## 目次

| 文書 | 内容 | Status |
|---|---|---|
| [00-product/feature-status.md](00-product/feature-status.md) | **機能の一覧（完成形と、済み／予定）**。資料はこれに合わせる | 最新 |
| [02-architecture/system-map.html](02-architecture/system-map.html) | 構成図（完成形） | 最新 |
| [00-product/acceptance-criteria.md](00-product/acceptance-criteria.md) | 確定仕様から抽出した受け入れ条件・ドメイン不変条件 | Accepted（第22章由来）|
| [05-platform/gemini-credits.md](05-platform/gemini-credits.md) | **チーム向け**：Gemini（クレジット）の使い方、AIモードの切り替え、手元で Gemini を使う手順、節約のルール | — |
| [05-platform/deployment.md](05-platform/deployment.md) | デプロイ手順（Cloud Run・TURN のキー・台数の切り替え・ログ） | Accepted |
| [02-architecture/diagram-checklist.md](02-architecture/diagram-checklist.md) | アーキテクチャ図のチェックリスト（アイコン・サービス名・作図・Google Cloud の境界） | — |
| [02-architecture/overview.md](02-architecture/overview.md) | 全体図・技術スタック・キャッシュ・データの流れ | Accepted |
| [open-questions.md](open-questions.md) | 未決事項と暫定推奨 | — |
| [backlog/README.md](backlog/README.md) | 今後やるタスク（バックログ） | — |
| [implementation-plan.md](implementation-plan.md) | P0の実装計画（範囲・日程・担当・作るファイル）と進捗 | 実装中（M2相当まで完了） |
| [adr/ADR-0001-rendering-approach.md](adr/ADR-0001-rendering-approach.md) | 描画方式：DOM/CSS/SVG＋レイヤード素材 | Accepted |
| [adr/ADR-0002-repository-structure.md](adr/ADR-0002-repository-structure.md) | リポジトリ構成：縮小モノレポ | Accepted |
| [adr/ADR-0003-server-authority.md](adr/ADR-0003-server-authority.md) | サーバー権威：セッションアクター＋Firestore追記 | Accepted |
| [adr/ADR-0004-camp-v1-minimum.md](adr/ADR-0004-camp-v1-minimum.md) | CAMP v1 最小仕様：Command/Event/Ephemeral/Snapshot | Accepted |
| [adr/ADR-0005-ai-orchestration.md](adr/ADR-0005-ai-orchestration.md) | Gemini非同期オーケストレーション | Accepted |
| [adr/ADR-0009-taste-engine.md](adr/ADR-0009-taste-engine.md) | 好みエンジン：言葉・行動・迷いから好みを読み、次の案の出し方を変える（図つき） | Proposed |
| [adr/ADR-0010-camp-protocol-and-oss.md](adr/ADR-0010-camp-protocol-and-oss.md) | CAMP をアプリケーション層プロトコルとして仕様にし、OSS に切り出せる境界を作る。改名の経緯も | Accepted |
| [adr/ADR-0011-speech-repair.md](adr/ADR-0011-speech-repair.md) | 音声の聞き間違いを、会議の中で育つ語彙と注目の情報で直す | Accepted |
| [plans/2026-11-08-camp-oss-and-dialogue-metrics.md](plans/2026-11-08-camp-oss-and-dialogue-metrics.md) | 実装計画：CAMP の OSS 公開・因果の記録（Decision Provenance）・技術効果と対話の実測・予備実験 | Proposed |
| [protocol/camp-v1.md](protocol/camp-v1.md) | CAMP v1 仕様書（メッセージ・順序・衝突・復旧・バージョン・終了コード） | Draft |
| [adr/ADR-0008-proposal-pdf.md](adr/ADR-0008-proposal-pdf.md) | 優勝案の企画書と審査レポートを PDF で渡す | Accepted |
| [adr/ADR-0007-consensus-ledger.md](adr/ADR-0007-consensus-ledger.md) | 合意台帳：会話の一貫性と時系列の合意を新しい案・改良・回答に反映 | Accepted |
| [adr/ADR-0006-lower-stage-rotation.md](adr/ADR-0006-lower-stage-rotation.md) | 下段の入れ替え：注目度（会話での言及を含む）にもとづく退場 | Accepted |

## 運用ルール

- 各文書に `Status: Proposed | Accepted | Superseded`、`Owner`、`Updated` を記載する。
- ADRは `adr/ADR-XXXX-<slug>.md`。`Context / Decision / Alternatives / Consequences / Verification` を持つ。
- **確定仕様・技術仮説・未決事項・実測結果を混ぜない**。未検証の数値やAPI挙動は「要検証」と明記する。
- 旧仕様との矛盾は削除で隠さず、失効理由とともに残す。
- チームが合意したADRのみ `Accepted` に変更する。

## 決定状況サマリー

| 領域 | 状況 |
|---|---|
| 2層ステージ・定員・一意性 | 確定（第22章） |
| 操作：マウス／トラックパッド、キャラ本体ドラッグ | 確定（第22章） |
| 描画方式・構成・サーバー権威・CAMP・AI設計 | 採用（ADR-0001〜0005 Accepted、2026-11-07）。検証項目は各ADRに残る |
| 上段満席時の扱い（Q1） | 回答済み：MVPは拒否、P1で重ねて入れ替え |
| キャラ素材と動き（Q2） | 暫定：生成した静止画＋コードの動きで試す。動画AIも候補として残し、比較試作で評価 |
| 上段の改良トリガー（Q3） | 回答済み：昇格直後＋審査員の明示指示＋新しい加入時の相互批評。批評は2〜3ラウンドの往復 |
| 最終決定・投票（Q4） | 回答済み：ソロはクリック、複数人は1人1票の多数決、同票はホストが決める |
| チーム体制・締切・音声（Q5） | 回答済み：3〜4人・TS経験あり、締切は3日後（2026-11-10）、音声はP0からGemini Live（テキスト入力を代わりの手段として残す） |

## 前提（2026-11-07時点）

- **締切：2026-11-10**。精度には妥協しない。
- 初日に最優先で試すこと（仕様書12.2を現行仕様に合わせて絞り込み）：
  1. Gemini Liveで日本語の発言が文字になるか（1台→2台）
  2. Cloud Run + WebSocketで、4台から同じステージを表示し、再接続できるか
  3. 2台で同じキャラを同時にドラッグしても、二重昇格しないか
  4. キャラ1体の動きの比較試作（ADR-0001の(a)(b)(c)）
  5. Geminiの構造化出力で、上段の改良（相互批評を含む）が返るまでの時間
- コア体験の優先順位（付録A §8）：**下段5体 → キャラ本体をドラッグして昇格 → 上段で目に見えて進化**。
