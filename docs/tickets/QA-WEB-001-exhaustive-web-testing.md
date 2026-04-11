# QA-WEB-001: Exhaustive Testing — packages/web

**Feature:** QA-WEB-001 | **Type:** Frontend-QA | **Priority:** High
**Status:** Ready for Merge | **Branch:** qa/QA-WEB-001-exhaustive-web-testing
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-04-11 | **Dependencies:** F090, F092, F093 (all done)

---

## Spec

### Description

Bounded QA pass over `packages/web` — the nutriXplorer conversational assistant at `/hablar`. Goal: find real bugs before public launch at `app.nutrixplorer.com`.

**Scope:** 14 components, 3 lib modules, 1 route handler, 4 app files in `packages/web`. Backend API is out of scope except the route handler proxy.

**Deliverables:**
1. New test suites (Jest) following existing naming convention (`*.qa-web-001.test.tsx`)
2. Findings table with severity per confirmed finding
3. Traceability matrix: existing coverage vs gaps for each flow

**Review scope (bounded):**
- `src/components/`: HablarShell, ConversationInput, ResultsArea, NutritionCard, PhotoButton, ConfidenceBadge, ErrorState, EmptyState, LoadingState, ContextConfirmation, AllergenChip, MicButton, SubmitButton, HablarAnalytics
- `src/lib/`: apiClient.ts, actorId.ts, metrics.ts
- `src/app/api/analyze/`: route.ts
- `src/app/`: layout.tsx, page.tsx, hablar/page.tsx

### Severity Rubric

| Level | Definition | Criteria |
|-------|-----------|----------|
| **P0** | Release blocker | Crashes, data loss, or security vulnerability affecting all users. No workaround. |
| **P1** | Significant | Core flow broken or degraded for a subset of users, or silent misconfiguration that hides operational issues. Workaround may exist. |
| **P2** | Minor | UX polish, accessibility gap, code robustness issue, or enhancement. Does not block functionality. |

### Confirmed Defects

#### P1

**BUG-QA-001: CSP missing GA4 domains in script-src**
- Location: `next.config.mjs:20`
- Observed: `script-src 'self' 'unsafe-inline'` — missing `https://www.googletagmanager.com`
- Impact: GA4 will break when CSP is upgraded from Report-Only to enforced
- Evidence: Direct code inspection of CSP header value
- Test: Import `next.config.mjs` headers config, assert GA4 domains present in `script-src` and `connect-src`

**BUG-QA-002: CSP missing GA4 endpoints in connect-src**
- Same location. `connect-src 'self' ${apiUrl}` missing `https://www.google-analytics.com`
- Test: Same approach as BUG-QA-001

**BUG-QA-003: Route handler error format mismatch**
- Location: `app/api/analyze/route.ts:19`
- Observed: Returns `{ error: 'CONFIG_ERROR' }` (string)
- Expected by client: `{ error: { code, message } }` (object)
- Impact: Client falls back to generic `'API_ERROR'` code — ops team gets no signal API_KEY is missing
- Evidence: Code inspection of route.ts:19 vs apiClient.ts:136
- Test: Call route handler with env vars unset, assert structured error body

#### P2

**BUG-QA-004:** `ConfidenceBadge` crashes on unexpected `level` — `BADGE_CONFIG[level]` returns undefined, destructuring throws TypeError
**BUG-QA-007:** `ErrorState` missing `role="alert"` — screen readers don't announce error
**BUG-QA-008:** No photo retry — `handleRetry()` only re-sends text queries, not photos
**BUG-QA-009:** No client-side query length pre-validation — 501+ chars makes full server round-trip before inline error

### Hypotheses to Verify

**BUG-QA-005:** `photo_success` metrics may miss `intent` field — needs test to confirm gap in `MetricsSnapshot.intents`
**BUG-QA-011:** Actor ID persisted before response body validation — needs test to confirm observable impact

### Code-Inspection Findings (follow-up tickets)

