# F021: Level 2 — Ingredient-Based Estimation

**Feature:** F021 | **Type:** Backend-Feature | **Priority:** High
**Status:** In Progress | **Branch:** feature/F021-level2-ingredient-estimation
**Created:** 2026-03-18 | **Dependencies:** F020 (Level 1), F001b (DishIngredient model), F002 (dishes/foods schema), F005 (Redis)

---

## Spec

### Description

Implement Level 2 of the Estimation Engine (E003): ingredient-based nutritional estimation.

When Level 1 (`level1Lookup`) returns null — meaning no official nutritional record exists for the
queried dish — Level 2 attempts to estimate nutritional values by decomposing a matching dish into
its ingredients and aggregating their individual nutritional contributions.

The aggregation formula is:

```
nutrient_total = SUM( food_nutrient_per_100g[i] * gramWeight[i] / 100 )
                 for each resolvable ingredient i
```

A resolvable ingredient is a `dish_ingredients` row where:
- `ingredientFoodId` is non-null (links to a `foods` row), AND
- `gramWeight` is non-null (gram equivalent is known), AND
- a `food_nutrients` row with `referenceBasis = 'per_100g'` exists for that food.

Ingredients that fail any of these conditions are **skipped** (non-fatal). The ratio of resolved vs
total ingredients determines the output `confidenceLevel` (see Confidence Scoring below).

If no ingredient resolves at all, `level2Lookup` returns null (no result producible).

**F021 scope:** `level2Lookup` function + route integration (call L2 when L1 misses) + schema
changes (new match types, `level2Hit` field). No pgvector similarity (F022), no full orchestration
(F023).

### Architecture Decisions

- **LLM never calculates** (ADR-001): all arithmetic happens in the `level2Lookup` function via SQL
  aggregation on the server. The LLM is not involved.
- **Kysely for the query**: the Level 2 query joins `dishes → restaurants → dish_ingredients →
  food_nutrients` (4 tables, via CTE) with aggregation and scoping. Kysely territory per
  ADR-000. Neither `foods` nor `data_sources` is directly joined — the link goes through
  `di.ingredient_food_id → fn.food_id`, and `d.source_id` is read directly from dishes.
- **Same dish-matching logic as Level 1**: dish selection reuses the same exact-match and FTS
  strategies (scoped to `chainSlug` / `restaurantId` when provided). The difference is that the dish
  must have resolvable ingredients rather than a `dish_nutrients` row.
- **Single SQL query per strategy**: the full join from dish → ingredients → food_nutrients with
  aggregation is expressed as a single Kysely query per strategy. No N+1 fetches.
- **`referenceBasis = 'per_100g'` only**: only `food_nutrients` rows where
  `referenceBasis = 'per_100g'` can be scaled by `gramWeight`. Rows with `per_serving` or
  `per_package` reference bases are skipped because there is no reliable way to scale them by
  gram weight (the serving size is unknown at the ingredient level).
- **`referenceBasis` of the output**: always `per_serving`. The summed nutrients represent the
  total contribution for the entire dish.
- **Single source traceability**: Level 2 results cannot point to a single `data_sources` row
  because nutrient data is aggregated from multiple ingredient food_nutrient rows. The `source`
  field in `EstimateResult` is repurposed as a computed provenance marker:
  - `source.id`: UUID from `dishes.source_id` (NOT NULL FK, read directly — no JOIN to data_sources needed)
  - `source.name`: `"Computed from ingredients"` (static label)
  - `source.type`: `"estimated"`
  - `source.url`: null
  - A separate `ingredientSources` array is added to `Level2Result` (internal type only, not
    exposed in the API response). This preserves per-ingredient traceability for future debugging
    and the F023 Engine Router.
- **Unified cache key**: `estimate:<normalizedQuery>:<chainSlug|''>:<restaurantId|''>` — single
  key stores the final response regardless of which level produced it. Replaces the `estimate:l1`
  prefix from F020. Rationale: separate L1/L2 keys cause a logical flaw where the current route
  (which caches both hits AND misses) would cache L1 miss and short-circuit all subsequent
  requests, making the L2 cache key dead code. TTL = 300 seconds. Cache is fail-open.
- **Route integration**: the existing `estimate.ts` route calls `level2Lookup` after a Level 1
  miss. The response shape is extended with `level2Hit`. This stub integration is the minimum
  needed for F021 to be testable and is superseded by F023 (Engine Router) without breaking
  changes.

### Matching Strategies (Level 2)

Level 2 tries two strategies in priority order. Each requires the matched dish to have at least one
resolvable ingredient (otherwise the strategy is skipped):

| Priority | Match type | Description |
|----------|-----------|-------------|
| 1 | `ingredient_dish_exact` | Case-insensitive exact match on `dishes.name`, dish has ≥1 resolvable ingredient |
| 2 | `ingredient_dish_fts` | FTS match on `dishes.name_es` (Spanish) or `dishes.name` (English), dish has ≥1 resolvable ingredient |

Chain/restaurant scoping rules are identical to Level 1 dish strategies.

