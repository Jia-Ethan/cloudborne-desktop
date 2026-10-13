import { describe, expect, it } from 'vitest';
import { percent, share, zhe } from './DiscountBar';

describe('discount', () => {
  it('divides dollar-listed vendors by the exchange rate', () => {
    expect(zhe(share(0.37, 7.2))).toBe(0.52);
    expect(zhe(share(1.2, 7.2))).toBe(1.7);
    expect(zhe(share(0.35, 7.2))).toBe(0.49);
  });

  it('takes the rate itself for yuan-listed vendors', () => {
    expect(zhe(share(0.3, 7.2, true))).toBe(3);
    expect(zhe(share(0.5, 7.2, true))).toBe(5);
    expect(zhe(share(0.2, 7.2, true))).toBe(2);
  });

  it('keeps account-specific rates apart below 1折', () => {
    expect(zhe(share(0.25, 7.2))).toBe(0.35);
    expect(zhe(share(0.3, 7.2))).toBe(0.42);
    expect(zhe(share(0.33, 7.2))).toBe(0.46);
  });

  it('never rounds in the customer’s favour', () => {
    expect(zhe(0.1)).toBe(1);
    expect(zhe(0.10001)).toBe(1.1);
    expect(percent(0.0514)).toBe(5.2);
    expect(percent(0.5)).toBe(50);
  });
});
