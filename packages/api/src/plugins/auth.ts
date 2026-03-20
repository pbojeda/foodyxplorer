// auth.ts — Global auth middleware (F026)
//
// Registers a global onRequest hook that handles BOTH public API key auth
// and admin auth, routing based on request URL.
//
// URL routing:
//   /health              → skip (no auth)
//   /ingest/*, /quality/*, /embeddings/*  → admin auth (validateAdminKey)
//   all other routes     → public API key auth (DB + Redis cache)
//
// Public key auth:
//   1. Read X-API-Key header (header-only, no query param fallback)
//   2. If no key → anonymous (no error, no apiKeyContext)
//   3. Hash key → check Redis cache (60s TTL, fail-open)
//   4. On cache miss → DB lookup via prisma.apiKey.findUnique
//   5. DB failure with key present → throw DB_UNAVAILABLE (fail-closed)
//   6. Key not found → throw UNAUTHORIZED
//   7. Key inactive → throw FORBIDDEN
//   8. Key expired → throw UNAUTHORIZED
//   9. Valid → set request.apiKeyContext, fire-and-forget last_used_at
//
// Admin auth:
//   - Delegates to validateAdminKey() from adminAuth.ts
//   - Fail-closed by env: if ADMIN_API_KEY absent in prod/dev → 401
//   - Fail-open in test: if ADMIN_API_KEY absent + NODE_ENV=test → skip
//
// All route plugins use fastifyPlugin (escaping scope), so scoped preHandler
// hooks do NOT apply. Admin auth MUST live in this global onRequest hook.

import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Config } from '../config.js';
import type { ApiKeyContext } from '@foodxplorer/shared';
import { buildKey, cacheGet, cacheSet } from '../lib/cache.js';
import { validateAdminKey } from './adminAuth.js';
import { isAdminRoute } from './adminPrefixes.js';

// ---------------------------------------------------------------------------
// Fastify type augmentation
// ---------------------------------------------------------------------------

declare module 'fastify' {
  interface FastifyRequest {
    apiKeyContext?: ApiKeyContext;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CachedApiKey {
  keyId: string;
  tier: 'free' | 'pro';
  isActive: boolean;
  expiresAt: string | null;
}

interface RegisterAuthOptions {
  prisma: PrismaClient;
  config: Config;
}

// ---------------------------------------------------------------------------
// registerAuthMiddleware
// ---------------------------------------------------------------------------

export async function registerAuthMiddleware(
  app: FastifyInstance,
  { prisma, config }: RegisterAuthOptions,
): Promise<void> {
  app.addHook('onRequest', async (request: FastifyRequest) => {
    const url = request.routeOptions.url;

    // /health — always exempt from auth
    if (url === '/health') return;

    // Admin routes — use ADMIN_API_KEY env var comparison
    if (isAdminRoute(url)) {
      if (!config.ADMIN_API_KEY) {
        // Fail-open in test env — skip admin auth when ADMIN_API_KEY absent
        if (config.NODE_ENV === 'test') return;
        // Fail-closed in prod/dev — unconfigured = 401
        throw Object.assign(
          new Error('Admin API key not configured'),
          { code: 'UNAUTHORIZED' },
        );
      }
      // validateAdminKey throws UNAUTHORIZED on mismatch
      validateAdminKey(request.headers['x-api-key'], config.ADMIN_API_KEY);
      return;
    }

    // Public routes — optional API key auth
    const rawKey = request.headers['x-api-key'];
    const keyString = Array.isArray(rawKey) ? rawKey[0] : rawKey;

    // No key → anonymous caller, skip auth
    if (!keyString) return;

    // Hash the raw key
    const keyHash = createHash('sha256').update(keyString).digest('hex');
    const cacheKey = buildKey('apikey', keyHash);

    // Try Redis cache first (fail-open: null means miss or error)
    const cached = await cacheGet<CachedApiKey>(cacheKey, request.log);

    if (!cached) {
      // Cache miss — query DB
      let dbRow: {
        id: string;
        tier: 'free' | 'pro';
        isActive: boolean;
        expiresAt: Date | null;
      } | null;

      try {
        dbRow = await prisma.apiKey.findUnique({ where: { keyHash } }) as typeof dbRow;
      } catch (err) {
        // DB failure with a key provided → fail-closed (500)
        throw Object.assign(
          new Error('Database unavailable'),
          { code: 'DB_UNAVAILABLE', cause: err },
        );
      }

      if (!dbRow) {
        throw Object.assign(
          new Error('Invalid or expired API key'),
          { code: 'UNAUTHORIZED' },
        );
      }

      if (!dbRow.isActive) {
        throw Object.assign(
          new Error('API key has been revoked'),
          { code: 'FORBIDDEN' },
        );
      }

      if (dbRow.expiresAt !== null && dbRow.expiresAt < new Date()) {
        throw Object.assign(
          new Error('Invalid or expired API key'),
          { code: 'UNAUTHORIZED' },
        );
      }

      // Cache the result (fire-and-forget, fail-open)
      const toCache: CachedApiKey = {
        keyId: dbRow.id,
        tier: dbRow.tier,
        isActive: dbRow.isActive,
        expiresAt: dbRow.expiresAt ? dbRow.expiresAt.toISOString() : null,
      };
      void cacheSet(cacheKey, toCache, request.log, { ttl: 60 });

      // Set context
      request.apiKeyContext = { keyId: dbRow.id, tier: dbRow.tier };
      touchLastUsed(dbRow.id);
      return;
    }

    // Cache hit — validate from cached data
    if (!cached.isActive) {
      throw Object.assign(
        new Error('API key has been revoked'),
        { code: 'FORBIDDEN' },
      );
    }

    if (cached.expiresAt !== null && new Date(cached.expiresAt) < new Date()) {
      throw Object.assign(
        new Error('Invalid or expired API key'),
        { code: 'UNAUTHORIZED' },
      );
    }

    // Valid cached key
    request.apiKeyContext = { keyId: cached.keyId, tier: cached.tier };
    touchLastUsed(cached.keyId);
  });

  // Fire-and-forget last_used_at update (bypass @updatedAt via raw SQL)
  function touchLastUsed(keyId: string) {
    void prisma.$executeRaw`UPDATE api_keys SET last_used_at = NOW() WHERE id = ${keyId}::uuid`
      .catch((e: unknown) => app.log.debug({ err: e }, 'last_used_at update failed'));
  }
}
