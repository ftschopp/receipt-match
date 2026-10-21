/**
 * Tokens that carry no merchant identity: legal suffixes, processor prefixes, city codes,
 * generic business words, stopwords and web TLDs. Card descriptors are full of them.
 */
const NOISE_TOKENS = new Set([
  // legal entity suffixes
  'sa', 'de', 'cv', 'sapi', 'srl', 'rl', 'inc', 'llc', 'ltd', 'corp', 'co', 'sas', 'ltda', 'saic', 'sacifi', 'sau',
  // payment processor prefixes
  'sq', 'tst', 'paypal', 'pp', 'mp', 'clip', 'stripe',
  // generic business words
  'rest', 'restaurante', 'restaurant', 'store', 'tienda', 'suc', 'sucursal',
  // city and country codes common in descriptors
  'caba', 'bsas', 'cba', 'ar', 'arg', 'cdmx', 'mx', 'mex', 'gdl', 'mty', 'qro', 'bog', 'co', 'us', 'usa',
  // stopwords
  'la', 'el', 'los', 'las', 'del', 'y', 'the', 'and', 'of',
  // web TLDs ("NOTION.SO", "AMAZON.COM")
  'com', 'so', 'io', 'net', 'org', 'app',
]);

/** Lowercase, accent-free, letters-only tokens with noise removed. */
export function merchantTokens(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 1 && !NOISE_TOKENS.has(t));
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = curr;
  }
  return prev[b.length]!;
}

/** Edit-distance similarity in 0..1. */
export function levenshteinRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - levenshtein(a, b) / maxLen;
}

/** Jaro-Winkler similarity in 0..1. Rewards a shared prefix, which suits truncated descriptors. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - window);
    const end = Math.min(i + window + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = bMatched[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const jaro =
    (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;

  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Token-set similarity: compares the shared tokens against each side's full token set, so
 * "docena" vs "docena oyster bar" scores 1.0 (one name contains the other).
 */
export function tokenSetRatio(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const shared = [...setA].filter((t) => setB.has(t)).sort();
  const onlyA = [...setA].filter((t) => !setB.has(t)).sort();
  const onlyB = [...setB].filter((t) => !setA.has(t)).sort();

  const base = shared.join(' ');
  const withA = [base, ...onlyA].filter(Boolean).join(' ');
  const withB = [base, ...onlyB].filter(Boolean).join(' ');
  if (shared.length === 0) return levenshteinRatio(withA, withB);
  return Math.max(levenshteinRatio(base, withA), levenshteinRatio(base, withB), levenshteinRatio(withA, withB));
}

export type MerchantSimilarity = { score: number; receiptTokens: string[]; descriptorTokens: string[] };

/** Tokens at least this similar count as the same word (truncations, typos: "starbcks"). */
const SAME_TOKEN_THRESHOLD = 0.9;

/**
 * How likely a receipt's merchant name and a card descriptor name the same business, 0..1.
 * Jaro-Winkler is applied per token, only to unify near-identical words; applied to whole
 * names it rates unrelated businesses around 0.5, which is too noisy for a match signal.
 */
export function merchantSimilarity(receiptName: string, descriptor: string): MerchantSimilarity {
  const receiptTokens = merchantTokens(receiptName);
  const descriptorTokens = merchantTokens(descriptor);
  if (receiptTokens.length === 0 || descriptorTokens.length === 0) {
    return { score: 0, receiptTokens, descriptorTokens };
  }
  const unified = descriptorTokens.map((d) => {
    const closest = receiptTokens.find((r) => jaroWinkler(r, d) >= SAME_TOKEN_THRESHOLD);
    return closest ?? d;
  });
  const score = tokenSetRatio(receiptTokens, unified);
  return { score, receiptTokens, descriptorTokens };
}
