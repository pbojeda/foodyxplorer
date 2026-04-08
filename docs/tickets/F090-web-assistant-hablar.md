# F090: Web Assistant — Shell + Text Mode (/hablar)

**Feature:** F090 | **Type:** Frontend-Feature | **Priority:** High
**Status:** Ready for Merge | **Branch:** feature/F090-web-assistant-hablar
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-04-08 | **Dependencies:** F070 (ConversationCore), F069 (ActorID middleware)

---

## Spec

### Description

F090 creates `packages/web`, a new Next.js 15 App Router package in the monorepo. It contains a single `/hablar` route — the nutriXplorer conversational web assistant. Users type natural language nutrition queries and receive structured NutritionCard results. The interface is a query→results tool (NOT a chat UI) that operates as a thin client over the existing `POST /conversation/message` API.

**Primary use context:** mobile browser, user at a restaurant table.
**Design principle:** The result is the hero, not the interface. Minimal chrome. Nutrition data pops.

The `/hablar` shell is designed to accommodate future Voice (F091) and Photo (F092) modes — the input bar has placeholder slots for mic and photo buttons — but F090 implements text mode only.

**Package separation rationale:** `packages/web` is distinct from `packages/landing`. Landing is a marketing/conversion site; Web is the operational product tool. They share the same design token system but are different Next.js applications deployed independently.

---

### API Contract

F090 consumes the existing `POST /conversation/message` endpoint. **One minor backend change required:** the CORS plugin (`packages/api/src/plugins/cors.ts`) must add `exposedHeaders: ['X-Actor-Id']` so the browser can read the response header cross-origin, and add `localhost:3002` to the development origin allowlist. This is a 2-line change, not a new feature.

**Endpoint:** `POST /conversation/message`
**Spec reference:** `docs/specs/api-spec.yaml` — path `/conversation/message`, operationId `processConversationMessage`

**Request:**
```
POST https://api.nutrixplorer.com/conversation/message
Content-Type: application/json
X-Actor-Id: <uuid>   (anonymous actor UUID — see Actor ID Management below)

{
  "text": "cuántas calorías tiene el big mac"
}
```

The `chainSlug` / `chainName` legacy fields are omitted from F090 requests. The web client does not manage restaurant context in F090 — that comes later.

The client MUST also send `X-FXP-Source: web` header on every request for analytics tracking (the API uses this to categorize traffic by source: `api`, `bot`, `web`).

**Success Response (`200`):**
```json
{
  "success": true,
  "data": {
    "intent": "estimation",
    "actorId": "a1b2c3d4-...",
    "activeContext": null,
    "estimation": {
      "query": "big mac",
      "chainSlug": "mcdonalds-es",
      "portionMultiplier": 1.0,
      "level1Hit": true,
      "level2Hit": false,
      "level3Hit": false,
      "level4Hit": false,
      "matchType": "exact_dish",
      "result": {
        "entityType": "dish",
        "entityId": "...",
        "name": "Big Mac",
        "nameEs": "Big Mac",
        "chainSlug": "mcdonalds-es",
        "portionGrams": 200,
        "nutrients": {
          "calories": 550,
          "proteins": 25,
          "carbohydrates": 46,
          "fats": 28,
          "fiber": 3,
          "sugars": 9,
          "saturatedFats": 10,
          "salt": 2.2
        },
        "confidenceLevel": "high",
        "allergens": []
      },
      "source": { "name": "McDonald's España", "type": "official_chain", "url": "..." }
    }
  }
}
```

**Intent variants the web client must handle:**

| Intent | Data field present | UI response |
|--------|-------------------|-------------|
| `estimation` | `data.estimation` | Render one NutritionCard |
| `comparison` | `data.comparison` (dishA + dishB) | Render two NutritionCards side by side |
| `menu_estimation` | `data.menuEstimation.items[]` | Render one NutritionCard per item + totals card |
| `context_set` | `data.contextSet` or `data.ambiguous` | Show confirmation toast ("Contexto: [chain]") or ambiguity message |
| `reverse_search` | `data.reverseSearch` | Render result cards from filter |
| `text_too_long` | none | Show error: "Tu consulta es demasiado larga (máx. 500 caracteres)" |

**Error Responses:**

| HTTP | Code | Web client action |
|------|------|------------------|
| `400` | `VALIDATION_ERROR` | Show inline error in input bar |
| `429` | `RATE_LIMIT_EXCEEDED` | Show ErrorState: "Has alcanzado el límite diario (50 consultas)" |
| `500` | `INTERNAL_ERROR` | Show ErrorState with retry |
| Network failure | — | Show ErrorState: "Sin conexión. Comprueba tu red." |

**API Base URLs:**
- Staging: `https://api-dev.nutrixplorer.com`
- Production: `https://api.nutrixplorer.com`
- Configured via environment variable: `NEXT_PUBLIC_API_URL`

**Actor ID Management:**
- On first visit, generate a `crypto.randomUUID()` and persist to `localStorage` under key `nxi_actor_id`.
- Read from `localStorage` on every subsequent request.
- Pass as `X-Actor-Id` header on every API call.
- **Server fallback:** If the client sends no `X-Actor-Id` (or an invalid one), the API middleware generates a UUID and returns it in the `X-Actor-Id` **response** header. The client MUST read this response header on every call and persist it to `localStorage` if different from the current value — this handles the edge case where localStorage was cleared or unavailable on the first request.
- If `localStorage` is unavailable (SSR, private browsing), generate a session-scoped UUID in memory (does not persist across tabs).
- **ADR-016 deviation:** ADR-016 specifies "localStorage + signed HTTP-only cookie" for web identity. F090 implements localStorage + header transport only. The HTTP-only cookie mechanism is deferred — it requires complex cross-domain cookie setup between the Next.js and Fastify domains that is not justified until SSR data fetching is needed. ADR-016 should be amended to reflect this phased approach.

