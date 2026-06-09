// F107a — Auth schema unit tests (AC23, AC25)
//
// Tests Zod schemas from packages/shared/src/schemas/auth.ts.
// All schemas must parse valid data and reject invalid data.

import { describe, it, expect } from 'vitest';
import {
  AccountSchema,
  AccountTierSchema,
  ActorSummarySchema,
  MeResponseSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  UsageBucketSchema,
  UsageResponseSchema,
} from '../schemas/auth.js';

// ---------------------------------------------------------------------------
// AccountSchema (AC23)
// ---------------------------------------------------------------------------

describe('AccountSchema (F107a — AC23)', () => {
  const validAccount = {
    id: 'f1070000-0003-4000-a000-000000000003',
    authUserId: 'f1070000-0004-4000-a000-000000000004',
    email: 'user@example.com',
    createdAt: '2026-05-14T10:00:00.000Z',
    lastSeenAt: '2026-05-14T12:00:00.000Z',
    consentMarketing: false,
    consentMarketingAt: null,
    consentAnalytics: false,
    consentAnalyticsAt: null,
  };

  it('parses a valid accounts row', () => {
    const result = AccountSchema.safeParse(validAccount);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe(validAccount.id);
      expect(result.data.authUserId).toBe(validAccount.authUserId);
      expect(result.data.email).toBe('user@example.com');
      expect(result.data.consentMarketing).toBe(false);
    }
  });

  it('accepts consentMarketingAt as a datetime string', () => {
    const result = AccountSchema.safeParse({
      ...validAccount,
      consentMarketing: true,
      consentMarketingAt: '2026-05-14T11:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const result = AccountSchema.safeParse({ ...validAccount, email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid UUID for id', () => {
    const result = AccountSchema.safeParse({ ...validAccount, id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects missing required field (authUserId)', () => {
    const { authUserId: _omit, ...rest } = validAccount;
    const result = AccountSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ActorSummarySchema
// ---------------------------------------------------------------------------

describe('ActorSummarySchema', () => {
  it('parses valid actor summary', () => {
    const result = ActorSummarySchema.safeParse({
      id: 'f1070000-0001-4000-a000-000000000001',
      type: 'anonymous_web',
      externalId: 'f1070000-e001-4000-a000-000000000001',
      accountId: null,
    });
    expect(result.success).toBe(true);
  });

  it('parses actor with accountId', () => {
    const result = ActorSummarySchema.safeParse({
      id: 'f1070000-0001-4000-a000-000000000001',
      type: 'anonymous_web',
      externalId: 'f1070000-e001-4000-a000-000000000001',
      accountId: 'f1070000-0003-4000-a000-000000000003',
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown type', () => {
    const result = ActorSummarySchema.safeParse({
      id: 'f1070000-0001-4000-a000-000000000001',
      type: 'unknown_type',
      externalId: 'ext-001',
      accountId: null,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MeResponseSchema (AC23)
// ---------------------------------------------------------------------------

describe('MeResponseSchema (F107a — AC23)', () => {
  it('validates nested account + actor', () => {
    const result = MeResponseSchema.safeParse({
      account: {
        id: 'f1070000-0003-4000-a000-000000000003',
        authUserId: 'f1070000-0004-4000-a000-000000000004',
        email: 'user@example.com',
        createdAt: '2026-05-14T10:00:00.000Z',
        lastSeenAt: '2026-05-14T12:00:00.000Z',
        consentMarketing: false,
        consentMarketingAt: null,
        consentAnalytics: false,
        consentAnalyticsAt: null,
      },
      actor: {
        id: 'f1070000-0001-4000-a000-000000000001',
        type: 'anonymous_web',
        externalId: 'f1070000-e001-4000-a000-000000000001',
        accountId: 'f1070000-0003-4000-a000-000000000003',
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects when account is missing', () => {
    const result = MeResponseSchema.safeParse({
      actor: {
        id: 'f1070000-0001-4000-a000-000000000001',
        type: 'anonymous_web',
        externalId: 'ext-001',
        accountId: null,
      },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LoginRequestSchema (AC25) — both providers parse
// ---------------------------------------------------------------------------

describe('LoginRequestSchema (F107a — AC25)', () => {
  it('accepts provider: email with valid fields', () => {
    const result = LoginRequestSchema.safeParse({
      provider: 'email',
      email: 'user@example.com',
      redirectTo: 'https://app.nutrixplorer.com/auth/callback',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe('email');
    }
  });

  it('accepts provider: google with redirectTo', () => {
    const result = LoginRequestSchema.safeParse({
      provider: 'google',
      redirectTo: 'https://app.nutrixplorer.com/auth/callback',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe('google');
    }
  });

  it('rejects email provider with missing email', () => {
    const result = LoginRequestSchema.safeParse({
      provider: 'email',
      redirectTo: 'https://app.nutrixplorer.com/auth/callback',
      // email intentionally missing
    });
    expect(result.success).toBe(false);
  });

  it('rejects email provider with invalid email format', () => {
    const result = LoginRequestSchema.safeParse({
      provider: 'email',
      email: 'not-an-email',
      redirectTo: 'https://app.nutrixplorer.com/auth/callback',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown provider', () => {
    const result = LoginRequestSchema.safeParse({
      provider: 'facebook',
      redirectTo: 'https://app.nutrixplorer.com/auth/callback',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing redirectTo', () => {
    const result = LoginRequestSchema.safeParse({
      provider: 'email',
      email: 'user@example.com',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-URL redirectTo', () => {
    const result = LoginRequestSchema.safeParse({
      provider: 'email',
      email: 'user@example.com',
      redirectTo: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LoginResponseSchema
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// AccountTierSchema (F-WEB-TIER — AC16)
// ---------------------------------------------------------------------------

describe('AccountTierSchema (F-WEB-TIER)', () => {
  it('parses free', () => {
    const result = AccountTierSchema.safeParse('free');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('free');
  });

  it('parses pro', () => {
    const result = AccountTierSchema.safeParse('pro');
    expect(result.success).toBe(true);
  });

  it('parses admin', () => {
    const result = AccountTierSchema.safeParse('admin');
    expect(result.success).toBe(true);
  });

  it('rejects superuser (invalid tier)', () => {
    const result = AccountTierSchema.safeParse('superuser');
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AccountSchema — tier field (F-WEB-TIER — AC16, E10 deploy-skew resilience)
// ---------------------------------------------------------------------------

describe('AccountSchema — tier field (F-WEB-TIER — AC16)', () => {
  const validAccount = {
    id: 'f1070000-0003-4000-a000-000000000003',
    authUserId: 'f1070000-0004-4000-a000-000000000004',
    email: 'user@example.com',
    createdAt: '2026-05-14T10:00:00.000Z',
    lastSeenAt: '2026-05-14T12:00:00.000Z',
    consentMarketing: false,
    consentMarketingAt: null,
    consentAnalytics: false,
    consentAnalyticsAt: null,
  };

  it('parses payload with tier: free', () => {
    const result = AccountSchema.safeParse({ ...validAccount, tier: 'free' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tier).toBe('free');
  });

  it('parses payload without tier (optional — deploy-skew resilience)', () => {
    const result = AccountSchema.safeParse(validAccount);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tier).toBeUndefined();
  });

  it('rejects tier: superuser', () => {
    const result = AccountSchema.safeParse({ ...validAccount, tier: 'superuser' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// UsageBucketSchema (F-WEB-TIER)
// ---------------------------------------------------------------------------

describe('UsageBucketSchema (F-WEB-TIER)', () => {
  it('parses a valid free-tier bucket', () => {
    const result = UsageBucketSchema.safeParse({ used: 12, limit: 100, remaining: 88 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.used).toBe(12);
      expect(result.data.limit).toBe(100);
      expect(result.data.remaining).toBe(88);
    }
  });

  it('parses an admin bucket (limit: null, remaining: null)', () => {
    const result = UsageBucketSchema.safeParse({ used: 0, limit: null, remaining: null });
    expect(result.success).toBe(true);
  });

  it('rejects used: -1 (nonnegative constraint)', () => {
    const result = UsageBucketSchema.safeParse({ used: -1, limit: 100, remaining: 101 });
    expect(result.success).toBe(false);
  });

  it('rejects missing used field', () => {
    const result = UsageBucketSchema.safeParse({ limit: 100, remaining: 100 });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// UsageResponseSchema (F-WEB-TIER — AC29)
// ---------------------------------------------------------------------------

describe('UsageResponseSchema (F-WEB-TIER — AC29)', () => {
  const freeBucket = { used: 12, limit: 100, remaining: 88 };
  const zeroBucket = { used: 0, limit: 20, remaining: 20 };
  const voiceBucket = { used: 5, limit: 30, remaining: 25 };
  const adminBucket = { used: 0, limit: null, remaining: null };

  it('parses full free-tier response', () => {
    const result = UsageResponseSchema.safeParse({
      tier: 'free',
      resetAt: '2026-05-27T00:00:00.000Z',
      buckets: {
        queries: freeBucket,
        photos: zeroBucket,
        voice: voiceBucket,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tier).toBe('free');
      expect(result.data.buckets.queries.used).toBe(12);
      expect(result.data.buckets.photos.limit).toBe(20);
    }
  });

  it('parses admin-tier response (all limit/remaining: null)', () => {
    const result = UsageResponseSchema.safeParse({
      tier: 'admin',
      resetAt: '2026-05-27T00:00:00.000Z',
      buckets: {
        queries: adminBucket,
        photos: adminBucket,
        voice: adminBucket,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.buckets.queries.limit).toBeNull();
      expect(result.data.buckets.voice.remaining).toBeNull();
    }
  });

  it('rejects response missing buckets.voice', () => {
    const result = UsageResponseSchema.safeParse({
      tier: 'free',
      resetAt: '2026-05-27T00:00:00.000Z',
      buckets: {
        queries: freeBucket,
        photos: zeroBucket,
        // voice intentionally omitted
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid tier value', () => {
    const result = UsageResponseSchema.safeParse({
      tier: 'anonymous',
      resetAt: '2026-05-27T00:00:00.000Z',
      buckets: {
        queries: freeBucket,
        photos: zeroBucket,
        voice: voiceBucket,
      },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LoginResponseSchema
// ---------------------------------------------------------------------------

describe('LoginResponseSchema', () => {
  it('parses email success response', () => {
    const result = LoginResponseSchema.safeParse({
      provider: 'email',
      success: true,
    });
    expect(result.success).toBe(true);
  });

  it('parses google URL response', () => {
    const result = LoginResponseSchema.safeParse({
      provider: 'google',
      url: 'https://accounts.google.com/oauth/...',
    });
    expect(result.success).toBe(true);
  });

  it('rejects email response without success', () => {
    const result = LoginResponseSchema.safeParse({
      provider: 'email',
    });
    expect(result.success).toBe(false);
  });
});
