# F113: Backend Metrics Endpoint for Web

**Feature:** F113 | **Type:** Backend | **Priority:** Medium
**Status:** In Progress | **Branch:** feature/F113-backend-metrics-endpoint
**Created:** 2026-04-08 | **Dependencies:** F112 (done), F029 (done)

---

## Spec

### Description

Add a server-side receiver for the client-side session metrics emitted by the `/hablar` web assistant (F112). The web client already collects usage data (query counts, error rates, intent distribution, avg response time) in `localStorage` and sends a `MetricsSnapshot` payload via `navigator.sendBeacon` on page unload when `NEXT_PUBLIC_METRICS_ENDPOINT` is set. F113 wires up the other end of that call.

The endpoint must be reachable without authentication (sendBeacon cannot set custom headers), protected instead by IP-based rate limiting, and must tolerate `text/plain;charset=UTF-8` content-type (the browser default for sendBeacon with a plain string body).

An admin-only read endpoint (`GET /analytics/web-events`) aggregates the stored rows for operational visibility.

This feature was explicitly called out in ADR-018 as the future backend counterpart to the client-side-only F112 implementation.

---

### API Changes

#### POST /analytics/web-events

Receives a `MetricsSnapshot` JSON blob from the web assistant.

- **Auth:** None. No `X-API-Key` required. Update `adminPrefixes.ts` with a **method-aware exemption**: `POST /analytics/web-events` is public; all other `/analytics/*` routes remain admin-only. Use the method-aware routing pattern established in F032.
- **Actor middleware skip:** Add `POST /analytics/web-events` to the `actorResolver` middleware skip list (alongside `/health`). sendBeacon cannot set `X-Actor-Id` headers, and this route must NOT auto-create ghost actor rows (ADR-016 actor auto-creation).
- **Rate limit:** Dedicated per-IP limit — 10 requests/minute/IP — applied via a route-level `@fastify/rate-limit` config override. This is narrower than the global anonymous limit (30 req/15min) and targets abuse prevention for a fire-and-forget beacon.
- **Content-Type:** Accept both `application/json` and `text/plain` (sendBeacon sends `text/plain;charset=UTF-8`). Register a **Fastify content type parser** for `text/plain` using `fastify.addContentTypeParser('text/plain', { parseAs: 'string' }, ...)` so Fastify does not reject the request with 415. Then JSON.parse the raw string before Zod validation.
- **Response:** `{ "success": true }` with HTTP 202 Accepted. The client ignores the response body; 202 signals the server accepted the payload for async processing.
- **Storage:** Persist one row to `web_metrics_events` via Prisma.
- **Fail-silent on storage error:** If the DB insert fails, log the error but still return `{ "success": true }` with HTTP 202. This matches the fire-and-forget intent — a transient DB error must not surface to the client (which ignores the response anyway).

**Request body** (MetricsSnapshot shape):

```json
{
  "queryCount": 5,
  "successCount": 4,
  "errorCount": 1,
  "retryCount": 0,
  "intents": { "nutritional_query": 3, "comparison": 1 },
  "errors": { "NETWORK_ERROR": 1 },
  "avgResponseTimeMs": 1200,
  "sessionStartedAt": "2026-04-08T10:00:00.000Z"
}
```

**Success response (202):**

```json
{ "success": true }
```

**Validation error response (400):**

```json
{
  "success": false,
  "error": {
    "message": "Validation failed",
    "code": "VALIDATION_ERROR"
  }
}
```

**Rate limit response (429):**

```json
{
  "success": false,
  "error": {
    "message": "Too many requests, please try again later.",
    "code": "RATE_LIMIT_EXCEEDED"
  }
}
```

---

#### GET /analytics/web-events

Aggregates `web_metrics_events` rows into summary statistics for admin visibility.

