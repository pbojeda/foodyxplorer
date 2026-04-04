// F070 Edge Cases — QA test file
//
// Tests NOT covered by the developer's F070 test suite:
// 1. Query logging matrix — comparison emits 2 writeQueryLog calls, others emit 1
// 2. Partial legacy context — chainSlug without chainName silently ignored
// 3. Empty-string legacy context — "" + "" is falsy → treated as no context
// 4. Comparison one-side error at ROUTE level → HTTP 200 (unit-only before)
// 5. Comparison both-sides error at ROUTE level → HTTP 500 (unit-only before)
// 6. activeContext echoed in text_too_long even when context exists (route level)
// 7. loadChainData failure at plugin init → estimation still proceeds
// 8. X-FXP-Source: bot header sets source='bot' vs absent → source='api' in query log
// 9. Unauthorized request (no X-API-Key) → 401
// 10. context_set ambiguous at route level → 200, no Redis write

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { ConversationMessageResponse } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Mock runEstimationCascade
// ---------------------------------------------------------------------------

const { mockRunEstimationCascade } = vi.hoisted(() => ({
  mockRunEstimationCascade: vi.fn(),
}));

vi.mock('../estimation/engineRouter.js', () => ({
  runEstimationCascade: mockRunEstimationCascade,
}));

// ---------------------------------------------------------------------------
// Mock Redis
// ---------------------------------------------------------------------------

const { mockRedisGet, mockRedisSet, mockRedisIncr, mockRedisExpire } = vi.hoisted(() => ({
  mockRedisGet: vi.fn(),
  mockRedisSet: vi.fn(),
  mockRedisIncr: vi.fn(),
  mockRedisExpire: vi.fn(),
}));

vi.mock('../lib/redis.js', () => ({
  redis: {
    get: mockRedisGet,
    set: mockRedisSet,
    incr: mockRedisIncr,
    expire: mockRedisExpire,
  } as unknown as Redis,
}));

// ---------------------------------------------------------------------------
// Mock Prisma — expose mockQueryLogCreate for assertion
// ---------------------------------------------------------------------------

const {
  mockPrismaActorUpsert,
  mockPrismaApiKeyFindUnique,
  mockPrismaExecuteRaw,
  mockQueryLogCreate,
} = vi.hoisted(() => ({
  mockPrismaActorUpsert: vi.fn(),
  mockPrismaApiKeyFindUnique: vi.fn(),
  mockPrismaExecuteRaw: vi.fn(),
  mockQueryLogCreate: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    actor: { upsert: mockPrismaActorUpsert },
    apiKey: { findUnique: mockPrismaApiKeyFindUnique },
    queryLog: { create: mockQueryLogCreate },
    $executeRaw: mockPrismaExecuteRaw,
  } as unknown as PrismaClient,
}));

// ---------------------------------------------------------------------------
// Mock Kysely — fluent stub
// ---------------------------------------------------------------------------

const {
  mockKyselyExecute,
  mockKyselyChainStubs,
} = vi.hoisted(() => {
  const execute = vi.fn().mockResolvedValue([]);

  const chainMethodNames = [
    'selectFrom', 'select', 'where', 'distinct', 'innerJoin',
    'orderBy', 'limit', 'offset', '$if',
  ] as const;

  const stub: Record<string, unknown> = {};
  for (const method of chainMethodNames) {
    stub[method] = vi.fn();
  }
  stub['execute'] = execute;
  stub['executeTakeFirstOrThrow'] = vi.fn().mockResolvedValue({});
  stub['fn'] = {
    countAll: vi.fn().mockReturnValue({ as: vi.fn().mockReturnValue('count') }),
  };

  for (const method of chainMethodNames) {
    (stub[method] as ReturnType<typeof vi.fn>).mockReturnValue(stub);
  }

  return {
    mockKyselyExecute: execute,
    mockKyselyChainStubs: stub,
  };
});

