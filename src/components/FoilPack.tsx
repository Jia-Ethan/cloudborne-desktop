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
const RIBBON_COUNT = 26;
const RIBBON_SPAN = 1200;

const reducedMotion = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

const tintWhite = (hex: string, k: number) => {
  const c = (i: number) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - k) + 255 * k).toString(16).padStart(2, '0');
  return `#${c(1)}${c(3)}${c(5)}`;
};

/**
 * Interactive 3D metallic foil booster pack with steerable 96-segment jagged tearing,
 * 12-slice curling foil strip exposing silver inner foil, live SVG light ribbons
 * pouring out of the opening, and a commit-threshold API handoff that never
 * consumes packs on aborted half-tears.
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

  // DOM refs mutated directly at 60/120fps without React re-renders.
  const wrapRef = useRef<HTMLDivElement>(null);
  const packRef = useRef<HTMLDivElement>(null);
  const groundRef = useRef<HTMLElement>(null);
  const frontSkinRef = useRef<HTMLDivElement>(null);
  const backSkinRef = useRef<HTMLDivElement>(null);
  const bodyLipRef = useRef<HTMLElement>(null);
  const flapRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const raysSvgRef = useRef<SVGSVGElement>(null);
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
    tearPath: createTearPath(TEAR_SEGMENTS),
    frozenSlices: new Array<boolean>(TEAR_SLICES).fill(false),
    P: createPose({ x: 0, y: 0, rx: 0, ry: 0, rz: 0 }, 0.68, 0.28),
    star: createPose({ x: 0, y: 0 }, 0.18, 0.3),
    tearP: new Spring(0, 0.1, 0),
    tearTh: new Spring(0, 0.28, 0.35),
    tearPh: new Spring(0, 0.3, 0.2),
    squeeze: new Spring(0, 0.3, 0.45),
    glow: new Spring(0, 0.45, 0),
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
    // Ribbon flow state
    ribbonPaletteKey: 'aurora',
    ribbons: [] as {
      mx: number;
      gx: number;
      r: number;
      L: number;
      on: boolean;
      len: number;
      g: Spring;
    }[],
    lines: [] as { ox: number; x: number; ux: number; uy: number; ph: number; r: number }[],
    bandEls: [] as SVGPathElement[],
    edgeEls: [] as SVGPathElement[],
    motes: [] as { el: SVGCircleElement; j: number; u: number; v: number; sp: number; r: number }[],
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

  /** Builds or re-tints the SVG light ribbons tucked behind the front pouch face. */
  const rebuildRibbons = (palette: readonly string[], paletteKey: string, preserveActive = false) => {
    const svg = raysSvgRef.current;
    if (!svg) return;
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

    const k0 = Math.floor(rand(0, palette.length));
    sim.ribbons = Array.from({ length: RIBBON_COUNT }, (_, j) => {
      const r = (sim.lines[j].r + sim.lines[j + 1].r) / 2;
      const g = new Spring(prevG[j] ?? 0, 0.4, reduce ? 0 : 0.28);
      return {
        mx: (sim.lines[j].ox + sim.lines[j + 1].ox) / 2,
        gx: (sim.lines[j].x + sim.lines[j + 1].x) / 2,
        r,
        L: reach - r,
        on: prevOn[j] ?? false,
        len: 0,
        g,
      };
    });

    const hot = 26 + Y0 - 62.5;
    const defs = sim.ribbons
      .map((b, j) => {
        const col = palette[(j + k0) % palette.length];
        const ux = (sim.lines[j].ux + sim.lines[j + 1].ux) / 2;
        const uy = (sim.lines[j].uy + sim.lines[j + 1].uy) / 2;
        return `<linearGradient id="${uid}-b${j}" gradientUnits="userSpaceOnUse" x1="${b.gx.toFixed(2)}" y1="${Y0.toFixed(2)}" x2="${(b.gx + ux * hot).toFixed(2)}" y2="${(Y0 + uy * hot).toFixed(2)}"><stop stop-color="${tintWhite(col, 0.72)}"/><stop offset="1" stop-color="${col}"/></linearGradient>`;
      })
      .join('');

    svg.innerHTML = `<defs>
      <radialGradient id="${uid}-mote"><stop offset=".2" stop-color="#fff"/><stop offset=".45" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
      ${defs}
      <radialGradient id="${uid}-fade-g" gradientUnits="userSpaceOnUse" cx="50" cy="${(Y0 + R0).toFixed(1)}" r="${RIBBON_SPAN}">
        <stop offset="0" stop-color="#fff" stop-opacity="0"/>
        <stop offset="0.04" stop-color="#fff"/>
        <stop offset="0.11" stop-color="#fff"/>
        <stop offset="0.18" stop-color="#fff" stop-opacity="0"/>
      </radialGradient>
      <mask id="${uid}-fade" maskUnits="userSpaceOnUse" x="-160" y="-260" width="420" height="360"><rect x="-160" y="-260" width="420" height="360" fill="url(#${uid}-fade-g)"/></mask>
      <filter id="${uid}-bloom" filterUnits="userSpaceOnUse" x="-160" y="-260" width="420" height="360"><feGaussianBlur stdDeviation="2.2"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <g filter="url(#${uid}-bloom)"><g mask="url(#${uid}-fade)">
      ${sim.ribbons.map((_, j) => `<path class="pk-band" fill="url(#${uid}-b${j})"/>`).join('')}
      <g fill="none" stroke="#fff" stroke-opacity=".65" stroke-width=".38">${'<path class="pk-edge"/>'.repeat(RIBBON_COUNT + 1)}</g>
      ${'<circle class="pk-ray-mote" fill="url(#' + uid + '-mote)"/>'.repeat(8)}
    </g></g>`;

    sim.bandEls = [...svg.querySelectorAll<SVGPathElement>('.pk-band')];
    sim.edgeEls = [...svg.querySelectorAll<SVGPathElement>('.pk-edge')];
    sim.motes = [...svg.querySelectorAll<SVGCircleElement>('.pk-ray-mote')].map((el) => ({
      el,
      j: -1,
      u: Math.random(),
      v: rand(0.2, 0.8),
      sp: rand(0.32, 0.55),
      r: rand(1.4, 2.8),
    }));
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

    if (frontSkinRef.current) frontSkinRef.current.style.clipPath = '';
    if (backSkinRef.current) backSkinRef.current.style.clipPath = '';
    if (bodyLipRef.current) bodyLipRef.current.style.clipPath = 'polygon(0 0)';
    if (flapRef.current) {
      flapRef.current.classList.remove('on');
      flapRef.current.style.transform = '';
    }
    if (packRef.current) packRef.current.classList.remove('pk-held', 'pk-hurt', 'pk-tug');
    if (raysSvgRef.current) raysSvgRef.current.style.opacity = '0';
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
    if (backSkinRef.current) backSkinRef.current.style.clipPath = geo.backBodyClip;
    if (bodyLipRef.current) bodyLipRef.current.style.clipPath = geo.bodyLipClip;
    if (flapRef.current) flapRef.current.style.transformOrigin = geo.flapOrigin;

    // Trim the 3D side rims once the tear passes the left or right edge.
    const xt = geo.xt;
    for (let i = 0; i < RIMS.length; i++) {
      const r = RIMS[i];
      const el = rimRefs.current[i];
      if (!el) continue;
      const edgeX = r.side > 0 ? 100 : 0;
      if (sim.tearDir > 0 ? edgeX <= xt : edgeX >= xt) {
        const edgeY = sim.tearPath.points[r.side > 0 ? sim.tearPath.points.length - 1 : 0].y;
        el.style.top = `${Math.max(r.top, edgeY + 1.4).toFixed(2)}%`;
      }
    }

    for (let k = 0; k < TEAR_SLICES; k++) {
      const s = geo.slices[k];
      const dom = plyRefs.current[k];
      if (!dom?.el) continue;
      if (!s.visible) {
        dom.el.hidden = true;
        continue;
      }
      dom.el.hidden = false;
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

  // Initial mount setup + ResizeObserver + main animation loop.
  useEffect(() => {
    const sim = simRef.current;
    const measure = () => {
      if (!packRef.current) return;
      sim.pw = packRef.current.offsetWidth || 245;
      sim.ph = packRef.current.offsetHeight || 355;
    };
    measure();
    resetPack(false, enterFromRight);

    const ro = new ResizeObserver(measure);
    if (packRef.current) ro.observe(packRef.current);

    const onGlobalMove = (e: globalThis.PointerEvent) => {
      sim.pointer.x = e.clientX;
      sim.pointer.y = e.clientY;
      sim.pointer.in = true;
    };
    const onGlobalLeave = () => {
      sim.pointer.in = false;
    };
    window.addEventListener('pointermove', onGlobalMove);
    document.documentElement.addEventListener('pointerleave', onGlobalLeave);

    let rafId = 0;
    sim.lastNow = performance.now();

    const updateRibbons = (dt: number) => {
      const reduce = reducedMotion();
      const ft = reduce ? 0 : sim.t;
      const xt = sim.tearDir > 0 ? sim.tearP.x * 100 : 100 - sim.tearP.x * 100;
      const sway = Math.sin(ft * 0.9) * 1.4;

      for (const b of sim.ribbons) {
        if (sim.tearP.x > 0 && (sim.tearDir > 0 ? b.mx < xt : b.mx > xt)) b.on = true;
        b.g.to = b.on ? 1 : 0;
        b.len = b.L * Math.max(0, b.g.x);
      }

      const step = 3.2;
      const fix = (v: number) => Math.round(v * 20) / 20;
      const at = (j: number, d: number): [number, number] => {
        const e = sim.lines[j];
        const k = Math.min(1, d / 90);
        const w = (0.4 + 2 * k) * Math.sin((d / 22 - ft * 1.45) * 2 * Math.PI + e.ph) + sway * k;
        return [e.x + e.ux * d - e.uy * w, sim.Y0 + e.uy * d + e.ux * w];
      };

      const edges = sim.lines.map((_, j) => {
        const len = Math.max(sim.ribbons[j - 1]?.len || 0, sim.ribbons[j]?.len || 0);
        const pts: string[] = [];
        if (len > 0) {
          for (let i = 0; ; i++) {
            const d = Math.min(i * step, len);
            const [x, y] = at(j, d);
            pts.push(`${fix(x)} ${fix(y)}`);
            if (d >= len) break;
          }
        }
        return pts;
      });

      const upto = (pts: string[], len: number) => pts.slice(0, Math.max(0, Math.ceil(len / step) + 1));
      sim.ribbons.forEach((b, j) => {
        const A = upto(edges[j], b.len);
        const B = upto(edges[j + 1], b.len);
        sim.bandEls[j]?.setAttribute('d', A.length > 1 && B.length > 1 ? `M${A.join('L')}L${B.slice().reverse().join('L')}Z` : '');
      });
      sim.edgeEls.forEach((el, j) => {
        el.setAttribute('d', edges[j].length > 1 ? `M${edges[j].join('L')}` : '');
      });

      const activeIndices = sim.ribbons.flatMap((b, j) => (b.on ? [j] : []));
      for (const m of sim.motes) {
        if (!reduce) m.u += dt * m.sp;
        if (m.u > 1 || !sim.ribbons[m.j]?.on) {
          if (m.u > 1) m.u -= 1;
          if (activeIndices.length === 0) {
            m.el.setAttribute('opacity', '0');
            continue;
          }
          m.j = activeIndices[Math.floor(rand(0, activeIndices.length))];
        }
        const len = sim.ribbons[m.j].len;
        const d = m.u * len;
        const [x1, y1] = at(m.j, d);
        const [x2, y2] = at(m.j + 1, d);
        m.el.setAttribute('cx', (x1 + (x2 - x1) * m.v).toFixed(2));
        m.el.setAttribute('cy', (y1 + (y2 - y1) * m.v).toFixed(2));
        m.el.setAttribute('r', (m.r * (0.6 + m.u * 0.7)).toFixed(2));
        m.el.setAttribute('opacity', (Math.sin(Math.PI * m.u) * Math.min(1, len / 18)).toFixed(2));
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

      // Pointer coordinates relative to the pack center.
      const stageRect = wrapRef.current?.getBoundingClientRect();
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

      const springs = [
        ...Object.values(sim.P),
        ...Object.values(sim.star),
        sim.tearP,
        sim.tearTh,
        sim.tearPh,
        sim.squeeze,
        sim.glow,
        ...sim.ribbons.map((b) => b.g),
      ];
      stepSprings(springs, dt);

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
      if (raysSvgRef.current && (sim.glow.x > 0.003 || sim.glow.to > 0)) {
        raysSvgRef.current.style.opacity = sim.glow.x.toFixed(3);
        updateRibbons(dt);
      }

      const packEl = packRef.current;
      if (packEl) {
        const transform = `translate3d(${sim.P.x.x.toFixed(2)}px,${sim.P.y.x.toFixed(2)}px,0) rotateX(${sim.P.rx.x.toFixed(2)}deg) rotateY(${sim.P.ry.x.toFixed(2)}deg) rotateZ(${sim.P.rz.x.toFixed(2)}deg) scale3d(${(1 + 0.03 * sim.squeeze.x).toFixed(4)},${(1 - 0.06 * sim.squeeze.x).toFixed(4)},1)`;
        packEl.style.transform = transform;
        if (flowRef.current) flowRef.current.style.transform = transform;

        // Live directional metallic reflections across the foil pouch.
        packEl.style.setProperty('--gx', clamp(-sim.P.ry.x * 0.12, -1.5, 3).toFixed(2));
        packEl.style.setProperty('--gl', clamp(0.82 - sim.P.ry.x * 0.012, 0.45, 1).toFixed(2));
        packEl.style.setProperty('--gm', clamp(50 + sim.P.ry.x * 1.2, 20, 80).toFixed(1));
        packEl.style.setProperty('--gt', clamp(0.86 + sim.P.rx.x * 0.015, 0.5, 1).toFixed(2));
        packEl.style.setProperty('--sh', clamp(sim.P.ry.x * 1.25 + sim.P.rx.x * 0.85, -24, 24).toFixed(1));
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
      document.documentElement.removeEventListener('pointerleave', onGlobalLeave);
      lotterySfx.rip(0);
    };
  }, [uid]);

  // Pointer interaction handlers on the hit button.
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const sim = simRef.current;
    sim.viaKey = false;
    if (e.button !== 0 || sim.drag || sim.committed) return;
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

        {/* Live light ribbon flow sitting physically behind the front skin. */}
        <div ref={flowRef} className="pk-flow" aria-hidden>
          <svg ref={raysSvgRef} className="pk-rays" viewBox="0 0 100 76" />
        </div>

        <div
          ref={packRef}
          className={`pk-pack state-${packState} ${pityHot ? 'is-pity-hot' : ''}`}
          style={packStyle}
        >
          <div key={nudgeTick} className={`pk-nudge-layer ${nudgeTick > 0 ? 'pk-nudge' : ''}`}>
            {/* ---- Front pouch face ---- */}
            <div ref={frontSkinRef} className="pk-skin pk-front" aria-hidden>
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

            {/* ---- Back pouch face (visible while spinning into stage) ---- */}
            <div ref={backSkinRef} className="pk-skin pk-back-skin" aria-hidden>
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
