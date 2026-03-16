# F009 — PDF Auto-Ingest Pipeline (POST /ingest/pdf-url)

**Feature:** F009 | **Type:** Backend-Feature | **Priority:** High
**Status:** Pending | **Epic:** E002 — Data Ingestion Pipeline
**Created:** 2026-03-13 | **Dependencies:** F007b complete (pdfParser, nutritionTableParser), F007c complete (SSRF guard)

---

## 1. Purpose

F009 adds `POST /ingest/pdf-url` to `packages/api`. The endpoint accepts a URL pointing to a PDF file, downloads it over HTTP/HTTPS, and feeds the buffer through the existing F007b pipeline: `extractText` → `parseNutritionTable` → `normalizeNutrients` / `normalizeDish` → Prisma upsert.

The primary motivation: ~85% of Spanish fast-food chains (BK, KFC, Telepizza, Five Guys) publish nutritional data exclusively as downloadable PDFs — they have no scraped HTML table. F007b (POST /ingest/pdf) requires a multipart file upload. F009 removes that manual step by downloading the PDF programmatically from a known URL.

Known PDF targets:
- BK Spain: `https://eu-west-3-146514239214-prod-bk-fz.s3.eu-west-3.amazonaws.com/en-ES/2026/Nutritional+Information/MANTEL+NUTRICIONAL+ESP+ING+FEB2026.pdf`
- KFC Spain: `https://static.kfc.es/pdf/contenido-nutricional.pdf`
- Telepizza: `https://statices.telepizza.com/static/on/demandware.static/-/Sites-TelepizzaES-Library/default/dw21878fcd/documents/nutricion.pdf`
- Five Guys Spain: `https://fiveguys.es/app/uploads/sites/6/2026/02/FGES_ES_allergen-ingredients_print-SP_A4_20260303.pdf`

---

## 2. Scope Boundaries

**In scope:**
- `POST /ingest/pdf-url` Fastify route in `packages/api/src/routes/ingest/pdf-url.ts`
- Extracting the inline SSRF guard from `url.ts` into a shared utility `packages/api/src/lib/ssrfGuard.ts`
- PDF download via `fetch` (Node.js built-in, no new library) with a 30-second timeout and a 20 MB response size cap
- Reuse (unchanged): `extractText` from `packages/api/src/lib/pdfParser.ts`
- Reuse (unchanged): `parseNutritionTable` from `packages/api/src/ingest/nutritionTableParser.ts`
- Reuse (unchanged): `normalizeNutrients`, `normalizeDish` from `@foodxplorer/scraper`
- Prisma `$transaction` upsert — same pattern as F007b
- OpenAPI documentation under the existing `Ingestion` tag

**Out of scope:**
- F010 chain PDF registry and batch runner (separate ticket)
- Authenticated PDF downloads (PDFs behind login or token-gated URLs)
- Image-based (scanned) PDFs / OCR (deferred, same as F007b)
- LLM-based parsing
- Async / background processing (synchronous for Phase 1)
- Playwright/Crawlee — plain `fetch` is sufficient for direct PDF URLs (no JS rendering needed)

---

## 3. Architectural Decisions

### 3.1 Download strategy: Node.js built-in `fetch` (not Crawlee)

**Decision:** Use the global `fetch` API (available in Node.js 18+) to download the PDF, with `AbortController` for timeout and streaming response size enforcement.

**Rationale:**

PDF URLs are direct download links (S3, CDN, static server). Unlike HTML nutrition pages, they do not require JavaScript rendering or anti-bot bypassing. `fetch` with `AbortController` is sufficient and avoids introducing Playwright overhead for a simple file download.

A Crawlee `PlaywrightCrawler` would be overkill: it spins up a headless browser to navigate to the URL and download the PDF through the browser's download mechanism — unnecessary complexity and a much larger memory footprint for a binary file transfer.

**Implementation:**

```
fetch(url, { signal: AbortSignal.timeout(30_000) })
  → read response body as ArrayBuffer
  → enforce size cap (< 20 MB) by checking Content-Length header or by counting
    bytes during streaming (stream-based accumulation with abort on overflow)
  → convert to Node.js Buffer
```

