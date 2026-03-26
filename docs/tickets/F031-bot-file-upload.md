# F031 — Bot File Upload (multipart, inline keyboard)

| Field        | Value                                              |
|--------------|----------------------------------------------------|
| Feature      | F031                                               |
| Epic         | E005 — Advanced Analysis & UX                      |
| Type         | Fullstack (API + Bot)                              |
| Priority     | High                                               |
| Status       | in-progress                                        |
| Branch       | feature/F031-bot-file-upload                        |
| Created      | 2026-03-26                                         |
| Dependencies | F032 ✅ (Restaurant Resolution)                    |

---

## Spec

### Description

F031 enables the user to upload restaurant menu photos (JPEG/PNG) and PDF documents directly from their phone via the Telegram bot. The bot downloads the file from Telegram servers into an in-process Buffer and forwards it to the API as a multipart request. The Telegram bot token never leaves the bot process.

**Key flows:**

1. **Photo upload** — user sends a photo to the bot. The bot shows an inline keyboard with three options: "Subir al catálogo" (functional), "Analizar menú" (coming soon), "Identificar plato" (coming soon). On "Subir al catálogo", the bot downloads the highest-resolution photo from Telegram, sends it as multipart to `POST /ingest/image`, and reports the result.

2. **Document upload (PDF)** — user sends a PDF document to the bot. The bot downloads the file from Telegram and sends it as multipart to the existing `POST /ingest/pdf`, and reports the result.

Both flows require an active restaurant context (set via `/restaurante`) before any upload is accepted. If no restaurant is selected, the bot prompts the user to use `/restaurante` first.

Access to the upload commands is restricted to a configurable set of chat IDs via the `ALLOWED_CHAT_IDS` environment variable. Requests from unlisted chat IDs are silently ignored.

---

### Architecture Decisions

- **ADR-010:** Multilingual dish names — the ingest pipeline handles `nameSourceLocale` automatically via `chainLocaleRegistry`. If the active restaurant has a `chainSlug`, it is passed to the upload call to enable chain-specific text preprocessing (ADR-007) and correct locale detection. For independent restaurants (no chainSlug), `nameSourceLocale` will be `null` until a translate script is run.
- **Security (Codex+Gemini review):** The bot token NEVER leaves the bot process. The bot downloads the file to a Buffer and sends it as multipart to the API, not the Telegram download URL. This was the CRITICAL issue identified in the strategic plan review.
- **Telegram Upload DataSource:** A fixed DataSource row with UUID `00000000-0000-0000-0000-000000000099` ("Telegram Upload") is used for all bot-uploaded dishes. This row is already seeded as part of F032 migrations.
- **Inline keyboard for photos:** Photos are ambiguous — they could be used for ingestion, dish identification, or menu analysis. The keyboard makes intent explicit. PDFs are unambiguous (always ingestion), so no keyboard is shown for documents.
- **Deferred buttons (F034):** "Analizar menú" and "Identificar plato" buttons are rendered but non-functional in F031. Pressing them returns a "Próximamente disponible" message.

---

### File Structure

```
packages/api/src/routes/ingest/
  image.ts                      NEW — POST /ingest/image multipart route

packages/api/src/app.ts         MODIFY — register ingestImageRoutes plugin

packages/bot/src/
  config.ts                     MODIFY — add ALLOWED_CHAT_IDS field
  apiClient.ts                  MODIFY — add uploadImage() and uploadPdf() methods
  handlers/
    fileUpload.ts               NEW — photo handler + document handler + helpers
  handlers/callbackQuery.ts     MODIFY — dispatch upload_ingest, upload_menu, upload_dish
                                          (fileId retrieved from Redis pendingPhotoFileId)
  bot.ts                        MODIFY — register bot.on('photo') and bot.on('document')
```

No new shared schemas are needed — the route reuses the existing ingest response envelope.

---

### Config Schema

#### `packages/bot/src/config.ts`

Add `ALLOWED_CHAT_IDS` to `BotEnvSchema`:

```
ALLOWED_CHAT_IDS: z.string()
  .optional()
  .transform((val) => {
    if (!val) return [];
    return val.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
  })
```

- Type after transform: `number[]`
- Default: empty array `[]` (all uploads blocked unless explicitly configured)
- Example: `ALLOWED_CHAT_IDS=123456789,987654321`
- A chat ID not in the list → handler returns without responding (silent ignore, matching the security goal of not leaking bot existence)

---

### API Endpoints

#### NEW: `POST /ingest/image`

Multipart counterpart to `POST /ingest/image-url`. The route plugin follows the exact same structure as `POST /ingest/pdf`:

**Request: `multipart/form-data`**

| Field          | Type       | Required | Notes                                                       |
|----------------|------------|----------|-------------------------------------------------------------|
| `file`         | binary     | yes      | JPEG or PNG, max 10 MB                                      |
| `restaurantId` | uuid       | yes      | Must exist in `restaurants` table                           |
| `sourceId`     | uuid       | yes      | Must exist in `data_sources` table                          |
| `dryRun`       | `"true"` / `"false"` | no | Default `"false"`. String because multipart has no boolean type. |
| `chainSlug`    | string     | no       | `^[a-z0-9-]+$`, max 100 chars. Enables chain text preprocessing. |

**Response: `200 OK`**

```json
{
  "success": true,
  "data": {
    "dishesFound": 9,
    "dishesUpserted": 8,
    "dishesSkipped": 1,
    "dryRun": false,
    "dishes": [ /* NormalizedDish[] */ ],
    "skippedReasons": [
      { "dishName": "Bebida", "reason": "Missing required field: proteins" }
    ]
  }
}
```

Note: Unlike `POST /ingest/image-url`, the response does NOT include `sourceUrl` — there is no URL to echo back for a direct file upload.

**Processing pipeline (steps in `image.ts`):**

1. Parse multipart stream → collect text fields into `fields` map + read `file` part into `fileBuffer`
2. Validate fields via Zod (`IngestImageBodySchema`: restaurantId uuid, sourceId uuid, dryRun string→boolean transform, chainSlug optional)
3. Guard: `fileBuffer` must be present (400 VALIDATION_ERROR if missing)
4. Magic bytes check: JPEG (FFD8FF) or PNG (89504E47) — else 422 INVALID_IMAGE
5. DB existence checks: `restaurant` and `dataSource` rows (404 NOT_FOUND if either missing)
6. Wrap steps 7–10 in 60-second timeout (PROCESSING_TIMEOUT 408 on breach)
7. `extractTextFromImage(fileBuffer)` → OCR text lines (422 OCR_FAILED on failure)
8. Optional: `preprocessChainText(chainSlug, lines)` if chainSlug provided
9. `parseNutritionTable(lines, syntheticUrl, scrapedAt)` — synthetic URL: `upload://image-${Date.now()}`
10. `normalizeNutrients` / `normalizeDish` per dish → collect `validDishes` + `skippedReasons`
11. If `validDishes.length === 0` → 422 NO_NUTRITIONAL_DATA_FOUND
12. If `!dryRun` → Prisma `$transaction` upsert (same pattern as `image-url.ts`)
13. Return `{ dishesFound, dishesUpserted, dishesSkipped, dryRun, dishes, skippedReasons }`

**Error codes:**

| HTTP | Code                       | Condition                                              |
|------|----------------------------|--------------------------------------------------------|
| 400  | VALIDATION_ERROR           | Missing required field, invalid UUID, or no file part  |
| 401  | UNAUTHORIZED               | Missing or invalid X-API-Key                           |
| 404  | NOT_FOUND                  | restaurantId or sourceId row does not exist            |
| 408  | PROCESSING_TIMEOUT         | Total pipeline exceeds 60 seconds                      |
| 413  | PAYLOAD_TOO_LARGE          | File exceeds 10 MB (`@fastify/multipart` plugin limit) |
| 422  | INVALID_IMAGE              | Not JPEG or PNG (magic bytes mismatch)                 |
| 422  | OCR_FAILED                 | Tesseract.js failed to extract text                    |
| 422  | NO_NUTRITIONAL_DATA_FOUND  | OCR succeeded but zero dishes parsed/normalized        |
| 500  | DB_UNAVAILABLE             | Prisma transaction failure                             |

**`app.ts` change:**

Register `ingestImageRoutes` plugin alongside the other ingest route plugins, passing `{ prisma }`.

---

### Bot Behavior

#### `packages/bot/src/config.ts`

Add `ALLOWED_CHAT_IDS` field (see Config Schema above).

#### `packages/bot/src/apiClient.ts`

Add two methods to the `ApiClient` interface and implementation:

**`uploadImage(params)`**

```typescript
uploadImage(params: {
  fileBuffer: Buffer;
  filename: string;       // e.g. "photo.jpg"
  mimeType: string;       // e.g. "image/jpeg"
  restaurantId: string;
  sourceId: string;
  dryRun?: boolean;
  chainSlug?: string;
}): Promise<IngestImageResult>
```

Implementation uses `FormData` (Node.js built-in) + `Blob`. Attaches `X-API-Key: config.ADMIN_API_KEY` (required — ingest routes require admin auth). Timeout: 90 seconds (allows for 60s server-side processing + network). Parses `{ success, data }` envelope.

**`uploadPdf(params)`**

```typescript
uploadPdf(params: {
  fileBuffer: Buffer;
  filename: string;       // e.g. "menu.pdf"
  restaurantId: string;
  sourceId: string;
  dryRun?: boolean;
  chainSlug?: string;
}): Promise<IngestPdfResult>
```

Same implementation pattern as `uploadImage`. Attaches `X-API-Key: config.ADMIN_API_KEY`.

Both methods throw `ApiError` on non-2xx or network/timeout errors (same pattern as `postJson`).

**Guard:** If `config.ADMIN_API_KEY` is undefined, both methods throw `ApiError(500, 'CONFIG_ERROR', 'ADMIN_API_KEY not configured')` immediately without making a network call.

#### `packages/bot/src/handlers/fileUpload.ts`

**Exports:**

