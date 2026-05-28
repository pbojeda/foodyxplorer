// BUG-API-RATELIMIT-BEARER-001 — global limiter must be bearer-aware.
//
// The GLOBAL limiter (plugins/rateLimit.ts, @fastify/rate-limit, 15-min window)
// previously only knew req.apiKeyContext. A logged-in WEB user sends a Supabase
// bearer but NO X-API-Key, so they fell into the anonymous ip:<ip> bucket
// (30 req/15min) regardless of account tier — tripped after a handful of actions
// once F-WEB-HISTORY added the read fan-out (/me, /me/usage, /history, loadMore).
//
// Fix (Option B — flat per-account abuse backstop; daily tier quota stays in
// actorRateLimit): bearer-first precedence (ADR-027):
//   key: account:<sub>  >  apiKey:<keyId>  >  ip:<ip>
//   max: AUTHENTICATED (600)  >  pro key (1000)  >  any key (100)  >  ip (30)
//
// The helpers stay PURE + SYNC (the bearer max is a constant, NOT a per-request
// tier lookup) so the global limiter adds no DB/Redis call on the hot path.

import { describe, it, expect } from 'vitest';
import type { ApiKeyContext } from '@foodxplorer/shared';
import {
  getRateLimitMax,
  getRateLimitKeyGenerator,
  AUTHENTICATED_RATE_LIMIT_MAX,
} from '../plugins/rateLimit.js';

type Req = {
  accountId?: string;
  apiKeyContext?: ApiKeyContext;
  ip?: string;
};

const SUB = 'a1b2c3d4-0001-4000-a000-000000000001'; // JWT sub = auth_user_id
const KEY_ID = 'fd000000-0001-4000-a000-000000000001';

describe('getRateLimitMax — bearer (BUG-API-RATELIMIT-BEARER-001)', () => {
  it('returns the authenticated max for a bearer (accountId set), NOT the anon 30', () => {
    const req: Req = { accountId: SUB };
    expect(getRateLimitMax(req)).toBe(AUTHENTICATED_RATE_LIMIT_MAX);
    expect(getRateLimitMax(req)).not.toBe(30);
  });

  it('the authenticated max is 600 (flat abuse backstop)', () => {
    expect(AUTHENTICATED_RATE_LIMIT_MAX).toBe(600);
  });

  it('bearer wins over a shared API key (ADR-027): account max, not the key tier max', () => {
    // /analyze/menu case: web proxy sends shared X-API-Key (pro) AND forwards the bearer.
    const req: Req = { accountId: SUB, apiKeyContext: { keyId: KEY_ID, tier: 'pro' } };
    expect(getRateLimitMax(req)).toBe(AUTHENTICATED_RATE_LIMIT_MAX);
  });

  // Regression — non-bearer paths unchanged
  it('anonymous (no accountId, no apiKeyContext) still 30', () => {
    expect(getRateLimitMax({})).toBe(30);
  });
  it('api-key-only free still 100', () => {
    expect(getRateLimitMax({ apiKeyContext: { keyId: KEY_ID, tier: 'free' } })).toBe(100);
  });
  it('api-key-only pro still 1000', () => {
    expect(getRateLimitMax({ apiKeyContext: { keyId: KEY_ID, tier: 'pro' } })).toBe(1000);
  });
});

describe('getRateLimitKeyGenerator — bearer (BUG-API-RATELIMIT-BEARER-001)', () => {
  it('keys by account:<sub> for a bearer, NOT by ip (the core fix)', () => {
    const req: Req = { accountId: SUB, ip: '1.2.3.4' };
    expect(getRateLimitKeyGenerator(req)).toBe(`account:${SUB}`);
    expect(getRateLimitKeyGenerator(req)).not.toContain('1.2.3.4');
  });

  it('bearer wins over a shared API key (ADR-027): account key, not apiKey key', () => {
    const req: Req = { accountId: SUB, apiKeyContext: { keyId: KEY_ID, tier: 'pro' }, ip: '1.2.3.4' };
    expect(getRateLimitKeyGenerator(req)).toBe(`account:${SUB}`);
  });

  it('same account from different IPs/devices shares ONE bucket (not per-IP)', () => {
    const reqA: Req = { accountId: SUB, ip: '1.2.3.4' };
    const reqB: Req = { accountId: SUB, ip: '5.6.7.8' };
    expect(getRateLimitKeyGenerator(reqA)).toBe(getRateLimitKeyGenerator(reqB));
  });

  it('different accounts get different buckets (no cross-contamination)', () => {
    const reqA: Req = { accountId: SUB };
    const reqB: Req = { accountId: 'b2c3d4e5-0002-4000-a000-000000000002' };
    expect(getRateLimitKeyGenerator(reqA)).not.toBe(getRateLimitKeyGenerator(reqB));
  });

  // Regression — non-bearer paths unchanged
  it('api-key-only still keys by apiKey:<keyId>', () => {
    const req: Req = { apiKeyContext: { keyId: KEY_ID, tier: 'free' }, ip: '1.2.3.4' };
    expect(getRateLimitKeyGenerator(req)).toBe(`apiKey:${KEY_ID}`);
  });
  it('anonymous still keys by ip:<ip>', () => {
    expect(getRateLimitKeyGenerator({ ip: '1.2.3.4' })).toBe('ip:1.2.3.4');
  });

  // Defensive: accountId = JWT sub. verifyBearerJwt requires the `sub` claim to be
  // PRESENT (jose requiredClaims) but does not enforce non-empty, so an empty sub
  // is theoretically possible. The truthiness guard treats '' as no bearer → the
  // request falls through to the (safe) ip bucket rather than keying on "account:".
  it('empty-string accountId is treated as no bearer (falls through to ip bucket + 30)', () => {
    expect(getRateLimitKeyGenerator({ accountId: '', ip: '1.2.3.4' })).toBe('ip:1.2.3.4');
    expect(getRateLimitMax({ accountId: '' })).toBe(30);
  });
});
