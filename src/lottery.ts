import type { Draw, LotterySettings, Prize, PrizeKind, Rarity } from './api';

export const RARITIES: Rarity[] = ['common', 'rare', 'epic', 'legendary'];
export const KINDS: Prize['kind'][] = ['balance_fixed', 'cashback', 'balance_percent', 'discount', 'credit', 'extra_draw'];

/** Kinds whose min/max are fractions of something, edited as percents. */
export const PERCENT_KINDS: PrizeKind[] = ['cashback', 'balance_percent'];

export const isBig = (r: Rarity) => r === 'epic' || r === 'legendary';

/** Settings an older relay leaves out read as these, the relay's own defaults. */
export const GUARANTEE_DEFAULTS = { pity_epic: 30, batch_rare: 5, first_open_boost: 2 } as const;

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
 * What one draw of this prize counts for in the cost ceiling, in $. Fixed
 * balance is drawn uniformly, so its mean is exact; the other kinds count at
 * their cap. Cashback and balance percent are bounded only by their cap; cap 0
 * means no cap, so Infinity. Extra chests are worth 0 themselves.
 */
export function prizeMax(p: Prize): number {
  switch (p.kind) {
    case 'balance_fixed':
      return Math.max(0, ((p.min ?? 0) + (p.max ?? 0)) / 2);
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

/** Chance that a chest gives another chest. */
export function extraChance(prizes: Prize[]): number {
  const ps = probabilities(prizes);
  return prizes.reduce((s, p, i) => (p.kind === 'extra_draw' ? s + ps[i] : s), 0);
}

/**
 * Most one chest can pay out on average, counting the chests it can chain
 * into, the relay's LotteryCostCeiling. Without guarantees it is
 * Σ pᵢ·maxᵢ over the other kinds ÷ (1 − p_extra).
 *
 * The batch guarantee (every `batch` chests of one open hold a rare or
 * better) swaps f = c^(batch−1)/batch of draws for a pick among rare-or-better
 * prizes that are not another chest; c is the chance of a common. Pity (an
 * epic or legendary at least every `pity` draws) lifts their long-run share
 * from h to h / (1 − (1−h)^pity). Infinity when an uncapped prize can be
 * picked or every pick is another chest.
 */
export function costCeiling(prizes: Prize[], pity = 0, batch = 0): number {
  const live = prizes.filter((p) => p.weight > 0);
  const total = live.reduce((s, p) => s + p.weight, 0);
  if (total <= 0) return 0;
  if (extraChance(live) >= 1) return Infinity;
  if (live.some((p) => !Number.isFinite(prizeMax(p)))) return Infinity;
  const lifts = (p: Prize) => p.kind !== 'extra_draw' && p.rarity !== 'common';
  const common = live.filter((p) => p.rarity === 'common').reduce((s, p) => s + p.weight, 0);
  const upgrade = live.filter(lifts).reduce((s, p) => s + p.weight, 0);
  const f = batch >= 2 && upgrade > 0 ? (common / total) ** (batch - 1) / batch : 0;
  let big = 0;
  let bigCost = 0;
  let lowCost = 0;
  let again = 0;
  for (const p of live) {
    const d = (1 - f) * (p.weight / total) + (lifts(p) && upgrade > 0 ? (f * p.weight) / upgrade : 0);
    if (p.kind === 'extra_draw') again += d;
    else if (isBig(p.rarity)) {
      big += d;
      bigCost += d * prizeMax(p);
    } else lowCost += d * prizeMax(p);
  }
  const r = pity >= 2 && big > 0 ? big / (1 - (1 - big) ** pity) : big;
  let cost = big > 0 ? (r * bigCost) / big : 0;
  let x = 0;
  if (1 - big > 1e-12) {
    cost += ((1 - r) * lowCost) / (1 - big);
    x = ((1 - r) * again) / (1 - big);
  }
  return x >= 1 ? Infinity : cost / (1 - x);
}

/** The ceiling with the settings' own guarantees. */
export function settingsCeiling(s: Pick<LotterySettings, 'prizes' | 'pity_epic' | 'batch_rare'>): number {
  return costCeiling(s.prizes, s.pity_epic ?? 0, s.batch_rare ?? 0);
}

/** Ceiling above price, ignoring float noise at the boundary (4.675 vs 4.675000000000001). */
export function sellsAtLoss(ceiling: number, price: number): boolean {
  return !(ceiling <= price + 1e-9);
}

/** Ceiling as a share of the chest price; Infinity when either is unbounded or the price is 0. */
export function payoutRatio(ceiling: number, price: number): number {
  return price > 0 && Number.isFinite(ceiling) ? ceiling / price : Infinity;
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
  | 'window'
  | 'earnSpend'
  | 'earnCap'
  | 'earnQuota'
  | 'budget'
  | 'price'
  | 'buyCap'
  | 'buyQuota'
  | 'reserve'
  | 'holdCap'
  | 'dailyThreshold'
  | 'dailyPerUser'
  | 'dailyQuota'
  | 'pity'
  | 'batch'
  | 'boost'
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
  | 'amount'
  | 'buyUncapped'
  | 'buyAllExtra'
  | 'buyLoss';

const isInt = (n: number) => Number.isInteger(n);

export function settingsProblem(s: LotterySettings): { problem: SettingsProblem; index?: number } | null {
  if (s.starts_at && s.ends_at && !(Date.parse(s.starts_at) < Date.parse(s.ends_at))) return { problem: 'window' };
  if (!(s.earn_spend > 0)) return { problem: 'earnSpend' };
  if (!(s.earn_daily_cap >= 0 && isInt(s.earn_daily_cap))) return { problem: 'earnCap' };
  if (!(s.earn_quota >= 0 && isInt(s.earn_quota))) return { problem: 'earnQuota' };
  if (!(s.daily_budget >= 0)) return { problem: 'budget' };
  if (!(s.buy_price > 0)) return { problem: 'price' };
  if (!(s.buy_daily_cap >= 1 && s.buy_daily_cap <= 100 && isInt(s.buy_daily_cap))) return { problem: 'buyCap' };
  if (!(s.buy_quota >= 0 && isInt(s.buy_quota))) return { problem: 'buyQuota' };
  if (!(s.pool_reserve >= 0)) return { problem: 'reserve' };
  if (!(s.hold_cap >= 1 && s.hold_cap <= 1000 && isInt(s.hold_cap))) return { problem: 'holdCap' };
  if (!(s.daily_threshold > 0)) return { problem: 'dailyThreshold' };
  if (!(s.daily_per_user >= 1 && s.daily_per_user <= 10 && isInt(s.daily_per_user))) return { problem: 'dailyPerUser' };
  if (!(s.daily_quota >= 0 && isInt(s.daily_quota))) return { problem: 'dailyQuota' };
  const pity = s.pity_epic ?? 0;
  if (!(isInt(pity) && (pity === 0 || (pity >= 2 && pity <= 1000)))) return { problem: 'pity' };
  const batch = s.batch_rare ?? 0;
  if (!(isInt(batch) && (batch === 0 || (batch >= 2 && batch <= BATCH)))) return { problem: 'batch' };
  const boost = s.first_open_boost ?? 1;
  if (!(boost >= 1 && boost <= 10)) return { problem: 'boost' };
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
  if (s.buy_enabled) {
    // Bought chests must not pay out more than they cost on average.
    const i = s.prizes.findIndex((p) => p.weight > 0 && PERCENT_KINDS.includes(p.kind) && !((p.cap ?? 0) > 0));
    if (i >= 0) return { problem: 'buyUncapped', index: i };
    if (extraChance(s.prizes) >= 1) return { problem: 'buyAllExtra' };
    if (sellsAtLoss(settingsCeiling(s), s.buy_price)) return { problem: 'buyLoss' };
  }
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

/** What is left of a site-wide quota today: a count, 'out' when used up, or null when unlimited or not sent. */
export function quotaLeft(left: number | null | undefined): number | 'out' | null {
  if (left === null || left === undefined) return null;
  return left > 0 ? left : 'out';
}

/**
 * Today's spend toward the next earned chest: share of the way there (0..1)
 * and dollars still to go. `capped` once today's earn cap is reached.
 */
export function earnProgress(e: {
  spend_per_chest: number;
  daily_cap: number;
  today_spend: number;
  earned_today: number;
  left_today?: number | null;
}): {
  ratio: number;
  toNext: number;
  capped: boolean;
} {
  if (e.daily_cap > 0 && e.earned_today >= e.daily_cap) return { ratio: 1, toNext: 0, capped: true };
  // Site-wide quota used up: spend no longer earns chests today.
  if (quotaLeft(e.left_today) === 'out') return { ratio: 0, toNext: 0, capped: true };
  const per = e.spend_per_chest;
  if (!(per > 0)) return { ratio: 0, toNext: 0, capped: false };
  const spend = Math.max(0, e.today_spend);
  // Cents, so 100.00 % 50 lands on 0 rather than 49.99999.
  const into = (Math.round(spend * 100) % Math.round(per * 100)) / 100;
  return { ratio: Math.min(1, into / per), toNext: Math.max(0, per - into), capped: false };
}

/** Where today's low-spend chest stands for this user. */
export type DailyState =
  | { kind: 'off' }
  /** Spend still short of the next one: share of the way there and $ to go. */
  | { kind: 'progress'; ratio: number; toNext: number }
  /** Got all this user can get today. */
  | { kind: 'done' }
  /** The site-wide quota ran out before this user's next one. */
  | { kind: 'soldOut' };

export function dailyState(d: { enabled: boolean; threshold: number; per_user: number; left_today: number | null; mine_today: number }, todaySpend: number): DailyState {
  if (!d.enabled || !(d.threshold > 0)) return { kind: 'off' };
  if (d.mine_today >= d.per_user) return { kind: 'done' };
  if (d.left_today !== null && d.left_today <= 0) return { kind: 'soldOut' };
  // The next one comes at (mine_today + 1) × threshold.
  const target = (d.mine_today + 1) * d.threshold;
  const into = Math.max(0, todaySpend - d.mine_today * d.threshold);
  return { kind: 'progress', ratio: Math.min(1, into / d.threshold), toNext: Math.max(0, Math.round((target - todaySpend) * 100) / 100) };
}

/** Where the activity stands at `now` (ms). */
export type Phase = 'off' | 'upcoming' | 'running' | 'ended';

export function activityPhase(s: { enabled: boolean; starts_at: string | null; ends_at: string | null }, now: number): Phase {
  if (!s.enabled) return 'off';
  if (s.starts_at && now < Date.parse(s.starts_at)) return 'upcoming';
  if (s.ends_at && now >= Date.parse(s.ends_at)) return 'ended';
  return 'running';
}

const SH = 'Asia/Shanghai';

/** Wall-clock parts in Shanghai time. */
function shanghaiParts(d: Date): Record<'year' | 'month' | 'day' | 'hour' | 'minute', string> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SH,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

/** "10/1 08:00" in Shanghai time. */
export function shanghaiShort(iso: string): string {
  const p = shanghaiParts(new Date(iso));
  return `${Number(p.month)}/${Number(p.day)} ${p.hour}:${p.minute}`;
}

/** RFC3339 → the value a datetime-local input shows, in Shanghai time; null → "". */
export function toShanghaiInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = shanghaiParts(d);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** A datetime-local value read as Shanghai time → RFC3339 with +08:00; "" → null. */
export function fromShanghaiInput(v: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(v);
  return m ? `${m[1]}T${m[2]}:00+08:00` : null;
}

/** Most chests one batch open takes. */
export const BATCH = 10;

/** Size of the second open button: up to 10, or null when holding 1 or none (the single button covers it). */
export function batchSize(held: number): number | null {
  return held > 1 ? Math.min(BATCH, held) : null;
}

/** Balance a set of draws added right away (perks are not balance). */
export function balanceGained(draws: Pick<Draw, 'amount'>[]): number {
  return Math.round(draws.reduce((s, d) => s + Math.max(0, d.amount || 0), 0) * 100) / 100;
}

/** Best first, then in the order opened: how a batch summary lists its draws. */
export function byRarity<T extends Pick<Draw, 'rarity' | 'kind'>>(draws: T[]): T[] {
  const rank = (d: T) => (d.kind === 'none' ? -1 : RARITIES.indexOf(d.rarity));
  return draws.map((d, i) => ({ d, i })).sort((a, b) => rank(b.d) - rank(a.d) || a.i - b.i).map((x) => x.d);
}

/** Most chests one purchase can take: today's allowance and what the balance covers. */
export function buyMax(b: { enabled: boolean; price: number; left_today: number }, balance: number): number {
  if (!b.enabled || !(b.price > 0)) return 0;
  return Math.max(0, Math.min(b.left_today, Math.floor((balance + 1e-9) / b.price)));
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
