// AC23 + AC25: verify @foodxplorer/shared exports all five auth schemas
// and that LoginRequestSchema discriminated union accepts both provider branches.

import {
  AccountSchema,
  ActorSummarySchema,
  MeResponseSchema,
  LoginRequestSchema,
  LoginResponseSchema,
} from '@foodxplorer/shared';
import { createMockAccount, createMockActorSummary } from '../fixtures.auth';

describe('Shared auth schemas (AC23)', () => {
  it('exports AccountSchema and it parses a valid account', () => {
    const result = AccountSchema.safeParse(createMockAccount());
    expect(result.success).toBe(true);
  });

  it('AccountSchema rejects missing required fields', () => {
    const result = AccountSchema.safeParse({ id: 'bad' });
    expect(result.success).toBe(false);
  });

  it('exports ActorSummarySchema and it parses a valid actor summary', () => {
    const result = ActorSummarySchema.safeParse(createMockActorSummary());
    expect(result.success).toBe(true);
  });

  it('exports MeResponseSchema and it parses valid account+actor', () => {
    const result = MeResponseSchema.safeParse({
      account: createMockAccount(),
      actor: createMockActorSummary(),
    });
    expect(result.success).toBe(true);
  });

  it('exports LoginResponseSchema and it parses email success response', () => {
    const result = LoginResponseSchema.safeParse({ provider: 'email', success: true });
    expect(result.success).toBe(true);
  });

  it('exports LoginResponseSchema and it parses google url response', () => {
    const result = LoginResponseSchema.safeParse({
      provider: 'google',
      url: 'https://accounts.google.com/o/oauth2/auth?foo=bar',
    });
    expect(result.success).toBe(true);
  });
});

describe('LoginRequestSchema discriminated union (AC25)', () => {
  it('parses provider:email with valid email + redirectTo', () => {
    const result = LoginRequestSchema.safeParse({
      provider: 'email',
      email: 'user@example.com',
      redirectTo: 'https://app.nutrixplorer.com/auth/callback',
    });
    expect(result.success).toBe(true);
  });

  it('parses provider:google with valid redirectTo (forward-compat)', () => {
    const result = LoginRequestSchema.safeParse({
      provider: 'google',
      redirectTo: 'https://app.nutrixplorer.com/auth/callback',
    });
    expect(result.success).toBe(true);
  });

  it('rejects email branch when email field is missing', () => {
    const result = LoginRequestSchema.safeParse({
      provider: 'email',
      redirectTo: 'https://app.nutrixplorer.com/auth/callback',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown provider', () => {
    const result = LoginRequestSchema.safeParse({
      provider: 'github',
      redirectTo: 'https://app.nutrixplorer.com/auth/callback',
    });
    expect(result.success).toBe(false);
  });
});
