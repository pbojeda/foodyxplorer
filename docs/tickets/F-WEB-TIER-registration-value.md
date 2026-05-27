# F-WEB-TIER: Registration value — account→`free` tier + actor↔account linking + login/register CTA

**Feature:** F-WEB-TIER (incl. F-WEB-AUTH-CTA) | **Type:** Fullstack-Feature | **Priority:** High
**Status:** Ready for Merge | **Branch:** feature/F-WEB-TIER-registration-value
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-05-25 | **Dependencies:** F107a (auth core, shipped), F107a-FU2 (anti-hijack predicate), BUG-PROD-013 (bearer actorId resolution — done)

---

## Spec

### Description

**Problem (user value):** After shipping Supabase Auth (F107a) + the BUG-PROD-013 bearer fix,
registering grants no tangible benefit. The web app's `/hablar` is open-to-all with tier-based
daily rate limits, but tier is resolved **only** from `request.apiKeyContext.tier`
(`actorRateLimit.ts` l.93) — a logged-in web user still falls through to the **`anonymous`**
tier (50 queries / 10 photos / 30 voice per day). The bearer-authenticated actor materialised
by BUG-PROD-013 is **never linked** to the account (`actors.account_id` stays NULL from web —
`actorResolver.ts` l.98 explicitly excludes linking). The `/hablar` header shows no
login/register entry point for logged-out users (`HablarShell.tsx` l.482: `{user && <UserMenu>}`).
The photo analysis proxy (`packages/web/src/app/api/analyze/route.ts`) sends only the shared
server `X-API-Key` + `X-Actor-Id` with no account identity, so photo rate limits are coupled
across all users (research §H3).

**Goal:** Make registration deliver real value end-to-end via five targeted changes:

1. **Tier by account:** An authenticated account resolves to the **`free`** tier
   (100 q / 20 photos / 30 voice per day) instead of `anonymous` (50 / 10 / 30).
   Mechanism: `actorRateLimit.ts` reads `request.accountId` — which holds the Supabase JWT
   `sub` (= `auth.users.id` = `accounts.auth_user_id`, **NOT** the app `accounts.id`) — and
   resolves the account tier via `resolveAccountTier(prisma, redis, sub)`: a Redis-cached
   `SELECT tier FROM accounts WHERE auth_user_id = :sub` (cache key `account:tier:<sub>`, TTL 60s).
   **Fail-open to `free` (NOT `anonymous`)** on tier-lookup cache miss + DB failure for a verified
   bearer; only requests without a valid bearer resolve to `anonymous`. Tier resolution lives in
   `actorRateLimit` (the per-route rate-limit hook) so only rate-limited routes pay the lookup
   cost; `actorResolver` stays responsible for identity resolution only (no new `request.accountTier`,
   no account writes). **Free-default:** for a verified bearer with NO `accounts` row yet (e.g. before
   `/me` has run), `resolveAccountTier` returns `'free'` (every registered user is at least free).
   _[cross-model F2/F3/F5: accountId=sub disambiguated; fail-open=free; tier read in actorRateLimit.]_

2. **Account provisioning + actor↔account linking via `GET /me` on session establish**
   (**Option A — owner decision 2026-05-26**): `AuthProvider` calls `GET /me` when a session is
   established (after login AND on session restore at page load). `/me` already upserts the
   `accounts` row (`ON CONFLICT (auth_user_id)`) and links the requesting actor using the
   F107a-FU2 anti-hijack safe predicate
   (`UPDATE actors SET account_id = <accounts.id> WHERE id = <actorId> AND (account_id IS NULL OR account_id = <accounts.id>)`,
   `me-<sub.slice(0,8)>` collision fallback + `actor_link_collision` Pino warn + Sentry). This is
   **reused F107a verbatim — NO change to the `actorResolver` write-path** (it stays as
   BUG-PROD-013 left it: resolves `actorId`, performs no account writes). Multi-device is covered
   because each device calls `/me` at its own session establish.
   **Why not resolver-side linking** (the originally-specced approach, dropped): `actors.account_id`
   is a FK to `accounts.id` (the app PK), and the `accounts` row is created ONLY by `/me`'s upsert.
   The web never called `/me`, so resolver-side linking would never find an `accounts.id` → it would
   be a silent no-op for exactly the web users we care about. Provisioning must run through `/me`.
   (Owner picked Option A over a gated resolver-side upsert; see Completion Log 2026-05-26.)
   No `linkActorToAccount` extraction is needed — `/me`'s existing inline linking (already covered by
   F107a-FU2 tests) is the single linking path; cross-model F4 (DRY across /me + resolver) is moot
   under Option A since the resolver no longer links.

3. **Photo proxy account identity (recommended: Option A — forward bearer):**
   `sendPhotoAnalysis` in `apiClient.ts` attaches the `Authorization: Bearer` header when an
   auth token is set, forwarding it to the Next proxy at `/api/analyze`. The proxy forwards
   the header unchanged to the Fastify upstream. The Fastify `actorResolver` then resolves
   `request.accountId` from the bearer for the `/analyze/menu` route, enabling the account
   tier to apply to photo analysis.

4. **Login/register CTA in `/hablar` header:** `HablarShell.tsx` header renders
   `<UserMenu>` when `user` is non-null (unchanged) and a new `<LoginCta>` button when
   `user` is null and `authLoading` is false. Clicking `<LoginCta>` navigates to `/login`.

5. **429 nudge for anonymous users:** When `apiClient.ts` receives a 429 with
   `code: 'RATE_LIMIT_EXCEEDED'`, `HablarShell` checks whether the user is logged out
   (`user === null`) and, if so, renders the rate-limit error message with an inline
   sign-up prompt ("Regístrate gratis para obtener el doble de consultas diarias").

6. **Funnel instrumentation extension:** `HablarShell.tsx` extends `trackEvent` calls with:
   - `login_cta_shown` — fired when `<LoginCta>` mounts for a logged-out user
   - `login_cta_clicked` — fired on CTA click
   - `rate_limit_nudge_shown` — fired when 429 nudge is shown to anonymous user
   - `rate_limit_nudge_clicked` — fired when nudge CTA is clicked
   - `query_sent` and `query_success` events gain an `authenticated: boolean` property
     (derived from `user !== null` at call time — no PII)
   - `usage_meter_shown` — fired when the usage meter mounts for a logged-in user

7. **Usage meter for logged-in users (`UsageMeter`):** When the user IS logged in, the `/hablar`
   header shows a compact **daily-usage meter** for the three buckets — **consultas (queries)**,
   **fotos (photos)**, **voz (voice)** — each as `used / limit` with remaining derived
   (e.g. "Consultas 12/100 · Fotos 3/20 · Voz 5/30"). This makes the user conscious of their
   usage AND surfaces the concrete value of having registered (free 100/20/30 vs anonymous
   50/10/30). The header is a clean dichotomy: **logged-out → `<LoginCta>`**; **logged-in →
   `<UsageMeter>` + `<UserMenu>`**.
   Data source: a new read-only `GET /me/usage` endpoint that reads the rate-limit counters
   (Redis `actor:limit:<actorId>:<YYYY-MM-DD>:<bucket>`, GET — no increment) + the tier limits.
   Refreshed on mount and after each successful query/photo/voice.

**Canonical research document:** `docs/research/post-auth-strategic-analysis-2026-05-25.md`
(this feature = P0b + F-WEB-AUTH-CTA merged; usage meter added at owner request 2026-05-26).

**Note on BUG-PROD-013 scope:** The hotfix explicitly excluded linking
(`actorResolver.ts` l.98: "Does NOT perform account linking — that remains /me only").
Resolver-side linking is this feature's job.

---

### API Changes

#### Tier resolution is internal

Tier resolution is internal to `actorRateLimit` (`resolveAccountTier`). The `/me` linking
behaviour is unchanged in contract; this feature adds the same linking resolver-side as a
parallel path (so the web works even without `/me` calls).

#### `GET /me/usage` — NEW read-only endpoint (usage meter)

Bearer-authenticated. Returns the current day's usage for the requesting actor across the three
daily-limit buckets, so the frontend can render the `UsageMeter`. **Read-only** — it reads the
rate-limit counters with Redis `GET` (NOT `INCR`) and is intentionally absent from
`ROUTE_BUCKET_MAP`, so calling it does not consume any quota.

- **Auth:** `Authorization: Bearer <jwt>` required → 401 if absent/invalid (same precedence as `/me`).
- **Resolution:** `request.actorId` (resolver bearer path) + tier via `resolveAccountTier(sub)`.
- **Reads:** for each bucket ∈ {queries, photos, voice}: `GET actor:limit:<actorId>:<today>:<bucket>`
  → `used` (absent key → 0); `limit = DAILY_LIMITS_BY_TIER[tier][bucket]`;
  `remaining = max(0, limit − used)`. `today = new Date().toISOString().slice(0,10)` (UTC, matches the hook).
- **Response shape** (`data`):
  ```json
  {
    "tier": "free",
    "resetAt": "2026-05-27T00:00:00.000Z",
    "buckets": {
      "queries": { "used": 12, "limit": 100, "remaining": 88 },
      "photos":  { "used": 3,  "limit": 20,  "remaining": 17 },
      "voice":   { "used": 5,  "limit": 30,  "remaining": 25 }
    }
  }
  ```
- **admin tier:** `limit` for each bucket is unbounded; represent as `limit: null, remaining: null`
  (the frontend renders "∞" / hides the meter for admin). `realtime_minutes` is NOT surfaced
  (F095 placeholder, 0 for free).
- **Anonymous:** the endpoint is logged-in-only; an anonymous (no-bearer) request gets 401.
  (The meter is never shown to anonymous users — they see `<LoginCta>` + the 429 nudge instead.)
- New Zod schema `UsageResponseSchema` in `shared/src/schemas/` (+ documented in `api-spec.yaml`).

#### `GET /me` — response extended with `tier`

`GET /me` response data gains a `tier` field on the `account` object so the frontend can
reflect the current account tier in `UserMenu` (e.g. show "Free" badge). This is optional
for the CTA feature but forward-compat for pro upsell.

**Updated `MeData.account` shape (additions only):**

```yaml
tier:
  type: string
  enum: [free, pro, admin]
  description: |
    Account tier. Defaults to `free` for all registered accounts.
    Populated from the `accounts.tier` DB column (F-WEB-TIER migration).
    Determines daily rate limits applied by actorRateLimit when request.accountId is set.
  example: "free"
```

The `Account` schema in `docs/specs/api-spec.yaml` and `shared/src/schemas/auth.ts` is updated
to include `tier`.

#### `POST /api/analyze` (Next.js proxy) — bearer forwarding

The Next.js proxy at `packages/web/src/app/api/analyze/route.ts` is updated to forward
the `Authorization` header from the browser request to the Fastify upstream (when present).
This is a contract change in the proxy, not in the Fastify `/analyze/menu` route itself.
The upstream already handles bearer via `actorResolver`.

**Contract addition to proxy:**
- If `Authorization` header is present in the incoming browser request, forward it unchanged.
- The Fastify upstream (`/analyze/menu`) resolves `request.accountId` via `actorResolver`
  (bearer path) and applies the account tier in `actorRateLimit`.
- Anonymous photo analysis (no bearer) is unchanged — proxy behaviour is additive.

#### Rate limit 429 response — unchanged

The `RATE_LIMIT_EXCEEDED` 429 response body from `actorRateLimit.ts` already includes
`details.tier`. No changes to the error contract. The frontend uses the existing `tier` field
in the 429 body to decide whether to show the anonymous nudge (tier === 'anonymous').

#### Internal contracts (not public API surface)

| Contract | Change |
|---|---|
| `resolveAccountTier(prisma, redis, sub)` (new helper) | Resolves tier from the bearer `sub` (= `auth_user_id`): Redis-cached `SELECT tier FROM accounts WHERE auth_user_id = :sub`. Called from `actorRateLimit` (NOT the resolver). No new `request.*` property. Fail-open `free` for a verified bearer. |
| Redis cache key for account tier | `account:tier:<sub>` (sub = auth_user_id) — TTL 60s, same pattern as `apikey:<hash>` in `auth.ts` l.156 |
| `actorRateLimit` tier resolution order | `request.apiKeyContext?.tier` (API key, unchanged) → else if `request.accountId` set (valid bearer) → `resolveAccountTier(...)` (fail-open `free`) → else `'anonymous'` |
| Account provisioning + actor linking (Option A) | Via `GET /me` called by `AuthProvider` on session establish. `/me`'s existing inline safe-link UPDATE + collision fallback (F107a-FU2) is unchanged. The `actorResolver` does NOT link (no account writes). No `linkActorToAccount` extraction. |
| `resolveAccountTier` no-account-row case | Verified bearer with no `accounts` row yet → return `'free'` (every registered user is ≥ free; the row appears once `/me` runs). |

---

### Data Model Changes

#### Migration: `accounts.tier` enum column (D1 — recommended)

Add an enum column `tier` to the `accounts` table with values `free | pro | admin`, defaulting
to `free`. This is the forward-compat D1 recommendation: all current accounts get `free`
automatically, and a future monetisation feature sets `tier = 'pro'` without re-migrating.

**Prisma schema change (`packages/api/prisma/schema.prisma`):**

1. Add a new Prisma enum `AccountTier` (parallel to `ApiKeyTier`):
   ```
   enum AccountTier {
     free
     pro
     admin
     @@map("account_tier")
   }
   ```

2. Add `tier` field to `model Account`:
   ```
   tier  AccountTier  @default(free)
   ```

3. Prisma `$queryRaw` INSERT in `auth.ts` (`/me` account upsert at l.223–237) must be updated
   to RETURNING the `tier` column so it can be included in the response.

**Migration SQL (applied via `prisma migrate deploy` — NOT `migrate dev`):**
```sql
CREATE TYPE account_tier AS ENUM ('free', 'pro', 'admin');
ALTER TABLE accounts ADD COLUMN tier account_tier NOT NULL DEFAULT 'free';
```

**No back-fill needed:** all existing rows get `free` via the DEFAULT clause.

**Note on `prisma migrate deploy`:** pgvector shadow DB incompatibility means the project
uses `prisma migrate deploy` (not `migrate dev`) for applying migrations. Generating the
migration SQL must be done with care (see `key_facts.md`).

#### Zod schema changes (`packages/shared/src/schemas/auth.ts`)

`AccountSchema` gains a `tier` field:
```ts
tier: z.enum(['free', 'pro', 'admin']).describe('Account tier — default free for all registered accounts.'),
```

`MeResponseSchema` is unchanged in structure (it embeds `AccountSchema`, which now includes `tier`).

No new tables. No changes to `actors`, `query_logs`, or other models.

---

### UI Changes

#### Component hierarchy changes (packages/web)

```
HablarShell (Client)
├── <header>
│   ├── <span> nutriXplorer logo (unchanged)
│   ├── LoginCta (Client, NEW)   — rendered when user===null && !authLoading
│   ├── UsageMeter (Client, NEW) — rendered when user!==null && !authLoading (logged-in only)
│   └── UserMenu (Client, existing) — rendered when user!==null (unchanged)
├── ResultsArea (existing)
│   └── [RateLimitNudge inline within error state — see below]
└── ConversationInput (existing)
```

#### LoginCta (NEW component)

**Type:** Feature | **Client:** Yes (`'use client'`)

**Props:**
| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| (none) | — | — | — | Stateless; reads no props |

**Behaviour:**
- Renders a compact "Iniciar sesión" button in the header, `ml-auto` positioned (same slot as `UserMenu`).
- On mount: fires `trackEvent('login_cta_shown')` (once per render — no duplicate guard needed,
  HablarShell only mounts once per session).
- On click: fires `trackEvent('login_cta_clicked')`, then `router.push('/login')`.
- **Does not render** while `authLoading === true` (avoids flash during session resolution).

