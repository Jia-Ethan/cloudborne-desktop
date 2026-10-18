// A stand-in for the relay's table, for the UI preview and the local 闯关
// prototype: it deals, runs the turns, and plays the other two seats with the
// hint list. Skills and scoring are rough approximations of the relay's; at a
// money table the relay is the referee.

import {
  HEROES,
  HERO_NAMES,
  classify,
  follow,
  hints,
  nextSeat,
  rankOf,
  wildPattern,
  type Action,
  type SkillArgs,
  type Card,
  type Field,
  type Hero,
  type Joker,
  type Move,
  type Seat,
  type SeatInfo,
  type Share,
  type Step,
  type Table,
} from './ddz';

const NAMES = ['Ethan', '', ''];
const JOKERS: Joker[] = ['straight', 'pilot', 'demo', 'raise', 'speed', 'control', 'last_stand', 'closer', 'trio'];
const FIELDS: Field[] = ['blast', 'spring', 'double', 'rally', 'overtime', 'throttle'];

const shuffle = <T>(xs: T[]) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** 闯关: I am always the landlord; the run sets skill uses and fixes the deal. */
export type SimRun = {
  skills: number;
  /** 先手 boss: the farmers lead. */
  farmersFirst?: boolean;
  /** Called on the dealt hands (mine with the bottom in it) before play starts. */
  setup?: (hands: [Card[], Card[], Card[]], me: Seat) => void;
};

/** One entry of the deal's log, with what the seat held after it. */
export type SimLog = { move: Move; left: number };

const seat = (name: string, hero: Hero, bot: boolean): SeatInfo => ({
  name: bot ? HERO_NAMES[hero] : name,
  bot,
  hero,
  joker: null,
  skills: 1,
  shown: null,
  left: 0,
  auto: false,
  online: true,
  ready: bot,
});

export class SimTable {
  table: Table;
  private hands: [Card[], Card[], Card[]] = [[], [], []];
  private bottom: Card[] = [];
  private passes = 0;
  private caller: Seat | null = null;
  private bidTurns = 0;
  private rob = 0;
  private bombs = 0;
  private plays: [number, number, number] = [0, 0, 0];
  /** 开源互换: the seat my DeepSeek looked at. */
  private peek: number | null = null;
  private trick: Move[] = [];
  private trickNo = 0;
  /** 蜂群: plays left that stand unopposed. */
  private swarm: [number, number, number] = [0, 0, 0];
  /** Every play and pass this deal, in order. */
  log: SimLog[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private onChange: (t: Table) => void,
    private opts: { delay: number; base: number; turnMs: number; code?: string | null; autoMe?: boolean; hero?: Hero; run?: SimRun },
  ) {
    const heroes = shuffle(HEROES);
    this.table = {
      id: 'sim',
      code: opts.code ?? null,
      owner: opts.code ? 0 : null,
      base: opts.base,
      phase: 'waiting',
      me: 0,
      seats: [seat(NAMES[0], opts.hero ?? heroes[0], false), null, null],
      hand: [],
      field: null,
      offers: null,
      bottom: null,
      landlord: null,
      turn: null,
      deadline: null,
      rob: false,
      last: null,
      moves: [null, null, null],
      skill: null,
      played: [],
      tracker: null,
      mult: 1,
      commit: '',
      result: null,
    };
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
  }

  private emit() {
    const t = this.table;
    t.hand = [...this.hands[0]];
    t.seats = t.seats.map((s, i) =>
      s ? { ...s, left: this.hands[i].length, shown: s.shown ? [...this.hands[i]] : null, peeked: this.peek === i && !s.shown ? [...this.hands[i]] : undefined } : s,
    ) as Table['seats'];
    t.mult = 2 ** (this.rob + this.bombs) * (t.field === 'double' ? 2 : 1);
    t.history = this.log.map((l) => l.move);
    this.onChange(structuredClone(t));
  }

  private later(fn: () => void, ms = this.opts.delay) {
    this.stop();
    this.timer = setTimeout(fn, ms);
  }

  /** Fill the empty seats. */
  seat(names = NAMES) {
    const t = this.table;
    const taken = t.seats[0]!.hero;
    const heroes = shuffle(HEROES.filter((h) => h !== taken));
    t.seats = [t.seats[0], seat(names[1], heroes[0], true), seat(names[2], heroes[1], true)];
    this.emit();
  }