**Conversation ID:**
- The API does not return a `conversationId` field — context continuity is maintained server-side via the Redis `conv:ctx:{actorId}` key, not a client conversation ID.
- The client does NOT need to manage or send a conversation ID. The `actorId` is sufficient for context continuity.

---

### Data Model Changes

None. No database or schema changes. All data is owned by the existing API.

---

### UI Changes

**Package:** `packages/web` (new Next.js 15 App Router package)
**Stack:** Next.js 15 + TypeScript strict + Tailwind CSS (no Framer Motion in F090)
**Spec reference:** `docs/specs/ui-components.md` — section "Web Package — nutriXplorer (/hablar, F090)"
**Design reference:** `docs/specs/hablar-design-guidelines.md`

#### Package Structure

```
packages/web/
├── src/
│   ├── app/
│   │   ├── layout.tsx           — root layout (Inter font, metadata)
│   │   ├── page.tsx             — redirects / → /hablar
│   │   └── hablar/
│   │       └── page.tsx         — /hablar route (server shell, loads client)
│   ├── components/
│   │   ├── HablarShell.tsx      — main client shell ('use client')
│   │   ├── ConversationInput.tsx
│   │   ├── MicButton.tsx
│   │   ├── PhotoButton.tsx
│   │   ├── SubmitButton.tsx
│   │   ├── NutritionCard.tsx
│   │   ├── ConfidenceBadge.tsx
│   │   ├── AllergenChip.tsx
│   │   ├── LoadingState.tsx
│   │   ├── EmptyState.tsx
│   │   └── ErrorState.tsx
│   ├── lib/
│   │   ├── apiClient.ts         — fetch wrapper for POST /conversation/message
│   │   └── actorId.ts           — localStorage UUID management
│   └── styles/
│       └── globals.css          — shimmer + card-enter keyframe definitions
├── package.json
├── next.config.mjs
├── tailwind.config.ts
└── tsconfig.json
```

#### Component Specifications

**HablarShell** — top-level client orchestrator
- `'use client'` — manages all page state
- State: `query`, `isLoading`, `results: ConversationMessageData | null`, `error: string | null`
- Layout: `h-[100dvh] flex flex-col bg-white`
- Renders: AppBar → ResultsArea → ConversationInput (fixed bottom)
- On submit: calls `apiClient.sendMessage(text, actorId)`, sets loading, renders results or error on resolve

**ConversationInput** — fixed bottom input bar
- `position: fixed bottom-0 left-0 right-0`
- `bg-white border-t border-slate-200 px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom))]`
- Inner row: `<textarea>` (flex-1, auto-resize up to 3 lines) + PhotoButton (disabled) + MicButton (disabled) + SubmitButton (shown when text present)
- `<textarea>` minimum font-size 16px (prevents iOS zoom)
- Submit on `Enter` key (all devices). `Shift+Enter` adds a newline. This is universal — no mobile/desktop detection heuristic needed.

**MicButton** — disabled placeholder in F090
- Visible but `disabled` with `cursor-not-allowed opacity-60`
- `aria-label="Micrófono (próximamente)"` `title="Próximamente"`
- 48×48px rounded-full, `bg-slate-300 text-slate-400`
- Clicking shows no-op (F090 does not open VoiceOverlay)

**PhotoButton** — disabled placeholder in F090
- Visible but `disabled` with `cursor-not-allowed opacity-60`
- `aria-label="Foto (próximamente)"` `title="Próximamente"`
- 48×48px rounded-xl, border border-slate-200

**SubmitButton** — appears when `query.trim().length > 0`
- 48×48px rounded-xl, `bg-brand-orange text-white shadow-soft`
- Icon: arrow/send SVG 20px
- `aria-label="Buscar"`
- `disabled` + `opacity-40` when `isLoading`

**NutritionCard** — primary result unit
- `<article aria-label="[name]: [calories] calorías">`
- `bg-white rounded-2xl border border-slate-100 shadow-soft p-4 md:p-5`
- Header: dish name (text-lg font-bold text-slate-800) + ConfidenceBadge (right-aligned)
- Calorie block: kcal value `text-[28px] font-extrabold text-brand-orange` + "KCAL" label
- Macros row: protein (brand-green), carbs (accent-gold), fat (slate-500) — each with value + label
- Allergen row: `<AllergenChip>` per allergen (conditional, only if `allergens.length > 0`)
- Source footer: `border-t border-slate-100 text-[11px] text-slate-400`
- Entrance animation: CSS `card-enter` keyframe (opacity 0→1, translateY 12px→0, 0.35s ease-out; stagger 0.08s per card)

**ConfidenceBadge** — semantic confidence indicator
- `HIGH` → `bg-emerald-50 text-emerald-800 border-emerald-200` — "Verificado"
- `MEDIUM` → `bg-amber-50 text-amber-800 border-amber-200` — "Estimado"
- `LOW` → `bg-rose-50 text-rose-800 border-rose-200` — "Aproximado"
- `rounded-full px-2.5 py-0.5 text-[11px] font-semibold`

**AllergenChip**
- `bg-red-50 text-red-700 border border-red-200 rounded-full px-2 py-0.5 text-[11px] font-semibold`
- Small ⚠ warning icon (SVG or unicode fallback) + allergen label

**LoadingState** — 1–3 skeleton cards while API is in flight
- `role="status" aria-label="Buscando información nutricional..."`
- Skeleton cards mirror NutritionCard dimensions — shimmer animation (CSS keyframe, see design guidelines §7.4)
- Skeleton elements: title bar `h-5 w-48`, calorie block `h-9 w-24`, 3× macro rows `h-6 w-16`
- All skeleton elements: `bg-slate-100 rounded-lg animate-shimmer`

**EmptyState** — shown on first load, no results yet
- `flex flex-col items-center justify-center flex-1 px-8 text-center`
- Headline: "¿Qué quieres saber?" (`text-[15px] font-medium text-slate-600`)
- Subtext: "Escribe el nombre de un plato para conocer sus calorías." (`text-sm text-slate-400 mt-1.5 max-w-[280px]`)

