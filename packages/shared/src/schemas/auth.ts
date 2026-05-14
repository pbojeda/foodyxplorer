// Zod schemas for F107a — Auth core (Supabase Auth, web).
//
// AccountSchema          — shape of public.accounts row
// ActorSummarySchema     — actor summary embedded in MeResponse
// MeResponseSchema       — GET /me response data payload
// LoginRequestSchema     — POST /auth/login request body
// LoginResponseSchema    — POST /auth/login response data (union: success | url)
//
// ADR-025 R3 §3 data model — accounts is identity/consent/billing.
// Body/health fields are explicitly NOT here — they belong to public.profiles (F099).

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Account — public.accounts row (ADR-025 R3 §3)
// ---------------------------------------------------------------------------

export const AccountSchema = z.object({
  id: z.string().uuid(),
  authUserId: z.string().uuid().describe('Logical reference to auth.users.id (Supabase-managed).'),
  email: z.string().email().max(255),
  createdAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  consentMarketing: z.boolean(),
  consentMarketingAt: z.string().datetime().nullable(),
  consentAnalytics: z.boolean(),
  consentAnalyticsAt: z.string().datetime().nullable(),
});

export type Account = z.infer<typeof AccountSchema>;

// ---------------------------------------------------------------------------
// ActorSummary — actor info embedded in MeResponse
// ---------------------------------------------------------------------------

export const ActorSummarySchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['anonymous_web', 'telegram', 'authenticated']),
  externalId: z.string().max(255),
  accountId: z.string().uuid().nullable().describe('NULL for actors not yet linked to an account.'),
});

export type ActorSummary = z.infer<typeof ActorSummarySchema>;

// ---------------------------------------------------------------------------
// MeResponseSchema — GET /me response data payload
// ---------------------------------------------------------------------------

export const MeResponseSchema = z.object({
  account: AccountSchema,
  actor: ActorSummarySchema,
});

export type MeResponse = z.infer<typeof MeResponseSchema>;

// ---------------------------------------------------------------------------
// LoginRequestSchema — POST /auth/login request body
// ---------------------------------------------------------------------------

export const LoginRequestSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('email'),
    email: z.string().email().max(255),
    redirectTo: z.string().url().max(2048),
  }),
  z.object({
    provider: z.literal('google'),
    redirectTo: z.string().url().max(2048),
  }),
]);

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

// ---------------------------------------------------------------------------
// LoginResponseSchema — POST /auth/login response data
//
// Email magic link: { success: true } (magic link sent to inbox)
// Google OAuth:     { url: string }   (redirect to Google consent screen)
// ---------------------------------------------------------------------------

export const LoginResponseSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('email'),
    success: z.literal(true),
  }),
  z.object({
    provider: z.literal('google'),
    url: z.string().url().describe('Supabase OAuth redirect URL for Google consent screen.'),
  }),
]);

export type LoginResponse = z.infer<typeof LoginResponseSchema>;
