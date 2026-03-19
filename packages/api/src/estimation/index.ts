// Barrel export for the estimation module (E003).
//
// Exports level1Lookup, level2Lookup, level3Lookup, and internal types for consumption by:
// - GET /estimate route (F020, F021, F022)
// - F023 Engine Router (will call lookups directly, not via HTTP)

export { level1Lookup } from './level1Lookup.js';
export { level2Lookup } from './level2Lookup.js';
export { level3Lookup } from './level3Lookup.js';
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
