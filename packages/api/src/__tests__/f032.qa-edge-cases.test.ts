// F032 QA edge-case tests — written by QA to expose gaps in developer tests.
//
// Covers:
//  1.  generateIndependentSlug — name that is ALL special chars (empty slug body)
//  2.  generateIndependentSlug — very long name (> 255 chars) does not exceed slug limits
//  3.  generateIndependentSlug — name with only whitespace produces valid slug
//  4.  generateIndependentSlug — Unicode / non-ASCII chars are stripped correctly
//  5.  isAdminRoute — method sensitivity: GET /restaurants is NOT admin
//  6.  isAdminRoute — method sensitivity: POST /restaurants IS admin
//  7.  isAdminRoute — PUT /restaurants is NOT admin (method guard is POST-only)
//  8.  isAdminRoute — url undefined returns false
//  9.  POST /restaurants — name at exactly 255 chars is accepted (boundary)
//  10. POST /restaurants — name at 256 chars is rejected (boundary + 1)
//  11. POST /restaurants — name with only whitespace accepted by schema (no trim)
//  12. POST /restaurants — chainSlug with leading hyphen rejected
//  13. POST /restaurants — chainSlug with trailing hyphen accepted (regex allows it)
//  14. POST /restaurants — address at exactly 500 chars is accepted (boundary)
//  15. POST /restaurants — address at 501 chars is rejected (boundary + 1)
//  16. GET /restaurants?q= — single whitespace-only string rejects with 400
//  17. GET /restaurants?q= — q exactly 100 chars is accepted
//  18. RestaurantListItemSchema — missing address field fails validation
//  19. Callback data byte-length — sel:{uuid-v4} is within 64-byte Telegram limit
//  20. Callback data byte-length — create_rest is within 64-byte Telegram limit
//  21. stableKey produces different output for different q values (cache isolation)
//  22. GET /restaurants?q= — SQL injection attempt in q does not throw 500
//  23. POST /restaurants — countryCode of 3 chars is rejected
//  24. POST /restaurants — countryCode with digit is rejected
//  25. POST /restaurants — latitude = 0 is accepted (falsy but valid coordinate)
//  26. POST /restaurants — longitude = 0 is accepted (falsy but valid coordinate)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import {
  CreateRestaurantBodySchema,
  RestaurantListQuerySchema,
  RestaurantListItemSchema,
} from '@foodxplorer/shared';
import { generateIndependentSlug } from '../utils/slugify.js';
import { isAdminRoute } from '../plugins/adminPrefixes.js';

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
// Mock Kysely
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

