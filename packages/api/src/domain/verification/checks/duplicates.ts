import { contentKey, hammingDistance } from '../fingerprint';
import type { Money } from '../../types';
import type { Check, RelatedReceipt, Signal, VerificationInput } from '../types';

type DuplicateKind = 'exact' | 'image' | 'content';

const STRENGTH: Record<DuplicateKind, number> = { exact: 3, image: 2, content: 1 };

function duplicateKind(
  input: VerificationInput,
  ownContentKey: string | null,
  other: RelatedReceipt,
  maxDistance: number,
): { kind: DuplicateKind; distance?: number } | null {
  if (other.sha256 === input.image.sha256) return { kind: 'exact' };
  if (input.image.dhash && other.dhash) {
    const distance = hammingDistance(input.image.dhash, other.dhash);
    // A 64-bit dHash is coarse for documents: different receipts (white paper, rows of text)
    // can land a few bits apart. A near-identical image only counts when the extracted totals
    // don't contradict it, or when one of the totals couldn't be read.
    if (distance <= maxDistance && totalsAgree(input.extraction.total.value, other.total)) {
      return { kind: 'image', distance };
    }
  }
  if (ownContentKey && ownContentKey === other.contentKey) return { kind: 'content' };
  return null;
}

function totalsAgree(a: Money | null, b: Money | null): boolean {
  return !a || !b || (a.amountMinor === b.amountMinor && a.currency === b.currency);
}

function who(input: VerificationInput, other: RelatedReceipt): string {
  return other.employeeId === input.employeeId ? 'the same employee' : other.employeeName;
}

/**
 * Compares the receipt against receipts that share a fingerprint (exact file hash, perceptual
 * image hash band, or extracted content). Reports at most one signal per other receipt.
 */
export const duplicateCheck: Check = (input, config) => {
  const ownContentKey = contentKey(
    input.extraction.merchantName.value,
    input.date?.date ?? null,
    input.extraction.total.value,
  );

  const signals: Signal[] = [];
  for (const other of input.related) {
    if (other.id === input.receiptId) continue;
    const dup = duplicateKind(input, ownContentKey, other, config.duplicates.maxHammingDistance);
    if (!dup) continue;

    const submitted = `submitted by ${who(input, other)} on ${other.uploadedAt.slice(0, 10)}`;
    const evidence = { otherReceiptId: other.id, otherEmployeeId: other.employeeId, match: dup.kind, distance: dup.distance };

    if (other.kind !== input.kind) {
      signals.push({
        code: 'DOUBLE_DIPPING',
        severity: 'strong',
        title: 'Same receipt used for a card charge and a reimbursement',
        explanation: `This ${input.kind === 'card' ? 'card receipt' : 'reimbursement'} matches a ${other.kind === 'card' ? 'card receipt' : 'reimbursement claim'} ${submitted}. The expense would be paid twice.`,
        evidence,
      });
      continue;
    }

    const byKind: Record<DuplicateKind, Pick<Signal, 'code' | 'severity' | 'title' | 'explanation'>> = {
      exact: {
        code: 'DUPLICATE_EXACT',
        severity: 'strong',
        title: 'Receipt file was already submitted',
        explanation: `Identical file ${submitted}.`,
      },
      image: {
        code: 'DUPLICATE_IMAGE',
        severity: 'strong',
        title: 'Receipt image was already submitted',
        explanation: `A near-identical image (${dup.distance} of 64 bits differ, e.g. re-cropped or recompressed) was ${submitted}.`,
      },
      content: {
        code: 'DUPLICATE_CONTENT',
        severity: 'moderate',
        title: 'A receipt with the same content was already submitted',
        explanation: `Same merchant, date and total as a receipt ${submitted}. Possibly the same paper receipt photographed twice.`,
      },
    };
    signals.push({ ...byKind[dup.kind], evidence });
  }

  // Strongest first, so the UI leads with the most convincing evidence.
  return signals.sort(
    (a, b) => STRENGTH[(b.evidence.match as DuplicateKind)] - STRENGTH[(a.evidence.match as DuplicateKind)],
  );
};
