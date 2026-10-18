// 闯关 (the run mode), local prototype: three acts of three deals against two
// bot farmers, always as landlord. A deal is cleared by winning it with a
// score of at least the target; between deals the shop sells jokers that last
// the whole run, upgrades to how much each kind of play scores, and changes
// to the deal. Nothing here touches the balance; nothing is saved but the best
// result. See docs/DOUDIZHU-IMPROVEMENT-2026-10-15.md (v0.9.15).

import { HEROES, R_2, R_BIG, R_SMALL, rankOf, type Card, type Hero, type Kind, type Move, type Seat } from './ddz';
import type { SimLog, SimRun } from './ddzSim';

export const ACTS = 3;
export const LEVELS = 3;
export const BASE_CHIPS = 10;
export const START_GOLD = 4;
export const START_SLOTS = 3;
export const MAX_SLOTS = 5;
export const MAX_CUTS = 3;
/** Deals a run may lose (or win short of the target) before it ends; each replays the stage. */
export const LIVES = 3;

/** Target score for act a (0..2), level l (0..2; 2 is the boss). Tuned with DDZ_RUN_SIM. */
export function target(act: number, level: number): number {
  const base = [40, 55, 80][level];
  return Math.round((base * [1, 3, 6.5][act]) / 5) * 5;
}

// ---------------------------------------------------------------- kinds

/** Plays grouped the way the shop upgrades them. */
export type Group = 'single' | 'pair' | 'trio' | 'straight' | 'pair_straight' | 'plane' | 'bomb';
export const GROUPS: Group[] = ['single', 'pair', 'trio', 'straight', 'pair_straight', 'plane', 'bomb'];

export const groupOf = (k: Kind): Group =>
  k === 'trio' || k === 'trio_single' || k === 'trio_pair'
    ? 'trio'
    : k === 'plane' || k === 'plane_singles' || k === 'plane_pairs'
      ? 'plane'
      : k === 'bomb' || k === 'rocket' || k === 'four_singles' || k === 'four_pairs'
        ? 'bomb'
        : k;

/** Chips one play earns before upgrades and jokers. */
export function kindChips(k: Kind, len: number): number {
  switch (k) {
    case 'single': return 2;
    case 'pair': return 4;
    case 'trio': return 8;
    case 'trio_single': return 10;
    case 'trio_pair': return 12;
    case 'straight': return 3 * len;
    case 'pair_straight': return 6 * len;
    case 'plane': return 10 * len;
    case 'plane_singles': return 12 * len;
    case 'plane_pairs': return 14 * len;
    case 'four_singles': return 16;
    case 'four_pairs': return 18;
    case 'bomb': return 30;
    case 'rocket': return 40;
  }
}

/** Chips each upgrade level adds to every play of the group. */
export const LEVEL_CHIPS: Record<Group, number> = { single: 3, pair: 5, trio: 8, straight: 10, pair_straight: 10, plane: 15, bomb: 15 };

// ---------------------------------------------------------------- jokers

export type Rarity = 'common' | 'rare' | 'legend';
export type RunJokerId =
  | 'straight' | 'pair' | 'trio' | 'single' | 'pilot' | 'long' | 'closer' | 'control' | 'first' | 'clearance'
  | 'lowkey' | 'speed' | 'demo' | 'compound' | 'ledger' | 'friends' | 'miser'
  | 'dragon' | 'allin';

export const PRICE: Record<Rarity, number> = { common: 4, rare: 6, legend: 9 };

export const RUN_JOKERS: Record<RunJokerId, Rarity> = {
  straight: 'common',
  pair: 'common',
  trio: 'common',
  single: 'common',
  pilot: 'common',
  long: 'common',
  closer: 'common',
  control: 'common',
  first: 'common',
  clearance: 'common',
  lowkey: 'rare',
  speed: 'rare',
  demo: 'rare',
  compound: 'rare',
  ledger: 'rare',
  friends: 'rare',
  miser: 'rare',
  dragon: 'legend',
  allin: 'legend',
};

/** A joker held in a slot; growing ones keep their bonus in `grow`. */
export type HeldJoker = { id: RunJokerId; grow: number };

