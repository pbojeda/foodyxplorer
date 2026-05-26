// F-WEB-TIER: Tests for the Next.js analyze proxy Route Handler.
// AC12: Authorization header forwarded when present; anonymous path unchanged.

const mockFetch = jest.fn();
global.fetch = mockFetch;

process.env['API_KEY'] = 'test-api-key';
process.env['NEXT_PUBLIC_API_URL'] = 'https://api.example.com';

import { POST } from '../../app/api/analyze/route';

describe('analyze proxy — F-WEB-TIER (AC12)', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })
    );
  });

  it('AC12: forwards Authorization header when present in browser request', async () => {
    const formData = new FormData();
    formData.append('file', new Blob(['img'], { type: 'image/jpeg' }), 'test.jpg');
    formData.append('mode', 'auto');

    const request = new Request('http://localhost/api/analyze', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer tok123',
        'X-Actor-Id': 'actor-1',
        'X-FXP-Source': 'web',
      },
      body: formData,
    });

    await POST(request);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [upstreamReq] = mockFetch.mock.calls[0] as [Request];
    expect(upstreamReq.headers.get('Authorization')).toBe('Bearer tok123');
  });

  it('AC12: does NOT add Authorization header when absent from browser request', async () => {
    const formData = new FormData();
    formData.append('file', new Blob(['img'], { type: 'image/jpeg' }), 'test.jpg');
    formData.append('mode', 'auto');

    const request = new Request('http://localhost/api/analyze', {
      method: 'POST',
      headers: {
        'X-Actor-Id': 'actor-1',
        'X-FXP-Source': 'web',
      },
      body: formData,
    });

    await POST(request);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [upstreamReq] = mockFetch.mock.calls[0] as [Request];
    expect(upstreamReq.headers.get('Authorization')).toBeNull();
  });

  it('still includes X-API-Key in both auth and anonymous cases (regression)', async () => {
    const formData = new FormData();

    const request = new Request('http://localhost/api/analyze', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer tok-auth',
        'X-Actor-Id': 'actor-1',
        'X-FXP-Source': 'web',
      },
      body: formData,
    });

    await POST(request);

    const [upstreamReq] = mockFetch.mock.calls[0] as [Request];
    expect(upstreamReq.headers.get('X-API-Key')).toBe('test-api-key');
  });
});
