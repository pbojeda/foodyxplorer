# F107a: Auth core (Supabase Auth — web)

**Feature:** F107a | **Type:** Fullstack-Feature | **Priority:** High
**Status:** Spec | **Branch:** feature/F107a-auth-core
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-05-14 | **Dependencies:** ADR-025 R3 (Supabase Auth selected) ✓ ACCEPTED; F069 actor identity ✓ DONE; F107b (account merge) — OUT OF SCOPE (separate ticket Batch 3)

---

## Spec

### Description

F107a implements Supabase Auth as the identity provider for nutriXplorer's web surface (`packages/web/`), ending the auth-free posture established by ADR-016. This is the foundational auth layer required by F098 (paywall/tier gates), F099 (user profiles — BMR/targets), and F107b (anonymous→authenticated actor merge — Batch 3).

Per **ADR-025 R3** (`docs/project_notes/decisions.md` line 831):
- **Scope: web only.** The Telegram bot is paused (ADR-026); bot auth is explicitly out of scope.
- **Provider:** Supabase Auth (GoTrue-backed), bundled with the existing Supabase PostgreSQL project.
- **Day-1 method (this ticket):** Email magic link **only**. Google OAuth deferred to **F107a-FU1** (Simple ~1h follow-up — pending Google Cloud Console project configuration). ADR-025 R3 §1 originally specced both providers; this is a scope-reduction decision taken at Step 0 Spec on 2026-05-14 due to operator not yet having a GCP project. F107a's core auth machinery (JWT verify, accounts table, actor.account_id FK, bearer precedence) is provider-agnostic — adding Google in F107a-FU1 is a UI button + provider arg, no migration changes.
- **Backend verification:** Fastify verifies Supabase-issued RS256 JWTs via JWKS using `jose`. No Supabase SDK on the API hot path.
- **Transport:** `Authorization: Bearer <jwt>` header. Cross-domain cookies remain deferred (ADR-025 R3 §4).
- **Strict bearer precedence** (ADR-025 R3 §5): absent → anonymous flow; present+valid → authenticated flow; present+invalid → **401 immediately** (never silent downgrade).

F107a does NOT implement actor→account merge logic (F107b) or RLS policies (F107b/F099) or Google OAuth (F107a-FU1). It is independently shippable: existing anonymous actors keep `account_id=NULL`; authenticated users get their actor linked on first `/me` hit.

---

### API Changes

| Method | Path | Status | Description |
|--------|------|--------|-------------|
| POST | `/auth/login` | **NEW** | Initiate email magic link. Body: `{ email, redirectTo }`. Returns 200 + `{ success: true }`. (Google OAuth provider deferred to F107a-FU1 — schema is forward-compatible: the request body is a discriminated union on `provider`, but only `provider: 'email'` is accepted in F107a; `provider: 'google'` returns 400 `PROVIDER_NOT_ENABLED`.) |
| GET | `/auth/callback` | **NEW (web-only)** | Handled by Supabase JS SDK in browser — documented in spec as `x-handled-by: web`, NOT a Fastify route. |
| POST | `/auth/logout` | **NEW** | Invalidate Supabase session. Returns 204. Requires `Authorization: Bearer`. |
| GET | `/me` | **NEW** | Return `{ account, actor }` for authenticated request. 401 if no/invalid bearer. |
| GET | `/estimate` | **UPDATED** | New behaviour: bearer present+valid → attach `accountId` to request context (AC11). Bearer present+invalid → 401, no anonymous fallback (AC12). Bearer absent → existing anonymous flow unchanged (AC13). |
| POST | `/conversation/message` | **UPDATED** | Same bearer precedence rule applies (AC12-AC13 pattern). |
| POST | `/conversation/audio` | **UPDATED** | Same bearer precedence rule applies. |

Full OpenAPI definitions in `docs/specs/api-spec.yaml` under paths `/auth/login`, `/auth/callback`, `/auth/logout`, `/me`.

