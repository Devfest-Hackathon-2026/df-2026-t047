# アーキテクチャ図のチェックリスト

- 出どころ：SORACOM の登壇スライド「アーキテクチャ作図チェックリスト」（Summer 2025、AWS 向け）を、Google Cloud と IDEA AUDITION 向けに読み替えたもの
- 使う場面：全体図（[system-map.html](system-map.html)）、発表スライドの構成図、README の図を作る・直すとき

## アイコン

- [ ] アイコンは最新か（Google Cloud の公式アイコンを使うなら、いまの版のセットを使う。古い六角形のアイコンと混ぜない）
- [ ] 背景色に合わせたアイコンを使っているか（暗い背景では暗い背景用の色。全体図は明るい・暗いの両方で読めるよう、色をトークンで指定している）

## サービス名

- [ ] 名前や機能名は最新か（例：埋め込みは `gemini-embedding-001`、音声は `gemini-3.5-transcribe-live`。使わなくなったもの（Secret Manager・合言葉）を残していないか）
- [ ] 初めて出るところで略称を使っていないか（CAMP は「CAMP（Collaborative Agent Mediation Protocol）」、WSS は「WebSocket（WSS）」、ADC・MMR・CI も最初に言い換える）
- [ ] 2行以内に収まっているか、改行の位置は自然か（ノードの文字は「名前」と「説明1行」まで）

## 作図

- [ ] 枠線や矢印の色・太さがそろっているか（全体図では、線の色と太さは1種類。意味は実線＝毎回のやり取り、点線＝毎回ではないつながり、だけで分ける）
- [ ] クラウドの境界に「Google Cloud」と書いてあるか（AWS の図の「AWS Cloud」にあたる。表記は公式どおり「Google Cloud」。Vertex AI も Cloud Run も Firestore もこの枠の中）

## 2026-11-08 に全体図を見直して直したこと

- 「NEW」の黄色い強調（太い線・黄色の枠）をやめ、線の色と太さを1種類にそろえた（もう全部本番で動いているため）
- 境界の表記を「GOOGLE CLOUD」から「Google Cloud」にし、外に描いていた Vertex AI を Google Cloud の枠の中に入れた
- 古い名前を直した：`embedding-2` → `gemini-embedding-001`、「Gemini Live」→ `gemini-3.5-transcribe-live`
- 初出の略称を言い換えた：CAMP・WSS・PCM（→ 音声 16kHz）・CI・ADC・MMR
- 3行になっていたノード（GitHub・Artifact Registry・Cloud Run・CAMP の説明）を2行にした
- 中身をいまの本番に合わせた：合言葉ゲートと Secret Manager を外し、部屋の発行（POST /api/rooms）・部屋が無いときの ROOM_NOT_FOUND・開発用の dev-local・CAMP の公開リポジトリを描いた
