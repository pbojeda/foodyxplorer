# F018: Data Quality Monitor

**Feature:** F018 | **Type:** Backend-Feature | **Priority:** High
**Status:** In Progress | **Branch:** feature/F018-data-quality-monitor
**Created:** 2026-03-17 | **Dependencies:** F002 (schema), F007b/F009/F011/F012/F014/F015 (ingestion pipeline)

---

## Spec

### Description

Implement a data quality monitoring system that audits all ingested dish and nutrient
data in the database and surfaces issues across six dimensions: nutrient completeness,
implausible values, data gaps, duplicates, confidence distribution, and data freshness.

The system has three deliverables that share a common check layer:

1. **Check module** (`packages/api/src/quality/`) — composable, independently testable
   pure functions. Each check function receives a `PrismaClient` (and optional scope
   parameters) and returns a typed result object. No side effects.
2. **CLI script** (`packages/api/src/scripts/quality-monitor.ts`) — calls all checks,
   assembles the report, and outputs either JSON (stdout) or a Markdown summary to a
   file. Accepts `--chainSlug`, `--staleness-days`, `--format` (json | markdown) flags.
3. **API endpoint** `GET /quality/report` — returns the same report as JSON via Fastify,
   using the same check functions. Accepts `?chainSlug` and `?stalenessThresholdDays`
   query parameters.

All checks are read-only (no DB writes). TDD is mandatory — every check function must
have unit tests with a seeded in-memory test database or mocked Prisma calls.

---

### API Changes

**New endpoint:** `GET /quality/report`
**Tag:** Quality (new tag added to api-spec.yaml)

#### Query parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `stalenessThresholdDays` | integer (min: 1) | 90 | Days after which a DataSource is stale |
| `chainSlug` | string (`^[a-z0-9-]+$`) | — | Scope report to one chain |

#### Response: 200 `QualityReportResponse`

```
{
  success: true,
  data: QualityReportData
}
```

`QualityReportData` fields:

| Field | Type | Description |
|-------|------|-------------|
| `generatedAt` | ISO-8601 string | Server time when report was generated |
| `totalDishes` | integer | Dish rows in scope |
| `totalRestaurants` | integer | Restaurant rows in scope |
| `stalenessThresholdDays` | integer | Threshold used for freshness check |
| `scopedToChain` | string \| null | chainSlug filter applied, or null |
| `chainSummary` | array | Per-chain overview (see below) |
| `nutrientCompleteness` | object | See below |
| `implausibleValues` | object | See below |
| `dataGaps` | object | See below |
| `duplicates` | object | See below |
| `confidenceDistribution` | object | See below |
| `dataFreshness` | object | See below |

#### Error responses

| Code | Error Code | Condition |
|------|------------|-----------|
| 400 | `VALIDATION_ERROR` | Invalid query param (e.g. `stalenessThresholdDays < 1`, invalid `chainSlug` pattern) |
| 500 | `DB_UNAVAILABLE` | Prisma query fails during report generation |

---

### Data Model Changes

None. This feature is read-only. No new tables, columns, or migrations required.

---

### Quality Check Specifications

#### Chain Summary (top-level)

`chainSummary[]`: array of per-chain overview objects, sorted by `issueCount DESC`.
Each entry contains:

- `chainSlug`: string
- `totalDishes`: integer — dishes in this chain
- `nutrientCoveragePercent`: number — `(totalDishes - dishesWithoutNutrients) / totalDishes * 100` (2 dp). `0` when no dishes.
- `issueCount`: integer — sum of: `dishesWithoutNutrients` + `ghostRowCount` + `caloriesAboveThreshold` + `totalDuplicateDishes` for this chain

**Computed in `assembleReport`** from the byChain results of checks 1, 2, and 4.
No additional DB queries needed. When `chainSlug` scope is active, the array has
at most 1 entry.

---

#### 1. Nutrient Completeness

**Source tables:** `dishes` LEFT JOIN `dish_nutrients`

- `dishesWithNutrients`: `totalDishes - dishesWithoutNutrients` (derived, for readability)
- `dishesWithoutNutrients`: `COUNT(dishes.id) WHERE dish_nutrients.id IS NULL`
- `dishesWithoutNutrientsPercent`: `dishesWithoutNutrients / totalDishes * 100` (2 dp). Returns `0` when `totalDishes = 0`.
- `ghostRowCount`: count of DishNutrient rows where ALL FOUR of `calories`,
  `proteins`, `carbohydrates`, `fats` are exactly `0` simultaneously. This is the
  reliable indicator of a failed or placeholder ingestion (individual macros can
  legitimately be 0, e.g. pure water: 0 carbs, 0 fat).
- `zeroCaloriesCount`: count of DishNutrient rows where `calories = 0` (individually).
  More granular than ghostRowCount — catches dishes with only partial data.
- `byChain`: same breakdown (`dishesWithoutNutrients`, `ghostRowCount`, `zeroCaloriesCount`) grouped by `Restaurant.chainSlug`

#### 2. Implausible Values

**Source table:** `dish_nutrients` joined to `dishes` → `restaurants`

