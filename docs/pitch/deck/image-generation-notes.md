# 画像生成アセット

## 課題スライド用キービジュアル

- ファイル: `../slide-assets/problem-overload-generated.png`
- 用途: 3枚目「案は増えた。でも、選べない。」の背景
- 生成方式: Codex の組み込み画像生成
- 種別: `photorealistic-natural`

### 再現用プロンプ

```text
Use case: photorealistic-natural
Asset type: 16:9 presentation-slide hero background
Primary request: A Japanese hackathon team of four is overwhelmed by too many AI-generated ideas and cannot decide which one to choose.
Scene/backdrop: A dark modern workshop at night. Four young adults sit at a table with laptops, seen mostly from behind, looking toward a huge wall of floating translucent idea cards and simple category icons.
Style/medium: polished cinematic editorial photography, realistic people and materials
Composition/framing: wide 16:9 composition; people and laptops along the lower third; the idea wall fills the upper-right; preserve a large, quiet dark area on the left for Japanese slide copy
Lighting/mood: deep purple and magenta neon light, thoughtful and slightly overwhelmed rather than panicked
Color palette: near-black violet, purple, magenta, small cool-blue accents
Constraints: no readable text, no logos, no brands, no watermark; do not place important details in the left copy area
Avoid: sci-fi helmets, exaggerated hologram gestures, extra people, distorted hands, busy left side
```

生成画像には文字を入れず、日本語コピーとページ番号は `slide-03-problem.html` で後から重ねています。

## 案の大量生成スライド用ビジュアル

- ファイル: `../slide-assets/idea-abundance-generated.png`
- 用途: 2枚目「AIに聞けば、アイデアは無限に生まれる」の背景
- 生成方式: Codex の組み込み画像生成
- 種別: `photorealistic-natural`

### 最終プロンプ

```text
Use case: photorealistic-natural
Asset type: 16:9 presentation-slide background for slide 2 of a Japanese hackathon pitch
Primary request: Visualize the abundance of AI-generated ideas: hundreds of floating translucent idea cards extending into the distance, beautiful and initially exciting, but so numerous that choosing becomes difficult.
Scene/backdrop: A dark theatrical digital space with a deep near-black violet background. Rows of elegant glass-like rectangular cards float in perspective from the lower-right foreground toward the upper-right distance. Each card contains only a simple universal pictogram such as a lightbulb, leaf, people, rocket, game controller, heart, graduation cap, or chart.
Style/medium: premium cinematic editorial visualization, realistic glass and light, sophisticated presentation photography rather than a UI mockup
Composition/framing: wide 16:9; reserve the entire left 42% as calm dark negative space for large Japanese copy; visual density grows toward the right edge and into the distance; strong depth and clear focal hierarchy
Lighting/mood: purple and magenta neon rim light with restrained cool-blue accents; awe turning subtly into decision overload
Color palette: #090513, deep violet, magenta, lavender, small cool-blue accents
Constraints: absolutely no words, letters, numbers, logos, brands, watermarks, fake interface text, or people; all cards must use pictograms only; clean left copy area; suitable behind white Japanese typography
Avoid: readable text, gibberish text, duplicated illegible labels, cyberpunk city, overly busy left side, low contrast, cartoon style
```

文字は `slide-02-abundance.html` で重ね、生成画像の文字化けを防いでいます。
