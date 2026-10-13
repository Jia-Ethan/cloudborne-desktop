import { invoke } from '@tauri-apps/api/core';

export type ToolId = 'codex' | 'claude' | 'zcode' | 'grok' | 'pi';

export interface User {
  id: number;
  email: string;
  username: string;
  balance: number;
  status: string;
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

export interface UsageLog extends TokenCounts {
  id: number;
  api_key_id: number;
  model: string;
  actual_cost: number;
  duration_ms: number | null;
  created_at: string;
}

export interface UsagePage {
  items: UsageLog[];
  total: number;
  page: number;
  pages: number;
}

export interface UsageKey {
  id: number;
  name: string;
  /** Set when this client created the key for one of its tools. */
  tool: ToolId | null;
}

export type UsageQuery = Record<string, string | number>;

function usage<T>(kind: 'stats' | 'snapshot' | 'logs', q: UsageQuery) {
  return invoke<T>('usage', { kind, query: Object.entries(q).map(([k, v]) => [k, String(v)]) });
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
  usageLogs: (q: UsageQuery) => usage<UsagePage>('logs', q),
  usageKeys: () => invoke<UsageKey[]>('usage_keys'),
  relayOrigin: () => invoke<string>('relay_origin'),
  setLanguage: (code: string) => invoke<void>('set_language', { code }),
};

/** Tauri rejects with the Rust error's string form. */
export function errorText(e: unknown, fallback: string): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  return fallback;
}
