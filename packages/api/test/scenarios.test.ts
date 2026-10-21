import type { ListTransactionsResponse, ReceiptResponse } from '../src/http/contract';
import {
  money,
  type DecisionType,
  type Employee,
  type ExtractedReceipt,
  type ImageFeatures,
  type LineItem,
  type Money,
  type ParsedDate,
  type Receipt,
  type ReceiptKind,
  type Transaction,
} from '../src/domain';
import { describe, expect, it } from 'vitest';
import { createReceipt } from '../src/functions/receipts/create/handler';
import { decide } from '../src/functions/receipts/decide/handler';
import { listTransactions } from '../src/functions/transactions/list/handler';
import { processReceipt } from '../src/functions/receipts/process/handler';
import { setAnchor } from '../src/functions/receipts/set-anchor/handler';
import type { HttpResult } from '../src/http/responses';
import { createMemory } from './memory';

/**
 * The demo scenarios of SPEC §10 (a company in Buenos Aires with ARS cards), end to end through the
 * Lambda handlers with in-memory functions. Tests run in order and share one world, because
 * duplicates depend on earlier uploads.
 */

const BA = 'America/Argentina/Buenos_Aires';
const ars = (pesos: number) => money(Math.round(pesos * 100), 'ARS');
const f = <T>(value: T | null, confidence = 96) => ({ value, confidence });
const exact = (date: string): ParsedDate => ({ kind: 'exact', date });
const item = (description: string, amount: Money): LineItem => ({ description, amount, confidence: 95 });

const employees: Employee[] = [
  { id: 'emp-juan', name: 'Juan Pérez', department: 'Engineering' },
  { id: 'emp-ana', name: 'Ana Gómez', department: 'Sales' },
];

function tx(t: Partial<Transaction> & Pick<Transaction, 'id' | 'merchantDescriptor' | 'mcc' | 'amount' | 'authorizedAt'>): Transaction {
  return {
    employeeId: 'emp-juan',
    merchantCity: 'Buenos Aires',
    merchantCountry: 'AR',
    merchantTimezone: BA,
    cardPresent: true,
    originalAmount: null,
    receiptId: null,
    ...t,
  };
}

// Local time = UTC-3
const transactions: Transaction[] = [
  tx({ id: 'tx-panera', merchantDescriptor: 'LA PANERA ROSA', mcc: '5814', amount: ars(6_000), authorizedAt: '2026-10-05T11:20:00Z' }),
  tx({ id: 'tx-cafe-martinez', merchantDescriptor: 'CAFE MARTINEZ 112', mcc: '5814', amount: ars(8_400), authorizedAt: '2026-10-13T12:12:00Z' }),
  tx({ id: 'tx-don-julio', merchantDescriptor: 'REST DON JULIO PALERMO', mcc: '5812', amount: ars(93_500), authorizedAt: '2026-10-14T18:20:00Z' }),
  tx({
    id: 'tx-bodega',
    merchantDescriptor: 'LA BODEGA CBA',
    mcc: '5921',
    merchantCity: 'Cordoba',
    merchantTimezone: 'America/Argentina/Cordoba',
    amount: ars(64_000),
    authorizedAt: '2026-10-15T02:40:00Z', // 23:40 on Oct 14 in Córdoba
  }),
  tx({
    id: 'tx-notion',
    merchantDescriptor: 'NOTION.SO',
    mcc: '5734',
    merchantCity: 'San Francisco',
    merchantCountry: 'US',
    merchantTimezone: 'America/Los_Angeles',
    cardPresent: false,
    amount: ars(72_485.5),
    originalAmount: money(4999, 'USD'),
    authorizedAt: '2026-10-15T18:00:00Z',
  }),
  tx({ id: 'tx-uber', merchantDescriptor: 'UBER *TRIP', mcc: '4121', amount: ars(12_000), authorizedAt: '2026-10-15T23:05:00Z' }),
  tx({ id: 'tx-carrefour', merchantDescriptor: 'CARREFOUR EXPRESS 0234', mcc: '5499', amount: ars(12_000), authorizedAt: '2026-10-16T00:30:00Z' }),
  tx({ id: 'tx-preferido', employeeId: 'emp-ana', merchantDescriptor: 'EL PREFERIDO PALERMO', mcc: '5812', amount: ars(112_000), authorizedAt: '2026-10-16T17:10:00Z' }),
];

