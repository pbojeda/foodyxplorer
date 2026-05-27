// lib/accountTier.ts — Account tier resolution helper (F-WEB-TIER)
//
// Resolves the tier for a bearer-authenticated request from the accounts table,
// with Redis caching (TTL 60s). Called from actorRateLimit (NOT actorResolver).
//
// Cache key: account:tier:<sub>  (sub = JWT sub = auth_user_id = Supabase UUID)
// NOT prefixed with 'fxp:' — separate namespace from API-key cache (auth.ts l.156).
//
// Fail-open policy (E4):
//   - Cache hit → return cached tier immediately
//   - Cache miss + DB hit → cache + return
//   - DB returns no row (bearer not yet provisioned by /me) → return 'free'
//   - DB throws → return 'free' (NEVER 'anonymous' for a verified bearer)
//   - Redis GET throws → fall through to DB; Redis SET failure is swallowed

import type { Redis } from 'ioredis';
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';

type AccountTier = 'free' | 'pro' | 'admin';

export async function resolveAccountTier(
  redis: Redis,
  prisma: PrismaClient,
  sub: string,
  logger: FastifyBaseLogger,
): Promise<AccountTier> {
  const cacheKey = `account:tier:${sub}`;

  // 1. Try cache
  let cacheValue: string | null = null;
  try {
    cacheValue = await redis.get(cacheKey);
  } catch (redisErr) {
    // Redis failure → fall through to DB
    logger.warn({ err: redisErr, cacheKey }, 'resolveAccountTier: Redis GET failed, falling back to DB');
  }

  if (cacheValue !== null) {
    return cacheValue as AccountTier;
  }

  // 2. DB lookup
  let tier: AccountTier = 'free'; // fail-open default
  try {
    const rows = await prisma.$queryRaw<{ tier: string }[]>`
      SELECT tier FROM accounts WHERE auth_user_id = ${sub}::uuid
    `;
    if (rows.length > 0 && rows[0]) {
      tier = rows[0]['tier'] as AccountTier;
    }
    // rows.length === 0 → no account row yet (bearer not provisioned by /me) → 'free'
  } catch (dbErr) {
    // DB failure → fail-open 'free' (NEVER 'anonymous' for verified bearer)
    logger.warn({ err: dbErr, sub }, 'resolveAccountTier: DB query failed, defaulting to free tier');
    return 'free';
  }

  // 3. Cache the result (fire-and-forget)
  redis.set(cacheKey, tier, 'EX', 60).catch(() => {
    // Redis SET failure is non-fatal — next request will re-query DB
  });

  return tier;
}