Food strategies (exact_food, fts_food) are **not** attempted at Level 2. If no official food record
exists, a composite decomposition via dish_ingredients is the only meaningful path.

### Nutrient Aggregation Formula

For each resolvable ingredient `i`:

```
contribution[i][nutrient] = food_nutrients[i][nutrient] * dish_ingredients[i].gramWeight / 100
```

Total for each of the 15 nutrients:

```
total[nutrient] = SUM( contribution[i][nutrient] ) for all resolvable i
```

This aggregation is performed in SQL using `SUM(fn.[nutrient] * di.gram_weight / 100)` grouped by
dish, so the result is a single row per matched dish.

### Confidence Scoring

Confidence is a function of the resolution ratio (resolved ingredients / total ingredients):

| Resolution ratio | `confidenceLevel` |
|-----------------|-------------------|
| 1.0 (all resolved) | `medium` |
| < 1.0 but ≥ 1 resolved | `low` |
| 0 (none resolved) | return null (no result) |

All `dish_ingredients` rows count toward the denominator (no `isOptional` column in current schema).

The `estimationMethod` is always `'ingredients'` for Level 2 results.

Level 2 never produces `confidenceLevel: 'high'` — that is reserved for Level 1 official data.

### API Changes

#### `GET /estimate` — updated behavior

Parameters unchanged. Response `data` object additions:

| Field | Type | Description |
|-------|------|-------------|
| `level2Hit` | boolean | `true` when Level 2 produced a result |

`matchType` — new enum values:

| Value | When |
|-------|------|
| `ingredient_dish_exact` | Level 2 exact dish match (case-insensitive) |
| `ingredient_dish_fts` | Level 2 FTS dish match |

`result` when Level 2 hits:
- `entityType`: `"dish"`
- `confidenceLevel`: `"medium"` (all ingredients resolved) or `"low"` (some skipped)
- `estimationMethod`: `"ingredients"`
- `source.type`: `"estimated"`
- `source.name`: `"Computed from ingredients"`
- `nutrients.referenceBasis`: `"per_serving"`

### Data Model Changes

No Prisma schema changes. F021 only reads from existing tables:
- `dishes` — dish identity, scoping, and `source_id` FK (read directly, no JOIN to `data_sources`)
- `restaurants` — chain_slug for scoping
- `dish_ingredients` — ingredient list with `ingredientFoodId` and `gramWeight`
- `food_nutrients` — ingredient nutritional data (filtered to `per_100g`, linked via `di.ingredient_food_id → fn.food_id`)

### Schema Changes (`packages/shared/src/schemas/estimate.ts`)

#### 1. `EstimateMatchTypeSchema` — add two new values

```typescript
export const EstimateMatchTypeSchema = z.enum([
  'exact_dish', 'fts_dish', 'exact_food', 'fts_food',
  'ingredient_dish_exact',  // NEW — Level 2
  'ingredient_dish_fts',    // NEW — Level 2
]);
```

#### 2. `EstimateDataSchema` — add `level2Hit` field

```typescript
export const EstimateDataSchema = z.object({
  query: z.string(),
  chainSlug: z.string().nullable(),
  level1Hit: z.boolean(),
  level2Hit: z.boolean(),  // NEW
  matchType: EstimateMatchTypeSchema.nullable(),
  result: EstimateResultSchema.nullable(),
  cachedAt: z.string().nullable(),
});
```

### Edge Cases & Error Handling

1. **Dish matched but zero resolvable ingredients** — return null. `level2Hit` remains false.
2. **Partial resolution (some ingredients have null `gramWeight`)** — skipped ingredients reduce
   the resolution ratio → `confidenceLevel: 'low'`. Nutrients are undercount.
3. **Ingredient food's `food_nutrients.referenceBasis = 'per_serving'`** — ingredient skipped.
4. **Multiple food_nutrients rows per food** — CTE de-dup with `ROW_NUMBER() OVER (PARTITION BY
   fn.food_id ORDER BY fn.created_at DESC)`.
5. **Cache hit** — unified cache returns the full response (may be L1 hit, L2 hit, or miss). Neither lookup is called.
6. **DB query failure** — throw `{ code: 'DB_UNAVAILABLE', statusCode: 500 }`.
7. **Redis failure** — fail-open, proceed without caching.
8. **`portion_grams` on matched dish** — passed through in response as-is. Does not affect aggregation.

### Cache Strategy

| Key | Pattern | TTL |
|-----|---------|-----|
| Unified | `fxp:estimate:<query>:<chainSlug>:<restaurantId>` | 300s |

Single unified cache key stores the final response (regardless of which level produced it).
Replaces the `estimate:l1` prefix from F020. Rationale: separate L1/L2 keys cause a logical
flaw where cached L1 misses short-circuit and L2 cache is never read.

Cache lookup order:
1. Check unified cache → hit: return immediately (may contain L1 hit, L2 hit, or total miss)
2. Cache miss → run L1 → if hit, build response, cache, return
3. L1 miss → run L2 → build response (hit or miss), cache, return

### Notes

