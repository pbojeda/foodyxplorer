/**
 * @jest-environment node
 *
 * F039 — Landing Page: API Route Edge-Case Tests (node environment)
 *
 * QA-authored tests for /api/waitlist covering paths not in the developer's suite.
 * Run with: npm test -- edge-cases.api
 */

import { POST } from '@/app/api/waitlist/route';

function makeJsonRequest(body: unknown) {
  return new Request('http://localhost/api/waitlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeRawRequest(body: string, contentType = 'application/json') {
  return new Request('http://localhost/api/waitlist', {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body,
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

describe('POST /api/waitlist — edge cases', () => {
  // -------------------------------------------------------------------------
  // Form POST: missing variant field
  // -------------------------------------------------------------------------
  it('uses "a" as variant fallback when form POST omits the variant field', async () => {
    // WaitlistForm always adds the hidden field, but a hand-crafted no-JS
    // request might omit it.  The route's fallback is ?? 'a'.
    // The redirect URL must not contain the string "undefined".
    const req = makeFormRequest({ email: 'test@example.com' });
    const res = await POST(req);
    expect(res.status).toBe(303);
    const loc = res.headers.get('location') ?? '';
    expect(loc).not.toContain('undefined');
    expect(loc).toContain('variant=a');
  });

  // -------------------------------------------------------------------------
  // JSON body edge cases
  // -------------------------------------------------------------------------
  it('returns 400 for completely empty JSON object {}', async () => {
    const req = makeJsonRequest({});
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for malformed JSON (syntax error)', async () => {
    const req = makeRawRequest('{not valid json');
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it('returns 400 when email is null', async () => {
    const req = makeJsonRequest({ email: null });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when email is a number', async () => {
    const req = makeJsonRequest({ email: 12345 });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when email field is missing but other fields are present', async () => {
    const req = makeJsonRequest({ name: 'Alice', phone: '123' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // Content-Type header on JSON success
  // -------------------------------------------------------------------------
  it('returns application/json content-type on success', async () => {
    const req = makeJsonRequest({ email: 'test@example.com' });
    const res = await POST(req);
    expect(res.headers.get('content-type')).toMatch(/application\/json/i);
  });

  // -------------------------------------------------------------------------
  // Security: email strings that look like XSS or injection payloads
  // The Zod email() validator should reject them at the format level.
  // -------------------------------------------------------------------------
  it('rejects email containing an HTML script tag', async () => {
    const req = makeJsonRequest({ email: '<script>alert(1)</script>@evil.com' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects email with SQL injection fragment', async () => {
    const req = makeJsonRequest({ email: "' OR 1=1--@evil.com" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // Security: very long email — must not crash the server
  // -------------------------------------------------------------------------
  it('handles a 320-character email without throwing', async () => {
    // RFC 5321 max is 320 chars; most validators reject beyond that.
    // We verify the endpoint returns a well-formed HTTP response either way.
    const longLocal = 'a'.repeat(300);
    const longEmail = `${longLocal}@example.com`;
    const req = makeJsonRequest({ email: longEmail });
    const res = await POST(req);
    expect(res.status).toBeDefined();
    expect([200, 400]).toContain(res.status);
  });

  // -------------------------------------------------------------------------
  // Security: form POST with a crafted variant value containing special chars.
  // The route must not crash and must return a 303 (not 5xx).
  // Note: the route currently embeds the raw variant string into the Location
  // header without sanitization — this is a low-severity RISK for open-redirect
  // style header injection if a newline is embedded.
  // -------------------------------------------------------------------------
  it('does not crash when form POST variant contains special characters', async () => {
    const req = makeFormRequest({
      email: 'test@example.com',
      variant: 'a; injected=value',
    });
    const res = await POST(req);
    // Must not return 5xx
    expect(res.status).toBeLessThan(500);
  });

  /**
   * RISK — Header injection via unsanitized `variant` in Location header.
   *
   * The route does:
   *   location: `/?variant=${variant}&waitlist=success`
   * If `variant` contains a newline (\r\n) an attacker can inject arbitrary
   * headers into the 303 response.
   *
   * In practice, Node.js HTTP will reject headers with \r\n at the transport
   * layer, but the application code should sanitize the input itself.
   * This test is marked .todo to document the risk without blocking CI.
   */
  it.todo(
    '[RISK] form POST with newline in variant should not inject response headers'
  );

  // -------------------------------------------------------------------------
  // Form POST: email present but empty string
  // -------------------------------------------------------------------------
  it('redirects to waitlist=error when form POST email is an empty string', async () => {
    const req = makeFormRequest({ email: '', variant: 'a' });
    const res = await POST(req);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('waitlist=error');
  });

  // -------------------------------------------------------------------------
  // No content-type header (edge case — some proxies strip it)
  // -------------------------------------------------------------------------
  it('returns 400 or 200 but does not crash when Content-Type is absent', async () => {
    const req = new Request('http://localhost/api/waitlist', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com' }),
      // No Content-Type header
    });
    // The implementation checks content-type; without it, the request falls
    // through to the JSON path (no content-type header means no 'x-www-form-urlencoded'
    // match).  Verify it returns a valid HTTP status.
    const res = await POST(req);
    expect([200, 400]).toContain(res.status);
  });
});
