# BUG-API-AUDIO-4XX-001: Fix POST /conversation/audio returning 500 for malformed multipart requests

**Feature:** BUG-API-AUDIO-4XX-001 | **Type:** Backend-Bugfix | **Priority:** Medium
**Status:** In Progress | **Branch:** bugfix/BUG-API-AUDIO-4XX-001
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-04-22 | **Dependencies:** None (builds on top of F091 voice endpoint scaffolding; no feature-level blockers)

---

## Spec

### Description

`POST /conversation/audio` is the Whisper STT endpoint added in F091. A 650-query QA smoke battery run on 2026-04-22 (evidence: `/tmp/qa-dev-2026-04-22.txt:388-390`) surfaced two code defects and one obsolete smoke assertion:

| # | Battery case | curl sends | Current | Expected | Nature |
|---|---|---|---|---|---|
| 357 | `POST /conv/audio no body` | no body, no Content-Type | 500 | **415** (Content-Type absent → unsupported media type) | Code bug |
| 358 | `POST /conv/audio wrong content-type` | `Content-Type: text/plain`, body `"hello"` | 500 | **415** (non-multipart Content-Type) | Code bug |
| 359 | `POST /conv/audio missing api key` | `Content-Type: multipart/form-data` (no boundary), no body, no `X-API-Key` | 500 | **400** (malformed multipart) or **415** (depending on parser order) | Code bug + stale smoke assertion |

Note on #357 classification (corrected vs PR-planning review): the battery's curl invocation at `packages/api/scripts/qa-exhaustive.sh:433` sends NO Content-Type header and NO body, so the "no body" case is functionally an "absent Content-Type" case → **415**, not 400. The name "no body" is historical. See EC-2 and AC1.

**Critical scope clarification — `/conversation/audio` allows anonymous callers by design.** F091 wires this endpoint into the `voice` rate-limit bucket at 30 req/day for anonymous actors (`packages/api/src/plugins/actorRateLimit.ts:39,49`) because the EAA voice accessibility requirement applies equally to `/conversation/message` and `/conversation/audio`. `packages/api/src/plugins/auth.ts:16` comment: *"If no key → anonymous (no error, no apiKeyContext)"*. `packages/api/src/plugins/actorResolver.ts:78-79` auto-creates an anonymous actor when no `X-Actor-Id` is present.

Therefore the battery smoke #359 expectation (`missing api key → 401`) is **exactly the same pattern as H3 in PR #195** — a stale smoke assertion contradicting ADR-001's anonymous-access design. This ticket corrects the smoke assertion, NOT the server behaviour. Introducing an API-key requirement here would be a breaking contract change to F091 and is out of scope.

**What #359 currently actually hits:** the smoke command `curl -X POST "$API/conversation/audio" -H "Content-Type: multipart/form-data"` sends no body and no boundary. The auth layer lets the anonymous caller through (correct), then the multipart parser throws on missing boundary/body → the error-handler has no mapping for the multipart parse error → falls through to the default 500. Fixing #357 and #358 (code bugs) will also fix #359 — the response will become 400 (or 415, depending on which gate catches it first), which is the correct behaviour. The smoke expectation is then updated from `401` to `400|415` with an inline comment citing F091's anonymous-OK design, mirroring the H3 fix in PR #195.

**Why this matters:**
1. **Monitoring pollution.** Bare 500s from client misuse inflate the server-error rate and page oncall for what are client-side mistakes.
2. **Unhelpful client feedback.** The browser voice UI (`/hablar`) and the Telegram bot adapter receive a 500 with no structured error code. Typed 4xx responses allow each adapter to display a meaningful message ("Please retry your recording", "Unsupported audio format", etc.).
3. **Clean battery signal.** With the code fix + smoke correction in place, the QA battery smokes #357–359 all produce deterministic pass signals, unblocking the rest of Sprint #2.

**Root cause summary (from code investigation — do not implement, inform planner):**

- `packages/api/src/errors/errorHandler.ts` currently maps `VALIDATION_ERROR` → 400 (line ~150), `FST_ERR_CTP_EMPTY_JSON_BODY` → 400 (line ~92), and `FST_REQ_FILE_TOO_LARGE` → 413 (line ~331). It does NOT map `FST_ERR_CTP_INVALID_MEDIA_TYPE`, `FST_ERR_CTP_EMPTY_TYPE`, or other `@fastify/multipart` parse-failure codes. These fall through to the default 500 branch.
- The `/conversation/audio` handler (`packages/api/src/routes/conversation.ts:277–~400`) begins with budget check → multipart iteration. The multipart iteration happens inside `for await (const part of request.parts()) { ... }`. Parse failures (missing boundary, wrong Content-Type) throw inside that loop and propagate out as fastify-framework errors without a mapped status.

**What this bugfix must deliver:**

1. **415 UNSUPPORTED_MEDIA_TYPE** — returned when the request `Content-Type` is absent, or is a non-multipart type (`application/json`, `text/plain`, `application/octet-stream`, etc.). The caller did not attempt multipart at all.
2. **400 VALIDATION_ERROR** — returned when the caller intended multipart but the request is malformed: (a) `Content-Type: multipart/form-data` with no boundary parameter; (b) valid multipart with zero parts; (c) valid multipart with parts present but no `audio` file part.
3. `POST /conversation/audio` **continues to accept anonymous callers** (missing `X-API-Key` → actor auto-resolved by `actorResolver.ts`). No change to auth behaviour.
4. **401 behaviour preserved (not modified by this ticket)** — an INVALID (present but not registered) `X-API-Key` still returns `401 UNAUTHORIZED` via the existing global auth plugin (`packages/api/src/plugins/auth.ts:95-132` → `packages/api/src/errors/errorHandler.ts:362-374`). This ticket does not change that path; it is mentioned here so the planner does not accidentally regress it. The project convention is to NOT document 401 in OpenAPI responses for endpoints that allow anonymous callers (consistent with other endpoints like `/estimate` and `/conversation/message` in `api-spec.yaml`); this ticket follows that convention.
5. All existing 400 guards (unsupported audio MIME, missing/invalid `duration`, duration out of range, F091 `VOICE_BUDGET_EXHAUSTED` 503) are preserved with no regression.
6. The QA battery smoke at `packages/api/scripts/qa-exhaustive.sh:435` (`POST /conv/audio missing api key`) has its expected-status regex changed from `401` to `400|415` with an inline comment citing F091's anonymous-OK design and referencing PR #195 for the analogous H3 fix on `/conversation/message`.

**ADR-001 note:** `/conversation/message` allows anonymous callers (EAA accessibility). `/conversation/audio` ALSO allows anonymous callers — the same EAA reasoning extends to voice input. ADR-001 itself covers the text flow, but F091 applies the same design to audio (anonymous `voice: 30/day` rate-limit bucket). This ticket does NOT modify that policy; it only fixes 4xx shaping and a stale smoke assertion.

---

### API Changes (if applicable)

**Endpoint:** `POST /conversation/audio` — modify error response shapes, no behaviour change for the happy path.

**Changes to `docs/specs/api-spec.yaml`:**

