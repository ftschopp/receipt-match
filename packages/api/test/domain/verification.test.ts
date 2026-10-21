import { describe, expect, it } from 'vitest';
import { matchReceipt } from '../../src/domain/matching/match';
import { money } from '../../src/domain/money';
import type { ExtractedReceipt, LineItem, Money, ResolvedDate, Transaction } from '../../src/domain/types';
import { classifyLineItem, classifyReceipt } from '../../src/domain/verification/classify';
import { compareCities } from '../../src/domain/verification/cities';
import { defaultVerificationConfig } from '../../src/domain/verification/config';
import { contentKey, dhashBands, dhashFromGrayscale, hammingDistance } from '../../src/domain/verification/fingerprint';
import { assessRisk } from '../../src/domain/verification/risk';
import type { RelatedReceipt, Signal, VerificationInput } from '../../src/domain/verification/types';
import { verifyReceipt } from '../../src/domain/verification/verify';

const MX = 'America/Mexico_City'; // UTC-6, no DST
const mxn = (pesos: number) => money(Math.round(pesos * 100), 'MXN');
const field = <T>(value: T | null, confidence = 95) => ({ value, confidence });
const item = (description: string, pesos?: number): LineItem => ({
  description,
  amount: pesos === undefined ? null : mxn(pesos),
  confidence: 95,
});

function extraction(overrides: Partial<ExtractedReceipt> = {}): ExtractedReceipt {
  return {
    merchantName: field(null),
    address: field(null),
    city: field(null),
    date: field(null),
    time: field(null),
    subtotal: field(null),
    tax: field(null),
    tip: field(null),
    total: field(null),
    lineItems: [],
    ...overrides,
  };
}

function tx(overrides: Partial<Transaction> & Pick<Transaction, 'id' | 'merchantDescriptor' | 'amount' | 'authorizedAt'>): Transaction {
  return {
    employeeId: 'emp-juan',
    mcc: '5812',
    merchantCity: 'Mexico City',
    merchantCountry: 'MX',
    merchantTimezone: MX,
    cardPresent: true,
    originalAmount: null,
    receiptId: null,
    ...overrides,
  };
}

const printed = (date: string): ResolvedDate => ({ date, resolution: 'printed', confidence: 99 });

function input(overrides: Partial<VerificationInput> = {}): VerificationInput {
  return {
    receiptId: 'rcpt-new',
    employeeId: 'emp-juan',
    kind: 'card',
    extraction: extraction(),
    date: null,
    anchor: null,
    match: null,
    image: { sha256: 'sha-new', dhash: 'f0f0f0f0f0f0f0f0', meta: { format: 'jpeg', make: 'Apple', model: 'iPhone 16' } },
    related: [],
    ...overrides,
  };
}

const codes = (signals: Signal[]) => signals.map((s) => s.code);

// Anchor transactions
const docena = tx({ id: 'tx-docena', merchantDescriptor: 'REST LA DOCENA CDMX', amount: mxn(1667.5), authorizedAt: '2026-10-14T21:20:00Z' }); // 15:20 local
const bodega = tx({
  id: 'tx-bodega',
  merchantDescriptor: 'LA BODEGA GDL',
  mcc: '5921',
  merchantCity: 'Guadalajara',
  amount: mxn(1450),
  authorizedAt: '2026-10-15T05:40:00Z', // 23:40 local on Oct 14
});

const docenaReceipt = extraction({
  merchantName: field('La Docena Oyster Bar'),
  address: field('Av. Álvaro Obregón 31, Roma Norte'),
  city: field('Ciudad de México'),
  date: field({ kind: 'exact', date: '2026-10-14' }),
  time: field('14:48'),
  subtotal: field(mxn(1250)),
  tax: field(mxn(200)),
  total: field(mxn(1450)),
  lineItems: [item('Ostiones preparados', 520), item('Tostada de atún', 380), item('Agua de jamaica', 150), item('Pescado zarandeado', 200)],
});

