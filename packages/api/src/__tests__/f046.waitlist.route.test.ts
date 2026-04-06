// Route-level unit tests for F046 — POST /waitlist and GET /admin/waitlist
//
// Uses buildApp().inject() with mocked Prisma and Redis.
// Mocking strategy follows f032.catalog.route.test.ts pattern.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
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
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  } as unknown as Redis,
}));

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

const {
  mockWaitlistCreate,
  mockWaitlistFindUnique,
  mockWaitlistFindMany,
  mockWaitlistCount,
} = vi.hoisted(() => ({
  mockWaitlistCreate: vi.fn(),
  mockWaitlistFindUnique: vi.fn(),
  mockWaitlistFindMany: vi.fn(),
  mockWaitlistCount: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    waitlistSubmission: {
      create: mockWaitlistCreate,
      findUnique: mockWaitlistFindUnique,
      findMany: mockWaitlistFindMany,
      count: mockWaitlistCount,
    },
  } as unknown as PrismaClient,
}));

// ---------------------------------------------------------------------------
// Mock Kysely
// ---------------------------------------------------------------------------

const {
  mockKyselyExecute,
  mockKyselyChainStubs,
} = vi.hoisted(() => {
  const execute = vi.fn().mockResolvedValue([]);

  const chainMethodNames = [
    'selectFrom', 'innerJoin', 'select', 'where', 'orderBy',
    'limit', 'offset', '$if',
  ] as const;

  const stub: Record<string, unknown> = {};
  for (const method of chainMethodNames) {
    stub[method] = vi.fn();
  }
  stub['execute'] = execute;
  stub['executeTakeFirstOrThrow'] = vi.fn().mockResolvedValue({ count: '0' });
  stub['fn'] = {
    countAll: vi.fn().mockReturnValue({ as: vi.fn().mockReturnValue('count') }),
  };

  for (const method of chainMethodNames) {
    (stub[method] as ReturnType<typeof vi.fn>).mockReturnValue(stub);
  }

  return { mockKyselyExecute: execute, mockKyselyChainStubs: stub };
});

