import { describe, expect, it } from 'vitest';
import { transferAmount, transferFee } from './transfer';

describe('transferAmount', () => {
  it('takes $10 and up with at most two decimals', () => {
    expect(transferAmount('10')).toBe(10);
    expect(transferAmount('12.5')).toBe(12.5);
    expect(transferAmount(' 30.45 ')).toBe(30.45);
  });

  it('turns down anything the relay would refuse', () => {
    for (const bad of ['', '0', '1', '9.99', '10.234', '.5', '10.', '1.2.3', 'abc']) {
      expect(transferAmount(bad)).toBeNull();
    }
  });
});

describe('transferFee', () => {
  it('is 5% rounded up to the cent, matching the relay', () => {
    expect(transferFee(10)).toBe(0.5);
    expect(transferFee(10.01)).toBe(0.51);
    expect(transferFee(12.5)).toBe(0.63);
    expect(transferFee(100)).toBe(5);
    expect(transferFee(123.45)).toBe(6.18);
  });
});