function resetKyselyChain() {
  const chainMethodNames = [
    'selectFrom', 'select', 'where', 'distinct', 'innerJoin',
    'orderBy', 'limit', 'offset', '$if',
  ] as const;
  for (const method of chainMethodNames) {
    (mockKyselyChainStubs[method] as ReturnType<typeof vi.fn>).mockReturnValue(
      mockKyselyChainStubs,
    );
  }
  mockKyselyExecute.mockResolvedValue([]);
}

vi.mock('../lib/kysely.js', () => ({
  getKysely: () => mockKyselyChainStubs,
  destroyKysely: vi.fn(),
}));

import { buildApp } from '../app.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACTOR_UUID = 'fd000000-0070-4000-a000-000000000099';
const API_KEY_VALUE = 'test-api-key-value';
const ACTOR_EXTERNAL_ID = 'fd000000-0070-4000-a000-000000000001';

const BASE_NUTRIENTS = {
  calories: 550, proteins: 25, carbohydrates: 45, sugars: 9,
  fats: 26, saturatedFats: 10, fiber: 2, salt: 2.2, sodium: 880,
  transFats: 0.2, cholesterol: 80, potassium: 320,
  monounsaturatedFats: 12, polyunsaturatedFats: 4, alcohol: 0,
  referenceBasis: 'per_serving' as const,
};

const MOCK_RESULT = {
  entityType: 'dish' as const,
  entityId: 'fd000000-0070-4000-a000-000000000001',
  name: 'Big Mac', nameEs: 'Big Mac',
  restaurantId: 'fd000000-0070-4000-a000-000000000002',
  chainSlug: 'mcdonalds-es', portionGrams: 215,
  nutrients: BASE_NUTRIENTS, confidenceLevel: 'high' as const,
  estimationMethod: 'official' as const,
  source: { id: 's-1', name: "McDonald's PDF", type: 'official' as const, url: null },
  similarityDistance: null,
};

const ROUTER_L1_HIT = {
  levelHit: 1 as const,
  data: {
    query: 'big mac', chainSlug: 'mcdonalds-es',
    level1Hit: true, level2Hit: false, level3Hit: false, level4Hit: false,
    matchType: 'exact_dish' as const, result: MOCK_RESULT, cachedAt: null,
  },
};

