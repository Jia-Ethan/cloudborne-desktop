import { invoke } from '@tauri-apps/api/core';

export type ToolId = 'codex' | 'claude' | 'zcode' | 'grok';

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
  relayOrigin: () => invoke<string>('relay_origin'),
  setLanguage: (code: string) => invoke<void>('set_language', { code }),
};

/** Tauri rejects with the Rust error's string form. */
export function errorText(e: unknown, fallback: string): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  return fallback;
}
