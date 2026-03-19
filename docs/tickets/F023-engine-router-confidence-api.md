# F023: Engine Router & Confidence API

**Feature:** F023 | **Type:** Backend-Refactor | **Priority:** High
**Status:** Done | **Branch:** feature/F023-engine-router-confidence-api (deleted)
**Created:** 2026-03-19 | **Dependencies:** F020, F021, F022

---

## Spec

### Description

The L1→L2→L3 estimation cascade is currently hardcoded directly in `packages/api/src/routes/estimate.ts` (~120 lines of orchestration logic mixed with HTTP concerns). F023 extracts this into a dedicated `engineRouter` module that:

1. **Encapsulates the cascade** — `runEstimationCascade(opts)` handles L1→L2→L3 sequencing, error wrapping, and result construction
2. **Provides an F024 extension seam** — accepts an optional `level4Lookup` function parameter so F024 (LLM Integration Layer) can inject a 4th level without touching the router or the route
3. **Makes the route thin** — `GET /estimate` becomes cache check → `runEstimationCascade()` → cache write → reply

**Key design decisions:**
- Single exported function (`runEstimationCascade`), not a class or strategy pattern — Phase 1 simplicity
- `Level4LookupFn` is a placeholder type signature; `EstimateMatchTypeSchema` does NOT get `'llm_estimation'` until F024
- Query normalization: route normalizes for cache key only; router receives raw query, normalizes internally for lookups, echoes raw in `data.query`; lookups also normalize (harmless no-op)
- `EngineRouterResult` includes `levelHit: 1|2|3|4|null` for debug logging only — not exposed in the API response
- No new Zod schemas — the router returns `EstimateData` (existing shared type)

### API Changes (if applicable)

No new endpoints. `GET /estimate` behavior and response shape are unchanged. The route delegates to `runEstimationCascade()` internally.

`docs/specs/api-spec.yaml` updated: description now references `runEstimationCascade()` (F023).

### Data Model Changes (if applicable)

None.

### UI Changes (if applicable)

None.

### Edge Cases & Error Handling

- **DB_UNAVAILABLE from any level** — router re-throws with `{ statusCode: 500, code: 'DB_UNAVAILABLE' }` (same as current behavior)
- **L3 graceful skip** (no API key) — router passes `openAiApiKey` through; L3 returns null → cascade continues to total miss
- **All levels miss** — returns `EstimateData` with `level1Hit: false, level2Hit: false, level3Hit: false, result: null`
- **Cache interaction unchanged** — cache check/write stays in the route, not in the router (cache is an HTTP concern)
- **`level4Lookup` undefined** — cascade stops after L3 (identical to current behavior)
- **`level4Lookup` throws** — wraps in DB_UNAVAILABLE error (same pattern as L1-L3)

---

## Implementation Plan

### Existing Code to Reuse

- `packages/api/src/estimation/level1Lookup.ts` — `level1Lookup(db, query, options)` — no changes, consumed by router
- `packages/api/src/estimation/level2Lookup.ts` — `level2Lookup(db, query, options)` — no changes, consumed by router
- `packages/api/src/estimation/level3Lookup.ts` — `level3Lookup(db, query, options)` — no changes, consumed by router
- `packages/api/src/estimation/types.ts` — `Level1Result`, `Level2Result`, `Level3Result` — all reused as-is
- `packages/shared/src/schemas/estimate.ts` — `EstimateData` type — `EngineRouterResult.data` field; no schema changes
- `packages/api/src/config.ts` — `config.OPENAI_API_KEY` — stays in route; passed into `runEstimationCascade` as `openAiApiKey` option
- `packages/api/src/lib/cache.ts` — `buildKey`, `cacheGet`, `cacheSet` — stays in route, not moved to router
- Error wrapping pattern: `Object.assign(new Error('...'), { statusCode: 500, code: 'DB_UNAVAILABLE', cause: err })` — replicate in router for L4; L1-L3 already throw with `code: 'DB_UNAVAILABLE'` internally so the router re-throws them as-is with `statusCode: 500` added

### Files to Create

1. `packages/api/src/__tests__/f023.engineRouter.unit.test.ts`
   Unit tests for `runEstimationCascade`. Mocks `level1Lookup`, `level2Lookup`, `level3Lookup`. Covers all cascade branches and the `Level4LookupFn` extension point. Written first (TDD).

