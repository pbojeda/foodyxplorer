// GET /reverse-search — F086 Reverse Search.
//
// Given a calorie budget and optional protein minimum, returns chain dishes
// that fit the constraints, sorted by protein density descending.

import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import type { Kysely } from 'kysely';
import type { PrismaClient } from '@prisma/client';
import { ReverseSearchQuerySchema } from '@foodxplorer/shared';
import type { DB } from '../generated/kysely-types.js';
import { reverseSearchDishes } from '../estimation/reverseSearch.js';

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

interface ReverseSearchPluginOptions {
  db: Kysely<DB>;
  prisma: PrismaClient;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const reverseSearchRoutesPlugin: FastifyPluginAsync<ReverseSearchPluginOptions> = async (
  app,
  opts,
) => {
  const { db, prisma } = opts;

  app.get(
    '/reverse-search',
    {
      schema: {
        tags: ['Estimation'],
        operationId: 'reverseSearch',
        summary: 'Reverse search — find dishes within calorie/protein constraints',
        description:
          'Given a chain, calorie budget, and optional protein minimum, returns ' +
          'dishes that fit the constraints sorted by protein density (proteins/calories) descending.',
      },
    },
    async (request, reply) => {
      // Validate query params — throw on failure so the global error handler
      // formats the response using the standard error envelope (BUG-AUDIT-C1C3: C3).
      const parseResult = ReverseSearchQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        const firstIssue = parseResult.error.issues[0];
        const path = firstIssue ? firstIssue.path.join('/') : '';
        const msg = firstIssue ? firstIssue.message : 'Validation failed';
        throw Object.assign(
          new Error(`querystring/${path} ${msg}`),
          { code: 'VALIDATION_ERROR' },
        );
      }

      const { chainSlug, maxCalories, minProtein, limit } = parseResult.data;

      // Verify chain exists — throw on miss so the global error handler
      // wraps the response in the standard envelope (BUG-AUDIT-C1C3: C1).
      const restaurant = await prisma.restaurant.findFirst({
        where: { chainSlug },
        select: { id: true, name: true },
      });

      if (!restaurant) {
        throw Object.assign(
          new Error(`Chain "${chainSlug}" not found`),
          { code: 'CHAIN_NOT_FOUND' },
        );
      }

      const data = await reverseSearchDishes(db, {
        chainSlug,
        maxCalories,
        minProtein,
        limit,
        chainName: restaurant.name,
      });

      return reply.send({ success: true, data });
    },
  );
};

export const reverseSearchRoutes = fastifyPlugin(reverseSearchRoutesPlugin, {
  name: 'reverse-search-routes',
});