**ErrorState** — shown on API error or network failure
- Same container layout as EmptyState
- Warning icon (32px, `text-red-400`)
- Headline: context-sensitive Spanish message
- "Intentar de nuevo" retry button (secondary style, size sm)

#### Layout — ResultsArea

```
Mobile (< 768px):  grid grid-cols-1 gap-3
Tablet (>= 768px): grid grid-cols-2 gap-4
Desktop (>= 1024px): grid grid-cols-2 gap-4 max-w-2xl mx-auto
```

If only 1 card returned: `col-span-full` (always full-width).
`overflow-y: auto`, `padding-bottom: 84px` (clears fixed input bar + safe area).

#### Responsive Shell

- `h-[100dvh]` (dynamic viewport height — avoids mobile browser chrome)
- AppBar (optional): 52px, `bg-white border-b border-slate-100`, logo left
- ResultsArea: `flex-1 overflow-y-auto`
- ConversationInput: `fixed bottom-0` — always visible

---

### Edge Cases & Error Handling

1. **SSR / localStorage unavailable** — `actorId.ts` must use a try/catch around `localStorage` access and fall back to an in-memory UUID for the session. No SSR error should surface to the user.

2. **Empty query submission** — SubmitButton is disabled when `query.trim() === ''`. The Enter key handler also guards on empty input. No API call is made.

3. **Query > 500 characters** — The API returns `intent: text_too_long`. The client shows an inline error near the input: "Demasiado largo. Máx. 500 caracteres." (does NOT use ErrorState full-screen).

4. **`context_set` intent** — No NutritionCard is rendered. Show a toast or inline confirmation: "Contexto activo: [chainName]". If `data.ambiguous === true`, show: "No encontré ese restaurante. Prueba con el nombre exacto."

5. **`comparison` intent** — `data.comparison.dishA` and `data.comparison.dishB` each render as a separate NutritionCard. On mobile they stack vertically; on tablet they appear side by side (grid-cols-2).

6. **`menu_estimation` intent** — Each item in `data.menuEstimation.items` renders as a NutritionCard. **Totals card and `diners`/`perPerson` rendering are explicitly OUT of scope for F090** — deferred to F093 or a follow-up. F090 renders individual items only.

6b. **No-match result** — When `estimation` returns `result: null` (no dish found), render an inline message: "No encontré información nutricional para '[query]'. Prueba con otro nombre." Same for `comparison` where one or both dishes return null, and for `menu_estimation` items with null results (show placeholder within the card grid).

7. **`reverse_search` intent** — Render `data.reverseSearch` items as NutritionCards. If no items match, show EmptyState variant: "No encontré platos con esas características."

8. **Rate limit (429)** — Full-screen ErrorState with special copy: "Has alcanzado el límite diario de 50 consultas. Vuelve mañana."

9. **Network timeout** — Client should apply a 15-second `AbortController` timeout on fetch. On timeout, show ErrorState: "La consulta tardó demasiado. Inténtalo de nuevo."

10. **Rapid re-submit** — While `isLoading`, the SubmitButton is disabled and further submits are ignored. Previous in-flight request is aborted if user somehow triggers a new one (use AbortController with a `currentRequestRef`).

11. **`allergens` field absent or empty** — AllergenChip row is not rendered. Component must handle `allergens: undefined | null | []` gracefully.

12. **`activeContext` echoed in response** — In F090, the web client does not display `activeContext` in the results header. This is deferred to F093+. The field is parsed but ignored for display purposes.

13. **Reduced motion** — All CSS animations (card-enter, shimmer) must respect `prefers-reduced-motion: reduce` as specified in design guidelines §7.6.

---

## Implementation Plan

### Existing Code to Reuse

**From `packages/landing`** (copy patterns, do NOT import across packages):
- `packages/landing/tailwind.config.ts` — brand token definitions (`brand-green`, `brand-orange`, `ivory`, `paper`, `mist`, `accent-gold`, `shadow-soft`, `shadow-layered`). Replicate in `packages/web/tailwind.config.ts` exactly.
- `packages/landing/next.config.mjs` — security headers pattern. Replicate and adjust CSP to allow `NEXT_PUBLIC_API_URL` in `connect-src`.
- `packages/landing/tsconfig.json` — extends `../../tsconfig.base.json` with same compiler options. Replicate for `packages/web`.
- `packages/landing/jest.config.js` + `jest.setup.ts` — Jest + jsdom + `next/jest` + `moduleNameMapper` pattern. Replicate.
- `packages/landing/src/app/layout.tsx` — Inter font setup (`next/font/google`, `variable: '--font-inter'`, weights `400–800`). Replicate, strip MotionProvider.
- `packages/landing/src/__tests__/WaitlistForm.test.tsx` — `global.fetch = mockFetch` pattern for testing fetch wrappers. Reuse this approach in `apiClient.test.ts`.

**From `packages/shared`** (import directly):
- `ConversationMessageData`, `ConversationMessageResponse`, `ConversationIntent` — from `@foodxplorer/shared` (`packages/shared/src/schemas/conversation.ts`)
- `EstimateData`, `EstimateResult`, `EstimateNutrients`, `DetectedAllergen` — from `@foodxplorer/shared` (`packages/shared/src/schemas/estimate.ts`)
- `MenuEstimationData`, `MenuEstimationItem` — from `@foodxplorer/shared` (`packages/shared/src/schemas/menuEstimation.ts`)
- `ReverseSearchData`, `ReverseSearchResult` — from `@foodxplorer/shared` (`packages/shared/src/schemas/reverseSearch.ts`)
- All types are already exported from `packages/shared/src/index.ts` — no additional barrel changes needed.

**From `packages/api/src/plugins/cors.ts`**:
- The file already has `X-Actor-Id` and `X-FXP-Source` in `ALLOWED_HEADERS`. Only two additions needed: `exposedHeaders` + `localhost:3002` origin.

---

### Files to Create

#### Package scaffold

