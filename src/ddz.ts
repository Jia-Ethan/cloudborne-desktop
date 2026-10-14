// 斗地主 on the client: card naming, reading a selection as a pattern, and
// the hint list. The relay is the referee (it deals, checks every play and
// settles); this side only needs to know what the player's selection is so
// the buttons can say so before anything is sent.

/** 0..53, the relay's numbering: rank*4+suit for 3 up to 2, then 52 the small joker, 53 the big joker. */
export type Card = number;
export type Seat = 0 | 1 | 2;

export const SMALL_JOKER = 52;
export const BIG_JOKER = 53;
/** Ranks 0..14: 3 4 5 6 7 8 9 10 J Q K A 2 小王 大王. */
export const R_A = 11;
export const R_2 = 12;
export const R_SMALL = 13;
export const R_BIG = 14;
const NUM_RANKS = 15;

export const rankOf = (c: Card) => (c >= SMALL_JOKER ? R_SMALL + (c - SMALL_JOKER) : Math.floor(c / 4));
/** 0 ♠, 1 ♥, 2 ♣, 3 ♦; -1 for a joker. */
export const suitOf = (c: Card) => (c >= SMALL_JOKER ? -1 : c % 4);
export const isRed = (c: Card) => c === BIG_JOKER || suitOf(c) === 1 || suitOf(c) === 3;

const LABELS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
export const SUITS = ['♠', '♥', '♣', '♦'];

export function rankLabel(c: Card): string {
  const r = rankOf(c);
  return r < R_SMALL ? LABELS[r] : 'JOKER';
}

/** Cards as they are held: biggest on the left, the way most people fan a hand. */
export function byHand(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => b - a);
}

/**
 * Cards as they lie on the table: the main part (a trio, a four, a chain) before
 * its kickers, each part low to high.
 */
export function byPlay(cards: Card[]): Card[] {
  const n = counts(cards);
  return [...cards].sort((a, b) => n[rankOf(b)] - n[rankOf(a)] || a - b);
}

export type Kind =
  | 'single'
  | 'pair'
  | 'trio'
  | 'trio_single'
  | 'trio_pair'
  | 'straight'
  | 'pair_straight'
  | 'plane'
  | 'plane_singles'
  | 'plane_pairs'
  | 'four_singles'
  | 'four_pairs'
  | 'bomb'
  | 'rocket';

/** A play's shape. Same kind and len compare by rank; bombs beat everything but a higher bomb or the rocket. */
export type Pattern = { kind: Kind; rank: number; len: number };

export const isBomb = (p: Pattern) => p.kind === 'bomb' || p.kind === 'rocket';

export function beats(p: Pattern, prev: Pattern): boolean {
  if (p.kind === 'rocket') return true;
  if (prev.kind === 'rocket') return false;
  if (p.kind === 'bomb') return prev.kind !== 'bomb' || p.rank > prev.rank;
  if (prev.kind === 'bomb') return false;
  return p.kind === prev.kind && p.len === prev.len && p.rank > prev.rank;
}

function counts(cards: Card[]): number[] {
  const n = new Array<number>(NUM_RANKS).fill(0);
  for (const c of cards) n[rankOf(c)]++;
  return n;
}

/** Whether rest is exactly `pairs` pairs, no jokers (four of a rank is two pairs). */
function pairsOnly(rest: number[], pairs: number): boolean {
  if (rest[R_SMALL] || rest[R_BIG]) return false;
  let got = 0;
  for (let r = 0; r <= R_2; r++) {
    if (rest[r] % 2) return false;
    got += rest[r] / 2;
  }
  return got === pairs;
}

