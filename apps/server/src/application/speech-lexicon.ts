import { CHARACTER_DESIGNS } from '@idea-audition/protocol';
import type { AuditionSession } from '../domain/session.ts';
import type { LexiconEntry } from '../domain/transcript-repair.ts';

/**
 * 文字起こしの補正に使う、その会議の辞書。会議が進むほど育つ。
 *  - キャラ名（カタカナの読み）
 *  - 企画名（Gemini が返した読みつき）と、その中のカタカナ語（例：「学食スタンプラリー」の「スタンプラリー」）、呼び名
 *  - テーマ・合意メモの論点の中のカタカナ語（論点の文章そのものは使わない：「高め→低め」のように意味を変えないため）
 *  - 最近の発言で2回以上出たカタカナ語
 * いまステージにいる案・その審査員が見ている案ほど寄せやすくする（boost）。
 */
const ON_STAGE = 0.1;
const FOCUSED = 0.05;
const CONTEXT = 0.05;
const KATAKANA_WORD = /[ァ-ヶー]{3,14}/g;

export function speechLexicon(s: AuditionSession, focused: ReadonlySet<string> = new Set()): LexiconEntry[] {
  const entries = new Map<string, LexiconEntry>();
  const add = (surface: string, reading: string | null, boost: number) => {
    const prev = entries.get(surface);
    if (!prev || prev.boost < boost) entries.set(surface, { surface, reading: reading ?? prev?.reading ?? null, boost });
  };
  const katakanaWords = (text: string) => text.match(KATAKANA_WORD) ?? [];

  const onStage = [...s.lowerSlots.filter((x): x is string => !!x), ...s.upper.map((f) => f.instanceId)];
  const stageDesigns = new Map<number, string>();
  for (const id of onStage) {
    const c = s.characters.get(id);
    if (c) stageDesigns.set(c.designId, id);
  }
  for (const d of CHARACTER_DESIGNS) {
    const id = stageDesigns.get(d.designId);
    const boost = id ? ON_STAGE + (focused.has(id) ? FOCUSED : 0) : 0;
    for (const r of d.readings.filter((x) => /^[ァ-ヶー]+$/.test(x))) add(r, r, boost);
  }
  for (const id of onStage) {
    const rev = s.ideaOf(id)?.revisions.at(-1);
    if (!rev) continue;
    const boost = ON_STAGE + (focused.has(id) ? FOCUSED : 0);
    add(rev.title, rev.reading ?? (/^[ァ-ヶー]+$/.test(rev.title) ? rev.title : null), boost);
    for (const w of katakanaWords(rev.title)) add(w, w, boost);
    // 呼び名（「ひとり飯ラウンジ」を「ひとり飯」と言う）。読みが分かる（カタカナだけ）ものは聞き間違いの補正にも使う
    for (const a of rev.aliases ?? []) add(a, /^[ァ-ヶー]+$/.test(a) ? a : null, boost);
  }
  for (const w of katakanaWords(s.theme)) add(w, w, CONTEXT);
  for (const c of s.ledger.claims) {
    if (c.status === 'superseded') continue;
    for (const w of katakanaWords(c.text)) add(w, w, CONTEXT);
  }
  const counts = new Map<string, number>();
  for (const u of s.utterances.slice(-30)) for (const w of katakanaWords(u.text)) counts.set(w, (counts.get(w) ?? 0) + 1);
  for (const [w, n] of counts) if (n >= 2) add(w, w, CONTEXT);
  return [...entries.values()];
}
