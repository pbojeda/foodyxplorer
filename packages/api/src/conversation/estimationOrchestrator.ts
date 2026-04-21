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
import { applyPortionMultiplier, applyPortionAssumptionScaling } from '../estimation/portionUtils.js';
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
  /** BUG-PROD-006: Pre-F042/F078 query for portion term detection.
   *  When provided, F085 and F-UX-B detection use this instead of the
   *  stripped `query`. Omit for callers without F042/F078 processing
   *  (e.g., GET /estimate route) — falls back to `query`. */
  originalQuery?: string;
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
    originalQuery,
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
  // BUG-PROD-006: use pre-F042/F078 query for portion detection when available.
  const portionDetectionQuery = originalQuery ?? query;
  const normalizedPortionQuery = portionDetectionQuery.replace(/\s+/g, ' ').trim().toLowerCase();
  // Include normalizedPortionQuery in cache key only when different from normalizedQuery.
  // Prevents 'tapa de croquetas' (portionSizing=tapa) and 'croquetas' (portionSizing=null)
  // from sharing a cache hit.
  const portionKeySuffix = normalizedPortionQuery !== normalizedQuery
    ? `:${normalizedPortionQuery}`
    : '';
  const cacheKey = buildKey(
    'estimate',
    `${normalizedQuery}:${chainSlug ?? ''}:${restaurantId ?? ''}:${effectiveMultiplier}${portionKeySuffix}`,
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
  let estimateData: EstimateData = {
    ...routerResult.data,
    portionMultiplier: effectiveMultiplier,
    result: scaledResult,
    cachedAt: null,
    // F-UX-A: pre-multiplier nutrients + portion grams, only attached when
    // a modifier was actually applied AND the cascade produced a result.
    // The Zod schema superRefine enforces both fields are paired and that
    // they only appear when portionMultiplier !== 1.0 OR portionRatio applied.
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
    // F085: Spanish portion term context from query (BUG-PROD-006: use pre-F078 originalQuery)
    ...enrichWithPortionSizing(portionDetectionQuery),
  };

  // F-UX-B: Resolve per-dish portion assumption (3-tier fallback chain).
  // Runs after enrichWithPortionSizing so portionSizing is already on estimateData.
  // Only executes when prisma is available; silently skips otherwise.
  if (prisma !== undefined) {
    // BUG-PROD-006: use pre-F042/F078 originalQuery for portion term detection.
    const detectedTerm = detectPortionTerm(portionDetectionQuery);
    const dishId =
      scaledResult?.entityType === 'dish' ? scaledResult.entityId : null;

    // media_racion double-count guard: F042 extracts multiplier=0.5 from 'media ración'
    // in the user query; Tier 2 also applies ×0.5 (its definition of half-ración).
    // When coming via conversation path (originalQuery defined), pass multiplier=1.0 so
    // Tier 2 only applies the inherent ×0.5 — the nutrient scaling from F042 is handled
    // separately by applyPortionMultiplier upstream.
    // For GET /estimate with explicit portionMultiplier (originalQuery absent), pass the
    // full effectiveMultiplier so that e.g. 'media ración grande' (multiplier=1.5) scales
    // the Tier 2 result correctly: grams = racion.grams × 0.5 × 1.5.
    const isMediaRacion =
      detectedTerm !== null &&
      (detectedTerm.term.toLowerCase() === 'media ración' ||
        detectedTerm.term.toLowerCase() === 'media racion');
    const portionMultiplierForAssumption =
      originalQuery !== undefined && isMediaRacion ? 1.0 : effectiveMultiplier;

    const { portionAssumption } = await resolvePortionAssumption(
      prisma,
      dishId,
      detectedTerm,
      portionDetectionQuery,
      portionMultiplierForAssumption,
      logger as Parameters<typeof resolvePortionAssumption>[5],
    );

    if (portionAssumption !== undefined) {
      estimateData.portionAssumption = portionAssumption;

      // BUG-PROD-011: scale nutrients + portionGrams to match portionAssumption.grams
      // when a per_dish assumption was resolved and grams differ from result.
      if (scaledResult !== null) {
        const portionScaled = applyPortionAssumptionScaling(scaledResult, portionAssumption);
        if (portionScaled !== null) {
          estimateData.result = portionScaled;
          // baseNutrients always sourced from cascade's raw baseResult (pre-any-scaling).
          // Defensive shallow clone prevents aliasing between base and scaled rows.
          // Non-null assertion safe: scaledResult !== null implies baseResult !== null
          // (scaledResult is either baseResult itself or applyPortionMultiplier(baseResult,...))
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- invariant documented above
          estimateData.baseNutrients = { ...baseResult!.nutrients };
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- same invariant as baseNutrients above
          estimateData.basePortionGrams = baseResult!.portionGrams;
        }
      }
    }
  }

  // F084: Uncertainty range — MUST run after portionAssumption scaling (AC13).
  // enrichWithUncertainty depends on result.nutrients.calories; if called before
  // scaling, it would compute a range against pre-ratio calories.
  estimateData = { ...estimateData, ...enrichWithUncertainty(estimateData.result) };

  // Step 8 — Cache write (with cachedAt timestamp)
  const dataToCache: EstimateData = {
    ...estimateData,
    cachedAt: new Date().toISOString(),
  };
  await cacheSet(cacheKey, dataToCache, logger as Parameters<typeof cacheSet>[2]);

  return estimateData;
}
