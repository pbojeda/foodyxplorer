# F004: Fastify API Scaffold

**Feature:** F004 | **Type:** Backend-Feature | **Priority:** High
**Status:** In Progress | **Branch:** feature/F004-fastify-api-scaffold
**Created:** 2026-03-11 | **Dependencies:** F001 + F001b + F002 + F003 complete

---

## Spec

### Description

Bootstrap the Fastify HTTP server for `packages/api`. This is the first running
server — all future feature work (F007+) will add routes on top of this
scaffold. The scaffold must be production-aware from day one: typed environment
config, structured logging, OpenAPI documentation, Zod-driven request/response
validation, consistent error envelope, CORS for local development, and graceful
shutdown.

The existing `packages/api/src/server.ts` is a placeholder with ~14 lines. This
feature replaces it with a production-quality structure, splitting into `app.ts`
(plugin registration, testable) and `server.ts` (process entry point, binds
port).

---

### Architecture Decisions

**`app.ts` / `server.ts` split (testability)**
The Fastify instance is built and all plugins are registered in `app.ts`. The
`server.ts` entry point imports `buildApp()`, calls `server.listen()`, and wires
graceful shutdown. Tests import `buildApp()` directly — no port binding needed.

**`fastify-type-provider-zod` as the Zod bridge**
`fastify-type-provider-zod` makes Fastify use Zod schemas natively for
request/response validation. The schema is inferred by TypeScript, validated at
runtime, and serialised into the OpenAPI spec automatically — no manual JSON
Schema translation needed.

**Environment config validated at startup**
All environment variables are parsed and validated with Zod before the server
starts. If any required variable is missing or malformed, the process exits with
a descriptive message. Config is exported as a typed singleton, never accessed
via raw `process.env` in route handlers.

**Error envelope is the project standard**
`{ success: false, error: { message, code, details? } }` — aligns with
`backend-standards.mdc` and the `ErrorResponse` schema in `api-spec.yaml`.
Zod validation errors are mapped to `{ code: "VALIDATION_ERROR", details: [...] }`.

---

### File Structure

```
packages/api/src/
├── app.ts                        # buildApp() — registers plugins and routes
├── server.ts                     # Entry point — calls buildApp(), listen(), shutdown
├── config.ts                     # EnvSchema (Zod) + typed Config export
├── plugins/
│   ├── swagger.ts                # @fastify/swagger + @fastify/swagger-ui registration
│   └── cors.ts                   # @fastify/cors registration
├── routes/
│   └── health.ts                 # GET /health route
└── errors/
    └── errorHandler.ts           # Global setErrorHandler + notFound handler
```

> Note: `__tests__/` files already live in `src/__tests__/` per the existing
> convention. New tests for F004 follow the same location.

---

### Config Schema

Defined in `packages/api/src/config.ts` using Zod. The server will exit at
startup if validation fails.

```
EnvSchema = z.object({
  NODE_ENV  : z.enum(["development", "test", "production"]).default("development")
  PORT      : z.coerce.number().int().min(1).max(65535).default(3001)
  DATABASE_URL      : z.string().url()
  DATABASE_URL_TEST : z.string().url().optional()   // only required when NODE_ENV=test
  LOG_LEVEL : z.enum(["fatal","error","warn","info","debug","trace"]).default("info")
})

Config = z.infer<typeof EnvSchema>
```

The parsed config object is exported as a named constant and injected into
`buildApp()` as a parameter (defaults to the parsed singleton so production
code does not need to pass it, but tests can override).

---

### API Endpoints

#### `GET /health`

Returns server liveness. An optional `?db=true` query parameter triggers a
lightweight DB connectivity check (`SELECT 1` via `prisma.$queryRaw`).

**Request**

| Parameter | In    | Type    | Required | Description                          |
|-----------|-------|---------|----------|--------------------------------------|
| `db`      | query | boolean | No       | Set to `true` to check DB connectivity |

