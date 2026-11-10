/**
 * キャラ素材のカタログ（web の描画とサーバーの割当ての両方が参照する静的データ）。
 * 素材：apps/web/public/assets/characters/mascots.png（4列×2行のスプライト、チームで作った初期の画面モック由来）
 * Q2 の目標は 12〜16 体。追加したらここに行を足す。
 */
export interface CharacterDesign {
  designId: number;
  name: string;
  /** 音声で呼びかけるときの読み（音声入力の宛先判定に使う） */
  readings: string[];
  accent: string;
  /** スプライト上の位置 */
  sprite: { sheet: string; col: number; row: number; cols: number; rows: number };
}

const SHEET = '/assets/characters/mascots.png';

const DESIGN_ROWS: [string, string, string[]][] = [
  ['MOMO', '#f367ff', ['モモ', 'もも']],
  ['SPROUT', '#56e8ca', ['スプラウト', 'スプラ']],
  ['LUNA', '#748aff', ['ルナ', 'るな']],
  ['POPO', '#ffa46d', ['ポポ', 'ぽぽ']],
  ['NOVA', '#76dfff', ['ノヴァ', 'ノバ', 'のば']],
  ['RIO', '#50baff', ['リオ', 'りお']],
  ['LEO', '#ffc85c', ['レオ', 'れお']],
  ['MIST', '#bc85ff', ['ミスト', 'みすと']],
];

export const CHARACTER_DESIGNS: readonly CharacterDesign[] = DESIGN_ROWS.map(([name, accent, readings], i) => ({
  designId: i,
  name,
  readings,
  accent,
  sprite: { sheet: SHEET, col: i % 4, row: Math.floor(i / 4), cols: 4, rows: 2 },
}));

export const JUDGE_SLOTS = [
  { label: '審査員 A', color: '#c58cff' },
  { label: '審査員 B', color: '#f367ff' },
  { label: '審査員 C', color: '#55c7ff' },
  { label: '審査員 D', color: '#ffc85c' },
] as const;
