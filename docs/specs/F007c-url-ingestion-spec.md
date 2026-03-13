# F007c — URL Ingestion Endpoint (POST /ingest/url)

**Feature:** F007c | **Type:** Backend-Feature | **Priority:** High
**Status:** Pending | **Epic:** E002 — Data Ingestion Pipeline
**Created:** 2026-03-12 | **Dependencies:** F007 complete (scraper scaffold), F007b complete (heuristic nutritionTableParser)

---

## 1. Purpose

F007c adds `POST /ingest/url` to `packages/api`. The endpoint accepts a URL (plus `restaurantId`, `sourceId`, and optional `dryRun`), fetches the page's HTML using Crawlee/Playwright (to handle JavaScript-rendered pages and basic anti-bot mitigations), extracts visible text from the HTML, runs that text through the existing `parseNutritionTable` heuristic parser from F007b, normalizes results through `normalizeNutrients` / `normalizeDish` from `@foodxplorer/scraper`, and persists the resulting dishes to the database via Prisma upsert.

The primary targets are:
- Spanish restaurant chain nutritional information pages (tables with dish names and nutrient columns)
- Any publicly accessible URL whose content follows a tabular nutritional layout (same structure targeted by F007b)

---

## 2. Scope Boundaries

**In scope:**
- `POST /ingest/url` Fastify route in `packages/api`
- HTML fetching via a dedicated `htmlFetcher` module (Crawlee/Playwright, single-page fetch)
- Text extraction from HTML via a `htmlTextExtractor` module (DOM-to-text conversion using `node-html-parser`)
- Reuse of `parseNutritionTable` from `packages/api/src/ingest/nutritionTableParser.ts` (unchanged from F007b)
- Reuse of `normalizeNutrients` and `normalizeDish` from `packages/scraper`
- Persistence via Prisma (same findFirst + create/update pattern as F007b)
- OpenAPI documentation under the existing `Ingestion` tag
- New error codes: `INVALID_URL`, `FETCH_FAILED`, `SCRAPER_BLOCKED` (see §10)

**Out of scope:**
- Crawling multiple pages (only the single submitted URL is fetched)
- Following pagination or sitemap links (deferred to chain scrapers F008–F017)
- Image-based page content / OCR of graphical nutritional charts (Phase 1: text-based HTML only)
- LLM-based parsing (cost constraint, see §3.2)
- Async / background processing (synchronous for Phase 1)
- Admin UI or webhook notifications
- F008–F017 chain scrapers (separate features)

---

## 3. Architectural Decisions

### 3.1 Fetching strategy: lightweight Crawlee/Playwright single-page fetch (not BaseScraper)

**Decision:** Use a thin `htmlFetcher` wrapper around Crawlee's `PlaywrightCrawler` that fetches exactly one URL and returns the page's outer HTML. Do NOT extend `BaseScraper`.

**Rationale:**

`BaseScraper` is designed for multi-page crawl sessions (start URLs → menu URLs → extract loop). It is too heavy for a single-page fetch:
- It requires a `ScraperConfig` with `chainSlug`, `startUrls`, `rateLimit`, `retryPolicy`, `selectors`, `restaurantId`, `sourceId`, which do not map cleanly onto a one-shot API endpoint.
- It manages a Crawlee request queue and two crawl phases; both are unnecessary for a single URL.
- Its `persist()` method is a stub (throws `NotImplementedError`) — chain scrapers override it. For the API endpoint, persistence is handled directly by the route handler (same pattern as F007b).

The `htmlFetcher` module uses Crawlee's `PlaywrightCrawler` directly with a single-URL run, headless by default, with the same anti-bot settings as `BaseScraper` (viewport 1280×800, `Accept-Language: es-ES`). This gives us JS rendering and basic anti-bot mitigations without coupling to `BaseScraper`.

**Consequence:** `htmlFetcher` is a new module in `packages/api/src/lib/htmlFetcher.ts`. It is not part of `packages/scraper` — the scraper package remains for chain-specific subclasses and the normalization pipeline.

### 3.2 Text parsing strategy: reuse `parseNutritionTable` (no LLM)

**Decision:** Extract visible text from the fetched HTML and pass it to the existing `parseNutritionTable` function from `packages/api/src/ingest/nutritionTableParser.ts`. No changes to the parser.

**Rationale:**

