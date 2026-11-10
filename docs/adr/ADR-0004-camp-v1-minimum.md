# ADR-0004: CAMP v1 最小仕様 — Command / Event / Ephemeral / Snapshot

- Status: Accepted（2026-11-07。比較・検証の項目は Verification に残る）
- Owner: TBD
- Updated: 2026-11-07
- 関連：仕様書v5 第7・22.6・25章／ADR-0003

## Context

- CAMP は、WebSocketの上に載る**アプリケーション層のメッセージ仕様**。
- カーソルの高頻度な位置と、昇格の確定イベントでは、信頼性・順序・永続化の要件がまったく異なる。
- 「独自プロトコルを設計・実装」と主張するのは、実装・検証の後に限る（25.1）。

## Decision（提案）

### メッセージを4種類に分ける

| 種別 | 方向 | 順序 | 永続化 | 重複排除 | 例 |
|---|---|---|---|---|---|
| **Command** | Client → Server | 送信順 | ログに記録 | `commandId` | `REQUEST_PROMOTION`, `ASK_CANDIDATE`, `REQUEST_REFINEMENT`, `SELECT_CHAMPION` |
| **Event** | Server → All | セッション単位の連番 `seq` | Firestoreに追記 | `seq` | `PROMOTION_CONFIRMED`, `CANDIDATE_SPAWNED`, `REVISION_PUBLISHED` |
| **Ephemeral** | 双方向（サーバー中継） | なし（最新の値だけ使う） | しない | 不要 | `CURSOR_MOVED`, `DRAG_PREVIEW`, `FOCUS_CHANGED` |
| **Snapshot** | Server → Client | `seq` 時点の全体 | 定期保存 | — | `SESSION_SNAPSHOT` |

コマンドの結果は、`COMMAND_ACCEPTED` / `COMMAND_REJECTED{reason}` として送信者に返す。状態の変化はEventとして全員に配信する。

### 共通エンベロープ（案）

```json
{
  "camp": "1",
  "kind": "command | event | ephemeral | snapshot",
  "type": "REQUEST_PROMOTION",
  "sessionId": "s_...",
  "senderId": "judge_... | server",
  "commandId": "uuid（commandのみ）",
  "correlationId": "対応するcommandId（event/拒否時）",
  "seq": 123,
  "expectedVersion": 42,
  "sentAt": "ISO8601",
  "payload": {}
}
```

- フィールド名・型は案。スキーマ記述はZodまたはJSON Schemaを候補とし、`packages/protocol` に置く（ADR-0002）。
- 不明な `type` は無視してログに記録する（前方互換）。破壊的変更は `camp` のメジャー番号を上げる。

### 拒否理由コード（初期案）

`UPPER_FULL`, `NOT_IN_LOWER`, `ALREADY_PROMOTING`, `STALE_VERSION`, `NOT_AUTHORIZED`, `SESSION_NOT_ACTIVE`, `INVALID_PAYLOAD`

- `UPPER_FULL` は、満席時の昇格要求に対してMVPで返すコード（open-questions Q1）。
- P1の入れ替えでは Command `REQUEST_REPLACEMENT{incomingCharacterId, outgoingCharacterId}` を追加する。成功時のEvent案は `FINALIST_REPLACED`（外れた側のIdea BOX行きと、入る側の昇格を1つのイベントで表す）。拒否理由の候補として `NOT_IN_UPPER`（外す対象が上段にいない）を追加する。

### 発言（Q5回答済み、名称とpayloadは案）

| 種別 | type | 内容 |
|---|---|---|
| Command | `SUBMIT_UTTERANCE{text, source: "live" \| "text", targetCharacterId?}` | Gemini Liveの認識結果、またはテキスト入力。音声そのものは送らない |
| Event | `JUDGE_UTTERANCE_RECEIVED{judgeId, text, source}` | 全員に配信 |
| Event | `INTENT_EXTRACTED{utteranceId, kind: "question" \| "instruction", targetCharacterId}` | サーバーが質問か改善指示かを判定した結果 |
| Ephemeral | `MIC_STATE_CHANGED{judgeId, on}` | マイクのON/OFF表示 |

### 投票（Q4回答済み、名称とpayloadは案）

| 種別 | type | 送信者・条件 |
|---|---|---|
| Command | `START_CHAMPION_VOTE` | ホストのみ。上段に1体以上 |
| Command | `CAST_VOTE{finalistId}` | 審査員。締め切り前なら上書きできる |
| Command | `CLOSE_VOTE` | ホストのみ |
| Command | `RESOLVE_TIE{finalistId}` | ホストのみ。同票の候補の中から選ぶ |
| Command | `SELECT_CHAMPION{finalistId}` | ソロ、または上段が1体のとき |
| Event | `CHAMPION_VOTE_STARTED` / `VOTE_CAST{judgeId}` / `CHAMPION_VOTE_CLOSED{tally}` / `TIE_DETECTED{finalistIds}` / `CHAMPION_SELECTED` | サーバー → 全員 |
| Event | `HOST_CHANGED{judgeId}` | ホストが切断して交代したとき |

- 投票中に誰が何に入れたかを全員に見せるかは未定。`VOTE_CAST` には誰が投票したかだけを載せ、何に入れたかは締め切りまで伏せる案を第一候補にする。
- 拒否理由の候補を追加する：`NOT_HOST`, `VOTE_NOT_OPEN`, `NOT_A_TIE_CANDIDATE`。

### 再接続

1. クライアントは最後に適用した `lastSeq` を付けて再接続する。
2. サーバーは直近のイベントバッファに `lastSeq+1` 以降があれば差分を再送し、なければ `SESSION_SNAPSHOT` を送る。
3. 再接続時は、未確定のCommandを同じ `commandId` で再送する（サーバー側で重複を排除する）。

### カーソル

- 正規化座標（0〜1）で送る。送信頻度は10〜20Hzを**仮説**とし、実測して調整する。
- 受信側で補間する。サーバーは中継のみで、検証・永続化はしない。

## Alternatives

- **単一のイベント型に統一**：実装は単純だが、カーソルまで永続化・連番付けすると負荷と遅延が増え、プロトコル設計として説明しにくい。
- **Firebaseのリアルタイム同期に任せる**：順序・排他・拒否の表現をアプリ側で作り込む必要がある。

## Consequences

- コマンド／イベントの分離により、楽観的UI（掴む動きの先行表示）とロールバックが素直に書ける。
- 契約テストを `packages/protocol` のfixtureで共有できる。

## Verification

- 契約テスト：重複したCommand、順不同のEvent、`seq` の欠番検出、`lastSeq` からの再送。
- 計測：カーソルの送信頻度と受信側の体感、昇格確定までのp95（目標はp95で約100ms以下という仮説）。
