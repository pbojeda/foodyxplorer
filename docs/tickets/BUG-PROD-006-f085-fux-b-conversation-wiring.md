# BUG-PROD-006: F085 + F-UX-B NOT populated via /conversation/message

**Feature:** BUG-PROD-006 | **Type:** Backend-Bugfix | **Priority:** M1 (Production Blocker)
**Status:** Spec | **Branch:** bug/BUG-PROD-006-f085-fux-b-conversation-wiring
**Created:** 2026-04-13 | **Dependencies:** F085 (done), F-UX-B (merged but broken e2e)

---

## Spec

### Description

**Summary:** F085 (`portionSizing`) and F-UX-B (`portionAssumption`) are both `null` for all canonical
Spanish portion terms (tapa, pincho, pintxo, ración, media ración) when queried via
`POST /conversation/message` → `/hablar` web + bot Telegram. F-UX-B was merged as done (PR #113)
but is effectively non-functional on the primary user path.

**Pre-existing latent bug:** F085 has the same defect. F-UX-B built on top of F085's broken wiring
and surfaced it. Neither was caught by tests because every existing test bypasses the full flow (see
"Test coverage gap" below).

**Empirical ground truth (7 queries via POST /conversation/message, local Docker dev DB):**

| Query | Stripped query (post F078) | Matched dish | `portionMultiplier` | `portionSizing` | `portionAssumption` |
|---|---|---|---|---|---|
| `tapa de croquetas` | `croquetas` | ✓ Croquetas de jamón | 1 | **null** ❌ | **null** ❌ |
| `TAPA DE CROQUETAS` | `croquetas` | ✓ Croquetas de jamón | 1 | **null** ❌ | **null** ❌ |
| `Tapa De Croquetas` | `croquetas` | ✓ Croquetas de jamón | 1 | **null** ❌ | **null** ❌ |
| `  tapa   de   croquetas  ` | `croquetas` | ✓ Croquetas de jamón | 1 | **null** ❌ | **null** ❌ |
| `tapa croquetas` (no 'de') | `tapa croquetas` (not stripped) | ❌ no match | 1 | ✓ `tapa` | **null** ❌ |
| `croquetas tapa` (reversed) | `croquetas tapa` | ❌ no match | 1 | ✓ `tapa` | **null** ❌ |
| `ración grande de croquetas` | `croquetas` | — | 1.5 | **null** ❌ | **null** ❌ |

Also confirmed: `bocadillo de jamón` → `portionSizing.term === 'bocadillo'` ✓ (F085 works when F078 does NOT strip the term, confirming F085 logic is correct).

### Root Cause — TWO bugs

#### Bug 1 — PRIMARY (more fundamental, previously undocumented)

**`prisma` is never passed to `processMessage()` from the conversation route.**

- `packages/api/src/conversation/types.ts:60-78` — `ConversationRequest` has NO `prisma` field
- `packages/api/src/routes/conversation.ts:46` — route has `prisma` from plugin opts
- `packages/api/src/routes/conversation.ts:111-123` — calls `processMessage({..., db, redis, ...})` WITHOUT `prisma`
- `packages/api/src/conversation/estimationOrchestrator.ts:151` — `if (prisma !== undefined)` is always `false` from this path

Result: `resolvePortionAssumption` **never executes** from `/conversation/message`. `portionAssumption` is always `undefined`.

This is the primary reason F-UX-B is non-functional. Even if query stripping were fixed, portionAssumption would still be null without this fix.

#### Bug 2 — SECONDARY (the original hypothesis, confirmed)

**Both F085 and F-UX-B detection run on the F078-stripped query.**

In `conversationCore.ts:345-346`:
```typescript
const { cleanQuery, portionMultiplier } = extractPortionModifier(trimmed);
const { query: extractedQuery, chainSlug: explicitSlug } = extractFoodQuery(cleanQuery);
```

In `conversationCore.ts:351-360`:
```typescript
const estimationResult = await estimate({
  query: extractedQuery,   // ← 'croquetas' (F078 stripped 'tapa de')
  // ...no originalQuery, no prisma
});
```

In `estimationOrchestrator.ts:145,152`:
```typescript
...enrichWithPortionSizing(query),        // ← 'croquetas' → no match → portionSizing: null
const detectedTerm = detectPortionTerm(query);  // ← 'croquetas' → null
```

Result: F085 `portionSizing` is always `null` for F078-covered terms (tapa, pincho, pintxo, ración, media ración) via the conversation path.

#### Why Bug 1 was not in the original analysis

The previous session's analysis focused on the query-stripping issue but missed that `prisma` was
never threaded through `ConversationRequest`. The test scripts confirmed `portionAssumption: null`
but didn't distinguish "orchestrator skipped entirely" from "orchestrator ran but returned null".

#### Why F-UX-A works but F085+F-UX-B don't

F-UX-A's `portionMultiplier` is captured by `extractPortionModifier` as a **numeric value** before
the cascade runs. The orchestrator receives it as an explicit param — the string that contained it
doesn't need to survive. F085 and F-UX-B both need the **string term** to survive into the
orchestrator for re-detection.

#### F042 interaction — `trimmed` is the correct `originalQuery`

F042 (`extractPortionModifier`) strips compound patterns including `media ración` as a unit:
- `'media ración de croquetas'` → F042 matches `/\bmedias?\s+raci[oó]n\b/i` (line 136) → `cleanQuery = 'de croquetas'`, `portionMultiplier = 0.5`

This means `cleanQuery` for `'media ración de croquetas'` is `'de croquetas'`, not `'ración de croquetas'`.
If `originalQuery = cleanQuery`, `detectPortionTerm('de croquetas')` returns `null` — F-UX-B Tier 2
would never trigger. **`originalQuery` MUST be `trimmed` (pre-F042 and pre-F078).**

#### Cache key correctness

Current cache key: `normalizedQuery:chainSlug:restaurantId:multiplier` (from stripped query).
Two requests with different `originalQuery` but same stripped `query` (e.g., `'croquetas'` and
`'tapa de croquetas'` both strip to `'croquetas'`) would share a cache hit — the cached response
from `'croquetas'` (portionSizing=null) would be returned for `'tapa de croquetas'` (should have
portionSizing=tapa). **Cache key MUST include the normalized `originalQuery`.**

### Edge Cases & Error Handling

1. **Cache key invariance:** Include `normalizedPortionQuery` in cache key only when different from
   `normalizedQuery`. Avoids sharing hits between `'tapa de croquetas'` (portionSizing=tapa) and
   `'croquetas'` (portionSizing=null).

   Implementation: `portionKeySuffix = normalizedPortionQuery !== normalizedQuery ? ':${normalizedPortionQuery}' : ''`

2. **`/estimate` GET route backward compat:** `routes/estimate.ts` passes query directly (no F078
   stripping). `originalQuery` is not needed there — the `originalQuery ?? query` fallback preserves
   current behavior exactly. No change to `estimate.ts` route required.

3. **F042 × F-UX-B composition — `ración grande de croquetas`:**
   - `trimmed` = `'ración grande de croquetas'`
   - F042 strips `grande` (pattern `/\bgrandes?\b/i`; `media ración` pattern has priority but doesn't match)
   - `cleanQuery` = `'ración de croquetas'`, `portionMultiplier` = 1.5
   - F078 strips `ración de` → `extractedQuery` = `'croquetas'`
   - `originalQuery = trimmed` = `'ración grande de croquetas'`
   - `detectPortionTerm('ración grande de croquetas')` → detects `'ración'` (word boundary match ✓)
   - Tier 1: row for `(dishId, 'racion')` with grams=200, pieces=8 → scaled by 1.5 → grams=300, pieces=12 ✓

4. **F042 × F-UX-B composition — `media ración grande de croquetas`:**
   - `trimmed` = `'media ración grande de croquetas'`
   - F042 matches `media ración` compound pattern (has higher priority than `grande`) → `cleanQuery` = `'grande de croquetas'`, `portionMultiplier` = 0.5
   - F078 doesn't strip `grande de` → `extractedQuery` = `'grande de croquetas'` (cascade finds via FTS)
   - `originalQuery = trimmed`
   - `detectPortionTerm('media ración grande de croquetas')` → detects `'media ración'` (compound match at position 0 ✓)
   - `normalizeToCanonicalTerm('media ración')` → `'media_racion'` → Tier 2 runs with 0.5 × multiplier ✓

5. **Case insensitivity:** `detectPortionTerm` lowercases before matching. `TAPA DE CROQUETAS` → `trimmed` = `'TAPA DE CROQUETAS'` → `originalQuery` = `'TAPA DE CROQUETAS'` → lowercase match for `'tapa'` ✓.

6. **Query logging:** `writeQueryLog` records `est.query` (the stripped query from EstimateData). No change — the `query` field on `EstimateData` is the stripped form, unchanged. `originalQuery` never reaches `EstimateData`.

7. **Double-stripping regression (GET /estimate callers):** `originalQuery` defaults to `query`. `normalizedPortionQuery === normalizedQuery` → no suffix in cache key. Behavior unchanged.

8. **`prisma` optional in `ConversationRequest`:** `prisma?: PrismaClient` (optional). Allows test helpers that create a `ConversationRequest` without Prisma to continue working. When `prisma` is absent, the `if (prisma !== undefined)` guard in the orchestrator gracefully skips Tier 1/2/3 resolution, as before.

### Test Coverage Gap (structural — must close in this fix)

**Existing tests that don't catch this bug:**

1. `f-ux-b.estimateRoute.portionAssumption.integration.test.ts` — calls `resolvePortionAssumption(prisma, DISH_ID, detectPortionTerm('tapa de croquetas'), ...)` directly. Bypasses `conversationCore → extractFoodQuery → estimate`. All 9 tests pass; real flow is broken.
2. `f-ux-b.portionAssumption.unit.test.ts` — same pattern with hardcoded inputs.
3. `f085.portion-sizing.formatter.test.ts` — mocks `portionSizing` in fixture. Does not hit orchestrator.
4. `NutritionCard.f-ux-b.test.tsx` — component tests with mocked data.
5. `f-ux-b.generic-byte-identity.test.ts` — snapshot test, fixtures omit real flow.

**Zero tests exercise the full `processMessage → extractFoodQuery → estimate → enrichWithPortionSizing → detectPortionTerm → resolvePortionAssumption` chain.**

**New tests to add:**

- `packages/api/src/__tests__/f-ux-b.conversationCore.integration.test.ts` — calls `processMessage()` through the full stack (real Prisma + test DB), verifies `portionAssumption` on the response. Covers:
  - `tapa de croquetas` → Tier 1 (per_dish, tapa, 50g, 2 pieces)
  - `ración de croquetas` → Tier 1 (per_dish, racion, 200g, 8 pieces)
  - `media ración de croquetas` → Tier 2 (per_dish, media_racion, 100g, 4 pieces)
  - `ración grande de croquetas` → F042 × Tier 1 (multiplier=1.5, 300g, 12 pieces)
  - `media ración grande de croquetas` → F042 × Tier 2 (multiplier=0.5, media_racion, 100g, 4 pieces — F042 captures the 0.5 separately)
  - `tapa de unseeded_dish` → Tier 3 generic (source='generic', gramsRange=[50,80])
  - `bocadillo de jamón` → portionAssumption=null (out of F-UX-B scope), portionSizing.term='bocadillo' (F085 works)
  - `croquetas` (no term) → portionAssumption=null, portionSizing=null
  - `TAPA DE CROQUETAS` (uppercase) → same as lowercase Tier 1 result
  - `media ración de gazpacho` (dish with only racion row) → Tier 2 arithmetic: grams=150 (300*0.5), pieces=null
  - `tapa de gazpacho` (has only racion row, not tapa) → Tier 3 (tier2_rejected_tapa)

- `packages/api/src/__tests__/f085.conversationCore.integration.test.ts` — same full-flow pattern but asserting on `portionSizing`:
  - `tapa de croquetas` → portionSizing={term:'tapa', gramsMin:50, gramsMax:80}
  - `bocadillo de jamón` → portionSizing={term:'bocadillo', ...}
  - `ración para compartir de croquetas` → portionSizing={term:'ración para compartir', ...}
  - Case-insensitive variants
  - No portion term → portionSizing=null

**ADR-021 candidate:** "Integration tests MUST exercise the full conversation flow, not just the orchestrator in isolation." See ADR-021 in `decisions.md` (to be written in Step 3).

### Files to Change

**Production code (4 files, ~30 lines):**
1. `packages/api/src/conversation/types.ts` — add `prisma?: PrismaClient` to `ConversationRequest`
2. `packages/api/src/routes/conversation.ts` — pass `prisma` in both `processMessage()` calls
3. `packages/api/src/conversation/conversationCore.ts` — destructure `prisma`, pass `prisma` + `originalQuery: trimmed` to `estimate()`
4. `packages/api/src/conversation/estimationOrchestrator.ts` — add `originalQuery?: string` to `EstimateParams`, compute `portionDetectionQuery`, update cache key, use `portionDetectionQuery` in F085/F-UX-B calls

**New test files (2):**
5. `packages/api/src/__tests__/f-ux-b.conversationCore.integration.test.ts` (NEW)
6. `packages/api/src/__tests__/f085.conversationCore.integration.test.ts` (NEW)

**Documentation (4 files):**
7. `docs/project_notes/decisions.md` — ADR-021
8. `docs/project_notes/bugs.md` — BUG-PROD-006 entry
9. `docs/project_notes/key_facts.md` — F-UX-B section: note the wiring fix + integration test naming convention
10. `docs/tickets/F-UX-B-spanish-portion-terms.md` — postscript noting BUG-PROD-006 follow-up

---

## Implementation Plan

### Existing Code to Reuse

**Entities / types (no changes):**
- `PortionSizing`, `PortionAssumption`, `EstimateData` — from `packages/shared/src/schemas/estimate.ts` (already exported; do not touch)
- `resolvePortionAssumption` — `packages/api/src/estimation/portionAssumption.ts` (resolver logic is correct; caller is broken)
- `detectPortionTerm`, `enrichWithPortionSizing` — `packages/api/src/estimation/portionSizing.ts` (detection logic is correct; called with wrong input)
- `extractPortionModifier`, `extractFoodQuery` — `packages/api/src/conversation/entityExtractor.ts` (correct; will now pass `trimmed` as `originalQuery`)
- `buildKey`, `cacheGet`, `cacheSet` — `packages/api/src/lib/cache.ts` (reused; cache key construction extended in orchestrator)

**Test infrastructure to clone:**
- Fixture pattern: `packages/api/src/__tests__/f-ux-b.estimateRoute.portionAssumption.integration.test.ts`
  - `DATABASE_URL_TEST` env var → `PrismaClient({ datasources: { db: { url: DATABASE_URL_TEST } } })`
  - `cleanFixtures()` called in `beforeAll` (pre-clean) and `afterAll` (teardown)
  - Teardown order: `standardPortion → dishNutrient → dish → restaurant → dataSource`
  - Fixture UUID format: `{prefix}-{seq}-4000-a000-{id}`
- Kysely pool pattern (for `processMessage`): `packages/api/src/__tests__/f038.estimate-l1.integration.test.ts`
  - `new Pool({ connectionString: DATABASE_URL_TEST })` + `new Kysely<DB>({ dialect: new PostgresDialect({ pool }) })`
  - Teardown: `await prisma.$disconnect()` then `await db.destroy()`
- `vi.mock` pattern for `contextManager.js`: `packages/api/src/__tests__/f070.conversationCore.unit.test.ts` lines 17-25
- `vi.mock` pattern for `lib/cache.js`: `packages/api/src/__tests__/f070.estimationOrchestrator.unit.test.ts` lines 30-38
- Logger stub pattern: `f086.conversation-core.unit.test.ts` lines 45-50

---

### Files to Create

1. `packages/api/src/__tests__/f-ux-b.conversationCore.integration.test.ts`
   - NEW — integration test calling `processMessage()` end-to-end (real Prisma + Kysely on test DB)
   - Verifies `portionAssumption` field on `estimation` results
   - UUID prefix: `fd000000-00fd-...` (avoids collision with the existing `fb000000-0001-...` prefix)
   - Committed RED (failing) in Commit 1

2. `packages/api/src/__tests__/f085.conversationCore.integration.test.ts`
   - NEW — integration test calling `processMessage()` end-to-end (same real DB fixtures)
   - Verifies `portionSizing` field on `estimation` results
   - UUID prefix: `fc000000-00fc-...`
   - Committed RED (failing) in Commit 2

---

### Files to Modify

**Production code (4 files, ~30 lines total):**

1. `packages/api/src/conversation/types.ts`
   - Add import: `import type { PrismaClient } from '@prisma/client';`
   - Add field to `ConversationRequest`: `/** F-UX-B: Prisma client for per-dish portion lookup (optional). */ prisma?: PrismaClient;`

2. `packages/api/src/routes/conversation.ts`
   - Lines 111-123: add `prisma` to the `processMessage({...})` call in `/conversation/message` handler
   - Lines 417-429: add `prisma` to the `processMessage({...})` call in `/conversation/audio` handler
   - No other changes — `prisma` is already destructured from `opts` at line 46

3. `packages/api/src/conversation/conversationCore.ts`
   - Destructure `prisma` from `req` in the `const { text, actorId, db, redis, ... } = req;` block (lines 48-60)
   - In Step 4 (single-dish estimation, lines 351-360): add `prisma` and `originalQuery: trimmed` to the `estimate({...})` call
   - Add `logger.warn` when `prisma` is absent at the call site (observability for misconfigured callers):
     ```
     if (prisma === undefined) {
       logger.warn({}, 'BUG-PROD-006: prisma not in ConversationRequest — portionAssumption will be skipped');
     }
     ```
   - The `trimmed` variable is already computed at line 91 — no new computation needed

4. `packages/api/src/conversation/estimationOrchestrator.ts`
   - Add `originalQuery?: string` to `EstimateParams` interface (after `portionMultiplier?`)
   - Destructure `originalQuery` in the `const { query, ..., prisma, ... } = params;` block
   - After computing `normalizedQuery`, compute:
     ```typescript
     const portionDetectionQuery = originalQuery ?? query;
     const normalizedPortionQuery = portionDetectionQuery.replace(/\s+/g, ' ').trim().toLowerCase();
     const portionKeySuffix = normalizedPortionQuery !== normalizedQuery
       ? `:${normalizedPortionQuery}`
       : '';
     ```
   - Update cache key to:
     ```typescript
     const cacheKey = buildKey(
       'estimate',
       `${normalizedQuery}:${chainSlug ?? ''}:${restaurantId ?? ''}:${effectiveMultiplier}${portionKeySuffix}`,
     );
     ```
   - Replace `...enrichWithPortionSizing(query)` (line 145) with `...enrichWithPortionSizing(portionDetectionQuery)`
   - Replace `detectPortionTerm(query)` (line 152) with `detectPortionTerm(portionDetectionQuery)`
   - Replace the `originalQuery` argument in `resolvePortionAssumption(...)` (line 159) with `portionDetectionQuery`

**Documentation (4 files):**

5. `docs/project_notes/decisions.md`
   - Add ADR-021 entry (written in Commit 4)

6. `docs/project_notes/bugs.md`
   - Add BUG-PROD-006 entry (written in Commit 4)

7. `docs/project_notes/key_facts.md`
   - Update F-UX-B section: note that `prisma` must be threaded through `ConversationRequest` and that end-to-end integration tests must call `processMessage()` not just `resolvePortionAssumption()` directly (written in Commit 4)

8. `docs/tickets/F-UX-B-spanish-portion-terms.md`
   - Add postscript referencing BUG-PROD-006 as follow-up that fixed the broken wiring (written in Commit 4)

---

### Implementation Order

Follow the TDD commit order. All commits go to branch `bug/BUG-PROD-006-f085-fux-b-conversation-wiring`.

#### Commit 1 — RED: `f-ux-b.conversationCore.integration.test.ts`

Write the new integration test file. It MUST fail at this point (Bug 1 and Bug 2 are not yet fixed).

**File:** `packages/api/src/__tests__/f-ux-b.conversationCore.integration.test.ts`

Structure:

```
// Module-level mocks (hoisted, before all imports):
//   vi.mock('../conversation/contextManager.js') → getContext returns null, setContext no-ops
//   vi.mock('../lib/cache.js') → buildKey passthrough, cacheGet returns null, cacheSet no-ops
//
// These two mocks isolate the test from Redis (no real Redis needed in the integration path).
// cache.ts imports redis.ts as a module-level singleton; mocking lib/cache.js prevents
// the real Redis singleton from being invoked. contextManager.js takes redis as a parameter
// but is mocked at the module level for the same reason.

// Fixtures (UUID prefix fd000000-00fd-4000-a000-{id}):
//   SRC_ID    fd000000-00fd-4000-a000-000000000001
//   REST_ID   fd000000-00fd-4000-a000-000000000002
//   DISH_ID   fd000000-00fd-4000-a000-000000000003  ← croquetas dish (seeded standard_portions)
//   DISH_NO_PORTIONS_ID  fd000000-00fd-4000-a000-000000000004  ← no standard_portions
//   DN_ID     fd000000-00fd-4000-a000-000000000005
//   DN_NO_PORTIONS_ID    fd000000-00fd-4000-a000-000000000006
//   ACTOR_ID  fd000000-00fd-4000-a000-000000000099
```

Seed data in `beforeAll` (same as existing f-ux-b fixture, reuse exact shape):
- `dataSource`: `{ id: SRC_ID, name: 'FD-ConvCore-Test-Src', type: 'official' }`
- `restaurant`: `{ id: REST_ID, name: 'FD ConvCore Test Restaurant', chainSlug: 'fd-conv-core-test' }`
- `dish` (DISH_ID): `{ name: 'Croquetas FD Test', nameEs: 'Croquetas de jamón', ... }` — name_es must match what level1Lookup FTS will find for query 'croquetas'
- `dishNutrient` (DN_ID): standard nutrient shape, `referenceBasis: 'per_serving'`
- `dish` (DISH_NO_PORTIONS_ID): `{ name: 'Unseeded FD Test', nameEs: 'Plato sin porciones', ... }`
- `dishNutrient` (DN_NO_PORTIONS_ID): same shape
- `standardPortion` for DISH_ID, term `'tapa'`: `{ grams: 50, pieces: 2, pieceName: 'croquetas', confidence: 'high' }`
- `standardPortion` for DISH_ID, term `'racion'`: `{ grams: 200, pieces: 8, pieceName: 'croquetas', confidence: 'high' }`

Helper `buildRequest(text: string): ConversationRequest`:
```typescript
{
  text,
  actorId: ACTOR_ID,
  db,               // real Kysely DB (test DB)
  redis: {} as Redis,  // cast — getContext is mocked, redis object never used
  prisma,           // real PrismaClient (test DB) — omitted BEFORE Commit 3 fix to show RED
  chainSlugs: ['fd-conv-core-test'],
  chains: [{ chainSlug: 'fd-conv-core-test', name: 'FD ConvCore Test Restaurant', nameEs: null }],
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}
```

IMPORTANT — how to make tests RED before the fix: In Commit 1, `prisma` is NOT yet in `ConversationRequest` (types.ts is not yet patched). Therefore the `buildRequest` function in Commit 1 MUST NOT include `prisma` in the object — TypeScript would reject it, and more importantly the orchestrator would never receive it. This correctly produces the RED state: `portionAssumption` will always be `undefined`/`null` on the response.

Test cases for `f-ux-b.conversationCore.integration.test.ts` (all expect `intent: 'estimation'`; all should FAIL in Commit 1 and PASS after Commit 3):

| Test name | Input text | Expected `portionAssumption` |
|-----------|-----------|------------------------------|
| Tier 1 tapa | `'tapa de croquetas'` | `{ source: 'per_dish', term: 'tapa', termDisplay: 'tapa', grams: 50, pieces: 2, pieceName: 'croquetas', gramsRange: null, fallbackReason: null, confidence: 'high' }` |
| Tier 1 ración | `'ración de croquetas'` | `{ source: 'per_dish', term: 'racion', termDisplay: 'ración', grams: 200, pieces: 8 }` |
| Tier 2 media ración | `'media ración de croquetas'` | `{ source: 'per_dish', term: 'media_racion', termDisplay: 'media ración', grams: 100, pieces: 4, fallbackReason: null }` |
| F042 × Tier 1 ración grande | `'ración grande de croquetas'` | `{ source: 'per_dish', term: 'racion', grams: 300, pieces: 12 }` (multiplier=1.5) |
| Tier 3 unseeded dish | `'tapa de plato sin porciones'` | `{ source: 'generic', term: 'tapa', gramsRange: [50,80], grams: 65, fallbackReason: 'no_row' }` |
| Out of scope (bocadillo) | `'bocadillo de jamón'` | `null` / absent (portionAssumption not set — bocadillo is not in F-UX-B scope) |
| No portion term | `'croquetas'` | `null` / absent |
| Case insensitive | `'TAPA DE CROQUETAS'` | Same as Tier 1 tapa: `{ source: 'per_dish', term: 'tapa', grams: 50, pieces: 2 }` |

Note on "Tier 3 unseeded dish": The query `'tapa de plato sin porciones'` is likely to miss the dish unless FTS matches `nameEs: 'Plato sin porciones'`. The important behavior is: if the cascade returns `result: null` (no dish match), `dishId` is null, and `resolvePortionAssumption` returns `{}` — meaning `portionAssumption` is absent. Adjust the test to assert `portionAssumption` is undefined. If you want to test Tier 3, you need a query that matches the unseeded dish. Given the complexity, this can be tested via `portionAssumption` being absent OR by using a query known to match the unseeded dish (e.g., seeding a specific alias). The simplest approach: skip the Tier-3-from-processMessage test in this file (it's already covered in `f-ux-b.estimateRoute.portionAssumption.integration.test.ts`) and focus on the cases that demonstrate the wiring fix.

Revised minimal test matrix:
- `'tapa de croquetas'` → `portionAssumption.source = 'per_dish'`, `term = 'tapa'`, `grams = 50` ← primary regression test
- `'ración de croquetas'` → `portionAssumption.source = 'per_dish'`, `grams = 200`
- `'media ración de croquetas'` → `portionAssumption.source = 'per_dish'`, `term = 'media_racion'`, `grams = 100`
- `'ración grande de croquetas'` → `portionAssumption.source = 'per_dish'`, `grams = 300` (F042×Tier1)
- `'bocadillo de jamón'` → `portionAssumption` absent/null
- `'croquetas'` → `portionAssumption` absent/null
- `'TAPA DE CROQUETAS'` → same as lowercase tapa (case insensitivity end-to-end)

#### Commit 2 — RED: `f085.conversationCore.integration.test.ts`

Write the second integration test file. It MUST fail before Commit 3 (Bug 2 not yet fixed).

**File:** `packages/api/src/__tests__/f085.conversationCore.integration.test.ts`

UUID prefix `fc000000-00fc-4000-a000-{id}` — completely independent fixture set.

Seed data: same shape as Commit 1 fixtures (dataSource + restaurant + dish with `nameEs: 'Croquetas de jamón'` + dishNutrient). No `standardPortion` rows needed for F085 tests.

The same `vi.mock('../conversation/contextManager.js')` and `vi.mock('../lib/cache.js')` pattern applies.

Test cases (all FAIL before Commit 3 fix for the portion-term cases):

| Test name | Input text | Expected `portionSizing` |
|-----------|-----------|--------------------------|
| F085 tapa (from-conversation) | `'tapa de croquetas'` | `{ term: 'tapa', gramsMin: 50, gramsMax: 80, description: 'Tapa individual estándar' }` |
| F085 bocadillo (not stripped by F078) | `'bocadillo de jamón'` | `{ term: 'bocadillo', gramsMin: 200, gramsMax: 250 }` (should already pass — control test) |
| F085 ración para compartir | `'ración para compartir de croquetas'` | `{ term: 'ración para compartir', gramsMin: 300, gramsMax: 400 }` |
| No portion term | `'croquetas'` | `null` / absent |
| Case insensitive | `'TAPA DE CROQUETAS'` | `{ term: 'tapa', gramsMin: 50, gramsMax: 80 }` |

Note: `'bocadillo de jamón'` should already pass because F078 does NOT strip `bocadillo de` (it only strips `tapa de`, `pincho de`, `pintxo de`, `ración de`). This test acts as a control — it confirms F085 logic is correct when F078 does not strip the term.

The `'tapa de croquetas'` and `'ración para compartir de croquetas'` tests should FAIL in Commit 2 (stripped query → no F085 match) and PASS after Commit 3 (originalQuery passed through).

#### Commit 3 — GREEN: production code fix (all 4 files)

Apply all 4 production code changes in a single commit. Both test suites go GREEN. No regressions.

**Change 1: `packages/api/src/conversation/types.ts`**

Location: After the existing imports block (before line 5). Add:
```typescript
import type { PrismaClient } from '@prisma/client';
```
Location: Inside `ConversationRequest` interface (after `legacyChainName?: string;`). Add:
```typescript
/** F-UX-B / BUG-PROD-006: Prisma client for per-dish portion lookup.
 *  Optional — when absent, portionAssumption resolution is silently skipped. */
prisma?: PrismaClient;
```

**Change 2: `packages/api/src/routes/conversation.ts`**

Location 1 — `/conversation/message` handler, lines 111-123. Add `prisma` field:
```typescript
const data = await processMessage({
  text: body.text,
  actorId,
  db,
  redis,
  prisma,             // ← ADD THIS LINE
  openAiApiKey: config.OPENAI_API_KEY,
  level4Lookup,
  chainSlugs,
  chains,
  logger: request.log,
  legacyChainSlug: body.chainSlug,
  legacyChainName: body.chainName,
});
```

Location 2 — `/conversation/audio` handler, lines 417-429. Add `prisma` field:
```typescript
const data = await processMessage({
  text: transcribedText,
  actorId,
  db,
  redis,
  prisma,             // ← ADD THIS LINE
  openAiApiKey: config.OPENAI_API_KEY,
  level4Lookup,
  chainSlugs,
  chains,
  logger: request.log,
  legacyChainSlug: chainSlug,
  legacyChainName: chainName,
});
```

**Change 3: `packages/api/src/conversation/conversationCore.ts`**

Location 1 — destructure block (lines 48-60). Add `prisma` to the destructured fields:
```typescript
const {
  text,
  actorId,
  db,
  redis,
  prisma,             // ← ADD THIS LINE
  openAiApiKey,
  level4Lookup,
  chainSlugs,
  chains,
  logger,
  legacyChainSlug,
  legacyChainName,
} = req;
```

Location 2 — Step 4, before the `estimate()` call. Add warn guard:
```typescript
if (prisma === undefined) {
  logger.warn({}, 'BUG-PROD-006: prisma absent from ConversationRequest — portionAssumption will not resolve');
}
```

Location 3 — `estimate({...})` call (lines 351-360). Add `prisma` and `originalQuery`:
```typescript
const estimationResult = await estimate({
  query: extractedQuery,
  chainSlug: effectiveChainSlug,
  portionMultiplier,
  db,
  prisma,             // ← ADD THIS LINE
  openAiApiKey,
  level4Lookup,
  chainSlugs,
  logger,
  originalQuery: trimmed,  // ← ADD THIS LINE (pre-F042, pre-F078 text)
});
```

**Change 4: `packages/api/src/conversation/estimationOrchestrator.ts`**

Location 1 — `EstimateParams` interface (lines 30-42). Add `originalQuery?`:
```typescript
export interface EstimateParams {
  query: string;
  chainSlug?: string;
  restaurantId?: string;
  portionMultiplier?: number;
  /** BUG-PROD-006: Pre-F042/F078 query for portion term detection.
   *  When provided, F085 and F-UX-B detection use this instead of the
   *  stripped `query`. Omit for callers without F042/F078 processing
   *  (e.g., GET /estimate route) — falls back to `query`. */
  originalQuery?: string;
  db: Kysely<DB>;
  prisma?: PrismaClient;
  openAiApiKey?: string;
  level4Lookup?: Level4LookupFn;
  chainSlugs: string[];
  logger: Logger;
}
```

Location 2 — destructure block (lines 63-74). Add `originalQuery`:
```typescript
const {
  query,
  chainSlug,
  restaurantId,
  portionMultiplier: rawMultiplier,
  db,
  prisma,
  openAiApiKey,
  level4Lookup,
  chainSlugs,
  logger,
  originalQuery,    // ← ADD THIS LINE
} = params;
```

Location 3 — after `normalizedQuery` computation (lines 79-83). Replace cache key block:
```typescript
const normalizedQuery = query.replace(/\s+/g, ' ').trim().toLowerCase();
const portionDetectionQuery = originalQuery ?? query;
const normalizedPortionQuery = portionDetectionQuery.replace(/\s+/g, ' ').trim().toLowerCase();
// Include normalizedPortionQuery in cache key only when different from normalizedQuery.
// This prevents 'tapa de croquetas' and 'croquetas' from sharing a cache hit.
const portionKeySuffix = normalizedPortionQuery !== normalizedQuery
  ? `:${normalizedPortionQuery}`
  : '';
const cacheKey = buildKey(
  'estimate',
  `${normalizedQuery}:${chainSlug ?? ''}:${restaurantId ?? ''}:${effectiveMultiplier}${portionKeySuffix}`,
);
```

Location 4 — `enrichWithPortionSizing(query)` (line 145). Replace with:
```typescript
...enrichWithPortionSizing(portionDetectionQuery),
```

Location 5 — `detectPortionTerm(query)` (line 152). Replace with:
```typescript
const detectedTerm = detectPortionTerm(portionDetectionQuery);
```

Location 6 — `resolvePortionAssumption(...)` call (line 155-161). The `originalQuery` argument (4th param) becomes `portionDetectionQuery`:
```typescript
const { portionAssumption } = await resolvePortionAssumption(
  prisma,
  dishId,
  detectedTerm,
  portionDetectionQuery,   // ← WAS: query (the stripped form) — NOW: portionDetectionQuery (pre-F042/F078)
  effectiveMultiplier,
  logger as Parameters<typeof resolvePortionAssumption>[5],
);
```

#### Commit 4 — Documentation

Write all 4 documentation files:

**`docs/project_notes/decisions.md` — ADR-021:**

```markdown
### ADR-021: Full-flow integration tests required for conversation pipeline features (2026-04-13)

**Context:** BUG-PROD-006 revealed that F085 (`portionSizing`) and F-UX-B (`portionAssumption`)
were non-functional on the primary user path (`POST /conversation/message`) despite all
unit and component tests passing. Root causes: (1) `prisma` not threaded through
`ConversationRequest`, and (2) F078-stripped query passed to portion detection instead of
the original text. Neither defect was caught because every existing test called
`resolvePortionAssumption` or `enrichWithPortionSizing` directly, bypassing the
`processMessage → extractFoodQuery → estimate` chain entirely.

**Decision:** Any feature that adds enrichment data to `EstimateData` (portionSizing,
portionAssumption, and any future field) MUST include at least one integration test that
calls `processMessage()` end-to-end against the test DB and asserts the field is present
on the response. Unit tests of the enrichment function alone are insufficient.

**Alternatives Considered:** (1) Route-level integration tests (Fastify inject) — rejected:
adds Fastify setup boilerplate; the conversation pipeline's dependencies (db, prisma, redis)
are injected via DI, so calling `processMessage()` directly is equivalent and simpler.
(2) Mocking `estimate()` at the core level — rejected: the bug was in how `processMessage`
called `estimate`, so mocking `estimate` would bypass the exact layer that broke.

**Consequences:** Slower integration test suite (real DB required). Accepted trade-off:
the prior missed bug was a production regression that shipped to all users.
**Test naming convention:** `{feature-id}.conversationCore.integration.test.ts`
```

**`docs/project_notes/bugs.md` — BUG-PROD-006 entry:**

Append the standard bug entry documenting both root causes, the fix, and the testing prevention lesson.

**`docs/project_notes/key_facts.md` — F-UX-B section:**

Add note: "`prisma` must be present in `ConversationRequest` for F-UX-B (portionAssumption) and F085 (portionSizing) to resolve. The wiring was broken (BUG-PROD-006) and fixed 2026-04-13. End-to-end integration tests (`f-ux-b.conversationCore.integration.test.ts`, `f085.conversationCore.integration.test.ts`) call `processMessage()` directly — not `resolvePortionAssumption` alone."

**`docs/tickets/F-UX-B-spanish-portion-terms.md` — postscript:**

Append a brief postscript after the completion section noting that F-UX-B was re-broken immediately post-merge by BUG-PROD-006 (prisma not threaded), fixed in the same sprint.

---

### Testing Strategy

**Test files to create:** 2 (see Files to Create above)

**Test runner:** `vitest.integration.config.ts` — integration tests run under this config (includes `*.integration.test.ts`). Run with:
```
npx vitest run -c vitest.integration.config.ts src/__tests__/f-ux-b.conversationCore.integration.test.ts
npx vitest run -c vitest.integration.config.ts src/__tests__/f085.conversationCore.integration.test.ts
```

**Key test scenarios:**

*Happy path (f-ux-b.conversationCore)*
- `'tapa de croquetas'` → `portionAssumption.source = 'per_dish'`, `term = 'tapa'`, `grams = 50`, `pieces = 2` — primary regression test
- `'ración de croquetas'` → `portionAssumption.source = 'per_dish'`, `grams = 200`, `pieces = 8`
- `'media ración de croquetas'` → `portionAssumption.source = 'per_dish'`, `term = 'media_racion'`, `grams = 100`, `pieces = 4`
- `'ración grande de croquetas'` → `portionAssumption.source = 'per_dish'`, `grams = 300`, F042 multiplier=1.5 applied

*Edge cases (f-ux-b.conversationCore)*
- `'bocadillo de jamón'` → `portionAssumption` absent (bocadillo not in F-UX-B scope — F085 still fires)
- `'croquetas'` → `portionAssumption` absent (no Spanish portion term)
- `'TAPA DE CROQUETAS'` → same as lowercase (case-insensitive detection end-to-end)

*Happy path (f085.conversationCore)*
- `'tapa de croquetas'` → `portionSizing = { term: 'tapa', gramsMin: 50, gramsMax: 80 }` — primary F085 regression
- `'ración para compartir de croquetas'` → `portionSizing.term = 'ración para compartir'`
- `'TAPA DE CROQUETAS'` → `portionSizing.term = 'tapa'`

*Control tests (f085.conversationCore)*
- `'bocadillo de jamón'` → `portionSizing = { term: 'bocadillo', gramsMin: 200, gramsMax: 250 }` — confirms F085 works when F078 doesn't strip the term (should pass even before the fix — validates test logic)
- `'croquetas'` → `portionSizing` absent

**Mocking strategy:**

Integration tests mock two modules:
1. `../conversation/contextManager.js` — `getContext` returns `null` (no chain context), `setContext` is a no-op. This avoids needing a real Redis connection for context lookups.
2. `../lib/cache.js` — `buildKey` passes through (pure fn, no mock needed but reexport for purity), `cacheGet` returns `null` (always cache miss), `cacheSet` is a no-op. This avoids needing a real Redis connection for estimation caching and ensures each test runs the full estimation cascade (no cached short-circuit).

Everything else runs against the real test DB:
- `Prisma` → real `PrismaClient` with `DATABASE_URL_TEST`
- `Kysely` → real pool via `PostgresDialect` with `DATABASE_URL_TEST`
- `runEstimationCascade` → real L1/L2/L3 cascade against test DB (dishes seeded in `beforeAll`)
- `resolvePortionAssumption` → real Prisma queries against test DB (standard_portions seeded in `beforeAll`)

**Regression guard:**

After Commit 3, run the full test suite:
```
npm test -w @foodxplorer/api    # unit + integration; expect 0 regressions + 2 new suites green
npm test -w @foodxplorer/shared # unchanged
npm test -w @foodxplorer/bot    # unchanged (byte-identity preserved)
npm test -w @foodxplorer/web    # unchanged
npm run typecheck               # types.ts change must compile
npm run build -w @foodxplorer/api
```

---

### Key Patterns

**1. Module-level cache mock in integration tests**
`cache.ts` imports `redis.ts` as a module singleton at the top of the file. In integration tests that do NOT need Redis caching, mock `../lib/cache.js` at the module level (via `vi.hoisted` + `vi.mock`) to prevent the ioredis connection attempt. Pattern from `packages/api/src/__tests__/f070.estimationOrchestrator.unit.test.ts` lines 30-38:
```typescript
const { mockCacheGet, mockCacheSet } = vi.hoisted(() => ({
  mockCacheGet: vi.fn().mockResolvedValue(null),
  mockCacheSet: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../lib/cache.js', () => ({
  buildKey: (entity: string, id: string) => `fxp:${entity}:${id}`,
  cacheGet: mockCacheGet,
  cacheSet: mockCacheSet,
}));
```

**2. `vi.hoisted` + `vi.mock` ordering**
All `vi.mock` calls must come before any `import` of the module under test. Use `vi.hoisted` when you need a named reference to the mock function (so you can call `.mockResolvedValue` in tests). Pattern confirmed in `f070.conversationCore.unit.test.ts` lines 17-43.

**3. Fixture UUID prefix allocation**
- `fb000000-0001-...` — already claimed by `f-ux-b.estimateRoute.portionAssumption.integration.test.ts`
- `fc000000-00fc-...` — assign to `f085.conversationCore.integration.test.ts`
- `fd000000-00fd-...` — assign to `f-ux-b.conversationCore.integration.test.ts`
These prefixes don't collide with any existing fixtures (verified via Grep).

**4. `estimate()` call sites in conversationCore — comparison and menu paths do NOT need the fix**
Lines 197-217 (comparison) and 265-280 (menu estimation): `estimate()` is called via `parseDishExpression()` which does NOT apply F078 stripping. Those paths are not affected by Bug 2. Only Step 4 (single-dish estimation) calls `extractFoodQuery` + `estimate` and needs `originalQuery: trimmed`.

**5. `trimmed` is already computed before Step 4**
`trimmed = text.trim()` at line 91 of `conversationCore.ts`. No new variable needed. Pass it directly as `originalQuery: trimmed`.

**6. `portionKeySuffix` is empty for GET /estimate callers**
The GET /estimate route (`routes/estimate.ts`) calls `estimate({ query, ... })` without `originalQuery`. The `originalQuery ?? query` fallback means `portionDetectionQuery === query`, so `normalizedPortionQuery === normalizedQuery`, so `portionKeySuffix === ''`. The cache key format is byte-identical to the previous format for these callers. No regression.

**7. `portionAssumption` absence vs null**
When `prisma` is absent from the request, `if (prisma !== undefined)` is false → the `resolvePortionAssumption` block is skipped → `portionAssumption` is never set on `estimateData` → the field is absent (not `null`) on the response. Tests should assert `result.estimation.portionAssumption` is `undefined` (not `null`) for these cases. The `EstimateDataSchema` defines `portionAssumption` as `optional()` (not nullable), consistent with absent rather than null.

**8. The `portionAssumption` logger param in `resolvePortionAssumption`**
Signature (line 131 of portionAssumption.ts): `logger?: { info: (data: object, msg: string) => void }`. Cast: `logger as Parameters<typeof resolvePortionAssumption>[5]`. This cast is already in the existing orchestrator code at line 161 — no change needed.

**9. Dish seeding for FTS matching**
For `processMessage` integration tests, the seeded dish must be discoverable by L1 FTS for the test queries. For 'croquetas', the dish needs `nameEs` containing 'croquetas' (FTS Spanish tsvector match). Pattern confirmed in `f038.estimate-l1.integration.test.ts`: `nameEs: 'Ensalada de Pollo a la Plancha'` matches query `'ensalada de pollo'`. For the new fixtures: `nameEs: 'Croquetas de jamón'` should match `'croquetas'` via FTS. Note: the `chainSlug` on the restaurant must match `chainSlugs` passed to `processMessage` so the cascade checks the right restaurant's dishes.

---

### Verification commands run

- `Read: packages/api/src/conversation/types.ts:60-78` → confirmed `ConversationRequest` has NO `prisma` field; imports do NOT include `PrismaClient` → plan correctly identifies this as Bug 1 root cause; add `import type { PrismaClient }` + `prisma?: PrismaClient` field
- `Read: packages/api/src/routes/conversation.ts:42-46` → confirmed `prisma` destructured from `opts` at line 46; plugin options interface includes `prisma: PrismaClient`; processMessage called at line 111 and 417 without `prisma` → both call sites need `prisma` added
- `Read: packages/api/src/conversation/conversationCore.ts:48-60, 345-361` → confirmed `prisma` not in destructure block; `estimate({...})` at line 351 omits `prisma` and `originalQuery`; `trimmed` computed at line 91 is available → plan changes are minimal and non-disruptive
- `Read: packages/api/src/conversation/estimationOrchestrator.ts:30-43, 62-175` → confirmed `EstimateParams` has no `originalQuery` field; `enrichWithPortionSizing(query)` at line 145 uses stripped query; `detectPortionTerm(query)` at line 152 uses stripped query; `resolvePortionAssumption(..., query, ...)` at line 159 passes stripped query; cache key at line 80-83 uses only `normalizedQuery`; `if (prisma !== undefined)` guard at line 151 is correct logic — just never triggered from conversation path → all 6 sub-changes identified correctly
- `Read: packages/api/src/conversation/entityExtractor.ts:130-162` → confirmed `extractPortionModifier('ración grande de croquetas')`: pattern `/\bgrandes?\b/i` matches before `media ración` pattern; `cleanQuery = 'ración de croquetas'`, `portionMultiplier = 1.5`; F078 `SERVING_FORMAT_PATTERNS` then strips `ración de` → `extractedQuery = 'croquetas'`; `originalQuery = 'ración grande de croquetas'` → `detectPortionTerm` finds 'ración' ✓
- `Read: packages/api/src/conversation/entityExtractor.ts:426-432` → confirmed `SERVING_FORMAT_PATTERNS` does NOT include `bocadillo de` — only `tapas? de`, `pintxos? de`, `pinchos? de`, `raciones de`, `raci[oó]n de` → `'bocadillo de jamón'` is NOT stripped by F078 → F085 correctly detects 'bocadillo' even without the fix → control test valid
- `Read: packages/api/src/estimation/portionSizing.ts:39-105` → confirmed `PORTION_RULES` has `tapa` at `{gramsMin:50, gramsMax:80}`, `ración` at `{gramsMin:200, gramsMax:250}`, `bocadillo` at `{gramsMin:200, gramsMax:250}`, `ración para compartir` at `{gramsMin:300, gramsMax:400}` → test assertions match these values
- `Read: packages/api/src/estimation/portionAssumption.ts:125-132` → confirmed `resolvePortionAssumption` signature: `(prisma, dishId, detectedTerm, originalQuery, multiplier, logger?)` → 4th param is `originalQuery` (the raw user query for `extractTermDisplay`); plan correctly sets this to `portionDetectionQuery`
- `Read: packages/api/src/__tests__/f-ux-b.estimateRoute.portionAssumption.integration.test.ts:1-170` → confirmed fixture pattern: `fb000000-0001-...` prefix, PrismaClient with datasources override, cleanFixtures pre/post, standardPortion rows for `tapa` (50g, 2 pieces) and `racion` (200g, 8 pieces); test assertions verified against these values → new test files must match this fixture shape
- `Grep: "DATABASE_URL_TEST" in packages/api/src/__tests__/` → confirmed pattern `process.env['DATABASE_URL_TEST'] ?? 'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test'` → used in both new test files
- `Read: packages/api/vitest.integration.config.ts` → confirmed `*.integration.test.ts` files are included in integration test run; `REDIS_URL: 'redis://localhost:6380'` in env → cache singleton would normally try to connect; mock of `lib/cache.js` prevents actual Redis connection
- `Grep: "vi.mock.*lib/cache" in packages/api/src/__tests__/` → confirmed 10 existing test files use this mock pattern; `f070.estimationOrchestrator.unit.test.ts` has the canonical pattern with `vi.hoisted` + `buildKey` passthrough → adopt this exactly in both new integration tests
- `Grep: "vi.mock.*contextManager" in packages/api/src/__tests__/` → confirmed `f070.conversationCore.unit.test.ts` uses `vi.hoisted` + `vi.mock('../conversation/contextManager.js')` → adopt same pattern in both new integration tests
- `Grep: "fb000000|fc000000|fd000000" across packages/api/src/__tests__/` → `fb000000-0001-...` claimed by existing f-ux-b test; `fc` and `fd` prefixes are unallocated → safe to use `fc000000-00fc-...` and `fd000000-00fd-...` for new tests
- `Read: packages/api/src/lib/cache.ts:1-15` → confirmed `cache.ts` imports `redis` singleton from `./redis.js` at module load time; without mocking `lib/cache.js`, any test that imports the estimationOrchestrator (via processMessage) will trigger the ioredis singleton constructor → mocking `lib/cache.js` is required in integration tests that don't need caching
- `Read: packages/shared/src/schemas/estimate.ts:189-304` → confirmed `PortionSizing` type fields (`term`, `gramsMin`, `gramsMax`, `description`); `PortionAssumption` type fields; `portionSizing: PortionSizingSchema.optional()` and `portionAssumption: PortionAssumptionSchema.optional()` — both optional (absent, not null, when not populated) → test assertions should check `toBeDefined()` not `not.toBeNull()`

---

## Acceptance Criteria

- [ ] `POST /conversation/message` with `'tapa de croquetas'` returns `portionAssumption.source = 'per_dish'`, `portionAssumption.term = 'tapa'`, `portionAssumption.grams = 50` (when croquetas dish + tapa row seeded)
- [ ] `POST /conversation/message` with `'tapa de croquetas'` returns `portionSizing.term = 'tapa'` (F085)
- [ ] `POST /conversation/message` with `'ración grande de croquetas'` returns `portionAssumption.grams = 300`, `portionMultiplier = 1.5` (F042 × Tier 1)
- [ ] `POST /conversation/message` with `'media ración de croquetas'` returns `portionAssumption.term = 'media_racion'`, `portionAssumption.grams = 100` (Tier 2)
- [ ] `POST /conversation/message` with `'bocadillo de jamón'` returns `portionAssumption = null` and `portionSizing.term = 'bocadillo'` (out-of-scope term, F085 still works)
- [ ] `POST /conversation/message` with `'croquetas'` (no portion term) returns `portionAssumption = null`, `portionSizing = null`
- [ ] Cache key correctly distinguishes `'tapa de croquetas'` from `'croquetas'` (no stale hit)
- [ ] GET /estimate route unaffected (no regression)
- [ ] New integration test file `f-ux-b.conversationCore.integration.test.ts` exists and all tests pass
- [ ] New integration test file `f085.conversationCore.integration.test.ts` exists and all tests pass
- [ ] All existing tests pass — 0 regressions across shared/api/bot/web
- [ ] ADR-021 written in `decisions.md`
- [ ] BUG-PROD-006 entry in `bugs.md`

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] TDD: integration test files committed RED first, then fix makes them GREEN
- [ ] `npm test -w @foodxplorer/api` — new suites added, all pass
- [ ] `npm test -w @foodxplorer/shared` — unchanged (no regressions)
- [ ] `npm test -w @foodxplorer/bot` — unchanged (byte-identity preserved)
- [ ] `npm test -w @foodxplorer/web` — unchanged (no regressions)
- [ ] `npm run lint` + `npm run typecheck` + `npm run build` — all clean per affected package
- [ ] `docs/project_notes/decisions.md` — ADR-021 added
- [ ] `docs/project_notes/bugs.md` — BUG-PROD-006 entry added
- [ ] `docs/project_notes/key_facts.md` — F-UX-B section updated
- [ ] Code follows project standards (YAGNI, no speculative abstractions)

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, spec reviewed (cross-model: Codex + Gemini)
- [ ] Step 1: Branch created, ticket generated, tracker updated
- [ ] Step 2: `backend-planner` executed, plan approved (cross-model review)
- [ ] Step 3: `backend-developer` executed with TDD (RED → GREEN)
- [ ] Step 4: `production-code-validator` executed, quality gates pass
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 5: `qa-engineer` executed
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-13 | Spec written (Step 0) | Root cause verified empirically. Two bugs found: (1) prisma not in ConversationRequest — primary; (2) stripped query passed to orchestrator — secondary. Cross-model review pending. |

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

*Ticket created: 2026-04-13*
