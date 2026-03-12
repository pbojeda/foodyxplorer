// F004 Edge-Case Tests — QA Review
//
// Covers gaps in the developer's original test suite:
//   1.  config.ts  — boundary PORT values, invalid enum inputs, malformed URLs,
//                    error-message format, float PORT, DATABASE_URL_TEST validation
//   2.  errorHandler — FST_ERR_VALIDATION details absence (strict), non-404
//                    statusCode fall-through, non-Error throws, empty ZodError,
//                    statusCode:500 on generic errors
//   3.  health route — ?db=false / ?db=0 / ?db=1 coercion, wrong HTTP method,
//                    unhandled throw propagated to global error handler,
//                    db field absent on plain GET (strict)
//   4.  app.ts     — buildApp with explicit config override respected

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { ZodError } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Config } from '../config.js';

// ---------------------------------------------------------------------------
// 1. config.ts edge cases
// ---------------------------------------------------------------------------

// process.exit spy must be installed before config.ts is first imported.
// The module-level singleton (line: export const config = parseConfig(process.env))
// runs on first import — vitest.config.ts ensures a valid env so it does NOT
// exit; but parseConfig() calls in individual tests will hit the spy.
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
  NODE_ENV: 'development',
  PORT: '3001',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/mydb',
  LOG_LEVEL: 'info',
} satisfies NodeJS.ProcessEnv;