describe('demo scenarios (SPEC §10)', () => {
  it('2. genuine receipt with a tip: low risk', () => {
    const { signals, risk } = verifyReceipt(input({ extraction: docenaReceipt, date: printed('2026-10-14'), anchor: docena }));
    expect(signals).toEqual([]);
    expect(risk.level).toBe('low');
  });

  it('5. generated receipt copied from the statement: matches, but the anchor disagrees', () => {
    const fake = extraction({
      merchantName: field('La Bodega'),
      address: field('Av. Presidente Masaryk 123, Polanco, Ciudad de México'),
      city: field('Polanco'),
      date: field({ kind: 'exact', date: '2026-10-14' }),
      time: field('13:05'),
      subtotal: field(mxn(1250)),
      tax: field(mxn(200)),
      total: field(mxn(1450)),
      lineItems: [item('Tacos al pastor (4)', 420), item('Guacamole', 280), item('Arrachera', 550), item('Agua de jamaica', 200)],
    });

    // The receipt copies merchant, amount and date from the statement, so it matches cleanly...
    const match = matchReceipt(
      { merchantName: fake.merchantName, total: fake.total, tip: fake.tip, date: printed('2026-10-14') },
      [docena, bodega],
    );
    expect(match.outcome).toBe('suggested');
    expect(match.candidates[0]?.transactionId).toBe('tx-bodega');

    // ...but category, time and city disagree with what the card network recorded.
    const { signals, risk } = verifyReceipt(input({ extraction: fake, date: printed('2026-10-14'), anchor: bodega, match }));
    expect(codes(signals)).toEqual(['CATEGORY_MISMATCH', 'TIME_MISMATCH', 'CITY_MISMATCH']);
    expect(signals.every((s) => s.severity === 'strong')).toBe(true);
    expect(signals[0]?.explanation).toContain('MCC 5921 (liquor store)');
    expect(signals[1]?.explanation).toContain('card authorized at 23:40');
    expect(risk.level).toBe('high');
  });

  it('6. edited total: line items no longer add up', () => {
    const edited = extraction({
      ...docenaReceipt,
      subtotal: field(null),
      tax: field(null),
      total: field(mxn(1667.5)),
      lineItems: [item('Ostiones preparados', 520), item('Tostada de atún', 380), item('Agua de jamaica', 280)],
    });
    const { signals, risk } = verifyReceipt(
      input({
        extraction: edited,
        date: printed('2026-10-14'),
        anchor: docena,
        image: { sha256: 'sha-edited', dhash: null, meta: { format: 'jpeg', software: 'Adobe Photoshop 26.0' } },
      }),
    );
    expect(codes(signals)).toEqual(['ARITHMETIC_LINE_ITEMS', 'EDITING_SOFTWARE']);
    expect(risk.level).toBe('medium');
  });

  it('7. same receipt image submitted by another employee', () => {
    const related: RelatedReceipt = {
      id: 'rcpt-ana',
      employeeId: 'emp-ana',
      employeeName: 'Ana Gómez',
      kind: 'card',
      uploadedAt: '2026-10-15T10:00:00Z',
      sha256: 'sha-other',
      dhash: 'f0f0f0f0f0f0f0f7', // 3 bits differ
      contentKey: null,
      total: null,
    };
    const { signals, risk } = verifyReceipt(input({ related: [related] }));
    expect(codes(signals)).toEqual(['DUPLICATE_IMAGE']);
    expect(signals[0]?.explanation).toContain('3 of 64 bits differ');
    expect(signals[0]?.explanation).toContain('Ana Gómez');
    expect(risk.level).toBe('high');
  });

  it('8. card receipt resubmitted as a reimbursement', () => {
    const related: RelatedReceipt = {
      id: 'rcpt-card',
      employeeId: 'emp-juan',
      employeeName: 'Juan Pérez',
      kind: 'card',
      uploadedAt: '2026-10-13T16:00:00Z',
      sha256: 'sha-new',
      dhash: 'f0f0f0f0f0f0f0f0',
      contentKey: null,
      total: null,
    };
    const { signals, risk } = verifyReceipt(input({ kind: 'reimbursement', related: [related] }));
    expect(codes(signals)).toEqual(['DOUBLE_DIPPING']);
    expect(signals[0]?.explanation).toContain('the same employee');
    expect(risk.level).toBe('high');
  });

  it('9. clean reimbursement under the threshold: low risk', () => {
    const taxi = extraction({ merchantName: field('Taxi Sitio 12'), total: field(mxn(180)), lineItems: [item('Tarifa', 180)] });
    expect(verifyReceipt(input({ kind: 'reimbursement', extraction: taxi })).risk.level).toBe('low');
  });
});

