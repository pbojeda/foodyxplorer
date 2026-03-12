# F007b: PDF Ingestion Endpoint (POST /ingest/pdf)

**Feature:** F007b | **Type:** Backend-Feature | **Priority:** High
**Status:** Done | **Branch:** feature/F007b-pdf-ingestion (deleted)
**Created:** 2026-03-12 | **Dependencies:** F007 complete (scraper scaffold, normalizeNutrients + normalizeDish)

---

## Spec

### Description

F007b adds `POST /ingest/pdf` to `packages/api`. The endpoint accepts a multipart PDF upload containing nutritional data, extracts text from the PDF, parses nutritional tables using a heuristic/regex parser (Spanish + English keyword detection), normalizes the result through the shared `normalizeNutrients` / `normalizeDish` pipeline from `packages/scraper`, and persists the resulting dishes via Prisma upsert.

The endpoint is designed for:
- Spanish restaurant chain nutritional PDFs (tabular dish data)
- Nutrition guides (e.g. FEN alimentación española guide)

Parsing is deterministic and heuristic-based — no LLM is used (cost constraint: <0.05€/query, ADR-001 prohibits LLM for data extraction). Image-based (scanned) PDFs are not supported in Phase 1.

Full specification: `docs/specs/F007b-pdf-ingestion-spec.md`

---

### Architecture Decisions

**`pdf-parse` for text extraction (not pdfjs-dist)**

Pure Node.js library, no native binaries, small footprint. `pdfjs-dist` would be authoritative but requires a worker setup inappropriate for a server-side handler. `pdf-parse` is added to `packages/api` only — not to `packages/scraper`.

**No LLM parsing**

The Phase 1 cost target (<0.05€/query) makes LLM-based table parsing prohibitive for PDFs that may contain hundreds of dishes per upload. A regex/heuristic parser is deterministic, auditable, and aligns with ADR-001 ("the LLM NEVER calculates nutritional values"). Heuristic parsing is the correct layer for structured table extraction.

**`RawDishDataSchema` / `NormalizedDishDataSchema` stay in `packages/scraper`**

These schemas are scraper pipeline internals. `packages/api` imports them (and the normalization functions) from `@foodxplorer/scraper`, establishing an explicit `api → scraper → shared` dependency edge. Moving them to `packages/shared` would expose them to `packages/bot` unnecessarily and would not reduce coupling.

**Synchronous processing for Phase 1**

Restaurant chain PDFs contain at most a few hundred dishes. Processing time is expected to be well under the 30-second hard timeout. Background job processing is deferred to Phase 2.

**Direct Prisma upsert (same as chain scrapers)**

Consistent with F007 §6 Option A. No internal HTTP hop.

---

### File Structure

New files:

```
packages/api/src/
├── routes/ingest/
│   └── pdf.ts                          # POST /ingest/pdf route plugin
├── lib/
│   └── pdfParser.ts                    # pdf-parse wrapper: extractText(buffer) → string[]
└── ingest/
    └── nutritionTableParser.ts         # Heuristic parser: parseNutritionTable(lines) → RawDishData[]

packages/api/src/__tests__/
├── routes/ingest/
│   └── pdf.test.ts                     # Integration tests (buildApp + inject)
└── ingest/
    └── nutritionTableParser.test.ts    # Unit tests for the heuristic parser

packages/api/src/__tests__/fixtures/pdf/
├── sample-nutrition-table.txt          # 10-dish synthetic nutritional table
├── multi-section-table.txt             # Two distinct table sections
├── empty.txt                           # Empty string (simulates image PDF)
└── no-nutrients.txt                    # Text with no nutritional table
```

Modified files:

| File | Change |
|---|---|
| `packages/api/src/app.ts` | Register `@fastify/multipart` (before route plugins) and `ingestPdfRoutes` |
| `packages/api/package.json` | Add `pdf-parse`, `@types/pdf-parse`, `@fastify/multipart`, `@foodxplorer/scraper` |
| `docs/specs/api-spec.yaml` | `POST /ingest/pdf` endpoint + `IngestPdfResult`, `IngestPdfResponse`, `NormalizedDish`, `IngestPdfSkippedReason` schemas added |

---

### API Endpoints

#### `POST /ingest/pdf`

**Request:** `multipart/form-data`

| Field | Type | Required | Constraints |
|---|---|---|---|
| `file` | binary | Yes | MIME `application/pdf` or magic bytes `%PDF-`. Max 10 MB. |
| `restaurantId` | string (UUID) | Yes | Must exist in `restaurants` table |
| `sourceId` | string (UUID) | Yes | Must exist in `data_sources` table |
| `dryRun` | string (`"true"`/`"false"`) | No | Default `"false"` |

**Zod schemas (API-internal, not in packages/shared):**

```
IngestPdfBodySchema = z.object({
  restaurantId : z.string().uuid(),
  sourceId     : z.string().uuid(),
  dryRun       : z.string().transform(v => v === 'true').default('false'),
})

IngestPdfSkippedReasonSchema = z.object({
  dishName : z.string(),
  reason   : z.string(),
})

IngestPdfResultSchema = z.object({
  dishesFound    : z.number().int().nonnegative(),
  dishesUpserted : z.number().int().nonnegative(),
  dishesSkipped  : z.number().int().nonnegative(),
  dryRun         : z.boolean(),
  dishes         : z.array(NormalizedDishDataSchema),   // from @foodxplorer/scraper
  skippedReasons : z.array(IngestPdfSkippedReasonSchema),
})
```

