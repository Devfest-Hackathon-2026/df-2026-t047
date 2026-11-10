# 著作物利用シート（IDEA AUDITION / チーム VICTORY）

- 対象：アプリ（本番 https://idea-audition-852280753109.asia-northeast1.run.app ）と、提出物（スライド・動画・ドキュメント）
- 作成：2026-11-10

## 1. 画像・ロゴ・キャラクター

| 素材 | 使っている場所 | 作った人・方法 | 利用条件 |
|---|---|---|---|
| キャラクター7体（ロボット・ライオン・魔法使いの猫・うさぎ・雲・芽のロボット・ドラゴン）`apps/web/public/assets/characters/mascots.png` | 予選・決勝・表彰の舞台 | チームのメンバーが ChatGPT の画像生成で作成（画像に来歴情報 C2PA が入っている） | OpenAI の利用規約に従う（出力の権利は利用者に帰属） |
| IDEA AUDITION のロゴ `apps/web/public/brand/logo-neon*.webp`、アイコン `apps/web/public/icons/*` | ヘッダー・舞台の奥・ブラウザのタブ | チームのメンバーが ChatGPT の画像生成で作成 | 同上 |
| CAMP のロゴ・アイコン `packages/camp/assets/*` | CAMP の README・GitHub・npm | チームのメンバーが ChatGPT の画像生成で作成 | 同上。CAMP のリポジトリは MIT |
| 企画書 PDF の企画イメージ画像 | 優勝後の企画書 PDF | アプリが Gemini（`gemini-3.1-flash-lite-image`、Vertex AI）でその場で作る | Google Cloud の利用規約に従う |
| スライドの生成画像 `docs/pitch/slide-assets/*-generated.png` ほか | ピッチ用スライド | チームのメンバーが ChatGPT の画像生成で作成。プロンプトは `docs/pitch/deck/image-generation-notes.md` | 同上 |
| アプリの画面写真 | スライド・ドキュメント・動画 | 自分たちのアプリを撮影 | 自作 |

## 2. 音

| 素材 | 使っている場所 | 出典 | 利用条件 |
|---|---|---|---|
| 効果音「タイマー02」（Timbre1・10秒版の最後の3.4秒を切り出し、終わりに0.2秒のフェードアウトを加えたもの）`apps/web/public/sfx/countdown-last3.mp3` | 予選の残り3秒のカウントダウン | OtoLogic https://otologic.jp/free/se/countdown01.html | CC BY 4.0（クレジット表記：OtoLogic）。README とアプリ内の `sfx/CREDITS.txt` に表記 |
| ブザー・合格・見送り・優勝などの効果音 | 予選・決勝・表彰 | 音のファイルは使わず、ブラウザでその場で作る（`apps/web/src/shared/sfx.ts`、Web Audio） | 自作 |

デモ動画に BGM や別の音は足していない（音は収録したメンバーの声とアプリの音だけ）。

## 3. フォント

| フォント | 使い方 | 利用条件 |
|---|---|---|
| Noto Sans JP・ヒラギノ角ゴ・メイリオ・system-ui | CSS で名前を指定しているだけ。フォントのファイルは配っていない（見る人の端末に入っているものを使う） | 配布しないので追加の条件なし。Noto Sans JP は SIL Open Font License 1.1 |

スライドは HTML で作った図を画像に書き出したもの（と、画像生成で作った画像）だけで、フォントのファイルは使っていない。HTML で指定したのはヒラギノ角ゴ・SF Mono・Menlo（macOS に標準で入っているもの）。

## 4. ライブラリ（本番で動くもの）

| ライブラリ | 版 | ライセンス | 使い方 |
|---|---|---|---|
| React・React DOM | 19.3.1 | MIT | 画面 |
| Zustand | 5.1.0 | MIT | 画面の状態 |
| Zod | 4.6.7 | MIT | メッセージの形の検査 |
| Motion | 14.10.1 | MIT | キャラの動き |
| lucide-react | 1.70.0 | ISC | アイコン |
| html2pdf.js（中で html2canvas 1.4.1・jsPDF 4.2.1 を使う） | 0.14.0 | MIT | 企画書 PDF |
| ws | 8.22.1 | MIT | WebSocket |
| @google/genai | 3.0.0 | Apache-2.0 | Gemini（Vertex AI） |
| @google-cloud/firestore | 9.4.0 | Apache-2.0 | 保存 |
| google-auth-library | 10.9.1 | Apache-2.0 | Google Cloud の認証 |
| @camp-protocol/kit（自作・公開） | 0.1.0 | MIT | 人と AI の操作を1つの順番で確定するプロトコル https://github.com/camp-protocol/camp |

## 5. 開発用のツール（本番には入らない）

| ツール | ライセンス |
|---|---|
| TypeScript 7.0.2 | Apache-2.0 |
| Vite 8.3.6・Vitest 5.1.0・tsup 9.0.0・tsx 4.23.15 | MIT |

## 6. 外部のサービス

| サービス | 使い方 |
|---|---|
| Google Cloud（Cloud Run・Vertex AI の Gemini・Firestore・Secret Manager・Cloud Build・Artifact Registry） | アプリの実行と AI |
| Google の STUN サーバー | 通話の経路探し |
| Cloudflare Realtime TURN | 直接つながらない回線での通話の中継（声のデータを中継するだけ） |

## 7. 参考にしたもの

| もの | 使い方 |
|---|---|
| 初期の画面モック | チームで作った画面の参考。キャラの画像と学食テーマの固定データの元。モック自体はこのリポジトリに含めていない |
| 表彰画面の元になった画面のソース（IDEA_AUDITION_Champion_Source） | チームで作った表彰画面の試作。演出（カウントダウン・紙吹雪・トロフィー）を取り込んで作り直した |