/** Argentine tickets print only "$", so amounts are read in ARS and flagged as ambiguous. */
function receipt(r: Partial<ExtractedReceipt>): ExtractedReceipt {
  return {
    merchantName: f(null),
    address: f(null),
    city: f(null),
    date: f(null),
    time: f(null),
    subtotal: f(null),
    tax: f(null),
    tip: f(null),
    total: f(null),
    lineItems: [],
    currencyAmbiguous: true,
    ...r,
  };
}

const donJulio = receipt({
  merchantName: f('DON JULIO'),
  address: f('Guatemala 4691, Palermo'),
  city: f('CABA'),
  date: f(exact('2026-10-14')),
  time: f('14:48'),
  subtotal: f(ars(70_247.93)),
  tax: f(ars(14_752.07)),
  total: f(ars(85_000)),
  lineItems: [
    item('Bife de chorizo', ars(42_000)),
    item('Provoleta', ars(14_000)),
    item('Papas fritas', ars(11_000)),
    item('Copa de Malbec', ars(18_000)),
  ],
});

const extractions: Record<string, ExtractedReceipt> = {
  'cafe-martinez': receipt({
    merchantName: f('CAFE MARTINEZ'),
    city: f('CABA'),
    date: f(exact('2026-10-13')),
    time: f('09:10'),
    total: f(ars(8_400)),
    lineItems: [item('Cafe con leche', ars(3_600)), item('Medialunas x3', ars(4_800))],
  }),
  'don-julio': donJulio,
  'don-julio-copy': donJulio,
  notion: receipt({
    merchantName: f('Notion Labs, Inc.'),
    date: f(exact('2026-10-15')),
    total: f(ars(49.99)), // "$49.99", read as ARS until the card charge says otherwise
    lineItems: [item('Plus plan monthly', ars(49.99))],
  }),
  'notion-photo': receipt({
    // The same invoice, printed and photographed: another file, same content.
    merchantName: f('Notion Labs, Inc.'),
    date: f(exact('2026-10-15')),
    total: f(ars(49.99)),
    lineItems: [item('Plus plan monthly', ars(49.99))],
  }),
  carrefour: receipt({
    merchantName: f('CARREFOUR EXPRESS'),
    city: f('CABA'),
    date: f(exact('2026-10-15')),
    time: f('21:28'),
    total: f(ars(12_000)),
    lineItems: [item('Agua mineral', ars(1_800)), item('Alfajores', ars(3_200)), item('Sandwich de miga', ars(7_000))],
  }),
  'bodega-fake': receipt({
    // Textract missed vendor and address; the mapper recovered them from the printed lines.
    merchantName: f('LA BODEGA', 75),
    address: f('Av. Santa Fe 1860, Recoleta', 75),
    city: f('CABA', 75),
    date: f(exact('2026-10-14')),
    time: f('13:05'),
    subtotal: f(ars(52_892.56)),
    tax: f(ars(11_107.44)),
    total: f(ars(64_000)),
    lineItems: [
      item('Milanesa napolitana', ars(24_000)),
      item('Empanadas x6', ars(18_000)),
      item('Ensalada mixta', ars(9_000)),
      item('Flan con dulce de leche', ars(9_000)),
      item('Agua sin gas', ars(4_000)),
    ],
  }),
  'preferido-edited': receipt({
    merchantName: f('EL PREFERIDO DE PALERMO'),
    city: f('CABA'),
    date: f(exact('2026-10-16')),
    time: f('13:40'),
    total: f(ars(112_000)),
    lineItems: [item('Menu del dia', ars(60_000)), item('Agua sin gas', ars(18_000))],
  }),
  taxi: receipt({ merchantName: f('RADIO TAXI PREMIUM'), date: f(exact('2026-10-16')), total: f(ars(18_000)), lineItems: [item('Viaje', ars(18_000))] }),
  zara: receipt({ merchantName: f('ZARA UNICENTER'), date: f(exact('2026-10-14')), total: f(ars(210_000)) }),
  'panera-ambiguous': receipt({
    merchantName: f('LA PANERA ROSA'),
    date: f({ kind: 'ambiguous', options: ['2026-10-05', '2026-05-10'] }),
    total: f(ars(6_000)),
  }),
};

