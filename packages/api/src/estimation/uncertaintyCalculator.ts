/**
 * F084 — Estimation with Uncertainty Ranges
 *
 * Computes calorie uncertainty ranges based on confidence level and
 * estimation method. Addresses the "perceived inaccuracy" risk by
 * showing "350 kcal (320-380)" instead of a single precise number.
 *
 * Range percentage matrix:
 *   confidence \ method  | official/scraped | ingredients | extrapolation/llm
 *   high                 |       ±5%        |    ±10%     |      ±15%
 *   medium               |      ±10%        |    ±15%     |      ±20%
 *   low                  |      ±15%        |    ±20%     |      ±30%
 *
 * No DB migration needed — computed from existing EstimateResult fields.
 */

import type { UncertaintyRange } from '@foodxplorer/shared';

export type { UncertaintyRange } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ConfidenceLevel = 'high' | 'medium' | 'low';
type EstimationMethod = 'official' | 'scraped' | 'ingredients' | 'extrapolation' | 'llm';

// ---------------------------------------------------------------------------
// Percentage matrix — confidence × method category
// ---------------------------------------------------------------------------

const PERCENTAGE_MATRIX: Record<ConfidenceLevel, Record<'precise' | 'moderate' | 'estimated', number>> = {
  high:   { precise: 5,  moderate: 10, estimated: 15 },
  medium: { precise: 10, moderate: 15, estimated: 20 },
  low:    { precise: 15, moderate: 20, estimated: 30 },
};

function methodCategory(method: EstimationMethod): 'precise' | 'moderate' | 'estimated' {
  switch (method) {
    case 'official':
    case 'scraped':
      return 'precise';
    case 'ingredients':
      return 'moderate';
    case 'extrapolation':
    case 'llm':
      return 'estimated';
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Calculate the uncertainty range for a calorie value.
 *
 * Returns the range with min/max bounds and the percentage used.
 * Min is floored at 0 (calories can't be negative).
 */
export function calculateUncertainty(
  calories: number,
  confidenceLevel: ConfidenceLevel,
  estimationMethod: EstimationMethod,
): UncertaintyRange {
  const category = methodCategory(estimationMethod);
  const percentage = PERCENTAGE_MATRIX[confidenceLevel][category];
  const delta = Math.round(calories * percentage / 100);

  return {
    caloriesMin: Math.max(0, calories - delta),
    caloriesMax: calories + delta,
    percentage,
  };
}

/**
 * Compute uncertainty range from an EstimateResult.
 *
 * Returns an empty object when result is null, or
 * { uncertaintyRange: {...} } ready to spread into EstimateData.
 */
export function enrichWithUncertainty(
  result: {
    nutrients: { calories: number };
    confidenceLevel: ConfidenceLevel;
    estimationMethod: EstimationMethod;
  } | null,
): { uncertaintyRange?: UncertaintyRange } {
  if (result === null) return {};

  const range = calculateUncertainty(
    result.nutrients.calories,
    result.confidenceLevel,
    result.estimationMethod,
  );

  return { uncertaintyRange: range };
}
