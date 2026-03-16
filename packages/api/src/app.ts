// buildApp — creates and configures the Fastify instance.
//
// All plugins are registered here. server.ts is the only file that calls
// server.listen(). Tests import buildApp() directly and use .inject().
//
// Plugin registration order: swagger → cors → rateLimit → errorHandler → routes

import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import fastifyMultipart from '@fastify/multipart';

import { config as defaultConfig, type Config } from './config.js';
import { prisma as defaultPrisma } from './lib/prisma.js';
import { redis as defaultRedis } from './lib/redis.js';
import { registerSwagger } from './plugins/swagger.js';
import { registerCors } from './plugins/cors.js';
import { registerRateLimit } from './plugins/rateLimit.js';
import { registerErrorHandler } from './errors/errorHandler.js';
import { healthRoutes } from './routes/health.js';
import { ingestPdfRoutes } from './routes/ingest/pdf.js';
import { ingestUrlRoutes } from './routes/ingest/url.js';
import { ingestPdfUrlRoutes } from './routes/ingest/pdf-url.js';

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
    app = Fastify({ logger: false });
  } else if (cfg.NODE_ENV === 'development') {
    app = Fastify({
      logger: {
        level: cfg.LOG_LEVEL,
        transport: {
          target: 'pino-pretty',
        },
      },
    });
  } else {
    app = Fastify({
      logger: {
        level: cfg.LOG_LEVEL,
      },
    });
  }

  // Attach Zod type provider so route handler types are inferred from schemas
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Register all plugins and routes — await to ensure dynamic imports
  // (swagger, cors, rateLimit) complete before app.ready() is called.
  await registerSwagger(app, cfg);
  await registerCors(app, cfg);
  await registerRateLimit(app, cfg);
  // Register multipart before route plugins (file upload support)
  await app.register(fastifyMultipart, {
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  });
  registerErrorHandler(app);

  await app.register(healthRoutes, { prisma: prismaClient, redis: redisClient });
  await app.register(ingestPdfRoutes, { prisma: prismaClient });
  await app.register(ingestUrlRoutes, { prisma: prismaClient });
  await app.register(ingestPdfUrlRoutes, { prisma: prismaClient });

  return app;
}
