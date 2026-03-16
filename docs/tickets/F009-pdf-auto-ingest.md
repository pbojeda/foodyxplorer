# F009: PDF Auto-Ingest Pipeline (POST /ingest/pdf-url)

**Feature:** F009 | **Type:** Backend-Feature | **Priority:** High
**Status:** In Progress | **Branch:** feature/F009-pdf-auto-ingest
**Created:** 2026-03-13 | **Dependencies:** F007b complete (pdfParser, nutritionTableParser), F007c complete (SSRF guard in url.ts)

---

## Spec

### Description

F009 adds `POST /ingest/pdf-url` to `packages/api`. The endpoint accepts a JSON body with a URL pointing directly to a PDF file, downloads it using Node.js built-in `fetch` (no browser, no Playwright), and feeds the buffer through the existing F007b pipeline: magic-bytes check → `extractText` → `parseNutritionTable` → `normalizeNutrients` / `normalizeDish` → Prisma `$transaction` upsert.

Motivation: ~85% of Spanish fast-food chains (BK, KFC, Telepizza, Five Guys) publish nutritional data only as downloadable PDFs — no scraped HTML table is available. F007b (POST /ingest/pdf) handles the case where a PDF is manually uploaded as a file. F009 adds the automated download step, enabling F010 (batch runner) to ingest an entire chain's data by submitting a single PDF URL.

Key differences from F007b (multipart upload):
- Input is a JSON body (not multipart) — no file upload; the PDF is fetched from a URL.
- Download uses `fetch` with `AbortController` (30-second timeout, 20 MB size cap).
- Content-Type validation is applied on the HTTP response before buffering.
- `sourceUrl` on `RawDishData` is the submitted URL directly (a real HTTP URL, no synthetic `pdf://` URI).
- Response includes a `sourceUrl` field echoing the PDF URL back to the caller (useful for F010 batch runner).

As a side-effect, F009 extracts the inline SSRF guard from `url.ts` into a shared `packages/api/src/lib/ssrfGuard.ts` utility, eliminating duplication between F007c and F009.

No new npm packages are required. All pipeline components (`pdfParser`, `nutritionTableParser`, `normalizeNutrients`, `normalizeDish`) are reused unchanged.

Full specification: `docs/specs/F009-pdf-auto-ingest-spec.md`

---

### Architecture Decisions

**`fetch` instead of Playwright for PDF download**

PDF URLs are direct download links (S3, CDN, static server). They do not require JavaScript rendering or anti-bot bypassing. Node.js built-in `fetch` with `AbortController` is sufficient and avoids the memory and startup overhead of spinning up a headless browser for a simple binary file transfer.

**`pdfDownloader.ts` module**

The download logic is extracted into `packages/api/src/lib/pdfDownloader.ts` with a signature of `downloadPdf(url: string, fetchImpl?: typeof fetch): Promise<Buffer>`. The optional `fetchImpl` parameter allows tests to inject a mock without real network access, following the same dependency injection pattern as `htmlFetcher.ts`.

**`ssrfGuard.ts` shared utility**

The SSRF hostname check (two regexes: `SSRF_BLOCKED` + `SSRF_BLOCKED_IPV4_MAPPED`) is extracted from `url.ts` into `packages/api/src/lib/ssrfGuard.ts` and imported by both `url.ts` and `pdf-url.ts`. This is a pure refactor of `url.ts` with no observable behaviour change.

**20 MB size cap (not 10 MB)**

F007b enforces a 10 MB limit on uploaded files (multipart `limits.fileSize`). F009 uses 20 MB because chain PDF files are larger than typical user-uploaded files — the BK Spain PDF is ~4 MB, Five Guys ~2 MB, and future PDFs could include multi-chain aggregated documents. 20 MB is a safe upper bound while still preventing memory exhaustion from arbitrarily large responses.

**New error code: `PAYLOAD_TOO_LARGE` (413)**

`errorHandler.ts` does not currently handle `PAYLOAD_TOO_LARGE`. This code must be added for the 20 MB size-cap response.

**JSON body (not multipart)**

Consistent with F007c — there is no file to upload. `dryRun` is a native boolean.

---

### API Changes

**New endpoint:** `POST /ingest/pdf-url`

Request body (`application/json`):
```json
{
  "url": "https://static.kfc.es/pdf/contenido-nutricional.pdf",
  "restaurantId": "uuid",
  "sourceId": "uuid",
  "dryRun": false
}
```

