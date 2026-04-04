# F075: Audio Input (Whisper → ConversationCore)

**Feature:** F075 | **Type:** Backend-Feature | **Priority:** High
**Status:** In Progress | **Branch:** feature/F075-audio-input
**Created:** 2026-04-04 | **Dependencies:** F070 (Conversation Core) ✅

---

## Spec

### Description

**Problem:** nutriXplorer's Telegram bot only accepts text input. Spain is the paradise of WhatsApp/Telegram voice notes — users naturally want to say "me he comido dos pinchos de tortilla y una caña" rather than type it. Without voice support, we lose the primary Spanish UX pattern and force friction that competitors (MyFitnessPal) also impose.

**Solution:** Add voice message processing to the Telegram bot. When a user sends a voice note, the bot downloads the audio file from Telegram's CDN, forwards it to a new API endpoint (`POST /conversation/audio`) which transcribes via OpenAI Whisper, then pipes the transcribed text through the existing ConversationCore pipeline (F070). The response is formatted identically to text messages — no new UI or formatting changes.

**Architecture decisions:**
1. **Transcription in API, not bot** — Keeps the bot as a thin adapter (F070 design principle). The API already owns the OpenAI client. When the web assistant arrives (Phase C, F093), it reuses the same endpoint without duplicating Whisper logic.
2. **New endpoint `POST /conversation/audio`** — Accepts multipart/form-data with an audio file. Transcribes, then delegates to `processMessage()`. On success, returns the same `ConversationMessageData` envelope. On transcription failure or empty result, returns a standard error envelope (`{ success: false, error: { code, message } }`) — the bot catches these and shows user-friendly messages. This is cleaner than overloading `/conversation/message` with binary payloads.
3. **Async batch transcription** — Whisper API batch mode (~1-2s latency). Uses `temperature: 0` to minimize hallucinations. Streaming STT deferred to Phase C (F093). Sufficient for Telegram where voice notes are pre-recorded.
4. **Bot timeout** — `VOICE_TIMEOUT_MS = 30_000` (30s) for the `/conversation/audio` call, mirroring `RECIPE_TIMEOUT_MS` pattern. Whisper (~1-3s) + ConversationCore + L4 cascade can easily exceed the default 10s `REQUEST_TIMEOUT_MS`.
5. **Duration guard** — Max 120 seconds. Cost control ($0.006/min × 2min = $0.012 max per message) and relevance (voice notes >2min are unlikely to be meal descriptions).
6. **File size guard** — Reuse existing 10MB limit from `@fastify/multipart` global config (Telegram voice is typically 50-200KB for 10-30s notes).

**What this enables:**
- "Me he comido dos pinchos de tortilla y una caña" → instant nutritional estimation
- Zero typing friction for the primary Spanish mobile use case
- Validates voice→estimation latency for Phase C realtime voice

### API Changes

**New endpoint: `POST /conversation/audio`**

```
POST /conversation/audio
Content-Type: multipart/form-data
X-API-Key: <bot-api-key or user-api-key>
X-Actor-Id: telegram:<chatId>

Form fields:
  audio: File (required) — audio/ogg, audio/mpeg, audio/mp4, audio/wav, audio/webm
  duration: number (required) — audio duration in seconds (from Telegram msg.voice.duration or client-side measurement). Max 120.
  chainSlug: string (optional) — legacy context fallback
  chainName: string (optional) — legacy context fallback

Response (success): 200
{
  "success": true,
  "data": ConversationMessageData  // same as POST /conversation/message
}

Response (transcription failure): 422
{
  "success": false,
  "error": { "code": "TRANSCRIPTION_FAILED", "message": "..." }
}

Response (empty transcription): 422
{
  "success": false,
  "error": { "code": "EMPTY_TRANSCRIPTION", "message": "..." }
}

Errors:
  400 VALIDATION_ERROR — missing audio field, unsupported MIME type, missing/invalid duration, duration >120s
  413 PAYLOAD_TOO_LARGE — file exceeds 10MB (handled by @fastify/multipart)
  422 EMPTY_TRANSCRIPTION — Whisper returned empty/whitespace text
  502 TRANSCRIPTION_FAILED — Whisper API error after retry
  429 ACTOR_RATE_LIMIT_EXCEEDED — shares 'queries' bucket (50/day per actor)
```

**Rate limiting:** Shares the existing 'queries' bucket with GET /estimate and POST /conversation/message (50/day per actor). A voice message counts as one query.

