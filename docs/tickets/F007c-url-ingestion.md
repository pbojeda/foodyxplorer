# F007c: URL Ingestion Endpoint (POST /ingest/url)

**Feature:** F007c | **Type:** Backend-Feature | **Priority:** High
**Status:** Pending | **Branch:** feature/F007c-url-ingestion (to be created)
**Created:** 2026-03-12 | **Dependencies:** F007 complete (scraper scaffold, normalizeNutrients + normalizeDish), F007b complete (nutritionTableParser reuse)

---

## Spec

### Description

F007c adds `POST /ingest/url` to `packages/api`. The endpoint accepts a JSON body with a URL, `restaurantId`, `sourceId`, and optional `dryRun` flag. It fetches the page using Crawlee/Playwright (to handle JS-rendered pages and basic anti-bot mitigations), extracts visible text from the HTML using `node-html-parser` (table-aware DOM traversal), parses nutritional tables through the existing `parseNutritionTable` heuristic parser (unchanged from F007b), normalizes results through `normalizeNutrients` / `normalizeDish` from `@foodxplorer/scraper`, and persists via Prisma upsert.

Key differences from F007b (PDF):
- Input is a JSON body (not multipart) — no file upload involved.
- Fetching uses Crawlee/Playwright instead of `pdf-parse` — handles JavaScript rendering.
- HTML-to-text extraction replaces PDF text extraction — produces the same flat `string[]` that `parseNutritionTable` already consumes.
- `sourceUrl` on `RawDishData` is the submitted URL directly (a real HTTP URL, no synthetic `pdf://` URI needed).
- Response includes a `sourceUrl` field echoing the fetched URL back to the caller.

Parsing is deterministic and heuristic-based — no LLM is used (cost constraint: <0.05€/query, ADR-001).
Phase 1: text-based HTML pages only — nutritional data rendered in canvas/SVG/images is not supported.

Full specification: `docs/specs/F007c-url-ingestion-spec.md`

---

### Architecture Decisions

**Thin `htmlFetcher` wrapper around Crawlee — not `BaseScraper`**

`BaseScraper` is designed for multi-page crawl sessions (start URLs → menu URL queue → extract loop) and requires a full `ScraperConfig`. For a single-page API endpoint, this is the wrong abstraction. `htmlFetcher` uses `PlaywrightCrawler` directly for a single URL, headless, with the same anti-bot defaults (viewport 1280×800, `Accept-Language: es-ES`). This isolates the fetch complexity without coupling to chain-specific infrastructure.

**`node-html-parser` for HTML-to-text conversion**

Pure Node.js, no native binaries. The key requirement is table-aware extraction: `<tr>` rows are emitted as tab-separated cell text so that `parseNutritionTable`'s column-position detection works correctly. Block-level elements outside tables are emitted one per line. `<script>`, `<style>`, `<nav>`, `<footer>`, `<header>`, `<aside>` are excluded.

**Reuse `parseNutritionTable` unchanged**

F007b's heuristic parser already operates on `string[]` lines — it has no knowledge of whether those lines came from a PDF or an HTML page. This is the intended extension point. No modification to `nutritionTableParser.ts` is required.

**JSON body (not multipart)**

There is no file to upload. A plain JSON body is simpler, avoids multipart overhead, and allows `dryRun` to be a native boolean (not a string transform as in F007b).

**SSRF guard**

URL sanity check rejects private/loopback addresses (localhost, 127.x.x.x, 10.x.x.x, 192.168.x.x, 169.254.x.x) with `422 INVALID_URL`. This is a minimal SSRF defence for Phase 1 — sufficient for an internal admin endpoint.

**Synchronous processing, 30-second timeout**

Same constraint as F007b: `Promise.race` + `clearTimeout`. Crawlee Playwright fetch for a single well-behaved page completes in 2–10 seconds. Anti-bot pages with long delays are caught by the timeout.

---

### File Structure

New files:

```
packages/api/src/
├── routes/ingest/
│   └── url.ts                          # POST /ingest/url route plugin
└── lib/
    ├── htmlFetcher.ts                  # Crawlee/Playwright fetch: fetchHtml(url) → string (outerHTML)
    └── htmlTextExtractor.ts            # DOM→text: extractTextFromHtml(html) → string[]

packages/api/src/__tests__/
├── routes/ingest/
│   └── url.test.ts                     # Integration tests (buildApp + inject, vi.mock htmlFetcher)
└── lib/
    ├── htmlFetcher.test.ts             # Unit tests (crawlerFactory DI mock)
    └── htmlTextExtractor.test.ts       # Unit tests (HTML string fixtures)

packages/api/src/__tests__/fixtures/html/
├── sample-nutrition-table.html         # 10-dish synthetic nutritional table
├── multi-section-table.html            # Two <table> sections (starters + mains)
├── empty.html                          # <html><body></body></html>
└── no-nutrients.html                   # HTML with text but no nutritional table
```

Modified files:

| File | Change |
|---|---|
| `packages/api/src/app.ts` | Register `ingestUrlRoutes` (one new `app.register` call) |
| `packages/api/src/errors/errorHandler.ts` | Add `INVALID_URL`, `FETCH_FAILED`, `SCRAPER_BLOCKED` to `mapError` |
| `packages/api/package.json` | Add `node-html-parser`, `crawlee`, `playwright` as runtime dependencies |
| `docs/specs/api-spec.yaml` | Add `POST /ingest/url` path and `IngestUrlBody`, `IngestUrlResult`, `IngestUrlSkippedReason`, `IngestUrlResponse` schemas |

---

### API Endpoints

#### `POST /ingest/url`

**Request body** (`application/json`):

```json
{
  "url": "https://www.mcdonalds.es/es/conoce/nuestra-comida/informacion-nutricional.html",
  "restaurantId": "00000000-0000-0000-0000-000000000001",
  "sourceId":     "00000000-0000-0000-0000-000000000002",
  "dryRun":       false
}
```

**Success response** (`200 application/json`):

```json
{
  "success": true,
  "data": {
    "dishesFound":    32,
    "dishesUpserted": 30,
    "dishesSkipped":   2,
    "dryRun":         false,
    "sourceUrl":      "https://www.mcdonalds.es/es/conoce/nuestra-comida/informacion-nutricional.html",
    "dishes":         [ /* NormalizedDish[] */ ],
    "skippedReasons": [ { "dishName": "Bebida", "reason": "Missing required field: proteins" } ]
  }
}
```

