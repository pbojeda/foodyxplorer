// Formatter: ReverseSearchData → MarkdownV2 string (F086).

import type { ReverseSearchData } from '@foodxplorer/shared';
import { escapeMarkdown } from './markdownUtils.js';

/**
 * Format reverse search results for Telegram MarkdownV2.
 * Pass null when no chain context is available.
 */
export function formatReverseSearch(data: ReverseSearchData | null): string {
  if (data === null) {
    return (
      'Necesito saber en qué cadena estás\\.\n' +
      'Usa "*estoy en \\<cadena\\>*" primero\\.'
    );
  }

  const lines: string[] = [];

  // Header
  const chainEsc = escapeMarkdown(data.chainName);
  const calEsc = escapeMarkdown(String(data.maxCalories));

  let header = `🔍 *Platos en ${chainEsc} con ≤ ${calEsc} kcal*`;
  if (data.minProtein !== null) {
    header += ` *y ≥ ${escapeMarkdown(String(data.minProtein))}g proteína*`;
  }
  lines.push(header);
  lines.push('');

  // Empty results
  if (data.results.length === 0) {
    lines.push('No encontré platos que cumplan esos criterios\\.');
    return lines.join('\n');
  }

  // Numbered dish list
  for (const [i, dish] of data.results.entries()) {
    const displayName = dish.nameEs ?? dish.name;
    const num = escapeMarkdown(String(i + 1));

    lines.push(
      `${num}\\. *${escapeMarkdown(displayName)}*`,
    );
    lines.push(
      `   🔥 ${escapeMarkdown(String(dish.calories))} kcal \\| ` +
      `💪 ${escapeMarkdown(String(dish.proteins))} g prot \\| ` +
      `🧈 ${escapeMarkdown(String(dish.fats))} g grasa \\| ` +
      `🍞 ${escapeMarkdown(String(dish.carbohydrates))} g carbs`,
    );
  }

  // Footer
  if (data.totalMatches > data.results.length) {
    lines.push('');
    lines.push(
      `_${escapeMarkdown(String(data.totalMatches))} platos en total — mostrando los ${escapeMarkdown(String(data.results.length))} con más proteína por caloría_`,
    );
  } else {
    lines.push('');
    lines.push(
      `_${escapeMarkdown(String(data.totalMatches))} platos en total_`,
    );
  }

  return lines.join('\n');
}