**Query logging:** Same fire-and-forget pattern as `/conversation/message`. Logs `source: 'bot'` (or `'api'`), `queryText: <transcribed text>`. Whisper transcription latency is logged via the application logger (`logger.info({ audioTranscriptionMs })`) — not in the `query_logs` table (no schema changes).

### Data Model Changes

None. No new tables, no migrations, no schema changes.

### UI Changes

None. Bot response formatting is identical to text messages (same formatters). The only visible difference: bot sends a Telegram `typing` chat action while transcription and processing run.

### Edge Cases & Error Handling

1. **Empty transcription** — Whisper returns empty/whitespace string → API returns 422 EMPTY_TRANSCRIPTION → bot shows "No he podido entender el audio. ¿Puedes repetirlo o escribirlo?"
2. **Non-Spanish audio** — We set `language: 'es'` on Whisper to optimize for Spanish. Non-Spanish input gets best-effort transcription (Whisper still works, just suboptimal).
3. **Background noise / unintelligible** — Whisper may hallucinate stock phrases (e.g., "Subtítulos por la comunidad de Amara.org", "Gracias por ver el vídeo"). API applies a hallucination filter: a set of known Whisper hallucination strings — if the entire transcription matches one, treat as empty (422 EMPTY_TRANSCRIPTION). Otherwise ConversationCore handles as normal text. Uses `temperature: 0` to minimize hallucinations.
4. **Duration >120s** — Bot-side guard: respond immediately without calling API. "Los mensajes de voz deben ser de menos de 2 minutos."
5. **File size >10MB** — Bot-side guard: respond immediately. "El archivo de audio es demasiado grande."
6. **Whisper API failure** (timeout, 429, 5xx) — Retry once with 1s backoff (same pattern as `callChatCompletion`). On final failure: API returns 502 TRANSCRIPTION_FAILED → bot shows "No he podido procesar el audio. Intenta escribir el mensaje."
7. **Telegram file download failure** — Same handling as existing `downloadTelegramFile` in fileUpload.ts.
8. **No OPENAI_API_KEY configured** — Whisper call fails gracefully → error response to user.
9. **Audio forwarded from another chat** — Telegram includes `msg.voice.file_id` regardless of forwarding. Works identically.
10. **Video notes (circular videos)** — Telegram sends these as `msg.video_note`, not `msg.voice`. Out of scope for F075 — only `msg.voice` is handled.
11. **Audio files sent as documents** — `msg.document` with audio MIME type. Out of scope — only `msg.voice` handler. Users who send audio as files can use the existing NL text flow.

---

## Implementation Plan

### Existing Code to Reuse

**API layer:**
- `packages/api/src/lib/openaiClient.ts` — `getOpenAIClient`, `isRetryableError`, `sleep`, `MAX_RETRIES`, `RETRY_BACKOFF_MS`, `OpenAILogger` type. The new `callWhisperTranscription` function follows the exact same structure as `callVisionCompletion` (2-attempt retry, catch-all, never throws, logger.warn on failure).
- `packages/api/src/routes/conversation.ts` — The full fire-and-forget query-log pattern (`reply.raw.once('finish', ...)`, `capturedData` capture, `writeQueryLog` calls, source header parsing, actor guard) must be replicated verbatim in the new audio route. The `X-FXP-Source` header parsing block is identical.
- `packages/api/src/conversation/conversationCore.ts` — `processMessage()` is called unchanged. The audio route passes the transcribed text as `text`.
- `packages/api/src/lib/queryLogger.ts` — `writeQueryLog` is reused as-is.
- `packages/api/src/errors/errorHandler.ts` — `VALIDATION_ERROR` and `TRANSCRIPTION_FAILED`/`EMPTY_TRANSCRIPTION` error codes follow the existing `mapError` pattern. The two new 422 codes must be added to `mapError`.
- `packages/api/src/app.ts` — `@fastify/multipart` is already registered globally with the 10 MB limit. The audio route plugin is registered here (no multipart re-registration needed).
- `packages/api/src/conversation/types.ts` — `ChainRow`, `ConversationRequest` types; no changes needed.