**Error responses:**

| HTTP | code | Trigger |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing fields, invalid UUID, invalid URL string |
| 404 | `NOT_FOUND` | `restaurantId` or `sourceId` not in DB |
| 408 | `PROCESSING_TIMEOUT` | Processing exceeds 30 seconds |
| 422 | `INVALID_URL` | Non-http/https scheme or private/loopback address |
| 422 | `FETCH_FAILED` | Network error, DNS failure, non-2xx HTTP response |
| 422 | `SCRAPER_BLOCKED` | HTTP 403 or 429 from target server |
| 422 | `NO_NUTRITIONAL_DATA_FOUND` | No parseable table in fetched HTML, or all rows fail normalization |
| 500 | `DB_UNAVAILABLE` | Prisma write failure |

---

### Swagger / OpenAPI

Endpoint documented under the `Ingestion` tag in `docs/specs/api-spec.yaml`. New schemas: `IngestUrlBody`, `IngestUrlResult`, `IngestUrlSkippedReason`, `IngestUrlResponse`. Reuses existing `NormalizedDish` schema.

---

### Error Handling

Three new error codes must be added to `mapError` in `packages/api/src/errors/errorHandler.ts`:

| code | HTTP | Description |
|---|---|---|
| `INVALID_URL` | 422 | URL scheme or address is not allowed |
| `FETCH_FAILED` | 422 | Network error or non-2xx HTTP response fetching the URL |
| `SCRAPER_BLOCKED` | 422 | Target server returned HTTP 403 or 429 |

All existing error codes (`VALIDATION_ERROR`, `NOT_FOUND`, `NO_NUTRITIONAL_DATA_FOUND`, `PROCESSING_TIMEOUT`, `DB_UNAVAILABLE`) apply unchanged.

---

### New Dependencies

| Package | Placement | Reason |
|---|---|---|
| `node-html-parser` | `packages/api` runtime | Pure-Node HTML DOM parsing for text extraction |
| `crawlee` | `packages/api` runtime | `PlaywrightCrawler` for JS-rendered page fetching |
| `playwright` | `packages/api` runtime (peer) | Browser engine used by Crawlee |

Note: `crawlee` and `playwright` are already dependencies of `packages/scraper`. They must be declared separately in `packages/api/package.json` — npm workspaces do not share runtime dependencies between packages.

---

### Zod Schemas

Defined in `packages/api/src/routes/ingest/url.ts` (API-internal — NOT added to `packages/shared`):

```
IngestUrlBodySchema = z.object({
  url          : z.string().url().max(2048),
  restaurantId : z.string().uuid(),
  sourceId     : z.string().uuid(),
  dryRun       : z.boolean().default(false),
})

IngestUrlSkippedReasonSchema = z.object({
  dishName  : z.string(),
  reason    : z.string(),
})

IngestUrlResultSchema = z.object({
  dishesFound    : z.number().int().nonnegative(),
  dishesUpserted : z.number().int().nonnegative(),
  dishesSkipped  : z.number().int().nonnegative(),
  dryRun         : z.boolean(),
  sourceUrl      : z.string().url(),
  dishes         : z.array(NormalizedDishDataSchema),
  skippedReasons : z.array(IngestUrlSkippedReasonSchema),
})
```

---

### Edge Cases

| Scenario | Expected behaviour |
|---|---|
| URL uses `file://` scheme | `422 INVALID_URL` |
| URL is `http://localhost/` | `422 INVALID_URL` (SSRF guard) |
| URL is `http://169.254.169.254/` | `422 INVALID_URL` (SSRF guard — link-local) |
| URL redirects (301/302) | Playwright follows redirects; final page HTML used |
| Page returns 200 but `<body>` is empty | `422 NO_NUTRITIONAL_DATA_FOUND` |
| Page loads JS, nutritional table behind login | Table not rendered → `422 NO_NUTRITIONAL_DATA_FOUND` |
| `<table>` with `<thead>` + `<tbody>` | Processed in document order — header detected, rows parsed |
| Nutrient value uses comma decimal (`1,5`) | `extractTextFromHtml` normalizes to `1.5` before parsing |
| Multiple `<table>` sections on one page | All tables extracted; `parseNutritionTable` resets per header |
| Same dish name twice (different portions) | Last-write-wins on `(restaurantId, name)` — accepted Phase 1 |
| `dryRun: true` + non-existent `restaurantId` | `404 NOT_FOUND` — DB check runs regardless of `dryRun` |
| Page responds slowly (anti-bot JS challenge) | `408 PROCESSING_TIMEOUT` if > 30 seconds |
| All dishes fail normalization | `422 NO_NUTRITIONAL_DATA_FOUND` |

---

### Acceptance Criteria

- [ ] `POST /ingest/url` with a valid URL pointing to an HTML page with a Spanish nutritional table returns `200` with at least 1 dish upserted
- [ ] `dryRun: true` returns `200` with `dishesUpserted: 0` and no DB writes
- [ ] Missing `url` field returns `400 VALIDATION_ERROR`
- [ ] `url` is not a valid URL string → `400 VALIDATION_ERROR`
- [ ] `url` with `file://` scheme → `422 INVALID_URL`
- [ ] `url` resolving to `localhost` / private IP → `422 INVALID_URL`
- [ ] Non-existent `restaurantId` → `404 NOT_FOUND`
- [ ] Non-existent `sourceId` → `404 NOT_FOUND`
- [ ] `fetchHtml` failure (mocked) → `422 FETCH_FAILED`
- [ ] `fetchHtml` HTTP 403 (mocked) → `422 SCRAPER_BLOCKED`
- [ ] Page with no extractable text → `422 NO_NUTRITIONAL_DATA_FOUND`
- [ ] Page with text but no nutritional table → `422 NO_NUTRITIONAL_DATA_FOUND`
- [ ] Partial success: `200`, `dishesSkipped > 0`, non-empty `skippedReasons`
- [ ] Response `data.sourceUrl` matches the submitted URL
- [ ] `tsc --noEmit` passes across all packages
- [ ] `vitest run` passes — all tests green
- [ ] Endpoint documented in `docs/specs/api-spec.yaml` under `Ingestion` tag
- [ ] TypeScript strict mode — no `any`, no `ts-ignore`
- [ ] `htmlTextExtractor` correctly extracts tab-separated table rows (unit tests)
- [ ] `INVALID_URL`, `FETCH_FAILED`, `SCRAPER_BLOCKED` registered in `errorHandler.ts`
- [ ] Salt/sodium derivation exercised in URL pipeline integration test

