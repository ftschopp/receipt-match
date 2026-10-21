export type MatcherConfig = {
  /** Candidate transactions must fall within [receiptDate - daysBefore, receiptDate + daysAfter]. */
  window: { daysBefore: number; daysAfter: number };
  amount: {
    /** Relative difference treated as an exact match (rounding). */
    exactTolerance: number;
    /** Tips up to this ratio are normal (1.2 = +20%) and all score `tipScore`. */
    normalTipRatio: number;
    tipScore: number;
    /** Highest charge/receipt ratio still explained by a tip (1.25 = +25%); the score falls linearly to `tipScoreAtMax`. */
    maxTipRatio: number;
    tipScoreAtMax: number;
  };
  /** Date score by |days| between receipt and charge; index = days. Beyond the array scores 0. */
  dateScores: number[];
  weights: { amount: number; date: number; merchant: number };
  /** Fields extracted below this confidence count with reduced weight. */
  lowConfidenceThreshold: number;
  lowConfidenceWeightFactor: number;
  suggest: { minScore: number; minMargin: number };
  maxCandidates: number;
};

export const defaultMatcherConfig: MatcherConfig = {
  window: { daysBefore: 1, daysAfter: 5 },
  amount: { exactTolerance: 0.005, normalTipRatio: 1.2, tipScore: 0.85, maxTipRatio: 1.25, tipScoreAtMax: 0.5 },
  dateScores: [1, 0.85, 0.7, 0.55, 0.4, 0.4],
  weights: { amount: 0.5, date: 0.2, merchant: 0.3 },
  lowConfidenceThreshold: 80,
  lowConfidenceWeightFactor: 0.5,
  suggest: { minScore: 0.75, minMargin: 0.15 },
  maxCandidates: 3,
};
