import { JUDGE_SLOTS, TASTE_AXES, type PitchRole } from '@idea-audition/protocol';
import type { AuditionSession } from '../domain/session.ts';
import type { IdeaDraft, Pitch } from '../domain/types.ts';
import { closeness, sample, type Candidate } from '../domain/selection.ts';
import {
  CONFIDENT_SIGNALS,
  divergence,
  normalized,
  strongestAxes,
  teamTaste,
  zeros,
  type Vec,
} from '../domain/taste.ts';
import { PERSONAS } from './personas.ts';
import type { ConsensusContext, GenerationSlot, TasteHint } from './ports.ts';

/**
 * 生成計画と選抜（ADR-0009 §2-2）。
 * - 生成：枠ごとに役割（fit / bridge / explore / wildcard）と発想の型を決めて Gemini に頼む
 * - 選抜：下段に空きが出たら、そのときの好みでストックから1つ選ぶ（多めに作って選ぶ）
 */

const AXIS_LABEL = TASTE_AXES.map((a) => a.label);
/**
 * 好みが溜まってからの役割の回り方。5枠のうち好み・折衷は2枠まで（多いと1回選んだだけで同じ方向ばかりになる。
 * プレイテスト 2026-11-08 で、好み枠が多いときに下段も決勝も同じ方向に寄った）
 */
const WARM_ROTATION: PitchRole[] = ['fit', 'explore', 'bridge', 'wildcard', 'explore'];
/** 好みが溜まるまでは広く探る */
const COLD_ROTATION: PitchRole[] = ['explore', 'wildcard', 'explore', 'explore'];

export interface PlannerState {
  /** 役割の回り方のどこまで来たか */
  cursor: number;
  /** 次に「好み枠」で寄せる審査員（順番に回す） */
  fitTurn: number;
}

export const newPlannerState = (): PlannerState => ({ cursor: 0, fitTurn: 0 });

const judgeLabel = (s: AuditionSession, judgeId: string) => {
  const j = s.judges.find((x) => x.judgeId === judgeId);
  return j ? JUDGE_SLOTS[j.slotIndex]!.label : '審査員';
};
/** カードに出す短い呼び方（「審査員 A」→「Aさん」） */
const shortLabel = (s: AuditionSession, judgeId: string) => {
  const name = s.judges.find((x) => x.judgeId === judgeId)?.name;
  return `${name || judgeLabel(s, judgeId).replace('審査員 ', '')}さん`;
};

/** 好みの軸の短い言い方。断定しないよう「〜寄り」（画面の taste-summary.ts と同じ言い方） */
function describeAxis(axis: number, value: number) {
  return `${AXIS_LABEL[axis]}${value > 0 ? '' : '控えめ'}寄り`;
}

function confidentJudges(s: AuditionSession) {
  return s.judges.filter((j) => (s.taste.judges[j.judgeId]?.signals ?? 0) >= CONFIDENT_SIGNALS).map((j) => j.judgeId);
}

/** 次の枠の役割と、寄せる相手 */
function nextRole(s: AuditionSession, state: PlannerState, now: number): { role: PitchRole; judgeIds: string[] } {
  const confident = confidentJudges(s);
  if (confident.length === 0) {
    const role = COLD_ROTATION[state.cursor++ % COLD_ROTATION.length]!;
    return { role, judgeIds: [] };
  }
  let role = WARM_ROTATION[state.cursor++ % WARM_ROTATION.length]!;
  const div = divergence(s.taste, s.judges.map((j) => j.judgeId), now);
  if (role === 'bridge') {
    if (div) return { role, judgeIds: [div.judgeA, div.judgeB] };
    role = 'fit';
  }
  if (role === 'fit') {
    const judgeId = confident[state.fitTurn++ % confident.length]!;
    return { role, judgeIds: [judgeId] };
  }
  return { role, judgeIds: [] };
}

