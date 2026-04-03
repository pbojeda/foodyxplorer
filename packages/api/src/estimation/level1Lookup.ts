// Level 1 Official Data Lookup — estimation engine first tier.
//
// Executes a 4-strategy cascade against dishes and foods tables:
//   1. Exact dish match (case-insensitive, optional chain/restaurant scope)
//   2. FTS dish match (Spanish primary, English fallback, same scope)
//   3. Exact food match (no chain scope — foods are chain-agnostic)
//   4. FTS food match (no chain scope)
//
// Each strategy uses a CTE to de-duplicate nutrient rows (most recent wins).
// Returns the first successful result as Level1Result, or null if all miss.
//
// F068: Results ordered by data_sources.priority_tier ASC NULLS LAST (ADR-015).
// When hasExplicitBrand=true, first attempt filters to Tier 0 only; falls through
// to unfiltered cascade if no Tier 0 match found.
//
// See: ADR-001 (confidence strategy), ADR-000 (Kysely for complex queries),
//      ADR-015 (provenance graph, priority tier)

import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { DB } from '../generated/kysely-types.js';
import type { Level1LookupOptions, Level1Result, DishQueryRow, FoodQueryRow } from './types.js';
import { mapDishRowToResult, mapFoodRowToResult } from './types.js';

// ---------------------------------------------------------------------------
// Query normalization
// ---------------------------------------------------------------------------

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

// ---------------------------------------------------------------------------
// Strategy 1 — Exact dish match
// ---------------------------------------------------------------------------

async function exactDishMatch(
  db: Kysely<DB>,
  normalizedQuery: string,
  options: Level1LookupOptions,
  tierFilter?: number,
): Promise<DishQueryRow | undefined> {
  const { restaurantId, chainSlug } = options;

  const scopeClause = restaurantId !== undefined
    ? sql`AND r.id = ${restaurantId}::uuid`
    : chainSlug !== undefined
      ? sql`AND r.chain_slug = ${chainSlug}`
      : sql``;

  const tierClause = tierFilter !== undefined
    ? sql`AND ds.priority_tier = ${tierFilter}`
    : sql``;

  const result = await sql<DishQueryRow>`
    WITH ranked_dn AS (
      SELECT dn.*,
             ROW_NUMBER() OVER (PARTITION BY dn.dish_id ORDER BY dn.created_at DESC) AS rn
      FROM dish_nutrients dn
    )
    SELECT
      d.id          AS dish_id,
      d.name        AS dish_name,
      d.name_es     AS dish_name_es,
      d.restaurant_id,
      r.chain_slug,
      d.portion_grams::text AS portion_grams,
      rdn.calories::text,
      rdn.proteins::text,
      rdn.carbohydrates::text,
      rdn.sugars::text,
      rdn.fats::text,
      rdn.saturated_fats::text,
      rdn.fiber::text,
      rdn.salt::text,
      rdn.sodium::text,
      rdn.trans_fats::text,
      rdn.cholesterol::text,
      rdn.potassium::text,
      rdn.monounsaturated_fats::text,
      rdn.polyunsaturated_fats::text,
      rdn.reference_basis::text,
      ds.id         AS source_id,
      ds.name       AS source_name,
      ds.type::text AS source_type,
      ds.url        AS source_url,
      ds.priority_tier::text AS source_priority_tier
    FROM dishes d
    JOIN restaurants r ON r.id = d.restaurant_id
    JOIN ranked_dn rdn ON rdn.dish_id = d.id AND rdn.rn = 1
    JOIN data_sources ds ON ds.id = rdn.source_id
    WHERE LOWER(d.name) = LOWER(${normalizedQuery})
    ${scopeClause}
    ${tierClause}
    ORDER BY ds.priority_tier ASC NULLS LAST
    LIMIT 1
  `.execute(db);

  return result.rows[0];
}

// ---------------------------------------------------------------------------
// Strategy 2 — FTS dish match
// ---------------------------------------------------------------------------