Response (200 success):
```json
{
  "success": true,
  "data": {
    "dishesFound": 52,
    "dishesUpserted": 50,
    "dishesSkipped": 2,
    "dryRun": false,
    "sourceUrl": "https://static.kfc.es/pdf/contenido-nutricional.pdf",
    "dishes": [ ... ],
    "skippedReasons": [ ... ]
  }
}
```

Error codes used: `VALIDATION_ERROR` (400), `NOT_FOUND` (404), `PROCESSING_TIMEOUT` (408), `PAYLOAD_TOO_LARGE` (413) [new], `INVALID_URL` (422), `FETCH_FAILED` (422), `INVALID_PDF` (422), `UNSUPPORTED_PDF` (422), `NO_NUTRITIONAL_DATA_FOUND` (422), `DB_UNAVAILABLE` (500).

OpenAPI spec: `docs/specs/api-spec.yaml` — `POST /ingest/pdf-url` under `Ingestion` tag. New schemas: `IngestPdfUrlBody`, `IngestPdfUrlResult`, `IngestPdfUrlSkippedReason`, `IngestPdfUrlResponse`.

---

### Data Model Changes

None. The persistence pattern is identical to F007b (`$transaction` upsert on `dishes` + `dish_nutrients`).

---

### UI Changes

None. Backend-only feature.

---

### Edge Cases

| Scenario | Handling |
|---|---|
| URL redirects (301/302) | `fetch` follows redirects; final response processed |
| Server returns 200 with `text/html` (redirect to login page) | Content-Type check → `INVALID_PDF` |
| Buffer starts with `<html>` despite `Content-Type: application/pdf` | Magic bytes check → `INVALID_PDF` |
| Image-based PDF (scanned, no text) | `UNSUPPORTED_PDF` — same as F007b |
| PDF > 20 MB | Stream aborted during accumulation → `PAYLOAD_TOO_LARGE` (413) |
| `dryRun: true` but `restaurantId` not in DB | `NOT_FOUND` — DB check always runs |
| S3 signed URL that has expired | Server returns 403 → `FETCH_FAILED` |
| PDF with multiple nutritional tables (e.g. BK starters + mains) | All tables parsed; all dishes in response |
| Private/loopback URL (`http://169.254.169.254/`) | SSRF guard → `INVALID_URL` |

---

## Implementation Plan

### Existing Code to Reuse

**Route patterns:**
- `/packages/api/src/routes/ingest/pdf.ts` — pipeline structure, `Promise.race` timeout, `$transaction` upsert pattern, `DOMAIN_CODES` set, magic bytes check, `IngestPdfSkippedReason` shape
- `/packages/api/src/routes/ingest/url.ts` — JSON body parse pattern, `sourceUrl` echoed in response, `dryRun` as native boolean; the SSRF guard block (lines 50–128) is extracted verbatim into `ssrfGuard.ts`

**Libraries (unchanged):**
- `/packages/api/src/lib/pdfParser.ts` — `extractText(buffer): Promise<string[]>` — reused as-is
- `/packages/api/src/ingest/nutritionTableParser.ts` — `parseNutritionTable(lines, sourceUrl, scrapedAt)` — reused as-is
- `@foodxplorer/scraper` — `normalizeNutrients`, `normalizeDish`, `NormalizedDishDataSchema` — reused as-is

**Error handler:**
- `/packages/api/src/errors/errorHandler.ts` — `mapError` — needs one addition: `PAYLOAD_TOO_LARGE` (413). All other codes already handled.

**App factory:**
- `/packages/api/src/app.ts` — `buildApp` — add one `app.register` call for the new route plugin, following the `ingestUrlRoutes` pattern.

**Test infrastructure:**
- `/packages/api/src/__tests__/routes/ingest/pdf.test.ts` — `beforeAll`/`afterAll`/`afterEach` DB fixtures pattern, `vi.mock` at top level, UUID namespaces (`e000`)
- `/packages/api/src/__tests__/routes/ingest/url.test.ts` — `makeRequest` helper for JSON body, SSRF test scenarios, `mockFetchHtml.mockRejectedValue` pattern for error cases

---

### Files to Create

