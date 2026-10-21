import { TZDate } from '@date-fns/tz';
import { daysBetween, localDate, localTime } from '../../dates';
import { scoreAmount } from '../../matching/match';
import { formatMoney } from '../../money';
import type { Transaction } from '../../types';
import { classifyReceipt } from '../classify';
import { compareCities, metroOf, metrosInText } from '../cities';
import { isLodgingMcc, mccInfo } from '../mcc';
import type { Check, VerificationInput } from '../types';

/** Anchor checks only apply to card receipts verified against a transaction. */
function anchorOf(input: VerificationInput): Transaction | null {
  return input.kind === 'card' ? input.anchor : null;
}

function mccLabel(tx: Transaction): string {
  const info = mccInfo(tx.mcc);
  return info ? `MCC ${tx.mcc} (${info.label})` : `MCC ${tx.mcc}`;
}

export const categoryCheck: Check = (input, config) => {
  const tx = anchorOf(input);
  const info = tx && mccInfo(tx.mcc);
  if (!tx || !info) return [];

  const { categories, classifiedShare, items } = classifyReceipt(
    input.extraction.lineItems,
    config.classification.minCategoryShare,
  );
  if (categories.length === 0 || classifiedShare < config.classification.minClassifiedShare) return [];
  if (categories.some((c) => info.expects.includes(c))) return [];

  const classified = items.filter((i) => i.category);
  return [
    {
      code: 'CATEGORY_MISMATCH',
      severity: 'strong',
      title: "Receipt content doesn't match the merchant type",
      explanation:
        `Card network: ${mccLabel(tx)}, which sells ${info.expects.join(' or ')}. ` +
        `Receipt items: ${categories.join(', ')} (${classified.length} of ${items.length} items classified).`,
      evidence: { mcc: tx.mcc, expected: info.expects, found: categories, items },
    },
  ];
};

function formatDuration(minutes: number): string {
  const m = Math.round(Math.abs(minutes));
  const h = Math.floor(m / 60);
  if (h === 0) return `${m} min`;
  return m % 60 === 0 ? `${h} h` : `${h} h ${m % 60} min`;
}

export const timeCheck: Check = (input, config) => {
  const tx = anchorOf(input);
  const printedTime = input.extraction.time.value;
  if (!tx || !printedTime || !tx.cardPresent || isLodgingMcc(tx.mcc)) return [];

  // Without a receipt date, assume the receipt was printed on the day of the charge.
  const date = input.date?.date ?? localDate(tx.authorizedAt, tx.merchantTimezone);
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = printedTime.split(':').map(Number) as [number, number];
  const printedAt = new TZDate(y, mo - 1, d, hh, mm, tx.merchantTimezone).getTime();
  const minutesAfterPrint = (Date.parse(tx.authorizedAt) - printedAt) / 60_000;

  const { allowedBeforeReceiptMinutes, allowedAfterReceiptMinutes, strongExcessMinutes } = config.time;
  const excess =
    minutesAfterPrint < -allowedBeforeReceiptMinutes
      ? -allowedBeforeReceiptMinutes - minutesAfterPrint
      : minutesAfterPrint - allowedAfterReceiptMinutes;
  if (excess <= 0) return [];

  const chargedAt = localTime(tx.authorizedAt, tx.merchantTimezone);
  const relation =
    minutesAfterPrint >= 0
      ? `${formatDuration(minutesAfterPrint)} after the receipt was printed`
      : `${formatDuration(minutesAfterPrint)} before the receipt was printed`;
  return [
    {
      code: 'TIME_MISMATCH',
      severity: excess > strongExcessMinutes ? 'strong' : 'moderate',
      title: "Receipt time doesn't match the card authorization",
      explanation:
        `Receipt printed at ${printedTime}; card authorized at ${chargedAt} (${tx.merchantTimezone}), ${relation}. ` +
        `A bill is normally paid within ${formatDuration(allowedAfterReceiptMinutes)} of being printed.`,
      evidence: { printedTime, chargedAt, minutesAfterPrint: Math.round(minutesAfterPrint) },
    },
  ];
};

export const cityCheck: Check = (input) => {
  const tx = anchorOf(input);
  if (!tx || !tx.cardPresent) return [];

  const city = input.extraction.city.value;
  const address = input.extraction.address.value;
  let comparison = city ? compareCities(city, tx.merchantCity) : 'unknown';

  // The city field is often missing or a neighbourhood; look for known cities in the address.
  if (comparison === 'unknown' && address) {
    const anchorMetro = metroOf(tx.merchantCity);
    const mentioned = metrosInText(address);
    if (anchorMetro && mentioned.includes(anchorMetro)) comparison = 'same';
    else if (anchorMetro && mentioned.length > 0) comparison = 'different';
  }
  if (comparison !== 'different') return [];

  const printed = [address, city].filter(Boolean).join(' / ');
  return [
    {
      code: 'CITY_MISMATCH',
      severity: 'strong',
      title: 'Receipt is from a different city than the card charge',
      explanation: `Receipt address: "${printed}". Card network merchant city: ${tx.merchantCity}. The card was present at the terminal.`,
      evidence: { receiptCity: city, receiptAddress: address, merchantCity: tx.merchantCity },
    },
  ];
};

export const dateCheck: Check = (input, config) => {
  const tx = anchorOf(input);
  // An inferred date was chosen to fit the transactions; it can't be used as evidence.
  if (!tx || !input.date || input.date.resolution !== 'printed' || isLodgingMcc(tx.mcc)) return [];

  const chargeDate = localDate(tx.authorizedAt, tx.merchantTimezone);
  const daysAfterCharge = daysBetween(chargeDate, input.date.date);
  if (daysAfterCharge <= config.maxReceiptDaysAfterCharge) return [];
  return [
    {
      code: 'DATE_MISMATCH',
      severity: 'moderate',
      title: 'Receipt is dated after the card charge',
      explanation: `Receipt dated ${input.date.date}, but the card was charged on ${chargeDate}. A receipt can't be issued ${daysAfterCharge} days after the payment.`,
      evidence: { receiptDate: input.date.date, chargeDate, daysAfterCharge },
    },
  ];
};

export const amountCheck: Check = (input, config) => {
  const tx = anchorOf(input);
  const total = input.extraction.total.value;
  if (!tx || !total) return [];

  const scored = scoreAmount(total, input.extraction.tip.value, tx, undefined, input.extraction.currencyAmbiguous);
  const charged = formatMoney(tx.originalAmount && tx.originalAmount.currency === total.currency ? tx.originalAmount : tx.amount);
  if (!scored) {
    return [
      {
        code: 'AMOUNT_MISMATCH',
        severity: 'strong',
        title: "Receipt total doesn't explain the charge",
        explanation: `Receipt total ${formatMoney(total)}; card charge ${charged}. The difference can't be explained by a tip or rounding.`,
        evidence: { receiptTotal: total, charge: tx.amount, originalCharge: tx.originalAmount },
      },
    ];
  }
  if (scored.score >= config.amountUnexplainedBelowScore) return [];
  return [
    {
      code: 'AMOUNT_UNEXPLAINED',
      severity: 'weak',
      title: 'Large difference between receipt and charge',
      explanation: `${scored.reason}: receipt ${formatMoney(total)}, charge ${charged}. Plausible, but on the high side.`,
      evidence: { receiptTotal: total, charge: tx.amount, amountScore: scored.score },
    },
  ];
};

export const anchorChecks: Check[] = [categoryCheck, timeCheck, cityCheck, dateCheck, amountCheck];
