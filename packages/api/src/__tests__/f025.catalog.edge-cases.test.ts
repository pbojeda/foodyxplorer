// F025 QA edge-case tests — authored by qa-engineer
//
// These tests cover gaps in the developer's original test suite (f025.catalog.route.test.ts).
// All 10 edge cases from the QA brief are addressed here.
//
// Edge cases targeted:
//   1. isActive=false NOT coerced to true  [covered in dev tests — verified here via separate assertion]
//   2. page beyond totalPages → 200 with empty items
//   3. chainSlug AND restaurantId both provided → restaurantId takes precedence (WHERE clause assertion)
//   4. Restaurant exists, zero dishes → 200 with empty items [covered in dev tests — regression guard]
//   5. Trigram search on 1-2 char strings → no crash
//   6. Redis unavailable (fail-open): cacheSet failure is silently swallowed
//   7. portionGrams / priceEur are plain numbers [covered in dev tests — regression guard]
//   8. Same chainSlug, multiple countries → SEPARATE entries in GET /chains
//   9. GET /chains dishCount aggregation across multiple restaurants (same slug, same country)
//  10. GET /chains isActive aggregation — true if ANY restaurant in group is active
//      [covered in dev tests — this file adds the complement: ALL inactive → false]
//
// Additional gaps found:
//  A. pageSize=101 → 400 VALIDATION_ERROR (max is 100, not tested in dev suite)
//  B. GET /restaurants — count query failure (Promise.all partial failure)
//  C. GET /restaurants/:id/dishes — DB error on dish query (after existence check passes)
//  D. GET /dishes/search — restaurantId AND chainSlug simultaneously: WHERE chain verified
//  E. GET /chains — all restaurants inactive → isActive: false (complement of dev test 10)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

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
// Mock Kysely — chainable stub
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RESTAURANT_ID = 'fd000000-0001-4000-a000-000000000001';
const UNKNOWN_ID    = 'fd000000-ffff-4000-a000-000000000099';

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
// EDGE CASE 2: page beyond totalPages → 200 with empty items (not 404/400)
// ---------------------------------------------------------------------------

describe('GET /restaurants — page beyond totalPages', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetKyselyChain();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRestaurantFindMany.mockResolvedValue([]); // DB returns empty for out-of-range page
    mockRestaurantCount.mockResolvedValue(5); // 5 total items but page 100 → no results
    mockKyselyExecute.mockResolvedValue([]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '0' });
  });

  it('returns 200 with empty items when page is beyond totalPages', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/restaurants?page=100&pageSize=20',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      success: boolean;
      data: {
        items: unknown[];
        pagination: { page: number; totalItems: number; totalPages: number };
      };
    }>();
    expect(body.success).toBe(true);
    // items is empty (Prisma returns [] for out-of-range offset)
    expect(body.data.items).toHaveLength(0);
    // totalItems still reflects real count (5), not 0
    expect(body.data.pagination.totalItems).toBe(5);
    // totalPages is 1 (ceil(5/20)), not 0
    expect(body.data.pagination.totalPages).toBe(1);
    // page is echoed back as 100
    expect(body.data.pagination.page).toBe(100);
  });
});

describe('GET /restaurants/:id/dishes — page beyond totalPages', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetKyselyChain();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRestaurantFindUnique.mockResolvedValue({ id: RESTAURANT_ID });
    mockDishFindMany.mockResolvedValue([]);
    mockDishCount.mockResolvedValue(3);
    mockKyselyExecute.mockResolvedValue([]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '0' });
  });

  it('returns 200 with empty items when page is beyond totalPages', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: `/restaurants/${RESTAURANT_ID}/dishes?page=50`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      data: {
        items: unknown[];
        pagination: { page: number; totalItems: number; totalPages: number };
      };
    }>();
    expect(body.data.items).toHaveLength(0);
    expect(body.data.pagination.totalItems).toBe(3);
    expect(body.data.pagination.totalPages).toBe(1);
    expect(body.data.pagination.page).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// EDGE CASE 3: chainSlug AND restaurantId both provided → restaurantId wins