**Success Response — 200**

```
{
  status    : "ok"
  timestamp : string   // ISO 8601 — new Date().toISOString()
  version   : string   // process.env.npm_package_version ?? "0.0.0"
  uptime    : number   // process.uptime() in seconds
  db?       : "connected" | "unavailable"  // present only when ?db=true
}
```

**Error Response — 500** (only when `?db=true` and DB is unreachable)

```
{
  success : false
  error : {
    message : "Database connectivity check failed"
    code    : "DB_UNAVAILABLE"
  }
}
```

**Behaviour notes:**
- The endpoint NEVER returns 4xx — it has no user-controlled inputs that can
  fail validation (the `db` query param is boolean, not required).
- DB failure when `?db=true` returns 500 with the standard error envelope, not
  a raw Fastify error.
- The `db` field is omitted entirely from the response when `?db=true` is not
  passed (not `null`, not `"unknown"` — absent).

---

### Swagger / OpenAPI

- Plugin: `@fastify/swagger` + `@fastify/swagger-ui`
- UI endpoint: `GET /docs` (per key_facts.md)
- JSON spec endpoint: `GET /docs/json`
- Spec info mirrors `docs/specs/api-spec.yaml`: title "foodXPlorer API",
  version read from `package.json`.
- All routes must declare `tags` for grouping. The health route uses tag
  `"System"`.
- Swagger is registered only when `NODE_ENV !== "test"` to keep test output
  clean and avoid port conflicts in Vitest's parallel runs.

---

### CORS Configuration

Registered via `@fastify/cors` in `plugins/cors.ts`.

| Environment   | Allowed Origins                         |
|---------------|-----------------------------------------|
| development   | `http://localhost:3000`, `http://localhost:5173` (Vite default) |
| test          | CORS disabled (not registered)          |
| production    | Explicit allowlist via `CORS_ORIGINS` env var (comma-separated). Empty list → CORS disabled. |

Methods allowed: `GET, POST, PUT, PATCH, DELETE, OPTIONS`
Headers allowed: `Content-Type, Authorization, X-API-Key`

---

### Error Handling

A global `setErrorHandler` is registered in `errors/errorHandler.ts`.

| Error type                   | HTTP status | `code`             | `details` |
|------------------------------|-------------|--------------------|-----------|
| Zod validation error         | 400         | `VALIDATION_ERROR` | ZodError.issues mapped to `{ path, message, code }` |
| `FST_ERR_VALIDATION`         | 400         | `VALIDATION_ERROR` | Same mapping |
| Not-found (unmatched route)  | 404         | `NOT_FOUND`        | absent    |
| Any other Error              | 500         | `INTERNAL_ERROR`   | absent (error logged via Pino, never leaked to client) |

All errors use the standard envelope:

```
{
  success : false
  error : {
    message : string
    code    : string
    details?: Array<{ path: string[], message: string, code: string }>
  }
}
```

The original error is always logged at `error` level (with stack trace) before
the sanitised response is sent.

---

### Logging

Fastify's built-in Pino logger is used. Configuration:

```
{
  logger: {
    level      : Config.LOG_LEVEL   // default "info"
    transport  : {
      // pretty-print only in development
      target : "pino-pretty"   // only when NODE_ENV === "development"
    }
  }
}
```

In `production` and `test`, plain JSON output (no pretty-print) is used.
`pino-pretty` is a dev dependency only.

---

### npm Scripts (additions / changes)

The existing `packages/api/package.json` scripts are augmented:

| Script        | Command                              | Notes                              |
|---------------|--------------------------------------|------------------------------------|
| `dev`         | `tsx watch src/server.ts`            | Already present — no change        |
| `start`       | `node dist/server.js`                | Already present — no change        |
| `typecheck`   | `tsc --noEmit`                       | Already present — no change        |

No new top-level scripts are required. `dev` already uses `tsx watch`.

---

### New Dependencies

