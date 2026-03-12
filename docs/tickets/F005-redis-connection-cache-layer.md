# F005: Redis Connection & Cache Layer

**Feature:** F005 | **Type:** Backend-Feature | **Priority:** High
**Status:** In Review | **Branch:** feature/F005-redis-connection-cache-layer
**Created:** 2026-03-12 | **Dependencies:** F004 complete

---

## Spec

### Description

Introduce Redis as a first-class infrastructure dependency in `packages/api`.
This feature delivers three things:

1. **ioredis singleton** — a managed Redis client that mirrors the Prisma
   singleton pattern, with graceful degradation when Redis is unavailable.
2. **Cache helper** — a generic get/set/del/invalidatePattern utility with
   JSON serialisation, TTL support, and per-call key namespacing.
3. **Rate-limiting Fastify plugin** — uses Redis as the backing store; applies
   global defaults plus per-route-group overrides; emits standard HTTP headers;
   responds with the project error envelope on 429.

Docker Compose already has the Redis service declared (`redis:7-alpine`,
`6380:6379`). No Docker changes are needed.

The guiding principle for this feature is **fail open**: if Redis is
unavailable at startup, or disconnects mid-operation, the app continues to run.
Caching is bypassed and rate limiting is disabled with a warning log — never
a crash.

---

### Architecture Decisions

**ADR-F005-1: ioredis over node-redis**
`ioredis` is already declared in `packages/api/package.json` (`^5.4.2`). It
has built-in reconnect logic, Lua scripting, and pipeline support — all of
which are needed by F026 (rate limiting with atomic increments). No additional
dependency is required.

**ADR-F005-2: ioredis singleton mirrors prisma.ts pattern**
`packages/api/src/lib/redis.ts` exports a single `redis` constant (an
`ioredis` `Redis` instance). It reads `REDIS_URL` directly from `process.env`
to avoid circular imports, matching the pattern in `lib/prisma.ts`. The
singleton is created lazily-on-import; it does NOT auto-connect on creation
(ioredis connects on first command, unless `lazyConnect: true` is specified).

`lazyConnect: true` is specified so that the import of `redis.ts` itself does
not trigger a network connection — important for tests that do not need Redis.

**ADR-F005-3: REDIS_URL added to EnvSchema with default**
`REDIS_URL` is added to `packages/api/src/config.ts` with a default value of
`redis://localhost:6380`. This means the application can start with no `.env`
change in local development. The field is validated as a non-empty string
(not `.url()` — Redis URLs use the `redis://` scheme which Zod's `.url()`
does not accept by default).

**ADR-F005-4: Graceful degradation via a thin wrapper**
The cache helper (`packages/api/src/lib/cache.ts`) wraps every ioredis
call in a try/catch. On any error it logs a `warn` message using the Pino
logger (passed as a parameter) and returns `null` / `undefined` as
appropriate. Callers never need to guard against cache errors.

Rate limiting is similarly wrapped: if ioredis is unreachable, the
`registerRateLimit` plugin detects the error in its `keyGenerator` or store
callback, logs a warning, and allows the request through (fail-open).

**ADR-F005-5: `@fastify/rate-limit` as the rate-limiting plugin**
`@fastify/rate-limit` has first-class ioredis support, emits standard headers
out of the box, and is maintained by the Fastify core team. It accepts a Redis
store adapter that wraps ioredis. The alternative (custom middleware) would
require re-implementing header logic and atomic counter logic — not worth it
for Phase 1.

**ADR-F005-6: Rate limiting registered when NODE_ENV !== 'test'**
Rate limiting is skipped in test mode, following the same convention as Swagger
and CORS. This prevents test flakiness caused by per-IP counters leaking across
test cases.

**ADR-F005-7: Cache key prefix strategy**
All cache keys use the format `fxp:<entity>:<identifier>`. The prefix `fxp:`
namespaces the project in shared Redis instances. Example: `fxp:food:uuid-123`,
`fxp:dish:uuid-456`, `fxp:query:sha256-hash`. This is enforced by the cache
helper's `buildKey` utility, not by callers.

**ADR-F005-8: Health endpoint extended with `?redis=true`**
A new optional query parameter `?redis=true` is added to `GET /health`,
mirroring the existing `?db=true` behaviour. The check issues a Redis `PING`
command and returns `{ redis: "connected" | "unavailable" }`. The DB and Redis
checks are independent — both can be combined in a single request
(`?db=true&redis=true`). On failure with `?redis=true`, the response is 500
with `{ code: "REDIS_UNAVAILABLE" }`.

**ADR-F005-9: Cache stampede prevention deferred**
Cache stampede prevention (e.g. probabilistic early expiration, mutex locks)
is NOT in scope for F005. The TTLs used in Phase 1 are long enough (minutes to
hours for nutrition data) that stampede risk is low at the expected traffic
level (<100 users). This will be revisited before F026 if load tests indicate
contention.

---

### File Structure

New files to create:

```
packages/api/src/
├── lib/
│   ├── redis.ts                      # ioredis singleton + connect/disconnect helpers
│   └── cache.ts                      # Generic cache helper: get/set/del/invalidatePattern
└── plugins/
    └── rateLimit.ts                  # Fastify plugin: @fastify/rate-limit + Redis store
```

Files to modify:

