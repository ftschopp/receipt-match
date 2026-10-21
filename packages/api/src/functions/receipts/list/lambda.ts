import middy from '@middy/core';
import httpHeaderNormalizer from '@middy/http-header-normalizer';
import { parseConfig } from '../../../config';
import { dynamoTable } from '../../../dynamo/client';
import * as receipts from '../../../dynamo/receipts';
import { errorResponse, jsonResponse, type HttpEvent } from '../../../http/middleware';
import { listReceipts, type ListReceiptsDeps } from './handler';

export const createLambda = (deps: ListReceiptsDeps) =>
  middy<HttpEvent<unknown>>()
    .use(httpHeaderNormalizer())
    .use(jsonResponse())
    .use(errorResponse())
    .handler(listReceipts(deps));

const table = dynamoTable(parseConfig(process.env));

export const handler = createLambda({
  listReceipts: () => receipts.list(table),
});
