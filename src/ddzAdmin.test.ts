import { describe, expect, it } from 'vitest';
import type { DdzSettings, DdzSummary } from './api';
import { dealTime, draftErrors, draftOf, draftPatch, modeRows, seatsOf, signed, tone, type Deal } from './ddzAdmin';

const live: DdzSettings = { enabled: true, fee_enabled: true, fee_bps: 500, min_balance_times: 20, laizi: 'admin', laizi_min_balance_times: 40 };

describe('斗地主 admin settings', () => {
  it('starts from what the relay has, with its defaults for missing fields', () => {
    expect(draftOf(live)).toEqual({ fee_enabled: true, fee_rate: '5', min_balance_times: '20', laizi: 'admin', laizi_min_balance_times: '40' });
    expect(draftOf({ enabled: false } as DdzSettings)).toEqual({
      fee_enabled: false,
      fee_rate: '5',
      min_balance_times: '20',
      laizi: 'off',
      laizi_min_balance_times: '40',
    });
  });

  it('sends only what changed', () => {
    expect(draftPatch(live, draftOf(live))).toBeNull();
    expect(draftPatch(live, { ...draftOf(live), fee_rate: '5.00' })).toBeNull();
    expect(draftPatch(live, { ...draftOf(live), fee_rate: '2.5' })).toEqual({ fee_bps: 250 });
    expect(draftPatch(live, { ...draftOf(live), laizi: 'on', laizi_min_balance_times: '50' })).toEqual({ laizi: 'on', laizi_min_balance_times: 50 });
    expect(draftPatch(live, { ...draftOf(live), fee_enabled: false, min_balance_times: '30' })).toEqual({ fee_enabled: false, min_balance_times: 30 });
  });

  it('compares against the defaults when the relay left a field out', () => {
    const old = { enabled: true, fee_enabled: false, fee_bps: 500, min_balance_times: 20 } as DdzSettings;
    expect(draftPatch(old, draftOf(old))).toBeNull();
    expect(draftPatch(old, { ...draftOf(old), laizi: 'admin' })).toEqual({ laizi: 'admin' });
  });

  it('flags values the relay would refuse', () => {
    expect(draftErrors(draftOf(live))).toEqual({});
    expect(draftErrors({ ...draftOf(live), fee_rate: '10' })).toEqual({});
    expect(draftErrors({ ...draftOf(live), fee_rate: '0' })).toEqual({});
    expect(draftErrors({ ...draftOf(live), fee_rate: '10.5' })).toEqual({ fee_rate: 'fee' });
    expect(draftErrors({ ...draftOf(live), fee_rate: '2.555' })).toEqual({ fee_rate: 'fee' });
    expect(draftErrors({ ...draftOf(live), fee_rate: '' })).toEqual({ fee_rate: 'fee' });
    expect(draftErrors({ ...draftOf(live), min_balance_times: '9', laizi_min_balance_times: '101' })).toEqual({
      min_balance_times: 'times',
      laizi_min_balance_times: 'times',
    });
    expect(draftErrors({ ...draftOf(live), min_balance_times: '20.5' })).toEqual({ min_balance_times: 'times' });
  });
});

describe('斗地主 admin figures', () => {
  it('writes the sign out and colours by direction', () => {
    expect(signed(5.57)).toBe('+$5.57');
    expect(signed(-26.58)).toBe('−$26.58');
    expect(signed(0)).toBe('$0.00');
    expect([tone(1), tone(-1), tone(0)]).toEqual(['up', 'down', undefined]);
  });

  it('shows deal times as local month-day and 24-hour time', () => {
    expect(dealTime(new Date(2026, 9, 31, 23, 4).toISOString())).toEqual({ day: '10-31', time: '23:04' });
  });

  it('names human, AI and unknown seats and marks the landlord', () => {
    const g: Deal = {
      id: 'g1',
      mode: 'laizi',
      base: 0.1,
      field: '',
      landlord: 1,
      winner: 0,
      users: [7, 0, 0],
      roles: ['', 'kimi', ''],
      names: ['shun', '', ''],
      kinds: ['human', 'bot', 'unknown'],
      fee: [0.01, 0, 0],
      delta: [0.19, -0.4, 0.2],
      at: '2026-10-31T15:24:00Z',
    };
    expect(seatsOf(g)).toEqual([
      { kind: 'human', name: 'shun', user: 7, landlord: false, delta: 0.19, fee: 0.01 },
      { kind: 'bot', name: 'Kimi', user: null, landlord: true, delta: -0.4, fee: 0 },
      { kind: 'unknown', name: '', user: null, landlord: false, delta: 0.2, fee: 0 },
    ]);
    expect(seatsOf({ ...g, names: undefined })[0].name).toBe('#7');
  });

  it('splits money by mode only once 赖子场 has deals', () => {
    const s = { games: 3, modes: { joker: { games: 2, platform_net: -1, fee_income: 0.5 } } } as unknown as DdzSummary;
    expect(modeRows(s)).toBeNull();
    s.modes!.laizi = { games: 1, platform_net: 2, fee_income: 0.25 };
    expect(modeRows(s)).toEqual([
      { mode: 'joker', games: 2, fee: 0.5, ai: -1, total: -0.5 },
      { mode: 'laizi', games: 1, fee: 0.25, ai: 2, total: 2.25 },
    ]);
  });
});
