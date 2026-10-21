import { describe, expect, it } from 'vitest';
import { candidateWindow, matchReceipt, scoreAmount, type MatchInput } from '../../src/domain/matching/match';
import { money } from '../../src/domain/money';
import type { Money, ResolvedDate, Transaction } from '../../src/domain/types';

const MX = 'America/Mexico_City'; // UTC-6, no DST

function tx(overrides: Partial<Transaction> & Pick<Transaction, 'id' | 'merchantDescriptor' | 'amount' | 'authorizedAt'>): Transaction {
  return {
    employeeId: 'emp-juan',
    mcc: '5812',
    merchantCity: 'Mexico City',
    merchantCountry: 'MX',
    merchantTimezone: MX,
    cardPresent: true,
    originalAmount: null,
    receiptId: null,
    ...overrides,
  };
}

function receipt(opts: {
  merchant?: string | null;
  total?: Money | null;
  tip?: Money | null;
  date?: string | null;
  resolution?: ResolvedDate['resolution'];
  totalConfidence?: number;
}): MatchInput {
  return {
    merchantName: { value: opts.merchant ?? null, confidence: 95 },
    total: { value: opts.total ?? null, confidence: opts.totalConfidence ?? 98 },
    tip: { value: opts.tip ?? null, confidence: 90 },
    date: opts.date ? { date: opts.date, resolution: opts.resolution ?? 'printed', confidence: 99 } : null,
  };
}

const mxn = (pesos: number) => money(Math.round(pesos * 100), 'MXN');

// Seed-like week of card transactions (authorizedAt in UTC; local = UTC-6)
const starbucks = tx({ id: 'tx-starbucks', merchantDescriptor: 'STARBUCKS 1123', mcc: '5814', amount: mxn(95), authorizedAt: '2026-10-13T15:12:00Z' });
const docena = tx({ id: 'tx-docena', merchantDescriptor: 'REST LA DOCENA CDMX', amount: mxn(1667.5), authorizedAt: '2026-10-14T21:20:00Z' });
const notion = tx({
  id: 'tx-notion',
  merchantDescriptor: 'NOTION.SO',
  mcc: '5734',
  cardPresent: false,
  amount: mxn(872.3),
  originalAmount: money(4999, 'USD'),
  authorizedAt: '2026-10-15T17:00:00Z',
});
const uber = tx({ id: 'tx-uber', merchantDescriptor: 'UBER *TRIP', mcc: '4121', amount: mxn(320), authorizedAt: '2026-10-16T02:05:00Z' });
const oxxo = tx({ id: 'tx-oxxo', merchantDescriptor: 'OXXO 4421', mcc: '5499', amount: mxn(320), authorizedAt: '2026-10-16T03:30:00Z' });
const week = [starbucks, docena, notion, uber, oxxo];

describe('demo scenarios (SPEC §10)', () => {
  it('1. exact match', () => {
    const result = matchReceipt(receipt({ merchant: 'Starbucks Coffee', total: mxn(95), date: '2026-10-13' }), week);
    expect(result.outcome).toBe('suggested');
    expect(result.candidates[0]).toMatchObject({ transactionId: 'tx-starbucks', score: 1 });
  });

  it('2. tip: charge 15% above the receipt', () => {
    const result = matchReceipt(receipt({ merchant: 'La Docena Oyster Bar', total: mxn(1450), date: '2026-10-14' }), week);
    expect(result.outcome).toBe('suggested');
    const best = result.candidates[0]!;
    expect(best.transactionId).toBe('tx-docena');
    expect(best.signals.amount?.reason).toBe('Charge is 15% above the receipt, consistent with a tip');
  });

  it('3. foreign currency: compares against the original USD amount', () => {
    const result = matchReceipt(receipt({ merchant: 'Notion Labs, Inc.', total: money(4999, 'USD'), date: '2026-10-15' }), week);
    expect(result.outcome).toBe('suggested');
    expect(result.candidates[0]?.transactionId).toBe('tx-notion');
    expect(result.candidates[0]?.signals.amount?.reason).toBe('Exact amount in original currency (USD)');
  });

  it('4. two charges with the same amount on the same day: the merchant breaks the tie', () => {
    // Both are on Oct 15 local time (02:05Z and 03:30Z on Oct 16 = 20:05 and 21:30 on Oct 15)
    const result = matchReceipt(receipt({ merchant: 'OXXO', total: mxn(320), date: '2026-10-15' }), week);
    expect(result.outcome).toBe('suggested');
    expect(result.candidates.map((c) => c.transactionId)).toEqual(['tx-oxxo', 'tx-uber']);
  });

  it('10. no transaction can explain the amount', () => {
    const result = matchReceipt(receipt({ merchant: 'Liverpool', total: mxn(5400), date: '2026-10-14' }), week);
    expect(result.outcome).toBe('no_match');
    expect(result.candidates).toEqual([]);
  });
});