**BUG-QA-010:** Route handler has no upstream fetch timeout — can hang until Vercel function timeout. Not testeable cleanly in Jest; create separate fix ticket.
**BUG-QA-012:** Misleading comment in ResultsArea about server component compatibility.

### Exploratory Compatibility Checks (manual)

**BUG-QA-006:** `Permissions-Policy: camera=()` may conflict with `<input capture="environment">` on Android Chrome / Samsung Internet. Not testable in Jest. Verify on real device when available.

### Test Areas

#### 1. Functional Flows — Traceability Matrix

Tests only for **uncovered or weakly covered** flows (C2 correction).

| ID | Flow | Existing Coverage | Gap? |
|----|------|-------------------|------|
| F-001 | Text → estimation | HablarShell.test.tsx | No |
| F-002 | Text → comparison | ResultsArea.test.tsx | Weak — no integration test |
| F-003 | Text → menu_estimation (null result) | edge-cases.test.tsx | No |
| F-004 | Text → context_set | HablarShell.test.tsx | No |
| F-005 | Text → reverse_search (0 results) | edge-cases.test.tsx | No |
| F-006 | Text → text_too_long | HablarShell.test.tsx | No |
| F-007 | Photo → success | HablarShell.photo.test.tsx | No |
| F-008 | Photo → partial:true | F092.qa.test.tsx | No |
| F-009 | Cross-flow: text → photo | F092.qa.test.tsx | No |
| F-010 | Cross-flow: photo → text | F092.qa.test.tsx | No |
| F-011 | Retry after text error | HablarShell.test.tsx | No |
| F-012 | Error cleared on new query | Not covered | **Yes** |
| F-013 | Empty query guard | HablarShell.test.tsx | No |
| F-014 | Rate limit 429 | HablarShell.test.tsx + edge-cases | No |
| F-015 | Network error | HablarShell.test.tsx | No |
| F-016 | Text timeout (15s) | edge-cases.test.tsx | Weak — timeout via DOMException not tested at shell level |
| F-017 | Photo timeout (65s) | HablarShell.photo.test.tsx | Weak — only PROCESSING_TIMEOUT, not all timeout paths |
| F-018 | Invalid file type | F092.qa.test.tsx | No |
| F-019 | File > 10MB | F092.qa.test.tsx | No |
| F-020 | Stale request guard | edge-cases.test.tsx | **Gap** — no test showing 2nd request's results shown |
| F-021 | dataLayer timing | f093.qa.test.tsx | No |
| F-022 | No PII in dataLayer | f093.qa.test.tsx | Weak — checks "only event key" but query text not checked |
| F-023 | Photo retry after error | Not covered | **Yes** — BUG-QA-008 |
| F-024 | 501-char query behavior | Not covered | **Yes** — BUG-QA-009 |
| F-025 | Comparison with null data | Not covered | **Yes** |
| F-026 | Unknown intent fallback | Not covered | **Yes** |
| F-027 | Context set — ambiguous | Not covered | **Yes** |

#### 2. Edge Cases (new tests needed)

- ConfidenceBadge unknown level — no crash (BUG-QA-004)
- NutritionCard: 0 calories, very large values, long name, no source, allergens empty/null
- Photo: all error codes (RATE_LIMIT, UNAUTHORIZED, MENU_ANALYSIS_FAILED, NETWORK_ERROR, unknown, non-ApiError)
- Photo: null estimate dish
- Photo: empty MIME type (older mobile)
- API client: MALFORMED_RESPONSE, PARSE_ERROR, actor ID persistence, error code extraction
- Route handler: CONFIG_ERROR (both env vars), header forwarding, 502 upstream, correct URL

#### 3. Accessibility (Jest-testable)

- LoadingState: `role="status"`, sr-only text
- NutritionCard: `aria-label` with dish name + calories
- Textarea: `aria-label` "Escribe tu consulta"
- PhotoButton: `aria-label` "Subir foto del plato"
- MicButton: `aria-label`, disabled
- SubmitButton: `aria-label` "Buscar"
- Inline error: `role="alert"`
- ErrorState icon: `aria-hidden`
- Keyboard Tab order: textarea → photo → mic → submit (G5)
- All inputs disabled during loading state (G6)

