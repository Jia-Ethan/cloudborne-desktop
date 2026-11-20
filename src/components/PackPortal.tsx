import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import markPath from '../../brand/dist/mark-path.json';
import { errorText, type Draw, type LotteryStatus, type Rarity } from '../api';
import { useI18n } from '../i18n';
import { balanceGained, batchSize, dollars } from '../lottery';
import { lotterySfx, setLotterySoundOn, useLotterySoundOn } from '../lottery/lotterySound';
import { CONFETTI_COLORS, bestRarity, isMysteryDraw } from '../lottery/packThemes';
import { allSettled, clamp, createPose, rand, stepSprings, type Pose, type Spring } from '../lottery/spring';
import { arrangeBatchCards, computeCardLayout, getGlitterDataUrl, poly, type CardSlot } from '../lottery/tearGeometry';
import { FoilPack, type FoilPackHandle, type PackHandoff, type PackOpenResult } from './FoilPack';
import { Icon } from './Icon';
import { PrizeCard } from './PrizeCard';
import { createFxEngine, type FxEngine } from './fx';

const [MARK_X, MARK_Y, MARK_W, MARK_H] = markPath.viewBox;

interface PackPortalProps {
  initialHandoff: PackHandoff;
  status: LotteryStatus;
  onCommitOpen: (count: number) => Promise<PackOpenResult>;
  onResultAccepted: (status: LotteryStatus) => void;
  onClose: () => void;
}

type PortalMode = 'reveal' | 'next-pack';
type CardPhase = 'in' | 'shot' | 'orbit' | 'spread';

interface OpticalEls {
  holo: HTMLElement | null;
  holoRays: HTMLElement | null;
  glitter: HTMLElement | null;
  glare: HTMLElement | null;
  glazeBand: HTMLElement | null;
  backHolo: HTMLElement | null;
  backHoloRays: HTMLElement | null;
  backGlitter: HTMLElement | null;
  backGlare: HTMLElement | null;
  backGlazeBand: HTMLElement | null;
}

interface CardSim {
  draw: Draw;
  index: number;
  slotIndex: number;
  phase: CardPhase;
  from: number;
  landAt: number;
  x0: number;
  y0: number;
  vy: number;
  rz0: number;
  even: number;
  end: number;
  slot: CardSlot;
  hover: boolean;
  up: boolean;
  glad: boolean;
  kb: boolean;
  hx: number;
  hy: number;
  lastZ: number;
  lastNx: number;
  lastNy: number;
  settled: boolean;
  p: Pose<'x' | 'y' | 'z' | 'rx' | 'ry' | 'rz' | 's'>;
  springs: Spring[];
  opt: OpticalEls | null;
}

const ORBIT_SINGLE = 0.78;
const ORBIT_BATCH = 1.15;

const reducedMotion = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

