import { Check, Columns3, FileText, Loader2, MessageSquare, Sparkles, Star, Vote, Wand2 } from 'lucide-react';
import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { SessionSnapshot } from '@idea-audition/protocol';
import { useDisplay } from '../../store/display-store.ts';
import { useSession } from '../../store/session-store.ts';
import { EMPTY, currentRevision, useMe } from '../../shared/selectors.ts';
import { proposalLetter } from '../../shared/proposal-label.ts';
import { DiscussionPanel } from './DiscussionPanel.tsx';
import { People } from './People.tsx';
import { PhaseDots } from './PhaseDots.tsx';
import { QA } from './QA.tsx';
import styles from './Official.module.css';
import { IdeaImage } from '../../shared/IdeaImage.tsx';

/**
 * オフィシャル会議モードの決勝（比較・改良と採決）。左に参加者、中に採択候補の比較（A案・B案…の列）と改良の方向性、右に議論の要約。
 * 列ごとに「詳細・質問」「議論する（全員で注目＝スポットライト）」、採決中は「投票」。
 * 中身は決勝と同じ：相互批評と改良で版が進み、投票（同票はホスト）で採択を決める
 */
export function OfficialFinal() {
  const snapshot = useSession((s) => s.snapshot)!;
  const [tab, setTab] = useState<'compare' | 'refine'>('compare');
  const ids = snapshot.upper.map((f) => f.instanceId);
  const voting = snapshot.vote?.status === 'open' || snapshot.vote?.status === 'tie';
  const voted = snapshot.vote?.status === 'open' ? snapshot.vote.votedJudgeIds : (EMPTY as readonly string[]);
  return (
    <div className={styles.room}>
      <People approved={voted} />
      <section className={styles.stageCard} aria-label="比較・改良">
        <div className={styles.cardTop}>
          <PhaseDots phase={voting ? 2 : 1} />
          <span className={styles.agendaInline}>
            議題 <b>{snapshot.theme}</b>
          </span>
          <BallotStatus snapshot={snapshot} />
        </div>
        <SpotlightNote snapshot={snapshot} />
        <div className={styles.cardTabs} role="tablist">
          <button role="tab" aria-selected={tab === 'compare'} data-on={tab === 'compare' || undefined} onClick={() => setTab('compare')}>
            <Columns3 size={15} /> 比較・検討
          </button>
          <button role="tab" aria-selected={tab === 'refine'} data-on={tab === 'refine' || undefined} onClick={() => setTab('refine')}>
            <Sparkles size={15} /> 改良案の生成（AI）
          </button>
        </div>
        {tab === 'compare' ? <CompareTable snapshot={snapshot} ids={ids} /> : <Refine snapshot={snapshot} ids={ids} />}
      </section>
      <DiscussionPanel />
    </div>
  );
}

/** 星の評価（案の8軸の値 -1〜1 を 1〜5 に）。実現しやすさはコストの逆 */
const STAR_ROWS = [
  { label: '実現しやすさ', axis: 0, invert: true },
  { label: '手軽さ', axis: 2 },
  { label: '新規性', axis: 1 },
  { label: '話題性', axis: 3 },
  { label: '社会性', axis: 5 },
  { label: '継続性', axis: 4 },
] as const;

function stars(v: number) {
  return Math.min(5, Math.max(1, Math.round(1 + (v + 1) * 2)));
}

function Stars({ value }: { value: number }) {
  const n = stars(value);
  return (
    <span className={styles.stars} role="img" aria-label={`5段階で${n}`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={15} fill={i <= n ? 'currentColor' : 'none'} data-on={i <= n || undefined} />
      ))}
    </span>
  );
}

