import type { Category } from './classify';

type MccInfo = { label: string; expects: Category[] };

/**
 * What a receipt from each merchant category is expected to contain. Only MCCs with a clear
 * expectation are listed; department stores and other catch-all categories are left out on purpose,
 * so the category check is skipped for them.
 */
const MCC: Record<string, MccInfo> = {
  '5812': { label: 'restaurant', expects: ['food', 'alcohol'] },
  '5813': { label: 'bar', expects: ['alcohol', 'food'] },
  '5814': { label: 'fast food', expects: ['food'] },
  '5921': { label: 'liquor store', expects: ['alcohol', 'groceries'] },
  '5411': { label: 'grocery store', expects: ['groceries', 'food', 'alcohol'] },
  '5499': { label: 'convenience store', expects: ['groceries', 'food', 'alcohol'] },
  '5541': { label: 'gas station', expects: ['fuel', 'groceries', 'food'] },
  '5542': { label: 'fuel dispenser', expects: ['fuel'] },
  '7011': { label: 'hotel', expects: ['lodging', 'food', 'alcohol'] },
  '4121': { label: 'taxi / rideshare', expects: ['transport'] },
  '4111': { label: 'commuter transport', expects: ['transport'] },
  '4511': { label: 'airline', expects: ['transport'] },
  '7523': { label: 'parking', expects: ['transport'] },
  '5732': { label: 'electronics store', expects: ['electronics'] },
  '5734': { label: 'software store', expects: ['software'] },
  '5817': { label: 'digital software', expects: ['software'] },
  '5818': { label: 'digital goods', expects: ['software'] },
};

export function mccInfo(mcc: string): MccInfo | null {
  return MCC[mcc] ?? null;
}

/** Hotels print folios at checkout, days after individual charges: time and date checks don't apply. */
export function isLodgingMcc(mcc: string): boolean {
  const n = Number(mcc);
  return mcc === '7011' || (n >= 3501 && n <= 3999);
}
