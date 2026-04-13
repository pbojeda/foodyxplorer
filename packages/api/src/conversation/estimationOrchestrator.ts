// EstimationOrchestrator (F070, Step 6)
//
// Encapsulates the estimation logic extracted from GET /estimate:
//   cache check → brand detection → runEstimationCascade → applyPortionMultiplier → cache write
//
// actorId is NOT in EstimateParams — query logging (which needs actorId) is the
// route handler's responsibility.

import type { Kysely } from 'kysely';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from './types.js';
import type { EstimateData } from '@foodxplorer/shared';
import type { DB } from '../generated/kysely-types.js';
import type { Level4LookupFn } from '../estimation/engineRouter.js';
import { runEstimationCascade } from '../estimation/engineRouter.js';
import { detectExplicitBrand } from '../estimation/brandDetector.js';
import { buildKey, cacheGet, cacheSet } from '../lib/cache.js';
import { applyPortionMultiplier } from '../estimation/portionUtils.js';
import { enrichWithTips } from '../estimation/healthHacker.js';
import { enrichWithSubstitutions } from '../estimation/substitutions.js';
import { enrichWithAllergens } from '../estimation/allergenDetector.js';
import { enrichWithUncertainty } from '../estimation/uncertaintyCalculator.js';
import { enrichWithPortionSizing, detectPortionTerm } from '../estimation/portionSizing.js';
import { resolvePortionAssumption } from '../estimation/portionAssumption.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EstimateParams {
  query: string;
  chainSlug?: string;
  restaurantId?: string;
  portionMultiplier?: number;
  db: Kysely<DB>;
  /** F-UX-B: Prisma client for standardPortions lookup (optional — skips portion assumption when absent). */
  prisma?: PrismaClient;
  openAiApiKey?: string;
  level4Lookup?: Level4LookupFn;
  chainSlugs: string[];
  logger: Logger;
}

// ---------------------------------------------------------------------------
// estimate
// ---------------------------------------------------------------------------

/**
 * Estimate nutrition for a query.
 *
 * Internal steps:
 * 1. Normalize query for cache key
 * 2. Build unified cache key
 * 3. Cache read (fail-open) → return cached EstimateData if hit
 * 4. Brand detection via detectExplicitBrand
 * 5. runEstimationCascade
 * 6. Apply portion multiplier when != 1
 * 7. Assemble EstimateData (cachedAt: null)
 * 8. Cache write (with cachedAt timestamp)
 * 9. Return EstimateData
 */
export async function estimate(params: EstimateParams): Promise<EstimateData> {
  const {
    query,
    chainSlug,
    restaurantId,
    portionMultiplier: rawMultiplier,
    db,
    prisma,
    openAiApiKey,
    level4Lookup,
    chainSlugs,
    logger,
  } = params;

  const effectiveMultiplier = rawMultiplier ?? 1;

  // Step 1 & 2 — Build cache key from normalized query
  const normalizedQuery = query.replace(/\s+/g, ' ').trim().toLowerCase();
  const cacheKey = buildKey(
    'estimate',
    `${normalizedQuery}:${chainSlug ?? ''}:${restaurantId ?? ''}:${effectiveMultiplier}`,
  );

  // Step 3 — Cache check (fail-open)
  const cached = await cacheGet<EstimateData>(cacheKey, logger as Parameters<typeof cacheGet>[1]);
  if (cached !== null) {
    return cached;
  }

  // Step 4 — Brand detection
  const { hasExplicitBrand } = detectExplicitBrand(query, chainSlugs);

  // Step 5 — Estimation cascade
  const routerResult = await runEstimationCascade({
    db,
    query,
    chainSlug,
    restaurantId,
    openAiApiKey,
    level4Lookup,
    logger: logger as Parameters<typeof runEstimationCascade>[0]['logger'],
    hasExplicitBrand,
  });

  // Step 6 — Apply portion multiplier (F-UX-A: capture base row before scaling
  // so the frontend can display both the normal serving and the estimation used)
  const baseResult = routerResult.data.result;
  const shouldScale = effectiveMultiplier !== 1 && baseResult !== null;
  const scaledResult = shouldScale
    ? applyPortionMultiplier(baseResult, effectiveMultiplier)
    : baseResult;

  // Step 7 — Assemble EstimateData (cachedAt: null — not from cache)
  const estimateData: EstimateData = {
    ...routerResult.data,
    portionMultiplier: effectiveMultiplier,
    result: scaledResult,
    cachedAt: null,
    // F-UX-A: pre-multiplier nutrients + portion grams, only attached when
    // a modifier was actually applied AND the cascade produced a result.
    // The Zod schema superRefine enforces both fields are paired and that
    // they only appear when portionMultiplier !== 1.0.
    //
    // Defensive shallow clone: `baseResult.nutrients` is the same reference
    // the cascade row owns. Any downstream mutation (future enrich functions,
    // cache-write side effects) would otherwise alias into the base — and
    // because the base is supposed to stay constant relative to the scaled
    // row, that would be a silent data bug. Cloning here closes the door.
    ...(shouldScale && baseResult !== null
      ? {
          baseNutrients: { ...baseResult.nutrients },
          basePortionGrams: baseResult.portionGrams,
        }
      : {}),
    // F081: Health-Hacker tips for chain dishes (threshold on scaled calories)
    ...enrichWithTips(scaledResult),
    // F082: Nutritional substitution suggestions (food-name keyword matching)
    ...enrichWithSubstitutions(scaledResult),
    // F083: Allergen detection from food/dish name keywords
    ...enrichWithAllergens(scaledResult),
    // F084: Calorie uncertainty range based on confidence + estimation method
    ...enrichWithUncertainty(scaledResult),
    // F085: Spanish portion term context from query
    ...enrichWithPortionSizing(query),
  };

  // F-UX-B: Resolve per-dish portion assumption (3-tier fallback chain).
  // Runs after enrichWithPortionSizing so portionSizing is already on estimateData.
  // Only executes when prisma is available; silently skips otherwise.
  if (prisma !== undefined) {
    const detectedTerm = detectPortionTerm(query);
    const dishId =
      scaledResult?.entityType === 'dish' ? scaledResult.entityId : null;
    const { portionAssumption } = await resolvePortionAssumption(
      prisma,
      dishId,
      detectedTerm,
      query,
      effectiveMultiplier,
      logger as Parameters<typeof resolvePortionAssumption>[5],
    );
    if (portionAssumption !== undefined) {
      estimateData.portionAssumption = portionAssumption;
    }
  }

  // Step 8 — Cache write (with cachedAt timestamp)
  const dataToCache: EstimateData = {
    ...estimateData,
    cachedAt: new Date().toISOString(),
  };
  await cacheSet(cacheKey, dataToCache, logger as Parameters<typeof cacheSet>[2]);

  return estimateData;
}
