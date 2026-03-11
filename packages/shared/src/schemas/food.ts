import { z } from 'zod';
import { ConfidenceLevelSchema, FoodTypeSchema } from './enums';

export const FoodSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  nameEs: z.string().min(1).max(255),
  aliases: z.array(z.string()),
  foodGroup: z.string().max(100).nullable().optional(),
  sourceId: z.string().uuid(),
  externalId: z.string().max(100).nullable().optional(),
  confidenceLevel: ConfidenceLevelSchema,
  foodType: FoodTypeSchema,
  brandName: z.string().max(255).nullable().optional(),
  barcode: z.string().max(50).nullable().optional(),
  // embedding column is not represented here — it is a vector(1536) DB column
  // and is not serialisable to JSON; use raw SQL for reads/writes
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Food = z.infer<typeof FoodSchema>;

export const CreateFoodSchema = FoodSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  foodType: FoodTypeSchema.default('generic'),
});
export type CreateFood = z.infer<typeof CreateFoodSchema>;
