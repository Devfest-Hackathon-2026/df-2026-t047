import { describe, expect, it } from 'vitest';
import { AuditionSession } from '../src/domain/session.ts';
import { drafts, fakeClock, seqIds } from './helpers.ts';

function activeSession(stock = 20) {
  const s = new AuditionSession('s1', { ids: seqIds(), clock: fakeClock(), lowerSlotCount: 5 });
  const host = s.join();
  if (!host.ok || !host.value.judgeId) throw new Error('join failed');
  s.start('大学の学食', 'team');
  s.addToStock(drafts(stock));
  s.fillEmptySlots();
  return { s, hostId: host.value.judgeId };
}

const onStageIds = (s: AuditionSession) => [
  ...s.lowerSlots.filter((x): x is string => x !== null),
  ...s.upper.map((f) => f.instanceId),
];

describe('ステージの定員と一意性', () => {
  it('開始時に下段は5体（AC-01）', () => {
    const { s } = activeSession();
    expect(s.lowerSlots.every((x) => x !== null)).toBe(true);
    expect(s.lowerSlots).toHaveLength(5);
  });

  it('昇格後、下段は補充されて5体に戻る（AC-02）', () => {
    const { s } = activeSession();
    const target = s.lowerSlots[2]!;
    const r = s.promote(target);
    expect(r.ok).toBe(true);
    expect(s.lowerSlots.filter((x) => x !== null)).toHaveLength(5);
    expect(s.lowerSlots).not.toContain(target);
    expect(s.upper.map((f) => f.instanceId)).toEqual([target]);
  });

  it('上下に同じキャラ・同じデザインが同時に存在しない（AC-03, AC-05）', () => {
    const { s } = activeSession();
    for (let i = 0; i < 3; i++) s.promote(s.lowerSlots[0]!);
    const ids = onStageIds(s);
    expect(new Set(ids).size).toBe(ids.length);
    const designs = ids.map((id) => s.characters.get(id)!.designId);
    expect(new Set(designs).size).toBe(designs.length);
    for (const id of ids) {
      const loc = s.characters.get(id)!.location;
      expect(s.upper.some((f) => f.instanceId === id) ? loc === 'upper' : loc === 'lower').toBe(true);
    }
  });

  it('補充キャラは直前に昇格したキャラと別デザイン（AC-03）', () => {
    const { s } = activeSession();
    const promoted = s.lowerSlots[1]!;
    const promotedDesign = s.characters.get(promoted)!.designId;
    s.promote(promoted);
    const refill = s.characters.get(s.lowerSlots[1]!)!;
    expect(refill.designId).not.toBe(promotedDesign);
  });

  it('上段は最大3体。満席なら UPPER_FULL で拒否し、下段はそのまま（AC-06, AC-07）', () => {
    const { s } = activeSession();
    for (let i = 0; i < 3; i++) expect(s.promote(s.lowerSlots.find((x) => x !== null)!).ok).toBe(true);
    const before = [...s.lowerSlots];
    const r = s.promote(s.lowerSlots.find((x) => x !== null)!);
    expect(r).toEqual({ ok: false, reason: 'UPPER_FULL' });
    expect(s.lowerSlots).toEqual(before);
    expect(s.upper).toHaveLength(3);
  });

  it('同じキャラへの2回目の昇格は NOT_IN_LOWER（同時ドラッグ、AC-31）', () => {
    const { s } = activeSession();
    const target = s.lowerSlots[0]!;
    expect(s.promote(target).ok).toBe(true);
    expect(s.promote(target)).toEqual({ ok: false, reason: 'NOT_IN_LOWER' });
    expect(s.upper).toHaveLength(1);
  });

  it('ストックが空なら空席のまま、ストック到着で埋まる', () => {
    const { s } = activeSession(5);
    s.promote(s.lowerSlots[0]!);
    expect(s.lowerSlots[0]).toBeNull();
    s.addToStock(drafts(1, '追加'));
    s.fillEmptySlots();
    expect(s.lowerSlots[0]).not.toBeNull();
  });

  it('入れ替えた案は Idea BOX に保存される', () => {
    const { s } = activeSession();
    const oldest = s.lowerSlots[0]!;
    const r = s.rotate();
    expect(r.ok).toBe(true);
    expect(s.characters.get(oldest)!.location).toBe('archived');
    expect(s.ideaBox.map((x) => x.instanceId)).toContain(oldest);
    expect(s.lowerSlots.filter((x) => x !== null)).toHaveLength(5);
  });
});

