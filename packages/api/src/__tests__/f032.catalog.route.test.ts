// Route tests for F032 catalog endpoint extensions:
//   GET  /restaurants?q=   — trigram similarity search
//   POST /restaurants      — create restaurant (admin)
//
// Uses buildApp().inject(). Mocks Redis, Prisma, Kysely at module level.
// Follows f025.catalog.route.test.ts patterns exactly.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { RestaurantListItemSchema } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Mock Redis
// ---------------------------------------------------------------------------

const { mockRedisGet, mockRedisSet } = vi.hoisted(() => ({
  mockRedisGet: vi.fn(),
  mockRedisSet: vi.fn(),
}));

vi.mock('../lib/redis.js', () => ({
  redis: {
    get: mockRedisGet,
    set: mockRedisSet,
  } as unknown as Redis,
}));

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

const {
  mockRestaurantFindMany,
  mockRestaurantCount,
  mockRestaurantFindUnique,
  mockRestaurantCreate,
  mockDishFindMany,
  mockDishCount,
} = vi.hoisted(() => ({
  mockRestaurantFindMany: vi.fn(),
  mockRestaurantCount: vi.fn(),
  mockRestaurantFindUnique: vi.fn(),
  mockRestaurantCreate: vi.fn(),
  mockDishFindMany: vi.fn(),
  mockDishCount: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    restaurant: {
      findMany: mockRestaurantFindMany,
      count: mockRestaurantCount,
      findUnique: mockRestaurantFindUnique,
      create: mockRestaurantCreate,
    },
    dish: {
      findMany: mockDishFindMany,
      count: mockDishCount,
    },
  } as unknown as PrismaClient,
}));

// ---------------------------------------------------------------------------
// Mock Kysely — chainable stub that returns [] by default
// ---------------------------------------------------------------------------

const {
  mockKyselyExecute,
  mockKyselyExecuteTakeFirstOrThrow,
  mockKyselyChainStubs,
} = vi.hoisted(() => {
  const execute = vi.fn().mockResolvedValue([]);
  const executeTakeFirstOrThrow = vi.fn().mockResolvedValue({ count: '0' });

  const chainMethodNames = [
    'selectFrom', 'innerJoin', 'select', 'where', 'orderBy',
    'limit', 'offset', '$if',
  ] as const;

  const stub: Record<string, unknown> = {};
  for (const method of chainMethodNames) {
    stub[method] = vi.fn();
  }
  stub['execute'] = execute;
  stub['executeTakeFirstOrThrow'] = executeTakeFirstOrThrow;
  stub['fn'] = {
    countAll: vi.fn().mockReturnValue({ as: vi.fn().mockReturnValue('count') }),
  };

  for (const method of chainMethodNames) {
    (stub[method] as ReturnType<typeof vi.fn>).mockReturnValue(stub);
  }

  return {
    mockKyselyExecute: execute,
    mockKyselyExecuteTakeFirstOrThrow: executeTakeFirstOrThrow,
    mockKyselyChainStubs: stub,
  };
});

function resetKyselyChain() {
  const chainMethodNames = [
    'selectFrom', 'innerJoin', 'select', 'where', 'orderBy',
    'limit', 'offset', '$if',
  ] as const;
  for (const method of chainMethodNames) {
    (mockKyselyChainStubs[method] as ReturnType<typeof vi.fn>).mockReturnValue(
      mockKyselyChainStubs,
    );
  }
  (mockKyselyChainStubs['fn'] as Record<string, unknown>)['countAll'] =
    vi.fn().mockReturnValue({ as: vi.fn().mockReturnValue('count') });
}