2. `packages/api/src/__tests__/f023.estimate.route.test.ts`
   Route-level tests via `buildApp().inject()`. Mocks `runEstimationCascade` directly (not individual lookups). Confirms the route is thin: delegates to the router and the response shape is unchanged. Written before the route refactor.

3. `packages/api/src/estimation/engineRouter.ts`
   New module containing:
   - `Level4LookupFn` type (placeholder for F024 injection)
   - `EngineRouterOptions` interface
   - `EngineRouterResult` type
   - `runEstimationCascade(opts): Promise<EngineRouterResult>` function

### Files to Modify

1. `packages/api/src/estimation/index.ts`
   Add exports: `runEstimationCascade`, `EngineRouterOptions`, `EngineRouterResult`, `Level4LookupFn`.

2. `packages/api/src/routes/estimate.ts`
   Replace the inline L1→L2→L3 cascade (~100 lines) with a single `runEstimationCascade()` call. Keep: query param parsing, normalization, cache check, cache write, `reply.send`. Remove: direct imports of `level1Lookup`, `level2Lookup`, `level3Lookup`. Add import of `runEstimationCascade` from `../estimation/index.js`. Route handler body should shrink to < 50 lines.

3. `docs/specs/api-spec.yaml`
   Update `GET /estimate` description to reference `runEstimationCascade()` (F023) as the spec already calls for.

### Implementation Order

1. **Write unit test file** (`f023.engineRouter.unit.test.ts`) — define all test cases with mocked lookups; tests will fail (red phase)
2. **Create `engineRouter.ts`** — implement `Level4LookupFn`, `EngineRouterOptions`, `EngineRouterResult`, and `runEstimationCascade`; unit tests turn green
3. **Update barrel** (`estimation/index.ts`) — add new exports
4. **Write route test file** (`f023.estimate.route.test.ts`) — mock `runEstimationCascade` via `vi.mock('../estimation/engineRouter.js', ...)`; tests fail (red phase)
5. **Refactor route** (`routes/estimate.ts`) — replace cascade with `runEstimationCascade()` call; route tests turn green
6. **Update `api-spec.yaml`** — update description text

### Testing Strategy

**Test file 1: `packages/api/src/__tests__/f023.engineRouter.unit.test.ts`**

Mocks (via `vi.mock` + `vi.hoisted`):
- `../estimation/level1Lookup.js` → `mockLevel1Lookup`
- `../estimation/level2Lookup.js` → `mockLevel2Lookup`
- `../estimation/level3Lookup.js` → `mockLevel3Lookup`

Scenarios:
- L1 hit: `level1Lookup` returns a `Level1Result`; `level2Lookup` and `level3Lookup` not called; result has `level1Hit: true`, `levelHit: 1`
- L2 hit: `level1Lookup` returns `null`, `level2Lookup` returns a `Level2Result`; `level3Lookup` not called; `level2Hit: true`, `levelHit: 2`
- L3 hit: `level1Lookup` and `level2Lookup` return `null`, `level3Lookup` returns a `Level3Result`; `level3Hit: true`, `levelHit: 3`
- Total miss: all three return `null`; `level1Hit/level2Hit/level3Hit: false`, `result: null`, `levelHit: null`
- DB error from L1: `level1Lookup` throws `{ code: 'DB_UNAVAILABLE' }`; router re-throws with `statusCode: 500`
- DB error from L2: same pattern; L1 returns `null`, L2 throws
- DB error from L3: same pattern; L1 and L2 return `null`, L3 throws
- L4 hit (mock injection): pass `level4Lookup` option returning a mock result; `levelHit: 4`, all `level1Hit/level2Hit/level3Hit: false`
- `level4Lookup` undefined: cascade stops after L3 (total miss still returns `levelHit: null`)
- `level4Lookup` throws: router wraps in `{ statusCode: 500, code: 'DB_UNAVAILABLE' }`
- `openAiApiKey` undefined: passed through to `level3Lookup` as-is (L3 handles the skip internally)

**Test file 2: `packages/api/src/__tests__/f023.estimate.route.test.ts`**

Mocks (via `vi.mock` + `vi.hoisted`):
- `../estimation/engineRouter.js` → `mockRunEstimationCascade`
- `../lib/redis.js` → `mockRedisGet`, `mockRedisSet` (same pattern as F022 route tests)
- `../lib/prisma.js` → `{} as PrismaClient`
- `../lib/kysely.js` → `{ getKysely: () => mockKyselyDb, destroyKysely: vi.fn() }`