// ---------------------------------------------------------------- bosses

export type Boss = 'first' | 'offline' | 'audit' | 'throttle' | 'crown' | 'inflation';
export const BOSSES: Boss[] = ['first', 'offline', 'audit', 'throttle', 'crown', 'inflation'];

// ---------------------------------------------------------------- run state

/** Changes to my deal, applied each deal in order. */
export type DeckMod = { kind: 'add'; rank: number } | { kind: 'cut' };

export type ShopItem =
  | { kind: 'joker'; id: RunJokerId; price: number; sold?: boolean }
  | { kind: 'level'; group: Group; price: number; sold?: boolean }
  | { kind: 'add'; rank: number; price: number; sold?: boolean }
  | { kind: 'cut'; price: number; sold?: boolean }
  | { kind: 'skill'; price: number; sold?: boolean }
  | { kind: 'slot'; price: number; sold?: boolean };

export type Run = {
  seed: number;
  hero: Hero;
  /** 0..2 */
  act: number;
  /** 0..2; 2 is the boss. */
  level: number;
  gold: number;
  slots: number;
  jokers: HeldJoker[];
  levels: Record<Group, number>;
  deck: DeckMod[];
  /** Skill uses per deal. */
  skills: number;
  /** The boss for each act, drawn at the start. */
  bosses: Boss[];
  /** Scores of the cleared deals. */
  scores: number[];
  shop: ShopItem[] | null;
  rerolls: number;
  lives: number;
  /** Deals played at this stage, so a replay deals differently. */
  tries: number;
};

/** Small seeded generator so a run (and its shops) can be replayed. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 2 ** 32;
  };
}

const pick = <T>(xs: T[], r: () => number) => xs[Math.floor(r() * xs.length)];
function shuffled<T>(xs: T[], r: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Three heroes to start a run with. */
export const heroOffer = (seed: number): Hero[] => shuffled(HEROES, rng(seed ^ 0x9e37)).slice(0, 3);

export function newRun(seed: number, hero: Hero): Run {
  const r = rng(seed);
  return {
    seed,
    hero,
    act: 0,
    level: 0,
    gold: START_GOLD,
    slots: START_SLOTS,
    jokers: [],
    levels: { single: 0, pair: 0, trio: 0, straight: 0, pair_straight: 0, plane: 0, bomb: 0 },
    deck: [],
    skills: 1,
    bosses: shuffled(BOSSES, r).slice(0, ACTS),
    scores: [],
    shop: null,
    rerolls: 0,
    lives: LIVES,
    tries: 0,
  };
}

/** A lost deal, or a win short of the target: a life, and the stage again. Null when none are left. */
export function fail(run: Run): Run | null {
  return run.lives > 1 ? { ...run, lives: run.lives - 1, tries: run.tries + 1 } : null;
}

/** The seed for this stage's deal. */
export const dealSeed = (run: Run) => run.seed * 7 + stage(run) * 131 + run.tries * 17;

export const bossOf = (run: Run): Boss | null => (run.level === LEVELS - 1 ? run.bosses[run.act] : null);
export const runTarget = (run: Run) => Math.round(target(run.act, run.level) * (bossOf(run) === 'inflation' ? 1.5 : 1));
export const stage = (run: Run) => run.act * LEVELS + run.level;

