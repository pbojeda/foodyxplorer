/**
 * @jest-environment node
 */
import { POST } from '@/app/api/waitlist/route';

// Helper to create a mock Request
function makeJsonRequest(body: unknown) {
  return new Request('http://localhost/api/waitlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeFormRequest(params: Record<string, string>) {
  const body = new URLSearchParams(params).toString();
  return new Request('http://localhost/api/waitlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
}

describe('POST /api/waitlist', () => {
  it('returns 200 with { success: true } for valid JSON email', async () => {
    const request = makeJsonRequest({ email: 'test@example.com' });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ success: true });
  });

  it('returns 400 with error for invalid JSON email', async () => {
    const request = makeJsonRequest({ email: 'not-an-email' });
    const response = await POST(request);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.success).toBe(false);
    expect(json.error).toBeDefined();
  });

  it('returns 400 for missing email in JSON body', async () => {
    const request = makeJsonRequest({});
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it('returns 303 redirect to /?variant=a&waitlist=success for valid form POST', async () => {
    const request = makeFormRequest({
      email: 'test@example.com',
      variant: 'a',
    });
    const response = await POST(request);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      '/?variant=a&waitlist=success'
    );
  });

  it('returns 303 redirect to /?variant=a&waitlist=error for invalid form POST', async () => {
    const request = makeFormRequest({ email: 'bad', variant: 'a' });
    const response = await POST(request);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      '/?variant=a&waitlist=error'
    );
  });

  it('preserves variant c in redirect for form POST', async () => {
    const request = makeFormRequest({
      email: 'test@example.com',
      variant: 'c',
    });
    const response = await POST(request);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      '/?variant=c&waitlist=success'
    );
  });
});
