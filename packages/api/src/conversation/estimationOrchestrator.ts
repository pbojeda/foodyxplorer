// EstimationOrchestrator (F070, Step 6)
//
// Encapsulates the estimation logic extracted from GET /estimate:
//   cache check → brand detection → runEstimationCascade → applyPortionMultiplier → cache write
//
// actorId is NOT in EstimateParams — query logging (which needs actorId) is the
// route handler's responsibility.

import type { Kysely } from 'kysely';
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EstimateParams {
  query: string;
  chainSlug?: string;
  restaurantId?: string;
  portionMultiplier?: number;
  db: Kysely<DB>;
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

  // Step 6 — Apply portion multiplier
  const scaledResult =
    effectiveMultiplier !== 1 && routerResult.data.result !== null
      ? applyPortionMultiplier(routerResult.data.result, effectiveMultiplier)
      : routerResult.data.result;

  // Step 7 — Assemble EstimateData (cachedAt: null — not from cache)
  const estimateData: EstimateData = {
    ...routerResult.data,
    portionMultiplier: effectiveMultiplier,
    result: scaledResult,
    cachedAt: null,
    // F081: Health-Hacker tips for chain dishes (threshold on scaled calories)
    ...enrichWithTips(scaledResult),
    // F082: Nutritional substitution suggestions (food-name keyword matching)
    ...enrichWithSubstitutions(scaledResult),
    // F083: Allergen detection from food/dish name keywords
    ...enrichWithAllergens(scaledResult),
  };

  // Step 8 — Cache write (with cachedAt timestamp)
  const dataToCache: EstimateData = {
    ...estimateData,
    cachedAt: new Date().toISOString(),
  };
  await cacheSet(cacheKey, dataToCache, logger as Parameters<typeof cacheSet>[2]);

  return estimateData;
}
