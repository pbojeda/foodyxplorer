// lib/accountTier.ts — Account tier resolution helper (F-WEB-TIER, F-ADMIN-ANALYTICS-UI)
//
// Resolves the tier for a bearer-authenticated request from the accounts table,
// with Redis caching (TTL 60s). Called from actorRateLimit (NOT actorResolver).
//
// Cache key: account:tier:<sub>  (sub = JWT sub = auth_user_id = Supabase UUID)
// NOT prefixed with 'fxp:' — separate namespace from API-key cache (auth.ts l.156).
//
// Two variants:
//
//   resolveAccountTierStrict (F-ADMIN-ANALYTICS-UI, ADR-031):
//     - Returns null when no accounts row exists (strict — no fail-open)
//     - Does NOT cache the no-row case (null returned uncached per /review-plan R1 IMPORTANT:
//       /me upserts the accounts row but has no cache invalidation hook — caching null would
//       block an admin for up to 60s after their first /me call)
//     - DB throws → rethrows (caller handles as DB_UNAVAILABLE 500)
//     - Used by requireAdminBearer preHandler only
//
//   resolveAccountTier (F-WEB-TIER, back-compat wrapper):
//     - Calls resolveAccountTierStrict; maps null → 'free'
//     - DB throws → returns 'free' (fail-open, never 'anonymous' for verified bearer)
//     - Used by actorRateLimit.ts and auth.ts (existing callers unaffected)
//
// Fail-open policy (E4) for resolveAccountTier:
//   - Cache hit → return cached tier immediately
//   - Cache miss + DB hit → cache + return
//   - DB returns no row (bearer not yet provisioned by /me) → return 'free'
//   - DB throws → return 'free' (NEVER 'anonymous' for a verified bearer)
//   - Redis GET throws → fall through to DB; Redis SET failure is swallowed

import type { Redis } from 'ioredis';
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';

export type AccountTier = 'free' | 'pro' | 'admin';
export type AccountTierOrNull = AccountTier | null;

/**
 * Strict variant — returns null when no accounts row exists for sub.
 * Does NOT fail-open: if DB throws, the error propagates to the caller.
 * Cache contract: stores tier string ('free'/'pro'/'admin') with 60s TTL.
 * NO negative caching for no-row case (per /review-plan round 1 IMPORTANT — Codex).
 */
export async function resolveAccountTierStrict(
  redis: Redis,
  prisma: PrismaClient,
  sub: string,
  logger: FastifyBaseLogger,
): Promise<AccountTierOrNull> {
  const cacheKey = `account:tier:${sub}`;

  // 1. Try cache
  let cacheValue: string | null = null;
  try {
    cacheValue = await redis.get(cacheKey);
  } catch (redisErr) {
    // Redis failure → fall through to DB
    logger.warn({ err: redisErr, cacheKey }, 'resolveAccountTierStrict: Redis GET failed, falling back to DB');
  }

  if (cacheValue !== null) {
    return cacheValue as AccountTier;
  }

  // 2. DB lookup — throws propagate to caller (no fail-open in strict mode)
  const rows = await prisma.$queryRaw<{ tier: string }[]>`
    SELECT tier FROM accounts WHERE auth_user_id = ${sub}::uuid
  `;

  if (rows.length === 0 || !rows[0]) {
    // No accounts row — return null WITHOUT caching (provisioning coherence)
    return null;
  }

  const tier = rows[0]['tier'] as AccountTier;

  // 3. Cache the tier string (fire-and-forget) — ONLY when row exists
  redis.set(cacheKey, tier, 'EX', 60).catch(() => {
    // Redis SET failure is non-fatal — next request will re-query DB
  });

  return tier;
}

/**
 * Back-compat wrapper — fail-open policy (F-WEB-TIER).
 * Maps null (no row) → 'free'. Catches DB errors → returns 'free'.
 * Existing callers (actorRateLimit.ts, auth.ts) are unaffected.
 */
export async function resolveAccountTier(
  redis: Redis,
  prisma: PrismaClient,
  sub: string,
  logger: FastifyBaseLogger,
): Promise<AccountTier> {
  try {
    const result = await resolveAccountTierStrict(redis, prisma, sub, logger);
    return result ?? 'free'; // null (no row) → 'free'
  } catch (dbErr) {
    // DB failure → fail-open 'free' (NEVER 'anonymous' for verified bearer)
    logger.warn({ err: dbErr, sub }, 'resolveAccountTier: DB query failed, defaulting to free tier');
    return 'free';
  }
}
