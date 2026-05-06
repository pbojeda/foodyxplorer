# F-WEB-MENU-VISION-001: Web /hablar — multi-dish menu/carta photo analysis (mode=auto)

**Feature:** F-WEB-MENU-VISION-001 | **Type:** Fullstack-Feature | **Priority:** High
**Status:** Ready for Merge | **Branch:** feature/F-WEB-MENU-VISION-001-multi-dish-menu-analysis
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-05-06 | **Dependencies:** F034 (POST /analyze/menu backend), F092 (web photo analysis flow), F091 (voice budget pattern reused for vision rate-limiting)

---

## Spec

### Description

Today the web `/hablar` page hard-codes `mode='identify'` and sends every photo to
`POST /api/analyze` (note: the web-facing proxy path, which forwards to `POST /analyze/menu`
on the API). This means every photo is treated as a single-dish photo, discarding the
multi-dish extraction capability already shipping in the Telegram bot (F034).

This feature closes the bot↔web parity gap. After the change, a user who uploads a photo
of a restaurant menu or "menú del día" will get a scrollable list of all extracted dishes,
each clickable to trigger the existing single-dish nutritional estimation flow. The
single-dish path (`mode='identify'`) remains available as an explicit user choice before
upload.

**Functional requirements:**

1. Before (or at the moment of) uploading a photo, the user sees a **mode toggle**: "Menú/carta"
   (default) vs "Solo este plato". The selection is remembered for the session (not persisted).
2. Submitting a photo with "Menú/carta" selected sends `mode='auto'` to `POST /analyze/menu`.
   Submitting with "Solo este plato" selected sends `mode='identify'`.
3. On a successful `mode='auto'` response with `dishCount > 1`, the results area shows a
   `MenuDishList` component: a scrollable list of all extracted dishes. Each item displays
   the dish name and a brief nutritional summary (kcal if estimate available, "Sin datos"
   otherwise). Tapping a dish item populates the text input with the dish name and immediately
   triggers `executeQuery` — using the existing single-dish conversational estimation flow.
4. On a successful response with `dishCount === 1` (including `mode='identify'`), the
   current single-dish `NutritionCard` flow renders unchanged.
5. The `MENU_ANALYSIS_FAILED` error (no dishes extracted) shows a **mode-conditional**
   message:
   - When request was sent with `mode='auto'`: "No he podido leer el menú. Prueba con
     otra foto o elige 'Solo este plato'."
   - When request was sent with `mode='identify'`: "No he podido identificar el plato.
     Prueba con otra foto o asegúrate de que el plato sea visible."

   > **Spec revision 2026-05-06 (Codex review):** Backend uses the same
   > `MENU_ANALYSIS_FAILED` code for both menu-unreadable AND single-dish-not-identified
   > (`menuAnalyzer.ts:232`). The client must branch on the submitted mode to avoid
   > telling a user who chose "Solo este plato" that they should try "Solo este plato".

**Mode selection UX decision (per cross-model analysis — Codex recommendation):**
Explicit user toggle, with `'auto'` (menu/carta) as the **default**. Rationale: the Spanish
use case for menu/carta photos is the primary killer use-case. Forcing the user to actively
opt-in to multi-dish mode would bury the feature. **The toggle is ALWAYS VISIBLE** inline
in the `ConversationInput` area (below the input row, adjacent to the camera icon), not as
a modal dialog. The selection does NOT survive page reload (session-only).

> **Spec revision 2026-05-06 (Codex review):** "Always visible" is locked, not TBD —
> removes frontend-developer discretion and makes AC-U1/U2/U11 deterministically testable.

**Vision model:** The backend currently uses `gpt-4o-mini` (via `callVisionCompletion` in
`menuAnalyzer.ts`). This feature ships with `gpt-4o-mini` as-is. A feature flag
`VISION_MODEL` (env var, default `'gpt-4o-mini'`, accepts `'gpt-4o'`) is added to the API
config so an A/B upgrade to `gpt-4o` can be enabled without a code deploy. The flag is
an **opt-in for future use only** — no automatic switching logic in this ticket.

**Budget guardrail for vision analysis (NO BACKEND CHANGES NEEDED):**

The existing `actorRateLimit` plugin (`packages/api/src/plugins/actorRateLimit.ts`)
already enforces a per-actor × per-day photo limit on `POST /analyze/menu`:

- Redis key: `actor:limit:<actorId>:<YYYY-MM-DD>:photos` (TTL 86400s)
- `/analyze/menu` is already in `ROUTE_BUCKET_MAP` (`actorRateLimit.ts:50`) under
  the `photos` bucket — **no spec or code change needed for routing**.
- Tier resolution comes from `request.apiKeyContext.tier`, NOT from the actor itself
  (`actorRateLimit.ts:93`). For web, this resolves to the tier of the server-side
  `API_KEY` injected by the Next.js proxy (`packages/web/src/app/api/analyze/route.ts:47`).
- The hourly per-API-key limit (10/hr, `fxp:analyze:hourly:<sha256(keyId)>` in
  `analyze.ts`) acts as a secondary guard.
- F091 monthly voice-budget cost-cap pattern is NOT replicated for vision in this
  ticket — out of scope (see "Out of scope").

**Tier/Quota limits for photo analysis (READ FROM CURRENT CODE — `actorRateLimit.ts:38-43`):**

| Tier | Daily `photos` limit | Source |
|------|---------------------|--------|
| Anonymous | 10/day | `DAILY_LIMITS_BY_TIER.anonymous.photos = 10` |
| Free | 20/day | `DAILY_LIMITS_BY_TIER.free.photos = 20` |
| Pro | 100/day | `DAILY_LIMITS_BY_TIER.pro.photos = 100` |
| Admin | Unlimited (Infinity) | `DAILY_LIMITS_BY_TIER.admin.photos = Infinity` |

> **Spec revision 2026-05-06 (Gemini + Codex review):** Earlier draft invented a new
> Redis key `fxp:analyze:daily:<actorId>` and proposed tier limits 10/10/30/Infinity
> that would have **conflicted with the actorRateLimit plugin already in production**.
> Verified empirically by reading `actorRateLimit.ts:38-50` — both the route mapping
> and the `photos` bucket already exist. This ticket inherits those limits as-is;
> **changing them is explicitly out of scope** (would require a separate ADR-track
> ticket because tier limits are a product decision, not a feature change).

**Web tier reality:** Because `actorRateLimit` resolves tier from `apiKeyContext` (not
per-user), all web `/hablar` users share whichever tier the server-side `API_KEY`
environment variable belongs to (currently `free` based on the same key being used
by the dev/prod web deployments). Per-user tier discrimination would require auth
(F107, deferred). For this ticket, that means: **all web users get 20 photo analyses
per day per actor_id**. This is documented; no change.

**Out of scope for this ticket:**
- OCR fallback when Vision API fails (already handled in `mode='vision'`; `mode='auto'`
  already OCR-falls-back — no new logic needed)
- Multi-language menu support beyond current Vision API capabilities
- Persisting analyzed menus to the database
- Batch dish nutritional estimation in a single API call (each dish tap triggers a
  separate `/conversation/message` call via the existing text path)
- A monthly cost budget cap and Slack alert for vision API spend (future ticket)
- Upgrading the Vision model from gpt-4o-mini to gpt-4o (feature flag only, no switch)
- Sharing or exporting multi-dish analysis results
- PDF menu upload from the web UI (backend supports it, web file picker accepts
  only images today — this is unchanged)

---

### API Changes (if applicable)

**No new backend endpoints.** `POST /analyze/menu` already supports `mode='auto'` and
returns the full multi-dish `MenuAnalysisData` shape. The backend is complete.

**Web API client change** (`packages/web/src/lib/apiClient.ts:180`):

- Function `sendPhotoAnalysis(file, actorId, signal?)` currently sends to `/api/analyze`
  with hardcoded `mode='identify'` (line 196, 200). Change:
  - Add optional `mode: AnalyzeMenuMode` parameter (default `'auto'`).
  - **KEEP endpoint as `/api/analyze`** — this is the Next.js Route Handler proxy at
    `packages/web/src/app/api/analyze/route.ts` that injects the server-side `API_KEY`
    before forwarding to the upstream `${apiUrl}/analyze/menu`. The browser MUST NOT
    bypass the proxy — the API_KEY is not exposed to the client.
  - Pass `mode` as a `FormData` field instead of hardcoding `'identify'`.
- The `MenuAnalysisResponse` return type is already correct — no schema change needed.

> **Spec revision 2026-05-06 (Gemini + Codex review):** Earlier draft said "change
> endpoint to `/api/analyze/menu`" — that path **does not exist** in the web app
> (verified `packages/web/src/app/api/analyze/route.ts` is the only proxy handler).
> The browser must keep calling `/api/analyze`; the proxy already forwards to upstream
> `/analyze/menu` (route.ts:63).

**Web proxy** (`packages/web/src/app/api/analyze/route.ts`):
**No changes required.** The proxy already forwards the entire multipart body
(including any `mode` field added by the client) untouched (line 66: `body: request.body`).
Verify by test that a request with `FormData.mode='auto'` is preserved end-to-end.

**Shared schema** (`packages/shared/src/schemas/analysis.ts`):
**No changes needed.** `AnalyzeMenuModeSchema` already exports `'auto' | 'ocr' | 'vision' | 'identify'`.
`AnalyzeMenuBody.mode` already defaults to `'auto'`.

**New `VISION_MODEL` config field** (`packages/api/src/config.ts`):
Add optional env var `VISION_MODEL: z.enum(['gpt-4o-mini', 'gpt-4o']).default('gpt-4o-mini')`.
The value is read in `menuAnalyzer.ts` at the call site of `callVisionCompletion`.

**`callVisionCompletion` signature change** (`packages/api/src/lib/openaiClient.ts`):
Today the function hardcodes the vision model name internally. Change its signature
to accept the model name as a parameter: `callVisionCompletion(..., modelName: string)`.
Pass `config.VISION_MODEL` from `menuAnalyzer.ts` (and any other call sites). This is
the explicit shape change Gemini flagged as a SUGGESTION; we accept it.

**Backend rate-limit work**:
**No changes required.** `POST /analyze/menu` is already wired to the `photos` bucket
in `actorRateLimit.ts:50`. The plugin already enforces tier × actor daily limits and
returns `429 RATE_LIMIT_EXCEEDED` with proper envelope on overrun.

**Updated `api-spec.yaml`:** The `POST /analyze/menu` description is amended to document
the new `VISION_MODEL` feature flag. The existing tier limits documentation already
reflects the actorRateLimit plugin and needs no change. No structural schema changes.

**Response shape** (confirmed from `analyze.ts:180–192` and `analysis.ts:45–62`):
```json
{
  "success": true,
  "data": {
    "mode": "auto",
    "dishCount": 4,
    "partial": false,
    "dishes": [
      { "dishName": "Paella valenciana", "estimate": { ...EstimateData... } },
      { "dishName": "Fideuà", "estimate": null },
      { "dishName": "Gazpacho", "estimate": { ...EstimateData... } },
      { "dishName": "Crema catalana", "estimate": { ...EstimateData... } }
    ]
  }
}
```
`estimate` per dish is the full `EstimateData` shape (same as `GET /estimate` response `data`),
with `portionMultiplier: 1` (always). Dishes with no cascade match have `estimate: null`.

---

### Data Model Changes (if applicable)

None. The endpoint is stateless — no DB writes. Shared Zod schemas require no changes.

---

### UI Changes (if applicable)

#### Overview of component changes

```
HablarShell (modified)
├── ConversationInput (modified — receives new photoMode prop)
│   ├── PhotoModeToggle (NEW — inline toggle for menu vs. single-dish)
│   └── CameraButton (existing — triggers file picker)
├── ResultsArea (modified — new branch for multi-dish results)
│   ├── MenuDishList (NEW — multi-dish result component)
│   │   └── MenuDishItem (NEW — single row in the list)
│   └── NutritionCard (existing — unchanged, used for single-dish path)
└── VoiceOverlay (existing — unchanged)
```

---

#### HablarShell (modified)

**New state:**
- `photoAnalysisMode: AnalyzeMenuMode` — `'auto'` | `'identify'`. Default `'auto'`. Session-only (not persisted).

**Modified `executePhotoAnalysis`:**
- Passes `photoAnalysisMode` to `sendPhotoAnalysis(file, actorId, signal, photoAnalysisMode)`.

**Modified rendering:**
- Passes `photoAnalysisMode` and `onPhotoModeChange` down to `ConversationInput`.
- When `photoResults !== null && photoResults.dishCount > 1`: `ResultsArea` renders
  `MenuDishList` instead of the existing `CardGrid` of `NutritionCard` components.
- When user taps a dish in `MenuDishList`: call `executeQuery(dish.dishName)`, clear
  `photoResults`, set `results(null)` (cross-flow cleanup — same pattern as existing photo
  vs text cross-clearing at `HablarShell.tsx:210`).

**New prop passed to ConversationInput:**
```ts
photoAnalysisMode: AnalyzeMenuMode
onPhotoModeChange: (mode: AnalyzeMenuMode) => void
```

---

#### PhotoModeToggle (NEW)

**Type:** Primitive | **Client:** Yes (receives state via props — parent is already Client)

**Props:**
| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| value | `'auto' \| 'identify'` | Yes | — | Currently selected mode |
| onChange | `(mode: 'auto' \| 'identify') => void` | Yes | — | Mode change handler |
| disabled | `boolean` | No | `false` | Disabled when photo is uploading |

**Rendering:**
- **Always visible** below the input row, adjacent to the camera icon button in
  `ConversationInput`. No conditional show/hide logic. (Locked per spec Description.)
- Two-option segmented control:
  - Option A: "Menú/carta" (value=`'auto'`, default active)
  - Option B: "Solo este plato" (value=`'identify'`)
- Accessible: `role="group"`, `aria-label="Tipo de análisis de foto"`. Each option is a
  `<button>` with `aria-pressed`.
- When `disabled`: both buttons have `disabled` attribute, reduced opacity.

**Loading/Error/Empty States:**
- Disabled while `isPhotoLoading === true`.

---

#### ConversationInput (modified)

**New props:**
| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| photoAnalysisMode | `'auto' \| 'identify'` | Yes | — | Forwarded from HablarShell |
| onPhotoModeChange | `(mode: 'auto' \| 'identify') => void` | Yes | — | Forwarded from HablarShell |

**Change:** Renders `<PhotoModeToggle>` below the input row. Passes `disabled={isPhotoLoading}`.

---

#### MenuDishList (NEW)

**Type:** Feature | **Client:** No (pure display — no state; parent provides handler)

**Props:**
| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| dishes | `MenuAnalysisDish[]` | Yes | — | Array from `MenuAnalysisData.dishes` |
| onDishSelect | `(dishName: string) => void` | Yes | — | Called when user taps a dish |
| partial | `boolean` | No | `false` | When true, shows partial-results warning banner |

**Rendering:**
- Header: "Se han encontrado N platos" (N = `dishes.length`). If `partial`, append
  a warning chip: "Análisis parcial — el menú puede tener más platos."
