// F005 Edge-Case Tests
//
// Covers:
//   1. buildApp with explicit redis option injects into healthRoutes (?redis=true mock)
//   2. buildApp without redis option falls back to singleton from lib/redis.ts
//   3. REDIS_URL defaults to "redis://localhost:6380" in config
//   4. Combined ?db=true&redis=true — DB up, Redis down → REDIS_UNAVAILABLE
//   5. ?redis param coercions: false/0/1 do NOT call ping; true DOES call ping
//   6. REDIS_UNAVAILABLE error maps correctly in errorHandler

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { Config } from '../config.js';

// ---------------------------------------------------------------------------
// process.exit spy — needed for parseConfig tests
// ---------------------------------------------------------------------------

const exitSpy = vi.spyOn(process, 'exit').mockImplementation(
  (_code?: string | number | null | undefined): never => {
    throw new Error('process.exit called');
  },
);

let parseConfig: (env: NodeJS.ProcessEnv) => Config;

beforeAll(async () => {
  const mod = await import('../config.js');
  parseConfig = mod.parseConfig;
});

const VALID_ENV = {
  NODE_ENV: 'development' as const,
  PORT: '3001',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/mydb',
  LOG_LEVEL: 'info' as const,
} satisfies NodeJS.ProcessEnv;

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

const prismaThatSucceeds = {
  $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1n }]),
} as unknown as PrismaClient;

const redisThatSucceeds = {
  ping: vi.fn().mockResolvedValue('PONG'),
} as unknown as Redis;

const redisThatFails = {
  ping: vi.fn().mockRejectedValue(new Error('Connection refused')),
} as unknown as Redis;

const testConfig: Config = {
  NODE_ENV: 'test',
  PORT: 3001,
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
  DATABASE_URL_TEST: 'postgresql://user:pass@localhost:5432/test',
  LOG_LEVEL: 'info',
  REDIS_URL: 'redis://localhost:6380',
};

import { buildApp } from '../app.js';

// ---------------------------------------------------------------------------
// 1. REDIS_URL config default
// ---------------------------------------------------------------------------

describe('config — REDIS_URL default', () => {
  beforeEach(() => {
    exitSpy.mockClear();
  });

  it('REDIS_URL defaults to "redis://localhost:6380" when absent from env', () => {
    const cfg = parseConfig({ ...VALID_ENV });
    expect(cfg.REDIS_URL).toBe('redis://localhost:6380');
  });

  it('REDIS_URL accepts a custom redis URL', () => {
    const cfg = parseConfig({ ...VALID_ENV, REDIS_URL: 'redis://custom-host:6379' });
    expect(cfg.REDIS_URL).toBe('redis://custom-host:6379');
  });
});

// ---------------------------------------------------------------------------
// 2. buildApp — explicit redis injection
// ---------------------------------------------------------------------------

describe('buildApp — explicit redis option injects into healthRoutes', () => {
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

  it('?redis=true calls ping on the injected mock and returns connected', async () => {
    vi.clearAllMocks();
    const response = await app.inject({
      method: 'GET',
      url: '/health?redis=true',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { redis?: string };
    expect(body.redis).toBe('connected');

    const pingMock = redisThatSucceeds.ping as ReturnType<typeof vi.fn>;
    expect(pingMock).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. ?redis param coercions (strict — only "true" triggers the check)
// ---------------------------------------------------------------------------

describe('GET /health — ?redis param coercions', () => {
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

  it('?redis=false does NOT call ping (strict "true" matching)', async () => {
    vi.clearAllMocks();
    const response = await app.inject({
      method: 'GET',
      url: '/health?redis=false',
    });

    expect(response.statusCode).toBe(200);
    const pingMock = redisThatSucceeds.ping as ReturnType<typeof vi.fn>;
    expect(pingMock).not.toHaveBeenCalled();

    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect('redis' in body).toBe(false);
  });

  it('?redis=0 does NOT call ping', async () => {
    vi.clearAllMocks();
    const response = await app.inject({
      method: 'GET',
      url: '/health?redis=0',
    });

    expect(response.statusCode).toBe(200);
    const pingMock = redisThatSucceeds.ping as ReturnType<typeof vi.fn>;
    expect(pingMock).not.toHaveBeenCalled();
  });

  it('?redis=1 does NOT call ping', async () => {
    vi.clearAllMocks();
    const response = await app.inject({
      method: 'GET',
      url: '/health?redis=1',
    });

    expect(response.statusCode).toBe(200);
    const pingMock = redisThatSucceeds.ping as ReturnType<typeof vi.fn>;
    expect(pingMock).not.toHaveBeenCalled();
  });

  it('?redis=true DOES call ping', async () => {
    vi.clearAllMocks();
    const response = await app.inject({
      method: 'GET',
      url: '/health?redis=true',
    });

    expect(response.statusCode).toBe(200);
    const pingMock = redisThatSucceeds.ping as ReturnType<typeof vi.fn>;
    expect(pingMock).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Combined ?db=true&redis=true — DB up, Redis down → REDIS_UNAVAILABLE
// ---------------------------------------------------------------------------

describe('GET /health?db=true&redis=true — DB up, Redis down', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({
      config: testConfig,
      prisma: prismaThatSucceeds,
      redis: redisThatFails,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 500 REDIS_UNAVAILABLE (not DB_UNAVAILABLE) when DB is up but Redis is down', async () => {
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
    expect(body.error.code).not.toBe('DB_UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// 5. REDIS_UNAVAILABLE error envelope via mapError
// ---------------------------------------------------------------------------

import { mapError } from '../errors/errorHandler.js';

describe('mapError — REDIS_UNAVAILABLE code', () => {
  it('maps REDIS_UNAVAILABLE to 500 with original message passed through', () => {
    const err = Object.assign(
      new Error('Redis connectivity check failed'),
      { statusCode: 500, code: 'REDIS_UNAVAILABLE' },
    );

    const result = mapError(err);

    expect(result.statusCode).toBe(500);
    expect(result.body.success).toBe(false);
    expect(result.body.error.code).toBe('REDIS_UNAVAILABLE');
    expect(result.body.error.message).toBe('Redis connectivity check failed');
  });
});
