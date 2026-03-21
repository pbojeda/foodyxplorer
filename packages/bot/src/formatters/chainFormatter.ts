// Formatter: ChainListItem[] → MarkdownV2 string.

import type { ChainListItem } from '@foodxplorer/shared';
import { escapeMarkdown, truncate } from './markdownUtils.js';

/**
 * Format a list of chains for Telegram MarkdownV2.
 * Returns a "no results" message for empty arrays.
 */
export function formatChainList(items: ChainListItem[]): string {
  if (items.length === 0) {
    return 'No hay cadenas disponibles\\.';
  }

  const cards = items.map((chain) => {
    const displayName = chain.nameEs ?? chain.name;
    return [
      `*${escapeMarkdown(displayName)}*`,
      `Slug: ${escapeMarkdown(chain.chainSlug)} \\| País: ${escapeMarkdown(chain.countryCode)}`,
      `Platos: ${chain.dishCount}`,
    ].join('\n');
  });

  return truncate(cards.join('\n\n'), 4096);
}
