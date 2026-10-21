import { addDaysToIsoDate, daysBetween, localDate } from '../dates';
import { DOLLAR_SIGN_CURRENCIES, formatMoney, inCurrency } from '../money';
import { merchantSimilarity } from '../text';
import type { ExtractedField, Money, ResolvedDate, Transaction } from '../types';
import { defaultMatcherConfig, type MatcherConfig } from './config';

export type MatchInput = {
  merchantName: ExtractedField<string>;
  total: ExtractedField<Money>;
  tip: ExtractedField<Money>;
  date: ResolvedDate | null;
  /** The receipt printed only "$": its amounts may be in any dollar-sign currency. */
  currencyAmbiguous?: boolean;
};

export type SignalName = 'amount' | 'date' | 'merchant';

export type SignalScore = {
  score: number;
  /** Weight actually applied; 0 when the signal was skipped. */
  weight: number;
  reason: string;
};

export type ScoredCandidate = {
  transactionId: string;
  score: number;
  /** The currency the receipt amount matched in (differs from the receipt's when it was inferred). */
  currency: string;
  signals: Partial<Record<SignalName, SignalScore>>;
};

export type MatchOutcome = 'suggested' | 'needs_review' | 'no_match';

export type MatchResult = {
  outcome: MatchOutcome;
  /** Best first, at most `maxCandidates`. For `suggested`, the first one is the suggestion. */
  candidates: ScoredCandidate[];
  /** Extracted fields whose low confidence reduced their weight. */
  lowConfidenceFields: SignalName[];
  /** Why the outcome isn't `suggested`, when it isn't. */
  explanation: string;
};

/** Date range (inclusive, ISO dates) in which to look for candidate transactions. */
export function candidateWindow(
  receiptDate: string,
  config: MatcherConfig = defaultMatcherConfig,
): { from: string; to: string } {
  return {
    from: addDaysToIsoDate(receiptDate, -config.window.daysBefore),
    to: addDaysToIsoDate(receiptDate, config.window.daysAfter),
  };
}

function pct(ratio: number): string {
  return `${Math.round((ratio - 1) * 100)}%`;
}

type AmountScore = { score: number; reason: string; currency: string };

function scoreInCurrency(total: Money, tip: Money | null, tx: Transaction, config: MatcherConfig): AmountScore | null {
  const comparable =
    tx.originalAmount && tx.originalAmount.currency === total.currency
      ? tx.originalAmount
      : tx.amount.currency === total.currency
        ? tx.amount
        : null;
  if (!comparable || total.amountMinor <= 0) return null;

  const inOriginal = comparable === tx.originalAmount ? ` in original currency (${total.currency})` : '';
  const { exactTolerance, normalTipRatio, tipScore, maxTipRatio, tipScoreAtMax } = config.amount;
  const ratio = comparable.amountMinor / total.amountMinor;
  const currency = total.currency;

  if (Math.abs(ratio - 1) <= exactTolerance) {
    return { score: 1, reason: `Exact amount${inOriginal}`, currency };
  }
  if (tip && tip.currency === total.currency) {
    const withTip = total.amountMinor + tip.amountMinor;
    if (Math.abs(comparable.amountMinor / withTip - 1) <= exactTolerance) {
      return { score: 1, reason: `Receipt total plus printed tip (${formatMoney(tip)})`, currency };
    }
  }
  if (ratio > 1 && ratio <= normalTipRatio) {
    return { score: tipScore, reason: `Charge is ${pct(ratio)} above the receipt, consistent with a tip`, currency };
  }
  if (ratio > normalTipRatio && ratio <= maxTipRatio) {
    const progress = (ratio - normalTipRatio) / (maxTipRatio - normalTipRatio);
    const score = tipScore - progress * (tipScore - tipScoreAtMax);
    return { score, reason: `Charge is ${pct(ratio)} above the receipt, a larger tip than usual`, currency };
  }
  return null;
}

/**
 * Amount is a hard gate: returns null when the charge can't be explained by the receipt
 * (different currency, lower amount, or more than a plausible tip above it).
 *
 * When the receipt printed only "$" (`currencyAmbiguous`), its amounts are also tried in the
 * transaction's dollar-sign currencies: "$49.99" on a US invoice is USD 49.99, not ARS 49.99.
 * The card network's currency resolves the ambiguity, like the transaction dates resolve
 * ambiguous dates.
 */
export function scoreAmount(
  total: Money,
  tip: Money | null,
  tx: Transaction,
  config: MatcherConfig = defaultMatcherConfig,
  currencyAmbiguous = false,
): AmountScore | null {
  const asRead = scoreInCurrency(total, tip, tx, config);
  if (!currencyAmbiguous) return asRead;

  const alternatives = [tx.originalAmount?.currency, tx.amount.currency].filter(
    (c): c is string => !!c && c !== total.currency && DOLLAR_SIGN_CURRENCIES.includes(c),
  );
  const reread = [...new Set(alternatives)]
    .map((c) => scoreInCurrency(inCurrency(total, c), tip && inCurrency(tip, c), tx, config))
    .filter((s): s is AmountScore => s !== null)
    .map((s) => ({ ...s, reason: `${s.reason}; the receipt shows only "$", read as ${s.currency}` }));

  return [asRead, ...reread]
    .filter((s): s is AmountScore => s !== null)
    .sort((a, b) => b.score - a.score)[0] ?? null;
}

