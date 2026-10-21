import middy from '@middy/core';
import httpHeaderNormalizer from '@middy/http-header-normalizer';
import { idParams } from '../../../http/contract';
import { parseConfig } from '../../../config';
import { dynamoTable } from '../../../dynamo/client';
import { errorResponse, jsonResponse, validateInput, type HttpEvent, type InputOf } from '../../../http/middleware';
import { s3Client } from '../../../s3/client';
import { receiptViewDeps } from '../view';
import { getReceipt, type GetReceiptDeps } from './handler';

const schemas = { params: idParams };

export const createLambda = (deps: GetReceiptDeps) =>
  middy<HttpEvent<InputOf<typeof schemas>>>()
    .use(httpHeaderNormalizer())
    .use(validateInput(schemas))
    .use(jsonResponse())
    .use(errorResponse())
    .handler((event) => getReceipt(deps)(event.input));

const config = parseConfig(process.env);

export const handler = createLambda(receiptViewDeps(dynamoTable(config), s3Client(config), config.UPLOADS_BUCKET));
