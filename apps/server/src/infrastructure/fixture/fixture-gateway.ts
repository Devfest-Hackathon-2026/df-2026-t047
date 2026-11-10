import { heuristicProfile } from '../local-taste.ts';
import type { IdeaDraft, RevisionDraft } from '../../domain/types.ts';
import type {
  ConsensusContext,
  ConsensusOpDraft,
  ConsensusUpdateInput,
  IdeaGenerationPort,
  ProposalImageInput,
  ProposalInput,
  RefineInput,
  RefineOutput,
  TasteHint,
  UtteranceTriage,
  UtteranceTriageInput,
  VaryInput,
} from '../../application/ports.ts';
import type { ProposalContent } from '@idea-audition/protocol';

/**
 * 外部 API なしで通しデモをするための固定データ（AC-33、ADR-0005 §1）。
 * 学食テーマの案は チームで作った初期の画面モックから流用。
 */
/** 固定データの企画の呼び名（本物の AI が付ける aliases のかわり） */
const FIXTURE_ALIASES: Record<string, string[]> = {
  'サークル飯マップ': ['サークル飯'],
  '混雑予測ナビ': ['混雑予測'],
  '学食スタンプラリー': ['スタンプラリー'],
  'AR食堂ツアー': ['食堂ツアー'],
  'おまかせランチくじ': ['ランチくじ'],
  '推しメニュー総選挙': ['総選挙'],
  'もったいない定食': ['もったいない'],
  'ひとり飯ラウンジ': ['ひとり飯', 'ラウンジ'],
  'シェフの実験室': ['実験室'],
  '朝ごはんパスポート': ['パスポート'],
};

const CAFETERIA_IDEAS: IdeaDraft[] = [
  ['サークル飯マップ', '同じ「好き」でつながる。\nサークルおすすめの学食を共有。', '♧'],
  ['混雑予測ナビ', 'もう、席探しに迷わない。\n空いている時間をAIがご案内。', '⌁'],
  ['世界の学食フェア', 'ランチで、世界を旅しよう。\n月替わりで楽しむ世界の料理。', '◎'],
  ['食べてポイント', 'いつものランチを、ごほうびに。\n学食を使うほど特典が貯まる。', '♧'],
  ['学食スタンプラリー', 'まだ知らない、おいしい発見。\n期間限定メニューを巡る冒険。', '♧'],
  ['AR食堂ツアー', 'スマホをかざして食堂探検。\nメニューの物語に出会える。', '◇'],
  ['学食パーソナライズ', 'あなたにぴったりの一皿。\n好みと栄養からAIがご提案。', '♡'],
  ['学食×コミュニティ', '「いただきます」で友達に。\n食の好みでつながる昼休み。', '♧'],
  ['おまかせランチくじ', '今日のお昼は運まかせ。\n新しいお気に入りを発見。', '✧'],
  ['推しメニュー総選挙', '次の限定メニューを決めよう。\nみんなの一票がおいしさに。', '☆'],
  ['もったいない定食', 'おいしく食べてロスを減らす。\n閉店前の限定セットを予約。', '♧'],
  ['ひとり飯ラウンジ', 'ひとりでも、心地いい。\n静かに過ごせる席を見つける。', '☾'],
  ['シェフの実験室', '学生のアイデアが一皿に。\n料理長と新メニューを開発。', '✧'],
  ['朝ごはんパスポート', '一日の始まりをおいしく。\nお得な朝食で生活リズムを。', '☀'],
  ['学食おすそわけ便', '忙しい友達に届けよう。\n昼ごはんの持ち帰り予約。', '◇'],
].map(([title, summary, icon]) => ({ title: title!, summary: summary!, icon: icon!, ...(FIXTURE_ALIASES[title!] ? { aliases: FIXTURE_ALIASES[title!] } : {}) }));