- Scrollable list of `MenuDishItem` components.
- Each item is clickable (button role) and calls `onDishSelect(dish.dishName)`.

**Accessibility:** `role="list"`, each item `role="listitem"`. `onDishSelect` also
triggered by keyboard Enter/Space.

**Empty state:** Not possible (parent only renders this component when `dishCount > 1`).

---

#### MenuDishItem (NEW)

**Type:** Primitive | **Client:** No (receives click handler as prop)

**Props:**
| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| dish | `MenuAnalysisDish` | Yes | — | `{ dishName, estimate }` |
| onSelect | `() => void` | Yes | — | Called when user taps the item |

**Rendering:**
- Left: dish name (`dish.dishName`), bold, slate-800.
- Right: If `dish.estimate !== null` and `estimate.result !== null`: kcal value
  (`Math.round(estimate.result.nutrients.calories)` + " kcal"), text-sm, text-slate-500.
  If `estimate === null` or `estimate.result === null`: "Sin datos", text-sm, text-slate-400.
- Chevron icon on far right (`>`, aria-hidden).
- Full-width button, py-3 px-4, border-b border-slate-100. Last item no border.
- On tap: `onSelect()` + ripple/highlight feedback (active:bg-slate-50).

---

#### ResultsArea (modified)

**Current multi-dish branch** (`ResultsArea.tsx:128–153`): renders `CardGrid` of
`NutritionCard` per dish. This is replaced for the case `dishCount > 1`:

```
if (photoResults) {
  if (photoResults.dishCount > 1) {
    return <MenuDishList dishes={photoResults.dishes} onDishSelect={onDishSelect} partial={photoResults.partial} />
  }
  // dishCount === 1 → existing CardGrid / NutritionCard render unchanged
}
```

**New prop required:**
| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| onDishSelect | `(dishName: string) => void` | No | `undefined` | Handler for dish tap in MenuDishList |

---

#### Telemetry (local metrics events via `trackEvent`, NOT GA4)

> **Spec revision 2026-05-06 (Codex review):** Earlier draft labeled these "GA4 events"
> but AC-U10 verifies via `trackEvent` mock. Those are two different systems:
> - `trackEvent` writes to local metrics state (`packages/web/src/lib/metrics.ts:13`)
>   and flushes to `/analytics/web-events` via `sendBeacon`. Aggregated, no PII.
> - GA4 events would push to `window.dataLayer` (`HablarAnalytics.tsx:21`,
>   `layout.tsx:43`).
>
> **Decision: use local metrics (`trackEvent`) only for these three events.** Rationale:
> consistency with existing F091 voice telemetry (`voice_start`, `voice_success`,
> `voice_error`); zero PII; gated by the same `NEXT_PUBLIC_METRICS_ENDPOINT` env var
> as F091. GA4 is reserved for page-view-level analytics.

| Event | When | Payload |
|-------|------|---------|
| `photo_mode_selected` | User changes PhotoModeToggle | `{ mode: 'auto' \| 'identify' }` |
| `menu_dish_list_shown` | MenuDishList renders | `{ dishCount: number, partial: boolean }` |
| `menu_dish_selected` | User taps a dish in MenuDishList | `{ dishName: string, hasEstimate: boolean }` |

Each event is fired via `trackEvent('<event_name>', payload)` in the existing local
metrics path. No new GA4 dataLayer pushes.

---

### Edge Cases & Error Handling

1. **Non-menu photo uploaded with mode=auto** (e.g. a plate of food):
   The Vision API may return 1 dish name. The response has `dishCount: 1`. `ResultsArea`
   renders the existing single-dish `NutritionCard` path (no list). No special error —
   this is a valid success case. The user can then tap "Solo este plato" and re-upload
   for a cleaner experience.

2. **No dishes extracted (MENU_ANALYSIS_FAILED, 422):**
   `HablarShell.executePhotoAnalysis` catches this as `err.code === 'MENU_ANALYSIS_FAILED'`.
   The displayed `inlineError` is **mode-conditional** (matches Functional Requirement #5
   and AC-U9a / AC-U9b):
   - `mode='auto'` → "No he podido leer el menú. Prueba con otra foto o elige 'Solo este plato'."
   - `mode='identify'` → "No he podido identificar el plato. Prueba con otra foto o asegúrate
     de que el plato sea visible."

   Override the existing single generic message at `HablarShell.tsx:378`. The submitted
   `mode` is in scope at the catch site (passed to `sendPhotoAnalysis`), so no extra plumbing
   is required. Backend distinction is not needed — same `MENU_ANALYSIS_FAILED` code from
   `menuAnalyzer.ts:232` covers both paths; the client branches on the request mode, not
   the response.

3. **Blurry or very dark photo:**
   Vision API returns fewer dish names or `MENU_ANALYSIS_FAILED`. Handled by case 2 above.
   No special client handling needed beyond the existing error message.

4. **Very long menu (>20 dishes):**
   The backend processes up to the 60s timeout and returns `partial: true` with processed
   dishes. `MenuDishList` shows the partial banner. No client-side cap — all returned dishes
   are rendered. The user experience degrades gracefully (partial list + warning).

5. **Menu in a non-Spanish language (e.g. French brasserie menu):**
   Vision API is language-agnostic and will return dish names in the original language.
   The estimation cascade handles non-Spanish dish names (L4 can translate). No special
   handling — may result in more `estimate: null` items. Logged as telemetry via existing
   `dishCount` / `null estimate` ratio.

6. **Photo upload while mode toggle mid-flight:**
   The toggle is disabled during `isPhotoLoading`. Race condition not possible because
   the camera file picker fires synchronously after toggle selection.

7. **Vision API rate-limited by OpenAI (5xx from OpenAI):**
   `callVisionCompletion` returns `null` → `extractDishNamesFromImage` returns `null` →
   `auto` mode falls back to OCR. If OCR also fails: `MENU_ANALYSIS_FAILED`. No new
   handling needed — backend already covers this path (`menuAnalyzer.ts:296–303`).

8. **Daily photo limit exhausted (existing `actorRateLimit` `photos` bucket):**
   Returns `429 RATE_LIMIT_EXCEEDED` from the existing plugin (no new code path).
   `HablarShell` maps this to the existing
   `'Has alcanzado el límite de análisis por foto. Inténtalo más tarde.'` message
   (`HablarShell.tsx:383`). The 429 envelope's `error.details.resetAt` field is
   available if richer messaging is desired (out of scope).

9. **`partial: true` with zero dishes:**
   The backend route guards against this (`analyze.ts:173–178` — throws `MENU_ANALYSIS_FAILED`
   if `dishes.length === 0` after timeout). Client never receives `partial: true` + empty array.

10. **User taps a dish with `estimate: null`:**
    `executeQuery(dish.dishName)` fires regardless of estimate presence. The conversation
    engine may find a result that the cascade missed (different query context). This is
    intentional — the tap always triggers a fresh text query.

---

### Spec Self-Review — Tradeoffs & Deferred Decisions

**Decisions resolved in cross-model review (2026-05-06):**

- **Endpoint path**: keep `/api/analyze` (Next.js proxy that injects server-side API_KEY).
  Earlier draft said "/api/analyze/menu" — that path doesn't exist. Resolved.
- **Per-actor daily limit Redis key**: reuse the existing `actorRateLimit` plugin
  (`photos` bucket), key `actor:limit:<actorId>:<YYYY-MM-DD>:photos`. Earlier draft
  invented `fxp:analyze:daily:<actorId>` which would have collided. Resolved.
- **Tier limits in spec**: aligned with `DAILY_LIMITS_BY_TIER` (anon 10, free 20, pro 100,
  admin Infinity). Earlier draft proposed (10/10/30/Infinity) which would have required
  a separate ADR for product changes. Resolved.
- **PhotoModeToggle visibility**: locked to "always visible". No frontend-developer TBD.
- **Telemetry system**: `trackEvent` (local metrics) only. No GA4 dataLayer for these
  three events.
- **Error copy**: mode-conditional. Auto and identify each get a distinct message.

**Open decision (deferred to `ui-ux-designer` in Step 0c):**
- **Visual design** of `PhotoModeToggle` (segmented control vs. pill buttons vs. radios) and
  `MenuDishList` (card per dish vs. row with chevron). Functional spec is locked above; the
  visual treatment, tap targets ≥44px (WCAG), spacing, and motion are the designer's call.

**Tradeoffs accepted:**
- **All web users share one tier** because `actorRateLimit` resolves tier from
  `apiKeyContext`, not from the actor. Per-user tier discrimination requires auth
  (F107, deferred). For this ticket, web users get whichever tier the server-side
  `API_KEY` belongs to (currently `free` → 20 photos/day per actor_id).
- **No bot/web tier divergence**: The actorRateLimit applies to BOTH bot and web requests
  to `/analyze/menu` because the bot also carries an actor (`telegram:<chatId>`). Bot
  remains gated by the bot API key tier. No regression vs today.
- **Single `executeQuery` call per dish tap**: Each dish tap triggers the existing
  conversational text query rather than a direct cascade call. This means a round-trip
  through intent detection. Acceptable because the conversational response is richer
  (portion context, comparison hints). A direct cascade shortcut is a future optimization.
- **`mode='auto'` default with no Vision API key**: In dev environments without
  `OPENAI_API_KEY`, both modes fail (Vision is required for image inputs in both paths).
  The error message is mode-conditional, so the user gets a sensible message either way.
  Production always has the key.

---

### Design Notes (ui-ux-designer) — 2026-04-30

Full design rationale is in `docs/specs/design-guidelines.md` § "Web App /hablar — F-WEB-MENU-VISION-001". This section captures the decisions the planner must act on.

#### PhotoModeToggle visual treatment

- **Control type:** Segmented pill — two adjacent `<button>` elements sharing a rounded container. NOT radio buttons, NOT a `<select>`.
- **Container:** `inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5` — placed full-width below the existing `flex items-center gap-2` input row with `mt-2` separation.
- **Active segment:** `rounded-[10px] py-2.5 px-3 bg-white text-brand-green shadow-soft border border-brand-green/20 text-sm font-medium transition-colors duration-150`
- **Inactive segment:** `rounded-[10px] py-2.5 px-3 bg-transparent text-slate-500 text-sm font-medium transition-colors duration-150 hover:text-slate-700`
- **Disabled (during upload):** `opacity-40 pointer-events-none` on the container.
- **Minimum effective tap height:** `py-2.5` yields ~41px intrinsic; iOS touch expansion covers the remaining 3px to 44px. Acceptable.
- **Focus:** `focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-1` on each segment button.
- The toggle is always rendered — no show/hide logic. `disabled` attribute on both buttons when `isPhotoLoading`.

#### MenuDishList visual treatment

- **Format:** Compact full-width rows, NOT cards. One unified container with border-bottom dividers between rows.
- **Container:** `rounded-2xl border border-slate-100 bg-white overflow-hidden shadow-soft card-enter` — matches NutritionCard surface. `.card-enter` handles fade + slide-up entrance (reuses `globals.css` animation — no new animation).
- **Header:** `px-4 py-3 flex items-center justify-between border-b border-slate-100 bg-slate-50/60` — left: `text-sm font-semibold text-slate-700`, right: partial chip (conditional).
- **Scrollable at depth:** If `dishes.length > 6`, clip at `max-h-[420px] overflow-y-auto`.
- **Partial banner:** Inline amber chip (`bg-amber-50 border-amber-200 text-amber-800 text-[11px] font-semibold rounded-full px-2 py-0.5`) in header row, right side. Label: "Lista incompleta" + warning icon. NOT a full-width banner.

#### MenuDishItem rows

- **Row:** `flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-b-0 w-full text-left cursor-pointer min-h-[56px] active:bg-slate-50 transition-colors duration-100`
- **Dish name:** `text-base font-semibold text-slate-800 flex-1 leading-snug` — wraps to two lines; no truncation.
- **kcal (when available):** `text-sm font-medium text-slate-500 whitespace-nowrap`
- **"Sin datos" (null estimate):** `text-sm italic text-slate-400 whitespace-nowrap` — italic differentiates from numeric data without implying error.
- **Chevron:** `text-slate-300 flex-shrink-0 ml-2`, `aria-hidden="true"`.

#### Loading state for mode='auto'

- Replace the existing two-card shimmer grid with a **single full-width shimmer block**: `h-[200px] rounded-2xl shimmer-element` — communicates "list is coming" not "two cards are coming".
- Add a text label above the skeleton: `"Analizando el menú..."` in `text-sm text-slate-500 text-center mb-2` when `photoAnalysisMode === 'auto'`. Keep existing `"Buscando información nutricional..."` for `mode='identify'`.

#### Error states

- `MENU_ANALYSIS_FAILED` error copy is mode-conditional (locked in spec). Rendered as `inlineError` in `ConversationInput` at `role="alert" text-sm text-red-600 mb-1.5` — existing pattern unchanged.
- Do NOT render the error as a card in `ResultsArea`. The error must appear adjacent to the `PhotoModeToggle` so the copy "elige 'Solo este plato'" directly points the user's eye at the toggle below it.

#### Accessibility decisions

- `PhotoModeToggle`: `role="group" aria-label="Tipo de análisis de foto"`, each button `aria-pressed`.
- `MenuDishList`: `role="list" aria-label="Platos encontrados en el menú, N resultados"`.
- Each `MenuDishItem` clickable button: `aria-label="{dishName}, {N} kcal — ver información nutricional"` or `"{dishName}, sin datos de calorías — ver información nutricional"`.
- Partial chip: `role="note" aria-label="Análisis parcial. Es posible que el menú tenga más platos."`.
- Focus order in ConversationInput: textarea → PhotoButton → MicButton → SubmitButton (conditional) → toggle segment A → toggle segment B. Toggle is last — it is a secondary intent modifier, not a primary action.

#### Anti-patterns (do not implement)

- No carousel or horizontal scroll for dish list.
- No modal for the toggle.
- No "ver todos los nutrientes" batch CTA.
- No color-coding of dish rows by kcal level.
- No stagger animation on individual `MenuDishItem` rows.
- No truncation of long dish names.
- No red color for "Sin datos" — it is not an error.

---

## Implementation Plan

### Backend (this section)

---

#### Overview

Three files change on the backend. One config field is added, one function signature is
changed, and one call site is updated to pass the config value. No new files. No migration.
No route changes. No schema changes. The rate-limit plugin (`actorRateLimit.ts`) is confirmed
unchanged — its `/analyze/menu` → `photos` mapping is already in production and already
tested. The `api-spec.yaml` already contains the full `VISION_MODEL` documentation block
(lines 4851–4855, verified) — no spec edit is required.

---

#### P1 — Add `VISION_MODEL` to the config schema

**Files modified:**
- `packages/api/src/config.ts` — add `VISION_MODEL` field to `EnvSchema`
- **`.env.example` (repo root)** — document the new env var with a one-line comment.
  This is the file with the existing OpenAI/Slack documentation block (lines 36–74).
  `packages/api/.env.example` is intentionally minimal (only DB URLs) and should NOT
  be touched.

