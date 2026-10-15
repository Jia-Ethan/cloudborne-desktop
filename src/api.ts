import type { FeePolicy } from './ddz';
import { invoke } from '@tauri-apps/api/core';

export type ToolId = 'codex' | 'claude' | 'zcode' | 'grok' | 'pi';

/** 小丑斗地主 lobby as the relay reports it. */
export interface DdzSettings { enabled: boolean; fee_enabled: boolean; fee_bps: number }
export interface DdzStatus {
  fee_policy?: FeePolicy;
  enabled: boolean;
  stakes: number[];
  min_balance_times: number;
}

/** 小丑斗地主 money over a range, for admins. `platform_net` is what the AI seats won (+) or lost (−). */
export interface DdzSummary {
  since: string;
  games: number;
  bot_games: number;
  players: number;
  won: number;
  platform_net: number;
  fee_income?: number;
  gross_won?: number;
  total_net?: number;
  unknown_seats?: number;
  recent:
    | {
        id: string;
        base: number;
        field: string;
        landlord: number;
        winner: number;
        users: [number, number, number];
        roles: [string, string, string];
        names?: [string,string,string];
        kinds?: [string,string,string];
        gross_delta?: [number,number,number];
        fee?: [number,number,number];
        fee_policy?: FeePolicy;
        delta: [number, number, number];
        at: string;
      }[]
    | null;
}

export interface User {
  id: number;
  email: string;
  username: string;
  balance: number;
  status: string;
  /** `admin` or `user`; empty on relays that do not send it. */
  role?: string;
}

export const isAdmin = (u: User | null | undefined) => u?.role === 'admin';

/** The name to show for an account: its username, or the part of the email before the @. */
export function displayName(u: { username?: string; email: string }): string {
  return u.username?.trim() || u.email.split('@')[0] || u.email;
}

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export type PrizeKind = 'balance_fixed' | 'cashback' | 'balance_percent' | 'discount' | 'credit' | 'extra_draw' | 'none';

/** A prize as configured by the admin. Percent kinds store fractions (0.05 = 5%). */
export interface Prize {
  id: string;
  name: string;
  rarity: Rarity;
  kind: Exclude<PrizeKind, 'none'>;
  weight: number;
  min?: number;
  max?: number;
  cap?: number;
  rate?: number;
  hours?: number;
  amount?: number;
}

export interface LotterySettings {
  enabled: boolean;
  /** RFC3339; null = no bound. */
  starts_at: string | null;
  ends_at: string | null;
  /** Spending (满额) chests on/off. */
  earn_enabled: boolean;
  /** Every this much spend in a day earns 1 chest. */
  earn_spend: number;
  /** Earned chests per user per day; 0 = unlimited. */
  earn_daily_cap: number;
  /** Earned chests site-wide per day; 0 = unlimited. */
  earn_quota: number;
  /** Earn-pool payout per day; 0 = unlimited. */
  daily_budget: number;
  buy_enabled: boolean;
  buy_price: number;
  /** 1..100 per user per day. */
  buy_daily_cap: number;
  /** Chests sold site-wide per day; 0 = unlimited. */
  buy_quota: number;
  /** Admin-funded seed for the buy pool. */
  pool_reserve: number;
  /** Most unopened chests one user may hold, 1..1000. */
  hold_cap: number;
  /** Low-spend chest: expires at 24:00 on its day. */
  daily_enabled: boolean;
  daily_threshold: number;
  /** 1..10 per user per day. */
  daily_per_user: number;
  /** Site-wide per day; 0 = unlimited. */
  daily_quota: number;
  /** After pity_epic − 1 draws without epic or legendary, the next one is; 0 = off, else 2..1000. Older relays leave it out. */
  pity_epic?: number;
  /** In one open, every batch_rare chests hold at least one rare or better; 0 = off, else 2..10. */
  batch_rare?: number;
  /** The day's first earn-pool draw multiplies epic and legendary weights by this; 1 = off, 1..10. */
  first_open_boost?: number;
  prizes: Prize[];
}

export type ChestSource = 'earn' | 'buy' | 'bonus' | 'daily';

export interface Draw {
  id: number;
  prize_id: string;
  name: string;
  rarity: Rarity;
  kind: PrizeKind;
  /** Balance granted at draw time (0 for perks). */
  amount: number;
  /** What the draw charged against the daily budget. */
  value: number;
  detail: Record<string, number | string | undefined>;
  created_at: string;
  /** Older relays leave these out. */
  source?: ChestSource;
  pool?: 'earn' | 'buy';
  /** Admin lists only. */
  user_id?: number;
  email?: string;
  username?: string;
}

