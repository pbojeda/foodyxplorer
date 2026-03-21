// Telegram MarkdownV2 utility functions.
//
// All user-sourced or database-sourced strings must be passed through
// escapeMarkdown() before inclusion in a Telegram message.
// Do NOT escape pre-composed Markdown syntax chars (bold markers, etc.).

// MarkdownV2 reserved characters per Telegram Bot API docs.
// These must be escaped with a preceding backslash.
const RESERVED_CHARS_REGEX = /([_*[\]()~`>#+\-=|{}.!])/g;

/**
 * Escape all MarkdownV2 reserved characters in a string.
 * Safe to call on any user-supplied or database-sourced string.
 */
export function escapeMarkdown(text: string): string {
  return text.replace(RESERVED_CHARS_REGEX, '\\$1');
}

const TRUNCATED_SUFFIX = '\n\n_Lista recortada_';

/**
 * Truncate text to at most maxLen characters, breaking at the last newline
 * boundary before maxLen. Appends a "lista recortada" note when truncation occurs.
 */
export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;

  // Find the last newline before or at maxLen
  const cutAt = text.lastIndexOf('\n', maxLen - 1);
  const truncated = cutAt > 0 ? text.slice(0, cutAt) : text.slice(0, maxLen);
  return truncated + TRUNCATED_SUFFIX;
}

/**
 * Format a numeric nutrient value with its unit for MarkdownV2.
 * Decimal points are escaped (they are reserved in MarkdownV2).
 *
 * Examples:
 *   formatNutrient(563, 'kcal') → '563 kcal'
 *   formatNutrient(26.5, 'g')  → '26\.5 g'
 */
export function formatNutrient(value: number, unit: string): string {
  const formatted = String(value).replace('.', '\\.');
  return `${formatted} ${unit}`;
}