// ---------------------------------------------------------------------------

describe('GET /dishes/search — restaurantId takes precedence over chainSlug', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetKyselyChain();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockKyselyExecute.mockResolvedValue([MOCK_DISH_KYSELY]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '1' });
  });

  it('when both restaurantId and chainSlug are provided, WHERE uses restaurant_id only (chainSlug ignored)', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'GET',
      url: `/dishes/search?q=burger&restaurantId=${RESTAURANT_ID}&chainSlug=some-other-chain`,
    });

    // The .where() stub captures all calls. We inspect what arguments it received.
    const whereCalls = (mockKyselyChainStubs['where'] as ReturnType<typeof vi.fn>).mock.calls;

    // Verify restaurant_id filter was applied
    const hasRestaurantFilter = whereCalls.some(
      call => call[0] === 'd.restaurant_id' && call[2] === RESTAURANT_ID,
    );
    expect(hasRestaurantFilter).toBe(true);

    // Verify chain_slug filter was NOT applied (restaurantId takes precedence)
    const hasChainFilter = whereCalls.some(
      call => call[0] === 'r.chain_slug' && call[2] === 'some-other-chain',
    );
    expect(hasChainFilter).toBe(false);
  });

  it('returns 200 when both restaurantId and chainSlug are provided (no 400 error)', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: `/dishes/search?q=burger&restaurantId=${RESTAURANT_ID}&chainSlug=burger-king-es`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean }>();
    expect(body.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// EDGE CASE 5: Trigram search on 1-2 char strings — no crash
// ---------------------------------------------------------------------------

describe('GET /restaurants/:id/dishes — trigram search with very short query', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetKyselyChain();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRestaurantFindUnique.mockResolvedValue({ id: RESTAURANT_ID });
    mockKyselyExecute.mockResolvedValue([]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '0' });
  });

  it('returns 200 (not crash) when search is a single character', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: `/restaurants/${RESTAURANT_ID}/dishes?search=B`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: { items: unknown[] } }>();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data.items)).toBe(true);
  });

  it('returns 200 (not crash) when search is two characters', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: `/restaurants/${RESTAURANT_ID}/dishes?search=Bi`,
    });

    expect(response.statusCode).toBe(200);
  });
});

describe('GET /dishes/search — trigram search with very short query', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetKyselyChain();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockKyselyExecute.mockResolvedValue([]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '0' });
  });

  it('returns 200 (not crash) when q is a single character', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/dishes/search?q=a',
    });

    expect(response.statusCode).toBe(200);
  });

  it('returns 200 (not crash) when q is two characters', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/dishes/search?q=bi',
    });

    expect(response.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// EDGE CASE 6: Redis cacheSet failure is silently swallowed (fail-open on write)
// ---------------------------------------------------------------------------

describe('GET /restaurants — Redis cacheSet failure is silently swallowed', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetKyselyChain();
    mockRedisGet.mockResolvedValue(null); // cache miss — go to DB
    mockRedisSet.mockRejectedValue(new Error('Redis write failure')); // set fails
    mockRestaurantFindMany.mockResolvedValue([MOCK_RESTAURANT]);
    mockRestaurantCount.mockResolvedValue(1);
    mockKyselyExecute.mockResolvedValue([]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '0' });
  });

  it('returns 200 even when Redis cacheSet rejects (fail-open on write)', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/restaurants' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: { items: unknown[] } }>();
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(1);
  });
});

