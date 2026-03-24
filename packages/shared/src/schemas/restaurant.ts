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
  address: z.string().max(500).nullable().optional(),
  googleMapsUrl: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
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

// ---------------------------------------------------------------------------
// CreateRestaurantBodySchema — POST /restaurants admin endpoint body (F032)
// ---------------------------------------------------------------------------

export const CreateRestaurantBodySchema = z.object({
  name:         z.string().trim().min(1).max(255),
  countryCode:  z.string().length(2).regex(/^[A-Z]{2}$/),
  chainSlug:    z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(100).optional(),
  nameEs:       z.string().min(1).max(255).optional(),
  website:      z.string().url().optional(),
  logoUrl:      z.string().url().optional(),
  address:      z.string().max(500).optional(),
  latitude:     z.number().min(-90).max(90).optional(),
  longitude:    z.number().min(-180).max(180).optional(),
  googleMapsUrl: z.string().url().optional(),
});
export type CreateRestaurantBody = z.infer<typeof CreateRestaurantBodySchema>;
