import type { MiddlewareObj } from '@middy/core';
import type { ErrorCode, ErrorResponse } from './contract';
import { isDomainError, type DomainErrorCode } from '../domain';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z, ZodError, type ZodType } from 'zod';
import type { HttpResult } from './responses';

type Schemas = { body?: ZodType; params?: ZodType; query?: ZodType };

/** The validated input a handler receives, typed from the Zod schemas. */
export type InputOf<S extends Schemas> = { [K in keyof S]: S[K] extends ZodType<infer T> ? T : never };

/** The API Gateway event, plus the validated input that `validateInput` attaches to it. */
export type HttpEvent<I> = APIGatewayProxyEventV2 & { input: I };

type HttpMiddleware<I = unknown> = MiddlewareObj<HttpEvent<I>, HttpResult | APIGatewayProxyResultV2>;

/** Parses body, path and query parameters with the shared `contracts` schemas into `event.input`. */
export const validateInput = <S extends Schemas>(schemas: S): HttpMiddleware<InputOf<S>> => ({
  before: (request) => {
    const { event } = request;
    event.input = {
      ...(schemas.body && { body: schemas.body.parse(event.body ?? {}) }),
      ...(schemas.params && { params: schemas.params.parse(event.pathParameters ?? {}) }),
      ...(schemas.query && { query: schemas.query.parse(event.queryStringParameters ?? {}) }),
    } as InputOf<S>;
  },
});

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** Serializes the handler's `HttpResult` as a JSON API Gateway response. */
export const jsonResponse = (): HttpMiddleware => ({
  after: (request) => {
    const result = request.response as HttpResult;
    request.response = json(result.statusCode, result.body);
  },
});

const STATUS: Record<DomainErrorCode, number> = {
  NOT_FOUND: 404,
  UNSUPPORTED_FILE_TYPE: 415,
  FILE_TOO_LARGE: 413,
  INVALID_STATE: 409,
  TRANSACTION_ALREADY_MATCHED: 409,
  NOTE_REQUIRED: 422,
  ANCHOR_REQUIRED: 422,
  TRANSACTION_NOT_ELIGIBLE: 422,
  EXTRACTION_UNAVAILABLE: 503,
};

const errorBody = (statusCode: number, code: ErrorCode, message: string, details?: unknown) => {
  const body: ErrorResponse = { error: { code, message, ...(details !== undefined && { details }) } };
  return json(statusCode, body);
};

/** Maps domain, validation and parsing errors to `{ error: { code, message } }` responses. */
export const errorResponse = (): HttpMiddleware => ({
  onError: (request) => {
    const { error } = request;
    if (isDomainError(error)) {
      request.response = errorBody(STATUS[error.code], error.code, error.message);
    } else if (error instanceof ZodError) {
      request.response = errorBody(400, 'VALIDATION_ERROR', 'Invalid request', z.treeifyError(error));
    } else if (error && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode < 500) {
      // Errors raised by middy middlewares (e.g. malformed JSON body).
      request.response = errorBody(400, 'VALIDATION_ERROR', error.message);
    } else {
      console.error(JSON.stringify({ level: 'error', message: error?.message, stack: error?.stack }));
      request.response = errorBody(500, 'INTERNAL_ERROR', 'Something went wrong');
    }
  },
});