function CompareTable({ snapshot, ids }: { snapshot: SessionSnapshot; ids: string[] }) {
  return (
    <div className={styles.compareWrap}>
      <table className={styles.compare} style={{ '--cols': ids.length } as CSSProperties}>
        <thead>
          <tr>
            <th aria-hidden />
            {ids.map((id) => (
              <CandidateHead key={id} snapshot={snapshot} instanceId={id} />
            ))}
          </tr>
        </thead>
        <tbody>
          <Row label="概要" ids={ids} cell={(id) => currentRevision(snapshot, id)?.summary} />
          {STAR_ROWS.map((r) => (
            <Row
              key={r.label}
              label={r.label}
              ids={ids}
              cell={(id) => {
                const v = currentRevision(snapshot, id)?.profile?.[r.axis];
                return v == null ? null : <Stars value={'invert' in r ? -v : v} />;
              }}
            />
          ))}
          <Row label="対象" ids={ids} cell={(id) => currentRevision(snapshot, id)?.outline?.who} />
          <Row label="課題" ids={ids} cell={(id) => currentRevision(snapshot, id)?.outline?.pain} />
          <Row label="解決策" ids={ids} cell={(id) => currentRevision(snapshot, id)?.outline?.how} />
          <Row
            label="反映した合意"
            ids={ids}
            cell={(id) => {
              const labels = currentRevision(snapshot, id)?.inspiredBy?.claimLabels ?? [];
              const texts = labels.map((l) => snapshot.consensus.claims.find((c) => c.label === l)?.text).filter((t): t is string => !!t);
              return texts.length ? (
                <ul>
                  {texts.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              ) : null;
            }}
          />
          <Row
            label="質疑応答"
            ids={ids}
            cell={(id) => (snapshot.answers.some((a) => a.instanceId === id) ? <QA snapshot={snapshot} instanceId={id} limit={1} /> : null)}
          />
        </tbody>
        <tfoot>
          <tr>
            <th aria-hidden />
            {ids.map((id) => (
              <td key={id}>
                <Decide snapshot={snapshot} instanceId={id} />
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** 改良の方向性（AI）：この版での変更・他の案からの指摘と、改良の依頼（指示を書いて AI に作り直してもらう） */
function Refine({ snapshot, ids }: { snapshot: SessionSnapshot; ids: string[] }) {
  return (
    <div className={styles.refineGrid} style={{ '--cols': ids.length } as CSSProperties}>
      {ids.map((id) => (
        <RefineCard key={id} snapshot={snapshot} instanceId={id} />
      ))}
    </div>
  );
}

function RefineCard({ snapshot, instanceId }: { snapshot: SessionSnapshot; instanceId: string }) {
  const send = useSession((s) => s.send);
  const { isSpectator } = useMe();
  const [text, setText] = useState('');
  const rev = currentRevision(snapshot, instanceId);
  const finalist = snapshot.upper.find((f) => f.instanceId === instanceId);
  if (!rev || !finalist) return null;
  const letter = proposalLetter(snapshot, instanceId);
  const critiques = snapshot.critiques.filter((c) => c.toInstanceId === instanceId).slice(-2);
  const busy = finalist.status === 'refining';
  return (
    <article className={styles.refineCard}>
      <header>
        <span className={styles.letter}>{letter}案</span>
        <span className={styles.version}>版 {rev.version}</span>
        {busy && (
          <em className={styles.busy}>
            <Loader2 size={12} className={styles.spin} /> 改良中
          </em>
        )}
      </header>
      <h3>{rev.title}</h3>
      {rev.version > 1 && rev.improvementPoints.length > 0 && (
        <section>
          <h4>この版での変更</h4>
          <ul>
            {rev.improvementPoints.slice(0, 3).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
      )}
      {critiques.length > 0 && (
        <section>
          <h4>
            <Sparkles size={13} /> 改良の方向性
          </h4>
          <ul>
            {critiques.map((c, i) => (
              <li key={i}>{c.text}</li>
            ))}
          </ul>
        </section>
      )}
      {!isSpectator && (
        <form
          className={styles.refineForm}
          onSubmit={(e) => {
            e.preventDefault();
            const t = text.trim();
            if (!t || busy) return;
            void send('REQUEST_REFINEMENT', { instanceId, text: t }).then((r) => {
              if (r.ok) setText('');
            });
          }}
        >
          <input value={text} maxLength={200} onChange={(e) => setText(e.target.value)} placeholder="改良の指示" aria-label={`${letter}案への改良の指示`} />
          <button className={styles.primary} disabled={!text.trim() || busy}>
            <Wand2 size={15} /> 改良する
          </button>
        </form>
      )}
    </article>
  );
}

function Row({ label, ids, cell }: { label: string; ids: string[]; cell: (id: string) => React.ReactNode }) {
  const cells = ids.map((id) => cell(id));
  if (cells.every((c) => c == null || c === '')) return null;
  return (
    <tr>
      <th scope="row">{label}</th>
      {ids.map((id, i) => (
        <td key={id}>{cells[i] ?? <span className={styles.muted}>—</span>}</td>
      ))}
    </tr>
  );
}

const BUSY = { refining: '改良中', critiquing: '批評中', ready: '' } as const;

/** 列の見出し：記号・案名・版・状態、詳細・質問と、議論する（全員で注目） */
function CandidateHead({ snapshot, instanceId }: { snapshot: SessionSnapshot; instanceId: string }) {
  const send = useSession((s) => s.send);
  const select = useDisplay((s) => s.select);
  const { isSpectator } = useMe();
  const revision = currentRevision(snapshot, instanceId);
  const finalist = snapshot.upper.find((f) => f.instanceId === instanceId);
  if (!revision || !finalist) return <th />;
  const letter = proposalLetter(snapshot, instanceId);
  const spot = snapshot.spotlight?.instanceId === instanceId;
  const answering = snapshot.answers.some((a) => a.instanceId === instanceId && a.answer === null);
  const busy = BUSY[finalist.status] || (answering ? '回答中' : '');
  return (
    <th scope="col" data-spot={spot || undefined}>
      <div className={styles.candHead}>
        <span className={styles.letter}>{letter}案</span>
        <span className={styles.version}>
          版 {revision.version}
          {busy && (
            <em>
              <Loader2 size={11} className={styles.spin} /> {busy}
            </em>
          )}
        </span>
      </div>
      <IdeaImage ideaId={snapshot.characters[instanceId]?.ideaId} className={styles.candImage} />
      <div className={styles.candTitle}>{revision.title}</div>
      <div className={styles.candActions}>
        <button className={styles.linkButton} onClick={() => select(instanceId)}>
          <FileText size={14} /> 詳細・質問
        </button>
        {!isSpectator && (
          <button className={styles.linkButton} data-on={spot || undefined} onClick={() => void send('SET_SPOTLIGHT', { instanceId: spot ? null : instanceId })}>
            <MessageSquare size={14} /> {spot ? '議論を終える' : '議論する'}
          </button>
        )}
      </div>
    </th>
  );
}

/** いま議論している案（スポットライト）。名前を言わない質問はこの案に向く */
function SpotlightNote({ snapshot }: { snapshot: SessionSnapshot }) {
  const send = useSession((s) => s.send);
  const id = snapshot.spotlight?.instanceId;
  if (!id) return null;
  const letter = proposalLetter(snapshot, id);
  const title = currentRevision(snapshot, id)?.title;
  return (
    <div className={styles.notice} role="status">
      <MessageSquare size={15} /> 議論中：<b>{letter}案</b> {title}
      <button onClick={() => void send('SET_SPOTLIGHT', { instanceId: null })}>終える</button>
    </div>
  );
}

/** 列の下：採決中は投票、同票はホストが決定、1案だけ・ひとりで審査ならホストがそのまま採択 */
function Decide({ snapshot, instanceId }: { snapshot: SessionSnapshot; instanceId: string }) {
  const send = useSession((s) => s.send);
  const { isHost, isSpectator } = useMe();
  const myVote = useDisplay((s) => s.myVote);
  const setMyVote = useDisplay((s) => s.setMyVote);
  const vote = snapshot.vote;
  if (isSpectator) return null;
  if (vote?.status === 'open') {
    const chosen = myVote === instanceId;
    return (
      <button
        className={chosen ? styles.primary : styles.secondary}
        aria-pressed={chosen}
        onClick={async () => {
          if (chosen) return;
          const r = await send('CAST_VOTE', { instanceId });
          if (r.ok) setMyVote(instanceId);
        }}
      >
        {chosen ? (
          <>
            <Check size={15} /> 投票済み
          </>
        ) : myVote ? (
          'この案に変更'
        ) : (
          <>
            <Vote size={15} /> この案に投票
          </>
        )}
      </button>
    );
  }
  if (vote?.status === 'tie') {
    if (!vote.tieInstanceIds.includes(instanceId)) return null;
    return isHost ? (
      <button className={styles.primary} onClick={() => void send('RESOLVE_TIE', { instanceId })}>
        この案に決定
      </button>
    ) : (
      <span className={styles.muted}>同票：ホストが決定します</span>
    );
  }
  const direct = snapshot.mode === 'solo' || (snapshot.upper.length === 1 && isHost);
  if (direct && snapshot.status === 'audition_active') {
    return (
      <button
        className={styles.secondary}
        onClick={() => {
          if (window.confirm('この案を採択しますか？')) void send('SELECT_CHAMPION', { instanceId });
        }}
      >
        <Check size={15} /> この案を採択
      </button>
    );
  }
  return null;
}

/** 右上：採決の状況（だれが投票済みか）。採決前はホストに「採決を始める」 */
function BallotStatus({ snapshot }: { snapshot: SessionSnapshot }) {
  const send = useSession((s) => s.send);
  const toast = useDisplay((s) => s.toast);
  const { isHost, isSpectator } = useMe();
  const vote = snapshot.vote;
  if (vote?.status === 'open') {
    const judges = snapshot.judges.filter((j) => j.connected);
    const done = judges.filter((j) => vote.votedJudgeIds.includes(j.judgeId)).length;
    return (
      <div className={styles.ballot} role="status" aria-label={`投票 ${done} / ${judges.length}`}>
        <span>採決中</span>
        {judges.map((j) => (
          <span key={j.judgeId} className={styles.voter} data-voted={vote.votedJudgeIds.includes(j.judgeId) || undefined}>
            {vote.votedJudgeIds.includes(j.judgeId) && <Check size={11} />}
            {j.name ?? j.label}
          </span>
        ))}
        <b>
          {done} / {judges.length}
        </b>
        {isHost && done < judges.length && (
          <button className={styles.secondary} onClick={() => void send('CLOSE_VOTE', {})}>
            締め切る
          </button>
        )}
      </div>
    );
  }
  if (vote?.status === 'tie') return <span className={styles.muted}>同票：ホストが決定します</span>;
  if (isSpectator || snapshot.mode === 'solo' || snapshot.upper.length < 2) return null;
  return (
    <button
      className={styles.primary}
      disabled={snapshot.status !== 'audition_active'}
      onClick={() => {
        if (!isHost) {
          toast('採決はホストが始めます', 'warn');
          return;
        }
        void send('START_CHAMPION_VOTE', {});
      }}
    >
      <Vote size={15} /> 採決を始める
    </button>
  );
}