- `caloriesAboveThreshold`: `DishNutrient.calories > 5000`
  (The DB CHECK constraint allows up to 9000 kcal; 5000 is the soft monitoring threshold
  for a single dish served at a fast-food chain.)
- `ghostRows`: `calories = 0 AND proteins = 0 AND carbohydrates = 0 AND fats = 0`
  (same condition as `nutrientCompleteness.ghostRowCount` — intentionally duplicated
  to allow independent verification within the implausible values dimension)
- `suspiciouslyRoundCalories`: `calories >= 100 AND calories % 100 = 0`
  (Informational warning — not an error. Round numbers suggest estimated or placeholder
  values, not measured data.)
- `caloriesThreshold`: always `5000` (fixed constant, not configurable via query param)
- `byChain`: same three metrics grouped by chain

#### 3. Data Gaps

**Source tables:** `dishes`, `restaurants`

- `dishesWithoutPortionGrams`: `COUNT(dishes.id) WHERE portion_grams IS NULL`
- `dishesWithoutPriceEur`: `COUNT(dishes.id) WHERE price_eur IS NULL`
- `restaurantsWithoutDishes`: `COUNT(restaurants.id)` with no matching `dishes` rows
  (Only relevant for global report; a chainSlug-scoped report by definition only covers
  chains that have at least one restaurant row.)

These are coverage metrics, not errors. They inform the estimation engine (E003) about
which dishes will be missing portion-weight context.

#### 4. Duplicates

**Source table:** `dishes`

Duplicate definition: two or more Dish rows sharing the same `(name, restaurant_id, source_id)` triple.

- `duplicateGroupCount`: number of distinct `(name, restaurant_id, source_id)` groups with count > 1
- `totalDuplicateDishes`: sum of dish counts across all duplicate groups
- `groups`: array of up to 50 groups (sorted by count DESC, then name ASC), each containing:
  - `name`, `chainSlug`, `count`, `dishIds[]`

Groups are capped at 50 in the API response to avoid unbounded payload size. The CLI
script outputs all groups to the Markdown/JSON file without the cap.

#### 5. Confidence Distribution

**Source table:** `dishes` joined to `restaurants`

- `global.{high|medium|low}`: total dish counts by `Dish.confidenceLevel`
- `byEstimationMethod.{official|scraped|ingredients|extrapolation}`: total dish counts by
  `Dish.estimationMethod`
- `byChain[]`: per-chain breakdown of both confidence levels and estimation methods

Note: `confidenceLevel` and `estimationMethod` live on the `Dish` row, not on
`DishNutrient`. The distribution reflects the overall dataset quality signal, not just
dishes with nutrient rows.

#### 6. Data Freshness

**Source table:** `data_sources`

A DataSource is considered stale when:
- `lastUpdated IS NULL` (never updated), OR
- `lastUpdated < NOW() - INTERVAL {stalenessThresholdDays} DAYS`

Scope: When `chainSlug` is provided, only DataSources linked to dishes belonging to
that chain are included (via `dishes.source_id`). Global report includes all DataSources.

- `totalSources`: count of DataSource rows in scope
- `staleSources`: count of stale DataSources
- `staleSourcesDetail[]`: for each stale source: `sourceId`, `name`, `lastUpdated`,
  `daysSinceUpdate` (`null` when `lastUpdated IS NULL`)

---

### Shared Zod Schemas (new in `packages/shared/src/schemas/`)

A new file `packages/shared/src/schemas/qualityReport.ts` must be created with the
following 15 schemas (used by both the API route and the CLI script):

```
QualityReportQuerySchema          — validates GET /quality/report query params
QualityChainSummarySchema         — per-chain overview row
QualityNutrientCompletenessChainSchema
QualityNutrientCompletenessSchema
QualityImplausibleValuesChainSchema
QualityImplausibleValuesSchema
QualityDataGapsSchema
QualityDuplicateGroupSchema
QualityDuplicatesSchema
QualityConfidenceByEstimationMethodSchema
QualityConfidenceChainSchema
QualityConfidenceDistributionSchema
QualityStaleSourceSchema
QualityDataFreshnessSchema
QualityReportDataSchema           — the full report payload
QualityReportResponseSchema       — { success: true, data: QualityReportDataSchema }
```

All schemas use strict types (no `z.any()`). Decimal fields from Prisma must be
converted to `number` before validation (Prisma returns `Decimal` objects).

---

### Module Structure

```
packages/api/src/quality/
  index.ts                        — re-exports all check functions
  checkNutrientCompleteness.ts    — check 1
  checkImplausibleValues.ts       — check 2
  checkDataGaps.ts                — check 3
  checkDuplicates.ts              — check 4
  checkConfidenceDistribution.ts  — check 5
  checkDataFreshness.ts           — check 6
  assembleReport.ts               — calls all 6 checks, returns QualityReportData
  types.ts                        — re-exports from @foodxplorer/shared qualityReport schemas

packages/api/src/scripts/
  quality-monitor.ts              — CLI entrypoint

packages/api/src/routes/
  quality.ts                      — GET /quality/report Fastify plugin
```

Each check function signature:

```typescript
checkXxx(
  prisma: PrismaClient,
  scope: { chainSlug?: string }
): Promise<XxxResult>
```

`assembleReport` calls all six in parallel via `Promise.all` and merges results.

