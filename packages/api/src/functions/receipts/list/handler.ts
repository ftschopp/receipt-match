import type { ListReceiptsResponse } from '../../../http/contract';
import { receiptsNewestFirst, type Receipt } from '../../../domain';
import { ok, type HttpResult } from '../../../http/responses';

export type ListReceiptsDeps = { listReceipts: () => Promise<Receipt[]> };

/** GET /receipts: the review queue, including reimbursements (which have no transaction). */
export const listReceipts = (deps: ListReceiptsDeps) => async (): Promise<HttpResult> => {
  const body: ListReceiptsResponse = { receipts: receiptsNewestFirst(await deps.listReceipts()) };
  return ok(body);
};