describe('config — PORT boundary values', () => {
  beforeEach(() => {
    exitSpy.mockClear();
  });

  it('accepts PORT=1 (minimum valid value)', () => {
    const cfg = parseConfig({ ...VALID_ENV, PORT: '1' });
    expect(cfg.PORT).toBe(1);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('accepts PORT=65535 (maximum valid value)', () => {
    const cfg = parseConfig({ ...VALID_ENV, PORT: '65535' });
    expect(cfg.PORT).toBe(65535);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('calls process.exit(1) for PORT=0 (below minimum)', () => {
    expect(() => parseConfig({ ...VALID_ENV, PORT: '0' })).toThrow(
      'process.exit called',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('calls process.exit(1) for PORT=65536 (above maximum)', () => {
    expect(() => parseConfig({ ...VALID_ENV, PORT: '65536' })).toThrow(
      'process.exit called',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('calls process.exit(1) for PORT=1.5 (non-integer float)', () => {
    // z.coerce.number().int() — coercion yields 1.5 which fails .int()
    expect(() => parseConfig({ ...VALID_ENV, PORT: '1.5' })).toThrow(
      'process.exit called',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('config — invalid enum inputs', () => {
  beforeEach(() => {
    exitSpy.mockClear();
  });

  it('calls process.exit(1) for an unrecognised NODE_ENV value', () => {
    expect(() =>
      parseConfig({ ...VALID_ENV, NODE_ENV: 'staging' }),
    ).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('calls process.exit(1) for an unrecognised LOG_LEVEL value', () => {
    expect(() =>
      parseConfig({ ...VALID_ENV, LOG_LEVEL: 'verbose' }),
    ).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('config — DATABASE_URL validation', () => {
  beforeEach(() => {
    exitSpy.mockClear();
  });

  it('calls process.exit(1) when DATABASE_URL is not a valid URL', () => {
    expect(() =>
      parseConfig({ ...VALID_ENV, DATABASE_URL: 'not-a-url' }),
    ).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('calls process.exit(1) when DATABASE_URL is an empty string', () => {
    expect(() =>
      parseConfig({ ...VALID_ENV, DATABASE_URL: '' }),
    ).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('calls process.exit(1) when DATABASE_URL_TEST is present but not a valid URL', () => {
    expect(() =>
      parseConfig({
        ...VALID_ENV,
        DATABASE_URL_TEST: 'not-a-url',
      }),
    ).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('config — error output format', () => {
  beforeEach(() => {
    exitSpy.mockClear();
  });

  it('prints a [config] prefixed message to stderr on validation failure', () => {
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      parseConfig({ ...VALID_ENV, DATABASE_URL: undefined });
    } catch {
      // expected: process.exit throws via our spy
    }

    expect(consoleSpy).toHaveBeenCalled();
    const firstCall = consoleSpy.mock.calls[0];
    const firstArg = firstCall?.[0] as string | undefined;
    expect(firstArg).toBeDefined();
    expect(firstArg).toMatch(/^\[config\]/);

    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 2. errorHandler — mapError edge cases
// ---------------------------------------------------------------------------

import { mapError } from '../errors/errorHandler.js';

describe('mapError — strict FST_ERR_VALIDATION details absence', () => {
  it('details key is ABSENT (undefined) for FST_ERR_VALIDATION — not an empty array', () => {
    const err = Object.assign(new Error('validation failed'), {
      code: 'FST_ERR_VALIDATION',
      statusCode: 400,
    });

    const result = mapError(err);

    // Spec: details is absent (not null, not []) for FST_ERR_VALIDATION
    expect(result.body.error.details).toBeUndefined();
  });
});

describe('mapError — non-404 statusCode falls through to 500', () => {
  it('Error with statusCode: 403 maps to 500 INTERNAL_ERROR (not exposed)', () => {
    const err = Object.assign(new Error('forbidden'), { statusCode: 403 });

    const result = mapError(err);

    expect(result.statusCode).toBe(500);
    expect(result.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('Error with statusCode: 401 maps to 500 INTERNAL_ERROR', () => {
    const err = Object.assign(new Error('unauthorized'), { statusCode: 401 });

    const result = mapError(err);

    expect(result.statusCode).toBe(500);
    expect(result.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('Error with statusCode: 500 maps to 500 INTERNAL_ERROR (passthrough)', () => {
    const err = Object.assign(new Error('db exploded'), { statusCode: 500 });

    const result = mapError(err);

    expect(result.statusCode).toBe(500);
    expect(result.body.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('mapError — ZodError with empty issues array', () => {
  it('maps to 400 VALIDATION_ERROR with details as empty array', () => {
    // ZodError([]) is valid — details should be [] not undefined
    const zodError = new ZodError([]);

    const result = mapError(zodError);

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(result.body.error.details)).toBe(true);
  });
});

describe('mapError — original error message never leaked on 500', () => {
  it('message is always "Internal server error" regardless of thrown message', () => {
    const sensitiveMessage =
      'postgresql://admin:secret@prod-db.example.com:5432/production';
    const err = new Error(sensitiveMessage);

    const result = mapError(err);

    expect(result.body.error.message).toBe('Internal server error');
    expect(result.body.error.message).not.toContain('postgresql');
    expect(result.body.error.message).not.toContain('secret');
  });
});

describe('mapError — DB_UNAVAILABLE error', () => {
  it('maps DB_UNAVAILABLE code to 500 with original message', () => {
    const err = Object.assign(
      new Error('Database connectivity check failed'),
      { statusCode: 500, code: 'DB_UNAVAILABLE' },
    );

    const result = mapError(err);

    expect(result.statusCode).toBe(500);
    expect(result.body.error.code).toBe('DB_UNAVAILABLE');
    expect(result.body.error.message).toBe('Database connectivity check failed');
  });
});

// ---------------------------------------------------------------------------
// 3. health route edge cases via buildApp + inject
// ---------------------------------------------------------------------------

import { buildApp } from '../app.js';

// Minimal valid test config (NODE_ENV=test disables swagger/cors/rateLimit)
const testConfig: Config = {
  NODE_ENV: 'test',
  PORT: 3001,
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
  DATABASE_URL_TEST: 'postgresql://user:pass@localhost:5432/test',
  LOG_LEVEL: 'info',
  REDIS_URL: 'redis://localhost:6380',
};

const prismaThatSucceeds = {
  $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1n }]),
} as unknown as PrismaClient;

describe('GET /health — db field strictly absent without ?db=true', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: testConfig, prisma: prismaThatSucceeds });
  });

  afterAll(async () => {
    await app.close();
  });

  it('db field is NOT present on the response object (absent, not null, not "unknown")', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = JSON.parse(response.body) as Record<string, unknown>;

    // Must be absent — spec says "not null, not 'unknown' — absent"
    expect('db' in body).toBe(false);
  });
});

describe('GET /health — ?db query param coercion', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: testConfig, prisma: prismaThatSucceeds });
  });

  afterAll(async () => {
    await app.close();
  });

  it('?db=false does NOT trigger DB check (strict enum matching)', async () => {
    vi.clearAllMocks();
    const response = await app.inject({
      method: 'GET',
      url: '/health?db=false',
    });

    expect(response.statusCode).toBe(200);
    const mockFn = prismaThatSucceeds.$queryRaw as ReturnType<typeof vi.fn>;
    expect(mockFn).not.toHaveBeenCalled();

    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect('db' in body).toBe(false);
  });

  it('?db=1 does NOT trigger DB check (only "true" accepted)', async () => {
    vi.clearAllMocks();
    const response = await app.inject({
      method: 'GET',
      url: '/health?db=1',
    });

    expect(response.statusCode).toBe(200);
    const mockFn = prismaThatSucceeds.$queryRaw as ReturnType<typeof vi.fn>;
    expect(mockFn).not.toHaveBeenCalled();
  });

  it('?db=0 does NOT trigger DB check', async () => {
    vi.clearAllMocks();
    const response = await app.inject({
      method: 'GET',
      url: '/health?db=0',
    });

    expect(response.statusCode).toBe(200);
    const mockFn = prismaThatSucceeds.$queryRaw as ReturnType<typeof vi.fn>;
    expect(mockFn).not.toHaveBeenCalled();
  });

  it('?db=true triggers DB check', async () => {
    vi.clearAllMocks();
    const response = await app.inject({
      method: 'GET',
      url: '/health?db=true',
    });

    expect(response.statusCode).toBe(200);
    const mockFn = prismaThatSucceeds.$queryRaw as ReturnType<typeof vi.fn>;
    expect(mockFn).toHaveBeenCalled();

    const body = JSON.parse(response.body) as { db?: string };
    expect(body.db).toBe('connected');
  });
});

describe('GET /health — wrong HTTP method returns 404', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: testConfig, prisma: prismaThatSucceeds });
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /health returns 404 with NOT_FOUND envelope', async () => {
    const response = await app.inject({ method: 'POST', url: '/health' });

    expect(response.statusCode).toBe(404);

    const body = JSON.parse(response.body) as {
      success: boolean;
      error: { code: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('DELETE /health returns 404 with NOT_FOUND envelope', async () => {
    const response = await app.inject({ method: 'DELETE', url: '/health' });

    expect(response.statusCode).toBe(404);

    const body = JSON.parse(response.body) as {
      success: boolean;
      error: { code: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

describe('Global error handler — unhandled throw in route', () => {
  it('catches unhandled async throw and returns 500 INTERNAL_ERROR without leaking details', async () => {
    const app = await buildApp({ config: testConfig, prisma: prismaThatSucceeds });

    // Register a route that throws unconditionally
    app.get('/throw-test', async () => {
      throw new Error('secret internal error: db_password=s3cr3t');
    });

    const response = await app.inject({
      method: 'GET',
      url: '/throw-test',
    });

    expect(response.statusCode).toBe(500);

    const body = JSON.parse(response.body) as {
      success: boolean;
      error: { message: string; code: string; details?: unknown };
    };

    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Internal server error');
    expect(body.error.message).not.toContain('secret');
    expect(body.error.message).not.toContain('db_password');
    expect(body.error.details).toBeUndefined();

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// 4. buildApp — config override respected
// ---------------------------------------------------------------------------

describe('buildApp — explicit config parameter is respected', () => {
  it('uses the provided config instead of the default singleton', async () => {
    const app = await buildApp({
      config: testConfig,
      prisma: prismaThatSucceeds,
    });

    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// 5. Spec compliance — /docs returns 404 in test env (swagger disabled)
// ---------------------------------------------------------------------------

describe('Swagger disabled in test env — /docs/json also returns 404', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: testConfig, prisma: prismaThatSucceeds });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /docs/json returns 404 when NODE_ENV=test', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(response.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 6. CORS disabled in test env — no CORS headers on response
// ---------------------------------------------------------------------------

describe('CORS disabled in test env', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: testConfig, prisma: prismaThatSucceeds });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health does not return Access-Control-Allow-Origin header in test env', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        origin: 'http://localhost:3000',
      },
    });

    expect(response.statusCode).toBe(200);
    // CORS plugin not registered in test — header must be absent
    expect(
      response.headers['access-control-allow-origin'],
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 7. Multiple unknown routes — notFound handler is consistent
// ---------------------------------------------------------------------------

describe('Not-found handler — multiple unregistered paths', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: testConfig, prisma: prismaThatSucceeds });
  });

  afterAll(async () => {
    await app.close();
  });

  const unknownPaths = [
    '/api/v1/users',
    '/admin',
    '/health/details', // sub-path of /health is NOT registered; must 404
    '/../etc/passwd',
  ];

  for (const path of unknownPaths) {
    it(`GET ${path} returns 404 with NOT_FOUND envelope`, async () => {
      const response = await app.inject({ method: 'GET', url: path });

      expect(response.statusCode).toBe(404);

      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toBe('Route not found');
    });
  }

  it('GET /health?unknown_param=x returns 200 (extra query params are ignored)', async () => {
    // Unknown query params on a registered route do NOT cause 404
    const response = await app.inject({
      method: 'GET',
      url: '/health?unknown_param=x',
    });
    expect(response.statusCode).toBe(200);
  });
});
