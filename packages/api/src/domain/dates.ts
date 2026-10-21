import { TZDate } from '@date-fns/tz';
import { addDays, differenceInCalendarDays, format, isValid, parseISO } from 'date-fns';
import type { ExtractedField, ParsedDate, ResolvedDate } from './types';

const MONTHS: Record<string, number> = {
  ene: 1, enero: 1, jan: 1, january: 1,
  feb: 2, febrero: 2, february: 2,
  mar: 3, marzo: 3, march: 3,
  abr: 4, abril: 4, apr: 4, april: 4,
  may: 5, mayo: 5,
  jun: 6, junio: 6, june: 6,
  jul: 7, julio: 7, july: 7,
  ago: 8, agosto: 8, aug: 8, august: 8,
  sep: 9, sept: 9, set: 9, septiembre: 9, setiembre: 9, september: 9,
  oct: 10, octubre: 10, october: 10,
  nov: 11, noviembre: 11, november: 11,
  dic: 12, diciembre: 12, dec: 12, december: 12,
};

/** Builds an ISO date, or null when the components don't form a real date (e.g. 31/02). */
function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function fullYear(y: number): number {
  return y < 100 ? 2000 + y : y;
}

function normalize(raw: string): string {
  return raw.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

/**
 * Parses a date as printed on a receipt. Numeric dates where both day and month are ≤ 12
 * (e.g. "03/04/2026") are returned as ambiguous, with both readings, for the caller to resolve.
 */
export function parseReceiptDate(raw: string): ParsedDate | null {
  const s = normalize(raw);

  // ISO or year-first: 2026-10-14, 2026/10/14
  const ymd = s.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (ymd) {
    const date = isoDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
    return date ? { kind: 'exact', date } : null;
  }

  // Textual month: "14 oct 2026", "14-OCT-26", "14 de octubre de 2026", "Oct 14, 2026"
  const word = s.match(/[a-z]+/g)?.find((w) => w in MONTHS);
  if (word) {
    const numbers = (s.match(/\d+/g) ?? []).map(Number);
    const yearIdx = numbers.findIndex((n) => n >= 1000);
    const year = yearIdx >= 0 ? numbers[yearIdx] : numbers.length >= 2 ? numbers[numbers.length - 1] : undefined;
    const rest = numbers.filter((_, i) => i !== (yearIdx >= 0 ? yearIdx : numbers.length - 1));
    const day = rest.find((n) => n >= 1 && n <= 31);
    if (year === undefined || day === undefined) return null;
    const date = isoDate(fullYear(year), MONTHS[word]!, day);
    return date ? { kind: 'exact', date } : null;
  }

  // Numeric: 14/10/2026, 10/14/26, 03.04.2026
  const num = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (!num) return null;
  const a = Number(num[1]);
  const b = Number(num[2]);
  const year = fullYear(Number(num[3]));
  const ddmm = isoDate(year, b, a);
  const mmdd = isoDate(year, a, b);

  if (ddmm && mmdd && ddmm !== mmdd) return { kind: 'ambiguous', options: [ddmm, mmdd] };
  const date = ddmm ?? mmdd;
  return date ? { kind: 'exact', date } : null;
}

/** Finds a printed time ("14:48", "2:48 PM", "14:48:05") and returns it as "HH:mm". */
export function parseReceiptTime(raw: string): string | null {
  const m = raw.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*([ap])\.?\s?m\.?(?![a-z]))?/i);
  if (!m) return null;
  let hours = Number(m[1]);
  const minutes = Number(m[2]);
  const meridiem = m[3]?.toLowerCase();
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === 'p' && hours !== 12) hours += 12;
    if (meridiem === 'a' && hours === 12) hours = 0;
  }
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Currencies whose issuers print month-first dates. Everything else defaults to day-first. */
const MONTH_FIRST_CURRENCIES = new Set(['USD']);

/**
 * Resolves the receipt date. For ambiguous dates, prefers the reading that has candidate
 * transactions; if both or neither do, falls back to the convention of the receipt's currency.
 * An inferred date must not later count as evidence that the receipt fits a transaction.
 */
export function resolveReceiptDate(
  field: ExtractedField<ParsedDate>,
  hasCandidatesOn: (isoDate: string) => boolean,
  currency: string | null,
): ResolvedDate | null {
  const parsed = field.value;
  if (!parsed) return null;
  if (parsed.kind === 'exact') {
    return { date: parsed.date, resolution: 'printed', confidence: field.confidence };
  }

  const [ddmm, mmdd] = parsed.options;
  const ddmmFits = hasCandidatesOn(ddmm);
  const mmddFits = hasCandidatesOn(mmdd);
  if (ddmmFits !== mmddFits) {
    return {
      date: ddmmFits ? ddmm : mmdd,
      resolution: 'inferred_from_transactions',
      confidence: field.confidence,
    };
  }
  const monthFirst = currency !== null && MONTH_FIRST_CURRENCIES.has(currency);
  return {
    date: monthFirst ? mmdd : ddmm,
    resolution: 'inferred_from_locale',
    confidence: field.confidence,
  };
}

/** Calendar date ("yyyy-MM-dd") of a UTC instant, in the given IANA time zone. */
export function localDate(isoUtc: string, timeZone: string): string {
  return format(new TZDate(new Date(isoUtc).getTime(), timeZone), 'yyyy-MM-dd');
}

/** Wall-clock time ("HH:mm") of a UTC instant, in the given IANA time zone. */
export function localTime(isoUtc: string, timeZone: string): string {
  return format(new TZDate(new Date(isoUtc).getTime(), timeZone), 'HH:mm');
}

/** Whole calendar days from `from` to `to` (both "yyyy-MM-dd"). Positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
  return differenceInCalendarDays(parseISO(to), parseISO(from));
}

export function addDaysToIsoDate(date: string, days: number): string {
  const d = parseISO(date);
  if (!isValid(d)) throw new Error(`Invalid ISO date: ${date}`);
  return format(addDays(d, days), 'yyyy-MM-dd');
}
