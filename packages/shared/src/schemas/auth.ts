// Zod schemas for F107a — Auth core (Supabase Auth, web).
//
// AccountSchema          — shape of public.accounts row
// ActorSummarySchema     — actor summary embedded in MeResponse
// MeResponseSchema       — GET /me response data payload
// LoginRequestSchema     — POST /auth/login request body
// LoginResponseSchema    — POST /auth/login response data (union: success | url)
//
// F-WEB-TIER adds:
//   AccountTierSchema    — enum for account tier (free | pro | admin)
//   AccountSchema.tier   — OPTIONAL tier field on AccountSchema. The API always returns it
//                          post-migration, but it is optional on parse so consumers stay
//                          resilient to deploy skew (web auto-deploys on Vercel; api-dev is a
//                          MANUAL deploy → web can be live before api returns tier). Read as
//                          `account.tier ?? 'free'` on the client.
//   UsageBucketSchema    — single rate-limit bucket (used / limit / remaining)
//   UsageResponseSchema  — GET /me/usage response data payload
//
// ADR-025 R3 §3 data model — accounts is identity/consent/billing.
// Body/health fields are explicitly NOT here — they belong to public.profiles (F099).

import { z } from 'zod';

// ---------------------------------------------------------------------------
// AccountTier — F-WEB-TIER (accounts.tier enum column)
// ---------------------------------------------------------------------------

/**
 * Tier assigned to a registered account.
 * - `free`  — default for all registered accounts; 100 queries / 20 photos / 30 voice per day.
 * - `pro`   — reserved for future monetisation; 500 queries / 100 photos / 120 voice per day.
 * - `admin` — bypass all daily limits.
 * Provisioned in DB as enum `account_tier` (migration: F-WEB-TIER).
 * Cached server-side: Redis key `account:tier:<auth_user_id>`, TTL 60s
 * (request.accountId holds the Supabase JWT `sub` = `auth.users.id` = `accounts.auth_user_id`,
 * NOT the app `accounts.id`).
 */
export const AccountTierSchema = z.enum(['free', 'pro', 'admin']);
export type AccountTier = z.infer<typeof AccountTierSchema>;

// ---------------------------------------------------------------------------
// Account — public.accounts row (ADR-025 R3 §3, updated F-WEB-TIER)
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
  tier: AccountTierSchema.optional().describe(
    'Account tier — default free for all registered accounts (F-WEB-TIER). ' +
    'Determines daily rate limits: free=100q/20p/30v, pro=500q/100p/120v, admin=unlimited. ' +
    'Optional on parse for deploy-skew resilience; the API always returns it post-migration. ' +
    "Read as `account.tier ?? 'free'` on the client.",
  ),
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

// ---------------------------------------------------------------------------
// UsageBucketSchema / UsageResponseSchema — GET /me/usage response data
// (F-WEB-TIER usage meter)
//
// UsageBucketSchema — single daily-limit bucket (queries | photos | voice).
//   - `used`      = current Redis counter value; absent key → 0.
//   - `limit`     = DAILY_LIMITS_BY_TIER[tier][bucket]; null for admin (unbounded).
//   - `remaining` = max(0, limit − used); null for admin.
//
// UsageResponseSchema — full payload returned by GET /me/usage.
//   - `tier`    mirrors accounts.tier for the requesting actor.
//   - `resetAt` is UTC midnight of the next UTC day (ISO 8601 datetime string).
//   - `buckets` has exactly three fixed keys: queries, photos, voice.
// ---------------------------------------------------------------------------

export const UsageBucketSchema = z.object({
  used: z.number().int().nonnegative().describe(
    'Current Redis counter value for this bucket on the UTC day. Absent key → 0.',
  ),
  limit: z.number().int().nonnegative().nullable().describe(
    'Daily limit from DAILY_LIMITS_BY_TIER[tier][bucket]. Null for admin tier (unbounded).',
  ),
  remaining: z.number().int().nonnegative().nullable().describe(
    'max(0, limit − used). Null for admin tier (unbounded).',
  ),
});

export type UsageBucket = z.infer<typeof UsageBucketSchema>;

export const UsageResponseSchema = z.object({
  tier: AccountTierSchema.describe(
    'Account tier of the requesting actor — determines limit values per bucket.',
  ),
  resetAt: z.string().datetime().describe(
    'UTC midnight of the next UTC day — when all counters reset. Format: YYYY-MM-DDT00:00:00.000Z.',
  ),
  buckets: z.object({
    queries: UsageBucketSchema,
    photos: UsageBucketSchema,
    voice: UsageBucketSchema,
  }).describe('Usage counters keyed by bucket name. Fixed keys: queries, photos, voice.'),
});

export type UsageResponse = z.infer<typeof UsageResponseSchema>;