describe('anchor checks', () => {
  const fakeAt = (time: string) => extraction({ ...docenaReceipt, time: field(time) });

  it('time: a bill paid 32 minutes after printing is fine', () => {
    expect(verifyReceipt(input({ extraction: fakeAt('14:48'), anchor: docena })).signals).toEqual([]);
  });

  it('time: slightly outside the window is moderate, far outside is strong', () => {
    // Charge at 15:20 local. Printed 11:50 → 3 h 30 min before payment (30 min over the window).
    const moderate = verifyReceipt(input({ extraction: fakeAt('11:50'), anchor: docena })).signals;
    expect(moderate).toMatchObject([{ code: 'TIME_MISMATCH', severity: 'moderate' }]);
    // Printed 16:00 → payment 40 min *before* the receipt: 25 min over the allowance, moderate.
    expect(verifyReceipt(input({ extraction: fakeAt('16:00'), anchor: docena })).signals).toMatchObject([
      { code: 'TIME_MISMATCH', severity: 'moderate' },
    ]);
    // Printed 08:00 → 7 h 20 min before payment.
    expect(verifyReceipt(input({ extraction: fakeAt('08:00'), anchor: docena })).signals).toMatchObject([
      { code: 'TIME_MISMATCH', severity: 'strong' },
    ]);
  });

  it('time and city: skipped for online purchases', () => {
    const online = { ...docena, cardPresent: false };
    const receipt = extraction({ ...docenaReceipt, time: field('03:00'), city: field('Monterrey') });
    expect(verifyReceipt(input({ extraction: receipt, anchor: online })).signals).toEqual([]);
  });

  it('time and date: skipped for hotels, which print folios at checkout', () => {
    const hotel = tx({ id: 'tx-hotel', merchantDescriptor: 'HOTEL CAMINO REAL', mcc: '7011', amount: mxn(4200), authorizedAt: '2026-10-14T21:20:00Z' });
    const folio = extraction({
      merchantName: field('Camino Real Polanco'),
      date: field({ kind: 'exact', date: '2026-10-17' }),
      time: field('11:00'),
      total: field(mxn(4200)),
      lineItems: [item('Habitación 3 noches', 4200)],
    });
    expect(verifyReceipt(input({ extraction: folio, date: printed('2026-10-17'), anchor: hotel })).signals).toEqual([]);
  });

  it('date: a receipt dated days after the charge is flagged, unless the date was inferred', () => {
    const later = extraction({ ...docenaReceipt, time: field(null) });
    expect(codes(verifyReceipt(input({ extraction: later, date: printed('2026-10-17'), anchor: docena })).signals)).toEqual([
      'DATE_MISMATCH',
    ]);
    const inferred: ResolvedDate = { date: '2026-10-17', resolution: 'inferred_from_locale', confidence: 99 };
    expect(verifyReceipt(input({ extraction: later, date: inferred, anchor: docena })).signals).toEqual([]);
  });

  it('city: reads the address when the city field is a neighbourhood', () => {
    const elsewhere = extraction({ ...docenaReceipt, city: field('Providencia'), address: field('Av. Chapultepec 15, Guadalajara, Jal.') });
    expect(codes(verifyReceipt(input({ extraction: elsewhere, anchor: docena })).signals)).toEqual(['CITY_MISMATCH']);
  });

  it('amount: a manually chosen transaction the receipt cannot explain is strong', () => {
    const cheap = extraction({ ...docenaReceipt, subtotal: field(null), tax: field(null), total: field(mxn(300)), lineItems: [] });
    expect(verifyReceipt(input({ extraction: cheap, anchor: docena })).signals).toMatchObject([
      { code: 'AMOUNT_MISMATCH', severity: 'strong' },
    ]);
  });

  it('amount: a large but plausible tip is a weak signal', () => {
    const bigTip = extraction({ ...docenaReceipt, subtotal: field(null), tax: field(null), total: field(mxn(1360)), lineItems: [] });
    expect(verifyReceipt(input({ extraction: bigTip, anchor: docena })).signals).toMatchObject([
      { code: 'AMOUNT_UNEXPLAINED', severity: 'weak' },
    ]);
  });

  it('category: skipped when too little of the receipt can be classified', () => {
    const vague = extraction({ ...docenaReceipt, lineItems: [item('Especial de la casa', 1200), item('Agua', 250)] });
    const liquorStore = { ...docena, mcc: '5921' };
    expect(verifyReceipt(input({ extraction: vague, anchor: liquorStore })).signals).toEqual([]);
  });

  it('anchor checks never run for reimbursements', () => {
    const fake = extraction({ ...docenaReceipt, time: field('03:00'), city: field('Monterrey') });
    expect(verifyReceipt(input({ kind: 'reimbursement', extraction: fake, anchor: docena })).signals).toEqual([]);
  });
});

