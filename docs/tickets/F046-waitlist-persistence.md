# F046: Landing — Waitlist Persistence + Anti-Spam

**Feature:** F046 | **Type:** Fullstack-Feature | **Priority:** High
**Status:** In Progress | **Branch:** feature/F046-waitlist-persistence
**Created:** 2026-03-28 | **Dependencies:** F045 (done)

---

## Spec

### Description

Implement end-to-end waitlist lead persistence. Currently the landing's `/api/waitlist` endpoint validates emails/phones but discards the data (TODO comments). This feature:

1. **Creates a `waitlist_submissions` table** in PostgreSQL via Prisma migration
2. **Creates a `POST /waitlist` endpoint** in packages/api (Fastify) that persists leads
3. **Creates a `GET /admin/waitlist` endpoint** in packages/api (admin-authenticated) to list/export subscribers
4. **Adds anti-spam measures**: honeypot field + IP-based rate limiting on the API endpoint
5. **Connects the landing form** to the real API endpoint (replaces the local Next.js API route)

Per ADR-012, waitlist persistence lives in packages/api (Fastify), NOT in the landing's Next.js API route. The landing form will POST directly to the Fastify API.

### API Changes

#### `POST /waitlist` (public, no auth)

**Request body** (JSON):
```json
{
  "email": "user@example.com",
  "phone": "+34612345678",         // optional
  "variant": "a",                   // a|c|f
  "source": "hero",                 // hero|cta|footer|post-simulator
  "utm_source": "google",           // optional
  "utm_medium": "cpc",              // optional
  "utm_campaign": "launch-2026",    // optional
  "honeypot": ""                    // must be empty — anti-spam
}
```

**Response** (201 Created):
```json
{
  "success": true,
  "data": { "id": "uuid", "email": "user@example.com" }
}
```

**Error responses:**
- `400` — validation error (Zod)
- `409` — email already registered (duplicate, idempotent — returns existing record)
- `429` — rate limited (5 submissions per IP per 15 minutes)
- `422` — honeypot field not empty (spam detected, but return generic 400 to not reveal detection)

**Rate limiting:** Dedicated per-route rate limit: 5 requests per 15 minutes per IP. Separate from the global API rate limiter (which uses API keys). This endpoint is public — no API key required.

**Honeypot:** A hidden field `honeypot` that must be empty. Bots that auto-fill all fields will populate it. If non-empty, silently reject with a generic 400 (not 422, to avoid revealing the mechanism).

**Duplicate handling:** If the email already exists in `waitlist_submissions`, return 409 with the existing record. Do NOT create a duplicate. This makes the endpoint idempotent.

#### `GET /admin/waitlist` (admin auth required)

**Query params:**
- `limit` — number, default 50, max 200
- `offset` — number, default 0
- `sort` — `created_at_desc` (default) | `created_at_asc`

**Response** (200):
```json
{
  "success": true,
  "data": {
    "submissions": [
      {
        "id": "uuid",
        "email": "user@example.com",
        "phone": "+34612345678",
        "variant": "a",
        "source": "hero",
        "utm_source": "google",
        "utm_medium": null,
        "utm_campaign": null,
        "ip_address": "1.2.3.4",
        "created_at": "2026-03-28T12:00:00Z"
      }
    ],
    "total": 42,
    "limit": 50,
    "offset": 0
  }
}
```

**Auth:** Uses existing admin auth middleware (`ADMIN_API_KEY` header). Same pattern as other admin routes.

### Data Model Changes

#### New table: `waitlist_submissions`

```sql
CREATE TABLE waitlist_submissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  phone         TEXT,
  variant       TEXT NOT NULL DEFAULT 'a',
  source        TEXT NOT NULL DEFAULT 'hero',
  utm_source    TEXT,
  utm_medium    TEXT,
  utm_campaign  TEXT,
  ip_address    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT waitlist_submissions_email_unique UNIQUE (email),
  CONSTRAINT waitlist_submissions_email_check CHECK (email ~* '^[^@]+@[^@]+\.[^@]+$'),
  CONSTRAINT waitlist_submissions_variant_check CHECK (variant IN ('a', 'c', 'f'))
);

CREATE INDEX idx_waitlist_submissions_created_at ON waitlist_submissions (created_at DESC);
```

**Prisma model:**
```prisma
model WaitlistSubmission {
  id         String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  email      String   @unique
  phone      String?
  variant    String   @default("a")
  source     String   @default("hero")
  utmSource  String?  @map("utm_source")
  utmMedium  String?  @map("utm_medium")
  utmCampaign String? @map("utm_campaign")
  ipAddress  String?  @map("ip_address")
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz

  @@map("waitlist_submissions")
}
```

### UI Changes

#### Landing form updates (packages/landing)