- **Auth:** Admin-only (`AdminKeyAuth` — `X-API-Key` header matching `ADMIN_API_KEY`). Covered by the `/analytics/` admin prefix (GET method not exempted).
- **Query params:** `timeRange` (24h | 7d | 30d | all, default: 7d)
- **Query engine:** Use **Kysely** (not Prisma) for the aggregation query — JSONB unnesting (`jsonb_each_text`) and `SUM()` aggregation are required for topIntents/topErrors, which Prisma cannot express.
- **Response:** Aggregated totals across all stored rows in the time window.
- **Aggregation formulas:**
  - `avgResponseTimeMs` = weighted average: `SUM(avg_response_time_ms * success_count) / SUM(success_count)` (weighted by successful queries per session, not a simple average of averages). Returns `null` when totalSuccesses = 0.
  - `topIntents` = top 10, sorted by count DESC then key ASC (tie-break). Computed via `jsonb_each_text(intents)` unnested across all rows, grouped by key, summed.
  - `topErrors` = top 10, same sort/limit as topIntents.

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "eventCount": 42,
    "totalQueries": 310,
    "totalSuccesses": 285,
    "totalErrors": 25,
    "totalRetries": 8,
    "avgResponseTimeMs": 980.5,
    "topIntents": [
      { "intent": "nutritional_query", "count": 180 },
      { "intent": "comparison", "count": 75 }
    ],
    "topErrors": [
      { "errorCode": "NETWORK_ERROR", "count": 15 },
      { "errorCode": "TIMEOUT", "count": 10 }
    ],
    "timeRange": "7d"
  }
}
```

---

### Data Model Changes

#### New table: `web_metrics_events`

Prisma model:

```prisma
model WebMetricsEvent {
  id                String   @id @default(uuid()) @db.Uuid
  queryCount        Int      @map("query_count")
  successCount      Int      @map("success_count")
  errorCount        Int      @map("error_count")
  retryCount        Int      @map("retry_count")
  intents           Json     @map("intents")           // Record<string, number>
  errors            Json     @map("errors")            // Record<string, number>
  avgResponseTimeMs Int      @map("avg_response_time_ms")
  sessionStartedAt  DateTime @map("session_started_at") @db.Timestamptz
  receivedAt        DateTime @default(now()) @map("received_at") @db.Timestamptz
  ipHash            String?  @map("ip_hash") @db.VarChar(64) // SHA-256 of IP, privacy-preserving

  @@index([receivedAt(sort: Desc)])
  @@map("web_metrics_events")
}
```

**Notes:**
- `intents` and `errors` stored as JSONB (`Json` in Prisma → `jsonb` in PostgreSQL). No PII — only aggregate counts and string keys emitted by the client.
- `sessionStartedAt` is client-reported. Validated as ISO 8601 but not trusted for security purposes — used for session duration analytics only.
- `ipHash` stores `SHA-256(request.ip)` (not the raw IP). Allows per-IP deduplication queries without storing PII. Nullable for environments where IP is unavailable (test, localhost).
- No FK to `actors` table — no actorId in the metrics payload (privacy-first, ADR-018).
- One Prisma migration required. Migration name: `add_web_metrics_events`.

---

### Shared Schema Changes

New file: `packages/shared/src/schemas/webMetrics.ts`

Exports:
- `WebMetricsSnapshotSchema` — Zod schema validating the `MetricsSnapshot` inbound payload
- `WebMetricsQueryParamsSchema` — Zod schema for the GET endpoint query params
- `WebMetricsAggregateSchema` — Zod schema for the GET aggregation response data

**WebMetricsSnapshotSchema validation rules:**
- `queryCount`: integer, min 1 (reject zero-query beacons — client already guards this but defend in depth)
- `successCount`: integer, min 0, max = queryCount (validated post-parse)
- `errorCount`: integer, min 0, max = queryCount
- `retryCount`: integer, min 0
- `intents`: record of string keys → non-negative integers. Max 50 keys (guard against malformed clients). Each key max 100 chars.
- `errors`: record of string keys → non-negative integers. Max 50 keys. Each key max 100 chars.
- `avgResponseTimeMs`: integer, min 0, max 120000 (2 minutes ceiling — anything higher is a client bug)
- `sessionStartedAt`: ISO 8601 string, parseable as a date, not in the future by more than 1 minute (clock skew tolerance), not older than 24 hours

**WebMetricsQueryParamsSchema:**
- `timeRange`: enum `['24h', '7d', '30d', 'all']`, default `'7d'`

---

### Environment Variable

`NEXT_PUBLIC_METRICS_ENDPOINT` (web package `.env`):
- Set to the full URL of the POST endpoint, e.g. `https://api.nutrixplorer.com/analytics/web-events`
- When unset (default), `flushMetrics()` is a no-op — no beacon is sent
- Must be documented in `packages/web/.env.example`

---

### Edge Cases