const GENERIC_PATTERNS: [string, string, string][] = [
  ['{t}スタンプラリー', '巡るほど楽しくなる。\n{t}を小さな冒険に。', '♧'],
  ['{t}マッチング', '同じ関心の人とつながる。\n{t}をきっかけに出会う。', '♡'],
  ['{t}ランキング', 'みんなの一票で決まる。\n{t}の「推し」を見える化。', '☆'],
  ['{t}おまかせくじ', '偶然の出会いを楽しむ。\n{t}を運まかせで体験。', '✧'],
  ['{t}ナビ', '迷わず、すぐ見つかる。\n{t}をAIが案内。', '⌁'],
  ['{t}ラボ', 'アイデアを持ち寄って試す。\n{t}をみんなで実験。', '◇'],
  ['{t}パスポート', '使うほど特典が増える。\n{t}を続けたくなる仕組み。', '◎'],
  ['{t}ナイトイベント', '夜だけの特別な時間。\n{t}をイベントで盛り上げる。', '☾'],
];

const CRITIQUES = [
  '実現コストをもう少し下げよう！',
  '対象をもっと絞ったほうが刺さりそう。',
  '続けて使いたくなる理由はある？',
  'その強み、こっちの案と組み合わせられるかも。',
  '最初の一歩を小さくすれば、すぐ試せそう！',
  '大学ならではの広がり方ができそう！',
  '体験の「ワクワク」をもっと前に出そう。',
  '運営する人の負担はどう減らす？',
];

const IMPROVEMENTS = [
  ['学内の限られた場所で小さく試す', '既存のメニュー情報を使い、初期費用を抑える'],
  ['対象を新入生に絞って参加のきっかけを作る', '参加特典で2回目の利用につなげる'],
  ['友達と一緒に参加できる仕組みを追加', '結果をSNSで共有しやすくする'],
  ['運営側の作業を週1回の更新だけにする', '学生スタッフと一緒に運営する'],
];