/** How the sim should set up this deal: skills, who leads, my hand. */
export function dealSetup(run: Run, seed: number): SimRun {
  const boss = bossOf(run);
  return {
    skills: boss === 'offline' ? 0 : run.skills,
    farmersFirst: boss === 'first',
    setup: (hands, me) => {
      const r = rng(seed);
      const others = ([0, 1, 2] as Seat[]).filter((s) => s !== me);
      const lowest = () => [...hands[me]].sort((a, b) => a - b)[0];
      for (const m of run.deck) {
        if (m.kind === 'cut') {
          if (hands[me].length > 5) hands[me].splice(hands[me].indexOf(lowest()), 1);
          continue;
        }
        // 加牌: one card of the rank from a farmer, for my lowest card.
        const from = shuffled(others, r).find((s) => hands[s].some((c) => rankOf(c) === m.rank));
        if (from === undefined) continue;
        const got = hands[from].find((c) => rankOf(c) === m.rank)!;
        const gave = lowest();
        if (rankOf(gave) >= m.rank) continue;
        hands[me].splice(hands[me].indexOf(gave), 1, got);
        hands[from].splice(hands[from].indexOf(got), 1, gave);
      }
      if (boss === 'crown') {
        // 王权: my jokers go to the farmers, for their lowest cards.
        for (const c of hands[me].filter((x) => rankOf(x) >= R_SMALL)) {
          const to = pick(others, r);
          const low = [...hands[to]].sort((a, b) => a - b)[0];
          hands[me].splice(hands[me].indexOf(c), 1, low);
          hands[to].splice(hands[to].indexOf(low), 1, c);
        }
      }
    },
  };
}

// ---------------------------------------------------------------- scoring

/** One line of the score: a play's chips, or a joker's or rule's part. */
export type ScoreLine = { source: string; chips?: number; add?: number; times?: number; seq?: number };

export type Score = { chips: number; mult: number; score: number; lines: ScoreLine[] };

/**
 * A deal's score from its log, mine only: chips from each play, then the
 * multiplier. `done` adds what only counts at the end (finish bonuses,
 * spring); before that the score is what has been banked so far.
 */
export function scoreDeal(run: Run, log: SimLog[], me: Seat, done: boolean, gold = run.gold): Score {
  const boss = bossOf(run);
  const off = boss === 'offline' ? 1 : 0; // 断网: the leftmost joker sleeps
  const active = run.jokers.slice(off);
  const has = (id: RunJokerId) => active.filter((j) => j.id === id);
  const live = log.filter((l) => !l.move.reverted);
  const mine = live.filter((l) => l.move.seat === me && l.move.cards?.length && l.move.pattern);
  const lines: ScoreLine[] = [];
  let chips = BASE_CHIPS;
  let add = 0;
  let times = 1;
  const bump = (source: string, a: number, seq?: number) => {
    if (!a) return;
    add += a;
    lines.push({ source, add: a, seq });
  };
  const mul = (source: string, x: number, seq?: number) => {
    times *= x;
    lines.push({ source, times: x, seq });
  };
  lines.push({ source: 'base', chips: BASE_CHIPS });

  // Who took each trick: the last play before two passes.
  const took = new Set<number>();
  for (let i = 0; i < live.length; i++) {
    const m = live[i].move;
    if (!m.cards?.length) continue;
    const next = live.slice(i + 1, i + 3);
    const swarmEnd = live[i + 1]?.move.seat === m.seat; // 蜂群: led again
    if ((next.length === 2 && next.every((n) => !n.move.cards?.length)) || swarmEnd || i === live.length - 1) took.add(m.seq ?? i);
  }

  let longest = 0;
  mine.forEach((l, k) => {
    const m = l.move;
    const p = m.pattern!;
    const g = groupOf(p.kind);
    const seq = m.seq;
    const before = l.left + m.cards!.length;
    let c = kindChips(p.kind, p.len) + LEVEL_CHIPS[g] * run.levels[g];
    if (boss === 'throttle' && p.kind === 'single') c = 0;
    if (p.kind === 'straight') longest = Math.max(longest, p.len);
    const counts = !(boss === 'throttle' && p.kind === 'single');
    if (counts) {
      for (const _ of has('long')) if (p.kind === 'straight') c += 3 * p.len;
      for (const _ of has('pair')) if (p.kind === 'pair') c += 8;
      for (const _ of has('single')) if (p.kind === 'single') c += 4;
      for (const _ of has('clearance')) if (before <= 4) c *= 2;
      for (const _ of has('closer')) if (done && k === mine.length - 1) c *= 3;
    }
    chips += c;
    lines.push({ source: `kind.${p.kind}`, chips: c, seq });
    if (counts) {
      for (const _ of has('straight')) if (p.kind === 'straight' || p.kind === 'pair_straight') bump('j.straight', 2, seq);
      for (const _ of has('trio')) if (g === 'trio') bump('j.trio', 2, seq);
      for (const _ of has('pilot')) if (g === 'plane') bump('j.pilot', 5, seq);
      for (const _ of has('control')) if (took.has(seq ?? -1)) bump('j.control', 1, seq);
      for (const _ of has('first')) if (k === 0 && took.has(seq ?? -1)) bump('j.first', 3, seq);
    }
    if (p.kind === 'bomb' || p.kind === 'rocket') {
      if (boss !== 'audit') mul(p.kind === 'rocket' ? 'rocket' : 'bomb', 2, seq);
      for (const _ of has('demo')) mul('j.demo', 2, seq);
    }
  });

  for (const j of has('compound')) bump('j.compound', j.grow);
  for (const j of has('ledger')) bump('j.ledger', j.grow);
  for (const _ of has('friends')) bump('j.friends', run.jokers.length);
  for (const _ of has('miser')) bump('j.miser', Math.floor(gold / 5));
  for (const _ of has('allin')) mul('j.allin', 3);

  if (done) {
    const farmersPlayed = live.some((l) => l.move.seat !== me && l.move.cards?.length);
    const big = mine.some((l) => l.move.cards!.some((c) => rankOf(c) >= R_2));
    for (const _ of has('speed')) if (mine.length <= 7) mul('j.speed', 2);
    for (const _ of has('lowkey')) if (!big) mul('j.lowkey', 2);
    for (const _ of has('dragon')) if (longest >= 8) mul('j.dragon', 3);
    if (!farmersPlayed) mul('spring', 2);
  }
  const mult = (1 + add) * times;
  return { chips, mult: Math.round(mult * 100) / 100, score: Math.round(chips * mult), lines };
}