/** Every way the cards can be read, best first; empty when they are not a play. Mirrors the relay. */
export function patterns(cards: Card[]): Pattern[] {
  const c = counts(cards);
  const n = cards.length;
  const out: Pattern[] = [];
  const add = (kind: Kind, rank: number, len = 1) => out.push({ kind, rank, len });
  if (n === 0) return out;
  const rocket = c[R_SMALL] === 1 && c[R_BIG] === 1;
  if (n === 2 && rocket) return [{ kind: 'rocket', rank: R_BIG, len: 1 }];
  let distinct = 0;
  let top = 0;
  for (let r = 0; r < NUM_RANKS; r++) {
    if (c[r]) {
      distinct++;
      top = r;
    }
  }
  if (distinct === 1) {
    const k = (['single', 'pair', 'trio', 'bomb'] as const)[n - 1];
    if (k) add(k, top);
    return out;
  }

  for (const [width, min, kind] of [
    [1, 5, 'straight'],
    [2, 3, 'pair_straight'],
    [3, 2, 'plane'],
  ] as const) {
    if (n % width || n / width < min || n / width !== distinct || top > R_A) continue;
    const lo = top - distinct + 1;
    let ok = lo >= 0;
    for (let r = lo; ok && r <= top; r++) ok = c[r] === width;
    if (ok) add(kind, lo, distinct);
  }

  for (let r = 0; r <= R_2; r++) {
    if (c[r] >= 3 && (n === 4 || n === 5)) {
      const rest = [...c];
      rest[r] -= 3;
      if (rest[r] === 0 && n === 4) add('trio_single', r);
      if (rest[r] === 0 && n === 5 && pairsOnly(rest, 1)) add('trio_pair', r);
    }
    if (c[r] === 4) {
      const rest = [...c];
      rest[r] = 0;
      if (n === 6 && !rocket) add('four_singles', r);
      if (n === 8 && pairsOnly(rest, 2)) add('four_pairs', r);
    }
  }

  for (let k = 2; 4 * k <= n; k++) {
    for (let lo = 0; lo + k - 1 <= R_A; lo++) {
      const rest = [...c];
      let ok = true;
      for (let r = lo; ok && r < lo + k; r++) {
        ok = rest[r] >= 3;
        rest[r] -= 3;
      }
      if (!ok) continue;
      if (n === 4 * k && !(rest[R_SMALL] === 1 && rest[R_BIG] === 1)) add('plane_singles', lo, k);
      if (n === 5 * k && pairsOnly(rest, k)) add('plane_pairs', lo, k);
    }
  }

  return out.sort((a, b) => {
    if (isBomb(a) !== isBomb(b)) return isBomb(a) ? -1 : 1;
    return b.len - a.len || b.rank - a.rank;
  });
}

/** How cards read when led, or null when they are no play. */
export function classify(cards: Card[]): Pattern | null {
  return patterns(cards)[0] ?? null;
}

/** How cards read over prev, or null when they do not beat it. */
export function follow(cards: Card[], prev: Pattern): Pattern | null {
  return patterns(cards).find((p) => beats(p, prev)) ?? null;
}

/**
 * What the player may do with this selection: lead or beat with it ('ok'),
 * a real play that is too small or the wrong shape ('small'), or not a play
 * at all ('bad').
 */
export function judge(cards: Card[], prev: Pattern | null): { verdict: 'ok' | 'small' | 'bad' | 'empty'; pattern: Pattern | null } {
  if (cards.length === 0) return { verdict: 'empty', pattern: null };
  const led = classify(cards);
  if (!led) return { verdict: 'bad', pattern: null };
  if (!prev) return { verdict: 'ok', pattern: led };
  const p = follow(cards, prev);
  return p ? { verdict: 'ok', pattern: p } : { verdict: 'small', pattern: led };
}

/**
 * Plays from hand for the hint button, most sensible first: over prev, the
 * cheapest plays that do not break up bigger groups, then bombs and the
 * rocket; when leading, the lowest groups and chains. Each is a set of cards
 * from hand.
 */