#### 4. CSP Validation (G9 — import config directly)

- Import `next.config.mjs` headers config
- Assert `script-src` contains `googletagmanager.com`
- Assert `connect-src` contains `google-analytics.com`

---

## Implementation Plan

### Existing Code to Reuse

- **Fixture factories** — `packages/web/src/__tests__/fixtures.ts`: `createConversationMessageResponse`, `createConversationMessageData`, `createEstimateData`, `createEstimateResult`, `createMenuAnalysisResponse`, `createMenuAnalysisData`, `createMenuAnalysisDish`
- **Mock pattern** — Jest top-level `jest.mock` for `../../lib/apiClient`, `../../lib/actorId`, `../../lib/metrics` (copy verbatim from `HablarShell.test.tsx` or `F092.qa.test.tsx`)
- **Helper `makeFile` / `makeFileWithSize` / `selectFile`** — defined in `HablarShell.photo.test.tsx` and `F092.qa.test.tsx`; copy into new test files (do NOT import cross-file)
- **`typeAndSubmit` helper** — defined in `HablarShell.test.tsx` and edge-cases files; re-declare locally in each new file that needs it

### Files to Create

| File | Purpose |
|------|---------|
| `packages/web/src/__tests__/components/gaps.qa-web-001.test.tsx` | Primary gap-fill file: F-012, F-016, F-017, F-020, F-022, F-023, F-024, F-025, F-026, F-027 |
| `packages/web/src/__tests__/components/edge-cases.qa-web-001.test.tsx` | Component edge cases: ConfidenceBadge (BUG-QA-004), NutritionCard, photo error codes, MIME edge cases |
| `packages/web/src/__tests__/components/a11y.qa-web-001.test.tsx` | Accessibility assertions: aria roles, labels, disabled states, Tab order |
| `packages/web/src/__tests__/lib/apiClient.qa-web-001.test.ts` | API client gaps: MALFORMED_RESPONSE, PARSE_ERROR, actor ID persistence timing |
| `packages/web/src/__tests__/api/route.qa-web-001.test.ts` | Route handler: CONFIG_ERROR structured body (BUG-QA-003), URL construction, 502 on upstream unreachable |
| `packages/web/src/__tests__/config/csp.qa-web-001.test.ts` | CSP validation: assert GA4 domains in script-src and connect-src (BUG-QA-001, BUG-QA-002) |

### Files to Modify

None. All new tests go into new files. Existing suites are not modified.

### Implementation Order

**Step 1 — `gaps.qa-web-001.test.tsx`** (primary coverage gaps, ~22 tests)

Mocks: `../../lib/apiClient` (sendMessage + sendPhotoAnalysis + ApiError), `../../lib/actorId`, `../../lib/metrics`.

Helpers: `makeFile`, `makeFileWithSize`, `selectFile`, `typeAndSubmit` — declared locally.

Test cases by flow ID:

- **F-012 — Error cleared on new query**
  - After an error state is set, submit a new non-empty query → `error` state returns to null, `ErrorState` disappears before the new result arrives (assert while new request is still pending via a never-resolving mock).

- **F-016 — Timeout via DOMException (shell level)**
  - Mock `sendMessage` to reject with `new DOMException('The operation timed out.', 'TimeoutError')` (not wrapped — raw DOMException).
  - Assert HablarShell shows "La consulta ha tardado demasiado. Inténtalo de nuevo." (not "Sin conexión").
  - Note: `HablarShell.tsx` already handles `TimeoutError` separately at line 90–97 — this test confirms that code path is exercised at shell integration level.

- **F-017 — Photo timeout paths (all)**
  - Path A: DOMException `AbortError` with no `reason` → inline error "El análisis ha tardado demasiado." + `photo_error` tracked with `CLIENT_TIMEOUT`.
  - Path B: `ApiError` with code `PROCESSING_TIMEOUT` → same inline message.
  - Path C: `ApiError` with code `TIMEOUT_ERROR` → same inline message.
  - (Path A is partially covered in `F092.qa.test.tsx`; paths B and C are new.)

