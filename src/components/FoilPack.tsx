import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type CSSProperties } from 'react';
import markPath from '../../brand/dist/mark-path.json';
import type { Draw, LotteryBonus, LotteryStatus, Rarity } from '../api';
import { useI18n } from '../i18n';
import { lotterySfx } from '../lottery/lotterySound';
import { AURORA_BANDS, PACK_SKINS, RARITY_BANDS, bestRarity, type PackSkin } from '../lottery/packThemes';
import { Spring, clamp, createPose, rand, stepSprings } from '../lottery/spring';
import {
  TEAR_NOMINAL,
  TEAR_SEGMENTS,
  TEAR_SLICES,
  Y_MAX,
  computeTearGeometry,
  createRimSpecs,
  createTearPath,
  generateFoilCreases,
  randomPickExcluding,
  steerTearPath,
  type TearPath,
} from '../lottery/tearGeometry';

export type PackIdleState = 'ready' | 'locked' | 'empty';

export interface PackOpenResult {
  draws: Draw[];
  status: LotteryStatus;
}

export interface PackHandoff {
  draws: Draw[];
  status: LotteryStatus;
  count: number;
  skin: PackSkin;
  creases: { shine: string; shade: string };
  tearPath: TearPath;
  tearDir: 1 | -1;
  rect: { left: number; top: number; width: number; height: number };
  /** Whether triggered via keyboard so Portal can restore focus cleanly. */
  viaKey: boolean;
}

export interface FoilPackHandle {
  /** Programmatically rips the pack open (used by header Open 1 / Open N buttons). */
  triggerTear: (count?: number, viaKey?: boolean) => void;
}

interface FoilPackProps {
  mode: 'embedded' | 'portal';
  packState: PackIdleState;
  /** Number of packs queued for this tear (1..10). */
  packCount: number;
  /** Whether this pack is hidden (e.g. while Portal took over from embedded). */
  suspended?: boolean;
  /** Spin in from the right on mount (true for portal consecutive pulls). */
  enterFromRight?: boolean;
  /** Previous skin id to avoid repeating twice in a row. */
  excludeSkinId?: string;
  bonus?: LotteryBonus;
  dailyUnopened?: number;
  /** Called once tear crosses the commit point; must perform `api.lotteryOpen(count)`. */
  onCommitOpen: (count: number) => Promise<PackOpenResult>;
  /** Called once tear reaches 100% AND `onCommitOpen` resolved. */
  onOpened: (handoff: PackHandoff) => void;
  /** Called if `onCommitOpen` fails after commit so caller can show an error banner. */
  onError: (err: unknown) => void;
  /** Called when user tries to tap/drag a locked or empty pack. */
  onLockedTap?: () => void;
}

const [MARK_X, MARK_Y, MARK_W, MARK_H] = markPath.viewBox;
const RIMS = createRimSpecs();
const RIBBON_COUNT = 22;
const RIBBON_SPAN = 1200;
// Logical coordinate bounds matching the original SVG viewBox (x: -160..260, y: -260..100).
const RAYS_MIN_X = -160;
const RAYS_MIN_Y = -260;
const RAYS_W = 420;
const RAYS_H = 360;

const reducedMotion = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

const tintWhite = (hex: string, k: number) => {
  const c = (i: number) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - k) + 255 * k).toString(16).padStart(2, '0');
  return `#${c(1)}${c(3)}${c(5)}`;
};

/**
 * Interactive 3D metallic foil booster pack with steerable jagged tearing,
 * 12-slice curling foil strip exposing silver inner foil, Canvas 2D light ribbons
 * pouring out of the opening (zero SVG filter repaints), and a commit-threshold
 * API handoff that never consumes packs on aborted half-tears.
 */