1. **`/packages/api/src/lib/ssrfGuard.ts`**
   Extracted pure utility. Exports `assertNotSsrf(url: string): void`. Contains the two regexes (`SSRF_BLOCKED`, `SSRF_BLOCKED_IPV4_MAPPED`) and the numeric-IP check copied verbatim from `url.ts` lines 50–128. Throws `Error({ code: 'INVALID_URL', ... })` on any blocked input.

2. **`/packages/api/src/lib/pdfDownloader.ts`**
   Exports `downloadPdf(url: string, fetchImpl?: typeof fetch): Promise<Buffer>`. Implements:
   - `fetch(url, { signal: AbortSignal.timeout(30_000) })` (or `fetchImpl` when injected)
   - Non-2xx status → throws `Error({ code: 'FETCH_FAILED' })`
   - `Content-Type` header not `application/pdf` or `application/octet-stream` → throws `Error({ code: 'INVALID_PDF' })`
   - Stream accumulation with running byte count; exceeds 20 MB (`20 * 1024 * 1024`) → throws `Error({ code: 'PAYLOAD_TOO_LARGE' })`
   - `TypeError`/`AbortError`/network error caught in outer `try/catch` → rethrows as `Error({ code: 'FETCH_FAILED' })`
   - Returns `Buffer.from(await response.arrayBuffer())` after size-checked accumulation

3. **`/packages/api/src/routes/ingest/pdf-url.ts`**
   New Fastify route plugin. Exports `ingestPdfUrlRoutes = fastifyPlugin(...)`. Pipeline:
   - `IngestPdfUrlBodySchema.safeParse(request.body)` → 400 on failure
   - `assertNotSsrf(url)` → 422 `INVALID_URL`
   - DB existence checks (restaurant, dataSource) → 404 `NOT_FOUND`
   - `Promise.race` with 30-second `PROCESSING_TIMEOUT`
   - Inside processing promise: `downloadPdf(url)` → magic bytes check → `extractText(buffer)` → `parseNutritionTable(lines, url, scrapedAt)` → normalize loop → conditional `$transaction` upsert
   - `sourceUrl` in response is the submitted `url` (real HTTP URL, no synthetic URI)
   - `DOMAIN_CODES` set includes: `VALIDATION_ERROR`, `NOT_FOUND`, `INVALID_URL`, `FETCH_FAILED`, `INVALID_PDF`, `UNSUPPORTED_PDF`, `NO_NUTRITIONAL_DATA_FOUND`, `PROCESSING_TIMEOUT`, `PAYLOAD_TOO_LARGE`

4. **`/packages/api/src/__tests__/lib/ssrfGuard.test.ts`**
   Unit tests for `assertNotSsrf`. No mocks needed — pure function.

5. **`/packages/api/src/__tests__/lib/pdfDownloader.test.ts`**
   Unit tests for `downloadPdf`. All tests inject a mock `fetchImpl` — no real network calls.

6. **`/packages/api/src/__tests__/routes/ingest/pdf-url.test.ts`**
   Integration tests using `buildApp()` + `app.inject()`. Mocks `pdfDownloader.downloadPdf` via `vi.mock('../../../lib/pdfDownloader.js')`. Uses real test DB (UUID namespace `e200`).

---

### Files to Modify

1. **`/packages/api/src/routes/ingest/url.ts`**
   - Remove the inline SSRF constants and check block (lines 50–128 of current file: both `const SSRF_BLOCKED`, `const SSRF_BLOCKED_IPV4_MAPPED`, and the three `if` blocks in the handler)
   - Add import: `import { assertNotSsrf } from '../../lib/ssrfGuard.js';`
   - Replace the removed inline check with a single call: `assertNotSsrf(url);`
   - No behaviour change — existing `url.test.ts` SSRF tests must continue to pass unchanged

2. **`/packages/api/src/errors/errorHandler.ts`**
   - Add a new `if (asAny['code'] === 'PAYLOAD_TOO_LARGE')` branch returning `{ statusCode: 413, body: { success: false, error: { message: error.message, code: 'PAYLOAD_TOO_LARGE' } } }`
   - Insert it after the `PROCESSING_TIMEOUT` block and before the `RATE_LIMIT_EXCEEDED` block (line ~240 in current file)

3. **`/packages/api/src/app.ts`**
   - Add import: `import { ingestPdfUrlRoutes } from './routes/ingest/pdf-url.js';`
   - Add registration after the `ingestUrlRoutes` line: `await app.register(ingestPdfUrlRoutes, { prisma: prismaClient });`

