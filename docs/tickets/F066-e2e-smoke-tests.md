# F066: E2E Smoke Tests

**Feature:** F066 | **Type:** Backend-Test | **Priority:** Low
**Status:** In Progress | **Branch:** feature/f066-e2e-smoke-tests
**Created:** 2026-03-30 | **Dependencies:** None
**Complexity:** Standard
**Audit Source:** Comprehensive Validation Phase 3 — Integration/E2E test assessment

---

## Spec

### Description

The current test suite (~4500+ tests) uses Fastify's `app.inject()` for route testing — in-process HTTP simulation that never binds a port. While fast and effective, it cannot catch issues in:

- Middleware/plugin registration order (only exercised at `app.listen()` time)
- Real HTTP header parsing (Content-Type, CORS preflight)
- Rate limiting with real Redis counters (disabled in test env via `NODE_ENV=test`)

This ticket adds a minimal E2E smoke test suite that starts a real HTTP server on a random port, makes real `fetch()` requests, and validates responses.

### Scope

Minimal smoke suite — NOT full API coverage. Goal: validate the server starts, routes are reachable, auth works, and CORS/rate-limit headers are present.

### E2E Tests (~10 tests)

1. **Server starts** — `app.listen({ port: 0 })` binds successfully, returns assigned port
2. **GET /health** — returns 200 with `{status: "ok"}`
3. **GET /estimate?query=big+mac** — returns 200 with result (anonymous, no API key)
4. **GET /estimate** (missing query) — returns 400 VALIDATION_ERROR
5. **GET /estimate with invalid API key** — returns 401 UNAUTHORIZED
6. **GET /chains?isActive=true** — returns 200 with array
7. **GET /quality/report with admin key** — returns 200 with data
8. **GET /quality/report without admin key** — returns 401 UNAUTHORIZED
9. **CORS preflight** — OPTIONS on /estimate returns Access-Control-Allow-Origin
10. **Rate limit headers** — X-RateLimit-Limit present on authenticated request

### Infrastructure

- **Test database:** `foodxplorer_test` on `localhost:5433` (already exists, shared with unit tests)
- **Redis:** `localhost:6380` (already exists)
- **Server:** bind on port `0` (OS assigns random available port) — avoids conflicts
- **Config:** separate `vitest.config.e2e.ts` with `NODE_ENV=development` (NOT `test`) so rate limiting plugin registers
- **Script:** `npm run test:e2e` in package.json — runs only E2E tests, separate from `npm test`
- **Test file:** single file `src/__tests__/e2e/smoke.e2e.test.ts`
- **ADMIN_API_KEY:** set in vitest env to a known value for test 7/8

### Edge Cases

- Rate limiting is skipped when `NODE_ENV=test`. E2E tests must use `NODE_ENV=development` to exercise the rate limit plugin.
- The test DB must have seed data (Big Mac) for test 3. If not seeded, test 3 returns `result: null` — still 200, but assertion should check for non-null result.
- `app.listen({ port: 0 })` returns the assigned port via `app.server.address()` — use this to construct the base URL.
- Server must be closed in `afterAll` to prevent port leaks.

### Non-Goals

- Full endpoint coverage (handled by inject-based tests)
- Performance/load testing
- Bot-to-API integration

---

## Implementation Plan

### Existing Code to Reuse

- `packages/api/src/app.ts` — `buildApp(opts: BuildAppOptions)` factory. E2E tests call this directly, then call `app.listen({ port: 0 })` on the returned instance. No changes needed.
- `packages/api/src/config.ts` — `Config` type and `EnvSchema`. The E2E vitest config injects env vars that satisfy this schema (NODE_ENV=development, DATABASE_URL, REDIS_URL, ADMIN_API_KEY).
- `packages/api/src/plugins/auth.ts` — Auth middleware already handles `ADMIN_API_KEY` from the injected config. When NODE_ENV=development and ADMIN_API_KEY is set, admin routes are gated.
- `packages/api/src/plugins/cors.ts` — In development env the plugin registers `@fastify/cors` with localhost origins. The CORS preflight test (test 9) will verify the `Access-Control-Allow-Origin` header appears in the OPTIONS response.
- `packages/api/src/plugins/rateLimit.ts` — In development env the plugin registers `@fastify/rate-limit` with Redis. The rate limit header test (test 10) relies on this.
- `packages/api/vitest.config.ts` — Reference for the structure and resolve aliases to copy into the new E2E config.