- `DishIngredient.ingredientFoodId` is NOT NULL (required FK to foods). All rows have a food link.
- `DishIngredient` has no `isOptional` column in current schema. All ingredients count in denominator.
- `gramWeight` is the only nullable condition for ingredient resolution.
- The `RecipeIngredient` model is structurally similar but linked to composite foods via Recipe.
  Level 2 only uses `DishIngredient` — Recipe path is not in F021 scope.

---

## Implementation Plan

### Existing Code to Reuse

- `packages/shared/src/schemas/estimate.ts` — `EstimateMatchTypeSchema`, `EstimateDataSchema`, and all sub-schemas; extend in-place rather than replacing
- `packages/shared/src/schemas/enums.ts` — `ConfidenceLevelSchema`, `EstimationMethodSchema`, `NutrientReferenceBasisSchema`, `DataSourceTypeSchema`; all required values already present (`'ingredients'`, `'estimated'`, `'medium'`, `'low'`)
- `packages/api/src/estimation/types.ts` — `Level1LookupOptions` (reuse the same shape as `Level2LookupOptions`), `parseDecimal` (directly accessible since `mapLevel2RowToResult` is added to this file). NOTE: `mapNutrients` and `mapSource` are pattern references only — L2 cannot reuse them directly because the aggregated row lacks `reference_basis` (L2 hardcodes `'per_serving'`) and lacks `source_name`/`source_type`/`source_url` (L2 builds a synthetic source object). Use `parseDecimal` for each nutrient field individually.
- `packages/api/src/estimation/level1Lookup.ts` — `normalizeQuery` (duplicate in level2Lookup with the same logic), `scopeClause` pattern, `sql<RowType>` template execution, `DB_UNAVAILABLE` error-throw pattern, `LIMIT 1`
- `packages/api/src/routes/estimate.ts` — `buildKey`, `cacheGet`, `cacheSet` usage pattern; error rethrow shape `{ statusCode, code, cause }`
- `packages/api/src/lib/cache.ts` — `buildKey`, `cacheGet`, `cacheSet`; no changes needed
- `packages/api/src/lib/kysely.ts` — `getKysely()`; no changes needed
- `packages/api/src/__tests__/f020.level1Lookup.unit.test.ts` — `buildMockDb()` pattern, `vi.hoisted` mock executor, fixture UUID format, `mockExecuteQuery` chaining
- `packages/api/src/__tests__/f020.estimate.route.test.ts` — `vi.mock` stubs for `level1Lookup`, `redis`, `prisma`, `kysely`; `buildApp().inject()` pattern; `EstimateResponseSchema.safeParse` validation
- `packages/shared/src/__tests__/estimate.schemas.test.ts` — existing fixtures; extend rather than replace

---

### Files to Create

| File | Purpose |
|------|---------|
| `packages/api/src/estimation/level2Lookup.ts` | Main Level 2 lookup function — 2-strategy cascade (exact dish, FTS dish) with single aggregating SQL query per strategy; returns `Level2Result` or null |
| `packages/api/src/__tests__/f021.level2Lookup.unit.test.ts` | Unit tests for `level2Lookup` — mocked Kysely executor, all strategies and edge cases |
| `packages/api/src/__tests__/f021.estimate.route.test.ts` | Route integration tests for Level 2 path — mocked `level1Lookup` and `level2Lookup`, L2 cache key, fail-open Redis, DB error propagation |

---

### Files to Modify

| File | Changes |
|------|---------|
| `packages/shared/src/schemas/estimate.ts` | Add `'ingredient_dish_exact'` and `'ingredient_dish_fts'` to `EstimateMatchTypeSchema`; add `level2Hit: z.boolean()` to `EstimateDataSchema` |
| `packages/shared/src/__tests__/estimate.schemas.test.ts` | Extend `EstimateMatchTypeSchema` test to include the two new values; extend `EstimateDataSchema` tests to include `level2Hit` field; add `level2Hit` to ALL existing fixtures |
| `packages/api/src/estimation/types.ts` | Add `Level2LookupOptions`, `Level2Result`, `IngredientNutrientRow` type definitions; add `mapLevel2RowToResult` mapper (uses `parseDecimal` directly for each nutrient, hardcodes `referenceBasis: 'per_serving'` and synthetic source object) |
| `packages/api/src/estimation/index.ts` | Export `level2Lookup` and new types from the barrel |
| `packages/api/src/routes/estimate.ts` | **Step 1a:** Add `level2Hit: false` to all existing `EstimateData` construction paths (keeps TS compiling and F020 tests green). **Step 8:** Add L2 fallback, unified cache, call `level2Lookup` |
| `packages/api/src/__tests__/f020.estimate.route.test.ts` | Add `level2Hit: false` to `cachedData` fixture (line 222) and mock `level2Lookup` stub; update any response assertions that check `EstimateResponseSchema` |
| `packages/api/src/__tests__/f020.edge-cases.test.ts` | Add mock for `level2Lookup` (route now imports it); responses validated with `EstimateResponseSchema` will now include `level2Hit` from the route |

---

### Implementation Order

> **Review fixes applied:** This plan incorporates fixes for 4 issues found during independent review.
> See "Review Fixes" section at the end for details.

