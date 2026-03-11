import { z } from 'zod';

export const DishIngredientSchema = z.object({
  id: z.string().uuid(),
  dishId: z.string().uuid(),
  ingredientFoodId: z.string().uuid(),
  amount: z.number().positive(),
  unit: z.string().min(1).max(50),
  gramWeight: z.number().nonnegative().nullable(),
  sortOrder: z.number().int().nonnegative(),
  notes: z.string().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type DishIngredient = z.infer<typeof DishIngredientSchema>;

export const CreateDishIngredientSchema = DishIngredientSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateDishIngredient = z.infer<typeof CreateDishIngredientSchema>;
