import type { Money, Transaction, TransactionListItem } from './api-types';

/** Money for display. Intl knows each currency's minor units (2 for ARS/USD, 0 for CLP/JPY). */
export const formatMoney = (m: Money): string => {
  const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: m.currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(m.amountMinor / 10 ** digits);
};

export const money = (m: Money | null | undefined): string => (m ? formatMoney(m) : '—');

/** "Oct 14, 3:20 PM" in the given time zone (the merchant's, for card transactions). */
export const dateTime = (iso: string, timeZone?: string): string =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...(timeZone && { timeZone }) }).format(
    new Date(iso),
  );

/** "Oct 14, 2026" for a calendar date ("2026-10-14"). */
export const date = (isoDate: string): string =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${isoDate}T00:00:00Z`));

/** "Oct 14, 2026 · 23:40": an instant on the merchant's local calendar and 24-hour clock. */
export const localDateAndTime = (iso: string, timeZone: string): string => {
  const instant = new Date(iso);
  const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone }).format(instant);
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(instant);
  return `${day} · ${time}`;
};

/** "restaurant · 5812", or "MCC 5999" when the API doesn't know the category. */
export const merchantTypeLabel = (t: Pick<TransactionListItem, 'mcc' | 'merchantType'>): string =>
  t.merchantType ? `${t.merchantType} · ${t.mcc}` : `MCC ${t.mcc}`;

/** Amount as charged, plus the original currency for foreign purchases. */
export const chargeAmount = (tx: Pick<Transaction, 'amount' | 'originalAmount'>): string =>
  tx.originalAmount ? `${formatMoney(tx.amount)} (${formatMoney(tx.originalAmount)})` : formatMoney(tx.amount);

export const pct = (score: number): string => `${Math.round(score * 100)}%`;