`parseNutritionTable` is already designed for plain text lines — it was written with this reuse in mind (the normalize.ts file explicitly notes it is "forward-compatible so that F007b (PDF) and F007c (URL ingest) can reuse the same pipeline without modification"). The key requirement is transforming HTML into the same flat line array the parser already expects.

The cost constraint (<0.05€/query) and ADR-001 ("the LLM NEVER calculates nutritional values") prohibit LLM-based parsing regardless of page structure complexity.

**HTML-to-text strategy:** Use `node-html-parser` (pure Node.js, no native binaries) to parse the HTML DOM, then walk the document tree to extract visible text, respecting table structure:
1. For `<table>` elements: extract cell text row by row, joining cells in each row with `\t` (tab), then joining rows with `\n`. This preserves the column alignment that `parseNutritionTable` relies on.
2. For non-table content: extract text from block-level elements (`<p>`, `<div>`, `<section>`, `<h1>`–`<h6>`, `<li>`), one block per line.
3. Exclude: `<script>`, `<style>`, `<nav>`, `<footer>`, `<header>`, `<aside>`, `<noscript>`.

This produces a flat `string[]` compatible with `parseNutritionTable`'s expectations. Table row extraction preserves the left-to-right column order needed for nutrient column mapping.

**Phase 1 limitation:** Text-only HTML pages. Pages that render nutritional data exclusively in `<canvas>`, SVG, or image elements will yield no parseable text — the endpoint returns `422 NO_NUTRITIONAL_DATA_FOUND`. OCR deferred to a future feature.

### 3.3 `sourceUrl` on `RawDishData`: the submitted URL directly

**Decision:** Set `sourceUrl` on each `RawDishData` to the URL submitted in the request body (validated and normalized).

**Rationale:** Unlike PDF ingestion (where there is no HTTP URL and a synthetic `pdf://` URI was necessary), the URL submitted here is a real HTTP(S) URL. Using it directly satisfies `RawDishDataSchema`'s `z.string().url()` constraint and provides meaningful source traceability in addition to `sourceId`.

### 3.4 Persistence: same findFirst + create/update Prisma pattern as F007b

No new patterns. The route handler executes the same `$transaction` block with `dish.findFirst` + conditional create/update and `dishNutrient.findFirst` + conditional create/update.

Upsert key: `(restaurantId, name)` — same as F007b. PDFs and URLs share the same upsert logic.

### 3.5 Synchronous processing for Phase 1

The endpoint is synchronous within the HTTP request/response cycle. A 30-second hard timeout is enforced via `Promise.race` + `clearTimeout`, same as F007b.

Crawlee's Playwright fetch for a single page typically completes in 2–10 seconds for well-behaved pages. Anti-bot pages that trigger long waits will be caught by the timeout.

### 3.6 Request body: JSON (not multipart)

**Decision:** `POST /ingest/url` uses `application/json`, not `multipart/form-data`.

**Rationale:** There is no file to upload. A clean JSON body avoids the multipart overhead and keeps the schema simple. The existing `@fastify/multipart` registration in `app.ts` is not needed for this route.

---

## 4. File Structure

```
packages/api/src/
├── routes/
│   └── ingest/
│       └── url.ts                  # POST /ingest/url route plugin
└── lib/
    └── htmlFetcher.ts              # Crawlee/Playwright single-page fetch: fetchHtml(url) → string
    └── htmlTextExtractor.ts        # node-html-parser DOM→text: extractText(html) → string[]
```

```
packages/api/src/__tests__/
└── routes/
    └── ingest/
        └── url.test.ts             # Integration tests (buildApp + inject)
└── lib/
    └── htmlFetcher.test.ts         # Unit tests for htmlFetcher (mock PlaywrightCrawler)
    └── htmlTextExtractor.test.ts   # Unit tests for htmlTextExtractor (string fixtures)
```

```
packages/api/src/__tests__/fixtures/html/
├── sample-nutrition-table.html     # Minimal HTML page with a nutritional table (10 dishes)
├── multi-section-table.html        # Two <table> sections
├── empty.html                      # HTML page with no text content
└── no-nutrients.html               # HTML page with text but no nutritional table
```

---

## 5. Request Schema

### 5.1 JSON body