vi.mock('../lib/kysely.js', () => ({
  getKysely: () => mockKyselyChainStubs,
  destroyKysely: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock estimation lookups (transitive imports from buildApp)
// ---------------------------------------------------------------------------

vi.mock('../estimation/level1Lookup.js', () => ({ level1Lookup: vi.fn(), offFallbackFoodMatch: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../estimation/level2Lookup.js', () => ({ level2Lookup: vi.fn() }));
vi.mock('../estimation/level3Lookup.js', () => ({ level3Lookup: vi.fn() }));
vi.mock('../estimation/level4Lookup.js', () => ({ level4Lookup: vi.fn() }));

// ---------------------------------------------------------------------------
// Import buildApp after mocks
// ---------------------------------------------------------------------------

import { buildApp } from '../app.js';
import type { Config } from '../config.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_CONFIG: Partial<Config> = { NODE_ENV: 'test' };

const SUBMISSION_ID = 'fd000000-0046-4000-a000-000000000001';

const MOCK_SUBMISSION = {
  id: SUBMISSION_ID,
  email: 'user@example.com',
  phone: '+34612345678',
  variant: 'a',
  source: 'hero',
  utmSource: 'google',
  utmMedium: 'cpc',
  utmCampaign: 'launch-2026',
  ipAddress: '127.0.0.1',
  createdAt: new Date('2026-03-28T12:00:00Z'),
};

const VALID_BODY = {
  email: 'user@example.com',
  phone: '+34612345678',
  variant: 'a',
  source: 'hero',
  utm_source: 'google',
  utm_medium: 'cpc',
  utm_campaign: 'launch-2026',
  honeypot: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockWaitlistCreate.mockResolvedValue(MOCK_SUBMISSION);
  mockWaitlistFindUnique.mockResolvedValue(MOCK_SUBMISSION);
  mockWaitlistFindMany.mockResolvedValue([MOCK_SUBMISSION]);
  mockWaitlistCount.mockResolvedValue(1);
  mockKyselyExecute.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// POST /waitlist — happy path
// ---------------------------------------------------------------------------

describe('POST /waitlist — happy path', () => {
  it('returns 201 with { success: true, data: { id, email } } for valid JSON body', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });

    const res = await app.inject({
      method: 'POST',
      url: '/waitlist',
      headers: { 'content-type': 'application/json' },
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ success: boolean; data: { id: string; email: string } }>();
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(SUBMISSION_ID);
    expect(body.data.email).toBe('user@example.com');
    expect(mockWaitlistCreate).toHaveBeenCalledOnce();

    await app.close();
  });

  it('accepts application/x-www-form-urlencoded body and redirects 303 (progressive enhancement)', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });

    const formPayload = new URLSearchParams({
      email: 'user@example.com',
      variant: 'a',
      source: 'hero',
      honeypot: '',
    }).toString();

    const res = await app.inject({
      method: 'POST',
      url: '/waitlist',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: formPayload,
    });

    // Form POST uses progressive enhancement: 303 redirect on success
    expect(res.statusCode).toBe(303);
    expect(mockWaitlistCreate).toHaveBeenCalledOnce();

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// POST /waitlist — honeypot
// ---------------------------------------------------------------------------

describe('POST /waitlist — honeypot', () => {
  it('returns 400 VALIDATION_ERROR when honeypot field is non-empty', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });

    const res = await app.inject({
      method: 'POST',
      url: '/waitlist',
      headers: { 'content-type': 'application/json' },
      payload: { ...VALID_BODY, honeypot: 'bot@spam.com' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ success: boolean; error: { code: string } }>();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');

    await app.close();
  });

  it('does NOT call prisma.waitlistSubmission.create when honeypot is filled', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });

    await app.inject({
      method: 'POST',
      url: '/waitlist',
      headers: { 'content-type': 'application/json' },
      payload: { ...VALID_BODY, honeypot: 'filled' },
    });

    expect(mockWaitlistCreate).not.toHaveBeenCalled();

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// POST /waitlist — duplicate email
// ---------------------------------------------------------------------------

describe('POST /waitlist — duplicate email', () => {
  it('returns 409 with DUPLICATE_EMAIL when email already exists', async () => {
    const p2002Error = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`email`)',
      { code: 'P2002', clientVersion: '6.4.1' },
    );
    mockWaitlistCreate.mockRejectedValue(p2002Error);
    mockWaitlistFindUnique.mockResolvedValue(MOCK_SUBMISSION);

    const app = await buildApp({ config: TEST_CONFIG as Config });

    const res = await app.inject({
      method: 'POST',
      url: '/waitlist',
      headers: { 'content-type': 'application/json' },
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(409);
    const body = res.json<{ success: boolean; error: { code: string } }>();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('DUPLICATE_EMAIL');

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// POST /waitlist — validation errors
// ---------------------------------------------------------------------------

describe('POST /waitlist — validation errors', () => {
  it('returns 400 when email is missing', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });

    const res = await app.inject({
      method: 'POST',
      url: '/waitlist',
      headers: { 'content-type': 'application/json' },
      payload: { variant: 'a', source: 'hero' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');

    await app.close();
  });

  it('returns 400 when email format is invalid', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });

    const res = await app.inject({
      method: 'POST',
      url: '/waitlist',
      headers: { 'content-type': 'application/json' },
      payload: { ...VALID_BODY, email: 'notanemail' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');

    await app.close();
  });

  it('returns 400 when variant is invalid', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });

    const res = await app.inject({
      method: 'POST',
      url: '/waitlist',
      headers: { 'content-type': 'application/json' },
      payload: { ...VALID_BODY, variant: 'z' },
    });

    expect(res.statusCode).toBe(400);

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// GET /admin/waitlist — happy path
// ---------------------------------------------------------------------------

describe('GET /admin/waitlist — happy path', () => {
  it('returns 200 with { success: true, data: { submissions, total, limit, offset } }', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/waitlist',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      success: boolean;
      data: { submissions: unknown[]; total: number; limit: number; offset: number };
    }>();
    expect(body.success).toBe(true);
    expect(body.data.submissions).toHaveLength(1);
    expect(body.data.total).toBe(1);
    expect(body.data.limit).toBe(50);
    expect(body.data.offset).toBe(0);

    await app.close();
  });

  it('uses default pagination limit=50, offset=0', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });

    await app.inject({ method: 'GET', url: '/admin/waitlist' });

    expect(mockWaitlistFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 50,
        skip: 0,
      }),
    );

    await app.close();
  });

  it('passes correct orderBy for sort=created_at_asc', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });

    await app.inject({
      method: 'GET',
      url: '/admin/waitlist?sort=created_at_asc',
    });

    expect(mockWaitlistFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'asc' },
      }),
    );

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// GET /admin/waitlist — validation errors
// ---------------------------------------------------------------------------

describe('GET /admin/waitlist — validation errors', () => {
  it('returns 400 when limit=201', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/waitlist?limit=201',
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');

    await app.close();
  });

  it('returns 400 when sort=invalid_value', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/waitlist?sort=invalid_value',
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');

    await app.close();
  });
});
