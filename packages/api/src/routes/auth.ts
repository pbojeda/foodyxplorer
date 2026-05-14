// routes/auth.ts — Auth routes for F107a (Supabase Auth, web)
//
// Endpoints:
//   POST /auth/login  — Initiate Supabase magic link (email only; google → 400)
//   POST /auth/logout — Invalidate Supabase session (bearer required)
//   GET  /me          — Return MeResponse for authenticated request
//
// ADR-025 R3 §5: strict bearer precedence.
//   /auth/logout and /me are auth-gated (bearer required — 401 if absent/invalid).
//   /auth/login is public (no bearer required; rate-limited 5/min/IP).
//
// F2 self-review: /me has per-bearer rate limit (30/min/accountId) to prevent
// authenticated abuse of the accounts upsert path.

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import type { PrismaClient } from '@prisma/client';
import type { Config } from '../config.js';
import { verifyBearerJwt } from '../plugins/authBearer.js';
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { LoginRequestSchema } from '@foodxplorer/shared';

// Raw DB account row shape (before serialization to Zod Account)
interface RawAccountRow {
  id: string;
  authUserId: string;
  email: string;
  createdAt: Date | string;
  lastSeenAt: Date | string;
  consentMarketing: boolean;
  consentMarketingAt: Date | string | null;
  consentAnalytics: boolean;
  consentAnalyticsAt: Date | string | null;
}

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

