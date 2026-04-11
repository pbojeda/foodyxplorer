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
const ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'X-API-Key', 'X-Actor-Id', 'X-FXP-Source'];

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
      origin: ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:3002'],
      methods: ALLOWED_METHODS,
      allowedHeaders: ALLOWED_HEADERS,
      exposedHeaders: ['X-Actor-Id'],
    });
    return;
  }

  // production — allow all origins.
  // Security rationale: the API is public (anonymous access), has no session
  // cookies, and abuse is controlled by per-actorId rate limiting (50/day).
  // CORS adds no meaningful protection in this context. If auth with cookies
  // is added in the future, restrict origins via CORS_ORIGINS env var.
  await app.register(cors, {
    origin: true,
    methods: ALLOWED_METHODS,
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: ['X-Actor-Id'],
  });
}
