// adminAuth.ts — Admin API key validation (F026)
//
// Exports validateAdminKey(headerValue, adminApiKey): void — a pure function
// that throws UNAUTHORIZED on mismatch or missing header.
//
// Uses timingSafeEqual on SHA-256 hashes of both sides so that:
//   - Buffer lengths are always equal (SHA-256 always produces 32 bytes)
//   - Timing attacks cannot distinguish "wrong key" from "no key"
//
// Called from the global onRequest hook in auth.ts for admin route URLs.
// NOT a Fastify hook itself — pure function design allows unit testing without
// a Fastify server, and allows auth.ts to call it from a single global hook.

import { createHash, timingSafeEqual } from 'node:crypto';

// ---------------------------------------------------------------------------
// validateAdminKey
// ---------------------------------------------------------------------------

/**
 * Validates that `headerValue` matches `adminApiKey` using a timing-safe
 * SHA-256 comparison.
 *
 * Throws an error with `code: 'UNAUTHORIZED'` on any mismatch, including:
 *   - missing or empty header
 *   - wrong key
 *
 * @param headerValue  The value of the X-API-Key request header (may be undefined)
 * @param adminApiKey  The expected ADMIN_API_KEY from config
 */
export function validateAdminKey(
  headerValue: string | string[] | undefined,
  adminApiKey: string,
): void {
  // Normalise: take first value if array (Fastify can return string[])
  const provided = Array.isArray(headerValue) ? headerValue[0] : headerValue;

  if (!provided) {
    throw Object.assign(new Error('Admin API key required'), { code: 'UNAUTHORIZED' });
  }

  // Hash both sides so timingSafeEqual always receives equal-length Buffers
  // (SHA-256 always produces exactly 32 bytes regardless of input length)
  const providedHash = createHash('sha256').update(provided).digest();
  const expectedHash = createHash('sha256').update(adminApiKey).digest();

  if (!timingSafeEqual(providedHash, expectedHash)) {
    throw Object.assign(new Error('Admin API key required'), { code: 'UNAUTHORIZED' });
  }
}
