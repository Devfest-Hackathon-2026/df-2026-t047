import { describe, expect, it } from 'vitest';
import { CAMP_VERSION, type CommandMessage, type EventMessage } from '@idea-audition/protocol';
import { applyOps, emptyLedger, quorum, type Ledger } from '../src/domain/consensus.ts';
import { SessionActor } from '../src/application/session-actor.ts';
import { buildConsensusUpdateInput, toLedgerOps } from '../src/application/consensus-context.ts';
import { AuditionSession } from '../src/domain/session.ts';
import { GeminiGateway, renderContext } from '../src/infrastructure/gemini/gemini-gateway.ts';
import { MemorySessionStore } from '../src/infrastructure/persistence/memory-store.ts';
import { StubAi, fakeClock, fakeConnection, manualScheduler, seqIds } from './helpers.ts';

let n = 0;
const ctx = (judges: string[], now = 1000) => ({
  now,
  connectedJudges: judges.length,
  newId: () => `claim_${++n}`,
  validJudgeIds: new Set(judges),
});

describe('合意台帳（ドメイン）', () => {
  it('過半数：1人→1、2人→2、3人→2、4人→3', () => {
    expect([1, 2, 3, 4].map(quorum)).toEqual([1, 2, 2, 3]);
  });

  it('提案 → 過半数の賛成で合意 → 反対で提案中に戻る（時系列で賛否が変わる）', () => {
    const judges = ['a', 'b', 'c'];
    let l: Ledger = emptyLedger();
    let r = applyOps(l, [{ op: 'add_claim', text: '実現コストは低く', judgeId: 'a', stance: 'support', seq: 1 }], ctx(judges));
    l = r.ledger;
    expect(l.claims[0]).toMatchObject({ label: 'C1', status: 'proposed' });
    expect(l.version).toBe(1);

    r = applyOps(l, [{ op: 'set_stance', label: 'C1', judgeId: 'b', stance: 'support', seq: 2 }], ctx(judges, 2000));
    l = r.ledger;
    expect(l.claims[0]!.status).toBe('agreed');
    expect(r.statusChanges).toEqual([{ label: 'C1', text: '実現コストは低く', from: 'proposed', to: 'agreed' }]);

    // b が意見を変える：最新の賛否だけが数えられ、履歴は残る
    r = applyOps(l, [{ op: 'set_stance', label: 'C1', judgeId: 'b', stance: 'oppose', seq: 3 }], ctx(judges, 3000));
    l = r.ledger;
    expect(l.claims[0]!.status).toBe('proposed');
    expect(l.claims[0]!.history.map((h) => `${h.judgeId}:${h.stance}`)).toEqual(['a:support', 'b:support', 'b:oppose']);
    expect(l.version).toBe(3);
  });

  it('ピン留めは賛否に関わらず合意。置き換えられた論点は superseded', () => {
    const judges = ['a', 'b', 'c', 'd'];
    let l = applyOps(
      emptyLedger(),
      [
        { op: 'add_claim', text: '夜も営業', judgeId: 'a', stance: 'support', seq: 1 },
        { op: 'add_claim', text: '昼だけ営業', judgeId: 'b', stance: 'support', seq: 2 },
      ],
      ctx(judges),
    ).ledger;
    expect(l.version).toBe(1); // 1回の適用で版は1つだけ上がる
    l = applyOps(l, [{ op: 'pin', label: 'C2', judgeId: 'c' }], ctx(judges)).ledger;
    expect(l.claims[1]!.status).toBe('agreed');
    l = applyOps(l, [{ op: 'supersede', label: 'C1', byLabel: 'C2' }], ctx(judges)).ledger;
    expect(l.claims[0]!.status).toBe('superseded');
  });

  it('知らない論点・知らない審査員・重複した論点への操作は捨てる（版も上がらない）', () => {
    const l = applyOps(emptyLedger(), [{ op: 'add_claim', text: '安く', judgeId: 'a', stance: 'support', seq: 1 }], ctx(['a'])).ledger;
    const r = applyOps(
      l,
      [
        { op: 'set_stance', label: 'C9', judgeId: 'a', stance: 'oppose', seq: 2 },
        { op: 'set_stance', label: 'C1', judgeId: 'zzz', stance: 'oppose', seq: 2 },
        { op: 'add_claim', text: '安く', judgeId: 'a', stance: 'support', seq: 3 },
      ],
      ctx(['a']),
    );
    expect(r.applied).toEqual([]);
    expect(r.ledger.version).toBe(l.version);
  });

  it('台帳・発言・行動はセッションの保存と復元で残る', () => {
    const s = new AuditionSession('s', { ids: seqIds(), clock: fakeClock(), lowerSlotCount: 5 });
    const j = s.join();
    if (!j.ok || !j.value.judgeId) throw new Error();
    s.start('テーマ', 'solo');
    s.recordUtterance({ seq: 5, judgeId: j.value.judgeId, text: '安くしたい', source: 'text', targetInstanceId: null, intent: 'comment', at: 1 });
    s.applyLedgerOps([{ op: 'add_claim', text: '安く', judgeId: j.value.judgeId, stance: 'support', seq: 5 }], 5);
    const r = AuditionSession.fromState('s', JSON.parse(JSON.stringify(s.toState())), { ids: seqIds(), clock: fakeClock(), lowerSlotCount: 5 });
    expect(r.ledger.claims[0]).toMatchObject({ label: 'C1', text: '安く', status: 'agreed' });
    expect(r.utterances).toHaveLength(1);
    expect(r.ledgerCursor).toBe(5);
  });
});

