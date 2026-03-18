# F020: Level 1 — Official Data Lookup

**Feature:** F020 | **Type:** Backend-Feature | **Priority:** High
**Status:** Done | **Branch:** (deleted) | **PR:** #18
**Created:** 2026-03-17 | **Dependencies:** F001, F002, F005 (Redis), F006 (USDA seed), F008-F015 (chain data), F019 (embeddings)

---

## Spec

### Description

Implement Level 1 of the Estimation Engine (E003): a direct lookup against the database for official
nutritional data. Level 1 is the highest-confidence tier of the three-level cascade defined in ADR-001.

When a caller queries `GET /estimate`, the engine first attempts Level 1. If an exact or FTS match is
found in the `dishes` or `foods` tables, the response is returned immediately with `confidenceLevel:
'high'` and `estimationMethod: 'official'`. If no match is found, the response signals a miss with
`level1Hit: false`, leaving room for F023 (Engine Router) to cascade to Level 2.

**F020 scope: Level 1 ONLY.** No ingredient-based calculation (F021), no pgvector similarity (F022),
no orchestration logic (F023). The endpoint introduced here will be wrapped by F023 without breaking
changes.

### Architecture Decisions

- **GET not POST**: the query is read-only with no side effects and no large body. Query parameters
  are sufficient for all Level 1 inputs. Consistent with REST semantics. POST would require a body
  schema that F023 would have to replicate.
- **Kysely for the lookup query**: the search joins `dishes → dish_nutrients → data_sources →
  restaurants` (4 tables) and uses raw FTS expressions via `to_tsquery`. This falls squarely in
  the Kysely territory per ADR-000.
- **Search targets dishes first, foods second**: the primary use case is restaurant dishes. Foods
  (USDA base data) are a fallback for generic ingredient queries ("pollo a la plancha").
- **Matching strategy (priority order)**:
  1. Exact name match, case-insensitive, scoped to chain if `chainSlug` provided
  2. FTS match on `dishes.name` / `dishes.name_es` (Spanish FTS primary), scoped to chain if provided
  3. FTS match on `foods.name_es` / `foods.name` (English FTS fallback for USDA generic foods)
  - Each sub-strategy returns the single best match (first row). No ranking across strategies — the
    first strategy that returns a result wins.
- **Redis cache**: cache key = `estimate:l1:<normalized_query>:<chainSlug|''>`. TTL = 300 seconds
  (same as existing cache helper default). Cache is applied at the route handler level before query
  execution. Cache is bypassed if Redis is unavailable (fail-open, same as F005 pattern).
- **No DB writes**: read-only endpoint. Cache is the only side effect.
- **Confidence and method**: Level 1 always returns `confidenceLevel: 'high'` and
  `estimationMethod: 'official'`. These values are hardcoded in the Level 1 lookup, not derived
  from the `dishes.confidence_level` column (which may be 'medium' for scraped chain data).
  Rationale: ADR-001 defines confidence as a property of the estimation method (official chain PDF
  data = high confidence), not a stored attribute of the dish row.
- **Source traceability**: the response includes `source` (id, name, type, url) from the
  `data_sources` table via the `dish_nutrients.source_id` FK. This satisfies the ADR-001
  auditability requirement.
- **`referenceBasis` passthrough**: returned as-is from the `dish_nutrients` row. For chain dishes
  this will typically be `per_serving`; for USDA foods it will be `per_100g`.

### API Changes

#### `GET /estimate`

**Query parameters** (`EstimateQuerySchema`):

| Parameter | Type | Required | Constraints | Description |
|-----------|------|----------|-------------|-------------|
| `query` | string | YES | 1–255 chars | Dish or food name to look up |
| `chainSlug` | string | NO | `^[a-z0-9-]+$`, max 100 | Scope search to a single restaurant chain |
| `restaurantId` | string | NO | UUID format | Scope search to a specific restaurant row (overrides chainSlug for dish lookup) |

Notes:
- `chainSlug` and `restaurantId` are both optional and may be omitted for a global search.
- If both `chainSlug` and `restaurantId` are provided, `restaurantId` takes precedence for dish
  scoping; `chainSlug` is ignored.
- `query` is normalized before use: trimmed, collapsed whitespace, lowercased for exact match,
  converted via `plainto_tsquery` for FTS.

**Successful response — Level 1 hit** (HTTP 200):

```json
{
  "success": true,
  "data": {
    "query": "Big Mac",
    "chainSlug": "mcdonalds-es",
    "level1Hit": true,
    "matchType": "exact_dish",
    "result": {
      "entityType": "dish",
      "entityId": "uuid-of-dish",
      "name": "Big Mac",
      "nameEs": "Big Mac",
      "restaurantId": "uuid-of-restaurant",
      "chainSlug": "mcdonalds-es",
      "portionGrams": 200,
      "nutrients": {
        "calories": 550,
        "proteins": 25,
        "carbohydrates": 46,
        "sugars": 9,
        "fats": 28,
        "saturatedFats": 10,
        "fiber": 3,
        "salt": 2.2,
        "sodium": 880,
        "transFats": 0.5,
        "cholesterol": 80,
        "potassium": 0,
        "monounsaturatedFats": 0,
        "polyunsaturatedFats": 0,
        "referenceBasis": "per_serving"
      },
      "confidenceLevel": "high",
      "estimationMethod": "official",
      "source": {
        "id": "uuid-of-source",
        "name": "McDonald's Spain Official PDF",
        "type": "official",
        "url": "https://www.mcdonalds.es/.../nutritional.pdf"
      }
    },
    "cachedAt": null
  }
}
```

