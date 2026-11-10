# ピッチ用スライドの図と画像

`IDEA_AUDITION_Pitch_v10.pptx`（牧の Downloads）に入れた図と画像の元。2026-11-09 作成。

| ファイル | スライド | 中身 |
|---|---|---|
| `arch3.html` → `arch3.png` | 11 技術アーキテクチャ（v10 で使用） | arch2 と同じ流れを、公式アイコンとロゴで描いたもの |
| `team.html` → `team.png` | 5 僕たち自身が困った | このハッカソンの案出しでの3つの困りごと |
| `arch2.html` → `arch2.png` | （v7〜v9 で使用） | 技術ごとのデータの流れ：ブラウザ（React・CAMP Client・マイク・WebRTC・PDF）→ Cloud Run（画面の配信・部屋づくり・CAMP Server・SessionActor・ルール・/voice・聞き間違い補正）→ Vertex AI（Gemini 3.5 / 3.8 Flash・Embedding・Live）・Firestore・STUN。アイコンは lucide（`icons.js`、リポジトリに入っているもの） |
| `arch.html` → `arch.png` | （v6 の簡単な版） | ブラウザ → CAMP サーバー → 合意台帳・好み → Gemini → 同じ列で確定 → 全員へ |
| `camp.html` → `camp.png` | 12 CAMP の内部 | 検査 → 重複の確認 → アプリのルール → 確定（seq）→ 配信。task() と epoch で古い AI 結果を捨てる |
| `ab.html` → `ab.png` | 13 BEFORE / AFTER | 作り置きを順に出す方式（想定）と、合意台帳で次の生成が変わる IDEA AUDITION（実際の画面の切り抜き） |
| `chaos.html` → `chaos.png` | 4 会議の混乱 | 再現イメージ |
| `sb.html` → `storyboard.png` | 7 デモの流れ | 実際の画面5枚（登場・選抜・改善・投票・企画書） |
| `github_readme.png` | 14 OSS 公開 | 公開リポジトリ camp-protocol/camp の実物（ヘッダーと README だけ） |
| `stage.jpg` | 6 実アプリ | 4人で審査中の実際の画面（Gemini、ローカル） |
| `icon_1024.png` | 1・16 | 角を透明にしたアプリのアイコン |

作り直すとき：HTML を headless Chrome で 1175×440（storyboard は 1140×320、chaos は 690×290）、倍率2で撮る。`sb.html` は sb1〜sb5.png（実際の画面を 1600×900 にしたもの）を読むので、撮り直した画面を置いてから撮る。

注意：
- 図は実装（packages/camp と apps/server の SessionActor）に合わせて描いた。CAMP がするのは「1件ずつの処理・seq・重複の排除・reset 後の古い結果の破棄」。合意台帳で作り置きを捨てるのは IDEA AUDITION 側のルール
- GitHub の画面は、今の公開リポジトリだとコミットの一覧と Contributors に日本語のメッセージと AI ツールの名前が出るので、README の部分だけを使った。npm 公開（#23）のあとに撮り直す

## 使ったアイコンの出どころ（著作物利用シート #27 用）

| もの | 出どころ | 条件 |
|---|---|---|
| Cloud Run・Vertex AI のアイコン（`logos/cloudrun.svg`・`logos/vertexai.svg`） | Google Cloud 公式アイコン（https://cloud.google.com/icons の「コアプロダクト アイコン」zip） | Google の配布物。アーキテクチャ図での利用向けに公開されている |
| Firestore のアイコン（`logos/firestore.svg`） | 同じページの「以前のコンソール アイコン」zip | 同上 |
| React・WebRTC・Gemini のロゴ（`brands.js`） | Simple Icons（simple-icons@13.21.0、jsDelivr 経由） | アイコンのデータは CC0。ロゴ自体は各社の商標 |
| そのほかのアイコン（`icons.js`） | lucide（アプリが使っている lucide-react に含まれるもの） | ISC ライセンス |
| CAMP のロゴ・アプリのアイコン | 自分たちで作ったもの | — |
