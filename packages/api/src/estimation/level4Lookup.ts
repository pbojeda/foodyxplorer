// Level 4 LLM Integration Layer — estimation engine fourth tier.
//
// Activates only when L1, L2, and L3 all miss. The LLM never calculates
// nutritional values (ADR-001: "Motor calculates, LLM interprets"). Its sole
// role is to interpret the natural language query and map it to a known entity.
//
// Two strategies are tried in order:
//
// Strategy A — llm_food_match:
//   Fetches top-10 candidate foods via pg_trgm trigram similarity.
//   Asks LLM to identify the best match by 0-based index or 'none'.
//   Fetches nutrients for the matched food and returns a food result.
//
// Strategy B — llm_ingredient_decomposition:
//   Asks LLM to decompose the query into ingredient names with gram weights.
//   Resolves each ingredient via L1-style exact/FTS lookup.
//   Aggregates nutrients using L2-style arithmetic: SUM(nutrient_per_100g * g / 100).
//
// Fail-gracefully conditions (return null, never throw):
//   - OPENAI_API_KEY or OPENAI_CHAT_MODEL not set.
//   - OpenAI call fails after 2 total attempts (1 initial + 1 retry on 429/5xx).
//   - LLM response cannot be parsed.
//   - Resolved food UUID not found in food_nutrients.
//   - Zero ingredients resolved in Strategy B.
//
// DB errors from Kysely sql execution are re-thrown as { code: 'DB_UNAVAILABLE' }.
//
// See: ADR-001 (Motor calculates, LLM interprets), F024 spec.

import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import OpenAI from 'openai';
import type { DB } from '../generated/kysely-types.js';
import { config } from '../config.js';
import type { EstimateMatchType, EstimateResult } from '@foodxplorer/shared';
import type { Level4LookupFn } from './engineRouter.js';
import type { FoodQueryRow } from './types.js';
import { mapFoodRowToResult, parseDecimal } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LLM_SOURCE_ID = '00000000-0000-0000-0000-000000000017';
const LLM_SOURCE_NAME = 'LLM-assisted identification';
const SIMILARITY_THRESHOLD = 0.1;
const MAX_CANDIDATES = 10;
/** 2 total attempts: 1 initial + 1 retry (loop runs twice). */
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = 1_000;

const SYSTEM_MESSAGE = 'You are a food identification assistant. Do not provide nutritional values. Only identify or decompose as instructed.';

// ---------------------------------------------------------------------------
// OpenAI client caching (same pattern as embeddingClient.ts)
// ---------------------------------------------------------------------------

let cachedOpenAIClient: OpenAI | undefined;
let cachedOpenAIKey: string | undefined;

function getOpenAIClient(apiKey: string): OpenAI {
  if (cachedOpenAIClient && cachedOpenAIKey === apiKey) return cachedOpenAIClient;
  cachedOpenAIClient = new OpenAI({ apiKey });
  cachedOpenAIKey = apiKey;
  return cachedOpenAIClient;
}

// ---------------------------------------------------------------------------
// isRetryableError (same logic as embeddingClient.ts)
// ---------------------------------------------------------------------------

