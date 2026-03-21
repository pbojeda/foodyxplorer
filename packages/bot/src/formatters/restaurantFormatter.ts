// Formatter: RestaurantListItem[] → MarkdownV2 string.

import type { RestaurantListItem, PaginationMeta } from '@foodxplorer/shared';
import { escapeMarkdown, truncate } from './markdownUtils.js';

/**
 * Format a list of restaurants for Telegram MarkdownV2.
 * Returns a "no results" message for empty arrays.
 * Adds a "Mostrando X de Y" footer when results are paginated.
 */
export function formatRestaurantList(items: RestaurantListItem[], pagination: PaginationMeta): string {
  if (items.length === 0) {
    return 'No se encontraron restaurantes\\.';
  }

  const cards = items.map((restaurant) => {
    const displayName = restaurant.nameEs ?? restaurant.name;
    return [
      `*${escapeMarkdown(displayName)}*`,
      `🏪 Cadena: ${escapeMarkdown(restaurant.chainSlug)} \\| País: ${escapeMarkdown(restaurant.countryCode)}`,
      `Platos: ${restaurant.dishCount}`,
      `ID: \`${restaurant.id}\``,
    ].join('\n');
  });

  let text = cards.join('\n\n');

  if (pagination.totalItems > pagination.pageSize) {
    text += `\n\n_Mostrando ${items.length} de ${pagination.totalItems}_`;
  }

  return truncate(text, 4096);
}
