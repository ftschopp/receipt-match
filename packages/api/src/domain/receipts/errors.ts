export type DomainErrorCode =
  | 'NOT_FOUND'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'FILE_TOO_LARGE'
  | 'INVALID_STATE'
  | 'NOTE_REQUIRED'
  | 'ANCHOR_REQUIRED'
  | 'TRANSACTION_ALREADY_MATCHED'
  | 'TRANSACTION_NOT_ELIGIBLE'
  /** The receipt reader failed for a reason unrelated to the document (throttling, network). Retry later. */
  | 'EXTRACTION_UNAVAILABLE';

/** An Error carrying a domain code. The API maps codes to HTTP; the domain doesn't know about HTTP. */
export type DomainError = Error & { name: 'DomainError'; code: DomainErrorCode };

export const domainError = (code: DomainErrorCode, message: string): DomainError =>
  Object.assign(new Error(message), { name: 'DomainError' as const, code });

export const isDomainError = (error: unknown): error is DomainError =>
  error instanceof Error && error.name === 'DomainError' && 'code' in error;

export const notFound = (what: string, id: string) => domainError('NOT_FOUND', `${what} ${id} not found`);
