// F030-lite integration tests — Sentry forwarding from the Fastify error
// handler.
//
// Strategy:
//   - Mock the LOCAL `../lib/sentry.js` wrapper (NOT @sentry/node) so we
//     assert the wrapper contract that production code uses. This avoids
//     mirroring the SDK surface.
//   - Boot the app via `buildApp` with a minimal test config so all
//     Fastify plugins register and the real `registerErrorHandler` wiring
//     runs end-to-end.
//   - Register one-off stub routes per test that intentionally throw, so
//     we don't depend on real route business logic.

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Config } from '../config.js';

vi.mock('../lib/sentry.js', () => ({
  captureException: vi.fn(),
  hashActor: vi.fn(() => 'fakeHash'),
  initSentry: vi.fn(),
}));

// Import the mocked module by re-importing so we get typed references.
import * as sentry from '../lib/sentry.js';
import { buildApp } from '../app.js';

const mockedCapture = sentry.captureException as ReturnType<typeof vi.fn>;
const mockedHashActor = sentry.hashActor as ReturnType<typeof vi.fn>;

const testConfig: Config = {
  NODE_ENV: 'test',
  PORT: 3001,
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
  DATABASE_URL_TEST: 'postgresql://user:pass@localhost:5432/test',
  LOG_LEVEL: 'fatal', // silence error logging in this test suite
  REDIS_URL: 'redis://localhost:6380',
};

const prismaStub = {
  $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1n }]),
} as unknown as PrismaClient;

describe('F030-lite — errorHandler → Sentry forwarding', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: testConfig, prisma: prismaStub });

    // Register stub routes that exercise each error path. Using POST/GET on
    // distinct paths so they don't collide with existing routes.
    app.get('/_test/throw-500', () => {
      throw new Error('boom from test');
    });
    app.get('/_test/throw-400', () => {
      // Throw a Fastify-style validation error — mapError recognizes
      // `code === 'FST_ERR_VALIDATION'` and returns 400.
      const err = new Error('bad input from test') as Error & { code: string; statusCode: number };
      err.code = 'FST_ERR_VALIDATION';
      err.statusCode = 400;
      throw err;
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockedCapture.mockClear();
    mockedHashActor.mockClear();
  });

  // -------------------------------------------------------------------------

  it('1. 500 — forwards to captureException with allowlisted SentryContext shape', async () => {
    const response = await app.inject({ method: 'GET', url: '/_test/throw-500' });

    expect(response.statusCode).toBe(500);
    expect(mockedCapture).toHaveBeenCalledTimes(1);

    const [forwardedErr, ctx] = mockedCapture.mock.calls[0] ?? [];
    expect(forwardedErr).toBeInstanceOf(Error);
    expect((forwardedErr as Error).message).toBe('boom from test');

    // Allowlisted context shape — no body, no headers, no raw actorId.
    const ctxKeys = Object.keys(ctx as object).sort();
    expect(ctxKeys).toEqual([
      'actorIdHash',
      'internalCode',
      'method',
      'requestId',
      'route',
      'statusCode',
    ]);
    expect((ctx as Record<string, unknown>).route).toBe('/_test/throw-500');
    expect((ctx as Record<string, unknown>).method).toBe('GET');
    expect((ctx as Record<string, unknown>).statusCode).toBe(500);
    expect((ctx as Record<string, unknown>).internalCode).toBe('INTERNAL_ERROR');
    expect((ctx as Record<string, unknown>).actorIdHash).toBe('fakeHash');
    expect(typeof (ctx as Record<string, unknown>).requestId).toBe('string');
  });

  // -------------------------------------------------------------------------

  it('2. 400 — does NOT forward to captureException', async () => {
    const response = await app.inject({ method: 'GET', url: '/_test/throw-400' });

    expect(response.statusCode).toBe(400);
    expect(mockedCapture).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------

  it('3. 404 — setNotFoundHandler does NOT forward to captureException', async () => {
    const response = await app.inject({ method: 'GET', url: '/_test/nonexistent-route-xyz' });

    expect(response.statusCode).toBe(404);
    expect(mockedCapture).not.toHaveBeenCalled();
  });
});