/** 生成を頼む枠を n 個決める */
export function planSlots(s: AuditionSession, state: PlannerState, n: number, now: number): GenerationSlot[] {
  const slots: GenerationSlot[] = [];
  // 生成用の回り方は選抜用とずらして、同じ役割ばかり作らないようにする
  const local: PlannerState = { cursor: state.cursor + 1, fitTurn: state.fitTurn };
  for (let i = 0; i < n; i++) {
    const { role, judgeIds } = nextRole(s, local, now);
    const persona = PERSONAS[(state.cursor * 3 + i * 5 + s.ideas.size) % PERSONAS.length]!;
    slots.push({ role, direction: directionFor(s, role, judgeIds, now), persona: { name: persona.name, how: persona.how } });
  }
  return slots;
}

function directionFor(s: AuditionSession, role: PitchRole, judgeIds: string[], now: number): string {
  let base: string;
  if (role === 'fit' && judgeIds[0]) {
    const top = strongestAxes(normalized(s.taste.judges[judgeIds[0]], now));
    const want = top.map((a) => describeAxis(a.axis, a.value)).join('・');
    base = `${judgeLabel(s, judgeIds[0])}が好む方向（${want || 'これまで選んだ案に近いもの'}）に寄せた案`;
  } else if (role === 'bridge' && judgeIds.length === 2) {
    const div = divergence(s.taste, judgeIds, now);
    const axis = div ? AXIS_LABEL[div.axis] : '方向性';
    base = `${judgeLabel(s, judgeIds[0]!)}は「${axis}」が高い案、${judgeLabel(s, judgeIds[1]!)}は低い案を好む。両方が「それならいい」と言える、両立・折衷の案`;
  } else if (role === 'wildcard') {
    base = '常識を外した、意外で大胆な案（好みは気にしなくてよい）';
  } else {
    const shownMean = meanProfile(shownIdeas(s).map((x) => x.profile));
    const top = strongestAxes(shownMean, 1, 0.15)[0];
    base = top
      ? `これまでの案は「${describeAxis(top.axis, top.value)}」に偏っている。その逆の方向の案`
      : 'まだ出ていない方向の案';
  }

  // 決勝進出者（合格者）がいる場合、既存合格案との重複を避ける指示を追加（B2）
  if (s.upper.length > 0) {
    const finalistTitles = s.upper
      .map((f) => s.characters.get(f.instanceId))
      .map((c) => (c ? s.currentRevision(c.ideaId).title : null))
      .filter((t): t is string => !!t);
    const titlesStr = finalistTitles.length > 0 ? `（${finalistTitles.join('、')}）` : '';
    return `${base}。既存の合格案${titlesStr}とはターゲット・価値提案・アプローチが重複しない新規性のある案`;
  }
  return base;
}

/** 生成に渡す好みの要約 */
export function tasteHint(s: AuditionSession, slots: GenerationSlot[], now: number): TasteHint {
  const judges = s.judges
    .filter((j) => (s.taste.judges[j.judgeId]?.signals ?? 0) > 0)
    .map((j) => {
      const v = normalized(s.taste.judges[j.judgeId], now);
      const axes = strongestAxes(v, 3, 0.15);
      return {
        label: JUDGE_SLOTS[j.slotIndex]!.label,
        likes: axes.filter((a) => a.value > 0).map((a) => `${AXIS_LABEL[a.axis]}が高い`),
        dislikes: axes.filter((a) => a.value < 0).map((a) => `${AXIS_LABEL[a.axis]}が高い`),
      };
    });
  const div = divergence(s.taste, s.judges.map((j) => j.judgeId), now);
  return {
    judges,
    divergence: div ? `${judgeLabel(s, div.judgeA)}と${judgeLabel(s, div.judgeB)}は「${AXIS_LABEL[div.axis]}」で好みが割れている` : null,
    slots,
  };
}

/* ------------------------------ 選抜 ------------------------------ */

/** 決勝の案とこれ以上近ければ「ほぼ同じ案」とみなす（埋め込みとプロフィールの近さ） */
const NEAR_DUPLICATE = 0.85;

