import { describe, expect, it } from 'vitest';
import { GeminiGateway, type GenerateContentClient } from '../src/infrastructure/gemini/gemini-gateway.ts';
import { ResilientGateway } from '../src/infrastructure/resilient-gateway.ts';
import { FixtureGateway } from '../src/infrastructure/fixture/fixture-gateway.ts';
import { StubAi } from './helpers.ts';

const config = {
  fast: { model: 'fast-model', thinkingLevel: 'MINIMAL' as const, timeoutMs: 1000 },
  refine: { model: 'refine-model', thinkingLevel: 'LOW' as const, timeoutMs: 1000 },
};

function fakeClient(responses: (string | Error)[]) {
  const calls: { model: string; contents: string; config: Record<string, unknown> }[] = [];
  const client: GenerateContentClient = {
    models: {
      async generateContent(params) {
        calls.push(params);
        const next = responses.shift();
        if (next instanceof Error) throw next;
        return { text: next };
      },
    },
  };
  return { client, calls };
}

const P = { cost: -0.5, novelty: 0.8, ease: 0.2, buzz: 2, sustain: 0, social: 0, scale: 0, reach: 0 };

const participants = [
  { instanceId: 'ch_a', characterName: 'MOMO', title: '案A', summary: 'a1\na2', version: 1 },
  { instanceId: 'ch_b', characterName: 'LUNA', title: '案B', summary: 'b1\nb2', version: 2 },
];

