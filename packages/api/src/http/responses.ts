/** What a handler returns: a status and a body. `jsonResponse` turns it into the API Gateway response. */
export type HttpResult = { statusCode: number; body: unknown };

export const ok = (body: unknown): HttpResult => ({ statusCode: 200, body });
export const created = (body: unknown): HttpResult => ({ statusCode: 201, body });