### 3.2 SSRF guard: extract shared utility

**Decision:** Extract the SSRF hostname regex from `packages/api/src/routes/ingest/url.ts` into `packages/api/src/lib/ssrfGuard.ts` and import it in both `url.ts` and the new `pdf-url.ts`.

**Rationale:** The identical guard logic is already in `url.ts` (two regexes: `SSRF_BLOCKED` and `SSRF_BLOCKED_IPV4_MAPPED`). Duplicating it in `pdf-url.ts` would create divergence risk. Extracting it makes both routes share the same tested implementation with zero duplication.

**Exported API:**

```typescript
// packages/api/src/lib/ssrfGuard.ts

export function assertNotSsrf(url: string): void
// Throws Error({ code: 'INVALID_URL', message: '...' }) if:
//   - URL scheme is not http or https
//   - URL hostname matches SSRF_BLOCKED or SSRF_BLOCKED_IPV4_MAPPED
```

`url.ts` is refactored to import and call `assertNotSsrf` instead of inlining the check. No behaviour change.

### 3.3 `sourceUrl` on `RawDishData`: the actual PDF URL

**Decision:** Set `sourceUrl` on each `RawDishData` to the submitted PDF URL (the real HTTP/HTTPS URL).

**Rationale:** F007b used a synthetic `pdf://[filename]` URI because there was no HTTP URL for an uploaded file. Here the URL is the source — using it directly matches F007c's approach and provides meaningful traceability in the database. `RawDishDataSchema`'s `z.string().url()` constraint is satisfied naturally.

### 3.4 Persistence: same `$transaction` upsert pattern as F007b

No new persistence patterns. Upsert key: `(restaurantId, name)` (no `externalId` in PDFs).

### 3.5 Synchronous processing; 30-second timeout

Same constraint as F007b and F007c. The 30-second timeout covers both the download and the parse/normalize pipeline. Given PDF sizes of 1–5 MB typical for restaurant chain PDFs, download over HTTPS should complete in <5 seconds on a standard server; parse + normalize in <2 seconds. The combined budget of 30 seconds is ample.

### 3.6 Content-Type validation

After downloading, validate:
1. HTTP `Content-Type` response header — must be `application/pdf` or `application/octet-stream`. Anything else (e.g. `text/html`, which signals a redirect to a login page) returns `422 INVALID_PDF`.
2. Magic bytes — buffer must start with `%PDF-`. Same check as F007b. This catches cases where `Content-Type` is `application/octet-stream` but the response is not a PDF.

If Content-Type validation fails the download is aborted (no unnecessary buffering of non-PDF content).

---

## 4. File Structure

```
packages/api/src/
├── routes/
│   └── ingest/
│       ├── pdf.ts              # existing — POST /ingest/pdf (unchanged except ssrfGuard import NA)
│       ├── url.ts              # existing — refactored to import assertNotSsrf from ssrfGuard
│       └── pdf-url.ts          # NEW — POST /ingest/pdf-url
└── lib/
    ├── pdfParser.ts            # existing — extractText(buffer) → string[] (unchanged)
    ├── ssrfGuard.ts            # NEW — extracted from url.ts; shared by url.ts + pdf-url.ts
    └── pdfDownloader.ts        # NEW — downloadPdf(url) → Buffer
```

```
packages/api/src/__tests__/
└── routes/
    └── ingest/
        └── pdf-url.test.ts     # Integration tests (buildApp + inject)
└── lib/
    ├── ssrfGuard.test.ts       # Unit tests for assertNotSsrf
    └── pdfDownloader.test.ts   # Unit tests for downloadPdf (mock fetch)
```

---

## 5. Request Schema

### 5.1 JSON body

The endpoint accepts `application/json`:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `url` | string | Yes | Valid `http://` or `https://` URL. Max length: 2048 chars. Must pass SSRF guard. |
| `restaurantId` | string (UUID) | Yes | Must match an existing `restaurants.id` row. |
| `sourceId` | string (UUID) | Yes | Must match an existing `data_sources.id` row. |
| `dryRun` | boolean | No | Default: `false`. When `true`, downloads and parses but skips all DB writes. |

