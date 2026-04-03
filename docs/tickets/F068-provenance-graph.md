# F068: Provenance Graph — DataSource priority_tier + BEDCA-first Resolution

**Feature:** F068 | **Type:** Backend-Feature | **Priority:** High
**Status:** Done | **Branch:** feature/F068-provenance-graph
**Created:** 2026-04-02 | **Dependencies:** None

---

## Spec

### Description

Add a `priority_tier` field to the `data_sources` table and integrate it into the estimation engine so that higher-priority sources win when multiple sources match a query. This implements the deterministic resolution strategy defined in ADR-015.

**Why:** Currently L1 returns the first matching row regardless of source quality. When BEDCA (lab data) and OFF/estimated data coexist for the same dish, the engine must prefer BEDCA. When a user specifies a brand ("tortilla hacendado"), the engine must route to branded/chain data (Tier 0) directly.

**Key behaviors (from ADR-015):**
- Generic query → order results by `priority_tier ASC` (Tier 1 BEDCA > Tier 2 USDA > Tier 3 estimated)
- Branded query → filter to Tier 0 first, fall through to normal cascade if no match
- NLP must extract `has_explicit_brand: boolean` from query text
- BEDCA and OFF records for "same dish" are never merged — separate DataSource entries

**Reference:** `docs/research/product-evolution-analysis-2026-03-31.md` Section 17, Foundation 1.

### API Changes

**No new endpoints.** Modifications to existing behavior:

1. **GET /estimate** response `source` object gains `priorityTier: number | null` field
2. Resolution order within L1 strategies changes: results ordered by `priority_tier ASC NULLS LAST`
3. When `has_explicit_brand` detected in query, L1 attempts Tier 0 match first

Update `docs/specs/api-spec.yaml`: add `priorityTier` to EstimateSource schema component.

### Data Model Changes

**Prisma schema** (`packages/api/prisma/schema.prisma`):
```prisma
model DataSource {
  // ... existing fields ...
  priorityTier Int? @map("priority_tier")
}
```

**Migration** `provenance_priority_tier_f068`:
1. `ALTER TABLE data_sources ADD COLUMN priority_tier INTEGER;`
2. Backfill existing sources:
   - Chain scraped sources (type='scraped') → `priority_tier = 0`
   - USDA (name LIKE '%USDA%') → `priority_tier = 2`
   - Estimated sources (type='estimated') → `priority_tier = 3`
   - Others (type='official' without specific match) → `priority_tier = 2`

**Kysely types** regeneration required after migration.

**Shared schemas** (`packages/shared/src/schemas/estimate.ts`):
- Add `priorityTier: z.number().int().min(0).max(3).nullable().optional()` to `EstimateSourceSchema`

### UI Changes

N/A — backend only.

### Edge Cases & Error Handling

1. **Null priority_tier:** Sources without tier assigned are treated as lowest priority (`NULLS LAST` in ORDER BY). No error thrown.
2. **Branded query with no Tier 0 match:** Falls through to normal L1 cascade (no brand filtering). Example: user says "pizza Telepizza" but Telepizza source has no exact match → normal FTS/food cascade.
3. **Multiple same-tier matches:** Within same tier, existing ordering applies (exact > FTS, dish > food, shortest name first).
4. **Cache invalidation:** Priority tier changes affect results → existing cache entries with different resolution may be stale. Cache TTL (300s) provides natural expiry. No explicit invalidation needed.
5. **Brand detection false positives:** Conservative approach — only match known chain slugs and a curated brand list. Unknown brands fall through to generic resolution.
6. **Empty brand list:** If no brands in DB, `has_explicit_brand` is always false. No behavior change from current.

---

## Implementation Plan

### Phase 1: Schema & Types (TDD)

**1.1 Prisma migration — add `priority_tier` column**
- Add `priorityTier Int? @map("priority_tier")` to `DataSource` model in `schema.prisma`
- Create migration `provenance_priority_tier_f068`
- Backfill existing sources via SQL in migration:
  - `UPDATE data_sources SET priority_tier = 0 WHERE type = 'scraped';` (chain PDFs)
  - `UPDATE data_sources SET priority_tier = 2 WHERE name ILIKE '%USDA%';`
  - `UPDATE data_sources SET priority_tier = 3 WHERE type = 'estimated';`
  - `UPDATE data_sources SET priority_tier = 2 WHERE type = 'official' AND priority_tier IS NULL;` (catch-all for remaining official)

**1.2 Regenerate Kysely types**
- Run `npx prisma generate` + Kysely type generation
- Verify `priority_tier` appears in `DB['data_sources']`

**1.3 Update shared schemas**
- Add `priorityTier: z.number().int().min(0).max(3).nullable()` to `EstimateSourceSchema` in `packages/shared/src/schemas/estimate.ts`
- Update `EstimateSource` type export

### Phase 2: Brand Detection Module (TDD)

**2.1 Create `packages/api/src/estimation/brandDetector.ts`**
- Function: `detectExplicitBrand(query: string, knownChainSlugs: string[]): { hasExplicitBrand: boolean; detectedBrand?: string }`
- Strategy:
  1. Check query against known chain slugs (from DB `restaurants.chain_slug` DISTINCT)
  2. Check against curated brand keywords: `['hacendado', 'mercadona', 'carrefour', 'dia', 'lidl', 'aldi', 'eroski', 'el corte inglés', 'alcampo']`
  3. Word-boundary matching to avoid false positives
- Pure function, no DB access (chain slugs passed in)
- Tests: known brands, unknown, partial matches, case insensitivity, brands as substrings (e.g., "diablo" should not match "dia")

