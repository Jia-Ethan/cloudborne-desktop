import type { Draw, Rarity } from '../api';
import { RARITIES } from '../lottery';
import { clamp, rand } from './spring';

/**
 * Pure geometry and layout math for the 3D foil booster pack and card fan.
 * Keeps every polygon, curl slice, rim strip, and spread slot deterministic
 * and unit-testable outside the DOM.
 */

export const TEAR_NOMINAL = 10.5;
export const TEAR_SEGMENTS = 96;
export const TEAR_SLICES = 12;
export const Y_MIN = 8;
export const Y_MAX = 19.5;

export interface TearPoint {
  x: number;
  y: number;
  baseY: number;
  tooth: number;
  metal: number;
  bend: number;
}

export interface TearPath {
  points: TearPoint[];
  /** How tightly the torn strip curls forward (0.65..1.4). */
  roll: number;
}

export interface RimSpec {
  side: -1 | 1;
  top: number;
  width: number;
  offsetPx: number;
  zFactor: number;
  clipPath: string;
  tone: string;
}

export interface SliceClip {
  index: number;
  visible: boolean;
  frozen: boolean;
  frontClip?: string;
  foilClip?: string;
  lipClip?: string;
  transform: string;
  frontShade: number;
  underShade: number;
}

export interface CardSlot {
  x: number;
  y: number;
  z: number;
  rz: number;
  s: number;
  row: number;
}

type Pt = readonly [number, number];

const placePoint = (q: TearPoint, bend: number): void => {
  q.bend = bend;
  q.y = clamp(q.baseY + bend, Y_MIN, Y_MAX) + q.tooth;
};

/**
 * Generates a unique jagged tear line across 0..100% of pouch width:
 * gentle slope, slight bow, organic wander, occasional snags, and fine foil teeth.
 */
export function createTearPath(segments = TEAR_SEGMENTS, rng: () => number = Math.random): TearPath {
  const r = (a: number, b: number) => a + rng() * (b - a);
  const roll = r(0.65, 1.4);
  const slope = r(-6.8, 6.8);
  const bow = r(-2.8, 2.8);
  const freq = r(1.5, 3.4);
  const phase = r(0, Math.PI * 2);
  const wob = r(0.3, 1.05);
  const y0 = r(10.5, 13.6);
  let walk = 0;

  const points: TearPoint[] = Array.from({ length: segments + 1 }, (_, i) => {
    const x0 = (i / segments) * 100;
    const s = x0 / 50 - 1;
    walk = clamp(walk + r(-0.24, 0.24) + (rng() < 0.05 ? r(-1.4, 1.4) : 0), -2.1, 2.1);
    const x = i > 0 && i < segments ? x0 + r(-0.28, 0.28) : x0;
    const baseY = y0 + slope * s + bow * (1 - s * s) + wob * Math.sin(s * freq * Math.PI + phase) + walk;
    const tooth = r(-0.4, 0.4) + (rng() < 0.14 ? r(-1.1, 1.1) : 0);
    const metal = rng() < 0.12 ? r(1.15, 2.0) : r(0.35, 1.05);
    const q: TearPoint = { x, y: 0, baseY, tooth, metal, bend: 0 };
    placePoint(q, 0);
    return q;
  });

  return { points, roll };
}

/**
 * Steers the still-untorn portion of the tear path to follow the hand's vertical angle.
 * Anything already behind the tear tip stays frozen in place.
 */
export function steerTearPath(points: TearPoint[], progress: number, dir: 1 | -1, slopeK: number): void {
  const n = points.length - 1;
  if (n <= 0) return;
  const i0 = clamp(Math.round((dir > 0 ? progress : 1 - progress) * n), 0, n);
  const baseBend = points[i0].bend;
  for (let i = i0 + dir; i >= 0 && i <= n; i += dir) {
    placePoint(points[i], baseBend + slopeK * (Math.abs(i - i0) * 100) / n);
  }
}

/** Linearly samples tear height y (%) at horizontal coordinate x (0..100%). */
export function yAt(points: readonly TearPoint[], x: number): number {
  const n = points.length - 1;
  if (n <= 0) return TEAR_NOMINAL;
  const f = (clamp(x, 0, 100) / 100) * n;
  const i = Math.min(n - 1, Math.floor(f));
  return points[i].y + (points[i + 1].y - points[i].y) * (f - i);
}

export function poly(pts: readonly Pt[]): string {
  return `polygon(${pts.map(([x, y]) => `${x.toFixed(2)}% ${y.toFixed(2)}%`).join(',')})`;
}

