import type { MatchResult } from '../matching/match';
import type { ExtractedReceipt, Money, ResolvedDate, Transaction } from '../types';

export type Severity = 'strong' | 'moderate' | 'weak';

export type SignalCode =
  | 'CATEGORY_MISMATCH'
  | 'TIME_MISMATCH'
  | 'CITY_MISMATCH'
  | 'DATE_MISMATCH'
  | 'AMOUNT_MISMATCH'
  | 'AMOUNT_UNEXPLAINED'
  | 'DUPLICATE_EXACT'
  | 'DUPLICATE_IMAGE'
  | 'DUPLICATE_CONTENT'
  | 'DOUBLE_DIPPING'
  | 'ARITHMETIC_LINE_ITEMS'
  | 'ARITHMETIC_TOTAL'
  | 'EDITING_SOFTWARE'
  | 'NO_CAMERA_METADATA'
  | 'LOW_EXTRACTION_CONFIDENCE'
  | 'UNREADABLE_RECEIPT';

export type Signal = {
  code: SignalCode;
  severity: Severity;
  /** Short headline, e.g. "Receipt content doesn't match the merchant type". */
  title: string;
  /** Plain-language reasoning a reviewer can check. */
  explanation: string;
  evidence: Record<string, unknown>;
};

export type ReceiptKind = 'card' | 'reimbursement';

export type ImageFormat = 'jpeg' | 'png' | 'heic' | 'pdf' | 'other';

export type ImageMeta = {
  format: ImageFormat;
  make?: string;
  model?: string;
  software?: string;
};

export type ImageFeatures = {
  sha256: string;
  /** 64-bit difference hash, 16 hex chars. Null for PDFs. */
  dhash: string | null;
  meta: ImageMeta;
};

/** Another receipt that shares a fingerprint with the one being verified. */
export type RelatedReceipt = {
  id: string;
  employeeId: string;
  employeeName: string;
  kind: ReceiptKind;
  uploadedAt: string;
  sha256: string;
  dhash: string | null;
  contentKey: string | null;
  /** Extracted total, to confirm a perceptual-hash match. Null when the receipt couldn't be read. */
  total: Money | null;
};

export type VerificationInput = {
  receiptId: string;
  employeeId: string;
  kind: ReceiptKind;
  extraction: ExtractedReceipt;
  date: ResolvedDate | null;
  /** The transaction the receipt is verified against (card receipts only). */
  anchor: Transaction | null;
  match: MatchResult | null;
  image: ImageFeatures;
  related: RelatedReceipt[];
};

export type RiskLevel = 'low' | 'medium' | 'high';

export type RiskAssessment = { level: RiskLevel; reasons: string[] };

export type VerificationConfig = {
  time: {
    /** A receipt can be printed this long after the payment (minutes). */
    allowedBeforeReceiptMinutes: number;
    /** A payment can happen this long after the receipt is printed (minutes). */
    allowedAfterReceiptMinutes: number;
    /** Being outside the window by more than this is a strong signal (minutes). */
    strongExcessMinutes: number;
  };
  /** A receipt dated more than this many days after the charge is suspicious. */
  maxReceiptDaysAfterCharge: number;
  /** Amount scores below this (tips above the normal range) get a weak "unexplained difference" signal. */
  amountUnexplainedBelowScore: number;
  duplicates: { maxHammingDistance: number };
  arithmetic: { lineItemsTolerance: number };
  classification: { minCategoryShare: number; minClassifiedShare: number };
  lowConfidenceThreshold: number;
  /**
   * Per currency, in minor units: reimbursements above it move up one risk level, since there is
   * no anchor to vouch for them. Currencies missing from the table always move up.
   */
  reimbursementReviewThresholds: Record<string, number>;
};

export type Check = (input: VerificationInput, config: VerificationConfig) => Signal[];
