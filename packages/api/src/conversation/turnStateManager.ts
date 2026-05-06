// Turn state management for multi-turn follow-up resolution (F-MULTITURN-001).
//
// Stores and retrieves per-actor turn state from Redis.
// Key: conv:turn:{actorId}, TTL: 1800s (30 min).
//
// Design decisions:
// - Follows the exact pattern of contextManager.ts (raw redis.get / redis.set, no cacheGet/cacheSet).
//   Reason: turn state needs a separate namespace ('conv:turn:') and a shorter TTL (30 min vs 2 h).
//   A shorter TTL is intentional — follow-up relevance decays faster than chain context.
// - Fail-open: Redis errors return null (get) or are silently swallowed (set).
//   Turn state is ephemeral; a missing turn state triggers a graceful fallback to standalone.
// - TURN_STATE_TTL_SECONDS is exported as a named constant (no magic numbers, spec R7 requirement).

import type { Redis } from 'ioredis';
import type { ConversationTurnState } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TURN_STATE_TTL_SECONDS = 1800;

function turnKey(actorId: string): string {
  return `conv:turn:${actorId}`;
}

// ---------------------------------------------------------------------------
// getTurnState
// ---------------------------------------------------------------------------

/**
 * Retrieve the turn state for an actor.
 * Returns ConversationTurnState on hit, null on miss or Redis error (fail-open).
 */
export async function getTurnState(
  actorId: string,
  redis: Redis,
): Promise<ConversationTurnState | null> {
  try {
    const raw = await redis.get(turnKey(actorId));
    if (!raw) return null;
    return JSON.parse(raw) as ConversationTurnState;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// setTurnState
// ---------------------------------------------------------------------------

/**
 * Persist the turn state for an actor.
 * Silently swallows Redis errors (fail-open) — callers never see a throw.
 * Callers MUST use void setTurnState(...).catch(() => {}) — never await directly
 * in the response path (non-blocking by design, Plan-R1 fix).
 */
export async function setTurnState(
  actorId: string,
  state: ConversationTurnState,
  redis: Redis,
): Promise<void> {
  try {
    await redis.set(turnKey(actorId), JSON.stringify(state), 'EX', TURN_STATE_TTL_SECONDS);
  } catch {
    // Fail-open: Redis errors must not disrupt conversation flow
  }
}
