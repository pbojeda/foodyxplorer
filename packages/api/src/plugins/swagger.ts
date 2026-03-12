// Swagger / OpenAPI plugin registration.
//
// Registers @fastify/swagger and @fastify/swagger-ui.
// Skipped entirely when NODE_ENV === 'test' to keep test output clean.

import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';

export async function registerSwagger(
  app: FastifyInstance,
  config: Config,
): Promise<void> {
  if (config.NODE_ENV === 'test') {
    return;
  }

  const { default: swagger } = await import('@fastify/swagger');
  const { default: swaggerUi } = await import('@fastify/swagger-ui');

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'foodXPlorer API',
        version: process.env['npm_package_version'] ?? '0.0.0',
        description: 'foodXPlorer REST API',
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
    },
  });
}
