// Natural language handler for the Telegram bot.
//
// extractFoodQuery: pure function — parses Spanish plain-text messages into
//   { query, chainSlug? } for the estimate API.
// handleNaturalLanguage: async handler — calls apiClient.estimate and returns
//   a MarkdownV2-formatted response string.

import type { ApiClient } from '../apiClient.js';
import { ApiError } from '../apiClient.js';
import { formatEstimate } from '../formatters/estimateFormatter.js';
import { handleApiError } from '../commands/errorMessages.js';
import { extractPortionModifier } from '../lib/portionModifier.js';
import { extractComparisonQuery } from '../lib/comparisonParser.js';
import { runComparison } from '../lib/comparisonRunner.js';
import { logger } from '../logger.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_NL_TEXT_LENGTH = 500;

// ChainSlug format: lowercase letters, digits, hyphens — MUST contain at
// least one hyphen. Identical to the regex used in commands/estimar.ts.
// Copied verbatim — do NOT import from estimar.ts (private implementation).
const CHAIN_SLUG_REGEX = /^[a-z0-9-]+-[a-z0-9-]+$/;

// Prefix patterns applied in order — longest/most-specific first.
// Single pass: first match wins. All patterns use the `i` flag.
const PREFIX_PATTERNS: readonly RegExp[] = [
  // "cuántas calorías tiene[n] ..."
  /^cu[aá]ntas?\s+calor[ií]as?\s+tiene[n]?\s+/i,
  // "cuántas calorías hay en ..."
  /^cu[aá]ntas?\s+calor[ií]as?\s+hay\s+en\s+/i,
  // "cuántas calorías ..."
  /^cu[aá]ntas?\s+calor[ií]as?\s+/i,
  // "qué lleva/contiene/tiene ..."
  /^qu[eé]\s+(?:lleva|contiene|tiene)\s+/i,
  // "dame/dime [las] información/info/calorías [del] ..."
  /^(?:dame|dime)\s+(?:la[s]?\s+)?(?:informaci[oó]n|info|calor[ií]as?)\s+(?:de[l]?\s+)/i,
  // "información [nutricional] [del] ..."
  /^(?:informaci[oó]n|info)\s+(?:de[l]?\s+)?(?:nutricional\s+)?(?:de[l]?\s+)?/i,
  // "calorías de[l] [una?] ..."
  /^calor[ií]as?\s+de[l]?\s+(?:un[ao]?\s+)?/i,
  // "[buscar] [las] calorías [de[l]] [un[ao]] ..." — also covers bare "calorías ..."
  /^(?:busca[r]?\s+)?(?:la[s]?\s+)?calor[ií]as?\s+(?:de[l]?\s+)?(?:un[ao]?\s+)?/i,
];

// Article/determiner stripping — applied once after prefix step.
const ARTICLE_PATTERN = /^(?:un[ao]?|el|la[s]?|los|del|al)\s+/i;

// ---------------------------------------------------------------------------
// extractFoodQuery
// ---------------------------------------------------------------------------

/**
 * Parse raw Spanish text into a query and optional chain slug.
 * Pure function — no side effects, no I/O.
 */
export function extractFoodQuery(text: string): { query: string; chainSlug?: string } {
  const originalTrimmed = text.trim();

  // Step 1 — Chain slug extraction (identical to parseEstimarArgs in estimar.ts)
  const separator = ' en ';
  const lastIdx = originalTrimmed.lastIndexOf(separator);

  let remainder = originalTrimmed;
  let chainSlug: string | undefined;

  if (lastIdx !== -1) {
    const candidateSlug = originalTrimmed.slice(lastIdx + separator.length).trim();
    if (CHAIN_SLUG_REGEX.test(candidateSlug)) {
      chainSlug = candidateSlug;
      remainder = originalTrimmed.slice(0, lastIdx).trim();
    }
  }

  // Step 2 — Prefix stripping (single pass, first match wins)
  for (const pattern of PREFIX_PATTERNS) {
    const stripped = remainder.replace(pattern, '');
    if (stripped !== remainder) {
      remainder = stripped;
      break;
    }
  }

  // Article/determiner stripping (once, after prefix step)
  remainder = remainder.replace(ARTICLE_PATTERN, '');

  // Step 3 — Fallback: if stripped result is empty, use original trimmed text
  const query = remainder.trim() || originalTrimmed;

  return chainSlug !== undefined ? { query, chainSlug } : { query };
}

// ---------------------------------------------------------------------------
// handleNaturalLanguage
// ---------------------------------------------------------------------------

// Pre-escaped MarkdownV2 string for the >500-char prompt.
// Must NOT be built with escapeMarkdown() — that would escape the _ delimiters
// breaking italic formatting.
const TOO_LONG_MESSAGE =
  'Por favor, sé más específico\\. Escribe el nombre del plato directamente, por ejemplo: _big mac_';

/**
 * Handle a plain-text natural language message.
 * Returns a MarkdownV2-formatted string for Telegram.
 *
 * Only catches ApiError — unknown errors are rethrown so wrapHandler in
 * bot.ts can log them and reply with the generic "error inesperado" message.
 */
export async function handleNaturalLanguage(
  text: string,
  apiClient: ApiClient,
): Promise<string> {
  const trimmed = text.trim();

  if (trimmed.length > MAX_NL_TEXT_LENGTH) {
    return TOO_LONG_MESSAGE;
  }

  // Step 0 — Comparison detection (runs before single-dish path)
  const comparison = extractComparisonQuery(trimmed);
  if (comparison !== null) {
    return runComparison(comparison.dishA, comparison.dishB, comparison.nutrientFocus, apiClient);
  }

  const { cleanQuery, portionMultiplier } = extractPortionModifier(trimmed);
  const extracted = extractFoodQuery(cleanQuery);

  const estimateParams: Parameters<ApiClient['estimate']>[0] = { ...extracted };
  if (portionMultiplier !== 1.0) {
    estimateParams.portionMultiplier = portionMultiplier;
  }

  try {
    const data = await apiClient.estimate(estimateParams);
    return formatEstimate(data);
  } catch (err) {
    if (err instanceof ApiError) {
      logger.warn({ err, ...extracted }, 'NL handler API error');
      return handleApiError(err);
    }
    throw err;
  }
}