| Package                    | Type    | Reason                                       |
|----------------------------|---------|----------------------------------------------|
| `fastify-type-provider-zod`| runtime | Zod ↔ Fastify type provider + OpenAPI bridge |
| `pino-pretty`              | devDep  | Pretty-print logs in development only        |

`@fastify/swagger`, `@fastify/swagger-ui`, `@fastify/cors` are already in
`packages/api/package.json`.

---

### Zod Schemas (packages/shared)

No new entity schemas are needed in `packages/shared` for this feature. The
shared package is consumed but not extended.

Two local-only Zod schemas live in `packages/api/src/`:

- `EnvSchema` in `config.ts` — server environment config (not exported from
  shared; API-internal concern).
- `HealthQuerySchema` in `routes/health.ts` — validates the `?db` query param.
- `HealthResponseSchema` in `routes/health.ts` — validates the response shape
  for OpenAPI generation.

These are NOT added to `packages/shared` because they are API implementation
concerns, not shared domain types.

---

### Edge Cases

| Scenario | Expected behaviour |
|---|---|
| `DATABASE_URL` missing from env | Process exits at startup with `[config] Missing required env: DATABASE_URL` before server binds |
| `PORT` is not a valid integer | Process exits at startup with Zod validation message |
| `?db=true` and Prisma client not yet connected | Prisma auto-connects on first call; if connection fails, catch the error, log it, return 500 with `DB_UNAVAILABLE` |
| Route not found (any method) | 404 with `{ success: false, error: { message: "Route not found", code: "NOT_FOUND" } }` |
| Unhandled async throw inside a route handler | Global error handler catches it; logs full stack; returns 500 to client with no internal detail |
| Graceful shutdown — SIGTERM | `fastify.close()` called; Prisma `$disconnect()` called; process exits 0 |
| Graceful shutdown — SIGINT (Ctrl+C in dev) | Same as SIGTERM |
| Swagger UI accessed in NODE_ENV=test | Plugin not registered; request returns 404 via notFound handler |
| `LOG_LEVEL=trace` in production | Permitted by config schema; operator's responsibility |

---

### Acceptance Criteria