1. **WaitlistForm.tsx**: Change the fetch URL from `/api/waitlist` to the Fastify API URL (via `NEXT_PUBLIC_API_URL` env var)
2. **Add honeypot field**: Hidden `<input>` with `tabindex="-1"` and `aria-hidden="true"`, visually hidden via CSS (NOT `display:none` — sophisticated bots detect that). Field name: `honeypot`. Send in the POST body.
3. **Add UTM params**: Read from URL search params and include in POST body
4. **Handle 409**: Show success message (email already registered is not an error for the user)
5. **Remove `/api/waitlist` route**: Delete `src/app/api/waitlist/route.ts` — no longer needed
6. **Progressive enhancement fallback**: The `action` attribute on the form should point to the Fastify API URL. Add a `<noscript>` warning or keep the redirect pattern via 303.

#### Environment variable

- `NEXT_PUBLIC_API_URL` — the Fastify API base URL (e.g., `https://api.nutrixplorer.com` in production, `http://localhost:3001` in dev)

### Edge Cases & Error Handling

- **Duplicate email**: Return 409 with existing record. User sees success message.
- **Honeypot filled**: Return generic 400 `"Invalid data"`. Do NOT reveal honeypot detection.
- **Rate limit hit**: Return 429 with `Retry-After` header.
- **DB connection failure**: Return 500. Fastify error handler catches Prisma errors.
- **Empty phone**: Stored as `null`, not empty string.
- **Phone normalization**: Strip whitespace before storing.
- **IP extraction**: Use `request.ip` (Fastify handles X-Forwarded-For via `trustProxy`).
- **CORS**: POST /waitlist must allow requests from `nutrixplorer.com` (and localhost in dev). Configure CORS for this route specifically if not already global.
- **Progressive enhancement**: When JS is disabled, the form POSTs as `application/x-www-form-urlencoded`. The Fastify endpoint should also accept this content type and redirect via 303 (same pattern as the current Next.js route).
- **Concurrent duplicates**: The UNIQUE constraint on email handles race conditions at the DB level. Catch the unique violation error and return 409.

---

## Implementation Plan

### Backend Implementation Plan

---

#### Existing Code to Reuse

- **`packages/api/src/plugins/adminPrefixes.ts`** — `ADMIN_PREFIXES` array and `isAdminRoute()`. Add `'/admin/'` to the array to gate all admin routes through the existing auth hook.
- **`packages/api/src/plugins/auth.ts`** — `registerAuthMiddleware` global `onRequest` hook. No changes needed; adding `/admin/` to `ADMIN_PREFIXES` is sufficient for the admin route to require auth. `/waitlist` (POST) is a public route — the hook already skips auth when no `X-API-Key` is present.
- **`packages/api/src/errors/errorHandler.ts`** — `mapError()` already handles `RATE_LIMIT_EXCEEDED` (429), `VALIDATION_ERROR` (400), `DUPLICATE_EMAIL` (409) pattern via code branching. Add `DUPLICATE_EMAIL` entry following the `DUPLICATE_RESTAURANT` pattern.
- **`packages/api/src/plugins/rateLimit.ts`** — The global rate limiter is already registered. Per-route override uses `config.rateLimit` in the route definition object (see `@fastify/rate-limit` per-route config pattern).
- **`packages/api/src/app.ts`** — `buildApp()` factory. Register `waitlistRoutes` following the existing pattern (`await app.register(waitlistRoutes, { prisma: prismaClient })`).
- **`packages/api/src/routes/estimate.ts`** / **`catalog.ts`** — Reference patterns for Fastify plugin structure: `FastifyPluginAsync<Options>`, `fastifyPlugin` wrapper, Zod schema on `schema.body` / `schema.querystring`, `reply.send({ success: true, data: ... })`.
- **`packages/shared/src/schemas/catalog.ts`** — Reference for pagination query schema pattern (`z.coerce.number().int().min(1).default(50)`).
- **`packages/shared/src/index.ts`** — Barrel file to extend with new waitlist schema exports.
- **`packages/api/prisma/schema.prisma`** — Extend with `WaitlistSubmission` model.
- **`packages/api/src/__tests__/f032.catalog.route.test.ts`** — Reference test pattern: hoisted mocks via `vi.hoisted()`, `buildApp().inject()`, Prisma mock structure.

---

#### Files to Create

**packages/shared/src/schemas/waitlist.ts**
New Zod schemas for the waitlist domain:
- `WaitlistSubmissionSchema` — full record shape (id, email, phone, variant, source, utmSource, utmMedium, utmCampaign, ipAddress, createdAt)
- `CreateWaitlistSubmissionSchema` — POST /waitlist body (email, phone?, variant, source, utm fields, honeypot)
- `AdminWaitlistQuerySchema` — GET /admin/waitlist query params (limit, offset, sort)

**packages/api/src/routes/waitlist.ts**
Fastify plugin implementing both routes:
- `POST /waitlist` — public, with per-route rate limit, form-urlencoded support, honeypot check, duplicate email handling
- `GET /admin/waitlist` — admin-gated, paginated list with total count using Prisma