**New error codes introduced:**
- `TOKEN_EXPIRED` — bearer present, JWT expired.
- `INVALID_TOKEN` — bearer present, JWT signature invalid or malformed.
- `AUTH_PROVIDER_UNAVAILABLE` — JWKS fetch failed (Supabase outage). Returns 503 + `Retry-After` header.

---

### Data Model Changes

Three Prisma migrations, split into three logically-ordered files.

#### Migration 1: `XX_create_accounts.sql`

New table `public.accounts` (ADR-025 R3 §3):

```
id                    UUID PK default gen_random_uuid()
auth_user_id          UUID UNIQUE NOT NULL  -- logical ref to auth.users(id); no hard FK to managed schema
email                 VARCHAR(255) NOT NULL
created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT now()
consent_marketing     BOOLEAN NOT NULL DEFAULT false
consent_marketing_at  TIMESTAMPTZ NULL      -- RGPD timestamp
consent_analytics     BOOLEAN NOT NULL DEFAULT false
consent_analytics_at  TIMESTAMPTZ NULL      -- RGPD timestamp
```

Indexes:
- `auth_user_id`: already UNIQUE (covered by unique constraint).
- `email`: non-unique B-tree index (for reconciliation queries).

Note: `billing_customer_id` (for F098/Stripe) is NOT added now — added in F098 spec time.

#### Migration 2: `YY_add_actor_account_id.sql`

New column on `public.actors`:

```
account_id   UUID NULL  FK → public.accounts(id) ON DELETE SET NULL
```

Indexes:
- Non-unique B-tree index on `account_id` (ADR-025 R3 R2 Codex CRITICAL — multi-device intentionally allowed: N actors → 1 account; UNIQUE would break second-device login).

Existing `@@unique([type, externalId])` constraint on `actors` is unchanged.

`ActorType` enum values `telegram` and `authenticated` remain in the schema for backwards compatibility (dormant per ADR-026 and ADR-025 R3 §3 respectively — no new rows created with either).

#### Migration 3: `ZZ_create_profiles_empty.sql`

New table `public.profiles` (empty placeholder for F099 — ADR-025 R3 §3):

```
id          UUID PK  = account_id (same UUID)
account_id  UUID UNIQUE NOT NULL  FK → public.accounts(id) ON DELETE CASCADE
```

No other columns. This table is a clean migration target for F099 (body/health RGPD Art. 9 fields). Empty now; no Prisma model accessors needed until F099.

#### Prisma model changes

`Actor` model — add field:
```prisma
accountId  String?  @map("account_id") @db.Uuid
account    Account? @relation(fields: [accountId], references: [id], onDelete: SetNull)

@@index([accountId])
```

New `Account` model:
```prisma
model Account {
  id                  String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  authUserId          String   @unique @map("auth_user_id") @db.Uuid
  email               String   @db.VarChar(255)
  createdAt           DateTime @default(now()) @map("created_at") @db.Timestamptz
  lastSeenAt          DateTime @default(now()) @map("last_seen_at") @db.Timestamptz
  consentMarketing    Boolean  @default(false) @map("consent_marketing")
  consentMarketingAt  DateTime? @map("consent_marketing_at") @db.Timestamptz
  consentAnalytics    Boolean  @default(false) @map("consent_analytics")
  consentAnalyticsAt  DateTime? @map("consent_analytics_at") @db.Timestamptz

  actors Actor[]

  @@index([email])
  @@map("accounts")
}
```

Kysely types regenerated after migrations (`prisma-kysely` generator — see `key_facts.md` Prisma vs Kysely Rule).

#### Zod schemas

New file `packages/shared/src/schemas/auth.ts` — exported from `packages/shared/src/index.ts`:

- `AccountSchema` — full shape of `public.accounts` row.
- `ActorSummarySchema` — actor info embedded in MeResponse.
- `MeResponseSchema` — `{ account: Account, actor: ActorSummary }`.
- `LoginRequestSchema` — discriminated union `{ provider: 'email', email, redirectTo } | { provider: 'google', redirectTo }`.
- `LoginResponseSchema` — discriminated union on `provider`.

