# F-TIER — Tier-aware daily rate limits + admin bypass

**Status:** Done
**Type:** Feature (Standard)
**Priority:** High (blocks QA testing + F091 voice integration)
**Branch:** `feature/F-tier-rate-limits`

---

## Spec

### Problem

`actorRateLimit.ts` ignores `apiKeyContext.tier` and applies a flat 50 queries/day + 10 photos/day to all actors regardless of their API key tier. There is no `admin` tier concept — even with a valid API key, testing is capped at 50/day, which blocks automated QA and parallel agent testing.

Additionally, `/conversation/audio` shares the `queries` bucket instead of having its own `voice` bucket, which means voice and text queries compete for the same 50/day limit.

### Design

#### Tier definitions

| Tier | Source | Description |
|------|--------|-------------|
| `anonymous` | No API key (`apiKeyContext === undefined`) | Default web visitors |
| `free` | `api_keys.tier = 'free'` | Registered users, free plan |
| `pro` | `api_keys.tier = 'pro'` | Paid users |
| `admin` | `api_keys.tier = 'admin'` | Internal testing, no limits |

Note: `basic` tier is deferred to F095-F097. NOT in scope.

#### Bucket definitions

| Bucket | Routes | Description |
|--------|--------|-------------|
| `queries` | `/estimate`, `/conversation/message` | Text-based estimation queries |
| `photos` | `/analyze/menu` | Photo analysis |
| `voice` | `/conversation/audio` | Voice queries (moved FROM `queries` bucket) |
| `realtime_minutes` | (placeholder — F095 will add route) | Real-time voice streaming |

#### Daily limits matrix

| Bucket | anonymous | free | pro | admin |
|--------|-----------|------|-----|-------|
| queries | 50 | 100 | 500 | ∞ |
| photos | 10 | 20 | 100 | ∞ |
| voice | 30 | 30 | 120 | ∞ |
| realtime_minutes | 0 | 0 | 10 | ∞ |

`∞` = bypass (no Redis incr, no expire, immediate return).
`0` = blocked (always 429).

#### 429 error response

