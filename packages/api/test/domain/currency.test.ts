import { describe, expect, it } from 'vitest';
import { settleCurrency } from '../../src/domain/matching/currency';
import { matchReceipt, scoreAmount } from '../../src/domain/matching/match';
import { inCurrency, money } from '../../src/domain/money';
import type { ExtractedReceipt, Transaction } from '../../src/domain/types';

const ars = (pesos: number) => money(Math.round(pesos * 100), 'ARS');
const f = <T>(value: T | null) => ({ value, confidence: 96 });

/** An online purchase in USD, charged in ARS on an Argentine card. */
const notion: Transaction = {
  id: 'tx-notion',
  employeeId: 'emp-juan',
  authorizedAt: '2026-10-15T14:00:00Z',
  merchantDescriptor: 'NOTION.SO',
  mcc: '5734',
  merchantCity: 'San Francisco',
  merchantCountry: 'US',
  merchantTimezone: 'America/Los_Angeles',
  cardPresent: false,
  amount: ars(72_485.5),
  originalAmount: money(4999, 'USD'),
  receiptId: null,
};

/** "$49.99" with no currency code, read in the company currency (ARS). */
const invoice = (ambiguous: boolean): ExtractedReceipt => ({
  merchantName: f('Notion Labs, Inc.'),
  address: f(null),
  city: f(null),
  date: f({ kind: 'exact', date: '2026-10-15' }),
  time: f(null),
  subtotal: f(null),
  tax: f(null),
  tip: f(null),
  total: f(ars(49.99)),
  lineItems: [{ description: 'Plus plan monthly', amount: ars(49.99), confidence: 95 }],
  ...(ambiguous && { currencyAmbiguous: true }),
});

describe('inCurrency', () => {
  it('re-reads the printed amount, adjusting minor units', () => {
    expect(inCurrency(ars(49.99), 'USD')).toEqual(money(4999, 'USD'));
    expect(inCurrency(money(1500, 'USD'), 'CLP')).toEqual(money(15, 'CLP')); // CLP has no decimals
  });
});

describe('a receipt that prints only "$"', () => {
  it('matches a USD charge when the amounts fit in USD', () => {
    const scored = scoreAmount(ars(49.99), null, notion, undefined, true);
    expect(scored).toMatchObject({ score: 1, currency: 'USD' });
    expect(scored?.reason).toContain('the receipt shows only "$", read as USD');
  });

  it('is not re-read when the receipt printed a currency code', () => {
    expect(scoreAmount(ars(49.99), null, notion, undefined, false)).toBeNull();
  });

  it('is matched by the matcher and reports the inferred currency', () => {
    const extraction = invoice(true);
    const result = matchReceipt(
      { ...extraction, date: { date: '2026-10-15', resolution: 'printed', confidence: 99 }, currencyAmbiguous: true },
      [notion],
    );
    expect(result.outcome).toBe('suggested');
    expect(result.candidates[0]).toMatchObject({ transactionId: 'tx-notion', currency: 'USD' });
  });

  it('settles to the anchor currency and re-reads every amount', () => {
    const { extraction, currency } = settleCurrency(invoice(true), 'ARS', notion);
    expect(currency).toEqual({ code: 'USD', readAs: 'ARS', resolution: 'inferred_from_transaction' });
    expect(extraction.total.value).toEqual(money(4999, 'USD'));
    expect(extraction.lineItems[0]?.amount).toEqual(money(4999, 'USD'));
  });

  it('settles back to the company currency when the anchor changes to a peso charge', () => {
    const inUsd = settleCurrency(invoice(true), 'ARS', notion).extraction;
    const pesoCharge = { ...notion, id: 'tx-peso', amount: ars(49.99), originalAmount: null };
    const { extraction, currency } = settleCurrency(inUsd, 'ARS', pesoCharge);
    expect(currency).toEqual({ code: 'ARS', readAs: 'ARS', resolution: 'company_default' });
    expect(extraction.total.value).toEqual(ars(49.99));
  });

  it('keeps a printed currency as printed', () => {
    expect(settleCurrency(invoice(false), 'ARS', notion).currency).toEqual({ code: 'ARS', readAs: 'ARS', resolution: 'printed' });
  });
});
