// 赖子场 on the client: reading a selection that holds wild cards, the
// readings a play may be sent as, and the hint list. Mirrors the relay's
// pkg/doudizhu/laizi.go (checked against src/ddzLaizi.fixture.json, which the
// relay's tests write); the relay is still the referee.
//
// Two ranks are wild (天赖子 and 地赖子). A wild card may count as any rank
// from 3 to 2, never a joker, and in a chain only up to A; no rank may come to
// five cards. A play of wild cards only counts them as themselves, except four
// of them, a 赖子炸. Bombs are four cards: 软炸 < 炸弹 (硬炸) < 赖子炸 < 王炸.

import { R_2, R_A, R_BIG, R_SMALL, beats, counts, isBomb, patternOrder, patterns, rankOf, samePattern, type Card, type Kind, type Pattern } from './ddz';

const NUM_RANKS = 15;

export const isWild = (c: Card, laizi: readonly number[] | null | undefined) => !!laizi?.includes(rankOf(c));

/** How a main part with kickers is built; the relay's `shapes`. */
const WINGS: { kind: Kind; width: number; minLen: number; maxLen: number; top: number; kick: number; kw: number }[] = [
  { kind: 'trio_single', width: 3, minLen: 1, maxLen: 1, top: R_2, kick: 1, kw: 1 },
  { kind: 'trio_pair', width: 3, minLen: 1, maxLen: 1, top: R_2, kick: 1, kw: 2 },
  { kind: 'plane_singles', width: 3, minLen: 2, maxLen: 5, top: R_A, kick: 1, kw: 1 },
  { kind: 'plane_pairs', width: 3, minLen: 2, maxLen: 4, top: R_A, kick: 1, kw: 2 },
  { kind: 'four_singles', width: 4, minLen: 1, maxLen: 1, top: R_2, kick: 2, kw: 1 },
  { kind: 'four_pairs', width: 4, minLen: 1, maxLen: 1, top: R_2, kick: 2, kw: 2 },
];

/** Every way cards can be read when the ranks in laizi are wild, best first; empty when they are no play. */
export function readLaizi(cards: Card[], laizi: readonly number[]): Pattern[] {
  const nat = new Array<number>(NUM_RANKS).fill(0);
  let w = 0;
  for (const c of cards) {
    const r = rankOf(c);
    if (laizi.includes(r)) w++;
    else nat[r]++;
  }
  const n = cards.length;
  if (n === 0) return [];
  if (w === 0) return patterns(cards);
  if (w < n) return wildPatterns(nat, w);
  if (n === 4) return [{ kind: 'laizi_bomb', rank: Math.max(...cards.map(rankOf)), len: 1 }];
  return patterns(cards);
}

/** Natural cards c read together with w wild cards (both at least one). */
function wildPatterns(c: number[], w: number): Pattern[] {
  const n = c.reduce((a, b) => a + b, 0) + w;
  const out: Pattern[] = [];
  const add = (kind: Kind, rank: number, len: number) => {
    const p = { kind, rank, len };
    if (!out.some((q) => samePattern(p, q))) out.push(p);
  };

  // One rank filled up with wild cards: pair, trio, 软炸.
  const ranks = c.flatMap((k, r) => (k > 0 ? [r] : []));
  if (ranks.length === 1 && ranks[0] <= R_2) {
    const k = ({ 2: 'pair', 3: 'trio', 4: 'soft_bomb' } as Record<number, Kind>)[n];
    if (k) add(k, ranks[0], 1);
  }

  // Chains: every natural card inside the run, at most width of a rank.
  for (const [width, min, kind] of [
    [1, 5, 'straight'],
    [2, 3, 'pair_straight'],
    [3, 2, 'plane'],
  ] as const) {
    if (n % width || n / width < min) continue;
    const l = n / width;
    for (let lo = 0; lo + l - 1 <= R_A; lo++) {
      if (c.every((k, r) => k <= width && (k === 0 || (r >= lo && r < lo + l)))) add(kind, lo, l);
    }
  }

  // A trio or four with kickers, and planes with wings.
  for (const s of WINGS) {
    const per = s.width + s.kick * s.kw;
    if (n % per) continue;
    const l = n / per;
    if (l < s.minLen || l > s.maxLen) continue;
    for (let lo = 0; lo + l - 1 <= s.top; lo++) {
      const rest = [...c];
      const main = new Array<number>(NUM_RANKS).fill(0);
      let need = 0;
      let whole = true;
      for (let r = lo; r < lo + l; r++) {
        const used = Math.min(rest[r], s.width);
        rest[r] -= used;
        main[r] = s.width;
        need += s.width - used;
        if (l === 1 && rest[r] > 0) whole = false; // a trio or four takes every card of its rank
      }
      if (!whole || need > w) continue;
      if (s.kw === 1 && rest[R_SMALL] === 1 && rest[R_BIG] === 1) continue;
      if (s.kw === 2 && !pairsWild(rest, main, w - need)) continue;
      add(s.kind, lo, l);
    }
  }
  return out.sort(patternOrder);
}

