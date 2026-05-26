// F-WEB-TIER — QA adversarial edge-case tests
//
// Probes edge cases and invariants that the developer tests don't fully cover:
//
// 1. resolveAccountTier: stale/invalid cache value → treated as tier (no validation)
// 2. resolveAccountTier: empty string sub → must still fail-open 'free'
// 3. resolveAccountTier: DB returns bad tier string → passed through as-is (caller trusts DB)
// 4. actorRateLimit: anonymous request with request.accountId = '' (falsy but set) → anonymous
// 5. actorRateLimit: limit clamping — used=limit exact boundary (current === limit → allowed, NOT 429)
// 6. actorRateLimit: used=limit+1 → blocked (current > limit === true at limit+1)
// 7. actorRateLimit: admin tier → Infinity limit → no Redis INCR at all (immediate return)
// 8. computeResetAt: end-of-month / end-of-year (Dec 31 → Jan 1)
// 9. actorRateLimit: route not in ROUTE_BUCKET_MAP → no rate limit applied (hook returns early)
// 10. actorRateLimit: actorId not set → hook returns early (no 429 for unresolved actor)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

// ---------------------------------------------------------------------------
// Mock resolveAccountTier before importing actorRateLimit
// ---------------------------------------------------------------------------

const mockResolveAccountTier = vi.fn();
vi.mock('../../lib/accountTier.js', () => ({
  resolveAccountTier: mockResolveAccountTier,
}));