**Response codes:**

| Code | Condition |
|---|---|
| 200 | At least one dish parsed and upserted (or dryRun completed). Partial success (some skipped) is also 200. |
| 400 `VALIDATION_ERROR` | Missing fields, invalid UUID format, no file part, file > 10 MB (413) |
| 404 `NOT_FOUND` | `restaurantId` or `sourceId` not in DB |
| 408 `PROCESSING_TIMEOUT` | Processing exceeded 30 seconds |
| 422 `INVALID_PDF` | File is not a PDF (magic bytes or MIME check fails) |
| 422 `UNSUPPORTED_PDF` | PDF is image-based (no extractable text) |
| 422 `NO_NUTRITIONAL_DATA_FOUND` | No parseable nutritional table, or all parsed rows failed normalization |
| 500 `DB_UNAVAILABLE` | DB write failure |

---

### Swagger / OpenAPI

Full definition added to `docs/specs/api-spec.yaml` under the existing `Ingestion` tag. New component schemas: `IngestPdfResponse`, `IngestPdfResult`, `NormalizedDish`, `IngestPdfSkippedReason`.

---

### Heuristic Parser Contract

`parseNutritionTable(lines: string[]): RawDishData[]`

- Detects header lines by finding 3+ nutrient keywords (Spanish + English variants) in a single line.
- Maps column positions from the header keyword order.
- Parses subsequent lines as data rows: dish name = text before the first numeric token; nutrients = numeric tokens mapped to column positions.
- Handles comma decimal separators (`"1,5"` → `1.5`).
- Supports multiple table sections in one document (resets column state on each new header).
- Returns only rows with name length ≥ 2 characters and at least 4 numeric tokens.

---

### Normalization (reused from F007, no changes)

| Rule | Detail |
|---|---|
| `confidenceLevel` | Always `'medium'` |
| `estimationMethod` | Always `'scraped'` |
| `referenceBasis` | Always `'per_serving'` (ADR-004) |
| `sourceUrl` (RawDishData) | Synthetic URI: `'pdf://[sanitizedFilename]'` — satisfies `.url()` constraint |
| `scrapedAt` (RawDishData) | `new Date().toISOString()` at request time |
| Required nutrients | `calories`, `proteins`, `carbohydrates`, `fats` — absent → dish skipped |
| Salt/sodium derivation | `salt_g = sodium_mg / 1000 * 2.5` and vice versa |

---

### New Dependencies

| Package | Package location | Type | Reason |
|---|---|---|---|
| `pdf-parse` | `packages/api` | runtime | PDF text extraction |
| `@types/pdf-parse` | `packages/api` | devDep | TypeScript types |
| `@fastify/multipart` | `packages/api` | runtime | Multipart file upload handling |
| `@foodxplorer/scraper` | `packages/api` | runtime | `normalizeNutrients`, `normalizeDish`, `RawDishData`, `NormalizedDishData` |

---

### Edge Cases

| Scenario | Expected behaviour |
|---|---|
| PDF has text but no nutrition table | `422 NO_NUTRITIONAL_DATA_FOUND` |
| All parsed rows fail normalization | `422 NO_NUTRITIONAL_DATA_FOUND` |
| Multiple tables in one document | All sections parsed; all dishes returned |
| Nutrient value `"< 1"` with space | Normalized to `0.5` by `normalizeNutrients` |
| Nutrient value `"1,5"` (Spanish decimal) | Parser normalizes comma → dot before passing to `normalizeNutrients` |
| Same dish name twice in PDF | Last-write-wins on `(restaurantId, name)` upsert — accepted for Phase 1 |
| `dryRun: true` with non-existent `restaurantId` | Still returns `404 NOT_FOUND` — DB check runs regardless of dryRun |
| File MIME is `application/octet-stream` but magic bytes are `%PDF-` | Accepted — magic byte check takes precedence |
| Multiple `file` parts in multipart | First part only is processed |

---

### Acceptance Criteria

- [ ] `POST /ingest/pdf` with a Spanish nutritional table PDF returns `200` with ≥ 1 dish upserted
- [ ] `dryRun: true` returns `200` with `dishesUpserted: 0` and no DB rows written
- [ ] Non-PDF file returns `422 INVALID_PDF`
- [ ] Image-based PDF returns `422 UNSUPPORTED_PDF`
- [ ] PDF with no nutritional table returns `422 NO_NUTRITIONAL_DATA_FOUND`
- [ ] Missing `restaurantId` returns `400 VALIDATION_ERROR`
- [ ] Non-existent `restaurantId` (valid UUID, no row) returns `404 NOT_FOUND`
- [ ] File > 10 MB returns `413`
- [ ] Partial success (some skipped): `200` with `dishesSkipped > 0` and populated `skippedReasons`
- [ ] `tsc --noEmit` passes across all packages with zero errors
- [ ] `vitest run` all tests green
- [ ] Endpoint fully documented in `docs/specs/api-spec.yaml` under `Ingestion` tag
- [ ] No `any` types, no `ts-ignore`
- [ ] `nutritionTableParser` handles Spanish + English keyword variants (unit tests)
- [ ] Salt/sodium derivation tested via integration test through the full PDF pipeline

