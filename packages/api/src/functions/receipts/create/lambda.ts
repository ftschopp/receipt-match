import { randomUUID } from 'node:crypto';
import middy from '@middy/core';
import httpHeaderNormalizer from '@middy/http-header-normalizer';
import httpJsonBodyParser from '@middy/http-json-body-parser';
import { createReceiptBody } from '../../../http/contract';
import { parseConfig } from '../../../config';
import { dynamoTable } from '../../../dynamo/client';
import * as employees from '../../../dynamo/employees';
import * as receipts from '../../../dynamo/receipts';
import { errorResponse, jsonResponse, validateInput, type HttpEvent, type InputOf } from '../../../http/middleware';
import { s3Client } from '../../../s3/client';
import * as s3 from '../../../s3/receipt-files';
import { createReceipt, type CreateReceiptDeps } from './handler';

const schemas = { body: createReceiptBody };

export const createLambda = (deps: CreateReceiptDeps) =>
  middy<HttpEvent<InputOf<typeof schemas>>>()
    .use(httpHeaderNormalizer())
    .use(httpJsonBodyParser({ disableContentTypeError: true }))
    .use(validateInput(schemas))
    .use(jsonResponse())
    .use(errorResponse())
    .handler((event) => createReceipt(deps)(event.input));

const config = parseConfig(process.env);
const table = dynamoTable(config);
const s3c = s3Client(config);

export const handler = createLambda({
  getEmployee: (id) => employees.get(table, id),
  saveReceipt: (receipt) => receipts.save(table, receipt),
  uploadUrl: (receiptId, mimeType) => s3.uploadUrl(s3c, config.UPLOADS_BUCKET, receiptId, mimeType),
  newId: randomUUID,
  now: () => new Date(),
});