**Bot layer:**
- `packages/bot/src/handlers/fileUpload.ts` — `downloadTelegramFile(bot, fileId)` is reused directly without modification. `MAX_FILE_SIZE_BYTES` constant is reused.
- `packages/bot/src/handlers/naturalLanguage.ts` — `handleNaturalLanguage` formatting switch (estimation / comparison / context_set / text_too_long) is the reference pattern for the voice handler's response formatting path. The voice handler calls `apiClient.sendAudio()` instead of `apiClient.processMessage()`, then formats the returned `ConversationMessageData` identically.
- `packages/bot/src/lib/conversationState.ts` — `getState(redis, chatId)` is reused to read `legacyChainContext` (same as naturalLanguage.ts).
- `packages/bot/src/apiClient.ts` — `postFormData<T>()` private helper, `ApiError` class, `RECIPE_TIMEOUT_MS` as the naming pattern for `VOICE_TIMEOUT_MS`. The `sendAudio` implementation follows the existing `processMessage` implementation: custom `fetch` call with `X-Actor-Id: telegram:<chatId>` header, uses `postFormData` via FormData construction.
- `packages/bot/src/formatters/` — `formatEstimate`, `formatComparison`, `formatContextConfirmation`, `escapeMarkdown` are all reused unchanged.

**Shared layer:**
- `@foodxplorer/shared` — `ConversationMessageData` type is unchanged. No new Zod schemas needed (the audio endpoint uses raw multipart, not JSON body validation via shared schema).

---

### Files to Create

| File | Purpose |
|------|---------|
| `packages/api/src/__tests__/f075.whisper.unit.test.ts` | Unit tests for `callWhisperTranscription` — mock OpenAI, test success, retry, hallucination filter |
| `packages/api/src/__tests__/f075.audio.route.test.ts` | Route tests for `POST /conversation/audio` using `buildApp` + `inject()` — mock Whisper + processMessage |
| `packages/bot/src/handlers/voice.ts` | New bot handler: `handleVoice(msg, bot, apiClient, redis, config)` |
| `packages/bot/src/__tests__/f075.voice.unit.test.ts` | Unit tests for `handleVoice` — mock apiClient + bot, test all bot-side guards and error paths |

---

### Files to Modify

| File | Changes |
|------|---------|
| `packages/api/src/lib/openaiClient.ts` | Add `callWhisperTranscription(apiKey, audioBuffer, mimeType, logger)` function and `isWhisperHallucination(text)` helper with the hallucination string set |
| `packages/api/src/routes/conversation.ts` | Add `POST /conversation/audio` route handler inside the existing `conversationRoutesPlugin` (same plugin, new route — avoids duplicating the `loadChainData` init block and `ChainRow[]` state) |
| `packages/api/src/errors/errorHandler.ts` | Add `EMPTY_TRANSCRIPTION` and `TRANSCRIPTION_FAILED` cases to `mapError` (both map to 422) |
| `packages/api/src/plugins/actorRateLimit.ts` | Add `/conversation/audio` → `queries` to `ROUTE_BUCKET_MAP` |
| `packages/api/src/app.ts` | No changes needed — `conversationRoutes` plugin already registered; the new route is inside that plugin |
| `packages/bot/src/apiClient.ts` | Add `sendAudio` to `ApiClient` interface and implementation. Add `VOICE_TIMEOUT_MS = 30_000` constant |
| `packages/bot/src/bot.ts` | Import `handleVoice` and wire `bot.on('voice', ...)` following the `bot.on('photo', ...)` pattern |
| `docs/specs/api-spec.yaml` | Add `POST /conversation/audio` endpoint schema |

---

### Implementation Order

Follow TDD discipline: write the failing test first, implement until it passes, then proceed to the next step.

**Step 1 — `callWhisperTranscription` in `openaiClient.ts` (API unit)**

Write `packages/api/src/__tests__/f075.whisper.unit.test.ts` first. The test file mocks OpenAI the same way as `f034.openaiClient.test.ts` — `vi.hoisted` + `vi.mock('openai', ...)` to intercept `client.audio.transcriptions.create`. Test cases to write before implementing:

- Returns the transcription text string on success
- Calls `client.audio.transcriptions.create` with `model: 'whisper-1'`, `language: 'es'`, `temperature: 0`, and a `File` constructed from the audioBuffer + mimeType
- Returns `null` on non-retryable error (status 400) — single attempt
- Returns `null` after retrying once on 429 (retryable) — 2 attempts total
- Succeeds on second attempt after a 503 first attempt
- Calls `logger.warn` on failure
- Calls `logger.info` with `{ audioTranscriptionMs }` on success