**packages/api/prisma/migrations/20260328160000_waitlist_submissions_f046/migration.sql**
Hand-written migration SQL (never use `prisma migrate dev` — use `--create-only` then edit):
- `CREATE TABLE waitlist_submissions` with all columns, constraints, and index
- Timestamp `20260328160000` following the sequential pattern

**packages/api/src/__tests__/f046.waitlist.route.test.ts**
Route-level unit tests using `buildApp().inject()` with mocked Prisma and Redis.

**packages/api/src/__tests__/migration.f046.integration.test.ts**
Integration test against the real test DB to verify table structure, constraints, and index.

**packages/shared/src/__tests__/schemas.waitlist.test.ts**
Unit tests for all three Zod schemas.

---

#### Files to Modify

**packages/api/prisma/schema.prisma**
Add `WaitlistSubmission` model after existing models.

**packages/api/src/plugins/adminPrefixes.ts**
Add `'/admin/'` to the `ADMIN_PREFIXES` array. This single change routes all `GET /admin/*` URLs through the existing admin auth hook.

**packages/api/src/errors/errorHandler.ts**
Add `DUPLICATE_EMAIL` case in `mapError()` — maps to 409. Pattern: follow the `DUPLICATE_RESTAURANT` block.

**packages/api/src/app.ts**
Import and register `waitlistRoutes`. Placement: after `analyzeRoutes` at the bottom of the route registrations. Only `prisma` is needed (no Kysely — simple CRUD).

**packages/shared/src/index.ts**
Add `export * from './schemas/waitlist';` after the existing exports.

**docs/specs/api-spec.yaml**
Add `POST /waitlist` and `GET /admin/waitlist` endpoint definitions.

---

#### Implementation Order

Follow TDD: write the test first, then the implementation. Work layer by layer.

1. **Zod schemas** (`packages/shared/src/schemas/waitlist.ts`)
   - Write `schemas.waitlist.test.ts` first: test valid inputs, email validation, honeypot field presence, enum constraints (variant `a|c|f`, source `hero|cta|footer|post-simulator`), phone trimming (`.trim()`), optional UTM fields, AdminWaitlistQuerySchema defaults and coercions.
   - Implement the three schemas.
   - Export from `packages/shared/src/index.ts`.

2. **Prisma schema + migration** (`prisma/schema.prisma` + new migration)
   - Add `WaitlistSubmission` model to `schema.prisma` (spec provides the exact definition).
   - Run `prisma migrate dev --create-only --name waitlist_submissions_f046` to generate the migration stub.
   - Replace the generated SQL with the hand-written SQL from the spec (`CREATE TABLE`, `CONSTRAINT`, `CREATE INDEX`).
   - Apply with `prisma migrate deploy` against the test DB.
   - Write `migration.f046.integration.test.ts` first: verify table exists via `pg_tables`, unique constraint exists via `pg_indexes`, `created_at` index exists, email check constraint rejects invalid emails, variant check constraint rejects invalid values, concurrent insert of duplicate email raises unique violation.
   - Run the integration test to confirm the migration is correct.
   - Regenerate Prisma client (`prisma generate`) to expose `prisma.waitlistSubmission`.

3. **Error handler extension** (`packages/api/src/errors/errorHandler.ts`)
   - No test file needed — `errorHandler.test.ts` already exists; add a test case for `DUPLICATE_EMAIL` → 409.
   - Add `DUPLICATE_EMAIL` block in `mapError()` immediately after `DUPLICATE_RESTAURANT`.

4. **Admin prefix** (`packages/api/src/plugins/adminPrefixes.ts`)
   - Add `'/admin/'` to `ADMIN_PREFIXES`. No new test needed — `f026.adminAuth.unit.test.ts` covers `isAdminRoute()`; add assertions for `/admin/waitlist` returning `true`.

