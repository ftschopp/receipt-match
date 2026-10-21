import { anchorChecks } from './checks/anchor';
import { documentChecks } from './checks/document';
import { duplicateCheck } from './checks/duplicates';
import { defaultVerificationConfig } from './config';
import { assessRisk } from './risk';
import type { Check, RiskAssessment, Signal, VerificationConfig, VerificationInput } from './types';

/** Every check, in display order: anchor evidence first, then duplicates, then the document itself. */
export const allChecks: Check[] = [...anchorChecks, duplicateCheck, ...documentChecks];

const SEVERITY_ORDER: Record<Signal['severity'], number> = { strong: 0, moderate: 1, weak: 2 };

/** Strongest first; stable, so check order is kept within the same severity. */
export const bySeverity = (a: Signal, b: Signal) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];

export type VerificationResult = { signals: Signal[]; risk: RiskAssessment };

export function verifyReceipt(
  input: VerificationInput,
  config: VerificationConfig = defaultVerificationConfig,
  checks: Check[] = allChecks,
): VerificationResult {
  const signals = checks
    .flatMap((check) => check(input, config))
    .sort(bySeverity);
  const risk = assessRisk(signals, { kind: input.kind, total: input.extraction.total.value, anchored: input.anchor !== null }, config);
  return { signals, risk };
}