---

### UI Changes

New components in `packages/web/`. Full prop/state/interaction specs in `docs/specs/ui-components.md` under "Web Package — F107a Auth core".

| Component | Type | Route/File | Description |
|-----------|------|------------|-------------|
| `AuthProvider` | Layout (Client) | `src/components/AuthProvider.tsx` | Wraps all routes; creates Supabase browser client; provides session context. |
| `useAuth()` | Hook (Client) | `src/hooks/useAuth.ts` | Returns `{ user, session, loading, error, signIn, signOut }`. |
| `LoginPage` | Page (Client) | `src/app/login/page.tsx` | Email `<input type="email">` + "Entrar con email" submit button. Success state: form replaced by "Revisa tu correo" message. Error: inline. (Google OAuth button deferred to F107a-FU1.) |
| `AuthCallbackPage` | Route Handler (Server) | `src/app/auth/callback/route.ts` | PKCE code exchange via `supabase.auth.exchangeCodeForSession()`. Redirects to `/hablar` on success, `/login?error=callback_failed` on failure. Same handler will service Google OAuth in F107a-FU1 with no changes. |
| `UserMenu` | Feature (Client) | `src/components/UserMenu.tsx` | Avatar dropdown in header. Shows email + "Cerrar sesión" button. Only rendered when `user !== null`. |
| `HablarShell` (updated) | Feature (Client) | existing | Reads `useAuth().session?.access_token`; attaches `Authorization: Bearer` on all API calls. `X-Actor-Id` still sent. |
| `apiClient.ts` (updated) | Library | existing | New `setAuthToken(token)` export. All send functions attach bearer when token is set. |

New env vars:
- Web (client): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- API (server): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (used by `POST /auth/logout` to invalidate sessions via Supabase admin SDK), `SUPABASE_JWKS_URL` (RS256 verification path).
- **NOT consumed by code:** `SUPABASE_JWT_SECRET` (HS256 shared secret). Documented in the operator runbook for emergency manual verification only — the API ONLY uses RS256+JWKS per ADR-025 R3 §2. There is NO automatic fallback to HS256.

---

### Edge Cases & Error Handling

All edge cases reference **ADR-025 R3 §5** (strict bearer precedence) unless noted.

| Scenario | Behaviour |
|----------|-----------|
| Bearer absent | Fall through to existing F069 `actorResolver` anonymous flow. No change to current behaviour. |
| Bearer present + JWT valid | Authenticated flow: resolve `accounts` row from JWT `sub` → attach `accountId` to request context. `X-Actor-Id` observed as merge seam target only. |
| Bearer present + JWT expired | **401 immediately**, code `TOKEN_EXPIRED`. Web client auto-refreshes via Supabase SDK and retries once. |
| Bearer present + JWT signature invalid or malformed | **401 immediately**, code `INVALID_TOKEN`. No silent anonymous fallback — a present-but-invalid token is a client error, not a downgrade signal. |
| JWKS fetch fails (Supabase outage) | **503** with `Retry-After` header. Do NOT fail-open. JWT verification is required for all authenticated paths. |
| First `/me` hit for a new auth user (no `accounts` row yet) | Upsert `accounts` row by `auth_user_id` (idempotent under concurrency — UNIQUE constraint on `auth_user_id` protects against races). Then set `actors.account_id`. Return 200. |
| Orphan: `auth.users` has row but `accounts` missing (incomplete prior migration) | Reconcile on first `/me` hit: create `accounts` row. Same upsert path as first login. |
| Same auth user on second device (second anonymous actor hits `/me`) | Existing `accounts` row found by `auth_user_id` → second actor's `account_id` set to same account. Both actors coexist. No uniqueness conflict (`actors.account_id` is non-unique). |
| Actor's stored `account_id` ≠ current bearer's account (identity collision) | Log warning. Bearer wins — return bearer's account. Do NOT auto-merge. Merge is F107b scope. |
| Race: two devices both hit `/me` for the first time simultaneously | `accounts` upsert is idempotent (UNIQUE on `auth_user_id`). One INSERT wins; the other sees the existing row. Both succeed — no 500. |
| Magic link expired | Supabase redirects to `/auth/callback?error=...`. Route handler redirects to `/login?error=callback_failed`. LoginPage shows "El enlace ha expirado — inténtalo de nuevo." |
| `POST /auth/logout` called; in-flight requests still carry old JWT | Supabase session invalidation is async (<1s propagation delay). After 204, the web client MUST immediately clear local session state regardless. Brief window of stale JWT accepted (bounded by access token TTL — default 1h). |
| `POST /auth/login` with `{ provider: 'google' }` (provider not yet enabled in F107a) | Returns HTTP 400 + `code: 'PROVIDER_NOT_ENABLED'`. F107a-FU1 will enable this branch by adding Google OAuth provider + GCP client config. Forward-compatible schema; no breaking change. |
| Cross-provider email collision (future — when F107a-FU1 adds Google) | GoTrue handles in `auth.identities` (multi-provider linking to same `auth.users.id`). Documented here for completeness; not exercised by F107a. |