export function scoreDate(
  receiptDate: string,
  tx: Transaction,
  config: MatcherConfig = defaultMatcherConfig,
): { score: number; reason: string } {
  const chargeDate = localDate(tx.authorizedAt, tx.merchantTimezone);
  const days = daysBetween(receiptDate, chargeDate);
  const score = config.dateScores[Math.abs(days)] ?? 0;
  const reason =
    days === 0
      ? 'Same day'
      : days > 0
        ? `Charged ${days} day${days === 1 ? '' : 's'} after the receipt date`
        : `Charged ${-days} day${days === -1 ? '' : 's'} before the receipt date`;
  return { score, reason };
}

export function scoreMerchant(receiptName: string, tx: Transaction): { score: number; reason: string } {
  const { score, receiptTokens, descriptorTokens } = merchantSimilarity(receiptName, tx.merchantDescriptor);
  return {
    score,
    reason: `Merchant similarity ${score.toFixed(2)} ("${receiptTokens.join(' ')}" vs "${descriptorTokens.join(' ')}")`,
  };
}

function weightFor(
  base: number,
  confidence: number,
  config: MatcherConfig,
): { weight: number; lowConfidence: boolean } {
  const lowConfidence = confidence < config.lowConfidenceThreshold;
  return { weight: lowConfidence ? base * config.lowConfidenceWeightFactor : base, lowConfidence };
}

/**
 * Scores each candidate transaction against the receipt and decides the outcome.
 * Pure: the caller loads the candidates (unmatched transactions of the submitting employee).
 */
export function matchReceipt(
  input: MatchInput,
  transactions: Transaction[],
  config: MatcherConfig = defaultMatcherConfig,
): MatchResult {
  const total = input.total.value;
  if (!total) {
    return {
      outcome: 'no_match',
      candidates: [],
      lowConfidenceFields: [],
      explanation: 'The receipt total could not be read, so no transaction can be matched automatically.',
    };
  }

  const amountW = weightFor(config.weights.amount, input.total.confidence, config);
  const merchantName = input.merchantName.value;
  const merchantW = merchantName
    ? weightFor(config.weights.merchant, input.merchantName.confidence, config)
    : { weight: 0, lowConfidence: false };
  // An inferred date was chosen because it fits the transactions, so it can't count as evidence.
  const usableDate = input.date && input.date.resolution === 'printed' ? input.date : null;
  const dateW = usableDate
    ? weightFor(config.weights.date, usableDate.confidence, config)
    : { weight: 0, lowConfidence: false };

  const lowConfidenceFields: SignalName[] = [];
  if (amountW.lowConfidence) lowConfidenceFields.push('amount');
  if (merchantW.lowConfidence) lowConfidenceFields.push('merchant');
  if (dateW.lowConfidence) lowConfidenceFields.push('date');

  const window = input.date ? candidateWindow(input.date.date, config) : null;
  const scored: ScoredCandidate[] = [];

  for (const tx of transactions) {
    if (tx.receiptId) continue;
    if (window) {
      const chargeDate = localDate(tx.authorizedAt, tx.merchantTimezone);
      if (chargeDate < window.from || chargeDate > window.to) continue;
    }
    const amount = scoreAmount(total, input.tip.value, tx, config, input.currencyAmbiguous);
    if (!amount) continue;

    const signals: ScoredCandidate['signals'] = {
      amount: { score: amount.score, reason: amount.reason, weight: amountW.weight },
    };
    if (merchantName) signals.merchant = { ...scoreMerchant(merchantName, tx), weight: merchantW.weight };
    if (input.date) {
      const date = scoreDate(input.date.date, tx, config);
      signals.date = usableDate
        ? { ...date, weight: dateW.weight }
        : { ...date, weight: 0, reason: `${date.reason} (date was inferred, not counted)` };
    }

    const parts = Object.values(signals);
    const totalWeight = parts.reduce((sum, s) => sum + s.weight, 0);
    const score = parts.reduce((sum, s) => sum + s.score * s.weight, 0) / totalWeight;
    scored.push({ transactionId: tx.id, score, currency: amount.currency, signals });
  }

  scored.sort((a, b) => b.score - a.score);
  const candidates = scored.slice(0, config.maxCandidates);
  const best = candidates[0];
  if (!best) {
    return {
      outcome: 'no_match',
      candidates: [],
      lowConfidenceFields,
      explanation: 'No unmatched transaction has an amount that this receipt can explain.',
    };
  }

  const margin = best.score - (candidates[1]?.score ?? 0);
  const { minScore, minMargin } = config.suggest;
  const reasons: string[] = [];
  if (best.score < minScore) reasons.push(`best score ${best.score.toFixed(2)} is below ${minScore}`);
  if (margin < minMargin) reasons.push(`the top two candidates are too close (margin ${margin.toFixed(2)})`);
  if (amountW.lowConfidence) reasons.push('the total was read with low confidence');

  return reasons.length === 0
    ? { outcome: 'suggested', candidates, lowConfidenceFields, explanation: 'One clear match.' }
    : {
        outcome: 'needs_review',
        candidates,
        lowConfidenceFields,
        explanation: `Needs review: ${reasons.join('; ')}.`,
      };
}