5. **Route plugin** (`packages/api/src/routes/waitlist.ts`)
   - Write `f046.waitlist.route.test.ts` first (see Testing Strategy below).
   - Implement `waitlistRoutesPlugin` as a `FastifyPluginAsync<{ prisma: PrismaClient }>`.
   - Wrap with `fastifyPlugin` and export as `waitlistRoutes`.
   - **POST /waitlist**:
     - Schema: `body: CreateWaitlistSubmissionSchema`.
     - Per-route rate limit via `config: { rateLimit: { max: 5, timeWindow: '15 minutes', keyGenerator: (req) => \`ip:${req.ip ?? 'unknown'}\`` } }` in the route options object (this overrides the global limit for this route only). Rate limiting is disabled in `NODE_ENV=test`, so the route's `config.rateLimit` block is present but never exercised in tests — no special handling needed.
     - `@fastify/formbody` plugin must be registered in `app.ts` to handle `application/x-www-form-urlencoded` bodies. Register it before the route plugins using `await app.register(formbody)` (add `@fastify/formbody` to `packages/api/package.json` dependencies).
     - Honeypot check: if `body.honeypot !== ''` and `body.honeypot !== undefined`, throw `Object.assign(new Error('Invalid data'), { code: 'VALIDATION_ERROR' })` — returns generic 400, does not reveal the mechanism. Check must happen before the DB write.
     - IP extraction: `request.ip` (Fastify resolves `X-Forwarded-For` when `trustProxy: true`). `trustProxy` must be added to `Fastify({ trustProxy: true, ... })` in `app.ts` — for all environments (currently omitted). Phone normalization: `.trim()` handled by Zod schema (use `.transform((v) => v?.trim() || null)` for optional phone to coerce empty string to null).
     - Prisma create with `prisma.waitlistSubmission.create(...)`. On `Prisma.PrismaClientKnownRequestError` with `code === 'P2002'` (unique constraint), query existing record with `prisma.waitlistSubmission.findUnique({ where: { email } })` and throw `Object.assign(new Error('Email already registered'), { code: 'DUPLICATE_EMAIL' })` — errorHandler maps this to 409.
     - Success: `reply.status(201).send({ success: true, data: { id, email } })`.
   - **GET /admin/waitlist**:
     - Schema: `querystring: AdminWaitlistQuerySchema`.
     - Admin auth is handled globally by `isAdminRoute()` — no preHandler needed in the route.
     - Use `Promise.all([prisma.waitlistSubmission.findMany(...), prisma.waitlistSubmission.count()])` for paginated list + total in one round-trip.
     - `sort` param: `created_at_desc` → `{ createdAt: 'desc' }`, `created_at_asc` → `{ createdAt: 'asc' }`.
     - Response shape matches the spec exactly.

6. **Register route in app.ts** (`packages/api/src/app.ts`)
   - Add import for `waitlistRoutes` and `formbody`.
   - Register `formbody` before the multipart plugin.
   - Register `waitlistRoutes` after `analyzeRoutes`.
   - Add `trustProxy: true` to all three `Fastify({...})` constructor calls (test, development, production).

7. **api-spec.yaml update** (`docs/specs/api-spec.yaml`)
   - Add `POST /waitlist` and `GET /admin/waitlist` with full request/response schemas.

---

#### Testing Strategy

**`packages/shared/src/__tests__/schemas.waitlist.test.ts`** (unit, no DB/network)

Write first. Key scenarios:
- `CreateWaitlistSubmissionSchema`: valid full body passes; invalid email fails; empty honeypot passes; non-empty honeypot passes schema (schema allows any string — the route handles the rejection); `variant` rejects values outside `a|c|f`; `source` rejects values outside the allowed enum; phone with surrounding whitespace is trimmed; missing optional fields default to undefined.
- `AdminWaitlistQuerySchema`: defaults apply (`limit=50`, `offset=0`, `sort='created_at_desc'`); limit coerced from string; limit above 200 fails; negative offset fails.
- `WaitlistSubmissionSchema`: full record with all fields validates; nullable fields accept null.

**`packages/api/src/__tests__/f046.waitlist.route.test.ts`** (route unit, mocked Prisma/Redis)

Write first. Use `buildApp().inject()` pattern from `f032.catalog.route.test.ts`.

Mocking strategy:
- `vi.mock('../lib/prisma.js')` — mock `prisma.waitlistSubmission.create`, `findUnique`, `findMany`, `count` via `vi.hoisted()`.
- `vi.mock('../lib/redis.js')` — mock `redis.get` / `redis.set` (needed by `registerAuthMiddleware`).
- `vi.mock('../estimation/level*.js')` — mock the estimation lookups (required by transitive imports in `buildApp()`).
- `vi.mock('../lib/kysely.js')` — mock `getKysely` (required by other route plugins registered in `buildApp()`).

Key test scenarios:

POST /waitlist happy path:
- Returns 201 with `{ success: true, data: { id, email } }` when Prisma create succeeds.
- Accepts `application/json` body.
- Accepts `application/x-www-form-urlencoded` body (inject with `headers: { 'content-type': 'application/x-www-form-urlencoded' }` and URL-encoded payload string).

POST /waitlist — honeypot:
- Returns 400 `VALIDATION_ERROR` when `honeypot` field is non-empty (e.g. `"honeypot": "bot@spam.com"`).
- Prisma create is NOT called when honeypot is filled.

POST /waitlist — duplicate email:
- Mock `prisma.waitlistSubmission.create` to throw `new Prisma.PrismaClientKnownRequestError('...', { code: 'P2002', clientVersion: '...' })`.
- Mock `prisma.waitlistSubmission.findUnique` to return the existing record.
- Expect 409 with `{ error: { code: 'DUPLICATE_EMAIL' } }`.

POST /waitlist — validation errors:
- Missing `email` → 400 `VALIDATION_ERROR`.
- Invalid email format → 400 `VALIDATION_ERROR`.
- Invalid `variant` value → 400 `VALIDATION_ERROR`.

GET /admin/waitlist happy path:
- Returns 200 with `{ success: true, data: { submissions: [...], total, limit, offset } }`.
- Default pagination: `limit=50`, `offset=0`.
- Sort `created_at_asc` passes correct `orderBy` to Prisma.

GET /admin/waitlist — validation errors:
- `limit=201` → 400 `VALIDATION_ERROR`.
- `sort=invalid_value` → 400 `VALIDATION_ERROR`.

GET /admin/waitlist — admin auth (in test env, auth is skipped when `ADMIN_API_KEY` is absent; this is the established pattern — no need to test auth here, it is covered in `f026.adminAuth.*.test.ts`).

**`packages/api/src/__tests__/migration.f046.integration.test.ts`** (integration, real test DB)

Write before applying the migration. Key scenarios:
- Table `waitlist_submissions` exists in `pg_tables`.
- Index `idx_waitlist_submissions_created_at` exists in `pg_indexes`.
- Unique constraint on `email` — inserting two rows with the same email raises `P2002`.
- Variant check constraint — `prisma.$executeRaw` with `variant = 'z'` raises a constraint violation.
- Email format check — `prisma.$executeRaw` with `email = 'notanemail'` raises a constraint violation.
- Inserting a valid row via `prisma.waitlistSubmission.create` succeeds and returns the created record.
- `ip_address` is nullable — null value accepted.

Pre-cleanup in `beforeAll`: `await prisma.waitlistSubmission.deleteMany()`.
`afterAll` teardown: `await prisma.waitlistSubmission.deleteMany()` + `await prisma.$disconnect()`.

---

#### Key Patterns

**Route plugin structure** — follow `packages/api/src/routes/health.ts` exactly:
```
const plugin: FastifyPluginAsync<Opts> = async (app, opts) => { ... }
export const waitlistRoutes = fastifyPlugin(plugin)
```

**Per-route rate limit** — set in the route options `config` object (not via `preHandler`):
```typescript
app.post('/waitlist', {
  config: {
    rateLimit: {
      max: 5,
      timeWindow: '15 minutes',
      keyGenerator: (req: FastifyRequest) => `ip:${req.ip ?? 'unknown'}`,
    },
  },
  schema: { body: CreateWaitlistSubmissionSchema },
}, handler)
```
This overrides the global max (30/anonymous) for this route only. The global `errorResponseBuilder` already formats 429 responses correctly — no additional handling needed.

**Form-urlencoded support** — requires `@fastify/formbody`. Register before route plugins in `app.ts`. After registration, Fastify automatically parses `application/x-www-form-urlencoded` bodies into `request.body` as a plain object, so the same Zod validation and handler logic applies to both content types. For progressive enhancement (non-JS form POST), the route should respond with 303 redirect on success when the `Accept` header does not include `application/json`. This is a minor enhancement: detect `!request.headers.accept?.includes('application/json')` and `reply.redirect(303, someSuccessUrl)`.

**trustProxy** — must be added to all three `Fastify({})` calls in `app.ts` to make `request.ip` correctly reflect the client IP behind a proxy (Render, Cloudflare). Without it, `request.ip` returns the proxy IP, not the real client IP, making IP-based rate limiting and IP storage meaningless.

**Prisma unique violation detection**:
```typescript
import { Prisma } from '@prisma/client'
// In catch:
if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') { ... }
```

**`DUPLICATE_EMAIL` error code** — throw as `Object.assign(new Error('...'), { code: 'DUPLICATE_EMAIL' })`. Add to `mapError()` in `errorHandler.ts` with `statusCode: 409`.

**Admin prefix addition** — `ADMIN_PREFIXES` is `as const`. When adding `/admin/`, change the declaration to `['/ingest/', '/quality/', '/embeddings/', '/analytics/', '/admin/'] as const`. The `isAdminRoute()` function loops over this array — no changes needed there.

**Gotcha: `bodyParser` ordering** — `@fastify/formbody` must be registered before `@fastify/multipart` in `app.ts`. Both parse body content; multipart is already registered. Registering formbody after multipart may cause conflicts.

**Gotcha: `honeypot` field in Zod schema** — include it in `CreateWaitlistSubmissionSchema` as `honeypot: z.string().optional()` so Fastify/Zod does not reject the field as unexpected when it arrives in the body. The route handler performs the business-level check (not the Zod schema) so the error returned is a generic 400 rather than a structured Zod validation error.

**Gotcha: migration timestamp** — next sequential timestamp after `20260325140000` is `20260328160000`. Verify no migration with that timestamp exists before creating.

**Gotcha: Prisma model regeneration** — after editing `schema.prisma`, run `prisma generate` to regenerate the client and Kysely types. The `waitlistSubmission` accessor on `PrismaClient` only becomes available after regeneration.

**Gotcha: `@fastify/formbody` package** — it is not yet in `packages/api/package.json`. Add it: `"@fastify/formbody": "^4.0.0"` (Fastify v5 compatible). Run `npm install` in the worktree root after adding it.

**Gotcha: `application/x-www-form-urlencoded` 303 redirect** — only implement the redirect if the `Accept` header clearly indicates a non-JSON client. The simplest heuristic: if `request.headers['accept']` does not contain `'application/json'` and `'application/json'` is absent. Keep it minimal — do not add new config or env vars for the redirect URL.

---

### Frontend Implementation Plan

---

#### Existing Code to Reuse

- **`packages/landing/src/components/features/WaitlistForm.tsx`** — the component being modified. Already has `'use client'` directive, `handleSubmit` with `fetch`, `status` state machine (`idle | loading | success | error`), `trackEvent` / `getUtmParams` imports, and inline email/phone Zod validation.
- **`packages/landing/src/lib/analytics.ts`** — `getUtmParams()` already extracts `utm_source`, `utm_medium`, `utm_campaign` from `window.location.search` and returns them as an object. Reuse directly in the fetch body — no changes to this file.
- **`packages/landing/src/types/index.ts`** — `WaitlistPayload` type exists but is narrow (missing `utm_*` and `honeypot`). Extend in place rather than creating a new type file.
- **`packages/landing/src/__tests__/WaitlistForm.test.tsx`** — existing test file with `mockFetch`, `successResponse()`, `errorResponse()` helpers and `jest.mock('@/lib/analytics')`. The updated tests live in this same file.
- **`packages/landing/jest.config.js`** — existing Jest + jsdom config. No changes needed.

---

#### Files to Create

None. All changes are modifications to existing files.

---

#### Files to Modify

**`packages/landing/src/types/index.ts`**
Extend `WaitlistPayload` to include the new fields sent to the Fastify API:
```
utm_source?: string;
utm_medium?: string;
utm_campaign?: string;
honeypot: string;
```
This keeps the type aligned with what `handleSubmit` now puts in the POST body.

**`packages/landing/src/components/features/WaitlistForm.tsx`**
Five targeted changes — no structural rewrites:
1. Change the `fetch` URL from `/api/waitlist` to `` `${process.env.NEXT_PUBLIC_API_URL}/waitlist` ``.
2. Add UTM params to the POST body by spreading the result of `getUtmParams()` (already called in analytics events — reuse the same call).
3. Add `honeypot: ''` (always empty string from state) to the POST body.
4. Treat a `409` response as success: change the response-handling condition from `if (response.ok)` to `if (response.ok || response.status === 409)`.
5. Update the `action` attribute on the `<form>` element from `/api/waitlist` to `` `${process.env.NEXT_PUBLIC_API_URL}/waitlist` ``.
6. Add the honeypot `<input>` element inside the `<form>`, immediately after the existing hidden `variant` input. It must be visually hidden with inline CSS (not `display:none`): `position:absolute; left:-9999px; opacity:0; height:0; width:0; overflow:hidden`. Attributes: `type="text"`, `name="honeypot"`, `tabIndex={-1}`, `aria-hidden="true"`, `autoComplete="off"`, `value=""` (uncontrolled — no state needed, always empty from the user's perspective; the browser fills `value=""` naturally).

**`packages/landing/src/__tests__/WaitlistForm.test.tsx`**
Update and extend — TDD approach: write new/changed tests first, then implement. Changes:
1. Update `mockFetch` URL assertion from `/api/waitlist` to `${NEXT_PUBLIC_API_URL}/waitlist` (or assert on the URL string if the test already captures the fetch call args).
2. Add `duplicateResponse()` helper (status 409, `ok: false`) alongside existing `successResponse()` / `errorResponse()`.
3. Add new test scenarios (detailed in Testing Strategy below).

**`packages/landing/src/app/api/waitlist/route.ts`**
Delete this file entirely. It is replaced by the Fastify API. No other landing file imports it (Next.js discovers it via file system routing).

---

#### Implementation Order

Follow TDD: write or update the test first for each change, then implement.

1. **Types** (`packages/landing/src/types/index.ts`)
   - Extend `WaitlistPayload` with `utm_source?`, `utm_medium?`, `utm_campaign?`, `honeypot`. No test needed — TypeScript catches mismatches at compile time.

2. **Test updates** (`packages/landing/src/__tests__/WaitlistForm.test.tsx`)
   - Add `duplicateResponse()` helper.
   - Write the new test cases listed in Testing Strategy before touching `WaitlistForm.tsx`.
   - Update the fetch URL assertion in the existing happy-path test.
   - Run `npm test -- --testPathPattern=WaitlistForm` — all new tests must fail at this point (red phase).

3. **Component implementation** (`packages/landing/src/components/features/WaitlistForm.tsx`)
   - Apply all six changes listed under Files to Modify.
   - Run the test suite again — all tests must pass (green phase).

4. **Delete the Next.js API route** (`packages/landing/src/app/api/waitlist/route.ts`)
   - Remove the file with `git rm`.
   - Run `npm run build` to confirm no import errors remain.

5. **Verify `page.test.tsx`** — no changes required. That file mocks all section components and never references `/api/waitlist` directly. Confirm the test still passes after step 4.

---

#### Testing Strategy

All tests live in `packages/landing/src/__tests__/WaitlistForm.test.tsx`. The test environment is Jest + jsdom. `fetch` is mocked via `global.fetch = mockFetch`.

**New helper to add:**
```
function duplicateResponse() {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status: 409,
    json: async () => ({ error: { code: 'DUPLICATE_EMAIL' } }),
  });
}
```

**New test scenarios to add:**

- `'treats 409 response as success (email already registered)'`
  — Call `duplicateResponse()`, submit a valid email, assert `screen.getByText(/apuntado/i)` is present. Confirm `waitlist_submit_success` analytics event was fired.

- `'posts to NEXT_PUBLIC_API_URL/waitlist, not /api/waitlist'`
  — Call `successResponse()`, submit a valid email, assert `mockFetch` was called with a URL containing `/waitlist` and NOT `/api/waitlist`. Use `expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/waitlist'), expect.any(Object))`.

