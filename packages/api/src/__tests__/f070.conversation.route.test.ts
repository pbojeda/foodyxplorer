// Route integration tests for POST /conversation/message (F070, Step 8)
//
// Uses buildApp() + inject() pattern.
// Mocks runEstimationCascade, Redis (incl. incr/expire for rate limit), Prisma, Kysely.
// Follows the vi.hoisted + fluent Kysely stub pattern from f025.catalog.route.test.ts.

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
// Mock Redis (get/set for cache, incr/expire for rate limit)
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
// Mock Prisma
// ---------------------------------------------------------------------------

const {
  mockPrismaActorUpsert,
  mockPrismaApiKeyFindUnique,
  mockPrismaExecuteRaw,
} = vi.hoisted(() => ({
  mockPrismaActorUpsert: vi.fn(),
  mockPrismaApiKeyFindUnique: vi.fn(),
  mockPrismaExecuteRaw: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    actor: {
      upsert: mockPrismaActorUpsert,
    },
    apiKey: {
      findUnique: mockPrismaApiKeyFindUnique,
    },
    queryLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    $executeRaw: mockPrismaExecuteRaw,
  } as unknown as PrismaClient,
}));

// ---------------------------------------------------------------------------
// Mock Kysely — fluent stub that returns [] for execute()
// loadChainData uses: selectFrom.select.where.distinct.execute()
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

  // Point all chain methods back to stub (chaining)
  for (const method of chainMethodNames) {
    (stub[method] as ReturnType<typeof vi.fn>).mockReturnValue(stub);
  }

  return {
    mockKyselyExecute: execute,
    mockKyselyChainStubs: stub,
    chainMethodNames,
  };
});

/**
 * Re-apply mockReturnValue(stub) on all chain methods after vi.resetAllMocks().
 */
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
// Use a valid UUID format so actorResolver routes to anonymous_web upsert path
const ACTOR_EXTERNAL_ID = 'fd000000-0070-4000-a000-000000000001';

