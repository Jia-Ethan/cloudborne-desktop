import { describe, expect, it } from 'vitest';
import { BIG_JOKER, SMALL_JOKER, beats, byPlay, classify, follow, hints, judge, multiplier, patterns, rankOf, type Card } from './ddz';

const NAMES = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];

/** "3 3 K sj bj" → cards; repeats of a rank take successive suits. */
function hand(s: string): Card[] {
  const used = new Map<number, number>();
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((f) => {
      if (f === 'sj') return SMALL_JOKER;
      if (f === 'bj') return BIG_JOKER;
      const r = NAMES.indexOf(f);
      if (r < 0) throw new Error(f);
      const k = used.get(r) ?? 0;
      used.set(r, k + 1);
      return r * 4 + k;
    });
}
const read = (s: string) => classify(hand(s));
const names = (cards: Card[]) => cards.map((c) => (c >= SMALL_JOKER ? (c === BIG_JOKER ? 'bj' : 'sj') : NAMES[rankOf(c)])).join(' ');

describe('classify', () => {
  // Same table as the relay's TestClassify.
  it.each([
    ['3', 'single', 0, 1],
    ['bj', 'single', 14, 1],
    ['K K', 'pair', 10, 1],
    ['7 7 7', 'trio', 4, 1],
    ['7 7 7 3', 'trio_single', 4, 1],
    ['7 7 7 sj', 'trio_single', 4, 1],
    ['7 7 7 3 3', 'trio_pair', 4, 1],
    ['3 4 5 6 7', 'straight', 0, 5],
    ['10 J Q K A', 'straight', 7, 5],
    ['3 3 4 4 5 5', 'pair_straight', 0, 3],
    ['8 8 8 9 9 9', 'plane', 5, 2],
    ['8 8 8 9 9 9 3 4', 'plane_singles', 5, 2],
    ['8 8 8 9 9 9 3 3 4 4', 'plane_pairs', 5, 2],
    ['5 5 5 5 3 4', 'four_singles', 2, 1],
    ['5 5 5 5 3 3 4 4', 'four_pairs', 2, 1],
    ['9 9 9 9', 'bomb', 6, 1],
    ['sj bj', 'rocket', 14, 1],
    ['3 3 3 4 4 4 5 5 5 7 8 9', 'plane_singles', 0, 3],
    ['3 3 3 4 4 4 5 5 5 6 6 6', 'plane', 0, 4],
  ])('%s', (cards, kind, rank, len) => {
    expect(read(cards)).toEqual({ kind, rank, len });
  });

  it.each(['3 4', '3 4 5 6', 'J Q K A 2', '3 3 4 4', '7 7 7 3 4', '7 7 7 sj bj', '5 5 5 5 sj bj', '8 8 8 10 10 10 3 4', 'K K K A A A 2 2 2 3 4 5'])(
    'refuses %s',
    (cards) => {
      expect(patterns(hand(cards))).toEqual([]);
    },
  );
});

describe('beats and judge', () => {
  it('compares like the relay', () => {
    const p = (s: string) => read(s)!;
    expect(beats(p('4'), p('3'))).toBe(true);
    expect(beats(p('4 5 6 7 8 9'), p('3 4 5 6 7'))).toBe(false);
    expect(beats(p('3 3 3 3'), p('2 2'))).toBe(true);
    expect(beats(p('sj bj'), p('2 2 2 2'))).toBe(true);
    expect(beats(p('bj'), p('3 3 3 3'))).toBe(false);
    expect(follow(hand('9 9 9 9 3 3'), p('8 8 8 8 4 5'))?.kind).toBe('four_singles');
    expect(follow(hand('9 9 9 9 3 3'), p('8 8 8 8'))).toBeNull();
  });

  it('says why a selection cannot go', () => {
    expect(judge([], null).verdict).toBe('empty');
    expect(judge(hand('3 4'), null).verdict).toBe('bad');
    expect(judge(hand('3'), read('5')).verdict).toBe('small');
    expect(judge(hand('3 3'), read('5')).verdict).toBe('small');
    expect(judge(hand('6'), read('5'))).toEqual({
      verdict: 'ok',
      pattern: { kind: 'single', rank: 3, len: 1 },
    });
  });
});

describe('hints', () => {
  it('prefers not to break pairs, trios or bombs', () => {
    const h = hand('4 6 6 9 9 9 K K K K 2 sj bj');
    expect(hints(h, read('3')).map(names)).toEqual(['4', '2', '6', '9', 'sj', 'bj', 'K', 'K K K K', 'sj bj']);
    expect(hints(h, read('5 5')).map(names)).toEqual(['6 6', '9 9', 'K K', 'K K K K', 'sj bj']);
    expect(hints(h, read('2 2 2 2')).map(names)).toEqual(['sj bj']);
    expect(hints(h, read('sj bj'))).toEqual([]);
  });

  it('finds chains and planes of the same length', () => {
    expect(hints(hand('4 5 6 7 8 9 J'), read('3 4 5 6 7')).map(names)).toEqual(['4 5 6 7 8', '5 6 7 8 9']);
    expect(hints(hand('5 5 6 6 7 7 8 8'), read('3 3 4 4 5 5')).map(names)).toEqual(['5 5 6 6 7 7', '6 6 7 7 8 8']);
    expect(hints(hand('9 9 9 10 10 10 3 4 K'), read('7 7 7 8 8 8 5 6')).map(names)).toEqual(['9 9 9 10 10 10 3 4']);
    expect(hints(hand('6 6 6 3 3 K'), read('5 5 5 4 4')).map(names)).toEqual(['6 6 6 3 3']);
  });

  it('leads the lowest group first', () => {
    const h = hand('3 5 5 7 7 7 Q');
    expect(hints(h, null).map(names).slice(0, 3)).toEqual(['3', '5 5', '7 7 7 3']);
  });

  it('only offers legal plays', () => {
    const h = hand('3 4 5 6 7 8 8 8 9 9 10 J Q K A 2 2 sj');
    for (const prev of [null, read('3'), read('4 4'), read('3 4 5 6 7'), read('5 5 5 3')]) {
      for (const cards of hints(h, prev)) {
        expect(judge(cards, prev).verdict, names(cards)).toBe('ok');
      }
    }
  });
});

describe('layout helpers', () => {
  it('puts the main part before kickers', () => {
    expect(names(byPlay(hand('3 9 9 9')))).toBe('9 9 9 3');
  });

  it('caps the multiplier', () => {
    expect(multiplier({ rob: 1, bombs: 1, spring: true })).toBe(8);
    expect(multiplier({ rob: 3, bombs: 3, spring: true })).toBe(16);
  });
});
