# F022: Level 3 — Similarity Extrapolation (pgvector)

**Feature:** F022 | **Type:** Backend-Feature | **Priority:** High
**Status:** Review | **Branch:** feature/F022-level3-similarity-extrapolation
**Created:** 2026-03-18 | **Dependencies:** F020 (Level 1), F021 (Level 2), F019 (Embeddings), F003 (pgvector)

---

## Spec

### Description

Implement Level 3 of the Estimation Engine (E003): pgvector similarity extrapolation.

When both Level 1 (`level1Lookup`) and Level 2 (`level2Lookup`) return null — meaning no
official nutritional record exists and no dish ingredient decomposition is possible — Level 3
attempts to find a semantically similar dish or food in the database by comparing embedding
vectors using pgvector cosine distance.

The process:

1. Generate a 1536-dimension embedding for the query text by calling the OpenAI
   `text-embedding-3-small` model at request time.
2. Execute a pgvector nearest-neighbour query on `dishes.embedding` (scoped by
   `chainSlug`/`restaurantId` when provided). Return the top-1 dish if its cosine
   distance is below the threshold (default: 0.5).
3. If no dish is within threshold, execute a second nearest-neighbour query on
   `foods.embedding` (always global, no chain scoping). Return the top-1 food if it
   is within threshold.
4. If neither table yields a match within threshold, return null (total miss).

The nutrient values in the Level 3 result are copied directly from the matched similar
entity (its dish_nutrients or food_nutrients row). This is an extrapolation — the
returned nutrients belong to a different entity, not the queried one — hence
`confidenceLevel: 'low'` and `estimationMethod: 'extrapolation'` always.

**F022 scope:** `level3Lookup` function + route integration (call L3 when L1 and L2
both miss) + schema changes (new match types, `level3Hit` field, `similarityDistance`
field). No full orchestration beyond route integration (F023 handles that).

### Architecture Decisions

- **LLM never calculates** (ADR-001): Level 3 copies nutrients from an existing DB entity.
  The embedding generation (OpenAI call) is purely for vector search — it does not produce
  nutritional values.
- **Kysely for the query** (ADR-000): pgvector `<->` operator queries join dishes/foods with
  their nutrient and data_source rows. These are complex enough for Kysely.
- **`<->` is cosine distance**: The IVFFlat indexes on `foods.embedding` and `dishes.embedding`
  were created with `vector_cosine_ops` (F003). The `<->` operator returns cosine distance
  in [0.0, 2.0]; 0.0 = identical vectors, 2.0 = opposite.
- **Threshold default 0.5**: A cosine distance above 0.5 is considered too dissimilar to
  return with any confidence. This is configurable via an environment variable
  `L3_SIMILARITY_THRESHOLD` (defaults to `0.5` if not set). The planner should treat this
  as an env var read at module load time (not per-request).
- **Dishes first, foods fallback**: Level 3 tries the chain-scoped dishes table first. If no
  dish is close enough, it falls back to the global foods table. This mirrors the Level 1
  priority (dish strategies before food strategies) and is consistent with the user expecting
  chain-specific results when `chainSlug` is supplied.
- **Embedding at request time**: Level 3 generates the query embedding via a direct call to
  `callOpenAIEmbeddings` from `packages/api/src/embeddings/embeddingClient.ts`. A single
  text is passed (the raw query string). This adds ~200–500 ms latency but avoids pre-compute
  complexity.
- **Fail-graceful on OpenAI unavailability**: If `OPENAI_API_KEY` is not set or the OpenAI
  call fails (after retries), Level 3 is silently skipped. The route returns a total miss
  (`level3Hit: false`). The error is logged at `warn` level. No HTTP 500 is emitted for
  OpenAI failures specifically.
- **Embeddings required on matched entities**: The pgvector ORDER BY ... LIMIT 1 query only
  matches rows that have a non-null embedding. Rows with `embedding IS NULL` are naturally
  excluded because `NULL <-> vector` returns NULL which sorts last in ascending order.
  Add an explicit `WHERE embedding IS NOT NULL` filter for correctness and index efficiency.
- **Source traceability**: Level 3 joins the matched entity's data_sources row directly (same
  JOIN pattern as Level 1). The `source` block in the response is the real data source of
  the similar entity — not a synthetic provenance marker like Level 2.
- **Unified cache key**: No change. The existing key
  `fxp:estimate:<query>:<chainSlug>:<restaurantId>` stores the final response including L3
  results. Cache lookup happens before L1, so a cached L3 result is returned immediately.
- **Route integration**: The existing `estimate.ts` route calls `level3Lookup` after L1 and
  L2 both miss. The response shape gains `level3Hit`. This stub integration is the minimum
  needed for F022 to be testable. F023 (Engine Router) will orchestrate without breaking
  changes.
- **`estimationMethod: 'extrapolation'`** is already a valid Prisma enum value (present since
  F001). `EstimationMethodSchema` in `packages/shared/src/schemas/enums.ts` already includes
  `'extrapolation'`. No enum changes needed.

### Matching Strategy (Level 3)

Level 3 tries two strategies in priority order:

| Priority | Match type | Description |
|----------|-----------|-------------|
| 1 | `similarity_dish` | Nearest pgvector neighbour in `dishes.embedding`, scoped to chain/restaurant when provided. Distance must be < threshold. |
| 2 | `similarity_food` | Nearest pgvector neighbour in `foods.embedding`, global (no chain scope). Distance must be < threshold. |

Chain/restaurant scoping on `similarity_dish` is identical to Level 1 and 2 dish strategies:
`restaurantId` takes precedence over `chainSlug`; both are optional.

### Embedding Generation at Request Time

The query embedding is generated using `callOpenAIEmbeddings` from `embeddingClient.ts`:

```
embedding = callOpenAIEmbeddings([query], { apiKey, model: 'text-embedding-3-small', rpm: 500 })
```

- Single-element array input; returns a `number[][]` with one vector.
- The raw query string (trimmed, as received from the route — no additional normalization)
  is used as the input text. Rationale: embeddings are semantic, not lexical — the original
  casing and phrasing should be preserved.
- `EmbeddingClientConfig.rpm` is not meaningful for single-call request-time use; pass a
  default of 500 (the configured batch pipeline value) to satisfy the type.

### Nutrient Retrieval for the Similar Entity

After finding the nearest entity ID, the module executes a second query to retrieve nutrient
data using the same CTE de-dup pattern as Level 1:

- **For a dish match**: `WITH ranked_dn AS (...) SELECT ... FROM dishes d JOIN ranked_dn rdn
  ... JOIN data_sources ds ...` — identical CTE and column set as Level 1's `DishQueryRow`,
  filtered to `WHERE d.id = <matched_dish_id>`.
- **For a food match**: `WITH ranked_fn AS (...) SELECT ... FROM foods f JOIN ranked_fn rfn
  ... JOIN data_sources ds ...` — identical CTE and column set as Level 1's `FoodQueryRow`,
  filtered to `WHERE f.id = <matched_food_id>`.