---

### CLI Script Behavior

```
npx ts-node packages/api/src/scripts/quality-monitor.ts [options]

Options:
  --chainSlug <slug>        Scope to a single chain
  --staleness-days <n>      Staleness threshold in days (default: 90)
  --format json|markdown    Output format (default: markdown)
  --output <path>           Write output to file instead of stdout
```

- `--format json`: writes the `QualityReportData` JSON to stdout or file
- `--format markdown`: writes a human-readable report with sections per dimension,
  summary table at the top, and chain-level tables
- Exit code `0` always (monitoring tool — no findings should not be a failure exit)
- Exit code `1` only on DB connection failure

---

### UI Changes

None. This is a backend-only feature.

---

### Edge Cases

1. **Empty database** — All counts return 0. The report is valid. No error.
2. **Chain slug not found** — If `chainSlug` is provided but no Restaurant matches,
   the report returns zeroes across all dimensions (totalDishes: 0, etc.) with HTTP 200.
   It does NOT return 404 — the report is always a valid observation of the current state.
3. **`lastUpdated IS NULL` on DataSource** — Treated as stale regardless of threshold.
   `daysSinceUpdate` is `null` in `staleSourcesDetail`.
4. **Decimal → number conversion** — Prisma returns `calories`, `proteins`, etc. as
   `Prisma.Decimal` objects. All check functions must call `.toNumber()` before
   comparisons and before returning data. The Zod schemas accept `number`, not `Decimal`.
5. **Large duplicate groups cap** — API endpoint caps `groups` array at 50 entries.
   CLI script has no cap.
6. **Modulo on Decimal for round-calories check** — Use `Number(calories) % 100 === 0`
   after converting from Prisma Decimal.
7. **Ghost rows vs. missing nutrients** — A ghost row (`dish_nutrients` exists but all
   macros are 0) is NOT the same as a dish without any nutrient row. Both are reported
   separately. `dishesWithoutNutrients` counts dishes with no `DishNutrient` row.
   `ghostRows` counts `DishNutrient` rows where all four core macros are 0.
8. **Per-chain scope and data_sources** — DataSources are linked to dishes via
   `dishes.source_id`. When scoped to a chain, the freshness check queries:
   `SELECT DISTINCT source_id FROM dishes WHERE restaurant_id IN (SELECT id FROM restaurants WHERE chain_slug = ?)`.
9. **Prisma groupBy for duplicates** — Use `prisma.dish.groupBy({ by: ['name', 'restaurantId', 'sourceId'], _count: true, having: { name: { _count: { gt: 1 } } } })`.
   Then fetch `dishIds` for each group in a second query.
10. **Concurrent check execution** — All six checks run via `Promise.all`. If any single
    check throws (e.g. transient DB error), the entire `assembleReport` rejects and the
    route returns 500. Partial results are not returned.

---

## Implementation Plan

### Existing Code to Reuse

**Shared schemas (packages/shared)**
- `packages/shared/src/schemas/enums.ts` — `ConfidenceLevelSchema`, `EstimationMethodSchema` are imported in the new quality report schema for `byChain` confidence distribution types
- `packages/shared/src/index.ts` — barrel file; must be extended with `export * from './schemas/qualityReport'`

**Fastify infrastructure (packages/api)**
- `packages/api/src/app.ts` — `buildApp()` factory; add the `qualityRoutes` plugin registration in the same pattern as `healthRoutes`
- `packages/api/src/lib/prisma.ts` — PrismaClient singleton; inject via plugin options for testability (same pattern as health route)
- `packages/api/src/errors/errorHandler.ts` — `mapError()` already handles `VALIDATION_ERROR` (400) and `DB_UNAVAILABLE` (500); no new error codes needed for this feature
- `packages/api/src/routes/health.ts` — reference implementation for Fastify plugin pattern with injectable Prisma, Zod query schema, `fastify-plugin` wrap
- `packages/api/src/routes/ingest/pdf-url.ts` — reference for the `Object.assign(new Error(...), { statusCode, code })` throw pattern

**Test infrastructure**
- `packages/api/src/__tests__/migration.f002.integration.test.ts` — reference for fixture UUID namespace, `beforeAll` pre-cleanup, `afterAll` teardown order pattern
- `packages/api/src/__tests__/health.test.ts` — reference for mock Prisma injection in `buildApp()`, `app.inject()` assertions, `beforeAll`/`afterAll` lifecycle
- `packages/api/src/__tests__/scripts/batch-ingest.test.ts` — reference for unit testing a script's exported function with DI mocks

---

### Files to Create

**Step 1 — Shared Zod schemas**
- `packages/shared/src/schemas/qualityReport.ts`
  All 15 schemas (see Spec §Shared Zod Schemas). No imports from `packages/api`. Uses `ConfidenceLevelSchema` and `EstimationMethodSchema` from `./enums`. All `number` fields (no `Decimal`). `QualityReportQuerySchema` validates query params with `z.coerce.number().int().min(1).default(90)` for `stalenessThresholdDays` and `z.string().regex(/^[a-z0-9-]+$/).optional()` for `chainSlug`.