// ---------------------------------------------------------------- after a deal

/** Gold for clearing a deal: a base, a bonus for beating the target, and interest. */
export function reward(run: Run, score: number): { base: number; over: number; interest: number } {
  const t = runTarget(run);
  return {
    base: bossOf(run) ? 6 : 4,
    over: Math.min(3, Math.floor((score / t - 1) / 0.5)),
    interest: Math.min(3, Math.floor(run.gold / 5)),
  };
}

/** Clear the deal: bank the gold, grow the jokers that grow, and open the shop. Returns null when the run is won. */
export function clear(run: Run, score: number, log: SimLog[], me: Seat): Run | null {
  const g = reward(run, score);
  const myBombs = log.filter((l) => !l.move.reverted && l.move.seat === me && (l.move.pattern?.kind === 'bomb' || l.move.pattern?.kind === 'rocket')).length;
  const jokers = run.jokers.map((j) =>
    j.id === 'compound' ? { ...j, grow: j.grow + 1 } : j.id === 'ledger' ? { ...j, grow: j.grow + myBombs } : j,
  );
  const next: Run = {
    ...run,
    jokers,
    gold: run.gold + g.base + g.over + g.interest,
    scores: [...run.scores, score],
    level: (run.level + 1) % LEVELS,
    act: run.act + (run.level === LEVELS - 1 ? 1 : 0),
    rerolls: 0,
    tries: 0,
  };
  if (next.act >= ACTS) return null;
  return { ...next, shop: stock(next, 0) };
}