- `'includes UTM params in POST body when present in analytics'`
  — Mock `getUtmParams` to return `{ utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'launch' }`. Submit a valid email. Assert the `body` arg passed to `mockFetch` (JSON-parsed) contains `utm_source: 'google'`, `utm_medium: 'cpc'`, `utm_campaign: 'launch'`.

- `'includes honeypot field with empty string in POST body'`
  — Call `successResponse()`, submit a valid email. Assert the parsed `body` passed to `mockFetch` contains `honeypot: ''`.

- `'honeypot input is present in the DOM and visually hidden'`
  — Render the form without submitting. Query `document.querySelector('input[name="honeypot"]')`. Assert it exists. Assert its `tabIndex` is `-1`. Assert its `aria-hidden` is `'true'`. (No assertion on the CSS inline styles — those are presentation-only and stable by construction.)

**Mocking strategy:**
- `fetch` — `global.fetch = mockFetch` (existing pattern, no change).
- `analytics` — `jest.mock('@/lib/analytics', ...)` (existing). For the UTM test, use `(analytics.getUtmParams as jest.MockedFunction<...>).mockReturnValue(...)` within the test, then restore with `mockReturnValue({})` in `afterEach` or `beforeEach`.
- `NEXT_PUBLIC_API_URL` env var — set via `process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001'` in a `beforeAll` block at the top of the describe. Next.js bakes `NEXT_PUBLIC_*` vars at build time but Jest reads `process.env` at runtime, so this is sufficient for test purposes.
- No router mocking required — the component does not use `useRouter` or `useSearchParams`.