Then implement `callWhisperTranscription` in `openaiClient.ts`:
- Signature: `callWhisperTranscription(apiKey: string | undefined, audioBuffer: Buffer, mimeType: string, logger?: OpenAILogger): Promise<string | null>`
- Guard: if `!apiKey` → `logger?.warn({}, 'Whisper: no API key configured')` → return `null` immediately
- Uses `getOpenAIClient(apiKey)`
- Constructs a `File` object: `new File([audioBuffer], 'audio.ogg', { type: mimeType })`
- Calls `client.audio.transcriptions.create({ model: 'whisper-1', file, language: 'es', temperature: 0 })`
- Returns `response.text` (not `response.choices`) — Whisper returns `{ text: string }` directly
- Same 2-attempt retry loop as `callChatCompletion`/`callVisionCompletion`
- Logs `{ audioTranscriptionMs: Math.round(performance.now() - startMs) }` via `logger.info` on success
- Returns `null` (never throws) on failure

**Step 2 — `isWhisperHallucination` in `openaiClient.ts` (API unit)**

Add tests for `isWhisperHallucination` to `f075.whisper.unit.test.ts`:

- Returns `true` for exact match of known hallucination string (e.g. `"Subtítulos por la comunidad de Amara.org"`)
- Returns `true` for trimmed match (leading/trailing whitespace)
- Returns `false` for legitimate transcription text
- Returns `false` for empty string (empty is handled separately by EMPTY_TRANSCRIPTION)
- Returns `true` for all hallucination strings in the set

Implement in `openaiClient.ts`:
- Export `const WHISPER_HALLUCINATIONS: ReadonlySet<string>` — the exact known bad strings (lowercase, no trailing punctuation):
  - `"subtítulos por la comunidad de amara.org"`
  - `"subtítulos realizados por la comunidad de amara.org"`
  - `"gracias por ver el vídeo"`
  - `"suscríbete al canal"`
  - `"música de fondo"`
  - `"gracias por ver"`
  - `"thanks for watching"`
  - `"thank you for watching"`
- Export `function isWhisperHallucination(text: string): boolean` — normalizes: `text.trim().toLowerCase().replace(/[.,!?]+$/, '')`, then checks `WHISPER_HALLUCINATIONS.has(normalized)`. Punctuation stripping handles Whisper's random trailing periods.

**Step 3 — `POST /conversation/audio` route (API unit tests first)**

Write `packages/api/src/__tests__/f075.audio.route.test.ts` first. Mock setup mirrors `f070.conversation.route.test.ts` exactly (same Kysely fluent stub, same Prisma mock, same Redis mock, same `mockRunEstimationCascade`). Additional mocks:

- `vi.mock('../lib/openaiClient.js', () => ({ callWhisperTranscription: mockCallWhisperTranscription, isWhisperHallucination: mockIsWhisperHallucination, getOpenAIClient: vi.fn(), isRetryableError: vi.fn(), sleep: vi.fn(), callChatCompletion: vi.fn(), callVisionCompletion: vi.fn(), callOpenAIEmbeddingsOnce: vi.fn() }))`

Test cases before implementation:
- 200: valid OGG multipart upload → Whisper returns text → processMessage runs → returns ConversationMessageData envelope
- 422 EMPTY_TRANSCRIPTION: Whisper returns empty string
- 422 EMPTY_TRANSCRIPTION: Whisper returns whitespace-only string
- 422 EMPTY_TRANSCRIPTION: `isWhisperHallucination` returns true for transcription
- 502 TRANSCRIPTION_FAILED: `callWhisperTranscription` returns null
- 400 VALIDATION_ERROR: missing `audio` field in multipart body
- 400 VALIDATION_ERROR: unsupported MIME type (e.g. `application/pdf`)
- 400 VALIDATION_ERROR: missing or non-numeric `duration` field
- 400 VALIDATION_ERROR: `duration` > 120 seconds
- 413 PAYLOAD_TOO_LARGE: file exceeds 10 MB (handled by `@fastify/multipart` automatically — `FST_REQ_FILE_TOO_LARGE` → `mapError` → 413)
- 429: rate limit exceeded (existing Redis incr mock returns > 50)
- 502 TRANSCRIPTION_FAILED: when `config.OPENAI_API_KEY` is undefined (callWhisperTranscription returns null)

Then implement the route inside `conversationRoutesPlugin` in `conversation.ts`:

```
app.post('/conversation/audio', { schema: { ... } }, async (request, reply) => {
  // 1. Read multipart parts: audio file + duration + optional chainSlug + chainName text fields
  // 2. Guard: missing audio part → 400 VALIDATION_ERROR
  // 3. Guard: unsupported MIME type → 400 VALIDATION_ERROR
  //    Allowed: audio/ogg, audio/mpeg, audio/mp4, audio/wav, audio/webm
  // 4. Guard: missing/non-numeric duration → 400 VALIDATION_ERROR
  // 5. Guard: duration > 120 → 400 VALIDATION_ERROR
  // 6. Read full file buffer from the part stream (await part.toBuffer())
  // 7. actorId guard (same as /conversation/message)
  // 8. Register fire-and-forget finish listener (same pattern — extracted helper)
  // 9. callWhisperTranscription(config.OPENAI_API_KEY, buffer, mimeType, request.log)
  // 10. Guard: result === null → 502 TRANSCRIPTION_FAILED
  // 11. Guard: result.trim() === '' → 422 EMPTY_TRANSCRIPTION
  // 12. Guard: isWhisperHallucination(result) → 422 EMPTY_TRANSCRIPTION
  // 13. processMessage({ text: result, actorId, ... }) — identical to /conversation/message
  // 14. capturedData = data; reply.send({ success: true, data })
})
```

Note on multipart reading: Use `request.parts()` async iterator pattern (same as existing `/ingest/image` route) — iterate parts, collect the file part into a buffer and text fields into variables. Do NOT use `request.file()` (only gets first file, misses text fields). The MIME type comes from `part.mimetype` on the file part.

Note on error codes: EMPTY_TRANSCRIPTION and TRANSCRIPTION_FAILED are thrown as `const err = new Error('...'); (err as any).code = 'EMPTY_TRANSCRIPTION'; throw err;` — the global errorHandler's `mapError` picks them up. Add both codes to `mapError` in Step 3a.

**Step 3a — Add error codes to `errorHandler.ts` + rate limit mapping**

Before the route implementation compiles:
1. Add to `mapError` in `errorHandler.ts`:
```
if (asAny['code'] === 'EMPTY_TRANSCRIPTION') → 422
if (asAny['code'] === 'TRANSCRIPTION_FAILED') → 422
```
2. Add to `ROUTE_BUCKET_MAP` in `actorRateLimit.ts`:
```
'/conversation/audio': 'queries',
```
This ensures audio requests share the 50/day per-actor limit with `/estimate` and `/conversation/message`.

**Step 4 — `ApiClient.sendAudio` (Bot unit tests first)**

Add to `f075.voice.unit.test.ts` (the bot test file, written before implementation):

- `sendAudio` is called with `{ audioBuffer, filename, mimeType, chatId, legacyChainContext? }`
- Constructs FormData with `audio` file field + optional `chainSlug` + `chainName` fields
- Sends `X-Actor-Id: telegram:<chatId>` header (same as `processMessage`)
- Uses `VOICE_TIMEOUT_MS` (30s) timeout
- On 200: returns parsed `ConversationMessageData`
- On 422 EMPTY_TRANSCRIPTION: throws `ApiError(422, 'EMPTY_TRANSCRIPTION', ...)`
- On 502 TRANSCRIPTION_FAILED: throws `ApiError(422, 'TRANSCRIPTION_FAILED', ...)`
- On timeout (AbortError): throws `ApiError(408, 'TIMEOUT', ...)`

Then implement in `apiClient.ts`:
- Add `VOICE_TIMEOUT_MS = 30_000` constant (exported, next to `RECIPE_TIMEOUT_MS`)
- Add `sendAudio` to `ApiClient` interface:
  ```typescript
  sendAudio(params: {
    audioBuffer: Buffer;
    filename: string;
    mimeType: string;
    duration: number;
    chatId: number;
    legacyChainContext?: { chainSlug: string; chainName: string };
  }): Promise<ConversationMessageData>;
  ```
- Implement with a custom `fetch` call (NOT `postFormData` — that uses `UPLOAD_TIMEOUT_MS` 90s). Same direct-fetch pattern as `processMessage`:
  - Construct `FormData`, append `audio` field as `new Blob([new Uint8Array(audioBuffer)], { type: mimeType })` with filename, append `duration` as string, optionally append `chainSlug` + `chainName` if `legacyChainContext` is present
  - Headers: `X-API-Key`, `X-Actor-Id: telegram:<chatId>`, `X-FXP-Source: bot` — NO `Content-Type` (let fetch set multipart boundary)
  - AbortController with `VOICE_TIMEOUT_MS` (30s) timeout
  - Parse `{ success, data }` envelope. On non-2xx, parse error envelope and throw `ApiError`

**Step 5 — `handleVoice` bot handler (bot unit tests first)**

Write bot unit tests in `f075.voice.unit.test.ts` before implementing the handler. Mock `downloadTelegramFile` and `apiClient.sendAudio`. Test cases:

- Happy path: valid voice msg (duration=10, file_size=50000) → `bot.sendChatAction` called with `'typing'`, `downloadTelegramFile` called, `apiClient.sendAudio` called → formats and sends estimation response
- Duration guard: `msg.voice.duration > 120` → sends "Los mensajes de voz deben ser de menos de 2 minutos." immediately, no API call
- File size guard: `msg.voice.file_size > MAX_FILE_SIZE_BYTES` → sends "El archivo de audio es demasiado grande." immediately, no API call
- Download failure: `downloadTelegramFile` throws → sends error message, no API call
- ApiError EMPTY_TRANSCRIPTION: sends "No he podido entender el audio. ¿Puedes repetirlo o escribirlo?"
- ApiError TRANSCRIPTION_FAILED: sends "No he podido procesar el audio. Intenta escribir el mensaje."
- ApiError TIMEOUT (408): sends "El servidor ha tardado demasiado en procesar el audio. Inténtalo de nuevo."
- `comparison` intent response path: formats with `formatComparison`
- `context_set` intent response path: formats with `formatContextConfirmation`
- `text_too_long` intent response path (edge case: transcription itself is very long, though unlikely)

Implement `packages/bot/src/handlers/voice.ts`:
- Signature: `export async function handleVoice(msg: TelegramBot.Message, bot: TelegramBot, apiClient: ApiClient, redis: Redis, config: BotConfig): Promise<void>`
- All logic is inside a try/catch — errors send user-facing messages, never re-throw
- Bot-side guards first (before any async I/O):
  - Duration: `if ((msg.voice?.duration ?? 0) > 120)` → `bot.sendMessage(chatId, escapeMarkdown('Los mensajes de voz deben ser de menos de 2 minutos.'), { parse_mode: 'MarkdownV2' })` → return
  - File size: `if ((msg.voice?.file_size ?? 0) > MAX_FILE_SIZE_BYTES)` → similar message → return
- Send typing action: `await bot.sendChatAction(chatId, 'typing')` — before download and API call
- Download: `const audioBuffer = await downloadTelegramFile(bot, msg.voice!.file_id)` — catch separately and send download error message if it throws
- Read legacy chain context: `const botState = await getState(redis, chatId)` (fail-open same as naturalLanguage.ts)
- Call: `const data = await apiClient.sendAudio({ audioBuffer, filename: 'voice.ogg', mimeType: 'audio/ogg', chatId, legacyChainContext: botState?.chainContext })`
- Format response: same switch(data.intent) as `handleNaturalLanguage` — extract the formatting logic identically
- Error handling: catch `ApiError` — check `err.code` for `EMPTY_TRANSCRIPTION`, `TRANSCRIPTION_FAILED`, and generic fallback. All other errors fall through to the outer catch which sends the generic error message.
- Import `MAX_FILE_SIZE_BYTES` from `../handlers/fileUpload.js` (already exported there — do not duplicate the constant)

**Step 6 — Wire voice handler in `bot.ts`**

No new tests needed (existing `bot.test.ts` covers wiring patterns). Verify the test in `bot.test.ts` confirms `bot.on('voice', ...)` is registered (add a test case if not present).

Modification:
- Import: `import { handleVoice } from './handlers/voice.js';`
- After `bot.on('document', ...)` block, add:
  ```typescript
  bot.on('voice', async (msg) => {
    try {
      await handleVoice(msg, bot, apiClient, redis, config);
    } catch (err) {
      logger.error({ err, chatId: msg.chat.id }, 'Unhandled voice handler error');
    }
  });
  ```

**Step 7 — Update `api-spec.yaml`**

Add `POST /conversation/audio` endpoint. Model it after the existing `POST /conversation/message` entry (found at line 4662). Include:
- `requestBody` as `multipart/form-data` with `audio` (binary, required), `chainSlug` (string, optional), `chainName` (string, optional)
- `responses`: 200 (ConversationMessageData envelope), 400 (VALIDATION_ERROR), 413 (PAYLOAD_TOO_LARGE), 422 (EMPTY_TRANSCRIPTION), 422 (TRANSCRIPTION_FAILED), 429 (ACTOR_RATE_LIMIT_EXCEEDED)
- Tags: `['Conversation']`, `operationId: 'conversationAudio'`

---

### Testing Strategy

**Test files to create:**