/** The shop's shelves for this stop; a reroll draws again. */
export function stock(run: Run, reroll: number): ShopItem[] {
  const r = rng(run.seed * 31 + stage(run) * 7919 + reroll * 104729);
  const held = new Set(run.jokers.map((j) => j.id));
  const roll = (): Rarity => {
    const x = r();
    const legend = [0.03, 0.07, 0.12][run.act];
    const rare = [0.25, 0.32, 0.38][run.act];
    return x < legend ? 'legend' : x < legend + rare ? 'rare' : 'common';
  };
  const jokers: ShopItem[] = [];
  const ids = Object.keys(RUN_JOKERS) as RunJokerId[];
  for (let tries = 0; jokers.length < 3 && tries < 50; tries++) {
    const rarity = roll();
    const id = pick(ids.filter((i) => RUN_JOKERS[i] === rarity && !held.has(i) && !jokers.some((x) => x.kind === 'joker' && x.id === i)), r);
    if (id) jokers.push({ kind: 'joker', id, price: PRICE[rarity] });
  }
  const groups = shuffled(GROUPS, r).slice(0, 2);
  const out: ShopItem[] = [
    ...jokers,
    ...groups.map((g): ShopItem => ({ kind: 'level', group: g, price: 3 + run.levels[g] })),
    r() < 0.5 && run.deck.filter((m) => m.kind === 'cut').length < MAX_CUTS
      ? { kind: 'cut', price: 5 }
      : { kind: 'add', rank: pick([R_2 - 1, R_2, R_SMALL, R_BIG], r), price: 5 },
    { kind: 'skill', price: 6 + 2 * (run.skills - 1) },
  ];
  if (run.slots < MAX_SLOTS) out.push({ kind: 'slot', price: 8 + 4 * (run.slots - START_SLOTS) });
  return out;
}

export const REROLL_PRICE = 2;

export function reroll(run: Run): Run | null {
  if (run.gold < REROLL_PRICE) return null;
  const n = run.rerolls + 1;
  return { ...run, gold: run.gold - REROLL_PRICE, rerolls: n, shop: stock(run, n) };
}

/** Buy shelf i, or null when it cannot be bought. */
export function buy(run: Run, i: number): Run | null {
  const it = run.shop?.[i];
  if (!it || it.sold || run.gold < it.price) return null;
  const shop = run.shop!.map((x, k) => (k === i ? { ...x, sold: true } : x));
  const paid = { ...run, gold: run.gold - it.price, shop };
  switch (it.kind) {
    case 'joker':
      if (run.jokers.length >= run.slots) return null;
      return { ...paid, jokers: [...run.jokers, { id: it.id, grow: 0 }] };
    case 'level':
      return { ...paid, levels: { ...run.levels, [it.group]: run.levels[it.group] + 1 } };
    case 'add':
      return { ...paid, deck: [...run.deck, { kind: 'add', rank: it.rank }] };
    case 'cut':
      return { ...paid, deck: [...run.deck, { kind: 'cut' }] };
    case 'skill':
      return { ...paid, skills: run.skills + 1 };
    case 'slot':
      return { ...paid, slots: run.slots + 1 };
  }
}

export const sellPrice = (id: RunJokerId) => Math.floor(PRICE[RUN_JOKERS[id]] / 2);

export function sell(run: Run, k: number): Run {
  const j = run.jokers[k];
  if (!j) return run;
  return { ...run, gold: run.gold + sellPrice(j.id), jokers: run.jokers.filter((_, x) => x !== k) };
}

/** Swap two slots: order matters for 断网, which silences the leftmost. */
export function moveJoker(run: Run, k: number, by: -1 | 1): Run {
  const to = k + by;
  if (to < 0 || to >= run.jokers.length) return run;
  const jokers = [...run.jokers];
  [jokers[k], jokers[to]] = [jokers[to], jokers[k]];
  return { ...run, jokers };
}

// ---------------------------------------------------------------- best result

const BEST_KEY = 'cloudborne.ddz.run.best';
export type Best = { stage: number; total: number };

export function readBest(): Best | null {
  try {
    const v = JSON.parse(localStorage.getItem(BEST_KEY) ?? 'null');
    return v && typeof v.stage === 'number' && typeof v.total === 'number' ? v : null;
  } catch {
    return null;
  }
}

/** Keep the furthest stage reached, then the higher total. */
export function saveBest(b: Best): Best {
  const cur = readBest();
  const better = !cur || b.stage > cur.stage || (b.stage === cur.stage && b.total > cur.total);
  if (better) {
    try {
      localStorage.setItem(BEST_KEY, JSON.stringify(b));
    } catch {
      /* private mode */
    }
  }
  return better ? b : cur!;
}

export const cardRankName = (r: number) => (r === R_BIG ? 'bigJoker' : r === R_SMALL ? 'smallJoker' : null);
export type { Card, Move };