/** rest and w wild cards make pairs only, no rank reaching five with the main part. */
function pairsWild(rest: number[], main: number[], w: number): boolean {
  if (rest[R_SMALL] || rest[R_BIG]) return false;
  let odd = 0;
  for (let r = 0; r <= R_2; r++) {
    if (rest[r] % 2) {
      if (main[r] + rest[r] >= 4) return false;
      odd++;
    }
  }
  return odd <= w && (w - odd) % 2 === 0;
}

/**
 * What the player may do with this selection in 赖子场: like `judge`, plus
 * every reading the relay would take now ('ok' only), best first.
 */
export function judgeLaizi(
  cards: Card[],
  prev: Pattern | null,
  laizi: readonly number[],
): { verdict: 'ok' | 'small' | 'bad' | 'empty'; pattern: Pattern | null; readings: Pattern[] } {
  if (cards.length === 0) return { verdict: 'empty', pattern: null, readings: [] };
  const all = readLaizi(cards, laizi);
  if (all.length === 0) return { verdict: 'bad', pattern: null, readings: [] };
  const readings = prev ? all.filter((p) => beats(p, prev)) : all;
  return readings.length ? { verdict: 'ok', pattern: readings[0], readings } : { verdict: 'small', pattern: all[0], readings };
}

export type LaiziHint = { cards: Card[]; pattern: Pattern };

/**
 * Plays from hand for the hint button in 赖子场, most sensible first: those
 * spending the fewest wild cards, then the cheapest and lowest, then bombs
 * from the smallest. Each carries the reading to send.
 */
