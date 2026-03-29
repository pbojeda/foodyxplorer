// /receta <ingredientes> command handler (F041).
//
// Accepts free-form ingredient text, calls POST /calculate/recipe, and
// formats the result as a MarkdownV2 message. Includes per-user bot-level
// rate limiting (5/hr per chatId) using Redis — same pattern as callbackQuery.ts.

import type { Redis } from 'ioredis';
import type { ApiClient } from '../apiClient.js';
import { ApiError } from '../apiClient.js';
import { handleApiError } from './errorMessages.js';
import { formatRecipeResult } from '../formatters/recipeFormatter.js';
import { logger } from '../logger.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_TTL_SECONDS = 3600;
const RATE_LIMIT_KEY_PREFIX = 'fxp:receta:hourly:';

const USAGE_HINT =
  'Uso: /receta \\<ingredientes\\>\nEjemplo: /receta 200g pollo, 100g arroz, 50g aceite de oliva';

const LENGTH_ERROR =
  'La receta es demasiado larga\\. El límite es de 2000 caracteres\\.';

const RATE_LIMIT_MESSAGE =
  'Has alcanzado el límite de recetas por hora\\. Inténtalo más tarde\\.';

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Check and increment the per-user hourly rate limit counter.
 * Returns true if the user has exceeded the limit.
 * Fails open on Redis error — returns false so the request proceeds.
 */
async function isRateLimited(redis: Redis, chatId: number): Promise<boolean> {
  const key = `${RATE_LIMIT_KEY_PREFIX}${chatId}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) {
      // First request in window — set TTL so the key auto-expires after 1 hour.
      await redis.expire(key, RATE_LIMIT_TTL_SECONDS);
    }
    return count > RATE_LIMIT_MAX;
  } catch (err) {
    logger.warn({ err, chatId }, '/receta rate-limit check failed (Redis error) — failing open');
    return false;
  }
}

/**
 * Returns true for errors that are NOT the user's fault (server 5xx, timeout, network).
 * 4xx errors (bad input, rate limit) are considered user-caused.
 */
function isServerOrNetworkError(err: ApiError): boolean {
  return err.statusCode >= 500 || err.code === 'TIMEOUT' || err.code === 'NETWORK_ERROR';
}

/**
 * Decrement the rate-limit counter to refund a slot.
 * Silently swallows Redis errors (fail-open).
 */
async function decrementRateLimit(redis: Redis, chatId: number): Promise<void> {
  const key = `${RATE_LIMIT_KEY_PREFIX}${chatId}`;
  try {
    // Only decrement if the key still exists — avoids creating a negative counter
    // if the TTL expired between the initial incr and the API failure.
    const exists = await redis.exists(key);
    if (exists) {
      await redis.decr(key);
    }
  } catch {
    logger.warn({ chatId }, '/receta rate-limit decrement failed (Redis error) — ignoring');
  }
}

/**
 * Map recipe-specific error codes before delegating to the generic handler.
 * RECIPE_UNRESOLVABLE and FREE_FORM_PARSE_FAILED are 422 errors specific to
 * this endpoint and warrant more informative user messages.
 */
function handleRecipeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'RECIPE_UNRESOLVABLE') {
      return 'No se pudo resolver ningún ingrediente\\. Intenta con nombres más concretos\\.';
    }
    if (err.code === 'FREE_FORM_PARSE_FAILED') {
      return 'No entendí la lista de ingredientes\\. Intenta con el formato: 200g pollo, 100g arroz\\.';
    }
  }
  return handleApiError(err);
}

// ---------------------------------------------------------------------------
// Exported handler
// ---------------------------------------------------------------------------

/**
 * Handle the /receta command.
 *
 * 1. Guards: empty/whitespace → usage hint; > 2000 chars → length error.
 * 2. Rate limit: check Redis; > 5/hr → rate limit message.
 * 3. Call calculateRecipe(trimmed) and format the result.
 * 4. On error: log + map to a user-friendly Spanish string.
 */
export async function handleReceta(
  args: string,
  chatId: number,
  apiClient: ApiClient,
  redis: Redis,
): Promise<string> {
  const trimmed = args.trim();

  if (!trimmed) {
    return USAGE_HINT;
  }

  if (trimmed.length > 2000) {
    return LENGTH_ERROR;
  }

  const limited = await isRateLimited(redis, chatId);
  if (limited) {
    return RATE_LIMIT_MESSAGE;
  }

  try {
    const data = await apiClient.calculateRecipe(trimmed);
    return formatRecipeResult(data);
  } catch (err) {
    // Refund the rate-limit slot for server/network errors (not user errors).
    // 4xx errors (422 RECIPE_UNRESOLVABLE, FREE_FORM_PARSE_FAILED, 429) are
    // user-caused or legitimate throttles — keep the counter.
    if (err instanceof ApiError && isServerOrNetworkError(err)) {
      await decrementRateLimit(redis, chatId);
    }
    logger.warn({ err, text: trimmed }, '/receta API error');
    return handleRecipeError(err);
  }
}
