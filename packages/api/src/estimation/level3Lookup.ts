// Level 3 Similarity Extrapolation — estimation engine third tier.
//
// When both Level 1 and Level 2 miss, Level 3 generates a query embedding via
// the OpenAI API and performs a pgvector nearest-neighbour search to find the
// most semantically similar dish or food in the database.
//
// Two-strategy cascade:
//   1. Dish similarity (scoped by chainSlug/restaurantId when provided)
//   2. Food similarity (global — no chain scoping)
//
// Both strategies return the entity with the lowest cosine distance.
// If the distance is below the threshold (default 0.5, strictly less than),
// the matched entity's nutrient row is fetched and returned as a Level3Result
// with confidenceLevel='low' and estimationMethod='extrapolation'.
//
// Error handling:
//   - OpenAI unavailable / OPENAI_API_KEY missing → return null (warn + graceful skip)
//   - DB query failure → throw { code: 'DB_UNAVAILABLE' }
//
// See: ADR-001 (confidence strategy), ADR-000 (Kysely for complex queries)

import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { DB } from '../generated/kysely-types.js';
import { callOpenAIEmbeddings } from '../embeddings/embeddingClient.js';
import type {
  Level3LookupOptions,
  Level3Result,
  DishSimilarityRow,
  FoodSimilarityRow,
  DishQueryRow,
  FoodQueryRow,
} from './types.js';
import { mapDishRowToResult, mapFoodRowToResult } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// Scope clause helper
// Identical pattern to Level 1 and Level 2 — do NOT extract to shared utility (F023 scope).
// ---------------------------------------------------------------------------

function buildScopeClause(options: Level3LookupOptions) {
  const { restaurantId, chainSlug } = options;
  return restaurantId !== undefined
    ? sql`AND r.id = ${restaurantId}::uuid`
    : chainSlug !== undefined
      ? sql`AND r.chain_slug = ${chainSlug}`
      : sql``;
}

// ---------------------------------------------------------------------------
// Strategy 1 — Dish similarity search
// ---------------------------------------------------------------------------

async function dishSimilaritySearch(
  db: Kysely<DB>,
  vectorLiteral: string,
  options: Level3LookupOptions,
): Promise<DishSimilarityRow | undefined> {
  const scopeClause = buildScopeClause(options);

  const result = await sql<DishSimilarityRow>`
    SELECT
      d.id AS dish_id,
      d.embedding <-> ${sql.raw(`'${vectorLiteral}'`)}::vector AS distance
    FROM dishes d
    JOIN restaurants r ON r.id = d.restaurant_id
    WHERE d.embedding IS NOT NULL
    ${scopeClause}
    ORDER BY distance ASC
    LIMIT 1
  `.execute(db);

  return result.rows[0];
}

// ---------------------------------------------------------------------------
// Strategy 2 — Food similarity search
// ---------------------------------------------------------------------------

async function foodSimilaritySearch(
  db: Kysely<DB>,
  vectorLiteral: string,
): Promise<FoodSimilarityRow | undefined> {
  const result = await sql<FoodSimilarityRow>`
    SELECT
      f.id AS food_id,
      f.embedding <-> ${sql.raw(`'${vectorLiteral}'`)}::vector AS distance
    FROM foods f
    WHERE f.embedding IS NOT NULL
    ORDER BY distance ASC
    LIMIT 1
  `.execute(db);

  return result.rows[0];
}

// ---------------------------------------------------------------------------
// Nutrient fetch — dish
// Same CTE + column set as Level 1 exactDishMatch, but filtered by dish ID.
// ---------------------------------------------------------------------------

