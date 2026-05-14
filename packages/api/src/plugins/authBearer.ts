// authBearer.ts — JWT verification via Supabase JWKS (F107a, ADR-025 R3 §2)
//
// verifyBearerJwt(authorizationHeader, jwksUrl) validates RS256 JWTs issued
// by Supabase and returns the decoded payload. Used by:
//   - actorResolver.ts — bearer pre-check on every request
//   - routes/auth.ts   — preHandler on /auth/logout and GET /me
//
// Error codes thrown (duck-typed, matched by errorHandler.ts):
//   TOKEN_EXPIRED             — JWT expired (jose JWTExpired)
//   INVALID_TOKEN             — malformed, wrong scheme, signature invalid
//   AUTH_PROVIDER_UNAVAILABLE — JWKS endpoint unreachable (Supabase outage)
//
// S1: Strict Bearer format enforcement (RFC 6750).
//   Present but NOT "Bearer <token>" → INVALID_TOKEN immediately.
//   Never silently downgrade to anonymous flow.
//
// F3: JWKS key rotation support.
//   JWKS instance is module-level cached. On JWSSignatureVerificationFailed,
//   the cache is cleared and the JWKS set is recreated once, then the
//   verification is retried with the refreshed key set.

import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from 'jose';

// ---------------------------------------------------------------------------
// Fastify type augmentation
// ---------------------------------------------------------------------------

declare module 'fastify' {
  interface FastifyRequest {
    authPayload?: JwtPayload;
    accountId?: string;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JwtPayload {
  sub: string;
  email?: string;
  exp: number;
  aud: string;
  iss: string;
}

// ---------------------------------------------------------------------------
// JWKS cache — module-level singleton (force-refresh on key rotation)
// ---------------------------------------------------------------------------

type JwksGetKey = ReturnType<typeof createRemoteJWKSet>;

interface JwksCacheEntry {
  url: string;
  getKey: JwksGetKey;
}

let jwksCache: JwksCacheEntry | null = null;

function getOrCreateJwks(jwksUrl: string): JwksGetKey {
  if (!jwksCache || jwksCache.url !== jwksUrl) {
    jwksCache = { url: jwksUrl, getKey: createRemoteJWKSet(new URL(jwksUrl)) };
  }
  return jwksCache.getKey;
}

function invalidateJwksCache(): void {
  jwksCache = null;
}

// ---------------------------------------------------------------------------
// verifyBearerJwt — primary export
// ---------------------------------------------------------------------------

/**
 * Verify a bearer JWT from an Authorization header value.
 *
 * @param authorizationHeader  The raw value of the Authorization header
 *                             (e.g. "Bearer eyJ...")
 * @param jwksUrl              JWKS endpoint URL to fetch public keys from
 * @returns JwtPayload         Decoded and verified JWT payload
 * @throws Error with code TOKEN_EXPIRED | INVALID_TOKEN | AUTH_PROVIDER_UNAVAILABLE
 */
export async function verifyBearerJwt(
  authorizationHeader: string,
  jwksUrl: string,
): Promise<JwtPayload> {
  // S1: Strict Bearer format check (RFC 6750 §2.1)
  // Header MUST start with exactly "Bearer " (capital B, one space).
  if (!authorizationHeader.startsWith('Bearer ')) {
    throw Object.assign(new Error('Authorization header must use Bearer scheme'), {
      code: 'INVALID_TOKEN',
    });
  }

  const token = authorizationHeader.slice('Bearer '.length);

  // Attempt verification — with key rotation retry on signature failure.
  // E3 self-review (qa-engineer 2026-05-14): require `sub` claim explicitly.
  // jose v5 jwtVerify does NOT mandate `sub` by default; a JWT without `sub` would
  // pass verification and produce `payload.sub === undefined`, breaking downstream
  // accounts upsert (UUID cast error → 500). Listing `sub` in requiredClaims makes
  // jose throw JWTClaimValidationFailed → already mapped to INVALID_TOKEN.
  const verifyOpts = { requiredClaims: ['sub'] };
  const getKey = getOrCreateJwks(jwksUrl);
  try {
    const { payload } = await jwtVerify(token, getKey, verifyOpts);
    return payload as unknown as JwtPayload;
  } catch (err) {
    // Key rotation: Supabase rotated keys → JWSSignatureVerificationFailed
    // Invalidate cache, create new JWKS set, and retry once.
    if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
      invalidateJwksCache();
      const freshGetKey = getOrCreateJwks(jwksUrl);
      try {
        const { payload } = await jwtVerify(token, freshGetKey, verifyOpts);
        return payload as unknown as JwtPayload;
      } catch (retryErr) {
        return mapJoseError(retryErr);
      }
    }

    return mapJoseError(err);
  }
}

// ---------------------------------------------------------------------------
// mapJoseError — convert jose errors to typed application errors
// ---------------------------------------------------------------------------

function mapJoseError(err: unknown): never {
  if (err instanceof joseErrors.JWTExpired) {
    throw Object.assign(new Error('JWT has expired'), { code: 'TOKEN_EXPIRED' });
  }

  if (
    err instanceof joseErrors.JWTInvalid ||
    err instanceof joseErrors.JWSInvalid ||
    err instanceof joseErrors.JWSSignatureVerificationFailed ||
    err instanceof joseErrors.JWTClaimValidationFailed
  ) {
    throw Object.assign(new Error('JWT is invalid'), { code: 'INVALID_TOKEN' });
  }

  // Network/fetch errors (Supabase JWKS endpoint unreachable)
  if (err instanceof TypeError || (err instanceof Error && err.message.includes('fetch'))) {
    throw Object.assign(new Error('Auth provider JWKS endpoint is unavailable'), {
      code: 'AUTH_PROVIDER_UNAVAILABLE',
    });
  }

  // Unknown error from jose (e.g. JWKSNoMatchingKey, etc.)
  throw Object.assign(new Error('JWT verification failed'), { code: 'INVALID_TOKEN' });
}
