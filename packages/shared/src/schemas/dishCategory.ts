import { z } from 'zod';

export const DishCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  nameEs: z.string().min(1).max(255),
  slug: z.string().min(1).max(100),
  description: z.string().nullable().optional(),
  sortOrder: z.number().int().nonnegative(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type DishCategory = z.infer<typeof DishCategorySchema>;

export const CreateDishCategorySchema = DishCategorySchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  sortOrder: z.number().int().nonnegative().default(0),
});
export type CreateDishCategory = z.infer<typeof CreateDishCategorySchema>;