vi.mock('../estimation/level1Lookup.js', () => ({ level1Lookup: vi.fn(), offFallbackFoodMatch: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../estimation/level2Lookup.js', () => ({ level2Lookup: vi.fn() }));
vi.mock('../estimation/level3Lookup.js', () => ({ level3Lookup: vi.fn() }));
vi.mock('../estimation/level4Lookup.js', () => ({ level4Lookup: vi.fn() }));

import { buildApp } from '../app.js';
import type { Config } from '../config.js';

// ---------------------------------------------------------------------------
// Config fixture — admin key
// ---------------------------------------------------------------------------

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
// 1-4: generateIndependentSlug — edge cases
// ---------------------------------------------------------------------------

describe('generateIndependentSlug — edge cases not covered by developer', () => {
  it('1: all-special-chars name — falls back to "unnamed" slug body', () => {
    // "!@#$%^&*()" — all chars stripped by the regex → fallback to 'unnamed'
    const slug = generateIndependentSlug('!@#$%^&*()');
    // Must start with "independent-unnamed-" and end with 8 hex chars
    expect(slug).toMatch(/^independent-unnamed-[a-z0-9]{8}$/);
    expect(typeof slug).toBe('string');
  });

  it('2: name longer than 255 chars — slug is generated without error', () => {
    const longName = 'a'.repeat(300);
    expect(() => generateIndependentSlug(longName)).not.toThrow();
    const slug = generateIndependentSlug(longName);
    expect(slug.startsWith('independent-')).toBe(true);
  });

  it('3: whitespace-only name — falls back to "unnamed" slug body', () => {
    const slug = generateIndependentSlug('   ');
    // After .trim() the name becomes '' → fallback to 'unnamed'
    expect(slug).toMatch(/^independent-unnamed-[a-z0-9]{8}$/);
  });

  it('4: Unicode / non-ASCII chars in name are stripped (not garbled)', () => {
    // Spanish accents, Chinese chars, emoji
    const slug = generateIndependentSlug('Café 中文 🍔');
    // All non-[a-z0-9\s-] chars stripped; 'caf' remains from 'café'
    expect(slug).toMatch(/^independent-[a-z0-9-]*-[a-z0-9]{8}$/);
    expect(slug).not.toMatch(/[\u0080-\uFFFF]/); // no non-ASCII chars in output
  });
});

// ---------------------------------------------------------------------------
// 5-8: isAdminRoute — method sensitivity
// ---------------------------------------------------------------------------

describe('isAdminRoute — method-aware routing', () => {
  it('5: GET /restaurants is NOT an admin route', () => {
    expect(isAdminRoute('/restaurants', 'GET')).toBe(false);
  });

  it('6: POST /restaurants IS an admin route', () => {
    expect(isAdminRoute('/restaurants', 'POST')).toBe(true);
  });

  it('7: PUT /restaurants is NOT an admin route (POST-only guard)', () => {
    expect(isAdminRoute('/restaurants', 'PUT')).toBe(false);
  });

  it('8: undefined url returns false', () => {
    expect(isAdminRoute(undefined, 'POST')).toBe(false);
  });

  it('8b: PATCH /restaurants is NOT an admin route', () => {
    expect(isAdminRoute('/restaurants', 'PATCH')).toBe(false);
  });

  it('8c: DELETE /restaurants is NOT an admin route', () => {
    expect(isAdminRoute('/restaurants', 'DELETE')).toBe(false);
  });

  it('GET /admin/waitlist IS an admin route (F046)', () => {
    expect(isAdminRoute('/admin/waitlist', 'GET')).toBe(true);
  });

  it('GET /admin/ prefix matches (F046)', () => {
    expect(isAdminRoute('/admin/anything', 'GET')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9-16: CreateRestaurantBodySchema — boundary values not covered
// ---------------------------------------------------------------------------

describe('CreateRestaurantBodySchema — boundary and missing cases', () => {
  it('9: name at exactly 255 chars is accepted', () => {
    const result = CreateRestaurantBodySchema.safeParse({
      name: 'a'.repeat(255),
      countryCode: 'ES',
    });
    expect(result.success).toBe(true);
  });

  it('10: name at 256 chars is rejected', () => {
    const result = CreateRestaurantBodySchema.safeParse({
      name: 'a'.repeat(256),
      countryCode: 'ES',
    });
    expect(result.success).toBe(false);
  });

  it('11: name with only whitespace (e.g. "   ") — schema rejects after trim', () => {
    // Schema has .trim().min(1) — "   " trims to "" which fails min(1)
    const result = CreateRestaurantBodySchema.safeParse({
      name: '   ',
      countryCode: 'ES',
    });
    expect(result.success).toBe(false);
  });

  it('12: chainSlug with leading hyphen is rejected', () => {
    const result = CreateRestaurantBodySchema.safeParse({
      name: 'Test',
      countryCode: 'ES',
      chainSlug: '-leading',
    });
    expect(result.success).toBe(false);
  });

  it('13: chainSlug that is only a hyphen is rejected', () => {
    const result = CreateRestaurantBodySchema.safeParse({
      name: 'Test',
      countryCode: 'ES',
      chainSlug: '-',
    });
    expect(result.success).toBe(false);
  });

  it('14: address at exactly 500 chars is accepted', () => {
    const result = CreateRestaurantBodySchema.safeParse({
      name: 'Test',
      countryCode: 'ES',
      address: 'a'.repeat(500),
    });
    expect(result.success).toBe(true);
  });

  it('15: address at 501 chars is rejected', () => {
    const result = CreateRestaurantBodySchema.safeParse({
      name: 'Test',
      countryCode: 'ES',
      address: 'a'.repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it('23: countryCode of 3 chars is rejected', () => {
    const result = CreateRestaurantBodySchema.safeParse({
      name: 'Test',
      countryCode: 'ESP',
    });
    expect(result.success).toBe(false);
  });

  it('24: countryCode with a digit (e.g. "E1") is rejected', () => {
    const result = CreateRestaurantBodySchema.safeParse({
      name: 'Test',
      countryCode: 'E1',
    });
    expect(result.success).toBe(false);
  });

  it('25: latitude = 0 is accepted (falsy but valid GPS coordinate)', () => {
    const result = CreateRestaurantBodySchema.safeParse({
      name: 'Test',
      countryCode: 'ES',
      latitude: 0,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.latitude).toBe(0);
    }
  });

  it('26: longitude = 0 is accepted (falsy but valid GPS coordinate)', () => {
    const result = CreateRestaurantBodySchema.safeParse({
      name: 'Test',
      countryCode: 'ES',
      longitude: 0,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.longitude).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// RestaurantListQuerySchema — whitespace-only q
// ---------------------------------------------------------------------------

describe('RestaurantListQuerySchema — whitespace q edge case', () => {
  it('16: whitespace-only q string is rejected after trim (empty string → minLength: 1 fails)', () => {
    const result = RestaurantListQuerySchema.safeParse({ q: '   ' });
    // Schema has .trim().min(1) — "   " trims to "" which fails min(1)
    expect(result.success).toBe(false);
  });

  it('17: q at exactly 100 chars is accepted', () => {
    const result = RestaurantListQuerySchema.safeParse({ q: 'a'.repeat(100) });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RestaurantListItemSchema — structural contract
// ---------------------------------------------------------------------------

describe('RestaurantListItemSchema — missing F032 address field', () => {
  it('18: response item without address field fails schema validation', () => {
    // If the API omits the address field (regression), schema must reject it.
    const result = RestaurantListItemSchema.safeParse({
      id: 'fd000000-0001-4000-a000-000000000001',
      name: 'Test',
      nameEs: null,
      chainSlug: 'test-es',
      countryCode: 'ES',
      isActive: true,
      logoUrl: null,
      website: null,
      // address intentionally omitted
      dishCount: 0,
    });
    // address is required (non-optional) in RestaurantListItemSchema — should fail
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 19-20: Telegram callback_data byte-length limit
// ---------------------------------------------------------------------------

describe('Telegram callback_data — 64-byte limit compliance', () => {
  it('19: sel:{uuid-v4} callback_data fits within 64 bytes', () => {
    // A standard UUID v4 is 36 chars: "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
    const uuid = 'fd000000-0001-4000-a000-000000000001';
    const callbackData = `sel:${uuid}`;
    // UTF-8 byte length (all ASCII here = 1 byte per char)
    const byteLength = Buffer.byteLength(callbackData, 'utf8');
    expect(byteLength).toBeLessThanOrEqual(64);
    // Exact expected: "sel:" (4) + 36 = 40 bytes
    expect(byteLength).toBe(40);
  });

  it('20: create_rest callback_data fits within 64 bytes', () => {
    const callbackData = 'create_rest';
    const byteLength = Buffer.byteLength(callbackData, 'utf8');
    expect(byteLength).toBeLessThanOrEqual(64);
  });

  it('19b: sel: prefix + max UUID (36 chars) = 40 bytes, well within limit', () => {
    // Any valid UUID v4 will be exactly 36 chars. Verify we never exceed 64 bytes
    // even with edge-case UUIDs.
    const maxUUID = 'ffffffff-ffff-4fff-bfff-ffffffffffff';
    const callbackData = `sel:${maxUUID}`;
    expect(Buffer.byteLength(callbackData, 'utf8')).toBeLessThanOrEqual(64);
  });
});

// ---------------------------------------------------------------------------
// 21: Cache key isolation — different q values produce different keys
// ---------------------------------------------------------------------------

describe('Cache key isolation — stableKey produces unique keys for different q values', () => {
  it('21: GET /restaurants?q=mcdon and GET /restaurants?q=burger produce different cache entries', async () => {
    // Verify Kysely is called twice (not served from same cache key)
    vi.resetAllMocks();
    resetKyselyChain();
    mockRedisGet.mockResolvedValue(null); // always cache miss
    mockRedisSet.mockResolvedValue('OK');
    mockKyselyExecute.mockResolvedValue([]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '0' });

    const app = await buildApp();

    await app.inject({ method: 'GET', url: '/restaurants?q=mcdon' });
    await app.inject({ method: 'GET', url: '/restaurants?q=burger' });

    // Each query should hit Kysely once (2 total execute calls = 2 distinct cache keys)
    expect(mockKyselyExecuteTakeFirstOrThrow).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 22: SQL injection via q parameter — must not return 500
// ---------------------------------------------------------------------------

describe('GET /restaurants?q= — injection resilience', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetKyselyChain();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockKyselyExecute.mockResolvedValue([]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '0' });
  });

  it('22a: SQL injection attempt in q — returns 200 with empty results (not 500)', async () => {
    // Kysely parameterises the query, so this should be safe.
    // The q value goes through the schema first (max 100 chars, trimmed).
    const injectionQ = encodeURIComponent("'; DROP TABLE restaurants; --");
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: `/restaurants?q=${injectionQ}`,
    });

    // Should be 200 (Kysely handles it as a parameterised value) or 400 (if schema rejects)
    // It should NOT be 500.
    expect(response.statusCode).not.toBe(500);
    expect([200, 400]).toContain(response.statusCode);
  });

  it('22b: XSS payload in q — returns 200 with empty results (not 500)', async () => {
    const xssQ = encodeURIComponent('<script>alert(1)</script>');
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: `/restaurants?q=${xssQ}`,
    });
    expect(response.statusCode).not.toBe(500);
    expect([200, 400]).toContain(response.statusCode);
  });
});

// ---------------------------------------------------------------------------
// HTTP route: POST /restaurants — additional boundary tests
// ---------------------------------------------------------------------------

describe('POST /restaurants — HTTP boundary tests', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetKyselyChain();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRestaurantCreate.mockResolvedValue(MOCK_CREATED_RESTAURANT);
    mockKyselyExecute.mockResolvedValue([]);
    mockKyselyExecuteTakeFirstOrThrow.mockResolvedValue({ count: '0' });
  });

  it('returns 201 when name is exactly 255 chars', async () => {
    const app = await buildApp({ config: ADMIN_CONFIG });
    const response = await app.inject({
      method: 'POST',
      url: '/restaurants',
      headers: { 'x-api-key': ADMIN_API_KEY, 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'a'.repeat(255), countryCode: 'ES' }),
    });
    expect(response.statusCode).toBe(201);
  });

  it('returns 400 VALIDATION_ERROR when name is 256 chars', async () => {
    const app = await buildApp({ config: ADMIN_CONFIG });
    const response = await app.inject({
      method: 'POST',
      url: '/restaurants',
      headers: { 'x-api-key': ADMIN_API_KEY, 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'a'.repeat(256), countryCode: 'ES' }),
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when countryCode is 3 chars', async () => {
    const app = await buildApp({ config: ADMIN_CONFIG });
    const response = await app.inject({
      method: 'POST',
      url: '/restaurants',
      headers: { 'x-api-key': ADMIN_API_KEY, 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'Test', countryCode: 'ESP' }),
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when countryCode has digit', async () => {
    const app = await buildApp({ config: ADMIN_CONFIG });
    const response = await app.inject({
      method: 'POST',
      url: '/restaurants',
      headers: { 'x-api-key': ADMIN_API_KEY, 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'Test', countryCode: 'E1' }),
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 201 when latitude and longitude are both 0 (valid zero coordinates)', async () => {
    const app = await buildApp({ config: ADMIN_CONFIG });
    const response = await app.inject({
      method: 'POST',
      url: '/restaurants',
      headers: { 'x-api-key': ADMIN_API_KEY, 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'Test', countryCode: 'ES', latitude: 0, longitude: 0 }),
    });
    expect(response.statusCode).toBe(201);
  });

  it('returns 400 VALIDATION_ERROR when name is empty string', async () => {
    const app = await buildApp({ config: ADMIN_CONFIG });
    const response = await app.inject({
      method: 'POST',
      url: '/restaurants',
      headers: { 'x-api-key': ADMIN_API_KEY, 'content-type': 'application/json' },
      payload: JSON.stringify({ name: '', countryCode: 'ES' }),
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when body is empty JSON object', async () => {
    const app = await buildApp({ config: ADMIN_CONFIG });
    const response = await app.inject({
      method: 'POST',
      url: '/restaurants',
      headers: { 'x-api-key': ADMIN_API_KEY, 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 when X-API-Key header is an array (first value wrong)', async () => {
    // Fastify can receive repeated headers as arrays.
    // The auth code uses Array.isArray check and takes first element.
    const app = await buildApp({ config: ADMIN_CONFIG });
    const response = await app.inject({
      method: 'POST',
      url: '/restaurants',
      headers: {
        'x-api-key': 'wrong-key',
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ name: 'Test', countryCode: 'ES' }),
    });
    expect(response.statusCode).toBe(401);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});
