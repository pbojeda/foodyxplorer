// Auth fixture factories for F107a tests.
// All factories accept optional overrides for fine-grained control.
// Pattern mirrors src/__tests__/fixtures.ts.

import type { User, Session } from '@supabase/supabase-js';
import type { Account, ActorSummary } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// createMockUser — Supabase User shape
// ---------------------------------------------------------------------------

export function createMockUser(overrides: Partial<User> = {}): User {
  return {
    id: 'aaaaaaaa-0000-4000-a000-000000000001',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-05-14T12:00:00.000Z',
    email: 'test@example.com',
    email_confirmed_at: '2026-05-14T12:00:00.000Z',
    role: 'authenticated',
    updated_at: '2026-05-14T12:00:00.000Z',
    identities: [],
    factors: [],
    ...overrides,
  } as User;
}

// ---------------------------------------------------------------------------
// createMockSession — Supabase Session shape
// ---------------------------------------------------------------------------

export function createMockSession(overrides: Partial<Session> = {}): Session {
  const user = createMockUser();
  return {
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user,
    ...overrides,
  } as Session;
}

// ---------------------------------------------------------------------------
// createMockAccount — public.accounts row (AccountSchema)
// ---------------------------------------------------------------------------

export function createMockAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'bbbbbbbb-0000-4000-b000-000000000001',
    authUserId: 'aaaaaaaa-0000-4000-a000-000000000001',
    email: 'test@example.com',
    createdAt: '2026-05-14T12:00:00.000Z',
    lastSeenAt: '2026-05-14T12:00:00.000Z',
    consentMarketing: false,
    consentMarketingAt: null,
    consentAnalytics: false,
    consentAnalyticsAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// createMockActorSummary — ActorSummarySchema shape
// ---------------------------------------------------------------------------

export function createMockActorSummary(overrides: Partial<ActorSummary> = {}): ActorSummary {
  return {
    id: 'cccccccc-0000-4000-c000-000000000001',
    type: 'anonymous_web',
    externalId: 'anon-web-abc123',
    accountId: null,
    ...overrides,
  };
}