interface AuthRoutesOptions {
  prisma: PrismaClient;
  config: Config;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, { prisma, config }) => {
  // ---------------------------------------------------------------------------
  // POST /auth/login
  // ---------------------------------------------------------------------------
  app.post(
    '/auth/login',
    {
      config: {
        // Rate limit override: 5 req/min/IP on this route only.
        // @fastify/rate-limit v10 reads config.rateLimit from route options.
        // Skipped in NODE_ENV=test (global rate-limit plugin not registered in test).
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Zod parse — returns 400 VALIDATION_ERROR on failure via errorHandler
      const parsed = LoginRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        const err = Object.assign(parsed.error, { code: 'VALIDATION_ERROR' });
        throw err;
      }

      const loginRequest = parsed.data;

      // provider: 'google' is not yet enabled (F107a-FU1)
      if (loginRequest.provider === 'google') {
        throw Object.assign(
          new Error('OAuth provider google is not enabled. Enable it in F107a-FU1.'),
          { code: 'PROVIDER_NOT_ENABLED' },
        );
      }

      // provider: 'email' — send magic link via Supabase
      const supabase = getSupabaseAdmin(config);
      const { error } = await supabase.auth.signInWithOtp({
        email: loginRequest.email,
        options: { emailRedirectTo: loginRequest.redirectTo },
      });

      if (error) {
        throw Object.assign(
          new Error(`Supabase signInWithOtp failed: ${error.message}`),
          { code: 'AUTH_PROVIDER_UNAVAILABLE' },
        );
      }

      return reply.status(200).send({
        success: true,
        data: {
          provider: 'email' as const,
          success: true as const,
        },
      });
    },
  );

  // ---------------------------------------------------------------------------
  // POST /auth/logout
  // ---------------------------------------------------------------------------
  app.post(
    '/auth/logout',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Route-level bearer verification (bearer required — not optional here)
      const authHeader = request.headers['authorization'];
      if (!authHeader) {
        throw Object.assign(new Error('Authorization Bearer token is required'), {
          code: 'INVALID_TOKEN',
        });
      }

      const jwksUrl = resolveJwksUrl(config);
      await verifyBearerJwt(authHeader, jwksUrl);

      // Extract raw token (after "Bearer ")
      const jwt = authHeader.slice('Bearer '.length);

      // Invalidate session via Supabase admin SDK (global sign-out = all devices)
      const supabase = getSupabaseAdmin(config);
      const { error } = await supabase.auth.admin.signOut(jwt, 'global');

      if (error) {
        // Non-fatal: session may already be expired on Supabase side.
        // Log warning but still return 204 (client MUST clear local session anyway).
        request.log.warn({ err: error }, 'F107a: supabase signOut returned error (non-fatal)');
      }

      return reply.status(204).send();
    },
  );

  // ---------------------------------------------------------------------------
  // GET /me
  // ---------------------------------------------------------------------------
  app.get(
    '/me',
    {
      config: {
        // Per-bearer rate limit: 30 req/min to prevent authenticated abuse of
        // the accounts upsert path (F2 self-review, AC27).
        // keyGenerator uses accountId (from JWT sub) when available, falls back to IP.
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) =>
            (req as FastifyRequest & { accountId?: string }).accountId ?? req.ip,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Route-level bearer verification (bearer required)
      const authHeader = request.headers['authorization'];
      if (!authHeader) {
        throw Object.assign(new Error('Authorization Bearer token is required for /me'), {
          code: 'INVALID_TOKEN',
        });
      }

      const jwksUrl = resolveJwksUrl(config);
      const payload = await verifyBearerJwt(authHeader, jwksUrl);

      // actorId is set by actorResolver for anonymous flow requests.
      // When bearer is present, actorResolver returns early (no actorId set).
      // /me requires actorId — it must come from X-Actor-Id header.
      // The actorResolver sets request.actorId when bearer is absent;
      // for bearer requests it skips actor creation. /me clients MUST send X-Actor-Id.
      // If actorId is still not set, fall back to generating one is NOT done here —
      // /me is the identity anchor, it requires a resolved actor.
      // However: actorResolver also skips actor resolution when bearer is present.
      // The web client sends BOTH X-Actor-Id and Authorization headers.
      // actorResolver sets accountId (from bearer) and returns early.
      // actorId is NOT set in bearer path. /me must handle this gracefully.
      //
      // Resolution: /me falls back to the X-Actor-Id header value itself if
      // actorId is not set by actorResolver (bearer path). This is consistent
      // with the web client sending both headers.

      let actorId = request.actorId;

      if (!actorId) {
        // Bearer path: actorResolver skipped actor creation.
        // Use X-Actor-Id header to resolve or create actor.
        const rawActorHeader = request.headers['x-actor-id'];
        const actorHeaderValue = Array.isArray(rawActorHeader) ? rawActorHeader[0] : rawActorHeader;

        if (actorHeaderValue) {
          const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          if (UUID_RE.test(actorHeaderValue)) {
            const actor = await prisma.actor.upsert({
              where: { type_externalId: { type: 'anonymous_web', externalId: actorHeaderValue } },
              create: { type: 'anonymous_web', externalId: actorHeaderValue, lastSeenAt: new Date() },
              update: { lastSeenAt: new Date() },
              select: { id: true },
            });
            actorId = actor.id;
          }
        }

        if (!actorId) {
          // No usable actor header — create a transient actor
          const newActor = await prisma.actor.create({
            data: { type: 'anonymous_web', externalId: `me-${payload.sub.slice(0, 8)}`, lastSeenAt: new Date() },
            select: { id: true },
          });
          actorId = newActor.id;
        }
      }

      // -----------------------------------------------------------------------
      // Upsert accounts row (idempotent under concurrency — AC14, S2)
      //
      // ON CONFLICT (auth_user_id) DO UPDATE SET last_seen_at = NOW()
      // PostgreSQL guarantees atomicity: concurrent requests for the same
      // auth_user_id → one INSERT wins; the other triggers DO UPDATE.
      // Both callers observe the same accounts.id (UNIQUE on auth_user_id).
      // -----------------------------------------------------------------------
      const accountRows = await prisma.$queryRaw<RawAccountRow[]>`
        INSERT INTO accounts (auth_user_id, email, last_seen_at)
        VALUES (${payload.sub}::uuid, ${payload.email ?? ''}::varchar, NOW())
        ON CONFLICT (auth_user_id) DO UPDATE SET last_seen_at = NOW()
        RETURNING
          id::text,
          auth_user_id::text AS "authUserId",
          email,
          created_at AS "createdAt",
          last_seen_at AS "lastSeenAt",
          consent_marketing AS "consentMarketing",
          consent_marketing_at AS "consentMarketingAt",
          consent_analytics AS "consentAnalytics",
          consent_analytics_at AS "consentAnalyticsAt"
      `;
      const rawAccount = accountRows[0];
      if (!rawAccount) {
        throw Object.assign(new Error('Failed to upsert account row'), {
          code: 'DB_UNAVAILABLE',
        });
      }

      const accountId = rawAccount.id;

      // -----------------------------------------------------------------------
      // Link actor to account (skip no-op via IS DISTINCT FROM)
      // -----------------------------------------------------------------------
      const updateResult = await prisma.$executeRaw`
        UPDATE actors
        SET account_id = ${accountId}::uuid
        WHERE id = ${actorId}::uuid
          AND account_id IS DISTINCT FROM ${accountId}::uuid
      `;

      // Identity collision check: actor was already linked to a different account
      if (updateResult === 0) {
        const currentActor = await prisma.actor.findUnique({
          where: { id: actorId },
          select: { accountId: true },
        });
        if (currentActor?.accountId && currentActor.accountId !== accountId) {
          request.log.warn(
            {
              actorId,
              existingAccountId: currentActor.accountId,
              bearerAccountId: accountId,
            },
            'F107a: identity collision — actor.account_id differs from bearer account; bearer wins',
          );
        }
      }

      // -----------------------------------------------------------------------
      // Fetch final actor state
      // -----------------------------------------------------------------------
      const actor = await prisma.actor.findUniqueOrThrow({
        where: { id: actorId },
        select: {
          id: true,
          type: true,
          externalId: true,
          accountId: true,
        },
      });

      // Serialize account dates (Prisma $queryRaw returns Date objects for timestamptz;
      // Zod AccountSchema expects ISO string. Convert here before sending response.)
      const toIso = (v: Date | string | null): string | null => {
        if (v === null || v === undefined) return null;
        if (v instanceof Date) return v.toISOString();
        return String(v);
      };

      const accountForResponse = {
        id: rawAccount.id,
        authUserId: rawAccount.authUserId,
        email: rawAccount.email,
        createdAt: toIso(rawAccount.createdAt) ?? '',
        lastSeenAt: toIso(rawAccount.lastSeenAt) ?? '',
        consentMarketing: rawAccount.consentMarketing,
        consentMarketingAt: toIso(rawAccount.consentMarketingAt),
        consentAnalytics: rawAccount.consentAnalytics,
        consentAnalyticsAt: toIso(rawAccount.consentAnalyticsAt),
      };

      return reply.status(200).send({
        success: true,
        data: {
          account: accountForResponse,
          actor: {
            id: actor.id,
            type: actor.type,
            externalId: actor.externalId,
            accountId: actor.accountId,
          },
        },
      });
    },
  );
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveJwksUrl(config: Config): string {
  if (config.SUPABASE_JWKS_URL) return config.SUPABASE_JWKS_URL;
  if (config.SUPABASE_URL) return `${config.SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
  throw Object.assign(new Error('SUPABASE_URL is not configured'), {
    code: 'AUTH_PROVIDER_UNAVAILABLE',
  });
}

export default fastifyPlugin(authRoutes, {
  name: 'authRoutes',
  dependencies: [],
});