export interface Perk {
  id: number;
  kind: 'discount' | 'credit';
  rate?: number;
  cap?: number;
  refunded?: number;
  amount?: number;
  used?: number;
  left?: number;
  expires_at: string;
}

export interface LotteryStatus {
  enabled: boolean;
  /** Enabled and inside the activity window: chests can be earned and bought. */
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  now: string;
  /** Unopened, unexpired chests held. */
  chests: number;
  /** Most a user may hold; older relays leave it out. */
  hold_cap?: number;
  /** chests ≥ hold_cap: nothing more is earned until some are opened. */
  full?: boolean;
  /** `quota` is site-wide per day (0 = unlimited); `left_today` is null when unlimited. */
  earn: {
    /** earn_enabled && active. Older relays leave it out (always on). */
    enabled?: boolean;
    spend_per_chest: number;
    daily_cap: number;
    today_spend: number;
    earned_today: number;
    quota?: number;
    left_today?: number | null;
  };
  /**
   * `enabled` is buy_enabled && active. `left_today` is what this user can
   * still buy: min(own allowance, sold_left). `sold_left` is null when the
   * site-wide quota is unlimited.
   */
  buy: {
    enabled: boolean;
    price: number;
    daily_cap: number;
    bought_today: number;
    left_today: number;
    quota?: number;
    sold_today?: number;
    sold_left?: number | null;
  };
  /** Low-spend chest. Older relays leave it out. */
  daily?: DailyChest;
  /** Guarantees and boosts. Older relays leave it out. */
  bonus?: LotteryBonus;
  prizes: { id: string; name: string; rarity: Rarity; kind: PrizeKind }[];
  today: Draw[];
  perks: Perk[];
}

export interface LotteryBonus {
  /** 0 = off. */
  pity_epic: number;
  /** Draws until a guaranteed epic or legendary, counting the next one; ≥ 1. */
  pity_left: number;
  /** 0 = off. */
  batch_rare: number;
  /** 1 = off. */
  first_open_boost: number;
  /** The boost is still there for today's first spend or low-spend chest. */
  first_open_ready: boolean;
}

export interface DailyChest {
  /** daily_enabled && active. */
  enabled: boolean;
  threshold: number;
  per_user: number;
  /** Site-wide; 0 = unlimited. */
  quota: number;
  given_today: number;
  /** null when the quota is unlimited. */
  left_today: number | null;
  mine_today: number;
  /** My unopened ones that have not expired. */
  unopened: number;
  /** End of today, RFC3339. */
  expires_at: string;
}

export interface LotterySummary {
  date: string;
  draws: number;
  participants: number;
  value: number;
  /** Earn pool. */
  budget: number;
  budget_left: number;
  earned_chests?: number;
  bought_chests?: number;
  buy_revenue?: number;
  value_earn?: number;
  value_buy?: number;
  daily_chests?: number;
  /** Granted that day, never opened, expired. */
  daily_expired?: number;
  /** Owed that day but not granted because the user was full. */
  forfeited_chests?: number;
  /** Buy pool, all time; balance = reserve + revenue − payout. */
  pool?: { reserve: number; revenue: number; payout: number; balance: number };
  by_rarity: Partial<Record<Rarity, number>>;
  big_wins: Draw[];
}

export interface AdminUser {
  id: number;
  email: string;
  username: string;
  role: string;
  balance: number;
  status: string;
  created_at?: string;
  last_active_at?: string | null;
  /** Added by the client from the batch usage endpoint. */
  today_cost?: number;
  /** Last 30 days. */
  month_cost?: number;
}

export interface Page<T> {
  items: T[];
  total: number;
}

export interface AdminOverview {
  stats: {
    today_actual_cost: number;
    today_requests: number;
    today_tokens: number;
    active_users: number;
    total_users: number;
  };
  trend: TrendPoint[];
  models: ModelUsage[];
}

export type LoginOutcome =
  | { kind: 'done'; user: User }
  | { kind: 'two_factor'; temp_token: string; email_masked: string };

export interface SavedAccount {
  user_id: number;
  email: string;
  username: string;
  active: boolean;
  /** False once signed out or the relay turned its token down; the account stays listed. */
  signed_in: boolean;
  /** A password is remembered, so a signed-out account still signs in with one click. */
  has_password: boolean;
}