- [x] `GET /health` returns 200 with `{ status, timestamp, version, uptime }`
- [x] `GET /health?db=true` returns 200 with `db: "connected"` when DB is reachable
- [x] `GET /health?db=true` returns 500 with `DB_UNAVAILABLE` when DB is down
- [x] `GET /docs` returns Swagger UI HTML in development
- [x] `GET /docs/json` returns valid OpenAPI 3.x JSON in development
- [x] Invalid request to any route returns the standard error envelope (not raw Fastify error)
- [x] Unknown route returns 404 with `NOT_FOUND` code
- [x] Missing `DATABASE_URL` causes process to exit with a readable message
- [x] `NODE_ENV=test` does not register Swagger or CORS plugins
- [x] Server binds to `PORT` from env (default 3001)
- [x] SIGTERM triggers graceful shutdown (fastify.close + prisma.$disconnect)
- [x] TypeScript strict mode — no `any`, no `ts-ignore`
- [x] All new code covered by Vitest unit tests (30 tests: 14 config + 9 errorHandler + 7 health)
- [x] `packages/api` build (`tsc`) passes with no errors

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing (30 new tests, 305 total in api)
- [x] E2E tests updated (N/A — no E2E framework yet)
- [x] Code follows project standards (TypeScript strict, no any, bracket notation for process.env)
- [x] No linting errors
- [x] Build succeeds
- [x] Specs reflect final implementation (api-spec.yaml updated)

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated (api-spec.yaml + ticket spec)
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` executed, plan approved
- [x] Step 3: `backend-developer` executed with TDD
- [ ] Step 4: `production-code-validator` executed, quality gates pass
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 5: `qa-engineer` executed (Standard)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-12 | Step 0: Spec created | spec-creator agent, api-spec.yaml updated, ticket spec written |
| 2026-03-12 | Step 1: Setup | Branch `feature/F004-fastify-api-scaffold`, tracker updated |
| 2026-03-12 | Step 2: Plan approved | backend-planner agent, 9-step implementation plan |
| 2026-03-12 | Step 3: Implementation complete | backend-developer agent, TDD, 8 production files + 3 test files, 30 new tests |
| 2026-03-12 | Step 4: Validation | production-code-validator: 0C, 1I (await buildApp→fixed), 1S (spec enum→fixed) |

---

## Notes

- `fastify-type-provider-zod` must be compatible with Fastify v5 (installed version
  is `^5.2.1`). Verify the compatible version range before installing.
- Prisma client singleton should be created in `src/lib/prisma.ts` (not inside
  route handlers) to avoid creating multiple instances. This file is also used
  by the existing migration tests.
- `pino-pretty` should be listed under `devDependencies` only. Production Docker
  image must not rely on it.

---

## Implementation Plan

### Existing Code to Reuse

- `packages/api/src/__tests__/migration.integration.test.ts` — reference for Vitest import style (`describe`, `it`, `expect`, `beforeAll`, `afterAll` from `'vitest'`) and AAA pattern
- `packages/api/vitest.config.ts` — already configured with `fileParallelism: false`; no changes needed for unit tests, but integration tests must continue to honour this
- `packages/api/package.json` — `@fastify/swagger ^9.4.2`, `@fastify/swagger-ui ^5.2.1`, `@fastify/cors ^10.0.2`, `fastify ^5.2.1`, `zod ^3.24.2` are already declared as runtime dependencies; only `fastify-type-provider-zod` and `pino-pretty` are missing
- `packages/shared/src/` — consumed as `@foodxplorer/shared` but not extended by this feature
- `tsconfig.base.json` — strict mode, `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature` are already enforced; all new code must satisfy these without using `any` or `ts-ignore`

---

### Files to Create

```
packages/api/src/
├── config.ts                          # EnvSchema (Zod) + parsed Config singleton
├── lib/
│   └── prisma.ts                      # PrismaClient singleton, respects DATABASE_URL / DATABASE_URL_TEST
├── errors/
│   └── errorHandler.ts                # Global setErrorHandler + notFoundHandler
├── plugins/
│   ├── swagger.ts                     # @fastify/swagger + @fastify/swagger-ui registration (NODE_ENV !== "test")
│   └── cors.ts                        # @fastify/cors registration (skipped in test env)
├── routes/
│   └── health.ts                      # GET /health with HealthQuerySchema + HealthResponseSchema
├── app.ts                             # buildApp(config?) — registers all plugins and routes
└── __tests__/
    ├── config.test.ts                 # Unit: EnvSchema parse + validation errors
    ├── errorHandler.test.ts           # Unit: error-to-envelope mapping for each error type
    └── health.test.ts                 # Integration-style: buildApp + .inject(), no port binding
