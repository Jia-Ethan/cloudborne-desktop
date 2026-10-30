import { Channel, invoke } from '@tauri-apps/api/core';

/** One step of a Codex run, as `codex exec --json` reports it. */
export type AgentItem =
  | { id: string; type: 'agent_message'; text: string }
  | { id: string; type: 'reasoning'; text: string }
  | {
      id: string;
      type: 'command_execution';
      command: string;
      aggregated_output: string;
      exit_code: number | null;
      status: 'in_progress' | 'completed' | 'failed' | 'declined';
    }
  | {
      id: string;
      type: 'file_change';
      changes: { path: string; kind: 'add' | 'delete' | 'update' }[];
      status: 'in_progress' | 'completed' | 'failed';
    }
  | { id: string; type: 'mcp_tool_call'; server: string; tool: string; status: 'in_progress' | 'completed' | 'failed' }
  | { id: string; type: 'web_search'; query: string }
  | { id: string; type: 'todo_list'; items: { text: string; completed: boolean }[] }
  | { id: string; type: 'error'; message: string };

/** Why a turn failed, so the card can say what to do about it. */
export type FailureKind = 'balance' | 'auth' | 'rate' | 'runtime' | 'network' | 'other';

export type AgentEvent =
  | { type: 'runtime'; percent: number | null }
  | { type: 'item'; item: AgentItem }
  | { type: 'done' }
  | { type: 'stopped' }
  | { type: 'failed'; kind: FailureKind; message: string };

export type Effort = 'low' | 'medium' | 'high' | 'xhigh';
export const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh'];

export interface Turn {
  prompt: string;
  /** Data URLs of attached screenshots, for display only. */
  images: string[];
  items: AgentItem[];
  status: 'running' | 'done' | 'stopped' | 'failed';
  failure?: { kind: FailureKind; message: string };
  /** Download progress while the Codex runtime is being fetched. */
  runtime?: number | null;
}

export interface Session {
  id: string;
  title: string;
  updated_at: number;
  turns: Turn[];
  pinned?: boolean;
  archived?: boolean;
}

export type SessionSummary = Pick<Session, 'id' | 'title' | 'updated_at' | 'pinned' | 'archived'>;

/** A task found by search; `snippet` is the matching line when the title does not match. */
export type SearchHit = SessionSummary & { snippet?: string };

/** A sidebar change; fields left out stay as they are. */
export type SessionPatch = Partial<Pick<Session, 'title' | 'pinned' | 'archived'>>;

export interface Attachment {
  name: string;
  /** Data URL. */
  data: string;
}

export interface AgentModels {
  models: string[];
  default: string | null;
}

export const agentApi = {
  models: () => invoke<AgentModels>('agent_models'),
  sessions: () => invoke<SessionSummary[]>('agent_sessions'),
  session: (id: string) => invoke<Session>('agent_session', { id }),
  search: (query: string) => invoke<SearchHit[]>('agent_search', { query }),
  updateSession: (id: string, patch: SessionPatch) => invoke<SessionSummary>('agent_update_session', { id, patch }),
  deleteSession: (id: string) => invoke<void>('agent_delete_session', { id }),
  /** Starts a turn; returns the session id (new when `session` is null). */
  send: (
    opts: { session: string | null; prompt: string; images: Attachment[]; model: string; effort: Effort; lang: string },
    onEvent: (e: AgentEvent) => void,
  ) => {
    const channel = new Channel<AgentEvent>();
    channel.onmessage = onEvent;
    return invoke<string>('agent_send', { options: opts, channel });
  },
  stop: (id: string) => invoke<void>('agent_stop', { id }),
};

/** Codex re-sends an item as it grows; replace by id, else append. */
export function applyItem(items: AgentItem[], item: AgentItem): AgentItem[] {
  const i = items.findIndex((x) => x.id === item.id);
  if (i === -1) return [...items, item];
  const next = items.slice();
  next[i] = item;
  return next;
}

export function applyEvent(turn: Turn, e: AgentEvent): Turn {
  switch (e.type) {
    case 'runtime':
      return { ...turn, runtime: e.percent };
    case 'item':
      return { ...turn, runtime: undefined, items: applyItem(turn.items, e.item) };
    case 'done':
      return { ...turn, status: 'done', runtime: undefined };
    case 'stopped':
      return { ...turn, status: 'stopped', runtime: undefined };
    case 'failed':
      return { ...turn, status: 'failed', runtime: undefined, failure: { kind: e.kind, message: e.message } };
  }
}

/** What the conversation view draws: runs of commands or file edits fold into one row. */
export type Block =
  | { kind: 'single'; item: AgentItem }
  | { kind: 'commands'; items: Extract<AgentItem, { type: 'command_execution' }>[] }
  | { kind: 'files'; items: Extract<AgentItem, { type: 'file_change' }>[] };

export function toBlocks(items: AgentItem[]): Block[] {
  const out: Block[] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (item.type === 'command_execution') {
      if (last?.kind === 'commands') last.items.push(item);
      else out.push({ kind: 'commands', items: [item] });
    } else if (item.type === 'file_change') {
      if (last?.kind === 'files') last.items.push(item);
      else out.push({ kind: 'files', items: [item] });
    } else {
      out.push({ kind: 'single', item });
    }
  }
  return out;
}