---

### Definition of Done

- [ ] All acceptance criteria above are met
- [ ] No regressions in existing tests (`POST /ingest/pdf`, `GET /health`)
- [ ] Feature branch merged to `develop` via squash PR
- [ ] `docs/project_notes/product-tracker.md` updated: F007c status → `done`, step → `6/6`
- [ ] Completion log entry added with commit hash and test count delta

---

## Notes

- `nutritionTableParser.ts` requires NO changes — the `string[]` input contract is the same whether the lines came from a PDF or from an HTML page.
- `app.ts` change is minimal: one `await app.register(ingestUrlRoutes, { prisma: prismaClient })` call, no new global middleware.
- The `@fastify/multipart` plugin already registered in `app.ts` for F007b does not interfere with JSON body routes — Fastify handles content-type routing automatically.
- Crawlee writes a `storage/` directory at the project root by default. Set `CRAWLEE_STORAGE_DIR` to a temp path in the API process to avoid polluting the repo. Consider adding `storage/` to `.gitignore` if not already present.
- If Playwright browser binaries are not installed in the deployment environment, `htmlFetcher` will throw at startup. The CI/CD pipeline must run `playwright install chromium` (or the equivalent Crawlee setup step) before running the API or its tests.

---

## Implementation Plan

### Existing Code to Reuse

| Asset | Location | How it is reused |
|---|---|---|
| `parseNutritionTable` | `packages/api/src/ingest/nutritionTableParser.ts` | Called unchanged with `(lines: string[], sourceUrl: string, scrapedAt: string)`. The function is agnostic to whether lines came from a PDF or an HTML page. |
| `normalizeNutrients` | `packages/scraper/src/utils/normalize.ts` (re-exported via `@foodxplorer/scraper`) | Identical call: `normalizeNutrients(raw.nutrients)`. |
| `normalizeDish` | `packages/scraper/src/utils/normalize.ts` (re-exported via `@foodxplorer/scraper`) | Identical call: `normalizeDish(raw, { sourceId, restaurantId })`. |
| `NormalizedDishDataSchema` | `packages/scraper/src/base/types.ts` (re-exported via `@foodxplorer/scraper`) | Identical `.safeParse(merged)` call for per-dish validation. |
| `registerErrorHandler` / `mapError` | `packages/api/src/errors/errorHandler.ts` | Extended with three new error codes; no structural change. |
| `ingestPdfRoutes` pattern | `packages/api/src/routes/ingest/pdf.ts` | Template for plugin structure, `Promise.race` timeout guard, DB existence checks, upsert loop, response shape. |
| `pdf.test.ts` pattern | `packages/api/src/__tests__/routes/ingest/pdf.test.ts` | Template for `buildApp()` + `inject()` integration tests, `vi.mock` approach, `beforeAll`/`afterAll` DB fixture setup, `afterEach` DB cleanup. |
| `pdfParser.ts` pattern | `packages/api/src/lib/pdfParser.ts` | Thin wrapper pattern to follow for `htmlFetcher.ts`. |
| `BaseScraper.createCrawler` | `packages/scraper/src/base/BaseScraper.ts` | Reference for `PlaywrightCrawler` constructor options (headless, viewport, `Accept-Language`, `requestHandlerTimeoutSecs`). NOT extended — `htmlFetcher` uses `PlaywrightCrawler` directly. |
| `fastifyPlugin` | `fastify-plugin` (already in `packages/api` deps) | Same wrapping pattern as `ingestPdfRoutes`. |
| `buildApp` / test Prisma setup | `packages/api/src/app.ts`, `packages/api/src/__tests__/routes/ingest/pdf.test.ts` | `buildApp({ prisma })` factory reused; test Prisma UUID namespacing pattern reused. |

---

### Files to Create

#### Production code

| File | Purpose |
|---|---|
| `packages/api/src/lib/htmlFetcher.ts` | Thin `PlaywrightCrawler` wrapper. Exports `fetchHtml(url: string, crawlerFactory?: CrawlerFactory): Promise<string>`. Launches a single-URL headless Playwright crawl and returns `document.documentElement.outerHTML`. Maps Crawlee failure modes to typed domain errors (`FETCH_FAILED`, `SCRAPER_BLOCKED`). The optional `crawlerFactory` parameter enables test-time DI to inject a mock crawler without launching a real browser. |
| `packages/api/src/lib/htmlTextExtractor.ts` | Pure DOM-to-text converter. Exports `extractTextFromHtml(html: string): string[]`. Parses the HTML string with `node-html-parser`, strips noise elements (`<script>`, `<style>`, `<nav>`, `<footer>`, `<header>`, `<aside>`, `<noscript>`), emits `<tr>` rows as tab-separated cell text, and emits block-level elements as individual lines. Normalizes comma decimal separators (`1,5` → `1.5`). Returns a flat `string[]` ready for `parseNutritionTable`. |
| `packages/api/src/routes/ingest/url.ts` | Fastify route plugin. Exports `ingestUrlRoutes`. Registers `POST /ingest/url`. Defines `IngestUrlBodySchema`, `IngestUrlSkippedReasonSchema`, `IngestUrlResultSchema`. Owns the full processing pipeline: JSON body parse → URL sanity check (scheme + SSRF) → DB existence checks → 30-second `Promise.race` timeout guard → `fetchHtml` → `extractTextFromHtml` → `parseNutritionTable` → `normalizeNutrients` + `normalizeDish` + `NormalizedDishDataSchema.safeParse` → Prisma upsert → response with `sourceUrl`. |

#### Test fixtures

