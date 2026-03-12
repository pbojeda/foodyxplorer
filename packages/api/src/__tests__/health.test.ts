// Integration-style tests for the /health route via buildApp + .inject()
//
// No port binding — Fastify's inject() sends requests in-process.
// The prisma client is passed as an injectable mock via buildApp options.

import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { buildApp } from '../app.js';

// ---------------------------------------------------------------------------
// Prisma mocks
// ---------------------------------------------------------------------------

const prismaThatSucceeds = {
  $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1n }]),
} as unknown as PrismaClient;

const prismaThatFails = {
  $queryRaw: vi.fn().mockRejectedValue(new Error('connection refused')),
} as unknown as PrismaClient;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('GET /health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ prisma: prismaThatSucceeds });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with correct envelope shape', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body) as {
      status: string;
      timestamp: string;
      version: string;
      uptime: number;
      db?: string;
    };

    expect(body.status).toBe('ok');
    expect(typeof body.timestamp).toBe('string');
    // ISO 8601 format check
    expect(() => new Date(body.timestamp)).not.toThrow();
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
    expect(typeof body.version).toBe('string');
    expect(typeof body.uptime).toBe('number');
  });

  it('does NOT include db field when ?db param is absent', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = JSON.parse(response.body) as Record<string, unknown>;

    expect(Object.prototype.hasOwnProperty.call(body, 'db')).toBe(false);
  });

  it('returns db: "connected" when ?db=true and prisma succeeds', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health?db=true',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { db?: string };
    expect(body.db).toBe('connected');
  });
});

describe('GET /health?db=true — DB unavailable', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ prisma: prismaThatFails });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 500 with DB_UNAVAILABLE error envelope when prisma throws', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health?db=true',
    });

    expect(response.statusCode).toBe(500);

    const body = JSON.parse(response.body) as {
      success: boolean;
      error: { message: string; code: string };
    };

    expect(body.success).toBe(false);
    expect(body.error.code).toBe('DB_UNAVAILABLE');
    expect(body.error.message).toBe('Database connectivity check failed');
  });
});

describe('Not found handler', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ prisma: prismaThatSucceeds });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 404 with NOT_FOUND envelope for unknown routes', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/nonexistent-route',
    });

    expect(response.statusCode).toBe(404);

    const body = JSON.parse(response.body) as {
      success: boolean;
      error: { message: string; code: string };
    };

    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('Route not found');
  });
});

describe('Swagger not registered in test env', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ prisma: prismaThatSucceeds });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /docs returns 404 when NODE_ENV=test (swagger not registered)', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs' });
    expect(response.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Redis injectable mock helpers
// ---------------------------------------------------------------------------

const redisThatSucceeds = {
  ping: vi.fn().mockResolvedValue('PONG'),
} as unknown as Redis;

const redisThatFails = {
  ping: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
} as unknown as Redis;

// ---------------------------------------------------------------------------
// GET /health?redis=true — Redis available
// ---------------------------------------------------------------------------

describe('GET /health?redis=true — Redis available', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({
      prisma: prismaThatSucceeds,
      redis: redisThatSucceeds,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('redis field is absent from the response when ?redis=true is not passed', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(body, 'redis')).toBe(false);
  });

  it('returns 200 with { redis: "connected" } when ?redis=true and ping succeeds', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health?redis=true',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { redis?: string };
    expect(body.redis).toBe('connected');
  });

  it('?redis=false does NOT trigger Redis check', async () => {
    vi.clearAllMocks();
    const response = await app.inject({
      method: 'GET',
      url: '/health?redis=false',
    });

    expect(response.statusCode).toBe(200);
    const mockFn = redisThatSucceeds.ping as ReturnType<typeof vi.fn>;
    expect(mockFn).not.toHaveBeenCalled();
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect('redis' in body).toBe(false);
  });

  it('?redis=1 does NOT trigger Redis check', async () => {
    vi.clearAllMocks();
    const response = await app.inject({
      method: 'GET',
      url: '/health?redis=1',
    });

    expect(response.statusCode).toBe(200);
    const mockFn = redisThatSucceeds.ping as ReturnType<typeof vi.fn>;
    expect(mockFn).not.toHaveBeenCalled();
  });

  it('returns db and redis fields when ?db=true&redis=true and both succeed', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health?db=true&redis=true',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { db?: string; redis?: string };
    expect(body.db).toBe('connected');
    expect(body.redis).toBe('connected');
  });
});

// ---------------------------------------------------------------------------
// GET /health?redis=true — Redis unavailable
// ---------------------------------------------------------------------------

describe('GET /health?redis=true — Redis unavailable', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({
      prisma: prismaThatSucceeds,
      redis: redisThatFails,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 500 with REDIS_UNAVAILABLE envelope when ?redis=true and ping fails', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health?redis=true',
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as {
      success: boolean;
      error: { message: string; code: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('REDIS_UNAVAILABLE');
    expect(body.error.message).toBe('Redis connectivity check failed');
  });

  it('returns 500 REDIS_UNAVAILABLE when ?db=true&redis=true and DB succeeds but Redis fails', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health?db=true&redis=true',
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as {
      success: boolean;
      error: { code: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('REDIS_UNAVAILABLE');
  });
});
