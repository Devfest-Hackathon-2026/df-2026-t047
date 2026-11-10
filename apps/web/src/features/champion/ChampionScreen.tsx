import { ArrowRight, BookOpen, Check, ChevronLeft, ChevronRight, Copy, Crown, FileDown, Loader2, RotateCcw, Share2, Star, Trophy, X } from 'lucide-react';
import { championText } from './share-text.ts';
import { copyText } from '../../shared/copy-text.ts';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { playSfx } from '../../shared/sfx.ts';
import { downloadProposalPdf } from './proposal-pdf.tsx';
import { PROPOSAL_PAGES, ProposalDocument } from './ProposalDocument.tsx';
import { useSession } from '../../store/session-store.ts';
import { useDisplay } from '../../store/display-store.ts';
import { pick, useFormality } from '../../shared/formality.ts';
import { Mascot } from '../../shared/Mascot.tsx';
import { useMe } from '../../shared/selectors.ts';
import styles from './Champion.module.css';
import './ceremony.css';

/** 最後にファンファーレを鳴らした優勝（版の ID） */
let lastFanfare: string | null = null;

export function ChampionScreen() {
  const snapshot = useSession((s) => s.snapshot)!;
  const send = useSession((s) => s.send);
  const toast = useDisplay((s) => s.toast);
  const { isHost } = useMe();
  const formality = useFormality();
  const reduced = useReducedMotion();
  const champ = snapshot.champion!;
  // 企画書を、ダウンロードしなくてもその場でめくって読む（#39）
  const [viewerOpen, setViewerOpen] = useState(false);
  useEffect(() => setViewerOpen(false), [champ.revisionId]);
  // 紙吹雪：表彰の最初の4秒ほど。「もう一度お祝い」で降らせ直す
  const [burst, setBurst] = useState(0);
  const [raining, setRaining] = useState(true);
  useEffect(() => {
    setRaining(true);
    const t = setTimeout(() => setRaining(false), 4_200);
    return () => clearTimeout(t);
  }, [burst]);
  // 優勝が決まった瞬間にファンファーレ。同じ優勝では1回だけ（再接続や開発時の二重実行で重ねて鳴らさない）
  useEffect(() => {
    if (formality === 1) return;
    if (lastFanfare === champ.revisionId) return;
    lastFanfare = champ.revisionId;
    playSfx('champion');
  }, [champ.revisionId, formality]);
  const character = snapshot.characters[champ.instanceId];
  const idea = snapshot.ideas[champ.ideaId];
  const rev = idea?.revisions.find((r) => r.revisionId === champ.revisionId) ?? idea?.revisions.at(-1);
  if (!character || !idea || !rev) return null;
  // 今の案（優勝した版）の内容だけを出す。過去の版の改善点を足し合わせると、やめた条件が混ざって矛盾する
  const outline = rev.outline ?? null;
  const facts: [string, string][] = outline
    ? [
        ['誰のために', outline.who],
        ['困りごと', outline.pain],
        ['どう解く', outline.how],
      ]
    : rev.improvementPoints.map((t) => ['', t] as [string, string]);
  const allPoints = facts.map(([k, v]) => (k ? `${k}：${v}` : v));
  const tally = snapshot.vote?.tally ?? null;
  const votes = tally ? (tally[champ.instanceId] ?? 0) : null;
  const ballots = tally ? Object.values(tally).reduce((a, b) => a + b, 0) : null;
  const talks = snapshot.answers.filter((a) => a.instanceId === champ.instanceId).length;
  // 企画書ができていれば中身を、まだなら案の説明と改善点を、チャットに貼れる文章にする
  const shareText = () =>
    championText({
      theme: snapshot.theme,
      title: rev.title,
      summary: rev.summary,
      points: allPoints,
      proposal: snapshot.proposal?.status === 'ready' ? snapshot.proposal.content : null,
    });
  const canShare = typeof navigator !== 'undefined' && typeof (navigator as { share?: unknown }).share === 'function';

  return (
    <section className={`ia-ceremony ${styles.stage}`} aria-label={pick(formality, '優勝発表', '最優秀案の発表')}>
      <div className="champion-ceremony">
        <div className="ceremony-light-grid" aria-hidden>
          {[0, 1, 2, 3, 4].map((n) => (
            <i key={n} />
          ))}
        </div>
        <div className="ceremony-room" aria-hidden>
          <div />
          <div />
        </div>
        <div className="ceremony-radiance" aria-hidden />
        <div className="ceremony-sparks" aria-hidden>
          {Array.from({ length: 20 }, (_, n) => (
            <i key={n} style={{ left: `${(n * 43) % 100}%`, top: `${(n * 31) % 85}%`, animationDelay: `${(n % 5) * -0.4}s` }} />
          ))}
        </div>
        {raining && !reduced && formality === 0 && (
          <div className="ceremony-paper" key={burst} aria-hidden>
            {Array.from({ length: 74 }, (_, n) => (
              <i
                key={n}
                style={
                  {
                    left: `${(n * 41) % 100}%`,
                    '--drift': `${(n % 2 ? 1 : -1) * (40 + ((n * 7) % 170))}px`,
                    animationDelay: `${(n % 11) * 0.1}s`,
                    animationDuration: `${2.8 + (n % 4) * 0.3}s`,
                    '--paper': n % 3 ? '#ffd97a' : '#e787ff',
                  } as CSSProperties
                }
              />
            ))}
          </div>
        )}
        <motion.div
          className="champion-showcase"
          initial={{ opacity: 0, y: reduced ? 0 : 25 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75 }}
        >
          <div className="champion-heading">
            <Crown />
            <span>
              {formality === 1 ? `会議 ${snapshot.sessionId.toUpperCase()} の結果` : `THE WINNER OF SESSION ${snapshot.sessionId.toUpperCase()}`}
            </span>
            <div className="champion-neon-title">
              <Laurels />
              {formality === 1 ? (
                <h1>
                  <strong>最優秀案</strong>
                </h1>
              ) : (
                <h1>
                  <span>IDEA</span>
                  <strong>CHAMPION</strong>
                </h1>
              )}
            </div>
            <div className="champion-title-line" />
          </div>
          <div className="champion-hero">
            <div className="champion-aura" />
            <motion.div
              className="champion-mascot"
              animate={reduced ? {} : { y: [0, -6, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            >
              <Mascot designId={character.designId} className="mascot" />
            </motion.div>
            <TrophyArt />
            <span className="trophy-glint" aria-hidden>
              ✦
            </span>
            <div className="champion-podium" aria-hidden>
              <div className="podium-step-back" />
              <div className="podium-main" />
              <div className="podium-top" />
              <div className="podium-step-front" />
              <Star fill="currentColor" />
            </div>
          </div>
        </motion.div>
        <motion.section
          className="champion-plan"
          initial={{ opacity: 0, x: reduced ? 0 : 25 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.65, delay: 0.25 }}
          aria-label={pick(formality, '優勝アイデアの企画書', '最優秀案の企画書')}
        >
          <div className="winner-plan-header">
            <span>
              <Trophy size={12} />
              {pick(formality, 'WINNING IDEA', '最優秀案')}
            </span>
            {votes !== null && (
              <b>
                <Crown size={12} />
                {votes} / {ballots} 票
              </b>
            )}
          </div>
          <h2>{rev.title}</h2>
          <div className="champion-rule" />
          <p className="champion-summary">{rev.summary}</p>
          {facts.length > 0 && (
            <div className="plan-facts">
              {facts.map(([k, v], i) => (
                <div key={`${k}${i}`}>
                  <Check />
                  <p>
                    {k && <span>{k}</span>}
                    {v}
                  </p>
                </div>
              ))}
            </div>
          )}
          <div className="winner-version">
            <span>
              {character.name} · Ver.{rev.version}
            </span>
            <span>
              対話 {talks} 回 / 改善 {idea.revisions.length - 1} 回
            </span>
          </div>
          <div className="plan-export">
            <ProposalButton />
            {snapshot.proposal?.status === 'ready' && snapshot.proposal.content && (
              <button className="plan-copy" onClick={() => setViewerOpen(true)}>
                <BookOpen size={14} />
                企画書を見る
              </button>
            )}
            <button
              className="plan-copy"
              onClick={() => {
                void copyText(shareText()).then((ok) =>
                  ok
                    ? toast(snapshot.proposal?.content ? '企画書の文章をコピーしました' : pick(formality, '優勝アイデアの文章をコピーしました', '最優秀案の文章をコピーしました'), 'gold')
                    : toast('コピーできませんでした。ブラウザのコピーの許可を確かめてください', 'warn'),
                );
              }}
            >
              <Copy size={14} />
              文章をコピー
            </button>
          </div>
          <div className="ceremony-followup">
            <button onClick={() => setBurst((n) => n + 1)}>
              <RotateCcw size={11} />
              {pick(formality, 'もう一度お祝い', '結果を再表示')}
            </button>
            {canShare && (
              <button
                onClick={() => {
                  void (navigator as Navigator & { share: (d: ShareData) => Promise<void> })
                    .share({ title: `IDEA AUDITION ${pick(formality, '優勝案', '最優秀案')}：${rev.title}`, text: shareText() })
                    .catch(() => {});
                }}
              >
                <Share2 size={11} />
                共有
              </button>
            )}
            {isHost || snapshot.mode === 'solo' ? (
              <button onClick={() => void send('RESET_SESSION', {})}>
                {pick(formality, '新しいオーディションへ', '新しい会議へ')}
                <ArrowRight size={12} />
              </button>
            ) : (
              <span className={styles.waitHost}>ホストが次を始めます</span>
            )}
          </div>
        </motion.section>
        {formality === 0 && <CheeringCrowd />}
      </div>
      {viewerOpen && <ProposalViewer onClose={() => setViewerOpen(false)} />}
    </section>
  );
}

/** トロフィー（ChatGPT 版の表彰から） */
function TrophyArt() {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 180 230" className="trophy-art" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="1">
          <stop stopColor="#9e4c09" />
          <stop offset=".18" stopColor="#ffc84f" />
          <stop offset=".4" stopColor="#fff1aa" />
          <stop offset=".6" stopColor="#e89b28" />
          <stop offset=".82" stopColor="#ffd564" />
          <stop offset="1" stopColor="#8d3a04" />
        </linearGradient>
        <linearGradient id={id + 'b'} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#4c2a29" />
          <stop offset="1" stopColor="#180e19" />
        </linearGradient>
      </defs>
      <g stroke="#ffd56f" strokeWidth="4" fill="none">
        <path d="M42 35H15C4 89 37 107 62 103M138 35h27c11 54-22 72-47 68" />
        <path d="M40 46H26c-3 32 10 42 26 43M140 46h14c3 32-10 42-26 43" strokeWidth="2" />
      </g>
      <path
        d="M39 20Q90 10 141 20L130 85Q125 114 98 123L97 157Q111 160 116 170H64Q69 160 82 157L81 123Q55 113 50 85Z"
        fill={`url(#${id})`}
        stroke="#ffde81"
        strokeWidth="2"
      />
      <ellipse cx="90" cy="20" rx="51" ry="8" fill="#ffdf7c" stroke="#fff1b2" strokeWidth="2" />
      <ellipse cx="90" cy="20" rx="44" ry="4" fill="#bf7b20" />
      <path d="M90 45L99 64 121 67 105 82 109 105 90 94 71 105 75 82 59 67 81 64Z" fill="#ffe792" stroke="#ac651c" strokeWidth="2" />
      <path d="M62 33Q62 89 78 108" stroke="#fff7c8" strokeWidth="3" fill="none" opacity=".7" />
      <path d="M64 170h52l9 37H55Z" fill={`url(#${id}b)`} stroke="#bd843e" strokeWidth="2" />
      <path d="M54 205h72v12H54Z" fill={`url(#${id})`} stroke="#ffd67a" />
      <rect x="74" y="182" width="32" height="13" rx="2" fill="#e3ab4e" />
      <path d="M138 10v19M129 19h19" stroke="#fff7d2" strokeWidth="3" />
    </svg>
  );
}

/** 「IDEA CHAMPION」の左右の月桂樹 */
function Laurels() {
  const id = useId().replace(/:/g, '');
  return (
    <svg className="ceremony-laurels" viewBox="0 0 500 180" aria-hidden>
      <defs>
        <linearGradient id={id}>
          <stop stopColor="#9f5b29" />
          <stop offset=".5" stopColor="#fff0b6" />
          <stop offset="1" stopColor="#e9ad56" />
        </linearGradient>
      </defs>
      {[false, true].map((flip, j) => (
        <g key={j} transform={flip ? 'translate(500 0) scale(-1 1)' : ''} fill={`url(#${id})`} stroke="#ffc16f" strokeWidth="1">
          <path d="M80 168Q10 105 49 16" fill="none" strokeWidth="2" />
          {Array.from({ length: 9 }, (_, i) => (
            <g key={i} transform={`translate(${35 + Math.pow(i - 3, 2) * 1.25} ${22 + i * 15}) rotate(${-30 + i * 7})`}>
              <ellipse cx="-7" cy="0" rx="5" ry="13" transform="rotate(-40)" />
              <ellipse cx="12" cy="4" rx="5" ry="12" transform="rotate(35)" />
            </g>
          ))}
        </g>
      ))}
    </svg>
  );
}

/** 手前の観客（ペンライトを振る） */
function CheeringCrowd() {
  return (
    <div className="ceremony-crowd" aria-hidden>
      {Array.from({ length: 18 }, (_, n) => (
        <div
          className="crowd-person"
          key={n}
          style={
            {
              left: `${n * 6 - 3}%`,
              '--lift': `${(n % 3) * 11}px`,
              '--stick': n % 3 === 0 ? '#ffd975' : n % 3 === 1 ? '#e665ff' : '#8bafff',
              animationDelay: `${(n % 6) * -0.3}s`,
            } as CSSProperties
          }
        >
          <i />
          <span />
          <b />
        </div>
      ))}
    </div>
  );
}

/** 優勝と同時に作り始めた企画書を、できしだい1クリックで PDF ダウンロードできるようにする（決勝の間に作り置きしているので、ふつうはすぐ押せる） */
export function ProposalButton({ label = '企画書PDFをダウンロード' }: { label?: string } = {}) {
  const snapshot = useSession((s) => s.snapshot)!;
  const send = useSession((s) => s.send);
  const toast = useDisplay((s) => s.toast);
  const [saving, setSaving] = useState(false);
  const proposal = snapshot.proposal;
  if (!proposal || proposal.status === 'generating') {
    return (
      <button className="plan-download" disabled>
        <Loader2 size={17} className={styles.spin} />
        企画書を作成中…
      </button>
    );
  }
  if (proposal.status === 'failed') {
    return (
      <button className="plan-download" onClick={() => void send('REGENERATE_PROPOSAL', {})}>
        <RotateCcw size={17} />
        企画書をもう一度作る
      </button>
    );
  }
  return (
    <button
      className="plan-download"
      disabled={saving}
      onClick={async () => {
        setSaving(true);
        try {
          await downloadProposalPdf(snapshot);
          toast('企画書をダウンロードしました', 'gold');
        } catch (e) {
          console.error(e);
          toast('PDFを作れませんでした。もう一度お試しください', 'warn');
        } finally {
          setSaving(false);
        }
      }}
    >
      {saving ? <Loader2 size={17} className={styles.spin} /> : <FileDown size={17} />}
      {saving ? 'PDFを作成中…' : label}
    </button>
  );
}

/**
 * 企画書をその場でめくって読む（#39）。画面の上に大きく開き、前へ・次へ・パートのタブで移る（←→ キーでも、Esc で閉じる）。
 * 中身はダウンロードする PDF と同じ部品（ProposalDocument）で描く
 */
export function ProposalViewer({ onClose }: { onClose: () => void }) {
  const snapshot = useSession((s) => s.snapshot)!;
  const proposal = snapshot.proposal;
  const [page, setPage] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const totalPages = PROPOSAL_PAGES.length;

  useEffect(() => {
    viewportRef.current?.scrollTo({ top: 0 });
  }, [page]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') setPage((p) => Math.max(0, p - 1));
      else if (e.key === 'ArrowRight') setPage((p) => Math.min(totalPages - 1, p + 1));
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [totalPages, onClose]);

  if (proposal?.status !== 'ready' || !proposal.content) return null;
  const current = PROPOSAL_PAGES[page] ?? PROPOSAL_PAGES[0]!;

  // 表彰画面の中に置くと、画面の下に浮かせたワイプより奥に回るので、body の直下に出す
  return createPortal(
    <div className={styles.modalBackdrop} onClick={onClose}>
      <section className={styles.modalViewer} role="dialog" aria-modal="true" aria-label="企画書" onClick={(e) => e.stopPropagation()}>
        <div className={styles.viewerHeader}>
          <div className={styles.viewerTitleGroup}>
            <span className={styles.viewerBadge}>{current.part}</span>
            <strong className={styles.viewerSectionTitle}>{current.label}</strong>
          </div>
          <div className={styles.viewerNav}>
            <button type="button" className={styles.pageBtn} aria-label="前のページ" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              <ChevronLeft size={16} /> 前へ
            </button>
            <span className={styles.pageCounter} aria-live="polite">
              {page + 1} / {totalPages}
            </span>
            <button
              type="button"
              className={styles.pageBtn}
              aria-label="次のページ"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            >
              次へ <ChevronRight size={16} />
            </button>
            <button type="button" className={styles.closeViewerBtn} aria-label="企画書を閉じる" onClick={onClose}>
              <X size={15} />
              <span>閉じる</span>
            </button>
          </div>
        </div>
        <div className={styles.pageTabs} role="tablist" aria-label="企画書のパート">
          {PROPOSAL_PAGES.map((p) => (
            <button
              key={p.index}
              type="button"
              role="tab"
              aria-selected={page === p.index}
              className={styles.pageTab}
              data-active={page === p.index || undefined}
              onClick={() => setPage(p.index)}
            >
              {p.shortLabel}
            </button>
          ))}
        </div>
        <div ref={viewportRef} className={styles.viewerViewport}>
          <ProposalDocument snapshot={snapshot} content={proposal.content} page={page} preview />
        </div>
      </section>
    </div>,
    document.body,
  );
}