vi.mock('../lib/kysely.js', () => ({
  getKysely: () => mockKyselyChainStubs,
  destroyKysely: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Other mocks required by buildApp transitive imports
// ---------------------------------------------------------------------------

vi.mock('../estimation/level1Lookup.js', () => ({ level1Lookup: vi.fn() }));
vi.mock('../estimation/level2Lookup.js', () => ({ level2Lookup: vi.fn() }));
vi.mock('../estimation/level3Lookup.js', () => ({ level3Lookup: vi.fn() }));
vi.mock('../estimation/level4Lookup.js', () => ({ level4Lookup: vi.fn() }));

import { buildApp } from '../app.js';
import type { Config } from '../config.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RESTAURANT_ID = 'fd000000-0001-4000-a000-000000000001';

// Mock row as returned by Kysely restaurant query (snake_case)
const MOCK_RESTAURANT_KYSELY = {
  id: RESTAURANT_ID,
  name: "McDonald's Spain",
  name_es: "McDonald's España",
  chain_slug: 'mcdonalds-es',
  country_code: 'ES',
  is_active: true,
  logo_url: null,
  website: 'https://www.mcdonalds.es',
  address: null,
  dish_count: '5',
};

// Mock row as returned by Prisma findMany (camelCase + _count)
const MOCK_RESTAURANT_PRISMA = {
  id: RESTAURANT_ID,
  name: "McDonald's Spain",
  nameEs: "McDonald's España",
  chainSlug: 'mcdonalds-es',
  countryCode: 'ES',
  isActive: true,
  logoUrl: null,
  website: 'https://www.mcdonalds.es',
  address: null,
  _count: { dishes: 5 },
};

// Mock created restaurant row from Prisma create()
const MOCK_CREATED_RESTAURANT = {
  id: 'fd000000-0099-4000-a000-000000000001',
  name: 'New Independent Restaurant',
  nameEs: null,
  chainSlug: 'new-chain-es',
  countryCode: 'ES',
  isActive: true,
  website: null,
  logoUrl: null,
  address: null,
  googleMapsUrl: null,
  latitude: null,
  longitude: null,
  createdAt: new Date('2026-03-24T17:00:00Z'),
  updatedAt: new Date('2026-03-24T17:00:00Z'),
};

// ---------------------------------------------------------------------------
// Tests: GET /restaurants?q= (Kysely trigram path)
// ---------------------------------------------------------------------------

describe('GET /restaurants?q= (trigram search path)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetKyselyChain();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRestaurantFindMany.mockResolvedValue([MOCK_RESTAURANT_PRISMA]);
    mockRestaurantCount.mockResolvedValue(1);
    mockKyselyExecute.mockResolvedValue([]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '0' });
  });

  it('returns 200 with items array when Kysely returns restaurant rows', async () => {
    mockKyselyExecute.mockResolvedValue([MOCK_RESTAURANT_KYSELY]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '1' });

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/restaurants?q=mcdon' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: { items: unknown[]; pagination: unknown } }>();
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.pagination).toMatchObject({ totalItems: 1 });
  });

  it('response items validate against RestaurantListItemSchema', async () => {
    mockKyselyExecute.mockResolvedValue([MOCK_RESTAURANT_KYSELY]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '1' });

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/restaurants?q=mcdon' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: { items: unknown[] } }>();
    const parsed = RestaurantListItemSchema.safeParse(body.data.items[0]);
    expect(parsed.success).toBe(true);
  });

  it('returns 200 with empty items when Kysely returns [] and count is 0', async () => {
    mockKyselyExecute.mockResolvedValue([]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '0' });

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/restaurants?q=xyzzy_nonexistent' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: { items: unknown[]; pagination: { totalItems: number; totalPages: number } } }>();
    expect(body.data.items).toHaveLength(0);
    expect(body.data.pagination.totalItems).toBe(0);
    expect(body.data.pagination.totalPages).toBe(0);
  });

  it('returns 400 VALIDATION_ERROR when q= (empty string, minLength violation)', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/restaurants?q=' });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when q is 101 chars (maxLength violation)', async () => {
    const longQ = 'a'.repeat(101);
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: `/restaurants?q=${encodeURIComponent(longQ)}`,
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('passes countryCode filter to Kysely via where() when both q and countryCode are provided', async () => {
    mockKyselyExecute.mockResolvedValue([MOCK_RESTAURANT_KYSELY]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '1' });

    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/restaurants?q=mc&countryCode=ES' });

    const whereCalls = (mockKyselyChainStubs['where'] as ReturnType<typeof vi.fn>).mock.calls;
    const hasCountryFilter = whereCalls.some(
      call => call[0] === 'r.country_code' && call[2] === 'ES',
    );
    expect(hasCountryFilter).toBe(true);
  });

  it('returns 500 DB_UNAVAILABLE when Kysely throws', async () => {
    mockKyselyExecuteTakeFirstOrThrow.mockRejectedValue(new Error('DB error'));

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/restaurants?q=mcdon' });

    expect(response.statusCode).toBe(500);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('DB_UNAVAILABLE');
  });

  it('does NOT call Prisma findMany when q is present (Kysely path)', async () => {
    mockKyselyExecute.mockResolvedValue([MOCK_RESTAURANT_KYSELY]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '1' });

    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/restaurants?q=mcdon' });

    expect(mockRestaurantFindMany).not.toHaveBeenCalled();
  });

  it('cache hit: second call (Redis returns JSON) skips Kysely', async () => {
    const cachedData = {
      items: [],
      pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
    };
    mockRedisGet.mockResolvedValue(JSON.stringify(cachedData));

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/restaurants?q=mcdon' });

    expect(response.statusCode).toBe(200);
    expect(mockKyselyExecute).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /restaurants without q (Prisma path — no regression)
// ---------------------------------------------------------------------------

describe('GET /restaurants without q (Prisma path — no regression)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetKyselyChain();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRestaurantFindMany.mockResolvedValue([MOCK_RESTAURANT_PRISMA]);
    mockRestaurantCount.mockResolvedValue(1);
    mockKyselyExecute.mockResolvedValue([]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '0' });
  });

  it('returns 200 with paginated restaurant list (Prisma path)', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/restaurants' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: { items: unknown[]; pagination: unknown } }>();
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(1);
  });

  it('response items validate against RestaurantListItemSchema (includes address field)', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/restaurants' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: { items: unknown[] } }>();
    const parsed = RestaurantListItemSchema.safeParse(body.data.items[0]);
    expect(parsed.success).toBe(true);
  });

  it('address field is present (null) in Prisma path response', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/restaurants' });

    const body = response.json<{ data: { items: Array<Record<string, unknown>> } }>();
    expect(Object.keys(body.data.items[0] ?? {})).toContain('address');
  });

  it('does NOT call Kysely when q is absent (Prisma path)', async () => {
    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/restaurants' });

    expect(mockKyselyExecute).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /restaurants
// ---------------------------------------------------------------------------

// ADMIN_API_KEY must be at least 32 chars (EnvSchema validation)
const ADMIN_API_KEY = 'a'.repeat(32);

const ADMIN_CONFIG: Config = {
  NODE_ENV: 'test',
  PORT: 3001,
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
  LOG_LEVEL: 'silent' as Config['LOG_LEVEL'],
  REDIS_URL: 'redis://localhost:6380',
  OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
  OPENAI_EMBEDDING_BATCH_SIZE: 100,
  OPENAI_EMBEDDING_RPM: 3000,
  OPENAI_CHAT_MAX_TOKENS: 512,
  ADMIN_API_KEY,
};

describe('POST /restaurants', () => {
  const ADMIN_APP_CONFIG = ADMIN_CONFIG;

  beforeEach(() => {
    vi.resetAllMocks();
    resetKyselyChain();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRestaurantCreate.mockResolvedValue(MOCK_CREATED_RESTAURANT);
    mockKyselyExecute.mockResolvedValue([]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '0' });
  });

  it('returns 201 with created record when body is valid chain restaurant', async () => {
    const app = await buildApp({ config: ADMIN_APP_CONFIG });
    const response = await app.inject({
      method: 'POST',
      url: '/restaurants',
      headers: { 'x-api-key': ADMIN_API_KEY, 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'New Chain', countryCode: 'ES', chainSlug: 'new-chain-es' }),
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
    expect(body.success).toBe(true);
    expect(body.data['id']).toBeDefined();
  });

  it('returns 201 with auto-generated chainSlug when chainSlug is omitted', async () => {
    const app = await buildApp({ config: ADMIN_APP_CONFIG });
    const response = await app.inject({
      method: 'POST',
      url: '/restaurants',
      headers: { 'x-api-key': ADMIN_API_KEY, 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'Independent Bistro', countryCode: 'ES' }),
    });

    expect(response.statusCode).toBe(201);
    // The mock returns MOCK_CREATED_RESTAURANT which has 'new-chain-es' as chainSlug
    // but what matters is that create() was called with an auto-generated slug
    const createCall = mockRestaurantCreate.mock.calls[0];
    const passedChainSlug = (createCall?.[0] as { data: { chainSlug: string } })?.data?.chainSlug;
    expect(passedChainSlug).toMatch(/^independent-[a-z0-9-]+-[a-z0-9]{8}$/);
  });

  it('returns 400 VALIDATION_ERROR when name is missing', async () => {
    const app = await buildApp({ config: ADMIN_APP_CONFIG });
    const response = await app.inject({
      method: 'POST',
      url: '/restaurants',
      headers: { 'x-api-key': ADMIN_API_KEY, 'content-type': 'application/json' },
      payload: JSON.stringify({ countryCode: 'ES' }),
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when countryCode is lowercase', async () => {
    const app = await buildApp({ config: ADMIN_APP_CONFIG });
    const response = await app.inject({
      method: 'POST',
      url: '/restaurants',
      headers: { 'x-api-key': ADMIN_API_KEY, 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'Test', countryCode: 'es' }),
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when chainSlug contains uppercase', async () => {
    const app = await buildApp({ config: ADMIN_APP_CONFIG });
    const response = await app.inject({
      method: 'POST',
      url: '/restaurants',
      headers: { 'x-api-key': ADMIN_API_KEY, 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'Test', countryCode: 'ES', chainSlug: 'MyChain' }),
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 UNAUTHORIZED when X-API-Key header is absent', async () => {
    const app = await buildApp({ config: ADMIN_APP_CONFIG });
    const response = await app.inject({
      method: 'POST',
      url: '/restaurants',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'Test', countryCode: 'ES' }),
    });

    expect(response.statusCode).toBe(401);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 UNAUTHORIZED when X-API-Key header is wrong', async () => {
    const app = await buildApp({ config: ADMIN_APP_CONFIG });
    const response = await app.inject({
      method: 'POST',
      url: '/restaurants',
      headers: { 'x-api-key': 'wrong-key', 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'Test', countryCode: 'ES' }),
    });

    expect(response.statusCode).toBe(401);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 409 DUPLICATE_RESTAURANT when Prisma throws P2002', async () => {
    const { Prisma: PrismaNamespace } = await import('@prisma/client');
    const p2002Error = new PrismaNamespace.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: '5.0.0', meta: {} },
    );
    mockRestaurantCreate.mockRejectedValue(p2002Error);

    const app = await buildApp({ config: ADMIN_APP_CONFIG });
    const response = await app.inject({
      method: 'POST',
      url: '/restaurants',
      headers: { 'x-api-key': ADMIN_API_KEY, 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'Duplicate Chain', countryCode: 'ES', chainSlug: 'existing-chain-es' }),
    });

    expect(response.statusCode).toBe(409);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('DUPLICATE_RESTAURANT');
  });

  it('returns 500 DB_UNAVAILABLE when Prisma throws a non-P2002 error', async () => {
    mockRestaurantCreate.mockRejectedValue(new Error('DB connection failed'));

    const app = await buildApp({ config: ADMIN_APP_CONFIG });
    const response = await app.inject({
      method: 'POST',
      url: '/restaurants',
      headers: { 'x-api-key': ADMIN_API_KEY, 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'Test', countryCode: 'ES' }),
    });

    expect(response.statusCode).toBe(500);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('DB_UNAVAILABLE');
  });

  it('GET /restaurants still returns 200 without X-API-Key (public route unchanged)', async () => {
    mockRestaurantFindMany.mockResolvedValue([MOCK_RESTAURANT_PRISMA]);
    mockRestaurantCount.mockResolvedValue(1);

    const app = await buildApp({ config: ADMIN_APP_CONFIG });
    const response = await app.inject({ method: 'GET', url: '/restaurants' });

    expect(response.statusCode).toBe(200);
  });
});
