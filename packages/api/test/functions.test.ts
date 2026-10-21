import { describe, expect, it } from 'vitest';
import { createReceipt } from '../src/functions/receipts/create/handler';
import { decide } from '../src/functions/receipts/decide/handler';
import { getReceipt } from '../src/functions/receipts/get/handler';
import { listEmployees } from '../src/functions/employees/list/handler';
import { listReceipts } from '../src/functions/receipts/list/handler';
import { listTransactions } from '../src/functions/transactions/list/handler';
import { processReceipt } from '../src/functions/receipts/process/handler';
import { setAnchor } from '../src/functions/receipts/set-anchor/handler';
import { createWorld } from './demo-world';

/** Handler logic only: validated input in, `{ statusCode, body }` out. No Middy, no API Gateway. */
describe('handlers', () => {
  it('runs the upload → process → decide flow', async () => {
    const { deps, upload } = createWorld();

    const created = await createReceipt(deps)({ body: { employeeId: 'emp-juan', kind: 'card', mimeType: 'image/jpeg', size: 1234 } });
    expect(created.statusCode).toBe(201);
    const { receipt, upload: presigned } = created.body as { receipt: { id: string }; upload: { url: string } };
    expect(presigned.url).toContain(receipt.id);

    upload(receipt.id, 'cafe-martinez'); // the browser's direct upload to S3

    const processed = await processReceipt(deps)({ params: { id: receipt.id } });
    expect(processed.body).toMatchObject({
      receipt: { status: 'pending_review', anchorTransactionId: 'tx-cafe-martinez' },
      anchor: { id: 'tx-cafe-martinez' },
      employee: { name: 'Juan Pérez' },
      imageUrl: `https://s3.test/${receipt.id}/view`,
    });

    const decided = await decide(deps)({ params: { id: receipt.id }, body: { decision: 'approved' } });
    expect(decided.body).toMatchObject({ receipt: { status: 'approved' }, decisions: [{ decision: 'approved' }] });

    expect((await listReceipts(deps)()).body).toMatchObject({ receipts: [{ id: receipt.id }] });
    expect((await listTransactions(deps)({ query: { filter: 'all' } })).body).toMatchObject({
      transactions: [{ id: 'tx-cafe-martinez', receiptStatus: 'approved' }],
    });
    expect((await getReceipt(deps)({ params: { id: receipt.id } })).statusCode).toBe(200);
  });

  it('assigns a transaction manually', async () => {
    const { deps } = createWorld();
    const created = await createReceipt(deps)({ body: { employeeId: 'emp-juan', kind: 'card', mimeType: 'image/png', size: 10 } });
    const { id } = (created.body as { receipt: { id: string } }).receipt;
    // Not processed yet: the domain refuses, and the error propagates for the Lambda to map.
    await expect(setAnchor(deps)({ params: { id }, body: { transactionId: 'tx-cafe-martinez' } })).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });

  it('lists employees', async () => {
    const { deps } = createWorld();
    expect((await listEmployees(deps)()).body).toEqual({ employees: [{ id: 'emp-juan', name: 'Juan Pérez', department: 'Engineering' }] });
  });
});