---

## Implementation Plan

_Pending — to be generated by the planner agent in Step 2._

---

## Acceptance Criteria

### Database (Migrations)

- [ ] **AC1** — `public.accounts` table exists with columns: `id UUID PK`, `auth_user_id UUID UNIQUE NOT NULL`, `email VARCHAR(255) NOT NULL`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `consent_marketing BOOLEAN NOT NULL DEFAULT false`, `consent_marketing_at TIMESTAMPTZ NULL`, `consent_analytics BOOLEAN NOT NULL DEFAULT false`, `consent_analytics_at TIMESTAMPTZ NULL`. Verified by migration inspection + integration test asserting table shape.
- [ ] **AC2** — `public.actors.account_id` column exists, type UUID, nullable by default, non-unique B-tree index present, FK to `public.accounts(id)` ON DELETE SET NULL. Verified by migration inspection + integration test querying `information_schema.columns` and `pg_indexes`.
- [ ] **AC3** — `public.profiles` table exists with exactly two columns: `id UUID PK` and `account_id UUID UNIQUE NOT NULL FK → accounts(id) ON DELETE CASCADE`. No other columns. Verified by migration inspection.

### API — Auth endpoints

- [ ] **AC4** — `POST /auth/login` with `{ provider: 'email', email: 'test@example.com', redirectTo: '...' }` returns HTTP 200 + `{ success: true, data: { provider: 'email', success: true } }`. Supabase Auth client mocked to return success. Tested in `packages/api` integration tests.
- [ ] **AC5** — `POST /auth/login` with `{ provider: 'google', redirectTo: '...' }` returns HTTP 400 + `code: 'PROVIDER_NOT_ENABLED'`. Forward-compatible schema, but Google provider deferred to F107a-FU1. The Zod discriminated union accepts `provider: 'google'` at the request schema layer; the handler explicitly rejects it.
- [ ] **AC6** — `POST /auth/logout` with valid bearer returns HTTP 204. Supabase `signOut()` mocked. Subsequent requests with the same JWT in the test window still pass bearer verification (server-side session invalidation is async — documented in API spec).
- [ ] **AC7** — `GET /me` with valid bearer returns HTTP 200 + correct `MeResponse` shape: `{ success: true, data: { account: { id, authUserId, email, ... }, actor: { id, type, externalId, accountId } } }`.
- [ ] **AC8** — `GET /me` without `Authorization` header returns HTTP 401 with `code: 'UNAUTHORIZED'`. `/me` is auth-gated — anonymous flow does NOT apply.
- [ ] **AC9** — `GET /me` with `Authorization: Bearer invalid.jwt.here` returns HTTP 401 with `code: 'INVALID_TOKEN'`. No silent fallback to anonymous.
- [ ] **AC10** — `GET /me` with a validly-signed but expired JWT returns HTTP 401 with `code: 'TOKEN_EXPIRED'`. Verified by constructing a JWT with `exp` in the past.

