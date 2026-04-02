// actorRateLimit.ts — Per-actor daily rate limiting (F069, ADR-016)
//
// Supplements the existing per-IP/key request-rate limiting (rateLimit.ts)
// with daily usage limits per actor identity.
//
// Buckets:
//   - queries: 50/day (GET /estimate)
//   - photos:  10/day (POST /analyze/menu)
//
// Redis key: actor:limit:<actorId>:<YYYY-MM-DD>:<bucket>
// TTL: 86400s (auto-expire at day boundary)
//
// Policy (ADR-016):
//   - Fail-closed for anonymous actors (deny if can't verify limit)
//   - Fail-open for API-key-authenticated requests

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAILY_LIMITS: Record<string, number> = {
  queries: 50,
  photos: 10,
};

/** Routes → bucket mapping */
const ROUTE_BUCKET_MAP: Record<string, string> = {
  '/estimate': 'queries',
  '/analyze/menu': 'photos',
};

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

    const hasApiKey = request.apiKeyContext !== undefined;
    const limit = DAILY_LIMITS[bucket]!;
    const dateKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
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
              code: 'ACTOR_RATE_LIMIT_EXCEEDED',
              message: `Daily ${bucket} limit exceeded (${limit}/day). Try again tomorrow.`,
            },
          });
      }
    } catch {
      // Redis failure
      if (hasApiKey) {
        // Fail-open for authenticated requests
        return;
      }
      // Fail-closed for anonymous (ADR-016)
      return reply
        .code(429)
        .send({
          success: false,
          error: {
            code: 'ACTOR_RATE_LIMIT_EXCEEDED',
            message: 'Rate limiting unavailable. Please try again later.',
          },
        });
    }
  });
}