```typescript
export async function handlePhoto(
  msg: TelegramBot.Message,
  bot: TelegramBot,
  apiClient: ApiClient,
  redis: Redis,
  config: BotConfig,
): Promise<void>

export async function handleDocument(
  msg: TelegramBot.Message,
  bot: TelegramBot,
  apiClient: ApiClient,
  redis: Redis,
  config: BotConfig,
): Promise<void>
```

**`handlePhoto` behavior:**

1. Guard: `msg.chat.id` must be in `config.ALLOWED_CHAT_IDS`. If not → return silently.
2. Guard: `msg.photo` must be present (not undefined).
3. Retrieve `state` from Redis for `msg.chat.id`.
4. Guard: `state?.selectedRestaurant` must be set. If not → send message: "Primero selecciona un restaurante con /restaurante <nombre>", return.
5. Select the highest-resolution photo: `msg.photo[msg.photo.length - 1]` (Telegram sends an array sorted by size ascending).
6. Pre-check `file_size` from Telegram metadata: if `photo.file_size > 10 * 1024 * 1024` → send "El archivo supera el límite de 10 MB." and return. (Avoids downloading large files unnecessarily.)
7. Store `fileId` (the `file_id` of the selected photo part) in Redis state under `pendingPhotoFileId` (overwrites any previous pending photo). Note: rapid successive photos overwrite the pending fileId; earlier keyboards will show "La foto ha expirado" if clicked after the fileId changes — this is defined behavior, not a bug.
8. Send inline keyboard with three buttons:

```
[📖 Subir al catálogo]     callback_data: upload_ingest
[🧮 Analizar menú]         callback_data: upload_menu
[🍽️ Identificar plato]     callback_data: upload_dish
```

Note: `callback_data` uses short opaque strings (no fileId) to stay under Telegram's 64-byte limit. The `pendingPhotoFileId` stored in Redis state (step 6) is retrieved in the callback handler.

9. Message text (MarkdownV2): "¿Qué quieres hacer con esta foto?"

**`handleDocument` behavior:**

1. Guard: `msg.chat.id` must be in `config.ALLOWED_CHAT_IDS`. If not → return silently.
2. Guard: `msg.document` must be present.
3. Determine file type from MIME: `application/pdf` → PDF flow, `image/jpeg` or `image/png` → image flow. Any other MIME → send "Solo se admiten archivos PDF o imágenes \(JPEG/PNG\)\.", return.
4. Retrieve `state`. Guard: `state?.selectedRestaurant` must be set. If not → send "Primero selecciona un restaurante con /restaurante <nombre>", return.
5. Pre-check `msg.document.file_size` against 10 MB limit. If over → send error message, return. (Avoids downloading large files.)
6. Send "Procesando documento…" (plain text, no parse_mode).
7. Download file inside try/catch: `bot.getFileLink(msg.document.file_id)` → `fetch(fileLink)` → `Buffer.from(await response.arrayBuffer())`. On error → send "Error al descargar el archivo. Inténtalo de nuevo.", return.
8. **PDF flow:** Call `apiClient.uploadPdf({ fileBuffer, filename, restaurantId, sourceId, chainSlug? })` where `sourceId = '00000000-0000-0000-0000-000000000099'`. Pass `chainSlug` from `state.selectedRestaurant.chainSlug` if available (improves parser accuracy for known chains).
9. **Image flow:** Call `apiClient.uploadImage({ fileBuffer, filename, mimeType, restaurantId, sourceId, chainSlug? })` with same sourceId and optional chainSlug.
10. On success: send MarkdownV2 summary message (see Message Formats).
11. On `ApiError`: send localized error message (see Error Handling).

**Inline keyboard callback — `upload_ingest` (in `callbackQuery.ts`):**

1. Dismiss spinner (`safeAnswerCallback`).
2. Retrieve `state`. Guard: `state?.selectedRestaurant` must be set (re-check — state may have expired). If not → send "No hay restaurante seleccionado. Usa /restaurante <nombre> de nuevo.", return.
3. Guard: `state.pendingPhotoFileId` must be present. If not → send "La foto ha expirado. Envía la foto de nuevo.", return.
4. Send "Procesando imagen…" (plain text).
5. Download file inside try/catch: `bot.getFileLink(state.pendingPhotoFileId)` → `fetch(fileLink)` → `Buffer.from(await response.arrayBuffer())`. On error → send "Error al descargar el archivo. Inténtalo de nuevo.", return.
6. Call `apiClient.uploadImage({ fileBuffer, filename: 'photo.jpg', mimeType: 'image/jpeg', restaurantId, sourceId: '00000000-0000-0000-0000-000000000099', chainSlug: state.selectedRestaurant.chainSlug })`. Pass chainSlug if available (improves parser accuracy for known chains).
7. On success: clear `pendingPhotoFileId` from state, send MarkdownV2 summary message.
8. On `ApiError`: send localized error message.

**Inline keyboard callback — `upload_menu` and `upload_dish`:**

1. Dismiss spinner.
2. Send: "Esta función estará disponible próximamente\. 🔜" (MarkdownV2-escaped).
3. Return.

#### `packages/bot/src/bot.ts`

Register two new message event handlers (after the `callback_query` registration):

```typescript
bot.on('photo', async (msg) => {
  try {
    await handlePhoto(msg, bot, apiClient, redis, config);
  } catch (err) {
    logger.error({ err, chatId: msg.chat.id }, 'Unhandled photo handler error');
  }
});

bot.on('document', async (msg) => {
  try {
    await handleDocument(msg, bot, apiClient, redis, config);
  } catch (err) {
    logger.error({ err, chatId: msg.chat.id }, 'Unhandled document handler error');
  }
});
```

