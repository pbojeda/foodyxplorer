// /buscar <dish> command handler.

import type { ApiClient } from '../apiClient.js';
import { handleApiError } from './errorMessages.js';
import { formatDishList } from '../formatters/dishFormatter.js';
import { logger } from '../logger.js';

/**
 * Search dishes globally.
 * Returns usage hint if args is empty/whitespace.
 */
export async function handleBuscar(args: string, apiClient: ApiClient): Promise<string> {
  const query = args.trim();

  if (!query) {
    return 'Uso: /buscar \\<nombre del plato\\>\nEjemplo: /buscar big mac';
  }

  try {
    const result = await apiClient.searchDishes({ q: query, page: 1, pageSize: 10 });
    return formatDishList(result.items, result.pagination);
  } catch (err) {
    logger.warn({ err, query }, '/buscar API error');
    return handleApiError(err);
  }
}
