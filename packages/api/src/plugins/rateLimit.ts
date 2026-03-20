// Rate limiting plugin registration.
//
// Registers @fastify/rate-limit with ioredis as the backing store.
// Skipped entirely when NODE_ENV === 'test' to prevent test flakiness from
// per-IP counters leaking across test cases.
//
// Fail-open: skipOnError: true means if Redis errors, the request is allowed
// through rather than blocked.
//
// errorResponseBuilder returns an Error with statusCode: 429 and
// code: 'RATE_LIMIT_EXCEEDED'. The global error handler (errorHandler.ts)
// maps this to the project error envelope:
//   { success: false, error: { message, code: "RATE_LIMIT_EXCEEDED" } }
//
// /health and admin routes are exempt via allowList so they are never counted.
//
// Dynamic rate limits (F026):
//   - Anonymous (no apiKeyContext): 30 req/15min/IP
//   - Free tier: 100 req/15min/key
//   - Pro tier:  1000 req/15min/key
//
// Rate limit key:
//   - Authenticated: "apiKey:<keyId>"  (per API key)
//   - Anonymous:     "ip:<ip>"         (per IP)
//
// getRateLimitMax and getRateLimitKeyGenerator are exported for pure unit
// testing (rate limiting is disabled in test env, so headers cannot be
// asserted via buildApp().inject()).

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import type { ApiKeyContext } from '@foodxplorer/shared';
import { redis } from '../lib/redis.js';

// ---------------------------------------------------------------------------
// Exported helpers — tested in f026.auth.test.ts
// ---------------------------------------------------------------------------

type ReqWithContext = { apiKeyContext?: ApiKeyContext; ip?: string };

/**
 * Dynamic max for @fastify/rate-limit.
 * Returns 30 (anonymous), 100 (free), or 1000 (pro).
 */
export function getRateLimitMax(req: ReqWithContext): number {
  if (req.apiKeyContext?.tier === 'pro') return 1000;
  if (req.apiKeyContext) return 100;
  return 30;
}

/**
 * Dynamic key generator for @fastify/rate-limit.
 * Returns "apiKey:<keyId>" for authenticated callers, "ip:<ip>" for anonymous.
 */
export function getRateLimitKeyGenerator(req: ReqWithContext): string {
  if (req.apiKeyContext) return `apiKey:${req.apiKeyContext.keyId}`;
  return `ip:${req.ip ?? 'unknown'}`;
}

// ---------------------------------------------------------------------------
// registerRateLimit
// ---------------------------------------------------------------------------

export async function registerRateLimit(
  app: FastifyInstance,
  config: Config,
): Promise<void> {
  if (config.NODE_ENV === 'test') {
    return;
  }

  const { default: rateLimit } = await import('@fastify/rate-limit');

  await app.register(rateLimit, {
    max: (req: FastifyRequest) => getRateLimitMax(req),
    timeWindow: '15 minutes',
    redis,
    keyGenerator: (req: FastifyRequest) => getRateLimitKeyGenerator(req),
    skipOnError: true,
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
    // Exempt /health and all admin routes from rate limiting
    allowList: (req: FastifyRequest) => {
      const url = req.routeOptions.url ?? '';
      return (
        url === '/health' ||
        url.startsWith('/ingest/') ||
        url.startsWith('/quality/') ||
        url.startsWith('/embeddings/')
      );
    },
    errorResponseBuilder: (_req, context) => {
      // Return an Error so Fastify's setErrorHandler catches it and formats
      // the response using the project error envelope via mapError.
      const err = new Error('Too many requests, please try again later.');
      (err as Error & { statusCode: number; code: string }).statusCode =
        context.statusCode;
      (err as Error & { statusCode: number; code: string }).code =
        'RATE_LIMIT_EXCEEDED';
      return err;
    },
  });
}
