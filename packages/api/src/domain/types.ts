/** Integer minor units + ISO 4217 code. 145000 MXN = $1,450.00. Never a float. */
export type Money = { amountMinor: number; currency: string };

/** A value read from a receipt, with the extractor's confidence (0..100). */
export type ExtractedField<T> = { value: T | null; confidence: number };

/** A receipt date as printed. Ambiguous when it could be dd/mm or mm/dd (e.g. 03/04/2026). */
export type ParsedDate =
  | { kind: 'exact'; date: string }
  | { kind: 'ambiguous'; options: [ddmm: string, mmdd: string] };

export type DateResolution = 'printed' | 'inferred_from_transactions' | 'inferred_from_locale';

/** A receipt date after ambiguity has been resolved. `date` is an ISO date (yyyy-MM-dd). */
export type ResolvedDate = { date: string; resolution: DateResolution; confidence: number };

export type LineItem = { description: string; amount: Money | null; confidence: number };

export type ExtractedReceipt = {
  merchantName: ExtractedField<string>;
  address: ExtractedField<string>;
  city: ExtractedField<string>;
  date: ExtractedField<ParsedDate>;
  /** Local time printed on the receipt, "HH:mm". */
  time: ExtractedField<string>;
  subtotal: ExtractedField<Money>;
  tax: ExtractedField<Money>;
  tip: ExtractedField<Money>;
  total: ExtractedField<Money>;
  lineItems: LineItem[];
  /**
   * True when the receipt printed only "$" with no currency code. "$" is the symbol of several
   * currencies (ARS, USD, MXN, COP...), so the amounts were read in the company currency and the
   * matcher may re-read them in the currency of the card transaction.
   */
  currencyAmbiguous?: boolean;
};

/** How the receipt's currency was decided. */
export type CurrencyResolution = {
  code: string;
  /** The currency the amounts were first read in. */
  readAs: string;
  resolution: 'printed' | 'company_default' | 'inferred_from_transaction';
};

/** A card transaction as recorded by the card network. This is the trusted anchor. */
export type Transaction = {
  id: string;
  employeeId: string;
  /** ISO timestamp in UTC. */
  authorizedAt: string;
  merchantDescriptor: string;
  mcc: string;
  merchantCity: string;
  merchantCountry: string;
  /** IANA time zone of the merchant, e.g. America/Mexico_City. */
  merchantTimezone: string;
  cardPresent: boolean;
  /** Amount in the card's currency. */
  amount: Money;
  /** Amount in the purchase currency, for foreign transactions. */
  originalAmount: Money | null;
  receiptId: string | null;
};
