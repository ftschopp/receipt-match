import type { Money } from './types';

export function money(amountMinor: number, currency: string): Money {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new Error(`Money amounts must be integer minor units, got ${amountMinor}`);
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error(`Invalid ISO 4217 currency code: ${currency}`);
  }
  return { amountMinor, currency };
}

/** Number of minor-unit digits for a currency (2 for MXN/USD, 0 for JPY/CLP...). */
export function minorUnitDigits(currency: string): number {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits ?? 2;
}

/**
 * Parses an amount as printed on a receipt into minor units.
 * Handles "$1,450.00", "1.450,00", "1450", "1,450" (thousands), "49.99", "-12.50".
 * Returns null when the text has no recognizable amount.
 */
export function parseAmount(text: string, currency: string): Money | null {
  const cleaned = text.replace(/[^\d.,-]/g, '');
  const match = cleaned.match(/-?[\d.,]*\d/);
  if (!match) return null;
  let s = match[0];
  const negative = s.startsWith('-');
  s = s.replace('-', '');

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  const lastSep = Math.max(lastDot, lastComma);

  let integerPart = s;
  let fractionPart = '';
  if (lastSep !== -1) {
    const digitsAfter = s.length - lastSep - 1;
    const sepCount = (s.match(/[.,]/g) ?? []).length;
    const onlyOneKindOfSep = lastDot === -1 || lastComma === -1;
    // "1,450" or "1.450.000": with a single kind of separator, a repeated separator or exactly
    // 3 trailing digits reads as a thousands separator, not a decimal point.
    const isThousands = onlyOneKindOfSep && (sepCount > 1 || digitsAfter === 3);
    if (!isThousands) {
      integerPart = s.slice(0, lastSep);
      fractionPart = s.slice(lastSep + 1);
    }
  }
  integerPart = integerPart.replace(/[.,]/g, '');
  if (integerPart === '') integerPart = '0';

  const digits = minorUnitDigits(currency);
  const fraction = (fractionPart + '0'.repeat(digits)).slice(0, digits);
  const amountMinor = Number(integerPart + fraction) * (negative ? -1 : 1);
  return Number.isSafeInteger(amountMinor) ? money(amountMinor, currency) : null;
}

export function formatMoney(m: Money, locale = 'en-US'): string {
  const digits = minorUnitDigits(m.currency);
  return new Intl.NumberFormat(locale, { style: 'currency', currency: m.currency }).format(
    m.amountMinor / 10 ** digits,
  );
}

/** Currencies written with a bare "$". A receipt printing only "$" could be in any of them. */
export const DOLLAR_SIGN_CURRENCIES: readonly string[] = ['ARS', 'USD', 'MXN', 'COP', 'CLP', 'UYU', 'CAD', 'AUD', 'NZD'];

/** The same printed amount read in another currency ("$49.99" as ARS → as USD), adjusting minor units. */
export function inCurrency(m: Money, currency: string): Money {
  if (m.currency === currency) return m;
  const shift = minorUnitDigits(currency) - minorUnitDigits(m.currency);
  const amountMinor = shift >= 0 ? m.amountMinor * 10 ** shift : Math.round(m.amountMinor / 10 ** -shift);
  return money(amountMinor, currency);
}