- **F-020 — Stale request guard: second request results shown**
  - Use two controlled promises. Allow first to resolve after second has been submitted.
  - Because textarea is disabled during loading, trigger via the retry mechanism: (1) submit → error → retry while first promise resolves with stale data. Assert only the retry response's data is shown, not the stale first response.
  - Alternative: use `jest.requireMock` to call `executeQuery` directly with a second call after the first is pending (if the internal ref is accessible through onRetry).
  - Simplest approach: first call → succeed with estimation A; second submit after clearing (via retry) → controller ref replaced; resolve the stale first promise manually after second result is already displayed → assert the stale first response does NOT overwrite the second result (test `controller.signal.aborted` guard path by resolving the first promise after abort).

- **F-022 — No PII in dataLayer (strong assertion)**
  - Existing `edge-cases.f093.qa.test.tsx` checks `Object.keys(sentEvent!).toEqual(['event'])` but only for a static query string.
  - New test: submit a query that contains a Spanish name or phone-like pattern (e.g. `"Elena come 3 tacos"`) and assert: (a) `hablar_query_sent` payload has exactly `{event: 'hablar_query_sent'}`, (b) `JSON.stringify(sentEvent)` does not contain the query text.
  - Also assert no `actor_id`, `userId`, or free-text fields appear.

- **F-023 — Photo retry after error (BUG-QA-008)**
  - Submit a photo that fails with `ApiError('Vision failed', 'MENU_ANALYSIS_FAILED', 422)`.
  - Assert inline error is shown.
  - Click retry button (if present) or select a second file.
  - Assert `sendPhotoAnalysis` is called again (retry path) — confirm `handleRetry()` in `HablarShell` only re-sends `lastQuery` (text), NOT a photo.
  - Document the confirmed defect: `handleRetry` cannot re-send a photo because `lastFile` is not stored in state. The test should assert that clicking "Intentar de nuevo" after a photo error calls `sendMessage(lastQuery)` (which will be empty string, thus no call), not `sendPhotoAnalysis`.

- **F-024 — 501-char query behavior (BUG-QA-009)**
  - Type exactly 501 characters in the textarea and press Enter.
  - Assert that `sendMessage` IS called (no client-side length guard exists per BUG-QA-009).
  - Note the confirmed defect: there is no pre-validation; the full round-trip occurs. The test documents expected current behavior (call goes through) and will need updating once the fix is implemented.

- **F-025 — Comparison with null data**
  - Mock `sendMessage` to resolve with a `comparison` response where `dishB` has `result: null` (use `createEstimateData({ result: null })`).
  - Assert: NutritionCard for dishA renders normally; NutritionCard for dishB renders the no-match placeholder "No encontré información nutricional" (line 60 of `NutritionCard.tsx`).
  - Also assert no crash when both `dishA` and `dishB` are null result.

- **F-026 — Unknown intent fallback**
  - Mock `sendMessage` to resolve with `{ success: true, data: { intent: 'unknown_future_intent', actorId: '...', activeContext: null } }`.
  - Assert: HablarShell does not crash; ResultsArea falls through to `default:` case in the switch and shows EmptyState (no error, no results card).

- **F-027 — Context set — ambiguous**
  - Mock `sendMessage` to resolve with `createConversationMessageResponse('context_set', { ambiguous: true, contextSet: undefined })`.
  - Assert: `ContextConfirmation` renders the amber ambiguity message "No encontré ese restaurante. Prueba con el nombre exacto."
  - Also test the inverse: `ambiguous: false` with valid `contextSet` → renders "Contexto activo:" confirmation.

Estimated tests: **~22**

---

**Step 2 — `edge-cases.qa-web-001.test.tsx`** (component edge cases, ~18 tests)

Mocks: `../../lib/apiClient`, `../../lib/actorId`, `../../lib/metrics`.

Test cases by bug/area:

- **BUG-QA-004 — ConfidenceBadge unknown level**
  - Import `ConfidenceBadge` directly (no shell needed).
  - Render with `level={'unknown' as 'high'}` — assert it does NOT throw (`BADGE_CONFIG[level]` returns undefined → destructuring crashes). This test should FAIL (documents P2 bug). Note in test comment: "documents BUG-QA-004, expected to crash until fixed".

- **NutritionCard edge cases** (render `NutritionCard` directly, no shell):
  - `result.nutrients.calories = 0` → renders "0" KCAL (no crash, no empty string).
  - Very large calorie value (99999) → renders rounded integer.
  - Long dish name (200-char string) → renders without overflow crash.
  - `result.source = null` (override `createEstimateResult({ source: null })`) → no crash, source row hidden.
  - `allergens` empty array `[]` → no chip rendered, no crash.
  - `allergens: null` (cast) → no crash (Array.isArray(null) === false).

- **Photo error codes — all ApiError paths in executePhotoAnalysis**:
  - `INVALID_IMAGE` → inline "Formato no soportado. Usa JPEG, PNG o WebP."
  - `MENU_ANALYSIS_FAILED` → inline "No he podido identificar el plato. Intenta con otra foto."
  - `PAYLOAD_TOO_LARGE` → inline "La foto es demasiado grande. Máximo 10 MB."
  - `RATE_LIMIT_EXCEEDED` (photo) → inline "Has alcanzado el límite de análisis por foto. Inténtalo más tarde."
  - `UNAUTHORIZED` → inline "Error de configuración. Contacta con soporte."
  - `NETWORK_ERROR` (photo) → inline "Sin conexión. Comprueba tu red."
  - Unknown code → inline "No se pudo analizar la foto. Inténtalo de nuevo."
  - Non-ApiError (plain Error) → inline "No se pudo analizar la foto. Inténtalo de nuevo."

- **Photo: null estimate dish in photoResults**
  - `createMenuAnalysisResponse({ dishes: [createMenuAnalysisDish({ estimate: null })] })` → ResultsArea renders `<article>` with "Sin datos nutricionales disponibles." (line 67 of `ResultsArea.tsx`).

- **Photo: empty MIME type (older mobile)**
  - `makeFile('photo.jpg', '', 1024)` (empty string MIME) → `sendPhotoAnalysis` is called (allowed through per `HablarShell.tsx` line 129 comment).

Estimated tests: **~18**

---

**Step 3 — `a11y.qa-web-001.test.tsx`** (accessibility, ~15 tests)

Mocks: same as above for shell-level tests; render presentational components directly for component-level assertions.

Test cases:

- **LoadingState**: has `role="status"`, contains a `.sr-only` element with text "Buscando información nutricional..."
- **NutritionCard**: `aria-label` attribute contains both dish name and calorie count (e.g. `"Big Mac: 550 calorías"`).
- **Textarea in ConversationInput**: has `aria-label="Escribe tu consulta"`.
- **PhotoButton**: has `aria-label="Subir foto del plato"` (verify against `PhotoButton.tsx` actual attribute — adjust label text to match source).
- **MicButton**: has `aria-label` attribute, renders as `disabled` (MicButton is currently a stub).
- **SubmitButton**: has `aria-label="Buscar"` (verify against source).
- **ConversationInput inline error**: `role="alert"` on the `<p>` that shows `inlineError` — render `ConversationInput` with a non-null `inlineError` prop and assert `getByRole('alert')` exists.
- **ErrorState icon**: the `<svg>` has `aria-hidden="true"` (BUG-QA-007 complement: icon is hidden, but verify `role="alert"` is absent on the root `<div>` — BUG-QA-007 confirms it IS missing).
- **ErrorState missing role="alert"** (BUG-QA-007): render `ErrorState` and assert `queryByRole('alert')` returns null — this documents the confirmed P2 bug.
- **All inputs disabled during loading** (G6): render `HablarShell`, mock pending request, assert textarea, PhotoButton file input, SubmitButton are all disabled/not rendered while loading.
- **Keyboard Tab order** (G5): render `ConversationInput` and assert DOM order: textarea appears before the PhotoButton's file input in document order (use `querySelectorAll` on the container to check order).