| Path | Purpose |
|------|---------|
| `packages/web/package.json` | Package manifest — `@foodxplorer/web`, Next.js 15, dependencies: `clsx`, `tailwind-merge`, `@foodxplorer/shared`; devDeps: Jest, RTL, ts-jest, types |
| `packages/web/next.config.mjs` | Next.js config — `reactStrictMode: true`, security headers (clone landing pattern, add API URL to CSP `connect-src`) |
| `packages/web/tailwind.config.ts` | Tailwind config — same brand tokens as landing, adds `animate-shimmer`, `card-enter` keyframes, `animate-card-enter` |
| `packages/web/tsconfig.json` | TypeScript config — extends `../../tsconfig.base.json`, same options as landing, adds `@foodxplorer/shared` path via `paths` |
| `packages/web/jest.config.js` | Jest config — `next/jest`, jsdom, `moduleNameMapper` for `@/` and `@foodxplorer/shared` |
| `packages/web/jest.setup.ts` | Jest setup — `@testing-library/jest-dom` imports |
| `packages/web/postcss.config.js` | PostCSS — Tailwind + autoprefixer |
| `packages/web/next-env.d.ts` | Next.js TypeScript declarations (auto-generated by `next build`, but must exist for `tsc` to pass) |
| `packages/web/.env.local.example` | Example env — `NEXT_PUBLIC_API_URL=http://localhost:3001` |

#### App shell

| Path | Purpose |
|------|---------|
| `packages/web/src/app/layout.tsx` | Root layout — Inter font, `<html lang="es">`, metadata for `/hablar` (no MotionProvider) |
| `packages/web/src/app/page.tsx` | Root redirect — `redirect('/hablar')` (Server Component) |
| `packages/web/src/app/hablar/page.tsx` | `/hablar` route — thin Server Component, imports and renders `HablarShell` |
| `packages/web/src/styles/globals.css` | Global styles — Tailwind directives, `@keyframes card-enter`, `@keyframes shimmer`, `.card-enter` class, `.shimmer-element` class, `prefers-reduced-motion` block |

#### Data layer

| Path | Purpose |
|------|---------|
| `packages/web/src/lib/actorId.ts` | UUID persistence — `getActorId()`: reads/writes `nxi_actor_id` from `localStorage` with try/catch fallback to in-memory UUID; `persistActorId(id: string)`: writes to localStorage, used to persist server-issued UUIDs from `X-Actor-Id` response header |
| `packages/web/src/lib/apiClient.ts` | Fetch wrapper — `sendMessage(text: string, actorId: string, signal?: AbortSignal): Promise<ConversationMessageResponse>`. Sets `Content-Type`, `X-Actor-Id`, `X-FXP-Source: web` headers. Reads `X-Actor-Id` from response and calls `persistActorId`. Throws typed `ApiError` on non-2xx or malformed JSON. **Always applies 15s timeout via `AbortSignal.any([signal, AbortSignal.timeout(15000)])` when external signal provided, or `AbortSignal.timeout(15000)` when no external signal.** Validates response has expected `success`/`data` envelope shape. |

#### Components

| Path | Purpose |
|------|---------|
| `packages/web/src/components/HablarShell.tsx` | `'use client'` — top-level orchestrator. State: `query`, `isLoading`, `results`, `error`, `inlineError`. Holds `currentRequestRef` (`useRef<AbortController \| null>`). Renders optional minimal header (inline, not a separate AppBar component), `ResultsArea`, `ConversationInput`. |
| `packages/web/src/components/ConversationInput.tsx` | `'use client'` — fixed bottom input bar. `<textarea>` auto-resize, Enter-submit handler, Shift+Enter newline, disabled state. Props: `value`, `onChange`, `onSubmit`, `isLoading`, `inlineError`. |
| `packages/web/src/components/SubmitButton.tsx` | Send SVG button — visible when `query.trim().length > 0`, disabled when `isLoading`. |
| `packages/web/src/components/MicButton.tsx` | Disabled placeholder — `aria-label="Micrófono (próximamente)"`, `title="Próximamente"`, 48×48px rounded-full, `bg-slate-300 text-slate-400 cursor-not-allowed opacity-60`. |
| `packages/web/src/components/PhotoButton.tsx` | Disabled placeholder — `aria-label="Foto (próximamente)"`, `title="Próximamente"`, 48×48px rounded-xl, `border border-slate-200 cursor-not-allowed opacity-60`. |
| `packages/web/src/components/NutritionCard.tsx` | Result unit — `<article>`. Accepts `EstimateResult \| ReverseSearchResult`, renders: dish name, ConfidenceBadge, kcal block, macros row (proteins/carbs/fats), allergen row (conditional), source footer. CSS `card-enter` class. Handles `result: null` inline (shows no-match message within card slot). |
| `packages/web/src/components/ConfidenceBadge.tsx` | Semantic badge — maps `'high' \| 'medium' \| 'low'` to Tailwind color classes and Spanish label. |
| `packages/web/src/components/AllergenChip.tsx` | Allergen tag — `bg-red-50 text-red-700 border border-red-200`, ⚠ icon + label. |
| `packages/web/src/components/LoadingState.tsx` | Skeleton cards — 1–3 skeleton cards with `animate-shimmer`, `role="status"`, `aria-label`. |
| `packages/web/src/components/EmptyState.tsx` | First-load state — centered headline + subtext. No props needed. |
| `packages/web/src/components/ErrorState.tsx` | Error state — icon + context-sensitive message + retry button. Props: `message: string`, `onRetry: () => void`. |
| `packages/web/src/components/ResultsArea.tsx` | Results grid container — renders the correct component based on `intent`. Handles all 6 intents + no-match. `overflow-y-auto`, responsive grid classes. |
| `packages/web/src/components/ContextConfirmation.tsx` | `context_set` intent display — inline confirmation toast/banner, shows chain name or ambiguity message. |

#### Test files

