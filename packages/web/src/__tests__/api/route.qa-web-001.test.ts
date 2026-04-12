// QA-WEB-001: Route handler gap tests.
//
// Areas covered:
//   BUG-QA-003 — CONFIG_ERROR returns string body (not structured { code, message })
//   CONFIG_ERROR when NEXT_PUBLIC_API_URL is missing
//   Correct upstream URL: ends in /analyze/menu
//   502 on upstream TypeError (unreachable API)
//   Content-Type forwarded to upstream
//   X-FXP-Source forwarded to upstream

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMultipartRequest(overrides: {
  contentType?: string;
  actorId?: string;
  source?: string;
} = {}): Request {
  const {
    contentType = 'multipart/form-data; boundary=----FormBoundary456',
    actorId = 'test-actor-uuid-qa-001',
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
    // @ts-expect-error duplex needed for streaming body in Node.js fetch
    duplex: 'half',
  });
}

function makeUpstreamFetchMock(status: number, body: unknown) {
  const responseBody = JSON.stringify(body);
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

describe('QA-WEB-001 route handler gaps', () => {
  const ORIGINAL_API_KEY = process.env['API_KEY'];
  const ORIGINAL_API_URL = process.env['NEXT_PUBLIC_API_URL'];

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
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

  it('BUG-QA-003 resolved: CONFIG_ERROR body is structured { error: { code, message } }', async () => {
    // BUG-QA-003 — was: route.ts:19 returned { error: 'CONFIG_ERROR' } (string),
    // while apiClient expected { error: { code, message } } (object). Fixed in
    // BUG-PROD-001 as part of the envelope normalization for the mobile camera
    // bugfix. This test now asserts the structured shape so the client parser
    // can surface the specific code to the UI and metrics.
    delete process.env['API_KEY'];
    const { POST } = await import('../../app/api/analyze/route');

    const response = await POST(makeMultipartRequest());

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: 'CONFIG_ERROR',
        message: expect.any(String),
      },
    });
    expect(typeof body.error).toBe('object');
    expect(body.error).toHaveProperty('code', 'CONFIG_ERROR');
  });

  it('returns structured CONFIG_ERROR envelope when NEXT_PUBLIC_API_URL is missing', async () => {
    delete process.env['NEXT_PUBLIC_API_URL'];
    const { POST } = await import('../../app/api/analyze/route');

    const response = await POST(makeMultipartRequest());

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: 'CONFIG_ERROR',
        message: expect.any(String),
      },
    });
  });

  it('sends upstream request to a URL ending in /analyze/menu', async () => {
    global.fetch = makeUpstreamFetchMock(200, { success: true, data: {} });
    const { POST } = await import('../../app/api/analyze/route');

    await POST(makeMultipartRequest());

    const upstreamCall = (global.fetch as jest.Mock).mock.calls[0];
    const upstreamRequest = upstreamCall[0] as Request;
    expect(upstreamRequest.url).toMatch(/\/analyze\/menu$/);
    expect(upstreamRequest.url).toBe('http://localhost:3001/analyze/menu');
  });

  it('returns 502 with structured UPSTREAM_UNAVAILABLE when upstream fetch throws TypeError', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const { POST } = await import('../../app/api/analyze/route');

    const response = await POST(makeMultipartRequest());

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: 'UPSTREAM_UNAVAILABLE',
        message: expect.any(String),
      },
    });
  });

  it('forwards Content-Type header (with multipart boundary) to upstream', async () => {
    const boundary = '----CustomBoundary789';
    const contentType = `multipart/form-data; boundary=${boundary}`;
    global.fetch = makeUpstreamFetchMock(200, { success: true, data: {} });
    const { POST } = await import('../../app/api/analyze/route');

    await POST(makeMultipartRequest({ contentType }));

    const upstreamCall = (global.fetch as jest.Mock).mock.calls[0];
    const upstreamRequest = upstreamCall[0] as Request;
    expect(upstreamRequest.headers.get('Content-Type')).toBe(contentType);
  });

  it('forwards X-FXP-Source header to upstream', async () => {
    global.fetch = makeUpstreamFetchMock(200, { success: true, data: {} });
    const { POST } = await import('../../app/api/analyze/route');

    await POST(makeMultipartRequest({ source: 'web' }));

    const upstreamCall = (global.fetch as jest.Mock).mock.calls[0];
    const upstreamRequest = upstreamCall[0] as Request;
    expect(upstreamRequest.headers.get('X-FXP-Source')).toBe('web');
  });
});