**Zod schema (defined in `packages/api/src/routes/ingest/pdf-url.ts`):**

```
IngestPdfUrlBodySchema = z.object({
  url          : z.string().url().max(2048),
  restaurantId : z.string().uuid(),
  sourceId     : z.string().uuid(),
  dryRun       : z.boolean().default(false),
})
```

`dryRun` is a native boolean (JSON body, same as F007c).

### 5.2 URL validation (post-Zod)

After Zod validation passes, the handler calls `assertNotSsrf(url)` from `ssrfGuard.ts`:
- URL scheme must be `http` or `https`.
- Hostname must not match the private/loopback/IPv6 block patterns.
- Throws `Error({ code: 'INVALID_URL' })` → `422 INVALID_URL` if blocked.

---

## 6. Processing Pipeline

```
[POST /ingest/pdf-url]
     │
     │  JSON body received
     │
     ▼
[IngestPdfUrlBodySchema.safeParse()]    ← Zod validation
     │  failure → 400 VALIDATION_ERROR
     │
     ▼
[assertNotSsrf(url)]                   ← packages/api/src/lib/ssrfGuard.ts
     │  blocked → 422 INVALID_URL
     │
     ▼
[DB existence checks]                  ← prisma.restaurant.findUnique + prisma.dataSource.findUnique
     │  restaurant not found → 404 NOT_FOUND
     │  dataSource not found → 404 NOT_FOUND
     │
     ▼
[30-second timeout guard]              ← Promise.race wrapper (same as F007b/F007c)
     │
     ▼
[pdfDownloader.downloadPdf(url)]       ← packages/api/src/lib/pdfDownloader.ts
     │  fetch(url, { signal: AbortSignal.timeout(30_000) })
     │  non-2xx HTTP → 422 FETCH_FAILED
     │  Content-Type not application/pdf or application/octet-stream → 422 INVALID_PDF
     │  response size > 20 MB → 413 PAYLOAD_TOO_LARGE
     │  network / DNS error → 422 FETCH_FAILED
     │
     ▼
[Magic bytes check (%PDF-)]            ← same logic as pdf.ts
     │  fails → 422 INVALID_PDF
     │
     ▼
[pdfParser.extractText(buffer)]        ← packages/api/src/lib/pdfParser.ts (unchanged)
     │  empty text → 422 UNSUPPORTED_PDF
     │
     ▼
[parseNutritionTable(lines, sourceUrl, scrapedAt)]
     │                                 ← packages/api/src/ingest/nutritionTableParser.ts (unchanged)
     │  zero dishes → 422 NO_NUTRITIONAL_DATA_FOUND
     │
     ▼
[normalizeNutrients() + normalizeDish()]   ← @foodxplorer/scraper (unchanged)
     │  invalid dishes → collected in dishesSkipped (not fatal)
     │
     ▼
[NormalizedDishDataSchema.safeParse()]
     │
     ▼
[Prisma $transaction upsert — if dryRun === false]
     │  dishes + dish_nutrients tables
     │  upsert on (restaurantId, name)
     │
     ▼
[Response — 200 IngestPdfUrlResponse]
```

---

## 7. `pdfDownloader` Module Specification

### 7.1 Signature

```typescript
// packages/api/src/lib/pdfDownloader.ts

export async function downloadPdf(url: string): Promise<Buffer>
```

Returns a `Buffer` containing the raw PDF bytes. Throws domain errors (code-stamped) for the caller's `mapError` to translate.

### 7.2 Implementation rules