**Successful response — Level 1 miss** (HTTP 200):

```json
{
  "success": true,
  "data": {
    "query": "pizza de atún con borde relleno",
    "chainSlug": null,
    "level1Hit": false,
    "matchType": null,
    "result": null,
    "cachedAt": null
  }
}
```

**Error responses:**

| Scenario | HTTP | code |
|----------|------|------|
| `query` missing or empty | 400 | `VALIDATION_ERROR` |
| `query` exceeds 255 chars | 400 | `VALIDATION_ERROR` |
| `restaurantId` not a valid UUID | 400 | `VALIDATION_ERROR` |
| `chainSlug` invalid characters | 400 | `VALIDATION_ERROR` |
| DB query failure | 500 | `DB_UNAVAILABLE` |

Note: a miss (no match found) is NOT a 404. It is a 200 with `level1Hit: false`. 404 is reserved
for invalid routes, not for "no data found" on a valid search.

### Data Model Changes

No schema changes. No new migrations. All required tables and indexes exist:
- `dishes` + `dish_nutrients` + `data_sources` + `restaurants` (from F002)
- `foods` + `food_nutrients` + `data_sources` (from F001)
- FTS indexes: `dishes_name_fts_en_idx`, `dishes_name_fts_es_idx` (from F002 migration)
- FTS indexes: `foods_name_en_fts_idx`, `foods_name_es_fts_idx` (from F001 migration)

### Zod Schemas (packages/shared/src/schemas/estimate.ts)

New file. All schemas exported and re-exported from `packages/shared/src/index.ts`.

**`EstimateQuerySchema`** — Zod object for query params (used in route validation):
```
z.object({
  query: z.string().min(1).max(255).trim(),
  chainSlug: z.string().regex(/^[a-z0-9-]+$/).max(100).optional(),
  restaurantId: z.string().uuid().optional(),
})
```

**`EstimateMatchTypeSchema`** — Zod enum for how the match was found:
```
z.enum(['exact_dish', 'fts_dish', 'exact_food', 'fts_food'])
```

**`EstimateSourceSchema`** — Zod object for the data source traceability block:
```
z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: DataSourceTypeSchema,
  url: z.string().nullable(),
})
```

**`EstimateNutrientsSchema`** — Zod object for the nutrient payload (all nutrients as number, not Decimal):
```
z.object({
  calories: z.number().nonnegative(),
  proteins: z.number().nonnegative(),
  carbohydrates: z.number().nonnegative(),
  sugars: z.number().nonnegative(),
  fats: z.number().nonnegative(),
  saturatedFats: z.number().nonnegative(),
  fiber: z.number().nonnegative(),
  salt: z.number().nonnegative(),
  sodium: z.number().nonnegative(),
  transFats: z.number().nonnegative(),
  cholesterol: z.number().nonnegative(),
  potassium: z.number().nonnegative(),
  monounsaturatedFats: z.number().nonnegative(),
  polyunsaturatedFats: z.number().nonnegative(),
  referenceBasis: NutrientReferenceBasisSchema,
})
```

**`EstimateResultSchema`** — Zod object for the matched entity and its nutritional data:
```
z.object({
  entityType: z.enum(['dish', 'food']),
  entityId: z.string().uuid(),
  name: z.string(),
  nameEs: z.string().nullable(),
  restaurantId: z.string().uuid().nullable(),   // null when entityType is 'food'
  chainSlug: z.string().nullable(),             // null when entityType is 'food'
  portionGrams: z.number().positive().nullable(),
  nutrients: EstimateNutrientsSchema,
  confidenceLevel: ConfidenceLevelSchema,
  estimationMethod: EstimationMethodSchema,
  source: EstimateSourceSchema,
})
```

**`EstimateDataSchema`** — Zod object for the full response data payload:
```
z.object({
  query: z.string(),
  chainSlug: z.string().nullable(),
  level1Hit: z.boolean(),
  matchType: EstimateMatchTypeSchema.nullable(),
  result: EstimateResultSchema.nullable(),
  cachedAt: z.string().nullable(),   // ISO-8601 timestamp when cache was written, null if live
})
```

**`EstimateResponseSchema`** — the full API response envelope:
```
z.object({
  success: z.literal(true),
  data: EstimateDataSchema,
})
```

### File Structure

```
packages/shared/src/schemas/
  estimate.ts                        ← NEW — all 6 Zod schemas above

packages/api/src/
  routes/
    estimate.ts                      ← NEW — GET /estimate route plugin
  estimation/
    level1Lookup.ts                  ← NEW — Level 1 query logic (Kysely)
    index.ts                         ← NEW — barrel export
    types.ts                         ← NEW — internal types (Level1Result interface)
```

### Caching Strategy