Estimated tests: **~15**

---

**Step 4 — `apiClient.qa-web-001.test.ts`** (API client gaps, ~8 tests)

Mocks: `global.fetch` via `jest.fn()` (same pattern as `apiClient.test.ts`); mock `../../lib/actorId` for `persistActorId`.

Setup: `process.env['NEXT_PUBLIC_API_URL'] = 'http://localhost:3001'` in `beforeEach`; restore in `afterEach`.

Test cases:

- **MALFORMED_RESPONSE** — `fetch` resolves with `{ success: true, data: null }` (data is null, not an object) → `sendMessage` throws `ApiError` with code `MALFORMED_RESPONSE` (verify against `isConversationMessageResponse` guard in `apiClient.ts`). If the current guard doesn't produce that code, test confirms the actual throw type.
- **PARSE_ERROR** — `fetch` resolves with `response.json()` throwing a `SyntaxError` → `sendMessage` throws `ApiError` with code `PARSE_ERROR`.
- **actor ID persistence: called when response header differs** — `fetch` returns `X-Actor-Id: new-actor-id` header; assert `persistActorId('new-actor-id')` called once.
- **actor ID persistence: NOT called when header matches** — `fetch` returns same actor ID as was sent; assert `persistActorId` not called.
- **actor ID persistence timing (BUG-QA-011 probe)** — actor ID is persisted BEFORE body validation completes: set `X-Actor-Id` header to a new value and make `response.json()` throw a SyntaxError; assert `persistActorId` was called (confirming the bug: actor ID persisted even when body is malformed).
- **sendPhotoAnalysis: MALFORMED_RESPONSE** — route handler returns `{ success: true, data: null }` → `sendPhotoAnalysis` throws `ApiError` with code `MALFORMED_RESPONSE`.
- **sendPhotoAnalysis: error code extraction** — route handler returns `{ error: { code: 'MENU_ANALYSIS_FAILED', message: 'Vision failed' } }` with status 422 → `sendPhotoAnalysis` throws `ApiError` with `.code === 'MENU_ANALYSIS_FAILED'` and `.status === 422`.
- **sendPhotoAnalysis: unknown error shape** — route handler returns `{ error: 'SOME_STRING' }` with status 500 → `sendPhotoAnalysis` throws `ApiError` with code `API_ERROR`.

Estimated tests: **~8**

---

**Step 5 — `route.qa-web-001.test.ts`** (route handler, ~6 tests)

Pattern: `jest.resetModules()` + `process.env` manipulation + `await import('../../app/api/analyze/route')` in each test body (same pattern as F092.qa.test.tsx Section 7).

Setup/teardown: save and restore `process.env['API_KEY']` and `process.env['NEXT_PUBLIC_API_URL']`.

Test cases:

- **BUG-QA-003 — CONFIG_ERROR when API_KEY missing**: delete `process.env['API_KEY']`, call `POST(request)`, assert response body is `{ error: 'CONFIG_ERROR' }` as a string (not `{ error: { code, message } }`) — this documents the confirmed P1 mismatch. The test asserts the CURRENT behavior (string) to lock it in for the fix ticket.
- **CONFIG_ERROR when NEXT_PUBLIC_API_URL missing**: same approach with `NEXT_PUBLIC_API_URL` deleted.
- **Correct upstream URL** — `global.fetch` mock resolves; assert that `fetch` was called with a URL ending in `/analyze/menu`.
- **502 on upstream TypeError** — `global.fetch` rejects with `new TypeError('Failed to fetch')` → assert response status is 502 (route handler now has a try/catch, updated from prior test in F092.qa.test.tsx).
- **Content-Type forwarded** — `global.fetch` resolves; assert `upstreamRequest.headers.get('Content-Type')` equals the client's multipart boundary value.
- **X-FXP-Source forwarded** — assert `upstreamRequest.headers.get('X-FXP-Source')` equals `'web'` when client sends it.

Estimated tests: **~6**

---

**Step 6 — `csp.qa-web-001.test.ts`** (CSP validation, ~4 tests)