describe('改良版（Revision）', () => {
  it('改良は新しい版を追加し、元の版は残る（AC-23）', () => {
    const { s } = activeSession();
    const id = s.lowerSlots[0]!;
    s.promote(id);
    const idea = s.ideaOf(id)!;
    const base = idea.revisions[0]!;
    const r = s.publishRevision(id, base.revisionId, {
      title: '新', summary: '新しい説明', keepStrengths: ['a'], improvementPoints: ['b'], reason: 'r',
    });
    expect(r.ok).toBe(true);
    expect(idea.revisions).toHaveLength(2);
    expect(idea.revisions[0]).toEqual(base);
    expect(idea.revisions[1]!.basedOnRevisionId).toBe(base.revisionId);
  });

  it('古い版を元にした改良は STALE_VERSION で破棄（ADR-0005 §5）', () => {
    const { s } = activeSession();
    const id = s.lowerSlots[0]!;
    s.promote(id);
    const base = s.ideaOf(id)!.revisions[0]!.revisionId;
    const draft = { title: 'x', summary: 'y', keepStrengths: [], improvementPoints: [], reason: 'r' };
    expect(s.publishRevision(id, base, draft).ok).toBe(true);
    expect(s.publishRevision(id, base, draft)).toEqual({ ok: false, reason: 'STALE_VERSION' });
  });
});

describe('投票と優勝（Q4）', () => {
  function withJudges() {
    const ctx = activeSession();
    const b = ctx.s.join();
    if (!b.ok || !b.value.judgeId) throw new Error();
    ctx.s.promote(ctx.s.lowerSlots[0]!);
    ctx.s.promote(ctx.s.lowerSlots[0]!);
    return { ...ctx, guestId: b.value.judgeId };
  }

  it('投票はホストだけが開始できる', () => {
    const { s, guestId, hostId } = withJudges();
    expect(s.startVote(guestId)).toEqual({ ok: false, reason: 'NOT_HOST' });
    expect(s.startVote(hostId).ok).toBe(true);
    expect(s.status).toBe('champion_selection');
  });

  it('全員が投票すると自動で締め切り、多数決で優勝が決まる', () => {
    const { s, guestId, hostId } = withJudges();
    const [a] = s.upper.map((f) => f.instanceId);
    s.startVote(hostId);
    s.castVote(hostId, a!);
    expect(s.status).toBe('champion_selection');
    s.castVote(guestId, a!);
    expect(s.status).toBe('completed');
    expect(s.champion?.instanceId).toBe(a);
  });

  it('同票ならホストが同票の案から選ぶ', () => {
    const { s, guestId, hostId } = withJudges();
    const [a, b] = s.upper.map((f) => f.instanceId);
    s.startVote(hostId);
    s.castVote(hostId, a!);
    s.castVote(guestId, b!);
    expect(s.vote?.status).toBe('tie');
    expect(s.resolveTie(guestId, a!)).toEqual({ ok: false, reason: 'NOT_HOST' });
    expect(s.resolveTie(hostId, b!).ok).toBe(true);
    expect(s.champion?.instanceId).toBe(b);
  });

  it('未投票のまま切断した審査員は母数から外れる', () => {
    const { s, guestId, hostId } = withJudges();
    const [a] = s.upper.map((f) => f.instanceId);
    s.startVote(hostId);
    s.castVote(hostId, a!);
    s.leave(guestId);
    expect(s.status).toBe('completed');
  });

  it('ホストが切断したら、次に早く参加した人がホストになる', () => {
    const { s, guestId, hostId } = withJudges();
    s.leave(hostId);
    expect(s.judges.find((j) => j.judgeId === guestId)!.isHost).toBe(true);
  });

  it('ソロではクリックで即決できる', () => {
    const s = new AuditionSession('s', { ids: seqIds(), clock: fakeClock(), lowerSlotCount: 5 });
    const j = s.join();
    if (!j.ok || !j.value.judgeId) throw new Error();
    s.start('テーマ', 'solo');
    s.addToStock(drafts(8));
    s.fillEmptySlots();
    const id = s.lowerSlots[0]!;
    s.promote(id);
    expect(s.selectChampion(j.value.judgeId, id).ok).toBe(true);
    expect(s.status).toBe('completed');
  });
});