| Scenario | Handling |
|----------|----------|
| sendBeacon sends `text/plain;charset=UTF-8` | Route handler reads raw body string and JSON.parses before Zod validation |
| Body is not valid JSON | Return 400 VALIDATION_ERROR |
| `queryCount: 0` (client guard bypassed) | Reject with 400 VALIDATION_ERROR |
| `successCount > queryCount` | Reject with 400 VALIDATION_ERROR (cross-field validation in Zod `.refine()`) |
| `sessionStartedAt` older than 24h | Reject with 400 VALIDATION_ERROR |
| `sessionStartedAt` in the future | Reject with 400 VALIDATION_ERROR (allow 1min clock skew) |
| DB insert fails | Log error server-side; return 202 anyway (fire-and-forget) |
| Redis unavailable for rate limiting | Fail-open (match existing `skipOnError: true` pattern) |
| `intents` or `errors` has > 50 keys | Reject with 400 VALIDATION_ERROR |
| Empty `intents` or `errors` objects | Valid — no intent/error tracking occurred |
| IP not available (localhost/test) | `ipHash` stored as null |
| Duplicate session data (user reloads) | Stored as separate rows — no deduplication at insert time. Admin queries can deduplicate by `sessionStartedAt` + `ipHash` if needed |

---

### Acceptance Criteria

- [ ] `POST /analytics/web-events` accepts `application/json` and `text/plain` content types
- [ ] `POST /analytics/web-events` validates payload with `WebMetricsSnapshotSchema`
- [ ] Valid payload returns HTTP 202 `{ "success": true }`
- [ ] Invalid payload returns HTTP 400 `{ "success": false, "error": { "code": "VALIDATION_ERROR" } }`
- [ ] Payload is persisted to `web_metrics_events` table on success
- [ ] DB insert failure does not change the 202 response (fire-and-forget)
- [ ] Rate limit: max 10 events/min/IP; excess returns 429. Test via unit test asserting route config `rateLimit` options (rate-limit plugin is disabled in NODE_ENV=test)
- [ ] `GET /analytics/web-events` is admin-only (401 without valid `X-API-Key`)
- [ ] `GET /analytics/web-events` returns aggregated data for `timeRange` window
- [ ] `WebMetricsSnapshotSchema` and `WebMetricsAggregateSchema` exported from `@foodxplorer/shared`
- [ ] `POST /analytics/web-events` exempted from actorResolver middleware (no ghost actors)
- [ ] `POST /analytics/web-events` exempted from admin auth prefix (method-aware)
- [ ] Prisma migration `add_web_metrics_events` applied and generates Kysely types
- [ ] `NEXT_PUBLIC_METRICS_ENDPOINT` documented in `packages/web/.env.example`
- [ ] Unit tests for `WebMetricsSnapshotSchema` (valid, invalid, cross-field)
- [ ] Integration tests for POST route (valid payload, bad JSON, rate limit, DB error)
- [ ] Integration tests for GET route (auth guard, aggregation, timeRange filter)
- [ ] All existing tests pass

---

## Implementation Plan

### Existing Code to Reuse

- **`packages/api/src/plugins/adminPrefixes.ts`** — `isAdminRoute()` and `ADMIN_PREFIXES` already support method-aware exemptions (see the `POST /restaurants` pattern). Add a second method-aware rule here.
- **`packages/api/src/plugins/actorResolver.ts`** — `registerActorResolver()` skips `/health`, `/docs`, `/docs/json`. Extend the skip list by adding `POST /analytics/web-events`.
- **`packages/api/src/plugins/auth.ts`** — `registerAuthMiddleware()` calls `isAdminRoute(url, request.method)`. No changes required here once `adminPrefixes.ts` is updated.
- **`packages/api/src/routes/analytics.ts`** — Use as the structural template for the new `webMetrics.ts` route plugin: same `FastifyPluginAsync<PluginOptions>` + `fastifyPlugin` export pattern, same Kysely injection via opts.
- **`packages/api/src/app.ts`** — Register the new plugin here (alongside `analyticsRoutes`). Register the `text/plain` content type parser here too, before routes.
- **`packages/shared/src/schemas/analytics.ts`** — Reference for Zod schema structure (enum + query params + aggregate + response schemas).
- **`packages/shared/src/index.ts`** — Barrel file; add the new `webMetrics` export line.
- **`packages/api/src/__tests__/migration.f029.integration.test.ts`** — Reference for migration integration test pattern (pg_indexes check, insert/read-back, no-FK validation).
- **`packages/api/src/__tests__/f026.auth.test.ts`** — Reference for route test pattern using `buildApp().inject()` with hoisted mocks.
- **`packages/shared/src/__tests__/schemas.test.ts`** — Reference for Zod unit test structure.