| Path | Purpose |
|------|---------|
| `packages/web/src/__tests__/lib/actorId.test.ts` | Unit tests for UUID generation, localStorage persistence, fallback |
| `packages/web/src/__tests__/lib/apiClient.test.ts` | Unit tests for request construction, headers, error handling, AbortController, response header persistence |
| `packages/web/src/__tests__/components/NutritionCard.test.tsx` | Renders correct macros, confidence badge variants, allergen chips, no-match state, source footer |
| `packages/web/src/__tests__/components/ConfidenceBadge.test.tsx` | All three confidence levels render correct color classes and Spanish labels |
| `packages/web/src/__tests__/components/AllergenChip.test.tsx` | Renders allergen label and icon |
| `packages/web/src/__tests__/components/HablarShell.test.tsx` | Loading/error/empty/results states; submit flow; rapid re-submit prevention; text_too_long inline error; context_set confirmation; stale request guard; AbortError handling |
| `packages/web/src/__tests__/components/ConversationInput.test.tsx` | Enter submits, Shift+Enter newlines, disabled when loading, empty query guarded |
| `packages/web/src/__tests__/components/ResultsArea.test.tsx` | Renders correct component per intent; empty reverse-search state; comparison with null results; menu items with null placeholders |
| `packages/web/src/__tests__/components/ContextConfirmation.test.tsx` | Shows chain name; shows ambiguity message |
| `packages/web/src/__tests__/components/SubmitButton.test.tsx` | Renders when visible; disabled when loading; click calls onSubmit |
| `packages/web/src/__tests__/components/MicButton.test.tsx` | Disabled state; correct aria-label |
| `packages/web/src/__tests__/components/PhotoButton.test.tsx` | Disabled state; correct aria-label |
| `packages/web/src/__tests__/components/LoadingState.test.tsx` | Has `role="status"`, renders shimmer skeleton elements |
| `packages/web/src/__tests__/components/EmptyState.test.tsx` | Renders headline and subtext |
| `packages/web/src/__tests__/components/ErrorState.test.tsx` | Renders message, retry button calls `onRetry` |
| `packages/web/src/__tests__/fixtures.ts` | Test data factories for `ConversationMessageData`, `EstimateData`, `EstimateResult` with overrides |

---

### Files to Modify

| Path | Change |
|------|--------|
| `packages/api/src/plugins/cors.ts` | Development block: add `'http://localhost:3002'` to origin array; add `exposedHeaders: ['X-Actor-Id']` to both the development and production `cors` registration calls. |
| `package.json` (root) | Add `"packages/web"` to the `workspaces` array. Add `"dev:web": "npm run dev -w @foodxplorer/web"` to scripts. |
| `docs/specs/ui-components.md` | Add "Web Package — nutriXplorer (/hablar, F090)" section documenting all new components (DoD requirement). |

---

### Implementation Order

1. **CORS fix** — `packages/api/src/plugins/cors.ts` + write unit test `packages/api/src/__tests__/cors.test.ts`. Two-line change, self-contained. Unblocks cross-origin header reads in all subsequent dev work.

2. **Package scaffold** — Create `packages/web/package.json`, `next.config.mjs`, `tailwind.config.ts`, `tsconfig.json`, `jest.config.js`, `jest.setup.ts`, `postcss.config.js`. Update root `package.json` workspaces. Run `npm install` to wire the workspace. Verify `npm run typecheck -w @foodxplorer/web` passes on an empty src.

3. **Global styles + CSS keyframes** — `packages/web/src/styles/globals.css`: Tailwind directives, `@keyframes card-enter`, `@keyframes shimmer`, `.card-enter`, `.shimmer-element`, `prefers-reduced-motion` block. This must exist before any component uses the animation classes.

4. **Root layout + routes** — `src/app/layout.tsx` (Inter font, metadata), `src/app/page.tsx` (redirect), `src/app/hablar/page.tsx` (renders `HablarShell`). No logic here — just the server shell.

5. **Data layer: `actorId.ts`** — Write test `actorId.test.ts` first (RED): generates UUID, persists to localStorage, reads on subsequent calls, falls back when localStorage throws. Implement `actorId.ts` (GREEN). Refactor.

6. **Data layer: `apiClient.ts`** — Write test `apiClient.test.ts` first (RED): correct URL from `NEXT_PUBLIC_API_URL`, sends `X-Actor-Id` + `X-FXP-Source: web`, reads `X-Actor-Id` from response header, throws on 400/429/500, AbortController timeout, network failure. Implement `apiClient.ts` (GREEN). Import `ConversationMessageResponse` from `@foodxplorer/shared`. Refactor.

7. **`ConfidenceBadge` + `AllergenChip`** — Write tests first (RED). Implement (GREEN). These are pure presentational components with no dependencies on other new files.

8. **`NutritionCard`** — Write test first (RED): renders dish name, kcal, proteins, carbs, fats, confidence badge, allergen chips (when present), source footer, no-match message (when `result` is null). Implement (GREEN). Imports `ConfidenceBadge`, `AllergenChip`. CSS `card-enter` class applied.

9. **`LoadingState` + `EmptyState` + `ErrorState`** — Write tests first (RED) for each. Implement (GREEN). `LoadingState`: `role="status"` + shimmer skeleton mirrors NutritionCard shape. `EmptyState`: Spanish copy. `ErrorState`: message prop + retry button.

10. **`SubmitButton` + `MicButton` + `PhotoButton`** — Write tests first (RED): correct aria-labels, disabled states, submit triggers. Implement (GREEN).

11. **`ConversationInput`** — Write test first (RED): Enter submits, Shift+Enter adds newline, disabled when `isLoading`, inline error renders when `inlineError` prop set, empty query does not submit. Implement (GREEN). Uses `SubmitButton`, `MicButton`, `PhotoButton`.

12. **`ContextConfirmation`** — Write test first (RED): shows chain name when `contextSet` present, shows ambiguity copy when `ambiguous: true`. Implement (GREEN). Pure presentational.

