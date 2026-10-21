import { money, type Employee, type Transaction } from '../src/domain';

/**
 * Demo company in Buenos Aires: four employees and one week of corporate card transactions
 * (12–18 Oct 2026) on ARS cards, designed so every scenario in SPEC §10 has a transaction to
 * land on. Times are written in Argentina local time (UTC-3, no DST) and stored in UTC.
 */

export const employees: Employee[] = [
  { id: 'emp-juan', name: 'Juan Pérez', department: 'Engineering' },
  { id: 'emp-ana', name: 'Ana Gómez', department: 'Sales' },
  { id: 'emp-marta', name: 'Marta Ruiz', department: 'Finance' },
  { id: 'emp-diego', name: 'Diego Torres', department: 'Operations' },
];

const BA = 'America/Argentina/Buenos_Aires';
const ars = (pesos: number) => money(Math.round(pesos * 100), 'ARS');
/** "2026-10-14 15:20" in Argentina → UTC ISO timestamp. */
const arTime = (local: string) => new Date(`${local.replace(' ', 'T')}:00-03:00`).toISOString();

type Seed = Omit<Transaction, 'merchantTimezone' | 'merchantCountry' | 'cardPresent' | 'originalAmount' | 'receiptId' | 'authorizedAt'> &
  Partial<Transaction> & { at: string };

const tx = ({ at, ...t }: Seed): Transaction => ({
  merchantTimezone: BA,
  merchantCountry: 'AR',
  cardPresent: true,
  originalAmount: null,
  receiptId: null,
  authorizedAt: arTime(at),
  ...t,
});

export const transactions: Transaction[] = [
  // Juan: scenarios 1–5, 8 and 11 (the ambiguous date points back to the previous week)
  tx({ id: 'tx-panera', employeeId: 'emp-juan', at: '2026-10-05 08:20', merchantDescriptor: 'LA PANERA ROSA', mcc: '5814', merchantCity: 'Buenos Aires', amount: ars(6_000) }),
  tx({ id: 'tx-cafe-martinez', employeeId: 'emp-juan', at: '2026-10-13 09:12', merchantDescriptor: 'CAFE MARTINEZ 112', mcc: '5814', merchantCity: 'Buenos Aires', amount: ars(8_400) }),
  tx({ id: 'tx-don-julio', employeeId: 'emp-juan', at: '2026-10-14 15:20', merchantDescriptor: 'REST DON JULIO PALERMO', mcc: '5812', merchantCity: 'Buenos Aires', amount: ars(93_500) }),
  tx({
    id: 'tx-bodega',
    employeeId: 'emp-juan',
    at: '2026-10-14 23:40',
    merchantDescriptor: 'LA BODEGA CBA',
    mcc: '5921',
    merchantCity: 'Cordoba',
    merchantTimezone: 'America/Argentina/Cordoba',
    amount: ars(64_000),
  }),
  tx({
    id: 'tx-notion',
    employeeId: 'emp-juan',
    at: '2026-10-15 15:00',
    merchantDescriptor: 'NOTION.SO',
    mcc: '5734',
    merchantCity: 'San Francisco',
    merchantCountry: 'US',
    merchantTimezone: 'America/Los_Angeles',
    cardPresent: false,
    amount: ars(72_485.5),
    originalAmount: money(4999, 'USD'),
  }),
  tx({ id: 'tx-uber', employeeId: 'emp-juan', at: '2026-10-15 20:05', merchantDescriptor: 'UBER *TRIP', mcc: '4121', merchantCity: 'Buenos Aires', amount: ars(12_000) }),
  tx({ id: 'tx-carrefour', employeeId: 'emp-juan', at: '2026-10-15 21:30', merchantDescriptor: 'CARREFOUR EXPRESS 0234', mcc: '5499', merchantCity: 'Buenos Aires', amount: ars(12_000) }),

  // Ana: scenario 6 (edited total) and 7 (duplicate of Juan's receipt)
  tx({ id: 'tx-aerolineas', employeeId: 'emp-ana', at: '2026-10-12 08:30', merchantDescriptor: 'AEROLINEAS ARG WEB', mcc: '4511', merchantCity: 'Buenos Aires', cardPresent: false, amount: ars(210_000) }),
  tx({
    id: 'tx-hotel',
    employeeId: 'emp-ana',
    at: '2026-10-15 12:05',
    merchantDescriptor: 'HOTEL DIPLOMATIC MZA',
    mcc: '7011',
    merchantCity: 'Mendoza',
    merchantTimezone: 'America/Argentina/Mendoza',
    amount: ars(380_000),
  }),
  tx({ id: 'tx-preferido', employeeId: 'emp-ana', at: '2026-10-16 14:10', merchantDescriptor: 'EL PREFERIDO PALERMO', mcc: '5812', merchantCity: 'Buenos Aires', amount: ars(112_000) }),

  // Marta and Diego: background activity
  tx({ id: 'tx-mercadolibre', employeeId: 'emp-marta', at: '2026-10-14 10:45', merchantDescriptor: 'MERCADOLIBRE*ML', mcc: '5999', merchantCity: 'Buenos Aires', cardPresent: false, amount: ars(89_000) }),
  tx({
    id: 'tx-ypf',
    employeeId: 'emp-marta',
    at: '2026-10-16 07:50',
    merchantDescriptor: 'YPF FULL 0456',
    mcc: '5541',
    merchantCity: 'Rosario',
    merchantTimezone: 'America/Argentina/Cordoba',
    amount: ars(45_000),
  }),
  tx({ id: 'tx-cabify', employeeId: 'emp-diego', at: '2026-10-13 18:20', merchantDescriptor: 'CABIFY', mcc: '4121', merchantCity: 'Buenos Aires', amount: ars(9_500) }),
  tx({ id: 'tx-coto', employeeId: 'emp-diego', at: '2026-10-17 12:15', merchantDescriptor: 'COTO 045', mcc: '5411', merchantCity: 'Buenos Aires', amount: ars(134_000) }),
];