1. Call `fetch(url, { signal: AbortSignal.timeout(30_000) })`.
2. If the response status is not 2xx, throw `Error({ code: 'FETCH_FAILED', message: 'Failed to download PDF: HTTP <status>' })`.
3. Read the `Content-Type` header. If it is neither `application/pdf` nor `application/octet-stream`, throw `Error({ code: 'INVALID_PDF', message: 'URL did not return a PDF (Content-Type: <actual>)' })`.
4. Read the response body as a stream, accumulating bytes. If the accumulated size exceeds **20 MB** (20 × 1024 × 1024 bytes), abort the stream and throw `Error({ code: 'PAYLOAD_TOO_LARGE', message: 'PDF exceeds the 20 MB size limit' })`.
5. Return the complete buffer.

### 7.3 Error mapping summary

| Condition | Error code | HTTP status |
|---|---|---|
| Non-2xx HTTP response | `FETCH_FAILED` | 422 |
| Content-Type not PDF/octet-stream | `INVALID_PDF` | 422 |
| Response body > 20 MB | `PAYLOAD_TOO_LARGE` | 413 |
| Network error / DNS failure / AbortError | `FETCH_FAILED` | 422 |

### 7.4 Testability

`downloadPdf` accepts an optional second parameter for dependency injection in tests:

```typescript
export async function downloadPdf(
  url: string,
  fetchImpl?: typeof fetch,
): Promise<Buffer>
```

Tests pass a mock `fetchImpl` that returns controlled responses without real network access.

---

## 8. `ssrfGuard` Module Specification

### 8.1 Signature

```typescript
// packages/api/src/lib/ssrfGuard.ts

export function assertNotSsrf(url: string): void
```

Throws `Error({ code: 'INVALID_URL', message: '...' })` if the URL should be blocked.

### 8.2 Block conditions (extracted verbatim from url.ts)

1. URL scheme is not `http` or `https`.
2. Hostname matches `SSRF_BLOCKED` regex (localhost, 127.x, 10.x, 172.16–31.x, 192.168.x, 169.254.x, ::1, fe80:).
3. Hostname matches `SSRF_BLOCKED_IPV4_MAPPED` regex (all `::ffff:` addresses).

### 8.3 Refactor impact on `url.ts`

`url.ts` replaces its inline SSRF check block with a call to `assertNotSsrf(url)`. No observable behaviour change. This is a pure refactor — no new tests for `url.ts` itself; the existing `url.test.ts` SSRF cases continue to pass.

---

## 9. Response Schema

### 9.1 Success (200)

The response mirrors F007c's `IngestUrlResult` with `sourceUrl` included (the PDF URL). This is the same choice as F007c — the caller needs the URL echoed back for traceability (F010 batch runner will call this endpoint for multiple chains in sequence).

```
IngestPdfUrlResultSchema = z.object({
  dishesFound    : z.number().int().nonnegative(),
  dishesUpserted : z.number().int().nonnegative(),
  dishesSkipped  : z.number().int().nonnegative(),
  dryRun         : z.boolean(),
  sourceUrl      : z.string().url(),   // the PDF URL echoed back
  dishes         : z.array(NormalizedDishDataSchema),
  skippedReasons : z.array(z.object({
    dishName  : z.string(),
    reason    : z.string(),
  })),
})
```

### 9.2 Example response

