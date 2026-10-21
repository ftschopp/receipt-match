import middy from '@middy/core';
import httpHeaderNormalizer from '@middy/http-header-normalizer';
import { idParams } from '../../../http/contract';
import { parseConfig } from '../../../config';
import { dynamoTable } from '../../../dynamo/client';
import * as receipts from '../../../dynamo/receipts';
import { errorResponse, jsonResponse, validateInput, type HttpEvent, type InputOf } from '../../../http/middleware';
import { extract } from '../../../receipt-reading/extract';
import { analyzeImage } from '../../../receipt-reading/image';
import { textractClient } from '../../../receipt-reading/textract-client';
import { s3Client } from '../../../s3/client';
import * as s3 from '../../../s3/receipt-files';
import { receiptViewDeps } from '../view';
import { processReceipt, type ProcessReceiptDeps } from './handler';

const schemas = { params: idParams };

export const createLambda = (deps: ProcessReceiptDeps) =>
  middy<HttpEvent<InputOf<typeof schemas>>>()
    .use(httpHeaderNormalizer())
    .use(validateInput(schemas))
    .use(jsonResponse())
    .use(errorResponse())
    .handler((event) => processReceipt(deps)(event.input));

const config = parseConfig(process.env);
const table = dynamoTable(config);
const s3c = s3Client(config);
const textract = textractClient(config);

export const handler = createLambda({
  ...receiptViewDeps(table, s3c, config.UPLOADS_BUCKET),
  transitionReceipt: (receipt, from) => receipts.transition(table, receipt, from),
  getImage: (receiptId) => s3.getImage(s3c, config.UPLOADS_BUCKET, receiptId),
  analyzeImage,
  extract: (image) => extract(config, textract, image),
  saveRawExtraction: (receiptId, raw) => s3.saveRawExtraction(s3c, config.UPLOADS_BUCKET, receiptId, raw),
  findReceiptsByFingerprints: (keys) => receipts.findByFingerprints(table, keys),
  saveFingerprints: (receiptId, keys) => receipts.saveFingerprints(table, receiptId, keys),
});
