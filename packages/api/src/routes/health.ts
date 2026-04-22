// GET /health — server liveness and optional DB / Redis connectivity checks.
//
// Accepts injectable prisma and redis instances via plugin options so tests can
// substitute mocks without module-level mocking.
//
// Route schemas:
//   HealthQuerySchema  — validates the ?db and ?redis query params
//   HealthResponseSchema — validates the response shape (also used for OpenAPI)

import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { sql } from 'kysely';
import { getKysely } from '../lib/kysely.js';
import type { VoiceBudgetData } from '../lib/voiceBudget.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// VoiceBudgetData schema (F091)
// ---------------------------------------------------------------------------

export const VoiceBudgetDataSchema = z.object({
  exhausted: z.boolean(),
  spendEur: z.number(),
  capEur: z.literal(100),
  alertLevel: z.enum(['none', 'warn40', 'warn70', 'warn90', 'warn100', 'cap']),
  monthKey: z.string().regex(/^\d{4}-\d{2}$/), // YYYY-MM
});

/** Fail-open default returned when Redis is unavailable or key is missing */
const VOICE_BUDGET_DEFAULT: VoiceBudgetData = {
  exhausted: false,
  spendEur: 0,
  capEur: 100,
  alertLevel: 'none',
  monthKey: new Date().toISOString().slice(0, 7),
};

const BUDGET_KEY = 'budget:voice:current-month';

export const HealthQuerySchema = z.object({
  db: z
    .string()
    .transform((v) => v === 'true' ? true : undefined)
    .optional(),
  redis: z
    .string()
    .transform((v) => v === 'true' ? true : undefined)
    .optional(),
});

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  timestamp: z.string(),
  version: z.string(),
  uptime: z.number(),
  db: z.enum(['connected', 'unavailable']).optional(),
  redis: z.enum(['connected', 'unavailable']).optional(),
});

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

interface HealthPluginOptions {
  prisma: PrismaClient;
  redis: Redis;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const healthRoutesPlugin: FastifyPluginAsync<HealthPluginOptions> = async (
  app,
  opts,
) => {
  const { prisma, redis } = opts;

  app.get(
    '/health',
    {
      schema: {
        querystring: HealthQuerySchema,
        response: {
          200: HealthResponseSchema,
        },
        tags: ['System'],
        summary: 'Server liveness check',
        description:
          'Returns server status. Pass ?db=true to check DB connectivity, ?redis=true to check Redis connectivity.',
      },
    },
    async (request, reply) => {
      const query = request.query as z.infer<typeof HealthQuerySchema>;

      const base = {
        status: 'ok' as const,
        timestamp: new Date().toISOString(),
        version: process.env['npm_package_version'] ?? '0.0.0',
        uptime: process.uptime(),
      };

      // DB check runs first when ?db=true — verifies both Prisma AND Kysely
      if (query.db === true) {
        try {
          await prisma.$queryRaw`SELECT 1`;
        } catch {
          throw Object.assign(
            new Error('Database connectivity check failed (Prisma)'),
            { statusCode: 500, code: 'DB_UNAVAILABLE' },
          );
        }

        // Kysely check — uses the same DATABASE_URL but a separate pg.Pool
        try {
          const db = getKysely();
          await sql`SELECT 1`.execute(db);
        } catch (err) {
          throw Object.assign(
            new Error(`Database connectivity check failed (Kysely): ${err instanceof Error ? err.message : String(err)}`),
            { statusCode: 500, code: 'DB_UNAVAILABLE' },
          );
        }
      }

      // Redis check runs after DB check when ?redis=true
      if (query.redis === true) {
        try {
          await redis.ping();
        } catch {
          throw Object.assign(
            new Error('Redis connectivity check failed'),
            { statusCode: 500, code: 'REDIS_UNAVAILABLE' },
          );
        }
      }

      // Build response — include fields only when checks were requested
      const responseBody: z.infer<typeof HealthResponseSchema> = { ...base };

      if (query.db === true) {
        responseBody.db = 'connected';
      }

      if (query.redis === true) {
        responseBody.redis = 'connected';
      }

      return reply.send(responseBody);
    },
  );

  // -------------------------------------------------------------------------
  // GET /health/voice-budget — monthly voice spend status (F091)
  // -------------------------------------------------------------------------

  app.get(
    '/health/voice-budget',
    {
      schema: {
        tags: ['System'],
        operationId: 'healthVoiceBudget',
        summary: 'Monthly voice spend budget status',
        description:
          'Returns the current monthly voice spend status. Used by HablarShell on mount to ' +
          'pre-populate the budget-cap state. No auth required. CDN-cached 60s. ' +
          'Budget is tracked by an in-process accumulator (no cron) using an atomic Lua script ' +
          'on the budget:voice:current-month Redis key. Returns { exhausted: false, spendEur: 0 } ' +
          'on Redis miss (fail-open).',
        response: {
          200: VoiceBudgetDataSchema,
        },
      },
    },
    async (_request, reply) => {
      reply.header('Cache-Control', 'public, max-age=60');

      let data: VoiceBudgetData;

      try {
        const raw = await redis.get(BUDGET_KEY);

        if (raw === null) {
          data = { ...VOICE_BUDGET_DEFAULT };
        } else {
          const parsed = JSON.parse(raw) as Partial<VoiceBudgetData>;
          // Merge with default to handle any missing fields
          data = {
            exhausted: parsed.exhausted ?? false,
            spendEur: parsed.spendEur ?? 0,
            capEur: 100,
            alertLevel: parsed.alertLevel ?? 'none',
            monthKey: parsed.monthKey ?? VOICE_BUDGET_DEFAULT.monthKey,
          };
        }
      } catch {
        // Fail-open: Redis unavailable or JSON malformed
        data = { ...VOICE_BUDGET_DEFAULT };
      }

      return reply.send(data);
    },
  );
};

// Wrap with fastify-plugin so the route is registered on the root scope,
// allowing the root-level error handler to apply to health route errors.
export const healthRoutes = fastifyPlugin(healthRoutesPlugin);