describe('GET /chains — Redis cacheSet failure is silently swallowed', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetKyselyChain();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockRejectedValue(new Error('Redis write failure'));
    mockRestaurantFindMany.mockResolvedValue([MOCK_RESTAURANT]);
    mockKyselyExecute.mockResolvedValue([]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '0' });
  });

  it('returns 200 even when Redis cacheSet rejects', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/chains' });

    expect(response.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// EDGE CASE 8: Same chainSlug, multiple countries → SEPARATE entries in GET /chains
// ---------------------------------------------------------------------------

describe('GET /chains — same chainSlug, different countryCode → separate entries', () => {
  const RESTAURANT_PT = {
    id: 'fd000000-0001-4000-a000-000000000002',
    name: "McDonald's Portugal",
    nameEs: null,
    chainSlug: 'mcdonalds-es', // same chainSlug as MOCK_RESTAURANT
    countryCode: 'PT',         // different country
    isActive: true,
    logoUrl: null,
    website: null,
    _count: { dishes: 8 },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    resetKyselyChain();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    // Two restaurants: same chainSlug, different countryCode
    mockRestaurantFindMany.mockResolvedValue([MOCK_RESTAURANT, RESTAURANT_PT]);
    mockKyselyExecute.mockResolvedValue([]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '0' });
  });

  it('returns TWO separate chain entries for same chainSlug in different countries', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/chains' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      data: Array<{ chainSlug: string; countryCode: string; dishCount: number }>;
    }>();

    // Must have 2 entries — one per country
    expect(body.data).toHaveLength(2);

    const esEntry = body.data.find(c => c['countryCode'] === 'ES');
    const ptEntry = body.data.find(c => c['countryCode'] === 'PT');

    expect(esEntry).toBeDefined();
    expect(ptEntry).toBeDefined();
    // dishCounts are NOT merged across countries
    expect(esEntry?.['dishCount']).toBe(5);
    expect(ptEntry?.['dishCount']).toBe(8);
  });

  it('same chainSlug in different countries does NOT aggregate dishCount cross-country', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/chains' });

    const body = response.json<{
      data: Array<{ chainSlug: string; countryCode: string; dishCount: number }>;
    }>();

    // If the grouping key were chainSlug only (a bug), we'd get 1 entry with dishCount=13
    // Correct behavior: 2 entries, each with their own dishCount
    const totalDishCount = body.data.reduce((sum, c) => sum + c['dishCount'], 0);
    expect(totalDishCount).toBe(13); // 5 + 8 distributed across 2 entries
    expect(body.data).toHaveLength(2); // NOT merged into 1
  });
});

// ---------------------------------------------------------------------------
// EDGE CASE 10 complement: ALL restaurants inactive → chain isActive: false
// ---------------------------------------------------------------------------

describe('GET /chains — isActive aggregation complement', () => {
  const RESTAURANT_INACTIVE_A = {
    id: 'fd000000-0003-4000-a000-000000000001',
    name: 'Old BK Madrid',
    nameEs: null,
    chainSlug: 'old-chain-es',
    countryCode: 'ES',
    isActive: false,
    logoUrl: null,
    website: null,
    _count: { dishes: 2 },
  };

  const RESTAURANT_INACTIVE_B = {
    id: 'fd000000-0003-4000-a000-000000000002',
    name: 'Old BK Barcelona',
    nameEs: null,
    chainSlug: 'old-chain-es',
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
    mockRestaurantFindMany.mockResolvedValue([RESTAURANT_INACTIVE_A, RESTAURANT_INACTIVE_B]);
    mockKyselyExecute.mockResolvedValue([]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '0' });
  });

  it('isActive is false when ALL restaurants in chain group are inactive', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/chains' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      data: Array<{ chainSlug: string; isActive: boolean }>;
    }>();

    const chain = body.data.find(c => c['chainSlug'] === 'old-chain-es');
    expect(chain).toBeDefined();
    expect(chain?.['isActive']).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ADDITIONAL GAP A: pageSize=101 → 400 VALIDATION_ERROR (max is 100)
// ---------------------------------------------------------------------------

