import { z } from 'zod';

export const RestaurantSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  nameEs: z.string().min(1).max(255).nullable().optional(),
  chainSlug: z.string().min(1).max(100),
  website: z.string().nullable().optional(),
  logoUrl: z.string().nullable().optional(),
  countryCode: z.string().length(2).regex(/^[A-Z]{2}$/),
  isActive: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Restaurant = z.infer<typeof RestaurantSchema>;

export const CreateRestaurantSchema = RestaurantSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  countryCode: z.string().length(2).regex(/^[A-Z]{2}$/).default('ES'),
  isActive: z.boolean().default(true),
});
export type CreateRestaurant = z.infer<typeof CreateRestaurantSchema>;
