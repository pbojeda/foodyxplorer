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
// Dynamic rate limits:
//   - Bearer account (req.accountId): 600 req/15min/account  (BUG-API-RATELIMIT-BEARER-001)
//   - API key — pro tier:             1000 req/15min/key
//   - API key — free tier:            100 req/15min/key
//   - Anonymous (no auth):            30 req/15min/IP
//
// Rate limit key:
//   - Bearer account: "account:<sub>"  (per Supabase account, stable across IPs/devices)
//   - API key:        "apiKey:<keyId>" (per API key)
//   - Anonymous:      "ip:<ip>"        (per IP)
//
// BUG-API-RATELIMIT-BEARER-001 (bearer-aware, 2026-05-28):
//   A logged-in WEB user sends a Supabase bearer but NO X-API-Key, so they used
//   to fall into the anonymous ip:<ip> bucket (30/15min) regardless of tier and
//   share it with everyone behind the same NAT/IP. F-WEB-HISTORY's read fan-out
//   (/me, /me/usage, /history, loadMore per /hablar load) tripped it after a few
//   actions. Fix: bearer-first precedence (ADR-027) — key by account:<sub> with a
//   flat per-account cap. This global limiter is an ABUSE/DoS backstop only; the
//   product DAILY tier quota stays enforced per-actor in actorRateLimit.ts. The
//   flat cap (NOT a per-request resolveAccountTier lookup) keeps these helpers
//   pure + sync so the hot path adds no DB/Redis call. Cross-model validated
//   (Codex + Gemini both → Option B / 600). Admin bearer is NOT exempt here (a
//   global abuse limiter should still bound it); admin API KEYS stay exempt via
//   allowList. Read-only routes (/me, /me/usage, /history) are intentionally NOT
//   exempted (a broken/abusive client could otherwise hammer them unbounded).
//
//   ⚠ ORDERING: this reads req.accountId, set by actorResolver. @fastify/rate-limit
//   attaches its check as a ROUTE-LEVEL onRequest hook (via an onRoute hook), and
//   Fastify runs ALL global onRequest hooks before any route-level one — so
//   actorResolver's GLOBAL onRequest hook (app.addHook in actorResolver.ts) always
//   precedes this limiter, regardless of registerActorResolver/registerRateLimit
//   order. Invariant to preserve: keep actorResolver a GLOBAL onRequest hook.
//   Reordering the two registerX calls is safe; demoting actorResolver to a
//   route-scoped hook would reintroduce this bug.
//
// getRateLimitMax and getRateLimitKeyGenerator are exported for pure unit
// testing (rate limiting is disabled in test env, so headers cannot be
// asserted via buildApp().inject()).

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import type { ApiKeyContext } from '@foodxplorer/shared';
import { redis } from '../lib/redis.js';
import { ADMIN_PREFIXES } from './adminPrefixes.js';

// ---------------------------------------------------------------------------
// Exported helpers — tested in f026.auth.test.ts + bug-ratelimit-bearer.unit.test.ts
// ---------------------------------------------------------------------------

type ReqWithContext = { accountId?: string; apiKeyContext?: ApiKeyContext; ip?: string };

/**
 * Flat per-account cap for bearer-authenticated requests (BUG-API-RATELIMIT-BEARER-001).
 * Abuse backstop only (15-min window); tier value is expressed by the DAILY
 * per-actor quotas in actorRateLimit.ts, not here. 600 ≈ ~298 user-actions/15min
 * at the current fan-out — far beyond realistic human use, incl. multi-tab.
 */
export const AUTHENTICATED_RATE_LIMIT_MAX = 600;

/**
 * Dynamic max for @fastify/rate-limit. Bearer-first precedence (ADR-027):
 * 600 (bearer account), 1000 (pro key), 100 (free key), 30 (anonymous).
 * Admin API keys are excluded via allowList — never reach this function.
 */
export function getRateLimitMax(req: ReqWithContext): number {
  if (req.accountId) return AUTHENTICATED_RATE_LIMIT_MAX;
  if (req.apiKeyContext?.tier === 'pro') return 1000;
  if (req.apiKeyContext) return 100;
  return 30;
}

/**
 * Dynamic key generator for @fastify/rate-limit. Bearer-first precedence (ADR-027):
 * "account:<sub>" for bearer callers (stable across IPs/devices),
 * "apiKey:<keyId>" for API-key callers, "ip:<ip>" for anonymous.
 */
export function getRateLimitKeyGenerator(req: ReqWithContext): string {
  if (req.accountId) return `account:${req.accountId}`;
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
    // Exempt /health, admin routes, and admin-tier API keys from rate limiting
    allowList: (req: FastifyRequest) => {
      if (req.apiKeyContext?.tier === 'admin') return true;
      const url = req.routeOptions.url ?? '';
      return (
        url === '/health' ||
        ADMIN_PREFIXES.some((prefix) => url.startsWith(prefix))
      );
    },
    errorResponseBuilder: (_req, context) => {
      // Return an Error so Fastify's setErrorHandler catches it and formats
      // the response using the project error envelope via mapError.
      return Object.assign(
        new Error('Too many requests, please try again later.'),
        { statusCode: context.statusCode, code: 'RATE_LIMIT_EXCEEDED' },
      );
    },
  });
}