---

## Implementation Plan

### Existing Code to Reuse

| Asset | Location | Used for |
|---|---|---|
| `normalizeNutrients` | `packages/scraper/src/utils/normalize.ts` | Normalize raw nutrient values from PDF rows |
| `normalizeDish` | `packages/scraper/src/utils/normalize.ts` | Normalize dish identity/metadata fields |
| `RawDishData` / `RawDishDataSchema` | `packages/scraper/src/base/types.ts` | Type for parser output; validated before normalization |
| `NormalizedDishData` / `NormalizedDishDataSchema` | `packages/scraper/src/base/types.ts` | Type for normalized output; used in response schema |
| `buildApp` | `packages/api/src/app.ts` | Used in integration tests via `.inject()` |
| `registerErrorHandler` / `mapError` | `packages/api/src/errors/errorHandler.ts` | Global error handling; new error codes extend the `throw Object.assign(new Error(...), { statusCode, code })` pattern already used in `health.ts` |
| `prisma` singleton | `packages/api/src/lib/prisma.ts` | Default Prisma client; auto-selects `DATABASE_URL_TEST` in test env |
| `fastifyPlugin` | `fastify-plugin` (already in deps) | Wraps the route plugin, same pattern as `healthRoutes` |
| `fastify-type-provider-zod` | already in deps | Zod schema → Fastify type inference on routes |

---

### Files to Create

#### Production code

| File | Purpose |
|---|---|
| `packages/api/src/lib/pdfParser.ts` | Thin wrapper around `pdf-parse`. Exports `extractText(buffer: Buffer): Promise<string[]>` returning one string per page. Detects empty-text result and throws a typed error. |
| `packages/api/src/ingest/nutritionTableParser.ts` | Heuristic parser. Exports `parseNutritionTable(lines: string[], sourceUrl: string, scrapedAt: string): RawDishData[]`. Contains the keyword map, header detection, column mapping, and data-row parsing logic. |
| `packages/api/src/routes/ingest/pdf.ts` | Fastify route plugin. Exports `ingestPdfRoutes`. Registers `POST /ingest/pdf`. Contains `IngestPdfBodySchema`, `IngestPdfSkippedReasonSchema`, `IngestPdfResultSchema`. Owns the full processing pipeline: multipart parsing → file validation → `extractText` → `parseNutritionTable` → `normalizeNutrients` + `normalizeDish` + `NormalizedDishDataSchema.safeParse` → Prisma upsert → response. |

#### Test fixtures

| File | Purpose |
|---|---|
| `packages/api/src/__tests__/fixtures/pdf/sample-nutrition-table.txt` | Synthetic Spanish nutritional table text: 10 dishes, Spanish column headers (`Calorías`, `Proteínas`, `Hidratos`, `Grasas`, `Sal`), comma decimal separators. Minimum required columns for happy-path unit tests. |
| `packages/api/src/__tests__/fixtures/pdf/multi-section-table.txt` | Two separate nutritional table blocks (e.g. "Entrantes" and "Principales") each preceded by a valid header line. Tests that the parser resets column state between sections and returns dishes from both. |
| `packages/api/src/__tests__/fixtures/pdf/english-keywords-table.txt` | Single table with English column headers (`Calories`, `Proteins`, `Carbohydrates`, `Fat`, `Salt`). Tests English keyword branch in unit tests. |
| `packages/api/src/__tests__/fixtures/pdf/empty.txt` | Empty file (zero bytes / empty string). Simulates image-based PDF that yields no text. |
| `packages/api/src/__tests__/fixtures/pdf/no-nutrients.txt` | Narrative text with no nutritional table (e.g. a cover page paragraph). Contains at most one nutrient keyword per line — never 3+. |

#### Test files

| File | Purpose |
|---|---|
| `packages/api/src/__tests__/ingest/nutritionTableParser.test.ts` | Pure unit tests for `parseNutritionTable`. No mocks needed — inputs are strings from `.txt` fixtures or inline strings. |
| `packages/api/src/__tests__/routes/ingest/pdf.test.ts` | Integration tests using `buildApp()` + `.inject()`. Mocks `pdfParser.extractText` via `vi.mock` to control text input. Uses real test DB for DB-existence checks and upsert verification. |

---

### Files to Modify

| File | Change |
|---|---|
| `packages/api/package.json` | Add runtime deps: `pdf-parse`, `@fastify/multipart`, `@foodxplorer/scraper`. Add devDep: `@types/pdf-parse`. |
| `packages/api/tsconfig.json` | Add path alias `"@foodxplorer/scraper": ["../scraper/src"]` and `"@foodxplorer/scraper/*": ["../scraper/src/*"]` to `compilerOptions.paths`. Add `{ "path": "../scraper" }` to `references`. |
| `packages/api/src/app.ts` | Register `@fastify/multipart` (before route plugins, with `limits: { fileSize: 10 * 1024 * 1024 }`). Register `ingestPdfRoutes` with `{ prisma: prismaClient }`. |
| `packages/api/src/errors/errorHandler.ts` | Add `mapError` branches for the four new codes: `INVALID_PDF` (422), `UNSUPPORTED_PDF` (422), `NO_NUTRITIONAL_DATA_FOUND` (422), `PROCESSING_TIMEOUT` (408). These follow the same `Object.assign(new Error(...), { statusCode, code })` throw pattern as `DB_UNAVAILABLE`. |
| `docs/specs/api-spec.yaml` | Already updated by `spec-creator` in Step 0. No changes required unless developer finds gaps during implementation. |