  deal(first: Seat = 0) {
    const deck = shuffle(Array.from({ length: 54 }, (_, i) => i));
    this.hands = [deck.slice(0, 17), deck.slice(17, 34), deck.slice(34, 51)];
    this.bottom = deck.slice(51);
    const run = this.opts.run;
    Object.assign(this.table, {
      phase: 'bid',
      field: run ? null : shuffle(FIELDS)[0],
      offers: null,
      bottom: null,
      landlord: null,
      turn: first,
      rob: false,
      last: null,
      moves: [null, null, null],
      skill: null,
      played: [],
      tracker: null,
      commit: '9f2c4e…a71b',
      result: null,
    } satisfies Partial<Table>);
    this.table.seats.forEach((s, i) => s && Object.assign(s, { joker: null, skills: run && i === this.table.me ? run.skills : 1, shown: null }));
    this.peek = null;
    this.caller = null;
    this.bidTurns = this.rob = this.bombs = this.trickNo = 0;
    this.plays = [0, 0, 0];
    this.swarm = [0, 0, 0];
    this.trick = [];
    this.log = [];
    if (run) return this.runStart(run);
    this.arm();
    this.emit();
  }

  /** 闯关: no bidding and no joker pick; I take the bottom and play. */
  private runStart(run: SimRun) {
    const t = this.table;
    const me = t.me;
    this.hands[me] = [...this.hands[me], ...this.bottom];
    run.setup?.(this.hands, me);
    Object.assign(t, { phase: 'play', landlord: me, bottom: this.bottom, turn: run.farmersFirst ? nextSeat(me) : me } satisfies Partial<Table>);
    this.arm();
    this.emit();
  }

  private arm() {
    this.table.deadline = this.opts.turnMs ? Date.now() + this.opts.turnMs : null;
    const turn = this.table.turn;
    if (turn !== null && (turn !== this.table.me || this.opts.autoMe)) this.later(() => this.botMove(turn));
  }

  send(a: Action) {
    const me = this.table.me;
    const t = this.table;
    switch (a.type) {
      case 'ready':
        if (this.opts.run) return this.deal(0);
        this.seat();
        this.later(() => this.deal(0), 400);
        return;
      case 'bid':
        if (t.turn === me) this.bid(me, a.want);
        return;
      case 'joker':
        if (t.phase === 'joker' && t.offers) this.pick(me, t.offers[a.index]);
        return;
      case 'skill':
        if (t.turn === me) this.skill(me, a.args.copy ?? t.seats[me]!.hero, a.args);
        return;
      case 'play':
        if (t.turn === me) this.play(me, a.cards);
        return;
      case 'pass':
        if (t.turn === me) this.play(me, []);
        return;
    }
  }

  private bid(s: Seat, want: boolean) {
    const t = this.table;
    const robbing = this.caller !== null;
    t.moves[s] = { seat: s, bid: want ? (robbing ? 'rob' : 'call') : robbing ? 'norob' : 'pass' };
    this.bidTurns++;
    if (want) {
      if (this.caller === null) this.caller = s;
      else this.rob++;
      t.landlord = s;
      t.rob = true;
    }
    if (this.bidTurns < 3 || (this.bidTurns === 3 && this.caller !== null && t.landlord !== this.caller)) {
      t.turn = this.bidTurns < 3 ? nextSeat(s) : this.caller;
      this.arm();
      this.emit();
      return;
    }
    if (this.caller === null) {
      this.emit();
      this.later(() => this.deal(nextSeat(s)), 900);
      return;
    }
    const lord = t.landlord as Seat;
    this.hands[lord] = [...this.hands[lord], ...this.bottom];
    const offers = shuffle(JOKERS);
    Object.assign(t, {
      phase: 'joker',
      bottom: this.bottom,
      turn: null,
      deadline: this.opts.turnMs ? Date.now() + 20000 : null,
      offers: offers.slice(0, 3),
      moves: [null, null, null],
    } satisfies Partial<Table>);
    t.seats.forEach((x, i) => {
      if (x && i !== t.me) x.joker = offers[3 + i];
    });
    this.emit();
    if (this.opts.autoMe) this.later(() => this.pick(t.me, offers[0]));
  }

  private pick(s: Seat, j: Joker) {
    const t = this.table;
    t.seats[s]!.joker = j;
    t.offers = null;
    Object.assign(t, { phase: 'play', turn: t.landlord });
    this.arm();
    this.emit();
  }

