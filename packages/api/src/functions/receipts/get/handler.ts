import { ok, type HttpResult } from '../../../http/responses';
import { receiptView, type ReceiptViewDeps } from '../view';

export type GetReceiptDeps = ReceiptViewDeps;

/** GET /receipts/{id} */
export const getReceipt =
  (deps: GetReceiptDeps) =>
  async ({ params }: { params: { id: string } }): Promise<HttpResult> =>
    ok(await receiptView(deps, params.id));
