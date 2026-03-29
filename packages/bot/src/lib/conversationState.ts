// Conversation state management via Redis.
//
// Stores per-chat bot context (selected restaurant, inline search results) so
// that callback_query handlers can recover the user's selection without
// re-querying the API.
//
// Key pattern:  bot:state:{chatId}
// TTL:          7200 seconds (2 hours)
// Fail-open:    all errors are swallowed — a Redis outage should NOT crash
//               the bot or produce error messages to the user.

import type { Redis } from 'ioredis';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Lightweight restaurant shape stored in conversation state.
 * Keeps only what the bot needs — avoids bloating Redis entries.
 */
export interface BotStateRestaurant {
  id: string;
  name: string;
  /** Chain slug for chain restaurants. Used by upload handlers to enable chain-specific preprocessing. */
  chainSlug?: string;
}

/**
 * Per-chat chain context set by the user via /contexto or natural language.
 * When present, /estimar and /comparar queries are scoped to this chain.
 */
export interface BotStateChainContext {
  chainSlug: string;
  chainName: string;
}

/**
 * Enriched search result entry stored per restaurant UUID.
 * Stores name + optional chainSlug so the `sel:{uuid}` callback can
 * propagate chainSlug into selectedRestaurant without an extra API call.
 *
 * Backward compat: old-format entries may be plain strings (name only).
 * Consumers must handle both shapes during the 2h TTL transition.
 */
export interface SearchResultEntry {
  name: string;
  chainSlug?: string;
}

/**
 * The full state persisted for a chat session.
 *
 * - `selectedRestaurant`: The restaurant currently in context for the chat.
 * - `searchResults`:      The last inline-keyboard search results, keyed by
 *                         UUID. Each entry is a SearchResultEntry (or a plain
 *                         string for backward compat with pre-F052 state).
 * - `pendingSearch`:      The last search term typed by the user, preserved
 *                         so the `create_rest` callback can create the
 *                         restaurant with the correct name.
 * - `pendingPhotoFileId`: The Telegram file_id of the most recently received
 *                         photo. Stored here because callback_data is limited
 *                         to 64 bytes (too short for a Telegram file_id).
 *                         Retrieved by the upload_ingest callback handler.
 * - `chainContext`:       Active chain context set via /contexto or NL detection.
 */
export interface BotState {
  selectedRestaurant?: BotStateRestaurant;
  searchResults?: Record<string, string | SearchResultEntry>;
  pendingSearch?: string;
  pendingPhotoFileId?: string;
  chainContext?: BotStateChainContext;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_TTL_SECONDS = 7200;

export function stateKey(chatId: number): string {
  return `bot:state:${chatId}`;
}

// ---------------------------------------------------------------------------
// getState
// ---------------------------------------------------------------------------

/**
 * Retrieve the current BotState for a chat.
 * Returns null on cache miss or Redis error (fail-open).
 */
export async function getState(redis: Redis, chatId: number): Promise<BotState | null> {
  try {
    const raw = await redis.get(stateKey(chatId));
    if (!raw) return null;
    return JSON.parse(raw) as BotState;
  } catch {
    // Fail-open: Redis error or JSON parse error → act as if no state
    return null;
  }
}

// ---------------------------------------------------------------------------
// setState
// ---------------------------------------------------------------------------

/**
 * Persist a BotState for a chat, refreshing the TTL.
 * Silently swallows Redis errors (fail-open).
 */
export async function setState(redis: Redis, chatId: number, state: BotState): Promise<void> {
  try {
    await redis.set(stateKey(chatId), JSON.stringify(state), 'EX', STATE_TTL_SECONDS);
  } catch {
    // Fail-open: Redis error → ignore
  }
}

// ---------------------------------------------------------------------------
// setStateStrict
// ---------------------------------------------------------------------------

/**
 * Persist a BotState for a chat, refreshing the TTL.
 * Returns true on success, false on Redis error (strict — errors are NOT swallowed).
 */
export async function setStateStrict(redis: Redis, chatId: number, state: BotState): Promise<boolean> {
  try {
    await redis.set(stateKey(chatId), JSON.stringify(state), 'EX', STATE_TTL_SECONDS);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// clearState
// ---------------------------------------------------------------------------

/**
 * Delete the BotState for a chat.
 * Silently swallows Redis errors (fail-open).
 */
export async function clearState(redis: Redis, chatId: number): Promise<void> {
  try {
    await redis.del(stateKey(chatId));
  } catch {
    // Fail-open: Redis error → ignore
  }
}
