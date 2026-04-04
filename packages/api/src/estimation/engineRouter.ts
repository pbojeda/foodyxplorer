// Engine Router — F023
//
// Encapsulates the L1→L2→L3→L4 estimation cascade extracted from the /estimate route.
// Accepts an optional level4Lookup function to enable F024 (LLM Integration Layer)
// injection without modifying this module or the route.
//
// Design decisions:
// - Receives raw query (post-Zod-trim); normalizes internally for DB lookups.
// - Echoes raw query in data.query (not the normalized form).
// - Cache interaction stays in the route (HTTP concern, not estimation concern).
// - config.OPENAI_API_KEY is injected via opts.openAiApiKey (DI, not imported here).
// - levelHit is internal debug metadata; not serialized in the HTTP response.

import type { Kysely } from 'kysely';
import type { PrismaClient } from '@prisma/client';
import type { DB } from '../generated/kysely-types.js';
import type { EstimateData, EstimateMatchType, EstimateResult, YieldAdjustment } from '@foodxplorer/shared';
import { level1Lookup } from './level1Lookup.js';
import { level2Lookup } from './level2Lookup.js';
import { level3Lookup } from './level3Lookup.js';
import { resolveAndApplyYield } from './applyYield.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Signature for F024 LLM Integration Layer injection.
 * F023 defines the signature; F024 implements and injects it.
 * logger is optional for backward compatibility — F023 tests omit it.
 * F072: rawFoodGroup added to return type for yield correction threading.
 * F074: perIngredientYieldApplied + yieldAdjustment added for Strategy B per-ingredient yield.
 *       options extended with prisma, cookingState, cookingMethod for explicit override support.
 */
export type Level4LookupFn = (
  db: Kysely<DB>,
  query: string,
  options: {
    chainSlug?: string;
    restaurantId?: string;
    openAiApiKey?: string;
    logger?: { info: (obj: Record<string, unknown>, msg?: string) => void; warn: (obj: Record<string, unknown>, msg?: string) => void; debug: (obj: Record<string, unknown>, msg?: string) => void };
    /** F074: Prisma client for per-ingredient yield correction inside Strategy B. */
    prisma?: PrismaClient;
    /** F074: Explicit caller-declared cooking state — overrides LLM-extracted values. */
    cookingState?: string;
    /** F074: Explicit caller-declared cooking method — overrides LLM-extracted values. */
    cookingMethod?: string;
  },
) => Promise<{
  matchType: EstimateMatchType;
  result: EstimateResult;
  rawFoodGroup?: string | null;
  /** F074: When true, Strategy B applied per-ingredient yield and yieldAdjustment is pre-computed. */
  perIngredientYieldApplied?: boolean;
  /** F074: Pre-computed aggregate yield adjustment from per-ingredient correction. */
  yieldAdjustment?: YieldAdjustment;
} | null>;

export interface EngineRouterOptions {
  db: Kysely<DB>;
  /** Raw query string (post-Zod-trim). Router normalizes internally for lookups. */
  query: string;
  chainSlug?: string;
  restaurantId?: string;
  /** Pass undefined to let Level 3 skip gracefully (no OpenAI call). */
  openAiApiKey?: string;
  /** Optional F024 injection point. Undefined = cascade stops after L3. */
  level4Lookup?: Level4LookupFn;
  /** Optional logger forwarded to L4 for token usage logging. */
  logger?: { info: (obj: Record<string, unknown>, msg?: string) => void; warn: (obj: Record<string, unknown>, msg?: string) => void; debug: (obj: Record<string, unknown>, msg?: string) => void };
  /** F068: When true, L1 attempts Tier 0 (branded) match first before normal cascade. */
  hasExplicitBrand?: boolean;
  /** F072: Prisma client for cooking_profiles lookup (yield correction). */
  prisma?: PrismaClient;
  /** F072: Caller-declared cooking state ('raw' | 'cooked' | 'as_served'). */
  cookingState?: string;
  /** F072: Optional cooking method for profile lookup. */
  cookingMethod?: string;
}

