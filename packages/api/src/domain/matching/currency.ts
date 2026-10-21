import { inCurrency } from '../money';
import type { CurrencyResolution, ExtractedField, ExtractedReceipt, Money, Transaction } from '../types';
import { defaultMatcherConfig, type MatcherConfig } from './config';
import { scoreAmount } from './match';

function field(f: ExtractedField<Money>, currency: string): ExtractedField<Money> {
  return f.value ? { ...f, value: inCurrency(f.value, currency) } : f;
}

/** Every amount on the receipt, re-read in another currency. */
export function inReceiptCurrency(extraction: ExtractedReceipt, currency: string): ExtractedReceipt {
  return {
    ...extraction,
    subtotal: field(extraction.subtotal, currency),
    tax: field(extraction.tax, currency),
    tip: field(extraction.tip, currency),
    total: field(extraction.total, currency),
    lineItems: extraction.lineItems.map((li) => ({ ...li, amount: li.amount && inCurrency(li.amount, currency) })),
  };
}

/**
 * Decides the receipt's currency once its anchor transaction is known. A receipt that printed a
 * currency code keeps it. One that printed only "$" takes the anchor's dollar-sign currency when
 * that is the reading in which the amounts match, and the company currency otherwise.
 * Idempotent: always starts from the currency the amounts were first read in, so choosing a
 * different transaction later re-decides from scratch.
 */
export function settleCurrency(
  extraction: ExtractedReceipt,
  readAs: string,
  anchor: Transaction | null,
  config: MatcherConfig = defaultMatcherConfig,
): { extraction: ExtractedReceipt; currency: CurrencyResolution } {
  const base = inReceiptCurrency(extraction, readAs);
  const ambiguous = !!extraction.currencyAmbiguous;
  const total = base.total.value;
  if (ambiguous && anchor && total) {
    const matched = scoreAmount(total, base.tip.value, anchor, config, true);
    if (matched && matched.currency !== readAs) {
      return {
        extraction: inReceiptCurrency(base, matched.currency),
        currency: { code: matched.currency, readAs, resolution: 'inferred_from_transaction' },
      };
    }
  }
  return { extraction: base, currency: { code: readAs, readAs, resolution: ambiguous ? 'company_default' : 'printed' } };
}