```
packages/api/src/
├── config.ts                         # Add REDIS_URL to EnvSchema
├── app.ts                            # Register rateLimit plugin; pass redis to healthRoutes
├── server.ts                         # Add redis.quit() to graceful shutdown
└── routes/health.ts                  # Add ?redis=true query param + Redis PING check
```

---

### Config Schema Changes

`REDIS_URL` is added to `EnvSchema` in `packages/api/src/config.ts`:

```
EnvSchema = z.object({
  NODE_ENV         : z.enum(["development", "test", "production"]).default("development")
  PORT             : z.coerce.number().int().min(1).max(65535).default(3001)
  DATABASE_URL     : z.string().url()
  DATABASE_URL_TEST: z.string().url().optional()
  LOG_LEVEL        : z.enum(["fatal","error","warn","info","debug","trace"]).default("info")
  REDIS_URL        : z.string().min(1).default("redis://localhost:6380")   // NEW
})
```

No other env var changes. Rate-limit window and max-requests are hardcoded
constants in `rateLimit.ts` for Phase 1 (not env-driven). They will move to
config when F026 introduces per-key-group rate limiting.

---

### Redis Client Singleton — `lib/redis.ts`

**Exports:**

```typescript
// The ioredis client instance (lazyConnect: true)
export const redis: Redis

// Attempt an explicit connection. Called from server.ts on startup.
// Resolves quietly if Redis is unavailable (logs a warn and returns false).
export async function connectRedis(): Promise<boolean>

// Disconnect gracefully. Called from server.ts shutdown handler.
// Safe to call even if Redis never connected.
export async function disconnectRedis(): Promise<void>
```

**Behaviour:**

- `redis` is an `ioredis` `Redis` instance created with:
  - `lazyConnect: true` — does not connect on instantiation
  - `maxRetriesPerRequest: 0` — fail immediately on a command if not connected
    (prevents hanging requests; callers get an error they can catch cleanly)
  - `enableReadyCheck: false` — skip the server-ready handshake
  - `retryStrategy: (times) => Math.min(times * 200, 5000)` — exponential
    backoff up to 5 s for background reconnect attempts
  - URL from `process.env['REDIS_URL'] ?? 'redis://localhost:6380'`

- `connectRedis()`:
  - Calls `redis.connect()` inside a try/catch
  - On success: logs `[redis] Connected to Redis at <url>` at `info` level
    via `console.log` (no Pino instance available at this call site)
  - On error: logs `[redis] Redis unavailable — cache and rate limiting will
    be disabled: <message>` at `warn` level via `console.warn`; returns `false`
  - Returns `true` on success, `false` on failure

- `disconnectRedis()`:
  - Calls `redis.quit()` inside a try/catch
  - On error: logs `[redis] Error during disconnect` via `console.warn` and
    swallows the error

---

### Cache Helper — `lib/cache.ts`

**Purpose:** A thin, typed wrapper around ioredis for JSON-serialised key/value
caching. All methods fail open — errors are caught, logged, and translated to
`null`/`void`.

**API Surface:**

```typescript
interface CacheOptions {
  ttl?: number   // seconds. Default: 300 (5 minutes)
}

// Build a namespaced key: "fxp:<entity>:<id>"
// e.g. buildKey("food", "uuid-123") → "fxp:food:uuid-123"
export function buildKey(entity: string, id: string): string

// Retrieve and deserialise a cached value. Returns null on miss or error.
export async function cacheGet<T>(
  key: string,
  logger: FastifyBaseLogger,
): Promise<T | null>

// Serialise and store a value. No-op on error.
export async function cacheSet<T>(
  key: string,
  value: T,
  logger: FastifyBaseLogger,
  options?: CacheOptions,
): Promise<void>

// Delete a single key. No-op on error.
export async function cacheDel(
  key: string,
  logger: FastifyBaseLogger,
): Promise<void>

// Delete all keys matching a glob pattern using Redis SCAN + DEL.
// Uses SCAN with COUNT 100 to avoid blocking the server.
// No-op on error.
export async function cacheInvalidatePattern(
  pattern: string,
  logger: FastifyBaseLogger,
): Promise<void>
```

**Behaviour notes:**

- All functions import `redis` from `./redis.ts` directly (no dependency
  injection — the singleton is the single source of truth).
- `cacheGet` returns `null` both on cache miss and on Redis error — callers
  treat both identically (fetch from DB).
- `cacheSet` serialises `value` with `JSON.stringify`. `null` and `undefined`
  values are not stored (no-op if `value` is `null` or `undefined`).
- `cacheInvalidatePattern` uses a cursor-based SCAN loop to avoid `KEYS`
  (which blocks Redis). Each SCAN page deletes matched keys in a pipeline.
- The `logger` parameter is a `FastifyBaseLogger` (Pino), obtained from
  `request.log` or `app.log` at the call site. This avoids creating a
  standalone Pino instance in `cache.ts`.
- Default TTL: 300 seconds (5 minutes). Long-lived nutrition data (foods,
  restaurants) should use 3600 s or higher at the call site.

---

### Rate Limiting Plugin — `plugins/rateLimit.ts`

**Purpose:** Register `@fastify/rate-limit` with ioredis as the backing store.
Apply global defaults and per-route-group overrides.

**Exports:**

```typescript
export async function registerRateLimit(
  app: FastifyInstance,
  config: Config,
): Promise<void>
```

**Behaviour:**

