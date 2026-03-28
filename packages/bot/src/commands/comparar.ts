// /comparar <dish_a> vs <dish_b> command handler.

import type { ApiClient } from '../apiClient.js';
import { parseCompararArgs } from '../lib/comparisonParser.js';
import { runComparison } from '../lib/comparisonRunner.js';

/**
 * Compare two dishes nutritionally.
 * Returns usage hint if args is empty/whitespace, error if no separator found.
 */
export async function handleComparar(args: string, apiClient: ApiClient): Promise<string> {
  const trimmed = args.trim();

  if (!trimmed) {
    return 'Uso: /comparar \\<plato\\_a\\> vs \\<plato\\_b\\> \\[en \\<cadena\\>\\]\nEjemplo: /comparar big mac vs whopper\nEjemplo: /comparar big mac en mcdonalds\\-es vs whopper en burger\\-king\\-es';
  }

  const parsed = parseCompararArgs(trimmed);
  if (!parsed) {
    return 'No encontré dos platos para comparar\\. Usa "vs", "o", "versus" o "contra" para separar los platos\\.\nEjemplo: /comparar big mac vs whopper';
  }

  return runComparison(parsed.dishA, parsed.dishB, undefined, apiClient);
}
