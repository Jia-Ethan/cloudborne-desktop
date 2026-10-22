import { describe, expect, it } from 'vitest';
import type { TokenPack } from './api';
import { packLeft, tokenCount, visiblePacks } from './tokenPacks';

const pack = (o: Partial<TokenPack>): TokenPack => ({
  id: 1,
  group_id: 95,
  group_name: 'Deepseek',
  tokens_total: 1_000_000_000,
  tokens_used: 0,
  created_at: '2026-10-21T00:55:00+08:00',
  expires_at: '2026-10-22T00:55:00+08:00',
  status: 'active',
  ...o,
});

describe('token packs', () => {
  it('reports the unused share, clamped', () => {
    expect(packLeft(pack({ tokens_used: 250_000_000 }))).toBe(0.75);
    expect(packLeft(pack({ tokens_used: 2_000_000_000 }))).toBe(0);
    expect(packLeft(pack({ tokens_total: 0 }))).toBe(0);
  });

  it('formats token counts compactly', () => {
    expect(tokenCount(1_000_000_000)).toBe('1000M');
    expect(tokenCount(37_500_000)).toBe('37.5M');
    expect(tokenCount(1_250_000)).toBe('1.25M');
    expect(tokenCount(999_871_872)).toBe('1000M');
    expect(tokenCount(820_000)).toBe('820K');
    expect(tokenCount(12_300)).toBe('12.3K');
    expect(tokenCount(512)).toBe('512');
  });

  it('lists only active packs, by expiry', () => {
    const list = visiblePacks([
      pack({ id: 5, status: 'expired' }),
      pack({ id: 4, expires_at: '2026-10-25T00:00:00+08:00' }),
      pack({ id: 3, status: 'used_up' }),
      pack({ id: 2, expires_at: '2026-10-23T00:00:00+08:00' }),
      pack({ id: 1, status: 'expired' }),
    ]);
    expect(list.map((p) => p.id)).toEqual([2, 4]);
  });
});
