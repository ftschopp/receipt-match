import { merchantTokens } from '../text';
import type { Money } from '../types';

/**
 * Difference hash from a 9x8 grayscale image (row-major, 72 values 0..255).
 * Each bit says whether a pixel is brighter than its right neighbour, so the hash captures the
 * image's structure and survives recompression, resizing, small crops and brightness changes.
 */
export function dhashFromGrayscale(pixels: ArrayLike<number>): string {
  if (pixels.length !== 72) throw new Error(`dHash expects 9x8 = 72 pixels, got ${pixels.length}`);
  let hash = 0n;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const left = pixels[row * 9 + col]!;
      const right = pixels[row * 9 + col + 1]!;
      hash = (hash << 1n) | (left > right ? 1n : 0n);
    }
  }
  return hash.toString(16).padStart(16, '0');
}

export function hammingDistance(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/** 64 bits split into 7 bands: six of 9 bits and one of 10. */
const BAND_SIZES = [9, 9, 9, 9, 9, 9, 10];

/**
 * Band keys for indexing a dHash by exact equality. If two hashes differ in at most 6 bits,
 * those bits can touch at most 6 of the 7 bands, so at least one band key is identical
 * (pigeonhole). Querying the 7 keys finds every near-duplicate with no false negatives.
 */
export function dhashBands(hash: string): string[] {
  const value = BigInt(`0x${hash}`);
  const keys: string[] = [];
  let shift = 64;
  BAND_SIZES.forEach((size, i) => {
    shift -= size;
    const band = (value >> BigInt(shift)) & ((1n << BigInt(size)) - 1n);
    keys.push(`DH${i + 1}#${band.toString(16)}`);
  });
  return keys;
}

/** Identifies the same paper receipt photographed twice: same merchant, date and total. */
export function contentKey(merchantName: string | null, date: string | null, total: Money | null): string | null {
  if (!merchantName || !date || !total) return null;
  const tokens = merchantTokens(merchantName);
  if (tokens.length === 0) return null;
  return `${tokens.join(' ')}|${date}|${total.amountMinor}${total.currency}`;
}