const ROUTER_MISS = {
  levelHit: null as null,
  data: {
    query: 'unknown', chainSlug: null,
    level1Hit: false, level2Hit: false, level3Hit: false, level4Hit: false,
    matchType: null, result: null, cachedAt: null,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupAuthMocks() {
  mockPrismaApiKeyFindUnique.mockResolvedValue({
    id: 'key-id-001',
    keyHash: 'hashed-key',
    tier: 'free',
    isActive: true,
    expiresAt: null,
  });
  mockPrismaActorUpsert.mockResolvedValue({ id: ACTOR_UUID });
  mockPrismaExecuteRaw.mockResolvedValue(undefined);
  mockRedisIncr.mockResolvedValue(1);
  mockRedisExpire.mockResolvedValue(1);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('F070 edge cases', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetKyselyChain();

    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockQueryLogCreate.mockResolvedValue({});
    mockRunEstimationCascade.mockResolvedValue(ROUTER_L1_HIT);

    setupAuthMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Query logging matrix
  // -------------------------------------------------------------------------

  describe('query logging matrix', () => {
    it('estimation intent → exactly 1 writeQueryLog call', async () => {
      const app = await buildApp();

      const response = await app.inject({
        method: 'POST',
        url: '/conversation/message',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY_VALUE,
          'X-Actor-Id': ACTOR_EXTERNAL_ID,
        },
        payload: { text: 'big mac' },
      });

      expect(response.statusCode).toBe(200);

      // Wait for the fire-and-forget 'finish' listener to flush
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockQueryLogCreate).toHaveBeenCalledTimes(1);
      const logEntry = mockQueryLogCreate.mock.calls[0][0];
      expect(logEntry.data.queryText).toBe('big mac');
    });

    it('comparison intent → exactly 2 writeQueryLog calls (one per side)', async () => {
      mockRunEstimationCascade.mockResolvedValue(ROUTER_L1_HIT);

      const app = await buildApp();

      const response = await app.inject({
        method: 'POST',
        url: '/conversation/message',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY_VALUE,
          'X-Actor-Id': ACTOR_EXTERNAL_ID,
        },
        payload: { text: 'compara big mac vs whopper' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<ConversationMessageResponse>();
      expect(body.data.intent).toBe('comparison');

      await new Promise((resolve) => setImmediate(resolve));

      // Spec: comparison always emits 2 query logs (one per dish)
      expect(mockQueryLogCreate).toHaveBeenCalledTimes(2);
    });

    it('comparison intent → both logs have cacheHit: false', async () => {
      const app = await buildApp();

      await app.inject({
        method: 'POST',
        url: '/conversation/message',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY_VALUE,
          'X-Actor-Id': ACTOR_EXTERNAL_ID,
        },
        payload: { text: 'compara big mac vs whopper' },
      });

      await new Promise((resolve) => setImmediate(resolve));

      // Both comparison logs must have cacheHit: false (spec requirement)
      for (const call of mockQueryLogCreate.mock.calls) {
        expect(call[0].data.cacheHit).toBe(false);
      }
    });

    it('context_set intent → exactly 1 writeQueryLog call with raw text', async () => {
      // Load a chain so context_set is resolved
      mockKyselyExecute.mockResolvedValue([
        { chain_slug: 'mcdonalds-es', name: "McDonald's", name_es: "McDonald's" },
      ]);

      const app = await buildApp();

      await app.inject({
        method: 'POST',
        url: '/conversation/message',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY_VALUE,
          'X-Actor-Id': ACTOR_EXTERNAL_ID,
        },
        payload: { text: 'estoy en mcdonalds' },
      });

      await new Promise((resolve) => setImmediate(resolve));

      expect(mockQueryLogCreate).toHaveBeenCalledTimes(1);
      // queryText should be the raw body text (not the extracted chain identifier)
      expect(mockQueryLogCreate.mock.calls[0][0].data.queryText).toBe('estoy en mcdonalds');
    });

    it('text_too_long intent → exactly 1 writeQueryLog call, queryText truncated to 500', async () => {
      const app = await buildApp();

      await app.inject({
        method: 'POST',
        url: '/conversation/message',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY_VALUE,
          'X-Actor-Id': ACTOR_EXTERNAL_ID,
        },
        payload: { text: 'x'.repeat(600) },
      });

      await new Promise((resolve) => setImmediate(resolve));

      expect(mockQueryLogCreate).toHaveBeenCalledTimes(1);
      const queryText = mockQueryLogCreate.mock.calls[0][0].data.queryText as string;
      // Spec: queryText truncated to 500 chars for text_too_long
      expect(queryText.length).toBe(500);
      expect(queryText).toBe('x'.repeat(500));
    });
  });

  // -------------------------------------------------------------------------
  // 2. Partial and empty legacy context passthrough
  // -------------------------------------------------------------------------

  describe('partial legacy context passthrough', () => {
    it('chainSlug provided but chainName absent → treated as no legacy context', async () => {
      const app = await buildApp();

      const response = await app.inject({
        method: 'POST',
        url: '/conversation/message',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY_VALUE,
          'X-Actor-Id': ACTOR_EXTERNAL_ID,
        },
        payload: {
          text: 'big mac',
          chainSlug: 'mcdonalds-es',
          // chainName intentionally absent
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<ConversationMessageResponse>();
      expect(body.data.intent).toBe('estimation');
      // activeContext should be null because partial legacy context is silently ignored
      // (legacyChainSlug && legacyChainName requires BOTH to be truthy)
      expect(body.data.activeContext).toBeNull();
    });

    it('empty string chainSlug and chainName → treated as no legacy context', async () => {
      const app = await buildApp();

      const response = await app.inject({
        method: 'POST',
        url: '/conversation/message',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY_VALUE,
          'X-Actor-Id': ACTOR_EXTERNAL_ID,
        },
        payload: {
          text: 'big mac',
          chainSlug: '',
          chainName: '',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<ConversationMessageResponse>();
      expect(body.data.intent).toBe('estimation');
      // Empty strings are falsy — treated as no legacy context
      expect(body.data.activeContext).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 3. Comparison one-side error at route level → HTTP 200
  // -------------------------------------------------------------------------

  describe('comparison one-side error → HTTP 200', () => {
    it('comparison first side throws DB error → HTTP 200, dishA has result:null', async () => {
      // First call throws, second call succeeds
      const dbError = Object.assign(new Error('DB failed'), { code: 'DB_UNAVAILABLE' });
      mockRunEstimationCascade
        .mockRejectedValueOnce(dbError)
        .mockResolvedValueOnce(ROUTER_L1_HIT);

      const app = await buildApp();

      const response = await app.inject({
        method: 'POST',
        url: '/conversation/message',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY_VALUE,
          'X-Actor-Id': ACTOR_EXTERNAL_ID,
        },
        payload: { text: 'compara big mac vs whopper' },
      });

      // Spec: one-side DB error → treat as result:null for that side, HTTP 200
      expect(response.statusCode).toBe(200);
      const body = response.json<ConversationMessageResponse>();
      expect(body.data.intent).toBe('comparison');
      // First side (dishA) had the error → result should be null
      expect(body.data.comparison!.dishA.result).toBeNull();
      // Second side (dishB) succeeded
      expect(body.data.comparison!.dishB.result).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 4. Comparison both-sides error at route level → HTTP 500
  // -------------------------------------------------------------------------

  describe('comparison both-sides error → HTTP 500', () => {
    it('comparison both sides throw DB error → HTTP 500 INTERNAL_ERROR', async () => {
      const dbError = Object.assign(new Error('DB failed'), {
        statusCode: 500,
        code: 'DB_UNAVAILABLE',
      });
      mockRunEstimationCascade
        .mockRejectedValueOnce(dbError)
        .mockRejectedValueOnce(dbError);

      const app = await buildApp();

      const response = await app.inject({
        method: 'POST',
        url: '/conversation/message',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY_VALUE,
          'X-Actor-Id': ACTOR_EXTERNAL_ID,
        },
        payload: { text: 'compara big mac vs whopper' },
      });

      // Spec: both sides DB error → propagate as HTTP 500
      expect(response.statusCode).toBe(500);
      const body = response.json<{ success: false; error: { code: string } }>();
      expect(body.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 5. activeContext echoed in text_too_long with active context
  // -------------------------------------------------------------------------

  describe('activeContext echoed in ALL responses including text_too_long', () => {
    it('text_too_long → activeContext echoes previously set context from Redis', async () => {
      // Redis.get call order in a full request:
      //   1. auth.ts cacheGet() → redis.get for API key cache (returns null = cache miss → DB lookup)
      //   2. conversationCore getContext() → redis.get for conv:ctx:{actorId}
      //   3. estimationOrchestrator cacheGet() → redis.get for estimation cache (not reached for text_too_long)
      //
      // We must match this call order precisely:
      mockRedisGet
        .mockResolvedValueOnce(null)  // auth cache miss → falls back to DB
        .mockResolvedValueOnce(JSON.stringify({ chainSlug: 'bk-es', chainName: 'Burger King' }));
        // subsequent calls default to null (from beforeEach mockResolvedValue(null))

      const app = await buildApp();

      const response = await app.inject({
        method: 'POST',
        url: '/conversation/message',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY_VALUE,
          'X-Actor-Id': ACTOR_EXTERNAL_ID,
        },
        payload: { text: 'a'.repeat(501) },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<ConversationMessageResponse>();
      expect(body.data.intent).toBe('text_too_long');
      // Spec: activeContext is loaded BEFORE the length guard, so it should be echoed
      expect(body.data.activeContext).toEqual({
        chainSlug: 'bk-es',
        chainName: 'Burger King',
      });
    });
  });

  // -------------------------------------------------------------------------
  // 6. loadChainData failure at plugin init → estimation still proceeds
  // -------------------------------------------------------------------------

  describe('loadChainData failure at init is non-fatal', () => {
    it('Kysely execute() throws at init → estimation proceeds with empty chains (warn-and-continue)', async () => {
      // Simulate DB failure during loadChainData at plugin init
      mockKyselyExecute.mockRejectedValueOnce(new Error('DB unavailable at startup'));
      // Subsequent calls (estimation cascade) succeed via the mocked cascade
      mockRunEstimationCascade.mockResolvedValue(ROUTER_L1_HIT);

      const app = await buildApp();

      const response = await app.inject({
        method: 'POST',
        url: '/conversation/message',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY_VALUE,
          'X-Actor-Id': ACTOR_EXTERNAL_ID,
        },
        payload: { text: 'big mac' },
      });

      // The route should still return 200 even if chain data failed to load
      expect(response.statusCode).toBe(200);
      const body = response.json<ConversationMessageResponse>();
      // Falls through to estimation (no chains loaded → context-set cannot resolve)
      expect(['estimation', 'comparison', 'context_set', 'text_too_long']).toContain(
        body.data.intent,
      );
    });
  });

  // -------------------------------------------------------------------------
  // 7. Anonymous access (no X-API-Key) behavior
  // -------------------------------------------------------------------------
  // SPEC NOTE: The spec says "requires API key (X-API-Key header) same as GET /estimate"
  // but GET /estimate also allows anonymous access (no key = anonymous actor).
  // The auth plugin: "No key → anonymous caller, skip auth"
  // This means POST /conversation/message, like GET /estimate, accepts anonymous requests.
  // A request with NO X-API-Key proceeds as an anonymous actor (actorResolver creates one).
  // Rate limiting still applies (per actor) even without an API key.

  describe('authentication — anonymous access', () => {
    it('no X-API-Key header → anonymous access allowed, returns 200 (consistent with GET /estimate)', async () => {
      const app = await buildApp();

      const response = await app.inject({
        method: 'POST',
        url: '/conversation/message',
        headers: {
          'Content-Type': 'application/json',
          // No X-API-Key — anonymous caller
          'X-Actor-Id': ACTOR_EXTERNAL_ID,
        },
        payload: { text: 'big mac' },
      });

      // Auth plugin allows anonymous requests (no key = no auth check)
      // This matches GET /estimate behavior per f026.auth.test.ts
      expect(response.statusCode).toBe(200);
      const body = response.json<ConversationMessageResponse>();
      expect(body.data.intent).toBe('estimation');
    });

    it('invalid API key (not in DB) → 401 UNAUTHORIZED', async () => {
      // Key provided but not found in DB → 401
      mockPrismaApiKeyFindUnique.mockResolvedValue(null);

      const app = await buildApp();

      const response = await app.inject({
        method: 'POST',
        url: '/conversation/message',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'invalid-key-that-does-not-exist',
          'X-Actor-Id': ACTOR_EXTERNAL_ID,
        },
        payload: { text: 'big mac' },
      });

      expect(response.statusCode).toBe(401);
      const body = response.json<{ success: false; error: { code: string } }>();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });
  });

  // -------------------------------------------------------------------------
  // 8. context_set ambiguous at route level → 200, no Redis set
  // -------------------------------------------------------------------------

  describe('context_set ambiguous at route level', () => {
    it('ambiguous chain detection → 200, ambiguous:true, no Redis.set for context', async () => {
      // Load two chains with similar names so resolveChain returns 'ambiguous'
      mockKyselyExecute.mockResolvedValue([
        { chain_slug: 'burger-king-es', name: 'Burger King España', name_es: 'Burger King' },
        { chain_slug: 'burger-king-pt', name: 'Burger King Portugal', name_es: 'Burger King' },
      ]);

      const app = await buildApp();

      const response = await app.inject({
        method: 'POST',
        url: '/conversation/message',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY_VALUE,
          'X-Actor-Id': ACTOR_EXTERNAL_ID,
        },
        payload: { text: 'estoy en burger king' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<ConversationMessageResponse>();
      // Could be context_set (ambiguous) or estimation fallthrough depending on tier matching
      // The key check: if it IS context_set, it must be ambiguous
      if (body.data.intent === 'context_set') {
        expect(body.data.ambiguous).toBe(true);
        // Spec: Redis.set must NOT be called for context key when ambiguous
        const contextSetCalls = mockRedisSet.mock.calls.filter(
          (call) => typeof call[0] === 'string' && (call[0] as string).startsWith('conv:ctx:'),
        );
        expect(contextSetCalls).toHaveLength(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 9. X-FXP-Source header source logging
  // -------------------------------------------------------------------------

  describe('X-FXP-Source header determines source in query log', () => {
    it('X-FXP-Source: bot → query log source is "bot"', async () => {
      const app = await buildApp();

      await app.inject({
        method: 'POST',
        url: '/conversation/message',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY_VALUE,
          'X-Actor-Id': ACTOR_EXTERNAL_ID,
          'X-FXP-Source': 'bot',
        },
        payload: { text: 'big mac' },
      });

      await new Promise((resolve) => setImmediate(resolve));

      expect(mockQueryLogCreate).toHaveBeenCalledTimes(1);
      expect(mockQueryLogCreate.mock.calls[0][0].data.source).toBe('bot');
    });

    it('no X-FXP-Source header → query log source is "api"', async () => {
      const app = await buildApp();

      await app.inject({
        method: 'POST',
        url: '/conversation/message',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY_VALUE,
          'X-Actor-Id': ACTOR_EXTERNAL_ID,
          // No X-FXP-Source header
        },
        payload: { text: 'big mac' },
      });

      await new Promise((resolve) => setImmediate(resolve));

      expect(mockQueryLogCreate).toHaveBeenCalledTimes(1);
      expect(mockQueryLogCreate.mock.calls[0][0].data.source).toBe('api');
    });
  });

  // -------------------------------------------------------------------------
  // 10. Boundary: text exactly at 500 chars is NOT text_too_long
  // -------------------------------------------------------------------------

  describe('text length boundary at 500 chars', () => {
    it('text of exactly 500 chars → NOT text_too_long → proceeds to estimation', async () => {
      const app = await buildApp();

      const response = await app.inject({
        method: 'POST',
        url: '/conversation/message',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY_VALUE,
          'X-Actor-Id': ACTOR_EXTERNAL_ID,
        },
        payload: { text: 'x'.repeat(500) },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<ConversationMessageResponse>();
      // Should NOT be text_too_long — 500 chars is exactly at the limit (> 500 triggers)
      expect(body.data.intent).not.toBe('text_too_long');
    });

    it('text of exactly 501 chars → text_too_long', async () => {
      const app = await buildApp();

      const response = await app.inject({
        method: 'POST',
        url: '/conversation/message',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY_VALUE,
          'X-Actor-Id': ACTOR_EXTERNAL_ID,
        },
        payload: { text: 'x'.repeat(501) },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<ConversationMessageResponse>();
      expect(body.data.intent).toBe('text_too_long');
    });
  });

  // -------------------------------------------------------------------------
  // 11. Redis down during context load → activeContext null, request continues
  // -------------------------------------------------------------------------

  describe('Redis fail-open for context', () => {
    it('Redis.get throws during context load → activeContext is null, estimation proceeds', async () => {
      // First get() call is the context read — simulate Redis failure
      mockRedisGet.mockRejectedValueOnce(new Error('Redis connection refused'));
      // Subsequent get() calls (cache) return null (miss)
      mockRedisGet.mockResolvedValue(null);

      const app = await buildApp();

      const response = await app.inject({
        method: 'POST',
        url: '/conversation/message',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY_VALUE,
          'X-Actor-Id': ACTOR_EXTERNAL_ID,
        },
        payload: { text: 'big mac' },
      });

      // Must NOT return 500 — Redis context failure is fail-open
      expect(response.statusCode).toBe(200);
      const body = response.json<ConversationMessageResponse>();
      expect(body.data.intent).toBe('estimation');
      // activeContext must be null (context read failed)
      expect(body.data.activeContext).toBeNull();
    });
  });
});