describe('合意台帳とアクター', () => {
  let cid = 0;
  const cmd = (type: CommandMessage['type'], payload: object) =>
    ({ camp: CAMP_VERSION, kind: 'command', type, commandId: `k${++cid}`, sentAt: '', payload }) as CommandMessage;

  async function setup() {
    const { scheduler, advance } = manualScheduler();
    const ai = new StubAi();
    const actor = await SessionActor.open('c', {
      ai,
      store: new MemorySessionStore(),
      scheduler,
      clock: fakeClock(),
      ids: seqIds(),
      config: {
        stockTarget: 3, lowerSlotCount: 5,
        critiqueIntervalMs: 10,
        persistDelayMs: 10,
        rotation: null,
        consensus: { afterUtteranceMs: 1000, afterDecisionMs: 500, flushAfterUtterances: 3 },
      },
    });
    const a = fakeConnection('a');
    actor.attach(a.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'c' });
    actor.receiveCommand(a.conn, cmd('START_AUDITION', { theme: '学食', mode: 'solo' }));
    await advance(0);
    const events = () => a.received.filter((m): m is EventMessage => m.kind === 'event');
    return { actor, ai, a, advance, events, judgeId: actor.session.judges[0]!.judgeId };
  }

  it('発言は少し待ってまとめて台帳に渡され、合意が全員に配られる', async () => {
    const { actor, ai, advance, events, judgeId } = await setup();
    actor.receiveUtterance(judgeId, '実現コストは低くしたい', 'text', null);
    actor.receiveUtterance(judgeId, '学生が主役がいいね', 'text', null);
    expect(ai.consensusCalls).toHaveLength(0);
    ai.nextConsensusOps = [{ op: 'add_claim', text: '実現コストは低く', judge: '審査員 A', stance: 'support', seq: null }];
    await advance(1000);
    expect(ai.consensusCalls).toHaveLength(1);
    expect(ai.consensusCalls[0]!.utterances.map((u) => u.text)).toEqual(['実現コストは低くしたい', '学生が主役がいいね']);
    expect(ai.consensusCalls[0]!.utterances[0]!.judge).toBe('審査員 A'); // ID は渡さない
    const updated = events().find((e) => e.type === 'CONSENSUS_UPDATED')!;
    expect(updated.snapshot.consensus.claims[0]).toMatchObject({ label: 'C1', status: 'agreed' }); // ソロは1人で合意
    // 次の台帳更新では、反映済みの発言は渡さない
    actor.receiveUtterance(judgeId, 'ありだね', 'text', null);
    await advance(1000);
    expect(ai.consensusCalls[1]!.utterances.map((u) => u.text)).toEqual(['ありだね']);
  });

  it('合意が動いたら、古い合意で作った作り置きを捨てて合意つきで作り直す', async () => {
    const { actor, ai, advance, judgeId } = await setup();
    const staleBefore = actor.session.stock.length;
    expect(staleBefore).toBeGreaterThan(1);
    ai.nextConsensusOps = [{ op: 'add_claim', text: '実現コストは低く', judge: '審査員 A', stance: 'support', seq: null }];
    actor.receiveUtterance(judgeId, '安くしたい', 'text', null);
    await advance(1000);
    const lastGenerate = ai.generateCalls.at(-1)!;
    expect(lastGenerate.context?.version).toBe(1);
    expect(lastGenerate.context?.agreed.map((c) => c.text)).toEqual(['実現コストは低く']);
    expect(actor.session.stock.filter((d) => (d.basedOnConsensus ?? 0) < 1).length).toBeLessThanOrEqual(1);
  });

  it('合意が動く前に頼んだ案が、動いたあとに届いたら捨てる（M2）', async () => {
    const { actor, ai, advance, judgeId } = await setup();
    // 合意 v0 のまま頼んだ生成を、合意が動くまで止めておく
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const held: string[] = [];
    const original = ai.generateIdeas.bind(ai);
    ai.generateIdeas = async (input) => {
      const out = await original(input);
      if ((input.context?.version ?? 0) === 0) {
        held.push(...out.map((d) => d.title));
        await gate;
      }
      return out;
    };
    actor.session.stock.splice(1); // 作り置きを減らして、v0 のまま補充を頼ませる
    (actor as unknown as { ensureStock(): void }).ensureStock();
    await advance(0);
    expect(held.length).toBeGreaterThan(0);
    // 生成を待っている間に合意が動く
    ai.nextConsensusOps = [{ op: 'add_claim', text: '実現コストは低く', judge: '審査員 A', stance: 'support', seq: null }];
    actor.receiveUtterance(judgeId, '安くしたい', 'text', null);
    await advance(1000);
    expect(actor.session.ledger.version).toBe(1);
    // 古い前提の案が遅れて届く → 作り置きにも舞台にも入らない
    release();
    await advance(0);
    const onStage = [...actor.session.ideas.values()].map((i) => i.revisions[0]!.title);
    const inStock = actor.session.stock.map((d) => d.title);
    for (const title of held) {
      expect(inStock).not.toContain(title);
      expect(onStage).not.toContain(title);
    }
    // 捨てたあとは、新しい合意で作り直す
    await advance(1500);
    expect(ai.generateCalls.at(-1)!.context?.version).toBe(1);
  });

  it('論点のピン留め・取り消しができる', async () => {
    const { actor, ai, a, advance, judgeId } = await setup();
    ai.nextConsensusOps = [{ op: 'add_claim', text: '夜営業', judge: null, stance: null, seq: null }];
    actor.receiveUtterance(judgeId, '夜営業はどう', 'text', null);
    await advance(1000);
    expect(actor.session.ledger.claims[0]!.status).toBe('proposed');
    actor.receiveCommand(a.conn, cmd('PIN_CLAIM', { label: 'C1' }));
    expect(actor.session.ledger.claims[0]!.status).toBe('agreed');
    actor.receiveCommand(a.conn, cmd('UNPIN_CLAIM', { label: 'C1' }));
    expect(actor.session.ledger.claims[0]!.pinned).toBe(false);
  });

  it('昇格・見送りも台帳の材料（行動）として渡される', async () => {
    const { actor, ai, a, advance } = await setup();
    actor.receiveCommand(a.conn, cmd('REJECT_CANDIDATE', { instanceId: actor.session.lowerSlots[0]! }));
    await advance(500);
    expect(ai.consensusCalls.at(-1)!.decisions.map((d) => d.kind)).toEqual(['rejected']);
  });
});