describe('amount gate', () => {
  it('accepts a printed tip added to the total', () => {
    expect(scoreAmount(mxn(1450), mxn(217.5), docena)).toEqual({
      score: 1,
      reason: 'Receipt total plus printed tip (MX$217.50)',
      currency: 'MXN',
    });
  });

  it('discards a charge lower than the receipt', () => {
    expect(scoreAmount(mxn(100), null, starbucks)).toBeNull();
  });

  it('discards a charge more than 25% above the receipt', () => {
    expect(scoreAmount(mxn(1000), null, docena)).toBeNull();
  });

  it('discards a different currency with no original amount to compare', () => {
    expect(scoreAmount(money(9500, 'USD'), null, starbucks)).toBeNull();
  });

  it('scores every tip in the normal 0–20% range the same', () => {
    expect(scoreAmount(mxn(1516), null, docena)!.score).toBe(0.85); // +10%
    expect(scoreAmount(mxn(1390), null, docena)!.score).toBe(0.85); // +20%
  });

  it('lowers the score for tips above 20%, down to 0.5 at 25%', () => {
    const large = scoreAmount(mxn(1350), null, docena)!; // +23.5%
    expect(large.score).toBeLessThan(0.85);
    expect(large.score).toBeGreaterThanOrEqual(0.5);
    expect(large.reason).toMatch(/larger tip than usual/);
  });

  it('prefers the right merchant with a normal tip over a different merchant with the exact amount', () => {
    const exactElsewhere = tx({ id: 'tx-bodega', merchantDescriptor: 'LA BODEGA GDL', mcc: '5921', amount: mxn(1450), authorizedAt: '2026-10-15T05:40:00Z' });
    const result = matchReceipt(receipt({ merchant: 'La Docena Oyster Bar', total: mxn(1450), date: '2026-10-14' }), [docena, exactElsewhere]);
    expect(result.outcome).toBe('suggested');
    expect(result.candidates.map((c) => c.transactionId)).toEqual(['tx-docena', 'tx-bodega']);
  });
});

describe('candidates', () => {
  it('only considers charges inside the date window', () => {
    expect(candidateWindow('2026-10-14')).toEqual({ from: '2026-10-13', to: '2026-10-19' });
    // Starbucks was on Oct 13; a receipt dated Oct 20 is outside its window
    const result = matchReceipt(receipt({ merchant: 'Starbucks', total: mxn(95), date: '2026-10-20' }), week);
    expect(result.outcome).toBe('no_match');
  });

  it('skips transactions that already have a receipt', () => {
    const matched = { ...starbucks, receiptId: 'rcpt-1' };
    const result = matchReceipt(receipt({ merchant: 'Starbucks', total: mxn(95), date: '2026-10-13' }), [matched]);
    expect(result.outcome).toBe('no_match');
  });

  it('considers all transactions when the date could not be read', () => {
    const result = matchReceipt(receipt({ merchant: 'Starbucks', total: mxn(95) }), week);
    expect(result.outcome).toBe('suggested');
    expect(result.candidates[0]?.signals.date).toBeUndefined();
  });
});

describe('outcome', () => {
  it('needs review when two candidates are indistinguishable', () => {
    const twin = { ...oxxo, id: 'tx-oxxo-2', authorizedAt: '2026-10-16T03:45:00Z' };
    const result = matchReceipt(receipt({ merchant: 'OXXO', total: mxn(320), date: '2026-10-15' }), [oxxo, twin]);
    expect(result.outcome).toBe('needs_review');
    expect(result.explanation).toMatch(/too close/);
    expect(result.candidates).toHaveLength(2);
  });

  it('needs review when the total was read with low confidence', () => {
    const result = matchReceipt(
      receipt({ merchant: 'Starbucks', total: mxn(95), date: '2026-10-13', totalConfidence: 60 }),
      week,
    );
    expect(result.outcome).toBe('needs_review');
    expect(result.lowConfidenceFields).toContain('amount');
  });

  it('does not count an inferred date as evidence', () => {
    const result = matchReceipt(
      receipt({ merchant: 'Starbucks', total: mxn(95), date: '2026-10-13', resolution: 'inferred_from_transactions' }),
      week,
    );
    const date = result.candidates[0]?.signals.date;
    expect(date?.weight).toBe(0);
    expect(date?.reason).toMatch(/inferred, not counted/);
  });

  it('returns no_match when the total is missing', () => {
    const result = matchReceipt(receipt({ merchant: 'Starbucks', date: '2026-10-13' }), week);
    expect(result.outcome).toBe('no_match');
    expect(result.explanation).toMatch(/total could not be read/);
  });
});