---

#### Key Patterns

**Honeypot field CSS** — use inline `style` attribute, not a Tailwind class. Tailwind purges unused classes; an unusual combination like `absolute left-[-9999px] opacity-0 h-0 w-0 overflow-hidden` could be purged. Inline style is the reliable choice here:
```tsx
<input
  type="text"
  name="honeypot"
  tabIndex={-1}
  aria-hidden="true"
  autoComplete="off"
  value=""
  readOnly
  style={{ position: 'absolute', left: '-9999px', opacity: 0, height: 0, width: 0, overflow: 'hidden' }}
/>
```

**409-as-success pattern** — minimal change to the existing condition. Do NOT refactor the entire response handler; just widen the condition:
```tsx
// Before
if (response.ok) {
// After
if (response.ok || response.status === 409) {
```
The analytics `waitlist_submit_success` event fires for both 200/201 and 409 — that is intentional.

**UTM params in body** — `getUtmParams()` is already called in `handleFocus` and in the analytics events inside `handleSubmit`. Create one local variable at the top of `handleSubmit` and reuse it for both analytics and the fetch body:
```tsx
const utmParams = getUtmParams();
// ... analytics calls use ...utmParams
// fetch body uses: ...utmParams
```
This avoids calling `getUtmParams()` multiple times and keeps the code DRY.

