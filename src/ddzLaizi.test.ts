import { describe, expect, it } from 'vitest';
import { beats, isBomb, type Card, type Kind, type Pattern } from './ddz';
import { judgeLaizi, laiziHints, readLaizi } from './ddzLaizi';
import fixture from './ddzLaizi.fixture.json';

const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
const R = (s: string) => RANKS.indexOf(s);

/** "3 3 4 sj bj" → cards, repeats of a rank taking successive suits. */
function cards(s: string): Card[] {
  const used = new Map<number, number>();
  return s.split(' ').filter(Boolean).map((f) => {
    if (f === 'sj') return 52;
    if (f === 'bj') return 53;
    const r = R(f);
    const k = used.get(r) ?? 0;
    used.set(r, k + 1);
    return r * 4 + k;
  });
}
const p = (kind: Kind, rank: string, len = 1): Pattern => ({ kind, rank: R(rank), len });

describe('readLaizi', () => {
  it('matches the relay on its fixture', () => {
    const cases = fixture as { cards: Card[]; laizi: number[]; want: Pattern[] }[];
    expect(cases.length).toBeGreaterThan(1000);
    for (const c of cases) expect(readLaizi(c.cards, c.laizi), JSON.stringify(c.cards)).toEqual(c.want);
  });

  it('reads the relay’s worked cases', () => {
    const laizi = [R('7'), R('J')];
    const read = (s: string) => readLaizi(cards(s), laizi);
    expect(read('7')).toEqual([p('single', '7')]);
    expect(read('7 J')).toEqual([]);
    expect(read('7 7 J J')).toEqual([p('laizi_bomb', 'J')]);
    expect(read('9 9 9 9')).toEqual([p('bomb', '9')]);
    expect(read('bj 7')).toEqual([]);
    expect(read('9 9 9 7')).toEqual([p('soft_bomb', '9'), p('trio_single', '9')]);
    expect(read('5 6 8 9 7 J')).toEqual([p('straight', '5', 6), p('straight', '4', 6)]);
    expect(read('Q K A 2 7')).toEqual([]);
    expect(read('9 9 9 9 7')).toEqual([]);
    expect(read('5 5 5 7 sj bj')).toEqual([]);
    expect(read('9 9 7 3 3')).toEqual([p('trio_pair', '9'), p('trio_pair', '3')]);
  });

  it('orders bombs 软炸 < 硬炸 < 赖子炸 < 王炸', () => {
    const order = [p('soft_bomb', '3'), p('soft_bomb', '2'), p('bomb', '3'), p('bomb', '2'), p('laizi_bomb', '3'), p('laizi_bomb', '2'), { kind: 'rocket', rank: 14, len: 1 } as Pattern];
    order.forEach((hi, i) => order.forEach((lo, j) => expect(beats(hi, lo), `${hi.kind} over ${lo.kind}`).toBe(i > j)));
  });
});

describe('judgeLaizi', () => {
  const laizi = [R('7'), R('J')];
  it('offers every reading that may be played', () => {
    const j = judgeLaizi(cards('9 9 9 7'), null, laizi);
    expect(j.verdict).toBe('ok');
    expect(j.readings).toEqual([p('soft_bomb', '9'), p('trio_single', '9')]);
    // Over a trio with a single only the bomb and a higher trio reading count.
    const over = judgeLaizi(cards('9 9 9 7'), p('trio_single', '10'), laizi);
    expect(over.readings).toEqual([p('soft_bomb', '9')]);
    expect(judgeLaizi(cards('5 7'), p('pair', '6'), laizi).verdict).toBe('small');
    expect(judgeLaizi(cards('5 8'), null, laizi).verdict).toBe('bad');
  });
});

describe('laiziHints', () => {
  const laizi = [R('7'), R('J')];
  const hands = [
    '3 4 5 6 8 9 9 10 Q K A 2 7 J sj',
    '3 3 4 4 5 5 6 6 8 8 9 9 7 7 J 2 bj',
    '9 9 9 10 10 Q Q K 7 J J 2 2 sj bj',
    '3 3 3 4 4 4 5 6 8 10 K A 2 2 7',
  ];
  const prevs: (Pattern | null)[] = [null, p('single', '8'), p('pair', '5'), p('trio_single', '6'), p('straight', '3', 5), p('pair_straight', '3', 3), p('soft_bomb', '9'), p('bomb', '4')];
  it('only offers plays the relay would take, cheapest first and bombs last', () => {
    for (const h of hands) {
      const hand = cards(h);
      for (const prev of prevs) {
        const list = laiziHints(hand, prev, laizi);
        let bombs = false;
        for (const x of list) {
          expect(x.cards.every((c) => hand.includes(c))).toBe(true);
          expect(readLaizi(x.cards, laizi)).toContainEqual(x.pattern);
          if (prev) expect(beats(x.pattern, prev)).toBe(true);
          if (isBomb(x.pattern)) bombs = true;
          else expect(bombs, 'bombs come last').toBe(false);
        }
      }
      expect(laiziHints(hand, null, laizi).length).toBeGreaterThan(3);
    }
  });

  it('fills a straight with a wild card', () => {
    const list = laiziHints(cards('4 5 6 8 7 K'), p('straight', '3', 5), laizi);
    expect(list[0].pattern).toEqual(p('straight', '4', 5));
  });
});
