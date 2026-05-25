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
import { captureMessage, hashActor } from '../lib/sentry.js';
import { provisionFallbackActor, UUID_RE } from '../lib/bearerActor.js';

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
      // Route-level bearer verification (bearer required — not optional here).
      // AC8 / spec api-spec.yaml:465: absent bearer → 401 UNAUTHORIZED
      // (semantically distinct from INVALID_TOKEN: "no credentials" vs "broken token").
      const authHeader = request.headers['authorization'];
      if (!authHeader) {
        throw Object.assign(new Error('Authorization Bearer token is required'), {
          code: 'UNAUTHORIZED',
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
      // Route-level bearer verification (bearer required).
      // AC8 / spec api-spec.yaml:465: absent bearer → 401 UNAUTHORIZED
      // (semantically distinct from INVALID_TOKEN: "no credentials" vs "broken token").
      const authHeader = request.headers['authorization'];
      if (!authHeader) {
        throw Object.assign(new Error('Authorization Bearer token is required for /me'), {
          code: 'UNAUTHORIZED',
        });
      }

      const jwksUrl = resolveJwksUrl(config);
      const payload = await verifyBearerJwt(authHeader, jwksUrl);

      // actorId is normally set by actorResolver (bearer path — BUG-PROD-013 fix).
      // The defensive block below handles the DB-degraded case: if the resolver's
      // DB call failed (transient error), actorId is left unset and /me falls back
      // to resolving it here via the X-Actor-Id header or provisionFallbackActor.
      // This makes /me resilient to transient DB failures in the resolver.

      let actorId = request.actorId;

      if (!actorId) {
        // Fallback: actorResolver left actorId unset (transient DB failure path).
        // Resolve actor from X-Actor-Id header or provision a deterministic fallback.
        const rawActorHeader = request.headers['x-actor-id'];
        const actorHeaderValue = Array.isArray(rawActorHeader) ? rawActorHeader[0] : rawActorHeader;

        if (actorHeaderValue) {
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
          // No usable actor header — upsert a deterministic anchor actor by auth_user_id.
          // Uses provisionFallbackActor helper (DRY — same logic reused in collision path).
          // Note: derived externalId includes 'me-' prefix to namespace it away from
          // anonymous_web client UUIDs (which are not prefixed).
          const newActor = await provisionFallbackActor(prisma, payload.sub);
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
      // Safe link UPDATE: only matches actor rows in two safe states:
      //   (a) account_id IS NULL — anonymous actor, promote to bearer's account
      //   (b) account_id = accountId — already linked to same account, idempotent
      //
      // Any actor already linked to a DIFFERENT account produces updateResult = 0.
      // This is the real collision — handled below.
      // -----------------------------------------------------------------------
      const updateResult = await prisma.$executeRaw`
        UPDATE actors
        SET account_id = ${accountId}::uuid
        WHERE id = ${actorId}::uuid
          AND (account_id IS NULL OR account_id = ${accountId}::uuid)
      `;

      if (updateResult === 0) {
        // Fetch to determine which sub-path we're in.
        // MVCC note (per code-review S1): under READ COMMITTED, a stale read here
        // can only show pre-UPDATE state; the original actor row is never mutated
        // by this code path regardless of concurrent activity (the SET clause is
        // gated by the safe predicate, so a hijack is impossible even under
        // adversarial interleavings).
        const currentActor = await prisma.actor.findUnique({
          where: { id: actorId },
          select: { accountId: true, externalId: true },
        });

        const isSameAccountRace =
          currentActor !== null && currentActor.accountId === accountId;
        const isTrueCollision =
          currentActor !== null &&
          currentActor.accountId !== null &&
          currentActor.accountId !== accountId;

        if (!isSameAccountRace) {
          // Three sub-paths converge here:
          //   1. currentActor === null              (actor row deleted — transient)
          //   2. currentActor.accountId === null    (UPDATE missed — MVCC artifact)
          //   3. isTrueCollision                    (actor owned by different account)
          // All three need a working linked fallback actor for the bearer.
          // Only sub-path 3 emits the security telemetry.

          if (isTrueCollision && currentActor) {
            request.log.warn(
              {
                event: 'actor_link_collision',
                collisionActorId: actorId,
                victimAccountId: currentActor.accountId,
                hijackerAccountId: accountId,
                externalId: currentActor.externalId,
                requestId: request.id,
              },
              'F107a-FU2: actor_link_collision — actor already owned by different account; falling back to me-<sub> actor',
            );

            captureMessage(
              'actor_link_collision: actor already owned by different account',
              'warning',
              {
                collisionActorIdHash: hashActor(actorId),
                victimAccountIdHash: hashActor(currentActor.accountId ?? undefined),
                hijackerAccountIdHash: hashActor(accountId),
                externalIdHash: hashActor(currentActor.externalId ?? undefined),
              },
              { feature: 'F107a-FU2', event_type: 'actor_link_collision' },
            );
          }

          // Common fallback path (all 3 sub-paths).
          const fallbackActor = await provisionFallbackActor(prisma, payload.sub);

          // Re-run the safe link UPDATE on the fallback actor.
          // The upsert does NOT set account_id; this UPDATE links it.
          await prisma.$executeRaw`
            UPDATE actors
            SET account_id = ${accountId}::uuid
            WHERE id = ${fallbackActor.id}::uuid
              AND (account_id IS NULL OR account_id = ${accountId}::uuid)
          `;

          // Defense-in-depth: confirm the fallback is linked.
          const linkCheck = await prisma.actor.findUnique({
            where: { id: fallbackActor.id },
            select: { accountId: true },
          });
          if (linkCheck?.accountId !== accountId) {
            throw Object.assign(
              new Error('Fallback actor could not be linked to bearer account'),
              { code: 'FALLBACK_LINK_FAILED' },
            );
          }

          // Re-target actorId so the existing final fetch + response
          // construction below operates on the fallback actor.
          // NO early return; NO hoisting of accountForResponse needed.
          actorId = fallbackActor.id;
        }
        // isSameAccountRace: actorId unchanged → existing final fetch is idempotent.
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

// provisionFallbackActor is imported from lib/bearerActor.ts (BUG-PROD-013 DRY refactor)

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