1. **Atomic schema + route + F020 test update** — This step is atomic: all changes must land together to keep TS compilation and existing tests green.

   **1a. `packages/shared/src/schemas/estimate.ts`** — Add the two new enum values to `EstimateMatchTypeSchema` and the `level2Hit` field to `EstimateDataSchema`.

   **1b. `packages/api/src/routes/estimate.ts`** — Minimal update: add `level2Hit: false` to ALL existing `EstimateData` construction paths (L1 hit, L1 miss, cached response). This keeps TypeScript compiling and the route returning valid `EstimateData`. The full L2 integration happens in step 8.

   **1c. `packages/api/src/__tests__/f020.estimate.route.test.ts`** — Add `level2Hit: false` to the `cachedData` fixture (line ~222). Add `vi.mock` stub for `'../estimation/level2Lookup.js'` (the route will import it in step 8; stub it now so the mock is ready). No other test changes needed — the route now returns `level2Hit: false` in all responses, so `EstimateResponseSchema.safeParse` passes.

   **1d. `packages/api/src/__tests__/f020.edge-cases.test.ts`** — Add `vi.mock` stub for `'../estimation/level2Lookup.js'` (same reason as 1c — the route will import it). The route response already includes `level2Hit: false` from 1b, so `EstimateResponseSchema.safeParse` at line 550 passes.

   **1e. `packages/shared/src/__tests__/estimate.schemas.test.ts`** — Add `level2Hit: false` to ALL existing `EstimateDataSchema` and `EstimateResponseSchema` fixture objects. Add new assertions: `EstimateMatchTypeSchema` accepts `'ingredient_dish_exact'` and `'ingredient_dish_fts'`; `EstimateDataSchema` parses `level2Hit: true` and `level2Hit: false`; rejects missing `level2Hit`.

   **Verify:** Run `npm test` and `npm run build` — everything must be GREEN before proceeding.

2. **`packages/api/src/estimation/types.ts`** — Add four new types after the existing ones:
   - `Level2LookupOptions` — identical shape to `Level1LookupOptions` (`chainSlug?: string; restaurantId?: string`)
   - `IngredientNutrientRow` — raw Kysely row shape for the aggregating query, with `dish_id`, `dish_name`, `dish_name_es`, `restaurant_id`, `chain_slug`, `portion_grams`, `dish_source_id`, `resolved_count`, `total_count`, plus all 15 aggregated nutrient columns as `string` (not nullable — the SQL `SUM(CASE ... ELSE 0 END)` guarantees non-NULL results; `HAVING` ensures ≥1 resolved ingredient)
   - `Level2Result` — `{ matchType: EstimateMatchType; result: EstimateResult; resolvedCount: number; totalCount: number; ingredientSources: string[] }` where `ingredientSources` is an array of food UUIDs that contributed to the aggregation (for future F023 traceability)
   - `mapLevel2RowToResult(row: IngredientNutrientRow): { result: EstimateResult; resolvedCount: number; totalCount: number }` — mapper that extracts `resolved_count`/`total_count` from the row, sets `confidenceLevel` based on ratio (1.0 → `'medium'`, partial → `'low'`), `estimationMethod: 'ingredients'`, `source.type: 'estimated'`, `source.name: 'Computed from ingredients'`, `source.url: null`, `source.id` from `dish_source_id`, `nutrients.referenceBasis: 'per_serving'`. Returns a structured object so the caller doesn't need to re-extract counts.

3. **`packages/api/src/__tests__/f021.level2Lookup.unit.test.ts`** (RED first) — Write the full test file before implementing `level2Lookup.ts`. Import `level2Lookup` from `'../estimation/level2Lookup.js'` (file does not yet exist — tests will fail to compile). Define fixtures:
   - `MOCK_AGGREGATE_ROW` — a fully-resolved row with `resolved_count: '2'`, `total_count: '2'` and non-null aggregated nutrient strings
   - `MOCK_AGGREGATE_ROW_PARTIAL` — same but `resolved_count: '1'`, `total_count: '2'`
   - Reuse `buildMockDb()` pattern from `f020.level1Lookup.unit.test.ts` verbatim
   - Test cases (all failing at this stage):
     - Strategy 1 (exact dish) returns `matchType: 'ingredient_dish_exact'` and short-circuits
     - Strategy 1 maps all 15 aggregated nutrients via `parseDecimal`, `referenceBasis: 'per_serving'`
     - Strategy 1 sets `confidenceLevel: 'medium'` when `resolvedCount === totalCount`
     - Strategy 1 sets `confidenceLevel: 'low'` when `resolvedCount < totalCount`
     - Strategy 1 `estimationMethod: 'ingredients'`
     - Strategy 1 source block: `type: 'estimated'`, `name: 'Computed from ingredients'`, `url: null`
     - Strategy 2 (FTS dish) runs when strategy 1 misses
     - Returns null when both strategies return empty rows
     - Returns null when `resolved_count: '0'` (no ingredients resolved)
     - Skips `per_serving` food_nutrients — verified via `resolved_count: '0'` in returned row
     - Scoping: `restaurantId` scope applied to strategy 1; `chainSlug` scope applied
     - `portionGrams` passthrough from dish row
     - Throws `{ code: 'DB_UNAVAILABLE' }` when Kysely throws

