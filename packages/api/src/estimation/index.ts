// Barrel export for the estimation module (E003).
//
// Exports level1Lookup, level2Lookup, level3Lookup, level4Lookup, and internal types for consumption by:
// - GET /estimate route (F020, F021, F022, F023, F024)
// - F023 Engine Router (runEstimationCascade)

export { level1Lookup } from './level1Lookup.js';
export { level2Lookup } from './level2Lookup.js';
export { level3Lookup } from './level3Lookup.js';
export { level4Lookup } from './level4Lookup.js';
export { runEstimationCascade } from './engineRouter.js';
export type { EngineRouterOptions, EngineRouterResult, Level4LookupFn } from './engineRouter.js';
export type {
  Level1LookupOptions,
  Level1Result,
  Level2LookupOptions,
  Level2Result,
  Level3LookupOptions,
  Level3Result,
  DishQueryRow,
  FoodQueryRow,
  IngredientNutrientRow,
  DishSimilarityRow,
  FoodSimilarityRow,
} from './types.js';
export { parseDecimal } from './types.js';
