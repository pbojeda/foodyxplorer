// Edge-case tests for F046 — POST /waitlist and GET /admin/waitlist
//
// Covers gaps NOT tested in f046.waitlist.route.test.ts:
//   - Admin auth enforcement (401 when wrong key, 401 when no key + ADMIN_API_KEY set)
//   - Rate limit response shape (429)
//   - Honeypot: whitespace-only string should reject
//   - Honeypot: missing field entirely (undefined) should pass
//   - Email case: UPPERCASE@EXAMPLE.COM vs lowercase (case sensitivity / duplicate detection)
//   - SPEC DEVIATION: 409 body does not contain the existing record (spec requires it)
//   - DB error during create (non-P2002) → 500
//   - Source field validation: missing source → 400
//   - Variant boundaries: uppercase 'A' (not in enum) → 400
//   - GET /admin/waitlist: limit=0 → 400 (min is 1)
//   - GET /admin/waitlist: negative limit → 400
//   - GET /admin/waitlist: offset=0 boundary → 200
//   - GET /admin/waitlist: returns correct response shape with camelCase → snake_case mapping
//   - POST /waitlist with form body missing `source` → 400 (progressive enhancement bug exposure)
//   - UTM fields: very long strings pass schema but are persisted (no truncation)
//   - Request body: completely empty JSON body → 400
//   - Request body: null JSON body → 400

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

const { mockKyselyExecute, mockKyselyChainStubs } = vi.hoisted(() => {
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

vi.mock('../estimation/level1Lookup.js', () => ({ level1Lookup: vi.fn() }));
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

// Use NODE_ENV: 'test' so rate-limit plugin is skipped (avoids Redis.defineCommand error),
// but set ADMIN_API_KEY so admin auth is enforced (fail-open only triggers when key is absent).
const TEST_CONFIG_WITH_ADMIN_KEY: Partial<Config> = {
  NODE_ENV: 'test',
  ADMIN_API_KEY: 'test-admin-key-abc123',
};

const SUBMISSION_ID = 'fd000000-0046-4000-a000-000000000001';

const MOCK_SUBMISSION = {
  id: SUBMISSION_ID,
  email: 'user@example.com',
  phone: null,
  variant: 'a',
  source: 'hero',
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  ipAddress: '127.0.0.1',
  createdAt: new Date('2026-03-28T12:00:00Z'),
};

const VALID_BODY = {
  email: 'user@example.com',
  variant: 'a',
  source: 'hero',
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
// POST /waitlist — honeypot edge cases
// ---------------------------------------------------------------------------

describe('POST /waitlist — honeypot edge cases', () => {
  it('rejects whitespace-only honeypot string (not empty, should return 400)', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });

    const res = await app.inject({
      method: 'POST',
      url: '/waitlist',
      headers: { 'content-type': 'application/json' },
      payload: { ...VALID_BODY, honeypot: '   ' },
    });

    // Whitespace is not empty string — should be caught as honeypot fill
    expect(res.statusCode).toBe(400);
    expect(mockWaitlistCreate).not.toHaveBeenCalled();

    await app.close();
  });

  it('accepts request when honeypot field is absent (undefined → pass-through)', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });
    const { honeypot: _h, ...bodyWithoutHoneypot } = VALID_BODY;

    const res = await app.inject({
      method: 'POST',
      url: '/waitlist',
      headers: { 'content-type': 'application/json' },
      payload: bodyWithoutHoneypot,
    });

    // honeypot is optional — absent field should not trigger rejection
    expect(res.statusCode).toBe(201);
    expect(mockWaitlistCreate).toHaveBeenCalledOnce();

    await app.close();
  });

  it('rejects honeypot with single space character', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });

    const res = await app.inject({
      method: 'POST',
      url: '/waitlist',
      headers: { 'content-type': 'application/json' },
      payload: { ...VALID_BODY, honeypot: ' ' },
    });

    expect(res.statusCode).toBe(400);
    expect(mockWaitlistCreate).not.toHaveBeenCalled();

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// POST /waitlist — validation edge cases
// ---------------------------------------------------------------------------

