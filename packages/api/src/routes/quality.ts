// GET /quality/report — data quality monitoring endpoint.
//
// Calls all six quality check functions via assembleReport and returns the
// full QualityReportData payload. The 50-group cap on duplicates is applied
// here (not in assembleReport) so the CLI can get the full list.

import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import type { PrismaClient } from '@prisma/client';
import { QualityReportQuerySchema, type QualityReportQuery } from '@foodxplorer/shared';
import { assembleReport } from '../quality/assembleReport.js';

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

interface QualityPluginOptions {
  prisma: PrismaClient;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const qualityRoutesPlugin: FastifyPluginAsync<QualityPluginOptions> = async (
  app,
  opts,
) => {
  const { prisma } = opts;

  app.get(
    '/quality/report',
    {
      schema: {
        querystring: QualityReportQuerySchema,
        tags: ['Quality'],
        summary: 'Data quality monitoring report',
        description:
          'Returns a comprehensive data quality report across six dimensions. ' +
          'Optionally scope to a single chain via ?chainSlug=.',
      },
    },
    async (request, reply) => {
      const { stalenessThresholdDays, chainSlug } =
        request.query as QualityReportQuery;

      let data;
      try {
        data = await assembleReport(
          prisma,
          { chainSlug },
          stalenessThresholdDays,
        );
      } catch {
        throw Object.assign(
          new Error('Database query failed during quality report generation'),
          { statusCode: 500, code: 'DB_UNAVAILABLE' },
        );
      }

      // Apply 50-group cap on duplicates for API response
      // (CLI script calls assembleReport directly and gets the full list)
      const cappedData = {
        ...data,
        duplicates: {
          ...data.duplicates,
          groups: data.duplicates.groups.slice(0, 50),
        },
      };

      return reply.send({ success: true, data: cappedData });
    },
  );
};

// Wrap with fastify-plugin so the route is registered on the root scope,
// allowing the root-level error handler to apply to quality route errors.
export const qualityRoutes = fastifyPlugin(qualityRoutesPlugin);
