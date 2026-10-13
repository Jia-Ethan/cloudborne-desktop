import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type RefObject } from 'react';
import { api, errorText, type ChestSource, type Draw, type LotteryStatus, type Perk, type Rarity } from '../api';
import { useI18n, type T } from '../i18n';
import {
  RARITIES,
  balanceGained,
  batchSize,
  byRarity,
  countdown,
  dailyState,
  earnProgress,
  quotaLeft,
  headline,
  revealLadder,
  dollars,
  shanghaiShort,
  zhe,
  zheVars,
  type Phase as ActivityPhase,
} from '../lottery';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { burst, coinRain, confetti, lightning, motes, type Motes } from './fx';
import { PrizeText, RarityTag } from './Prize';

type Phase = 'idle' | 'charge' | 'reveal' | 'burst' | 'result';
/** What the chest looks like at rest: one to open, none yet, or none and the activity is over. */
type ChestState = 'ready' | 'locked' | 'empty';

const CHARGE_MS = 1200;
const STEP_MS = 520;
const OPEN_MS = 980;

/** Light colour per rarity, used for the seam, jewel, beam and halo. */
const GLOW: Record<Rarity, string> = {
  common: '#f6f1e7',
  rare: '#4d8dff',
  epic: '#b06cff',
  legendary: '#ffc22e',
};
const IDLE_GLOW = '#ffb36b';
const CHARGE_GLOW = '#fff1d6';
const MOTE: Record<Rarity, string> = {
  common: '255,255,255',
  rare: '120,170,255',
  epic: '205,150,255',
  legendary: '255,212,110',
};
const IDLE_MOTE = '255,200,150';
const SPARKS: Record<Rarity, string[]> = {
  common: ['#ffffff', '#f3eee4', '#d9dee5'],
  rare: ['#bfdbfe', '#4d8dff', '#ffffff'],
  epic: ['#e9d5ff', '#b06cff', '#f0abfc', '#ffffff'],
  legendary: ['#fff1b8', '#ffc22e', '#ffffff', '#ff9d3c'],
};

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The chest page: the one place to open chests, whether earned by spending or
 * bought with balance. `onStatus` keeps the sidebar's badge and visibility in
 * step; `onBalance` refetches the balance after an open or a purchase.
 */