**Accessibility:**
- `<button type="button" aria-label="Iniciar sesión o registrarse">` with brand styling
  consistent with `UserMenu` avatar button (same height 32px, same focus ring).

**Loading/Error/Empty States:**
- While `authLoading`: renders nothing (avoid layout shift — the header slot is empty until
  auth resolves, same behaviour as `UserMenu` which also returns null for null user).

#### UsageMeter (NEW component) — logged-in only

**Type:** Feature | **Client:** Yes (`'use client'`) — _visual treatment + placement defined by `ui-ux-designer`._

**Props:**
| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| (none) | — | — | — | Self-contained; fetches `GET /me/usage` via `apiClient` using the auth token from context |

**Behaviour:**
- Rendered only when `user !== null && !authLoading` (logged-in). Never shown to anonymous users.
- On mount: fetches `GET /me/usage` → renders three buckets (consultas/fotos/voz) as `used / limit`
  with remaining derived. Compact inline form in the header; a popover/expanded form MAY show
  remaining + resetAt (final visual per `ui-ux-designer`, W9–W14).
- **`resetAt` is rendered as "mañana" (no time)** — owner decision 2026-05-26 (avoids exposing the
  UTC-midnight vs Spain-local-time offset). Do NOT render the raw UTC timestamp or a local time.
- **Live refresh:** re-fetches `GET /me/usage` after each successful query / photo / voice
  (HablarShell triggers a refresh callback on `query_success` / `photo_success` / voice success),
  OR decrements optimistically then reconciles — mechanism finalized in the Plan. Counters are
  already incremented server-side by the time the success response returns, so a re-fetch is accurate.
- On mount: fires `trackEvent('usage_meter_shown')`.
- **admin tier:** buckets return `limit: null` → render "∞" or hide the meter (no quota pressure).

**Accessibility:**
- `role="status"` / `aria-label` summarizing usage (e.g. "Uso diario: 12 de 100 consultas, …")
  so screen readers can announce remaining quota. Numeric values not conveyed by colour alone.

**Loading/Error/Empty States:**
- While the `GET /me/usage` request is in flight on first mount: render a compact skeleton/placeholder
  (no layout shift).
- **Error / Redis-unavailable** (usage endpoint returns degraded/empty): render nothing or a muted
  "—" — the meter must NEVER block or error the page. Failing to load usage is non-fatal.

#### HablarShell changes

1. **Header:** replace `{user && <UserMenu user={user} />}` with:
   ```
   {!authLoading && !user && <LoginCta />}
   {!authLoading && user  && <><UsageMeter /><UserMenu user={user} /></>}
   ```
   (`authLoading` guard prevents the CTA/meter flashing before session resolves. Exact placement
   + visual treatment of `<LoginCta>` and `<UsageMeter>` to be defined by `ui-ux-designer`.)

2. **Rate-limit error (429) handling in `executeQuery`:** when `err.code === 'RATE_LIMIT_EXCEEDED'`
   and `user === null`, set a new state flag `showRateLimitNudge: true` instead of (or in
   addition to) the plain error string. Clear it on any new query attempt.

3. **`query_sent` and `query_success` telemetry:** add `authenticated: !!user` to both event
   payloads (no PII — boolean only). Same for `photo_sent` / `photo_success`.

4. **Rate-limit error message update (dynamic):** the hardcoded string at l.275
   `'Has alcanzado el límite diario de 50 consultas. Vuelve mañana.'` must be made **dynamic**
   from the `details` already present in the 429 `RATE_LIMIT_EXCEEDED` body (`actorRateLimit.ts`
   l.123–137 carries `details.tier` + `details.limit`): e.g.
   ``Has alcanzado el límite diario de ${details.limit} consultas. Vuelve mañana.`` — no
   hardcoded count, accurate for any tier (anonymous 50 / free 100).
   _[cross-model F6: use the limit/tier already in the 429 body.]_

#### RateLimitNudge (NEW — inline within ResultsArea or ErrorState)

**Type:** Primitive | **Client:** Yes (`'use client'`)

**Props:**
| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| onSignUpClick | `() => void` | Yes | — | Callback fired when CTA button is clicked |

**Behaviour:**
- Rendered by `HablarShell` below the rate-limit error message when `showRateLimitNudge === true`
  and `user === null`.
- Copy (Spanish): "Regístrate gratis y obtén el doble de consultas diarias (100 en lugar de 50)."
- CTA button: "Crear cuenta gratis" → `onSignUpClick` fires `trackEvent('rate_limit_nudge_clicked')`
  then `router.push('/login')`.
- On mount: fires `trackEvent('rate_limit_nudge_shown')`.
- Does **not** replace the existing error message — appears below it as an upgrade prompt.

**Accessibility:**
- CTA button: `<button type="button">` with `focus:ring` (consistent with existing button styles).
- The nudge region: `role="status"` so screen readers announce it when it appears.

#### apiClient.ts changes

- `sendPhotoAnalysis` attaches the `Authorization: Bearer <token>` header when `authToken` is
  non-null (mirroring the existing pattern in `sendMessage` — `apiClient.ts` l.118 area).
- New `getUsage()` method: `GET /me/usage` with the bearer token attached; returns the parsed
  `UsageResponse` (validated against `UsageResponseSchema`). Used by `<UsageMeter>`.

#### Next.js photo proxy changes (`packages/web/src/app/api/analyze/route.ts`)

Forward `Authorization` header from browser request when present:
```
const authorization = request.headers.get('Authorization');
if (authorization) {
  mergedHeaders.set('Authorization', authorization);
}
```
Anonymous requests (no `Authorization`) are unchanged.

---

### Edge Cases & Error Handling

#### E1 — Anti-hijack invariant (F107a-FU2) — preserved, unchanged (Option A)

Linking happens in `GET /me` (called by `AuthProvider` on session establish), using `/me`'s
**existing, already-tested** safe-link UPDATE + collision fallback (`auth.ts` l.255–343:
`WHERE id = ? AND (account_id IS NULL OR account_id = ?)`, `provisionFallbackActor` on collision,
`actor_link_collision` Pino warn + Sentry warning). This feature does **NOT** add a new linking
path and does **NOT** touch the `actorResolver` write surface — so the anti-hijack surface is
**unchanged** from F107a-FU2 (no new risk introduced here). The only `/me` change is adding `tier`
to the response (additive). Regression coverage = the existing F107a-FU2 linking tests must stay
green after the `tier` addition.

#### E2 — Strict bearer precedence (ADR-025 R3 §5)

`verifyBearerJwt` (`actorResolver.ts` l.90) is intentionally outside the resolver try/catch; the
resolver only resolves `actorId` (no linking, no account writes — unchanged from BUG-PROD-013).
Tier resolution happens in `actorRateLimit`. This ensures: invalid bearer → 401 throw (unchanged);
tier-lookup failure (or no `accounts` row) for a valid bearer → **`free`** (NEVER a silent
`anonymous` downgrade for a verified bearer). `/me`'s linking precedence is unchanged from F107a.

#### E3 — Resilience

The `actorResolver` is unchanged (BUG-PROD-013 try/catch around `resolveBearerActorId` still the
only DB work there). `/me` linking failures are handled within the `/me` route as today (F107a) —
and `/me` is now called by `AuthProvider`, which must treat a `/me` failure as non-fatal (the app
still works; tier falls back to `free`, the meter shows "—"). Tier resolution failures degrade per
E4. No route may 500 because provisioning/linking/tier failed.

#### E4 — Tier cache miss / Redis failure

