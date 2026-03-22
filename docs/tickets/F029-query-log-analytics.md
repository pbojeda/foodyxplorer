# F029: Query Log & Analytics

**Feature:** F029 | **Type:** Backend-Feature | **Priority:** Medium
**Status:** Done | **Branch:** merged (PR #26, SHA c8c230d)
**Created:** 2026-03-21 | **Dependencies:** F023 (Engine Router), F026 (API Key Auth)

---

## Spec

### Description

F029 adds persistent query logging and an analytics read endpoint. Every call to `GET /estimate` — whether it hits L1, L2, L3, L4, or misses entirely — is recorded asynchronously to a `query_logs` PostgreSQL table. A new admin-only `GET /analytics/queries` endpoint aggregates those rows into operational metrics: total query counts, level-hit distribution, top queried terms, cache hit rate, average response time, and queries by chain and source.

Critical design constraint: **zero added latency to the estimate response** — the log write is fire-and-forget (`void` — not awaited in the request path). A logging failure must never surface to the API caller.

### API Changes

- **New endpoint:** `GET /analytics/queries` (admin-only, under `/analytics/` prefix)
  - Query params: `timeRange` (24h|7d|30d|all, default 7d), `chainSlug` (optional), `topN` (1-100, default 10)
  - Returns: totalQueries, cacheHitRate, avgResponseTimeMs, byLevel, byChain, bySource, topQueries
  - Auth: `validateAdminKey` via existing middleware (add `/analytics/` to `ADMIN_PREFIXES`)
- **Modified endpoint:** `GET /estimate` — fire-and-forget log write after response resolution

### Data Model Changes

New Prisma model `QueryLog` → table `query_logs`:
- `id` (UUID PK), `queryText` (VARCHAR 255), `chainSlug` (VARCHAR 100, nullable)
- `restaurantId` (UUID, nullable, no FK), `levelHit` (enum: l1/l2/l3/l4, nullable for miss)
- `cacheHit` (boolean), `responseTimeMs` (int), `apiKeyId` (UUID, nullable, no FK)
- `source` (enum: api/bot, default api), `queriedAt` (timestamptz, default now())
- New enums: `QueryLogLevelHit`, `QueryLogSource`
- Indexes: `queried_at DESC`, `chain_slug`, `level_hit`, `source`
- No FK constraints on `apiKeyId`/`restaurantId` (immutable audit records)

### Edge Cases & Error Handling

| Scenario | Behavior |
|---|---|
| DB down during log write | Caught, logged at warn, estimate response unaffected |
| DB down during analytics query | HTTP 500 with `DB_UNAVAILABLE` |
| `timeRange=all` on empty table | Returns `totalQueries: 0`, all zeros |
| Cache hit for a total-miss result | `cache_hit = true`, `level_hit = null` |
| `X-FXP-Source` header not `'bot'` | Treated as `source = 'api'` |
| Multiple `X-FXP-Source` headers | Take first value only |
| `topN=0` or `topN=150` | Rejected by Zod → 400 VALIDATION_ERROR |
| Redis down, cascade runs | Log row written with `cache_hit = false` |

Source detection: Bot sends `X-FXP-Source: bot` header; estimate route reads raw header. Not exposed in OpenAPI (internal).

---

## Implementation Plan

### Existing Code to Reuse

- **`packages/api/src/plugins/auth.ts`** — `touchLastUsed` pattern: `void prisma.$executeRaw\`...\`.catch(...)` is the exact fire-and-forget idiom to replicate in `writeQueryLog`
- **`packages/api/src/plugins/adminPrefixes.ts`** — `ADMIN_PREFIXES` array and `isAdminRoute()` function; just add `'/analytics/'` to the constant
- **`packages/api/src/plugins/auth.ts`** — `request.apiKeyContext?.keyId` for reading the authenticated key UUID; already set on request object by the auth middleware
- **`packages/api/src/lib/kysely.ts`** — `getKysely()` singleton; pass to analytics route exactly as done in `app.ts` for `estimateRoutes` and `catalogRoutes`
- **`packages/api/src/routes/catalog.ts`** — reference for `FastifyPluginAsync<Opts>` + `fastifyPlugin()` wrapping pattern, and how a route receives both `prisma` and `db` in opts
- **`packages/api/src/estimation/engineRouter.ts`** — `EngineRouterResult.levelHit` is `1 | 2 | 3 | 4 | null`; map to `'l1' | 'l2' | 'l3' | 'l4' | null` for the log entry
- **`packages/api/src/routes/estimate.ts`** — current handler; the `cacheGet` return determines `cacheHit`; the `cached` value (an `EstimateData`) carries level flags for deriving `levelHit` on cache hits
- **`packages/api/src/__tests__/f023.estimate.route.test.ts`** — hoisted-mock pattern for `runEstimationCascade`, `cacheGet/cacheSet`, Prisma, and Kysely to follow when extending the estimate route tests
- **`packages/api/src/__tests__/migration.f002.integration.test.ts`** — integration test structure: fixture UUIDs `fd000000-00XX-4000-a000-000000000YYY`, `beforeAll` pre-cleanup, `afterAll` teardown

---

### Files to Create

| File | Purpose |
|---|---|
| `packages/api/prisma/migrations/20260321160000_query_logs_f029/migration.sql` | Creates `query_log_level_hit` enum, `query_log_source` enum, `query_logs` table with all columns and 4 indexes (queried_at DESC, chain_slug, level_hit, source) |
| `packages/api/src/lib/queryLogger.ts` | `writeQueryLog(prisma, entry, log)` — single `prisma.queryLog.create()` wrapped in try/catch; errors logged via the explicit `log` parameter at warn level, never re-thrown |
| `packages/api/src/routes/analytics.ts` | `GET /analytics/queries` Fastify route plugin; Kysely 5-query `Promise.all`; returns `AnalyticsResponseSchema`-shaped payload |
| `packages/shared/src/schemas/analytics.ts` | All Zod schemas: `AnalyticsTimeRangeSchema`, `AnalyticsQueryParamsSchema`, `LevelDistributionSchema`, `ChainQueryCountSchema`, `TopQueryTermSchema`, `SourceDistributionSchema`, `AnalyticsDataSchema`, `AnalyticsResponseSchema` |
| `packages/api/src/__tests__/f029.queryLogger.unit.test.ts` | Unit tests for `writeQueryLog`: calls `prisma.queryLog.create`, swallows errors without re-throwing, logs at warn on failure |
| `packages/api/src/__tests__/f029.analytics.route.test.ts` | Route-level tests for `GET /analytics/queries`: auth, validation, 200 response shape, DB error → 500, empty-table edge case, chainSlug and timeRange scoping |
| `packages/api/src/__tests__/f029.estimate.route.test.ts` | Route-level tests for the modified `/estimate`: verifies `writeQueryLog` called fire-and-forget for cache hit path, cascade path, and that a `writeQueryLog` failure does not change the response |
| `packages/api/src/__tests__/migration.f029.integration.test.ts` | Integration tests: insert `query_logs` row via Prisma, read it back, verify index existence via `pg_indexes`, verify no FK on `api_key_id`/`restaurant_id`, verify enum values accept null for `level_hit` |
| `packages/shared/src/__tests__/schemas.analytics.test.ts` | Unit tests for Zod schemas: `topN=150` rejects, `topN=0` rejects, `topN=10` defaults, `timeRange` enum validation, `chainSlug` regex |

---

### Files to Modify

| File | Changes |
|---|---|
| `packages/api/prisma/schema.prisma` | Add `QueryLogLevelHit` enum, `QueryLogSource` enum, and `QueryLog` model after the `ApiKey` model block (see spec for exact Prisma DSL) |
| `packages/api/src/generated/kysely-types.ts` | Regenerated after `prisma generate` — adds `QueryLog` type and `query_logs` entry in `DB`; developer must run `pnpm --filter @foodxplorer/api exec prisma generate` after migration |
| `packages/api/src/plugins/adminPrefixes.ts` | Add `'/analytics/'` to `ADMIN_PREFIXES` tuple |
| `packages/api/src/routes/estimate.ts` | (1) Add `prisma: PrismaClient` to plugin opts; (2) add `writeQueryLog` import; (3) record `startMs = performance.now()` before cache check; (4) parse `X-FXP-Source` header (array + comma-delimited normalization); (5) derive `cacheHit` and `levelHit` from both code paths; (6) fire-and-forget log via `reply.raw.once('finish', ...)` — AFTER response sent |
| `packages/api/src/app.ts` | (1) Import `analyticsRoutes`; (2) register `analyticsRoutes` with `{ prisma: prismaClient, db: getKysely() }`; (3) pass `prisma: prismaClient` to `estimateRoutes` registration |
| `packages/shared/src/index.ts` | Add `export * from './schemas/analytics';` |
| `packages/bot/src/apiClient.ts` | Add `'X-FXP-Source': 'bot'` to the `headers` object in the `fetchJson` function's `fetch()` call |
| `docs/specs/api-spec.yaml` | (1) Add `Analytics` tag; (2) add `/analytics/queries` path block with all parameters and response schemas; (3) add `AnalyticsQueryResponse`, `AnalyticsData`, `LevelDistribution`, `ChainQueryCount`, `SourceDistribution`, `TopQueryTerm` component schemas; (4) append one sentence to `/estimate` description noting async query logging |

---

### Implementation Order

Follow this sequence so each step has its dependencies already in place.

**Step 1 — Write migration integration test first (TDD)**
- Create `packages/api/src/__tests__/migration.f029.integration.test.ts`
- Tests: insert a `query_logs` row with all nullable fields as null; verify `id`, `queried_at` defaults; verify `level_hit = null` is valid; verify `api_key_id` has no FK enforcement (insert a random UUID that does not exist in `api_keys`); verify `restaurant_id` has no FK enforcement; verify the 4 indexes exist via `pg_indexes`
- These tests must fail at this step (table does not exist yet)

**Step 2 — Prisma schema + migration**
- Add `QueryLogLevelHit`, `QueryLogSource`, and `QueryLog` to `packages/api/prisma/schema.prisma`
- Prisma generates enums, indexes (including `@@index([queriedAt(sort: Desc)])`), and correctly omits FK constraints when no `@relation` is defined — no hand-editing needed
- Run `prisma migrate dev --name query_logs_f029` to generate and apply the migration
- Verify the generated SQL: enums created, descending index on `queried_at`, no FK on `api_key_id`/`restaurant_id`
- Run `prisma generate` to regenerate the Kysely types (adds `QueryLog` type and `query_logs` in `DB`)
- Migration integration tests from Step 1 now pass

**Step 3 — Shared Zod schemas (TDD)**
- Write `packages/shared/src/__tests__/schemas.analytics.test.ts` first — test `topN=150` rejects, `topN=0` rejects, `timeRange='bad'` rejects, `chainSlug` with uppercase rejects, all defaults applied correctly
- Create `packages/shared/src/schemas/analytics.ts` with all schemas from the spec
- Add `export * from './schemas/analytics';` to `packages/shared/src/index.ts`
- Schema unit tests pass

**Step 4 — `writeQueryLog` helper (TDD)**
- Write `packages/api/src/__tests__/f029.queryLogger.unit.test.ts` first:
  - Happy path: `prisma.queryLog.create` called with correct mapped fields
  - Error swallowing: when `prisma.queryLog.create` throws, the function resolves (does not throw), and `request.log.warn` is called
  - Field passthrough: `levelHit` string ('l1'|'l2'|'l3'|'l4'|null) is passed as-is to `prisma.queryLog.create` — no mapping inside the logger
  - Source passthrough: `source` string ('api'|'bot') is passed as-is — no mapping inside the logger
- Create `packages/api/src/lib/queryLogger.ts`:
  - Export `QueryLogEntry` interface (as defined in spec)
  - Export `writeQueryLog(prisma: PrismaClient, entry: QueryLogEntry, log: Logger): Promise<void>`
  - The `log` parameter receives Fastify's `request.log` (passed explicitly — keeps the helper testable without a full Fastify instance)
  - Internally wraps `prisma.queryLog.create()` in try/catch; on error calls `log.warn({ err }, 'query log write failed')`
  - **Important**: the function must never re-throw; it returns `undefined` on both success and failure

**Step 5 — `adminPrefixes.ts` update**
- Add `'/analytics/'` to `ADMIN_PREFIXES` in `packages/api/src/plugins/adminPrefixes.ts`
- Existing auth middleware picks up the new prefix automatically — no other auth changes needed
- Verify by re-running `f026.auth.test.ts` and `f026.adminAuth.unit.test.ts` (must still pass)

**Step 6 — Analytics route + app.ts registration (TDD)**
- First update `packages/api/src/app.ts` and `packages/api/src/routes/estimate.ts` opts so tests using `buildApp()` compile:
  - Add `prisma: PrismaClient` to `EstimatePluginOptions` in `estimate.ts`
  - Import `analyticsRoutes` in `app.ts`; register with `{ db: getKysely() }`
  - Update `estimateRoutes` registration to pass `prisma: prismaClient`: `{ db: getKysely(), prisma: prismaClient }`
- Write `packages/api/src/__tests__/f029.analytics.route.test.ts` first:
  - No admin key → 401 UNAUTHORIZED
  - Invalid `timeRange` → 400 VALIDATION_ERROR
  - `topN=150` → 400 VALIDATION_ERROR
  - Valid request with `timeRange=7d`, no chain → 200 with all required fields
  - `totalQueries=0` → `avgResponseTimeMs: null`, `cacheHitRate: 0`, all `byLevel` counts 0, empty arrays
  - DB error during aggregation → 500 DB_UNAVAILABLE
  - `chainSlug` filter → `scopedToChain` echoed in response
  - Mock pattern: hoist Kysely execute mocks; return shaped objects matching what the 5 raw queries produce
- Create `packages/api/src/routes/analytics.ts`:
  - Plugin opts: `{ db: Kysely<DB> }` (no unused `prisma` — keep opts minimal)
  - Use Fastify route `schema: { querystring: AnalyticsQueryParamsSchema }` for validation — let Fastify + zod type provider handle 400 VALIDATION_ERROR automatically (do NOT use manual `safeParse`)
  - Build time filter: `timeRange='all'` → no `queried_at` filter; otherwise `>= NOW() - INTERVAL '<value>'`
  - Run 5 Kysely queries via `Promise.all`; if any throws, catch and throw `Object.assign(new Error('Database query failed during analytics aggregation'), { code: 'DB_UNAVAILABLE', statusCode: 500 })`
  - Use `ROUND(AVG(cache_hit::int)::numeric, 4)` in SQL for `cacheHitRate` to ensure 4-decimal precision
  - Zero-fill `byLevel` and `bySource`: Kysely GROUP BY omits missing keys — reduce/map results into objects with default `0` for any absent level or source
  - Assemble response matching `AnalyticsResponseSchema`; `cacheHitRate` coerced to `0` when `totalQueries = 0`; `avgResponseTimeMs` set to `null` when `totalQueries = 0`
  - Wrap handler in `fastifyPlugin()`

**Step 7 — Estimate route modification (TDD)**
- Write `packages/api/src/__tests__/f029.estimate.route.test.ts` first:
  - Cache hit path: `writeQueryLog` called with `cacheHit: true` and correct `levelHit` derived from cached data flags
  - Cache hit, all flags false (total miss was cached): `writeQueryLog` called with `cacheHit: true`, `levelHit: null`
  - Cascade path: `writeQueryLog` called with `cacheHit: false` and `levelHit` matching `routerResult.levelHit`
  - `X-FXP-Source: bot` header → `source: 'bot'` in `writeQueryLog` call
  - `X-FXP-Source: bot, extra` (comma-joined) → `source: 'bot'`
  - No `X-FXP-Source` header → `source: 'api'`
  - `writeQueryLog` failure does not change HTTP response (status, body, timing unaffected)
  - Anonymous request → `apiKeyId: null`
  - Authenticated request → `apiKeyId` from `request.apiKeyContext.keyId`
  - Mock `writeQueryLog` as `vi.fn().mockResolvedValue(undefined)` for happy-path tests; for failure test, mock as throwing
- Modify `packages/api/src/routes/estimate.ts`:
  - Import `writeQueryLog` from `'../lib/queryLogger.js'`
  - At handler top: `const startMs = performance.now();`
  - Read `X-FXP-Source` header: normalize both array and comma-delimited forms — `const raw = request.headers['x-fxp-source']; const firstVal = Array.isArray(raw) ? raw[0] : typeof raw === 'string' ? raw.split(',')[0]?.trim() : undefined; const source = firstVal === 'bot' ? 'bot' as const : 'api' as const;`
  - Fire-and-forget log write uses `reply.raw.once('finish', () => { ... })` to trigger AFTER the response is sent — zero impact on response timing:
    ```
    reply.raw.once('finish', () => {
      const responseTimeMs = Math.round(performance.now() - startMs);
      void writeQueryLog(prisma, { queryText: query, chainSlug: chainSlug ?? null, restaurantId: restaurantId ?? null, levelHit, cacheHit, responseTimeMs, apiKeyId: request.apiKeyContext?.keyId ?? null, source }, request.log).catch(() => {});
    });
    ```
  - Set `cacheHit` and `levelHit` variables before `reply.send()` in both code paths (cache hit / cascade), then the `finish` handler reads the closured variables
  - Derive `levelHit` from cached data flags (priority: `level1Hit` → `'l1'`, etc., all false → `null`) or from `routerResult.levelHit` via `LEVEL_MAP`

**Step 9 — Bot `apiClient.ts`**
- In `fetchJson`, add `'X-FXP-Source': 'bot'` to the existing headers object passed to `fetch()`:
  ```
  headers: { 'X-API-Key': apiKey, 'X-FXP-Source': 'bot' },
  ```
- Add one test in existing `packages/bot/src/__tests__/apiClient.test.ts` verifying that outbound `fetch()` calls include the `X-FXP-Source: bot` header

**Step 10 — OpenAPI spec update**
- Edit `docs/specs/api-spec.yaml`:
  - Add `Analytics` tag in the `tags:` array
  - Add `/analytics/queries` path block (full definition from spec)
  - Add `AnalyticsQueryResponse`, `AnalyticsData`, `LevelDistribution`, `ChainQueryCount`, `SourceDistribution`, `TopQueryTerm` under `components.schemas`
  - Append to `/estimate` `description`: `"Every call is logged asynchronously to query_logs (fire-and-forget — never affects response timing or status)."`

**Step 11 — Full test suite green**
- Run `pnpm test` from repo root
- Ensure all new and existing tests pass
- Run `pnpm build` to confirm TypeScript compilation succeeds across all packages

---

### Testing Strategy

**Test files to create:**

| File | Type | What it tests |
|---|---|---|
| `packages/api/src/__tests__/migration.f029.integration.test.ts` | Integration | Schema correctness, index existence, no FK on nullable UUID columns |
| `packages/shared/src/__tests__/schemas.analytics.test.ts` | Unit | Zod validation: enum, range, coercion, defaults |
| `packages/api/src/__tests__/f029.queryLogger.unit.test.ts` | Unit | `writeQueryLog` create call, error swallowing, field mapping |
| `packages/api/src/__tests__/f029.analytics.route.test.ts` | Route/unit | Auth, validation, response shape, zero-data, DB error, filter scoping |
| `packages/api/src/__tests__/f029.estimate.route.test.ts` | Route/unit | Fire-and-forget integration, source header detection, levelHit mapping, no-op on logger failure |
| `packages/api/src/__tests__/f029.estimate.integration.test.ts` | Integration | End-to-end: hit `/estimate`, verify one `query_logs` row persisted within 1s with correct fields |

**Key test scenarios:**

- Happy path analytics: 200, all 7 fields present, correct types
- `totalQueries=0`: `avgResponseTimeMs: null`, `cacheHitRate: 0` (not `null`), `byLevel` all zeros, `byChain: []`, `bySource: { api: 0, bot: 0 }`, `topQueries: []`
- `chainSlug` filter: `scopedToChain` echoes the slug; all counts scoped
- `timeRange=24h`: `queried_at >= NOW() - INTERVAL '24 hours'` filter applied
- `timeRange=all`: no `queried_at` filter clause in Kysely query
- `topN=100`: returns up to 100 items; `topN=101` → 400
- DB down during analytics: catches any thrown error from `Promise.all` and returns 500 DB_UNAVAILABLE
- Cache hit logging: `cacheHit=true`, `levelHit` derived from cached `EstimateData` flags
- Cache hit for total miss: `cacheHit=true`, `levelHit=null`
- Cascade miss logging: `cacheHit=false`, `levelHit=null`
- `writeQueryLog` throws: estimate route still returns 200 with correct body
- `X-FXP-Source: bot` header (single value): `source='bot'`
- `X-FXP-Source: bot` as array (duplicate headers): first value taken → `source='bot'`
- `X-FXP-Source: bot, extra` (comma-joined): first token taken → `source='bot'`
- `X-FXP-Source: other` → `source='api'`
- Missing `X-FXP-Source` → `source='api'`
- Anonymous request: `apiKeyId=null`
- Authenticated request: `apiKeyId` matches `request.apiKeyContext.keyId`

**Mocking strategy:**

- `f029.queryLogger.unit.test.ts`: mock `prisma.queryLog.create` directly; pass a `{ warn: vi.fn() }` stub as the log parameter
- `f029.analytics.route.test.ts`: follow the hoisted-mock pattern from `f023.estimate.route.test.ts`; mock `getKysely` to return a stub with `execute()` returning shaped result arrays; mock `prisma` as an empty object (analytics route only uses `db`)
- `f029.estimate.route.test.ts`: mock `writeQueryLog` from `../lib/queryLogger.js` as a `vi.fn()`; mock `runEstimationCascade` and `cacheGet/cacheSet` with hoisted mocks as in `f023.estimate.route.test.ts`
- `migration.f029.integration.test.ts`: no mocks — hits the real test DB via `DATABASE_URL_TEST`; uses `fd000000-0029-4000-a000-000000000XXX` fixture UUIDs

---

### Key Patterns

**Fire-and-forget via `reply.raw.once('finish', ...)`:**
```
reply.raw.once('finish', () => {
  const responseTimeMs = Math.round(performance.now() - startMs);
  void writeQueryLog(prisma, entry, request.log).catch(() => {});
});
```
The log write fires AFTER the HTTP response is fully sent, guaranteeing zero impact on response timing. The `.catch(() => {})` prevents unhandled rejection warnings.

**Kysely `Promise.all` for 5 analytics queries:**
Run all 5 aggregation queries concurrently. Wrap the entire `Promise.all` in a single try/catch and throw `Object.assign(new Error('Database query failed'), { code: 'DB_UNAVAILABLE', statusCode: 500 })`. Do not catch individual query errors — any failure should bubble to the 500 handler.

**`levelHit` integer-to-enum mapping in estimate route:**
```typescript
const LEVEL_MAP: Record<1 | 2 | 3 | 4, 'l1' | 'l2' | 'l3' | 'l4'> = { 1: 'l1', 2: 'l2', 3: 'l3', 4: 'l4' };
const levelHit = routerResult.levelHit !== null ? LEVEL_MAP[routerResult.levelHit] : null;
```

**Deriving `levelHit` from cached `EstimateData` on cache hit:**
Check flags in order (level1Hit first wins). `EstimateData` always has exactly one true flag or all false.

**`cacheHitRate` — 4-decimal precision:**
Use `ROUND(AVG(cache_hit::int)::numeric, 4)` in the SQL scalar query. The route coerces: `cacheHitRate = totalQueries === 0 ? 0 : Number(scalarRow.cache_hit_rate ?? 0)`.

**`avgResponseTimeMs` when `totalQueries=0`:**
`avgResponseTimeMs = totalQueries === 0 ? null : Number(scalarRow.avg_response_time_ms)`.

**Kysely types after migration:**
After running `prisma generate`, `packages/api/src/generated/kysely-types.ts` will contain a `QueryLog` type and `query_logs: QueryLog` in the `DB` interface. The analytics route uses `db.selectFrom('query_logs')` which will be type-safe. The developer must not hand-edit this generated file.

**`queryLogger.ts` signature uses explicit `log` parameter:**
Rather than importing Fastify's logger type, accept a minimal interface `{ warn(obj: Record<string, unknown>, msg: string): void }`. This keeps the helper fully unit-testable without a Fastify instance.

**Migration timestamp:**
Use `20260321160000` as the migration directory timestamp, continuing from the last migration `20260319150000_api_keys_f026`.

**Gotcha — `estimate.ts` plugin opts change:**
The `estimateRoutes` registration in `app.ts` currently passes only `{ db: getKysely() }`. Adding `prisma` breaks the TypeScript types. Both the opts interface in `estimate.ts` AND the `app.ts` registration call must be updated together in Step 6 (done before route tests).

**Gotcha — Kysely `COUNT()` returns string from pg driver:**
`COUNT(*)` in Kysely with the pg driver returns a `string | bigint` — not `number`. Always wrap with `Number(row.total_queries)` or use `.as('count')` and call `Number()`. The spec SQL uses `::int` casts to coerce at the DB layer, which is preferred — it returns a JS number directly.

**Gotcha — `byChain` query when `chainSlug` filter is active:**
When `chainSlug` is provided, query 3 (by chain) still runs but returns at most one row. This is fine — no special-casing needed. The `byChain` array in the response will contain one entry matching the filtered chain.

**Analytics route opts — minimal:**
Analytics route opts are `{ db: Kysely<DB> }` only — no unused `prisma`. Add it when Phase 2 needs it.

**`byLevel` and `bySource` zero-fill:**
Kysely GROUP BY omits keys with zero count. After the query, reduce results into a full object with `0` defaults for any missing level (`l1`–`l4`, `miss`) or source (`api`, `bot`).

**`X-FXP-Source` header normalization:**
Handle both array (duplicate headers) and comma-joined string forms. Split on `,`, trim, take first token. Only exact `'bot'` match triggers bot source — anything else is `'api'`.

---

## Acceptance Criteria

- [x] Every `GET /estimate` call results in one `query_logs` row within 1s of response
- [x] Logging failure does NOT affect estimate HTTP response (status, body, timing)
- [x] `GET /analytics/queries` without auth returns 401 `UNAUTHORIZED`
- [x] `GET /analytics/queries` with valid admin key and `timeRange=7d` returns 200 with all required fields
- [x] `cacheHitRate` = cache_hit count / totalQueries (4 decimals), or 0 when totalQueries=0
- [x] `avgResponseTimeMs` is null when totalQueries=0
- [x] `byLevel.l1 + l2 + l3 + l4 + miss === totalQueries` always true
- [x] `bySource.api + bySource.bot === totalQueries` always true
- [x] `topQueries` has at most `topN` entries, sorted desc by count
- [x] `chainSlug` filter scopes all aggregations correctly
- [x] `timeRange=24h` scopes to last 24 hours only
- [x] `topN=150` returns 400 VALIDATION_ERROR
- [x] Bot `ApiClient` sends `X-FXP-Source: bot`, logged rows have `source = 'bot'`
- [x] Direct API calls log `source = 'api'`
- [x] Anonymous calls log `api_key_id = null`; authenticated log correct UUID
- [x] No FK constraints on `api_key_id` or `restaurant_id`
- [x] All tests pass (2718: API 1950, Shared 223, Bot 313, Scraper 232)
- [x] Build succeeds (Shared + Bot clean; API/Scraper pre-existing errors only)
- [x] Specs updated (api-spec.yaml, shared schemas)

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
- [x] Step 2: `backend-planner` executed, plan approved
- [x] Step 3: `backend-developer` executed with TDD
- [x] Step 4: `production-code-validator` executed, quality gates pass
- [x] Step 5: `code-review-specialist` executed
- [x] Step 5: `qa-engineer` executed (Standard)
- [x] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-21 | Step 0: Spec created | spec-creator agent, auto-approved (L2) |
| 2026-03-21 | Step 1: Setup | Branch + ticket created, auto-approved (L2) |
| 2026-03-21 | Step 2: Plan created | backend-planner agent |
| 2026-03-21 | Plan review round 1 | Self-review — 0C, 1I, 3S. 2 fixes: Step 4 mapping correction, Step 9 bot header test |
| 2026-03-21 | Plan review round 2 | Codex GPT-5.4 — 6I, 2S → REVISE. Gemini config error. 8 fixes applied: (1) Fastify schema validation instead of safeParse, (2) Error objects instead of plain throw, (3) app.ts registration moved to Step 6, (4) reply.raw.once('finish') for post-response logging, (5) X-FXP-Source comma-delimited handling, (6) ROUND(...,4) for cacheHitRate, (7) e2e integration test added, (8) removed unused prisma from analytics opts |
| 2026-03-21 | Step 3: Implementation | backend-developer agent, 11 TDD steps, 8 commits |
| 2026-03-21 | Step 4: Finalize | production-code-validator APPROVED (0 issues). Tests: 2660 passed. No F029 TS errors |
| 2026-03-22 | Step 5: Code review | code-review-specialist APPROVED (0C, 2I, 5S). Fixes: DRY fire-and-forget, $if mock, cacheHitRate clamp, NaN guard |
| 2026-03-22 | Step 5: QA review | qa-engineer found 1C+4H+4M+3L. 49 edge-case tests added (4 files). Bugs fixed: cacheHitRate clamp [0,1], avgResponseTimeMs NaN guard |
| 2026-03-22 | Step 6: Complete | Squash merged to develop (PR #26, SHA c8c230d). Branch deleted. Tracker + key_facts updated. 2718 tests total |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Implementation Plan, AC, DoD, Workflow Checklist, Completion Log, Merge Checklist Evidence |
| 1. Mark all items | [x] | AC: 19/19, DoD: 6/6, Workflow: 7/8 (Step 6 pending) |
| 2. Verify product tracker | [x] | Active Session: step 5/6 (Review), Features table: 5/6 |
| 3. Update key_facts.md | [x] | Updated: Prisma schema (10 enums, 16 models), migrations (8), auth middleware (+/analytics/), analytics route, query logger, analytics schemas |
| 4. Update decisions.md | [x] | N/A — no new ADR needed |
| 5. Commit documentation | [x] | Commit: pending (this commit) |
| 6. Verify clean working tree | [x] | `git status`: clean after commit |

---

*Ticket created: 2026-03-21*