export function mirrorPts(pts: readonly Pt[]): Pt[] {
  return pts.map(([x, y]) => [100 - x, y]);
}

/** Thin jagged polygon ribbon along the torn edge exposing the shiny metallic foil core. */
export function metalBand(pts: readonly { x: number; y: number; metal: number }[], sign: 1 | -1): Pt[] {
  const forward: Pt[] = pts.map((q) => [q.x, q.y]);
  const back: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const q = pts[i];
    back.push([q.x, q.y + sign * q.metal]);
  }
  return [...forward, ...back];
}

/** Computes body clip paths, torn lip clip path, flap origin, and curling slice transforms. */
export function computeTearGeometry(opts: {
  points: readonly TearPoint[];
  progress: number;
  dir: 1 | -1;
  slices: number;
  pw: number;
  roll: number;
  velocity: number;
  time: number;
  frozenMask: boolean[];
}) {
  const { points, progress, dir, slices, pw, roll, velocity, time, frozenMask } = opts;
  const p = clamp(progress, 0, 1);
  const xt = dir > 0 ? p * 100 : 100 - p * 100;
  const yt = yAt(points, xt);
  const tip = { x: xt, y: yt, metal: 0.45 };

  const torn = points.filter((q) => (dir > 0 ? q.x < xt : q.x > xt));
  const tornPts: Pt[] = torn.map((q) => [q.x, q.y]);

  const rest: Pt[] =
    dir > 0
      ? [[xt, 0], [100, 0], [100, 100], [0, 100], ...tornPts, [xt, yt]]
      : [[0, 0], [xt, 0], [xt, yt], ...tornPts, [100, 100], [0, 100]];

  const frontBodyClip = poly(rest);
  const backBodyClip = poly(mirrorPts(rest));
  const lipPts = dir > 0 ? [...torn, tip] : [tip, ...torn];
  const bodyLipClip = lipPts.length >= 2 ? poly(metalBand(lipPts, 1)) : 'polygon(0 0)';

  const w = 100 / slices;
  const lap = 0.25;
  const sliceData: SliceClip[] = Array.from({ length: slices }, (_, k) => ({
    index: k,
    visible: false,
    frozen: frozenMask[k] ?? false,
    transform: '',
    frontShade: 0,
    underShade: 0,
  }));

  for (let k = 0; k < slices; k++) {
    const lo = dir > 0 ? k * w : Math.max(k * w, xt);
    const hi = dir > 0 ? Math.min((k + 1) * w, xt) : (k + 1) * w;
    if (hi <= lo) continue;
    const s = sliceData[k];
    s.visible = true;
    if (!frozenMask[k]) {
      const L = dir < 0 && lo === xt ? lo : Math.max(0, lo - lap);
      const R = dir > 0 && hi === xt ? hi : Math.min(100, hi + lap);
      const span = [
        { x: L, y: yAt(points, L), metal: 0.8 },
        ...points.filter((q) => q.x > L && q.x < R),
        { x: R, y: yAt(points, R), metal: 0.8 },
      ];
      const piece: Pt[] = [[L, 0], [R, 0], ...span.slice().reverse().map((q): Pt => [q.x, q.y])];
      s.frontClip = poly(piece);
      s.foilClip = poly(mirrorPts(piece));
      s.lipClip = poly(metalBand(span, -1));
      s.frozen = dir > 0 ? hi < xt || xt >= 100 : lo > xt || xt <= 0;
    }
  }

  // Hinge outward from tear tip so each slice curls progressively forward toward the viewer.
  const k0 = clamp(Math.floor((dir > 0 ? xt - 1e-6 : xt) / w), 0, slices - 1);
  const bend = (2.6 + 2.6 * p) * roll;
  const jit = Math.min(1, Math.abs(velocity) * 0.4) * 1.6;
  let matrixChain = '';
  let sumAngle = 0;

  for (let n = 0, k = k0; k >= 0 && k < slices; n++, k -= dir) {
    const s = sliceData[k];
    if (!s.visible) continue;
    const xPx = (((n ? (dir > 0 ? k + 1 : k) * w : xt) / 100) * pw).toFixed(2);
    const angle = dir * (bend * (0.4 + 0.3 * n) + Math.sin(time * 16 + n * 0.9) * jit);
    sumAngle += angle;
    matrixChain += `translateX(${xPx}px) rotateY(${angle.toFixed(2)}deg) rotateZ(${((dir * 0.9 * n) / 4).toFixed(2)}deg) translateX(-${xPx}px) `;
    s.transform = matrixChain;
    s.frontShade = Number(Math.min(0.5, Math.abs(sumAngle) / 200).toFixed(2));
    s.underShade = Number(Math.max(0, 0.34 - Math.abs(sumAngle) / 420).toFixed(2));
  }

  return {
    xt,
    yt,
    frontBodyClip,
    backBodyClip,
    bodyLipClip,
    flapOrigin: `${xt.toFixed(2)}% ${yt.toFixed(2)}%`,
    slices: sliceData,
  };
}

