import { describe, expect, it } from 'vitest';
import { displayName } from './api';
import { direction, historyTitle, historyValue, redeemedText } from './redeem';

// Echoes the key and its variables, so the tests read without a language table.
const t = (key: string, vars?: Record<string, string | number>) =>
  vars ? `${key}(${Object.values(vars).join(',')})` : key;

describe('redeem', () => {
  it('names each kind of balance change', () => {
    expect(historyTitle({ type: 'balance', value: 5 }, t)).toBe('redeem.type.balance');
    expect(historyTitle({ type: 'admin_balance', value: -2 }, t)).toBe('redeem.type.adminDeduct');
    expect(historyTitle({ type: 'admin_balance', value: 2 }, t)).toBe('redeem.type.adminAdd');
    expect(historyTitle({ type: 'lottery', value: -25 }, t)).toBe('redeem.type.lottery');
    expect(historyTitle({ type: 'doudizhu', value: 1.6 }, t)).toBe('redeem.type.ddz');
    expect(historyTitle({ type: 'transfer', value: 3 }, t)).toBe('redeem.type.transferIn');
    expect(historyTitle({ type: 'transfer', value: -3 }, t)).toBe('redeem.type.transferOut');
    expect(historyTitle({ type: 'something_new', value: 1 }, t)).toBe('redeem.type.other');
  });

  it('formats amounts with a sign', () => {
    expect(historyValue({ type: 'balance', value: 5 }, t)).toBe('+$5.00');
    expect(historyValue({ type: 'lottery', value: -25 }, t)).toBe('−$25.00');
    expect(historyValue({ type: 'concurrency', value: 2 }, t)).toBe('+2 redeem.requests');
    expect(historyValue({ type: 'admin_concurrency', value: -1 }, t)).toBe('−1 redeem.requests');
    expect(historyValue({ type: 'subscription', value: 30, validity_days: 30, group: { id: 1, name: 'Pro' } }, t)).toBe(
      'redeem.days(30) · Pro',
    );
    expect(direction({ type: 'lottery', value: -25 })).toBe('out');
    expect(direction({ type: 'subscription', value: 0 })).toBe('in');
  });

  it('says what a redeemed code gave', () => {
    expect(redeemedText({ type: 'balance', value: 10 }, t)).toBe('redeem.doneBalance($10.00)');
    expect(redeemedText({ type: 'subscription', value: 7, group: null }, t)).toBe('redeem.doneSubscriptionNoGroup(7)');
  });

  it('shows the username, else the email name', () => {
    expect(displayName({ username: 'Ethan', email: 'e@x.com' })).toBe('Ethan');
    expect(displayName({ username: '  ', email: 'ethanpier776@gmail.com' })).toBe('ethanpier776');
    expect(displayName({ email: 'a@b.c' })).toBe('a');
  });
});