0. **Pre-existing documentation bug — WAV in endpoint summary.** Line 5538 currently describes `/conversation/audio` as accepting "OGG, MP3, MP4, WAV, WebM", but the code deliberately omits `audio/wav` (F091 note at `packages/api/src/routes/conversation.ts:268`: *"audio/wav omitted: browsers never produce WAV and we have no RIFF duration parser"*). Tests at `packages/api/src/__tests__/f091.audio.route.test.ts:431-451` explicitly assert that `audio/wav` is rejected. Fix in this ticket (low cost + coherent with the 415 additions): remove "WAV" from the endpoint description so docs match code + tests.

1. **Extend the existing `400` response description** to enumerate the malformed-multipart sub-cases: (a) `multipart/form-data` without boundary parameter; (b) valid multipart with zero parts; (c) valid multipart with no `audio` part. Keep the existing `missingAudio`, `badMimeType`, `badDuration` examples.
2. **Add a `415` response** to `/conversation/audio` using the `ErrorResponse` schema:
   ```yaml
   '415':
     description: |
       Unsupported Media Type. The request Content-Type is not multipart/form-data.
       Returned when Content-Type is absent, or set to a non-multipart type
       (e.g. application/json, text/plain, application/octet-stream).
       Anonymous callers are accepted on this endpoint per F091 design; the 415
       is purely about the body encoding, not about authentication.
     content:
       application/json:
         schema:
           $ref: '#/components/schemas/ErrorResponse'
         example:
           success: false
           error:
             message: "Content-Type must be multipart/form-data"
             code: "UNSUPPORTED_MEDIA_TYPE"
   ```
3. **Do NOT add `security: - ApiKeyAuth: []`.** `/conversation/audio` is anonymous-OK per F091. Adding a security block would contradict the implementation and break the browser voice UI (which sends only `X-Actor-Id`).
4. **Do NOT add a `401` response block.** Rationale: this ticket does not change auth behaviour — it only fixes 400/415 shapes. An invalid `X-API-Key` on this endpoint CAN still return 401 via the pre-existing global auth plugin path (`auth.ts:95-132` → `errorHandler.ts:362-374`), but per project convention other anonymous-OK endpoints (`/conversation/message`, `/estimate`) omit 401 from their OpenAPI response blocks as well. Keeping the same convention here avoids inflating the spec surface for a path unchanged by this ticket.

**Error code `UNSUPPORTED_MEDIA_TYPE`:** The string value is used in narrative descriptions (e.g., `POST /ingest` comments) but is not in any $ref schema. `ErrorResponse.error.code` is a free-form `string`, so no schema change is needed. If a shared `ErrorCode` enum/union exists in `packages/shared/src/schemas/`, add `UNSUPPORTED_MEDIA_TYPE` to it. (Planner should check `packages/shared/src/schemas/errorCodes.ts` — investigation at this commit shows the file does not exist, but spec may have drifted.)

**Tooling change:**

- `packages/api/scripts/qa-exhaustive.sh` smoke #359 expected-status regex: `"401"` → `"400|415"` with inline comment: *"F091 allows anonymous callers on /conversation/audio (same EAA reasoning as ADR-001 for /conversation/message). The smoke intentionally sends no body + wrong Content-Type, so it will hit one of the 4xx paths fixed in BUG-API-AUDIO-4XX-001 (#357/#358)."*

**No new endpoints. No changes to 200, 413, 422, 429, 502, or 503 response shapes. No auth policy changes.**

---

### Data Model Changes (if applicable)

None. No database schema changes. No Prisma migration required.

If `packages/shared/src/schemas/` contains a TypeScript `ErrorCode` enum or union type at implementation time, the planner should check whether `UNSUPPORTED_MEDIA_TYPE` is present and add it if missing. Additive change only.

---

### UI Changes (if applicable)

None. Backend-only bugfix. The voice UI (`/hablar`, web assistant) and the Telegram bot adapter handle 4xx responses generically already. No `ui-components.md` changes.

---

### Edge Cases & Error Handling

**EC-1: Anonymous caller with valid multipart body — happy path preserved**

Given: A request has NO `X-API-Key` and NO `X-Actor-Id`, but a valid `multipart/form-data` body with an `audio` file part and a `duration` field.
When: The request reaches `/conversation/audio`.
Then: The actor resolver auto-creates an anonymous actor (per F091), the handler processes the audio, and the response is `200` (same as today). **No regression.**

**EC-2: Content-Type absent (no header at all) → 415**

Given: A request has no `Content-Type` header and any (or no) `X-API-Key`.
When: The server attempts to parse the body.
Then: `415 UNSUPPORTED_MEDIA_TYPE` with message `"Content-Type must be multipart/form-data"`. An absent Content-Type is equivalent to an unsupported one for a multipart endpoint.

**EC-3: `Content-Type: application/json` or any non-multipart type → 415**

Given: `Content-Type: application/json` (or `text/plain`, `application/octet-stream`, etc.) with any body content.
When: The server inspects the header before multipart parsing.
Then: `415 UNSUPPORTED_MEDIA_TYPE` with message `"Content-Type must be multipart/form-data"`.

**EC-4: `multipart/form-data` without boundary parameter → 400**

Given: `Content-Type: multipart/form-data` (no `; boundary=...`) and any body.
When: The multipart parser attempts to process.
Then: `400 VALIDATION_ERROR` with a message indicating malformed multipart (exact text at planner discretion — `"Missing audio file part in multipart request"` is acceptable and matches the existing example; alternatively `"Malformed multipart request: missing boundary"` is clearer). This is treated as a malformed multipart attempt — the caller intended multipart but constructed it wrong. NOT 415.

Rationale: The 415 case is for "did not attempt multipart at all". A missing boundary is a different failure mode.

**EC-5: `multipart/form-data` with valid boundary, zero parts → 400**

Given: A well-formed `Content-Type: multipart/form-data; boundary=...` but zero body parts.
When: The iterator finds no parts.
Then: `400 VALIDATION_ERROR` with message `"Missing audio file part in multipart request"`. Same code path as the existing `missingAudio` example.

**EC-6: `multipart/form-data` with valid boundary and non-audio parts only → 400**

Given: A valid multipart request with parts present, but none named `audio`.
When: The handler iterates parts and finds no `audio` field.
Then: `400 VALIDATION_ERROR` with message `"Missing audio file part in multipart request"`. Same shape as EC-5 from the response perspective.

**EC-7: Existing 400 guards — no regression**

The following existing 400 paths MUST continue to work unchanged:
- Unsupported audio MIME type (e.g., `audio/wav`): `400 VALIDATION_ERROR` `"Unsupported audio MIME type: audio/wav. Allowed: audio/ogg, audio/mpeg, audio/mp4, audio/webm"`.
- `duration` field missing: `400 VALIDATION_ERROR` `"Missing required field: duration"`.
- `duration` not a number: `400 VALIDATION_ERROR` `"Invalid duration: must be a number"`.
- `duration` outside [0, 120]: `400 VALIDATION_ERROR` `"Audio duration must be between 0 and 120 seconds"`.

**EC-8: File size limit — out of scope**

Body present but audio file exceeds the `@fastify/multipart` size limit → already handled as `413 PAYLOAD_TOO_LARGE` (`errorHandler.ts:~331`, `FST_REQ_FILE_TOO_LARGE`). No change.

**EC-9: Budget exhaustion — out of scope**

F091's `VOICE_BUDGET_EXHAUSTED` (`503`) gating logic runs before multipart parsing. Its order and shape must not be disturbed by this fix.

**EC-10: Smoke acceptance after the fix**

After this ticket lands, the three battery smokes produce deterministic passes. The smoke script expects `400|415` for the first three; the assertion is a 4xx family check, not a specific-code check.