13. **`ResultsArea`** — Write test first (RED): renders `EmptyState` when no results, renders `LoadingState` when loading, renders one `NutritionCard` for `estimation`, two cards for `comparison`, N cards for `menu_estimation` items, `ContextConfirmation` for `context_set`, cards from `reverseSearch.results` for `reverse_search`. Implement (GREEN). Applies responsive grid classes.

14. **`HablarShell`** — Write test first (RED): initial render shows `EmptyState`; submit shows `LoadingState`; success renders results; API error shows `ErrorState`; `text_too_long` shows inline error (not `ErrorState`); rapid re-submit aborts previous request; `context_set` shows confirmation; `onRetry` re-runs last query. Implement (GREEN). Wires `actorId.ts` + `apiClient.ts` + all child components. `'use client'` directive. Uses `useRef<AbortController | null>` for `currentRequestRef`.

15. **Test fixtures** — `src/__tests__/fixtures.ts`: `createEstimateResult()`, `createEstimateData()`, `createConversationMessageData(intent, overrides)`. Used across all component tests. (Can be created alongside step 5 or earlier as needed.)

16. **Integration smoke test** — Run `next build` locally. Fix any TypeScript strict errors. Verify `/hablar` loads at `localhost:3002`, EmptyState visible, a query flows end-to-end with the local API.

17. **Documentation update** — Add "Web Package — nutriXplorer (/hablar, F090)" section to `docs/specs/ui-components.md` describing all components, props, and behaviour.

---

### Testing Strategy

#### Test files to create

- `packages/web/src/__tests__/lib/actorId.test.ts`
- `packages/web/src/__tests__/lib/apiClient.test.ts`
- `packages/web/src/__tests__/fixtures.ts`
- `packages/web/src/__tests__/components/ConfidenceBadge.test.tsx`
- `packages/web/src/__tests__/components/AllergenChip.test.tsx`
- `packages/web/src/__tests__/components/NutritionCard.test.tsx`
- `packages/web/src/__tests__/components/LoadingState.test.tsx`
- `packages/web/src/__tests__/components/EmptyState.test.tsx`
- `packages/web/src/__tests__/components/ErrorState.test.tsx`
- `packages/web/src/__tests__/components/ConversationInput.test.tsx`
- `packages/web/src/__tests__/components/ResultsArea.test.tsx`
- `packages/web/src/__tests__/components/ContextConfirmation.test.tsx`
- `packages/web/src/__tests__/components/SubmitButton.test.tsx`
- `packages/web/src/__tests__/components/MicButton.test.tsx`
- `packages/web/src/__tests__/components/PhotoButton.test.tsx`
- `packages/web/src/__tests__/components/HablarShell.test.tsx`
- `packages/api/src/__tests__/cors.test.ts` (CORS plugin unit test for new additions)

#### Key test scenarios

**`actorId.test.ts`:**
- First call generates a UUID and writes it to `localStorage['nxi_actor_id']`
- Second call reads and returns the same UUID from `localStorage`
- When `localStorage.getItem` throws, generates and returns an in-memory UUID without crashing
- `persistActorId(id)` overwrites the key in `localStorage`
- `persistActorId(id)` is a no-op (no throw) when `localStorage` is unavailable

**`apiClient.test.ts`:**
- Sends `POST` to `${NEXT_PUBLIC_API_URL}/conversation/message` with correct JSON body
- Sets `Content-Type: application/json`, `X-Actor-Id: <uuid>`, `X-FXP-Source: web` headers
- On 200: parses and returns `ConversationMessageResponse`
- On 200: reads `X-Actor-Id` response header and calls `persistActorId` when value differs
- On 400: throws `ApiError` with `VALIDATION_ERROR` code
- On 429: throws `ApiError` with `RATE_LIMIT_EXCEEDED` code
- On 500: throws `ApiError` with `INTERNAL_ERROR` code
- On network failure: throws `ApiError` with network error message
- On malformed JSON response: throws `ApiError` with parse error message
- On missing `success`/`data` envelope: throws `ApiError` with malformed response message
- When `NEXT_PUBLIC_API_URL` is undefined: throws descriptive error (not a cryptic fetch failure)
- Always applies 15s timeout via `AbortSignal.any([signal, AbortSignal.timeout(15000)])` when external signal provided
- When no external signal: applies `AbortSignal.timeout(15000)` directly
- When AbortController fires (timeout): throws timeout error
- When external signal aborts: throws AbortError

**`NutritionCard.test.tsx`:**
- Renders dish name and `aria-label` including name and kcal
- Renders kcal value in orange with correct size class
- Renders proteins, carbs, fats values
- Renders `ConfidenceBadge` with correct level
- Renders allergen chips when `allergens.length > 0`
- Does NOT render allergen row when `allergens` is empty/undefined/null
- Renders source name in footer
- When `result` is null, renders no-match inline message (not crash)

**`HablarShell.test.tsx`:**
- Initial render: `EmptyState` visible, input present
- After submit: `LoadingState` visible while fetch is pending
- After successful `estimation` response: `NutritionCard` visible, `LoadingState` gone
- After `context_set` response: `ContextConfirmation` visible
- After API 500 error: `ErrorState` visible with retry button
- After network failure: `ErrorState` with network copy visible
- `text_too_long` intent: inline error near input, no full-screen `ErrorState`
- Rapid re-submit: aborts previous request, shows new results (not stale)
- Stale request completion: does not overwrite newer request's loading/error state
- AbortError from stale request: silently ignored (no error shown)
- `onRetry` in `ErrorState` re-sends the last query
- Empty query (whitespace only): submit is blocked, no API call
- `reverse_search` with 0 results: shows "No encontré platos..." message
- `comparison` with one null result: shows one card + no-match message for the other

**`ConversationInput.test.tsx`:**
- Enter key calls `onSubmit` when `value` is non-empty
- Enter key does NOT call `onSubmit` when `value` is empty
- Shift+Enter inserts a newline (does not submit)
- Textarea is disabled when `isLoading` is true
- `SubmitButton` is not rendered when `value.trim()` is empty
- `SubmitButton` is rendered when `value.trim()` is non-empty
- `inlineError` message renders when prop is non-null