/** 表記ゆれを無視した企画名（漢字の「段」とカタカナの「ダン」など、よくあるものだけ） */
function looseTitle(t: string) {
  return t
    .replace(/[\s・ー〜]/g, '')
    .replace(/段/g, 'ダン')
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

function meanProfile(vs: Vec[]): Vec {
  if (vs.length === 0) return zeros();
  return zeros().map((_, i) => vs.reduce((a, v) => a + (v[i] ?? 0), 0) / vs.length);
}

function shownIdeas(s: AuditionSession) {
  const onStage = new Set([...s.lowerSlots.filter((x): x is string => !!x), ...s.upper.map((f) => f.instanceId)]);
  const recentArchived = s.ideaBox.slice(-6).map((a) => a.ideaId);
  const ideaIds = new Set<string>(recentArchived);
  for (const id of onStage) {
    const c = s.characters.get(id);
    if (c) ideaIds.add(c.ideaId);
  }
  return [...ideaIds]
    .map((id) => s.ideas.get(id))
    .filter((i) => !!i)
    .map((i) => ({ title: i.revisions[0]!.title, profile: i.revisions.at(-1)!.profile ?? zeros() }));
}

/** 審査員が決勝に選んだ案の埋め込みの重心 */
function centroidOf(s: AuditionSession, judgeId: string, embed: (title: string) => Vec | null): Vec | null {
  const vecs = s.decisions
    .filter((d) => d.kind === 'promoted' && d.judgeId === judgeId)
    .map((d) => embed(d.title))
    .filter((v): v is Vec => !!v);
  if (vecs.length === 0) return null;
  return vecs[0]!.map((_, i) => vecs.reduce((a, v) => a + v[i]!, 0) / vecs.length);
}

/**
 * 空いた枠に出す1案をストックから選ぶ。役割に合う候補を MMR つきで点数にし、温度つきで抽選する。
 */
export function chooseFromStock(
  s: AuditionSession,
  state: PlannerState,
  stock: readonly IdeaDraft[],
  embed: (title: string) => Vec | null,
  now: number,
  rng: () => number,
): { index: number; pitch: Pitch | null } | null {
  if (stock.length === 0) return null;
  const { role, judgeIds } = nextRole(s, state, now);
  const shown = shownIdeas(s).map((x) => ({ profile: x.profile, embedding: embed(x.title) }));
  const targets =
    role === 'fit' || role === 'bridge'
      ? judgeIds.length
        ? judgeIds.map((j) => normalized(s.taste.judges[j], now))
        : [teamTaste(s.taste, s.judges.map((j) => j.judgeId), now)]
      : [];
  const centroids = judgeIds.map((j) => centroidOf(s, j, embed));
  const all: Candidate[] = stock.map((d, index) => ({
    index,
    profile: d.profile ?? zeros(),
    embedding: embed(d.title),
  }));
  const finalists = s.upper
    .map((f) => s.characters.get(f.instanceId))
    .map((c) => (c ? s.ideas.get(c.ideaId) : undefined))
    .filter((i) => !!i)
    .map((i) => ({ profile: i.revisions.at(-1)!.profile ?? zeros(), embedding: embed(i.revisions[0]!.title) }));
  // 決勝の案とほぼ同じ案（「一坪ダンボール横丁」と「一坪段ボール横丁」など）は、どの枠でも出さない
  const finalTitles = new Set(
    s.upper
      .map((f) => s.characters.get(f.instanceId))
      .map((c) => (c ? s.ideas.get(c.ideaId) : undefined))
      .filter((i) => !!i)
      .flatMap((i) => i.revisions.map((r) => looseTitle(r.title))),
  );
  const distinct = all.filter((c) => !finalTitles.has(looseTitle(stock[c.index]!.title)) && closeness(c, finalists) < NEAR_DUPLICATE);
  const candidates = distinct.length > 0 ? distinct : all;
  const picked = sample(candidates, { role, targets, centroids, shown, finalists, mu: 0.35, temperature: 0.12 }, rng);
  if (!picked) return null;
  return { index: picked.index, pitch: pitchFor(s, role, judgeIds, stock[picked.index]!, now) };
}

function pitchFor(s: AuditionSession, role: PitchRole, judgeIds: string[], draft: IdeaDraft, now: number): Pitch {
  if (role === 'fit' && judgeIds[0]) {
    const taste = normalized(s.taste.judges[judgeIds[0]], now);
    // 好みとこの案が両方強い軸を理由にする
    const shared = (draft.profile ?? zeros())
      .map((v, axis) => ({ axis, value: v, score: v * taste[axis]! }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)[0];
    const why = shared ? describeAxis(shared.axis, shared.value) : 'これまでの反応から';
    return { role, judgeIds, reason: `${shortLabel(s, judgeIds[0])}好み：${why}` };
  }
  if (role === 'bridge' && judgeIds.length === 2) {
    return { role, judgeIds, reason: `${shortLabel(s, judgeIds[0]!)}と${shortLabel(s, judgeIds[1]!)}の間をとる案` };
  }
  if (role === 'explore') return { role, judgeIds: [], reason: 'まだ出ていない方向' };
  return { role, judgeIds: [], reason: 'ワイルドカード' };
}

/* --------------------- 合格後の文脈フィルタ（B2） --------------------- */

export type ContextFilterStrategy = 'reset_with_summary' | 'drop_all' | 'keep_recent_only';

export interface ContextFilterOptions {
  strategy?: ContextFilterStrategy;
  recentCount?: number;
}

/**
 * 1人目以降が合格（決勝進出）した際にAI生成プランナーに渡す会話文脈を制御する（B2）。
 * 実験・比較可能な3つの戦略を提供する:
 * - 'reset_with_summary' (推奨デフォルト): 合格前の会話（発言・まだ決まっていない論点）はクリアし、合格者の概要（[合格済み案] タイトル: キャッチコピー）に置き換える。
 *   チームで決めた条件（合意した論点）と、否定した方向（却下した論点・見送った案）は残す（合意を次の案に反映し続けるため）
 * - 'drop_all': 会話履歴・合意台帳を完全リセット
 * - 'keep_recent_only': 直近N件（デフォルト2件）の発言のみ渡す
 */
export function filterContextForGeneration(
  s: AuditionSession,
  rawContext: ConsensusContext,
  options?: ContextFilterOptions,
): ConsensusContext {
  const strategy = options?.strategy ?? 'reset_with_summary';
  if (s.upper.length === 0) return rawContext;

  const finalists = s.upper
    .map((f) => s.characters.get(f.instanceId))
    .map((c) => (c ? s.ideas.get(c.ideaId) : undefined))
    .filter((i): i is NonNullable<typeof i> => !!i);

  switch (strategy) {
    case 'drop_all':
      return {
        version: rawContext.version,
        agreed: [],
        proposed: [],
        rejected: [],
        favoredIdeas: [],
        rejectedIdeas: [],
        recentRemarks: [],
      };
    case 'keep_recent_only': {
      const count = options?.recentCount ?? 2;
      return {
        ...rawContext,
        agreed: [],
        proposed: [],
        rejected: [],
        recentRemarks: rawContext.recentRemarks.slice(-count),
      };
    }
    case 'reset_with_summary':
    default: {
      const summaries = finalists.map((idea) => {
        const rev = idea.revisions.at(-1)!;
        const catchphrase = rev.summary.split('\n')[0] ?? rev.summary;
        return `[合格済み案] ${rev.title}: ${catchphrase}`;
      });
      return {
        version: rawContext.version,
        // 決まった条件と、否定した方向は残す。合格した案についての会話だけを外す
        agreed: rawContext.agreed,
        proposed: [],
        rejected: rawContext.rejected,
        favoredIdeas: finalists.map((i) => i.revisions.at(-1)!.title),
        rejectedIdeas: rawContext.rejectedIdeas,
        recentRemarks: summaries.map((text) => ({
          judge: '合格決定',
          text,
        })),
      };
    }
  }
}