> **Plan revision 2026-05-06 (Codex review):** Earlier draft pointed P1 at
> `packages/api/.env.example` after a "SLACK_WEBHOOK_URL block" that does not exist
> in that file. Verified empirically: `packages/api/.env.example:1-9` is DB URLs
> only. The root `.env.example:36-74` is the actual env-doc file.

**What to do in `config.ts`:**

Add the following field to `EnvSchema`, adjacent to the other OpenAI fields (after
`OPENAI_CHAT_MAX_TOKENS` on line 33):

```
// Vision API model selection (F-WEB-MENU-VISION-001)
// Accepted values: 'gpt-4o-mini' (default) | 'gpt-4o'
// Changing this value switches the Vision model for all /analyze/menu calls.
VISION_MODEL: z.enum(['gpt-4o-mini', 'gpt-4o']).default('gpt-4o-mini'),
```

Note: use `z.enum([...]).default(...)`, NOT `z.string()`. The enum is the Zod
rejection guard the spec requires for AC-B3.

**What to do in `.env.example` (repo root):**

Append after the existing `SLACK_WEBHOOK_URL` block (around line 70 — search for the
`# OpenAI` section if needed):

```
# F-WEB-MENU-VISION-001 — Vision API model selection
# Accepted: gpt-4o-mini (default) | gpt-4o. Switch without a code deploy.
# VISION_MODEL=gpt-4o-mini
```

**Tests to add — extend `packages/api/src/__tests__/config.test.ts`:**

Add a new `describe('Vision model config (F-WEB-MENU-VISION-001)')` block with:
- `'defaults VISION_MODEL to "gpt-4o-mini" when absent'` — `parseConfig({ ...VALID_ENV })` →
  `config.VISION_MODEL === 'gpt-4o-mini'`
- `'accepts VISION_MODEL="gpt-4o"'` — `parseConfig({ ...VALID_ENV, VISION_MODEL: 'gpt-4o' })`
  → `config.VISION_MODEL === 'gpt-4o'`
- `'calls process.exit(1) when VISION_MODEL is an invalid value'` — `parseConfig({ ...VALID_ENV,
  VISION_MODEL: 'gpt-3.5-turbo' })` → `toThrow('process.exit called')` + `exitSpy` called with 1

Pattern to follow: the existing `'calls process.exit(1) when OPENAI_EMBEDDING_BATCH_SIZE
is out of range'` test at `config.test.ts:189`. The `exitSpy` setup is already in the file
header; the new `describe` block just needs a `beforeEach(() => exitSpy.mockClear())`.

**Acceptance:** AC-B3

**Risk:** None — the `z.enum` default pattern is already used for `NODE_ENV` and `LOG_LEVEL`
in the same schema. The test file pattern is established.

**Estimated time:** 0.5 h

---

#### P2 — Add `modelName` parameter to `callVisionCompletion`

**Files modified:**
- `packages/api/src/lib/openaiClient.ts` — add `modelName: string` parameter; replace
  hardcoded `'gpt-4o-mini'` literal with the parameter

**What to do:**

Current signature (line 193):
```
export async function callVisionCompletion(
  apiKey: string,
  imageBase64: string,
  mimeType: string,
  prompt: string,
  logger?: OpenAILogger,
  maxTokens?: number,
): Promise<string | null>
```

New signature — insert `modelName: string` as the 5th positional parameter (before
`logger?`):
```
export async function callVisionCompletion(
  apiKey: string,
  imageBase64: string,
  mimeType: string,
  prompt: string,
  modelName: string,
  logger?: OpenAILogger,
  maxTokens?: number,
): Promise<string | null>
```

Inside the function body, replace line 202:
```
const model = 'gpt-4o-mini';
```
with:
```
const model = modelName;
```

No default value for `modelName` — the spec requires every call site to be explicit
(AC-B4). This is intentional: it makes call sites reviewable and avoids accidental
silent use of a stale default.

**Tests to add — extend `packages/api/src/__tests__/f034.openaiClient.test.ts`:**

Add to the existing `describe('callVisionCompletion')` block:
- `'uses the modelName parameter passed by the caller'` — call
  `callVisionCompletion(FAKE_API_KEY, FAKE_BASE64, FAKE_MIME, FAKE_PROMPT, 'gpt-4o')`, then
  assert `mockCreate.mock.calls[0]?.[0]?.['model'] === 'gpt-4o'`
- Update the existing `'uses gpt-4o-mini model by default'` test (line 96): it currently
  calls `callVisionCompletion` without a model arg and asserts `'gpt-4o-mini'`. This test
  must be **updated** to pass `'gpt-4o-mini'` explicitly as the 5th argument — the function
  no longer has a default. The test description should be revised to `'uses gpt-4o-mini
  when that model name is passed'`.
- Update all other existing calls in the test file that omit the 5th positional arg: lines
  61, 69, 108, 115, 120, 129, 136, 144, 151, 163, 175. Each must receive `'gpt-4o-mini'`
  as the explicit 5th argument so the tests remain valid.

**Acceptance:** AC-B4 (partial — the signature change; the call-site wiring is P3)

**Risk:** Existing tests in `f034.openaiClient.test.ts` will break at compile/run time
because the 5th argument shifts from `logger?` to `modelName`. The fix is mechanical:
insert `'gpt-4o-mini'` at position 5 in every existing test call. The developer must scan
all `callVisionCompletion(` occurrences in test files and update them before P2 tests can
pass. Running `pnpm tsc --noEmit` after the signature change will surface every affected
call site with a type error — use that as the checklist.

**Estimated time:** 0.5 h

---

#### P3 — Update `menuAnalyzer.ts` call site to pass `config.VISION_MODEL`

**Files modified:**
- `packages/api/src/analyze/menuAnalyzer.ts` — import `config`, pass `config.VISION_MODEL`
  at the `callVisionCompletion` call site

**What to do:**

1. Add `config` import at the top of the file (after existing imports, before constants):
   ```
   import { config } from '../config.js';
   ```

2. The single call site is inside `extractDishNamesFromImage` (line 161). Today it passes
   6 positional arguments. After P2, the new signature is
   `(apiKey, imageBase64, mimeType, prompt, modelName, logger?, maxTokens?)`.
   Update the call to insert `config.VISION_MODEL` as the 5th argument:
   ```
   const raw = await callVisionCompletion(
     openAiApiKey,
     imageBase64,
     mimeType,
     prompt,
     config.VISION_MODEL,   // ← new
     logger,
     VISION_MAX_TOKENS,
   );
   ```

**Tests to add — extend `packages/api/src/__tests__/f034.menuAnalyzer.unit.test.ts`:**

`callVisionCompletion` is already mocked via `vi.mock('../lib/openaiClient.js', ...)` in
this file. Add to the existing `describe('analyzeMenu')` block:

- `'passes config.VISION_MODEL to callVisionCompletion (default: gpt-4o-mini)'` —
  set `process.env.VISION_MODEL` to `undefined` (or omit it), call
  `analyzeMenu({ ..., mode: 'vision', ... })`, then
  `expect(mockCallVisionCompletion.mock.calls[0]?.[4]).toBe('gpt-4o-mini')`.
  Note: the 5th argument (index 4) is `modelName` after the P2 signature change.

- `'passes config.VISION_MODEL="gpt-4o" to callVisionCompletion when env is set'` —
  use `vi.doMock('../config.js', ...)` to override the imported `config` object inside
  the test scope. Pattern:
  ```ts
  vi.doMock('../config.js', () => ({
    config: { ...realConfig, VISION_MODEL: 'gpt-4o' },
  }));
  const { analyzeMenu } = await import('../analyze/menuAnalyzer.js');
  // ... call analyzeMenu, assert callVisionCompletion received 'gpt-4o' as 5th arg.
  ```
  **Do NOT widen `MenuAnalyzerOptions`** with a test-only escape hatch — `MenuAnalyzerOptions`
  is a production interface (`menuAnalyzer.ts:49`) and growing it for test convenience is
  over-engineering. `vi.doMock` + dynamic `import` is the canonical Vitest pattern for
  swapping a module-level singleton in one test without `vi.resetModules()` cascading.

  Alternative if `vi.doMock` interop with the existing `vi.mock` setup proves brittle:
  use a thin in-test factory like:
  ```ts
  vi.spyOn(config, 'VISION_MODEL', 'get').mockReturnValue('gpt-4o');
  ```
  (requires the field to be a getter; if not, prefer `vi.doMock`.)

> **Plan revision 2026-05-06 (Codex review):** Earlier draft proposed extending
> `MenuAnalyzerOptions` with `visionModel?: string` for test injection. That bloats
> the production interface for a config-test problem. Replaced with `vi.doMock`
> pattern; production code reads `config.VISION_MODEL` directly with no opt field.

**Acceptance:** AC-B4 (complete), AC-B5

**Risk:** `vi.doMock` requires careful import ordering — the dynamic `import('../analyze/menuAnalyzer.js')`
must come AFTER the `vi.doMock('../config.js', ...)` call. Document this in the test comment.

**Estimated time:** 0.75 h

---

#### P4 — Regression pin: `actorRateLimit` `/analyze/menu` → `photos` mapping

**Files modified:** None.

**What to verify:**

The mapping `ROUTE_BUCKET_MAP['/analyze/menu'] === 'photos'` is already asserted in
`packages/api/src/__tests__/f069.actorRateLimit.unit.test.ts:103–105` under the test
`'maps /analyze/menu to photos bucket'`. No new code is needed.

The spec (AC-B6) says "verify via existing test or new assertion" — the existing test
satisfies this. The developer should confirm this test still passes after P1–P3 by running
`pnpm vitest run f069.actorRateLimit.unit.test.ts` from `packages/api`.

**Tests to add:** None — the assertion already exists.

**Acceptance:** AC-B6, AC-B7 (the existing test is the regression pin; a passing run
after P1–P3 constitutes evidence)

**Risk:** None.

**Estimated time:** 0.1 h (verify only)

---

#### P5 — `api-spec.yaml` documentation (verify — no edit needed)

**Files modified:** None.

**What to verify:**

`docs/specs/api-spec.yaml` lines 4851–4855 already contain the full `VISION_MODEL`
feature flag documentation block including accepted values, default, and purpose.
Additionally, line 4844 already mentions `VISION_MODEL` in the `vision` mode description.

The spec task B5 is pre-satisfied. The developer should confirm `api-spec.yaml` is
up to date with `git diff HEAD -- docs/specs/api-spec.yaml` and add no further edits.

**Acceptance:** AC-R3 (api-spec.yaml already reflects the feature)

**Risk:** None.

**Estimated time:** 0.05 h (read-only check)

---

### Implementation Order

1. **P1** — `config.ts` + `.env.example` + config tests (foundation; P2 and P3 depend on
   the typed `Config.VISION_MODEL` field being present)
2. **P2** — `openaiClient.ts` signature change + `f034.openaiClient.test.ts` updates
   (write failing tests first, then change signature to make them pass)
3. **P3** — `menuAnalyzer.ts` call site update + `f034.menuAnalyzer.unit.test.ts` additions
   (write failing model-assertion tests first, then wire `config.VISION_MODEL` to make them pass)
4. **P4** — Run `f069.actorRateLimit.unit.test.ts` to confirm the existing mapping
   assertion passes (no code change — just a verification gate)
5. **P5** — Read `api-spec.yaml` lines 4844–4855 to confirm documentation is current
   (no edit)

Each phase is a self-contained TDD chunk: red → green → refactor.

---

### Testing Strategy

**Files to extend (no new test files):**

| Test file | Phase | What to add |
|-----------|-------|-------------|
| `packages/api/src/__tests__/config.test.ts` | P1 | New `describe('Vision model config')` block — 3 tests |
| `packages/api/src/__tests__/f034.openaiClient.test.ts` | P2 | 1 new test + update all existing calls to pass modelName explicitly |
| `packages/api/src/__tests__/f034.menuAnalyzer.unit.test.ts` | P3 | 2 new tests asserting model forwarding |

**Key test scenarios:**

- Happy path default: `VISION_MODEL` absent → `'gpt-4o-mini'` is used at OpenAI SDK call
- Happy path explicit: `VISION_MODEL='gpt-4o'` → `'gpt-4o'` is used at OpenAI SDK call
- Invalid value: `VISION_MODEL='gpt-3.5-turbo'` → `parseConfig` calls `process.exit(1)`
- Regression — existing `callVisionCompletion` tests continue to pass after signature shift
- Regression — `analyzeMenu` behavior in all modes (vision, identify, auto, ocr) is
  unchanged except for the model-name argument forwarding

**Mocking strategy:**

- `config.test.ts`: no mocks needed beyond the existing `process.exit` spy; `parseConfig`
  is called directly with custom env objects
- `f034.openaiClient.test.ts`: OpenAI SDK already mocked via `vi.mock('openai', ...)` and
  `mockCreate` — model assertion reads `mockCreate.mock.calls[0]?.[0]?.['model']`
- `f034.menuAnalyzer.unit.test.ts`: `callVisionCompletion` already mocked via
  `vi.mock('../lib/openaiClient.js', ...)` and `mockCallVisionCompletion`; model assertion
  reads `mockCallVisionCompletion.mock.calls[0]?.[4]` (5th argument, 0-indexed)

No integration tests are needed for this change — the model name is a string passthrough
with no DB interaction, no network call in tests (all mocked), and no new Redis path.

---

### Key Patterns

- **Config enum field with default:** follow `NODE_ENV` and `LOG_LEVEL` in `config.ts:14–17`
  — same `z.enum([...]).default(...)` pattern. No `z.string()` with runtime validation.
- **`parseConfig` unit test pattern:** follow `config.test.ts:189–197` for the invalid-
  value rejection test; follow `config.test.ts:74–76` for the valid-value acceptance test.
- **`callVisionCompletion` mock argument assertion:** follow
  `f034.menuAnalyzer.unit.test.ts:238–242` — `callArgs[5]` check for `maxTokens`. After
  P2, `callArgs[4]` is `modelName` and `callArgs[5]` is `logger`, `callArgs[6]` is
  `maxTokens`. Update the existing `expect(callArgs[5]).toBe(2048)` assertion to
  `expect(callArgs[6]).toBe(2048)` (argument position shifts by 1 after `modelName` is
  inserted at position 4).
- **Module-mock for config in tests:** use `vi.doMock('../config.js', ...)` + dynamic
  `import('../analyze/menuAnalyzer.js')` to swap the module-level `config` singleton
  in a single test scope. Do NOT widen `MenuAnalyzerOptions` to add a test-only
  injection field (per Codex R1 review).

**Gotchas:**

1. The existing test at `f034.menuAnalyzer.unit.test.ts:238` asserts `callArgs[5]` is 2048
   (maxTokens). After the P2 signature change, `maxTokens` shifts to index 6. This test
   WILL FAIL after P2 and MUST be updated as part of P3.