**Step 2 — Unit tests for the 6 check functions (TDD — written before implementation)**
- `packages/api/src/__tests__/quality/checkNutrientCompleteness.test.ts`
- `packages/api/src/__tests__/quality/checkImplausibleValues.test.ts`
- `packages/api/src/__tests__/quality/checkDataGaps.test.ts`
- `packages/api/src/__tests__/quality/checkDuplicates.test.ts`
- `packages/api/src/__tests__/quality/checkConfidenceDistribution.test.ts`
- `packages/api/src/__tests__/quality/checkDataFreshness.test.ts`

Each file mocks PrismaClient using `vi.fn()` stubs. Tests cover: empty DB (all zeroes), scoped by chainSlug, expected aggregation results, Decimal → number conversion, and error propagation.

**Step 3 — Check function implementations**
- `packages/api/src/quality/types.ts`
  Re-exports all quality schemas and derived types from `@foodxplorer/shared`. No business logic. Provides the TypeScript types (`QualityReportData`, `QualityNutrientCompletenessResult`, etc.) used by check functions.

- `packages/api/src/quality/checkNutrientCompleteness.ts`
  Signature: `checkNutrientCompleteness(prisma, scope): Promise<QualityNutrientCompletenessResult>`
  Queries: `prisma.dish.count()` for total, `prisma.dish.count({ where: { nutrients: { none: {} } } })` for `dishesWithoutNutrients`. For `ghostRowCount`: `prisma.dishNutrient.count({ where: { calories: 0, proteins: 0, carbohydrates: 0, fats: 0 } })`. For `zeroCaloriesCount`: `prisma.dishNutrient.count({ where: { calories: 0 } })`. Division-by-zero guard: `dishesWithoutNutrientsPercent = totalDishes > 0 ? (dishesWithoutNutrients / totalDishes * 100).toFixed(2) : 0`. For `byChain`: `prisma.restaurant.findMany` with `_count` on related dishes + `nutrients` (NOTE: the Prisma relation on Dish is `nutrients`, not `dishNutrients`). All Prisma `Decimal` fields converted via `.toNumber()`. Division-by-zero guard: when `totalDishes = 0`, `dishesWithoutNutrientsPercent` returns `0`.

- `packages/api/src/quality/checkImplausibleValues.ts`
  Signature: `checkImplausibleValues(prisma, scope): Promise<QualityImplausibleValuesResult>`
  Queries: `prisma.dishNutrient.findMany` (scoped) then count in JS for `caloriesAboveThreshold` (> 5000), `ghostRows` (all four macros === 0), `suspiciouslyRoundCalories` (>= 100 && % 100 === 0). Always includes `caloriesThreshold: 5000`. For `byChain`: group results by `dish.restaurant.chainSlug`.
  Note: Uses `prisma.dishNutrient.findMany({ include: { dish: { include: { restaurant: true } } } })` to avoid N+1. For large DBs this is acceptable at this stage (monitoring tool, not hot path). **Tech debt:** If dish count exceeds ~5000, refactor to use three separate `prisma.dishNutrient.count()` queries with `where` clauses + a raw SQL query for byChain grouping.

- `packages/api/src/quality/checkDataGaps.ts`
  Signature: `checkDataGaps(prisma, scope): Promise<QualityDataGapsResult>`
  Queries: `prisma.dish.count({ where: { portionGrams: null } })`, `prisma.dish.count({ where: { priceEur: null } })`. For `restaurantsWithoutDishes`: `prisma.restaurant.count({ where: { dishes: { none: {} } } })` — only when `scope.chainSlug` is not provided (global report only; scoped report omits or returns 0).

- `packages/api/src/quality/checkDuplicates.ts`
  Signature: `checkDuplicates(prisma, scope): Promise<QualityDuplicatesResult>`
  Uses `prisma.dish.groupBy({ by: ['name', 'restaurantId', 'sourceId'], _count: { _all: true }, having: { name: { _count: { gt: 1 } } } })` as specified in Edge Cases §9. Then, for each group, fetches `dishIds` via `prisma.dish.findMany({ where: { name, restaurantId, sourceId }, select: { id: true } })`. Sorts groups by `_count._all DESC, name ASC`. Returns full `groups` array (no cap — cap is applied in the route/assembleReport for API).

- `packages/api/src/quality/checkConfidenceDistribution.ts`
  Signature: `checkConfidenceDistribution(prisma, scope): Promise<QualityConfidenceDistributionResult>`
  Queries: `prisma.dish.groupBy({ by: ['confidenceLevel'] })` with `_count`, `prisma.dish.groupBy({ by: ['estimationMethod'] })` with `_count`. For `byChain`: use two groupBy queries including `restaurantId` — `prisma.dish.groupBy({ by: ['confidenceLevel', 'restaurantId'], _count: { _all: true } })` and `prisma.dish.groupBy({ by: ['estimationMethod', 'restaurantId'], _count: { _all: true } })`. Then do a single `prisma.restaurant.findMany({ select: { id: true, chainSlug: true } })` to build a `restaurantId → chainSlug` lookup map. Merge in JS by replacing `restaurantId` with `chainSlug` and aggregating counts per chain (multiple restaurants can share a chainSlug). This avoids loading all dishes into memory.

