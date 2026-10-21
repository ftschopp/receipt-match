/**
 * The db/* functions against a real DynamoDB API (the local emulator from docker-compose.yml).
 * Opt-in: `npm run test:integration` (requires `docker compose up -d`).
 */
import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { Decision, Receipt } from '../src/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { employees, transactions } from '../seed/demo-company';
import * as employeesDb from '../src/dynamo/employees';
import * as receiptsDb from '../src/dynamo/receipts';
import { createTable, tableDefinition } from '../src/dynamo/table';
import * as transactionsDb from '../src/dynamo/transactions';

const run = process.env.INTEGRATION === '1';
const TABLE = `receipt-match-it-${Date.now()}`;
const dynamo = new DynamoDBClient({
  region: 'us-east-1',
  endpoint: process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:4567',
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});
const table = createTable(dynamo, TABLE);

const receipt = (id: string, overrides: Partial<Receipt> = {}): Receipt => ({
  id,
  employeeId: 'emp-juan',
  kind: 'card',
  mimeType: 'image/jpeg',
  uploadedAt: `2026-10-17T10:00:0${id.slice(-1)}Z`,
  status: 'pending_review',
  extractionStatus: 'succeeded',
  extraction: null,
  image: { sha256: `sha-${id}`, dhash: 'f0f0f0f0f0f0f0f0', meta: { format: 'jpeg' } },
  date: { date: '2026-10-13', resolution: 'printed', confidence: 99 },
  match: null,
  anchorTransactionId: 'tx-cafe-martinez',
  currency: { code: 'ARS', readAs: 'ARS', resolution: 'company_default' },
  signals: [],
  risk: { level: 'low', reasons: [] },
  ...overrides,
});

describe.skipIf(!run)('db functions (integration)', () => {
  beforeAll(async () => {
    await dynamo.send(new CreateTableCommand({ TableName: TABLE, ...tableDefinition }));
    for (const e of employees) await employeesDb.put(table, e);
    for (const t of transactions) await transactionsDb.put(table, t);
  });

  afterAll(async () => {
    await dynamo.send(new DeleteTableCommand({ TableName: TABLE }));
  });

  it('round-trips employees and transactions, restoring nulls', async () => {
    expect(await employeesDb.get(table, 'emp-ana')).toEqual(employees[1]);
    const tx = await transactionsDb.get(table, 'tx-cafe-martinez');
    expect(tx).toEqual(transactions.find((t) => t.id === 'tx-cafe-martinez'));
    expect(tx?.originalAmount).toBeNull();
    expect((await transactionsDb.get(table, 'tx-notion'))?.originalAmount).toEqual({ amountMinor: 4999, currency: 'USD' });
  });

  it('lists all transactions newest first (GSI2)', async () => {
    const list = await transactionsDb.list(table);
    expect(list).toHaveLength(transactions.length);
    expect(list.map((t) => t.authorizedAt)).toEqual([...list.map((t) => t.authorizedAt)].sort().reverse());
  });

  it("finds an employee's transactions in a UTC range (GSI1)", async () => {
    const inRange = await transactionsDb.findForEmployee(table, 'emp-juan', { fromUtc: '2026-10-14T00:00:00Z', toUtc: '2026-10-15T00:00:00Z' });
    expect(inRange.map((t) => t.id).sort()).toEqual(['tx-don-julio']);
    expect(await transactionsDb.findForEmployee(table, 'emp-juan', null)).toHaveLength(7);
  });

  it('lists employees', async () => {
    expect((await employeesDb.list(table)).map((e) => e.id).sort()).toEqual(employees.map((e) => e.id).sort());
  });

  it('stores receipts with nested structures and finds them by fingerprint', async () => {
    const r1 = receipt('rcpt-1');
    await receiptsDb.save(table, r1);
    expect(await receiptsDb.get(table, 'rcpt-1')).toEqual(r1);

    await receiptsDb.saveFingerprints(table, 'rcpt-1', ['SHA#sha-rcpt-1', 'DH1#1e1']);
    const related = await receiptsDb.findByFingerprints(table, ['DH1#1e1', 'DH2#nothing']);
    expect(related).toEqual([
      expect.objectContaining({ id: 'rcpt-1', employeeName: 'Juan Pérez', sha256: 'sha-rcpt-1', dhash: 'f0f0f0f0f0f0f0f0' }),
    ]);
    expect(await receiptsDb.findByFingerprints(table, ['SHA#unknown'])).toEqual([]);
  });

  it('moves a receipt between states only from the expected one', async () => {
    await receiptsDb.save(table, receipt('rcpt-9', { status: 'uploading' }));
    await receiptsDb.transition(table, receipt('rcpt-9', { status: 'processing' }), 'uploading');
    expect((await receiptsDb.get(table, 'rcpt-9'))?.status).toBe('processing');

    // A second run that also read "uploading" loses the race.
    await expect(receiptsDb.transition(table, receipt('rcpt-9', { status: 'processing' }), 'uploading')).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });

  it('records a decision atomically and refuses to link a transaction twice', async () => {
    const decision = (receiptId: string): Decision => ({
      receiptId,
      transactionId: 'tx-cafe-martinez',
      decision: 'approved',
      riskLevelAtDecision: 'low',
      note: null,
      decidedAt: '2026-10-17T11:00:00Z',
    });

    await receiptsDb.recordDecision(table, { ...receipt('rcpt-1'), status: 'approved' }, decision('rcpt-1'));
    expect((await receiptsDb.get(table, 'rcpt-1'))?.status).toBe('approved');
    expect((await transactionsDb.get(table, 'tx-cafe-martinez'))?.receiptId).toBe('rcpt-1');
    expect(await receiptsDb.decisions(table, 'rcpt-1')).toEqual([decision('rcpt-1')]);
    expect((await receiptsDb.list(table)).map((r) => r.id)).toContain('rcpt-1');

    // Deciding again: the receipt is no longer pending review.
    await expect(receiptsDb.recordDecision(table, { ...receipt('rcpt-1'), status: 'rejected' }, { ...decision('rcpt-1'), decision: 'rejected', transactionId: null }))
      .rejects.toMatchObject({ code: 'INVALID_STATE' });

    // Another receipt for the same transaction: nothing is written.
    await receiptsDb.save(table, receipt('rcpt-2'));
    await expect(receiptsDb.recordDecision(table, { ...receipt('rcpt-2'), status: 'approved' }, decision('rcpt-2'))).rejects.toMatchObject({
      code: 'TRANSACTION_ALREADY_MATCHED',
    });
    expect((await receiptsDb.get(table, 'rcpt-2'))?.status).toBe('pending_review');
    expect(await receiptsDb.decisions(table, 'rcpt-2')).toEqual([]);
  });
});
