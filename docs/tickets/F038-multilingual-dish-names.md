# F038: Multilingual Dish Name Resolution

**Feature:** F038 | **Type:** Backend-Feature | **Priority:** High
**Status:** Done | **Branch:** feature/F038-multilingual-dish-names
**Created:** 2026-03-25 | **Dependencies:** None (ADR-010 already written)

---

## Spec

### Description

883/885 dishes (99.8%) have `name_es = NULL`. Names are stored in the PDF source language (mostly English from chain nutrition PDFs). Spanish-speaking users searching in Spanish experience L1 FTS failures (Spanish parser on English text) and L3 embedding degradation. L4 compensates but is the most expensive level.

Per ADR-010, the solution is Enfoque A: populate `name_es` for all dishes via batch LLM translation. No query-time translation. `name` remains immutable (ADR-001).

**Components:**
1. Schema migration — new `name_source_locale VARCHAR(5)` nullable column on `dishes`
2. Batch translation script — CLI script using gpt-4o-mini to translate ~885 dish names EN→ES
3. Ingest pipeline fix — future ingests always populate `name_es` for Spanish-locale chains
4. Embedding regeneration — `buildDishText()` already includes `nameEs` when non-null

Full spec: `docs/specs/f038-multilingual-dish-names-spec.md`

### API Changes (if applicable)

None. No new endpoints, no response schema changes. `nameSourceLocale` is internal metadata not exposed in API responses.

### Data Model Changes (if applicable)

New nullable column on `dishes` table:
```
nameSourceLocale  String?  @map("name_source_locale") @db.VarChar(5)
```
Values: `'en'`, `'es'`, `'mixed'`, `'unknown'`. NULL = not yet classified.

### UI Changes (if applicable)

N/A — backend only.

### Edge Cases & Error Handling