4. **`packages/api/src/estimation/level2Lookup.ts`** (GREEN) — Implement the function to make all unit tests pass:
   - File-level comment block mirroring `level1Lookup.ts` structure
   - `normalizeQuery(query: string): string` — same implementation as Level 1
   - `exactIngredientDishMatch(db, normalizedQuery, options)` — SQL using `sql<IngredientNutrientRow>` template. Query structure:
     - CTE `ranked_fn` — de-dup `food_nutrients` rows per food via `ROW_NUMBER() OVER (PARTITION BY fn.food_id ORDER BY fn.created_at DESC)`, filtered to `WHERE fn.reference_basis = 'per_100g'`
     - Main query: `FROM dishes d JOIN restaurants r ON r.id = d.restaurant_id`
     - `JOIN dish_ingredients di ON di.dish_id = d.id`
     - `LEFT JOIN ranked_fn rfn ON rfn.food_id = di.ingredient_food_id AND rfn.rn = 1`
     - `WHERE LOWER(d.name) = LOWER($normalizedQuery)` plus `scopeClause`
     - `GROUP BY d.id, d.name, d.name_es, d.restaurant_id, r.chain_slug, d.portion_grams, d.source_id`
     - `SELECT` columns: `d.id AS dish_id`, `d.name AS dish_name`, `d.name_es AS dish_name_es`, `d.restaurant_id`, `r.chain_slug`, `d.portion_grams::text AS portion_grams`, `d.source_id::text AS dish_source_id`, plus `COUNT(di.id)::text AS total_count`, `COUNT(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN 1 END)::text AS resolved_count`, and for each of 15 nutrients: `SUM(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN rfn.[nutrient] * di.gram_weight / 100 ELSE 0 END)::text AS [nutrient]`
     - `HAVING COUNT(CASE WHEN rfn.id IS NOT NULL AND di.gram_weight IS NOT NULL THEN 1 END) > 0` — ensures at least one resolvable ingredient
     - `LIMIT 1`
     - **NOTE:** No `JOIN data_sources` — `d.source_id` is a NOT NULL FK, read directly from the dish row. One fewer JOIN and simpler GROUP BY.
   - `ftsIngredientDishMatch(db, normalizedQuery, options)` — same structure but FTS `WHERE` clause matching `level1Lookup`'s `ftsDishMatch` (Spanish + English `to_tsvector/plainto_tsquery`)
   - `scopeClause` pattern — identical to Level 1: `restaurantId !== undefined` → `AND r.id = ${restaurantId}::uuid`, else `chainSlug !== undefined` → `AND r.chain_slug = ${chainSlug}`, else empty `sql\`\``
   - `level2Lookup(db, query, options)` — exported main function, same signature pattern as `level1Lookup`, try/catch wrapping both strategy calls throwing `DB_UNAVAILABLE`; checks `parsedRow.resolved_count === '0'` after each strategy hit and skips to next if so (redundant given HAVING clause but defensive); returns `Level2Result` with `resolvedCount`, `totalCount`, `ingredientSources: []` (empty array for now — F023 will populate)

5. **`packages/api/src/estimation/index.ts`** — Add `export { level2Lookup } from './level2Lookup.js'` and export the new types (`Level2LookupOptions`, `Level2Result`, `IngredientNutrientRow`) from `'./types.js'`.

6. **`packages/api/src/__tests__/f021.estimate.route.test.ts`** (RED first) — Write route tests before modifying `estimate.ts`. Mock both `level1Lookup` and `level2Lookup` using `vi.hoisted` + `vi.mock`. Define `MOCK_LEVEL2_RESULT` fixture (matchType `'ingredient_dish_exact'`, `confidenceLevel: 'medium'`, `estimationMethod: 'ingredients'`, `source.type: 'estimated'`). Test cases (failing):
   - L1 miss + L2 hit → calls `level2Lookup`, returns `level2Hit: true`, `matchType: 'ingredient_dish_exact'`, response 200
   - L1 hit → `level2Lookup` never called, `level2Hit: false`
   - L1 miss + L2 miss → `level1Hit: false`, `level2Hit: false`, `result: null`, response 200
   - Cache hit (full response) → neither `level1Lookup` nor `level2Lookup` called, `cachedAt` non-null
   - Redis unavailable (get) → fail-open, lookups called
   - Redis unavailable (set) → fail-open, result returned
   - `level2Lookup` throws `DB_UNAVAILABLE` → 500 response
   - Response validates against `EstimateResponseSchema` with `level2Hit` field in both hit and miss cases

