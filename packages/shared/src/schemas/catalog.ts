// Catalog schemas — read-only browsing endpoints (F025)
//
// BooleanStringSchema: parses query string "true"/"false" to boolean.
// Avoids z.coerce.boolean() bug where Boolean("false") === true.

import { z } from 'zod';
import { DishAvailabilitySchema } from './enums.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const BooleanStringSchema = z.enum(['true', 'false']).transform(v => v === 'true');
export type BooleanString = z.infer<typeof BooleanStringSchema>;

export const CatalogPaginationSchema = z.object({
  page:     z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type CatalogPagination = z.infer<typeof CatalogPaginationSchema>;

// ---------------------------------------------------------------------------
// Response item schemas
// ---------------------------------------------------------------------------

export const RestaurantListItemSchema = z.object({
  id:          z.string().uuid(),
  name:        z.string(),
  nameEs:      z.string().nullable(),
  chainSlug:   z.string(),
  countryCode: z.string().length(2),
  isActive:    z.boolean(),
  logoUrl:     z.string().nullable(),
  website:     z.string().nullable(),
  dishCount:   z.number().int().nonnegative(),
});
export type RestaurantListItem = z.infer<typeof RestaurantListItemSchema>;

export const DishListItemSchema = z.object({
  id:             z.string().uuid(),
  name:           z.string(),
  nameEs:         z.string().nullable(),
  restaurantId:   z.string().uuid(),
  chainSlug:      z.string(),
  restaurantName: z.string(),
  availability:   DishAvailabilitySchema,
  portionGrams:   z.number().positive().nullable(),
  priceEur:       z.number().nonnegative().nullable(),
});
export type DishListItem = z.infer<typeof DishListItemSchema>;

export const ChainListItemSchema = z.object({
  chainSlug:   z.string(),
  name:        z.string(),
  nameEs:      z.string().nullable(),
  countryCode: z.string().length(2),
  dishCount:   z.number().int().nonnegative(),
  isActive:    z.boolean(),
});
export type ChainListItem = z.infer<typeof ChainListItemSchema>;

export const PaginationMetaSchema = z.object({
  page:       z.number().int(),
  pageSize:   z.number().int(),
  totalItems: z.number().int(),
  totalPages: z.number().int(),
});
export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

// ---------------------------------------------------------------------------
// Query schemas
// ---------------------------------------------------------------------------

export const RestaurantListQuerySchema = z.object({
  ...CatalogPaginationSchema.shape,
  countryCode: z.string().length(2).regex(/^[A-Z]{2}$/).optional(),
  chainSlug:   z.string().regex(/^[a-z0-9-]+$/).max(100).optional(),
  isActive:    BooleanStringSchema.optional(),
});
export type RestaurantListQuery = z.infer<typeof RestaurantListQuerySchema>;

export const RestaurantDishParamsSchema = z.object({
  id: z.string().uuid(),
});
export type RestaurantDishParams = z.infer<typeof RestaurantDishParamsSchema>;

export const RestaurantDishListQuerySchema = z.object({
  ...CatalogPaginationSchema.shape,
  search:       z.string().trim().max(255).optional(),
  availability: DishAvailabilitySchema.optional(),
});
export type RestaurantDishListQuery = z.infer<typeof RestaurantDishListQuerySchema>;

export const DishSearchQuerySchema = z.object({
  ...CatalogPaginationSchema.shape,
  q:            z.string().trim().min(1).max(255),
  chainSlug:    z.string().regex(/^[a-z0-9-]+$/).max(100).optional(),
  restaurantId: z.string().uuid().optional(),
  availability: DishAvailabilitySchema.optional(),
});
export type DishSearchQuery = z.infer<typeof DishSearchQuerySchema>;

export const ChainListQuerySchema = z.object({
  countryCode: z.string().length(2).regex(/^[A-Z]{2}$/).optional(),
  isActive:    BooleanStringSchema.optional(),
});
export type ChainListQuery = z.infer<typeof ChainListQuerySchema>;