**`NEXT_PUBLIC_API_URL` access** — use `process.env.NEXT_PUBLIC_API_URL` directly in the fetch call. Do not store it in a module-level constant — Next.js replaces `process.env.NEXT_PUBLIC_*` references statically at build time. A module-level `const API_URL = process.env.NEXT_PUBLIC_API_URL` works too, but direct inline usage is the safer pattern (avoids subtle tree-shaking issues with `undefined` constants).

**No new state needed for honeypot** — the honeypot input is `readOnly` with `value=""`. It is never user-edited and must always be empty in the body. There is no need for a `honeypot` React state variable.

**`page.test.tsx` is unaffected** — it mocks all section components and never references the deleted route. The deletion of `route.ts` is transparent to it.

**Gotcha: `action` attribute fallback URL** — the `action` attribute must be a valid absolute URL so native form POST (no JS) reaches the Fastify API. In the test environment `process.env.NEXT_PUBLIC_API_URL` is set to `'http://localhost:3001'`, so the rendered attribute will be `http://localhost:3001/waitlist`. In tests that render the form without submitting, assert on the `action` attribute value if needed, or simply skip that assertion (it is stable by construction).

**Gotcha: `getUtmParams` mock scope** — the `jest.mock('@/lib/analytics', ...)` at the top of the test file stubs `getUtmParams` to return `{}` by default. For the UTM test, override with `(analytics.getUtmParams as jest.MockedFunction<typeof analytics.getUtmParams>).mockReturnValueOnce(...)` so the override only applies to that one test and does not bleed into others.