The endpoint accepts `application/json`:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `url` | string | Yes | Must be a valid `http://` or `https://` URL. Maximum length: 2048 characters. |
| `restaurantId` | string (UUID) | Yes | Must match an existing `restaurants.id` row. |
| `sourceId` | string (UUID) | Yes | Must match an existing `data_sources.id` row. |
| `dryRun` | boolean | No | Default: `false`. When `true`, runs fetch, extraction, and normalization but skips DB writes. Returns parsed dishes for inspection. |

**Zod schema:**

```
IngestUrlBodySchema = z.object({
  url          : z.string().url().max(2048),
  restaurantId : z.string().uuid(),
  sourceId     : z.string().uuid(),
  dryRun       : z.boolean().default(false),
})
```

Unlike F007b, `dryRun` is a native boolean (not a string transform), because the body is JSON not multipart.

### 5.2 URL validation

After Zod validation, the handler additionally checks:
1. URL scheme is `http` or `https` — other schemes (e.g. `file://`, `ftp://`) are rejected with `422 INVALID_URL`.
2. URL is not a private/loopback address (e.g. `localhost`, `127.0.0.1`, `192.168.x.x`, `10.x.x.x`) — rejected with `422 INVALID_URL`. This is a server-side request forgery (SSRF) guard for Phase 1.

---

## 6. Processing Pipeline

```
[POST /ingest/url]
     │
     │  JSON body received
     │
     ▼
[IngestUrlBodySchema.safeParse()]     ← Zod validation (url, restaurantId, sourceId, dryRun)
     │  validation failure → 400 VALIDATION_ERROR
     │
     ▼
[URL sanity check]
     │  non-http/https scheme → 422 INVALID_URL
     │  private/loopback address → 422 INVALID_URL
     │
     ▼
[DB existence checks]                 ← prisma.restaurant.findUnique + prisma.dataSource.findUnique
     │  restaurant not found → 404 NOT_FOUND
     │  dataSource not found → 404 NOT_FOUND
     │
     ▼
[30-second timeout guard]             ← Promise.race wrapper
     │
     ▼
[htmlFetcher.fetchHtml(url)]          ← packages/api/src/lib/htmlFetcher.ts
     │  Crawlee PlaywrightCrawler, single URL, headless
     │  fetch failure / DNS error → 422 FETCH_FAILED
     │  anti-bot / 403/429 detected → 422 SCRAPER_BLOCKED
     │
     ▼
[htmlTextExtractor.extractText(html)] ← packages/api/src/lib/htmlTextExtractor.ts
     │  node-html-parser DOM traversal, table-aware
     │  empty result → 422 NO_NUTRITIONAL_DATA_FOUND
     │
     ▼
[parseNutritionTable(lines, sourceUrl, scrapedAt)]
     │                                ← packages/api/src/ingest/nutritionTableParser.ts (unchanged from F007b)
     │  zero dishes → 422 NO_NUTRITIONAL_DATA_FOUND
     │
     ▼
[normalizeNutrients() + normalizeDish()]   ← @foodxplorer/scraper
     │
     │  Invalid dishes → collected in `dishesSkipped` (not fatal)
     │
     ▼
[NormalizedDishDataSchema.safeParse()]
     │
     ▼
[Prisma upsert — if dryRun === false]
     │
     │  dishes + dish_nutrients tables
     │  upsert on (restaurantId, name)
     │
     ▼
[Response]
```

---

## 7. `htmlFetcher` Module Specification

### 7.1 Signature

```typescript
// packages/api/src/lib/htmlFetcher.ts

export async function fetchHtml(url: string): Promise<string>
```

Returns the full outer HTML of the page (`document.documentElement.outerHTML`) after JavaScript rendering completes.

### 7.2 Crawlee configuration

- `PlaywrightCrawler` with one request only (the submitted URL)
- `launchOptions.headless: true`
- `launchOptions.args: ['--lang=es-ES']`
- `preNavigationHook`: set viewport 1280×800, `Accept-Language: es-ES,es;q=0.9`
- `requestHandlerTimeoutSecs: 25` (leaves headroom for the outer 30-second route timeout)
- `maxConcurrency: 1`, `maxRequestsPerMinute: 60` (single URL, no rate limit concern)
- `maxRequestRetries: 1` (one retry; the outer timeout will terminate if both attempts are slow)

### 7.3 Error mapping

