import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2, Context } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { createLambda as createReceiptLambda } from '../src/functions/receipts/create/lambda';
import { createLambda as decideLambda } from '../src/functions/receipts/decide/lambda';
import { createLambda as getReceiptLambda } from '../src/functions/receipts/get/lambda';
import { createLambda as listTransactionsLambda } from '../src/functions/transactions/list/lambda';
import { createLambda as processReceiptLambda } from '../src/functions/receipts/process/lambda';
import { createWorld } from './demo-world';

/** The Middy chain of each lambda.ts: parsing, validation, serialization and error mapping. */

function event(e: { body?: unknown; rawBody?: string; params?: Record<string, string>; query?: Record<string, string> }) {
  return {
    headers: { 'Content-Type': 'application/json' },
    body: e.rawBody ?? (e.body === undefined ? undefined : JSON.stringify(e.body)),
    pathParameters: e.params,
    queryStringParameters: e.query,
    requestContext: { http: { method: 'POST' } },
  } as unknown as APIGatewayProxyEventV2;
}

async function call(lambda: (event: never, context: Context) => Promise<unknown>, e: Parameters<typeof event>[0] = {}) {
  const res = (await lambda(event(e) as never, {} as Context)) as APIGatewayProxyStructuredResultV2;
  return { status: res.statusCode, headers: res.headers, body: JSON.parse(res.body as string) };
}

describe('lambdas', () => {
  it('serializes the handler result as a JSON response with its status', async () => {
    const { deps } = createWorld();
    const res = await call(createReceiptLambda(deps), { body: { employeeId: 'emp-juan', kind: 'card', mimeType: 'image/jpeg', size: 1234 } });
    expect(res.status).toBe(201);
    expect(res.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(res.body.receipt.status).toBe('uploading');
  });

  it('accepts a bodyless POST that carries a JSON content type', async () => {
    const { deps, upload } = createWorld();
    const created = await call(createReceiptLambda(deps), { body: { employeeId: 'emp-juan', kind: 'card', mimeType: 'image/jpeg', size: 1 } });
    upload(created.body.receipt.id, 'cafe-martinez');
    const processed = await call(processReceiptLambda(deps), { params: { id: created.body.receipt.id } });
    expect(processed.status).toBe(200);
  });

  it('rejects invalid input with VALIDATION_ERROR and the Zod details', async () => {
    const { deps } = createWorld();
    const res = await call(createReceiptLambda(deps), { body: { employeeId: 'emp-juan', kind: 'cash', mimeType: 'image/gif', size: -1 } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toBeDefined();
  });

  it('rejects malformed JSON', async () => {
    const { deps } = createWorld();
    const res = await call(createReceiptLambda(deps), { rawBody: '{not json' });
    expect(res).toMatchObject({ status: 400, body: { error: { code: 'VALIDATION_ERROR' } } });
  });

  it('maps domain errors to HTTP statuses', async () => {
    const { deps } = createWorld();
    expect(await call(getReceiptLambda(deps), { params: { id: 'nope' } })).toMatchObject({ status: 404, body: { error: { code: 'NOT_FOUND' } } });

    const created = await call(createReceiptLambda(deps), { body: { employeeId: 'emp-juan', kind: 'card', mimeType: 'image/png', size: 10 } });
    const twice = await call(decideLambda(deps), { params: { id: created.body.receipt.id }, body: { decision: 'approved' } });
    expect(twice).toMatchObject({ status: 409, body: { error: { code: 'INVALID_STATE' } } });
  });

  it('applies query defaults', async () => {
    const { deps } = createWorld();
    const res = await call(listTransactionsLambda(deps));
    expect(res.status).toBe(200);
    expect(res.body.transactions).toHaveLength(1);
  });
});