7. **`packages/api/src/routes/estimate.ts`** (GREEN) — Full L2 integration to make route tests pass:
   - Add import: `import { level2Lookup } from '../estimation/level2Lookup.js'`
   - **Unified cache key** (replaces the old `estimate:l1` prefix): `buildKey('estimate', \`${normalizedQuery}:${chainSlug ?? ''}:${restaurantId ?? ''}\`)`
   - Cache check returns the full response (may be L1 hit, L2 hit, or total miss)
   - On cache miss: run L1 → if hit, build `data` with `level1Hit: true, level2Hit: false`
   - On L1 miss: call `level2Lookup(db, normalizedQuery, { chainSlug, restaurantId })` wrapped in try/catch with same `DB_UNAVAILABLE` rethrow pattern
   - Build `data: EstimateData` with `level1Hit: false`, `level2Hit: lookupResult2 !== null`, `matchType`, `result`
   - On total miss: `level1Hit: false, level2Hit: false, matchType: null, result: null`
   - Cache the final `data` (with `cachedAt` timestamp) under the unified key — regardless of hit/miss, just like the current behavior
   - Update route `summary` and `description` strings to mention Level 2 fallback

8. **Verify full test suite** — Run `npm test` from the monorepo root (or `vitest run` inside `packages/api` and `packages/shared`). All new and existing tests must be GREEN. Run `npm run build` to confirm TypeScript compilation succeeds in both packages.

---

### Testing Strategy

**Test files to create:**
- `packages/api/src/__tests__/f021.level2Lookup.unit.test.ts`
- `packages/api/src/__tests__/f021.estimate.route.test.ts`

**Test files to modify:**
- `packages/shared/src/__tests__/estimate.schemas.test.ts` — add `level2Hit` to ALL existing fixtures + new assertions
- `packages/api/src/__tests__/f020.estimate.route.test.ts` — add `level2Hit: false` to `cachedData` fixture + `vi.mock` stub for `level2Lookup`
- `packages/api/src/__tests__/f020.edge-cases.test.ts` — add `vi.mock` stub for `level2Lookup`

**Key test scenarios:**

`f021.level2Lookup.unit.test.ts`:
- Happy path — exact dish match, all ingredients resolved → `matchType: 'ingredient_dish_exact'`, `confidenceLevel: 'medium'`
- Happy path — FTS dish match (strategy 1 misses, strategy 2 hits) → `matchType: 'ingredient_dish_fts'`
- Partial resolution (`resolved_count < total_count`) → `confidenceLevel: 'low'`
- Zero resolution (`resolved_count: '0'`) → return null (no result)
- Both strategies miss → return null
- Nutrient aggregation: all 15 nutrients mapped from string via `parseDecimal`, `referenceBasis: 'per_serving'`
- Source block: `type: 'estimated'`, `name: 'Computed from ingredients'`, `url: null`, `id` from dish's data source
- `estimationMethod: 'ingredients'` always set
- Strategy short-circuit: strategy 1 hit → `mockExecuteQuery` called exactly once
- Chain scoping: strategy 1 SQL includes `r.chain_slug = $chainSlug` when `chainSlug` provided
- Restaurant scoping: strategy 1 SQL includes `r.id = $restaurantId::uuid` when `restaurantId` provided
- `portionGrams` passthrough from dish
- DB error → throws `{ code: 'DB_UNAVAILABLE' }`

`f021.estimate.route.test.ts`:
- L1 miss + L2 hit → `level1Hit: false`, `level2Hit: true`, response 200
- L1 hit → `level2Hit: false`, `level2Lookup` not called
- L1 miss + L2 miss → both hits false, `result: null`, response 200
- Cache hit (unified key) → neither lookup called, `cachedAt` non-null
- Redis unavailable (get) → fail-open, lookups called
- Redis unavailable (set) → fail-open, result returned
- `level2Lookup` throws DB_UNAVAILABLE → response 500, `error.code: 'DB_UNAVAILABLE'`
- Response validates `EstimateResponseSchema` on L2 hit
- Response validates `EstimateResponseSchema` on total miss

`estimate.schemas.test.ts` additions:
- `EstimateMatchTypeSchema` accepts `'ingredient_dish_exact'` and `'ingredient_dish_fts'`
- `EstimateDataSchema` parses a hit with `level2Hit: true`
- `EstimateDataSchema` parses a miss with `level2Hit: false`
- `EstimateDataSchema` rejects missing `level2Hit`

**Mocking strategy:**
- Unit tests (`f021.level2Lookup.unit.test.ts`): mock Kysely executor via `buildMockDb()` (identical pattern to `f020.level1Lookup.unit.test.ts`); no real DB, no real Redis
- Route tests (`f021.estimate.route.test.ts`): mock `level1Lookup` and `level2Lookup` via `vi.hoisted`/`vi.mock`; mock `redis` (get/set); mock `prisma` and `kysely` as stubs (required by `buildApp`); use `app.inject()` for HTTP layer
- Schema tests: no mocking needed — pure Zod validation

---

### Key Patterns

**Kysely `sql` template with aggregation** — Level 2 query is more complex than Level 1 (GROUP BY + HAVING + SUM expressions) but uses the same `sql<RowType>\`...\`.execute(db)` invocation pattern. See `level1Lookup.ts` lines 45–86 for the exact call shape.

