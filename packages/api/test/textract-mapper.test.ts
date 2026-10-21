import type { ExpenseField } from '@aws-sdk/client-textract';
import { describe, expect, it } from 'vitest';
import { mapAnalyzeExpense, resolveCurrency } from '../src/receipt-reading/textract-mapper';

const field = (type: string, text: string, confidence = 95, currency?: string): ExpenseField => ({
  Type: { Text: type, Confidence: 99 },
  ValueDetection: { Text: text, Confidence: confidence },
  ...(currency && { Currency: { Code: currency } }),
});

const lineItem = (item: string, price: string) => ({
  LineItemExpenseFields: [field('ITEM', item), field('PRICE', price), field('EXPENSE_ROW', `${item} ${price}`, 80)],
});

describe('mapAnalyzeExpense', () => {
  it('maps a Mexican restaurant receipt', () => {
    const result = mapAnalyzeExpense(
      {
        ExpenseDocuments: [
          {
            SummaryFields: [
              field('VENDOR_NAME', 'La Docena Oyster Bar', 97),
              field('NAME', 'LA DOCENA', 60),
              field('ADDRESS', 'Av. Álvaro Obregón 31\nRoma Norte', 90),
              field('CITY', 'Ciudad de México', 88),
              field('INVOICE_RECEIPT_DATE', '14/10/2026', 99),
              field('SUBTOTAL', '1,250.00', 96),
              field('TAX', '200.00', 95),
              field('TOTAL', '$1,450.00', 98, 'USD'),
            ],
            LineItemGroups: [{ LineItems: [lineItem('Ostiones preparados', '520.00'), lineItem('Tostada de atún', '930.00')] }],
            Blocks: [
              { BlockType: 'LINE', Text: 'Horario 13:00 - 23:00', Confidence: 99 },
              { BlockType: 'LINE', Text: 'Fecha: 14/10/2026 14:48', Confidence: 97 },
            ],
          },
        ],
      },
      'MXN',
    );

    expect(result.merchantName).toEqual({ value: 'La Docena Oyster Bar', confidence: 97 });
    expect(result.address.value).toBe('Av. Álvaro Obregón 31 Roma Norte');
    expect(result.city.value).toBe('Ciudad de México');
    expect(result.date).toEqual({ value: { kind: 'exact', date: '2026-10-14' }, confidence: 99 });
    // The line with the date wins over store hours.
    expect(result.time).toEqual({ value: '14:48', confidence: 97 });
    expect(result.total).toEqual({ value: { amountMinor: 145000, currency: 'MXN' }, confidence: 98 });
    expect(result.subtotal.value).toEqual({ amountMinor: 125000, currency: 'MXN' });
    expect(result.tax.value).toEqual({ amountMinor: 20000, currency: 'MXN' });
    expect(result.lineItems).toEqual([
      { description: 'Ostiones preparados', amount: { amountMinor: 52000, currency: 'MXN' }, confidence: 95 },
      { description: 'Tostada de atún', amount: { amountMinor: 93000, currency: 'MXN' }, confidence: 95 },
    ]);
  });

  it('uses the currency code printed on the document and falls back to AMOUNT_PAID', () => {
    const result = mapAnalyzeExpense(
      {
        ExpenseDocuments: [
          {
            SummaryFields: [field('AMOUNT_PAID', '$49.99', 93, 'USD'), field('TAX', '0.00', 95, 'USD')],
            Blocks: [{ BlockType: 'LINE', Text: 'TOTAL USD' }],
          },
        ],
      },
      'MXN',
    );
    expect(result.total.value).toEqual({ amountMinor: 4999, currency: 'USD' });
    expect(result.tax.value).toEqual({ amountMinor: 0, currency: 'USD' });
  });

  it('does not trust Textract reading "$" as USD on a peso receipt (real response behaviour)', () => {
    const peso = (lines: string[]) =>
      mapAnalyzeExpense(
        { ExpenseDocuments: [{ SummaryFields: [field('TOTAL', '$1,450.00', 100, 'USD')], Blocks: lines.map((Text) => ({ BlockType: 'LINE', Text })) }] },
        'MXN',
      ).total.value;
    expect(peso(['TOTAL MXN', '$1,450.00'])).toEqual({ amountMinor: 145000, currency: 'MXN' });
    // A bare "$" is ambiguous: the company currency wins.
    expect(peso(['TOTAL', '$1,450.00'])).toEqual({ amountMinor: 145000, currency: 'MXN' });
  });

  it('resolves the currency from what is printed', () => {
    expect(resolveCurrency(['TOTAL', '€12,50'], 'EUR', 'ARS')).toEqual({ code: 'EUR', ambiguous: false });
    expect(resolveCurrency(['Subtotal USD 10.00', 'TOTAL MXN 200.00'], 'USD', 'ARS')).toEqual({ code: 'MXN', ambiguous: false });
    // Argentine dollar notations
    expect(resolveCurrency(['TOTAL U$S 49,99'], 'USD', 'ARS')).toEqual({ code: 'USD', ambiguous: false });
    expect(resolveCurrency(['TOTAL US$ 49.99'], 'USD', 'ARS')).toEqual({ code: 'USD', ambiguous: false });
    // A bare "$" could be pesos or dollars: read in the company currency, flagged as ambiguous.
    expect(resolveCurrency(['TOTAL $ 85.000,00'], 'USD', 'ARS')).toEqual({ code: 'ARS', ambiguous: true });
  });

  it('marks the extraction as ambiguous when only "$" is printed', () => {
    const result = mapAnalyzeExpense(
      { ExpenseDocuments: [{ SummaryFields: [field('TOTAL', '$ 85.000,00', 99, 'USD')], Blocks: [{ BlockType: 'LINE', Text: 'TOTAL $ 85.000,00' }] }] },
      'ARS',
    );
    expect(result.total.value).toEqual({ amountMinor: 8_500_000, currency: 'ARS' });
    expect(result.currencyAmbiguous).toBe(true);
  });

  it('prefers ADDRESS_BLOCK and strips prices folded into item names', () => {
    const result = mapAnalyzeExpense(
      {
        ExpenseDocuments: [
          {
            SummaryFields: [
              field('VENDOR_ADDRESS', 'LA BODEGA\nAv. Presidente Masaryk 123\nCiudad de Mexico', 99),
              field('ADDRESS_BLOCK', 'Av. Presidente Masaryk 123\nCiudad de Mexico', 98),
              field('TOTAL', '$420.00', 99),
            ],
            LineItemGroups: [
              {
                LineItems: [
                  { LineItemExpenseFields: [field('ITEM', 'Sandwich 235.00'), field('PRICE', '235.00')] },
                  { LineItemExpenseFields: [field('ITEM', 'Plus plan monthly 49.99\n-'), field('PRICE', '49.99')] },
                  { LineItemExpenseFields: [field('ITEM', 'Refresco 600'), field('PRICE', '40.00')] },
                ],
              },
            ],
          },
        ],
      },
      'MXN',
    );
    expect(result.address.value).toBe('Av. Presidente Masaryk 123 Ciudad de Mexico');
    expect(result.lineItems.map((li) => li.description)).toEqual(['Sandwich', 'Plus plan monthly', 'Refresco 600']);
  });

  it('recovers merchant, address and city from the printed lines when Textract misses them (real AR ticket)', () => {
    const line = (Text: string, Confidence = 99) => ({ BlockType: 'LINE' as const, Text, Confidence });
    const result = mapAnalyzeExpense(
      {
        ExpenseDocuments: [
          {
            // What Textract returned for fixtures/receipts/05-la-bodega-generated.png: no vendor, no address.
            SummaryFields: [field('INVOICE_RECEIPT_DATE', '14/10/2026', 99.7), field('TOTAL', '$64.000,00', 99.6, 'USD')],
            Blocks: [line('LA BODEGA'), line('Av. Santa Fe 1860, Recoleta'), line('CABA', 100), line('Fecha: 14/10/2026 Hora: 13:05'), line('TOTAL', 100)],
          },
        ],
      },
      'ARS',
    );
    expect(result.merchantName).toEqual({ value: 'LA BODEGA', confidence: 75 });
    expect(result.address).toEqual({ value: 'Av. Santa Fe 1860, Recoleta', confidence: 75 });
    expect(result.city).toEqual({ value: 'CABA', confidence: 75 });
    expect(result.time.value).toBe('13:05');
    expect(result.total.value).toEqual({ amountMinor: 6_400_000, currency: 'ARS' });
  });

  it('prefers a line naming a known city over a neighbourhood in CITY', () => {
    const result = mapAnalyzeExpense(
      {
        ExpenseDocuments: [
          {
            SummaryFields: [field('CITY', 'Palermo', 90), field('ADDRESS_BLOCK', '4691, Palermo', 90)],
            Blocks: [{ BlockType: 'LINE', Text: 'DON JULIO' }, { BlockType: 'LINE', Text: 'Guatemala 4691, Palermo' }, { BlockType: 'LINE', Text: 'CABA', Confidence: 100 }],
          },
        ],
      },
      'ARS',
    );
    expect(result.city.value).toBe('CABA');
    expect(result.address.value).toBe('4691, Palermo');
  });

  it('keeps ambiguous dates ambiguous for the service to resolve', () => {
    const result = mapAnalyzeExpense({ ExpenseDocuments: [{ SummaryFields: [field('INVOICE_RECEIPT_DATE', '03/04/2026')] }] }, 'MXN');
    expect(result.date.value).toEqual({ kind: 'ambiguous', options: ['2026-04-03', '2026-03-04'] });
  });

  it('returns empty fields for an empty response', () => {
    const result = mapAnalyzeExpense({ ExpenseDocuments: [] }, 'MXN');
    expect(result.total).toEqual({ value: null, confidence: 0 });
    expect(result.lineItems).toEqual([]);
  });
});
