/**
 * Generates the demo receipts (SPEC §10) as images, plus a SYNTHETIC Textract AnalyzeExpense
 * response for each, saved as fixtures/receipts/<sha256>.textract.json. The fixture extractor
 * then runs the whole demo without AWS.
 *
 * The synthetic responses mirror what Textract returns for these images; replace them with real
 * ones with `npm run record-fixtures` (requires AWS credentials).
 *
 *   npm run demo-receipts -w @receipt-match/api
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Jimp, loadFont } from 'jimp';
import { SANS_14_BLACK, SANS_16_BLACK, SANS_32_BLACK } from 'jimp/fonts';
import { dhashFromGrayscale, hammingDistance } from '../src/domain';

const OUT = resolve(import.meta.dirname, '../../../fixtures/receipts');

type Item = [description: string, price: string];

type DemoReceipt = {
  file: string;
  scenario: string;
  merchant: string;
  address: string;
  city: string;
  date: string;
  time: string;
  items: Item[];
  subtotal?: string;
  tax?: string;
  tip?: string;
  total: string;
  /** Label of the tax line ('IVA 21%' unless given). */
  taxLabel?: string;
  /** Printed accent: a header band, so different receipts don't look alike to the perceptual hash. */
  band: number;
};

const receipts: DemoReceipt[] = [
  {
    file: '01-cafe-martinez.jpg',
    scenario: '1. Exact match → suggested, low risk',
    merchant: 'CAFE MARTINEZ',
    address: 'Av. Corrientes 1234',
    city: 'CABA',
    date: '13/10/2026',
    time: '09:10',
    items: [['Cafe con leche', '3.600,00'], ['Medialunas x3', '4.800,00']],
    total: '8.400,00',
    band: 0x5a3a22ff,
  },
  {
    file: '02-don-julio.jpg',
    scenario: '2. 10% tip on the card → suggested, low risk',
    merchant: 'DON JULIO',
    address: 'Guatemala 4691, Palermo',
    city: 'CABA',
    date: '14/10/2026',
    time: '14:48',
    items: [['Bife de chorizo', '42.000,00'], ['Provoleta', '14.000,00'], ['Papas fritas', '11.000,00'], ['Copa de Malbec', '18.000,00']],
    subtotal: '70.247,93',
    tax: '14.752,07',
    total: '85.000,00',
    band: 0x7a1f1fff,
  },
  {
    file: '03-notion-invoice.png',
    scenario: '3. US invoice printing only "$" → read as USD from the card charge, suggested, low risk',
    merchant: 'Notion Labs, Inc.',
    address: '2300 Harrison St',
    city: 'San Francisco',
    date: 'Oct 15, 2026',
    time: '',
    items: [['Plus plan - monthly', '49.99']],
    total: '49.99',
    taxLabel: 'Tax',
    band: 0x111111ff,
  },
  {
    file: '04-carrefour-express.jpg',
    scenario: '4. Same amount and day as an Uber ride → the merchant breaks the tie',
    merchant: 'CARREFOUR EXPRESS',
    address: 'Av. Santa Fe 2450',
    city: 'CABA',
    date: '15/10/2026',
    time: '21:28',
    items: [['Agua mineral', '1.800,00'], ['Alfajores', '3.200,00'], ['Sandwich de miga', '7.000,00']],
    total: '12.000,00',
    band: 0x1e5bc6ff,
  },
  {
    file: '05-la-bodega-generated.png',
    scenario: '5. Generated receipt copied from the statement → matches, high risk (category, time, city)',
    merchant: 'LA BODEGA',
    address: 'Av. Santa Fe 1860, Recoleta',
    city: 'CABA',
    date: '14/10/2026',
    time: '13:05',
    items: [['Milanesa napolitana', '24.000,00'], ['Empanadas x6', '18.000,00'], ['Ensalada mixta', '9.000,00'], ['Flan con dulce de leche', '9.000,00'], ['Agua sin gas', '4.000,00']],
    subtotal: '52.892,56',
    tax: '11.107,44',
    total: '64.000,00',
    band: 0x8b4513ff,
  },
  {
    file: '06-el-preferido-edited.jpg',
    scenario: '6. Edited total: items no longer add up → medium risk (upload as Ana)',
    merchant: 'EL PREFERIDO DE PALERMO',
    address: 'Jorge Luis Borges 2108, Palermo',
    city: 'CABA',
    date: '16/10/2026',
    time: '13:40',
    items: [['Menu del dia', '60.000,00'], ['Agua sin gas', '18.000,00']],
    total: '112.000,00',
    band: 0x333333ff,
  },
  {
    file: '09-radio-taxi.jpg',
    scenario: '9. Reimbursement under the review threshold → low risk (upload as reimbursement)',
    merchant: 'RADIO TAXI PREMIUM',
    address: 'Av. del Libertador 5000',
    city: 'CABA',
    date: '16/10/2026',
    time: '19:30',
    items: [['Viaje', '18.000,00']],
    total: '18.000,00',
    band: 0xf2c200ff,
  },
  {
    file: '10-zara.jpg',
    scenario: '10. No transaction explains the amount → no match',
    merchant: 'ZARA UNICENTER',
    address: 'Parana 3745, Martinez',
    city: 'Buenos Aires',
    date: '14/10/2026',
    time: '17:20',
    items: [['Camisa', '70.000,00'], ['Pantalon', '140.000,00']],
    total: '210.000,00',
    band: 0x000000ff,
  },
  {
    file: '11-la-panera-rosa.jpg',
    scenario: 'Ambiguous date 05/10/2026 (5 Oct or 10 May) → resolved from the card charges',
    merchant: 'LA PANERA ROSA',
    address: 'Av. Cabildo 1900, Belgrano',
    city: 'CABA',
    date: '05/10/2026',
    time: '08:15',
    items: [['Cafe con tostado', '6.000,00']],
    total: '6.000,00',
    band: 0xe7a1b0ff,
  },
];

