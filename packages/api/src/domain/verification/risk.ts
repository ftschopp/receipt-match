import { formatMoney } from '../money';
import type { Money } from '../types';
import type { ReceiptKind, RiskAssessment, RiskLevel, Signal, VerificationConfig } from './types';

const LEVELS: RiskLevel[] = ['low', 'medium', 'high'];

/**
 * Any strong signal → high. One moderate or two weak → medium. Otherwise low.
 * Reimbursements above their currency's review threshold (or in a currency without one) move up one level: there is no card transaction
 * to vouch for them. Card receipts not yet tied to a transaction are at least medium.
 */
export function assessRisk(
  signals: Signal[],
  context: { kind: ReceiptKind; total: Money | null; anchored: boolean },
  config: VerificationConfig,
): RiskAssessment {
  const count = (severity: Signal['severity']) => signals.filter((s) => s.severity === severity).length;
  const strong = count('strong');
  const moderate = count('moderate');
  const weak = count('weak');

  const reasons: string[] = [];
  let level: RiskLevel = 'low';
  if (strong > 0) {
    level = 'high';
    reasons.push(`${strong} strong signal${strong > 1 ? 's' : ''}`);
  } else if (moderate > 0 || weak >= 2) {
    level = 'medium';
    if (moderate > 0) reasons.push(`${moderate} moderate signal${moderate > 1 ? 's' : ''}`);
    if (weak >= 2) reasons.push(`${weak} weak signals`);
  }

  const { kind, total } = context;
  if (kind === 'reimbursement' && total && level !== 'high') {
    // Per-currency thresholds instead of FX conversion: explicit, and no exchange-rate dependency.
    const limit = config.reimbursementReviewThresholds[total.currency];
    if (limit === undefined) {
      level = LEVELS[LEVELS.indexOf(level) + 1]!;
      reasons.push(`reimbursement in ${total.currency}, which has no review threshold configured`);
    } else if (total.amountMinor > limit) {
      level = LEVELS[LEVELS.indexOf(level) + 1]!;
      reasons.push(`reimbursement above ${formatMoney({ amountMinor: limit, currency: total.currency })} with no card transaction to verify against`);
    }
  }

  // A card receipt not yet tied to a transaction hasn't been verified against anything.
  if (kind === 'card' && !context.anchored && level === 'low') {
    level = 'medium';
    reasons.push('not yet verified against a card transaction');
  }

  return { level, reasons };
}