```
357. POST /conv/audio no body            → http=415  code=UNSUPPORTED_MEDIA_TYPE    PASS
     (curl sent no Content-Type, no body → EC-2 applies)
358. POST /conv/audio wrong content-type → http=415  code=UNSUPPORTED_MEDIA_TYPE    PASS
     (curl sent Content-Type: text/plain → EC-3 applies)
359. POST /conv/audio missing api key    → http=400  code=VALIDATION_ERROR          PASS
     (curl sent Content-Type: multipart/form-data without boundary → EC-4 applies;
      could also resolve to 415 depending on parser implementation; smoke's expected
      `400|415` regex covers both)
```

Smoke #359 is NOT 401 because `/conversation/audio` allows anonymous callers by F091 design (EC-1, and the same reasoning behind PR #195 H3 for `/conversation/message`).

**EC-11: Invalid (present but unregistered) API key — preserved existing behaviour**

Given: A request has `X-API-Key: fxp_not_a_real_key_12345` and an otherwise valid multipart body.
When: The global auth plugin validates the key.
Then: `401 UNAUTHORIZED` with message `"Invalid or expired API key"` — **unchanged from pre-ticket behaviour**. This is preserved for regression. Note: this is distinct from EC-1 (no key at all → anonymous). Only invalid non-empty keys hit 401.

---

## Implementation Plan

### Context: How fastify emits errors for wrong/missing Content-Type

Before the implementation order, it is essential to understand which error codes actually reach `mapError()` for the three failing cases:

**Case A — Content-Type absent, body absent (smoke #357 / AC1)**
`handle-request.js:38-48`: when `content-type` is `undefined` AND the body is empty (`content-length` absent or `"0"`, no `transfer-encoding`), fastify skips body parsing and calls the handler directly. `request.isMultipart()` returns `false`. Calling `request.parts()` inside the handler throws `FST_INVALID_MULTIPART_CONTENT_TYPE` (code `FST_INVALID_MULTIPART_CONTENT_TYPE`, HTTP 406) from `@fastify/multipart/index.js:212`.

**Case B — Content-Type is a non-multipart string (`text/plain`, `application/json`) (smoke #358 / AC2, AC3)**
`handle-request.js:54-58`: fastify parses the Content-Type header; if no registered parser matches the type, it calls `reply.status(415).send(new FST_ERR_CTP_INVALID_MEDIA_TYPE())`. This bypasses the route handler entirely — it is a framework-level rejection. The error has `code: "FST_ERR_CTP_INVALID_MEDIA_TYPE"` and `statusCode: 415`. **This does reach `setErrorHandler`** because `reply.send(error)` with a non-sent reply routes through the error handler chain.

**Case C — `Content-Type: multipart/form-data` without boundary, empty body (smoke #359 / AC4)**
The multipart plugin registers a parser for `multipart/form-data` (`index.js:184`). Fastify calls that parser on the incoming body. Busboy receives a multipart stream without a boundary; it either throws or emits an error that propagates as an unhandled parse error. `request.isMultipart()` returns `true` (the content-type parser ran) but the body iteration will throw. In practice the error that escapes to `setErrorHandler` is a Busboy/parse error (no code, or code `FST_INVALID_MULTIPART_CONTENT_TYPE` if the multipart plugin catches and re-wraps it — to be confirmed empirically via the RED test). The handler may or may not be entered before the error is thrown.

**Net result for the plan:** two distinct error-handler entries are needed:
1. `FST_ERR_CTP_INVALID_MEDIA_TYPE` (code string) → **415 UNSUPPORTED_MEDIA_TYPE** — covers Case B.
2. `FST_INVALID_MULTIPART_CONTENT_TYPE` (code string) → **415 UNSUPPORTED_MEDIA_TYPE** — covers Case A (absent CT + empty body path where `request.parts()` throws before any handler logic).
3. For Case C (multipart with no boundary), the RED test will reveal the actual error code/shape. If Busboy throws an uncodified error, the handler must explicitly guard against it **before** calling `request.parts()` by calling `request.isMultipart()` and checking that `request.headers['content-type']` contains `boundary=` — throwing a `VALIDATION_ERROR` directly if not. This explicit guard is simpler than mapping an unpredictable Busboy error.

---

### Existing Code to Reuse

- `packages/api/src/errors/errorHandler.ts` — `mapError()` pure function and `if-chain` pattern. New mappings follow the exact same structure as the `FST_ERR_CTP_EMPTY_JSON_BODY` block (lines 91-103) and the `FST_REQ_FILE_TOO_LARGE` block (lines 335-346).
- `packages/api/src/routes/conversation.ts` — the `for await (const part of request.parts()) { ... }` loop (lines 308-325) and the existing VALIDATION_ERROR guards (lines 328-364). The AC4 fix is an explicit guard added **before** the `request.parts()` call.
- `packages/api/src/__tests__/f091.audio.route.test.ts` — the full mock scaffold (`vi.mock`, `buildApp()`, `app.inject`). New tests go in this same file, extending the existing `describe` block.
- `packages/api/src/__tests__/helpers/multipart.ts` — `buildMultipartBody()` and `MULTIPART_BOUNDARY`. AC5/AC6 tests use `buildMultipartBody({ audioPart: null, duration: '10' })` to produce a zero-audio-part body. For AC4, the test sends `Content-Type: multipart/form-data` (no boundary) with an empty payload — no multipart helper needed.

### Shared Schemas Check

`packages/shared/src/schemas/errorCodes.ts` — **does not exist** (confirmed: the `schemas/` directory contains no `errorCodes.ts`). `ErrorResponse.error.code` is a free-form `string` in the Zod schema. No change to `packages/shared/` is needed for this ticket.

---

### Files to Create

None. All changes are edits to existing files.

---

### Files to Modify

| File | Nature of change |
|------|-----------------|
| `packages/api/src/errors/errorHandler.ts` | Add two new `if` branches in `mapError()`: (1) `FST_ERR_CTP_INVALID_MEDIA_TYPE` → 415; (2) `FST_INVALID_MULTIPART_CONTENT_TYPE` → 415. Position: immediately before the `FST_REQ_FILE_TOO_LARGE` block (line 335) or immediately after the `FST_ERR_VALIDATION` block (line 116), whichever is more natural for precedence. Both new branches must come before the default 500 fall-through. |
| `packages/api/src/routes/conversation.ts` | Add one explicit guard before `request.parts()`: check that `request.headers['content-type']` (lowercased) includes the string `boundary=`. If not, throw `Object.assign(new Error('Malformed multipart request: missing boundary'), { code: 'VALIDATION_ERROR' })`. This guard covers AC4 regardless of how Busboy behaves with a no-boundary header. |
| `packages/api/src/__tests__/f091.audio.route.test.ts` | Add a new `describe` block (or nested `describe` under the existing one): `POST /conversation/audio — BUG-API-AUDIO-4XX-001 error shapes`. Contains 8 new test cases (RED → GREEN for AC1–AC6, AC7 regression, AC10 regression). |
| `docs/specs/api-spec.yaml` | (1) Line 5538: remove "WAV" from endpoint description. (2) After the `'400'` response block (after line 5687): add a new `'415'` response block. (3) Extend the `'400'` description text to enumerate the three malformed-multipart sub-cases. |
| `packages/api/scripts/qa-exhaustive.sh` | Line 443: change expected-status from `"401"` to `"400|415"` and add inline comment. |

---

### Implementation Order (TDD)

---

#### Step 1 — RED: Write failing tests for 415 paths (AC1, AC2, AC3)

**File:** `packages/api/src/__tests__/f091.audio.route.test.ts`

Add three tests inside a new `describe('BUG-API-AUDIO-4XX-001 — 415 and 400 error shapes', ...)` block at the bottom of the file. Reuse the same `beforeEach` setup as the existing describe (call `setupAuthMocks()`, `setupKyselyMocks()`, `setupRedisMocks()`, `mockCheckBudgetExhausted.mockResolvedValue(false)`).

**Test 1 — AC1: absent Content-Type returns 415**

```
it('returns 415 UNSUPPORTED_MEDIA_TYPE when Content-Type header is absent', async () => {
  const app = await buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/conversation/audio',
    headers: {}, // no Content-Type, no body
    payload: undefined,
  });
  expect(response.statusCode).toBe(415);
  const body = response.json();
  expect(body.success).toBe(false);
  expect(body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  expect(body.error.message).toBe('Content-Type must be multipart/form-data');
  await app.close();
});
```

**Test 2 — AC2: `Content-Type: application/json` returns 415**

```
it('returns 415 UNSUPPORTED_MEDIA_TYPE when Content-Type is application/json', async () => {
  const app = await buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/conversation/audio',
    headers: { 'Content-Type': 'application/json' },
    payload: JSON.stringify({ text: 'hello' }),
  });
  expect(response.statusCode).toBe(415);
  const body = response.json();
  expect(body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  await app.close();
});
```

**Test 3 — AC3: `Content-Type: text/plain` returns 415**

```
it('returns 415 UNSUPPORTED_MEDIA_TYPE when Content-Type is text/plain', async () => {
  const app = await buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/conversation/audio',
    headers: { 'Content-Type': 'text/plain' },
    payload: 'hello',
  });
  expect(response.statusCode).toBe(415);
  const body = response.json();
  expect(body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  await app.close();
});
```

**Failing behaviour before GREEN:** All three return `500 INTERNAL_ERROR` because `mapError()` has no branch for `FST_ERR_CTP_INVALID_MEDIA_TYPE` or `FST_INVALID_MULTIPART_CONTENT_TYPE`.

---

#### Step 2 — GREEN: Add 415 mappings to errorHandler (AC1, AC2, AC3)

**File:** `packages/api/src/errors/errorHandler.ts`

Add two `if` branches immediately after the `FST_ERR_VALIDATION` block (after line 116, before the `DB_UNAVAILABLE` block). This placement is correct because: (a) the 4xx group should come before 5xx, (b) no existing branch overlaps with these codes.

**Important context (code-review plan finding resolved):** `mapError()` is called from the ONE global `setErrorHandler` (`app.ts:120,137`). These `FST_*` codes fire on EVERY route (not just `/conversation/audio`). A JSON endpoint like `/estimate` receiving `Content-Type: text/plain` also emits `FST_ERR_CTP_INVALID_MEDIA_TYPE`. Therefore the new branches MUST use a **generic, non-route-specific message** — fastify's default `error.message` is already informative (`"Unsupported Media Type: text/plain"`). The audio-specific message `"Content-Type must be multipart/form-data"` is set by the audio handler's explicit guard (Step 4, `UNSUPPORTED_MEDIA_TYPE` branch), NOT by these global framework-error branches.

**Branch 1 — `FST_ERR_CTP_INVALID_MEDIA_TYPE` (fastify core, 415)**

Position: after the `FST_ERR_VALIDATION` block (line 116).

Describe the change: add an `if` that checks `asAny['code'] === 'FST_ERR_CTP_INVALID_MEDIA_TYPE'` and returns `{ statusCode: 415, body: { success: false, error: { message: error.message, code: 'UNSUPPORTED_MEDIA_TYPE' } } }`. **Use `error.message`, NOT a hardcoded string** — fastify emits `"Unsupported Media Type: <actual-ct>"` which is informative across all routes.

Note on `statusCode` precedence: `FST_ERR_CTP_INVALID_MEDIA_TYPE` already carries `statusCode: 415` on the error object. The `mapError()` function must NOT fall through to the generic `statusCode === 404` check; an explicit `code` check is correct and consistent with the rest of the if-chain.

**Branch 2 — `FST_INVALID_MULTIPART_CONTENT_TYPE` (`@fastify/multipart`, 406)**

Position: immediately after Branch 1.

Describe the change: add an `if` that checks `asAny['code'] === 'FST_INVALID_MULTIPART_CONTENT_TYPE'` and returns `{ statusCode: 415, body: { success: false, error: { message: error.message, code: 'UNSUPPORTED_MEDIA_TYPE' } } }`. Same rule: use `error.message` (the multipart plugin emits `"the request is not multipart"` or similar), NOT a route-specific hardcoded string.

Rationale for remapping 406→415: the multipart plugin uses 406 internally, but from the API contract perspective the correct semantic is 415 (the client sent an unsupported media type). This remapping is intentional and documented via comment.

Add a short comment block above both branches:
```
// FST_ERR_CTP_INVALID_MEDIA_TYPE — fastify core: no registered Content-Type parser
// for the supplied type. Maps to 415 UNSUPPORTED_MEDIA_TYPE (BUG-API-AUDIO-4XX-001).
// Uses error.message (fastify's default) — this branch fires on any route, not just
// /conversation/audio, so a hardcoded multipart message would be misleading elsewhere.
// FST_INVALID_MULTIPART_CONTENT_TYPE — @fastify/multipart: request.parts() called
// when Content-Type is absent or not multipart. Remapped 406→415 intentionally.
```

**Verification for Step 2:** Run `npm test --workspace=@foodxplorer/api` — the three AC1/AC2/AC3 tests turn GREEN. The existing tests remain unchanged.

---

#### Step 3 — RED: Write failing test for 400 no-boundary path (AC4)

**File:** `packages/api/src/__tests__/f091.audio.route.test.ts`

**Test 4 — AC4: multipart/form-data without boundary returns 400**

```
it('returns 400 VALIDATION_ERROR when Content-Type is multipart/form-data without boundary param', async () => {
  const app = await buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/conversation/audio',
    headers: { 'Content-Type': 'multipart/form-data' }, // no boundary=
    payload: Buffer.alloc(0),
  });
  expect(response.statusCode).toBe(400);
  const body = response.json();
  expect(body.success).toBe(false);
  expect(body.error.code).toBe('VALIDATION_ERROR');
  expect(body.error.message).toMatch(/boundary/i);
  await app.close();
});
```

**Test 4b — AC4 variant: multipart/form-data with empty boundary returns 400**

Added in response to Codex review finding that `includes('boundary=')` is permissive:

```
it('returns 400 VALIDATION_ERROR when boundary parameter is present but empty', async () => {
  const app = await buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/conversation/audio',
    headers: { 'Content-Type': 'multipart/form-data; boundary=' }, // empty value
    payload: Buffer.alloc(0),
  });
  expect(response.statusCode).toBe(400);
  const body = response.json();
  expect(body.error.code).toBe('VALIDATION_ERROR');
  expect(body.error.message).toMatch(/boundary/i);
  await app.close();
});
```

**Failing behaviour before GREEN:** Both tests return `500 INTERNAL_ERROR` — Test 4 because Busboy throws an uncodified error; Test 4b because Busboy accepts the empty boundary and then fails deeper in parsing.

---

#### Step 4 — GREEN: Add explicit boundary guard in conversation route (AC4)

**File:** `packages/api/src/routes/conversation.ts`

Add a guard block immediately after the `Step 0` budget check (after line 299) and before `Step 1` (before line 301 / the `for await` loop). The guard inspects `request.headers['content-type']` directly:

Describe the change: Insert a new block labeled `// Step 0a: Guard — Content-Type must be multipart with a non-empty boundary`. Check:
1. If `request.headers['content-type']` is `undefined` or does not start with `multipart/form-data` → throw `Object.assign(new Error('Content-Type must be multipart/form-data'), { code: 'UNSUPPORTED_MEDIA_TYPE' })`.
2. If `request.headers['content-type']` starts with `multipart/form-data` → extract the boundary via regex `/;\s*boundary=([^;\s]+)/i`. If the match fails OR the captured group is empty → throw `Object.assign(new Error('Malformed multipart request: missing or empty boundary'), { code: 'VALIDATION_ERROR' })`. The regex explicitly requires at least one non-whitespace, non-`;` character after `boundary=`, rejecting both `multipart/form-data` (no param) and `multipart/form-data; boundary=` (empty value) — the latter is the Codex finding that `includes('boundary=')` alone would miss.

The `UNSUPPORTED_MEDIA_TYPE` code is new. Add the corresponding mapping to `mapError()` in `errorHandler.ts`:

**File:** `packages/api/src/errors/errorHandler.ts`

Add one more branch (position: right next to the `FST_ERR_CTP_INVALID_MEDIA_TYPE` and `FST_INVALID_MULTIPART_CONTENT_TYPE` branches added in Step 2):

```
// UNSUPPORTED_MEDIA_TYPE — thrown explicitly by the /conversation/audio handler
// for absent or non-multipart Content-Type headers (BUG-API-AUDIO-4XX-001).
if (asAny['code'] === 'UNSUPPORTED_MEDIA_TYPE') {
  return {
    statusCode: 415,
    body: {
      success: false,
      error: {
        message: error.message,
        code: 'UNSUPPORTED_MEDIA_TYPE',
      },
    },
  };
}
```

Note: Adding this third branch also makes the AC1 path more robust. Even if `FST_INVALID_MULTIPART_CONTENT_TYPE` is not thrown in some edge case (e.g., a future fastify version changes the error), the explicit handler guard will throw `UNSUPPORTED_MEDIA_TYPE` directly. Both branches remain necessary: the `FST_*` branches catch framework-level errors before the handler is entered (Case B — wrong content-type like `text/plain`); the handler guard catches cases where the handler is entered but the header is wrong.

**Verification for Step 4:** Run tests — AC4 turns GREEN. AC1/AC2/AC3 remain GREEN.

---

#### Step 5 — RED: Write failing tests for zero-parts and no-audio-part paths (AC5, AC6)

**File:** `packages/api/src/__tests__/f091.audio.route.test.ts`

**Test 5 — AC5: valid multipart with zero parts returns 400**

```
it('returns 400 VALIDATION_ERROR for valid multipart with zero parts (empty body)', async () => {
  // buildMultipartBody with audioPart:null and duration:null produces a body with
  // only the closing boundary — zero real parts.
  const body = buildMultipartBody({ audioPart: null, duration: null });
  const app = await buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/conversation/audio',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${MULTIPART_BOUNDARY}`,
    },
    payload: body,
  });
  expect(response.statusCode).toBe(400);
  const resBody = response.json();
  expect(resBody.error.code).toBe('VALIDATION_ERROR');
  expect(resBody.error.message).toBe('Missing audio file part in multipart request');
  await app.close();
});
```

**Test 6 — AC6: valid multipart with non-audio parts only returns 400**

```
it('returns 400 VALIDATION_ERROR for valid multipart with non-audio parts only', async () => {
  // Build a body with a duration field but no audio file part.
  const body = buildMultipartBody({ audioPart: null, duration: '10' });
  const app = await buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/conversation/audio',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${MULTIPART_BOUNDARY}`,
    },
    payload: body,
  });
  expect(response.statusCode).toBe(400);
  const resBody = response.json();
  expect(resBody.error.code).toBe('VALIDATION_ERROR');
  expect(resBody.error.message).toBe('Missing audio file part in multipart request');
  await app.close();
});
```

**Failing behaviour before GREEN for AC5/AC6:** These paths should already return 400 via the existing Step 2 guard in `conversation.ts` (lines 328-333: `if (audioBuffer === undefined || audioMimeType === undefined) throw VALIDATION_ERROR`). Run the tests first — they may already be GREEN. If they pass immediately, they serve as regression guards (no code change needed for AC5/AC6). If they fail (e.g., because `buildMultipartBody({ audioPart: null })` produces an unexpected parse error), the developer must identify the root cause and add a fix.

---

#### Step 6 — Regression tests (AC7, AC8, AC9, AC10)

**File:** `packages/api/src/__tests__/f091.audio.route.test.ts`

These tests confirm no regression. Write them as part of the same `describe` block but verify against existing behaviour:

**AC7 — Anonymous happy path (no X-API-Key, no X-Actor-Id):**

```
it('AC7: anonymous caller with no X-API-Key and no X-Actor-Id returns 200 on valid audio', async () => {
  mockCallWhisperTranscription.mockResolvedValue('paella valenciana');
  const app = await buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/conversation/audio',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${MULTIPART_BOUNDARY}`,
      'X-Forwarded-For': CLIENT_IP,
      // No X-API-Key, no X-Actor-Id
    },
    payload: buildAudioBody(10),
  });
  expect(response.statusCode).toBe(200);
  await app.close();
});
```

The existing happy-path test (line 325) uses `X-API-Key` and `X-Actor-Id`. This new test verifies truly anonymous access. `mockPrismaActorUpsert` must resolve even without a key — it already does in the existing setup because `actorResolver.ts` calls `actor.upsert` for anonymous callers. Verify that `setupAuthMocks()` does not need adjustment (the `mockPrismaApiKeyFindUnique` mock only fires when a key is present).

**AC8 — Existing 400 guards regression:**

These are already covered by the WAV test (line 431) and implicitly by the full pipeline tests. Write one additional test for the `duration out of range` case to ensure the new Step 0a guard does not accidentally intercept it:

```
it('AC8: duration > 120 returns 400 VALIDATION_ERROR (existing guard preserved)', async () => {
  const app = await buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/conversation/audio',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${MULTIPART_BOUNDARY}`,
      'X-API-Key': API_KEY_VALUE,
    },
    payload: buildAudioBody(200), // 200s > 120s limit
  });
  expect(response.statusCode).toBe(400);
  const body = response.json();
  expect(body.error.code).toBe('VALIDATION_ERROR');
  expect(body.error.message).toContain('120 seconds');
  await app.close();
});
```

**AC9 — Budget exhausted regression:**

Already covered by the existing `503 VOICE_BUDGET_EXHAUSTED` test (line 277). No new test needed. Note in the implementation: confirm the new Step 0a guard in the handler is placed **after** the Step 0 budget check (lines 294-299) so that a budget-exhausted request still returns 503 even if the content-type is wrong. The spec states budget check fires "before multipart parsing" — maintain that order. The content-type guard (Step 0a) is considered part of "before multipart parsing" but should run after budget check per the design intent.

_Revision to Step 4:_ place Step 0a immediately **after** the budget check (after line 299), not before it. Budget check first, then content-type guard.

**AC10 — Invalid API key returns 401 (regression, no code change):**

```
it('AC10: invalid (present but unregistered) X-API-Key returns 401 UNAUTHORIZED', async () => {
  // Make the DB lookup return null → UNAUTHORIZED
  mockPrismaApiKeyFindUnique.mockResolvedValue(null);
  const app = await buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/conversation/audio',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${MULTIPART_BOUNDARY}`,
      'X-API-Key': 'fxp_not_a_real_key_12345',
      'X-Forwarded-For': CLIENT_IP,
    },
    payload: buildAudioBody(10),
  });
  expect(response.statusCode).toBe(401);
  const body = response.json();
  expect(body.error.code).toBe('UNAUTHORIZED');
  expect(body.error.message).toBe('Invalid or expired API key');
  await app.close();
});
```

This test verifies `auth.ts:128-132` (DB returns null → throw UNAUTHORIZED → `errorHandler.ts:362-373` → 401). **No code change required.** This is a pure regression guard ensuring the new handler guard (Step 0a) does not accidentally run before `auth.ts` can reject the invalid key. It will not (the auth plugin runs in `onRequest`, before the handler body, and the handler guard is inside the route handler function).

---

### Non-TDD Deliverables

These must be completed after Step 6, before marking the ticket done.

---

#### Step 7 — api-spec.yaml updates (AC12)

**File:** `docs/specs/api-spec.yaml`

Three edits, all within the `/conversation/audio: post:` block (starting at line 5532):

**Edit 7a — Remove WAV from endpoint description (line 5538)**

Current text (line 5538):
```
Accepts a multipart/form-data audio file (OGG, MP3, MP4, WAV, WebM).
```
Replace with:
```
Accepts a multipart/form-data audio file (OGG, MP3, MP4, WebM).
```

**Edit 7b — Extend the `'400'` response description (lines 5655-5661)**

Current `description:` under `'400'`:
```yaml
description: |
  Validation error. Sub-cases:
  - `audio` file part is missing from the multipart body.
  - MIME type is not one of: audio/ogg, audio/mpeg, audio/mp4, audio/webm.
  - `duration` field is missing or not a number.
  - `duration` exceeds 120 seconds.