**`ROW_NUMBER()` CTE de-dup for `food_nutrients`** — Level 1 de-dups `dish_nutrients` via `ranked_dn`. Level 2 must de-dup `food_nutrients` per food via `ranked_fn`. The CTE must filter `WHERE fn.reference_basis = 'per_100g'` before applying `ROW_NUMBER()` so that `per_serving` rows never enter the aggregation (they would be de-duped as rn=1 if they were newer, silently producing wrong results).

**No `data_sources` JOIN needed** — The L2 mapper hardcodes `source.name: 'Computed from ingredients'`, `source.type: 'estimated'`, `source.url: null`. Only `source.id` is dynamic, and it comes from `d.source_id` (NOT NULL FK on dishes). Use `d.source_id::text AS dish_source_id` directly — no `JOIN data_sources ds` required. This simplifies the query and GROUP BY vs the original plan.

**`scopeClause` pattern** — Copied verbatim from `level1Lookup.ts` lines 39–43. Do not refactor into a shared utility in this ticket; that is F023 scope.

**`parseDecimal` on aggregated SUM columns** — Aggregated SUM columns come back as `string` because the `ELSE 0` in the CASE expression guarantees non-NULL results (and HAVING ensures ≥1 row). `parseDecimal` is called directly for each of the 15 nutrient fields in `mapLevel2RowToResult` — do NOT use `mapNutrients` (it expects a `reference_basis` column that L2 rows lack; L2 hardcodes `'per_serving'`). Similarly, do NOT use `mapSource` (L2 builds a synthetic source object with hardcoded values).

**`normalizeQuery` duplication** — Each lookup module owns its own copy of `normalizeQuery`. Do not extract to a shared utility in this ticket. Note: the route also normalizes the query before passing to lookups (idempotent, harmless).

**`Level2LookupOptions` alias** — The options type is structurally identical to `Level1LookupOptions`. Define it as a separate `interface Level2LookupOptions` with the same two optional fields. Do not use `type Level2LookupOptions = Level1LookupOptions` — the types should be decoupled so F023 can evolve them independently.

**Unified cache key** — F021 uses a single cache key `fxp:estimate:<query>:<chainSlug>:<restaurantId>` (no `l1`/`l2` prefix split). The route caches the final response regardless of which level produced it. Rationale: the current route caches both hits AND misses under one key. With split keys, the L1 miss cached under `l1:*` would short-circuit all subsequent requests (returning the cached miss without ever checking L2), making the L2 cache key dead code. A unified key is simpler and correct. F023 may refine this if per-level invalidation is needed.

**`ingredientSources` in `Level2Result`** — This internal field holds food UUIDs for future F023 traceability. Initialize as an empty array `[]` in F021. The SQL aggregation query in F021 does not SELECT individual food IDs (it only selects aggregated totals per dish). Populating `ingredientSources` accurately would require a second query or a different SQL structure — defer to F023 where the Engine Router will need it.

**Gotcha — `HAVING` vs application-level null check** — The `HAVING COUNT(...) > 0` clause ensures the DB never returns a row with `resolved_count: '0'`. The application-level guard (`if (parsedRow.resolved_count === '0') return null`) is a defensive double-check. Both are correct; the SQL clause is the authoritative filter.

**Gotcha — Step 1 must be atomic** — Adding `level2Hit: z.boolean()` as required to `EstimateDataSchema` immediately breaks: (1) TypeScript compilation of `estimate.ts` route (constructs `EstimateData` without `level2Hit`), (2) F020 route tests that validate against `EstimateResponseSchema`, (3) F020 edge-case tests that use `EstimateResponseSchema.safeParse`. Step 1 bundles schema change + minimal route update + F020 test fixture updates to keep the codebase green at every step.

---

### Review Fixes

Issues found during independent review — Round 1 (2 CRITICAL + 2 IMPORTANT):

| # | Severity | Issue | Fix applied |
|---|----------|-------|-------------|
| 1 | CRITICAL | Step 1 (schema change) breaks TS compilation and F020 tests — `EstimateData` objects in route and test fixtures lack `level2Hit` | Step 1 is now atomic: schema + minimal route update + F020 test fixture updates. All sub-steps (1a-1e) must land together. Verify GREEN before proceeding. |
| 2 | CRITICAL | Separate L1/L2 cache keys are dead code — current route caches both hits and misses under L1 key, so cached L1 miss short-circuits and L2 cache is never read | Replaced with unified cache key `fxp:estimate:<query>:<chainSlug>:<restaurantId>`. Single key stores final response (L1 hit, L2 hit, or total miss). |
| 3 | IMPORTANT | "Files to Modify" table omitted `f020.estimate.route.test.ts` and `f020.edge-cases.test.ts` | Added both files to the table with specific changes needed. |
| 4 | IMPORTANT | Unnecessary `JOIN data_sources ds` in L2 SQL — `d.source_id` is a NOT NULL FK, can be read directly | Removed `JOIN data_sources` from SQL, use `d.source_id::text AS dish_source_id` directly. Simpler query and GROUP BY. |

Issues found during second review — Round 2 (2 IMPORTANT + 3 SUGGESTIONS):

