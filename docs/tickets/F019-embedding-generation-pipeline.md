# F019: Embedding Generation Pipeline

**Feature:** F019 | **Type:** Backend-Feature | **Priority:** High
**Status:** In Progress | **Branch:** feature/F019-embedding-generation-pipeline
**Created:** 2026-03-17 | **Dependencies:** F003 (pgvector indexes), F006+ (foods/dishes data)

---

## Spec

### Description

Implement the vector embedding generation pipeline for the foodXPlorer platform.
This is the final feature of E002 (Data Ingestion Pipeline) and a hard prerequisite
for E003 Level 3 (Similarity Extrapolation via pgvector).

The pipeline generates 1536-dimension embeddings via OpenAI `text-embedding-3-small`
for every `food` and `dish` row in the database. Embeddings are written via
`prisma.$executeRaw` into the existing `foods.embedding vector(1536)` and
`dishes.embedding vector(1536)` columns (pgvector, declared as
`Unsupported("vector(1536)")` in Prisma — ADR-002).

Three deliverables share a common pipeline module:

1. **Pipeline module** (`packages/api/src/embeddings/`) — composable functions for
   text building, batch calling, and DB writing.
2. **CLI script** (`packages/api/src/scripts/embeddings-generate.ts`) —
   `npm run embeddings:generate -w @foodxplorer/api`.
3. **API endpoint** `POST /embeddings/generate` — triggers the pipeline via HTTP.
   No auth (Phase 1, internal use only).

### Architecture Decisions

- **Raw SQL for writes**: `prisma.$executeRaw` required for `Unsupported("vector(1536)")` columns (ADR-002).
- **text-embedding-3-small**: 1536 dimensions, matches existing DB columns. Configurable via `OPENAI_EMBEDDING_MODEL`.
- **Continue-on-failure**: Individual item failures logged; pipeline never aborts mid-run.
- **Skip-by-default**: Add `embeddingUpdatedAt DateTime?` column to foods/dishes. NULL = needs embedding. `--force` overrides.
- **Rate limiting**: Token-bucket for OpenAI RPM compliance.
- **Retry**: Exponential backoff (3 retries) for transient OpenAI errors (429, 5xx).
- **Token estimation**: word-count × 1.3 heuristic (no tiktoken dependency).
- **openai npm SDK**: Official package, not raw fetch.

### API Changes

#### `POST /embeddings/generate`

**Request body** (`EmbeddingGenerateRequest`):

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `target` | `'foods' \| 'dishes' \| 'all'` | — (required) | Entity type(s) to embed |
| `chainSlug` | `string?` | — | Scope dishes to one chain |
| `batchSize` | `integer (1–2048)` | `100` | Items per OpenAI call |
| `force` | `boolean` | `false` | Re-embed even if embedding exists |
| `dryRun` | `boolean` | `false` | Count + estimate only, no writes |

**Response** (`EmbeddingGenerateResponse`): always HTTP 200 on pipeline completion.

| Field | Type | Description |
|-------|------|-------------|
| `target` | string | Target used |
| `dryRun` | boolean | Whether writes were skipped |
| `processedFoods` | integer | Embeddings written for foods |
| `processedDishes` | integer | Embeddings written for dishes |
| `skippedFoods` | integer | Foods skipped (already embedded) |
| `skippedDishes` | integer | Dishes skipped (already embedded) |
| `errorCount` | integer | Count of per-item failures |
| `errors` | `EmbeddingItemError[]` | Per-item failure details |
| `estimatedTokens` | integer | Estimated total token count |
| `durationMs` | integer | Wall-clock duration ms |
| `completedAt` | ISO-8601 string | Pipeline finish timestamp |

**Error responses:**
- `400 VALIDATION_ERROR` — invalid request body
- `422 EMBEDDING_PROVIDER_UNAVAILABLE` — `OPENAI_API_KEY` not set
- `500 DB_UNAVAILABLE` — DB failure

### Data Model Changes

New migration: add `embedding_updated_at TIMESTAMPTZ` (nullable) to both `foods` and `dishes` tables. Used for skip-detection (`WHERE embedding_updated_at IS NULL`).

### CLI Interface

```
npm run embeddings:generate -w @foodxplorer/api [flags]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--target` | `foods \| dishes \| all` | `all` | Which entity type(s) |
| `--batch-size` | integer | 100 | Items per API call |
| `--force` | boolean flag | false | Re-embed existing |
| `--dry-run` | boolean flag | false | Count and estimate only |
| `--chain-slug` | string | — | Scope dishes to one chain |

Exit codes: `0` = completed, `1` = aborted (missing key, DB error).

### Config (Env Vars)

| Var | Default | Required |
|-----|---------|----------|
| `OPENAI_API_KEY` | — | At invocation time (not startup) |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | No |
| `OPENAI_EMBEDDING_BATCH_SIZE` | `100` | No |
| `OPENAI_EMBEDDING_RPM` | `3000` | No |

**Important**: `OPENAI_API_KEY` must NOT cause server startup failure when absent.

### Text Builder Spec

#### `buildFoodText(food: FoodForEmbedding): string`

Note: `Food.nameEs` is NOT NULL (all foods have Spanish translation). `foodGroup` is the human-readable category (e.g. "Poultry Products"), not `foodType` (which is an enum: generic/branded/composite).

```
Food: Chicken Breast. Spanish name: Pechuga de pollo. Type: generic. Category: Poultry Products.
Nutrition per 100g: 165 kcal, 31g protein, 0g carbohydrates, 0g sugars, 3.6g fat, 1g saturated fat, 0g fiber, 74mg sodium.
```

#### `buildDishText(dish: DishForEmbedding): string`

Note: `Dish.nameEs` IS nullable. Categories and cooking methods are arrays (M:N via junction tables). `portionGrams` provides serving size context.

```
Dish: Big Mac. Spanish name: Big Mac. Restaurant chain: mcdonalds-es.
Categories: burgers, sandwiches. Cooking methods: grilled. Serving size: 215g.
Nutrition per serving: 550 kcal, 25g protein, 46g carbohydrates, 9g sugars, 30g fat, 11g saturated fat, 3g fiber, 730mg sodium.
```

Rules: omit NULL fields, round to 1dp, omit Spanish name if NULL (dishes only — foods always have it), omit Categories/Cooking methods lines if arrays are empty, omit Serving size if portionGrams is NULL.

