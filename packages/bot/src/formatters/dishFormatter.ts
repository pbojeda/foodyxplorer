// Formatter: DishListItem[] → MarkdownV2 string.

import type { DishListItem, PaginationMeta } from '@foodxplorer/shared';
import { escapeMarkdown, truncate } from './markdownUtils.js';

/**
 * Format a list of dishes for Telegram MarkdownV2.
 * Returns a "no results" message for empty arrays.
 * Adds a "Mostrando X de Y" footer when results are paginated.
 */
export function formatDishList(items: DishListItem[], pagination: PaginationMeta): string {
  if (items.length === 0) {
    return 'No se encontraron platos\\.';
  }

  const cards = items.map((dish) => {
    const displayName = dish.nameEs ?? dish.name;
    return [
      `*${escapeMarkdown(displayName)}*`,
      `🍽 ${escapeMarkdown(dish.restaurantName)} \\(${escapeMarkdown(dish.chainSlug)}\\)`,
      `ID: \`${dish.id}\``,
    ].join('\n');
  });

  let text = cards.join('\n\n');

  if (pagination.totalItems > pagination.pageSize) {
    text += `\n\n_Mostrando ${items.length} de ${pagination.totalItems}_`;
  }

  return truncate(text, 4096);
}
