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
}

function canonicalizeStructured(ingredients: IngredientForCache[]): string {
  // Normalize: ensure portionMultiplier is present, then sort by (foodId ?? name), grams, portionMultiplier
  const normalized = ingredients
    .map((i) => ({
      foodId: i.foodId ?? null,
      name: i.name ?? null,
      grams: i.grams,
      portionMultiplier: i.portionMultiplier,
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
  const { db } = opts;

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
        cacheKey = buildCacheKey('structured', canonicalizeStructured(body.ingredients));
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
          executeRecipeCalculation(db, body, controller.signal, request.log),
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
  body: RecipeCalculateBody,
  signal: AbortSignal,
  _logger: { warn: (obj: Record<string, unknown>, msg?: string) => void },
): Promise<RecipeCalculateData> {
  const openAiApiKey = config.OPENAI_API_KEY;

  // Step 0: For free-form mode — parse text with LLM first
  let parsedIngredients: Array<{ name: string; grams: number; portionMultiplier: number }> | undefined;
  let ingredientInputs: IngredientInput[];

  if (body.mode === 'free-form') {
    const parsed = await parseRecipeFreeForm(body.text, openAiApiKey);
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
  } else {
    ingredientInputs = body.ingredients.map((i) => ({
      foodId: i.foodId,
      name: i.name,
      grams: i.grams,
      portionMultiplier: i.portionMultiplier,
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
    const l3l4Result = await resolveIngredientL3L4(db, input, openAiApiKey, signal);
    finalResults[idx] = l3l4Result;
  }

  // Build per-ingredient display and collect resolved for aggregation
  type AggInput = { grams: number; portionMultiplier: number; nutrientRow: ResolvedResult['nutrientRow'] };
  const resolvedAgg: Array<AggInput & { index: number }> = [];

  const displayIngredients: ResolvedIngredient[] = finalResults.map((res, i) => {
    const input = ingredientInputs[i] ?? { grams: 0, portionMultiplier: 1.0 };
    const displayInput = {
      foodId: input.foodId ?? null,
      name: input.name ?? null,
      grams: input.grams,
      portionMultiplier: input.portionMultiplier,
    };

    if (res.resolved) {
      resolvedAgg.push({
        index: i,
        grams: input.grams,
        portionMultiplier: input.portionMultiplier,
        nutrientRow: res.nutrientRow,
      });

      return {
        input: displayInput,
        resolved: true,
        resolvedAs: {
          entityId: res.entityId,
          name: res.name,
          nameEs: res.nameEs,
          matchType: res.matchType,
        },
        nutrients: null, // filled in after aggregation
      };
    }

    return {
      input: displayInput,
      resolved: false,
      resolvedAs: null,
      nutrients: null,
    };
  });

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