No mocks. Direct import of the `nextConfig` export from `packages/web/next.config.mjs`.

Setup: call `nextConfig.headers()` (it is `async`) and extract the CSP header value from the returned array. Filter to `source: '/(.*)'` entry, find `Content-Security-Policy-Report-Only` header.

Test cases:

- **BUG-QA-001 — script-src missing googletagmanager.com**: assert CSP `script-src` directive contains `'https://www.googletagmanager.com'`. Expected to FAIL (documents P1 bug).
- **BUG-QA-002 — connect-src missing google-analytics.com**: assert CSP `connect-src` directive contains `'https://www.google-analytics.com'`. Expected to FAIL (documents P1 bug).
- **connect-src contains the API URL**: assert `connect-src` includes `process.env.NEXT_PUBLIC_API_URL` or the fallback `https://api.nutrixplorer.com`.
- **script-src contains 'self'**: baseline assertion that current value is parseable and at minimum contains `'self'`.

Estimated tests: **~4**

---

### Testing Strategy

**Total estimated new tests: ~73** (22 + 18 + 15 + 8 + 6 + 4)

**Mocking strategy:**
- `sendMessage` / `sendPhotoAnalysis` / `ApiError`: top-level `jest.mock('../../lib/apiClient', ...)` with inline class definition for `ApiError` (verbatim from existing files — required because class must be available before module loading).
- `actorId`: top-level `jest.mock('../../lib/actorId', ...)` returning `getActorId: jest.fn().mockReturnValue('mock-actor-uuid')` and `persistActorId: jest.fn()`.
- `metrics`: top-level `jest.mock('../../lib/metrics', ...)` returning `trackEvent: jest.fn()` and `flushMetrics: jest.fn()` (only in files that assert metric calls).
- `global.fetch`: assigned directly in each test as `jest.fn()` (for apiClient and route handler tests).
- `next/navigation`: top-level `jest.mock('next/navigation', ...)` only in `a11y.qa-web-001.test.tsx` if `HablarShell` or any tested component imports it (check at implementation time).
- Route handler: always use `jest.resetModules()` + dynamic `await import(...)` so env vars are evaluated fresh per test.

**Key test scenarios:**
- Async assertions: always use `await waitFor(...)` for any assertion after an action that triggers a state update.
- Inline errors: assert via `getByRole('alert')` or `getByText(...)` — do not use `getByTestId` (no test IDs on inline errors).
- Cross-file fixture reuse: import factories from `../fixtures` — do NOT inline full fixture objects unless a new shape is needed.
- Bug documentation tests: add comment `// Documents BUG-QA-XXX — expected to fail until fix applied` above any test that currently asserts broken behavior (ConfidenceBadge crash, CSP gaps, route error body mismatch).

### Key Patterns

- **Top-level jest.mock before imports** (required by Jest hoisting): follow exact structure in `HablarShell.test.tsx` lines 10–27 — the `ApiError` class must be redefined inline inside the mock factory.
- **Accessing mock from requireMock**: for cross-mock access within a test (e.g. getting `sendMessage` inside a `sendPhotoAnalysis` test), use `jest.requireMock('../../lib/apiClient').sendMessage` (see `F092.qa.test.tsx` line 327).
- **Route handler tests with env vars**: always `jest.resetModules()` before `process.env` mutation and dynamic import (see `F092.qa.test.tsx` lines 488–507 for the full beforeEach/afterEach pattern).
- **`userEvent.setup({ applyAccept: false })`**: required to bypass MIME type filtering in JSDOM for invalid file type tests (see `F092.qa.test.tsx` line 85).
- **`Object.defineProperty(file, 'size', { value: N })`**: required to override File.size (read-only in JSDOM) for size boundary tests (see `F092.qa.test.tsx` line 79).
- **Gotcha — disabled textarea**: during loading, `textarea` is disabled (`ConversationInput.tsx` line 66). Tests for flows that require a second submit while loading must use retry mechanism or `jest.requireMock` to call `executeQuery` directly — direct `userEvent.type(..., '{Enter}')` will be blocked.
- **Gotcha — `ConfidenceBadge` type**: `ConfidenceBadgeProps.level` is typed as `'high' | 'medium' | 'low'` — cast to `'high'` to pass an unknown string without TypeScript error: `{ level: 'unknown' as 'high' }`.
- **Gotcha — `next.config.mjs` import**: Jest in the web package is configured for ESM via `transform` options. If `import nextConfig from '../../next.config.mjs'` fails, use `jest.requireActual` or check `jest.config.js` transform settings. May need `@ts-ignore` for the import.
- **No `'use client'`** in test files — test files are Node.js/JSDOM, not browser modules.

