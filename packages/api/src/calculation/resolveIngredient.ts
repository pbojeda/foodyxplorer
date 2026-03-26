// resolveIngredient — food-only resolver for recipe ingredients (F035).
//
// Exports two functions:
//   resolveIngredientL1(db, input)                             — fast, DB-only (no OpenAI)
//   resolveIngredientL3L4(db, input, openAiApiKey, signal?)   — similarity + LLM (sequential)
//
// Resolution cascade (food-only — no dish strategies):
//   1. direct_id  — if foodId provided: UUID lookup in food_nutrients. Miss → immediately unresolved.
//   2. exact_food — case-insensitive match on foods.name_es or foods.name
//   3. fts_food   — FTS on foods.name_es / foods.name
//   4. similarity_food — pgvector cosine distance on food embeddings (threshold 0.5)
//   5. llm_food_match  — pg_trgm candidates + LLM selection
//
// All SQL queries filter reference_basis = 'per_100g' to ensure correct gram scaling.
// Ingredients that resolve to per_serving rows are marked unresolved.
//
// Per-ingredient DB errors bubble up as { code: 'DB_UNAVAILABLE' }.

import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { DB } from '../generated/kysely-types.js';
import type { FoodQueryRow } from '../estimation/types.js';
import type { EstimateMatchType } from '@foodxplorer/shared';
import {
  callChatCompletion,
  callOpenAIEmbeddingsOnce,
  type OpenAILogger,
} from '../lib/openaiClient.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IngredientInput {
  foodId?: string;
  name?: string;
  grams: number;
  portionMultiplier: number;
}

export interface ResolvedResult {
  resolved: true;
  matchType: EstimateMatchType;
  entityId: string;
  name: string;
  nameEs: string | null;
  nutrientRow: FoodQueryRow;
}

export interface UnresolvedResult {
  resolved: false;
}

export type ResolveIngredientResult = ResolvedResult | UnresolvedResult;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SIMILARITY_THRESHOLD = 0.5;
const MAX_TRIGRAM_CANDIDATES = 10;
const TRIGRAM_SIMILARITY_THRESHOLD = 0.1;
const SYSTEM_MESSAGE = 'You are a food identification assistant. Do not provide nutritional values. Only identify or decompose as instructed.';

// ---------------------------------------------------------------------------
// SQL helpers — food-only strategies with per_100g filter
// ---------------------------------------------------------------------------

async function fetchFoodByUuid(
  db: Kysely<DB>,
  foodId: string,
): Promise<FoodQueryRow | undefined> {
  const result = await sql<FoodQueryRow>`
    WITH ranked_fn AS (
      SELECT fn.*,
             ROW_NUMBER() OVER (PARTITION BY fn.food_id ORDER BY fn.created_at DESC) AS rn
      FROM food_nutrients fn
      WHERE fn.reference_basis = 'per_100g'
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
      ds.url        AS source_url
    FROM foods f
    JOIN ranked_fn rfn ON rfn.food_id = f.id AND rfn.rn = 1
    JOIN data_sources ds ON ds.id = rfn.source_id
    WHERE f.id = ${foodId}::uuid
    LIMIT 1
  `.execute(db);

  return result.rows[0];
}

async function exactFoodMatch(
  db: Kysely<DB>,
  name: string,
): Promise<FoodQueryRow | undefined> {
  const result = await sql<FoodQueryRow>`
    WITH ranked_fn AS (
      SELECT fn.*,
             ROW_NUMBER() OVER (PARTITION BY fn.food_id ORDER BY fn.created_at DESC) AS rn
      FROM food_nutrients fn
      WHERE fn.reference_basis = 'per_100g'
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
      ds.url        AS source_url
    FROM foods f
    JOIN ranked_fn rfn ON rfn.food_id = f.id AND rfn.rn = 1
    JOIN data_sources ds ON ds.id = rfn.source_id
    WHERE LOWER(f.name_es) = LOWER(${name})
       OR LOWER(f.name) = LOWER(${name})
    LIMIT 1
  `.execute(db);

  return result.rows[0];
}