- `packages/api/src/quality/checkDataFreshness.ts`
  Signature: `checkDataFreshness(prisma, scope, stalenessThresholdDays): Promise<QualityDataFreshnessResult>`
  Note: this check takes a third parameter `stalenessThresholdDays` (integer). When `scope.chainSlug` is set, first resolves the set of `sourceId`s via `SELECT DISTINCT source_id FROM dishes WHERE restaurant_id IN (SELECT id FROM restaurants WHERE chain_slug = ?)` using `prisma.$queryRaw`. Then queries `prisma.dataSource.findMany({ where: { id: { in: sourceIds } } })`. Computes staleness in JS: `lastUpdated === null` OR `lastUpdated < new Date(Date.now() - stalenessThresholdDays * 86400000)`. `daysSinceUpdate` computed as `Math.floor((Date.now() - lastUpdated.getTime()) / 86400000)` or `null`.

- `packages/api/src/quality/assembleReport.ts`
  Signature: `assembleReport(prisma, scope: { chainSlug?: string }, stalenessThresholdDays: number): Promise<QualityReportData>`
  Calls all six checks via `Promise.all([...])`. Any rejection propagates (no partial results, per Edge Case §10). Assembles the `QualityReportData` object with `generatedAt: new Date().toISOString()`, `totalDishes`, `totalRestaurants`, and all check results. `totalDishes` and `totalRestaurants` come from `prisma.dish.count()` and `prisma.restaurant.count()` also run in parallel. Returns full `groups` array (no cap here). After all checks resolve, computes `chainSummary[]` from the `byChain` arrays of checks 1, 2, and 4 — no extra DB queries. For each unique chainSlug found in any byChain result: `{ chainSlug, totalDishes, nutrientCoveragePercent, issueCount }`. Sorted by `issueCount DESC`. Returns typed `QualityReportData`.

- `packages/api/src/quality/index.ts`
  Re-exports all six check functions and `assembleReport` from their respective files.

**Step 4 — Unit test for assembleReport**
- `packages/api/src/__tests__/quality/assembleReport.test.ts`
  Mocks all six check functions + `prisma.dish.count` + `prisma.restaurant.count`. Verifies `Promise.all` orchestration, correct field assembly, full duplicate groups returned (no cap — cap is route-level), `chainSummary` correctly aggregated from byChain results and sorted by issueCount DESC, and error propagation (one rejected check rejects the whole assembly).

**Step 5 — Route**
- `packages/api/src/routes/quality.ts`
  Fastify plugin (wrapped with `fastify-plugin`). Plugin options: `{ prisma: PrismaClient }`. Registers `GET /quality/report`. Uses `QualityReportQuerySchema` from `@foodxplorer/shared` for `querystring`. Calls `assembleReport(prisma, { chainSlug }, stalenessThresholdDays)`. Before returning, applies the 50-group cap: `data.duplicates.groups = data.duplicates.groups.slice(0, 50)`. On success returns `{ success: true, data }`. On `PrismaClientKnownRequestError` or any DB error, throws `Object.assign(new Error('...'), { code: 'DB_UNAVAILABLE' })` so `mapError` returns 500. Validation errors from Zod/Fastify already handled by the global error handler.

**Step 6 — Route integration test**
- `packages/api/src/__tests__/routes/quality.test.ts`
  Uses real test DB (`DATABASE_URL_TEST`). Fixture namespace `e100` (e.g. `e1000000-0001-4000-a000-000000000001`). `beforeAll` creates: 1 dataSource, 2 restaurants (different chainSlugs), 3 dishes (one without nutrients, one with ghost-row nutrients, one with valid nutrients), 1 dishNutrient with all-zero macros, 1 dishNutrient with plausible values. `afterAll` deletes in reverse FK order. Tests: 200 full report, `?chainSlug=...` scopes correctly, `?stalenessThresholdDays=0` returns 400 VALIDATION_ERROR, unknown chainSlug returns 200 with zeroes, Prisma error returns 500 DB_UNAVAILABLE (inject a mock prisma that rejects).

**Step 7 — CLI script**
- `packages/api/src/scripts/quality-monitor.ts`
  Exports `runQualityMonitor(opts, prismaOverride?)` function (DI for testability). CLI wrapper at bottom reads `process.argv`. Parses `--chainSlug`, `--staleness-days` (default 90), `--format` (default `markdown`), `--output`. Instantiates `prisma` from `../../lib/prisma.js` unless overridden. Calls `assembleReport`. Formats output as JSON or Markdown. Writes to file (if `--output`) or stdout. Exit code 0 on success, 1 on DB connection failure.
  Markdown format sections: summary table (totalDishes, totalRestaurants, generatedAt, scope), then one section per quality dimension with bullet points and chain tables where applicable.

**Step 8 — CLI unit test**
- `packages/api/src/__tests__/scripts/quality-monitor.test.ts`
  Mocks `assembleReport` (or injects a mock prisma). Tests: JSON output matches `QualityReportData` shape, Markdown output contains expected section headers, `--output` writes to a temp file, DB error causes exit code 1.

---

### Files to Modify

- `packages/shared/src/index.ts`
  Add `export * from './schemas/qualityReport';` at the end of the barrel.

