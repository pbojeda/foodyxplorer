import { z } from 'zod';
import { ConfidenceLevelSchema } from './enums';

export const FoodNutrientSchema = z.object({
  id: z.string().uuid(),
  foodId: z.string().uuid(),
  calories: z.number().nonnegative().max(900),
  proteins: z.number().nonnegative(),
  carbohydrates: z.number().nonnegative(),
  sugars: z.number().nonnegative(),
  fats: z.number().nonnegative(),
  saturatedFats: z.number().nonnegative(),
  fiber: z.number().nonnegative(),
  salt: z.number().nonnegative(),
  sodium: z.number().nonnegative(),
  extra: z.unknown().nullable().optional(),
  sourceId: z.string().uuid(),
  confidenceLevel: ConfidenceLevelSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type FoodNutrient = z.infer<typeof FoodNutrientSchema>;

export const CreateFoodNutrientSchema = FoodNutrientSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateFoodNutrient = z.infer<typeof CreateFoodNutrientSchema>;
