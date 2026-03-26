# F034: Menu Analysis (OCR + Vision API)

**Feature:** F034 | **Type:** Fullstack-Feature | **Priority:** High
**Status:** Spec | **Branch:** feature/F034-menu-analysis-ocr-vision
**Created:** 2026-03-26 | **Dependencies:** F031 ✅ (bot file upload), F023 ✅ (engine router), F026 ✅ (API key auth)

---

## Spec

### Description

`POST /analyze/menu` accepts a photo or PDF of a restaurant menu, or a photo of a single food item. It extracts dish names using one of four processing modes and runs `runEstimationCascade` on each name to return per-dish nutritional estimates.

The endpoint is **stateless** — it does not write to any database table. It is designed for two bot use cases (activated in F031 stubs):

- **`upload_menu`** — user sends a menu photo or PDF → bot calls `POST /analyze/menu` (mode: `auto`) → formatted list of dishes with key nutrients.
- **`upload_dish`** — user sends a photo of a single plate → bot calls `POST /analyze/menu` (mode: `identify`) → single dish identification + estimation.

**ADR-001 compliance:** The Vision API is used exclusively to identify dish name strings. All nutrient computation is delegated to `runEstimationCascade`. The LLM never produces or estimates nutritional values.

### Processing Modes

| Mode | Input | Pipeline |
|------|-------|----------|
| `auto` (default) | PDF → OCR pipeline; image → Vision API pipeline | Selected at runtime based on detected MIME type |
| `ocr` | PDF or image | PDF: `pdf-parse` → text lines → `parseDishNames`. Image: `extractTextFromImage` (Tesseract) → `parseDishNames` |
| `vision` | Image only | OpenAI `gpt-4o-mini` with menu-extraction prompt ("list all dish names visible in this restaurant menu"). PDFs in vision mode → return `INVALID_IMAGE` (no PDF-to-image conversion) |
| `identify` | Image only | OpenAI `gpt-4o-mini` with single-dish-identification prompt ("what food or dish is shown in this photo"). Returns **exactly 1 dish**. PDFs → return `INVALID_IMAGE` |

**OCR pipeline detail (for PDFs):** file buffer → `pdf-parse` (text extraction, no image rendering) → text lines → `parseDishNames(lines: string[]): string[]` (new utility, simpler than `parseNutritionTable` — extracts name candidates only, strips numbers and short tokens).

**OCR pipeline detail (for images):** file buffer → `extractTextFromImage` (Tesseract.js) → text lines → `parseDishNames`.

**Vision API pipeline detail:** image buffer → `callChatCompletion(apiKey, [{ role: 'user', content: [image + prompt] }], logger, 'gpt-4o-mini', 2048)` with a structured prompt → parse JSON array of dish name strings from response. **Note:** `maxTokens` overridden to 2048 (not the default 512) to accommodate large menus with 30+ dish names.

**Identify pipeline detail:** Same as Vision but with a different prompt ("identify the single dish/plate of food in this photo") → returns exactly 1 dish name string. If Vision API returns multiple candidates, take the first one.

**Fallback (vision mode only):** when `vision` mode is requested and the OpenAI call fails, the handler falls back to Tesseract OCR on the image. If OCR produces fewer than 1 dish name → `MENU_ANALYSIS_FAILED`. **No fallback for `identify` mode** — if Vision API fails for dish identification, return `MENU_ANALYSIS_FAILED` immediately (OCR on a food photo is not useful).

**Per-dish estimation:** each dish name string is passed as `query` to `runEstimationCascade({ db, query, openAiApiKey, level4Lookup, logger })`. A total miss produces `estimate: null` (dish is still included in the response).

**Minimum dish threshold:** The endpoint returns HTTP 200 as long as ≥ 1 dish name is extracted, even if all estimates are null. The previous ≥ 3 threshold was overly restrictive for partial menu photos and small menus.

**Partial results on timeout:** If the 60-second timeout is hit mid-processing (during cascade calls for individual dishes), the endpoint returns HTTP 200 with the dishes processed so far plus a `partial: true` flag, rather than discarding all work with a 408.

### Architecture Constraints

- **ADR-001:** Vision API identifies dish names only. `runEstimationCascade` owns all nutrient calculation.
- **ADR-009:** `portion_multiplier` pattern applies inside `runEstimationCascade` — no changes needed at the analysis layer.
- **Reuse:** `extractTextFromImage` (Tesseract, `packages/api/src/utils/imageOcrExtractor.ts`), `callChatCompletion` (OpenAI, `packages/api/src/clients/openaiClient.ts`), `runEstimationCascade` (engine router).
- **New utility:** `parseDishNames(lines: string[]): string[]` — strips lines that are purely numeric, too short (< 3 chars), or match obvious non-dish patterns (prices, allergen codes). Returns remaining lines as dish name candidates.

### Rate Limiting

Additional per-key rate limit: **10 analyses per hour per API key**, enforced by a dedicated Redis counter (`fxp:analyze:hourly:<keyHash>`) with a 3600-second TTL. This limit is checked before the standard tier limit. Exceeding it returns `429 RATE_LIMIT_EXCEEDED`.

**Bot exemption:** The `BOT_API_KEY` is a single key shared across all Telegram bot users. Applying the 10/hour limit to it would throttle the entire bot. The bot key (identified by matching `request.apiKeyContext.keyId` against a known bot key ID, or by tier `"bot"`) is **exempt** from the analysis-specific rate limit. Instead, the bot enforces its own per-user limit: **5 analyses per hour per chatId**, managed in the bot's handler layer via Redis counter `fxp:analyze:bot:<chatId>` (TTL 3600s). This prevents individual bot users from abusing the feature while not throttling the collective.

### API Changes

#### New tag: `Analysis`

Added to the global tags list in `api-spec.yaml`.

#### New endpoint: `POST /analyze/menu`

- **Auth:** `PublicKeyAuth` (API key required; anonymous requests rejected with `401 UNAUTHORIZED`)
- **Content-Type:** `multipart/form-data`
- **Timeout:** 60 seconds
- **File types:** JPEG, PNG, WebP, PDF — max 10 MB

**Request fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | binary | Yes | Menu photo or PDF. Max 10 MB. MIME: image/jpeg, image/png, image/webp, application/pdf |
| `mode` | enum | No | `auto` (default) \| `ocr` \| `vision` \| `identify` |

**Response (`200`):**

```json
{
  "success": true,
  "data": {
    "mode": "auto",
    "dishCount": 3,
    "dishes": [
      {
        "dishName": "Big Mac",
        "estimate": { /* EstimateData — full cascade result */ }
      },
      {
        "dishName": "Hamburgesa Especial",
        "estimate": null
      }
    ]
  }
}
```

**Error codes:**

| Code | HTTP | Condition |
|------|------|-----------|
| `VALIDATION_ERROR` | 400 | Missing file or invalid `mode` value |
| `UNAUTHORIZED` | 401 | No API key provided |
| `PROCESSING_TIMEOUT` | 408 | Analysis exceeded 60-second timeout |
| `FST_REQ_FILE_TOO_LARGE` | 413 | File exceeds 10 MB |
| `INVALID_IMAGE` | 422 | Unsupported file type or MIME mismatch |
| `OCR_FAILED` | 422 | OCR pipeline produced zero readable lines |
| `MENU_ANALYSIS_FAILED` | 422 | Vision API + OCR fallback both produced < 3 dish names |
| `VISION_API_UNAVAILABLE` | 422 | `OPENAI_API_KEY` not set and vision/identify/auto+image was requested |
| `RATE_LIMIT_EXCEEDED` | 429 | Standard tier limit or analysis-specific 10/hour limit exceeded |

### New Schemas (added to `api-spec.yaml`)

| Schema | Description |
|--------|-------------|
| `MenuAnalysisDish` | Single dish: `dishName: string` + `estimate: EstimateData \| null` |
| `MenuAnalysisData` | Response payload: `mode`, `dishCount`, `dishes: MenuAnalysisDish[]` |
| `MenuAnalysisResponse` | Envelope: `{ success: true, data: MenuAnalysisData }` |

`EstimateData` is reused via `$ref` — no new estimation schemas.

### Zod Schemas (to be added in `packages/shared/src/schemas/`)

**`analyzeMenuSchema`** (request body, multipart fields):
```
{
  mode: z.enum(['auto', 'ocr', 'vision', 'identify']).default('auto')
  // `file` validated by Fastify multipart plugin (not Zod)
}
```

**`menuAnalysisDishSchema`**:
```
{
  dishName: z.string().min(1).max(255),
  estimate: estimateDataSchema.nullable()
}
```

**`menuAnalysisDataSchema`**:
```
{
  mode: z.enum(['auto', 'ocr', 'vision', 'identify']),
  dishCount: z.number().int().min(1),
  dishes: z.array(menuAnalysisDishSchema).min(1),
  partial: z.boolean().default(false)  // true when timeout interrupted cascade processing
}
```

**`parseDishNamesResult`**: `z.array(z.string().min(3).max(255))` — internal, not in the API response schema.

### Bot Integration Spec

#### `upload_menu` callback handler (`callbackQuery.ts`)