Note: `bot.on('photo', ...)` fires specifically for `message.photo` (Telegram's compressed photo type). `bot.on('document', ...)` fires for files sent as documents, which includes uncompressed "as file" photos and PDFs. MIME type guard in `handleDocument` ensures only PDFs are processed.

#### Message Formats

**Success summary (image or PDF):**

```
*✅ Ingesta completada*
Restaurante: [restaurant name]
Platos encontrados: X
Platos guardados: Y
Platos omitidos: Z
```

**No dishes found (422 NO_NUTRITIONAL_DATA_FOUND):**

```
No se encontraron datos nutricionales en la imagen\. Asegúrate de que la foto muestra una tabla nutricional legible\.
```

**File too large:**

```
El archivo supera el límite de 10 MB\.
```

**ADMIN_API_KEY not configured:**

```
El bot no está configurado para subir archivos\. Contacta al administrador\.
```

**Generic API error (other ApiError):**

```
Error al procesar el archivo: [error message]\. Inténtalo de nuevo\.
```

**No restaurant selected:**

```
Primero selecciona un restaurante con /restaurante \<nombre\>\.
```

---

### `ALLOWED_CHAT_IDS` Guard

- Parsed from env as comma-separated integers at startup.
- Empty array (default) means NO uploads are accepted from any chat. This is intentional — the feature must be explicitly enabled.
- Check applied at the entry point of `handlePhoto` and `handleDocument` before any other processing.
- Silent ignore on unlisted chat IDs (no response sent). This prevents information leakage.
- The guard does NOT apply to other existing bot commands (search, estimate, etc.) — only to file upload handlers.

---

### Edge Cases

1. **Photo sent as document** — user sends a photo using "Send as File" in Telegram. This triggers `bot.on('document')` not `bot.on('photo')`. The MIME type will be `image/jpeg` or `image/png`. The `handleDocument` handler accepts these MIME types and routes them to the image upload flow (no inline keyboard — same direct processing as PDFs, since the user explicitly chose "Send as File").

2. **Telegram file download failure** — `bot.getFileLink()` or the subsequent `fetch()` fails. The bot should catch the error and send a generic "Error al descargar el archivo. Inténtalo de nuevo." message without crashing.

3. **Redis state expired between keyboard display and button press** — the inline keyboard callback checks `state?.selectedRestaurant` again. If expired, it sends "No hay restaurante seleccionado. Usa /restaurante <nombre> de nuevo." and returns.

4. **Multiple photos sent rapidly** — each triggers `handlePhoto` independently. Each call overwrites `pendingPhotoFileId` in Redis state and sends a new inline keyboard. The user should interact with the most recent keyboard. Clicking an older keyboard will trigger `upload_ingest` which reads `pendingPhotoFileId` from Redis — this will process the *most recent* photo, not the one the keyboard was shown for. This is acceptable for F031; multi-photo batch upload is out of scope.

5. **`callback_data` 64-byte limit** — Telegram enforces a 64-byte limit on `callback_data`. Telegram `file_id` values are typically 60–80 chars, so embedding them in callback_data is not possible. Solution: store the fileId in Redis state under `pendingPhotoFileId` (done in handlePhoto step 6) and use compact callback_data strings (`upload_ingest`, `upload_menu`, `upload_dish`) that retrieve the fileId from Redis on callback.

6. **ADMIN_API_KEY not set** — `uploadImage` and `uploadPdf` throw `ApiError(500, 'CONFIG_ERROR')` immediately. The bot sends the "not configured" error message to the user. Startup validation does NOT exit if `ADMIN_API_KEY` is absent (it is optional in the existing schema) — the error surfaces only when upload is attempted.

7. **PDF file named with non-ASCII characters** — use the `msg.document.file_name` field if present; fall back to `'document.pdf'`. The filename is only used for the multipart `Content-Disposition` header and has no semantic meaning to the API.

8. **Large photo (>10 MB)** — Telegram automatically compresses photos sent via `message.photo`. However, documents sent as files are not compressed. The bot checks buffer size after download and rejects before calling the API.

---

### Acceptance Criteria

**API — `POST /ingest/image`**

1. `POST /ingest/image` with a valid JPEG multipart upload, valid UUIDs, and `X-API-Key` returns 200 with `dishesUpserted >= 1`.
2. `POST /ingest/image` with `dryRun=true` returns 200 with `dishesUpserted = 0` and `dryRun: true`.
3. `POST /ingest/image` with a non-JPEG/PNG binary returns 422 `INVALID_IMAGE`.
4. `POST /ingest/image` with no `file` part returns 400 `VALIDATION_ERROR`.
5. `POST /ingest/image` with an invalid `restaurantId` UUID returns 400 `VALIDATION_ERROR`.
6. `POST /ingest/image` with a `restaurantId` that does not exist returns 404 `NOT_FOUND`.
7. `POST /ingest/image` with a file >10 MB returns 413 `PAYLOAD_TOO_LARGE`.
8. `POST /ingest/image` without `X-API-Key` returns 401 `UNAUTHORIZED`.
9. `POST /ingest/image` response does NOT include a `sourceUrl` field (unlike `image-url`).

**Bot — photo handler**

10. Sending a photo to a chat ID not in `ALLOWED_CHAT_IDS` produces no bot response.
11. Sending a photo to an allowed chat with no restaurant selected sends the "Primero selecciona un restaurante" message.
12. Sending a photo to an allowed chat with a restaurant selected sends the 3-button inline keyboard.
13. Pressing "Subir al catálogo" triggers the image download + API call and sends a success summary on completion.
14. Pressing "Analizar menú" or "Identificar plato" sends the "próximamente disponible" message.

**Bot — document handler**

15. Sending a PDF to an allowed chat with a restaurant selected triggers the download + `POST /ingest/pdf` call and sends a success summary.
16. Sending a non-PDF document returns "Solo se admiten archivos PDF."
17. Sending a PDF to a chat ID not in `ALLOWED_CHAT_IDS` produces no bot response.

**Bot — document handler (images as documents)**

18. Sending a JPEG image as a document (Send as File) to an allowed chat with a restaurant selected triggers image upload flow and sends success summary.
19. Sending a PNG image as a document to an allowed chat with a restaurant selected triggers image upload flow and sends success summary.
20. Sending a non-PDF, non-image document (e.g. .docx) returns "Solo se admiten archivos PDF o imágenes."

**Bot — error handling**

21. Telegram file download failure (getFileLink or fetch fails) sends "Error al descargar el archivo" message, does not crash.
22. Pressing "Subir al catálogo" after Redis state expires sends "No hay restaurante seleccionado" message.
23. Pressing "Subir al catálogo" when `pendingPhotoFileId` is absent from state (e.g. already consumed by a previous upload) sends "La foto ha expirado" message. Note: if a newer photo overwrote the pending fileId, the callback processes the newer photo — this is defined behavior.
24. Uploading when `ADMIN_API_KEY` is not configured sends "El bot no está configurado para subir archivos" message.

**Bot — configuration**

25. `ALLOWED_CHAT_IDS=` (empty string) parses to `[]` — all uploads blocked.
26. `ALLOWED_CHAT_IDS=123,456` parses to `[123, 456]`.
27. Bot starts successfully when `ALLOWED_CHAT_IDS` is omitted from env.

**API — additional**

28. `POST /ingest/image` with a valid PNG multipart upload returns 200.
29. `POST /ingest/image` with a non-existent `sourceId` returns 404 `NOT_FOUND`.

---

### Non-Goals (Out of Scope for F031)

- "Analizar menú" button functional implementation (deferred to F034)
- "Identificar plato" button functional implementation (deferred to F034)
- Vision API / LLM image analysis
- `parseDishNames()` parser
- Multi-image batch upload (processing multiple photos as a single menu)
- Automatic chain slug detection from image content
- Any changes to existing bot commands (`/buscar`, `/estimar`, etc.)

---

## Implementation Plan

### Backend (API)

---

#### Existing Code to Reuse

- `packages/api/src/routes/ingest/image-url.ts` — copy the full processing pipeline (OCR → preprocess → parse → normalize → upsert). The new route is a structural clone with multipart parsing substituted for JSON + download.
- `packages/api/src/routes/ingest/pdf.ts` — copy the multipart parsing loop verbatim (the `for await (const part of request.parts())` block, the `fields` map, and the `fileBuffer` accumulation).
- `packages/api/src/lib/imageOcrExtractor.ts` — `extractTextFromImage(buffer)`. No changes required.
- `packages/api/src/ingest/nutritionTableParser.ts` — `parseNutritionTable(lines, sourceUrl, scrapedAt)`. No changes required.
- `packages/api/src/ingest/chainTextPreprocessor.ts` — `preprocessChainText(chainSlug, lines)`. No changes required.
- `packages/api/src/ingest/chainLocaleRegistry.ts` — `getChainSourceLocale(chainSlug)`. No changes required.
- `packages/api/src/app.ts` — registration pattern for `ingestImageUrlRoutes` (line 102) is the exact template for the new registration line.
- `packages/api/src/__tests__/f012.imageUrl.route.test.ts` — mock setup pattern (`vi.mock` at top, typed cast aliases, `mockPrisma` shape, `mockTransaction` implementation, `beforeEach` reset block). Mirror this exactly.
- `packages/api/src/__tests__/f012.imageUrl.edge-cases.test.ts` — edge-case coverage structure and fake-timer pattern for PROCESSING_TIMEOUT (EC-R15). Mirror the approach.
- `@foodxplorer/scraper` exports `normalizeNutrients`, `normalizeDish`, `NormalizedDishDataSchema` — imported identically to image-url.ts.
- `@fastify/multipart` types `MultipartValue`, `MultipartFile as MultipartFilePart` — imported identically to pdf.ts.
- `Prisma`, `Prisma.InputJsonValue`, `Prisma.JsonNull` — used in the upsert block exactly as in image-url.ts and pdf.ts.

---

#### Files to Create

| Path | Purpose |
|------|---------|
| `packages/api/src/routes/ingest/image.ts` | NEW route plugin — `POST /ingest/image`. Multipart parse + magic bytes guard + DB checks + 60s timeout + OCR + optional preprocess + parse + normalize + upsert. Exports `ingestImageRoutes`. |
| `packages/api/src/__tests__/f031.ingestImage.route.test.ts` | Primary route test: happy path, all error codes (400/401/404/408/413/422/500), dryRun behavior, chainSlug preprocessing. Uses `buildApp` + `app.inject()`. Mirrors `f012.imageUrl.route.test.ts`. |
| `packages/api/src/__tests__/f031.ingestImage.edge-cases.test.ts` | Edge-case tests: field ordering, boundary values for chainSlug, missing-file-part guard, `sourceUrl` absent from response, idempotent upsert, PROCESSING_TIMEOUT via fake timers, domain-error passthrough from `$transaction`. |

---

#### Files to Modify

| Path | Change |
|------|--------|
| `packages/api/src/app.ts` | Add `import { ingestImageRoutes } from './routes/ingest/image.js'` alongside existing ingest imports. Add `await app.register(ingestImageRoutes, { prisma: prismaClient })` immediately after the `ingestImageUrlRoutes` registration line (line 102). |

---

#### Implementation Order

Follow TDD: write the failing test files first, then write the implementation until tests pass.

**Step 1 — Write failing route test (`f031.ingestImage.route.test.ts`)**

Create the primary test file. At this point `image.ts` does not exist, so all tests will fail. The file must mock the same modules as `f012.imageUrl.route.test.ts`:

```
vi.mock('../lib/imageOcrExtractor.js', ...)
vi.mock('../ingest/nutritionTableParser.js', ...)
vi.mock('../ingest/chainTextPreprocessor.js', ...)
```

No mock for `imageDownloader` or `ssrfGuard` — these are not used by the new route.

Use fixture UUIDs with the `f031` namespace: `f3100000-0000-4000-a000-000000000001` (restaurantId), `f3100000-0000-4000-a000-000000000002` (sourceId).

Build multipart requests using `@fastify/multipart`-compatible payloads inside `app.inject()`. The standard pattern for injecting multipart in Fastify tests is to build a raw `Buffer` with the multipart boundary manually, or use a helper that produces `content-type: multipart/form-data; boundary=...` + the encoded body. Model the helper function `makeMultipartRequest(fields, fileBuffer?)` after the `makeRequest` helper in `f012.imageUrl.route.test.ts`, but adapted for multipart.

Test cases to cover in this file (mirrors acceptance criteria 1–9, 28–29):

- `200` — valid JPEG upload with dryRun: "false" → `dishesUpserted >= 1`, `mockTransaction` called, no `sourceUrl` field in response data.
- `200` — valid JPEG upload with dryRun: "true" → `dishesUpserted = 0`, `mockTransaction` NOT called.
- `200` — valid PNG upload (magic bytes `89 50 4E 47`) → proceeds to OCR, returns 200.
- `400 VALIDATION_ERROR` — missing `restaurantId` field.
- `400 VALIDATION_ERROR` — `restaurantId` not a valid UUID.
- `400 VALIDATION_ERROR` — missing `file` part in multipart body.
- `401 UNAUTHORIZED` — request without `X-API-Key` header (auth middleware covers this automatically via `/ingest/` prefix; verify the test config does NOT set `ADMIN_API_KEY` so auth rejects).
- `404 NOT_FOUND` — `restaurantId` does not exist in DB.
- `404 NOT_FOUND` — `sourceId` does not exist in DB.
- `413 PAYLOAD_TOO_LARGE` — file exceeds 10 MB (`@fastify/multipart` limit set in `app.ts` raises this automatically; inject a body that exceeds the limit).
- `422 INVALID_IMAGE` — file with non-JPEG/PNG magic bytes (e.g. GIF `47 49 46 38`).
- `422 OCR_FAILED` — `mockExtractTextFromImage` rejects with `{ statusCode: 422, code: 'OCR_FAILED' }`.
- `422 NO_NUTRITIONAL_DATA_FOUND` — `mockParseNutritionTable` returns `[]`.
- `422 NO_NUTRITIONAL_DATA_FOUND` — all dishes fail normalization (calories > 9000).
- `500 DB_UNAVAILABLE` — `mockTransaction` rejects with a non-domain error.
- chainSlug: `preprocessChainText` is called when `chainSlug` field is present; NOT called when absent.

**Step 2 — Write failing edge-case test (`f031.ingestImage.edge-cases.test.ts`)**

Use the same vi.mock block as Step 1. Additional scenarios:

- EC-I1: `dryRun` field omitted → defaults to "false" string transform → DB write performed.
- EC-I2: `dryRun` set to `"true"` (string) → accepted (multipart body schema uses `.transform((v) => v === 'true')`), no DB write.
- EC-I3: `chainSlug` with uppercase → 400 VALIDATION_ERROR.
- EC-I4: `chainSlug` with underscore → 400 VALIDATION_ERROR.
- EC-I5: `chainSlug` exactly 100 lowercase alphanumeric chars → passes Zod.
- EC-I6: `chainSlug` exactly 101 chars → 400 VALIDATION_ERROR.
- EC-I7: `dishesFound` counts ALL raw dishes including those that fail normalization.
- EC-I8: `skippedReasons` array contains `dishName` + `reason` for each skipped dish.
- EC-I9: Response data does NOT contain a `sourceUrl` field (key distinction from `image-url`).
- EC-I10: DB query order — restaurant checked first; if restaurant not found, `dataSource.findUnique` is NOT called.
- EC-I11: PROCESSING_TIMEOUT — `mockExtractTextFromImage` hangs; advance fake timer 61 s; expect 408 PROCESSING_TIMEOUT. (Mirror EC-R15 from edge-cases file.)
- EC-I12: Domain error from `$transaction` is re-thrown as-is, not wrapped as DB_UNAVAILABLE. (Mirror EC-R16.)
- EC-I13: Idempotent upsert — when `mockTransaction` finds an existing dish, `tx.dish.update` is called, not `tx.dish.create`. (Mirror EC-R14.)
- EC-I14: Error response envelope shape `{ success: false, error: { message, code } }` on 404.

**Step 3 — Implement `packages/api/src/routes/ingest/image.ts`**

Structure (follow this precise order — tests encode this ordering implicitly):

1. File header comment (error codes list, plugin options pattern — mirror `pdf.ts` header style).

2. Imports:
   - `z` from `zod`
   - `FastifyPluginAsync` from `fastify`
   - `fastifyPlugin` from `fastify-plugin`
   - `PrismaClient`, `Prisma` from `@prisma/client`
   - `MultipartValue`, `MultipartFile as MultipartFilePart` from `@fastify/multipart`
   - `normalizeNutrients`, `normalizeDish`, `NormalizedDishDataSchema` from `@foodxplorer/scraper`
   - `extractTextFromImage` from `../../lib/imageOcrExtractor.js`
   - `parseNutritionTable` from `../../ingest/nutritionTableParser.js`
   - `preprocessChainText` from `../../ingest/chainTextPreprocessor.js`
   - `getChainSourceLocale` from `../../ingest/chainLocaleRegistry.js`

3. `IngestImageBodySchema` (Zod, API-internal):
   ```
   restaurantId: z.string().uuid()
   sourceId:     z.string().uuid()
   dryRun:       z.string().transform((v) => v === 'true').default('false')
   chainSlug:    z.string().min(1).max(100).regex(/^[a-z0-9-]+$/).optional()
   ```
   Note: `dryRun` uses the string-transform pattern from `pdf.ts`, NOT the boolean default from `image-url.ts`, because multipart fields are always strings.

4. `IngestImageSkippedReason` interface (`dishName: string; reason: string`).

5. `DOMAIN_CODES` Set — include: `VALIDATION_ERROR`, `NOT_FOUND`, `INVALID_IMAGE`, `OCR_FAILED`, `NO_NUTRITIONAL_DATA_FOUND`, `PROCESSING_TIMEOUT`, `PAYLOAD_TOO_LARGE`, `DB_UNAVAILABLE`.

6. `IngestImagePluginOptions` interface (`prisma: PrismaClient`).

7. Route plugin (`ingestImageRoutesPlugin`):

   a. Multipart parsing loop (copy from `pdf.ts` lines 68–92 verbatim — the `fields` map + `fileBuffer` accumulation, drain subsequent file parts).

   b. Guard: `fileBuffer === undefined` → throw `{ statusCode: 400, code: 'VALIDATION_ERROR' }`. This guard must come BEFORE Zod validation.

   c. Zod parse of `fields` via `IngestImageBodySchema.safeParse(fields)`. On failure → `throw parseResult.error` (ZodError, mapped to 400 by error handler).

   d. Destructure `{ restaurantId, sourceId, dryRun, chainSlug }` from `parseResult.data`.

   e. Magic bytes check on `fileBuffer`:
      - JPEG: `buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff`
      - PNG: `buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47`
      - On mismatch → throw `{ statusCode: 422, code: 'INVALID_IMAGE' }`.

   f. DB existence checks (copy from `image-url.ts` lines 102–122):
      - `prisma.restaurant.findUnique` → 404 NOT_FOUND if null.
      - `prisma.dataSource.findUnique` → 404 NOT_FOUND if null.

   g. Synthetic URL construction: `const syntheticUrl = \`upload://image-${Date.now()}\``. This is the `sourceUrl` passed to `parseNutritionTable` — it is NOT included in the response.

   h. 60-second timeout wrapping `processingPromise` via `Promise.race` (copy from `image-url.ts` lines 133–143 verbatim).

   i. Inside `processingPromise`:
      - `const scrapedAt = new Date().toISOString()`
      - `const lines = await extractTextFromImage(fileBuffer)` — throws OCR_FAILED on error.
      - `if (chainSlug !== undefined) lines = preprocessChainText(chainSlug, lines)`
      - `const rawDishes = parseNutritionTable(lines, syntheticUrl, scrapedAt)`
      - `if (rawDishes.length === 0)` → throw NO_NUTRITIONAL_DATA_FOUND.
      - Normalization loop (copy from `image-url.ts` lines 201–256 verbatim — `getChainSourceLocale`, `nameSourceLocale`, `normalizeNutrients`, `normalizeDish`, `NormalizedDishDataSchema.safeParse`, `validDishes`, `skippedReasons`).
      - `if (validDishes.length === 0)` → throw NO_NUTRITIONAL_DATA_FOUND.
      - Prisma `$transaction` upsert block (copy from `image-url.ts` lines 263–367 verbatim — `dish.findFirst` + `dish.create`/`dish.update` + `dishNutrient.findFirst` + `dishNutrient.create`/`dishNutrient.update` + DOMAIN_CODES re-throw guard).
      - Return `{ dishesFound: rawDishes.length, dishesUpserted, dishesSkipped: skippedReasons.length, dryRun, dishes: validDishes, skippedReasons }`. **No `sourceUrl` field.**

   j. `try { const result = await Promise.race([...]); return reply.status(200).send({ success: true, data: result }); } finally { clearTimeout(timeoutId); }` — copy from `image-url.ts` lines 381–390 verbatim.

8. `export const ingestImageRoutes = fastifyPlugin(ingestImageRoutesPlugin)`.

**Step 4 — Register the plugin in `app.ts` + Fix 413 error mapping**

Add after line 102 (`await app.register(ingestImageUrlRoutes, { prisma: prismaClient })`):

```typescript
import { ingestImageRoutes } from './routes/ingest/image.js';
// ...
await app.register(ingestImageRoutes, { prisma: prismaClient });
```

The import goes with the other ingest imports at the top of the file (after `ingestImageUrlRoutes`). The registration line goes immediately after `ingestImageUrlRoutes` registration.

**413 error mapping fix:** `@fastify/multipart` throws `RequestFileTooLargeError` with `code: 'FST_REQ_FILE_TOO_LARGE'` and `statusCode: 413`. The existing error handler in `errorHandler.ts` only maps `code === 'PAYLOAD_TOO_LARGE'`. Add a new mapping branch in `mapError()`:

```typescript
if (asAny['code'] === 'FST_REQ_FILE_TOO_LARGE') {
  return {
    statusCode: 413,
    body: { success: false, error: { message: error.message, code: 'PAYLOAD_TOO_LARGE' } },
  };
}
```

This also fixes a latent bug in the existing `POST /ingest/pdf` route (multipart uploads hitting the 10 MB limit would have returned a raw Fastify error instead of the standard envelope). Add a test for this in `f031.ingestImage.route.test.ts`.

**Step 5 — Run tests and verify**

Run the two test files. All tests should pass. If the `413 PAYLOAD_TOO_LARGE` test is flaky due to how `app.inject()` handles large bodies with `@fastify/multipart`, check how `pdf.ts` tests handle this (or skip the 413 test and add a note — the limit is enforced by `fastifyMultipart` config which is already set globally in `app.ts`).

---

#### Testing Strategy

**Test files:**
- `packages/api/src/__tests__/f031.ingestImage.route.test.ts` — primary route tests (happy path + all error codes)
- `packages/api/src/__tests__/f031.ingestImage.edge-cases.test.ts` — edge cases and boundary conditions

**Mocking strategy:**
- `vi.mock('../lib/imageOcrExtractor.js')` — `extractTextFromImage` is the only lib-level dependency unique to this route (no `imageDownloader`, no `ssrfGuard`).
- `vi.mock('../ingest/nutritionTableParser.js')` — `parseNutritionTable`.
- `vi.mock('../ingest/chainTextPreprocessor.js')` — `preprocessChainText`.
- `chainLocaleRegistry` is NOT mocked — `getChainSourceLocale` is a pure lookup with no side effects; let it run real.
- `normalizeNutrients` and `normalizeDish` from `@foodxplorer/scraper` are NOT mocked — run real (same approach as `image-url` tests).
- Prisma mocked via `mockPrisma` passed to `buildApp({ prisma: mockPrisma })`.
- `mockTransaction` implements the callback pattern: `async (fn) => fn(txMock)`.

**Key test scenarios:**

| Scenario | Expected |
|----------|----------|
| Valid JPEG, dryRun false | 200, `dishesUpserted >= 1`, `mockTransaction` called, no `sourceUrl` in data |
| Valid JPEG, dryRun true | 200, `dishesUpserted = 0`, `mockTransaction` NOT called |
| Valid PNG magic bytes | 200 (not 422 INVALID_IMAGE) |
| No file part in multipart | 400 VALIDATION_ERROR |
| Invalid restaurantId format | 400 VALIDATION_ERROR |
| File with GIF magic bytes | 422 INVALID_IMAGE |
| `extractTextFromImage` throws OCR_FAILED | 422 OCR_FAILED |
| `parseNutritionTable` returns [] | 422 NO_NUTRITIONAL_DATA_FOUND |
| All dishes calories > 9000 | 422 NO_NUTRITIONAL_DATA_FOUND |
| Restaurant not in DB | 404 NOT_FOUND |
| Source not in DB | 404 NOT_FOUND |
| No X-API-Key header | 401 UNAUTHORIZED |
| `$transaction` throws connection error | 500 DB_UNAVAILABLE |
| `$transaction` throws domain error | domain error passthrough (not DB_UNAVAILABLE) |
| Pipeline hangs 61 s (fake timer) | 408 PROCESSING_TIMEOUT |
| chainSlug provided | `preprocessChainText` called |
| chainSlug absent | `preprocessChainText` NOT called |
| Response data shape | NO `sourceUrl` field present |

**Multipart request construction in tests:**

Use `app.inject()` with a manually constructed multipart body. The standard approach is:

```typescript
function makeMultipartRequest(
  fields: Record<string, string>,
  fileBuffer?: Buffer,
  filename = 'photo.jpg',
): InjectOptions {
  const boundary = '----FormBoundary123';
  const parts: Buffer[] = [];

  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
    ));
  }

  if (fileBuffer !== undefined) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`
    ));
    parts.push(fileBuffer);
    parts.push(Buffer.from('\r\n'));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    method: 'POST',
    url: '/ingest/image',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'x-api-key': TEST_API_KEY,
    },
    payload: Buffer.concat(parts),
  };
}
```

Include `x-api-key` header in all non-401 test requests. The `testConfig` must include `ADMIN_API_KEY` for authenticated requests; for the 401 test, omit the header.

**Note on 413 test:** Injecting a >10 MB buffer via `app.inject()` is memory-intensive. Test this by checking the `@fastify/multipart` limit error is mapped to 413 by the error handler, or construct a minimal test that uses a small buffer and verifies the multipart plugin's `FST_FILES_LIMIT` error shape. The actual byte-count limit is enforced globally by `app.ts` and does not need per-route testing.

---

#### Key Patterns

- **Multipart parsing** (`pdf.ts` lines 68–92): the `for await (const part of request.parts())` loop is the only correct pattern for `@fastify/multipart` in Fastify v5. Do not use `request.file()` or `request.files()` — these are incompatible with the registered multipart plugin configuration.
- **dryRun as string** (`pdf.ts` line 36–39): multipart body schema uses `.transform((v) => v === 'true').default('false')`, not `.boolean().default(false)` (which is used in `image-url.ts` for JSON bodies). This is intentional — multipart fields are always strings.
- **DOMAIN_CODES Set scope** (`image-url.ts` lines 53–63): define as a module-level const (not inside the `$transaction` catch block as in `pdf.ts` lines 350–354 — the pdf.ts pattern is a legacy inconsistency). Module-level definition is the correct pattern.
- **Timeout: 60 seconds** — the spec calls for 60 s (same as `image-url`). The PDF route uses 30 s. Do NOT copy the PDF timeout value.
- **Synthetic URL**: pass `\`upload://image-${Date.now()}\`` to `parseNutritionTable` as the `sourceUrl` argument. This is for internal tracking only — it is never returned in the response. This is the key difference from both `image-url.ts` (returns `sourceUrl`) and `pdf.ts` (uses `pdf://filename`).
- **No `sourceUrl` in response**: the return object inside `processingPromise` must NOT include a `sourceUrl` field. The test EC-I9 verifies this explicitly.
- **Auth is automatic**: `/ingest/image` matches the `/ingest/` prefix in `adminPrefixes.ts`. No auth configuration is needed in `image.ts`.
- **Plugin export name**: export as `ingestImageRoutes` (follows the pattern: `ingestPdfRoutes`, `ingestImageUrlRoutes`).
- **`fastifyPlugin` wrapping**: required on every route plugin to prevent Fastify scope isolation. All existing ingest plugins use it.
- **`request.log.warn`** for `en`-locale chains (nameEs not set): copy from `image-url.ts` lines 216–219 verbatim — this is the F038 pattern for chain locale handling.

