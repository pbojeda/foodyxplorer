// /platos <restaurantId> command handler.

import { z } from 'zod';
import type { ApiClient } from '../apiClient.js';
import { handleApiError } from './errorMessages.js';
import { formatDishList } from '../formatters/dishFormatter.js';
import { logger } from '../logger.js';
import { ApiError } from '../apiClient.js';

const UuidSchema = z.string().uuid();

/**
 * List dishes for a specific restaurant.
 * Validates UUID format before calling the API.
 */
export async function handlePlatos(args: string, apiClient: ApiClient): Promise<string> {
  const restaurantId = args.trim();

  if (!restaurantId) {
    return 'Uso: /platos \\<restaurantId\\>\nEl ID del restaurante es un UUID\\.\nEjemplo: /platos 123e4567\\-e89b\\-12d3\\-a456\\-426614174000';
  }

  const parsed = UuidSchema.safeParse(restaurantId);
  if (!parsed.success) {
    return 'Formato de ID incorrecto\\. El ID debe ser un UUID valido\\.\nEjemplo: /platos 123e4567\\-e89b\\-12d3\\-a456\\-426614174000';
  }

  try {
    const result = await apiClient.listRestaurantDishes(restaurantId, { page: 1, pageSize: 10 });
    return formatDishList(result.items, result.pagination);
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 404) {
      return 'No se encontro ningun restaurante con ese ID\\.';
    }
    logger.warn({ err, restaurantId }, '/platos API error');
    return handleApiError(err);
  }
}
