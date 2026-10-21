/**
 * Runs real Textract AnalyzeExpense on every image in fixtures/receipts and compares the mapped
 * result with the current fixture (synthetic or previously recorded).
 *
 *   AWS_PROFILE=... npm run record-fixtures              # compare only, writes nothing
 *   AWS_PROFILE=... npm run record-fixtures -- --write   # replace fixtures with real responses
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { TextractClient } from '@aws-sdk/client-textract';
import type { ExtractedReceipt } from '../src/domain';
import { sha256, withTextract } from '../src/receipt-reading/extract';
import { mapAnalyzeExpense } from '../src/receipt-reading/textract-mapper';

const DIR = resolve(import.meta.dirname, '../../../fixtures/receipts');
const write = process.argv.includes('--write');
const currency = process.env.DEFAULT_CURRENCY ?? 'ARS';
const textract = new TextractClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

/** The fields the matcher and the checks depend on, as comparable strings. */
function summary(r: ExtractedReceipt): Record<string, string> {
  const money = (m: { amountMinor: number; currency: string } | null) => (m ? `${m.amountMinor} ${m.currency}` : '—');
  const date = r.date.value ? (r.date.value.kind === 'exact' ? r.date.value.date : `ambiguous ${r.date.value.options.join('|')}`) : '—';
  return {
    merchant: r.merchantName.value ?? '—',
    city: r.city.value ?? '—',
    address: r.address.value ?? '—',
    date,
    time: r.time.value ?? '—',
    subtotal: money(r.subtotal.value),
    tax: money(r.tax.value),
    tip: money(r.tip.value),
    total: money(r.total.value),
    items: r.lineItems.map((li) => `${li.description}=${money(li.amount)}`).join('; ') || '—',
  };
}

const files = (await readdir(DIR)).filter((f) => /\.(jpe?g|png|pdf)$/i.test(f)).sort();
let differences = 0;

for (const file of files) {
  const bytes = new Uint8Array(await readFile(join(DIR, file)));
  const fixturePath = join(DIR, `${sha256(bytes)}.textract.json`);
  const current = await readFile(fixturePath, 'utf8').then((s) => mapAnalyzeExpense(JSON.parse(s), currency)).catch(() => null);

  const extraction = await withTextract(textract, bytes, currency);
  if (!extraction) {
    console.log(`\n${file}  ✗ Textract could not read this document`);
    continue;
  }
  const { normalized, raw } = extraction;
  const real = summary(normalized);
  const expected = current ? summary(current) : null;

  const diffs = Object.keys(real).filter((k) => !expected || expected[k] !== real[k]);
  differences += diffs.length;
  console.log(`\n${file}${diffs.length === 0 ? '  ✓ matches the fixture' : ''}`);
  for (const k of diffs) console.log(`  ${k.padEnd(8)} fixture: ${expected?.[k] ?? '(none)'}\n  ${''.padEnd(8)} textract: ${real[k]}`);

  if (write) await writeFile(fixturePath, `${JSON.stringify(raw, null, 2)}\n`);
}

console.log(`\n${files.length} images, ${differences} field differences.${write ? ' Fixtures replaced with real Textract responses.' : ' Nothing written (use --write).'}`);
