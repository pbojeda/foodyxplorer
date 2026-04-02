// actorResolver.ts — Global actor resolution middleware (F069, ADR-016)
//
// Registers a global onRequest hook that resolves or creates an actor
// for every request. Actors are the anonymous identity layer — web clients
// send X-Actor-Id header, bot sends telegram:<chat_id>.
//
// Resolution flow:
//   1. Skip /health endpoint
//   2. Read X-Actor-Id header
//   3. "telegram:<chatId>" prefix → upsert telegram actor
//   4. Valid UUID → upsert anonymous_web actor
//   5. Missing/invalid → generate UUID, create actor, set X-Actor-Id response header
//   6. Set request.actorId = actor.id
//   7. Fire-and-forget last_seen_at update

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
const TELEGRAM_PREFIX = 'telegram:';

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
    if (url === '/health' || url === '/docs' || url === '/docs/json') return;

    const rawHeader = request.headers['x-actor-id'];
    const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    let actorId: string;

    if (headerValue?.startsWith(TELEGRAM_PREFIX)) {
      // Telegram bot: "telegram:<chatId>"
      const chatId = headerValue.slice(TELEGRAM_PREFIX.length);
      if (chatId.length > 0) {
        actorId = await resolveActor(prisma, 'telegram', chatId, request);
      } else {
        actorId = await createAnonymousActor(prisma, reply, request);
      }
    } else if (headerValue && UUID_RE.test(headerValue)) {
      // Valid UUID — anonymous web client
      actorId = await resolveActor(prisma, 'anonymous_web', headerValue, request);
    } else {
      // Missing or invalid — create new anonymous actor
      actorId = await createAnonymousActor(prisma, reply, request);
    }

    request.actorId = actorId;
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve or create an actor by type + external_id.
 * Uses upsert to handle concurrent creation safely.
 * Fire-and-forget last_seen_at update.
 */
async function resolveActor(
  prisma: PrismaClient,
  type: 'anonymous_web' | 'telegram',
  externalId: string,
  request: FastifyRequest,
): Promise<string> {
  try {
    const actor = await prisma.actor.upsert({
      where: {
        type_externalId: { type, externalId },
      },
      update: {
        lastSeenAt: new Date(),
      },
      create: {
        type,
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
