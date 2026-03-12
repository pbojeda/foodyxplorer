// Unit/integration tests for plugins/rateLimit.ts
//
// Rate limiting is not registered when NODE_ENV === 'test'. Tests that
// exercise the actual plugin use buildApp with NODE_ENV === 'development'
// so the plugin is registered.
//
// No real Redis required — skipOnError: true means the plugin degrades
// silently when the ioredis client is in lazyConnect mode without a live
// connection.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { Config } from '../config.js';
import { buildApp } from '../app.js';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

const prismaThatSucceeds = {
  $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1n }]),
} as unknown as PrismaClient;

const redisThatSucceeds = {
  ping: vi.fn().mockResolvedValue('PONG'),
} as unknown as Redis;

const testConfig: Config = {
  NODE_ENV: 'test',
  PORT: 3001,
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
  DATABASE_URL_TEST: 'postgresql://user:pass@localhost:5432/test',
  LOG_LEVEL: 'info',
  REDIS_URL: 'redis://localhost:6380',
};

const devConfig: Config = {
  ...testConfig,
  NODE_ENV: 'development',
};

// ---------------------------------------------------------------------------
// Rate limiting is NOT registered in test env
// ---------------------------------------------------------------------------

describe('registerRateLimit — test env (plugin skipped)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({
      config: testConfig,
      prisma: prismaThatSucceeds,
      redis: redisThatSucceeds,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('no x-ratelimit-limit header is present when NODE_ENV=test (plugin not registered)', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-ratelimit-limit']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Rate limiting IS registered in development env
// ---------------------------------------------------------------------------

describe('registerRateLimit — development env (plugin active)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({
      config: devConfig,
      prisma: prismaThatSucceeds,
      redis: redisThatSucceeds,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('/health is exempt from rate limiting — no rate limit headers (allowList)', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    // /health is in the allowList — rate limit headers should NOT appear.
    expect(response.headers['x-ratelimit-limit']).toBeUndefined();
  });

  it('/health is exempt from rate limiting (skip function works)', async () => {
    // Send many requests to /health — should not get a 429
    const promises = Array.from({ length: 5 }, () =>
      app.inject({ method: 'GET', url: '/health' }),
    );
    const responses = await Promise.all(promises);
    for (const response of responses) {
      expect(response.statusCode).toBe(200);
    }
  });
});

// ---------------------------------------------------------------------------
// 429 response shape — verified using a low-limit buildApp config
// ---------------------------------------------------------------------------

describe('registerRateLimit — 429 error envelope', () => {
  it('returns { success: false, error: { code: "RATE_LIMIT_EXCEEDED" } } on 429', async () => {
    // Build a special app with rate limit max=1 to trigger 429 easily.
    // We register the rate-limit plugin + error handler directly on a fresh
    // Fastify instance with NODE_ENV development so we can control max.
    const Fastify = (await import('fastify')).default;
    const {
      serializerCompiler,
      validatorCompiler,
    } = await import('fastify-type-provider-zod');
    const { default: rateLimit } = await import('@fastify/rate-limit');
    const { registerErrorHandler } = await import('../errors/errorHandler.js');

    const testApp = Fastify({ logger: false });
    testApp.setValidatorCompiler(validatorCompiler);
    testApp.setSerializerCompiler(serializerCompiler);

    await testApp.register(rateLimit, {
      max: 1,
      timeWindow: '1 minute',
      skipOnError: true,
      allowList: (req) => req.routeOptions.url === '/health',
      errorResponseBuilder: (_req, context) => {
        const err = new Error('Too many requests, please try again later.');
        (err as Error & { statusCode: number; code: string }).statusCode =
          context.statusCode;
        (err as Error & { statusCode: number; code: string }).code =
          'RATE_LIMIT_EXCEEDED';
        return err;
      },
    });

    registerErrorHandler(testApp);
    testApp.get('/test-rate-limit', async () => ({ ok: true }));

    // First request succeeds
    const first = await testApp.inject({
      method: 'GET',
      url: '/test-rate-limit',
    });
    expect(first.statusCode).toBe(200);

    // Second request is rate-limited
    const second = await testApp.inject({
      method: 'GET',
      url: '/test-rate-limit',
    });
    expect(second.statusCode).toBe(429);

    const body = JSON.parse(second.body) as {
      success: boolean;
      error: { message: string; code: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(body.error.message).toBe('Too many requests, please try again later.');

    await testApp.close();
  });
});