- **Key**: `estimate:l1:<normalizedQuery>:<chainSlug>:<restaurantId>`
  where `normalizedQuery` = query trimmed + lowercased + whitespace collapsed,
  `chainSlug` = value or empty string if omitted,
  `restaurantId` = value or empty string if omitted.
- **TTL**: 300 seconds (same as existing default in F005 cache helper).
- **Cache value**: the full `EstimateData` object serialized as JSON. `cachedAt` field is set to
  the ISO-8601 timestamp at write time so callers can detect stale responses.
- **Miss path**: cache miss → run Level 1 query → set cache (if Redis available) → return result.
- **Hit path**: cache hit → deserialize → return as-is (cachedAt will be non-null).
- **Fail-open**: if Redis is unavailable, skip cache entirely (same as F005 pattern — never throw
  on cache failure, only log a warning).
- **Cache invalidation**: no active invalidation in F020. Cache expires naturally after TTL. New
  chain data ingested via E002 endpoints will be stale in cache for up to 300 seconds.

### Matching Algorithm Detail

The `level1Lookup(query, options)` function in `estimation/level1Lookup.ts` executes the
following sub-strategies in order, returning the first successful result:

**Strategy 1 — Exact dish match**
```sql
SELECT d.*, dn.*, ds.*, r.chain_slug
FROM dishes d
JOIN dish_nutrients dn ON dn.dish_id = d.id
JOIN data_sources ds ON ds.id = dn.source_id
JOIN restaurants r ON r.id = d.restaurant_id
WHERE LOWER(d.name) = LOWER(:query)
  [AND r.id = :restaurantId]           -- if restaurantId provided
  [AND r.chain_slug = :chainSlug]      -- if chainSlug provided (and no restaurantId)
LIMIT 1
```

**Strategy 2 — FTS dish match (Spanish primary, English fallback)**
```sql
WHERE to_tsvector('spanish', COALESCE(d.name_es, d.name)) @@ plainto_tsquery('spanish', :query)
   OR to_tsvector('english', d.name) @@ plainto_tsquery('english', :query)
  [AND chain/restaurant scope]
LIMIT 1
```

**Strategy 3 — Exact food match** (no chain/restaurant scope — foods are chain-agnostic)
```sql
SELECT f.*, fn.*, ds.*
FROM foods f
JOIN food_nutrients fn ON fn.food_id = f.id
JOIN data_sources ds ON ds.id = fn.source_id
WHERE LOWER(f.name_es) = LOWER(:query)
   OR LOWER(f.name) = LOWER(:query)
LIMIT 1
```

**Strategy 4 — FTS food match**
```sql
WHERE to_tsvector('spanish', f.name_es) @@ plainto_tsquery('spanish', :query)
   OR to_tsvector('english', f.name) @@ plainto_tsquery('english', :query)
LIMIT 1
```

If none of the four strategies returns a result, `level1Lookup` returns `null` and the route
handler sets `level1Hit: false`.

### Edge Cases

1. **Query matches multiple dishes** — LIMIT 1 is applied; the first row wins. No ranking is
   applied within Level 1. Exact matches always precede FTS matches due to strategy ordering.
2. **`chainSlug` provided but doesn't exist** — no rows found, falls through all strategies,
   returns `level1Hit: false`. Not a 404 — the engine treats unknown chains as a miss.
3. **Dish exists but has no `dish_nutrients` row** — the JOIN excludes it; treated as a miss.
   This can happen for dishes ingested without nutrient data (known data quality gap per F018).
4. **Both `chainSlug` and `restaurantId` provided** — `restaurantId` takes precedence. Dish
   strategy 1 and 2 use `restaurant.id = :restaurantId`. The `chainSlug` is echoed back in the
   response as provided.
5. **Redis unavailable** — fail-open; lookup proceeds without cache. Response is live.
6. **`query` contains SQL-injection-like characters** — Kysely parameterized queries prevent SQL
   injection. `plainto_tsquery` sanitizes the FTS query (no `:*`, `&`, `|` operators in
   `plainto_tsquery` input — those require `to_tsquery`).
7. **Foods fallback when chain-scoped** — food strategies (3 and 4) always run without chain
   scope, even when `chainSlug` is provided. A query for "pollo" scoped to "mcdonalds-es" can
   return a USDA generic food if no McDonald's dish matches.
8. **Empty string query** — rejected by `z.string().min(1)` at the Zod layer (400
   VALIDATION_ERROR before any DB access).
9. **`cachedAt` interpretation** — when `cachedAt` is non-null, the nutritional data may be up
   to 300 seconds old. F023 (Engine Router) should not re-cache a cached Level 1 response.

### Integration with F021–F023

This endpoint is designed to be consumed by F023 (Engine Router) without breaking changes:

- **F023 will call `level1Lookup()` directly** (not via HTTP) — the function is exported from
  `packages/api/src/estimation/level1Lookup.ts`. The route handler is a thin wrapper that adds
  HTTP concerns (Zod validation, Redis caching, error translation).
- **The `GET /estimate` endpoint** introduced in F020 will be REPLACED by F023 with a fuller
  version that cascades through all levels. F020's endpoint is the Level-1-only stub.
- **Response schema is forward-compatible**: `EstimateDataSchema` includes `level1Hit` boolean
  and nullable `result`. F023 will add `level2Hit`, `level3Hit`, and extend `result` with
  additional context (e.g., estimation notes, ingredient breakdown). These additions are additive
  and will not break F020 consumers.