```

Replace with:
```yaml
description: |
  Validation error. Sub-cases:
  - `Content-Type: multipart/form-data` header present but missing `boundary=` parameter (malformed multipart).
  - Multipart body is valid but contains zero parts.
  - Multipart body is valid but no `audio` file part is present.
  - MIME type is not one of: audio/ogg, audio/mpeg, audio/mp4, audio/webm.
  - `duration` field is missing or not a number.
  - `duration` exceeds 120 seconds.
```

**Edit 7c — Add `'415'` response block after the `'400'` block**

Insert after the closing of the `'400'` response block (after line 5687, before the `'413'` line). The insertion adds:

```yaml
        '415':
          description: |
            Unsupported Media Type. The request Content-Type is not multipart/form-data.
            Returned when Content-Type is absent, or set to a non-multipart type
            (e.g. application/json, text/plain, application/octet-stream).
            Anonymous callers are accepted on this endpoint per F091 design; the 415
            is purely about the body encoding, not about authentication.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
              example:
                success: false
                error:
                  message: "Content-Type must be multipart/form-data"
                  code: "UNSUPPORTED_MEDIA_TYPE"
```

Do NOT add a `security:` block. Do NOT add a `401` response block.

---

#### Step 8 — qa-exhaustive.sh update (AC11)

**File:** `packages/api/scripts/qa-exhaustive.sh`

**Line 443** (current):
```bash
smoke "POST /conv/audio missing api key"           "401"      -X POST "$API/conversation/audio" -H "Content-Type: multipart/form-data"
```

Replace with:
```bash
# BUG-API-AUDIO-4XX-001: /conversation/audio allows anonymous callers per F091 EAA design
# (same reasoning as ADR-001 for /conversation/message; see PR #195 H3 fix).
# This smoke sends Content-Type: multipart/form-data without a boundary → 400 VALIDATION_ERROR.
# Accepting 400|415 because the exact code depends on which guard fires first.
smoke "POST /conv/audio missing api key"           "400|415"  -X POST "$API/conversation/audio" -H "Content-Type: multipart/form-data"
```

---

### Testing Strategy

**Test file:** `packages/api/src/__tests__/f091.audio.route.test.ts` (extend, do not create a new file)

**New test count:** 10 new `it()` blocks added to a new `describe('BUG-API-AUDIO-4XX-001 — 415 and 400 error shapes', ...)` block at the bottom of the existing file. The new `describe` block calls the same `beforeEach` setup helpers already present in the file scope.

| Test | AC | Type | Mocking note |
|------|----|------|--------------|
| Absent Content-Type → 415 | AC1 | New | No extra mocks; error is thrown before handler body runs |
| `application/json` CT → 415 | AC2 | New | Same |
| `text/plain` CT → 415 | AC3 | New | Same |
| multipart no-boundary param → 400 | AC4 | New | No extra mocks; error thrown in handler guard before `request.parts()` |
| multipart empty-boundary value → 400 | AC4 | New (Codex finding) | Same |
| Zero parts multipart → 400 | AC5 | New/Regression | Uses `buildMultipartBody({ audioPart: null, duration: null })` |
| No-audio parts only → 400 | AC6 | New/Regression | Uses `buildMultipartBody({ audioPart: null, duration: '10' })` |
| Anonymous happy path → 200 | AC7 | Regression | Requires `mockCallWhisperTranscription.mockResolvedValue(...)` and `mockRunEstimationCascade.mockResolvedValue(...)` |
| Duration > 120 → 400 | AC8 | Regression | Uses `buildAudioBody(200)` |
| Invalid API key → 401 | AC10 | Regression/No-code-change | `mockPrismaApiKeyFindUnique.mockResolvedValue(null)` |

**Mocking strategy:** All existing mocks in the file remain. New tests reuse the same `beforeEach()` that calls `setupAuthMocks()`, `setupKyselyMocks()`, `setupRedisMocks()`, and sets `mockCheckBudgetExhausted.mockResolvedValue(false)`. Tests for AC1/AC2/AC3 do not reach the handler body so Whisper/Prisma mocks are irrelevant — `buildApp()` is still required to have a running fastify instance.

**What NOT to integration-test in a unit file:** The boundary between `FST_ERR_CTP_INVALID_MEDIA_TYPE` (thrown before handler) vs `UNSUPPORTED_MEDIA_TYPE` (thrown inside handler) is an implementation detail. Tests assert only on `statusCode` and `body.error.code`; they do not assert which internal code path was taken.

---

### Key Patterns

- **`mapError()` if-chain discipline** — every new branch follows the same `if (asAny['code'] === '...') { return { statusCode: ..., body: { ... } } }` pattern. No else clauses. No early returns via ternary. Precedence is top-down; put the new entries after `FST_ERR_VALIDATION` (line 116) and before `DB_UNAVAILABLE` (line 119) — or immediately adjacent to the other framework-error branches (`FST_ERR_CTP_EMPTY_JSON_BODY`, `FST_ERR_VALIDATION`). See `errorHandler.ts:77-116` for reference style.
- **Handler guard placement** — Step 0a must be placed after the budget check and before `request.parts()`. This ordering is: budget check → content-type guard → boundary guard → multipart iteration. This preserves the documented Step 0 ordering in the F091 spec.
- **`UNSUPPORTED_MEDIA_TYPE` as a new error code** — this string does not exist anywhere in the codebase before this ticket. The `errorHandler.ts` will map it, and `conversation.ts` will throw it. No shared schema change needed.
- **AC5/AC6 may already pass** — do NOT skip writing those tests. Write them RED-first, confirm they fail if the existing guard is removed, then restore and confirm they pass. This documents the existing guard as intentional behaviour.
- **`app.close()` in every test** — the existing test file calls `await app.close()` at the end of every test (see lines 294, 319, 346). All new tests must follow the same pattern to avoid port/handle leaks.
- **Lint rule** — `no-floating-promises`: if `app.close()` is called without `await`, vitest will warn. All `app.close()` calls must be `await`ed.
- **F116 lint baseline** — no `eslint-disable` comments should be needed. The new error-handler branches are pure data objects; the handler guard uses `request.headers['content-type']` which is typed as `string | string[] | undefined` in Fastify. Cast with `const ct = typeof rawCt === 'string' ? rawCt : ''` to avoid TS errors without disabling lint rules.

---

### Risk / Unknown

**Unknown 1 — Exact error thrown for Case A (absent CT, empty body).**
The code analysis shows that when Content-Type is absent and the body is empty, fastify core calls `handler()` directly without body parsing (`handle-request.js:44-47`). The route handler is entered. The Step 0a guard in `conversation.ts` will catch this — it sees `request.headers['content-type'] === undefined` and throws `UNSUPPORTED_MEDIA_TYPE`. After Step 4 GREEN, the `FST_INVALID_MULTIPART_CONTENT_TYPE` branch in `errorHandler.ts` may or may not be exercised in practice — both branches produce the same 415 shape, so the AC1 test passes regardless. **No risk here; both paths produce the same observable outcome.**

**Unknown 2 — Exact error thrown for Case C (multipart/form-data without boundary).**
Busboy is constructed via `new Busboy(options)` in `@fastify/multipart/index.js:37-44`. If Busboy throws synchronously (no boundary), the error is caught and emitted on a PassThrough stream. The multipart plugin then catches it during body iteration and may re-throw a generic Error (no code). The Step 0a handler guard bypasses this entirely by checking `includes('boundary=')` before calling `request.parts()`. This makes the Busboy error irrelevant for the AC4 case. **Low risk.**

**Unknown 3 — `buildMultipartBody({ audioPart: null, duration: null })` body correctness.**
The `buildMultipartBody` helper produces only the closing `--${boundary}--\r\n` when both parts are null. Busboy may treat this as a valid zero-part body, or it may throw "Unexpected end of multipart data" (which `@fastify/multipart/index.js:245` silently swallows by resolving to `null`). If the iterator yields nothing, `audioBuffer` stays `undefined` → the existing guard at `conversation.ts:328` throws `VALIDATION_ERROR`. Either way, the result is 400. **Low risk.**

---

## Acceptance Criteria

- [x] AC1 — `POST /conversation/audio` with **no `Content-Type` header** (and any body or no body) returns `415 UNSUPPORTED_MEDIA_TYPE` with message `"Content-Type must be multipart/form-data"`. (EC-2) — _this covers battery smoke #357 "no body" because that invocation also omits Content-Type._
- [x] AC2 — `POST /conversation/audio` with `Content-Type: application/json` returns `415 UNSUPPORTED_MEDIA_TYPE`. (EC-3)
- [x] AC3 — `POST /conversation/audio` with `Content-Type: text/plain` returns `415 UNSUPPORTED_MEDIA_TYPE`. (EC-3) — _this covers battery smoke #358._
- [x] AC4 — `POST /conversation/audio` with `Content-Type: multipart/form-data` (no `boundary=...` parameter) and empty body returns `400 VALIDATION_ERROR`. (EC-4) — _this covers battery smoke #359._
- [x] AC5 — `POST /conversation/audio` with valid multipart boundary, zero parts returns `400 VALIDATION_ERROR` with message `"Missing audio file part in multipart request"`. (EC-5)
- [x] AC6 — `POST /conversation/audio` with valid multipart, non-audio parts only returns `400 VALIDATION_ERROR` with the same message. (EC-6)
- [x] AC7 — Anonymous caller happy path: `POST /conversation/audio` with no `X-API-Key` and no `X-Actor-Id` but a valid `audio` + `duration` body returns `200` with the usual response shape. (EC-1, regression guard)
- [x] AC8 — Existing 400 guards (EC-7) continue to work: unsupported MIME, missing duration, non-numeric duration, duration out of range all return `400 VALIDATION_ERROR` with their respective messages.
- [x] AC9 — F091 `VOICE_BUDGET_EXHAUSTED` (503) gate continues to execute in the same position and return the same shape. (EC-9, regression guard)
- [x] AC10 — Invalid (present but unregistered) `X-API-Key` continues to return `401 UNAUTHORIZED` with message `"Invalid or expired API key"`. (EC-11, regression guard — no code change expected, test guards pre-existing behaviour.)
- [x] AC11 — `packages/api/scripts/qa-exhaustive.sh` smoke #359 (`POST /conv/audio missing api key`) expected regex updated from `401` to `400|415` with inline comment citing F091 anonymous-OK design.
- [x] AC12 — `docs/specs/api-spec.yaml` updated for `/conversation/audio`: (a) endpoint description/summary with WAV removed from supported formats (pre-existing bug, cleaned up here — see EC-0 / API Changes §0); (b) new `415` response block (schema + example); (c) `400` description extended to enumerate the malformed-multipart sub-cases (no boundary, empty multipart, no audio part). No `security:` declaration added. No `401` response block added.
- [x] AC13 — Unit tests cover every new error path: **415 absent-CT** (AC1), **415 JSON-CT** (AC2), **415 text-CT** (AC3), **400 no-boundary** (AC4), **400 empty-multipart** (AC5), **400 no-audio-part** (AC6), **200 anonymous happy path** (AC7 regression), **401 invalid-key** (AC10 regression). All via Fastify `app.inject`. Existing tests that exercise the 400 MIME/duration guards continue to pass unchanged.
- [x] AC14 — `npm test --workspace=@foodxplorer/api` → all tests pass (baseline 3647 + new AC13 tests). No regressions.
- [x] AC15 — `npm run lint --workspace=@foodxplorer/api` → 0 errors (F116 baseline preserved).
- [x] AC16 — `npm run build --workspace=@foodxplorer/api` → clean.

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing (TDD — RED → GREEN per AC)
- [x] E2E tests updated (N/A — no E2E harness for /conversation/audio at this time; unit tests via `app.inject` are the integration layer)
- [x] Code follows project standards (minimal error-handler additions, no speculative generality)
- [x] No linting errors
- [x] Build succeeds
- [x] Specs reflect final implementation (`api-spec.yaml` 415 response added; smoke script updated)

---

## Workflow Checklist

<!-- Standard tier — Steps 0-5 active; Step 6 after merge. -->

- [x] Step 0: `spec-creator` executed + `/review-spec` (Gemini APPROVED R1; Codex REVISE R1 → APPROVED R2 after 3 fixes)
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` executed + `/review-plan` (Gemini APPROVED; Codex REVISE with 2 IMPORTANT + 1 SUGGESTION, all 3 addressed in plan revisions)
- [x] Step 3: `backend-developer` executed with TDD
- [x] Step 4: `production-code-validator` executed, quality gates pass
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 5: `qa-engineer` executed (Standard/Complex)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-22 | Step 0 — spec drafted | Initial spec drafted by `spec-creator` assumed `/conversation/audio` required an API key. Code investigation revealed F091 allows anonymous callers (`auth.ts:16`, `actorRateLimit.ts:39,49`, `actorResolver.ts:78-79`). User confirmed the anonymous-OK design (EAA accessibility). Spec rewritten to reflect: fix 400/415 error shaping ONLY; correct the stale `missing api key → 401` smoke assertion (same pattern as PR #195 H3); no auth policy change. `api-spec.yaml` changes reverted. |
| 2026-04-22 | Step 0 — /review-spec | Cross-model review (Gemini + Codex, context files included). **Gemini APPROVED** (10 files read, no issues). **Codex REVISE** with 3 IMPORTANT findings (16 files read including test files): (1) 400/415 inconsistency for no-body case — smoke #357 sends no Content-Type → actually 415 not 400; (2) pre-existing WAV documentation bug in `api-spec.yaml:5538` vs code at `routes/conversation.ts:268-274`; (3) 401 blanket statement was too broad — invalid (non-empty) keys still trigger 401 via existing auth path. All 3 applied: spec table corrected, AC reorganized (AC1-AC6 map to smoke #357/#358/#359 properly), AC12 now also requires WAV removal from endpoint description, 401-preservation added as AC10 regression guard, EC-11 added for invalid-key path clarification. |
| 2026-04-22 | Step 0 — /review-spec round 2 | Codex re-reviewed the revised spec and confirmed: (1) RESOLVED — no-body consistently 415 in Description/EC-2/AC1/smoke #357; (2) RESOLVED — §0 API Changes + AC12 require WAV removal, EC-7 preserves audio/wav rejection; (3) RESOLVED — distinguished missing-key (anonymous) from invalid-key (still 401) in "What this must deliver" #4, EC-11, AC10, AC13. **VERDICT: APPROVED.** Step 0 closed. |
| 2026-04-22 | Step 1 — branch + ticket | Branch `bugfix/BUG-API-AUDIO-4XX-001` already created from `origin/develop` at session start. Ticket now fully populated with spec + AC + DoD + Workflow + first-commit housekeeping for PR #195 (ride-along commit `b13e640`). |
| 2026-04-22 | Step 2 — backend-planner | Plan generated (8 steps: 6 TDD RED/GREEN + 2 non-TDD deliverables). Addresses all 13 AC via error-handler mappings (FST_ERR_CTP_INVALID_MEDIA_TYPE, FST_INVALID_MULTIPART_CONTENT_TYPE, UNSUPPORTED_MEDIA_TYPE) + explicit handler guard in conversation.ts + api-spec.yaml extensions + qa-exhaustive.sh smoke update. Risks/unknowns documented (3 items on Busboy error propagation). |
| 2026-04-22 | Step 2 — /review-plan | Cross-model review. **Gemini APPROVED** (9 files read, no issues). **Codex REVISE** (13 files read + 7 greps) with 2 IMPORTANT + 1 SUGGESTION: (1) new `FST_*` mappings in global `mapError()` would send audio-specific message `"Content-Type must be multipart/form-data"` to JSON routes like `/estimate` when they receive wrong Content-Type — fix: use `error.message` instead of hardcoded string in FST_* branches; only the handler's explicit `UNSUPPORTED_MEDIA_TYPE` throw keeps the audio-specific message; (2) `includes('boundary=')` guard permits `boundary=` with empty value, falling back to Busboy 500 — fix: regex `/;\s*boundary=([^;\s]+)/i` requiring non-empty value + new test AC4 variant; (3) "8 new it() blocks" count was wrong — enumerated 9, now 10 with the empty-boundary test. All 3 applied to the plan. |
| 2026-04-22 | Step 3 — TDD cycle AC1–AC3 (RED) | Added 3 failing tests in new `describe('BUG-API-AUDIO-4XX-001 error shapes')` block: absent CT → 415, application/json CT → 415, text/plain CT → 415. All three returned 500 (mapError had no FST_* branches). |
| 2026-04-22 | Step 3 — TDD cycle AC1–AC3 (GREEN) | Added `FST_ERR_CTP_INVALID_MEDIA_TYPE`, `FST_INVALID_MULTIPART_CONTENT_TYPE`, and `UNSUPPORTED_MEDIA_TYPE` branches to `mapError()` in `errorHandler.ts`. Added Step 0a guard in `conversation.ts` (after budget check, before `request.parts()`) using regex `/;\s*boundary=([^;\s]+)/i` for boundary extraction. AC1/AC2/AC3 all GREEN. Tests: 3647 → 3657 (10 new tests added). |
| 2026-04-22 | Step 3 — TDD cycle AC4 (RED→GREEN) | AC4 (no boundary → 400) and AC4 variant (empty boundary → 400): both initially RED (500 and wrong message respectively). Step 0a guard in conversation.ts throws VALIDATION_ERROR with message containing "boundary" when the regex fails — both GREEN after the guard. |
| 2026-04-22 | Step 3 — TDD cycle AC5–AC6 (RED→already GREEN) | AC5 (zero parts → 400) and AC6 (no audio part → 400): confirmed already handled by the existing Step 2 guard at `conversation.ts:328`. Both passed immediately. Tests serve as regression guards documenting the existing guard as intentional. |
| 2026-04-22 | Step 3 — TDD cycle AC7, AC8, AC10 (regression guards) | AC7 anonymous happy path → 200 (no X-API-Key/X-Actor-Id); AC8 duration >120 → 400; AC10 invalid API key → 401. All confirmed GREEN with no code change needed. Pre-existing behaviour preserved. |
| 2026-04-22 | Step 4 — quality gates | api tests 3657/3657 PASS, lint 0 errors, build clean. All AC1–AC16 satisfied. |
| 2026-04-22 | Step 4 — merge origin/develop | Integrated PR #196 (F-H4 seed expansion round-1, 27 regional dishes) into the feature branch via `git merge origin/develop --no-edit`. One conflict in `product-tracker.md` Active Session panel, resolved manually merging both contexts. Non-conflicting H4 changes (seed data, test fixtures, docs) carried over cleanly. Post-merge gates re-run: api tests 3657/3657 PASS, lint 0, build clean — no regressions introduced by the merge. |
| 2026-04-22 | Step 4 — production-code-validator | **APPROVE** with 0 CRITICAL / 0 IMPORTANT / 0 NIT. Validated 10 production-readiness concerns (branch precedence, global-scope impact of FST_* mappings, regex guard correctness against 8 edge cases, F091 budget/rate-limit ordering, lint compliance, type safety, test quality, spec consistency, script accuracy, merge integrity). No blockers. |

<!-- After code review, add a row documenting which findings were accepted/rejected:
| YYYY-MM-DD | Review findings | Accepted: C1-C3, H1-H2. Rejected: M5 (reason). Systemic: C4 logged in bugs.md |
This creates a feedback loop for improving future reviews. -->

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
| 7. Verify branch up to date | [ ] | merge-base: up to date / merged origin/<branch> |

---

*Ticket created: 2026-04-22*
