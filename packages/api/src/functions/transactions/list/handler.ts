import type { ListTransactionsQuery, ListTransactionsResponse } from '../../../http/contract';
import { mccInfo, transactionViews, type Receipt, type Transaction } from '../../../domain';
import { ok, type HttpResult } from '../../../http/responses';

export type ListTransactionsDeps = {
  listTransactions: () => Promise<Transaction[]>;
  listReceipts: () => Promise<Receipt[]>;
};

/** GET /transactions?filter=all|attention: each transaction with the state of its receipt. */
export const listTransactions =
  (deps: ListTransactionsDeps) =>
  async ({ query }: { query: ListTransactionsQuery }): Promise<HttpResult> => {
    const [transactions, receipts] = await Promise.all([deps.listTransactions(), deps.listReceipts()]);
    const views = transactionViews(transactions, receipts, query.filter);
    const body: ListTransactionsResponse = {
      transactions: views.map((v) => ({ ...v, merchantType: mccInfo(v.mcc)?.label ?? null })),
    };
    return ok(body);
  };