describe('GeminiGateway', () => {
  it('案の生成：改行の二重エスケープを直し、2行・指定件数に整える', async () => {
    const { client, calls } = fakeClient([
      JSON.stringify({
        ideas: [
          { slot: 0, title: 'ガチャ学食', reading: 'ガチャガクショク', aliases: ['ガチャ', '学食ガチャ', 'ガチャ学食', 'ガ'], summary: '何が出るかお楽しみ\\n日替わりメニュー\\n3行目', who: 'w', pain: 'p', how: 'h', icon: '☆', inspiredBy: [], note: '', profile: P },
          { slot: 0, title: '郷土の味', reading: 'きょうどのあじ', aliases: [], summary: '全国の味を\n週替わりで', who: 'w', pain: 'p', how: 'h', icon: '◎', inspiredBy: [], note: '', profile: P },
        ],
      }),
    ]);
    const g = new GeminiGateway(client, config);
    const ideas = await g.generateIdeas({ theme: '学食', count: 1, avoidTitles: [] });
    // 8軸は TASTE_AXES の順の配列になり、範囲外（buzz=2）は +1 に収まる
    expect(ideas).toEqual([
      { title: 'ガチャ学食', summary: '何が出るかお楽しみ\n日替わりメニュー', icon: '☆', inspiredBy: null, profile: [-0.5, 0.8, 0.2, 1, 0, 0, 0, 0], persona: undefined, reading: 'ガチャガクショク', aliases: ['ガチャ'], outline: { who: 'w', pain: 'p', how: 'h' } },
    ]);
    expect(calls[0]!.model).toBe('fast-model');
    expect(calls[0]!.config.responseMimeType).toBe('application/json');
  });

  it('好みエンジンの枠：枠ごとの方向と発想の型をプロンプトに入れ、slot の番号で発想の型を付ける', async () => {
    const { client, calls } = fakeClient([
      JSON.stringify({
        ideas: [
          { slot: 2, title: '両立案', reading: 'リョウリツアン', aliases: [], summary: 'a\nb', who: 'w', pain: 'p', how: 'h', icon: '◎', inspiredBy: [], note: '', profile: P },
          { slot: 1, title: '好み案', reading: 'コノミアン', aliases: [], summary: 'c\nd', who: 'w', pain: 'p', how: 'h', icon: '☆', inspiredBy: [], note: '', profile: P },
        ],
      }),
    ]);
    const g = new GeminiGateway(client, config);
    const ideas = await g.generateIdeas({
      theme: '学食',
      count: 2,
      avoidTitles: [],
      taste: {
        judges: [{ label: '審査員 A', likes: ['手軽さが高い'], dislikes: ['コストが高い'] }],
        divergence: '審査員 Aと審査員 Bは「コスト」で好みが割れている',
        slots: [
          { role: 'fit', direction: '審査員 Aが好む方向', persona: { name: '逆転の発想', how: 'ひっくり返す' } },
          { role: 'bridge', direction: '両方が納得する折衷の案', persona: { name: '制約から考える', how: '予算ゼロ' } },
        ],
      },
    });
    expect(ideas.map((i) => [i.title, i.persona])).toEqual([
      ['両立案', '制約から考える'],
      ['好み案', '逆転の発想'],
    ]);
    expect(calls[0]!.contents).toContain('枠2：方向＝両方が納得する折衷の案／発想の型＝制約から考える');
    expect(calls[0]!.contents).toContain('審査員 A：好き＝手軽さが高い');
    expect(calls[0]!.contents).toContain('「コスト」で好みが割れている');
  });

  it('迷いの別案：元の案と迷いの言葉を渡し、8軸つきで1案返す', async () => {
    const { client, calls } = fakeClient([JSON.stringify({ title: 'ミニ屋台', reading: 'ミニヤタイ', aliases: ['屋台'], summary: '1日だけ\nまず小さく', icon: '♧', keepStrength: '屋台のにぎわい', improvement: '1日だけ・1か所で試す', changeNote: '大がかりすぎたので小さく始める形に', profile: P })]);
    const g = new GeminiGateway(client, config);
    const out = await g.varyIdea({ theme: '学食', characterName: 'MOMO', idea: { title: '屋台村', summary: 'a\nb', profile: null }, concern: 'うーん高そう' });
    expect(out).toMatchObject({
      title: 'ミニ屋台',
      summary: '1日だけ\nまず小さく',
      aliases: ['屋台'],
      profile: [-0.5, 0.8, 0.2, 1, 0, 0, 0, 0],
      keepStrengths: ['屋台のにぎわい'],
      improvementPoints: ['1日だけ・1か所で試す'],
      changeNote: '大がかりすぎたので小さく始める形に',
    });
    expect(calls[0]!.contents).toContain('うーん高そう');
  });

  it('改良：話し手と相手は決めた順番を使い、P1/P2 を instanceId に戻す', async () => {
    const { client, calls } = fakeClient([
      JSON.stringify({
        critiques: [
          { round: 1, text: 'コストを下げよう' },
          { round: 2, text: '対象を絞ったら？' },
        ],
        revisions: [
          { participant: 'P2', title: '案B+', summary: 'x\ny', keepStrengths: ['強み'], improvementPoints: ['改善1', '改善2'], reason: '指摘を反映', inspiredBy: [] , who: '学生', pain: '混む', how: '予約で解く' },
          { participant: 'P9', title: '不明', summary: 'z', keepStrengths: ['a'], improvementPoints: ['b'], reason: 'c', inspiredBy: [] , who: '学生', pain: '混む', how: '予約で解く' },
          { participant: 'P1', title: '案A+', summary: 'p\nq', keepStrengths: ['強み'], improvementPoints: ['改善'], reason: '反映', inspiredBy: [] , who: '学生', pain: '混む', how: '予約で解く' },
        ],
      }),
    ]);
    const g = new GeminiGateway(client, config);
    const out = await g.refine({
      theme: '学食', trigger: 'arrival', participants, targets: ['ch_a', 'ch_b'], rounds: 2, instruction: null,
    });
    expect(out.critiques).toEqual([
      { round: 1, fromInstanceId: 'ch_a', toInstanceId: 'ch_b', text: 'コストを下げよう' },
      { round: 2, fromInstanceId: 'ch_b', toInstanceId: 'ch_a', text: '対象を絞ったら？' },
    ]);
    expect(Object.keys(out.revisions).sort()).toEqual(['ch_a', 'ch_b']);
    expect(out.revisions.ch_b!.title).toBe('案B+');
    // 改良した版の「誰の・困りごと・どう解く」は新しく書き直したものを持つ（旧版のものを残さない）
    expect(out.revisions.ch_b!.outline).toEqual({ who: '学生', pain: '混む', how: '予約で解く' });
    expect(calls[0]!.model).toBe('fast-model'); // 相互批評（arrival）は速いモデル
    expect(calls[0]!.contents).not.toContain('ch_a'); // モデルには内部IDを渡さない
  });

  it('不正な出力は1回やり直す', async () => {
    const { client, calls } = fakeClient(['{"ideas": "broken"}', JSON.stringify({ ideas: [{ slot: 0, title: 'T', reading: '', aliases: [], summary: 'S', who: 'w', pain: 'p', how: 'h', icon: '♡', inspiredBy: [], note: '', profile: P }] })]);
    const g = new GeminiGateway(client, config);
    const ideas = await g.generateIdeas({ theme: '学食', count: 1, avoidTitles: [] });
    expect(ideas).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it('2回とも失敗したら例外。ResilientGateway は固定データに切り替える', async () => {
    const { client } = fakeClient([new Error('timeout'), new Error('timeout')]);
    const g = new GeminiGateway(client, config);
    await expect(g.answer({ theme: 't', idea: { title: 'a', summary: 'b' }, characterName: 'MOMO', question: 'q' })).rejects.toThrow();

    const { client: c2 } = fakeClient([new Error('timeout'), new Error('timeout')]);
    const resilient = new ResilientGateway(new GeminiGateway(c2, config), new StubAi());
    await expect(resilient.answer({ theme: 't', idea: { title: 'a', summary: 'b' }, characterName: 'MOMO', question: 'q' })).resolves.toBe('回答:q');
  });

  it('使える改良版が1つもなければ例外（固定データに切り替えさせる）', async () => {
    const { client } = fakeClient([
      JSON.stringify({ critiques: [], revisions: [{ participant: 'P7', title: 'x', summary: 'y', keepStrengths: ['a'], improvementPoints: ['b'], reason: 'c', inspiredBy: [] , who: '学生', pain: '混む', how: '予約で解く' }] }),
    ]);
    const g = new GeminiGateway(client, config);
    await expect(
      g.refine({ theme: 't', trigger: 'promotion', participants: participants.slice(0, 1), targets: ['ch_a'], rounds: 0, instruction: null }),
    ).rejects.toThrow();
  });

  it('回答：意味が通らない質問は null（聞き直す）、通じる質問は答えを返す', async () => {
    const { client, calls } = fakeClient([
      JSON.stringify({ understood: false, answer: '' }),
      JSON.stringify({ understood: true, answer: '月500円です' }),
    ]);
    const g = new GeminiGateway(client, config);
    const input = { theme: 't', idea: { title: 'a', summary: 'b' }, characterName: 'MOMO', spoken: true };
    await expect(g.answer({ ...input, question: '学食一粒競りバトル分だけの' })).resolves.toBeNull();
    await expect(g.answer({ ...input, question: 'いくら？' })).resolves.toBe('月500円です');
    expect(calls[0]!.contents).toContain('声の文字起こしなので');
  });

  it('企画書イメージ画像生成：Imagen モデルは generateImages、Gemini Image モデルは generateContent で data URL を返す', async () => {
    const imgCalls: { model: string; prompt: string }[] = [];
    const imagenClient: GenerateContentClient = {
      models: {
        async generateContent() {
          return { text: '' };
        },
        async generateImages(params) {
          imgCalls.push({ model: params.model, prompt: params.prompt });
          return {
            generatedImages: [{ image: { imageBytes: 'QUJDRA==', mimeType: 'image/jpeg' } }],
          };
        },
      },
    };
    const gImagen = new GeminiGateway(imagenClient, {
      ...config,
      image: { model: 'imagen-3.0-generate-002', timeoutMs: 1000 },
    });
    const url1 = await gImagen.generateProposalImage({
      theme: '放課後',
      title: '30分探検クラブ',
      catchphrase: '毎日が冒険',
      problem: '習い事が長い',
      target: '小学生',
      value: '手軽な発見体験',
      overview: '地域を30分探検する',
    });
    expect(url1).toBe('data:image/jpeg;base64,QUJDRA==');
    expect(imgCalls[0]!.model).toBe('imagen-3.0-generate-002');
    expect(imgCalls[0]!.prompt).toContain('30分探検クラブ');

    const geminiImgClient: GenerateContentClient = {
      models: {
        async generateContent() {
          return {
            candidates: [
              {
                content: {
                  parts: [{ inlineData: { mimeType: 'image/png', data: 'WFla' } }],
                },
              },
            ],
          };
        },
      },
    };
    const gGeminiImg = new GeminiGateway(geminiImgClient, {
      ...config,
      image: { model: 'gemini-2.5-flash-image', timeoutMs: 1000 },
    });
    const url2 = await gGeminiImg.generateProposalImage({
      theme: '放課後',
      title: '30分探検クラブ',
      problem: '習い事が長い',
      target: '小学生',
      value: '手軽な発見体験',
      overview: '地域を30分探検する',
    });
    expect(url2).toBe('data:image/png;base64,WFla');
  });

  it('発言の仕分け：話題なら言い直した文、雑談・聞き間違いは残さない', async () => {
    const { client, calls } = fakeClient([
      JSON.stringify({ verdict: 'on_topic', summary: '費用はいくらかかりますか？', target: 0 }),
      JSON.stringify({ verdict: 'off_topic', summary: '', target: 0 }),
      JSON.stringify({ verdict: 'garbled', summary: '', target: 0 }),
      JSON.stringify({ verdict: 'on_topic', summary: '   ', target: 0 }),
    ]);
    const g = new GeminiGateway(client, config);
    const input = {
      theme: '学食',
      stage: [{ characterName: 'MOMO', title: '混雑予測ナビ', summary: '行列が分かる\n学食の混み具合を予測' }],
      recentRemarks: [{ judge: '審査員 A', text: 'コストは低めがいい' }],
      text: 'えーと費用ってどれくらい？',
    };
    await expect(g.triageUtterance(input)).resolves.toEqual({ keep: true, summary: '費用はいくらかかりますか？' });
    await expect(g.triageUtterance({ ...input, text: 'マイク聞こえてる？' })).resolves.toEqual({ keep: false, reason: 'off_topic' });
    await expect(g.triageUtterance({ ...input, text: 'ミストにぶとう' })).resolves.toEqual({ keep: false, reason: 'garbled' });
    // 話題だが言い直しが空なら、聞こえたままの文を使う（落とさない）
    await expect(g.triageUtterance(input)).resolves.toEqual({ keep: true, summary: null });
    // 速いモデルで、テーマ・舞台の企画・直前の発言・判定する発言をプロンプトに入れる
    expect(calls[0]!.model).toBe('fast-model');
    expect(calls[0]!.contents).toContain('MOMO：混雑予測ナビ');
    expect(calls[0]!.contents).toContain('審査員 A：「コストは低めがいい」');
    expect(calls[0]!.contents).toContain('発言：「えーと費用ってどれくらい？」');
  });

  it('発言の仕分け：名前を言わずに中身で話した案の番号を返す（範囲外の番号は捨てる）', async () => {
    const { client, calls } = fakeClient([
      JSON.stringify({ verdict: 'on_topic', summary: '余った食材を使う案の原価はいくらですか？', target: 2 }),
      JSON.stringify({ verdict: 'on_topic', summary: '全体として学生向けがいい', target: 9 }),
    ]);
    const g = new GeminiGateway(client, config);
    const input = {
      theme: '学食',
      stage: [
        { characterName: 'MOMO', title: '混雑予測ナビ', summary: '行列が分かる', letter: 'A' },
        { characterName: 'LUNA', title: '学食ガチャめし', summary: '余剰食材でランダム定食', letter: 'B' },
      ],
      recentRemarks: [],
      text: '余った食材使うやつ、原価っていくら？',
    };
    await expect(g.triageUtterance(input)).resolves.toEqual({ keep: true, summary: '余った食材を使う案の原価はいくらですか？', targetIndex: 2 });
    await expect(g.triageUtterance({ ...input, text: '全体として学生向けがいいね' })).resolves.toEqual({ keep: true, summary: '全体として学生向けがいい' });
    // 番号と記号を付けて渡す
    expect(calls[0]!.contents).toContain('2. B案・LUNA：学食ガチャめし');
  });

  it('発言の仕分け：呼び出しに失敗したら固定データの簡易な仕分けに切り替わる', async () => {
    const { client } = fakeClient([new Error('503')]);
    const fixture = new FixtureGateway(0);
    const resilient = new ResilientGateway(new GeminiGateway(client, config), fixture);
    const input = { theme: 't', stage: [], recentRemarks: [], text: '画面が重いんだけど' };
    await expect(resilient.triageUtterance(input)).resolves.toEqual({ keep: false, reason: 'off_topic' });
  });
});