Scenarios:
- Cache hit: `mockRedisGet` returns a cached `EstimateData`; `mockRunEstimationCascade` not called; response parsed with `EstimateResponseSchema`
- Router returns L1 hit: `mockRunEstimationCascade` returns `{ data: {..., level1Hit: true}, levelHit: 1 }`; response echoes `data` field unchanged
- Router returns L3 hit: `data` has `level3Hit: true`, `matchType: 'similarity_dish'`; `levelHit: 3` not exposed in response
- Router returns total miss: `data.result: null`, `data.matchType: null`, all hit flags false; HTTP 200
- Router throws `DB_UNAVAILABLE`: HTTP 500, error body contains `code: 'DB_UNAVAILABLE'`
- Backward compatibility: response validates against `EstimateResponseSchema` for every case (no new fields added)
- `levelHit` from router result is NOT present in the HTTP response body

### Key Patterns

**Mock pattern for module function (vi.hoisted + vi.mock):**
Follow exactly the pattern from `f022.estimate.route.test.ts` lines 20-92. `vi.hoisted` extracts the mock fn, `vi.mock` wires it, import of the module under test comes after all `vi.mock` calls.

**Error wrapping pattern:**
The route currently wraps L1/L2/L3 errors with `{ statusCode: 500, code: 'DB_UNAVAILABLE', cause: err }`. In `engineRouter.ts`, the individual lookups already throw with `code: 'DB_UNAVAILABLE'` internally — the router must add `statusCode: 500` on re-throw so Fastify's error handler sets the correct HTTP status. Replicate this same shape for L4 errors.

**`EngineRouterResult` vs `EstimateData` distinction:**
`EngineRouterResult` is internal to the estimation module. `levelHit` is for debug logging only and must not be serialised into the HTTP response. The route reads `result.data` and passes it directly to `reply.send({ success: true, data: result.data })`.

**`Level4LookupFn` signature:**
Model it after the existing lookup signatures: `(db: Kysely<DB>, query: string, options: { chainSlug?: string; restaurantId?: string; openAiApiKey?: string }) => Promise<{ matchType: EstimateMatchType; result: EstimateResult } | null>`. This is a placeholder type — F024 will implement it; F023 only defines the type and plumbs it through.

**Query normalization (clarified after plan review):**
Three layers normalize, each serving a different purpose:
1. **Route**: normalizes for cache key (`normalizedQuery` for `buildKey`). This stays in the route.
2. **Router**: `runEstimationCascade` receives `opts.query` (raw, post-Zod-trim) and normalizes internally (`query.replace(/\s+/g, ' ').toLowerCase()`) before passing to each lookup. Sets `data.query = opts.query` (un-normalized) for response echo.
3. **Lookups**: each has its own `normalizeQuery()` internally — redundant no-op since the router already normalizes, but harmless and avoids coupling.
The route passes `query` (raw) to the router, NOT `normalizedQuery`. The route only uses `normalizedQuery` for the cache key.

**Route line-count target:**
After refactor, the route handler body (inside `async (request, reply) => {`) should be ≤ 35 lines: query destructure, normalise, cache key, cache get, `runEstimationCascade`, cache set, reply.

**Barrel export style:**
Match the existing barrel in `estimation/index.ts`: named function export `export { runEstimationCascade } from './engineRouter.js'`; type exports via `export type { EngineRouterOptions, EngineRouterResult, Level4LookupFn } from './engineRouter.js'`.

**Route import for `runEstimationCascade`:**
The refactored route must import `runEstimationCascade` from `../estimation/engineRouter.js` (direct module, NOT barrel). This ensures the F023 route test can mock it precisely via `vi.mock('../estimation/engineRouter.js', ...)`. If imported from the barrel, the mock path would need to change.

### Critical Notes (from plan review)

**1. Existing F020/F021/F022 route tests survive the refactor — here's why:**
These tests mock `level1Lookup`, `level2Lookup`, `level3Lookup` via `vi.mock('../estimation/levelXLookup.js')`. After the refactor, the route no longer imports these directly — `engineRouter.ts` does. However, `vi.mock` intercepts at the **module resolution level globally**: when `engineRouter.ts` imports `level1Lookup`, the mock applies. Therefore, existing tests continue working without modification. **Do NOT change the import paths in existing test files.**

