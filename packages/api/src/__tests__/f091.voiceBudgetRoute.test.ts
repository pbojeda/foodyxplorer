// F091 — Integration tests for GET /health/voice-budget
//
// Tests Redis hit / miss / error scenarios and Cache-Control header.
// Pattern: health.test.ts — buildApp() + inject() with injected Redis mock.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { buildApp } from '../app.js';

// ---------------------------------------------------------------------------
// Prisma mock (minimal — health route doesn't query DB)
// ---------------------------------------------------------------------------

const mockPrisma = {
  actor: { upsert: vi.fn().mockResolvedValue({ id: 'actor-1', externalId: 'anon-test', tier: null }) },
  apiKey: { findUnique: vi.fn().mockResolvedValue(null) },
  queryLog: { create: vi.fn().mockResolvedValue({}) },
} as unknown as PrismaClient;

// ---------------------------------------------------------------------------
// Redis mock factory
// ---------------------------------------------------------------------------

function buildRedisMock(getResult: string | null) {
  return {
    get: vi.fn().mockResolvedValue(getResult),
    incr: vi.fn().mockResolvedValue(1),
    incrby: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    set: vi.fn().mockResolvedValue('OK'),
    ping: vi.fn().mockResolvedValue('PONG'),
    eval: vi.fn().mockResolvedValue(null),
  } as unknown as Redis;
}

function buildFailingRedisMock() {
  return {
    get: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    incr: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    incrby: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    expire: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    set: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    ping: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    eval: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
  } as unknown as Redis;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBudgetData(exhausted: boolean, spendEur: number) {
  return JSON.stringify({
    exhausted,
    spendEur,
    capEur: 100,
    alertLevel: exhausted ? 'cap' : 'none',
    monthKey: '2026-04',
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /health/voice-budget', () => {
  // -------------------------------------------------------------------------
  // Redis hit — full VoiceBudgetData
  // -------------------------------------------------------------------------

  describe('Redis hit', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      const redis = buildRedisMock(makeBudgetData(false, 35.5));
      app = await buildApp({ prisma: mockPrisma, redis });
    });

    afterAll(async () => {
      await app.close();
    });

    it('returns 200 with correct VoiceBudgetData shape', async () => {
      const response = await app.inject({ method: 'GET', url: '/health/voice-budget' });
      expect(response.statusCode).toBe(200);

      const body = response.json<Record<string, unknown>>();
      expect(typeof body['exhausted']).toBe('boolean');
      expect(typeof body['spendEur']).toBe('number');
      expect(typeof body['capEur']).toBe('number');
      expect(typeof body['alertLevel']).toBe('string');
      expect(typeof body['monthKey']).toBe('string');
    });

    it('returns spendEur and exhausted values from Redis', async () => {
      const response = await app.inject({ method: 'GET', url: '/health/voice-budget' });
      const body = response.json<{ spendEur: number; exhausted: boolean }>();
      expect(body.spendEur).toBe(35.5);
      expect(body.exhausted).toBe(false);
    });

    it('includes Cache-Control: public, max-age=60 header', async () => {
      const response = await app.inject({ method: 'GET', url: '/health/voice-budget' });
      expect(response.headers['cache-control']).toBe('public, max-age=60');
    });
  });

  // -------------------------------------------------------------------------
  // Redis miss (key doesn't exist) — fail-open response
  // -------------------------------------------------------------------------

  describe('Redis miss (null)', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      const redis = buildRedisMock(null);
      app = await buildApp({ prisma: mockPrisma, redis });
    });

    afterAll(async () => {
      await app.close();
    });

    it('returns 200 with exhausted: false on Redis miss (fail-open)', async () => {
      const response = await app.inject({ method: 'GET', url: '/health/voice-budget' });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ exhausted: boolean; spendEur: number }>();
      expect(body.exhausted).toBe(false);
      expect(body.spendEur).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Redis error — fail-open response
  // -------------------------------------------------------------------------

  describe('Redis error', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      const redis = buildFailingRedisMock();
      app = await buildApp({ prisma: mockPrisma, redis });
    });

    afterAll(async () => {
      await app.close();
    });

    it('returns 200 with exhausted: false when Redis throws (fail-open)', async () => {
      const response = await app.inject({ method: 'GET', url: '/health/voice-budget' });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ exhausted: boolean }>();
      expect(body.exhausted).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Exhausted budget
  // -------------------------------------------------------------------------

  describe('exhausted budget', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      const redis = buildRedisMock(makeBudgetData(true, 102.3));
      app = await buildApp({ prisma: mockPrisma, redis });
    });

    afterAll(async () => {
      await app.close();
    });

    it('returns exhausted: true when budget is exhausted', async () => {
      const response = await app.inject({ method: 'GET', url: '/health/voice-budget' });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ exhausted: boolean; alertLevel: string }>();
      expect(body.exhausted).toBe(true);
      expect(body.alertLevel).toBe('cap');
    });
  });
});
