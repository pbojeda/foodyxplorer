// F-ADMIN-ANALYTICS-UI — admin API client wrappers tests.
// Tests for: getMissedQueries, trackMissedQueries, updateMissedQueryStatus,
//            getHistorySample, getQueriesAnalytics, getWebMetricsAnalytics

import { setAuthToken, getMissedQueries, trackMissedQueries, updateMissedQueryStatus, getHistorySample, getQueriesAnalytics, getWebMetricsAnalytics, ApiError } from '../../lib/apiClient';

const mockFetch = jest.fn();
global.fetch = mockFetch;
process.env['NEXT_PUBLIC_API_URL'] = 'https://api.example.com';

beforeEach(() => {
  jest.clearAllMocks();
  setAuthToken('test-bearer-token');
});

afterAll(() => {
  setAuthToken(null);
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeSuccessResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ success: true, data }),
  } as unknown as Response;
}

function makeErrorResponse(code: string, message: string, status: number): Response {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({ success: false, error: { code, message } }),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// getMissedQueries
// ---------------------------------------------------------------------------

describe('getMissedQueries', () => {
  it('calls correct URL with bearer header and default params', async () => {
    mockFetch.mockResolvedValueOnce(makeSuccessResponse({
      missedQueries: [],
      totalMissCount: 0,
      timeRange: '7d',
    }));

    await getMissedQueries({ timeRange: '7d', topN: 20, minCount: 1 });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/analytics/missed-queries'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-bearer-token',
        }),
      })
    );
  });

  it('throws ApiError with code NOT_PROVISIONED on 403 NOT_PROVISIONED', async () => {
    mockFetch.mockResolvedValueOnce(
      makeErrorResponse('NOT_PROVISIONED', 'Account not provisioned', 403)
    );

    await expect(getMissedQueries({ timeRange: '7d', topN: 20, minCount: 1 }))
      .rejects.toMatchObject({ code: 'NOT_PROVISIONED' });
  });

  it('throws ApiError with code FORBIDDEN on 403 FORBIDDEN', async () => {
    mockFetch.mockResolvedValueOnce(
      makeErrorResponse('FORBIDDEN', 'Admin tier required', 403)
    );

    await expect(getMissedQueries({ timeRange: '7d', topN: 20, minCount: 1 }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('throws UNAUTHORIZED when no auth token is set', async () => {
    setAuthToken(null);

    await expect(getMissedQueries({ timeRange: '7d', topN: 20, minCount: 1 }))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    setAuthToken('test-bearer-token');
  });
});

// ---------------------------------------------------------------------------
// trackMissedQueries
// ---------------------------------------------------------------------------

describe('trackMissedQueries', () => {
  it('sends POST with correct batch body shape', async () => {
    mockFetch.mockResolvedValueOnce(makeSuccessResponse([
      { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', queryText: 'paella', hitCount: 5, status: 'pending', resolvedDishId: null, notes: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ]));

    await trackMissedQueries([{ queryText: 'paella', hitCount: 5 }]);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/analytics/missed-queries/track'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ queries: [{ queryText: 'paella', hitCount: 5 }] }),
        headers: expect.objectContaining({
          Authorization: 'Bearer test-bearer-token',
        }),
      })
    );
  });
});

// ---------------------------------------------------------------------------
// updateMissedQueryStatus
// ---------------------------------------------------------------------------

describe('updateMissedQueryStatus', () => {
  it('sends POST to correct /:id/status URL', async () => {
    const now = new Date().toISOString();
    mockFetch.mockResolvedValueOnce(makeSuccessResponse({
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', queryText: 'paella', hitCount: 5, status: 'resolved',
      resolvedDishId: null, notes: null, createdAt: now, updatedAt: now,
    }));

    await updateMissedQueryStatus('track-1', { status: 'resolved' });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/analytics/missed-queries/track-1/status'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ status: 'resolved' }),
      })
    );
  });
});

// ---------------------------------------------------------------------------
// getHistorySample
// ---------------------------------------------------------------------------

describe('getHistorySample', () => {
  it('calls /analytics/history-sample with defaults', async () => {
    mockFetch.mockResolvedValueOnce(makeSuccessResponse({
      items: [],
      hours: 24,
      limit: 20,
    }));

    await getHistorySample({ hours: 24, limit: 20 });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/analytics/history-sample'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-bearer-token',
        }),
      })
    );
  });

  it('includes intent param when provided', async () => {
    mockFetch.mockResolvedValueOnce(makeSuccessResponse({
      items: [],
      hours: 24,
      limit: 20,
      intentFilter: 'estimation',
    }));

    await getHistorySample({ hours: 24, limit: 20, intent: 'estimation' });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('intent=estimation');
  });

  it('does NOT include intent param when not provided', async () => {
    mockFetch.mockResolvedValueOnce(makeSuccessResponse({
      items: [],
      hours: 24,
      limit: 20,
    }));

    await getHistorySample({ hours: 24, limit: 20 });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain('intent=');
  });
});

// ---------------------------------------------------------------------------
// getQueriesAnalytics
// ---------------------------------------------------------------------------

describe('getQueriesAnalytics', () => {
  it('calls /analytics/queries with bearer', async () => {
    mockFetch.mockResolvedValueOnce(makeSuccessResponse({
      totalQueries: 100,
      cacheHitRate: 0.5,
      avgResponseTimeMs: 250,
      byLevel: { l1: 50, l2: 20, l3: 15, l4: 5, miss: 10 },
      byChain: [],
      bySource: { api: 80, bot: 20 },
      topQueries: [],
      timeRange: '7d',
    }));

    await getQueriesAnalytics({ timeRange: '7d' });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/analytics/queries'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-bearer-token',
        }),
      })
    );
  });
});

// ---------------------------------------------------------------------------
// getWebMetricsAnalytics
// ---------------------------------------------------------------------------

describe('getWebMetricsAnalytics', () => {
  it('calls /analytics/web-events with bearer', async () => {
    mockFetch.mockResolvedValueOnce(makeSuccessResponse({
      eventCount: 10,
      totalQueries: 50,
      totalSuccesses: 45,
      totalErrors: 5,
      totalRetries: 2,
      avgResponseTimeMs: 300,
      topIntents: [],
      topErrors: [],
      timeRange: '7d',
    }));

    await getWebMetricsAnalytics({ timeRange: '7d' });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/analytics/web-events'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-bearer-token',
        }),
      })
    );
  });
});
