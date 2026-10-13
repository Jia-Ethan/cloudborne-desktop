import { invoke } from '@tauri-apps/api/core';

export type ToolId = 'codex' | 'claude' | 'zcode' | 'grok' | 'pi';

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
  threshold: number;
  daily_budget: number;
  prizes: Prize[];
}

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
  threshold: number;
  today_cost: number;
  draws_allowed: number;
  draws_used: number;
  draws_left: number;
  prizes: { id: string; name: string; rarity: Rarity; kind: PrizeKind }[];
  today: Draw[];
  perks: Perk[];
}

export interface LotterySummary {
  date: string;
  draws: number;
  participants: number;
  value: number;
  budget: number;
  budget_left: number;
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
  login: (email: string, password: string) => invoke<LoginOutcome>('login', { email, password }),
  login2fa: (code: string) => invoke<LoginOutcome>('login_2fa', { code }),
  logout: () => invoke<void>('logout'),
  me: () => invoke<User | null>('me'),
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
  lotteryDraw: () => invoke<{ draw: Draw; status: LotteryStatus }>('lottery_draw'),
  adminOverview: (today: string, start: string, timezone: string) =>
    invoke<AdminOverview>('admin_overview', { today, start, timezone }),
  adminUsers: (page: number, pageSize: number, search: string) =>
    invoke<Page<AdminUser>>('admin_users', { page, pageSize, search }),
  adminUser: (id: number) => invoke<AdminUser>('admin_user', { id }),
  adminUserBalance: (id: number, amount: number, add: boolean, notes: string) =>
    invoke<AdminUser>('admin_user_balance', { id, amount, add, notes }),
  adminUserStatus: (id: number, active: boolean) => invoke<AdminUser>('admin_user_status', { id, active }),
  adminLotterySettings: () => invoke<LotterySettings>('admin_lottery_settings'),
  adminLotterySave: (settings: LotterySettings) => invoke<LotterySettings>('admin_lottery_save', { settings }),
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
