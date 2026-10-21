import { addDaysToIsoDate, resolveReceiptDate } from '../dates';
import { defaultMatcherConfig, type MatcherConfig } from '../matching/config';
import { settleCurrency } from '../matching/currency';
import { candidateWindow, matchReceipt, type MatchResult } from '../matching/match';
import type { ExtractedReceipt, ResolvedDate, Transaction } from '../types';
import { defaultVerificationConfig } from '../verification/config';
import { contentKey, dhashBands } from '../verification/fingerprint';
import { assessRisk } from '../verification/risk';
import type { ImageFeatures, ReceiptKind, RelatedReceipt, Signal, VerificationConfig } from '../verification/types';
import { bySeverity, verifyReceipt } from '../verification/verify';
import type { Decision, DecisionType, Receipt, TransactionView } from './entities';
import { domainError, notFound } from './errors';

/**
 * The steps of the receipt workflow. Pure functions, plus a few async steps that receive the one
 * lookup they need as a plain function argument. Handlers compose these with the I/O functions
 * their Lambda injects.
 */

export const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
/** Textract's synchronous API accepts documents up to 5 MB. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Lookups some workflow steps need. */
export type FindEmployeeTransactions = (
  employeeId: string,
  range: { fromUtc: string; toUtc: string } | null,
) => Promise<Transaction[]>;
export type FindReceiptsByFingerprints = (keys: string[]) => Promise<RelatedReceipt[]>;

type Configs = { matcher?: MatcherConfig; verification?: VerificationConfig };

const newestFirst = <T>(key: (item: T) => string) => (a: T, b: T) => key(b).localeCompare(key(a));

/** Throws NOT_FOUND when a lookup came back empty. */
export const found = <T>(value: T | null, what: string, id: string): T => {
  if (value === null) throw notFound(what, id);
  return value;
};

// ---------- Create ----------