```

---

### Files to Modify

- `packages/api/src/server.ts` — Replace the 14-line placeholder. New version: imports `buildApp` and `config`, calls `server.listen({ port: config.PORT, host: '0.0.0.0' })`, and registers SIGTERM/SIGINT handlers that call `fastify.close()` then `prisma.$disconnect()` then `process.exit(0)`
- `packages/api/package.json` — Add `fastify-type-provider-zod` to `dependencies`; add `pino-pretty` to `devDependencies`

---

### Implementation Order

Follow DDD layer order. Within each step, write the test first, then write the production code to make it pass.

**Step 1 — Install new dependencies**

- File: `packages/api/package.json`
- Before writing any code, verify the compatible version of `fastify-type-provider-zod` for Fastify v5. Run `npm info fastify-type-provider-zod peerDependencies` from the repo root. Install the correct version range.
- Commands (run from repo root):
  - `npm install fastify-type-provider-zod -w @foodxplorer/api`
  - `npm install --save-dev pino-pretty -w @foodxplorer/api`
- No test for this step. Validate by running `tsc --noEmit` after Step 2.

**Step 2 — `config.ts`: Zod-validated env config**

- File: `packages/api/src/config.ts`
- Test first: `packages/api/src/__tests__/config.test.ts`
  - Write tests before creating `config.ts`. Import and call `parseConfig(env)` (a named export that accepts a plain object, used for testing without mutating `process.env`).
  - Tests: valid env parses correctly; `DATABASE_URL` missing throws/exits; `PORT` non-integer coerces from string; `PORT` out of range fails; `NODE_ENV` defaults to `"development"`; `LOG_LEVEL` defaults to `"info"`
- Then create `config.ts`:
  - Export `EnvSchema` (the Zod object literal)
  - Export `parseConfig(env: NodeJS.ProcessEnv): Config` — calls `EnvSchema.safeParse(env)`; on failure prints `[config] Invalid environment: <ZodError.message>` and calls `process.exit(1)`
  - Export `config` — the result of `parseConfig(process.env)` (singleton, evaluated once at import time)
  - Export `Config` type — `z.infer<typeof EnvSchema>`
- No dependency on other new files.

**Step 3 — `lib/prisma.ts`: PrismaClient singleton**

- File: `packages/api/src/lib/prisma.ts`
- No dedicated unit test (the existing migration integration tests already exercise the Prisma client). Verify the singleton is importable after this step.
- Implementation: export a single `prisma` constant. When `NODE_ENV === "test"`, use `DATABASE_URL_TEST` as the datasource URL (fall back to `DATABASE_URL` if `DATABASE_URL_TEST` is absent). In all other environments use `DATABASE_URL`. Do not import from `config.ts` — read `process.env` directly to avoid circular imports and to allow the singleton to be imported in test files before config is parsed.
- Note: existing migration tests create their own `PrismaClient` instances inline. `lib/prisma.ts` is a new singleton for route handlers only; it does not conflict with the test files.

**Step 4 — `errors/errorHandler.ts`: global error handler**

- Files: `packages/api/src/errors/errorHandler.ts`
- Test first: `packages/api/src/__tests__/errorHandler.test.ts`
  - Test the mapping function in isolation (pure function that takes an error and returns `{ statusCode, body }`), not Fastify internals.
  - Tests: `ZodError` maps to 400 + `VALIDATION_ERROR` with `details` array; Fastify validation error (`FST_ERR_VALIDATION`) maps to 400 + `VALIDATION_ERROR`; generic `Error` maps to 500 + `INTERNAL_ERROR` with no `details`; `Error` with `statusCode: 404` property maps to 404 + `NOT_FOUND`
- Then create `errorHandler.ts`:
  - Export `registerErrorHandler(app: FastifyInstance): void`
  - Inside, call `app.setErrorHandler(...)` — the handler receives `(error, request, reply)`, logs the error at `error` level using `request.log.error`, then sends the error envelope via `reply.status(statusCode).send(body)`
  - Call `app.setNotFoundHandler(...)` — returns 404 with `{ success: false, error: { message: "Route not found", code: "NOT_FOUND" } }`
  - The error-to-envelope mapping logic should be extracted into a pure function `mapError(error): { statusCode: number; body: ErrorEnvelope }` — this is what the unit test calls directly
  - For ZodError detection: use `error instanceof ZodError` (import `ZodError` from `zod`)
  - For Fastify validation errors: check `error.code === 'FST_ERR_VALIDATION'`
  - `details` for Zod errors: `error.issues.map(i => ({ path: i.path.map(String), message: i.message, code: i.code }))`

**Step 5 — `plugins/swagger.ts` and `plugins/cors.ts`**

- Files: `packages/api/src/plugins/swagger.ts`, `packages/api/src/plugins/cors.ts`
- No dedicated unit tests for plugins — covered by Step 6 integration tests.
- `swagger.ts`:
  - Export `registerSwagger(app: FastifyInstance, config: Config): Promise<void>`
  - Guard: if `config.NODE_ENV === 'test'`, return immediately without registering
  - Register `@fastify/swagger` with `{ openapi: { info: { title: 'foodXPlorer API', version: config.PORT.toString() } } }` — read the actual version from `process.env['npm_package_version'] ?? '0.0.0'` for the spec version field
  - Register `@fastify/swagger-ui` with `{ routePrefix: '/docs' }`
- `cors.ts`:
  - Export `registerCors(app: FastifyInstance, config: Config): Promise<void>`
  - Guard: if `config.NODE_ENV === 'test'`, return immediately
  - In `development`: `origin: ['http://localhost:3000', 'http://localhost:5173']`
  - In `production`: read `CORS_ORIGINS` from `process.env` (comma-split, trim); if empty array, pass `origin: false`
  - `methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']`
  - `allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']`
  - Note: `CORS_ORIGINS` is NOT in `EnvSchema` — read it directly from `process.env` in `cors.ts` because it is an optional production-only concern.