---

### Frontend (Bot)

---

#### Existing Code to Reuse

- `packages/bot/src/config.ts` — `BotEnvSchema`, `parseConfig`, `BotConfig` type. Extend the schema in-place; do not create a new schema.
- `packages/bot/src/apiClient.ts` — `fetchJson` / `postJson` helpers as reference for the new `postFormData` helper; `ApiError` class and the `REQUEST_TIMEOUT_MS` constant pattern; `ApiClient` interface to extend.
- `packages/bot/src/handlers/callbackQuery.ts` — `safeAnswerCallback` helper (already exported-adjacent, but defined locally in the file — replicate the pattern, do not import it). The `handleCallbackQuery` dispatch switch will be extended.
- `packages/bot/src/lib/conversationState.ts` — `getState`, `setState`, `BotState` interface (to extend with `pendingPhotoFileId`). No new Redis utilities needed.
- `packages/bot/src/commands/restaurante.ts` — inline keyboard construction pattern (`reply_markup: { inline_keyboard: [...] }`) and the `bot.sendMessage` with `parse_mode: 'MarkdownV2'` call pattern.
- `packages/bot/src/commands/errorMessages.ts` — `handleApiError` for generic API error formatting (used in existing callback handler).
- `packages/bot/src/formatters/markdownUtils.ts` — `escapeMarkdown` for all user-facing message text.
- `packages/bot/src/logger.ts` — `logger.warn` / `logger.error` pattern.
- `packages/bot/src/__tests__/config.test.ts` — test pattern for `parseConfig`: `exitSpy`, `beforeAll` dynamic import, `VALID_BOT_ENV` fixture, `satisfies NodeJS.ProcessEnv`.
- `packages/bot/src/__tests__/f032.callbackQuery.test.ts` — `makeMockRedis`, `makeMockBot`, `makeMockClient`, `makeQuery` fixtures and the `describe` / `beforeEach` / `vi.clearAllMocks()` structure.
- `packages/bot/src/__tests__/f032.apiClient.test.ts` — `makeResponse`, `vi.stubGlobal('fetch', fetchMock)` / `vi.unstubAllGlobals()` pattern for fetch mocking; `TEST_CONFIG` fixture shape.
- `packages/bot/src/__tests__/bot.test.ts` — `vi.mock('node-telegram-bot-api', ...)` at the top (hoisted), `getMockBotInstance`, checking `bot.on` call registration.