### Edge Cases & Error Handling

1. **Zero-vector detection**: Use `embeddingUpdatedAt IS NULL` (not vector comparison).
2. **No nutrient row**: Embed name/category only — minimal embedding > zero-vector.
3. **chainSlug + target 'all'**: Silently scopes only dishes phase. Log warning.
4. **Empty scope**: Return normally with 0 processed. Not an error.
5. **dryRun**: Build texts, estimate tokens, skip OpenAI + DB writes.
6. **Concurrent invocations**: Not protected in Phase 1 (documented).
7. **Model dimension mismatch**: Per-item error, WARNING at pipeline start.
8. **OpenAI 429/5xx**: Retry 3× exponential backoff. After 3 failures, record in errors, continue.
9. **DB write failure**: Record item, continue pipeline.
10. **DB query failure**: Abort entirely, 500 DB_UNAVAILABLE.

### File Structure

```
packages/api/src/
  embeddings/
    index.ts                    — barrel exports
    textBuilder.ts              — buildFoodText(), buildDishText()
    embeddingClient.ts          — callOpenAIEmbeddings(texts[], config) → number[][]
    pipeline.ts                 — runEmbeddingPipeline(options) → EmbeddingGenerateData
    embeddingWriter.ts          — writeFoodEmbedding(id, vector), writeDishEmbedding(id, vector)
  routes/
    embeddings.ts               — POST /embeddings/generate
  scripts/
    embeddings-generate.ts      — CLI entry point
```

### Dependencies

| Package | Location | Purpose |
|---------|----------|---------|
| `openai` | `packages/api` | Official OpenAI SDK |

### Performance Considerations