export function hints(hand: Card[], prev: Pattern | null): Card[][] {
  const c = counts(hand);
  const byRank = new Map<number, Card[]>();
  for (const card of [...hand].sort((a, b) => a - b)) {
    const r = rankOf(card);
    byRank.set(r, [...(byRank.get(r) ?? []), card]);
  }
  const take = (r: number, k: number) => (byRank.get(r) ?? []).slice(0, k);
  const rocket = c[R_SMALL] === 1 && c[R_BIG] === 1;
  // How much taking k of rank r costs: 0 when it uses the whole group.
  const breaks = (r: number, k: number) => (c[r] === 4 ? 10 : rocket && r >= R_SMALL ? 8 : c[r] - k);

  type Cand = { cards: Card[]; cost: number; rank: number };
  const out: Cand[] = [];
  const groups = (width: number, from: number) => {
    const rs: number[] = [];
    for (let r = from; r < NUM_RANKS; r++) if (c[r] >= width) rs.push(r);
    return rs;
  };
  const kickers = (width: number, k: number, skip: Set<number>): Card[] | null => {
    const pool: { r: number; cost: number }[] = [];
    for (let r = 0; r < NUM_RANKS; r++) {
      if (skip.has(r) || c[r] < width) continue;
      if (width === 2 && r >= R_SMALL) continue;
      pool.push({ r, cost: breaks(r, width) });
    }
    pool.sort((a, b) => a.cost - b.cost || a.r - b.r);
    if (pool.length < k) return null;
    return pool.slice(0, k).flatMap((p) => take(p.r, width));
  };
  const chain = (width: number, len: number, from: number) => {
    for (let lo = from; lo + len - 1 <= R_A; lo++) {
      let ok = true;
      let cost = 0;
      for (let r = lo; ok && r < lo + len; r++) {
        ok = c[r] >= width;
        cost += c[r] === 4 ? 10 : 0;
      }
      if (!ok) continue;
      const cards: Card[] = [];
      for (let r = lo; r < lo + len; r++) cards.push(...take(r, width));
      out.push({ cards, cost, rank: lo });
    }
  };
  const withWings = (len: number, from: number, wing: 0 | 1 | 2) => {
    for (let lo = from; lo + len - 1 <= (len > 1 ? R_A : R_2); lo++) {
      let ok = true;
      for (let r = lo; ok && r < lo + len; r++) ok = c[r] >= 3;
      if (!ok) continue;
      const main: Card[] = [];
      const skip = new Set<number>();
      let cost = 0;
      for (let r = lo; r < lo + len; r++) {
        main.push(...take(r, 3));
        skip.add(r);
        cost += breaks(r, 3);
      }
      if (wing === 0) {
        out.push({ cards: main, cost, rank: lo });
        continue;
      }
      const w = kickers(wing, len, skip);
      if (w) out.push({ cards: [...main, ...w], cost, rank: lo });
    }
  };
  const fours = (from: number, wing: 1 | 2) => {
    for (let r = from; r <= R_2; r++) {
      if (c[r] !== 4) continue;
      const w = kickers(wing, 2, new Set([r]));
      if (w) out.push({ cards: [...take(r, 4), ...w], cost: 6, rank: r });
    }
  };

  if (prev && prev.kind !== 'bomb' && prev.kind !== 'rocket') {
    const from = prev.rank + 1;
    switch (prev.kind) {
      case 'single':
      case 'pair':
      case 'trio': {
        const w = prev.kind === 'single' ? 1 : prev.kind === 'pair' ? 2 : 3;
        for (const r of groups(w, from)) if (!(w === 2 && r >= R_SMALL)) out.push({ cards: take(r, w), cost: breaks(r, w), rank: r });
        break;
      }
      case 'trio_single':
        withWings(1, from, 1);
        break;
      case 'trio_pair':
        withWings(1, from, 2);
        break;
      case 'straight':
        chain(1, prev.len, from);
        break;
      case 'pair_straight':
        chain(2, prev.len, from);
        break;
      case 'plane':
        withWings(prev.len, from, 0);
        break;
      case 'plane_singles':
        withWings(prev.len, from, 1);
        break;
      case 'plane_pairs':
        withWings(prev.len, from, 2);
        break;
      case 'four_singles':
        fours(from, 1);
        break;
      case 'four_pairs':
        fours(from, 2);
        break;
    }
  } else if (!prev) {
    // Leading: each group as a whole, low first, then chains.
    for (let r = 0; r <= R_2; r++) {
      if (c[r] === 0 || c[r] === 4) continue;
      const main = take(r, c[r]);
      if (c[r] === 3) {
        const w = kickers(1, 1, new Set([r])) ?? kickers(2, 1, new Set([r]));
        out.push({ cards: w ? [...main, ...w] : main, cost: 0, rank: r });
      } else out.push({ cards: main, cost: 0, rank: r });
    }
    for (let len = 12; len >= 5; len--) chain(1, len, 0);
    for (let len = 10; len >= 3; len--) chain(2, len, 0);
    for (let len = 6; len >= 2; len--) withWings(len, 0, 0);
    if (!rocket) for (const r of [R_SMALL, R_BIG]) if (c[r]) out.push({ cards: take(r, 1), cost: 0, rank: r });
  }

  const sorted = out.sort((a, b) => a.cost - b.cost || a.rank - b.rank).map((x) => x.cards);
  const bombFrom = prev?.kind === 'bomb' ? prev.rank + 1 : 0;
  if (prev?.kind !== 'rocket') for (let r = bombFrom; r <= R_2; r++) if (c[r] === 4) sorted.push(take(r, 4));
  if (rocket && prev?.kind !== 'rocket') sorted.push(take(R_SMALL, 1).concat(take(R_BIG, 1)));

  const seen = new Set<string>();
  return sorted.filter((cards) => {
    const key = [...cards].sort((a, b) => a - b).join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Multiplier from 抢地主, bombs and spring, capped like the relay. */
export function multiplier(d: { rob: number; bombs: number; spring: boolean }, cap = 16): number {
  return Math.min(cap, 2 ** (d.rob + d.bombs) * (d.spring ? 2 : 1));
}

// ---- What the relay sends: one snapshot per change, from this player's seat ----

export type Role = 'landlord' | 'farmer';

export type SeatInfo = {
  name: string;
  /** Filled by the relay's own player (a program, no model calls). */
  bot: boolean;
  /** Cards still in hand. */
  left: number;
  /** Disconnected or timed out twice: the relay plays for them. */
  auto: boolean;
  online: boolean;
  ready: boolean;
};

/** The seat's latest move this trick: a bid, a pass, or cards. */
export type Move = {
  seat: Seat;
  bid?: 'call' | 'pass' | 'rob' | 'norob';
  cards?: Card[];
  pattern?: Pattern;
};

export type Doubles = { rob: number; bombs: number; spring: boolean };

export type Result = {
  winner: Seat;
  /** Each seat's win (+) or loss (−) in $, after the cap. */
  delta: [number, number, number];
  /** What was left in each hand. */
  hands: [Card[], Card[], Card[]];
  doubles: Doubles;
  multiplier: number;
  /** The seed behind this deal; sha256(seed) is `commit`. */
  seed: string;
};

export type Table = {
  id: string;
  /** Six digits for rooms made by a player; null for quick-match tables. */
  code: string | null;
  owner: Seat | null;
  base: number;
  phase: 'waiting' | 'bid' | 'play' | 'over';
  me: Seat;
  seats: [SeatInfo | null, SeatInfo | null, SeatInfo | null];
  hand: Card[];
  /** Face down (null) until the landlord takes them. */
  bottom: Card[] | null;
  landlord: Seat | null;
  turn: Seat | null;
  /** When the seat to move runs out of time, epoch ms. */
  deadline: number | null;
  /** True once someone has called, so a yes is 抢 rather than 叫. */
  rob: boolean;
  /** The play to beat; null when the seat to move leads. */
  last: Move | null;
  /** Each seat's latest move this round, for the bubbles on the table. */
  moves: [Move | null, Move | null, Move | null];
  doubles: Doubles;
  /** sha256 of the deal's seed, published before the deal. */
  commit: string;
  result: Result | null;
};

/** What the player asks the relay to do. */
export type Action =
  | { type: 'match'; base: number }
  | { type: 'cancel' }
  | { type: 'create'; base: number }
  | { type: 'join'; code: string }
  | { type: 'bots' }
  | { type: 'ready' }
  | { type: 'bid'; want: boolean }
  | { type: 'play'; cards: Card[] }
  | { type: 'pass' }
  | { type: 'auto'; on: boolean }
  | { type: 'leave' };

/** Base stakes on offer, in $. */
export const STAKES = [0.1, 0.5, 1, 2];
/** The most one deal can cost: the landlord's share at the cap. */
export const maxLoss = (base: number, cap = 16) => base * cap * 2;

/** The seat to the right (plays next) and to the left (played before) of `me`. */
export const nextSeat = (s: Seat): Seat => ((s + 1) % 3) as Seat;
export const prevSeat = (s: Seat): Seat => ((s + 2) % 3) as Seat;
