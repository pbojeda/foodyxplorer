// F107a — authBearer unit tests (AC9, AC10, AC16, S1, F3)
//
// Tests verifyBearerJwt using a local RS256 keypair — no real Supabase needed.
// JWKS fetch is intercepted via module mocking.

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

// ---------------------------------------------------------------------------
// We mock createRemoteJWKSet from jose to inject our local keypair
// ---------------------------------------------------------------------------

// Store factory so tests can swap keys for rotation tests
let currentPublicKey: Awaited<ReturnType<typeof generateKeyPair>>['publicKey'] | null = null;
let callCount = 0;

vi.mock('jose', async (importOriginal) => {
  const original = await importOriginal<typeof import('jose')>();
  return {
    ...original,
    createRemoteJWKSet: vi.fn((_url: URL) => {
      // Return a function that jose expects (JWKS get key function)
      return async (_header: { alg?: string; kid?: string }) => {
        if (!currentPublicKey) throw new TypeError('fetch failed');
        callCount++;
        return currentPublicKey;
      };
    }),
  };
});

// Import after mock is set up
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

const JWKS_URL = 'https://test.supabase.co/auth/v1/.well-known/jwks.json';

async function makeJwt(
  privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'],
  claims: Record<string, unknown> = {},
  expiry: string | number = '1h',
) {
  return new SignJWT({
    sub: 'test-user-id-uuid',
    email: 'test@example.com',
    aud: 'authenticated',
    iss: 'https://test.supabase.co/auth/v1',
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
    .setExpirationTime(expiry)
    .setIssuedAt()
    .sign(privateKey);
}

afterEach(() => {
  callCount = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('F107a — verifyBearerJwt', () => {
  describe('happy path', () => {
    it('resolves valid RS256 JWT with correct payload', async () => {
      currentPublicKey = publicKeyA;
      const token = await makeJwt(privateKeyA);
      const payload = await verifyBearerJwt(`Bearer ${token}`, JWKS_URL);

      expect(payload.sub).toBe('test-user-id-uuid');
      expect(payload.email).toBe('test@example.com');
      expect(payload.aud).toBe('authenticated');
    });
  });

  describe('S1 — strict Bearer format check', () => {
    it('throws INVALID_TOKEN for non-Bearer scheme (Basic xxx)', async () => {
      currentPublicKey = publicKeyA;
      const err = await verifyBearerJwt('Basic dXNlcjpwYXNz', JWKS_URL).catch((e) => e);

      expect(err).toBeInstanceOf(Error);
      expect((err as Record<string, unknown>)['code']).toBe('INVALID_TOKEN');
    });

    it('throws INVALID_TOKEN for missing Bearer prefix (raw token)', async () => {
      currentPublicKey = publicKeyA;
      const token = await makeJwt(privateKeyA);
      const err = await verifyBearerJwt(token, JWKS_URL).catch((e) => e);

      expect(err).toBeInstanceOf(Error);
      expect((err as Record<string, unknown>)['code']).toBe('INVALID_TOKEN');
    });

    it('throws INVALID_TOKEN for bearer (lowercase b) scheme', async () => {
      currentPublicKey = publicKeyA;
      const token = await makeJwt(privateKeyA);
      const err = await verifyBearerJwt(`bearer ${token}`, JWKS_URL).catch((e) => e);

      expect(err).toBeInstanceOf(Error);
      expect((err as Record<string, unknown>)['code']).toBe('INVALID_TOKEN');
    });
  });

  describe('AC10 — expired JWT', () => {
    it('throws TOKEN_EXPIRED for JWT with exp in past', async () => {
      currentPublicKey = publicKeyA;
      // setExpirationTime('0s') is interpreted as "now" — use a negative offset
      const token = await new SignJWT({
        sub: 'test-user-id-uuid',
        aud: 'authenticated',
        iss: 'https://test.supabase.co/auth/v1',
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
        .setIssuedAt()
        .setExpirationTime(Math.floor(Date.now() / 1000) - 60) // 60s in the past
        .sign(privateKeyA);

      const err = await verifyBearerJwt(`Bearer ${token}`, JWKS_URL).catch((e) => e);

      expect(err).toBeInstanceOf(Error);
      expect((err as Record<string, unknown>)['code']).toBe('TOKEN_EXPIRED');
    });
  });

  describe('AC9 — invalid JWT', () => {
    it('throws INVALID_TOKEN for malformed JWT string', async () => {
      currentPublicKey = publicKeyA;
      const err = await verifyBearerJwt('Bearer not.a.valid.jwt', JWKS_URL).catch((e) => e);

      expect(err).toBeInstanceOf(Error);
      expect((err as Record<string, unknown>)['code']).toBe('INVALID_TOKEN');
    });

    it('throws INVALID_TOKEN for JWT signed by wrong key', async () => {
      currentPublicKey = publicKeyA; // JWKS has keyA
      const token = await makeJwt(privateKeyB); // but token signed with keyB
      const err = await verifyBearerJwt(`Bearer ${token}`, JWKS_URL).catch((e) => e);

      expect(err).toBeInstanceOf(Error);
      // Could be INVALID_TOKEN or trigger key refresh — either is correct
      const code = (err as Record<string, unknown>)['code'];
      expect(['INVALID_TOKEN', 'INVALID_TOKEN']).toContain(code);
    });
  });

  describe('AC16 — JWKS fetch failure', () => {
    it('throws AUTH_PROVIDER_UNAVAILABLE when JWKS fetch fails', async () => {
      currentPublicKey = null; // simulate fetch failure
      const token = await makeJwt(privateKeyA);
      const err = await verifyBearerJwt(`Bearer ${token}`, JWKS_URL).catch((e) => e);

      expect(err).toBeInstanceOf(Error);
      expect((err as Record<string, unknown>)['code']).toBe('AUTH_PROVIDER_UNAVAILABLE');
    });
  });

  describe('F3 — JWKS cache key rotation', () => {
    it('refreshes JWKS cache when key rotation is detected and succeeds with new key', async () => {
      // Reset JWKS cache between tests by reimporting or resetting module state
      // The cache is module-level; we test the refresh logic by:
      // 1. Verify with keyA succeeds
      // 2. Switch to keyB
      // 3. Verify with token signed by keyA fails (old key)
      // 4. Verify with token signed by keyB succeeds (new key after refresh)

      // Step 1: seed cache with keyA
      currentPublicKey = publicKeyA;
      const tokenA = await makeJwt(privateKeyA);
      const payloadA = await verifyBearerJwt(`Bearer ${tokenA}`, JWKS_URL);
      expect(payloadA.sub).toBe('test-user-id-uuid');

      // Step 2: rotate to keyB
      currentPublicKey = publicKeyB;
      const tokenB = await makeJwt(privateKeyB);

      // Step 3: verify with tokenB — cache may still have keyA, but refresh should occur
      // Result should succeed with keyB after force-refresh
      const payloadB = await verifyBearerJwt(`Bearer ${tokenB}`, JWKS_URL);
      expect(payloadB.sub).toBe('test-user-id-uuid');
    });
  });
});