2. The existing test at `f034.openaiClient.test.ts:96–103` (`'uses gpt-4o-mini model by
   default'`) will fail to compile after P2 because `callVisionCompletion` requires `modelName`
   as the 5th argument. It must be updated to `callVisionCompletion(..., 'gpt-4o-mini')`.
   Similarly for all other calls in that file at lines 61, 69, 108, 115, 120, 129, 136,
   144, 151, 163, 175. Run `pnpm tsc --noEmit` after P2 to get the full list.
3. `config` is a module-level singleton in `config.ts`. Do NOT try to override it via
   `process.env` mutation after module load in tests — use `vi.doMock('../config.js')`
   (P3 decision).
4. `api-spec.yaml` already contains the `VISION_MODEL` documentation — do NOT re-add it;
   only verify it is present.

---

### Total estimated backend work: 1.9 h

### Test count delta: +6 tests (3 config, 1 openaiClient, 2 menuAnalyzer)

### Plan self-review notes

- **B5 pre-satisfied:** `api-spec.yaml` already documents `VISION_MODEL` at lines 4844
  and 4851–4855. Verified by `grep` — confirmed both the mode-description reference and
  the standalone feature-flag paragraph are present. No edit needed; the task becomes a
  verification step only.
- **Test-side config mocking decision:** `vi.doMock('../config.js')` + dynamic import
  is the chosen pattern. Earlier draft proposed widening `MenuAnalyzerOptions` with a
  test-only `visionModel?: string` field; rejected by Codex R1 review as runtime API
  bloat for a config-test problem. `MenuAnalyzerOptions` stays unchanged.
- **No new files:** All three test files already exist and follow established patterns.
  Extending them respects the project's "extend, don't create" rule for F034 tests.
- **`callVisionCompletion` call shift ripple:** The only risky mechanical step is updating
  all 11 existing test call sites in `f034.openaiClient.test.ts` after the signature change.
  TypeScript will surface every broken call site — no manual hunting required. The developer
  should rely on `pnpm tsc --noEmit` output as the complete list of sites to fix.

---

### Verification commands run

- `Read: packages/api/src/lib/openaiClient.ts:193–202` → confirmed `callVisionCompletion` has signature `(apiKey, imageBase64, mimeType, prompt, logger?, maxTokens?)` with `const model = 'gpt-4o-mini'` hardcoded at line 202 → B2 signature change is correctly scoped; `modelName` inserts at position 4 (before `logger?`)
- `Read: packages/api/src/analyze/menuAnalyzer.ts:161` → confirmed single call site `callVisionCompletion(openAiApiKey, imageBase64, mimeType, prompt, logger, VISION_MAX_TOKENS)` → only one call site to update in B3; no other files need changing
- `Bash: grep -rn "callVisionCompletion" packages/api/src/ --include="*.ts" | grep -v "test|spec|__tests__"` → 1 runtime call site (menuAnalyzer.ts:161) + definition (openaiClient.ts:193) + comments (lines 9–10, 26) → confirms exactly one call site to update
- `Read: packages/api/src/config.ts:14–50` → `EnvSchema` uses `z.enum` for `NODE_ENV` and `LOG_LEVEL`; `OPENAI_CHAT_MODEL` uses `z.string().optional()` with a comment explaining no default → `VISION_MODEL` should use `z.enum([...]).default(...)` following `LOG_LEVEL` pattern
- `Read: packages/api/src/__tests__/config.test.ts:1–237` → `parseConfig` is tested via direct call with custom env objects; `exitSpy` pattern already set up; `describe` blocks for OpenAI vars and Auth vars exist → new `describe('Vision model config')` block follows established pattern exactly
- `Read: packages/api/src/__tests__/f034.openaiClient.test.ts:53–180` → `describe('callVisionCompletion')` block has 9 tests; all call `callVisionCompletion` with at most 6 args (no `modelName`); line 96–103 test explicitly asserts `model === 'gpt-4o-mini'` → this test must be updated in P2 to pass `'gpt-4o-mini'` explicitly at position 4
- `Read: packages/api/src/__tests__/f034.menuAnalyzer.unit.test.ts:238–242` → `callArgs[5]` asserts `maxTokens === 2048`; after P2 signature change, `maxTokens` moves to index 6 → this assertion must be updated in P3 alongside the model-argument addition
- `Read: packages/api/src/__tests__/f069.actorRateLimit.unit.test.ts:103–105` → test `'maps /analyze/menu to photos bucket'` already asserts `ROUTE_BUCKET_MAP['/analyze/menu'] === 'photos'` → AC-B6 is satisfied; no new code needed
- `Bash: grep -n "POST /analyze/menu|analyze.*menu|VISION_MODEL" docs/specs/api-spec.yaml` → `VISION_MODEL` found at lines 4844 and 4851; feature-flag paragraph is complete → B5 is pre-satisfied; api-spec.yaml requires no edit
- `Read: docs/specs/api-spec.yaml:4828–4887` → the full `POST /analyze/menu` description block confirmed; `VISION_MODEL` is documented under both the `vision` mode bullet and a standalone `**Vision model feature flag:**` paragraph → plan correctly designates B5 as a verify-only step
- `Read: packages/api/.env.example:1–10` → file contains only database URLs; no OpenAI or vision vars → P1 explicitly does NOT touch this file
- `Read: .env.example:1–75` → root `.env.example` contains the full env-var documentation pattern including commented-out optional vars with one-line descriptions → P1 targets root `.env.example` for the `VISION_MODEL` comment addition
- `Bash: grep -n "config\." packages/api/src/analyze/menuAnalyzer.ts` → no hits → `config` is NOT currently imported in `menuAnalyzer.ts`; import must be added in P3

### Frontend

---

#### Overview

Nine files change on the frontend. Two new presentational components are created
(`PhotoModeToggle`, `MenuDishList`/`MenuDishItem`). Four existing files are modified
(`apiClient.ts`, `ConversationInput.tsx`, `ResultsArea.tsx`, `HablarShell.tsx`).
`metrics.ts` needs a type extension for three new event names. `LoadingState.tsx`
needs a conditional skeleton variant. Eight existing test files are extended; two new
test files are created (one per new component).

No new stores, no new API routes, no schema changes. The proxy at `route.ts` is
confirmed no-change (passes body as-is). `AnalyzeMenuMode` is imported from
`@foodxplorer/shared` — the type already exists and is exported via `shared/src/index.ts`.

---

#### P-F1 — apiClient extension

**Files modified:**
- `packages/web/src/lib/apiClient.ts` — Add optional `mode: AnalyzeMenuMode` parameter
  (4th positional, default `'auto'`) to `sendPhotoAnalysis`. Replace the hardcoded
  `formData.append('mode', 'identify')` at line 196 with
  `formData.append('mode', mode)`. Add import of `AnalyzeMenuMode` from
  `@foodxplorer/shared`. No other changes.

**Import path:** `import type { AnalyzeMenuMode } from '@foodxplorer/shared'` — confirmed
`AnalyzeMenuMode` is re-exported from `packages/shared/src/index.ts` via
`export * from './schemas/analysis'`.

**Tests to add — RED first:**
Extend `packages/web/src/__tests__/lib/apiClient.photo.test.ts`:

- `describe('mode parameter (F-WEB-MENU-VISION-001)')` with:
  - `'defaults to mode=auto when no mode argument is passed'` — call
    `sendPhotoAnalysis(file, MOCK_ACTOR_ID)`, assert
    `(callArgs.body as FormData).get('mode') === 'auto'`
  - `'sends mode=identify when explicitly passed'` — call
    `sendPhotoAnalysis(file, MOCK_ACTOR_ID, undefined, 'identify')`, assert
    `(callArgs.body as FormData).get('mode') === 'identify'`
  - `'sends mode=auto when explicitly passed'` — call
    `sendPhotoAnalysis(file, MOCK_ACTOR_ID, undefined, 'auto')`, assert
    `(callArgs.body as FormData).get('mode') === 'auto'`

**Update required:** The existing test `'sends mode=identify in FormData body'` at line 114
of `apiClient.photo.test.ts` asserts `mode === 'identify'`. After this change, the default
becomes `'auto'`. That test must be updated to either:
  - Pass `'identify'` explicitly as the 4th argument, OR
  - Rename to `'sends mode=auto when no mode argument is passed'` and assert `=== 'auto'`.
  The TDD sequence is: update that test to RED (it will fail immediately after the signature
  change), then make it green by changing the default. Do this as the first step of P-F1.

**Acceptance:** AC-W1, AC-W2, AC-W3

**Risk:** The existing test at `apiClient.photo.test.ts:114` asserts `'identify'`. It WILL
become RED after the function default changes. This is intentional — TDD RED before GREEN.

**Estimated time:** 0.5 h

---

#### P-F2 — Next.js proxy passthrough confirmation

**Files modified:** None — `route.ts` forwards `request.body` as-is (`body: request.body`
at line 66, confirmed). No code change needed.

**Tests to add — RED first:**
Extend `packages/web/src/__tests__/api/analyze-route.test.ts` with a new `describe` block:

- `describe('FormData mode field passthrough (F-WEB-MENU-VISION-001)')` with:
  - `'forwards mode=auto in FormData body to upstream unchanged'` — build a
    `makeMultipartRequest` with a body that includes `mode=auto`, call `POST(req)`,
    assert the upstream `Request` body contains `mode=auto`. Note: the current body
    is `'fake-multipart-body'` (a string); a string body with a custom Content-Type
    exercises the same `body: request.body` passthrough path. Assert that the body
    field passed to upstream `fetch` is identical to `request.body` (same reference
    or same bytes).

Note: The proxy passes `request.body` (a `ReadableStream | null`) directly. The test
does not need to parse FormData — asserting that the upstream `Request` constructor
received the same `body` reference is sufficient. Check existing test at line 176+
for the URL construction pattern to follow.

**Acceptance:** AC-W4

**Risk:** Low. The route code is unchanged; this is a verification test only.

**Estimated time:** 0.25 h

---

#### P-F3 — PhotoModeToggle component (NEW)

**Files created:**
- `packages/web/src/components/PhotoModeToggle.tsx` — Segmented pill control.
  Pure presentational, receives state via props. Parent (`ConversationInput`) is
  already `'use client'` — `PhotoModeToggle` itself does NOT need the directive
  since it has no hooks or browser APIs. It is a pure function component.

**Props interface:**
```
type PhotoModeToggleProps = {
  value: 'auto' | 'identify';
  onChange: (mode: 'auto' | 'identify') => void;
  disabled?: boolean;
};
```

**Rendering (per design-guidelines.md W2):**
- Container: `inline-flex w-full rounded-xl border border-slate-200 bg-slate-50 p-0.5`
  with `role="group" aria-label="Tipo de análisis de foto"`.
- When `disabled`: add `opacity-40 pointer-events-none cursor-not-allowed` to container.
  Both `<button>` elements also receive the `disabled` attribute.
- Two `<button type="button">` elements each with `flex-1`:
  - Active (`value` matches): `rounded-[10px] py-2.5 px-3 bg-white text-brand-green
    shadow-soft border border-brand-green/20 text-sm font-medium transition-colors
    duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green
    focus-visible:ring-offset-1`
  - Inactive: `rounded-[10px] py-2.5 px-3 bg-transparent text-slate-500 border-transparent
    text-sm font-medium transition-colors duration-150 hover:text-slate-700
    hover:bg-white/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green
    focus-visible:ring-offset-1`
  - Each button: `aria-pressed={value === buttonValue}`.
- Option A: label `"Menú/carta"`, `value='auto'`
- Option B: label `"Solo este plato"`, `value='identify'`

**Tests to add — RED first:**
New file: `packages/web/src/__tests__/components/PhotoModeToggle.test.tsx`

- `describe('PhotoModeToggle')` with:
  - `'renders "Menú/carta" as active (aria-pressed=true) by default when value="auto"'`
    — render with `value="auto"`, assert button "Menú/carta" has `aria-pressed="true"`,
    button "Solo este plato" has `aria-pressed="false"`.
  - `'calls onChange with "identify" when "Solo este plato" is clicked'` — render
    with `value="auto"` and `onChange` mock, click "Solo este plato", assert called
    with `'identify'`.
  - `'calls onChange with "auto" when "Menú/carta" is clicked while identify is active'`
    — render with `value="identify"`, click "Menú/carta", assert called with `'auto'`.
  - `'both buttons are disabled when disabled=true'` — render with `disabled={true}`,
    assert both buttons have `disabled` attribute.
  - `'does NOT call onChange when disabled'` — render with `disabled={true}` and
    `onChange` mock, click either button, assert mock not called.
  - `'container has role=group and aria-label'` — assert `role="group"` and
    `aria-label="Tipo de análisis de foto"`.

**Acceptance:** AC-U1, AC-U2, AC-U3, AC-U11

**Risk:** None — pure component, no async, no side effects.

**Estimated time:** 0.75 h

---

#### P-F4 — MenuDishList + MenuDishItem (NEW)

**Files created:**
- `packages/web/src/components/MenuDishItem.tsx` — Single row in the dish list.
  Pure presentational. No `'use client'` needed.
- `packages/web/src/components/MenuDishList.tsx` — Dish list container. Pure
  presentational. No `'use client'` needed.

**MenuDishItem props:**
```
type MenuDishItemProps = {
  dish: MenuAnalysisDish;
  onSelect: () => void;
};
```

**MenuDishItem rendering (per design-guidelines.md W3):**
- Outer element: `<button type="button">` with:
  `flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-b-0
   w-full text-left cursor-pointer active:bg-slate-50 transition-colors duration-100
   min-h-[56px]`
- `aria-label` constructed as: `"{dishName}, {N} kcal — ver información nutricional"`
  when estimate is available, or `"{dishName}, sin datos de calorías — ver información
  nutricional"` when null.
- Left: `<span className="text-base font-semibold text-slate-800 flex-1 leading-snug">
  {dish.dishName}</span>`
- Right (with estimate): `<span className="text-sm font-medium text-slate-500 whitespace-nowrap">
  {Math.round(estimate.result.nutrients.calories)} kcal</span>`
- Right (null estimate or null result): `<span className="text-sm italic text-slate-400
  whitespace-nowrap">Sin datos</span>`
- Chevron: `<span className="text-slate-300 flex-shrink-0 ml-2" aria-hidden="true">›</span>`
- Keyboard: standard `<button>` handles Enter/Space natively — no extra `onKeyDown`.

**MenuDishList props:**
```
type MenuDishListProps = {
  dishes: MenuAnalysisDish[];
  onDishSelect: (dishName: string) => void;
  partial?: boolean;
};
```

**MenuDishList rendering (per design-guidelines.md W3, W3.2):**
- Container: `<div className="rounded-2xl border border-slate-100 bg-white overflow-hidden
  shadow-soft card-enter">` (`.card-enter` for entrance animation — reuses existing
  `globals.css:50` keyframe).