**Step 6 — `routes/health.ts`**

- File: `packages/api/src/routes/health.ts`
- No test written at this step — tests are in Step 7 via `buildApp`.
- Define `HealthQuerySchema = z.object({ db: z.coerce.boolean().optional() })`
- Define `HealthResponseSchema = z.object({ status: z.literal('ok'), timestamp: z.string(), version: z.string(), uptime: z.number(), db: z.enum(['connected', 'unavailable']).optional() })`
- Export `healthRoutes` as a Fastify plugin (use `fastifyPlugin` from `fastify-plugin` — check if it is already a transitive dependency; if not, it is included with Fastify core as `fastify.register`-compatible functions do not require it for simple route plugins)
- Register: `app.get('/health', { schema: { querystring: HealthQuerySchema, response: { 200: HealthResponseSchema } }, tags: ['System'] }, handler)`
- Handler logic:
  - Build base response: `{ status: 'ok', timestamp: new Date().toISOString(), version: process.env['npm_package_version'] ?? '0.0.0', uptime: process.uptime() }`
  - If `query.db === true`: try `await prisma.$queryRaw\`SELECT 1\``; on success add `db: 'connected'`; on catch log the error and return 500 with `{ success: false, error: { message: 'Database connectivity check failed', code: 'DB_UNAVAILABLE' } }` — use `reply.status(500).send(...)` and `return`
  - Return the response object (Fastify serialises it)
- Import `prisma` from `../lib/prisma`

**Step 7 — `app.ts`: buildApp factory**

- File: `packages/api/src/app.ts`
- Test first: `packages/api/src/__tests__/health.test.ts`
  - Write tests before creating `app.ts`. Tests use `buildApp()` (no port binding) with `.inject()`.
  - Use `afterAll(async () => { await app.close() })` — no `afterEach` teardown of the app instance (one `buildApp()` per `describe` block)
  - Tests:
    1. `GET /health` — 200, body contains `status: 'ok'`, `timestamp` is ISO string, `version` is string, `uptime` is number, no `db` field
    2. `GET /health?db=true` with Prisma reachable — 200, body contains `db: 'connected'` (requires test DB available; mark this test as requiring `DATABASE_URL_TEST` and skip if not present using `it.skipIf`)
    3. `GET /health?db=true` with Prisma unreachable — 500, body is `{ success: false, error: { message: 'Database connectivity check failed', code: 'DB_UNAVAILABLE' } }`. Achieve this by passing a `prisma` override to `buildApp` that throws; OR by making the health route's prisma import injectable. Preferred: pass `{ prisma: mockPrisma }` as an option to `buildApp` to avoid module-level mocking.
    4. `GET /nonexistent` — 404, body `{ success: false, error: { message: 'Route not found', code: 'NOT_FOUND' } }`
    5. `NODE_ENV=test` — Swagger not registered (GET /docs returns 404)
