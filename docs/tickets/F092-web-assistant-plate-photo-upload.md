# F092: Web Assistant — Plate Photo Upload

**Feature:** F092 | **Type:** Frontend-Feature | **Priority:** High
**Status:** Spec | **Branch:** feature/F092-web-assistant-plate-photo-upload
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-04-08 | **Dependencies:** F090 (HablarShell text mode), F034 (POST /analyze/menu API)

---

## Spec

### Description

F092 enables photo upload in the web assistant at `/hablar`. The existing `PhotoButton` component is a disabled placeholder added in F090; this feature activates it.

The user selects a photo of a plate or menu from their device (camera capture on mobile, file picker on desktop). The photo is sent to the existing `POST /analyze/menu` API endpoint using `mode=identify` for single-dish photos. The API runs the Vision pipeline (gpt-4o-mini), identifies the dish name, runs `runEstimationCascade`, and returns `MenuAnalysisData`. The web client renders the results using the existing `NutritionCard` components, mapping `MenuAnalysisData.dishes` into the same `ResultsArea` used for text queries.

**Why this matters (product-evolution-analysis-2026-03-31.md, Phase C):**
F092 is listed as a 3-day Phase C feature. It delivers the "point your camera at a plate" experience — a core differentiator for the web assistant. It reuses the existing Vision API infrastructure with no new API endpoints required.

**Key architectural constraint — API key (server-side proxy):**
`POST /analyze/menu` requires an API key (`X-API-Key` header). Exposing the key client-side (`NEXT_PUBLIC_`) would share a single key across all users, creating a global rate limit bottleneck and allowing attackers to extract the key from browser DevTools.

**Solution: Next.js Route Handler proxy.** Create `app/api/analyze/route.ts` in the web package. The browser sends the photo to this Next.js route (same origin, no CORS). The route handler attaches the private `API_KEY` (server-only env var, NOT `NEXT_PUBLIC_`) and proxies the multipart request to the Fastify API. This keeps the key server-side and allows per-actor rate limiting.

**Flow summary:**
1. User taps camera icon in `ConversationInput`
2. Hidden `<input type="file">` opens with `accept="image/jpeg,image/png,image/webp"` and `capture="environment"` on mobile
3. User selects/captures image
4. `HablarShell` validates: file type (JPEG/PNG/WebP only), file size (≤ 10 MB)
5. Client-side validation passes → `sendPhotoAnalysis(file, actorId, signal)` called
6. `POST /analyze/menu` multipart request: `{ file, mode: "identify" }`
7. `MenuAnalysisData` response → `HablarShell` stores in `photoResults` state and passes to `ResultsArea`
8. `ResultsArea` renders `NutritionCard` per dish (same as `menu_estimation` intent)

### API Changes

No new API endpoints. F092 is a pure frontend integration with the existing `POST /analyze/menu` endpoint (F034).

**Reference in `docs/specs/api-spec.yaml`:** `operationId: analyzeMenu` at `/analyze/menu`.

Key contract facts for the web client:
- **Method:** `POST /analyze/menu`
- **Auth:** `X-API-Key` header required (public key, not admin)
- **Request:** `multipart/form-data`, fields: `file` (binary, max 10 MB) + `mode` (string, use `"identify"`)
- **Response:** `MenuAnalysisResponse` → `{ success: true, data: MenuAnalysisData }`
  - `data.mode` — echoes `"identify"`
  - `data.dishCount` — always 1 in identify mode
  - `data.partial` — boolean (true if 60s timeout hit mid-processing)
  - `data.dishes[0].dishName` — string, the identified dish name
  - `data.dishes[0].estimate` — `EstimateData | null` (null = dish not found in DB)
- **Timeout:** Server cooperatively times out at 60 seconds (may return `partial: true`). Web client must set a **65-second** `AbortSignal` (5s grace period so the server can transmit partial results before the client aborts).
- **Error codes relevant to the client:**
  - `422 INVALID_IMAGE` — unsupported format or magic bytes mismatch
  - `422 MENU_ANALYSIS_FAILED` — Vision API failed AND OCR fallback returned 0 dishes
  - `413 PAYLOAD_TOO_LARGE` — file > 10 MB
  - `429 RATE_LIMIT_EXCEEDED` — 10 analyses/hour per API key exceeded
  - `401 UNAUTHORIZED` — missing or invalid API key
  - `408 PROCESSING_TIMEOUT` — request timed out (unlikely with 60s client timeout)

