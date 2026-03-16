# F012: Image/OCR Ingestion Pipeline

**Feature:** F012 | **Type:** Backend-Feature | **Priority:** High
**Status:** In Progress | **Branch:** feature/F012-image-ocr-ingestion
**Created:** 2026-03-16 | **Dependencies:** F011 complete (chainTextPreprocessor, chainSlug on pdf-url)

---

## Spec

### Description

Domino's Spain publishes nutritional data as JPEG images at `alergenos.dominospizza.es/img/` — not as PDFs. F012 adds an OCR-based ingestion pipeline that downloads an image from a URL, runs Tesseract.js to extract text, optionally preprocesses the text through `chainTextPreprocessor`, and feeds the extracted lines into the existing `parseNutritionTable` pipeline.

This is the fourth and final ingestion variant in the E002 pipeline:
- `POST /ingest/pdf` — file upload
- `POST /ingest/pdf-url` — PDF download from URL
- `POST /ingest/url` — HTML page scrape via Playwright
- `POST /ingest/image-url` — **image download + OCR** (F012)

All four share the same downstream pipeline: `parseNutritionTable → normalizeNutrients / normalizeDish → Prisma $transaction upsert`.

Full spec: see below (inline — no separate spec file needed given the narrow scope).

---

### Architecture Decisions

**Tesseract.js for OCR (not a Python service or cloud API):**
- Consistent with ADR-000 (Node.js only runtime) and ADR-001 (deterministic, auditable, no LLM)
- Tesseract.js v5 runs in Node.js via WebAssembly — pure JS, no native binaries, no separate process
- Languages: `spa+eng` (Spanish primary, English fallback) — nutritional labels in Spain are in Spanish but sometimes include English column headers
- Per-request worker creation (create → recognize → terminate). A worker pool is deferred to a future ADR if performance testing shows initialization overhead is a bottleneck.