### Files to Create

1. `packages/api/vitest.config.e2e.ts`
   - Separate Vitest config for E2E tests.
   - Sets `NODE_ENV=development` (not `test`) so CORS and rate-limit plugins register.
   - Sets `DATABASE_URL` and `DATABASE_URL_TEST` pointing to `localhost:5433/foodxplorer_test` (shared with unit tests).
   - Sets `REDIS_URL=redis://localhost:6380`.
   - Sets `ADMIN_API_KEY` to a known ≥32-char string (e.g. `test-admin-key-for-e2e-smoke-00001`).
   - Sets `LOG_LEVEL=silent` to suppress pino-pretty output during tests.
   - Uses `include: ['src/__tests__/e2e/**/*.e2e.test.ts']` to scope to E2E files only.
   - Copies the same `resolve.alias` block from `vitest.config.ts` for `@foodxplorer/shared` and `@foodxplorer/scraper`.
   - Does NOT set `fileParallelism: false` — there is only one E2E test file so the default is fine.

2. `packages/api/src/__tests__/e2e/smoke.e2e.test.ts`
   - Single describe block: `E2E Smoke Tests`.
   - `beforeAll`: call `buildApp()` (no options — uses real Prisma, Redis, and config from env), then `await app.listen({ port: 0 })`. Derive the base URL from `(app.server.address() as AddressInfo).port` — import `AddressInfo` from `node:net`.
   - `afterAll`: `await app.close()`.
   - No mocks — the file must NOT use `vi.mock()`. These are real network calls against real infrastructure.
   - All HTTP calls use the global `fetch` API (Node 18+ built-in, available in Vitest test env).
   - 10 individual `it()` tests described below.

### Files to Modify

