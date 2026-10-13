import type { Draw, LotterySettings, Prize, PrizeKind, Rarity } from './api';

export const RARITIES: Rarity[] = ['common', 'rare', 'epic', 'legendary'];
export const KINDS: Prize['kind'][] = ['balance_fixed', 'cashback', 'balance_percent', 'discount', 'credit', 'extra_draw'];

/** Kinds whose min/max are fractions of something, edited as percents. */
export const PERCENT_KINDS: PrizeKind[] = ['cashback', 'balance_percent'];

export const isBig = (r: Rarity) => r === 'epic' || r === 'legendary';

/** Dollars with two decimals, the unit balance and usage are shown in. */
export function dollars(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return `$${v.toFixed(2)}`;
}

/** Each prize's chance of being picked, by weight. All zero when no weight is set. */
export function probabilities(prizes: Pick<Prize, 'weight'>[]): number[] {
  const total = prizes.reduce((s, p) => s + Math.max(0, p.weight || 0), 0);
  return prizes.map((p) => (total > 0 ? Math.max(0, p.weight || 0) / total : 0));
}

/**
 * The most a single draw of this prize can cost, in $. Cashback and balance
 * percent are bounded only by their cap; cap 0 means no cap, so Infinity.
 */
export function prizeMax(p: Prize): number {
  switch (p.kind) {
    case 'balance_fixed':
      return Math.max(0, p.max ?? 0);
    case 'cashback':
    case 'balance_percent':
      return (p.cap ?? 0) > 0 ? (p.cap as number) : Infinity;
    case 'discount':
      return Math.max(0, p.cap ?? 0);
    case 'credit':
      return Math.max(0, p.amount ?? 0);
    case 'extra_draw':
      return 0;
  }
}

/** Σ pᵢ × maxᵢ: the most one draw can cost on average. Infinity when an uncapped prize can be picked. */
export function costCeiling(prizes: Prize[]): number {
  const ps = probabilities(prizes);
  return prizes.reduce((s, p, i) => (ps[i] > 0 ? s + ps[i] * prizeMax(p) : s), 0);
}

/** 0.05 → "5", 0.125 → "12.5"; for inputs that show percent. */
export function toPercent(fraction: number | undefined): string {
  if (fraction === undefined || !Number.isFinite(fraction)) return '';
  return String(Math.round(fraction * 1e6) / 1e4);
}

/** "5" → 0.05; empty or junk → 0. */
export function fromPercent(text: string): number {
  const v = parseFloat(text);
  return Number.isFinite(v) ? Math.round(v * 1e4) / 1e6 : 0;
}

/** Today in the relay's timezone (Asia/Shanghai), as YYYY-MM-DD. */
export function shanghaiToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Same rules as the relay's PUT validation; the first problem found, or null. */
export type SettingsProblem =
  | 'threshold'
  | 'budget'
  | 'count'
  | 'id'
  | 'duplicate'
  | 'name'
  | 'weight'
  | 'totalWeight'
  | 'range'
  | 'percent'
  | 'cap'
  | 'rate'
  | 'discountCap'
  | 'hours'
  | 'amount';