**New env var required (web package, server-only):**
```
API_KEY=fxp_<32 hex chars>
```
NOT `NEXT_PUBLIC_` — this key is only read in the Next.js Route Handler (server-side). Must be added to: `.env.local.example`, Vercel project env vars (staging + prod), and documented in `key_facts.md`.

**New env var required (web package):**
```
NEXT_PUBLIC_API_URL=http://localhost:3001
```
The API base URL (already exists from F090). Used by the Route Handler to proxy to Fastify.

### Data Model Changes

None. No DB writes. `POST /analyze/menu` is stateless.

### UI Changes

Reference: `docs/specs/ui-components.md` — Web Package section.

#### Updated Component Hierarchy

```
app/hablar/page.tsx (Server Component — unchanged)
└── HablarShell (Client Component — expanded state)
    ├── AppBar (unchanged)
    ├── ResultsArea (unchanged — already handles menu_estimation intent)
    │   ├── EmptyState
    │   ├── LoadingState
    │   ├── ErrorState
    │   ├── PhotoAnalysisLoadingState  ← NEW (longer wait UX for Vision API)
    │   └── [NutritionCard...]
    └── ConversationInput (receives onPhotoSelect callback)
        ├── <textarea>
        ├── PhotoButton  ← ACTIVATED (was disabled placeholder)
        │   └── <input type="file" hidden>
        ├── MicButton (unchanged — still disabled)
        └── SubmitButton
```

#### Updated: HablarShell

**New state fields:**
- `photoMode: 'idle' | 'uploading' | 'analyzing'` — tracks photo upload lifecycle
- `photoError: string | null` — client-side validation errors (format/size) and API errors for photo flow, displayed inline in `ConversationInput` (same `inlineError` prop — no new error area needed)

**New interaction: executePhotoAnalysis(file: File)**
```
1. Validate: file.type ∈ {image/jpeg, image/png, image/webp} → else setInlineError(...)
2. Validate: file.size ≤ 10 * 1024 * 1024 → else setInlineError(...)
3. Abort any in-flight text request (currentRequestRef.current?.abort())
4. setPhotoMode('analyzing'), setError(null), setInlineError(null), setResults(null)
5. const controller = new AbortController()
6. currentRequestRef.current = controller
7. trackEvent('photo_sent')
8. const startTime = Date.now()
9. response = await sendPhotoAnalysis(file, actorId, controller.signal)
10. if (controller.signal.aborted) return
11. Map MenuAnalysisData → display in ResultsArea (see ResultsArea spec below)
12. trackEvent('photo_success', { dishCount: data.dishCount, responseTimeMs: ... })
13. setPhotoMode('idle')
```

**Error mapping (photo path):**
- `INVALID_IMAGE` → `'Formato no soportado. Usa JPEG, PNG o WebP.'`
- `MENU_ANALYSIS_FAILED` → `'No he podido identificar el plato. Intenta con otra foto.'`
- `PAYLOAD_TOO_LARGE` → `'La foto es demasiado grande. Máximo 10 MB.'`
- `RATE_LIMIT_EXCEEDED` → `'Has alcanzado el límite de análisis por foto. Inténtalo más tarde.'`
- `UNAUTHORIZED` → `'Error de configuración. Contacta con soporte.'` (API key misconfigured)
- `PROCESSING_TIMEOUT` (server 408) → `'El análisis ha tardado demasiado. Inténtalo de nuevo.'`
- `CLIENT_TIMEOUT` (client AbortError after 65s) → same message as PROCESSING_TIMEOUT
- `NETWORK_ERROR` → `'Sin conexión. Comprueba tu red.'`
- Generic → `'No se pudo analizar la foto. Inténtalo de nuevo.'`

Photo errors are shown via `inlineError` in `ConversationInput` (same mechanism as `text_too_long`). The full-screen `ErrorState` is NOT used for photo errors — they are transient and the user should try again without a retry button.

**New prop to ConversationInput:**
- `onPhotoSelect: (file: File) => void` — called when the user selects a valid file from the OS picker

**Layout change:** While `photoMode === 'analyzing'`, the `ConversationInput` should show a "Analizando foto..." disabled state (same visual as `isLoading` for text).