- Header: `<div className="px-4 py-3 flex items-center justify-between border-b
  border-slate-100 bg-slate-50/60">`
  - Left: `<span className="text-sm font-semibold text-slate-700">Se han encontrado
    {dishes.length} plato{dishes.length !== 1 ? 's' : ''}</span>`
  - Right (conditional on `partial`): inline amber chip —
    `<span role="note" aria-label="Análisis parcial. Es posible que el menú tenga más platos."
    className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200
    text-amber-800 text-[11px] font-semibold px-2 py-0.5">Lista incompleta</span>`
    (prepend a warning icon `aria-hidden`).
- Scrollable list wrapper: `<div role="list" aria-label="Platos encontrados en el menú,
  {dishes.length} resultados" className={dishes.length > 6 ? 'max-h-[420px] overflow-y-auto' : ''}>`.
- Each `<MenuDishItem>` inside `<div role="listitem">` wrapper.
- `onDishSelect` telemetry is emitted in the parent (HablarShell), NOT in this component.
  The component fires `onDishSelect(dish.dishName)` via `MenuDishItem`'s `onSelect` prop.

**`useEffect` for `menu_dish_list_shown` telemetry:** This event fires on mount. Since
`MenuDishList` is a Server Component (no `'use client'`), the telemetry must be emitted
from the parent (`ResultsArea` or `HablarShell`). See P-F6 for the placement decision.

**Tests to add — RED first:**
New file: `packages/web/src/__tests__/components/MenuDishList.test.tsx`

- `describe('MenuDishItem')` with:
  - `'displays dish name and kcal when estimate is available'` — render with a dish
    with non-null estimate, assert dish name and `"{N} kcal"` are visible.
  - `'displays "Sin datos" when estimate is null'` — render with `estimate: null`,
    assert `"Sin datos"` text is visible.
  - `'calls onSelect when clicked'` — `userEvent.click`, assert mock called once.
  - `'calls onSelect when Enter key is pressed'` — `userEvent.keyboard('{Enter}')`,
    assert mock called.

- `describe('MenuDishList')` with:
  - `'renders header with dish count'` — render 3 dishes, assert `"Se han encontrado 3 platos"`.
  - `'shows partial banner when partial=true'` — assert `role="note"` element is present;
    assert it is NOT present when `partial=false`.
  - `'renders a row for each dish'` — render 4 dishes, assert 4 dish names visible.
  - `'calls onDishSelect with dishName when a dish row is clicked'` — click first row,
    assert `onDishSelect` called with `dish.dishName`.
  - `'applies max-h-[420px] overflow-y-auto when dishes.length > 6'` — render 7 dishes,
    assert the list wrapper has the `max-h-[420px]` class.

**Acceptance:** AC-U4, AC-U7, AC-U8

**Risk:** `Math.round(estimate.result.nutrients.calories)` — must guard against
`estimate.result === null` (the schema allows it: `EstimateData.result` can be null
when the cascade yields no match). Check: `dish.estimate?.result?.nutrients.calories`.
If `null`, fall through to "Sin datos".

**Estimated time:** 1.0 h

---

#### P-F5 — ConversationInput integration

**Files modified:**
- `packages/web/src/components/ConversationInput.tsx` — Add two new props to
  `ConversationInputProps`:
  ```
  photoAnalysisMode: 'auto' | 'identify';
  onPhotoModeChange: (mode: 'auto' | 'identify') => void;
  ```
  Both required (HablarShell always provides them). Add `PhotoModeToggle` import.
  Render `<PhotoModeToggle>` below the `<div className="flex items-center gap-2">` input
  row, with `mt-2` separation:
  ```
  <PhotoModeToggle
    value={photoAnalysisMode}
    onChange={onPhotoModeChange}
    disabled={isPhotoLoading}
  />
  ```
  The toggle is always rendered — no conditional show/hide.

**Tests to add — RED first:**
Extend `packages/web/src/__tests__/components/ConversationInput.test.tsx`:

- `describe('PhotoModeToggle integration (F-WEB-MENU-VISION-001)')` with:
  - `'renders PhotoModeToggle below the input row'` — render with required props, assert
    both `"Menú/carta"` and `"Solo este plato"` buttons are present.
  - `'passes disabled=true to PhotoModeToggle when isPhotoLoading=true'` — render
    with `isPhotoLoading={true}`, assert both toggle buttons are `disabled`.
  - `'calls onPhotoModeChange when toggle option is clicked'` — click "Solo este plato",
    assert `onPhotoModeChange` was called with `'identify'`.

Note: The existing `renderInput` helper in the test file must be updated to provide
default values for the two new required props:
```
photoAnalysisMode: 'auto',
onPhotoModeChange: jest.fn(),
```
Otherwise all existing tests will fail to compile. This is the highest-risk step in P-F5.

**Acceptance:** AC-U1, AC-U3

**Risk:** `ConversationInputProps` currently has no `photoAnalysisMode`/`onPhotoModeChange`.
Adding them as required breaks the existing `renderInput` defaults in the test file.
The developer must update `defaults` in the helper before the new tests are added.
TypeScript will surface every call site that omits the new props — use
`pnpm tsc --noEmit` after the interface change to get the full list (HablarShell
is the only non-test call site, addressed in P-F7).

**Estimated time:** 0.5 h

---

#### P-F6 — ResultsArea branch on dishCount

**Files modified:**
- `packages/web/src/components/ResultsArea.tsx` — Replace the entire `if (photoResults)`
  block (lines 128–153) with a branched version:
  ```
  if (photoResults) {
    if (photoResults.dishCount > 1) {
      return (
        <div className="flex-1 overflow-y-auto px-4 pb-24 pt-4">
          <MenuDishList
            dishes={photoResults.dishes}
            onDishSelect={onDishSelect ?? (() => {})}
            partial={photoResults.partial}
          />
        </div>
      );
    }
    // dishCount === 1 — existing CardGrid + NutritionCard render (unchanged)
    return (
      <CardGrid>
        {photoResults.dishes.map((dish, index) => { ... })}
      </CardGrid>
    );
  }
  ```
  Add new optional prop to `ResultsAreaProps`:
  ```
  onDishSelect?: (dishName: string) => void;
  ```
  Add `MenuDishList` import. Add `MenuAnalysisDish` import from `@foodxplorer/shared`
  (already imported via `MenuAnalysisData`; check if `MenuAnalysisDish` is also
  needed explicitly — it is not, since `dishes` is typed as `MenuAnalysisData['dishes']`).

- `packages/web/src/components/LoadingState.tsx` — Add optional `mode` prop:
  ```
  type LoadingStateProps = {
    mode?: 'auto' | 'identify';
  };
  ```
  When `mode === 'auto'`, render a single full-width shimmer bar instead of two
  `SkeletonCard` components:
  ```
  <p className="text-sm text-slate-500 text-center mb-2">Analizando el menú...</p>
  <div className="h-[200px] rounded-2xl shimmer-element" />
  ```
  When `mode !== 'auto'` (or undefined), render existing two-`SkeletonCard` layout
  with existing `aria-label="Buscando información nutricional..."`.
  When `mode === 'auto'`: set `aria-label="Analizando el menú..."` on the wrapper.

  `ResultsArea.tsx` must pass `photoAnalysisMode` to `LoadingState` when
  `isPhotoLoading === true`. This requires `ResultsArea` to receive a new optional prop:
  ```
  photoAnalysisMode?: 'auto' | 'identify';
  ```
  Then: `<LoadingState mode={isPhotoLoading ? photoAnalysisMode : undefined} />`

**Tests to add — RED first:**
Extend `packages/web/src/__tests__/components/ResultsArea.test.tsx`:

- `describe('photo results branch (F-WEB-MENU-VISION-001)')` with:
  - `'renders MenuDishList when photoResults.dishCount > 1'` — render with
    `photoResults={createMenuAnalysisData({ dishCount: 2, dishes: [dish1, dish2] })}`,
    assert `"Se han encontrado 2 platos"` is visible and no `NutritionCard`-specific
    text is present.
  - `'renders existing CardGrid/NutritionCard path when photoResults.dishCount === 1'` —
    render with `photoResults={createMenuAnalysisData({ dishCount: 1, dishes: [dish1] })}`,
    assert dish name from `NutritionCard` is rendered (not the MenuDishList header).
  - `'calls onDishSelect with dishName when a dish row is clicked in MenuDishList'` —
    render with `dishCount: 2`, provide `onDishSelect` mock, click a dish row, assert
    called with the dish name.

- Extend `describe('loading states')`:
  - `'renders single shimmer bar with "Analizando el menú..." when isPhotoLoading=true and photoAnalysisMode="auto"'`
    — assert no `SkeletonCard` present, assert `aria-label="Analizando el menú..."`.
  - `'renders two SkeletonCard when isPhotoLoading=true and photoAnalysisMode="identify"'`
    — assert two `[data-testid="skeleton-card"]` elements are present.

**Acceptance:** AC-U4, AC-U5

**Risk:** The existing `describe('photo results branch')` tests in `ResultsArea.test.tsx`
test the old "NutritionCard per dish" path for `dishCount >= 2`. Those tests will need
to be updated — they will render `MenuDishList` after this change instead of
`NutritionCard` grids. Review the existing tests at lines 128–153 equivalent in the
test file before writing new ones to avoid duplication.

**Estimated time:** 0.75 h

---

#### P-F7 — HablarShell wiring

**Files modified:**
- `packages/web/src/components/HablarShell.tsx` — Four targeted changes:

**1. New state:**
```ts
const [photoAnalysisMode, setPhotoAnalysisMode] = useState<'auto' | 'identify'>('auto');
```
Import `AnalyzeMenuMode` from `@foodxplorer/shared` if needed for type annotation
(the literal union `'auto' | 'identify'` is sufficient; the type import is optional
but cleaner).

**2. `executePhotoAnalysis` — pass mode to apiClient:**
Change the call at line 337:
```ts
const response = await sendPhotoAnalysis(uploadFile, actorId, controller.signal);
```
to:
```ts
const response = await sendPhotoAnalysis(uploadFile, actorId, controller.signal, photoAnalysisMode);
```
`photoAnalysisMode` is captured in the `useCallback` closure — it must be added to
the `useCallback` dependency array. Currently `useCallback(async (file: File) => {...}, [])`.
Change to `[photoAnalysisMode]`.

**3. `MENU_ANALYSIS_FAILED` error — mode-conditional message:**
In the `switch` inside the `catch` block (around line 376), change:
```ts
case 'MENU_ANALYSIS_FAILED':
  setInlineError('No he podido identificar el plato. Intenta con otra foto.');
  break;
```
to:
```ts
case 'MENU_ANALYSIS_FAILED':
  setInlineError(
    photoAnalysisMode === 'auto'
      ? 'No he podido leer el menú. Prueba con otra foto o elige \'Solo este plato\'.'
      : 'No he podido identificar el plato. Prueba con otra foto o asegúrate de que el plato sea visible.'
  );
  break;
```
`photoAnalysisMode` is in scope in the `catch` block because the entire
`executePhotoAnalysis` closure captures it.

**4. New `onDishSelect` handler and render changes:**
Add `handleDishSelect` function:
```ts
const handleDishSelect = useCallback((dishName: string) => {
  trackEvent('menu_dish_selected', {
    dishName,   // Note: trackEvent payload currently only has specific fields.
                // dishName is not in MetricPayload — see metrics.ts extension in P-F8.
    hasEstimate: photoResults?.dishes.find(d => d.dishName === dishName)?.estimate !== null,
  });
  setPhotoResults(null);
  setResults(null);
  setQuery(dishName);
  executeQuery(dishName);
}, [photoResults, executeQuery]);
```

Update `<ResultsArea>` call to pass new props:
```tsx
<ResultsArea
  ...
  onDishSelect={handleDishSelect}
  photoAnalysisMode={photoAnalysisMode}
/>
```

Update `<ConversationInput>` call to pass new props:
```tsx
<ConversationInput
  ...
  photoAnalysisMode={photoAnalysisMode}
  onPhotoModeChange={(mode) => {
    trackEvent('photo_mode_selected', { mode });
    setPhotoAnalysisMode(mode);
  }}
/>
```

**Tests to add — RED first:**
Extend `packages/web/src/__tests__/components/HablarShell.photo.test.tsx`:

- `describe('photo mode toggle (F-WEB-MENU-VISION-001)')` with:
  - `'passes mode=auto to sendPhotoAnalysis by default'` — render `<HablarShell>`,
    select a file, assert `mockSendPhotoAnalysis` called with 4th arg `=== 'auto'`.
  - `'passes mode=identify to sendPhotoAnalysis after toggle switch'` — render, find
    and click "Solo este plato" toggle button, select file, assert 4th arg `=== 'identify'`.
  - `'shows mode-conditional error for MENU_ANALYSIS_FAILED with mode=auto'` —
    mock `sendPhotoAnalysis` to reject with `ApiError('...', 'MENU_ANALYSIS_FAILED')`,
    render (default mode=auto), select file, assert text "No he podido leer el menú"
    is visible.
  - `'shows mode-conditional error for MENU_ANALYSIS_FAILED with mode=identify'` —
    same but first switch toggle to "Solo este plato", assert text
    "No he podido identificar el plato" is visible.
  - `'renders MenuDishList when photo response has dishCount > 1'` — mock response
    with 3 dishes, select file, assert `"Se han encontrado 3 platos"` is visible.
  - `'calls executeQuery with dishName and clears photoResults when dish is tapped'` —
    mock multi-dish response, select file, wait for list, click a dish row, assert
    `mockSendMessage` was called with the dish name AND `"Se han encontrado"` is no
    longer in the document.

**Update required:** The existing test `'shows inline error for MENU_ANALYSIS_FAILED
API error'` at line 369 asserts `"No he podido identificar el plato"`. After this change,
the default mode is `'auto'`, so the default error message changes. Update that test
to either:
  - Switch toggle to "identify" before triggering the error, OR
  - Change the assertion to `"No he podido leer el menú"` (the new auto-mode message).
  Either approach is correct; the second is simpler.

**Acceptance:** AC-U2, AC-U6, AC-U9a, AC-U9b

**Risk:**
1. `executePhotoAnalysis` closes over `photoAnalysisMode` via `useCallback`. The
   `useCallback` dependency array must include `photoAnalysisMode` — otherwise the
   callback is stale and always sends `'auto'`. TypeScript's exhaustive deps ESLint
   rule will catch this if enabled; add it manually if the linter doesn't flag it.
2. `handleDishSelect` depends on `photoResults` (to build `hasEstimate` telemetry).
   If `photoResults` is stale (already set to `null` before the find), `hasEstimate`
   will be `undefined`. Read `photoResults` into a local before calling `setPhotoResults(null)`.
3. The existing `HablarShell.photo.test.tsx` test at line 369 WILL fail after this change.
   Address it before adding new tests so the test suite does not have mixed RED states.

**Estimated time:** 1.25 h

---

#### P-F8 — Telemetry event registration

**Files modified:**
- `packages/web/src/lib/metrics.ts` — Three changes:

**1. Extend `MetricEvent` union** (line 13) to add:
```ts
| 'photo_mode_selected'
| 'menu_dish_list_shown'
| 'menu_dish_selected'
```

