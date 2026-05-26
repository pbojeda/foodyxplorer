// F-WEB-TIER — actorRateLimit tier resolution unit tests (AC1, AC2, AC3)
//
// Tests the three-way tier resolution:
//   apiKeyContext?.tier → (accountId set → resolveAccountTier) → 'anonymous'
//
// Also verifies:
//   - ROUTE_BUCKET_MAP does NOT contain '/me/usage' (AC27 / E12)
//   - DAILY_LIMITS_BY_TIER.free limits are as specced (AC3)
//   - Fail-open for bearer-authenticated requests on Redis incr failure

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

// ---------------------------------------------------------------------------
// Mock resolveAccountTier before importing actorRateLimit
// ---------------------------------------------------------------------------

const mockResolveAccountTier = vi.fn();

vi.mock('../../lib/accountTier.js', () => ({
  resolveAccountTier: mockResolveAccountTier,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

const { registerActorRateLimit, DAILY_LIMITS_BY_TIER, ROUTE_BUCKET_MAP, computeResetAt } =
  await import('../../plugins/actorRateLimit.js');

// ---------------------------------------------------------------------------
// Helpers to build a minimal Fastify-like test harness
// ---------------------------------------------------------------------------

type HookFn = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

interface MockRequestOpts {
  url?: string;
  actorId?: string;
  accountId?: string;
  apiKeyContext?: { tier: string };
  log?: { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
}

function buildMockRequest(opts: MockRequestOpts = {}): Partial<FastifyRequest> & {
  actorId?: string;
  accountId?: string;
  apiKeyContext?: { tier: string };
} {
  return {
    routeOptions: { url: opts.url ?? '/conversation/message' } as never,
    actorId: opts.actorId ?? 'f7f00000-0001-4000-a000-000000000099',
    accountId: opts.accountId,
    apiKeyContext: opts.apiKeyContext,
    log: opts.log ?? { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
  } as never;
}

function buildMockReply(): { code: ReturnType<typeof vi.fn>; header: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn>; statusCode?: number; _sent?: boolean } {
  const reply = {
    code: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    _sent: false,
  };
  reply.send.mockImplementation(() => { reply._sent = true; return reply; });
  return reply;
}

const mockRedisIncr = vi.fn();
const mockRedisExpire = vi.fn();
const mockRedisGet = vi.fn();
const mockRedis = {
  incr: mockRedisIncr,
  expire: mockRedisExpire,
  get: mockRedisGet,
};

const mockPrisma = {};

// ---------------------------------------------------------------------------
// Capture the registered hook by running registerActorRateLimit
// ---------------------------------------------------------------------------

let capturedHook!: HookFn;

async function getHook(): Promise<HookFn> {
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
// Tests
// ---------------------------------------------------------------------------

describe('DAILY_LIMITS_BY_TIER — AC3: free tier limits', () => {
  it('free.queries = 100', () => {
    expect(DAILY_LIMITS_BY_TIER['free'].queries).toBe(100);
  });

  it('free.photos = 20', () => {
    expect(DAILY_LIMITS_BY_TIER['free'].photos).toBe(20);
  });

  it('free.voice = 30', () => {
    expect(DAILY_LIMITS_BY_TIER['free'].voice).toBe(30);
  });

  it('anonymous.queries = 50 (regression guard)', () => {
    expect(DAILY_LIMITS_BY_TIER['anonymous'].queries).toBe(50);
  });
});

describe('ROUTE_BUCKET_MAP — /me/usage must NOT be rate-limited (AC27 / E12)', () => {
  it('ROUTE_BUCKET_MAP[\'/me/usage\'] is undefined', () => {
    expect(ROUTE_BUCKET_MAP['/me/usage']).toBeUndefined();
  });

  it('ROUTE_BUCKET_MAP[\'/conversation/message\'] = queries (regression)', () => {
    expect(ROUTE_BUCKET_MAP['/conversation/message']).toBe('queries');
  });
});

describe('computeResetAt — exported (plan step 4d)', () => {
  it('returns next UTC midnight for 2026-05-26', () => {
    const result = computeResetAt('2026-05-26');
    expect(result).toBe('2026-05-27T00:00:00.000Z');
  });
});

describe('Tier resolution — AC1: bearer accountId → resolveAccountTier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisIncr.mockResolvedValue(1);
    mockRedisExpire.mockResolvedValue(1);
    mockResolveAccountTier.mockResolvedValue('free');
  });

  it('AC1: bearer with accountId resolves to free tier (100 query limit)', async () => {
    const hook = await getHook();
    const request = buildMockRequest({
      url: '/conversation/message',
      actorId: 'f7f00000-0001-4000-a000-000000000099',
      accountId: 'f7f00000-0010-4000-a000-000000000010', // JWT sub
    });
    const reply = buildMockReply();

    mockResolveAccountTier.mockResolvedValue('free');
    mockRedisIncr.mockResolvedValue(1); // first request

    await hook(request as never, reply as never);

    expect(mockResolveAccountTier).toHaveBeenCalledWith(
      mockRedis,
      mockPrisma,
      'f7f00000-0010-4000-a000-000000000010',
      expect.anything(),
    );
    // Should not have been blocked (current = 1, limit = 100)
    expect(reply._sent).toBe(false);
  });

  it('AC2: no accountId, no apiKeyContext → anonymous tier (limit 50)', async () => {
    const hook = await getHook();
    const request = buildMockRequest({
      url: '/conversation/message',
      actorId: 'f7f00000-0001-4000-a000-000000000099',
      accountId: undefined, // no bearer auth
    });
    const reply = buildMockReply();

    // Should NOT call resolveAccountTier for anonymous
    await hook(request as never, reply as never);

    expect(mockResolveAccountTier).not.toHaveBeenCalled();
  });

  it('AC2 regression: apiKeyContext.tier = pro → tier pro, resolveAccountTier NOT called', async () => {
    const hook = await getHook();
    const request = buildMockRequest({
      url: '/conversation/message',
      actorId: 'f7f00000-0001-4000-a000-000000000099',
      apiKeyContext: { tier: 'pro' },
      accountId: 'f7f00000-0010-4000-a000-000000000010', // accountId present but should be ignored
    });
    const reply = buildMockReply();

    mockRedisIncr.mockResolvedValue(1);

    await hook(request as never, reply as never);

    // API key takes precedence — resolveAccountTier should NOT be called
    expect(mockResolveAccountTier).not.toHaveBeenCalled();
  });
});

describe('Fail-open on Redis incr failure — AC1/E4', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccountTier.mockResolvedValue('free');
  });

  it('bearer request fails open (no 429) when Redis incr throws', async () => {
    const hook = await getHook();
    mockRedisIncr.mockRejectedValue(new Error('Redis connection refused'));

    const request = buildMockRequest({
      url: '/conversation/message',
      actorId: 'f7f00000-0001-4000-a000-000000000099',
      accountId: 'f7f00000-0010-4000-a000-000000000010',
    });
    const reply = buildMockReply();

    await hook(request as never, reply as never);

    // Fail-open: bearer-authenticated request should NOT get a 429
    expect(reply._sent).toBe(false);
    expect(reply.code).not.toHaveBeenCalledWith(429);
  });

  it('anonymous request fails closed (429) when Redis incr throws', async () => {
    const hook = await getHook();
    mockRedisIncr.mockRejectedValue(new Error('Redis connection refused'));

    const request = buildMockRequest({
      url: '/conversation/message',
      actorId: 'f7f00000-0001-4000-a000-000000000099',
      accountId: undefined, // anonymous
    });
    const reply = buildMockReply();

    await hook(request as never, reply as never);

    // Fail-closed: anonymous request should get a 429
    expect(reply._sent).toBe(true);
    expect(reply.code).toHaveBeenCalledWith(429);
  });
});