- `packages/api/src/app.ts`
  Import `qualityRoutes` from `./routes/quality.js`. Register with `await app.register(qualityRoutes, { prisma: prismaClient })` after the existing route registrations.

- `packages/api/package.json`
  Add npm script: `"quality:report": "tsx src/scripts/quality-monitor.ts"` (follows pattern of `ingest:batch` and `ingest:batch-images`).

- `packages/api/src/errors/errorHandler.ts`
  No new error codes are needed. `VALIDATION_ERROR` (400) and `DB_UNAVAILABLE` (500) are already handled. No changes required unless the developer finds a gap during implementation.

---

### Implementation Order

Following DDD layer order: Shared types → Domain (check functions) → Application (assembleReport) → Presentation (route + CLI). TDD: tests for each layer written immediately before its implementation.

1. **`packages/shared/src/schemas/qualityReport.ts`** — Define all 15 Zod schemas. This is the single source of truth; everything else depends on it.

2. **`packages/shared/src/index.ts`** — Add the barrel export for `qualityReport`.

3. **Unit tests for `checkNutrientCompleteness`** (`packages/api/src/__tests__/quality/checkNutrientCompleteness.test.ts`) — Write tests first (TDD). Mock PrismaClient.

4. **`packages/api/src/quality/types.ts`** and **`packages/api/src/quality/checkNutrientCompleteness.ts`** — Implement to make tests pass.

5. **Unit tests for `checkImplausibleValues`** (`packages/api/src/__tests__/quality/checkImplausibleValues.test.ts`) — Write tests first.

6. **`packages/api/src/quality/checkImplausibleValues.ts`** — Implement.

7. **Unit tests for `checkDataGaps`** (`packages/api/src/__tests__/quality/checkDataGaps.test.ts`) — Write tests first.

8. **`packages/api/src/quality/checkDataGaps.ts`** — Implement.

9. **Unit tests for `checkDuplicates`** (`packages/api/src/__tests__/quality/checkDuplicates.test.ts`) — Write tests first.

10. **`packages/api/src/quality/checkDuplicates.ts`** — Implement.

11. **Unit tests for `checkConfidenceDistribution`** (`packages/api/src/__tests__/quality/checkConfidenceDistribution.test.ts`) — Write tests first.

12. **`packages/api/src/quality/checkConfidenceDistribution.ts`** — Implement.

13. **Unit tests for `checkDataFreshness`** (`packages/api/src/__tests__/quality/checkDataFreshness.test.ts`) — Write tests first. Include: `lastUpdated = null` treated as stale, daysSinceUpdate computation, chainSlug scope resolving sourceIds.

14. **`packages/api/src/quality/checkDataFreshness.ts`** — Implement.

15. **Unit tests for `assembleReport`** (`packages/api/src/__tests__/quality/assembleReport.test.ts`) — Write tests first: all checks called in parallel, full groups returned (no cap), any check rejection propagates.

16. **`packages/api/src/quality/assembleReport.ts`** and **`packages/api/src/quality/index.ts`** — Implement.

17. **Route integration test** (`packages/api/src/__tests__/routes/quality.test.ts`) — Write tests against real test DB before implementing the route.

18. **`packages/api/src/routes/quality.ts`** — Implement Fastify plugin.

19. **`packages/api/src/app.ts`** — Register `qualityRoutes` plugin.

20. **CLI unit test** (`packages/api/src/__tests__/scripts/quality-monitor.test.ts`) — Write tests first.

21. **`packages/api/src/scripts/quality-monitor.ts`** — Implement CLI script.

---

### Testing Strategy

**Unit tests (mocked Prisma) — steps 3–15**

Each check function test file follows this structure:
- Create a typed mock of PrismaClient using `vi.fn()` for each Prisma method the check calls (e.g. `prisma.dish.count`, `prisma.dishNutrient.findMany`, `prisma.dish.groupBy`)
- Cast as `PrismaClient` via `as unknown as PrismaClient`
- Use `beforeEach(() => vi.clearAllMocks())`

Key scenarios per check:
- `checkNutrientCompleteness`: empty DB returns all zeroes and `dishesWithoutNutrientsPercent: 0` (division-by-zero guard); 3 dishes 2 without nutrients returns `dishesWithoutNutrients: 2`; all-4-zero macros counted in `ghostRowCount`; single-zero calories counted in `zeroCaloriesCount`; `byChain` groups correctly; `chainSlug` scope applied to `where` clause
- `checkImplausibleValues`: calories 5001 counted; calories 5000 not counted; ghost row (all four === 0); round calories 200 flagged; round calories 50 (< 100) not flagged; Decimal `.toNumber()` applied before comparison; `byChain` groups correctly
- `checkDataGaps`: dishes missing `portionGrams` counted; dishes missing `priceEur` counted; `restaurantsWithoutDishes` only in global scope; chainSlug scope excludes `restaurantsWithoutDishes`
- `checkDuplicates`: no duplicates returns empty groups; duplicate group of 3 dishes counted; sorting by count DESC then name ASC; `dishIds` array populated; scope applied
- `checkConfidenceDistribution`: counts by `confidenceLevel` and `estimationMethod`; `byChain` breakdown; scoped to chainSlug
- `checkDataFreshness`: `lastUpdated = null` is stale; `daysSinceUpdate` is null when `lastUpdated = null`; date within threshold not stale; date outside threshold stale; chainSlug scope uses `$queryRaw` to resolve sourceIds; empty scope returns all sources

