/**
 * 1回選んだだけで同じ方向の案ばかりにならないための仕組み（プレイテスト 2026-11-08 の P0-1）。
 */
import { describe, expect, it } from 'vitest';
import { filterContextForGeneration, newPlannerState, planSlots } from '../src/application/generation-planner.ts';
import type { ConsensusContext } from '../src/application/ports.ts';
import { roleScore, type Candidate } from '../src/domain/selection.ts';
import { AuditionSession } from '../src/domain/session.ts';
import { GeminiGateway, type GenerateContentClient } from '../src/infrastructure/gemini/gemini-gateway.ts';
import { fakeClock, seqIds } from './helpers.ts';

const vec = (...xs: number[]) => [...xs, ...Array(8 - xs.length).fill(0)];

describe('同じ方向ばかりにしない', () => {
  it('探る枠・ワイルドカードでは、決勝の案に近い候補ほど点が下がる', () => {
    const food = { profile: vec(1, 0, 0), embedding: [1, 0, 0] };
    const near: Candidate = { index: 0, profile: vec(0.9, 0.1, 0), embedding: [0.95, 0.05, 0] };
    const far: Candidate = { index: 1, profile: vec(0, 0, 1), embedding: [0, 0, 1] };
    for (const role of ['explore', 'wildcard'] as const) {
      const ctx = { role, targets: [], centroids: [], shown: [], finalists: [food], mu: 0.35, temperature: 0.12 };
      expect(roleScore(far, ctx)).toBeGreaterThan(roleScore(near, ctx));
      // 決勝が無いときは、決勝への近さで減点しない
      expect(roleScore(near, { ...ctx, finalists: [] })).toBeGreaterThan(roleScore(near, ctx));
    }
  });

  it('生成：合意や選ばれた案を伸ばすのは好み・折衷の枠だけ。ほかの枠には、それと別の側面から考えるよう頼む', async () => {
    const calls: string[] = [];
    const client: GenerateContentClient = {
      models: {
        async generateContent(params) {
          calls.push(`${JSON.stringify(params.config)}\n${params.contents}`);
          return {
            text: JSON.stringify({
              ideas: [{ slot: 0, title: '案', reading: 'アン', aliases: [], summary: 'a\nb', who: 'w', pain: 'p', how: 'h', icon: '☆', inspiredBy: [], note: '', profile: { cost: 0, novelty: 0, ease: 0, buzz: 0, sustain: 0, social: 0, scale: 0, reach: 0 } }],
            }),
          };
        },
      },
    };
    const g = new GeminiGateway(client, {
      fast: { model: 'f', thinkingLevel: 'MINIMAL', timeoutMs: 1000 },
      refine: { model: 'r', thinkingLevel: 'LOW', timeoutMs: 1000 },
    });
    await g.generateIdeas({
      theme: '商店街に若者を',
      count: 2,
      avoidTitles: [],
      context: {
        version: 1,
        agreed: [{ label: 'C1', text: '自炊が苦手な学生を支援する', supporters: ['審査員 A'] }],
        proposed: [],
        rejected: [],
        favoredIdeas: ['若者と街の夕食シェア食堂'],
        rejectedIdeas: [],
        recentRemarks: [],
      },
    });
    expect(calls[0]).toContain('すべての案をその方向に寄せる」という意味ではない');
    expect(calls[0]).toContain('伸ばしてよいのは、方向が「〜が好む方向」「両立・折衷」の枠だけ');
    expect(calls[0]).toContain('テーマの別の側面から考える：若者と街の夕食シェア食堂／自炊が苦手な学生を支援する');
  });

  it('合格者が出たあとの文脈フィルタリング戦略（Issue #6 [B2]）', () => {
    const s = new AuditionSession('s', { ids: seqIds(), clock: fakeClock(), lowerSlotCount: 5 });
    s.join();
    s.start('テーマ', 'solo');
    s.addToStock([
      { title: '合格案A', summary: '学生向けの格安定食\n夜遅くまで営業', icon: '🍲', outline: { who: '学生', pain: 'お金がない', how: '格安定食' } },
      { title: '候補案B', summary: '概要B', icon: '☕', outline: { who: '誰か', pain: '困りごと', how: '解決' } },
    ]);
    s.fillEmptySlots();

    const rawContext: ConsensusContext = {
      version: 1,
      agreed: [{ label: 'C1', text: '安さを最優先にする', supporters: ['審査員1'] }],
      proposed: [{ label: 'C2', text: '夜間営業', support: ['審査員1'], oppose: [] }],
      rejected: [{ label: 'C3', text: '高級食材' }],
      favoredIdeas: ['合格案A'],
      rejectedIdeas: [],
      recentRemarks: [
        { judge: '審査員1', text: '安くてお腹いっぱいになるのが一番' },
        { judge: '審査員1', text: '定食スタイルがいいね' },
        { judge: '審査員1', text: '直近の新しい発言' },
      ],
    };

    // 合格者がまだいない場合：文脈は加工されない
    const ctxNoFinalist = filterContextForGeneration(s, rawContext, { strategy: 'reset_with_summary' });
    expect(ctxNoFinalist).toEqual(rawContext);

    // 1人目合格（上段へ昇格）
    const target = s.lowerSlots.find((x: string | null): x is string => x !== null)!;
    s.promote(target);
    expect(s.upper).toHaveLength(1);

    // 1. reset_with_summary（推奨デフォルト）：合格前の会話と未決の論点は外し、合格案の概要に置き換える。決まった条件と否定した方向は残す
    const ctxSummary = filterContextForGeneration(s, rawContext, { strategy: 'reset_with_summary' });
    expect(ctxSummary.agreed).toEqual(rawContext.agreed);
    expect(ctxSummary.proposed).toEqual([]);
    expect(ctxSummary.rejected).toEqual(rawContext.rejected);
    expect(ctxSummary.favoredIdeas).toEqual(['合格案A']);
    expect(ctxSummary.recentRemarks).toHaveLength(1);
    expect(ctxSummary.recentRemarks[0]!.judge).toBe('合格決定');
    expect(ctxSummary.recentRemarks[0]!.text).toContain('[合格済み案] 合格案A');

    // 2. drop_all：完全リセット
    const ctxDrop = filterContextForGeneration(s, rawContext, { strategy: 'drop_all' });
    expect(ctxDrop.agreed).toEqual([]);
    expect(ctxDrop.proposed).toEqual([]);
    expect(ctxDrop.rejected).toEqual([]);
    expect(ctxDrop.favoredIdeas).toEqual([]);
    expect(ctxDrop.recentRemarks).toEqual([]);

    // 3. keep_recent_only：直近N件のみ残す
    const ctxRecent = filterContextForGeneration(s, rawContext, { strategy: 'keep_recent_only', recentCount: 2 });
    expect(ctxRecent.agreed).toEqual([]);
    expect(ctxRecent.recentRemarks).toHaveLength(2);
    expect(ctxRecent.recentRemarks[1]!.text).toBe('直近の新しい発言');
  });

  it('合格者がいる場合、生成スロットの方向指示に既存合格案との重複回避プロンプトが含まれる（Issue #6 [B2]）', () => {
    const s = new AuditionSession('s', { ids: seqIds(), clock: fakeClock(), lowerSlotCount: 5 });
    s.join();
    s.start('テーマ', 'solo');
    s.addToStock([
      { title: '合格案X', summary: 'X概要', icon: '🍲' },
      { title: '候補Y', summary: 'Y概要', icon: '☕' },
    ]);
    s.fillEmptySlots();
    const target = s.lowerSlots.find((x) => x !== null)!;
    s.promote(target);

    const planner = newPlannerState();
    const slots = planSlots(s, planner, 3, fakeClock().now());
    for (const slot of slots) {
      expect(slot.direction).toContain('既存の合格案（合格案X）とはターゲット・価値提案・アプローチが重複しない新規性のある案');
    }
  });

  it('fitおよびbridge枠でも、決勝進出案に近い候補ほど roleScore が減点される（Issue #6 [B2]）', () => {
    const food = { profile: vec(1, 0, 0), embedding: [1, 0, 0] };
    const near: Candidate = { index: 0, profile: vec(0.9, 0.1, 0), embedding: [0.95, 0.05, 0] };
    const far: Candidate = { index: 1, profile: vec(0, 0, 1), embedding: [0, 0, 1] };
    for (const role of ['fit', 'bridge'] as const) {
      const targetVec = vec(0.8, 0.2, 0);
      const ctx = {
        role,
        targets: [targetVec, targetVec],
        centroids: [null, null],
        shown: [],
        finalists: [food],
        mu: 0.35,
        temperature: 0.12,
      };
      // 決勝の案がいないときは減点されない
      const scoreWithoutFinalist = roleScore(near, { ...ctx, finalists: [] });
      const scoreWithFinalist = roleScore(near, ctx);
      expect(scoreWithoutFinalist).toBeGreaterThan(scoreWithFinalist);
    }
  });
});
