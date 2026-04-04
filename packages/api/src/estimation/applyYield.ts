// Yield orchestration layer for F072 — Cooking Profiles + Yield Factors.
//
// resolveAndApplyYield — implements the full decision tree:
//   1. dish entityType → dish_always_as_served (dishes always treated as as_served)
//   2. referenceBasis ≠ per_100g → nutrients_not_per_100g (cannot apply yield)
//   3. Compute derived values: normalize group, effective cooking state/method, source
//   4. isAlreadyCookedFood check:
//      - cooked state → db_food_already_cooked (skip — nutrients already cooked)
//      - raw state    → cannot_reverse_cooked_to_raw (warn, skip)
//   5. as_served → as_served_passthrough (passthrough, no correction)
//   6. raw → raw_state_no_correction (nutrients already raw-basis, no conversion)
//   7. cooked → getCookingProfile → applyYieldFactor (or error/no-match variants)
//
// The orchestrator handles all logging; cookingProfileService does not log.

import type { PrismaClient } from '@prisma/client';
import type { EstimateResult, YieldAdjustment } from '@foodxplorer/shared';
import { getCookingProfile } from './cookingProfileService.js';
import {
  normalizeFoodGroup,
  getDefaultCookingMethod,
  getDefaultCookingState,
  isAlreadyCookedFood,
  applyYieldFactor,
} from './yieldUtils.js';

// ---------------------------------------------------------------------------
// Logger interface (minimal — accepts any pino-compatible logger)
// ---------------------------------------------------------------------------

export interface Logger {
  warn: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
  info?: (msg: string, ...args: unknown[]) => void;
  debug?: (msg: string, ...args: unknown[]) => void;
}

// ---------------------------------------------------------------------------
// ApplyYieldOptions
// ---------------------------------------------------------------------------

export interface ApplyYieldOptions {
  /** Already-resolved estimation result (food or dish). */
  result: EstimateResult;
  /** Display name of the resolved food (used for BEDCA keyword detection). */
  foodName: string;
  /**
   * Raw food_group string from the DB (e.g., "Cereal Grains and Pasta").
   * Pass null when unknown (composite or dish). Will be normalized internally.
   */
  rawFoodGroup: string | null;
  /**
   * Caller-declared cooking state ('raw' | 'cooked' | 'as_served').
   * When undefined, default assumptions fire based on food group.
   */
  cookingState?: string;
  /**
   * Optional cooking method for profile lookup ('boiled', 'fried', 'grilled', …).
   * When undefined, the default method for the food group is used.
   */
  cookingMethod?: string;
  /** Prisma client for cooking_profiles lookup. */
  prisma: PrismaClient;
  /** Pino-compatible logger for warn/error messages. */
  logger: Logger;
}

// ---------------------------------------------------------------------------
// resolveAndApplyYield
// ---------------------------------------------------------------------------

/**
 * Orchestrates all guard checks and calls getCookingProfile + applyYieldFactor.
 * Returns the (possibly corrected) result and a yieldAdjustment descriptor.
 * Pure orchestration — does not mutate the input result.
 */