**Integration test (real test DB) — step 17**

Fixture namespace: `e1` prefix, e.g. `e1000000-0001-4000-a000-000000000001`. Use the `fd` namespace pattern from `migration.f002.integration.test.ts`.

Fixture setup in `beforeAll`:
- 1 `dataSource` row with `lastUpdated` set to a stale date (> 90 days ago)
- 2 `restaurant` rows: `chainSlug: 'test-chain-a'` and `chainSlug: 'test-chain-b'`
- 5 `dish` rows: 3 in chain-a (one without `dishNutrient`, two with same name for duplicate testing), 2 in chain-b
- 3 `dishNutrient` rows: one with all-zero macros (ghost row), one with plausible values, one with suspiciously round calories (e.g. 500)
- The two same-name dishes in chain-a share `(name, restaurantId, sourceId)` to exercise the duplicates dimension

`afterAll` teardown in reverse FK order: `dishNutrient` → `dish` → `restaurant` → `dataSource`

Test assertions:
- `GET /quality/report` returns 200 with valid `QualityReportResponse` shape (parse with `QualityReportResponseSchema`)
- Response includes `totalDishes: 5`, `nutrientCompleteness.dishesWithoutNutrients: 1`, `nutrientCompleteness.ghostRowCount: 1`
- `duplicates.duplicateGroupCount: 1`, `duplicates.totalDuplicateDishes: 2`
- `implausibleValues.suspiciouslyRoundCalories >= 1` (from 500 kcal fixture)
- `?chainSlug=test-chain-a` scopes `totalDishes` to 3
- `?chainSlug=nonexistent-slug` returns 200 with `totalDishes: 0`
- `?stalenessThresholdDays=0` returns 400 with `error.code: 'VALIDATION_ERROR'`
- `?stalenessThresholdDays=999999` (very large) marks stale source as fresh
- Mock-prisma test: `buildApp({ prisma: prismaThatRejects })` → `GET /quality/report` returns 500 with `error.code: 'DB_UNAVAILABLE'`

**Mocking strategy**:
- Check function unit tests: mock PrismaClient methods with `vi.fn()` (no real DB)
- `assembleReport` unit test: mock the six check functions via `vi.mock(...)` and mock `prisma.dish.count` / `prisma.restaurant.count`
- Route integration test: real test DB for happy path; injectable mock PrismaClient for DB_UNAVAILABLE case (reuses `buildApp({ prisma: mockPrisma })` pattern from `health.test.ts`)
- CLI unit test: mock `assembleReport` or inject a mock PrismaClient to avoid real DB

---

### Key Patterns

**Fastify plugin registration** (`packages/api/src/routes/health.ts`):
- Route file exports a `FastifyPluginAsync<{ prisma: PrismaClient }>` function
- Wrapped with `fastify-plugin` at the bottom
- Registered in `app.ts` via `app.register(qualityRoutes, { prisma: prismaClient })`
- `querystring: QualityReportQuerySchema` passed in the route `schema` object for Zod validation via `fastify-type-provider-zod`

**DB error throw pattern** (`packages/api/src/routes/ingest/pdf-url.ts`):
```
throw Object.assign(new Error('Database query failed during quality report generation'), { code: 'DB_UNAVAILABLE' });
```
Wrap `assembleReport` call in a `try/catch` that catches `Prisma.PrismaClientKnownRequestError`, `Prisma.PrismaClientUnknownRequestError`, and any other error, then rethrows with `code: 'DB_UNAVAILABLE'`.

**Decimal → number conversion** (mandatory per spec Edge Case §4):
- Every check function must call `.toNumber()` on every Prisma `Decimal` field before returning or comparing
- `Number(calories) % 100 === 0` for the round-calories check (not `calories % 100`)
- Never pass `Decimal` objects into Zod schemas — schemas expect `number`

**`prisma.dish.groupBy` for duplicates** (spec Edge Case §9):
```typescript
prisma.dish.groupBy({
  by: ['name', 'restaurantId', 'sourceId'],
  _count: { _all: true },
  having: { name: { _count: { gt: 1 } } },
})
```
Note: `having` in Prisma groupBy requires the count to be on one of the `by` fields. Cross-check this against the actual Prisma version in the repo (`packages/api/package.json`). If the `having` clause doesn't work as expected, fall back to filtering in JS after groupBy without `having`.

**chainSlug scope resolution for checkDataFreshness**:
Use `prisma.$queryRaw<Array<{ source_id: string }>>` to get distinct source IDs. **IMPORTANT:** `$queryRaw` returns column names in PostgreSQL snake_case (`source_id`), not Prisma camelCase (`sourceId`). Access results via `row.source_id`. Then pass as `id: { in: sourceIds }` to `prisma.dataSource.findMany`. This avoids a complex multi-join.

**Test fixture UUID namespace**:
- Route integration tests for F018: use `e1` prefix — `e1000000-00XX-4000-a000-000000000YYY`
- Check function unit tests use mocked Prisma — no real UUIDs needed