| Crawlee/Playwright condition | Mapped error |
|---|---|
| DNS resolution failure, connection refused, network timeout | `FETCH_FAILED` (422) |
| HTTP response 403 or 429 | `SCRAPER_BLOCKED` (422) |
| HTTP response 4xx other than 403/429 | `FETCH_FAILED` (422) |
| HTTP response 5xx | `FETCH_FAILED` (422) |
| `failedRequestHandler` called by Crawlee | `FETCH_FAILED` (422) |

The fetcher catches all Crawlee errors and re-throws them with the appropriate domain code so the route handler's global error guard handles them correctly.

### 7.4 Testability

`fetchHtml` accepts an optional second parameter for dependency injection in tests:

```typescript
export async function fetchHtml(
  url: string,
  crawlerFactory?: (handler: RequestHandler, failedHandler: FailedRequestHandler) => PlaywrightCrawler,
): Promise<string>
```

Tests override `crawlerFactory` to return a mock that immediately resolves with a fixture HTML string, avoiding real Playwright launches.

---

## 8. `htmlTextExtractor` Module Specification

### 8.1 Signature

```typescript
// packages/api/src/lib/htmlTextExtractor.ts

export function extractTextFromHtml(html: string): string[]
```

Returns an array of text lines extracted from the HTML. The caller passes this array directly to `parseNutritionTable(lines, sourceUrl, scrapedAt)`.

### 8.2 Extraction rules

1. Parse the HTML string using `node-html-parser` (`parse(html, { lowerCaseTagName: true })`).
2. Remove all `<script>`, `<style>`, `<noscript>` nodes.
3. Remove structural noise elements: `<nav>`, `<footer>`, `<header>`, `<aside>`.
4. For each `<table>` found in the remaining DOM:
   a. For each `<tr>`: collect the text content of each `<td>` / `<th>` cell (`.innerText`, trimmed), join with `\t`.
   b. Emit each `<tr>` as one line.
5. For non-table content: collect text from block-level elements (`<p>`, `<div>`, `<li>`, `<h1>`–`<h6>`, `<section>`, `<article>`), one element per line (`.innerText`, trimmed).
6. Strip lines that are empty or whitespace-only.
7. Return the resulting `string[]`.

**Ordering:** Tables are processed in document order relative to other block elements — the output preserves the top-to-bottom reading order of the page.

**Comma normalization:** `extractTextFromHtml` replaces `,` with `.` within numeric-looking tokens (e.g. `"1,5"` → `"1.5"`) before returning lines, consistent with the comma-decimal handling already in `parseDataRow` within `nutritionTableParser.ts`. This avoids depending on `parseDataRow`'s regex to handle both separators, and keeps `extractTextFromHtml` as a clean pre-processing step.

### 8.3 `node-html-parser` dependency

`node-html-parser` is a pure Node.js HTML parser with no native binaries. It is added as a runtime dependency of `packages/api`. It is the lightest suitable library for server-side HTML text extraction — `cheerio` would also work but carries a larger dependency tree; `jsdom` is too heavy for this use case.

---

## 9. Response Schema

### 9.1 Success (200)

```
IngestUrlResponseSchema = z.object({
  success          : z.literal(true),
  data: z.object({
    dishesFound    : z.number().int().nonnegative(),
    dishesUpserted : z.number().int().nonnegative(),
    dishesSkipped  : z.number().int().nonnegative(),
    dryRun         : z.boolean(),
    sourceUrl      : z.string().url(),
      // The URL that was fetched (echoed back for traceability)
    dishes         : z.array(NormalizedDishDataSchema),
    skippedReasons : z.array(z.object({
      dishName  : z.string(),
      reason    : z.string(),
    })),
  }),
})
```

The response adds `sourceUrl` (the fetched URL) to the data payload compared to F007b's response. This is the one structural difference — it aids traceability when callers ingest multiple URLs in sequence.

### 9.2 Example response

```json
{
  "success": true,
  "data": {
    "dishesFound": 32,
    "dishesUpserted": 30,
    "dishesSkipped": 2,
    "dryRun": false,
    "sourceUrl": "https://www.mcdonalds.es/es/conoce/nuestra-comida/informacion-nutricional.html",
    "dishes": [
      {
        "name": "Big Mac",
        "nameEs": null,
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
      { "dishName": "Bebida", "reason": "Missing required field: proteins" }
    ]
  }
}
```

---

## 10. Normalization Rules (inherited from F007 / F007b)

All normalization rules from F007b are inherited unchanged.