**2.2 Chain slug loader (simple utility)**
- Function: `loadChainSlugs(db: Kysely<DB>): Promise<string[]>`
- Query: `SELECT DISTINCT chain_slug FROM restaurants WHERE chain_slug IS NOT NULL`
- Cached in memory at app startup (chain slugs rarely change)

### Phase 3: L1 Lookup Modifications (TDD)

**3.1 Add `priority_tier` to L1 SQL queries**
- All 4 strategies (exactDish, ftsDish, exactFood, ftsFood):
  - Add `ds.priority_tier::text AS source_priority_tier` to SELECT
  - Add `ORDER BY ds.priority_tier ASC NULLS LAST` before `LIMIT 1`
  - For dish strategies: order by `ds.priority_tier ASC NULLS LAST, LENGTH(d.name) ASC` (existing FTS tie-break preserved)

**3.2 Update row types**
- Add `source_priority_tier: string | null` to `DishQueryRow` and `FoodQueryRow` in `types.ts`
- Update `mapSource()` to include `priorityTier` via `parsePriorityTier()` helper

**3.3 Branded query routing in L1**
- Add `hasExplicitBrand?: boolean` to `Level1LookupOptions`
- When `hasExplicitBrand === true`:
  - Add `AND ds.priority_tier = 0` filter to first attempt (Tier 0 only)
  - If no result → fall through to normal (unfiltered) L1 cascade
- This is a two-pass approach: branded-filtered first, then unfiltered fallback

### Phase 4: Engine Router Integration (TDD)

**4.1 Pass brand detection through cascade**
- Add `hasExplicitBrand?: boolean` to `EngineRouterOptions`
- In `runEstimationCascade()`: pass `hasExplicitBrand` to `level1Lookup()` options
- L2/L3/L4 do NOT need brand filtering (they handle different scenarios)

**4.2 Integrate brand detection in estimate route**
- In `packages/api/src/routes/estimate.ts`:
  - Load chain slugs once at plugin init (fail-open)
  - Before calling `runEstimationCascade()`, run `detectExplicitBrand(query, chainSlugs)`
  - Pass result as `hasExplicitBrand` to cascade options

### Phase 5: Response Enrichment

**5.1 Propagate `priorityTier` through all levels**
- L1: Already handled via updated `mapSource()`
- L2: Synthetic source → `priorityTier: 3` (estimated)
- L3: Same as L1 (joins data_sources)
- L4: Synthetic source → `priorityTier: 3` (estimated/LLM)

### Phase 6: Test Coverage

- Unit tests for brand detection (25 tests)
- Unit tests for L1 priority ordering + schema validation (11 tests)
- Verify existing test baseline is not broken

---

## Acceptance Criteria

- [x] `data_sources` table has `priority_tier` integer column (nullable)
- [x] Existing data sources backfilled with correct tier values
- [x] Kysely types regenerated with `priority_tier` field
- [x] `EstimateSourceSchema` includes `priorityTier` field
- [x] Brand detection module extracts `has_explicit_brand` from queries
- [x] L1 lookup orders results by `priority_tier ASC NULLS LAST`
- [x] Branded queries (has_explicit_brand=true) attempt Tier 0 match first
- [x] GET /estimate response includes `priorityTier` in source object
- [x] Unit tests for brand detection (known brands, unknown, edge cases)
- [x] Unit tests for priority-ordered L1 resolution
- [x] Unit tests for branded query routing
- [x] All tests pass (36 new, no new failures)
- [x] Build succeeds
- [x] Specs updated (`api-spec.yaml` / shared schemas)

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing (36 tests)
- [x] E2E tests updated (if applicable) — N/A, no new endpoints
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
- [x] Step 5: `qa-engineer` executed (Standard/Complex)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-02 | Ticket created | Step 0+1 combined, spec derived from ADR-015 + product evolution analysis |
| 2026-04-02 | Cross-model reviews skipped | Spec (Step 0) and Plan (Step 2): skipped /review-spec and /review-plan. ADR-015 was already reviewed by 3 models across 4 iterations; user granted extended autonomy for this feature |
| 2026-04-02 | Implementation complete | 0ab331f — feat(data): add priority_tier + brand detection. 16 files, 926 insertions |
| 2026-04-02 | Validator fixes | d53e1d2 — parsePriorityTier NaN guard, remove dead code, fix comment |
| 2026-04-02 | PR created | #60 → develop. Code review + QA executing |
| 2026-04-02 | Review findings | Accepted: H1 (cache key comment), H2 (regex simplify), M1 (migration IS NULL guards). No critical/high blockers. QA: 14/14 AC pass, 1 low-risk edge case noted |
| 2026-04-02 | Review fixes | e5878e7 — IS NULL guards, regex simplify, cache key comment |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Plan, AC, DoD, Workflow, Log, Evidence |
| 1. Mark all items | [x] | AC: 14/14, DoD: 7/7, Workflow: 7/8 (Step 6 pending) |
| 2. Verify product tracker | [x] | Active Session: step 5/6 (Review), Features table: 5/6 |
| 3. Update key_facts.md | [x] | Updated: migration list (16), brandDetector module added |
| 4. Update decisions.md | [x] | ADR-015 already existed (written pre-F068) |
| 5. Commit documentation | [x] | Commits: 9260c93 (docs update), e5878e7 (review fixes) |
| 6. Verify clean working tree | [x] | `git status`: clean after final commit |

---

*Ticket created: 2026-04-02*
