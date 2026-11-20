import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import markPath from '../../brand/dist/mark-path.json';
import { errorText, type Draw, type LotteryStatus, type Rarity } from '../api';
import { useI18n } from '../i18n';
import { balanceGained, batchSize, dollars } from '../lottery';
import { lotterySfx, setLotterySoundOn, useLotterySoundOn } from '../lottery/lotterySound';
import { CONFETTI_COLORS, bestRarity, isMysteryDraw } from '../lottery/packThemes';
import { clamp, createPose, rand, stepSprings, type Pose } from '../lottery/spring';
import { arrangeBatchCards, computeCardLayout, poly, type CardSlot } from '../lottery/tearGeometry';
import { FoilPack, type FoilPackHandle, type PackHandoff, type PackOpenResult } from './FoilPack';
import { Icon } from './Icon';
import { PrizeCard } from './PrizeCard';
import { burst, coinRain, confetti, lightning, packConfetti } from './fx';

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
  p: Pose<'x' | 'y' | 'z' | 'rx' | 'ry' | 'rz' | 's'>;
}

const ORBIT_SINGLE = 0.78;
const ORBIT_BATCH = 1.15;

const reducedMotion = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

const smoothstep = (a: number, b: number, x: number) => {
  const k = clamp((x - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};

/**
 * Full-viewport warm studio gallery overlay (`holo.yashb.xyz` aesthetic) that
 * catches the torn pack seamlessly at its exact pixel coordinates, erupts 3D
 * confetti, launches cards through an orbital unwind into an interactive 3D
 * fan/gallery, supports Option B mystery card flipping for Epic/Legendary hits,
 * and allows tearing consecutive packs right inside the studio without closing.
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

  // Track which cards have landed in their resting slots (for Slot rolling & 3D emblem pop).
  const [landedSet, setLandedSet] = useState<Set<number>>(() =>
    reducedMotion() ? new Set(orderedDraws.map((_, i) => i)) : new Set(),
  );
  const [spreadReady, setSpreadReady] = useState(() => reducedMotion());
  const [inspectedIdx, setInspectedIdx] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const dropPackRef = useRef<HTMLDivElement>(null);
  const flyStripRef = useRef<HTMLDivElement>(null);
  const fxMainRef = useRef<HTMLCanvasElement>(null);
  const fxSparksRef = useRef<HTMLCanvasElement>(null);
  const fxBoltsRef = useRef<HTMLCanvasElement>(null);
  const fxCoinsRef = useRef<HTMLCanvasElement>(null);
  const cardElsRef = useRef<(HTMLDivElement | null)[]>([]);
  const nextPackRef = useRef<FoilPackHandle>(null);
  const stopsRef = useRef<(() => void)[]>([]);
  const flipTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs synced to latest React state for the 60/120fps physics loop.
  const inspectedRef = useRef<number | null>(inspectedIdx);
  inspectedRef.current = inspectedIdx;
  const flippedRef = useRef(flippedSet);
  flippedRef.current = flippedSet;

  // Trigger VFX & sound when a big hit reveals (either single-card landing or Option B mystery flip).
  const triggerRarityCelebration = useCallback((draw: Draw, cx: number, cy: number) => {
    if (reducedMotion()) return;
    if (draw.kind === 'none') return;
    const r = draw.rarity;

    if (fxSparksRef.current) {
      const colors: Record<Rarity, string[]> = {
        common: ['#ffffff', '#f3eee4', '#d9dee5'],
        rare: ['#bfdbfe', '#4d8dff', '#ffffff'],
        epic: ['#e9d5ff', '#b06cff', '#f0abfc', '#ffffff'],
        legendary: ['#fff1b8', '#ffc22e', '#ffffff', '#ff9d3c'],
      };
      const scale = r === 'legendary' ? 2 : r === 'epic' ? 1.55 : r === 'rare' ? 1.1 : 0.8;
      stopsRef.current.push(
        burst(fxSparksRef.current, { x: cx, y: cy, colors: colors[r], count: Math.round(78 * scale), power: 6.2 * scale }),
      );
    }

    if (r === 'epic') {
      if (fxBoltsRef.current) {
        stopsRef.current.push(
          lightning(fxBoltsRef.current, {
            x: cx,
            y: cy,
            colors: ['#e9d5ff', '#a855f7', '#f0abfc', '#818cf8'],
            ms: 1050,
          }),
        );
      }
      if (fxCoinsRef.current) {
        stopsRef.current.push(confetti(fxCoinsRef.current, { colors: [...CONFETTI_COLORS.epic], ms: 1350 }));
      }
    }

    if (r === 'legendary') {
      setFlash(true);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => {
        flashTimerRef.current = null;
        setFlash(false);
      }, 1150);
      if (fxCoinsRef.current) stopsRef.current.push(coinRain(fxCoinsRef.current, 3800));
      if (fxBoltsRef.current) {
        stopsRef.current.push(confetti(fxBoltsRef.current, { colors: [...CONFETTI_COLORS.legendary], ms: 3100 }));
      }
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
    },
    [orderedDraws, triggerRarityCelebration],
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

  // Reset per-reveal state whenever a fresh handoff arrives (including consecutive in-portal rips).
  useEffect(() => {
    const nextFlipped = new Set<number>();
    orderedDraws.forEach((d, i) => {
      if (!isMysteryDraw(d, orderedDraws.length)) nextFlipped.add(i);
    });
    setFlippedSet(nextFlipped);
    setLandedSet(reducedMotion() ? new Set(orderedDraws.map((_, i) => i)) : new Set());
    setSpreadReady(reducedMotion());
    setInspectedIdx(null);
    setPortalError('');
    // Notify parent right away so balances & history stay synced.
    onResultAccepted(handoff.status);
  }, [handoff, orderedDraws, onResultAccepted]);

  // Main 3D ejection -> orbital unwind -> interactive hover-tilt simulation.
  useEffect(() => {
    if (portalMode !== 'reveal') return;

    const reduce = reducedMotion();
    const n = orderedDraws.length;
    // Size native card pixels to peak scale so GPU layers never upscale past 1.0x (razor-sharp Retina text).
    const calcBaseCardW = () =>
      n === 1
        ? clamp(Math.min(window.innerWidth - 120, (window.innerHeight - 210) / 1.4), 210, 272)
        : clamp(Math.min(window.innerHeight * 0.56, 400) * 0.69 * 0.88, 175, 240);
    let baseCardW = calcBaseCardW();
    if (stageRef.current) {
      stageRef.current.style.setProperty('--pk-cw', `${baseCardW.toFixed(1)}px`);
      stageRef.current.style.setProperty('--pk-ch', `${(baseCardW * 1.4).toFixed(1)}px`);
    }
    const orbitDur = n === 1 ? ORBIT_SINGLE : ORBIT_BATCH;

    // Starting coordinates relative to viewport center.
    const startX = handoff.rect.left + handoff.rect.width / 2 - window.innerWidth / 2;
    const startY = handoff.rect.top + handoff.rect.height / 2 - window.innerHeight / 2;
    const pw = handoff.rect.width || 245;
    const ph = handoff.rect.height || 355;

    const layouts = computeCardLayout(n, window.innerWidth, window.innerHeight, baseCardW);
    const cards: CardSim[] = orderedDraws.map((draw, i) => {
      const slot = layouts[i] ?? { x: 0, y: 0, z: 0, rz: 0, s: 1, row: 0 };
      const initPose = reduce
        ? createPose({ x: slot.x, y: slot.y, z: slot.z, rx: 0, ry: 0, rz: slot.rz, s: slot.s }, 0.48, 0.22)
        : createPose({ x: startX, y: startY + ph * 0.04, z: 6 - i * 1.6, rx: 0, ry: 0, rz: 0, s: 0.76 }, 0.52, 0.22);
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
        p: initPose,
      };
    });

    if (sceneRef.current) {
      sceneRef.current.classList.toggle('flat', reduce);
    }

    // Launch perspective confetti straight out of the pack mouth!
    const topRarity = bestRarity(orderedDraws);
    if (!reduce && fxMainRef.current) {
      stopsRef.current.push(
        packConfetti(fxMainRef.current, {
          ox: handoff.rect.left + handoff.rect.width / 2,
          oy: handoff.rect.top + ph * 0.14,
          mouthWidth: pw * 0.82,
          colors: CONFETTI_COLORS[topRarity],
          count: topRarity === 'legendary' ? 230 : topRarity === 'epic' ? 190 : 140,
        }),
      );
    }

    // Reduced-motion path: play quiet land cues and trigger non-flashing celebration.
    if (reduce) {
      orderedDraws.forEach((d, idx) => lotterySfx.land(d.rarity, isMysteryDraw(d, n), idx, n));
    }

    const pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2, in: false };
    const onMove = (e: globalThis.PointerEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.in = true;
    };
    const onLeave = () => {
      pointer.in = false;
    };
    const onResize = () => {
      baseCardW = calcBaseCardW();
      if (stageRef.current) {
        stageRef.current.style.setProperty('--pk-cw', `${baseCardW.toFixed(1)}px`);
        stageRef.current.style.setProperty('--pk-ch', `${(baseCardW * 1.4).toFixed(1)}px`);
      }
      const next = computeCardLayout(n, window.innerWidth, window.innerHeight, baseCardW);
      cards.forEach((c, i) => {
        if (next[i]) c.slot = next[i];
      });
    };

    window.addEventListener('pointermove', onMove);
    document.documentElement.addEventListener('pointerleave', onLeave);
    window.addEventListener('resize', onResize);

    // Pack drop-away & loose foil strip launch physics (kicked by erupting cards).
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

    let t = 0;
    let lastNow = performance.now();
    let unwound = reduce;
    let spreadAnnounced = reduce;
    let rafId = 0;

    // Hit-test cards from their stable resting slots so hover never flickers.
    const findAimed = (): CardSim | null => {
      if (!pointer.in) return null;
      const insp = inspectedRef.current;
      if (insp !== null) {
        const c = cards[insp];
        if (!c) return null;
        const w = baseCardW * 1.12;
        const h = w * 1.4;
        const hx = clamp((pointer.x - window.innerWidth / 2) / w + 0.5, 0, 1);
        const hy = clamp((pointer.y - window.innerHeight / 2) / h + 0.5, 0, 1);
        c.hx = hx;
        c.hy = hy;
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
        const dx = pointer.x - (window.innerWidth / 2 + f.x * near);
        const dy = pointer.y - (window.innerHeight * 0.4 + (window.innerHeight * 0.1 + f.y) * near);
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
        c.from = t + c.index * (n > 5 ? 0.022 : 0.032);
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
        // Dramatic single-card upward sweep & full 360° presentation spin to center!
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
        const W = Math.min(window.innerWidth * 0.31, 390);
        const mid = c.y0 + (c.vy / 9) * (1 - Math.exp(-9 * Math.max(0, t - c.from)));
        const cy = mid + (-window.innerHeight * 0.03 - mid) * smoothstep(0, 0.42, u);
        c.p.x.x = c.x0 * (1 - out) + f.x * out + cos * W * ring;
        c.p.y.x = cy * (1 - out) + f.y * out + sin * W * 0.19 * ring;
        c.p.z.x = f.z * out + sin * 280 * ring;
        c.p.rz.x = c.rz0 * (1 - out) + f.rz * out - cos * 8 * ring;
        c.p.ry.x = -cos * 24 * ring;
        c.p.rx.x = 7 * ring;
      }

      if (u >= 1) {
        c.phase = 'spread';
        for (const k of ['x', 'y', 'z', 'rx', 'ry', 'rz', 's'] as const) c.p[k].set(0.48, 0.22);
        const mystery = isMysteryDraw(c.draw, n);
        lotterySfx.land(c.draw.rarity, mystery, c.index, n);
        setLandedSet((prev) => {
          if (prev.has(c.index)) return prev;
          const next = new Set(prev);
          next.add(c.index);
          return next;
        });

        // For single pulls, fire rarity celebration (lightning / flash / coin rain) right on landing!
        if (n === 1) {
          triggerRarityCelebration(c.draw, window.innerWidth / 2, window.innerHeight / 2 - 12);
        }
      }
    };

    const tick = (now: number) => {
      rafId = requestAnimationFrame(tick);
      if (document.hidden) {
        lastNow = now;
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
        if (startY + fallY > window.innerHeight + ph) {
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

      stepSprings(
        cards.flatMap((c) => Object.values(c.p)),
        dt,
      );

      for (const c of cards) {
        if (c.phase === 'orbit') stepOrbit(c);
      }

      const hot = findAimed();
      const insp = inspectedRef.current;
      const motion = reduce ? 0 : 1;

      const sortedByZ = [...cards].sort((a, b) => a.p.z.x - b.p.z.x);
      const zRanks = new Map<number, number>();
      sortedByZ.forEach((c, idx) => zRanks.set(c.index, idx + 1));

      for (const c of cards) {
        const el = cardElsRef.current[c.index];
        if (!el) continue;

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
            if (on && !isInsp) lotterySfx.lift(c.index, n);
          }

          const f = c.slot;
          const w = t * 0.8 + c.index * 1.7;
          const mysteryUnflipped = !flippedRef.current.has(c.index);

          if (isInsp) {
            c.p.x.to = 0;
            c.p.y.to = -14;
            c.p.z.to = 170;
            c.p.rz.to = 0;
            c.p.s.to = clamp(Math.min((window.innerWidth - 120) / baseCardW, (window.innerHeight - 190) / (baseCardW * 1.4), 1.15), 0.82, 1.15);
            c.p.rx.to = (0.5 - c.hy) * 28;
            c.p.ry.to = (c.hx - 0.5) * 32;
          } else {
            // Subtle beckoning shimmer tilt for unflipped Epic/Legendary mystery cards!
            const beckonRz = mysteryUnflipped && motion ? Math.sin(t * 3.1 + c.index) * 1.6 : 0;
            c.p.x.to = f.x;
            c.p.s.to = f.s;
            c.p.y.to = f.y + (on ? -14 : Math.sin(w * 1.15) * 4.2 * motion);
            c.p.z.to = f.z + (on ? 105 : mysteryUnflipped ? 18 : 0);
            c.p.rz.to = on ? f.rz * 0.25 : f.rz + beckonRz;
            c.p.rx.to = on ? (0.5 - c.hy) * 34 : Math.cos(w * 0.9) * 3.5 * motion;
            c.p.ry.to = on ? (c.hx - 0.5) * 38 : Math.sin(w) * (mysteryUnflipped ? 10 : 7) * motion;
          }
        }

        const loose = c.phase === 'spread' || c.phase === 'orbit';
        const rx = loose ? c.p.rx.x - clamp(c.p.y.v * 0.005, -8, 8) : 0;
        const ry = loose ? c.p.ry.x + clamp(c.p.x.v * 0.007, -12, 12) : 0;

        el.style.transform = `translate3d(${c.p.x.x.toFixed(2)}px,${c.p.y.x.toFixed(2)}px,${c.p.z.x.toFixed(2)}px) rotateZ(${c.p.rz.x.toFixed(2)}deg) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) scale(${c.p.s.x.toFixed(4)})`;

        if (loose) c.up = c.hover || (c.up && c.p.z.x > c.slot.z + 25);
        el.style.zIndex = String(insp === c.index ? 30 : c.up ? 20 : zRanks.get(c.index) ?? n - c.index);

        if (c.phase === 'spread') {
          const alpha = reduce ? 1 : clamp((t - c.landAt - 0.1) / 0.4, 0, 1);
          const nx = clamp(ry / 24, -1, 1) * alpha;
          const ny = clamp(rx / 24, -1, 1) * alpha;
          el.style.setProperty('--px', (50 + nx * 50).toFixed(1));
          el.style.setProperty('--py', (50 - ny * 50).toFixed(1));
          el.style.setProperty('--hyp', Math.min(1, Math.hypot(nx, ny)).toFixed(3));
        }
      }

      if (!spreadAnnounced && cards.every((c) => c.phase === 'spread')) {
        spreadAnnounced = true;
        setSpreadReady(true);
      }
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('resize', onResize);
    };
  }, [portalMode, handoff, orderedDraws, triggerRarityCelebration]);

  // Cleanup canvas loops and timers on unmount.
  useEffect(() => {
    return () => {
      stopsRef.current.forEach((s) => s());
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
    stopsRef.current.forEach((s) => s());
    stopsRef.current = [];
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

  const cardSizeStyle = useMemo(() => {
    const cw =
      orderedDraws.length === 1
        ? clamp(Math.min(window.innerWidth - 120, (window.innerHeight - 210) / 1.4), 210, 272)
        : clamp(Math.min(window.innerHeight * 0.56, 400) * 0.69 * 0.88, 175, 240);
    return {
      '--pk-cw': `${cw.toFixed(1)}px`,
      '--pk-ch': `${(cw * 1.4).toFixed(1)}px`,
    } as CSSProperties;
  }, [handoff, orderedDraws.length]);

  const content = (
    <div
      ref={stageRef}
      className={`pk-portal ${portalMode === 'reveal' ? 'mode-reveal' : 'mode-pack'}`}
      role="dialog"
      aria-modal="true"
      aria-label={t('lottery.portalLabel')}
      style={cardSizeStyle}
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
            const faceDown = !flippedSet.has(idx);
            const landed = landedSet.has(idx);
            const revealed = landed && !faceDown;
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
                    if (faceDown) flipCard(idx);
                    else if (orderedDraws.length > 5) setInspectedIdx(isInspected ? null : idx);
                  }
                }}
              >
                <PrizeCard
                  draw={draw}
                  serial={idx + 1}
                  faceDown={faceDown}
                  revealed={revealed}
                  out={landed}
                  inspected={isInspected}
                  onClick={() => {
                    if (!spreadReady) return;
                    if (faceDown) {
                      flipCard(idx);
                    } else if (orderedDraws.length > 5) {
                      lotterySfx.tick();
                      setInspectedIdx(isInspected ? null : idx);
                    }
                  }}
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

      {/* Full-viewport FX canvases (confetti, sparks, lightning, gold coin rain) */}
      <canvas ref={fxMainRef} className="pk-fx-canvas" aria-hidden />
      <canvas ref={fxCoinsRef} className="pk-fx-canvas" aria-hidden />
      <canvas ref={fxBoltsRef} className="pk-fx-canvas" aria-hidden />
      <canvas ref={fxSparksRef} className="pk-fx-canvas" aria-hidden />
      {flash && <div className="lot-flash" aria-hidden />}
    </div>
  );

  return createPortal(content, document.body);
}