---

### Files to Create

| File | Purpose |
|------|---------|
| `packages/shared/src/schemas/webMetrics.ts` | `WebMetricsSnapshotSchema`, `WebMetricsQueryParamsSchema`, `WebMetricsAggregateSchema` — all three exported Zod schemas |
| `packages/api/src/routes/webMetrics.ts` | Fastify route plugin: `POST /analytics/web-events` (receive + persist) and `GET /analytics/web-events` (Kysely aggregation) |
| `packages/api/prisma/migrations/20260408140000_add_web_metrics_events/migration.sql` | Raw SQL to create the `web_metrics_events` table + DESC index on `received_at` |
| `packages/api/src/__tests__/migration.f113.integration.test.ts` | Integration tests: table schema, nullable ip_hash, jsonb columns, index existence, no-FK insert |
| `packages/api/src/__tests__/f113.webMetrics.post.route.test.ts` | Route tests for `POST /analytics/web-events` (valid payload, bad JSON, text/plain, DB error, rate-limit config) |
| `packages/api/src/__tests__/f113.webMetrics.get.route.test.ts` | Route tests for `GET /analytics/web-events` (auth guard, aggregation shape, timeRange filter) |
| `packages/shared/src/__tests__/webMetrics.schemas.test.ts` | Zod unit tests for `WebMetricsSnapshotSchema` (all validation rules, cross-field `.refine()`) |

---

### Files to Modify

