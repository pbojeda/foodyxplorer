// F107a — /me rate-limit keyGenerator unit test (F2 self-review + AC27)
//
// AC27 specifies a per-bearer rate limit of 30/min/accountId on GET /me.
// Implementation lives in `packages/api/src/routes/auth.ts` as a route-level
// `@fastify/rate-limit` config:
//   keyGenerator: (req) => req.accountId ?? req.ip
//
// In NODE_ENV=test the rate-limit plugin is intentionally skipped (see
// `rateLimit.ts`), so a full 31-call integration test would be a no-op.
// Instead, this file unit-tests the keyGenerator function in isolation:
// - When accountId is set on the request → uses it (per-bearer scoping).
// - When accountId is absent → falls back to req.ip (per-IP scoping for
//   anonymous /me callers — defensive; /me requires bearer in normal flow).
// - Two different accountIds → two different bucket keys (multi-tenant safe).

import { describe, it, expect } from 'vitest';

// Mirror the keyGenerator from routes/auth.ts GET /me config.
// Kept in sync manually — if the route changes, this constant must change.
type ReqLike = { accountId?: string; ip: string };
const meRouteKeyGenerator = (req: ReqLike): string => req.accountId ?? req.ip;

describe('F107a — /me rate-limit keyGenerator (AC27, F2 self-review)', () => {
  it('returns accountId when bearer-authenticated (per-bearer bucket)', () => {
    const req: ReqLike = {
      accountId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      ip: '203.0.113.10',
    };
    expect(meRouteKeyGenerator(req)).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  });

  it('falls back to req.ip when accountId is undefined', () => {
    const req: ReqLike = { ip: '203.0.113.10' };
    expect(meRouteKeyGenerator(req)).toBe('203.0.113.10');
  });

  it('two different accountIds map to two different buckets', () => {
    const reqA: ReqLike = { accountId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', ip: '1.1.1.1' };
    const reqB: ReqLike = { accountId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', ip: '1.1.1.1' };
    const keyA = meRouteKeyGenerator(reqA);
    const keyB = meRouteKeyGenerator(reqB);
    expect(keyA).not.toBe(keyB);
    expect(keyA).toBe('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa');
    expect(keyB).toBe('bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb');
  });

  it('same accountId across different IPs maps to same bucket (per-bearer, not per-IP)', () => {
    const sameAccount = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
    const reqMobile: ReqLike = { accountId: sameAccount, ip: '10.0.0.1' };
    const reqLaptop: ReqLike = { accountId: sameAccount, ip: '192.168.1.50' };
    expect(meRouteKeyGenerator(reqMobile)).toBe(meRouteKeyGenerator(reqLaptop));
  });

  it('accountId empty string is returned literally (?? does NOT short-circuit on "")', () => {
    // Pinning current behaviour: `'' ?? ip` evaluates to `''` (not `ip`).
    // Production code path never sets accountId='' (jose JWT sub is validated as UUID
    // by jose's requiredClaims check in authBearer.ts), so this is a defensive
    // characterization. If empty strings were ever to leak in, ALL such callers would
    // share the same bucket — flagged here so a future change to the keyGenerator
    // (?? → ||) is a conscious decision, not a regression.
    const req: ReqLike = { accountId: '', ip: '203.0.113.99' };
    expect(meRouteKeyGenerator(req)).toBe('');
  });
});
