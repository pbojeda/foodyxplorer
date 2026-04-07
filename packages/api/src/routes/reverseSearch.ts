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
      const parseResult = ReverseSearchQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.code(400).send({
          success: false,
          error: parseResult.error.flatten(),
        });
      }

      const { chainSlug, maxCalories, minProtein, limit } = parseResult.data;

      // Verify chain exists
      const restaurant = await prisma.restaurant.findFirst({
        where: { chainSlug },
        select: { id: true },
      });

      if (!restaurant) {
        return reply.code(404).send({
          success: false,
          code: 'CHAIN_NOT_FOUND',
          message: `Chain "${chainSlug}" not found`,
        });
      }

      const data = await reverseSearchDishes(db, {
        chainSlug,
        maxCalories,
        minProtein,
        limit,
      });

      return reply.send({ success: true, data });
    },
  );
};

export const reverseSearchRoutes = fastifyPlugin(reverseSearchRoutesPlugin, {
  name: 'reverse-search-routes',
});