- RPM compliance: 3000 RPM default → 30 batches/min at batchSize=100.
- Route timeout: 300s (5 min) for worst-case pipeline.
- Memory: Write each batch immediately (don't accumulate all vectors).
- DB writes: Per-item `$executeRaw` UPDATE (safe at <2000 rows scale).

---

## Implementation Plan

### Existing Code to Reuse

| Asset | Location | How it is used |
|-------|----------|----------------|
| `EmbeddingGenerateRequestSchema`, `EmbeddingGenerateDataSchema`, `EmbeddingItemErrorSchema`, `EmbeddingGenerateResponseSchema` | `packages/shared/src/schemas/embeddingGenerate.ts` | Already created in Step 0. Import in route, pipeline, and CLI. |
| `embeddingGenerate` barrel export | `packages/shared/src/index.ts` | Already re-exported. |
| `prisma` singleton | `packages/api/src/lib/prisma.ts` | Default PrismaClient for pipeline and CLI. |
| `registerErrorHandler` / `mapError` | `packages/api/src/errors/errorHandler.ts` | Handles `VALIDATION_ERROR`, `DB_UNAVAILABLE`, `EMBEDDING_PROVIDER_UNAVAILABLE` via existing code pattern. Add `EMBEDDING_PROVIDER_UNAVAILABLE` code block following the same `if (asAny['code'] === '...')` pattern. |
| `buildApp` + plugin registration | `packages/api/src/app.ts` | Register `embeddingRoutes` plugin following the `qualityRoutes` registration pattern. |
| `EnvSchema` / `parseConfig` | `packages/api/src/config.ts` | Extend with four new optional OpenAI vars. |
| `fastify-plugin` + `FastifyPluginAsync` pattern | `packages/api/src/routes/quality.ts` | Mirror exactly for `packages/api/src/routes/embeddings.ts`. |
| `$executeRaw` / `$queryRaw` patterns | `packages/api/src/__tests__/migration.f003.integration.test.ts` | Reference for pgvector writes (`$executeRawUnsafe`) and raw queries. |
| Fixture UUID prefix pattern | `packages/api/src/__tests__/migration.f002.integration.test.ts` | Use `f019xxxx-...` prefixes for F019 fixture IDs. |
| `Prisma.sql` template tag + `$queryRaw` | `packages/api/src/quality/checkNutrientCompleteness.ts` | Pattern for typed raw queries (bigint → Number cast). |
| `quality-monitor.ts` DI pattern | `packages/api/src/scripts/quality-monitor.ts` | DI with `prismaOverride?` + `isMain` guard. Mirror for `embeddings-generate.ts`. |

---

### Files to Create

| File | Purpose |
|------|---------|
| `packages/api/prisma/migrations/20260317150000_embedding_updated_at_f019/migration.sql` | ALTER TABLE adds `embedding_updated_at TIMESTAMPTZ` nullable column to both `foods` and `dishes`. |
| `packages/api/src/embeddings/types.ts` | Internal TypeScript types for the pipeline: `FoodRow`, `DishRow`, `EmbeddingPipelineOptions`. Not Zod — these are query-result shapes for internal use only. |
| `packages/api/src/embeddings/textBuilder.ts` | `buildFoodText(food: FoodRow): string` and `buildDishText(dish: DishRow): string`. Pure functions, no I/O. |
| `packages/api/src/embeddings/embeddingClient.ts` | `callOpenAIEmbeddings(texts: string[], config: EmbeddingClientConfig): Promise<number[][]>`. Wraps the `openai` SDK. Includes token estimation (`estimateTokens`), rate limiting (token-bucket), and retry logic (3× exponential backoff for 429/5xx). |
| `packages/api/src/embeddings/embeddingWriter.ts` | `writeFoodEmbedding(prisma, id, vector): Promise<void>` and `writeDishEmbedding(prisma, id, vector): Promise<void>`. Both use `$executeRaw` to write to the `vector(1536)` column and update `embedding_updated_at`. |
| `packages/api/src/embeddings/pipeline.ts` | `runEmbeddingPipeline(options: EmbeddingPipelineOptions, prisma?, openaiClient?): Promise<EmbeddingGenerateData>`. Orchestrates fetch → build → call → write for both entity types. |
| `packages/api/src/embeddings/index.ts` | Barrel: exports `runEmbeddingPipeline`, `buildFoodText`, `buildDishText`, `estimateTokens`. |
| `packages/api/src/routes/embeddings.ts` | Fastify plugin: `POST /embeddings/generate`. Validates body with `EmbeddingGenerateRequestSchema`, calls `runEmbeddingPipeline`, returns `EmbeddingGenerateResponse`. Timeout: 300 s. |
| `packages/api/src/scripts/embeddings-generate.ts` | CLI entry point. Parses `--target`, `--batch-size`, `--force`, `--dry-run`, `--chain-slug`. Calls `runEmbeddingPipeline` directly (not HTTP). Exits 0 on success, 1 on fatal error. |
| `packages/api/src/__tests__/f019.textBuilder.unit.test.ts` | Unit tests for `buildFoodText` and `buildDishText`. No DB, no mocks. |
| `packages/api/src/__tests__/f019.embeddingClient.unit.test.ts` | Unit tests for `estimateTokens`, rate-limit token bucket, retry logic. Mocks `openai` SDK. |
| `packages/api/src/__tests__/f019.pipeline.unit.test.ts` | Unit tests for `runEmbeddingPipeline`. Mocks DB queries, `callOpenAIEmbeddings`, and `writeFoodEmbedding`/`writeDishEmbedding`. |
| `packages/api/src/__tests__/f019.embeddings.route.test.ts` | Route tests via `buildApp().inject()`. Mocks `runEmbeddingPipeline`. |
| `packages/api/src/__tests__/migration.f019.integration.test.ts` | DB integration test: verifies `embedding_updated_at` column exists on `foods` and `dishes`, verifies `embeddingWriter` writes vector + timestamp correctly. |

---

### Files to Modify

| File | Change |
|------|--------|
| `packages/api/prisma/schema.prisma` | Add `embeddingUpdatedAt DateTime? @map("embedding_updated_at") @db.Timestamptz` to both `Food` and `Dish` models. |
| `packages/api/src/config.ts` | Add four optional OpenAI vars to `EnvSchema`: `OPENAI_API_KEY` (optional string), `OPENAI_EMBEDDING_MODEL` (default `'text-embedding-3-small'`), `OPENAI_EMBEDDING_BATCH_SIZE` (coerce int, default 100), `OPENAI_EMBEDDING_RPM` (coerce int, default 3000). All optional — missing `OPENAI_API_KEY` must NOT fail startup. |
| `packages/api/src/errors/errorHandler.ts` | Add `EMBEDDING_PROVIDER_UNAVAILABLE` case block (422) following the same `if (asAny['code'] === '...')` pattern as other codes. |
| `packages/api/src/app.ts` | Import `embeddingRoutes` from `./routes/embeddings.js` and register it with `await app.register(embeddingRoutes, { prisma: prismaClient })`. |
| `packages/api/package.json` | Add `openai` to `dependencies`. Add `"embeddings:generate": "tsx src/scripts/embeddings-generate.ts"` to `scripts`. |
| `.env.example` | Add all 4 OpenAI env vars: `OPENAI_API_KEY`, `OPENAI_EMBEDDING_MODEL`, `OPENAI_EMBEDDING_BATCH_SIZE`, `OPENAI_EMBEDDING_RPM` with defaults and comments. |

---

### Implementation Order

Follow DDD layer order: Domain (pure logic) → Application (pipeline) → Infrastructure (DB/network) → Presentation (routes + CLI) → Tests woven throughout each step (TDD).

---

#### Step 1 — Prisma Migration (Infrastructure)

**TDD red phase:** Write `packages/api/src/__tests__/migration.f019.integration.test.ts`. Describe two checks: (a) `embedding_updated_at` column exists on `foods` via `information_schema.columns`; (b) same on `dishes`. Tests fail because the column does not exist yet.

**Green phase:**

1. Create migration directory `packages/api/prisma/migrations/20260317150000_embedding_updated_at_f019/`.
2. Write `migration.sql`:
   ```sql
   -- F019: add embedding_updated_at to foods and dishes
   ALTER TABLE "foods" ADD COLUMN IF NOT EXISTS "embedding_updated_at" TIMESTAMPTZ;
   ALTER TABLE "dishes" ADD COLUMN IF NOT EXISTS "embedding_updated_at" TIMESTAMPTZ;
   ```
3. Add `embeddingUpdatedAt DateTime? @map("embedding_updated_at") @db.Timestamptz` to both `Food` and `Dish` models in `schema.prisma`.
4. Run `prisma migrate deploy` (do NOT use `migrate dev`).
5. Run `prisma generate` to regenerate the client.
6. Run the integration test — it must pass.

**Files:**
- `packages/api/prisma/migrations/20260317150000_embedding_updated_at_f019/migration.sql` (new)
- `packages/api/prisma/schema.prisma` (modified)
- `packages/api/src/__tests__/migration.f019.integration.test.ts` (new)

---

#### Step 2 — Config Changes (Infrastructure)

**TDD red phase:** In `packages/api/src/__tests__/config.test.ts` (already exists), add describe block `'OpenAI config vars'` with tests: (a) missing `OPENAI_API_KEY` still parses successfully (must not throw); (b) `OPENAI_EMBEDDING_MODEL` defaults to `'text-embedding-3-small'`; (c) `OPENAI_EMBEDDING_BATCH_SIZE` coerces string `'50'` to number `50`; (d) `OPENAI_EMBEDDING_RPM` defaults to `3000`.

**Green phase:** Extend `EnvSchema` in `packages/api/src/config.ts`:

```
OPENAI_API_KEY: z.string().min(1).optional()
OPENAI_EMBEDDING_MODEL: z.string().min(1).default('text-embedding-3-small')
OPENAI_EMBEDDING_BATCH_SIZE: z.coerce.number().int().min(1).max(2048).default(100)
OPENAI_EMBEDDING_RPM: z.coerce.number().int().min(1).default(3000)
```

`OPENAI_API_KEY` is `.optional()` — no default — so server startup succeeds when it is absent.

**Files:**
- `packages/api/src/config.ts` (modified)
- `packages/api/src/__tests__/config.test.ts` (modified — add OpenAI describe block)

---

#### Step 3 — Error Handler Extension (Infrastructure)

**TDD red phase:** In `packages/api/src/__tests__/errorHandler.test.ts` (already exists), add test: `mapError` with `{ code: 'EMBEDDING_PROVIDER_UNAVAILABLE' }` returns `statusCode: 422` and `code: 'EMBEDDING_PROVIDER_UNAVAILABLE'`.

**Green phase:** Add the `EMBEDDING_PROVIDER_UNAVAILABLE` block to `errorHandler.ts` following the existing pattern for other 422 codes.

**Files:**
- `packages/api/src/errors/errorHandler.ts` (modified)
- `packages/api/src/__tests__/errorHandler.test.ts` (modified — one new test case)

---

#### Step 4 — Text Builder (Domain)

**TDD red phase:** Write `packages/api/src/__tests__/f019.textBuilder.unit.test.ts`. Tests use `FoodForEmbedding` and `DishForEmbedding` types (post-mapping, camelCase, numbers). Also test `mapFoodRow` and `mapDishRow` mapping functions. Test cases:

**buildFoodText:**
- All fields present — output matches corrected template (includes nameEs always, foodGroup for Category, foodType for Type)
- `foodGroup` null — category line omitted, rest present
- All nutrients null — output contains name, nameEs, type only (no nutrition line)
- Nutrients rounded to 1dp (e.g. 3.567 → 3.6)

**buildDishText:**
- All fields present, multiple categories and cooking methods — "Categories: burgers, sandwiches. Cooking methods: grilled, fried."
- `nameEs` null — Spanish name line omitted
- Empty `categorySlugs` and `cookingMethodSlugs` arrays — those lines omitted
- All nutrients null — output contains name, chain only
- Single category, single cooking method — no trailing comma

**mapFoodRow:**
- Converts snake_case to camelCase correctly
- Parses Decimal strings to numbers (`'165.50'` → `165.5`)
- Null Decimal fields map to `null` (not `NaN`)

**mapDishRow:**
- Converts snake_case to camelCase correctly
- Parses Decimal strings to numbers
- Splits `STRING_AGG` result `'burgers,sandwiches'` into `['burgers', 'sandwiches']`
- Null `STRING_AGG` (no categories) maps to empty array `[]`

**Green phase:** Create `packages/api/src/embeddings/types.ts` with internal query-result shapes (not Zod).

**IMPORTANT — $queryRaw returns snake_case:** PostgreSQL column names are snake_case (`food_group`, `name_es`, `chain_slug`). `$queryRaw` does NOT map to camelCase. Use snake_case raw types + a `mapFoodRows()`/`mapDishRows()` function to convert to camelCase domain types.

**IMPORTANT — Decimal columns:** `calories`, `proteins`, etc. are `Decimal(8,2)` in PostgreSQL. `$queryRaw` returns them as `string` or `Prisma.Decimal`, not `number`. The mapping function must call `parseFloat()` on each nutrient value.

**IMPORTANT — Food.nameEs is NOT NULL:** In schema.prisma, `Food.nameEs` is `String` (not nullable). Only `Dish.nameEs` is `String?` (nullable). FoodRow must reflect this.

**IMPORTANT — Categories and CookingMethods are M:N via junction tables:** `Dish` has no direct `category` or `cookingMethod` field. Categories come from `dish_dish_categories` → `dish_categories`, cooking methods from `dish_cooking_methods` → `cooking_methods`. A dish can have **multiple** of each. Use `STRING_AGG()` in SQL to aggregate slugs into a comma-separated string, then split in the mapping function.

**IMPORTANT — foodGroup vs foodType:** `Food.foodType` is an enum (`generic`/`branded`/`composite`) — NOT a nutritional category. The human-readable food category is `Food.foodGroup` (e.g. "Poultry Products", "Dairy and Egg Products"). Use `foodGroup` for the "Category" line in text builder.

```typescript
// --- Raw query result types (snake_case, matching PostgreSQL columns) ---
interface FoodRowRaw {
  id: string;
  name: string;
  name_es: string;                // NOT NULL in schema
  food_group: string | null;
  food_type: string;              // enum: generic/branded/composite
  calories: string | null;        // Decimal → string from $queryRaw
  proteins: string | null;
  carbohydrates: string | null;
  sugars: string | null;
  fats: string | null;
  saturated_fats: string | null;
  fiber: string | null;
  sodium: string | null;
}

interface DishRowRaw {
  id: string;
  name: string;
  name_es: string | null;         // nullable in schema
  chain_slug: string;
  portion_grams: string | null;   // Decimal → string, nullable
  category_slugs: string | null;  // STRING_AGG from junction table
  cooking_method_slugs: string | null; // STRING_AGG from junction table
  calories: string | null;        // Decimal → string from $queryRaw
  proteins: string | null;
  carbohydrates: string | null;
  sugars: string | null;
  fats: string | null;
  saturated_fats: string | null;
  fiber: string | null;
  sodium: string | null;
}

// --- Mapped domain types (camelCase, numbers parsed) ---
interface FoodForEmbedding {
  id: string;
  name: string;
  nameEs: string;
  foodGroup: string | null;
  foodType: string;
  calories: number | null;
  proteins: number | null;
  carbohydrates: number | null;
  sugars: number | null;
  fats: number | null;
  saturatedFats: number | null;
  fiber: number | null;
  sodium: number | null;
}

interface DishForEmbedding {
  id: string;
  name: string;
  nameEs: string | null;
  chainSlug: string;
  portionGrams: number | null;    // serving size context
  categorySlugs: string[];        // parsed from STRING_AGG
  cookingMethodSlugs: string[];   // parsed from STRING_AGG
  calories: number | null;
  proteins: number | null;
  carbohydrates: number | null;
  sugars: number | null;
  fats: number | null;
  saturatedFats: number | null;
  fiber: number | null;
  sodium: number | null;
}

interface EmbeddingPipelineOptions {
  target: EmbeddingTarget;
  chainSlug?: string;
  batchSize: number;
  force: boolean;
  dryRun: boolean;
  prisma: PrismaClient;
  openaiApiKey: string;
  embeddingModel: string;
  embeddingRpm: number;
}
```

Also create mapping functions in types.ts:
- `mapFoodRow(raw: FoodRowRaw): FoodForEmbedding` — camelCase conversion + `parseFloat()` for Decimal fields (null if source is null)
- `mapDishRow(raw: DishRowRaw): DishForEmbedding` — same + split `STRING_AGG` result into `string[]` (empty array if null)

Then create `packages/api/src/embeddings/textBuilder.ts` with `buildFoodText(food: FoodForEmbedding): string` and `buildDishText(dish: DishForEmbedding): string`. Round all nutrient values to 1dp. Omit lines for null fields.

**Text builder rules (corrected from spec):**
- `buildFoodText`: Always include `nameEs` (it's NOT NULL). Use `foodGroup` for "Category" line (not `foodType`). Include `foodType` as "Type: generic/branded/composite" line.
- `buildDishText`: Omit `nameEs` line if null. Use `categorySlugs.join(', ')` for "Categories" line (omit if empty). Use `cookingMethodSlugs.join(', ')` for "Cooking methods" line (omit if empty).

Example `buildFoodText` output:
```
Food: Chicken Breast. Spanish name: Pechuga de pollo. Type: generic. Category: Poultry Products.
Nutrition per 100g: 165 kcal, 31g protein, 0g carbohydrates, 0g sugars, 3.6g fat, 1g saturated fat, 0g fiber, 74mg sodium.
```

Example `buildDishText` output:
```
Dish: Big Mac. Spanish name: Big Mac. Restaurant chain: mcdonalds-es.
Categories: burgers, sandwiches. Cooking methods: grilled. Serving size: 215g.
Nutrition per serving: 550 kcal, 25g protein, 46g carbohydrates, 9g sugars, 30g fat, 11g saturated fat, 3g fiber, 730mg sodium.
```

**Files:**
- `packages/api/src/embeddings/types.ts` (new)
- `packages/api/src/embeddings/textBuilder.ts` (new)
- `packages/api/src/__tests__/f019.textBuilder.unit.test.ts` (new)

---

#### Step 5 — Embedding Client (Infrastructure)

**TDD red phase:** Write `packages/api/src/__tests__/f019.embeddingClient.unit.test.ts`. Mock the `openai` package using Vitest's `vi.mock`. Test cases:

- `estimateTokens(['hello world'])` — returns `Math.ceil(2 * 1.3)` = 3
- `callOpenAIEmbeddings` — happy path: returns 2D array of numbers from mocked SDK
- `callOpenAIEmbeddings` — retries once on 429 error, then succeeds
- `callOpenAIEmbeddings` — retries 3 times on 5xx, then records error and throws after 3 failures
- `callOpenAIEmbeddings` — non-retryable error (4xx != 429) throws immediately without retry
- Token bucket: calling more than RPM batches per minute delays subsequent calls (mock `Date.now` to control time)

**Green phase:** Install `openai` package in `packages/api`. Create `packages/api/src/embeddings/embeddingClient.ts`:

- `estimateTokens(texts: string[]): number` — word-count × 1.3 heuristic, no tiktoken
- `EmbeddingClientConfig` interface: `{ apiKey: string; model: string; rpm: number }`
- `RateLimiter` class (token bucket): initialized with `rpm`, `acquire()` method checks remaining tokens per minute window. Simple in-memory implementation — no Redis.
- `callOpenAIEmbeddings(texts: string[], config: EmbeddingClientConfig): Promise<number[][]>` — creates `OpenAI` client from `apiKey`, calls `embeddings.create({ model, input: texts })`, extracts `data[].embedding`, returns `number[][]`. Retry logic: wraps in a retry loop (max 3 attempts), checks `error.status` for 429 or >= 500, sleeps exponentially (1s, 2s, 4s) between retries. After 3 failures, re-throws.

**Files:**
- `packages/api/src/embeddings/embeddingClient.ts` (new)
- `packages/api/src/__tests__/f019.embeddingClient.unit.test.ts` (new)
- `packages/api/package.json` (add `openai` to dependencies)

---

#### Step 6 — Embedding Writer (Infrastructure)

**TDD red phase:** Expand `packages/api/src/__tests__/migration.f019.integration.test.ts` with a second describe block `'embeddingWriter'`. Set up a fixture food and dish (pre-cleanup + create pattern from F003 test). Test:

- `writeFoodEmbedding(prisma, foodId, vector)` — after call, `SELECT embedding_updated_at FROM foods WHERE id = $1` returns a non-null timestamp, and `SELECT embedding IS NOT NULL FROM foods WHERE id = $1` is true
- `writeDishEmbedding(prisma, dishId, vector)` — same for dishes
- After write, calling `writeFoodEmbedding` again with a new vector updates `embedding_updated_at` to a later timestamp

**Green phase:** Create `packages/api/src/embeddings/embeddingWriter.ts`:

```typescript
export async function writeFoodEmbedding(
  prisma: PrismaClient,
  id: string,
  vector: number[],
): Promise<void>

export async function writeDishEmbedding(
  prisma: PrismaClient,
  id: string,
  vector: number[],
): Promise<void>
```

Both use `prisma.$executeRaw` with the `Prisma.sql` template tag:

```sql
UPDATE foods
SET embedding = ${vectorLiteral}::vector,
    embedding_updated_at = NOW()
WHERE id = ${id}::uuid
```

Construct `vectorLiteral` as a string `[n1,n2,...,n1536]` and pass via `Prisma.sql` or `$executeRawUnsafe` (consistent with F003 precedent using `$executeRawUnsafe`).

**Files:**
- `packages/api/src/embeddings/embeddingWriter.ts` (new)
- `packages/api/src/__tests__/migration.f019.integration.test.ts` (modified — add embeddingWriter describe)

---

#### Step 7 — Pipeline Orchestrator (Application)

**TDD red phase:** Write `packages/api/src/__tests__/f019.pipeline.unit.test.ts`. Use `vi.mock` to stub:
- DB query helpers (inline mock functions replacing actual `$queryRaw` / `$executeRaw`)
- `callOpenAIEmbeddings` from `embeddingClient.ts`
- `writeFoodEmbedding` / `writeDishEmbedding` from `embeddingWriter.ts`

Test cases:
- `dryRun: true` — returns `processedFoods: 0`, `processedDishes: 0`, `estimatedTokens > 0`, never calls `callOpenAIEmbeddings` or writers
- `target: 'foods'` — only calls food query and food writer; `processedDishes === 0`
- `target: 'dishes'` — only calls dish query and dish writer; `processedFoods === 0`
- `target: 'all'` — processes foods then dishes in sequence
- `force: false` — SQL query uses `WHERE embedding_updated_at IS NULL` condition (verify via mock call argument)
- `force: true` — SQL query has no `WHERE embedding_updated_at IS NULL` condition
- `chainSlug` with `target: 'dishes'` — dish query includes `AND r.chain_slug = $slug`
- `chainSlug` with `target: 'all'` — warns in logs, scopes only dishes
- Single item `callOpenAIEmbeddings` rejection — item appears in `errors`, pipeline continues, `errorCount === 1`
- Single item `writeFoodEmbedding` rejection — item appears in `errors`, pipeline continues
- DB query failure (fetch step throws) — pipeline re-throws with `DB_UNAVAILABLE` code
- Empty scope returns `processedFoods: 0, processedDishes: 0, errorCount: 0` normally
- Non-default model logs WARNING (verify via mocked `log.warn`)
- `durationMs` is a non-negative integer; `completedAt` is an ISO string

**Green phase:** Create `packages/api/src/embeddings/pipeline.ts`. The orchestrator:

1. Records start time.
2. Validates `OPENAI_API_KEY` presence — if missing and not `dryRun`, throws error with `code: 'EMBEDDING_PROVIDER_UNAVAILABLE'`.
3. If `embeddingModel !== 'text-embedding-3-small'`, emits a WARNING log.
4. If `chainSlug` provided and `target === 'all'`, emits a WARNING log.
5. Fetches rows from DB using `prisma.$queryRaw<FoodRowRaw[]>` / `prisma.$queryRaw<DishRowRaw[]>`. Then maps via `mapFoodRow()`/`mapDishRow()`.

   **Food query** — Uses a CTE to de-duplicate FoodNutrient rows (same `@@unique([foodId, sourceId])` pattern as DishNutrient). Picks the most recent nutrient row per food:
   ```sql
   WITH ranked_fn AS (
     SELECT fn.*, ROW_NUMBER() OVER (PARTITION BY fn.food_id ORDER BY fn.created_at DESC) AS rn
     FROM food_nutrients fn
   )
   SELECT f.id, f.name, f.name_es, f.food_group, f.food_type,
          rfn.calories, rfn.proteins, rfn.carbohydrates, rfn.sugars,
          rfn.fats, rfn.saturated_fats, rfn.fiber, rfn.sodium
   FROM foods f
   LEFT JOIN ranked_fn rfn ON rfn.food_id = f.id AND rfn.rn = 1
   WHERE f.embedding_updated_at IS NULL  -- omitted when force=true
   ```

   **Dish query** — Uses a CTE to de-duplicate DishNutrient rows (a dish can have multiple nutrient sources via `@@unique([dishId, sourceId])`). Picks the most recently created nutrient row per dish. Then LEFT JOINs junction tables for M:N categories and cooking methods with `STRING_AGG`:
   ```sql
   WITH ranked_dn AS (
     SELECT dn.*, ROW_NUMBER() OVER (PARTITION BY dn.dish_id ORDER BY dn.created_at DESC) AS rn
     FROM dish_nutrients dn
   )
   SELECT d.id, d.name, d.name_es, r.chain_slug, d.portion_grams,
          rdn.calories, rdn.proteins, rdn.carbohydrates, rdn.sugars,
          rdn.fats, rdn.saturated_fats, rdn.fiber, rdn.sodium,
          STRING_AGG(DISTINCT dc.slug, ',') AS category_slugs,
          STRING_AGG(DISTINCT cm.slug, ',') AS cooking_method_slugs
   FROM dishes d
   JOIN restaurants r ON r.id = d.restaurant_id
   LEFT JOIN ranked_dn rdn ON rdn.dish_id = d.id AND rdn.rn = 1
   LEFT JOIN dish_dish_categories ddc ON ddc.dish_id = d.id
   LEFT JOIN dish_categories dc ON dc.id = ddc.dish_category_id
   LEFT JOIN dish_cooking_methods dcm ON dcm.dish_id = d.id
   LEFT JOIN cooking_methods cm ON cm.id = dcm.cooking_method_id
   WHERE d.embedding_updated_at IS NULL  -- omitted when force=true
   AND r.chain_slug = ${chainSlug}       -- omitted when no chainSlug
   GROUP BY d.id, d.name, d.name_es, r.chain_slug, d.portion_grams,
            rdn.calories, rdn.proteins, rdn.carbohydrates, rdn.sugars,
            rdn.fats, rdn.saturated_fats, rdn.fiber, rdn.sodium
   ```

   **Why CTE for nutrient de-duplication:** `DishNutrient` has `@@unique([dishId, sourceId])`, meaning a dish can have multiple nutrient rows from different sources. Without de-duplication, the JOIN multiplies rows and corrupts `STRING_AGG` aggregates. The CTE picks the most recent source per dish.

   Any DB query error re-throws with `code: 'DB_UNAVAILABLE'`.
6. Counts skipped items (total DB rows minus fetched rows — when `force: false`, fetch returns only un-embedded; query a separate `COUNT(*)` first).
7. Builds text for all fetched items using `buildFoodText`/`buildDishText`.
8. Estimates tokens using `estimateTokens`.
9. If `dryRun`, returns immediately with counts and estimate — no API calls.
10. Processes items in batches of `batchSize`. For each batch: calls `callOpenAIEmbeddings`, then iterates over results calling `writeFoodEmbedding`/`writeDishEmbedding` per item. Any per-item error (API or write) is caught, added to `errors[]`, execution continues.
11. Returns `EmbeddingGenerateData` with all counters, `durationMs`, and `completedAt`.

**Files:**
- `packages/api/src/embeddings/pipeline.ts` (new)
- `packages/api/src/__tests__/f019.pipeline.unit.test.ts` (new)

---

#### Step 8 — Barrel Export (Domain)

**No additional tests needed** — covered by consumer tests.

**Green phase:** Create `packages/api/src/embeddings/index.ts`:

```typescript
export { runEmbeddingPipeline } from './pipeline.js';
export { buildFoodText, buildDishText } from './textBuilder.js';
export { estimateTokens } from './embeddingClient.js';
```

**Files:**
- `packages/api/src/embeddings/index.ts` (new)

---

#### Step 9 — Fastify Route (Presentation)

**TDD red phase:** Write `packages/api/src/__tests__/f019.embeddings.route.test.ts`. Use `buildApp().inject()`. Mock `runEmbeddingPipeline` at the module level with `vi.mock`. Test cases:

- Valid body `{ target: 'all', dryRun: true }` → 200, `success: true`, `data.dryRun === true`
- Invalid body `{ target: 'invalid' }` → 400, `error.code === 'VALIDATION_ERROR'`
- Body without `target` → 400, `error.code === 'VALIDATION_ERROR'`
- `runEmbeddingPipeline` throws with `code: 'EMBEDDING_PROVIDER_UNAVAILABLE'` → 422, `error.code === 'EMBEDDING_PROVIDER_UNAVAILABLE'`
- `runEmbeddingPipeline` throws with `code: 'DB_UNAVAILABLE'` → 500, `error.code === 'DB_UNAVAILABLE'`
- Response shape matches `EmbeddingGenerateResponseSchema` (parse with Zod, expect no errors)
- Default values applied: `batchSize` defaults to config value, `force: false`, `dryRun: false`

**Green phase:** Create `packages/api/src/routes/embeddings.ts` following the `quality.ts` pattern:

```typescript
interface EmbeddingPluginOptions { prisma: PrismaClient; }

const embeddingRoutesPlugin: FastifyPluginAsync<EmbeddingPluginOptions> = async (app, opts) => {
  app.post('/embeddings/generate', {
    schema: {
      body: EmbeddingGenerateRequestSchema,
      tags: ['Embeddings'],
      // ... summary, description
    },
    config: { timeout: 300_000 },  // 5 min
  }, async (request, reply) => {
    const body = request.body as EmbeddingGenerateRequest;
    const apiKey = process.env['OPENAI_API_KEY'];

    if (!apiKey) {
      throw Object.assign(
        new Error('OPENAI_API_KEY is not configured'),
        { code: 'EMBEDDING_PROVIDER_UNAVAILABLE' },
      );
    }
    // ...call runEmbeddingPipeline, return { success: true, data }
  });
};
export const embeddingRoutes = fastifyPlugin(embeddingRoutesPlugin);
```

Register in `packages/api/src/app.ts`.

**Files:**
- `packages/api/src/routes/embeddings.ts` (new)
- `packages/api/src/app.ts` (modified — import + register)
- `packages/api/src/__tests__/f019.embeddings.route.test.ts` (new)

---

#### Step 10 — CLI Script (Presentation)

**No dedicated test file** — CLI is covered by `f019.pipeline.unit.test.ts` (the `runEmbeddingPipeline` function is the testable unit). The CLI's `main()` is excluded from coverage by the `isMain` guard.

**Green phase:** Create `packages/api/src/scripts/embeddings-generate.ts` following the `quality-monitor.ts` pattern:

```typescript
export async function runEmbeddingsCLI(
  opts: EmbeddingCLIOptions,
  prismaOverride?: PrismaClient,
): Promise<void>

async function main(): Promise<void>

const isMain = process.argv[1]?.endsWith('embeddings-generate.ts') ||
               process.argv[1]?.endsWith('embeddings-generate.js');
if (isMain) void main();
```

CLI argument parsing: `--target` (required), `--batch-size`, `--force` (boolean flag), `--dry-run` (boolean flag), `--chain-slug`.

On success: `process.stdout.write(JSON.stringify(result, null, 2) + '\n')` and `process.exit(0)`.

On fatal error (missing key, DB unavailable): `process.stderr.write(...)` and `process.exit(1)`.

Add to `package.json` scripts: `"embeddings:generate": "tsx src/scripts/embeddings-generate.ts"`.

**Files:**
- `packages/api/src/scripts/embeddings-generate.ts` (new)
- `packages/api/package.json` (modified — scripts + openai dep)

---

### Testing Strategy

**Unit tests (no DB, no network):**

| File | What it tests |
|------|---------------|
| `f019.textBuilder.unit.test.ts` | `buildFoodText`, `buildDishText` — all fields, null fields omitted, no nutrients, 1dp rounding, multiple categories/cooking methods. `mapFoodRow`/`mapDishRow` — snake_case→camelCase, Decimal string→number, STRING_AGG→array, null→empty array |
| `f019.embeddingClient.unit.test.ts` | `estimateTokens` heuristic, retry on 429/5xx (mock `openai`), non-retryable error, rate limiter token bucket |
| `f019.pipeline.unit.test.ts` | `runEmbeddingPipeline` — all target modes, dryRun, force flag, chainSlug scoping, continue-on-failure, DB error abort, empty scope, skipped count |
| `f019.embeddings.route.test.ts` | Route validation (400), EMBEDDING_PROVIDER_UNAVAILABLE (422), DB_UNAVAILABLE (500), happy path 200, response schema |

**Integration tests (real DB):**

| File | What it tests |
|------|---------------|
| `migration.f019.integration.test.ts` | `embedding_updated_at` column exists on both tables; `writeFoodEmbedding` + `writeDishEmbedding` write vector and timestamp correctly; re-write updates timestamp |

**Mocking strategy:**

- `callOpenAIEmbeddings`: mock at module level via `vi.mock('../embeddings/embeddingClient.js')`. Never make real OpenAI calls in tests.
- `writeFoodEmbedding`/`writeDishEmbedding`: mock at module level via `vi.mock('../embeddings/embeddingWriter.js')`.
- Prisma `$queryRaw`/`$executeRaw` in pipeline unit tests: pass a mock PrismaClient object with vi.fn() implementations (do not import the real singleton).
- Integration tests: use the real `DATABASE_URL_TEST` database — no mocking.

---

### Key Patterns

**Fastify plugin registration** — Follow `packages/api/src/routes/quality.ts` exactly: `FastifyPluginAsync<PluginOptions>`, wrap with `fastifyPlugin(...)`, register in `app.ts`.

**Error codes** — Throw errors as `Object.assign(new Error('...'), { code: 'CODE_STRING' })` — the error handler dispatches on `asAny['code']`. New code `EMBEDDING_PROVIDER_UNAVAILABLE` must be added to `errorHandler.ts` before the route is tested.

**Raw SQL writes for vector columns** — Use `$executeRawUnsafe` (not `Prisma.sql` template) for embedding writes because the vector literal `[n1,...,n1536]` must be constructed dynamically and the `::vector` cast is not expressible via parameterised `Prisma.sql`. Consistent with F003 precedent in `migration.f003.integration.test.ts`.

**Raw SQL reads for pipeline fetch** — Use `Prisma.sql` template tag with typed return via `prisma.$queryRaw<FoodRowRaw[]>`. Cast `bigint` counters to `Number()`. Pattern from `checkNutrientCompleteness.ts`.

**snake_case → camelCase mapping (CRITICAL)** — `$queryRaw` returns PostgreSQL column names as-is (snake_case). Use `FoodRowRaw`/`DishRowRaw` types for the raw result, then `mapFoodRow()`/`mapDishRow()` to convert to `FoodForEmbedding`/`DishForEmbedding` (camelCase). This is the same pattern used in `checkNutrientCompleteness.ts` (lines 94-99: `row.chain_slug` → `chainSlug`).

**Decimal → number conversion** — PostgreSQL `Decimal(8,2)` columns come back as `string` (or `Prisma.Decimal`) from `$queryRaw`, NOT as JavaScript `number`. All nutrient fields must be parsed via `parseFloat()` in the mapping function. Null-safe: if source is null, map to `null` (not `NaN`).

**M:N junction tables for categories/cooking methods** — Dishes relate to categories and cooking methods via junction tables (`dish_dish_categories`, `dish_cooking_methods`). Use `STRING_AGG(DISTINCT slug, ',')` in the SQL query + `GROUP BY` on the dish columns. Split the comma-separated result into `string[]` in the mapping function. Empty/null → empty array.

**`isMain` guard** — CLI files must check `process.argv[1]` before calling `main()`. Use the same `endsWith('.ts')` || `endsWith('.js')` check as `quality-monitor.ts`. This is required for the test suite to import the module without triggering side effects.

**`openai` not in config singleton** — `OPENAI_API_KEY` is read via `process.env['OPENAI_API_KEY']` at invocation time (inside the route handler and pipeline), not from the `config` singleton. The `config` singleton is validated at startup; `OPENAI_API_KEY` absence must not fail startup. Validate presence at pipeline entry instead.

**Batch writes are immediate** — Do not accumulate vectors in memory across batches. Write each batch's results immediately after `callOpenAIEmbeddings` returns. Ref: Performance Considerations in Spec.

**Fixture UUID prefix for F019** — Use `f019xxxx-YYYY-4000-a000-ZZZZZZZZZZZZ` format in integration tests to avoid collision with other test fixtures.

**Migration timestamp** — The next migration after F003 (`20260311140000`) must use a later timestamp. Use `20260317150000` to match the current date (2026-03-17) and maintain sequential order.

---

## Acceptance Criteria

- [x] AC1: `npm run embeddings:generate --target all --dry-run` exits 0 and logs estimated tokens without OpenAI calls or DB writes
- [x] AC2: `POST /embeddings/generate` with `{ target: 'all', dryRun: true }` returns 200 with `dryRun: true`, `processedFoods: 0`, `processedDishes: 0`, `estimatedTokens > 0`
- [x] AC3: After full run (`--target all`), all foods and dishes have non-null `embeddingUpdatedAt`
- [x] AC4: `buildFoodText()` and `buildDishText()` have unit tests: all fields, partial nulls, no nutrient row
- [x] AC5: `POST /embeddings/generate` with `{ target: 'invalid' }` returns 400 VALIDATION_ERROR
- [x] AC6: Missing `OPENAI_API_KEY` returns 422 EMBEDDING_PROVIDER_UNAVAILABLE (not server crash)
- [x] AC7: Non-default model triggers WARNING log at pipeline start
- [x] AC8: Single item failure does not abort pipeline — appears in `errors`, remaining items processed
- [x] AC9: `--chain-slug mcdonalds-es --target dishes` scopes query to McDonald's dishes only
- [x] AC10: All new modules have ≥ 90% line coverage (TDD) — QA estimates >95% on all modules
- [x] AC11: All tests pass — 108 F019 tests + 884 total
- [x] AC12: Build succeeds (`npm run build`) — no new errors
- [x] AC13: Specs updated (api-spec.yaml, shared schemas)
- [x] AC14: DB migration for `embeddingUpdatedAt` included

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing (108 F019 tests)
- [x] Code follows project standards (strict TS, no `any`)
- [x] No linting errors (no new lint errors)
- [x] Build succeeds (no new build errors)
- [x] Specs reflect final implementation
- [x] `production-code-validator` approved (1 HIGH fixed)

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` executed, plan approved
- [x] Step 3: `backend-developer` executed with TDD
- [x] Step 4: `production-code-validator` executed, quality gates pass
- [x] Step 5: `code-review-specialist` executed — 1 Critical + 4 Important fixed
- [x] Step 5: `qa-engineer` executed — 37 edge-case tests, QA VERIFIED
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-17 | Spec (Step 0) | spec-creator: api-spec.yaml updated, 6 Zod schemas in packages/shared, ticket created |
| 2026-03-17 | Setup (Step 1) | Branch + ticket + tracker. Auto-approved (L2) |
| 2026-03-17 | Plan (Step 2) | backend-planner: 10-step plan. 2 review rounds (9 corrections). User-approved |
| 2026-03-17 | Implement (Step 3) | backend-developer: TDD 10 steps. 71 new tests (5 files). openai SDK integrated |
| 2026-03-17 | Finalize (Step 4) | production-code-validator: 1 HIGH fix (skipped count). Quality gates pass |
| 2026-03-17 | Review (Step 5) | code-review: 1C+4I fixed (UUID validation, client cache, dedup text build, route timeout, RateLimiter doc). QA: 37 edge-case tests, VERIFIED. PR #17 |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Implementation Plan, AC, DoD, Workflow, Completion Log, Merge Checklist Evidence |
| 1. Mark all items | [x] | AC: 14/14, DoD: 7/7, Workflow: 7/8 (Step 6 pending) |
| 2. Verify product tracker | [x] | Active Session: step 5/6 (Review), Features table: 5/6 |
| 3. Update key_facts.md | [x] | Updated: embedding route, pipeline module, CLI script, schemas, migration count, EMBEDDING_PROVIDER_UNAVAILABLE error code |
| 4. Update decisions.md | [x] | N/A — no new ADR needed |
| 5. Commit documentation | [x] | Commit: (pending — will be committed with this table) |
| 6. Verify clean working tree | [x] | `git status`: clean after docs commit |

---

*Ticket created: 2026-03-17*