---

### Implementation Order

Follow Red-Green-Refactor (TDD). Write the failing test for each unit first, then implement the minimum code to make it pass.

1. **`ssrfGuard.ts` + `ssrfGuard.test.ts`** — Create `ssrfGuard.ts` and its unit tests together. This is a pure extraction — write all 11 test cases first (from spec §16.1), run them (all fail), then implement `assertNotSsrf` to make them pass.

2. **Refactor `url.ts`** — Import `assertNotSsrf` from `ssrfGuard.ts`, remove inline SSRF block. Run existing `url.test.ts` to verify zero regressions. No new tests here.

3. **`errorHandler.ts`** — Add `PAYLOAD_TOO_LARGE` branch. No new test file needed — the branch will be exercised by `pdf-url.test.ts` (scenario: response > 20 MB → 413).

4. **`pdfDownloader.ts` + `pdfDownloader.test.ts`** — Write the 6 unit tests from spec §16.2 first (all fail), then implement `downloadPdf` with mock `fetchImpl` support to make them pass.

5. **`pdf-url.ts` + `pdf-url.test.ts`** — Write all integration test cases from spec §16.3 first (all fail due to missing route), then implement the route plugin until all pass. Register the route in `app.ts` as the first step (so inject tests can find the endpoint).

6. **`app.ts`** — Add import and `app.register` for `ingestPdfUrlRoutes`. This is needed for test step 5 above — register before writing tests.

7. **Final validation** — Run `tsc --noEmit` and `vitest run` from `packages/api`. Confirm zero TypeScript errors and all tests green.

---

### Testing Strategy

**Test files to create:**

- `/packages/api/src/__tests__/lib/ssrfGuard.test.ts` — pure unit tests, no mocks, no DB
- `/packages/api/src/__tests__/lib/pdfDownloader.test.ts` — unit tests with mock `fetchImpl`
- `/packages/api/src/__tests__/routes/ingest/pdf-url.test.ts` — integration tests with real test DB

**UUID namespace for `pdf-url.test.ts`:**
Use `e200` namespace (distinct from `e000` used by `pdf.test.ts` and `e100` by `url.test.ts`):
- `TEST_RESTAURANT_ID = 'e2000000-0000-4000-a000-000000000001'`
- `TEST_SOURCE_ID     = 'e2000000-0000-4000-a000-000000000002'`
- `NONEXISTENT_ID     = 'f2000000-0000-4000-a000-000000000099'`

**`ssrfGuard.test.ts` scenarios (11 cases):**
- `http://example.com` → passes (no throw)
- `https://example.com` → passes
- `ftp://example.com` → throws `INVALID_URL`
- `http://localhost/` → throws `INVALID_URL`
- `http://127.0.0.1/` → throws `INVALID_URL`
- `http://192.168.1.1/` → throws `INVALID_URL`
- `http://10.0.0.1/` → throws `INVALID_URL`
- `http://172.16.0.1/` → throws `INVALID_URL`
- `http://169.254.169.254/` → throws `INVALID_URL`
- `http://[::1]/` → throws `INVALID_URL`
- `http://[::ffff:127.0.0.1]/` → throws `INVALID_URL`

**`pdfDownloader.test.ts` scenarios (6 cases):**
- `fetchImpl` returns 200, `Content-Type: application/pdf`, small valid bytes → returns `Buffer`
- `fetchImpl` returns 200, `Content-Type: application/octet-stream` → returns `Buffer`
- `fetchImpl` returns 404 → throws `Error` with `code === 'FETCH_FAILED'`
- `fetchImpl` returns 200, `Content-Type: text/html` → throws `Error` with `code === 'INVALID_PDF'`
- `fetchImpl` returns 200 with body > 20 MB → throws `Error` with `code === 'PAYLOAD_TOO_LARGE'`
- `fetchImpl` throws `TypeError` (network error) → throws `Error` with `code === 'FETCH_FAILED'`

For the >20 MB test: construct a mock response whose body stream yields exactly `20 * 1024 * 1024 + 1` bytes in a single chunk.