| Rule | Detail |
|---|---|
| `confidenceLevel` | Always `'medium'` |
| `estimationMethod` | `'scraped'` |
| `referenceBasis` | Always `'per_serving'` (ADR-004) |
| `sourceUrl` on `RawDishData` | Set to the submitted URL (a real HTTP URL, no synthetic URI needed) |
| `scrapedAt` on `RawDishData` | Set to `new Date().toISOString()` at request time |

---

## 11. Error Handling

All errors follow the existing error envelope: `{ success: false, error: { message, code, details? } }`.

New error codes introduced by F007c:

| Scenario | HTTP | code |
|---|---|---|
| `url` fails Zod `.url()` validation | 400 | `VALIDATION_ERROR` |
| `restaurantId` or `sourceId` missing / not UUID | 400 | `VALIDATION_ERROR` |
| URL scheme is not `http` or `https` | 422 | `INVALID_URL` |
| URL resolves to a private/loopback address (SSRF guard) | 422 | `INVALID_URL` |
| `restaurantId` not found in DB | 404 | `NOT_FOUND` |
| `sourceId` not found in DB | 404 | `NOT_FOUND` |
| Network error, DNS failure, non-2xx HTTP response | 422 | `FETCH_FAILED` |
| Page returned HTTP 403 or 429 (anti-bot) | 422 | `SCRAPER_BLOCKED` |
| Page fetched but HTML yields no extractable text | 422 | `NO_NUTRITIONAL_DATA_FOUND` |
| HTML text contains no detectable nutritional table | 422 | `NO_NUTRITIONAL_DATA_FOUND` |
| All parsed dishes fail normalization | 422 | `NO_NUTRITIONAL_DATA_FOUND` |
| Processing exceeds 30 seconds | 408 | `PROCESSING_TIMEOUT` |
| DB write fails | 500 | `DB_UNAVAILABLE` |

**Partial success is NOT an error.** Same rule as F007b: if some dishes parse and some are skipped, the endpoint returns `200` with `dishesSkipped > 0` and non-empty `skippedReasons`.

The two new codes (`INVALID_URL`, `FETCH_FAILED`, `SCRAPER_BLOCKED`) must be added to:
- `packages/api/src/errors/errorHandler.ts` — `mapError` function

---

## 12. Zod Schemas (defined in `packages/api/src/routes/ingest/url.ts`)

API-internal — NOT added to `packages/shared`.

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

## 13. OpenAPI Specification

The endpoint is documented under the `Ingestion` tag (already defined in `api-spec.yaml`). See `docs/specs/api-spec.yaml` for the full endpoint definition added as part of F007c.

New schema components added to `components/schemas`:
- `IngestUrlBody`
- `IngestUrlResult`
- `IngestUrlSkippedReason`

`NormalizedDish` and `IngestPdfSkippedReason` are already defined from F007b and are reused.

---

## 14. New Dependencies

### `packages/api/package.json`

| Package | Type | Reason |
|---|---|---|
| `node-html-parser` | runtime | Lightweight pure-Node HTML parsing for DOM-to-text extraction |
| `crawlee` | runtime | Crawlee PlaywrightCrawler for the htmlFetcher (already a dependency of `packages/scraper` but must be declared in `packages/api` too — npm workspaces do not hoist devDependencies across packages) |
| `playwright` | runtime (peer) | Playwright browser engine used by Crawlee |

**Note on Crawlee/Playwright in `packages/api`:** `packages/api` gains a direct `crawlee` + `playwright` dependency. This increases the Docker image size. Accept for Phase 1. Defer extracting the URL fetch logic to a shared module or microservice to Phase 2 if image size becomes a concern.

**No new `packages/api/src/app.ts` registration needed** for this route (no new plugins — the route registers as a standard Fastify plugin, no new global middleware).

---

## 15. Route Registration

Follows the same `fastify-plugin` + injectable dependencies pattern as F007b.

```typescript
// packages/api/src/routes/ingest/url.ts

interface IngestUrlPluginOptions {
  prisma: PrismaClient;
}

const ingestUrlRoutesPlugin: FastifyPluginAsync<IngestUrlPluginOptions> = async (app, opts) => {
  app.post('/ingest/url', { schema: { ... } }, async (request, reply) => { ... });
};

export const ingestUrlRoutes = fastifyPlugin(ingestUrlRoutesPlugin);
```

Registered in `packages/api/src/app.ts`:

```typescript
await app.register(ingestUrlRoutes, { prisma: prismaClient });
```

