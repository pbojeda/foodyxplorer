// Zod schemas for F072 — Cooking Profiles + Yield Factors.
//
// CookingStateSchema          — enum: raw | cooked | as_served
// CookingStateSourceSchema    — enum: explicit | default_assumption | none
// YieldAdjustmentReasonSchema — enum of all 9 reason codes
// YieldAdjustmentSchema       — per-ingredient yield adjustment block
// CookingProfileSchema        — shape of a cooking_profiles row

import { z } from 'zod';

// ---------------------------------------------------------------------------
// CookingStateSchema
// ---------------------------------------------------------------------------

export const CookingStateSchema = z.enum(['raw', 'cooked', 'as_served']);

export type CookingState = z.infer<typeof CookingStateSchema>;

// ---------------------------------------------------------------------------
// CookingStateSourceSchema
// ---------------------------------------------------------------------------

export const CookingStateSourceSchema = z.enum([
  'explicit',
  'default_assumption',
  'none',
  'llm_extracted',
]);

export type CookingStateSource = z.infer<typeof CookingStateSourceSchema>;

// ---------------------------------------------------------------------------
// YieldAdjustmentReasonSchema
// ---------------------------------------------------------------------------

export const YieldAdjustmentReasonSchema = z.enum([
  'cooked_state_applied',        // yield correction applied (cooked weight → raw equivalent)
  'raw_state_no_correction',     // nutrients already in raw basis, no conversion needed
  'as_served_passthrough',       // caller declared as_served, no conversion
  'no_profile_found',            // no matching cooking profile in DB
  'dish_always_as_served',       // result is a restaurant dish, always as_served
  'nutrients_not_per_100g',      // reference basis is per_serving, cannot apply
  'db_food_already_cooked',      // DB food name indicates already-cooked nutrients
  'cannot_reverse_cooked_to_raw', // user asked raw but DB food is cooked
  'invalid_yield_factor',        // yieldFactor <= 0 in DB (data error)
  'per_ingredient_yield_applied', // Strategy B: yield applied per-ingredient before aggregation
]);

export type YieldAdjustmentReason = z.infer<typeof YieldAdjustmentReasonSchema>;

// ---------------------------------------------------------------------------
// YieldAdjustmentSchema
// ---------------------------------------------------------------------------

export const YieldAdjustmentSchema = z.object({
  /** Whether yield correction was applied to the nutrients */
  applied: z.boolean(),
  /** Effective cooking state (explicit or resolved from default assumption) */
  cookingState: CookingStateSchema,
  /** How the cooking state was determined */
  cookingStateSource: CookingStateSourceSchema,
  /** Cooking method used for profile lookup — null when not applicable */
  cookingMethod: z.string().max(100).nullable(),
  /** Yield factor applied — null when correction was not applied */
  yieldFactor: z.number().positive().nullable(),
  /** Whether fat absorption was added to fats and calories */
  fatAbsorptionApplied: z.boolean(),
  /** Reason code describing the outcome of yield resolution */
  reason: YieldAdjustmentReasonSchema,
});

export type YieldAdjustment = z.infer<typeof YieldAdjustmentSchema>;

// ---------------------------------------------------------------------------
// CookingProfileSchema — mirrors the cooking_profiles DB table shape
// ---------------------------------------------------------------------------

export const CookingProfileSchema = z.object({
  id: z.string().uuid(),
  foodGroup: z.string().min(1).max(100),
  /** Group-level defaults use sentinel value '*' instead of NULL */
  foodName: z.string().min(1).max(255),
  cookingMethod: z.string().min(1).max(100),
  yieldFactor: z.number().positive(),
  fatAbsorption: z.number().nonnegative().nullable(),
  source: z.string().min(1).max(255),
  createdAt: z.string().or(z.date()),
  updatedAt: z.string().or(z.date()),
});

export type CookingProfile = z.infer<typeof CookingProfileSchema>;
