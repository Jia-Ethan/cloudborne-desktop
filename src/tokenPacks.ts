import type { TokenPack } from './api';

/** Share of the pack still unused, 0–1. */
export function packLeft(p: Pick<TokenPack, 'tokens_total' | 'tokens_used'>): number {
  if (p.tokens_total <= 0) return 0;
  return Math.min(1, Math.max(0, (p.tokens_total - p.tokens_used) / p.tokens_total));
}

/** `1000M`, `37.5M`, `820K`, `512`. */
export function tokenCount(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v >= 1_000_000) {
    const m = v / 1_000_000;
    return `${Number.isInteger(m) ? m : m >= 100 ? m.toFixed(0) : m.toFixed(m >= 10 ? 1 : 2).replace(/\.?0+$/, '')}M`;
  }
  if (v >= 1_000) return `${(v / 1_000).toFixed(v >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K`;
  return String(v);
}

/** Packs worth showing: every active one, plus the latest few that ran out or expired. */
export function visiblePacks(packs: TokenPack[], past = 2): TokenPack[] {
  const active = packs.filter((p) => p.status === 'active').sort((a, b) => a.expires_at.localeCompare(b.expires_at));
  const done = packs.filter((p) => p.status !== 'active').slice(0, past);
  return [...active, ...done];
}