describe('Gemini：台帳の差分と文脈', () => {
  it('ラベルで返った操作を検証し、知らない審査員の賛否は捨てる', async () => {
    const client = {
      models: {
        generateContent: async () => ({
          text: JSON.stringify({
            ops: [
              { op: 'add_claim', text: '実現コストは低く', judge: '審査員 A', stance: 'support', label: '', byLabel: '', themeNote: '', onTheme: true, seq: 12 },
              { op: 'set_stance', text: '', judge: '審査員 Z', stance: 'oppose', label: 'C1', byLabel: '', themeNote: '', onTheme: true, seq: 0 },
              { op: 'set_stance', text: '', judge: '審査員 B', stance: 'oppose', label: 'C1', byLabel: '', themeNote: '', onTheme: true, seq: 13 },
              // 誰も言っていない論点（発言の番号が無い・行動もしていない）は捨てる
              { op: 'add_claim', text: '起業は避ける', judge: '審査員 B', stance: 'oppose', label: '', byLabel: '', themeNote: '', onTheme: true, seq: 0 },
              { op: 'add_claim', text: '会員制で収益', judge: '', stance: 'support', label: '', byLabel: '', themeNote: '', onTheme: true, seq: 12 },
            ],
          }),
        }),
      },
    };
    const g = new GeminiGateway(client, {
      fast: { model: 'm', thinkingLevel: 'MINIMAL', timeoutMs: 1000 },
      refine: { model: 'm', thinkingLevel: 'LOW', timeoutMs: 1000 },
    });
    const ops = await g.updateConsensus({
      theme: 't', nextClaimNumber: 2, judges: ['審査員 A', '審査員 B'],
      claims: [{ label: 'C1', text: '夜営業', status: 'proposed', stances: [] }],
      utterances: [
        { seq: 12, judge: '審査員 A', text: 'コストは低くしたい', target: null, replyToClaim: null },
        { seq: 13, judge: '審査員 B', text: '夜営業は微妙', target: null, replyToClaim: null },
      ],
      decisions: [],
    });
    expect(ops).toEqual([
      { op: 'add_claim', text: '実現コストは低く', judge: '審査員 A', stance: 'support', seq: 12 },
      { op: 'set_stance', label: 'C1', judge: '審査員 B', stance: 'oppose', seq: 13 },
    ]);
  });

  it('テーマから離れた論点は捨て、同じ回の論点を指す番号は実際の番号に直す', async () => {
    const op = (o: Record<string, unknown>) => ({ text: '', judge: '', stance: 'none', label: '', byLabel: '', seq: 0, themeNote: '', onTheme: true, ...o });
    const client = {
      models: {
        generateContent: async () => ({
          text: JSON.stringify({
            ops: [
              // モデルの番号：C5（テーマ外→捨てる）、C6（残す）、C7（残す）
              op({ op: 'add_claim', text: '宇宙旅行を企画にする', judge: '審査員 A', stance: 'support', seq: 1, onTheme: false, themeNote: '学食と無関係' }),
              op({ op: 'add_claim', text: '席を事前に予約できる', judge: '審査員 A', stance: 'support', seq: 2, themeNote: '学食の利用の仕組み' }),
              op({ op: 'add_claim', text: '予約は無料にする', judge: '審査員 B', stance: 'support', seq: 3, themeNote: '費用の条件' }),
              // 捨てた論点（C5）への賛成・置き換えは捨てる
              op({ op: 'set_stance', judge: '審査員 B', stance: 'support', label: 'C5', seq: 3 }),
              op({ op: 'supersede', label: 'C1', byLabel: 'C5' }),
              // 残した論点（モデルの C6 → 実際は C5、C7 → C6）への操作は番号を直す
              op({ op: 'set_stance', judge: '審査員 B', stance: 'support', label: 'C6', seq: 3 }),
              op({ op: 'supersede', label: 'C2', byLabel: 'C7' }),
            ],
          }),
        }),
      },
    };
    const logs: string[] = [];
    const g = new GeminiGateway(client, {
      fast: { model: 'm', thinkingLevel: 'MINIMAL', timeoutMs: 1000 },
      refine: { model: 'm', thinkingLevel: 'LOW', timeoutMs: 1000 },
    }, (m) => logs.push(m));
    const ops = await g.updateConsensus({
      theme: '大学の学食をもっと使いやすくするアプリ', nextClaimNumber: 5, judges: ['審査員 A', '審査員 B'],
      claims: [],
      utterances: [
        { seq: 1, judge: '審査員 A', text: '宇宙旅行がいい', target: null, replyToClaim: null },
        { seq: 2, judge: '審査員 A', text: '席を予約したい', target: null, replyToClaim: null },
        { seq: 3, judge: '審査員 B', text: '予約は無料で', target: null, replyToClaim: null },
      ],
      decisions: [],
    });
    expect(ops).toEqual([
      { op: 'add_claim', text: '席を事前に予約できる', judge: '審査員 A', stance: 'support', seq: 2 },
      { op: 'add_claim', text: '予約は無料にする', judge: '審査員 B', stance: 'support', seq: 3 },
      { op: 'set_stance', label: 'C5', judge: '審査員 B', stance: 'support', seq: 3 },
      { op: 'supersede', label: 'C2', byLabel: 'C6' },
    ]);
    expect(logs.some((l) => l.includes('off-theme') && l.includes('宇宙旅行'))).toBe(true);
  });

  it('同じ版の文脈は同じ文字列になる（プロンプト前半のキャッシュが効くように）', () => {
    const ctx = { version: 3, agreed: [{ label: 'C1', text: '安く', supporters: ['審査員 A'] }], proposed: [], rejected: [], favoredIdeas: [], rejectedIdeas: [], recentRemarks: [{ judge: 'A', text: 'x' }] };
    const a = renderContext('学食', ctx);
    const b = renderContext('学食', { ...ctx, recentRemarks: [{ judge: 'B', text: 'y' }] });
    expect(a).toBe(b); // 直近の発言は L1 に含めない
    expect(a).toContain('合意台帳 v3');
  });

  it('台帳の材料には人の行動だけを渡す（下段の自動の入れ替えは、誰の判断でもないので渡さない）', () => {
    const s = new AuditionSession('s', { ids: seqIds(), clock: fakeClock(), lowerSlotCount: 5 });
    const j = s.join(undefined);
    if (!j.ok) throw new Error('join failed');
    s.decisions.push(
      { kind: 'timed_out', instanceId: 'ch_1', title: '自動で退場した案', judgeId: null, at: 10 },
      { kind: 'rejected', instanceId: 'ch_2', title: '見送った案', judgeId: j.value.judgeId, at: 11 },
    );
    const input = buildConsensusUpdateInput(s, 0, new Map());
    expect(input.decisions.map((d) => d.title)).toEqual(['見送った案']);
  });

  it('企画名そのものや、1回選んだだけの行動からは論点を作らない', () => {
    const s = new AuditionSession('s', { ids: seqIds(), clock: fakeClock(), lowerSlotCount: 5 });
    const j = s.join(undefined);
    if (!j.ok) throw new Error('join failed');
    s.ideas.set('i1', { ideaId: 'i1', revisions: [{ title: '一坪ダンボール横丁' } as never] });
    s.decisions.push({ kind: 'promoted', instanceId: 'c1', title: '一坪ダンボール横丁', judgeId: j.value.judgeId, at: 1 });
    const label = s.judges[0] ? '審査員 A' : '';
    const ops = toLedgerOps(s, [
      { op: 'add_claim', text: '一坪ダンボール横丁', judge: label, stance: 'support', seq: 5 },
      { op: 'add_claim', text: '小さく始める', judge: label, stance: 'support', seq: null },
      { op: 'add_claim', text: 'コストは低く', judge: label, stance: 'support', seq: 5 },
    ]);
    expect(ops.map((o) => (o.op === 'add_claim' ? o.text : o.op))).toEqual(['コストは低く']);
    // 2回選んでいれば、行動から作った論点も入れてよい
    s.decisions.push({ kind: 'promoted', instanceId: 'c2', title: '別の案', judgeId: j.value.judgeId, at: 2 });
    expect(toLedgerOps(s, [{ op: 'add_claim', text: '小さく始める', judge: label, stance: 'support', seq: null }])).toHaveLength(1);
  });
});