- If `config.NODE_ENV === 'test'`, return immediately (not registered).
- Import `@fastify/rate-limit` dynamically (consistent with swagger.ts /
  cors.ts pattern for avoiding test-time imports).
- Register with global defaults:

  | Setting | Value | Rationale |
  |---|---|---|
  | `max` | 100 | 100 requests per window per IP |
  | `timeWindow` | `'15 minutes'` | Standard API rate limit window |
  | `redis` | `redis` singleton from `lib/redis.ts` | Redis-backed counters |
  | `keyGenerator` | `(req) => req.ip` | Per-IP limiting |
  | `addHeaders` | all true | Emit all standard rate limit headers |
  | `errorResponseBuilder` | custom | Return project error envelope |
  | `skipOnError` | `true` | Fail open: if Redis errors, allow request |

- `errorResponseBuilder` returns the standard envelope:
  ```json
  {
    "success": false,
    "error": {
      "message": "Too many requests, please try again later.",
      "code": "RATE_LIMIT_EXCEEDED"
    }
  }
  ```
  HTTP status: 429.

- `/health` route is exempt from rate limiting. This is configured via
  `config.skip` in the global registration:
  ```typescript
  skip: (req) => req.routeOptions.url === '/health'
  ```
  (Fastify v5 uses `req.routeOptions.url` for the matched route pattern.)

**HTTP Headers emitted on every rate-limited response:**

| Header | Value |
|---|---|
| `X-RateLimit-Limit` | Max requests per window |
| `X-RateLimit-Remaining` | Remaining requests in current window |
| `X-RateLimit-Reset` | Unix timestamp when window resets |
| `Retry-After` | Seconds until retry (only on 429) |

**Per-route overrides (for future features):**
Individual routes can override limits via `config.rateLimit` in the route
schema options. F005 establishes the mechanism; F026 will configure per-key
limits for authenticated vs unauthenticated callers. Example pattern (spec
only, not implemented in F005):

```typescript
// In a future route definition:
schema: {
  // ...
},
config: {
  rateLimit: {
    max: 10,
    timeWindow: '1 minute',
  },
},
```

---

### API Changes — `GET /health`

The health route is extended with a new `redis` query parameter, mirroring the
existing `db` parameter behaviour exactly.

**Updated request parameters:**

| Parameter | In    | Type   | Required | Description |
|-----------|-------|--------|----------|-------------|
| `db`      | query | string | No       | Set to `"true"` to check DB connectivity |
| `redis`   | query | string | No       | Set to `"true"` to check Redis connectivity via PING |

Both can be passed together: `GET /health?db=true&redis=true`

**Updated success response — 200:**

```
{
  status    : "ok"
  timestamp : string
  version   : string
  uptime    : number
  db?       : "connected" | "unavailable"   // present only when ?db=true
  redis?    : "connected" | "unavailable"   // present only when ?redis=true  NEW
}
```

**Error response — 500** (when `?redis=true` and Redis is unreachable):

```json
{
  "success": false,
  "error": {
    "message": "Redis connectivity check failed",
    "code": "REDIS_UNAVAILABLE"
  }
}
```

**Behaviour notes:**

- `?redis=true` issues `redis.ping()` against the singleton. If the call
  throws (Redis down), the route throws an error with `code: 'REDIS_UNAVAILABLE'`
  which is caught by the global error handler.
- If both `?db=true&redis=true` are passed, both checks run. If DB succeeds
  but Redis fails, the response is 500 (`REDIS_UNAVAILABLE`). If DB fails,
  the response is 500 (`DB_UNAVAILABLE`) — DB check runs first.
- The `redis` and `db` fields are absent from the response when the
  respective parameters are not passed.
- The `redis` singleton is injected into the health plugin options (alongside
  `prisma`), enabling test substitution without module mocking.

**`HealthPluginOptions` update:**

```typescript
interface HealthPluginOptions {
  prisma: PrismaClient
  redis: Redis   // NEW — ioredis Redis instance
}
```

**Zod schema updates (local to `routes/health.ts`):**

```typescript
HealthQuerySchema = z.object({
  db   : z.string().transform(v => v === 'true' ? true : undefined).optional(),
  redis: z.string().transform(v => v === 'true' ? true : undefined).optional(), // NEW
})

HealthResponseSchema = z.object({
  status   : z.literal('ok'),
  timestamp: z.string(),
  version  : z.string(),
  uptime   : z.number(),
  db       : z.enum(['connected', 'unavailable']).optional(),
  redis    : z.enum(['connected', 'unavailable']).optional(),   // NEW
})
```

---

### `app.ts` Changes

`buildApp` is updated to:

1. Accept `redis` in `BuildAppOptions`:
   ```typescript
   export interface BuildAppOptions {
     config?: Config
     prisma?: PrismaClient
     redis?: Redis    // NEW — ioredis Redis instance
   }
   ```

2. Register rate limiting:
   ```typescript
   await registerRateLimit(app, cfg)   // after cors, before routes
   ```
   Plugin registration order becomes: `swagger → cors → rateLimit → errorHandler → routes`

3. Pass `redis` to `healthRoutes`:
   ```typescript
   await app.register(healthRoutes, { prisma: prismaClient, redis: redisClient })
   ```

---

### `server.ts` Changes

Two additions to the graceful shutdown handler:

```typescript
import { connectRedis, disconnectRedis } from './lib/redis.js'

// Startup — after buildApp(), before listen():
await connectRedis()

// Shutdown — after server.close(), before process.exit(0):
await disconnectRedis()
```

