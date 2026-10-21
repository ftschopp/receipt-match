import middy from '@middy/core';
import httpHeaderNormalizer from '@middy/http-header-normalizer';
import httpJsonBodyParser from '@middy/http-json-body-parser';
import { decisionBody, idParams } from '../../../http/contract';
import { parseConfig } from '../../../config';
import { dynamoTable } from '../../../dynamo/client';
import * as receipts from '../../../dynamo/receipts';
import { errorResponse, jsonResponse, validateInput, type HttpEvent, type InputOf } from '../../../http/middleware';
import { s3Client } from '../../../s3/client';
import { receiptViewDeps } from '../view';
import { decide, type DecideDeps } from './handler';

const schemas = { params: idParams, body: decisionBody };

export const createLambda = (deps: DecideDeps) =>
  middy<HttpEvent<InputOf<typeof schemas>>>()
    .use(httpHeaderNormalizer())
    .use(httpJsonBodyParser({ disableContentTypeError: true }))
    .use(validateInput(schemas))
    .use(jsonResponse())
    .use(errorResponse())
    .handler((event) => decide(deps)(event.input));

const config = parseConfig(process.env);
const table = dynamoTable(config);

export const handler = createLambda({
  ...receiptViewDeps(table, s3Client(config), config.UPLOADS_BUCKET),
  recordDecision: (receipt, decision) => receipts.recordDecision(table, receipt, decision),
  now: () => new Date(),
});
