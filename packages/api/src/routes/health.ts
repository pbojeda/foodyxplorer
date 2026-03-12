// GET /health — server liveness and optional DB connectivity check.
//
// Accepts an injectable prisma instance via plugin options so tests can
// substitute a mock without module-level mocking.
//
// Route schemas:
//   HealthQuerySchema  — validates the ?db query param
//   HealthResponseSchema — validates the response shape (also used for OpenAPI)

import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import type { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const HealthQuerySchema = z.object({
  db: z
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
});

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

interface HealthPluginOptions {
  prisma: PrismaClient;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const healthRoutesPlugin: FastifyPluginAsync<HealthPluginOptions> = async (
  app,
  opts,
) => {
  const { prisma } = opts;

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
          'Returns server status. Pass ?db=true to also check DB connectivity.',
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

      if (query.db === true) {
        try {
          await prisma.$queryRaw`SELECT 1`;
          return reply.send({ ...base, db: 'connected' as const });
        } catch {
          // Route through global error handler with a typed error
          throw Object.assign(
            new Error('Database connectivity check failed'),
            { statusCode: 500, code: 'DB_UNAVAILABLE' },
          );
        }
      }

      return reply.send(base);
    },
  );
};

// Wrap with fastify-plugin so the route is registered on the root scope,
// allowing the root-level error handler to apply to health route errors.
export const healthRoutes = fastifyPlugin(healthRoutesPlugin);
