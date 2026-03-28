// /comparar <dish_a> vs <dish_b> command handler.

import type { Redis } from 'ioredis';
import type { ApiClient } from '../apiClient.js';
import { parseCompararArgs } from '../lib/comparisonParser.js';
import { runComparison } from '../lib/comparisonRunner.js';
import { getState } from '../lib/conversationState.js';

/**
 * Compare two dishes nutritionally.
 * Returns usage hint if args is empty/whitespace, error if no separator found.
 *
 * Reads the active chain context from Redis (fail-open) and passes it as
 * fallbackChainSlug to runComparison when neither dish has an explicit slug.
 */
export async function handleComparar(
  args: string,
  chatId: number,
  redis: Redis,
  apiClient: ApiClient,
): Promise<string> {
  const trimmed = args.trim();

  if (!trimmed) {
    return 'Uso: /comparar \\<plato\\_a\\> vs \\<plato\\_b\\> \\[en \\<cadena\\>\\]\nEjemplo: /comparar big mac vs whopper\nEjemplo: /comparar big mac en mcdonalds\\-es vs whopper en burger\\-king\\-es';
  }

  const parsed = parseCompararArgs(trimmed);
  if (!parsed) {
    return 'No encontré dos platos para comparar\\. Usa "vs", "o", "versus" o "contra" para separar los platos\\.\nEjemplo: /comparar big mac vs whopper';
  }

  // Read chain context from Redis (fail-open) — provides fallback for dishes without explicit slug
  let fallbackChainSlug: string | undefined;
  try {
    const state = await getState(redis, chatId);
    fallbackChainSlug = state?.chainContext?.chainSlug;
  } catch {
    // Fail-open: Redis error → no fallback
  }

  return runComparison(parsed.dishA, parsed.dishB, undefined, apiClient, fallbackChainSlug);
}