| File | Purpose |
|---|---|
| `packages/api/src/__tests__/fixtures/html/sample-nutrition-table.html` | Minimal HTML page with a single `<table>` containing Spanish nutrient headers (`Calorías`, `Proteínas`, `Hidratos`, `Grasas`, `Azúcares`, `Fibra`, `Sal`) in `<thead>` and 10 dish data rows in `<tbody>`. Comma decimal separators in some cells. Happy-path fixture for both `htmlTextExtractor` unit tests and `url.test.ts` integration tests. |
| `packages/api/src/__tests__/fixtures/html/multi-section-table.html` | HTML page with two separate `<table>` elements (e.g. "Entrantes" then "Principales"), each with a valid header row and 4–5 data rows. Tests that all tables are extracted in document order. |
| `packages/api/src/__tests__/fixtures/html/empty.html` | `<html><body></body></html>` — no text content. `extractTextFromHtml` should return `[]`. |
| `packages/api/src/__tests__/fixtures/html/no-nutrients.html` | HTML page with `<p>` paragraph text but no `<table>` and no lines containing 3+ nutrient keywords. `extractTextFromHtml` returns non-empty lines; `parseNutritionTable` returns `[]`. |

#### Test files

| File | Purpose |
|---|---|
| `packages/api/src/__tests__/lib/htmlTextExtractor.test.ts` | Pure unit tests for `extractTextFromHtml`. No mocks needed — inputs are HTML strings (inline or loaded from `fixtures/html/`). All extraction rules, noise exclusion, comma normalisation, empty-page handling. |
| `packages/api/src/__tests__/lib/htmlFetcher.test.ts` | Unit tests for `fetchHtml`. Injects a mock `crawlerFactory` to avoid launching a real browser. Tests: successful fetch returns HTML string; `failedRequestHandler` invocation throws `FETCH_FAILED`; HTTP 403 throws `SCRAPER_BLOCKED`. |
| `packages/api/src/__tests__/routes/ingest/url.test.ts` | Integration tests using `buildApp()` + `inject()`. Mocks `htmlFetcher.fetchHtml` via `vi.mock`. Uses real test DB (`DATABASE_URL_TEST`) for DB existence checks and upsert verification. Covers all 15 acceptance-criteria scenarios (see Implementation Order step I-9). |

---

### Files to Modify

| File | Change |
|---|---|
| `packages/api/package.json` | Add runtime dependencies: `node-html-parser`, `crawlee`, `playwright`. Match versions already in `packages/scraper/package.json` (`crawlee: ^3.0.0`, `playwright: ^1.40.0`). No devDependency changes needed — types are bundled with these packages. |
| `packages/api/src/app.ts` | Add one import: `import { ingestUrlRoutes } from './routes/ingest/url.js'`. Add one registration call after `ingestPdfRoutes`: `await app.register(ingestUrlRoutes, { prisma: prismaClient })`. No new global middleware. |
| `packages/api/src/errors/errorHandler.ts` | Add three `mapError` branches following the existing `Object.assign` pattern: `INVALID_URL` → 422, `FETCH_FAILED` → 422, `SCRAPER_BLOCKED` → 422. Insert before the generic 404 fallthrough block, after the existing 422-family codes. Also update the `DOMAIN_CODES` set comment reference inside `url.ts` (the set is local to each route handler — copy the pattern from `pdf.ts`). |
| `docs/specs/api-spec.yaml` | Already fully written (the `/ingest/url` path, `IngestUrlBody`, `IngestUrlResult`, `IngestUrlSkippedReason`, `IngestUrlResponse` schemas are all present). No changes required unless the developer finds gaps during implementation. |

---

### Implementation Order

Follow TDD discipline: write failing tests before implementing each module. Follow DDD layer order within each step.

**I-1 — Install dependencies and verify TypeScript config**

Files: `packages/api/package.json`

- Add `node-html-parser`, `crawlee`, `playwright` to `dependencies` in `packages/api/package.json`. Use the same version constraints as `packages/scraper/package.json` (`crawlee: ^3.0.0`, `playwright: ^1.40.0`). For `node-html-parser` use the latest stable (`^5.0.0` range).
- Run `npm install` from the monorepo root to install the new packages.
- `packages/api/tsconfig.json` already has the `@foodxplorer/scraper` path alias and project reference (added during F007b). No tsconfig changes needed.
- Verify: `tsc --noEmit -p packages/api/tsconfig.json` still passes after adding deps (no new code yet).
- Add `CRAWLEE_STORAGE_DIR` usage note: in `htmlFetcher.ts` the implementation should set `process.env['CRAWLEE_STORAGE_DIR']` to `os.tmpdir()` before constructing the crawler instance, or pass `storageDir` in Crawlee's `Configuration` to avoid writing a `storage/` directory to the repo root. Confirm `storage/` is in `.gitignore` (add it if absent).

**I-2 — Write HTML test fixtures**

Files: `packages/api/src/__tests__/fixtures/html/*.html` (4 files)

Create all four `.html` fixture files. Content guidelines:

- `sample-nutrition-table.html`: Full HTML skeleton (`<!DOCTYPE html><html><head><title>...</title></head><body>...</body></html>`). One `<table>` with `<thead>` containing a `<tr>` with `<th>` cells for at least 5 Spanish nutrient keywords (`Calorías`, `Proteínas`, `Hidratos`, `Grasas`, `Sal`). `<tbody>` with 10 `<tr>` rows of dish data — dish name in first `<td>`, then numeric cells with comma decimal separators in at least 3 values (e.g. `32,5`). Include a `<nav>` block and a `<footer>` with text that should be excluded from extraction output.
- `multi-section-table.html`: Two `<table>` elements, each with a header row containing Spanish keywords. First table: 4 rows. Second table: 4 rows. A `<h2>` heading between the two tables. Both tables should be extractable.
- `empty.html`: `<!DOCTYPE html><html><head></head><body></body></html>`.
- `no-nutrients.html`: A page with a few `<p>` paragraphs of Spanish restaurant description text. No `<table>` elements. No line should contain 3+ nutrient keywords.

**I-3 — Write failing unit tests for `htmlTextExtractor`**

File: `packages/api/src/__tests__/lib/htmlTextExtractor.test.ts`

Write all tests BEFORE implementing the extractor. Tests import `extractTextFromHtml` from `'../../../lib/htmlTextExtractor.js'` (will fail to resolve — file does not exist yet).

Test scenarios:

- **Simple table extraction**: Pass a minimal `<table>` with one header row and two data rows. Assert result includes tab-separated lines like `"Calorías\tProteínas\tGrasas"`. Assert result lines count equals 3 (header + 2 data rows).
- **Multiple tables in document order**: Load `multi-section-table.html`. Assert the result contains lines from both tables, with the first table's rows appearing before the second table's rows.
- **`<script>` and `<style>` excluded**: HTML with inline `<script>alert('x')</script>` and `<style>body{color:red}</style>`. Assert neither `alert` nor `body{color:red}` appears in any result line.
- **`<nav>`, `<footer>`, `<header>`, `<aside>` excluded**: HTML with text inside each of those elements that does not appear inside a table. Assert those text values are absent from output.
- **Block-level elements emitted as lines**: HTML with `<p>Hola mundo</p><div>Otro texto</div>`. Assert both strings appear as separate lines in output.
- **Empty body**: Load `empty.html`. Assert result is `[]`.
- **Comma decimal normalisation**: `<td>1,5</td><td>2,3</td>` in a `<tr>`. Assert output line contains `"1.5\t2.3"` (dots, not commas).
- **`<thead>` and `<tbody>` in document order**: A table with `<thead>` header row followed by `<tbody>` data rows. Assert header row appears first, then data rows — confirming document-order traversal.
- **Whitespace-only lines stripped**: A `<tr>` containing cells with only spaces. Assert no whitespace-only line appears in output.

**I-4 — Implement `htmlTextExtractor.ts`**

File: `packages/api/src/lib/htmlTextExtractor.ts`

Implement to make I-3 tests pass. Structure:

```
import { parse } from 'node-html-parser';

const NOISE_TAGS = new Set(['script', 'style', 'noscript', 'nav', 'footer', 'header', 'aside']);
const BLOCK_TAGS = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article']);

export function extractTextFromHtml(html: string): string[]
```

Implementation rules:
1. Parse with `parse(html, { lowerCaseTagName: true })`.
2. Remove all `NOISE_TAGS` elements from the root before any traversal (call `.remove()` on each matched node).
3. Find all `<table>` elements via `.querySelectorAll('table')`. For each table: find all `<tr>` elements (in document order via `.querySelectorAll('tr')`). For each `<tr>`: collect `.querySelectorAll('td, th')`, map to `.innerText.trim()`, join with `'\t'`. Push the joined line (skip if whitespace-only after joining).
4. For non-table block content: find all elements matching `BLOCK_TAGS` that are NOT descendants of a `<table>`. Extract `.innerText.trim()`. Push non-empty lines.
5. Ordering: Process the root's children in document order. For each child: if it is or contains a `<table>`, emit table rows (step 3). Otherwise if it is a block element, emit its text (step 4). This preserves reading order.
6. Comma normalisation: after building each line, apply a replace on tokens that look numeric: `line.replace(/\b(\d+),(\d+)\b/g, '$1.$2')`.
7. Strip empty or whitespace-only lines at the end: `lines.filter(l => l.trim().length > 0)`.
8. Return the `string[]`.

No `any` types. `node-html-parser`'s `HTMLElement` is the return type of `parse()` and `querySelectorAll()`.

**I-5 — Write failing unit tests for `htmlFetcher`**

File: `packages/api/src/__tests__/lib/htmlFetcher.test.ts`

Write tests BEFORE implementing the fetcher. Tests import `fetchHtml` from `'../../../lib/htmlFetcher.js'`.

The `crawlerFactory` optional parameter is the DI seam. Tests pass a factory function that returns a mock object shaped like a `PlaywrightCrawler`:

```typescript
const mockCrawler = {
  run: vi.fn(),
};
const mockFactory = vi.fn().mockReturnValue(mockCrawler);
```

Test scenarios:

- **Successful fetch**: `mockCrawler.run` is configured to call the `requestHandler` with a mock Playwright page whose `evaluate()` resolves to `'<html>...</html>'`. Assert `fetchHtml('https://example.com', mockFactory)` resolves with that HTML string.
- **`failedRequestHandler` called**: `mockCrawler.run` is configured to call the `failedRequestHandler` instead of the `requestHandler`. Assert `fetchHtml(...)` rejects with an error where `error.code === 'FETCH_FAILED'`.
- **HTTP 403 response**: `mockCrawler.run` calls `failedRequestHandler` with an error message containing `'403'`. Assert rejects with `error.code === 'SCRAPER_BLOCKED'`.
- **HTTP 429 response**: Same as 403 but with `'429'` in error message. Assert rejects with `error.code === 'SCRAPER_BLOCKED'`.

Note: Tests use the `crawlerFactory` injection seam — they do NOT call the default `PlaywrightCrawler` constructor. The mock must replicate only the `{ run(requests): Promise<void> }` interface.

**I-6 — Implement `htmlFetcher.ts`**

File: `packages/api/src/lib/htmlFetcher.ts`

Implement to make I-5 tests pass. Signature:

```typescript
import { PlaywrightCrawler } from 'crawlee';
import type { RequestHandler, FailedRequestHandler } from 'crawlee';

type CrawlerFactory = (
  requestHandler: RequestHandler,
  failedRequestHandler: FailedRequestHandler,
) => Pick<PlaywrightCrawler, 'run'>;

export async function fetchHtml(
  url: string,
  crawlerFactory?: CrawlerFactory,
): Promise<string>
```

Implementation:

1. Before constructing the crawler, set `process.env['CRAWLEE_STORAGE_DIR'] ??= tmpdir()` (import `tmpdir` from `'os'`) to prevent Crawlee writing to the repo root.
2. Use a shared `let html: string | undefined` variable and a `let crawlerError: Error | undefined` variable captured in the closure.
3. Define `requestHandler`: receives Crawlee's `{ page, request }` context. Extract `html = await page.evaluate(() => document.documentElement.outerHTML)`.
4. Define `failedRequestHandler`: receives `{ error }`. Inspect `error.message` for `'403'` or `'429'` — if found set `crawlerError = Object.assign(new Error('Access blocked'), { code: 'SCRAPER_BLOCKED', statusCode: 422 })`. Otherwise set `crawlerError = Object.assign(new Error('Fetch failed'), { code: 'FETCH_FAILED', statusCode: 422 })`.
5. Call `crawlerFactory` if provided, otherwise construct a `new PlaywrightCrawler({ ... })` with:
   - `launchContext.launchOptions.headless: true`
   - `launchContext.launchOptions.args: ['--lang=es-ES']`
   - `preNavigationHooks`: set viewport 1280×800, set `Accept-Language: es-ES,es;q=0.9` header
   - `requestHandlerTimeoutSecs: 25` (5-second headroom before the outer 30-second route timeout)
   - `maxConcurrency: 1`, `maxRequestsPerMinute: 60`, `maxRequestRetries: 1`
