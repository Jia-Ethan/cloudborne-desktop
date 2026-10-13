import { describe, expect, it } from 'vitest';
import { ccSwitchLink, createBody, customKeyProblem, emptyForm, exampleModel, maskKey, snippet, updateBody } from './keys';
import { byProvider, stateOf } from './status';

describe('keys', () => {
  it('masks keys', () => {
    expect(maskKey('sk-1234567890abcdefwxyz')).toBe('sk-1234…wxyz');
    expect(maskKey('short')).toBe('short');
  });

  it('leaves unlimited fields out when creating', () => {
    const f = { ...emptyForm(), name: ' Test ', groupId: 3, quota: '0', limit1d: '5', expiry: '30' as const, allow: '1.2.3.4\n10.0.0.0/8' };
    expect(createBody(f)).toEqual({ name: 'Test', group_id: 3, rate_limit_1d: 5, expires_in_days: 30, ip_whitelist: ['1.2.3.4', '10.0.0.0/8'] });
  });

  it('clears limits and expiry on update', () => {
    const f = { ...emptyForm(), name: 'k', groupId: 1, expiry: 'never' as const };
    const b = updateBody(f);
    expect(b).toMatchObject({ quota: 0, rate_limit_5h: 0, ip_whitelist: [], expires_at: '' });
    expect(updateBody({ ...f, expiry: 'keep' })).not.toHaveProperty('expires_at');
    expect(updateBody({ ...f, expiry: '7' }, new Date('2026-10-13T00:00:00Z')).expires_at).toBe('2026-10-20T00:00:00.000Z');
  });

  it('checks custom keys like the relay', () => {
    expect(customKeyProblem('')).toBeNull();
    expect(customKeyProblem('abc')).toBe('short');
    expect(customKeyProblem('abcdefghijklmnop!')).toBe('chars');
    expect(customKeyProblem('abcdefgh_ijkl-mnop')).toBeNull();
  });

  it('writes examples for each API style', () => {
    expect(snippet('curl', 'anthropic', 'https://api.x.cn/', 'sk-a', 'claude-x')).toContain('curl https://api.x.cn/v1/messages');
    expect(snippet('python', 'openai', 'https://api.x.cn', 'sk-a', 'gpt-x')).toContain('base_url="https://api.x.cn/v1"');
    expect(snippet('node', 'antigravity', 'https://api.x.cn', 'sk-a', 'm')).toContain("baseURL: 'https://api.x.cn/antigravity'");
    expect(exampleModel('openai', ['gpt-image-2', 'gpt-6-luna'])).toBe('gpt-6-luna');
    expect(exampleModel('grok', [])).toBe('grok-4.5');
  });

  it('builds the CC Switch link the web console uses', () => {
    const u = new URL(ccSwitchLink('grok', 'https://api.x.cn', 'sk-a', 'grok-4.7'));
    expect(u.protocol).toBe('ccswitch:');
    expect(u.searchParams.get('app')).toBe('grokbuild');
    expect(u.searchParams.get('endpoint')).toBe('https://api.x.cn/v1');
    expect(u.searchParams.get('model')).toBe('grok-4.7');
    expect(new URL(ccSwitchLink('anthropic', 'https://api.x.cn', 'sk-a')).searchParams.get('model')).toBeNull();
  });
});

describe('status', () => {
  const m = (provider: string, status: string, timeline: string[], latency = 800) => ({
    id: 1,
    provider,
    primary_status: status,
    primary_latency_ms: latency,
    availability_7d: 99,
    timeline: timeline.map((s, i) => ({ status: s, latency_ms: 1, checked_at: `2026-10-13T00:0${9 - i}:00Z` })),
  });

  it('rolls probes up per provider, worst first', () => {
    const rows = byProvider([m('openai', 'operational', ['operational', 'failed']), m('openai', 'degraded', ['operational']), m('anthropic', 'operational', [])], 4);
    expect(rows.map((r) => r.provider)).toEqual(['anthropic', 'openai']);
    const gpt = rows[1];
    expect(gpt.state).toBe('slow');
    expect(gpt.history).toEqual(['unknown', 'unknown', 'down', 'up']);
    expect(gpt.lastChecked).toBe('2026-10-13T00:09:00Z');
    expect(stateOf('error')).toBe('down');
  });
});
