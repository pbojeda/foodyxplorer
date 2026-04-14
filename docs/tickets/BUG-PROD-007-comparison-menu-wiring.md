# BUG-PROD-007: comparison + menu paths missing `prisma` and `originalQuery`

**Feature:** BUG-PROD-007 | **Type:** Backend-Bugfix | **Priority:** M2 (Degraded UX — comparison and menu responses show null portionSizing / portionAssumption)
**Status:** Spec v2 (cross-model reviewed) | **Branch:** bugfix/BUG-PROD-007-comparison-menu-wiring
**Created:** 2026-04-14 | **Dependencies:** BUG-PROD-006 (merged ✓), F085 (done ✓), F-UX-B (done ✓)

---

## Spec

### Description

**Summary:** BUG-PROD-006 wired `prisma` and `originalQuery` into the solo-dish estimation path
(`conversationCore.ts` Step 4). The comparison path (Step 3) and the menu estimation path (Step 3.5)
were left with the original broken `estimate()` call shape — no `prisma`, no `originalQuery`. As a
result, `portionSizing` (F085) and `portionAssumption` (F-UX-B) are `null` for every dish in a
comparison or menu query, despite those fields working correctly on solo-dish queries after BUG-PROD-006.

**User-visible symptoms:**

- A user types `"tapa de croquetas vs tapa de tortilla"` → the comparison response has
  `portionSizing: null` and `portionAssumption: null` on **both** `dishA` and `dishB`.
- A user types `"menú del día con tapa de croquetas y media ración de paella"` → every item in the
  menu array shows `portionSizing: null` and `portionAssumption: null`.
- Solo-dish queries (`"tapa de croquetas"`) correctly return `portionSizing` and `portionAssumption`
  after BUG-PROD-006 — confirming the orchestrator logic is sound and only the call sites are broken.

**Empirical ground truth (queries via `POST /conversation/message`, HEAD of `develop`):**

