// CORS plugin registration.
//
// Configures @fastify/cors based on NODE_ENV:
//   - development : localhost:3000 and localhost:5173 (Vite default)
//   - test        : not registered
//   - production  : explicit allowlist via CORS_ORIGINS env var (comma-separated);
//                   empty list → CORS disabled (origin: false)
//
// CORS_ORIGINS is NOT in EnvSchema — it is an optional production-only concern
// read directly from process.env.

import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'X-API-Key'];

export async function registerCors(
  app: FastifyInstance,
  config: Config,
): Promise<void> {
  if (config.NODE_ENV === 'test') {
    return;
  }

  const { default: cors } = await import('@fastify/cors');

  if (config.NODE_ENV === 'development') {
    await app.register(cors, {
      origin: ['http://localhost:3000', 'http://localhost:5173'],
      methods: ALLOWED_METHODS,
      allowedHeaders: ALLOWED_HEADERS,
    });
    return;
  }

  // production
  const rawOrigins = process.env['CORS_ORIGINS'] ?? '';
  const origins = rawOrigins
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  await app.register(cors, {
    origin: origins.length > 0 ? origins : false,
    methods: ALLOWED_METHODS,
    allowedHeaders: ALLOWED_HEADERS,
  });
}