1. `packages/api/package.json`
   - Add script: `"test:e2e": "vitest run --config vitest.config.e2e.ts"`.
   - The existing `"test"` script (`vitest run`) must NOT be changed — it continues to use the default `vitest.config.ts` which excludes the `e2e/` subdirectory (because the default config has no `include` override, and Vitest's default include glob `**/*.{test,spec}.ts` would match `.e2e.test.ts` files if they are inside `src/__tests__/`).
   - **Important:** Add an `exclude` in the base `vitest.config.ts` to explicitly exclude `src/__tests__/e2e/**` so that `npm test` never picks up E2E tests. See Key Patterns for detail.

2. `packages/api/vitest.config.ts`
   - Add `exclude: ['src/__tests__/e2e/**']` inside the `test:` block to prevent `npm test` from picking up the new E2E test file.

### Implementation Order

1. **vitest.config.ts** — Add the `exclude` entry first so the unit test suite remains clean from the start.

2. **vitest.config.e2e.ts** — Create the E2E Vitest config. At this stage `npm run test:e2e` will fail (no test file yet), which is the expected TDD red state.

3. **package.json** — Add the `test:e2e` script so the developer can run `npm run test:e2e` as part of the TDD loop.

4. **smoke.e2e.test.ts** — Write all 10 tests. Implement them one by one in the order listed in the Spec:

   - **Test 1 — Server starts:** Assert that `app.server.address()` returns an object with a numeric `port > 0`. This is a structural check on the `beforeAll` setup itself; write as a standalone `it()` that simply asserts on the `baseUrl` string already constructed.

   - **Test 2 — GET /health returns 200:** `fetch(baseUrl + '/health')` → status 200 → JSON body `{ status: 'ok' }`.

   - **Test 3 — GET /estimate?query=big+mac returns 200:** `fetch(baseUrl + '/estimate?query=big+mac')` → status 200 → JSON body has shape `{ success: true, data: { result: ... } }`. Assert `result` is either a non-null object or null (both are valid depending on seed state — do not skip, just check the 200 and shape). Add an inline comment documenting the seed dependency.

   - **Test 4 — GET /estimate (missing query) returns 400:** `fetch(baseUrl + '/estimate')` → status 400 → body `error.code === 'VALIDATION_ERROR'`.

   - **Test 5 — GET /estimate with invalid API key returns 401:** `fetch(baseUrl + '/estimate?query=test', { headers: { 'x-api-key': 'fxp_invalid_key_not_in_db_00000000' } })` → status 401 → body `error.code === 'UNAUTHORIZED'`. The key is not in the DB so auth throws UNAUTHORIZED. Note: this is a public route, so auth only fires if a key header IS provided.

   - **Test 6 — GET /chains?isActive=true returns 200:** `fetch(baseUrl + '/chains?isActive=true')` → status 200 → JSON body `{ success: true, data: Array }`. Assert `Array.isArray(body.data)`.

   - **Test 7 — GET /quality/report with admin key returns 200:** `fetch(baseUrl + '/quality/report', { headers: { 'x-api-key': ADMIN_API_KEY } })` → status 200 → body `{ success: true, data: ... }`. `ADMIN_API_KEY` is read from `process.env['ADMIN_API_KEY']` inside the test (it was injected by the E2E vitest config).

   - **Test 8 — GET /quality/report without admin key returns 401:** `fetch(baseUrl + '/quality/report')` → status 401 → body `error.code === 'UNAUTHORIZED'` with message `'Admin API key required'`.

   - **Test 9 — CORS preflight returns Access-Control-Allow-Origin:** `fetch(baseUrl + '/estimate', { method: 'OPTIONS', headers: { 'Origin': 'http://localhost:3000', 'Access-Control-Request-Method': 'GET' } })` → response headers contain `access-control-allow-origin`. Assert `response.headers.get('access-control-allow-origin')` is not null.

   - **Test 10 — Rate limit headers present on request to /estimate:** `fetch(baseUrl + '/estimate?query=test')` → response headers contain `x-ratelimit-limit`. Assert `response.headers.get('x-ratelimit-limit')` is not null. Note: `/health` is exempt from rate limiting (allowList in rateLimit.ts) — use `/estimate` which is not exempt.

### Testing Strategy

**Test files to create:**
- `packages/api/src/__tests__/e2e/smoke.e2e.test.ts` (the E2E suite itself)

**No additional unit tests** — this ticket is the test implementation. The existing unit test suite remains unchanged.

**Happy path scenarios:**
- Server binds on port 0
- /health responds correctly
- /estimate with valid query (test 3 — seed-dependent, non-null result)
- /chains with filter returns array
- /quality/report with valid admin key returns 200

**Edge cases:**
- /estimate without query param → 400 VALIDATION_ERROR
- /estimate with invalid API key header → 401 UNAUTHORIZED (auth fires because a key header was supplied, even on a public route)
- /quality/report without any key → 401 UNAUTHORIZED (admin route, always gated when ADMIN_API_KEY is configured)

**Infrastructure checks:**
- CORS preflight for /estimate returns Access-Control-Allow-Origin
- Rate limit header appears on /estimate (NODE_ENV=development enables the plugin)

**Mocking strategy:**
- None. E2E tests use no `vi.mock()` — all calls are real: real Fastify server, real Prisma connection to `foodxplorer_test`, real Redis on port 6380. This is the entire point of the ticket.

**Isolation:** The test suite is isolated from the unit suite by:
- Separate vitest config files
- Separate npm scripts
- `exclude` in `vitest.config.ts`

### Key Patterns

**Port 0 / AddressInfo pattern:**
```
// After app.listen({ port: 0 })
import type { AddressInfo } from 'node:net';
const { port } = app.server.address() as AddressInfo;
const baseUrl = `http://127.0.0.1:${port}`;
```
`app.server` is Node's `http.Server` — `.address()` returns `AddressInfo | string | null`. Cast to `AddressInfo` after confirming the listen succeeded.

**buildApp() in E2E context:** Unlike unit tests that pass `{ config, prisma, redis }` overrides, the E2E test calls `buildApp()` with no arguments. The real `defaultConfig` is used (parsed from `process.env`, which the Vitest config populates). The real `defaultPrisma` and `defaultRedis` singletons are used — these connect to the test DB and test Redis.

**NODE_ENV=development is critical:** Both `registerCors` and `registerRateLimit` check `if (config.NODE_ENV === 'test') return` — they are no-ops in test mode. The E2E config MUST set `NODE_ENV=development`, not `test`. This is already established in `rateLimit.test.ts` (see the `devConfig` fixture in that file).

**ADMIN_API_KEY in vitest env:** The E2E config sets `ADMIN_API_KEY` in the `test.env` block. At test runtime, `process.env.ADMIN_API_KEY` is set, so `parseConfig(process.env)` in `config.ts` will parse it into `defaultConfig.ADMIN_API_KEY`. The test reads it back as `process.env['ADMIN_API_KEY']` for use in test 7. The value must be ≥32 chars to pass `EnvSchema` validation.

**`npm test` exclusion:** Vitest's default include pattern matches `**/*.test.ts` — this means `smoke.e2e.test.ts` WILL be picked up by `npm test` unless explicitly excluded. The `exclude` entry in `vitest.config.ts` is mandatory.

**Test 3 seed caveat:** The E2E test suite uses the shared `foodxplorer_test` database. Test 3 (`/estimate?query=big+mac`) calls the real estimation engine which requires seeded data (dishes, food_nutrients, embeddings). The assertion should be permissive: verify `response.status === 200` and `body.success === true`, but allow `body.data.result` to be `null`. Add a comment: `// result may be null if the test DB has no Big Mac — 200 is still the correct response shape`. This avoids a brittle test while still exercising the full HTTP path.

**Test 5 key format:** The invalid key must start with `fxp_` to pass the key-format guard in the auth middleware (if any prefix validation exists), but its hash will not be in the DB. Use `'fxp_invalid_key_not_in_db_00000000'` (exactly 36 chars to match typical key length). If the auth plugin has no prefix requirement, any non-empty string that is not in the DB will do.

**pino-pretty in development env:** Setting `LOG_LEVEL=silent` in the E2E vitest config suppresses pino-pretty output, keeping test output clean. Without this, the `development` branch in `buildApp()` enables the pino-pretty transport which pollutes test output.

**Reference for rateLimit skip pattern:** `packages/api/src/__tests__/rateLimit.test.ts` — particularly the `devConfig` fixture and the `registerRateLimit — development env (plugin active)` describe block. This confirms the pattern of using `NODE_ENV=development` with `buildApp({ config: devConfig })` to exercise the rate-limit plugin. The E2E approach differs in that NODE_ENV is set globally via the vitest config rather than per-test via a config override, but the underlying mechanism is identical.

---

## Acceptance Criteria

- [ ] 10 E2E smoke tests pass
- [ ] `npm run test:e2e` script exists and runs only E2E tests
- [ ] `npm test` (unit tests) does NOT include E2E tests
- [ ] Tests start a real HTTP server and make real fetch() requests
- [ ] Tests clean up (server.close()) in afterAll
- [ ] Rate limit headers verified (requires NODE_ENV=development)
- [ ] CORS headers verified
- [ ] All existing tests still pass (0 regressions)
- [ ] Build succeeds
- [ ] TypeScript strict — no `any`

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] E2E tests written and passing
- [ ] Code follows project standards
- [ ] No linting errors
- [ ] Build succeeds
- [ ] Specs reflect final implementation (key_facts.md updated)

---

## Workflow Checklist

- [ ] Step 0: Spec reviewed, self-review passed
- [ ] Step 1: Branch created, ticket generated, tracker updated
- [ ] Step 2: `backend-planner` executed, plan approved
- [ ] Step 3: `backend-developer` executed with TDD
- [ ] Step 4: `production-code-validator` executed, quality gates pass
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 5: `qa-engineer` executed
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-30 | Ticket created | From comprehensive validation Phase 3 |
| 2026-03-30 | Step 0: Spec | Self-review passed. Standard complexity |

---

## Merge Checklist Evidence

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | |
| 1. Mark all items | [ ] | |
| 2. Verify product tracker | [ ] | |
| 3. Update key_facts.md | [ ] | |
| 4. Update decisions.md | [ ] | |
| 5. Commit documentation | [ ] | |
| 6. Verify clean working tree | [ ] | |

---

*Ticket created: 2026-03-30*