**`pdf-url.test.ts` scenarios (16 cases):**
Mock: `vi.mock('../../../lib/pdfDownloader.js', () => ({ downloadPdf: vi.fn() }))` — placed at the top of the file before all imports (same pattern as `url.test.ts`).
Mock `extractText` is NOT mocked at the module level; instead, `downloadPdf` returns a `Buffer` starting with `%PDF-`, and `extractText` is called with the real `pdfParser.ts` implementation. For the "real parse" happy path, return a `Buffer` that `extractText` can process — use the minimal fake PDF buffer plus mock `extractText` via a second `vi.mock` call (same as `pdf.test.ts`).

Actually: mock both `downloadPdf` AND `extractText` (same approach as `pdf.test.ts`) to keep the test hermetic:
- `vi.mock('../../../lib/pdfDownloader.js', () => ({ downloadPdf: vi.fn() }))`
- `vi.mock('../../../lib/pdfParser.js', () => ({ extractText: vi.fn() }))`

Use `FAKE_PDF_BUFFER = Buffer.from('%PDF-1.4 fake content for testing')` as the buffer returned by `mockDownloadPdf` for all happy-path cases (magic bytes check passes). Control `mockExtractText` return value to drive pipeline branches.

Scenarios:
1. Valid URL + restaurant + source, `extractText` returns fixture lines → `200`, `dishesFound >= 1`, `dishesUpserted >= 1`, `sourceUrl` echoed
2. `dryRun: true` → `200`, `dishesUpserted === 0`, `dishes.length >= 1`, no DB writes
3. Missing `url` field → `400 VALIDATION_ERROR`
4. `url` not a valid URL string → `400 VALIDATION_ERROR`
5. `url` with `file://` scheme → `422 INVALID_URL` (no `downloadPdf` call)
6. `url` resolving to `localhost` → `422 INVALID_URL` (no `downloadPdf` call)
7. Non-existent `restaurantId` → `404 NOT_FOUND` (no `downloadPdf` call)
8. Non-existent `sourceId` → `404 NOT_FOUND`
9. `downloadPdf` throws `FETCH_FAILED` → `422 FETCH_FAILED`
10. `downloadPdf` throws `INVALID_PDF` (bad Content-Type) → `422 INVALID_PDF`
11. `downloadPdf` throws `PAYLOAD_TOO_LARGE` → `413`
12. `downloadPdf` returns non-PDF buffer (fails magic bytes) → `422 INVALID_PDF`
13. `extractText` throws `UNSUPPORTED_PDF` → `422 UNSUPPORTED_PDF`
14. `extractText` returns lines with no nutritional table → `422 NO_NUTRITIONAL_DATA_FOUND`
15. Partial success (one valid dish + one skipped) → `200`, `dishesSkipped >= 1`, non-empty `skippedReasons`
16. Simulated timeout (mock throws `PROCESSING_TIMEOUT`) → `408` (same approach as `url.test.ts` test 18)

**`beforeAll`/`afterAll` pattern:** identical to `pdf.test.ts` and `url.test.ts`:
- `beforeAll`: pre-cleanup → create `dataSource` → create `restaurant` → `buildApp({ prisma })`
- `afterAll`: reverse-FK cleanup → `prisma.$disconnect()` → `app.close()`
- `afterEach`: `mockDownloadPdf.mockReset()` + `mockExtractText.mockReset()` + delete dishes/nutrients for `TEST_RESTAURANT_ID`

**Mocking strategy:**
- `ssrfGuard.test.ts`: no mocks — pure function
- `pdfDownloader.test.ts`: inject mock `fetchImpl` parameter — no `vi.mock` needed, no real network
- `pdf-url.test.ts`: `vi.mock` for `pdfDownloader` and `pdfParser` — real DB for existence checks and upsert verification

---

### Key Patterns

**Fastify plugin structure** (`pdf.ts`, `url.ts`):
```
const plugin: FastifyPluginAsync<PluginOptions> = async (app, opts) => { ... };
export const namedRoutes = fastifyPlugin(plugin);
```
The `fastifyPlugin` wrapper is mandatory — it prevents scope isolation, making prisma accessible across the app.

**Error throwing** (all existing routes):
```typescript
throw Object.assign(new Error('message'), { statusCode: 422, code: 'ERROR_CODE' });
```
Never throw plain strings. The `statusCode` property is consumed by `mapError` in `errorHandler.ts`.

**`DOMAIN_CODES` set in route handler** (`url.ts` lines 64–72):
The `$transaction` catch block re-throws domain errors and wraps unknown errors as `DB_UNAVAILABLE`. `pdf-url.ts` must include `PAYLOAD_TOO_LARGE` in this set alongside all other domain codes.