1. Retrieve `pendingPhotoFileId` from the user's BotState in Redis (key: `bot:state:<chatId>`), following the F031 pattern. The callback query's message is the bot's inline keyboard message, NOT the user's original photo — the fileId is stored in Redis during `handlePhoto`/`handleDocument`.
2. Call `downloadTelegramFile(bot, pendingPhotoFileId)` → `Buffer`.
3. Detect MIME type from buffer magic bytes to determine filename extension for the API call.
4. Check per-user rate limit (Redis counter `fxp:analyze:bot:<chatId>`, 5/hour). If exceeded → send rate limit notice and return.
5. Call `apiClient.analyzeMenu(buffer, filename, mimeType, 'auto')` → `MenuAnalysisData`.
6. Format response as MarkdownV2 list:
   - Header: "Platos encontrados en el menú: N"
   - If `partial: true`: add note "(resultados parciales por timeout)"
   - Per dish: dish name + top nutrients (calories, proteins, fats, carbohydrates) when estimate is non-null
   - Dishes with `estimate: null`: show name + "(sin datos)"
7. On error codes `MENU_ANALYSIS_FAILED`, `INVALID_IMAGE`, `OCR_FAILED`, `VISION_API_UNAVAILABLE`: send localised user-friendly error message.
8. On `RATE_LIMIT_EXCEEDED`: send rate limit notice.
9. Clear `pendingPhotoFileId` from Redis after processing.

#### `upload_dish` callback handler (`callbackQuery.ts`)

1. Same steps 1–4 as `upload_menu` (retrieve fileId from Redis, download, detect MIME, check rate limit).
2. Call `apiClient.analyzeMenu(buffer, filename, mimeType, 'identify')` → `MenuAnalysisData`.
3. Format response: single dish result with full nutrient breakdown (all 14 fields). The `dishes` array is guaranteed to contain exactly 1 entry for `identify` mode.
4. Same error handling as `upload_menu`.
5. Clear `pendingPhotoFileId` from Redis after processing.

#### `apiClient.ts` — new method

```typescript
analyzeMenu(
  fileBuffer: Buffer,
  filename: string,
  mimeType: string,
  mode: 'auto' | 'ocr' | 'vision' | 'identify'
): Promise<MenuAnalysisData>
```

Uses `postFormData<MenuAnalysisResponse>('/analyze/menu', ...)` with the existing 90-second timeout helper.

### Edge Cases

1. **PDF in `vision` or `identify` mode:** Return `INVALID_IMAGE` (422). Vision API requires image buffers; PDF-to-image conversion adds heavy system dependencies (Ghostscript, etc.) out of scope. Users should use `ocr` or `auto` for PDFs.
2. **Empty Vision API response:** If `gpt-4o-mini` returns an empty JSON array (`[]`) or unparseable text → attempt Tesseract OCR fallback (vision mode only) → if still < 1 dish name → `MENU_ANALYSIS_FAILED`.
3. **All cascade misses:** All dishes have `estimate: null` → return 200 with `dishCount > 0` and an all-null `dishes` array. This is valid — the client decides how to display total-miss results.
4. **`OPENAI_API_KEY` absent + `mode: auto` + PDF:** OCR pipeline is selected → no Vision API needed → proceeds normally without the key.
5. **`OPENAI_API_KEY` absent + `mode: auto` + image:** Vision API is required but unavailable → `VISION_API_UNAVAILABLE` (422).
6. **Large menus (many dishes):** No upper bound on extracted dish names. `runEstimationCascade` is called sequentially per dish. The 60-second timeout acts as the natural cap. If timeout is hit mid-processing, return **200 with partial results** (`partial: true` + dishes processed so far) instead of discarding work.
7. **`identify` mode:** Returns exactly 1 dish. No OCR fallback — if Vision API fails, return `MENU_ANALYSIS_FAILED` immediately. If Vision returns multiple candidates, use the first one.
8. **Duplicate dish names:** `parseDishNames` may return duplicates. These are passed individually to the cascade — each entry in `dishes` is treated independently. De-duplication is explicitly out of scope for F034.
9. **Rate limit Redis failure:** If the Redis counter for the analysis-specific limit cannot be reached, fail-open (allow the request) — consistent with existing cache fail-open policy.
10. **Bot rate limiting:** Per-user (chatId) limit enforced in bot handler, not in API. API-level limit exempts the bot key. See Rate Limiting section.

---

## Implementation Plan

### Existing Code to Reuse

- **`packages/api/src/lib/openaiClient.ts`** — `callChatCompletion(apiKey, messages, logger, model, maxTokens)`: Returns `string | null` on any failure (never throws). **CRITICAL NOTE:** The current `messages` parameter type is `Array<{ role: 'system' | 'user'; content: string }>` — this does NOT support multimodal content (image_url). F034 must add a new exported function `callVisionCompletion(apiKey, imageBase64, mimeType, prompt, logger, maxTokens?)` that constructs the multimodal `content` array with `[{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: 'data:${mimeType};base64,${imageBase64}' } }]` and calls OpenAI directly. Same retry logic as `callChatCompletion`. This is a NEW function, not a modification of the existing one.
- **`packages/api/src/lib/imageOcrExtractor.ts`** — `extractTextFromImage(buffer: Buffer): Promise<string[]>`: throws `OCR_FAILED` (422) on Tesseract failure. Reused as-is in OCR pipeline (images) and as Vision fallback.
- **`packages/api/src/estimation/engineRouter.ts`** — `runEstimationCascade(opts: EngineRouterOptions): Promise<EngineRouterResult>`: accepts `{ db, query, openAiApiKey, level4Lookup, logger }`. Returns `{ data: EstimateData, levelHit }`. Called once per dish name; total miss yields `data.result === null`.
- **`packages/api/src/lib/cache.ts`** — `buildKey(entity, id)`, `cacheGet`, `cacheSet`: the Redis counter for rate limiting uses the same `redis` singleton. No new Redis abstraction needed — the counter pattern (INCR + EXPIRE) is a direct `redis.incr` / `redis.expire` call.
- **`packages/api/src/lib/redis.ts`** — `redis` singleton: import directly for the INCR/EXPIRE rate-limit counter.
- **`packages/api/src/plugins/auth.ts`** — `request.apiKeyContext` (type `ApiKeyContext`): already set by the global `onRequest` hook for all non-admin, non-health routes. The `analyzeMenu` route reads `request.apiKeyContext?.keyId` and `request.apiKeyContext?.tier` to determine bot exemption.
- **`packages/api/src/errors/errorHandler.ts`** — `mapError`: extend with two new code branches (`MENU_ANALYSIS_FAILED` → 422, `VISION_API_UNAVAILABLE` → 422). Existing codes `INVALID_IMAGE`, `OCR_FAILED`, `RATE_LIMIT_EXCEEDED`, `PROCESSING_TIMEOUT` already handled correctly.
- **`packages/shared/src/schemas/estimate.ts`** — `EstimateDataSchema`, `EstimateData`: reused by reference in `menuAnalysisDishSchema` (`estimate` field). No new estimation schemas.
- **`packages/api/src/routes/ingest/image.ts`** — reference for multipart field parsing loop (`request.parts()`), magic-byte validation pattern, and `Promise.race([processingPromise(), timeoutPromise])` pattern.
- **`packages/api/src/routes/recipeCalculate.ts`** — reference for route plugin structure (`FastifyPluginAsync<PluginOptions>`, `fastifyPlugin` wrapper, `app.post(path, { schema: { ... } }, handler)`).
- **`packages/bot/src/apiClient.ts`** — `postFormData<T>(path, body)` helper and `UPLOAD_TIMEOUT_MS=90_000`: reused for `analyzeMenu`. `ApiError` class for typed error throws.
- **`packages/bot/src/handlers/callbackQuery.ts`** — stubs for `upload_menu` and `upload_dish` branches already exist; replace "coming soon" messages with real implementation.
- **`packages/bot/src/lib/conversationState.ts`** — `BotState`, `getState`, `setState`: read `pendingPhotoFileId` exactly as `upload_ingest` does.
- **`packages/bot/src/handlers/fileUpload.ts`** — `downloadTelegramFile(bot, fileId): Promise<Buffer>`: reuse to download the file before calling `analyzeMenu`.
- **`packages/api/src/lib/pdfParser.ts`** — `extractText(buffer: Buffer): Promise<string[]>`: wraps `pdf-parse` v2 via `PDFParse` class. Returns array of page text strings (one per page). Throws `UNSUPPORTED_PDF` (422) if no extractable text. **Use this instead of importing `pdf-parse` directly.**
- **`packages/api/src/config.ts`** — `config.OPENAI_API_KEY` and `config.BOT_API_KEY_SEED`: no new env vars. The bot key ID is identified via `request.apiKeyContext.tier === 'bot'` — check if `ApiKeyContext` already includes a `'bot'` tier or if matching must be done by `keyId` against a known ID from env. See note in Key Patterns below.

---

### Files to Create

1. **`packages/shared/src/schemas/analysis.ts`**
   - Zod schemas for the entire F034 surface: `AnalyzeMenuModeSchema`, `AnalyzeMenuBodySchema`, `MenuAnalysisDishSchema`, `MenuAnalysisDataSchema`, `MenuAnalysisResponseSchema`.
   - Exported types: `AnalyzeMenuMode`, `AnalyzeMenuBody`, `MenuAnalysisDish`, `MenuAnalysisData`, `MenuAnalysisResponse`.

2. **`packages/api/src/analyze/dishNameParser.ts`**
   - Single export: `parseDishNames(lines: string[]): string[]`.
   - Filters out lines that are purely numeric, shorter than 3 characters, price-like (`/^\d+[,.]?\d*\s*€?$/`), allergen codes (all-caps <= 3 chars), or consist only of punctuation/symbols.
   - Returns remaining lines as dish name candidates. No deduplication.