**`cors.test.ts` (API package):**
- Development registration includes `http://localhost:3002` in origin array
- Both development and production registrations include `exposedHeaders: ['X-Actor-Id']`

#### Mocking strategy

- **`global.fetch`**: assign `jest.fn()` before each test in `apiClient.test.ts` and `HablarShell.test.tsx`. Pattern from `packages/landing/src/__tests__/WaitlistForm.test.tsx`.
- **`actorId` module**: in `HablarShell.test.tsx`, mock `../../lib/actorId` at module level to return a fixed UUID and spy on `persistActorId`.
- **`apiClient` module**: in `HablarShell.test.tsx`, mock `../../lib/apiClient` at module level to control resolved/rejected values without real fetch.
- **`localStorage`**: in `actorId.test.ts`, use `jest.spyOn(Storage.prototype, 'getItem')` / `setItem` to simulate availability and throws.
- **No Radix UI portals** in this package — no portal mocking needed.
- Use `jest.mock()` with relative paths per standards (not `@/` aliases in mock paths).

---

### Key Patterns

#### `'use client'` boundary
Only `HablarShell` and `ConversationInput` strictly require `'use client'` (they hold state and attach event handlers). `NutritionCard`, `ConfidenceBadge`, `AllergenChip`, `LoadingState`, `EmptyState`, `ErrorState`, `ContextConfirmation`, `ResultsArea`, `SubmitButton`, `MicButton`, `PhotoButton` are all pure presentational — they receive props only. They do NOT need `'use client'` unless they use hooks internally. Avoid adding the directive unnecessarily per standards (default to Server Components).

#### Import path for shared types
```typescript
import type { ConversationMessageData, EstimateResult } from '@foodxplorer/shared';
```
The `tsconfig.json` `paths` entry must map `@foodxplorer/shared` to `../../shared/src/index.ts` so TypeScript resolves it. The Jest `moduleNameMapper` must also map `@foodxplorer/shared` to the same path for tests.

#### AbortController pattern in `HablarShell`
```typescript
const currentRequestRef = useRef<AbortController | null>(null);

async function handleSubmit(text: string) {
  if (!text.trim()) return;
  // Abort any in-flight request (supports rapid re-submit)
  currentRequestRef.current?.abort();
  const controller = new AbortController();
  currentRequestRef.current = controller;
  setIsLoading(true);
  setError(null);
  setInlineError(null);
  try {
    const actorId = getActorId();
    const data = await sendMessage(text, actorId, controller.signal);
    if (controller.signal.aborted) return; // stale response guard
    // handle response
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return; // stale abort guard
    if (controller.signal.aborted) return; // double-check for race condition
    // handle error
  } finally {
    // Only clear loading if this is still the active request
    if (currentRequestRef.current === controller) {
      setIsLoading(false);
    }
  }
}
```

#### Card entrance animation (CSS-only, no Framer Motion)
Apply `card-enter` class directly on each `<article>` in `NutritionCard`. Stagger is handled by `nth-child` CSS selectors in `globals.css` (up to 3 cards). For `menu_estimation` with more items, the stagger naturally repeats the last delay — acceptable for F090.

#### `allergens` field on `EstimateData` vs `EstimateResult`
The `allergens` field (`DetectedAllergen[]`) lives on `EstimateData` (the outer object), not on `EstimateResult`. When rendering `NutritionCard` for an `estimation` response, pass `estimation.allergens` to the card, not `estimation.result.allergens` (which does not exist on the schema). For `ReverseSearchResult`, allergens are not present — the allergen row is simply hidden.

#### `NutritionCard` for `reverse_search` results
`ReverseSearchResult` has a different shape from `EstimateResult` — it has `calories`, `proteins`, `fats`, `carbohydrates` directly, but no `confidenceLevel` or `source`. `NutritionCard` should accept a discriminated union prop or two separate props: `result: EstimateResult | null` + optional `reverseResult: ReverseSearchResult`. Alternatively, define a minimal `NutritionCardData` interface that both satisfy. The simpler approach: accept `EstimateResult | null` as primary, add optional `reverseSearchResult?: ReverseSearchResult` for the reverse search case, and display a simplified card (no badge, no source footer) when `reverseSearchResult` is present.

#### `text_too_long` intent — inline error, not ErrorState
The spec distinguishes `text_too_long` (inline input error near textarea) from full-screen `ErrorState` (network/5xx). `HablarShell` needs a separate `inlineError: string | null` state for this. `ConversationInput` accepts `inlineError` prop and renders the error below the textarea row. The full-screen `ErrorState` is only set on API `500`, `429`, or network failure.

#### `env(safe-area-inset-bottom)` in Tailwind
Tailwind does not have a built-in safe-area utility. Add to `tailwind.config.ts` under `extend.padding`:
```typescript
'safe-bottom': 'env(safe-area-inset-bottom)',
```
Then use `pb-[calc(12px+env(safe-area-inset-bottom))]` as an arbitrary value on `ConversationInput`. This is the same pattern used in `hablar-design-guidelines.md §4.1` and requires no plugin.

#### Port assignment
The spec references `localhost:3002`. Add a `dev` script in `packages/web/package.json`:
```json
"dev": "next dev -p 3002"
```
This must also match the CORS dev origin added to `cors.ts`.

#### No `@foodxplorer/shared` in package.json `dependencies` — use `workspace:*`
Landing does NOT depend on `shared` (it has its own Zod schemas). Web DOES. In `packages/web/package.json`:
```json
"dependencies": {
  "@foodxplorer/shared": "*"
}
```
npm workspaces resolves this to the local package. Do not use `workspace:*` syntax — npm (not pnpm) is used in this repo.