/** A new receipt waiting for its image. Validates the upload; the caller checks the employee exists. */
export const newReceipt = (
  input: { employeeId: string; kind: ReceiptKind; mimeType: string; size: number },
  { id, now }: { id: string; now: Date },
): Receipt => {
  if (!(ACCEPTED_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    throw domainError('UNSUPPORTED_FILE_TYPE', `Accepted types: ${ACCEPTED_MIME_TYPES.join(', ')}`);
  }
  if (input.size > MAX_FILE_BYTES) throw domainError('FILE_TOO_LARGE', `Receipts must be at most ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  return {
    id,
    employeeId: input.employeeId,
    kind: input.kind,
    mimeType: input.mimeType,
    uploadedAt: now.toISOString(),
    status: 'uploading',
    extractionStatus: 'pending',
    extraction: null,
    image: null,
    date: null,
    match: null,
    anchorTransactionId: null,
    currency: null,
    signals: [],
    risk: null,
  };
};

// ---------- Process ----------

export const assertUploading = (receipt: Receipt) => {
  if (receipt.status !== 'uploading') throw domainError('INVALID_STATE', `Receipt ${receipt.id} was already processed`);
};

/**
 * The receipt claimed by one processing run, with its image features. Saved before its
 * fingerprints, so a concurrent upload that finds those fingerprints can already compare images.
 */
export const startProcessing = (receipt: Receipt, image: ImageFeatures): Receipt => {
  assertUploading(receipt);
  return { ...receipt, status: 'processing', image };
};

/**
 * UTC range covering a window of local calendar dates in any time zone (UTC-12..UTC+14).
 * The matcher filters by the merchant's local date afterwards.
 */
const utcRangeFor = (from: string, to: string) => ({
  fromUtc: `${addDaysToIsoDate(from, -1)}T00:00:00Z`,
  toUtc: `${addDaysToIsoDate(to, 1)}T23:59:59Z`,
});

/** Index keys under which a receipt can be found again: exact file, perceptual-hash bands, content. */
export const fingerprintKeys = (image: ImageFeatures, extraction: ExtractedReceipt | null, date: ResolvedDate | null): string[] => {
  const content = extraction ? contentKey(extraction.merchantName.value, date?.date ?? null, extraction.total.value) : null;
  return [`SHA#${image.sha256}`, ...(image.dhash ? dhashBands(image.dhash) : []), ...(content ? [`CONTENT#${content}`] : [])];
};

/** Resolves an ambiguous printed date using the employee's transactions around each reading. */
export const resolveDate = async (
  receipt: Receipt,
  extraction: ExtractedReceipt,
  findEmployeeTransactions: FindEmployeeTransactions,
  matcher: MatcherConfig = defaultMatcherConfig,
): Promise<ResolvedDate | null> => {
  const parsed = extraction.date.value;
  const withCandidates = new Set<string>();
  if (parsed?.kind === 'ambiguous' && receipt.kind === 'card') {
    for (const option of parsed.options) {
      const w = candidateWindow(option, matcher);
      const unmatched = (await findEmployeeTransactions(receipt.employeeId, utcRangeFor(w.from, w.to))).filter((t) => !t.receiptId);
      const asPrinted = { ...extraction, date: { date: option, resolution: 'printed' as const, confidence: 100 } };
      if (matchReceipt(asPrinted, unmatched, matcher).candidates.length > 0) withCandidates.add(option);
    }
  }
  return resolveReceiptDate(extraction.date, (d) => withCandidates.has(d), extraction.total.value?.currency ?? null);
};

/** Candidate transactions for a card receipt, the matcher's verdict, and the suggested anchor. */
export const matchCardReceipt = async (
  receipt: Receipt,
  extraction: ExtractedReceipt,
  date: ResolvedDate | null,
  findEmployeeTransactions: FindEmployeeTransactions,
  matcher: MatcherConfig = defaultMatcherConfig,
): Promise<{ match: MatchResult; anchor: Transaction | null }> => {
  const window = date ? candidateWindow(date.date, matcher) : null;
  const candidates = await findEmployeeTransactions(receipt.employeeId, window ? utcRangeFor(window.from, window.to) : null);
  const match = matchReceipt(
    {
      merchantName: extraction.merchantName,
      total: extraction.total,
      tip: extraction.tip,
      date,
      ...(extraction.currencyAmbiguous && { currencyAmbiguous: true }),
    },
    candidates,
    matcher,
  );
  const suggestedId = match.outcome === 'suggested' ? match.candidates[0]!.transactionId : null;
  return { match, anchor: candidates.find((c) => c.id === suggestedId) ?? null };
};

/** Settles the currency against the anchor, then runs every check (including duplicates). */
export const verify = async (
  receipt: Receipt,
  anchor: Transaction | null,
  findReceiptsByFingerprints: FindReceiptsByFingerprints,
  configs: Configs = {},
): Promise<Receipt> => {
  const readAs = receipt.currency?.readAs ?? receipt.extraction!.total.value?.currency ?? null;
  const settled = readAs
    ? settleCurrency(receipt.extraction!, readAs, anchor, configs.matcher ?? defaultMatcherConfig)
    : { extraction: receipt.extraction!, currency: null };
  const extraction = settled.extraction;
  const image = receipt.image!;
  const related = await findReceiptsByFingerprints(fingerprintKeys(image, extraction, receipt.date));
  const { signals, risk } = verifyReceipt(
    {
      receiptId: receipt.id,
      employeeId: receipt.employeeId,
      kind: receipt.kind,
      extraction,
      date: receipt.date,
      anchor,
      match: receipt.match,
      image,
      related: related.filter((r) => r.id !== receipt.id),
    },
    configs.verification ?? defaultVerificationConfig,
  );
  return { ...receipt, extraction, currency: settled.currency, anchorTransactionId: anchor?.id ?? null, signals, risk };
};

const missingField = { value: null, confidence: 0 };
const EMPTY_EXTRACTION: ExtractedReceipt = {
  merchantName: missingField,
  address: missingField,
  city: missingField,
  date: missingField,
  time: missingField,
  subtotal: missingField,
  tax: missingField,
  tip: missingField,
  total: missingField,
  lineItems: [],
};

const UNREADABLE: Signal = {
  code: 'UNREADABLE_RECEIPT',
  severity: 'moderate',
  title: 'Receipt could not be read',
  explanation: 'The total could not be extracted. Assign the transaction manually and check the image.',
  evidence: {},
};

/** Without a total there is nothing to match, but the image can still be a duplicate. */
export const markUnreadable = async (
  receipt: Receipt,
  extraction: ExtractedReceipt | null,
  image: ImageFeatures,
  findReceiptsByFingerprints: FindReceiptsByFingerprints,
  configs: Configs = {},
): Promise<Receipt> => {
  const imageOnly = await verify({ ...receipt, extraction: extraction ?? EMPTY_EXTRACTION, image }, null, findReceiptsByFingerprints, configs);
  const signals = [UNREADABLE, ...imageOnly.signals].sort(bySeverity);
  return {
    ...receipt,
    status: 'pending_review',
    extractionStatus: 'failed',
    extraction,
    image,
    signals,
    risk: assessRisk(signals, { kind: receipt.kind, total: null, anchored: false }, configs.verification ?? defaultVerificationConfig),
  };
};

// ---------- Anchor ----------

/** Only card receipts pending review can be tied to a transaction. */
export const assertAnchorable = (receipt: Receipt) => {
  if (receipt.status !== 'pending_review' || receipt.kind !== 'card') {
    throw domainError('INVALID_STATE', 'Only card receipts pending review can be assigned a transaction');
  }
};

/** A card receipt pending review can be tied to an unmatched transaction of the same employee. */
export const assertCanAnchor = (receipt: Receipt, tx: Transaction) => {
  assertAnchorable(receipt);
  if (tx.employeeId !== receipt.employeeId) {
    throw domainError('TRANSACTION_NOT_ELIGIBLE', "The transaction belongs to a different employee's card");
  }
  if (tx.receiptId) throw domainError('TRANSACTION_ALREADY_MATCHED', 'The transaction already has a receipt');
};

// ---------- Decide ----------

/** The decided receipt and its audit record. Approving needs an anchor (card) and a note (high risk). */
export const decideReceipt = (
  receipt: Receipt,
  input: { decision: DecisionType; note?: string | null },
  now: Date,
): { receipt: Receipt; decision: Decision } => {
  if (receipt.status !== 'pending_review') throw domainError('INVALID_STATE', `Receipt ${receipt.id} is not pending review`);
  const note = input.note?.trim() || null;
  if (input.decision === 'approved') {
    if (receipt.kind === 'card' && !receipt.anchorTransactionId) {
      throw domainError('ANCHOR_REQUIRED', 'Choose the transaction this receipt belongs to before approving');
    }
    if (receipt.risk?.level === 'high' && !note) {
      throw domainError('NOTE_REQUIRED', 'Approving a high-risk receipt requires a justification note');
    }
  }
  return {
    receipt: { ...receipt, status: input.decision },
    decision: {
      receiptId: receipt.id,
      transactionId: input.decision === 'approved' ? receipt.anchorTransactionId : null,
      decision: input.decision,
      riskLevelAtDecision: receipt.risk?.level ?? null,
      note,
      decidedAt: now.toISOString(),
    },
  };
};

// ---------- Views ----------

/** Transactions, newest first, with the state of their receipt. */
export const transactionViews = (transactions: Transaction[], receipts: Receipt[], filter: 'all' | 'attention' = 'all'): TransactionView[] => {
  const byId = new Map(receipts.map((r) => [r.id, r]));
  const pendingByAnchor = new Map(
    receipts.filter((r) => r.status === 'pending_review' && r.anchorTransactionId).map((r) => [r.anchorTransactionId!, r]),
  );
  const views = transactions
    .map((tx): TransactionView => {
      if (tx.receiptId) {
        return { ...tx, receiptStatus: 'approved', riskLevel: byId.get(tx.receiptId)?.risk?.level ?? null, linkedReceiptId: tx.receiptId };
      }
      const pending = pendingByAnchor.get(tx.id);
      return pending
        ? { ...tx, receiptStatus: 'pending_review', riskLevel: pending.risk?.level ?? null, linkedReceiptId: pending.id }
        : { ...tx, receiptStatus: 'missing', riskLevel: null, linkedReceiptId: null };
    })
    .sort(newestFirst((t) => t.authorizedAt));
  return filter === 'all' ? views : views.filter((v) => v.receiptStatus !== 'approved' || v.riskLevel === 'high' || v.riskLevel === 'medium');
};

/** Receipts newest first: the review queue, including reimbursements (which have no transaction). */
export const receiptsNewestFirst = (receipts: Receipt[]) => [...receipts].sort(newestFirst((r) => r.uploadedAt));

/** Transactions without a receipt yet, newest first: the manual-assignment choices. */
export const assignableTransactions = (transactions: Transaction[]) =>
  transactions.filter((t) => !t.receiptId).sort(newestFirst((t) => t.authorizedAt));