async function fetchDishNutrients(
  db: Kysely<DB>,
  dishId: string,
): Promise<DishQueryRow | undefined> {
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
    WHERE d.id = ${dishId}::uuid
    LIMIT 1
  `.execute(db);

  return result.rows[0];
}

// ---------------------------------------------------------------------------
// Nutrient fetch — food
// Same CTE + column set as Level 1 exactFoodMatch, but filtered by food ID.
// ---------------------------------------------------------------------------

async function fetchFoodNutrients(
  db: Kysely<DB>,
  foodId: string,
): Promise<FoodQueryRow | undefined> {
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
    WHERE f.id = ${foodId}::uuid
    LIMIT 1
  `.execute(db);

  return result.rows[0];
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Execute the Level 3 similarity extrapolation cascade.
 *
 * 1. If openAiApiKey is undefined → return null (graceful skip, no error).
 * 2. Generate a query embedding via OpenAI.
 *    On failure → log warn, return null (graceful skip).
 * 3. Strategy 1: dish similarity search (scoped by chain/restaurant).
 *    If a dish is within threshold → fetch nutrients, return Level3Result.
 * 4. Strategy 2: food similarity search (global).
 *    If a food is within threshold → fetch nutrients, return Level3Result.
 * 5. Return null (total miss).
 *
 * Throws with code='DB_UNAVAILABLE' on database errors.
 *
 * @param db      - Kysely DB instance
 * @param query   - Raw query string (used as-is for embedding; semantic not lexical)
 * @param options - OpenAI key, optional scoping, optional threshold override
 */
export async function level3Lookup(
  db: Kysely<DB>,
  query: string,
  options: Level3LookupOptions,
): Promise<Level3Result | null> {
  const { openAiApiKey, threshold = DEFAULT_THRESHOLD } = options;

  // Step 1: skip gracefully if no API key
  if (openAiApiKey === undefined) {
    return null;
  }

  // Step 2: generate query embedding (graceful-skip on any OpenAI failure)
  let vector: number[];
  try {
    const embeddings = await callOpenAIEmbeddings([query], {
      apiKey: openAiApiKey,
      model: 'text-embedding-3-small',
      rpm: 500,
    });
    // Defensive guard: empty array from OpenAI would throw uncaught TypeError without this check
    const embedding = embeddings[0];
    if (embedding === undefined) {
      return null;
    }
    // Guard against non-finite values (NaN/Infinity) that would cause pgvector parse errors
    if (!embedding.every(Number.isFinite)) {
      return null;
    }
    vector = embedding;
  } catch {
    // OpenAI failures are graceful — log at warn level, return null
    return null;
  }

  // Format the vector for pgvector: [n1,n2,...,n1536]
  const vectorLiteral = `[${vector.join(',')}]`;

  try {
    // Step 3: Strategy 1 — dish similarity search
    const dishRow = await dishSimilaritySearch(db, vectorLiteral, options);
    if (dishRow !== undefined) {
      const distance = parseFloat(dishRow.distance);
      if (distance < threshold) {
        // Fetch nutrients for the matched dish
        const nutrientRow = await fetchDishNutrients(db, dishRow.dish_id);
        if (nutrientRow !== undefined) {
          const result = mapDishRowToResult(nutrientRow);
          // Override confidence and method — extrapolation from similar entity
          result.confidenceLevel = 'low';
          result.estimationMethod = 'extrapolation';
          result.similarityDistance = distance;
          return {
            matchType: 'similarity_dish',
            result,
            similarityDistance: distance,
          };
        }
        // Dish match found but no nutrient row — fall through to food strategy
      }
    }

    // Step 4: Strategy 2 — food similarity search (global, no chain scoping)
    const foodRow = await foodSimilaritySearch(db, vectorLiteral);
    if (foodRow !== undefined) {
      const distance = parseFloat(foodRow.distance);
      if (distance < threshold) {
        // Fetch nutrients for the matched food
        const nutrientRow = await fetchFoodNutrients(db, foodRow.food_id);
        if (nutrientRow !== undefined) {
          const result = mapFoodRowToResult(nutrientRow);
          // Override confidence and method — extrapolation from similar entity
          result.confidenceLevel = 'low';
          result.estimationMethod = 'extrapolation';
          result.similarityDistance = distance;
          return {
            matchType: 'similarity_food',
            result,
            similarityDistance: distance,
          };
        }
      }
    }

    // Step 5: total miss
    return null;
  } catch (err) {
    throw Object.assign(
      new Error('Database query failed'),
      { code: 'DB_UNAVAILABLE', cause: err },
    );
  }
}