---

#### Files to Create

| Path | Purpose |
|------|---------|
| `packages/bot/src/handlers/fileUpload.ts` | NEW — `handlePhoto` and `handleDocument` exports. Implements the full ALLOWED_CHAT_IDS guard, Redis state checks, file size pre-checks, Telegram file download, and API upload calls. |
| `packages/bot/src/__tests__/f031.config.test.ts` | Tests for the new `ALLOWED_CHAT_IDS` Zod field: empty-string, comma-separated, missing env var, non-numeric entries filtered. |
| `packages/bot/src/__tests__/f031.apiClient.test.ts` | Tests for `uploadImage` and `uploadPdf`: FormData call shape, timeout header, ADMIN_API_KEY used as X-API-Key, CONFIG_ERROR guard, network/timeout error handling. |
| `packages/bot/src/__tests__/f031.fileUpload.test.ts` | Tests for `handlePhoto` and `handleDocument`: all guard conditions, Redis state interactions, inline keyboard content, download error handling, API error surface. |
| `packages/bot/src/__tests__/f031.callbackQuery.test.ts` | Tests for `upload_ingest`, `upload_menu`, `upload_dish` callback branches: spinner dismissed, state guards, download + upload call, success message, "próximamente" message. |

---

#### Files to Modify

| Path | Change |
|------|--------|
| `packages/bot/src/config.ts` | Add `ALLOWED_CHAT_IDS` field to `BotEnvSchema` with the comma-separated string → `number[]` Zod transform. |
| `packages/bot/src/lib/conversationState.ts` | Add `pendingPhotoFileId?: string` field to the `BotState` interface. No implementation changes needed — `setState` already persists arbitrary `BotState` fields. |
| `packages/bot/src/apiClient.ts` | Add `IngestImageResult` and `IngestPdfResult` types; add `uploadImage` and `uploadPdf` to the `ApiClient` interface; implement both in `createApiClient` using a new `postFormData` internal helper; add `UPLOAD_TIMEOUT_MS = 90_000` module-level constant. |
| `packages/bot/src/handlers/callbackQuery.ts` | Import `handlePhoto` (not needed here — only apiClient) from `../apiClient.js`; add `upload_ingest`, `upload_menu`, and `upload_dish` branches before the unknown-data fallthrough. |
| `packages/bot/src/bot.ts` | Import `handlePhoto` and `handleDocument` from `./handlers/fileUpload.js`; register `bot.on('photo', ...)` and `bot.on('document', ...)` handlers after the `callback_query` registration. |
| `packages/bot/src/__tests__/bot.test.ts` | Update `makeMockClient` to include `uploadImage` and `uploadPdf` mock fns. Update `TEST_CONFIG` to include `ALLOWED_CHAT_IDS: []`. Add assertions that `photo` and `document` event handlers are registered via `bot.on`. |

---

#### Implementation Order

Follow TDD: write the failing test file for each unit first, then write the implementation until it passes before moving to the next step.

**Step 1 — Extend `BotState` and write config tests**

Files: `packages/bot/src/lib/conversationState.ts`, `packages/bot/src/__tests__/f031.config.test.ts`

Add `pendingPhotoFileId?: string` to the `BotState` interface in `conversationState.ts`. This is a pure type change with no runtime impact — safe to do first.

Then write `f031.config.test.ts` — the tests will fail until Step 2.

Test cases (acceptance criteria 25–27):
- `ALLOWED_CHAT_IDS` absent from env → parses to `[]` (default).
- `ALLOWED_CHAT_IDS=''` (empty string) → parses to `[]`.
- `ALLOWED_CHAT_IDS=123456789,987654321` → parses to `[123456789, 987654321]`.
- `ALLOWED_CHAT_IDS=123, 456` (with spaces around comma) → parses to `[123, 456]` (trim applied).
- `ALLOWED_CHAT_IDS=abc,123` (non-numeric entry) → `abc` is filtered out by `isNaN`, result is `[123]`.
- `parseConfig` does NOT call `process.exit(1)` when `ALLOWED_CHAT_IDS` is missing (it is optional).