const smoothstep = (a: number, b: number, x: number) => {
  const k = clamp((x - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};

function queryOpticalEls(root: HTMLElement): OpticalEls {
  const face = root.querySelector<HTMLElement>('.pk-face');
  const back = root.querySelector<HTMLElement>('.pk-back');
  return {
    holo: face?.querySelector<HTMLElement>('.pk-holo') ?? null,
    holoRays: face?.querySelector<HTMLElement>('.pk-holo-rays') ?? null,
    glitter: face?.querySelector<HTMLElement>('.pk-glitter') ?? null,
    glare: face?.querySelector<HTMLElement>('.pk-glare') ?? null,
    glazeBand: face?.querySelector<HTMLElement>('.pk-glaze-band') ?? null,
    backHolo: back?.querySelector<HTMLElement>('.pk-holo') ?? null,
    backHoloRays: back?.querySelector<HTMLElement>('.pk-holo-rays') ?? null,
    backGlitter: back?.querySelector<HTMLElement>('.pk-glitter') ?? null,
    backGlare: back?.querySelector<HTMLElement>('.pk-glare') ?? null,
    backGlazeBand: back?.querySelector<HTMLElement>('.pk-glaze-band') ?? null,
  };
}

/** Updates only GPU-composited transform & opacity on a card's optical leaf elements. */
function applyOptical(opt: OpticalEls, rarity: Rarity, isBack: boolean, nx: number, ny: number, hyp: number): void {
  const holo = isBack ? opt.backHolo : opt.holo;
  const holoRays = isBack ? opt.backHoloRays : opt.holoRays;
  const glitter = isBack ? opt.backGlitter : opt.glitter;
  const glare = isBack ? opt.backGlare : opt.glare;
  const glazeBand = isBack ? opt.backGlazeBand : opt.glazeBand;

  if (holo) {
    holo.style.transform = `translate3d(${(-nx * 12).toFixed(2)}%,${(-ny * 12).toFixed(2)}%,0)`;
    const baseOp =
      rarity === 'legendary' ? 0.44 : rarity === 'epic' ? 0.36 : rarity === 'common' ? 0.24 : 0.28;
    holo.style.opacity = (baseOp + hyp * 0.44).toFixed(2);
  }
  if (holoRays) {
    holoRays.style.transform = `rotate(${(nx * 24 + ny * 10).toFixed(1)}deg)`;
    holoRays.style.opacity = (0.34 + hyp * 0.4).toFixed(2);
  }
  if (glitter) {
    glitter.style.opacity = (0.28 + hyp * 0.54).toFixed(2);
  }
  if (glare) {
    glare.style.transform = `translate3d(${(nx * 20).toFixed(2)}%,${(-ny * 20).toFixed(2)}%,0)`;
    glare.style.opacity = (0.16 + hyp * 0.5).toFixed(2);
  }
  if (glazeBand) {
    glazeBand.style.transform = `translate3d(${(-nx * 18).toFixed(2)}%,0,0)`;
  }
}

/**
 * Full-viewport warm studio gallery overlay (`holo.yashb.xyz` aesthetic) that
 * catches the torn pack seamlessly at its exact pixel coordinates, erupts 3D
 * confetti on a single shared FX canvas, launches cards through an orbital
 * unwind into an interactive 3D fan/gallery, supports Option B mystery card
 * flipping, and sleeps its physics loop at 0% CPU/GPU when settled.
 */
export function PackPortal({ initialHandoff, status, onCommitOpen, onResultAccepted, onClose }: PackPortalProps) {
  const { t } = useI18n();
  const soundOn = useLotterySoundOn();

  const [portalMode, setPortalMode] = useState<PortalMode>('reveal');
  const [handoff, setHandoff] = useState<PackHandoff>(initialHandoff);
  const [nextPackCount, setNextPackCount] = useState<number>(initialHandoff.count);
  const [portalError, setPortalError] = useState('');

  // Ordered draws for the current reveal (highest rarity placed in dramatic focal slots).
  const orderedDraws = useMemo(() => arrangeBatchCards(handoff.draws), [handoff]);

  // Option B: track which card indices have been flipped face-up.
  const [flippedSet, setFlippedSet] = useState<Set<number>>(() => {
    const init = new Set<number>();
    const total = orderedDraws.length;
    orderedDraws.forEach((d, idx) => {
      if (!isMysteryDraw(d, total)) init.add(idx);
    });
    return init;
  });

  // Track when cards have landed (batched cleanly to avoid 10 mid-flight React re-renders).
  const [landedAll, setLandedAll] = useState(() => reducedMotion());
  const [spreadReady, setSpreadReady] = useState(() => reducedMotion());
  const [inspectedIdx, setInspectedIdx] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const dropPackRef = useRef<HTMLDivElement>(null);
  const flyStripRef = useRef<HTMLDivElement>(null);
  const fxCanvasRef = useRef<HTMLCanvasElement>(null);
  const fxEngineRef = useRef<FxEngine | null>(null);
  const cardElsRef = useRef<(HTMLDivElement | null)[]>([]);
  const nextPackRef = useRef<FoilPackHandle>(null);
  const flipTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeSimRef = useRef<() => void>(() => {});
  const refreshOptRef = useRef<() => void>(() => {});

  // Refs synced to latest React state for the physics loop.
  const inspectedRef = useRef<number | null>(inspectedIdx);
  inspectedRef.current = inspectedIdx;
  const flippedRef = useRef(flippedSet);
  flippedRef.current = flippedSet;
  const spreadReadyRef = useRef(spreadReady);
  spreadReadyRef.current = spreadReady;

  // Initialize single shared FX engine once on mount.
  useEffect(() => {
    const canvas = fxCanvasRef.current;
    if (!canvas) return;
    const engine = createFxEngine(canvas);
    fxEngineRef.current = engine;
    return () => {
      engine.destroy();
      fxEngineRef.current = null;
    };
  }, []);

  // Trigger VFX & sound when a big hit reveals (either single-card landing or Option B mystery flip).
  const triggerRarityCelebration = useCallback((draw: Draw, cx: number, cy: number) => {
    if (reducedMotion()) return;
    if (draw.kind === 'none') return;
    const fx = fxEngineRef.current;
    if (!fx) return;
    const r = draw.rarity;

    const colors: Record<Rarity, string[]> = {
      common: ['#ffffff', '#f3eee4', '#d9dee5'],
      rare: ['#bfdbfe', '#4d8dff', '#ffffff'],
      epic: ['#e9d5ff', '#b06cff', '#f0abfc', '#ffffff'],
      legendary: ['#fff1b8', '#ffc22e', '#ffffff', '#ff9d3c'],
    };
    const scale = r === 'legendary' ? 1.7 : r === 'epic' ? 1.35 : r === 'rare' ? 1.0 : 0.75;
    fx.burst({ x: cx, y: cy, colors: colors[r], count: Math.round(64 * scale), power: 6.0 * scale });

    if (r === 'epic') {
      fx.lightning({
        x: cx,
        y: cy,
        colors: ['#e9d5ff', '#a855f7', '#f0abfc', '#818cf8'],
        ms: 1000,
      });
      fx.confetti({ colors: CONFETTI_COLORS.epic, ms: 1250 });
    }

    if (r === 'legendary') {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      setFlash(true);
      flashTimerRef.current = setTimeout(() => {
        flashTimerRef.current = null;
        setFlash(false);
      }, 1150);
      fx.coinRain(3400);
      fx.confetti({ colors: CONFETTI_COLORS.legendary, ms: 2800 });
    }
  }, []);

  // Flip a single Option B mystery card.
  const flipCard = useCallback(
    (idx: number) => {
      if (flippedRef.current.has(idx)) return;
      const draw = orderedDraws[idx];
      if (!draw) return;
      setFlippedSet((prev) => {
        if (prev.has(idx)) return prev;
        const next = new Set(prev);
        next.add(idx);
        return next;
      });
      lotterySfx.flip(draw.rarity, idx, orderedDraws.length);
      const rect = cardElsRef.current[idx]?.getBoundingClientRect();
      const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
      const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
      triggerRarityCelebration(draw, cx, cy);
      wakeSimRef.current();
    },
    [orderedDraws, triggerRarityCelebration],
  );

  // Stable card click handler so React.memo(PrizeCard) skips unaffected cards.
  const handleCardSelect = useCallback(
    (idx: number) => {
      if (!spreadReadyRef.current) return;
      if (!flippedRef.current.has(idx)) {
        flipCard(idx);
      } else if (orderedDraws.length > 5) {
        lotterySfx.tick();
        setInspectedIdx((prev) => (prev === idx ? null : idx));
        wakeSimRef.current();
      }
    },
    [flipCard, orderedDraws.length],
  );

  const unflippedIndices = useMemo(() => {
    const list: number[] = [];
    orderedDraws.forEach((_, i) => {
      if (!flippedSet.has(i)) list.push(i);
    });
    // Flip Epics before Legendaries during "Flip all" for peak climax!
    list.sort((a, b) => {
      const ra = orderedDraws[a].rarity === 'legendary' ? 1 : 0;
      const rb = orderedDraws[b].rarity === 'legendary' ? 1 : 0;
      return ra - rb || a - b;
    });
    return list;
  }, [orderedDraws, flippedSet]);

  const flipAll = useCallback(() => {
    flipTimersRef.current.forEach(clearTimeout);
    flipTimersRef.current = [];
    unflippedIndices.forEach((idx, step) => {
      const id = setTimeout(() => flipCard(idx), step * 240);
      flipTimersRef.current.push(id);
    });
  }, [unflippedIndices, flipCard]);

  // Wake physics loop & re-cache optical elements whenever flip/inspect state updates.
  useEffect(() => {
    refreshOptRef.current();
    wakeSimRef.current();
  }, [flippedSet, inspectedIdx]);

  // Reset per-reveal state whenever a fresh handoff arrives (including consecutive in-portal rips).
  useEffect(() => {
    const nextFlipped = new Set<number>();
    orderedDraws.forEach((d, i) => {
      if (!isMysteryDraw(d, orderedDraws.length)) nextFlipped.add(i);
    });
    setFlippedSet(nextFlipped);
    setLandedAll(reducedMotion());
    setSpreadReady(reducedMotion());
    setInspectedIdx(null);
    setPortalError('');
    // Notify parent right away so balances & history stay synced.
    onResultAccepted(handoff.status);
  }, [handoff, orderedDraws, onResultAccepted]);

  // Main 3D ejection -> orbital unwind -> sleepable interactive hover-tilt simulation.
  useEffect(() => {
    if (portalMode !== 'reveal') return;

    const reduce = reducedMotion();
    const n = orderedDraws.length;
    let vw = window.innerWidth;
    let vh = window.innerHeight;

    const calcBaseCardW = () =>
      n === 1
        ? clamp(Math.min(vw - 120, (vh - 210) / 1.4), 210, 272)
        : clamp(Math.min(vh * 0.56, 400) * 0.69 * 0.88, 175, 240);
    let baseCardW = calcBaseCardW();
    if (stageRef.current) {
      stageRef.current.style.setProperty('--pk-cw', `${baseCardW.toFixed(1)}px`);
      stageRef.current.style.setProperty('--pk-ch', `${(baseCardW * 1.4).toFixed(1)}px`);
    }
    const orbitDur = n === 1 ? ORBIT_SINGLE : ORBIT_BATCH;

    const startX = handoff.rect.left + handoff.rect.width / 2 - vw / 2;
    const startY = handoff.rect.top + handoff.rect.height / 2 - vh / 2;
    const pw = handoff.rect.width || 245;
    const ph = handoff.rect.height || 355;

    const layouts = computeCardLayout(n, vw, vh, baseCardW);
    const cards: CardSim[] = orderedDraws.map((draw, i) => {
      const slot = layouts[i] ?? { x: 0, y: 0, z: 0, rz: 0, s: 1, row: 0 };
      const initPose = reduce
        ? createPose({ x: slot.x, y: slot.y, z: slot.z, rx: 0, ry: 0, rz: slot.rz, s: slot.s }, 0.48, 0.22)
        : createPose({ x: startX, y: startY + ph * 0.04, z: 6 - i * 1.6, rx: 0, ry: 0, rz: 0, s: 0.76 }, 0.52, 0.22);
      const springs = [initPose.x, initPose.y, initPose.z, initPose.rx, initPose.ry, initPose.rz, initPose.s];
      return {
        draw,
        index: i,
        slotIndex: i,
        phase: reduce ? 'spread' : 'in',
        from: 0,
        landAt: 0,
        x0: startX,
        y0: startY,
        vy: 0,
        rz0: 0,
        even: (-i * 2 * Math.PI) / Math.max(1, n),
        end: Math.PI / 2 - (i - (n - 1) / 2) * 0.45,
        slot,
        hover: false,
        up: false,
        glad: false,
        kb: false,
        hx: 0.5,
        hy: 0.5,
        lastZ: -1,
        lastNx: 99,
        lastNy: 99,
        settled: false,
        p: initPose,
        springs,
        opt: null,
      };
    });

    const allSprings: Spring[] = [];
    for (const c of cards) allSprings.push(...c.springs);

    const refreshOpt = () => {
      for (const c of cards) {
        const el = cardElsRef.current[c.index];
        c.opt = el ? queryOpticalEls(el) : null;
        c.settled = false;
        c.lastNx = 99;
      }
    };
    refreshOpt();
    refreshOptRef.current = refreshOpt;

    if (sceneRef.current) {
      sceneRef.current.classList.toggle('flat', reduce);
    }

    // Launch perspective confetti straight out of the pack mouth on the single shared canvas!
    const topRarity = bestRarity(orderedDraws);
    if (!reduce && fxEngineRef.current) {
      fxEngineRef.current.packConfetti({
        ox: handoff.rect.left + handoff.rect.width / 2,
        oy: handoff.rect.top + ph * 0.14,
        mouthWidth: pw * 0.82,
        colors: CONFETTI_COLORS[topRarity],
        count: topRarity === 'legendary' ? 170 : topRarity === 'epic' ? 140 : 110,
      });
    }

    if (reduce) {
      orderedDraws.forEach((d, idx) => lotterySfx.land(d.rarity, isMysteryDraw(d, n), idx, n));
    }

    const pointer = { x: vw / 2, y: vh / 2, in: false };
    let rafId = 0;
    let sleeping = false;
    let lastNow = performance.now();
    let t = 0;

    const wake = () => {
      if (sleeping) {
        sleeping = false;
        lastNow = performance.now();
        rafId = requestAnimationFrame(tick);
      }
    };
    wakeSimRef.current = wake;

    const onMove = (e: globalThis.PointerEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.in = true;
      wake();
    };
    const onLeave = () => {
      pointer.in = false;
      wake();
    };
    const onFocusChange = () => wake();
    const onResize = () => {
      vw = window.innerWidth;
      vh = window.innerHeight;
      baseCardW = calcBaseCardW();
      if (stageRef.current) {
        stageRef.current.style.setProperty('--pk-cw', `${baseCardW.toFixed(1)}px`);
        stageRef.current.style.setProperty('--pk-ch', `${(baseCardW * 1.4).toFixed(1)}px`);
      }
      const next = computeCardLayout(n, vw, vh, baseCardW);
      cards.forEach((c, i) => {
        if (next[i]) {
          c.slot = next[i];
          c.settled = false;
        }
      });
      wake();
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('focusin', onFocusChange);

    // Pack drop-away & loose foil strip launch physics.
    let fallY = 0;
    let fallV = (1450 * ph) / 420;
    let fallRz = 0;
    let packDropped = reduce;
    let stripX = startX;
    let stripY = startY;
    let stripVx = handoff.tearDir * 240;
    let stripVy = -1750;
    let stripRz = handoff.tearDir * 18;
    let stripRx = -24;
    let stripDone = reduce;

    let unwound = reduce;
    let spreadAnnounced = reduce;

    const findAimed = (): CardSim | null => {
      if (!pointer.in) return null;
      const insp = inspectedRef.current;
      if (insp !== null) {
        const c = cards[insp];
        if (!c) return null;
        const w = baseCardW * 1.12;
        const h = w * 1.4;
        c.hx = clamp((pointer.x - vw / 2) / w + 0.5, 0, 1);
        c.hy = clamp((pointer.y - vh / 2) / h + 0.5, 0, 1);
        return c;
      }

      let best: CardSim | null = null;
      for (const c of cards) {
        if (c.phase !== 'spread') continue;
        const f = c.slot;
        const near = 1400 / (1400 - f.z);
        const rad = (f.rz * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const w = baseCardW * f.s * near;
        const h = w * 1.4;
        const dx = pointer.x - (vw / 2 + f.x * near);
        const dy = pointer.y - (vh * 0.4 + (vh * 0.1 + f.y) * near);
        const hx = (dx * cos + dy * sin) / w + 0.5;
        const hy = (dy * cos - dx * sin) / h + 0.5;
        if (hx >= 0 && hx <= 1 && hy >= 0 && hy <= 1 && (!best || f.z >= best.slot.z)) {
          best = c;
          c.hx = hx;
          c.hy = hy;
        }
      }
      return best;
    };

    const startUnwind = () => {
      unwound = true;
      sceneRef.current?.classList.add('flat');
      if (n > 1) lotterySfx.swirl(orbitDur);
      for (const c of cards) {
        c.phase = 'orbit';
        c.from = t + c.index * (n > 5 ? 0.02 : 0.028);
        c.landAt = c.from + orbitDur;
        c.x0 = c.p.x.x;
        c.y0 = c.p.y.x;
        c.vy = c.p.y.v;
        c.rz0 = c.p.rz.x;
        c.p.s.to = c.slot.s;
        for (const k of ['x', 'y', 'z', 'rx', 'ry', 'rz'] as const) c.p[k].free();
      }
    };

    const stepOrbit = (c: CardSim) => {
      const u = clamp((t - c.from) / orbitDur, 0, 1);
      const f = c.slot;
      if (n === 1) {
        const out = smoothstep(0.18, 1, u);
        const arc = Math.sin(u * Math.PI);
        c.p.x.x = c.x0 * (1 - out) + f.x * out;
        c.p.y.x = c.y0 * (1 - out) + f.y * out - arc * 58;
        c.p.z.x = f.z * out + arc * 190;
        c.p.ry.x = (1 - (1 - u) ** 3) * 360 - 360;
        c.p.rx.x = arc * 10;
        c.p.rz.x = arc * -4;
      } else {
        const turn = 1 - (1 - u) ** 2;
        const out = smoothstep(0.48, 1, u);
        const ring = Math.sin(Math.min(1, u / 0.42) * (Math.PI / 2)) * (1 - out);
        const a = c.end + (1 - turn) * (c.even - c.end + Math.PI * 2.3);
        const sin = Math.sin(a);
        const cos = Math.cos(a);
        const W = Math.min(vw * 0.31, 390);
        const mid = c.y0 + (c.vy / 9) * (1 - Math.exp(-9 * Math.max(0, t - c.from)));
        const cy = mid + (-vh * 0.03 - mid) * smoothstep(0, 0.42, u);
        c.p.x.x = c.x0 * (1 - out) + f.x * out + cos * W * ring;
        c.p.y.x = cy * (1 - out) + f.y * out + sin * W * 0.19 * ring;
        c.p.z.x = f.z * out + sin * 280 * ring;
        c.p.rz.x = c.rz0 * (1 - out) + f.rz * out - cos * 8 * ring;
        c.p.ry.x = -cos * 24 * ring;
        c.p.rx.x = 7 * ring;
      }

      if (u >= 1) {
        c.phase = 'spread';
        c.settled = false;
        for (const k of ['x', 'y', 'z', 'rx', 'ry', 'rz', 's'] as const) c.p[k].set(0.48, 0.22);
        const mystery = isMysteryDraw(c.draw, n);
        lotterySfx.land(c.draw.rarity, mystery, c.index, n);
        if (n === 1) {
          triggerRarityCelebration(c.draw, vw / 2, vh / 2 - 12);
        }
      }
    };

    const tick = (now: number) => {
      rafId = 0;
      if (document.hidden) {
        lastNow = now;
        rafId = requestAnimationFrame(tick);
        return;
      }
      const dt = Math.min(0.05, Math.max(0.001, (now - lastNow) / 1000));
      lastNow = now;
      t += dt;

      // Drop the empty foil pouch cleanly off the bottom of the screen.
      if (!packDropped && dropPackRef.current) {
        if (t > 0.02) {
          fallV += 2800 * dt;
          fallY += fallV * dt;
          fallRz += (handoff.tearDir * 10 - fallRz) * Math.min(1, dt * 8);
        }
        dropPackRef.current.style.transform = `translate3d(${startX.toFixed(1)}px,${(startY + fallY).toFixed(1)}px,0) rotateZ(${fallRz.toFixed(2)}deg)`;
        if (startY + fallY > vh + ph) {
          packDropped = true;
          dropPackRef.current.style.visibility = 'hidden';
        }
      }

      // Launch the torn foil strip upward and tumble it off-screen.
      if (!stripDone && flyStripRef.current) {
        stripVy += 2600 * dt;
        stripX += stripVx * dt;
        stripY += stripVy * dt;
        stripRz += handoff.tearDir * 480 * dt;
        stripRx -= 300 * dt;
        flyStripRef.current.style.transform = `translate3d(${stripX.toFixed(1)}px,${stripY.toFixed(1)}px,20px) rotateZ(${stripRz.toFixed(1)}deg) rotateX(${stripRx.toFixed(1)}deg)`;
        if (t > 1.45) {
          stripDone = true;
          flyStripRef.current.style.visibility = 'hidden';
        }
      }

      // Eject cards straight up out of the pouch mouth.
      if (!unwound) {
        for (const c of cards) {
          if (c.phase === 'in' && t > c.index * 0.018) {
            c.phase = 'shot';
            c.p.s.to = c.slot.s;
            c.p.y.k = 0;
            c.p.y.c = 1.25;
            c.p.y.v = (-rand(1180, 1380) * ph) / 420;
          }
        }
        const mouthY = startY + fallY - ph * 0.36;
        if (cards.every((c) => c.phase === 'shot') && cards.every((c) => c.p.y.x + baseCardW * 0.25 < mouthY || t > 0.34)) {
          startUnwind();
        }
      }

      stepSprings(allSprings, dt);

      for (const c of cards) {
        if (c.phase === 'orbit') stepOrbit(c);
      }

      const hot = findAimed();
      const insp = inspectedRef.current;
      const motion = reduce ? 0 : 1;

      // Compute z-order only when cards are moving or hovering.
      const sortedByZ = [...cards].sort((a, b) => a.p.z.x - b.p.z.x);
      const zRanks = new Map<number, number>();
      for (let idx = 0; idx < sortedByZ.length; idx++) {
        zRanks.set(sortedByZ[idx].index, idx + 1);
      }

      let anyActiveMotion = !packDropped || !stripDone || !spreadAnnounced;

      for (const c of cards) {
        const el = cardElsRef.current[c.index];
        if (!el) continue;

        const isBack = !flippedRef.current.has(c.index);
        let needsContinuousMotion = c.phase !== 'spread';

        if (c.phase === 'spread') {
          c.kb = document.activeElement === el && el.matches(':focus-visible');
          const isInsp = insp === c.index;
          const on = isInsp || (insp === null && (c === hot || c.kb));
          c.hover = on;
          if (c.kb && c !== hot && !isInsp) {
            c.hx = 0.5 + Math.sin(t * 1.7) * 0.22 * motion;
            c.hy = 0.5 + Math.cos(t * 1.3) * 0.16 * motion;
          }
          if (on !== c.glad) {
            c.glad = on;
            c.settled = false;
            if (on && !isInsp) lotterySfx.lift(c.index, n);
          }

          const f = c.slot;
          const w = t * 0.8 + c.index * 1.7;

          if (isInsp) {
            c.p.x.to = 0;
            c.p.y.to = -14;
            c.p.z.to = 170;
            c.p.rz.to = 0;
            c.p.s.to = clamp(Math.min((vw - 120) / baseCardW, (vh - 190) / (baseCardW * 1.4), 1.15), 0.82, 1.15);
            c.p.rx.to = (0.5 - c.hy) * 26;
            c.p.ry.to = (c.hx - 0.5) * 30;
            needsContinuousMotion = true;
          } else if (on) {
            c.p.x.to = f.x;
            c.p.s.to = f.s;
            c.p.y.to = f.y - 14;
            c.p.z.to = f.z + 105;
            c.p.rz.to = f.rz * 0.25;
            c.p.rx.to = (0.5 - c.hy) * 32;
            c.p.ry.to = (c.hx - 0.5) * 36;
            needsContinuousMotion = true;
          } else if (isBack) {
            // Unflipped mystery cards rest slightly lifted in Z-space (their pulsing CTA & border invite clicking without burning 3D wobble every frame).
            c.p.x.to = f.x;
            c.p.s.to = f.s;
            c.p.y.to = f.y - 4;
            c.p.z.to = f.z + 18;
            c.p.rz.to = f.rz;
            c.p.rx.to = 0;
            c.p.ry.to = 0;
          } else if (n === 1 && motion) {
            // Single showcase card maintains a gentle living float.
            c.p.x.to = f.x;
            c.p.s.to = f.s;
            c.p.y.to = f.y + Math.sin(w * 1.1) * 4.0;
            c.p.z.to = f.z;
            c.p.rz.to = f.rz;
            c.p.rx.to = Math.cos(w * 0.85) * 3.2;
            c.p.ry.to = Math.sin(w) * 6.5;
            needsContinuousMotion = true;
          } else {
            // Resting revealed batch cards settle cleanly into their arched fan so idle GPU/CPU drops to 0%.
            c.p.x.to = f.x;
            c.p.s.to = f.s;
            c.p.y.to = f.y;
            c.p.z.to = f.z;
            c.p.rz.to = f.rz;
            c.p.rx.to = 0;
            c.p.ry.to = 0;
          }

          if (!needsContinuousMotion) {
            if (allSettled(c.springs, 0.04, 0.08)) {
              if (c.settled) continue;
              // Final clean snap to exact resting coordinates, then mark settled!
              c.p.x.snap(c.p.x.to);
              c.p.y.snap(c.p.y.to);
              c.p.z.snap(c.p.z.to);
              c.p.rz.snap(c.p.rz.to);
              c.p.rx.snap(0);
              c.p.ry.snap(0);
              c.p.s.snap(c.p.s.to);
              c.settled = true;
            } else {
              c.settled = false;
              anyActiveMotion = true;
            }
          } else {
            c.settled = false;
            anyActiveMotion = true;
          }
        }

        const loose = c.phase === 'spread' || c.phase === 'orbit';
        const rx = loose ? c.p.rx.x - clamp(c.p.y.v * 0.005, -8, 8) : 0;
        const ry = loose ? c.p.ry.x + clamp(c.p.x.v * 0.007, -12, 12) : 0;

        el.style.transform = `translate3d(${c.p.x.x.toFixed(2)}px,${c.p.y.x.toFixed(2)}px,${c.p.z.x.toFixed(2)}px) rotateZ(${c.p.rz.x.toFixed(2)}deg) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) scale(${c.p.s.x.toFixed(4)})`;

        if (loose) c.up = c.hover || (c.up && c.p.z.x > c.slot.z + 25);
        const nextZ = insp === c.index ? 30 : c.up ? 20 : zRanks.get(c.index) ?? n - c.index;
        if (nextZ !== c.lastZ) {
          el.style.zIndex = String(nextZ);
          c.lastZ = nextZ;
        }

        // Update GPU-composited optical leaf layers ONLY when tilt visibly changed.
        if (c.phase === 'spread' && c.opt) {
          const alpha = reduce ? 1 : clamp((t - c.landAt - 0.08) / 0.35, 0, 1);
          const nx = clamp(ry / 24, -1, 1) * alpha;
          const ny = clamp(rx / 24, -1, 1) * alpha;
          if (Math.abs(nx - c.lastNx) > 0.004 || Math.abs(ny - c.lastNy) > 0.004 || alpha < 1) {
            c.lastNx = nx;
            c.lastNy = ny;
            const hyp = Math.min(1, Math.hypot(nx, ny));
            applyOptical(c.opt, c.draw.rarity, isBack, nx, ny, hyp);
            if (alpha < 1) anyActiveMotion = true;
          }
        }
      }

      if (!spreadAnnounced && cards.every((c) => c.phase === 'spread')) {
        spreadAnnounced = true;
        // Single batched state update after landing (replaces up to 10 consecutive mid-flight re-renders!).
        setLandedAll(true);
        setSpreadReady(true);
        anyActiveMotion = true;
      }

      if (anyActiveMotion) {
        rafId = requestAnimationFrame(tick);
      } else {
        sleeping = true;
      }
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      wakeSimRef.current = () => {};
      refreshOptRef.current = () => {};
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('focusin', onFocusChange);
    };
  }, [portalMode, handoff, orderedDraws, triggerRarityCelebration]);

  // Mark root document opaque while fullscreen portal is mounted to reduce macOS vibrancy compositing overhead.
  useEffect(() => {
    document.documentElement.classList.add('pk-portal-open');
    return () => {
      document.documentElement.classList.remove('pk-portal-open');
      flipTimersRef.current.forEach(clearTimeout);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  // Keyboard navigation inside the Portal (Escape, Arrows, Enter/Space).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (inspectedIdx !== null) {
          setInspectedIdx(null);
        } else if (portalMode === 'next-pack' || spreadReady) {
          onClose();
        }
        return;
      }
      if (portalMode !== 'reveal' || !spreadReady) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const dir = e.key === 'ArrowLeft' ? -1 : 1;
        const active = cardElsRef.current.findIndex((el) => el === document.activeElement);
        const nextIdx =
          active >= 0
            ? clamp(active + dir, 0, orderedDraws.length - 1)
            : dir > 0
              ? 0
              : orderedDraws.length - 1;
        cardElsRef.current[nextIdx]?.focus({ preventScroll: true });
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [portalMode, spreadReady, inspectedIdx, orderedDraws.length, onClose]);

  // Compute non-spoiling batch summary (only sums cards already flipped face-up!).
  const revealedDraws = useMemo(
    () => orderedDraws.filter((_, idx) => flippedSet.has(idx)),
    [orderedDraws, flippedSet],
  );
  const revealedBalance = useMemo(() => balanceGained(revealedDraws), [revealedDraws]);
  const totalBigHits = useMemo(
    () => orderedDraws.filter((d) => d.kind !== 'none' && (d.rarity === 'epic' || d.rarity === 'legendary')).length,
    [orderedDraws],
  );
  const unflippedCount = unflippedIndices.length;

  const leftPacks = status.chests;
  const nextBatch = batchSize(leftPacks);

  const openAnother = (count: number) => {
    lotterySfx.tick();
    fxEngineRef.current?.clear();
    flipTimersRef.current.forEach(clearTimeout);
    flipTimersRef.current = [];
    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
    }
    setFlash(false);
    setInspectedIdx(null);
    setPortalError('');
    setNextPackCount(count);
    setPortalMode('next-pack');
  };

  // Clip paths of the torn pack body and flying top strip during eject handoff.
  const { dropClip, stripClip } = useMemo(() => {
    const pts = handoff.tearPath.points.map((q): [number, number] => [q.x, q.y]);
    return {
      dropClip: poly([[100, 100], [0, 100], ...pts]),
      stripClip: poly([[0, 0], [100, 0], ...pts.slice().reverse()]),
    };
  }, [handoff]);

  const portalStyle = useMemo(() => {
    const cw =
      orderedDraws.length === 1
        ? clamp(Math.min(window.innerWidth - 120, (window.innerHeight - 210) / 1.4), 210, 272)
        : clamp(Math.min(window.innerHeight * 0.56, 400) * 0.69 * 0.88, 175, 240);
    const glitterUrl = getGlitterDataUrl();
    return {
      '--pk-cw': `${cw.toFixed(1)}px`,
      '--pk-ch': `${(cw * 1.4).toFixed(1)}px`,
      ...(glitterUrl ? { '--pk-glitter': glitterUrl } : {}),
    } as CSSProperties;
  }, [handoff, orderedDraws.length]);

  const slabCount: 1 | 2 = orderedDraws.length === 1 ? 2 : 1;

  const content = (
    <div
      ref={stageRef}
      className={`pk-portal ${portalMode === 'reveal' ? 'mode-reveal' : 'mode-pack'}`}
      role="dialog"
      aria-modal="true"
      aria-label={t('lottery.portalLabel')}
      style={portalStyle}
      onClick={(e) => {
        if (inspectedIdx !== null && e.target === stageRef.current) setInspectedIdx(null);
      }}
    >
      {/* Top-right studio chrome: mute toggle + close */}
      <div className="pk-portal-chrome">
        <button
          type="button"
          className="pk-chrome-btn"
          aria-label={soundOn ? t('lottery.muteSound') : t('lottery.unmuteSound')}
          aria-pressed={!soundOn}
          onClick={() => setLotterySoundOn(!soundOn)}
        >
          <Icon name={soundOn ? 'volumeOn' : 'volumeOff'} className="size-[18px]" />
        </button>
        {(spreadReady || portalMode === 'next-pack') && (
          <button type="button" className="pk-chrome-btn" aria-label={t('common.close')} onClick={onClose}>
            <Icon name="close" className="size-[18px]" />
          </button>
        )}
      </div>

      {/* Top non-spoiling summary pill for batch pulls (2+ cards) */}
      {portalMode === 'reveal' && orderedDraws.length > 1 && spreadReady && (
        <div className="pk-portal-summary">
          <span className="pk-summary-count">{t('lottery.batchTitle', { n: orderedDraws.length })}</span>
          <i className="pk-summary-sep" aria-hidden />
          <span className="pk-summary-gain">
            {unflippedCount > 0 ? t('lottery.revealedGained') : t('lottery.batchGained')}
            <b>{dollars(revealedBalance)}</b>
          </span>
          {unflippedCount > 0 ? (
            <span className="pk-summary-mystery">{t('lottery.unflippedBadge', { n: unflippedCount })}</span>
          ) : (
            totalBigHits > 0 && <span className="pk-summary-big">{t('lottery.batchBig', { n: totalBigHits })}</span>
          )}
        </div>
      )}

      {/* Main stage: either card reveal OR continuous next-pack tearing */}
      {portalMode === 'reveal' ? (
        <div
          ref={sceneRef}
          className="pk-portal-scene"
          onClick={(e) => {
            if (inspectedIdx !== null && e.target === sceneRef.current) setInspectedIdx(null);
          }}
        >
          {/* Torn pouch dropping away smoothly from handoff coordinates */}
          <div
            ref={dropPackRef}
            className="pk-drop-pouch"
            style={
              {
                width: `${handoff.rect.width || 245}px`,
                height: `${handoff.rect.height || 355}px`,
                marginLeft: `${-(handoff.rect.width || 245) / 2}px`,
                marginTop: `${-(handoff.rect.height || 355) / 2}px`,
                '--pw': `${handoff.rect.width || 245}px`,
                '--ph': `${handoff.rect.height || 355}px`,
                '--pack': handoff.skin.pack,
                '--shine': handoff.creases.shine,
                '--shade': handoff.creases.shade,
              } as CSSProperties
            }
            aria-hidden
          >
            <div className="pk-skin pk-front" style={{ clipPath: dropClip }}>
              <div className="pk-brand-row">
                <b className="pk-mark-word">cloudborne</b>
              </div>
              <div className="pk-orb">
                <svg className="pk-orb-body" viewBox={`${MARK_X} ${MARK_Y} ${MARK_W} ${MARK_H}`} fill="#fff">
                  <path fillRule="evenodd" d={markPath.d} />
                </svg>
              </div>
            </div>
          </div>

          {/* Torn top foil strip flying upward & tumbling off-screen */}
          {!reducedMotion() && (
            <div
              ref={flyStripRef}
              className="pk-fly-strip"
              style={
                {
                  width: `${handoff.rect.width || 245}px`,
                  height: `${handoff.rect.height || 355}px`,
                  marginLeft: `${-(handoff.rect.width || 245) / 2}px`,
                  marginTop: `${-(handoff.rect.height || 355) / 2}px`,
                  '--pw': `${handoff.rect.width || 245}px`,
                  '--ph': `${handoff.rect.height || 355}px`,
                  '--pack': handoff.skin.pack,
                } as CSSProperties
              }
              aria-hidden
            >
              <div className="pk-skin pk-front" style={{ clipPath: stripClip }} />
              <div className="pk-skin pk-foil" style={{ clipPath: stripClip }} />
            </div>
          )}

          {/* Dimmed click-catcher when inspecting a single card in a 6..10 batch */}
          {inspectedIdx !== null && <div className="pk-inspect-scrim" onClick={() => setInspectedIdx(null)} />}

          {/* Drawn collectible cards */}
          {orderedDraws.map((draw, idx) => {
            const mystery = isMysteryDraw(draw, orderedDraws.length);
            const faceDown = !flippedSet.has(idx);
            const revealed = landedAll && !faceDown;
            const isInspected = inspectedIdx === idx;
            return (
              <div
                key={`${draw.id}-${idx}`}
                ref={(el) => {
                  cardElsRef.current[idx] = el;
                }}
                className="pk-card-node"
                tabIndex={spreadReady ? 0 : -1}
                role="button"
                aria-label={faceDown ? t('lottery.mysteryCardAria', { rarity: t(`rarity.${draw.rarity}`) }) : draw.name}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleCardSelect(idx);
                  }
                }}
              >
                <PrizeCard
                  draw={draw}
                  index={idx}
                  serial={idx + 1}
                  isMystery={mystery}
                  faceDown={faceDown}
                  revealed={revealed}
                  out={landedAll}
                  inspected={isInspected}
                  slabCount={slabCount}
                  onSelect={handleCardSelect}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="pk-portal-next">
          {portalError && <div className="pk-portal-error">{portalError}</div>}
          <FoilPack
            ref={nextPackRef}
            mode="portal"
            packState={leftPacks > 0 ? 'ready' : 'locked'}
            packCount={Math.min(nextPackCount, Math.max(1, leftPacks))}
            enterFromRight
            excludeSkinId={handoff.skin.id}
            bonus={status.bonus}
            dailyUnopened={status.daily?.unopened ?? 0}
            onCommitOpen={onCommitOpen}
            onOpened={(nextHandoff) => {
              setHandoff(nextHandoff);
              setPortalMode('reveal');
            }}
            onError={(err) => setPortalError(errorText(err, t('common.genericError')))}
          />
          <p className="pk-portal-hint">{t('lottery.dragHint')}</p>
        </div>
      )}

      {/* Bottom floating studio action bar */}
      {portalMode === 'reveal' && spreadReady && (
        <div className="pk-portal-actions">
          {unflippedCount > 0 ? (
            <>
              <button type="button" className="pk-action-btn primary" onClick={flipAll}>
                <Icon name="sparkle" className="size-4" />
                {t('lottery.flipAll', { n: unflippedCount })}
              </button>
              <button type="button" className="pk-action-btn" onClick={onClose}>
                {t('lottery.collectDirect')}
              </button>
            </>
          ) : (
            <>
              {leftPacks > 0 && (
                <button type="button" className="pk-action-btn primary" onClick={() => openAnother(1)}>
                  <Icon name="pack" className="size-4" />
                  {t('lottery.openAnother', { n: leftPacks })}
                </button>
              )}
              {nextBatch !== null && (
                <button type="button" className="pk-action-btn" onClick={() => openAnother(nextBatch)}>
                  {t('lottery.openAnotherBatch', { n: nextBatch })}
                </button>
              )}
              <button
                type="button"
                className={`pk-action-btn ${leftPacks === 0 ? 'primary' : ''}`}
                autoFocus={handoff.viaKey}
                onClick={onClose}
              >
                {t('lottery.collect')}
              </button>
            </>
          )}
        </div>
      )}

      {/* Single shared full-viewport FX canvas (auto-hidden when idle) */}
      <canvas ref={fxCanvasRef} className="pk-fx-canvas" aria-hidden />
      {flash && <div className="lot-flash" aria-hidden />}
    </div>
  );

  return createPortal(content, document.body);
}
