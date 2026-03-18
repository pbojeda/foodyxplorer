// Barrel export for the estimation module (E003).
//
// Exports level1Lookup and internal types for consumption by:
// - GET /estimate route (F020)
// - F023 Engine Router (will call level1Lookup directly, not via HTTP)

export { level1Lookup } from './level1Lookup.js';
export type {
  Level1LookupOptions,
  Level1Result,
  DishQueryRow,
  FoodQueryRow,
} from './types.js';