export async function resolveAndApplyYield(
  opts: ApplyYieldOptions,
): Promise<{ result: EstimateResult; yieldAdjustment: YieldAdjustment }> {
  const { result, foodName, rawFoodGroup, prisma, logger } = opts;

  // ---------------------------------------------------------------------------
  // Guard 1: dish entities are always as_served — no yield correction possible
  // ---------------------------------------------------------------------------
  if (result.entityType === 'dish') {
    return passthrough(result, {
      cookingState: 'as_served',
      cookingStateSource: 'none',
      cookingMethod: null,
      reason: 'dish_always_as_served',
    });
  }

  // ---------------------------------------------------------------------------
  // Guard 2: nutrients not per_100g — cannot apply yield correction reliably
  // ---------------------------------------------------------------------------
  if (result.nutrients.referenceBasis !== 'per_100g') {
    return passthrough(result, {
      cookingState: 'as_served',
      cookingStateSource: 'none',
      cookingMethod: null,
      reason: 'nutrients_not_per_100g',
    });
  }

  // ---------------------------------------------------------------------------
  // Step 3: compute all derived values
  // ---------------------------------------------------------------------------
  const group = rawFoodGroup !== null ? normalizeFoodGroup(rawFoodGroup) : null;

  const cookingStateSource: YieldAdjustment['cookingStateSource'] =
    opts.cookingState !== undefined ? 'explicit' : 'default_assumption';

  const effectiveCookingState =
    opts.cookingState !== undefined
      ? (opts.cookingState as 'raw' | 'cooked' | 'as_served')
      : getDefaultCookingState(group);

  const effectiveCookingMethod: string | null =
    opts.cookingMethod !== undefined
      ? opts.cookingMethod
      : getDefaultCookingMethod(group);

  // ---------------------------------------------------------------------------
  // Step 4: BEDCA guard — already-cooked food names
  // ---------------------------------------------------------------------------
  if (isAlreadyCookedFood(foodName)) {
    if (effectiveCookingState === 'cooked') {
      // Nutrients already reflect cooked state — skip yield (no double-correction)
      return passthrough(result, {
        cookingState: effectiveCookingState,
        cookingStateSource,
        cookingMethod: effectiveCookingMethod,
        reason: 'db_food_already_cooked',
      });
    }

    if (effectiveCookingState === 'raw') {
      // Cannot reliably reverse a cooked food to raw nutrients
      logger.warn(
        `[F072] Cannot reverse cooked→raw for already-cooked DB food: "${foodName}". Skipping yield correction.`,
      );
      return passthrough(result, {
        cookingState: effectiveCookingState,
        cookingStateSource,
        cookingMethod: effectiveCookingMethod,
        reason: 'cannot_reverse_cooked_to_raw',
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Step 5: as_served → passthrough (no correction)
  // ---------------------------------------------------------------------------
  if (effectiveCookingState === 'as_served') {
    return passthrough(result, {
      cookingState: 'as_served',
      cookingStateSource,
      cookingMethod: effectiveCookingMethod,
      reason: 'as_served_passthrough',
    });
  }

  // ---------------------------------------------------------------------------
  // Step 6: raw → no correction (nutrients already raw-basis)
  // ---------------------------------------------------------------------------
  if (effectiveCookingState === 'raw') {
    return passthrough(result, {
      cookingState: 'raw',
      cookingStateSource,
      cookingMethod: effectiveCookingMethod,
      reason: 'raw_state_no_correction',
    });
  }

  // ---------------------------------------------------------------------------
  // Step 7: cooked → look up profile and apply yield factor
  // ---------------------------------------------------------------------------

  // cookingMethod must be a string for DB lookup
  // (if null, we cannot look up a profile — treat as no profile found)
  if (effectiveCookingMethod === null) {
    return passthrough(result, {
      cookingState: 'cooked',
      cookingStateSource,
      cookingMethod: null,
      reason: 'no_profile_found',
    });
  }

  const profileResult = await getCookingProfile(
    prisma,
    group ?? 'unknown',
    foodName,
    effectiveCookingMethod,
  );

  // Handle discriminated union returned by service
  if (profileResult === null) {
    // No matching profile
    return passthrough(result, {
      cookingState: 'cooked',
      cookingStateSource,
      cookingMethod: effectiveCookingMethod,
      reason: 'no_profile_found',
    });
  }

  if ('error' in profileResult) {
    // DB data error — yieldFactor <= 0
    logger.error(
      `[F072] Invalid yieldFactor (<= 0) in cooking_profiles for group="${group}", method="${effectiveCookingMethod}". Skipping yield correction.`,
    );
    return passthrough(result, {
      cookingState: 'cooked',
      cookingStateSource,
      cookingMethod: effectiveCookingMethod,
      reason: 'invalid_yield_factor',
    });
  }

  // Valid profile found — apply yield factor
  const { profile } = profileResult;
  const yieldFactor = Number(profile.yieldFactor);

  // Fat absorption: only when cookingMethod is 'fried'
  let fatAbsorption: number | null = null;
  let fatAbsorptionApplied = false;

  if (profile.fatAbsorption !== null && Number(profile.fatAbsorption) > 0) {
    if (effectiveCookingMethod === 'fried') {
      fatAbsorption = Number(profile.fatAbsorption);
      fatAbsorptionApplied = true;
    } else {
      // Profile has fatAbsorption but method is not fried — data issue
      logger.warn(
        `[F072] Profile for group="${group}", method="${effectiveCookingMethod}" has fatAbsorption but method is not "fried". Fat absorption not applied.`,
      );
    }
  }

  const correctedNutrients = applyYieldFactor(result.nutrients, yieldFactor, fatAbsorption);

  const yieldAdjustment: YieldAdjustment = {
    applied: true,
    cookingState: 'cooked',
    cookingStateSource,
    cookingMethod: effectiveCookingMethod,
    yieldFactor,
    fatAbsorptionApplied,
    reason: 'cooked_state_applied',
  };

  return {
    result: { ...result, nutrients: correctedNutrients },
    yieldAdjustment,
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Build a no-correction return value with the given reason.
 * Nutrients are passed through unchanged.
 */
function passthrough(
  result: EstimateResult,
  opts: {
    cookingState: YieldAdjustment['cookingState'];
    cookingStateSource: YieldAdjustment['cookingStateSource'];
    cookingMethod: string | null;
    reason: YieldAdjustment['reason'];
  },
): { result: EstimateResult; yieldAdjustment: YieldAdjustment } {
  return {
    result,
    yieldAdjustment: {
      applied: false,
      cookingState: opts.cookingState,
      cookingStateSource: opts.cookingStateSource,
      cookingMethod: opts.cookingMethod,
      yieldFactor: null,
      fatAbsorptionApplied: false,
      reason: opts.reason,
    },
  };
}
