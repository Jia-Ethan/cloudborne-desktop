import type { ModelUsage, TokenCounts, TrendPoint } from './api';
import type { LogoId } from './components/Logo';

export type Range = 'today' | 'week' | 'month';

/** Ranges a customer can pick: at most 7 days, which the relay answers quickly (owner, 2026-10-28). */
export const USER_RANGES: Range[] = ['today', 'week'];
/** Admin views keep the 30-day range. */
export const ADMIN_RANGES: Range[] = ['today', 'week', 'month'];

/** Share of prompt tokens served from cache. Input excludes cached tokens. */
export function hitRate(t: TokenCounts): number | null {
  const prompt = t.input_tokens + t.cache_read_tokens + t.cache_creation_tokens;
  return prompt > 0 ? t.cache_read_tokens / prompt : null;
}

export function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Inclusive start and end dates for a range, in the user's local time. */
export function rangeDates(r: Range, now = new Date()): { start: string; end: string } {
  const start = new Date(now);
  if (r === 'week') start.setDate(start.getDate() - 6);
  if (r === 'month') start.setDate(start.getDate() - 29);
  return { start: ymd(start), end: ymd(now) };
}

/**
 * Every bucket in the range, filled from the relay's points (which skip
 * empty hours and days), so the chart's x-axis is continuous.
 */
export function fillTrend(points: TrendPoint[], r: Range, now = new Date()): TrendPoint[] {
  const by = new Map(points.map((p) => [p.date, p]));
  const empty = (date: string): TrendPoint => ({
    date,
    requests: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    total_tokens: 0,
    actual_cost: 0,
  });
  const keys: string[] = [];
  if (r === 'today') {
    const day = ymd(now);
    for (let h = 0; h <= now.getHours(); h++) keys.push(`${day} ${String(h).padStart(2, '0')}:00`);
  } else {
    const d = new Date(now);
    d.setDate(d.getDate() - (r === 'week' ? 6 : 29));
    while (ymd(d) <= ymd(now)) {
      keys.push(ymd(d));
      d.setDate(d.getDate() + 1);
    }
  }
  return keys.map((k) => by.get(k) ?? empty(k));
}

/** 1234 → 1.2K, 3456789 → 3.46M, 2.1e9 → 2.1B. */
export function compact(n: number): string {
  const units: [number, string][] = [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [v, u] of units) {
    if (n >= v) {
      const x = n / v;
      return `${x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2)}${u}`.replace(/\.?0+(?=[KMB])/, '');
    }
  }
  return String(Math.round(n));
}

/** Cost with enough digits that a single cheap request is not shown as $0.00. */
export function money(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

export function percent(x: number | null): string {
  return x === null ? '—' : `${(x * 100).toFixed(1)}%`;
}

export interface Vendor {
  id: string;
  name: string;
  logo: LogoId | null;
}

// First match wins; checked against the lower-cased model id.
const VENDORS: [RegExp, Vendor][] = [
  [/^claude/, { id: 'anthropic', name: 'Claude', logo: 'claude' }],
  [/^(gpt|o\d|codex|chatgpt)/, { id: 'openai', name: 'GPT', logo: 'openai' }],
  [/^gemini/, { id: 'gemini', name: 'Gemini', logo: 'gemini' }],
  [/^grok/, { id: 'grok', name: 'Grok', logo: 'grok' }],
  [/^deepseek/, { id: 'deepseek', name: 'DeepSeek', logo: 'deepseek' }],
  [/^(glm|chatglm)/, { id: 'zhipu', name: 'GLM', logo: 'zhipu' }],
  [/^(kimi|moonshot)/, { id: 'kimi', name: 'Kimi', logo: 'kimi' }],
  [/^qwen/, { id: 'qwen', name: 'Qwen', logo: 'qwen' }],
  [/^minimax/, { id: 'minimax', name: 'MiniMax', logo: 'minimax' }],
  [/^(hy\d|hunyuan)/, { id: 'hunyuan', name: '混元', logo: 'hunyuan' }],
  [/^mimo/, { id: 'mimo', name: 'MiMo', logo: 'mimo' }],
];

const OTHER: Vendor = { id: 'other', name: '', logo: null };

/** The vendor behind a model id, judged by its name. */
export function vendorOf(model: string): Vendor {
  const m = model.toLowerCase().replace(/^.*\//, '');
  return VENDORS.find(([re]) => re.test(m))?.[1] ?? OTHER;
}

export interface VendorUsage extends ModelUsage {
  vendor: Vendor;
  models: string[];
}

/** Per-model rows summed per vendor, most expensive first. */
export function byVendor(rows: ModelUsage[]): VendorUsage[] {
  const out = new Map<string, VendorUsage>();
  for (const r of rows) {
    const v = vendorOf(r.model);
    const cur = out.get(v.id);
    if (!cur) {
      out.set(v.id, { ...r, vendor: v, models: [r.model] });
      continue;
    }
    cur.requests += r.requests;
    cur.input_tokens += r.input_tokens;
    cur.output_tokens += r.output_tokens;
    cur.cache_creation_tokens += r.cache_creation_tokens;
    cur.cache_read_tokens += r.cache_read_tokens;
    cur.total_tokens += r.total_tokens;
    cur.actual_cost += r.actual_cost;
    cur.models.push(r.model);
  }
  return [...out.values()].sort((a, b) => b.actual_cost - a.actual_cost);
}