describe('document checks', () => {
  it('accepts totals where tax is already included in the subtotal', () => {
    const taxIncluded = extraction({ subtotal: field(mxn(1450)), tax: field(mxn(200)), total: field(mxn(1450)) });
    expect(verifyReceipt(input({ extraction: taxIncluded })).signals).toEqual([]);
  });

  it('flags a total that subtotal, tax and tip cannot explain', () => {
    const wrong = extraction({ subtotal: field(mxn(1000)), tax: field(mxn(160)), total: field(mxn(1450)) });
    expect(codes(verifyReceipt(input({ extraction: wrong })).signals)).toEqual(['ARITHMETIC_TOTAL']);
  });

  it('flags PNGs without camera metadata, but not PDFs or stripped JPEGs', () => {
    const png = { sha256: 's', dhash: null, meta: { format: 'png' as const } };
    expect(codes(verifyReceipt(input({ image: png })).signals)).toEqual(['NO_CAMERA_METADATA']);
    expect(verifyReceipt(input({ image: { ...png, meta: { format: 'pdf' } } })).signals).toEqual([]);
    expect(verifyReceipt(input({ image: { ...png, meta: { format: 'jpeg' } } })).signals).toEqual([]);
  });

  it('flags low reading confidence on total or date', () => {
    const blurry = extraction({ total: field(mxn(95), 62) });
    expect(codes(verifyReceipt(input({ extraction: blurry })).signals)).toEqual(['LOW_EXTRACTION_CONFIDENCE']);
  });
});

describe('duplicates', () => {
  const base: RelatedReceipt = {
    id: 'rcpt-old',
    employeeId: 'emp-juan',
    employeeName: 'Juan Pérez',
    kind: 'card',
    uploadedAt: '2026-10-13T16:00:00Z',
    sha256: 'sha-old',
    dhash: '0f0f0f0f0f0f0f0f',
    contentKey: null,
    total: null,
  };

  it('detects the same paper receipt photographed twice by its content', () => {
    const receipt = extraction({ merchantName: field('Starbucks Coffee'), total: field(mxn(95)) });
    const key = contentKey('Starbucks Coffee', '2026-10-13', mxn(95));
    const { signals } = verifyReceipt(
      input({ extraction: receipt, date: printed('2026-10-13'), related: [{ ...base, contentKey: key }] }),
    );
    expect(signals).toMatchObject([{ code: 'DUPLICATE_CONTENT', severity: 'moderate' }]);
  });

  it('ignores a near-identical image when the totals disagree (similar-looking receipts)', () => {
    const receipt = extraction({ merchantName: field('Taxi Sitio 12'), total: field(mxn(180)) });
    const lookalike = { ...base, dhash: 'f0f0f0f0f0f0f0f3', total: mxn(5400) }; // 2 bits away
    expect(verifyReceipt(input({ extraction: receipt, related: [lookalike] })).signals).toEqual([]);
    expect(codes(verifyReceipt(input({ extraction: receipt, related: [{ ...lookalike, total: mxn(180) }] })).signals)).toEqual([
      'DUPLICATE_IMAGE',
    ]);
  });

  it('ignores images that are far apart and the receipt itself', () => {
    expect(verifyReceipt(input({ related: [base, { ...base, id: 'rcpt-new', sha256: 'sha-new' }] })).signals).toEqual([]);
  });
});

