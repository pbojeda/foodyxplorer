// F107a — FINDING-4: F3 JWKS key rotation test quality issue
//
// The existing rotation test in f107a.authBearer.unit.test.ts uses a mock where
// each getKey function reads `currentPublicKey` dynamically at VERIFY-time.
// Because the module-level jwksCache holds a function that always reads the
// current key, switching currentPublicKey to B causes tokenB to succeed WITHOUT
// triggering JWSSignatureVerificationFailed → invalidateJwksCache() code path.
//
// This file provides a CORRECTLY STRUCTURED rotation test that freezes the key
// at createRemoteJWKSet-call time (as a real JWKS endpoint would) so that:
//   1. A stale cache with keyA causes tokenB to fail → JWSSignatureVerificationFailed
//   2. The invalidate+refresh path runs → new call to createRemoteJWKSet → keyB fetched
//   3. tokenB verified successfully using the fresh keyB
//
// The test proves the refresh ran by counting createRemoteJWKSet invocations.
// Expected: 2 calls (initial + forced refresh).

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { generateKeyPair, SignJWT } from 'jose';

// ---------------------------------------------------------------------------
// Fixed mock: freeze key at createRemoteJWKSet call time
// ---------------------------------------------------------------------------

let currentKey: Awaited<ReturnType<typeof generateKeyPair>>['publicKey'] | null = null;
let jwksCallCount = 0;

vi.mock('jose', async (importOriginal) => {
  const original = await importOriginal<typeof import('jose')>();
  return {
    ...original,
    // Correct mock: each createRemoteJWKSet call CAPTURES currentKey at call time.
    // The returned getKey function uses the FROZEN key, not the live variable.
    // This mirrors real JWKS behavior: once a key set is fetched, it's cached.
    createRemoteJWKSet: vi.fn((_url: URL) => {
      jwksCallCount++;
      const frozenKey = currentKey; // Capture at call time (immutable snapshot)
      return async (_header: { alg?: string; kid?: string }) => {
        if (!frozenKey) throw new TypeError('fetch failed');
        return frozenKey; // Returns the KEY THAT WAS CURRENT when cache was built
      };
    }),
  };
});

const { verifyBearerJwt } = await import('../../plugins/authBearer.js');

// ---------------------------------------------------------------------------
// Key fixtures
// ---------------------------------------------------------------------------

let privateKeyA: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let publicKeyA: Awaited<ReturnType<typeof generateKeyPair>>['publicKey'];
let privateKeyB: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let publicKeyB: Awaited<ReturnType<typeof generateKeyPair>>['publicKey'];

beforeAll(async () => {
  const pairA = await generateKeyPair('RS256');
  privateKeyA = pairA.privateKey;
  publicKeyA = pairA.publicKey;
  const pairB = await generateKeyPair('RS256');
  privateKeyB = pairB.privateKey;
  publicKeyB = pairB.publicKey;
});

const JWKS_URL = 'https://test-rotation-fixed.supabase.co/auth/v1/.well-known/jwks.json';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('F107a FINDING-4 — F3: JWKS rotation CORRECTLY exercises invalidate+refresh code path', () => {
  it('F3 rotation: createRemoteJWKSet called exactly TWICE — on first use AND on forced refresh', async () => {
    // Reset call counter
    jwksCallCount = 0;

    // Step 1: Seed cache with keyA
    currentKey = publicKeyA;
    const tokenA = await new SignJWT({
      sub: 'rotation-user-a',
      aud: 'authenticated',
      iss: JWKS_URL,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'kid-a' })
      .setExpirationTime('1h')
      .setIssuedAt()
      .sign(privateKeyA);

    const payloadA = await verifyBearerJwt(`Bearer ${tokenA}`, JWKS_URL);
    expect(payloadA.sub).toBe('rotation-user-a');
    // First createRemoteJWKSet call — cache is built with frozenKey = publicKeyA
    expect(jwksCallCount).toBe(1);

    // Step 2: Rotate to keyB
    // Update currentKey to publicKeyB — but the CACHED getKey function still has publicKeyA frozen
    currentKey = publicKeyB;
    const tokenB = await new SignJWT({
      sub: 'rotation-user-b',
      aud: 'authenticated',
      iss: JWKS_URL,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'kid-b' })
      .setExpirationTime('1h')
      .setIssuedAt()
      .sign(privateKeyB);

    // Step 3: Verify tokenB — the STALE cache returns publicKeyA (frozen at step 1)
    //   → jose.jwtVerify(tokenB, fn_returning_keyA) → JWSSignatureVerificationFailed
    //   → authBearer.ts: invalidateJwksCache() → getOrCreateJwks() → createRemoteJWKSet AGAIN (call #2)
    //   → new frozenKey = publicKeyB → jwtVerify(tokenB, fn_returning_keyB) → SUCCESS
    const payloadB = await verifyBearerJwt(`Bearer ${tokenB}`, JWKS_URL);
    expect(payloadB.sub).toBe('rotation-user-b');

    // THE KEY ASSERTION: createRemoteJWKSet must have been called TWICE.
    // If the refresh code path was bypassed (bug), count = 1 and this fails.
    // If the refresh ran correctly (fix), count = 2.
    expect(jwksCallCount).toBe(2);
  });

  it('F3 rotation: tokenA still fails after rotation to keyB (old key truly invalidated)', async () => {
    // After rotation, tokenA (signed with privateKeyA) should fail because:
    //   - cache now has publicKeyB (refreshed in previous test)
    //   - tokenA cannot be verified with publicKeyB
    //   - retry with publicKeyB also fails → INVALID_TOKEN (not another refresh)

    // Note: This test depends on jwksCache state from the previous test.
    // cache should currently hold publicKeyB from the refresh in the previous test.

    const tokenA = await new SignJWT({
      sub: 'rotation-user-a',
      aud: 'authenticated',
      iss: JWKS_URL,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'kid-a' })
      .setExpirationTime('1h')
      .setIssuedAt()
      .sign(privateKeyA);

    const err = await verifyBearerJwt(`Bearer ${tokenA}`, JWKS_URL).catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Record<string, unknown>)['code']).toBe('INVALID_TOKEN');
  });
});
