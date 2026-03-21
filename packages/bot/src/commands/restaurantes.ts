// /restaurantes [chainSlug] command handler.

import type { ApiClient } from '../apiClient.js';
import { handleApiError } from './errorMessages.js';
import { formatRestaurantList } from '../formatters/restaurantFormatter.js';
import { escapeMarkdown } from '../formatters/markdownUtils.js';
import { logger } from '../logger.js';

/**
 * List restaurants, optionally filtered by chainSlug.
 * Empty results show a chain-specific or generic not-found message.
 */
export async function handleRestaurantes(args: string, apiClient: ApiClient): Promise<string> {
  const chainSlug = args.trim() || undefined;

  try {
    const result = await apiClient.listRestaurants({ chainSlug, page: 1, pageSize: 10 });

    if (result.items.length === 0) {
      if (chainSlug) {
        return `No se encontraron restaurantes para la cadena «${escapeMarkdown(chainSlug)}»\\. Usa /cadenas para ver cadenas disponibles\\.`;
      }
      return 'No hay restaurantes registrados todavia\\.';
    }

    return formatRestaurantList(result.items, result.pagination);
  } catch (err) {
    logger.warn({ err, chainSlug }, '/restaurantes API error');
    return handleApiError(err);
  }
}
