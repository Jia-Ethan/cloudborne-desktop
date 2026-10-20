import { describe, expect, it } from 'vitest';
import { transferAmount } from './transfer';

describe('transferAmount', () => {
  it('takes $1 and up with at most two decimals', () => {
    expect(transferAmount('1')).toBe(1);
    expect(transferAmount('12.5')).toBe(12.5);
    expect(transferAmount(' 3.45 ')).toBe(3.45);
  });

  it('turns down anything the relay would refuse', () => {
    for (const bad of ['', '0', '0.99', '1.234', '.5', '1.', '1.2.3', 'abc']) {
      expect(transferAmount(bad)).toBeNull();
    }
  });
});
