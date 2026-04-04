// Level 2 Ingredient-Based Estimation — estimation engine second tier.
//
// Executes a 2-strategy cascade against dishes with resolvable ingredients:
//   1. Exact dish match (case-insensitive, optional chain/restaurant scope)
//   2. FTS dish match (Spanish primary, English fallback, same scope)
//
// Each strategy uses a CTE to de-duplicate food_nutrients rows per food
// (most recent wins, filtered to per_100g only). Nutrient aggregation:
//   SUM(fn.[nutrient] * di.gram_weight / 100) for each resolvable ingredient.
//
// HAVING clause ensures only dishes with ≥1 resolvable ingredient are returned.
// Returns Level2Result with resolvedCount/totalCount for confidence scoring,
// or null if no dish with resolvable ingredients is found.
//
// See: ADR-001 (confidence strategy), ADR-000 (Kysely for complex queries)

import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { DB } from '../generated/kysely-types.js';
import type {
  Level2LookupOptions,
  Level2Result,
  IngredientNutrientRow,
} from './types.js';
import { mapLevel2RowToResult } from './types.js';

// ---------------------------------------------------------------------------
// Query normalization
// ---------------------------------------------------------------------------

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

// ---------------------------------------------------------------------------
// Scope clause helper
// Identical to Level 1 — do NOT extract to shared utility (F023 scope).
// ---------------------------------------------------------------------------

function buildScopeClause(options: Level2LookupOptions) {
  const { restaurantId, chainSlug } = options;
  return restaurantId !== undefined
    ? sql`AND r.id = ${restaurantId}::uuid`
    : chainSlug !== undefined
      ? sql`AND r.chain_slug = ${chainSlug}`
      : sql``;
}

// ---------------------------------------------------------------------------
// Strategy 1 — Exact dish match
// ---------------------------------------------------------------------------

async function exactIngredientDishMatch(
  db: Kysely<DB>,
  normalizedQuery: string,
  options: Level2LookupOptions,
): Promise<IngredientNutrientRow | undefined> {
  const scopeClause = buildScopeClause(options);

  const result = await sql<IngredientNutrientRow>`
    WITH ranked_fn AS (
      SELECT fn.*,
             ROW_NUMBER() OVER (PARTITION BY fn.food_id ORDER BY fn.created_at DESC) AS rn
      FROM food_nutrients fn
      WHERE fn.reference_basis = 'per_100g'
    )
    SELECT
      d.id              AS dish_id,
      d.name            AS dish_name,
      d.name_es         AS dish_name_es,
      d.restaurant_id,
      r.chain_slug,
      d.portion_grams::text AS portion_grams,
      d.source_id::text AS dish_source_id,
      COUNT(di.id)::text AS total_count,
      COUNT(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN 1 END)::text AS resolved_count,
      SUM(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN rfn.calories     * di.gram_weight / 100 ELSE 0 END)::text AS calories,
      SUM(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN rfn.proteins     * di.gram_weight / 100 ELSE 0 END)::text AS proteins,
      SUM(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN rfn.carbohydrates * di.gram_weight / 100 ELSE 0 END)::text AS carbohydrates,
      SUM(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN rfn.sugars       * di.gram_weight / 100 ELSE 0 END)::text AS sugars,
      SUM(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN rfn.fats         * di.gram_weight / 100 ELSE 0 END)::text AS fats,
      SUM(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN rfn.saturated_fats * di.gram_weight / 100 ELSE 0 END)::text AS saturated_fats,
      SUM(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN rfn.fiber        * di.gram_weight / 100 ELSE 0 END)::text AS fiber,
      SUM(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN rfn.salt         * di.gram_weight / 100 ELSE 0 END)::text AS salt,
      SUM(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN rfn.sodium       * di.gram_weight / 100 ELSE 0 END)::text AS sodium,
      SUM(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN rfn.trans_fats   * di.gram_weight / 100 ELSE 0 END)::text AS trans_fats,
      SUM(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN rfn.cholesterol  * di.gram_weight / 100 ELSE 0 END)::text AS cholesterol,
      SUM(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN rfn.potassium    * di.gram_weight / 100 ELSE 0 END)::text AS potassium,
      SUM(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN rfn.monounsaturated_fats * di.gram_weight / 100 ELSE 0 END)::text AS monounsaturated_fats,
      SUM(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN rfn.polyunsaturated_fats * di.gram_weight / 100 ELSE 0 END)::text AS polyunsaturated_fats,
      SUM(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN rfn.alcohol * di.gram_weight / 100 ELSE 0 END)::text AS alcohol
    FROM dishes d
    JOIN restaurants r ON r.id = d.restaurant_id
    JOIN dish_ingredients di ON di.dish_id = d.id
    LEFT JOIN ranked_fn rfn ON rfn.food_id = di.ingredient_food_id AND rfn.rn = 1
    WHERE (
      LOWER(d.name) = LOWER(${normalizedQuery})
      OR LOWER(d.name_es) = LOWER(${normalizedQuery})
      OR d.aliases @> ARRAY[${normalizedQuery}]
    )
    ${scopeClause}
    GROUP BY d.id, d.name, d.name_es, d.restaurant_id, r.chain_slug, d.portion_grams, d.source_id
    HAVING COUNT(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN 1 END) > 0
    LIMIT 1
  `.execute(db);

  return result.rows[0];
}

// ---------------------------------------------------------------------------
// Strategy 2 — FTS dish match
// ---------------------------------------------------------------------------

