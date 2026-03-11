import { z } from 'zod';

export const CookingMethodSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  nameEs: z.string().min(1).max(255),
  slug: z.string().min(1).max(100),
  description: z.string().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type CookingMethod = z.infer<typeof CookingMethodSchema>;

export const CreateCookingMethodSchema = CookingMethodSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateCookingMethod = z.infer<typeof CreateCookingMethodSchema>;
