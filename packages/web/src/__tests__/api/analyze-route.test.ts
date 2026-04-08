// TDD tests for the Next.js Route Handler proxy at app/api/analyze/route.ts
// Tests: API key injection, Content-Type forwarding, header passthrough,
// CONFIG_ERROR when env vars missing, response proxying.

import { createMenuAnalysisResponse } from '../fixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMultipartRequest(overrides: {
  contentType?: string;
  actorId?: string;
  source?: string;
} = {}): Request {
  const {
    contentType = 'multipart/form-data; boundary=----FormBoundary123',
    actorId = 'test-actor-uuid-001',
    source = 'web',
  } = overrides;

  const headers = new Headers({
    'Content-Type': contentType,
    'X-Actor-Id': actorId,
    'X-FXP-Source': source,
  });

  return new Request('http://localhost:3002/api/analyze', {
    method: 'POST',
    headers,
    body: 'fake-multipart-body',
    // @ts-expect-error duplex is needed for streaming body in Node.js fetch
    duplex: 'half',
  });
}

function makeUpstreamFetchMock(status: number, body: unknown) {
  const responseBody = JSON.stringify(body);
  // Construct a Response-like object — avoids the need for Response global in jsdom
  return jest.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers({ 'Content-Type': 'application/json' }),
    body: responseBody,
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(responseBody),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/analyze Route Handler', () => {
  const ORIGINAL_API_KEY = process.env['API_KEY'];
  const ORIGINAL_API_URL = process.env['NEXT_PUBLIC_API_URL'];

  beforeEach(() => {
    jest.clearAllMocks();
    process.env['API_KEY'] = 'fxp_test_api_key_32_hex_chars_here';
    process.env['NEXT_PUBLIC_API_URL'] = 'http://localhost:3001';
  });

  afterEach(() => {
    if (ORIGINAL_API_KEY !== undefined) {
      process.env['API_KEY'] = ORIGINAL_API_KEY;
    } else {
      delete process.env['API_KEY'];
    }
    if (ORIGINAL_API_URL !== undefined) {
      process.env['NEXT_PUBLIC_API_URL'] = ORIGINAL_API_URL;
    } else {
      delete process.env['NEXT_PUBLIC_API_URL'];
    }
  });

  // ---------------------------------------------------------------------------
  // Config error cases
  // ---------------------------------------------------------------------------

  it('returns 500 CONFIG_ERROR when API_KEY env var is not set', async () => {
    delete process.env['API_KEY'];
    const { POST } = await import('../../app/api/analyze/route');

    const req = makeMultipartRequest();
    const response = await POST(req);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: 'CONFIG_ERROR' });
  });

  it('returns 500 CONFIG_ERROR when NEXT_PUBLIC_API_URL env var is not set', async () => {
    delete process.env['NEXT_PUBLIC_API_URL'];
    const { POST } = await import('../../app/api/analyze/route');

    const req = makeMultipartRequest();
    const response = await POST(req);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: 'CONFIG_ERROR' });
  });

  // ---------------------------------------------------------------------------
  // API key injection
  // ---------------------------------------------------------------------------

  it('appends X-API-Key header from process.env.API_KEY to upstream request', async () => {
    global.fetch = makeUpstreamFetchMock(200, createMenuAnalysisResponse());
    const { POST } = await import('../../app/api/analyze/route');

    const req = makeMultipartRequest();
    await POST(req);

    const upstreamCall = (global.fetch as jest.Mock).mock.calls[0];
    const upstreamRequest = upstreamCall[0] as Request;
    expect(upstreamRequest.headers.get('X-API-Key')).toBe('fxp_test_api_key_32_hex_chars_here');
  });

  // ---------------------------------------------------------------------------
  // Header forwarding
  // ---------------------------------------------------------------------------

  it('forwards Content-Type header unchanged (preserves multipart boundary)', async () => {
    global.fetch = makeUpstreamFetchMock(200, createMenuAnalysisResponse());
    const { POST } = await import('../../app/api/analyze/route');

    const expectedContentType = 'multipart/form-data; boundary=----FormBoundary123';
    const req = makeMultipartRequest({ contentType: expectedContentType });
    await POST(req);

    const upstreamCall = (global.fetch as jest.Mock).mock.calls[0];
    const upstreamRequest = upstreamCall[0] as Request;
    expect(upstreamRequest.headers.get('Content-Type')).toBe(expectedContentType);
  });

  it('passes X-Actor-Id through from the client request', async () => {
    global.fetch = makeUpstreamFetchMock(200, createMenuAnalysisResponse());
    const { POST } = await import('../../app/api/analyze/route');

    const req = makeMultipartRequest({ actorId: 'client-actor-uuid-999' });
    await POST(req);

    const upstreamCall = (global.fetch as jest.Mock).mock.calls[0];
    const upstreamRequest = upstreamCall[0] as Request;
    expect(upstreamRequest.headers.get('X-Actor-Id')).toBe('client-actor-uuid-999');
  });

  it('passes X-FXP-Source through from the client request', async () => {
    global.fetch = makeUpstreamFetchMock(200, createMenuAnalysisResponse());
    const { POST } = await import('../../app/api/analyze/route');

    const req = makeMultipartRequest({ source: 'web' });
    await POST(req);

    const upstreamCall = (global.fetch as jest.Mock).mock.calls[0];
    const upstreamRequest = upstreamCall[0] as Request;
    expect(upstreamRequest.headers.get('X-FXP-Source')).toBe('web');
  });

  // ---------------------------------------------------------------------------
  // URL construction
  // ---------------------------------------------------------------------------

  it('sends to ${NEXT_PUBLIC_API_URL}/analyze/menu', async () => {
    global.fetch = makeUpstreamFetchMock(200, createMenuAnalysisResponse());
    const { POST } = await import('../../app/api/analyze/route');

    const req = makeMultipartRequest();
    await POST(req);

    const upstreamCall = (global.fetch as jest.Mock).mock.calls[0];
    const upstreamRequest = upstreamCall[0] as Request;
    expect(upstreamRequest.url).toBe('http://localhost:3001/analyze/menu');
  });

  // ---------------------------------------------------------------------------
  // Response proxying
  // ---------------------------------------------------------------------------

  it('returns upstream response body and 200 status on success', async () => {
    const mockData = createMenuAnalysisResponse();
    global.fetch = makeUpstreamFetchMock(200, mockData);
    const { POST } = await import('../../app/api/analyze/route');

    const req = makeMultipartRequest();
    const response = await POST(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(mockData);
  });

  it('returns upstream error body and status code unchanged (422)', async () => {
    const errorBody = { success: false, error: { code: 'INVALID_IMAGE', message: 'Unsupported format' } };
    global.fetch = makeUpstreamFetchMock(422, errorBody);
    const { POST } = await import('../../app/api/analyze/route');

    const req = makeMultipartRequest();
    const response = await POST(req);

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toEqual(errorBody);
  });

  it('returns upstream error body and status code unchanged (429)', async () => {
    const errorBody = { success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' } };
    global.fetch = makeUpstreamFetchMock(429, errorBody);
    const { POST } = await import('../../app/api/analyze/route');

    const req = makeMultipartRequest();
    const response = await POST(req);

    expect(response.status).toBe(429);
  });
});
