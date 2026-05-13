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

// ---------------------------------------------------------------------------
// Fastify type augmentation
// ---------------------------------------------------------------------------

declare module 'fastify' {
  interface FastifyRequest {
    actorId?: string;
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// registerActorResolver
// ---------------------------------------------------------------------------

interface RegisterActorResolverOptions {
  prisma: PrismaClient;
}

export async function registerActorResolver(
  app: FastifyInstance,
  { prisma }: RegisterActorResolverOptions,
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
