// POST /calculate/recipe — Recipe Calculation Endpoint (F035).
//
// Computes aggregate nutritional information for a user-provided recipe.
// Stateless: calculates on-the-fly, does NOT persist to Recipe tables.
//
// Two modes:
//   "structured" — typed ingredient array with foodId or name + grams
//   "free-form"  — plain-text recipe description parsed by LLM
//
// Resolution cascade (food-only):
//   Phase 1 (parallel): direct_id → exact_food → fts_food (L1)
//   Phase 2 (sequential, max 10 budget): similarity_food (L3) → llm_food_match (L4)
//
// Partial resolution: any resolved ingredients → 200 + unresolvedIngredients list
// Zero resolved: 422 RECIPE_UNRESOLVABLE
// 30s timeout: 408 PROCESSING_TIMEOUT via Promise.race
// Cache: fxp:recipe:<mode>:<sha256(canonical)> TTL 300s, fail-open
//
// See ADR-001 (Motor calculates, LLM interprets), ADR-009 §5 (portion_multiplier)

import { createHash } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import type { Kysely } from 'kysely';
import type { PrismaClient } from '@prisma/client';
import {
  RecipeCalculateBodySchema,
  type RecipeCalculateBody,
  type RecipeCalculateData,
  type ResolvedIngredient,
  type YieldAdjustment,
} from '@foodxplorer/shared';
import type { DB } from '../generated/kysely-types.js';
import { buildKey, cacheGet, cacheSet } from '../lib/cache.js';
import { config } from '../config.js';
import {
  resolveIngredientL1,
  resolveIngredientL3L4,
  type IngredientInput,
  type ResolvedResult,
} from '../calculation/resolveIngredient.js';
import { aggregateNutrients } from '../calculation/aggregateNutrients.js';
import { parseRecipeFreeForm } from '../calculation/parseRecipeFreeForm.js';
import { resolveAndApplyYield } from '../estimation/applyYield.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROUTE_TIMEOUT_MS = 30_000;
const MAX_L3L4_BUDGET = 10;

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

