import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from 'motion/react';
import { ArrowRight, Check, ChevronRight, Crown, Pause, Play, SkipForward, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { PITCH_ROLE_ICON, type JudgeView, type SessionSnapshot } from '@idea-audition/protocol';
import { useDisplay } from '../store/display-store.ts';
import { useSession } from '../store/session-store.ts';
import { Mascot } from '../shared/Mascot.tsx';
import { EMPTY, currentRevision, finalistTarget, useMe } from '../shared/selectors.ts';
import { setHoverFocus } from './focus.ts';
import { COUNTDOWN_CLIP, playCountdownClip, playSfx, preloadClip } from '../shared/sfx.ts';
import { JudgeWipe } from '../features/call/CallControls.tsx';
import { TasteCard } from '../features/taste/TasteCard.tsx';
import './prelim-gpt.css';

/** 合格の演出の長さ（長いとテンポが落ちる） */
export const PASS_CEREMONY_MS = 2_000;
/** この秒数からカウントダウンを出す。URGENT 秒からは画面を赤くして急かす */
const URGENT_FROM = 5;

/**
 * 予選（#5）：新しいアイデアは1人ずつ登場する。
 * 審査員全員がゴールデンブザーを押したら合格して「合格者待機室」へ。3人そろったら最終オーディションに切り替わる。
 * 見た目は ChatGPT が作ったモック（IDEA_AUDITION 2）のものを使う。データはサーバーの snapshot。
 */
export function PreliminaryStage() {
  const snapshot = useSession((s) => s.snapshot)!;
  const passed = usePassCeremony(snapshot);
  const challenger = snapshot.lowerSlots[0] ?? null;
  // 合格の演出（約2秒）のあいだは合格したキャラを舞台に残し、終わったら次の挑戦者を出す
  const shown = passed?.instanceId ?? challenger;
  const celebrating = !!passed;
  useLeaveSound(snapshot, challenger);
  return (
    <div className="ia-prelim">
      <div className="workspace">
        <section className={'stage ' + (celebrating ? 'gold-stage' : '')} aria-label="オーディションステージ">
          <div className="stage-topline">
            <span className="ia-theme">
              <b>● LIVE</b>
              <small>本日のテーマ</small>
              <strong>{snapshot.theme}</strong>
            </span>
          </div>
          <div className="stage-light light-one" />
          <div className="stage-light light-two" />
          <div className="stage-light light-three" />
          <div className="ambient-particles" />
          <WaitingRoom snapshot={snapshot} />
          {/* 待機室のすぐ下に、いつも見える「みんなの好み」 */}
          <TasteCard />
          <img className="ia-backdrop" src="/brand/logo-neon.webp" alt="" aria-hidden />
          <div className="ring-floor">
            <div />
            <i />
          </div>
          {/* custom：退場するキャラが合格（上段）か見送り・時間切れかで、去り方を変える */}
          <AnimatePresence initial={false} custom={snapshot}>
            {shown ? (
              <Performance key={shown} snapshot={snapshot} instanceId={shown} promoting={celebrating} />
            ) : (
              <motion.div key="prep" className="solo-performance" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {/* 次の挑戦者を AI が考えているあいだ：影だけのキャラと「…」で、考え中だと分かるように */}
                <div className="ia-preparing" role="status">
                  <span className="ia-silhouette" aria-hidden>
                    <Mascot designId={0} className="mascot" />
                  </span>
                  <span className="ia-prep-dots" aria-hidden>
                    <i />
                    <i />
                    <i />
                  </span>
                  <p>次の挑戦者がアイデアを考え中…</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {!celebrating && challenger && (
            <Countdown
              leavingAt={snapshot.characters[challenger]?.leavingAt ?? null}
              pausedLeftMs={snapshot.characters[challenger]?.pausedLeftMs ?? null}
              held={snapshot.characters[challenger]?.holdBy != null}
            />
          )}
          <BuzzerZone snapshot={snapshot} instanceId={celebrating ? null : challenger} celebrating={celebrating} />
          {celebrating && <PassEffect seed={passed!.seed} name={snapshot.characters[passed!.instanceId]?.name ?? ''} />}
        </section>
      </div>
    </div>
  );
}

/** 合格の演出（約1.3秒）。そのあいだは合格したキャラを舞台に残す */
function usePassCeremony(snapshot: SessionSnapshot) {
  const [passed, setPassed] = useState<{ instanceId: string; seed: number } | null>(null);
  const n = snapshot.upper.length;
  const lastId = snapshot.upper[n - 1]?.instanceId ?? null;
  const prev = useRef(n);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // snapshot は届くたびに新しくなるので、人数（n）が増えたときだけ演出を始める。タイマーは画面の更新で止めない
  useEffect(() => {
    if (n > prev.current && lastId) {
      playSfx('pass');
      setPassed({ instanceId: lastId, seed: Date.now() });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setPassed(null), PASS_CEREMONY_MS);
    }
    prev.current = n;
  }, [n, lastId]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return passed;
}

/** 合格したキャラが待機室へ飛んでいって着くまでの時間（ReactiveMascot の跳ねる＋飛ぶ の長さ） */
const ARRIVE_DELAY_S = 1.35;

/**
 * 待機室に新しく入ったキャラ（この画面を開いてから合格したもの）。
 * 最初の描画から分かるようにする：合格の演出の state は1回あとの描画で立つので、それを待つと枠の中身が先に出てしまう。
 */
function useNewArrivals(ids: readonly string[]) {
  const known = useRef<Set<string> | null>(null);
  if (!known.current) known.current = new Set(ids);
  const [recent, setRecent] = useState<readonly string[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const newcomers = ids.filter((id) => !known.current!.has(id));
  const key = newcomers.join(',');
  useEffect(() => {
    if (!key) return;
    const added = key.split(',');
    added.forEach((id) => known.current!.add(id));
    setRecent((r) => [...r, ...added]);
    // 枠が光り終わるまで（約2.6秒）は「着いたばかり」として扱う
    const timer = setTimeout(() => {
      setRecent((r) => r.filter((id) => !added.includes(id)));
      timers.current = timers.current.filter((t) => t !== timer);
    }, 2_600);
    timers.current.push(timer);
  }, [key]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  return (id: string) => newcomers.includes(id) || recent.includes(id);
}

/** 挑戦者が見送り・時間切れで去ったら「ひゅるる」と鳴らす（合格で去ったときは合格の音だけ） */
function useLeaveSound(snapshot: SessionSnapshot, challenger: string | null) {
  const prev = useRef(challenger);
  useEffect(() => {
    const before = prev.current;
    prev.current = challenger;
    if (before && before !== challenger && snapshot.characters[before]?.location === 'archived') playSfx('leave');
  }, [challenger, snapshot]);
}

function WaitingRoom({ snapshot }: { snapshot: SessionSnapshot }) {
  const reduced = useReducedMotion();
  const isArriving = useNewArrivals(snapshot.upper.map((f) => f.instanceId));
  const select = useDisplay((s) => s.select);
  return (
    <aside className="waiting-room">
      <div className="waiting-heading">
        <Crown size={17} />
        <h2>合格者待機室</h2>
        <b>
          {snapshot.upper.length} / {finalistTarget(snapshot)}
        </b>
        <EndPreliminary snapshot={snapshot} />
      </div>
      <div className="waiting-slots" data-count={finalistTarget(snapshot)}>
        {Array.from({ length: finalistTarget(snapshot) }, (_, n) => {
          const f = snapshot.upper[n];
          const c = f ? snapshot.characters[f.instanceId] : null;
          const rev = f ? currentRevision(snapshot, f.instanceId) : null;
          return (
            <div className={'waiting-slot ' + (c ? 'filled' : '') + (f && isArriving(f.instanceId) ? ' arriving' : '')} key={n} data-waiting-slot={n}>
              {c && rev ? (
                <motion.div
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  // 飛んできたキャラが着いてから、枠の中に現れる（先に人数だけ増えて見えないように）
                  transition={{ delay: isArriving(c.instanceId) && !reduced ? ARRIVE_DELAY_S : 0 }}
                  onClick={() => select(c.instanceId)}
                >
                  <Mascot designId={c.designId} className="mascot" />
                  <span>{rev.title}</span>
                </motion.div>
              ) : (
                <div className="empty-crown">
                  <Crown size={23} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function Performance({ snapshot, instanceId, promoting }: { snapshot: SessionSnapshot; instanceId: string; promoting: boolean }) {
  const reduced = useReducedMotion();
  const select = useDisplay((s) => s.select);
  const bubble = useDisplay((s) => s.bubbles[instanceId]);
  const character = snapshot.characters[instanceId];
  const revision = currentRevision(snapshot, instanceId);
  if (!character || !revision) return null;
  const pitch = snapshot.ideas[character.ideaId]?.pitch;
  return (
    <motion.div
      className="solo-performance"
      initial={{ opacity: 0, y: reduced ? 0 : 45 }}
      animate={{ opacity: 1, y: 0 }}
      variants={{ leave: (latest: SessionSnapshot) => leaveAnimation(latest, instanceId, !!reduced) }}
      exit="leave"
      style={{ pointerEvents: promoting ? 'none' : undefined }}
      transition={{ type: 'spring', stiffness: 110, damping: 17 }}
    >
      <motion.button
        className="hero-character"
        // キャラの体にカーソルを乗せると深掘りタイム（交代のカウントが止まる）
        onPointerEnter={() => setHoverFocus(instanceId)}
        onPointerLeave={() => setHoverFocus(null)}
        onClick={() => select(instanceId)}
        aria-label={`${character.name}の企画詳細`}
        // 待機中のゆらゆらは ReactiveMascot の中（.ia-bob）で動かす。ここで動かすと足元の影まで一緒に浮く
      >
        {bubble && <span className="ia-bubble">{bubble.text}</span>}
        <ReactiveMascot snapshot={snapshot} instanceId={instanceId} designId={character.designId} promoting={promoting} />
        <span className="character-label">
          <span />
          {character.name}
        </span>
      </motion.button>
      <motion.button
        className="idea-flip"
        initial={{ opacity: 0, x: reduced ? 0 : 35 }}
        // 合格したらフリップは消え、キャラだけが待機室へ飛んでいく
        animate={{ opacity: promoting ? 0 : 1, x: 0 }}
        transition={{ delay: promoting ? 0 : 0.2 }}
        onClick={() => select(instanceId)}
      >
        <div className="flip-eyebrow">
          {pitch ? `${PITCH_ROLE_ICON[pitch.role]} ${pitch.reason}` : `${revision.icon} IDEA`}
          <Sparkles size={15} />
        </div>
        <h1>{revision.title}</h1>
        <div className="flip-rule" />
        <p>{revision.summary}</p>
        <span className="flip-more">
          アイデアを詳しく見る <ArrowRight size={13} />
        </span>
      </motion.button>
    </motion.div>
  );
}

/**
 * 舞台を去るときの動き。合格（上段へ）は演出で飛んでいったあとなのですぐ消す。
 * 見送り・時間切れは、しょんぼり縮んで沈みながら消える。
 * どちらも pointerEvents を先に切る（透明のまま残ると、次のキャラへのカーソルやクリックをさえぎる）。
 */
function leaveAnimation(latest: SessionSnapshot, instanceId: string, reduced: boolean) {
  const promoted = latest.characters[instanceId]?.location === 'upper';
  if (promoted || reduced) return { opacity: 0, pointerEvents: 'none' as const, transition: { duration: 0.15 } };
  return {
    opacity: 0,
    y: 40,
    scale: 0.82,
    rotate: -6,
    pointerEvents: 'none' as const,
    transition: { duration: 0.45, ease: 'easeIn' as const },
  };
}

/** 押されたブザーの数（このキャラに対して） */
function pressedCount(snapshot: SessionSnapshot, instanceId: string) {
  return snapshot.buzzer?.instanceId === instanceId ? snapshot.buzzer.judgeIds.length : 0;
}

/**
 * キャラの反応（C1）。静止画のまま、動きだけで気持ちを見せる（ADR-0001）。
 * - 登場：ぽんと弾んで、頭の上に 💡
 * - ブザーが押されるたび：うれしそうに跳ねる
 * - 合格：大きくジャンプ
 * - 待機中：ゆらゆら上下し（CSS の ia-bob）、ときどき、まばたきのように縦に縮む（CSS の ia-blink）
 *
 * 足元の影（.ia-foot-shadow）は床に置いたまま動かさず、体が浮くのに合わせて縮んで薄くなる。
 * 体の動き（controls）と影の動き（shadow）は同じ長さ・同じタイミングで並べて動かす。
 */
function ReactiveMascot({ snapshot, instanceId, designId, promoting }: { snapshot: SessionSnapshot; instanceId: string; designId: number; promoting: boolean }) {
  const reduced = useReducedMotion();
  const controls = useAnimationControls();
  const shadow = useAnimationControls();
  const presses = pressedCount(snapshot, instanceId);
  const prevPresses = useRef(presses);
  const [spark, setSpark] = useState(true);

  useEffect(() => {
    if (reduced) return;
    void controls.start({ scale: [0.7, 1.08, 1], transition: { duration: 0.55, times: [0, 0.6, 1] } });
    void shadow.start({ opacity: [0, 1], scale: [0.6, 1], transition: { duration: 0.55 } });
    const t = setTimeout(() => setSpark(false), 1_400);
    return () => clearTimeout(t);
  }, [controls, shadow, reduced]);

  useEffect(() => {
    const increased = presses > prevPresses.current;
    prevPresses.current = presses;
    if (!increased || reduced || promoting) return;
    const transition = { duration: 0.7, times: [0, 0.3, 0.55, 0.75, 1] };
    void controls.start({
      y: [0, -26, 0, -8, 0],
      scaleX: [1, 0.92, 1.06, 0.98, 1],
      scaleY: [1, 1.08, 0.94, 1.02, 1],
      transition,
    });
    // 跳ねて体が離れると影は小さく薄く、着地でつぶれると少し広がる
    void shadow.start({ scaleX: [1, 0.7, 1.08, 0.9, 1], opacity: [1, 0.5, 1, 0.85, 1], transition });
  }, [presses, controls, shadow, reduced, promoting]);

  const ref = useRef<HTMLSpanElement>(null);
  // 行き先の枠は飛ぶ瞬間に読む（演出の途中で snapshot が届いても、飛ぶのをやり直さない）
  const slotRef = useRef(-1);
  slotRef.current = snapshot.upper.findIndex((f) => f.instanceId === instanceId);
  useEffect(() => {
    if (!promoting) return;
    if (reduced) {
      void controls.start({ opacity: 0, transition: { duration: 0.6 } });
      void shadow.start({ opacity: 0, transition: { duration: 0.6 } });
      return;
    }
    let cancelled = false;
    void (async () => {
      // 合格：その場で大きくジャンプ → 待機室の自分の枠へ小さくなりながら飛んでいく
      const jump = { duration: 0.55, ease: 'easeOut' } as const;
      void shadow.start({ scale: [1, 0.55, 1], opacity: [1, 0.4, 1], transition: jump });
      await controls.start({
        y: [0, -60, 0],
        rotate: [0, -8, 8, 0],
        scale: [1, 1.12, 1],
        transition: jump,
      });
      if (cancelled) return;
      // 飛び立つと影は床に残らない
      void shadow.start({ opacity: 0, transition: { duration: 0.2 } });
      const target = document.querySelector(`.ia-prelim [data-waiting-slot="${slotRef.current}"]`);
      if (!ref.current || !target) {
        // 行き先が分からないときは、その場で消える（舞台に残ったままにしない）
        void controls.start({ opacity: 0, transition: { duration: 0.3 } });
        return;
      }
      const from = ref.current.getBoundingClientRect();
      const to = target.getBoundingClientRect();
      // originY: 1（足元）を基準に縮むので、行き先も枠の下寄せで合わせる
      const dx = to.left + to.width / 2 - (from.left + from.width / 2);
      const dy = to.top + to.height * 0.85 - (from.top + from.height);
      const scale = Math.max(0.12, (to.width * 0.8) / from.width);
      await controls.start({
        x: dx,
        y: [0, dy - 80, dy],
        scale,
        rotate: [0, -12, 0],
        transition: { duration: 0.8, ease: 'easeInOut' },
      });
      if (!cancelled) void controls.start({ opacity: 0, transition: { duration: 0.15 } });
    })();
    return () => {
      cancelled = true;
    };
  }, [promoting, controls, shadow, reduced]);

  return (
    <span className="ia-stand" data-promoting={promoting || undefined}>
      {/* 影は .ia-bob の外：ゆらゆらやジャンプで体が浮いても、影は床に残る */}
      <span className="ia-foot-shadow" aria-hidden>
        <motion.span className="ia-foot-shadow-core" animate={shadow} />
      </span>
      <span className="ia-bob">
        <motion.span ref={ref} className="ia-mascot-react" animate={controls} style={{ originY: 1 }}>
          <AnimatePresence>
            {spark && !reduced && (
              <motion.span
                className="ia-spark"
                aria-hidden
                initial={{ opacity: 0, scale: 0.3, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ type: 'spring', stiffness: 380, damping: 14 }}
              >
                💡
              </motion.span>
            )}
          </AnimatePresence>
          <span className="ia-blink">
            <Mascot designId={designId} className="mascot" />
          </span>
        </motion.span>
      </span>
    </span>
  );
}

function BuzzerZone({ snapshot, instanceId, celebrating }: { snapshot: SessionSnapshot; instanceId: string | null; celebrating: boolean }) {
  const send = useSession((s) => s.send);
  const { judgeId, isSpectator } = useMe();
  const judges = snapshot.judges.filter((j) => j.connected);
  const pressed = (snapshot.buzzer?.instanceId === instanceId ? snapshot.buzzer?.judgeIds : null) ?? (EMPTY as readonly string[]);
  const targetName = instanceId ? snapshot.characters[instanceId]?.name : null;
  useBuzzSound(pressed.length, instanceId);
  return (
    <div className="buzzer-zone">
      {/*
        いまブザーで審査しているのが誰の案か（見ている間に入れ替わっても、押す相手が分かるように）。
        合格の演出中や次の挑戦者を待つあいだも、場所は空けたまま残す（台の位置がずれないように）
      */}
      {/* 左右は同じ幅の欄にして、台の列がちょうど画面の真ん中に来るようにする */}
      <div className="buzz-side buzz-left">
        {targetName && !celebrating ? (
          <span className="ia-buzz-target" key={instanceId}>
            <span>
              <b>{targetName}</b> に合格を出す？
            </span>
            <small>
              {pressed.length} / {judges.length} 人が押した
            </small>
          </span>
        ) : (
          <span className="ia-buzz-target" aria-hidden />
        )}
        {!isSpectator && instanceId ? <HoldButton snapshot={snapshot} instanceId={instanceId} /> : <span className="ia-skip ia-slot" aria-hidden />}
      </div>
      {/* 審査員ごとの台：上にその人のブザー、正面にその人の顔（ワイプ）。切断中の人も台は残す */}
      <div className="buzzers" style={{ '--count': snapshot.judges.length } as CSSProperties}>
        {snapshot.judges.map((j) => {
          const on = celebrating || pressed.includes(j.judgeId);
          return (
            <div
              key={j.judgeId}
              className="podium"
              data-pressed={on || undefined}
              data-offline={!j.connected || undefined}
              style={{ '--person': j.color } as CSSProperties}
            >
              <Buzzer
                judge={j}
                mine={j.judgeId === judgeId}
                pressed={on}
                disabled={celebrating || !instanceId || j.judgeId !== judgeId || !j.connected}
                onClick={() => instanceId && void send('PRESS_BUZZER', { instanceId, on: !pressed.includes(j.judgeId) })}
              />
              <div className="podium-screen">
                <JudgeWipe judgeId={j.judgeId} letter={j.letter ?? j.label.slice(-1)} name={j.name ?? j.label} color={j.color} host={j.isHost} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="buzz-side buzz-right">
        {!isSpectator && instanceId ? (
          <button className="ia-skip" onClick={() => void send('REJECT_CANDIDATE', { instanceId })} aria-label="見送って次のアイデアへ" title="見送る">
            <SkipForward size={22} />
            <span>交代</span>
          </button>
        ) : (
          <span className="ia-skip ia-slot" aria-hidden />
        )}
      </div>
    </div>
  );
}

/** だれかがブザーを押したら「ブッ」。全員そろったら上がる2音 */
function useBuzzSound(count: number, instanceId: string | null) {
  const judges = useSession((s) => s.snapshot?.judges.filter((j) => j.connected).length ?? 0);
  const prev = useRef({ count, instanceId });
  useEffect(() => {
    const before = prev.current;
    prev.current = { count, instanceId };
    if (before.instanceId !== instanceId || count <= before.count) return;
    playSfx(count >= judges ? 'allPressed' : 'buzz');
  }, [count, instanceId, judges]);
}

function Buzzer({ judge, mine, pressed, disabled, onClick }: { judge: JudgeView; mine: boolean; pressed: boolean; disabled: boolean; onClick(): void }) {
  return (
    <motion.button
      whileTap={disabled ? {} : { scale: 0.97 }}
      className={'buzzer ' + (pressed ? 'pressed' : '') + (mine ? ' mine' : '')}
      style={{ '--person': judge.color } as CSSProperties}
      disabled={disabled}
      onClick={onClick}
      aria-label={mine ? 'あなたのブザー' : `${judge.name ?? judge.label}のブザー`}
      aria-pressed={pressed}
    >
      {mine && <span className="ia-you">あなた</span>}
      <span className="buzzer-rays">
        <i />
        <i />
        <i />
      </span>
      <span className="buzzer-dome">
        <span />
        {pressed && <Check size={26} />}
      </span>
      <span className="buzzer-collar" />
    </motion.button>
  );
}

function PassEffect({ seed, name }: { seed: number; name: string }) {
  const reduce = useReducedMotion();
  return (
    <>
      <div className="confetti" key={`c${seed}`} aria-hidden="true">
        {Array.from({ length: reduce ? 10 : 68 }, (_, n) => (
          <i
            key={n}
            style={
              {
                left: `${(n * 43) % 100}%`,
                top: `${(n * 23) % 70}%`,
                '--dx': `${(n % 2 ? 1 : -1) * (40 + ((n * 7) % 250))}px`,
                '--dy': `${90 + ((n * 17) % 350)}px`,
                animationDelay: `${(n % 11) * 0.045}s`,
                transform: `rotate(${n * 37}deg)`,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="pass-effect ascending" key={`p${seed}`}>
        <div className="light-pillar" />
        <div className="gold-orbit orbit1" />
        <div className="gold-orbit orbit2" />
        <motion.div className="pass-title" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
          <Crown />
          <strong>合格！</strong>
          <span>{name ? `${name} · UNANIMOUS APPROVAL` : 'UNANIMOUS APPROVAL'}</span>
        </motion.div>
      </div>
    </>
  );
}

/**
 * 残り10秒から大きくカウントダウン。5秒からは画面のふちが赤く脈打って急かす。
 * 深掘りタイム中はカウントダウンを止め、右上に残りの秒数だけを出す。
 */
function Countdown({ leavingAt, pausedLeftMs, held }: { leavingAt: string | null; pausedLeftMs: number | null; held: boolean }) {
  const left = useSecondsLeft(leavingAt);
  useCountdownSound(pausedLeftMs == null && !held ? leavingAt : null);
  if (pausedLeftMs != null || held) {
    return (
      <div className={'ia-corner ' + (held ? 'ia-held' : 'ia-deepdive')} role="status">
        <strong>{held ? '⏸ 一時停止' : '🔍 深掘りタイム'}</strong>
        {pausedLeftMs != null && (
          <span>
            残り <b>{Math.ceil(pausedLeftMs / 1000)}</b> 秒
          </span>
        )}
      </div>
    );
  }
  if (!leavingAt || left <= 0) return null;
  const urgent = left <= URGENT_FROM;
  return (
    <>
      {urgent && <div className="ia-urgent" aria-hidden />}
      <div className="ia-countdown" data-urgent={urgent || undefined} role="timer" aria-label={`あと${left}秒で交代`}>
        <small>あと</small>
        <motion.b key={left} initial={{ scale: 1.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.25 }}>
          {left}
        </motion.b>
        <small>秒</small>
      </div>
    </>
  );
}

/**
 * 残り3秒から、カウントダウンの音を鳴らす。交代の時刻が変わったら（一時停止・再開・合格・交代）止めて数え直す。
 * 画面を開いた時点ですでに3秒を切っていれば、その位置から鳴らす。
 */
function useCountdownSound(leavingAt: string | null) {
  useEffect(() => {
    void preloadClip(COUNTDOWN_CLIP);
  }, []);
  useEffect(() => {
    if (!leavingAt) return;
    const deadline = new Date(leavingAt).getTime();
    if (deadline <= Date.now()) return;
    return playCountdownClip(deadline);
  }, [leavingAt]);
}

function useSecondsLeft(leavingAt: string | null) {
  // 時刻は描画のたびにその場で読む。止まっていた間の古い時刻で計算すると、再開した瞬間に大きな数字が一度出る
  const [, tick] = useState(0);
  useEffect(() => {
    if (!leavingAt) return;
    const t = setInterval(() => tick((x) => x + 1), 250);
    return () => clearInterval(t);
  }, [leavingAt]);
  return leavingAt ? Math.max(0, Math.ceil((Date.parse(leavingAt) - Date.now()) / 1000)) : 0;
}

/** 予選の一時停止（だれでも押せる。押した人がいなくなったら自動で解除） */
function HoldButton({ snapshot, instanceId }: { snapshot: SessionSnapshot; instanceId: string }) {
  const send = useSession((s) => s.send);
  const held = snapshot.characters[instanceId]?.holdBy != null;
  return (
    <button
      className="ia-skip ia-hold"
      data-on={held || undefined}
      onClick={() => void send('HOLD_CHALLENGE', { instanceId, on: !held })}
      aria-pressed={held}
      aria-label={held ? '再開する' : '一時停止する'}
      title={held ? '再開' : '一時停止'}
    >
      {held ? <Play size={22} /> : <Pause size={22} />}
      <span>{held ? '再開' : '一時停止'}</span>
    </button>
  );
}

/** ホストだけ：合格者が決勝の人数に満たなくても、いまの合格者で決勝に進む */
function EndPreliminary({ snapshot }: { snapshot: SessionSnapshot }) {
  const send = useSession((s) => s.send);
  const { isHost } = useMe();
  const n = snapshot.upper.length;
  if (!isHost || n === 0 || n >= finalistTarget(snapshot)) return null;
  return (
    <button
      className="ia-end-prelim"
      onClick={() => {
        if (window.confirm(`いまの${n}人で決勝に進みますか？`)) void send('END_PRELIMINARY', {});
      }}
      title="いまの合格者で決勝へ"
    >
      決勝へ <ChevronRight size={13} />
    </button>
  );
}
