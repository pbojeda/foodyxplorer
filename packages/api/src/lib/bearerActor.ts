// lib/bearerActor.ts — Shared bearer actor resolution helpers (BUG-PROD-013)
//
// Extracted from routes/auth.ts so that actorResolver.ts can also resolve
// an actorId for bearer-authenticated requests without duplicating logic.
//
// Functions:
//   provisionFallbackActor(prisma, sub) — upsert deterministic me-<sub.slice(0,8)>
//     anonymous_web actor. Does NOT set account_id (account linking is /me only).
//   resolveBearerActorId(prisma, payload, request) → Promise<string> — read
//     X-Actor-Id header; if valid UUID → upsert that actor; else → fallback.
//
// Invariant (ADR-025 R3 §5): this module is called ONLY after the bearer JWT
// has already been verified and payload.sub is trusted. It never verifies tokens.

import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import type { JWTPayload } from 'jose';

// ---------------------------------------------------------------------------
// UUID regex — same pattern used in actorResolver.ts and auth.ts
// ---------------------------------------------------------------------------

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// provisionFallbackActor
// ---------------------------------------------------------------------------

/**
 * Upsert the deterministic me-<sub.slice(0,8)> fallback actor for a bearer.
 *
 * The externalId `me-<sub.slice(0,8)>` is namespaced to avoid colliding with
 * anonymous_web client UUIDs (which are plain UUIDs, not prefixed).
 * Idempotent under concurrency: two concurrent callers for the same sub converge
 * on the same actor row via the @@unique([type, externalId]) constraint.
 *
 * NOTE: does NOT set account_id — the caller (e.g. /me safe link UPDATE)
 * is responsible for account linking. This keeps the function free of hijack surface.
 */
export async function provisionFallbackActor(
  prisma: PrismaClient,
  sub: string,
): Promise<{ id: string }> {
  const externalId = `me-${sub.slice(0, 8)}`;
  return prisma.actor.upsert({
    where: { type_externalId: { type: 'anonymous_web', externalId } },
    create: { type: 'anonymous_web', externalId, lastSeenAt: new Date() },
    update: { lastSeenAt: new Date() },
    select: { id: true },
  });
}

// ---------------------------------------------------------------------------
// resolveBearerActorId
// ---------------------------------------------------------------------------

/**
 * Resolve an actorId for a bearer-authenticated request.
 *
 * Resolution order:
 *   1. X-Actor-Id header is a valid UUID → upsert anonymous_web actor by that externalId
 *   2. Missing or invalid X-Actor-Id → provisionFallbackActor (me-<sub.slice(0,8)>)
 *
 * Called AFTER verifyBearerJwt has already verified payload.sub is trusted.
 * Does NOT perform account linking (no account_id writes — that is /me only).
 *
 * Mirrors /me actor resolution (auth.ts l.194-223) for use in actorResolver.ts
 * so that bearer requests to /conversation/* also have a valid actorId.
 */
export async function resolveBearerActorId(
  prisma: PrismaClient,
  payload: Pick<JWTPayload, 'sub'>,
  request: FastifyRequest,
): Promise<string> {
  const rawHeader = request.headers['x-actor-id'];
  const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

  if (headerValue && UUID_RE.test(headerValue)) {
    // Valid UUID — upsert anonymous_web actor by that externalId (mirrors /me l.205-212)
    const actor = await prisma.actor.upsert({
      where: { type_externalId: { type: 'anonymous_web', externalId: headerValue } },
      create: { type: 'anonymous_web', externalId: headerValue, lastSeenAt: new Date() },
      update: { lastSeenAt: new Date() },
      select: { id: true },
    });
    return actor.id;
  }

  // No usable UUID header → use deterministic fallback anchored to bearer sub
  const fallback = await provisionFallbackActor(prisma, payload.sub ?? '');
  return fallback.id;
}