  private skill(s: Seat, hero: Hero, args: SkillArgs = {}) {
    const t = this.table;
    const info = t.seats[s]!;
    if (info.skills <= 0) return;
    if (hero === 'minimax') {
      // 混合专家 is a lead: the skill banner, then the play itself.
      const p = !t.last && args.cards && args.wild !== undefined && args.rank !== undefined ? wildPattern(args.cards, args.wild, args.rank) : null;
      if (!p) return;
      info.skills--;
      t.skill = { seat: s, hero: info.hero, skill: hero, target: null, rank: args.rank, cards: [args.wild!] };
      this.play(s, args.cards!, { card: args.wild!, as: args.rank! });
      return;
    }
    const last = t.last;
    let target: Seat | null = null;
    switch (hero) {
      case 'claude':
      case 'gpt':
        if (!last?.cards) return;
        target = last.seat;
        for (const m of hero === 'gpt' ? this.trick : [last]) {
          this.hands[m.seat].push(...(m.cards ?? []));
          const l = this.log.find((x) => x.move.seq === m.seq);
          if (l) l.move = { ...l.move, reverted: true };
        }
        this.trick = [];
        t.last = null;
        t.moves = [null, null, null];
        this.passes = 0;
        break;
      case 'deepseek': {
        if (args.target === undefined || (args.give?.length ?? 0) > 1) return;
        target = args.target;
        const give = args.give?.[0];
        const theirs = this.hands[target].filter((c) => rankOf(c) < 13).sort((a, b) => b - a)[0];
        if (give !== undefined && theirs !== undefined && this.hands[s].includes(give)) {
          this.hands[s] = [...this.hands[s].filter((c) => c !== give), theirs];
          this.hands[target] = [...this.hands[target].filter((c) => c !== theirs), give];
        }
        info.shown = [];
        this.peek = args.target;
        break;
      }
      case 'gemini': {
        // 长记忆: as many cards back from finished tricks as are thrown away.
        const take = args.cards ?? [];
        const give = args.give ?? [];
        if (take.length === 0 || take.length > 3 || take.length !== give.length || !take.every((c) => t.played.includes(c)) || !give.every((c) => this.hands[s].includes(c))) return;
        this.hands[s] = [...this.hands[s].filter((c) => !give.includes(c)), ...take];
        t.played = t.played.filter((c) => !take.includes(c));
        if (s === t.me) t.tracker = this.tracker();
        break;
      }
      case 'grok': {
        // 求证: a true count; if any, one of them for my lowest card.
        if (args.target === undefined || args.target === s || args.rank === undefined) return;
        target = args.target;
        const theirs = this.hands[target].filter((c) => rankOf(c) === args.rank);
        info.skills--;
        t.skill = { seat: s, hero: info.hero, skill: hero, target, rank: args.rank, count: theirs.length };
        if (theirs.length) {
          const gave = Math.min(...this.hands[s]);
          this.hands[s] = [...this.hands[s].filter((c) => c !== gave), theirs[0]];
          this.hands[target] = [...this.hands[target].filter((c) => c !== theirs[0]), gave];
        }
        return this.emit();
      }
      case 'glm': {
        // 协作: throw away up to 3 (4 as landlord); a farmer's mate drops a single.
        const drop = args.cards ?? [];
        if (drop.length === 0 || drop.length > (s === t.landlord ? 4 : 3) || drop.length >= this.hands[s].length || !drop.every((c) => this.hands[s].includes(c))) return;
        this.hands[s] = this.hands[s].filter((c) => !drop.includes(c));
        if (s !== t.landlord && t.landlord !== null) {
          const mate = (3 - s - t.landlord) as Seat;
          if (this.hands[mate].length > 1) this.hands[mate] = this.hands[mate].slice().sort((a, b) => a - b).slice(1);
          target = mate;
        }
        break;
      }
      case 'kimi':
        // 蜂群: my next two plays stand unopposed.
        if (this.swarm[s]) return;
        this.swarm[s] = 2;
        break;
      default:
        return;
    }
    info.skills--;
    t.skill = { seat: s, hero: info.hero, skill: hero, target };
    this.emit();
  }

  /** 记牌器: how many of each rank are not in my hand or played yet. */
  private tracker(): number[] {
    const out = [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1, 1];
    for (const c of [...this.hands[this.table.me], ...this.table.played]) out[rankOf(c)]--;
    return out;
  }

  private endTrick() {
    const t = this.table;
    t.played.push(...this.trick.flatMap((m) => m.cards ?? []));
    t.last = null;
    this.passes = 0;
    this.trick = [];
    this.trickNo++;
    if (t.tracker) t.tracker = this.tracker();
  }