async function ftsFoodMatch(
  db: Kysely<DB>,
  name: string,
): Promise<FoodQueryRow | undefined> {
  const result = await sql<FoodQueryRow>`
    WITH ranked_fn AS (
      SELECT fn.*,
             ROW_NUMBER() OVER (PARTITION BY fn.food_id ORDER BY fn.created_at DESC) AS rn
      FROM food_nutrients fn
      WHERE fn.reference_basis = 'per_100g'
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
      ds.url        AS source_url
    FROM foods f
    JOIN ranked_fn rfn ON rfn.food_id = f.id AND rfn.rn = 1
    JOIN data_sources ds ON ds.id = rfn.source_id
    WHERE to_tsvector('spanish', COALESCE(f.name_es, '')) @@ plainto_tsquery('spanish', ${name})
       OR to_tsvector('english', f.name) @@ plainto_tsquery('english', ${name})
    LIMIT 1
  `.execute(db);

  return result.rows[0];
}

async function foodSimilaritySearch(
  db: Kysely<DB>,
  vectorLiteral: string,
): Promise<{ food_id: string; distance: string } | undefined> {
  const result = await sql<{ food_id: string; distance: string }>`
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

async function fetchFoodNutrientsByUuid(
  db: Kysely<DB>,
  foodId: string,
): Promise<FoodQueryRow | undefined> {
  const result = await sql<FoodQueryRow>`
    WITH ranked_fn AS (
      SELECT fn.*,
             ROW_NUMBER() OVER (PARTITION BY fn.food_id ORDER BY fn.created_at DESC) AS rn
      FROM food_nutrients fn
      WHERE fn.reference_basis = 'per_100g'
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
      ds.url        AS source_url
    FROM foods f
    JOIN ranked_fn rfn ON rfn.food_id = f.id AND rfn.rn = 1
    JOIN data_sources ds ON ds.id = rfn.source_id
    WHERE f.id = ${foodId}::uuid
    LIMIT 1
  `.execute(db);

  return result.rows[0];
}

async function fetchCandidatesByTrigram(
  db: Kysely<DB>,
  name: string,
): Promise<Array<{ id: string; name: string; name_es: string | null }>> {
  const result = await sql<{ id: string; name: string; name_es: string | null }>`
    SELECT id::text AS id, name, name_es
    FROM foods
    WHERE similarity(COALESCE(name_es, name), ${name}) > ${TRIGRAM_SIMILARITY_THRESHOLD}
    ORDER BY similarity(COALESCE(name_es, name), ${name}) DESC
    LIMIT ${MAX_TRIGRAM_CANDIDATES}
  `.execute(db);

  return result.rows;
}

// ---------------------------------------------------------------------------
// resolveIngredientL1
// ---------------------------------------------------------------------------

/**
 * Resolve an ingredient using only fast, deterministic L1 strategies (no OpenAI).
 *
 * - If foodId provided → direct UUID lookup (matchType: 'direct_id'). Miss → immediately unresolved.
 * - If name provided → exact_food → fts_food.
 * - Only food_nutrients rows with reference_basis = 'per_100g' are returned.
 */
export async function resolveIngredientL1(
  db: Kysely<DB>,
  input: IngredientInput,
): Promise<ResolveIngredientResult> {
  try {
    if (input.foodId !== undefined) {
      // direct_id strategy — early return on miss (no cascade)
      const row = await fetchFoodByUuid(db, input.foodId);
      if (row === undefined || row.reference_basis !== 'per_100g') {
        return { resolved: false };
      }
      return {
        resolved: true,
        matchType: 'direct_id',
        entityId: row.food_id,
        name: row.food_name,
        nameEs: row.food_name_es,
        nutrientRow: row,
      };
    }

    // name-based strategies
    const name = input.name ?? '';

    // exact_food
    const exactRow = await exactFoodMatch(db, name);
    if (exactRow !== undefined) {
      return {
        resolved: true,
        matchType: 'exact_food',
        entityId: exactRow.food_id,
        name: exactRow.food_name,
        nameEs: exactRow.food_name_es,
        nutrientRow: exactRow,
      };
    }

    // fts_food
    const ftsRow = await ftsFoodMatch(db, name);
    if (ftsRow !== undefined) {
      return {
        resolved: true,
        matchType: 'fts_food',
        entityId: ftsRow.food_id,
        name: ftsRow.food_name,
        nameEs: ftsRow.food_name_es,
        nutrientRow: ftsRow,
      };
    }

    return { resolved: false };
  } catch (err) {
    throw Object.assign(
      new Error('Database query failed'),
      { code: 'DB_UNAVAILABLE', cause: err },
    );
  }
}

// ---------------------------------------------------------------------------
// resolveIngredientL3L4
// ---------------------------------------------------------------------------

/**
 * Resolve an ingredient using L3 (pgvector similarity) and L4 (LLM trigram + pick).
 * Called sequentially (one at a time) by the route handler after L1 miss.
 *
 * - L3: generate embedding via callOpenAIEmbeddingsOnce → cosine distance < 0.5.
 *   Skips gracefully if openAiApiKey undefined, embedding fails, or signal aborted.
 * - L4: pg_trgm candidates → LLM picks best (0-based index or 'none').
 *   Skips gracefully if key absent, LLM returns null, or signal aborted.
 * - Only per_100g rows are accepted.
 */
export async function resolveIngredientL3L4(
  db: Kysely<DB>,
  input: IngredientInput,
  openAiApiKey: string | undefined,
  signal?: AbortSignal,
  logger?: OpenAILogger,
): Promise<ResolveIngredientResult> {
  // Guard: skip all AI strategies if no API key
  if (openAiApiKey === undefined) {
    return { resolved: false };
  }

  const name = input.name ?? '';

  try {
    // --- L3: similarity_food ---
    if (!(signal?.aborted)) {
      const embedding = await callOpenAIEmbeddingsOnce(name, openAiApiKey, logger);
      if (embedding !== null) {
        const vectorLiteral = `[${embedding.join(',')}]`;
        const similarityRow = await foodSimilaritySearch(db, vectorLiteral);
        if (similarityRow !== undefined) {
          const distance = parseFloat(similarityRow.distance);
          if (distance < SIMILARITY_THRESHOLD) {
            const nutrientRow = await fetchFoodNutrientsByUuid(db, similarityRow.food_id);
            if (nutrientRow !== undefined && nutrientRow.reference_basis === 'per_100g') {
              return {
                resolved: true,
                matchType: 'similarity_food',
                entityId: nutrientRow.food_id,
                name: nutrientRow.food_name,
                nameEs: nutrientRow.food_name_es,
                nutrientRow,
              };
            }
          }
        }
      }
    }

    // --- L4: llm_food_match ---
    if (signal?.aborted) {
      return { resolved: false };
    }

    const candidates = await fetchCandidatesByTrigram(db, name);
    if (candidates.length === 0) {
      return { resolved: false };
    }

    const candidateList = candidates
      .map((c, i) => `${i}. ${c.name_es ?? c.name}`)
      .join('\n');

    const userMessage =
      `Query: '${name}'\n` +
      `Candidates (index starting at 0):\n${candidateList}\n\n` +
      `Reply with the 0-based index of the best match, or 'none' if no candidate matches well enough. Reply with only the number or 'none', no other text.`;

    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      { role: 'system', content: SYSTEM_MESSAGE },
      { role: 'user', content: userMessage },
    ];

    const response = await callChatCompletion(openAiApiKey, messages, logger);
    if (response === null) return { resolved: false };

    const trimmed = response.trim();
    if (trimmed === 'none') return { resolved: false };

    const idx = parseInt(trimmed, 10);
    if (isNaN(idx) || idx < 0 || idx >= candidates.length) {
      logger?.warn({ response: trimmed, candidateCount: candidates.length }, 'resolveIngredient L4: unexpected LLM response');
      return { resolved: false };
    }

    const selectedCandidate = candidates[idx];
    if (selectedCandidate === undefined) return { resolved: false };

    const nutrientRow = await fetchFoodNutrientsByUuid(db, selectedCandidate.id);
    if (nutrientRow === undefined || nutrientRow.reference_basis !== 'per_100g') {
      return { resolved: false };
    }

    return {
      resolved: true,
      matchType: 'llm_food_match',
      entityId: nutrientRow.food_id,
      name: nutrientRow.food_name,
      nameEs: nutrientRow.food_name_es,
      nutrientRow,
    };
  } catch (err) {
    throw Object.assign(
      new Error('Database query failed'),
      { code: 'DB_UNAVAILABLE', cause: err },
    );
  }
}