const ORIGINAL = '02-don-julio.jpg';
const COPY = '07-don-julio-copy.jpg';

const WIDTH = 460;

async function render(r: DemoReceipt) {
  const [title, body, small] = await Promise.all([loadFont(SANS_32_BLACK), loadFont(SANS_16_BLACK), loadFont(SANS_14_BLACK)]);
  const lines = 9 + r.items.length + (r.subtotal ? 1 : 0) + (r.tax ? 1 : 0);
  const height = 150 + lines * 26;
  const img = new Jimp({ width: WIDTH, height, color: 0xffffffff });

  // Header band in the merchant's colour.
  for (let y = 0; y < 18; y++) for (let x = 0; x < WIDTH; x++) img.setPixelColor(r.band, x, y);

  let y = 32;
  img.print({ font: r.merchant.length > 16 ? body : title, x: 24, y, text: r.merchant });
  y += r.merchant.length > 16 ? 30 : 46;
  img.print({ font: small, x: 24, y, text: r.address });
  y += 22;
  img.print({ font: small, x: 24, y, text: r.city });
  y += 34;
  img.print({ font: body, x: 24, y, text: `Fecha: ${r.date}${r.time ? `   Hora: ${r.time}` : ''}` });
  y += 34;

  const row = (label: string, value: string, font = body) => {
    img.print({ font, x: 24, y, text: label });
    img.print({ font, x: WIDTH - 24 - value.length * 9, y, text: value });
    y += 26;
  };
  for (const [description, price] of r.items) row(description, price);
  y += 8;
  for (let x = 24; x < WIDTH - 24; x += 2) img.setPixelColor(0x999999ff, x, y);
  y += 14;
  if (r.subtotal) row('Subtotal', r.subtotal);
  if (r.tax) row(r.taxLabel ?? 'IVA 21%', r.tax);
  // Like most receipts, the total shows only "$": no currency code.
  row('TOTAL', `$ ${r.total}`);
  y += 20;
  img.print({ font: small, x: 24, y, text: 'Gracias por su visita' });

  return img;
}

