// actorRateLimit.ts — Per-actor daily rate limiting (F069 + F-TIER)
//
// Tier-aware daily limits per actor identity. Each tier × bucket combination
// has its own limit. Admin tier bypasses all daily limits.
//
// Buckets:
//   - queries:           /estimate, /conversation/message
//   - photos:            /analyze/menu
//   - voice:             /conversation/audio
//   - realtime_minutes:  (placeholder — F095 will add route)
//
// Redis key: actor:limit:<actorId>:<YYYY-MM-DD>:<bucket>
// TTL: 86400s (auto-expire at day boundary)
//
// Policy (ADR-016):
//   - Fail-closed for anonymous actors (deny if can't verify limit)
//   - Fail-open for API-key-authenticated requests (free, pro, admin)

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tier = 'anonymous' | 'free' | 'pro' | 'admin';
type Bucket = 'queries' | 'photos' | 'voice' | 'realtime_minutes';

// ---------------------------------------------------------------------------
// Constants (exported for testability — AC9)
// ---------------------------------------------------------------------------

/**
 * Daily limits per tier × bucket.
 * - Infinity = bypass (no Redis call, immediate return)
 * - 0 = blocked (always 429, no Redis call)
 */
export const DAILY_LIMITS_BY_TIER: Record<Tier, Record<Bucket, number>> = {
  anonymous:        { queries: 50,       photos: 10,       voice: 30,       realtime_minutes: 0 },
  free:             { queries: 100,      photos: 20,       voice: 30,       realtime_minutes: 0 },
  pro:              { queries: 500,      photos: 100,      voice: 120,      realtime_minutes: 10 },
  admin:            { queries: Infinity, photos: Infinity,  voice: Infinity, realtime_minutes: Infinity },
};

/** Routes → bucket mapping */
export const ROUTE_BUCKET_MAP: Record<string, Bucket> = {
  '/estimate':             'queries',
  '/conversation/message': 'queries',
  '/conversation/audio':   'voice',    // F-TIER: moved from 'queries' to 'voice'
  '/analyze/menu':         'photos',
  // '/conversation/voice/stream': 'realtime_minutes',  // Placeholder — F095
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Start of next UTC day as ISO string (for resetAt in 429 response) */
function computeResetAt(dateKey: string): string {
  const parts = dateKey.split('-').map(Number);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- dateKey is always YYYY-MM-DD (computed via toISOString().slice(0,10)), split produces 3 elements
  const y = parts[0]!;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- see parts[0] comment above
  const m = parts[1]! - 1; // Date.UTC months are 0-indexed
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- see parts[0] comment above
  const d = parts[2]!;
  return new Date(Date.UTC(y, m, d + 1)).toISOString();
}

// ---------------------------------------------------------------------------
// registerActorRateLimit
// ---------------------------------------------------------------------------

interface RegisterActorRateLimitOptions {
  redis: Redis;
}

export async function registerActorRateLimit(
  app: FastifyInstance,
  { redis }: RegisterActorRateLimitOptions,
): Promise<void> {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.routeOptions.url ?? '';
    const bucket = ROUTE_BUCKET_MAP[url];

    // Only check routes that have a rate limit bucket
    if (!bucket) return;

    const actorId = request.actorId;
    if (!actorId) return; // No actor = no limit check (shouldn't happen)

    // Resolve tier from API key context (or anonymous)
    const tier: Tier = (request.apiKeyContext?.tier as Tier) ?? 'anonymous';
    const hasApiKey = request.apiKeyContext !== undefined;

    const limit = DAILY_LIMITS_BY_TIER[tier]?.[bucket];
    if (limit === undefined) {
      throw new Error(`No daily limit configured for tier=${tier}, bucket=${bucket}`);
    }

    // Admin bypass — no Redis call at all (AC4)
    if (limit === Infinity) return;

    const dateKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    // Zero limit — always blocked, no Redis call needed (realtime_minutes for anon/free)
    if (limit === 0) {
      return reply
        .code(429)
        .header('Retry-After', '3600')
        .send({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: `Daily ${bucket} limit exceeded (${limit}/day for ${tier} tier).`,
            details: {
              bucket,
              tier,
              limit,
              resetAt: computeResetAt(dateKey),
            },
          },
        });
    }

    const redisKey = `actor:limit:${actorId}:${dateKey}:${bucket}`;

    try {
      const current = await redis.incr(redisKey);

      // Set TTL on first increment (24h auto-expiry)
      if (current === 1) {
        await redis.expire(redisKey, 86400);
      }

      if (current > limit) {
        return reply
          .code(429)
          .header('Retry-After', '3600')
          .send({
            success: false,
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: `Daily ${bucket} limit exceeded (${limit}/day for ${tier} tier).`,
              details: {
                bucket,
                tier,
                limit,
                resetAt: computeResetAt(dateKey),
              },
            },
          });
      }
    } catch {
      // Redis failure — ADR-016 policy (AC15)
      if (hasApiKey) {
        // Fail-open for authenticated requests (free, pro, admin)
        return;
      }
      // Fail-closed for anonymous
      return reply
        .code(429)
        .header('Retry-After', '60')
        .send({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Rate limiting unavailable. Please try again later.',
          },
        });
    }
  });
}