1. `packages/api/src/__tests__/f075.whisper.unit.test.ts`
   - Tests `callWhisperTranscription` and `isWhisperHallucination`
   - Mock pattern: `vi.hoisted` + `vi.mock('openai', ...)` with `client.audio.transcriptions.create` mock — same as `f034.openaiClient.test.ts` but targeting `audio.transcriptions` instead of `chat.completions`
   - Also mock `../embeddings/embeddingClient.js` (imported by openaiClient but irrelevant)

2. `packages/api/src/__tests__/f075.audio.route.test.ts`
   - Tests `POST /conversation/audio` via `buildApp` + `app.inject()`
   - Mock `callWhisperTranscription` and `isWhisperHallucination` from `openaiClient.js`
   - Mock `runEstimationCascade` from `engineRouter.js` (same as f070.conversation.route.test.ts)
   - Mock Kysely, Prisma, Redis (copy the vi.hoisted stubs from f070.conversation.route.test.ts verbatim)
   - Multipart body in inject: use `Buffer` + `Content-Type: multipart/form-data; boundary=...` constructed manually, or use the `form-data` npm package if already available
   - Key: test that the fire-and-forget log does NOT fire when Whisper fails (capturedData remains null)

3. `packages/bot/src/__tests__/f075.voice.unit.test.ts`
   - Tests `handleVoice`
   - Mock `downloadTelegramFile` from `../handlers/fileUpload.js`
   - Mock `getState` from `../lib/conversationState.js`
   - Inject mock `ApiClient` with `sendAudio: vi.fn()` — follow the `makeApiClient` factory pattern from `f070.naturalLanguage.unit.test.ts`
   - Mock `bot.sendChatAction`, `bot.sendMessage`, `bot.getFileLink` (the last one is called internally by `downloadTelegramFile`)

**Key mocking decisions:**

- `callWhisperTranscription` is mocked in the route test — the OpenAI SDK is NOT called during route tests (same approach as mocking `callChatCompletion` in f070)
- `downloadTelegramFile` is mocked in the bot handler test — no real HTTP
- No integration tests are added (no DB or Whisper API calls in test suite)
- `isWhisperHallucination` must be mockable independently from `callWhisperTranscription` in the route test

---

### Key Patterns

**Multipart reading in Fastify route (reference: `packages/api/src/routes/ingest/image.ts`):**
Use `request.parts()` async iterator to collect both the file part and text fields in a single pass. Do NOT use `request.file()` which only yields the first file. Buffer the file part with `await part.toBuffer()` (available on `MultipartFile` from `@fastify/multipart`).

**OpenAI Whisper API call:**
The Whisper API is at `client.audio.transcriptions.create(...)` (not `client.chat.completions.create`). The `file` parameter must be a `File` or `Blob` — pass `new File([audioBuffer], 'audio.ogg', { type: mimeType })`. The response is `{ text: string }`, not `{ choices: [...] }`.

**Fire-and-forget query log (reference: `packages/api/src/routes/conversation.ts` lines 100-103, 129-233):**
Register the `reply.raw.once('finish', ...)` listener BEFORE the Whisper call and BEFORE `processMessage`. The `capturedData` variable is set after `processMessage` resolves. If Whisper fails and the handler returns a 422 early, `capturedData` remains null and the log listener is a no-op. The transcribed text (not the original audio filename) is passed as `queryText` to `writeQueryLog`.

**Error throw pattern (reference: existing error codes in `errorHandler.ts`):**
Throw domain errors as: `const err = Object.assign(new Error('message'), { code: 'EMPTY_TRANSCRIPTION' }); throw err;`. The `mapError` function switches on `asAny['code']`. Do not create new Error subclasses — use the same inline pattern as the existing codebase.

**Bot FormData multipart POST (reference: `packages/bot/src/apiClient.ts` `postFormData` helper):**
Do NOT pass `Content-Type` in the headers — fetch derives it automatically with the correct multipart boundary from the `FormData` body. Use `VOICE_TIMEOUT_MS` (30s), not `UPLOAD_TIMEOUT_MS` (90s). Unlike `postFormData` which uses `UPLOAD_TIMEOUT_MS`, `sendAudio` must manage its own abort controller with 30s.

**Bot handler error specificity:**
In `handleVoice`, catch `ApiError` first (before generic `Error`) and check `err.code` to route to the right user-facing message. The outer catch handles all other errors with a generic message. Never re-throw from the voice handler — bot.ts has an additional catch but it only logs; the user would get no response.

