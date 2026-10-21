import type { DecisionBody } from '../../../http/contract';
import { decideReceipt, found, type Decision, type Receipt } from '../../../domain';
import { ok, type HttpResult } from '../../../http/responses';
import { receiptView, type ReceiptViewDeps } from '../view';

export type DecideDeps = ReceiptViewDeps & {
  /** Atomic: receipt still pending, transaction not yet linked, decision appended. */
  recordDecision: (receipt: Receipt, decision: Decision) => Promise<void>;
  now: () => Date;
};

/** POST /receipts/{id}/decision: approve or reject; a high-risk approval needs a note. */
export const decide =
  (deps: DecideDeps) =>
  async ({ params, body }: { params: { id: string }; body: DecisionBody }): Promise<HttpResult> => {
    const receipt = found(await deps.getReceipt(params.id), 'Receipt', params.id);
    const decided = decideReceipt(receipt, body, deps.now());
    await deps.recordDecision(decided.receipt, decided.decision);
    return ok(await receiptView(deps, receipt.id));
  };
