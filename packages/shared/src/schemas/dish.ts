import { z } from 'zod';
import { ConfidenceLevelSchema, EstimationMethodSchema, DishAvailabilitySchema } from './enums';

export const DishSchema = z.object({
  id: z.string().uuid(),
  restaurantId: z.string().uuid(),
  foodId: z.string().uuid().nullable().optional(),
  sourceId: z.string().uuid(),
  name: z.string().min(1).max(255),
  nameEs: z.string().min(1).max(255).nullable().optional(),
  nameSourceLocale: z.string().max(5).nullable().optional(),
  description: z.string().nullable().optional(),
  externalId: z.string().max(100).nullable().optional(),
  availability: DishAvailabilitySchema,
  portionGrams: z.number().positive().nullable().optional(),
  priceEur: z.number().nonnegative().nullable().optional(),
  confidenceLevel: ConfidenceLevelSchema,
  estimationMethod: EstimationMethodSchema,
  aliases: z.array(z.string()),
  // embedding column is not represented here — it is a vector(1536) DB column
  // and is not serialisable to JSON; use raw SQL for reads/writes
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Dish = z.infer<typeof DishSchema>;

export const CreateDishSchema = DishSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  availability: DishAvailabilitySchema.default('available'),
  portionGrams: z.number().positive().nullable().optional(),
  priceEur: z.number().nonnegative().nullable().optional(),
  foodId: z.string().uuid().nullable().optional(),
  aliases: z.array(z.string()).default([]),
});
export type CreateDish = z.infer<typeof CreateDishSchema>;