- Brand names (Whopper, Big Mac, McFlurry) → copy `name` to `name_es` as-is
- Already-Spanish names (Telepizza, Domino's, Pans & Company dishes) → copy `name` to `name_es`
- Mixed-language names ("Chicken / Pollo") → `name_source_locale = 'mixed'`, LLM translates
- Short/ambiguous names (≤3 chars) → copy as-is, `name_source_locale = 'unknown'`
- OpenAI API failure mid-batch → continue-on-failure, script exits code 1, re-run is idempotent
- Batch response array length mismatch → skip entire batch, log error, continue
- Existing non-null `name_es` → skip by default (script only processes NULL rows)

---

## Implementation Plan

### Existing Code to Reuse

**Infrastructure / DB access**
- `packages/api/src/lib/prisma.ts` — `defaultPrisma` singleton; use directly in the batch translation script (same pattern as `embeddings-generate.ts`)
- `packages/api/src/config.ts` — `config` singleton for `OPENAI_API_KEY` and model settings
- `packages/api/prisma/schema.prisma` — `Dish` model to extend with `nameSourceLocale`

**Ingest pipeline**
- `packages/scraper/src/utils/normalize.ts` — `normalizeDish()` already passes `raw.nameEs` through; no changes needed
- `packages/scraper/src/base/types.ts` — `RawDishData` already has `nameEs?: string`; the ingest routes will mutate `raw.nameEs` before calling `normalizeDish()`
- `packages/api/src/routes/ingest/pdf.ts`, `pdf-url.ts`, `image-url.ts` — the three ingest routes to modify (Step 8 normalization loop in each)

**Embeddings / estimation (no changes, confirmed working)**
- `packages/api/src/embeddings/textBuilder.ts` — `buildDishText()` already handles `nameEs !== null` correctly
- `packages/api/src/estimation/level1Lookup.ts` — already uses `COALESCE(name_es, name)` in FTS; works once `name_es` is populated

**Chain registry**
- `packages/api/src/config/chains/chain-pdf-registry.ts` — `CHAIN_PDF_REGISTRY` and `ChainPdfConfig` type; `chainSlug` values are the source of truth for chain identification
- `packages/api/src/config/chains/chain-seed-ids.ts` — `CHAIN_SEED_IDS` confirms which chains are seeded (BK, KFC, Telepizza, Five Guys, Domino's, Subway, Pans & Company, plus newer chains from the registry: Popeyes, Papa John's, Pizza Hut, Starbucks, Tim Hortons)

**Script patterns**
- `packages/api/src/scripts/embeddings-generate.ts` — reference for DI-friendly `run*CLI(opts, prismaOverride?)` pattern, `isMain` guard, `parseArgs()`, stdout JSON output
- `packages/api/src/scripts/batch-ingest.ts` — reference for continue-on-failure pattern, exit code 0/1, `console.log`-based progress reporting

**Shared schemas**
- `packages/shared/src/schemas/dish.ts` — `DishSchema` and `CreateDishSchema`; will add `nameSourceLocale` field

---

### Files to Create

| File | Purpose |
|------|---------|
| `packages/api/prisma/migrations/20260325130000_add_name_source_locale_f038/migration.sql` | Adds `name_source_locale VARCHAR(5) NULL` column to `dishes` table with a COMMENT |
| `packages/api/src/ingest/chainLocaleRegistry.ts` | Exports `CHAIN_SOURCE_LOCALE: Record<string, 'en' \| 'es'>` — maps chain slug to the source language of its nutritional documents |
| `packages/api/src/scripts/translate-dish-names.ts` | Standalone CLI script: classifies dish names locally, batches English names to gpt-4o-mini, writes `nameEs` and `nameSourceLocale` to the DB. DI-friendly via `runTranslateDishNames(opts, prismaOverride?)`. |
| `packages/api/src/__tests__/f038.chainLocaleRegistry.unit.test.ts` | Unit tests for `CHAIN_SOURCE_LOCALE` registry (coverage + known-slug assertions) |
| `packages/api/src/__tests__/scripts/f038.translateDishNames.unit.test.ts` | Unit tests for the classification logic (brand detection, Spanish heuristic, short-copy rule, LLM path) with mocked OpenAI and Prisma |
| `packages/api/src/__tests__/f038.ingest.unit.test.ts` | Unit tests for the ingest route changes — verifies `nameEs` and `nameSourceLocale` are set correctly for Spanish-chain and English-chain dishes before the Prisma write |
| `packages/api/src/__tests__/migration.f038.integration.test.ts` | Integration test: verifies `name_source_locale` column exists on `dishes` table in the test DB |

---

### Files to Modify

| File | Change |
|------|--------|
| `packages/api/prisma/schema.prisma` | Add `nameSourceLocale String? @map("name_source_locale") @db.VarChar(5)` to the `Dish` model, after the existing `nameEs` field |
| `packages/shared/src/schemas/dish.ts` | Add `nameSourceLocale: z.string().max(5).nullable().optional()` to `DishSchema` (after `nameEs`). `CreateDishSchema` inherits it via `DishSchema.omit(...).extend(...)` pattern — no extra change needed there. |
| `packages/shared/src/index.ts` | Re-export is automatic via barrel; no manual change needed if the schema file is already re-exported. Confirm the barrel includes `dish.ts` exports (it does via the existing pattern). |
| `packages/api/src/routes/ingest/pdf.ts` | In Step 8 normalization loop: import `CHAIN_SOURCE_LOCALE` from `chainLocaleRegistry.ts`. Before calling `normalizeDish(raw, ...)`, set `raw.nameEs` based on chain locale (or leave undefined for English chains). After merging into the Prisma create/update payload, include `nameSourceLocale`. The PDF route does not receive `chainSlug` in its body — use `undefined` (defaults to `'unknown'` locale). |
| `packages/api/src/routes/ingest/pdf-url.ts` | Same as above. This route receives `chainSlug` (optional). Look up `CHAIN_SOURCE_LOCALE[chainSlug]` to determine locale. Set `raw.nameEs` and include `nameSourceLocale` in both the `create` and `update` data payloads. |
| `packages/api/src/routes/ingest/image-url.ts` | Same as `pdf-url.ts`. This route also receives optional `chainSlug`. Apply the same locale-aware population pattern. |
| `packages/api/package.json` | Add two npm scripts: `"translate:dish-names": "tsx src/scripts/translate-dish-names.ts"` and `"translate:dish-names:dry-run": "tsx src/scripts/translate-dish-names.ts --dry-run"` |

---

### Implementation Order

Follow the DDD layer order: Domain > Application > Infrastructure > Presentation > Tests.

**Step 1 — Migration (Infrastructure)**

Files: `packages/api/prisma/schema.prisma`, `packages/api/prisma/migrations/20260325130000_add_name_source_locale_f038/migration.sql`

- Add `nameSourceLocale String? @map("name_source_locale") @db.VarChar(5)` to the `Dish` model in `schema.prisma`, placed after the existing `nameEs` field and before `description`.
- Create the migration directory and `migration.sql` with:
  ```sql
  ALTER TABLE dishes
    ADD COLUMN name_source_locale VARCHAR(5) NULL;

  COMMENT ON COLUMN dishes.name_source_locale IS
    'Detected language of the original name field. Values: en, es, mixed, unknown. NULL = not yet classified.';
  ```
- Apply with `prisma migrate deploy` (NOT `migrate dev` — pgvector shadow DB issue).
- Run `prisma generate` to regenerate the Prisma client and Kysely types.

**Write test first (TDD):** `packages/api/src/__tests__/migration.f038.integration.test.ts`
- Verify `name_source_locale` column exists on `dishes` table via `information_schema.columns` query (same pattern as `migration.f019.integration.test.ts`).
- Verify column type is `character varying` and is nullable.

---

**Step 2 — Shared Schema (Domain)**

File: `packages/shared/src/schemas/dish.ts`

- Add `nameSourceLocale: z.string().max(5).nullable().optional()` to `DishSchema`, placed after `nameEs`.
- `CreateDishSchema` inherits this automatically since it derives from `DishSchema.omit(...).extend(...)` — no separate change needed in `CreateDishSchema`.
- Run `npm run build -w @foodxplorer/shared` to verify no type errors.

No separate test file needed — schema shape is implicitly tested by the route tests in Step 5.

---

**Step 3 — Chain Locale Registry (Infrastructure)**

File: `packages/api/src/ingest/chainLocaleRegistry.ts`

- Export a `CHAIN_SOURCE_LOCALE: Record<string, 'en' | 'es'>` constant.
- Include all chains that appear in `CHAIN_PDF_REGISTRY` and `CHAIN_IMAGE_REGISTRY`. Initial mapping per the spec:
  - `'burger-king-es': 'en'` — English PDFs
  - `'kfc-es': 'en'` — English PDFs
  - `'telepizza-es': 'es'` — Spanish PDFs
  - `'five-guys-es': 'en'` — English PDFs
  - `'subway-es': 'en'` — English PDFs
  - `'pans-and-company-es': 'es'` — Portuguese/Spanish PDFs
  - `'dominos-es': 'es'` — OCR output is Spanish
  - `'mcdonalds-es': 'en'` — Scraper extracts English names
  - `'popeyes-es': 'es'` — PDF is in Spanish (check PDF content before setting)
  - `'papa-johns-es': 'es'` — PDF is in Spanish
  - `'pizza-hut-es': 'es'` — PDF is in Spanish
  - `'starbucks-es': 'es'` — PDF is in Spanish (per 100g, Spanish language)
  - `'tim-hortons-es': 'es'` — PDF is in Spanish
- Export a helper function `getChainSourceLocale(chainSlug: string | undefined): 'en' | 'es' | 'unknown'` that looks up the registry and returns `'unknown'` for missing slugs.

**Write test first (TDD):** `packages/api/src/__tests__/f038.chainLocaleRegistry.unit.test.ts`
- Known English chains return `'en'` from `getChainSourceLocale()`.
- Known Spanish chains return `'es'`.
- Unknown slug returns `'unknown'`.
- `undefined` slug returns `'unknown'`.
- All entries in `CHAIN_PDF_REGISTRY` have an entry in `CHAIN_SOURCE_LOCALE` (no missing chain).

---

**Step 4 — Batch Translation Script (Application)**

File: `packages/api/src/scripts/translate-dish-names.ts`

Structure follows the pattern of `embeddings-generate.ts` (DI-friendly, `isMain` guard):

- Export `TranslateDishNamesOptions` interface with fields: `dryRun: boolean`, `chainSlug?: string`, `batchSize: number`, `force: boolean` (force retranslation of already-set names). No `--concurrency` flag — sequential processing is sufficient for ~885 dishes (~2 min).
- Export `runTranslateDishNames(opts: TranslateDishNamesOptions, prismaOverride?: PrismaClient): Promise<TranslationSummary>`.
- Export `classifyDishName(name: string, chainSlug: string | undefined, brandNames: ReadonlySet<string>): ClassificationResult` as a pure, separately-testable function.
- `TranslationSummary` type: `{ total: number, brandCopy: number, esCopy: number, shortCopy: number, translated: number, failed: number, skipped: number }`.
- `ClassificationResult` type: `{ action: 'brand_copy' | 'es_copy' | 'short_copy' | 'mixed_copy' | 'code_copy' | 'llm_translate', nameEs?: string, nameSourceLocale: 'en' | 'es' | 'mixed' | 'unknown' }`.

**Classification logic (in `classifyDishName`):**

Step 1 — Brand name detection: the brand name set is derived from a static constant in this file (e.g., `BRAND_NAMES = new Set([...])`) listing known proper nouns: `'Whopper', 'Big Mac', 'McFlurry', 'Croissan\'wich', 'McRib', 'Happy Meal', 'Big King', ...`. Use substring matching: `name` contains any brand name as a whole word (case-insensitive). If matched: `action = 'brand_copy'`, `nameEs = name`, `nameSourceLocale = 'en'`.

Step 2 — Mixed-language detection: check if `name` contains both Spanish indicator words AND English indicator words (e.g., `"Chicken / Pollo"`), or separator patterns like ` / `. If matched: `action = 'mixed_copy'`, `nameEs = name`, `nameSourceLocale = 'mixed'`.

Step 3 — Already-Spanish detection: check if `name` contains 2 or more of the indicator words: `['con', 'de', 'del', 'al', 'sin', 'pollo', 'ternera', 'jamón', 'queso', 'ensalada', 'patatas', 'salsa', 'pechuga', 'menú', 'pizza', 'bocadillo', 'refresco']` (word-boundary match, case-insensitive). If matched: `action = 'es_copy'`, `nameEs = name`, `nameSourceLocale = 'es'`.

Step 4 — Short/ambiguous: `name.trim().length <= 3`. If matched: `action = 'short_copy'`, `nameEs = name`, `nameSourceLocale = 'unknown'`.

Step 5 — Code/non-alpha detection: if name is composed entirely of non-alpha tokens (digits, punctuation, e.g., `"1234"`, `"X-5"`): `action = 'code_copy'`, `nameEs = name`, `nameSourceLocale = 'unknown'`.

Step 6 — All others: `action = 'llm_translate'`, `nameSourceLocale = 'en'`.

**Main script flow:**

1. Query Prisma for all dishes where `nameEs IS NULL` (or all dishes if `--force`). Include `restaurant.chainSlug` via `include`. If `--chain` filter provided, add `where: { restaurant: { chainSlug: opts.chainSlug } }`.
2. Log: `[translate-dish-names] Starting: N dishes to process`.
3. Classify all dishes locally using `classifyDishName()`. Group into four buckets.
4. Log counts per bucket (Steps 1–4 from spec §4.7).
5. For non-LLM dishes: write immediately via `prisma.dish.update({ where: { id }, data: { nameEs, nameSourceLocale } })`. In dry-run mode, print a table to stdout: `dishId | name | action | nameEs (proposed) | nameSourceLocale`.
6. For LLM dishes: chunk into batches of `opts.batchSize` (default 50). For each batch:
   - Call OpenAI `chat.completions.create` with model `gpt-4o-mini`, the system prompt from spec §4.4, and a user message with the JSON array of names.
   - On success: parse response JSON array, verify length matches, update each dish.
   - On failure (network/parse/length mismatch): log error, record as failed, continue.
   - Retry logic: up to 3 attempts with 2s exponential backoff on 429/5xx responses.
   - Log `[translate-dish-names] Translating batch X/Y (N names)...` per batch.
7. Log `[translate-dish-names] Done: N succeeded, N failed`.
8. Log estimated cost: `[translate-dish-names] Estimated cost: ~$X.XX` (based on token count from OpenAI responses).
9. Return `TranslationSummary`. Exit 0 if no failures, 1 if partial failure, 2 on fatal error.

**OpenAI client:** Use `OpenAI` from `'openai'` package (already a project dependency — used by `embeddingClient.ts` and `level3Lookup.ts`). Initialize with `process.env['OPENAI_API_KEY']`. If key is absent at startup, exit with code 2 and an error message.

**npm scripts:** Add to `packages/api/package.json`:
```json
"translate:dish-names": "tsx src/scripts/translate-dish-names.ts",
"translate:dish-names:dry-run": "tsx src/scripts/translate-dish-names.ts --dry-run"
```

**Write test first (TDD):** `packages/api/src/__tests__/scripts/f038.translateDishNames.unit.test.ts`

Mock both `PrismaClient` and the OpenAI client via `vi.mock`. Test structure follows `batch-ingest.test.ts`.

Key test scenarios:
- `classifyDishName()` — brand detection: `'Whopper'` → `brand_copy`; `'Whopper with Cheese'` → `brand_copy` (substring); `'Grilled Chicken'` → `llm_translate`.
- `classifyDishName()` — Spanish heuristic: `'Ensalada de pollo con queso'` → `es_copy`; `'Pollo sin gluten'` (2 words) → `es_copy`; `'Pollo'` alone (only 1 indicator) → `llm_translate`.
- `classifyDishName()` — short copy: `'XL'` → `short_copy`; `'BLT'` (3 chars) → `short_copy`; `'Club'` (4 chars) → `llm_translate`.
- `classifyDishName()` — mixed-language: `'Chicken / Pollo'` → `mixed_copy`, `nameSourceLocale = 'mixed'`.
- `classifyDishName()` — code/non-alpha: `'1234'` → `code_copy`, `nameSourceLocale = 'unknown'`; `'X-5'` → `code_copy`.
- `classifyDishName()` — LLM path: `'Grilled Chicken Salad'` → `llm_translate`, `nameSourceLocale = 'en'`.
- `runTranslateDishNames()` — dry-run: Prisma `dish.update` is never called; returns correct counts.
- `runTranslateDishNames()` — happy path: mocked Prisma returns 3 dishes (1 brand, 1 es, 1 LLM). Mocked OpenAI returns `['Ensalada de Pollo a la Plancha']`. Verifies Prisma `update` called 3 times with correct data.
- `runTranslateDishNames()` — OpenAI JSON parse failure: entire batch skipped, `failed` count incremented, other batches continue.
- `runTranslateDishNames()` — array length mismatch in OpenAI response: batch skipped (no partial writes).
- `runTranslateDishNames()` — missing `OPENAI_API_KEY`: function exits with code 2 (or throws a fatal error caught by the CLI wrapper).
- `runTranslateDishNames()` — `--force` flag: queries all dishes (not just `name_es IS NULL`).
- `runTranslateDishNames()` — `--chain` filter: Prisma query includes `restaurant.chainSlug` filter.

---

**Step 5 — Ingest Pipeline Fix (Presentation)**

Files: `packages/api/src/routes/ingest/pdf.ts`, `pdf-url.ts`, `image-url.ts`

**For each route:**

1. Import `getChainSourceLocale` from `'../../ingest/chainLocaleRegistry.js'`.
2. In the Step 8 normalization loop (before calling `normalizeNutrients` + `normalizeDish`):
   - Determine `chainSourceLocale` once, outside the loop: `const chainSourceLocale = getChainSourceLocale(chainSlug)` where `chainSlug` is available from the request body (`pdf-url.ts` and `image-url.ts`). For `pdf.ts`, `chainSlug` is not in the body — use `getChainSourceLocale(undefined)` which returns `'unknown'`.
   - For each `raw` in `rawDishes`, before calling `normalizeDish()`:
     - If `chainSourceLocale === 'es'`: set `raw.nameEs = raw.name`.
     - Else if `chainSourceLocale === 'en'`: leave `raw.nameEs` undefined, emit structured log warning: `request.log.warn({ dishName: raw.name }, '[ingest] nameEs not set — run translate-dish-names script')`.
     - Else (`'unknown'`): leave `raw.nameEs` undefined (no warning — caller did not provide chainSlug).
3. In the Prisma `create` data payload: add `nameSourceLocale: chainSourceLocale === 'unknown' ? null : chainSourceLocale`.
4. In the Prisma `update` data payload: same — add `nameSourceLocale: chainSourceLocale === 'unknown' ? null : chainSourceLocale`.
5. Do NOT modify `name`. Do NOT call gpt-4o-mini (ADR-010). Do NOT modify `normalizeDish()` or `parseNutritionTable`.

**Note on `pdf.ts`:** The plain PDF upload route has no `chainSlug` field. The `nameSourceLocale` written will be `null` (unknown). This is acceptable — the batch script will classify and translate these dishes during backfill.

**Write test first (TDD):** `packages/api/src/__tests__/f038.ingest.unit.test.ts`

Mock `CHAIN_SOURCE_LOCALE` / `getChainSourceLocale` and Prisma. Test using the route's `processingPromise` logic extracted, or by mounting the Fastify app with `buildApp()` and injecting requests (following the pattern of `ingest/nutritionTableParser.test.ts` and existing route tests).

Key test scenarios:
- `pdf-url` route with `chainSlug: 'telepizza-es'` (Spanish chain): dish is created with `nameEs = name` and `nameSourceLocale = 'es'`.
- `pdf-url` route with `chainSlug: 'burger-king-es'` (English chain): dish is created with `nameEs = undefined/null` and `nameSourceLocale = 'en'`; a warn log is emitted.
- `pdf-url` route with no `chainSlug`: dish is created with `nameEs = undefined/null` and `nameSourceLocale = null`.
- `image-url` route with `chainSlug: 'dominos-es'` (Spanish chain): same as Spanish chain case.
- `pdf.ts` route (no chainSlug possible): dish is created with `nameSourceLocale = null`.
- On update (dish already exists): `nameSourceLocale` is updated in the `update` payload too.

---

**Step 6 — Wire and Verify**

- Run `prisma generate` to regenerate Prisma client with the new `nameSourceLocale` field. Verify `Prisma.DishCreateInput` now includes `nameSourceLocale?: string | null`.
- Run `npm run build` across `packages/shared` and `packages/api` to catch any TypeScript errors.
- Run all tests: `npm test -w @foodxplorer/api` and `npm test -w @foodxplorer/shared`.

---

**Step 7 — Embedding Regeneration Verification (post-implementation)**

This step is NOT automated code — it is a runbook step executed after the batch translation script has been run against a real database. The existing embedding pipeline handles this; no new code needed.

- Run: `npm run embeddings:generate -w @foodxplorer/api -- --target=dishes --force`
- Verify: `SELECT COUNT(*) FROM dishes WHERE embedding_updated_at IS NULL` = 0
- This satisfies AC-8.

---

### Testing Strategy

**Test files to create:**

| File | Type | Runner |
|------|------|--------|
| `packages/api/src/__tests__/migration.f038.integration.test.ts` | Integration | Vitest (requires test DB) |
| `packages/api/src/__tests__/f038.chainLocaleRegistry.unit.test.ts` | Unit | Vitest |
| `packages/api/src/__tests__/scripts/f038.translateDishNames.unit.test.ts` | Unit | Vitest |
| `packages/api/src/__tests__/f038.ingest.unit.test.ts` | Unit | Vitest |
| `packages/api/src/__tests__/f038.estimate-l1.integration.test.ts` | Integration | Vitest (requires test DB) |

**Migration integration test** (`migration.f038.integration.test.ts`):
- `beforeAll`: connect to `DATABASE_URL_TEST` with `new PrismaClient({ datasources: ... })`.
- `afterAll`: disconnect.
- Test: query `information_schema.columns WHERE table_name = 'dishes' AND column_name = 'name_source_locale'` — expect 1 row, `data_type = 'character varying'`, `is_nullable = 'YES'`.
- Pattern: identical to `migration.f019.integration.test.ts`. No fixture data needed.

**Chain locale registry unit test** (`f038.chainLocaleRegistry.unit.test.ts`):
- Pure unit test, no mocks.
- Verifies `getChainSourceLocale('telepizza-es') === 'es'`, `getChainSourceLocale('burger-king-es') === 'en'`, `getChainSourceLocale('unknown-chain') === 'unknown'`, `getChainSourceLocale(undefined) === 'unknown'`.
- Cross-checks that every `chainSlug` in `CHAIN_PDF_REGISTRY` has an entry in `CHAIN_SOURCE_LOCALE`.

**Translate script unit tests** (`f038.translateDishNames.unit.test.ts`):
- Mock strategy: `vi.mock('openai')` to control `chat.completions.create` return value; mock `PrismaClient` via `vi.fn()` factory injected via `prismaOverride`.
- `classifyDishName` tests are pure (no mocks needed).
- `runTranslateDishNames` tests use mocked Prisma and OpenAI.
- All tests use `vi.clearAllMocks()` in `beforeEach`.

**Ingest unit tests** (`f038.ingest.unit.test.ts`):
- Mock strategy: `vi.mock('../../ingest/chainLocaleRegistry.js')` to control `getChainSourceLocale` return; mock Prisma and PDF/image extraction dependencies.
- Tests focused on the normalization loop behavior (nameEs assignment, nameSourceLocale in Prisma payload).
- Use `buildApp()` + `app.inject()` pattern (no real network calls). Mock `extractText`, `downloadPdf`, `parseNutritionTable` at the module level.

**L1 estimate integration test** (`f038.estimate-l1.integration.test.ts`):
- Verifies AC-9: a Spanish query hits L1 for a dish that has `name_es` populated.
- `beforeAll`: seed a dish with `name = 'Grilled Chicken Salad'`, `nameEs = 'Ensalada de Pollo a la Plancha'` in the test DB.
- Test: call `GET /estimate?query=ensalada+de+pollo` → assert `level1Hit: true` and `matchType` is `fts_dish`.
- `afterAll`: clean up seeded dish.
- Pattern: similar to existing estimate route integration tests.

**Mocking conventions (from existing codebase):**
- Use `vi.mock()` at the top of the file.
- Use `vi.fn()` for Prisma method mocks.
- Clear mocks in `beforeEach` with `vi.clearAllMocks()`.
- Use `expect(...).toHaveBeenCalledWith(...)` to verify Prisma update payloads.

---

### Key Patterns

**Migration numbering:** Last migration is `20260324170000_restaurants_location_f032`. Use timestamp `20260325130000` for F038 (next sequential). Format: `YYYYMMDDHHMMSS_<description>_<feature>`.

**Migration apply workflow (critical):** NEVER use `prisma migrate dev`. Workflow: `prisma migrate dev --create-only` to generate the migration file (or create it manually) → verify SQL → `prisma migrate deploy` to apply.

**Script DI pattern** (from `embeddings-generate.ts`):
```typescript
export async function runTranslateDishNames(
  opts: TranslateDishNamesOptions,
  prismaOverride?: PrismaClient,
): Promise<TranslationSummary> {
  const prismaClient = prismaOverride ?? defaultPrisma;
  // ...
}
const isMain = process.argv[1]?.endsWith('translate-dish-names.ts') ||
               process.argv[1]?.endsWith('translate-dish-names.js');
if (isMain) { void main(); }
```

**Ingest route Prisma create/update payloads:** Both `create` and `update` data objects must include `nameSourceLocale`. The `name` field is NEVER modified in the `update` payload (ADR-001 immutability). The pattern for the update case is that `nameSourceLocale` must be set alongside `nameEs` so that a re-ingested dish correctly updates the locale metadata.

**No `any` in TypeScript:** For the OpenAI response parsing, type the parsed JSON as `unknown` and validate with a type guard. For the Prisma `update` payload, rely on the generated `Prisma.DishUpdateInput` type (which now includes `nameSourceLocale?: string | null` after `prisma generate`).

**OpenAI package:** The `openai` npm package is already installed (used by `embeddingClient.ts` — `import OpenAI from 'openai'`). Do not add it as a new dependency.

**Kysely types refresh:** After running `prisma generate`, the file `packages/api/src/generated/kysely-types.ts` will include `name_source_locale: string | null` on the `Dishes` interface. No manual changes to this file.

**`pdf.ts` lacks `chainSlug` in the body:** This is intentional. The route body is `{ restaurantId, sourceId, dryRun }` only. The plain PDF upload is a generic path — set `nameSourceLocale = null` (unknown). The dev must NOT add `chainSlug` to this route's body schema (that is a separate concern from F038).

**Warning log format in ingest routes:** Use `request.log.warn()` (Fastify's structured Pino logger on the request object), not `console.warn()`. This is consistent with the error handling pattern in the routes.

**Gotcha — `RawDishData` mutation:** `raw` objects returned by `parseNutritionTable` are plain objects (not frozen). Setting `raw.nameEs = raw.name` before calling `normalizeDish(raw, ...)` is safe because `normalizeDish` reads `raw.nameEs` directly and passes it through to `NormalizedDishData.nameEs`. This means the mutation propagates correctly without any changes to `normalizeDish`.

**Gotcha — `NormalizedDishData` lacks `nameSourceLocale`:** `NormalizedDishDataSchema` (in `packages/scraper/src/base/types.ts`) does not and should not have a `nameSourceLocale` field — it is a DB metadata column, not part of the normalized pipeline contract. The `nameSourceLocale` value is set directly on the Prisma `create`/`update` payload *after* `NormalizedDishDataSchema.safeParse()` validates the merged dish. The developer must add `nameSourceLocale` to the payload manually, separate from the `validDishes` array elements.

---

## Acceptance Criteria

- [x] Migration applies cleanly (`prisma migrate deploy` exits 0)
- [x] `name` field unchanged for all dishes (ADR-001 preserved)
- [x] After batch script: 0 dishes with `name_es = NULL`
- [x] After batch script: `name_source_locale` set for all dishes
- [x] Brand names preserved verbatim (`name = name_es` for brands)
- [x] Spanish-language names copied, not translated (`name_source_locale = 'es'` → `name = name_es`)
- [x] Descriptive English names translated to Spanish (manual review of 10 samples)
- [x] Embedding regeneration completes (0 dishes with `embedding_updated_at IS NULL`)
- [x] L1 FTS Spanish query hits for a previously-missed dish (integration test)
- [x] Future PDF ingest for Spanish chains populates `name_es` automatically
- [x] Dry-run mode writes nothing to DB
- [x] Unit tests for batch translation logic (classification + LLM call)
- [x] All tests pass (91 F038 tests, 0 regressions)
- [x] Build succeeds

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing (91 tests across 7 files)
- [x] Code follows project standards (TypeScript strict, no `any`)
- [x] No linting errors
- [x] Build succeeds
- [x] Spec file reflects final implementation

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, spec written to `docs/specs/f038-multilingual-dish-names-spec.md`
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` executed, plan approved
- [x] Step 3: `backend-developer` executed with TDD
- [x] Step 4: `production-code-validator` executed, quality gates pass
- [x] Step 5: `code-review-specialist` executed
- [x] Step 5: `qa-engineer` executed (Standard)
- [x] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-25 | Spec created | Spec approved (Opción A — no LLM at ingest time for English chains). Full spec at docs/specs/f038-multilingual-dish-names-spec.md |
| 2026-03-25 | Setup complete | Branch feature/F038-multilingual-dish-names, ticket created |
| 2026-03-25 | Plan reviewed by Codex GPT-5.4 | VERDICT: REVISE. 4 IMPORTANT + 2 SUGGESTION. All 6 addressed: (1) added mixed/code classification steps, (2) added Step 7 embedding regeneration, (3) added L1 integration test for AC-9, (4) removed --concurrency flag (YAGNI), (5) fixed Prisma import pattern, (6) detailed dry-run stdout format. Gemini unavailable (config error). |
| 2026-03-25 | Implementation complete | 7 steps implemented with TDD. 55 initial tests. Commit cf7a4b3 |
| 2026-03-25 | Code review fixes | Fixed retry logic (regex), SDK types for OpenAI, Zod enum, removed ambiguous Spanish indicators, deferred API key check. Commit 84a3717 |
| 2026-03-25 | QA verified | 91 total tests (55 original + 36 QA edge-case). All ACs verified. 0 regressions. Commit 9b9e803 |
| 2026-03-25 | PR created | PR #30 → develop. Squash merge strategy |
| 2026-03-25 | Merged & completed | Squash merged to develop. Branch deleted. 91 tests, 21 files changed, +3631 lines |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Implementation Plan, AC, DoD, Workflow Checklist, Completion Log, Merge Checklist Evidence |
| 1. Mark all items | [x] | AC: 14/14, DoD: 6/6, Workflow: 7/8 (Step 6 pending) |
| 2. Verify product tracker | [x] | Active Session: step 5/6 (Review), Features table: 5/6, in-progress |
| 3. Update key_facts.md | [x] | Added: translate-dish-names script, chain locale registry |
| 4. Update decisions.md | [x] | ADR-010 already added in previous session (commit 089d907) |
| 5. Commit documentation | [x] | Commit: 9f3e682 |
| 6. Verify clean working tree | [x] | `git status`: clean after docs commit |

---

*Ticket created: 2026-03-25*