6. Call `await crawler.run([{ url }])`.
7. After `run()` completes: if `crawlerError` is set, throw it. If `html` is `undefined`, throw `Object.assign(new Error('Fetch failed: no HTML captured'), { code: 'FETCH_FAILED', statusCode: 422 })`.
8. Return `html`.

No `any` types. Import Crawlee types directly from `'crawlee'`.

**I-7 — Update `errorHandler.ts` (write errorHandler tests first)**

Files: `packages/api/src/__tests__/errors/errorHandler.test.ts` (extend existing), `packages/api/src/errors/errorHandler.ts`

First extend the existing errorHandler tests (if file exists) or create `errorHandler.test.ts` with cases for the three new codes:

```typescript
it('INVALID_URL → 422', () => {
  const err = Object.assign(new Error('msg'), { code: 'INVALID_URL' });
  const result = mapError(err);
  expect(result.statusCode).toBe(422);
  expect(result.body.error.code).toBe('INVALID_URL');
});
// Repeat for FETCH_FAILED → 422, SCRAPER_BLOCKED → 422
```

Then add three branches to `mapError` in `errorHandler.ts`:

```typescript
if (asAny['code'] === 'INVALID_URL') {
  return { statusCode: 422, body: { success: false, error: { message: error.message, code: 'INVALID_URL' } } };
}
if (asAny['code'] === 'FETCH_FAILED') {
  return { statusCode: 422, body: { success: false, error: { message: error.message, code: 'FETCH_FAILED' } } };
}
if (asAny['code'] === 'SCRAPER_BLOCKED') {
  return { statusCode: 422, body: { success: false, error: { message: error.message, code: 'SCRAPER_BLOCKED' } } };
}
```

Insert these three blocks after the existing `NO_NUTRITIONAL_DATA_FOUND` block and before the `PROCESSING_TIMEOUT` block.

**I-8 — Register `ingestUrlRoutes` in `app.ts`**

File: `packages/api/src/app.ts`

Add one import and one registration line:

```typescript
import { ingestUrlRoutes } from './routes/ingest/url.js';
// ...
await app.register(ingestUrlRoutes, { prisma: prismaClient });
```

Position: after the existing `await app.register(ingestPdfRoutes, { prisma: prismaClient })` line. No new global middleware, no changes to plugin registration order.

**I-9 — Write failing integration tests for `POST /ingest/url`**

File: `packages/api/src/__tests__/routes/ingest/url.test.ts`

Write ALL tests BEFORE implementing the route. Mock at module level:

```typescript
vi.mock('../../../lib/htmlFetcher.js', () => ({
  fetchHtml: vi.fn(),
}));
import { fetchHtml } from '../../../lib/htmlFetcher.js';
const mockFetchHtml = fetchHtml as ReturnType<typeof vi.fn>;
```

`beforeAll`: Pre-cleanup then create test fixtures using deterministic UUIDs in the `e100` namespace (distinct from `e000` used by `pdf.test.ts`):

```typescript
const TEST_RESTAURANT_ID = 'e1000000-0000-4000-a000-000000000001';
const TEST_SOURCE_ID     = 'e1000000-0000-4000-a000-000000000002';
const NONEXISTENT_ID     = 'f1000000-0000-4000-a000-000000000099';
```

`afterEach`: `mockFetchHtml.mockReset()` + delete `dishNutrient` and `dish` rows for `TEST_RESTAURANT_ID`.
`afterAll`: Reverse FK order cleanup (dishNutrient → dish → restaurant, dataSource) + `prisma.$disconnect()` + `app.close()`.

Helper: `function loadFixtureHtml(filename: string): string` reads from `fixtures/html/` using `readFileSync` + `fileURLToPath(import.meta.url)`.

Test scenarios (each as a separate `it()`):

1. **Happy path — Spanish table, live run → 200**: `mockFetchHtml` resolves with `loadFixtureHtml('sample-nutrition-table.html')`. POST JSON `{ url: 'https://example.com/menu', restaurantId: TEST_RESTAURANT_ID, sourceId: TEST_SOURCE_ID }`. Assert `statusCode === 200`, `body.success === true`, `body.data.dishesFound >= 1`, `body.data.dishesUpserted >= 1`, `body.data.dryRun === false`, `body.data.sourceUrl === 'https://example.com/menu'`. Verify at least one `dish` row in DB with the correct `restaurantId`.

2. **`dryRun: true` — no DB writes → 200**: Same fixture, body includes `dryRun: true`. Assert `dishesUpserted === 0`, `dryRun === true`. Query DB to confirm zero `dish` rows for `TEST_RESTAURANT_ID`.

3. **Missing `url` field → 400 VALIDATION_ERROR**: POST `{ restaurantId: TEST_RESTAURANT_ID, sourceId: TEST_SOURCE_ID }` (no `url`). Assert `statusCode === 400`, `body.error.code === 'VALIDATION_ERROR'`.

4. **`url` is not a valid URL string → 400 VALIDATION_ERROR**: POST `{ url: 'not-a-url', restaurantId: ..., sourceId: ... }`. Assert `statusCode === 400`, `code === 'VALIDATION_ERROR'`.

5. **`url` with `file://` scheme → 422 INVALID_URL**: POST `{ url: 'file:///etc/passwd', ... }`. Assert `statusCode === 422`, `code === 'INVALID_URL'`.

6. **`url` resolving to `localhost` → 422 INVALID_URL**: POST `{ url: 'http://localhost/menu', ... }`. Assert `statusCode === 422`, `code === 'INVALID_URL'`.

7. **`url` resolving to `127.0.0.1` → 422 INVALID_URL**: POST `{ url: 'http://127.0.0.1/menu', ... }`. Same assertion.

8. **`url` resolving to link-local `169.254.169.254` → 422 INVALID_URL**: POST `{ url: 'http://169.254.169.254/', ... }`. Same assertion.

9. **Non-existent `restaurantId` → 404 NOT_FOUND**: `mockFetchHtml` will NOT be called (DB check runs first). Assert `statusCode === 404`, `code === 'NOT_FOUND'`.

10. **Non-existent `sourceId` → 404 NOT_FOUND**: Valid `restaurantId`, nonexistent `sourceId`. Assert `statusCode === 404`, `code === 'NOT_FOUND'`.

