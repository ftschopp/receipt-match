import type { Transaction } from '../domain';
import { all, ANY_TIMESTAMP, toItem, toTransaction } from './items';
import type { ReceiptTable } from './table';

export const get = async (table: ReceiptTable, id: string): Promise<Transaction | null> => {
  const item = await table.entities.Transaction.get({ id }).execute();
  return item ? toTransaction(item) : null;
};

/** All transactions, newest first (GSI2). */
export const list = (table: ReceiptTable): Promise<Transaction[]> =>
  all(
    table.entities.Transaction.query()
      .where((attr, op) => op.gte(attr.authorizedAt, ANY_TIMESTAMP))
      .useIndex('GSI2')
      .scanIndexForward(false)
      .iterate(),
    toTransaction,
  );

/** An employee's transactions authorized within [fromUtc, toUtc], or all of them when range is null (GSI1). */
export const findForEmployee = (
  table: ReceiptTable,
  employeeId: string,
  range: { fromUtc: string; toUtc: string } | null,
): Promise<Transaction[]> =>
  all(
    table.entities.Transaction.query()
      .where((attr, op) =>
        range
          ? op.and(op.eq(attr.employeeId, employeeId), op.between(attr.authorizedAt, range.fromUtc, range.toUtc))
          : op.eq(attr.employeeId, employeeId),
      )
      .useIndex('GSI1')
      .iterate(),
    toTransaction,
  );

export const put = async (table: ReceiptTable, transaction: Transaction): Promise<void> => {
  await table.entities.Transaction.put(toItem(transaction) as never).execute();
};