#### Updated: PhotoButton

**Type:** Primitive | **Client:** Yes (`'use client'`) — needs to trigger file input
**File:** `src/components/PhotoButton.tsx`

The `disabled` placeholder becomes an interactive button. The hidden `<input type="file">` is owned by `PhotoButton` and referenced via `useRef`.

**Props (new interface):**

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| onFileSelect | `(file: File) => void` | Yes | — | Called with the selected File object |
| isLoading | `boolean` | No | `false` | Disables the button during photo analysis |

**Behavior:**
- Button click → `inputRef.current?.click()` (programmatic click on the hidden input)
- `<input type="file" hidden>` attributes: `accept="image/jpeg,image/png,image/webp"`, `capture="environment"` (hints camera on mobile, ignored on desktop)
- `onChange` on input → read `e.target.files?.[0]` → call `onFileSelect(file)` → reset `input.value = ''` (allows re-selecting the same file)
- When `isLoading=true`: button is `disabled`, `cursor-not-allowed`, reduced opacity

**Active state styling:**
```
rounded-xl w-12 h-12 border border-brand-green bg-white text-brand-green
hover:bg-emerald-50 active:scale-[0.97] transition-all duration-200
disabled:opacity-40 disabled:pointer-events-none disabled:border-slate-200 disabled:text-slate-400
```

**Accessibility:**
- `aria-label="Subir foto del plato"` (was `"Foto (próximamente)"`)
- Remove `title="Próximamente"`
- `type="button"` to prevent accidental form submission

#### Updated: ConversationInput

**New prop:**

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| onPhotoSelect | `(file: File) => void` | Yes | — | Passed through to PhotoButton |
| isPhotoLoading | `boolean` | No | `false` | Passed to PhotoButton.isLoading |

`PhotoButton` changes from `<PhotoButton />` (no props) to `<PhotoButton onFileSelect={onPhotoSelect} isLoading={isPhotoLoading} />`.

When `isPhotoLoading=true`, the `<textarea>` is also disabled (same as text `isLoading`).

#### New: PhotoAnalysisLoadingState

**Type:** Feature | **Client:** No (Server Component)
**File:** `src/components/PhotoAnalysisLoadingState.tsx`

Shown in `ResultsArea` during `photoMode === 'analyzing'`. Vision API calls take 5–15 seconds — the standard `LoadingState` (which shows skeleton cards) is appropriate to reuse. However, an "Analizando foto..." caption below the skeleton cards differentiates the experience.

**Props:**
| Prop | Type | Required | Description |
|------|------|----------|-------------|
| caption | `string` | No | Optional label below skeletons (default: `"Analizando foto..."`) |

**Decision: Reuse `LoadingState` as-is** with `isLoading` set to `true` during photo analysis. Do NOT create `PhotoAnalysisLoadingState` — the standard skeleton is sufficient. The 5–15s wait is acceptable without a custom caption.

#### Updated: ResultsArea

**New prop:**

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| isPhotoLoading | `boolean` | No | `false` | True during photo analysis — shows loading state |

`ResultsArea` currently checks `isLoading` to show `LoadingState`. When `isPhotoLoading=true`, it also shows the loading state (or `PhotoAnalysisLoadingState` if implemented).

**Photo result rendering:**
`MenuAnalysisData` from `POST /analyze/menu` is NOT the same type as `ConversationMessageData` from `POST /conversation/message`. The `HablarShell` must map it:

```
MenuAnalysisData.dishes[] → Array of EstimateData | null
```

**Rendering approach (fixed — Option A):** Store `MenuAnalysisData` in a separate `photoResults` state field. `ResultsArea` receives a new optional prop `photoResults: MenuAnalysisData | null`. When set, it renders `NutritionCard` per dish using the dish's `estimate` data. This avoids shoehorning `MenuAnalysisData` into `ConversationMessageData` (which uses `estimation` intent, not `menu_estimation`).

**When `estimate === null`:** Render a `NutritionCard` in "not found" state — show `dishName` with message `'Sin datos nutricionales disponibles.'` below. Do NOT crash or skip the card.

#### New: apiClient function — sendPhotoAnalysis

**File:** `packages/web/src/lib/apiClient.ts` (new exported function in existing file)