- Then create `app.ts`:
  - Export `buildApp(opts?: BuildAppOptions): FastifyInstance`
  - `BuildAppOptions`: `{ config?: Config; prisma?: PrismaClient }` — defaults to the `config` singleton and the `prisma` singleton
  - Create Fastify instance with:
    - `loggerOptions` based on `config.NODE_ENV`: in `development` use `{ level: config.LOG_LEVEL, transport: { target: 'pino-pretty' } }`; in `test` use `false` (disable logger to keep test output clean); in `production` use `{ level: config.LOG_LEVEL }`
  - Set `serializerCompiler` and `validatorCompiler` from `fastify-type-provider-zod`
  - Call `registerSwagger(app, config)` — await
  - Call `registerCors(app, config)` — await
  - Call `registerErrorHandler(app)`
  - Call `app.register(healthRoutes, { prisma: opts?.prisma ?? prisma })`
  - Return `app` (do NOT call `app.listen()`)
  - Use `FastifyInstance` typed with `ZodTypeProvider` from `fastify-type-provider-zod`

**Step 8 — `server.ts`: replace placeholder**

- File: `packages/api/src/server.ts`
- No new tests — server.ts is the process entry point and is not unit tested.
- Replace the current 14-line placeholder:
  - Import `buildApp` from `./app`
  - Import `config` from `./config`
  - Import `prisma` from `./lib/prisma`
  - Call `const server = await buildApp()`
  - Call `await server.listen({ port: config.PORT, host: '0.0.0.0' })`
  - Register shutdown handler for `SIGTERM` and `SIGINT`:
    - `await server.close()`
    - `await prisma.$disconnect()`
    - `process.exit(0)`
  - Wrap in an IIFE `async` function with a `.catch(err => { console.error(err); process.exit(1); })`

**Step 9 — Typecheck and final validation**

- Run `npm run typecheck -w @foodxplorer/api` — must pass with zero errors
- Run `npm test -w @foodxplorer/api` — all tests pass (integration tests require `DATABASE_URL_TEST` to be set; the health DB test must be skipped cleanly if not set)
- Verify `npm run dev -w @foodxplorer/api` starts without error and `GET http://localhost:3001/health` returns 200

---

### Testing Strategy

**Test files to create**

| File | Type | What it covers |
|---|---|---|
| `src/__tests__/config.test.ts` | Unit | `parseConfig` happy path, missing fields, type coercion, enum defaults |
| `src/__tests__/errorHandler.test.ts` | Unit | `mapError` pure function — all 4 error type branches |
| `src/__tests__/health.test.ts` | Integration-style (no DB port) | `buildApp` + `.inject()` — all health route scenarios |

**Key test scenarios**

- `config.test.ts`:
  - Valid complete env → Config object with correct types
  - `DATABASE_URL` absent → `process.exit(1)` called (mock `process.exit`)
  - `PORT=abc` → coercion fails → exit
  - `PORT=0` → below min(1) → exit
  - `PORT=65536` → above max(65535) → exit
  - `PORT` absent → defaults to `3001`
  - `NODE_ENV` absent → defaults to `"development"`
  - `LOG_LEVEL` absent → defaults to `"info"`

- `errorHandler.test.ts`:
  - `new ZodError([...])` → `{ statusCode: 400, body.error.code: 'VALIDATION_ERROR', body.error.details: [...] }`
  - Fastify-like error with `code: 'FST_ERR_VALIDATION'` → same 400 envelope
  - `new Error('boom')` → `{ statusCode: 500, body.error.code: 'INTERNAL_ERROR' }`, no `details` key
  - Verify `details` is absent (not `null`, not `[]`) on 500 errors