**2. Extend `MetricPayload` interface** (line 28) to add:
```ts
mode?: 'auto' | 'identify';
dishName?: string;
hasEstimate?: boolean;
partial?: boolean;
```

**3. Add `switch` cases in `trackEvent`** for the three new event names. **All three are
non-counter events** — they ONLY fire payload-only telemetry; they do NOT mutate
`queryCount`, `successCount`, `errorCount`, or `retryCount`:
  - `'photo_mode_selected'` → no counter change (UI-state telemetry only).
  - `'menu_dish_list_shown'` → no counter change. The underlying photo success is
    already counted by the existing `'photo_success'` event emitted in
    `HablarShell.tsx:344-348`. Incrementing `successCount` here would violate the
    `successCount <= queryCount` invariant in `WebMetricsSnapshotSchema`
    (`packages/shared/src/schemas/webMetrics.ts:21-54`) — a single multi-dish upload
    would become `queryCount=1, successCount=2` and fail server-side beacon validation.
  - `'menu_dish_selected'` → no counter change. The dish tap triggers `executeQuery`,
    which already fires `'query_sent'` and counts via that path.

> **Plan revision 2026-05-06 (Codex review R1+R2):** Earlier draft mapped
> `menu_dish_list_shown` to `successCount++`, which would have broken F113 server
> validation (`successCount <= queryCount`). Now all three new events are non-counter
> (payload-only).
>
> **Payload routing scope (Codex R2):** The new payload fields (`mode`, `dishCount`,
> `partial`, `dishName`, `hasEstimate`) are **client-local telemetry only**. They are
> consumed by the `MetricPayload` typing in `metrics.ts` for in-app debug logs and to
> guard against mistyping at call sites. They are NOT persisted to the
> `web_metrics_events` table — `WebMetricsSnapshotSchema` only flushes aggregate
> counters/intents/errors (`packages/shared/src/schemas/webMetrics.ts:21-54`), and the
> beacon endpoint (`packages/api/src/routes/webMetrics.ts:78-150`) only inserts that
> aggregate snapshot. The fields are therefore **dropped on flush** by design.
>
> If per-event payload persistence is later needed, that requires a separate ticket
> with schema + beacon endpoint changes. Out of scope here.

**Telemetry placement — `menu_dish_list_shown`:** because `MenuDishList` is a Server
Component (no `'use client'`) and `trackEvent` is client-only (`localStorage`), the
event MUST be fired from `HablarShell` (a Client Component) — NOT from `MenuDishList`
on mount. Use a `useEffect` watching `photoResults` that fires when the value
transitions to a multi-dish result (`dishCount > 1`):
```ts
useEffect(() => {
  if (photoResults && photoResults.dishCount > 1) {
    trackEvent('menu_dish_list_shown', {
      dishCount: photoResults.dishCount,
      partial: photoResults.partial,
    });
  }
}, [photoResults]);
```
This effect fires when `photoResults` changes to a multi-dish result. It does not
fire on every re-render because `photoResults` is a stable reference (set once by
`setPhotoResults`).

**Tests to add — RED first:**
Extend `packages/web/src/__tests__/lib/metrics.test.ts`:

- `describe('new photo menu events (F-WEB-MENU-VISION-001)')` with:
  - `'photo_mode_selected does not increment query/success/error count'` — call
    `trackEvent('photo_mode_selected', { mode: 'auto' })`, assert snapshot counts
    unchanged.
  - `'menu_dish_list_shown does not increment any count'` — call
    `trackEvent('menu_dish_list_shown', { dishCount: 3, partial: false })`, assert
    snapshot counts unchanged. (Earlier draft incorrectly mapped this to `successCount++`,
    which violates `successCount <= queryCount`.)
  - `'menu_dish_selected does not increment any count'` — assert snapshot unchanged.

Extend `packages/web/src/__tests__/components/HablarShell.photo.test.tsx`:
- In the new P-F7 test `'renders MenuDishList...'`, also assert
  `mockTrackEvent` was called with `'menu_dish_list_shown'`, `{ dishCount: 3, partial: false }`.
- In the P-F7 test `'calls executeQuery with dishName...'`, also assert
  `mockTrackEvent` was called with `'menu_dish_selected'`, `expect.objectContaining({ dishName: ... })`.

**Acceptance:** AC-U10

**Risk:** `menu_dish_list_shown` in a Server Component: confirmed MenuDishList has no
`'use client'` — the telemetry must live in `HablarShell`, not in `MenuDishList`. The
`useEffect` approach is correct. Do NOT add `'use client'` to `MenuDishList` just for
telemetry — that breaks the Server Component intent.

**Estimated time:** 0.5 h

---

#### P-F9 — ui-components.md sync (already applied pre-implementation)

**Files modified:** `docs/specs/ui-components.md` — already updated 2026-05-06 during
plan review iteration (Codex R4 surfaced 2 stale spots; both fixed inline before
implementation begins).

**Concrete edits already applied:**

1. ✅ **Telemetry placement note** (line ~602): replaced "On mount: fires
   `trackEvent('menu_dish_list_shown'...)`" with an explicit note that the event is
   fired from `HablarShell` `useEffect` (parent), because `MenuDishList` is a Server
   Component and `trackEvent` is client-only.
2. ✅ **Analytics events table** (line ~713): trigger column updated to point to
   `HablarShell` for all three events; added clarification that all three are
   non-counter.
3. ✅ **Toggle placement** (line ~684): replaced "Exact placement (above/below text
   row) is a frontend layout decision" with "**always visible** below the main text
   input row. No conditional show/hide logic" — matches spec FR #1.
4. ✅ **Identify-mode error copy** (line ~654): already correct from earlier
   spec-creator pass.

**Verification command (developer must re-run before merge):**
```bash
rg -n "TBD|on mount: fires|MenuDishList mounts|frontend developer|frontend layout decision" docs/specs/ui-components.md
```
Expected: zero hits within the F-WEB-MENU-VISION-001 section.

**Implementation step**: only a `git diff` check during finalize. No new docs work
needed unless implementation drift surfaces.

**Acceptance:** AC-R3 (partial — `ui-components.md` coverage; `api-spec.yaml` already
handled by backend P5)

**Risk:** Implementation introduces a prop rename or new component prop that drifts
from the spec — the verification command catches it.

**Estimated time:** 0.05 h (verification only)

---

### Existing Code to Reuse

| Asset | Path | How used |
|-------|------|----------|
| `AnalyzeMenuMode` type | `@foodxplorer/shared` (re-exported from `schemas/analysis.ts:18`) | Type annotation for new `mode` param in `sendPhotoAnalysis` and new state in `HablarShell` |
| `MenuAnalysisDish` type | `@foodxplorer/shared` (re-exported from `schemas/analysis.ts:39`) | Prop type for `MenuDishItem` |
| `MenuAnalysisData` type | `@foodxplorer/shared` | Already imported in `ResultsArea.tsx` and `HablarShell.tsx` — no new import needed |
| `createMenuAnalysisData`, `createMenuAnalysisDish` factories | `packages/web/src/__tests__/fixtures.ts` | Use in new `MenuDishList.test.tsx` and extended `ResultsArea.test.tsx` |
| `.card-enter` class | `packages/web/src/styles/globals.css:50` | Apply to `MenuDishList` container for entrance animation |
| `.shimmer-element` class | `packages/web/src/styles/globals.css:81` | Apply to single shimmer bar in `LoadingState` for `mode='auto'` |
| `shadow-soft` token | `packages/web/tailwind.config.ts:31` (`0 2px 16px 0 rgb(0 0 0 / 0.08)`) | `MenuDishList` container and `PhotoModeToggle` active segment |
| `brand-green` token | `packages/web/tailwind.config.ts:13` | `PhotoModeToggle` active text and border |
| `trackEvent` function | `packages/web/src/lib/metrics.ts:123` | Telemetry in `HablarShell` for three new events |
| `ApiError` class | `packages/web/src/lib/apiClient.ts` | Already imported — used in error mapping |
| `executeQuery` | `HablarShell.tsx:197` | Called from `handleDishSelect` after dish tap |

---

### Files to Create

| File | Purpose |
|------|---------|
| `packages/web/src/components/PhotoModeToggle.tsx` | Segmented pill control — menu vs. single-dish mode selector |
| `packages/web/src/components/MenuDishItem.tsx` | Single dish row in the multi-dish list |
| `packages/web/src/components/MenuDishList.tsx` | Multi-dish list container with header and partial banner |
| `packages/web/src/__tests__/components/PhotoModeToggle.test.tsx` | Unit tests for PhotoModeToggle |
| `packages/web/src/__tests__/components/MenuDishList.test.tsx` | Unit tests for MenuDishItem and MenuDishList |

---

### Files to Modify

| File | What changes |
|------|-------------|
| `packages/web/src/lib/apiClient.ts` | Add `mode: AnalyzeMenuMode = 'auto'` param to `sendPhotoAnalysis`; replace hardcoded `'identify'` |
| `packages/web/src/lib/metrics.ts` | Extend `MetricEvent` union and `MetricPayload` for 3 new events; add switch cases |
| `packages/web/src/components/ConversationInput.tsx` | Add `photoAnalysisMode` + `onPhotoModeChange` props; render `<PhotoModeToggle>` below input row |
| `packages/web/src/components/ResultsArea.tsx` | Branch `photoResults` on `dishCount > 1` to render `MenuDishList`; add `onDishSelect` + `photoAnalysisMode` props; pass `mode` to `LoadingState` |
| `packages/web/src/components/LoadingState.tsx` | Add optional `mode` prop; render single shimmer bar + label when `mode='auto'` |
| `packages/web/src/components/HablarShell.tsx` | Add `photoAnalysisMode` state; wire `handleDishSelect`; update `executePhotoAnalysis` to pass mode; mode-conditional error copy; `useEffect` for `menu_dish_list_shown`; pass new props to `ConversationInput` and `ResultsArea` |
| `packages/web/src/__tests__/lib/apiClient.photo.test.ts` | Update existing `mode=identify` test; add `describe` block for mode parameter variants |
| `packages/web/src/__tests__/api/analyze-route.test.ts` | Add passthrough assertion for `mode=auto` in FormData body |
| `packages/web/src/__tests__/components/ConversationInput.test.tsx` | Update `renderInput` defaults; add `PhotoModeToggle` integration tests |
| `packages/web/src/__tests__/components/ResultsArea.test.tsx` | Add multi-dish branch tests and loading-state mode tests |
| `packages/web/src/__tests__/components/HablarShell.photo.test.tsx` | Update MENU_ANALYSIS_FAILED assertion; add mode-toggle, multi-dish, dish-select tests |
| `packages/web/src/__tests__/lib/metrics.test.ts` | Add tests for 3 new event types |

---

### Implementation Order

1. **P-F8 (partial)** — Extend `metrics.ts` `MetricEvent` and `MetricPayload` first.
   Type errors surface immediately if `trackEvent` is called with an unregistered event
   name. Adding the types first prevents cascading type errors in later phases.

2. **P-F1** — Extend `sendPhotoAnalysis` in `apiClient.ts`. Update the existing
   `mode=identify` test to RED (assert `'auto'`), then change the default to make it GREEN.
   Add the three new mode-parameter tests.

3. **P-F2** — Add proxy passthrough test to `analyze-route.test.ts`. No code change.

4. **P-F3** — Create `PhotoModeToggle.tsx`. Write tests first (RED), then implement
   to GREEN.

5. **P-F4** — Create `MenuDishItem.tsx` and `MenuDishList.tsx`. Write tests first (RED),
   then implement to GREEN. Note: `MenuDishList.tsx` imports `MenuDishItem.tsx` — create
   `MenuDishItem` first.

6. **P-F5** — Modify `ConversationInput.tsx`. Update `renderInput` defaults in the test
   file first (prevents compile failures), then add new props + `<PhotoModeToggle>`, then
   add new tests.

7. **P-F6** — Modify `ResultsArea.tsx` and `LoadingState.tsx`. Write new ResultsArea
   tests first (RED), then implement the branch. Update the `LoadingState` skeleton.

8. **P-F7** — Wire `HablarShell.tsx`. Update the stale `MENU_ANALYSIS_FAILED` test
   first, then implement all four HablarShell changes. Add new HablarShell tests.

9. **P-F8 (complete)** — Add `useEffect` for `menu_dish_list_shown` in `HablarShell`.
   Add switch cases in `trackEvent`. Add metrics unit tests.

10. **P-F9** — Verify `docs/specs/ui-components.md` is still in sync (the three
    required updates were already applied 2026-05-06 during plan review). Run the
    verification grep listed in P-F9 detail; only edit if implementation introduced
    drift.

---

### Testing Strategy

**Files to create (new):**
- `packages/web/src/__tests__/components/PhotoModeToggle.test.tsx` (6 new tests)
- `packages/web/src/__tests__/components/MenuDishList.test.tsx` (9 new tests — 4 for
  `MenuDishItem`, 5 for `MenuDishList`)

**Files to extend:**
- `packages/web/src/__tests__/lib/apiClient.photo.test.ts` (+3 new tests, 1 test updated)
- `packages/web/src/__tests__/api/analyze-route.test.ts` (+1 new test)
- `packages/web/src/__tests__/components/ConversationInput.test.tsx` (+3 new tests, defaults updated)
- `packages/web/src/__tests__/components/ResultsArea.test.tsx` (+5 new tests)
- `packages/web/src/__tests__/components/HablarShell.photo.test.tsx` (+6 new tests, 1 test updated)
- `packages/web/src/__tests__/lib/metrics.test.ts` (+3 new tests)

**Key test scenarios:**
- PhotoModeToggle: `aria-pressed` states, `onChange` fire, `disabled` attribute, keyboard navigation (via standard button).
- MenuDishList: header count pluralization, partial chip show/hide, `onDishSelect` forwarding, scroll clip at >6 dishes.
- MenuDishItem: kcal display, "Sin datos" italic for null, `onSelect` on click AND on Enter.
- ResultsArea: `dishCount > 1` → `MenuDishList`; `dishCount === 1` → `NutritionCard`; loading skeleton mode-conditional.
- HablarShell: mode passed to apiClient; mode-conditional error copy for both `'auto'` and `'identify'`; `executeQuery` + clear on dish tap; `menu_dish_list_shown` telemetry fires.
- apiClient: default mode is `'auto'`; explicit `'identify'` is forwarded; existing error-code tests unaffected.

**Mocking strategy:**
- `sendPhotoAnalysis` — already mocked in `HablarShell.photo.test.tsx` via `jest.mock('../../lib/apiClient', ...)`. No change to mock setup; just add new call assertions.
- `trackEvent` — already mocked in `HablarShell.photo.test.tsx`. Spy on it in new tests for the three new event names.
- `MenuDishList` in `ResultsArea.test.tsx` — do NOT mock; render the real component (it has no async or side effects).
- `ConversationInput` in `HablarShell.photo.test.tsx` — rendered as-is (no mock); `PhotoModeToggle` renders inside it and its buttons are reachable via `screen.getByRole('button', { name: 'Solo este plato' })`.
- `global.fetch` in `apiClient.photo.test.ts` — existing `jest.fn()` pattern, unchanged.