```json
{
  "success": true,
  "data": {
    "dishesFound": 52,
    "dishesUpserted": 50,
    "dishesSkipped": 2,
    "dryRun": false,
    "sourceUrl": "https://static.kfc.es/pdf/contenido-nutricional.pdf",
    "dishes": [
      {
        "name": "Zinger Burger",
        "nameEs": "Zinger Burger",
        "nutrients": {
          "calories": 490,
          "proteins": 29,
          "carbohydrates": 44,
          "fats": 21,
          "saturatedFats": 4,
          "sugars": 5,
          "fiber": 2,
          "salt": 1.8,
          "sodium": 720,
          "transFats": 0,
          "cholesterol": 65,
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

## 10. Normalization Rules (inherited from F007b)

| Rule | Detail |
|---|---|
| `confidenceLevel` | Always `'medium'` |
| `estimationMethod` | `'scraped'` |
| `referenceBasis` | Always `'per_serving'` (ADR-004) |
| `sourceUrl` on `RawDishData` | The submitted PDF URL (real HTTP URL, no synthetic URI) |
| `scrapedAt` on `RawDishData` | `new Date().toISOString()` at request time |

---

## 11. Error Handling

All errors use the existing envelope: `{ success: false, error: { message, code, details? } }`.

No new error codes are introduced. All codes already exist in `errorHandler.ts`.

| Scenario | HTTP | code |
|---|---|---|
| `url` fails Zod `.url()` | 400 | `VALIDATION_ERROR` |
| `restaurantId` / `sourceId` missing or not UUID | 400 | `VALIDATION_ERROR` |
| URL scheme not `http`/`https` or private/loopback address | 422 | `INVALID_URL` |
| `restaurantId` not found in DB | 404 | `NOT_FOUND` |
| `sourceId` not found in DB | 404 | `NOT_FOUND` |
| Non-2xx HTTP response when downloading | 422 | `FETCH_FAILED` |
| Network error / DNS failure | 422 | `FETCH_FAILED` |
| Content-Type header not PDF/octet-stream | 422 | `INVALID_PDF` |
| Magic bytes check fails (not `%PDF-`) | 422 | `INVALID_PDF` |
| PDF is image-based (no extractable text) | 422 | `UNSUPPORTED_PDF` |
| No parseable nutritional table | 422 | `NO_NUTRITIONAL_DATA_FOUND` |
| All parsed dishes fail normalization | 422 | `NO_NUTRITIONAL_DATA_FOUND` |
| Response body > 20 MB | 413 | `PAYLOAD_TOO_LARGE` |
| Processing exceeds 30 seconds | 408 | `PROCESSING_TIMEOUT` |
| DB write fails | 500 | `DB_UNAVAILABLE` |

New error code needed in `errorHandler.ts`: **`PAYLOAD_TOO_LARGE`** (413). All other codes already exist.

**Partial success is not an error.** Same rule as F007b/F007c: if some dishes parse and some fail normalization, return `200` with `dishesSkipped > 0`.

---

## 12. Zod Schemas (defined in `packages/api/src/routes/ingest/pdf-url.ts`)

API-internal — NOT added to `packages/shared`.

```
IngestPdfUrlBodySchema = z.object({
  url          : z.string().url().max(2048),
  restaurantId : z.string().uuid(),
  sourceId     : z.string().uuid(),
  dryRun       : z.boolean().default(false),
})

IngestPdfUrlSkippedReasonSchema = z.object({
  dishName  : z.string(),
  reason    : z.string(),
})

IngestPdfUrlResultSchema = z.object({
  dishesFound    : z.number().int().nonnegative(),
  dishesUpserted : z.number().int().nonnegative(),
  dishesSkipped  : z.number().int().nonnegative(),
  dryRun         : z.boolean(),
  sourceUrl      : z.string().url(),
  dishes         : z.array(NormalizedDishDataSchema),
  skippedReasons : z.array(IngestPdfUrlSkippedReasonSchema),
})
```

---

## 13. OpenAPI Specification

The endpoint is documented under the `Ingestion` tag. See `docs/specs/api-spec.yaml` for the full definition (added as part of F009).

New schema components added to `components/schemas`:
- `IngestPdfUrlBody`
- `IngestPdfUrlResult`
- `IngestPdfUrlSkippedReason`

`NormalizedDish` and `IngestPdfSkippedReason` are reused from F007b.

---

## 14. New Dependencies

No new npm packages. All required packages are already installed:
- `@foodxplorer/scraper` — already a runtime dep of `packages/api` (added by F007b)
- `pdf-parse` — already a runtime dep (added by F007b)
- Node.js built-in `fetch` — available since Node.js 18; already used by the project

---

## 15. Route Registration

```typescript
// packages/api/src/routes/ingest/pdf-url.ts

interface IngestPdfUrlPluginOptions {
  prisma: PrismaClient;
}

const ingestPdfUrlRoutesPlugin: FastifyPluginAsync<IngestPdfUrlPluginOptions> = async (app, opts) => {
  app.post('/ingest/pdf-url', { schema: { ... } }, async (request, reply) => { ... });
};

