/**
 * The web app's view of the ReceiptMatch API: the shapes it sends and receives. The API's source
 * of truth is packages/api/src/http/contract.ts; this file mirrors the parts the UI uses.
 */

export const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export type AcceptedMimeType = (typeof ACCEPTED_MIME_TYPES)[number];
/** Textract's synchronous limit, checked client-side before uploading. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

// ---------- Values ----------

/** Integer minor units + ISO 4217 code. */
export type Money = { amountMinor: number; currency: string };
export type ExtractedField<T> = { value: T | null; confidence: number };

export type RiskLevel = 'low' | 'medium' | 'high';
export type Severity = 'strong' | 'moderate' | 'weak';
export type ReceiptKind = 'card' | 'reimbursement';
export type ReceiptStatus = 'uploading' | 'processing' | 'pending_review' | 'approved' | 'rejected';
export type Category = 'alcohol' | 'lodging' | 'fuel' | 'transport' | 'electronics' | 'software' | 'food' | 'groceries';

// ---------- Entities ----------

export type Employee = { id: string; name: string; department: string };

export type Transaction = {
  id: string;
  employeeId: string;
  authorizedAt: string;
  merchantDescriptor: string;
  mcc: string;
  merchantCity: string;
  merchantCountry: string;
  merchantTimezone: string;
  cardPresent: boolean;
  amount: Money;
  originalAmount: Money | null;
  receiptId: string | null;
};

export type TransactionListItem = Transaction & {
  receiptStatus: 'missing' | 'pending_review' | 'approved';
  riskLevel: RiskLevel | null;
  linkedReceiptId: string | null;
  merchantType: string | null;
};

export type LineItem = { description: string; amount: Money | null; confidence: number };

export type ExtractedReceipt = {
  merchantName: ExtractedField<string>;
  address: ExtractedField<string>;
  city: ExtractedField<string>;
  date: ExtractedField<unknown>;
  time: ExtractedField<string>;
  subtotal: ExtractedField<Money>;
  tax: ExtractedField<Money>;
  tip: ExtractedField<Money>;
  total: ExtractedField<Money>;
  lineItems: LineItem[];
};

export type Signal = {
  code: string;
  severity: Severity;
  title: string;
  explanation: string;
  evidence: Record<string, unknown>;
};

export type ScoredCandidate = {
  transactionId: string;
  score: number;
  currency: string;
  signals: Partial<Record<'amount' | 'date' | 'merchant', { score: number; weight: number; reason: string }>>;
};

export type CurrencyResolution = {
  code: string;
  readAs: string;
  resolution: 'printed' | 'company_default' | 'inferred_from_transaction';
};

export type Receipt = {
  id: string;
  employeeId: string;
  kind: ReceiptKind;
  mimeType: string;
  uploadedAt: string;
  status: ReceiptStatus;
  extractionStatus: 'pending' | 'succeeded' | 'failed';
  extraction: ExtractedReceipt | null;
  date: { date: string; resolution: 'printed' | 'inferred_from_transactions' | 'inferred_from_locale'; confidence: number } | null;
  match: { outcome: 'suggested' | 'needs_review' | 'no_match'; candidates: ScoredCandidate[]; explanation: string } | null;
  anchorTransactionId: string | null;
  currency: CurrencyResolution | null;
  signals: Signal[];
  risk: { level: RiskLevel; reasons: string[] } | null;
};

export type Decision = {
  receiptId: string;
  transactionId: string | null;
  decision: 'approved' | 'rejected';
  riskLevelAtDecision: RiskLevel | null;
  note: string | null;
  decidedAt: string;
};

// ---------- Requests ----------

export type CreateReceiptBody = { employeeId: string; kind: ReceiptKind; mimeType: AcceptedMimeType; size: number };
export type DecisionBody = { decision: 'approved' | 'rejected'; note?: string };

// ---------- Responses ----------

export type ListEmployeesResponse = { employees: Employee[] };
export type ListTransactionsResponse = { transactions: TransactionListItem[] };
export type ListReceiptsResponse = { receipts: Receipt[] };

export type CreateReceiptResponse = {
  receipt: Receipt;
  upload: { url: string; headers: Record<string, string>; expiresInSeconds: number };
};

export type ReceiptResponse = {
  receipt: Receipt;
  anchor: Transaction | null;
  decisions: Decision[];
  employee: Employee | null;
  imageUrl: string | null;
  assignable: Transaction[];
  insights: {
    lineItemCategories: (Category | null)[];
    receiptCategories: Category[];
    anchorMerchantType: { mcc: string; label: string; expects: Category[] } | null;
  };
};

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'FILE_TOO_LARGE'
  | 'INVALID_STATE'
  | 'NOTE_REQUIRED'
  | 'ANCHOR_REQUIRED'
  | 'TRANSACTION_ALREADY_MATCHED'
  | 'TRANSACTION_NOT_ELIGIBLE'
  | 'EXTRACTION_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export type ErrorResponse = { error: { code: ErrorCode; message: string; details?: unknown } };