---

## 16. Testing Strategy

### 16.1 Unit tests — `htmlTextExtractor.test.ts`

| Scenario | What to verify |
|---|---|
| Simple `<table>` with nutrient columns | Returns tab-separated rows, one per `<tr>` |
| Multiple `<table>` elements | All tables extracted in document order |
| HTML with `<script>` and `<style>` blocks | Script/style content excluded from output |
| `<nav>`, `<footer>` | Excluded |
| Mixed table + block content | Both tables and block text appear in correct order |
| Empty HTML (`<html><body></body></html>`) | Returns `[]` |
| Comma decimal separators (`1,5`) | Normalized to `1.5` in output lines |

### 16.2 Unit tests — `htmlFetcher.test.ts`

| Scenario | What to verify |
|---|---|
| Successful fetch | Returns outer HTML string from mock crawler |
| Crawlee `failedRequestHandler` called | Throws error with `code: 'FETCH_FAILED'` |
| HTTP 403 response | Throws error with `code: 'SCRAPER_BLOCKED'` |

### 16.3 Integration tests — `url.test.ts`

Uses `buildApp()` + `inject()`. Mocks `htmlFetcher.fetchHtml` via `vi.mock` to return controlled HTML (avoids real Playwright in CI).

| Scenario | Expected result |
|---|---|
| Valid URL + restaurant + source + nutritional HTML table | `200`, `dishesFound > 0`, `dishesUpserted > 0` |
| `dryRun: true` | `200`, `dishesUpserted: 0`, no DB writes |
| Missing `url` field | `400 VALIDATION_ERROR` |
| `url` not a valid URL string | `400 VALIDATION_ERROR` |
| `url` with `file://` scheme | `422 INVALID_URL` |
| `url` resolves to `localhost` | `422 INVALID_URL` |
| `restaurantId` not found in DB | `404 NOT_FOUND` |
| `sourceId` not found in DB | `404 NOT_FOUND` |
| `fetchHtml` throws `FETCH_FAILED` | `422 FETCH_FAILED` |
| `fetchHtml` throws `SCRAPER_BLOCKED` | `422 SCRAPER_BLOCKED` |
| Page HTML yields no text | `422 NO_NUTRITIONAL_DATA_FOUND` |
| Page text has no nutritional table | `422 NO_NUTRITIONAL_DATA_FOUND` |
| All dishes fail normalization | `422 NO_NUTRITIONAL_DATA_FOUND` |
| Some dishes skipped (partial success) | `200`, `dishesSkipped > 0`, non-empty `skippedReasons` |
| Processing exceeds 30 seconds (mock timeout) | `408 PROCESSING_TIMEOUT` |

### 16.4 Test fixtures

- `packages/api/src/__tests__/fixtures/html/sample-nutrition-table.html` — Minimal HTML page with a `<table>` containing 10 dish rows with Spanish nutrient headers
- `packages/api/src/__tests__/fixtures/html/multi-section-table.html` — Two `<table>` sections (starters + mains)
- `packages/api/src/__tests__/fixtures/html/empty.html` — `<html><body></body></html>` (no content)
- `packages/api/src/__tests__/fixtures/html/no-nutrients.html` — HTML with paragraph text but no nutritional table

### 16.5 Mocking strategy

- `htmlTextExtractor.test.ts`: pure function — no mocks needed. Use HTML string fixtures.
- `htmlFetcher.test.ts`: override `crawlerFactory` parameter with a mock implementation.
- `url.test.ts`: `vi.mock('../../lib/htmlFetcher.js')` to inject controlled HTML. `vi.mock` is NOT applied to `htmlTextExtractor` (it is a pure function; use a real implementation with a fixture HTML string). DB: use the test Prisma client (`DATABASE_URL_TEST`) with a seeded Restaurant + DataSource row in `beforeAll`.

---

## 17. Environment Variables

No new environment variables. The endpoint uses the existing `DATABASE_URL` / `DATABASE_URL_TEST` and Prisma singleton from `packages/api`.

Crawlee (via `htmlFetcher`) uses `PLAYWRIGHT_BROWSERS_PATH` if set in the environment, but this is managed by the Crawlee/Playwright toolchain — not a new `packages/api` config variable.

---

## 18. Edge Cases