`resolveAccountTier(prisma, redis, sub)` runs inside `actorRateLimit` and follows the `auth.ts`
API-key cache pattern:
- Cache hit → return cached tier (TTL 60s).
- Cache miss → DB lookup (`SELECT tier FROM accounts WHERE auth_user_id = :sub`) → cache → return.
- **No account row** (verified bearer that hasn't been provisioned by `/me` yet) → return `'free'`
  (cache it too). Every registered user is ≥ free; the row appears once `/me` runs.
- DB failure for a **verified bearer** → return `'free'` (fail-open — parallel to API-key
  fail-open in `actorRateLimit.ts` l.154–158 for `hasApiKey`). NEVER downgrade a verified bearer
  to `anonymous`.
- Redis failure on cache read → proceed to DB.

**Cache key:** `account:tier:<sub>` (sub = auth_user_id). TTL: 60s (matches API-key cache).

#### E5 — Multi-device: non-unique `actors.account_id`

`actors.account_id` is a non-unique FK (`schema.prisma` l.470). Linking device A's actor
does not affect device B's actor (separate rows). The safe predicate is per-actor-id.
No uniqueness conflict.

#### E6 — Photo analysis: anonymous users unaffected

The `/api/analyze` proxy change is additive — it forwards `Authorization` only when present.
Anonymous users (no session) send no `Authorization` header; the proxy behaviour is unchanged.
The Fastify `actorResolver` anonymous path is unchanged. Anonymous photo limit (10/day) applies.

#### E7 — Photo analysis: bearer forwarded through Next.js server

The Next.js Route Handler is a server-side function — the `Authorization` header forwarded
from browser to proxy to Fastify never touches the client bundle. `API_KEY` remains
server-only (`process.env['API_KEY']`, NOT `NEXT_PUBLIC_`). The bearer is the user's own
Supabase JWT (same token already used for `/conversation/message`) — no new secrets.

#### E8 — `authLoading` race in HablarShell

`HablarShell.tsx` already guards `executePhotoAnalysis` and `handleSubmit` on `authLoading`
(l.298, l.462). The `<LoginCta>` must also be suppressed while `authLoading` to avoid the
sign-in CTA flashing for a logged-in user whose session is still resolving.

#### E9 — Rate-limit nudge for free-tier users

The nudge MUST only show for `user === null` (anonymous). A logged-in `free` user who hits
their 100-query limit gets the plain rate-limit error without the register CTA (they are
already registered). Check: `user === null` at the time the 429 is received.

#### E10 — Tier column backward compatibility + deploy-skew resilience

`GET /me` now includes `tier` in the `account` object (additive on the wire — existing clients
that ignore `tier` are unaffected). The shared Zod `AccountSchema.tier` is **`.optional()`**
(NOT required) — deliberately. The API always returns `tier` post-migration, but making it
optional on parse keeps consumers resilient to **deploy skew**: web auto-deploys on Vercel while
`api-dev` is a MANUAL deploy (autoDeploy OFF), so a window exists where new web parses a `/me`
response from an old api with no `tier` — a required field would make that parse throw.
Consumers read `account.tier ?? 'free'`. This also keeps existing typed fixtures + schema tests
that omit `tier` compiling — no fixture churn.
_[cross-model F1: Gemini CRITICAL + Codex IMPORTANT — original "additive, required, won't break"
claim was false; resolved by `.optional()`.]_

#### E11 — `accounts.tier` column default for existing rows

The migration adds `tier account_tier NOT NULL DEFAULT 'free'`. All existing `accounts` rows
get `free` via the DEFAULT clause — no back-fill script needed. New rows from `/me` upsert
get `free` by default (Prisma default + DB default both set to `free`).

#### E12 — Usage endpoint is read-only (no quota consumption)

`GET /me/usage` MUST NOT be added to `ROUTE_BUCKET_MAP` and MUST read counters with Redis `GET`
(never `INCR`). Calling the meter endpoint cannot consume the user's own quota. Verified by AC27.

#### E13 — Usage meter is per-actor (multi-device)

Rate-limit counters are keyed by `actorId`, and limits are enforced per-actor (not per-account).
The meter therefore reflects **this device's actor** usage. A user logged in on two devices sees
each device's own counters. This is consistent with how the limit is actually enforced — the
meter must not imply an account-wide aggregate it can't deliver. (If account-wide aggregation is
ever wanted, that's a separate feature; out of scope here.)

#### E14 — Usage read: Redis failure degrades gracefully

If the Redis `GET` for a counter fails, `GET /me/usage` returns `used: 0` (or omits the bucket)
rather than erroring — and the `<UsageMeter>` renders nothing / a muted "—". Failing to load
usage is **non-fatal**: it must never 500 the endpoint nor block `/hablar`. The core query path
is independent of the meter.

#### E15 — Meter never shown to anonymous

`GET /me/usage` is bearer-only (401 for anonymous). The frontend only calls it when `user !== null`,
so an anonymous user never triggers it; they see `<LoginCta>` + the 429 nudge instead.

#### E16 — Usage is per-actor via `X-Actor-Id` (accepted model behaviour; future hardening)

`GET /me/usage` reads counters for the actor resolved from `X-Actor-Id` (or the bearer fallback),
NOT scoped by `account_id`. A caller with a valid `bearer_A` + a forged `X-Actor-Id=B` could read
**actor B's daily usage counts** (the *tier* still comes from A). Impact is LOW — it leaks daily
*counts*, not content or PII, and requires knowing a victim's actor UUID. This is **pre-existing
model behaviour**, not a F-WEB-TIER regression: the entire actor model trusts `X-Actor-Id` per
ADR-016 (anonymous identity), and `/conversation/*` has the identical property. Accepted for MVP.
**Future hardening (post-beta):** scope `/me/usage` (and the conversation counters) by `account_id`
once linking is universal — resolve the account's canonical actor server-side instead of trusting
`X-Actor-Id`. (External-audit NIT-1, 2026-05-26.)

---

### Open design forks (for owner decision at Spec checkpoint)

#### D1 — `accounts.tier` column vs hardcode `free`

**Recommendation: add the column** (implemented above).

Rationale: Hardcoding "account → free" in `actorRateLimit` avoids a migration but means a
future `pro` tier requires both code change + migration anyway. Adding the column now costs
one trivial migration and zero runtime overhead (cached lookup). It also means `/me` can
surface `tier` to the frontend for pro upsell UI without a second migration. The column is
inert until monetisation ships. The `ApiKeyTier` enum already has `free | pro | admin`
(`schema.prisma` l.86–91) — `AccountTier` mirrors it.

**Override if:** owner wants zero DB changes for this sprint (then hardcode `'free'` in
`resolveAccountTier`, skip migration, and accept re-migration when pro ships).

---

#### D2 — Linking strategy: resolver-side vs frontend `/me` call

**Recommendation: resolver-side** (implemented above).

Rationale: The research confirmed the web frontend never calls `/me` (`post-auth-strategic-analysis-2026-05-25.md` §H0 + §C Dato clave). Making the frontend call `/me` on session establish would require changes to `AuthProvider` or `HablarShell`, introduce a network round-trip before the first query, and create a race condition if the user queries before `/me` completes. Resolver-side linking is a single DB write per actor (short-circuited by `(account_id IS NULL OR account_id = ?)` once linked) and is already within the existing try/catch.

**Risk:** re-touches the F107a-FU2 anti-hijack surface. Mitigated by exact predicate reuse
and cross-model review requirement (E1 above).

**Override if:** owner prefers keeping linking strictly in `/me` and is comfortable with the
invariant that the frontend must call `/me` at session establish.

---

#### D3 — Tier-lookup cache: Redis vs no-cache

**Recommendation: Redis cache** with TTL 60s (implemented above).

Rationale: Without caching, every bearer-authenticated request to `/conversation/message`,
`/conversation/audio`, or `/analyze/menu` does a DB read for account tier on top of the
existing actor resolution DB read. The API-key auth plugin (`auth.ts` l.107–156) already
caches key lookup with the same TTL. The account tier is stable (changes only on pro upgrade)
so 60s stale data is acceptable. Cache key `account:tier:<sub>` (sub = auth_user_id) is distinct
from the API-key cache key `apikey:<hash>`.

**Override if:** owner wants simplest implementation and accepts the extra DB read per request
(pre-beta traffic is very low, so the overhead is negligible).

---

#### D4 — Photo proxy identity: Option A (forward bearer) vs Option B (proxy resolves account)

**Recommendation: Option A — forward the user bearer from browser through Next proxy to Fastify.**

**Option A (recommended):**
- `apiClient.ts` attaches `Authorization: Bearer <token>` to `POST /api/analyze` (browser → proxy).
- Next proxy forwards the header to Fastify upstream (proxy → Fastify).
- Fastify `actorResolver` resolves `accountId` from bearer, applies account tier.
- **Trust boundary:** Fastify verifies the JWT signature independently (JWKS). The proxy cannot
  forge account identity. The `API_KEY` (shared server secret) and the bearer (user JWT) are
  separate — one does not elevate the other.
- **Risk:** bearer token is present in the Next.js Route Handler server logs (mitigated by
  log filtering, same exposure as any API route that logs request headers).

**Option B (not recommended):**
- Next proxy resolves `accountId` server-side via Supabase session cookies, then passes a
  trusted `X-Account-Id: <id>` header alongside `X-API-Key` to Fastify.
- Fastify `actorRateLimit` reads `X-Account-Id` (trusted because it arrived with the shared
  `X-API-Key`).
- **Problem:** creates a second trusted identity transport. The `X-API-Key` + `X-Account-Id`
  pair is trusted only because the Next server sends it — any server-to-server path could
  impersonate accounts by spoofing `X-Account-Id` if the key is ever leaked. ADR-025 R3 §5
  specifies bearer as the authoritative identity channel. Option B introduces a parallel
  channel outside that model.

**Override if:** owner wants to avoid bearer token in the photo request for any reason.
Option B is still safe (the Next server is trusted) but architecturally messier.

---

### Migration note

One migration is required: add `account_tier` enum type + `accounts.tier` column (only if D1
is approved). Applied via `prisma migrate deploy` (NOT `prisma migrate dev` — pgvector shadow
DB issue, see `key_facts.md`). The migration SQL is trivial and backward-safe (DEFAULT 'free',
NOT NULL). Rollback: `ALTER TABLE accounts DROP COLUMN tier; DROP TYPE account_tier;`.

---

## Implementation Plan

### Backend Plan

**Option A — owner decision 2026-05-26.** The `actorResolver` is UNCHANGED. Account provisioning + actor linking happen via `GET /me` called by `AuthProvider` on session establish, reusing the existing F107a-FU2 inline safe-link + collision fallback verbatim. No `linkActorToAccount` extraction. No resolver-side writes.

---

#### Existing Code to Reuse

| Symbol | File | Notes |
|---|---|---|
| `provisionFallbackActor(prisma, sub)` | `packages/api/src/lib/bearerActor.ts:40` | Unchanged; stays as-is |
| `resolveBearerActorId(prisma, payload, request)` | `packages/api/src/lib/bearerActor.ts:70` | Unchanged |
| `UUID_RE` | `packages/api/src/lib/bearerActor.ts:23` | Unchanged |
| `captureMessage`, `hashActor` | `packages/api/src/lib/sentry.ts` | Unchanged (referenced by existing `/me` linking code, not touched) |
| `DAILY_LIMITS_BY_TIER`, `ROUTE_BUCKET_MAP` | `packages/api/src/plugins/actorRateLimit.ts:38,46` | Both already exported; reused by `GET /me/usage` route |
| `computeResetAt` | `packages/api/src/plugins/actorRateLimit.ts:59` | Currently **unexported** — must be changed to `export function` |
| `verifyBearerJwt` | `packages/api/src/plugins/authBearer.ts` | Already used by `/me`; also used by `/me/usage` route |
| `resolveJwksUrl` | `packages/api/src/routes/auth.ts:402` | Private helper; `/me/usage` calls it (same file — no extraction needed) |
| `/me` inline safe-link UPDATE + collision fallback | `packages/api/src/routes/auth.ts:255–343` | REUSED VERBATIM — NOT extracted, NOT modified (Option A: zero change to linking logic) |
| `AccountTierSchema`, `UsageBucketSchema`, `UsageResponseSchema` | `packages/shared/src/schemas/auth.ts:38,142,156` | Already written by spec-creator; import from `@foodxplorer/shared` |
| `AccountSchema` (with `.optional()` `tier`) | `packages/shared/src/schemas/auth.ts:45,55` | Already written; no changes needed |

---

#### Files to Create

| File | Purpose |
|---|---|
| `packages/api/prisma/migrations/20260526130000_add_account_tier/migration.sql` | Hand-authored SQL: `CREATE TYPE account_tier AS ENUM (...)` + `ALTER TABLE accounts ADD COLUMN tier ...` (applied via `prisma migrate deploy`) |
| `packages/api/src/lib/accountTier.ts` | New lib module: exports `resolveAccountTier(redis, prisma, sub, logger)` — Redis-cached `SELECT tier FROM accounts WHERE auth_user_id = :sub`; fail-open `'free'` on no-row or DB error |
| `packages/api/src/__tests__/f-web-tier/fWebTier.resolveAccountTier.unit.test.ts` | Unit tests for `resolveAccountTier` (AC1, AC4, AC5) — mocked Redis + Prisma |
| `packages/api/src/__tests__/f-web-tier/fWebTier.actorRateLimit.tier.unit.test.ts` | Unit tests for tier resolution order in `actorRateLimit` (AC1, AC2, AC3) — mocked `resolveAccountTier` |
| `packages/api/src/__tests__/f-web-tier/fWebTier.usageEndpoint.integration.test.ts` | Integration tests for `GET /me/usage` against real DB + Redis (AC26, AC27, AC28, AC29) |

---

#### Files to Modify

| File | What changes |
|---|---|
| `packages/api/prisma/schema.prisma` | Add `enum AccountTier { free pro admin @@map("account_tier") }` block (after `ApiKeyTier` at l.85–91); add `tier AccountTier @default(free)` to `model Account` (after `consentAnalyticsAt` at l.491) |
| `packages/api/src/plugins/actorRateLimit.ts` | (a) Export `computeResetAt` (`function` → `export function` at l.59); (b) add `prisma: PrismaClient` to `RegisterActorRateLimitOptions` (l.74–76); (c) import `resolveAccountTier` from `lib/accountTier.js`; (d) replace single-line tier resolution at l.93 with three-way: API-key → bearer `accountId` → `'anonymous'`; (e) extend fail-open catch at l.154–170 to include `hasBearerAuth = !!request.accountId` |
| `packages/api/src/routes/auth.ts` | (a) Update `RawAccountRow` interface to add `tier: string` (l.26–36); (b) add `tier::text` to `$queryRaw` RETURNING clause (l.227–237); (c) add `tier: rawAccount.tier` to `accountForResponse` (l.368–378); (d) add `redis: Redis` to `AuthRoutesOptions` (l.42–45); (e) add `GET /me/usage` route handler (new route, bearer-only, reads Redis counters with `GET`, returns `UsageResponseSchema` shape); (f) import `resolveAccountTier` from `lib/accountTier.js`, `computeResetAt` + `DAILY_LIMITS_BY_TIER` from `plugins/actorRateLimit.js` |
| `packages/api/src/app.ts` | (a) Pass `prisma: prismaClient` to `registerActorRateLimit` (l.127); (b) pass `redis: redisClient` to `app.register(authRoutes, ...)` (l.156) |
| `packages/shared/src/__tests__/f107a.authSchemas.test.ts` | Extend with new `describe` blocks: `AccountSchema` with `tier` (AC16 — parses with/without `tier`, rejects invalid); `UsageBucketSchema`; `UsageResponseSchema` (free + admin payloads) |

Note: `packages/api/src/plugins/actorResolver.ts` is **NOT modified** (Option A invariant).

---

#### Implementation Order

Schema-first TDD: shared types → DB → new lib helper → middleware → routes.

**Step 1 — Zod schema tests (RED first, expect immediate GREEN)**

File: `packages/shared/src/__tests__/f107a.authSchemas.test.ts`

Extend the existing test file. The schemas were already written by the spec-creator so these tests should go GREEN as soon as written. Add new imports (`AccountTierSchema`, `UsageBucketSchema`, `UsageResponseSchema`) and three new `describe` blocks:

`AccountSchema` with `tier` tests (AC16):
- Parses payload with `tier: 'free'` → `result.data.tier === 'free'`
- Parses payload without `tier` → success, `result.data.tier === undefined` (`.optional()` — E10 deploy-skew resilience)
- Rejects `tier: 'superuser'` → `result.success === false`

`UsageBucketSchema` tests:
- Parses `{ used: 12, limit: 100, remaining: 88 }` → success
- Parses admin bucket `{ used: 0, limit: null, remaining: null }` → success (nullable fields)
- Rejects `used: -1` (nonnegative constraint)

`UsageResponseSchema` tests (AC29):
- Parses full free-tier response (all buckets present, `tier: 'free'`, ISO `resetAt`)
- Parses admin-tier response (all `limit/remaining: null`)
- Rejects response missing `buckets.voice`

**Step 2 — Migration (DB layer)**

Files: `packages/api/prisma/schema.prisma`, new migration SQL file.

2a. In `schema.prisma`, add after the `ApiKeyTier` enum block (l.85–91):
```
enum AccountTier {
  free
  pro
  admin
  @@map("account_tier")
}
```

2b. In `model Account` (l.482–497), add after `consentAnalyticsAt`:
```
tier  AccountTier  @default(free)
```

2c. Create `packages/api/prisma/migrations/20260526130000_add_account_tier/migration.sql`:
```sql
-- Migration: Add account_tier enum + accounts.tier column (F-WEB-TIER, D1)
--
-- All existing accounts get 'free' via NOT NULL DEFAULT 'free'.
-- No back-fill needed.
-- Rollback: ALTER TABLE accounts DROP COLUMN tier; DROP TYPE account_tier;

CREATE TYPE account_tier AS ENUM ('free', 'pro', 'admin');
ALTER TABLE accounts ADD COLUMN tier account_tier NOT NULL DEFAULT 'free';
```

2d. Apply: `prisma migrate deploy` (NEVER `migrate dev` — pgvector shadow DB issue, per `key_facts.md`). Run `prisma generate` after to regenerate the client.

TDD gate: migration is a pre-requisite for AC14 (operator smoke) and the AC15/AC26 integration tests. Apply to the test DB first.

**Step 3 — `resolveAccountTier` helper (TDD)**

File: `packages/api/src/lib/accountTier.ts`

Write tests in `fWebTier.resolveAccountTier.unit.test.ts` first (RED).

Test scenarios:
- **AC4 cache hit:** `redis.get` returns `'free'` → function returns `'free'`; `prisma.$queryRaw` NOT called.
- **AC4/AC5 cache miss, DB hit:** `redis.get` returns `null`; `prisma.$queryRaw` returns `[{ tier: 'pro' }]` → returns `'pro'`; `redis.set` called with key `account:tier:<sub>`, value `'pro'`, TTL `60`.
- **AC5 cache miss, no row:** `redis.get` null; `prisma.$queryRaw` returns `[]` → returns `'free'` (E4: no-account-row case).
- **AC5 DB throws:** `prisma.$queryRaw` throws → returns `'free'` (fail-open, NOT `'anonymous'`).
- **Redis GET throws → fallback to DB:** `redis.get` throws; `prisma.$queryRaw` returns `[{ tier: 'free' }]` → returns `'free'`.
- **Redis GET throws + DB throws:** both fail → returns `'free'`.

Implement `resolveAccountTier` in `packages/api/src/lib/accountTier.ts`:

```typescript
export async function resolveAccountTier(
  redis: Redis,
  prisma: PrismaClient,
  sub: string,
  logger: FastifyBaseLogger,
): Promise<'free' | 'pro' | 'admin'>
```

Logic:
1. `const cacheKey = \`account:tier:${sub}\`` (raw namespace, NOT `fxp:` prefix — separate concern from API-key cache).
2. Try `redis.get(cacheKey)` — catch errors, fall through to DB on Redis failure.
3. Cache hit: return the cached value cast to tier type.
4. Cache miss: `const rows = await prisma.$queryRaw<{ tier: string }[]>\`SELECT tier FROM accounts WHERE auth_user_id = ${sub}::uuid\`` — catch errors → return `'free'` on DB failure.
5. `rows.length === 0` → return `'free'` (E4: verified bearer not yet provisioned by `/me`).
6. Fire-and-forget `redis.set(cacheKey, rows[0].tier, 'EX', 60).catch(() => {})` (do not await).
7. Return `rows[0].tier` cast to `'free' | 'pro' | 'admin'`.

**Step 4 — Wire tier into `actorRateLimit` (TDD)**

File: `packages/api/src/plugins/actorRateLimit.ts`

Write unit tests in `fWebTier.actorRateLimit.tier.unit.test.ts` first (RED). These tests import the plugin and mock `resolveAccountTier` from `lib/accountTier.js` plus mock `redis.incr`.

Test scenarios:
- **AC1:** No API key, `request.accountId = 'some-uuid'`, `resolveAccountTier` resolves `'free'` → `DAILY_LIMITS_BY_TIER.free.queries = 100` applied.
- **AC2:** No API key, no `request.accountId` → tier `'anonymous'` → limit 50 queries.
- **AC2 regression:** `request.apiKeyContext = { tier: 'pro' }` → tier `'pro'` → `resolveAccountTier` NOT called.
- **AC3:** Assert `DAILY_LIMITS_BY_TIER.free = { queries: 100, photos: 20, voice: 30, realtime_minutes: 0 }` (already in the constant — regression guard).
- **Bearer Redis incr fail-open:** `request.accountId` set, `redis.incr` throws → request continues (fail-open, not 429).
- **Anonymous Redis incr fail-closed:** no `accountId`, `redis.incr` throws → 429 returned.

Modifications to `actorRateLimit.ts`:

4a. Add `import type { PrismaClient } from '@prisma/client';` and `import { resolveAccountTier } from '../lib/accountTier.js';`.

4b. Extend `RegisterActorRateLimitOptions` to add `prisma: PrismaClient`.

4c. Update `registerActorRateLimit` signature to destructure `{ redis, prisma }`.

4d. Change `computeResetAt` from `function` to `export function` (l.59).

4e. Replace the tier resolution at l.93:
```typescript
// Before:
const tier: Tier = (request.apiKeyContext?.tier as Tier) ?? 'anonymous';
const hasApiKey = request.apiKeyContext !== undefined;

// After:
const hasApiKey = request.apiKeyContext !== undefined;
const hasBearerAuth = !!request.accountId;
let tier: Tier;
if (hasApiKey) {
  tier = request.apiKeyContext!.tier as Tier;
} else if (hasBearerAuth) {
  tier = await resolveAccountTier(redis, prisma, request.accountId!, request.log);
} else {
  tier = 'anonymous';
}
```

4f. In the Redis incr `catch` block (l.154–170), extend the fail-open condition:
```typescript
// Before:
if (hasApiKey) { return; }
// After:
if (hasApiKey || hasBearerAuth) { return; }
```

**Step 5 — `GET /me` returns `tier` (TDD)**

File: `packages/api/src/routes/auth.ts`

Write test (extend `packages/api/src/__tests__/f107a/f107a.authRoutes.integration.test.ts`) first (RED):
- **AC15:** `GET /me` with valid bearer → `response.data.account.tier === 'free'` (requires migration applied on test DB).
- **AC6/AC7/AC8 regression:** all existing linking tests in `f107a.authRoutes.integration.test.ts` and `f107aFU2.collision.integration.test.ts` remain GREEN (the inline linking code is UNCHANGED — only `tier` is added to the response).

Then implement:

5a. Add `tier: string` to `RawAccountRow` interface (l.26–36).

5b. Add `tier::text` to the `$queryRaw` RETURNING clause (l.227–237):
```sql
RETURNING
  id::text,
  auth_user_id::text AS "authUserId",
  email,
  created_at AS "createdAt",
  last_seen_at AS "lastSeenAt",
  consent_marketing AS "consentMarketing",
  consent_marketing_at AS "consentMarketingAt",
  consent_analytics AS "consentAnalytics",
  consent_analytics_at AS "consentAnalyticsAt",
  tier::text
```

5c. Add `tier: rawAccount.tier` to `accountForResponse` (l.368–378). The `accountForResponse.tier` field value is the DB-returned string (`'free'` | `'pro'` | `'admin'`); `AccountSchema.tier` is `.optional()` so the parse remains resilient to pre-migration API responses.

5d. Update `AuthRoutesOptions` (l.42–45) to add `redis: Redis`.

5e. Update plugin destructuring: `async (app, { prisma, config, redis }) => {`.

5f. **The inline safe-link UPDATE block (l.255–343) is NOT changed.** Zero modification to linking logic. This is the core of Option A.

**Step 6 — `GET /me/usage` route (TDD)**

File: `packages/api/src/routes/auth.ts`

Write integration tests in `fWebTier.usageEndpoint.integration.test.ts` first (RED). Fixture UUID prefix: `f7f00000-` (confirmed unused).

Test setup: `vi.mock('@supabase/supabase-js', ...)` + `vi.mock('../../plugins/authBearer.js', ...)` (same pattern as `f107a.authRoutes.integration.test.ts:16–36`). Real Postgres test DB (port 5433) + real Redis (port 6380).

Test scenarios:
- **AC26:** Before call: seed `actor:limit:<actorId>:<today>:queries` = `12` in Redis (via `redis.set`). Call `GET /me/usage` with valid bearer + actor whose account has `tier = 'free'`. Assert `data.buckets.queries = { used: 12, limit: 100, remaining: 88 }`, `data.buckets.photos = { used: 0, limit: 20, remaining: 20 }`, `data.buckets.voice = { used: 0, limit: 30, remaining: 30 }`, `data.tier = 'free'`, `data.resetAt` matches next UTC midnight ISO string.
- **AC27 read-only:** Call `GET /me/usage` 5 times. Then `redis.get(actor:limit:...:queries)` → still `'12'` (no INCR). Assert `ROUTE_BUCKET_MAP['/me/usage']` is `undefined`.
- **AC28:** No `Authorization` header → 401. Invalid/expired bearer (mock throws `INVALID_TOKEN`) → 401.
- **AC29 admin:** Set `accounts.tier = 'admin'` via `prisma.$executeRaw`. Clear Redis tier cache for the sub. Call `GET /me/usage`. Assert all `limit: null`, `remaining: null`.
- **AC29 absent key:** No Redis keys seeded → `used: 0` for all buckets.
- **E14 Redis GET failure:** Override Redis mock to throw on `get`. Assert 200 response with all `used: 0`, no 500.

Implementation — add `GET /me/usage` handler to the `authRoutes` plugin in `auth.ts`:

- Add imports at top: `import type { Redis } from 'ioredis';`, `import { resolveAccountTier } from '../lib/accountTier.js';`, `import { computeResetAt, DAILY_LIMITS_BY_TIER } from '../plugins/actorRateLimit.js';`, `import { resolveBearerActorId } from '../lib/bearerActor.js';` (for the degraded-actor fallback — see below).
- Route: `app.get('/me/usage', {}, async (request, reply) => { ... })`.
- Bearer gate (identical to `/me`): check `request.headers['authorization']`; throw `UNAUTHORIZED` if absent; call `verifyBearerJwt` + `resolveJwksUrl`; throw on failure. **401 is reserved for absent/invalid bearer only.**
- `const sub = payload.sub`.
- `const actorId = request.actorId ?? await resolveBearerActorId(prisma, payload, request)` — **do NOT 401 a *valid* bearer whose `request.actorId` is unset.** `actorResolver` can leave `actorId` unset on a transient resolver-DB degrade even for a valid bearer (`actorResolver.ts` l.103–111); `/me` compensates by resolving/provisioning the actor inside the route (`auth.ts` l.179–212). `/me/usage` mirrors that fallback before reading counters. _[cross-model P-I3]_
- `const tier = await resolveAccountTier(redis, prisma, sub, request.log)`.
- `const dateKey = new Date().toISOString().slice(0, 10)`.
- `const resetAt = computeResetAt(dateKey)`.
- For each `bucket` in `['queries', 'photos', 'voice'] as const`:
  - `const redisKey = \`actor:limit:${actorId}:${dateKey}:${bucket}\``.
  - `const raw = await redis.get(redisKey).catch(() => null)` (E14 fail-open).
  - `const used = raw ? parseInt(raw, 10) : 0`.
  - `const limit = tier === 'admin' ? null : (DAILY_LIMITS_BY_TIER[tier]?.[bucket] ?? null)`.
  - `const remaining = tier === 'admin' ? null : Math.max(0, (limit ?? 0) - used)`.
- Return `reply.status(200).send({ success: true, data: { tier, resetAt, buckets: { queries, photos, voice } } })`.
- **`/me/usage` is NOT added to `ROUTE_BUCKET_MAP`** (E12/AC27 invariant).

**Step 7 — `app.ts` wiring**

File: `packages/api/src/app.ts`

7a. Change `registerActorRateLimit(app, { redis: redisClient })` (l.127) to:
```typescript
await registerActorRateLimit(app, { redis: redisClient, prisma: prismaClient });
```

7b. Change `app.register(authRoutes, { prisma: prismaClient, config: cfg })` (l.156) to:
```typescript
await app.register(authRoutes, { prisma: prismaClient, config: cfg, redis: redisClient });
```

---

#### Testing Strategy

**Test files and coverage:**

| File | Kind | ACs covered |
|---|---|---|
| `packages/shared/src/__tests__/f107a.authSchemas.test.ts` (extend) | Unit | AC16 |
| `packages/api/src/__tests__/f-web-tier/fWebTier.resolveAccountTier.unit.test.ts` | Unit (vi.fn mocks) | AC1, AC4, AC5 |
| `packages/api/src/__tests__/f-web-tier/fWebTier.actorRateLimit.tier.unit.test.ts` | Unit (vi.fn mocks) | AC1, AC2, AC3 |
| `packages/api/src/__tests__/f-web-tier/fWebTier.usageEndpoint.integration.test.ts` | Integration (real DB + Redis) | AC26, AC27, AC28, AC29 |
| `packages/api/src/__tests__/f107a/f107a.authRoutes.integration.test.ts` (extend) | Integration (real DB) | AC15 |
| `packages/api/src/__tests__/f107a/f107aFU2.collision.integration.test.ts` (regression, no changes) | Integration | AC6, AC7, AC8 stay GREEN |

**AC9** (bearer precedence, resolver unchanged) and **AC10** (provisioning failure non-fatal) are covered by existing f107a tests staying green — no new test files needed for those.

**Operator smoke tests (AC35–AC37):** manual post-deploy; not automated.

**Mocking strategy:**
- Unit tests (`resolveAccountTier`, `actorRateLimit`): mock `redis` as `{ get: vi.fn(), set: vi.fn() }`, mock `prisma.$queryRaw` as `vi.fn()`. Use `vi.mock('../lib/accountTier.js')` in the `actorRateLimit` tier tests to mock `resolveAccountTier` directly.
- Integration tests (`usageEndpoint`, `authRoutes` extension): real Postgres (port 5433 `foodxplorer_test`) + real Redis (port 6380); `vi.mock('@supabase/supabase-js', ...)` + `vi.mock('../../plugins/authBearer.js', () => ({ verifyBearerJwt: mockVerifyBearerJwt }))` (exact pattern from `f107a.authRoutes.integration.test.ts:26–36`).
- Fixture UUID prefix: `f7f00000-` (confirmed unused in any existing test file).

---

#### Key Patterns

- **`actorResolver` is untouched** (`packages/api/src/plugins/actorResolver.ts`): read l.98–112 to confirm — the comment "Does NOT perform account linking — that remains /me only" stays true and the try/catch scope is NOT changed. Any modification to `actorResolver.ts` is a plan violation.
- **`/me` linking block is untouched** (`packages/api/src/routes/auth.ts:255–343`): the safe-link UPDATE + collision fallback + Sentry warn stays inline verbatim. The ONLY changes to `auth.ts` are: add `tier` to `RawAccountRow`/RETURNING/`accountForResponse`, add `redis` to options, and add the new `GET /me/usage` route.
- **Cache key namespace** (`account:tier:<sub>`): raw Redis, NOT via `lib/cache.ts` `buildKey` (which prefixes `fxp:`). Keeps the tier cache in a separate namespace consistent with the spec (E4).
- **`computeResetAt` must be exported** before it can be imported from `routes/auth.ts`. Confirmed currently unexported at `actorRateLimit.ts:59`.
- **`authRoutes` options type** (`AuthRoutesOptions` at `auth.ts:42–45`): currently `{ prisma, config }` only — adding `redis: Redis` requires both the interface update AND the `app.ts` call update in the same commit.
- **`registerActorRateLimit` options** (`RegisterActorRateLimitOptions` at `actorRateLimit.ts:74–76`): currently `{ redis: Redis }` only — adding `prisma: PrismaClient` requires both interface and `app.ts` in the same commit.
- **`/me/usage` absent from `ROUTE_BUCKET_MAP`**: the existing `f069.actorRateLimit.unit.test.ts` tests `ROUTE_BUCKET_MAP` for known routes; add an assertion that `ROUTE_BUCKET_MAP['/me/usage'] === undefined` in the new `actorRateLimit` tier test.
- **Fail-open `free` (never `anonymous`) for verified bearer**: this invariant must hold in both `resolveAccountTier` (all error paths) and the `actorRateLimit` catch block (E4). The word `anonymous` must never appear as a return value of `resolveAccountTier`.
- **Integration test fixture cleanup order**: `actors` → `accounts` (FK: `actors.account_id` → `accounts.id` with `onDelete: SetNull`). Delete actors first in `afterAll`.

**Gotchas:**
- `request.accountId` = JWT `sub` = `accounts.auth_user_id` (UUID string). This is the cache key sub and the `WHERE auth_user_id = :sub` lookup field. It is NOT `accounts.id`. Never pass it directly as a FK against `actors.account_id`.
- The `actorRateLimit` `onRequest` hook is already `async` (l.82), so `await resolveAccountTier(...)` requires no conversion.
- `DAILY_LIMITS_BY_TIER` stores `admin` limits as `Infinity`. The usage route must treat `Infinity` as `null` in the response. Pattern: `tier === 'admin' ? null : DAILY_LIMITS_BY_TIER[tier][bucket]` (do not check for `Infinity` explicitly — the admin tier guard is cleaner).
- Deploy order: apply the migration first. The new code reads `tier` and `/me` returns it, but `AccountSchema.tier` is `.optional()` → old API (no `tier` in RETURNING) plus new web (expects `tier`) is a safe skew window.

---

#### Contract for Frontend Planner

1. **`GET /me` response — `data.account.tier` is added (additive).** Shape: `'free' | 'pro' | 'admin'`. Schema has it as `.optional()` — consumers must default: `account.tier ?? 'free'`. The AuthProvider calls `/me` on session establish (frontend scope — plan it there). This `/me` call triggers account provisioning + actor↔account linking via the existing F107a-FU2 inline path (no new backend work needed — it already links).

2. **`GET /me/usage` — new read-only endpoint.** Bearer-only (401 for anonymous). Response: `{ success: true, data: UsageResponse }` matching `UsageResponseSchema` from `@foodxplorer/shared`. Fields: `tier`, `resetAt` (UTC midnight ISO string, render as "mañana" — owner decision), `buckets.{queries,photos,voice}.{used, limit, remaining}`. Admin: `limit/remaining = null`. Absent Redis key: `used = 0`. Redis failure: degrades to `used: 0`, never 500. Not in `ROUTE_BUCKET_MAP` — safe to call repeatedly without burning quota.

3. **429 body — unchanged.** `error.details.tier` + `error.details.limit` already in response (`actorRateLimit.ts:143–150`). Frontend reads `details.tier === 'anonymous'` to decide whether to show the nudge CTA (E9).

4. **Photo proxy.** Fastify `/analyze/menu` already handles bearer via `actorResolver`. The only new frontend work is: `apiClient.ts` `sendPhotoAnalysis` attaches `Authorization: Bearer <token>` when `authToken` is non-null; `packages/web/src/app/api/analyze/route.ts` forwards the `Authorization` header to the Fastify upstream when present (additive — anonymous requests unchanged).

---

### Verification commands run

- `Read: packages/api/src/plugins/actorRateLimit.ts:1–173` → tier resolved at l.93 only from `apiKeyContext?.tier ?? 'anonymous'`; `RegisterActorRateLimitOptions` has only `redis: Redis` (l.74–76); `computeResetAt` is `function` not `export function` (l.59); hook is already `async` (l.82); `hasApiKey` fail-open at l.156 → must extend to `hasBearerAuth`; `DAILY_LIMITS_BY_TIER` and `ROUTE_BUCKET_MAP` are both already `export const`
- `Read: packages/api/src/plugins/actorResolver.ts:1–199` → comment at l.98 confirms "Does NOT perform account linking — that remains /me only"; bearer path: `verifyBearerJwt` at l.90 (OUTSIDE try), `resolveBearerActorId` inside try at l.103–111; `return` at l.112 — resolver writes nothing to accounts; confirmed UNCHANGED under Option A
- `Read: packages/api/src/routes/auth.ts:1–414` → `RawAccountRow` at l.26–36: no `tier` field; `$queryRaw` RETURNING at l.227–237: no `tier`; `AuthRoutesOptions` at l.42–45: `{ prisma, config }` only (no `redis`); `accountForResponse` at l.368–378: no `tier`; safe-link UPDATE at l.255–343: confirmed verbatim (unchanged under Option A); `resolveJwksUrl` at l.402–408 is a file-private helper usable by the new route
- `Read: packages/api/src/lib/bearerActor.ts:1–92` → `provisionFallbackActor` at l.40, `resolveBearerActorId` at l.70, `UUID_RE` at l.23; no `linkActorToAccount` function (Option A: extraction NOT needed)
- `Read: packages/api/prisma/schema.prisma:82–98, 482–497` → `ApiKeyTier` enum at l.85–91 (model for `AccountTier`); `Account` model at l.482–497: no `tier` field, no `AccountTier` enum; `actors.accountId` non-unique FK at l.470
- `Read: packages/shared/src/schemas/auth.ts:1–171` → `AccountTierSchema` at l.38; `AccountSchema.tier` as `.optional()` at l.55; `UsageBucketSchema` at l.142; `UsageResponseSchema` at l.156 — all pre-written; zero changes needed to this file
- `Bash: ls packages/api/src/lib/` → no `accountTier.ts` exists; file must be created
- `Bash: ls packages/api/src/__tests__/f107a/` → 11 test files; `f107aFU2.collision.integration.test.ts` present (F107a-FU2 regression baseline)
- `Read: packages/api/src/__tests__/f107a/f107a.authRoutes.integration.test.ts:1–79` → fixture prefix `f1070000-`; mocking pattern: `vi.mock('@supabase/supabase-js', ...)` + `vi.mock('../../plugins/authBearer.js', ...)` before dynamic `buildApp` import; real PrismaClient on test DB port 5433; Redis on port 6380
- `Read: packages/api/src/__tests__/f107a/f107aFU2.collision.integration.test.ts:1–79` → fixture prefix `f7220000-`; same `vi.mock` pattern; `f7f00000-` prefix confirmed unused by grep returning no results
- `Read: packages/api/src/app.ts:124–159` → `registerActorRateLimit(app, { redis: redisClient })` at l.127; `app.register(authRoutes, { prisma: prismaClient, config: cfg })` at l.156 — both confirmed need adding `prisma` / `redis` respectively
- `Bash: ls packages/api/prisma/migrations/ | tail -5` → last migration `20260514120000_create_profiles_empty`; timestamp `20260526130000` is sequential and safe
- `Read: packages/api/prisma/migrations/20260514100000_create_accounts/migration.sql` → migration style confirmed: header comment block + bare SQL (`CREATE TABLE`, `CONSTRAINT` naming, `CREATE INDEX`); no Prisma DSL
- `Read: packages/shared/src/__tests__/f107a.authSchemas.test.ts:1–59` → imports only `AccountSchema`, `ActorSummarySchema`, `MeResponseSchema`, `LoginRequestSchema`, `LoginResponseSchema` — does NOT yet import `AccountTierSchema`/`UsageBucketSchema`/`UsageResponseSchema`; `validAccount` fixture at l.19 has no `tier` field (extension must add new `describe` blocks without breaking existing ones)

---

### Frontend Plan

---

#### Existing Code to Reuse

| Symbol | File | Notes |
|---|---|---|
| `AuthProvider`, `AuthContext`, `AuthContextValue` | `packages/web/src/components/AuthProvider.tsx:1` | Extend `AuthContextValue` to add `account: Account \| null`; add `getMe` call inside `onAuthStateChange` |
| `useAuth()` | `packages/web/src/hooks/useAuth.ts:11` | Unchanged; consumers read new `account` field from context |
| `setAuthToken`, `sendMessage`, `sendPhotoAnalysis`, `sendVoiceMessage`, `ApiError` | `packages/web/src/lib/apiClient.ts:29,92,198,310,37` | Extend with `getMe()`, `getUsage()`, and bearer on `sendPhotoAnalysis` |
| `trackEvent`, `MetricEvent`, `MetricPayload` | `packages/web/src/lib/metrics.ts:138,13,35` | Extend `MetricEvent` union and `MetricPayload` with new fields |
| `UserMenu` | `packages/web/src/components/UserMenu.tsx:79` | `ml-auto` moves to outer wrapper in HablarShell; component itself unchanged |
| `AccountSchema`, `AccountTierSchema`, `MeResponseSchema`, `UsageResponseSchema`, `UsageBucket`, `UsageResponse` | `packages/shared/src/schemas/auth.ts:38,45,82,156` | Import from `@foodxplorer/shared`; all already written by spec-creator |
| `jest.mock('../../hooks/useAuth', ...)` pattern | `packages/web/src/__tests__/components/HablarShell.test.tsx:16` | Reuse in all new F-WEB-TIER component tests |
| `jest.mock('../../lib/apiClient', ...)` pattern | `packages/web/src/__tests__/components/HablarShell.photo.test.tsx:36` | Extend with `getMe`, `getUsage` mocks |
| `jest.mock('next/navigation', ...)` pattern | `packages/web/src/__tests__/auth/UserMenu.test.tsx:16` | Reuse in `LoginCta.test.tsx` |
| `mockFetch` + `jest.resetModules()` pattern | `packages/web/src/__tests__/auth/apiClient.auth.test.ts:10,72` | Reuse in `apiClient.fWebTier.test.ts` |
| `capturedAuthCallback` + `act()` pattern | `packages/web/src/__tests__/auth/AuthProvider.test.tsx:13` | Extend in `AuthProvider.fWebTier.test.tsx` |
| `getSupabaseBrowserClient` mock | `packages/web/src/__tests__/auth/AuthProvider.test.tsx:32` | Reuse same mock setup |

---

#### Files to Create

| File | Purpose |
|---|---|
| `packages/web/src/components/LoginCta.tsx` | New `'use client'` component — "Iniciar sesión" ghost button rendered in header when `user===null && !authLoading`. Fires `login_cta_shown` on mount, `login_cta_clicked` on click, navigates to `/login` via `useRouter`. |
| `packages/web/src/components/UsageMeter.tsx` | New `'use client'` component — compact daily-usage meter for logged-in users. Fetches `getUsage()` on mount; refreshes via callback prop. Inline counters ≥sm, icon+popover on mobile. Fires `usage_meter_shown` on first successful render. Gracefully degrades on fetch failure. |
| `packages/web/src/components/RateLimitNudge.tsx` | New `'use client'` primitive — upgrade prompt rendered by HablarShell as a sibling below `<ResultsArea>` (NOT inside `ErrorState`) for anonymous users. `onSignUpClick` prop. Fires `rate_limit_nudge_shown` on mount, `rate_limit_nudge_clicked` on click. `role="status"`. |
| `packages/web/src/__tests__/auth/AuthProvider.fWebTier.test.tsx` | Jest + RTL tests for AC6 (getMe called on session establish) and AC10 (getMe failure non-fatal). Extends mock pattern from `AuthProvider.test.tsx`. |
| `packages/web/src/__tests__/auth/apiClient.fWebTier.test.ts` | Jest unit tests for AC11 (photo bearer), AC13 (photo anonymous), `getMe()`, `getUsage()` bearer injection. Uses `jest.resetModules()` pattern from `apiClient.auth.test.ts`. |
| `packages/web/src/__tests__/api/analyze.proxy.fWebTier.test.ts` | Jest tests for AC12 — Next.js Route Handler forwards `Authorization` header when present; anonymous path unchanged. |
| `packages/web/src/__tests__/components/LoginCta.test.tsx` | Jest + RTL tests for AC17, AC18, AC19, AC20, AC21. |
| `packages/web/src/__tests__/components/UsageMeter.test.tsx` | Jest + RTL tests for AC30, AC31, AC32, AC33, AC34. |
| `packages/web/src/__tests__/components/HablarShell.fWebTier.test.tsx` | Jest + RTL tests for AC22, AC23, AC24, AC25 (nudge + funnel events). Extends mock setup from `HablarShell.test.tsx`. |

---

#### Files to Modify

| File | What changes |
|---|---|
| `packages/web/src/components/AuthProvider.tsx` | (0) **P-I1:** call `setAuthToken(newSession?.access_token ?? null)` on EVERY session change, BEFORE `getMe()` — AuthProvider becomes the authoritative bearer setter (HablarShell's existing `setAuthToken` effect becomes redundant/harmless); (1) Add `account: Account \| null` to `AuthContextValue` interface; (2) add `account` state; (3) inside `onAuthStateChange`, when `newSession` is non-null AND the event is `SIGNED_IN`/`INITIAL_SESSION` (NOT `TOKEN_REFRESHED` — loop guard), call `apiClient.getMe()` — on success set `account`, on failure log + leave `account: null` (non-fatal); (4) clear `account` on SIGNED_OUT. Import `Account` from `@foodxplorer/shared` and `setAuthToken` + `getMe` from `apiClient`. |
| `packages/web/src/lib/apiClient.ts` | (1) Add `getMe()`: `GET ${baseUrl}/me` with `Authorization: Bearer <authToken>`; parse against `MeResponseSchema`; throw `ApiError` on non-2xx or parse failure. (2) Add `getUsage()`: `GET ${baseUrl}/me/usage` with bearer; parse against `UsageResponseSchema`. (3) In `sendPhotoAnalysis`: add `...(authToken ? { Authorization: \`Bearer ${authToken}\` } : {})` to `headers` (mirrors l.118 pattern for `sendMessage`). |
| `packages/web/src/lib/metrics.ts` | (1) Extend `MetricEvent` union: add `'login_cta_shown' \| 'login_cta_clicked' \| 'rate_limit_nudge_shown' \| 'rate_limit_nudge_clicked' \| 'usage_meter_shown'`. (2) Extend `MetricPayload`: add `authenticated?: boolean; tier?: string`. |
| `packages/web/src/components/HablarShell.tsx` | (1) Header: replace `{user && <UserMenu user={user} />}` (l.482) with auth-slot dichotomy (see Key Patterns). (2) Add `showRateLimitNudge` state. (3) In `executeQuery` catch for `RATE_LIMIT_EXCEEDED`: make message dynamic from `err.details?.limit`; set `showRateLimitNudge(true)` when `user === null`; clear at start of each `executeQuery` call. (4) Add `authenticated: !!user` to `query_sent` and `query_success` event payloads; same for `photo_sent` / `photo_success`. (5) **P-I2:** render `<RateLimitNudge>` as a **sibling below `<ResultsArea>`** (NOT inside it) when `showRateLimitNudge && !user` — `ErrorState` props are only `{message, onRetry}` with no children/slot, so the nudge lives in HablarShell's layout and appears visually below the error. **No changes to `ErrorState.tsx`/`ResultsArea.tsx`.** (6) Add `onUsageRefresh` callback passed to `<UsageMeter>` as a `ref`/callback triggered after `query_success` / photo success / voice success. Import `LoginCta`, `UsageMeter`, `RateLimitNudge`. |
| `packages/web/src/app/api/analyze/route.ts` | After forwarding `X-FXP-Source` (after l.57), add: `const authorization = request.headers.get('Authorization'); if (authorization) mergedHeaders.set('Authorization', authorization);` — additive, anonymous path unchanged. |
| `packages/web/src/__tests__/components/HablarShell.test.tsx` | Update the `RATE_LIMIT_EXCEEDED` test (l.131–142): the hardcoded error string `'Has alcanzado el límite diario de 50 consultas.'` changes — update assertion to match the new dynamic message pattern `(/límite diario/i)`; add `getMe: jest.fn()` and `getUsage: jest.fn()` to the `apiClient` mock block. |

---

#### Implementation Order

1. **`packages/web/src/lib/metrics.ts`** — extend `MetricEvent` + `MetricPayload` (zero component changes; enables TypeScript to accept new events in subsequent steps; no tests needed for the type-only extension)

2. **`packages/web/src/lib/apiClient.ts`** + **`packages/web/src/__tests__/auth/apiClient.fWebTier.test.ts`** (TDD: write tests RED, then implement)
   - Tests AC11 / AC13 (photo bearer toggle)
   - Tests `getMe()` bearer injection + parse + error throw
   - Tests `getUsage()` bearer injection + parse + error throw

3. **`packages/web/src/app/api/analyze/route.ts`** + **`packages/web/src/__tests__/api/analyze.proxy.fWebTier.test.ts`** (TDD)
   - Tests AC12: request with `Authorization` header → forwarded to upstream; without → not forwarded

4. **`packages/web/src/components/AuthProvider.tsx`** + **`packages/web/src/__tests__/auth/AuthProvider.fWebTier.test.tsx`** (TDD)
   - Tests AC6: `getMe` called after SIGNED_IN event and on INITIAL_SESSION; NOT called on TOKEN_REFRESHED
   - Tests AC10: `getMe` rejection → `account` stays null, context still valid, no throw

5. **`packages/web/src/components/LoginCta.tsx`** + **`packages/web/src/__tests__/components/LoginCta.test.tsx`** (TDD)
   - Tests AC17–AC21

6. **`packages/web/src/components/RateLimitNudge.tsx`** (no standalone test file needed at this step — tested via HablarShell in step 9)

7. **`packages/web/src/components/UsageMeter.tsx`** + **`packages/web/src/__tests__/components/UsageMeter.test.tsx`** (TDD)
   - Tests AC30–AC34

8. **`packages/web/src/components/HablarShell.tsx`** — header wiring + `showRateLimitNudge` + `authenticated` funnel (update existing mock in `HablarShell.test.tsx` to add `getMe`/`getUsage`)

9. **`packages/web/src/__tests__/components/HablarShell.fWebTier.test.tsx`** — new file for AC22, AC23, AC24, AC25 (nudge + funnel)

---

#### Component Signatures & Props

```typescript
// LoginCta.tsx — no props
'use client';
export function LoginCta(): JSX.Element | null

// RateLimitNudge.tsx
'use client';
interface RateLimitNudgeProps {
  onSignUpClick: () => void;
}
export function RateLimitNudge({ onSignUpClick }: RateLimitNudgeProps): JSX.Element

// UsageMeter.tsx
'use client';
interface UsageMeterProps {
  onRefreshReady?: (refresh: () => void) => void; // HablarShell registers a callback to trigger re-fetch
}
export function UsageMeter({ onRefreshReady }: UsageMeterProps): JSX.Element | null
```

**`AuthContextValue` extension (AuthProvider.tsx):**

```typescript
import type { Account } from '@foodxplorer/shared';

export interface AuthContextValue {
  user: User | null;
  session: Session | null;
  account: Account | null;          // NEW — from GET /me; null before session or on getMe failure
  loading: boolean;
  error: string | null;
  signIn: (provider: 'email' | 'google', options: SignInOptions) => Promise<void>;
  signOut: () => Promise<void>;
}
```

**`getMe` / `getUsage` signatures (apiClient.ts):**

```typescript
// GET /me — with bearer; parses MeResponseSchema; throws ApiError on failure
export async function getMe(): Promise<MeResponse>

// GET /me/usage — with bearer; parses UsageResponseSchema; throws ApiError on failure
export async function getUsage(): Promise<UsageResponse>
```

---

#### AuthProvider `/me`-on-session-establish wiring

The Supabase `onAuthStateChange` fires for every auth event including `TOKEN_REFRESHED`. To avoid calling `getMe()` on every token refresh (which would be noisy and wasteful), filter on event type:

```typescript
// Inside onAuthStateChange callback — receives (_event, newSession)
supabase.auth.onAuthStateChange((event, newSession) => {
  setSession(newSession);
  setUser(newSession?.user ?? null);
  setLoading(false);

  // P-I1: AuthProvider is the authoritative setter of the apiClient bearer singleton.
  // Set it on EVERY session change (incl. TOKEN_REFRESHED) so outbound calls
  // (getMe/getUsage/sendMessage/...) use a fresh token — and crucially BEFORE getMe()
  // below, otherwise getMe runs with a null token and 401s. (HablarShell's existing
  // setAuthToken effect becomes redundant but harmless.)
  setAuthToken(newSession?.access_token ?? null);

  // Call getMe only on genuine session establish events, NOT on token refresh
  // (TOKEN_REFRESHED fires every ~3600s for a background refresh — calling getMe
  //  each time would spam the endpoint and create unnecessary linking writes).
  if (
    newSession &&
    (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')
  ) {
    getMe()
      .then((meResponse) => {
        setAccount(meResponse.account);
      })
      .catch((err) => {
        // AC10: non-fatal — log, leave account as null, app continues working
        console.warn('[AuthProvider] getMe failed (non-fatal):', err);
        // account stays null → tier treated as 'free' (E3)
      });
  }

  if (event === 'SIGNED_OUT') {
    setAccount(null);
  }
});
```

**Loop prevention rationale:** `TOKEN_REFRESHED` is explicitly excluded. `getMe()` itself calls `GET /me`, which triggers no auth state change event in Supabase — so there is no risk of a cycle. The `useEffect` dep array is `[supabase]` (memoized once) — the callback is registered once and never re-registered.

**No-duplicate-call invariant:** `SIGNED_IN` fires once per login. `INITIAL_SESSION` fires once on page load if a session exists. Neither fires again after `getMe()` resolves. If `getMe()` is slow and the user navigates away, the `.catch()` guard means no state mutation occurs after unmount is possible — but since `AuthProvider` wraps the entire app and never unmounts mid-session, this is not a concern.

---

#### HablarShell header replacement (Key Pattern)

Replace at l.482:
```tsx
// Before:
{user && <UserMenu user={user} />}  {/* F107a */}

// After (W9 spec: ml-auto moves to outer wrapper for logged-in pair):
{!authLoading && !user && <LoginCta />}
{!authLoading && user && (
  <div className="flex items-center gap-2 ml-auto">
    <UsageMeter onRefreshReady={...} />
    <UserMenu user={user} />
  </div>
)}
```

The `ml-auto` that was on `UserMenu`'s internal wrapper (`div className="relative ml-auto"` at `UserMenu.tsx:79`) is already scoped inside `UserMenu` — the outer wrapper in `HablarShell` adds a new `ml-auto` group for the pair. `UserMenu`'s internal `relative ml-auto` remains unchanged.

`<LoginCta>` also needs `ml-auto` to anchor it to the right slot: add `className="ml-auto"` wrapper or include `ml-auto` in `LoginCta`'s own outermost element.

---

#### Dynamic 429 error message

At `HablarShell.tsx` l.275 (current hardcoded string):

```tsx
// Before:
setError('Has alcanzado el límite diario de 50 consultas. Vuelve mañana.');

// After (dynamic from details.limit — ticket Spec §UI Changes, cross-model F6):
const limit = typeof err.details?.['limit'] === 'number' ? err.details['limit'] : null;
const limitStr = limit !== null ? ` de ${limit}` : '';
setError(`Has alcanzado el límite diario${limitStr} consultas. Vuelve mañana.`);
if (user === null) {
  setShowRateLimitNudge(true);
}
```

Clear `showRateLimitNudge` at the top of `executeQuery` (before the `sendMessage` call) so retrying resets the nudge.

---

#### Testing Strategy

**Test files, frameworks, AC coverage:**

| File | Kind | ACs |
|---|---|---|
| `packages/web/src/__tests__/auth/apiClient.fWebTier.test.ts` | Jest unit (fetch mock, `jest.resetModules`) | AC11, AC13 (photo bearer) + getMe/getUsage bearer + parse |
| `packages/web/src/__tests__/api/analyze.proxy.fWebTier.test.ts` | Jest unit (Request mock) | AC12 |
| `packages/web/src/__tests__/auth/AuthProvider.fWebTier.test.tsx` | Jest + RTL | AC6 (frontend half), AC10 |
| `packages/web/src/__tests__/components/LoginCta.test.tsx` | Jest + RTL | AC17, AC18, AC19, AC20, AC21 |
| `packages/web/src/__tests__/components/UsageMeter.test.tsx` | Jest + RTL | AC30, AC31, AC32, AC33, AC34 |
| `packages/web/src/__tests__/components/HablarShell.fWebTier.test.tsx` | Jest + RTL | AC22, AC23, AC24, AC25 |
| `packages/web/src/__tests__/components/HablarShell.test.tsx` (update) | Jest + RTL | Update RATE_LIMIT_EXCEEDED test, add getMe/getUsage to apiClient mock |

**Key test scenarios:**

`AuthProvider.fWebTier.test.tsx`:
- **AC6a** SIGNED_IN fires → `getMe` called once, `account` set in context
- **AC6b** INITIAL_SESSION fires → `getMe` called once (session-restore path)
- **AC6c** TOKEN_REFRESHED fires → `getMe` NOT called (no duplicate)
- **AC10** `getMe` rejects → `account === null`, no error thrown in context, `loading` becomes `false`
- **AC10** Multiple sign-in events — only one `getMe` call per event

`apiClient.fWebTier.test.ts` (using `jest.resetModules()` pattern from `apiClient.auth.test.ts:72`):
- `sendPhotoAnalysis` with `authToken` set → fetch includes `Authorization: Bearer <token>`
- `sendPhotoAnalysis` with `authToken === null` → no `Authorization` header (AC13)
- `getMe()` with token set → calls `GET <baseUrl>/me` with bearer; returns `MeResponse` on 200
- `getMe()` with token null → throws `ApiError('Unauthorized', 'UNAUTHORIZED')`
- `getMe()` on non-200 → throws `ApiError` with correct code
- `getUsage()` with token set → calls `GET <baseUrl>/me/usage` with bearer; parses `UsageResponse`
- `getUsage()` on 5xx → throws `ApiError`

`analyze.proxy.fWebTier.test.ts`:
- POST with `Authorization: Bearer tok` → upstream fetch called with `Authorization: Bearer tok` in mergedHeaders
- POST without `Authorization` → upstream fetch called without `Authorization` header
- Existing `API_KEY` forwarding still present in both cases (regression)

`LoginCta.test.tsx`:
- **AC17** Renders "Iniciar sesión" button; `aria-label="Iniciar sesión o registrarse"`
- **AC18** When `authLoading=true` (via `useAuth` mock) → renders null
- **AC19** When `user !== null` → renders null (component itself returns null; tested in context of HablarShell too)
- **AC20** On mount: `trackEvent('login_cta_shown')` called once
- **AC21** Click → `trackEvent('login_cta_clicked')` called; `router.push('/login')` called

`UsageMeter.test.tsx`:
- **AC30** With `getUsage` resolving `{ tier:'free', buckets:{queries:{used:12,limit:100,remaining:88}, photos:{used:3,limit:20,remaining:17}, voice:{used:5,limit:30,remaining:25}}, resetAt:'...' }` → DOM contains "12/100", "3/20", "5/30"
- **AC31** When rendered without a logged-in user (test renders with `useAuth` returning `user=null`) → `getUsage` NOT called; nothing rendered
- **AC32** `onRefreshReady` receives callback; calling that callback triggers `getUsage` again
- **AC33** After successful data render: `trackEvent('usage_meter_shown', { tier: 'free' })` called once
- **AC34** `getUsage` rejects → component renders null or "—"; no error thrown

`HablarShell.fWebTier.test.tsx`:
- **AC22** Anonymous user + `sendMessage` throws `ApiError('...', 'RATE_LIMIT_EXCEEDED', 429, { limit: 50 })` → `<RateLimitNudge>` in DOM; error message present alongside nudge
- **AC23** Logged-in user + same 429 → `<RateLimitNudge>` NOT in DOM; plain error message shown
- **AC24** Nudge rendered → `trackEvent('rate_limit_nudge_shown')` called; clicking "Crear cuenta gratis" → `trackEvent('rate_limit_nudge_clicked')` called; `router.push('/login')` called
- **AC25** `trackEvent('query_sent', { authenticated: false })` when `user=null`; `trackEvent('query_sent', { authenticated: true })` when `user` non-null; same for `query_success`

**Mocking strategy:**

All component tests mock `useAuth` via `jest.mock('../../hooks/useAuth', () => ({ useAuth: () => ({...}) }))`. The `user` value is controlled per test by overriding the mock return value with `jest.spyOn` or `mockReturnValue` after the module-level mock declares the default.

All component tests mock `apiClient` via `jest.mock('../../lib/apiClient', () => ({ sendMessage: jest.fn(), sendPhotoAnalysis: jest.fn(), setAuthToken: jest.fn(), getMe: jest.fn(), getUsage: jest.fn(), ApiError: class ... }))`.

`trackEvent` is mocked via `jest.mock('../../lib/metrics', () => ({ trackEvent: jest.fn(), flushMetrics: jest.fn() }))`.

`useRouter` is mocked via `jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))`.

The Route Handler test (`analyze.proxy.fWebTier.test.ts`) mocks `global.fetch` to capture the upstream `Request` object and inspects its headers.

---

#### Key Patterns

- **`'use client'` directive**: All three new components (`LoginCta`, `UsageMeter`, `RateLimitNudge`) require `'use client'` — they use `useEffect`, `useState`, `useRouter`, and `useAuth` hooks.
- **No Radix UI**: `UserMenu.tsx:6` confirms "no Radix UI — not installed". The popover in `UsageMeter` must be implemented with plain Tailwind + aria-* (same approach as `UserMenu` dropdown).
- **`authToken` module singleton pattern**: `apiClient.ts` holds `let authToken: string | null = null` at module level (l.22). `getMe()` and `getUsage()` read this same singleton — both throw if `authToken` is null (they are bearer-only by design; the caller — `AuthProvider` and `UsageMeter` — only call them when a session exists).
- **`jest.resetModules()` for apiClient**: The `authToken` module-level state persists across tests unless `jest.resetModules()` + `require()` pattern is used. Follow exact pattern from `apiClient.auth.test.ts:72`.
- **`MetricEvent` is a string union** (not an enum): extend with `|` additions directly in `metrics.ts:13`. TypeScript will enforce at call sites.
- **`TOKEN_REFRESHED` must NOT trigger `getMe`**: Supabase fires `TOKEN_REFRESHED` roughly every hour to refresh the access token silently. Calling `getMe` on refresh would be noisy (and the account row is already provisioned). The guard `event === 'SIGNED_IN' || event === 'INITIAL_SESSION'` covers all genuine session-establish paths without triggering on refresh.
- **`account.tier ?? 'free'` pattern** (E10 deploy-skew): wherever `account.tier` is read (e.g., `UserMenu` if it shows a tier badge in the future), always default to `'free'` since `tier` is `.optional()` in the schema.
- **`role="status"` on RateLimitNudge and UsageMeter** (W13): both components use `role="status"` so screen readers announce the element when it mounts/updates. The `<UsageMeter>` `aria-label` is recalculated on each fetch to include current counts.
- **`sendPhotoAnalysis` comment at l.219**: the existing comment `// F107a: bearer not sent via /api/analyze proxy — out of scope until analyze endpoint is auth-gated` must be **removed** when adding the bearer header — it documents the old intentional omission.
- **Admin tier → render null in `UsageMeter`** (W14 anti-pattern): when `getUsage()` returns `tier === 'admin'` or any `bucket.limit === null`, render `null` entirely — no quota chrome for admin users.
- **`UsageMeter` refresh wiring**: `HablarShell` needs to trigger a refresh in `UsageMeter` after each successful query/photo/voice. The cleanest pattern (given both are client components) is a `useRef<(() => void) | null>` callback ref in `HablarShell`, passed to `UsageMeter` via the `onRefreshReady` prop. `UsageMeter` calls `onRefreshReady(refetchFn)` in its own `useEffect` after mount, and `HablarShell` stores the ref. After a success callback, `HablarShell` calls the stored ref.

**Gotchas:**

- `UserMenu.tsx` has its own `className="relative ml-auto"` on its outer `<div>` (l.79). In the new logged-in header, `UserMenu` is nested inside `HablarShell`'s `<div className="flex items-center gap-2 ml-auto">`. The `ml-auto` inside `UserMenu` will then be redundant — it won't break anything (flex children with `ml-auto` are still positioned relative to flex parent context) but it applies a second auto-margin within an already-right-anchored container. This is acceptable and avoids modifying `UserMenu`. Document this in a comment.
- The `LoginCta` component uses `useAuth` internally to fire `trackEvent` context-free on mount. Since `HablarShell` already gates rendering on `!authLoading && !user`, `LoginCta` itself does not need to re-read `useAuth` — it can be a stateless presentational component that receives `onNavigate` or simply uses `useRouter` directly. Do NOT duplicate the auth guard inside `LoginCta` (HablarShell is the controller).
- The proxy test (`analyze.proxy.fWebTier.test.ts`) must mock `process.env['API_KEY']` and `process.env['NEXT_PUBLIC_API_URL']` and the global `fetch` (used for the upstream call). The Route Handler is a plain `async function POST(request: Request)` — test it by constructing a `new Request(...)` with headers and calling `POST(request)` directly.
- `MetricPayload.tier` is also needed for `usage_meter_shown` (payload `{ tier: string }`). The existing `MetricPayload` interface has no `tier` field yet (confirmed: `metrics.ts:35–49`).

---

#### Testing Strategy — Verification of `analyze.proxy` Route Handler

The Route Handler at `packages/web/src/app/api/analyze/route.ts` is a plain exported async function that takes a `Request` and returns a `Response`. Jest's `jsdom` environment supports the `Request`/`Response` Web API natively (configured in `jest.config.js:8` with `testEnvironment: 'jsdom'`). Test pattern:

```typescript
// analyze.proxy.fWebTier.test.ts
const mockFetch = jest.fn();
global.fetch = mockFetch;
process.env['API_KEY'] = 'test-key';
process.env['NEXT_PUBLIC_API_URL'] = 'https://api.example.com';

import { POST } from '../../app/api/analyze/route';

it('forwards Authorization header when present', async () => {
  mockFetch.mockResolvedValueOnce(new Response('{}', { status: 200 }));
  const request = new Request('http://localhost/api/analyze', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer tok123', 'X-Actor-Id': 'actor-1', 'X-FXP-Source': 'web' },
    body: new FormData(),
  });
  await POST(request);
  const [upstreamReq] = mockFetch.mock.calls[0] as [Request];
  expect(upstreamReq.headers.get('Authorization')).toBe('Bearer tok123');
});
```

---

### Verification commands run

- `Read: packages/web/src/components/AuthProvider.tsx:1–112` → `AuthContextValue` at l.20 has `{ user, session, loading, error, signIn, signOut }` — no `account` field; `onAuthStateChange` at l.51 ignores `_event` parameter (never discriminates SIGNED_IN vs TOKEN_REFRESHED) → must add event discrimination + getMe call; `supabase` memoized once → subscription registered once, no loop risk
- `Read: packages/web/src/lib/apiClient.ts:1–405` → `sendPhotoAnalysis` at l.221–228 sends headers `X-Actor-Id` + `X-FXP-Source` but NOT `Authorization` (comment at l.219 confirms intentional omission); `sendMessage` at l.118 is the bearer pattern to mirror; `authToken` module singleton at l.22; `getMe` and `getUsage` do NOT exist (zero instances found) → both must be created
- `Read: packages/web/src/app/api/analyze/route.ts:1–99` → forwards `Content-Type`, `X-API-Key`, `X-Actor-Id`, `X-FXP-Source` but NOT `Authorization` (confirmed additive change only); proxy is a plain `async function POST(request: Request)` — testable by direct call
- `Read: packages/web/src/components/HablarShell.tsx:480–484` → `{user && <UserMenu user={user} />}` at l.482 (single guard, no `authLoading` guard on this line) → replace with dichotomy; `ml-auto` is inside UserMenu component, not on this line
- `Read: packages/web/src/components/UserMenu.tsx:79` → `<div className="relative ml-auto">` — confirmed `ml-auto` is inside `UserMenu`; outer wrapper in HablarShell must also add `ml-auto` to the pair group; no conflict
- `Read: packages/web/src/lib/metrics.ts:13–49` → `MetricEvent` union at l.13–33: does NOT include `login_cta_shown`, `login_cta_clicked`, `rate_limit_nudge_shown`, `rate_limit_nudge_clicked`, `usage_meter_shown` → all must be added; `MetricPayload` at l.35–49: no `authenticated` or `tier` fields → both must be added
- `Read: packages/shared/src/schemas/auth.ts:38,45,55,82,142,156` → `AccountTierSchema` at l.38 ✓; `AccountSchema.tier` as `.optional()` at l.55 ✓; `MeResponseSchema` at l.82 ✓; `UsageBucketSchema` at l.142 ✓; `UsageResponseSchema` at l.156 ✓ — all schemas pre-written; `UsageResponse` type at l.170; import from `@foodxplorer/shared` confirmed by `packages/web/jest.config.js:17`
- `Bash: grep -n "login_cta\|rate_limit_nudge\|usage_meter" packages/web/src/lib/metrics.ts` → no results → all new events must be added to the union
- `Bash: grep -n "getMe\|getUsage" packages/web/src/lib/apiClient.ts` → no results → both functions are new; no existing dead stubs
- `Bash: grep -rn "getMe\|MeResponse\|UsageResponse" packages/web/src/ (non-test)` → no results → no prior consumers; clean addition
- `Read: packages/web/src/__tests__/auth/AuthProvider.test.tsx:1–176` → `capturedAuthCallback` pattern at l.13 for manually firing events; `jest.mock('../../lib/supabase/browser', ...)` at l.32; `global.fetch = mockFetch` at l.38 → same setup needed in `AuthProvider.fWebTier.test.tsx` plus add `apiClient` mock for `getMe`
- `Read: packages/web/src/__tests__/auth/apiClient.auth.test.ts:70–80` → `jest.resetModules()` in `beforeEach` + `require('../../lib/apiClient')` pattern confirmed — must reuse in `apiClient.fWebTier.test.ts` for correct `authToken` isolation
- `Read: packages/web/src/__tests__/auth/UserMenu.test.tsx:16` → `jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, replace: mockReplace }) }))` — exact pattern to reuse in `LoginCta.test.tsx`
- `Read: packages/web/src/__tests__/components/HablarShell.test.tsx:131–142` → existing test asserts `screen.getByText(/límite diario/i)` (regex, not exact string) → the update to a dynamic message will NOT break this test; the `apiClient` mock block at l.27–40 must add `getMe: jest.fn()` and `getUsage: jest.fn()`
- `Read: packages/web/jest.config.js:1–32` → `testEnvironment: 'jsdom'` confirmed; `moduleNameMapper` maps `@foodxplorer/shared` to shared `src/index.ts`; `testMatch` includes `__tests__/**/*.test.{ts,tsx}` → new files in `__tests__/api/` and `__tests__/components/` match
- `Bash: ls packages/web/src/__tests__/api/` → directory does not exist → must be created (no mkdir needed; Jest resolves any path under `__tests__/**`)
- `Bash: grep -n "SIGNED_IN\|INITIAL_SESSION\|TOKEN_REFRESHED" packages/web/src/components/AuthProvider.tsx` → no occurrences → current code ignores event type entirely; confirmed safe to add discrimination
- `Read: packages/web/src/components/HablarShell.tsx:270–294` → `executeQuery` catch block at l.272 with RATE_LIMIT_EXCEEDED at l.274–275: hardcoded `'50 consultas'` string confirmed at l.275; `err.details` is accessible (`ApiError.details` at `apiClient.ts:46`) → dynamic message is straightforward
- `Read: packages/web/src/components/HablarShell.tsx:296–326` → `executePhotoAnalysis` at l.296: `authLoading` guard at l.298; `trackEvent('photo_sent')` at l.325 with no `authenticated` field → must add `authenticated: !!user`; `trackEvent('photo_success')` not yet read — confirmed at l.359 area via grep

---

_Plan written: 2026-05-26 | frontend-planner_

---

## Acceptance Criteria

### Backend — Tier resolution

- [x] **AC1 — Authenticated user gets `free` tier:**
  A valid bearer request to `POST /conversation/message` where `request.accountId` (the bearer
  `sub`) is set resolves `tier = 'free'` and the daily limit applied is 100 queries (not 50).
  Verified by unit test on `actorRateLimit` with `resolveAccountTier` mocked to return `'free'`.

- [x] **AC2 — Anonymous user still gets `anonymous` tier (50 q / 10 photos / 30 voice):**
  A request with no `Authorization` header resolves `tier = 'anonymous'` and the existing
  limits apply unchanged. Verified by unit test on `actorRateLimit` (no regression).

- [x] **AC3 — `DAILY_LIMITS_BY_TIER.free` values match spec (100 q / 20 photos / 30 voice):**
  `actorRateLimit.ts` `DAILY_LIMITS_BY_TIER.free` export equals
  `{ queries: 100, photos: 20, voice: 30, realtime_minutes: 0 }`.
  Verified by unit test asserting the exported constant (already the contract in the file).

- [x] **AC4 — Tier cache prevents extra DB read per request:**
  A second bearer request for the same `accountId` within 60s reads tier from Redis and does
  NOT perform a DB query. Verified by unit/integration test: mock DB throws after first call;
  second call still returns `'free'`.

- [x] **AC5 — Tier cache fail-open for DB error:**
  If the DB read for account tier fails (transient), `resolveAccountTier` returns `'free'`
  (not `'anonymous'`). Verified by unit test with DB mock throwing.

### Account provisioning + linking via `/me` (Option A)

- [x] **AC6 — `AuthProvider` calls `GET /me` on session establish → account provisioned + actor linked:**
  (a) _Frontend:_ on login AND on session restore, `AuthProvider` calls `apiClient.getMe()` exactly
  once per session establish (verified by component test with `apiClient` mocked). (b) _Backend
  regression:_ `GET /me` upserts the `accounts` row (`ON CONFLICT auth_user_id`) and links the
  requesting actor (`actors.account_id = accounts.id`) when unlinked (verified by integration test:
  actor unlinked → after `/me`, `actors.account_id` = the account's id). Linking is `/me`'s existing
  F107a behaviour — must stay green after the `tier` addition.

- [x] **AC7 — `/me` linking idempotent (regression):**
  When the actor is already linked to the same account, `/me` is a no-op on `account_id` (no
  collision fallback). Verified by existing F107a integration test staying green.

- [x] **AC8 — Anti-hijack collision fallback in `/me` (regression, F107a-FU2):**
  When the actor is already linked to a **different** account, `/me` does NOT overwrite it; it
  links the `me-<sub.slice(0,8)>` fallback actor instead, emits `event: 'actor_link_collision'`
  Pino warn + Sentry warning. Verified by existing F107a-FU2 tests staying green (the linking code
  is unchanged by this feature).

- [x] **AC9 — Strict bearer precedence unchanged (ADR-025 R3 §5):**
  Invalid/expired bearer → 401 immediately (both `/me` and the rate-limited routes). The
  `actorResolver` performs NO account writes (unchanged from BUG-PROD-013). Verified by existing
  suite (no regression) + a tampered-JWT 401 test.

- [x] **AC10 — Provisioning/linking failure is non-fatal:**
  If `GET /me` fails (network/DB), `AuthProvider` does NOT break `/hablar` — the user can still
  query (tier falls back to `free`, the meter renders "—"). Verified by component test with
  `getMe` rejecting. (The `actorResolver` is unchanged; non-actor routes like `/auth/logout` are
  unaffected — BUG-PROD-013 invariant.)

### Backend — Photo path

- [x] **AC11 — Photo analysis: bearer forwarded from proxy to Fastify:**
  When `apiClient.sendPhotoAnalysis` is called with a non-null `authToken`, the outgoing fetch
  to `/api/analyze` includes `Authorization: Bearer <token>`. Verified by unit test on
  `apiClient.ts` inspecting fetch call headers.

- [x] **AC12 — Photo proxy: bearer forwarded to Fastify upstream:**
  `packages/web/src/app/api/analyze/route.ts` forwards `Authorization` header from incoming
  browser request to the upstream Fastify call when present. Verified by unit test on the
  Route Handler.
  **Note (Step 5 fix, 2026-05-26):** AC11+AC12 ship the bearer to Fastify correctly, but
  feature goal #3 ("photo rate limits are per-account, not shared") was NOT fully delivered because
  `actorRateLimit.ts` was **API-key-first** — the shared `X-API-Key` took precedence over the
  bearer and the account tier was never resolved for `/analyze/menu`. The bearer-over-API-key
  precedence fix (Step 5 commit) delivers the missing backend half: when `request.accountId` is
  set (valid bearer), the account tier is now resolved via `resolveAccountTier` even when
  `apiKeyContext` is also present. End-to-end coverage: integration test
  `fWebTier.photoTier.integration.test.ts` — authenticated free user at 21 photos → 429 with
  `tier: 'free', limit: 20` (not pro/anonymous). Unit test `fWebTier.actorRateLimit.tier.unit.test.ts`
  covers bearer + apiKeyContext present → `resolveAccountTier` IS called (bearer wins).

- [x] **AC13 — Photo analysis: anonymous user (no bearer) is unaffected:**
  When `authToken` is null, `sendPhotoAnalysis` does NOT attach `Authorization`. Proxy
  behaviour for anonymous requests is unchanged. Verified by unit test.

### Backend — Data model

- [x] **AC14 — `accounts.tier` column exists with default `free`:**
  After migration, `SELECT tier FROM accounts WHERE ...` returns `'free'` for all existing
  rows. Verified by operator smoke test (post-deploy SQL check) OR integration test with
  migration applied.

- [x] **AC15 — `GET /me` response includes `tier`:**
  `GET /me` with a valid bearer returns `data.account.tier === 'free'` for a standard account.
  Verified by integration test (or operator smoke: `curl /me | jq .data.account.tier`).

- [x] **AC16 — `AccountSchema` Zod schema includes optional `tier`:**
  `AccountSchema` parses a payload WITH `tier` (→ value preserved) AND a payload WITHOUT `tier`
  (→ no throw; field absent — consumers default to `'free'`). `tier` is `.optional()` for
  deploy-skew resilience (E10). Verified by unit test in
  `packages/shared/src/__tests__/f107a.authSchemas.test.ts` (existing file, extend with both cases).

### Frontend — CTA

- [x] **AC17 — `<LoginCta>` renders in header when logged out:**
  On `/hablar` with no authenticated session, the header contains a "Iniciar sesión" button.
  Verified by component test (RTL) or E2E smoke: render `HablarShell` with `user=null,
  authLoading=false`.

- [x] **AC18 — `<LoginCta>` does not render while `authLoading`:**
  When `authLoading=true`, neither `<UserMenu>` nor `<LoginCta>` renders. Verified by
  component test.

- [x] **AC19 — `<LoginCta>` does not render for authenticated user:**
  When `user` is non-null, `<LoginCta>` is not in the DOM; `<UserMenu>` is. Verified by
  component test.

- [x] **AC20 — `login_cta_shown` event fires on mount:**
  When `<LoginCta>` mounts, `trackEvent('login_cta_shown')` is called exactly once. Verified
  by component test with `trackEvent` mocked.

- [x] **AC21 — `login_cta_clicked` event fires and navigation occurs:**
  Clicking `<LoginCta>` calls `trackEvent('login_cta_clicked')` and triggers navigation to
  `/login`. Verified by component test.

### Frontend — Rate-limit nudge

- [x] **AC22 — Anonymous user sees nudge on 429:**
  When `executeQuery` receives a 429 `RATE_LIMIT_EXCEEDED` and `user === null`, the
  `<RateLimitNudge>` component renders below the error message. Verified by component test
  with `sendMessage` mocked to throw `ApiError('...', 'RATE_LIMIT_EXCEEDED', 429)`.

- [x] **AC23 — Logged-in user does NOT see nudge on 429:**
  When `user !== null` and 429 is received, `<RateLimitNudge>` does not render. Plain error
  message shown. Verified by component test.

- [x] **AC24 — `rate_limit_nudge_shown` and `rate_limit_nudge_clicked` events fire:**
  `<RateLimitNudge>` fires `trackEvent('rate_limit_nudge_shown')` on mount and
  `trackEvent('rate_limit_nudge_clicked')` when the CTA is clicked. Verified by component test.

### Frontend — Funnel instrumentation

- [x] **AC25 — `query_sent` / `query_success` include `authenticated` boolean:**
  `trackEvent('query_sent', { authenticated: true })` when user is logged in;
  `trackEvent('query_sent', { authenticated: false })` when not. Verified by component test
  checking `trackEvent` call arguments.

### Backend — Usage endpoint (`GET /me/usage`)

- [x] **AC26 — Returns used/limit/remaining for the 3 buckets:**
  A bearer request returns `data.buckets.{queries,photos,voice}` where `used` = the Redis counter
  value, `limit` = `DAILY_LIMITS_BY_TIER[tier][bucket]`, `remaining = max(0, limit − used)`, plus
  `tier` + `resetAt`. Verified by integration test: seed `actor:limit:<actorId>:<today>:queries`=12
  → response `queries: { used: 12, limit: 100, remaining: 88 }` (free tier).

- [x] **AC27 — Read-only: does NOT consume quota:**
  Calling `GET /me/usage` N times does not increment any `actor:limit:*` counter (reads via `GET`).
  Endpoint is absent from `ROUTE_BUCKET_MAP`. Verified by integration test asserting counter
  unchanged after repeated calls.

- [x] **AC28 — Requires a valid bearer (401 otherwise):**
  No/invalid/expired bearer → 401 (same precedence as `/me`, ADR-025 R3 §5). Verified by test.

- [x] **AC29 — admin → unbounded; absent counter → used 0:**
  For `tier = admin`, each bucket returns `limit: null, remaining: null`. A bucket with no Redis
  key returns `used: 0`. Verified by unit test.

### Frontend — Usage meter

- [x] **AC30 — `<UsageMeter>` renders used/limit per bucket for logged-in user:**
  With `user !== null` and `getUsage` mocked, the header shows consultas/fotos/voz as `used/limit`
  (e.g. "12/100", "3/20", "5/30"). Verified by component test (RTL).

- [x] **AC31 — `<UsageMeter>` NOT shown for anonymous:**
  With `user === null`, no meter renders (`<LoginCta>` shown instead). `getUsage` is not called.
  Verified by component test.

- [x] **AC32 — Meter refreshes after a successful query:**
  After a `query_success` (and photo/voice success), `<UsageMeter>` re-fetches `GET /me/usage`
  (or updates) so the displayed count reflects the new usage. Verified by component test with
  `apiClient` mocked (getUsage called again after success).

- [x] **AC33 — `usage_meter_shown` event fires on mount:**
  `trackEvent('usage_meter_shown')` is called once when `<UsageMeter>` mounts. Verified by test.

- [x] **AC34 — Meter degrades gracefully on fetch failure:**
  When `getUsage` rejects (e.g. usage endpoint degraded), `<UsageMeter>` renders nothing / a muted
  "—" and does NOT throw or block `/hablar`. Verified by component test with `getUsage` rejecting.

### Operator / post-deploy smoke tests (manual)

- [ ] **AC35 — Smoke: anonymous → 50 query limit, free → 100 query limit (post-deploy):**
  Operator verifies via Redis inspection or manual queries that an anonymous actor hits 429
  at 50 queries and an authenticated actor hits 429 at 100 queries.

- [ ] **AC36 — Smoke: `actors.account_id` set after bearer request (post-deploy):**
  After a bearer-authenticated `POST /conversation/message`, the actor row's `account_id`
  is non-null in the DB. Verify: `SELECT account_id FROM actors WHERE id = '<actorId>'`.

- [ ] **AC37 — Smoke: usage meter live (post-deploy):**
  Logged-in user on `/hablar` sees the usage meter with correct counts; after sending a query,
  the consultas count increments by 1 on refresh.

---

## Definition of Done

- [x] All acceptance criteria met _(34/37 automated met; AC35–AC37 are operator post-deploy smokes)_
- [x] Unit tests written and passing _(api 4613→4643 +30 (Step 3); api 4661→4666 +5 (Step 5 fix: photo-tier integration + E14 unit + QA edge-cases); web 576→617 +41)_
- [x] E2E tests updated (if applicable) _(N/A — covered by integration + RTL component tests)_
- [x] Code follows project standards
- [x] No linting errors _(api + web lint clean)_
- [x] Build succeeds _(api tsc + web Next build clean)_
- [x] Specs reflect final implementation _(api-spec.yaml, ui-components.md, design-guidelines W9–W14, shared schemas)_

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` + `frontend-planner` executed, plan approved
- [x] Step 3: `backend-developer` + `frontend-developer` executed with TDD
- [x] Step 4: `production-code-validator` executed, quality gates pass
- [x] Step 5: `code-review-specialist` executed
- [x] Step 5: `qa-engineer` executed (Standard/Complex)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-05-25 | Step 1 (Setup) | Branch `feature/F-WEB-TIER-registration-value` off develop@b88f617. Ticket skeleton created. Complexity: Standard (fullstack, encuadre combinado tier+CTA per owner). Resumed via PM orchestrator `continue pm` (session pm-profiles). |
| 2026-05-25 | Step 0 (Spec) | `spec-creator` executed. Spec sections completed (Description, API Changes, Data Model, UI Changes, Edge Cases). 27 ACs defined. `api-spec.yaml`, `ui-components.md`, `shared/src/schemas/auth.ts` updated. 4 design forks documented (D1–D4). |
| 2026-05-25 | Step 0 (Spec review) | `/review-spec` cross-model (Gemini + Codex, both empirical). **Both REVISE.** 6 findings, all addressed: **F1** (Gemini CRITICAL + Codex IMPORTANT) `AccountSchema.tier` required→`.optional()` (deploy-skew resilience; api-dev manual deploy); **F2** (Codex IMP) `accountId`=JWT `sub`=`auth_user_id`, lookup/cache keyed by sub; **F3** (Codex IMP) fail-open contradiction → `free` everywhere; **F4** (Gemini IMP) DRY anti-hijack into shared `linkActorToAccount` helper used by `/me`+resolver; **F5** (Codex SUG) tier resolution moved to `actorRateLimit` (resolver = identity+linking only); **F6** (Gemini SUG) dynamic 429 message from `details.limit`/`tier`. shared typecheck clean + f107a.authSchemas 20/20 green post-edit. |
| 2026-05-26 | Step 0 (Spec scope +) | **Owner added scope:** usage meter for logged-in users (consultas/fotos/voz used/limit). Added: `GET /me/usage` read-only endpoint (reads rate-limit Redis counters via GET, absent from ROUTE_BUCKET_MAP → no quota consumption) + `<UsageMeter>` component (logged-in only; logged-out keeps `<LoginCta>`). Spec extended (Description item 7, API, UI hierarchy, Edge E12–E15, ACs AC26–AC34; **37 ACs total**). `spec-creator` updated `api-spec.yaml` (path + UsageBucket/UsageData/UsageApiResponse) + `ui-components.md` (UsageMeter) + `shared/src/schemas/auth.ts` (UsageBucketSchema/UsageResponseSchema). shared typecheck + 20/20 green; our YAML additions unique (pre-existing `/calculate/recipe` dup-key on develop noted, out of scope). |
| 2026-05-26 | Step 0 (Design) | `ui-ux-designer` ran (owner request) for `<LoginCta>` placement + `<UsageMeter>`. Notes W9–W14 in `design-guidelines.md`: header auth-slot dichotomy (logged-out→LoginCta; logged-in→UsageMeter+UserMenu, `ml-auto` wrapper, empty during authLoading=no layout shift); LoginCta=ghost/text button (orange primary withheld for the 429 nudge); UsageMeter=inline counters ≥sm / icon+popover on mobile; low/critical via colour+weight+suffix (not colour alone). 3 open owner questions: bucket-label abbreviation, resetAt display (UTC vs "mañana" vs local), low/critical thresholds (60%/80%). |
| 2026-05-26 | Step 0→2 (Spec APPROVED) | **Owner approved Spec + design at checkpoint → proceed to Step 2 (Plan).** Forks D1–D4 approved as recommended (tier column / resolver-side linking / Redis cache / photo Option A forward-bearer). Design defaults accepted (labels Consultas/Fotos/Voz, thresholds 60/80%). **resetAt rendered as "mañana" (no time)** — owner decision. Status → Planning; Workflow Step 1 [x]. |
| 2026-05-26 | Step 2→3 (Plan APPROVED) | **Owner approved the Plan at checkpoint → proceed to Step 3 (Implement).** Backend first (TDD), then frontend. Status → In Progress; Workflow Step 2 [x]. |
| 2026-05-26 | Step 2 (Plan + review) | `backend-planner` (Option A) + `frontend-planner` wrote `### Backend Plan` + `### Frontend Plan`. Self-review clean (no stale resolver-linking refs; both have `Verification commands run`). `/review-plan` cross-model: **Gemini APPROVED**; **Codex REVISE — 3 IMPORTANT (all verified + fixed):** P-I1 `AuthProvider` must call `setAuthToken(access_token)` before `getMe()` (apiClient bearer singleton was set only by HablarShell → getMe would 401); P-I2 `<RateLimitNudge>` renders as sibling below `<ResultsArea>` (ErrorState has no slot — props `{message,onRetry}` only); P-I3 `GET /me/usage` resolves actorId via `resolveBearerActorId` fallback (don't 401 a valid bearer whose actorId is unset on resolver degrade — mirrors `/me`). Plan updated. |
| 2026-05-26 | Step 2 (provisioning fork) | **backend-planner surfaced a design gap (verified FK):** `actors.account_id` → `accounts.id` (app PK); the `accounts` row is created ONLY by `/me`; the web never calls `/me` → resolver-side linking would be a silent no-op + no account row for tier. **Owner decision: Option A** — `AuthProvider` calls `GET /me` on session establish (reuses F107a provisioning + safe-link verbatim; multi-device covered). **Resolver-side linking DROPPED** (D2 reversed); `actorResolver` write-path unchanged (BUG-PROD-013 clean). `resolveAccountTier` returns `free` for a verified bearer with no account row. Spec updated: Goal §2, E1–E4, internal contracts, AC6–AC10. backend-planner plan to be revised accordingly. |
| 2026-05-26 | Step 3 (backend, TDD) | `backend-developer` executed. **Test delta: 4613 → 4643 (+30 tests, 259 files).** Migration `20260526130000_add_account_tier` applied to local test DB + Supabase dev. Prisma client regenerated. New files: `lib/accountTier.ts`, `prisma/migrations/20260526130000_add_account_tier/migration.sql`, `__tests__/f-web-tier/fWebTier.resolveAccountTier.unit.test.ts` (9 tests), `__tests__/f-web-tier/fWebTier.actorRateLimit.tier.unit.test.ts` (12 tests), `__tests__/f-web-tier/fWebTier.usageEndpoint.integration.test.ts` (8 tests, integration). Modified: `actorRateLimit.ts` (3-way tier, export computeResetAt, prisma param, hasBearerAuth fail-open), `routes/auth.ts` (tier in /me response, redis param, GET /me/usage route), `app.ts` (prisma+redis wired), `prisma/schema.prisma` (AccountTier enum + accounts.tier). Extended: `f107a.authSchemas.test.ts` (+18 Zod schema tests), `f107a.authRoutes.integration.test.ts` (+AC15 tier test). **Gates:** test ✅, lint ✅, typecheck (api+shared+web) ✅, build ✅. Integration tests (`fWebTier.usageEndpoint`) ran locally (local Postgres 5433 + Redis 6380 available) — all 8 passed. **ACs satisfied: AC1–AC5, AC7–AC9, AC14–AC16, AC26–AC29.** AC6/AC10 backend regression covered (F107a existing tests stay green). `actorResolver.ts` UNCHANGED (Option A invariant). /me linking block UNCHANGED. |
| 2026-05-26 | Step 3 (frontend, TDD) | `frontend-developer` executed. **Test delta: 576 → 617 (+41 tests, 56 suites).** New files: `components/LoginCta.tsx`, `components/UsageMeter.tsx`, `components/RateLimitNudge.tsx`. Modified: `components/AuthProvider.tsx` (P-I1: setAuthToken before getMe, event discrimination SIGNED_IN/INITIAL_SESSION, account state), `components/HablarShell.tsx` (LoginCta+UsageMeter+RateLimitNudge wiring, P-I2 sibling nudge, dynamic 429 message, authenticated flag on trackEvent, usageRefreshRef), `lib/apiClient.ts` (sendPhotoAnalysis bearer, getMe, getUsage, MeEnvelope/UsageEnvelope), `lib/metrics.ts` (5 new MetricEvent values, authenticated+tier in MetricPayload), `app/api/analyze/route.ts` (Authorization forwarding). New tests: `__tests__/auth/apiClient.fWebTier.test.ts` (11), `__tests__/api/analyze.proxy.fWebTier.test.ts` (3), `__tests__/auth/AuthProvider.fWebTier.test.tsx` (7), `__tests__/components/LoginCta.test.tsx` (5), `__tests__/components/UsageMeter.test.tsx` (7), `__tests__/components/HablarShell.fWebTier.test.tsx` (8). Updated 9 existing test files with F-WEB-TIER mock set (next/navigation, LoginCta/UsageMeter/RateLimitNudge null mocks, getMe/getUsage in apiClient mock). Also fixed useAuth.test.tsx pre-existing getMe/fetch conflict by adding apiClient mock. **Gates:** test ✅ (617/617), lint ✅, typecheck ✅, build ✅. **ACs satisfied: AC6 (frontend), AC10–AC13, AC17–AC25, AC30–AC34.** |
| 2026-05-26 | Step 3 (finalize commit) | Committed the shared schema + spec/design docs that the api commit referenced but left uncommitted (`dd93d2a`) — `packages/shared/src/schemas/auth.ts` (AccountTier/Usage schemas), `api-spec.yaml`, `ui-components.md`, `design-guidelines.md`, tracking. Cross-workspace typecheck (shared/api/web/bot/scraper/landing) all clean — shared schema change has no ripple. Branch now complete + buildable (3 commits: a232c98, cc2b1c9, dd93d2a). |
| 2026-05-26 | Step 4 (Finalize) | `production-code-validator` → **APPROVE WITH MINOR.** All 9 critical invariants verified in the diff (actorResolver UNCHANGED; /me safe-link UNCHANGED; precedence; fail-open free; /me/usage read-only; tier optional; P-I1 setAuthToken-before-getMe; P-I2 nudge sibling; photo bearer forward). Gates re-run green: api 4643/4643, web 617/617, lint/typecheck/build clean. 34/37 automated ACs covered (AC35–37 operator). MINOR: DoD checkboxes (now [x]) + MCE table (Step 5). No blockers. DoD [x]; Workflow Step 4 [x]. |
| 2026-05-26 | Step 5 (Review + QA) | `code-review-specialist` → **APPROVE WITH MINOR**: auth core verified clean in the diff (actorResolver UNCHANGED, /me safe-link UNCHANGED, precedence, fail-open free, /me/usage read-only); **1 MAJOR** (photo-tier inert — API-key shadowed bearer) + 4 MINOR. `qa-engineer` → **PASS WITH FOLLOW-UPS**: all 34 automated ACs verified + 31 adversarial tests added (api 4643→4661, web 617→630, all green); **BUG-001 (LOW)** voice meter refresh. **Owner decision on MAJOR: Option A** (bearer wins over shared API key — ADR-025 R3 §5). All findings resolved in the two fix rows below. |
| 2026-05-26 | Step 5 fix — bearer-over-API-key precedence + photo-tier integration test + E14 unit + QA edge-case commit | **Code-review fix (Option A owner-approved).** Root cause: `actorRateLimit.ts` was API-key-first; the web proxy's shared `X-API-Key` took precedence over the bearer, so `resolveAccountTier` was never called for `/analyze/menu` → free accounts got anonymous/shared-key photo limits (feature goal #3 / research §H3 unmet). **Fix:** inverted precedence to bearer-first: `if (hasBearerAuth) → resolveAccountTier; else if (hasApiKey) → key tier; else → 'anonymous'`. ADR-025 R3 §5 + fork D4 alignment. **Unit test updated:** `fWebTier.actorRateLimit.tier.unit.test.ts` — replaced "apiKeyContext present → resolveAccountTier NOT called" (was wrong after bearer-first) with two cases: (a) apiKeyContext + accountId → bearer wins, resolveAccountTier IS called; (b) apiKeyContext + no accountId → key tier used, resolveAccountTier NOT called. **New integration test:** `fWebTier.photoTier.integration.test.ts` (3 tests) — free bearer + /analyze/menu: 21st photo → 429 with `tier:free,limit:20`; 20th allowed; anonymous contrast 11th → 429 with `tier:anonymous,limit:10`. **E14 direct unit test:** `fWebTier.usageE14.unit.test.ts` (1 test) — redis.get rejects → 200 with used:0 (no 500). **QA edge-case file committed:** `fWebTier.edge-cases.unit.test.ts` (18 tests, written by qa-engineer, previously untracked). **Impact on other routes:** `/conversation/message` and `/conversation/audio` are bearer-only (no shared X-API-Key) → behavior unchanged. `/estimate` likewise. Only `/analyze/menu` (bearer + shared key) changes: authed users now get account tier. **Test delta: 4661 → 4666 (+5 tests, 260 → 262 files).** Gates: test ✅, lint ✅, typecheck ✅, build ✅. |
| 2026-05-26 | Step 5 (frontend fix) — BUG-001 voice usage-meter refresh + 429 grammar + QA edge-case tests | **Two QA/code-review fixes applied with TDD.** (1) **BUG-001 (qa, LOW):** `HablarShell.tsx` voice-success `useEffect` (`voiceSession.state === 'done'`) was missing `usageRefreshRef.current?.()` — the meter was refreshed after query/photo success but NOT after voice success. Added the call after `trackEvent('voice_success')` to mirror the query/photo paths. New test in `HablarShell.fWebTier.test.tsx` (BUG-001 describe block): renders with logged-in user + idle voice, injects a refreshSpy into `usageRefreshRef` via `capturedOnRefreshReady`, rerenders with `state='done'`, asserts spy called once. (2) **MINOR — 429 grammar when `limit` is null:** `setError` interpolation was `"…límite diario${limitStr} consultas…"` which produced "…límite diario consultas…" (missing "de"). Fixed to `"…límite diario de ${limitStr}consultas…"` — with limit: "…de 50 consultas…"; without limit: "…de consultas…". Updated `fWebTier.edge-cases.test.tsx` assertions (two tests) from `/límite diario consultas/i` to `/límite diario de consultas/i`. (3) **QA edge-case file committed:** `fWebTier.edge-cases.test.tsx` (previously untracked, 13 tests, written by qa-engineer). **Web test delta: 630 → 631 (+1 test, 57 suites).** Gates: test ✅ (631/631), lint ✅, typecheck ✅, build ✅. |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | All 7 sections present: Spec, Implementation Plan, Acceptance Criteria, Definition of Done, Workflow Checklist, Completion Log, Merge Checklist Evidence |
| 1. Mark all items | [x] | AC: 34/37 (AC35–AC37 = operator post-deploy smokes, intentionally deferred); DoD: 7/7; Workflow: Steps 0–5 [x], Step 6 [ ] (pending merge). Status → Ready for Merge |
| 2. Verify product tracker | [x] | Active Session → Step 5/6 (Review), `Ready for Merge`, branch + 5 commits noted; pm-session.md synced |
| 3. Update key_facts.md | [x] | Added "Account tier resolution (F-WEB-TIER)" bullet (accounts.tier + AccountTier enum + resolveAccountTier + bearer-first precedence + GET /me/usage + Option A provisioning + LoginCta/UsageMeter/RateLimitNudge + tier-optional deploy-skew); `computeResetAt` export noted on the actorRateLimit bullet |
| 4. Update decisions.md | [x] | **ADR-027** added (Option A `/me`-on-login provisioning + bearer-over-API-key tier precedence; reuses ADR-025 R3 §5) |
| 5. Commit documentation | [x] | Docs committed in the merge-checklist `docs:` commit (this step); feature commits `a232c98` (backend) · `cc2b1c9` (frontend) · `dd93d2a` (shared/specs) · `1f6c75f` (bearer-over-key fix) · `004a0a1` (voice/grammar fix) |
| 6. Verify clean working tree | [x] | `git status` clean after the docs commit |
| 7. Verify branch up to date | [x] | `git merge-base --is-ancestor origin/develop HEAD` → UP TO DATE (develop `b88f617` is ancestor; no merge needed) |
| 8. /audit-merge | [x] | Run 2026-05-26 vs PR #294. **Structural 0–11 PASS**: Status `Ready for Merge`; AC 34/37 (AC35–37 operator deferred); DoD 7/7; Workflow 0–5 [x], Step 6 [ ]; MCE all [x]; 16 Completion Log rows; tracker Active Session 5/6; key_facts updated; merge-base UP TO DATE; tree clean; no JSON seed files in diff. **Drift**: P1 PR ratios ⊆ ticket (4613→4666, 576→631) OK; P6 AC claim 34/37 = actual OK; **P11 N/A** (no false drift — Features row added, status `in-progress` matches Ready-for-Merge); **P16 RESOLVED** (added `F-WEB-TIER` row to Features table). CI: `ci-success`=SUCCESS, `test-shared`=SUCCESS, mergeState=CLEAN after re-run of the known flake `BUG-DEV-SHARED-WEBMETRICS-BOUNDARY-FLAKE-001` (P3, unrelated to diff). |

---

*Ticket created: 2026-05-25*