async function ftsDishMatch(
  db: Kysely<DB>,
  normalizedQuery: string,
  options: Level1LookupOptions,
  tierFilter?: number,
): Promise<DishQueryRow | undefined> {
  const { restaurantId, chainSlug } = options;

  const scopeClause = restaurantId !== undefined
    ? sql`AND r.id = ${restaurantId}::uuid`
    : chainSlug !== undefined
      ? sql`AND r.chain_slug = ${chainSlug}`
      : sql``;

  const tierClause = tierFilter !== undefined
    ? sql`AND ds.priority_tier = ${tierFilter}`
    : sql``;

  const result = await sql<DishQueryRow>`
    WITH ranked_dn AS (
      SELECT dn.*,
             ROW_NUMBER() OVER (PARTITION BY dn.dish_id ORDER BY dn.created_at DESC) AS rn
      FROM dish_nutrients dn
    )
    SELECT
      d.id          AS dish_id,
      d.name        AS dish_name,
      d.name_es     AS dish_name_es,
      d.restaurant_id,
      r.chain_slug,
      d.portion_grams::text AS portion_grams,
      rdn.calories::text,
      rdn.proteins::text,
      rdn.carbohydrates::text,
      rdn.sugars::text,
      rdn.fats::text,
      rdn.saturated_fats::text,
      rdn.fiber::text,
      rdn.salt::text,
      rdn.sodium::text,
      rdn.trans_fats::text,
      rdn.cholesterol::text,
      rdn.potassium::text,
      rdn.monounsaturated_fats::text,
      rdn.polyunsaturated_fats::text,
      rdn.reference_basis::text,
      ds.id         AS source_id,
      ds.name       AS source_name,
      ds.type::text AS source_type,
      ds.url        AS source_url,
      ds.priority_tier::text AS source_priority_tier
    FROM dishes d
    JOIN restaurants r ON r.id = d.restaurant_id
    JOIN ranked_dn rdn ON rdn.dish_id = d.id AND rdn.rn = 1
    JOIN data_sources ds ON ds.id = rdn.source_id
    WHERE (
      to_tsvector('spanish', COALESCE(d.name_es, d.name)) @@ plainto_tsquery('spanish', ${normalizedQuery})
      OR to_tsvector('english', d.name) @@ plainto_tsquery('english', ${normalizedQuery})
    )
    ${scopeClause}
    ${tierClause}
    ORDER BY ds.priority_tier ASC NULLS LAST, length(COALESCE(d.name_es, d.name)) ASC
    LIMIT 1
  `.execute(db);

  return result.rows[0];
}

// ---------------------------------------------------------------------------
// Strategy 3 — Exact food match (no chain scope)
// ---------------------------------------------------------------------------

async function exactFoodMatch(
  db: Kysely<DB>,
  normalizedQuery: string,
  tierFilter?: number,
): Promise<FoodQueryRow | undefined> {
  const tierClause = tierFilter !== undefined
    ? sql`AND ds.priority_tier = ${tierFilter}`
    : sql``;

  const result = await sql<FoodQueryRow>`
    WITH ranked_fn AS (
      SELECT fn.*,
             ROW_NUMBER() OVER (PARTITION BY fn.food_id ORDER BY fn.created_at DESC) AS rn
      FROM food_nutrients fn
    )
    SELECT
      f.id          AS food_id,
      f.name        AS food_name,
      f.name_es     AS food_name_es,
      f.food_group  AS food_group,
      rfn.calories::text,
      rfn.proteins::text,
      rfn.carbohydrates::text,
      rfn.sugars::text,
      rfn.fats::text,
      rfn.saturated_fats::text,
      rfn.fiber::text,
      rfn.salt::text,
      rfn.sodium::text,
      rfn.trans_fats::text,
      rfn.cholesterol::text,
      rfn.potassium::text,
      rfn.monounsaturated_fats::text,
      rfn.polyunsaturated_fats::text,
      rfn.reference_basis::text,
      ds.id         AS source_id,
      ds.name       AS source_name,
      ds.type::text AS source_type,
      ds.url        AS source_url,
      ds.priority_tier::text AS source_priority_tier
    FROM foods f
    JOIN ranked_fn rfn ON rfn.food_id = f.id AND rfn.rn = 1
    JOIN data_sources ds ON ds.id = rfn.source_id
    WHERE (LOWER(f.name_es) = LOWER(${normalizedQuery})
       OR LOWER(f.name) = LOWER(${normalizedQuery}))
    ${tierClause}
    ORDER BY ds.priority_tier ASC NULLS LAST
    LIMIT 1
  `.execute(db);

  return result.rows[0];
}

// ---------------------------------------------------------------------------
// Strategy 4 — FTS food match (no chain scope)
// ---------------------------------------------------------------------------