---

### Implementation Order

Follow DDD layer discipline: shared types → pure logic → infrastructure wrapper → presentation → tests (written first per TDD).

**I-1 — Install dependencies**

Files: `packages/api/package.json`, `packages/api/tsconfig.json`

- Install `pdf-parse`, `@types/pdf-parse`, `@fastify/multipart`, `@foodxplorer/scraper` in `packages/api`.
- Add the `@foodxplorer/scraper` TypeScript path alias and project reference in `packages/api/tsconfig.json` (mirror the existing `@foodxplorer/shared` pattern: `"../scraper/src"` + `references` entry).
- Verify: `tsc --noEmit -p packages/api/tsconfig.json` passes after adding the alias (no new code yet, just config).

**I-2 — Write test fixtures**

Files: `packages/api/src/__tests__/fixtures/pdf/*.txt`

Create all five `.txt` fixture files (see "Files to Create" above). These are plain text — no PDF parsing involved. The content must be realistic enough that `parseNutritionTable` can detect headers in the relevant files and return zero results from `empty.txt` and `no-nutrients.txt`.

Guidelines for fixture content:
- `sample-nutrition-table.txt`: one header line with at least 5 Spanish nutrient keywords, followed by 10 data rows. Each data row: dish name (2+ chars, no leading numerics), then 5+ numeric tokens including commas as decimal separators for at least some values.
- `multi-section-table.txt`: two header lines separated by 3–4 non-numeric non-header lines, each followed by 4–5 data rows.
- `english-keywords-table.txt`: one header line using English variants (`Calories`, `Proteins`, `Carbohydrates`, `Fat`, `Salt`), followed by 5 data rows.
- `empty.txt`: literally empty.
- `no-nutrients.txt`: 5–10 lines of paragraph text; must NOT contain 3 or more nutrient keywords on any single line.

**I-3 — Write failing unit tests for `nutritionTableParser`**

File: `packages/api/src/__tests__/ingest/nutritionTableParser.test.ts`

Write all tests BEFORE implementing the parser. Tests import `parseNutritionTable` from `../../ingest/nutritionTableParser.js` (will fail to import — file does not exist yet). Test scenarios:

- Header detection with Spanish keywords (reads `sample-nutrition-table.txt`): `parseNutritionTable(lines)` returns an array of length 10, each item has `name`, `nutrients.calories`, `nutrients.proteins`, `nutrients.carbohydrates`, `nutrients.fats`.
- Header detection with English keywords (reads `english-keywords-table.txt`): returns 5 items.
- Multi-section document (reads `multi-section-table.txt`): returns 8–9 items (combined from both sections). Verifies that dishes from section 2 are present.
- Empty input (reads `empty.txt`): returns `[]`.
- No-nutrient text (reads `no-nutrients.txt`): returns `[]`.
- Comma decimal separator: inline string with `"1,5"` in a numeric token is parsed as `1.5`. Verify `nutrients.fats` (or any mapped column) equals `1.5` as a number.
- Dish name with diacritics: inline fixture with dish name `"Pollo a la española"` is preserved as-is in the result.
- Too-short dish name (1 character): row is skipped; result array does not contain it.
- Row with fewer than 4 numeric tokens: row is skipped.
- `sourceUrl` and `scrapedAt` parameters are passed through to each result item.
- `aliases` is `[]` on every result item.
- `externalId` is `undefined` on every result item.

**I-4 — Implement `nutritionTableParser.ts`**

File: `packages/api/src/ingest/nutritionTableParser.ts`

Implement to make I-3 tests pass. Structure:

1. Define the keyword-to-field map as a `const` record (type: `Record<string, keyof RawDishData['nutrients']>`). Include all Spanish and English variants from spec §9.2. Compile keywords once to a single regex per keyword for case-insensitive matching.

2. `detectHeaderColumns(line: string): Array<keyof RawDishData['nutrients']> | null`
   - Lowercase the line.
   - Count distinct nutrient keywords found in the line (use `Array.from(new Set(...))` to deduplicate).
   - If count < 3: return `null`.
   - Build column array by scanning keywords left-to-right by their index position in the line. Return ordered array of field names.

3. `parseDataRow(line: string, columns: Array<keyof RawDishData['nutrients']>): { name: string; nutrients: RawDishData['nutrients'] } | null`
   - Find all numeric tokens via `/\d+(?:[.,]\d+)?/g`.
   - Normalize commas: replace `,` with `.` in each matched token before `parseFloat`.
   - If fewer than 4 numeric tokens: return `null`.
   - Dish name: substring before the first numeric token's match index, trimmed and space-collapsed. If length < 2: return `null`.
   - Map tokens to columns by position index. Extra tokens beyond column count are ignored. Missing tokens (fewer tokens than columns) leave those nutrient fields undefined.
   - Return `{ name, nutrients }`.