**50-group duplicate cap**:
- `checkDuplicates` and `assembleReport` return the full groups array (no cap)
- The route (`quality.ts`) applies `data.duplicates.groups = data.duplicates.groups.slice(0, 50)` before returning to the client
- CLI script calls `assembleReport` and outputs the full list (no cap)

**Gotcha — `checkDataFreshness` third parameter**:
Unlike the other five checks, `checkDataFreshness` takes `stalenessThresholdDays` as a third parameter. `assembleReport` must pass this value through. The `assembleReport` signature becomes:
```typescript
assembleReport(prisma, scope: { chainSlug?: string }, stalenessThresholdDays: number): Promise<QualityReportData>
```

**Gotcha — `restaurantsWithoutDishes` scope rule**:
When `chainSlug` is provided, `restaurantsWithoutDishes` should return `0` (not query all restaurants globally). The check function must conditionally skip or return 0 based on `scope.chainSlug`. Document this with a comment in the implementation.

**Gotcha — `QualityReportQuerySchema` coercion**:
Fastify passes query params as strings. Use `z.coerce.number().int().min(1).default(90)` for `stalenessThresholdDays` so the string `"30"` is coerced to `30`. Without `.coerce`, Zod would reject it as not-a-number.

**No Kysely here**:
All quality checks use aggregation counts, `groupBy`, and simple filters — these fall within Prisma's capabilities. The `prisma.$queryRaw` call for distinct source IDs in `checkDataFreshness` is the only raw SQL needed. Do not introduce Kysely for this feature.

---

## Acceptance Criteria

- [x] `packages/shared/src/schemas/qualityReport.ts` exists with all 15 schemas
- [x] `packages/api/src/quality/` contains 6 check files + `assembleReport.ts` + `index.ts`
- [x] `GET /quality/report` registered as Fastify plugin in `packages/api/src/routes/quality.ts`
- [x] `GET /quality/report` returns valid `QualityReportResponse` against real DB
- [x] `?chainSlug=mcdonalds-es` scopes all six dimensions to McDonald's data only
- [x] `?stalenessThresholdDays=30` changes the freshness check threshold
- [x] `GET /quality/report` with unknown chainSlug returns HTTP 200 with all-zero counts
- [x] `GET /quality/report` with `stalenessThresholdDays=0` returns HTTP 400 VALIDATION_ERROR
- [x] CLI script `quality-monitor.ts` outputs valid JSON when `--format json`
- [x] CLI script outputs readable Markdown when `--format markdown`
- [x] Unit tests for all 6 check functions (TDD — tests written first)
- [x] Integration test: `GET /quality/report` against seeded test DB
- [x] No `any` types anywhere in the quality module
- [x] All existing tests continue to pass

---

## Definition of Done

- [x] All acceptance criteria met
- [x] TDD: unit tests written before implementation for all check functions
- [x] TypeScript strict mode — no `any`, no unhandled `Decimal` conversions
- [x] Zod schemas in `packages/shared/src/schemas/qualityReport.ts` are single source of truth
- [x] API spec updated (done — see `docs/specs/api-spec.yaml`)
- [x] No new linting errors
- [x] Build succeeds

---

## Workflow Checklist

- [x] Step 0: Spec created, api-spec.yaml updated
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: Implementation plan written
- [x] Step 3: Implementation with TDD
- [x] Step 4: Quality gates pass, production-code-validator run
- [x] Step 5: PR created, code-review-specialist + qa-engineer run
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-17 | Spec | api-spec.yaml updated with GET /quality/report, 14 component schemas |
| 2026-03-17 | Setup | Branch + ticket created |
| 2026-03-17 | Plan | 21-step TDD implementation plan written by backend-planner |
| 2026-03-17 | Implement (Step 3) | 21 files created, 3 modified. 69 unit tests (TDD). 15 Zod schemas, 6 check functions, assembleReport, route, CLI. Commit `ea041ad` |
| 2026-03-17 | Finalize (Step 4) | 105 tests pass (10 files), 0 new lint errors, build succeeds. production-code-validator APPROVED |
| 2026-03-17 | Review (Step 5) | PR #16. code-review-specialist: 1 Critical (checkImplausibleValues memory) + 4 Important (N+1 queries, type assertion, CLI flag) + 4 Suggestions. qa-engineer: 1 bug (chainSlug .max(100)) + 37 edge-case tests. All findings fixed in commit `d44bc19`. Final: 105 quality tests pass |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Implementation Plan, Acceptance Criteria, Definition of Done, Workflow Checklist, Completion Log, Merge Checklist Evidence (7/7) |
| 1. Mark all items | [x] | AC: 14/14, DoD: 7/7, Workflow: 0-5/6 (Step 6 pending) |
| 2. Verify product tracker | [x] | Active Session: step 5/6 (Review), Features table: 5/6 |
| 3. Update key_facts.md | [x] | Updated: quality route, quality check module, quality CLI script, quality report schemas |
| 4. Update decisions.md | [x] | N/A — no new ADRs needed for F018 |
| 5. Commit documentation | [x] | Commit: `da470ec` |
| 6. Verify clean working tree | [x] | `git status`: clean |
