import { describe, expect, it } from 'vitest';
import type { LotterySettings, Prize } from './api';
import {
  activityPhase,
  balanceGained,
  batchSize,
  byRarity,
  buyMax,
  costCeiling,
  dailyState,
  earnProgress,
  extraChance,
  fromShanghaiInput,
  payoutRatio,
  quotaLeft,
  shanghaiShort,
  toShanghaiInput,
  countdown,
  fromPercent,
  headline,
  prizeMax,
  probabilities,
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
// The recommended chest table from the contract.
const RECOMMENDED: Prize[] = [
  { id: 'coin_s', name: '小额余额', rarity: 'common', kind: 'balance_fixed', weight: 55, min: 0.5, max: 2.5 },
  { id: 'discount', name: '9折卡', rarity: 'rare', kind: 'discount', weight: 15, rate: 0.9, hours: 24, cap: 5 },
  { id: 'coin_m', name: '余额', rarity: 'rare', kind: 'balance_fixed', weight: 20, min: 4, max: 7 },
  { id: 'coin_l', name: '大额余额', rarity: 'epic', kind: 'balance_fixed', weight: 8, min: 10, max: 15 },
  { id: 'jackpot', name: '头奖', rarity: 'legendary', kind: 'balance_fixed', weight: 2, min: 50, max: 50 },
];
const settings = (prizes: Prize[] = DEFAULT, more: Partial<LotterySettings> = {}): LotterySettings => ({
  enabled: true,
  starts_at: null,
  ends_at: null,
  earn_spend: 50,
  earn_daily_cap: 0,
  earn_quota: 100,
  daily_budget: 300,
  buy_enabled: false,
  buy_price: 5,
  buy_daily_cap: 5,
  buy_quota: 100,
  pool_reserve: 0,
  hold_cap: 100,
  daily_enabled: true,
  daily_threshold: 20,
  daily_per_user: 1,
  daily_quota: 50,
  prizes,
  ...more,
});

describe('lottery', () => {
  it('turns weights into probabilities', () => {
    const p = probabilities(DEFAULT);
    expect(p[0]).toBeCloseTo(0.34);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(probabilities([{ weight: 0 }, { weight: 0 }])).toEqual([0, 0]);
    expect(probabilities([{ weight: -3 }, { weight: 1 }])).toEqual([0, 1]);
  });

  it('counts fixed balance at its mean and the rest at their cap', () => {
    expect(prizeMax(DEFAULT[0])).toBe(1.25);
    expect(prizeMax(DEFAULT[1])).toBe(20);
    expect(prizeMax(DEFAULT[3])).toBe(30);
    expect(prizeMax(DEFAULT[4])).toBe(0);
    expect(prizeMax(DEFAULT[6])).toBe(20);
    expect(prizeMax({ ...DEFAULT[1], cap: 0 })).toBe(Infinity);
  });

  it('puts the recommended table at 93.5% of a $5 chest', () => {
    // 0.55×1.5 + 0.15×5 + 0.20×5.5 + 0.08×12.5 + 0.02×50
    expect(costCeiling(RECOMMENDED)).toBeCloseTo(4.675, 9);
    expect(payoutRatio(costCeiling(RECOMMENDED), 5)).toBeCloseTo(0.935, 9);
    expect(settingsProblem(settings(RECOMMENDED, { buy_enabled: true }))).toBeNull();
  });

  it('spreads an extra chest over the chests it chains into', () => {
    // 0.08 of picks are another chest: the rest is divided by 0.92.
    expect(extraChance(DEFAULT)).toBeCloseTo(0.08);
    const rest = 0.34 * 1.25 + 0.3 * 20 + 0.08 * 20 + 0.08 * 30 + 0.05 * 50 + 0.05 * 20 + 0.01 * 100 + 0.01 * 100;
    expect(costCeiling(DEFAULT)).toBeCloseTo(rest / 0.92, 9);
    const half: Prize[] = [
      { id: 'a', name: 'a', rarity: 'common', kind: 'balance_fixed', weight: 1, min: 2, max: 2 },
      { id: 'b', name: 'b', rarity: 'rare', kind: 'extra_draw', weight: 1 },
    ];
    // 0.5×2 / 0.5: a chest pays 2 on average however long the chain.
    expect(costCeiling(half)).toBeCloseTo(2, 9);
    expect(costCeiling([half[1]])).toBe(Infinity);
  });

  it('is unbounded only when an uncapped prize can be picked', () => {
    expect(costCeiling([{ ...DEFAULT[1], cap: 0 }, DEFAULT[0]])).toBe(Infinity);
    expect(costCeiling([{ ...DEFAULT[1], cap: 0, weight: 0 }, DEFAULT[0]])).toBe(1.25);
    expect(payoutRatio(Infinity, 5)).toBe(Infinity);
    expect(payoutRatio(1, 0)).toBe(Infinity);
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
    expect(settingsProblem(settings(DEFAULT, { earn_spend: 0 }))?.problem).toBe('earnSpend');
    expect(settingsProblem(settings(DEFAULT, { earn_daily_cap: 1.5 }))?.problem).toBe('earnCap');
    expect(settingsProblem(settings(DEFAULT, { buy_price: 0 }))?.problem).toBe('price');
    expect(settingsProblem(settings(DEFAULT, { buy_daily_cap: 0 }))?.problem).toBe('buyCap');
    expect(settingsProblem(settings(DEFAULT, { buy_daily_cap: 101 }))?.problem).toBe('buyCap');
    expect(settingsProblem(settings(DEFAULT, { pool_reserve: -1 }))?.problem).toBe('reserve');
    expect(settingsProblem(settings(DEFAULT, { hold_cap: 0 }))?.problem).toBe('holdCap');
    expect(settingsProblem(settings(DEFAULT, { hold_cap: 1001 }))?.problem).toBe('holdCap');
    expect(settingsProblem(settings(DEFAULT, { hold_cap: 2.5 }))?.problem).toBe('holdCap');
    expect(settingsProblem(settings(DEFAULT, { hold_cap: 1 }))).toBeNull();
    expect(settingsProblem(settings(DEFAULT, { hold_cap: 1000 }))).toBeNull();
    expect(settingsProblem(settings(DEFAULT, { earn_quota: -1 }))?.problem).toBe('earnQuota');
    expect(settingsProblem(settings(DEFAULT, { earn_quota: 0.5 }))?.problem).toBe('earnQuota');
    expect(settingsProblem(settings(DEFAULT, { buy_quota: -1 }))?.problem).toBe('buyQuota');
    expect(settingsProblem(settings(DEFAULT, { buy_quota: 1.5 }))?.problem).toBe('buyQuota');
    expect(settingsProblem(settings(DEFAULT, { earn_quota: 0, buy_quota: 0 }))).toBeNull();
    expect(settingsProblem(settings(DEFAULT, { daily_threshold: 0 }))?.problem).toBe('dailyThreshold');
    expect(settingsProblem(settings(DEFAULT, { daily_per_user: 0 }))?.problem).toBe('dailyPerUser');
    expect(settingsProblem(settings(DEFAULT, { daily_per_user: 11 }))?.problem).toBe('dailyPerUser');
    expect(settingsProblem(settings(DEFAULT, { daily_per_user: 10 }))).toBeNull();
    expect(settingsProblem(settings(DEFAULT, { daily_quota: -1 }))?.problem).toBe('dailyQuota');
    expect(settingsProblem(settings(DEFAULT, { daily_quota: 2.5 }))?.problem).toBe('dailyQuota');
    expect(settingsProblem(settings(DEFAULT, { daily_quota: 0 }))).toBeNull();
    expect(
      settingsProblem(settings(DEFAULT, { starts_at: '2026-10-02T00:00:00+08:00', ends_at: '2026-10-01T00:00:00+08:00' }))?.problem,
    ).toBe('window');
    expect(settingsProblem(settings(DEFAULT, { starts_at: '2026-10-01T00:00:00+08:00', ends_at: null }))).toBeNull();
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

  it('refuses to sell chests that lose money', () => {
    // The v1 table is fine for earned chests only.
    expect(settingsProblem(settings(DEFAULT))).toBeNull();
    expect(settingsProblem(settings(DEFAULT, { buy_enabled: true, buy_price: 10 }))?.problem).toBe('buyLoss');
    expect(settingsProblem(settings(RECOMMENDED, { buy_enabled: true, buy_price: 4.6 }))?.problem).toBe('buyLoss');
    expect(settingsProblem(settings(RECOMMENDED, { buy_enabled: true, buy_price: 4.675 }))).toBeNull();
    const uncapped = [...RECOMMENDED, { ...DEFAULT[1], cap: 0, weight: 1 }];
    expect(settingsProblem(settings(uncapped, { buy_enabled: true, buy_price: 1000 }))).toEqual({ problem: 'buyUncapped', index: 5 });
    // Weight 0 cannot be picked, so it does not count.
    expect(settingsProblem(settings([...RECOMMENDED, { ...DEFAULT[1], cap: 0, weight: 0 }], { buy_enabled: true }))).toBeNull();
    const allExtra: Prize[] = [{ id: 'a', name: '再来', rarity: 'rare', kind: 'extra_draw', weight: 1 }];
    expect(settingsProblem(settings(allExtra, { buy_enabled: true }))?.problem).toBe('buyAllExtra');
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
  });

  it('dates the admin views in Shanghai time', () => {
    // 2026-10-13 17:30 UTC is already the 14th in Shanghai.
    expect(shanghaiToday(new Date('2026-10-13T17:30:00Z'))).toBe('2026-10-14');
    expect(shanghaiToday(new Date('2026-10-13T15:30:00Z'))).toBe('2026-10-13');
  });

  it('measures spend toward the next chest', () => {
    const e = { spend_per_chest: 50, daily_cap: 0, today_spend: 120, earned_today: 2 };
    expect(earnProgress(e)).toEqual({ ratio: 0.4, toNext: 30, capped: false });
    expect(earnProgress({ ...e, today_spend: 100 })).toEqual({ ratio: 0, toNext: 50, capped: false });
    expect(earnProgress({ ...e, today_spend: 0.3, spend_per_chest: 0.1 }).ratio).toBe(0);
    expect(earnProgress({ ...e, daily_cap: 2 })).toEqual({ ratio: 1, toNext: 0, capped: true });
    expect(earnProgress({ ...e, spend_per_chest: 0 }).ratio).toBe(0);
    // Site-wide quota used up: spend earns nothing more today.
    expect(earnProgress({ ...e, left_today: 0 })).toEqual({ ratio: 0, toNext: 0, capped: true });
    expect(earnProgress({ ...e, left_today: 3 }).capped).toBe(false);
    expect(earnProgress({ ...e, left_today: null }).capped).toBe(false);
  });

  it('reads what is left of a site-wide quota', () => {
    expect(quotaLeft(7)).toBe(7);
    expect(quotaLeft(0)).toBe('out');
    expect(quotaLeft(null)).toBeNull();
    expect(quotaLeft(undefined)).toBeNull();
  });

  it('tracks the low-spend chest', () => {
    const d = { enabled: true, threshold: 20, per_user: 1, left_today: 12, mine_today: 0 };
    expect(dailyState(d, 5)).toEqual({ kind: 'progress', ratio: 0.25, toNext: 15 });
    expect(dailyState({ ...d, mine_today: 1 }, 25)).toEqual({ kind: 'done' });
    // Two a day: the second comes at $40.
    expect(dailyState({ ...d, per_user: 2, mine_today: 1 }, 30)).toEqual({ kind: 'progress', ratio: 0.5, toNext: 10 });
    expect(dailyState({ ...d, left_today: 0 }, 5)).toEqual({ kind: 'soldOut' });
    // Having got today's, a sold-out quota does not matter.
    expect(dailyState({ ...d, left_today: 0, mine_today: 1 }, 25)).toEqual({ kind: 'done' });
    // null = unlimited quota.
    expect(dailyState({ ...d, left_today: null }, 0).kind).toBe('progress');
    expect(dailyState({ ...d, enabled: false }, 50)).toEqual({ kind: 'off' });
  });

  it('places now against the activity window', () => {
    const w = { enabled: true, starts_at: '2026-10-01T00:00:00+08:00', ends_at: '2026-10-08T00:00:00+08:00' };
    expect(activityPhase(w, Date.parse('2026-09-30T15:59:00Z'))).toBe('upcoming');
    expect(activityPhase(w, Date.parse('2026-09-30T16:00:00Z'))).toBe('running');
    expect(activityPhase(w, Date.parse('2026-10-07T16:00:00Z'))).toBe('ended');
    expect(activityPhase({ ...w, starts_at: null, ends_at: null }, 0)).toBe('running');
    expect(activityPhase({ ...w, enabled: false }, Date.parse('2026-10-02T00:00:00Z'))).toBe('off');
  });

  it('shows and edits times in Shanghai', () => {
    expect(shanghaiShort('2026-09-30T16:00:00Z')).toBe('10/1 00:00');
    expect(shanghaiShort('2026-10-07T22:05:00+08:00')).toBe('10/7 22:05');
    expect(toShanghaiInput('2026-09-30T16:30:00Z')).toBe('2026-10-01T00:30');
    expect(toShanghaiInput(null)).toBe('');
    expect(fromShanghaiInput('2026-10-01T00:30')).toBe('2026-10-01T00:30:00+08:00');
    expect(fromShanghaiInput('')).toBeNull();
    expect(Date.parse(fromShanghaiInput(toShanghaiInput('2026-09-30T16:30:00Z'))!)).toBe(Date.parse('2026-09-30T16:30:00Z'));
  });

  it('sizes the batch button and sums a batch', () => {
    expect(batchSize(0)).toBeNull();
    expect(batchSize(1)).toBeNull();
    expect(batchSize(2)).toBe(2);
    expect(batchSize(10)).toBe(10);
    expect(batchSize(57)).toBe(10);
    expect(balanceGained([{ amount: 1.1 }, { amount: 2.2 }, { amount: 0 }])).toBe(3.3);
    expect(balanceGained([])).toBe(0);
    const ds = [
      { id: 1, rarity: 'common', kind: 'balance_fixed' },
      { id: 2, rarity: 'legendary', kind: 'balance_fixed' },
      { id: 3, rarity: 'common', kind: 'none' },
      { id: 4, rarity: 'rare', kind: 'discount' },
      { id: 5, rarity: 'common', kind: 'balance_fixed' },
    ] as const;
    expect(byRarity([...ds]).map((d) => d.id)).toEqual([2, 4, 1, 5, 3]);
  });

  it('caps a purchase by allowance and balance', () => {
    const b = { enabled: true, price: 5, left_today: 4 };
    expect(buyMax(b, 100)).toBe(4);
    expect(buyMax(b, 14.99)).toBe(2);
    expect(buyMax(b, 15)).toBe(3);
    expect(buyMax(b, 4)).toBe(0);
    expect(buyMax({ ...b, left_today: 0 }, 100)).toBe(0);
    expect(buyMax({ ...b, enabled: false }, 100)).toBe(0);
  });

  it('picks the headline for each kind', () => {
    expect(headline({ kind: 'cashback', amount: 3.2, detail: {} })).toEqual({ kind: 'money', value: 3.2 });
    expect(headline({ kind: 'discount', amount: 0, detail: { rate: 0.8, hours: 24 } })).toEqual({ kind: 'discount', zhe: '8', hours: 24 });
    expect(headline({ kind: 'credit', amount: 20, detail: { amount: 20, hours: 24 } })).toEqual({ kind: 'credit', value: 20, hours: 24 });
    expect(headline({ kind: 'extra_draw', amount: 0, detail: {} })).toEqual({ kind: 'again' });
    expect(headline({ kind: 'none', amount: 0, detail: {} })).toEqual({ kind: 'none' });
  });
});
