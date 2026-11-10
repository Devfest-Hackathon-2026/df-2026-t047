import { CHARACTER_DESIGNS } from '@idea-audition/protocol';
import type { AuditionSession } from '../domain/session.ts';

/**
 * 音声認識に渡す語彙（Gemini Live の customVocabulary）。
 * キャラ名・テーマの根幹の語・いま出ている企画名とその説明文の固有語・前に出た企画名を渡すと、聞き間違いが減る
 * （合成音声での比較：「ルナ」→「のの」、「スプラウト」→「ブラウト」が正しくなった）。
 *
 * Live の語彙は接続時にしか渡せない（接続中の差し替えはできない）。上限があるので、
 * 大事なものから順に詰める：キャラ名 → 舞台の企画名 → 企画の固有語 → テーマ → 前に出た企画名 → 論点。
 * 前に出た企画は、「さっきのひとり飯のやつ」のように戻って話題にされるため、直近の数件と注目された案を持つ。
 * 企画名はフルネームで呼ばれにくいので、AI が付けた呼び名（aliases）も一緒に持つ。
 */
const MAX_PHRASES = 60;
/** 前に出た企画（退場済み）のうち、新しい順に持つ件数と、そのほかから注目度の高い順に足す件数 */
const RECENT_ARCHIVED = 5;
const FAVORED_ARCHIVED = 2;
const MAX_PHRASE_CHARS = 30;
/** テーマが短ければそのまま語として持つ（「学食」）。長い文は丸ごと言われないので持たず、根幹の語だけ拾う */
const SHORT_THEME_CHARS = 10;
const MAX_THEME_WORDS = 6;
/** 固有語として拾う：カタカナ語（3〜14字）と英数字の語（2〜20字）。一般的な漢字語・ひらがなは認識できるので拾わない */
const KEYWORD = /[ァ-ヶー]{3,14}|[A-Za-z][A-Za-z0-9.+#-]{1,19}/g;

/** 文章から固有語を取り出す（企画の説明文用）。カタカナ語・英数字の語だけ */
export function keywordsOf(text: string): string[] {
  return text.match(KEYWORD) ?? [];
}

/** テーマの根幹の語：固有語に加えて、漢字の語（2〜6字。「学食」「大学」）も拾う。テーマは短く、語が少ないため */
function themeWords(theme: string): string[] {
  const kanji = theme.match(/[一-龥々]{2,6}/g) ?? [];
  return [...new Set([...keywordsOf(theme), ...kanji])].slice(0, MAX_THEME_WORDS);
}

function onStageIds(s: AuditionSession): string[] {
  return [...s.lowerSlots.filter((x): x is string => !!x), ...s.upper.map((f) => f.instanceId)];
}

/** 企画名と、その読み（企画名と違うときだけ）と、呼び名（「ひとり飯ラウンジ」を「ひとり飯」と呼ぶ） */
function titlePhrases(r: { title: string; reading?: string | null; aliases?: string[] | null }): string[] {
  return [r.title, ...(r.reading && r.reading !== r.title ? [r.reading] : []), ...(r.aliases ?? [])];
}

/**
 * 前に出た企画（舞台から退場したもの）の名前。新しい順に RECENT_ARCHIVED 件と、
 * それ以外で注目度（触られた・取り上げられた）が高い案を FAVORED_ARCHIVED 件。
 * 見送られた案は、また話題にされにくいので除く。
 */
function archivedTitles(s: AuditionSession): string[] {
  const seen = new Set<string>();
  const entries = [...s.ideaBox]
    .reverse()
    .filter((a) => a.reason !== 'rejected' && !seen.has(a.ideaId) && !!seen.add(a.ideaId));
  const recent = entries.slice(0, RECENT_ARCHIVED);
  const favored = entries
    .slice(RECENT_ARCHIVED)
    .map((a) => ({ a, score: s.characters.get(a.instanceId)?.attention.score ?? 0 }))
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, FAVORED_ARCHIVED)
    .map((x) => x.a);
  return [...recent, ...favored].flatMap((a) => {
    const rev = s.ideaOf(a.instanceId)?.revisions.at(-1);
    return rev ? titlePhrases(rev) : [];
  });
}

export function speechVocabulary(s: AuditionSession): string[] {
  const names = CHARACTER_DESIGNS.flatMap((d) => [d.name, ...d.readings.filter((r) => /[ァ-ヶー]/.test(r))]);
  const revisions = onStageIds(s)
    .map((id) => s.ideaOf(id)?.revisions.at(-1))
    .filter((r): r is NonNullable<typeof r> => !!r);
  const titles = revisions.flatMap(titlePhrases);
  const stageWords = revisions.flatMap((r) => keywordsOf(`${r.title} ${r.summary}`));
  const theme = s.theme.trim() ? [...(s.theme.trim().length <= SHORT_THEME_CHARS ? [s.theme.trim()] : []), ...themeWords(s.theme)] : [];
  const claims = s.ledger.claims.filter((c) => c.status !== 'superseded').map((c) => c.text);
  const all = [...names, ...titles, ...stageWords, ...theme, ...archivedTitles(s), ...claims]
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && p.length <= MAX_PHRASE_CHARS);
  return [...new Set(all)].slice(0, MAX_PHRASES);
}

/**
 * 語彙のうち、舞台に左右される部分の目印。これが変わったら、Live の語彙は古い。
 * 論点や発言はこまめに変わるので含めない（含めると開き直しが多すぎる）。
 */
export function speechStageKey(s: AuditionSession): string {
  const stage = onStageIds(s)
    .map((id) => `${id}:${s.ideaOf(id)?.revisions.at(-1)?.revisionId ?? ''}`)
    .sort();
  return [s.theme, ...stage].join('|');
}