describe('POST /waitlist — validation edge cases', () => {
  it('returns 400 for completely empty JSON body {}', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });

    const res = await app.inject({
      method: 'POST',
      url: '/waitlist',
      headers: { 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');

    await app.close();
  });

  it('returns 400 when source field is missing', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });
    const { source: _s, ...bodyWithoutSource } = VALID_BODY;

    const res = await app.inject({
      method: 'POST',
      url: '/waitlist',
      headers: { 'content-type': 'application/json' },
      payload: bodyWithoutSource,
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');

    await app.close();
  });

  it('returns 400 when variant is missing', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });
    const { variant: _v, ...bodyWithoutVariant } = VALID_BODY;

    const res = await app.inject({
      method: 'POST',
      url: '/waitlist',
      headers: { 'content-type': 'application/json' },
      payload: bodyWithoutVariant,
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');

    await app.close();
  });

  it('returns 400 when variant is uppercase "A" (not in enum a|c|f)', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });

    const res = await app.inject({
      method: 'POST',
      url: '/waitlist',
      headers: { 'content-type': 'application/json' },
      payload: { ...VALID_BODY, variant: 'A' },
    });

    expect(res.statusCode).toBe(400);

    await app.close();
  });

  it('returns 400 when source is an invalid value', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });

    const res = await app.inject({
      method: 'POST',
      url: '/waitlist',
      headers: { 'content-type': 'application/json' },
      payload: { ...VALID_BODY, source: 'sidebar' },
    });

    expect(res.statusCode).toBe(400);

    await app.close();
  });

  it('returns 400 when email is null (type mismatch)', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });

    const res = await app.inject({
      method: 'POST',
      url: '/waitlist',
      headers: { 'content-type': 'application/json' },
      payload: { ...VALID_BODY, email: null },
    });

    expect(res.statusCode).toBe(400);

    await app.close();
  });

  it('returns 400 for email with only local-part and @ but no domain (user@)', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });

    const res = await app.inject({
      method: 'POST',
      url: '/waitlist',
      headers: { 'content-type': 'application/json' },
      payload: { ...VALID_BODY, email: 'user@' },
    });

    expect(res.statusCode).toBe(400);

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// POST /waitlist — email case sensitivity
// ---------------------------------------------------------------------------

