// Internal types for Conversation Core (F070).
//
// These types are API-internal and not exported from the shared package.

import type { Kysely } from 'kysely';
import type { Redis } from 'ioredis';
import type { DB } from '../generated/kysely-types.js';
import type { Level4LookupFn } from '../estimation/engineRouter.js';

/** Structural logger interface — compatible with both pino's Logger and FastifyBaseLogger. */
export interface Logger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  debug(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

// ---------------------------------------------------------------------------
// Chain data
// ---------------------------------------------------------------------------

/**
 * Lightweight chain row loaded once at plugin init.
 * Used by ChainResolver for in-memory matching.
 */
export interface ChainRow {
  chainSlug: string;
  name: string;
  nameEs: string | null;
}

/**
 * Result of a successful chain resolution.
 */
export interface ResolvedChain {
  chainSlug: string;
  chainName: string;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/**
 * Conversation context stored in Redis (key: conv:ctx:{actorId}, TTL: 7200s).
 * Represents the active chain set by "estoy en <chain>" messages.
 */
export interface ConversationContext {
  chainSlug?: string;
  chainName?: string;
}

// ---------------------------------------------------------------------------
// Conversation request
// ---------------------------------------------------------------------------

/**
 * Input to ConversationCore.processMessage().
 */
export interface ConversationRequest {
  /** Raw user text (Zod trim already applied by route, max 2000 chars). */
  text: string;
  /** UUID from F069 actor resolution middleware. */
  actorId: string;
  db: Kysely<DB>;
  redis: Redis;
  openAiApiKey?: string;
  level4Lookup?: Level4LookupFn;
  /** Loaded at plugin init for brand detection. */
  chainSlugs: string[];
  logger: Logger;
  /** Loaded at plugin init for chain resolution. */
  chains: ChainRow[];
  /** Legacy chainSlug from bot:state (optional fallback). */
  legacyChainSlug?: string;
  /** Legacy chainName from bot:state (optional fallback). */
  legacyChainName?: string;
}
