// Pure utility functions for F072 — Cooking Profiles + Yield Factors.
//
// All functions are pure (no side effects, no DB access):
//   normalizeFoodGroup     — maps USDA/BEDCA raw food groups to canonical cooking groups
//   getDefaultCookingMethod — per canonical food group
//   getDefaultCookingState  — per canonical food group
//   isAlreadyCookedFood    — detects cooking keywords in food names (ES + EN)
//   applyYieldFactor       — scales nutrients by yield factor with optional fat absorption
//
// Re-exports NUMERIC_NUTRIENT_KEYS from portionUtils for convenience.

import type { EstimateNutrients } from '@foodxplorer/shared';
import { NUMERIC_NUTRIENT_KEYS } from './portionUtils.js';

export { NUMERIC_NUTRIENT_KEYS };

// ---------------------------------------------------------------------------
// CookingGroup type
// ---------------------------------------------------------------------------

export type CookingGroup =
  | 'grains'
  | 'pasta'
  | 'legumes'
  | 'meat'
  | 'fish'
  | 'vegetables'
  | null;

// ---------------------------------------------------------------------------
// normalizeFoodGroup
//
// Maps USDA/BEDCA raw food group strings to canonical CookingGroup.
// Case-insensitive substring matching — returns null for unmatched groups.
// Matching order matters: more specific patterns first.
// ---------------------------------------------------------------------------

export function normalizeFoodGroup(rawFoodGroup: string): CookingGroup {
  const lower = rawFoodGroup.toLowerCase();

  // grains — check before "pasta" because "Cereal Grains and Pasta" should map to grains
  // (the "cereal"/"grain" keywords take precedence over "pasta" in the string)
  if (lower.includes('cereal') || lower.includes('grain')) return 'grains';

  // pasta
  if (lower.includes('pasta')) return 'pasta';

  // legumes — all legume variants
  if (
    lower.includes('legume') ||
    lower.includes('bean') ||
    lower.includes('lentil') ||
    lower.includes('chickpea')
  )
    return 'legumes';

  // meat — order matters: check specific cuts before generic "meat"
  if (
    lower.includes('beef') ||
    lower.includes('pork') ||
    lower.includes('lamb') ||
    lower.includes('poultry') ||
    lower.includes('chicken') ||
    lower.includes('meat')
  )
    return 'meat';

  // fish — all aquatic products
  if (
    lower.includes('fish') ||
    lower.includes('seafood') ||
    lower.includes('shellfish') ||
    lower.includes('finfish')
  )
    return 'fish';

  // vegetables — includes tubers, nightshades
  if (
    lower.includes('vegetable') ||
    lower.includes('potato') ||
    lower.includes('tomato') ||
    lower.includes('pepper')
  )
    return 'vegetables';

  return null;
}

// ---------------------------------------------------------------------------
// getDefaultCookingMethod
//
// Returns the default cooking method per canonical food group.
// Returns null for composite/unknown groups (no safe default).
// ---------------------------------------------------------------------------

export function getDefaultCookingMethod(group: CookingGroup): string | null {
  switch (group) {
    case 'grains':
    case 'legumes':
    case 'pasta':
    case 'vegetables':
      return 'boiled';

    case 'meat':
    case 'fish':
      return 'grilled';

    case null:
      return null;
  }
}

// ---------------------------------------------------------------------------
// getDefaultCookingState
//
// Returns the default cooking state assumption per canonical food group.
// Used when the caller does not declare cookingState explicitly.
// ---------------------------------------------------------------------------

export function getDefaultCookingState(
  group: CookingGroup,
): 'raw' | 'cooked' | 'as_served' {
  switch (group) {
    case 'grains':
    case 'legumes':
    case 'pasta':
      // Users typically report cooked serving weight (e.g. "100g of rice" = cooked)
      return 'cooked';

    case 'meat':
    case 'fish':
      // Traditional recipe writing convention: weight before cooking
      return 'raw';

    case 'vegetables':
      // Consistent with USDA per-100g raw reference
      return 'raw';

    case null:
      // Composite or unknown group — no safe assumption possible
      return 'as_served';
  }
}

// ---------------------------------------------------------------------------
// COOKING_KEYWORDS
//
// Case-insensitive patterns checked in isAlreadyCookedFood.
// Both Spanish (BEDCA) and English (USDA) keywords are included.
// ---------------------------------------------------------------------------

const COOKING_KEYWORD_PATTERNS: ReadonlyArray<RegExp> = [
  // Spanish (BEDCA) — word-boundary matching to avoid "uncooked" false positives
  /\bhervido\b/i,    // boiled
  /\bcocido\b/i,     // cooked/stewed
  /\bfrito\b/i,      // fried
  /\basado\b/i,      // roasted/grilled
  /\bal horno\b/i,   // baked (multi-word phrase)
  // English (USDA)
  /\bboiled\b/i,
  /\bcooked\b/i,
  /\bfried\b/i,
  /\bgrilled\b/i,
  /\bbaked\b/i,
  /\bsteamed\b/i,
];

// ---------------------------------------------------------------------------
// isAlreadyCookedFood
//
// Returns true if the food name contains cooking keywords indicating that the
// DB nutrients are already stored for the cooked state (e.g., "Arroz hervido").
// Uses word-boundary regex to avoid false positives on negated forms like
// "uncooked", "unbaked", "precooked" (BUG-F072-01 fix).
// ---------------------------------------------------------------------------

export function isAlreadyCookedFood(foodName: string): boolean {
  if (!foodName) return false;
  return COOKING_KEYWORD_PATTERNS.some((pattern) => pattern.test(foodName));
}

// ---------------------------------------------------------------------------
// applyYieldFactor
//
// Converts per-100g-raw nutrients to per-100g-cooked by dividing all numeric
// nutrient fields by the yield factor.
//
// Fat absorption (frying only):
//   - fatAbsorption is added to `fats` BEFORE the yieldFactor division
//   - fatAbsorption × 9 kcal is added to `calories` BEFORE the yieldFactor division
//   - Does NOT affect saturatedFats (frying oils are predominantly unsaturated)
//   - Order matters: fat absorption is defined per 100g RAW, so it must be added
//     before the raw→cooked conversion divides everything by yieldFactor.
//
// Returns a new EstimateNutrients object (pure — does not mutate the input).
// referenceBasis is preserved unchanged from the input.
// ---------------------------------------------------------------------------

export function applyYieldFactor(
  nutrients: EstimateNutrients,
  yieldFactor: number,
  fatAbsorption?: number | null,
): EstimateNutrients {
  // Spread into a mutable copy — we will modify specific fields before dividing
  const adjusted = { ...nutrients };

  // Step 1: apply fat absorption on raw basis (before dividing by yieldFactor)
  if (fatAbsorption != null && fatAbsorption > 0) {
    adjusted.fats = adjusted.fats + fatAbsorption;
    adjusted.calories = adjusted.calories + fatAbsorption * 9;
  }

  // Step 2: divide ALL numeric fields by yieldFactor (raw→cooked conversion)
  const result = { ...adjusted };
  for (const key of NUMERIC_NUTRIENT_KEYS) {
    result[key] = adjusted[key] / yieldFactor;
  }

  return result;
}