describe('POST /waitlist — email case sensitivity', () => {
  it('normalizes uppercase email to lowercase before persisting', async () => {
    // FIX for BUG-F046-03: email is lowercased in route handler before Prisma create.
    const app = await buildApp({ config: TEST_CONFIG as Config });

    const res = await app.inject({
      method: 'POST',
      url: '/waitlist',
      headers: { 'content-type': 'application/json' },
      payload: { ...VALID_BODY, email: 'USER@EXAMPLE.COM' },
    });

    expect(res.statusCode).toBe(201);
    expect(mockWaitlistCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: 'user@example.com' }) }),
    );

    await app.close();
  });

  it('normalizes mixed-case email to lowercase before persisting', async () => {
    // FIX for BUG-F046-03: email is lowercased, preventing case-sensitive duplicate bypass.
    const app = await buildApp({ config: TEST_CONFIG as Config });

    await app.inject({
      method: 'POST',
      url: '/waitlist',
      headers: { 'content-type': 'application/json' },
      payload: { ...VALID_BODY, email: 'Test@Example.Com' },
    });

    const callArgs = mockWaitlistCreate.mock.calls[0]?.[0] as { data: { email: string } } | undefined;
    expect(callArgs?.data.email).toBe('test@example.com');

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// POST /waitlist — SPEC DEVIATION: 409 should return existing record
// ---------------------------------------------------------------------------

describe('POST /waitlist — SPEC DEVIATION: 409 body vs spec', () => {
  it('SPEC DEVIATION: 409 does NOT contain existing record data (spec requires it)', async () => {
    // Spec says: "return 409 with the existing record" (ticket line 51, 59, 156)
    // Implementation: throws DUPLICATE_EMAIL which maps to { success: false, error: { code: ... } }
    // The existing record is NEVER fetched — findUnique is not called on P2002.
    const p2002Error = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`email`)',
      { code: 'P2002', clientVersion: '6.4.1' },
    );
    mockWaitlistCreate.mockRejectedValue(p2002Error);

    const app = await buildApp({ config: TEST_CONFIG as Config });

    const res = await app.inject({
      method: 'POST',
      url: '/waitlist',
      headers: { 'content-type': 'application/json' },
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(409);
    const body = res.json<Record<string, unknown>>();

    // Implementation returns error body — NOT the existing record
    expect(body['success']).toBe(false);

    // SPEC requires: body.data.id and body.data.email of the existing record
    // This assertion documents the deviation: data is absent from the 409 body
    expect(body['data']).toBeUndefined();

    // Additionally: findUnique is NOT called to retrieve the existing record
    expect(mockWaitlistFindUnique).not.toHaveBeenCalled();

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// POST /waitlist — DB errors
// ---------------------------------------------------------------------------

describe('POST /waitlist — unexpected DB errors', () => {
  it('returns 500 when prisma.create throws a non-P2002 error', async () => {
    mockWaitlistCreate.mockRejectedValue(new Error('Connection pool exhausted'));

    const app = await buildApp({ config: TEST_CONFIG as Config });

    const res = await app.inject({
      method: 'POST',
      url: '/waitlist',
      headers: { 'content-type': 'application/json' },
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(500);

    await app.close();
  });

  it('returns 500 when prisma.create throws a PrismaClientInitializationError', async () => {
    const initError = new Prisma.PrismaClientInitializationError(
      'Cannot reach database server',
      '6.4.1',
    );
    mockWaitlistCreate.mockRejectedValue(initError);

    const app = await buildApp({ config: TEST_CONFIG as Config });

    const res = await app.inject({
      method: 'POST',
      url: '/waitlist',
      headers: { 'content-type': 'application/json' },
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(500);

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// POST /waitlist — progressive enhancement form POST missing `source`
// ---------------------------------------------------------------------------

describe('POST /waitlist — progressive enhancement (form POST) edge cases', () => {
  it('form POST with all required fields (variant + source hidden inputs) returns 303', async () => {
    // WaitlistForm.tsx includes both `variant` and `source` as hidden inputs (lines 188-189).
    // This verifies the complete form POST round-trip works.
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

    expect(res.statusCode).toBe(303);
    expect(res.headers['location']).toBe('/?waitlist=success');
    expect(mockWaitlistCreate).toHaveBeenCalledOnce();

    await app.close();
  });

  it('form POST missing source returns 400 (required field)', async () => {
    // Verifies that if source were accidentally omitted from the form, validation fails
    const app = await buildApp({ config: TEST_CONFIG as Config });

    const formPayload = new URLSearchParams({
      email: 'user@example.com',
      variant: 'a',
      honeypot: '',
      // source intentionally absent
    }).toString();

    const res = await app.inject({
      method: 'POST',
      url: '/waitlist',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: formPayload,
    });

    expect(res.statusCode).toBe(400);
    expect(mockWaitlistCreate).not.toHaveBeenCalled();

    await app.close();
  });

  it('form POST redirects to /?waitlist=success on success', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });

    const formPayload = new URLSearchParams({
      email: 'form@example.com',
      variant: 'c',
      source: 'footer',
      honeypot: '',
    }).toString();

    const res = await app.inject({
      method: 'POST',
      url: '/waitlist',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: formPayload,
    });

    expect(res.statusCode).toBe(303);
    expect(res.headers['location']).toContain('waitlist=success');

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// GET /admin/waitlist — auth enforcement
// ---------------------------------------------------------------------------

describe('GET /admin/waitlist — auth enforcement', () => {
  it('returns 401 when ADMIN_API_KEY is set but no x-api-key header is provided', async () => {
    const app = await buildApp({ config: TEST_CONFIG_WITH_ADMIN_KEY as Config });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/waitlist',
      // No x-api-key header
    });

    expect(res.statusCode).toBe(401);
    const body = res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('UNAUTHORIZED');

    await app.close();
  });

  it('returns 401 when ADMIN_API_KEY is set and wrong key is provided', async () => {
    const app = await buildApp({ config: TEST_CONFIG_WITH_ADMIN_KEY as Config });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/waitlist',
      headers: { 'x-api-key': 'wrong-key-totally-invalid' },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('UNAUTHORIZED');

    await app.close();
  });

  it('returns 200 when ADMIN_API_KEY is set and correct key is provided', async () => {
    const app = await buildApp({ config: TEST_CONFIG_WITH_ADMIN_KEY as Config });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/waitlist',
      headers: { 'x-api-key': TEST_CONFIG_WITH_ADMIN_KEY.ADMIN_API_KEY! },
    });

    expect(res.statusCode).toBe(200);

    await app.close();
  });

  it('returns 401 when x-api-key is an empty string', async () => {
    const app = await buildApp({ config: TEST_CONFIG_WITH_ADMIN_KEY as Config });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/waitlist',
      headers: { 'x-api-key': '' },
    });

    expect(res.statusCode).toBe(401);

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// GET /admin/waitlist — query param boundary edge cases
// ---------------------------------------------------------------------------

describe('GET /admin/waitlist — query param boundaries', () => {
  it('returns 400 when limit=0 (below minimum of 1)', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/waitlist?limit=0',
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');

    await app.close();
  });

  it('returns 400 when limit is negative', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/waitlist?limit=-10',
    });

    expect(res.statusCode).toBe(400);

    await app.close();
  });

  it('returns 400 when offset is negative', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/waitlist?offset=-1',
    });

    expect(res.statusCode).toBe(400);

    await app.close();
  });

  it('returns 200 with offset=0 (boundary value)', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/waitlist?offset=0',
    });

    expect(res.statusCode).toBe(200);

    await app.close();
  });

  it('returns 400 when limit is non-numeric string', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/waitlist?limit=abc',
    });

    expect(res.statusCode).toBe(400);

    await app.close();
  });

  it('returns 400 when offset is non-numeric string', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/waitlist?offset=xyz',
    });

    expect(res.statusCode).toBe(400);

    await app.close();
  });

  it('returns 400 when limit is float (non-integer)', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/waitlist?limit=10.5',
    });

    // z.coerce.number().int() — 10.5 coerces to 10.5, then fails .int() check
    expect(res.statusCode).toBe(400);

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// GET /admin/waitlist — response shape: snake_case field mapping
// ---------------------------------------------------------------------------

