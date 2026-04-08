# F092: Web Assistant — Plate Photo Upload

**Feature:** F092 | **Type:** Frontend-Feature | **Priority:** High
**Status:** Planning | **Branch:** feature/F092-web-assistant-plate-photo-upload
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

**Missing env var (server-side):**
15. **`API_KEY` not set in Route Handler** — The Next.js Route Handler (`app/api/analyze/route.ts`) checks `process.env.API_KEY` and `process.env.NEXT_PUBLIC_API_URL` on every request. If either is missing, it returns 500 with `{ error: 'CONFIG_ERROR' }`. `sendPhotoAnalysis` does NOT check env vars (it sends to relative `/api/analyze`). HablarShell maps server 500 errors to `'Error de configuración. Contacta con soporte.'`

---

## Implementation Plan

### Existing Code to Reuse

- **`packages/web/src/lib/apiClient.ts`** — `ApiError` class and the fetch/error-handling patterns from `sendMessage`. The new `sendPhotoAnalysis` function is added to this same file.
- **`packages/web/src/lib/metrics.ts`** — `trackEvent` and `MetricEvent`/`MetricPayload` types. Only needs new event names and one new payload field.
- **`packages/web/src/lib/actorId.ts`** — `getActorId()` call pattern (unchanged).
- **`packages/web/src/components/LoadingState.tsx`** — Reused as-is for photo analysis loading (no `PhotoAnalysisLoadingState` needed per spec decision).
- **`packages/web/src/components/ResultsArea.tsx`** — The `CardGrid` helper and existing `NutritionCard` rendering. Receives a new optional `photoResults` prop; the photo dish loop mirrors the `menu_estimation` case.
- **`packages/web/src/components/NutritionCard.tsx`** — Receives `estimateData` (standard) or the new "not found" dish variant. No structural changes needed; a new `dishName` prop path for null-estimate cards requires a small conditional inside the component (or handled entirely in `ResultsArea`).
- **`packages/web/src/components/ConversationInput.tsx`** — `inlineError` rendering, `isLoading` disabled state. Two new props (`onPhotoSelect`, `isPhotoLoading`) are threaded through.
- **`packages/web/src/__tests__/fixtures.ts`** — New `createMenuAnalysisData` and `createMenuAnalysisResponse` factories added here alongside existing factories.
- **`packages/shared`** — `MenuAnalysisData`, `MenuAnalysisResponse`, `MenuAnalysisDish` types are already exported from `packages/shared/src/schemas/analysis.ts` via `index.ts`. No changes needed to shared package.

---

### Files to Create

| Path | Purpose |
|------|---------|
| `packages/web/src/app/api/analyze/route.ts` | Next.js Route Handler proxy — reads `API_KEY` server-side, proxies multipart `POST` to Fastify `POST /analyze/menu`, forwards `Content-Type` (multipart boundary), `X-Actor-Id` and `X-FXP-Source` headers, returns 500 CONFIG_ERROR if `API_KEY` or `NEXT_PUBLIC_API_URL` missing |
| `packages/web/src/__tests__/lib/apiClient.photo.test.ts` | Unit tests for `sendPhotoAnalysis` — request construction, FormData fields, headers, 65s timeout signal, all error codes, abort handling |
| `packages/web/src/__tests__/components/PhotoButton.photo.test.tsx` | Replaces the placeholder tests — active state props (`onFileSelect`, `isLoading`), file input trigger, same-file re-selection (value reset), `aria-label` update |
| `packages/web/src/__tests__/components/HablarShell.photo.test.tsx` | Integration tests for the photo flow end-to-end in `HablarShell` — file selection, validation errors (type/size), loading state, success rendering, API error mapping, stale-request abort |
| `packages/web/src/__tests__/api/analyze-route.test.ts` | Unit tests for the Route Handler — API key injection, `Content-Type` forwarding, `X-Actor-Id`/`X-FXP-Source` passthrough, error proxying, CONFIG_ERROR when `API_KEY` or `NEXT_PUBLIC_API_URL` missing |

---

### Files to Modify