11. **`fetchHtml` throws `FETCH_FAILED` → 422**: `mockFetchHtml.mockRejectedValue(Object.assign(new Error('fetch failed'), { code: 'FETCH_FAILED', statusCode: 422 }))`. Assert `statusCode === 422`, `code === 'FETCH_FAILED'`.

12. **`fetchHtml` throws `SCRAPER_BLOCKED` → 422**: `mockFetchHtml.mockRejectedValue(Object.assign(new Error('blocked'), { code: 'SCRAPER_BLOCKED', statusCode: 422 }))`. Assert `statusCode === 422`, `code === 'SCRAPER_BLOCKED'`.

13. **Page with no extractable text → 422 NO_NUTRITIONAL_DATA_FOUND**: `mockFetchHtml.mockResolvedValue(loadFixtureHtml('empty.html'))`. Assert `statusCode === 422`, `code === 'NO_NUTRITIONAL_DATA_FOUND'`.

14. **Page text has no nutritional table → 422 NO_NUTRITIONAL_DATA_FOUND**: `mockFetchHtml.mockResolvedValue(loadFixtureHtml('no-nutrients.html'))`. Assert `statusCode === 422`, `code === 'NO_NUTRITIONAL_DATA_FOUND'`.

15. **Partial success — some dishes skipped → 200 with `skippedReasons`**: `mockFetchHtml` resolves with inline HTML containing one valid dish row and one row with only 2 numeric tokens (fails parser minimum). Assert `statusCode === 200`, `body.data.dishesSkipped >= 1`, `body.data.skippedReasons` is a non-empty array with `dishName` and `reason` on each entry.

16. **`dryRun: true` with nonexistent `restaurantId` → 404**: DB check runs regardless of `dryRun`. Assert `statusCode === 404`.

17. **Salt/sodium derivation → sodium derived from salt**: `mockFetchHtml` resolves with inline HTML table with `Calorías Proteínas Hidratos Grasas Sal` header and one dish row. POST with `dryRun: true`. Assert `body.data.dishes[0].nutrients.sodium > 0` and `nutrients.sodium` is approximately `salt * 400` (derivation: `sodium_mg = salt_g / 2.5 * 1000`).

**I-10 — Implement `routes/ingest/url.ts`**

File: `packages/api/src/routes/ingest/url.ts`

Implement to make I-9 tests pass. Follow `pdf.ts` structure exactly, adapting for JSON body and URL pipeline.

Structure:

```typescript
interface IngestUrlPluginOptions { prisma: PrismaClient }

const SSRF_BLOCKED = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+)$/i;
const DOMAIN_CODES = new Set(['VALIDATION_ERROR','NOT_FOUND','INVALID_URL','FETCH_FAILED','SCRAPER_BLOCKED','NO_NUTRITIONAL_DATA_FOUND','PROCESSING_TIMEOUT']);

const ingestUrlRoutesPlugin: FastifyPluginAsync<IngestUrlPluginOptions> = async (app, opts) => {
  app.post('/ingest/url', async (request, reply) => { ... });
};
export const ingestUrlRoutes = fastifyPlugin(ingestUrlRoutesPlugin);
```

Handler implementation sequence:

1. **Parse JSON body**: `IngestUrlBodySchema.safeParse(request.body)`. If `.success === false`, throw `parseResult.error` (a `ZodError` — error handler maps it to 400).

2. **URL sanity check** (scheme + SSRF):
   - `const parsed = new URL(url)` — safe because Zod already validated it is a URL.
   - If `parsed.protocol !== 'http:' && parsed.protocol !== 'https:'`: throw `Object.assign(new Error('URL must use http or https scheme'), { statusCode: 422, code: 'INVALID_URL' })`.
   - If `SSRF_BLOCKED.test(parsed.hostname)`: throw `Object.assign(new Error('URL targets a private or loopback address'), { statusCode: 422, code: 'INVALID_URL' })`.

3. **DB existence checks** (same as `pdf.ts`): `prisma.restaurant.findUnique` + `prisma.dataSource.findUnique`, both throwing `NOT_FOUND` if null.

4. **30-second `Promise.race` timeout guard**: Same pattern as `pdf.ts` — `Promise.race([processingPromise(), timeoutPromise])` with `clearTimeout` in `finally`.

5. **Inside `processingPromise()`**:
   a. `const html = await fetchHtml(url)` — throws `FETCH_FAILED` or `SCRAPER_BLOCKED` on network/HTTP errors.
   b. `const lines = extractTextFromHtml(html)` — returns `string[]`.
   c. If `lines.length === 0`: throw `NO_NUTRITIONAL_DATA_FOUND`.
   d. `const rawDishes = parseNutritionTable(lines, url, new Date().toISOString())` — `url` is the real HTTP URL, no synthetic `pdf://` prefix.
   e. If `rawDishes.length === 0`: throw `NO_NUTRITIONAL_DATA_FOUND`.
   f. Normalization loop (identical to `pdf.ts`): `normalizeNutrients` → `normalizeDish` → `NormalizedDishDataSchema.safeParse` → collect `validDishes` and `skippedReasons`.
   g. If `validDishes.length === 0`: throw `NO_NUTRITIONAL_DATA_FOUND`.
   h. Prisma upsert loop (identical to `pdf.ts`, `dryRun` guard) in a `try/catch` that rethrows domain codes and wraps Prisma errors as `DB_UNAVAILABLE`.
   i. Return `{ dishesFound: rawDishes.length, dishesUpserted, dishesSkipped: skippedReasons.length, dryRun, sourceUrl: url, dishes: validDishes, skippedReasons }`.

6. **Reply**: `return reply.status(200).send({ success: true, data: result })`.

Key constraints:
- Import `fetchHtml` from `'../../lib/htmlFetcher.js'` (not inline) — this is the `vi.mock` target.
- Import `extractTextFromHtml` from `'../../lib/htmlTextExtractor.js'`.
- Import `parseNutritionTable` from `'../../ingest/nutritionTableParser.js'`.
- `dryRun` is a native boolean (not a string transform) — the body is JSON, not multipart.
- No `any` types.

**I-11 — Run full test suite and type-check**

- `npm run typecheck -w @foodxplorer/api` — must pass with zero errors.
- `npm run test -w @foodxplorer/api` — all tests green (existing F007b tests must not regress).
- Confirm `GET /health`, `POST /ingest/pdf` existing tests still pass.

---