/** The AnalyzeExpense response Textract would give for the rendered receipt (synthetic). */
function textract(r: DemoReceipt) {
  const field = (type: string, text: string, confidence = 97, currency?: string) => ({
    Type: { Text: type, Confidence: 99 },
    ValueDetection: { Text: text, Confidence: confidence },
    ...(currency && { Currency: { Code: currency } }),
  });
  // Textract reports USD for any "$", so the synthetic response does too.
  const currency = 'USD';
  return {
    _synthetic: 'Generated by scripts/make-demo-receipts.ts. Replace with `npm run record-fixtures`.',
    ExpenseDocuments: [
      {
        SummaryFields: [
          field('VENDOR_NAME', r.merchant, 98),
          field('ADDRESS', r.address, 93),
          field('CITY', r.city, 91),
          field('INVOICE_RECEIPT_DATE', r.date, 98),
          ...(r.subtotal ? [field('SUBTOTAL', r.subtotal, 96, currency)] : []),
          ...(r.tax ? [field('TAX', r.tax, 95, currency)] : []),
          ...(r.tip ? [field('GRATUITY', r.tip, 94, currency)] : []),
          field('TOTAL', `$ ${r.total}`, 98, currency),
        ],
        LineItemGroups: [
          {
            LineItems: r.items.map(([item, price]) => ({
              LineItemExpenseFields: [field('ITEM', item, 95), field('PRICE', price, 96, currency)],
            })),
          },
        ],
        Blocks: [{ BlockType: 'LINE', Text: `Fecha: ${r.date}${r.time ? `   Hora: ${r.time}` : ''}`, Confidence: 97 }],
      },
    ],
  };
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function dhashOf(bytes: Buffer) {
  const img = await Jimp.fromBuffer(bytes);
  img.resize({ w: 9, h: 8 }).greyscale();
  return dhashFromGrayscale(Array.from({ length: 72 }, (_, i) => img.bitmap.data[i * 4]!));
}

async function save(file: string, bytes: Buffer, response: object) {
  await writeFile(join(OUT, file), bytes);
  await writeFile(join(OUT, `${sha256(bytes)}.textract.json`), `${JSON.stringify(response, null, 2)}\n`);
}

await mkdir(OUT, { recursive: true });
for (const f of await readdir(OUT)) if (/\.(jpg|png|json)$/.test(f)) await rm(join(OUT, f));

const hashes: [file: string, dhash: string, total: string][] = [];
for (const r of receipts) {
  const img = await render(r);
  const bytes = r.file.endsWith('.png') ? await img.getBuffer('image/png') : await img.getBuffer('image/jpeg', { quality: 88 });
  await save(r.file, bytes, textract(r));
  const total = r.total;
  hashes.push([r.file, await dhashOf(bytes), total]);

  // Scenario 7: the same paper receipt, re-cropped and recompressed (another employee resubmits it).
  if (r.file === ORIGINAL) {
    const copy = (await Jimp.fromBuffer(bytes)).crop({ x: 6, y: 4, w: img.width - 12, h: img.height - 8 });
    const copyBytes = await copy.getBuffer('image/jpeg', { quality: 70 });
    await save(COPY, copyBytes, textract(r));
    hashes.push([COPY, await dhashOf(copyBytes), total]);
  }
}

// A 64-bit dHash is coarse for documents, so different receipts may land a few bits apart. The
// duplicate check only trusts a near-identical image when the totals agree, so what must never
// happen is a near-identical image AND the same total on two different receipts.
let ok = true;
for (let i = 0; i < hashes.length; i++) {
  for (let j = i + 1; j < hashes.length; j++) {
    const [a, ha, ta] = hashes[i]!;
    const [b, hb, tb] = hashes[j]!;
    const d = hammingDistance(ha, hb);
    const expectedDuplicate = [a, b].sort().join() === [ORIGINAL, COPY].sort().join();
    if (expectedDuplicate) {
      console.log(`Scenario 7 copy: dHash distance ${d} bits`);
      if (d > 6) ok = false;
    } else if (d <= 6 && ta === tb) {
      ok = false;
      console.warn(`False duplicate: ${a} ↔ ${b} (dHash distance ${d}, same total ${ta})`);
    }
  }
}

const readme = [
  '# Demo receipts',
  '',
  'Generated by `packages/api/scripts/make-demo-receipts.ts`. Each image has a matching `<sha256>.textract.json`,',
  'the AnalyzeExpense response the fixture extractor replays (`EXTRACTOR=fixture`), so the demo runs without AWS.',
  '',
  'The committed responses are **real Textract output**, recorded with `npm run record-fixtures -- --write`.',
  'Regenerating the images writes synthetic responses; record again afterwards.',
  '',
  '| File | Upload as | Scenario |',
  '|---|---|---|',
  ...receipts.map((r) => `| \`${r.file}\` | ${r.file.startsWith('06') ? 'Ana Gómez, card' : r.file.startsWith('09') ? 'Juan Pérez, reimbursement' : 'Juan Pérez, card'} | ${r.scenario} |`),
  `| \`${COPY}\` | Ana Gómez, card | 7. Re-cropped copy of Juan's receipt → duplicate image, high risk |`,
  '| `01-cafe-martinez.jpg` (again) | Juan Pérez, reimbursement | 8. Card receipt resubmitted as a reimbursement → double dipping, high risk |',
  '',
].join('\n');
await writeFile(join(OUT, 'README.md'), readme);

console.log(`Wrote ${hashes.length} receipts to ${OUT}${ok ? '' : ' (with dHash warnings)'}`);
if (!ok) process.exitCode = 1;