Pattern: mirror `config.test.ts` exactly — same `exitSpy` setup, same `beforeAll` dynamic import, same `VALID_BOT_ENV` base fixture. Do NOT mutate `VALID_BOT_ENV` in the new file; copy it or spread it.

**Step 2 — Modify `config.ts`**

File: `packages/bot/src/config.ts`

Add to `BotEnvSchema`:

```
ALLOWED_CHAT_IDS: z.string()
  .optional()
  .transform((val) => {
    if (!val) return [];
    return val.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
  })
```

The `BotConfig` type is inferred from the schema, so `config.ALLOWED_CHAT_IDS` will be typed as `number[]` automatically after this change.

Also update the existing `bot.test.ts` `TEST_CONFIG` fixture to include `ALLOWED_CHAT_IDS: []` (required because `BotConfig` now includes the field). The test file's `makeMockClient` must also add `uploadImage: vi.fn()` and `uploadPdf: vi.fn()` to avoid TypeScript errors once the interface is extended (can be done simultaneously with Step 4 or here if preferred).

**Step 3 — Write failing apiClient tests**

File: `packages/bot/src/__tests__/f031.apiClient.test.ts`

Pattern: mirror `f032.apiClient.test.ts` — `makeResponse`, `vi.stubGlobal('fetch', fetchMock)` / `vi.unstubAllGlobals()` in `beforeEach`/`afterEach`, `beforeAll` dynamic import of `createApiClient`. Use `TEST_CONFIG` with `ADMIN_API_KEY: 'test-admin-key'`.

Test cases for `uploadImage`:
- Calls `POST /ingest/image` URL.
- Sends `FormData` body (no `Content-Type` header set manually — fetch sets it automatically with boundary when body is `FormData`).
- Uses `X-API-Key: ADMIN_API_KEY` (not `BOT_API_KEY`).
- Sends `X-FXP-Source: bot` header.
- Returns parsed `data` envelope on 200.
- Throws `ApiError(408, 'TIMEOUT')` when `AbortController` fires (advance fake timers by 90001 ms or mock `setTimeout`).
- Throws `ApiError(0, 'NETWORK_ERROR')` on fetch rejection.
- Throws `ApiError(500, 'CONFIG_ERROR')` immediately (no fetch call) when `ADMIN_API_KEY` is `undefined` in config.
- Correctly includes optional `chainSlug` field in FormData when provided.
- Does NOT include `chainSlug` field in FormData when absent.

Test cases for `uploadPdf`:
- Calls `POST /ingest/pdf` URL.
- Uses `X-API-Key: ADMIN_API_KEY`.
- Throws `ApiError(500, 'CONFIG_ERROR')` immediately when `ADMIN_API_KEY` is `undefined`.
- Returns parsed `data` envelope on 200.

Note on FormData assertions: `fetch` is called with a `FormData` object as the body. Assert `init.body instanceof FormData`. To verify individual fields, call `(init.body as FormData).get('restaurantId')` etc. `Blob` content cannot be easily inspected without reading — test that the `file` field exists and is a `Blob` instance: `expect((init.body as FormData).get('file')).toBeInstanceOf(Blob)`.

**Step 4 — Modify `apiClient.ts`**

File: `packages/bot/src/apiClient.ts`

Add at module scope (below `REQUEST_TIMEOUT_MS`):
```typescript
export const UPLOAD_TIMEOUT_MS = 90_000;
```

Add result types above the `ApiClient` interface:
```typescript
export interface IngestImageResult {
  dishesFound: number;
  dishesUpserted: number;
  dishesSkipped: number;
  dryRun: boolean;
  dishes: unknown[];
  skippedReasons: Array<{ dishName: string; reason: string }>;
}
export type IngestPdfResult = IngestImageResult;
```

Extend the `ApiClient` interface with:
```typescript
uploadImage(params: {
  fileBuffer: Buffer;
  filename: string;
  mimeType: string;
  restaurantId: string;
  sourceId: string;
  dryRun?: boolean;
  chainSlug?: string;
}): Promise<IngestImageResult>;

uploadPdf(params: {
  fileBuffer: Buffer;
  filename: string;
  restaurantId: string;
  sourceId: string;
  dryRun?: boolean;
  chainSlug?: string;
}): Promise<IngestPdfResult>;
```

Add a private `postFormData<T>` helper inside `createApiClient` — modelled on `postJson` but with these differences:
- Does NOT set `Content-Type` header (let `fetch` derive it from the `FormData` body, which is required for the multipart boundary to be set correctly).
- Uses `UPLOAD_TIMEOUT_MS` (90 s) instead of `REQUEST_TIMEOUT_MS` (10 s).
- Accepts `FormData` as body.
- Uses `adminKey ?? apiKey` for `X-API-Key` (same as `postJson`).

Guard at the top of both `uploadImage` and `uploadPdf`: if `config.ADMIN_API_KEY` is `undefined`, throw `new ApiError(500, 'CONFIG_ERROR', 'ADMIN_API_KEY not configured')` without making a network call.

`uploadImage` implementation:
1. Build `FormData`: append `restaurantId`, `sourceId`, `dryRun` (string form: `String(params.dryRun ?? false)`), optionally `chainSlug`.
2. Append `file` as `new Blob([params.fileBuffer], { type: params.mimeType })` with filename `params.filename`.
3. Call `postFormData<IngestImageResult>('/ingest/image', form, config.ADMIN_API_KEY)`.

`uploadPdf` implementation:
1. Build `FormData`: same fields minus `mimeType`.
2. Append `file` as `new Blob([params.fileBuffer], { type: 'application/pdf' })` with filename `params.filename`.
3. Call `postFormData<IngestPdfResult>('/ingest/pdf', form, config.ADMIN_API_KEY)`.

**Step 5 — Write failing fileUpload handler tests**

File: `packages/bot/src/__tests__/f031.fileUpload.test.ts`

Use `makeMockRedis`, `makeMockBot`, `makeMockClient` (extended with `uploadImage` and `uploadPdf` vi.fns) from the existing pattern. No module-level vi.mock needed — all dependencies are injected.

Helper `makePhotoMsg(chatId, photos?, fileSize?)` returns a `TelegramBot.Message` with `chat.id`, `photo` array. Helper `makeDocMsg(chatId, mime, fileSize?, fileName?)` returns a `TelegramBot.Message` with `document` field.

For tests involving `bot.getFileLink` and `fetch` (Telegram file download), mock `bot.getFileLink` as `vi.fn().mockResolvedValue('https://telegram.org/file/bot-token/file_id')` and stub `global.fetch` with `vi.stubGlobal` returning a fake `Response` with `arrayBuffer()` resolving to a small Buffer. Restore with `vi.unstubAllGlobals()` in `afterEach`.

Test cases for `handlePhoto` (acceptance criteria 10–12, plus error cases):
- Chat ID not in `ALLOWED_CHAT_IDS` (empty array) → no `sendMessage` call, function returns.
- Chat ID not in `ALLOWED_CHAT_IDS` (populated list, ID absent) → silent ignore.
- Allowed chat, no selected restaurant (state null) → sends "Primero selecciona un restaurante" message.
- Allowed chat, no selected restaurant (state has other fields but no `selectedRestaurant`) → same message.
- Allowed chat, restaurant selected, `file_size > 10 * 1024 * 1024` → sends "El archivo supera el límite" message, no keyboard.
- Allowed chat, restaurant selected, file size ok → stores `pendingPhotoFileId` in Redis state via `setState`, sends message with 3-button inline keyboard.
- Inline keyboard buttons have `callback_data` values `upload_ingest`, `upload_menu`, `upload_dish` exactly.
- `setState` is called with the updated state preserving existing fields plus `pendingPhotoFileId`.

Test cases for `handleDocument` (acceptance criteria 15–20, plus error cases):
- Chat ID not in `ALLOWED_CHAT_IDS` → silent ignore.
- MIME type not PDF/JPEG/PNG (e.g. `application/vnd.openxmlformats-officedocument.wordprocessingml.document`) → sends "Solo se admiten archivos PDF o imágenes" message.
- Allowed chat, valid MIME, no selected restaurant → sends "Primero selecciona un restaurante" message.
- Allowed chat, PDF, file_size > 10 MB → sends file-too-large error, no API call.
- Allowed chat, PDF, ok size, download succeeds → sends "Procesando documento…", calls `uploadPdf` with correct params (including `sourceId = '00000000-0000-0000-0000-000000000099'`), sends success summary.
- Allowed chat, JPEG document (image sent as file), ok size → calls `uploadImage` (not `uploadPdf`), sends success summary.
- Allowed chat, PNG document, ok size → calls `uploadImage`, sends success summary.
- `bot.getFileLink` throws → sends "Error al descargar el archivo" message, no API call.
- `fetch` for download rejects → sends "Error al descargar el archivo" message.
- `uploadPdf` throws `ApiError(500, 'CONFIG_ERROR')` → sends "El bot no está configurado para subir archivos" message.
- `uploadPdf` throws `ApiError(422, 'NO_NUTRITIONAL_DATA_FOUND')` → sends the no-data message.
- `uploadPdf` throws generic `ApiError(500, 'SERVER_ERROR', 'internal error')` → sends "Error al procesar el archivo: internal error" message.
- `document.file_name` absent → filename falls back to `'document.pdf'` for PDFs.
- `state.selectedRestaurant.chainSlug` present → passed as `chainSlug` in upload params.
- `state.selectedRestaurant.chainSlug` absent → `chainSlug` not passed (undefined).

Success summary message format assertions:
- Contains restaurant name.
- Contains `dishesFound`, `dishesUpserted`, `dishesSkipped` counts.
- Uses `parse_mode: 'MarkdownV2'`.

**Step 6 — Implement `handlers/fileUpload.ts`**

File: `packages/bot/src/handlers/fileUpload.ts`