Full shutdown sequence:
1. `server.close()` — stop accepting new requests, drain in-flight
2. `prisma.$disconnect()` — close DB connection pool
3. `disconnectRedis()` — close Redis connection     ← NEW
4. `process.exit(0)`

---

### `errorHandler.ts` Changes

`mapError` in `errors/errorHandler.ts` is updated to handle the new error code:

```
REDIS_UNAVAILABLE — health route Redis check failure
  statusCode : 500
  code       : 'REDIS_UNAVAILABLE'
  message    : error.message
```

This mirrors the existing `DB_UNAVAILABLE` branch identically.

---

### New Dependencies

| Package | Type | Reason |
|---|---|---|
| `@fastify/rate-limit` | runtime | Fastify-native rate limiting with Redis store support |

`ioredis` is already in `dependencies` (`^5.4.2`). No other new dependencies.

---

### Docker Compose

No changes needed. The Redis service is already present in `docker-compose.yml`:

```yaml
redis:
  image: redis:7-alpine
  container_name: foodxplorer-redis
  ports:
    - "6380:6379"
  volumes:
    - redisdata:/data
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 5s
    timeout: 5s
    retries: 5
```

---

### Edge Cases

| Scenario | Expected Behaviour |
|---|---|
| Redis unavailable at startup | `connectRedis()` logs a warn and returns `false`. App continues to start normally. Cache operations are no-ops. Rate limiting is disabled (fail-open via `skipOnError: true`). |
| Redis disconnects mid-request | ioredis throws on the command. Cache helper catches and returns `null`. Rate limit plugin's `skipOnError: true` allows the request. A `warn` is logged. |
| `REDIS_URL` missing from env | Defaults to `redis://localhost:6380` via `EnvSchema` default — never fails validation. |
| `REDIS_URL` set to invalid value | `EnvSchema` validates `z.string().min(1)` — an invalid URL string is still a non-empty string and will pass Zod validation. ioredis will fail to connect at `connectRedis()` time, handled gracefully by the try/catch. |
| `?redis=true` health check when Redis is down | 500 with `REDIS_UNAVAILABLE` envelope. Unlike cache/rate-limit degradation, an explicit health check must be honest about Redis state. |
| Both `?db=true&redis=true` and DB is up but Redis is down | 500 with `REDIS_UNAVAILABLE`. DB check runs first and passes; Redis check fails; error is thrown. |
| `cacheSet` called with `null` value | No-op — null is not stored. Prevents polluting the cache with sentinel values. |
| `cacheInvalidatePattern` with a pattern matching thousands of keys | Cursor-based SCAN avoids blocking. Large invalidations may take multiple round trips but will not block the Redis server. |
| Rate limit key generation when `req.ip` is undefined | `@fastify/rate-limit` falls back to `'unknown'` if IP is not available. This is the library's default behaviour — F005 does not override it. |
| Multiple SIGTERM signals during shutdown | The `shuttingDown` flag in `server.ts` (already implemented) prevents re-entrant shutdown. `disconnectRedis()` is idempotent (ioredis ignores `quit()` on an already-closed connection). |
| Test environment | Rate limiting not registered. Cache helper is importable but ioredis client is in `lazyConnect` mode — no actual connection made unless `connectRedis()` is called explicitly. |

---

### Out of Scope for F005

- Cache stampede prevention (mutex locks, probabilistic early expiration)
- Per-authenticated-key rate limits (deferred to F026)
- Redis Cluster / Sentinel support (single-node only for Phase 1)
- Cache warming / pre-population
- Redis pub/sub
- Persistent TTL configuration via env vars (hardcoded in Phase 1)
- Cache metrics / hit-rate tracking (deferred to F030)
- LLM response caching (deferred to F024)

---

### Acceptance Criteria

- [x] `GET /health?redis=true` returns 200 with `{ redis: "connected" }` when Redis is reachable
- [x] `GET /health?redis=true` returns 500 with `REDIS_UNAVAILABLE` when Redis is down
- [x] `GET /health?db=true&redis=true` returns 200 when both are reachable
- [x] `cacheGet` returns `null` when key is missing
- [x] `cacheGet` returns the deserialised value when key exists
- [x] `cacheSet` stores a JSON-serialised value with TTL
- [x] `cacheDel` removes a key
- [x] `cacheInvalidatePattern` deletes all keys matching the pattern using SCAN
- [x] Cache operations do not throw when Redis is unavailable — they log a warn and return null/undefined
- [x] Rate limit returns 429 with `{ success: false, error: { code: "RATE_LIMIT_EXCEEDED" } }` after 100 requests
- [x] Rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`) are present on all rate-limited responses
- [x] `GET /health` is exempt from rate limiting
- [x] App starts cleanly when Redis is unavailable (warn logged, no crash)
- [x] `redis.quit()` is called during graceful shutdown
- [x] `REDIS_URL` in `EnvSchema` defaults to `redis://localhost:6380`
- [x] TypeScript strict mode — no `any`, no `ts-ignore`
- [x] All new code covered by Vitest tests (46 new tests, 506 total)

---

## Implementation Plan

### Existing Code to Reuse