async function ftsIngredientDishMatch(
  db: Kysely<DB>,
  normalizedQuery: string,
  options: Level2LookupOptions,
): Promise<IngredientNutrientRow | undefined> {
  const scopeClause = buildScopeClause(options);

  const result = await sql<IngredientNutrientRow>`
    WITH ranked_fn AS (
      SELECT fn.*,
             ROW_NUMBER() OVER (PARTITION BY fn.food_id ORDER BY fn.created_at DESC) AS rn
      FROM food_nutrients fn
      WHERE fn.reference_basis = 'per_100g'
    )
    SELECT
      d.id              AS dish_id,
      d.name            AS dish_name,
      d.name_es         AS dish_name_es,
      d.restaurant_id,
      r.chain_slug,
      d.portion_grams::text AS portion_grams,
      d.source_id::text AS dish_source_id,
      COUNT(di.id)::text AS total_count,
      COUNT(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN 1 END)::text AS resolved_count,
      SUM(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN rfn.calories     * di.gram_weight / 100 ELSE 0 END)::text AS calories,
      SUM(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN rfn.proteins     * di.gram_weight / 100 ELSE 0 END)::text AS proteins,
      SUM(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN rfn.carbohydrates * di.gram_weight / 100 ELSE 0 END)::text AS carbohydrates,
      SUM(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN rfn.sugars       * di.gram_weight / 100 ELSE 0 END)::text AS sugars,
      SUM(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN rfn.fats         * di.gram_weight / 100 ELSE 0 END)::text AS fats,
      SUM(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN rfn.saturated_fats * di.gram_weight / 100 ELSE 0 END)::text AS saturated_fats,
      SUM(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN rfn.fiber        * di.gram_weight / 100 ELSE 0 END)::text AS fiber,
      SUM(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN rfn.salt         * di.gram_weight / 100 ELSE 0 END)::text AS salt,
      SUM(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN rfn.sodium       * di.gram_weight / 100 ELSE 0 END)::text AS sodium,
      SUM(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN rfn.trans_fats   * di.gram_weight / 100 ELSE 0 END)::text AS trans_fats,
      SUM(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN rfn.cholesterol  * di.gram_weight / 100 ELSE 0 END)::text AS cholesterol,
      SUM(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN rfn.potassium    * di.gram_weight / 100 ELSE 0 END)::text AS potassium,
      SUM(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN rfn.monounsaturated_fats * di.gram_weight / 100 ELSE 0 END)::text AS monounsaturated_fats,
      SUM(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN rfn.polyunsaturated_fats * di.gram_weight / 100 ELSE 0 END)::text AS polyunsaturated_fats,
      SUM(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN rfn.alcohol * di.gram_weight / 100 ELSE 0 END)::text AS alcohol
    FROM dishes d
    JOIN restaurants r ON r.id = d.restaurant_id
    JOIN dish_ingredients di ON di.dish_id = d.id
    LEFT JOIN ranked_fn rfn ON rfn.food_id = di.ingredient_food_id AND rfn.rn = 1
    WHERE (
      to_tsvector('spanish', COALESCE(d.name_es, d.name)) @@ plainto_tsquery('spanish', ${normalizedQuery})
      OR to_tsvector('english', d.name) @@ plainto_tsquery('english', ${normalizedQuery})
    )
    ${scopeClause}
    GROUP BY d.id, d.name, d.name_es, d.restaurant_id, r.chain_slug, d.portion_grams, d.source_id
    HAVING COUNT(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN 1 END) > 0
    LIMIT 1
  `.execute(db);

  return result.rows[0];
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Execute the Level 2 ingredient-based estimation cascade.
 *
 * Tries 2 strategies in order; returns Level2Result with the first match
 * that has ≥1 resolvable ingredient, or null if all miss or none resolve.
 * Throws with code='DB_UNAVAILABLE' on database errors.
 *
 * @param db      - Kysely DB instance
 * @param query   - Raw query string (will be normalized internally)
 * @param options - Optional chain/restaurant scoping
 */
export async function level2Lookup(
  db: Kysely<DB>,
  query: string,
  options: Level2LookupOptions,
): Promise<Level2Result | null> {
  const normalizedQuery = normalizeQuery(query);

  try {
    // Strategy 1: exact dish with resolvable ingredients
    const exactRow = await exactIngredientDishMatch(db, normalizedQuery, options);
    if (exactRow !== undefined) {
      // Defensive guard: HAVING should prevent resolved_count=0, but return null if it happens
      if (exactRow.resolved_count === '0') {
        return null;
      }
      const { result, resolvedCount, totalCount } = mapLevel2RowToResult(exactRow);
      return {
        matchType: 'ingredient_dish_exact',
        result,
        resolvedCount,
        totalCount,
        ingredientSources: [],
      };
    }

    // Strategy 2: FTS dish with resolvable ingredients
    const ftsRow = await ftsIngredientDishMatch(db, normalizedQuery, options);
    if (ftsRow !== undefined) {
      // Defensive guard: HAVING should prevent this, but be explicit
      if (ftsRow.resolved_count === '0') {
        return null;
      }
      const { result, resolvedCount, totalCount } = mapLevel2RowToResult(ftsRow);
      return {
        matchType: 'ingredient_dish_fts',
        result,
        resolvedCount,
        totalCount,
        ingredientSources: [],
      };
    }

    return null;
  } catch (err) {
    throw Object.assign(
      new Error('Database query failed'),
      { code: 'DB_UNAVAILABLE', cause: err },
    );
  }
}