export type SwitchOutcome =
  | { kind: 'done'; user: User }
  /** Signed in with the remembered password; a 2FA code is needed next. */
  | { kind: 'two_factor'; email_masked: string }
  | { kind: 'signed_out'; email: string };

/** A redeemed code or another balance change, as the relay lists them. */
export interface RedeemItem {
  id: number;
  code: string;
  /** balance, concurrency, subscription, admin_balance, admin_concurrency, affiliate_balance, lottery, ... */
  type: string;
  value: number;
  status: string;
  used_at: string | null;
  created_at: string;
  notes?: string;
  validity_days?: number;
  group?: { id: number; name: string } | null;
}

export interface ToolStatus {
  id: ToolId;
  name: string;
  installed: boolean;
  location: string | null;
  connected: boolean;
  error: string | null;
}

export interface Group {
  id: number;
  name: string;
  platform: string;
  status: string;
  rate_multiplier: number;
}

export interface PlatformRate {
  platform: string;
  rate: number;
}

export interface Rates {
  /** From the relay admin's exchange rate setting. */
  cny_per_usd: number;
  rates: PlatformRate[];
}

/** Input, output and the two cache counts, as the relay reports them. */
export interface TokenCounts {
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
}

export interface UsageStats {
  total_requests: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_creation_tokens: number;
  total_cache_read_tokens: number;
  total_tokens: number;
  /** What the account was charged. */
  total_actual_cost: number;
  average_duration_ms: number;
}

export interface TrendPoint extends TokenCounts {
  /** `YYYY-MM-DD`, or `YYYY-MM-DD HH:00` for hourly points. */
  date: string;
  requests: number;
  total_tokens: number;
  actual_cost: number;
}

export interface ModelUsage extends TokenCounts {
  model: string;
  requests: number;
  total_tokens: number;
  actual_cost: number;
}

export interface UsageSnapshot {
  granularity: 'hour' | 'day';
  trend: TrendPoint[];
  models: ModelUsage[];
}

export interface UsageKey {
  id: number;
  name: string;
  /** Set when this client created the key for one of its tools. */
  tool: ToolId | null;
}

export type UsageQuery = Record<string, string | number>;

function usage<T>(kind: 'stats' | 'snapshot', q: UsageQuery) {
  return invoke<T>('usage', { kind, query: Object.entries(q).map(([k, v]) => [k, String(v)]) });
}

export interface ApiKey {
  id: number;
  key: string;
  name: string;
  group_id: number | null;
  group?: Group | null;
  status: 'active' | 'inactive' | 'quota_exhausted' | 'expired' | string;
  ip_whitelist: string[] | null;
  ip_blacklist: string[] | null;
  last_used_at: string | null;
  /** Dollars; 0 is unlimited. */
  quota: number;
  quota_used: number;
  expires_at: string | null;
  created_at: string;
  rate_limit_5h: number;
  rate_limit_1d: number;
  rate_limit_7d: number;
  usage_5h: number;
  usage_1d: number;
  usage_7d: number;
  /** Added by the client from the usage endpoint. */
  today_cost: number;
  /** Last 30 days. */
  month_cost: number;
  /** Set when this client created the key for one of its tools. */
  tool: ToolId | null;
}

export interface MonitorPoint {
  status: string;
  latency_ms: number | null;
  checked_at: string;
}

export interface Monitor {
  id: number;
  provider: string;
  primary_status: string;
  primary_latency_ms: number | null;
  /** Percent. */
  availability_7d: number;
  /** Newest first. */
  timeline: MonitorPoint[] | null;
}

export type InstallStarted =
  | { kind: 'terminal' }
  | { kind: 'package'; path: string }
  | { kind: 'needs_node' };