- `packages/api/src/lib/prisma.ts` — singleton pattern (read `process.env` directly, no config import) to mirror exactly in `redis.ts`
- `packages/api/src/plugins/swagger.ts` — `if (config.NODE_ENV === 'test') return` + dynamic `import()` pattern to mirror in `rateLimit.ts`
- `packages/api/src/plugins/cors.ts` — same dynamic-import skip pattern
- `packages/api/src/errors/errorHandler.ts` — existing `DB_UNAVAILABLE` branch; add `REDIS_UNAVAILABLE` beside it using the exact same structure
- `packages/api/src/routes/health.ts` — existing `HealthQuerySchema`, `HealthResponseSchema`, `HealthPluginOptions` and `?db=true` branch to extend for `?redis=true`
- `packages/api/src/app.ts` — existing `BuildAppOptions`, plugin registration order, injectable prisma pattern to extend for redis
- `packages/api/src/server.ts` — existing graceful shutdown sequence to extend with `connectRedis`/`disconnectRedis`
- `packages/api/vitest.config.ts` — add `REDIS_URL` to the `env` block so `config.ts` does not fail at import in tests
- Existing test helpers: `vi.fn()` mock pattern from `health.test.ts`, `exitSpy` pattern from `config.test.ts`, `Object.assign(new Error(...), { code })` pattern from `f004.edge-cases.test.ts`

---

### Packages to Install

One new runtime dependency must be added before any code is written:

```
npm install @fastify/rate-limit --workspace=packages/api
```

Verify that the installed version is v9+ (required for Fastify v5 compatibility). `ioredis-mock` is added as a dev dependency for unit tests:

```
npm install --save-dev ioredis-mock --workspace=packages/api
```

Check that `ioredis-mock` types are available (`@types/ioredis-mock` is bundled with the package in recent releases; if not, install separately).

---

### Files to Create

| Path | Purpose |
|---|---|
| `packages/api/src/lib/redis.ts` | ioredis singleton with `lazyConnect: true`; exports `redis`, `connectRedis()`, `disconnectRedis()` |
| `packages/api/src/lib/cache.ts` | Generic cache helper: `buildKey`, `cacheGet`, `cacheSet`, `cacheDel`, `cacheInvalidatePattern` — all fail-open |
| `packages/api/src/plugins/rateLimit.ts` | `registerRateLimit(app, config)` — skipped in test env; uses ioredis store; fail-open via `skipOnError: true` |
| `packages/api/src/__tests__/redis.test.ts` | Unit tests for `connectRedis` / `disconnectRedis` using `ioredis-mock` |
| `packages/api/src/__tests__/cache.test.ts` | Unit tests for all cache helper functions using `ioredis-mock` |
| `packages/api/src/__tests__/rateLimit.test.ts` | Unit/integration tests for `registerRateLimit` using `buildApp` + `inject` |
| `packages/api/src/__tests__/f005.edge-cases.test.ts` | Edge-case and regression tests: `?redis=true` param coercions, combined `?db=true&redis=true`, `REDIS_UNAVAILABLE` error envelope, `cacheSet(null)` no-op, `REDIS_URL` default in config |

---

### Files to Modify

| Path | Change |
|---|---|
| `packages/api/src/config.ts` | Add `REDIS_URL: z.string().min(1).default('redis://localhost:6380')` to `EnvSchema` |
| `packages/api/src/errors/errorHandler.ts` | Add `REDIS_UNAVAILABLE` branch in `mapError` directly after `DB_UNAVAILABLE` branch, identical structure |
| `packages/api/src/routes/health.ts` | Add `redis` to `HealthQuerySchema`, `HealthResponseSchema`, and `HealthPluginOptions`; add `?redis=true` check branch in the route handler |
| `packages/api/src/app.ts` | Add `redis?: Redis` to `BuildAppOptions`; import and call `registerRateLimit`; pass `redis` to `healthRoutes` |
| `packages/api/src/server.ts` | Import `connectRedis`/`disconnectRedis`; call `connectRedis()` after `buildApp()`; call `disconnectRedis()` in shutdown sequence after `prisma.$disconnect()` |
| `packages/api/vitest.config.ts` | Add `REDIS_URL: 'redis://localhost:6380'` to the `env` block so `config.ts` parses without error in tests |
| `packages/api/package.json` | Add `@fastify/rate-limit` to `dependencies`; add `ioredis-mock` to `devDependencies` (via install commands above) |

---

### Implementation Order

Steps follow the DDD dependency chain: infrastructure singletons first, then helpers, then plugins, then route/app wiring, then tests at each layer.

**I-1 — Install packages and extend vitest env**
- Files: `packages/api/package.json`, `packages/api/vitest.config.ts`
- Run `npm install @fastify/rate-limit --workspace=packages/api` and `npm install --save-dev ioredis-mock --workspace=packages/api`.
- Add `REDIS_URL: 'redis://localhost:6380'` to `vitest.config.ts` `env` block. This must come first so all subsequent test imports of `config.ts` do not fail.

**I-2 — Extend `config.ts` with `REDIS_URL`**
- Files: `packages/api/src/config.ts`
- Add `REDIS_URL: z.string().min(1).default('redis://localhost:6380')` to `EnvSchema`.
- Write tests first in `config.test.ts` (extend existing `VALID_ENV` + `parseConfig` test suite): assert `REDIS_URL` defaults to `'redis://localhost:6380'` when absent; assert it accepts any non-empty string value; assert `Config` type now includes `REDIS_URL: string`.

