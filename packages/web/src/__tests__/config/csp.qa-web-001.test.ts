// QA-WEB-001: CSP validation tests.
//
// Areas covered:
//   BUG-QA-001 — script-src missing googletagmanager.com (P1 bug)
//   BUG-QA-002 — connect-src missing google-analytics.com (P1 bug)
//   connect-src contains API URL (baseline assertion)
//   script-src contains 'self' (baseline: CSP is parseable)
//
// These tests import next.config.mjs directly and call headers() async.
// Tests for BUG-QA-001 and BUG-QA-002 assert the CURRENT broken state
// (GA4 domains NOT present) — update when fix lands.

// ---------------------------------------------------------------------------
// CSP header extraction helper
// ---------------------------------------------------------------------------

type HeaderEntry = { key: string; value: string };
type HeadersConfig = Array<{ source: string; headers: HeaderEntry[] }>;

async function getCspValue(): Promise<string> {
  // next.config.mjs is an ESM module. next/jest transforms it via babel.
  // Use jest.requireActual to load the compiled/transformed version.
  const mod = jest.requireActual('../../../next.config.mjs') as {
    default: { headers: () => Promise<HeadersConfig> };
  };
  const nextConfig = mod.default;
  const headersConfig = await nextConfig.headers();

  const catchAllEntry = headersConfig.find((h) => h.source === '/(.*)');
  if (!catchAllEntry) {
    throw new Error('CSP test: no catch-all headers entry found in next.config.mjs');
  }

  const cspHeader = catchAllEntry.headers.find(
    (h) => h.key === 'Content-Security-Policy-Report-Only'
  );
  if (!cspHeader) {
    throw new Error('CSP test: Content-Security-Policy-Report-Only header not found');
  }

  return cspHeader.value;
}

function extractDirective(csp: string, directive: string): string {
  // e.g. directive = 'script-src' — find "script-src <values>;" or end of string
  const regex = new RegExp(`${directive}\\s+([^;]+)`, 'i');
  const match = csp.match(regex);
  if (!match) return '';
  return match[1].trim();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QA-WEB-001 CSP validation', () => {
  it('script-src contains \'self\' (baseline: CSP is parseable)', async () => {
    const csp = await getCspValue();
    const scriptSrc = extractDirective(csp, 'script-src');
    expect(scriptSrc).toContain("'self'");
  });

  it('connect-src contains the API URL (NEXT_PUBLIC_API_URL or fallback)', async () => {
    const expectedUrl =
      process.env['NEXT_PUBLIC_API_URL'] ?? 'https://api.nutrixplorer.com';
    const csp = await getCspValue();
    const connectSrc = extractDirective(csp, 'connect-src');
    expect(connectSrc).toContain(expectedUrl);
  });

  it('documents BUG-QA-001: script-src does NOT contain googletagmanager.com (P1 bug)', async () => {
    // Documents BUG-QA-001 — current behavior; update when fix lands.
    // GA4 will silently fail when CSP is upgraded from Report-Only to enforced.
    const csp = await getCspValue();
    const scriptSrc = extractDirective(csp, 'script-src');
    // Asserting CURRENT broken state: googletagmanager.com is absent
    expect(scriptSrc).not.toContain('googletagmanager.com');
  });

  it('documents BUG-QA-002: connect-src does NOT contain google-analytics.com (P1 bug)', async () => {
    // Documents BUG-QA-002 — current behavior; update when fix lands.
    // GA4 analytics calls will be blocked when CSP is enforced.
    const csp = await getCspValue();
    const connectSrc = extractDirective(csp, 'connect-src');
    // Asserting CURRENT broken state: google-analytics.com is absent
    expect(connectSrc).not.toContain('google-analytics.com');
  });
});
