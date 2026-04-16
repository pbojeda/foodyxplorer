# BUG-PROD-007: comparison + menu paths missing `prisma` and `originalQuery`

**Feature:** BUG-PROD-007 | **Type:** Backend-Bugfix | **Priority:** M2 (Degraded UX — comparison and menu responses show null portionSizing / portionAssumption)
**Status:** Done | **Branch:** bugfix/BUG-PROD-007-comparison-menu-wiring (deleted) | **PR:** https://github.com/pbojeda/foodyxplorer/pull/120 (merged at `aab85f0`, 2026-04-14)
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

- A user types `"compara tapa de croquetas vs tapa de tortilla"` → the comparison response has
  `portionSizing` and `portionAssumption` **undefined** (absent, schema is `.optional()`) on both
  `dishA` and `dishB`. The `compara` prefix is required — `extractComparisonQuery` only fires on
  queries matching one of `PREFIX_PATTERNS_COMP` (`qué tiene más/menos X`, `qué engorda más`,
  `qué es más sano`, `compara[r]`); bare `'X vs Y'` falls through to solo-dish estimation.
- A user types `"menú del día: tapa de croquetas, media ración de paella"` → every item in the
  menu array shows `portionSizing` and `portionAssumption` undefined. The colon + comma form is
  used because `detectMenuQuery` + `splitMenuItems` produces cleaner per-item slices
  (`'tapa de croquetas'` and `'media ración de paella'`) than the `'… con X y Y'` form which
  leaves a leading `'con '` token on item[0].
- Solo-dish queries (`"tapa de croquetas"`) correctly return `portionSizing` and `portionAssumption`
  after BUG-PROD-006 — confirming the orchestrator logic is sound and only the comparison/menu
  call sites are broken.

**Empirical ground truth (queries via `POST /conversation/message`, HEAD of `develop`):**