4. `parseNutritionTable(lines: string[], sourceUrl: string, scrapedAt: string): RawDishData[]`
   - Iterate lines. Maintain `currentColumns: Array<keyof RawDishData['nutrients']> | null = null`.
   - For each line: try `detectHeaderColumns(line)`. If non-null: set `currentColumns`, skip to next line.
   - If `currentColumns` is set: try `parseDataRow(line, currentColumns)`. If non-null: push `RawDishData` entry (with `name`, `nutrients`, `sourceUrl`, `scrapedAt`, `aliases: []`, `externalId: undefined`, `category: undefined`). If null and line is non-empty and `detectHeaderColumns(line)` also returned null: skip silently.
   - Reset `currentColumns = null` when `detectHeaderColumns` returns non-null on a new header line (this handles multi-section naturally — the new header overwrites the previous column mapping).

**I-5 — Write failing unit test for `pdfParser.ts`**

File: `packages/api/src/__tests__/ingest/nutritionTableParser.test.ts` (separate `describe` block, or a new file `packages/api/src/__tests__/lib/pdfParser.test.ts`)

Prefer a separate file `pdfParser.test.ts`. Tests:
- `extractText` with a minimal valid PDF buffer returns a `string[]` with at least one entry containing some text. Create the minimal PDF buffer inline in the test using the literal PDF string `%PDF-1.4\n%%EOF` (not a fixture file, just a `Buffer.from('...')`). This tests only that `pdf-parse` is wired correctly and returns an array.
- `extractText` with an empty `Buffer` throws an error (the wrapper propagates or wraps the pdf-parse failure).

Note: Do NOT test actual PDF content extraction heavily in unit tests — the route integration tests cover the full pipeline behavior.

**I-6 — Implement `pdfParser.ts`**

File: `packages/api/src/lib/pdfParser.ts`

```
import pdfParse from 'pdf-parse';

export async function extractText(buffer: Buffer): Promise<string[]>
```

- Call `pdfParse(buffer)`. `pdf-parse` returns `{ text: string, numpages: number, ... }`.
- Split `result.text` by form-feed character `\f` (pdf-parse uses `\f` to separate pages). Filter empty strings.
- If result array is empty (all pages produced empty text), throw `Object.assign(new Error('PDF contains no extractable text'), { statusCode: 422, code: 'UNSUPPORTED_PDF' })`.
- Return the string array. The route handler will join pages and split into lines before calling `parseNutritionTable`.

**I-7 — Register `@fastify/multipart` and update error handler**

Files: `packages/api/src/app.ts`, `packages/api/src/errors/errorHandler.ts`

In `app.ts`:
- Import `fastifyMultipart` from `@fastify/multipart`.
- `await app.register(fastifyMultipart, { limits: { fileSize: 10 * 1024 * 1024 } })` — register BEFORE route plugins, after `registerCors` and before `registerRateLimit` (or after rateLimit but before routes; exact position: before `healthRoutes`).
- Import `ingestPdfRoutes` from `./routes/ingest/pdf.js`.
- `await app.register(ingestPdfRoutes, { prisma: prismaClient })` — after `healthRoutes`.

In `errorHandler.ts`, add four new `mapError` branches following the existing `DB_UNAVAILABLE` pattern:
- `code === 'INVALID_PDF'` → `{ statusCode: 422, body: { success: false, error: { message, code: 'INVALID_PDF' } } }`
- `code === 'UNSUPPORTED_PDF'` → `{ statusCode: 422, ... }`
- `code === 'NO_NUTRITIONAL_DATA_FOUND'` → `{ statusCode: 422, ... }`
- `code === 'PROCESSING_TIMEOUT'` → `{ statusCode: 408, ... }`

Add unit tests for these four new branches to `packages/api/src/__tests__/errorHandler.test.ts` (extend the existing `describe('mapError')` block with four new `it()` calls) BEFORE modifying `errorHandler.ts`.

**I-8 — Write failing integration tests for `POST /ingest/pdf`**

File: `packages/api/src/__tests__/routes/ingest/pdf.test.ts`

Write tests BEFORE implementing the route. Mock `pdfParser.extractText` at the module level:
```typescript
vi.mock('../../lib/pdfParser.js', () => ({
  extractText: vi.fn(),
}));
import { extractText } from '../../lib/pdfParser.js';
const mockExtractText = extractText as ReturnType<typeof vi.fn>;
```

`beforeAll`: create a Restaurant row and a DataSource row in the test DB using the real `prisma` client. Use deterministic UUIDs in the `e000` and `f000` namespaces (outside existing seed namespaces). Clean up in `afterAll` in reverse FK order (delete DishNutrient, Dish, then Restaurant/DataSource).

`afterEach`: call `mockExtractText.mockReset()`.

Test scenarios (each as a separate `it()`):

1. **Happy path — Spanish table, live run (200)**: `mockExtractText` returns the lines from `sample-nutrition-table.txt` split into pages array. POST valid multipart with `restaurantId`, `sourceId`. Assert `statusCode === 200`, `body.success === true`, `body.data.dishesFound >= 1`, `body.data.dishesUpserted >= 1`, `body.data.dryRun === false`. Verify at least one `Dish` row exists in DB with the correct `restaurantId`.

