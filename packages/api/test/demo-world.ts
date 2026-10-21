import { money, type ExtractedReceipt, type Transaction } from '../src/domain';
import { createMemory } from './memory';

const f = <T>(value: T | null, confidence = 96) => ({ value, confidence });
const ars = (pesos: number) => money(pesos * 100, 'ARS');

const cafeMartinez: Transaction = {
  id: 'tx-cafe-martinez',
  employeeId: 'emp-juan',
  authorizedAt: '2026-10-13T12:12:00Z',
  merchantDescriptor: 'CAFE MARTINEZ 112',
  mcc: '5814',
  merchantCity: 'Buenos Aires',
  merchantCountry: 'AR',
  merchantTimezone: 'America/Argentina/Buenos_Aires',
  cardPresent: true,
  amount: ars(8_400),
  originalAmount: null,
  receiptId: null,
};

const extraction: ExtractedReceipt = {
  merchantName: f('CAFE MARTINEZ'),
  address: f(null),
  city: f('CABA'),
  date: f({ kind: 'exact', date: '2026-10-13' }),
  time: f('09:10'),
  subtotal: f(null),
  tax: f(null),
  tip: f(null),
  total: f(ars(8_400)),
  lineItems: [],
  currencyAmbiguous: true,
};

/** A small world for handler and Middy tests: one employee, one charge, one readable receipt. */
export const createWorld = () =>
  createMemory({
    employees: [{ id: 'emp-juan', name: 'Juan Pérez', department: 'Engineering' }],
    transactions: [cafeMartinez],
    extractions: { 'cafe-martinez': extraction },
    images: { 'cafe-martinez': { sha256: 'sha', dhash: '0123456789abcdef', meta: { format: 'jpeg' } } },
  });
