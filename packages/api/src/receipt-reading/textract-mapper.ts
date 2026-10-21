import type { AnalyzeExpenseCommandOutput, Block, ExpenseField } from '@aws-sdk/client-textract';
import {
  metroOf,
  parseAmount,
  parseReceiptDate,
  parseReceiptTime,
  type ExtractedField,
  type ExtractedReceipt,
  type LineItem,
  type Money,
} from '../domain';

type Raw = Pick<AnalyzeExpenseCommandOutput, 'ExpenseDocuments'>;

const missing = <T>(): ExtractedField<T> => ({ value: null, confidence: 0 });

/** The field of the given types with the highest value confidence. */
function best(fields: ExpenseField[], types: string[]): ExpenseField | undefined {
  return fields
    .filter((f) => types.includes(f.Type?.Text ?? '') && f.ValueDetection?.Text?.trim())
    .sort((a, b) => (b.ValueDetection?.Confidence ?? 0) - (a.ValueDetection?.Confidence ?? 0))[0];
}

function text(field: ExpenseField | undefined): ExtractedField<string> {
  const value = field?.ValueDetection?.Text?.replace(/\s+/g, ' ').trim();
  return value ? { value, confidence: field!.ValueDetection?.Confidence ?? 0 } : missing();
}

function amount(field: ExpenseField | undefined, currency: string): ExtractedField<Money> {
  const raw = field?.ValueDetection?.Text;
  if (!raw) return missing();
  const value = parseAmount(raw, currency);
  return value ? { value, confidence: field?.ValueDetection?.Confidence ?? 0 } : missing();
}

const ISO_CODES = ['MXN', 'USD', 'COP', 'BRL', 'EUR', 'CAD', 'CLP', 'PEN', 'ARS', 'GBP'];

/** Dollar notations that are unambiguous, as printed in Argentina and elsewhere. */
const USD_NOTATIONS = /U\$S|US\$|U\$D|\bUSD\b/i;

/**
 * The receipt's currency, and whether it is ambiguous. Textract reports USD for any "$", even on
 * a ticket printing "TOTAL ARS", and "$" means pesos in Argentina (and Mexico, Colombia, Chile...).
 * So: a currency code or an unambiguous dollar notation ("U$S", "US$") printed on the document wins,
 * preferring the TOTAL line when there are several; a bare "$" is ambiguous and is read in the
 * company currency, leaving the matcher to re-read it in the card transaction's currency;
 * Textract's code is trusted only for unambiguous symbols (€, £, R$...).
 */
export function resolveCurrency(
  lines: string[],
  textractCode: string | undefined,
  defaultCurrency: string,
): { code: string; ambiguous: boolean } {
  const codesIn = (text: string) => [
    ...ISO_CODES.filter((c) => c !== 'USD' && new RegExp(`\\b${c}\\b`).test(text.toUpperCase())),
    ...(USD_NOTATIONS.test(text) ? ['USD'] : []),
  ];
  const printed = [...new Set(lines.flatMap(codesIn))];
  if (printed.length === 1) return { code: printed[0]!, ambiguous: false };
  if (printed.length > 1) {
    const onTotal = lines.filter((l) => /\btotal\b/i.test(l)).flatMap(codesIn); // not "Subtotal"
    return onTotal[0] ? { code: onTotal[0], ambiguous: false } : { code: defaultCurrency, ambiguous: true };
  }
  const code = textractCode?.toUpperCase();
  return !code || code === 'USD' ? { code: defaultCurrency, ambiguous: true } : { code, ambiguous: false };
}

/** Textract sometimes folds the price into the item text ("Sandwich 235.00"). Drop a trailing amount. */
function cleanDescription(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[\s:-]*\$?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}\s*[-–]*\s*$/, '')
    .trim();
}

/** Confidence given to values recovered from raw lines: below the 80 threshold, so they weigh less. */
const FROM_LINES_CONFIDENCE = 75;

type Place = { merchant: ExtractedField<string>; address: ExtractedField<string>; city: ExtractedField<string> };

/**
 * Textract's expense model misses vendor and address on many Latin American tickets ("CABA" is
 * not recognised as a city; sometimes not even the vendor name), although its OCR reads every
 * line correctly. Recover them from the printed lines:
 * - city: a line naming a known city, when Textract's CITY is missing or not a known city;
 * - address: the line just above that city line;
 * - merchant: the first line of the ticket, with reduced confidence.
 */