- `health.test.ts`:
  - `GET /health` → 200, envelope shape correct, no `db` field
  - `GET /health?db=true`, prisma override returns `[{ '?column?': 1 }]` → 200, `db: 'connected'`
  - `GET /health?db=true`, prisma override throws → 500, `DB_UNAVAILABLE` envelope
  - `GET /unknown-path` → 404, `NOT_FOUND` envelope
  - `GET /docs` with `NODE_ENV=test` config → 404 (swagger not registered)

**Mocking strategy**

- Do NOT mock the Fastify framework itself — use `.inject()` for all HTTP assertions
- Mock `process.exit` in `config.test.ts` using `vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit called') })` — this allows asserting the exit without actually terminating the process
- For the DB-down scenario in `health.test.ts`: pass `{ prisma: { $queryRaw: vi.fn().mockRejectedValue(new Error('connection refused')) } as unknown as PrismaClient }` into `buildApp`. This avoids `vi.mock()` module mocking and keeps tests isolated.
- For the DB-connected scenario: pass `{ prisma: { $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1n }]) } as unknown as PrismaClient }`
- Do NOT mock `@fastify/swagger`, `@fastify/cors`, or `fastify-type-provider-zod` — these are lightweight in-process registrations; using real plugins in tests ensures OpenAPI metadata is accurate

---

### Key Patterns

**Fastify app/server split** — `buildApp` returns a configured `FastifyInstance` without calling `listen`. Tests call `buildApp()` directly and use `app.inject({ method: 'GET', url: '/health' })`. Server.ts is the only file that calls `listen`. Reference: ticket spec §Architecture Decisions.

**Type provider** — After `setValidatorCompiler` and `setSerializerCompiler` from `fastify-type-provider-zod`, use `.withTypeProvider<ZodTypeProvider>()` on the Fastify instance so route handler `request.query` types are inferred from the Zod schema. Without this, TypeScript will see `unknown` for query params.

**Strict mode gotchas with `noUncheckedIndexedAccess`** — Array index access returns `T | undefined`. In `errorHandler.ts`, when mapping `ZodError.issues`, do not access `issues[0]` without a null check. Use `issues.map(...)` (safe) or check length first.

**`noPropertyAccessFromIndexSignature`** — When reading from `process.env`, always use bracket notation (`process.env['PORT']`), not dot notation (`process.env.PORT`). This is already the pattern in existing migration tests.

**Pino logger in tests** — Pass `logger: false` to Fastify when `NODE_ENV === 'test'` in `buildApp`. This suppresses all Pino output during Vitest runs. Do not use `logger: { level: 'silent' }` — `false` is the correct value for fully disabling logging in Fastify v5.

**Plugin registration order in `app.ts`** — Swagger must be registered before routes so that route schemas are picked up by the OpenAPI generator. Order: swagger → cors → errorHandler → routes.

**`fastify-plugin` wrapper** — Route files that need to share the Fastify instance's decorators or that should not create an encapsulated scope must be wrapped with `fastifyPlugin` from `fastify-plugin`. For simple route files like `health.ts`, this is required so that the error handler registered on the root instance applies to health route errors. Check if `fastify-plugin` is already a transitive dep before adding it explicitly (`npm ls fastify-plugin -w @foodxplorer/api`).

**Graceful shutdown race condition** — Register SIGTERM and SIGINT handlers before `server.listen()` resolves, not after. The handlers must be idempotent (a second signal during shutdown should not throw).

**`process.exit` in `config.ts`** — The `parseConfig` function calls `process.exit(1)` on validation failure. To make this unit-testable, mock `process.exit` with `vi.spyOn` before importing `config.ts`. Alternatively, export `parseConfig` as a function that throws when a `throwOnError: true` option is passed, and only call `process.exit` in the module-level singleton initialisation. The simpler approach is the `vi.spyOn` mock — use it.

**Existing test file parallelism** — `vitest.config.ts` already has `fileParallelism: false`. The new test files are all unit/inject-based and do not need the DB, so they will run fast and sequentially alongside the existing integration tests without issue.