### API — Bearer precedence on existing endpoints (ADR-025 R3 §5)

- [ ] **AC11** — `GET /estimate?query=arroz` with valid bearer returns HTTP 200 and `request.accountId` is set to the resolved account's UUID (verified via mock/spy in test).
- [ ] **AC12** — `GET /estimate?query=arroz` with `Authorization: Bearer invalid.jwt` returns HTTP 401. Does NOT fall through to anonymous resolution.
- [ ] **AC13** — `GET /estimate?query=arroz` without `Authorization` header continues anonymous flow: returns HTTP 200, `request.actorId` resolved by existing F069 actorResolver. No regression.

### API — First-login account provisioning

- [ ] **AC14** — First `GET /me` hit for a new auth user (no `accounts` row in DB): creates `accounts` row, sets `actors.account_id` for the actor resolved from `X-Actor-Id`, returns 200. Call is idempotent under concurrency: second parallel request with same JWT either finds the just-created row or the DB UNIQUE constraint rejects the duplicate INSERT and the upsert path succeeds.
- [ ] **AC15** — Second device scenario: same `auth_user_id`, different anonymous actor, `GET /me` → existing `accounts` row is reused; second actor's `account_id` set to same account UUID; first actor's row unchanged. Both actors present in DB with same `account_id`. Verified via integration test with two distinct actors.
- [ ] **AC16** — JWKS fetch failure returns HTTP 503 with `Retry-After` header and `code: 'AUTH_PROVIDER_UNAVAILABLE'`. Verified by mocking the JWKS endpoint to return a network error.

### Web — Auth UI

- [ ] **AC17** — `/login` page renders: email `<input type="email">`, "Entrar con email" `<button>`. NO Google button rendered in F107a (deferred F107a-FU1). Verified by React Testing Library / Playwright snapshot — snapshot assertion explicitly checks that "Continuar con Google" is NOT present.
- [ ] **AC18** — After email submission, LoginPage transitions to success state: form replaced by message "Revisa tu correo — te hemos enviado un enlace de acceso" (per ADR-025 R3 §6 UX). `POST /auth/login` mocked to return `{ success: true }`.
- [ ] **AC19** — Email magic link E2E: click "Entrar con email" → API called → success state shown → user receives email → clicks link → `/auth/callback?code=<code>` → `exchangeCodeForSession` called → redirect to `/hablar` → `UserMenu` visible showing user email. Verified by Playwright E2E test (Supabase test project or mocked SDK — magic link consumed programmatically in test).
- [ ] **AC20** — `useAuth()` returns `{ user: null, loading: false }` before login and `{ user: User, loading: false, session: Session }` after `SIGNED_IN` event fires. Verified by rendering a test component that consumes the hook.
- [ ] **AC21** — Click "Cerrar sesión" in `UserMenu` → `POST /auth/logout` called → local session cleared → redirect to `/`. `UserMenu` no longer rendered. Verified by Playwright or React Testing Library integration test.
- [ ] **AC22** — Auth callback error handling: navigating to `/auth/callback?error=access_denied&error_description=...` → redirect to `/login?error=callback_failed` → LoginPage shows error "El enlace de acceso ha expirado o ha sido cancelado." Verified by Playwright.

### Forward compatibility (F107a-FU1)

- [ ] **AC25** — `LoginRequestSchema` discriminated union in `@foodxplorer/shared` accepts BOTH `provider: 'email'` AND `provider: 'google'` (schema parses both successfully). Adding Google support in F107a-FU1 requires NO schema migration — only handler branch + UI button. Verified by importing schema in test and asserting both shapes pass `safeParse`.

### Shared schemas

- [ ] **AC23** — `@foodxplorer/shared` exports `AccountSchema`, `ActorSummarySchema`, `MeResponseSchema`, `LoginRequestSchema`, `LoginResponseSchema`. Verified by importing in test file and asserting Zod schema parses valid + rejects invalid fixtures.

### Operator runbook