export function LotteryView({
  balance,
  onBalance,
  onStatus,
}: {
  balance: number;
  onBalance: () => void;
  onStatus: (s: LotteryStatus) => void;
}) {
  const { t } = useI18n();
  const [status, setStatusState] = useState<LotteryStatus | null>(null);
  // Server clock minus ours, so countdowns follow the relay.
  const [skew, setSkew] = useState(0);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [step, setStep] = useState(0);
  const [draw, setDraw] = useState<Draw | null>(null);
  // Every draw of a batch open, for the summary sheet; null for a single open.
  const [batch, setBatch] = useState<Draw[] | null>(null);
  const [flash, setFlash] = useState(false);
  const [nudge, setNudge] = useState(0);
  const stage = useRef<HTMLElement>(null);
  const mouth = useRef<HTMLSpanElement>(null);
  const sparks = useRef<HTMLCanvasElement>(null);
  const bolts = useRef<HTMLCanvasElement>(null);
  const moteCanvas = useRef<HTMLCanvasElement>(null);
  const rain = useRef<HTMLCanvasElement>(null);
  const coins = useRef<HTMLCanvasElement>(null);
  const field = useRef<Motes | null>(null);
  const stops = useRef<(() => void)[]>([]);
  const alive = useRef(true);
  const parallax = useRef(0);

  const setStatus = useCallback(
    (s: LotteryStatus) => {
      setStatusState(s);
      const at = Date.parse(s.now);
      if (Number.isFinite(at)) setSkew(at - Date.now());
      onStatus(s);
    },
    [onStatus],
  );

  const load = useCallback(async () => {
    try {
      const s = await api.lottery();
      if (!alive.current) return;
      setStatus(s);
      setError('');
    } catch (e) {
      if (alive.current) setError(errorText(e, t('common.genericError')));
    }
  }, [setStatus, t]);

  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
      stops.current.forEach((s) => s());
    };
  }, [load]);

  useEffect(() => {
    if (!moteCanvas.current) return;
    field.current = motes(moteCanvas.current, reducedMotion());
    return () => field.current?.stop();
  }, []);

  /** The chest mouth's centre in stage and mote-canvas coordinates. */
  function mouthPoint() {
    const box = stage.current?.getBoundingClientRect();
    const m = mouth.current?.getBoundingClientRect();
    if (!box || !m) return null;
    const x = m.left + m.width / 2 - box.left;
    const y = m.top + m.height / 2 - box.top;
    // The mote canvas overhangs the stage by 24px on each side.
    return { x, y, mx: x + 24, my: y + 24 };
  }

  const s = status;
  // The relay decides whether it is on; the clock only says which side of the window we are.
  const win: ActivityPhase = !s || s.active ? 'running' : s.starts_at && Date.now() + skew < Date.parse(s.starts_at) ? 'upcoming' : 'ended';
  // Reload when the window opens or closes or the day turns: that changes what can be earned, bought and opened.
  useEffect(() => {
    if (!s?.enabled) return;
    const at = Date.now() + skew;
    // Today's low-spend chests lapse at midnight, and a new day resets the counts.
    const next = [s.starts_at, s.ends_at, s.daily?.expires_at ?? null].map((x) => (x ? Date.parse(x) - at : NaN)).filter((d) => d > 0);
    if (next.length === 0) return;
    const id = setTimeout(load, Math.min(...next, 2 ** 31 - 1) + 1000);
    return () => clearTimeout(id);
  }, [s, skew, load]);

  const busy = phase === 'charge' || phase === 'reveal' || phase === 'burst';
  const chest: ChestState = !s || s.chests > 0 ? 'ready' : win === 'running' ? 'locked' : 'empty';

  /** Opens `count` chests. One plays the full reveal; a batch plays the best one's burst, then lists them all. */
  async function open(count = 1) {
    if (busy || phase === 'result' || !s) return;
    if (chest !== 'ready' || !s.enabled) {
      setNudge((n) => n + 1);
      return;
    }
    setError('');
    setDraw(null);
    setBatch(null);
    const quick = reducedMotion();
    if (!quick) {
      setPhase('charge');
      const p = mouthPoint();
      if (p) field.current?.set({ mode: 'gather', cx: p.mx, cy: p.my, color: '255,236,200' });
    }
    let res: Awaited<ReturnType<typeof api.lotteryOpen>>;
    try {
      [res] = await Promise.all([api.lotteryOpen(count), quick ? null : wait(CHARGE_MS)]);
    } catch (e) {
      if (!alive.current) return;
      field.current?.set({ mode: 'drift', color: IDLE_MOTE });
      setPhase('idle');
      setError(errorText(e, t('common.genericError')));
      load();
      return;
    }
    if (!alive.current) return;
    // Relays without batch open send only `draw`.
    const all = res.draws?.length ? res.draws : [res.draw];
    const won = count > 1 ? byRarity(all)[0] : res.draw;
    setDraw(won);
    if (count > 1) {
      if (!quick) {
        setPhase('burst');
        await wait(140);
        if (!alive.current) return;
        fire(won);
        await wait(OPEN_MS);
        if (!alive.current) return;
      }
      setStatus(res.status);
      setBatch(all);
      setPhase('result');
      onBalance();
      return;
    }
    if (quick) {
      setStatus(res.status);
      setPhase('result');
      onBalance();
      return;
    }
    // Light leaks from the seam in each rarity's colour, stopping at the one won.
    const ladder = revealLadder(won.rarity);
    setPhase('reveal');
    for (let i = 0; i < ladder.length; i++) {
      setStep(i);
      field.current?.set({ color: MOTE[ladder[i]] });
      await wait(i === ladder.length - 1 ? STEP_MS + 340 : STEP_MS);
      if (!alive.current) return;
    }
    setPhase('burst');
    // Let the lid start to swing before the light comes out.
    await wait(140);
    if (!alive.current) return;
    fire(won);
    await wait(OPEN_MS);
    if (!alive.current) return;
    setStatus(res.status);
    setPhase('result');
    onBalance();
  }

  function fire(d: Draw) {
    const p = mouthPoint();
    if (!p) return;
    const r = d.rarity;
    field.current?.set({ mode: 'scatter', cx: p.mx, cy: p.my, color: d.kind === 'none' ? '210,214,222' : MOTE[r] });
    if (sparks.current) {
      if (d.kind === 'none') {
        stops.current.push(burst(sparks.current, { x: p.x, y: p.y, colors: ['#c9ced6', '#9aa3ad', '#e5e7eb'], count: 34, power: 3.2 }));
        return;
      }
      const big = r === 'legendary' ? 2.1 : r === 'epic' ? 1.6 : r === 'rare' ? 1.2 : 0.9;
      stops.current.push(burst(sparks.current, { x: p.x, y: p.y, colors: SPARKS[r], count: Math.round(90 * big), power: 7 * big }));
    }
    if (r === 'epic') {
      if (bolts.current) stops.current.push(lightning(bolts.current, { x: p.x, y: p.y, colors: ['#e9d5ff', '#b06cff', '#f0abfc', '#a5b4fc'], ms: 1150 }));
      if (rain.current) stops.current.push(confetti(rain.current, { colors: SPARKS.epic, ms: 1400 }));
    }
    if (r === 'legendary') {
      setFlash(true);
      setTimeout(() => alive.current && setFlash(false), 1200);
      if (coins.current) stops.current.push(coinRain(coins.current, 4400));
      if (rain.current) stops.current.push(confetti(rain.current, { colors: [...SPARKS.legendary, '#ff8d5c', '#ffafcb', '#94b1ff'], ms: 3600 }));
    }
  }

  function collect() {
    setBatch(null);
    setPhase('idle');
    field.current?.set({ mode: 'drift', color: IDLE_MOTE });
  }

  function onMove(e: PointerEvent<HTMLElement>) {
    const el = stage.current;
    if (!el || reducedMotion()) return;
    const r = el.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width - 0.5) * 2;
    const py = ((e.clientY - r.top) / r.height - 0.5) * 2;
    cancelAnimationFrame(parallax.current);
    parallax.current = requestAnimationFrame(() => {
      el.style.setProperty('--px', px.toFixed(3));
      el.style.setProperty('--py', py.toFixed(3));
    });
  }
  function onLeave() {
    cancelAnimationFrame(parallax.current);
    stage.current?.style.setProperty('--px', '0');
    stage.current?.style.setProperty('--py', '0');
  }

  const earn = s ? earnProgress(s.earn) : null;
  const ratio = earn && win === 'running' ? earn.ratio : 0;
  const shown: Rarity | null =
    phase === 'reveal' && draw ? revealLadder(draw.rarity)[step] : (phase === 'burst' || phase === 'result') && draw ? draw.rarity : null;
  const glow = shown ? (draw?.kind === 'none' && phase !== 'reveal' ? '#c9ced6' : GLOW[shown]) : phase === 'charge' ? CHARGE_GLOW : IDLE_GLOW;
  const label = chest === 'ready' ? t('lottery.open') : t('lottery.noChests');
  const canOpen = !!s && s.enabled && s.chests > 0 && phase === 'idle';
  const many = s ? batchSize(s.chests) : null;
  const cap = s?.hold_cap ?? 0;

  return (
    <div className="main-scroll">
      <div className="main-column">
        <section className="card lot-head rise" style={{ '--i': 0 } as CSSProperties}>
          <div className="lot-head-text">
            <h1>
              {t('lottery.myChests', { n: s ? s.chests : '—' })}
              {cap > 0 && <em className={s?.full ? 'full' : ''}>{t('lottery.held', { n: s?.chests ?? 0, cap })}</em>}
            </h1>
            {s && <ActivityLine status={s} phase={win} skew={skew} />}
            {s?.full && <p className="lot-full">{t('lottery.full')}</p>}
          </div>
          <div className="lot-open">
            <button className="btn btn-primary" disabled={!canOpen} onClick={() => open(1)}>
              <Icon name="gift" className="size-4" />
              {t('lottery.openN', { n: 1 })}
            </button>
            {many !== null && (
              <button className="btn btn-quiet" disabled={!canOpen} onClick={() => open(many)}>
                {t('lottery.openN', { n: many })}
              </button>
            )}
          </div>
        </section>

        {error && <div className="usage-error rise">{error}</div>}

        <section
          ref={stage}
          className={`lot-stage rise phase-${phase} ${shown ? `r-${shown}` : ''} ${draw?.kind === 'none' ? 'k-none' : ''} chest-${chest}`}
          style={{ '--i': 0, '--glow': glow } as CSSProperties}
          onPointerMove={onMove}
          onPointerLeave={onLeave}
        >
          <div className="lot-aurora" aria-hidden />
          <canvas ref={moteCanvas} className="lot-motes" aria-hidden />

          <div className="lot-cam">
            <div className="lot-center">
              <div className="lot-halo" aria-hidden />
              {(phase === 'burst' || phase === 'result') && (shown === 'epic' || shown === 'legendary') && draw?.kind !== 'none' && (
                <div className="lot-rays" aria-hidden />
              )}
              {phase === 'burst' && shown === 'legendary' && <div className="lot-shock" aria-hidden />}
              {phase === 'burst' && <div className="lot-ring" aria-hidden />}
              {phase === 'reveal' && <div key={step} className="lot-pulse" aria-hidden />}
              <Ring ratio={ratio} />
              <Chest
                state={chest}
                phase={phase}
                step={step}
                nudge={nudge}
                label={label}
                interactive={phase === 'idle' && chest === 'ready' && !!s}
                mouthRef={mouth}
                onOpen={() => open(1)}
              />
            </div>
          </div>

          {phase === 'result' && draw && !batch && <ResultCard draw={draw} onDone={collect} />}

          <div className="lot-foot">
            <div className="lot-meter">
              <span>{t('lottery.todayCost')}</span>
              <b>
                {s ? dollars(s.earn.today_spend) : '—'}
                {s && win === 'running' && earn && !earn.capped && <em> · {t('lottery.toNext', { amount: dollars(earn.toNext) })}</em>}
              </b>
            </div>
            <div className="lot-meter right">
              <span>{t('lottery.chests')}</span>
              <b>{s ? s.chests : '—'}</b>
            </div>
          </div>

          <canvas ref={coins} className="lot-sparks" aria-hidden />
          <canvas ref={bolts} className="lot-sparks" aria-hidden />
          <canvas ref={sparks} className="lot-sparks" aria-hidden />
        </section>

        {s && (
          <div className="lot-ways">
            {s.daily && <DailyCard status={s} phase={win} skew={skew} index={1} />}
            <EarnCard status={s} phase={win} index={2} />
            <BuyCard
              status={s}
              phase={win}
              balance={balance}
              index={3}
              onBought={(next) => {
                setStatus(next);
                onBalance();
              }}
            />
          </div>
        )}

        {s && s.perks.length > 0 && (
          <div className="lot-perks">
            {s.perks.map((p, i) => (
              <PerkCard key={p.id} perk={p} index={i + 1} />
            ))}
          </div>
        )}

        <div className="lot-cols">
          <section className="card usage-card rise" style={{ '--i': 2 } as CSSProperties}>
            <div className="usage-card-head">
              <h2>{t('lottery.pool')}</h2>
            </div>
            <div className="lot-pool">
              {[...(s?.prizes ?? [])]
                .sort((a, b) => RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity))
                .map((p) => (
                  <span key={p.id} className={`lot-chip r-${p.rarity}`}>
                    <i />
                    {p.name}
                  </span>
                ))}
            </div>
          </section>

          <section className="card usage-card rise" style={{ '--i': 3 } as CSSProperties}>
            <div className="usage-card-head">
              <h2>{t('lottery.today')}</h2>
            </div>
            {s && s.today.length === 0 ? (
              <p className="usage-empty">{t('lottery.noneToday')}</p>
            ) : (
              <div className="lot-results">
                {[...(s?.today ?? [])].reverse().map((d) => (
                  <div key={d.id} className={`lot-result r-${d.rarity}`}>
                    <i />
                    <span className="truncate">{d.name}</span>
                    <SourceTag source={d.source} />
                    <b>
                      <PrizeText draw={d} />
                    </b>
                    <time>{new Date(d.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {batch && <BatchSheet draws={batch} onClose={collect} />}
      {flash && <div className="lot-flash" aria-hidden />}
      <canvas ref={rain} className="lot-rain" aria-hidden />
    </div>
  );
}

/** Today's spend toward the next earned chest, drawn round the chest. */
function Ring({ ratio }: { ratio: number }) {
  const r = 150;
  const c = 2 * Math.PI * r;
  return (
    <svg className={`lot-progress ${ratio >= 1 ? 'full' : ''}`} viewBox="0 0 320 320" aria-hidden>
      <circle cx="160" cy="160" r={r} className="track" />
      <circle cx="160" cy="160" r={r} className="fill" strokeDasharray={`${c * ratio} ${c}`} transform="rotate(-90 160 160)" />
    </svg>
  );
}

/**
 * The chest is the button. Lid, body and padlock are separate layers so the
 * lid can swing open in 3D while light pours out of the mouth behind it.
 */
function Chest({
  state,
  phase,
  step,
  nudge,
  label,
  interactive,
  mouthRef,
  onOpen,
}: {
  state: ChestState;
  phase: Phase;
  step: number;
  nudge: number;
  label: string;
  interactive: boolean;
  mouthRef: RefObject<HTMLSpanElement | null>;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={`chest ${state} ${interactive ? 'interactive' : ''}`}
      aria-label={label}
      aria-disabled={!interactive || undefined}
      onClick={onOpen}
    >
      <span key={nudge} className={`chest-rig ${nudge ? 'nudge' : ''}`}>
        <span className="chest-shadow" />
        <span className="chest-beam" />
        <span className="chest-lid-inner">
          <ChestLidInside />
        </span>
        <ChestBody />
        <ChestOpening />
        <span ref={mouthRef} className="chest-mouth" />
        <span className="chest-lid">
          <span key={phase === 'reveal' ? step : 'still'} className="chest-knock">
            <ChestLid />
          </span>
        </span>
        <span className="chest-seam" />
        <span key={phase === 'reveal' ? `f${step}` : 'f'} className="chest-flare" />
        {state === 'locked' && <Padlock />}
        <span className="chest-glint" />
      </span>
    </button>
  );
}

/** Shared paints for the chest layers. */
function ChestPaints() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden>
      <defs>
        <linearGradient id="cb-lac-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b9343b" />
          <stop offset="0.55" stopColor="#8a1d2b" />
          <stop offset="1" stopColor="#5c0f1e" />
        </linearGradient>
        <linearGradient id="cb-lac-lid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e65a52" />
          <stop offset="0.5" stopColor="#b52f3b" />
          <stop offset="1" stopColor="#861d2c" />
        </linearGradient>
        <linearGradient id="cb-side" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0.38" />
          <stop offset="0.16" stopColor="#000" stopOpacity="0" />
          <stop offset="0.84" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.38" />
        </linearGradient>
        <linearGradient id="cb-shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0.45" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="cb-gold-v" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#7a4a0c" />
          <stop offset="0.28" stopColor="#e6b04a" />
          <stop offset="0.48" stopColor="#fff2c2" />
          <stop offset="0.7" stopColor="#d99b2b" />
          <stop offset="1" stopColor="#6e420a" />
        </linearGradient>
        <linearGradient id="cb-gold-h" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff3c4" />
          <stop offset="0.35" stopColor="#f1c55a" />
          <stop offset="0.8" stopColor="#b17a1c" />
          <stop offset="1" stopColor="#7a4a0c" />
        </linearGradient>
        <linearGradient id="cb-plate" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff1bd" />
          <stop offset="0.4" stopColor="#efbf55" />
          <stop offset="1" stopColor="#9c6514" />
        </linearGradient>
        <radialGradient id="cb-rivet" cx="0.35" cy="0.3" r="0.75">
          <stop offset="0" stopColor="#fffbe6" />
          <stop offset="0.45" stopColor="#e6b04a" />
          <stop offset="1" stopColor="#6e420a" />
        </radialGradient>
        <radialGradient id="cb-gem" cx="0.36" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#ffe1e6" />
          <stop offset="0.35" stopColor="#ef4a6a" />
          <stop offset="1" stopColor="#5e0820" />
        </radialGradient>
        <linearGradient id="cb-steel" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f4f6f9" />
          <stop offset="0.5" stopColor="#aab2bd" />
          <stop offset="1" stopColor="#5d6672" />
        </linearGradient>
      </defs>
    </svg>
  );
}

const rivet = (x: number, y: number, r = 2.6) => <circle key={`${x},${y}`} cx={x} cy={y} r={r} fill="url(#cb-rivet)" />;

function ChestLid() {
  return (
    <svg className="chest-lid-art" viewBox="0 0 220 112" aria-hidden>
      <path d="M16 90V50C16 22 60 8 110 8s94 14 94 42v40z" fill="url(#cb-lac-lid)" />
      <path d="M16 90V50C16 22 60 8 110 8s94 14 94 42v40z" fill="url(#cb-side)" />
      {/* Lacquer grain, then the bevel catching the light. */}
      <path d="M22 72c48-7 120-6 176-12M20 60c56-8 122-6 180-15M30 42c40-12 110-14 160-4" stroke="#000" strokeOpacity="0.13" strokeWidth="1.2" fill="none" />
      <ellipse cx="82" cy="24" rx="50" ry="8" fill="#fff" opacity="0.16" transform="rotate(-7 82 24)" />
      <path d="M28 47C33 27 68 15 110 15s77 12 82 32" stroke="#fff" strokeOpacity="0.42" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <path d="M40 90V33c4-6 9-10 16-13v70zM180 90V33c-4-6-9-10-16-13v70z" fill="url(#cb-gold-v)" />
      {[rivet(48, 38), rivet(48, 60), rivet(172, 38), rivet(172, 60)]}
      <rect x="10" y="76" width="200" height="16" rx="5" fill="url(#cb-gold-h)" />
      <rect x="14" y="78" width="192" height="2" rx="1" fill="#fff" opacity="0.55" />
      {[rivet(22, 84), rivet(198, 84), rivet(80, 84, 2.2), rivet(140, 84, 2.2)]}
      {/* The hasp that drops over the lock plate. */}
      <path d="M99 78h22v20c0 7-5 11-11 11s-11-4-11-11z" fill="url(#cb-gold-v)" stroke="#6e420a" strokeOpacity="0.55" />
      <circle cx="110" cy="99" r="3" fill="#4a2a06" />
    </svg>
  );
}

/** The lid's lining, seen standing up behind the open chest. */
function ChestLidInside() {
  return (
    <svg className="chest-lid-inside-art" viewBox="0 0 200 92" aria-hidden>
      <defs>
        <linearGradient id="cb-lining" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a0c17" />
          <stop offset="1" stopColor="#6d1726" />
        </linearGradient>
      </defs>
      <path d="M8 90V40C8 18 50 4 100 4s92 14 92 36v50z" fill="url(#cb-gold-h)" />
      <path d="M16 90V42c0-17 37-29 84-29s84 12 84 29v48z" fill="url(#cb-lining)" />
      <path d="M24 86V44c4-13 36-22 76-22s72 9 76 22v42" fill="none" stroke="#000" strokeOpacity="0.25" strokeWidth="1.2" />
      <path d="M36 28c18-6 40-9 64-9" stroke="#fff" strokeOpacity="0.18" strokeWidth="2" strokeLinecap="round" fill="none" />
      <rect className="chest-lining-light" x="16" y="13" width="168" height="77" />
    </svg>
  );
}

/** The open top of the chest: dark inside, a gold lip at the front. */
function ChestOpening() {
  return (
    <svg className="chest-opening" viewBox="0 0 220 24" aria-hidden>
      <defs>
        <linearGradient id="cb-inside" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#12040a" />
          <stop offset="1" stopColor="#3b0d18" />
        </linearGradient>
      </defs>
      <path d="M26 4h168l12 16H14z" fill="url(#cb-inside)" />
      <path d="M14 20h192v4H14z" fill="url(#cb-gold-h)" />
    </svg>
  );
}

function ChestBody() {
  return (
    <svg className="chest-body" viewBox="0 0 220 114" aria-hidden>
      <ChestPaints />
      <rect x="14" y="0" width="192" height="100" rx="8" fill="url(#cb-lac-body)" />
      <rect x="14" y="0" width="192" height="100" rx="8" fill="url(#cb-side)" />
      <rect x="14" y="0" width="192" height="16" fill="url(#cb-shade)" />
      <path d="M18 30c50-5 130-3 184-8M18 58c60-6 120-2 184-7M18 82c48-4 136-2 184-6" stroke="#000" strokeOpacity="0.14" strokeWidth="1.2" fill="none" />
      <path d="M18 44c50-3 130-1 184-5" stroke="#fff" strokeOpacity="0.05" strokeWidth="1" fill="none" />
      <rect x="40" y="0" width="16" height="100" fill="url(#cb-gold-v)" />
      <rect x="164" y="0" width="16" height="100" fill="url(#cb-gold-v)" />
      {[24, 52, 80].flatMap((y) => [rivet(48, y), rivet(172, y)])}
      {/* Lock plate with a jewel and a keyhole. */}
      <path d="M86 12h48v32c0 15-11 23-24 28-13-5-24-13-24-28z" fill="url(#cb-plate)" stroke="#6e420a" strokeOpacity="0.6" />
      <path d="M90.5 16.5h39V44c0 11.5-8.4 18.3-19.5 22.6C98.9 62.3 90.5 55.5 90.5 44z" fill="none" stroke="#fff" strokeOpacity="0.45" />
      <circle cx="110" cy="31" r="8.5" fill="#5a3208" opacity="0.5" />
      <circle cx="110" cy="30" r="8" fill="url(#cb-gem)" />
      <circle className="chest-jewel-glow" cx="110" cy="30" r="8" />
      <ellipse cx="107" cy="27" rx="3" ry="2" fill="#fff" opacity="0.75" />
      <circle cx="110" cy="49" r="3.2" fill="#3a1d06" />
      <path d="M108.3 50.5 107.5 58h5l-.8-7.5z" fill="#3a1d06" />
      <rect x="8" y="92" width="204" height="16" rx="5" fill="url(#cb-gold-h)" />
      <rect x="12" y="94" width="196" height="2" rx="1" fill="#fff" opacity="0.5" />
      {[rivet(20, 100), rivet(200, 100)]}
      <rect x="16" y="106" width="22" height="7" rx="2.5" fill="#8a5a12" />
      <rect x="182" y="106" width="22" height="7" rx="2.5" fill="#8a5a12" />
    </svg>
  );
}

function Padlock() {
  return (
    <svg className="chest-padlock" viewBox="0 0 40 50" aria-hidden>
      <path d="M12 23v-8a8 8 0 0 1 16 0v8" fill="none" stroke="url(#cb-steel)" strokeWidth="4.2" strokeLinecap="round" />
      <rect x="5" y="21" width="30" height="24" rx="6" fill="url(#cb-steel)" />
      <rect x="7" y="23" width="26" height="2" rx="1" fill="#fff" opacity="0.6" />
      <circle cx="20" cy="31.5" r="3.2" fill="#2b3038" />
      <path d="M18.6 33 18 39.5h4l-.6-6.5z" fill="#2b3038" />
    </svg>
  );
}

function ResultCard({ draw, onDone }: { draw: Draw; onDone: () => void }) {
  const { t } = useI18n();
  const h = headline(draw);
  return (
    <div className={`lot-card r-${draw.rarity} ${draw.kind === 'none' ? 'k-none' : ''}`} role="dialog" aria-label={draw.name}>
      <div className="lot-card-inner">
        {draw.kind !== 'none' && <RarityTag rarity={draw.rarity} />}
        {h.kind === 'none' ? (
          <div className="lot-amount words">{draw.name || t('lottery.thanks')}</div>
        ) : h.kind === 'again' ? (
          <>
            <h3>{draw.name}</h3>
            <div className="lot-amount words">{t('lottery.again')}</div>
          </>
        ) : (
          <>
            <h3>{draw.name}</h3>
            <Headline draw={draw} />
          </>
        )}
        <button className="lot-card-ok" autoFocus onClick={onDone}>
          {draw.kind === 'none' ? t('common.close') : t('lottery.collect')}
        </button>
      </div>
    </div>
  );
}

/** The won value, its digits rolling into place like a slot machine. */
function Headline({ draw }: { draw: Draw }) {
  const { t } = useI18n();
  const h = headline(draw);
  if (h.kind === 'money') return <div className="lot-amount"><Slot text={dollars(h.value)} slow={draw.rarity === 'legendary'} /></div>;
  if (h.kind === 'credit')
    return (
      <div className="lot-amount">
        <Slot text={dollars(h.value)} />
        <small> · {t('lottery.hours', { n: h.hours })}</small>
      </div>
    );
  if (h.kind === 'discount')
    return (
      <div className="lot-amount">
        <Slot text={t('lottery.zhe', zheVars(h.zhe))} />
        <small> · {t('lottery.hours', { n: h.hours })}</small>
      </div>
    );
  return null;
}

function Slot({ text, slow }: { text: string; slow?: boolean }) {
  const [spun, setSpun] = useState(() => reducedMotion());
  useEffect(() => {
    if (spun) return;
    // Two frames so the reels mount at 0 before rolling.
    let id = requestAnimationFrame(() => (id = requestAnimationFrame(() => setSpun(true))));
    return () => cancelAnimationFrame(id);
  }, [spun]);
  const chars = [...text];
  const digits = chars.filter((c) => /\d/.test(c)).length;
  let n = 0;
  return (
    <span className="slot" aria-label={text}>
      {chars.map((c, i) => {
        // Flex drops plain spaces, so they are kept as no-break spaces.
        if (!/\d/.test(c)) return <span key={i} className="slot-fixed" aria-hidden>{c === ' ' ? '\u00a0' : c}</span>;
        const order = n++;
        // Later digits spin longer, so the number settles left to right.
        const ms = (slow ? 1500 : 950) + (order / Math.max(1, digits - 1)) * (slow ? 900 : 550);
        const turns = 1 + Math.min(2, order);
        return (
          <span key={i} className="slot-cell" aria-hidden>
            <span
              className="slot-reel"
              style={{
                transform: spun ? `translateY(-${(turns * 10 + Number(c)) * 1.1}em)` : 'translateY(0)',
                transitionDuration: `${ms}ms`,
                // Rolls once the card has risen into place.
                transitionDelay: '520ms',
              }}
            >
              {Array.from({ length: 40 }, (_, k) => (
                <span key={k}>{k % 10}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function PerkCard({ perk, index }: { perk: Perk; index: number }) {
  const { t } = useI18n();
  const now = useNow();
  const left = countdown(new Date(perk.expires_at).getTime() - now);
  const clock = left.days > 0 ? t('lottery.daysClock', { d: left.days, clock: left.clock }) : left.clock;
  const discount = perk.kind === 'discount';
  const used = discount ? (perk.refunded ?? 0) : (perk.left ?? 0);
  const cap = discount ? (perk.cap ?? 0) : (perk.amount ?? 0);
  return (
    <div className={`card lot-perk rise ${perk.kind}`} style={{ '--i': index } as CSSProperties}>
      <div className="lot-perk-head">
        <span>{discount ? t('lottery.perk.discount') : t('lottery.perk.credit')}</span>
        <time>{clock}</time>
      </div>
      <b className="lot-perk-big">{discount ? t('lottery.zhe', zheVars(zhe(perk.rate ?? 0))) : dollars(perk.amount ?? 0)}</b>
      <div className="lot-perk-meter">
        <div className="key-meter">
          <i style={{ width: `${cap > 0 ? Math.min(100, (used / cap) * 100) : 0}%` }} />
        </div>
        <span>
          {discount ? t('lottery.perk.refunded') : t('lottery.perk.left')} {dollars(used)} / {dollars(cap)}
        </span>
      </div>
    </div>
  );
}

/** 活动时间 10/1 00:00 – 10/7 24:00 and a countdown to the start or the end. */
function ActivityLine({ status: s, phase, skew }: { status: LotteryStatus; phase: ActivityPhase; skew: number }) {
  const { t } = useI18n();
  const now = useNow() + skew;
  const start = s.starts_at ? shanghaiShort(s.starts_at) : null;
  const end = s.ends_at ? shanghaiShort(s.ends_at) : null;
  const range = !start && !end ? t('lottery.forever') : `${start ?? t('lottery.fromNow')} – ${end ?? t('lottery.forever')}`;
  const target = phase === 'upcoming' && s.starts_at ? s.starts_at : phase === 'running' && s.ends_at ? s.ends_at : null;
  let clock = '';
  if (target) {
    const left = countdown(Date.parse(target) - now);
    clock = left.days > 0 ? t('lottery.daysClock', { d: left.days, clock: left.clock }) : left.clock;
  }
  return (
    <p className="lot-window">
      <span>
        {t('lottery.window')} {range}
      </span>
      {phase === 'upcoming' && <em>{t('lottery.startsIn', { clock })}</em>}
      {phase === 'running' && target && <em>{t('lottery.endsIn', { clock })}</em>}
      {phase === 'ended' && <em className="off">{t('lottery.ended')}</em>}
    </p>
  );
}

/** What a section shows instead of its controls outside the activity window. */
const closedText = (phase: ActivityPhase, t: T) => (phase === 'upcoming' ? t('lottery.notStarted') : t('lottery.ended'));

function EarnCard({ status: s, phase, index }: { status: LotteryStatus; phase: ActivityPhase; index: number }) {
  const { t } = useI18n();
  const e = s.earn;
  const p = earnProgress(e);
  const quota = quotaLeft(e.left_today);
  return (
    <section className="card usage-card lot-way rise" style={{ '--i': index } as CSSProperties}>
      <div className="usage-card-head">
        <h2>{t('lottery.earnTitle')}</h2>
      </div>
      {phase !== 'running' ? (
        <p className="usage-empty">{closedText(phase, t)}</p>
      ) : (
        <>
          <p className="lot-way-line">
            {t('lottery.earnLine', { spent: dollars(e.today_spend), per: dollars(e.spend_per_chest) })}
          </p>
          <div className="key-meter lot-way-meter">
            <i style={{ width: `${Math.round(p.ratio * 100)}%` }} />
          </div>
          <div className="lot-way-foot">
            <span>
              {quota === 'out' ? t('lottery.earnSoldOut') : p.capped ? t('lottery.earnCapped') : t('lottery.toNextLong', { amount: dollars(p.toNext) })}
            </span>
            <b>
              {t('lottery.earnedToday', { n: e.earned_today })}
              {e.daily_cap > 0 && <em> / {e.daily_cap}</em>}
            </b>
          </div>
          {quota !== null && (
            <p className={`lot-quota ${quota === 'out' ? 'out' : ''}`}>
              {quota === 'out' ? t('lottery.earnQuotaOut') : t('lottery.earnQuotaLeft', { n: quota })}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function BuyCard({
  status: s,
  phase,
  balance,
  index,
  onBought,
}: {
  status: LotteryStatus;
  phase: ActivityPhase;
  balance: number;
  index: number;
  onBought: (s: LotteryStatus) => void;
}) {
  const { t } = useI18n();
  const b = s.buy;
  const [count, setCount] = useState(1);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const max = Math.max(1, b.left_today);
  const n = Math.min(Math.max(1, count), max);
  const total = Math.round(b.price * n * 100) / 100;
  const sold = quotaLeft(b.sold_left);
  const short = balance < b.price;
  const over = total > balance + 1e-9;
  const can = b.enabled && b.left_today > 0 && !short;

  async function buy() {
    setBusy(true);
    setError('');
    try {
      const r = await api.lotteryBuy(n);
      setAsking(false);
      setCount(1);
      setDone(t('lottery.bought', { n: r.bought }));
      onBought(r.status);
    } catch (e) {
      setError(errorText(e, t('common.genericError')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card usage-card lot-way rise" style={{ '--i': index } as CSSProperties}>
      <div className="usage-card-head">
        <h2>{t('lottery.buyTitle')}</h2>
        {phase === 'running' && b.enabled && <span className="lot-price">{t('lottery.price', { price: dollars(b.price) })}</span>}
      </div>
      {phase !== 'running' ? (
        <p className="usage-empty">{closedText(phase, t)}</p>
      ) : !b.enabled ? (
        <p className="usage-empty">{t('lottery.buyOff')}</p>
      ) : (
        <>
          <div className="lot-buy">
            <div className="stepper" aria-label={t('lottery.count')}>
              <button aria-label="−" disabled={!can || n <= 1} onClick={() => setCount(n - 1)}>
                <Icon name="minus" className="size-3.5" />
              </button>
              <b>{n}</b>
              <button aria-label="+" disabled={!can || n >= max} onClick={() => setCount(n + 1)}>
                <Icon name="plus" className="size-3.5" />
              </button>
            </div>
            <button
              className="btn btn-primary"
              disabled={!can || over}
              onClick={() => {
                setDone('');
                setError('');
                setAsking(true);
              }}
            >
              {t('lottery.buy')} · {dollars(total)}
            </button>
          </div>
          <div className="lot-way-foot">
            <span className={short || over ? 'warn' : ''}>
              {sold === 'out'
                ? t('lottery.soldOut')
                : s.full
                  ? t('lottery.full')
                  : b.left_today === 0
                    ? t('lottery.buyLimit')
                    : short || over
                      ? t('lottery.buyShort')
                      : done || t('lottery.balance', { amount: dollars(balance) })}
            </span>
            <b>{t('lottery.leftToday', { n: b.left_today })}</b>
          </div>
          {sold !== null && (
            <p className={`lot-quota ${sold === 'out' ? 'out' : ''}`}>
              {sold === 'out' ? t('lottery.soldOut') : t('lottery.soldLeft', { n: sold })}
            </p>
          )}
          {error && !asking && <p className="form-error">{error}</p>}
        </>
      )}
      {asking && (
        <Dialog
          title={t('lottery.buyTitle')}
          onClose={() => !busy && setAsking(false)}
          footer={
            <>
              {error && <p className="mr-auto text-[13px] text-[var(--danger)]">{error}</p>}
              <button className="btn btn-quiet" disabled={busy} onClick={() => setAsking(false)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary" disabled={busy} onClick={buy}>
                {busy ? t('common.wait') : t('lottery.buyConfirm', { amount: dollars(total) })}
              </button>
            </>
          }
        >
          <p className="confirm-text">
            {t('lottery.buyAsk', { n, price: dollars(b.price), amount: dollars(total), balance: dollars(Math.max(0, balance - total)) })}
          </p>
        </Dialog>
      )}
    </section>
  );
}

/** Everything a batch open gave: best first, big wins lit up, and the balance it added. */
function BatchSheet({ draws, onClose }: { draws: Draw[]; onClose: () => void }) {
  const { t } = useI18n();
  const list = byRarity(draws);
  const gained = balanceGained(draws);
  const big = draws.filter((d) => d.kind !== 'none' && (d.rarity === 'epic' || d.rarity === 'legendary')).length;
  return (
    <Dialog
      title={t('lottery.batchTitle', { n: draws.length })}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" autoFocus onClick={onClose}>
          {t('lottery.collect')}
        </button>
      }
    >
      <div className="batch-total">
        <span>{t('lottery.batchGained')}</span>
        <b>{dollars(gained)}</b>
        {big > 0 && <em>{t('lottery.batchBig', { n: big })}</em>}
      </div>
      <div className="batch-list">
        {list.map((d, i) => {
          const hot = d.kind !== 'none' && (d.rarity === 'epic' || d.rarity === 'legendary');
          return (
            <div
              key={d.id}
              className={`batch-row r-${d.rarity} ${hot ? 'hot' : ''} ${d.kind === 'none' ? 'k-none' : ''}`}
              style={{ '--i': i } as CSSProperties}
            >
              <i />
              {d.kind !== 'none' ? <RarityTag rarity={d.rarity} /> : <span />}
              <span className="truncate">{d.name}</span>
              <SourceTag source={d.source} />
              <b>
                <PrizeText draw={d} />
              </b>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}

/** The low-spend chest: a small spend gets one, the site has a few a day, and it lapses at midnight. */
function DailyCard({ status: s, phase, skew, index }: { status: LotteryStatus; phase: ActivityPhase; skew: number; index: number }) {
  const { t } = useI18n();
  const d = s.daily!;
  const st = dailyState(d, s.earn.today_spend);
  const quota = quotaLeft(d.left_today);
  return (
    <section className="card usage-card lot-way lot-daily rise" style={{ '--i': index } as CSSProperties}>
      <div className="usage-card-head">
        <h2>{t('lottery.dailyTitle')}</h2>
        {phase === 'running' && d.enabled && (
          <span className={`lot-quota-tag ${quota === 'out' ? 'out' : ''}`}>
            {quota === 'out' ? t('lottery.dailySoldOut') : quota !== null ? t('lottery.dailyLeft', { n: quota }) : null}
          </span>
        )}
      </div>
      {phase !== 'running' ? (
        <p className="usage-empty">{closedText(phase, t)}</p>
      ) : st.kind === 'off' ? (
        <p className="usage-empty">{t('lottery.dailyOff')}</p>
      ) : (
        <>
          <p className="lot-way-line">
            {t('lottery.dailyLine', { amount: dollars(d.threshold), n: d.per_user })}
          </p>
          <div className="key-meter lot-way-meter">
            <i style={{ width: `${st.kind === 'progress' ? Math.round(st.ratio * 100) : st.kind === 'done' ? 100 : 0}%` }} />
          </div>
          <div className="lot-way-foot">
            <span className={st.kind === 'soldOut' ? 'warn' : ''}>
              {st.kind === 'progress'
                ? t('lottery.toNextLong', { amount: dollars(st.toNext) })
                : st.kind === 'done'
                  ? t('lottery.dailyGot')
                  : t('lottery.dailySoldOut')}
            </span>
            <b>
              {t('lottery.earnedToday', { n: d.mine_today })}
              <em> / {d.per_user}</em>
            </b>
          </div>
        </>
      )}
      {d.unopened > 0 && <DailyExpiry n={d.unopened} at={d.expires_at} skew={skew} />}
    </section>
  );
}

/** "1 个低消宝箱待开启 · 当天有效，24:00 过期 · 03:12:45". */
function DailyExpiry({ n, at, skew }: { n: number; at: string; skew: number }) {
  const { t } = useI18n();
  const now = useNow() + skew;
  const left = countdown(Date.parse(at) - now);
  return (
    <p className="lot-expiry">
      <Icon name="alert" className="size-3.5" />
      <span>{t('lottery.dailyUnopened', { n })}</span>
      <time>{left.clock}</time>
    </p>
  );
}

/** Where a chest came from: spending, buying, or another chest. */
function SourceTag({ source }: { source?: ChestSource }) {
  const { t } = useI18n();
  if (!source) return <span />;
  return <em className={`lot-source s-${source}`}>{t(`lottery.source.${source}`)}</em>;
}