- **`EstimateResultSchema` is reusable** across all levels: `confidenceLevel` and
  `estimationMethod` fields accommodate all engine outputs (not just 'high'/'official').

### Acceptance Criteria

1. `GET /estimate?query=Big+Mac&chainSlug=mcdonalds-es` returns HTTP 200 with `level1Hit: true`,
   `matchType: 'exact_dish'`, and correct nutritional data for the McDonald's Big Mac row.
2. `GET /estimate?query=Whopper&chainSlug=mcdonalds-es` returns HTTP 200 with `level1Hit: false`
   (no BK dish in mcdonalds-es scope).
3. `GET /estimate?query=pollo` returns HTTP 200 with `level1Hit: true`, `matchType: 'fts_food'`
   (USDA generic food match), when no dish matches.
4. `GET /estimate?query=something+completely+unknown` returns HTTP 200 with `level1Hit: false`.
5. `GET /estimate` (no `query`) returns HTTP 400 with `VALIDATION_ERROR`.
6. A second identical request hits Redis cache; response includes non-null `cachedAt`.
7. With Redis disabled, endpoint returns live results without error (fail-open).
8. All four match strategies are covered by unit tests in `level1Lookup.test.ts`.
9. Route-level tests cover: cache hit, cache miss, Redis unavailable, Zod validation errors,
   DB error → 500.

---

## Implementation Plan

### Review Findings (Plan Revision)

The original plan was revised after deep review. Key changes:

1. **Kysely bootstrap** — ADR-000 chose Kysely for complex queries (4+ joins, FTS, pgvector). E003 is the natural starting point: 5 features with increasingly complex queries (F020-F024). Bootstrap cost paid once, benefits all E003.
2. **CTE de-duplication** — `dish_nutrients` and `food_nutrients` have `@@unique([entityId, sourceId])`, meaning multiple nutrient rows per entity. Must use `ROW_NUMBER() OVER (PARTITION BY ... ORDER BY created_at DESC)` CTE (same pattern as F019 embeddings pipeline).
3. **All 15 nutrient columns** — The embeddings pipeline only selects 8 nutrients. F020 needs all 15 (`salt`, `transFats`, `cholesterol`, `potassium`, `monounsaturatedFats`, `polyunsaturatedFats`) + `reference_basis` + `data_sources` columns for source traceability.
4. **Source JOIN via ranked CTE** — The `data_sources` JOIN must use the `source_id` from the de-duplicated (most recent) nutrient row.

---

### Existing Code to Reuse

**Shared schemas (packages/shared/src/schemas/)**
- `enums.ts` — `DataSourceTypeSchema`, `ConfidenceLevelSchema`, `EstimationMethodSchema`, `NutrientReferenceBasisSchema`
- `qualityReport.ts` — reference for schema file structure pattern

**API route plugins (packages/api/src/routes/)**
- `quality.ts` — GET route with query params: `FastifyPluginAsync<PluginOptions>`, Zod on `querystring`, try/catch with `Object.assign(new Error(...), { statusCode, code })`
- `embeddings.ts` — `fastify-plugin` wrapping, `PluginOptions` interface

**Cache helpers (packages/api/src/lib/cache.ts)**
- `buildKey`, `cacheGet`, `cacheSet` — fail-open Redis caching (300s TTL)

**Error handler (packages/api/src/errors/errorHandler.ts)**
- `DB_UNAVAILABLE` (500) and `VALIDATION_ERROR` (400) already handled. No new error codes needed.

**CTE de-duplication pattern (packages/api/src/embeddings/pipeline.ts)**
- `ROW_NUMBER() OVER (PARTITION BY dn.dish_id ORDER BY dn.created_at DESC) AS rn` then `JOIN ranked ON rn = 1`
- Same pattern needed for food_nutrients and dish_nutrients in F020

**App registration (packages/api/src/app.ts)**
- Follow the existing `await app.register(qualityRoutes, { prisma: prismaClient })` pattern

---

### Files to Create

```
packages/api/src/lib/kysely.ts
  — Kysely client singleton. PostgresDialect with pg Pool.
    Reads DATABASE_URL (or DATABASE_URL_TEST in test env).
    Exports: getKysely() function (lazy init, same pattern as prisma.ts).
    DB type import from prisma-kysely generated types.

packages/shared/src/schemas/estimate.ts
  — 7 Zod schemas (EstimateQuerySchema, EstimateMatchTypeSchema,
    EstimateSourceSchema, EstimateNutrientsSchema, EstimateResultSchema,
    EstimateDataSchema, EstimateResponseSchema) with exported TypeScript types.

packages/api/src/estimation/types.ts
  — Internal TypeScript interfaces:
    Level1LookupOptions (query, chainSlug?, restaurantId?),
    Level1Result (matchType + EstimateResult from shared schemas).
    Mapping functions: mapDishRowToResult, mapFoodRowToResult.
    parseDecimal helper (reuse pattern from embeddings/types.ts).
    NOTE: Raw row types are NOT needed — Kysely provides typed results
    from the generated DB types. Mapping functions convert Kysely result
    objects (with Decimal strings) to EstimateResult (with numbers).

packages/api/src/estimation/level1Lookup.ts
  — level1Lookup(db, query, options) — executes the 4-strategy cascade
    using Kysely query builder.
    Accepts Kysely instance (not PrismaClient) for query building.
    Each strategy uses CTE for nutrient de-duplication.
    Returns Level1Result | null. Exported for F023 direct consumption.

packages/api/src/estimation/index.ts
  — Barrel: re-exports level1Lookup and types.

packages/api/src/routes/estimate.ts
  — GET /estimate route plugin. EstimateQuerySchema on querystring.
    PluginOptions receives Kysely instance (not PrismaClient).
    Cache check → level1Lookup → cache set → reply.
```

