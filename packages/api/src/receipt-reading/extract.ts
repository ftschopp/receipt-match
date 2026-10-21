import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { AnalyzeExpenseCommand, type TextractClient } from '@aws-sdk/client-textract';
import type { ExtractedReceipt } from '../domain';
import type { Config } from '../config';
import { mapAnalyzeExpense } from './textract-mapper';

export type Extraction = { normalized: ExtractedReceipt; raw: unknown };

/**
 * Textract errors that are about the document itself: retrying won't help, the receipt is
 * unreadable. Anything else (throttling, network, credentials) is transient and is rethrown.
 */
const DOCUMENT_ERRORS = new Set([
  'UnsupportedDocumentException',
  'BadDocumentException',
  'DocumentTooLargeException',
  'InvalidParameterException',
]);

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Calls Textract AnalyzeExpense synchronously with the image bytes (≤ 5 MB, single page). Null when the document can't be read. */
export const withTextract = async (textract: TextractClient, image: Uint8Array, defaultCurrency: string): Promise<Extraction | null> => {
  try {
    const { $metadata: _metadata, ...response } = await textract.send(new AnalyzeExpenseCommand({ Document: { Bytes: image } }));
    return { normalized: mapAnalyzeExpense(response, defaultCurrency), raw: response };
  } catch (error) {
    if (error instanceof Error && DOCUMENT_ERRORS.has(error.name)) return null;
    throw error;
  }
};

/**
 * Replays a Textract response recorded with `npm run record-fixtures`, found by the image's
 * SHA-256. Unknown images are treated as unreadable receipts.
 */
export const fromFixture = async (fixturesDir: string, image: Uint8Array, defaultCurrency: string): Promise<Extraction | null> => {
  const text = await readFile(join(fixturesDir, `${sha256(image)}.textract.json`), 'utf8').catch(() => null);
  if (text === null) return null;
  const raw = JSON.parse(text) as Parameters<typeof mapAnalyzeExpense>[0];
  return { normalized: mapAnalyzeExpense(raw, defaultCurrency), raw };
};

/**
 * Reads a receipt image. `EXTRACTOR=textract` calls AWS; `EXTRACTOR=fixture` (the local default)
 * replays recorded responses, so the whole app runs without AWS credentials.
 */
export const extract = (config: Config, textract: TextractClient, image: Uint8Array): Promise<Extraction | null> =>
  config.EXTRACTOR === 'textract'
    ? withTextract(textract, image, config.DEFAULT_CURRENCY)
    : fromFixture(resolve(config.FIXTURES_DIR), image, config.DEFAULT_CURRENCY);