**Typing chat action timing:**
Send `bot.sendChatAction(chatId, 'typing')` after the bot-side guards pass but BEFORE the file download and API call. Telegram typing indicators auto-expire after ~5 seconds, but for a 30s max wait, a single call is sufficient (the typing indicator covers the most important part: user feedback that something is happening).

**`msg.voice` null safety:**
`msg.voice` is typed as optional in `node-telegram-bot-api`. The handler is only called from `bot.on('voice', ...)` so `msg.voice` will always be present, but use a guard: `if (!msg.voice) return;` at the top before any access to `msg.voice.duration`, `msg.voice.file_size`, `msg.voice.file_id`.

---

## Acceptance Criteria

- [ ] AC1: Bot detects Telegram voice messages (`msg.voice`) and processes them
- [ ] AC2: Bot downloads OGG audio from Telegram CDN via `downloadTelegramFile`
- [ ] AC3: Bot loads BotState from Redis (chainSlug/chainName context) and sends audio + context to `POST /conversation/audio` with `X-Actor-Id: telegram:<chatId>` header — same actor propagation as text messages
- [ ] AC4: API endpoint transcribes audio via OpenAI Whisper (`whisper-1`, `language: 'es'`, `temperature: 0`)
- [ ] AC5: Transcribed text is piped to `processMessage()` — same ConversationCore pipeline as text
- [ ] AC6: Response formatted identically to text messages (estimation, comparison, context_set)
- [ ] AC7: Duration guard: voice notes >120s rejected with user-friendly message (bot-side)
- [ ] AC8: File size guard: audio >10MB rejected (bot-side guard + `@fastify/multipart` 413)
- [ ] AC9: Empty transcription → API returns 422 EMPTY_TRANSCRIPTION → bot shows helpful message
- [ ] AC10: Whisper hallucination filter — known hallucination strings treated as empty transcription
- [ ] AC11: Whisper failure retried once, then API returns 502 TRANSCRIPTION_FAILED → bot shows error
- [ ] AC12: Query logged with transcribed text. Whisper latency logged via app logger (not query_logs table)
- [ ] AC13: Rate limiting shared with existing 'queries' bucket (50/day per actor, code `ACTOR_RATE_LIMIT_EXCEEDED`)
- [ ] AC14: Bot sends `typing` chat action while transcription and processing run
- [ ] AC15: Bot uses `VOICE_TIMEOUT_MS = 30_000` for `/conversation/audio` calls (not default 10s)
- [ ] AC16: Unit tests for voice handler, transcription service, and API endpoint
- [ ] AC17: All existing tests pass (no regressions)
- [ ] AC18: Build succeeds
- [ ] AC19: Specs updated (`api-spec.yaml`)

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Unit tests written and passing
- [ ] E2E tests updated (if applicable)
- [ ] Code follows project standards
- [ ] No linting errors
- [ ] Build succeeds
- [ ] Specs reflect final implementation

---

## Workflow Checklist

- [ ] Step 0: `spec-creator` executed, specs updated
- [ ] Step 1: Branch created, ticket generated, tracker updated
- [ ] Step 2: `backend-planner` executed, plan approved
- [ ] Step 3: `backend-developer` executed with TDD
- [ ] Step 4: `production-code-validator` executed, quality gates pass
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 5: `qa-engineer` executed (Standard/Complex)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-04 | Branch created | feature/F075-audio-input from develop |
| 2026-04-04 | Ticket created | Spec written with full edge case analysis |
| 2026-04-04 | Spec reviewed | Gemini+Codex: 2 CRITICAL + 6 IMPORTANT + 2 SUGGESTION. All addressed: timeout, error envelopes, typing action, hallucination filter, context injection, logging, error codes, actor propagation |
| 2026-04-04 | Plan reviewed | Gemini+Codex: 2 CRITICAL + 4 IMPORTANT + 4 SUGGESTION. All addressed: rate limit mapping, duration API-side validation, OPENAI_API_KEY guard, auth clarification, hallucination list pinned, sendAudio approach, timeout UX, punctuation stripping |
| 2026-04-04 | Implementation | 7 TDD steps completed. 41 new tests (18 whisper + 12 route + 11 voice handler). Commit 824f85a |
| 2026-04-04 | Quality gates | API: 2541 (145 files), Bot: 1114 (52 files), Shared: 413, Landing: 659. All pass. Lint clean. Build OK. |
| 2026-04-04 | Production validator | 1 CRITICAL (OpenAILogger missing error method), 1 HIGH (negative duration), 2 MEDIUM (redundant check, spec min). All fixed in b995f84 |

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

*Ticket created: 2026-04-04*