| Scenario | Expected behaviour |
|---|---|
| URL redirects (301/302) | Playwright follows redirects transparently; final page HTML is returned |
| URL returns 200 but with empty `<body>` | `extractTextFromHtml` returns `[]` → `422 NO_NUTRITIONAL_DATA_FOUND` |
| Page loads JS but nutritional table is behind a login wall | Table not rendered; `parseNutritionTable` returns `[]` → `422 NO_NUTRITIONAL_DATA_FOUND` |
| HTML `<table>` has nutrient headers in a `<thead>` and data in `<tbody>` | Both sections are processed in document order → header detected, data rows parsed correctly |
| Nutrient values in `<td>` use comma decimal (`1,5`) | `extractTextFromHtml` normalizes to `1.5` before parsing |
| Nutrient value written as `< 1` inside `<td>` | `parseDataRow` handles `< N` pattern (unchanged from F007b §9.4) |
| Page has multiple nutritional tables (e.g. burgers + sides) | All tables extracted and parsed; `parseNutritionTable` resets column state on each new header |
| Same dish name appears twice (different portions) | Both parsed; Prisma upsert last-write-wins on `(restaurantId, name)`. Accepted for Phase 1. |
| `dryRun: true` but `restaurantId` does not exist | Still returns `404 NOT_FOUND` — DB existence check runs regardless of `dryRun` |
| URL is accessible but very slow (anti-bot JS challenge with long wait) | Caught by 30-second timeout → `408 PROCESSING_TIMEOUT` |
| URL uses HTTP (not HTTPS) | Accepted — Playwright handles both; no forced HTTPS upgrade |
| Very large HTML page (10MB+) | Playwright handles page download; `node-html-parser` processes synchronously. Accepted for Phase 1 — timeout will terminate if processing is too slow. |
| Concurrent requests to the same URL | Each request spawns its own Playwright context. No concurrency coordination at the route level for Phase 1. |
| SSRF: URL is `http://169.254.169.254/` (AWS metadata endpoint) | Rejected at URL sanity check step with `422 INVALID_URL` — link-local addresses are blocked in the private/loopback guard. |

---

## 19. Acceptance Criteria

- [ ] `POST /ingest/url` with a valid URL pointing to an HTML page with a Spanish nutritional table returns `200` with at least 1 dish upserted
- [ ] `dryRun: true` returns `200` with parsed dishes and `dishesUpserted: 0` (no DB writes)
- [ ] Missing `url` field returns `400 VALIDATION_ERROR`
- [ ] Malformed URL (not a valid URL string) returns `400 VALIDATION_ERROR`
- [ ] URL with `file://` scheme returns `422 INVALID_URL`
- [ ] URL resolving to `localhost` / private IP returns `422 INVALID_URL`
- [ ] Non-existent `restaurantId` returns `404 NOT_FOUND`
- [ ] Non-existent `sourceId` returns `404 NOT_FOUND`
- [ ] Fetch failure (mocked) returns `422 FETCH_FAILED`
- [ ] Anti-bot block (HTTP 403, mocked) returns `422 SCRAPER_BLOCKED`
- [ ] Page with no extractable text returns `422 NO_NUTRITIONAL_DATA_FOUND`
- [ ] Page with text but no nutritional table returns `422 NO_NUTRITIONAL_DATA_FOUND`
- [ ] Partial success (some dishes skipped): `200` with `dishesSkipped > 0` and non-empty `skippedReasons`
- [ ] `sourceUrl` in response matches the submitted URL
- [ ] `tsc --noEmit` passes with zero errors across all packages
- [ ] `vitest run` passes — all tests green
- [ ] Endpoint documented in `docs/specs/api-spec.yaml` under `Ingestion` tag
- [ ] TypeScript strict mode — no `any`, no `ts-ignore`
- [ ] `htmlTextExtractor.extractTextFromHtml` correctly extracts tab-separated table rows in unit tests
- [ ] Salt/sodium derivation in `normalizeNutrients` is exercised via the URL pipeline (integration test)
- [ ] New error codes `INVALID_URL`, `FETCH_FAILED`, `SCRAPER_BLOCKED` registered in `errorHandler.ts`

---

## 20. Out of Scope

- Multi-page crawling (chain scrapers F008–F017)
- OCR for image/canvas-based nutritional content
- LLM-assisted parsing
- Background/async URL processing (deferred Phase 2)
- Admin UI for ingestion history
- Webhook notifications on completion
- Per-chain URL templates (chain scrapers handle this)
