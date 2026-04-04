// Zod schemas for the "Modo Menú del Día" feature (F076).
//
// MenuEstimationTotalsSchema — aggregated nutrients across all matched menu items
// MenuEstimationItemSchema   — single menu item (query + estimation result)
// MenuEstimationDataSchema   — full menu estimation response payload

import { z } from 'zod';
import { EstimateDataSchema } from './estimate.js';

// ---------------------------------------------------------------------------
// Totals — aggregated nutrients (all 15, excluding referenceBasis)
// ---------------------------------------------------------------------------

export const MenuEstimationTotalsSchema = z.object({
  calories: z.number().nonnegative(),
  proteins: z.number().nonnegative(),
  carbohydrates: z.number().nonnegative(),
  sugars: z.number().nonnegative(),
  fats: z.number().nonnegative(),
  saturatedFats: z.number().nonnegative(),
  fiber: z.number().nonnegative(),
  salt: z.number().nonnegative(),
  sodium: z.number().nonnegative(),
  transFats: z.number().nonnegative(),
  cholesterol: z.number().nonnegative(),
  potassium: z.number().nonnegative(),
  monounsaturatedFats: z.number().nonnegative(),
  polyunsaturatedFats: z.number().nonnegative(),
  alcohol: z.number().nonnegative(),
});

export type MenuEstimationTotals = z.infer<typeof MenuEstimationTotalsSchema>;

// ---------------------------------------------------------------------------
// Item — one dish in the menu
// ---------------------------------------------------------------------------

export const MenuEstimationItemSchema = z.object({
  query: z.string(),
  estimation: EstimateDataSchema,
});

export type MenuEstimationItem = z.infer<typeof MenuEstimationItemSchema>;

// ---------------------------------------------------------------------------
// Data — full menu estimation payload
// ---------------------------------------------------------------------------

export const MenuEstimationDataSchema = z.object({
  items: z.array(MenuEstimationItemSchema),
  totals: MenuEstimationTotalsSchema,
  itemCount: z.number().int().nonnegative(),
  matchedCount: z.number().int().nonnegative(),
});

export type MenuEstimationData = z.infer<typeof MenuEstimationDataSchema>;