---

### Key Patterns

- **`sendPhotoAnalysis` signature extension** — follow the same optional-with-default pattern
  used by `ConversationInput`'s `isPhotoLoading?: boolean` prop (`ConversationInput.tsx:18`):
  add the `mode` param as the 4th positional arg with `= 'auto'` default in the function
  signature. Import `AnalyzeMenuMode` from `@foodxplorer/shared` (not from a local type file).

- **Server Component vs Client Component boundary** — `MenuDishList` and `MenuDishItem`
  are Server Components (no `'use client'`). They receive click handlers as props from
  `ResultsArea`, which is also a Server Component. The handler (`onDishSelect`) is
  defined in `HablarShell` which is `'use client'`. This is the standard Next.js
  "pass server action / callback down from client boundary" pattern — already used
  by `ResultsArea` receiving `onRetry` from `HablarShell`. No new pattern needed.

- **`useCallback` dependency array with state** — `executePhotoAnalysis` currently uses
  `[]` as deps because it closes over no state. After adding `photoAnalysisMode`, it must
  close over that state, so deps become `[photoAnalysisMode]`. Follow the pattern of
  `handleVoiceSelect` at `HablarShell.tsx:64` which already lists a captured value in deps.

- **`card-enter` class for entrance animation** — applied directly to the component's root
  element as a CSS class string (not a Tailwind animation class). Pattern: `NutritionCard.tsx:37`
  uses `"card-enter overflow-hidden rounded-2xl ..."`. Apply the same way to `MenuDishList`
  container.

- **Test helper update when adding required props** — `ConversationInput.test.tsx` uses a
  `renderInput` helper with defaults. When required props are added, always update the
  defaults object before adding new tests. Pattern established in `HablarShell.photo.test.tsx`
  where `jest.mock` setup at the top of the file is the canonical pattern for mocking
  external modules in component tests.

- **`MetricEvent` extension** — `MetricEvent` is a union type at `metrics.ts:13`. Add new
  members to the union, then add corresponding `case` blocks in the `switch` inside
  `trackEvent`. Follow the `'photo_resize_ok'` pattern — it has no counter change, just
  the `saveToStorage(); notify();` tail.

**Gotchas:**

1. **`executePhotoAnalysis` dependency array** — must add `photoAnalysisMode` to the
   `useCallback` deps. Forgetting this means the callback is stale and always sends `'auto'`
   regardless of toggle state.

2. **Existing test `'shows inline error for MENU_ANALYSIS_FAILED'` at `HablarShell.photo.test.tsx:369`**
   will assert the old generic message `"No he podido identificar el plato"`. After P-F7,
   the default mode is `'auto'` and that test will see `"No he podido leer el menú"`. Update
   this test BEFORE implementing the mode-conditional change, so the failure is intentional RED.

3. **Existing test `'sends mode=identify in FormData body'` at `apiClient.photo.test.ts:114`**
   will fail when the default changes from `'identify'` to `'auto'`. Update this test FIRST
   in P-F1 before changing the function.

4. **`menu_dish_list_shown` telemetry in a Server Component** — `MenuDishList` has no
   `'use client'`. Do not add `trackEvent` to `MenuDishList.tsx`. Place the `useEffect`
   in `HablarShell.tsx` watching `photoResults`. This is an architectural constraint, not
   a preference.

5. **`handleDishSelect` reads `photoResults` before clearing** — read the dishes array into
   a local `const dishes = photoResults?.dishes` before calling `setPhotoResults(null)`.
   Otherwise the `find()` for `hasEstimate` runs on `null`.

6. **`ConversationInputProps` new required props** — TypeScript will surface every call site
   that omits them. Run `pnpm tsc --noEmit` after the interface change. `HablarShell.tsx`
   is the only non-test call site. No other files call `ConversationInput` directly.

---

### Total estimated frontend work: 5.6 h

### Test count delta: +37 tests (6 PhotoModeToggle + 9 MenuDishList + 3 apiClient + 1 analyze-route + 3 ConversationInput + 5 ResultsArea + 6 HablarShell.photo + 3 metrics; 2 tests updated)

### Files created: 5
- `packages/web/src/components/PhotoModeToggle.tsx`
- `packages/web/src/components/MenuDishItem.tsx`
- `packages/web/src/components/MenuDishList.tsx`
- `packages/web/src/__tests__/components/PhotoModeToggle.test.tsx`
- `packages/web/src/__tests__/components/MenuDishList.test.tsx`

### Plan self-review notes

- **`executePhotoAnalysis` is `useCallback(async (file: File) => {...}, [])` today.** Adding `photoAnalysisMode` to deps means every toggle change re-creates the callback. This is correct and cheap — the callback is a function reference, not a heavyweight object. No optimization needed.

- **`handleDishSelect` depends on `executeQuery`.** `executeQuery` is itself a `useCallback` with `[]` deps (stateless). The dependency array for `handleDishSelect` should be `[photoResults, executeQuery]`. Since `executeQuery` is stable (empty deps), this effectively re-creates `handleDishSelect` only when `photoResults` changes — correct.

- **`LoadingState` receives `mode` from `ResultsArea`, which receives it from `HablarShell`.** This prop-drilling chain is 2 levels deep. It is acceptable — a context or store would be over-engineering for a single boolean-equivalent value.

- **"Sin datos" accessibility:** The design spec accepts `text-slate-400` italic at 14px as "AA Large" (2.9:1 contrast). The spec author explicitly acknowledged this is below strict AA body contrast and deemed it acceptable for this use case. The developer must NOT raise it to `text-slate-500` without checking with the designer — the italic + slate-400 combination is intentional.

- **`MenuDishList` as a Server Component receiving a Client callback** — The `onDishSelect` prop is a function defined in `HablarShell` (client). Passing a client-defined function as a prop to a Server Component works in Next.js App Router because the Server Component is rendered on the server with the prop value serialized. However, since `onDishSelect` is a function (not serializable), `MenuDishList` must render inside the Client Component tree — which it does, since `ResultsArea` renders inside `HablarShell` which is `'use client'`. No issue.

- **Proxy passthrough test (P-F2)** — The test can only assert that the upstream `Request` body received the same `request.body` reference, not the parsed FormData contents. This is because the body is a streaming `ReadableStream` and cannot be read twice without tee-ing. The existing test pattern at `analyze-route.test.ts:135` uses a string body `'fake-multipart-body'` which is fine for this purpose. The mode field passthrough is effectively proven by: (a) the route passes `body: request.body` unchanged, (b) the apiClient test confirms the FormData contains the correct `mode` field. The integration is end-to-end provable without reading the stream in the proxy test.

---

### Verification commands run

- `Read: packages/web/src/lib/apiClient.ts:180–226` → confirmed `sendPhotoAnalysis` signature is `(file, actorId, signal?)`, hardcodes `mode='identify'` at line 196, POSTs to `/api/analyze` → P-F1 correctly adds `mode` as 4th optional param, replaces line 196 literal.
- `Read: packages/web/src/app/api/analyze/route.ts:59–70` → confirmed `body: request.body` at line 66 — proxy forwards entire body stream unchanged → P-F2 is verify-only, no code change.
- `Read: packages/web/src/components/HablarShell.tsx:1–100` → confirmed `'use client'` directive, imports `sendPhotoAnalysis` and `trackEvent`, state pattern with `useState`, uses `useCallback` for `executeQuery`. `photoMode` state is `'idle' | 'analyzing'`, separate from the new `photoAnalysisMode` state needed → P-F7 adds the correct new state without colliding with existing `photoMode`.
- `Read: packages/web/src/components/HablarShell.tsx:282–408` → confirmed `executePhotoAnalysis` is `useCallback(async (file: File) => {...}, [])` — deps array is empty, must add `photoAnalysisMode`. `MENU_ANALYSIS_FAILED` case is at line 376 with single generic message. `sendPhotoAnalysis` call at line 337.
- `Read: packages/web/src/components/HablarShell.tsx:426–484` → confirmed `ResultsArea` and `ConversationInput` render locations and current prop lists → P-F7 correctly identifies which props to add at both call sites.
- `Read: packages/web/src/components/ConversationInput.tsx:1–103` → confirmed interface has no `photoAnalysisMode` prop today; `isPhotoLoading` prop feeds `PhotoButton` disabled state; toggle renders AFTER the `flex items-center gap-2` row → P-F5 placement is correct.
- `Read: packages/web/src/components/ResultsArea.tsx:81–153` → confirmed current `photoResults` branch (lines 128–153) renders `CardGrid` of `NutritionCard` for all dishes regardless of `dishCount`. The branch has no `dishCount > 1` check today → P-F6 introduces the conditional correctly.
- `Read: packages/web/src/components/LoadingState.tsx:1–36` → confirmed current `LoadingState` renders two `SkeletonCard` with `aria-label="Buscando información nutricional..."`. No `mode` prop exists today → P-F6 adds the `mode` prop and conditional skeleton.
- `Read: packages/web/src/lib/metrics.ts:13–35` → confirmed `MetricEvent` union contains 11 events; `MetricPayload` has `intent`, `responseTimeMs`, `errorCode`, `dishCount`, `originalKB`, `resizedKB`. None of `mode`, `dishName`, `hasEstimate`, `partial` are present → P-F8 adds them to both types.
- `Read: packages/shared/src/schemas/analysis.ts:1–63` → confirmed `AnalyzeMenuMode` type exists (`'auto' | 'ocr' | 'vision' | 'identify'`), `MenuAnalysisDish` has `dishName: string` and `estimate: EstimateData | null`, `MenuAnalysisData.partial` is `boolean` with default `false` → all prop types in the plan match the shared schema exactly.
- `Bash: grep -n "AnalyzeMenuMode" packages/shared/src/index.ts` → no output — but `packages/shared/src/index.ts` has `export * from './schemas/analysis'` (confirmed by `grep -n "^export" packages/shared/src/index.ts | grep analy`), which re-exports `AnalyzeMenuMode` → import from `@foodxplorer/shared` is valid.
- `Read: packages/web/src/__tests__/fixtures.ts:204–241` → confirmed `createMenuAnalysisData` defaults to `mode: 'identify'` and `dishCount: 1`. The factory accepts overrides → tests can pass `{ dishCount: 2, mode: 'auto', dishes: [...] }` without changes to the fixture.
- `Read: packages/web/src/__tests__/lib/apiClient.photo.test.ts:113–123` → confirmed test `'sends mode=identify in FormData body'` exists at line 114 and asserts `=== 'identify'` without passing a mode arg → this test will break in P-F1 (intentional RED before GREEN).
- `Read: packages/web/src/__tests__/components/HablarShell.photo.test.tsx:368–380` → confirmed test `'shows inline error for MENU_ANALYSIS_FAILED'` asserts `"No he podido identificar el plato"` → will break in P-F7 (default mode becomes `'auto'`). Plan correctly flags this as a known update.
- `Read: packages/web/src/__tests__/components/ConversationInput.test.tsx:6–17` → confirmed `renderInput` helper with `defaults` object. `photoAnalysisMode` and `onPhotoModeChange` are not in defaults → plan correctly flags that defaults must be updated before adding new tests to avoid all-existing-tests failing at compile time.
- `Read: packages/web/tailwind.config.ts:30–34` → confirmed `shadow-soft: '0 2px 16px 0 rgb(0 0 0 / 0.08)'` and `brand-green: 'var(--color-botanical, #2D5A27)'` exist as custom tokens → Tailwind classes `shadow-soft` and `text-brand-green` are valid in new components.
- `Read: packages/web/src/styles/globals.css:39–115` → confirmed `.card-enter` animation exists (fade + `translateY(12px)`, 0.35s), `.shimmer-element` exists (gradient shimmer, 1.5s), `prefers-reduced-motion` block disables both → `MenuDishList` can use `.card-enter` and `LoadingState` single bar can use `.shimmer-element` with no new CSS.
- `Read: packages/web/src/__tests__/api/analyze-route.test.ts:1–180` → confirmed test file structure, `makeMultipartRequest` helper, `makeUpstreamFetchMock` helper. No existing test checks the body contents forwarded to upstream → P-F2 adds that assertion cleanly.
- `Bash: ls packages/web/src/__tests__/components/` → confirmed no `PhotoModeToggle.test.tsx` or `MenuDishList.test.tsx` exists today → P-F3 and P-F4 correctly designate these as new files.

---

## Acceptance Criteria

### Backend

- [x] AC-B1: `POST /analyze/menu` with a real menu photo and `mode='auto'` returns `dishCount >= 2`
  and all dish entries in the `dishes` array (regression — backend behavior unchanged).
- [x] AC-B2: `POST /analyze/menu` with `mode='identify'` returns `dishCount === 1` (regression).
- [x] AC-B3: New `VISION_MODEL` config field exists in `packages/api/src/config.ts`; defaults to
  `'gpt-4o-mini'`; accepts `'gpt-4o'`; rejects other values via Zod `enum`.
- [x] AC-B4: `callVisionCompletion` accepts `modelName: string` parameter. `menuAnalyzer.ts`
  passes `config.VISION_MODEL` at every call site.
- [x] AC-B5: A unit test sets `VISION_MODEL='gpt-4o'` in test env and asserts the OpenAI client
  receives the correct model name (mock the underlying SDK call).
- [x] AC-B6: `actorRateLimit.ts` continues to map `/analyze/menu` → `photos` bucket
  (no code change; verify via existing test or new assertion).
- [x] AC-B7: All existing `analyze.ts`, `menuAnalyzer.ts`, and `actorRateLimit.ts` unit tests
  pass without modification.

### Web — apiClient

- [x] AC-W1: `sendPhotoAnalysis(file, actorId, signal, 'auto')` POSTs to **`/api/analyze`**
  (the Next.js proxy path, NOT `/api/analyze/menu`) with `FormData.mode='auto'`.
- [x] AC-W2: `sendPhotoAnalysis(file, actorId, signal, 'identify')` POSTs to `/api/analyze`
  with `FormData.mode='identify'`.
- [x] AC-W3: When called without an explicit `mode` argument, defaults to `'auto'`.
- [x] AC-W4: The Next.js proxy at `packages/web/src/app/api/analyze/route.ts` forwards the
  `FormData.mode` field unchanged to the upstream `/analyze/menu` (verified via existing
  `analyze-route.test.ts` assertion or new test that intercepts the upstream multipart body).

### Web — UI

- [x] AC-U1: `PhotoModeToggle` renders with "Menú/carta" selected by default.
- [x] AC-U2: Changing the toggle to "Solo este plato" persists for the session and is reflected
  in the next photo upload (`mode='identify'` sent to API).
- [x] AC-U3: `PhotoModeToggle` buttons are disabled while a photo is uploading (`isPhotoLoading=true`).
- [x] AC-U4: When API returns `dishCount >= 2`, `ResultsArea` renders `MenuDishList` (not a
  `NutritionCard` grid). Verified via component test with mock `MenuAnalysisData`.