/**
 * Generates per-pack unique foil creases: bright vertical streaks tucked under
 * the top heat seal (`shine`) and soft crumpled shadow humps above the bottom seal (`shade`).
 */
export function generateFoilCreases(rng: () => number = Math.random): { shine: string; shade: string } {
  const r = (a: number, b: number) => a + rng() * (b - a);
  const f = (n: number) => n.toFixed(2);
  let lit = '';
  let dark = 'M0 93.2V91.6';

  for (let x = 0; x < 100; ) {
    const w = r(0.5, 2.5);
    lit += `<rect x='${f(x)}' y='6.8' width='${f(w)}' height='${f(r(3.2, 8.5))}' fill='url(%23g)' fill-opacity='${f(r(0.08, 0.4))}'/>`;
    x += w + r(0, 1.4);
  }
  for (let x = 0; x < 100; ) {
    const w = r(2.5, 7);
    const peak = x + w * r(0.35, 0.65);
    x = Math.min(100, x + w);
    dark += `Q${f(peak)} ${f(r(86.6, 90))} ${f(x)} ${f(r(91.1, 91.7))}`;
  }

  const wrap = (body: string) =>
    `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'>${body}</svg>`).replace(/%2523/g, '%23')}")`;

  return {
    shine: wrap(
      `<linearGradient id='g' x2='0' y2='1'><stop stop-color='#fff' stop-opacity='.72'/><stop offset='1' stop-color='#fff' stop-opacity='0'/></linearGradient><filter id='b'><feGaussianBlur stdDeviation='.28 .5'/></filter><g filter='url(%23b)'>${lit}</g>`,
    ),
    shade: wrap(
      `<filter id='b'><feGaussianBlur stdDeviation='.35 .24'/></filter><path d='${dark}V93.2Z' fill-opacity='.11' filter='url(%23b)'/>`,
    ),
  };
}

/**
 * 18 thin side strips stacked through the pouch's Z depth (`--d`) to form
 * realistic puffed pillow edges that roll smoothly from front to back.
 */
export function createRimSpecs(): RimSpec[] {
  const specs: RimSpec[] = [];
  const angles = [80, 60, 40, 20, 0, -20, -40, -60, -80];
  for (const side of [-1, 1] as const) {
    for (const deg of angles) {
      const a = (deg * Math.PI) / 180;
      const back = (1 - Math.sin(a)) / 2;
      const offsetPx = 4;
      const bulge = 5 * Math.cos(a);
      const edge: Pt[] = Array.from({ length: 13 }, (_, i) => [
        ((offsetPx + bulge * Math.sin((Math.PI * i) / 12) ** 0.8) / (offsetPx + bulge)) * 100,
        (i / 12) * 100,
      ]);
      const shape: Pt[] = [[0, 0], ...edge, [0, 100]];
      const tone = side > 0 ? `#000 ${(10 + back * 40).toFixed(0)}%` : `#fff ${(44 * (1 - back)).toFixed(0)}%`;
      specs.push({
        side,
        top: Number((11.5 + back * 13).toFixed(2)),
        width: Number((offsetPx + bulge).toFixed(2)),
        offsetPx,
        zFactor: Number((Math.sin(a) / 2).toFixed(3)),
        clipPath: poly(side > 0 ? shape : mirrorPts(shape)),
        tone,
      });
    }
  }
  return specs;
}

/**
 * Computes resting slots for 1..10 cards inside the viewport:
 * - 1 card: dead-center showcase at generous collector size.
 * - 2..5 cards: single curved horizontal fan (exact holo.yashb.xyz grace).
 * - 6..10 cards: balanced two-row collector gallery so every card stays legible
 *   and interactive even at the 800×560 minimum Tauri window size.
 */