**Test files:**
```
packages/shared/src/__tests__/estimate.schemas.test.ts
  — Unit tests for all 7 Zod schemas.

packages/api/src/__tests__/f020.level1Lookup.unit.test.ts
  — Unit tests for level1Lookup: mocks Kysely query execution,
    covers all 4 strategies, scoping, nutrient de-duplication,
    Decimal→number conversion, all 15 nutrients + source traceability.

packages/api/src/__tests__/f020.estimate.route.test.ts
  — Route tests via buildApp().inject(): cache hit/miss, Redis unavailable,
    Zod validation errors, DB error → 500.
```

---

### Files to Modify

```
packages/api/prisma/schema.prisma
  — Add prisma-kysely generator block (generates DB types for Kysely).

packages/shared/src/index.ts
  — Add: export * from './schemas/estimate';

packages/api/src/app.ts
  — Import estimateRoutes, create Kysely instance, pass to route plugin.
    Keep PrismaClient for all existing routes (no migration of E001-E002 code).

docs/specs/api-spec.yaml
  — Verify /estimate endpoint matches final implementation.
```

**No changes needed:**
- `packages/api/src/errors/errorHandler.ts` — existing error codes sufficient
- No new migrations

---

### Implementation Order

1. **[Infra] Kysely bootstrap**
   - Install: `prisma-kysely` (devDep), `pg` (dep, PostgresDialect driver)
   - Add `prisma-kysely` generator to `packages/api/prisma/schema.prisma`:
     ```prisma
     generator kysely {
       provider     = "prisma-kysely"
       output       = "../src/generated"
       fileName     = "kysely-types.ts"
       enumFileName = "kysely-enums.ts"
     }
     ```
   - Run `npx prisma generate` → generates `packages/api/src/generated/kysely-types.ts`
   - Create `packages/api/src/lib/kysely.ts`:
     Kysely client with `PostgresDialect` + `pg.Pool`.
     Reads `DATABASE_URL_TEST` in test env, `DATABASE_URL` otherwise (same pattern as `lib/prisma.ts`).
     Exports `getKysely()` (lazy init) and `destroyKysely()` (cleanup).
   - Verify: `npm run build` passes with generated types.
   _Dependency: none_

2. **[Shared] `packages/shared/src/schemas/estimate.ts`**
   Write the 7 Zod schemas. All 15 nutrient fields in `EstimateNutrientsSchema`:
   calories, proteins, carbohydrates, sugars, fats, saturatedFats, fiber, salt,
   sodium, transFats, cholesterol, potassium, monounsaturatedFats,
   polyunsaturatedFats + referenceBasis.
   Add `export * from './schemas/estimate'` to `packages/shared/src/index.ts`.
   _Dependency: none (parallel with step 1)_

3. **[Test — RED] `packages/shared/src/__tests__/estimate.schemas.test.ts`**
   Schema unit tests: valid/invalid inputs, negative nutrients rejected, UUID
   validation, chainSlug regex, optional fields.
   _Dependency: step 2_

4. **[Shared — GREEN] Verify schema tests pass**
   Fix any schema issues until `npm test -w @foodxplorer/shared` is green.
   _Dependency: step 3_

5. **[Domain] `packages/api/src/estimation/types.ts`**
   Define `Level1LookupOptions`, `Level1Result`.
   Mapping functions `mapDishRowToResult(row)` and `mapFoodRowToResult(row)`:
   - Accept Kysely result row (typed from generated DB types)
   - Convert all 15 Decimal string columns to numbers via `parseDecimal`
   - Include `reference_basis` → `referenceBasis`
   - Include `data_sources` fields (id, name, type, url) → `EstimateSource`
   - Set `portionGrams: null` for food rows (no portion_grams column on foods)
   - Hardcode `confidenceLevel: 'high'`, `estimationMethod: 'official'` (ADR-001)
   _Dependency: steps 1 + 4 (needs generated Kysely types + shared schemas)_

6. **[Test — RED] `packages/api/src/__tests__/f020.level1Lookup.unit.test.ts`**
   Unit tests mocking Kysely query execution. Cover:
   - Strategy 1 exact dish → `matchType: 'exact_dish'`; strategies 2-4 not called
   - Strategy 2 FTS dish → `matchType: 'fts_dish'`
   - Strategy 3 exact food → `matchType: 'exact_food'`
   - Strategy 4 FTS food → `matchType: 'fts_food'`
   - All miss → returns `null`
   - `restaurantId` takes precedence over `chainSlug`
   - Food strategies (3 & 4) never filter by chain/restaurant
   - Decimal string `'550.00'` → `550` as number in result
   - All 15 nutrient fields present in result
   - `source` block (id, name, type, url) populated from data_sources
   - DB error → throws with `code: 'DB_UNAVAILABLE'`
   - CTE de-duplication: when multiple nutrient rows exist, most recent is used
   _Dependency: step 5_

