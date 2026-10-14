// A stand-in for the relay's table, for the UI preview only: it deals, runs
// the turns, and plays the other two seats with the hint list. Skills and
// scoring are rough approximations of the relay's; the relay is the referee.

import {
  HEROES,
  classify,
  follow,
  hints,
  nextSeat,
  rankOf,
  type Action,
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

const NAMES = ['我', '阿青', '小满'];
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

const seat = (name: string, hero: Hero, bot: boolean): SeatInfo => ({
  name,
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
  private trick: Move[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private onChange: (t: Table) => void,
    private opts: { delay: number; base: number; turnMs: number; code?: string | null; autoMe?: boolean; hero?: Hero },
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
    t.seats = t.seats.map((s, i) => (s ? { ...s, left: this.hands[i].length, shown: s.shown ? [...this.hands[i]] : null } : s)) as Table['seats'];
    t.mult = 2 ** (this.rob + this.bombs) * (t.field === 'double' ? 2 : 1);
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
    Object.assign(this.table, {
      phase: 'bid',
      field: shuffle(FIELDS)[0],
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
    this.table.seats.forEach((s) => s && Object.assign(s, { joker: null, skills: 1, shown: null }));
    this.caller = null;
    this.bidTurns = this.rob = this.bombs = 0;
    this.plays = [0, 0, 0];
    this.trick = [];
    this.arm();
    this.emit();
  }

  private arm() {
    this.table.deadline = Date.now() + this.opts.turnMs;
    const turn = this.table.turn;
    if (turn !== null && (turn !== this.table.me || this.opts.autoMe)) this.later(() => this.botMove(turn));
  }

  send(a: Action) {
    const me = this.table.me;
    const t = this.table;
    switch (a.type) {
      case 'ready':
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
        if (t.turn === me) this.skill(me, a.args.copy ?? t.seats[me]!.hero);
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
      deadline: Date.now() + 15000,
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

  private skill(s: Seat, hero: Hero) {
    const t = this.table;
    const info = t.seats[s]!;
    if (info.skills <= 0) return;
    const last = t.last;
    let target: Seat | null = null;
    switch (hero) {
      case 'claude':
      case 'gpt':
        if (!last?.cards) return;
        target = last.seat;
        for (const m of hero === 'gpt' ? this.trick : [last]) this.hands[m.seat].push(...(m.cards ?? []));
        this.trick = [];
        t.last = null;
        t.moves = [null, null, null];
        this.passes = 0;
        break;
      case 'deepseek':
        info.shown = [];
        break;
      case 'gemini':
        t.tracker = [4, 4, 4, 3, 2, 4, 4, 1, 2, 4, 3, 2, 1, 1, 0];
        break;
    }
    info.skills--;
    t.skill = { seat: s, hero: info.hero, skill: hero, target };
    this.emit();
  }

  private play(s: Seat, cards: Card[]) {
    const t = this.table;
    if (cards.length === 0) {
      if (!t.last) return;
      t.moves[s] = { seat: s };
      this.passes++;
      t.turn = nextSeat(s);
      if (this.passes === 2) {
        t.played.push(...this.trick.flatMap((m) => m.cards ?? []));
        t.last = null;
        this.passes = 0;
        this.trick = [];
      }
      this.arm();
      this.emit();
      return;
    }
    const pattern = t.last?.pattern ? follow(cards, t.last.pattern) : classify(cards);
    if (!pattern) return;
    const move: Move = { seat: s, cards: [...cards], pattern };
    if (!t.last) t.moves = [null, null, null];
    this.hands[s] = this.hands[s].filter((c) => !cards.includes(c));
    if (pattern.kind === 'bomb' || pattern.kind === 'rocket') this.bombs++;
    this.plays[s]++;
    t.last = move;
    this.trick.push(move);
    this.passes = 0;
    t.moves[s] = move;
    if (this.hands[s].length === 0) return this.finish(s);
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
      for (const s of [lord, f]) if (t.seats[s]?.shown) steps.push({ source: 'deepseek', seat: s as Seat, times: 2.5 });
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