```typescript
// Sends a plate/menu photo to POST /analyze/menu.
// mode is always "identify" for single-dish photos (F092).
// Returns MenuAnalysisResponse.
// Timeout: 60 seconds (Vision API + cascade).
// Requires NEXT_PUBLIC_API_KEY to be set.
export async function sendPhotoAnalysis(
  file: File,
  actorId: string,
  signal?: AbortSignal,
): Promise<MenuAnalysisResponse>
```

**Implementation notes for spec:**
- Builds `FormData`: `formData.append('file', file)`, `formData.append('mode', 'identify')`
- **Sends to the Next.js Route Handler** (`/api/analyze`), NOT directly to the Fastify API
- Headers: `X-Actor-Id: actorId`, `X-FXP-Source: web` (NO `X-API-Key` — the Route Handler adds it server-side)
- **No** `Content-Type` header set manually (browser sets `multipart/form-data` boundary automatically)
- Timeout: `AbortSignal.timeout(65000)` merged with external `signal` (65s > server's 60s)
- Error handling: same `ApiError` pattern as `sendMessage` (non-2xx → parse error code from body)
- Response validation: shape guard checking `success === true && data !== undefined`

**Next.js Route Handler (`app/api/analyze/route.ts`):**
- Reads `API_KEY` from `process.env` (server-only)
- Proxies multipart request to `${NEXT_PUBLIC_API_URL}/analyze/menu` with `X-API-Key` header
- Passes through `X-Actor-Id` and `X-FXP-Source` headers from the client
- Returns the API response as-is (status code, body)

**New type import:**
`MenuAnalysisResponse` must be importable from `@foodxplorer/shared`. If it is not yet exported from shared, this is a prerequisite task for the planner (export from `packages/shared/src/index.ts`).

#### Metrics — new events

The existing `MetricEvent` union in `packages/web/src/lib/metrics.ts` must be extended:

| Event | Trigger | Payload |
|-------|---------|---------|
| `photo_sent` | User selects a valid photo and analysis starts | — |
| `photo_success` | API returns successfully | `{ dishCount: number, responseTimeMs: number }` |
| `photo_error` | Any error (validation or API) | `{ errorCode: string }` |

`MetricPayload` interface needs `dishCount?: number` added.

### Edge Cases & Error Handling

**Client-side validation (before API call):**
1. **Invalid file type** — user selects a `.gif`, `.heic`, `.pdf`, etc.: Show inline error `'Formato no soportado. Usa JPEG, PNG o WebP.'` Do NOT send to API.
2. **File too large (> 10 MB)** — Show inline error `'La foto es demasiado grande. Máximo 10 MB.'` Do NOT send to API.
3. **No file selected** — User opens picker and cancels: `e.target.files` is empty or null. Do nothing — no error shown.
4. **Rapid re-selection** — User picks a photo, then immediately picks another: `input.value = ''` reset after each selection ensures `onChange` fires for repeated selections of the same file. The first in-flight request should be aborted via `AbortController` (same stale-request guard as text mode).

**API errors:**
5. **INVALID_IMAGE (422)** — Magic bytes mismatch (e.g., renamed .gif as .jpg): Show `'Formato no soportado. Usa JPEG, PNG o WebP.'`
6. **MENU_ANALYSIS_FAILED (422)** — Vision API failed, OCR fallback produced 0 dishes: Show `'No he podido identificar el plato. Intenta con otra foto.'`
7. **PAYLOAD_TOO_LARGE (413)** — File slipped through client-side size check or multipart framing overhead: Show `'La foto es demasiado grande. Máximo 10 MB.'`
8. **RATE_LIMIT_EXCEEDED (429)** — Per-API-key limit (10/hour) OR per-actor limit exceeded: Show `'Has alcanzado el límite de análisis por foto. Inténtalo más tarde.'` Note: the API applies both key-level and actor-level rate limits (per ADR-016). The web client receives the same 429 response in both cases.
9. **UNAUTHORIZED (401)** — `NEXT_PUBLIC_API_KEY` missing or invalid: Show generic config error. This should never happen in production if env vars are set correctly.
10. **Network failure / AbortError** — Show `'Sin conexión. Comprueba tu red.'` / silently ignore abort.
11. **Timeout (65s client / 60s server)** — If the server returns `408 PROCESSING_TIMEOUT`, show timeout message. If the client's 65s abort fires first (edge case — network delay), treat as `CLIENT_TIMEOUT` with same message.

**Partial results:**
12. **`data.partial === true`** — API returned results but timed out mid-processing. Show results as-is. Since F092 uses `mode=identify` (single dish), partial results are unlikely but possible. No special banner needed — just render what was returned.

**Zero-estimate result:**
13. **`data.dishes[0].estimate === null`** — Vision identified a dish name but cascade found no nutritional data. Show a `NutritionCard` in a "not found" variant, or use the existing empty/unknown state pattern. The card should show the dish name with a message like `'Sin datos nutricionales disponibles.'`

**HEIC / WebP from iPhone:**
14. iOS Safari may produce `image/heic` from the camera when `capture="environment"` is used without explicit `accept`. The `accept="image/jpeg,image/png,image/webp"` attribute mitigates this for most browsers, but iOS may still pass HEIC through. Client-side MIME check (`file.type`) will catch it. Note: `file.type` may return `''` (empty string) on some older mobile browsers — in this case, allow the file through and let the API return `INVALID_IMAGE` if the magic bytes are unsupported.

**Missing env var:**
15. **`NEXT_PUBLIC_API_KEY` not set** — `sendPhotoAnalysis` should throw an `ApiError` with code `'CONFIG_ERROR'` and message `'NEXT_PUBLIC_API_KEY is not defined.'` before making any fetch call. HablarShell maps this to `'Error de configuración. Contacta con soporte.'`

---

## Implementation Plan

_Pending — to be generated by the planner agent in Step 2._

---

## Acceptance Criteria

- [ ] Tapping the camera button in `/hablar` opens the OS file/media picker (mobile browsers may offer camera capture via `capture="environment"` hint)
- [ ] A photo is successfully sent to `POST /analyze/menu` via the Next.js Route Handler proxy with `mode=identify` (API key attached server-side)
- [ ] On success, at least one `NutritionCard` is rendered in the `ResultsArea` with the identified dish's nutritional data
- [ ] When `estimate === null`, the card displays the dish name with a "no data" message (not a crash or missing card)
- [ ] Selecting a file > 10 MB shows inline error `'La foto es demasiado grande. Máximo 10 MB.'` and does not call the API
- [ ] Selecting a non-image file (e.g. PDF) shows inline error about unsupported format and does not call the API
- [ ] Cancelling the file picker (no file selected) does nothing — no error shown
- [ ] During photo analysis, the button and textarea are disabled and a loading state is shown
- [ ] API errors (INVALID_IMAGE, MENU_ANALYSIS_FAILED, RATE_LIMIT_EXCEEDED) are shown as inline errors in Spanish
- [ ] Re-selecting the same photo after a first analysis fires a new request (input.value reset)
- [ ] A rapid second photo selection aborts the in-flight first request (stale request guard)
- [ ] `photo_sent`, `photo_success`, `photo_error` events are tracked via `metrics.ts`
- [ ] `API_KEY` (server-only, NOT `NEXT_PUBLIC_`) is added to `.env.local.example` with a placeholder value
- [ ] Next.js Route Handler at `/api/analyze` proxies multipart requests with server-side API key
- [ ] `PhotoButton` is `aria-label="Subir foto del plato"` (not "próximamente")
- [ ] Unit tests for `sendPhotoAnalysis` (mock fetch), client-side validation logic, and `PhotoButton` file-input trigger
- [ ] All tests pass
- [ ] Build succeeds
- [ ] Specs updated (`ui-components.md` updated with F092 section)

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
- [ ] Step 2: `frontend-planner` executed, plan approved
- [ ] Step 3: `frontend-developer` executed with TDD
- [ ] Step 4: `production-code-validator` executed, quality gates pass
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 5: `qa-engineer` executed (Standard/Complex)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-08 | Spec created | spec-creator agent |
| 2026-04-08 | Spec review | Reviewed by Gemini + Codex. 1 CRITICAL + 5 IMPORTANT + 3 SUGGESTION. All addressed: Route Handler proxy (no client-side API key), 65s client timeout, Option A locked, LoadingState reuse, PROCESSING_TIMEOUT code, actor rate limit, mobile picker AC, partial results copy, iOS HEIC note |

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

*Ticket created: 2026-04-08*
