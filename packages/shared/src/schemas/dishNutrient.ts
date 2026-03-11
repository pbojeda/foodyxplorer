import { z } from 'zod';
import {
  ConfidenceLevelSchema,
  EstimationMethodSchema,
  NutrientReferenceBasisSchema,
} from './enums';

export const DishNutrientSchema = z.object({
  id: z.string().uuid(),
  dishId: z.string().uuid(),
  calories: z.number().nonnegative().max(9000),
  proteins: z.number().nonnegative(),
  carbohydrates: z.number().nonnegative(),
  sugars: z.number().nonnegative(),
  fats: z.number().nonnegative(),
  saturatedFats: z.number().nonnegative(),
  fiber: z.number().nonnegative(),
  salt: z.number().nonnegative(),
  sodium: z.number().nonnegative(),
  extra: z.unknown().nullable().optional(),
  referenceBasis: NutrientReferenceBasisSchema,
  transFats: z.number().nonnegative(),
  cholesterol: z.number().nonnegative(),
  potassium: z.number().nonnegative(),
  monounsaturatedFats: z.number().nonnegative(),
  polyunsaturatedFats: z.number().nonnegative(),
  estimationMethod: EstimationMethodSchema,
  sourceId: z.string().uuid(),
  confidenceLevel: ConfidenceLevelSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type DishNutrient = z.infer<typeof DishNutrientSchema>;

export const CreateDishNutrientSchema = DishNutrientSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  referenceBasis: NutrientReferenceBasisSchema.default('per_serving'),
  transFats: z.number().nonnegative().default(0),
  cholesterol: z.number().nonnegative().default(0),
  potassium: z.number().nonnegative().default(0),
  monounsaturatedFats: z.number().nonnegative().default(0),
  polyunsaturatedFats: z.number().nonnegative().default(0),
});
export type CreateDishNutrient = z.infer<typeof CreateDishNutrientSchema>;
