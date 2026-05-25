// actorResolver.ts — Global actor resolution middleware (F069, ADR-016)
//
// Registers a global onRequest hook that resolves or creates an actor
// for every request. Actors are the anonymous identity layer — web clients
// send X-Actor-Id header (UUID).
//
// Resolution flow:
//   1. Skip /health endpoint
//   2. Read X-Actor-Id header
//   3. Valid UUID → upsert anonymous_web actor
//   4. Missing/invalid → generate UUID, create actor, set X-Actor-Id response header
//   5. Set request.actorId = actor.id
//   6. Fire-and-forget last_seen_at update
//
// Telegram resolution (`telegram:<chatId>` header prefix) was REMOVED 2026-05-13
// per ADR-026 (Pause Telegram Bot). The `ActorType.telegram` enum value remains
// in the schema for backwards compatibility but no new rows are created.
// This removal also closes qa-api-audit-2026-04-06 A1 (telegram actor spoofing).

import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Config } from '../config.js';
import { verifyBearerJwt } from './authBearer.js';
import { resolveBearerActorId, UUID_RE } from '../lib/bearerActor.js';

// ---------------------------------------------------------------------------
// Fastify type augmentation
// ---------------------------------------------------------------------------

declare module 'fastify' {
  interface FastifyRequest {
    actorId?: string;
    // accountId is set when a valid Bearer JWT is present (F107a, ADR-025 R3 §5)
    // Declared here (alongside actorId) per module augmentation pattern.
    // authPayload is declared in authBearer.ts.
  }
}

// ---------------------------------------------------------------------------
// registerActorResolver
// ---------------------------------------------------------------------------

interface RegisterActorResolverOptions {
  prisma: PrismaClient;
  config: Config;
}

export async function registerActorResolver(
  app: FastifyInstance,
  { prisma, config }: RegisterActorResolverOptions,
): Promise<void> {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.routeOptions.url;

    // Infrastructure routes — exempt from actor resolution
    // Also exempt sendBeacon POST (cannot set headers, must not auto-create ghost actors)
    if (
      url === '/health' ||
      url === '/docs' ||
      url === '/docs/json' ||
      (url === '/analytics/web-events' && request.method === 'POST')
    ) return;

    // ---------------------------------------------------------------------------
    // F107a Bearer pre-check (ADR-025 R3 §5 — strict bearer precedence)
    //
    // If Authorization header is present:
    //   - Valid bearer → set request.accountId; skip anonymous flow
    //   - Invalid bearer → throw immediately (NEVER silent downgrade)
    // If Authorization header is absent → fall through to anonymous flow
    // ---------------------------------------------------------------------------
    const authHeader = request.headers['authorization'];
    if (authHeader !== undefined) {
      // Derive JWKS URL: use explicit override if set, else derive from SUPABASE_URL
      const jwksUrl =
        config.SUPABASE_JWKS_URL ??
        (config.SUPABASE_URL
          ? `${config.SUPABASE_URL}/auth/v1/.well-known/jwks.json`
          : undefined);

      if (!jwksUrl) {
        throw Object.assign(new Error('Auth provider is not configured'), {
          code: 'AUTH_PROVIDER_UNAVAILABLE',
        });
      }

      // verifyBearerJwt throws on any invalid bearer (TOKEN_EXPIRED, INVALID_TOKEN,
      // AUTH_PROVIDER_UNAVAILABLE). Errors propagate to errorHandler — no catch here.
      const payload = await verifyBearerJwt(authHeader, jwksUrl);
      request.accountId = payload.sub;
      request.authPayload = payload;

      // BUG-PROD-013 fix: resolve actorId for bearer-authenticated requests.
      // Without this, /conversation/* guards (actorId check) return 500.
      // resolveBearerActorId reads X-Actor-Id header (web client sends both);
      // falls back to me-<sub.slice(0,8)> actor for non-web bearer clients.
      // Does NOT perform account linking (that remains /me only — ADR-025 R3 §5).
      //
      // The resolved actor is an anonymous_web actor with account_id = NULL —
      // authenticated query_logs attach to an unlinked anonymous actor until
      // /me links it (account↔actor linking + tier/history-by-account = P0b, out of scope here).
      try {
        request.actorId = await resolveBearerActorId(prisma, payload, request);
      } catch (err) {
        // Transient DB error: degrade gracefully — leave actorId undefined.
        // /conversation/* routes will still guard on missing actorId, but non-actor
        // routes (e.g. /auth/logout) continue unaffected. verifyBearerJwt (above)
        // is intentionally OUTSIDE this try — invalid bearer still throws (ADR-025 R3 §5).
        request.log.warn({ event: 'bearer_actor_resolution_failed', errMessage: err instanceof Error ? err.message : String(err) }, 'Bearer actor resolution failed; actorId left unset');
      }
      return;
    }

    // Anonymous flow (unchanged from F069)
    const rawHeader = request.headers['x-actor-id'];
    const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    let actorId: string;

    if (headerValue && UUID_RE.test(headerValue)) {
      // Valid UUID — anonymous web client
      actorId = await resolveActor(prisma, headerValue, request);
    } else {
      // Missing or invalid (incl. legacy "telegram:..." headers) — create new anonymous actor
      actorId = await createAnonymousActor(prisma, reply, request);
    }

    request.actorId = actorId;
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve or create an anonymous_web actor by external_id (UUID).
 * Uses upsert to handle concurrent creation safely.
 * Fire-and-forget last_seen_at update.
 */
async function resolveActor(
  prisma: PrismaClient,
  externalId: string,
  request: FastifyRequest,
): Promise<string> {
  try {
    const actor = await prisma.actor.upsert({
      where: {
        type_externalId: { type: 'anonymous_web', externalId },
      },
      update: {
        lastSeenAt: new Date(),
      },
      create: {
        type: 'anonymous_web',
        externalId,
        lastSeenAt: new Date(),
      },
      select: { id: true },
    });
    return actor.id;
  } catch (err) {
    // Non-critical — if actor resolution fails, generate a transient ID
    // so the request can still proceed (degrade gracefully)
    request.log.warn?.({ err }, 'F069: actor resolution failed');
    return randomUUID();
  }
}

/**
 * Create a new anonymous_web actor with a generated UUID.
 * Sets X-Actor-Id response header so the client can persist it.
 */
async function createAnonymousActor(
  prisma: PrismaClient,
  reply: FastifyReply,
  request: FastifyRequest,
): Promise<string> {
  const externalId = randomUUID();

  try {
    const actor = await prisma.actor.create({
      data: {
        type: 'anonymous_web',
        externalId,
        lastSeenAt: new Date(),
      },
      select: { id: true },
    });
    reply.header('X-Actor-Id', externalId);
    return actor.id;
  } catch (err) {
    request.log.warn?.({ err }, 'F069: anonymous actor creation failed');
    reply.header('X-Actor-Id', externalId);
    return externalId; // Fallback: use external ID as transient actor ID
  }
}
