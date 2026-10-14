// A stand-in for the relay's table, for the UI preview and tests only: it
// deals, runs the turns and plays the other two seats with the hint list.
// The real game is refereed by the relay; nothing here ships as a mode.

import { classify, follow, hints, multiplier, nextSeat, rankOf, type Action, type Card, type Move, type Seat, type Table } from './ddz';

const NAMES = ['我', '阿青', '小满'];

export class SimTable {
  table: Table;
  private hands: [Card[], Card[], Card[]] = [[], [], []];
  private bottom: Card[] = [];
  private passes = 0;
  private caller: Seat | null = null;
  private bidTurns = 0;
  private plays: [number, number, number] = [0, 0, 0];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private onChange: (t: Table) => void,
    private opts: {
      delay: number;
      base: number;
      turnMs: number;
      code?: string | null;
      autoMe?: boolean;
    } = { delay: 700, base: 1, turnMs: 20000 },
  ) {
    this.table = {
      id: 'sim',
      code: opts.code ?? null,
      owner: opts.code ? 0 : null,
      base: opts.base,
      phase: 'waiting',
      me: 0,
      seats: [
        {
          name: NAMES[0],
          bot: false,
          left: 0,
          auto: false,
          online: true,
          ready: false,
        },
        null,
        null,
      ],
      hand: [],
      bottom: null,
      landlord: null,
      turn: null,
      deadline: null,
      rob: false,
      last: null,
      moves: [null, null, null],
      doubles: { rob: 0, bombs: 0, spring: false },
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
    t.seats = t.seats.map((s, i) => (s ? { ...s, left: this.hands[i].length } : s)) as Table['seats'];
    this.onChange(structuredClone(t));
  }

  private later(fn: () => void, ms = this.opts.delay) {
    this.stop();
    this.timer = setTimeout(fn, ms);
  }

  /** Fill the empty seats and deal. */
  seat(names = NAMES) {
    const t = this.table;
    t.seats = [
      t.seats[0],
      {
        name: names[1],
        bot: true,
        left: 0,
        auto: false,
        online: true,
        ready: true,
      },
      {
        name: names[2],
        bot: false,
        left: 0,
        auto: false,
        online: true,
        ready: true,
      },
    ];
    this.emit();
  }

  deal(first: Seat = 0) {
    const deck = Array.from({ length: 54 }, (_, i) => i);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    this.hands = [deck.slice(0, 17), deck.slice(17, 34), deck.slice(34, 51)];
    this.bottom = deck.slice(51);
    Object.assign(this.table, {
      phase: 'bid',
      bottom: null,
      landlord: null,
      turn: first,
      rob: false,
      last: null,
      moves: [null, null, null],
      doubles: { rob: 0, bombs: 0, spring: false },
      commit: '9f2c4e…a71b',
      result: null,
    } satisfies Partial<Table>);
    this.caller = null;
    this.bidTurns = 0;
    this.plays = [0, 0, 0];
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
    switch (a.type) {
      case 'ready':
        this.seat();
        this.later(() => this.deal(0), 400);
        return;
      case 'bid':
        if (this.table.turn === me) this.bid(me, a.want);
        return;
      case 'play':
        if (this.table.turn === me) this.play(me, a.cards);
        return;
      case 'pass':
        if (this.table.turn === me) this.play(me, []);
        return;
    }
  }

  private bid(seat: Seat, want: boolean) {
    const t = this.table;
    const robbing = this.caller !== null;
    t.moves[seat] = {
      seat,
      bid: want ? (robbing ? 'rob' : 'call') : robbing ? 'norob' : 'pass',
    };
    this.bidTurns++;
    if (want) {
      if (this.caller === null) this.caller = seat;
      else t.doubles.rob++;
      t.landlord = seat;
      t.rob = true;
    }
    if (this.bidTurns < 3 || (this.bidTurns === 3 && this.caller !== null && t.landlord !== this.caller)) {
      t.turn = this.bidTurns < 3 ? nextSeat(seat) : this.caller;
      this.arm();
      this.emit();
      return;
    }
    if (this.caller === null) {
      this.emit();
      this.later(() => this.deal(nextSeat(seat)), 900);
      return;
    }
    const lord = t.landlord as Seat;
    this.hands[lord] = [...this.hands[lord], ...this.bottom];
    Object.assign(t, {
      phase: 'play',
      bottom: this.bottom,
      turn: lord,
      moves: [null, null, null],
    } satisfies Partial<Table>);
    this.arm();
    this.emit();
  }

  private play(seat: Seat, cards: Card[]) {
    const t = this.table;
    if (cards.length === 0) {
      if (!t.last) return;
      t.moves[seat] = { seat };
      this.passes++;
      t.turn = nextSeat(seat);
      if (this.passes === 2) {
        t.last = null;
        this.passes = 0;
      }
      this.arm();
      this.emit();
      return;
    }
    const pattern = t.last?.pattern ? follow(cards, t.last.pattern) : classify(cards);
    if (!pattern) return;
    const move: Move = { seat, cards: [...cards], pattern };
    if (!t.last) t.moves = [null, null, null];
    this.hands[seat] = this.hands[seat].filter((c) => !cards.includes(c));
    if (pattern.kind === 'bomb' || pattern.kind === 'rocket') t.doubles.bombs++;
    this.plays[seat]++;
    t.last = move;
    this.passes = 0;
    // A new trick clears the other bubbles only when it is led.
    t.moves[seat] = move;
    if (this.hands[seat].length === 0) return this.finish(seat);
    t.turn = nextSeat(seat);
    t.moves[t.turn] = null;
    this.arm();
    this.emit();
  }

  private finish(seat: Seat) {
    const t = this.table;
    const lord = t.landlord as Seat;
    const farmers = ([0, 1, 2] as Seat[]).filter((s) => s !== lord);
    t.doubles.spring = seat === lord ? farmers.every((s) => this.plays[s] === 0) : this.plays[lord] === 1;
    const m = multiplier(t.doubles);
    const sign = seat === lord ? 1 : -1;
    const delta = ([0, 1, 2] as Seat[]).map((s) => (s === lord ? 2 : -1) * m * sign * t.base) as [number, number, number];
    Object.assign(t, {
      phase: 'over',
      turn: null,
      deadline: null,
      result: {
        winner: seat,
        delta,
        hands: [...this.hands],
        doubles: { ...t.doubles },
        multiplier: m,
        seed: '3b1f…c09e',
      },
    });
    this.emit();
  }

  private botMove(seat: Seat) {
    const t = this.table;
    const hand = this.hands[seat];
    if (t.phase === 'bid') {
      const strong = hand.filter((c) => rankOf(c) >= 12).length;
      return this.bid(seat, strong >= (t.rob ? 4 : 3));
    }
    const prev = t.last && t.last.seat !== seat ? (t.last.pattern ?? null) : null;
    const lord = t.landlord;
    const mateLed = prev && t.last && lord !== null && t.last.seat !== lord && seat !== lord;
    const options = hints(hand, prev);
    if (prev && (options.length === 0 || mateLed)) return this.play(seat, []);
    this.play(seat, options[0] ?? [hand[0]]);
  }
}