export const ingestPdfUrlRoutes = fastifyPlugin(ingestPdfUrlRoutesPlugin);
```

Registered in `packages/api/src/app.ts`:

```typescript
await app.register(ingestPdfUrlRoutes, { prisma: prismaClient });
```

---

## 16. Testing Strategy

### 16.1 Unit tests — `ssrfGuard.test.ts`

| Scenario | Expected |
|---|---|
| `http://example.com` | Passes |
| `https://example.com` | Passes |
| `ftp://example.com` | Throws `INVALID_URL` |
| `http://localhost/` | Throws `INVALID_URL` |
| `http://127.0.0.1/` | Throws `INVALID_URL` |
| `http://192.168.1.1/` | Throws `INVALID_URL` |
| `http://10.0.0.1/` | Throws `INVALID_URL` |
| `http://172.16.0.1/` | Throws `INVALID_URL` |
| `http://169.254.169.254/` | Throws `INVALID_URL` (AWS metadata) |
| `http://[::1]/` | Throws `INVALID_URL` |
| `http://[::ffff:127.0.0.1]/` | Throws `INVALID_URL` |

### 16.2 Unit tests — `pdfDownloader.test.ts`

Uses mock `fetchImpl` injected via the optional second parameter.

| Scenario | Expected |
|---|---|
| `fetchImpl` returns 200 with `Content-Type: application/pdf` and valid bytes | Returns Buffer |
| `fetchImpl` returns 200 with `Content-Type: application/octet-stream` | Returns Buffer |
| `fetchImpl` returns 404 | Throws `FETCH_FAILED` |
| `fetchImpl` returns 200 with `Content-Type: text/html` | Throws `INVALID_PDF` |
| `fetchImpl` returns 200 with body > 20 MB | Throws `PAYLOAD_TOO_LARGE` |
| `fetchImpl` throws `TypeError` (network error) | Throws `FETCH_FAILED` |

### 16.3 Integration tests — `pdf-url.test.ts`

Uses `buildApp()` + `inject()`. Mocks `pdfDownloader.downloadPdf` via `vi.mock` to return controlled buffers.

| Scenario | Expected |
|---|---|
| Valid PDF URL + restaurant + source → PDF with nutritional table | `200`, `dishesFound > 0`, `dishesUpserted > 0`, `sourceUrl` echoed |
| `dryRun: true` | `200`, `dishesUpserted: 0`, no DB writes, `dishes` populated |
| Missing `url` | `400 VALIDATION_ERROR` |
| `url` not a valid URL | `400 VALIDATION_ERROR` |
| `url` with `file://` scheme | `422 INVALID_URL` |
| `url` resolves to `localhost` | `422 INVALID_URL` |
| Non-existent `restaurantId` | `404 NOT_FOUND` |
| Non-existent `sourceId` | `404 NOT_FOUND` |
| `downloadPdf` throws `FETCH_FAILED` | `422 FETCH_FAILED` |
| `downloadPdf` throws `INVALID_PDF` (bad Content-Type) | `422 INVALID_PDF` |
| `downloadPdf` throws `PAYLOAD_TOO_LARGE` | `413` |
| Buffer does not start with `%PDF-` | `422 INVALID_PDF` |
| PDF is image-based (no text) | `422 UNSUPPORTED_PDF` |
| PDF has no nutritional table | `422 NO_NUTRITIONAL_DATA_FOUND` |
| All dishes fail normalization | `422 NO_NUTRITIONAL_DATA_FOUND` |
| Some dishes skipped (partial success) | `200`, `dishesSkipped > 0`, non-empty `skippedReasons` |
| Processing exceeds 30 seconds (mock timeout) | `408 PROCESSING_TIMEOUT` |

### 16.4 Mocking strategy

- `ssrfGuard.test.ts`: pure function — no mocks needed.
- `pdfDownloader.test.ts`: inject mock `fetchImpl`. No real network calls.
- `pdf-url.test.ts`: `vi.mock('../../lib/pdfDownloader.js')` to inject controlled buffers. `pdfParser.extractText` is tested via its real implementation with a minimal PDF buffer (same approach as `pdf.test.ts`). DB: test Prisma client with seeded Restaurant + DataSource in `beforeAll`.

