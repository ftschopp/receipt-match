import middy from '@middy/core';
import httpHeaderNormalizer from '@middy/http-header-normalizer';
import { parseConfig } from '../../../config';
import { dynamoTable } from '../../../dynamo/client';
import * as employees from '../../../dynamo/employees';
import { errorResponse, jsonResponse, type HttpEvent } from '../../../http/middleware';
import { listEmployees, type ListEmployeesDeps } from './handler';

export const createLambda = (deps: ListEmployeesDeps) =>
  middy<HttpEvent<unknown>>()
    .use(httpHeaderNormalizer())
    .use(jsonResponse())
    .use(errorResponse())
    .handler(listEmployees(deps));

const table = dynamoTable(parseConfig(process.env));

export const handler = createLambda({
  listEmployees: () => employees.list(table),
});