**`Promise.race` timeout** (`pdf.ts` lines 157–374):
The timeout promise is created with `setTimeout` outside the processing promise, and `clearTimeout` is called in `finally` to avoid leaked timers. The 30-second timeout covers both the download step and the parse/normalize pipeline.

**`sourceUrl` on `RawDishData`**: For `pdf-url.ts`, pass the submitted `url` directly (not a synthetic `pdf://` URI). This satisfies `RawDishDataSchema`'s `z.string().url()` constraint naturally, unlike `pdf.ts` which constructs `pdf://${sanitizedFilename}`.

**`vi.mock` hoisting**: `vi.mock(...)` calls must appear at the top of the test file, before any `import` statements, because Vitest hoists them. The import of the mocked module comes after `vi.mock`. Cast to `ReturnType<typeof vi.fn>` for type-safe `.mockResolvedValue` calls (pattern from `pdf.test.ts` lines 18–27).

**No `@fastify/multipart` in `pdf-url.ts`**: The new route uses `application/json` body — no multipart setup needed. The `fastifyMultipart` plugin registered globally in `app.ts` is harmless for JSON endpoints.

**`pdfDownloader.ts` size cap via streaming**: Do not use `response.arrayBuffer()` directly (it buffers everything before you can check size). Instead, iterate `response.body` as an async iterable, accumulating into a `Uint8Array[]`, tracking the total byte count, and aborting when the cap is exceeded. Then `Buffer.concat(chunks)` once the full body is confirmed within limit. This matches spec §7.2 rule 4.

**`assertNotSsrf` must also block numeric decimal/hex IPs**: The existing `url.ts` has a check (`/^\d+$/.test(parsedUrl.hostname) || /^0x/i.test(parsedUrl.hostname)`) that predates the regex block. This check must be included in `ssrfGuard.ts` — it is tested by `url.test.ts` test 8d and must remain covered.

**TypeScript strict mode**: No `any`, no `as any`. Use `Record<string, unknown>` for the error code check pattern (same as all existing files). `fetchImpl` parameter typed as `typeof fetch` (the global `fetch` type available in Node 18+ tsconfig).

**Import extensions**: All local imports must use `.js` extension (ESM project). Example: `import { assertNotSsrf } from '../../lib/ssrfGuard.js'`.

---

## Acceptance Criteria

- [ ] `POST /ingest/pdf-url` with a valid PDF URL returns `200` with at least 1 dish upserted
- [ ] `dryRun: true` returns `200` with parsed dishes and `dishesUpserted: 0`
- [ ] `sourceUrl` in response matches the submitted URL
- [ ] Non-http/https scheme returns `422 INVALID_URL`
- [ ] Private/loopback URL returns `422 INVALID_URL`
- [ ] Network failure returns `422 FETCH_FAILED`
- [ ] Non-2xx HTTP response returns `422 FETCH_FAILED`
- [ ] Non-PDF Content-Type returns `422 INVALID_PDF`
- [ ] Buffer not starting with `%PDF-` returns `422 INVALID_PDF`
- [ ] Image-based PDF returns `422 UNSUPPORTED_PDF`
- [ ] PDF with no nutritional table returns `422 NO_NUTRITIONAL_DATA_FOUND`
- [ ] Missing `url` returns `400 VALIDATION_ERROR`
- [ ] Non-existent `restaurantId` returns `404 NOT_FOUND`
- [ ] Response > 20 MB returns `413 PAYLOAD_TOO_LARGE`
- [ ] `ssrfGuard.ts` shared by both `url.ts` (refactored) and `pdf-url.ts` (new)
- [ ] `PAYLOAD_TOO_LARGE` added to `errorHandler.ts`
- [ ] `tsc --noEmit` passes with zero errors
- [ ] `vitest run` passes — all tests green
- [ ] Endpoint documented in `docs/specs/api-spec.yaml`
- [ ] TypeScript strict mode — no `any`, no `ts-ignore`

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Unit tests written and passing
- [ ] Integration tests written and passing
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
- [ ] Step 5: `qa-engineer` executed
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-13 | Step 0: Spec created | F009-pdf-auto-ingest-spec.md, api-spec.yaml updated |
| 2026-03-13 | Step 1: Setup | Branch feature/F009-pdf-auto-ingest, ticket created |

---

*Ticket created: 2026-03-13*