2. **dryRun: true — no DB writes (200)**: Same as above but `dryRun: 'true'`. Assert `body.data.dishesUpserted === 0`, `body.data.dryRun === true`. Verify no `Dish` row in DB for the given `restaurantId` and `name`.

3. **Missing `file` part → 400 VALIDATION_ERROR**: Send multipart without a `file` field. Assert `statusCode === 400`, `body.error.code === 'VALIDATION_ERROR'`.

4. **Missing `restaurantId` → 400 VALIDATION_ERROR**: Send multipart with file but no `restaurantId` field. Assert `statusCode === 400`.

5. **Invalid UUID for `restaurantId` → 400 VALIDATION_ERROR**: Send `restaurantId: 'not-a-uuid'`. Assert `statusCode === 400`.

6. **Non-existent `restaurantId` (valid UUID, no DB row) → 404 NOT_FOUND**: Use a random UUID not in the DB. Assert `statusCode === 404`, `body.error.code === 'NOT_FOUND'`.

7. **Non-existent `sourceId` → 404 NOT_FOUND**: Valid restaurantId but non-existent sourceId. Assert `statusCode === 404`, `code === 'NOT_FOUND'`.

8. **File is not PDF (magic bytes check fails) → 422 INVALID_PDF**: Send a file buffer starting with `PNG\r\n` (PNG magic) rather than `%PDF-`. Assert `statusCode === 422`, `body.error.code === 'INVALID_PDF'`. `mockExtractText` should NOT be called.

9. **Image-based PDF (no extractable text) → 422 UNSUPPORTED_PDF**: `mockExtractText` throws `Object.assign(new Error('...'), { statusCode: 422, code: 'UNSUPPORTED_PDF' })`. Assert response is `422 UNSUPPORTED_PDF`.

10. **PDF with no nutritional table → 422 NO_NUTRITIONAL_DATA_FOUND**: `mockExtractText` returns lines from `no-nutrients.txt`. Assert `statusCode === 422`, `body.error.code === 'NO_NUTRITIONAL_DATA_FOUND'`.

11. **All dishes fail normalization → 422 NO_NUTRITIONAL_DATA_FOUND**: `mockExtractText` returns lines that parse into rows with only 2 numeric tokens each (parser returns empty array — or mock `parseNutritionTable` to return dishes with missing required nutrients). Assert `statusCode === 422`, `code === 'NO_NUTRITIONAL_DATA_FOUND'`.

12. **Partial success — some dishes skipped (200)**: `mockExtractText` returns a mix of valid rows and rows with a name that produces missing required nutrients after normalization. Assert `statusCode === 200`, `body.data.dishesSkipped > 0`, `body.data.skippedReasons` is a non-empty array, each entry has `dishName` and `reason` fields.

13. **Salt/sodium derivation exercised**: `mockExtractText` returns a fixture with only `sal` (salt) column, no `sodio`. Assert that at least one dish in `body.data.dishes` has `nutrients.sodium > 0` (derived from salt).

14. **File MIME is `application/octet-stream` but magic bytes are `%PDF-` → accepted**: Send file with content-type `application/octet-stream` but buffer starting with `%PDF-`. `mockExtractText` returns valid lines. Assert `statusCode === 200`.

15. **`dryRun: true` with non-existent `restaurantId` → 404**: Even with `dryRun: 'true'`, the DB existence check must run. Assert `statusCode === 404`.

**I-9 — Implement `routes/ingest/pdf.ts`**

File: `packages/api/src/routes/ingest/pdf.ts`

Implement to make I-8 tests pass. Structure:

```typescript
interface IngestPdfPluginOptions {
  prisma: PrismaClient;
}

const ingestPdfRoutesPlugin: FastifyPluginAsync<IngestPdfPluginOptions> = async (app, opts) => {
  app.post('/ingest/pdf', { schema: { ... } }, handler);
};

export const ingestPdfRoutes = fastifyPlugin(ingestPdfRoutesPlugin);
```

Handler implementation sequence:

1. **Parse multipart stream**: Iterate `request.parts()`. Collect text fields (`restaurantId`, `sourceId`, `dryRun`) into a plain object. Collect the first `file` part into a `Buffer` (using `part.toBuffer()`). If no `file` part was found after exhausting the stream, throw `VALIDATION_ERROR`.

2. **Validate non-file fields**: Run `IngestPdfBodySchema.safeParse(fields)`. If `.success === false`, throw a `ZodError` (re-throw `result.error`) so the existing error handler maps it to `400 VALIDATION_ERROR`.

3. **Validate file**: Check buffer starts with `%PDF-` (use `buffer.slice(0, 5).toString('ascii') === '%PDF-'`). If not, throw `Object.assign(new Error('File is not a valid PDF'), { statusCode: 422, code: 'INVALID_PDF' })`.

4. **DB existence checks** (run regardless of `dryRun`):
   - `prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { id: true } })`. If null: throw `Object.assign(new Error('Restaurant not found'), { statusCode: 404, code: 'NOT_FOUND' })`.
   - `prisma.dataSource.findUnique({ where: { id: sourceId }, select: { id: true } })`. If null: throw `NOT_FOUND` with code `NOT_FOUND`.

5. **Sanitize filename**: Derive `sanitizedFilename` from the file part's `filename` field. Strip any directory path (`path.basename`), replace non-alphanumeric characters (except `.`, `-`, `_`) with `_`. Fallback to `'upload'` if empty. Construct `sourceUrl = 'pdf://' + sanitizedFilename`.

