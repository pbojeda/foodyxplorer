// Shared async helper for dish comparison.
// Both /comparar command and NL handler delegate to this function.

import type { ApiClient } from '../apiClient.js';
import type { EstimateData } from '@foodxplorer/shared';
import { ApiError } from '../apiClient.js';
import { parseDishExpression } from './comparisonParser.js';
import { formatComparison, type ErrorNotes } from '../formatters/comparisonFormatter.js';
import { handleApiError } from '../commands/errorMessages.js';
import { logger } from '../logger.js';

const MAX_TELEGRAM_MESSAGE_LENGTH = 4000;

const LENGTH_GUARD_FALLBACK =
  'El resultado de la comparación es demasiado largo\\. Intenta con platos más específicos\\.';

/**
 * Run a two-dish comparison.
 *
 * 1. Parse each dish expression (chainSlug, portionMultiplier).
 * 2. Fire two estimate calls via Promise.allSettled.
 * 3. Map settled results (fulfilled, ApiError, unknown).
 * 4. Format and return the comparison card.
 */
export async function runComparison(
  dishAText: string,
  dishBText: string,
  nutrientFocus: string | undefined,
  apiClient: ApiClient,
  fallbackChainSlug?: string,
): Promise<string> {
  const exprA = parseDishExpression(dishAText);
  const exprB = parseDishExpression(dishBText);

  // Build estimate params — omit portionMultiplier when 1.0 (match existing pattern).
  const paramsA: Parameters<ApiClient['estimate']>[0] = { query: exprA.query };
  if (exprA.chainSlug) paramsA.chainSlug = exprA.chainSlug;
  if (!exprA.chainSlug && fallbackChainSlug) paramsA.chainSlug = fallbackChainSlug;
  if (exprA.portionMultiplier !== 1.0) paramsA.portionMultiplier = exprA.portionMultiplier;

  const paramsB: Parameters<ApiClient['estimate']>[0] = { query: exprB.query };
  if (exprB.chainSlug) paramsB.chainSlug = exprB.chainSlug;
  if (!exprB.chainSlug && fallbackChainSlug) paramsB.chainSlug = fallbackChainSlug;
  if (exprB.portionMultiplier !== 1.0) paramsB.portionMultiplier = exprB.portionMultiplier;

  const [settledA, settledB] = await Promise.allSettled([
    apiClient.estimate(paramsA),
    apiClient.estimate(paramsB),
  ]);

  // Map settled results.
  const mapped = [settledA, settledB].map((settled, idx) => {
    if (settled.status === 'fulfilled') {
      return { data: settled.value, errorNote: undefined as ErrorNotes['errorNoteA'] };
    }

    const err = settled.reason;

    if (err instanceof ApiError) {
      const errorNote: ErrorNotes['errorNoteA'] = err.code === 'TIMEOUT' ? 'timeout' : 'error';
      const query = idx === 0 ? exprA.query : exprB.query;
      const minimalData: EstimateData = {
        query,
        chainSlug: null,
        portionMultiplier: 1.0,
        level1Hit: false,
        level2Hit: false,
        level3Hit: false,
        level4Hit: false,
        matchType: null,
        result: null,
        cachedAt: null,
      };
      return { data: minimalData, errorNote, apiError: err };
    }

    // Unknown error — rethrow.
    throw err;
  });

  // Promise.allSettled always returns exactly 2 elements — safe to destructure.
  const [mappedA, mappedB] = mapped as [typeof mapped[number], typeof mapped[number]];

  const dataA = mappedA.data;
  const dataB = mappedB.data;

  // If both sides are ApiError rejections, return handleApiError for the first error.
  if (mappedA.apiError && mappedB.apiError) {
    return handleApiError(mappedA.apiError);
  }

  logger.debug({ dishAText, dishBText, nutrientFocus }, 'comparison resolved');

  if (dataA.result === null || dataB.result === null) {
    const nullSide = dataA.result === null && dataB.result === null
      ? 'both'
      : dataA.result === null
        ? 'A'
        : 'B';
    logger.warn({ dishAText, dishBText, nullSide }, 'comparison partial result');
  }

  const errorNotes: ErrorNotes = {};
  if (mappedA.errorNote) errorNotes.errorNoteA = mappedA.errorNote;
  if (mappedB.errorNote) errorNotes.errorNoteB = mappedB.errorNote;

  const result = formatComparison(dataA, dataB, nutrientFocus, errorNotes);

  // Length guard.
  if (result.length > MAX_TELEGRAM_MESSAGE_LENGTH) {
    return LENGTH_GUARD_FALLBACK;
  }

  return result;
}