function placeFromLines(blocks: Block[], fromFields: Place): Place {
  const lines = blocks.filter((b) => b.BlockType === 'LINE' && b.Text?.trim());
  const cityIndex = lines.findIndex((b) => metroOf(b.Text!) !== null);
  const cityLine = lines[cityIndex];
  const fieldCityKnown = fromFields.city.value !== null && metroOf(fromFields.city.value) !== null;

  const fromLine = (b: Block | undefined): ExtractedField<string> =>
    b?.Text ? { value: b.Text.trim(), confidence: Math.min(b.Confidence ?? 0, FROM_LINES_CONFIDENCE) } : missing();

  const addressLine = cityIndex > 1 ? lines[cityIndex - 1] : undefined;
  return {
    merchant: fromFields.merchant.value ? fromFields.merchant : fromLine(lines[0]),
    city: fieldCityKnown || !cityLine ? fromFields.city : fromLine(cityLine),
    address: fromFields.address.value ? fromFields.address : fromLine(addressLine),
  };
}

/**
 * Maps a Textract AnalyzeExpense response to the domain's ExtractedReceipt. Pure, so the same
 * code runs on live responses and on recorded fixtures.
 */
export function mapAnalyzeExpense(raw: Raw, defaultCurrency: string): ExtractedReceipt {
  const doc = raw.ExpenseDocuments?.[0];
  const fields = doc?.SummaryFields ?? [];

  const lines = (doc?.Blocks ?? []).filter((b) => b.BlockType === 'LINE').map((b) => b.Text ?? '');
  const totalField = best(fields, ['TOTAL']) ?? best(fields, ['AMOUNT_PAID']);
  const { code: currency, ambiguous } = resolveCurrency(lines, totalField?.Currency?.Code, defaultCurrency);
  const total = amount(totalField, currency);

  const dateField = best(fields, ['INVOICE_RECEIPT_DATE']);
  const dateText = dateField?.ValueDetection?.Text ?? '';
  const parsedDate = dateText ? parseReceiptDate(dateText) : null;

  // Textract has no time field: look in the date text first, then in the printed lines, preferring
  // a line that also holds the date (store hours like "9:00 - 22:00" are the usual false positive).
  const timeInDate = dateText ? parseReceiptTime(dateText) : null;
  const lineTimes = (doc?.Blocks ?? [])
    .filter((b) => b.BlockType === 'LINE' && b.Text)
    .map((b) => ({ time: parseReceiptTime(b.Text!), withDate: parseReceiptDate(b.Text!) !== null, confidence: b.Confidence ?? 0 }))
    .filter((l): l is { time: string; withDate: boolean; confidence: number } => l.time !== null);
  const timeLine = lineTimes.find((l) => l.withDate) ?? lineTimes[0];
  const time: ExtractedField<string> = timeInDate
    ? { value: timeInDate, confidence: dateField?.ValueDetection?.Confidence ?? 0 }
    : timeLine
      ? { value: timeLine.time, confidence: timeLine.confidence }
      : missing();

  const lineItems: LineItem[] = (doc?.LineItemGroups ?? [])
    .flatMap((g) => g.LineItems ?? [])
    .map((li) => {
      const itemFields = li.LineItemExpenseFields ?? [];
      const description = best(itemFields, ['ITEM', 'EXPENSE_ROW']);
      const price = best(itemFields, ['PRICE']);
      return {
        description: cleanDescription(description?.ValueDetection?.Text ?? ''),
        amount: amount(price, currency).value,
        confidence: description?.ValueDetection?.Confidence ?? 0,
      };
    })
    .filter((li) => li.description !== '');

  const place = placeFromLines(doc?.Blocks ?? [], {
    merchant: text(best(fields, ['VENDOR_NAME', 'NAME'])),
    // ADDRESS_BLOCK is the address alone; VENDOR_ADDRESS and ADDRESS often start with the merchant name.
    address: text(best(fields, ['ADDRESS_BLOCK']) ?? best(fields, ['VENDOR_ADDRESS', 'ADDRESS'])),
    city: text(best(fields, ['CITY'])),
  });

  return {
    merchantName: place.merchant,
    address: place.address,
    city: place.city,
    date: parsedDate ? { value: parsedDate, confidence: dateField?.ValueDetection?.Confidence ?? 0 } : missing(),
    time,
    subtotal: amount(best(fields, ['SUBTOTAL']), currency),
    tax: amount(best(fields, ['TAX']), currency),
    tip: amount(best(fields, ['GRATUITY']), currency),
    total,
    lineItems,
    ...(ambiguous && { currencyAmbiguous: true }),
  };
}