6. **Extract text**: `const pages = await extractText(buffer)` — may throw `UNSUPPORTED_PDF`. Set `scrapedAt = new Date().toISOString()`.

7. **Parse nutrition table**: Concatenate pages with `\n` and split into lines. Call `parseNutritionTable(lines, sourceUrl, scrapedAt)`. If result is empty array: throw `Object.assign(new Error('No nutritional data found in PDF'), { statusCode: 422, code: 'NO_NUTRITIONAL_DATA_FOUND' })`.

8. **Normalize dishes**: For each `RawDishData` in the parsed array:
   - Call `normalizeNutrients(raw.nutrients)`. If null: push to `skippedReasons` with the dish name and reason `'Missing required nutrient fields or calorie limit exceeded'`. Continue.
   - Call `normalizeDish(raw, { sourceId, restaurantId })`.
   - Merge: `{ ...dishMeta, nutrients: normalizedNutrients }`.
   - Run `NormalizedDishDataSchema.safeParse(merged)`. If `.success === false`: push to `skippedReasons` with reason from first Zod issue. Continue.
   - Push to `validDishes`.
   - If `validDishes` is empty (all skipped): throw `NO_NUTRITIONAL_DATA_FOUND`.

9. **Persist** (only if `dryRun === false`): For each `NormalizedDishData` in `validDishes`:
   - `prisma.dish.upsert`: `where` key is `{ restaurantId_name: { restaurantId, name } }` (using the unique index). `create` sets all dish fields. `update` sets mutable fields (nutrients are on `dishNutrient`, not dish itself). Increment `dishesUpserted`.
   - `prisma.dishNutrient.upsert` on `{ dishId }` — create or update nutrient row.
   - Wrap in a try/catch; on Prisma error throw `Object.assign(new Error('Database write failed'), { statusCode: 500, code: 'DB_UNAVAILABLE' })`.

10. **Return response**:
    ```json
    {
      "success": true,
      "data": {
        "dishesFound": rawDishes.length,
        "dishesUpserted": dishesUpserted,
        "dishesSkipped": skippedReasons.length,
        "dryRun": dryRun,
        "dishes": validDishes,
        "skippedReasons": skippedReasons
      }
    }
    ```

**Important constraints for the route implementation:**

- The Fastify schema object on the route is for OpenAPI documentation only. Because multipart bodies cannot be validated by Fastify's standard JSON Schema, do NOT put `body` in the Fastify schema. Validation of text fields is done manually via `IngestPdfBodySchema.safeParse()` inside the handler.
- The 30-second timeout guard: wrap the entire processing pipeline (steps 6–9) in a `Promise.race` against a 30-second timeout promise. If the timeout wins, throw `Object.assign(new Error('Processing timeout'), { statusCode: 408, code: 'PROCESSING_TIMEOUT' })`.
- No `any` types. The multipart `part` is typed via `@fastify/multipart` types. Use type guards when accessing part fields.
- Import `extractText` from `../../lib/pdfParser.js` (not from the module directly, to enable `vi.mock` in tests).
- Import `parseNutritionTable` from `../../ingest/nutritionTableParser.js`.

**I-10 — Run full test suite and type-check**

- `npm run typecheck -w @foodxplorer/api` — must pass with zero errors.
- `npm run test -w @foodxplorer/api` — all tests green.
- Manual smoke test (optional): POST a real PDF to `http://localhost:3001/ingest/pdf` with valid `restaurantId` and `sourceId` from the seed.

---

### Testing Strategy

#### Unit tests — `nutritionTableParser.test.ts`

- **No mocks needed** — `parseNutritionTable` is a pure synchronous function.
- **Fixture loading**: use `fs.readFileSync` to load `.txt` files, split by `\n`, pass lines array to the function.
- **Coverage target**: all branches of header detection (Spanish, English, fewer than 3 keywords → null), all branches of data-row parsing (valid row, too few tokens, too-short name, comma decimal), multi-section reset, empty input, no-nutrient input.

#### Unit tests — `pdfParser.test.ts`

- **No mocks** — tests wire through the real `pdf-parse` library against a minimal in-memory PDF buffer.
- Keep tests minimal: one success case (valid buffer → string array), one failure case (empty/invalid buffer → throws).

#### Unit tests — `errorHandler.test.ts` (extension)

- Add four `it()` cases for the new error codes to the existing `describe('mapError')` block.
- Pattern: `Object.assign(new Error('msg'), { statusCode, code })` → assert `mapError` returns expected `statusCode` and `code`.

#### Integration tests — `pdf.test.ts`

- **Mock strategy**: `vi.mock('../../lib/pdfParser.js')` at the top of the file. This isolates the route from the actual `pdf-parse` library. The mock returns controlled text arrays, eliminating the need for binary PDF fixtures.
- **Real DB**: integration tests use `DATABASE_URL_TEST`. `beforeAll` inserts a `Restaurant` row and a `DataSource` row. `afterAll` deletes them in reverse FK order (DishNutrient → Dish → Restaurant, DataSource).
- **Multipart injection**: Fastify's `.inject()` supports multipart. Construct the multipart body manually using `--boundary` format, or use a helper library. A minimal inline helper that builds a `multipart/form-data` buffer is acceptable — avoid adding a test-only dependency. The buffer for the `file` part should begin with `%PDF-` (magic bytes) to pass file validation.
- **Test isolation**: `afterEach` resets the mock and deletes any `Dish` rows created under the test `restaurantId` to prevent cross-test pollution.