---

## Acceptance Criteria

- [x] Bounded review of listed files complete, documented in findings
- [x] Traceability matrix filled (existing coverage vs gaps)
- [x] New tests for all identified gaps (F-012, F-016, F-017, F-020, F-022, F-023, F-024, F-025, F-026, F-027)
- [x] New tests for edge cases, accessibility, API client, route handler
- [x] All tests pass (32 suites, 325 tests — baseline 263 + 62 new)
- [x] Findings documented in P0/P1/P2 table (`docs/project_notes/qa-web-001-findings.md`)
- [x] Lint clean, typecheck clean
- [x] No P0 bugs found — 3 P1 + 8 P2 documented

---

## Definition of Done

- [x] New test files committed following existing naming convention (`*.qa-web-001.test.tsx`)
- [x] Net new tests cover every identified gap (62 new across 6 files)
- [x] Each confirmed defect documented in findings table with evidence
- [x] All quality gates pass (tests, lint, typecheck)
- [x] Findings table + recommendations complete

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated — cross-model reviewed (Gemini + Codex)
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `frontend-planner` executed, plan approved
- [x] Step 3: `frontend-developer` executed with TDD
- [x] Step 4: `production-code-validator` executed, quality gates pass
- [x] Step 5: `code-review-specialist` executed — APPROVED WITH NOTES (2 Medium fixed)
- [x] Step 5: `qa-engineer` executed — VERIFIED WITH NOTES (BUG-QA-013 added, F-020 comment fixed)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-11 | Step 0: Spec | spec-creator drafted spec. Cross-model review: Gemini (12 items, 9 accepted), Codex (10 items, 9.5 accepted). 17 corrections applied. |
| 2026-04-11 | Step 1: Setup | Branch qa/QA-WEB-001-exhaustive-web-testing. Ticket created with full spec + traceability matrix. |
| 2026-04-11 | Step 2: Plan | frontend-planner wrote 6-file implementation plan (~73 tests). Self-reviewed: adjusted ConfidenceBadge crash test to assert-throws pattern. |
| 2026-04-11 | Step 3: Implement | frontend-developer created 6 test files, 62 new tests. All 325 tests passing. |
| 2026-04-11 | Step 4: Finalize | production-code-validator: READY (zero issues). Lint clean. Typecheck clean. Findings: 0 P0, 3 P1, 8 P2. |
| 2026-04-11 | Step 5: Review | code-review-specialist: APPROVED WITH NOTES (2M fixed: empty waitFor, if/else assertions). qa-engineer: VERIFIED WITH NOTES (BUG-QA-013 added — null data guard gap, F-020 comment clarified). PR #99. |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Implementation Plan, AC, DoD, Workflow, Completion Log, Merge Checklist Evidence |
| 1. Mark all items | [x] | AC: 8/8, DoD: 5/5, Workflow: 7/8 (Step 6 pending) |
| 2. Verify product tracker | [x] | Active Session: step 5/6, PR #99 |
| 3. Update key_facts.md | [x] | N/A — QA task, no new infrastructure |
| 4. Update decisions.md | [x] | N/A |
| 5. Commit documentation | [x] | Commit: 6e33ec7 |
| 6. Verify clean working tree | [x] | `git status`: clean after commit |
| 7. Verify branch up to date | [x] | merge-base: up to date with develop |

---

*Ticket created: 2026-04-11*
