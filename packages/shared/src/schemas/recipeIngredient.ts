import { z } from 'zod';

export const RecipeIngredientSchema = z.object({
  id: z.string().uuid(),
  recipeId: z.string().uuid(),
  ingredientFoodId: z.string().uuid(),
  amount: z.number().positive(),
  unit: z.string().min(1).max(50),
  gramWeight: z.number().nonnegative().nullable(),
  sortOrder: z.number().int().nonnegative(),
  notes: z.string().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type RecipeIngredient = z.infer<typeof RecipeIngredientSchema>;

export const CreateRecipeIngredientSchema = RecipeIngredientSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateRecipeIngredient = z.infer<typeof CreateRecipeIngredientSchema>;