#### Jest config — `@foodxplorer/shared` module resolution
The `moduleNameMapper` in `jest.config.js` must include:
```javascript
'^@foodxplorer/shared$': '<rootDir>/../../shared/src/index.ts',
```
Otherwise Jest will fail to resolve the package in test runs (node_modules hoisting does not apply to TypeScript source imports in tests).

#### CORS test approach for API package
The API uses Vitest (not Jest) — confirmed by `packages/shared` using Vitest and the API test files using `.test.ts`. The new `cors.test.ts` should follow the same test runner as existing API tests. Check `packages/api/package.json` test script before writing the CORS test to confirm Vitest vs Jest. Use `vi.mock` / `vi.fn()` accordingly.

---

## Acceptance Criteria

- [x] `packages/web` scaffolded as a new Next.js 15 App Router package with TypeScript strict and Tailwind CSS
- [x] `/hablar` route accessible at `localhost:3002/hablar` (or assigned port)
- [x] Typing a dish name in the input and submitting calls `POST /conversation/message` and renders NutritionCard(s)
- [x] NutritionCard displays: dish name, kcal (large orange), protein/carbs/fat macros, confidence badge, source footer
- [x] Allergen chips render when allergens are present; row is hidden when absent
- [x] LoadingState (skeleton cards) displays while API call is in flight
- [x] EmptyState ("¿Qué quieres saber?") displays on first load before any query
- [x] ErrorState with retry button displays on API error or network failure
- [x] `context_set` intent shows confirmation message, not a NutritionCard
- [x] `text_too_long` intent shows inline input error, not ErrorState
- [x] MicButton is visible but disabled with `aria-label="Micrófono (próximamente)"`
- [x] PhotoButton is visible but disabled with `aria-label="Foto (próximamente)"`
- [x] ActorId generated as UUID on first visit and persisted to `localStorage` under `nxi_actor_id`
- [x] ActorId sent as `X-Actor-Id` header on every API request
- [x] Layout is mobile-first: single-column cards on < 768px, two-column grid on >= 768px
- [x] Input bar is fixed to bottom of viewport with iOS safe-area inset support
- [x] All user-facing text is in Spanish
- [x] `prefers-reduced-motion` respected — animations disabled when set
- [x] Minimum touch target 44×44px for all interactive elements
- [x] No-match result (`estimation` with `result: null`) shows "No encontré información nutricional..." message instead of NutritionCard
- [x] `menu_estimation` renders individual item cards only (no totals card — explicitly deferred)
- [x] `X-FXP-Source: web` header sent on every API request
- [x] Response `X-Actor-Id` header is read and persisted to localStorage on every API call
- [x] API CORS updated: `exposedHeaders: ['X-Actor-Id']` + `localhost:3002` in dev origins
- [x] `packages/web` imports response types from `@foodxplorer/shared` (not duplicated)
- [x] `NEXT_PUBLIC_API_URL` environment variable controls API base URL
- [x] TypeScript strict passes with no errors
- [x] No linting errors
- [x] Build succeeds (`next build`)

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written for: `actorId.ts` (UUID generation + localStorage persistence), `apiClient.ts` (request construction, error handling, AbortController), NutritionCard (renders correct macros, confidence badge, allergens), HablarShell (loading/error/empty/results states)
- [x] E2E test (Playwright or manual) covers: empty state → type query → loading → results
- [x] Code follows project standards (TypeScript strict, Tailwind-only styles, no inline styles)
- [x] No linting errors
- [x] Build succeeds (`next build`)
- [x] `docs/specs/ui-components.md` updated with Web Package components
- [x] Product tracker updated

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated, cross-model review (Gemini + Codex)
- [x] Step 1: Branch `feature/F090-web-assistant-hablar` created, ticket generated, tracker updated
- [x] Step 2: `frontend-planner` executed, cross-model review (Gemini + Codex), plan approved
- [x] Step 3: `frontend-developer` executed with TDD
- [x] Step 4: `production-code-validator` — PRODUCTION-READY. 0 critical/high. Quality gates: tests 119/119, lint clean, build ok, TS strict ok
- [x] Step 5: `code-review-specialist` — APPROVED (3 MEDIUM, 4 LOW, all fixed)
- [x] Step 5: `qa-engineer` — QA_FAIL → fixed BUG-F090-01 → re-verified 133/133 tests
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-08 | Spec created | spec-creator agent. Frontend-only + minor CORS backend change. |
| 2026-04-08 | Spec reviewed | Gemini 2.5 Pro + Codex GPT-5.4. 5 IMPORTANT + 1 CRITICAL + 2 SUGGESTION. All addressed: CORS exposedHeaders, ADR-016 deviation documented, totals card deferred, Enter key simplified, no-match state added, shared types, X-FXP-Source header. |
| 2026-04-08 | Plan created | frontend-planner agent. 17 TDD steps, 19 test files, 26 new files. |
| 2026-04-08 | Plan reviewed | Gemini + Codex. 2 CRITICAL + 7 IMPORTANT + 5 SUGGESTION. All addressed: AbortSignal.any timeout, stale request guard, missing test files (7 added), AppBar removed, next-env.d.ts, exposedHeaders typo, malformed response handling, edge case tests. |
| 2026-04-08 | Step 3 complete | frontend-developer agent. 17-step TDD implementation. 119 tests (15 test files), next build passes. packages/web created, CORS fix applied, all components implemented. |
| 2026-04-08 | Step 4 complete | production-code-validator: PRODUCTION-READY. 0 critical/high, 1 medium (CSP Report-Only). |
| 2026-04-08 | Step 5: Code review | APPROVED. 3 MEDIUM fixed: UUID validation in actorId, userScalable removed, TimeoutError handling. 4 LOW noted. |
| 2026-04-08 | Step 5: QA | QA_FAIL → BUG-F090-01 (TimeoutError shows wrong copy). Fixed: TIMEOUT_ERROR code in apiClient + HablarShell handler. 12 edge-case tests added. 133 total tests pass. |
| 2026-04-08 | Step 5: PR #85 | PR created, 3 commits pushed (impl + review fixes + QA fix). |

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
