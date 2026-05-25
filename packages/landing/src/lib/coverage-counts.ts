// F105 — Landing Coverage Showcase
// Hard-coded counts of nutriXplorer's catalog coverage, surfaced on the landing
// page as a quantitative trust signal.
//
// We deliberately do NOT import the seed JSON at runtime: the landing is a
// static export and bundling `usda-sr-legacy-foods.json` (~hundreds of KB)
// would inflate the bundle for a four-numbers display.
//
// Drift between these constants and the real seed-data is caught by
// `src/__tests__/coverage-counts.test.ts`, which reads the JSON at test time
// and fails the build if the numbers diverge.

/** Number of Spanish dishes mapped (spanish-dishes.json → dishes.length). */
export const DISHES_COUNT = 319;

/** Number of food atoms referenced: 514 USDA + 50 BEDCA-linked dishes. */
export const FOODS_COUNT = 564;

/** Number of culinary categories (desayunos/tapas/primeros/segundos/arroces/bocadillos/postres/bebidas/combinados/guarniciones). */
export const CATEGORIES_COUNT = 10;

/** Confidence tiers exposed in the engine (high/medium/low/estimated). */
export const CONFIDENCE_LEVELS_COUNT = 4;

export interface CoverageCounts {
  dishes: number;
  foods: number;
  categories: number;
  confidenceLevels: number;
}

export const COVERAGE_COUNTS: CoverageCounts = {
  dishes: DISHES_COUNT,
  foods: FOODS_COUNT,
  categories: CATEGORIES_COUNT,
  confidenceLevels: CONFIDENCE_LEVELS_COUNT,
};
