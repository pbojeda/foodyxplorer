// Barrel export for the estimation module (E003).
//
// Exports level1Lookup, level2Lookup, and internal types for consumption by:
// - GET /estimate route (F020, F021)
// - F023 Engine Router (will call lookups directly, not via HTTP)

export { level1Lookup } from './level1Lookup.js';
export { level2Lookup } from './level2Lookup.js';
export type {
  Level1LookupOptions,
  Level1Result,
  Level2LookupOptions,
  Level2Result,
  DishQueryRow,
  FoodQueryRow,
  IngredientNutrientRow,
} from './types.js';
