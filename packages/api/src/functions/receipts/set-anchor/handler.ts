import type { SetAnchorBody } from '../../../http/contract';
import { assertAnchorable, assertCanAnchor, fingerprintKeys, found, verify, type FindReceiptsByFingerprints, type Receipt } from '../../../domain';
import { ok, type HttpResult } from '../../../http/responses';
import { receiptView, type ReceiptViewDeps } from '../view';

export type SetAnchorDeps = ReceiptViewDeps & {
  saveReceipt: (receipt: Receipt) => Promise<void>;
  findReceiptsByFingerprints: FindReceiptsByFingerprints;
  saveFingerprints: (receiptId: string, keys: string[]) => Promise<void>;
};

/** POST /receipts/{id}/anchor: the user picks the transaction; verification re-runs against it. */
export const setAnchor =
  (deps: SetAnchorDeps) =>
  async ({ params, body }: { params: { id: string }; body: SetAnchorBody }): Promise<HttpResult> => {
    const receipt = found(await deps.getReceipt(params.id), 'Receipt', params.id);
    assertAnchorable(receipt);
    const tx = found(await deps.getTransaction(body.transactionId), 'Transaction', body.transactionId);
    assertCanAnchor(receipt, tx);

    const updated =
      receipt.extraction && receipt.image ? await verify(receipt, tx, deps.findReceiptsByFingerprints) : { ...receipt, anchorTransactionId: tx.id };
    await deps.saveReceipt(updated);
    // A new anchor can settle a bare "$" in another currency: index the content under that reading too.
    if (updated.image) await deps.saveFingerprints(receipt.id, fingerprintKeys(updated.image, updated.extraction, updated.date));
    return ok(await receiptView(deps, receipt.id));
  };
