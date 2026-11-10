import { describe, expect, it } from 'vitest';
import { CAMP_VERSION, type CommandMessage } from '@idea-audition/protocol';
import { SessionActor } from '../src/application/session-actor.ts';
import { speechLexicon } from '../src/application/speech-lexicon.ts';
import { GeminiLiveTranscriber } from '../src/infrastructure/gemini/live-transcriber.ts';
import { MemorySessionStore } from '../src/infrastructure/persistence/memory-store.ts';
import { StubAi, fakeClock, fakeConnection, manualScheduler, seqIds } from './helpers.ts';

describe('音声認識の語彙', () => {
  it('キャラ名（英字とカタカナ）・テーマの根幹の語・ステージ上の企画名が入る', async () => {
    const { scheduler, advance } = manualScheduler();
    const actor = new SessionActor('v', {
      ai: new StubAi(), store: new MemorySessionStore(), scheduler, clock: fakeClock(), ids: seqIds(),
      config: { stockTarget: 3, lowerSlotCount: 5, rotation: null, critiqueIntervalMs: 1000, persistDelayMs: 50, consensus: null },
    });
    const a = fakeConnection('a');
    actor.attach(a.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'v' });
    actor.receiveCommand(a.conn, { camp: CAMP_VERSION, kind: 'command', type: 'START_AUDITION', commandId: 'c1', sentAt: '', payload: { theme: 'DevFest ハッカソン作品', mode: 'team' } } as CommandMessage);
    await advance(0);
    const vocab = actor.speechVocabulary();
    expect(vocab).toEqual(expect.arrayContaining(['LUNA', 'ルナ', 'SPROUT', 'スプラウト', 'DevFest', 'ハッカソン', '作品']));
    expect(vocab).not.toContain('DevFest ハッカソン作品'); // テーマの文は丸ごとは持たない
    const title = actor.session.ideaOf(actor.session.lowerSlots[0]!)!.revisions[0]!.title;
    expect(vocab).toContain(title);
    expect(vocab.length).toBeLessThanOrEqual(60);
    expect(new Set(vocab).size).toBe(vocab.length);
  });

  it('舞台の企画の説明文にある固有語（カタカナ・英字）と、テーマの語も入る', async () => {
    const { scheduler, advance } = manualScheduler();
    const actor = new SessionActor('v', {
      ai: new StubAi(), store: new MemorySessionStore(), scheduler, clock: fakeClock(), ids: seqIds(),
      config: { stockTarget: 3, lowerSlotCount: 5, rotation: null, critiqueIntervalMs: 1000, persistDelayMs: 50, consensus: null },
    });
    const a = fakeConnection('a');
    actor.attach(a.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'v' });
    actor.receiveCommand(a.conn, { camp: CAMP_VERSION, kind: 'command', type: 'START_AUDITION', commandId: 'c1', sentAt: '', payload: { theme: 'DevFest ハッカソン作品', mode: 'team' } } as CommandMessage);
    await advance(0);
    const rev = actor.session.ideaOf(actor.session.lowerSlots[0]!)!.revisions[0]!;
    rev.summary = 'スタンプラリーで回る\nFirebase と Gemini で作る';
    rev.title = 'ひとり飯ラウンジ';
    rev.aliases = ['ひとり飯', 'ラウンジ'];
    const vocab = actor.speechVocabulary();
    expect(vocab).toEqual(expect.arrayContaining(['スタンプラリー', 'Firebase', 'DevFest', 'ひとり飯', 'ラウンジ']));
    // 補正の辞書にも呼び名が入る（カタカナだけの呼び名は読みつき）
    expect(speechLexicon(actor.session)).toEqual(expect.arrayContaining([
      expect.objectContaining({ surface: 'ひとり飯', reading: null }),
      expect.objectContaining({ surface: 'ラウンジ', reading: 'ラウンジ' }),
    ]));
  });

  it('テーマ：長い文は持たず、根幹の語（漢字・カタカナ）を拾う。短いテーマはそのまま持つ', async () => {
    const { scheduler, advance } = manualScheduler();
    const vocabFor = async (theme: string) => {
      const actor = new SessionActor('v', {
        ai: new StubAi(), store: new MemorySessionStore(), scheduler, clock: fakeClock(), ids: seqIds(),
        config: { stockTarget: 3, lowerSlotCount: 5, rotation: null, critiqueIntervalMs: 1000, persistDelayMs: 50, consensus: null },
      });
      const a = fakeConnection('a');
      actor.attach(a.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'v' });
      actor.receiveCommand(a.conn, { camp: CAMP_VERSION, kind: 'command', type: 'START_AUDITION', commandId: 'c1', sentAt: '', payload: { theme, mode: 'team' } } as CommandMessage);
      await advance(0);
      return actor.speechVocabulary();
    };
    const long = await vocabFor('大学の学食をもっと使いやすくするアプリ');
    expect(long).toEqual(expect.arrayContaining(['学食', '大学', 'アプリ']));
    expect(long).not.toContain('大学の学食をもっと使いやすくするアプリ');
    expect(await vocabFor('学食')).toContain('学食');
  });

  it('語彙は大事なものから詰める（上限を超えてもキャラ名・舞台の企画名は残る）', async () => {
    const { scheduler, advance } = manualScheduler();
    const actor = new SessionActor('v', {
      ai: new StubAi(), store: new MemorySessionStore(), scheduler, clock: fakeClock(), ids: seqIds(),
      config: { stockTarget: 3, lowerSlotCount: 5, rotation: null, critiqueIntervalMs: 1000, persistDelayMs: 50, consensus: null },
    });
    const a = fakeConnection('a');
    actor.attach(a.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'v' });
    actor.receiveCommand(a.conn, { camp: CAMP_VERSION, kind: 'command', type: 'START_AUDITION', commandId: 'c1', sentAt: '', payload: { theme: 't', mode: 'team' } } as CommandMessage);
    await advance(0);
    const rev = actor.session.ideaOf(actor.session.lowerSlots[0]!)!.revisions[0]!;
    rev.summary = Array.from({ length: 100 }, (_, i) => `ワードあ${'い'.repeat(i % 5)}ア${i}`).join(' ') + ' ' + Array.from({ length: 100 }, (_, i) => `ゲンゴ${'ー'.repeat(1 + (i % 9))}${String.fromCharCode(0x30a1 + (i % 80))}`).join(' ');
    const vocab = actor.speechVocabulary();
    expect(vocab.length).toBeLessThanOrEqual(60);
    expect(vocab).toEqual(expect.arrayContaining(['ルナ', rev.title]));
  });

  it('舞台の目印は、企画が入れ替わると変わり、論点が増えても変わらない', async () => {
    const { scheduler, advance } = manualScheduler();
    const actor = new SessionActor('v', {
      ai: new StubAi(), store: new MemorySessionStore(), scheduler, clock: fakeClock(), ids: seqIds(),
      config: { stockTarget: 3, lowerSlotCount: 5, rotation: null, critiqueIntervalMs: 1000, persistDelayMs: 50, consensus: null },
    });
    const a = fakeConnection('a');
    actor.attach(a.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'v' });
    actor.receiveCommand(a.conn, { camp: CAMP_VERSION, kind: 'command', type: 'START_AUDITION', commandId: 'c1', sentAt: '', payload: { theme: 't', mode: 'team' } } as CommandMessage);
    await advance(0);
    const before = actor.speechStageKey();
    expect(actor.speechStageKey()).toBe(before);
    actor.session.lowerSlots[0] = null;
    expect(actor.speechStageKey()).not.toBe(before);
  });

  it('前に出た企画名：新しい順に5件と、注目された案を持つ。見送った案は持たない', async () => {
    const { scheduler, advance } = manualScheduler();
    const actor = new SessionActor('v', {
      ai: new StubAi(), store: new MemorySessionStore(), scheduler, clock: fakeClock(), ids: seqIds(),
      config: { stockTarget: 3, lowerSlotCount: 5, rotation: null, critiqueIntervalMs: 1000, persistDelayMs: 50, consensus: null },
    });
    const a = fakeConnection('a');
    actor.attach(a.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'v' });
    actor.receiveCommand(a.conn, { camp: CAMP_VERSION, kind: 'command', type: 'START_AUDITION', commandId: 'c1', sentAt: '', payload: { theme: 't', mode: 'team' } } as CommandMessage);
    await advance(0);
    const s = actor.session;
    const baseChar = s.characters.get(s.lowerSlots[0]!)!;
    const baseRev = s.ideaOf(s.lowerSlots[0]!)!.revisions[0]!;
    // 退場済みの企画を9件作る（旧案0が最も古い）。旧案1だけ注目度が高く、旧案8は見送られた
    for (let i = 0; i <= 8; i++) {
      const ideaId = `old${i}`;
      const instanceId = `oldc${i}`;
      s.ideas.set(ideaId, { ideaId, revisions: [{ ...baseRev, revisionId: `rv${i}`, title: `旧案${i}`, aliases: [`旧${i}`] }] });
      s.characters.set(instanceId, {
        ...structuredClone(baseChar), instanceId, ideaId, location: 'archived',
        attention: { score: i === 1 ? 9 : 0, scoredAt: 0, lastTouchAt: 0, mentions: 0 },
      });
      s.ideaBox.push({ ideaId, instanceId, designId: baseChar.designId, reason: i === 8 ? 'rejected' : 'rotated', archivedAt: i });
    }
    const vocab = actor.speechVocabulary();
    expect(vocab).toEqual(expect.arrayContaining(['旧案7', '旧案6', '旧案5', '旧案4', '旧案3', '旧案1']));
    expect(vocab).toContain('旧7'); // 呼び名も持つ
    expect(vocab).not.toContain('旧案8'); // 見送った案
    expect(vocab).not.toContain('旧案2'); // 古くて注目もされていない
    expect(vocab).not.toContain('旧案0');
  });

  it('改良で企画名が同じなら読みと呼び名を引き継ぎ、変わったら呼び名は持たない', async () => {
    const { scheduler, advance } = manualScheduler();
    const actor = await SessionActor.open('v', {
      ai: new StubAi(), store: new MemorySessionStore(), scheduler, clock: fakeClock(), ids: seqIds(),
      config: { stockTarget: 3, lowerSlotCount: 5, rotation: null, critiqueIntervalMs: 10, persistDelayMs: 10, consensus: null },
    });
    const a = fakeConnection('a');
    actor.attach(a.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'v' });
    actor.receiveCommand(a.conn, { camp: CAMP_VERSION, kind: 'command', type: 'START_AUDITION', commandId: 'c1', sentAt: '', payload: { theme: 't', mode: 'team' } } as CommandMessage);
    await advance(0);
    const id = actor.session.lowerSlots[0]!;
    actor.receiveCommand(a.conn, { camp: CAMP_VERSION, kind: 'command', type: 'REQUEST_PROMOTION', commandId: 'c2', sentAt: '', payload: { instanceId: id } } as CommandMessage);
    await advance(100);
    const s = actor.session;
    const idea = s.ideaOf(id)!;
    Object.assign(idea.revisions.at(-1)!, { title: 'ひとり飯ラウンジ', reading: 'ヒトリメシラウンジ', aliases: ['ひとり飯'] });
    const draft = (title: string) => ({ title, summary: 'a\nb', keepStrengths: [], improvementPoints: [], reason: 'r' });
    expect(s.publishRevision(id, idea.revisions.at(-1)!.revisionId, draft('ひとり飯ラウンジ')).ok).toBe(true);
    expect(idea.revisions.at(-1)).toMatchObject({ reading: 'ヒトリメシラウンジ', aliases: ['ひとり飯'] });
    expect(s.publishRevision(id, idea.revisions.at(-1)!.revisionId, draft('夜のおひとりさま席')).ok).toBe(true);
    expect(idea.revisions.at(-1)).toMatchObject({ reading: null, aliases: null });
  });

  it('Live には日本語の指定と語彙を渡す', async () => {
    let config: Record<string, unknown> | undefined;
    const fakeAi = {
      live: {
        connect: async (p: { config: Record<string, unknown> }) => {
          config = p.config;
          return { sendRealtimeInput() {}, close() {} };
        },
      },
    };
    const t = new GeminiLiveTranscriber(fakeAi as never, 'm');
    await t.open({ onInterim() {}, onFinal() {}, onClose() {} }, { vocabulary: ['ルナ'] });
    expect(config!.inputAudioTranscription).toEqual({ languageCodes: ['ja-JP'], customVocabulary: ['ルナ'] });
  });
});
