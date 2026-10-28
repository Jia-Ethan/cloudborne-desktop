import { describe, expect, it } from 'vitest';
import { ADMIN_RANGES, byVendor, compact, fillTrend, hitRate, money, rangeDates, USER_RANGES, vendorOf } from './usage';

const counts = (input: number, read: number, write = 0) => ({
  input_tokens: input,
  output_tokens: 0,
  cache_creation_tokens: write,
  cache_read_tokens: read,
});

describe('usage', () => {
  it('counts cache reads against every prompt token', () => {
    expect(hitRate(counts(200, 800))).toBe(0.8);
    expect(hitRate(counts(100, 300, 100))).toBe(0.6);
    expect(hitRate(counts(0, 0))).toBeNull();
  });

  it('spans inclusive local dates', () => {
    const now = new Date(2026, 9, 13, 15, 30);
    expect(rangeDates('today', now)).toEqual({ start: '2026-10-13', end: '2026-10-13' });
    expect(rangeDates('week', now)).toEqual({ start: '2026-10-07', end: '2026-10-13' });
    expect(rangeDates('month', now)).toEqual({ start: '2026-09-14', end: '2026-10-13' });
  });

  it('offers customers at most 7 days and admins 30', () => {
    expect(USER_RANGES).toEqual(['today', 'week']);
    expect(ADMIN_RANGES).toContain('month');
  });

  it('fills the hours and days the relay skips', () => {
    const now = new Date(2026, 9, 13, 3, 10);
    const p = { date: '2026-10-13 02:00', requests: 4, total_tokens: 10, actual_cost: 1, ...counts(10, 0) };
    const hours = fillTrend([p], 'today', now);
    expect(hours.map((h) => h.date)).toEqual(['2026-10-13 00:00', '2026-10-13 01:00', '2026-10-13 02:00', '2026-10-13 03:00']);
    expect(hours[2].requests).toBe(4);
    expect(fillTrend([], 'week', now)).toHaveLength(7);
    expect(fillTrend([], 'month', now)[0].date).toBe('2026-09-14');
  });

  it('formats numbers compactly', () => {
    expect(compact(950)).toBe('950');
    expect(compact(1234)).toBe('1.23K');
    expect(compact(12_500)).toBe('12.5K');
    expect(compact(3_000_000)).toBe('3M');
    expect(compact(456_000_000)).toBe('456M');
    expect(money(0.00042)).toBe('$0.0004');
    expect(money(0.5)).toBe('$0.500');
    expect(money(12.3456)).toBe('$12.35');
  });

  it('names the vendor behind each model', () => {
    const v = (m: string) => vendorOf(m).id;
    expect(v('claude-opus-4-6')).toBe('anthropic');
    expect(v('gpt-6-luna')).toBe('openai');
    expect(v('o4-mini')).toBe('openai');
    expect(v('gemini-3.8-flash')).toBe('gemini');
    expect(v('grok-4.7')).toBe('grok');
    expect(v('deepseek-v4.1-flash')).toBe('deepseek');
    expect(v('glm-5.3-flash')).toBe('zhipu');
    expect(v('kimi-k3')).toBe('kimi');
    expect(v('qwen3.8-max')).toBe('qwen');
    expect(v('minimax-m3')).toBe('minimax');
    expect(v('hy4-preview')).toBe('hunyuan');
    expect(v('mimo-v2.6-flash')).toBe('mimo');
    expect(v('lgw/grok-4.7-api')).toBe('grok');
    expect(v('some-new-model')).toBe('other');
  });

  it('sums models per vendor', () => {
    const row = (model: string, cost: number) => ({ model, requests: 1, total_tokens: 10, actual_cost: cost, ...counts(10, 0) });
    const out = byVendor([row('claude-opus-5-5', 1), row('gpt-6-luna', 3), row('claude-sonnet-5-5', 0.5)]);
    expect(out.map((v) => v.vendor.id)).toEqual(['openai', 'anthropic']);
    expect(out[1].requests).toBe(2);
    expect(out[1].actual_cost).toBe(1.5);
    expect(out[1].models).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5']);
  });
});