3. **`packages/api/src/analyze/menuAnalyzer.ts`**
   - Single export: `analyzeMenu(opts: MenuAnalyzerOptions): Promise<MenuAnalysisResult>`.
   - Orchestrates: mode routing → file-type validation (magic bytes: JPEG/PNG/WebP/PDF, reject unknown with `INVALID_IMAGE`) → extraction (OCR/Vision/Identify) → `parseDishNames` → per-dish `runEstimationCascade` loop with partial-result tracking → return.
   - Uses `extractText` from `pdfParser.ts` for PDF text extraction (NOT raw `pdf-parse`). Uses `callVisionCompletion` from `openaiClient.ts` for Vision/Identify (NOT `callChatCompletion` — different message format).
   - `MenuAnalyzerOptions`: `{ fileBuffer: Buffer; mimeType: string; mode: AnalyzeMenuMode; db: Kysely<DB>; openAiApiKey: string | undefined; level4Lookup: Level4LookupFn | undefined; logger: OpenAILogger; signal: AbortSignal }`.
   - `MenuAnalysisResult`: `{ dishes: MenuAnalysisDish[]; partial: boolean; mode: AnalyzeMenuMode }`. **Note:** `mode` echoes the requested mode (e.g., `auto` stays `auto`), NOT the internally resolved pipeline. Internal pipeline selection is not exposed.

4. **`packages/api/src/routes/analyze.ts`**
   - Route plugin: `POST /analyze/menu` — multipart, API-key-required, 60-second timeout.
   - Plugin options: `{ db: Kysely<DB>; prisma: PrismaClient }` (prisma needed to resolve `level4Lookup`; import `level4Lookup` from estimation layer).
   - Exported as `analyzeRoutes = fastifyPlugin(analyzeRoutesPlugin)`.

5. **`packages/api/src/__tests__/f034.dishNameParser.unit.test.ts`**
   - Unit tests for `parseDishNames` — pure function, no mocks needed.

6. **`packages/api/src/__tests__/f034.menuAnalyzer.unit.test.ts`**
   - Unit tests for `analyzeMenu` with all pipeline dependencies mocked (`extractTextFromImage`, `callChatCompletion`, `runEstimationCascade`).

7. **`packages/api/src/__tests__/f034.analyzeMenu.route.test.ts`**
   - Route-level tests for `POST /analyze/menu` using `buildApp().inject()`. Mocks Redis, Prisma, `extractTextFromImage`, `callChatCompletion`, `runEstimationCascade`.

8. **`packages/api/src/__tests__/f034.edge-cases.test.ts`**
   - Edge-case tests: PDF in vision/identify mode → `INVALID_IMAGE`, Vision API absent + image + auto → `VISION_API_UNAVAILABLE`, empty Vision response with fallback, all-null cascade results, rate limit exceeded, bot key exemption, timeout partial results.

9. **`packages/shared/src/__tests__/f034.analysis.schemas.test.ts`**
   - Unit tests for Zod schemas in `analysis.ts`.

10. **`packages/bot/src/__tests__/f034.apiClient.test.ts`**
    - Unit tests for `apiClient.analyzeMenu()` — FormData construction, correct path, timeout.

11. **`packages/bot/src/__tests__/f034.callbackQuery.test.ts`**
    - Unit tests for `upload_menu` and `upload_dish` callback branches — happy path, all error codes, rate limit, partial results flag.

---

### Files to Modify

1. **`packages/shared/src/schemas/analysis.ts`** (new — see above)
2. **`packages/shared/src/index.ts`**
   - Add `export * from './schemas/analysis';` after the `recipeCalculate` export line.

3. **`packages/api/src/errors/errorHandler.ts`**
   - Add two new `if` blocks in `mapError` (after `FREE_FORM_PARSE_FAILED`, before `DUPLICATE_RESTAURANT`):
     - `MENU_ANALYSIS_FAILED` → statusCode 422
     - `VISION_API_UNAVAILABLE` → statusCode 422

4. **`packages/api/src/app.ts`**
   - Import `analyzeRoutes` from `'./routes/analyze.js'`.
   - Register: `await app.register(analyzeRoutes, { db: getKysely(), prisma: prismaClient });` after `recipeCalculateRoutes`.

5. **`packages/api/src/plugins/adminPrefixes.ts`** (check if `/analyze` needs to be excluded from admin prefix list — it should NOT be admin-protected, so verify it is not inadvertently blocked).

6. **`packages/bot/src/apiClient.ts`**
   - Add `MenuAnalysisData` and `MenuAnalysisResponse` to the import from `@foodxplorer/shared`.
   - Add `analyzeMenu` to the `ApiClient` interface.
   - Implement `analyzeMenu` using `postFormData<MenuAnalysisResponse>('/analyze/menu', form)` (no `adminKey` — uses `BOT_API_KEY`).

7. **`packages/bot/src/handlers/callbackQuery.ts`**
   - Replace the `upload_menu` stub with full implementation (retrieve fileId from Redis, download, detect MIME, check per-user rate limit, call `apiClient.analyzeMenu`, format response, clear fileId, handle errors).
   - Replace the `upload_dish` stub with full implementation (same flow but `mode: 'identify'`).

8. **`docs/specs/api-spec.yaml`**
   - Add `Analysis` to global `tags` list.
   - Add `POST /analyze/menu` endpoint definition.
   - Add schemas: `MenuAnalysisDish`, `MenuAnalysisData`, `MenuAnalysisResponse`.

---

### Implementation Order

1. **Shared schemas** — `packages/shared/src/schemas/analysis.ts` and barrel export in `packages/shared/src/index.ts`.
   - Write unit tests first: `packages/shared/src/__tests__/f034.analysis.schemas.test.ts`.
   - Verify `menuAnalysisDataSchema` rejects `dishCount < 1` and `dishes.length < 1`, accepts `partial: false` by default.

2. **Error handler extension** — `packages/api/src/errors/errorHandler.ts`.
   - Write the two new `if` blocks in `mapError`.
   - Add test cases to `packages/api/src/__tests__/errorHandler.test.ts` for `MENU_ANALYSIS_FAILED` → 422 and `VISION_API_UNAVAILABLE` → 422.

3. **`parseDishNames` utility** — `packages/api/src/analyze/dishNameParser.ts`.
   - Write unit tests first: `packages/api/src/__tests__/f034.dishNameParser.unit.test.ts`.
   - Test cases:
     - Purely numeric lines (`"123"`, `"42.5"`) → excluded
     - Lines shorter than 3 chars (`"B"`, `"AB"`) → excluded
     - Price-like lines (`"5,90€"`, `"12.50"`) → excluded
     - Allergen short-codes (`"GLU"`, `"LAC"`) → excluded (all-caps, ≤3 chars)
     - Valid dish names pass through: `"Big Mac"`, `"Ensalada César"`, `"Pollo al ajillo"`.
     - Mixed list returns only valid candidates.
     - Empty input → empty output.
     - Whitespace-only lines → excluded.

