import middy from '@middy/core';
import httpHeaderNormalizer from '@middy/http-header-normalizer';
import httpJsonBodyParser from '@middy/http-json-body-parser';
import { idParams, setAnchorBody } from '../../../http/contract';
import { parseConfig } from '../../../config';
import { dynamoTable } from '../../../dynamo/client';
import * as receipts from '../../../dynamo/receipts';
import { errorResponse, jsonResponse, validateInput, type HttpEvent, type InputOf } from '../../../http/middleware';
import { s3Client } from '../../../s3/client';
import { receiptViewDeps } from '../view';
import { setAnchor, type SetAnchorDeps } from './handler';

const schemas = { params: idParams, body: setAnchorBody };

export const createLambda = (deps: SetAnchorDeps) =>
  middy<HttpEvent<InputOf<typeof schemas>>>()
    .use(httpHeaderNormalizer())
    .use(httpJsonBodyParser({ disableContentTypeError: true }))
    .use(validateInput(schemas))
    .use(jsonResponse())
    .use(errorResponse())
    .handler((event) => setAnchor(deps)(event.input));

const config = parseConfig(process.env);
const table = dynamoTable(config);

export const handler = createLambda({
  ...receiptViewDeps(table, s3Client(config), config.UPLOADS_BUCKET),
  saveReceipt: (receipt) => receipts.save(table, receipt),
  findReceiptsByFingerprints: (keys) => receipts.findByFingerprints(table, keys),
  saveFingerprints: (receiptId, keys) => receipts.saveFingerprints(table, receiptId, keys),
});