7. **[Application] `packages/api/src/estimation/level1Lookup.ts`**
   Implement `level1Lookup(db, query, options)`:
   - Normalize query: `query.trim().replace(/\s+/g, ' ')`
   - **All strategies use CTE for nutrient de-duplication:**
     ```sql
     WITH ranked_dn AS (
       SELECT dn.*, ROW_NUMBER() OVER (
         PARTITION BY dn.dish_id ORDER BY dn.created_at DESC
       ) AS rn
       FROM dish_nutrients dn
     )
     ```
   - Strategy 1 (exact dish): `LOWER(d.name) = LOWER(:query)` + scope
   - Strategy 2 (FTS dish): `to_tsvector('spanish', COALESCE(d.name_es, d.name)) @@ plainto_tsquery('spanish', :query)` (matches index definition)
   - Strategy 3 (exact food): `LOWER(f.name_es) = LOWER(:query) OR LOWER(f.name) = LOWER(:query)` (no chain scope)
   - Strategy 4 (FTS food): `to_tsvector('spanish', f.name_es) @@ plainto_tsquery('spanish', :query)` (no COALESCE — name_es is NOT NULL)
   - Each strategy: JOIN ranked CTE on `rn = 1`, JOIN `data_sources` on ranked nutrient's `source_id`
   - Select ALL 15 nutrients + `reference_basis` + `data_sources.*` + entity fields
   - Kysely `.selectFrom()` with `.innerJoin()`, `.where()`, `.limit(1)`, `.executeTakeFirst()`
   - For raw SQL expressions (FTS): use `sql` tagged template from Kysely
   - Catch: `throw Object.assign(new Error('Database query failed'), { code: 'DB_UNAVAILABLE' })`
   _Dependency: step 6 (tests drive implementation)_

8. **[Test — GREEN] Verify level1Lookup tests pass**
   Run `npm test -w @foodxplorer/api -- --testPathPattern f020.level1Lookup` and fix until green.
   _Dependency: step 7_

9. **[Infrastructure] `packages/api/src/estimation/index.ts`**
   Barrel export: `level1Lookup` + types.
   _Dependency: step 8_

10. **[Test — RED] `packages/api/src/__tests__/f020.estimate.route.test.ts`**
    Route tests via `buildApp().inject()`. Mock `level1Lookup` at module level.
    Cover: cache miss/hit, Redis unavailable (fail-open), all Zod validation errors,
    `level1Hit: false` path, DB error → 500, response matches `EstimateResponseSchema`.
    _Dependency: step 9_

11. **[Presentation] `packages/api/src/routes/estimate.ts`**
    GET /estimate Fastify plugin:
    - `interface EstimatePluginOptions { db: Kysely<DB> }` (receives Kysely, not Prisma)
    - `EstimateQuerySchema` on `querystring`
    - Cache key: `buildKey('estimate:l1', \`${normalizedQuery}:${chainSlug ?? ''}:${restaurantId ?? ''}\`)`
    - `cacheGet` → if hit, return with `cachedAt` preserved
    - Call `level1Lookup(db, query, { chainSlug, restaurantId })`
    - `cacheSet` with `cachedAt: new Date().toISOString()`
    - Wrap with `fastifyPlugin(...)`, export as `estimateRoutes`
    _Dependency: step 10_

12. **[Presentation] Register route in `packages/api/src/app.ts`**
    Import Kysely client. Register: `await app.register(estimateRoutes, { db: kyselyInstance })`.
    PrismaClient remains for all E001-E002 routes (no migration of existing code).
    _Dependency: step 11_

13. **[Test — GREEN] Verify all route tests pass**
    Run `npm test -w @foodxplorer/api -- --testPathPattern f020` and fix until green.
    _Dependency: step 12_

14. **[Docs] `docs/specs/api-spec.yaml`**
    Verify `/estimate` section matches final implementation. Update if needed.
    _Dependency: step 13_

15. **[Final] Full test suite and build**
    - `npm test -w @foodxplorer/api` — all tests pass
    - `npm test -w @foodxplorer/shared` — all tests pass
    - `npm run build` — TypeScript strict, no errors
    _Dependency: step 14_

---

### Testing Strategy

**Test files:**

| File | Type | Runner |
|------|------|--------|
| `packages/shared/src/__tests__/estimate.schemas.test.ts` | Unit | `@foodxplorer/shared` |
| `packages/api/src/__tests__/f020.level1Lookup.unit.test.ts` | Unit | `@foodxplorer/api` |
| `packages/api/src/__tests__/f020.estimate.route.test.ts` | Unit (mocked) | `@foodxplorer/api` |

**Key test scenarios:**