export const api = {
  login: (email: string, password: string, remember: boolean) => invoke<LoginOutcome>('login', { email, password, remember }),
  login2fa: (code: string) => invoke<LoginOutcome>('login_2fa', { code }),
  /** Signs the current account out (it stays saved); resolves to the account that took over, if any. */
  logout: () => invoke<User | null>('logout'),
  me: () => invoke<User | null>('me'),
  accounts: () => invoke<SavedAccount[]>('accounts_list'),
  switchAccount: (userId: number) => invoke<SwitchOutcome>('account_switch', { userId }),
  addAccountBegin: () => invoke<SavedAccount[]>('account_add_begin'),
  removeAccount: (userId: number) => invoke<User | null>('account_remove', { userId }),
  toolsStatus: () => invoke<ToolStatus[]>('tools_status'),
  groupsFor: (tool: ToolId) => invoke<Group[]>('groups_for', { tool }),
  connect: (tool: ToolId, groupId: number) =>
    invoke<{ backups: string[]; models: number }>('connect_tool', { tool, groupId }),
  disconnect: (tool: ToolId, deleteKey: boolean) => invoke<string[]>('disconnect_tool', { tool, deleteKey }),
  install: (tool: ToolId) => invoke<InstallStarted>('install_tool', { tool }),
  rates: () => invoke<Rates>('rates'),
  usageStats: (q: UsageQuery) => usage<UsageStats>('stats', q),
  usageSnapshot: (q: UsageQuery) => usage<UsageSnapshot>('snapshot', q),
  usageKeys: () => invoke<UsageKey[]>('usage_keys'),
  keys: () => invoke<ApiKey[]>('keys_list'),
  keyGroups: () => invoke<Group[]>('key_groups'),
  createKey: (body: Record<string, unknown>) => invoke<ApiKey>('key_create', { body }),
  updateKey: (id: number, body: Record<string, unknown>) => invoke<ApiKey>('key_update', { id, body }),
  deleteKey: (id: number) => invoke<void>('key_delete', { id }),
  keyModels: (key: string) => invoke<string[]>('key_models', { key }),
  openCcSwitch: (url: string) => invoke<void>('open_ccswitch', { url }),
  serviceStatus: () => invoke<{ items: Monitor[] }>('service_status'),
  relayOrigin: () => invoke<string>('relay_origin'),
  lottery: () => invoke<LotteryStatus>('lottery_status'),
  /** `draws` is missing on relays without batch open; `draw` is always there. */
  lotteryOpen: (count = 1) => invoke<{ draws?: Draw[]; draw: Draw; status: LotteryStatus }>('lottery_open', { count }),
  lotteryBuy: (count: number) => invoke<{ bought: number; status: LotteryStatus }>('lottery_buy', { count }),
  ddzStatus: () => invoke<DdzStatus>('ddz_status'),
  redeem: (code: string) => invoke<RedeemItem>('redeem', { code }),
  redeemHistory: (page: number, pageSize: number) => invoke<Page<RedeemItem>>('redeem_history', { page, pageSize }),
  adminOverview: (today: string, start: string, timezone: string) =>
    invoke<AdminOverview>('admin_overview', { today, start, timezone }),
  adminUsers: (page: number, pageSize: number, search: string) =>
    invoke<Page<AdminUser>>('admin_users', { page, pageSize, search }),
  adminUser: (id: number) => invoke<AdminUser>('admin_user', { id }),
  adminUserBalance: (id: number, amount: number, add: boolean, notes: string) =>
    invoke<AdminUser>('admin_user_balance', { id, amount, add, notes }),
  adminUserStatus: (id: number, active: boolean) => invoke<AdminUser>('admin_user_status', { id, active }),
  adminDdzSettings: () => invoke<DdzSettings>('admin_ddz_settings'),
  adminDdzSave: (settings: Partial<DdzSettings>) => invoke<DdzSettings>('admin_ddz_save', { settings }),
  adminDdzSummary: (days: number) => invoke<DdzSummary>('admin_ddz_summary', { days }),
  adminLotterySettings: () => invoke<LotterySettings>('admin_lottery_settings'),
  adminLotterySave: (settings: LotterySettings) => invoke<LotterySettings>('admin_lottery_save', { settings }),
  adminLotteryDefaults: () => invoke<LotterySettings>('admin_lottery_defaults'),
  adminLotterySummary: (date: string) => invoke<LotterySummary>('admin_lottery_summary', { date }),
  adminLotteryDraws: (q: { date?: string; rarity?: string; userId?: number; page: number; pageSize: number }) =>
    invoke<Page<Draw>>('admin_lottery_draws', {
      date: q.date ?? '',
      rarity: q.rarity ?? '',
      userId: q.userId ?? null,
      page: q.page,
      pageSize: q.pageSize,
    }),
  setLanguage: (code: string) => invoke<void>('set_language', { code }),
};

/** Tauri rejects with the Rust error's string form. */
export function errorText(e: unknown, fallback: string): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  return fallback;
}
