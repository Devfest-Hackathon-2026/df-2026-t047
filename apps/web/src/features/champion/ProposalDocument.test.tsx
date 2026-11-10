import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ProposalContent, SessionSnapshot } from '@idea-audition/protocol';
import { PROPOSAL_PAGES, ProposalDocument } from './ProposalDocument.tsx';

function makeSampleSnapshot(): { snapshot: SessionSnapshot; content: ProposalContent } {
  const content: ProposalContent = {
    title: '放課後30分のミニ探検クラブ',
    catchphrase: '学校帰りの30分が、発見の冒険に変わる',
    background: '放課後の短時間で気軽に参加できる体験が求められている。',
    problem: '長時間の習い事は負担が重く続きにくい。',
    target: '小学校中学年と共働き家庭',
    value: '30分で完結する地域探検で知的好奇心を育てる。',
    overview: '地域の商店街や公園を舞台に、毎回1つの謎を解く30分のミニ探検プログラム。',
    features: [
      { name: '30分完結ミッション', detail: '集合から振り返りまで30分で完結' },
      { name: '発見カード記録', detail: '見つけた視点を写真と一言で残す' },
    ],
    plan: [
      { phase: '準備', period: '1〜2週目', tasks: 'ルート安全確認とミッション作成' },
      { phase: '試行', period: '3〜4週目', tasks: '少人数でのテスト開催' },
    ],
    resources: '運営スタッフ2名・地域協力店3店舗',
    budget: '初期印刷・保険費用として3万円',
    risks: [{ risk: '雨天時の移動', mitigation: '屋内施設版ミッションを用意' }],
    kpis: ['参加児童の継続率80%以上'],
    assumptions: ['学校から徒歩10分圏内に集合場所があること'],
    nextActions: ['近隣公民館へのヒアリング'],
    imageUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=',
  };

  const snapshot: SessionSnapshot = {
    sessionId: 'sess-1',
    seq: 10,
    status: 'completed',
    mode: 'solo',
    theme: '放課後の新しい過ごし方',
    startedAt: '2026-11-09T10:00:00.000Z',
    lowerSlots: [null],
    upper: [{ instanceId: 'inst-1', status: 'ready' }],
    judges: [
      {
        judgeId: 'j1',
        label: '審査員A',
        color: '#7a3fc8',
        connected: true,
        isHost: true,
        joinedAt: '2026-11-09T10:00:00.000Z',
      },
    ],
    characters: {
      'inst-1': {
        instanceId: 'inst-1',
        ideaId: 'idea-1',
        designId: 0,
        name: 'ルミナ',
        accent: '#a45cff',
        location: 'upper',
        mentions: 2,
        leavingAt: null,
        reaction: null,
      },
    },
    ideas: {
      'idea-1': {
        ideaId: 'idea-1',
        persona: null,
        pitch: { role: 'fit', judgeIds: ['j1'], reason: '短時間重視の傾向に合致' },
        revisions: [
          {
            revisionId: 'rev-1',
            version: 1,
            title: content.title,
            summary: '30分で地域を探検する放課後クラブ',
            icon: '🔍',
            outline: {
              who: '小学校中学年と共働き家庭',
              pain: '長時間の習い事は負担が重い',
              how: '30分完結の地域ミニ探検',
            },
            basedOnRevisionId: null,
            basedOnConsensus: null,
            profile: null,
            reason: null,
            keepStrengths: ['30分で終わる手軽さ'],
            improvementPoints: ['雨天時の代替ルートを追加'],
            inspiredBy: null,
            createdAt: '2026-11-09T10:01:00.000Z',
          },
        ],
      },
    },
    ideaBox: [],
    consensus: {
      version: 1,
      claims: [
        {
          label: 'C1',
          text: '30分以内で完結すること',
          status: 'agreed',
          pinned: true,
          stances: { j1: 'support' },
          supersededBy: null,
          createdBy: 'j1',
          createdAt: '2026-11-09T10:02:00.000Z',
          updatedAt: '2026-11-09T10:02:00.000Z',
          history: [{ judgeId: 'j1', stance: 'support', at: '2026-11-09T10:02:00.000Z' }],
        },
      ],
    },
    critiques: [],
    answers: [],
    vote: null,
    champion: {
      instanceId: 'inst-1',
      ideaId: 'idea-1',
      revisionId: 'rev-1',
    },
    proposal: {
      status: 'ready',
      content,
      generatedBy: 'fixture',
      generatedAt: '2026-11-09T10:06:05.000Z',
    },
    ai: { mode: 'fixture', available: ['fixture'] },
    taste: {
      version: 1,
      judges: { j1: [0.6, 0.2, -0.1, 0.4, 0.1, 0.3, 0, 0] },
      signals: { j1: 3 },
      team: [0.6, 0.2, -0.1, 0.4, 0.1, 0.3, 0, 0],
      divergence: null,
    },
    metrics: {
      firstHalf: { shown: 4, picked: 1 },
      secondHalf: { shown: 4, picked: 3 },
      liftPct: 50,
      byRole: { fit: { shown: 3, picked: 2 } },
      revisions: { shown: 1, picked: 1 },
    },
  };
  return { snapshot, content };
}

describe('ProposalDocument', () => {
  it('renders original 2-part proposal layout with embedded concept image when page is omitted', () => {
    const { snapshot, content } = makeSampleSnapshot();
    const html = renderToStaticMarkup(<ProposalDocument snapshot={snapshot} content={content} />);
    expect(PROPOSAL_PAGES).toHaveLength(2);
    expect(html).toContain('data-page="1"');
    expect(html).toContain('data-page="2"');
    expect(html).toContain('data-mascot-design="0"');
    expect(html).toContain('data-proposal-visual="true"');
    expect(html).toContain('IDEA AUDITION · 企画書');
    expect(html).toContain('IDEA AUDITION · 審査レポート');
    expect(html).toContain('この企画に決まるまで');
    expect(html).not.toContain('color-mix');
  });

  it('renders only the requested part when page index is passed for the in-screen viewer', () => {
    const { snapshot, content } = makeSampleSnapshot();
    for (const p of PROPOSAL_PAGES) {
      const html = renderToStaticMarkup(<ProposalDocument snapshot={snapshot} content={content} page={p.index} preview />);
      expect(html).toContain(`data-page="${p.index + 1}"`);
      for (const other of PROPOSAL_PAGES) {
        if (other.index !== p.index) {
          expect(html).not.toContain(`data-page="${other.index + 1}"`);
        }
      }
    }
  });

  it('keeps ProposalDocument heading and alignment styles isolated from ChampionScreen dark-theme rules', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const championCss = readFileSync(resolve(dir, 'Champion.module.css'), 'utf8');
    const docCss = readFileSync(resolve(dir, 'ProposalDocument.module.css'), 'utf8');

    expect(championCss).not.toMatch(/\.champion(?:\[[^\]]+\])?\s+h[12]\b/);
    expect(championCss).toMatch(/\.hero\s+h1\b/);
    expect(championCss).toMatch(/\.body\s+h2\b/);
    expect(docCss).toMatch(/\.doc\s*\{[^}]*text-align:\s*left/);
  });
});
