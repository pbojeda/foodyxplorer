// Conversation context management (F070).
//
// Stores and retrieves per-actor chain context from Redis.
// Key: conv:ctx:{actorId}, TTL: 7200s (2 hours).
//
// Design decisions:
// - Uses raw redis.get / redis.set (NOT cacheGet/cacheSet from lib/cache.ts).
//   Reason: cacheGet/cacheSet use the "fxp:" key prefix and a 300s TTL —
//   conversation context needs a different namespace and 2h TTL.
// - Fail-open: Redis errors return null (get) or are silently swallowed (set).
//   Conversation context is ephemeral; a missing context is recoverable.

import type { Redis } from 'ioredis';
import type { ConversationContext } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONTEXT_TTL_SECONDS = 7200;

function contextKey(actorId: string): string {
  return `conv:ctx:${actorId}`;
}

// ---------------------------------------------------------------------------
// getContext
// ---------------------------------------------------------------------------

/**
 * Retrieve the active conversation context for an actor.
 * Returns ConversationContext on hit, null on miss or Redis error (fail-open).
 */
export async function getContext(
  actorId: string,
  redis: Redis,
): Promise<ConversationContext | null> {
  try {
    const raw = await redis.get(contextKey(actorId));
    if (!raw) return null;
    return JSON.parse(raw) as ConversationContext;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// setContext
// ---------------------------------------------------------------------------

/**
 * Persist the active conversation context for an actor.
 * Silently swallows Redis errors (fail-open) — callers never see a throw.
 */
export async function setContext(
  actorId: string,
  context: ConversationContext,
  redis: Redis,
): Promise<void> {
  try {
    await redis.set(contextKey(actorId), JSON.stringify(context), 'EX', CONTEXT_TTL_SECONDS);
  } catch {
    // Fail-open: Redis errors must not disrupt conversation flow
  }
}