| Query | Intent | Dish side | `portionSizing` actual | `portionAssumption` actual | Expected (post-fix) |
|-------|--------|-----------|------------------------|----------------------------|---------------------|
| `compara tapa de croquetas vs tapa de tortilla` | `comparison` | dishA (croquetas) | **undefined** ❌ | **undefined** ❌ | `{ term:'tapa', gramsMin:50, gramsMax:80 }` / `{ source:'per_dish', term:'tapa', grams:50 }` |
| `compara tapa de croquetas vs tapa de tortilla` | `comparison` | dishB (tortilla) | **undefined** ❌ | **undefined** ❌ | `{ term:'tapa', … }` / `{ source:'per_dish', term:'tapa', grams:60 }` |
| `compara pincho de tortilla vs ración de croquetas` | `comparison` | dishA (tortilla) | **undefined** ❌ | **undefined** ❌ | `{ term:'pincho', … }` / `{ source:'per_dish', term:'pintxo', … }` |
| `compara pincho de tortilla vs ración de croquetas` | `comparison` | dishB (croquetas) | **undefined** ❌ | **undefined** ❌ | `{ term:'ración', … }` / `{ source:'per_dish', term:'racion', grams:200 }` |
| `menú del día: tapa de croquetas, media ración de paella` | `menu_estimation` | item[0] (croquetas) | **undefined** ❌ | **undefined** ❌ | `{ term:'tapa', … }` / `{ source:'per_dish', term:'tapa', grams:50 }` |
| `menú del día: tapa de croquetas, media ración de paella` | `menu_estimation` | item[1] (paella) | **undefined** ❌ | **undefined** ❌ | `{ term:'ración', … }` / `{ source:'per_dish', term:'media_racion', grams:100 }` (Tier 2 arithmetic against paella's `racion` standardPortion of 200g × 0.5) |

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
- Extend the two existing ADR-021 integration test files (no new files; no `cache.test.ts` changes):
  - `f-ux-b.conversationCore.integration.test.ts` — add four new `describe` blocks: `'BUG-PROD-007 — comparison path'`, `'BUG-PROD-007 — menu path'`, `'BUG-PROD-007 — solo-path regression guards'` (AC9/AC10/AC11, GREEN from start), `'BUG-PROD-007 — cache key regression guard'` (AC12, GREEN from start — spies on `cacheSet` mock)
  - `f085.conversationCore.integration.test.ts` — add two new `describe` blocks: `'BUG-PROD-007 — comparison path'`, `'BUG-PROD-007 — menu path'`
- **No changes to `cache.test.ts`.** The original AC12 design (unit-level `buildKey()` assertion) was rejected in the second cross-model review: `buildKey()` only formats `fxp:<entity>:<id>` and the portion-aware composition lives in `estimationOrchestrator.ts:92-98`. A `buildKey()` unit test would stay green even if the orchestrator stopped appending `portionKeySuffix`, so it's a fake regression guard. AC12 now spies on the mocked `lib/cache.cacheSet` inside the integration test, which exercises the real orchestrator composition path.
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

1. **Comparison where one side is a rejected promise (`nullEstimateData` branch):** The `nullEstimateData` fallback at `conversationCore.ts:226-237` is built **only** when a `Promise.allSettled` leg is `rejected` — that is, when `estimate()` itself throws (DB error, cascade exception, etc.). A cascade that resolves with `result: null` (unknown dish) is a **fulfilled** promise holding a normal `EstimateData` with `result: null`, and the comparison code assigns that fulfilled value directly to `dishA` / `dishB` — NOT via `nullEstimateData`. In a fulfilled-miss case, `enrichWithPortionSizing(portionDetectionQuery)` still runs at `estimationOrchestrator.ts:160` and populates `portionSizing` from the original query, even though the dish lookup failed. To exercise the true `nullEstimateData` branch, the test must **force the mock cascade to throw** for the null-side query (e.g., the mock checks for a sentinel string like `'plato-desconocido-xyz'` and calls `throw new Error(...)`). Tests for the rejected side assert `portionSizing` and `portionAssumption` are `undefined` (fields absent — schema is `.optional()`, `nullEstimateData` omits them). Tests for a fulfilled-miss side assert `portionSizing` is **defined** (still enriched from the original query) — but that's a different test, not AC8.

2. **Menu with mixed valid/invalid items:** `Promise.allSettled` on menu items; some items may reject (e.g., unknown dish). Rejected items already produce a null-result `estimation` inline in the `items` array. Passing `prisma` and `originalQuery` to valid items does not affect the rejection path for invalid ones.

3. **Per-side `originalQuery` for comparison — CONFIRMED.** `extractComparisonQuery` (`entityExtractor.ts:375-393`) returns `{ dishA, dishB }` via `splitByComparator(remainder)` where `remainder` is post-prefix but **pre-F078**. The raw slice for each side (`dishAText` / `dishBText`) preserves F078 serving-format prefixes (`tapa de`, `pincho de`, etc.). These are the correct per-side `originalQuery` values. The subsequent `parseDishExpression()` call in the current code strips F078 to produce `parsedA.query` / `parsedB.query` — those are the **stripped** values and must NOT be used for `originalQuery`. Binding rule: `originalQuery: dishAText` (the argument that was fed to `parseDishExpression`, not the return value).

4. **Per-item `originalQuery` for menu — CONFIRMED.** `detectMenuQuery` (`menuDetector.ts:75-108`) returns an array of raw item strings produced by `splitMenuItems(itemsRaw)`. These strings are the pre-F078 per-item slices (`'tapa de croquetas'`, `'media ración de paella'`, etc.). Each `itemText` in `menuItems.map((itemText) => ...)` is the correct `originalQuery` for that item's `estimate()` call. Binding rule: `originalQuery: itemText`.

5. **F042 × `'grande'` drop — `'media ración grande de croquetas'`:** F042 matches `media ración` compound first; `'grande'` is not further processed by F042 and is silently dropped by subsequent parsing. Result: `portionMultiplier = 0.5`, `cleanQuery` contains `'grande de croquetas'` but F078 does not strip `grande de`. `originalQuery = 'media ración grande de croquetas'` → `detectPortionTerm` finds `'media ración'` → Tier 2 resolves with 0.5 multiplier. Grams = Tier2_grams × 0.5. This behavior is **correct and accepted** — the trailing modifier `'grande'` is superseded by the compound-first match. Tested and documented as accepted (not a bug).

6. **Pintxo / pincho canonicalization:** Both `'pintxo de croquetas'` and `'pincho de croquetas'` must resolve `portionAssumption.term === 'pintxo'` (the canonical stored form). `detectPortionTerm` handles the alias; the integration test asserts the canonical output. No code change needed — this is a pure test coverage gap.

7. **Cache key regression guard — `'tapa de croquetas'` vs `'croquetas'`:** The BUG-PROD-006 Bug 3 fix introduced a `portionKeySuffix` so that `'tapa de croquetas'` and `'croquetas'` do not share a cache entry. The assertion confirms `buildKey(...)` output differs between the two inputs. This is a regression guard for the BUG-PROD-006 cache fix; it belongs in the scope ampliado tests of this PR.

8. **`trimmed` is the full user message for the comparison intent.** If the comparison parser extracts `dishAText = 'tapa de croquetas'` from the input `'tapa de croquetas vs tapa de tortilla'`, then `originalQuery` for `dishA`'s `estimate()` call should be `dishAText` (the pre-F078 slice), not the entire `trimmed`. The spec intentionally leaves the exact binding to the planner because the correct value depends on whether `extractComparisonQuery` preserves the raw text or has already normalized it.

### Acceptance Criteria

Each criterion is tagged with the test file that will verify it.

| # | Criterion | RED/GREEN on HEAD | Test location |
|---|-----------|-------------------|---------------|
| AC1 | `processMessage('compara tapa de croquetas vs tapa de tortilla')` → `comparison.dishA.portionSizing.term === 'tapa'` (defined) | RED | `f085.conversationCore.integration.test.ts` → `describe('BUG-PROD-007 — comparison path')` |
| AC2 | `processMessage('compara tapa de croquetas vs tapa de tortilla')` → `comparison.dishB.portionSizing.term === 'tapa'` (defined) | RED | `f085.conversationCore.integration.test.ts` → `describe('BUG-PROD-007 — comparison path')` |
| AC3 | `processMessage('compara tapa de croquetas vs tapa de tortilla')` → `dishA.portionAssumption.source === 'per_dish'`, `term === 'tapa'`, `grams === 50` | RED | `f-ux-b.conversationCore.integration.test.ts` → `describe('BUG-PROD-007 — comparison path')` |
| AC4 | `processMessage('compara tapa de croquetas vs tapa de tortilla')` → `dishB.portionAssumption.source === 'per_dish'`, `term === 'tapa'`, `grams === 60` | RED | `f-ux-b.conversationCore.integration.test.ts` → `describe('BUG-PROD-007 — comparison path')` |
| AC5 | `processMessage('compara pincho de tortilla vs ración de croquetas')` → `dishA.portionAssumption.term === 'pintxo'`, `dishB.portionAssumption.term === 'racion'` | RED | `f-ux-b.conversationCore.integration.test.ts` → `describe('BUG-PROD-007 — comparison path')` |
| AC6 | `processMessage('menú del día: tapa de croquetas, media ración de paella')` → `items[0].estimation.portionSizing.term === 'tapa'` AND `items[1].estimation.portionSizing.term === 'media ración'` (compound entry in `PORTION_RULES` wins via longest-first match — see `estimation/portionSizing.ts:42`) | RED | `f085.conversationCore.integration.test.ts` → `describe('BUG-PROD-007 — menu path')` |
| AC7 | `processMessage('menú del día: tapa de croquetas, media ración de paella')` → `items[0].estimation.portionAssumption.term === 'tapa'`, `items[1].estimation.portionAssumption.term === 'media_racion'`, `items[1].estimation.portionAssumption.grams === 100` | RED | `f-ux-b.conversationCore.integration.test.ts` → `describe('BUG-PROD-007 — menu path')` |
| AC8 | Comparison where the dishB cascade **throws** (mock forces rejection for sentinel `'plato-desconocido-xyz'`) → `dishA.portionSizing.term === 'tapa'` (defined, valid fulfilled leg), `dishB.portionSizing === undefined` AND `dishB.portionAssumption === undefined` (rejected leg → `nullEstimateData` fallback, which omits both fields) | RED | `f085.conversationCore.integration.test.ts` → `describe('BUG-PROD-007 — comparison path')` |
| AC9 | `processMessage('pintxo de croquetas')` → `estimation.portionAssumption.term === 'pintxo'` (canonical) — **already GREEN on HEAD**, committed as regression guard for the solo-dish `'originalQuery: trimmed'` wiring from BUG-PROD-006 | GREEN from start | `f-ux-b.conversationCore.integration.test.ts` → `describe('BUG-PROD-007 — solo-path regression guards')` |
| AC10 | `processMessage('pincho de croquetas')` → `estimation.portionAssumption.term === 'pintxo'` (alias canonicalization) — **already GREEN on HEAD** | GREEN from start | `f-ux-b.conversationCore.integration.test.ts` → `describe('BUG-PROD-007 — solo-path regression guards')` |
| AC11 | `processMessage('media ración grande de croquetas')` → `estimation.portionAssumption.grams === 100` (F042 compound wins, trailing `grande` dropped) — **already GREEN on HEAD** | GREEN from start | `f-ux-b.conversationCore.integration.test.ts` → `describe('BUG-PROD-007 — solo-path regression guards')` |
| AC12 | After `processMessage('tapa de croquetas')` then `processMessage('croquetas')` in sequence, the mocked `cacheSet` spy was called with **two distinct cache keys** (real regression guard for `portionKeySuffix` in `estimationOrchestrator.ts:92-98`). Test exercises `estimate()` end-to-end and inspects the spy on `lib/cache.cacheSet` — not `buildKey()` alone. | GREEN from start | `f-ux-b.conversationCore.integration.test.ts` → `describe('BUG-PROD-007 — cache key regression guard')` |
| AC13 | `logger.warn` at `conversationCore.ts:353` is downgraded to `logger.debug` | Code review | n/a |

### Test Plan

**Governing rule (ADR-021):** Integration tests MUST call `processMessage()` directly. Only
`contextManager`, `lib/cache`, and `engineRouter` are mocked. `prisma`, Kysely `db`, the
orchestrator, portionSizing, and portionAssumption resolvers are all real. The canonical file
naming is `{feature-id}.conversationCore.integration.test.ts` — this ticket **extends** the two
existing files rather than creating new per-intent variants.

**Query form constraints (verified empirically against current code):**
- Comparison: bare `'X vs Y'` does NOT trigger comparison intent. `extractComparisonQuery`
  (`entityExtractor.ts:375`) requires one of `PREFIX_PATTERNS_COMP` (`qué tiene más/menos X`,
  `qué engorda más`, `qué es más sano`, `compara[r]`). All BUG-PROD-007 comparison tests use
  the `'compara …'` prefix form.
- Menu: `'menú del día con X y Y'` produces item[0] = `'con X'` (leading `'con '` survives),
  because `MENU_PATTERNS` captures everything after `menú del día[:\s,]+` and the `con` is
  not a menu separator. All BUG-PROD-007 menu tests use the `'menú del día: X, Y'` form
  (colon + comma), which `splitMenuItems` parses into clean raw slices.

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
- **Cascade mock:** extend `mockCascade` to route by query text — croquetas → `DISH_CROQUETAS`, tortilla → `DISH_TORTILLA`, paella → `DISH_PAELLA`. For AC8: when the query contains the sentinel `'plato-desconocido-xyz'`, the mock **throws** (rejects the promise) so the comparison path's `Promise.allSettled` captures a `rejected` status and builds the `nullEstimateData` fallback.
- **RED state:** Comparison + menu call sites not yet patched → `portionAssumption`/`portionSizing` undefined on all comparison and menu items. AC9/AC10/AC11 (solo path) and AC12 (cache key spy) are **GREEN from the start** — committed as regression guards.
- **GREEN state:** Both comparison and menu call sites patched + per-side/per-item `originalQuery` bound correctly → `portionAssumption` populated.

**`describe('BUG-PROD-007 — comparison path')` — test cases (RED → GREEN):**

| Test name | Input | Assertion |
|-----------|-------|-----------|
| AC3 — dishA `tapa` assumption | `'compara tapa de croquetas vs tapa de tortilla'` | `dishA.portionAssumption.source === 'per_dish'`, `term === 'tapa'`, `grams === 50` |
| AC4 — dishB `tapa` assumption | `'compara tapa de croquetas vs tapa de tortilla'` | `dishB.portionAssumption.source === 'per_dish'`, `term === 'tapa'`, `grams === 60` |
| AC5 — mixed terms per side (pintxo vs racion) | `'compara pincho de tortilla vs ración de croquetas'` | `dishA.portionAssumption.term === 'pintxo'`, `dishB.portionAssumption.term === 'racion'` |

**`describe('BUG-PROD-007 — menu path')` — test cases (RED → GREEN):**

| Test name | Input | Assertion |
|-----------|-------|-----------|
| AC7 — both items have portionAssumption defined | `'menú del día: tapa de croquetas, media ración de paella'` | `items[0].estimation.portionAssumption.term === 'tapa'` AND `items[1].estimation.portionAssumption.term === 'media_racion'` AND `items[1].estimation.portionAssumption.grams === 100` (Tier 2 arithmetic: paella `racion` 200g × 0.5) |

**`describe('BUG-PROD-007 — solo-path regression guards')` — scope ampliado (GREEN from start, exercises existing BUG-PROD-006 wiring):**

| Test name | Input | Assertion |
|-----------|-------|-----------|
| AC9 — pintxo canonical | `'pintxo de croquetas'` | `estimation.portionAssumption.term === 'pintxo'` |
| AC10 — pincho alias → canonical | `'pincho de croquetas'` | `estimation.portionAssumption.term === 'pintxo'` |
| AC11 — F042 compound drops trailing modifier (accepted) | `'media ración grande de croquetas'` | `estimation.portionAssumption.grams === 100` (compound match wins, `'grande'` silently dropped) |

These tests are committed as a regression guard inside the BUG-PROD-007 PR because they assert behaviors that BUG-PROD-006's fix established but never pinned through `processMessage()`. They must be GREEN immediately — if they are RED at commit time, the planner or implementer has misread the current code state.

**`describe('BUG-PROD-007 — cache key regression guard')` — AC12 (GREEN from start, spy-based):**

| Test name | Setup | Assertion |
|-----------|-------|-----------|
| AC12 — portion-aware cache key disambiguation | Call `processMessage('tapa de croquetas')`, then `processMessage('croquetas')`. The mocked `lib/cache.cacheSet` is a `vi.fn()` spy. | `cacheSet.mock.calls[0][0]` (first cache key) ≠ `cacheSet.mock.calls[1][0]` (second cache key). The first key contains the normalized `'tapa de croquetas'` suffix via `portionKeySuffix`; the second contains only `'croquetas'`. Exercises `estimationOrchestrator.ts:92-98` end-to-end, so it fails if the orchestrator ever stops appending `portionKeySuffix`. |

##### 2. `packages/api/src/__tests__/f085.conversationCore.integration.test.ts` — EXTEND

File already exists (BUG-PROD-006). Add two new `describe` blocks.

- **UUID prefix for new fixtures:** `ff000000-00ff-4000-a000-{id}` (comparison/menu; confirmed unused in repo)
- **Mock strategy:** reuse the file's existing mocks
- **Fixtures:** same shape as file 1 extension but independent UUID space; F085 `portionSizing` uses a static lookup table so `standardPortion` rows are not required for the AC1/AC2/AC6 assertions (they remain needed in file 1 for F-UX-B)

**`describe('BUG-PROD-007 — comparison path')` — test cases (RED → GREEN):**

| Test name | Input | Assertion |
|-----------|-------|-----------|
| AC1 — dishA `tapa` sizing | `'compara tapa de croquetas vs tapa de tortilla'` | `dishA.portionSizing.term === 'tapa'`, `gramsMin`/`gramsMax` defined |
| AC2 — dishB `tapa` sizing | `'compara tapa de croquetas vs tapa de tortilla'` | `dishB.portionSizing.term === 'tapa'` |
| AC8 — rejected side hits `nullEstimateData` fallback | `'compara tapa de croquetas vs plato-desconocido-xyz'`, mock throws for the sentinel | `dishA.portionSizing.term === 'tapa'` defined (valid fulfilled leg), `expect(dishB.portionSizing).toBeUndefined()` AND `expect(dishB.portionAssumption).toBeUndefined()` (rejected leg → `nullEstimateData` fallback omits both fields) |
| Control — bocadillo not stripped by F078 | `'compara bocadillo de jamón vs tapa de croquetas'` | `dishA.portionSizing.term === 'bocadillo'` — non-regression guard for non-stripped terms |

**`describe('BUG-PROD-007 — menu path')` — test cases (RED → GREEN):**

| Test name | Input | Assertion |
|-----------|-------|-----------|
| AC6 — both menu items have portionSizing | `'menú del día: tapa de croquetas, media ración de paella'` | `items[0].estimation.portionSizing.term === 'tapa'` AND `items[1].estimation.portionSizing.term === 'media ración'` (F085 PORTION_RULES compound wins longest-first; both items' raw `itemText` reaches `enrichWithPortionSizing`) |
| Control — bocadillo menu item | `'menú del día: bocadillo de jamón, croquetas'` | `items[0].estimation.portionSizing.term === 'bocadillo'` — non-regression control |

##### 3. `cache.test.ts` — NOT EXTENDED

(Original v2 plan extended `cache.test.ts` with an AC12 `buildKey()` assertion. Second cross-model review correctly flagged this as a fake regression guard — the portion-aware composition lives in `estimationOrchestrator.ts`, not in `buildKey()`. AC12 is now a spy test inside `f-ux-b.conversationCore.integration.test.ts` — see file 1, `describe('BUG-PROD-007 — cache key regression guard')` above.)

#### ADR-021 compliance checklist (integration files — files 1 and 2)

- [ ] `processMessage()` called directly — not `estimate()`, `resolvePortionAssumption()`, or `enrichWithPortionSizing()` directly
- [ ] `contextManager` mocked (no real Redis)
- [ ] `lib/cache` mocked (cacheGet returns null, cacheSet is a `vi.fn()` spy — AC12 inspects its `.mock.calls[i][0]` cache key arguments)
- [ ] `engineRouter` (`runEstimationCascade`) mocked (controlled dish fixture; for AC8, throws for the sentinel query)
- [ ] Real `PrismaClient` on test DB (`postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test`)
- [ ] Real Kysely pool on test DB
- [ ] `beforeAll` pre-cleans and seeds fixtures; `afterAll` tears down in foreign-key-safe order
- [ ] Teardown order: `standardPortion → dishNutrient → dish → restaurant → dataSource`
- [ ] Null-result assertions use `toBeUndefined()`, never `toBeNull()` (schema is `.optional()`, not `.nullable()`)
- [ ] AC8 uses a mock that **throws** for the sentinel query, NOT a mock that returns `result: null` (the latter is fulfilled and would not exercise `nullEstimateData`)
- [ ] Comparison tests use the `'compara …'` prefix form (`PREFIX_PATTERNS_COMP` requires it; bare `'X vs Y'` falls through to solo-dish)
- [ ] Menu tests use the `'menú del día: X, Y'` colon+comma form (clean `splitMenuItems` slices)

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

### 1. Change Inventory

Every file this PR touches. No new files are created — all test work is additive extensions inside existing files.

#### Source (production code)

| File | Change |
|------|--------|
| `packages/api/src/conversation/conversationCore.ts` | (a) Add `prisma` + `originalQuery: dishAText` / `originalQuery: dishBText` to both `estimate()` calls in the comparison `Promise.allSettled` block (lines 197–217). (b) Add `prisma` + `originalQuery: itemText` to the `estimate()` call inside `menuItems.map(...)` (lines 270–279). (c) Downgrade `logger.warn` → `logger.debug` at line 353. |

#### Tests (additive — no new files)

| File | New describe blocks added |
|------|--------------------------|
| `packages/api/src/__tests__/f085.conversationCore.integration.test.ts` | `describe('BUG-PROD-007 — comparison path')`, `describe('BUG-PROD-007 — menu path')` |
| `packages/api/src/__tests__/f-ux-b.conversationCore.integration.test.ts` | `describe('BUG-PROD-007 — comparison path')`, `describe('BUG-PROD-007 — menu path')`, `describe('BUG-PROD-007 — solo-path regression guards')`, `describe('BUG-PROD-007 — cache key regression guard')` |

`cache.test.ts` is NOT extended. The original Spec v2 plan placed AC12 there as a `buildKey()` unit test, but the second cross-model review identified that as a fake regression guard (the portion-aware composition lives in `estimationOrchestrator.ts:92-98`, not in `buildKey()`). AC12 is now a `cacheSet` spy test inside the f-ux-b integration file.

#### Documentation

| File | Change |
|------|--------|
| `docs/project_notes/bugs.md` | Add BUG-PROD-007 entry (root cause + prevention) |

---

### 2. Ordered TDD Commit Sequence

Branch: `bugfix/BUG-PROD-007-comparison-menu-wiring`

#### Commit 1 — RED: extend `f085.conversationCore.integration.test.ts`

Add `describe('BUG-PROD-007 — comparison path')` and `describe('BUG-PROD-007 — menu path')` inside the outer describe block. Both comparison and menu call sites are NOT yet patched → `portionSizing` is absent on all new assertions → RED.

**Query forms (CRITICAL — enforced by spec):**
- Comparison tests use `'compara tapa de croquetas vs tapa de tortilla'` etc. Bare `'X vs Y'` does NOT fire the comparison intent; the implementer MUST use the `'compara …'` prefix.
- Menu tests use `'menú del día: tapa de croquetas, media ración de paella'` (colon + comma) for clean `splitMenuItems` slices.
- AC8 uses `'compara tapa de croquetas vs plato-desconocido-xyz'`: the mockCascade is configured to **throw** for any query containing `'plato-desconocido-xyz'` so `Promise.allSettled` captures a `rejected` status and the code builds `nullEstimateData` for the B side.

**New fixture constants** (added at the top of the file, after existing constants):

```
// BUG-PROD-007 extension — ff000000-00ff- prefix (independent from existing fc000000-00fc- fixtures)
const FF_SRC_ID          = 'ff000000-00ff-4000-a000-000000000001';
const FF_REST_ID         = 'ff000000-00ff-4000-a000-000000000002';
const FF_DISH_CROQUETAS  = 'ff000000-00ff-4000-a000-000000000003';
const FF_DN_CROQUETAS    = 'ff000000-00ff-4000-a000-000000000004';
const FF_DISH_TORTILLA   = 'ff000000-00ff-4000-a000-000000000005';
const FF_DN_TORTILLA     = 'ff000000-00ff-4000-a000-000000000006';
const FF_DISH_PAELLA     = 'ff000000-00ff-4000-a000-000000000007';
const FF_DN_PAELLA       = 'ff000000-00ff-4000-a000-000000000008';
const FF_ACTOR_ID        = 'ff000000-00ff-4000-a000-000000000099';
```

**New `beforeAll`/`afterAll` extension** — a second lifecycle pair (`beforeAll(async () => { ... })`) is appended after the existing one. Pre-cleans `FF_*` fixtures and seeds the three dishes.

Teardown order: `standardPortion (FF_*) → dishNutrient (FF_*) → dish (FF_*) → restaurant (FF_REST_ID) → dataSource (FF_SRC_ID)`.

**New cascade mock extension** — `mockCascade` currently uses `.mockImplementation(...)` for the `fc-` fixture set. Extend it to a conditional on the query; see Section 5 for the routing pseudo-code.

**New `buildRequestFF(text)` helper** identical in shape to `buildRequest()` but referencing `FF_*` constants and `chainSlugs: ['ff-conv-core-test']`.

**Test structure:**

```
describe('BUG-PROD-007 — comparison path') {
  it('AC1 — dishA portionSizing tapa',         `compara tapa de croquetas vs tapa de tortilla`)       // RED
  it('AC2 — dishB portionSizing tapa',         `compara tapa de croquetas vs tapa de tortilla`)       // RED
  it('AC8 — rejected side hits nullEstimateData', `compara tapa de croquetas vs plato-desconocido-xyz`) // RED (A side) — mock throws for sentinel
  it('Control — bocadillo comparison not stripped', `compara bocadillo de jamón vs tapa de croquetas`) // already GREEN (bocadillo not in F078)
}

describe('BUG-PROD-007 — menu path') {
  it('AC6 — both menu items have portionSizing defined', `menú del día: tapa de croquetas, media ración de paella`) // RED
  it('Control — bocadillo menu item',                    `menú del día: bocadillo de jamón, croquetas`)              // already GREEN (Control)
}
```

**Verification (RED):**

```
npx vitest run packages/api/src/__tests__/f085.conversationCore.integration.test.ts
```

Expected: all `BUG-PROD-007 —` tests fail; existing `F085 BUG-PROD-006 —` tests still pass.

---

#### Commit 2 — RED: extend `f-ux-b.conversationCore.integration.test.ts`

Add `describe('BUG-PROD-007 — comparison path')`, `describe('BUG-PROD-007 — menu path')`, and `describe('BUG-PROD-007 — portion edge cases (scope ampliado)')` inside the outer describe block of `f-ux-b.conversationCore.integration.test.ts`. Call sites not yet patched → RED.

**New fixture constants** (added after existing `fd-` constants):

```
// BUG-PROD-007 extension — fe000000-00fe- prefix
const FE_SRC_ID          = 'fe000000-00fe-4000-a000-000000000001';
const FE_REST_ID         = 'fe000000-00fe-4000-a000-000000000002';
const FE_DISH_CROQUETAS  = 'fe000000-00fe-4000-a000-000000000003';
const FE_DN_CROQUETAS    = 'fe000000-00fe-4000-a000-000000000004';
const FE_DISH_TORTILLA   = 'fe000000-00fe-4000-a000-000000000005';
const FE_DN_TORTILLA     = 'fe000000-00fe-4000-a000-000000000006';
const FE_DISH_PAELLA     = 'fe000000-00fe-4000-a000-000000000007';
const FE_DN_PAELLA       = 'fe000000-00fe-4000-a000-000000000008';
// standardPortion rows (Prisma uses composite PK dishId+term — no separate UUID needed)
const FE_ACTOR_ID        = 'fe000000-00fe-4000-a000-000000000099';
```

**Fixtures seeded per dish:**

- `FE_DISH_CROQUETAS`: standardPortion rows for `tapa` (50g, 2pc, pieceName: 'croquetas') and `racion` (200g, 8pc)
- `FE_DISH_TORTILLA`: standardPortion row for `tapa` (60g, 1pc, pieceName: 'porción') — distinct grams so test assertions are concrete
- `FE_DISH_PAELLA`: standardPortion row for `racion` (200g, null pieces) — enables Tier 2 `media_racion` × 0.5 = 100g arithmetic

**Second `beforeAll`/`afterAll` lifecycle pair** — same pattern as the existing one for `fd-` fixtures. Teardown: `standardPortion (FE_*) → dishNutrient (FE_*) → dish (FE_*) → restaurant (FE_REST_ID) → dataSource (FE_SRC_ID)`.

**`buildRequestFE(text)` helper** — same shape as existing `buildRequest()`, referencing `FE_*` constants and `chainSlugs: ['fe-conv-core-test']`.

**Test structure:**

```
describe('BUG-PROD-007 — comparison path') {
  it('AC3 — dishA portionAssumption tapa/50g',  `compara tapa de croquetas vs tapa de tortilla`)  // RED
  it('AC4 — dishB portionAssumption tapa/60g',  `compara tapa de croquetas vs tapa de tortilla`)  // RED
  it('AC5 — mixed: pintxo vs racion per side',  `compara pincho de tortilla vs ración de croquetas`)  // RED
}

describe('BUG-PROD-007 — menu path') {
  it('AC7 — both items: tapa + media_racion (Tier 2)', `menú del día: tapa de croquetas, media ración de paella`)  // RED
}

describe('BUG-PROD-007 — solo-path regression guards') {
  it('AC9 — pintxo de croquetas → term=pintxo',            `pintxo de croquetas`)             // GREEN from start
  it('AC10 — pincho de croquetas → term=pintxo (alias)',   `pincho de croquetas`)             // GREEN from start
  it('AC11 — media ración grande → grams=100 (grande drop)', `media ración grande de croquetas`) // GREEN from start
}

describe('BUG-PROD-007 — cache key regression guard') {
  it('AC12 — portion-aware cache key disambiguation', () => {
    // Calls processMessage('tapa de croquetas') then processMessage('croquetas').
    // Both strip to 'croquetas' at the cascade level, but the mocked cacheSet spy
    // must be invoked with two DIFFERENT cache keys thanks to portionKeySuffix.
    // expect(cacheSet.mock.calls[0][0]).not.toBe(cacheSet.mock.calls[1][0]);
    // expect(cacheSet.mock.calls[0][0]).toContain('tapa de croquetas');
  })  // GREEN from start
}
```

**IMPORTANT — GREEN-from-start blocks:** The `solo-path regression guards` and `cache key regression guard` describe blocks assert behaviors that the BUG-PROD-006 fix already established. The solo-dish `estimate()` call at `conversationCore.ts:356-367` already threads `prisma` and `originalQuery: trimmed`; `portionKeySuffix` already exists at `estimationOrchestrator.ts:92-98`. These tests go GREEN immediately on commit. If any of them fail RED at commit time, the implementer MUST stop and investigate — it means a prior regression has sneaked in, and the fix is NOT what this ticket scopes. Do NOT "fix" them by modifying production code in this PR.

**AC9–AC11 use the existing `fd-` fixtures and `buildRequest()`** (solo path), not the new `fe-` fixtures. AC12 uses the `fe-` fixtures and `buildRequestFE()` because it needs the `DISH_CROQUETAS` route on the second (`'croquetas'`) call.

**Verification (RED):**

```
npx vitest run packages/api/src/__tests__/f-ux-b.conversationCore.integration.test.ts
```

Expected: all `BUG-PROD-007 —` tests fail; existing `F-UX-B BUG-PROD-006 —` tests still pass.

---

#### Commit 3 — GREEN: fix comparison path in `conversationCore.ts`

Patch lines 197–217: add `prisma` and per-side `originalQuery` to both `estimate()` calls inside `Promise.allSettled`.

**Key binding rule (see Risk Mitigation):** `dishAText` and `dishBText` are already destructured from `comparison` at line 188. They are the pre-`parseDishExpression` raw slices. Capture them before calling `parseDishExpression` — the current code already does this (`const { dishA: dishAText, dishB: dishBText, ... } = comparison;` at line 188 and `const parsedA = parseDishExpression(dishAText)` at line 190). So `dishAText` / `dishBText` are available in scope at lines 197–217. No new variable is needed.

After this commit, AC1/AC2/AC3/AC4/AC5/AC8 all go GREEN. The comparison-path `describe` blocks in both test files flip from RED to GREEN. AC9/AC10/AC11 (solo-path regression guards) and AC12 (cache key spy) were already GREEN at Commit 2.

**Verification:**

```
npx vitest run packages/api/src/__tests__/f085.conversationCore.integration.test.ts
npx vitest run packages/api/src/__tests__/f-ux-b.conversationCore.integration.test.ts
```

Expected: `describe('BUG-PROD-007 — comparison path')` tests GREEN in both files.

---

#### Commit 4 — GREEN: fix menu path in `conversationCore.ts`

Patch lines 270–279: add `prisma` and `originalQuery: itemText` to the `estimate()` call inside `menuItems.map((itemText) => { ... })`. The `itemText` variable is the map callback parameter — it is the pre-`parseDishExpression` raw item string as returned by `detectMenuQuery` and pre-F078.

After this commit, AC6/AC7 go GREEN. All BUG-PROD-007 ACs are now green.

**Verification:**

```
npx vitest run packages/api/src/__tests__/f085.conversationCore.integration.test.ts
npx vitest run packages/api/src/__tests__/f-ux-b.conversationCore.integration.test.ts
```

Expected: all `BUG-PROD-007 —` describe blocks GREEN in both files. Run full test suite to check no regressions:

```
npx vitest run packages/api/src/__tests__/
```

---

#### Commit 5 — Cleanup: downgrade `logger.warn` → `logger.debug` at line 353

Single-line change in `conversationCore.ts`. After Commits 3 and 4, all three call sites pass `prisma`, so the warn guard can never fire from a legitimate internal call. Downgrading to `logger.debug` eliminates production log noise.

No test required — covered by AC13 (code review).

**Verification:**

```
npx vitest run packages/api/src/__tests__/
```

Expected: all tests still GREEN. Zero test changes in this commit.

---

#### Commit 6 (optional) — Docs: update `bugs.md`

Add BUG-PROD-007 entry to `docs/project_notes/bugs.md` following the same format as BUG-PROD-006 entry. Include root cause summary and prevention note referencing the new describe blocks.

---

### 3. File-by-File Diff Sketches

#### `conversationCore.ts` — Comparison path (Commit 3)

```diff
-    const [resultA, resultB] = await Promise.allSettled([
-      estimate({
-        query: parsedA.query,
-        chainSlug: chainSlugA,
-        portionMultiplier: parsedA.portionMultiplier,
-        db,
-        openAiApiKey,
-        level4Lookup,
-        chainSlugs,
-        logger,
-      }),
-      estimate({
-        query: parsedB.query,
-        chainSlug: chainSlugB,
-        portionMultiplier: parsedB.portionMultiplier,
-        db,
-        openAiApiKey,
-        level4Lookup,
-        chainSlugs,
-        logger,
-      }),
-    ]);
+    const [resultA, resultB] = await Promise.allSettled([
+      estimate({
+        query: parsedA.query,
+        chainSlug: chainSlugA,
+        portionMultiplier: parsedA.portionMultiplier,
+        db,
+        prisma,
+        openAiApiKey,
+        level4Lookup,
+        chainSlugs,
+        logger,
+        originalQuery: dishAText,
+      }),
+      estimate({
+        query: parsedB.query,
+        chainSlug: chainSlugB,
+        portionMultiplier: parsedB.portionMultiplier,
+        db,
+        prisma,
+        openAiApiKey,
+        level4Lookup,
+        chainSlugs,
+        logger,
+        originalQuery: dishBText,
+      }),
+    ]);
```

`dishAText` and `dishBText` are already in scope at this point (line 188 destructures them from `comparison`).

#### `conversationCore.ts` — Menu path (Commit 4)

```diff
-        return estimate({
-          query: parsed.query,
-          chainSlug: chainSlugForItem,
-          portionMultiplier: parsed.portionMultiplier,
-          db,
-          openAiApiKey,
-          level4Lookup,
-          chainSlugs,
-          logger,
-        });
+        return estimate({
+          query: parsed.query,
+          chainSlug: chainSlugForItem,
+          portionMultiplier: parsed.portionMultiplier,
+          db,
+          prisma,
+          openAiApiKey,
+          level4Lookup,
+          chainSlugs,
+          logger,
+          originalQuery: itemText,
+        });
```

`itemText` is the `Array.map` callback parameter on the line above — it is the raw pre-`parseDishExpression` menu item string.

#### `conversationCore.ts` — Logger downgrade (Commit 5)

```diff
-    logger.warn({}, 'BUG-PROD-006: prisma absent from ConversationRequest — portionAssumption will not resolve');
+    logger.debug({}, 'BUG-PROD-006: prisma absent from ConversationRequest — portionAssumption will not resolve');
```

#### `f085.conversationCore.integration.test.ts` — New describe blocks (Commit 1)

Structure appended after the closing brace of `describe('F085 BUG-PROD-006 — portionSizing via processMessage() (ADR-021)')`:

```
// New fixture constants (after existing constants block)
const FF_SRC_ID         = 'ff000000-00ff-4000-a000-000000000001';
const FF_REST_ID        = 'ff000000-00ff-4000-a000-000000000002';
const FF_DISH_CROQUETAS = 'ff000000-00ff-4000-a000-000000000003';
const FF_DN_CROQUETAS   = 'ff000000-00ff-4000-a000-000000000004';
const FF_DISH_TORTILLA  = 'ff000000-00ff-4000-a000-000000000005';
const FF_DN_TORTILLA    = 'ff000000-00ff-4000-a000-000000000006';
const FF_DISH_PAELLA    = 'ff000000-00ff-4000-a000-000000000007';
const FF_DN_PAELLA      = 'ff000000-00ff-4000-a000-000000000008';
const FF_ACTOR_ID       = 'ff000000-00ff-4000-a000-000000000099';

// Second lifecycle pair for FF_* fixtures
beforeAll(async () => {
  // extend mockCascade to also route FF_* queries (see Section 5)
  // cleanFixtures for FF_* (pre-clean)
  // seed: FF_SRC_ID, FF_REST_ID, FF_DISH_CROQUETAS (+dishNutrient),
  //       FF_DISH_TORTILLA (+dishNutrient), FF_DISH_PAELLA (+dishNutrient)
  // Note: no standardPortion rows for F085 — portionSizing uses static lookup table
});
afterAll(async () => {
  // teardown FF_* in FK-safe order
  // await prisma.$disconnect() and await pool.end() already called by first afterAll
  // so only delete the data here, NOT disconnect
});

function buildRequestFF(text: string): ConversationRequest {
  // Same shape as buildRequest() but referencing FF_* actor and chainSlugs
}

describe('BUG-PROD-007 — comparison path') {
  it('AC1 — dishA portionSizing tapa',       runs `compara tapa de croquetas vs tapa de tortilla`) { ... }
  it('AC2 — dishB portionSizing tapa',       runs `compara tapa de croquetas vs tapa de tortilla`) { ... }
  it('AC8 — rejected-side nullEstimateData', runs `compara tapa de croquetas vs plato-desconocido-xyz`; mockCascade throws for sentinel) { ... }
  it('Control — bocadillo not stripped by F078', runs `compara bocadillo de jamón vs tapa de croquetas`) { ... }
}

describe('BUG-PROD-007 — menu path') {
  it('AC6 — both menu items have portionSizing', runs `menú del día: tapa de croquetas, media ración de paella`) { ... }
  it('Control — bocadillo menu item',            runs `menú del día: bocadillo de jamón, croquetas`) { ... }
}
```

Important: since `prisma.$disconnect()` and `pool.end()` are already called in the first `afterAll`, the second `afterAll` must only delete the FF_* rows — it must NOT call disconnect/end again. The implementer should restructure teardown so `$disconnect` and `pool.end` are called only once (e.g., via a module-level `afterAll` at the outer scope of the file, outside both describe blocks).

#### `f-ux-b.conversationCore.integration.test.ts` — New describe blocks (Commit 2)

Same structural pattern as above but using `FE_*` prefix constants. The `FE_DISH_CROQUETAS` fixture requires standardPortion rows for `tapa` (50g/2pc) and `racion` (200g/8pc); `FE_DISH_TORTILLA` requires `tapa` (60g/1pc); `FE_DISH_PAELLA` requires `racion` (200g/null pieces).

---

### 4. Fixture Plan

#### `f085.conversationCore.integration.test.ts` — FF prefix (`ff000000-00ff-4000-a000-{seq}`)

| Constant | UUID | Purpose |
|----------|------|---------|
| `FF_SRC_ID` | `ff000000-00ff-4000-a000-000000000001` | dataSource for FF fixtures |
| `FF_REST_ID` | `ff000000-00ff-4000-a000-000000000002` | restaurant, chainSlug: `ff-conv-core-test` |
| `FF_DISH_CROQUETAS` | `ff000000-00ff-4000-a000-000000000003` | dish name: 'Croquetas de jamón' |
| `FF_DN_CROQUETAS` | `ff000000-00ff-4000-a000-000000000004` | dishNutrient for FF_DISH_CROQUETAS |
| `FF_DISH_TORTILLA` | `ff000000-00ff-4000-a000-000000000005` | dish name: 'Tortilla española' |
| `FF_DN_TORTILLA` | `ff000000-00ff-4000-a000-000000000006` | dishNutrient for FF_DISH_TORTILLA |
| `FF_DISH_PAELLA` | `ff000000-00ff-4000-a000-000000000007` | dish name: 'Paella valenciana' |
| `FF_DN_PAELLA` | `ff000000-00ff-4000-a000-000000000008` | dishNutrient for FF_DISH_PAELLA |
| `FF_ACTOR_ID` | `ff000000-00ff-4000-a000-000000000099` | actorId for buildRequestFF |

No standardPortion rows for F085 file (portionSizing uses a static lookup — DB rows not needed).

#### `f-ux-b.conversationCore.integration.test.ts` — FE prefix (`fe000000-00fe-4000-a000-{seq}`)

| Constant | UUID | Purpose |
|----------|------|---------|
| `FE_SRC_ID` | `fe000000-00fe-4000-a000-000000000001` | dataSource |
| `FE_REST_ID` | `fe000000-00fe-4000-a000-000000000002` | restaurant, chainSlug: `fe-conv-core-test` |
| `FE_DISH_CROQUETAS` | `fe000000-00fe-4000-a000-000000000003` | dish: 'Croquetas de jamón' |
| `FE_DN_CROQUETAS` | `fe000000-00fe-4000-a000-000000000004` | dishNutrient |
| `FE_DISH_TORTILLA` | `fe000000-00fe-4000-a000-000000000005` | dish: 'Tortilla española' |
| `FE_DN_TORTILLA` | `fe000000-00fe-4000-a000-000000000006` | dishNutrient |
| `FE_DISH_PAELLA` | `fe000000-00fe-4000-a000-000000000007` | dish: 'Paella valenciana' |
| `FE_DN_PAELLA` | `fe000000-00fe-4000-a000-000000000008` | dishNutrient |
| `FE_ACTOR_ID` | `fe000000-00fe-4000-a000-000000000099` | actorId |

**standardPortion rows** (composite PK `dishId + term` — no separate UUID):

| dishId | term | grams | pieces | pieceName | notes |
|--------|------|-------|--------|-----------|-------|
| FE_DISH_CROQUETAS | `tapa` | 50 | 2 | `'croquetas'` | BUG-PROD-007 fixture |
| FE_DISH_CROQUETAS | `racion` | 200 | 8 | `'croquetas'` | BUG-PROD-007 fixture |
| FE_DISH_TORTILLA | `tapa` | 60 | 1 | `'porción'` | BUG-PROD-007 fixture; distinct grams for concrete assertion |
| FE_DISH_PAELLA | `racion` | 200 | null | null | BUG-PROD-007 fixture; Tier 2 media_racion × 0.5 = 100g |

---

### 5. Cascade Mock Strategy

Both test files use `mockCascade` (hoisted `vi.fn()`). The existing implementations route by `q.includes('croqueta')`. The BUG-PROD-007 describe blocks need to route by multiple dish names.

The existing `mockCascade.mockImplementation(...)` call in the first `beforeAll` should be replaced (or the second `beforeAll` should call `mockCascade.mockImplementation(...)` again to override) with a multi-dish router:

```typescript
// For f085.conversationCore.integration.test.ts (FF prefix fixtures):
const UNKNOWN_SENTINEL = 'plato-desconocido-xyz';

mockCascade.mockImplementation(async (opts: { query: string }) => {
  const q = opts.query.toLowerCase();

  // AC8 — force rejection for sentinel so Promise.allSettled captures 'rejected'
  // and the comparison code builds nullEstimateData for this side.
  if (q.includes(UNKNOWN_SENTINEL)) {
    throw new Error(`mockCascade: no match for sentinel ${UNKNOWN_SENTINEL}`);
  }

  let entityId: string | null = null;
  let name: string = '';
  let chainSlug: string = 'ff-conv-core-test';

  if (q.includes('croqueta') || q.includes('bocadillo') || q.includes('jamón') || q.includes('jamon')) {
    entityId = FF_DISH_CROQUETAS;
    name = 'Croquetas de jamón';
  } else if (q.includes('tortilla')) {
    entityId = FF_DISH_TORTILLA;
    name = 'Tortilla española';
  } else if (q.includes('paella')) {
    entityId = FF_DISH_PAELLA;
    name = 'Paella valenciana';
  }

  if (entityId !== null) {
    return { levelHit: 1, data: { query: opts.query, chainSlug: null, level1Hit: true,
      level2Hit: false, level3Hit: false, level4Hit: false, matchType: 'exact_dish',
      result: makeDishResultFF(entityId, name, chainSlug, FF_REST_ID, FF_SRC_ID),
      cachedAt: null, yieldAdjustment: null } };
  }
  // fulfilled-miss: legitimate "no dish found" — NOT the AC8 path
  return { levelHit: null, data: { query: opts.query, chainSlug: null,
    level1Hit: false, level2Hit: false, level3Hit: false, level4Hit: false,
    matchType: null, result: null, cachedAt: null } };
});
```

Identical pattern for the `fe-` file, substituting `FE_*` constants.

**Critical AC8 distinction:** the cascade has TWO miss modes. (1) `throw` → the `estimate()` promise rejects → `Promise.allSettled` captures `rejected` status → `conversationCore.ts:226-237` builds `nullEstimateData` (omits `portionSizing`/`portionAssumption`). (2) `return { result: null, ... }` → `estimate()` fulfills with a normal `EstimateData` where `result === null`; the comparison code assigns that fulfilled value directly to `dishA`/`dishB`, and `enrichWithPortionSizing` still runs at `estimationOrchestrator.ts:160` populating `portionSizing` from `originalQuery`. **AC8 requires mode (1)** — the mock MUST throw for the sentinel, NOT return `result: null`.

**Routing stability:** the cascade receives the POST-`parseDishExpression` stripped query (e.g., `'croquetas'` for `'tapa de croquetas'`). The routing keys (`q.includes('croqueta')`, `q.includes('tortilla')`, `q.includes('paella')`) are stable — F078 stripping does not remove the dish noun.

---

### 6. Assertions Appendix

For every AC, the exact `expect(...)` form. `toBeUndefined()` is used for absent optional fields — `toBeNull()` is never used on `portionSizing` or `portionAssumption`.

| AC | Test file | Query | `expect(...)` |
|----|-----------|-------|---------------|
| AC1 | f085 → comparison path | `compara tapa de croquetas vs tapa de tortilla` | `expect(result.comparison?.dishA.portionSizing).toBeDefined(); expect(result.comparison?.dishA.portionSizing?.term).toBe('tapa');` |
| AC2 | f085 → comparison path | `compara tapa de croquetas vs tapa de tortilla` | `expect(result.comparison?.dishB.portionSizing).toBeDefined(); expect(result.comparison?.dishB.portionSizing?.term).toBe('tapa');` |
| AC3 | f-ux-b → comparison path | `compara tapa de croquetas vs tapa de tortilla` | `expect(result.comparison?.dishA.portionAssumption?.source).toBe('per_dish'); expect(result.comparison?.dishA.portionAssumption?.term).toBe('tapa'); expect(result.comparison?.dishA.portionAssumption?.grams).toBe(50);` |
| AC4 | f-ux-b → comparison path | `compara tapa de croquetas vs tapa de tortilla` | `expect(result.comparison?.dishB.portionAssumption?.source).toBe('per_dish'); expect(result.comparison?.dishB.portionAssumption?.term).toBe('tapa'); expect(result.comparison?.dishB.portionAssumption?.grams).toBe(60);` |
| AC5 | f-ux-b → comparison path | `compara pincho de tortilla vs ración de croquetas` | `expect(result.comparison?.dishA.portionAssumption?.term).toBe('pintxo'); expect(result.comparison?.dishB.portionAssumption?.term).toBe('racion');` |
| AC6 | f085 → menu path | `menú del día: tapa de croquetas, media ración de paella` | `expect(items[0].estimation.portionSizing?.term).toBe('tapa'); expect(items[1].estimation.portionSizing?.term).toBe('media ración');` (PORTION_RULES compound entry wins longest-first) |
| AC7 | f-ux-b → menu path | `menú del día: tapa de croquetas, media ración de paella` | `expect(items[0].estimation.portionAssumption?.term).toBe('tapa'); expect(items[1].estimation.portionAssumption?.term).toBe('media_racion'); expect(items[1].estimation.portionAssumption?.grams).toBe(100);` |
| AC8 | f085 → comparison path | `compara tapa de croquetas vs plato-desconocido-xyz` (mock throws for sentinel → dishB leg `rejected`) | `expect(result.comparison?.dishA.portionSizing?.term).toBe('tapa'); expect(result.comparison?.dishB.portionSizing).toBeUndefined(); expect(result.comparison?.dishB.portionAssumption).toBeUndefined();` |
| AC9 | f-ux-b → solo-path regression guards | `pintxo de croquetas` (uses `fd-` fixtures / `buildRequest()`) | `expect(result.estimation?.portionAssumption?.term).toBe('pintxo');` — GREEN from start |
| AC10 | f-ux-b → solo-path regression guards | `pincho de croquetas` | `expect(result.estimation?.portionAssumption?.term).toBe('pintxo');` — GREEN from start |
| AC11 | f-ux-b → solo-path regression guards | `media ración grande de croquetas` | `expect(result.estimation?.portionAssumption?.grams).toBe(100);` — GREEN from start |
| AC12 | f-ux-b → cache key regression guard | `tapa de croquetas` then `croquetas` (sequential, same test) | Spy on mocked `cacheSet`. `expect(cacheSet).toHaveBeenCalledTimes(2); expect(cacheSet.mock.calls[0][0]).not.toBe(cacheSet.mock.calls[1][0]); expect(cacheSet.mock.calls[0][0]).toContain('tapa de croquetas'); expect(cacheSet.mock.calls[1][0]).not.toContain('tapa de croquetas');` — GREEN from start |
| AC13 | Code review | n/a | Line 353 reads `logger.debug(` — no `logger.warn` for this guard |

---

### 7. Risk Mitigation

#### Per-side `originalQuery` binding — comparison path

**Risk:** Passing `parsedA.query` (the F078-stripped value) as `originalQuery` instead of the raw slice.

**Analysis of current code:**

```typescript
// Line 188 in conversationCore.ts
const { dishA: dishAText, dishB: dishBText, nutrientFocus } = comparison;

// Lines 190–191
const parsedA = parseDishExpression(dishAText);  // returns { query: 'croquetas', portionMultiplier: 1, ... }
const parsedB = parseDishExpression(dishBText);  // returns { query: 'tortilla', portionMultiplier: 1, ... }
```

`parseDishExpression` strips F078 patterns internally (line 320 in entityExtractor.ts) and does NOT return the raw input text — its return type is `{ query: string; chainSlug?: string; portionMultiplier: number }`. The raw slices `dishAText` and `dishBText` are destructured at line 188 and remain in scope throughout the comparison block.

**Binding rule:** `originalQuery: dishAText` / `originalQuery: dishBText`. These are the values the implementer must pass. They must NOT pass `parsedA.query` / `parsedB.query`, which are post-F078 stripped.

**Verification:** After Commit 4, the test `AC3: dishA portionAssumption tapa/50g` green-lights this binding. If the implementer accidentally passes `parsedA.query`, `detectPortionTerm('croquetas')` returns null → `portionAssumption` undefined → AC3 fails.

#### Per-item `originalQuery` binding — menu path

**Risk:** Passing `parsed.query` (stripped) instead of `itemText`.

**Analysis of current code:**

```typescript
// Lines 266–279 in conversationCore.ts
menuItems.map((itemText) => {
  const parsed = parseDishExpression(itemText);
  ...
  return estimate({
    query: parsed.query,   // ← stripped
    ...
    // originalQuery NOT PRESENT (Bug 2 — what we are fixing)
  });
})
```

`itemText` is the map callback parameter — it is the raw string from `detectMenuQuery`'s return array (e.g., `'tapa de croquetas'`, `'media ración de paella'`). These strings are pre-`parseDishExpression` and preserve F078 prefixes.

**Binding rule:** `originalQuery: itemText`. This is the correct value.

#### `nullEstimateData` fields — must remain absent (not null)

The inline `nullEstimateData` objects at lines 226–237 (comparison) and lines 296–308 (menu) do NOT include `portionSizing` or `portionAssumption`. This is correct per `EstimateDataSchema.portionSizing: z.optional()` (line 297 in estimate.ts). The fix must not add these fields to `nullEstimateData`. Tests assert `toBeUndefined()` — if fields were set to `null`, the schema would reject the payload.

#### Second `beforeAll`/`afterAll` lifecycle — disconnect ordering

Both test files have an existing `afterAll` that calls `await prisma.$disconnect()` and `await pool.end()`. A naively appended second `afterAll` that also calls disconnect would cause `Error: Cannot use a disconnected client` in the first `afterAll`'s data teardown.

**Solution:** Restructure each test file so `$disconnect` and `pool.end()` are called in a single module-level `afterAll` (outside all `describe` blocks), after the data teardown for both fixture sets completes. The implementer must be careful to restructure the first `afterAll` when extending these files — it should perform only data cleanup, and the final `$disconnect` / `pool.end()` should be in a dedicated outer `afterAll`.

---

### 8. Rollback Plan

Each commit is independently revertable. The commit ordering supports clean `git revert` because:

- Commits 1–3 add tests only — reverting them removes test coverage without touching production code.
- Commits 4–5 are independent production-code patches to two separate code blocks. Either can be reverted alone without breaking the other.
- Commit 6 is a single-line logger change — trivially revertable.
- Commit 7 (docs) is documentation-only — revertable with no functional consequence.

Rollback order if the entire PR must be reverted: revert in reverse commit order (7 → 1) to avoid any state where tests exist but the code fix doesn't.

---

### 9. Verification Commands

| After commit | Command | Expected result |
|-------------|---------|-----------------|
| Commit 1 (f085 RED) | `npx vitest run packages/api/src/__tests__/f085.conversationCore.integration.test.ts` | `BUG-PROD-007 — comparison/menu path` tests RED; existing `F085 BUG-PROD-006 —` tests GREEN |
| Commit 2 (f-ux-b RED + GREEN-from-start guards) | `npx vitest run packages/api/src/__tests__/f-ux-b.conversationCore.integration.test.ts` | `comparison path` + `menu path` tests RED; `solo-path regression guards` and `cache key regression guard` tests GREEN; existing `F-UX-B BUG-PROD-006 —` tests GREEN |
| Commit 3 (comparison fix) | `npx vitest run packages/api/src/__tests__/f085.conversationCore.integration.test.ts packages/api/src/__tests__/f-ux-b.conversationCore.integration.test.ts` | `BUG-PROD-007 — comparison path` blocks GREEN in both files; menu tests still RED |
| Commit 4 (menu fix) | `npx vitest run packages/api/src/__tests__/f085.conversationCore.integration.test.ts packages/api/src/__tests__/f-ux-b.conversationCore.integration.test.ts` | All `BUG-PROD-007 —` describe blocks GREEN in both files |
| Commit 5 (logger) | `npx vitest run packages/api/src/__tests__/` | Full test suite GREEN; no new failures |
| Final check | `npx vitest run packages/api` | All 3270+ api tests GREEN; no regressions on BUG-PROD-006 solo-dish tests |

---

### 10. Out of Scope Reminder

The following are explicitly excluded from this PR (per spec):

- Solo-dish path (`conversationCore.ts` Step 4) — already fixed by BUG-PROD-006; do not touch
- F042 compound logic (`extractPortionModifier`) — `'grande'` silent-drop is accepted behavior, tracked separately as `BUG-F042-COMPOSE-SIZE-MODIFIERS`
- Any refactor of `conversationCore.ts` beyond the two `estimate()` call sites and the `logger.warn` → `logger.debug` downgrade
- Schema changes, Prisma migrations, new dependencies
- Frontend changes
- `engineRouter`, `estimationOrchestrator`, or `portionAssumption.ts` — no changes needed; orchestrator already handles `prisma` and `originalQuery` correctly after BUG-PROD-006
- `EstimateDataSchema` contract — do not add `portionSizing`/`portionAssumption` to `nullEstimateData`; do not change field optionality

---

### Open Questions for Spec Author

**None.** All spec ambiguities were resolved in v2 (Codex arbitration). The four Codex findings (test file naming, AC12 placement, menu query consistency, null-result contract) are all reflected in the plan above. No further spec-author input required before implementation begins.

---

## Workflow Checklist

- [x] **Step 0 — Triage & Branch.** Standard tier confirmed, `bugfix/BUG-PROD-007-comparison-menu-wiring` created from `develop`
- [x] **Step 1 — Spec.** v1 drafted by spec-creator, revised through v3 after two cross-model rounds
- [x] **Step 2 — Spec review.** Gemini APPROVED + Codex REVISE 4 IMPORTANT → Spec v2; second round: Gemini APPROVED + Codex REVISE 1 CRITICAL + 3 IMPORTANT + 1 SUGGESTION → Spec v3
- [x] **Step 3 — Plan.** v1 drafted by backend-planner, revised to v2 after plan review (same divergence: Codex found 5 empirical bugs Gemini missed)
- [x] **Step 4 — Implementation (TDD).** 6 commits (2 RED test, 2 GREEN fix, 1 chore logger, 1 docs bugs.md). 26/26 BUG-PROD-007 integration tests GREEN. Solo-path regression guards + cache-key spy GREEN from start (committed inside commit 2).
- [x] **Step 5 — Code review + QA.** code-review-specialist APPROVE + 3 NITs (2 addressed inline). qa-engineer PASS WITH FOLLOW-UPS + 1 IMPORTANT (AC8 sentinel hardened inline so the `toBeUndefined()` guard exclusively exercises the `nullEstimateData` branch).
- [x] **Step 5.1 — PR opened.** PR #120 to `develop`, CI `ci-success` PASS, `test-api` PASS (3m58s), Vercel preview deployed, mergeStateStatus CLEAN
- [x] **Step 6 — Merge.** Squash-merged to `develop` at `aab85f0` (PR #120, 2026-04-14). Branch deleted post-merge (neither local nor remote reference present as of 2026-04-16 audit). Tracker + bugs.md synced inline in the same squash commit (`docs/project_notes/product-tracker.md` Active Session + Pipeline Complete list, `docs/project_notes/bugs.md` entry at line 876). Post-merge ticket finalize handled in tracker-sync PR `chore/tracker-sync-bug-prod-007-finalize`.

---

## Acceptance Criteria

All 13 ACs defined in the Spec table are verified by the 26 BUG-PROD-007 tests in `packages/api/src/__tests__/f085.conversationCore.integration.test.ts` (11) and `packages/api/src/__tests__/f-ux-b.conversationCore.integration.test.ts` (15).

- [x] **AC1** — `compara tapa de croquetas vs tapa de tortilla` → `dishA.portionSizing.term === 'tapa'` (f085)
- [x] **AC2** — same query → `dishB.portionSizing.term === 'tapa'` (f085)
- [x] **AC3** — same query → `dishA.portionAssumption.source === 'per_dish'`, `term === 'tapa'`, `grams === 50` (f-ux-b)
- [x] **AC4** — same query → `dishB.portionAssumption.source === 'per_dish'`, `term === 'tapa'`, `grams === 60` (f-ux-b)
- [x] **AC5** — `compara pincho de tortilla vs ración de croquetas` → `dishA.portionAssumption.term === 'pintxo'`, `dishB.portionAssumption.term === 'racion'` (f-ux-b)
- [x] **AC6** — `menú del día: tapa de croquetas, media ración de paella` → `items[0].portionSizing.term === 'tapa'`, `items[1].portionSizing.term === 'media ración'` (PORTION_RULES compound wins longest-first) (f085)
- [x] **AC7** — same menu query → `items[0].portionAssumption.term === 'tapa'`, `items[1].portionAssumption.term === 'media_racion'`, `grams === 100` (Tier 2 against paella's `racion` 200g × 0.5) (f-ux-b)
- [x] **AC8** — `compara tapa de croquetas vs tapa de plato-desconocido-xyz` (mock throws for sentinel) → dishA portionSizing defined, dishB portionSizing + portionAssumption `toBeUndefined()`. Hardened after QA to exclusively exercise the `nullEstimateData` branch (sentinel slice contains `'tapa'` so fulfilled-miss path would populate portionSizing, failing the assertion) (f085)
- [x] **AC9** — `pintxo de croquetas` (solo-path regression guard, GREEN from start) → `portionAssumption.term === 'pintxo'` (f-ux-b)
- [x] **AC10** — `pincho de croquetas` (solo-path regression guard, GREEN from start) → `portionAssumption.term === 'pintxo'` (alias → canonical) (f-ux-b)
- [x] **AC11** — `media ración grande de croquetas` (solo-path regression guard, GREEN from start) → `portionAssumption.grams === 100` (F042 compound wins, `'grande'` dropped) (f-ux-b)
- [x] **AC12** — `processMessage('tapa de croquetas')` then `processMessage('croquetas')` → `mockCacheSet` spy called twice with distinct cache keys; first contains `'tapa de croquetas'`, second does not. Genuine regression guard exercising `estimationOrchestrator.ts:92-98` `portionKeySuffix` logic end-to-end (f-ux-b)
- [x] **AC13** — `conversationCore.ts:359` now reads `logger.debug(` — verified manually + git diff

---

## Definition of Done

- [x] All 13 ACs implemented and verified by automated tests (26/26 GREEN)
- [x] Production code changes are minimal and surgical (8 lines in `conversationCore.ts`, 3 call sites + 1 logger level)
- [x] No changes to `estimationOrchestrator.ts`, `portionAssumption.ts`, Zod schemas, Prisma migrations, or `nullEstimateData` shape
- [x] No regressions on existing BUG-PROD-006 tests (f-ux-b + f085 integration, unit tests, route tests — all green)
- [x] TDD commit granularity respected: RED commits precede GREEN commits, each commit is independently revertable
- [x] Two rounds of cross-model spec + plan review, all findings arbitrated and addressed
- [x] code-review-specialist APPROVE (3 NITs, 2 addressed inline)
- [x] qa-engineer PASS WITH FOLLOW-UPS (1 IMPORTANT AC8 hardening addressed inline)
- [x] `docs/project_notes/bugs.md` updated with BUG-PROD-007 entry (root cause per call site + prevention)
- [x] `docs/project_notes/product-tracker.md` Active Session refreshed to reflect current workflow step
- [x] PR opened to `develop` with full review trail in description
- [x] CI `ci-success` + `test-api` checks green on PR #120
- [x] Merge Checklist Evidence filled with empirical evidence per row

---

## Merge Checklist Evidence

| Check | Evidence |
|-------|----------|
| Branch builds clean | `npx vitest run packages/api/src/__tests__/f085.conversationCore.integration.test.ts packages/api/src/__tests__/f-ux-b.conversationCore.integration.test.ts` → 26/26 passed, 510ms. CI `test-api` ran the full API suite in 3m58s and PASSed on PR #120. |
| All tests pass (unit + integration) | PR #120 CI `test-api` PASS (runs full api workspace: unit + integration for packages/api). 2 extended integration files locally verified 26/26. No regressions on BUG-PROD-006 tests (f-ux-b, f085, estimateRoute, portionAssumption unit, orchestrator unit — all green per QA sweep). |
| Extended integration describe blocks RED before fix, GREEN after | Commit sequence on branch: `3104efd` (test RED f085), `0b32002` (test RED f-ux-b + GREEN regression guards for AC9/10/11/12), `1c09bb3` (fix comparison → AC1/2/3/4/5/8 GREEN), `c84cb86` (fix menu → AC6/7 GREEN). Each commit is revertable and CI could run per-commit. |
| `logger.warn` downgraded to `logger.debug` at line 353 | Commit `ad5e633`. Verified: `conversationCore.ts:359` now reads `logger.debug({}, 'BUG-PROD-006: prisma absent from ConversationRequest — portionAssumption will not resolve');`. Unreachable from any internal call site after the fix; retained as low-noise documentation. |
| AC9–AC12 scope ampliado verified | `describe('BUG-PROD-007 — solo-path regression guards')` and `describe('BUG-PROD-007 — cache key regression guard')` in `f-ux-b.conversationCore.integration.test.ts`. GREEN from Commit 2 onward. AC12 spy verifies `mockCacheSet.mock.calls[0][0]` contains `'tapa de croquetas'` while `mock.calls[1][0]` does not — exercises `estimationOrchestrator.ts:92-98` end-to-end. |
| No regressions on solo-dish path (BUG-PROD-006 tests still green) | Existing `F085 BUG-PROD-006 —` and `F-UX-B BUG-PROD-006 —` describe blocks continue to pass (part of the 26/26). QA engineer also ran `f-ux-b.estimateRoute.portionAssumption.integration.test.ts` (9/9), `f-ux-b.portionAssumption.unit.test.ts` (15), `f-ux-b.portionAssumption.edge-cases.test.ts` (8), `f070.estimationOrchestrator.unit.test.ts` (12), `f085.portion-sizing.unit.test.ts` (26), `f070.conversationCore.unit.test.ts` (17), `f070.entityExtractor.unit.test.ts` (41) — all green. |
| PR description references BUG-PROD-007 | PR #120 title: `fix(BUG-PROD-007): wire prisma + originalQuery into comparison and menu estimate() call sites`. Body includes full review trail, test plan checklist, and file inventory. |
| `ci-success` check passes | `gh pr view 120 --json statusCheckRollup` shows `ci-success: SUCCESS`, `test-api: SUCCESS`, `test-bot/landing/scraper/shared/web: SKIPPED` (path filters correct), `Vercel: SUCCESS`, `Vercel Preview Comments: SUCCESS`, `changes: SUCCESS`. `mergeStateStatus: CLEAN`, `mergeable: MERGEABLE`. |

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

### Plan review — 2026-04-14 (Round 2)

- **Reviewers:** Gemini 2.5 (APPROVED, 12 files read) + Codex GPT-5.4 (REVISE, 1 CRITICAL + 3 IMPORTANT + 1 SUGGESTION — empirically cited)
- **Divergence reason:** Gemini performed a shallow structural walk-through and approved; Codex verified runtime semantics (regex prefix requirements, Promise.allSettled `rejected` vs fulfilled-miss, `buildKey` composition location, solo-dish wiring state on HEAD). Codex's findings proved the plan would either not fire the targeted code paths or test fake guards. Arbitration: adopt all 5 Codex findings.
- **Findings addressed (Spec v3 + Plan v2):**
  1. **CRITICAL — bare comparison queries fall through.** `PREFIX_PATTERNS_COMP` at `entityExtractor.ts:216-231` requires one of `qué tiene más/menos X`, `qué engorda más`, `qué es más sano`, `compara[r]`. Bare `'tapa de croquetas vs tapa de tortilla'` returns `null` from `extractComparisonQuery` and falls through to solo-dish. Fix: all AC1–AC5 and AC8 tests now use the `'compara …'` prefix form; symptom table + test structure + assertion appendix updated.
  2. **IMPORTANT — AC8 targeted the wrong branch.** `nullEstimateData` is only built on `Promise.allSettled` `rejected` status. A mock returning `result: null` is *fulfilled*, so the plan never exercised `nullEstimateData`; worse, `enrichWithPortionSizing` still runs on a fulfilled-miss, so `portionSizing` would be *defined* on that side — making the assertion backwards. Fix: introduced sentinel `'plato-desconocido-xyz'`; the cascade mock is configured to `throw` for any query containing the sentinel, forcing `rejected` status and exercising the true `nullEstimateData` path.
  3. **IMPORTANT — AC12 was a fake regression guard.** `buildKey()` at `cache.ts:27-33` only formats `fxp:<entity>:<id>`; the `portionKeySuffix` composition lives at `estimationOrchestrator.ts:92-98`. A unit test on `buildKey()` alone would stay green even if the orchestrator stopped appending the suffix. Fix: AC12 is now an integration-level test inside `f-ux-b.conversationCore.integration.test.ts` that spies on the mocked `lib/cache.cacheSet` and asserts two sequential `processMessage()` calls produce two distinct cache keys. `cache.test.ts` is untouched.
  4. **IMPORTANT — AC9/AC10/AC11 sequencing.** Solo-dish path at `conversationCore.ts:356-367` already passes `originalQuery: trimmed` (BUG-PROD-006). Tests for `pintxo`/`pincho` canonicalization and `'media ración grande…'` are already GREEN on HEAD — they can't be RED→GREEN through comparison/menu commits. Fix: reclassified as regression guards in a new `describe('BUG-PROD-007 — solo-path regression guards')` block. They must be GREEN the moment they are committed; a RED result signals a prior regression, not work this ticket should fix.
  5. **SUGGESTION — menu query form.** `'menú del día con X y Y'` produces item[0] = `'con X'` because the `con` is not a menu separator. Fix: all BUG-PROD-007 menu tests use the colon+comma form `'menú del día: tapa de croquetas, media ración de paella'`, which `MENU_PATTERNS` splits into clean raw slices via `splitMenuItems`.
- **Plan restructuring:**
  - Commit sequence collapsed from 7 to 6 commits (old Commit 3 `cache.test.ts` removed; AC12 moved to Commit 2 inside the f-ux-b integration extension).
  - Commit 2 now contains the two GREEN-from-start regression guard blocks alongside the RED comparison/menu blocks.
  - `cascade mock` strategy documents the `throw` branch for AC8 sentinel.
  - Verification commands updated to reflect the new commit ordering.
- **Result:** 5/5 findings addressed. Spec v3 + Plan v2 ready for implementation.

### Implementation — 2026-04-14

- **Agent:** backend-developer (delegated)
- **Branch:** `bugfix/BUG-PROD-007-comparison-menu-wiring`
- **Commits (6, per the Plan v2 sequence):**
  1. `3104efd` — `test(BUG-PROD-007)`: extend f085 integration with comparison + menu RED cases
  2. `0b32002` — `test(BUG-PROD-007)`: extend f-ux-b integration with comparison/menu RED + solo-path/cache-key regression GREEN blocks
  3. `1c09bb3` — `fix(BUG-PROD-007)`: wire prisma + per-side originalQuery into comparison path
  4. `c84cb86` — `fix(BUG-PROD-007)`: wire prisma + per-item originalQuery into menu path
  5. `ad5e633` — `chore(BUG-PROD-007)`: downgrade logger.warn → logger.debug
  6. `5f6ec8e` — `docs(BUG-PROD-007)`: add BUG-PROD-007 entry to bugs.md
- **Production diff:** 8 lines in `conversationCore.ts` across 4 edit points (2 × comparison `estimate()` calls, 1 × menu `estimate()` call, 1 × logger level). Zero refactors. Zero schema changes. Zero new files.
- **Test diff:** +340 lines in `f-ux-b.conversationCore.integration.test.ts`, +293 lines in `f085.conversationCore.integration.test.ts`. Extensions only — existing BUG-PROD-006 describe blocks untouched.
- **Deviation from plan:** 1 item. AC6 spec originally expected `items[1].portionSizing.term === 'ración'` for `'media ración de paella'`. Empirical read of `PORTION_RULES` at `estimation/portionSizing.ts:42` showed `'media ración'` as a compound entry matched longest-first, so the actual term is `'media ración'`. The implementer asserted the correct value and flagged the deviation; the spec was updated in commit `98aecd8` to match reality. F-UX-B's parallel canonicalization (`portionAssumption.term === 'media_racion'` in Tier 2) agrees that `'media ración'` is a distinct term from `'ración'` — no deeper consistency issue.
- **Result:** 6 commits, all 26 BUG-PROD-007 tests GREEN (11 f085 + 15 f-ux-b).

### Code review — 2026-04-14

- **Agent:** code-review-specialist (delegated)
- **Verdict:** APPROVE — ready for QA and PR
- **Findings:** 0 BLOCKERS, 0 IMPORTANT, 3 NITs
  1. **[NIT]** The BUG-PROD-007 `beforeAll` in f085 silently overrides `mockCascade` for the FC describe block above. FC tests still pass because they only assert on F085 static-lookup fields (independent of returned entity), but this is fragile if a future FC test asserts on `entityId`/`restaurantId`. Addressed inline in commit `7dfa0e5` with an explanatory comment.
  2. **[NIT]** The `mockCacheSet.mockClear()` in the AC12 test is load-bearing — the spy accumulates calls across the whole file, and removing the clear would break `toHaveBeenCalledTimes(2)`. Addressed inline in commit `7dfa0e5` with a "mandatory, load-bearing" comment.
  3. **[NIT]** `logger.debug` downgrade is correct as implemented — the warn guard is now structurally unreachable from any internal call site, and integration tests cover all three paths. No code change needed; comment-only documentation already present in the guard.
- **Regression check:** 26/26 green locally, no existing BUG-PROD-006 tests affected.
- **Commit:** `7dfa0e5` (NIT comments)

### QA — 2026-04-14

- **Agent:** qa-engineer (delegated)
- **Verdict:** PASS WITH FOLLOW-UPS
- **Findings:** 0 BLOCKERS, 1 IMPORTANT, 1 NIT
  1. **[IMPORTANT]** AC8 was not a genuine regression guard for the `nullEstimateData` branch. The original sentinel `'plato-desconocido-xyz'` contained no portion term, so both the `throw` path and the (hypothetical) fulfilled-miss path would produce `portionSizing: undefined`, and the `toBeUndefined()` assertion couldn't discriminate between them. **Fix (inline):** changed the dishB slice to `'tapa de plato-desconocido-xyz'`. The word `'tapa'` means that on a fulfilled-miss path `enrichWithPortionSizing` would populate `portionSizing.term === 'tapa'`, making the `toBeUndefined()` assertion fail — exclusively flagging the regression of the rejected/`nullEstimateData` branch. Commit `ba6bd55`.
  2. **[NIT]** `product-tracker.md` Active Session was stale (still at "Spec v2 ready, backend-planner next"). **Fix (inline):** refreshed in the same commit `ba6bd55` to reflect current step (implementation complete + code-review APPROVE + QA PASS).
- **Regression sweep:** ran 26 BUG-PROD-007 integration tests + 9 estimateRoute + 15 portionAssumption unit + 8 portionAssumption edge + 12 orchestrator unit + 26 f085 portion-sizing unit + 17 f070 conversationCore unit + 41 f070 entityExtractor unit — all green.
- **Commits:** `ba6bd55` (AC8 hardening + tracker refresh)

### Merge Checklist Audit — 2026-04-14

- **Skill:** `/audit-merge`
- **External audit:** User ran an independent pre-audit via external agent prior to `/audit-merge` — APPROVE with 3 gaps flagged (status field, empty evidence table, missing Completion Log entries). All 3 gaps filled by this audit.
- **Sections added during audit:** `## Workflow Checklist`, `## Acceptance Criteria`, `## Definition of Done` (previously absent at top level — ACs existed only inside the Spec table).
- **Merge Checklist Evidence table:** 8/8 rows filled with empirical evidence (commit SHAs, test counts, CI check names, PR URL, `gh pr view` output).
- **Status transition:** `Spec v3 + Plan v2` → `Ready for Merge`.
- **Compliance:** PASS (see Audit Report below).

### Merge — 2026-04-14

- **Squash commit:** `aab85f0` on `develop` (PR #120)
- **Files merged:** 6 files, +1684/-7 lines (`conversationCore.ts` 8-line diff + 2 integration test extensions +633 lines + ticket file +1034 lines + `bugs.md` entry + tracker sync)
- **Branch deletion:** `bugfix/BUG-PROD-007-comparison-menu-wiring` deleted via `gh pr merge --squash --delete-branch`
- **Post-merge CI on `develop`:** green (next commit `dae4968` docs-only, no regressions introduced by the merge)
- **Cycle closed:** 26/26 BUG-PROD-007 integration tests GREEN, no BUG-PROD-006 regressions, solo/comparison/menu paths all wired with `prisma` + `originalQuery`, `logger.warn` downgraded to `logger.debug`.

### Post-merge Step 6 housekeeping — 2026-04-16

- **Context:** External audit (2026-04-16) flagged that the ticket file was frozen at `Ready for Merge` state post-PR #120 squash. Status field, Step 6 checkbox, and Completion Log merge entry were never updated after the actual merge — the same class of gap that BUG-PROD-004-FU1-RETRY needed PR #130 to close. BUG-PROD-007 was merged 2026-04-14, one day before the preventive rule v2 for split-cycle / post-merge housekeeping was strengthened in `bugs.md` during the BUG-PROD-004-FU1 cycle, so this ticket predates the process improvement.
- **PR:** `chore/tracker-sync-bug-prod-007-finalize`
- **Changes:** ticket file only — Status `Ready for Merge` → `Done`, Step 6 `[ ]` → `[x]` with merge commit reference, two new Completion Log entries (Merge + this housekeeping).
- **No code changes, no additional tests, no tracker or bugs.md updates needed** — both were already synced inline during the original PR #120 squash.
