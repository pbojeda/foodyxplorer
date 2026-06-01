// F-WEB-TIER: Tests for getMe(), getUsage(), and photo bearer injection in apiClient.
// AC11 (photo bearer), AC13 (photo anonymous), getMe/getUsage bearer + parse + error throw.

// NOTE: Uses jest.resetModules() + require() pattern from apiClient.auth.test.ts
// to isolate the authToken module-level singleton between tests.

const mockFetch = jest.fn();
global.fetch = mockFetch;

process.env['NEXT_PUBLIC_API_URL'] = 'https://api.example.com';

const makeSuccessResponse = (body: object) =>
  Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  } as unknown as Response);

const makeErrorResponse = (status: number, body: object) =>
  Promise.resolve({
    ok: false,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  } as unknown as Response);

const meSuccessBody = {
  success: true,
  data: {
    account: {
      id: '00000000-0000-4000-a000-000000000001',
      authUserId: '00000000-0000-4000-a000-000000000002',
      email: 'test@example.com',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
      consentMarketing: false,
      consentMarketingAt: null,
      consentAnalytics: false,
      consentAnalyticsAt: null,
      tier: 'free',
    },
    actor: {
      id: '00000000-0000-4000-a000-000000000003',
      type: 'authenticated',
      externalId: 'auth-uuid',
      accountId: '00000000-0000-4000-a000-000000000001',
    },
  },
};

const usageSuccessBody = {
  success: true,
  data: {
    tier: 'free',
    resetAt: '2026-05-27T00:00:00.000Z',
    buckets: {
      queries: { used: 12, limit: 100, remaining: 88 },
      photos: { used: 3, limit: 20, remaining: 17 },
      voice: { used: 5, limit: 30, remaining: 25 },
    },
  },
};

