import { z } from 'zod';
import { ACCEPTED_MIME_TYPES, type Category, type Decision, type Employee, type Receipt, type Transaction, type TransactionView } from '../domain';

/**
 * The HTTP contract of the API: request schemas (Zod, validated at runtime by the Lambdas),
 * response shapes and error codes. Responses carry domain objects as JSON, plus display data the
 * API computes so clients don't need any domain logic.
 */

// ---------- Requests ----------

export const idParams = z.object({ id: z.string().min(1) });

export const listTransactionsQuery = z.object({
  filter: z.enum(['all', 'attention']).default('all'),
});

export const createReceiptBody = z.object({
  employeeId: z.string().min(1),
  kind: z.enum(['card', 'reimbursement']),
  mimeType: z.enum(ACCEPTED_MIME_TYPES),
  size: z.number().int().positive(),
});

export const setAnchorBody = z.object({
  transactionId: z.string().min(1),
});

export const decisionBody = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().max(1000).optional(),
});

export type ListTransactionsQuery = z.infer<typeof listTransactionsQuery>;
export type CreateReceiptBody = z.infer<typeof createReceiptBody>;
export type SetAnchorBody = z.infer<typeof setAnchorBody>;
export type DecisionBody = z.infer<typeof decisionBody>;

// ---------- Responses ----------

export type ListEmployeesResponse = { employees: Employee[] };

/** A transaction in the list, with the label of its merchant category (MCC). */
export type TransactionListItem = TransactionView & { merchantType: string | null };

export type ListTransactionsResponse = { transactions: TransactionListItem[] };

export type ListReceiptsResponse = { receipts: Receipt[] };

export type CreateReceiptResponse = {
  receipt: Receipt;
  /** Presigned S3 PUT URL. Upload the file with exactly these headers. */
  upload: { url: string; headers: Record<string, string>; expiresInSeconds: number };
};

export type ReceiptResponse = {
  receipt: Receipt;
  anchor: Transaction | null;
  decisions: Decision[];
  employee: Employee | null;
  /** Presigned GET URL for the receipt image, or null while it is still uploading. */
  imageUrl: string | null;
  /** Unmatched transactions of the employee, for choosing the anchor manually. */
  assignable: Transaction[];
  insights: ReceiptInsights;
};

/** What the verification saw, so a client can show it without running any domain logic. */
export type ReceiptInsights = {
  /** Category of each extracted line item, in order (null when no keyword matched). */
  lineItemCategories: (Category | null)[];
  /** Categories that make up the receipt. */
  receiptCategories: Category[];
  /** What the anchor's merchant category sells, when its MCC is known. */
  anchorMerchantType: { mcc: string; label: string; expects: Category[] } | null;
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

export type ErrorResponse = {
  error: { code: ErrorCode; message: string; details?: unknown };
};