**2. L4 mock test uses existing `matchType`:**
The "L4 hit" unit test is a **plumbing test only**. The mock `level4Lookup` returns `{ matchType: 'exact_dish', result: <mockEstimateResult> }` — using an existing match type because `'llm_estimation'` does not exist until F024. The test validates cascade flow (`levelHit: 4`, correct `data` shape), not L4 semantics.

**3. L4 hit produces inconsistent `EstimateData` — by design:**
When L4 hits, the returned `EstimateData` has `level1Hit: false, level2Hit: false, level3Hit: false` but `result: non-null`. There is no `level4Hit` field yet. This inconsistency is acceptable because:
- Nobody passes `level4Lookup` in production until F024
- F024 will add `level4Hit: z.boolean()` to `EstimateDataSchema` (same pattern as F022 adding `level3Hit`)
- F023's L4 tests validate internal plumbing, not the API contract

**4. `config` import stays in route:**
The route continues to import `config` to read `OPENAI_API_KEY` and pass it as `openAiApiKey` in `EngineRouterOptions`. The router does NOT import `config` — it receives the key via options (dependency injection).

---

## Acceptance Criteria

- [x] `runEstimationCascade()` exported from `packages/api/src/estimation/engineRouter.ts`
- [x] Function accepts `EngineRouterOptions` (db, query, chainSlug, restaurantId, openAiApiKey, level4Lookup?)
- [x] Function returns `EngineRouterResult` with `data: EstimateData` and `levelHit: 1|2|3|4|null`
- [x] `GET /estimate` route delegates to `runEstimationCascade()` — route handler body ~25 lines
- [x] Existing response shape is 100% backward-compatible (no field changes)
- [x] `level4Lookup` optional parameter enables F024 extension without modifying router
- [x] Unit tests for `runEstimationCascade()` cover: L1 hit, L2 hit, L3 hit, total miss, DB error, L4 hit (mock) — 14 tests
- [x] All existing F020/F021/F022 route tests pass without modification — 38 tests
- [x] Barrel export updated (`packages/api/src/estimation/index.ts`)
- [x] Unit tests for new functionality — 57 tests (14 unit + 8 route + 35 QA edge-case)
- [x] All tests pass — 95/95
- [x] Build succeeds (4 pre-existing TS errors in batch-ingest scripts only)
- [x] Specs updated (`api-spec.yaml`)

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing
- [x] E2E tests updated (if applicable) — N/A
- [x] Code follows project standards
- [x] No linting errors (pre-existing legacy errors only)
- [x] Build succeeds (pre-existing batch-ingest TS errors only)
- [x] Specs reflect final implementation

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` executed, plan approved
- [x] Step 3: `backend-developer` executed with TDD
- [x] Step 4: `production-code-validator` executed, quality gates pass
- [x] Step 5: `code-review-specialist` executed — APPROVED, 1 IMPORTANT fixed (.trim())
- [x] Step 5: `qa-engineer` executed — VERIFIED, 35 edge-case tests added, 0 bugs
- [x] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-19 | Step 0: Spec created | spec-creator agent, api-spec.yaml updated |
| 2026-03-19 | Step 1: Setup | Branch + ticket + tracker |
| 2026-03-19 | Step 2: Plan | backend-planner + plan review (4 critical notes added) |
| 2026-03-19 | Step 3: Implement | TDD: 14 unit + 8 route tests, engineRouter.ts, route refactor |
| 2026-03-19 | Step 4: Finalize | production-code-validator: 0 issues, 60/60 tests |
| 2026-03-19 | Step 5: Code review | APPROVED — 1 IMPORTANT (.trim() in cache key), 3 SUGGESTIONS |
| 2026-03-19 | Step 5: QA | VERIFIED — 35 edge-case tests, 0 bugs, 95/95 total |
| 2026-03-19 | Step 6: Complete | Squash merge to develop (93e563d), branch deleted, tracker updated |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Plan, AC, DoD, Workflow, Log, Evidence |
| 1. Mark all items | [x] | AC: 13/13, DoD: 7/7, Workflow: 0-5/6 |
| 2. Verify product tracker | [x] | Active Session: step 5/6 (Review), Features table: 5/6 |
| 3. Update key_facts.md | [x] | Updated: estimation module (engineRouter.ts), estimate route (runEstimationCascade delegation) |
| 4. Update decisions.md | [x] | N/A — no new ADR needed |
| 5. Commit documentation | [x] | Commit: (pending — this commit) |
| 6. Verify clean working tree | [x] | `git status`: clean after docs commit |

---

*Ticket created: 2026-03-19*
