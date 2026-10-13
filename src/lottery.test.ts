import { describe, expect, it } from 'vitest';
import type { LotterySettings, Prize } from './api';
import {
  costCeiling,
  countdown,
  fromPercent,
  headline,
  prizeMax,
  probabilities,
  progress,
  revealLadder,
  settingsProblem,
  shanghaiToday,
  toPercent,
  withKind,
  dollars,
  zhe,
} from './lottery';

// The default prize table from the spec.
const DEFAULT: Prize[] = [
  { id: 'coin', name: '小额余额', rarity: 'common', kind: 'balance_fixed', weight: 34, min: 0.5, max: 2 },
  { id: 'cashback_s', name: '今日返现', rarity: 'common', kind: 'cashback', weight: 30, min: 0.05, max: 0.1, cap: 20 },
  { id: 'boost_s', name: '余额加成', rarity: 'rare', kind: 'balance_percent', weight: 8, min: 0.03, max: 0.03, cap: 20 },
  { id: 'discount', name: '限时折扣卡', rarity: 'rare', kind: 'discount', weight: 8, rate: 0.8, hours: 24, cap: 30 },
  { id: 'again', name: '再来一次', rarity: 'rare', kind: 'extra_draw', weight: 8 },
  { id: 'cashback_l', name: '今日返现', rarity: 'epic', kind: 'cashback', weight: 5, min: 0.3, max: 0.3, cap: 50 },
  { id: 'credit', name: '限时畅用额度', rarity: 'epic', kind: 'credit', weight: 5, amount: 20, hours: 24 },
  { id: 'free', name: '今日免单', rarity: 'legendary', kind: 'cashback', weight: 1, min: 1, max: 1, cap: 100 },
  { id: 'boost_l', name: '余额加成', rarity: 'legendary', kind: 'balance_percent', weight: 1, min: 0.1, max: 0.1, cap: 100 },
];
const settings = (prizes: Prize[] = DEFAULT): LotterySettings => ({ enabled: true, threshold: 10, daily_budget: 300, prizes });