4. **`menuAnalyzer.ts` service** — `packages/api/src/analyze/menuAnalyzer.ts`.
   - Write unit tests first: `packages/api/src/__tests__/f034.menuAnalyzer.unit.test.ts`.
   - Mock: `extractTextFromImage`, `callChatCompletion`, `runEstimationCascade`, `parseDishNames` (via `vi.mock`).
   - Test scenarios (all use a mock `AbortSignal`):
     - `mode: 'ocr'` + image buffer → calls `extractTextFromImage` → `parseDishNames` → cascade per dish.
     - `mode: 'ocr'` + PDF buffer (detected by magic bytes `%PDF`) → calls `extractText` from `pdfParser.ts` → split pages by newline → `parseDishNames` → cascade.
     - `mode: 'vision'` + image → calls `callVisionCompletion` with menu-extraction prompt → strips markdown code blocks → parses JSON array → cascade. Verify `maxTokens=2048` is passed.
     - `mode: 'vision'` + image, Vision returns `null` → OCR fallback → cascade.
     - `mode: 'vision'` + PDF → throws `INVALID_IMAGE`.
     - `mode: 'identify'` + image → calls `callVisionCompletion` with dish-identification prompt → strips markdown → takes first name → exactly 1 dish in result.
     - `mode: 'identify'` + image, Vision returns `null` → throws `MENU_ANALYSIS_FAILED` immediately (no OCR fallback).
     - `mode: 'identify'` + PDF → throws `INVALID_IMAGE`.
     - Unknown file type (magic bytes don't match JPEG/PNG/WebP/PDF) → throws `INVALID_IMAGE`.
     - `mode: 'auto'` + PDF → routes to OCR pipeline.
     - `mode: 'auto'` + image + `openAiApiKey` present → routes to Vision pipeline.
     - `mode: 'auto'` + image + `openAiApiKey` absent → throws `VISION_API_UNAVAILABLE`.
     - Zero dish names after extraction → throws `MENU_ANALYSIS_FAILED`.
     - Cascade with all-null results → returns `dishes` array with `estimate: null` per dish, HTTP 200 (no throw).
     - Partial results: `AbortSignal` aborted mid-loop → returns dishes processed so far with `partial: true`.
   - Internal design: the service uses `AbortSignal` to detect timeout (matches `recipeCalculate.ts` pattern). The cascade loop checks `signal.aborted` between iterations.
   - PDF detection: check first 4 bytes for `%PDF` (`0x25 0x50 0x44 0x46`) — consistent with existing magic-byte pattern in ingest routes.
   - Vision prompt constants: define as module-level `const` strings inside `menuAnalyzer.ts` (not separate files). Menu-extraction prompt: `"List all dish names visible in this restaurant menu. Return a JSON array of strings, one dish name per element. Return only the array, no other text."`. Identify prompt: `"Identify the single dish or plate of food shown in this photo. Return a JSON array with exactly one string element containing the dish name."`.
   - JSON parsing: LLMs frequently wrap JSON in markdown code blocks. Strip ```json and ``` markers before parsing. Then `JSON.parse(stripped)` in try/catch; validate result is a non-empty string array. Treat non-array or parse error as empty array → trigger fallback (vision mode) or `MENU_ANALYSIS_FAILED` (identify mode). Helper: `stripMarkdownJson(text: string): string` — remove leading/trailing whitespace, then `text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')`.

5. **Route plugin** — `packages/api/src/routes/analyze.ts`.
   - Write route tests first: `packages/api/src/__tests__/f034.analyzeMenu.route.test.ts`.
   - Mock at top of test: `vi.mock('../lib/redis.js')`, `vi.mock('../lib/openaiClient.js')`, `vi.mock('../lib/imageOcrExtractor.js')`, `vi.mock('../estimation/engineRouter.js')`.
   - Test scenarios:
     - No API key → 401 `UNAUTHORIZED` (auth hook rejects anonymous for non-public routes — verify `/analyze/menu` is not in the public-anonymous path; the auth hook currently passes anonymous through without error, so the route itself must enforce API key presence by checking `request.apiKeyContext`).
     - Valid API key + JPEG + `mode=auto` → 200 with `MenuAnalysisResponse` shape.
     - Valid API key + PDF + `mode=ocr` → 200.
     - Missing `file` part → 400 `VALIDATION_ERROR`.
     - Invalid `mode` value → 400 `VALIDATION_ERROR`.
     - File too large → 413 (handled by `@fastify/multipart` limits already set in `app.ts`).
     - PDF + `mode=vision` → 422 `INVALID_IMAGE`.
     - `OPENAI_API_KEY` absent + image + `mode=auto` → 422 `VISION_API_UNAVAILABLE`.
     - Rate limit exceeded (mock Redis INCR returns > 10) → 429 `RATE_LIMIT_EXCEEDED`.
     - Bot tier key → rate limit check skipped.
     - Timeout (mock `AbortController.abort()` mid-cascade) → 200 with `partial: true`.
   - Route implementation details:
     - Parse multipart stream using `request.parts()` loop (same as `ingest/image.ts`).
     - Validate `mode` field via `AnalyzeMenuBodySchema.safeParse(fields)`.
     - Guard: if no `request.apiKeyContext` (anonymous) → throw `UNAUTHORIZED`.
     - Rate limit guard (before calling `analyzeMenu`): if `request.apiKeyContext.tier !== 'bot'`, run INCR/EXPIRE counter. On Redis failure → fail-open (catch error, log warn, proceed). If counter > 10 → throw `RATE_LIMIT_EXCEEDED`.
     - Counter key: `fxp:analyze:hourly:<keyHash>` where `keyHash = sha256(request.apiKeyContext.keyId)`. TTL: 3600 seconds. Use `redis.incr(key)` then `redis.expire(key, 3600, 'NX')` (NX = set expiry only if not already set, preserving the window).
     - Timeout: `AbortController` + `Promise.race` — same pattern as `recipeCalculate.ts`. Timeout = 60 seconds. On abort → return `{ success: true, data: { mode, dishCount: dishes.length, dishes, partial: true } }` using the partial results captured by `analyzeMenu`.
     - The route does NOT cache results (stateless analysis, highly variable input).
     - Magic bytes: defer to `analyzeMenu` service for MIME detection (do not validate at route level beyond what multipart gives).
     - Response assembly: `{ success: true, data: { mode: result.mode, dishCount: result.dishes.length, dishes: result.dishes, partial: result.partial } }`. Note: `mode` echoes the requested mode (e.g., `auto` stays `auto` even if the runtime chose OCR or Vision internally).

6. **Register route in `app.ts`** — import and register `analyzeRoutes`.

7. **`errorHandler.ts` integration test update** — add the two new codes to `packages/api/src/__tests__/errorHandler.test.ts`.

8. **Edge-case tests** — `packages/api/src/__tests__/f034.edge-cases.test.ts`.
   - PDF magic bytes detection: `%PDF` buffer + `mode=ocr` routes to pdf-parse, not `extractTextFromImage`.
   - Empty Vision response (`"[]"`) + vision mode → OCR fallback.
   - Empty Vision response + identify mode → `MENU_ANALYSIS_FAILED` (no fallback).
   - Vision API absent + PDF + auto → OCR succeeds (no `VISION_API_UNAVAILABLE`).
   - All-null cascade → 200 with `dishes` all having `estimate: null`.
   - Duplicate dish names passed as separate cascade calls (no deduplication).
   - Rate limit Redis failure → fail-open (request proceeds).

9. **Bot `apiClient.ts`** — add `analyzeMenu` method.
   - Write tests first: `packages/bot/src/__tests__/f034.apiClient.test.ts`.
   - Test: correct path `/analyze/menu`, FormData with `file` and `mode` fields, uses `UPLOAD_TIMEOUT_MS`, returns `MenuAnalysisData`.
   - MIME detection in bot: check buffer magic bytes before calling `analyzeMenu` to set `filename` extension (`photo.jpg` for JPEG, `photo.png` for PNG, `photo.webp` for WebP, `document.pdf` for PDF). The MIME type is passed as the Blob type in FormData — matches `ingest/image.ts` pattern.

10. **Bot `callbackQuery.ts`** — implement `upload_menu` and `upload_dish` branches.
    - Write tests first: `packages/bot/src/__tests__/f034.callbackQuery.test.ts`.
    - Test scenarios per branch:
      - Happy path `upload_menu`: retrieves `pendingPhotoFileId`, downloads file, calls `apiClient.analyzeMenu(buffer, 'photo.jpg', 'image/jpeg', 'auto')`, formats result, clears fileId.
      - Happy path `upload_dish`: same but `mode='identify'`, expects exactly 1 dish in formatted response.
      - `pendingPhotoFileId` absent → error message, return.
      - Download fails → error message, return.
      - Rate limit check exceeded (Redis counter > 5) → localised rate limit notice, no API call.
      - API returns `MENU_ANALYSIS_FAILED` → user-friendly message in Spanish.
      - API returns `INVALID_IMAGE` → user-friendly message.
      - API returns `OCR_FAILED` → user-friendly message.
      - API returns `VISION_API_UNAVAILABLE` → user-friendly message.
      - API returns `RATE_LIMIT_EXCEEDED` → rate limit notice.
      - `partial: true` in response → note added to formatted output.
      - Dish with `estimate: null` → shows name + "(sin datos)".
      - `pendingPhotoFileId` cleared from state after processing (both success and error paths that produce API errors).
    - Per-user rate limit implementation:
      - Counter key: `fxp:analyze:bot:<chatId>` (TTL 3600s).
      - Pattern: `redis.incr(key)` → if result > 5 → send rate limit notice, return. Then `redis.expire(key, 3600, 'NX')`.
      - Redis failure → fail-open (catch error, proceed).
    - Formatting for `upload_menu` response (MarkdownV2):
      - Header line: `Platos encontrados en el menú: N` (escaped).
      - If `partial: true`: `(resultados parciales por timeout)` on second line.
      - Per dish: `• DishName: Kcal cal | Proteínas: Xg | Grasas: Xg | HC: Xg` when estimate non-null.
      - Per dish (null estimate): `• DishName _(sin datos)_`.
    - Formatting for `upload_dish` response (MarkdownV2):
      - Single dish with all 14 nutrient fields (use `estimateFormatter.ts` patterns if applicable).

11. **`api-spec.yaml`** — Already updated in Step 0 (Spec). Verify final implementation matches the spec; update if any deviations occurred during implementation.

12. **`callVisionCompletion` in `openaiClient.ts`** — Add new exported function for multimodal Vision API calls.
    - Write tests first in existing `packages/api/src/__tests__/openaiClient.test.ts` (or create `f034.openaiClient.test.ts` if the file doesn't exist).
    - Signature: `callVisionCompletion(apiKey: string, imageBase64: string, mimeType: string, prompt: string, logger?: OpenAILogger, maxTokens?: number): Promise<string | null>`.
    - Internally constructs: `messages: [{ role: 'user' as const, content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: \`data:${mimeType};base64,${imageBase64}\` } }] }]`.
    - Same retry logic as `callChatCompletion` (2 attempts, 1s backoff).
    - Returns raw content string or null. Never throws.
    - This step should be done BEFORE step 4 (menuAnalyzer) since the service depends on it.

---

### Testing Strategy

**Test files to create:**

| File | Type | What it tests |
|------|------|--------------|
| `packages/shared/src/__tests__/f034.analysis.schemas.test.ts` | Unit | Zod schema validation for all analysis schemas |
| `packages/api/src/__tests__/f034.dishNameParser.unit.test.ts` | Unit | `parseDishNames` — filter rules, edge cases, empty input |
| `packages/api/src/__tests__/f034.menuAnalyzer.unit.test.ts` | Unit | `analyzeMenu` — all mode routing branches, fallback logic, partial results |
| `packages/api/src/__tests__/f034.analyzeMenu.route.test.ts` | Route integration | `POST /analyze/menu` — full request/response cycle, auth, rate limit, validation |
| `packages/api/src/__tests__/f034.edge-cases.test.ts` | Edge cases | PDF detection, Vision fallback, all-null results, Redis failure fail-open |
| `packages/bot/src/__tests__/f034.apiClient.test.ts` | Unit | `apiClient.analyzeMenu` — FormData, path, timeout |
| `packages/bot/src/__tests__/f034.callbackQuery.test.ts` | Unit | `upload_menu` and `upload_dish` branches — happy path, all error codes, rate limit |

**Existing test file to modify:**
- `packages/api/src/__tests__/errorHandler.test.ts` — add `MENU_ANALYSIS_FAILED` → 422 and `VISION_API_UNAVAILABLE` → 422 cases.

**Key test scenarios:**

- Happy path (vision, identify, ocr image, ocr PDF, auto+image, auto+PDF) → 200 with correct shape.
- All cascade misses → 200 with `estimate: null` per dish (not an error).
- Partial timeout → 200 with `partial: true` and processed dishes subset.
- Anonymous request → 401.
- Rate limit > 10/hour → 429 (API level).
- Bot tier key → rate limit skip.
- PDF + vision/identify → 422 `INVALID_IMAGE`.
- No OpenAI key + image + auto → 422 `VISION_API_UNAVAILABLE`.
- No OpenAI key + PDF + auto → 200 (OCR path, no key needed).
- Missing file part → 400.
- Invalid mode → 400.
- File > 10 MB → 413.
- Vision returns `null` + vision mode → OCR fallback → success.
- Vision returns `null` + identify mode → `MENU_ANALYSIS_FAILED`.
- Redis INCR failure → fail-open.

**Mocking strategy:**

- `vi.mock('../lib/imageOcrExtractor.js')` — mock `extractTextFromImage` in service and route tests.
- `vi.mock('../lib/openaiClient.js')` — mock `callChatCompletion` to return controlled JSON strings.
- `vi.mock('../estimation/engineRouter.js')` — mock `runEstimationCascade` to return controllable `EstimateData` or total-miss result.
- `vi.mock('../lib/redis.js')` — mock `redis.get`, `redis.set`, `redis.incr`, `redis.expire` for rate limit counter tests.
- `vi.mock('../lib/prisma.js')` — minimal mock (needed for `buildApp`; not used by analyze route).
- `vi.mock('kysely')` — mock `sql` tagged template (same pattern as `f035.recipeCalculate.route.test.ts`).
- Bot tests: mock `apiClient` as injectable interface; mock `redis.incr`/`redis.expire` for per-user rate limit.
- `pdfParser` mock in `menuAnalyzer` unit tests: `vi.mock('../lib/pdfParser.js', () => ({ extractText: vi.fn() }))`.
- `callVisionCompletion` mock: `vi.mock('../lib/openaiClient.js')` — mock both `callChatCompletion` and `callVisionCompletion`.

---

### Key Patterns

**Multipart parsing** — follow `packages/api/src/routes/ingest/image.ts` exactly: `for await (const part of request.parts())` loop, drain extra file parts, collect text fields into `fields: Record<string, string>`, buffer the first file part. Guard `fileBuffer === undefined` before Zod parsing.

**Timeout with partial results (cooperative cancellation only)** — the `analyzeMenu` service accepts an `AbortSignal`. The route creates an `AbortController`, starts a 60s timer, and simply `await`s the `analyzeMenu` call. **No `Promise.race`** — `analyzeMenu` handles the signal cooperatively: it checks `signal.aborted` between cascade iterations and returns `{ dishes: processedSoFar, partial: true }` when aborted. The route handler never sees an abort error. Pattern:

```
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 60_000);
const result = await analyzeMenu({ ..., signal: controller.signal });
clearTimeout(timer);
return reply.status(200).send({ success: true, data: buildResponseData(result) });
```

Inside `analyzeMenu`, the cascade loop:
```
for (const dishName of dishNames) {
  if (signal.aborted) return { dishes: processedDishes, partial: true, mode };
  const cascadeResult = await runEstimationCascade({ ... });
  processedDishes.push({ dishName, estimate: cascadeResult?.data ?? null });
}
return { dishes: processedDishes, partial: false, mode };
```

**Rate limit counter** — direct Redis INCR pattern (not via `cacheGet`/`cacheSet`):
```typescript
const counter = await redis.incr(counterKey);
if (counter === 1) {
  // First request in this window — set TTL (NX: only if key has no expiry)
  await redis.expire(counterKey, 3600, 'NX');
}
if (counter > 10) {
  throw Object.assign(new Error('Rate limit exceeded'), { code: 'RATE_LIMIT_EXCEEDED' });
}
```
Wrap in try/catch to fail-open on Redis error.

**Bot tier exemption** — `request.apiKeyContext.tier` is `'free' | 'pro'` per the existing `CachedApiKey` type in `auth.ts`. There is no `'bot'` tier in the current schema. The exemption must therefore be implemented by matching `request.apiKeyContext.keyId` against a known bot key ID. Add `BOT_KEY_ID` to `config.ts` as `BOT_KEY_ID: z.string().uuid().optional()`. In the route, check `request.apiKeyContext.keyId === config.BOT_KEY_ID` to skip the hourly counter. If `BOT_KEY_ID` is absent from env (e.g. in tests), the exemption is simply never triggered. Document this in the route comment.

**Vision API call** — Use the new `callVisionCompletion(apiKey, imageBase64, mimeType, prompt, logger, maxTokens)` function. Convert buffer to base64: `fileBuffer.toString('base64')`. The function constructs the multimodal content array with `image_url` containing a data URI (`data:${mimeType};base64,${base64}`). `maxTokens` defaults to 2048 for F034 calls.

**Vision response JSON parsing** — `callVisionCompletion` returns a raw string. LLMs frequently wrap JSON in markdown code blocks (```json ... ```). Before parsing: strip leading/trailing whitespace, then strip ```json and ``` markers if present. Then `JSON.parse(stripped)` inside a try/catch; validate the result is a non-empty string array. If parsing fails or result is empty: for `vision` mode trigger OCR fallback; for `identify` mode throw `MENU_ANALYSIS_FAILED`. The retry logic is internal to `callVisionCompletion` — no additional retry needed.

**File-type validation in `menuAnalyzer`** — Validate magic bytes BEFORE any processing. Supported formats:
- JPEG: `0xFF 0xD8 0xFF` (3 bytes)
- PNG: `0x89 0x50 0x4E 0x47` (4 bytes)
- WebP: `0x52 0x49 0x46 0x46` at [0] + `0x57 0x45 0x42 0x50` at [8] (12 bytes)
- PDF: `0x25 0x50 0x44 0x46` (4 bytes, `%PDF`)
If none match → throw `INVALID_IMAGE` (422) immediately, before any OCR/Vision work. This prevents ambiguous errors like `OCR_FAILED` on unsupported file types. Export a helper `detectFileType(buffer: Buffer): 'jpeg' | 'png' | 'webp' | 'pdf'` that throws `INVALID_IMAGE` on unknown. Use `buffer.length >= 4` guard (>= 12 for WebP).

**PDF text extraction** — Use `extractText(buffer)` from `packages/api/src/lib/pdfParser.ts` (NOT raw `pdf-parse` import). Returns `string[]` (one string per page). Split each page string by `'\n'` to get individual lines, then flatten into a single line array before passing to `parseDishNames`. If `extractText` throws `UNSUPPORTED_PDF` (image-based PDF with no text), catch and throw `MENU_ANALYSIS_FAILED` (422) with a descriptive message.

**Bot MIME detection** — detect from buffer magic bytes in the callback handler before calling `analyzeMenu`:
- JPEG: `0xFF 0xD8 0xFF` → `{ mimeType: 'image/jpeg', filename: 'photo.jpg' }`
- PNG: `0x89 0x50 0x4E 0x47` → `{ mimeType: 'image/png', filename: 'photo.png' }`
- WebP: `0x52 0x49 0x46 0x46` + offset 8: `0x57 0x45 0x42 0x50` → `{ mimeType: 'image/webp', filename: 'photo.webp' }`
- PDF: `0x25 0x50 0x44 0x46` → `{ mimeType: 'application/pdf', filename: 'document.pdf' }`
- Unknown: default to `{ mimeType: 'image/jpeg', filename: 'photo.jpg' }` (Telegram photos are always JPEG-compressed).

**`fastifyPlugin` wrapper** — every route plugin must be wrapped in `fastifyPlugin` so it registers on the root scope, allowing the global error handler to apply. See `recipeCalculate.ts` and `ingest/image.ts` for the established pattern.

**No `any` types** — the `analyzeMenu` service must be fully typed. Use `OpenAILogger` from `openaiClient.ts` for the logger parameter. The `Level4LookupFn` type is exported from `engineRouter.ts`.

**`api-spec.yaml` tag** — the `Analysis` tag must be added to the top-level `tags` array (not just inline on the endpoint). Follow the existing tag entries for `Catalog`, `Calculation`, etc. for format reference.

**Gotcha — auth hook behavior** — the global `onRequest` hook in `auth.ts` does NOT reject anonymous requests; it simply skips setting `request.apiKeyContext`. The route itself must enforce key presence by checking `if (!request.apiKeyContext)` and throwing `UNAUTHORIZED`. This is the correct pattern — other public endpoints (estimate, catalog) may allow anonymous calls, but `POST /analyze/menu` requires a key per spec.

**Gotcha — `level4Lookup` injection** — `runEstimationCascade` requires a `level4Lookup` function for LLM-assisted matching. Import `level4Lookup` from `packages/api/src/estimation/level4Lookup.ts` in the route plugin (same as `estimate.ts` route) and pass it through `menuAnalyzer`. If the Kysely `db` instance is needed, import `getKysely()` from `lib/kysely.ts`.

**Gotcha — use `pdfParser.ts` wrapper, not raw `pdf-parse`** — The project uses `pdf-parse` v2 via a `PDFParse` class wrapper at `packages/api/src/lib/pdfParser.ts`. Import `extractText` from there. Do NOT import `pdf-parse` directly — the API differs between v1 and v2, and the wrapper handles the v2 class API correctly.

**Gotcha — test isolation for Redis INCR** — the rate limit counter uses `redis.incr` and `redis.expire`, not `cacheGet`/`cacheSet`. Route tests must mock these methods explicitly on the Redis mock. Add `mockRedisIncr` and `mockRedisExpire` alongside `mockRedisGet`/`mockRedisSet` in test setup (see `f035.recipeCalculate.route.test.ts` mock pattern for reference).

---

### Bot Integration Plan

#### Existing Code to Reuse

- **`packages/bot/src/apiClient.ts`** — `postFormData<T>(path, body, adminKey?)` private helper and `UPLOAD_TIMEOUT_MS = 90_000`: reused as-is for `analyzeMenu`. The new method uses `BOT_API_KEY` (no `adminKey` argument), unlike `uploadImage`/`uploadPdf` which use `ADMIN_API_KEY`.
- **`packages/bot/src/handlers/fileUpload.ts`** — `downloadTelegramFile(bot, fileId): Promise<Buffer>` and `MAX_FILE_SIZE_BYTES`: imported in `callbackQuery.ts` already; reuse the same import for the new branches. No changes to `fileUpload.ts` itself.
- **`packages/bot/src/handlers/callbackQuery.ts`** — `upload_menu` and `upload_dish` branches already exist as stubs; replace the stub body while keeping `safeAnswerCallback`, `ALLOWED_CHAT_IDS` guard, and `escapeMarkdown` usage patterns intact. The existing `upload_ingest` implementation is the structural reference.
- **`packages/bot/src/lib/conversationState.ts`** — `getState`, `setState`, `BotState`: retrieve `pendingPhotoFileId` and clear it after processing, exactly as `upload_ingest` does.
- **`packages/bot/src/formatters/estimateFormatter.ts`** — `formatEstimate(data: EstimateData): string`: used in the `upload_dish` response to render the full nutrient card for the single identified dish when its estimate is non-null.
- **`packages/bot/src/formatters/markdownUtils.ts`** — `escapeMarkdown`, `formatNutrient`: used in the `upload_menu` compact list formatter to escape interpolated values and format calorie/macro numbers.
- **`packages/bot/src/handlers/callbackQuery.ts` imports** — `ApiError` from `../apiClient.js`, `logger` from `../logger.js`, `handleApiError` from `../commands/errorMessages.js`: all already imported; reuse for error branches.
- **`packages/shared`** — `MenuAnalysisData`, `MenuAnalysisDish` types (created in the backend plan step 1): import in `apiClient.ts` from `@foodxplorer/shared`.

#### Files to Create

1. **`packages/bot/src/__tests__/f034.apiClient.test.ts`**
   - Unit tests for the new `apiClient.analyzeMenu()` method.
   - Mirrors the structure of `f031.apiClient.test.ts` — `beforeAll` dynamic import, `vi.stubGlobal('fetch', fetchMock)` per test, `makeResponse` helper, `afterEach(() => vi.unstubAllGlobals())`.

2. **`packages/bot/src/__tests__/f034.callbackQuery.test.ts`**
   - Unit tests for the `upload_menu` and `upload_dish` branches in `handleCallbackQuery`.
   - Mirrors the structure of `f031.callbackQuery.test.ts` — `makeMockRedis`, `makeMockBot`, `makeMockClient` factories, `makeQuery` helper, `TEST_CONFIG_ALLOWED`/`TEST_CONFIG_BLOCKED` fixtures, `beforeEach(() => vi.clearAllMocks())`.
   - The Redis mock must include `incr` and `expire` alongside the existing `get`/`set`/`del` methods.

#### Files to Modify

1. **`packages/bot/src/apiClient.ts`**
   - Add `MenuAnalysisData` to the import from `@foodxplorer/shared` (alongside `DishListItem`, `EstimateData`, etc.).
   - Add `analyzeMenu` to the `ApiClient` interface with the signature from the spec:
     ```
     analyzeMenu(params: { fileBuffer: Buffer; filename: string; mimeType: string; mode: 'auto' | 'ocr' | 'vision' | 'identify' }): Promise<MenuAnalysisData>
     ```
   - Implement `analyzeMenu` in the returned object: build a `FormData`, append `file` as `new Blob([new Uint8Array(params.fileBuffer)], { type: params.mimeType })` with `params.filename`, append `mode` as a string field, call `postFormData<{ success: true; data: MenuAnalysisData }>('/analyze/menu', form)` — note: no `adminKey`, so `BOT_API_KEY` is used automatically. Return `envelope.data` (but since `postFormData` already unwraps the envelope, type the generic as `MenuAnalysisData` directly).

2. **`packages/bot/src/handlers/callbackQuery.ts`**
   - Add `analyzeMenu` to the `ApiClient` import (already typed via the interface, no import change needed beyond the interface update).
   - Replace the `upload_menu` stub with full implementation (see Implementation Order below).
   - Replace the `upload_dish` stub with full implementation.
   - Add a new `formatMenuAnalysis` helper function (private to the module) for the `upload_menu` compact list format.
   - Add a new `formatDishAnalysis` helper function (private to the module) for the `upload_dish` full nutrient card format.
   - Add a new `detectMime` helper function (private to the module) to map buffer magic bytes to `{ mimeType, filename }`.
   - Update the Redis mock type in the function signature — `redis` already accepts `incr` and `expire` via the `Redis` type from ioredis; no signature change needed.

#### Implementation Order

**Step 1 — shared type availability (backend plan step 1 must complete first)**

The bot plan depends on `MenuAnalysisData` being exported from `@foodxplorer/shared`. Do not start bot steps until the backend plan's step 1 (shared schemas) is complete and the package builds successfully.

**Step 2 — `apiClient.analyzeMenu` (TDD)**

Write `packages/bot/src/__tests__/f034.apiClient.test.ts` first, then implement the method.

Test cases (mirror `f031.apiClient.test.ts` structure for each assertion):

- Calls `POST /analyze/menu` URL (verify `url.includes('/analyze/menu')`).
- Uses `POST` method.
- Sends `FormData` body (`body instanceof FormData`).
- Does NOT manually set `Content-Type` header (fetch boundary auto-set).
- Uses `X-API-Key: BOT_API_KEY` (not `ADMIN_API_KEY` — this is a key difference from `uploadImage`).
- Sends `X-FXP-Source: bot` header.
- `file` field is a `Blob` instance.
- `mode` field equals the passed mode string (`form.get('mode') === 'auto'`).
- Returns `MenuAnalysisData` from the parsed envelope (`data.dishes`, `data.dishCount`, `data.mode`).
- Throws `ApiError` on non-2xx response — test with 422 `MENU_ANALYSIS_FAILED`.
- Throws `ApiError(0, NETWORK_ERROR)` on fetch rejection.
- Throws `ApiError(408, TIMEOUT)` when `AbortError` is raised (mock fetch to call the AbortController signal — or verify the timeout constant is `UPLOAD_TIMEOUT_MS = 90_000`).

**Step 3 — `upload_menu` and `upload_dish` callback handlers (TDD)**

Write `packages/bot/src/__tests__/f034.callbackQuery.test.ts` first, then implement both branches.

The `makeMockRedis` factory in this test file must add `incr` and `expire` to match the rate-limit pattern:
```
function makeMockRedis() {
  return {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    incr: vi.fn().mockResolvedValue(1),    // default: first request, under limit
    expire: vi.fn().mockResolvedValue(1),
  } as unknown as Redis;
}
```

The `makeMockClient` factory must add `analyzeMenu` alongside existing methods:
```
analyzeMenu: vi.fn(),
```

The `makeMockBot` factory must include `getFileLink` (already present in `f031.callbackQuery.test.ts` — copy as-is):
```
getFileLink: vi.fn().mockResolvedValue('https://telegram.org/file/bot-token/file_id'),
```

Also stub `fetch` globally in `beforeEach` for file download calls (same pattern as `f031.callbackQuery.test.ts`):
```
fetchMock = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
vi.stubGlobal('fetch', fetchMock);
```

**Test scenarios for `upload_menu` describe block:**

1. `always dismisses spinner via answerCallbackQuery` — mock Redis `get` to return `null`; verify `bot.answerCallbackQuery` called with `'query-id-001'`.

2. `ALLOWED_CHAT_IDS guard: silent ignore for blocked chat` — use `TEST_CONFIG_BLOCKED`; verify `bot.sendMessage` not called.

3. `sends error when pendingPhotoFileId is absent` — Redis `get` returns state with `selectedRestaurant` but no `pendingPhotoFileId`; verify `bot.sendMessage` called once with text containing `'foto'` (or equivalent), `analyzeMenu` not called.

4. `happy path: downloads file, calls analyzeMenu with mode "auto", formats result` — Redis `get` returns state with `pendingPhotoFileId: 'file-id-123'`; `bot.getFileLink` resolves; `fetch` returns JPEG magic bytes buffer (`0xFF 0xD8 0xFF`); `apiClient.analyzeMenu` resolves with a `MenuAnalysisData` payload (2 dishes, one with estimate, one null). Assert:
   - `bot.getFileLink` called with `'file-id-123'`.
   - `analyzeMenu` called with `{ fileBuffer: Buffer, filename: 'photo.jpg', mimeType: 'image/jpeg', mode: 'auto' }`.
   - `bot.sendMessage` last call contains `'Platos encontrados'` and uses `parse_mode: 'MarkdownV2'`.
   - `bot.sendMessage` last call contains the dish name of the non-null estimate entry.
   - `bot.sendMessage` last call contains `'sin datos'` for the null estimate entry.

5. `clears pendingPhotoFileId from Redis after successful analysis` — after happy path, verify `redis.set` called once and the serialised state has no `pendingPhotoFileId` key.

6. `partial: true — adds timeout note to response` — `analyzeMenu` resolves with `partial: true`; verify message contains `'parciales'` or `'timeout'`.

7. `rate limit exceeded: does not call analyzeMenu, sends rate limit notice` — `redis.incr` resolves with `6` (> 5 limit); verify `analyzeMenu` not called and message mentions `'límite'` or `'intentalo'`.

8. `rate limit Redis failure: fail-open — proceeds to call analyzeMenu` — `redis.incr` rejects with an error; verify `analyzeMenu` still called.

9. `rate limit counter not exceeded: calls redis.expire with NX on first request` — `redis.incr` returns `1`; verify `redis.expire` called with `('fxp:analyze:bot:123', 3600, 'NX')`.

10. `API error MENU_ANALYSIS_FAILED: sends Spanish user message` — `analyzeMenu` rejects with `new ApiError(422, 'MENU_ANALYSIS_FAILED', '...')`; verify message contains localized text (e.g. `'analizar'` or `'menú'`).

11. `API error INVALID_IMAGE: sends Spanish user message` — `analyzeMenu` rejects with `new ApiError(422, 'INVALID_IMAGE', '...')`; verify message contains localised text.

12. `API error OCR_FAILED: sends Spanish user message` — `analyzeMenu` rejects with `new ApiError(422, 'OCR_FAILED', '...')`; verify message contains localised text.

13. `API error VISION_API_UNAVAILABLE: sends Spanish user message` — `analyzeMenu` rejects with `new ApiError(422, 'VISION_API_UNAVAILABLE', '...')`; verify message contains localised text.

14. `API error RATE_LIMIT_EXCEEDED (from API): sends rate limit notice` — `analyzeMenu` rejects with `new ApiError(429, 'RATE_LIMIT_EXCEEDED', '...')`; verify message mentions rate limit.

15. `clears pendingPhotoFileId even when API returns error` — on any API error path that reaches the API call, verify `redis.set` is called and the serialised state has no `pendingPhotoFileId`.

16. `MIME detection: PNG magic bytes → filename photo.png and mimeType image/png` — stub `fetch` to return `ArrayBuffer` with bytes `[0x89, 0x50, 0x4E, 0x47]`; verify `analyzeMenu` called with `filename: 'photo.png'` and `mimeType: 'image/png'`.

17. `MIME detection: PDF magic bytes → filename document.pdf and mimeType application/pdf` — stub `fetch` to return buffer starting with `0x25 0x50 0x44 0x46`; verify `analyzeMenu` called with `filename: 'document.pdf'` and `mimeType: 'application/pdf'`.

18. `MIME detection: unknown magic bytes → defaults to image/jpeg, photo.jpg` — stub `fetch` to return all-zero buffer; verify `analyzeMenu` called with `filename: 'photo.jpg'` and `mimeType: 'image/jpeg'`.

**Test scenarios for `upload_dish` describe block (shorter — shares structure):**

1. `always dismisses spinner via answerCallbackQuery`.
2. `ALLOWED_CHAT_IDS guard: silent ignore for blocked chat`.
3. `sends error when pendingPhotoFileId is absent`.
4. `happy path: calls analyzeMenu with mode "identify", formats single dish with full nutrients` — `analyzeMenu` resolves with 1 dish; verify `analyzeMenu` called with `mode: 'identify'`; verify last `bot.sendMessage` contains dish name; verify `parse_mode: 'MarkdownV2'`.
5. `clears pendingPhotoFileId from Redis after successful analysis`.
6. `API error MENU_ANALYSIS_FAILED: sends Spanish user message`.
7. `API error INVALID_IMAGE: sends Spanish user message`.
8. `rate limit exceeded: does not call analyzeMenu`.

#### Implementation Details for `callbackQuery.ts`

**`detectMime(buffer: Buffer)` private helper:**

Check magic bytes at fixed offsets. Order: WebP before generic RIFF (WebP has `RIFF` at [0] and `WEBP` at [8]). Return object `{ mimeType: string; filename: string }`. Default fallback is `{ mimeType: 'image/jpeg', filename: 'photo.jpg' }`. This is a pure synchronous function — no async needed.

Magic byte checks:
- JPEG: `buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF`
- PNG: `buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47`
- WebP: `buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50`
- PDF: `buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46`

**Per-user rate limit check (shared logic for both branches):**

Extract into a private helper `checkBotRateLimit(redis: Redis, chatId: number): Promise<boolean>` that returns `true` if the limit is exceeded, `false` to proceed. Implementation:
1. `const key = `fxp:analyze:bot:${chatId}`;`
2. Wrap in `try/catch` — on error, return `false` (fail-open).
3. `const count = await redis.incr(key);`
4. `if (count === 1) { await redis.expire(key, 3600, 'NX'); }` — set TTL only on first increment of the window.
5. `return count > 5;`

**`formatMenuAnalysis(data: MenuAnalysisData): string` private helper:**

Build a MarkdownV2 string:
- Line 1: `*Platos encontrados en el menú: ${escapeMarkdown(String(data.dishCount))}*`
- If `data.partial === true`: Line 2: `_\\(resultados parciales por timeout\\)_`
- Blank line separator.
- Per dish in `data.dishes`:
  - If `dish.estimate?.result` is non-null: `• ${escapeMarkdown(dish.dishName)}: ${formatNutrient(n.calories, 'kcal')} \\| Prot: ${formatNutrient(n.proteins, 'g')} \\| Grasas: ${formatNutrient(n.fats, 'g')} \\| HC: ${formatNutrient(n.carbohydrates, 'g')}`
  - If estimate is null or `estimate.result` is null: `• ${escapeMarkdown(dish.dishName)} _\\(sin datos\\)_`

The `|` character in MarkdownV2 must be escaped as `\|`. Use `\\|` in template literals. Import `formatNutrient` from `../formatters/markdownUtils.js`.

**`formatDishAnalysis(data: MenuAnalysisData): string` private helper:**

- Take `data.dishes[0]` (guaranteed by `identify` mode spec to be exactly 1 entry).
- If `dish.estimate` is non-null and `dish.estimate.result` is non-null: delegate to `formatEstimate(dish.estimate)` from `../formatters/estimateFormatter.js` to get the full nutrient card (reusing all 14 fields, portion, chain, confidence).
- Otherwise: return `escapeMarkdown(`${dish.dishName}: sin datos nutricionales.`)`.

**Full flow for `upload_menu` branch (replace stub):**

```
1. await safeAnswerCallback(bot, query.id)
2. if (!config.ALLOWED_CHAT_IDS.includes(chatId)) return
3. const state = await getState(redis, chatId)
4. if (!state?.pendingPhotoFileId) → send error message, return
5. await bot.sendMessage(chatId, 'Analizando menú…')
6. let fileBuffer: Buffer
7. try { fileBuffer = await downloadTelegramFile(bot, state.pendingPhotoFileId) } catch → send download error, return
8. const { mimeType, filename } = detectMime(fileBuffer)
9. const rateLimited = await checkBotRateLimit(redis, chatId)
10. if (rateLimited) → send rate limit message, return
11. try {
      const result = await apiClient.analyzeMenu({ fileBuffer, filename, mimeType, mode: 'auto' })
      await setState(redis, chatId, { ...state, pendingPhotoFileId: undefined })
      await bot.sendMessage(chatId, formatMenuAnalysis(result), { parse_mode: 'MarkdownV2' })
    } catch (err) {
      await setState(redis, chatId, { ...state, pendingPhotoFileId: undefined })
      // map ApiError codes to Spanish messages; fallback to handleApiError(err)
      await bot.sendMessage(chatId, formatAnalysisError(err), { parse_mode: 'MarkdownV2' })
    }
12. return
```

Note: `pendingPhotoFileId` is cleared in BOTH the success and the error catch (after an API call attempt). It is NOT cleared if the error occurs before the API call (download failure, rate limit) — in those cases the user may retry by pressing the button again, but since the fileId was already in state from `handlePhoto`, clearing it on rate limit would be user-hostile. The spec says "clear after processing" — interpret as: clear after an API call attempt concludes (success or API-level error). For download failure and rate limit, do NOT clear.

**`formatAnalysisError(err: unknown): string` private helper:**

Map known `ApiError` codes to Spanish user messages:
- `MENU_ANALYSIS_FAILED`: `'No se pudo analizar el menú. Asegúrate de que la foto muestra un menú legible.'`
- `INVALID_IMAGE`: `'Formato de imagen no válido. Envía una foto en formato JPEG, PNG, WebP o un PDF.'`
- `OCR_FAILED`: `'No se pudo leer el texto del menú. Intenta con una foto de mayor calidad.'`
- `VISION_API_UNAVAILABLE`: `'El servicio de análisis de imagen no está disponible en este momento.'`
- `RATE_LIMIT_EXCEEDED` (from API): `'Se ha superado el límite de análisis. Inténtalo más tarde.'`
- All other `ApiError` or unknown errors: fall through to `handleApiError(err)` from `../commands/errorMessages.js`.

All strings must be wrapped in `escapeMarkdown(...)`.

**Full flow for `upload_dish` branch:**

Identical to `upload_menu` except:
- Progress message: `'Identificando plato…'`
- `mode: 'identify'` passed to `apiClient.analyzeMenu`.
- Response formatted via `formatDishAnalysis(result)` instead of `formatMenuAnalysis(result)`.

#### Testing Strategy

**Test files to create:**

| File | Type | What it tests |
|------|------|--------------|
| `packages/bot/src/__tests__/f034.apiClient.test.ts` | Unit | `apiClient.analyzeMenu` — FormData fields, path, method, API key, return type, error propagation |
| `packages/bot/src/__tests__/f034.callbackQuery.test.ts` | Unit | `upload_menu` and `upload_dish` branches — happy path, MIME detection, rate limit, all API error codes, state clearing |

**Mocking strategy:**

- `fetch` — `vi.stubGlobal('fetch', fetchMock)` in `beforeEach`; `vi.unstubAllGlobals()` in `afterEach`. Mock returns `{ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }` by default (simulates a JPEG download returning an 8-byte buffer, which will default to `image/jpeg` via magic byte detection since bytes are all zero — add a specific test case for each MIME type using correctly-prefixed `ArrayBuffer` content).
- `redis` — `makeMockRedis()` factory with `get`, `set`, `del`, `incr`, `expire` as `vi.fn()`. Default `incr` mock returns `1` (first call, under limit). Override per test for rate limit scenarios.
- `apiClient` — `makeMockClient()` factory adds `analyzeMenu: vi.fn()` returning a resolved `MenuAnalysisData` fixture by default.
- `bot.getFileLink` — already mocked in `makeMockBot()` returning a URL string; default `fetch` mock handles the download.

**Key MenuAnalysisData fixture for tests:**

```typescript
const MENU_ANALYSIS_RESULT: MenuAnalysisData = {
  mode: 'auto',
  dishCount: 2,
  partial: false,
  dishes: [
    {
      dishName: 'Big Mac',
      estimate: {
        result: {
          name: 'Big Mac',
          nameEs: 'Big Mac',
          nutrients: { calories: 550, proteins: 25, carbohydrates: 45, fats: 30, fiber: 3, saturatedFats: 11, sodium: 1000, salt: 2.5, sugar: 9, potassium: 0, calcium: 0, iron: 0, vitaminC: 0, vitaminA: 0 },
          portionGrams: 200,
          chainSlug: null,
          confidenceLevel: 'high',
        },
        levelHit: 1,
      },
    },
    { dishName: 'Hamburgesa Especial', estimate: null },
  ],
};
```

#### Key Patterns

**Structural reference for both branches** — follow `upload_ingest` in `callbackQuery.ts` exactly for: `safeAnswerCallback` placement (first), `ALLOWED_CHAT_IDS` guard (second), `getState` call, `bot.sendMessage('Procesando…')` before the async work, `setState` to clear `pendingPhotoFileId`, error logging with `logger.warn({ err, chatId }, '...')`.

**Rate limit counter placement** — check rate limit AFTER downloading the file (step 8 in the flow). Rationale: downloading proves the fileId is valid. Do not download after the rate check fails — order is: download → MIME detect → rate check → API call. (The spec does not mandate the order strictly; placing rate check before the API call but after download is the cleanest approach and avoids wasting a rate-limit slot when the file download fails.)

**Redis `incr`/`expire` pattern** — use `await redis.incr(key)` then conditionally `await redis.expire(key, 3600, 'NX')`. Wrap the entire block in try/catch for fail-open. Avoid `redis.multi()` — the simple two-call pattern is used throughout the existing codebase and is sufficient here.

**MarkdownV2 pipe escaping** — the `|` character requires escaping as `\|` in MarkdownV2. In template literals this is written as `\\|`. Use `escapeMarkdown` for all user-provided strings (dish names) to prevent injection of MarkdownV2 special characters.

**`formatEstimate` reuse for `upload_dish`** — `formatEstimate` from `estimateFormatter.ts` is already tested and handles the null-result case. Delegate to it directly rather than duplicating the nutrient rendering logic in `formatDishAnalysis`. This keeps the nutrient card format consistent with the `/calcular` command output.

**Gotcha — `ApiClient` interface must be updated before tests** — `makeMockClient()` in the test file adds `analyzeMenu: vi.fn()`. If the `ApiClient` interface in `apiClient.ts` does not yet include `analyzeMenu`, TypeScript will complain when assigning the mock to `ApiClient`. The interface update (step 2 in Files to Modify) must precede writing the test — or use `as unknown as ApiClient` cast in the test (existing pattern in `f031.callbackQuery.test.ts` line 133).

**Gotcha — `redis.incr` and `redis.expire` are not in the existing `makeMockRedis` factory in `f031.callbackQuery.test.ts`** — do not modify that file. The new `f034.callbackQuery.test.ts` defines its own factory with the additional methods. Tests in the new file that exercise `upload_ingest` (if any are added) would need the extended factory, but since F034 tests only cover the two new branches, the scope is clean.

**Gotcha — MIME detection buffer size** — `downloadTelegramFile` may return a buffer smaller than 12 bytes in theory (though extremely unlikely for a real image). Guard the WebP check: only check bytes [8..11] if `buffer.length >= 12`. For JPEG, PNG, PDF — 4 bytes suffice; guard with `buffer.length >= 4`. Default to JPEG if the buffer is too small (< 4 bytes).

**Gotcha — test file naming convention** — existing bot test files use the format `f0XX.feature.test.ts` (e.g. `f031.callbackQuery.test.ts`, `f032.apiClient.test.ts`). Follow this exactly: `f034.apiClient.test.ts` and `f034.callbackQuery.test.ts`.

---

## Acceptance Criteria

- [ ] `POST /analyze/menu` endpoint accepts multipart file (JPEG/PNG/WebP/PDF, max 10MB)
- [ ] `mode` parameter supports `auto`, `ocr`, `vision`, `identify` (default: `auto`)
- [ ] OCR pipeline (PDF): `pdf-parse` → text lines → `parseDishNames` → dish names
- [ ] OCR pipeline (image): `extractTextFromImage` → text lines → `parseDishNames` → dish names
- [ ] Vision pipeline: image buffer → OpenAI gpt-4o-mini (maxTokens 2048) → JSON array of dish names
- [ ] Identify pipeline: image buffer → OpenAI gpt-4o-mini → exactly 1 dish name
- [ ] Fallback: Vision failure → Tesseract OCR (vision mode only). No fallback for `identify` mode
- [ ] PDF rejected with `INVALID_IMAGE` in `vision` and `identify` modes
- [ ] Per-dish estimation via `runEstimationCascade` for each extracted dish name
- [ ] Response follows `MenuAnalysisResponse` schema (mode, dishCount, dishes, partial)
- [ ] Partial results on timeout: return 200 with `partial: true` and dishes processed so far
- [ ] API key auth required (anonymous rejected with 401)
- [ ] Rate limit: 10 analyses/hour per API key (Redis counter, fail-open). Bot key exempt
- [ ] Bot per-user rate limit: 5 analyses/hour per chatId (Redis counter in bot handler)
- [ ] Error codes: MENU_ANALYSIS_FAILED, VISION_API_UNAVAILABLE, INVALID_IMAGE, OCR_FAILED
- [ ] Bot `upload_menu` callback retrieves fileId from Redis BotState, calls POST /analyze/menu (mode: auto)
- [ ] Bot `upload_dish` callback retrieves fileId from Redis BotState, calls POST /analyze/menu (mode: identify)
- [ ] `apiClient.analyzeMenu()` method uses existing postFormData helper
- [ ] `parseDishNames()` utility extracts dish name candidates from text lines
- [ ] Unit tests for new functionality
- [ ] All tests pass
- [ ] Build succeeds
- [ ] Specs updated (`api-spec.yaml` / shared schemas)

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Unit tests written and passing
- [ ] Code follows project standards
- [ ] No linting errors
- [ ] Build succeeds
- [ ] Specs reflect final implementation
- [ ] ADR-001 compliance verified (LLM identifies, engine calculates)

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` + `frontend-planner` executed, plan approved
- [x] Step 3: `backend-developer` + `frontend-developer` executed with TDD
- [ ] Step 4: `production-code-validator` executed, quality gates pass
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 5: `qa-engineer` executed (Complex)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-26 | Spec created | spec-creator agent + self-review |
| 2026-03-26 | Spec reviewed | Gemini 2.5 + Codex GPT-5.4. 3 CRITICAL + 4 IMPORTANT + 3 SUGGESTION. All CRITICAL/IMPORTANT addressed |
| 2026-03-26 | Plan reviewed | Gemini 2.5 + Codex GPT-5.4. 1C+3I+2S (Gemini) + 3I+2S (Codex). Issues addressed: callVisionCompletion new function (multimodal content), cooperative timeout (no Promise.race), markdown JSON stripping, pdfParser.ts wrapper, file-type magic bytes validation, response mode echoes request, api-spec already done |

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

*Ticket created: 2026-03-26*