function isRetryableError(error: unknown): boolean {
  if (error !== null && typeof error === 'object') {
    const status = (error as Record<string, unknown>)['status'];
    if (typeof status === 'number') {
      return status === 429 || status >= 500;
    }
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Logger type (matches EngineRouterOptions.logger)
// ---------------------------------------------------------------------------

type Logger = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  debug: (obj: Record<string, unknown>, msg?: string) => void;
};

// ---------------------------------------------------------------------------
// callChatCompletion — wraps OpenAI chat with 2-attempt retry.
//
// Returns the message content string or null on failure.
// Catches ALL OpenAI errors internally — never propagates them.
// Logs token usage via logger?.info after success.
// Logs errors via logger?.warn after exhausting retries.
// ---------------------------------------------------------------------------

async function callChatCompletion(
  apiKey: string,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  logger?: Logger,
): Promise<string | null> {
  const client = getOpenAIClient(apiKey);
  // OPENAI_CHAT_MODEL is guaranteed non-null here because callChatCompletion is only
  // called after the guard in level4Lookup checks config.OPENAI_CHAT_MODEL is defined.
  const chatModel = config.OPENAI_CHAT_MODEL ?? 'gpt-4o-mini';
  const maxTokens = config.OPENAI_CHAT_MAX_TOKENS;

  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: chatModel,
        messages,
        temperature: 0,
        max_tokens: maxTokens,
      });

      const content = response.choices[0]?.message?.content ?? null;
      if (content === null) return null;

      // Log token usage after successful call
      if (response.usage) {
        logger?.info(
          {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            model: chatModel,
          },
          'L4 OpenAI call',
        );
      }

      return content;
    } catch (error) {
      if (!isRetryableError(error)) {
        // Non-retryable (e.g. 400) — log and return null immediately (no retry)
        logger?.warn({ error }, 'L4 OpenAI call failed');
        return null;
      }

      lastError = error;

      // Retryable (429/5xx) — backoff before retry
      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_BACKOFF_MS);
      }
    }
  }

  // Exhausted retries
  logger?.warn({ error: lastError }, 'L4 OpenAI call failed');
  return null;
}