interface RecipeCalculatePluginOptions {
  db: Kysely<DB>;
  prisma: PrismaClient;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function buildCacheKey(mode: string, canonicalPayload: string): string {
  return buildKey(`recipe:${mode}`, sha256(canonicalPayload));
}

interface IngredientForCache {
  foodId?: string;
  name?: string;
  grams: number;
  portionMultiplier: number;
  /** F072 — optional cooking state for cache key differentiation */
  cookingState?: string;
  /** F072 — optional cooking method for cache key differentiation */
  cookingMethod?: string;
}

function canonicalizeStructured(ingredients: IngredientForCache[]): string {
  // Normalize: include cookingState and cookingMethod in cache key so yield-corrected
  // results are cached separately from uncorrected ones.
  const normalized = ingredients
    .map((i) => ({
      foodId: i.foodId ?? null,
      name: i.name ?? null,
      grams: i.grams,
      portionMultiplier: i.portionMultiplier,
      cookingState: i.cookingState ?? null,
      cookingMethod: i.cookingMethod ?? null,
    }))
    .sort((a, b) => {
      const keyA = (a.foodId ?? a.name ?? '');
      const keyB = (b.foodId ?? b.name ?? '');
      if (keyA !== keyB) return keyA < keyB ? -1 : 1;
      if (a.grams !== b.grams) return a.grams - b.grams;
      return a.portionMultiplier - b.portionMultiplier;
    });
  return JSON.stringify(normalized);
}

function canonicalizeFreeForm(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();
  return JSON.stringify({ text: normalized });
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const recipeCalculateRoutesPlugin: FastifyPluginAsync<RecipeCalculatePluginOptions> = async (
  app,
  opts,
) => {
  const { db, prisma } = opts;

  app.post(
    '/calculate/recipe',
    {
      schema: {
        body: RecipeCalculateBodySchema,
        tags: ['Calculation'],
        operationId: 'calculateRecipe',
        summary: 'Calculate aggregate nutritional information for a recipe',
        description:
          'Accepts a recipe in structured (typed ingredient array) or free-form (plain text) mode. ' +
          'Resolves each ingredient via a food-only cascade (direct_id → exact_food → fts_food → similarity_food → llm_food_match). ' +
          'Returns per-ingredient breakdown plus aggregated totals. ' +
          'Partial resolution is allowed (200 with unresolvedIngredients and confidenceLevel: "low"). ' +
          'Zero resolution returns 422 RECIPE_UNRESOLVABLE. ' +
          'Route timeout: 30s → 408 PROCESSING_TIMEOUT. ' +
          'Responses cached in Redis for 300 seconds.',
      },
    },
    async (request, reply) => {
      const body = request.body as RecipeCalculateBody;

      // Build cache key
      let cacheKey: string;
      if (body.mode === 'structured') {
        // F072: include cookingState/cookingMethod so yield-corrected results cache separately
        const ingredientsForCache: IngredientForCache[] = body.ingredients.map((i) => ({
          foodId: i.foodId,
          name: i.name,
          grams: i.grams,
          portionMultiplier: i.portionMultiplier,
          cookingState: i.cookingState,
          cookingMethod: i.cookingMethod,
        }));
        cacheKey = buildCacheKey('structured', canonicalizeStructured(ingredientsForCache));
      } else {
        cacheKey = buildCacheKey('free-form', canonicalizeFreeForm(body.text));
      }

      // --- Cache check ---
      const cached = await cacheGet<RecipeCalculateData>(cacheKey, request.log);
      if (cached !== null) {
        return reply.send({ success: true, data: cached });
      }

      // --- Timeout guard ---
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), ROUTE_TIMEOUT_MS);

      try {
        const result = await Promise.race([
          executeRecipeCalculation(db, prisma, body, controller.signal, request.log),
          new Promise<never>((_, reject) =>
            controller.signal.addEventListener('abort', () =>
              reject(Object.assign(new Error('Recipe calculation timed out'), { code: 'PROCESSING_TIMEOUT' }))
            )
          ),
        ]);

        clearTimeout(timeoutHandle);

        // --- Cache write ---
        const dataToCache: RecipeCalculateData = {
          ...result,
          cachedAt: new Date().toISOString(),
        };
        await cacheSet(cacheKey, dataToCache, request.log);

        return reply.send({ success: true, data: result });
      } catch (err) {
        clearTimeout(timeoutHandle);
        throw err;
      }
    },
  );
};

// ---------------------------------------------------------------------------
// executeRecipeCalculation — orchestrates resolution + aggregation
// ---------------------------------------------------------------------------