---

## 17. Environment Variables

No new environment variables.

---

## 18. Edge Cases

| Scenario | Expected behaviour |
|---|---|
| PDF URL redirects (301/302) | `fetch` follows redirects by default (up to 20); final response processed |
| PDF URL returns 200 but Content-Type is `text/html` (redirect to login page) | `INVALID_PDF` — Content-Type check blocks before buffering |
| PDF URL returns `Content-Type: application/pdf` but body starts with `<html>` (misconfigured server) | Magic bytes check fails → `INVALID_PDF` |
| PDF URL is valid but PDF has no text (scanned/image) | `UNSUPPORTED_PDF` — same handling as POST /ingest/pdf |
| PDF has multiple nutritional tables (e.g. BK starters + mains) | All tables parsed; dishes from all sections in response |
| Dish name contains parentheses or diacritics | Preserved as-is (F007b parser handles this) |
| Nutrient value written as `1,5` (Spanish comma decimal) | `parseNutritionTable` handles comma normalization |
| `dryRun: true` but `restaurantId` does not exist | `404 NOT_FOUND` — DB existence check always runs |
| Same dish name appears twice in the PDF | Both parsed; Prisma upsert last-write-wins on `(restaurantId, name)`. Accepted for Phase 1. |
| PDF URL on S3 with signed/expiring URL | URL treated as a normal HTTPS URL; if expired, server returns 403 → `FETCH_FAILED` |
| URL for a `.pdf` file behind HTTP Basic Auth | 401 response → `FETCH_FAILED` |
| Content-Length header absent (chunked transfer) | Size enforced by accumulating bytes during streaming |
| Very large PDF (> 20 MB, e.g. a book) | Rejected at download step → `413 PAYLOAD_TOO_LARGE` |

---

## 19. Acceptance Criteria

- [ ] `POST /ingest/pdf-url` with a valid PDF URL returns `200` with at least 1 dish upserted
- [ ] `dryRun: true` returns `200` with parsed dishes and `dishesUpserted: 0` (no DB writes)
- [ ] `sourceUrl` in response matches the submitted URL
- [ ] Non-http/https scheme returns `422 INVALID_URL`
- [ ] Private/loopback URL returns `422 INVALID_URL`
- [ ] Network failure (mocked) returns `422 FETCH_FAILED`
- [ ] Non-2xx HTTP response (mocked) returns `422 FETCH_FAILED`
- [ ] Non-PDF Content-Type (mocked) returns `422 INVALID_PDF`
- [ ] Buffer not starting with `%PDF-` returns `422 INVALID_PDF`
- [ ] Image-based PDF (no text) returns `422 UNSUPPORTED_PDF`
- [ ] PDF with no nutritional table returns `422 NO_NUTRITIONAL_DATA_FOUND`
- [ ] Missing `url` field returns `400 VALIDATION_ERROR`
- [ ] Non-existent `restaurantId` returns `404 NOT_FOUND`
- [ ] Response > 20 MB returns `413`
- [ ] Partial success: `200` with `dishesSkipped > 0` and non-empty `skippedReasons`
- [ ] `ssrfGuard.ts` is used by both `url.ts` and `pdf-url.ts` (no duplication)
- [ ] `tsc --noEmit` passes with zero errors
- [ ] `vitest run` passes — all tests green
- [ ] Endpoint documented in `docs/specs/api-spec.yaml` under `Ingestion` tag
- [ ] TypeScript strict mode — no `any`, no `ts-ignore`
- [ ] `PAYLOAD_TOO_LARGE` error code added to `errorHandler.ts`

---

## 20. Out of Scope

- F010 chain PDF registry and batch runner
- Authenticated PDF downloads (login-gated)
- OCR for image-based PDFs
- LLM-based parsing
- Background/async processing (Phase 2)
- Admin UI for ingestion history