Imports: `TelegramBot` type, `Redis` type, `ApiClient`, `ApiError` from `../apiClient.js`, `BotConfig` from `../config.js`, `getState`, `setState` from `../lib/conversationState.js`, `escapeMarkdown` from `../formatters/markdownUtils.js`, `logger` from `../logger.js`.

Constants:
```typescript
const UPLOAD_SOURCE_ID = '00000000-0000-0000-0000-000000000099';
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
```

Private helper `downloadTelegramFile(bot, fileId): Promise<Buffer>`:
- Calls `bot.getFileLink(fileId)` → receives URL string.
- Calls `fetch(url)` → checks `response.ok` (throws if non-2xx, e.g. Telegram 403/404) → calls `response.arrayBuffer()` → returns `Buffer.from(arrayBuffer)`.
- After buffer creation, checks `buffer.length <= MAX_FILE_SIZE_BYTES` (post-download size guard — complements pre-download metadata check). Throws if over limit.
- Throws on any error (caller wraps in try/catch).

Private helper `formatUploadSuccess(result, restaurantName): string`:
- Builds the MarkdownV2 success summary using `escapeMarkdown` on all interpolated values.
- Shape: `*✅ Ingesta completada*\nRestaurante: ...\nPlatos encontrados: ...\nPlatos guardados: ...\nPlatos omitidos: ...`

Private helper `formatUploadError(err): string`:
- If `err` is `ApiError` with code `CONFIG_ERROR` → return the "not configured" message.
- If `err` is `ApiError` with code `NO_NUTRITIONAL_DATA_FOUND` → return the no-data message.
- Otherwise → return `"Error al procesar el archivo: [message]. Inténtalo de nuevo."` with `escapeMarkdown` applied to the error message.

`handlePhoto` implementation (follow exact order from spec):
1. `ALLOWED_CHAT_IDS` guard: `if (!config.ALLOWED_CHAT_IDS.includes(msg.chat.id)) return;`
2. Guard: `if (!msg.photo) return;`
3. `const state = await getState(redis, msg.chat.id);`
4. Restaurant guard: `if (!state?.selectedRestaurant)` → `bot.sendMessage(...)`, return.
5. Select highest-res photo: `const photo = msg.photo[msg.photo.length - 1];`
6. File size guard: `if ((photo.file_size ?? 0) > MAX_FILE_SIZE_BYTES)` → send error, return.
7. `await setState(redis, msg.chat.id, { ...state, pendingPhotoFileId: photo.file_id });`
8. `await bot.sendMessage(chatId, '¿Qué quieres hacer con esta foto?', { parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: [[...3 buttons...]] } });`

`handleDocument` implementation (follow exact order from spec):
1. `ALLOWED_CHAT_IDS` guard.
2. `if (!msg.document) return;`
3. MIME guard (accept only `application/pdf`, `image/jpeg`, `image/png`).
4. `const state = await getState(...)`. Restaurant guard.
5. File size guard on `msg.document.file_size`.
6. Send "Procesando documento…" (plain text, no parse_mode).
7. try/catch download block.
8. Upload (PDF or image branch) + success message or error message.

**Step 7 — Write failing callbackQuery tests**

File: `packages/bot/src/__tests__/f031.callbackQuery.test.ts`

Pattern: mirror `f032.callbackQuery.test.ts` exactly — same fixtures and helper functions, same `describe` / `beforeEach` structure. Extend `makeMockClient` to include `uploadImage` and `uploadPdf` mock fns. Extend `makeMockBot` to include `getFileLink` mock fn.

Test cases for `upload_ingest`:
- Spinner is dismissed via `answerCallbackQuery` in all branches.
- Chat ID not in `ALLOWED_CHAT_IDS` → dismiss spinner, no further processing (end-to-end guard).
- State is null → sends "No hay restaurante seleccionado" message, no download/upload.
- State has no `selectedRestaurant` → sends "No hay restaurante seleccionado" message.
- State has `selectedRestaurant` but no `pendingPhotoFileId` → sends "La foto ha expirado" message, no download/upload.
- Happy path (state + pendingPhotoFileId present): sends "Procesando imagen…", calls `bot.getFileLink(pendingPhotoFileId)`, calls `uploadImage` with `filename: 'photo.jpg'`, `mimeType: 'image/jpeg'`, correct `restaurantId`, `sourceId: '00000000-0000-0000-0000-000000000099'`.
- On success: clears `pendingPhotoFileId` from state (`setState` called with state containing `pendingPhotoFileId: undefined` or key absent), sends success summary.
- `chainSlug` on `selectedRestaurant` present → passed to `uploadImage`.
- `bot.getFileLink` throws → sends "Error al descargar el archivo" message, `uploadImage` NOT called.
- `uploadImage` throws `ApiError(500, 'CONFIG_ERROR')` → sends "El bot no está configurado" message.
- `uploadImage` throws `ApiError(422, 'NO_NUTRITIONAL_DATA_FOUND')` → sends no-data message.

Test cases for `upload_menu`:
- Spinner dismissed.
- ALLOWED_CHAT_IDS guard applied.
- Sends "Esta función estará disponible próximamente" message.
- No `getState`, no `uploadImage` calls.

Test cases for `upload_dish`:
- Same as `upload_menu` — spinner dismissed, ALLOWED_CHAT_IDS guard, "próximamente" message, no API calls.

**Step 8 — Extend `callbackQuery.ts`**

File: `packages/bot/src/handlers/callbackQuery.ts`

Add imports: `ApiError` is already imported. No new imports needed — `handlePhoto`/`handleDocument` are not imported here; only `ApiClient` upload methods are used via the injected `apiClient`.

Add three new dispatch branches before the unknown-data fallthrough, following the existing `if (data === 'create_rest')` pattern:

`upload_ingest` branch (full logic inline — no separate helper function):
1. `await safeAnswerCallback(bot, query.id);`
2. ALLOWED_CHAT_IDS guard: `if (!config.ALLOWED_CHAT_IDS.includes(chatId)) return;` (end-to-end enforcement — prevents bypassing via stale keyboard from before ALLOWED_CHAT_IDS was changed).
3. `const state = await getState(redis, chatId);`
4. If `!state?.selectedRestaurant` → send "No hay restaurante seleccionado" message, return.
5. If `!state.pendingPhotoFileId` → send "La foto ha expirado" message, return.
6. Send "Procesando imagen…" (plain text, no parse_mode).
7. try/catch download: `bot.getFileLink(state.pendingPhotoFileId)` → `fetch(url)` → check `response.ok` → `Buffer.from(await response.arrayBuffer())`. Check `buffer.length <= MAX_FILE_SIZE_BYTES`. On any error → send "Error al descargar el archivo", return.
8. Call `apiClient.uploadImage({ fileBuffer, filename: 'photo.jpg', mimeType: 'image/jpeg', restaurantId: state.selectedRestaurant.id, sourceId: '00000000-0000-0000-0000-000000000099', chainSlug: state.selectedRestaurant.chainSlug })`.
9. On success: `await setState(redis, chatId, { ...state, pendingPhotoFileId: undefined })`; send success summary.
10. On `ApiError`: send formatted error message via `formatUploadError` (imported from `../handlers/fileUpload.js`) or inline the formatting logic. Prefer import — keeps messages consistent.
11. Return.

`upload_menu` and `upload_dish` branches:
- Both call `safeAnswerCallback`, apply ALLOWED_CHAT_IDS guard, send "Esta función estará disponible próximamente\\. 🔜" (MarkdownV2, escaped dot), and return.

Note: `BotStateRestaurant` in `conversationState.ts` does NOT currently have a `chainSlug` field. Add `chainSlug?: string` to `BotStateRestaurant`. Also update the restaurant selection flows to persist chainSlug:
- In `restaurante.ts` create flow: include `chainSlug: created.chainSlug` when calling `setState` after restaurant creation.
- In `callbackQuery.ts` `sel:{uuid}` flow: the API search results include `chainSlug` — store it in `searchResults` map (currently only stores name) and include in `setState`.
- In `restaurante.ts` search results storage: extend the stored value from just name to `{ name, chainSlug }`.
This is a small, safe change (3-4 lines across 2 files) that ensures chainSlug is available for F031 uploads whenever the user selects a chain restaurant.

**Step 9 — Register handlers in `bot.ts`**

File: `packages/bot/src/bot.ts`

Add import: `import { handlePhoto, handleDocument } from './handlers/fileUpload.js';`

Register after the `callback_query` handler (before `polling_error`):

```typescript
bot.on('photo', async (msg) => {
  try {
    await handlePhoto(msg, bot, apiClient, redis, config);
  } catch (err) {
    logger.error({ err, chatId: msg.chat.id }, 'Unhandled photo handler error');
  }
});

bot.on('document', async (msg) => {
  try {
    await handleDocument(msg, bot, apiClient, redis, config);
  } catch (err) {
    logger.error({ err, chatId: msg.chat.id }, 'Unhandled document handler error');
  }
});
```

No changes to the `message` handler are needed — it already ignores messages with no `msg.text` (line 161: "Empty text or media (no msg.text) → silently ignore").

Update `bot.test.ts` for the two new registration assertions:
- `photo` handler registered via `bot.on`.
- `document` handler registered via `bot.on`.
- The existing `"registers onText exactly 9 times"` test does NOT change (no new `onText` calls).
- Update `makeMockClient` in `bot.test.ts` to add `uploadImage: vi.fn()` and `uploadPdf: vi.fn()`.
- Update `TEST_CONFIG` in `bot.test.ts` to add `ALLOWED_CHAT_IDS: []`.

---

#### Testing Strategy

**Test files to create:**

| File | Covers |
|------|--------|
| `packages/bot/src/__tests__/f031.config.test.ts` | `ALLOWED_CHAT_IDS` Zod transform (acceptance criteria 25–27) |
| `packages/bot/src/__tests__/f031.apiClient.test.ts` | `uploadImage` and `uploadPdf` (FormData shape, auth header, timeout, CONFIG_ERROR guard) |
| `packages/bot/src/__tests__/f031.fileUpload.test.ts` | `handlePhoto` and `handleDocument` (all guards, keyboard content, download, upload, error surface) |
| `packages/bot/src/__tests__/f031.callbackQuery.test.ts` | `upload_ingest`, `upload_menu`, `upload_dish` callback branches |

