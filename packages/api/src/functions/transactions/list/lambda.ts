import middy from '@middy/core';
import httpHeaderNormalizer from '@middy/http-header-normalizer';
import { listTransactionsQuery } from '../../../http/contract';
import { parseConfig } from '../../../config';
import { dynamoTable } from '../../../dynamo/client';
import * as receipts from '../../../dynamo/receipts';
import * as transactions from '../../../dynamo/transactions';
import { errorResponse, jsonResponse, validateInput, type HttpEvent, type InputOf } from '../../../http/middleware';
import { listTransactions, type ListTransactionsDeps } from './handler';

const schemas = { query: listTransactionsQuery };

export const createLambda = (deps: ListTransactionsDeps) =>
  middy<HttpEvent<InputOf<typeof schemas>>>()
    .use(httpHeaderNormalizer())
    .use(validateInput(schemas))
    .use(jsonResponse())
    .use(errorResponse())
    .handler((event) => listTransactions(deps)(event.input));

const table = dynamoTable(parseConfig(process.env));

export const handler = createLambda({
  listTransactions: () => transactions.list(table),
  listReceipts: () => receipts.list(table),
});