This re-uses the existing `mapDishRowToResult` and `mapFoodRowToResult` mappers from
`packages/api/src/estimation/types.ts`, overriding only `confidenceLevel` and
`estimationMethod` in the returned `EstimateResult`.

### `Level3Result` internal type

```typescript
interface Level3Result {
  matchType: EstimateMatchType;   // 'similarity_dish' | 'similarity_food'
  result: EstimateResult;         // confidenceLevel: 'low', estimationMethod: 'extrapolation'
  similarityDistance: number;     // cosine distance of the winning match [0.0, 2.0)
}
```

`similarityDistance` is included in the API response as `result.similarityDistance` (see
Schema Changes). It is NOT part of `EstimateResult` in the Zod schema — see below.

### API Changes

#### `GET /estimate` — updated behavior

Parameters unchanged. Response `data` object additions:

| Field | Type | Description |
|-------|------|-------------|
| `level3Hit` | boolean | `true` when Level 3 produced a similarity match |

`matchType` — new enum values:

| Value | When |
|-------|------|
| `similarity_dish` | Level 3 nearest-neighbour match in `dishes.embedding` |
| `similarity_food` | Level 3 nearest-neighbour match in `foods.embedding` |

`result` when Level 3 hits:
- `entityType`: `"dish"` or `"food"` (from the similar entity)
- `confidenceLevel`: `"low"` (always for L3 — extrapolation is never medium or high)
- `estimationMethod`: `"extrapolation"`
- `source`: real data source of the similar entity (same structure as Level 1)
- `nutrients.referenceBasis`: `"per_serving"` for dishes, `"per_100g"` for foods
  (taken from the matched entity's nutrient row — same as Level 1)
- `similarityDistance`: cosine distance number, e.g. `0.18`

`result` when total miss (all three levels miss):
- `level3Hit: false`, `matchType: null`, `result: null` (unchanged from F021 miss behaviour)

#### Route summary and description update

The route `operationId` changes from `estimateLevel1And2` to `estimateLevel1And2And3`.
The `summary` and `description` are updated to reflect the three-level cascade.

### Data Model Changes

No Prisma schema changes. F022 reads from existing columns:
- `dishes.embedding` — vector(1536), pre-computed by F019, IVFFlat index (cosine, lists=100)
- `dishes.embedding_updated_at` — nullable TIMESTAMPTZ; rows with null embedding are excluded
- `foods.embedding` — vector(1536), same as above
- `foods.embedding_updated_at` — same as above
- `dish_nutrients` — nutrient data for matched dish (same CTE as Level 1)
- `food_nutrients` — nutrient data for matched food (same CTE as Level 1)
- `data_sources` — traceability row for matched entity

### Schema Changes (`packages/shared/src/schemas/estimate.ts`)

#### 1. `EstimateMatchTypeSchema` — add two new values

```typescript
export const EstimateMatchTypeSchema = z.enum([
  'exact_dish',
  'fts_dish',
  'exact_food',
  'fts_food',
  'ingredient_dish_exact',
  'ingredient_dish_fts',
  'similarity_dish',    // NEW — Level 3 dish similarity
  'similarity_food',    // NEW — Level 3 food similarity
]);
```

#### 2. `EstimateDataSchema` — add `level3Hit` field

```typescript
export const EstimateDataSchema = z.object({
  query: z.string(),
  chainSlug: z.string().nullable(),
  level1Hit: z.boolean(),
  level2Hit: z.boolean(),
  level3Hit: z.boolean(),  // NEW
  matchType: EstimateMatchTypeSchema.nullable(),
  result: EstimateResultSchema.nullable(),
  cachedAt: z.string().nullable(),
});
```

#### 3. `EstimateResultSchema` — add optional `similarityDistance` field

```typescript
export const EstimateResultSchema = z.object({
  entityType: z.enum(['dish', 'food']),
  entityId: z.string().uuid(),
  name: z.string(),
  nameEs: z.string().nullable(),
  restaurantId: z.string().uuid().nullable(),
  chainSlug: z.string().nullable(),
  portionGrams: z.number().positive().nullable(),
  nutrients: EstimateNutrientsSchema,
  confidenceLevel: ConfidenceLevelSchema,
  estimationMethod: EstimationMethodSchema,
  source: EstimateSourceSchema,
  similarityDistance: z.number().min(0).max(2).nullable(),  // NEW — null for L1/L2 results
});
```

`similarityDistance` is `nullable()` so that Level 1 and Level 2 results remain valid
(they set this field to `null`). It must be included in ALL `EstimateResult` construction
paths in the codebase — `mapDishRowToResult`, `mapFoodRowToResult`, and `mapLevel2RowToResult`
must be updated to include `similarityDistance: null`. The `level3Lookup` module sets it to
the actual distance value.

Note: Adding a required-but-nullable field to `EstimateResultSchema` is an atomic change —
it must land together with updates to all callers that construct `EstimateResult` objects.

### New Module: `packages/api/src/estimation/level3Lookup.ts`

#### Function signature

```typescript
export async function level3Lookup(
  db: Kysely<DB>,
  query: string,
  options: Level3LookupOptions,
): Promise<Level3Result | null>
```

#### `Level3LookupOptions` interface

```typescript
export interface Level3LookupOptions {
  chainSlug?: string;
  restaurantId?: string;
  threshold?: number;          // cosine distance threshold, default 0.5
  openAiApiKey: string | undefined;  // undefined → skip L3 gracefully
}
```

The `openAiApiKey` is passed in from the route (read from `config.openAiApiKey`) so the
module is testable without `process.env` access. If undefined, `level3Lookup` returns null
immediately (no OpenAI call made).

#### Processing steps inside `level3Lookup`

1. If `options.openAiApiKey` is undefined → return null immediately (graceful skip).
2. Call `callOpenAIEmbeddings([query], { apiKey, model: 'text-embedding-3-small', rpm: 500 })`.
   On failure → catch error, log at warn level, return null (graceful skip).
3. Extract the embedding vector: `const vector = embeddings[0]`.
4. Format vector for pgvector: `'[' + vector.join(',') + ']'` (the same `::vector` cast used
   by F019's `embeddingWriter`).
5. Execute Strategy 1 — dish similarity search (see SQL spec below).
6. If a dish row is returned and its distance < threshold → fetch nutrient data, map to result,
   return `Level3Result` with `matchType: 'similarity_dish'`.
7. Execute Strategy 2 — food similarity search.
8. If a food row is returned and its distance < threshold → fetch nutrient data, map to result,
   return `Level3Result` with `matchType: 'similarity_food'`.
9. Return null (no match within threshold).

#### Strategy 1 — Dish similarity SQL

```sql
SELECT
  d.id          AS dish_id,
  d.embedding <-> $vector::vector AS distance
FROM dishes d
JOIN restaurants r ON r.id = d.restaurant_id
WHERE d.embedding IS NOT NULL
  [AND r.id = $restaurantId::uuid]     -- when restaurantId provided
  [AND r.chain_slug = $chainSlug]      -- when chainSlug provided (restaurantId takes precedence)
ORDER BY distance ASC
LIMIT 1
```

Returns: `{ dish_id: string; distance: string }`. If the returned distance (parsed as float)
is < threshold, proceed to nutrient fetch. Otherwise return null from this strategy.

#### Strategy 2 — Food similarity SQL

```sql
SELECT
  f.id          AS food_id,
  f.embedding <-> $vector::vector AS distance
FROM foods f
WHERE f.embedding IS NOT NULL
ORDER BY distance ASC
LIMIT 1
```

Returns: `{ food_id: string; distance: string }`. Same threshold check applies.

#### Nutrient fetch (after a match is found)

For a dish match, execute the same query as Level 1's `exactDishMatch` but with
`WHERE d.id = $matchedDishId::uuid` (no text matching). Re-use `DishQueryRow` type and
`mapDishRowToResult` mapper. Override the returned result:
```
result.confidenceLevel = 'low'
result.estimationMethod = 'extrapolation'
```

For a food match, execute the same query as Level 1's `exactFoodMatch` but with
`WHERE f.id = $matchedFoodId::uuid`. Re-use `FoodQueryRow` type and `mapFoodRowToResult`
mapper. Override confidence and method the same way.

#### Error handling

- OpenAI call failure → catch, log `warn`, return null. Do NOT throw.
- DB query failure (similarity search or nutrient fetch) → throw `{ code: 'DB_UNAVAILABLE' }`.
  Consistent with Level 1 and Level 2 error behaviour. The route wraps this in a 500 response.

### Changes to `packages/api/src/estimation/types.ts`

Add the following types:

```typescript
export interface Level3LookupOptions {
  chainSlug?: string;
  restaurantId?: string;
  threshold?: number;
  openAiApiKey: string | undefined;
}

export interface Level3Result {
  matchType: EstimateMatchType;
  result: EstimateResult;
  similarityDistance: number;
}

/** Raw row from the dish similarity search query. */
export interface DishSimilarityRow {
  dish_id: string;
  distance: string;  // float returned as text from pgvector expression
}

/** Raw row from the food similarity search query. */
export interface FoodSimilarityRow {
  food_id: string;
  distance: string;
}
```

Also update `mapDishRowToResult` and `mapFoodRowToResult` signatures and bodies to include
`similarityDistance: null` in the returned `EstimateResult` object (Level 1 callers pass null).

Update `mapLevel2RowToResult` to also include `similarityDistance: null`.

### Changes to `packages/api/src/routes/estimate.ts`

1. Import `level3Lookup` from `'../estimation/level3Lookup.js'`.
2. Import `config` (already available — `OPENAI_API_KEY` is already in `EnvSchema` from F019).
3. After L1 miss and L2 miss: call `level3Lookup(db, query, { chainSlug, restaurantId, openAiApiKey: config.openAiApiKey })`.
4. L3 result propagated to `data` object with `level3Hit: true` (or `false` on null).
5. Update all `EstimateData` construction paths to include `level3Hit: false` (L1 hit and L2
   hit paths must include it too).
6. Update route summary, description, and `operationId` in the Fastify schema block.

### Edge Cases & Error Handling

1. **`OPENAI_API_KEY` not set** — `level3Lookup` receives `openAiApiKey: undefined`, returns
   null immediately. Route produces total miss (`level3Hit: false`). No error logged (this is
   a known skip condition, not a failure).
2. **OpenAI API call fails (network error, 5xx after retries)** — catch in `level3Lookup`,
   log at `warn` level, return null. Route produces total miss. No HTTP 500 for OpenAI
   failures specifically.
3. **OpenAI returns 401 (invalid key)** — `callOpenAIEmbeddings` re-throws immediately on
   non-retryable errors (4xx != 429). Caught by the L3 graceful-skip catch block. Log warn,
   return null.
4. **No rows have embeddings in dishes table** — similarity query returns 0 rows (or no row
   with `embedding IS NOT NULL`). Fall through to food search.
5. **All dish matches above threshold** — distance of top-1 result >= threshold. Fall through
   to food search.
6. **All food matches above threshold** — distance of top-1 food >= threshold. Return null
   (total miss).
7. **Dish match found but nutrient fetch returns no rows** — the matched dish has no
   `dish_nutrients` row. Return null from the dish strategy and proceed to food search.
   (This should be rare given FK constraints, but defensive handling is required.)
8. **DB query failure during similarity search** — throw `{ code: 'DB_UNAVAILABLE' }`.
   Route catches and returns HTTP 500.
9. **Cache hit** — unified cache returns the full response. All three lookups are skipped.
   `level3Hit` from the cached response is returned as-is.
10. **Redis failure** — fail-open. All three lookups proceed without caching.
11. **`level3Hit: false` on L1 hit path** — the route must set `level3Hit: false` whenever
    L1 or L2 hits. This is a required field on `EstimateDataSchema` (atomic change, same
    pattern as F021's `level2Hit` addition).
12. **`similarityDistance: null` on L1 / L2 results** — `EstimateResultSchema` requires the
    field; it is set to `null` by the existing mapper functions after they are updated.

### Cache Strategy

No change to the cache strategy from F021. The unified key is preserved:

| Key | Pattern | TTL |
|-----|---------|-----|
| Unified | `fxp:estimate:<query>:<chainSlug>:<restaurantId>` | 300s |

L3 results are cached under the same key as L1 and L2 results. A cached L3 result
is returned immediately on the next request without re-generating the embedding.

### Config Changes

`packages/api/src/config.ts` `EnvSchema` already includes `OPENAI_API_KEY` (added in F019).
No new environment variables needed. Optionally, add:

```
L3_SIMILARITY_THRESHOLD=0.5  # optional, defaults to 0.5 if not set
```

If `L3_SIMILARITY_THRESHOLD` is added to `EnvSchema`, it should be:
```typescript
L3_SIMILARITY_THRESHOLD: z.string()
  .regex(/^\d+(\.\d+)?$/)
  .optional()
  .transform((v) => v !== undefined ? parseFloat(v) : 0.5)
```

This is **optional** — the planner may choose to hardcode the default in `level3Lookup`
and not add it to `EnvSchema` for Phase 1 simplicity. If added, it should be passed
through `Level3LookupOptions.threshold`.

### Notes

- `callOpenAIEmbeddings` from `embeddingClient.ts` accepts an array and returns `number[][]`.
  For L3 single-query use, pass `[query]` and take `[0]` of the result.
- The `RateLimiter` class is not needed for request-time single-call embedding generation.
  Do not instantiate it in `level3Lookup`.
- `text-embedding-3-small` costs ~$0.00002 per 1K tokens. A typical dish query is 3–10 words
  (~5–13 tokens). At 10,000 L3 calls/day, cost is ~$0.01/day. Acceptable at Phase 1 scale.
- pgvector `IVFFlat` with `lists=100` is an approximate index (ANN). For small datasets
  (< 100K rows), exact search via `SET ivfflat.probes=100` may be needed for recall. This is
  a tuning concern for F023 — F022 uses the default probe count.
- The `<->` operator in pgvector on the `embedding` column will use the IVFFlat index only if
  an `ORDER BY embedding <-> $vector LIMIT 1` pattern is used (no intervening function calls
  or CTEs on the indexed column). The similarity queries in L3 follow this pattern directly.
- `mapDishRowToResult` and `mapFoodRowToResult` currently hardcode `confidenceLevel: 'high'`
  and `estimationMethod: 'official'`. The L3 nutrient-fetch path must override these after
  calling the mappers, not modify the mappers themselves (Level 1 still needs their current
  behaviour).

---

## Implementation Plan

### Existing Code to Reuse

- `packages/api/src/estimation/types.ts` — `DishQueryRow`, `FoodQueryRow`, `mapDishRowToResult`, `mapFoodRowToResult`, `parseDecimal`, `mapLevel2RowToResult`; all three mapper functions are reused after adding `similarityDistance: null` to their return values
- `packages/api/src/estimation/level1Lookup.ts` — the exact dish/food nutrient-fetch SQL (CTE + full column set) is the template for L3's nutrient-fetch queries; the `buildScopeClause` inline pattern (restaurantId takes precedence over chainSlug) is reused
- `packages/api/src/embeddings/embeddingClient.ts` — `callOpenAIEmbeddings(texts, config)` is called directly from `level3Lookup`; no `RateLimiter` needed
- `packages/api/src/config.ts` — `config.OPENAI_API_KEY` is already present (added in F019); no `EnvSchema` changes
- `packages/api/src/routes/estimate.ts` — existing L1→L2 cascade structure is extended with an L3 branch; same error-wrapping pattern for DB errors
- `packages/shared/src/schemas/estimate.ts` — `EstimateMatchTypeSchema`, `EstimateDataSchema`, `EstimateResultSchema` are extended (not replaced)
- `packages/api/src/__tests__/f021.level2Lookup.unit.test.ts` — `buildMockDb()` + `mockExecuteQuery` pattern is the exact pattern for L3 unit tests
- `packages/api/src/__tests__/f021.estimate.route.test.ts` — `vi.hoisted` + `vi.mock` pattern for route tests with multiple lookup mocks

---

### Files to Create

| Path | Purpose |
|------|---------|
| `packages/api/src/estimation/level3Lookup.ts` | New Level 3 module: embedding generation, two-strategy pgvector similarity search, nutrient fetch, result construction |
| `packages/api/src/__tests__/f022.level3Lookup.unit.test.ts` | Unit tests for `level3Lookup` — all strategies, threshold, scoping, OpenAI skip/failure, DB error |
| `packages/api/src/__tests__/f022.estimate.route.test.ts` | Route-level tests for L3 integration: L1+L2 miss → L3 hit, L3 total miss, OpenAI failure → total miss, DB error → 500, schema validation |

---

### Files to Modify

| Path | Changes |
|------|---------|
| `packages/shared/src/schemas/estimate.ts` | Add `similarity_dish` and `similarity_food` to `EstimateMatchTypeSchema`; add `level3Hit: z.boolean()` to `EstimateDataSchema`; add `similarityDistance: z.number().min(0).max(2).nullable()` to `EstimateResultSchema` |
| `packages/api/src/estimation/types.ts` | Add `Level3LookupOptions`, `Level3Result`, `DishSimilarityRow`, `FoodSimilarityRow` interfaces; add `similarityDistance: null` to the return objects of `mapDishRowToResult`, `mapFoodRowToResult`, and `mapLevel2RowToResult` |
| `packages/api/src/estimation/index.ts` | Export `level3Lookup` and the new L3 types (`Level3LookupOptions`, `Level3Result`, `DishSimilarityRow`, `FoodSimilarityRow`) |
| `packages/api/src/routes/estimate.ts` | Import `level3Lookup` and `config`; add L3 call after L2 miss; add `level3Hit` field to all `EstimateData` construction paths; update `operationId`, `summary`, and `description` in the Fastify schema block |
| `packages/shared/src/__tests__/estimate.schemas.test.ts` | Update `VALID_RESULT` fixture to include `similarityDistance: null`; add tests for the new schema fields; update `EstimateDataSchema` fixtures to include `level3Hit` |
| `packages/api/src/__tests__/f020.estimate.route.test.ts` | Add `mockLevel3Lookup` mock (same `vi.hoisted` + `vi.mock` pattern); update `MOCK_LEVEL1_RESULT.result` fixture to include `similarityDistance: null`; add `level3Hit: false` to the cached data fixture |
| `packages/api/src/__tests__/f020.edge-cases.test.ts` | Add `similarityDistance: null` to `BASE_RESULT_A`; Section C: add `mockLevel3Lookup` mock + `level3Hit: false` to EstimateData fixtures |
| `packages/api/src/__tests__/f021.estimate.route.test.ts` | Add `mockLevel3Lookup` mock; update `MOCK_LEVEL1_RESULT.result` and `MOCK_LEVEL2_RESULT.result` fixtures to include `similarityDistance: null`; add `level3Hit: false/true` to cached data fixtures |
| `packages/api/src/__tests__/f021.edge-cases.route.test.ts` | Add `mockLevel3Lookup` mock; add `level3Hit` to all EstimateData fixtures/assertions |
| `packages/api/src/__tests__/f021.edge-cases.test.ts` | Add `level3Hit` to all EstimateDataSchema fixtures; add `similarityDistance: null` to EstimateResult fixtures if present |
| `docs/specs/api-spec.yaml` | Add `similarity_dish` and `similarity_food` to match type enum; add `level3Hit` boolean to response schema; add `similarityDistance` nullable number to result schema; update `operationId`/`summary`/`description` |

---

### Implementation Order

**Step 1 — Atomic: Schema + Types + Mapper Updates + Fixture Repairs (RED then GREEN)**

This step must be fully committed before any other step because `EstimateResultSchema` gains a required new field (`similarityDistance`) that will break TS compilation in every file that constructs an `EstimateResult` if it is not updated atomically.

1a. RED — Write failing schema tests first:
- In `packages/shared/src/__tests__/estimate.schemas.test.ts`:
  - Update `VALID_RESULT` fixture to add `similarityDistance: null`
  - Add test: `EstimateMatchTypeSchema` accepts `similarity_dish`
  - Add test: `EstimateMatchTypeSchema` accepts `similarity_food`
  - Add test: `EstimateDataSchema` rejects object missing `level3Hit`
  - Add test: `EstimateDataSchema` parses object with `level3Hit: true`
  - Add test: `EstimateResultSchema` parses result with `similarityDistance: null`
  - Add test: `EstimateResultSchema` parses result with `similarityDistance: 0.18`
  - Add test: `EstimateResultSchema` rejects `similarityDistance: 2.1` (exceeds max)
  - Update all existing `EstimateDataSchema` fixtures to include `level3Hit`
  - Update `EstimateResponseSchema` round-trip fixtures to include `level3Hit` and `similarityDistance: null`

1b. GREEN — Implement the schema changes:
- In `packages/shared/src/schemas/estimate.ts`:
  - Append `'similarity_dish'` and `'similarity_food'` to `EstimateMatchTypeSchema`
  - Add `level3Hit: z.boolean()` to `EstimateDataSchema`
  - Add `similarityDistance: z.number().min(0).max(2).nullable()` to `EstimateResultSchema`

1c. GREEN — Repair types and mappers (fixes TS compilation):
- In `packages/api/src/estimation/types.ts`:
  - Add `Level3LookupOptions`, `Level3Result`, `DishSimilarityRow`, `FoodSimilarityRow` interfaces (see spec for exact field list)
  - Add `similarityDistance: null` to the returned object literal in `mapDishRowToResult`
  - Add `similarityDistance: null` to the returned object literal in `mapFoodRowToResult`
  - Add `similarityDistance: null` to the `result` object literal in `mapLevel2RowToResult`

1d. GREEN — Repair ALL existing test fixtures (prevents compilation break):

Every `EstimateResult` literal must gain `similarityDistance: null`. Every `EstimateData` literal must gain `level3Hit: false` (or `true` where the cached value was true). Every route test file that imports the estimate route must mock `level3Lookup`.

- In `packages/api/src/__tests__/f020.estimate.route.test.ts`:
  - Add `mockLevel3Lookup` mock via `vi.hoisted` + `vi.mock('../estimation/level3Lookup.js', ...)`; default to `mockResolvedValue(null)` in `beforeEach`
  - Add `similarityDistance: null` to `MOCK_LEVEL1_RESULT.result` (~line 85)
  - Add `level3Hit: false` wherever `EstimateData` objects are constructed (cachedData at ~line 236)
- In `packages/api/src/__tests__/f020.edge-cases.test.ts`:
  - Section A: Add `similarityDistance: null` to `BASE_RESULT_A` (~line 35)
  - Section C: Add `similarityDistance: null` to `ROUTE_MOCK_RESULT.result` (~line 292)
  - Section C: Add `mockLevel3Lookup` mock (same `vi.hoisted` + `vi.mock` pattern as `mockLevel2LookupEdge`), default `mockResolvedValue(null)` in `beforeEach`
  - Section C: Add `level3Hit: false` wherever `EstimateData` objects are constructed in fixtures/assertions
- In `packages/api/src/__tests__/f021.estimate.route.test.ts`:
  - Add `mockLevel3Lookup` mock (same pattern)
  - Add `similarityDistance: null` to `MOCK_LEVEL1_RESULT.result` (~line 86) and `MOCK_LEVEL2_RESULT.result` (~line 129)
  - Add `level3Hit: false` to `cachedData` object (~line 267)
- In `packages/api/src/__tests__/f021.edge-cases.route.test.ts`:
  - Add `mockLevel3Lookup` mock (same `vi.hoisted` + `vi.mock` pattern)
  - Add `similarityDistance: null` to `MOCK_L2_RESULT.result` (~line 76) and `MOCK_L1_RESULT.result` (~line 102)
  - Add `level3Hit: false` to ALL 3 `cachedData` objects (~lines 256, 283, 441)
  - Add `level3Hit` to all `EstimateData` assertions (cache write checks at ~lines 352, 371, 390)
- In `packages/api/src/__tests__/f021.edge-cases.test.ts`:
  - Section D: Add `similarityDistance: null` to `VALID_L2_RESULT` (~line 409) — used in `EstimateResultSchema.safeParse()` tests
  - Section D: Add `level3Hit` to ALL `EstimateDataSchema` test fixtures (lines ~486-589, every `data` object)
- In `packages/shared/src/__tests__/estimate.schemas.test.ts`:
  - Add `similarityDistance: null` to `VALID_RESULT` (~line 47)
  - Add `level3Hit` to ALL `EstimateDataSchema` fixtures (~lines 314-378)
  - Add `level3Hit` and `similarityDistance: null` to ALL `EstimateResponseSchema` round-trip fixtures (~lines 399-463)

1e. GREEN — Minimal route update to restore compilation:
- In `packages/api/src/routes/estimate.ts`:
  - Do NOT import `level3Lookup` yet — the module does not exist until Step 3. The import is added in Step 5
  - Add `level3Hit: false` to all existing `EstimateData` construction paths (L1 hit path and L2 hit/miss paths)
  - Do NOT wire in the actual L3 call yet — that is Step 5

Run tests after Step 1: all F020 and F021 tests must pass.

---

**Step 2 — `level3Lookup` Unit Tests (RED phase)**

Write `packages/api/src/__tests__/f022.level3Lookup.unit.test.ts` with all tests failing (module does not exist yet):

Mock setup (same `buildMockDb` + `mockExecuteQuery` as F021 unit tests):
- `vi.hoisted` to hoist `mockExecuteQuery`
- `vi.mock('../embeddings/embeddingClient.js', ...)` to hoist `mockCallOpenAIEmbeddings`
- `buildMockDb()` factory (identical to F021 unit test helper)

Fixtures:
- `MOCK_EMBEDDING`: `[[0.1, 0.2, ...]]` — array of 1 vector (1536 floats for realism; a shorter array works for mocking)
- `MOCK_SIMILARITY_DISH_ROW`: `{ dish_id: 'fd000000-0022-4000-a000-000000000001', distance: '0.18' }`
- `MOCK_SIMILARITY_FOOD_ROW`: `{ food_id: 'fd000000-0022-4000-a000-000000000010', distance: '0.32' }`
- `MOCK_DISH_NUTRIENT_ROW`: full `DishQueryRow` shape (same nutrient values as F021 fixtures)
- `MOCK_FOOD_NUTRIENT_ROW`: full `FoodQueryRow` shape

Test scenarios:
1. `openAiApiKey: undefined` → returns null immediately, `mockCallOpenAIEmbeddings` never called, `mockExecuteQuery` never called
2. `callOpenAIEmbeddings` throws → returns null (graceful skip), `mockExecuteQuery` never called
3. Strategy 1 dish hit within threshold → returns `{ matchType: 'similarity_dish', similarityDistance: 0.18, result: { confidenceLevel: 'low', estimationMethod: 'extrapolation', entityType: 'dish' } }`; `mockExecuteQuery` called exactly 2 times (similarity search + nutrient fetch)
4. Strategy 1 dish hit ABOVE threshold (distance '0.51') → falls through to strategy 2 food search; `mockExecuteQuery` called at least 2 times
5. Strategy 1 returns no rows → falls through to strategy 2
6. Strategy 2 food hit within threshold → returns `{ matchType: 'similarity_food', similarityDistance: 0.32, result: { confidenceLevel: 'low', estimationMethod: 'extrapolation', entityType: 'food' } }`
7. Both strategies above threshold → returns null
8. Both strategies return empty rows → returns null
9. Dish match found but nutrient fetch returns no rows → returns null, falls through to food search
10. `chainSlug` scoping applied to dish search (strategy 1); food search has no scope (strategy 2 query does not include scope)
11. `restaurantId` scoping applied to dish search; restaurantId takes precedence over chainSlug
12. `confidenceLevel` on L3 result is always `'low'` regardless of dish nutrient row
13. `estimationMethod` on L3 result is always `'extrapolation'`
14. `similarityDistance` is a number (not a string): `parseFloat('0.18') === 0.18`
15. DB error during similarity search → throws with `code: 'DB_UNAVAILABLE'`
16. DB error during nutrient fetch → throws with `code: 'DB_UNAVAILABLE'`
17. Custom threshold: `threshold: 0.3` with dish distance `'0.35'` → falls through (0.35 >= 0.3)
18. Default threshold 0.5: dish distance `'0.50'` → falls through (>= 0.5, not strictly less than)
19. `callOpenAIEmbeddings` is called with `[query]` (single-element array) and `{ apiKey, model: 'text-embedding-3-small', rpm: 500 }`
20. `callOpenAIEmbeddings` returns empty array `[]` → `embeddings[0]` is undefined → caught by OpenAI try-catch → returns null (graceful skip)

---

**Step 3 — `level3Lookup` Implementation (GREEN phase)**

Create `packages/api/src/estimation/level3Lookup.ts`:

Module-level constant: `const DEFAULT_THRESHOLD = 0.5`

Processing flow inside `level3Lookup`:
1. Guard: if `options.openAiApiKey` is `undefined`, return `null`
2. Try block for OpenAI call AND vector extraction (both must be in the same try-catch — if OpenAI returns an empty array, `embeddings[0]` is undefined and `.join()` throws TypeError, which must be caught gracefully):
   - Call `callOpenAIEmbeddings([query], { apiKey: options.openAiApiKey, model: 'text-embedding-3-small', rpm: 500 })`
   - Extract `vector = embeddings[0]`; format as `'[' + vector.join(',') + ']'`
   - Catch any error → `console.warn` (no Fastify request context available) → return `null`
3. Wrap the remaining DB work in a SEPARATE try-catch that re-throws as `{ code: 'DB_UNAVAILABLE' }` (this separation ensures OpenAI errors are never wrapped as DB_UNAVAILABLE)
5. Strategy 1 (dish similarity search): `sql<DishSimilarityRow>` query using `sql` tagged template with `d.embedding <-> ${vectorStr}::vector AS distance`, `WHERE d.embedding IS NOT NULL`, optional `AND r.id = ${restaurantId}::uuid` OR `AND r.chain_slug = ${chainSlug}` scope clause (same inline ternary as Level 1), `ORDER BY distance ASC LIMIT 1`. Parse `parseFloat(row.distance)`. If `distance < threshold`:
   - Execute nutrient fetch using the same CTE as `exactDishMatch` in L1 but `WHERE d.id = ${matchedDishId}::uuid`; typed as `DishQueryRow`
   - If nutrient row is undefined, skip to strategy 2
   - Call `mapDishRowToResult(nutrientRow)`, then override THREE fields: `result.confidenceLevel = 'low'`, `result.estimationMethod = 'extrapolation'`, `result.similarityDistance = distance` (consistent pattern: all overrides happen in level3Lookup, not in the route)
   - Return `{ matchType: 'similarity_dish', result, similarityDistance: distance }`
6. Strategy 2 (food similarity search): `sql<FoodSimilarityRow>` query, no scope clause, `WHERE f.embedding IS NOT NULL`, `ORDER BY distance ASC LIMIT 1`. Same threshold check. If within threshold:
   - Execute nutrient fetch using same CTE as `exactFoodMatch` in L1 but `WHERE f.id = ${matchedFoodId}::uuid`; typed as `FoodQueryRow`
   - If nutrient row is undefined, return `null`
   - Call `mapFoodRowToResult(nutrientRow)`, then override THREE fields: `result.confidenceLevel = 'low'`, `result.estimationMethod = 'extrapolation'`, `result.similarityDistance = distance`
   - Return `{ matchType: 'similarity_food', result, similarityDistance: distance }`
7. Return `null`

Export: `export async function level3Lookup(db, query, options): Promise<Level3Result | null>`

Update `packages/api/src/estimation/index.ts`:
- Add `export { level3Lookup } from './level3Lookup.js'`
- Add `Level3LookupOptions`, `Level3Result`, `DishSimilarityRow`, `FoodSimilarityRow` to the `export type` block

Run L3 unit tests: all should pass.

---

**Step 4 — Route Integration Tests (RED phase)**

Write `packages/api/src/__tests__/f022.estimate.route.test.ts`:

Mock setup: same boilerplate as F021 route tests; add a third `vi.hoisted`/`vi.mock` block for `level3Lookup`:
```
const { mockLevel3Lookup } = vi.hoisted(() => ({ mockLevel3Lookup: vi.fn() }));
vi.mock('../estimation/level3Lookup.js', () => ({ level3Lookup: mockLevel3Lookup }));
```
Default in `beforeEach`: `mockLevel3Lookup.mockResolvedValue(null)`

Fixtures — add to existing L1/L2 fixtures:
- `MOCK_LEVEL3_DISH_RESULT`: `{ matchType: 'similarity_dish', similarityDistance: 0.18, result: { ...dishFields, similarityDistance: 0.18, confidenceLevel: 'low', estimationMethod: 'extrapolation' } }` (note: `result.similarityDistance` is set by `level3Lookup`, route passes result as-is)
- `MOCK_LEVEL3_FOOD_RESULT`: similar with `matchType: 'similarity_food'`, `entityType: 'food'`, `similarityDistance: 0.32`, `result.similarityDistance: 0.32`

Test scenarios:
1. L1 hit → `level3Lookup` NOT called, `level3Hit: false` in response
2. L2 hit → `level3Lookup` NOT called, `level3Hit: false` in response
3. L1 miss + L2 miss + L3 dish hit → `level3Hit: true`, `matchType: 'similarity_dish'`, `result.confidenceLevel: 'low'`, `result.estimationMethod: 'extrapolation'`, `result.similarityDistance: 0.18`
4. L1 miss + L2 miss + L3 food hit → `level3Hit: true`, `matchType: 'similarity_food'`
5. L1 miss + L2 miss + L3 null → `level3Hit: false`, `matchType: null`, `result: null`
6. `level3Lookup` throws `{ code: 'DB_UNAVAILABLE' }` → response 500 with `code: 'DB_UNAVAILABLE'`
7. `level3Lookup` returns null (OpenAI failure simulated) → `level3Hit: false`, status 200 (NOT 500)
8. Cache hit with `level3Hit: true` cached → neither L1/L2/L3 called, `cachedAt` non-null
9. L3 hit response validates against `EstimateResponseSchema`
10. Total miss response validates against `EstimateResponseSchema`
11. `level3Lookup` receives normalized query (same lowercase/whitespace-collapse as L1/L2)
12. `level3Lookup` is called with `openAiApiKey: config.OPENAI_API_KEY` (UPPER_SNAKE — matches Zod `EnvSchema` property name; check call arguments via `expect(mockLevel3Lookup).toHaveBeenCalledWith(...)`)

---

**Step 5 — Route Implementation (GREEN phase)**

Modify `packages/api/src/routes/estimate.ts`:

Imports to add:
- `import { level3Lookup } from '../estimation/level3Lookup.js'`
- `import { config } from '../config.js'`

Update the L1 hit block: add `level3Hit: false` (already done in Step 1e).

After the L2 lookup and before building the response data, add:
```
if (lookupResult2 !== null) {
  // L2 hit — build response (already has level3Hit: false)
}
// L3 fallback (L1 miss and L2 miss)
let lookupResult3 = null;
try {
  lookupResult3 = await level3Lookup(db, normalizedQuery, {
    chainSlug,
    restaurantId,
    openAiApiKey: config.OPENAI_API_KEY,
  });
} catch (err) {
  throw Object.assign(
    new Error('Database query failed'),
    { statusCode: 500, code: 'DB_UNAVAILABLE', cause: err },
  );
  // Note: OpenAI failures are caught inside level3Lookup and return null — they never reach here
}
```

Build the final `data` object:
- L3 hit: `{ ..., level1Hit: false, level2Hit: false, level3Hit: true, matchType: lookupResult3.matchType, result: lookupResult3.result }` (result already includes `similarityDistance` — set inside `level3Lookup`, same pattern as L1/L2 where the route just passes `lookupResult.result` directly)
- Total miss: `{ ..., level1Hit: false, level2Hit: false, level3Hit: false, matchType: null, result: null }`

Update the Fastify route schema block:
- `summary`: `'Level 1 + Level 2 + Level 3 — official data, ingredient estimation, and similarity extrapolation'`
- `description`: update to mention Level 3 pgvector similarity search and `level3Hit`
- `operationId`: `'estimateLevel1And2And3'`

Run all route tests: all F020, F021, F022 route tests must pass.

---

**Step 6 — Spec Update**

Modify `docs/specs/api-spec.yaml`:
- Add `similarity_dish` and `similarity_food` to the match type enum schema
- Add `level3Hit` boolean field to the EstimateData response schema
- Add `similarityDistance` nullable number (min: 0, max: 2) to the EstimateResult schema
- Update the `GET /estimate` operation: `operationId`, `summary`, `description`

---

### Testing Strategy

**Unit tests (`f022.level3Lookup.unit.test.ts`)**

File: `packages/api/src/__tests__/f022.level3Lookup.unit.test.ts`

Mocks:
- `buildMockDb()` factory identical to F021 unit test helper — provides a minimal Kysely executor whose `executeQuery` is a hoisted `vi.fn()`
- `vi.mock('../embeddings/embeddingClient.js')` to control `callOpenAIEmbeddings` return value

Key scenarios (20 tests — see Step 2 for full list):
- Happy path: dish hit, food fallback, both-miss
- Threshold boundary: exactly at threshold (not less than → reject), just below (accept)
- Scope: chainSlug applied to dish query only, restaurantId takes precedence
- OpenAI: undefined key → immediate null, thrown error → null (no DB calls)
- Nutrient fetch: no rows returned → fall through to next strategy
- Confidence/method override: always `'low'` / `'extrapolation'` regardless of mapper defaults
- DB errors: throw `DB_UNAVAILABLE` from similarity query and from nutrient-fetch query
- Distance parsing: string `'0.18'` from pgvector becomes number `0.18` in result

**Route tests (`f022.estimate.route.test.ts`)**

File: `packages/api/src/__tests__/f022.estimate.route.test.ts`

Mocks: `vi.mock` for `level1Lookup`, `level2Lookup`, `level3Lookup`, Redis, Prisma, Kysely (identical setup to F021 route test)

Key scenarios (12 tests — see Step 4 for full list):
- L3 not called when L1 or L2 hits
- L3 called only on double miss
- L3 result propagated correctly to response (`level3Hit`, `similarityDistance`, confidence, method)
- OpenAI failure (L3 returns null) → 200 total miss, NOT 500
- DB error from L3 → 500 `DB_UNAVAILABLE`
- Schema validation against `EstimateResponseSchema` for L3 hit and total miss

**Schema tests (additions to `estimate.schemas.test.ts`)**

File: `packages/shared/src/__tests__/estimate.schemas.test.ts`

Additions to existing test file: 8 new test cases covering new enum values, `level3Hit` required field, `similarityDistance` bounds (null, valid, out-of-range).

All existing tests updated with `similarityDistance: null` in `VALID_RESULT` and `level3Hit` in `EstimateDataSchema` fixtures.

**No integration tests are planned for F022.** The existing F020/F021 integration tests cover the route plumbing. L3 adds an external dependency (OpenAI) that is impractical to test in integration without a live key and seeded embeddings. A dedicated integration test can be added in F023 when the engine router is introduced.

---

### Key Patterns

**`buildMockDb` + `mockExecuteQuery` (unit test mock DB)**
Reference: `packages/api/src/__tests__/f021.level2Lookup.unit.test.ts` lines 56–76.
`vi.hoisted` ensures the mock is available before the import of the module under test. `mockExecuteQuery.mockResolvedValueOnce(...)` chained calls control the sequence of DB responses for multi-query tests (similarity search returns first, nutrient fetch returns second).

**`vi.hoisted` + `vi.mock` for route tests**
Reference: `packages/api/src/__tests__/f021.estimate.route.test.ts` lines 18–36.
Each module mock must be declared before `import { buildApp }`. The `mockLevel3Lookup` mock follows the exact same declaration block pattern — a new `vi.hoisted` block and a new `vi.mock('../estimation/level3Lookup.js', ...)` block.

**`sql` tagged template with Kysely for pgvector**
Reference: `packages/api/src/estimation/level1Lookup.ts` lines 45–86.
The `<->` operator cannot be expressed via Kysely's query builder; use `sql<RowType>\`SELECT ... <-> ${vectorStr}::vector ...\`.execute(db)`. The vector string must be formatted as `'[n1,n2,...]'` (without spaces) before injection — pgvector parses this literal.

**Scope clause inline ternary**
Reference: `packages/api/src/estimation/level1Lookup.ts` lines 39–43.
Replicate this pattern in `level3Lookup` for strategy 1. Strategy 2 (food) has no scope clause at all — do not add one.

**Mapper override pattern**
Reference: `packages/api/src/estimation/types.ts` lines 233–248 (mapDishRowToResult).
Call `mapDishRowToResult(row)` to get a fully-populated `EstimateResult` with `similarityDistance: null`, then mutate THREE fields: `result.confidenceLevel = 'low'`, `result.estimationMethod = 'extrapolation'`, and `result.similarityDistance = distance`. Do NOT modify the mapper itself. The same pattern applies for `mapFoodRowToResult`. This keeps ALL overrides in `level3Lookup` — the route passes `lookupResult3.result` directly (same as L1 and L2).

**Fail-graceful OpenAI error (catch block returns null)**
The `try/catch` around `callOpenAIEmbeddings` in `level3Lookup` must be outside the outer DB error try-catch. The outer DB try-catch wraps only the Kysely `sql.execute()` calls. This separation prevents an OpenAI error from being mistakenly wrapped as `DB_UNAVAILABLE`. Use `console.warn` (not `request.log`) since `level3Lookup` has no Fastify request context.

**`config.OPENAI_API_KEY` access**
The route already imports `config` for other purposes in F019+ modules; if not yet present in `estimate.ts`, add `import { config } from '../config.js'`. Pass `config.OPENAI_API_KEY` (which is `string | undefined`) directly to `level3Lookup` as `openAiApiKey`. The undefined case is handled inside `level3Lookup` — the route does not need to check it.

**Atomic Step 1 gotcha**
`EstimateResultSchema` with the new `similarityDistance` field will cause TS to reject every existing `EstimateResult` literal that omits it. The three mapper functions in `types.ts` and the two fixture files for F020/F021 route tests all construct `EstimateResult` objects directly — all must be updated in the same commit as the Zod schema change. Do not attempt to partially apply Step 1 across multiple commits.

**Distance string-to-number conversion**
pgvector returns the `<->` expression result as a Postgres `float8`, which the pg driver delivers as a JS `string` in tagged-template queries (same as DECIMAL columns). Parse with `parseFloat(row.distance)` before comparing to threshold. The `similarityDistance` field in `Level3Result` and in the API response must be a `number`, not a string.

---

## Acceptance Criteria

- [x] `level3Lookup(db, query, options)` returns `Level3Result` when a similar entity is
      found within the cosine distance threshold; returns null otherwise
- [x] `level3Lookup` returns null immediately (no OpenAI call) when `openAiApiKey` is undefined
- [x] `level3Lookup` returns null (graceful skip, warn log) when OpenAI call fails
- [x] `level3Lookup` searches dishes before foods; returns dish match if within threshold
- [x] `level3Lookup` falls back to food search when no dish is within threshold
- [x] `level3Lookup` applies `chainSlug`/`restaurantId` scoping to dish search only
- [x] `level3Lookup` returns `confidenceLevel: 'low'` for all L3 results
- [x] `level3Lookup` returns `estimationMethod: 'extrapolation'` for all L3 results
- [x] `level3Lookup` returns `matchType: 'similarity_dish'` or `'similarity_food'`
- [x] `level3Lookup` returns `similarityDistance` as a float in [0.0, 2.0)
- [x] `EstimateMatchTypeSchema` includes `similarity_dish` and `similarity_food`
- [x] `EstimateDataSchema` includes `level3Hit: z.boolean()`
- [x] `EstimateResultSchema` includes `similarityDistance: z.number().min(0).max(2).nullable()`
- [x] `mapDishRowToResult`, `mapFoodRowToResult`, `mapLevel2RowToResult` set `similarityDistance: null`
- [x] Route calls Level 3 on L1 miss AND L2 miss; final result cached under unified key
- [x] Route sets `level3Hit: false` on all L1 hit and L2 hit paths
- [x] DB errors from pgvector queries propagate as HTTP 500 `DB_UNAVAILABLE`
- [x] OpenAI errors do NOT produce HTTP 500 — they produce a total-miss 200 response
- [x] Unit tests for `level3Lookup`: 26 tests (dish hit, food fallback, threshold rejection, OpenAI skip, OpenAI failure, scoping, DB error, similarityDistance propagation)
- [x] Route tests: 13 tests (L3 hit/miss, cascade, error handling, cache, schema validation)
- [x] All existing tests remain passing (no regressions) — 1942 total
- [x] Build succeeds (0 new TS errors)
- [x] Specs updated (api-spec.yaml, shared schemas)

---

## Definition of Done

- [x] All acceptance criteria met (23/23)
- [x] Unit tests written and passing (26 unit + 13 route + 18 QA edge-cases + 19 schema edge-cases = 76 new tests)
- [x] E2E tests updated (if applicable) — N/A, external dependency (OpenAI)
- [x] Code follows project standards
- [x] No linting errors (F022 files clean)
- [x] Build succeeds (0 new TS errors)
- [x] Specs reflect final implementation

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` executed, plan approved (2 rounds self-review, 8 issues fixed)
- [x] Step 3: `backend-developer` executed with TDD (4 commits)
- [x] Step 4: `production-code-validator` executed — APPROVED (1 suggestion)
- [x] Step 5: `code-review-specialist` executed — 1 CRITICAL bug found and fixed (similarityDistance propagation)
- [x] Step 5: `qa-engineer` executed — 1 SPEC_MISMATCH (threshold env var, by-design), 2 low edge cases (1 fixed: NaN/Infinity guard), 37 new edge-case tests
- [x] Step 6: Ticket updated with final metrics, branch deleted

---

---

## Completion Log

| Date | Event | Details |
|------|-------|---------|
| 2026-03-18 | Ticket created | Spec approved, Step 0 complete |
| 2026-03-18 | Plan written | backend-planner, 6 steps |
| 2026-03-18 | Plan Self-Review (round 1) | 2 issues found (1 IMPORTANT: 3 missing test files in Step 1d, 1 IMPORTANT: forward import in Step 1e). Both fixed |
| 2026-03-18 | Plan Deep Review (round 2) | 6 issues found after reading all source files: 4 IMPORTANT (missing result fixtures in 4 files, 3 cachedData fixtures, similarityDistance override location, vector extraction outside try-catch), 2 SUGGESTION (config property name, empty embedding edge case). All fixed. Added test 20. |
| 2026-03-19 | Plan approved | User approved plan, proceeding to Step 3 |
| 2026-03-19 | Implementation (Step 3) | backend-developer: 4 commits (atomic schema, unit+impl, route tests+wiring, spec update). 38 new tests (25 unit + 13 route) |
| 2026-03-19 | Finalize (Step 4) | production-code-validator: APPROVED (1 suggestion: sql.raw pattern). Quality gates: 1942 tests pass, lint clean, 0 new TS errors |
| 2026-03-19 | PR created | PR #20 → develop |
| 2026-03-19 | Code review (Step 5) | code-review-specialist: 1 CRITICAL — `result.similarityDistance` not propagated to EstimateResult. Fixed in commit 24fd062. Also fixed barrel export missing L3 |
| 2026-03-19 | QA (Step 5) | qa-engineer: 1 SPEC_MISMATCH (threshold env var — by-design, hardcoded Phase 1), 2 low edge cases (NaN/Infinity guard added). 37 new edge-case tests (18 API + 19 shared). Fixed in commit a69647e |
| 2026-03-19 | Merge (Step 6) | Squash merge PR #20 → develop (commit 18a20f8). Branch deleted. 76 new tests, 19 files changed, +3442 lines |

---

## Merge Checklist Evidence

| # | Action | Done | Evidence |
|---|--------|:----:|----------|
| 0 | Validate ticket structure | [x] | All 7 sections present: Spec, Implementation Plan, AC, DoD, Workflow Checklist, Completion Log, Merge Checklist Evidence |
| 1 | Mark all items | [x] | AC: 23/23, DoD: 7/7, Workflow: 7/8 (Step 6 pending) |
| 2 | Verify product tracker | [x] | Active Session: step 5/6 (Review), Features table: in-progress 5/6 |
| 3 | Update key_facts.md | [x] | Added: level3Lookup, L3 types, estimation barrel L3 exports, NaN/Infinity guard |
| 4 | Update decisions.md | [x] | No new ADRs required (existing ADR-000/001 cover L3 decisions) |
| 5 | Commit documentation | [x] | Documentation committed with merge checklist evidence |
| 6 | Verify clean working tree | [x] | `git status` clean after final commit |

---

*Ticket created: 2026-03-18*