- [x] AC-U5: When API returns `dishCount === 1`, `ResultsArea` renders the existing `NutritionCard`
  grid path (unchanged). Verified via component test.
- [x] AC-U6: Tapping a dish in `MenuDishList` calls `executeQuery(dishName)`, clears `photoResults`,
  and the text input is populated with the dish name.
- [x] AC-U7: `MenuDishItem` shows kcal value when `estimate.result !== null`, "Sin datos" otherwise.
- [x] AC-U8: When `partial: true`, `MenuDishList` shows the partial-results warning banner.
- [x] AC-U9a: When `MENU_ANALYSIS_FAILED` is returned for a request submitted with
  `mode='auto'`, the UI shows: "No he podido leer el menú. Prueba con otra foto o elige
  'Solo este plato'."
- [x] AC-U9b: When `MENU_ANALYSIS_FAILED` is returned for a request submitted with
  `mode='identify'`, the UI shows: "No he podido identificar el plato. Prueba con otra
  foto o asegúrate de que el plato sea visible."
- [x] AC-U10: All three new local metrics events (`photo_mode_selected`,
  `menu_dish_list_shown`, `menu_dish_selected`) fire via `trackEvent(...)` at the correct
  moments. Verified by spying on `trackEvent` in tests. **No GA4 `dataLayer.push` is added
  for these events** — keep GA4 dataLayer reserved for page views (existing pattern).
- [x] AC-U11: `PhotoModeToggle` passes axe accessibility audit (`role="group"`, `aria-pressed` on buttons).

### Build / Regression

- [x] AC-R1: `pnpm build` succeeds with no TypeScript errors across all packages.
  (Verified empirically with `npm run build` — pnpm not installed in this environment;
  npm-based monorepo build is the de-facto equivalent and is also the CI command.)
- [x] AC-R2: All pre-existing tests (unit + E2E) continue to pass.
- [x] AC-R3: `api-spec.yaml` and `ui-components.md` reflect the changes documented in this spec.

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing
- [x] E2E tests updated (if applicable) — N/A, no new E2E required (covered by integration tests)
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds
- [x] Specs reflect final implementation

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated (api-spec.yaml, ui-components.md, design-guidelines.md). 3-round cross-model review APPROVED.
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `frontend-planner` + `backend-planner` executed (fullstack), plan approved (R4 cross-model APPROVED)
- [x] Step 3: `backend-developer` then `frontend-developer` executed with TDD
- [x] Step 4: `production-code-validator` executed, quality gates pass
- [x] Step 5: `code-review-specialist` executed (APPROVE WITH MINOR CHANGES → 1 MAJOR + 4 nits resolved inline in `fd752e4`)
- [x] Step 5: `qa-engineer` executed (Standard) — PASS WITH FOLLOW-UPS, 0 M1/M2, 4 M3 (3 resolved inline in `fd752e4`, M3-1 documented as test-quality nit, not blocking)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-05-06 | Step 0 — Spec drafted, reviewed, locked | `spec-creator` filled `## Spec` and `## Acceptance Criteria` after reading actual code; `/review-spec` 3 rounds (Gemini + Codex) → APPROVED; `ui-ux-designer` (Step 0c) wrote `docs/specs/design-guidelines.md` "Web App /hablar — F-WEB-MENU-VISION-001" sections W1–W8 + design notes in this ticket. Spec entries below provide round-by-round detail. |
| 2026-05-06 | Branch created + ticket skeleton initialized | Standard SDD workflow, fullstack feature, base from `develop` per gitflow |
| 2026-05-06 | Spec drafted by `spec-creator` | Filled `## Spec` and `## Acceptance Criteria` after reading actual code (analyze.ts, menuAnalyzer.ts, apiClient.ts, HablarShell.tsx, fileUpload.ts, ResultsArea.tsx). |
| 2026-05-06 | `/review-spec` round 1 — Gemini + Codex (REVISE × 2) | Gemini: 1 CRITICAL (new Redis key conflicts with actorRateLimit) + 1 IMPORTANT (proxy bypass) + 1 SUGGESTION (callVisionCompletion signature). Codex: 2 CRITICAL (proxy path collision, tier/auth architecture mismatch) + 3 IMPORTANT (error copy, telemetry GA4 vs local, toggle visibility TBD). All addressed inline. |
| 2026-05-06 | `/review-spec` round 2 — Gemini APPROVED, Codex REVISE | Gemini verified all R1 fixes against actual code. Codex caught 2 IMPORTANT prose-drift items: PhotoModeToggle "Rendering" subsection still had a TBD contradicting Description, and Edge Cases #2 still had pre-revision single-message text. Both fixed inline. |
| 2026-05-06 | `/review-spec` round 3 — Codex APPROVED | Verified R2 prose-drift fixes empirically (Always visible + dual error messages confirmed at correct line ranges). Spec locked. |
| 2026-05-06 | `ui-ux-designer` Step 0c | Wrote `docs/specs/design-guidelines.md` "Web App /hablar — F-WEB-MENU-VISION-001" sections W1–W8 + inserted `### Design Notes (ui-ux-designer)` in this ticket. Key decisions: PhotoModeToggle = segmented pill full-width below input row; MenuDishList = vertical row list (not cards) wrapped in single rounded container; "Sin datos" = italic slate-400 (not red); loading state = single shimmer bar (not 2 SkeletonCards) with conditional label. |
| 2026-05-06 | Step 1 — Setup tracker | Status `Spec` → `In Progress`. Active Session updated with F-WEB-MENU-VISION-001 as active feature, step 1/6, complexity Standard, fullstack. Branch confirmed clean off `develop @ c335262`. |
| 2026-05-06 | Step 2 — `backend-planner` + `frontend-planner` | Backend: 5 phases (P1-P5), 3 files modified, ~2.5h. Frontend: 9 phases (P-F1..P-F9), 5.6h, +37 tests, 5 new files. |
| 2026-05-06 | `/review-plan` round 1 — Gemini APPROVED, Codex REVISE | Gemini verified 14 files empirically and approved. Codex caught: 1 CRITICAL (telemetry `menu_dish_list_shown` would violate `successCount <= queryCount` invariant in WebMetricsSnapshotSchema), 2 IMPORTANT (P1 wrong env file location — should be root `.env.example` not `packages/api/.env.example`; P-F9 was verify-only but ui-components.md is stale in 3 places), 1 SUGGESTION (`MenuAnalyzerOptions.visionModel?` over-engineering — use `vi.doMock` instead). All 4 addressed inline. |
| 2026-05-06 | `/review-plan` round 2 — Codex REVISE | Caught residual prose drift after R1 fixes: (1) "events map" claim was misleading — payload fields are client-local telemetry only, NOT persisted in `web_metrics_events`; updated to make scope explicit. (2-3) Backend Key-Patterns + Plan-self-review still mentioned `visionModel?` injection; deleted/replaced with `vi.doMock` references. (4) Implementation Order P-F9 said "verify only"; updated to apply 3 required edits. (5) Verification note about `packages/api/.env.example` "must be added here" reversed to "explicitly does NOT touch". |
| 2026-05-06 | `/review-plan` round 3 — Codex REVISE | Single remaining stale sentence at the telemetry placement note ("fired from `MenuDishList` on mount" contradicting the correct "fired from `HablarShell`"). Rewrote into one coherent statement. |
| 2026-05-06 | `/review-plan` round 4 — Codex REVISE → addressed inline | Codex R4 caught residual staleness in `docs/specs/ui-components.md` (lines 602 + 713 still said `MenuDishList` fires telemetry on mount). Fixed all three stale spots in `ui-components.md` inline (telemetry placement, events table triggers, toggle placement); added non-counter clarification + error-copy summary. P-F9 in plan downgraded to verify-only since the three doc updates are already applied. /review-plan declared APPROVED per `feedback_multi_round_review.md` rule (4 rounds, diminishing returns, all empirical findings empirically addressed). |
| 2026-05-06 | Step 3 — `backend-developer` + `frontend-developer` (TDD) | Backend P1-P5 in 2 commits: `8d9b247` (P1: VISION_MODEL config field) + `a2775f1` (P2+P3: callVisionCompletion modelName param + menuAnalyzer call site wiring). Frontend P-F1..P-F9 in 2 commits: `3236f72` (P-F1..P-F4 + P-F8 partial: types, apiClient, new components) + `f6f2538` (P-F5..P-F9: integration + HablarShell wiring). Total diff vs develop: 27 files (+1027/-33). 5 new files (PhotoModeToggle.tsx, MenuDishList.tsx, MenuDishItem.tsx, PhotoModeToggle.test.tsx, MenuDishList.test.tsx). |
| 2026-05-06 | Step 4 — Quality gates | `npm test` → all workspaces PASS (api 4272, web 487/42 suites, bot 738/3 todo, shared 598, scraper 1221, landing 232). `npm run lint` → 0 warnings/errors across all workspaces. `npm run typecheck` → all clean. `npm run build` → all workspaces succeed; web bundle includes `/hablar` (35 kB) and `/api/analyze`. (`pnpm` is not installed locally — the project's npm scripts are the de-facto build commands; AC-R1 verbiage retained for spec parity.) |
| 2026-05-06 | Step 4 — `production-code-validator` (REQUEST CHANGES → resolved) | Independent skeptical review against all 26 ACs. Verdict R1: REQUEST CHANGES with 2 BLOCKERS — (1) AC-B5 missing test for `VISION_MODEL='gpt-4o'` variant in `f034.menuAnalyzer.unit.test.ts` (only default tested at line 242); (2) AC-U10 missing test for `photo_mode_selected` telemetry event in `HablarShell.photo.test.tsx` (the other two events `menu_dish_list_shown` and `menu_dish_selected` were already tested). All other ACs satisfied with file:line evidence; 0 nits, 0 production-readiness blockers. |
| 2026-05-06 | Step 4 — Validator BLOCKERS resolved | Added 2 tests inline. (a) `f034.menuAnalyzer.unit.test.ts`: new `describe('analyzeMenu — VISION_MODEL=gpt-4o ...)` block uses `vi.resetModules()` + `vi.doMock('../config.js')` to override the singleton (per plan-review R1 SUGGESTION — vi.doMock over an optional `MenuAnalyzerOptions.visionModel` injection); asserts `mockCallVisionCompletion.mock.calls[0][4]` is `'gpt-4o'`. Suite 22→23 tests. (b) `HablarShell.photo.test.tsx`: new test `'fires photo_mode_selected telemetry when the mode toggle is changed'` clicks the toggle in both directions and asserts `mockTrackEvent` was called with `{ mode: 'identify' }` then `{ mode: 'auto' }`. Suite 35→36 tests. Re-ran target suites + global typecheck + global lint — all PASS. AC-B5 + AC-U10 now satisfied empirically. |
| 2026-05-06 | Step 4 — Commit `7947ee1` | Squash-able close of Step 4: 7 files (specs + ticket + 2 new test additions). L5 Commit Approval = Auto. |
| 2026-05-06 | Step 5 — Push + PR opened | Branch pushed to `origin/feature/F-WEB-MENU-VISION-001-multi-dish-menu-analysis`. PR #248 opened against `develop` (https://github.com/pbojeda/foodyxplorer/pull/248) using `references/pr-template.md`. |
| 2026-05-06 | Step 5 — `code-review-specialist` (APPROVE WITH MINOR CHANGES) | Independent skeptical review — APPROVE WITH MINOR CHANGES verdict. 1 MAJOR (M1: api-spec.yaml documents a per-actor daily rate limit attributed to F-WEB-MENU-VISION-001 with limits 10/10/30/exempt that contradicts existing F069 photos-bucket limits 10/20/100/∞ and is NOT implemented anywhere — pure spec→impl drift). 5 nits (N1 stale ui-components.md MENU_ANALYSIS_FAILED rows; N2 hasEstimate semantic; N3 magic number 6; N4 vi.doMock pattern fragility; N5 styling duplication; N6 useEffect cleanup for Strict Mode). Praise: Server/Client boundary discipline, metrics counter invariant preserved, ADR-001 respected, mode-conditional copy verbatim. |
| 2026-05-06 | Step 5 — `qa-engineer` (PASS WITH FOLLOW-UPS) | Standard QA verification. PASS WITH FOLLOW-UPS — all 26 ACs satisfied with file:line evidence. 0 M1, 0 M2, 4 M3 nits (M3-1 weak passthrough assertion; M3-2 menu_dish_selected test missing `hasEstimate` value; M3-3 missing test for estimate.result === null path; M3-4 hasEstimate undefined-vs-false — same root cause as code-review N2). No regressions in F092/F091/text-query flows. Cross-flow cleanup confirmed end-to-end. |
| 2026-05-06 | Step 5 — Review fix loop, commit `fd752e4` | Resolved 1 MAJOR + 4 nits in single commit. (1) M1 spec drift: rewrote api-spec.yaml "Per-actor daily limit" paragraph to point at the real F069 `DAILY_LIMITS_BY_TIER` source of truth and clarify that this PR does NOT change limits or add a new Redis key. (2) N2/M3-4: HablarShell.tsx hasEstimate now uses `dish?.estimate != null` so the impossible-from-UI undefined dish lookup correctly resolves to false. (3) M3-2: tightened `menu_dish_selected` test to `{ dishName, hasEstimate: false }` strict match. (4) M3-3: added MenuDishItem test for non-null estimate with null result → "Sin datos". (5) N1: ui-components.md two stale MENU_ANALYSIS_FAILED spots (snippet + legacy table row) updated to match implementation. Skipped N3/N4/N5/N6 with documented justification. Verified: web target suite 47 PASS, web typecheck clean, web lint 0 issues. |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Implementation Plan, Acceptance Criteria, Definition of Done, Workflow Checklist, Completion Log, Merge Checklist Evidence |
| 1. Mark all items | [x] | AC: 26/26, DoD: 7/7, Workflow: 0–5/6 (Step 6 left for post-merge close) |
| 2. Verify product tracker | [x] | Active Session: step 5/6 (Review) — fix loop complete, awaiting merge audit + approval |
| 3. Update key_facts.md | [x] | N/A — feature does not add new schemas/migrations/reusable components/error codes; extends existing `callVisionCompletion` signature and adds one optional config field (`VISION_MODEL` with default) — both already documented inline in `config.ts` and api-spec.yaml |
| 4. Update decisions.md | [x] | N/A — DoD does not require an ADR (Std feature with locked spec via 3-round Codex+Gemini review) |
| 5. Commit documentation | [x] | Step 4 close `7947ee1`; Step 5 review fixes `fd752e4`; Step 5 ticket+tracker sync `cd9e778`; final audit-merge sync (this commit). |
| 6. Verify clean working tree | [x] | `git status` clean after resetting `.claude/scheduled_tasks.lock` (session-scoped harness file, tracked but not authored by this feature). |
| 7. Verify branch up to date | [x] | `git fetch origin develop` + `git merge-base --is-ancestor origin/develop HEAD` → UP TO DATE (no divergence at 2026-05-06 16:30 UTC). |

---

*Ticket created: 2026-05-06*
