import { describe, expect, it } from 'vitest';
import { Spring, allSettled, createPose, stepSprings } from './spring';
import {
  TEAR_SEGMENTS,
  TEAR_SLICES,
  Y_MAX,
  Y_MIN,
  arrangeBatchCards,
  computeCardLayout,
  computeTearGeometry,
  createRimSpecs,
  createTearPath,
  generateFoilCreases,
  steerTearPath,
  yAt,
} from './tearGeometry';
import { bestRarity, isMysteryDraw, matchVendorLogo } from './packThemes';

function seededRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('spring physics', () => {
  it('converges smoothly to target and reports settled', () => {
    const sp = new Spring(0, 0.35, 0.25);
    sp.to = 100;
    expect(sp.settled()).toBe(false);
    for (let i = 0; i < 120; i++) stepSprings([sp], 1 / 60);
    expect(sp.x).toBeCloseTo(100, 1);
    expect(sp.settled()).toBe(true);
  });

  it('tracks posed spring bundles and supports snap/free', () => {
    const p = createPose({ x: 0, y: 10 }, 0.25, 0.1);
    p.x.to = 50;
    expect(allSettled(Object.values(p))).toBe(false);
    p.x.snap(50);
    expect(allSettled(Object.values(p))).toBe(true);
    p.y.free();
    p.y.to = 999;
    stepSprings([p.y], 0.05);
    expect(p.y.x).toBe(10);
  });
});

describe('tear geometry', () => {
  it('builds a bounded jagged tear path across 0..100%', () => {
    const { points, roll } = createTearPath(TEAR_SEGMENTS, seededRng(42));
    expect(points).toHaveLength(TEAR_SEGMENTS + 1);
    expect(points[0].x).toBe(0);
    expect(points[points.length - 1].x).toBe(100);
    expect(roll).toBeGreaterThanOrEqual(0.65);
    expect(roll).toBeLessThanOrEqual(1.4);
    for (const q of points) {
      expect(q.y).toBeGreaterThan(Y_MIN - 2);
      expect(q.y).toBeLessThan(Y_MAX + 2);
    }
    expect(yAt(points, 0)).toBeCloseTo(points[0].y, 4);
    expect(yAt(points, 100)).toBeCloseTo(points[points.length - 1].y, 4);
  });

  it('steers only the untorn side while freezing already-torn segments', () => {
    const { points } = createTearPath(20, seededRng(7));
    const beforeLeft = points.slice(0, 10).map((p) => p.y);
    const beforeEnd = points[20].y;
    steerTearPath(points, 0.5, 1, 0.4);
    expect(points.slice(0, 10).map((p) => p.y)).toEqual(beforeLeft);
    expect(points[20].y).toBeGreaterThan(beforeEnd);
  });

  it('computes curling slice clips and transforms for both tear directions', () => {
    const { points, roll } = createTearPath(TEAR_SEGMENTS, seededRng(99));
    for (const dir of [1, -1] as const) {
      const res = computeTearGeometry({
        points,
        progress: 0.6,
        dir,
        slices: TEAR_SLICES,
        pw: 260,
        roll,
        velocity: 1.2,
        time: 1.5,
        frozenMask: new Array(TEAR_SLICES).fill(false),
      });
      expect(res.frontBodyClip.startsWith('polygon(')).toBe(true);
      expect(res.backBodyClip.startsWith('polygon(')).toBe(true);
      expect(res.bodyLipClip.startsWith('polygon(')).toBe(true);
      const visible = res.slices.filter((s) => s.visible);
      expect(visible.length).toBeGreaterThan(5);
      expect(visible.every((s) => s.transform.includes('rotateY('))).toBe(true);
    }
  });

  it('produces valid encoded SVG creases and 18 3D side rim specs', () => {
    const creases = generateFoilCreases(seededRng(11));
    expect(creases.shine.startsWith('url("data:image/svg+xml,')).toBe(true);
    expect(creases.shade.startsWith('url("data:image/svg+xml,')).toBe(true);
    expect(creases.shine).not.toContain('#');
    expect(creases.shade).not.toContain('#');
    const rims = createRimSpecs();
    expect(rims).toHaveLength(18);
    expect(rims.filter((r) => r.side === -1)).toHaveLength(9);
    expect(rims.filter((r) => r.side === 1)).toHaveLength(9);
  });
});

describe('card layout and batch arrangement', () => {
  it('lays out 1 card centered, 2-5 in one row, and 6-10 in two balanced rows inside 800x560', () => {
    const one = computeCardLayout(1, 800, 560, 220);
    expect(one).toHaveLength(1);
    expect(one[0].x).toBe(0);
    expect(one[0].row).toBe(0);

    const five = computeCardLayout(5, 1080, 720, 220);
    expect(five).toHaveLength(5);
    expect(five.every((s) => s.row === 0)).toBe(true);
    expect(five[0].x).toBeLessThan(five[2].x);
    expect(five[2].x).toBeCloseTo(0, 4);
    expect(five[4].x).toBeGreaterThan(five[2].x);

    const ten = computeCardLayout(10, 800, 560, 220);
    expect(ten).toHaveLength(10);
    expect(ten.filter((s) => s.row === 0)).toHaveLength(5);
    expect(ten.filter((s) => s.row === 1)).toHaveLength(5);
    // All card centers stay well inside the 800x560 viewport.
    for (const s of ten) {
      expect(Math.abs(s.x)).toBeLessThan(360);
      expect(Math.abs(s.y)).toBeLessThan(240);
    }
  });

  it('places highest-rarity draws in the dramatic center slots for batch pulls', () => {
    const five = [
      { id: 1, rarity: 'common' as const, kind: 'balance_fixed' as const },
      { id: 2, rarity: 'common' as const, kind: 'balance_fixed' as const },
      { id: 3, rarity: 'legendary' as const, kind: 'balance_fixed' as const },
      { id: 4, rarity: 'rare' as const, kind: 'discount' as const },
      { id: 5, rarity: 'epic' as const, kind: 'credit' as const },
    ];
    const arranged = arrangeBatchCards(five);
    expect(arranged[2].id).toBe(3); // center slot gets Legendary
    expect([arranged[1].id, arranged[3].id]).toContain(5); // adjacent slot gets Epic
  });

  it('marks only multi-pull Epic/Legendary draws as mystery cards (Option B)', () => {
    expect(isMysteryDraw({ rarity: 'legendary', kind: 'balance_fixed' }, 1)).toBe(false);
    expect(isMysteryDraw({ rarity: 'epic', kind: 'credit' }, 5)).toBe(true);
    expect(isMysteryDraw({ rarity: 'legendary', kind: 'balance_fixed' }, 10)).toBe(true);
    expect(isMysteryDraw({ rarity: 'rare', kind: 'discount' }, 10)).toBe(false);
    expect(isMysteryDraw({ rarity: 'epic', kind: 'none' }, 10)).toBe(false);
    expect(bestRarity([{ rarity: 'common', kind: 'balance_fixed' }, { rarity: 'epic', kind: 'credit' }])).toBe('epic');
  });

  it('matches vendor logos from token pack group names', () => {
    expect(matchVendorLogo('Claude Pro')).toBe('claude');
    expect(matchVendorLogo('GPT-5 / OpenAI')).toBe('openai');
    expect(matchVendorLogo('Codex 专属')).toBe('codex');
    expect(matchVendorLogo('Gemini 2.5')).toBe('gemini');
    expect(matchVendorLogo('DeepSeek R1')).toBe('deepseek');
    expect(matchVendorLogo('通义千问')).toBe('qwen');
    expect(matchVendorLogo('Unknown Group')).toBeNull();
  });
});