| # | Severity | Issue | Fix applied |
|---|----------|-------|-------------|
| 5 | IMPORTANT | ACs #9-10 still reference old `estimate:l2:*` cache key and separate L2 cache check — contradicts unified cache strategy from Fix #2 | Rewritten to reference unified key and single cache check at route start. |
| 6 | IMPORTANT | Spec section says "5 tables including `foods` and `data_sources`" — after Fix #4, actual SQL joins 4 tables (dishes, restaurants, dish_ingredients, food_nutrients). Neither `foods` nor `data_sources` is directly joined. | Corrected Architecture Decisions and Data Model Changes sections. |
| 7 | SUGGESTION | `mapNutrients` and `mapSource` listed as reusable but L2 cannot use them directly — L2 row lacks `reference_basis` and `source_name`/`source_type`/`source_url` columns | Clarified in "Existing Code to Reuse" and "Key Patterns": use `parseDecimal` directly, build nutrients/source manually. |
| 8 | SUGGESTION | `IngredientNutrientRow` nutrient types as `string | null` — SQL `SUM(CASE ... ELSE 0 END)` guarantees non-NULL | Changed to `string` (more precise, avoids TS type mismatches). |
| 9 | SUGGESTION | `AggregatedNutrientRow` type alias adds no value in F021 — unnecessary abstraction | Removed from plan. Create in F023 if shapes diverge. |

---

## Acceptance Criteria

- [x] `level2Lookup(db, query, options)` returns `Level2Result` when a dish matches and has ≥1 resolvable ingredient; returns null otherwise
- [x] Nutrient values computed as `SUM(fn.[nutrient] * di.gram_weight / 100)` across resolved ingredients
- [x] `confidenceLevel: 'medium'` when all ingredients resolve; `'low'` when any are skipped
- [x] `estimationMethod: 'ingredients'` on all Level 2 results
- [x] `source.type: 'estimated'` and `source.name: 'Computed from ingredients'`
- [x] `nutrients.referenceBasis: 'per_serving'` on all Level 2 results
- [x] Only `food_nutrients` rows with `referenceBasis = 'per_100g'` used in aggregation
- [x] `EstimateMatchTypeSchema` includes `ingredient_dish_exact` and `ingredient_dish_fts`
- [x] `EstimateDataSchema` includes `level2Hit: z.boolean()`
- [x] Route calls Level 2 on L1 miss; final result cached under unified key `fxp:estimate:<query>:<chainSlug>:<restaurantId>`
- [x] Single cache check at route start; on miss, runs L1 → L2 fallback → caches final response under unified key
- [x] DB errors from `level2Lookup` propagate as HTTP 500 `DB_UNAVAILABLE`
- [x] Redis failure on L2 cache is fail-open
- [x] Unit tests for level2Lookup: exact-match, FTS, partial resolution, zero resolution, per_serving skipped
- [x] Integration test: full L1 miss → L2 hit round-trip via `GET /estimate`
- [x] All tests pass (1904 total: 1507 API + 165 shared + 232 scraper)
- [x] Build succeeds
- [x] Specs updated (api-spec.yaml, shared schemas)

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing (80 F021 tests: 17 unit + 11 route + 35 QA edge-case + 17 QA route edge-case)
- [x] E2E tests updated (if applicable)
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
- [x] Step 5: `qa-engineer` executed (Standard)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-18 | Step 0: Spec created | Spec-creator agent: algorithm, schema changes, cache strategy, edge cases |
| 2026-03-18 | Step 1: Setup complete | Branch feature/F021-level2-ingredient-estimation, ticket created |
| 2026-03-18 | Step 2: Plan created | backend-planner agent, 9-step plan |
| 2026-03-18 | Step 2: Plan reviewed (Round 1) | Independent review found 2 CRITICAL + 2 IMPORTANT issues. All 4 addressed: (1) atomic step 1, (2) unified cache key, (3) F020 test files added, (4) removed unnecessary data_sources JOIN |
| 2026-03-18 | Step 2: Plan reviewed (Round 2) | Second review against actual code found 2 IMPORTANT + 3 SUGGESTION issues. All 5 addressed: (5) ACs fixed for unified cache, (6) spec corrected to 4 tables, (7-9) mapNutrients/mapSource clarified, nutrient types tightened, AggregatedNutrientRow removed |
| 2026-03-18 | Step 3: Implementation complete | backend-developer agent, TDD. 3 files created, 8 modified. 28 new tests (17 unit + 11 route) |
| 2026-03-18 | Step 4: Finalize complete | production-code-validator: READY FOR PRODUCTION, 0 issues. Tests: all passing. Lint: 0 new errors. Build: OK (4 pre-existing TS errors) |
| 2026-03-18 | Step 5: Code review | APPROVED. 0 critical/important issues. 1 suggestion (LOWER redundancy — kept for L1 consistency) |
| 2026-03-18 | Step 5: QA engineering | QA VERIFIED. 52 new edge-case tests. 8 findings (0 bugs, all guarded). FINDING-F021-01: defensive guard for 0/0 resolved_count is load-bearing |

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

---

*Ticket created: 2026-03-18*