const BASE_NUTRIENTS = {
  calories: 550, proteins: 25, carbohydrates: 45, sugars: 9,
  fats: 26, saturatedFats: 10, fiber: 2, salt: 2.2, sodium: 880,
  transFats: 0.2, cholesterol: 80, potassium: 320,
  monounsaturatedFats: 12, polyunsaturatedFats: 4,
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
  source: { id: 's-1', name: "McDonald's PDF", type: 'official' as const, url: 'https://x.com' },
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

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function setupAuthMocks() {
  // auth.ts calls prisma.apiKey.findUnique({ where: { keyHash } })
  mockPrismaApiKeyFindUnique.mockResolvedValue({
    id: 'key-id-001',
    keyHash: 'hashed-key',
    tier: 'free',
    isActive: true,
    expiresAt: null,
  });
  // actorResolver.ts calls prisma.actor.upsert()
  mockPrismaActorUpsert.mockResolvedValue({ id: ACTOR_UUID });
  // auth.ts calls prisma.$executeRaw for touchLastUsed (fire-and-forget, ignore)
  mockPrismaExecuteRaw.mockResolvedValue(undefined);
  // Rate limit: under the limit
  mockRedisIncr.mockResolvedValue(1);
  mockRedisExpire.mockResolvedValue(1);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /conversation/message (F070)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetKyselyChain();

    // Default: Redis cache miss for estimation cache + context
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');

    // Default: router returns L1 hit
    mockRunEstimationCascade.mockResolvedValue(ROUTER_L1_HIT);

    setupAuthMocks();
  });

  // -------------------------------------------------------------------------
  // Happy path — estimation intent
  // -------------------------------------------------------------------------

  it('valid body { text: "big mac" } → 200, estimation intent', async () => {
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
    const body = response.json<ConversationMessageResponse>();
    expect(body.success).toBe(true);
    expect(body.data.intent).toBe('estimation');
    expect(body.data.actorId).toBe(ACTOR_UUID);
    expect(body.data.estimation).toBeDefined();
    expect(body.data.activeContext).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Body with legacy context
  // -------------------------------------------------------------------------

  it('body with legacy chainSlug → estimation passes chainSlug to cascade', async () => {
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
        chainName: "McDonald's",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<ConversationMessageResponse>();
    expect(body.success).toBe(true);
    expect(body.data.intent).toBe('estimation');
    expect(mockRunEstimationCascade).toHaveBeenCalledWith(
      expect.objectContaining({ chainSlug: 'mcdonalds-es' }),
    );
  });

  // -------------------------------------------------------------------------
  // context_set intent
  // -------------------------------------------------------------------------

  it('"estoy en mcdonalds" with chains in DB → context_set intent', async () => {
    // Make ALL execute() calls return the chain rows — ensures loadChainData
    // (called last, after other plugin inits) also gets the chain.
    mockKyselyExecute.mockResolvedValue([
      { chain_slug: 'mcdonalds-es', name: "McDonald's", name_es: "McDonald's" },
    ]);

    // Also need to persist the context to Redis
    mockRedisSet.mockResolvedValue('OK');

    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/conversation/message',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY_VALUE,
        'X-Actor-Id': ACTOR_EXTERNAL_ID,
      },
      payload: { text: 'estoy en mcdonalds' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<ConversationMessageResponse>();
    expect(body.success).toBe(true);
    expect(body.data.intent).toBe('context_set');
    expect(body.data.contextSet).toEqual({
      chainSlug: 'mcdonalds-es',
      chainName: "McDonald's",
    });
  });

  // -------------------------------------------------------------------------
  // text_too_long (domain rule, not Zod)
  // -------------------------------------------------------------------------

  it('text of 501 chars → 200 with intent text_too_long', async () => {
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
    expect(body.success).toBe(true);
    expect(body.data.intent).toBe('text_too_long');
    expect(body.data.actorId).toBe(ACTOR_UUID);
    expect(body.data.activeContext).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Zod validation errors
  // -------------------------------------------------------------------------

  it('missing text field → 400 VALIDATION_ERROR', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/conversation/message',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY_VALUE,
        'X-Actor-Id': ACTOR_EXTERNAL_ID,
      },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('empty string after trim → 400 VALIDATION_ERROR (Zod min:1)', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/conversation/message',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY_VALUE,
        'X-Actor-Id': ACTOR_EXTERNAL_ID,
      },
      payload: { text: '   ' },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('text > 2000 chars → 400 VALIDATION_ERROR (Zod max:2000 abuse guard)', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/conversation/message',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY_VALUE,
        'X-Actor-Id': ACTOR_EXTERNAL_ID,
      },
      payload: { text: 'a'.repeat(2001) },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  // -------------------------------------------------------------------------
  // 500 internal error
  // -------------------------------------------------------------------------

  it('runEstimationCascade throws DB error → 500 response', async () => {
    mockRunEstimationCascade.mockRejectedValueOnce(
      Object.assign(new Error('Database query failed'), {
        statusCode: 500,
        code: 'DB_UNAVAILABLE',
      }),
    );

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

    expect(response.statusCode).toBe(500);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.success).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Rate limit bucket mapping — /conversation/message shares 'queries' bucket
  // -------------------------------------------------------------------------

  it('rate limit exceeded → 429 ACTOR_RATE_LIMIT_EXCEEDED', async () => {
    // Simulate count above the 50/day limit
    mockRedisIncr.mockResolvedValue(51);

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

    expect(response.statusCode).toBe(429);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.error.code).toBe('ACTOR_RATE_LIMIT_EXCEEDED');
  });

  // -------------------------------------------------------------------------
  // Comparison intent
  // -------------------------------------------------------------------------

  it('comparison query → 200 with comparison intent', async () => {
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
    expect(body.success).toBe(true);
    expect(body.data.intent).toBe('comparison');
    expect(body.data.comparison).toBeDefined();
    expect(body.data.comparison!.dishA).toBeDefined();
    expect(body.data.comparison!.dishB).toBeDefined();
    // Two estimates were run (one per side)
    expect(mockRunEstimationCascade).toHaveBeenCalledTimes(2);
  });
});