describe('fingerprints', () => {
  it('computes a dHash from a 9x8 grayscale grid', () => {
    const descending = Array.from({ length: 72 }, (_, i) => 255 - (i % 9) * 10); // each pixel brighter than its right neighbour
    expect(dhashFromGrayscale(descending)).toBe('ffffffffffffffff');
    expect(dhashFromGrayscale(new Array(72).fill(128))).toBe('0000000000000000');
  });

  it('counts differing bits', () => {
    expect(hammingDistance('ffffffffffffffff', 'fffffffffffffff0')).toBe(4);
    expect(hammingDistance('0000000000000000', 'ffffffffffffffff')).toBe(64);
  });

  it('banding: any two hashes within 6 bits share at least one band (pigeonhole)', () => {
    let seed = 42;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let trial = 0; trial < 2000; trial++) {
      let value = 0n;
      for (let i = 0; i < 64; i++) value = (value << 1n) | (random() < 0.5 ? 1n : 0n);
      let variant = value;
      const flips = 1 + Math.floor(random() * 6);
      for (let f = 0; f < flips; f++) variant ^= 1n << BigInt(Math.floor(random() * 64));
      const a = dhashBands(value.toString(16).padStart(16, '0'));
      const b = dhashBands(variant.toString(16).padStart(16, '0'));
      expect(a.some((key, i) => key === b[i])).toBe(true);
    }
  });

  it('produces 7 band keys covering all 64 bits', () => {
    expect(dhashBands('ffffffffffffffff')).toEqual(['DH1#1ff', 'DH2#1ff', 'DH3#1ff', 'DH4#1ff', 'DH5#1ff', 'DH6#1ff', 'DH7#3ff']);
  });
});

describe('classification', () => {
  it.each([
    ['Tacos al pastor (4)', 'food'],
    ['Michelada con camarón', 'alcohol'],
    ['CERV CORONA 355ML', 'alcohol'],
    ['Hamburguesa premium', 'food'],
    ['Habitación 3 noches', 'lodging'],
    ['Magna 32.5 L', 'fuel'],
    ['Plus plan - monthly', 'software'],
    ['Especial de la casa', null],
  ])('%s → %s', (description, category) => {
    expect(classifyLineItem(description)).toBe(category);
  });

  it('weights categories by amount and reports how much was classified', () => {
    const result = classifyReceipt([item('Tacos', 300), item('Cerveza', 100), item('Especial', 100)], 0.3);
    expect(result.categories).toEqual(['food']);
    expect(result.classifiedShare).toBeCloseTo(0.8);
  });
});

describe('cities', () => {
  it('treats municipalities of the same metro area as the same place', () => {
    expect(compareCities('Zapopan', 'Guadalajara')).toBe('same');
    expect(compareCities('CDMX', 'Mexico City')).toBe('same');
    expect(compareCities('Monterrey', 'Guadalajara')).toBe('different');
    expect(compareCities('Polanco', 'Guadalajara')).toBe('unknown');
  });
});

describe('risk', () => {
  const signal = (severity: Signal['severity']): Signal => ({ code: 'TIME_MISMATCH', severity, title: '', explanation: '', evidence: {} });
  const card = { kind: 'card' as const, total: mxn(100), anchored: true };
  const config = defaultVerificationConfig;

  it.each([
    [[], 'low'],
    [['weak'], 'low'],
    [['weak', 'weak'], 'medium'],
    [['moderate'], 'medium'],
    [['strong', 'weak'], 'high'],
  ] as const)('%j → %s', (severities, level) => {
    expect(assessRisk(severities.map(signal), card, config).level).toBe(level);
  });

  it("moves reimbursements above their currency's threshold up one level", () => {
    const reimbursement = (total: Money) => ({ kind: 'reimbursement' as const, total, anchored: false });
    const ars = (pesos: number) => money(pesos * 100, 'ARS');

    expect(assessRisk([], reimbursement(ars(18_000)), config).level).toBe('low');
    expect(assessRisk([], reimbursement(ars(200_000)), config)).toEqual({
      level: 'medium',
      reasons: [expect.stringMatching(/^reimbursement above ARS\s150,000\.00 with no card transaction to verify against$/)],
    });
    expect(assessRisk([signal('moderate')], reimbursement(ars(200_000)), config).level).toBe('high');
    // Each currency has its own threshold: no exchange rates involved.
    expect(assessRisk([], reimbursement(money(2_500_00, 'USD')), config).level).toBe('medium');
    expect(assessRisk([], reimbursement(money(100_00, 'USD')), config).level).toBe('low');
  });

  it('reviews reimbursements in a currency with no threshold', () => {
    expect(assessRisk([], { kind: 'reimbursement', total: money(1_000, 'EUR'), anchored: false }, config)).toEqual({
      level: 'medium',
      reasons: ['reimbursement in EUR, which has no review threshold configured'],
    });
  });

  it('keeps card receipts without a transaction at medium or above', () => {
    const unanchored = { kind: 'card' as const, total: mxn(100), anchored: false };
    expect(assessRisk([], unanchored, config)).toEqual({ level: 'medium', reasons: ['not yet verified against a card transaction'] });
    expect(assessRisk([signal('strong')], unanchored, config).level).toBe('high');
  });
});