**Gotcha: test file uses `jest.*` APIs (not `vi.*`)** — the landing test suite runs under Jest, not Vitest. All mocking uses `jest.fn()`, `jest.mock()`, `jest.MockedFunction`. Do not use `vi.*` APIs from the backend test files as reference.

---

## Acceptance Criteria

- [x] `waitlist_submissions` table created via Prisma migration
- [x] `POST /waitlist` persists email, phone, variant, source, UTM params, IP
- [x] `POST /waitlist` with duplicate email returns 409 (idempotent)
- [x] `POST /waitlist` rejects non-empty honeypot with 400
- [x] `POST /waitlist` rate limited to 5/15min per IP
- [x] `POST /waitlist` accepts both JSON and form-urlencoded content types
- [x] `GET /admin/waitlist` returns paginated list with total count
- [x] `GET /admin/waitlist` requires admin auth
- [x] Landing WaitlistForm posts to Fastify API (not Next.js route)
- [x] Landing form includes hidden honeypot field
- [x] Landing form sends UTM params from URL
- [x] Landing handles 409 as success (email already registered)
- [x] `/api/waitlist` Next.js route deleted
- [x] Zod validation schemas in packages/shared — 339 tests
- [x] All tests pass (API: 2449 pass / 10 pre-existing fail, Landing: 306, Shared: 339)
- [x] Build succeeds for both packages
- [x] CORS configured for landing→API communication (cors.ts, CORS_ORIGINS env var)
- [x] api-spec.yaml updated with both endpoints

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds
- [x] Specs reflect final implementation

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` + `frontend-planner` executed, plan approved
- [x] Step 3: `backend-developer` executed with TDD, then `frontend-developer`
- [x] Step 4: `production-code-validator` executed, quality gates pass
- [x] Step 5: `code-review-specialist` executed
- [x] Step 5: `qa-engineer` executed (Standard)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-28 | Ticket created | Fullstack: API (POST+GET) + landing form + DB migration + anti-spam |
| 2026-03-28 | Spec approved | User approved spec with admin GET endpoint |
| 2026-03-28 | Plan approved | Backend (7 steps) + Frontend (5 steps) |
| 2026-03-28 | Backend implemented | Schemas, migration, routes, app.ts, api-spec. 5 commits |
| 2026-03-28 | Frontend implemented | WaitlistForm → Fastify API, honeypot, UTM, route deleted. 2 commits |
| 2026-03-28 | Quality gates | Landing: 306 tests, build clean. API: 2449 pass. Shared: 303 pass |
| 2026-03-28 | Production validator | PRODUCTION READY — 0 issues |
| 2026-03-28 | Code review | Approve. 3 Important fixed (max-length, phone validation, source input). 5 Suggestions noted |
| 2026-03-28 | QA | 94 edge-case tests. 3 bugs: BUG-F046-01 (critical, fixed), BUG-F046-02 (medium, spec deviation noted), BUG-F046-03 (low, fixed) |
| 2026-03-28 | Review findings | Accepted: CR-I1 (max-length), CR-I3 (phone), CR-S1 (source input), QA-BUG-01 (error parsing), QA-BUG-03 (email lowercase). Noted: CR-I2 (source CHECK — deferred), CR-S3 (email normalize — done), QA-BUG-02 (409 body — spec deviation, no impact) |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Implementation Plan, AC, DoD, Workflow, Completion Log, Merge Checklist Evidence |
| 1. Mark all items | [x] | AC: 18/18, DoD: 6/6, Workflow: 7/8 (Step 6 pending) |
| 2. Verify product tracker | [x] | Features table: 3/6 → will update to 5/6 in docs commit |
| 3. Update key_facts.md | [x] | Added: waitlist route, schemas, migration entries |
| 4. Update decisions.md | [x] | N/A — no new ADR (waitlist persistence already in ADR-012) |
| 5. Commit documentation | [x] | Commit: (see below) |
| 6. Verify clean working tree | [x] | `git status`: clean (after docs commit) |

---

*Ticket created: 2026-03-28*
