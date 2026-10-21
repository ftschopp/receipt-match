import { jaroWinkler } from '../text';

/**
 * Metro areas and the names they appear under on receipts and in card network data.
 * Municipalities of the same metro area count as the same place (Zapopan is Guadalajara).
 */
const METROS: Record<string, string[]> = {
  'buenos-aires': [
    'buenos aires', 'caba', 'c a b a', 'capital federal', 'ciudad autonoma de buenos aires', 'ciudad de buenos aires',
    'bs as', 'bsas', 'vicente lopez', 'olivos', 'san isidro', 'avellaneda',
  ],
  cordoba: ['cordoba', 'cba', 'villa carlos paz'],
  rosario: ['rosario', 'funes'],
  mendoza: ['mendoza', 'godoy cruz', 'lujan de cuyo'],
  'mar-del-plata': ['mar del plata', 'mdq'],
  bariloche: ['bariloche', 'san carlos de bariloche'],
  'mexico-city': ['cdmx', 'ciudad de mexico', 'mexico city', 'mexico df', 'df', 'mexico d f'],
  guadalajara: ['guadalajara', 'gdl', 'zapopan', 'tlaquepaque', 'san pedro tlaquepaque', 'tonala'],
  monterrey: ['monterrey', 'mty', 'san pedro garza garcia', 'san nicolas de los garza', 'guadalupe nl'],
  queretaro: ['queretaro', 'santiago de queretaro', 'qro'],
  cancun: ['cancun', 'benito juarez qroo'],
  bogota: ['bogota', 'bogota dc', 'bogota d c'],
  medellin: ['medellin', 'envigado', 'sabaneta'],
  'sao-paulo': ['sao paulo', 'sp'],
  'new-york': ['new york', 'nyc', 'brooklyn', 'manhattan'],
  'san-francisco': ['san francisco', 'sf'],
};

export function normalizePlace(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();
}

/** The metro area a city name belongs to, or null when unknown. */
export function metroOf(city: string): string | null {
  const name = normalizePlace(city);
  for (const [metro, aliases] of Object.entries(METROS)) {
    if (aliases.includes(name)) return metro;
  }
  return null;
}

/** Known metro areas mentioned anywhere in a free-text address. */
export function metrosInText(text: string): string[] {
  const padded = ` ${normalizePlace(text)} `;
  return Object.entries(METROS)
    .filter(([, aliases]) => aliases.some((alias) => padded.includes(` ${alias} `)))
    .map(([metro]) => metro);
}

export type PlaceComparison = 'same' | 'different' | 'unknown';

/** Compares a city read from a receipt with the card network's merchant city. */
export function compareCities(receiptCity: string, merchantCity: string): PlaceComparison {
  const a = metroOf(receiptCity);
  const b = metroOf(merchantCity);
  if (a && b) return a === b ? 'same' : 'different';
  // Unknown to the alias table: fall back to near-identical names.
  return jaroWinkler(normalizePlace(receiptCity), normalizePlace(merchantCity)) >= 0.9 ? 'same' : 'unknown';
}
