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
import type { DB } from '../generated/kysely-types.js';
import type { EstimateData, EstimateMatchType, EstimateResult } from '@foodxplorer/shared';
import { level1Lookup } from './level1Lookup.js';
import { level2Lookup } from './level2Lookup.js';
import { level3Lookup } from './level3Lookup.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Signature for F024 LLM Integration Layer injection.
 * F023 defines the signature; F024 implements and injects it.
 * logger is optional for backward compatibility — F023 tests omit it.
 */
export type Level4LookupFn = (
  db: Kysely<DB>,
  query: string,
  options: {
    chainSlug?: string;
    restaurantId?: string;
    openAiApiKey?: string;
    logger?: { info: (obj: Record<string, unknown>, msg?: string) => void; warn: (obj: Record<string, unknown>, msg?: string) => void; debug: (obj: Record<string, unknown>, msg?: string) => void };
  },
) => Promise<{ matchType: EstimateMatchType; result: EstimateResult } | null>;

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
}

export type EngineRouterResult = {
  /** Full EstimateData for the HTTP response. data.query echoes the raw query. */
  data: EstimateData;
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
  const { db, query, chainSlug, restaurantId, openAiApiKey, level4Lookup, logger } = opts;

  // Normalize for DB lookups. Raw query is echoed in data.query.
  const normalizedQuery = query.replace(/\s+/g, ' ').trim().toLowerCase();

  // --- Level 1 lookup ---
  let lookupResult1;
  try {
    lookupResult1 = await level1Lookup(db, normalizedQuery, { chainSlug, restaurantId });
  } catch (err) {
    throw Object.assign(
      new Error('Database query failed'),
      { statusCode: 500, code: 'DB_UNAVAILABLE', cause: err },
    );
  }

  if (lookupResult1 !== null) {
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
        result: lookupResult1.result,
        cachedAt: null,
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
        result: lookupResult2.result,
        cachedAt: null,
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
        result: lookupResult3.result,
        cachedAt: null,
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
      });
    } catch (err) {
      throw Object.assign(
        new Error('Database query failed'),
        { statusCode: 500, code: 'DB_UNAVAILABLE', cause: err },
      );
    }

    if (lookupResult4 !== null) {
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
          result: lookupResult4.result,
          cachedAt: null,
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
    },
  };
}
