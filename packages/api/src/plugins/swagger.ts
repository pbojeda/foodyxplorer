// Swagger / OpenAPI plugin registration.
//
// Registers @fastify/swagger and @fastify/swagger-ui.
// Skipped entirely when NODE_ENV === 'test' to keep test output clean.
//
// Uses a `transform` function to strip internal Zod metadata properties
// (like `_cached: null`) from JSON Schemas before @fastify/swagger processes
// them. Without this, schemaToMedia() in @fastify/swagger crashes with
// "Cannot read properties of null (reading 'examples')" because it receives
// null property values that Zod's internal caching leaves behind.

import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively strip properties with null/undefined values and internal
 * Zod metadata keys (prefixed with `_`) from a JSON Schema object.
 * Mutates in place for performance — schemas are ephemeral at this point.
 */
function cleanJsonSchema(obj: unknown): unknown {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(cleanJsonSchema);
  }

  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (record[key] === null || record[key] === undefined || key.startsWith('_')) {
      delete record[key];
    } else if (typeof record[key] === 'object') {
      cleanJsonSchema(record[key]);
    }
  }
  return record;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

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
        description: 'foodXPlorer REST API — nutritional data for restaurant dishes and common foods.',
      },
    },
    transform: ({ schema, url }) => {
      // Deep-clean the schema to remove null properties and Zod internal metadata
      // that would crash @fastify/swagger's schemaToMedia function.
      const cleaned = schema ? cleanJsonSchema(JSON.parse(JSON.stringify(schema))) : schema;
      return { schema: cleaned as typeof schema, url };
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
