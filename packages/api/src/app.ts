// buildApp — creates and configures the Fastify instance.
//
// All plugins are registered here. server.ts is the only file that calls
// server.listen(). Tests import buildApp() directly and use .inject().
//
// Plugin registration order: swagger → cors → authMiddleware → actorResolver → rateLimit → actorRateLimit → multipart → errorHandler → routes

import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import fastifyFormbody from '@fastify/formbody';
import fastifyMultipart from '@fastify/multipart';

import { config as defaultConfig, type Config } from './config.js';
import { prisma as defaultPrisma } from './lib/prisma.js';
import { redis as defaultRedis } from './lib/redis.js';
import { registerSwagger } from './plugins/swagger.js';
import { registerCors } from './plugins/cors.js';
import { registerAuthMiddleware } from './plugins/auth.js';
import { registerActorResolver } from './plugins/actorResolver.js';
import { registerRateLimit } from './plugins/rateLimit.js';
import { registerActorRateLimit } from './plugins/actorRateLimit.js';
import { registerErrorHandler } from './errors/errorHandler.js';
import { healthRoutes } from './routes/health.js';
import { ingestPdfRoutes } from './routes/ingest/pdf.js';
import { ingestUrlRoutes } from './routes/ingest/url.js';
import { ingestPdfUrlRoutes } from './routes/ingest/pdf-url.js';
import { ingestImageUrlRoutes } from './routes/ingest/image-url.js';
import { ingestImageRoutes } from './routes/ingest/image.js';
import { qualityRoutes } from './routes/quality.js';
import { embeddingRoutes } from './routes/embeddings.js';
import { estimateRoutes } from './routes/estimate.js';
import { catalogRoutes } from './routes/catalog.js';
import { analyticsRoutes } from './routes/analytics.js';
import { missedQueriesRoutes } from './routes/missedQueries.js';
import { recipeCalculateRoutes } from './routes/recipeCalculate.js';
import { analyzeRoutes } from './routes/analyze.js';
import { waitlistRoutes } from './routes/waitlist.js';
import { conversationRoutes } from './routes/conversation.js';
import { reverseSearchRoutes } from './routes/reverseSearch.js';
import { webMetricsRoutes } from './routes/webMetrics.js';
import { getKysely } from './lib/kysely.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuildAppOptions {
  config?: Config;
  prisma?: PrismaClient;
  redis?: Redis;
}

// ---------------------------------------------------------------------------
// buildApp factory
// ---------------------------------------------------------------------------

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const cfg = opts.config ?? defaultConfig;
  const prismaClient = opts.prisma ?? defaultPrisma;
  const redisClient = opts.redis ?? defaultRedis;

  // Build the Fastify instance with environment-appropriate logger settings.
  // logger:false (boolean) fully disables logging in test env — Fastify v5
  // accepts boolean false to suppress all log output.
  let app: FastifyInstance;

  if (cfg.NODE_ENV === 'test') {
    app = Fastify({ logger: false, trustProxy: true });
  } else if (cfg.NODE_ENV === 'development') {
    app = Fastify({
      logger: {
        level: cfg.LOG_LEVEL,
        transport: {
          target: 'pino-pretty',
        },
      },
      trustProxy: true,
    });
  } else {
    app = Fastify({
      logger: {
        level: cfg.LOG_LEVEL,
      },
      trustProxy: true,
    });
  }

  // Attach Zod type provider so route handler types are inferred from schemas
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Register text/plain content type parser for sendBeacon requests (F113).
  // The route handler calls JSON.parse() on the raw string body.
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });

  // Register all plugins and routes — await to ensure dynamic imports
  // (swagger, cors, rateLimit) complete before app.ready() is called.
  await registerSwagger(app, cfg);
  await registerCors(app, cfg);
  await registerAuthMiddleware(app, { prisma: prismaClient, config: cfg });
  await registerActorResolver(app, { prisma: prismaClient });
  await registerRateLimit(app, cfg);
  await registerActorRateLimit(app, { redis: redisClient });
  // Register formbody before multipart (application/x-www-form-urlencoded support for /waitlist)
  await app.register(fastifyFormbody);
  // Register multipart before route plugins (file upload support)
  await app.register(fastifyMultipart, {
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  });
  registerErrorHandler(app);

  await app.register(healthRoutes, { prisma: prismaClient, redis: redisClient });
  await app.register(ingestPdfRoutes, { prisma: prismaClient });
  await app.register(ingestUrlRoutes, { prisma: prismaClient });
  await app.register(ingestPdfUrlRoutes, { prisma: prismaClient });
  await app.register(ingestImageUrlRoutes, { prisma: prismaClient });
  await app.register(ingestImageRoutes, { prisma: prismaClient });
  await app.register(qualityRoutes, { prisma: prismaClient });
  await app.register(embeddingRoutes, { prisma: prismaClient });
  await app.register(estimateRoutes, { db: getKysely(), prisma: prismaClient });
  await app.register(catalogRoutes, { prisma: prismaClient, db: getKysely() });
  await app.register(analyticsRoutes, { db: getKysely() });
  await app.register(missedQueriesRoutes, { db: getKysely(), prisma: prismaClient });
  await app.register(recipeCalculateRoutes, { db: getKysely(), prisma: prismaClient });
  await app.register(analyzeRoutes, { db: getKysely(), prisma: prismaClient });
  await app.register(waitlistRoutes, { prisma: prismaClient });
  await app.register(conversationRoutes, { db: getKysely(), prisma: prismaClient, redis: redisClient });
  await app.register(reverseSearchRoutes, { db: getKysely(), prisma: prismaClient });
  await app.register(webMetricsRoutes, { db: getKysely(), prisma: prismaClient });

  return app;
}