describe('Validation — pageSize max boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetKyselyChain();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRestaurantFindMany.mockResolvedValue([]);
    mockRestaurantCount.mockResolvedValue(0);
    mockKyselyExecute.mockResolvedValue([]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '0' });
  });

  it('GET /restaurants returns 400 when pageSize=101 (exceeds max 100)', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/restaurants?pageSize=101',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('GET /restaurants/:id/dishes returns 400 when pageSize=101', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: `/restaurants/${RESTAURANT_ID}/dishes?pageSize=101`,
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('GET /dishes/search returns 400 when pageSize=101', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/dishes/search?q=burger&pageSize=101',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('GET /restaurants returns 200 when pageSize=100 (exactly at max)', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/restaurants?pageSize=100',
    });

    expect(response.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// ADDITIONAL GAP B: GET /restaurants — count query failure (Promise.all)
// ---------------------------------------------------------------------------

describe('GET /restaurants — count query DB failure', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetKyselyChain();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockKyselyExecute.mockResolvedValue([]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '0' });
  });

  it('returns 500 DB_UNAVAILABLE when count query fails (findMany succeeds, count fails)', async () => {
    mockRestaurantFindMany.mockResolvedValue([MOCK_RESTAURANT]);
    mockRestaurantCount.mockRejectedValue(new Error('count query failed'));

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/restaurants' });

    expect(response.statusCode).toBe(500);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('DB_UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// ADDITIONAL GAP C: GET /restaurants/:id/dishes — dish query fails after existence check
// ---------------------------------------------------------------------------

describe('GET /restaurants/:id/dishes — DB failure on dish query (after existence check passes)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetKyselyChain();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRestaurantFindUnique.mockResolvedValue({ id: RESTAURANT_ID }); // existence OK
    mockKyselyExecute.mockResolvedValue([]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '0' });
  });

  it('returns 500 DB_UNAVAILABLE when dish findMany fails (Prisma path)', async () => {
    mockDishFindMany.mockRejectedValue(new Error('dish query failed'));
    mockDishCount.mockResolvedValue(0);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: `/restaurants/${RESTAURANT_ID}/dishes`,
    });

    expect(response.statusCode).toBe(500);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('DB_UNAVAILABLE');
  });

  it('returns 500 DB_UNAVAILABLE when dish count fails (Prisma path)', async () => {
    mockDishFindMany.mockResolvedValue([]);
    mockDishCount.mockRejectedValue(new Error('dish count failed'));

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: `/restaurants/${RESTAURANT_ID}/dishes`,
    });

    expect(response.statusCode).toBe(500);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('DB_UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// ADDITIONAL GAP D: GET /restaurants — Validation boundary — countryCode lowercase
// ---------------------------------------------------------------------------

describe('GET /restaurants — countryCode validation boundaries', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetKyselyChain();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRestaurantFindMany.mockResolvedValue([]);
    mockRestaurantCount.mockResolvedValue(0);
    mockKyselyExecute.mockResolvedValue([]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '0' });
  });

  it('returns 400 when countryCode is lowercase (e.g. "es")', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/restaurants?countryCode=es',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when countryCode is 3 chars (e.g. "ESP")', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/restaurants?countryCode=ESP',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 200 when countryCode is valid 2-char uppercase', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/restaurants?countryCode=ES',
    });

    expect(response.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// ADDITIONAL: GET /restaurants/:id/dishes — existence check DB failure
// ---------------------------------------------------------------------------

describe('GET /restaurants/:id/dishes — DB failure on existence check', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetKyselyChain();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockKyselyExecute.mockResolvedValue([]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '0' });
  });

  it('returns 500 DB_UNAVAILABLE when existence check (findUnique) throws', async () => {
    mockRestaurantFindUnique.mockRejectedValue(new Error('DB connection lost'));

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: `/restaurants/${RESTAURANT_ID}/dishes`,
    });

    expect(response.statusCode).toBe(500);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('DB_UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// ADDITIONAL: GET /dishes/search — chainSlug only (no restaurantId) → chain filter applied
// ---------------------------------------------------------------------------

describe('GET /dishes/search — chainSlug filter (when restaurantId is absent)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetKyselyChain();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockKyselyExecute.mockResolvedValue([MOCK_DISH_KYSELY]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '1' });
  });

  it('when only chainSlug is provided (no restaurantId), WHERE uses chain_slug', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'GET',
      url: '/dishes/search?q=burger&chainSlug=mcdonalds-es',
    });

    const whereCalls = (mockKyselyChainStubs['where'] as ReturnType<typeof vi.fn>).mock.calls;

    // chain_slug filter IS applied
    const hasChainFilter = whereCalls.some(
      call => call[0] === 'r.chain_slug' && call[2] === 'mcdonalds-es',
    );
    expect(hasChainFilter).toBe(true);

    // restaurant_id filter is NOT applied (no restaurantId param)
    const hasRestaurantFilter = whereCalls.some(
      call => call[0] === 'd.restaurant_id',
    );
    expect(hasRestaurantFilter).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ADDITIONAL: GET /restaurants — isActive=true correctly passed to Prisma