| Path | What changes |
|------|-------------|
| `packages/web/src/lib/metrics.ts` | Add `'photo_sent' \| 'photo_success' \| 'photo_error'` to `MetricEvent` union; add `dishCount?: number` to `MetricPayload`; add handling for the three new events in `trackEvent` switch |
| `packages/web/src/lib/apiClient.ts` | Add `sendPhotoAnalysis(file, actorId, signal?)` exported function. Builds `FormData`, sends to `/api/analyze` (relative, same-origin — no env vars needed client-side), applies 65s `AbortSignal.timeout` merged with external signal, same `ApiError` error-parsing pattern as `sendMessage`. Add `isMenuAnalysisResponse` shape guard. No `CONFIG_ERROR` guard — env var validation belongs in the Route Handler only. |
| `packages/web/src/components/PhotoButton.tsx` | Activate from disabled placeholder to interactive button. Add `'use client'` directive. New props: `onFileSelect: (file: File) => void`, `isLoading?: boolean`. Add `useRef<HTMLInputElement>`. Add hidden `<input type="file">`. Update `aria-label`, remove `title`. Apply active-state Tailwind classes per spec. |
| `packages/web/src/components/ConversationInput.tsx` | Add `onPhotoSelect: (file: File) => void` and `isPhotoLoading?: boolean` props to interface. Pass `onFileSelect={onPhotoSelect}` and `isLoading={isPhotoLoading}` to `<PhotoButton>`. Disable textarea when `isPhotoLoading` is true (extend existing `disabled={isLoading}` to `disabled={isLoading \|\| isPhotoLoading}`). |
| `packages/web/src/components/ResultsArea.tsx` | Add `isPhotoLoading?: boolean` and `photoResults?: MenuAnalysisData \| null` props. When `isPhotoLoading` is true, render `<LoadingState>` (same as `isLoading`). When `photoResults` is set (and not loading), render `CardGrid` with `NutritionCard` per dish — if `dish.estimate` is non-null, use `estimateData={dish.estimate}`; if null, render a "not found" card showing `dishName` + `'Sin datos nutricionales disponibles.'` message. |
| `packages/web/src/components/HablarShell.tsx` | Add `photoMode: 'idle' \| 'analyzing'` state (spec has 3 states but 'uploading' is unnecessary — upload + analysis are one phase since there's no pre-upload preview) and `photoResults: MenuAnalysisData \| null` state. Add `executePhotoAnalysis(file: File)` callback with full validation + API call + error mapping logic (per spec flow). **Stale-request abort uses `controller.abort('stale_request')` reason** — catch block checks `signal.reason === 'stale_request'` to silently ignore, otherwise treats as CLIENT_TIMEOUT with user-facing message. **Cross-flow cleanup:** `executeQuery` (text) must call `setPhotoResults(null)` and `executePhotoAnalysis` must call `setResults(null)`. Wire `onPhotoSelect={executePhotoAnalysis}` and `isPhotoLoading={photoMode === 'analyzing'}` into `<ConversationInput>`. Pass `isPhotoLoading={photoMode === 'analyzing'}` and `photoResults={photoResults}` to `<ResultsArea>`. Import `sendPhotoAnalysis` from `apiClient`. Import `MenuAnalysisData` from `@foodxplorer/shared`. |
| `packages/web/src/__tests__/fixtures.ts` | Add `createMenuAnalysisDish`, `createMenuAnalysisData`, `createMenuAnalysisResponse` factory functions. |
| `packages/web/src/__tests__/components/PhotoButton.test.tsx` | Replace the existing 4 placeholder tests with the new active-state test suite (file moved to `PhotoButton.photo.test.tsx`). The old file tests the disabled state — update the single remaining test that checks the disabled prop is gone, or simply supersede the file entirely with the new test file. |
| `packages/web/src/__tests__/components/ConversationInput.test.tsx` | Update the `'renders PhotoButton (disabled placeholder)'` test — the aria-label changes to `'Subir foto del plato'` and the button is no longer always disabled. Update `renderInput` defaults to include `onPhotoSelect: jest.fn()`. |
| `packages/web/.env.local.example` | Add `API_KEY=fxp_<your-32-hex-chars-here>` with comment explaining it is server-only (not `NEXT_PUBLIC_`). |
| `docs/project_notes/key_facts.md` | Document `API_KEY` env var (web package, server-only, used by Route Handler proxy). Note deployment requirement: must be set in Vercel staging + prod. |

---

### Implementation Order

1. **`packages/web/src/__tests__/fixtures.ts`** — Add `createMenuAnalysisDish`, `createMenuAnalysisData`, `createMenuAnalysisResponse` factories. These are needed by all subsequent tests.

2. **`packages/web/src/lib/metrics.ts`** — Extend `MetricEvent`, `MetricPayload`, and the `trackEvent` switch. Tests in `metrics.test.ts` should be updated to cover the three new events.

3. **`packages/web/src/lib/apiClient.ts` + `packages/web/src/__tests__/lib/apiClient.photo.test.ts`** — TDD: write `sendPhotoAnalysis` tests first, then implement the function. Cover: FormData construction (`file` + `mode: 'identify'`), target URL `/api/analyze` (relative, same-origin — no env vars needed client-side), headers (`X-Actor-Id`, `X-FXP-Source`, no manual `Content-Type`, NO `X-API-Key`), 65s timeout signal (`AbortSignal.any([signal, AbortSignal.timeout(65000)])`), all API error codes, AbortError re-throw, shape guard for `MenuAnalysisResponse`. **No `CONFIG_ERROR` guard** — `sendPhotoAnalysis` always calls `/api/analyze` (relative); env var validation belongs in the Route Handler only.

4. **`packages/web/src/app/api/analyze/route.ts` + `packages/web/src/__tests__/api/analyze-route.test.ts`** — TDD: write Route Handler tests first, then implement. The handler reads `process.env.API_KEY` and `process.env.NEXT_PUBLIC_API_URL`. **Config guards:** return 500 with `CONFIG_ERROR` body if either env var is missing. Forwards the `Request` body as-is (multipart) via `request.body` passthrough with `duplex: 'half'`. **Must forward `Content-Type` header** from the incoming request unchanged (contains the multipart boundary — without it, Fastify cannot parse the upload). Injects `X-API-Key` header. Passes through `X-Actor-Id` and `X-FXP-Source`. Returns the upstream response body + status code. Tests: API key injected, `Content-Type` forwarded, actor/source headers passed through, 500 CONFIG_ERROR when `API_KEY` not set, 500 CONFIG_ERROR when `NEXT_PUBLIC_API_URL` not set.

5. **`packages/web/src/components/PhotoButton.tsx` + `packages/web/src/__tests__/components/PhotoButton.photo.test.tsx`** — TDD: write tests first (file input trigger on click, `onFileSelect` called with File, value reset, `isLoading` disables button, updated `aria-label`), then rewrite `PhotoButton` as an active interactive component with `'use client'`, `useRef<HTMLInputElement>`, hidden `<input type="file">`.

6. **`packages/web/src/components/ConversationInput.tsx` + update `ConversationInput.test.tsx`** — Add `onPhotoSelect` and `isPhotoLoading` props. Update `<PhotoButton>` usage. Extend textarea `disabled` condition. Update the aria-label test for PhotoButton and add `onPhotoSelect` to render defaults.

7. **`packages/web/src/components/ResultsArea.tsx` + update `ResultsArea.test.tsx`** — Add `isPhotoLoading` and `photoResults` props. Add loading branch and photo results rendering branch (with null-estimate "not found" card). Write tests for: `isPhotoLoading=true` shows `LoadingState`, `photoResults` with estimate renders `NutritionCard`, `photoResults` with `estimate=null` renders "not found" card with dish name.

8. **`packages/web/src/components/HablarShell.tsx` + `packages/web/src/__tests__/components/HablarShell.photo.test.tsx`** — TDD: write photo flow integration tests first (mock `sendPhotoAnalysis`), then wire the `executePhotoAnalysis` callback into `HablarShell`. Tests cover: valid file → loading state → `NutritionCard` rendered; invalid type → inline error, no API call; file > 10 MB → inline error, no API call; **empty `file.type` (older mobile) → allow through, no error** (spec edge case 14); cancel (no file) → no state change; API error codes → correct Spanish inline error; **stale-request abort (reason='stale_request') → silently ignored; timeout AbortError (no reason) → CLIENT_TIMEOUT message shown**; `photo_sent`/`photo_success`/`photo_error` events tracked; **cross-flow cleanup: text submit clears `photoResults`, photo submit clears text `results`**.

9. **`packages/web/.env.local.example` + `docs/project_notes/key_facts.md`** — Add `API_KEY` placeholder to `.env.local.example`. Document `API_KEY` in `key_facts.md` (server-only, web package, Route Handler proxy, must be set in Vercel staging + prod).

---

### Testing Strategy

**Test files to create:**
- `packages/web/src/__tests__/lib/apiClient.photo.test.ts`
- `packages/web/src/__tests__/components/PhotoButton.photo.test.tsx`
- `packages/web/src/__tests__/components/HablarShell.photo.test.tsx`
- `packages/web/src/__tests__/api/analyze-route.test.ts`

**Test files to update:**
- `packages/web/src/__tests__/fixtures.ts` — new factories
- `packages/web/src/__tests__/lib/metrics.test.ts` — cover 3 new events
- `packages/web/src/__tests__/components/ConversationInput.test.tsx` — update PhotoButton aria-label assertion, add `onPhotoSelect` to render defaults
- `packages/web/src/__tests__/components/PhotoButton.test.tsx` — existing tests will fail after the component rewrite; supersede with `PhotoButton.photo.test.tsx` or update in place
- `packages/web/src/__tests__/components/ResultsArea.test.tsx` — add `isPhotoLoading` and `photoResults` scenarios

**Key test scenarios:**

`apiClient.photo.test.ts`:
- Sends `POST` to `/api/analyze` (not the Fastify base URL)
- FormData contains `file` and `mode: 'identify'`
- Does NOT set `Content-Type` header manually (browser handles multipart boundary)
- Sets `X-Actor-Id` and `X-FXP-Source: web`; does NOT set `X-API-Key`
- Applies 65000ms timeout signal
- Throws `ApiError` with each code: `INVALID_IMAGE`, `MENU_ANALYSIS_FAILED`, `PAYLOAD_TOO_LARGE`, `RATE_LIMIT_EXCEEDED`, `UNAUTHORIZED`, `PROCESSING_TIMEOUT`
- Rethrows `AbortError` unwrapped
- Does NOT check any env vars (sends to relative `/api/analyze`)
- Throws `ApiError(MALFORMED_RESPONSE)` on wrong shape

`analyze-route.test.ts`:
- Appends `X-API-Key` from `process.env.API_KEY` to upstream request
- **Forwards `Content-Type` header unchanged** (multipart boundary must be preserved)
- Passes `X-Actor-Id` and `X-FXP-Source` through from the client request
- Returns 500 with `CONFIG_ERROR` body when `API_KEY` env var not set
- Returns 500 with `CONFIG_ERROR` body when `NEXT_PUBLIC_API_URL` env var not set
- Returns upstream response body + status code unchanged on success
- Returns upstream error body + status code unchanged on API error (422, 429, etc.)

`PhotoButton.photo.test.tsx`:
- Clicking button triggers click on the hidden file input (spy `inputRef.current.click`)
- `onChange` on file input calls `onFileSelect(file)`
- `input.value` is reset to `''` after file selection (allows same-file re-selection)
- `isLoading=true` disables button and applies `disabled` styling
- `isLoading=false` (default) leaves button enabled
- `aria-label="Subir foto del plato"` is set
- No `title` attribute present
- Hidden input has `accept="image/jpeg,image/png,image/webp"` and `capture="environment"`

`HablarShell.photo.test.tsx`:
- Selecting a JPEG file calls `sendPhotoAnalysis` and shows `LoadingState` while pending
- On success, renders `NutritionCard` for each dish in `photoResults`
- When `estimate === null`, renders "not found" card with dish name and `'Sin datos nutricionales disponibles.'`
- Selecting a file with invalid MIME type (`image/gif`) shows inline error, does NOT call `sendPhotoAnalysis`
- Selecting a file > 10 MB shows inline error, does NOT call `sendPhotoAnalysis`
- Selecting no file (empty `files`) does nothing
- `INVALID_IMAGE` API error → inline error `'Formato no soportado...'`
- `MENU_ANALYSIS_FAILED` → inline error `'No he podido identificar el plato...'`
- `RATE_LIMIT_EXCEEDED` → inline error `'Has alcanzado el límite...'`
- `UNAUTHORIZED` → inline error `'Error de configuración...'`
- `PROCESSING_TIMEOUT` (server 408) → inline error about timeout
- **Stale-request `AbortError` (reason='stale_request') → silently ignored, no error shown**
- **Timeout `AbortError` (no reason / 65s timeout) → CLIENT_TIMEOUT inline error shown**
- `NETWORK_ERROR` → inline error `'Sin conexión...'`
- Rapid second selection aborts the in-flight first request (with reason='stale_request')
- **Empty `file.type` (older mobile browsers) → allowed through, no validation error**
- **Text submission clears `photoResults`; photo submission clears text `results`**
- `trackEvent('photo_sent')` called on valid file
- `trackEvent('photo_success', { dishCount, responseTimeMs })` called on success
- `trackEvent('photo_error', { errorCode })` called on all errors
- During `photoMode === 'analyzing'`, textarea is disabled

**Mocking strategy:**
- `sendPhotoAnalysis` mocked via `jest.mock('../../lib/apiClient', ...)` — same pattern as `HablarShell.test.tsx` which already mocks `sendMessage`. Add `sendPhotoAnalysis: jest.fn()` to the same mock factory.
- `getActorId` mocked as in existing `HablarShell.test.tsx`.
- Route Handler tests mock `fetch` globally (same pattern as `apiClient.test.ts`) and stub `process.env.API_KEY`.
- Use `createMenuAnalysisData` / `createMenuAnalysisResponse` factories for consistent mock data.
- File objects created via `new File([new Uint8Array(100)], 'photo.jpg', { type: 'image/jpeg' })` for valid files and `new File([], 'doc.pdf', { type: 'application/pdf' })` for invalid ones. Simulate > 10 MB with `Object.defineProperty(file, 'size', { value: 11 * 1024 * 1024 })`.

---

### Key Patterns

**Route Handler proxy pattern** — does not yet exist in this project. Follow Next.js App Router docs: export a named `POST` function from `app/api/analyze/route.ts`. Read `request.body` as a `ReadableStream` and pass directly to `fetch`. **Must forward the `Content-Type` header** from the incoming request (contains the multipart boundary — without it Fastify cannot parse the upload). Use `new Request(upstreamUrl, { method: 'POST', headers: mergedHeaders, body: request.body, duplex: 'half' })` where `mergedHeaders` includes the original `Content-Type`, `X-API-Key`, `X-Actor-Id`, and `X-FXP-Source`. Return `new Response(upstreamResponse.body, { status, headers })`. Guard: return 500 CONFIG_ERROR if `API_KEY` or `NEXT_PUBLIC_API_URL` is missing.

**AbortSignal merging** — `sendPhotoAnalysis` must combine the external signal with the 65s timeout using `AbortSignal.any([signal, AbortSignal.timeout(65000)])`, mirroring exactly the pattern in `sendMessage` (but with 65000 instead of 15000).

**Abort reason differentiation** — When aborting a stale request (rapid re-selection), use `controller.abort('stale_request')`. In the catch block of `executePhotoAnalysis`, check: if `error.name === 'AbortError' && controller.signal.reason === 'stale_request'` → silently return. If `error.name === 'AbortError'` without that reason → it's the 65s timeout → show CLIENT_TIMEOUT error message.

**FormData + fetch** — Do NOT set `Content-Type` manually on FormData requests. The browser sets the correct `multipart/form-data; boundary=...` value automatically. Manually setting it breaks the boundary.

**File input reset** — After calling `onFileSelect(file)`, set `e.target.value = ''`. This is required so that selecting the same file a second time fires `onChange` again (the browser suppresses `onChange` if the value hasn't changed).

**`'use client'` directive** — `PhotoButton` must add `'use client'` because it uses `useRef`. `ConversationInput` already has it. `ResultsArea` and `HablarShell` already have it / don't need it as Server Component respectively (`ResultsArea` is currently a Server Component — it does NOT have `'use client'` and that is correct; adding `photoResults` prop does not change this since it only receives data).

**Client-side MIME validation** — Reject known unsupported non-empty MIME types (anything not in `image/jpeg`, `image/png`, `image/webp`). **Allow empty `file.type` through** (older mobile browsers may return `''` for valid photos — let the API validate magic bytes and return `INVALID_IMAGE` if unsupported). This matches spec edge case 14.

**Null-estimate card rendering** — Handle `dish.estimate === null` in `ResultsArea` directly rather than adding a new prop to `NutritionCard`. Render a simple inline fallback `<article>` with the `dishName` and the "no data" message, matching the existing card visual style (`rounded-2xl border border-slate-100 bg-white p-4 shadow-soft`).

**Existing test structure** — All test files live in `packages/web/src/__tests__/`. New files follow the same flat structure under `components/`, `lib/`, and a new `api/` sub-directory for the route handler tests. Module mocks use relative paths (`../../lib/apiClient`), never `@/` aliases.

**`ConversationInput` default props in tests** — After adding `onPhotoSelect` as a required prop, the `renderInput` helper in `ConversationInput.test.tsx` must include `onPhotoSelect: jest.fn()` in its `defaults` object, otherwise existing tests will get a TypeScript error.

---

## Acceptance Criteria

- [x] Tapping the camera button in `/hablar` opens the OS file/media picker (mobile browsers may offer camera capture via `capture="environment"` hint)
- [x] A photo is successfully sent to `POST /analyze/menu` via the Next.js Route Handler proxy with `mode=identify` (API key attached server-side)
- [x] On success, at least one `NutritionCard` is rendered in the `ResultsArea` with the identified dish's nutritional data
- [x] When `estimate === null`, the card displays the dish name with a "no data" message (not a crash or missing card)
- [x] Selecting a file > 10 MB shows inline error `'La foto es demasiado grande. Máximo 10 MB.'` and does not call the API
- [x] Selecting a non-image file (e.g. PDF) shows inline error about unsupported format and does not call the API
- [x] Cancelling the file picker (no file selected) does nothing — no error shown
- [x] During photo analysis, the button and textarea are disabled and a loading state is shown
- [x] API errors (INVALID_IMAGE, MENU_ANALYSIS_FAILED, RATE_LIMIT_EXCEEDED) are shown as inline errors in Spanish
- [x] Re-selecting the same photo after a first analysis fires a new request (input.value reset)
- [x] A rapid second photo selection aborts the in-flight first request (stale request guard)
- [x] `photo_sent`, `photo_success`, `photo_error` events are tracked via `metrics.ts`
- [x] `API_KEY` (server-only, NOT `NEXT_PUBLIC_`) is added to `.env.local.example` with a placeholder value
- [x] Next.js Route Handler at `/api/analyze` proxies multipart requests with server-side API key
- [x] `PhotoButton` is `aria-label="Subir foto del plato"` (not "próximamente")
- [x] Unit tests for `sendPhotoAnalysis` (mock fetch), client-side validation logic, and `PhotoButton` file-input trigger (240 tests total)
- [x] All tests pass (240/240)
- [x] Build succeeds
- [x] Specs updated (`ui-components.md` updated with F092 section)

---

## Definition of Done

- [x] All acceptance criteria met (19/19)
- [x] Unit tests written and passing (240/240)
- [x] E2E tests updated (if applicable) — N/A
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds
- [x] Specs reflect final implementation

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `frontend-planner` executed, plan approved
- [x] Step 3: `frontend-developer` executed with TDD
- [x] Step 4: `production-code-validator` executed, quality gates pass
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 5: `qa-engineer` executed (Standard/Complex)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-08 | Spec created | spec-creator agent |
| 2026-04-08 | Spec review | Reviewed by Gemini + Codex. 1 CRITICAL + 5 IMPORTANT + 3 SUGGESTION. All addressed: Route Handler proxy (no client-side API key), 65s client timeout, Option A locked, LoadingState reuse, PROCESSING_TIMEOUT code, actor rate limit, mobile picker AC, partial results copy, iOS HEIC note |
| 2026-04-08 | Plan created | frontend-planner agent — 9 implementation steps |
| 2026-04-08 | Plan review | Reviewed by Gemini + Codex. 2 CRITICAL + 3 IMPORTANT + 2 SUGGESTION. All addressed: Content-Type forwarding in proxy, remove client-side env checks, abort reason differentiation (stale vs timeout), cross-flow state cleanup, key_facts.md documentation, empty file.type edge case, photoMode simplification documented |
| 2026-04-08 | Implementation | frontend-developer agent — 9 steps TDD. 240 tests, build OK |
| 2026-04-08 | Finalize | production-code-validator: 1 CRITICAL (spec drift NEXT_PUBLIC_API_KEY→API_KEY in ui-components.md). Fixed. Quality gates: 240/240 tests, 0 lint warnings, build OK |

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
