# ADR-0002: リポジトリ構成 — 縮小モノレポ（web / server / protocol）

- Status: Accepted（2026-11-07。比較・検証の項目は Verification に残る）
- Owner: TBD
- Updated: 2026-11-07
- 関連：仕様書v5 第23.2〜23.4章／open-questions Q5

## Context

- フロント（React/TS）とリアルタイムサーバー（Cloud Run上のNode/TS候補）の2つの実行単位がある。
- 両者が共有すべきものは**CAMP の契約（メッセージ型・バリデータ・fixture）**。
- 昇格・定員・一意性の判定は**サーバー権威**。クライアントに判定ロジックを複製すると食い違いの原因になる。
- Clean Architectureは手段。全画面にRepository/UseCase抽象を強要しない（23.1）。

## Decision（提案）

案A（フルモノレポ）を縮小し、パッケージは以下の3つから始める。

```text
idea-audition/
├── docs/
├── apps/
│   ├── web/        # React + TS + Vite（feature-first）
│   └── server/     # domain / application / infrastructure / presentation
└── packages/
    └── protocol/   # CAMP 契約（スキーマ・型・fixture）
```

- **`packages/domain` は作らない**。ドメインは `apps/server/src/domain` に置き、クライアントはサーバーから届くスナップショット／イベントの投影だけを持つ。
- `packages/design-system` も最初は作らず、`apps/web/src/shared` に置く。2つ目の利用者が現れたら切り出す。
- ワークスペース管理はpnpm workspaces等が候補（未確定）。

### サーバー内の依存方向

```text
presentation (WS/HTTP handlers) → application (use cases, ports) → domain
infrastructure (Gemini, Firestore, WS adapters) → application ports を実装
domain は React / Firebase / Gemini を import しない
```

### webの構成方針

- `features/*`（audition, candidate-inspection, finalist-refinement, collaboration, champion）＋ `scene/*`（舞台・照明・キャラ・フリップ・演出）。
- **業務状態（サーバー由来）と表示状態（アニメーション）を別のストアに分ける**。アニメーションの完了を業務状態の根拠にしない。

## Alternatives

| 案 | 利点 | 欠点 |
|---|---|---|
| 案A（フル：domain / design-system まで分割） | 境界が最も明確 | 初期の設定・ビルド・CIのコストが大きい。共有domainは二重判定の温床になる |
| 案B（単一アプリ＋`server/`ディレクトリ） | 最速で立ち上がる | 型の共有が相対importになりやすく、境界が曖昧になる。デプロイの分離が手間 |
| **縮小A（本提案）** | 共有すべきprotocolだけを分離し、あとは各アプリに閉じる | パッケージ間ビルドの設定が少し要る |

## Consequences

- protocolの破壊的変更はweb・server両方の型チェックで即座に検出できる。
- サーバーのドメインはフレームワーク非依存なので、単体テストが容易。
- Q5の回答（3〜4人・TS経験あり・締切3日後）を踏まえ、縮小Aを維持する。理由：web / server / protocol の境界がそのまま担当の分け方になり、3日間の並行作業で衝突しにくい。

### 担当の分け方（目安、チームで調整）

| 担当 | 主な範囲 |
|---|---|
| ステージUI | `apps/web/src/scene`：舞台・照明・キャラ・フリップ・ドラッグと補充の演出 |
| サーバー・同期 | `apps/server`：セッションアクター、CAMP、再接続、Firestore追記 |
| AI・音声 | `apps/server/src/infrastructure`：Gemini（生成・改良・批評）、Gemini Live、`FixtureGateway` |
| 素材・UIの仕上げ | キャラ素材の生成と手直し、フリップの文言、上段の見せ方、ピッチ資料 |

- `packages/protocol` の型を**初日の早い段階で決めて固める**。その後の変更は全員に知らせてから行う。

## Verification

- protocolパッケージを変更すると、webとserverの型チェックが1つのCIジョブで失敗することを確認する。
- 開発サーバーの同時起動、ホットリロードの体感を確認する。