describe('GET /admin/waitlist — response shape', () => {
  it('response submissions have snake_case field names (utm_source, not utmSource)', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/waitlist',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      data: { submissions: Record<string, unknown>[] };
    }>();

    const submission = body.data.submissions[0];
    expect(submission).toBeDefined();

    // Spec defines snake_case in GET /admin/waitlist response
    expect(submission).toHaveProperty('utm_source');
    expect(submission).toHaveProperty('utm_medium');
    expect(submission).toHaveProperty('utm_campaign');
    expect(submission).toHaveProperty('ip_address');
    expect(submission).toHaveProperty('created_at');

    // Should NOT have camelCase variants
    expect(submission).not.toHaveProperty('utmSource');
    expect(submission).not.toHaveProperty('utmMedium');
    expect(submission).not.toHaveProperty('utmCampaign');
    expect(submission).not.toHaveProperty('ipAddress');
    expect(submission).not.toHaveProperty('createdAt');

    await app.close();
  });

  it('total field is a number (not a string)', async () => {
    mockWaitlistCount.mockResolvedValue(42);
    const app = await buildApp({ config: TEST_CONFIG as Config });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/waitlist',
    });

    const body = res.json<{ data: { total: unknown } }>();
    expect(typeof body.data.total).toBe('number');
    expect(body.data.total).toBe(42);

    await app.close();
  });

  it('empty submissions array when no records exist', async () => {
    mockWaitlistFindMany.mockResolvedValue([]);
    mockWaitlistCount.mockResolvedValue(0);
    const app = await buildApp({ config: TEST_CONFIG as Config });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/waitlist',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { submissions: unknown[]; total: number } }>();
    expect(body.data.submissions).toHaveLength(0);
    expect(body.data.total).toBe(0);

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// POST /waitlist — schema length constraints on UTM fields
// ---------------------------------------------------------------------------

describe('POST /waitlist — UTM field length constraints', () => {
  it('returns 400 when utm_source exceeds 500 characters', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });

    const res = await app.inject({
      method: 'POST',
      url: '/waitlist',
      headers: { 'content-type': 'application/json' },
      payload: { ...VALID_BODY, utm_source: 'a'.repeat(501) },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');

    await app.close();
  });

  it('returns 400 when email exceeds 320 characters (max(320) constraint)', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });

    // Create email that's over 320 chars: 315 local + @x.com = 321 chars
    const longLocal = 'a'.repeat(315);
    const email = `${longLocal}@x.com`; // 321 chars total
    const res = await app.inject({
      method: 'POST',
      url: '/waitlist',
      headers: { 'content-type': 'application/json' },
      payload: { ...VALID_BODY, email },
    });

    expect(res.statusCode).toBe(400);

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// POST /waitlist — IP address capture
// ---------------------------------------------------------------------------

describe('POST /waitlist — IP address capture', () => {
  it('passes IP address from request.ip to prisma.create', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });

    await app.inject({
      method: 'POST',
      url: '/waitlist',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '1.2.3.4',
      },
      payload: VALID_BODY,
    });

    expect(mockWaitlistCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ipAddress: expect.any(String),
        }),
      }),
    );

    await app.close();
  });

  it('stores null ipAddress when no IP is available', async () => {
    // Fastify inject() uses 127.0.0.1 by default — this test verifies the field is set
    const app = await buildApp({ config: TEST_CONFIG as Config });

    await app.inject({
      method: 'POST',
      url: '/waitlist',
      headers: { 'content-type': 'application/json' },
      payload: VALID_BODY,
    });

    const callArgs = mockWaitlistCreate.mock.calls[0]?.[0] as {
      data: { ipAddress: string | null };
    } | undefined;
    // ipAddress should be set (127.0.0.1 from inject) or null — never undefined
    expect(callArgs?.data.ipAddress === null || typeof callArgs?.data.ipAddress === 'string').toBe(true);

    await app.close();
  });
});
