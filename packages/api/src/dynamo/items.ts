import type { Decision, Employee, Receipt, Transaction } from '../domain';

/**
 * DynamoDB items can't hold `undefined`, and dynatable's optional attributes reject `null`.
 * Domain objects use `null` for "absent", so top-level nulls are dropped on write and
 * restored on read; nested structures go through a JSON round-trip to drop `undefined`.
 */
export const toItem = <T extends object>(value: T): Record<string, unknown> =>
  Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(value)) as Record<string, unknown>).filter(([, v]) => v !== null));

/**
 * Internal attributes never reach the domain. Stripped here rather than relying on dynatable's
 * `cleanInternalKeys`: its middleware wraps only the initial builder, so chained calls such as
 * `.consistentRead()` return items with the keys still attached.
 */
const INTERNAL_ATTRIBUTES = ['PK', 'SK', 'GSI1PK', 'GSI1SK', 'GSI2PK', 'GSI2SK', '_type'];

const withNulls = <T>(item: unknown, nullable: readonly string[]): T => {
  const result: Record<string, unknown> = { ...(item as Record<string, unknown>) };
  for (const key of INTERNAL_ATTRIBUTES) delete result[key];
  for (const key of nullable) if (result[key] === undefined) result[key] = null;
  return result as T;
};

export const toEmployee = (item: unknown) => withNulls<Employee>(item, []);
export const toTransaction = (item: unknown) =>
  withNulls<Transaction>(item, ['originalAmount', 'receiptId'] satisfies (keyof Transaction)[]);
export const toReceipt = (item: unknown) =>
  withNulls<Receipt>(item, ['extraction', 'image', 'date', 'match', 'anchorTransactionId', 'currency', 'risk'] satisfies (keyof Receipt)[]);
export const toDecision = (item: unknown) =>
  withNulls<Decision>(item, ['transactionId', 'riskLevelAtDecision', 'note'] satisfies (keyof Decision)[]);

/** Collects every page of a query. */
export const all = async <T>(pages: AsyncIterable<unknown>, map: (item: unknown) => T): Promise<T[]> => {
  const items: T[] = [];
  for await (const item of pages) items.push(map(item));
  return items;
};

/** A lower bound for ISO timestamps, used to query a whole GSI partition in order. */
export const ANY_TIMESTAMP = '0';