**I-3 — Create `lib/redis.ts`**
- Files: `packages/api/src/lib/redis.ts`, `packages/api/src/__tests__/redis.test.ts`
- Write `redis.test.ts` first (TDD):
  - Mock ioredis with `ioredis-mock` (or `vi.mock('ioredis', ...)`) to avoid real connections.
  - Test `connectRedis()` returns `true` and logs `[redis] Connected` on success.
  - Test `connectRedis()` returns `false`, logs `[redis] Redis unavailable`, and does not throw when `redis.connect()` rejects.
  - Test `disconnectRedis()` calls `redis.quit()` and does not throw when quit rejects (swallows error).
- Implement `redis.ts` mirroring `prisma.ts` pattern: read `process.env['REDIS_URL']` directly; create `Redis` instance with `lazyConnect: true`, `maxRetriesPerRequest: 0`, `enableReadyCheck: false`, `retryStrategy`.

**I-4 — Create `lib/cache.ts`**
- Files: `packages/api/src/lib/cache.ts`, `packages/api/src/__tests__/cache.test.ts`
- Write `cache.test.ts` first (TDD) using `ioredis-mock` as a substitute for the `redis` singleton (either via `vi.mock('../lib/redis.js', ...)` or by replacing the ioredis client in the mock). A Pino-compatible stub logger (`{ warn: vi.fn() }` cast to `FastifyBaseLogger`) is used in all tests.
- Test scenarios:
  - `buildKey('food', 'abc-123')` returns `'fxp:food:abc-123'`.
  - `cacheGet` returns `null` on miss.
  - `cacheGet` returns the deserialised object on hit.
  - `cacheGet` returns `null` and calls `logger.warn` when ioredis throws.
  - `cacheSet` stores JSON-serialised value with default TTL 300.
  - `cacheSet` stores value with custom TTL when `options.ttl` provided.
  - `cacheSet` is a no-op (does not call redis) when value is `null`.
  - `cacheSet` is a no-op when value is `undefined`.
  - `cacheSet` does not throw and calls `logger.warn` when ioredis throws.
  - `cacheDel` calls `redis.del` with the key.
  - `cacheDel` does not throw and calls `logger.warn` when ioredis throws.
  - `cacheInvalidatePattern` calls SCAN in a cursor loop and deletes matched keys.
  - `cacheInvalidatePattern` does not throw and calls `logger.warn` when ioredis throws.
- Implement `cache.ts` using cursor-based SCAN with `COUNT 100` for `cacheInvalidatePattern`.

**I-5 — Add `REDIS_UNAVAILABLE` to `errorHandler.ts`**
- Files: `packages/api/src/errors/errorHandler.ts`, `packages/api/src/__tests__/errorHandler.test.ts`
- Write test first in `errorHandler.test.ts` (extend existing `mapError` describe blocks):
  - `Error` with `code: 'REDIS_UNAVAILABLE'` maps to `statusCode: 500`, `code: 'REDIS_UNAVAILABLE'`, message passes through from `error.message`.
- Add the `REDIS_UNAVAILABLE` branch in `mapError` directly after the `DB_UNAVAILABLE` block, using identical structure.

**I-6 — Extend `routes/health.ts` with `?redis=true`**
- Files: `packages/api/src/routes/health.ts`, `packages/api/src/__tests__/health.test.ts`
- Write tests first in `health.test.ts` (add new describe blocks; do not modify existing ones):
  - `redis` field is absent from the response when `?redis=true` is not passed.
  - `?redis=true` with a mock Redis whose `ping()` resolves → 200 with `{ redis: 'connected' }`.
  - `?redis=true` with a mock Redis whose `ping()` rejects → 500 with `REDIS_UNAVAILABLE` envelope.
  - `?db=true&redis=true` with both succeeding → 200 with `{ db: 'connected', redis: 'connected' }`.
  - `?db=true&redis=true` with DB succeeding and Redis failing → 500 `REDIS_UNAVAILABLE`.
  - `?redis=false` does NOT trigger Redis check.
  - `?redis=1` does NOT trigger Redis check.
- Use the injectable mock pattern already established for `prisma`: pass a `redis` mock object `{ ping: vi.fn().mockResolvedValue('PONG') }` via `buildApp` options.
- Implement changes: add `redis` field to `HealthQuerySchema`, `HealthResponseSchema`, `HealthPluginOptions`; add `?redis=true` check branch in route handler after the `?db=true` branch; the DB check runs first, then the Redis check if both params are supplied.

