import type { VerificationConfig } from './types';

export const defaultVerificationConfig: VerificationConfig = {
  time: { allowedBeforeReceiptMinutes: 15, allowedAfterReceiptMinutes: 180, strongExcessMinutes: 180 },
  maxReceiptDaysAfterCharge: 1,
  amountUnexplainedBelowScore: 0.8,
  duplicates: { maxHammingDistance: 6 },
  arithmetic: { lineItemsTolerance: 0.01 },
  classification: { minCategoryShare: 0.3, minClassifiedShare: 0.5 },
  lowConfidenceThreshold: 80,
  reimbursementReviewThresholds: {
    ARS: 15_000_000, // $ 150.000,00
    USD: 15_000, // US$ 150.00
    MXN: 300_000, // MX$ 3,000.00
    COP: 60_000_000, // COP 600,000.00
    BRL: 80_000, // R$ 800.00
  },
};