const photo = (sha256: string, dhash: string): ImageFeatures => ({ sha256, dhash, meta: { format: 'jpeg', make: 'Apple', model: 'iPhone 16' } });
const images: Record<string, ImageFeatures> = {
  'cafe-martinez': photo('sha-cafe-martinez', '1111111111111111'),
  'don-julio': photo('sha-don-julio', 'f0f0f0f0f0f0f0f0'),
  'don-julio-copy': photo('sha-don-julio-copy', 'f0f0f0f0f0f0f0f7'), // 3 bits differ
  notion: { sha256: 'sha-notion', dhash: null, meta: { format: 'pdf' } },
  'notion-photo': photo('sha-notion-photo', '9999999999999999'),
  carrefour: photo('sha-carrefour', '2222222222222222'),
  'bodega-fake': { sha256: 'sha-bodega', dhash: '3333333333333333', meta: { format: 'png' } },
  'preferido-edited': { sha256: 'sha-preferido', dhash: '4444444444444444', meta: { format: 'jpeg', software: 'Adobe Photoshop 26.0' } },
  taxi: photo('sha-taxi', '5555555555555555'),
  zara: photo('sha-zara', '6666666666666666'),
  'panera-ambiguous': photo('sha-panera', '7777777777777777'),
  unreadable: photo('sha-blurry', '8888888888888888'),
};

const memory = createMemory({ employees, transactions, extractions, images });
const { deps } = memory;
const bodyOf = <T>(result: HttpResult) => result.body as T;

/** The handlers, called the way their Lambdas call them, returning the receipt or the list. */
const api = {
  createReceipt: async (body: { employeeId: string; kind: ReceiptKind; mimeType: string; size: number }) =>
    bodyOf<{ receipt: Receipt }>(await createReceipt(deps)({ body: body as never })).receipt,
  processReceipt: async (id: string) => bodyOf<ReceiptResponse>(await processReceipt(deps)({ params: { id } })).receipt,
  setAnchor: async (id: string, transactionId: string) =>
    bodyOf<ReceiptResponse>(await setAnchor(deps)({ params: { id }, body: { transactionId } })).receipt,
  decide: async (id: string, body: { decision: DecisionType; note?: string }) =>
    bodyOf<ReceiptResponse>(await decide(deps)({ params: { id }, body })).receipt,
  listTransactions: async () => bodyOf<ListTransactionsResponse>(await listTransactions(deps)({ query: { filter: 'all' } })).transactions,
};

async function submit(label: string, employeeId = 'emp-juan', kind: ReceiptKind = 'card') {
  const created = await api.createReceipt({ employeeId, kind, mimeType: 'image/jpeg', size: 1000 });
  memory.upload(created.id, label);
  return api.processReceipt(created.id);
}

const codes = (r: { signals: { code: string }[] }) => r.signals.map((s) => s.code);

describe('demo scenarios, end to end', () => {
  it('1. exact match → suggested, low risk', async () => {
    const r = await submit('cafe-martinez');
    expect(r.match?.outcome).toBe('suggested');
    expect(r.anchorTransactionId).toBe('tx-cafe-martinez');
    expect(r.risk?.level).toBe('low');
    expect(r.currency).toEqual({ code: 'ARS', readAs: 'ARS', resolution: 'company_default' });
    expect(memory.rawExtractions.has(r.id)).toBe(true);
  });

  it('2. 10% tip on the card → suggested, low risk', async () => {
    const r = await submit('don-julio');
    expect(r.anchorTransactionId).toBe('tx-don-julio');
    expect(r.match?.candidates[0]?.signals.amount?.reason).toBe('Charge is 10% above the receipt, consistent with a tip');
    expect(r.signals).toEqual([]);
    expect(r.risk?.level).toBe('low');
  });

  it('3. US invoice printing only "$" → read as USD from the card charge, low risk', async () => {
    const r = await submit('notion');
    expect(r.anchorTransactionId).toBe('tx-notion');
    expect(r.currency).toEqual({ code: 'USD', readAs: 'ARS', resolution: 'inferred_from_transaction' });
    expect(r.extraction?.total.value).toEqual(money(4999, 'USD'));
    expect(r.risk?.level).toBe('low');
  });

  it('4. same amount, same day → the merchant picks Carrefour over Uber', async () => {
    const r = await submit('carrefour');
    expect(r.match?.outcome).toBe('suggested');
    expect(r.anchorTransactionId).toBe('tx-carrefour');
    expect(r.risk?.level).toBe('low');
  });

  it('5. generated receipt copied from the statement → suggested, high risk', async () => {
    const r = await submit('bodega-fake');
    expect(r.anchorTransactionId).toBe('tx-bodega');
    expect(codes(r)).toEqual(['CATEGORY_MISMATCH', 'TIME_MISMATCH', 'CITY_MISMATCH', 'NO_CAMERA_METADATA']);
    expect(r.risk?.level).toBe('high');
  });

  it('6. edited total → medium risk', async () => {
    const r = await submit('preferido-edited', 'emp-ana');
    expect(r.anchorTransactionId).toBe('tx-preferido');
    expect(codes(r)).toEqual(['ARITHMETIC_LINE_ITEMS', 'EDITING_SOFTWARE']);
    expect(r.risk?.level).toBe('medium');
  });

  it("7. another employee submits a re-cropped copy of Juan's receipt → high risk", async () => {
    const r = await submit('don-julio-copy', 'emp-ana');
    expect(r.match?.outcome).toBe('no_match'); // Ana has no such charge
    expect(codes(r)).toEqual(['DUPLICATE_IMAGE']);
    expect(r.signals[0]?.explanation).toContain('Juan Pérez');
    expect(r.risk?.level).toBe('high');
  });

  it('8. card receipt resubmitted as a reimbursement → double dipping', async () => {
    const r = await submit('cafe-martinez', 'emp-juan', 'reimbursement');
    expect(r.match).toBeNull();
    expect(codes(r)).toEqual(['DOUBLE_DIPPING']);
    expect(r.risk?.level).toBe('high');
  });

  it('9. reimbursement under the ARS review threshold → low risk', async () => {
    const r = await submit('taxi', 'emp-juan', 'reimbursement');
    expect(r.signals).toEqual([]);
    expect(r.risk?.level).toBe('low');
  });

  it('10. nothing explains the amount → no match, medium risk until a transaction is assigned', async () => {
    const r = await submit('zara');
    expect(r.match?.outcome).toBe('no_match');
    expect(r.anchorTransactionId).toBeNull();
    expect(r.risk?.level).toBe('medium');
  });
});

