import type { MatchResult } from '../matching/match';
import type { CurrencyResolution, ExtractedReceipt, ResolvedDate, Transaction } from '../types';
import { contentKey } from '../verification/fingerprint';
import type { ImageFeatures, ReceiptKind, RelatedReceipt, RiskAssessment, RiskLevel, Signal } from '../verification/types';

export type Employee = { id: string; name: string; department: string };

/** `processing` is held by one run of POST /process at a time (a conditional write claims it). */
export type ReceiptStatus = 'uploading' | 'processing' | 'pending_review' | 'approved' | 'rejected';
export type ExtractionStatus = 'pending' | 'succeeded' | 'failed';

export type Receipt = {
  id: string;
  employeeId: string;
  kind: ReceiptKind;
  mimeType: string;
  uploadedAt: string;
  status: ReceiptStatus;
  extractionStatus: ExtractionStatus;
  extraction: ExtractedReceipt | null;
  image: ImageFeatures | null;
  date: ResolvedDate | null;
  match: MatchResult | null;
  /** The transaction the receipt was verified against: the suggestion, or the user's pick. */
  anchorTransactionId: string | null;
  /** The receipt's currency and how it was decided (printed code, company default, or inferred from the anchor). */
  currency: CurrencyResolution | null;
  signals: Signal[];
  risk: RiskAssessment | null;
};

export type DecisionType = 'approved' | 'rejected';

export type Decision = {
  receiptId: string;
  transactionId: string | null;
  decision: DecisionType;
  riskLevelAtDecision: RiskLevel | null;
  note: string | null;
  decidedAt: string;
};

export type TransactionReceiptStatus = 'missing' | 'pending_review' | 'approved';

/** A transaction as shown in the list: with the state of its receipt. */
export type TransactionView = Transaction & {
  receiptStatus: TransactionReceiptStatus;
  riskLevel: RiskLevel | null;
  /** The approved receipt, or the pending receipt anchored to this transaction. */
  linkedReceiptId: string | null;
};

/** The fields duplicate detection needs from another receipt. */
export function toRelatedReceipt(receipt: Receipt, employeeName: string): RelatedReceipt {
  return {
    id: receipt.id,
    employeeId: receipt.employeeId,
    employeeName,
    kind: receipt.kind,
    uploadedAt: receipt.uploadedAt,
    sha256: receipt.image?.sha256 ?? '',
    dhash: receipt.image?.dhash ?? null,
    contentKey: receipt.extraction
      ? contentKey(receipt.extraction.merchantName.value, receipt.date?.date ?? null, receipt.extraction.total.value)
      : null,
    total: receipt.extraction?.total.value ?? null,
  };
}