Current response only includes a generic message. New format adds `bucket` and `tier` inside `error.details` to follow the established error envelope shape (`{ success, error: { message, code, details? } }`):

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Daily voice limit exceeded (30/day for free tier).",
    "details": {
      "bucket": "voice",
      "tier": "free",
      "limit": 30,
      "resetAt": "2026-04-22T00:00:00Z"
    }
  }
}
```

Note: reuses existing `RATE_LIMIT_EXCEEDED` code (not a new code) for consistency with the error handler.

#### Redis failure behavior (preserved from F069/ADR-016)

The rewritten plugin MUST preserve the existing dual-fallback policy:
- **Redis unavailable + anonymous actor** → fail-closed (429)
- **Redis unavailable + any API key tier** → fail-open (allow request)

#### Clarification: admin tier vs ADMIN_API_KEY env var

The DB `tier='admin'` key is **only for rate-limit bypass on public API routes** (`/estimate`, `/conversation/*`, `/analyze/*`). It does NOT grant access to admin-only routes (`/analytics/*`, `/ingest/*`) — those continue to use the `ADMIN_API_KEY` env var validated by `adminAuth.ts`. These are two separate auth mechanisms by design.

#### Admin key seed script

Extend existing `packages/api/src/scripts/seedApiKey.ts` with a `--tier` parameter (default: `free`). Usage:
- `npm run seed:api-key -- --tier admin` → creates admin key
- Existing usage unchanged (default tier=free)
- Reads `SEED_KEY_PLAIN` from env (or generates and logs one)
- SHA-256 hash → upsert into `api_keys` with specified tier, `is_active=true`

### Files to modify

| File | Change |
|------|--------|
| `packages/api/prisma/schema.prisma` | Add `admin` to `ApiKeyTier` enum |
| `packages/api/prisma/migrations/<timestamp>_add_admin_tier/migration.sql` | New: Prisma migration for enum change |
| `packages/shared/src/schemas/apiKey.ts` | Add `'admin'` to `ApiKeyTierSchema` |
| `packages/api/src/generated/kysely-types.ts` | Regenerate (includes ApiKeyTier enum) |
| `packages/api/src/plugins/auth.ts` | Update `CachedApiKey.tier` type to include `'admin'` |
| `packages/api/src/plugins/actorRateLimit.ts` | Rewrite with tier-aware limits + admin bypass |
| `packages/api/src/__tests__/f069.actorRateLimit.unit.test.ts` | Extend with tier-aware tests |
| `packages/api/src/scripts/seedApiKey.ts` | Add `--tier` parameter support |
| `packages/api/package.json` | Add `seed:admin-key` convenience script |
| `docs/project_notes/key_facts.md` | Update rate limit documentation |
| `docs/specs/api-spec.yaml` | Update 429 schema, ApiKeyTier enum, bucket descriptions |

### Scope OUT

- NO tier `basic` — deferred to F095-F097
- NO touch `rateLimit.ts` (per-IP/min gateway rate limit) — different plugin, different purpose. Note: admin tier will still be subject to gateway rate limits (100 req/15min for non-pro keys). This is acceptable — daily limit bypass is the primary need; gateway burst protection is desirable even for admin.
- NO add `/conversation/voice/stream` route — only placeholder comment, F095 adds it
- NO per-IP daily cap — F091 scope
- NO modify admin route auth (`adminAuth.ts`) — admin tier is for public API rate-limit bypass only

### Coordination with F091

F091 assumes after this PR:
- Voice bucket EXISTS in `actorRateLimit.ts`
- `/conversation/audio` mapped to `voice` (not `queries`)
- 429 error includes `bucket` and `tier` fields
- This PR must merge to develop BEFORE F091

---

## Acceptance Criteria

- [ ] AC1: Prisma enum `ApiKeyTier` includes `admin` value + migration applied
- [ ] AC2: `ApiKeyTierSchema` in shared package includes `'admin'`
- [ ] AC3: `actorRateLimit.ts` reads tier from `apiKeyContext` (or `'anonymous'` when absent)
- [ ] AC4: Admin tier bypasses daily rate limit completely (no Redis incr called)
- [ ] AC5: Free tier gets 100 queries/day, 20 photos/day, 30 voice/day
- [ ] AC6: Pro tier gets 500 queries/day, 100 photos/day, 120 voice/day, 10 realtime_minutes/day
- [ ] AC7: Anonymous tier keeps current limits: 50 queries/day, 10 photos/day, 30 voice/day
- [ ] AC8: `/conversation/audio` maps to `voice` bucket (not `queries`)
- [ ] AC9: `DAILY_LIMITS_BY_TIER` matrix exported and unit-testable; `realtime_minutes` = 0 for anonymous/free, 10 for pro
- [ ] AC10: 429 error response includes `bucket` and `tier` inside `error.details`
- [ ] AC11: `seedApiKey.ts` accepts `--tier admin` parameter; `seed:admin-key` npm script works
- [ ] AC12: Existing F069 tests remain green (no regressions)
- [ ] AC13: Prisma migration runs cleanly on dev DB; Kysely types regenerated
- [ ] AC14: `key_facts.md` updated with new rate limit documentation
- [ ] AC15: Redis failure preserves ADR-016 behavior: fail-closed for anonymous, fail-open for any API key tier
- [ ] AC16: `api-spec.yaml` updated: 429 schema with details, ApiKeyTier enum, bucket descriptions

---

## Definition of Done

- [ ] All AC verified with automated tests
- [ ] TypeScript clean across api + shared packages
- [ ] Prisma migration applied to dev DB
- [ ] Admin key seeded and tested on dev
- [ ] No regressions in existing test suite
- [ ] Documentation updated

---

## Workflow Checklist

- [ ] Step 0: Spec (this document)
- [ ] Step 1: Branch created
- [ ] Step 2: Implementation plan
- [ ] Step 3: TDD implementation
- [ ] Step 4: production-code-validator
- [ ] Step 5: PR + code-review + qa-engineer
- [ ] Step 6: Merge + docs

---

## Implementation Plan

### Existing Code to Reuse

- **`packages/api/src/plugins/actorRateLimit.ts`** — rewrite in-place; preserve `ROUTE_BUCKET_MAP` shape and Redis key format (`actor:limit:<actorId>:<date>:<bucket>`)
- **`packages/api/src/plugins/auth.ts`** — `CachedApiKey` interface and `request.apiKeyContext` already carry `tier`; only the union type needs to be widened
- **`packages/api/src/errors/errorHandler.ts`** — `RATE_LIMIT_EXCEEDED` code already handled (line 501); **do not add a new error code**. The actorRateLimit plugin MUST send the 429 directly via `reply.send(...)` (not throw) to include `error.details` in the body, because `mapError` does not propagate details for `RATE_LIMIT_EXCEEDED`
- **`packages/shared/src/schemas/apiKey.ts`** — `ApiKeyTierSchema`, `ApiKeyContextSchema`, `ApiKeySchema` — extend in-place
- **`packages/api/src/scripts/seedApiKey.ts`** — extend `main()` with `--tier` arg-parsing; reuse all helper functions (`generateDeterministicKey`, `generateRandomKey`, `computeKeyHash`, `computeKeyPrefix`, `upsertBotKey`). The env var for the key value will be `SEED_KEY_PLAIN` (as specified in the spec)
- **`packages/api/src/generated/kysely-enums.ts`** — regenerate via `npx prisma generate` after the migration; do not edit manually
- **`packages/api/src/__tests__/f069.actorRateLimit.unit.test.ts`** — extend in-place; the existing mirrored constants (`DAILY_LIMITS`, `ROUTE_BUCKET_MAP`) will be replaced by importing `DAILY_LIMITS_BY_TIER` from the plugin

---

### Files to Create

| Path | Purpose |
|------|---------|
| `packages/api/prisma/migrations/20260420190000_add_admin_tier_f-tier/migration.sql` | Migration SQL to add `admin` value to the `api_key_tier` enum |

---

### Files to Modify

| Path | Change |
|------|--------|
| `packages/api/prisma/schema.prisma` | Add `admin` to `ApiKeyTier` enum block |
| `packages/shared/src/schemas/apiKey.ts` | Add `'admin'` to `ApiKeyTierSchema`; widen `ApiKeyContextSchema` and `ApiKeySchema` |
| `packages/api/src/generated/kysely-enums.ts` | Regenerated by `prisma generate`; add `admin` to `ApiKeyTier` const |
| `packages/api/src/generated/kysely-types.ts` | Regenerated by `prisma generate` (may be a no-op if only enum changes) |
| `packages/api/src/plugins/auth.ts` | Widen `CachedApiKey.tier` and `dbRow.tier` type to `'free' \| 'pro' \| 'admin'` |
| `packages/api/src/plugins/actorRateLimit.ts` | Full rewrite: tier-aware `DAILY_LIMITS_BY_TIER` matrix, admin bypass, `voice` bucket, enriched 429 `error.details` |
| `packages/api/src/__tests__/f069.actorRateLimit.unit.test.ts` | Extend with tier-aware tests; import `DAILY_LIMITS_BY_TIER` from plugin instead of mirroring constants |
| `packages/api/src/__tests__/f070.conversation.route.test.ts` | Update 429 assertion: `ACTOR_RATE_LIMIT_EXCEEDED` → `RATE_LIMIT_EXCEEDED` (line 451) |
| `packages/api/src/__tests__/f075.audio.route.test.ts` | Update 429 assertion: `ACTOR_RATE_LIMIT_EXCEEDED` → `RATE_LIMIT_EXCEEDED` (line 560) |
| `packages/api/src/scripts/seedApiKey.ts` | Add `--tier` parameter; `SEED_KEY_PLAIN` env var; keep `upsertBotKey` as backward-compatible wrapper |
| `packages/api/package.json` | Add `seed:api-key` and `seed:admin-key` npm scripts |
| `docs/project_notes/key_facts.md` | Update rate limit documentation section |
| `docs/specs/api-spec.yaml` | Update `ApiKeyTier` enum, 429 schema for affected routes, bucket descriptions |

---

### Implementation Order

Follow a strict layer order: DB schema → shared types → plugin → tests → scripts → docs.

**Step 1 — Prisma migration (AC1, AC13)**
- Estimated effort: 15 min
- Edit `packages/api/prisma/schema.prisma`: add `admin` to the `ApiKeyTier` enum block.
- Create `packages/api/prisma/migrations/20260420190000_add_admin_tier_f-tier/migration.sql`:
  ```sql
  ALTER TYPE "api_key_tier" ADD VALUE IF NOT EXISTS 'admin';
  ```
  Note: `ADD VALUE IF NOT EXISTS` is idempotent and does not require a transaction block. PostgreSQL enum additions are append-only; no `UPDATE` to existing rows is needed.
- Apply: `npx prisma migrate deploy` (NOT `migrate dev` — shadow DB issue with pgvector).
- Regenerate Kysely types: `npx prisma generate` (updates `kysely-enums.ts` and `kysely-types.ts`).
- Verify `packages/api/src/generated/kysely-enums.ts` now contains `admin: "admin"` in the `ApiKeyTier` const.

**Step 2 — Shared schema update (AC2)**
- Estimated effort: 10 min
- Edit `packages/shared/src/schemas/apiKey.ts`:
  - `ApiKeyTierSchema`: change to `z.enum(['free', 'pro', 'admin'])`
  - `ApiKeySchema.tier`: automatically picks up the change via `ApiKeyTierSchema`
  - `ApiKeyContextSchema.tier`: automatically picks up the change
  - `ApiKeyValidationResultSchema.tier`: automatically picks up the change
- Run `npm run typecheck -w @foodxplorer/shared` to confirm no breakage.

**Step 3 — Auth plugin type widening (AC1, AC3)**
- Estimated effort: 10 min
- Edit `packages/api/src/plugins/auth.ts`:
  - `CachedApiKey.tier`: change to `'free' | 'pro' | 'admin'`
  - `dbRow` local type in the DB-lookup branch: change to `'free' | 'pro' | 'admin'`
  - No logic changes required — auth validates keys, not rate limits.
- Run `npm run typecheck -w @foodxplorer/api`.

**Step 4 — Write failing tests (RED) for actorRateLimit (AC3–AC12, AC15)**
- Estimated effort: 30 min
- In `packages/api/src/__tests__/f069.actorRateLimit.unit.test.ts`:
  - Remove the locally mirrored `DAILY_LIMITS` and `ROUTE_BUCKET_MAP` constants at the top.
  - Import `DAILY_LIMITS_BY_TIER` and `ROUTE_BUCKET_MAP` from `'../plugins/actorRateLimit.js'` (they will be exported in Step 5).
  - Keep ALL existing test cases (AC12 — no regressions). The existing tests that assert `DAILY_LIMITS.queries === 50` will be updated to assert against `DAILY_LIMITS_BY_TIER['anonymous']['queries'] === 50`.
  - Add new test groups:

  **Group: `DAILY_LIMITS_BY_TIER matrix`** (AC5, AC6, AC7, AC9)
  - `anonymous` tier: queries=50, photos=10, voice=30, realtime_minutes=0
  - `free` tier: queries=100, photos=20, voice=30, realtime_minutes=0
  - `pro` tier: queries=500, photos=100, voice=120, realtime_minutes=10
  - `admin` tier: all buckets return `Infinity` (or a sentinel value — test against `DAILY_LIMITS_BY_TIER['admin']['queries']` being truthy-falsy as appropriate; see implementation note in Step 5)

  **Group: `bucket mapping`** (AC8)
  - `/conversation/audio` maps to `voice` bucket (not `queries`)
  - `/conversation/message` maps to `queries`
  - `/estimate` maps to `queries`
  - `/analyze/menu` maps to `photos`

  **Group: `tier-aware limit selection`** (AC3, AC5, AC6, AC7)
  - A function `getLimitForTierAndBucket(tier, bucket)` returns the correct number
  - Admin tier returns a value that signals bypass (implementation may use `Infinity` or a special sentinel; test the bypass behaviour, not the raw number)

  **Group: `admin bypass`** (AC4)
  - When tier is `admin`, Redis `incr` is NOT called
  - Request proceeds immediately (no 429)

  **Group: `realtime_minutes blocked for anonymous/free`** (AC9)
  - When bucket is `realtime_minutes` and tier is `anonymous` or `free`, limit is 0 → always 429

  **Group: `429 error details shape`** (AC10)
  - Response body includes `error.details.bucket`, `error.details.tier`, `error.details.limit`, `error.details.resetAt`
  - Error code is `RATE_LIMIT_EXCEEDED` (not `ACTOR_RATE_LIMIT_EXCEEDED`)

  **Group: `Redis failure ADR-016`** (AC15)
  - Anonymous actor + Redis failure → 429 (fail-closed)
  - Any API key tier + Redis failure → allow (fail-open)
  - The fail-open 429 for anonymous still uses `RATE_LIMIT_EXCEEDED` code

  **Group: `Redis key structure`** (existing, no change needed)
  - Keep existing key format tests

- At this point all new tests should FAIL because the exports don't exist yet.

**Step 5 — Rewrite actorRateLimit.ts (GREEN) (AC3–AC10, AC15)**
- Estimated effort: 45 min
- Full rewrite of `packages/api/src/plugins/actorRateLimit.ts`. Key design decisions:

  **Constants to export:**
  ```
  DAILY_LIMITS_BY_TIER: Record<tier, Record<bucket, number>>
  ```
  - Use `Infinity` for admin tier (all buckets). This is the canonical way to signal "no limit" — `current > Infinity` is always false.
  - `realtime_minutes` must be present for all tiers (0 for anonymous/free, 10 for pro, Infinity for admin).

  ```
  ROUTE_BUCKET_MAP: Record<string, string>
  ```
  - `/conversation/audio` → `'voice'` (was `'queries'` — this is the key change for AC8)
  - Keep all other existing mappings.

  **Plugin logic changes:**
  1. Resolve tier: `const tier = request.apiKeyContext?.tier ?? 'anonymous'`
  2. Look up limit: `const limit = DAILY_LIMITS_BY_TIER[tier]?.[bucket]`
     - If `limit === undefined`: throw (safety guard — bucket not in matrix)
  3. Admin bypass: `if (limit === Infinity) return;` — no Redis call at all (AC4)
  4. Zero limit (realtime_minutes for anonymous/free): `if (limit === 0) { return reply.code(429)... }` — return immediately without Redis incr
  5. Redis incr + expire logic: identical to current implementation
  6. On limit exceeded: return 429 with enriched body:
     ```json
     {
       "success": false,
       "error": {
         "code": "RATE_LIMIT_EXCEEDED",
         "message": "Daily <bucket> limit exceeded (<limit>/day for <tier> tier).",
         "details": {
           "bucket": "<bucket>",
           "tier": "<tier>",
           "limit": <limit>,
           "resetAt": "<ISO date for start of next UTC day>"
         }
       }
     }
     ```
     `resetAt` calculation: `new Date(new Date().toISOString().slice(0,10) + 'T00:00:00Z')` shifted +1 day (i.e., `new Date(Date.UTC(y, m, d+1))`).
  7. Redis failure handler: preserve ADR-016 — `hasApiKey` check unchanged. The fail-closed 429 for anonymous uses `RATE_LIMIT_EXCEEDED` code (not `ACTOR_RATE_LIMIT_EXCEEDED`).

  **Note on `hasApiKey`:** `const hasApiKey = request.apiKeyContext !== undefined` — this is true for `free`, `pro`, AND `admin` tiers. Admin tier will never reach the Redis call (Infinity bypass above), so the fail-open path is only relevant for free/pro (which is correct).

- Run `npm test -w @foodxplorer/api` — all tests should now pass.
- **Cross-review fix**: Update route integration tests that assert the old error code:
  - `f070.conversation.route.test.ts:451`: change `'ACTOR_RATE_LIMIT_EXCEEDED'` → `'RATE_LIMIT_EXCEEDED'`
  - `f075.audio.route.test.ts:560`: change `'ACTOR_RATE_LIMIT_EXCEEDED'` → `'RATE_LIMIT_EXCEEDED'`

**Step 6 — Extend seedApiKey.ts (AC11)**
- Estimated effort: 20 min
- Edit `packages/api/src/scripts/seedApiKey.ts`:
  - Parse `--tier` from `process.argv`: default to `'free'`; accepted values: `'free' | 'pro' | 'admin'`; throw with usage message on unknown value.
  - Add `SEED_KEY_PLAIN` env var support: if set, use that value directly as the raw key (takes precedence over `BOT_API_KEY_SEED` + HMAC or random generation). This allows operators to supply a specific known key when seeding an admin key.
  - Add new `upsertKey({ rawKey, tier, name })` generalised helper. **Keep `upsertBotKey` as a backward-compatible wrapper** that calls `upsertKey({ rawKey, tier: 'free', name: 'Telegram Bot' })` — existing F026 tests import `upsertBotKey` directly and must not break.
  - The final `console.log` should print `SEED_KEY_PLAIN=<rawKey>` (not `BOT_API_KEY=`) when not using `BOT_API_KEY_SEED`.
  - Keep `BOT_API_KEY=` prefix when `BOT_API_KEY_SEED` is set (backward-compatible for bot deployment).
- Edit `packages/api/package.json` — add to `scripts`:
  - `"seed:api-key": "tsx src/scripts/seedApiKey.ts"` — generic key seeder (default: free tier)
  - `"seed:admin-key": "tsx src/scripts/seedApiKey.ts --tier admin"` — convenience alias

**Step 7 — Documentation updates (AC14, AC16)**
- Estimated effort: 20 min
- Update `docs/project_notes/key_facts.md` — **Actor rate limiting** section (currently on line 164):
  - Replace flat limits (50/10) with the full tier matrix table
  - Note `voice` bucket added, `/conversation/audio` remapped
  - Note `admin` tier bypasses daily limits
  - Note exported `DAILY_LIMITS_BY_TIER` constant
- Update `docs/specs/api-spec.yaml`:
  - `components/schemas/ApiKeyTier` enum: add `admin`; update description to include admin tier
  - All existing `429` responses that reference `ACTOR_RATE_LIMIT_EXCEEDED`: change code to `RATE_LIMIT_EXCEEDED` and add `details` object with `bucket`, `tier`, `limit`, `resetAt`
  - Routes affected: `GET /estimate`, `POST /conversation/message`, `POST /conversation/audio`, `POST /analyze/menu`
  - Add or update description for `POST /conversation/audio` to state it uses the `voice` bucket (not `queries`)
  - Add `realtime_minutes` bucket description (placeholder, no route yet)

**Step 8 — Final verification**
- Estimated effort: 10 min
- `npm run typecheck -w @foodxplorer/api` — clean
- `npm run typecheck -w @foodxplorer/shared` — clean
- `npm test -w @foodxplorer/api` — all tests pass
- `npm test -w @foodxplorer/shared` — all tests pass
- Manually seed admin key: `npm run seed:admin-key -w @foodxplorer/api`
- Verify admin key allows unlimited requests (test with Redis MONITOR or by inspecting that incr is never called)

---

### Testing Strategy

**Test file to modify:** `packages/api/src/__tests__/f069.actorRateLimit.unit.test.ts`

No new test files required — all logic is in the plugin and can be unit-tested by importing exported constants and exercising mock-Redis helpers.

**Key test scenarios:**

| AC | Scenario | Type |
|----|----------|------|
| AC3 | Tier resolved from `apiKeyContext.tier` or defaults to `anonymous` | Unit |
| AC4 | Admin tier: `redis.incr` never called; request proceeds | Unit |
| AC5 | Free: queries=100, photos=20, voice=30 | Unit (constant assertion) |
| AC6 | Pro: queries=500, photos=100, voice=120, realtime_minutes=10 | Unit (constant assertion) |
| AC7 | Anonymous: queries=50, photos=10, voice=30 | Unit (constant assertion) |
| AC8 | `/conversation/audio` → `voice` bucket | Unit (map assertion) |
| AC9 | `realtime_minutes`=0 for anonymous/free → always 429; =10 for pro | Unit |
| AC10 | 429 body includes `error.details.{ bucket, tier, limit, resetAt }` | Unit |
| AC10 | Error code is `RATE_LIMIT_EXCEEDED` (not `ACTOR_RATE_LIMIT_EXCEEDED`) | Unit |
| AC12 | All existing F069 tests remain green | Unit (regression) |
| AC15 | Redis fail + anonymous → 429 (fail-closed) | Unit |
| AC15 | Redis fail + API key (any tier) → allow (fail-open) | Unit |

**Mocking strategy:**
- All tests are pure unit tests: no Fastify instance, no DB, no real Redis.
- Redis is mocked with the existing `createMockRedis(currentCount)` and `createFailingRedis()` helper factories in the test file — keep and extend them.
- Test the plugin logic by directly testing the exported constants and by simulating the `onRequest` hook logic (mock `request.apiKeyContext`, `request.actorId`, `reply.code().send()`).
- No integration test required for this feature — the plugin has no DB dependency.

---

### Key Patterns

**Error envelope for 429 — direct `reply.send()`, not throw:**
The current `mapError` in `errorHandler.ts` handles `RATE_LIMIT_EXCEEDED` but does NOT forward `details`. The actor rate limit plugin already sends 429 directly via `reply.code(429).send({ ... })`, bypassing `mapError`. This pattern MUST be preserved in the rewrite. Do not refactor to throw — that would lose the `details` field. Reference: current pattern at lines 76-84 and 93-102 of `actorRateLimit.ts`.

**Admin tier is NOT a bypass for route auth:**
`request.apiKeyContext?.tier === 'admin'` only affects the daily rate limit check. Admin-only routes (`/analytics/*`, `/ingest/*`, etc.) still require `ADMIN_API_KEY` via `adminAuth.ts`. These are two independent systems.

**`Infinity` for admin limits:**
Using `Infinity` for the admin bypass (`limit === Infinity`) is preferred over a string sentinel like `'bypass'` because: (a) it keeps `DAILY_LIMITS_BY_TIER` typed as `Record<string, Record<string, number>>`, (b) the check `current > Infinity` is always false (natural bypass), and (c) `limit === Infinity` is explicit and testable. The early-return `if (limit === Infinity) return;` before the Redis call is the required pattern.

**Redis key format — do not change:**
`actor:limit:<actorId>:<YYYY-MM-DD>:<bucket>` — preserve exactly. Changing this would orphan existing counters in Redis for live users.

**Migration timestamp:**
Latest migration is `20260413180000_standard_portions_f-ux-b`. The new migration timestamp `20260420190000` is sequentially valid (2026-04-20 19:00:00). No gaps in sequence.

**Kysely types regeneration:**
After applying the migration and editing `schema.prisma`, run `npx prisma generate` from `packages/api/`. This regenerates both `kysely-enums.ts` and `kysely-types.ts` via the `prisma-kysely` generator. The `ApiKeyTier` const in `kysely-enums.ts` will automatically gain `admin: "admin"`.

**seedApiKey.ts — `require.main === module` guard:**
The existing `if (require.main === module)` guard (line 111) ensures the script only runs as a CLI and not when imported by tests. Preserve this pattern.

**`seed:admin-key` convenience script:**
This is simply `tsx src/scripts/seedApiKey.ts --tier admin` — no new script file needed. The `--tier` flag is parsed inside the existing `main()` function.

**Existing test constant mirroring:**
The test file currently mirrors `DAILY_LIMITS` and `ROUTE_BUCKET_MAP` locally (lines 29-33). After Step 5, these should be replaced with imports from the plugin (`import { DAILY_LIMITS_BY_TIER, ROUTE_BUCKET_MAP } from '../plugins/actorRateLimit.js'`). This makes tests authoritative rather than mirrored, and is the reason `DAILY_LIMITS_BY_TIER` must be a named export.

**`realtime_minutes` = 0 for anonymous/free:**
A limit of `0` means "always blocked". The plugin must handle this as a special case BEFORE calling `redis.incr` (no point incrementing a counter for a bucket that will always reject). Pattern: `if (limit === 0) { return reply.code(429)... }` immediately after limit lookup.

**`resetAt` field:**
This is the start of the NEXT UTC day. Calculation: get today's date string `YYYY-MM-DD`, increment the day by 1, produce an ISO string at midnight UTC. Example: `new Date(Date.UTC(year, month, day + 1)).toISOString()` where day components come from parsing the `dateKey`. This is deterministic and timezone-safe.

---

## Merge Checklist Evidence

| # | Action | Done | Evidence |
|---|--------|:----:|---------|
| 0 | Ticket complete | [ ] | |
| 1 | AC checked | [ ] | |
| 2 | DoD checked | [ ] | |
| 3 | Tests pass | [ ] | |
| 4 | Lint clean | [ ] | |
| 5 | Build clean | [ ] | |
| 6 | key_facts updated | [ ] | |
| 7 | Tracker updated | [ ] | |
| 8 | Evidence filled | [ ] | |

---

## Completion Log

| Date | Step | Detail |
|------|------|--------|
| 2026-04-21 | Step 0 | Spec v1 written from user requirements |
| 2026-04-21 | Step 0 | Spec reviewed by Codex (REVISE, 4 IMPORTANT + 1 SUGGESTION) + Gemini (REVISE, 1 CRITICAL + 1 IMPORTANT + 2 SUGGESTION). 8 findings, all addressed in spec v2: error envelope fix, Redis fallback AC, Prisma migration + Kysely, admin vs ADMIN_API_KEY clarification, OpenAPI scope, seedApiKey reuse, realtime_minutes testability |
| 2026-04-21 | Step 2 | Plan written by backend-planner agent. Reviewed by Gemini (APPROVED, 1 SUGGESTION) + Codex (REVISE, 2 IMPORTANT + 1 SUGGESTION). 3 findings addressed: route integration test 429 code update, upsertBotKey backward compat wrapper, env var precedence |