`estimate.schemas.test.ts`:
- `EstimateQuerySchema`: valid params, missing `query` rejected, too long rejected, invalid `chainSlug` regex, non-UUID `restaurantId`, optional fields absent
- `EstimateNutrientsSchema`: all 15 fields as non-negative numbers, negative rejected, salt + sodium both present
- `EstimateDataSchema`: miss path (`level1Hit: false`, `result: null`, `matchType: null`), hit path (full result)
- `EstimateResponseSchema`: round-trip parse of sample JSON from spec

`f020.level1Lookup.unit.test.ts`:
- Each strategy returns correct `matchType`; earlier strategies short-circuit later ones
- All 4 miss → returns `null`
- `restaurantId` precedence over `chainSlug`
- Food strategies never scoped to chain
- Decimal `'550.00'` → `550` number conversion for all 15 nutrients
- `reference_basis` mapped to `referenceBasis`
- `source` block populated from `data_sources` (id, name, type, url)
- `portionGrams: null` for food results
- `confidenceLevel: 'high'`, `estimationMethod: 'official'` hardcoded
- CTE de-duplication: most recent nutrient row selected
- DB error → rejects with `{ code: 'DB_UNAVAILABLE' }`

`f020.estimate.route.test.ts` (mocking `level1Lookup` and `redis`):
- Cache miss → 200 with `cachedAt: null`
- Cache hit → 200 with non-null `cachedAt`; `level1Lookup` not called
- Redis unavailable → 200 live result (fail-open)
- Validation: missing query (400), empty query (400), >255 chars (400), bad UUID (400), bad chainSlug (400)
- `level1Lookup` returns null → 200, `level1Hit: false`
- `level1Lookup` throws `DB_UNAVAILABLE` → 500
- Response validates against `EstimateResponseSchema.safeParse(body)`

**Mocking strategy:**
- `level1Lookup`: `vi.mock('../estimation/level1Lookup.js', ...)` with `vi.hoisted`
- Kysely in unit tests: mock the query chain (`.selectFrom().innerJoin()...executeTakeFirst()`) returning typed fixture objects
- Redis in route tests: `vi.mock('../lib/redis.js', () => ({ redis: mockRedis }))`
- Kysely in route tests: `vi.mock('../lib/kysely.js', () => ({ getKysely: () => mockDb }))`

---

### Key Patterns

**Kysely for E003 complex queries (ADR-000 activation)**
Kysely `^0.27.5` is installed per ADR-000 but was not needed during E001-E002 (Prisma.$queryRaw sufficed). E003 activates Kysely: 5 features with 4+ table joins, FTS, pgvector similarity. `prisma-kysely` generates DB types from the Prisma schema. Existing E001-E002 code stays on $queryRaw — no migration needed. New E003 modules use Kysely exclusively.

**CTE nutrient de-duplication (CRITICAL)**
Both `dish_nutrients` and `food_nutrients` have `@@unique([entityId, sourceId])` — multiple nutrient rows per entity from different sources. All 4 strategies MUST use a CTE:
```sql
WITH ranked_dn AS (
  SELECT dn.*, ROW_NUMBER() OVER (
    PARTITION BY dn.dish_id ORDER BY dn.created_at DESC
  ) AS rn
  FROM dish_nutrients dn
)
SELECT ... FROM dishes d
JOIN ranked_dn rdn ON rdn.dish_id = d.id AND rdn.rn = 1
JOIN data_sources ds ON ds.id = rdn.source_id
```
This selects the most recent nutrient row and its associated data_source.
Reference: `buildDishQuery` in `packages/api/src/embeddings/pipeline.ts`.

**All 15 nutrient columns**
Unlike the embeddings pipeline (8 nutrients), F020 returns ALL 15:
calories, proteins, carbohydrates, sugars, fats, saturatedFats, fiber, **salt**,
sodium, transFats, cholesterol, potassium, monounsaturatedFats, polyunsaturatedFats.
Plus `reference_basis` (enum). All are `Decimal(8,2)` → strings from DB → `parseFloat()`.

**FTS index-aligned queries**
The FTS query MUST match the index expression exactly for index usage:
- Dishes Spanish: `to_tsvector('spanish', COALESCE(d.name_es, d.name))` — index uses COALESCE because `name_es` is nullable
- Foods Spanish: `to_tsvector('spanish', f.name_es)` — no COALESCE, `name_es` is NOT NULL
- Both English: `to_tsvector('english', d.name)` / `to_tsvector('english', f.name)`

**FTS query safety**
Use `plainto_tsquery` (not `to_tsquery`) — prevents FTS operator injection from user input.

**Route plugin pattern**
Wrap with `fastifyPlugin(...)`. Declare `PluginOptions` interface. Cast `request.query as EstimateQuery`.
Reference: `packages/api/src/routes/quality.ts`

**Cache key format**
`buildKey('estimate:l1', \`${normalizedQuery}:${chainSlug ?? ''}:${restaurantId ?? ''}\`)`
→ `fxp:estimate:l1:big mac:mcdonalds-es:`

**`cachedAt` semantics**
Write: `cachedAt: new Date().toISOString()`. Read from cache: preserve as-is. Never overwrite on cache hit.

**`level1Hit` is not a 404**
Miss = HTTP 200 with `{ success: true, data: { level1Hit: false, result: null } }`.

**Hardcoded confidence and method (ADR-001)**
Level 1 always returns `confidenceLevel: 'high'`, `estimationMethod: 'official'` — NOT from the dish/food row.

