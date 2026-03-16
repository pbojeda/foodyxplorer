// SSRF guard — shared utility extracted from url.ts.
//
// assertNotSsrf(url) blocks requests to private/loopback/link-local addresses
// and enforces http/https-only schemes.
//
// Used by: routes/ingest/url.ts, routes/ingest/pdf-url.ts

// ---------------------------------------------------------------------------
// SSRF block patterns
// ---------------------------------------------------------------------------

// Block localhost, 0.0.0.0, RFC1918 private ranges, link-local, and IPv6 loopback/link-local
const SSRF_BLOCKED =
  /^(localhost|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|\[?::1\]?|\[?fe80:.*)$/i;

// Node.js WHATWG URL normalizes IPv4-mapped IPv6 to hex notation (e.g.
// [::ffff:127.0.0.1] → "[::ffff:7f00:1]"), making it impossible to check
// against IPv4 ranges after normalization. Block all ::ffff: addresses
// outright: there is no valid use case for submitting an IPv4-mapped IPv6
// URL to this API endpoint.
const SSRF_BLOCKED_IPV4_MAPPED = /^\[?::ffff:/i;

// ---------------------------------------------------------------------------
// assertNotSsrf
// ---------------------------------------------------------------------------

/**
 * Validates that the given URL is safe to fetch (not an SSRF target).
 *
 * Throws an Error with { code: 'INVALID_URL', statusCode: 422 } if:
 *   - URL scheme is not http or https
 *   - Hostname is a numeric IP (decimal/hex bypass)
 *   - Hostname matches SSRF_BLOCKED (private/loopback/link-local)
 *   - Hostname matches SSRF_BLOCKED_IPV4_MAPPED (IPv4-mapped IPv6)
 *
 * Callers must have already validated that the string is a valid URL
 * (e.g., via Zod z.string().url()) before calling this function.
 */
export function assertNotSsrf(url: string): void {
  const parsedUrl = new URL(url); // Safe: caller ensures url is valid

  // Block non-http/https schemes
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw Object.assign(
      new Error('URL must use http or https scheme'),
      { statusCode: 422, code: 'INVALID_URL' },
    );
  }

  // Block numeric IP representations (decimal/hex bypass: 2130706433 = 127.0.0.1)
  if (/^\d+$/.test(parsedUrl.hostname) || /^0x/i.test(parsedUrl.hostname)) {
    throw Object.assign(
      new Error('Numeric IP addresses are not allowed'),
      { statusCode: 422, code: 'INVALID_URL' },
    );
  }

  // Block private/loopback/link-local addresses and IPv4-mapped IPv6
  if (SSRF_BLOCKED.test(parsedUrl.hostname) || SSRF_BLOCKED_IPV4_MAPPED.test(parsedUrl.hostname)) {
    throw Object.assign(
      new Error('URL targets a private or loopback address'),
      { statusCode: 422, code: 'INVALID_URL' },
    );
  }
}