- [ ] **AC24** — `docs/operations/supabase-auth-setup.md` exists and covers: (a) Supabase project Auth setup — enable **Email** provider only (Google OAuth deferred to F107a-FU1 with its own runbook section appended later), configure allowed redirect URLs for `app.nutrixplorer.com/auth/callback` + `app-dev.nutrixplorer.com/auth/callback` + `localhost:3002/auth/callback`; (b) Render env var checklist for API: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (logout admin), `SUPABASE_JWKS_URL` (RS256 verification). `SUPABASE_JWT_SECRET` documented as operator-only / emergency manual tool — NOT consumed by API code (no HS256 fallback path); (c) Vercel env var checklist for web: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`; (d) Render cron job setup for `GET /health?db=true` daily (ADR-025 R3 §7 free-tier inactivity mitigation); (e) EU Frankfurt region confirmation; (f) Explicit F107a-FU1 placeholder section: "To enable Google OAuth: create GCP project, OAuth 2.0 client, authorize Supabase redirect URI, paste Client ID/Secret in Supabase Auth → Providers → Google → Enable." Verified manually by reviewer following the runbook from scratch.

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Unit tests written and passing
- [ ] E2E test (web login → API /me roundtrip) added
- [ ] Code follows project standards
- [ ] No linting errors
- [ ] Build succeeds
- [ ] Specs reflect final implementation
- [ ] ADR-025 R3 Decision §1-§9 traceable in code (cite ADR section in commit msgs and key code comments)
- [ ] Operator runbook updated (`docs/operations/`) with Supabase Auth project setup steps + Render env var checklist

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated
- [ ] Step 1: Branch created, ticket generated, tracker updated
- [ ] Step 2: `backend-planner` + `frontend-planner` executed, plan approved
- [ ] Step 3: `backend-developer` + `frontend-developer` executed with TDD
- [ ] Step 4: `production-code-validator` executed, quality gates pass
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 5: `qa-engineer` executed (Standard)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-05-14 | Step 1 Setup (scaffold) | Branch `feature/F107a-auth-core` created off `develop@5d81bf0`. Ticket scaffold with spec-creator brief. PM session `pm-auth-core` initialized. |
| 2026-05-14 | Step 0 Spec — drafted | 24 ACs. Files updated: `docs/specs/api-spec.yaml` (Auth tag + 4 paths + 8 schemas + BearerAuth security scheme), `docs/specs/ui-components.md` (F107a auth components section), `packages/shared/src/schemas/auth.ts` (NEW), `packages/shared/src/index.ts` (export added), `docs/tickets/F107a-auth-core-supabase.md` (Spec + ACs filled). ADR-025 R3 §1-§9 all traced. |
| 2026-05-14 | Step 0 Spec — user-driven scope adjustments | 4 architectural decisions resolved with user (recommended path on all 4): (a) /auth/logout API server-side with SERVICE_ROLE; (b) /auth/callback as Next.js Route Handler (web, not Fastify); (c) SUPABASE_JWT_SECRET runbook-only (no coded HS256 fallback); (d) public.profiles SQL-only migration (no Prisma model until F099). Scope-reduction: Google OAuth deferred to **F107a-FU1** (operator does not yet have GCP project) — F107a ships with Email magic link only. AC5/AC17/AC19 + Edge cases + AC24 runbook + api-spec.yaml /auth/login updated to reflect single-provider F107a. New AC25 added (forward-compat schema test). Total ACs: 25. |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | Sections verified: (list) |
| 1. Mark all items | [ ] | AC: _/_, DoD: _/_, Workflow: _/_ |
| 2. Verify product tracker | [ ] | Active Session: step _/6, Features table: _/6 |
| 3. Update key_facts.md | [ ] | Updated: (list) / N/A |
| 4. Update decisions.md | [ ] | ADR-XXX added / N/A |
| 5. Commit documentation | [ ] | Commit: (hash) |
| 6. Verify clean working tree | [ ] | `git status`: clean |
| 7. Verify branch up to date | [ ] | merge-base: up to date / merged origin/<branch> |

---

*Ticket created: 2026-05-14*
