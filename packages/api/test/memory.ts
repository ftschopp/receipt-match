import {
  domainError,
  toRelatedReceipt,
  type Decision,
  type Employee,
  type ExtractedReceipt,
  type ImageFeatures,
  type Receipt,
  type ReceiptStatus,
  type Transaction,
} from '../src/domain';

/**
 * In-memory versions of the functions the Lambdas inject (dynamo/*, s3/receipt-files, receipt-reading),
 * with the same signatures and the same rules (e.g. recordDecision is all-or-nothing, like the
 * DynamoDB TransactWrite, and transitionReceipt is a conditional write). Returns every function plus the backing maps, so tests can inspect them.
 */
const clone = <T>(value: T): T => structuredClone(value);

export const testImage = (label: string) => new TextEncoder().encode(label);
const labelOf = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

export function createMemory(seed: {
  employees?: Employee[];
  transactions?: Transaction[];
  extractions?: Record<string, ExtractedReceipt>;
  images?: Record<string, ImageFeatures>;
}) {
  const employees = new Map((seed.employees ?? []).map((e) => [e.id, clone(e)]));
  const transactions = new Map((seed.transactions ?? []).map((t) => [t.id, clone(t)]));
  const receipts = new Map<string, Receipt>();
  const decisions: Decision[] = [];
  const fingerprints = new Map<string, Set<string>>();
  const uploads = new Map<string, Uint8Array>();
  const rawExtractions = new Map<string, unknown>();
  let ids = 0;
  let extractorDown = false;
  let clock = Date.parse('2026-10-17T12:00:00Z');

  const deps = {
    // dynamo/employees
    getEmployee: async (id: string) => clone(employees.get(id) ?? null),
    listEmployees: async () => [...employees.values()].map(clone),
    // dynamo/transactions
    getTransaction: async (id: string) => clone(transactions.get(id) ?? null),
    listTransactions: async () => [...transactions.values()].map(clone),
    findEmployeeTransactions: async (employeeId: string, range: { fromUtc: string; toUtc: string } | null) =>
      [...transactions.values()]
        .filter((t) => t.employeeId === employeeId)
        .filter((t) => !range || (t.authorizedAt >= range.fromUtc && t.authorizedAt <= range.toUtc))
        .map(clone),
    // dynamo/receipts
    getReceipt: async (id: string) => clone(receipts.get(id) ?? null),
    listReceipts: async () => [...receipts.values()].map(clone),
    saveReceipt: async (receipt: Receipt) => {
      receipts.set(receipt.id, clone(receipt));
    },
    transitionReceipt: async (receipt: Receipt, from: ReceiptStatus) => {
      if (receipts.get(receipt.id)?.status !== from) throw domainError('INVALID_STATE', `Receipt ${receipt.id} is no longer ${from}`);
      receipts.set(receipt.id, clone(receipt));
    },
    getDecisions: async (receiptId: string) => decisions.filter((d) => d.receiptId === receiptId).map(clone),
    findReceiptsByFingerprints: async (keys: string[]) =>
      [...new Set(keys.flatMap((k) => [...(fingerprints.get(k) ?? [])]))].map((id) => {
        const receipt = receipts.get(id)!;
        return toRelatedReceipt(receipt, employees.get(receipt.employeeId)?.name ?? receipt.employeeId);
      }),
    saveFingerprints: async (receiptId: string, keys: string[]) => {
      for (const key of keys) fingerprints.set(key, (fingerprints.get(key) ?? new Set()).add(receiptId));
    },
    recordDecision: async (receipt: Receipt, decision: Decision) => {
      if (receipts.get(receipt.id)?.status !== 'pending_review') {
        throw domainError('INVALID_STATE', `Receipt ${receipt.id} is not pending review`);
      }
      const tx = decision.transactionId ? transactions.get(decision.transactionId) : undefined;
      if (decision.transactionId && (!tx || tx.receiptId)) {
        throw domainError('TRANSACTION_ALREADY_MATCHED', 'The transaction already has a receipt');
      }
      receipts.set(receipt.id, clone(receipt));
      if (tx) transactions.set(tx.id, { ...tx, receiptId: receipt.id });
      decisions.push(clone(decision));
    },
    // s3/receipt-files
    getImage: async (receiptId: string) => {
      const image = uploads.get(receiptId);
      if (!image) throw domainError('INVALID_STATE', `The image for receipt ${receiptId} has not been uploaded yet`);
      return image;
    },
    saveRawExtraction: async (receiptId: string, raw: unknown) => {
      rawExtractions.set(receiptId, raw);
    },
    uploadUrl: async (receiptId: string, mimeType: string) => ({
      url: `https://s3.test/${receiptId}`,
      headers: { 'Content-Type': mimeType },
      expiresInSeconds: 300,
    }),
    viewUrl: async (receiptId: string) => `https://s3.test/${receiptId}/view`,
    // extraction and images: test images are labels; unknown labels are unreadable
    extract: async (image: Uint8Array) => {
      if (extractorDown) throw new Error('ThrottlingException: Rate exceeded');
      const normalized = seed.extractions?.[labelOf(image)];
      return normalized ? { normalized: clone(normalized), raw: { stub: labelOf(image) } } : null;
    },
    analyzeImage: async (image: Uint8Array) => {
      const features = seed.images?.[labelOf(image)];
      if (!features) throw new Error(`No image features for ${labelOf(image)}`);
      return clone(features);
    },
    newId: () => `rcpt-${++ids}`,
    now: () => new Date((clock += 60_000)),
  };

  /** Plays the browser's direct upload to S3. */
  const upload = (receiptId: string, label: string) => uploads.set(receiptId, testImage(label));
  /** Makes the extractor fail as a throttled or unreachable Textract would. */
  const setExtractorDown = (down: boolean) => {
    extractorDown = down;
  };

  return { deps, upload, setExtractorDown, employees, transactions, receipts, decisions, rawExtractions };
}