#### Key test scenarios not to miss

- `dryRun: true` with a real DB → assert `dishesUpserted === 0` AND query DB to confirm no row was inserted.
- Salt/sodium derivation → verify `nutrients.sodium` is derived when only `sal` is in the PDF columns.
- Partial success (skipped dishes) → verify `skippedReasons` array length matches `dishesSkipped` count.

---

### Key Patterns

#### Error throwing pattern (`health.ts`, reused throughout)

```typescript
throw Object.assign(
  new Error('Descriptive message'),
  { statusCode: 422, code: 'INVALID_PDF' },
);
```

`registerErrorHandler` catches all thrown errors. `mapError` dispatches by `code`. The new error codes (`INVALID_PDF`, `UNSUPPORTED_PDF`, `NO_NUTRITIONAL_DATA_FOUND`, `PROCESSING_TIMEOUT`) must be added to `mapError` before they will return correct HTTP statuses.

#### Fastify plugin pattern (`health.ts`)

```typescript
const plugin: FastifyPluginAsync<PluginOptions> = async (app, opts) => { ... };
export const routeExport = fastifyPlugin(plugin);
```

`fastifyPlugin` ensures the route is registered on the root scope so the root-level error handler applies.

#### multipart handling (`@fastify/multipart`)

Access parts via `for await (const part of request.parts())`. Check `part.type === 'file'` vs `part.type === 'field'`. For file parts: `await part.toBuffer()` returns a `Buffer`. For field parts: `part.value` is the string value. `@fastify/multipart` enforces the `fileSize` limit registered in `app.ts`; exceeding it causes the plugin to throw a `413` error automatically — no manual size check needed in the handler.

#### TypeScript path aliases for inter-package imports

`packages/api/tsconfig.json` currently maps `@foodxplorer/shared` to `../shared/src`. Add `@foodxplorer/scraper` with the same pattern: `"@foodxplorer/scraper": ["../scraper/src"]`. At runtime (tsx / ts-node), the workspace symlink in `node_modules/@foodxplorer/scraper` resolves to `packages/scraper` — the path alias is only for type-checking. After adding it, `import type { RawDishData } from '@foodxplorer/scraper'` will type-check correctly.

#### `vi.mock` module path for route integration tests

The mock path in `vi.mock(...)` must match the import path used in the route handler. Since the route imports `extractText` from `'../../lib/pdfParser.js'`, the mock must be `vi.mock('../../lib/pdfParser.js', ...)` relative to the test file's location. Verify the relative path carefully given the test file is at `src/__tests__/routes/ingest/pdf.test.ts`.

#### Upsert key for dishes

`prisma.dish.upsert` requires a unique key. Check `packages/api/prisma/schema.prisma` for the unique constraint on `Dish`. Based on F002 migration, the unique index is `(restaurantId, name)` (lowercased via a DB-level unique index or Prisma `@@unique`). Use `where: { restaurantId_name: { restaurantId, name } }` — confirm the exact Prisma field name by inspecting the schema before coding.

#### Gotcha: `pdf-parse` and Node16 ESM

`pdf-parse` is a CommonJS package. Under `"module": "Node16"` with `"esModuleInterop": true`, import it as a default import: `import pdfParse from 'pdf-parse'`. If TypeScript rejects the default import due to `@types/pdf-parse` typing, use `import pdfParse = require('pdf-parse')` or check the types package shape before writing the wrapper.

#### Gotcha: `noUncheckedIndexedAccess` is enabled

`tsconfig.base.json` has `"noUncheckedIndexedAccess": true`. Array element access `arr[i]` returns `T | undefined`. Add null guards or use `arr.at(i) ?? defaultValue` where array element access occurs in the parser's column mapping loop.

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Unit tests for `nutritionTableParser` — all branches covered
- [ ] Integration tests for `POST /ingest/pdf` — all response codes covered
- [ ] TypeScript strict mode — no `any`, no `ts-ignore`
- [ ] No linting errors
- [ ] Build (`tsc --noEmit`) succeeds across all packages
- [ ] `docs/specs/F007b-pdf-ingestion-spec.md` reflects final implementation
- [ ] `docs/project_notes/key_facts.md` updated with new API route and dependencies

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs written (F007b-pdf-ingestion-spec.md, api-spec.yaml updated, ticket created)
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` executed, plan approved
- [x] Step 3: `backend-developer` executed with TDD — 45 tests (27 parser + 3 pdfParser + 15 integration)
- [x] Step 4: `production-code-validator` executed — 0 issues, quality gates pass
- [x] Step 5: `code-review-specialist` executed — C1 timer leak, I1 transaction, I2 error rethrow, I4 test fix, I5 Buffer.subarray
- [x] Step 5: `qa-engineer` executed — BUG-1 "< N" parsing, BUG-2 migration FK cleanup, 43 edge-case tests added
- [x] Step 6: Ticket updated with final metrics, branch deleted. Squash merge 5cb6384 to develop