describe('版の一貫性（実機レビュー P1-1）', () => {
  it('改良で「どう解く」が変わったら最新版が新しいものを持ち、旧版のものは旧版にだけ残る', () => {
    const s = new AuditionSession('s', { ids: seqIds(), clock: fakeClock(), lowerSlotCount: 5 });
    s.join();
    s.start('学食', 'solo');
    s.addToStock([{ title: 'スマホ封印食卓', summary: 'a\nb', icon: '📵', outline: { who: '学生', pain: 'スマホばかり', how: 'ロッカーに預ける' } }]);
    s.fillEmptySlots();
    const id = s.lowerSlots.find((x) => x !== null)!;
    expect(s.promote(id).ok).toBe(true);
    const idea = s.ideaOf(id)!;
    const base = idea.revisions.at(-1)!.revisionId;
    const r = s.publishRevision(id, base, {
      title: 'スマホ封印食卓',
      summary: 'c\nd',
      keepStrengths: ['集中'],
      improvementPoints: ['ロッカー預け不要'],
      reason: '預けずに参加したい',
      outline: { who: '学生', pain: 'スマホばかり', how: '手元の封印袋に入れる' },
    });
    expect(r.ok).toBe(true);
    expect(idea.revisions.at(-1)!.outline!.how).toBe('手元の封印袋に入れる');
    expect(idea.revisions[0]!.outline!.how).toBe('ロッカーに預ける');
  });

  it('前の版に巻き戻すと、その内容が新しい版として追記され復元される（Issue #8 [B4]）', () => {
    const s = new AuditionSession('s', { ids: seqIds(), clock: fakeClock(), lowerSlotCount: 5 });
    s.join();
    s.start('学食', 'solo');
    s.addToStock([{ title: 'スマホ封印食卓', summary: 'a\nb', icon: '📵', outline: { who: '学生', pain: 'スマホばかり', how: 'ロッカーに預ける' } }]);
    s.fillEmptySlots();
    const id = s.lowerSlots.find((x) => x !== null)!;
    expect(s.promote(id).ok).toBe(true);
    const idea = s.ideaOf(id)!;
    const base = idea.revisions.at(-1)!.revisionId;
    // v2 作成
    s.publishRevision(id, base, {
      title: 'スマホ封印食卓 改',
      summary: '改良概要',
      keepStrengths: ['集中'],
      improvementPoints: ['便利'],
      reason: '改良',
      outline: { who: '学生', pain: 'スマホばかり', how: '封印袋' },
    });
    expect(idea.revisions).toHaveLength(2);
    expect(idea.revisions.at(-1)!.version).toBe(2);
    expect(idea.revisions.at(-1)!.title).toBe('スマホ封印食卓 改');

    // v1 に巻き戻し
    const revertResult = s.revertRevision(id, 1);
    expect(revertResult.ok).toBe(true);
    expect(idea.revisions).toHaveLength(3);
    const v3 = idea.revisions.at(-1)!;
    expect(v3.version).toBe(3);
    expect(v3.title).toBe('スマホ封印食卓');
    expect(v3.outline?.how).toBe('ロッカーに預ける');
    expect(v3.reason).toBe('v1 に巻き戻し');

    // 存在しないバージョンへの巻き戻しは失敗する
    const invalidRevert = s.revertRevision(id, 99);
    expect(invalidRevert.ok).toBe(false);
    if (!invalidRevert.ok) {
      expect(invalidRevert.reason).toBe('STALE_VERSION');
    }
  });
});
