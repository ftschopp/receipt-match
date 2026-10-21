import { describe, expect, it } from 'vitest';
import {
  addDaysToIsoDate,
  daysBetween,
  localDate,
  localTime,
  parseReceiptDate,
  parseReceiptTime,
  resolveReceiptDate,
} from '../../src/domain/dates';
import type { ExtractedField, ParsedDate } from '../../src/domain/types';

describe('parseReceiptDate', () => {
  it.each([
    ['2026-10-14', '2026-10-14'],
    ['2026/10/14', '2026-10-14'],
    ['14/10/2026', '2026-10-14'],
    ['10/14/2026', '2026-10-14'],
    ['14-10-26', '2026-10-14'],
    ['14 oct 2026', '2026-10-14'],
    ['14-OCT-26', '2026-10-14'],
    ['14 de octubre de 2026', '2026-10-14'],
    ['Oct 14, 2026', '2026-10-14'],
    ['Fecha: 3 ABR 2026 14:48', '2026-04-03'],
    ['05/05/2026', '2026-05-05'],
  ])('reads %s as an exact date', (raw, date) => {
    expect(parseReceiptDate(raw)).toEqual({ kind: 'exact', date });
  });

  it('returns both readings when day and month are both ≤ 12', () => {
    expect(parseReceiptDate('03/04/2026')).toEqual({
      kind: 'ambiguous',
      options: ['2026-04-03', '2026-03-04'],
    });
  });

  it('keeps only the reading that is a real date', () => {
    // 31/02: Feb 31 doesn't exist and there is no month 31
    expect(parseReceiptDate('31/02/2026')).toBeNull();
    expect(parseReceiptDate('04/02/2026')).toEqual({ kind: 'ambiguous', options: ['2026-02-04', '2026-04-02'] });
    expect(parseReceiptDate('30/04/2026')).toEqual({ kind: 'exact', date: '2026-04-30' });
  });

  it('returns null for text without a date', () => {
    expect(parseReceiptDate('GRACIAS POR SU COMPRA')).toBeNull();
  });
});

describe('parseReceiptTime', () => {
  it.each([
    ['14:48', '14:48'],
    ['Hora: 9:05', '09:05'],
    ['14:48:05', '14:48'],
    ['2:48 PM', '14:48'],
    ['12:10 a.m.', '00:10'],
    ['12:10 pm', '12:10'],
    ['14:48 a la mesa 5', '14:48'],
  ])('reads %s', (raw, time) => {
    expect(parseReceiptTime(raw)).toBe(time);
  });

  it('rejects impossible times', () => {
    expect(parseReceiptTime('25:61')).toBeNull();
    expect(parseReceiptTime('13:00 PM')).toBeNull();
  });
});

describe('resolveReceiptDate', () => {
  const ambiguous: ExtractedField<ParsedDate> = {
    value: { kind: 'ambiguous', options: ['2026-04-03', '2026-03-04'] },
    confidence: 95,
  };

  it('keeps a printed exact date as printed', () => {
    const exact: ExtractedField<ParsedDate> = { value: { kind: 'exact', date: '2026-10-14' }, confidence: 99 };
    expect(resolveReceiptDate(exact, () => false, 'MXN')).toEqual({
      date: '2026-10-14',
      resolution: 'printed',
      confidence: 99,
    });
  });

  it('picks the reading that has candidate transactions', () => {
    const resolved = resolveReceiptDate(ambiguous, (d) => d === '2026-03-04', 'MXN');
    expect(resolved).toMatchObject({ date: '2026-03-04', resolution: 'inferred_from_transactions' });
  });

  it('falls back to day-first for MXN when both or neither reading fits', () => {
    expect(resolveReceiptDate(ambiguous, () => true, 'MXN')).toMatchObject({
      date: '2026-04-03',
      resolution: 'inferred_from_locale',
    });
  });

  it('falls back to month-first for USD', () => {
    expect(resolveReceiptDate(ambiguous, () => false, 'USD')).toMatchObject({
      date: '2026-03-04',
      resolution: 'inferred_from_locale',
    });
  });

  it('returns null when no date was read', () => {
    expect(resolveReceiptDate({ value: null, confidence: 0 }, () => true, 'MXN')).toBeNull();
  });
});

describe('time zones', () => {
  it('converts a UTC authorization to the merchant local date and time', () => {
    // 05:40 UTC on Oct 15 is 23:40 on Oct 14 in Mexico City (UTC-6)
    expect(localDate('2026-10-15T05:40:00Z', 'America/Mexico_City')).toBe('2026-10-14');
    expect(localTime('2026-10-15T05:40:00Z', 'America/Mexico_City')).toBe('23:40');
  });
});

describe('date arithmetic', () => {
  it('counts calendar days', () => {
    expect(daysBetween('2026-10-14', '2026-10-16')).toBe(2);
    expect(daysBetween('2026-10-16', '2026-10-14')).toBe(-2);
  });

  it('adds days across month boundaries', () => {
    expect(addDaysToIsoDate('2026-10-30', 3)).toBe('2026-11-02');
  });
});