async function ftsFoodMatch(
  db: Kysely<DB>,
  normalizedQuery: string,
  tierFilter?: number,
): Promise<FoodQueryRow | undefined> {
  const tierClause = tierFilter !== undefined
    ? sql`AND ds.priority_tier = ${tierFilter}`
    : sql``;

  const result = await sql<FoodQueryRow>`
    WITH ranked_fn AS (
      SELECT fn.*,
             ROW_NUMBER() OVER (PARTITION BY fn.food_id ORDER BY fn.created_at DESC) AS rn
      FROM food_nutrients fn
    )
    SELECT
      f.id          AS food_id,
      f.name        AS food_name,
      f.name_es     AS food_name_es,
      f.food_group  AS food_group,
      rfn.calories::text,
      rfn.proteins::text,
      rfn.carbohydrates::text,
      rfn.sugars::text,
      rfn.fats::text,
      rfn.saturated_fats::text,
      rfn.fiber::text,
      rfn.salt::text,
      rfn.sodium::text,
      rfn.trans_fats::text,
      rfn.cholesterol::text,
      rfn.potassium::text,
      rfn.monounsaturated_fats::text,
      rfn.polyunsaturated_fats::text,
      rfn.reference_basis::text,
      ds.id         AS source_id,
      ds.name       AS source_name,
      ds.type::text AS source_type,
      ds.url        AS source_url,
      ds.priority_tier::text AS source_priority_tier
    FROM foods f
    JOIN ranked_fn rfn ON rfn.food_id = f.id AND rfn.rn = 1
    JOIN data_sources ds ON ds.id = rfn.source_id
    WHERE (to_tsvector('spanish', f.name_es) @@ plainto_tsquery('spanish', ${normalizedQuery})
       OR to_tsvector('english', f.name) @@ plainto_tsquery('english', ${normalizedQuery}))
    ${tierClause}
    ORDER BY ds.priority_tier ASC NULLS LAST, length(COALESCE(f.name_es, f.name)) ASC
    LIMIT 1
  `.execute(db);

  return result.rows[0];
}

// ---------------------------------------------------------------------------
// Internal cascade runner
// ---------------------------------------------------------------------------

/**
 * Run the 4-strategy cascade with optional tier filtering.
 */
async function runCascade(
  db: Kysely<DB>,
  normalizedQuery: string,
  options: Level1LookupOptions,
  tierFilter?: number,
): Promise<Level1Result | null> {
  // Strategy 1: exact dish
  const exactDishRow = await exactDishMatch(db, normalizedQuery, options, tierFilter);
  if (exactDishRow !== undefined) {
    return { matchType: 'exact_dish', result: mapDishRowToResult(exactDishRow), rawFoodGroup: null };
  }

  // Strategy 2: FTS dish
  const ftsDishRow = await ftsDishMatch(db, normalizedQuery, options, tierFilter);
  if (ftsDishRow !== undefined) {
    return { matchType: 'fts_dish', result: mapDishRowToResult(ftsDishRow), rawFoodGroup: null };
  }

  // Strategy 3: exact food (no chain scope)
  const exactFoodRow = await exactFoodMatch(db, normalizedQuery, tierFilter);
  if (exactFoodRow !== undefined) {
    return { matchType: 'exact_food', result: mapFoodRowToResult(exactFoodRow), rawFoodGroup: exactFoodRow.food_group };
  }

  // Strategy 4: FTS food (no chain scope)
  const ftsFoodRow = await ftsFoodMatch(db, normalizedQuery, tierFilter);
  if (ftsFoodRow !== undefined) {
    return { matchType: 'fts_food', result: mapFoodRowToResult(ftsFoodRow), rawFoodGroup: ftsFoodRow.food_group };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Execute the Level 1 official data lookup cascade.
 *
 * Tries 4 strategies in order; returns the first match or null if all miss.
 * Results are ordered by priority_tier ASC NULLS LAST (ADR-015, F068).
 *
 * When hasExplicitBrand=true (F068): first pass filters to Tier 0 only.
 * If no Tier 0 match → falls through to normal (unfiltered) cascade.
 *
 * Throws with code='DB_UNAVAILABLE' on database errors.
 *
 * @param db     - Kysely DB instance
 * @param query  - Raw query string (will be normalized internally)
 * @param options - Optional chain/restaurant scoping + brand flag
 */
export async function level1Lookup(
  db: Kysely<DB>,
  query: string,
  options: Level1LookupOptions,
): Promise<Level1Result | null> {
  const normalizedQuery = normalizeQuery(query);

  try {
    // F068: Branded query → try Tier 0 first
    if (options.hasExplicitBrand === true) {
      const tier0Result = await runCascade(db, normalizedQuery, options, 0);
      if (tier0Result !== null) {
        return tier0Result;
      }
      // Fall through to unfiltered cascade
    }

    // Normal cascade (ordered by priority_tier)
    return await runCascade(db, normalizedQuery, options);
  } catch (err) {
    throw Object.assign(
      new Error('Database query failed'),
      { code: 'DB_UNAVAILABLE', cause: err },
    );
  }
}