**I-7 — Create `plugins/rateLimit.ts`**
- Files: `packages/api/src/plugins/rateLimit.ts`, `packages/api/src/__tests__/rateLimit.test.ts`
- Write tests first in `rateLimit.test.ts`:
  - `registerRateLimit` returns immediately (no plugin registered) when `NODE_ENV === 'test'`. Verify by checking that no `x-ratelimit-limit` header appears on a health response in test env.
  - After registering via a custom `buildApp` call with `NODE_ENV === 'development'`, confirm the rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`) are present on a response.
  - After exhausting the limit (requires low `max` value for the test — register with overridden `max: 1`), a 429 response contains `{ success: false, error: { code: 'RATE_LIMIT_EXCEEDED' } }`.
  - `GET /health` is not counted against the rate limit (the `skip` function exempts it).
  - Note: because `NODE_ENV` is `'test'` in the default vitest env, these tests must construct a `buildApp` with a custom config where `NODE_ENV` is set to `'development'` or `'production'` to actually exercise the plugin. Use `config: { ...testConfig, NODE_ENV: 'development' }`.
- Implement `rateLimit.ts`: `if (config.NODE_ENV === 'test') return`; dynamic `import('@fastify/rate-limit')`; register with the spec-defined options including `skipOnError: true`, `skip: (req) => req.routeOptions.url === '/health'`, and the `errorResponseBuilder` returning the project error envelope.

**I-8 — Wire `app.ts` and `server.ts`**
- Files: `packages/api/src/app.ts`, `packages/api/src/server.ts`, `packages/api/src/__tests__/f005.edge-cases.test.ts`
- Write edge-case tests first in `f005.edge-cases.test.ts`:
  - `buildApp` with explicit `redis` option injects it into `healthRoutes` (verify via `?redis=true` mock).
  - `buildApp` without `redis` option falls back to the default singleton from `lib/redis.ts`.
  - `REDIS_URL` defaults to `redis://localhost:6380` in config (exercise via `parseConfig` with `REDIS_URL` absent).
  - Combined `?db=true&redis=true` where DB is up and Redis is down returns 500 `REDIS_UNAVAILABLE` (not `DB_UNAVAILABLE`).
  - `?redis=true` coercion: `?redis=false` does not call `ping`; `?redis=0` does not call `ping`; `?redis=true` calls `ping`.
- Modify `app.ts`:
  - Add `redis?: Redis` to `BuildAppOptions` (import `Redis` type from `ioredis`).
  - Import `redis as defaultRedis` from `./lib/redis.js`.
  - Import `registerRateLimit` from `./plugins/rateLimit.js`.
  - Inside `buildApp`: resolve `redisClient = opts.redis ?? defaultRedis`; call `await registerRateLimit(app, cfg)` after `registerCors` and before `registerErrorHandler`; pass `{ prisma: prismaClient, redis: redisClient }` to `healthRoutes`.
  - Update the comment at the top of the file: `Plugin registration order: swagger → cors → rateLimit → errorHandler → routes`.
- Modify `server.ts`:
  - Import `connectRedis`, `disconnectRedis` from `./lib/redis.js`.
  - Call `await connectRedis()` after `buildApp()` and before `server.listen()`.
  - Call `await disconnectRedis()` in the shutdown sequence after `prisma.$disconnect()`.

---

### Testing Strategy

**Test files and their scope:**

| File | Type | What it covers |
|---|---|---|
| `packages/api/src/__tests__/redis.test.ts` | Unit | `connectRedis`, `disconnectRedis` — success and failure branches; console.log/warn calls |
| `packages/api/src/__tests__/cache.test.ts` | Unit | All five cache functions — happy path, miss, null value no-op, error degradation, SCAN loop |
| `packages/api/src/__tests__/errorHandler.test.ts` | Unit | New `REDIS_UNAVAILABLE` branch in `mapError` |
| `packages/api/src/__tests__/health.test.ts` | Route integration | New `?redis=true` branches; combined `?db=true&redis=true`; `redis` field absence |
| `packages/api/src/__tests__/rateLimit.test.ts` | Route integration | Plugin skip in test env; header presence; 429 envelope; `/health` exempt |
| `packages/api/src/__tests__/config.test.ts` | Unit | `REDIS_URL` default; `REDIS_URL` accepted as non-empty string |
| `packages/api/src/__tests__/f005.edge-cases.test.ts` | Mixed | `buildApp` redis injection; `?redis` param coercions; combined check error precedence; config default |

**Mocking strategy:**

- `lib/redis.ts` tests: use `vi.mock('ioredis')` with a factory that returns a mock `Redis` class, or install `ioredis-mock` and `vi.mock('ioredis', () => require('ioredis-mock'))`. The mock must implement `connect()`, `quit()`, `ping()`, `get()`, `set()`, `del()`, `scan()`.
- `lib/cache.ts` tests: mock the entire `./redis.js` module (`vi.mock('../lib/redis.js', () => ({ redis: mockRedisInstance }))`) where `mockRedisInstance` is an `ioredis-mock` instance with methods observable via `vi.spyOn`.
- `routes/health.ts` tests: pass `{ ping: vi.fn() }` cast to `Redis` type in `buildApp` options — no module mocking required; this matches the existing prisma injectable pattern.
- `plugins/rateLimit.ts` tests: construct `buildApp` with `NODE_ENV: 'development'` or `'production'` config to force plugin registration; use `app.inject()` in-process — no real Redis required because `skipOnError: true` means the plugin degrades silently when the ioredis client is in `lazyConnect` mode without a live connection.
- `server.ts` is not unit tested (process entry point, consistent with existing pattern). The `connectRedis`/`disconnectRedis` calls are covered by `redis.test.ts`.

**Integration tests with real Redis:**
- `cache.test.ts` and `redis.test.ts` can include additional `it.skipIf(!process.env['REDIS_URL'] || process.env['REDIS_URL'] === 'redis://localhost:6380')` guarded tests that run against the Docker Redis on CI. Mark these clearly.
- All other tests (route tests via `buildApp + inject`) remain independent of a live Redis.

---

### Key Patterns

**Singleton pattern — follow `prisma.ts` exactly:**
- Read `process.env['REDIS_URL']` directly with `??` fallback; no import from `config.ts`.
- Export the instance as a named `const` (`export const redis`).
- File at `packages/api/src/lib/redis.ts`.