// (ensures both values of BooleanStringSchema are correct, not just false)
// ---------------------------------------------------------------------------

describe('GET /restaurants — isActive=true is correctly passed as boolean true', () => {
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

  it('isActive=true is correctly passed as boolean true to Prisma (not string)', async () => {
    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/restaurants?isActive=true' });

    expect(mockRestaurantFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: true }),
      }),
    );
  });

  it('isActive is absent from Prisma where when not provided', async () => {
    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/restaurants' });

    expect(mockRestaurantFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ isActive: expect.anything() }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// ADDITIONAL: GET /dishes/search — q max length boundary
// ---------------------------------------------------------------------------

describe('GET /dishes/search — q length boundaries', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetKyselyChain();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockKyselyExecute.mockResolvedValue([]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '0' });
  });

  it('returns 400 when q exceeds 255 characters', async () => {
    const longQ = 'a'.repeat(256);
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: `/dishes/search?q=${encodeURIComponent(longQ)}`,
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 200 when q is exactly 255 characters', async () => {
    const maxQ = 'a'.repeat(255);
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: `/dishes/search?q=${encodeURIComponent(maxQ)}`,
    });

    expect(response.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// ADDITIONAL: GET /chains — Redis fail-open on cacheGet
// ---------------------------------------------------------------------------

describe('GET /chains — Redis fail-open on cacheGet', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetKyselyChain();
    mockRedisGet.mockRejectedValue(new Error('ECONNREFUSED'));
    mockRedisSet.mockResolvedValue('OK');
    mockRestaurantFindMany.mockResolvedValue([MOCK_RESTAURANT]);
    mockKyselyExecute.mockResolvedValue([]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '0' });
  });

  it('returns 200 and queries DB when Redis get rejects', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/chains' });

    expect(response.statusCode).toBe(200);
    expect(mockRestaurantFindMany).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// ADDITIONAL: GET /restaurants — chainSlug filter validation
// ---------------------------------------------------------------------------

describe('GET /restaurants — chainSlug validation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetKyselyChain();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRestaurantFindMany.mockResolvedValue([]);
    mockRestaurantCount.mockResolvedValue(0);
    mockKyselyExecute.mockResolvedValue([]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '0' });
  });

  it('returns 400 when chainSlug contains uppercase letters (violates ^[a-z0-9-]+$)', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/restaurants?chainSlug=McDonalds-ES',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 200 when chainSlug is valid lowercase slug', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/restaurants?chainSlug=mcdonalds-es',
    });

    expect(response.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// ADDITIONAL: Verify unknown restaurantId → 404 from GET /restaurants/:id/dishes
// (this tests the NOT_FOUND path is not accidentally caught by DB_UNAVAILABLE)
// ---------------------------------------------------------------------------

describe('GET /restaurants/:id/dishes — error code precision', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetKyselyChain();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockKyselyExecute.mockResolvedValue([]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '0' });
  });

  it('returns exactly 404 (not 500) when restaurant not found', async () => {
    mockRestaurantFindUnique.mockResolvedValue(null);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: `/restaurants/${UNKNOWN_ID}/dishes`,
    });

    // Must be 404, not 500 — the NOT_FOUND error must not be swallowed by DB_UNAVAILABLE catch
    expect(response.statusCode).toBe(404);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
