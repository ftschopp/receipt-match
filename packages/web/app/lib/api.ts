import type {
  CreateReceiptBody,
  CreateReceiptResponse,
  DecisionBody,
  ErrorCode,
  ErrorResponse,
  ListEmployeesResponse,
  ListReceiptsResponse,
  ListTransactionsResponse,
  ReceiptResponse,
} from './api-types';

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000';

/** An Error from the API, carrying the HTTP status and the API error code. */
export type ApiError = Error & { name: 'ApiError'; status: number; code: ErrorCode; details?: unknown };

export const apiError = (status: number, code: ErrorCode, message: string, details?: unknown): ApiError =>
  Object.assign(new Error(message), { name: 'ApiError' as const, status, code, details });

export const isApiError = (error: unknown): error is ApiError => error instanceof Error && error.name === 'ApiError';

const request = async <T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> => {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: init.method ?? 'GET',
    ...(init.body !== undefined && {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(init.body),
    }),
  });
  const payload = (await res.json().catch(() => null)) as T | ErrorResponse | null;
  if (!res.ok) {
    const error = (payload as ErrorResponse | null)?.error;
    throw apiError(res.status, error?.code ?? 'INTERNAL_ERROR', error?.message ?? res.statusText, error?.details);
  }
  return payload as T;
};

export const api = {
  employees: () => request<ListEmployeesResponse>('/employees'),
  transactions: (filter: 'all' | 'attention' = 'all') => request<ListTransactionsResponse>(`/transactions?filter=${filter}`),
  receipts: () => request<ListReceiptsResponse>('/receipts'),
  receipt: (id: string) => request<ReceiptResponse>(`/receipts/${id}`),
  createReceipt: (body: CreateReceiptBody) => request<CreateReceiptResponse>('/receipts', { method: 'POST', body }),
  process: (id: string) => request<ReceiptResponse>(`/receipts/${id}/process`, { method: 'POST' }),
  setAnchor: (id: string, transactionId: string) =>
    request<ReceiptResponse>(`/receipts/${id}/anchor`, { method: 'POST', body: { transactionId } }),
  decide: (id: string, body: DecisionBody) => request<ReceiptResponse>(`/receipts/${id}/decision`, { method: 'POST', body }),

  /** Uploads the file straight to S3 with the presigned URL: the bytes never go through the API. */
  async upload(upload: CreateReceiptResponse['upload'], file: File): Promise<void> {
    const res = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: file });
    if (!res.ok) throw apiError(res.status, 'INTERNAL_ERROR', `Upload failed (${res.status})`);
  },
};