describe('lottery', () => {
  it('turns weights into probabilities', () => {
    const p = probabilities(DEFAULT);
    expect(p[0]).toBeCloseTo(0.34);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(probabilities([{ weight: 0 }, { weight: 0 }])).toEqual([0, 0]);
    expect(probabilities([{ weight: -3 }, { weight: 1 }])).toEqual([0, 1]);
  });

  it('takes each kind’s worst case', () => {
    expect(prizeMax(DEFAULT[0])).toBe(2);
    expect(prizeMax(DEFAULT[1])).toBe(20);
    expect(prizeMax(DEFAULT[3])).toBe(30);
    expect(prizeMax(DEFAULT[4])).toBe(0);
    expect(prizeMax(DEFAULT[6])).toBe(20);
    expect(prizeMax({ ...DEFAULT[1], cap: 0 })).toBe(Infinity);
  });

  it('sums the cost ceiling of the default table', () => {
    // 0.34×2 + 0.30×20 + 0.08×20 + 0.08×30 + 0 + 0.05×50 + 0.05×20 + 0.01×100 + 0.01×100
    expect(costCeiling(DEFAULT)).toBeCloseTo(0.68 + 6 + 1.6 + 2.4 + 2.5 + 1 + 1 + 1, 6);
  });

  it('is unbounded only when an uncapped prize can be picked', () => {
    expect(costCeiling([{ ...DEFAULT[1], cap: 0 }, DEFAULT[0]])).toBe(Infinity);
    expect(costCeiling([{ ...DEFAULT[1], cap: 0, weight: 0 }, DEFAULT[0]])).toBe(2);
  });

  it('converts percents both ways without float noise', () => {
    expect(toPercent(0.05)).toBe('5');
    expect(toPercent(0.125)).toBe('12.5');
    expect(toPercent(0.07)).toBe('7');
    expect(fromPercent('7')).toBe(0.07);
    expect(fromPercent('12.5')).toBe(0.125);
    expect(fromPercent('')).toBe(0);
  });

  it('validates like the relay', () => {
    expect(settingsProblem(settings())).toBeNull();
    expect(settingsProblem({ ...settings(), threshold: -1 })?.problem).toBe('threshold');
    expect(settingsProblem(settings([]))?.problem).toBe('count');
    expect(settingsProblem(settings([DEFAULT[0], { ...DEFAULT[1], id: 'coin' }]))).toEqual({ problem: 'duplicate', index: 1 });
    expect(settingsProblem(settings([{ ...DEFAULT[0], min: 3 }]))?.problem).toBe('range');
    expect(settingsProblem(settings([{ ...DEFAULT[2], max: 1.5 }]))?.problem).toBe('percent');
    expect(settingsProblem(settings([{ ...DEFAULT[3], rate: 1 }]))?.problem).toBe('rate');
    expect(settingsProblem(settings([{ ...DEFAULT[3], cap: 0 }]))?.problem).toBe('discountCap');
    // The relay leaves out params that do not apply; missing reads as 0.
    expect(settingsProblem(settings([{ id: 'a', name: '再来', rarity: 'rare', kind: 'extra_draw', weight: 1 }]))).toBeNull();
    expect(prizeMax({ id: 'c', name: '返现', rarity: 'common', kind: 'cashback', weight: 1, min: 0.1, max: 0.1 })).toBe(Infinity);
    expect(settingsProblem(settings([{ ...DEFAULT[6], hours: 200 }]))?.problem).toBe('hours');
    expect(settingsProblem(settings([{ ...DEFAULT[6], amount: 0 }]))?.problem).toBe('amount');
    expect(settingsProblem(settings([{ ...DEFAULT[0], weight: 0 }]))?.problem).toBe('totalWeight');
    expect(settingsProblem(settings([{ ...DEFAULT[0], name: '一二三四五六七八九十一二三四五六七八九十' }]))).toBeNull();
    expect(settingsProblem(settings([{ ...DEFAULT[0], name: ' ' }]))?.problem).toBe('name');
  });

  it('gives a switched prize valid params', () => {
    for (const k of ['balance_fixed', 'cashback', 'balance_percent', 'discount', 'credit', 'extra_draw'] as const) {
      expect(settingsProblem(settings([withKind(DEFAULT[0], k)]))).toBeNull();
    }
  });

  it('walks the reveal up to the rarity won', () => {
    expect(revealLadder('common')).toEqual(['common']);
    expect(revealLadder('legendary')).toEqual(['common', 'rare', 'epic', 'legendary']);
  });

  it('formats amounts, 折 and countdowns', () => {
    expect(dollars(12.5)).toBe('$12.50');
    expect(zhe(0.8)).toBe('8');
    expect(zhe(0.85)).toBe('8.5');
    expect(countdown(26 * 3600e3 + 61e3)).toEqual({ days: 1, clock: '02:01:01' });
    expect(countdown(-5)).toEqual({ days: 0, clock: '00:00:00' });
    expect(progress(5, 10)).toBe(0.5);
    expect(progress(50, 10)).toBe(1);
    expect(progress(0, 0)).toBe(1);
  });

  it('dates the admin views in Shanghai time', () => {
    // 2026-10-13 17:30 UTC is already the 14th in Shanghai.
    expect(shanghaiToday(new Date('2026-10-13T17:30:00Z'))).toBe('2026-10-14');
    expect(shanghaiToday(new Date('2026-10-13T15:30:00Z'))).toBe('2026-10-13');
  });

  it('picks the headline for each kind', () => {
    expect(headline({ kind: 'cashback', amount: 3.2, detail: {} })).toEqual({ kind: 'money', value: 3.2 });
    expect(headline({ kind: 'discount', amount: 0, detail: { rate: 0.8, hours: 24 } })).toEqual({ kind: 'discount', zhe: '8', hours: 24 });
    expect(headline({ kind: 'credit', amount: 20, detail: { amount: 20, hours: 24 } })).toEqual({ kind: 'credit', value: 20, hours: 24 });
    expect(headline({ kind: 'extra_draw', amount: 0, detail: {} })).toEqual({ kind: 'again' });
    expect(headline({ kind: 'none', amount: 0, detail: {} })).toEqual({ kind: 'none' });
  });
});