export type EngineRouterResult = {
  /** Cascade data — portionMultiplier is added by the route handler, not the cascade. */
  data: Omit<EstimateData, 'portionMultiplier'>;
  /** Internal debug flag — which level produced the result (null = total miss). NOT exposed in HTTP response. */
  levelHit: 1 | 2 | 3 | 4 | null;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Runs the L1→L2→L3→L4 estimation cascade.
 *
 * Returns EngineRouterResult with:
 * - data: EstimateData (ready for HTTP response)
 * - levelHit: which level hit (null = all missed) — for debug logging only
 *
 * Error handling: wraps DB errors from any level with { statusCode: 500, code: 'DB_UNAVAILABLE' }.
 */
export async function runEstimationCascade(
  opts: EngineRouterOptions,
): Promise<EngineRouterResult> {
  const { db, query, chainSlug, restaurantId, openAiApiKey, level4Lookup, logger, hasExplicitBrand, prisma, cookingState, cookingMethod } = opts;

  // Normalize for DB lookups. Raw query is echoed in data.query.
  const normalizedQuery = query.replace(/\s+/g, ' ').trim().toLowerCase();

  // ---------------------------------------------------------------------------
  // Helper: apply yield correction after a successful cascade hit.
  // Only called when result is non-null. Gracefully skips when prisma absent.
  // ---------------------------------------------------------------------------
  async function applyYield(
    result: EstimateResult,
    rawFoodGroup: string | null | undefined,
  ): Promise<{ result: EstimateResult; yieldAdjustment: YieldAdjustment | null }> {
    if (prisma === undefined) {
      return { result, yieldAdjustment: null };
    }

    const { result: corrected, yieldAdjustment } = await resolveAndApplyYield({
      result,
      foodName: result.name,
      rawFoodGroup: rawFoodGroup ?? null,
      cookingState,
      cookingMethod,
      prisma,
      logger: logger !== undefined
        ? { warn: (msg) => logger.warn({}, msg), error: (msg) => logger.error({}, msg) }
        : { warn: () => {}, error: () => {} },
    });

    return { result: corrected, yieldAdjustment };
  }

  // --- Level 1 lookup ---
  let lookupResult1;
  try {
    lookupResult1 = await level1Lookup(db, normalizedQuery, { chainSlug, restaurantId, hasExplicitBrand });
  } catch (err) {
    throw Object.assign(
      new Error('Database query failed'),
      { statusCode: 500, code: 'DB_UNAVAILABLE', cause: err },
    );
  }

  if (lookupResult1 !== null) {
    const { result: yieldResult, yieldAdjustment } = await applyYield(lookupResult1.result, lookupResult1.rawFoodGroup);
    return {
      levelHit: 1,
      data: {
        query,
        chainSlug: chainSlug ?? null,
        level1Hit: true,
        level2Hit: false,
        level3Hit: false,
        level4Hit: false,
        matchType: lookupResult1.matchType,
        result: yieldResult,
        cachedAt: null,
        yieldAdjustment,
      },
    };
  }

  // --- Level 2 fallback ---
  let lookupResult2;
  try {
    lookupResult2 = await level2Lookup(db, normalizedQuery, { chainSlug, restaurantId });
  } catch (err) {
    throw Object.assign(
      new Error('Database query failed'),
      { statusCode: 500, code: 'DB_UNAVAILABLE', cause: err },
    );
  }

  if (lookupResult2 !== null) {
    // L2 always resolves to dishes (entityType='dish') — rawFoodGroup = null
    const { result: yieldResult, yieldAdjustment } = await applyYield(lookupResult2.result, null);
    return {
      levelHit: 2,
      data: {
        query,
        chainSlug: chainSlug ?? null,
        level1Hit: false,
        level2Hit: true,
        level3Hit: false,
        level4Hit: false,
        matchType: lookupResult2.matchType,
        result: yieldResult,
        cachedAt: null,
        yieldAdjustment,
      },
    };
  }

  // --- Level 3 fallback ---
  let lookupResult3;
  try {
    lookupResult3 = await level3Lookup(db, normalizedQuery, {
      chainSlug,
      restaurantId,
      openAiApiKey,
    });
  } catch (err) {
    throw Object.assign(
      new Error('Database query failed'),
      { statusCode: 500, code: 'DB_UNAVAILABLE', cause: err },
    );
  }

  if (lookupResult3 !== null) {
    const { result: yieldResult, yieldAdjustment } = await applyYield(lookupResult3.result, lookupResult3.rawFoodGroup);
    return {
      levelHit: 3,
      data: {
        query,
        chainSlug: chainSlug ?? null,
        level1Hit: false,
        level2Hit: false,
        level3Hit: true,
        level4Hit: false,
        matchType: lookupResult3.matchType,
        result: yieldResult,
        cachedAt: null,
        yieldAdjustment,
      },
    };
  }

  // --- Level 4 fallback (F024 injection seam) ---
  if (level4Lookup !== undefined) {
    let lookupResult4;
    try {
      lookupResult4 = await level4Lookup(db, normalizedQuery, {
        chainSlug,
        restaurantId,
        openAiApiKey,
        logger,
        // F074: pass prisma + explicit params so Strategy B can do per-ingredient yield
        prisma,
        cookingState,
        cookingMethod,
      });
    } catch (err) {
      throw Object.assign(
        new Error('Database query failed'),
        { statusCode: 500, code: 'DB_UNAVAILABLE', cause: err },
      );
    }

    if (lookupResult4 !== null) {
      // F074: When Strategy B applied per-ingredient yield, use its pre-computed yieldAdjustment
      // directly instead of calling applyYield() again (which would double-correct nutrients).
      let yieldResult: EstimateResult;
      let yieldAdjustment: YieldAdjustment | null;

      if (lookupResult4.perIngredientYieldApplied === true && lookupResult4.yieldAdjustment !== undefined) {
        yieldResult = lookupResult4.result;
        yieldAdjustment = lookupResult4.yieldAdjustment;
      } else {
        ({ result: yieldResult, yieldAdjustment } = await applyYield(lookupResult4.result, lookupResult4.rawFoodGroup));
      }

      return {
        levelHit: 4,
        data: {
          query,
          chainSlug: chainSlug ?? null,
          level1Hit: false,
          level2Hit: false,
          level3Hit: false,
          level4Hit: true,
          matchType: lookupResult4.matchType,
          result: yieldResult,
          cachedAt: null,
          yieldAdjustment,
        },
      };
    }
  }

  // --- Total miss ---
  return {
    levelHit: null,
    data: {
      query,
      chainSlug: chainSlug ?? null,
      level1Hit: false,
      level2Hit: false,
      level3Hit: false,
      level4Hit: false,
      matchType: null,
      result: null,
      cachedAt: null,
      yieldAdjustment: null,
    },
  };
}
