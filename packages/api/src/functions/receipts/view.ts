import type { S3Client } from '@aws-sdk/client-s3';
import type { ReceiptInsights, ReceiptResponse } from '../../http/contract';
import {
  assignableTransactions,
  classifyLineItem,
  classifyReceipt,
  defaultVerificationConfig,
  mccInfo,
  found,
  type Decision,
  type Employee,
  type FindEmployeeTransactions,
  type Receipt,
  type Transaction,
} from '../../domain';
import * as employees from '../../dynamo/employees';
import * as receipts from '../../dynamo/receipts';
import type { ReceiptTable } from '../../dynamo/table';
import * as transactions from '../../dynamo/transactions';
import * as s3 from '../../s3/receipt-files';

export type ReceiptViewDeps = {
  getReceipt: (id: string) => Promise<Receipt | null>;
  getTransaction: (id: string) => Promise<Transaction | null>;
  getDecisions: (receiptId: string) => Promise<Decision[]>;
  getEmployee: (id: string) => Promise<Employee | null>;
  findEmployeeTransactions: FindEmployeeTransactions;
  viewUrl: (receiptId: string) => Promise<string>;
};

/** The full view of a receipt that every receipt endpoint returns. */
export const receiptView = async (deps: ReceiptViewDeps, id: string): Promise<ReceiptResponse> => {
  const receipt = found(await deps.getReceipt(id), 'Receipt', id);
  const [anchor, decisions, employee, assignable, imageUrl] = await Promise.all([
    receipt.anchorTransactionId ? deps.getTransaction(receipt.anchorTransactionId) : null,
    deps.getDecisions(id),
    deps.getEmployee(receipt.employeeId),
    receipt.kind === 'card' && receipt.status === 'pending_review'
      ? deps.findEmployeeTransactions(receipt.employeeId, null).then(assignableTransactions)
      : [],
    receipt.status === 'uploading' ? null : deps.viewUrl(receipt.id),
  ]);
  return { receipt, anchor, decisions, employee, imageUrl, assignable, insights: insightsFor(receipt, anchor) };
};

const insightsFor = (receipt: Receipt, anchor: Transaction | null): ReceiptInsights => {
  const items = receipt.extraction?.lineItems ?? [];
  const merchant = anchor && mccInfo(anchor.mcc);
  return {
    lineItemCategories: items.map((li) => classifyLineItem(li.description)),
    receiptCategories: classifyReceipt(items, defaultVerificationConfig.classification.minCategoryShare).categories,
    anchorMerchantType: anchor && merchant ? { mcc: anchor.mcc, ...merchant } : null,
  };
};

/** The lookups behind `receiptView`, bound to a table and bucket. Every receipt Lambda injects these. */
export const receiptViewDeps = (table: ReceiptTable, s3Client: S3Client, bucket: string): ReceiptViewDeps => ({
  getReceipt: (id) => receipts.get(table, id),
  getTransaction: (id) => transactions.get(table, id),
  getDecisions: (receiptId) => receipts.decisions(table, receiptId),
  getEmployee: (id) => employees.get(table, id),
  findEmployeeTransactions: (employeeId, range) => transactions.findForEmployee(table, employeeId, range),
  viewUrl: (receiptId) => s3.viewUrl(s3Client, bucket, receiptId),
});
