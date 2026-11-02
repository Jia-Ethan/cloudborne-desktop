import type { DdzSettings, DdzSummary } from './api';
import { HERO_NAMES, type Hero, type Mode } from './ddz';
import { dollars } from './lottery';

/** 赖子场 switch values, in the order the admin page offers them. */
export const LAIZI_STATES = ['off', 'admin', 'on'] as const;
export type LaiziState = (typeof LAIZI_STATES)[number];

/** What the 斗地主 settings form edits. Numbers stay text while the admin types. */
export interface DdzDraft {
  fee_enabled: boolean;
  /** Percent, e.g. "5" or "2.5". */
  fee_rate: string;
  min_balance_times: string;
  laizi: LaiziState;
  laizi_min_balance_times: string;
}
export type DraftField = 'fee_rate' | 'min_balance_times' | 'laizi_min_balance_times';
export type DraftError = 'fee' | 'times';

// The relay's own defaults, for settings saved before a field existed.
const FEE_BPS = 500;
const JOKER_TIMES = 20;
const LAIZI_TIMES = 40;

export const draftOf = (s: DdzSettings): DdzDraft => ({
  fee_enabled: s.fee_enabled ?? false,
  fee_rate: String((s.fee_bps ?? FEE_BPS) / 100),
  min_balance_times: String(s.min_balance_times ?? JOKER_TIMES),
  laizi: s.laizi ?? 'off',
  laizi_min_balance_times: String(s.laizi_min_balance_times ?? LAIZI_TIMES),
});

const feeOk = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.trim()) && Number(v) <= 10;
const timesOk = (v: string) => /^\d+$/.test(v.trim()) && Number(v) >= 10 && Number(v) <= 100;

/** Fields the relay would refuse: fee 0–10 % in steps of 0.01, entry multiples 10–100 whole. */
export function draftErrors(d: DdzDraft): Partial<Record<DraftField, DraftError>> {
  const out: Partial<Record<DraftField, DraftError>> = {};
  if (!feeOk(d.fee_rate)) out.fee_rate = 'fee';
  if (!timesOk(d.min_balance_times)) out.min_balance_times = 'times';
  if (!timesOk(d.laizi_min_balance_times)) out.laizi_min_balance_times = 'times';
  return out;
}

/** Only the settings that differ from what the relay has, ready for one PUT; null when nothing changed. */
export function draftPatch(base: DdzSettings, d: DdzDraft): Partial<DdzSettings> | null {
  const out: Partial<DdzSettings> = {};
  const was = draftOf(base);
  if (d.fee_enabled !== was.fee_enabled) out.fee_enabled = d.fee_enabled;
  const bps = Math.round(Number(d.fee_rate) * 100);
  if (d.fee_rate.trim() !== '' && bps !== (base.fee_bps ?? FEE_BPS)) out.fee_bps = bps;
  const times = Number(d.min_balance_times);
  if (d.min_balance_times.trim() !== '' && times !== (base.min_balance_times ?? JOKER_TIMES)) out.min_balance_times = times;
  if (d.laizi !== was.laizi) out.laizi = d.laizi;
  const laiziTimes = Number(d.laizi_min_balance_times);
  if (d.laizi_min_balance_times.trim() !== '' && laiziTimes !== (base.laizi_min_balance_times ?? LAIZI_TIMES)) {
    out.laizi_min_balance_times = laiziTimes;
  }
  return Object.keys(out).length ? out : null;
}

/** Money with its sign always written out: +$1.20, −$0.40, $0.00. */
export const signed = (n: number) => (n > 0 ? `+${dollars(n)}` : n < 0 ? `−${dollars(-n)}` : dollars(0));

/** Which way an amount went, for colouring it next to its sign. */
export const tone = (n: number): 'up' | 'down' | undefined => (n > 0 ? 'up' : n < 0 ? 'down' : undefined);

/** Month-day and 24-hour time in local time; the page never spans more than 30 days. */
export function dealTime(iso: string): { day: string; time: string } {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return { day: `${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` };
}

export type Deal = NonNullable<DdzSummary['recent']>[number];
export interface Seat {
  kind: 'human' | 'bot' | 'unknown';
  /** Account name, hero name, or empty for a seat recorded before identities were kept. */
  name: string;
  user: number | null;
  landlord: boolean;
  /** Net result after the winner fee. */
  delta: number;
  fee: number;
}

/** The three seats of a deal in table order, named the way the admin page shows them. */
export function seatsOf(g: Deal): Seat[] {
  return g.users.map((u, s) => {
    const base = { landlord: g.landlord === s, delta: g.delta[s] ?? 0, fee: g.fee?.[s] ?? 0 };
    if (u) return { ...base, kind: 'human', name: g.names?.[s] || `#${u}`, user: u };
    if (g.kinds?.[s] === 'bot') return { ...base, kind: 'bot', name: g.names?.[s] || HERO_NAMES[g.roles[s] as Hero] || 'AI', user: null };
    return { ...base, kind: 'unknown', name: '', user: null };
  });
}

export interface ModeRow {
  mode: Mode;
  games: number;
  fee: number;
  /** What the AI seats won (+) or lost (−) for the platform. */
  ai: number;
  total: number;
}

/** Per-mode money once 赖子场 has deals in range; null before that (the totals already say it all). */
export function modeRows(s: DdzSummary): ModeRow[] | null {
  if (!s.modes?.laizi) return null;
  return (['joker', 'laizi'] as const).map((mode) => {
    const m = s.modes?.[mode];
    const fee = m?.fee_income ?? 0;
    const ai = m?.platform_net ?? 0;
    return { mode, games: m?.games ?? 0, fee, ai, total: fee + ai };
  });
}