export function settingsProblem(s: LotterySettings): { problem: SettingsProblem; index?: number } | null {
  if (!(s.threshold >= 0)) return { problem: 'threshold' };
  if (!(s.daily_budget >= 0)) return { problem: 'budget' };
  if (s.prizes.length < 1 || s.prizes.length > 20) return { problem: 'count' };
  const seen = new Set<string>();
  for (const [i, p] of s.prizes.entries()) {
    const id = p.id.trim();
    if (!id || id.length > 32) return { problem: 'id', index: i };
    if (seen.has(id)) return { problem: 'duplicate', index: i };
    seen.add(id);
    const len = [...p.name.trim()].length;
    if (len < 1 || len > 20) return { problem: 'name', index: i };
    if (!(p.weight >= 0)) return { problem: 'weight', index: i };
    if (p.kind === 'balance_fixed' || PERCENT_KINDS.includes(p.kind)) {
      const min = p.min ?? 0;
      const max = p.max ?? 0;
      if (!(min >= 0 && min <= max)) return { problem: 'range', index: i };
      if (PERCENT_KINDS.includes(p.kind) && max > 1) return { problem: 'percent', index: i };
    }
    if (!((p.cap ?? 0) >= 0)) return { problem: 'cap', index: i };
    if (p.kind === 'discount') {
      if (!((p.rate ?? 0) > 0 && (p.rate ?? 0) < 1)) return { problem: 'rate', index: i };
      if (!((p.cap ?? 0) > 0)) return { problem: 'discountCap', index: i };
    }
    if (p.kind === 'discount' || p.kind === 'credit') {
      const h = p.hours ?? 0;
      if (!(h >= 1 && h <= 168)) return { problem: 'hours', index: i };
    }
    if (p.kind === 'credit' && !((p.amount ?? 0) > 0)) return { problem: 'amount', index: i };
  }
  if (s.prizes.reduce((t, p) => t + p.weight, 0) <= 0) return { problem: 'totalWeight' };
  return null;
}

/** Sensible starting params when a prize row switches kind. */
export function withKind(p: Prize, kind: Prize['kind']): Prize {
  const base: Prize = { id: p.id, name: p.name, rarity: p.rarity, weight: p.weight, kind };
  switch (kind) {
    case 'balance_fixed':
      return { ...base, min: 0.5, max: 2 };
    case 'cashback':
      return { ...base, min: 0.05, max: 0.1, cap: 20 };
    case 'balance_percent':
      return { ...base, min: 0.03, max: 0.03, cap: 20 };
    case 'discount':
      return { ...base, rate: 0.8, hours: 24, cap: 30 };
    case 'credit':
      return { ...base, amount: 20, hours: 24 };
    case 'extra_draw':
      return base;
  }
}

/** The rarity steps the reveal walks through, ending at the one won. */
export function revealLadder(r: Rarity): Rarity[] {
  return RARITIES.slice(0, RARITIES.indexOf(r) + 1);
}

/** Share of the threshold reached today, 0..1. A zero threshold counts as reached. */
export function progress(todayCost: number, threshold: number): number {
  if (threshold <= 0) return 1;
  return Math.min(1, Math.max(0, todayCost / threshold));
}

/** "8" for 0.8, "8.5" for 0.85: Chinese 折. */
export function zhe(rate: number): string {
  return String(Math.round(rate * 100) / 10);
}

/** Variables for the 折 label: `n` for Chinese (8 折), `off` for English (20% off). */
export function zheVars(z: string): { n: string; off: number } {
  return { n: z, off: Math.round(100 - Number(z) * 10) };
}

/** What the result card shows as its headline, before translation. */
export type Headline =
  | { kind: 'money'; value: number }
  | { kind: 'discount'; zhe: string; hours: number }
  | { kind: 'credit'; value: number; hours: number }
  | { kind: 'again' }
  | { kind: 'none' };

export function headline(d: Pick<Draw, 'kind' | 'amount' | 'detail'>): Headline {
  const num = (k: string) => Number(d.detail?.[k] ?? 0);
  switch (d.kind) {
    case 'discount':
      return { kind: 'discount', zhe: zhe(num('rate')), hours: num('hours') };
    case 'credit':
      return { kind: 'credit', value: num('amount') || d.amount, hours: num('hours') };
    case 'extra_draw':
      return { kind: 'again' };
    case 'none':
      return { kind: 'none' };
    default:
      return { kind: 'money', value: d.amount };
  }
}

/** Time left as "23:59:08", or "2 天 03:00:00"-style days prefix handled by the caller. */
export function countdown(ms: number): { days: number; clock: string } {
  const s = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(s / 86400);
  const p = (n: number) => String(n).padStart(2, '0');
  return { days, clock: `${p(Math.floor((s % 86400) / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}` };
}

/** Value at time t (0..1) of a count-up that eases out. */
export function easeOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) ** 3;
}