  private play(s: Seat, cards: Card[], wild?: Move['wild']) {
    const t = this.table;
    if (cards.length === 0) {
      if (!t.last) return;
      t.moves[s] = { seat: s };
      this.log.push({ move: { seat: s, seq: this.log.length + 1, trick: this.trickNo }, left: this.hands[s].length });
      this.passes++;
      t.turn = nextSeat(s);
      if (this.passes === 2) this.endTrick();
      this.arm();
      this.emit();
      return;
    }
    const pattern = wild ? wildPattern(cards, wild.card, wild.as) : t.last?.pattern ? follow(cards, t.last.pattern) : classify(cards);
    if (!pattern) return;
    if (!cards.every((c) => this.hands[s].includes(c))) return;
    const move: Move = { seat: s, cards: [...cards], pattern, seq: this.log.length + 1, trick: this.trickNo, ...(wild ? { wild } : {}) };
    if (!t.last) t.moves = [null, null, null];
    this.hands[s] = this.hands[s].filter((c) => !cards.includes(c));
    this.log.push({ move, left: this.hands[s].length });
    if (pattern.kind === 'bomb' || pattern.kind === 'rocket') this.bombs++;
    this.plays[s]++;
    t.last = move;
    this.trick.push(move);
    this.passes = 0;
    t.moves[s] = move;
    if (this.hands[s].length === 0) return this.finish(s);
    if (this.swarm[s] > 0) {
      // 蜂群: nobody answers; I lead again.
      this.swarm[s]--;
      this.endTrick();
      t.moves = [null, null, null];
      t.moves[s] = move;
      t.turn = s;
      this.arm();
      this.emit();
      return;
    }
    t.turn = nextSeat(s);
    t.moves[t.turn] = null;
    this.arm();
    this.emit();
  }

  private finish(winner: Seat) {
    const t = this.table;
    const lord = t.landlord as Seat;
    const farmers = ([0, 1, 2] as Seat[]).filter((s) => s !== lord);
    const spring = winner === lord ? farmers.every((s) => this.plays[s] === 0) : this.plays[lord] === 1;
    const lordWon = winner === lord;
    const shares = farmers.map((f): Share => {
      const steps: Step[] = [];
      const win = lordWon ? lord : f;
      if (t.seats[win]?.joker === 'raise') steps.push({ source: 'raise', seat: win, add: 1 });
      if (t.seats[win]?.joker === 'control') steps.push({ source: 'control', seat: win, add: 0.9 });
      if (t.field === 'double') steps.push({ source: 'field_double', seat: null, times: 2 });
      for (let i = 0; i < this.rob; i++) steps.push({ source: 'rob', seat: null, times: 2 });
      for (let i = 0; i < this.bombs; i++) steps.push({ source: 'bomb', seat: null, times: t.field === 'blast' ? 3 : 2 });
      if (spring) steps.push({ source: lordWon ? 'spring' : 'anti_spring', seat: null, times: t.field === 'spring' ? 4 : 2 });
      if (t.seats[win]?.joker === 'speed' && this.plays[win] <= 6) steps.push({ source: 'speed', seat: win, times: 2 });
      let mult = 1;
      for (const st of steps) mult = st.add ? mult + st.add : mult * (st.times ?? 1);
      return { farmer: f, steps, mult: Math.round(mult * 100) / 100 };
    });
    const sign = lordWon ? 1 : -1;
    const delta: [number, number, number] = [0, 0, 0];
    for (const sh of shares) {
      delta[lord] += sign * sh.mult * t.base;
      delta[sh.farmer] -= sign * sh.mult * t.base;
    }
    Object.assign(t, {
      phase: 'over',
      turn: null,
      deadline: null,
      result: { winner, shares: shares as [Share, Share], delta, hands: [...this.hands], seed: '3b1f…c09e' },
    } satisfies Partial<Table>);
    this.emit();
  }

  private botMove(s: Seat) {
    const t = this.table;
    const hand = this.hands[s];
    if (t.phase === 'bid') {
      const strong = hand.filter((c) => rankOf(c) >= 12).length;
      return this.bid(s, strong >= (t.rob ? 4 : 3));
    }
    const prev = t.last && t.last.seat !== s ? (t.last.pattern ?? null) : null;
    const lord = t.landlord;
    const mateLed = prev && t.last && lord !== null && t.last.seat !== lord && s !== lord;
    // Now and then a bot uses its skill, so the banner shows up in previews.
    const info = t.seats[s]!;
    if (info.skills > 0 && prev && !mateLed && (info.hero === 'claude' || info.hero === 'gpt') && Math.random() < 0.5) {
      this.skill(s, info.hero);
      return this.later(() => this.botMove(s));
    }
    const options = hints(hand, prev);
    if (prev && (options.length === 0 || mateLed)) return this.play(s, []);
    this.play(s, options[0] ?? [hand[0]]);
  }
}
