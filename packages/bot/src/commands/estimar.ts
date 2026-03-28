// /estimar <dish> [en <chainSlug>] command handler.

import type { Redis } from 'ioredis';
import type { ApiClient } from '../apiClient.js';
import { handleApiError } from './errorMessages.js';
import { formatEstimate } from '../formatters/estimateFormatter.js';
import { extractPortionModifier } from '../lib/portionModifier.js';
import { getState } from '../lib/conversationState.js';
import { escapeMarkdown } from '../formatters/markdownUtils.js';
import { logger } from '../logger.js';

// ChainSlug format: lowercase letters, digits, hyphens — MUST contain at least one hyphen.
// This prevents "pollo en salsa" from being misidentified as chain-scoped.
const CHAIN_SLUG_REGEX = /^[a-z0-9-]+-[a-z0-9-]+$/;

/**
 * Parse the args string to extract a query and optional chainSlug.
 *
 * Splits on the LAST occurrence of " en " only when the suffix matches the
 * chainSlug format (contains at least one hyphen). This avoids false splits
 * on food descriptions like "pollo en salsa".
 *
 * Examples:
 *   "big mac en mcdonalds-es"      → { query: "big mac", chainSlug: "mcdonalds-es" }
 *   "pollo en salsa en mcdonalds-es" → { query: "pollo en salsa", chainSlug: "mcdonalds-es" }
 *   "pollo en salsa"               → { query: "pollo en salsa", chainSlug: undefined }
 */
function parseEstimarArgs(args: string): { query: string; chainSlug?: string } {
  const separator = ' en ';
  const lastIdx = args.lastIndexOf(separator);

  if (lastIdx === -1) {
    return { query: args };
  }

  const candidateSlug = args.slice(lastIdx + separator.length).trim();

  if (CHAIN_SLUG_REGEX.test(candidateSlug)) {
    const query = args.slice(0, lastIdx).trim();
    return { query, chainSlug: candidateSlug };
  }

  return { query: args };
}

/**
 * Estimate nutritional info for a dish, optionally scoped to a chain.
 * Returns usage hint if args is empty/whitespace.
 *
 * When no explicit chainSlug is provided in args, reads the active chain
 * context from Redis (fail-open) and injects it as chainSlug.
 */
export async function handleEstimar(
  args: string,
  chatId: number,
  redis: Redis,
  apiClient: ApiClient,
): Promise<string> {
  const trimmed = args.trim();

  if (!trimmed) {
    return 'Uso: /estimar \\<plato\\> \\[en \\<cadena\\>\\]\nEjemplo: /estimar big mac en mcdonalds\\-es';
  }

  const { query, chainSlug: explicitChainSlug } = parseEstimarArgs(trimmed);
  const { cleanQuery, portionMultiplier } = extractPortionModifier(query);

  const estimateParams: Parameters<ApiClient['estimate']>[0] = { query: cleanQuery };

  let contextChainName: string | undefined;

  if (explicitChainSlug) {
    // Explicit slug in args — use it directly, no Redis read
    estimateParams.chainSlug = explicitChainSlug;
  } else {
    // No explicit slug — read state from Redis (fail-open)
    try {
      const state = await getState(redis, chatId);
      if (state?.chainContext?.chainSlug) {
        estimateParams.chainSlug = state.chainContext.chainSlug;
        contextChainName = state.chainContext.chainName;
      }
    } catch {
      // Fail-open: Redis error → proceed without chain context
    }
  }

  if (portionMultiplier !== 1.0) estimateParams.portionMultiplier = portionMultiplier;

  try {
    const data = await apiClient.estimate(estimateParams);
    let result = formatEstimate(data);

    // Append context indicator when chain was injected from implicit context
    if (contextChainName !== undefined) {
      result += `\n_Contexto activo: ${escapeMarkdown(contextChainName)}_`;
    }

    return result;
  } catch (err) {
    logger.warn({ err, query: cleanQuery, chainSlug: estimateParams.chainSlug, portionMultiplier }, '/estimar API error');
    return handleApiError(err);
  }
}
