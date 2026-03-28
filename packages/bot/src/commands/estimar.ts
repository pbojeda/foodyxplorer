// /estimar <dish> [en <chainSlug>] command handler.

import type { ApiClient } from '../apiClient.js';
import { handleApiError } from './errorMessages.js';
import { formatEstimate } from '../formatters/estimateFormatter.js';
import { extractPortionModifier } from '../lib/portionModifier.js';
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
 */
export async function handleEstimar(args: string, apiClient: ApiClient): Promise<string> {
  const trimmed = args.trim();

  if (!trimmed) {
    return 'Uso: /estimar \\<plato\\> \\[en \\<cadena\\>\\]\nEjemplo: /estimar big mac en mcdonalds\\-es';
  }

  const { query, chainSlug } = parseEstimarArgs(trimmed);
  const { cleanQuery, portionMultiplier } = extractPortionModifier(query);

  const estimateParams: Parameters<ApiClient['estimate']>[0] = { query: cleanQuery };
  if (chainSlug) estimateParams.chainSlug = chainSlug;
  if (portionMultiplier !== 1.0) estimateParams.portionMultiplier = portionMultiplier;

  try {
    const data = await apiClient.estimate(estimateParams);
    return formatEstimate(data);
  } catch (err) {
    logger.warn({ err, query: cleanQuery, chainSlug, portionMultiplier }, '/estimar API error');
    return handleApiError(err);
  }
}