describe('date ambiguity', () => {
  it('resolves 05/10 to 5 October because that reading has a matching charge', async () => {
    const r = await submit('panera-ambiguous');
    expect(r.date).toMatchObject({ date: '2026-10-05', resolution: 'inferred_from_transactions' });
    expect(r.anchorTransactionId).toBe('tx-panera');
    expect(r.match?.candidates[0]?.signals.date?.weight).toBe(0);
  });
});

describe('unreadable receipts', () => {
  it('are kept for manual assignment with medium risk', async () => {
    const r = await submit('unreadable');
    expect(r.extractionStatus).toBe('failed');
    expect(codes(r)).toEqual(['UNREADABLE_RECEIPT']);
    expect(r.risk?.level).toBe('medium');

    const assigned = await api.setAnchor(r.id, 'tx-uber');
    expect(assigned.anchorTransactionId).toBe('tx-uber');
  });

  it('are still checked for duplicates through their image', async () => {
    const r = await submit('unreadable', 'emp-ana', 'reimbursement');
    expect(codes(r)).toEqual(['DOUBLE_DIPPING', 'UNREADABLE_RECEIPT']);
    expect(r.risk?.level).toBe('high');
  });
});

describe('review and decisions', () => {
  const idOf = async (txId: string) => (await api.listTransactions()).find((t) => t.id === txId)!.linkedReceiptId!;

  it('lists suggested receipts as pending review on their transaction', async () => {
    const views = await api.listTransactions();
    expect(views.find((v) => v.id === 'tx-bodega')).toMatchObject({ receiptStatus: 'pending_review', riskLevel: 'high' });
    expect(views[0]?.id).toBe('tx-preferido'); // newest first
  });

  it('requires a note to approve a high-risk receipt', async () => {
    const id = await idOf('tx-bodega');
    await expect(api.decide(id, { decision: 'approved' })).rejects.toMatchObject({ code: 'NOTE_REQUIRED' });
    const approved = await api.decide(id, { decision: 'approved', note: 'Team dinner, confirmed with the employee' });
    expect(approved.status).toBe('approved');
    expect(memory.transactions.get('tx-bodega')?.receiptId).toBe(id);
    expect(memory.decisions.at(-1)).toMatchObject({ riskLevelAtDecision: 'high', note: 'Team dinner, confirmed with the employee' });
  });

  it('approves a low-risk receipt without a note and links the transaction', async () => {
    const id = await idOf('tx-cafe-martinez');
    await api.decide(id, { decision: 'approved' });
    const view = (await api.listTransactions()).find((t) => t.id === 'tx-cafe-martinez');
    expect(view).toMatchObject({ receiptStatus: 'approved', riskLevel: 'low' });
  });

  it('re-decides the currency when the user picks another transaction', async () => {
    const r = await submit('notion');
    // The earlier Notion receipt still holds tx-notion as pending; this copy has no anchor yet.
    const pesos = await api.setAnchor(r.id, 'tx-uber');
    expect(pesos.currency?.resolution).toBe('company_default');
    expect(pesos.extraction?.total.value).toEqual(ars(49.99));
    expect(codes(pesos)).toContain('AMOUNT_MISMATCH');
  });

  it('never links a transaction to two receipts', async () => {
    const r = await submit('zara');
    await expect(api.setAnchor(r.id, 'tx-cafe-martinez')).rejects.toMatchObject({ code: 'TRANSACTION_ALREADY_MATCHED' });
  });

  it("rejects assigning another employee's transaction", async () => {
    const r = await submit('zara');
    await expect(api.setAnchor(r.id, 'tx-preferido')).rejects.toMatchObject({ code: 'TRANSACTION_NOT_ELIGIBLE' });
  });

  it('requires a transaction before approving a card receipt', async () => {
    const r = await submit('zara');
    await expect(api.decide(r.id, { decision: 'approved' })).rejects.toMatchObject({ code: 'ANCHOR_REQUIRED' });
    expect((await api.decide(r.id, { decision: 'rejected' })).status).toBe('rejected');
  });

  it('cannot decide twice', async () => {
    const id = memory.decisions[0]!.receiptId;
    await expect(api.decide(id, { decision: 'rejected' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('validates uploads', async () => {
    await expect(api.createReceipt({ employeeId: 'emp-juan', kind: 'card', mimeType: 'image/gif', size: 10 })).rejects.toMatchObject({
      code: 'UNSUPPORTED_FILE_TYPE',
    });
    await expect(
      api.createReceipt({ employeeId: 'emp-juan', kind: 'card', mimeType: 'image/png', size: 6 * 1024 * 1024 }),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    await expect(api.createReceipt({ employeeId: 'emp-nobody', kind: 'card', mimeType: 'image/png', size: 10 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('duplicates and processing, under real-world conditions', () => {
  /** A fresh world per test, so earlier scenarios don't leave receipts behind. */
  const fresh = () => {
    const world = createMemory({ employees, transactions, extractions, images });
    const create = async (label: string, employeeId = 'emp-juan', kind: ReceiptKind = 'card') => {
      const { receipt } = (await createReceipt(world.deps)({ body: { employeeId, kind, mimeType: 'image/jpeg', size: 1000 } })).body as {
        receipt: Receipt;
      };
      world.upload(receipt.id, label);
      return receipt.id;
    };
    const process = async (id: string) => bodyOf<ReceiptResponse>(await processReceipt(world.deps)({ params: { id } })).receipt;
    return { world, create, process, submit: async (label: string, employeeId?: string) => process(await create(label, employeeId)) };
  };

  it('finds a second photo of a "$" invoice by content, in the currency the card charge settled', async () => {
    const { submit } = fresh();
    const first = await submit('notion');
    expect(first.currency?.code).toBe('USD');

    const photo = await submit('notion-photo');
    expect(photo.currency?.code).toBe('USD');
    expect(codes(photo)).toContain('DUPLICATE_CONTENT');
  });

  it('flags both receipts when the same image is uploaded twice at the same moment', async () => {
    const { create, process } = fresh();
    const ids = [await create('don-julio', 'emp-juan'), await create('don-julio', 'emp-ana')];

    const [juan, ana] = await Promise.all(ids.map(process));

    expect(codes(juan!)).toContain('DUPLICATE_EXACT');
    expect(codes(ana!)).toContain('DUPLICATE_EXACT');
  });

  it('processes a receipt once, even when /process is called twice at the same time', async () => {
    const { create, process } = fresh();
    const id = await create('cafe-martinez');

    const results = await Promise.allSettled([process(id), process(id)]);

    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { code: 'INVALID_STATE' } });
  });

  it('keeps the receipt retryable when the extractor is down, instead of marking it unreadable', async () => {
    const { world, create, process } = fresh();
    const id = await create('cafe-martinez');

    world.setExtractorDown(true);
    await expect(process(id)).rejects.toMatchObject({ code: 'EXTRACTION_UNAVAILABLE' });
    expect(world.receipts.get(id)).toMatchObject({ status: 'uploading', extractionStatus: 'pending' });

    world.setExtractorDown(false);
    const retried = await process(id);
    expect(retried).toMatchObject({ status: 'pending_review', extractionStatus: 'succeeded', anchorTransactionId: 'tx-cafe-martinez' });
  });
});