export function computeCardLayout(count: number, vw: number, vh: number, baseCardW: number): CardSlot[] {
  if (count <= 0) return [];
  const cw = Math.max(120, baseCardW);
  const ch = cw * 1.4;

  if (count === 1) {
    const maxS = Math.min((vw - 96) / cw, (vh - 196) / ch, 1);
    return [{ x: 0, y: -12, z: 0, rz: 0, s: clamp(maxS, 0.72, 1), row: 0 }];
  }

  if (count <= 5) {
    const padX = 72;
    const availW = Math.max(320, vw - padX);
    const maxHScale = (vh - 216) / ch;
    const s = clamp(Math.min(availW / (cw * (1 + (count - 1) * 1.08)), maxHScale, 0.96), 0.56, 0.96);
    const w = cw * s;
    const side = Math.min(w * 1.09, (availW - w) / Math.max(1, count - 1));
    const tight = side < w * 0.98;
    const ends = (count - 1) / 2;
    const lean = (ends * 6.5 * Math.PI) / 180;
    const near = 1400 / (1400 - ends * 36);
    const gap = tight
      ? Math.max(
          w * 0.52,
          Math.min(side, (vw / 2 - 20 - ((w / 2) * Math.cos(lean) + w * 0.7 * Math.sin(lean)) * near) / (ends * near)),
        )
      : side;

    return Array.from({ length: count }, (_, idx) => {
      const m = idx - ends;
      return {
        x: m * gap,
        y: -8 + m * m * (tight ? 8 : 5.5) * s,
        z: tight ? m * 36 : 0,
        rz: m * (tight ? 6 : 2.1),
        s,
        row: 0,
      };
    });
  }

  // 6..10 cards: two balanced gently arched rows with clean headroom below top summary pill.
  const topCount = Math.ceil(count / 2);
  const bottomCount = count - topCount;
  const maxCols = Math.max(topCount, bottomCount);
  const availW = Math.max(360, vw - 88);
  const availH = Math.max(300, vh - 232);
  const sW = availW / (cw * (maxCols + (maxCols - 1) * 0.11));
  const sH = availH / (ch * 2.14);
  const s = clamp(Math.min(sW, sH, 0.78), 0.44, 0.78);
  const w = cw * s;
  const h = ch * s;
  const rowGapY = h * 0.555;
  const slots: CardSlot[] = [];

  const placeRow = (n: number, rowIdx: number, centerY: number) => {
    const ends = (n - 1) / 2;
    const gap = Math.min(w * 1.1, (availW - w) / Math.max(1, n - 1));
    for (let i = 0; i < n; i++) {
      const m = i - ends;
      slots.push({
        x: m * gap,
        y: centerY + m * m * 2.4 * s,
        z: 0,
        rz: m * 1.4,
        s,
        row: rowIdx,
      });
    }
  };

  placeRow(topCount, 0, -rowGapY + 6);
  placeRow(bottomCount, 1, rowGapY + 6);
  return slots;
}

const rarityRank = (d: Pick<Draw, 'rarity' | 'kind'>): number =>
  d.kind === 'none' ? -1 : RARITIES.indexOf(d.rarity as Rarity);

/**
 * Arranges batch draws dramatically across slots:
 * highest-rarity pulls land in the focal center slots of the fan/gallery
 * so shimmering face-down Epic/Legendary cards command immediate attention.
 */
export function arrangeBatchCards<T extends Pick<Draw, 'rarity' | 'kind'>>(draws: readonly T[]): T[] {
  const n = draws.length;
  if (n <= 1) return [...draws];

  // Rank best-first while preserving original draw order for ties.
  const ranked = draws
    .map((d, i) => ({ d, i, r: rarityRank(d) }))
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .map((x) => x.d);

  // Order slot indices from center outward (for 2 rows, alternate top-center & bottom-center).
  const slotOrder: number[] = [];
  if (n <= 5) {
    const mid = (n - 1) / 2;
    const indices = Array.from({ length: n }, (_, i) => i);
    indices.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
    slotOrder.push(...indices);
  } else {
    const top = Math.ceil(n / 2);
    const bot = n - top;
    const topMid = (top - 1) / 2;
    const botMid = (bot - 1) / 2;
    const topIdx = Array.from({ length: top }, (_, i) => i).sort((a, b) => Math.abs(a - topMid) - Math.abs(b - topMid) || a - b);
    const botIdx = Array.from({ length: bot }, (_, i) => top + i).sort(
      (a, b) => Math.abs(a - top - botMid) - Math.abs(b - top - botMid) || a - b,
    );
    const maxLen = Math.max(topIdx.length, botIdx.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < topIdx.length) slotOrder.push(topIdx[i]);
      if (i < botIdx.length) slotOrder.push(botIdx[i]);
    }
  }

  const out = new Array<T>(n);
  for (let i = 0; i < n; i++) {
    out[slotOrder[i]] = ranked[i];
  }
  return out;
}

export function randomPickExcluding<T>(items: readonly T[], exclude?: T): T {
  const pool = exclude !== undefined && items.length > 1 ? items.filter((x) => x !== exclude) : items;
  return pool[Math.floor(rand(0, pool.length))];
}