const SUMMARY_SUFFIX = [
  '\nまずは学内限定で、小さく始める。',
  '\n仲間と参加できて、続けたくなる。',
  '\n運営の手間を減らし、すぐ試せる。',
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 固定データ用の簡易な仕分け：アプリ・機材の話だけ落とす（言い直しはしない） */
const APP_TALK = /マイク|音声|聞こえ|画面|ボタン|アプリ|バグ|重い|固まっ|接続|通信|ログイン/;
const AGREE = /賛成|いいね|それで(いこう|行こう)|同意|わかる|確かに|それな|ありだね|アリ/;
const DISAGREE = /反対|微妙|違う|それは(ない|ちょっと)|いや[、,]|ナシ|やめよう/;
const WISH = /したい|がいい|にして|べき|ほしい|欲しい|低め|安く|重視|優先|絞ろう|にしよう/;

export class FixtureGateway implements IdeaGenerationPort {
  readonly name = 'fixture';
  private cursor = 0;
  private varyCursor = 0;

  constructor(private readonly latencyMs = 900) {}

  async generateIdeas(input: {
    theme: string;
    count: number;
    avoidTitles: string[];
    context?: ConsensusContext;
    taste?: TasteHint;
  }): Promise<IdeaDraft[]> {
    await sleep(this.latencyMs * 0.5);
    const slots = input.taste?.slots;
    const pool = /学食|食堂|ランチ/.test(input.theme) ? CAFETERIA_IDEAS : this.generic(input.theme);
    const out: IdeaDraft[] = [];
    for (let tries = 0; out.length < input.count && tries < pool.length * 2; tries++) {
      const idea = pool[this.cursor++ % pool.length]!;
      if (!input.avoidTitles.includes(idea.title) || tries >= pool.length) out.push({ ...idea });
    }
    // 固定データでも合意を受けたことが見えるよう、半分に「どの論点を受けたか」を付ける
    const agreed = input.context?.agreed ?? [];
    if (agreed.length > 0) {
      out.forEach((d, i) => {
        if (i % 2 === 0) {
          const c = agreed[i % agreed.length]!;
          d.inspiredBy = { claimLabels: [c.label], note: `合意「${c.text}」を反映` };
        }
      });
    }
    // 8軸は言葉の手がかりから作る。発想の型は頼まれた枠のものを付ける
    return out.map((d, i) => ({
      ...d,
      profile: heuristicProfile(`${d.title} ${d.summary}`),
      persona: slots?.[i]?.persona.name,
    }));
  }

  /** 固定データ用の別案：小さく・みんなで・続けられる、のどれかに寄せる */
  async varyIdea(input: VaryInput): Promise<IdeaDraft> {
    await sleep(this.latencyMs * 0.8);
    const variants = [
      { suffix: 'ミニ版', line: 'まずは1日・1か所で気軽に試す。', shift: { 0: -0.5, 2: 0.5 } },
      { suffix: 'みんなで版', line: '友達を誘うほど楽しくなる形に。', shift: { 3: 0.4, 7: 0.4 } },
      { suffix: '続く版', line: '毎週少しずつ続けたくなる仕組みに。', shift: { 4: 0.5, 1: -0.2 } },
    ] as const;
    const v = variants[this.varyCursor++ % variants.length]!;
    const base = input.idea.profile ?? heuristicProfile(`${input.idea.title} ${input.idea.summary}`);
    const profile = base.map((x, i) => Math.max(-1, Math.min(1, x + ((v.shift as Record<number, number>)[i] ?? 0))));
    const first = input.idea.summary.split('\n')[0] ?? input.idea.summary;
    return {
      title: `${input.idea.title.slice(0, 10)}${v.suffix}`.slice(0, 16),
      summary: `${first}\n${v.line}`,
      icon: '◎',
      profile,
      keepStrengths: [first.slice(0, 20)],
      improvementPoints: [v.line.replace(/。$/, '')],
      changeNote: `${v.suffix}にして迷いを減らした`,
    };
  }

  /** 固定データ用の企画書（テンプレートに審査の記録を流し込む） */
  async generateProposal(input: ProposalInput): Promise<ProposalContent> {
    await sleep(this.latencyMs * 1.5);
    const final = input.champion.revisions.at(-1)!;
    const first = input.champion.revisions[0]!;
    const agreed = input.context.agreed.map((c) => c.text);
    const lines = final.summary.split('\n');
    const catchphrase = lines[0] ?? final.title;
    const problem = `${input.theme}にあたって、参加のきっかけが少なく、続けて使いたくなる仕組みがない。`;
    const target = '学内の学生（まずは1つの学部・1つの場所から）';
    const value = lines[1] ?? final.summary;
    const overview = `「${first.title}」を出発点に、${final.improvementPoints.join('、') || '審査員の指摘'}を取り入れた企画です。${agreed.length ? `審査で合意した方針（${agreed.join('、')}）に沿っています。` : ''}`;
    return {
      title: final.title,
      catchphrase,
      background: `テーマ「${input.theme}」について、審査員とAIキャラクターが案を出し合い、${input.champion.revisions.length}回の改良を経てこの案に決まりました。`,
      problem,
      target,
      value,
      overview,
      features: [
        ...final.keepStrengths.map((k) => ({ name: '残した強み', detail: k })),
        ...final.improvementPoints.map((p) => ({ name: '改善した点', detail: p })),
      ].slice(0, 4),
      plan: [
        { phase: '準備', period: '1〜2週目', tasks: '関係者への相談、小さく試す場所と期間を決める' },
        { phase: '試行', period: '3〜4週目', tasks: '1か所で2週間試し、参加者の反応を集める' },
        { phase: '振り返り', period: '5週目', tasks: '結果をもとに続けるか・広げるかを決める' },
      ],
      resources: '企画メンバー2〜3名、協力してくれる運営側の担当者',
      budget: '小さく試す範囲で数万円程度（要検証）',
      risks: [
        { risk: '参加者が集まらない', mitigation: '最初は知り合いのサークルに声をかけて始める' },
        { risk: '運営の手間が増える', mitigation: '週1回の更新だけで回る形にする' },
      ],
      kpis: ['試行期間の参加者数', '2回目以上の参加率', '参加者アンケートの満足度'],
      nextActions: ['運営側の担当者に企画を共有する', '試行の場所と日程を決める', '告知の文面を作る'],
      assumptions: ['予算と期間は審査では確かめていない目安です', '運営側の協力が得られる前提です'],
      imageUrl: buildFixtureProposalImage({
        theme: input.theme,
        title: final.title,
        catchphrase,
        problem,
        target,
        value,
        overview,
        characterName: input.champion.characterName,
      }),
    };
  }

  /** 固定データ・フォールバック用の企画書イメージ画像（SVG data URL） */
  async generateProposalImage(input: ProposalImageInput): Promise<string | null> {
    await sleep(this.latencyMs * 0.4);
    return buildFixtureProposalImage(input);
  }

  /**
   * 固定データ用の簡易な合意抽出（Gemini が使えないときの代わり）。
   * 賛成・反対の言葉は直前の論点（または返答先）への賛否、要望らしい発言は新しい論点にする。
   */
  async updateConsensus(input: ConsensusUpdateInput): Promise<ConsensusOpDraft[]> {
    const ops: ConsensusOpDraft[] = [];
    const open = input.claims.filter((c) => c.status === 'proposed' || c.status === 'agreed').map((c) => c.label);
    let latest: string | null = open.at(-1) ?? null;
    let added = input.nextClaimNumber - 1;
    for (const u of input.utterances) {
      const target = u.replyToClaim ?? latest;
      if (AGREE.test(u.text) && target) {
        ops.push({ op: 'set_stance', label: target, judge: u.judge, stance: 'support', seq: u.seq });
      } else if (DISAGREE.test(u.text) && target) {
        ops.push({ op: 'set_stance', label: target, judge: u.judge, stance: 'oppose', seq: u.seq });
      } else if (WISH.test(u.text) && !/[?？]\s*$/.test(u.text)) {
        ops.push({ op: 'add_claim', text: u.text.replace(/^[^、,]{1,8}[、,]\s*/, '').slice(0, 40), judge: u.judge, stance: 'support', seq: u.seq });
        latest = `C${++added}`;
      }
    }
    return ops;
  }

  async triageUtterance(input: UtteranceTriageInput): Promise<UtteranceTriage> {
    const t = input.text.replace(/\s/g, '');
    if (t.length < 3) return { keep: false, reason: 'garbled' };
    if (APP_TALK.test(t)) return { keep: false, reason: 'off_topic' };
    return { keep: true, summary: null };
  }

  async refine(input: RefineInput): Promise<RefineOutput> {
    await sleep(this.latencyMs * 1.6);
    const ps = input.participants;
    const critiques: RefineOutput['critiques'] = [];
    for (let r = 1; r <= input.rounds && ps.length > 1; r++) {
      const from = ps[(r - 1) % ps.length]!;
      const to = ps[r % ps.length]!;
      critiques.push({
        round: r,
        fromInstanceId: from.instanceId,
        toInstanceId: to.instanceId,
        text: CRITIQUES[(this.cursor++ + r) % CRITIQUES.length]!,
      });
    }
    const revisions: Record<string, RevisionDraft> = {};
    for (const p of ps.filter((x) => input.targets.includes(x.instanceId))) {
      const k = this.cursor++;
      const firstLine = p.summary.split('\n')[0] ?? p.summary;
      revisions[p.instanceId] = {
        title: p.title,
        summary: firstLine + SUMMARY_SUFFIX[k % SUMMARY_SUFFIX.length]!,
        keepStrengths: [firstLine.replace(/[。、]$/, '')],
        improvementPoints: input.instruction
          ? [input.instruction, IMPROVEMENTS[k % IMPROVEMENTS.length]![0]!]
          : [...IMPROVEMENTS[k % IMPROVEMENTS.length]!],
        inspiredBy: input.context?.agreed.length
          ? { claimLabels: input.context.agreed.slice(0, 2).map((c) => c.label), note: `合意「${input.context.agreed[0]!.text}」を守って改良` }
          : null,
        reason: input.instruction
          ? `審査員の指示「${input.instruction}」を反映`
          : input.trigger === 'arrival'
            ? '相互批評の指摘を反映'
            : '審査員が注目した強みを残し、実現性を高めた',
      };
    }
    return { critiques, revisions };
  }

  async answer(input: { idea: { title: string }; characterName: string; question: string }): Promise<string> {
    await sleep(this.latencyMs * 0.8);
    return `「${input.question}」への答え：${input.idea.title}は、まず1つの場所で2週間ためしてみて、参加した人の反応を集めます。専用の機材はいらないので、すぐに始められます！`;
  }

  private generic(theme: string): IdeaDraft[] {
    const t = theme.replace(/(を|の).*$/, '').slice(0, 8) || theme.slice(0, 8);
    return GENERIC_PATTERNS.map(([title, summary, icon]) => ({
      title: title.replace('{t}', t),
      summary: summary.replace('{t}', t),
      icon,
    }));
  }
}

function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 外部 API を使わない場合やフォールバック時に使う、企画内容に即した SVG キービジュアル。
 */
export function buildFixtureProposalImage(input: ProposalImageInput): string {
  const title = escXml(input.title.slice(0, 22));
  const catchphrase = escXml((input.catchphrase ?? input.value).slice(0, 32));
  const target = escXml(input.target.slice(0, 22));
  const value = escXml(input.value.slice(0, 26));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 420" width="800" height="420">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2c1654"/>
      <stop offset="52%" stop-color="#4b2382"/>
      <stop offset="100%" stop-color="#8c46a8"/>
    </linearGradient>
    <linearGradient id="card" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#fff6e3" stop-opacity="0.92"/>
    </linearGradient>
  </defs>
  <rect width="800" height="420" rx="20" fill="url(#bg)"/>
  <circle cx="680" cy="85" r="130" fill="#ffcf6b" fill-opacity="0.18"/>
  <circle cx="110" cy="360" r="150" fill="#a76dff" fill-opacity="0.2"/>
  <g transform="translate(44, 38)">
    <rect width="430" height="344" rx="18" fill="url(#card)"/>
    <rect x="22" y="22" width="136" height="26" rx="13" fill="#7a3fc8"/>
    <text x="90" y="39" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="12" font-weight="800">CONCEPT VISUAL</text>
    <text x="24" y="84" fill="#241336" font-family="sans-serif" font-size="24" font-weight="900">${title}</text>
    <text x="24" y="116" fill="#8a4b00" font-family="sans-serif" font-size="14" font-weight="700">${catchphrase}</text>
    <line x1="24" y1="136" x2="406" y2="136" stroke="#e3d5f4" stroke-width="2"/>
    <rect x="24" y="154" width="382" height="72" rx="10" fill="#f4edfc" stroke="#d6c2f0"/>
    <text x="40" y="178" fill="#5e3494" font-family="sans-serif" font-size="11" font-weight="800">TARGET / 対象シーン</text>
    <text x="40" y="204" fill="#241336" font-family="sans-serif" font-size="14" font-weight="700">${target}</text>
    <rect x="24" y="242" width="382" height="76" rx="10" fill="#eefaf3" stroke="#8ecfa8"/>
    <text x="40" y="266" fill="#186240" font-family="sans-serif" font-size="11" font-weight="800">VALUE / 生まれる体験</text>
    <text x="40" y="294" fill="#1c2e24" font-family="sans-serif" font-size="14" font-weight="700">${value}</text>
  </g>
  <g transform="translate(504, 54)">
    <rect x="0" y="0" width="252" height="312" rx="20" fill="#ffffff" fill-opacity="0.12" stroke="#ffffff" stroke-opacity="0.28" stroke-width="2"/>
    <circle cx="126" cy="108" r="56" fill="#ffe49e"/>
    <path d="M92 226 C92 178 160 178 160 226 Z" fill="#ffd06e"/>
    <circle cx="72" cy="146" r="34" fill="#d9b8ff"/>
    <path d="M46 238 C46 202 98 202 98 238 Z" fill="#b98cf0"/>
    <circle cx="182" cy="146" r="34" fill="#9fe6c3"/>
    <path d="M156 238 C156 202 208 202 208 238 Z" fill="#6fd1a2"/>
    <circle cx="126" cy="98" r="24" fill="#ffffff"/>
    <path d="M116 98 L123 106 L138 90" stroke="#6b2fb8" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="28" y="254" width="196" height="34" rx="17" fill="#ffdf8d"/>
    <text x="126" y="276" text-anchor="middle" fill="#3b2200" font-family="sans-serif" font-size="12" font-weight="800">IDEA AUDITION WINNER</text>
  </g>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}
