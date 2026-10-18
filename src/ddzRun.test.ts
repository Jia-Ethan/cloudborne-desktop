import { describe, expect, it } from 'vitest';
import { BASE_CHIPS, buy, clear, fail, newRun, reward, runTarget, scoreDeal, sell, stock, target, type Run } from './ddzRun';
import type { SimLog } from './ddzSim';
import type { Move, Pattern, Seat } from './ddz';

const play = (seat: Seat, seq: number, pattern: Pattern, n: number, left: number): SimLog => ({
  move: { seat, seq, cards: Array.from({ length: n }, (_, i) => i), pattern } as Move,
  left,
});
const pass = (seat: Seat, seq: number, left: number): SimLog => ({ move: { seat, seq }, left });
const withJokers = (run: Run, ...ids: Run['jokers'][number]['id'][]): Run => ({ ...run, jokers: ids.map((id) => ({ id, grow: 0 })) });

describe('run scoring', () => {
  const run = newRun(1, 'gpt');
  const log = [
    play(0, 1, { kind: 'straight', rank: 0, len: 5 }, 5, 15),
    pass(1, 2, 17),
    pass(2, 3, 17),
    play(0, 4, { kind: 'pair', rank: 3, len: 1 }, 2, 13),
    play(1, 5, { kind: 'pair', rank: 9, len: 1 }, 2, 15),
    play(0, 6, { kind: 'bomb', rank: 5, len: 1 }, 4, 9),
  ];

  it('is chips × multiplier', () => {
    const s = scoreDeal(run, log, 0, false);
    expect(s.chips).toBe(BASE_CHIPS + 15 + 4 + 30);
    expect(s.mult).toBe(2);
    expect(s.score).toBe(118);
  });

  it('adds jokers on top', () => {
    const s = scoreDeal(withJokers(run, 'straight', 'pair', 'control'), log, 0, false);
    expect(s.chips).toBe(BASE_CHIPS + 15 + 12 + 30);
    // +2 straight; control +1 for the straight's trick and +1 for the bomb, which ends the log; ×2 for the bomb.
    expect(s.mult).toBe((1 + 2 + 1 + 1) * 2);
  });

  it('ignores reverted plays and audit stops the bomb doubling', () => {
    const reverted = log.map((l) => (l.move.seq === 6 ? { ...l, move: { ...l.move, reverted: true } } : l));
    expect(scoreDeal(run, reverted, 0, false).mult).toBe(1);
    const boss: Run = { ...run, level: 2, bosses: ['audit', 'audit', 'audit'] };
    expect(scoreDeal(boss, log, 0, false).mult).toBe(1);
  });

  it('counts spring only at the end', () => {
    const lone = log.filter((l) => l.move.seat === 0 || !l.move.cards);
    expect(scoreDeal(run, lone, 0, false).mult).toBe(2);
    expect(scoreDeal(run, lone, 0, true).mult).toBe(4);
  });
});

describe('run progress', () => {
  it('targets climb and the boss is higher', () => {
    for (let a = 0; a < 3; a++) {
      expect(target(a, 1)).toBeGreaterThan(target(a, 0));
      expect(target(a, 2)).toBeGreaterThan(target(a, 1));
      if (a) expect(target(a, 0)).toBeGreaterThan(target(a - 1, 2));
    }
  });

  it('clears into the shop with gold and grown jokers', () => {
    const run = withJokers(newRun(5, 'kimi'), 'compound');
    const t = runTarget(run);
    const next = clear(run, t * 2, [], 0)!;
    const g = reward(run, t * 2);
    expect(next.gold).toBe(run.gold + g.base + g.over + g.interest);
    expect(next.jokers[0].grow).toBe(1);
    expect(next.level).toBe(1);
    expect(next.shop?.length).toBeGreaterThan(0);
  });

  it('loses a life per failed deal and ends after the last', () => {
    let run: Run | null = newRun(2, 'glm');
    run = fail(run)!;
    run = fail(run)!;
    expect(run.lives).toBe(1);
    expect(fail(run)).toBeNull();
  });

  it('buys and sells within gold and slots', () => {
    const run = { ...newRun(3, 'qwen'), gold: 50 };
    const shop = { ...run, shop: stock(run, 0) };
    const j = shop.shop!.findIndex((it) => it.kind === 'joker');
    const bought = buy(shop, j)!;
    expect(bought.jokers).toHaveLength(1);
    expect(buy(bought, j)).toBeNull();
    expect(sell(bought, 0).jokers).toHaveLength(0);
    const full = { ...shop, jokers: [{ id: 'allin' as const, grow: 0 }, { id: 'pair' as const, grow: 0 }, { id: 'single' as const, grow: 0 }] };
    expect(buy(full, j)).toBeNull();
  });
});