describe('apiClient — F-WEB-TIER', () => {
  let apiClient: typeof import('../../lib/apiClient');
  let setAuthToken: (token: string | null) => void;
  let sendPhotoAnalysis: typeof import('../../lib/apiClient').sendPhotoAnalysis;
  let getMe: typeof import('../../lib/apiClient').getMe;
  let getUsage: typeof import('../../lib/apiClient').getUsage;
  let ApiError: typeof import('../../lib/apiClient').ApiError;

  beforeEach(() => {
    jest.resetModules();
    /* eslint-disable */
    apiClient = require('../../lib/apiClient');
    /* eslint-enable */
    setAuthToken = apiClient.setAuthToken;
    sendPhotoAnalysis = apiClient.sendPhotoAnalysis;
    getMe = apiClient.getMe;
    getUsage = apiClient.getUsage;
    ApiError = apiClient.ApiError;
    mockFetch.mockClear();
    setAuthToken(null);
  });

  // -------------------------------------------------------------------------
  // AC11 + AC13 — sendPhotoAnalysis bearer injection
  // -------------------------------------------------------------------------

  describe('sendPhotoAnalysis bearer injection (AC11/AC13)', () => {
    const makeMenuSuccessResponse = () =>
      makeSuccessResponse({
        success: true,
        data: { dishCount: 1, dishes: [] },
      });

    it('AC11: includes Authorization: Bearer when authToken is set', async () => {
      setAuthToken('photo-jwt-token');
      mockFetch.mockReturnValueOnce(makeMenuSuccessResponse());
      await sendPhotoAnalysis(
        new File(['img'], 'test.jpg', { type: 'image/jpeg' }),
        'actor-uuid',
      );
      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer photo-jwt-token');
    });

    it('AC13: does NOT include Authorization header when authToken is null', async () => {
      mockFetch.mockReturnValueOnce(makeMenuSuccessResponse());
      await sendPhotoAnalysis(
        new File(['img'], 'test.jpg', { type: 'image/jpeg' }),
        'actor-uuid',
      );
      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });

    it('still sends X-Actor-Id and X-FXP-Source regardless of auth', async () => {
      setAuthToken('some-token');
      mockFetch.mockReturnValueOnce(makeMenuSuccessResponse());
      await sendPhotoAnalysis(
        new File(['img'], 'test.jpg', { type: 'image/jpeg' }),
        'my-actor-id',
      );
      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['X-Actor-Id']).toBe('my-actor-id');
      expect(headers['X-FXP-Source']).toBe('web');
    });
  });

  // -------------------------------------------------------------------------
  // getMe()
  // -------------------------------------------------------------------------

  describe('getMe()', () => {
    it('calls GET /me with Authorization: Bearer header', async () => {
      setAuthToken('me-jwt-token');
      mockFetch.mockReturnValueOnce(makeSuccessResponse(meSuccessBody));
      await getMe();
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.example.com/me');
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer me-jwt-token');
    });

    it('returns parsed MeResponse on success', async () => {
      setAuthToken('me-jwt-token');
      mockFetch.mockReturnValueOnce(makeSuccessResponse(meSuccessBody));
      const result = await getMe();
      expect(result.data.account.tier).toBe('free');
      expect(result.data.account.email).toBe('test@example.com');
    });

    it('throws ApiError with UNAUTHORIZED when authToken is null', async () => {
      await expect(getMe()).rejects.toThrow();
      await expect(getMe()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('throws ApiError on non-200 response', async () => {
      setAuthToken('me-jwt-token');
      mockFetch.mockReturnValueOnce(
        makeErrorResponse(401, { error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
      );
      await expect(getMe()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });
  });

  // -------------------------------------------------------------------------
  // getUsage()
  // -------------------------------------------------------------------------

  describe('getUsage()', () => {
    it('calls GET /me/usage with Authorization: Bearer header', async () => {
      setAuthToken('usage-jwt-token');
      mockFetch.mockReturnValueOnce(makeSuccessResponse(usageSuccessBody));
      await getUsage();
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.example.com/me/usage');
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer usage-jwt-token');
    });

    it('returns parsed UsageResponse on success', async () => {
      setAuthToken('usage-jwt-token');
      mockFetch.mockReturnValueOnce(makeSuccessResponse(usageSuccessBody));
      const result = await getUsage();
      expect(result.data.tier).toBe('free');
      expect(result.data.buckets.queries.used).toBe(12);
      expect(result.data.buckets.queries.limit).toBe(100);
      expect(result.data.buckets.photos.used).toBe(3);
      expect(result.data.buckets.voice.used).toBe(5);
    });

    it('throws ApiError with UNAUTHORIZED when authToken is null', async () => {
      await expect(getUsage()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('throws ApiError on 5xx response', async () => {
      setAuthToken('usage-jwt-token');
      mockFetch.mockReturnValueOnce(
        makeErrorResponse(500, { error: { code: 'INTERNAL_ERROR', message: 'Server error' } })
      );
      await expect(getUsage()).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    });

    // F-WEB-HISTORY-FU1 (BUG-WEB-USAGEMETER-ACTOR-PARITY) — getUsage must send
    // X-Actor-Id so /me/usage and /conversation/message resolve to the SAME actor
    // on the API side (otherwise actorRateLimit counters live in different
    // Redis buckets and the meter never advances from browser searches).
    it('AC2: sends X-Actor-Id header when actorId is a non-empty string', async () => {
      setAuthToken('usage-jwt-token');
      mockFetch.mockReturnValueOnce(makeSuccessResponse(usageSuccessBody));
      await getUsage('abc-actor-uuid');
      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['X-Actor-Id']).toBe('abc-actor-uuid');
    });

    it('AC3: omits X-Actor-Id header when actorId is undefined', async () => {
      setAuthToken('usage-jwt-token');
      mockFetch.mockReturnValueOnce(makeSuccessResponse(usageSuccessBody));
      await getUsage(undefined);
      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers).not.toHaveProperty('X-Actor-Id');
    });

    it('AC3: omits X-Actor-Id header when actorId is the empty string', async () => {
      setAuthToken('usage-jwt-token');
      mockFetch.mockReturnValueOnce(makeSuccessResponse(usageSuccessBody));
      await getUsage('');
      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers).not.toHaveProperty('X-Actor-Id');
    });
  });
});
