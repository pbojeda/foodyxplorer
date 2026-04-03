// Cooking profile DB lookup service for F072 — Cooking Profiles + Yield Factors.
//
// getCookingProfile — two-query lookup strategy:
//   1. Exact match on (foodGroup, foodName, cookingMethod)
//   2. Group wildcard match on (foodGroup, '*', cookingMethod)
//   Returns null when both queries miss.
//   Returns { error: 'invalid_yield_factor' } when a row is found but yieldFactor <= 0.
//
// NOTE: This service does NOT log — the orchestrator (applyYield.ts) handles
// logging and reason mapping. Separation of concerns: service returns a
// discriminated union, caller decides how to surface the error.
//
// Decimal handling: yieldFactor and fatAbsorption come back from Prisma as
// Decimal objects. We return the raw row — callers use Number() for arithmetic.

import type { PrismaClient, Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// CookingProfileRow
// ---------------------------------------------------------------------------

/**
 * Shape of a row returned from the cooking_profiles table via Prisma.
 * Decimal columns (yieldFactor, fatAbsorption) are Prisma.Decimal objects —
 * callers should convert with Number() before arithmetic.
 */
export interface CookingProfileRow {
  id: string;
  foodGroup: string;
  foodName: string;
  cookingMethod: string;
  yieldFactor: Prisma.Decimal;
  fatAbsorption: Prisma.Decimal | null;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// getCookingProfile
// ---------------------------------------------------------------------------

/**
 * Look up the most specific cooking profile for a given food group, food name,
 * and cooking method.
 *
 * Two-query strategy (most to least specific):
 *   1. Exact match: (foodGroup, foodName, cookingMethod)
 *   2. Group wildcard: (foodGroup, '*', cookingMethod)
 *
 * Returns:
 *   - `{ profile: CookingProfileRow }` — a valid matching profile
 *   - `{ error: 'invalid_yield_factor' }` — row found but yieldFactor <= 0 (data error)
 *   - `null` — no profile found for this combination
 */
export async function getCookingProfile(
  prisma: PrismaClient,
  foodGroup: string,
  foodName: string,
  cookingMethod: string,
): Promise<{ profile: CookingProfileRow } | { error: 'invalid_yield_factor' } | null> {
  // Query 1: exact match
  const exact = await prisma.cookingProfile.findFirst({
    where: { foodGroup, foodName, cookingMethod },
  }) as CookingProfileRow | null;

  if (exact !== null) {
    return validateAndWrap(exact);
  }

  // Query 2: group wildcard (foodName sentinel = '*')
  const wildcard = await prisma.cookingProfile.findFirst({
    where: { foodGroup, foodName: '*', cookingMethod },
  }) as CookingProfileRow | null;

  if (wildcard !== null) {
    return validateAndWrap(wildcard);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Validate that a found row has a positive yieldFactor before returning it.
 * Returns { error } if yieldFactor <= 0, otherwise wraps in { profile }.
 */
function validateAndWrap(
  row: CookingProfileRow,
): { profile: CookingProfileRow } | { error: 'invalid_yield_factor' } {
  const factor = Number(row.yieldFactor);
  if (!isFinite(factor) || factor <= 0) {
    return { error: 'invalid_yield_factor' };
  }
  return { profile: row };
}