async function executeRecipeCalculation(
  db: Kysely<DB>,
  prisma: PrismaClient,
  body: RecipeCalculateBody,
  signal: AbortSignal,
  logger: { info: (obj: Record<string, unknown>, msg?: string) => void; warn: (obj: Record<string, unknown>, msg?: string) => void; debug: (obj: Record<string, unknown>, msg?: string) => void },
): Promise<RecipeCalculateData> {
  const openAiApiKey = config.OPENAI_API_KEY;

  // Step 0: For free-form mode — parse text with LLM first
  let parsedIngredients: Array<{ name: string; grams: number; portionMultiplier: number }> | undefined;
  let ingredientInputs: IngredientInput[];
  // F072: per-ingredient cooking params (structured mode only)
  let ingredientCookingParams: Array<{ cookingState?: string; cookingMethod?: string }> = [];

  if (body.mode === 'free-form') {
    const parsed = await parseRecipeFreeForm(body.text, openAiApiKey, logger, signal);
    if (parsed === null) {
      throw Object.assign(
        new Error('LLM failed to parse free-form recipe text'),
        { code: 'FREE_FORM_PARSE_FAILED' },
      );
    }
    parsedIngredients = parsed;
    ingredientInputs = parsed.map((p) => ({
      name: p.name,
      grams: p.grams,
      portionMultiplier: p.portionMultiplier,
    }));
    // Free-form: no per-ingredient cooking state (F074 will handle this)
    ingredientCookingParams = parsed.map(() => ({}));
  } else {
    ingredientInputs = body.ingredients.map((i) => ({
      foodId: i.foodId,
      name: i.name,
      grams: i.grams,
      portionMultiplier: i.portionMultiplier,
    }));
    // F072: extract per-ingredient cooking params from structured body
    ingredientCookingParams = body.ingredients.map((i) => ({
      cookingState: i.cookingState,
      cookingMethod: i.cookingMethod,
    }));
  }

  // Phase 1: L1 parallel resolution
  const l1Results = await Promise.all(
    ingredientInputs.map((input) => resolveIngredientL1(db, input)),
  );

  // Identify L1 misses that need L3/L4
  const l1MissIndices: number[] = [];
  for (let i = 0; i < l1Results.length; i++) {
    const r = l1Results[i];
    if (r && !r.resolved) {
      l1MissIndices.push(i);
    }
  }

  // Phase 2: L3/L4 sequential, up to budget
  const finalResults = [...l1Results];
  let l3l4Budget = MAX_L3L4_BUDGET;

  for (const idx of l1MissIndices) {
    if (l3l4Budget <= 0 || signal.aborted) break;
    l3l4Budget--;

    const input = ingredientInputs[idx];
    if (!input) continue;
    const l3l4Result = await resolveIngredientL3L4(db, input, openAiApiKey, signal, logger);
    finalResults[idx] = l3l4Result;
  }

  // Build per-ingredient display and collect resolved for aggregation.
  // F072: Apply yield correction per resolved ingredient.
  type AggInput = { grams: number; portionMultiplier: number; nutrientRow: ResolvedResult['nutrientRow'] };
  const resolvedAgg: Array<AggInput & { index: number }> = [];

  const displayIngredients: ResolvedIngredient[] = [];

  for (let i = 0; i < finalResults.length; i++) {
    const res = finalResults[i];
    const input = ingredientInputs[i] ?? { grams: 0, portionMultiplier: 1.0 };
    const cookingParams = ingredientCookingParams[i] ?? {};

    const displayInput = {
      foodId: input.foodId ?? null,
      name: input.name ?? null,
      grams: input.grams,
      portionMultiplier: input.portionMultiplier,
    };

    if (res && res.resolved) {
      // F072: Build EstimateResult-like object for resolveAndApplyYield.
      // We use the nutrientRow to construct nutrients for yield correction.
      const foodName = res.name;
      const rawFoodGroup = res.nutrientRow.food_group ?? null;

      // Convert FoodQueryRow nutrients to EstimateResult format for resolveAndApplyYield
      const estimateResult = {
        entityType: 'food' as const,
        entityId: res.entityId,
        name: res.name,
        nameEs: res.nameEs,
        restaurantId: null,
        chainSlug: null,
        portionGrams: null,
        nutrients: {
          calories: parseFloat(res.nutrientRow.calories) || 0,
          proteins: parseFloat(res.nutrientRow.proteins) || 0,
          carbohydrates: parseFloat(res.nutrientRow.carbohydrates) || 0,
          sugars: parseFloat(res.nutrientRow.sugars) || 0,
          fats: parseFloat(res.nutrientRow.fats) || 0,
          saturatedFats: parseFloat(res.nutrientRow.saturated_fats) || 0,
          fiber: parseFloat(res.nutrientRow.fiber) || 0,
          salt: parseFloat(res.nutrientRow.salt) || 0,
          sodium: parseFloat(res.nutrientRow.sodium) || 0,
          transFats: parseFloat(res.nutrientRow.trans_fats) || 0,
          cholesterol: parseFloat(res.nutrientRow.cholesterol) || 0,
          potassium: parseFloat(res.nutrientRow.potassium) || 0,
          monounsaturatedFats: parseFloat(res.nutrientRow.monounsaturated_fats) || 0,
          polyunsaturatedFats: parseFloat(res.nutrientRow.polyunsaturated_fats) || 0,
          referenceBasis: res.nutrientRow.reference_basis as 'per_100g' | 'per_serving',
        },
        confidenceLevel: 'high' as const,
        estimationMethod: 'official' as const,
        source: {
          id: res.nutrientRow.source_id,
          name: res.nutrientRow.source_name,
          type: res.nutrientRow.source_type as 'official' | 'scraped' | 'estimated' | 'user',
          url: res.nutrientRow.source_url,
        },
        similarityDistance: null,
      };

      // Apply yield correction
      const { result: correctedResult, yieldAdjustment } = await resolveAndApplyYield({
        result: estimateResult,
        foodName,
        rawFoodGroup,
        cookingState: cookingParams.cookingState,
        cookingMethod: cookingParams.cookingMethod,
        prisma,
        logger: { warn: (msg) => logger.warn({}, msg), error: (msg) => logger.error({}, msg) },
      });

      // Build a corrected nutrientRow for aggregation by cloning and replacing numeric fields.
      // aggregateNutrients reads string fields from nutrientRow — convert corrected numbers back.
      const correctedNutrientRow = {
        ...res.nutrientRow,
        calories: String(correctedResult.nutrients.calories),
        proteins: String(correctedResult.nutrients.proteins),
        carbohydrates: String(correctedResult.nutrients.carbohydrates),
        sugars: String(correctedResult.nutrients.sugars),
        fats: String(correctedResult.nutrients.fats),
        saturated_fats: String(correctedResult.nutrients.saturatedFats),
        fiber: String(correctedResult.nutrients.fiber),
        salt: String(correctedResult.nutrients.salt),
        sodium: String(correctedResult.nutrients.sodium),
        trans_fats: String(correctedResult.nutrients.transFats),
        cholesterol: String(correctedResult.nutrients.cholesterol),
        potassium: String(correctedResult.nutrients.potassium),
        monounsaturated_fats: String(correctedResult.nutrients.monounsaturatedFats),
        polyunsaturated_fats: String(correctedResult.nutrients.polyunsaturatedFats),
      };

      resolvedAgg.push({
        index: i,
        grams: input.grams,
        portionMultiplier: input.portionMultiplier,
        nutrientRow: correctedNutrientRow,
      });

      displayIngredients.push({
        input: displayInput,
        resolved: true,
        resolvedAs: {
          entityId: res.entityId,
          name: res.name,
          nameEs: res.nameEs,
          matchType: res.matchType,
          yieldAdjustment: yieldAdjustment as YieldAdjustment | null,
        },
        nutrients: null, // filled in after aggregation
      });
    } else {
      displayIngredients.push({
        input: displayInput,
        resolved: false,
        resolvedAs: null,
        nutrients: null,
      });
    }
  }

  // Handle zero resolution
  if (resolvedAgg.length === 0) {
    throw Object.assign(
      new Error('No ingredients could be resolved for this recipe'),
      { code: 'RECIPE_UNRESOLVABLE' },
    );
  }

  // Aggregate nutrients
  const { perIngredient, totals } = aggregateNutrients(resolvedAgg);

  // Fill in per-ingredient nutrients
  let perIngredientIdx = 0;
  for (const item of displayIngredients) {
    if (item.resolved) {
      item.nutrients = perIngredient[perIngredientIdx] ?? null;
      perIngredientIdx++;
    }
  }

  // Determine confidence level
  const hasL4 = finalResults.some(
    (r) => r.resolved && r.matchType === 'llm_food_match',
  );
  const hasUnresolved = finalResults.some((r) => !r.resolved);
  const confidenceLevel: 'medium' | 'low' = hasL4 || hasUnresolved ? 'low' : 'medium';

  // Build unresolved list (use name from original input or foodId)
  const unresolvedIngredients: string[] = finalResults
    .map((r, i) => {
      if (!r.resolved) {
        const input = ingredientInputs[i];
        return input?.name ?? input?.foodId ?? 'unknown';
      }
      return null;
    })
    .filter((v): v is string => v !== null);

  const data: RecipeCalculateData = {
    mode: body.mode,
    resolvedCount: resolvedAgg.length,
    unresolvedCount: unresolvedIngredients.length,
    confidenceLevel,
    totalNutrients: totals,
    ingredients: displayIngredients,
    unresolvedIngredients,
    cachedAt: null,
  };

  if (parsedIngredients !== undefined) {
    data.parsedIngredients = parsedIngredients;
  }

  return data;
}

// Wrap with fastify-plugin so the route is registered on the root scope,
// allowing the root-level error handler to apply to recipe route errors.
export const recipeCalculateRoutes = fastifyPlugin(recipeCalculateRoutesPlugin);