| Query | Intent | Dish side | `portionSizing` actual | `portionAssumption` actual | Expected (post-fix) |
|-------|--------|-----------|------------------------|----------------------------|---------------------|
| `tapa de croquetas vs tapa de tortilla` | `comparison` | dishA (croquetas) | **undefined** ❌ | **undefined** ❌ | `{ term:'tapa', gramsMin:50, gramsMax:80 }` / `{ source:'per_dish', term:'tapa', grams:50 }` |
| `tapa de croquetas vs tapa de tortilla` | `comparison` | dishB (tortilla) | **undefined** ❌ | **undefined** ❌ | `{ term:'tapa', … }` / `{ source:'per_dish', term:'tapa', … }` |
| `pincho de tortilla vs ración de croquetas` | `comparison` | dishA (tortilla) | **undefined** ❌ | **undefined** ❌ | `{ term:'pincho', … }` / `{ source:'per_dish', term:'pintxo', … }` |
| `pincho de tortilla vs ración de croquetas` | `comparison` | dishB (croquetas) | **undefined** ❌ | **undefined** ❌ | `{ term:'ración', … }` / `{ source:'per_dish', term:'racion', grams:200 }` |
| `menú del día con tapa de croquetas y media ración de paella` | `menu_estimation` | item[0] (croquetas) | **undefined** ❌ | **undefined** ❌ | `{ term:'tapa', … }` / `{ source:'per_dish', term:'tapa', grams:50 }` |
| `menú del día con tapa de croquetas y media ración de paella` | `menu_estimation` | item[1] (paella) | **undefined** ❌ | **undefined** ❌ | `{ term:'ración', … }` / `{ source:'per_dish', term:'media_racion', grams:100 }` (Tier 2 arithmetic against paella's `racion` standardPortion of 200g × 0.5) |

All expected outcomes are post-fix values. The actual portion data depends on seeded `standardPortion`
rows; the key assertion is that `portionSizing` and `portionAssumption` are **defined** (not absent)
when the query contains a recognized Spanish portion term. `EstimateDataSchema` declares both fields
as `.optional()` (not `.nullable()`) — in the current code an unset field is **absent** from the JSON
payload, not set to `null`. Tests assert with `toBeDefined()` / `toBeUndefined()`, never
`toBeNull()`.

### Root Cause

**Two call sites in `conversationCore.ts` were not updated by BUG-PROD-006.**

#### Call Site 1 — Comparison path (`conversationCore.ts` lines 197–217)

```
packages/api/src/conversation/conversationCore.ts:197-217
```

Both `estimate()` calls inside `Promise.allSettled([...])` for `dishA` and `dishB` pass only:

```
{ query, chainSlug, portionMultiplier, db, openAiApiKey, level4Lookup, chainSlugs, logger }
```

Missing: **`prisma`** (Bug 1 class) and **`originalQuery`** (Bug 2 class) — identical to the
pre-BUG-PROD-006 state of the solo-dish path. The `estimate()` function receives `prisma: undefined`
→ `resolvePortionAssumption` never executes. The `originalQuery` defaults to `query` (the F078-stripped
form) → `enrichWithPortionSizing` and `detectPortionTerm` run on e.g. `'croquetas'` instead of
`'tapa de croquetas'` → `portionSizing: null`.

#### Call Site 2 — Menu estimation path (`conversationCore.ts` lines 264–281)

```
packages/api/src/conversation/conversationCore.ts:264-281
```

The `estimate()` call inside `menuItems.map(...)` has the same missing-param shape as Call Site 1.
Every menu item suffers both Bug 1 and Bug 2.

#### Logger downgrade (`conversationCore.ts` line 353)

After this fix lands, the `logger.warn` guard at line 353 (`'BUG-PROD-006: prisma absent from ConversationRequest'`) can no longer be triggered by any legitimate internal call site — solo, comparison, and menu paths will all pass `prisma`. The warn should be downgraded to `logger.debug` to eliminate misleading noise in production logs.

#### Why BUG-PROD-006 did not cover these paths

BUG-PROD-006 was scoped to the solo-dish path (Step 4) because that was the verified root cause for
the reported symptoms (solo queries returning null). The comparison and menu paths share the same
`ConversationRequest` threading infrastructure introduced by BUG-PROD-006 (`prisma` is now a field on
`ConversationRequest`; the route already passes it) — so the threading work is done. The fix here is
purely additive: two call sites need `prisma` and `originalQuery` added to their `estimate()` invocations.

#### Why the test gap existed

Existing integration tests for comparison (`f070.conversationCore.unit.test.ts` and related) assert
structural shape fields (`intent: 'comparison'`, `dishA.result`, `dishB.result`) but do not assert
`portionSizing` or `portionAssumption` on either side. Menu tests follow the same pattern. Because
the orchestrator-level functions (`enrichWithPortionSizing`, `resolvePortionAssumption`) have their
own passing unit tests, the integration gap was invisible until the full flow was exercised with a
query containing a portion term — which no existing comparison or menu test does.

### Scope

**IN scope:**

- `conversationCore.ts` comparison path (lines 197–217): add `prisma` and `originalQuery` to both `estimate()` calls
- `conversationCore.ts` menu path (lines 264–281): add `prisma` and `originalQuery` to the `estimate()` call inside `menuItems.map(...)`
- `conversationCore.ts` line 353: downgrade `logger.warn` → `logger.debug`
- Extend the two existing ADR-021 integration test files (no new files for comparison/menu):
  - `f-ux-b.conversationCore.integration.test.ts` — add `describe('comparison path')`, `describe('menu path')`, and a scope ampliado `describe('portion edge cases')` block
  - `f085.conversationCore.integration.test.ts` — add `describe('comparison path')` and `describe('menu path')` blocks
- Extend `cache.test.ts` (unit) with one AC12 `buildKey` regression guard test — unit level, not integration
- Scope ampliado — close minor gaps flagged by QA on BUG-PROD-006 tests, in the same PR:
  1. Integration test `processMessage('media ración grande de croquetas')` → `portionAssumption.grams === 100`. F042 compound `'media ración'` matches and the trailing `'grande'` is silently dropped. **Document as accepted behavior** (not a bug); tracked separately as `BUG-F042-COMPOSE-SIZE-MODIFIERS` in the backlog.
  2. Integration tests `processMessage('pintxo de croquetas')` and `processMessage('pincho de croquetas')` → both yield `portionAssumption.term === 'pintxo'` (single canonical term). Confirms the pintxo/pincho alias canonicalization works end-to-end through `processMessage()`.
  3. Explicit assertion in the existing (or new) cache layer test that cache key for `'tapa de croquetas'` differs from cache key for `'croquetas'` (regression guard for BUG-PROD-006 Bug 3 — `normalizedPortionQuery` suffix must be present).

**OUT of scope:**

- Solo-dish path (`conversationCore.ts` Step 4) — already fixed by BUG-PROD-006
- F042 compound logic (`extractPortionModifier`) — the `'grande'` silent-drop is accepted behavior, tracked separately
- Any refactor of `conversationCore.ts` beyond the two call sites and the logger level change
- Schema changes, Prisma migrations, new dependencies
- Frontend changes
- `engineRouter`, `estimationOrchestrator`, or `portionAssumption.ts` — no changes needed; the orchestrator already handles `prisma` and `originalQuery` correctly after BUG-PROD-006

### Edge Cases

1. **Comparison where one side is a null-result (`nullEstimateData` branch):** When one `Promise.allSettled` leg rejects (e.g., dish not found), the code builds a `nullEstimateData` object for that side. The fix must not break this: passing `prisma` and `originalQuery` to `estimate()` does not affect rejection handling. The `nullEstimateData` object in `conversationCore.ts:226-237` **omits `portionSizing` and `portionAssumption` entirely** — `EstimateDataSchema.portionSizing` and `.portionAssumption` are `.optional()` (see `packages/shared/src/schemas/estimate.ts:297,303`), so absent fields validate cleanly. Tests for null-result sides must assert these fields are `undefined` (absent), **not `null`** — the latter would be asserting against a contract the schema does not define. The spec does not change `nullEstimateData` shape.

2. **Menu with mixed valid/invalid items:** `Promise.allSettled` on menu items; some items may reject (e.g., unknown dish). Rejected items already produce a null-result `estimation` inline in the `items` array. Passing `prisma` and `originalQuery` to valid items does not affect the rejection path for invalid ones.

3. **Per-side `originalQuery` for comparison — CONFIRMED.** `extractComparisonQuery` (`entityExtractor.ts:375-393`) returns `{ dishA, dishB }` via `splitByComparator(remainder)` where `remainder` is post-prefix but **pre-F078**. The raw slice for each side (`dishAText` / `dishBText`) preserves F078 serving-format prefixes (`tapa de`, `pincho de`, etc.). These are the correct per-side `originalQuery` values. The subsequent `parseDishExpression()` call in the current code strips F078 to produce `parsedA.query` / `parsedB.query` — those are the **stripped** values and must NOT be used for `originalQuery`. Binding rule: `originalQuery: dishAText` (the argument that was fed to `parseDishExpression`, not the return value).

4. **Per-item `originalQuery` for menu — CONFIRMED.** `detectMenuQuery` (`menuDetector.ts:75-108`) returns an array of raw item strings produced by `splitMenuItems(itemsRaw)`. These strings are the pre-F078 per-item slices (`'tapa de croquetas'`, `'media ración de paella'`, etc.). Each `itemText` in `menuItems.map((itemText) => ...)` is the correct `originalQuery` for that item's `estimate()` call. Binding rule: `originalQuery: itemText`.

5. **F042 × `'grande'` drop — `'media ración grande de croquetas'`:** F042 matches `media ración` compound first; `'grande'` is not further processed by F042 and is silently dropped by subsequent parsing. Result: `portionMultiplier = 0.5`, `cleanQuery` contains `'grande de croquetas'` but F078 does not strip `grande de`. `originalQuery = 'media ración grande de croquetas'` → `detectPortionTerm` finds `'media ración'` → Tier 2 resolves with 0.5 multiplier. Grams = Tier2_grams × 0.5. This behavior is **correct and accepted** — the trailing modifier `'grande'` is superseded by the compound-first match. Tested and documented as accepted (not a bug).

6. **Pintxo / pincho canonicalization:** Both `'pintxo de croquetas'` and `'pincho de croquetas'` must resolve `portionAssumption.term === 'pintxo'` (the canonical stored form). `detectPortionTerm` handles the alias; the integration test asserts the canonical output. No code change needed — this is a pure test coverage gap.

7. **Cache key regression guard — `'tapa de croquetas'` vs `'croquetas'`:** The BUG-PROD-006 Bug 3 fix introduced a `portionKeySuffix` so that `'tapa de croquetas'` and `'croquetas'` do not share a cache entry. The assertion confirms `buildKey(...)` output differs between the two inputs. This is a regression guard for the BUG-PROD-006 cache fix; it belongs in the scope ampliado tests of this PR.

8. **`trimmed` is the full user message for the comparison intent.** If the comparison parser extracts `dishAText = 'tapa de croquetas'` from the input `'tapa de croquetas vs tapa de tortilla'`, then `originalQuery` for `dishA`'s `estimate()` call should be `dishAText` (the pre-F078 slice), not the entire `trimmed`. The spec intentionally leaves the exact binding to the planner because the correct value depends on whether `extractComparisonQuery` preserves the raw text or has already normalized it.

### Acceptance Criteria

Each criterion is tagged with the test file that will verify it.

| # | Criterion | Test file (extended, not new) |
|---|-----------|-------------------------------|
| AC1 | `processMessage('tapa de croquetas vs tapa de tortilla')` → `comparison.dishA.portionSizing.term === 'tapa'` (defined, not undefined) | `f085.conversationCore.integration.test.ts` → `describe('comparison path')` |
| AC2 | `processMessage('tapa de croquetas vs tapa de tortilla')` → `comparison.dishB.portionSizing.term === 'tapa'` (defined) | `f085.conversationCore.integration.test.ts` → `describe('comparison path')` |
| AC3 | `processMessage('tapa de croquetas vs tapa de tortilla')` → `comparison.dishA.portionAssumption.source === 'per_dish'` | `f-ux-b.conversationCore.integration.test.ts` → `describe('comparison path')` |
| AC4 | `processMessage('tapa de croquetas vs tapa de tortilla')` → `comparison.dishB.portionAssumption.source === 'per_dish'` | `f-ux-b.conversationCore.integration.test.ts` → `describe('comparison path')` |
| AC5 | `processMessage('pincho de tortilla vs ración de croquetas')` → `dishA.portionAssumption.term === 'pintxo'`, `dishB.portionAssumption.term === 'racion'` | `f-ux-b.conversationCore.integration.test.ts` → `describe('comparison path')` |
| AC6 | `processMessage('menú del día con tapa de croquetas y media ración de paella')` → `menuEstimation.items[0].estimation.portionSizing.term === 'tapa'` AND `menuEstimation.items[1].estimation.portionSizing.term === 'ración'` (both items have portionSizing defined) | `f085.conversationCore.integration.test.ts` → `describe('menu path')` |
| AC7 | `processMessage('menú del día con tapa de croquetas y media ración de paella')` → `items[0].estimation.portionAssumption.term === 'tapa'` AND `items[1].estimation.portionAssumption.term === 'media_racion'` (both items have portionAssumption defined, proving per-item `originalQuery` binding) | `f-ux-b.conversationCore.integration.test.ts` → `describe('menu path')` |
| AC8 | Comparison with one null-result side (dish not found) → null side has `portionSizing` **undefined** (absent field, schema is `.optional()`), valid side has `portionSizing` defined | `f085.conversationCore.integration.test.ts` → `describe('comparison path')` |
| AC9 | `processMessage('pintxo de croquetas')` → `portionAssumption.term === 'pintxo'` (scope ampliado — solo path, canonical form) | `f-ux-b.conversationCore.integration.test.ts` → `describe('portion edge cases')` |
| AC10 | `processMessage('pincho de croquetas')` → `portionAssumption.term === 'pintxo'` (alias maps to canonical) | `f-ux-b.conversationCore.integration.test.ts` → `describe('portion edge cases')` |
| AC11 | `processMessage('media ración grande de croquetas')` → `portionAssumption.grams === 100` (accepted behavior: `'grande'` dropped) | `f-ux-b.conversationCore.integration.test.ts` → `describe('portion edge cases')` |
| AC12 | `buildKey('estimate', <normalizedKey including portionKeySuffix for 'tapa de croquetas'>)` ≠ `buildKey('estimate', <normalizedKey for 'croquetas'>)` (unit-level regression guard for BUG-PROD-006 Bug 3) | `cache.test.ts` → extended `describe('buildKey()')` block (unit, NOT integration) |
| AC13 | `logger.warn` at `conversationCore.ts:353` is downgraded to `logger.debug` (no warn fires for valid prisma-threaded calls) | Code review / no test needed |

### Test Plan

**Governing rule (ADR-021):** Integration tests MUST call `processMessage()` directly. Only
`contextManager`, `lib/cache`, and `engineRouter` are mocked. `prisma`, Kysely `db`, the
orchestrator, portionSizing, and portionAssumption resolvers are all real. The canonical file
naming is `{feature-id}.conversationCore.integration.test.ts` — this ticket **extends** the two
existing files rather than creating new per-intent variants.

#### Extended files

##### 1. `packages/api/src/__tests__/f-ux-b.conversationCore.integration.test.ts` — EXTEND

File already exists (BUG-PROD-006). Add three new `describe` blocks inside it, using fresh UUID
prefixes to avoid collisions with existing fixture IDs.

- **UUID prefix for new fixtures:** `fe000000-00fe-4000-a000-{id}` (comparison/menu/edge-cases; confirmed unused in repo)
- **Mock strategy:** reuse the file's existing `contextManager` + `lib/cache` + `engineRouter` mocks (already set up). No new mocks.
- **Fixtures:** extend the existing seed with:
  - `DISH_CROQUETAS` with `standardPortion` rows for `tapa` (50g/2pc) and `racion` (200g/8pc)
  - `DISH_TORTILLA` with a `standardPortion` row for `tapa` (60g)
  - `DISH_PAELLA` with a `standardPortion` row for `racion` (200g) — required so AC7's `'media ración de paella'` menu item exercises the Tier 2 `media_racion` path end-to-end
  - Shared `ACTOR_ID`
- **Cascade mock:** extend `mockCascade` to route by query text — croquetas queries → `DISH_CROQUETAS`, tortilla → `DISH_TORTILLA`, paella → `DISH_PAELLA`; unknown queries reject (for null-result edge cases)
- **RED state:** Call sites 1 and 2 not yet patched → `portionAssumption` undefined on all comparison and menu items
- **GREEN state:** Both call sites patched + per-side/per-item `originalQuery` bound correctly → `portionAssumption` populated

**`describe('comparison path')` — test cases:**

| Test name | Input | Assertion |
|-----------|-------|-----------|
| AC3 — dishA `tapa` assumption | `'tapa de croquetas vs tapa de tortilla'` | `dishA.portionAssumption.source === 'per_dish'`, `term === 'tapa'`, `grams === 50` |
| AC4 — dishB `tapa` assumption | `'tapa de croquetas vs tapa de tortilla'` | `dishB.portionAssumption.source === 'per_dish'`, `term === 'tapa'`, `grams === 60` |
| AC5 — mixed terms per side (pintxo vs racion) | `'pincho de tortilla vs ración de croquetas'` | `dishA.portionAssumption.term === 'pintxo'`, `dishB.portionAssumption.term === 'racion'` |

**`describe('menu path')` — test cases:**

| Test name | Input | Assertion |
|-----------|-------|-----------|
| AC7 — both items have portionAssumption defined | `'menú del día con tapa de croquetas y media ración de paella'` | `items[0].estimation.portionAssumption.term === 'tapa'` AND `items[1].estimation.portionAssumption.term === 'media_racion'` (Tier 2 arithmetic resolves against paella's `racion` standardPortion) |
| Menu mixed valid/invalid item | query where item[1] resolves to no dish | `items[0].estimation.portionAssumption.term === 'tapa'`, `items[1].estimation.portionAssumption === undefined` (null-result fallback omits the field) |

**`describe('portion edge cases')` — scope ampliado, solo-path tests:**

| Test name | Input | Assertion |
|-----------|-------|-----------|
| AC9 — pintxo canonical | `'pintxo de croquetas'` | `portionAssumption.term === 'pintxo'` |
| AC10 — pincho alias → canonical | `'pincho de croquetas'` | `portionAssumption.term === 'pintxo'` |
| AC11 — F042 compound drops trailing modifier (accepted) | `'media ración grande de croquetas'` | `portionAssumption.grams === 100` (compound match wins, `'grande'` silently dropped) |

##### 2. `packages/api/src/__tests__/f085.conversationCore.integration.test.ts` — EXTEND

File already exists (BUG-PROD-006). Add two new `describe` blocks.

- **UUID prefix for new fixtures:** `ff000000-00ff-4000-a000-{id}` (comparison/menu; confirmed unused in repo)
- **Mock strategy:** reuse the file's existing mocks
- **Fixtures:** same shape as file 1 extension but independent UUID space; F085 `portionSizing` uses a static lookup table so `standardPortion` rows are not required for the AC1/AC2/AC6 assertions (they remain needed in file 1 for F-UX-B)

**`describe('comparison path')` — test cases:**

| Test name | Input | Assertion |
|-----------|-------|-----------|
| AC1 — dishA `tapa` sizing | `'tapa de croquetas vs tapa de tortilla'` | `dishA.portionSizing.term === 'tapa'`, `gramsMin/gramsMax` defined |
| AC2 — dishB `tapa` sizing | `'tapa de croquetas vs tapa de tortilla'` | `dishB.portionSizing.term === 'tapa'` |
| AC8 — one null-result side, null side has `portionSizing` undefined | comparison where dishB query hits no dish | `dishA.portionSizing.term === 'tapa'` defined, `expect(dishB.portionSizing).toBeUndefined()` (schema is `.optional()`, `nullEstimateData` omits field) |
| Control — bocadillo not stripped by F078 | `'bocadillo de jamón vs tapa de croquetas'` | `dishA.portionSizing.term === 'bocadillo'` — non-regression guard for non-stripped terms |

**`describe('menu path')` — test cases:**

| Test name | Input | Assertion |
|-----------|-------|-----------|
| AC6 — both menu items have portionSizing | `'menú del día con tapa de croquetas y media ración de paella'` | `items[0].estimation.portionSizing.term === 'tapa'` AND `items[1].estimation.portionSizing.term === 'ración'` (both items' raw `itemText` reaches `enrichWithPortionSizing`) |
| Control — bocadillo menu item | menu containing `'bocadillo de jamón'` | `items[N].estimation.portionSizing.term === 'bocadillo'` — non-regression control |

##### 3. `packages/api/src/__tests__/cache.test.ts` — EXTEND (unit)

File already exists with a `describe('buildKey()')` block. Add one regression-guard test inside it.

- **Level:** unit (not integration — ADR-021 does NOT apply here)
- **Purpose:** regression guard that the BUG-PROD-006 Bug 3 `portionKeySuffix` fix remains in place, so cache entries for `'tapa de croquetas'` and `'croquetas'` never share a key after F078 stripping.

**Test case:**

| Test name | Assertion |
|-----------|-----------|
| AC12 — portion-aware cache key disambiguation | Two calls to the cache key builder for inputs that differ only by their pre-F078 form (`'tapa de croquetas'` vs `'croquetas'`, both stripping to `croquetas`) produce **different** cache keys. The exact helper name (`buildKey` directly or a higher-level `makeEstimateCacheKey`) is a planner decision; the spec requires only that the inputs produce distinct keys. |

#### ADR-021 compliance checklist (integration files only — files 1 and 2)

- [ ] `processMessage()` called directly — not `estimate()`, `resolvePortionAssumption()`, or `enrichWithPortionSizing()` directly
- [ ] `contextManager` mocked (no real Redis)
- [ ] `lib/cache` mocked (cacheGet returns null, cacheSet no-ops)
- [ ] `engineRouter` (`runEstimationCascade`) mocked (controlled dish fixture)
- [ ] Real `PrismaClient` on test DB (`postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test`)
- [ ] Real Kysely pool on test DB
- [ ] `beforeAll` pre-cleans and seeds fixtures; `afterAll` tears down in foreign-key-safe order
- [ ] Teardown order: `standardPortion → dishNutrient → dish → restaurant → dataSource`
- [ ] Null-result assertions use `toBeUndefined()`, never `toBeNull()` (schema is `.optional()`, not `.nullable()`)
- [ ] AC12 lives in `cache.test.ts`, NOT in any integration file

### Risks

1. **Per-side `originalQuery` binding for comparison — RESOLVED in Edge Case #3.** Binding rule: `originalQuery: dishAText` / `originalQuery: dishBText` (the raw arguments fed to `parseDishExpression`, not the stripped `parsedA.query` / `parsedB.query` return values). Implementer should capture the raw strings before calling `parseDishExpression`. Passing the full `trimmed` would cross-contaminate portion terms between sides.

2. **Per-item `originalQuery` binding for menu — RESOLVED in Edge Case #4.** Binding rule: `originalQuery: itemText` from the `menuItems.map((itemText) => ...)` callback.

3. **`nullEstimateData` shape (fields absent, not `null`):** The inline `nullEstimateData` objects in the comparison path (lines 226–237) and the menu path (lines 296–308) **omit** `portionSizing` and `portionAssumption` — they are not explicitly set to `null`. This is correct: `EstimateDataSchema` defines both as `.optional()` (not `.nullable()`) in `packages/shared/src/schemas/estimate.ts:297,303`. Tests must assert `expect(side.portionSizing).toBeUndefined()` — not `toBeNull()`. The planner must not add these fields to `nullEstimateData` and must not change the shared schema contract.

4. **No cascading regression risk:** The threading infrastructure (`prisma` in `ConversationRequest`, `originalQuery` in `EstimateParams`, `portionKeySuffix` in cache key) is already in place from BUG-PROD-006. This fix is purely additive at the call sites — no shared logic changes.

5. **Test DB required:** Integration tests require a running test DB at the standard URL. CI already has this from BUG-PROD-006's tests; no new CI infrastructure needed.

### Dependencies / Blockers

None. BUG-PROD-006 is merged. `prisma` is already in `ConversationRequest`. `originalQuery` is already accepted by `EstimateParams`. The route already passes `prisma`. All infrastructure from BUG-PROD-006 is load-bearing for this fix.

---

## Plan

> TODO: backend-planner fills this section after spec review approval.

---

## Merge Checklist Evidence

| Check | Evidence |
|-------|----------|
| Branch builds clean | |
| All tests pass (unit + integration) | |
| Extended integration describe blocks RED before fix, GREEN after | |
| `logger.warn` downgraded to `logger.debug` at line 353 | |
| AC9–AC12 scope ampliado verified | |
| No regressions on solo-dish path (BUG-PROD-006 tests still green) | |
| PR description references BUG-PROD-007 | |
| `ci-success` check passes | |

---

## Completion Log

### Spec review — 2026-04-14

- **Reviewers:** Gemini 2.5 (APPROVED, empirical — read 9 files, ran 18 greps) + Codex GPT-5.4 (REVISE — 4 IMPORTANT, empirical)
- **Divergence reason:** Gemini approved without catching four internal consistency issues Codex flagged. Arbitration: all 4 Codex findings cited real files/lines and were reproducible; adopted wholesale.
- **Findings addressed:**
  1. **Test file naming violates ADR-021 convention** (`.comparisonCore.`/`.menuCore.` → canonical is `.conversationCore.`). Fix: extended the two existing `f-ux-b.conversationCore.integration.test.ts` and `f085.conversationCore.integration.test.ts` files with new `describe('comparison path')` / `describe('menu path')` / `describe('portion edge cases')` blocks instead of creating new per-intent files. No new test files.
  2. **AC12 misplaced** (`buildKey` unit-level assertion inside an integration file under ADR-021 checklist). Fix: moved AC12 to `cache.test.ts` as a unit test extending the existing `describe('buildKey()')` block; removed from the integration matrix and ADR-021 checklist.
  3. **Menu query inconsistency** (Description/AC6/AC7 said `... y media ración de paella` but test plan used `... y croquetas` and expected item[1] to have no portion data — no longer verifying the bug). Fix: unified on the `'menú del día con tapa de croquetas y media ración de paella'` query throughout, added `DISH_PAELLA` fixture with a `racion` (200g) `standardPortion` row so item[1] actually exercises Tier 2 `media_racion` arithmetic (100g). AC6/AC7 now require both items to have portion data defined.
  4. **Null-result contract mismatch** (spec said `portionSizing: null` but `EstimateDataSchema` is `.optional()` and `nullEstimateData` omits the field). Fix: every mention of null-result behaviour now says **undefined/absent**, not `null`. Edge Case #1, Risk #3, AC8, Description, and the symptom table were updated. Added an ADR-021 checklist item forbidding `toBeNull()` on portion fields.
- **Result:** 4/4 IMPORTANT resolved. Spec v2 ready for plan phase.
