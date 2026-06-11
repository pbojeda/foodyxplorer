// requireAdminBearer.ts — Fastify preHandler: bearer presence + admin tier gate (F-ADMIN-ANALYTICS-UI)
//
// Attached to /analytics/* routes as a per-route preHandler (not a plugin-level addHook).
// verifies that the request has a bearer with admin tier in the accounts table.
//
// Behavior (ADR-031, AC1/AC2/AC3/AC5b/AC5c/AC5d):
//   1. request.accountId unset (no/invalid bearer) → throw 401 UNAUTHORIZED
//   2. Per-sub Redis INCR rate limit (30/min default) → throw 429 RATE_LIMIT_EXCEEDED
//      - Skipped when NODE_ENV=test (mirrors rateLimit.ts:107 pattern)
//   3. resolveAccountTierStrict → null (no accounts row) → throw 403 NOT_PROVISIONED
//      - Message includes provisioning hint for Postman/curl callers
//   4. tier === 'admin' → continue (sets request.adminVerified = true)
//   5. tier === 'free'/'pro' (row exists, not admin) → throw 403 FORBIDDEN
//   6. resolveAccountTierStrict throws (DB error) → throw 500 DB_UNAVAILABLE
//
// NOT a FastifyPluginAsync — exported as a factory function that returns a plain
// async preHandler. Options are closed over at factory-call time:
//
//   const gate = makeRequireAdminBearer({ redis, prisma, config });
//   app.get('/analytics/queries', { preHandler: [gate] }, handler);
//
// Rate limit key: admin:bearer:ratelimit:<sub>
// Pattern mirrors actorRateLimit.ts:151-155 (INCR + EXPIRE on first increment).

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import type { PrismaClient } from '@prisma/client';
import { resolveAccountTierStrict } from '../lib/accountTier.js';

// ---------------------------------------------------------------------------
// Fastify type augmentation
// ---------------------------------------------------------------------------

declare module 'fastify' {
  interface FastifyRequest {
    adminVerified?: boolean;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RequireAdminBearerOptions {
  redis: Redis;
  prisma: PrismaClient;
  /** Per-bearer rate limit max requests. Default: 30. */
  rateLimitMax?: number;
  /** Rate limit window in seconds. Default: 60. */
  rateLimitWindowSec?: number;
  /** Config object for NODE_ENV check. Rate limit skipped when NODE_ENV=test. */
  config?: { NODE_ENV?: string };
  /** Legacy test bypass opt-out for pre-existing tests that don't exercise auth scope. */
  allowTestBypass?: boolean;
}

// ---------------------------------------------------------------------------
// makeRequireAdminBearer — factory function
// ---------------------------------------------------------------------------

export function makeRequireAdminBearer(
  opts: RequireAdminBearerOptions,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const {
    redis,
    prisma,
    rateLimitMax = 30,
    rateLimitWindowSec = 60,
    config,
    allowTestBypass = false,
  } = opts;

  return async function requireAdminBearer(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    // Legacy test bypass — only for pre-existing tests that don't exercise auth scope.
    // NEW integration tests (AC1-AC5d) MUST NOT use this flag.
    if (allowTestBypass) return;

    // Branch 1: No accountId → no/invalid bearer → 401 UNAUTHORIZED
    if (!request.accountId) {
      throw Object.assign(
        new Error('Missing or invalid bearer token'),
        { code: 'UNAUTHORIZED' },
      );
    }

    const sub = request.accountId;

    // Branch 2: Per-bearer rate limit (skipped in test env to prevent counter leakage)
    // Rate limit key: admin:bearer:ratelimit:<sub>
    const isTestEnv = config?.NODE_ENV === 'test';
    if (!isTestEnv) {
      const rateLimitKey = `admin:bearer:ratelimit:${sub}`;
      const count = await redis.incr(rateLimitKey);
      // Set TTL only on first increment (fire-and-forget)
      if (count === 1) {
        await redis.expire(rateLimitKey, rateLimitWindowSec);
      }
      if (count > rateLimitMax) {
        throw Object.assign(
          new Error('Too many requests. Please try again later.'),
          { code: 'RATE_LIMIT_EXCEEDED', statusCode: 429 },
        );
      }
    }

    // Branch 3, 4, 5, 6: Resolve account tier
    let tier: string | null;
    try {
      tier = await resolveAccountTierStrict(redis, prisma, sub, request.log);
    } catch (dbErr) {
      // Branch 6: DB throws → 500 DB_UNAVAILABLE
      throw Object.assign(
        new Error('Database unavailable during admin tier check'),
        { code: 'DB_UNAVAILABLE', statusCode: 500, cause: dbErr },
      );
    }

    if (tier === null) {
      // Branch 3: No accounts row → 403 NOT_PROVISIONED
      throw Object.assign(
        new Error(
          'Account not provisioned. Call GET /me once to provision, then retry.',
        ),
        { code: 'NOT_PROVISIONED' },
      );
    }

    if (tier !== 'admin') {
      // Branch 5: Row exists but tier !== admin → 403 FORBIDDEN (no hint)
      throw Object.assign(
        new Error('Admin tier required'),
        { code: 'FORBIDDEN' },
      );
    }

    // Branch 4: Admin tier → continue
    request.adminVerified = true;
  };
}
