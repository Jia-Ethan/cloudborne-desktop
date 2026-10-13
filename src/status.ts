import type { Monitor } from './api';

export type State = 'up' | 'slow' | 'down' | 'unknown';

const SEVERITY: Record<State, number> = { unknown: 0, up: 1, slow: 2, down: 3 };

export function stateOf(status: string | null | undefined): State {
  switch (status) {
    case 'operational':
      return 'up';
    case 'degraded':
      return 'slow';
    case 'failed':
    case 'error':
      return 'down';
    default:
      return 'unknown';
  }
}

/** Worst known state wins; `unknown` only when nothing has data. */
export function worst(states: State[]): State {
  return states.reduce<State>((w, s) => (SEVERITY[s] > SEVERITY[w] ? s : w), 'unknown');
}

export interface ProviderStatus {
  provider: string;
  state: State;
  /** Mean 7-day availability in percent, when known. */
  uptime: number | null;
  /** Median latency of the probes that are not down, in ms. */
  latency: number | null;
  /** Oldest first, padded with `unknown` at the start to `length`. */
  history: State[];
  lastChecked: string | null;
}

const ORDER = ['anthropic', 'openai', 'gemini', 'grok', 'deepseek', 'zhipu', 'kimi', 'minimax', 'antigravity'];

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * One row per provider. Each probe's timeline is newest first, one point per
 * check, so the i-th points of a provider's probes are merged slot by slot.
 */
export function byProvider(items: Monitor[], length = 60): ProviderStatus[] {
  const groups = new Map<string, Monitor[]>();
  for (const m of items) groups.set(m.provider, [...(groups.get(m.provider) ?? []), m]);
  const out: ProviderStatus[] = [];
  for (const [provider, ms] of groups) {
    const lines = ms.map((m) => (m.timeline ?? []).slice(0, length));
    const depth = Math.max(0, ...lines.map((l) => l.length));
    const merged: State[] = [];
    for (let i = 0; i < depth; i++) merged.push(worst(lines.flatMap((l) => (l[i] ? [stateOf(l[i].status)] : []))));
    const uptimes = ms.map((m) => m.availability_7d).filter((v): v is number => v != null && Number.isFinite(v));
    out.push({
      provider,
      state: worst(ms.map((m) => stateOf(m.primary_status))),
      uptime: uptimes.length ? uptimes.reduce((a, b) => a + b, 0) / uptimes.length : null,
      latency: median(
        ms
          .filter((m) => stateOf(m.primary_status) !== 'down')
          .flatMap((m) => (m.primary_latency_ms != null ? [m.primary_latency_ms] : [])),
      ),
      history: [...Array<State>(length - merged.length).fill('unknown'), ...merged.reverse()],
      lastChecked: lines.map((l) => l[0]?.checked_at).filter(Boolean).sort().pop() ?? null,
    });
  }
  const rank = (p: string) => (ORDER.includes(p) ? ORDER.indexOf(p) : ORDER.length);
  return out.sort((a, b) => rank(a.provider) - rank(b.provider) || a.provider.localeCompare(b.provider));
}

/** 850 → "850 ms", 1240 → "1.2 s". */
export function duration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** 99.95 → "99.95%", 100 → "100%". */
export function uptime(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return '—';
  return pct >= 100 ? '100%' : `${pct.toFixed(2)}%`;
}
