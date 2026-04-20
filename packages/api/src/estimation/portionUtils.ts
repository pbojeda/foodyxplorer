// Pure utilities for portion-related calculations.
//
// - computeDisplayPieces  — F-UX-B low-multiplier fall-through (spec v2.1)
// - applyPortionMultiplier — F042 nutrient/grams scaling (kept pure, unmodified)
//
// Extracted from routes/estimate.ts (F070) so both the GET /estimate route
// and EstimationOrchestrator can import it without duplication.

import type { EstimateResult, EstimateNutrients, PortionAssumption } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// computeDisplayPieces (F-UX-B)
// ---------------------------------------------------------------------------

/**
 * Convert a scaled piece count into the displayable integer, applying the
 * low-multiplier fall-through rule from spec v2.1.
 *
 * Rule:
 *  - `scaledPieces === null`              → null  (non-countable dish)
 *  - `scaledPieces < 0.75`               → null  (fall-through: avoid false precision)
 *  - `scaledPieces >= 0.75`              → Math.max(1, Math.round(scaledPieces))
 *
 * The 0.75 threshold is the smallest value that rounds to 1 without
 * noticeably lying — displaying ~1 for 0.8 of a piece is acceptable, but
 * displaying ~1 for 0.5 of a piece is not. The Math.max(1, ...) guard is
 * defensive against data bugs (basePieces = 0 would be rejected by the seed
 * schema, but we protect at this boundary anyway).
 *
 * This function lives here (portionUtils) — NOT inside applyPortionMultiplier,
 * which stays a pure nutrient/grams scaler with no piece-display responsibility.
 */
export function computeDisplayPieces(scaledPieces: number | null): number | null {
  if (scaledPieces === null) return null;
  if (scaledPieces < 0.75) return null;
  return Math.max(1, Math.round(scaledPieces));
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const NUMERIC_NUTRIENT_KEYS: ReadonlyArray<keyof Omit<EstimateNutrients, 'referenceBasis'>> =
  [
    'calories',
    'proteins',
    'carbohydrates',
    'sugars',
    'fats',
    'saturatedFats',
    'fiber',
    'salt',
    'sodium',
    'transFats',
    'cholesterol',
    'potassium',
    'monounsaturatedFats',
    'polyunsaturatedFats',
    'alcohol',
  ];

// ---------------------------------------------------------------------------
// applyPortionAssumptionScaling (BUG-PROD-011)
// ---------------------------------------------------------------------------

/**
 * Scale nutrients and portionGrams by the ratio portionAssumption.grams / result.portionGrams.
 * Returns the scaled result, or `null` when no scaling is needed:
 *  - source is not 'per_dish' (Tier 3 generic remains label-only)
 *  - result.portionGrams is null (no base to ratio against)
 *  - grams are equal (ratio=1, no scaling needed)
 *
 * Pure function — does not mutate the input result.
 */
export function applyPortionAssumptionScaling(
  result: EstimateResult,
  portionAssumption: PortionAssumption,
): EstimateResult | null {
  if (portionAssumption.source !== 'per_dish') return null;
  if (result.portionGrams === null) return null;
  if (portionAssumption.grams === result.portionGrams) return null;

  const ratio = portionAssumption.grams / result.portionGrams;
  const scaledNutrients = { ...result.nutrients };
  for (const key of NUMERIC_NUTRIENT_KEYS) {
    scaledNutrients[key] = Math.round(scaledNutrients[key] * ratio * 100) / 100;
  }

  return {
    ...result,
    portionGrams: portionAssumption.grams,
    nutrients: scaledNutrients,
  };
}

// ---------------------------------------------------------------------------
// applyPortionMultiplier
// ---------------------------------------------------------------------------

/**
 * Scale all numeric nutrient values and portionGrams by `multiplier`.
 * Always sets referenceBasis to 'per_serving'.
 * Pure function — does not mutate the input result.
 */
export function applyPortionMultiplier(
  result: EstimateResult,
  multiplier: number,
): EstimateResult {
  const scaledNutrients = { ...result.nutrients };
  for (const key of NUMERIC_NUTRIENT_KEYS) {
    scaledNutrients[key] = Math.round(scaledNutrients[key] * multiplier * 100) / 100;
  }
  scaledNutrients.referenceBasis = 'per_serving';

  return {
    ...result,
    portionGrams:
      result.portionGrams !== null
        ? Math.round(result.portionGrams * multiplier * 10) / 10
        : null,
    nutrients: scaledNutrients,
  };
}