export const FoilPack = forwardRef<FoilPackHandle, FoilPackProps>(function FoilPack(
  {
    mode,
    packState,
    packCount,
    suspended = false,
    enterFromRight = false,
    excludeSkinId,
    bonus,
    dailyUnopened = 0,
    onCommitOpen,
    onOpened,
    onError,
    onLockedTap,
  },
  ref,
) {
  const { t, lang } = useI18n();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  const [skin, setSkin] = useState<PackSkin>(() =>
    randomPickExcluding(
      PACK_SKINS,
      PACK_SKINS.find((s) => s.id === excludeSkinId),
    ),
  );
  const [creases, setCreases] = useState(() => generateFoilCreases());
  const [nudgeTick, setNudgeTick] = useState(0);

  // DOM refs mutated directly without React re-renders or inherited CSS variable invalidations.
  const wrapRef = useRef<HTMLDivElement>(null);
  const packRef = useRef<HTMLDivElement>(null);
  const groundRef = useRef<HTMLElement>(null);
  const frontSkinRef = useRef<HTMLDivElement>(null);
  const backSkinRef = useRef<HTMLDivElement>(null);
  const glintRef = useRef<HTMLElement>(null);
  const creaseShineRef = useRef<HTMLElement>(null);
  const bodyLipRef = useRef<HTMLElement>(null);
  const flapRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const raysCanvasRef = useRef<HTMLCanvasElement>(null);
  const starRef = useRef<HTMLDivElement>(null);
  const hitRef = useRef<HTMLButtonElement>(null);
  const rimRefs = useRef<(HTMLElement | null)[]>([]);
  const plyRefs = useRef<
    {
      el: HTMLDivElement | null;
      front: HTMLDivElement | null;
      foil: HTMLDivElement | null;
      lip: HTMLElement | null;
      shade: HTMLElement | null;
      under: HTMLElement | null;
    }[]
  >([]);

  // Mutable simulation state stored in refs for zero-GC 240Hz spring stepping.
  const simRef = useRef({
    state: (enterFromRight ? 'enter' : 'idle') as 'enter' | 'idle' | 'committing' | 'done',
    t: 0,
    lastNow: 0,
    nudgeAt: rand(4.5, 7.5),
    pw: 245,
    ph: 355,
    stageRect: null as null | { left: number; top: number; width: number; height: number },
    tearPath: createTearPath(TEAR_SEGMENTS),
    frozenSlices: new Array<boolean>(TEAR_SLICES).fill(false),
    rimTrimmed: new Array<boolean>(RIMS.length).fill(false),
    P: createPose({ x: 0, y: 0, rx: 0, ry: 0, rz: 0 }, 0.68, 0.28),
    star: createPose({ x: 0, y: 0 }, 0.18, 0.3),
    tearP: new Spring(0, 0.1, 0),
    tearTh: new Spring(0, 0.28, 0.35),
    tearPh: new Spring(0, 0.3, 0.2),
    squeeze: new Spring(0, 0.3, 0.45),
    glow: new Spring(0, 0.45, 0),
    allSprings: [] as Spring[],
    tearDir: 1 as 1 | -1,
    tearLast: 0,
    pointer: { x: 0, y: 0, in: false },
    drag: null as null | {
      id: number;
      x0: number;
      y0: number;
      p0: number;
      moved: boolean;
      dy: number;
      k: number;
      lx: number;
      lt: number;
    },
    wasDrag: false,
    viaKey: false,
    // Commit/API state
    commitCount: 1,
    committed: false,
    pendingResult: null as PackOpenResult | null,
    resolvedRarity: null as Rarity | null,
    // Canvas ribbon flow state
    ribbonPaletteKey: 'aurora',
    ribbons: [] as {
      mx: number;
      gx: number;
      r: number;
      L: number;
      on: boolean;
      len: number;
      g: Spring;
      col: string;
      hotCol: string;
      ux: number;
      uy: number;
      grad: CanvasGradient | null;
    }[],
    lines: [] as { ox: number; x: number; ux: number; uy: number; ph: number; r: number }[],
    motes: [] as { j: number; u: number; v: number; sp: number; r: number }[],
    raysCtx: null as CanvasRenderingContext2D | null,
    raysScale: 1,
    raysFadeGrad: null as CanvasGradient | null,
    raysVisible: false,
    Y0: 62.5,
    R0: 45,
    reach: 260,
    settleTimer: 0 as number | ReturnType<typeof setTimeout>,
  });

  // Latest props ref so RAF & pointer callbacks never close over stale values.
  const propsRef = useRef({
    packState,
    packCount,
    suspended,
    skin,
    creases,
    onCommitOpen,
    onOpened,
    onError,
    onLockedTap,
  });
  propsRef.current = {
    packState,
    packCount,
    suspended,
    skin,
    creases,
    onCommitOpen,
    onOpened,
    onError,
    onLockedTap,
  };

  const refreshSpringsList = () => {
    const sim = simRef.current;
    sim.allSprings = [
      sim.P.x,
      sim.P.y,
      sim.P.rx,
      sim.P.ry,
      sim.P.rz,
      sim.star.x,
      sim.star.y,
      sim.tearP,
      sim.tearTh,
      sim.tearPh,
      sim.squeeze,
      sim.glow,
      ...sim.ribbons.map((b) => b.g),
    ];
  };

  /** Builds or re-tints the Canvas 2D light ribbons tucked behind the front pouch face. */
  const rebuildRibbons = (palette: readonly string[], paletteKey: string, preserveActive = false) => {
    const canvas = raysCanvasRef.current;
    if (!canvas) return;
    const sim = simRef.current;
    const u = Math.max(1, sim.pw) / 100;
    const Y0 = 62.5 + ((Y_MAX - TEAR_NOMINAL) / 100) * (sim.ph / u);
    const CY = 107.5;
    const R0 = CY - Y0;
    const prevOn = preserveActive ? sim.ribbons.map((b) => b.on) : [];
    const prevG = preserveActive ? sim.ribbons.map((b) => b.g.x) : [];

    sim.Y0 = Y0;
    sim.R0 = R0;
    sim.ribbonPaletteKey = paletteKey;

    if (!preserveActive || sim.lines.length !== RIBBON_COUNT + 1) {
      sim.lines = Array.from({ length: RIBBON_COUNT + 1 }, (_, j) => {
        const ox = 3 + (94 * j) / RIBBON_COUNT;
        const x = 50 + ((ox - 50) * R0) / 45;
        const a = Math.atan2(x - 50, R0) + rand(-0.012, 0.012);
        return { ox, x, ux: Math.sin(a), uy: -Math.cos(a), ph: j * 0.36 + rand(-0.1, 0.1), r: Math.hypot(x - 50, R0) };
      });
    }

    const reduce = reducedMotion();
    const reach = reduce ? 90 : 280;
    sim.reach = reach;

    // Size ribbon canvas at crisp ~1.25x logical scale (soft light beams need zero 2x overhead).
    const dpr = Math.min(1.25, window.devicePixelRatio || 1);
    const scale = Math.max(1, Math.min(2.2, u * dpr));
    const targetW = Math.round(RAYS_W * scale);
    const targetH = Math.round(RAYS_H * scale);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    sim.raysScale = scale;
    const ctx = canvas.getContext('2d');
    sim.raysCtx = ctx;

    const hot = 26 + Y0 - 62.5;
    const k0 = Math.floor(rand(0, palette.length));
    sim.ribbons = Array.from({ length: RIBBON_COUNT }, (_, j) => {
      const r = (sim.lines[j].r + sim.lines[j + 1].r) / 2;
      const g = new Spring(prevG[j] ?? 0, 0.4, reduce ? 0 : 0.28);
      const col = palette[(j + k0) % palette.length];
      const hotCol = tintWhite(col, 0.72);
      const gx = (sim.lines[j].x + sim.lines[j + 1].x) / 2;
      const ux = (sim.lines[j].ux + sim.lines[j + 1].ux) / 2;
      const uy = (sim.lines[j].uy + sim.lines[j + 1].uy) / 2;
      let grad: CanvasGradient | null = null;
      if (ctx) {
        grad = ctx.createLinearGradient(gx, Y0, gx + ux * hot, Y0 + uy * hot);
        grad.addColorStop(0, hotCol);
        grad.addColorStop(1, col);
      }
      return {
        mx: (sim.lines[j].ox + sim.lines[j + 1].ox) / 2,
        gx,
        r,
        L: reach - r,
        on: prevOn[j] ?? false,
        len: 0,
        g,
        col,
        hotCol,
        ux,
        uy,
        grad,
      };
    });

    if (ctx) {
      const fade = ctx.createRadialGradient(50, Y0 + R0, 0, 50, Y0 + R0, RIBBON_SPAN);
      fade.addColorStop(0, 'rgba(255,255,255,0)');
      fade.addColorStop(0.04, 'rgba(255,255,255,1)');
      fade.addColorStop(0.11, 'rgba(255,255,255,1)');
      fade.addColorStop(0.18, 'rgba(255,255,255,0)');
      sim.raysFadeGrad = fade;
    }

    if (!preserveActive || sim.motes.length === 0) {
      sim.motes = Array.from({ length: 8 }, () => ({
        j: -1,
        u: Math.random(),
        v: rand(0.2, 0.8),
        sp: rand(0.32, 0.55),
        r: rand(1.4, 2.8),
      }));
    }

    refreshSpringsList();
  };

  /** Resets visual clips and simulation to a fresh sealed pack. */
  const resetPack = (freshAppearance: boolean, flyIn: boolean) => {
    const sim = simRef.current;
    clearTimeout(sim.settleTimer);
    if (freshAppearance) {
      const nextSkin = randomPickExcluding(PACK_SKINS, propsRef.current.skin);
      setSkin(nextSkin);
      setCreases(generateFoilCreases());
    }
    sim.tearPath = createTearPath(TEAR_SEGMENTS);
    sim.frozenSlices.fill(false);
    sim.rimTrimmed.fill(false);
    sim.committed = false;
    sim.pendingResult = null;
    sim.resolvedRarity = null;
    sim.drag = null;
    sim.wasDrag = false;
    sim.tearLast = 0;
    sim.tearDir = 1;
    sim.tearP.snap(0).set(0.1, 0);
    sim.tearTh.snap(0).set(0.28, 0.35);
    sim.tearPh.snap(0).set(0.3, 0.2);
    sim.squeeze.snap(0).set(0.3, 0.45);
    sim.glow.snap(0).set(0.45, 0);

    for (const sp of Object.values(sim.P)) sp.snap(0).set(0.68, 0.28);

    if (frontSkinRef.current) {
      frontSkinRef.current.style.clipPath = '';
      frontSkinRef.current.style.visibility = flyIn && !reducedMotion() ? 'hidden' : 'visible';
    }
    if (backSkinRef.current) {
      backSkinRef.current.style.clipPath = '';
      backSkinRef.current.style.visibility = flyIn && !reducedMotion() ? 'visible' : 'hidden';
    }
    if (bodyLipRef.current) bodyLipRef.current.style.clipPath = 'polygon(0 0)';
    if (flapRef.current) {
      flapRef.current.classList.remove('on');
      flapRef.current.style.transform = '';
    }
    if (packRef.current) packRef.current.classList.remove('pk-held', 'pk-hurt', 'pk-tug');
    if (raysCanvasRef.current) {
      raysCanvasRef.current.style.opacity = '0';
      raysCanvasRef.current.style.visibility = 'hidden';
      sim.raysVisible = false;
      if (sim.raysCtx) {
        sim.raysCtx.setTransform(1, 0, 0, 1, 0, 0);
        sim.raysCtx.clearRect(0, 0, raysCanvasRef.current.width, raysCanvasRef.current.height);
      }
    }
    for (let i = 0; i < RIMS.length; i++) {
      const el = rimRefs.current[i];
      if (el) el.style.top = `${RIMS[i].top}%`;
    }
    for (const p of plyRefs.current) {
      if (p?.el) {
        p.el.hidden = true;
        p.el.style.transform = '';
      }
    }

    rebuildRibbons(AURORA_BANDS, 'aurora', false);

    const reduce = reducedMotion();
    if (flyIn && !reduce) {
      sim.state = 'enter';
      sim.P.x.x = Math.min(window.innerWidth * 0.55, 520);
      sim.P.y.x = -46;
      sim.P.ry.x = -190;
      sim.P.rz.x = 15;
      lotterySfx.arrive();
      sim.settleTimer = setTimeout(() => {
        if (simRef.current.state === 'enter') simRef.current.state = 'idle';
      }, 920);
    } else {
      sim.state = 'idle';
    }
  };

  /** Applies jagged clip paths and 12-slice curling strip geometry at progress `p`. */
  const applyClips = (p: number) => {
    const sim = simRef.current;
    const geo = computeTearGeometry({
      points: sim.tearPath.points,
      progress: p,
      dir: sim.tearDir,
      slices: TEAR_SLICES,
      pw: sim.pw,
      roll: sim.tearPath.roll,
      velocity: sim.tearP.v,
      time: sim.t,
      frozenMask: sim.frozenSlices,
    });

    if (frontSkinRef.current) frontSkinRef.current.style.clipPath = geo.frontBodyClip;
    // Skip updating `backSkinRef` clipPath during tear: it's backface-hidden at 180deg while tearing.
    if (bodyLipRef.current) bodyLipRef.current.style.clipPath = geo.bodyLipClip;
    if (flapRef.current) flapRef.current.style.transformOrigin = geo.flapOrigin;

    // Trim each 3D side rim AT MOST ONCE when the tear passes the left or right edge.
    const xt = geo.xt;
    for (let i = 0; i < RIMS.length; i++) {
      if (sim.rimTrimmed[i]) continue;
      const r = RIMS[i];
      const el = rimRefs.current[i];
      if (!el) continue;
      const edgeX = r.side > 0 ? 100 : 0;
      if (sim.tearDir > 0 ? edgeX <= xt : edgeX >= xt) {
        const edgeY = sim.tearPath.points[r.side > 0 ? sim.tearPath.points.length - 1 : 0].y;
        el.style.top = `${Math.max(r.top, edgeY + 1.4).toFixed(2)}%`;
        sim.rimTrimmed[i] = true;
      }
    }

    for (let k = 0; k < TEAR_SLICES; k++) {
      const s = geo.slices[k];
      const dom = plyRefs.current[k];
      if (!dom?.el) continue;
      if (!s.visible) {
        if (!dom.el.hidden) dom.el.hidden = true;
        continue;
      }
      if (dom.el.hidden) dom.el.hidden = false;
      if (s.frontClip && dom.front && dom.foil && dom.lip) {
        dom.front.style.clipPath = s.frontClip;
        dom.foil.style.clipPath = s.foilClip ?? '';
        dom.lip.style.clipPath = s.lipClip ?? '';
      }
      if (s.frozen) sim.frozenSlices[k] = true;
      dom.el.style.transform = s.transform;
      if (dom.shade) dom.shade.style.opacity = String(s.frontShade);
      if (dom.under) dom.under.style.opacity = String(s.underShade);
    }
  };

  /** Begins the visual tear cues (flap visible, sparkle winces). */
  const startTearVisual = () => {
    const pack = packRef.current;
    const flap = flapRef.current;
    if (!pack || !flap) return;
    if (!pack.classList.contains('pk-hurt')) lotterySfx.tugStart();
    flap.classList.add('on');
    pack.classList.remove('pk-tug');
    pack.classList.add('pk-held', 'pk-hurt');
  };

  /** Commits the pack opening: calls `onCommitOpen` once and animates tear to completion. */
  const commitTear = (countOverride?: number, response = 0.22) => {
    const sim = simRef.current;
    if (sim.committed || sim.state === 'done') return;
    if (propsRef.current.packState !== 'ready') {
      lotterySfx.nope();
      setNudgeTick((n) => n + 1);
      propsRef.current.onLockedTap?.();
      return;
    }

    const count = Math.max(1, countOverride ?? propsRef.current.packCount);
    sim.committed = true;
    sim.commitCount = count;
    sim.state = 'committing';

    const reduce = reducedMotion();
    if (!reduce) {
      startTearVisual();
      sim.tearP.set(response, 0);
      sim.tearP.to = 1;
      sim.tearTh.to = rand(15, 29);
      sim.tearPh.to = -rand(22, 42);
    }

    propsRef.current
      .onCommitOpen(count)
      .then((res) => {
        if (!simRef.current.committed) return;
        simRef.current.pendingResult = res;
        const top = bestRarity(res.draws);
        simRef.current.resolvedRarity = top;

        // Rarity foreshadowing! Shift the pouring light ribbons to the true rarity palette.
        if (!reduce && (top === 'rare' || top === 'epic' || top === 'legendary')) {
          rebuildRibbons(RARITY_BANDS[top], top, true);
        }

        if (reduce) {
          completeHandoff(res);
        }
      })
      .catch((err) => {
        lotterySfx.rip(0);
        lotterySfx.nope();
        resetPack(false, false);
        propsRef.current.onError(err);
      });
  };

  const completeHandoff = (res: PackOpenResult) => {
    const sim = simRef.current;
    if (sim.state === 'done') return;
    sim.state = 'done';
    lotterySfx.rip(0);

    if (sim.drag && hitRef.current?.hasPointerCapture(sim.drag.id)) {
      try {
        hitRef.current.releasePointerCapture(sim.drag.id);
      } catch {
        /* ignore */
      }
    }
    sim.drag = null;

    const r = packRef.current?.getBoundingClientRect();
    const rect = r
      ? { left: r.left, top: r.top, width: r.width, height: r.height }
      : { left: window.innerWidth / 2 - 125, top: window.innerHeight / 2 - 180, width: 250, height: 360 };

    const topRarity = bestRarity(res.draws);
    lotterySfx.pop(topRarity, !reducedMotion());

    propsRef.current.onOpened({
      draws: res.draws,
      status: res.status,
      count: sim.commitCount,
      skin: propsRef.current.skin,
      creases: propsRef.current.creases,
      tearPath: sim.tearPath,
      tearDir: sim.tearDir,
      rect,
      viaKey: sim.viaKey,
    });
  };

  // Expose imperative trigger for header "Tear 1 / Tear N" buttons.
  useImperativeHandle(ref, () => ({
    triggerTear(count?: number, viaKey = false) {
      const sim = simRef.current;
      if (sim.committed || propsRef.current.suspended) return;
      lotterySfx.unlock();
      sim.viaKey = viaKey;
      if (sim.state === 'enter') {
        clearTimeout(sim.settleTimer);
        sim.state = 'idle';
      }
      if (!sim.tearP.to) sim.tearDir = Math.random() < 0.5 ? -1 : 1;
      commitTear(count, sim.tearP.to > 0 ? 0.18 : 0.44);
    },
  }));

  // Reset to a fresh pack whenever returning from suspended Portal state (embedded mode).
  const wasSuspended = useRef(suspended);
  useEffect(() => {
    if (wasSuspended.current && !suspended) {
      resetPack(true, false);
    }
    wasSuspended.current = suspended;
  }, [suspended]);

  // Initial mount setup + ResizeObserver + main animation loop (pauses completely when suspended).
  useEffect(() => {
    if (suspended) return;
    const sim = simRef.current;

    const measure = () => {
      if (packRef.current) {
        sim.pw = packRef.current.offsetWidth || 245;
        sim.ph = packRef.current.offsetHeight || 355;
      }
      if (wrapRef.current) {
        const r = wrapRef.current.getBoundingClientRect();
        sim.stageRect = { left: r.left, top: r.top, width: r.width, height: r.height };
      }
    };
    measure();
    if (sim.allSprings.length === 0) {
      resetPack(false, enterFromRight);
    }

    const ro = new ResizeObserver(measure);
    if (packRef.current) ro.observe(packRef.current);
    if (wrapRef.current) ro.observe(wrapRef.current);

    const onGlobalMove = (e: globalThis.PointerEvent) => {
      if (!sim.pointer.in) measure();
      sim.pointer.x = e.clientX;
      sim.pointer.y = e.clientY;
      sim.pointer.in = true;
    };
    const onGlobalLeave = () => {
      sim.pointer.in = false;
    };
    window.addEventListener('pointermove', onGlobalMove, { passive: true });
    window.addEventListener('resize', measure, { passive: true });
    window.addEventListener('scroll', measure, { passive: true, capture: true });
    document.documentElement.addEventListener('pointerleave', onGlobalLeave);

    let rafId = 0;
    sim.lastNow = performance.now();

    const drawRibbons = (dt: number) => {
      const canvas = raysCanvasRef.current;
      const ctx = sim.raysCtx;
      if (!canvas || !ctx) return;

      const reduce = reducedMotion();
      const ft = reduce ? 0 : sim.t;
      const xt = sim.tearDir > 0 ? sim.tearP.x * 100 : 100 - sim.tearP.x * 100;
      const sway = Math.sin(ft * 0.9) * 1.4;

      let anyActive = false;
      for (const b of sim.ribbons) {
        if (sim.tearP.x > 0 && (sim.tearDir > 0 ? b.mx < xt : b.mx > xt)) b.on = true;
        b.g.to = b.on ? 1 : 0;
        b.len = b.L * Math.max(0, b.g.x);
        if (b.len > 0.5) anyActive = true;
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!anyActive) return;

      const scale = sim.raysScale;
      ctx.setTransform(scale, 0, 0, scale, -RAYS_MIN_X * scale, -RAYS_MIN_Y * scale);

      const step = 7;
      const at = (j: number, d: number, out: [number, number]): void => {
        const e = sim.lines[j];
        const k = d < 90 ? d / 90 : 1;
        const w = (0.4 + 2 * k) * Math.sin((d / 22 - ft * 1.45) * 2 * Math.PI + e.ph) + sway * k;
        out[0] = e.x + e.ux * d - e.uy * w;
        out[1] = sim.Y0 + e.uy * d + e.ux * w;
      };

      const lineCount = sim.lines.length;
      const edgesX: number[][] = new Array(lineCount);
      const edgesY: number[][] = new Array(lineCount);
      const pt: [number, number] = [0, 0];

      for (let j = 0; j < lineCount; j++) {
        const len = Math.max(sim.ribbons[j - 1]?.len || 0, sim.ribbons[j]?.len || 0);
        const xs: number[] = [];
        const ys: number[] = [];
        if (len > 0.5) {
          for (let i = 0; ; i++) {
            const d = Math.min(i * step, len);
            at(j, d, pt);
            xs.push(pt[0]);
            ys.push(pt[1]);
            if (d >= len) break;
          }
        }
        edgesX[j] = xs;
        edgesY[j] = ys;
      }

      // 1. Filled iridescent color ribbons.
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      for (let j = 0; j < sim.ribbons.length; j++) {
        const b = sim.ribbons[j];
        if (b.len <= 0.5) continue;
        const maxPts = Math.ceil(b.len / step) + 1;
        const ax = edgesX[j];
        const ay = edgesY[j];
        const bx = edgesX[j + 1];
        const by = edgesY[j + 1];
        const na = Math.min(ax.length, maxPts);
        const nb = Math.min(bx.length, maxPts);
        if (na < 2 || nb < 2) continue;

        ctx.beginPath();
        ctx.moveTo(ax[0], ay[0]);
        for (let i = 1; i < na; i++) ctx.lineTo(ax[i], ay[i]);
        for (let i = nb - 1; i >= 0; i--) ctx.lineTo(bx[i], by[i]);
        ctx.closePath();
        ctx.fillStyle = b.grad ?? b.col;
        ctx.fill();
      }

      // 2. Soft luminous edge highlights (emulates subtle bloom without SVG feGaussianBlur!).
      ctx.beginPath();
      for (let j = 0; j < lineCount; j++) {
        const xs = edgesX[j];
        const ys = edgesY[j];
        if (xs.length < 2) continue;
        ctx.moveTo(xs[0], ys[0]);
        for (let i = 1; i < xs.length; i++) ctx.lineTo(xs[i], ys[i]);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.62)';
      ctx.lineWidth = 0.45;
      ctx.stroke();

      // 3. Floating glowing motes inside active ribbons.
      const activeIndices: number[] = [];
      for (let j = 0; j < sim.ribbons.length; j++) {
        if (sim.ribbons[j].on && sim.ribbons[j].len > 2) activeIndices.push(j);
      }
      if (activeIndices.length > 0) {
        const p1: [number, number] = [0, 0];
        const p2: [number, number] = [0, 0];
        for (const m of sim.motes) {
          if (!reduce) m.u += dt * m.sp;
          if (m.u > 1 || !sim.ribbons[m.j]?.on) {
            if (m.u > 1) m.u -= 1;
            m.j = activeIndices[Math.floor(rand(0, activeIndices.length))];
          }
          const len = sim.ribbons[m.j].len;
          const d = m.u * len;
          at(m.j, d, p1);
          at(m.j + 1, d, p2);
          const mx = p1[0] + (p2[0] - p1[0]) * m.v;
          const my = p1[1] + (p2[1] - p1[1]) * m.v;
          const mr = m.r * (0.6 + m.u * 0.7);
          const ma = Math.sin(Math.PI * m.u) * Math.min(1, len / 18);
          if (ma > 0.02) {
            ctx.fillStyle = `rgba(255,255,255,${(ma * 0.35).toFixed(2)})`;
            ctx.beginPath();
            ctx.arc(mx, my, mr * 2.1, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = `rgba(255,255,255,${ma.toFixed(2)})`;
            ctx.beginPath();
            ctx.arc(mx, my, mr * 0.75, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // 4. Radial fade mask matching the original SVG <mask id="fade">.
      if (sim.raysFadeGrad) {
        ctx.globalCompositeOperation = 'destination-in';
        ctx.fillStyle = sim.raysFadeGrad;
        ctx.fillRect(RAYS_MIN_X, RAYS_MIN_Y, RAYS_W, RAYS_H);
        ctx.globalCompositeOperation = 'source-over';
      }
    };

    const tick = (now: number) => {
      rafId = requestAnimationFrame(tick);
      if (document.hidden || propsRef.current.suspended || sim.state === 'done') {
        sim.lastNow = now;
        return;
      }

      // Whisper-quiet 30fps ambient bob when completely idle and pointer isn't nearby.
      const isCalm =
        sim.state === 'idle' &&
        !sim.drag &&
        sim.tearP.x === 0 &&
        !sim.pointer.in &&
        Math.abs(sim.P.ry.v) < 0.5 &&
        Math.abs(sim.P.rx.v) < 0.5;
      if (isCalm && now - sim.lastNow < 32) return;

      const dt = Math.min(0.05, Math.max(0.001, (now - sim.lastNow) / 1000));
      sim.lastNow = now;
      sim.t += dt;

      const reduce = reducedMotion();
      const motion = reduce ? 0 : 1;
      const isReady = propsRef.current.packState === 'ready';
      const held = !!packRef.current?.classList.contains('pk-held');

      const tug =
        motion && sim.drag?.moved && !sim.tearP.to
          ? Math.sign(sim.drag.dy) * 140 * (1 - 1 / (1 + Math.abs(sim.drag.dy) / 140))
          : 0;
      sim.squeeze.to = tug ? -Math.abs(tug) / 90 : held ? motion : 0;

      // Pointer coordinates relative to cached stage rect (ZERO getBoundingClientRect in rAF!).
      const stageRect = sim.stageRect;
      let nx = 0;
      let ny = 0;
      if (stageRect && sim.pointer.in) {
        const cx = stageRect.left + stageRect.width / 2;
        const cy = stageRect.top + stageRect.height / 2;
        nx = clamp((sim.pointer.x - cx) / Math.max(220, stageRect.width * 0.5), -1, 1);
        ny = clamp((sim.pointer.y - cy) / Math.max(220, stageRect.height * 0.5), -1, 1);
      }

      const holdFactor = sim.drag?.moved ? 0.25 : 1;
      const tilt = holdFactor * (reduce ? 0.35 : isReady ? 1 : 0.45);
      sim.P.y.to = Math.sin(sim.t * 1.4) * (isReady ? 6.5 : 3) * motion + tug;
      sim.P.ry.to = nx * 21 * tilt;
      sim.P.rx.to = -ny * 15 * tilt - sim.squeeze.x * 6;
      sim.P.rz.to =
        Math.sin(sim.t * 0.9) * (isReady ? 1.5 : 0.6) * motion -
        (held && sim.tearP.x > 0 ? sim.tearDir * sim.tearP.x * 3 : 0);

      // Gentle playful wiggle nudge when ready & untouched.
      if (sim.state === 'idle' && isReady && !sim.drag && sim.tearP.to < 1 && motion && sim.t > sim.nudgeAt) {
        sim.P.rz.v += (Math.random() < 0.5 ? -1 : 1) * 58;
        if (sim.tearP.to > 0) sim.tearTh.v += 110;
        sim.nudgeAt = sim.t + rand(4.5, 7.5);
      }

      // Living sparkle tracks cursor subtly.
      const kStar = sim.pointer.in ? Math.min(1, Math.hypot(nx, ny)) * sim.pw * 0.018 : 0;
      const ang = Math.atan2(ny, nx);
      sim.star.x.to = Math.cos(ang) * kStar;
      sim.star.y.to = Math.sin(ang) * kStar;

      // Hold tear just shy of 100% if API is still in flight so the pack pulses with energy instead of freezing post-rip.
      if (sim.state === 'committing' && !sim.pendingResult && sim.tearP.to >= 1) {
        if (sim.tearP.x > 0.91) {
          sim.tearP.to = 0.93;
        }
      } else if (sim.state === 'committing' && sim.pendingResult && sim.tearP.to < 1) {
        sim.tearP.set(0.14, 0);
        sim.tearP.to = 1;
      }

      stepSprings(sim.allSprings, dt);

      if (sim.tearP.x > 0.001) {
        const p = Math.min(1, sim.tearP.x);
        const dp = p - sim.tearLast;
        sim.tearLast = p;
        lotterySfx.rip(dp > 0 ? (dp / Math.max(dt, 0.004) / 4) ** 0.6 : 0);
        if (dp > 0 && motion) {
          sim.P.rz.v += rand(-1, 1) * Math.min(dp, 0.02) * 840;
          sim.P.y.v += dp * 380;
          sim.tearTh.v += dp * 280;
          sim.squeeze.v += dp * 18;
          for (const b of sim.ribbons) if (b.on) b.g.v += dp * 6;
        }
        if (dp > 0 || Math.abs(sim.tearP.v) > 0.001) {
          applyClips(p);
        }
        const draft = sim.drag ? 0 : motion * (Math.sin(sim.t * 5.3) + Math.sin(sim.t * 8.7) * 0.5);
        if (flapRef.current) {
          flapRef.current.style.transform = `rotateZ(${(sim.tearTh.x + draft) * sim.tearDir}deg) rotateX(${sim.tearPh.x + draft * 1.5}deg)`;
        }
        if (sim.state === 'committing' && p >= 0.985 && sim.pendingResult) {
          completeHandoff(sim.pendingResult);
          return;
        }
      } else {
        lotterySfx.rip(0);
      }

      sim.glow.to = sim.tearP.x > 0.01 ? 1 : 0;
      const raysEl = raysCanvasRef.current;
      if (raysEl) {
        if (sim.glow.x > 0.003 || sim.glow.to > 0) {
          if (!sim.raysVisible) {
            raysEl.style.visibility = 'visible';
            sim.raysVisible = true;
          }
          raysEl.style.opacity = sim.glow.x.toFixed(3);
          drawRibbons(dt);
        } else if (sim.raysVisible) {
          raysEl.style.opacity = '0';
          raysEl.style.visibility = 'hidden';
          sim.raysVisible = false;
        }
      }

      const packEl = packRef.current;
      if (packEl) {
        const transform = `translate3d(${sim.P.x.x.toFixed(2)}px,${sim.P.y.x.toFixed(2)}px,0) rotateX(${sim.P.rx.x.toFixed(2)}deg) rotateY(${sim.P.ry.x.toFixed(2)}deg) rotateZ(${sim.P.rz.x.toFixed(2)}deg) scale3d(${(1 + 0.03 * sim.squeeze.x).toFixed(4)},${(1 - 0.06 * sim.squeeze.x).toFixed(4)},1)`;
        packEl.style.transform = transform;
        if (flowRef.current && sim.raysVisible) flowRef.current.style.transform = transform;

        // Explicitly toggle front/back visibility by Y angle because WebKit's `-webkit-mask`
        // breaks `backface-visibility: hidden` inside `preserve-3d`, letting `.pk-back-skin` bleed through.
        const normRy = Math.abs((((sim.P.ry.x % 360) + 540) % 360) - 180);
        const showBack = normRy > 90;
        if (backSkinRef.current) {
          const want = showBack ? 'visible' : 'hidden';
          if (backSkinRef.current.style.visibility !== want) backSkinRef.current.style.visibility = want;
        }
        if (frontSkinRef.current) {
          const want = showBack ? 'hidden' : 'visible';
          if (frontSkinRef.current.style.visibility !== want) frontSkinRef.current.style.visibility = want;
        }

        // Pure GPU transform/opacity updates on leaf specular layers (ZERO CSS variable mutations!).
        if (glintRef.current) {
          const gx = clamp(-sim.P.ry.x * 0.12, -1.5, 3);
          const gl = clamp(0.82 - sim.P.ry.x * 0.012, 0.45, 1);
          glintRef.current.style.transform = `translate3d(${gx.toFixed(2)}%,0,0)`;
          glintRef.current.style.opacity = gl.toFixed(2);
        }
        if (creaseShineRef.current) {
          const gt = clamp(0.86 + sim.P.rx.x * 0.015, 0.5, 1);
          creaseShineRef.current.style.opacity = gt.toFixed(2);
        }
      }

      if (starRef.current) {
        starRef.current.style.transform = `translate3d(${sim.star.x.x.toFixed(2)}px,${sim.star.y.x.toFixed(2)}px,0)`;
      }

      if (groundRef.current) {
        const sc = clamp(1 - sim.P.y.x / 300, 0.72, 1.15);
        groundRef.current.style.transform = `translate3d(${sim.P.x.x.toFixed(2)}px,${(sim.ph / 2 + 22).toFixed(1)}px,0) scale(${sc.toFixed(3)})`;
        groundRef.current.style.opacity = clamp(1 - Math.abs(sim.P.x.x) / 300, 0, 1).toFixed(3);
      }
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(sim.settleTimer);
      ro.disconnect();
      window.removeEventListener('pointermove', onGlobalMove);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      document.documentElement.removeEventListener('pointerleave', onGlobalLeave);
      lotterySfx.rip(0);
    };
  }, [uid, suspended]);

  // Pointer interaction handlers on the hit button.
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const sim = simRef.current;
    sim.viaKey = false;
    if (e.button !== 0 || sim.drag || sim.committed) return;
    lotterySfx.unlock();
    if (wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      sim.stageRect = { left: r.left, top: r.top, width: r.width, height: r.height };
    }

    if (packState !== 'ready') {
      lotterySfx.nope();
      setNudgeTick((n) => n + 1);
      onLockedTap?.();
      return;
    }

    if (sim.state === 'enter') {
      clearTimeout(sim.settleTimer);
      sim.state = 'idle';
      sim.squeeze.v -= 6;
      for (const sp of Object.values(sim.P)) sp.set(0.28, 0.25);
    }
    if (sim.state !== 'idle') return;

    e.currentTarget.setPointerCapture(e.pointerId);
    lotterySfx.grab();
    sim.drag = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      p0: sim.tearP.to,
      moved: false,
      dy: 0,
      k: 0,
      lx: e.clientX,
      lt: e.timeStamp,
    };
  };

  const releaseDrag = (e?: { pointerId?: number }) => {
    const sim = simRef.current;
    if (!sim.drag || (e?.pointerId !== undefined && e.pointerId !== sim.drag.id)) return;
    sim.wasDrag = sim.drag.moved;
    sim.drag = null;
    if (!sim.wasDrag || sim.state !== 'idle') return;

    // Commit threshold: releasing past 55% commits the API open and finishes the rip!
    if (sim.tearP.to > 0.55) {
      commitTear(undefined, 0.18);
      return;
    }

    const wasHurt = !!packRef.current?.classList.contains('pk-hurt');
    if (wasHurt) lotterySfx.phew();
    else lotterySfx.boing();
    packRef.current?.classList.remove('pk-held', 'pk-hurt', 'pk-tug');
    sim.tearTh.to = 3 + sim.tearP.to * 10;
    sim.tearPh.to = -sim.tearP.to * 14;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const sim = simRef.current;
    if (!sim.drag || e.pointerId !== sim.drag.id || sim.state !== 'idle') return;
    if (e.pointerType === 'mouse' && !e.buttons) {
      releaseDrag(e);
      return;
    }

    const dx = e.clientX - sim.drag.x0;
    let dy = e.clientY - sim.drag.y0;
    if (!sim.drag.moved) {
      if (Math.hypot(dx, dy) < 6) return;
      sim.drag.moved = true;
      sim.tearP.set(0.1, 0);
      packRef.current?.classList.add('pk-tug');
    }

    if (sim.tearP.to === 0) {
      sim.drag.dy = dy;
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 0.5) return;
      sim.tearDir = dx < 0 ? -1 : 1;
      sim.drag.y0 = e.clientY;
      dy = 0;
    }

    startTearVisual();
    const nextP = clamp(sim.drag.p0 + (sim.drag.p0 ? Math.abs(dx) : dx * sim.tearDir) / (sim.pw * 0.85), sim.tearP.to, 1);
    sim.tearP.to = nextP;
    sim.tearTh.to = 6 + nextP * 14 + clamp(-dy * 0.16, -6, 22);
    sim.tearPh.to = -(8 + nextP * 22) - clamp(-dy * 0.2, 0, 24);
    sim.drag.lx = e.clientX;
    sim.drag.lt = e.timeStamp;
    sim.drag.k += (clamp(dy / Math.max(60, Math.abs(dx)), -0.7, 0.7) * (sim.pw / sim.ph) - sim.drag.k) * 0.3;
    steerTearPath(sim.tearPath.points, sim.tearP.x, sim.tearDir, sim.drag.k);

    // Crossing 68% while dragging fires the API early so the tear completes with zero stall!
    if (nextP >= 0.68 && !sim.committed) {
      commitTear(undefined, 0.16);
    }
  };

  const onClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const sim = simRef.current;
    if (sim.wasDrag && e.detail) {
      sim.wasDrag = false;
      return;
    }
    if (sim.committed) return;
    lotterySfx.unlock();
    if (packState !== 'ready') {
      lotterySfx.nope();
      setNudgeTick((n) => n + 1);
      onLockedTap?.();
      return;
    }
    if (sim.state === 'enter') {
      clearTimeout(sim.settleTimer);
      sim.state = 'idle';
    }
    if (sim.state !== 'idle') return;
    sim.viaKey = e.detail === 0;
    if (!sim.tearP.to) sim.tearDir = Math.random() < 0.5 ? -1 : 1;
    commitTear(undefined, sim.tearP.to > 0 ? 0.18 : 0.48);
  };

  const packStyle = useMemo(
    () =>
      ({
        '--pack': packState === 'ready' ? skin.pack : packState === 'locked' ? '#63687a' : '#7a7e8a',
        '--pack-accent': skin.accent,
        '--shine': creases.shine,
        '--shade': creases.shade,
      }) as CSSProperties,
    [skin, creases, packState],
  );

  const pityHot = packState === 'ready' && !!bonus && bonus.pity_epic >= 2 && bonus.pity_left <= 3;
  const firstBoost = packState === 'ready' && !!bonus && bonus.first_open_boost > 1 && bonus.first_open_ready;
  const batchGuarantee = packState === 'ready' && !!bonus && bonus.batch_rare >= 2 && packCount >= bonus.batch_rare;
  const isStacked = packState === 'ready' && packCount > 1;
  const editionLabel = lang === 'zh-CN' ? skin.zhName : skin.name;
  const tearLabel = t('lottery.tearHere');
  const cardsText = t('lottery.packCards', { n: packCount });
  const hitAriaLabel =
    packState === 'ready' ? t('lottery.packAriaReady', { n: packCount }) : t('lottery.noChests');

  return (
    <div ref={wrapRef} className={`pk-wrap pk-mode-${mode} ${suspended ? 'pk-suspended' : ''}`}>
      <i ref={groundRef} className="pk-ground" aria-hidden />
      <div className="pk-scene">
        {/* Stacked silhouette packs behind the hero pack when batch opening (×2..×10). */}
        {isStacked && (
          <div className="pk-stack-ghosts" style={packStyle} aria-hidden>
            <i className="pk-ghost pk-ghost-2" />
            <i className="pk-ghost pk-ghost-1" />
          </div>
        )}

        {/* Live Canvas 2D light ribbon flow sitting physically behind the front skin. */}
        <div ref={flowRef} className="pk-flow" aria-hidden>
          <canvas ref={raysCanvasRef} className="pk-rays" />
        </div>

        <div
          ref={packRef}
          className={`pk-pack state-${packState} ${pityHot ? 'is-pity-hot' : ''}`}
          style={packStyle}
        >
          <div key={nudgeTick} className={`pk-nudge-layer ${nudgeTick > 0 ? 'pk-nudge' : ''}`}>
            {/* ---- Front pouch face ---- */}
            <div ref={frontSkinRef} className="pk-skin pk-front" aria-hidden>
              <i ref={glintRef} className="pk-glint" />
              <i ref={creaseShineRef} className="pk-crease-shine" />
              <span className="pk-tag">{tearLabel}</span>
              <span className="pk-tear-guide" />
              <span className="pk-lips">
                <i ref={bodyLipRef} className="pk-lip" />
              </span>

              <div className="pk-brand-row">
                <b className="pk-mark-word">cloudborne</b>
                <span className="pk-series">{editionLabel}</span>
              </div>

              {firstBoost && (
                <span className="pk-boost-sticker">
                  {t('lottery.firstSticker', { x: bonus.first_open_boost })}
                </span>
              )}

              {packState === 'ready' && dailyUnopened > 0 && !firstBoost && (
                <span className="pk-daily-sticker">{t('lottery.dailySticker')}</span>
              )}

              {/* Embossed Cloudborne cloud + living sparkle core */}
              <div className="pk-orb">
                <svg
                  className="pk-orb-shade"
                  viewBox={`${MARK_X} ${MARK_Y} ${MARK_W} ${MARK_H}`}
                  fill="#000"
                >
                  <path fillRule="evenodd" d={markPath.d} />
                </svg>
                <svg
                  className="pk-orb-body"
                  viewBox={`${MARK_X} ${MARK_Y} ${MARK_W} ${MARK_H}`}
                >
                  <defs>
                    <linearGradient id={`${uid}-chrome`} x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#ffffff" />
                      <stop offset="32%" stopColor={skin.accent} />
                      <stop offset="56%" stopColor="#ffffff" />
                      <stop offset="82%" stopColor="#ffd7ea" />
                      <stop offset="100%" stopColor="#fff3d6" />
                    </linearGradient>
                  </defs>
                  <path fillRule="evenodd" d={markPath.d} fill={`url(#${uid}-chrome)`} />
                </svg>
                {/* Living 4-point sparkle core aligned to the exact geometric center of markPath's cutout */}
                <div className="pk-core-star-anchor">
                  <div ref={starRef} className="pk-core-star">
                    <svg viewBox="0 0 40 40" className="pk-core-star-svg">
                      <path
                        d="M20 2c1.6 11.2 6.8 16.4 18 18-11.2 1.6-16.4 6.8-18 18-1.6-11.2-6.8-16.4-18-18 11.2-1.6 16.4-6.8 18-18z"
                        fill="#fff"
                      />
                    </svg>
                  </div>
                </div>

                {packState === 'locked' && (
                  <div className="pk-lock-badge">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="5" y="11" width="14" height="10" rx="2.5" />
                      <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
                    </svg>
                  </div>
                )}
              </div>

              {pityHot && !isStacked && (
                <div className="pk-pity-ribbon">
                  {t('lottery.pityRibbon', { n: bonus.pity_left })}
                </div>
              )}

              {isStacked && (
                <div className="pk-batch-band">
                  <b>×{packCount}</b>
                  {batchGuarantee && <span>{t('lottery.batchBand')}</span>}
                </div>
              )}

              <span className="pk-foot-l">Cloudborne</span>
              <span className="pk-foot-r">{cardsText}</span>
            </div>

            {/* ---- Back pouch face (visible only while >90deg during spin-in; hidden otherwise for WebKit mask compatibility) ---- */}
            <div ref={backSkinRef} className="pk-skin pk-back-skin" style={{ visibility: enterFromRight ? 'visible' : 'hidden' }} aria-hidden>
              <i className="pk-fin" />
              <b className="pk-mark-word sm">cloudborne</b>
              <p className="pk-blurb">
                {t('lottery.packBackLine1')}
                <br />
                {t('lottery.packBackLine2')}
              </p>
              <i className="pk-barcode" />
            </div>

            {/* ---- 18 stacked 3D side rims giving rounded pillow thickness ---- */}
            {RIMS.map((r, idx) => (
              <i
                key={idx}
                ref={(el) => {
                  rimRefs.current[idx] = el;
                }}
                className="pk-rim"
                style={{
                  [r.side > 0 ? 'left' : 'right']: `calc(50% + var(--pw) * 0.476 - ${r.offsetPx}px)`,
                  width: `${r.width}px`,
                  top: `${r.top}%`,
                  bottom: `${r.top}%`,
                  transform: `translateZ(calc(var(--d) * ${r.zFactor}))`,
                  clipPath: r.clipPath,
                  background: `color-mix(in srgb, var(--pack), ${r.tone})`,
                }}
                aria-hidden
              />
            ))}

            {/* ---- 12-slice curling tear strip showing metallic silver inner foil ---- */}
            <div ref={flapRef} className="pk-flap" aria-hidden>
              {Array.from({ length: TEAR_SLICES }, (_, k) => (
                <div
                  key={k}
                  ref={(el) => {
                    if (!plyRefs.current[k]) {
                      plyRefs.current[k] = { el: null, front: null, foil: null, lip: null, shade: null, under: null };
                    }
                    plyRefs.current[k].el = el;
                  }}
                  className="pk-ply"
                  hidden
                >
                  <div
                    ref={(el) => {
                      if (plyRefs.current[k]) plyRefs.current[k].front = el;
                    }}
                    className="pk-skin pk-front"
                  >
                    <span className="pk-tag">{tearLabel}</span>
                    <i
                      ref={(el) => {
                        if (plyRefs.current[k]) plyRefs.current[k].lip = el;
                      }}
                      className="pk-lip"
                    />
                    <i
                      ref={(el) => {
                        if (plyRefs.current[k]) plyRefs.current[k].shade = el;
                      }}
                      className="pk-tone"
                    />
                  </div>
                  <div
                    ref={(el) => {
                      if (plyRefs.current[k]) plyRefs.current[k].foil = el;
                    }}
                    className="pk-skin pk-foil"
                  >
                    <i
                      ref={(el) => {
                        if (plyRefs.current[k]) plyRefs.current[k].under = el;
                      }}
                      className="pk-tone"
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* ---- Interactive grab/tear/click hitbox ---- */}
            <button
              ref={hitRef}
              type="button"
              className={`pk-hit ${packState === 'ready' ? 'is-ready' : ''}`}
              aria-label={hitAriaLabel}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={releaseDrag}
              onPointerCancel={releaseDrag}
              onLostPointerCapture={releaseDrag}
              onClick={onClick}
            />
          </div>
        </div>
      </div>
    </div>
  );
});