const { registerActorRateLimit, DAILY_LIMITS_BY_TIER, computeResetAt } =
  await import('../../plugins/actorRateLimit.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type HookFn = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

function buildMockRequest(opts: {
  url?: string;
  actorId?: string;
  accountId?: string;
  apiKeyContext?: { tier: string };
} = {}): Partial<FastifyRequest> {
  return {
    routeOptions: { url: opts.url ?? '/conversation/message' } as never,
    actorId: opts.actorId ?? 'f7f00000-0001-4000-a000-000000000099',
    accountId: opts.accountId,
    apiKeyContext: opts.apiKeyContext,
    log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
  } as never;
}

function buildMockReply() {
  const reply = {
    code: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    _sent: false,
    _statusCode: 0,
  };
  reply.send.mockImplementation(() => { reply._sent = true; return reply; });
  reply.code.mockImplementation((code: number) => { reply._statusCode = code; return reply; });
  return reply;
}

const mockRedisIncr = vi.fn();
const mockRedisExpire = vi.fn();
const mockRedis = { incr: mockRedisIncr, expire: mockRedisExpire };
const mockPrisma = {};

async function getHook(): Promise<HookFn> {
  let capturedHook!: HookFn;
  const fakeApp = {
    addHook: vi.fn((_: string, fn: HookFn) => { capturedHook = fn; }),
  };
  await registerActorRateLimit(
    fakeApp as unknown as FastifyInstance,
    { redis: mockRedis as never, prisma: mockPrisma as never },
  );
  return capturedHook;
}

// ---------------------------------------------------------------------------
// resolveAccountTier edge cases are covered in fWebTier.resolveAccountTier.unit.test.ts
// This file focuses on actorRateLimit and computeResetAt edge cases only.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// actorRateLimit edge cases
// ---------------------------------------------------------------------------

describe('actorRateLimit — QA edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccountTier.mockResolvedValue('free');
    mockRedisIncr.mockResolvedValue(1);
    mockRedisExpire.mockResolvedValue(1);
  });

  it('empty string accountId is falsy — treated as anonymous (no bearer auth)', async () => {
    // Empty string should be treated as no accountId → anonymous tier
    // !!'' === false, so hasBearerAuth is false
    const hook = await getHook();
    const request = buildMockRequest({
      url: '/conversation/message',
      accountId: '', // empty string — falsy
    });
    const reply = buildMockReply();

    await hook(request as never, reply as never);

    // resolveAccountTier should NOT be called for empty accountId
    expect(mockResolveAccountTier).not.toHaveBeenCalled();
  });

  it('exact boundary: used === limit → NOT blocked (current = limit, current > limit is false)', async () => {
    // INCR returns exactly the limit value → should NOT block (> not >=)
    const hook = await getHook();
    mockResolveAccountTier.mockResolvedValue('free');
    // limit for free.queries = 100
    mockRedisIncr.mockResolvedValue(100); // exactly at limit — NOT over

    const request = buildMockRequest({
      url: '/conversation/message',
      actorId: 'f7f00000-0001-4000-a000-000000000099',
      accountId: 'f7f00000-0010-4000-a000-000000000010',
    });
    const reply = buildMockReply();

    await hook(request as never, reply as never);

    // At exactly the limit, the request should pass through (the limit is inclusive)
    expect(reply._sent).toBe(false);
    expect(reply.code).not.toHaveBeenCalledWith(429);
  });

  it('one over boundary: used === limit+1 → blocked with 429', async () => {
    // INCR returns limit+1 → should block (current > limit)
    const hook = await getHook();
    mockResolveAccountTier.mockResolvedValue('free');
    // limit for free.queries = 100
    mockRedisIncr.mockResolvedValue(101); // one over limit

    const request = buildMockRequest({
      url: '/conversation/message',
      actorId: 'f7f00000-0001-4000-a000-000000000099',
      accountId: 'f7f00000-0010-4000-a000-000000000010',
    });
    const reply = buildMockReply();

    await hook(request as never, reply as never);

    expect(reply._sent).toBe(true);
    expect(reply._statusCode).toBe(429);
  });

  it('admin tier → Infinity limit → no Redis INCR called (bypass path)', async () => {
    // Admin requests must skip Redis entirely (no incr, no expire)
    const hook = await getHook();
    mockResolveAccountTier.mockResolvedValue('admin');

    const request = buildMockRequest({
      url: '/conversation/message',
      actorId: 'f7f00000-0001-4000-a000-000000000099',
      accountId: 'f7f00000-0010-4000-a000-000000000010',
    });
    const reply = buildMockReply();

    await hook(request as never, reply as never);

    // Admin tier bypasses Redis entirely
    expect(mockRedisIncr).not.toHaveBeenCalled();
    expect(mockRedisExpire).not.toHaveBeenCalled();
    expect(reply._sent).toBe(false);
  });

  it('route not in ROUTE_BUCKET_MAP → hook returns early, no Redis call', async () => {
    // Unregistered routes must not be rate-limited
    const hook = await getHook();

    const request = buildMockRequest({
      url: '/auth/login', // not in ROUTE_BUCKET_MAP
      accountId: 'f7f00000-0010-4000-a000-000000000010',
    });
    const reply = buildMockReply();

    await hook(request as never, reply as never);

    expect(mockRedisIncr).not.toHaveBeenCalled();
    expect(mockResolveAccountTier).not.toHaveBeenCalled();
    expect(reply._sent).toBe(false);
  });

  it('actorId not set → hook returns early (no actor, no limit check)', async () => {
    // If resolver failed to set actorId, the hook must not 429
    const hook = await getHook();

    const request = {
      routeOptions: { url: '/conversation/message' } as never,
      actorId: undefined, // not set (resolver DB degrade)
      accountId: 'f7f00000-0010-4000-a000-000000000010',
      log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
    } as never;
    const reply = buildMockReply();

    await hook(request as never, reply as never);

    expect(mockRedisIncr).not.toHaveBeenCalled();
    expect(reply._sent).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeResetAt — QA edge cases (month/year boundary)
// ---------------------------------------------------------------------------

describe('computeResetAt — QA edge cases', () => {
  it('end of month: 2026-01-31 → 2026-02-01T00:00:00.000Z', () => {
    expect(computeResetAt('2026-01-31')).toBe('2026-02-01T00:00:00.000Z');
  });

  it('end of year: 2026-12-31 → 2027-01-01T00:00:00.000Z', () => {
    expect(computeResetAt('2026-12-31')).toBe('2027-01-01T00:00:00.000Z');
  });

  it('February leap year: 2028-02-28 → 2028-02-29T00:00:00.000Z', () => {
    expect(computeResetAt('2028-02-28')).toBe('2028-02-29T00:00:00.000Z');
  });

  it('February non-leap year: 2026-02-28 → 2026-03-01T00:00:00.000Z', () => {
    expect(computeResetAt('2026-02-28')).toBe('2026-03-01T00:00:00.000Z');
  });

  it('April has 30 days: 2026-04-30 → 2026-05-01T00:00:00.000Z', () => {
    expect(computeResetAt('2026-04-30')).toBe('2026-05-01T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// DAILY_LIMITS_BY_TIER — invariant checks
// ---------------------------------------------------------------------------

describe('DAILY_LIMITS_BY_TIER — QA invariants', () => {
  it('free.realtime_minutes = 0 (placeholder — F095 not yet shipped)', () => {
    expect(DAILY_LIMITS_BY_TIER['free'].realtime_minutes).toBe(0);
  });

  it('anonymous.photos = 10 (unchanged)', () => {
    expect(DAILY_LIMITS_BY_TIER['anonymous'].photos).toBe(10);
  });

  it('anonymous.voice = 30 (unchanged)', () => {
    expect(DAILY_LIMITS_BY_TIER['anonymous'].voice).toBe(30);
  });

  it('admin limits are all Infinity', () => {
    expect(DAILY_LIMITS_BY_TIER['admin'].queries).toBe(Infinity);
    expect(DAILY_LIMITS_BY_TIER['admin'].photos).toBe(Infinity);
    expect(DAILY_LIMITS_BY_TIER['admin'].voice).toBe(Infinity);
  });

  it('free > anonymous for queries (registration value)', () => {
    expect(DAILY_LIMITS_BY_TIER['free'].queries).toBeGreaterThan(DAILY_LIMITS_BY_TIER['anonymous'].queries);
  });

  it('free > anonymous for photos (registration value)', () => {
    expect(DAILY_LIMITS_BY_TIER['free'].photos).toBeGreaterThan(DAILY_LIMITS_BY_TIER['anonymous'].photos);
  });

  it('free.voice === anonymous.voice (voice same across tiers — spec: 30/30)', () => {
    // Per spec: free=30, anonymous=30 (voice limit identical at launch)
    expect(DAILY_LIMITS_BY_TIER['free'].voice).toBe(DAILY_LIMITS_BY_TIER['anonymous'].voice);
  });
});
