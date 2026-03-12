# F007b — PDF Ingestion Endpoint (POST /ingest/pdf)

**Feature:** F007b | **Type:** Backend-Feature | **Priority:** High
**Status:** Pending | **Epic:** E002 — Data Ingestion Pipeline
**Created:** 2026-03-12 | **Dependencies:** F007 complete (scraper scaffold)

---

## 1. Purpose

F007b adds `POST /ingest/pdf` to `packages/api`. The endpoint accepts a PDF file upload that contains nutritional data (restaurant menu PDFs, nutrition guide PDFs), extracts text from it, parses structured nutritional data from that text, normalizes it through the same pipeline established by F007 (`normalizeNutrients`, `normalizeDish`), and persists the resulting dishes to the database.

The primary target documents are:
- Spanish restaurant chain nutritional PDFs (tables with dish names and nutrient columns)
- Nutrition guides such as the FEN alimentación española guide (https://www.fen.org.es/storage/app/media/imgPublicaciones/2018/libro-la-alimentacion-espanola.pdf)

---

## 2. Scope Boundaries

**In scope:**
- `POST /ingest/pdf` Fastify route in `packages/api`
- PDF text extraction (library selection below)
- Heuristic/regex-based nutritional table parser
- Reuse of `normalizeNutrients` and `normalizeDish` from `packages/scraper`
- Persistence via Prisma (direct DB write, same as chain scrapers)
- OpenAPI documentation of the endpoint

**Out of scope:**
- LLM-based parsing (see §4 for the decision and rationale)
- Image-based PDFs / OCR (scanned documents — deferred to a future feature)
- Admin UI for upload status
- Async/background processing (the endpoint is synchronous for Phase 1)
- F007c (URL ingestion — separate ticket)

---

## 3. Architectural Decisions

### 3.1 PDF parsing library: `pdf-parse`

**Decision:** Use `pdf-parse` (npm package) for text extraction.

**Rationale:**
- Pure Node.js, no native binary dependencies. This keeps the `packages/api` Docker image lean.
- Outputs raw text string per page. Sufficient for structured nutritional tables.
- Actively maintained, zero peer dependencies, small bundle footprint.
- `pdfjs-dist` is the authoritative Mozilla library but carries a significant bundle size and requires a worker setup that adds complexity inappropriate for a server-side ingestion endpoint.
- `pdf-lib` is a PDF manipulation library, not a text extraction library.

**Constraint:** `pdf-parse` cannot extract text from image-based (scanned) PDFs. Those return empty or near-empty text. The endpoint detects this case and returns a `422 UNSUPPORTED_PDF` error (see §10).

**Package placement:** `pdf-parse` is installed as a runtime dependency of `packages/api` (NOT `packages/scraper`). The scraper package has no HTTP handler and should not carry PDF parsing.

### 3.2 Text parsing strategy: heuristic / regex (no LLM)

**Decision:** Parse nutritional data from PDF text using regex patterns and heuristic table detection. No LLM is used for parsing.

**Rationale (cost and reliability):**

The Phase 1 cost target is <0.05€/query (memory context from project_context.md). A single PDF upload can contain hundreds of dishes. LLM token costs for parsing a 50-dish nutritional table would far exceed the per-query budget.

Beyond cost, ADR-001 establishes that "the estimation engine is deterministic and auditable. The LLM NEVER calculates nutritional values." Parsing a structured table from a PDF is a data extraction task, not a natural language reasoning task — it belongs to the deterministic layer.

**The heuristic parser strategy:**

1. Split extracted text into lines.
2. Detect "header lines" by scanning for two or more known nutrient keywords appearing in sequence (Spanish and English variants). A header line anchors the column positions for the table that follows.
3. For each subsequent line until the next section break: attempt to parse a dish name (leftmost text before the first numeric token) and numeric nutrient values from the detected column positions.
4. If a line produces at least a name and calories, proteins, carbohydrates, and fats, it is treated as a valid dish row.
5. Lines that do not match the pattern are ignored (headings, footnotes, allergen disclaimers).

**Known limitations (accepted for Phase 1):**
- PDFs with multi-column layouts may produce garbled text order after extraction. The parser skips lines it cannot parse without failing the whole request.
- Column order varies across chains. The header detection step resolves this for well-structured PDFs; poorly structured PDFs yield fewer parsed dishes (partial success rather than failure).

### 3.3 Schema migration: `RawDishDataSchema` stays in `packages/scraper`

**Decision:** `RawDishDataSchema` and `NormalizedDishDataSchema` remain in `packages/scraper/src/base/types.ts` and are NOT moved to `packages/shared`.

**Rationale:**

The F007 spec (§17) flagged this as a question to resolve in F007b. The reason to keep them in `packages/scraper`:

1. `packages/api` will import `normalizeNutrients` and `normalizeDish` from `@foodxplorer/scraper`. Because those functions accept and return `RawDishData` / `NormalizedDishData`, the API handler must import the types from `@foodxplorer/scraper` anyway. There is no reduction in coupling from moving the schemas.
2. These types are scraper pipeline internals — their concern is the normalization contract, not the HTTP API contract. The HTTP request schema (`IngestPdfRequestSchema`) and HTTP response schema (`IngestPdfResponseSchema`) are defined in `packages/api` using `packages/shared` enums only.
3. Moving them to `packages/shared` would expose them to `packages/bot` and future consumers who have no business depending on them.

**Consequence:** `packages/api/package.json` adds `@foodxplorer/scraper` as a runtime dependency, establishing an explicit inter-package dependency edge: `api → scraper → shared`. The dependency graph remains a DAG.

### 3.4 Persistence: direct Prisma upsert (same as chain scrapers)

Consistent with ADR-001 and the F007 §6 Option A decision. The ingest handler calls `prisma.dish.upsert` and `prisma.dishNutrient.upsert` directly. No internal HTTP hop.

Upsert key: `(restaurantId, externalId)` when `externalId` is present; `(restaurantId, lower(name))` otherwise.

### 3.5 Synchronous processing for Phase 1

PDF processing is synchronous within the HTTP request/response cycle. For Phase 1, PDFs from restaurant chains contain at most a few hundred dishes; processing time is expected to be well under 10 seconds. Background job processing is deferred.

A hard timeout of 30 seconds is enforced at the route level (Fastify `bodyLimit` and a manual timeout guard). If exceeded, the endpoint returns `408 PROCESSING_TIMEOUT`.

---

## 4. File Structure

```
packages/api/src/
├── routes/
│   └── ingest/
│       └── pdf.ts                  # POST /ingest/pdf route plugin
├── lib/
│   └── pdfParser.ts                # pdf-parse wrapper — extractText(buffer) → string[]
└── ingest/
    └── nutritionTableParser.ts     # Heuristic parser — parseNutritionTable(lines) → RawDishData[]
```

```
packages/api/src/__tests__/
└── routes/
    └── ingest/
        └── pdf.test.ts             # Integration-style tests using buildApp() + inject()
```

```
packages/api/src/__tests__/
└── ingest/
    └── nutritionTableParser.test.ts  # Unit tests for the heuristic parser
```

---

## 5. Request Schema

### 5.1 Multipart form data

The endpoint accepts `multipart/form-data`. The request body contains:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `file` | binary (PDF) | Yes | MIME type must be `application/pdf`. Max size: 10 MB. |
| `restaurantId` | string (UUID) | Yes | Must match an existing `restaurants.id` row. |
| `sourceId` | string (UUID) | Yes | Must match an existing `data_sources.id` row. |
| `dryRun` | boolean (string "true"/"false") | No | Default: `false`. When `true`, runs extraction and normalization but skips DB writes. Returns parsed dishes for inspection. |

**Fastify multipart handling:** Register `@fastify/multipart` in `packages/api/src/app.ts`. Configure `limits.fileSize: 10 * 1024 * 1024` (10 MB). The `pdf.ts` route handler accesses the multipart parts directly via `request.parts()`.

**Zod validation for non-file fields:**

```
IngestPdfBodySchema = z.object({
  restaurantId : z.string().uuid(),
  sourceId     : z.string().uuid(),
  dryRun       : z.string()
                   .transform(v => v === 'true')
                   .default('false'),
})
```

Non-file fields arrive as text parts in the multipart stream. The route handler collects them and validates with `IngestPdfBodySchema.safeParse()` before processing the file.

### 5.2 File validation

After receiving the file buffer, the handler checks:
1. Content-Type of the file part is `application/pdf`.
2. File buffer is non-empty.
3. Buffer starts with `%PDF-` (magic bytes). If not, return `422 INVALID_PDF`.

---

## 6. Processing Pipeline

```
[POST /ingest/pdf]
     │
     │  multipart/form-data received
     │
     ▼
[File validation]
     │  magic bytes check (%PDF-)
     │  MIME type check
     │
     ▼
[pdfParser.extractText(buffer)]      ← packages/api/src/lib/pdfParser.ts
     │                                  wraps pdf-parse; returns string[] (one per page)
     │  empty text → 422 UNSUPPORTED_PDF (image-based PDF)
     │
     ▼
[nutritionTableParser.parseNutritionTable(lines)]   ← packages/api/src/ingest/nutritionTableParser.ts
     │
     │  Returns RawDishData[]
     │  zero dishes → 422 NO_NUTRITIONAL_DATA_FOUND
     │
     ▼
[normalizeNutrients() + normalizeDish()]   ← @foodxplorer/scraper (reused from F007)
     │
     │  Invalid dishes → collected in `dishesSkipped` (not a fatal error)
     │
     ▼
[NormalizedDishDataSchema.safeParse()]
     │
     ▼
[Prisma upsert — if dryRun === false]
     │
     │  dishes + dish_nutrients tables
     │  upsert on (restaurantId, externalId) or (restaurantId, lower(name))
     │
     ▼
[Response]
```

---

## 7. Response Schema

### 7.1 Success (200)

```
IngestPdfResponseSchema = z.object({
  success          : z.literal(true),
  data: z.object({
    dishesFound    : z.number().int().nonnegative(),
    dishesUpserted : z.number().int().nonnegative(),
    dishesSkipped  : z.number().int().nonnegative(),
    dryRun         : z.boolean(),
    dishes         : z.array(NormalizedDishDataSchema),
      // Always present (both live runs and dryRun). Allows callers to
      // inspect what was (or would be) written.
    skippedReasons : z.array(z.object({
      dishName  : z.string(),
      reason    : z.string(),
    })),
      // One entry per skipped dish — why normalization rejected it.
  }),
})
```

### 7.2 Example response

```json
{
  "success": true,
  "data": {
    "dishesFound": 48,
    "dishesUpserted": 45,
    "dishesSkipped": 3,
    "dryRun": false,
    "dishes": [
      {
        "name": "Big Mac",
        "nameEs": "Big Mac",
        "nutrients": {
          "calories": 550,
          "proteins": 25,
          "carbohydrates": 46,
          "fats": 28,
          "saturatedFats": 10,
          "sugars": 9,
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
        "confidenceLevel": "medium",
        "estimationMethod": "scraped",
        "availability": "available",
        "restaurantId": "00000000-0000-0000-0000-000000000001",
        "sourceId": "00000000-0000-0000-0000-000000000002"
      }
    ],
    "skippedReasons": [
      { "dishName": "Bebida Grande", "reason": "Missing required field: proteins" }
    ]
  }
}
```

---

## 8. Normalization Rules (inherited from F007)

The normalization functions from `packages/scraper` are reused as-is. No new rules are added.

| Rule | Detail |
|---|---|
| `confidenceLevel` | Always `'medium'` — same as web-scraped data |
| `estimationMethod` | `'scraped'` — PDF is an official source, same trust level as chain website scrape |
| `referenceBasis` | Always `'per_serving'` (ADR-004) |
| `sourceUrl` on `RawDishData` | Set to `'pdf://[originalFileName]'` — a synthetic URL to satisfy the `sourceUrl: z.string().url()` field. Filename is sanitized (no path, no special chars). |
| `scrapedAt` on `RawDishData` | Set to `new Date().toISOString()` at request time |

**Note on `sourceUrl`:** `RawDishDataSchema` requires `sourceUrl` to be a valid URL. For PDF ingestion, there is no HTTP URL. The value `pdf://[sanitizedFilename]` is a synthetic URI that satisfies Zod's `.url()` validation while being descriptive. The actual source traceability is carried by `sourceId` (the `data_sources` row), which is required in the request.

---

## 9. Heuristic Parser Specification

Defined in `packages/api/src/ingest/nutritionTableParser.ts`.

### 9.1 Input

```typescript
parseNutritionTable(lines: string[]): RawDishData[]
```

`lines` is the full extracted text, split into individual lines. The function receives the full document, not individual pages — the caller concatenates page text before passing it in.

### 9.2 Known nutrient keywords (case-insensitive, Spanish + English)

| Column label variants | Maps to RawDishData field |
|---|---|
| `calorías`, `energía`, `calories`, `energy`, `kcal` | `calories` |
| `proteínas`, `proteína`, `proteins`, `protein` | `proteins` |
| `hidratos`, `carbohidratos`, `glúcidos`, `carbohydrates`, `carbs` | `carbohydrates` |
| `azúcares`, `azúcar`, `sugars`, `sugar` | `sugars` |
| `grasas`, `lípidos`, `fat`, `fats` | `fats` |
| `saturadas`, `saturated` | `saturatedFats` |
| `fibra`, `fiber`, `fibre` | `fiber` |
| `sal`, `salt` | `salt` |
| `sodio`, `sodium` | `sodium` |
| `trans` | `transFats` |
| `colesterol`, `cholesterol` | `cholesterol` |
| `potasio`, `potassium` | `potassium` |
| `monoinsaturadas`, `monounsaturated` | `monounsaturatedFats` |
| `poliinsaturadas`, `polyunsaturated` | `polyunsaturatedFats` |

### 9.3 Header detection

A line is treated as a header line if it contains **3 or more** distinct nutrient keywords from the table above. Requiring 3 reduces false positives from lines that happen to contain two nutrient-like words.

Once a header line is detected, column order is inferred by the left-to-right position of each keyword within the line.

### 9.4 Data row parsing

After a header is found, subsequent non-empty lines are tested as data rows:

1. Find all numeric tokens in the line (regex: `/\d+(?:[.,]\d+)?/g`). Comma is treated as decimal separator (common in Spanish PDFs).
2. If the number of numeric tokens is >= 4 (minimum: calories, proteins, carbs, fats), map each token to the corresponding nutrient column by position.
3. The dish name is taken as the substring before the first numeric token, stripped of leading/trailing whitespace and collapsed spaces.
4. If the dish name is empty or less than 2 characters after trimming, the row is skipped.
5. A row is abandoned and the section ends when a line contains fewer than 2 numeric tokens AND contains a nutrient keyword (suggesting a new section header has started without the parser detecting it first).

### 9.5 Multiple tables in one document

The parser resets column state when it detects a new header line. This allows a single PDF to contain tables from multiple sections (starters, mains, desserts) or multiple chains in a guide document.

### 9.6 Parser output

Returns `RawDishData[]`. Each item has:
- `name`: from dish name detection
- `nutrients`: populated from column mapping (only fields with detected columns are set; others are undefined — `normalizeNutrients` applies defaults)
- `sourceUrl`: `'pdf://[sanitizedFilename]'` (set by the route handler before calling the parser; the parser accepts it as a parameter)
- `scrapedAt`: set by the route handler
- `aliases`: `[]`
- `externalId`: `undefined` (PDFs do not provide chain-specific IDs)
- `category`: `undefined`

---

## 10. Error Handling

All errors follow the existing error envelope: `{ success: false, error: { message, code, details? } }`.

New error codes introduced by F007b:

| Scenario | HTTP | code |
|---|---|---|
| File part missing from multipart body | 400 | `VALIDATION_ERROR` |
| `restaurantId` or `sourceId` missing / not UUID | 400 | `VALIDATION_ERROR` |
| File is not a PDF (MIME or magic bytes check fails) | 422 | `INVALID_PDF` |
| PDF is image-based (no text extracted) | 422 | `UNSUPPORTED_PDF` |
| PDF contains no detectable nutritional table | 422 | `NO_NUTRITIONAL_DATA_FOUND` |
| `restaurantId` not found in DB | 404 | `NOT_FOUND` |
| `sourceId` not found in DB | 404 | `NOT_FOUND` |
| File exceeds 10 MB | 413 | `VALIDATION_ERROR` |
| Processing exceeds 30 seconds | 408 | `PROCESSING_TIMEOUT` |
| All parsed dishes fail normalization | 422 | `NO_NUTRITIONAL_DATA_FOUND` |
| DB write fails | 500 | `DB_UNAVAILABLE` |

**Partial success is NOT an error.** If 48 dishes are found and 3 fail normalization, the endpoint returns `200` with `dishesSkipped: 3` and `skippedReasons`. Only the case where ALL dishes fail normalization (zero upserted, zero parseable) returns a 422.

---

## 11. Zod Schemas (defined in `packages/api/src/routes/ingest/pdf.ts`)

These schemas are API-internal — they are NOT added to `packages/shared`.

```
IngestPdfBodySchema = z.object({
  restaurantId : z.string().uuid(),
  sourceId     : z.string().uuid(),
  dryRun       : z.string()
                   .transform(v => v === 'true')
                   .default('false'),
})

IngestPdfSkippedReasonSchema = z.object({
  dishName  : z.string(),
  reason    : z.string(),
})

IngestPdfResultSchema = z.object({
  dishesFound    : z.number().int().nonnegative(),
  dishesUpserted : z.number().int().nonnegative(),
  dishesSkipped  : z.number().int().nonnegative(),
  dryRun         : z.boolean(),
  dishes         : z.array(NormalizedDishDataSchema),
  skippedReasons : z.array(IngestPdfSkippedReasonSchema),
})
```

---

## 12. OpenAPI Specification

The endpoint is documented under the `Ingestion` tag (already registered in `api-spec.yaml`). See `docs/specs/api-spec.yaml` for the full endpoint definition (added as part of F007b).

Key schema references added to `components/schemas`:
- `IngestPdfResult`
- `IngestPdfSkippedReason`

---

## 13. New Dependencies

### `packages/api/package.json`

| Package | Type | Reason |
|---|---|---|
| `pdf-parse` | runtime | PDF text extraction |
| `@types/pdf-parse` | devDep | TypeScript types for pdf-parse |
| `@fastify/multipart` | runtime | Multipart form data handling for file uploads |
| `@foodxplorer/scraper` | runtime | `normalizeNutrients`, `normalizeDish`, `RawDishData`, `NormalizedDishData` |

**Note on `@fastify/multipart`:** Register it in `packages/api/src/app.ts` with `limits: { fileSize: 10 * 1024 * 1024 }`. Register it before route plugins.

---

## 14. Route Registration

The route plugin follows the same `fastify-plugin` + injectable dependencies pattern as `packages/api/src/routes/health.ts`.

```typescript
// packages/api/src/routes/ingest/pdf.ts

interface IngestPdfPluginOptions {
  prisma: PrismaClient;
}

const ingestPdfRoutesPlugin: FastifyPluginAsync<IngestPdfPluginOptions> = async (app, opts) => {
  app.post('/ingest/pdf', { schema: { ... } }, async (request, reply) => { ... });
};

export const ingestPdfRoutes = fastifyPlugin(ingestPdfRoutesPlugin);
```

Registered in `packages/api/src/app.ts`:

```typescript
await app.register(ingestPdfRoutes, { prisma: prismaClient });
```

---

## 15. Testing Strategy

### 15.1 Unit tests

| File | Type | What it covers |
|---|---|---|
| `nutritionTableParser.test.ts` | Unit | Header detection (Spanish + English keywords), column mapping, data row parsing, multi-table documents, edge cases (empty lines, non-numeric tokens, too-short dish names) |

### 15.2 Integration tests

| File | Type | What it covers |
|---|---|---|
| `pdf.test.ts` | Integration (buildApp + inject) | Happy path: valid PDF with nutritional table → 200 + dishes. `dryRun: true` → 200, no DB writes. Invalid MIME → 422 INVALID_PDF. Missing `restaurantId` → 400. File too large → 413. PDF with no text → 422 UNSUPPORTED_PDF. All dishes fail normalization → 422 NO_NUTRITIONAL_DATA_FOUND. |

### 15.3 Test fixtures

- `packages/api/src/__tests__/fixtures/pdf/sample-nutrition-table.txt` — pre-extracted text content from a synthetic nutritional table (10 dishes). This avoids depending on `pdf-parse` in the unit tests for the parser.
- `packages/api/src/__tests__/fixtures/pdf/multi-section-table.txt` — text with two distinct nutrition table sections.
- `packages/api/src/__tests__/fixtures/pdf/empty.txt` — empty string (simulates image PDF).
- `packages/api/src/__tests__/fixtures/pdf/no-nutrients.txt` — text that contains no nutritional tables.

The integration tests for the route itself use a minimal real PDF buffer generated in the test (e.g., a 1-page PDF created programmatically) to test the `pdfParser.extractText` layer without requiring bundled PDF files.

### 15.4 Mocking strategy

- `nutritionTableParser.test.ts`: pure function — no mocks needed. Use string fixtures.
- `pdf.test.ts`: mock `pdfParser.extractText` via `vi.mock` to return controlled text, isolating route logic from the pdf-parse library. Test the actual `pdfParser.ts` wrapper in a separate unit test.
- DB: use the test Prisma client (`DATABASE_URL_TEST`). The integration tests require the test DB to contain at least one Restaurant row and one DataSource row (seed in `beforeAll`).

---

## 16. Environment Variables

No new environment variables. The endpoint uses the existing `DATABASE_URL` / `DATABASE_URL_TEST` and Prisma singleton from `packages/api`.

---

## 17. Edge Cases

| Scenario | Expected behaviour |
|---|---|
| PDF contains text but no table structure | Parser returns `[]` → `422 NO_NUTRITIONAL_DATA_FOUND` |
| PDF has a nutrition table but all rows fail normalization (missing required fields) | `dishesFound > 0`, `dishesUpserted: 0`, `dishesSkipped > 0` → `422 NO_NUTRITIONAL_DATA_FOUND` |
| PDF contains multiple nutrition tables (e.g. starters + mains) | All tables parsed; dishes from all sections returned in a single response |
| Dish name contains parentheses or diacritics (Spanish) | Dish name preserved as-is after trim/collapse; no stripping of Unicode |
| Nutrient value written as "< 1" with a space | Regex strips space before `<`, coerces to `0.5` via `normalizeNutrients` |
| Nutrient value written as "1,5" (comma decimal) | Route handler or parser normalizes commas to dots before passing to `normalizeNutrients` |
| Same dish name appears twice in the PDF (e.g. different portions) | Both parsed; upsert last-write-wins on `(restaurantId, name)`. Accepted for Phase 1. |
| `dryRun: true` but `restaurantId` does not exist in DB | Still returns `404 NOT_FOUND` — DB existence check runs regardless of `dryRun` |
| PDF with 500+ dishes | Processing completes synchronously within 30-second timeout. If timeout is hit, `408 PROCESSING_TIMEOUT`. |
| Multipart request with no `file` part | `400 VALIDATION_ERROR` |
| Multipart request with multiple `file` parts | Only the first `file` part is processed; subsequent ones are ignored |
| File part has MIME `application/octet-stream` but valid PDF magic bytes | Accepted — magic byte check takes precedence over MIME type |

---

## 18. Acceptance Criteria

- [ ] `POST /ingest/pdf` with a valid PDF containing a Spanish nutritional table returns `200` with at least 1 dish upserted
- [ ] `dryRun: true` returns `200` with parsed dishes and `dishesUpserted: 0` (no DB writes)
- [ ] Non-PDF file returns `422 INVALID_PDF`
- [ ] Image-based PDF (no extractable text) returns `422 UNSUPPORTED_PDF`
- [ ] PDF with no nutritional table returns `422 NO_NUTRITIONAL_DATA_FOUND`
- [ ] Missing `restaurantId` returns `400 VALIDATION_ERROR`
- [ ] Non-existent `restaurantId` (valid UUID but no DB row) returns `404 NOT_FOUND`
- [ ] File > 10 MB returns `413`
- [ ] Partial success (some dishes skipped): `200` with `dishesSkipped > 0` and non-empty `skippedReasons`
- [ ] `tsc --noEmit` passes with zero errors across all packages
- [ ] `vitest run` passes — all tests green
- [ ] Endpoint documented in `docs/specs/api-spec.yaml` under `Ingestion` tag
- [ ] TypeScript strict mode — no `any`, no `ts-ignore`
- [ ] `nutritionTableParser.parseNutritionTable` correctly handles Spanish and English keyword variants in unit tests
- [ ] Salt/sodium derivation in `normalizeNutrients` is exercised via the PDF pipeline (integration test)

---

## 19. Out of Scope

- OCR for image-based PDFs → future feature
- LLM-assisted parsing for unstructured narrative text → future, subject to cost review
- Background/async PDF processing → deferred to Phase 2
- F007c (URL ingestion) → separate ticket
- Admin UI for upload history → future
