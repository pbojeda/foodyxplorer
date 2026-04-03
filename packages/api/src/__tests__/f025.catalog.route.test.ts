// Route tests for F025 catalog endpoints:
//   GET /restaurants
//   GET /restaurants/:id/dishes
//   GET /dishes/search
//   GET /chains
//
// Uses buildApp().inject(). Mocks Redis, Prisma, Kysely at module level.
// No real DB calls.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import {
  RestaurantListItemSchema,
  DishListItemSchema,
  ChainListItemSchema,
} from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Mock Redis — fail-open and cache hit scenarios
// ---------------------------------------------------------------------------

const { mockRedisGet, mockRedisSet } = vi.hoisted(() => ({
  mockRedisGet: vi.fn(),
  mockRedisSet: vi.fn(),
}));

vi.mock('../lib/redis.js', () => ({
  redis: {
    get: mockRedisGet,
    set: mockRedisSet,
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  } as unknown as Redis,
}));

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

const {
  mockRestaurantFindMany,
  mockRestaurantCount,
  mockRestaurantFindUnique,
  mockDishFindMany,
  mockDishCount,
} = vi.hoisted(() => ({
  mockRestaurantFindMany: vi.fn(),
  mockRestaurantCount: vi.fn(),
  mockRestaurantFindUnique: vi.fn(),
  mockDishFindMany: vi.fn(),
  mockDishCount: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    restaurant: {
      findMany: mockRestaurantFindMany,
      count: mockRestaurantCount,
      findUnique: mockRestaurantFindUnique,
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
//
// The chain methods must survive vi.resetAllMocks() — after reset, vi.fn()
// stubs lose their implementations. We store the stubs separately and restore
// them in each beforeEach via resetKyselyChain().

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

  // Create a stub object with vi.fn() chain methods
  const stub: Record<string, unknown> = {};
  for (const method of chainMethodNames) {
    stub[method] = vi.fn();
  }
  stub['execute'] = execute;
  stub['executeTakeFirstOrThrow'] = executeTakeFirstOrThrow;
  stub['fn'] = {
    countAll: vi.fn().mockReturnValue({ as: vi.fn().mockReturnValue('count') }),
  };

  // Point all chain methods back to stub (they return the stub for chaining)
  for (const method of chainMethodNames) {
    (stub[method] as ReturnType<typeof vi.fn>).mockReturnValue(stub);
  }

  return {
    mockKyselyExecute: execute,
    mockKyselyExecuteTakeFirstOrThrow: executeTakeFirstOrThrow,
    mockKyselyChainStubs: stub,
    chainMethodNames,
  };
});

/**
 * Re-apply mockReturnValue(stub) on all chain methods after vi.resetAllMocks()
 * clears the implementations.
 */
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

// Estimation engine mocks (not used by catalog routes but needed by app.ts imports)
vi.mock('../estimation/level1Lookup.js', () => ({ level1Lookup: vi.fn() }));
vi.mock('../estimation/level2Lookup.js', () => ({ level2Lookup: vi.fn() }));
vi.mock('../estimation/level3Lookup.js', () => ({ level3Lookup: vi.fn() }));
vi.mock('../estimation/level4Lookup.js', () => ({ level4Lookup: vi.fn() }));

import { buildApp } from '../app.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RESTAURANT_ID = 'fd000000-0001-4000-a000-000000000001';
const UNKNOWN_ID = 'fd000000-ffff-4000-a000-000000000099';

const MOCK_RESTAURANT = {
  id: RESTAURANT_ID,
  name: "McDonald's Spain",
  nameEs: "McDonald's España",
  chainSlug: 'mcdonalds-es',
  countryCode: 'ES',
  isActive: true,
  logoUrl: null,
  website: 'https://www.mcdonalds.es',
  _count: { dishes: 5 },
};

const MOCK_DISH_PRISMA = {
  id: 'fd000000-0002-4000-a000-000000000001',
  name: 'Big Mac',
  nameEs: 'Big Mac',
  restaurantId: RESTAURANT_ID,
  availability: 'available' as const,
  portionGrams: { toNumber: () => 215 },
  priceEur: { toNumber: () => 5.5 },
  restaurant: {
    name: "McDonald's Spain",
    chainSlug: 'mcdonalds-es',
  },
};

const MOCK_DISH_KYSELY = {
  id: 'fd000000-0002-4000-a000-000000000001',
  name: 'Big Mac',
  name_es: 'Big Mac',
  restaurant_id: RESTAURANT_ID,
  chain_slug: 'mcdonalds-es',
  restaurant_name: "McDonald's Spain",
  availability: 'available',
  portion_grams: '215',
  price_eur: '5.50',
};

// ---------------------------------------------------------------------------
// Tests: GET /restaurants
// ---------------------------------------------------------------------------

describe('GET /restaurants', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetKyselyChain();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRestaurantFindMany.mockResolvedValue([MOCK_RESTAURANT]);
    mockRestaurantCount.mockResolvedValue(1);
    mockKyselyExecute.mockResolvedValue([]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '0' });
  });

  it('returns 200 with paginated restaurant list', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/restaurants' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: { items: unknown[]; pagination: unknown } }>();
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.pagination).toMatchObject({ page: 1, pageSize: 20, totalItems: 1, totalPages: 1 });
  });

  it('response items validate against RestaurantListItemSchema', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/restaurants' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: { items: unknown[] } }>();
    const parsed = RestaurantListItemSchema.safeParse(body.data.items[0]);
    expect(parsed.success).toBe(true);
  });

  it('returns 400 VALIDATION_ERROR when isActive=yes (not "true"/"false")', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/restaurants?isActive=yes' });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when countryCode=esp (not 2-char uppercase)', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/restaurants?countryCode=esp' });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when page=0', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/restaurants?page=0' });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('isActive=false is correctly passed as boolean false to Prisma (not coerced to true)', async () => {
    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/restaurants?isActive=false' });

    expect(mockRestaurantFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: false }),
      }),
    );
  });

  it('cache hit: second call (Redis returns JSON) skips Prisma', async () => {
    const cachedData = {
      items: [{ ...MOCK_RESTAURANT, dishCount: 5 }],
      pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
    };
    mockRedisGet.mockResolvedValue(JSON.stringify(cachedData));

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/restaurants' });

    expect(response.statusCode).toBe(200);
    expect(mockRestaurantFindMany).not.toHaveBeenCalled();
  });

  it('Redis fail-open: redis.get rejects → Prisma still called, 200 returned', async () => {
    mockRedisGet.mockRejectedValue(new Error('ECONNREFUSED'));

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/restaurants' });

    expect(response.statusCode).toBe(200);
    expect(mockRestaurantFindMany).toHaveBeenCalledTimes(1);
  });

  it('DB error → 500 DB_UNAVAILABLE', async () => {
    mockRestaurantFindMany.mockRejectedValue(new Error('DB connection failed'));

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/restaurants' });

    expect(response.statusCode).toBe(500);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.error.code).toBe('DB_UNAVAILABLE');
  });

  it('totalPages is 0 when totalItems is 0', async () => {
    mockRestaurantFindMany.mockResolvedValue([]);
    mockRestaurantCount.mockResolvedValue(0);

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/restaurants' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: { pagination: { totalPages: number; totalItems: number } } }>();
    expect(body.data.pagination.totalItems).toBe(0);
    expect(body.data.pagination.totalPages).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /restaurants/:id/dishes
// ---------------------------------------------------------------------------

describe('GET /restaurants/:id/dishes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetKyselyChain();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRestaurantFindUnique.mockResolvedValue({ id: RESTAURANT_ID });
    mockDishFindMany.mockResolvedValue([MOCK_DISH_PRISMA]);
    mockDishCount.mockResolvedValue(1);
    mockKyselyExecute.mockResolvedValue([]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '0' });
  });

  it('returns 200 with paginated dishes (no search — Prisma path)', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: `/restaurants/${RESTAURANT_ID}/dishes`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: { items: unknown[]; pagination: unknown } }>();
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.pagination).toMatchObject({ page: 1, pageSize: 20, totalItems: 1, totalPages: 1 });
  });

  it('portionGrams and priceEur are plain numbers (Decimal converted)', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: `/restaurants/${RESTAURANT_ID}/dishes`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: { items: Array<{ portionGrams: unknown; priceEur: unknown }> } }>();
    expect(typeof body.data.items[0]?.['portionGrams']).toBe('number');
    expect(typeof body.data.items[0]?.['priceEur']).toBe('number');
  });

  it('response items validate against DishListItemSchema', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: `/restaurants/${RESTAURANT_ID}/dishes`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: { items: unknown[] } }>();
    const parsed = DishListItemSchema.safeParse(body.data.items[0]);
    expect(parsed.success).toBe(true);
  });

  it('returns 200 with trigram results when search is present (Kysely path)', async () => {
    mockKyselyExecute.mockResolvedValue([MOCK_DISH_KYSELY]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '1' });

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: `/restaurants/${RESTAURANT_ID}/dishes?search=Big`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: { items: unknown[]; pagination: unknown } }>();
    expect(body.data.items).toHaveLength(1);
    expect(body.data.pagination).toMatchObject({ totalItems: 1 });
  });

  it('returns 404 NOT_FOUND when restaurant does not exist', async () => {
    mockRestaurantFindUnique.mockResolvedValue(null);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: `/restaurants/${UNKNOWN_ID}/dishes`,
    });

    expect(response.statusCode).toBe(404);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 VALIDATION_ERROR when id is not a UUID', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/restaurants/not-a-uuid/dishes',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when pageSize=0', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: `/restaurants/${RESTAURANT_ID}/dishes?pageSize=0`,
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('cache hit: second call (Redis returns JSON) skips Prisma + existence check', async () => {
    const cachedData = {
      items: [],
      pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
    };
    mockRedisGet.mockResolvedValue(JSON.stringify(cachedData));

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: `/restaurants/${RESTAURANT_ID}/dishes`,
    });

    expect(response.statusCode).toBe(200);
    expect(mockRestaurantFindUnique).not.toHaveBeenCalled();
    expect(mockDishFindMany).not.toHaveBeenCalled();
  });

  it('returns 200 with empty items when restaurant exists but has no dishes', async () => {
    mockDishFindMany.mockResolvedValue([]);
    mockDishCount.mockResolvedValue(0);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: `/restaurants/${RESTAURANT_ID}/dishes`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: { items: unknown[]; pagination: { totalPages: number } } }>();
    expect(body.data.items).toHaveLength(0);
    expect(body.data.pagination.totalPages).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /dishes/search
// ---------------------------------------------------------------------------

describe('GET /dishes/search', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetKyselyChain();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockKyselyExecute.mockResolvedValue([]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '0' });
  });

  it('returns 200 with empty items when no results (never 404)', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/dishes/search?q=xyzzy_nonexistent',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: { items: unknown[]; pagination: { totalItems: number } } }>();
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(0);
    expect(body.data.pagination.totalItems).toBe(0);
  });

  it('returns 200 with results from Kysely', async () => {
    mockKyselyExecute.mockResolvedValue([MOCK_DISH_KYSELY]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '1' });

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/dishes/search?q=Big+Mac',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: { items: unknown[]; pagination: unknown } }>();
    expect(body.data.items).toHaveLength(1);
  });

  it('response items validate against DishListItemSchema', async () => {
    mockKyselyExecute.mockResolvedValue([MOCK_DISH_KYSELY]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '1' });

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/dishes/search?q=Big+Mac',
    });

    const body = response.json<{ data: { items: unknown[] } }>();
    const parsed = DishListItemSchema.safeParse(body.data.items[0]);
    expect(parsed.success).toBe(true);
  });

  it('returns 400 VALIDATION_ERROR when q is missing', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/dishes/search' });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when q is empty string after trim', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/dishes/search?q=%20%20' });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('cache hit: second call skips Kysely', async () => {
    const cachedData = {
      items: [],
      pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
    };
    mockRedisGet.mockResolvedValue(JSON.stringify(cachedData));

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/dishes/search?q=burger' });

    expect(response.statusCode).toBe(200);
    expect(mockKyselyExecute).not.toHaveBeenCalled();
  });

  it('DB error → 500 DB_UNAVAILABLE', async () => {
    mockKyselyExecuteTakeFirstOrThrow.mockRejectedValue(new Error('DB error'));

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/dishes/search?q=burger' });

    expect(response.statusCode).toBe(500);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('DB_UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /chains
// ---------------------------------------------------------------------------

describe('GET /chains', () => {
  const MOCK_RESTAURANT_2 = {
    id: 'fd000000-0003-4000-a000-000000000001',
    name: 'Burger King Madrid',
    nameEs: 'Burger King Madrid',
    chainSlug: 'burger-king-es',
    countryCode: 'ES',
    isActive: true,
    logoUrl: null,
    website: null,
    _count: { dishes: 8 },
  };

  const MOCK_RESTAURANT_EXTRA = {
    id: 'fd000000-0003-4000-a000-000000000002',
    name: 'Burger King Barcelona',
    nameEs: 'Burger King Barcelona',
    chainSlug: 'burger-king-es',
    countryCode: 'ES',
    isActive: false,
    logoUrl: null,
    website: null,
    _count: { dishes: 3 },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    resetKyselyChain();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRestaurantFindMany.mockResolvedValue([MOCK_RESTAURANT, MOCK_RESTAURANT_2]);
    mockKyselyExecute.mockResolvedValue([]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '0' });
  });

  it('returns 200 flat array with chain entries', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/chains' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: unknown[] }>();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(2);
  });

  it('response items validate against ChainListItemSchema', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/chains' });

    const body = response.json<{ data: unknown[] }>();
    const parsed = ChainListItemSchema.safeParse(body.data[0]);
    expect(parsed.success).toBe(true);
  });

  it('aggregates dishCount across restaurants with same chainSlug', async () => {
    // Two restaurants with same chainSlug
    mockRestaurantFindMany.mockResolvedValue([MOCK_RESTAURANT_2, MOCK_RESTAURANT_EXTRA]);

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/chains' });

    const body = response.json<{ data: Array<{ dishCount: number; chainSlug: string }> }>();
    const chain = body.data.find(c => c['chainSlug'] === 'burger-king-es');
    expect(chain?.['dishCount']).toBe(11); // 8 + 3
  });

  it('isActive is true if ANY restaurant in group is active', async () => {
    // One active, one inactive — same chainSlug
    mockRestaurantFindMany.mockResolvedValue([MOCK_RESTAURANT_2, MOCK_RESTAURANT_EXTRA]);

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/chains' });

    const body = response.json<{ data: Array<{ isActive: boolean; chainSlug: string }> }>();
    const chain = body.data.find(c => c['chainSlug'] === 'burger-king-es');
    expect(chain?.['isActive']).toBe(true);
  });

  it('returns 400 VALIDATION_ERROR when countryCode=es (lowercase)', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/chains?countryCode=es' });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('isActive=false filter correctly passed to Prisma (not coerced to true)', async () => {
    mockRestaurantFindMany.mockResolvedValue([]);

    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/chains?isActive=false' });

    expect(mockRestaurantFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: false }),
      }),
    );
  });

  it('cache hit: second call skips Prisma', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([]));

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/chains' });

    expect(response.statusCode).toBe(200);
    expect(mockRestaurantFindMany).not.toHaveBeenCalled();
  });

  it('DB error → 500 DB_UNAVAILABLE', async () => {
    mockRestaurantFindMany.mockRejectedValue(new Error('DB connection failed'));

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/chains' });

    expect(response.statusCode).toBe(500);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('DB_UNAVAILABLE');
  });
});
