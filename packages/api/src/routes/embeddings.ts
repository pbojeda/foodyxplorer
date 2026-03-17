// POST /embeddings/generate — triggers the embedding generation pipeline.
//
// Validates request body with EmbeddingGenerateRequestSchema.
// Checks OPENAI_API_KEY presence before invoking the pipeline.
// Returns EmbeddingGenerateResponse on success.
// Timeout: 300 seconds (5 minutes) for worst-case pipeline runs.

import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import type { PrismaClient } from '@prisma/client';
import {
  EmbeddingGenerateRequestSchema,
  type EmbeddingGenerateRequest,
} from '@foodxplorer/shared';
import { runEmbeddingPipeline } from '../embeddings/pipeline.js';
import { config } from '../config.js';

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

interface EmbeddingPluginOptions {
  prisma: PrismaClient;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const embeddingRoutesPlugin: FastifyPluginAsync<EmbeddingPluginOptions> = async (
  app,
  opts,
) => {
  const { prisma } = opts;

  app.post(
    '/embeddings/generate',
    {
      config: { timeout: 300_000 }, // 5 min for worst-case pipeline
      schema: {
        body: EmbeddingGenerateRequestSchema,
        tags: ['Embeddings'],
        summary: 'Generate embeddings for foods and/or dishes',
        description:
          'Triggers the embedding generation pipeline for food and/or dish entities. ' +
          'Requires OPENAI_API_KEY to be set. Use dryRun:true to estimate tokens ' +
          'without making API calls or writing to the database. ' +
          'Timeout: 300 seconds.',
      },
    },
    async (request, reply) => {
      const body = request.body as EmbeddingGenerateRequest;

      // Read API key at invocation time — not from config singleton
      // (OPENAI_API_KEY is optional at startup; validated here)
      const apiKey = process.env['OPENAI_API_KEY'];

      if (!body.dryRun && !apiKey) {
        throw Object.assign(
          new Error('OPENAI_API_KEY is not configured'),
          { code: 'EMBEDDING_PROVIDER_UNAVAILABLE' },
        );
      }

      const data = await runEmbeddingPipeline({
        target: body.target,
        chainSlug: body.chainSlug,
        batchSize: body.batchSize,
        force: body.force,
        dryRun: body.dryRun,
        prisma,
        openaiApiKey: apiKey ?? '',
        embeddingModel: config.OPENAI_EMBEDDING_MODEL,
        embeddingRpm: config.OPENAI_EMBEDDING_RPM,
      });

      return reply.send({ success: true, data });
    },
  );
};

// Wrap with fastify-plugin so the route is registered on the root scope,
// allowing the root-level error handler to apply to embedding route errors.
export const embeddingRoutes = fastifyPlugin(embeddingRoutesPlugin);