### Testing Strategy

#### Unit tests — `htmlTextExtractor.test.ts`

- **No mocks needed** — `extractTextFromHtml` is a pure synchronous function.
- **Fixture loading**: use `readFileSync` to load `.html` fixtures, pass the string directly. Also use inline HTML strings for targeted edge-case tests (comma normalisation, `<thead>`/`<tbody>` ordering, whitespace stripping).
- **Coverage target**: table extraction, multi-table ordering, noise-tag exclusion, block-element emission, empty-body handling, comma normalisation, whitespace stripping.

#### Unit tests — `htmlFetcher.test.ts`

- **Mock strategy**: inject a `crawlerFactory` that returns a mock `{ run: vi.fn() }` object. The `run` mock drives the request/failed handler callbacks synchronously.
- **No real Playwright launched** — tests run in < 1 second and are suitable for CI without browser binaries.
- **Coverage target**: successful HTML capture, `FETCH_FAILED` path, `SCRAPER_BLOCKED` on 403, `SCRAPER_BLOCKED` on 429.

#### errorHandler extension — `errorHandler.test.ts`

- Add three new `it()` cases to the existing `describe('mapError')` block.
- Pattern: `Object.assign(new Error('msg'), { code: 'INVALID_URL' })` → assert `{ statusCode: 422, body.error.code: 'INVALID_URL' }`. Repeat for `FETCH_FAILED` and `SCRAPER_BLOCKED`.
- Write tests BEFORE modifying `errorHandler.ts`.

#### Integration tests — `url.test.ts`

- **Mock strategy**: `vi.mock('../../../lib/htmlFetcher.js')` at the top of the file (before all imports). `htmlTextExtractor` is NOT mocked — it is a pure function and runs on the fixture HTML strings returned by the `fetchHtml` mock.
- **Real DB**: uses `DATABASE_URL_TEST`. `beforeAll` creates a Restaurant and DataSource row. `afterAll` deletes in reverse FK order.
- **UUID namespace**: use `e100` namespace (`e1000000-...`) to avoid collision with `pdf.test.ts` which uses `e000` namespace (`e0000000-...`).
- **Test isolation**: `afterEach` resets the mock and deletes `dishNutrient` + `dish` rows for `TEST_RESTAURANT_ID`.
- **JSON body injection**: simpler than multipart. `app.inject({ method: 'POST', url: '/ingest/url', headers: { 'content-type': 'application/json' }, payload: JSON.stringify(body) })`.
- **SSRF tests do NOT need the mock** to be set up — the handler rejects before calling `fetchHtml`.
- **DB existence tests** (scenarios 9, 10, 16) do NOT need `fetchHtml` to be configured — the handler rejects before calling it.

---

### Key Patterns

#### Error throw pattern (from `pdf.ts`)

```typescript
throw Object.assign(
  new Error('Descriptive message'),
  { statusCode: 422, code: 'INVALID_URL' },
);
```

All new error codes (`INVALID_URL`, `FETCH_FAILED`, `SCRAPER_BLOCKED`) must be registered in `mapError` before they will produce the correct HTTP status. The route's `DOMAIN_CODES` set (used in the Prisma `catch` block to re-throw domain errors) must include all three new codes in addition to the existing ones from `pdf.ts`.

#### Fastify plugin pattern (from `pdf.ts` and `health.ts`)

```typescript
const plugin: FastifyPluginAsync<Options> = async (app, opts) => { ... };
export const ingestUrlRoutes = fastifyPlugin(plugin);
```

`fastifyPlugin` is required to ensure the route registers on the root scope where the error handler is attached.

#### JSON body parsing in Fastify (differs from multipart in `pdf.ts`)

Fastify automatically parses `application/json` bodies into `request.body`. Do NOT iterate `request.parts()`. Simply access `request.body` and run it through `IngestUrlBodySchema.safeParse()`. No `@fastify/multipart` involvement.

#### `vi.mock` path rule

The mock path must match the import path used in the source file being tested. Since `url.ts` imports `fetchHtml` from `'../../lib/htmlFetcher.js'`, the mock in `url.test.ts` (which is at `src/__tests__/routes/ingest/url.test.ts`) must be: `vi.mock('../../../lib/htmlFetcher.js', ...)`. Verify the relative depth carefully.

#### SSRF guard implementation

Use `new URL(url).hostname` to extract the hostname after Zod has already validated the URL format. Test against the regex `SSRF_BLOCKED`. This catches `localhost`, `127.x.x.x`, `10.x.x.x`, `192.168.x.x`, and `169.254.x.x` (AWS metadata / link-local). Scheme check (`http:` or `https:`) must run BEFORE the SSRF check.

#### `noUncheckedIndexedAccess` gotcha (from `backend-standards.mdc` / `tsconfig.base.json`)

Array element access `arr[i]` returns `T | undefined`. This affects the `skippedReasons` array access in partial-success test assertions and any column-position lookup inside `nutritionTableParser` (already written). Add null guards or use optional chaining when accessing array elements by index in new code.

#### Crawlee `CRAWLEE_STORAGE_DIR` gotcha

Crawlee writes a `storage/` directory at the current working directory by default. Set `process.env['CRAWLEE_STORAGE_DIR'] ??= tmpdir()` at the top of `htmlFetcher.ts` (import `tmpdir` from `'os'`) to redirect this to a temp path. Alternatively pass a `Configuration` object to `PlaywrightCrawler`. Without this, running tests or the API creates a `storage/` directory in the repo root. Confirm `storage/` is in `.gitignore`.

#### `sourceUrl` difference from `pdf.ts`

In `pdf.ts`, `sourceUrl` is a synthetic `pdf://filename` URI (no real HTTP URL exists for the file). In `url.ts`, `sourceUrl` is the raw `url` field from the request body — a real `http(s)://` URL. Pass it directly to `parseNutritionTable` as the third argument and echo it back in `data.sourceUrl` in the response.

#### Fixture HTML must produce parseable lines after extraction

`sample-nutrition-table.html` must contain a `<table>` with Spanish keyword headers that `parseNutritionTable` can detect (3+ keywords on one `<tr>` line, joined by tabs). After `extractTextFromHtml` runs, the header `<tr>` must produce a tab-separated line like `"Calorías\tProteínas\tHidratos\tGrasas\tSal"`. Verify this during fixture creation by mentally tracing the extraction rules.