| File | What Changes |
|------|-------------|
| `packages/api/prisma/schema.prisma` | Add `WebMetricsEvent` model (as specified in the Spec's Data Model section) |
| `packages/api/src/generated/kysely-types.ts` | Regenerated automatically by `prisma generate` — `WebMetricsEvents` type added |
| `packages/api/src/plugins/adminPrefixes.ts` | Add method-aware exemption: `POST /analytics/web-events` returns `false` (public), all other `/analytics/*` remain admin-only |
| `packages/api/src/plugins/actorResolver.ts` | Add `url === '/analytics/web-events' && request.method === 'POST'` to the skip condition |
| `packages/api/src/app.ts` | (1) Register `text/plain` content type parser. (2) Import and register `webMetricsRoutes` plugin with `{ db, prisma }` |
| `packages/shared/src/index.ts` | Add `export * from './schemas/webMetrics';` |
| `packages/web/.env.local.example` | Add `NEXT_PUBLIC_METRICS_ENDPOINT=` entry with a comment |

---

### Implementation Order

Follow layer-first, test-first ordering. Write the test scaffolding first so the developer can verify at each step.

**Step 1 — Prisma schema + migration**

- Modify `packages/api/prisma/schema.prisma`: append the `WebMetricsEvent` model exactly as specified in the Spec. No enums required — `intents` and `errors` are `Json`.
- Create migration directory: `packages/api/prisma/migrations/20260408140000_add_web_metrics_events/`
- Create `migration.sql` manually (do NOT use `prisma migrate dev`):
  ```sql
  CREATE TABLE "web_metrics_events" (
    "id"                    UUID NOT NULL DEFAULT gen_random_uuid(),
    "query_count"           INTEGER NOT NULL,
    "success_count"         INTEGER NOT NULL,
    "error_count"           INTEGER NOT NULL,
    "retry_count"           INTEGER NOT NULL,
    "intents"               JSONB NOT NULL,
    "errors"                JSONB NOT NULL,
    "avg_response_time_ms"  INTEGER NOT NULL,
    "session_started_at"    TIMESTAMPTZ NOT NULL,
    "received_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
    "ip_hash"               VARCHAR(64),
    CONSTRAINT "web_metrics_events_pkey" PRIMARY KEY ("id")
  );
  CREATE INDEX "web_metrics_events_received_at_idx" ON "web_metrics_events" ("received_at" DESC);
  ```
- Apply: `prisma migrate deploy` (not `dev`)
- Regenerate Kysely types: `prisma generate` → `packages/api/src/generated/kysely-types.ts` gets `WebMetricsEvents` type

**Step 2 — Shared Zod schemas**

- Create `packages/shared/src/schemas/webMetrics.ts` with three exports:
  - `WebMetricsSnapshotSchema`: validate the inbound POST body. Key rules:
    - `queryCount`: `z.number().int().min(1)`
    - `successCount`: `z.number().int().min(0)` + cross-field `.refine()`: `successCount <= queryCount`
    - `errorCount`: `z.number().int().min(0)` + cross-field `.refine()`: `errorCount <= queryCount`
    - `retryCount`: `z.number().int().min(0)`
    - `intents`: `z.record(z.string().max(100), z.number().int().min(0)).refine(v => Object.keys(v).length <= 50)`
    - `errors`: same shape as `intents`
    - `avgResponseTimeMs`: `z.number().min(0).max(120000).transform(Math.round)` — use `.transform(Math.round)` instead of `.int()` because the web client derives this from `performance.now()` which returns floats
    - `sessionStartedAt`: `z.string()` piped through `.refine()` checking: parseable as ISO date, not in the future by > 1 minute (allow clock skew), not older than 24 hours
  - `WebMetricsQueryParamsSchema`: `z.object({ timeRange: z.enum(['24h', '7d', '30d', 'all']).default('7d') })`
  - `WebMetricsAggregateSchema`: shape matches the GET response `data` field — `eventCount`, `totalQueries`, `totalSuccesses`, `totalErrors`, `totalRetries`, `avgResponseTimeMs` (nullable), `topIntents` (array of `{ intent, count }`), `topErrors` (array of `{ errorCode, count }`), `timeRange`
- Update `packages/shared/src/index.ts`: add `export * from './schemas/webMetrics';`

**Step 3 — Admin prefix exemption (method-aware)**

- Modify `packages/api/src/plugins/adminPrefixes.ts` — `isAdminRoute()`:
  - Add before the prefix-based check: `if (url === '/analytics/web-events' && method === 'POST') return false;`
  - The existing prefix check `url.startsWith('/analytics/')` will still catch all other `/analytics/*` routes (GET included)
  - This mirrors the existing `POST /restaurants` method-aware pattern already in the file

**Step 4 — Actor middleware skip**

- Modify `packages/api/src/plugins/actorResolver.ts` — the `onRequest` hook skip condition:
  - Current: `if (url === '/health' || url === '/docs' || url === '/docs/json') return;`
  - New: add `|| (url === '/analytics/web-events' && request.method === 'POST')` to the same condition
  - This prevents ghost actor creation for sendBeacon requests which carry no `X-Actor-Id` header

**Step 5 — text/plain content type parser**

- Modify `packages/api/src/app.ts`:
  - After the `setSerializerCompiler` / `setValidatorCompiler` calls and before route registration, add:
    ```
    app.addContentTypeParser('text/plain', { parseAs: 'string' }, (req, body, done) => {
      done(null, body);
    });
    ```
  - This registers a raw passthrough parser. The route handler will call `JSON.parse(body as string)` on the already-parsed string, then feed the result to Zod. Note: `application/json` is handled by Fastify's built-in parser — do not replace it.

**Step 6 — Route plugin: POST /analytics/web-events**

- Create `packages/api/src/routes/webMetrics.ts`:
  - `WebMetricsPluginOptions`: `{ db: Kysely<DB>; prisma: PrismaClient }`
  - Register `POST /analytics/web-events` with route-level rate limit config: `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }` (this config is read by `@fastify/rate-limit` when it is active; in `NODE_ENV=test` rate limiting is globally disabled, so the config exists on the route but is never evaluated — assert its presence via `route.config.rateLimit` in tests)
  - Handler logic:
    1. Read `request.body` — if it is a string (came through text/plain parser), call `JSON.parse()` inside a try/catch; on JSON parse failure throw `{ code: 'VALIDATION_ERROR', statusCode: 400 }`
    2. Parse with `WebMetricsSnapshotSchema.safeParse(body)`. On failure return 400 with `{ success: false, error: { message: 'Validation failed', code: 'VALIDATION_ERROR' } }`
    3. Compute `ipHash`: `createHash('sha256').update(request.ip ?? '').digest('hex')` — set to `null` if `request.ip` is falsy (localhost/test returns empty string or undefined)
    4. Insert into `web_metrics_events` via `prisma.webMetricsEvent.create(...)` wrapped in a `try/catch`. On DB error: `request.log.error({ err }, 'F113: web_metrics_events insert failed')` then fall through to success response.
    5. Return `reply.code(202).send({ success: true })`
  - Export `webMetricsRoutes` via `fastifyPlugin(webMetricsRoutesPlugin)`

**Step 7 — Route plugin: GET /analytics/web-events**

- Add to the same `packages/api/src/routes/webMetrics.ts` plugin:
  - Register `GET /analytics/web-events` with Zod querystring schema `WebMetricsQueryParamsSchema`
  - Handler uses Kysely for all aggregation (not Prisma). Run three queries via `Promise.all`:
    - **Time range mapping** (local helper `timeRangeToInterval`, recreated locally — same pattern as `analytics.ts` unexported helper):
    - `'24h'` → `NOW() - INTERVAL '24 hours'`
    - `'7d'` → `NOW() - INTERVAL '7 days'`
    - `'30d'` → `NOW() - INTERVAL '30 days'`
    - `'all'` → no WHERE clause on `received_at`
  - **Query 1 — scalar aggregates**: `SELECT COUNT(*) as event_count, COALESCE(SUM(query_count), 0) as total_queries, COALESCE(SUM(success_count), 0) as total_successes, COALESCE(SUM(error_count), 0) as total_errors, COALESCE(SUM(retry_count), 0) as total_retries, COALESCE(SUM(avg_response_time_ms * success_count), 0) as weighted_time_sum, COALESCE(SUM(success_count), 0) as weighted_time_count FROM web_metrics_events [WHERE received_at >= interval]` — use `COALESCE(..., 0)` on all SUMs to handle empty result sets
    - **Query 2 — top intents**: `SELECT key as intent, SUM(value::int) as count FROM web_metrics_events, jsonb_each_text(intents) [WHERE ...] GROUP BY key ORDER BY count DESC, key ASC LIMIT 10`
    - **Query 3 — top errors**: same pattern but from `errors` column, aliasing key as `error_code`
    - Use `sql` tagged template literal from Kysely for the JSONB unnesting queries (cannot be expressed with the query builder alone — see `analytics.ts` for the `sql<T>\`...\`` pattern)
  - Assemble response: `avgResponseTimeMs = totalSuccesses === 0 ? null : Number(weightedTimeSum) / Number(totalSuccesses)`. All other totals are already `number` (COALESCE guarantees non-NULL)
  - Return `reply.send({ success: true, data: { eventCount, totalQueries, ..., timeRange } })`
  - On DB error: throw `Object.assign(new Error('...'), { code: 'DB_UNAVAILABLE', statusCode: 500, cause: err })` (same pattern as `analytics.ts`)

**Step 8 — Register in app.ts**

- Modify `packages/api/src/app.ts`:
  - Import `webMetricsRoutes` from `'./routes/webMetrics.js'`
  - Register: `await app.register(webMetricsRoutes, { db: getKysely(), prisma: prismaClient });`
  - Place it adjacent to the existing `analyticsRoutes` registration

**Step 9 — Environment variable documentation**

- Modify `packages/web/.env.example` (as specified in acceptance criteria):
  - Add: `# F113 — Web assistant metrics beacon endpoint. Leave unset to disable.\nNEXT_PUBLIC_METRICS_ENDPOINT=`

---

### Testing Strategy

**Unit tests — Zod schemas**
File: `packages/shared/src/__tests__/webMetrics.schemas.test.ts`

Test groups for `WebMetricsSnapshotSchema`:
- Happy path: valid minimal payload (queryCount=1, successCount=1, errorCount=0, retryCount=0, intents={}, errors={}, avgResponseTimeMs=0, sessionStartedAt=now)
- Happy path: valid payload with intent + error keys
- `queryCount: 0` → rejects (min 1)
- `successCount > queryCount` → rejects (cross-field refine)
- `errorCount > queryCount` → rejects (cross-field refine)
- `avgResponseTimeMs: 120001` → rejects (max 120000)
- `avgResponseTimeMs: -1` → rejects (min 0)
- `intents` with 51 keys → rejects (max 50)
- `intents` value `-1` → rejects (non-negative)
- `intents` key > 100 chars → rejects
- `sessionStartedAt`: valid ISO string (now) → accepts
- `sessionStartedAt`: 25 hours ago → rejects
- `sessionStartedAt`: 2 minutes in the future → rejects (> 1 min skew)
- `sessionStartedAt`: 30 seconds in the future → accepts (within 1 min skew)
- `sessionStartedAt`: not a date string → rejects

Test groups for `WebMetricsQueryParamsSchema`:
- Default `timeRange` is `'7d'` when omitted
- All four enum values accepted
- Invalid string rejected

**Route tests — POST**
File: `packages/api/src/__tests__/f113.webMetrics.post.route.test.ts`

Use `buildApp().inject()` with hoisted Prisma mock. Mock pattern: mock `prisma.webMetricsEvent.create`.

- Valid JSON body (application/json) → 202 `{ success: true }`, Prisma create called once
- Valid body as `text/plain;charset=UTF-8` content-type string → 202 (validates text/plain parsing)
- Body is not valid JSON string (text/plain) → 400 `VALIDATION_ERROR`
- Body fails Zod validation (`queryCount: 0`) → 400 `VALIDATION_ERROR`
- Body fails cross-field validation (`successCount > queryCount`) → 400 `VALIDATION_ERROR`
- DB insert throws → still returns 202 (fire-and-forget, fail-silent)
- Assert route config `rateLimit` options: `max: 10`, `timeWindow: '1 minute'` — inspect via `app.routes` or by checking the route schema after `app.ready()` (rate limiting itself is disabled in test env)
- `POST /analytics/web-events` with no `X-Actor-Id` header → 202 (no ghost actor created; mock prisma.actor.create/upsert not called)
- `POST /analytics/web-events` with no auth header → 202 (not rejected as admin route)
- `GET /analytics/web-events` with no auth header → 401 (admin route, not exempted for GET)
- Malformed `application/json` body (`"not json{{"`) → 400 `VALIDATION_ERROR` (verify Fastify parse error maps to spec error envelope)

**Route tests — GET**
File: `packages/api/src/__tests__/f113.webMetrics.get.route.test.ts`

Mock Kysely query results. Return synthetic rows for the three aggregation queries.

- No `X-API-Key` → 401 (admin auth enforced for GET)
- Valid `X-API-Key` (ADMIN_API_KEY configured) + no query params → 200 with `timeRange: '7d'` default
- `timeRange=24h` → 200, timeRange reflected in response
- `timeRange=all` → 200 (no WHERE clause on received_at)
- Empty table (no rows in time range) → all totals `0`, `avgResponseTimeMs: null` (COALESCE guards)
- Scalar row with `total_successes = 0` → `avgResponseTimeMs: null` in response
- Scalar row with `total_successes > 0` → `avgResponseTimeMs` is a number (weighted average)
- `topIntents` sorted by count DESC, key ASC tie-break — verify ordering
- `topErrors` same
- DB throws → 500 `DB_UNAVAILABLE`

**Migration integration test**
File: `packages/api/src/__tests__/migration.f113.integration.test.ts`

Pattern from `migration.f029.integration.test.ts`. Use fixture UUID `fd000000-0113-4000-a000-000000000001`.

- Insert a `web_metrics_events` row with all columns populated → reads back correctly
- `ip_hash: null` is valid
- `intents` and `errors` stored as JSONB → reads back as objects
- `received_at` defaults to `now()` when omitted
- `id` defaults to `gen_random_uuid()` when omitted
- Index `web_metrics_events_received_at_idx` exists (via `pg_indexes`)
- No FK to `actors` table — row accepted with a random `ip_hash` (not a UUID column, so no FK to check; this test verifies no FK was accidentally added)

**Mocking strategy summary:**
- All route tests: mock `../lib/prisma.js` and `../lib/kysely.js` (same hoisted pattern as `f026.auth.test.ts` and `f029.estimate.route.test.ts`)
- Schema unit tests: no mocks needed (pure Zod)
- Migration integration tests: real test DB (`DATABASE_URL_TEST`), no mocks

---

### Key Patterns

1. **Method-aware admin exemption** — `adminPrefixes.ts` lines 9–11 show the existing `POST /restaurants` exemption pattern. Add the `POST /analytics/web-events` exemption as a second `if` before the prefix loop, returning `false` explicitly.

2. **actorResolver skip** — `actorResolver.ts` line 53 uses a single `||` chain. Add the new condition to that chain. Use both `url` and `request.method` checks to be precise.

3. **text/plain parser** — Must be registered via `app.addContentTypeParser(...)` before routes. The parser only needs to forward the raw string body; the route handler is responsible for `JSON.parse()`. Do NOT use `parseAs: 'buffer'` — use `parseAs: 'string'` to get a string directly.

4. **Route-level rate limit override** — `@fastify/rate-limit` supports per-route overrides via `config.rateLimit` on the route options. Since rate limiting is globally disabled in `NODE_ENV=test`, the only way to test it is asserting the config object exists on the route definition. Do not try to trigger a 429 via `inject()` calls.

5. **Malformed application/json handling** — When Fastify's built-in JSON parser receives malformed JSON with `Content-Type: application/json`, it rejects with a 400 before the route handler. Verify (via test) that the existing global error handler already maps this to the spec's `{ success: false, error: { code: 'VALIDATION_ERROR' } }` format. If not, add a `setErrorHandler` or `onError` hook in the route plugin to normalize Fastify parse errors to the spec's error envelope. Add a test case: `POST /analytics/web-events` with `Content-Type: application/json` and body `"not json{{"` → expect 400 with `VALIDATION_ERROR`.

6. **Fire-and-forget DB insert** — The POST handler must wrap the `prisma.webMetricsEvent.create()` call in `try/catch` and continue to the `reply.code(202).send({ success: true })` response regardless. Do not `await` the insert in a way that blocks the 202 response. (It can still `await` the create — the fire-and-forget semantics here mean: catch the error, log it, and return 202 regardless. This is different from a true fire-and-forget `void promise`; the spec says to log and return 202, which requires awaiting inside try/catch.)

6. **Kysely JSONB unnesting** — Use `sql<{ intent: string; count: string }[]>\`SELECT key as intent, SUM(value::int) as count FROM web_metrics_events, jsonb_each_text(intents) ...\`` with `prisma.$queryRaw` would not work here. Use Kysely's `sql` template tag as shown in `analytics.ts` lines 115–127. Cast `count` to `Number()` when assembling the response.

7. **Weighted average null guard** — When `SUM(success_count) = 0` across all rows, `SUM(avg_response_time_ms * success_count) / SUM(success_count)` is division-by-zero. Postgres returns `NULL`. Guard with `const weighted = totalSuccesses === 0 ? null : Number(weightedTimeSum) / Number(totalSuccesses)`.

9. **ipHash computation** — Use `import { createHash } from 'node:crypto'`. Compute: `createHash('sha256').update(request.ip).digest('hex')`. Note: `request.ip` on localhost is typically `'127.0.0.1'` or `'::1'` (truthy), which will be hashed normally. Set to `null` only when `request.ip` is truly falsy (undefined/empty). Hashing loopback addresses is harmless — it enables per-IP dedup even in dev.

10. **Plugin options pattern** — `WebMetricsPluginOptions` mirrors `AnalyticsPluginOptions` from `analytics.ts` but adds `prisma`. Both `db` and `prisma` must be typed with their respective interfaces, not any.

11. **Migration timestamp** — Next available slot after `20260404200000`. Use `20260408140000` (creation date of this ticket). Verify no collision with existing migration directories before writing.

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Unit and integration tests written and passing
- [ ] No linting errors
- [ ] Build succeeds (API and shared packages)
- [ ] Prisma migration applied to staging DB

---

## Workflow Checklist

- [ ] Step 1: Branch created, ticket generated, tracker updated
- [ ] Step 3: Implementation complete
- [ ] Step 4: Quality gates pass, committed
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-08 | Step 0: Spec | Spec drafted by spec-creator agent |
| 2026-04-08 | Spec review | Reviewed by Gemini + Codex (gpt-5.4). 1 CRITICAL + 5 IMPORTANT + 1 SUGGESTION. All addressed |
| 2026-04-08 | Step 2: Plan | Plan written by backend-planner agent |
| 2026-04-08 | Plan review | Reviewed by Gemini + Codex. 4 IMPORTANT + 4 SUGGESTION. All addressed: COALESCE nulls, timeRangeInterval helper, .env.example path, malformed JSON handler, Math.round transform, timeRange mapping, ipHash comment, empty-table test |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | |
| 1. Mark all items | [ ] | |
| 2. Verify product tracker | [ ] | |
| 3. Update key_facts.md | [ ] | |
| 4. Update decisions.md | [ ] | |
| 5. Commit documentation | [ ] | |
| 6. Verify clean working tree | [ ] | |
| 7. Verify branch up to date | [ ] | |

---

*Ticket created: 2026-04-08*
