# BUG-PROD-012: Chain matching overrides Spanish dishes in FTS lookups

**Feature:** BUG-PROD-012 | **Type:** Backend-Bugfix | **Priority:** High
**Status:** Spec | **Branch:** bugfix/BUG-PROD-012-chain-matching-priority
**Created:** 2026-04-21 | **Dependencies:** BUG-DEV-LINT-002 (merged PR #177)

---

## Spec

### Description

**Root cause** (diagnosed 2026-04-21 from the 350-query QA battery — `docs/research/qa-2026-04-21-exhaustive-results.md`):

`packages/api/src/estimation/level1Lookup.ts` strategies 2 (`ftsDishMatch`) and 4 (`ftsFoodMatch`) both sort results with:

```sql
ORDER BY ds.priority_tier ASC NULLS LAST, length(COALESCE(d.name_es, d.name)) ASC
LIMIT 1
```

Priority tier assignment (migration `20260402100000`):

| Tier | Meaning | Examples |
|------|---------|----------|
| 0    | `type='scraped'` — chain PDFs | Tim Hortons, Starbucks, McDonald's |
| 1    | `type='official'` + USDA | cocina-española, BEDCA |
| 2    | Other `type='official'` | — |
| 3    | `type='estimated'` | — |

Because `priority_tier ASC` is the primary sort key, Tier 0 (scraped chain PDFs) always wins over Tier 1 (cocina-española / BEDCA) whenever their FTS vectors both match. For queries WITHOUT an explicit brand (`hasExplicitBrand = false`), this produces 8 demonstrably wrong matches in the battery, including:

- `"tortilla"` → Tim Hortons Tortilla Española Wrap (1932 kcal) instead of Tortilla de patatas (197 kcal)
- `"pintxo de tortilla"` → Tim Hortons result (wrong) while the bare `"tortilla española"` correctly matches cocina-española
- `"jamón"` → Starbucks Jamón y Queso Panini instead of Jamón serrano (cocina-española)
- Similar overrides for croquetas, paella, boquerones, calamares, gazpacho

The existing F068 flow already special-cases `hasExplicitBrand = true`: it filters to Tier 0 first, then falls through to the unfiltered cascade. When the brand is NOT explicit, the code delegates to the unfiltered cascade immediately, and Tier 0 chains dominate.

**Fix** (to be refined by the planner):

Introduce the symmetric inverse of F068. When `hasExplicitBrand === false`, run the cascade with `tierFilter >= 1` (i.e. exclude Tier 0) first; fall through to the unfiltered cascade if no match is found. This preserves the `hasExplicitBrand = true` path (Tier 0 first) and preserves fallback behavior — Tier 0 still wins if no Tier 1+ entry matches (so users searching `"tortilla"` with no cocina-española alternative still get the chain result rather than NULL).

Architecturally this is consistent with ADR-015 (provenance graph): official Spanish data should outrank scraped chain PDFs for generic Spanish queries.

**Affected strategies:** 2 (`ftsDishMatch`) and 4 (`ftsFoodMatch`) are the primary targets. Strategies 1 and 3 (exact match) are unambiguous by definition — an exact `LOWER(name)` / `LOWER(name_es)` / alias match to a chain dish almost always implies explicit brand context — but we need to verify they also use the inverse-cascade path (or prove they cannot fire without explicit brand); planner should cover this.

### API Changes

None. `POST /conversation/message`, `POST /conversation/audio`, `GET /estimate`, and `POST /analyze/menu` continue to return the same response shape. The only observable change is the `dishId` (and nutrients) returned for non-branded Spanish queries that collide with chain FTS entries.

### Data Model Changes

None. No schema or seed changes. `priority_tier` values stay as-is; the new logic filters at query time.

### UI Changes

None directly. Users searching for generic Spanish dishes will now see the cocina-española match instead of the chain match (correct behavior).

### Edge Cases & Error Handling

1. **Tier 1 miss, Tier 0 hit** — query like `"starbucks latte"` with `hasExplicitBrand=false` (brand detector failed): must still return the Starbucks result via fallback, not NULL.
2. **Both `chainSlug` AND `hasExplicitBrand=false`** — bot flow where a restaurant is pre-selected via `/cadenas` but the query is generic (e.g. user picked Starbucks, asked "tortilla"). The `chainSlug`/`restaurantId` scope clause should still take precedence — the new filter must not break scoped lookups.
3. **Tier filter interaction** — existing `tierFilter` parameter passed into the strategy functions uses `AND ds.priority_tier = X`. The new path needs `ds.priority_tier >= 1` which is a different predicate; planner must specify exact Kysely SQL.
4. **BUG-PROD-011 interaction** — portion scaling happens after L1 returns. No impact expected because BUG-PROD-012 only changes WHICH row L1 returns, not how it's scaled.
5. **F080 OFF branded lookup** — runs before cascade only when `hasExplicitBrand=true`. Not affected.
6. **Performance** — adding one extra cascade pass for non-branded queries doubles the worst-case L1 query count (2 cascades × 4 strategies = 8 queries). Each query hits the FTS GIN index; expected impact negligible for typical traffic. Planner should measure.

---

## Implementation Plan

### Architecture Decision

**Option B: Introduce a parallel `minTier?: number` parameter alongside the existing `tierFilter?: number`.**

Rationale: `tierFilter` encodes an equality predicate (`= X`). The new inverse-cascade needs a lower-bound predicate (`>= 1`). Adding a `minTier` parameter keeps the equality contract of `tierFilter` unchanged, avoids breaking any of the 7 call sites (`exactDishMatch`, `ftsDishMatch`, `exactFoodMatch`, `ftsFoodMatch`, `offBrandedFoodMatch`, `offFallbackFoodMatch`, `runCascade`), and produces a minimal diff. Option A would require changing every call site's type signature and branching the SQL inline. Option C adds a new wrapper function that duplicates the full `runCascade` body or re-invokes it — creating an extra abstraction whose only job is to swap one parameter. Option B threads `minTier` through the same path as `tierFilter`, with one new conditional in each strategy's clause builder: when `minTier` is defined, emit `AND ds.priority_tier >= ${minTier}`; when `tierFilter` is defined, emit `AND ds.priority_tier = ${tierFilter}`; when neither, emit nothing. This is the cleanest symmetric inverse of F068: F068 calls `runCascade(db, q, opts, 0)` (Tier-0 equality first); BUG-PROD-012 calls `runCascade(db, q, opts, undefined, 1)` (Tier≥1 lower-bound first).

---

### Existing Code to Reuse

- `level1Lookup` export — `/packages/api/src/estimation/level1Lookup.ts` (lines 517–560): add new branch at line ~552
- `runCascade` — same file, lines 465–496: add `minTier?` parameter, thread to all strategies
- `exactDishMatch`, `ftsDishMatch`, `exactFoodMatch`, `ftsFoodMatch` — same file: add `minTier?` parameter and `minTierClause` SQL fragment alongside existing `tierClause`
- `Level1LookupOptions` — `/packages/api/src/estimation/types.ts` line 31: no change needed (minTier is an internal parameter, not part of the public options interface)
- Existing unit test helpers (mock DB executor) in `f020.level1Lookup.unit.test.ts` and `f073.level1Lookup.unit.test.ts` — reuse the `mockExecuteQuery` / `createMockDb` pattern

---

### Precise SQL / Kysely Change

Each of the four strategy functions (`exactDishMatch`, `ftsDishMatch`, `exactFoodMatch`, `ftsFoodMatch`) gains a second optional parameter `minTier?: number` alongside the existing `tierFilter?: number`.

The clause builder changes from:

```
const tierClause = tierFilter !== undefined
  ? sql`AND ds.priority_tier = ${tierFilter}`
  : sql``;
```

To:

```
const tierClause = tierFilter !== undefined
  ? sql`AND ds.priority_tier = ${tierFilter}`
  : minTier !== undefined
    ? sql`AND ds.priority_tier >= ${minTier}`
    : sql``;
```

At most one of `tierFilter` and `minTier` will be set at any call site; the developer must assert this invariant with a guard at the top of `runCascade`:

```
if (tierFilter !== undefined && minTier !== undefined) {
  throw new Error('runCascade: tierFilter and minTier are mutually exclusive');
}
```

The `scopeClause` in `exactDishMatch` and `ftsDishMatch` is unchanged — the new `minTierClause` is independent. When `chainSlug` or `restaurantId` is present (AC6), the scope clause still applies; the tier clause is layered on top via `${scopeClause}${tierClause}` (both can be empty strings, which is the existing pattern).

`runCascade` signature becomes:
```
async function runCascade(
  db: Kysely<DB>,
  normalizedQuery: string,
  options: Level1LookupOptions,
  tierFilter?: number,
  minTier?: number,
): Promise<Level1Result | null>
```

`offBrandedFoodMatch` and `offFallbackFoodMatch` are NOT modified — they are not called through `runCascade` and already operate independently of `tierFilter`.

---

### Control-Flow Change in `level1Lookup`

The `level1Lookup` main export (lines 517–560) gains a new branch between the F068 Tier-0-first block and the existing unfiltered fallback. Full control-flow order after the fix:

```
// Step 1: F080 OFF branded early exit (hasExplicitBrand=true AND knownSupermarket)
if (options.hasExplicitBrand === true && options.detectedBrand !== undefined) {
  if (isKnownSupermarket) {
    offRow = await offBrandedFoodMatch(...)
    if (offRow) return ...
  }
}

// Step 2: F068 Tier-0-first pre-cascade (hasExplicitBrand=true)
if (options.hasExplicitBrand === true) {
  tier0Result = await runCascade(db, normalizedQuery, options, /* tierFilter= */ 0)
  if (tier0Result !== null) return tier0Result
  // fall through
}

// Step 3: NEW — Tier≥1 pre-cascade (hasExplicitBrand=false)
// Only runs when brand is explicitly absent AND no chainSlug/restaurantId scope is set.
// When a chainSlug IS set (AC6), skip this step entirely so scope clause wins.
if (options.hasExplicitBrand !== true && options.chainSlug === undefined && options.restaurantId === undefined) {
  tier1PlusResult = await runCascade(db, normalizedQuery, options, /* tierFilter= */ undefined, /* minTier= */ 1)
  if (tier1PlusResult !== null) return tier1PlusResult
  // fall through to unfiltered cascade
}

// Step 4: Unfiltered cascade (existing behavior; covers AC5 and AC6 and F068 fallback)
return await runCascade(db, normalizedQuery, options)
```

Key interactions:
- **AC6 guard** (`chainSlug !== undefined || restaurantId !== undefined`): When the bot pre-selects a restaurant (chainSlug set), skip Step 3 entirely so the scope clause continues to constrain results. The unfiltered cascade at Step 4 applies the scope clause, returning the chain match as before.
- **AC5 safety** (`"frappuccino"`, hasExplicitBrand=false, chain-only match): Step 3 runs with `minTier >= 1`; frappuccino has no Tier 1+ entry → returns null → falls through to Step 4 unfiltered → Starbucks result returned.
- **F068 and F080 unchanged**: Steps 1 and 2 remain byte-for-byte identical to current code.

---

### Test Matrix

New test file: `/packages/api/src/__tests__/bug012.level1InverseCascade.unit.test.ts`

All tests in this file use the mocked Kysely executor pattern from `f020.level1Lookup.unit.test.ts` and `f073.level1Lookup.unit.test.ts`. No real DB is required for unit tests.

| AC | describe / it |
|----|---------------|
| AC1 | `describe('BUG-012 — AC1: generic tortilla → cocina-española')` / `it('returns Tier 1 cocina-española dish when Tier 0 chain dish also matches FTS')` |
| AC2 | `describe('BUG-012 — AC2: generic jamón → cocina-española')` / `it('returns Tier 1 jamón serrano over Starbucks Jamón Queso Panini on FTS match')` |
| AC3 | `describe('BUG-012 — AC3: pintxo de tortilla → cocina-española')` / `it('returns Tier 1 result for partial FTS match over Tier 0 chain result')` |
| AC4 | `describe('BUG-012 — AC4: hasExplicitBrand=true preserves Tier-0-first')` / `it('branded query (starbucks latte) still returns Starbucks Tier 0 result')` |
| AC5 | `describe('BUG-012 — AC5: chain-only term fallback')` / `it('frappuccino (hasExplicitBrand=false) returns Starbucks result via unfiltered fallback when Tier≥1 misses')` |
| AC6 | `describe('BUG-012 — AC6: chainSlug scope overrides tier pre-filter')` / `it('chainSlug=starbucks + "tortilla" skips Tier≥1 pre-cascade and returns scoped Starbucks result')` |

Mocking strategy per test:
- AC1–AC3: first `mockExecuteQuery` call (Tier≥1 cascade pass) returns a Tier-1 dish row; confirm returned result has `source_priority_tier = '1'`.
- AC4: `mockExecuteQuery` first call returns a Tier-0 row (no Tier≥1 branch runs for branded); confirm result has `source_priority_tier = '0'`.
- AC5: first `mockExecuteQuery` call (Tier≥1 pass) returns empty rows for all 4 strategies; second pass (unfiltered) returns the Starbucks row; confirm result returned is the Starbucks row.
- AC6: `mockExecuteQuery` returns Starbucks scoped row on the first (unfiltered) cascade; confirm Tier≥1 branch was NOT entered (inspect call count — should be 1 cascade, not 2).

Regression tests that must still pass (cite paths):
- `/packages/api/src/__tests__/f068.level1Priority.unit.test.ts` — all 8 tests unchanged
- `/packages/api/src/__tests__/f020.level1Lookup.unit.test.ts` — all existing tests unchanged
- `/packages/api/src/__tests__/f073.level1Lookup.unit.test.ts` — all existing tests unchanged
- `/packages/api/src/__tests__/f080.level1Off.unit.test.ts` — OFF branded path unchanged

---

### Performance Consideration

Worst case adds 1 extra cascade pass (up to 4 extra FTS queries) for non-branded, unscoped queries that have no Tier 1+ match; all queries hit the existing GIN FTS index and the `priority_tier` B-tree index on `data_sources`, so latency impact is sub-millisecond per query and no regression is expected for typical traffic patterns.

---

### Risk

The `chainSlug + hasExplicitBrand=false` combination (AC6) is the most likely regression vector: if the Step 3 guard (`chainSlug === undefined && restaurantId === undefined`) is accidentally omitted, scoped bot queries will ignore chain data and return cocina-española results when users have explicitly selected a chain restaurant. The plan guards against this by making AC6 an explicit failing unit test written before the implementation code is touched (TDD Step 2), so the guard condition cannot be overlooked.

---

### Step Breakdown (TDD)

1. **Create test file** `/packages/api/src/__tests__/bug012.level1InverseCascade.unit.test.ts` with all 6 AC test stubs. Run `npm test --workspace=@foodxplorer/api` — confirm 6 new tests RED, all existing pass.

2. **Write AC6 test body first** (the guard condition). Implement the mock: `mockExecuteQuery` returns Starbucks row. Confirm test still RED (no implementation yet).

3. **Add `minTier?: number` parameter to `exactDishMatch`** in `level1Lookup.ts`. Update the `tierClause` builder to handle `minTier`. Run tests — still RED (runCascade not yet updated).

4. **Repeat step 3 for `ftsDishMatch`, `exactFoodMatch`, `ftsFoodMatch`** — all four strategies updated.

5. **Update `runCascade` signature** to accept `minTier?: number`. Add the mutual-exclusion guard. Thread `minTier` into all four strategy calls.

6. **Add Step 3 inverse-cascade branch in `level1Lookup`** with the AC6 guard (`chainSlug === undefined && restaurantId === undefined`). Run tests — AC1, AC2, AC3, AC6 should go GREEN. AC4, AC5 may still RED.

7. **Write AC4 test body** (branded path unchanged). Should already be GREEN after step 6 since F068 path is untouched. Confirm GREEN.

8. **Write AC5 test body** (frappuccino fallback). Mock: Tier≥1 returns empty, unfiltered returns Starbucks row. Should go GREEN after step 6 (fallback already implemented). Confirm GREEN.

9. **Write AC1–AC3 test bodies** in full detail with correct fixture rows (Tier-1 cocina-española rows with `source_priority_tier: '1'`, Tier-0 chain rows). Confirm all 6 ACs GREEN.

10. **Run full regression suite** (`npm test --workspace=@foodxplorer/api`). Confirm `f068`, `f020`, `f073`, `f080` tests all still GREEN. Fix any type errors (`npm run build`).

11. **Run lint** (`npm run lint --workspace=@foodxplorer/api`). Fix any lint errors (ensure no `any` types introduced, `sql` template used correctly, no raw string SQL).

12. **Update the file-level JSDoc comment** at the top of `level1Lookup.ts` (lines 1–17) to document the new BUG-PROD-012 inverse-cascade behavior, mirroring the existing F068 note at line 14.

---

### Files to Create

- `/packages/api/src/__tests__/bug012.level1InverseCascade.unit.test.ts` — 6 AC unit tests using the mocked Kysely executor pattern

### Files to Modify

- `/packages/api/src/estimation/level1Lookup.ts` — add `minTier?: number` to strategy functions + `runCascade`; add Step 3 inverse-cascade branch in `level1Lookup`; update file JSDoc

### Files NOT Modified

- `/packages/api/src/estimation/types.ts` — `Level1LookupOptions` unchanged (`minTier` is internal to `level1Lookup.ts`, not a public option)
- `/packages/api/src/estimation/engineRouter.ts` — caller passes `hasExplicitBrand` as before; no change
- `/packages/api/src/estimation/brandDetector.ts` — unchanged
- All existing test files — read-only regression targets

---

## Acceptance Criteria

- [ ] AC1 — `"tortilla"` → cocina-española (Tortilla de patatas, ~197 kcal), NOT Tim Hortons
- [ ] AC2 — `"jamón"` → cocina-española (Jamón serrano), NOT Starbucks
- [ ] AC3 — `"pintxo de tortilla"` (after portion term stripping) → cocina-española, not Tim Hortons
- [ ] AC4 — `"starbucks latte"` (hasExplicitBrand=true) → Starbucks result (existing behavior preserved)
- [ ] AC5 — `"frappuccino"` (hasExplicitBrand=false but chain-only match) → Starbucks result via fallback (no false NULL)
- [ ] AC6 — `chainSlug='starbucks'` + `"tortilla"` → Starbucks result (scope clause wins)
- [ ] AC7 — Unit/integration tests added for all 6 ACs above; TDD (RED → GREEN)
- [ ] AC8 — `runCascade` signature updated (or new helper introduced) without breaking existing callers
- [ ] AC9 — 350-query regression battery shows ≥8 fewer wrong matches after merge (corresponding to P1 queries)
- [ ] AC10 — No regressions in existing L1 tests (the 133 integration tests around `level1Lookup` must still pass)
- [ ] All tests pass (`npm test --workspace=@foodxplorer/api`)
- [ ] `npm run build` succeeds
- [ ] `npm run lint --workspace=@foodxplorer/api` shows 0 errors (F116 baseline preserved)

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Unit tests written and passing (TDD: RED → GREEN for each AC)
- [ ] Integration tests cover the `hasExplicitBrand=false` inverse-cascade path
- [ ] No regressions in existing L1 tests
- [ ] Code follows project standards (Kysely `sql` templates, no raw strings, no `any`)
- [ ] No linting errors
- [ ] Build succeeds
- [ ] 350-query regression battery result recorded in ticket (post-merge)
- [ ] ADR considered: this change refines ADR-015 (provenance graph) — add ADR-023 or amend if semantically load-bearing

---

## Workflow Checklist

- [x] Step 0: Spec written (this file). `spec-creator` agent not required (research doc + sprint plan already constitute the spec inputs — ADR-compliant reuse).
- [x] Step 1: Branch created, ticket generated (this file), tracker updated
- [x] Step 2: `backend-planner` executed, plan approved
- [x] Step 3: `backend-developer` executed with TDD
- [ ] Step 4: `production-code-validator` executed, quality gates pass
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 5: `qa-engineer` executed
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-21 | Ticket created | Spec based on QA battery 2026-04-21 root-cause analysis + sprint plan |
| 2026-04-21 | Implementation complete (Step 3) | TDD: 6 AC tests (RED→GREEN). Added `minTier?` param to 4 strategies + `runCascade`, mutual-exclusion guard, Step 3 inverse-cascade branch in `level1Lookup`. Updated 3 call-count assertions in f020 tests (8 calls for unscoped all-miss now correct). 3357/3357 tests passing, 0 lint errors, build green. |

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

*Ticket created: 2026-04-21 as part of QA Improvement Sprint (pm-session pm-qai)*