**Key test scenarios by acceptance criterion:**

| AC# | File | Scenario |
|-----|------|---------|
| 10 | f031.fileUpload | Photo to unlisted chat → no `sendMessage` |
| 11 | f031.fileUpload | Photo, allowed chat, no restaurant → "Primero selecciona" message |
| 12 | f031.fileUpload | Photo, allowed chat, restaurant set → 3-button keyboard sent |
| 13 | f031.callbackQuery | `upload_ingest` → download + `uploadImage` + success summary |
| 14 | f031.callbackQuery | `upload_menu` / `upload_dish` → "próximamente" message |
| 15 | f031.fileUpload | PDF document, allowed, restaurant set → `uploadPdf` + success summary |
| 16 | f031.fileUpload | Non-PDF/image document → MIME error message |
| 17 | f031.fileUpload | PDF to unlisted chat → silent ignore |
| 18–19 | f031.fileUpload | JPEG/PNG as document → `uploadImage` flow |
| 20 | f031.fileUpload | .docx document → MIME error message |
| 21 | f031.fileUpload / f031.callbackQuery | `getFileLink` throws → "Error al descargar" message |
| 22 | f031.callbackQuery | `upload_ingest`, state expired → "No hay restaurante" message |
| 23 | f031.callbackQuery | `upload_ingest`, no `pendingPhotoFileId` → "La foto ha expirado" message |
| 24 | f031.fileUpload / f031.callbackQuery | `uploadImage` throws CONFIG_ERROR → "no configurado" message |
| 25–27 | f031.config | `ALLOWED_CHAT_IDS` transform edge cases |

**Mocking strategy:**

- `TelegramBot` and `ApiClient`: injected as plain mock objects (DI — no `vi.mock` needed in fileUpload or callbackQuery tests). Same pattern as `f032.callbackQuery.test.ts`.
- `Redis`: injected mock with `get`/`set`/`del` as `vi.fn()`. Same pattern as existing tests.
- `bot.getFileLink`: add to `makeMockBot()` as `getFileLink: vi.fn().mockResolvedValue('https://example.com/file')`.
- `global.fetch` for Telegram file download: `vi.stubGlobal('fetch', fetchMock)` in `beforeEach`, `vi.unstubAllGlobals()` in `afterEach`. Return a fake Response with `arrayBuffer: async () => new ArrayBuffer(8)`.
- `bot.ts` test: `vi.mock('node-telegram-bot-api', ...)` already at top (hoisted). No additional mocks needed — just verify `bot.on` call count and event names.
- `config.ts` test: same `exitSpy` + `beforeAll` dynamic import pattern from `config.test.ts`.

---

#### Key Patterns

- **Allowed-chat guard placement**: must be the very first check in both `handlePhoto` and `handleDocument` — before any Redis access. This prevents leaking bot existence to unknown users.
- **`bot.getFileLink` return type**: `node-telegram-bot-api` types it as `Promise<string>`. The returned string is the full HTTPS download URL. Pass directly to `fetch()`.
- **FormData + Blob (not `node-fetch`)**: Node.js 18+ has native `FormData` and `Blob` globals. Do NOT import from `form-data` or `node-fetch` packages. The existing codebase uses native `fetch` throughout.
- **Content-Type NOT set on FormData requests**: when `fetch` receives a `FormData` body, it automatically sets `Content-Type: multipart/form-data; boundary=...`. Manually setting `Content-Type` will break the boundary. The `postFormData` helper must omit `Content-Type` from its headers object.
- **`safeAnswerCallback` in callbackQuery.ts**: already defined locally in the file as a private function. Replicate the same try/catch `logger.warn` pattern for new branches — do not move it or export it.
- **MarkdownV2 escaping**: ALL user-facing text passed to `bot.sendMessage` with `parse_mode: 'MarkdownV2'` must have special characters escaped via `escapeMarkdown`. "Procesando documento…" and "Procesando imagen…" are sent as plain text (no `parse_mode`) so they do not need escaping.
- **`pendingPhotoFileId` in state**: stored under `BotState` in Redis, persisted via `setState`. The key is overwritten on each new photo — only the most recent photo's fileId is actionable. Clearing after use: `setState(redis, chatId, { ...state, pendingPhotoFileId: undefined })` — spread + set to `undefined` (JSON.stringify omits undefined values, so the key is effectively deleted from the serialized object).
- **`bot.on('photo')` vs `bot.on('message')`**: these are separate event channels in `node-telegram-bot-api`. A Telegram `message.photo` fires both `'photo'` and `'message'` events. The existing `'message'` handler guards with `if (!text.trim()) return` (line 158–160 in `bot.ts`), so photos arriving there are already silently ignored. The new `'photo'` handler fires independently and does not conflict.
- **`chainSlug` on `BotStateRestaurant`**: add `chainSlug?: string` to `BotStateRestaurant` in `conversationState.ts`. The restaurant selection flows (`restaurante.ts`, `sel:` callback branch) do not currently persist chainSlug — this field will be `undefined` in most states until those flows are updated in a future ticket. The upload handlers must handle the `undefined` case (`chainSlug: state.selectedRestaurant.chainSlug ?? undefined` — or simply pass the field optionally).
- **`UPLOAD_SOURCE_ID` constant**: define as a module-level constant in `fileUpload.ts` (`'00000000-0000-0000-0000-000000000099'`). The same value is used in the `upload_ingest` callback branch in `callbackQuery.ts` — define it again locally there (or export from fileUpload.ts and import). Prefer exporting from `fileUpload.ts` to avoid duplication.
- **`bot.test.ts` update**: the existing `"registers onText exactly 9 times"` assertion is count-sensitive. Two new `bot.on` calls (photo, document) do not affect `onText` count. The existing `"registers message handler via bot.on"` test uses `toBeGreaterThanOrEqual(1)`, so adding more `bot.on` calls does not break it.

---

_Plan written by backend-planner agent, 2026-03-26._

---

## Acceptance Criteria

_See Spec > Acceptance Criteria section above (29 criteria)._

---

## Definition of Done

- [x] All acceptance criteria met (29/29)
- [x] Unit tests written and passing (137 tests: 44 API + 93 bot)
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds
- [x] Specs reflect final implementation (`api-spec.yaml` updated)

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` + `frontend-planner` executed, plan approved
- [x] Step 3: `backend-developer` + `frontend-developer` executed with TDD
- [x] Step 4: `production-code-validator` executed, quality gates pass
- [x] Step 5: `code-review-specialist` executed — APPROVED with 2 HIGH fixed (DRY download, shared constant)
- [x] Step 5: `qa-engineer` executed — 1 bug found+fixed (BUG-F031-01), 29 edge-case tests added
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-26 | Spec drafted | spec-creator agent |
| 2026-03-26 | Spec reviewed | Gemini 2.5 + Codex GPT-5.4. 8 issues total (1C+5I+2S). 7 addressed, 1 descartado (C1: ADR-009 confusion). Key fixes: image-as-document support, pre-check file_size, try/catch on downloads, pass chainSlug from state |
| 2026-03-26 | Plan reviewed | Codex GPT-5.4 (Gemini failed: 429+500). 5 IMPORTANT + 1 SUGGESTION. All 5 addressed: ALLOWED_CHAT_IDS in callbacks, persist chainSlug in restaurant state, 413 FST_REQ_FILE_TOO_LARGE mapping, response.ok check, post-download size guard. AC 23 clarified. |
| 2026-03-26 | Backend implemented | 34 tests (2 files). POST /ingest/image route + app.ts registration + errorHandler FST_REQ_FILE_TOO_LARGE fix |
| 2026-03-26 | Bot implemented | 74 tests (4 files). handlePhoto, handleDocument, upload callbacks, apiClient multipart, ALLOWED_CHAT_IDS config |
| 2026-03-26 | Production validator | 1 CRITICAL fixed: config optional chaining in callbackQuery.ts → made config required parameter |
| 2026-03-26 | Code review | APPROVED. 2 HIGH fixed (DRY download logic, shared MAX_FILE_SIZE_BYTES), 2 MEDIUM noted (JSDoc fixed, hardcoded JPEG comment added) |
| 2026-03-26 | QA engineer | 1 bug found (BUG-F031-01: empty msg.photo array crash) — fixed. 29 edge-case tests added (19 bot + 10 API). Total: 137 F031 tests |

---

## Notes

- The `callbackQuery.ts` dispatch table will grow. Consider adding a comment block for upload callbacks clearly separate from the restaurant selection callbacks.
- For the 64-byte `callback_data` limit (edge case 5), short opaque callback_data strings (`upload_ingest`, `upload_menu`, `upload_dish`) are used. The `pendingPhotoFileId` is stored in Redis state and retrieved in the callback handler.
- `bot.on('photo')` and `bot.on('document')` fire in PARALLEL with `bot.on('message')` in node-telegram-bot-api. However, the existing `bot.on('message')` handler at `bot.ts:140` safely ignores non-text messages (line 161: `// Empty text or media → silently ignore`), so there is no conflict. Both handlers will fire for a photo message, but only the `photo` handler will act on it.
- The `uploadImage` and `uploadPdf` timeout in `apiClient.ts` should be set to 90 seconds (not the standard 10 seconds) because the API-side processing can take up to 60 seconds. If the standard `REQUEST_TIMEOUT_MS` constant is used, uploads will always time out. A separate constant `UPLOAD_TIMEOUT_MS = 90_000` should be defined.

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Plan, AC, DoD, Workflow, Log, Evidence |
| 1. Mark all items | [x] | AC: 29/29, DoD: 6/6, Workflow: 0-5/6 |
| 2. Verify product tracker | [x] | Active Session: 5/6 (Review), Features table: 5/6 in-progress |
| 3. Update key_facts.md | [x] | Added: POST /ingest/image route, fileUpload handler, conversationState fields, ALLOWED_CHAT_IDS, test counts |
| 4. Update decisions.md | [x] | N/A — no new ADR needed |
| 5. Commit documentation | [x] | See commit below |
| 6. Verify clean working tree | [x] | `git status`: clean after docs commit |