export function laiziHints(hand: Card[], prev: Pattern | null, laizi: readonly number[]): LaiziHint[] {
  const sorted = [...hand].sort((a, b) => a - b);
  const nat = sorted.filter((c) => !laizi.includes(rankOf(c)));
  const wild = sorted.filter((c) => laizi.includes(rankOf(c)));
  const c = counts(nat);
  type Cand = LaiziHint & { wilds: number; cost: number };
  const out: Cand[] = [];
  const seen = new Set<string>();

  // Cards for natural counts `use` and wild cards standing for `stand`
  // (a wild card of a needed rank stands for itself) plus `extra` more.
  const build = (use: number[], stand: number[], extra: number) => {
    const need = [...use];
    const cards: Card[] = [];
    for (const x of nat) if (need[rankOf(x)] > 0) need[rankOf(x)]--, cards.push(x);
    const free = [...wild];
    const takeWild = (r: number | null) => {
      const i = r === null ? 0 : free.findIndex((x) => rankOf(x) === r);
      if (i < 0 || !free.length) return false;
      cards.push(...free.splice(i, 1));
      return true;
    };
    const open = stand.filter((r) => !takeWild(r));
    for (const _ of open) takeWild(null);
    for (let i = 0; i < extra; i++) takeWild(null);
    return cards;
  };
  const offer = (cards: Card[], p: Pattern, cost: number) => {
    if (prev && !beats(p, prev)) return;
    const key = [...cards].sort((a, b) => a - b).join(',') + ':' + p.kind + p.rank;
    if (seen.has(key)) return;
    seen.add(key);
    if (!readLaizi(cards, laizi).some((q) => samePattern(p, q))) return;
    out.push({ cards, pattern: p, wilds: cards.filter((x) => laizi.includes(rankOf(x))).length, cost });
  };
  // Cost of taking k natural cards of rank r: breaking a group costs more.
  const breaks = (r: number, k: number) => (c[r] === 4 ? 10 : c[r] - k);

  const main = (kind: Kind, width: number, len: number, from: number, top: number, kick: number, kw: number) => {
    for (let lo = from; lo + len - 1 <= top; lo++) {
      const use = new Array<number>(NUM_RANKS).fill(0);
      const stand: number[] = [];
      let cost = 0;
      for (let r = lo; r < lo + len; r++) {
        use[r] = Math.min(c[r], width);
        cost += breaks(r, use[r]);
        for (let k = use[r]; k < width; k++) stand.push(r);
      }
      if (stand.length > wild.length || stand.length === width * len) continue;
      const p = { kind, rank: lo, len };
      if (!kick) {
        offer(build(use, stand, 0), p, cost);
        continue;
      }
      // Kickers: the cheapest natural groups outside the main part, then wild cards.
      const pool: { r: number; cost: number }[] = [];
      for (let r = 0; r < NUM_RANKS; r++) {
        if (use[r] || c[r] < kw || (kw === 2 && r >= R_SMALL)) continue;
        pool.push({ r, cost: breaks(r, kw) });
      }
      pool.sort((a, b) => a.cost - b.cost || a.r - b.r);
      const groups = pool.slice(0, kick * len);
      const missing = kick * len - groups.length;
      for (const g of groups) use[g.r] += kw;
      offer(build(use, stand, missing * kw), p, cost + groups.reduce((a, g) => a + g.cost, 0) + missing * 6);
    }
  };

  const lead = !prev;
  if (prev && !isBomb(prev)) {
    const s = WINGS.find((x) => x.kind === prev.kind);
    if (s) main(prev.kind, s.width, prev.len, prev.rank + 1, s.top, s.kick, s.kw);
    else if (prev.kind === 'single') {
      main('single', 1, 1, prev.rank + 1, R_BIG, 0, 0);
      for (const x of wild) offer([x], { kind: 'single', rank: rankOf(x), len: 1 }, 2);
    }
    else if (prev.kind === 'pair') main('pair', 2, 1, prev.rank + 1, R_2, 0, 0);
    else if (prev.kind === 'trio') main('trio', 3, 1, prev.rank + 1, R_2, 0, 0);
    else if (prev.kind === 'straight') main('straight', 1, prev.len, prev.rank + 1, R_A, 0, 0);
    else if (prev.kind === 'pair_straight') main('pair_straight', 2, prev.len, prev.rank + 1, R_A, 0, 0);
    else if (prev.kind === 'plane') main('plane', 3, prev.len, prev.rank + 1, R_A, 0, 0);
  } else if (lead) {
    main('single', 1, 1, 0, R_BIG, 0, 0);
    main('pair', 2, 1, 0, R_2, 0, 0);
    main('trio_single', 3, 1, 0, R_2, 1, 1);
    main('trio_pair', 3, 1, 0, R_2, 1, 2);
    main('trio', 3, 1, 0, R_2, 0, 0);
    for (let l = 12; l >= 5; l--) main('straight', 1, l, 0, R_A, 0, 0);
    for (let l = 10; l >= 3; l--) main('pair_straight', 2, l, 0, R_A, 0, 0);
    for (let l = 5; l >= 2; l--) main('plane_singles', 3, l, 0, R_A, 1, 1);
    for (let l = 6; l >= 2; l--) main('plane', 3, l, 0, R_A, 0, 0);
    // Wild cards on their own, as themselves.
    for (const x of wild) offer([x], { kind: 'single', rank: rankOf(x), len: 1 }, 2);
  }
  const plays = out.sort((a, b) => a.wilds - b.wilds || a.cost - b.cost || a.pattern.rank - b.pattern.rank);

  // Bombs, from the smallest: 软炸 and 硬炸 by rank, the 赖子炸, the rocket.
  const bombs: LaiziHint[] = [];
  const bomb = (cards: Card[], p: Pattern) => {
    if ((!prev || beats(p, prev)) && readLaizi(cards, laizi).some((q) => samePattern(p, q))) bombs.push({ cards, pattern: p });
  };
  if (prev?.kind !== 'rocket') {
    for (let r = 0; r <= R_2; r++) {
      if (c[r] === 0) continue;
      const use = new Array<number>(NUM_RANKS).fill(0);
      use[r] = c[r];
      const stand = Array.from({ length: 4 - c[r] }, () => r);
      if (stand.length <= wild.length) bomb(build(use, stand, 0), { kind: c[r] === 4 ? 'bomb' : 'soft_bomb', rank: r, len: 1 });
    }
    if (wild.length >= 4) {
      const top = wild.slice(-4);
      bomb(top, { kind: 'laizi_bomb', rank: rankOf(top[3]), len: 1 });
    }
    if (c[R_SMALL] && c[R_BIG]) bomb(nat.filter((x) => rankOf(x) >= R_SMALL), { kind: 'rocket', rank: R_BIG, len: 1 });
  }
  bombs.sort((a, b) => -patternOrder(a.pattern, b.pattern));

  const keys = new Set<string>();
  return [...plays, ...bombs].filter((h) => {
    const key = [...h.cards].sort((a, b) => a - b).join(',');
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  }).map(({ cards, pattern }) => ({ cards, pattern }));
}