**Plugin skip pattern — follow `swagger.ts` and `cors.ts`:**
- Guard at the top: `if (config.NODE_ENV === 'test') return`.
- Dynamic import the plugin inside the function body (after the guard).
- Async function signature matching `registerSwagger` / `registerCors`: `export async function registerRateLimit(app: FastifyInstance, config: Config): Promise<void>`.

**Injectable dependency pattern — follow `health.ts` and `app.ts`:**
- `BuildAppOptions.redis?: Redis` — optional; defaults to the singleton when absent.
- `HealthPluginOptions.redis: Redis` — required in the plugin; always provided from `buildApp`.
- Test files pass a `vi.fn()` stub object cast to `Redis` — no module mocking needed.

**Error code pattern — follow `DB_UNAVAILABLE` in `errorHandler.ts`:**
- New `REDIS_UNAVAILABLE` branch placed immediately after the `DB_UNAVAILABLE` block.
- `statusCode: 500`, `code: 'REDIS_UNAVAILABLE'`, `message: error.message` (passes caller's message through).
- Health route throws: `Object.assign(new Error('Redis connectivity check failed'), { statusCode: 500, code: 'REDIS_UNAVAILABLE' })`.

**Fail-open principle — three enforcement points:**
1. `lib/redis.ts` `connectRedis()`: try/catch, return false, warn log.
2. `lib/cache.ts` all functions: try/catch, return null/void, warn log via injected logger.
3. `plugins/rateLimit.ts`: `skipOnError: true` passed to `@fastify/rate-limit`.

**TypeScript strict mode constraints:**
- All `process.env` reads: bracket notation (`process.env['REDIS_URL']`), never dot notation.
- No `any` types. Import `Redis` from `ioredis` for type annotations.
- `FastifyBaseLogger` from `fastify` for the logger parameter in `cache.ts`.
- `FastifyInstance` from `fastify` for plugin function signatures.

**Gotchas:**
- `@fastify/rate-limit` v9 uses `req.routeOptions.url` (Fastify v5 API) for the matched route pattern in the `skip` callback. Earlier versions used `req.routerPath`. Do not use `req.url` (that is the raw request URL, not the route pattern).
- `ioredis` `maxRetriesPerRequest: 0` is critical: without it, commands issued to a disconnected client will hang until a reconnect, blocking request handlers. It must be set on the `Redis` constructor options.
- `cacheInvalidatePattern` must use cursor-based SCAN (not `KEYS`). The loop pattern: call `redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100)`, collect keys, pipeline-delete if any, continue until cursor returns `'0'`.
- In `vitest.config.ts`, `REDIS_URL` must be in the `env` block before any test file that imports `config.ts` runs, since `config.ts` parses `process.env` at module-load time.
- `ioredis-mock` does not implement `scan` in all versions. Verify the installed version supports it; if not, mock the scan behaviour manually in `cache.test.ts`.
- The `BuildAppOptions` type in `app.ts` currently does not import from ioredis. The `redis?: Redis` field requires adding `import type { Redis } from 'ioredis'` to `app.ts`.
- Existing tests in `health.test.ts` and `f004.edge-cases.test.ts` call `buildApp({ prisma: ... })` without a `redis` field. These must continue to work after the change — the `redis` field is optional, and `buildApp` falls back to the default singleton. No existing tests need modification.
- `registerRateLimit` is called before `registerErrorHandler` per the spec's registration order (`swagger → cors → rateLimit → errorHandler → routes`). This is important: the error handler must be registered after the rate limit plugin so that 429 responses from rate limiting pass through the global error handler shape. However, the `errorResponseBuilder` in `@fastify/rate-limit` already formats the 429 response directly, bypassing `setErrorHandler`. The registration order is therefore: rateLimit plugin before errorHandler, matching the spec.

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit/integration tests written and passing (46 new, 506 total)
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
- [x] Step 4: `production-code-validator` executed, quality gates pass (0 issues)
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 5: `qa-engineer` executed
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Details |
|------|--------|---------|
| 2026-03-12 | Step 0 | Spec created: Redis singleton, cache helper, rate limit plugin, health extension |
| 2026-03-12 | Step 1 | Branch `feature/F005-redis-connection-cache-layer`, ticket created |
| 2026-03-12 | Step 2 | Plan approved: 8 steps (I-1 to I-8) |
| 2026-03-12 | Step 3 | Implementation complete: 3 new files, 5 modified, 46 new tests |
| 2026-03-12 | Step 4 | Production validator: APPROVED, 0 issues. 506 total tests, lint/build clean |

---

## Notes

- `ioredis` v5 is already installed (`^5.4.2` in `package.json`). No install step needed for the client itself.
- `@fastify/rate-limit` v9+ is required for Fastify v5 compatibility. Verify peer dep before installing.
- `maxRetriesPerRequest: 0` on the ioredis client is critical for fail-open behaviour. Without it, a pending command will retry indefinitely if Redis is down, blocking request handlers.
- The `skipOnError: true` option in `@fastify/rate-limit` is what enables fail-open rate limiting. Confirm it is available in the installed version.
- When writing tests for the cache helper, the ioredis client should be tested against a real Redis instance (integration tests) OR via `ioredis-mock` (unit tests). Prefer `ioredis-mock` for unit tests to keep CI fast and independent from a running Redis. Use real Redis for integration tests marked with `it.skipIf(!process.env['REDIS_URL'])`.