**Separate `imageDownloader` library (not extending `pdfDownloader`):**
- Different Content-Type whitelist (image/* vs application/pdf)
- Different magic bytes validation (JPEG: `FFD8FF`, PNG: `89504E47`)
- Size limit 10 MB (not 20 MB like PDFs — nutritional images are small)
- Same fetch DI pattern (`fetchImpl: typeof fetch = fetch`) for testability

**Separate image-url route (not extending pdf-url route):**
- OCR pipeline step replaces the `extractText(pdfBuffer)` step
- 60-second total timeout (vs 30s for PDFs) — Tesseract.js WASM cold start + OCR adds latency
- New error code `OCR_FAILED` — distinct from `UNSUPPORTED_PDF`; same HTTP status (422)
- New error code `INVALID_IMAGE` — parallel to `INVALID_PDF`

**Separate image registry (not extending `CHAIN_PDF_REGISTRY`):**
- `ChainPdfConfig` schema has `pdfUrl` field typed as `z.string().url().startsWith('https://')` — cannot hold image URLs without misleading naming
- New `ChainImageConfig` schema with `imageUrl` field (or `imageUrls: string[]` for multi-page sources)
- Registered in new file `chain-image-registry.ts`; Domino's is the sole initial entry

**Batch runner extension (image batch alongside PDF batch):**
- Rather than adding an `--image` flag to the existing `batch-ingest.ts`, a new `batch-ingest-images.ts` script mirrors the PDF batch runner structure
- Same CLI flags: `--chain`, `--dry-run`, `--api-url`, `--concurrency` (sequential Phase 1)
- Calls `POST /ingest/image-url` instead of `POST /ingest/pdf-url`

---

### File Structure

```
packages/api/src/
  routes/
    ingest/
      image-url.ts                  NEW — POST /ingest/image-url route plugin
  lib/
    imageDownloader.ts              NEW — downloadImage(url, fetchImpl?)
    imageOcrExtractor.ts            NEW — extractTextFromImage(buffer)
  config/
    chains/
      chain-image-registry.ts       NEW — CHAIN_IMAGE_REGISTRY (Domino's entry)
      chain-seed-ids.ts             MODIFIED — add DOMINOS_ES entry
  scripts/
    batch-ingest-images.ts          NEW — CLI batch runner for image chains
```

---

### API Endpoints

#### POST /ingest/image-url

**Purpose:** Downloads an image from a URL, OCRs it, and feeds the text through the existing nutrition parsing + normalization + persist pipeline.

**Request body (JSON):**
```typescript
// Zod schema: IngestImageUrlBodySchema
z.object({
  url:          z.string().url().max(2048),
  restaurantId: z.string().uuid(),
  sourceId:     z.string().uuid(),
  dryRun:       z.boolean().default(false),
  chainSlug:    z.string().min(1).max(100).regex(/^[a-z0-9-]+$/).optional(),
})
```

**Pipeline steps (in order):**
1. Parse + validate JSON body via Zod
2. `assertNotSsrf(url)` — throws `INVALID_URL` (422) for private/loopback addresses
3. DB existence checks: `restaurant.findUnique({ id: restaurantId })`, `dataSource.findUnique({ id: sourceId })` — both throw `NOT_FOUND` (404) if absent
4. Wrap remaining steps in 60-second Promise.race timeout → `PROCESSING_TIMEOUT` (408)
5. `downloadImage(url)` — returns `{ buffer: Buffer, contentType: string }` — throws `FETCH_FAILED` (422) or `PAYLOAD_TOO_LARGE` (413)
6. Magic bytes validation: JPEG (`FFD8FF`) or PNG (`89504E47`) — throws `INVALID_IMAGE` (422) if neither
7. `extractTextFromImage(buffer)` — returns `string[]` (lines) — throws `OCR_FAILED` (422) on Tesseract error
8. Optional: if `chainSlug` provided, `preprocessChainText(chainSlug, lines)` — returns normalized lines
9. `parseNutritionTable(lines, url, scrapedAt)` — returns `RawDishData[]`
10. If `rawDishes.length === 0` → throw `NO_NUTRITIONAL_DATA_FOUND` (422)
11. Normalize: `normalizeNutrients` + `normalizeDish` loop; collect `validDishes` and `skippedReasons`
12. If `validDishes.length === 0` → throw `NO_NUTRITIONAL_DATA_FOUND` (422)
13. If `dryRun === false`: Prisma `$transaction` upsert (same pattern as `pdf-url.ts`)
14. Return 200 with result payload

**Success response (HTTP 200):**
```json
{
  "success": true,
  "data": {
    "dishesFound": 42,
    "dishesUpserted": 40,
    "dishesSkipped": 2,
    "dryRun": false,
    "sourceUrl": "https://alergenos.dominospizza.es/img/tabla_nutricional.jpg",
    "dishes": [ /* NormalizedDish[] */ ],
    "skippedReasons": [ /* { dishName, reason }[] */ ]
  }
}
```

**Error codes:**

| HTTP | code | Condition |
|------|------|-----------|
| 400 | `VALIDATION_ERROR` | Zod validation failure (missing field, invalid UUID, bad URL string) |
| 404 | `NOT_FOUND` | `restaurantId` or `sourceId` not in DB |
| 408 | `PROCESSING_TIMEOUT` | Pipeline exceeded 60 seconds |
| 413 | `PAYLOAD_TOO_LARGE` | Image exceeds 10 MB |
| 422 | `INVALID_URL` | Non-http/https scheme or SSRF-blocked address |
| 422 | `FETCH_FAILED` | Network error, DNS failure, or non-2xx HTTP response |
| 422 | `INVALID_IMAGE` | Content-Type not image/* or magic bytes not JPEG/PNG |
| 422 | `OCR_FAILED` | Tesseract.js threw an unrecoverable error during OCR |
| 422 | `NO_NUTRITIONAL_DATA_FOUND` | OCR returned lines but `parseNutritionTable` found 0 dishes, or all dishes failed normalization |
| 500 | `DB_UNAVAILABLE` | Prisma `$transaction` threw a non-domain error |

---

### Library: imageDownloader

**File:** `packages/api/src/lib/imageDownloader.ts`

**Exported function:**
```typescript
export async function downloadImage(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ buffer: Buffer; contentType: string }>
```

**Behavior:**
- Timeout: 30-second `AbortSignal.timeout(30_000)` on the fetch call
- Non-2xx HTTP response → throws `{ code: 'FETCH_FAILED', statusCode: 422 }`
- Network/DNS/AbortError → throws `{ code: 'FETCH_FAILED', statusCode: 422 }`
- `response.body === null` → throws `{ code: 'FETCH_FAILED', statusCode: 422 }`
- Content-Type validation (checked after fetch, before streaming body):
  - Allowed: `image/jpeg`, `image/png`, `image/webp`
  - All others → throw `{ code: 'INVALID_IMAGE', statusCode: 422 }`
  - Note: Content-Type check is a first-pass guard only; magic bytes are the authoritative check (in the route, not in this library — Content-Type on Domino's server may be `application/octet-stream`)
- Streaming accumulation with 10 MB cap (same pattern as `pdfDownloader.ts`):
  - `totalBytes > MAX_IMAGE_BYTES` → cancel reader, throw `{ code: 'PAYLOAD_TOO_LARGE', statusCode: 413 }`
- Returns `{ buffer: Buffer.concat(chunks), contentType }` where `contentType` is the raw value from the `content-type` response header

**Constants:**
```typescript
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
```

**Note on Content-Type leniency:** If Domino's server sends `application/octet-stream` (as some CDNs do), the caller (route) must apply magic bytes validation regardless of Content-Type. The `imageDownloader` therefore accepts `application/octet-stream` in addition to `image/*` to avoid INVALID_IMAGE at the download stage when the response is genuinely an image. The route applies the magic bytes validation as the authoritative check. If Content-Type is neither `image/*` nor `application/octet-stream`, the download throws `INVALID_IMAGE`.

Updated Content-Type allow-list for `imageDownloader`:
- `image/jpeg`
- `image/png`
- `image/webp`
- `application/octet-stream` (CDN fallback — magic bytes checked by route)

---

### Library: imageOcrExtractor

**File:** `packages/api/src/lib/imageOcrExtractor.ts`

**Exported function:**
```typescript
export async function extractTextFromImage(buffer: Buffer): Promise<string[]>
```

**Behavior:**
- Creates a new Tesseract.js worker per call: `createWorker(['spa', 'eng'])`
- Calls `worker.recognize(buffer)` — input is a raw image buffer (JPEG or PNG)
- Terminates the worker in a `finally` block to release WASM memory
- Returns `result.data.text.split('\n').map(l => l.trim()).filter(l => l.length > 0)`
  - Trim and filter: removes empty lines and leading/trailing whitespace that Tesseract commonly produces
- If Tesseract throws at any stage (createWorker, recognize, or terminate) → rethrow as `{ code: 'OCR_FAILED', statusCode: 422, message: 'OCR extraction failed: <original message>' }`

**Tesseract.js configuration:**
- Package: `tesseract.js` v5 (Node.js, WebAssembly backend — no `node-pre-gyp`)
- Languages: `['spa', 'eng']` — Tesseract attempts Spanish first, then English as fallback
- No custom `oem` or `psm` overrides in Phase 1 (use defaults: `OEM_LSTM_ONLY`, `PSM_AUTO`)
- Language data is downloaded from Tesseract's CDN on first use in development; in production the `TESSDATA_PREFIX` env var must point to a local copy of the tessdata files to avoid network calls at runtime

**Performance note:** Tesseract WASM cold start is ~500ms on modern hardware. A 400×300 nutritional image OCRs in approximately 2–4 seconds. The 60-second route timeout provides substantial headroom. Worker pooling is deferred until profiling indicates it is needed.

---

### New Dependency

**`tesseract.js`** (npm) — added to `packages/api/package.json`
- Version: `^5.0.0` (latest stable as of 2026-03-16)
- Runtime only (not devDependency)
- No native binaries; WebAssembly-based — consistent with project's "pure JS" dependency philosophy (ADR-000, pdf-parse precedent)

---

### Config: chain-image-registry.ts

**File:** `packages/api/src/config/chains/chain-image-registry.ts`

**Zod schema:**
```typescript
export const ChainImageConfigSchema = z.object({
  chainSlug:       z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  name:            z.string().min(1).max(255),
  countryCode:     z.string().length(2).regex(/^[A-Z]{2}$/),
  imageUrls:       z.array(z.string().max(2048).url().startsWith('https://')).min(1),
  restaurantId:    z.string().uuid(),
  sourceId:        z.string().uuid(),
  updateFrequency: z.enum(['static', 'monthly', 'quarterly', 'yearly', 'unknown']),
  enabled:         z.boolean(),
  notes:           z.string().optional(),
});

export type ChainImageConfig = z.infer<typeof ChainImageConfigSchema>;
```

**Key difference from `ChainPdfConfig`:** `imageUrls` is an array (plural) because a chain may spread nutritional data across multiple images (e.g., one image per product category). The batch runner iterates over `imageUrls` for each chain entry, calling `POST /ingest/image-url` once per URL.

**Initial entry — Domino's Spain:**
```typescript
export const CHAIN_IMAGE_REGISTRY: ChainImageConfig[] = [
  {
    chainSlug:       'dominos-es',
    name:            "Domino's Spain",
    countryCode:     'ES',
    imageUrls:       [
      'https://alergenos.dominospizza.es/img/tabla_nutricional.jpg',
      // Additional image URLs to be verified during implementation
      // (Domino's site may have multiple images per product category)
    ],
    restaurantId:    CHAIN_SEED_IDS.DOMINOS_ES.RESTAURANT_ID,
    sourceId:        CHAIN_SEED_IDS.DOMINOS_ES.SOURCE_ID,
    updateFrequency: 'unknown',
    enabled:         true,
    notes:           "OCR-based source (JPEG images, not PDF). URL pattern: alergenos.dominospizza.es/img/. Verify URLs during F012 implementation — Domino's may update image paths.",
  },
];
```

**Note:** The exact image URLs must be verified during implementation Step 1 by inspecting `alergenos.dominospizza.es` with Playwright or manual browser inspection. The URL above is the known base pattern from ADR-006.

---

### Config: chain-seed-ids.ts extension

Add Domino's entry following the existing ID allocation convention:

```typescript
// Next available IDs after ...0013 (Five Guys)
DOMINOS_ES: {
  RESTAURANT_ID: '00000000-0000-0000-0006-000000000014',
  SOURCE_ID:     '00000000-0000-0000-0000-000000000014',
},
```

The `seed.ts` script must be extended to create the Domino's restaurant + dataSource rows using these deterministic IDs (same `upsert` pattern as Phase 3 seed for BK/KFC/Telepizza/Five Guys).

---

### Script: batch-ingest-images.ts

**File:** `packages/api/src/scripts/batch-ingest-images.ts`

**Exported types:**
```typescript
export interface RunImageBatchOptions {
  chainSlug?:  string;
  dryRun:      boolean;
  apiBaseUrl:  string;
  concurrency: number;
}

export type ChainImageIngestResultSuccess = {
  chain:            ChainImageConfig;
  imageUrl:         string;
  status:           'success';
  dishesFound:      number;
  dishesUpserted:   number;
  dishesSkipped:    number;
  dryRun:           boolean;
};

export type ChainImageIngestResultError = {
  chain:        ChainImageConfig;
  imageUrl:     string;
  status:       'error';
  errorCode:    string;
  errorMessage: string;
};

export type ChainImageIngestResult = ChainImageIngestResultSuccess | ChainImageIngestResultError;
```

**`runImageBatch(registry, options, fetchImpl?):`**
- Iterates enabled chains in `registry`
- For each chain, iterates its `imageUrls` array — calls `POST /ingest/image-url` once per URL
- One `ChainImageIngestResult` entry per image URL (not per chain) — allows partial success within a chain
- Continue-on-failure semantics: failed URLs are recorded; other URLs in same chain still run
- Sequential only in Phase 1 (`concurrency` flag parsed but > 1 falls back to 1 with warning)
- Exit code 1 if any URL failed

**CLI flags:** same as `batch-ingest.ts` — `--chain`, `--dry-run`, `--api-url`, `--concurrency`

**npm script to add to `packages/api/package.json`:**
```json
"ingest:batch-images": "node --import tsx/esm src/scripts/batch-ingest-images.ts"
```
(mirrors the existing `ingest:batch` script pattern)

---

### Data Model Changes

No Prisma schema changes. Domino's dishes will be persisted to the same `dishes` + `dish_nutrients` tables as all other chains. The only data model change is new seed rows:
- 1 new `Restaurant` row: `{ id: '...0014', name: "Domino's Spain", chainSlug: 'dominos-es', countryCode: 'ES' }`
- 1 new `DataSource` row: `{ id: '...0014', name: "Domino's Spain — Official Nutritional Images", url: 'https://alergenos.dominospizza.es/img/', type: 'pdf' }`
  - Note: DataSource `type` remains `'pdf'` (enum value) because there is no separate `image` type in the current schema. This is acceptable for Phase 1. If an `image` type is needed, a schema migration would be added as a separate ticket.

---

### Edge Cases

1. **Domino's image URLs may change.** The known pattern is `alergenos.dominospizza.es/img/`. If the URL returns 404, `FETCH_FAILED` is returned. The `imageUrls` array in the registry must be verified during implementation Step 1 against the live site. The `notes` field documents the URL pattern.

2. **Image served as `application/octet-stream`.** CDNs commonly serve images without a proper `Content-Type`. `imageDownloader` accepts `application/octet-stream` as a passthrough; the route validates magic bytes (`FFD8FF` for JPEG, `89504E47` for PNG) as the authoritative format check.

3. **OCR quality on nutritional tables.** Tesseract.js was designed for natural language text. Structured tables with small fonts, borders, and numeric-only cells may produce degraded output. The `chainTextPreprocessor` for Domino's (invoked via `chainSlug: 'dominos-es'`) may need to handle OCR artifacts (e.g., `O` confused with `0`, `l` with `1`, comma/period for decimals). If `parseNutritionTable` finds 0 dishes after OCR, `NO_NUTRITIONAL_DATA_FOUND` is returned and the caller must inspect the raw OCR output via `dryRun: true` debugging.

4. **Multi-image sources.** If Domino's distributes nutritional data across multiple images (e.g., one image per category), the batch runner iterates `imageUrls` — each image is ingested independently. Dishes from later images overwrite dishes from earlier images if the name matches (upsert semantics).

5. **Tesseract.js WASM cold start.** The first OCR call in a process initializes the WASM engine (~500ms). Subsequent calls within the same process are faster. The batch runner benefits from this because all images in a run share the same process. The route timeout is 60 seconds, which covers both the cold start and typical OCR processing time.

6. **Language ambiguity.** Domino's Spain nutritional labels are in Spanish, but the column headers may include English abbreviations (e.g., "kcal", "prot", "carbs"). Tesseract `spa+eng` handles this. If OCR produces garbled Spanish characters (ñ, á, é), verify that the `spa` tessdata files are present at `TESSDATA_PREFIX`.

7. **`dryRun: true` for debugging OCR output.** Before the batch runner runs in production, the Domino's image should be OCR'd with `dryRun: true` to inspect the raw extracted lines and verify `parseNutritionTable` can parse them. If the output is unstructured, a Domino's-specific `preprocessChainText` case must be added.

8. **`chainSlug` vs no `chainSlug` for Domino's.** The batch runner passes `chainSlug: 'dominos-es'` automatically. For ad-hoc API calls without `chainSlug`, no preprocessing is applied. If the OCR output requires preprocessing to be parseable, the preprocessing is mandatory and the `notes` field must document this.

9. **Tesseract `TESSDATA_PREFIX` in production.** In development, Tesseract downloads language data from CDN on first use. In production (Docker/Railway), `TESSDATA_PREFIX` must be set to a local directory containing `spa.traineddata` and `eng.traineddata`. The implementer must add this configuration to the Docker image and environment docs.

---

## Implementation Plan

### Existing Code to Reuse

**Libraries (reuse as-is):**
- `packages/api/src/lib/ssrfGuard.ts` — `assertNotSsrf(url)` — reused unchanged in image-url route
- `packages/api/src/lib/pdfDownloader.ts` — exact streaming + size-cap pattern to replicate in `imageDownloader.ts`
- `packages/api/src/ingest/nutritionTableParser.ts` — `parseNutritionTable(lines, url, scrapedAt)` — reused unchanged
- `packages/api/src/ingest/chainTextPreprocessor.ts` — `preprocessChainText(chainSlug, lines)` — extended with `case 'dominos-es'` during Step 6

**Route pattern:**
- `packages/api/src/routes/ingest/pdf-url.ts` — complete structural template: Zod body schema, DOMAIN_CODES set, plugin options interface, pipeline Promise.race timeout, Prisma $transaction upsert loop, error re-throw guard

**Config and seed patterns:**
- `packages/api/src/config/chains/chain-pdf-registry.ts` — Zod schema + registry array pattern to replicate in `chain-image-registry.ts`
- `packages/api/src/config/chains/chain-seed-ids.ts` — extended with `DOMINOS_ES` entry following existing convention
- `packages/api/prisma/seed.ts` — `seedPhase3` pattern to replicate as `seedPhase4`
- `packages/api/src/scripts/batch-ingest.ts` — complete structural template for `batch-ingest-images.ts`

**App registration:**
- `packages/api/src/app.ts` — extended with `ingestImageUrlRoutes` registration following exact pattern of `ingestPdfUrlRoutes`

**Error handler:**
- `packages/api/src/errors/errorHandler.ts` — extended with `INVALID_IMAGE` (422) and `OCR_FAILED` (422) branches, using the same `if (asAny['code'] === '...')` pattern

**Test patterns:**
- `packages/api/src/__tests__/errorHandler.test.ts` — exact format for new error code test blocks
- `packages/api/src/__tests__/seed.phase3.integration.test.ts` — exact format for `seed.phase4.integration.test.ts`
- `packages/api/src/__tests__/f005.edge-cases.test.ts` — `buildApp` injection with mock `PrismaClient` + `app.inject()` pattern for route tests
- `packages/api/src/__tests__/f006.unit.test.ts` — pure unit test format (no mocks, no DB)

---

### Files to Create

```
packages/api/src/lib/imageDownloader.ts
  — downloadImage(url, fetchImpl?): Promise<{ buffer: Buffer; contentType: string }>
  — 30-second AbortSignal.timeout, content-type guard (image/* + octet-stream), 10 MB streaming cap
  — Mirrors pdfDownloader.ts exactly, different allow-list and size constant

packages/api/src/lib/imageOcrExtractor.ts
  — extractTextFromImage(buffer): Promise<string[]>
  — Creates Tesseract.js worker(['spa','eng']), recognize(buffer), terminates in finally
  — Wraps all Tesseract errors as { code: 'OCR_FAILED', statusCode: 422 }

packages/api/src/routes/ingest/image-url.ts
  — POST /ingest/image-url Fastify plugin
  — IngestImageUrlBodySchema (Zod), DOMAIN_CODES set, 60-second timeout
  — Full pipeline: SSRF → DB checks → downloadImage → magic bytes → OCR → preprocess → parse → normalize → persist

packages/api/src/config/chains/chain-image-registry.ts
  — ChainImageConfigSchema (Zod), ChainImageConfig type, CHAIN_IMAGE_REGISTRY array
  — Initial entry: Domino's Spain with imageUrls array (verified during implementation)

packages/api/src/scripts/batch-ingest-images.ts
  — RunImageBatchOptions, ChainImageIngestResult types
  — runImageBatch(registry, options, fetchImpl?): per-URL iteration, continue-on-failure
  — CLI entry point: parseCliArgs, printSummary, main()
  — npm script: "ingest:batch-images"

packages/api/src/__tests__/f012.imageDownloader.unit.test.ts
  — Unit tests for imageDownloader.ts using mock fetch (DI pattern)

packages/api/src/__tests__/f012.imageOcrExtractor.unit.test.ts
  — Unit tests for imageOcrExtractor.ts using mock Tesseract worker (DI pattern)

packages/api/src/__tests__/f012.imageUrl.route.test.ts
  — Route tests using buildApp + app.inject() (no real HTTP, no real DB)
  — Covers all error codes (≥ 12 test cases)

packages/api/src/__tests__/f012.batchIngestImages.unit.test.ts
  — Unit tests for runImageBatch using mock fetch (DI pattern)

packages/api/src/__tests__/seed.phase4.integration.test.ts
  — Integration test for seedPhase4 (Domino's restaurant + dataSource rows)
  — Requires foodxplorer_test DB
```

---

### Files to Modify

```
packages/api/src/errors/errorHandler.ts
  — Add INVALID_IMAGE branch: if (asAny['code'] === 'INVALID_IMAGE') → 422
  — Add OCR_FAILED branch: if (asAny['code'] === 'OCR_FAILED') → 422
  — Place both after the INVALID_PDF block (same logical group of 422 errors)
  — Add both codes to comment table in file header

packages/api/src/config/chains/chain-seed-ids.ts
  — Append DOMINOS_ES entry: RESTAURANT_ID '00000000-0000-0000-0006-000000000014', SOURCE_ID '00000000-0000-0000-0000-000000000014'
  — Follow existing indentation and as const pattern exactly

packages/api/prisma/seed.ts
  — Import CHAIN_SEED_IDS.DOMINOS_ES (already imported via CHAIN_SEED_IDS)
  — Add seedPhase4(client: PrismaClient): Promise<void> function following seedPhase3 pattern
  — Call seedPhase4(prisma) from main() after seedPhase3, with surrounding console.log
  — Export seedPhase4 (for integration test to call directly, same as seedPhase3)

packages/api/src/app.ts
  — Add import: import { ingestImageUrlRoutes } from './routes/ingest/image-url.js'
  — Register plugin: await app.register(ingestImageUrlRoutes, { prisma: prismaClient })
  — Place after ingestPdfUrlRoutes registration

packages/api/src/ingest/chainTextPreprocessor.ts
  — Add case 'dominos-es': return preprocessDominosEs(lines) to switch statement
  — Add preprocessDominosEs(lines: string[]): string[] function (implementation depends on Step 6 OCR output analysis)
  — If OCR output needs no preprocessing, case 'dominos-es': can return lines unchanged with a comment

packages/api/package.json
  — Add "ingest:batch-images": "node --import tsx/esm src/scripts/batch-ingest-images.ts" to scripts
  — Add "tesseract.js": "^5.0.0" to dependencies (not devDependencies)
```

---

### Implementation Order

**Phase 1 — Foundation (no tests yet)**

1. `packages/api/src/errors/errorHandler.ts` — Add INVALID_IMAGE and OCR_FAILED branches. This makes `mapError` ready to handle the new codes before any route exists.

2. `packages/api/src/config/chains/chain-seed-ids.ts` — Add DOMINOS_ES entry. Required by chain-image-registry.ts and seed.ts.

3. Install `tesseract.js` v5: `npm install tesseract.js@^5 -w @foodxplorer/api`. Verify it appears in `packages/api/package.json` under `dependencies`.

4. `packages/api/src/__tests__/errorHandler.test.ts` — Add test blocks for `INVALID_IMAGE` (422) and `OCR_FAILED` (422), following the exact pattern of the `INVALID_PDF` and `UNSUPPORTED_PDF` describe blocks. Run: tests should pass immediately (the branches were added in step 1).

**Phase 2 — imageDownloader (TDD)**

5. `packages/api/src/__tests__/f012.imageDownloader.unit.test.ts` — Write failing tests first (Red):
   - `downloadImage throws FETCH_FAILED on non-2xx response`
   - `downloadImage throws FETCH_FAILED on network error`
   - `downloadImage throws FETCH_FAILED when response.body is null`
   - `downloadImage throws INVALID_IMAGE when Content-Type is text/html`
   - `downloadImage throws INVALID_IMAGE when Content-Type is application/json`
   - `downloadImage accepts Content-Type image/jpeg`
   - `downloadImage accepts Content-Type image/png`
   - `downloadImage accepts Content-Type image/webp`
   - `downloadImage accepts Content-Type application/octet-stream (CDN fallback)`
   - `downloadImage throws PAYLOAD_TOO_LARGE when response exceeds 10 MB`
   - `downloadImage returns { buffer, contentType } for a valid small response`
   - `downloadImage uses AbortSignal.timeout(30_000) (fetch called with signal)`

6. `packages/api/src/lib/imageDownloader.ts` — Implement to make all tests pass (Green). Constant: `MAX_IMAGE_BYTES = 10 * 1024 * 1024`. Content-type allow-list: `image/jpeg`, `image/png`, `image/webp`, `application/octet-stream`. Follow pdfDownloader.ts structure exactly: try/catch around fetch, ok check, content-type check, body null check, reader loop with size cap, `reader.releaseLock()` in finally, `Buffer.concat(chunks)` return. Refactor if needed (Refactor).

**Phase 3 — imageOcrExtractor (TDD)**

7. `packages/api/src/__tests__/f012.imageOcrExtractor.unit.test.ts` — Write failing tests first (Red). Because `createWorker` is a module import, use `vi.mock('tesseract.js', ...)` to inject a fake worker:
   - `extractTextFromImage returns trimmed non-empty lines from recognized text`
   - `extractTextFromImage calls worker.terminate() in finally even on success`
   - `extractTextFromImage calls worker.terminate() in finally on OCR error`
   - `extractTextFromImage throws OCR_FAILED (statusCode 422) when worker.recognize throws`
   - `extractTextFromImage throws OCR_FAILED when createWorker throws`
   - `extractTextFromImage filters out empty lines from OCR output`
   - `extractTextFromImage trims whitespace from each line`

   Mock pattern for tesseract.js:
   ```
   vi.mock('tesseract.js', () => ({
     createWorker: vi.fn(),
   }));
   ```
   Each test configures the mock to return a worker object with `recognize` and `terminate` vi.fn() methods.

8. `packages/api/src/lib/imageOcrExtractor.ts` — Implement to make all tests pass (Green). Import `createWorker` from `tesseract.js`. Structure: `const worker = await createWorker(['spa', 'eng'])` inside try, `const result = await worker.recognize(buffer)`, `return result.data.text.split('\n').map(l => l.trim()).filter(l => l.length > 0)`, with `finally { await worker.terminate() }`. Wrap entire function body in try/catch; rethrow as `Object.assign(new Error('OCR extraction failed: ' + origMsg), { statusCode: 422, code: 'OCR_FAILED' })`.

**Phase 4 — image-url route (TDD)**

9. `packages/api/src/__tests__/f012.imageUrl.route.test.ts` — Write failing tests first (Red). Use `buildApp({ config: testConfig, prisma: mockPrisma })` + `app.inject()`. Mock `imageDownloader`, `imageOcrExtractor`, `ssrfGuard`, `nutritionTableParser`, `chainTextPreprocessor` using `vi.mock(...)` with `vi.hoisted` where needed. Structure: one `describe` block per error case:
   - `returns 400 VALIDATION_ERROR for missing url field`
   - `returns 400 VALIDATION_ERROR for invalid UUID restaurantId`
   - `returns 400 VALIDATION_ERROR for non-URL string in url field`
   - `returns 422 INVALID_URL when assertNotSsrf throws INVALID_URL`
   - `returns 404 NOT_FOUND when restaurantId not in DB`
   - `returns 404 NOT_FOUND when sourceId not in DB`
   - `returns 422 FETCH_FAILED when downloadImage throws FETCH_FAILED`
   - `returns 413 PAYLOAD_TOO_LARGE when downloadImage throws PAYLOAD_TOO_LARGE`
   - `returns 422 INVALID_IMAGE when magic bytes are not JPEG or PNG`
   - `returns 422 INVALID_IMAGE when downloadImage throws INVALID_IMAGE (content-type check)`
   - `returns 422 OCR_FAILED when extractTextFromImage throws OCR_FAILED`
   - `returns 422 NO_NUTRITIONAL_DATA_FOUND when parseNutritionTable returns empty array`
   - `returns 422 NO_NUTRITIONAL_DATA_FOUND when all dishes fail normalization`
   - `returns 200 with correct payload on happy path (dryRun: true, no DB write)`
   - `returns 200 and writes to DB on happy path (dryRun: false)`
   - `calls preprocessChainText when chainSlug is provided`
   - `does not call preprocessChainText when chainSlug is absent`
   - `returns 408 PROCESSING_TIMEOUT when pipeline exceeds 60 seconds (mock with delayed promise)`
   - `returns 500 DB_UNAVAILABLE when Prisma $transaction throws non-domain error`

10. `packages/api/src/routes/ingest/image-url.ts` — Implement to make all tests pass (Green). Follow pdf-url.ts structure exactly. Key differences from pdf-url:
    - Schema: `IngestImageUrlBodySchema` (url, restaurantId, sourceId, dryRun, chainSlug)
    - DOMAIN_CODES set: same as pdf-url but replace `INVALID_PDF`/`UNSUPPORTED_PDF` with `INVALID_IMAGE`/`OCR_FAILED`
    - Timeout: `30_000` in pdf-url → `60_000` in image-url (per spec)
    - Download: `downloadImage(url)` returns `{ buffer, contentType }` (not just buffer)
    - Magic bytes validation: check `buffer.subarray(0, 3)` — JPEG is `\xFF\xD8\xFF`, PNG is `\x89\x50\x4E\x47`. Use `Buffer.compare` or hex string comparison
    - OCR: `extractTextFromImage(buffer)` returns `string[]` (lines already split and trimmed)
    - No `pages.join('\n')` step — OCR output is already `string[]`
    - Plugin options interface: `IngestImageUrlPluginOptions { prisma: PrismaClient }`
    - Export: `export const ingestImageUrlRoutes = fastifyPlugin(ingestImageUrlRoutesPlugin)`

11. `packages/api/src/app.ts` — Add import and registration for `ingestImageUrlRoutes`.

**Phase 5 — Config, Seed, Batch Runner**

12. `packages/api/src/config/chains/chain-image-registry.ts` — Create with `ChainImageConfigSchema`, `ChainImageConfig` type, `CHAIN_IMAGE_REGISTRY` array. Initial entry for Domino's Spain as specified in the ticket. Use `CHAIN_SEED_IDS.DOMINOS_ES` for IDs. Note: `imageUrls` is an array — initial value is the placeholder URL from the spec, to be updated in Step 13.

13. **Domino's URL verification (manual step before batch runner test)** — Inspect `alergenos.dominospizza.es` to determine actual image URL(s). Update `imageUrls` in the Domino's registry entry. Document findings in the `notes` field. If multiple images exist (e.g. one per category), add all URLs to the array.

14. `packages/api/prisma/seed.ts` — Add `seedPhase4` function following `seedPhase3` pattern:
    - Upsert `DataSource` for Domino's: `{ id: CHAIN_SEED_IDS.DOMINOS_ES.SOURCE_ID, name: "Domino's Spain — Official Nutritional Images", type: 'scraped', url: 'https://alergenos.dominospizza.es/img/', lastUpdated: new Date('2026-03-16') }`
    - Upsert `Restaurant` for Domino's: `{ id: CHAIN_SEED_IDS.DOMINOS_ES.RESTAURANT_ID, name: "Domino's Spain", nameEs: "Domino's España", chainSlug: 'dominos-es', countryCode: 'ES', website: 'https://www.dominospizza.es', isActive: true }`
    - Export `seedPhase4` for integration tests
    - Call `seedPhase4(prisma)` from `main()` after `seedPhase3`

15. `packages/api/src/scripts/batch-ingest-images.ts` — Implement following `batch-ingest.ts` structure exactly. Key differences:
    - Import `CHAIN_IMAGE_REGISTRY` and `ChainImageConfig` from `chain-image-registry.js`
    - `runImageBatch` iterates chains, then iterates `chain.imageUrls` — one `ChainImageIngestResult` per URL (not per chain)
    - `ingestImageUrl` helper (internal): POSTs to `/ingest/image-url` with `{ url: imageUrl, restaurantId, sourceId, dryRun, chainSlug }`
    - Result type carries both `chain: ChainImageConfig` and `imageUrl: string`
    - `printSummary` logs `imageUrl` (not just `chain.chainSlug`) so URL-level failures are visible
    - npm script in `packages/api/package.json`: `"ingest:batch-images": "node --import tsx/esm src/scripts/batch-ingest-images.ts"`

**Phase 6 — Tests for Config and Batch Runner (TDD)**

16. `packages/api/src/__tests__/f012.batchIngestImages.unit.test.ts` — Write failing tests first, then implement iteratively:
    - `runImageBatch calls POST /ingest/image-url once per imageUrl in an entry`
    - `runImageBatch returns one result per imageUrl (not per chain)`
    - `runImageBatch continues after single URL failure without aborting remaining URLs`
    - `runImageBatch filters disabled chains when no chainSlug provided`
    - `runImageBatch throws when chainSlug is not found in registry`
    - `runImageBatch returns empty array for disabled chain when filtered by chainSlug`
    - `runImageBatch logs warning for concurrency > 1 and falls back to 1`
    - `result.status is "success" with dishesFound, dishesUpserted, dishesSkipped on 200 response`
    - `result.status is "error" with errorCode and errorMessage on non-2xx response`
    - `result.status is "error" with NETWORK_ERROR when fetch throws`
    - `result.status is "error" with UNEXPECTED_RESPONSE when response body is not valid JSON`

17. `packages/api/src/__tests__/seed.phase4.integration.test.ts` — Mirror `seed.phase3.integration.test.ts` exactly:
    - `beforeAll`: `cleanPhase4()` then `seedPhase4(prisma)`
    - `afterAll`: `cleanPhase4()` then `prisma.$disconnect()`
    - Tests: Domino's dataSource row (id, name, type), Domino's restaurant row (id, chainSlug, countryCode, name)
    - Idempotency test: second `seedPhase4` call completes without error
    - Row count test: exactly 1 dataSource + 1 restaurant after two calls

**Phase 7 — Domino's OCR Integration**

18. **Manual OCR dry-run** — With the server running locally and Domino's restaurant seeded, run:
    ```
    curl -X POST localhost:3001/ingest/image-url \
      -H 'Content-Type: application/json' \
      -d '{"url":"<verified-image-url>","restaurantId":"...","sourceId":"...","dryRun":true,"chainSlug":"dominos-es"}'
    ```
    Inspect the `dishes` array in the response. If `dishesFound: 0` is returned, inspect the raw OCR lines by temporarily logging them in the route and add the necessary preprocessing in `preprocessDominosEs`.

19. `packages/api/src/ingest/chainTextPreprocessor.ts` — Add `case 'dominos-es'` to the switch. If OCR output from Step 18 is already clean, the case returns `lines` unchanged. If preprocessing is needed (OCR artifacts, column structure), implement `preprocessDominosEs` following the existing preprocessor pattern with a `syntheticHeader` and line-by-line transformation.

20. **Batch runner verification** — Run `npm run ingest:batch-images -w @foodxplorer/api -- --dry-run` and verify at least 10 dishes are found per image URL.

---

### Testing Strategy

**Test files:**

| File | Type | DB? |
|------|------|-----|
| `packages/api/src/__tests__/f012.imageDownloader.unit.test.ts` | Unit | No |
| `packages/api/src/__tests__/f012.imageOcrExtractor.unit.test.ts` | Unit | No |
| `packages/api/src/__tests__/f012.imageUrl.route.test.ts` | Unit (inject) | No |
| `packages/api/src/__tests__/f012.batchIngestImages.unit.test.ts` | Unit | No |
| `packages/api/src/__tests__/seed.phase4.integration.test.ts` | Integration | Yes |
| `packages/api/src/__tests__/errorHandler.test.ts` | Unit | No (extended) |

**Mocking strategy:**

- `imageDownloader.ts` unit tests: inject mock `fetchImpl` directly (DI parameter — no `vi.mock` needed). Create mock Response objects with mock `body` ReadableStream using `ReadableStream` constructor or `new Response(...)`.

- `imageOcrExtractor.ts` unit tests: `vi.mock('tesseract.js', ...)` to replace `createWorker` with a factory returning a fake worker `{ recognize: vi.fn(), terminate: vi.fn() }`. Use `vi.hoisted` to define mock worker so it is available before imports.

- Route tests (`f012.imageUrl.route.test.ts`): mock all dependencies injected into the pipeline using `vi.mock`:
  - `vi.mock('../../lib/imageDownloader.js', ...)` — control `downloadImage` return/throw
  - `vi.mock('../../lib/imageOcrExtractor.js', ...)` — control `extractTextFromImage` return/throw
  - `vi.mock('../../lib/ssrfGuard.js', ...)` — control `assertNotSsrf` throw
  - `vi.mock('../../ingest/nutritionTableParser.js', ...)` — control `parseNutritionTable` return
  - `vi.mock('../../ingest/chainTextPreprocessor.js', ...)` — control `preprocessChainText` return
  - Mock `PrismaClient` inline: `{ restaurant: { findUnique: vi.fn() }, dataSource: { findUnique: vi.fn() }, $transaction: vi.fn() }` passed as `prisma` to `buildApp`. Reset mocks between tests with `beforeEach(() => vi.clearAllMocks())`.

- Batch runner tests (`f012.batchIngestImages.unit.test.ts`): inject mock `fetchImpl` directly (DI parameter). Create mock response objects returning JSON payloads.

- Integration tests (`seed.phase4.integration.test.ts`): real PrismaClient against `DATABASE_URL_TEST`. No mocks. Call `seedPhase4` directly (import from `seed.ts`).

**Key test scenarios to cover:**

imageDownloader:
- Happy path: 200 response with `image/jpeg` content-type, small buffer → returns `{ buffer, contentType }`
- 404 response → `FETCH_FAILED`
- Network throw (DNS failure) → `FETCH_FAILED`
- `response.body === null` → `FETCH_FAILED`
- `content-type: text/html` → `INVALID_IMAGE`
- `content-type: application/json` → `INVALID_IMAGE`
- `content-type: application/octet-stream` → passes (not INVALID_IMAGE)
- Response body exactly at 10 MB limit → accepted
- Response body > 10 MB → `PAYLOAD_TOO_LARGE` (reader cancelled)

imageOcrExtractor:
- Happy path: worker returns multi-line text with leading/trailing whitespace and empty lines → returns trimmed, non-empty lines only
- `worker.recognize` throws → `OCR_FAILED` with original message in error message
- `createWorker` throws → `OCR_FAILED`
- `worker.terminate()` called in finally on success
- `worker.terminate()` called in finally on error

Route (image-url):
- Body missing `url` → 400 `VALIDATION_ERROR`
- `restaurantId` not UUID format → 400 `VALIDATION_ERROR`
- `url` is not a valid URL string → 400 `VALIDATION_ERROR`
- `assertNotSsrf` throws `INVALID_URL` → 422 `INVALID_URL`
- `prisma.restaurant.findUnique` returns null → 404 `NOT_FOUND`
- `prisma.dataSource.findUnique` returns null → 404 `NOT_FOUND`
- `downloadImage` throws `FETCH_FAILED` → 422 `FETCH_FAILED`
- `downloadImage` throws `PAYLOAD_TOO_LARGE` → 413 `PAYLOAD_TOO_LARGE`
- Magic bytes are `0x00 0x00 0x00` (not JPEG/PNG) → 422 `INVALID_IMAGE`
- `extractTextFromImage` throws `OCR_FAILED` → 422 `OCR_FAILED`
- `parseNutritionTable` returns `[]` → 422 `NO_NUTRITIONAL_DATA_FOUND`
- All dishes fail `normalizeNutrients` → 422 `NO_NUTRITIONAL_DATA_FOUND`
- `dryRun: true` → 200, `prisma.$transaction` not called, dishes returned
- `dryRun: false` → 200, `prisma.$transaction` called, `dishesUpserted` > 0
- `chainSlug` present → `preprocessChainText` called with correct args
- `chainSlug` absent → `preprocessChainText` not called
- `prisma.$transaction` throws non-domain error → 500 `DB_UNAVAILABLE`
- Processing timeout (mock delayed `downloadImage`) → 408 `PROCESSING_TIMEOUT`

---

### Key Patterns

**DI for fetch in imageDownloader.ts and batch-ingest-images.ts:**
Mirror `pdfDownloader.ts` — second parameter `fetchImpl: typeof fetch = fetch`. Tests pass a `vi.fn()` returning a mock Response. Production code uses the default global fetch.

**DI for Tesseract worker in imageOcrExtractor.ts:**
The spec defines `extractTextFromImage(buffer: Buffer): Promise<string[]>` with no worker DI parameter. Instead, use `vi.mock('tesseract.js', ...)` to mock `createWorker` at module level. This is the standard pattern for mocking third-party module imports in Vitest.

**Magic bytes check in the route (not in imageDownloader):**
The spec explicitly places magic bytes validation in the route handler (step 6 of the pipeline), not in `imageDownloader`. This mirrors how `pdf-url.ts` checks `%PDF-` magic bytes after `downloadPdf` returns. Pattern:
```
const magic = buffer.subarray(0, 4);
const isJpeg = magic[0] === 0xFF && magic[1] === 0xD8 && magic[2] === 0xFF;
const isPng  = magic[0] === 0x89 && magic[1] === 0x50 && magic[2] === 0x4E && magic[3] === 0x47;
if (!isJpeg && !isPng) throw Object.assign(new Error('...'), { statusCode: 422, code: 'INVALID_IMAGE' });
```

**DOMAIN_CODES set in image-url route:**
Must include all codes that can legitimately arise inside the `$transaction` try/catch. Add `INVALID_IMAGE` and `OCR_FAILED` to the set. Remove `INVALID_PDF` and `UNSUPPORTED_PDF` (not thrown by OCR pipeline). Keep all others identical to pdf-url.ts.

**60-second route timeout:**
In `pdf-url.ts` the timeout is `30_000`. In `image-url.ts` it must be `60_000`. This is the only constant difference in the timeout block.

**imageUrls array iteration in batch runner:**
`batch-ingest.ts` has one result per chain. `batch-ingest-images.ts` has one result per `imageUrl` within a chain. The inner loop:
```
for (const imageUrl of chain.imageUrls) {
  const result = await ingestImageUrl(chain, imageUrl, { apiBaseUrl, dryRun }, fetchImpl);
  results.push(result);
}
```
The `printSummary` function must print `imageUrl` (truncated if long) so failures are identifiable.

**tesseract.js v5 API:**
Use `createWorker(['spa', 'eng'])` — array form, not the v4 sequence of `createWorker()` + `loadLanguage()` + `initialize()`. The `packages/api/src/lib/imageOcrExtractor.ts` Notes section documents this. Verify the API in the installed package before writing tests.

**Seed Phase 4 DataSource type:**
DataSource.type must be `'scraped'` (not `'image'` — that enum value does not exist). This matches the spec's note: "DataSource type remains 'pdf' (enum value)". However, looking at the Phase 3 seed, it uses `'scraped'` for all chain data sources. Use `'scraped'` for Domino's too.

**Module import path convention:**
All imports within `packages/api/src/` use `.js` extension (TypeScript + ESM Node16 resolution). Example: `import { downloadImage } from '../../lib/imageDownloader.js'`. The batch runner import: `import { CHAIN_IMAGE_REGISTRY } from '../config/chains/chain-image-registry.js'`.

**Test file naming:**
Prefix all new test files with `f012.` to match the feature ticket. Unit tests: `f012.<module>.unit.test.ts`. Route tests: `f012.imageUrl.route.test.ts`. Batch runner: `f012.batchIngestImages.unit.test.ts`. Seed integration: `seed.phase4.integration.test.ts` (follows existing pattern without f0xx prefix).

**Domino's preprocessor (Phase 6 — add only after observing real OCR output):**
Do not implement `preprocessDominosEs` speculatively. First run OCR on the real image with `dryRun: true` (Step 18). If `parseNutritionTable` already handles the raw OCR output, the `case 'dominos-es'` can simply be `return lines`. If preprocessing is needed, implement it following the `preprocessTelepizzaEs` pattern (inject synthetic header, transform data rows). Document any OCR artifact corrections (e.g. `O→0`, `l→1`) as inline comments.

---

## Acceptance Criteria

- [ ] `POST /ingest/image-url` with a valid Domino's image URL returns HTTP 200 with ≥ 10 dishes found
- [ ] `POST /ingest/image-url` with `dryRun: true` returns dishes without writing to DB
- [ ] `POST /ingest/image-url` with a private IP URL returns HTTP 422 `INVALID_URL`
- [ ] `POST /ingest/image-url` with a non-image URL returns HTTP 422 `INVALID_IMAGE`
- [ ] `POST /ingest/image-url` with image > 10 MB returns HTTP 413 `PAYLOAD_TOO_LARGE`
- [ ] `POST /ingest/image-url` with invalid restaurantId format returns HTTP 400 `VALIDATION_ERROR`
- [ ] `POST /ingest/image-url` with non-existent restaurantId returns HTTP 404 `NOT_FOUND`
- [ ] `extractTextFromImage(buffer)` returns non-empty `string[]` for valid JPEG fixture
- [ ] `extractTextFromImage(buffer)` throws `OCR_FAILED` when Tesseract throws
- [ ] `downloadImage(url)` throws `PAYLOAD_TOO_LARGE` for mock response > 10 MB
- [ ] `downloadImage(url)` throws `INVALID_IMAGE` when Content-Type is `text/html`
- [ ] `runImageBatch` calls `POST /ingest/image-url` once per `imageUrl` and returns one result per URL
- [ ] `runImageBatch` continues after single URL failure without aborting remaining URLs
- [ ] Unit tests cover all error code paths for the route (≥ 12 test cases)
- [ ] All tests pass
- [ ] Build succeeds
- [ ] Specs updated (`api-spec.yaml`)

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Unit tests written and passing
- [ ] Code follows project standards
- [ ] No linting errors
- [ ] Build succeeds
- [ ] Specs reflect final implementation

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated
- [x] Step 1: Branch created, ticket generated, tracker updated
- [ ] Step 2: `backend-planner` executed, plan approved
- [ ] Step 3: `backend-developer` executed with TDD
- [ ] Step 4: `production-code-validator` executed, quality gates pass
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 5: `qa-engineer` executed (Standard)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-16 | Step 0: Spec created | api-spec.yaml updated, ticket drafted by spec-creator |
| 2026-03-16 | Step 1: Setup | Branch feature/F012-image-ocr-ingestion, ticket finalized |

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

*Ticket created: 2026-03-16*

---

## Notes

- Tesseract.js v5 changed the API significantly from v4. Use `createWorker(langs)` (array) — not the old `createWorker()` + `loadLanguage()` + `initialize()` sequence.
- The `tesseract.js` npm package bundles the WASM binary. No separate `@tesseract.js/worker` install needed in Node.js.
- If Domino's nutritional images are very low resolution or use unusual fonts, OCR accuracy will be degraded. In that case, consider using `psm: 6` (assume uniform block of text) or `psm: 4` (assume single column) as a Tesseract PSM hint — document any such tuning in the implementation.
- The `chainTextPreprocessor.ts` switch statement gets a new `case 'dominos-es':` entry once the OCR output format is understood during implementation Step 1.
- Batch runner for images uses `imageUrl` as the result key (not just `chain`), because a chain can have multiple image URLs — logging must show which specific URL failed or succeeded.