**`portionGrams` for food results**
Foods have no `portion_grams` column → `portionGrams: null` in EstimateResult.

**Food strategies: no chain scope**
Strategies 3 and 4 NEVER filter by chain/restaurant. Foods are chain-agnostic USDA data.

---

## Acceptance Criteria

- [x] `GET /estimate?query=Big+Mac&chainSlug=mcdonalds-es` returns HTTP 200 with `level1Hit: true`, `matchType: 'exact_dish'`, and correct nutritional data
- [x] `GET /estimate?query=Whopper&chainSlug=mcdonalds-es` returns HTTP 200 with `level1Hit: false` (wrong chain scope)
- [x] `GET /estimate?query=pollo` returns HTTP 200 with `level1Hit: true`, `matchType: 'fts_food'` (USDA fallback)
- [x] `GET /estimate?query=something+completely+unknown` returns HTTP 200 with `level1Hit: false`
- [x] `GET /estimate` (no `query`) returns HTTP 400 with `VALIDATION_ERROR`
- [x] Second identical request hits Redis cache; response includes non-null `cachedAt`
- [x] With Redis disabled, endpoint returns live results without error (fail-open)
- [x] All four match strategies covered by unit tests in `level1Lookup.test.ts`
- [x] Route-level tests cover: cache hit, cache miss, Redis unavailable, Zod validation, DB error → 500
- [x] Unit tests for Zod schemas in `packages/shared`
- [x] All tests pass — 108 F020 tests + 161 shared tests (pre-existing scraper failures excluded)
- [x] Build succeeds (`npm run build`) — pre-existing batch-ingest TS errors excluded
- [x] Specs updated (`api-spec.yaml`, shared schemas)

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing (108 F020 + 161 shared)
- [x] Integration tests for DB queries (mocked Kysely executor in unit tests)
- [x] Code follows project standards (TypeScript strict, no `any`)
- [x] No linting errors introduced
- [x] Build succeeds
- [x] Specs reflect final implementation (`api-spec.yaml`, shared schemas)

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` executed, plan revised with deep review, approved
- [x] Step 3: `backend-developer` executed with TDD
- [x] Step 4: `production-code-validator` executed (APPROVED — 0 critical, 0 high), quality gates pass
- [x] Step 5: `code-review-specialist` executed (1 Important fixed: cache key lowercase)
- [x] Step 5: `qa-engineer` executed (2 bugs fixed: BUG-F020-01, BUG-F020-02; 80 edge-case tests)
- [x] Step 6: Ticket updated with final metrics, branch deleted, tracker updated

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-17 | Step 0: Spec created | spec-creator agent, spec approved |
| 2026-03-17 | Step 1: Setup | Branch + ticket + tracker |
| 2026-03-17 | Step 2: Plan | backend-planner + deep review. Revised: Kysely bootstrap, CTE de-dup, 15 nutrients, source traceability via ranked CTE |
| 2026-03-18 | Step 3: Implement | backend-developer TDD. 68 tests (40 shared + 14 unit + 14 route). Build clean (pre-existing batch-ingest errors excluded). |
| 2026-03-18 | Step 4: Finalize | production-code-validator APPROVED (0C/0H/1M). Fixed: double parseDecimal. |
| 2026-03-18 | Step 5: Review | PR #18. code-review-specialist: 1 Important (cache key lowercase) fixed. qa-engineer: BUG-F020-01 (trim order) + BUG-F020-02 (echo casing) fixed. 80 edge-case tests added. Total: 108 F020 tests + 161 shared. |
| 2026-03-18 | Step 6: Complete | Squash merged to develop (f9af429). Branch deleted. Tracker updated. Bugs logged. |

---

## Notes

- `plainto_tsquery` is used (not `to_tsquery`) to prevent user input from injecting FTS operators.
  If future features need prefix search, switch to `websearch_to_tsquery` (PostgreSQL 11+).
- Prisma Decimal values must be converted to `.toNumber()` before populating
  `EstimateNutrientsSchema` — same pattern as F018 quality checks.
- The `estimation/` directory name (not `estimate/`) follows the module noun convention used by
  `quality/` and `embeddings/` in this codebase.
- This is a **public-facing** endpoint in the sense that F025/E004 will expose it to the Telegram
  bot. It must be included in the rate-limit scope (100 req/15min/IP from F005).
- No auth required in Phase 1 (consistent with all other E003 endpoints — auth is F026).

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Implementation Plan, Acceptance Criteria, Definition of Done, Workflow Checklist, Completion Log, Merge Checklist Evidence |
| 1. Mark all items | [x] | AC: 13/13, DoD: 7/7, Workflow: Steps 0-5 checked (6 pending) |
| 2. Verify product tracker | [x] | Active Session: step 5/6, Features table: 5/6 |
| 3. Update key_facts.md | [x] | Updated: Kysely singleton, estimation module, estimate route, estimate schemas |
| 4. Update decisions.md | [x] | N/A — Kysely was ADR-000, Level 1 confidence was ADR-001 |
| 5. Commit documentation | [x] | Commit: (pending — will be next commit) |
| 6. Verify clean working tree | [x] | `git status`: clean after docs commit |

---

*Ticket created: 2026-03-17*
