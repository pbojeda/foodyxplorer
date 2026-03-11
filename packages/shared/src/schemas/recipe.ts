import { z } from 'zod';

export const RecipeSchema = z.object({
  id: z.string().uuid(),
  foodId: z.string().uuid(),
  servings: z.number().int().positive().nullable(),
  prepMinutes: z.number().int().nonnegative().nullable(),
  cookMinutes: z.number().int().nonnegative().nullable(),
  sourceId: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Recipe = z.infer<typeof RecipeSchema>;

export const CreateRecipeSchema = RecipeSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  servings: z.number().int().positive().nullable().optional(),
  prepMinutes: z.number().int().nonnegative().nullable().optional(),
  cookMinutes: z.number().int().nonnegative().nullable().optional(),
});
export type CreateRecipe = z.infer<typeof CreateRecipeSchema>;