// ---------------------------------------------------------------------------
// fetchFoodNutrients — copied verbatim from level3Lookup.ts (same SQL, same shape).
// No sharing — precedent established by L1/L2/L3 (do NOT extract to shared utility).
// F072: selects f.food_group for yield correction threading.
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
    WHERE f.id = ${foodId}::uuid
    LIMIT 1
  `.execute(db);

  return result.rows[0];
}

// ---------------------------------------------------------------------------
// fetchCandidatesByTrigram — top-10 food candidates via pg_trgm similarity.
// ---------------------------------------------------------------------------

async function fetchCandidatesByTrigram(
  db: Kysely<DB>,
  query: string,
): Promise<Array<{ id: string; name: string; name_es: string | null }>> {
  const result = await sql<{ id: string; name: string; name_es: string | null }>`
    SELECT id::text AS id, name, name_es
    FROM foods
    WHERE similarity(COALESCE(name_es, name), ${query}) > ${SIMILARITY_THRESHOLD}
    ORDER BY similarity(COALESCE(name_es, name), ${query}) DESC
    LIMIT ${MAX_CANDIDATES}
  `.execute(db);

  return result.rows;
}

// ---------------------------------------------------------------------------
// fetchFoodByName — exact + FTS food lookup for a single ingredient name.
// Used by Strategy B for per-ingredient resolution.
// Filters on reference_basis = 'per_100g' to ensure correct arithmetic.
// ---------------------------------------------------------------------------

async function fetchFoodByName(
  db: Kysely<DB>,
  name: string,
): Promise<FoodQueryRow | undefined> {
  // First: try exact match (case-insensitive)
  const exactResult = await sql<FoodQueryRow>`
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
    WHERE LOWER(f.name_es) = LOWER(${name}) OR LOWER(f.name) = LOWER(${name})
    LIMIT 1
  `.execute(db);

  if (exactResult.rows[0] !== undefined) {
    return exactResult.rows[0];
  }

  // Fallback: FTS match
  const ftsResult = await sql<FoodQueryRow>`
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
    WHERE to_tsvector('spanish', COALESCE(f.name_es, '')) @@ plainto_tsquery('spanish', ${name})
       OR to_tsvector('english', f.name) @@ plainto_tsquery('english', ${name})
    LIMIT 1
  `.execute(db);

  return ftsResult.rows[0];
}

// ---------------------------------------------------------------------------
// runStrategyA — pg_trgm + LLM food selection
// ---------------------------------------------------------------------------

async function runStrategyA(
  db: Kysely<DB>,
  query: string,
  apiKey: string,
  logger?: Logger,
): Promise<{ matchType: EstimateMatchType; result: EstimateResult } | null> {
  // Step 1: Fetch trigram candidates
  const candidates = await fetchCandidatesByTrigram(db, query);

  // Step 2: Skip immediately if no candidates (no LLM call)
  if (candidates.length === 0) {
    return null;
  }

  // Step 3: Build user prompt (0-based indexing)
  const candidateList = candidates
    .map((c, i) => `${i}. ${c.name_es ?? c.name}`)
    .join('\n');

  const userMessage =
    `Query: '${query}'\n` +
    `Candidates (index starting at 0):\n${candidateList}\n\n` +
    `Reply with the 0-based index of the best match, or 'none' if no candidate matches well enough. Reply with only the number or 'none', no other text.`;

  // Step 4: Call LLM
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [
    { role: 'system', content: SYSTEM_MESSAGE },
    { role: 'user', content: userMessage },
  ];

  const response = await callChatCompletion(apiKey, messages, logger);
  if (response === null) return null;

  // Step 5: Parse response — expect digit or 'none'
  const trimmed = response.trim();
  if (trimmed === 'none') return null;

  const idx = parseInt(trimmed, 10);
  if (isNaN(idx) || idx < 0 || idx >= candidates.length) {
    logger?.warn({ response: trimmed, candidateCount: candidates.length }, 'L4 Strategy A: unexpected LLM response');
    return null;
  }

  // Step 6: Selected candidate
  const selectedCandidate = candidates[idx];
  if (selectedCandidate === undefined) return null;

  // Step 7: Fetch nutrients for matched food
  const nutrientRow = await fetchFoodNutrients(db, selectedCandidate.id);
  if (nutrientRow === undefined) return null;

  // Step 8: Build result — spread base and override with LLM-specific fields
  const result: EstimateResult = {
    ...mapFoodRowToResult(nutrientRow),
    confidenceLevel: 'medium',
    estimationMethod: 'llm',
    similarityDistance: null,
    source: {
      id: LLM_SOURCE_ID,
      name: LLM_SOURCE_NAME,
      type: 'estimated',
      url: null,
      priorityTier: 3,
    },
  };

  // Step 9: Return
  return { matchType: 'llm_food_match', result };
}

// ---------------------------------------------------------------------------
// runStrategyB — LLM decomposition + L1-style resolution + L2-style aggregation
// ---------------------------------------------------------------------------

interface IngredientItem {
  name: string;
  grams: number;
}

async function runStrategyB(
  db: Kysely<DB>,
  query: string,
  apiKey: string,
  logger?: Logger,
): Promise<{ matchType: EstimateMatchType; result: EstimateResult } | null> {
  // Step 1: Build user prompt
  const userMessage =
    `Query: '${query}'\n\n` +
    `Decompose this food query into a list of base ingredients with gram weights.\n` +
    `Use common, generic ingredient names likely found in a nutritional database\n` +
    `(e.g., 'huevo' not 'huevo de gallina campera', 'arroz' not 'arroz basmati ecológico').\n\n` +
    `IMPORTANT RULES:\n` +
    `- If the user specifies exact gram amounts (e.g., "200g arroz"), use those exact values.\n` +
    `- If no amounts are given, estimate reasonable gram weights for a standard serving.\n` +
    `- If the query mentions a portion size (small/medium/large, pequeño/mediano/grande,\n` +
    `  "half plate", "ración pequeña", etc.), include a "portion_multiplier" field:\n` +
    `  0.7 for small, 1.0 for regular/medium, 1.3 for large. Do NOT adjust the gram weights\n` +
    `  yourself — the multiplier is applied by the system.\n\n` +
    `Reply with ONLY valid JSON, no other text. Use this format:\n` +
    `{"ingredients": [{"name": "<ingredient>", "grams": <number>}, ...], "portion_multiplier": <number>}\n` +
    `Omit "portion_multiplier" if no size modifier is mentioned.`;

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [
    { role: 'system', content: SYSTEM_MESSAGE },
    { role: 'user', content: userMessage },
  ];

  // Step 2: Call LLM
  const response = await callChatCompletion(apiKey, messages, logger);
  if (response === null) return null;

  // Step 3: Strip markdown code fences before JSON.parse
  const cleaned = response
    .replace(/```json\n?/g, '')
    .replace(/```/g, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    logger?.warn({ response: cleaned }, 'L4 Strategy B: malformed JSON from LLM');
    return null;
  }

  // Step 4: Extract ingredients array and portion_multiplier.
  // Accepts two formats:
  //   - New: { "ingredients": [...], "portion_multiplier": 0.7 }
  //   - Legacy: [...]  (plain array, backward compatible)
  let ingredientArray: unknown[];
  let portionMultiplier = 1.0;

  if (Array.isArray(parsed)) {
    ingredientArray = parsed;
  } else if (parsed !== null && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    const ing = obj['ingredients'];
    if (!Array.isArray(ing)) {
      logger?.warn({ response: cleaned }, 'L4 Strategy B: LLM response has no ingredients array');
      return null;
    }
    ingredientArray = ing;
    // Extract portion_multiplier — must be a positive finite number in (0, 5.0], else default 1.0
    const pm = obj['portion_multiplier'];
    if (typeof pm === 'number' && pm > 0 && pm <= 5.0 && Number.isFinite(pm)) {
      portionMultiplier = pm;
    }
  } else {
    logger?.warn({ response: cleaned }, 'L4 Strategy B: LLM response is not an array or object');
    return null;
  }

  // Step 4b: Validate each ingredient item
  const validItems: IngredientItem[] = [];
  for (const item of ingredientArray) {
    if (item !== null && typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      const name = rec['name'];
      const grams = rec['grams'];
      if (typeof name === 'string' && typeof grams === 'number' && grams > 0) {
        validItems.push({ name, grams });
      }
    }
  }

  if (validItems.length === 0) return null;

  const totalItems = validItems.length;

  // Step 5: Resolve each ingredient
  type ResolvedItem = { row: FoodQueryRow; grams: number };
  type UnresolvedItem = { grams: number };

  const resolved: ResolvedItem[] = [];
  const unresolved: UnresolvedItem[] = [];

  for (const item of validItems) {
    const row = await fetchFoodByName(db, item.name);
    if (row !== undefined) {
      resolved.push({ row, grams: item.grams });
    } else {
      unresolved.push({ grams: item.grams });
    }
  }

  // Step 7: If 0 resolved → null
  if (resolved.length === 0) return null;

  // Step 8: Aggregate nutrients: SUM(nutrient_per_100g * grams / 100)
  const aggregatedNutrients = {
    calories: 0,
    proteins: 0,
    carbohydrates: 0,
    sugars: 0,
    fats: 0,
    saturatedFats: 0,
    fiber: 0,
    salt: 0,
    sodium: 0,
    transFats: 0,
    cholesterol: 0,
    potassium: 0,
    monounsaturatedFats: 0,
    polyunsaturatedFats: 0,
  };

  for (const { row, grams } of resolved) {
    // ADR-001: Engine calculates. Multiply per_100g value by (grams/100) by portionMultiplier.
    const factor = (grams / 100) * portionMultiplier;
    aggregatedNutrients.calories += parseDecimal(row.calories) * factor;
    aggregatedNutrients.proteins += parseDecimal(row.proteins) * factor;
    aggregatedNutrients.carbohydrates += parseDecimal(row.carbohydrates) * factor;
    aggregatedNutrients.sugars += parseDecimal(row.sugars) * factor;
    aggregatedNutrients.fats += parseDecimal(row.fats) * factor;
    aggregatedNutrients.saturatedFats += parseDecimal(row.saturated_fats) * factor;
    aggregatedNutrients.fiber += parseDecimal(row.fiber) * factor;
    aggregatedNutrients.salt += parseDecimal(row.salt) * factor;
    aggregatedNutrients.sodium += parseDecimal(row.sodium) * factor;
    aggregatedNutrients.transFats += parseDecimal(row.trans_fats) * factor;
    aggregatedNutrients.cholesterol += parseDecimal(row.cholesterol) * factor;
    aggregatedNutrients.potassium += parseDecimal(row.potassium) * factor;
    aggregatedNutrients.monounsaturatedFats += parseDecimal(row.monounsaturated_fats) * factor;
    aggregatedNutrients.polyunsaturatedFats += parseDecimal(row.polyunsaturated_fats) * factor;
  }

  // Step 9: Find heaviest resolved ingredient
  // resolved.length > 0 is guaranteed by the guard above (step 7).
  // Use a seed value from the first item via slice to avoid the non-null assertion.
  const firstResolved = resolved[0];
  if (firstResolved === undefined) return null; // defensive guard — already checked above
  const heaviest = resolved.reduce(
    (max, item) => (item.grams > max.grams ? item : max),
    firstResolved,
  );

  // Step 10: Sum ALL gram weights (resolved + unresolved) for portionGrams, apply multiplier
  const rawGrams =
    resolved.reduce((sum, i) => sum + i.grams, 0) +
    unresolved.reduce((sum, i) => sum + i.grams, 0);
  const totalGrams = rawGrams * portionMultiplier;

  const confidenceLevel: 'medium' | 'low' = resolved.length === totalItems ? 'medium' : 'low';

  const result: EstimateResult = {
    entityType: 'food',
    entityId: heaviest.row.food_id,
    name: query,          // original query, NOT ingredient name
    nameEs: null,
    restaurantId: null,
    chainSlug: null,
    portionGrams: totalGrams,
    nutrients: {
      ...aggregatedNutrients,
      referenceBasis: 'per_serving',
    },
    confidenceLevel,
    estimationMethod: 'llm',
    source: {
      id: LLM_SOURCE_ID,
      name: LLM_SOURCE_NAME,
      type: 'estimated',
      url: null,
      priorityTier: 3,
    },
    similarityDistance: null,
  };

  // Step 11: Return
  return { matchType: 'llm_ingredient_decomposition', result };
}

// ---------------------------------------------------------------------------
// Main export — matches Level4LookupFn from engineRouter.ts
// ---------------------------------------------------------------------------

/**
 * Execute the Level 4 LLM Integration Layer cascade.
 *
 * Guard: returns null immediately if openAiApiKey or config.OPENAI_CHAT_MODEL is absent.
 *
 * Strategy A: pg_trgm trigram similarity → LLM picks best match → fetch nutrients.
 * Strategy B: LLM decomposes query → resolve ingredients → aggregate nutrients.
 *
 * OpenAI failures are caught internally and return null (graceful skip).
 * DB errors (Kysely sql failures) bubble up as { code: 'DB_UNAVAILABLE' }.
 */
export const level4Lookup: Level4LookupFn = async (db, query, options) => {
  const { openAiApiKey, logger } = options;

  // Guard: both must be set for L4 to be active
  if (!openAiApiKey || !config.OPENAI_CHAT_MODEL) {
    logger?.debug(
      { hasApiKey: !!openAiApiKey, hasChatModel: !!config.OPENAI_CHAT_MODEL },
      'L4 skipped: missing config',
    );
    return null;
  }

  try {
    // Strategy A: pg_trgm + LLM selection
    const stratAResult = await runStrategyA(db, query, openAiApiKey, logger);
    if (stratAResult !== null) return stratAResult;

    // Strategy B: LLM decomposition + L1 resolution + L2-style aggregation
    const stratBResult = await runStrategyB(db, query, openAiApiKey, logger);
    if (stratBResult !== null) return stratBResult;

    return null;
  } catch (err) {
    throw Object.assign(
      new Error('Database query failed'),
      { code: 'DB_UNAVAILABLE', cause: err },
    );
  }
};
