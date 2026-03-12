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
// /health is exempt via allowList (function-based) so the health check is
// never counted against rate limit counters.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import { redis } from '../lib/redis.js';

export async function registerRateLimit(
  app: FastifyInstance,
  config: Config,
): Promise<void> {
  if (config.NODE_ENV === 'test') {
    return;
  }

  const { default: rateLimit } = await import('@fastify/rate-limit');

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '15 minutes',
    redis,
    keyGenerator: (req: FastifyRequest) => req.ip,
    skipOnError: true,
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
    // Exempt /health from rate limiting so liveness probes are never blocked
    allowList: (req: FastifyRequest) => req.routeOptions.url === '/health',
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
