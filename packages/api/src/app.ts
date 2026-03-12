// buildApp — creates and configures the Fastify instance.
//
// All plugins are registered here. server.ts is the only file that calls
// server.listen(). Tests import buildApp() directly and use .inject().
//
// Plugin registration order: swagger → cors → errorHandler → routes

import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import type { PrismaClient } from '@prisma/client';

import { config as defaultConfig, type Config } from './config.js';
import { prisma as defaultPrisma } from './lib/prisma.js';
import { registerSwagger } from './plugins/swagger.js';
import { registerCors } from './plugins/cors.js';
import { registerErrorHandler } from './errors/errorHandler.js';
import { healthRoutes } from './routes/health.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuildAppOptions {
  config?: Config;
  prisma?: PrismaClient;
}

// ---------------------------------------------------------------------------
// buildApp factory
// ---------------------------------------------------------------------------

export function buildApp(opts: BuildAppOptions = {}): ReturnType<typeof Fastify> {
  const cfg = opts.config ?? defaultConfig;
  const prismaClient = opts.prisma ?? defaultPrisma;

  // Logger configuration varies by environment
  type LoggerOption = Parameters<typeof Fastify>[0] extends { logger?: infer L } ? L : never;
  let loggerOption: LoggerOption;

  if (cfg.NODE_ENV === 'test') {
    loggerOption = false;
  } else if (cfg.NODE_ENV === 'development') {
    loggerOption = {
      level: cfg.LOG_LEVEL,
      transport: {
        target: 'pino-pretty',
      },
    };
  } else {
    loggerOption = {
      level: cfg.LOG_LEVEL,
    };
  }

  const app = Fastify({ logger: loggerOption });

  // Attach Zod type provider so route handler types are inferred from schemas
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Register all plugins and routes then return the app.
  // Note: We use a synchronous factory but register async plugins using
  // fastify's plugin queue — Fastify handles async initialisation lazily
  // before the first request or explicit app.ready() call.
  void registerSwagger(app, cfg);
  void registerCors(app, cfg);
  registerErrorHandler(app);

  void app.register(healthRoutes, { prisma: prismaClient });

  return app;
}
