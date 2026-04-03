// Pure utility for applying a portion multiplier to an EstimateResult.
//
// Extracted from routes/estimate.ts (F070) so both the GET /estimate route
// and EstimationOrchestrator can import it without duplication.

import type { EstimateResult, EstimateNutrients } from '@foodxplorer/shared';

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
  ];

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
