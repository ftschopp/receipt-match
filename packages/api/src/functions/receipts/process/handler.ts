import {
  domainError,
  fingerprintKeys,
  found,
  markUnreadable,
  matchCardReceipt,
  resolveDate,
  startProcessing,
  verify,
  type ExtractedReceipt,
  type FindReceiptsByFingerprints,
  type ImageFeatures,
  type Receipt,
  type ReceiptStatus,
} from '../../../domain';
import { ok, type HttpResult } from '../../../http/responses';
import { receiptView, type ReceiptViewDeps } from '../view';

export type ProcessReceiptDeps = ReceiptViewDeps & {
  /** Saves the receipt only if its stored status is still `from`; INVALID_STATE otherwise. */
  transitionReceipt: (receipt: Receipt, from: ReceiptStatus) => Promise<void>;
  getImage: (receiptId: string) => Promise<Uint8Array>;
  analyzeImage: (image: Uint8Array, mimeType: string) => Promise<ImageFeatures>;
  /** Null when the document can't be read; throws when the reader itself failed (worth a retry). */
  extract: (image: Uint8Array, mimeType: string) => Promise<{ normalized: ExtractedReceipt; raw: unknown } | null>;
  saveRawExtraction: (receiptId: string, raw: unknown) => Promise<void>;
  findReceiptsByFingerprints: FindReceiptsByFingerprints;
  saveFingerprints: (receiptId: string, keys: string[]) => Promise<void>;
};

/** POST /receipts/{id}/process: after the upload, analyze the image, extract, match (card receipts) and verify. */
export const processReceipt =
  (deps: ProcessReceiptDeps) =>
  async ({ params }: { params: { id: string } }): Promise<HttpResult> => {
    const uploaded = found(await deps.getReceipt(params.id), 'Receipt', params.id);
    const bytes = await deps.getImage(uploaded.id);
    const image = await deps.analyzeImage(bytes, uploaded.mimeType);

    // Claim the receipt: a second concurrent run fails here instead of processing it twice.
    const receipt = startProcessing(uploaded, image);
    await deps.transitionReceipt(receipt, 'uploading');
    // Image fingerprints go in before the duplicate lookup. Of two simultaneous uploads of the same
    // image, the one that looks up last always finds the other (the self-match is filtered out).
    await deps.saveFingerprints(receipt.id, fingerprintKeys(image, null, null));

    let extraction: ExtractedReceipt | null;
    try {
      const read = await deps.extract(bytes, receipt.mimeType);
      if (read) await deps.saveRawExtraction(receipt.id, read.raw);
      extraction = read?.normalized ?? null;
    } catch (error) {
      // Not the document's fault: give the receipt back so the upload can be processed again.
      await deps.transitionReceipt(uploaded, 'processing');
      const reason = error instanceof Error ? error.message : String(error);
      throw domainError('EXTRACTION_UNAVAILABLE', `The receipt could not be read right now (${reason}). Try again.`);
    }

    if (!extraction?.total.value) {
      await deps.transitionReceipt(await markUnreadable(receipt, extraction, image, deps.findReceiptsByFingerprints), 'processing');
      return ok(await receiptView(deps, receipt.id));
    }

    const date = await resolveDate(receipt, extraction, deps.findEmployeeTransactions);
    const { match, anchor } =
      receipt.kind === 'card' ? await matchCardReceipt(receipt, extraction, date, deps.findEmployeeTransactions) : { match: null, anchor: null };
    const verified = await verify({ ...receipt, extraction, date, match }, anchor, deps.findReceiptsByFingerprints);

    await deps.transitionReceipt({ ...verified, status: 'pending_review', extractionStatus: 'succeeded' }, 'processing');
    // The content key uses the amounts as verified (currency settled against the anchor), the same
    // reading later lookups use.
    await deps.saveFingerprints(receipt.id, fingerprintKeys(image, verified.extraction, date));
    return ok(await receiptView(deps, receipt.id));
  };
