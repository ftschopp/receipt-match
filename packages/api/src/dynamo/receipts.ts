import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { domainError, toRelatedReceipt, type Decision, type Receipt, type ReceiptStatus, type RelatedReceipt } from '../domain';
import * as employees from './employees';
import { all, ANY_TIMESTAMP, toDecision, toItem, toReceipt } from './items';
import type { ReceiptTable } from './table';

export const get = async (table: ReceiptTable, id: string): Promise<Receipt | null> => {
  const item = await table.entities.Receipt.get({ id }).consistentRead().execute();
  return item ? toReceipt(item) : null;
};

/** All receipts, newest first (GSI2). */
export const list = (table: ReceiptTable): Promise<Receipt[]> =>
  all(
    table.entities.Receipt.query()
      .where((attr, op) => op.gte(attr.uploadedAt, ANY_TIMESTAMP))
      .useIndex('GSI2')
      .scanIndexForward(false)
      .iterate(),
    toReceipt,
  );

export const save = async (table: ReceiptTable, receipt: Receipt): Promise<void> => {
  await table.entities.Receipt.put(toItem(receipt) as never).execute();
};

/** Saves the receipt only if its stored status is still `from`; otherwise INVALID_STATE (someone else moved it). */
export const transition = async (table: ReceiptTable, receipt: Receipt, from: ReceiptStatus): Promise<void> => {
  try {
    await table.entities.Receipt.put(toItem(receipt) as never)
      .where((attr, op) => op.eq(attr.status, from))
      .execute();
  } catch (error) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      throw domainError('INVALID_STATE', `Receipt ${receipt.id} is no longer ${from}`);
    }
    throw error;
  }
};

/** The receipt's decision history (same partition as the receipt). */
export const decisions = async (table: ReceiptTable, receiptId: string): Promise<Decision[]> =>
  (
    await table.entities.Decision.query()
      .where((attr, op) => op.and(op.eq(attr.receiptId, receiptId), op.beginsWith(attr.decidedAt, '')))
      .execute()
  ).map(toDecision);

/**
 * Receipts indexed under any of the fingerprint keys. DynamoDB has no OR across partition keys:
 * each fingerprint is its own partition, so the lookup is one query per key, run in parallel
 * (TECH_SPEC §5.3). Strongly consistent reads: a fingerprint written by a concurrent upload a
 * moment ago must be visible, or two simultaneous duplicates could miss each other.
 */
export const findByFingerprints = async (table: ReceiptTable, keys: string[]): Promise<RelatedReceipt[]> => {
  const hits = await Promise.all(
    keys.map((fingerprint) =>
      table.entities.Fingerprint.query()
        .where((attr, op) => op.eq(attr.fingerprint, fingerprint))
        .consistentRead()
        .execute(),
    ),
  );
  const ids = [...new Set(hits.flat().map((h) => h.receiptId))];
  if (ids.length === 0) return [];

  const receipts = (await table.entities.Receipt.batchGet(ids.map((id) => ({ id }))).consistentRead().execute()).map(toReceipt);
  const names = new Map((await employees.getMany(table, [...new Set(receipts.map((r) => r.employeeId))])).map((e) => [e.id, e.name]));
  return receipts.map((r) => toRelatedReceipt(r, names.get(r.employeeId) ?? r.employeeId));
};

export const saveFingerprints = async (table: ReceiptTable, receiptId: string, keys: string[]): Promise<void> => {
  if (keys.length === 0) return;
  await table.entities.Fingerprint.batchWrite(keys.map((fingerprint) => ({ fingerprint, receiptId }))).execute();
};

/**
 * One TransactWrite: the receipt must still be pending review, the transaction must not have a
 * receipt yet, and the decision is appended. Either all three writes happen or none do.
 */
export const recordDecision = async (table: ReceiptTable, receipt: Receipt, decision: Decision): Promise<void> => {
  const e = table.entities;
  const putReceipt = e.Receipt.put(toItem(receipt) as never)
    .where((attr, op) => op.eq(attr.status, 'pending_review'))
    .dbParams();
  const linkTransaction =
    decision.transactionId &&
    e.Transaction.update({ id: decision.transactionId })
      .set('receiptId', receipt.id)
      .where((attr, op) => op.and(op.exists(attr.id), op.notExists(attr.receiptId)))
      .dbParams();
  const putDecision = e.Decision.put(toItem(decision) as never).ifNotExists().dbParams();

  const withReceipt = table.transactWrite().addPut(putReceipt);
  const write = (linkTransaction ? withReceipt.addUpdate(linkTransaction) : withReceipt).addPut(putDecision);

  try {
    await write.execute();
  } catch (error) {
    if (error instanceof TransactionCanceledException) {
      const failed = (error.CancellationReasons ?? []).map((r) => r.Code === 'ConditionalCheckFailed');
      if (failed[0]) throw domainError('INVALID_STATE', `Receipt ${receipt.id} is not pending review`);
      if (linkTransaction && failed[1]) throw domainError('TRANSACTION_ALREADY_MATCHED', 'The transaction already has a receipt');
    }
    throw error;
  }
};
