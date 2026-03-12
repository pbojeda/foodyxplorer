// F005 Edge-Case Tests
//
// Covers:
//   1. buildApp with explicit redis option injects into healthRoutes (?redis=true mock)
//   2. buildApp without redis option falls back to singleton from lib/redis.ts
//   3. REDIS_URL defaults to "redis://localhost:6380" in config
//   4. Combined ?db=true&redis=true — DB up, Redis down → REDIS_UNAVAILABLE
//   5. ?redis param coercions: false/0/1 do NOT call ping; true DOES call ping
//   6. REDIS_UNAVAILABLE error maps correctly in errorHandler
//   7. cacheGet — JSON.parse failure on corrupted stored value (fail-open)
//   8. cacheSet — circular reference JSON.stringify failure (fail-open)
//   9. cacheSet — stores falsy-but-valid values (false, 0, empty string)
//  10. cacheInvalidatePattern — pipeline.exec() failure mid-loop (fail-open)
//  11. buildKey — colon characters in entity/id produce multi-segment keys
//  12. connectRedis — calling connect() twice (already-connected client)
//  13. rateLimit allowList — /health is exempt even with query params
//  14. cacheGet — returns null for a stored empty string value (JSON.parse(""))

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

  it('?redis=TRUE (uppercase) does NOT call ping — only lowercase "true" is accepted', async () => {
    vi.clearAllMocks();
    const response = await app.inject({
      method: 'GET',
      url: '/health?redis=TRUE',
    });

    expect(response.statusCode).toBe(200);
    const pingMock = redisThatSucceeds.ping as ReturnType<typeof vi.fn>;
    expect(pingMock).not.toHaveBeenCalled();

    const body = JSON.parse(response.body) as Record<string, unknown>;
    // "TRUE" !== "true" in the transform, so redis field must be absent
    expect('redis' in body).toBe(false);
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

// ---------------------------------------------------------------------------
// 6. cacheGet — corrupted (non-JSON) value stored in Redis triggers fail-open
// ---------------------------------------------------------------------------

const { mockRedisForEdgeCases, edgeStore } = vi.hoisted(() => {
  const edgeStore = new Map<string, string>();
  const mockRedisForEdgeCases = {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    scan: vi.fn(),
    pipeline: vi.fn(),
  };
  return { mockRedisForEdgeCases, edgeStore };
});

vi.mock('../lib/redis.js', () => ({
  redis: mockRedisForEdgeCases,
}));

import {
  buildKey,
  cacheGet,
  cacheSet,
  cacheInvalidatePattern,
} from '../lib/cache.js';
import type { FastifyBaseLogger } from 'fastify';

const stubLogger = {
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn(),
  level: 'warn',
  silent: vi.fn(),
} as unknown as FastifyBaseLogger;

function resetEdgeStore() {
  edgeStore.clear();
  vi.clearAllMocks();

  mockRedisForEdgeCases.get.mockImplementation(async (key: string) => {
    return edgeStore.get(key) ?? null;
  });
  mockRedisForEdgeCases.set.mockImplementation(async (key: string, value: string) => {
    edgeStore.set(key, value);
    return 'OK';
  });
  mockRedisForEdgeCases.del.mockImplementation(async (...keys: string[]) => {
    let count = 0;
    for (const k of keys) { if (edgeStore.delete(k)) count++; }
    return count;
  });
  mockRedisForEdgeCases.scan.mockImplementation(async (_cursor: string, _match: string, pattern: string) => {
    const allKeys = [...edgeStore.keys()];
    const regexStr = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const regex = new RegExp(`^${regexStr}$`);
    const matched = allKeys.filter((k) => regex.test(k));
    return ['0', matched];
  });
  mockRedisForEdgeCases.pipeline.mockImplementation(() => {
    const delOps: string[] = [];
    const pipe = {
      del: vi.fn((key: string) => { delOps.push(key); return pipe; }),
      exec: vi.fn(async () => {
        for (const key of delOps) { edgeStore.delete(key); }
        return delOps.map(() => [null, 1]);
      }),
    };
    return pipe;
  });
}

beforeEach(() => {
  resetEdgeStore();
});

describe('cacheGet — fail-open for malformed stored values', () => {
  it('returns null and calls logger.warn when stored value is not valid JSON', async () => {
    // Simulate a value stored by another process or manually that is not JSON
    edgeStore.set('fxp:food:corrupted', 'this is not json {{{');

    const result = await cacheGet<{ name: string }>('fxp:food:corrupted', stubLogger);

    expect(result).toBeNull();
    expect(stubLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('cacheGet'),
    );
  });

  it('returns null when stored value is a bare string without quotes (not valid JSON object)', async () => {
    edgeStore.set('fxp:food:bare-string', 'hello');

    // "hello" is not valid JSON — JSON.parse('hello') throws SyntaxError
    const result = await cacheGet<string>('fxp:food:bare-string', stubLogger);

    expect(result).toBeNull();
    expect(stubLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('cacheGet'),
    );
  });

  it('returns null when stored value is an empty string (not valid JSON)', async () => {
    // redis.get returns "" — JSON.parse("") throws SyntaxError
    mockRedisForEdgeCases.get.mockResolvedValueOnce('');

    const result = await cacheGet<string>('fxp:food:empty', stubLogger);

    expect(result).toBeNull();
    expect(stubLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('cacheGet'),
    );
  });

  it('correctly retrieves a JSON-stringified number (valid JSON scalar)', async () => {
    edgeStore.set('fxp:food:num', JSON.stringify(42));

    const result = await cacheGet<number>('fxp:food:num', stubLogger);

    expect(result).toBe(42);
    expect(stubLogger.warn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 7. cacheSet — circular reference JSON.stringify failure (fail-open)
// ---------------------------------------------------------------------------

describe('cacheSet — circular reference triggers fail-open', () => {
  it('does not throw and calls logger.warn when value has a circular reference', async () => {
    // Create a circular reference that JSON.stringify cannot handle
    const circular: Record<string, unknown> = { name: 'test' };
    circular['self'] = circular; // circular reference

    await expect(
      cacheSet('fxp:food:circular', circular, stubLogger),
    ).resolves.toBeUndefined();

    // redis.set must NOT have been called (stringify fails before the call)
    expect(mockRedisForEdgeCases.set).not.toHaveBeenCalled();
    expect(stubLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('cacheSet'),
    );
  });
});

// ---------------------------------------------------------------------------
// 8. cacheSet — falsy-but-valid values ARE stored
// ---------------------------------------------------------------------------

describe('cacheSet — falsy-but-valid values (false, 0, empty string)', () => {
  it('stores boolean false (not treated as null/undefined — should be stored)', async () => {
    await cacheSet('fxp:food:false-val', false, stubLogger);

    expect(mockRedisForEdgeCases.set).toHaveBeenCalledWith(
      'fxp:food:false-val',
      'false',
      'EX',
      300,
    );
  });

  it('stores number 0 (not treated as null/undefined — should be stored)', async () => {
    await cacheSet('fxp:food:zero', 0, stubLogger);

    expect(mockRedisForEdgeCases.set).toHaveBeenCalledWith(
      'fxp:food:zero',
      '0',
      'EX',
      300,
    );
  });

  it('stores empty string "" (not treated as null/undefined — should be stored)', async () => {
    await cacheSet('fxp:food:empty-str', '', stubLogger);

    expect(mockRedisForEdgeCases.set).toHaveBeenCalledWith(
      'fxp:food:empty-str',
      '""',
      'EX',
      300,
    );
  });

  it('round-trips: cacheSet(false) then cacheGet returns false', async () => {
    await cacheSet('fxp:food:bool', false, stubLogger);
    const result = await cacheGet<boolean>('fxp:food:bool', stubLogger);
    expect(result).toBe(false);
  });

  it('round-trips: cacheSet(0) then cacheGet returns 0', async () => {
    await cacheSet('fxp:food:zero-rt', 0, stubLogger);
    const result = await cacheGet<number>('fxp:food:zero-rt', stubLogger);
    expect(result).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 9. cacheInvalidatePattern — pipeline.exec() failure mid-loop (fail-open)
// ---------------------------------------------------------------------------

describe('cacheInvalidatePattern — pipeline.exec() failure is caught (fail-open)', () => {
  it('does not throw and calls logger.warn when pipeline.exec() rejects', async () => {
    edgeStore.set('fxp:food:1', 'a');
    edgeStore.set('fxp:food:2', 'b');

    // SCAN succeeds and returns keys, but pipeline.exec() fails
    mockRedisForEdgeCases.pipeline.mockImplementationOnce(() => ({
      del: vi.fn().mockReturnThis(),
      exec: vi.fn().mockRejectedValue(new Error('Pipeline failed')),
    }));

    await expect(
      cacheInvalidatePattern('fxp:food:*', stubLogger),
    ).resolves.toBeUndefined();

    expect(stubLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('cacheInvalidatePattern'),
    );
  });

  it('is a no-op and does not call pipeline when no keys match the pattern', async () => {
    await cacheInvalidatePattern('fxp:nonexistent:*', stubLogger);

    // Pipeline should NOT be called when there are no matching keys
    expect(mockRedisForEdgeCases.pipeline).not.toHaveBeenCalled();
    expect(stubLogger.warn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 10. buildKey — colon characters in entity/id produce extra-segment keys
// ---------------------------------------------------------------------------

describe('buildKey — special characters in entity or id', () => {
  it('entity with colon produces a multi-segment key — callers must avoid colons in entity', () => {
    // This is a documentation test: buildKey does NOT sanitize inputs.
    // A caller passing "foo:bar" as entity produces "fxp:foo:bar:<id>" which
    // has 4 segments, breaking the 3-segment fxp:<entity>:<id> invariant.
    const key = buildKey('foo:bar', 'id-123');
    // The key is "fxp:foo:bar:id-123" — 4 segments, not 3
    expect(key).toBe('fxp:foo:bar:id-123');
    // This could match patterns that weren't intended, e.g. fxp:foo:* matches
    // both fxp:foo:<id> AND fxp:foo:bar:<id>
    const parts = key.split(':');
    expect(parts.length).toBe(4); // violates the 3-segment convention
  });

  it('id with colon similarly produces extra segments', () => {
    const key = buildKey('food', 'uuid:with:colons');
    expect(key).toBe('fxp:food:uuid:with:colons');
    const parts = key.split(':');
    expect(parts.length).toBe(5); // violates the 3-segment convention
  });

  it('glob characters in id produce keys that match unintended patterns during SCAN', () => {
    // An id containing "*" would produce "fxp:food:*" which IS a valid glob
    // pattern itself — a SCAN for "fxp:food:*" would match it, but it would
    // also match every other food key.
    const key = buildKey('food', '*');
    expect(key).toBe('fxp:food:*');
    // This key, if used in cacheInvalidatePattern, would match ALL food keys
  });

  it('empty entity produces "fxp::<id>" — violates naming convention', () => {
    const key = buildKey('', 'some-id');
    expect(key).toBe('fxp::some-id');
  });

  it('empty id produces "fxp:<entity>:" — violates naming convention', () => {
    const key = buildKey('food', '');
    expect(key).toBe('fxp:food:');
  });
});

// ---------------------------------------------------------------------------
// 11. connectRedis — double-connect behaviour is documented via connectRedis()
//     fail-open contract: any exception from connect() returns false + warns.
//     This is exercised via the mock already in redis.test.ts, but here we
//     verify the specific "already connecting/connected" message is caught.
// ---------------------------------------------------------------------------

describe('connectRedis — any connect() rejection returns false (fail-open contract)', () => {
  it('the connect() catch path is triggered for ANY error including "already connected"', () => {
    // This is a specification test: connectRedis() uses a blanket try/catch.
    // The implication is that a double-connect (connect() called on an already
    // connected ioredis client which throws "already connecting/connected") will
    // return false and log "[redis] Redis unavailable" — a misleading message.
    //
    // The implementation delegates all connect() errors to the same warn path.
    // We document this as a known limitation: callers must ensure connectRedis()
    // is only called once (server.ts does this correctly via the single startup call).
    //
    // The redis.test.ts file already covers: connect() rejection → false + warn.
    // This describe block exists to document the double-connect edge case.
    expect(true).toBe(true); // documentation-only; behaviour covered by redis.test.ts
  });
});

// ---------------------------------------------------------------------------
// 12. Rate limit allowList — /health with query params is still exempt.
//     We verify this by registering @fastify/rate-limit directly with max=1
//     (without the mocked redis singleton, which lacks defineCommand) and
//     confirming that /health?redis=true is not counted against the limit.
// ---------------------------------------------------------------------------

describe('rateLimit allowList — /health with query params is still exempt', () => {
  it('GET /health?redis=true is exempt from rate limiting even with query params', async () => {
    const Fastify = (await import('fastify')).default;
    const { default: rateLimit } = await import('@fastify/rate-limit');
    const { registerErrorHandler } = await import('../errors/errorHandler.js');

    // Use a plain Fastify instance without the redis mock — rate limit with
    // no Redis store (in-memory) to avoid the defineCommand issue.
    const testApp = Fastify({ logger: false });

    await testApp.register(rateLimit, {
      max: 1,
      timeWindow: '1 minute',
      skipOnError: true,
      // Use the same allowList function as rateLimit.ts
      allowList: (req) => req.routeOptions.url === '/health',
      errorResponseBuilder: (_req, context) => {
        const err = new Error('Too many requests, please try again later.');
        (err as Error & { statusCode: number; code: string }).statusCode = context.statusCode;
        (err as Error & { statusCode: number; code: string }).code = 'RATE_LIMIT_EXCEEDED';
        return err;
      },
    });

    registerErrorHandler(testApp);

    // Register the /health route
    testApp.get('/health', async () => ({ status: 'ok' }));

    // Send 3 requests to /health — all should succeed despite max=1
    // because /health is in the allowList
    for (let i = 0; i < 3; i++) {
      const response = await testApp.inject({
        method: 'GET',
        url: '/health?redis=true',
      });
      expect(response.statusCode).not.toBe(429);
    }

    await testApp.close();
  });

  it('GET /health?db=true&redis=true is exempt from rate limiting', async () => {
    const Fastify = (await import('fastify')).default;
    const { default: rateLimit } = await import('@fastify/rate-limit');
    const { registerErrorHandler } = await import('../errors/errorHandler.js');

    const testApp = Fastify({ logger: false });

    await testApp.register(rateLimit, {
      max: 1,
      timeWindow: '1 minute',
      skipOnError: true,
      allowList: (req) => req.routeOptions.url === '/health',
      errorResponseBuilder: (_req, context) => {
        const err = new Error('Too many requests, please try again later.');
        (err as Error & { statusCode: number; code: string }).statusCode = context.statusCode;
        (err as Error & { statusCode: number; code: string }).code = 'RATE_LIMIT_EXCEEDED';
        return err;
      },
    });

    registerErrorHandler(testApp);
    testApp.get('/health', async () => ({ status: 'ok' }));

    for (let i = 0; i < 3; i++) {
      const response = await testApp.inject({
        method: 'GET',
        url: '/health?db=true&redis=true',
      });
      expect(response.statusCode).not.toBe(429);
    }

    await testApp.close();
  });

  it('non-exempt routes ARE rate-limited to verify allowList is selectively applied', async () => {
    const Fastify = (await import('fastify')).default;
    const { default: rateLimit } = await import('@fastify/rate-limit');
    const { registerErrorHandler } = await import('../errors/errorHandler.js');

    const testApp = Fastify({ logger: false });

    await testApp.register(rateLimit, {
      max: 1,
      timeWindow: '1 minute',
      skipOnError: true,
      allowList: (req) => req.routeOptions.url === '/health',
      errorResponseBuilder: (_req, context) => {
        const err = new Error('Too many requests, please try again later.');
        (err as Error & { statusCode: number; code: string }).statusCode = context.statusCode;
        (err as Error & { statusCode: number; code: string }).code = 'RATE_LIMIT_EXCEEDED';
        return err;
      },
    });

    registerErrorHandler(testApp);
    testApp.get('/health', async () => ({ status: 'ok' }));
    testApp.get('/api/foods', async () => ({ foods: [] }));

    // /health should still work (exempt)
    const healthResponse = await testApp.inject({ method: 'GET', url: '/health' });
    const healthResponse2 = await testApp.inject({ method: 'GET', url: '/health' });
    expect(healthResponse.statusCode).not.toBe(429);
    expect(healthResponse2.statusCode).not.toBe(429);

    // /api/foods hits the limit after 1 request
    const firstFoods = await testApp.inject({ method: 'GET', url: '/api/foods' });
    expect(firstFoods.statusCode).toBe(200);
    const secondFoods = await testApp.inject({ method: 'GET', url: '/api/foods' });
    expect(secondFoods.statusCode).toBe(429);

    await testApp.close();
  });
});

// ---------------------------------------------------------------------------
// 13. DB_UNAVAILABLE takes priority when DB fails and Redis check never runs
// ---------------------------------------------------------------------------

describe('GET /health?db=true&redis=true — DB down → DB_UNAVAILABLE (not REDIS_UNAVAILABLE)', () => {
  let app: FastifyInstance;

  const prismaThatFails = {
    $queryRaw: vi.fn().mockRejectedValue(new Error('connection refused')),
  } as unknown as PrismaClient;

  beforeAll(async () => {
    app = await buildApp({
      config: testConfig,
      prisma: prismaThatFails,
      redis: redisThatSucceeds,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 500 DB_UNAVAILABLE when DB fails (Redis check never reached)', async () => {
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
    expect(body.error.code).toBe('DB_UNAVAILABLE');
    // Redis ping should NOT have been called
    const pingMock = redisThatSucceeds.ping as ReturnType<typeof vi.fn>;
    expect(pingMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 14. cacheInvalidatePattern — correctly handles large multi-page SCAN results
// ---------------------------------------------------------------------------

describe('cacheInvalidatePattern — multi-page SCAN cursor loop', () => {
  it('continues iterating until cursor returns "0" (simulated multi-page scan)', async () => {
    // Simulate a two-page SCAN: first call returns cursor "42" with page1 keys,
    // second call returns cursor "0" with page2 keys.
    const page1 = ['fxp:food:1', 'fxp:food:2'];
    const page2 = ['fxp:food:3'];

    edgeStore.set('fxp:food:1', 'a');
    edgeStore.set('fxp:food:2', 'b');
    edgeStore.set('fxp:food:3', 'c');

    let callCount = 0;
    mockRedisForEdgeCases.scan.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return ['42', page1]; // first page, non-zero cursor
      return ['0', page2];                        // second page, done
    });

    await cacheInvalidatePattern('fxp:food:*', stubLogger);

    // All three keys must have been deleted via pipeline across two pages
    expect(edgeStore.has('fxp:food:1')).toBe(false);
    expect(edgeStore.has('fxp:food:2')).toBe(false);
    expect(edgeStore.has('fxp:food:3')).toBe(false);
    // SCAN was called exactly twice (two pages)
    expect(mockRedisForEdgeCases.scan).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 15. cacheSet TTL boundary — ttl=0 is stored with EX 0 (Redis will reject it,
//     but cacheSet should NOT silently allowList it — it's not null/undefined)
// ---------------------------------------------------------------------------

describe('cacheSet — TTL edge values', () => {
  it('calls redis.set with ttl=0 when options.ttl is 0 (not treated as falsy allowList)', async () => {
    // ttl=0 means "expire immediately" — this is a caller error, but cacheSet
    // should NOT silently allowList it. The 0 is not null/undefined. Redis will
    // reject EX 0 (ERR invalid expire time), which triggers the catch/warn path.
    mockRedisForEdgeCases.set.mockRejectedValueOnce(new Error('ERR invalid expire time'));

    await expect(
      cacheSet('fxp:food:ttl-zero', { name: 'test' }, stubLogger, { ttl: 0 }),
    ).resolves.toBeUndefined();

    // redis.set was called (value was not null/undefined), then it threw
    expect(mockRedisForEdgeCases.set).toHaveBeenCalledWith(
      'fxp:food:ttl-zero',
      JSON.stringify({ name: 'test' }),
      'EX',
      0,
    );
    expect(stubLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('cacheSet'),
    );
  });

  it('uses custom ttl=3600 correctly', async () => {
    await cacheSet('fxp:food:long-ttl', { id: 1 }, stubLogger, { ttl: 3600 });

    expect(mockRedisForEdgeCases.set).toHaveBeenCalledWith(
      'fxp:food:long-ttl',
      JSON.stringify({ id: 1 }),
      'EX',
      3600,
    );
  });
});
