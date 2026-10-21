import { describe, expect, it } from 'vitest';
import { formatMoney, money, parseAmount } from '../../src/domain/money';

describe('money', () => {
  it('rejects non-integer minor units', () => {
    expect(() => money(14.5, 'MXN')).toThrow(/integer/);
  });

  it('rejects invalid currency codes', () => {
    expect(() => money(100, 'mxn')).toThrow(/ISO 4217/);
  });
});

describe('parseAmount', () => {
  it.each([
    ['$1,450.00', 145000],
    ['1.450,00', 145000],
    ['1450', 145000],
    ['1,450', 145000],
    ['1.450.000', 145000000],
    ['49.99', 4999],
    ['$ 95.5', 9550],
    ['TOTAL: 320.00 MXN', 32000],
    ['-12.50', -1250],
  ])('parses %s', (text, expected) => {
    expect(parseAmount(text, 'MXN')).toEqual({ amountMinor: expected, currency: 'MXN' });
  });

  it('uses the currency minor units (JPY has none)', () => {
    expect(parseAmount('1,200', 'JPY')).toEqual({ amountMinor: 1200, currency: 'JPY' });
  });

  it('returns null when there is no amount', () => {
    expect(parseAmount('TOTAL', 'MXN')).toBeNull();
  });
});

describe('formatMoney', () => {
  it('formats minor units for display', () => {
    expect(formatMoney(money(145000, 'MXN'))).toBe('MX$1,450.00');
    expect(formatMoney(money(4999, 'USD'))).toBe('$49.99');
  });
});
