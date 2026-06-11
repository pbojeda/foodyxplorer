# F-ADMIN-ANALYTICS-UI: Admin Analytics UI for Telemetry-Driven Beta Readiness

**Feature:** F-ADMIN-ANALYTICS-UI | **Type:** Fullstack (Frontend + Backend + Shared Schemas) | **Priority:** High (beta readiness gate)
**Status:** Ready for Merge | **Branch:** `feature/F-ADMIN-ANALYTICS-UI` (off develop @ `46fc0ba`, created 2026-06-10) | **Merged:** —
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-06-10 | **Tier:** Standard-grande | **Dependencies:** F079 ✅ F029 ✅ F113 ✅ F-WEB-HISTORY ✅ F107a ✅ F-WEB-TIER ✅ | **ADR:** ADR-031 (Bearer-only admin auth for `/analytics/*`)

---

## Spec

### Description

Owner needs an admin-only web dashboard at `/admin/analytics` to support two pre-beta use cases:

1. **Missed query identification:** Surface search queries that returned no result (`level_hit IS NULL`) so Pablo can prioritize feed expansion. Consumes existing `GET /analytics/missed-queries` (F079) and the existing batch tracking/status endpoints.
2. **Response correctness audit:** Sample recent `search_history` rows to review query↔response pairs for correctness. Requires one new endpoint `GET /analytics/history-sample` that queries `search_history` directly.

80% of the backend telemetry surface already exists in prod (F029, F079, F113). This ticket adds:
- **Phase 0 — Auth migration (ADR-031):** Convert the `/analytics/*` admin gate from `X-API-Key === ADMIN_API_KEY` to **bearer-only** (JWT bearer + `Account.tier === 'admin'`). Required because the admin web UI cannot ship an API key from the browser, and owner explicitly chose bearer-only for both Postman and the web app. Other admin prefixes (`/ingest/`, `/quality/`, `/embeddings/`, `/admin/`) keep their current X-API-Key gate — scope is surgical.
- The admin web route + UI panels (`packages/web/src/app/admin/`)
- One new API endpoint (`GET /analytics/history-sample`)
- New Zod schemas for that endpoint
- A minimal i18n infrastructure (`useT` hook) scoped exclusively to the admin UI
- An operator step to set `NEXT_PUBLIC_METRICS_ENDPOINT` in Vercel so web-events beacons actually fire

No new DB migrations, no new tiers. **ADR-031 required** because Phase 0 is a behavioural reversal of the F029/F079/F113 auth contract that already shipped to prod.

### Phase 0 — API Auth Migration (`/analytics/*` → bearer-only)

**Why required (cross-model `/review-spec` round 1 CRITICAL):** The current admin gate in `packages/api/src/plugins/auth.ts:80-92` calls `validateAdminKey(headers['x-api-key'], config.ADMIN_API_KEY)` for *all* admin routes (any `ADMIN_PREFIXES` match — see `adminPrefixes.ts:7`). The browser cannot ship `ADMIN_API_KEY` (would leak via Vercel bundle), so the admin UI cannot reach `/analytics/*` until the gate accepts bearer.

**Scope of Phase 0 — surgical, /analytics/* only:**

1. **`packages/api/src/plugins/adminPrefixes.ts`** — split the prefix list into two groups: `ANALYTICS_PREFIX = '/analytics/'` (bearer-only path) vs `KEY_ADMIN_PREFIXES = ['/ingest/', '/quality/', '/embeddings/', '/admin/']` (X-API-Key path). Existing `ADMIN_PREFIXES` constant preserved as the union for any consumer that still needs the full set. Add helpers `isAnalyticsRoute(url, method)` and `isKeyAdminRoute(url, method)` — **both method-aware** (per `/review-plan` round 1 IMPORTANT — Codex): `isKeyAdminRoute` must encapsulate the `/restaurants` method-specific rule (`POST /restaurants` is admin via key, `GET /restaurants` is public catalog) so callers don't reimplement the special case. Keep the `POST /analytics/web-events` public exemption inside `isAnalyticsRoute`.

2. **`packages/api/src/plugins/auth.ts`** — split the admin branch:
   - **If `isAnalyticsRoute(url, method)`:** Do NOT validate API key. Skip — the bearer path runs in `actorResolver.ts` (which is already registered AFTER `auth.ts` in `app.ts:125-126`). The `/analytics/*` route handlers themselves (or a new lightweight `requireAdminBearer` preHandler attached to the analytics routes plugin) verify `request.accountId` is set + load `Account.tier === 'admin'` from DB → 401 if no bearer, 403 if tier ≠ admin.
   - **If `isKeyAdminRoute(url)`:** Keep existing `validateAdminKey` flow unchanged.

3. **Hook order:** `actorResolver.ts` already pre-resolves `request.accountId` from bearer for all routes that have an `Authorization` header (lines 73-80+). Phase 0 needs the auth admin branch to NOT block `/analytics/*` requests with a bearer before actorResolver gets to set `accountId`. Verify in implementation that hook ordering produces the expected sequence for `/analytics/*` paths.

4. **New helper:** `packages/api/src/plugins/requireAdminBearer.ts` — preHandler attached at the analytics route plugin level. Behavior:
   - **No bearer (`request.accountId` unset):** throw 401 `UNAUTHORIZED`.
   - **Bearer present + `accounts` row missing:** throw 403 with **distinct code `NOT_PROVISIONED`** and hint message "Account not provisioned. Call GET /me once to provision, then retry." Web flow already calls `getMe()` on `SIGNED_IN`/`INITIAL_SESSION` (`AuthProvider.tsx`), so this only affects Postman/curl users who skip `/me`. Documented as one-time onboarding step in operator runbook.
   - **Bearer present + account row exists + `tier === 'admin'`:** continue. Tier value (`'admin'` string) is cached at the existing `accountTier.ts` Redis key `account:tier:<sub>` with 60s TTL. **Cache contract: tier string only**, NOT a richer account object — preserves the existing single-purpose key shape and avoids breaking `actorRateLimit.ts` or other readers that consume `account:tier:<sub>` as a string. If the handler needs more account fields beyond `tier`, fetch them ad-hoc within the route (rare; most analytics routes only need the gate).
   - **Bearer present + account row exists + `tier !== 'admin'`:** throw 403 with **code `FORBIDDEN`** and message "Admin tier required." No provisioning hint (user IS provisioned, just not admin). Distinct from `NOT_PROVISIONED` so the web AdminGuard and tooling can show appropriate copy.
   - **DB error during read:** throw 500 `DB_UNAVAILABLE` (distinct from non-admin 403; bearer is verified, this is server-side failure).
   - **Per-bearer rate limit (IMP-1 from external audit):** preHandler is rate-limited at 30 req/min per `sub` (mirrors `/me`'s protection). The `/analytics/*` ADMIN_PREFIXES exemption in `rateLimit.ts:127` skips the global IP limiter — this per-bearer limit closes the gap so a non-admin bearer cannot DDoS the DB read or trigger write-amplification.
   - **Auto-upsert NOT performed** (per IMP-2 from external audit, decided after round 3): a write-on-GET upsert would NEVER benefit a real admin (admin tier is always granted on a pre-existing row created by `/me` first login → the admin already has a row). The upsert would only create silent 'free' rows for non-admins, which (a) provides no functional benefit since they still get 403, (b) opens a write-amplification surface mitigated only by the rate limit above. Cleaner contract: require `/me` once per onboarding (web automates this; Postman documents this).

5. **api-spec.yaml security schemes** — update 5 endpoint declarations from `security: [{AdminKeyAuth: []}]` to `security: [{BearerAuth: []}]`:
   - `GET /analytics/queries`
   - `GET /analytics/missed-queries`
   - `POST /analytics/missed-queries/track`
   - `POST /analytics/missed-queries/:id/status`
   - `GET /analytics/web-events`
   - `POST /analytics/web-events` stays public (sendBeacon, no auth) — no change.

6. **ADR-031** — document the reversal explicitly: "F029/F079/F113 shipped to prod 2026-05-27 with X-API-Key admin gate. F-ADMIN-ANALYTICS-UI replaces that with bearer-only for `/analytics/*` because the admin UI runs in the browser. Tradeoffs: tools (curl, Postman, Render cron) that previously used `X-API-Key: $ADMIN_API_KEY` on `/analytics/*` MUST migrate to bearer (log in as admin → grab JWT → `Authorization: Bearer <jwt>`). Other admin prefixes unchanged."

7. **Breaking change communication:** Document in ticket Operator Actions: anyone with curl/Postman/scripts hitting `/analytics/*` with `X-API-Key` will get 401 post-deploy. Pablo confirmed acceptable.

### API Changes

**New endpoint:**

```
GET /analytics/history-sample
```

Admin-only via the **bearer-only path established in Phase 0** above. Returns 401 if `Authorization` bearer is missing/invalid; 403 if bearer is valid but `Account.tier !== 'admin'`. NO `X-API-Key` fallback.

**Query params** (Zod schema `HistorySampleParamsSchema` in `packages/shared/src/schemas/analytics.ts`):

| Param | Type | Default | Constraints | Description |
|-------|------|---------|-------------|-------------|
| `intent` | `ConversationIntent` (optional) | — | One of the 8 enum values | Filter to a specific intent. Absent = all intents. |
| `hours` | `number` | `24` | min `1`, max `720`, coerce | Look-back window in hours from NOW(). |
| `limit` | `number` | `20` | min `1`, max `100`, coerce | Maximum rows to return. |

**Response schema — envelope pattern per project contract** (`api-spec.yaml:8`, `routes/history.ts:112`):

```
HistorySampleResponseSchema = {
  success: true,                    // literal
  data: HistorySampleDataSchema     // see below
}

HistorySampleDataSchema = {
  items: SearchHistorySampleEntry[],
  hours: number,                    // echoed from request
  limit: number,                    // echoed from request
  intentFilter?: ConversationIntent // echoed only if filter was applied
}
```

**Why split:** Mirrors `AnalyticsDataSchema` + `AnalyticsResponseSchema` in `packages/shared/src/schemas/analytics.ts:76,93` so the inner data shape is reusable for tests without unwrapping. (Cross-model `/review-spec` round 1 IMPORTANT — envelope was missing.)

**`totalAvailable` deliberately omitted** (cross-model round 1 CRITICAL — Gemini). The COUNT(*) over `search_history` would count rows whose `result_jsonb` fails `ConversationMessageDataSchema.safeParse` (drift), giving an inaccurate total vs items[] that EXCLUDES those rows. Three options were considered: (a) drop entirely (chosen — YAGNI for pre-beta), (b) document as estimate, (c) filter in SQL with `WHERE result_jsonb ? 'intent'`. UI shows "Últimas N entradas en las últimas H horas" instead of "Mostrando X de Y". Future ticket can add an accurate `totalAvailable` once we have a stable shape contract.

**`SearchHistorySampleEntry`** (schema in same file, NOT a superset of `SearchHistoryEntrySchema` — privacy subset):

```
{
  id: string (uuid),
  kind: SearchHistoryKind,                  // 'text' | 'voice'
  queryText: string,                        // max 2000 chars
  resultData: AdminResultDataSchema,        // ConversationMessageDataSchema MINUS actorId (see below)
  createdAt: string (ISO 8601)
}

// NEW schema in packages/shared/src/schemas/analytics.ts:
AdminResultDataSchema = ConversationMessageDataSchema.omit({ actorId: true })
```

**Privacy decision:** NO account identifier is exposed in the response — neither raw `accountId` nor any derivative (hash/HMAC) NOR the `actorId` UUID that lives inside `result_jsonb.actorId` (per `/review-plan` round 1 CRITICAL — Codex). `ConversationMessageDataSchema:152` declares `actorId: z.string().uuid()` as a required field — reusing the schema verbatim for the admin response would have leaked the user's actor UUID. The fix is `AdminResultDataSchema = ConversationMessageDataSchema.omit({ actorId: true })` PLUS the route strips `actorId` from each row before serialising. Tests assert `actorId` is absent in every item. The use case is auditing **responses** for correctness, not user behaviour patterns. Owner explicitly chose YAGNI: no hash, no env var, no RGPD surface. If a future use case needs same-user correlation (e.g. "this account hits the same wrong-flagged response 5 times"), an `actorHash` can be added in a follow-up ticket without breaking changes (additive optional field).

**SQL strategy (non-normative, guidance for planner):**

```sql
-- items only — NO account_id in SELECT (cross-model round 1 IMPORTANT — Gemini)
SELECT id, kind, query_text, result_jsonb, created_at
FROM search_history
WHERE created_at >= NOW() - INTERVAL '<hours> hours'
  [AND result_jsonb->>'intent' = '<intent>']
ORDER BY created_at DESC
LIMIT <limit>;
```

`account_id` is NEVER fetched — privacy enforced at the query level, not just at response construction. No second COUNT query (no `totalAvailable`). For each row: `safeParse` `result_jsonb` against full `ConversationMessageDataSchema` (drift drops are silent — not returned, not counted, not logged with row content); then strip `actorId` from the parsed payload before serialising (per /review-plan round 1 CRITICAL — Codex).

**Existing endpoints consumed (no changes):**

| Endpoint | Origin | Consumed by |
|----------|--------|-------------|
| `GET /analytics/missed-queries` | F079 | Panel A |
| `POST /analytics/missed-queries/track` | F079 | Panel A row actions |
| `POST /analytics/missed-queries/:id/status` | F079 | Panel A row actions |
| `GET /analytics/queries` | F029 | Panel C |
| `GET /analytics/web-events` | F113 | Panel C |

### Data Model Changes

No DB migrations. New Zod schemas only:

**`packages/shared/src/schemas/analytics.ts`** — append (mirroring the existing `AnalyticsDataSchema` / `AnalyticsResponseSchema` envelope pattern at lines 76 + 93):
- `HistorySampleParamsSchema` — query params (intent optional, hours coerce, limit coerce)
- `SearchHistorySampleEntrySchema` — response item (id, kind, queryText, resultData, createdAt — NO account identifier)
- `HistorySampleDataSchema` — inner data (items array, hours, limit, intentFilter optional)
- `HistorySampleResponseSchema` — envelope `{ success: true, data: HistorySampleDataSchema }`

**`packages/shared/src/index.ts`** — re-export all four schemas (verified the actual barrel path during round 1 review: `packages/shared/src/index.ts`).

### UI Changes

**New files:**

```
packages/web/src/app/admin/layout.tsx          — AdminLayout (Server Component outer, Client Component inner for auth guard)
packages/web/src/app/admin/analytics/page.tsx  — AdminAnalyticsPage (3 panels)
packages/web/src/components/admin/MissedQueriesPanel.tsx   — Panel A
packages/web/src/components/admin/ResponseReviewPanel.tsx  — Panel B
packages/web/src/components/admin/OverviewPanel.tsx        — Panel C
packages/web/src/lib/i18n/locale.ts            — LOCALE constant
packages/web/src/lib/i18n/useT.ts              — useT(namespace) hook
packages/web/src/lib/i18n/messages/es/admin.json  — All admin strings
packages/web/src/lib/i18n/__tests__/useT.test.ts  — Hook unit tests
```

**AdminLayout:**

- `packages/web/src/app/admin/layout.tsx` — exports a layout with a minimal sidebar shell. The layout is a Server Component shell (for metadata) that wraps an `AdminGuard` client component.
- `AdminGuard` consumes `useAuth()`. Guard logic:
  - If `loading === true`: render full-page loading spinner.
  - If `user === null` (not authenticated): `router.replace('/login?redirectTo=' + encodeURIComponent(pathname))`.
  - If `account === null` after auth loaded (getMe failed): render 403 page ("Acceso denegado — no se pudo verificar el nivel de cuenta.").
  - If `account.tier !== 'admin'`: render 403 page ("Acceso denegado — se requiere nivel administrador.").
  - Otherwise: render sidebar + `{children}`.
- Sidebar: single nav link "Analytics" → `/admin/analytics`. Designed to accommodate future admin sections without structural change.
- Desktop-first layout: `min-w-[960px]` recommended for the content area; tablet (≥768px) usable; phone is degraded-but-functional (no horizontal scroll).
- **Alternative considered (round 2 Gemini SUGGESTION):** Next.js Middleware (`middleware.ts`) for server-side `/admin/*` redirect. Pros: no client flicker, server-side redirect. Cons: middleware runs on every request (cost), needs bearer validation at middleware layer (cookie/header read), couples middleware to Supabase JWT verification. Decision: AdminGuard client-side acceptable for v1 (flicker is brief; user is already authenticated by the time they reach `/admin`). Step 2 frontend-planner can revisit if flicker is empirically objectionable on operator test.

**AdminAnalyticsPage (`/admin/analytics`):**

Three panels rendered as stacked sections (layout decision deferred to ui-ux-designer in Step 2). Each panel is independently stateful — filter changes in one panel do not affect others.

**Panel A — MissedQueriesPanel:**

- Title: "Búsquedas sin respuesta"
- Data source: `GET /analytics/missed-queries`
- Filter controls:
  - `timeRange`: preset selector `24h | 7d | 30d | all` (default `7d`)
  - `topN`: numeric input `1–100` (default `20`)
  - `minCount`: numeric input `≥1` (default `1`)
- Table columns: `queryText` (truncate 80 chars), `count`, `trackingStatus` (badge: `pending` = yellow / `resolved` = green / `ignored` = grey / untracked = none), actions.
- Per-row actions (dropdown or inline buttons) — verified against `routes/missedQueries.ts:163` upsert + `schemas/missedQueries.ts:104` batch body:
  - **"Investigando" — untracked row (trackingId === null):** `POST /analytics/missed-queries/track` with batch body `{ queries: [{ queryText: row.queryText, hitCount: row.count }] }`. The upsert creates the row with `status: 'pending'` automatically (no second call needed). Response returns the created tracking record with new `id`; UI captures it for subsequent status flips.
  - **"Investigando" — already tracked row (trackingId !== null):** `POST /analytics/missed-queries/:id/status` with body `{ status: 'pending' }`. Idempotent transition from `resolved`/`ignored` back to `pending`.
  - **"Resuelto":** Requires tracked row (trackingId !== null). `POST /analytics/missed-queries/:id/status` with body `{ status: 'resolved' }`. If the row is untracked, UI calls POST /track FIRST (to get the id), then POST /:id/status — two-step.
  - **"Ignorar":** Same two-step pattern as Resuelto, with body `{ status: 'ignored' }`.
  - Optimistic UI: update row badge immediately; revert on API error + show inline error. Two-step actions revert both calls if either fails.
  - Cross-model round 1 IMPORTANT (Codex): the original "POST /track with single id" wording was wrong — the existing endpoint accepts a batch of `{queryText, hitCount}` (no id), and the GET response exposes `trackingId` only when the row is already in `missed_query_tracking`. This spec uses the correct contract.
- Loading state: skeleton table rows.
- Empty state: "No hay búsquedas sin respuesta en este período."
- Error state: "Error cargando datos. [Reintentar]"

**Panel B — ResponseReviewPanel:**

- Title: "Respuestas para revisar"
- Data source: `GET /analytics/history-sample`
- Filter controls:
  - `intent`: dropdown of 8 `ConversationIntent` values + "Todos" (default: all)
  - `hours`: numeric input `1–720` (default `24`)
  - `limit`: numeric input `1–100` (default `20`)
- Table columns: `queryText` (truncate 100 chars), `intent` badge (from `resultData.intent`), `kind` badge (text/voice), `createdAt` (relative time), expand icon.
- Expand row: reveals full `resultData` payload. **Note (cross-model round 1 — Gemini SUGGESTION + Codex follow-up):** `<ResultBody>` in `TranscriptEntry.tsx` is currently an *internal* function, not an exported reusable component. The implementation must EITHER (a) extract `<ResultBody>` to its own module with a clean prop contract that accepts `ConversationMessageData` directly (preferred — reuse), OR (b) build a lightweight admin-only renderer that handles the 8 intent shapes (`estimation`, `comparison`, `menu_estimation`, `reverse_search`, `context_set`, `text_too_long`, `follow_up_attribute`, `follow_up_refinement`). The frontend-planner decides during Step 2.
- Header text: "Últimas N entradas en las últimas H horas" (no `X de Y` total — `totalAvailable` removed; see API Changes rationale).
- Loading state: skeleton rows.
- Empty state: "No hay entradas en el período seleccionado."
- Error state: "Error cargando muestras. [Reintentar]"

**Panel C — OverviewPanel:**

- Title: "Vista general"
- Data sources: `GET /analytics/queries` + `GET /analytics/web-events` (parallel fetches)
- Filter: `timeRange` preset `24h | 7d | 30d | all` (default `7d`)
- Scalar cards (from `/analytics/queries`): `totalQueries`, `cacheHitRate` (formatted as %), `avgResponseTimeMs` (ms), `missRate` (= `byLevel.miss / totalQueries`, formatted as %)
- **Web-events scalar card** (from `/analytics/web-events`): `webTotalQueries` ("Sesiones web · queries totales"). Required for AC22 verifiability — operator can confirm `NEXT_PUBLIC_METRICS_ENDPOINT` is wired by seeing this number tick up after browsing `/hablar` (cross-model round 1 SUGGESTION — Codex).
- Distributions:
  - byLevel: horizontal bar chart or donut (l1/l2/l3/l4/miss)
  - bySource: pie or icon pair (api / bot)
  - topQueries: table top-10 (queryText + count)
  - topIntents from web-events: table top-5 (intent + count)
- Loading state: skeleton cards.
- Error state per data source: inline error below affected section.

**i18n-light infrastructure:**

- `packages/web/src/lib/i18n/locale.ts`:
  ```
  export const LOCALE = 'es' as const;
  export type SupportedLocale = typeof LOCALE;
  ```
- `packages/web/src/lib/i18n/useT.ts`:
  - `useT(namespace: string): (key: string) => string`
  - Resolves nested dot-separated keys (e.g. `"panel.title"`) against `messages/es/<namespace>.json`.
  - Falls back to the key string itself if key is missing (never throws).
  - Messages loaded at module level (static import — no async loading required for v1).
  - Scope: ONLY admin panel. `/hablar`, `/login`, and all other routes continue using hardcoded Spanish strings.
- `packages/web/src/lib/i18n/messages/es/admin.json`: all user-facing strings for the admin panel.
- `packages/web/src/lib/i18n/__tests__/useT.test.ts`: unit tests for key resolution, fallback-to-key, and nested key access.

### Edge Cases

1. **API auth — bearer absent on `/analytics/*`:** Phase 0 admin gate returns 401 (not anonymous fall-through) because `requireAdminBearer` preHandler rejects requests without `request.accountId`. Verify this is distinct from anonymous routes which respond with cached data.
2. **API auth — bearer valid but non-admin tier:** Returns 403 (forbidden) with code `FORBIDDEN`. Distinct from 401 so the web AdminGuard can show "tier insuficiente" instead of "no autenticado".
3. **API auth — tooling using `X-API-Key: $ADMIN_API_KEY` on `/analytics/*`:** Returns 401 (no bearer). Breaking change documented in ADR-031 + ticket Operator Actions. Owner confirmed acceptable.
3b. **API auth — bearer valid but `accounts` row missing (per round 3 external audit IMP-2 refinement + step 1 NIT):** Returns 403 with **distinct code `NOT_PROVISIONED`** and hint "Account not provisioned. Call GET /me once to provision, then retry." Distinguishable from `FORBIDDEN` (wrong tier) by error code, not just message — so the web AdminGuard and tooling can branch UI/copy programmatically. Web flow auto-handles this via `AuthProvider`'s `getMe()` on `SIGNED_IN`/`INITIAL_SESSION` — admin browsing `/admin/analytics` never sees this 403 because by the time they reach the page, the row exists. Postman/curl tooling: documented one-time `/me` step in operator runbook + ADR-031. Rationale for NOT auto-upserting: an admin always has a pre-existing row (admin tier is granted on a row, not on a fresh auth_user_id); auto-upsert would only create silent 'free' rows for non-admins (zero functional benefit + write-amplification surface).
3c. **API auth — DB unavailable during tier read:** `requireAdminBearer` returns 500 `DB_UNAVAILABLE` (distinct from 403 non-admin). The bearer is verified — this is a server-side failure, not a permissions issue. Both web AdminGuard and tooling can distinguish.
3d. **Per-bearer rate limit on requireAdminBearer (per round 3 external audit IMP-1):** 30 req/min per `sub`. Mirrors `/me`. Protects against (a) write-amplification scenarios that ARE no longer possible because auto-upsert was dropped per 3b, but kept as defensive layer; (b) cache-miss flood on rotated subs hitting tier read. If exceeded → 429 `RATE_LIMIT_EXCEEDED`.
4. **Admin gate — `account` null after auth loaded:** `getMe()` in `AuthProvider` can fail (network error, API down). `account === null` does not mean non-admin — treat as 403 with a distinct message ("no se pudo verificar el nivel de cuenta") so the admin knows to retry, not that they lack permission.
5. **`NEXT_PUBLIC_METRICS_ENDPOINT` unset:** `flushMetrics()` in `packages/web/src/lib/metrics.ts` silently no-ops when the env var is absent. This is currently the case in Vercel prod. **AC27** is an operator smoke to set the var and verify web-events rows accumulate (`webTotalQueries` scalar in Panel C ticks up).
6. **Empty `search_history`:** `items = []` → Panel B empty state. Valid.
7. **`result_jsonb` schema drift:** Some older `search_history` rows may have a `result_jsonb` shape predating a `ConversationMessageData` change. The route `safeParse`s each row and skips rows that fail (same pattern as `useSearchHistory` in the web). Skipped rows are NOT returned (no `totalAvailable` to count them in — see API Changes rationale). Document in response schema.
8. **Admin accessing dashboard on phone:** Layout is degraded but functional. No horizontal scroll blocker; tables scroll horizontally within their container. No specific phone ACs.
9. **Multiple concurrent panel data fetches:** Each panel fetches independently on mount and on filter change. No global loading state — per-panel spinners.
10. **Non-admin authenticated user navigating to `/admin/analytics`:** `AdminGuard` renders the 403 page client-side. The page has no SSR data fetching so no API call is made; the guard short-circuits before any fetch.
11. **`intent` filter on `result_jsonb`:** The JSONB `->>'intent'` path assumes `ConversationMessageData` always has a top-level `intent` field. Verified in round 1 cross-model review (Gemini grep on `ConversationMessageDataSchema` confirmed top-level `intent`). If a future intent variant nests `intent` under a discriminated key, the SQL filter would need adjustment.

### ADR-031 Required

This ticket REVERSES the F029/F079/F113 contract that already shipped to prod. ADR-031 documents the decision:

- **Title:** "Bearer-only admin auth for `/analytics/*` (surgical reversal of X-API-Key gate)"
- **Status:** Proposed (Accepted upon ticket merge)
- **Context:** F029 (2026-04, `GET /analytics/queries`), F079 (2026-04, missed-queries pipeline), F113 (2026-05, `GET /analytics/web-events`) all gated `/analytics/*` behind `validateAdminKey(X-API-Key === ADMIN_API_KEY)` per the original F026 admin auth design. Pre-beta need: surface telemetry to Pablo through a web admin UI, which cannot ship an API key from the browser without leaking it.
- **Decision:** Bearer-only on `/analytics/*` (JWT + `Account.tier === 'admin'`). Other admin prefixes (`/ingest/`, `/quality/`, `/embeddings/`, `/admin/`) keep X-API-Key. NO dual-mode fallback — owner explicitly chose bearer-only for both Postman and the web app to avoid ambiguity.
- **Tradeoffs:** Breaking change for any curl/Postman/script previously hitting `/analytics/*` with `X-API-Key`. Owner confirmed acceptable since (a) the only consumer in practice was Pablo, (b) bearer flow is well-documented in F107a, (c) ad-hoc analytics curls can be migrated trivially (`log in → grab JWT from browser devtools → reuse as `Authorization: Bearer <jwt>`).
- **Out of scope:** Migrating other admin prefixes to bearer. Deferred until concrete consumers need it.
- **PII note (per round 3 external audit NIT):** `queryText` in `GET /analytics/history-sample` items can carry PII (user-provided free-text queries occasionally reveal sensitive info — e.g., dietary restrictions, medical context, health flags). The privacy posture is consciously asymmetric: NO account identifier (privacy by exclusion of who) but FULL query text (visibility on what was asked, required for response-quality audit — the actual use case). Mitigations: admin-only access via bearer+tier gate (ADR-031); rate-limited per bearer (30/min); never logged outside the admin response payload; not exported, not cached cross-request beyond Redis tier resolution. This trade-off is documented here so future ADRs/auditors find it explicit rather than implicit.

Other architectural choices in this ticket reuse established patterns (no ADR needed for these):
- Privacy by exclusion (no account identifier in response): simpler than hashing; YAGNI for pre-beta audit use case.
- i18n-light with static JSON + hook: YAGNI per project preference (no next-intl/react-i18next).
- No DB migrations: all data is already in existing tables.
- Response envelope `{ success, data }`: matches project-wide API contract (`api-spec.yaml:8` + every existing route).

---

## Acceptance Criteria

### AC1 — Phase 0: `/analytics/*` rejects X-API-Key alone (no bearer)
- [x] `GET /analytics/queries` with header `X-API-Key: $ADMIN_API_KEY` and NO `Authorization` header returns `401` (code `UNAUTHORIZED`). Same for `/analytics/missed-queries`, `/analytics/missed-queries/track`, `/analytics/missed-queries/:id/status`, `/analytics/web-events` GET, and the new `/analytics/history-sample`. Verified by integration test.

### AC2 — Phase 0: `/analytics/*` rejects non-admin bearer
- [x] `GET /analytics/queries` with `Authorization: Bearer <jwt>` for an account with `tier !== 'admin'` (e.g. free or pro) returns `403` (code `FORBIDDEN`). Same for all `/analytics/*` endpoints listed above. Verified by integration test using a seeded non-admin account.

### AC3 — Phase 0: `/analytics/*` accepts admin bearer
- [x] `GET /analytics/queries` with `Authorization: Bearer <jwt>` for an account with `tier === 'admin'` returns `200` with the expected envelope. Same for all `/analytics/*` endpoints. Verified by integration test using a seeded admin account.

### AC4 — Phase 0: Other admin prefixes unchanged (X-API-Key still works)
- [x] Regression test confirms at least one route on each of the other 4 admin prefixes still accepts `X-API-Key: $ADMIN_API_KEY` (no bearer) and rejects requests without the key with 401. Concrete routes (per round 2 review — all verified to exist): `GET /admin/waitlist`, `GET /quality/report`, `POST /embeddings/generate`, AND one ingest route (e.g., `POST /ingest/url` or `POST /ingest/pdf-url`). If any prefix has no consumer-grade route the planner can call, explicit "no consumer to test for prefix X" note suffices for that one prefix (justified in the test file).

### AC5 — Phase 0: `POST /analytics/web-events` public exemption preserved
- [x] `POST /analytics/web-events` (sendBeacon ingest) with NO auth headers still returns `202` (existing behavior). The bearer-only migration does NOT regress the public exemption hardcoded in `isAdminRoute(url, method)` (`adminPrefixes.ts:12`). Verified by integration test.

### AC5b — Phase 0: requireAdminBearer rejects missing-row with distinct NOT_PROVISIONED code (round 3 external audit IMP-2 + step 1 NIT)
- [x] A bearer JWT for a user whose `auth_user_id` does NOT have an `accounts` row (fresh login, has not yet called `/me`) calls `GET /analytics/queries` with `Authorization: Bearer <jwt>`. `requireAdminBearer` returns 403 with **error code `NOT_PROVISIONED`** (distinct from `FORBIDDEN`) and message "Account not provisioned. Call GET /me once to provision, then retry." NO auto-upsert occurs (verified by integration test asserting `accounts` row count UNCHANGED before/after the rejected call). Web flow: AC8 (admin sees dashboard) confirms `AuthProvider.SIGNED_IN` calls `getMe()` automatically, so the web admin never sees this 403 in normal flow. Tests assert BOTH the HTTP status (403) AND the error code (`NOT_PROVISIONED` vs `FORBIDDEN`) — the code is the programmatic distinguisher, not the message.

### AC5c — Phase 0: requireAdminBearer DB error distinguishable from non-admin
- [x] If the tier read throws (DB unavailable), `requireAdminBearer` returns 500 `DB_UNAVAILABLE` — NOT 403. The 403 `FORBIDDEN` only fires when (a) the account row is missing (with provisioning hint message) or (b) the account row exists with `tier !== 'admin'` (without hint). Distinct so the web AdminGuard can show "error temporal, reintenta" vs "no tienes permisos". Verified by integration test that mocks the DB to throw.

### AC5d — Phase 0: requireAdminBearer per-bearer rate limit (round 3 external audit IMP-1)
- [x] `requireAdminBearer` enforces a per-`sub` rate limit of 30 req/min, mirroring `/me`'s protection. Bypassing the limit returns 429 `RATE_LIMIT_EXCEEDED`. Verified by integration test: (a) hit `/analytics/queries` 30 times with the same bearer → all 200/403 (per tier); (b) the 31st within the window → 429. Counter resets at the window boundary. The limit applies BEFORE the tier check (so even non-admin bearers cannot DDoS the DB read).

### AC6 — Anonymous redirects to login
- [x] An unauthenticated user visiting `/admin/analytics` is redirected to `/login?redirectTo=%2Fadmin%2Fanalytics` (client-side redirect via `AdminGuard`). The page content is NOT rendered before the redirect fires.

### AC7 — Authenticated non-admin gets 403
- [x] An authenticated user with `account.tier !== 'admin'` (e.g. `free` or `pro`) visiting `/admin/analytics` sees a 403 error page with the message "Acceso denegado — se requiere nivel administrador." No dashboard panels are rendered.

### AC8 — Admin sees the dashboard
- [x] An authenticated user with `account.tier === 'admin'` visiting `/admin/analytics` sees all three panels (Missed Queries, Respuestas para revisar, Vista general) with data loaded or loading states visible.

### AC9 — Logout removes access
- [x] After signing out from the admin dashboard, navigating back to `/admin/analytics` redirects to `/login?redirectTo=...` (session is cleared; `AdminGuard` falls into the unauthenticated branch).

### AC10 — Panel A loads via GET /analytics/missed-queries
- [x] `MissedQueriesPanel` mounts and fires `GET /analytics/missed-queries?timeRange=7d&topN=20&minCount=1` (default params) with bearer auth. On success, the table renders rows with queryText, count, and tracking status badge (or no badge if untracked).

### AC11 — Panel A filters apply
- [x] Changing the `timeRange` preset re-fetches with the new `timeRange`. Changing `topN` or `minCount` re-fetches with updated params. All three filters work independently and in combination.

### AC12 — Panel A per-row tracking actions (correct contract per `routes/missedQueries.ts:163` + `schemas/missedQueries.ts:104`)
- [x] "Investigando" on an UNTRACKED row (`trackingId === null`): calls `POST /analytics/missed-queries/track` with body `{ queries: [{ queryText: row.queryText, hitCount: row.count }] }`. Backend upserts with `status: 'pending'`. Response returns the created row with `id`; UI captures and stores it. Optimistic badge update to `pending`.
- [x] "Investigando" on a TRACKED row (`trackingId !== null`): calls `POST /analytics/missed-queries/:trackingId/status` with body `{ status: 'pending' }`.
- [x] "Resuelto" on TRACKED row: `POST /analytics/missed-queries/:trackingId/status` body `{ status: 'resolved' }`. On UNTRACKED row: two-step (POST /track first to get id, then POST /:id/status); rollback both on error.
- [x] "Ignorar" same two-step pattern with `{ status: 'ignored' }`.
- [x] On API error: badge reverts to prior state; inline error message appears below the row.

### AC13 — Panel A empty state
- [x] When `GET /analytics/missed-queries` returns `missedQueries: []` (no misses in period), the panel shows "No hay búsquedas sin respuesta en este período." instead of an empty table.

### AC14 — Panel B loads via GET /analytics/history-sample
- [x] `ResponseReviewPanel` mounts and fires `GET /analytics/history-sample?hours=24&limit=20` (default params, no intent filter) with bearer auth. On success, the table renders rows with queryText (truncated 100 chars), intent badge, kind badge, createdAt relative time, and an expand icon. Header shows "Últimas N entradas en las últimas 24 horas" (NO `X de Y` — `totalAvailable` was intentionally dropped per round 1 rationale).

### AC15 — Panel B intent filter
- [x] Selecting a specific intent from the dropdown re-fetches with `?intent=<value>`. Selecting "Todos" removes the intent filter parameter. The table updates accordingly.

### AC16 — Panel B hours and limit filters
- [x] Changing the `hours` input (valid range 1–720) re-fetches with the new `hours`. Changing `limit` (valid range 1–100) re-fetches. Out-of-range values are clamped or rejected with inline validation before fetch.

### AC17 — Panel B expand row shows full resultData
- [x] Clicking the expand icon on a table row reveals the full `resultData` payload rendered in a readable format. The implementation either (a) reuses an extracted `<ResultBody>` from `TranscriptEntry` or (b) provides an admin-only renderer covering the 8 `ConversationIntent` shapes — decision finalized in Step 2 plan. Clicking again collapses it.

### AC18 — Panel C loads scalars from GET /analytics/queries + webTotalQueries from /analytics/web-events
- [x] `OverviewPanel` fetches `GET /analytics/queries?timeRange=7d` AND `GET /analytics/web-events?timeRange=7d` in parallel on mount. Scalar cards render: `totalQueries` (from queries), `cacheHitRate` (X%), `avgResponseTimeMs` (Xms), `missRate` (X%), AND `webTotalQueries` ("Sesiones web · queries totales", from web-events `totalQueries`). The `byLevel`, `bySource`, `topQueries`, and `topIntents` distributions also render.

### AC19 — Panel C independent error states + filter parity
- [x] If `/analytics/web-events` fetch fails independently, an inline error appears below the web-events section but the queries section continues to render. Changing the `timeRange` preset re-fetches both endpoints with the new `timeRange`; both sections show their own loading state during re-fetch.

### AC20 — history-sample endpoint envelope + privacy (incl. actorId redaction per round 1 plan-review CRITICAL)
- [x] `GET /analytics/history-sample` with a valid admin bearer returns `200` with envelope shape `{ success: true, data: { items, hours, limit, intentFilter? } }` per `HistorySampleResponseSchema`. NO `totalAvailable` field. Each item contains EXACTLY `id`, `kind`, `queryText`, `resultData`, `createdAt`. **Privacy assertions (test must verify ALL):** (a) `accountId` NOT in any item; (b) `actorHash` NOT in any item; (c) **`actorId` NOT in `item.resultData`** (despite `ConversationMessageDataSchema:152` declaring it required, the admin response strips it via `AdminResultDataSchema = ConversationMessageDataSchema.omit({ actorId: true })` + route mapping); (d) no other account-identifying field present. Seed `search_history` with a row whose `result_jsonb` includes a valid `actorId` UUID; assert the response payload's resultData has `actorId: undefined` and the field is structurally absent (not just null).

### AC21 — history-sample schema validation
- [x] `GET /analytics/history-sample?hours=721` returns `400` (hours exceeds max 720). `?limit=0` returns `400` (limit below min 1). `?intent=invalid_value` returns `400` (not a valid `ConversationIntent`). Valid requests with all defaults return the correct shape. Rows whose `result_jsonb` fails `ConversationMessageDataSchema.safeParse` are dropped from `items` (verified by integration test that seeds a drifted row + asserts it does NOT appear in the response).

### AC22 — i18n useT hook
- [x] `useT('admin')` returns a translation function that resolves `'panel.missedQueries.title'` to the Spanish string in `messages/es/admin.json`. Calling the function with a key that does not exist in the JSON returns the key string itself (fallback). Nested dot-separated keys resolve correctly. The `LOCALE` constant equals `'es'`. Verified by unit tests in `useT.test.ts`.

### AC23 — api-spec.yaml fully updated (security + prose + response codes)
- [x] `docs/specs/api-spec.yaml` contains:
  - (a) `GET /analytics/history-sample` entry with full query param schema, envelope response (items, hours, limit, intentFilter optional), 400/401/403/500 responses
  - (b) Security scheme changed from `AdminKeyAuth` to `BearerAuth` on the 5 existing analytics endpoints: `GET /analytics/queries`, `GET /analytics/missed-queries`, `POST /analytics/missed-queries/track`, `POST /analytics/missed-queries/:id/status`, `GET /analytics/web-events`
  - (c) For those same 5 endpoints: 401 response prose updated from "Missing or invalid admin API key" → "Missing or invalid bearer token". 403 response block ADDED (was absent for some): "Authenticated bearer does not have `admin` tier" with example `code: FORBIDDEN`
  - (d) `POST /analytics/web-events` security unchanged (public sendBeacon)
  - Verified by round 3 review (each line cited in the round 1 Codex IMPORTANT #3 finding has been updated)

### AC24 — ui-components.md updated
- [x] `docs/specs/ui-components.md` documents `AdminLayout`, `AdminGuard`, `MissedQueriesPanel`, `ResponseReviewPanel`, and `OverviewPanel` with props, state, interactions, and loading/error/empty states.

### AC25 — ADR-031 written
- [x] `docs/project_notes/decisions.md` contains ADR-031 "Bearer-only admin auth for `/analytics/*`" with sections Context / Decision / Tradeoffs / Out of scope as drafted in the Spec → ADR-031 Required block above.

### AC26 — Operator smoke: dashboard loads on app-dev (Status: Pending — post-merge)
- [ ] After merging and deploying to `app-dev.nutrixplorer.com`: log in as the admin account, navigate to `/admin/analytics`, verify all three panels load with real data (or show the correct empty state for Panel A if there are no recent misses).

### AC27 — Operator smoke: NEXT_PUBLIC_METRICS_ENDPOINT set + Panel C webTotalQueries ticks (Status: Pending — post-merge)
- [ ] `NEXT_PUBLIC_METRICS_ENDPOINT` is set to `https://api-dev.nutrixplorer.com/analytics/web-events` in Vercel dev env vars (and `https://api.nutrixplorer.com/...` for prod when releasing). After setting the var, opening `/hablar` and submitting at least one query: the Panel C scalar `webTotalQueries` (or `web_metrics_events` row count in Supabase) increments. Verified via Panel C re-fetch button or page reload showing the new count.

---

## Definition of Done

- [x] All ACs above met except AC26 and AC27 (operator-pending post-merge)
- [x] `packages/web` suite: green (net +N: useT hook + AdminGuard + 3 panel components + admin route)
- [x] `packages/api` suite: green (net +N: Phase 0 auth migration tests — bearer-only on /analytics/*, X-API-Key still works on other admin prefixes, web-events public exemption preserved, requireAdminBearer preHandler tests covering: no bearer→401, bearer+no-row→403-with-hint (no upsert side effect), bearer+wrong-tier→403, bearer+admin→pass, DB error→500, rate-limit 30/min per sub→429. PLUS history-sample route — admin gate, intent filter, hours filter, limit cap, empty case, defaults, accountId NOT in response, drifted result_jsonb dropped, envelope shape)
- [x] `packages/shared` suite: green (new Zod schemas: HistorySampleParamsSchema, SearchHistorySampleEntrySchema, HistorySampleDataSchema, HistorySampleResponseSchema)
- [x] `npm run lint`, `npm run typecheck`, `npm run build` all clean for all 3 workspaces
- [x] `docs/specs/api-spec.yaml` — history-sample entry added + 5 security scheme migrations (AdminKeyAuth → BearerAuth) (AC23)
- [x] `docs/specs/ui-components.md` — Admin components documented (AC24)
- [x] `docs/project_notes/decisions.md` — ADR-031 added (AC25)
- [x] `docs/project_notes/key_facts.md` — Admin route `/admin/analytics` + i18n-light infra + auth migration note added to relevant sections
- [x] Ticket `## Spec` section written (this section — done at Step 0)
- [ ] PR opened against `develop` with CI green
- [x] Operator smokes AC26 and AC27 planned for `app-dev` post-merge
- [x] Breaking-change communication: ADR-031 + tracker entry documents that any X-API-Key consumer of `/analytics/*` MUST migrate to bearer post-merge (owner confirmed acceptable — only consumer is Pablo)

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, `docs/specs/api-spec.yaml` updated, `docs/specs/ui-components.md` updated, ticket `## Spec` written
- [x] Step 0: Cross-model `/review-spec` round 1 — Gemini REVISE (1 CRITICAL totalAvailable + 1 IMPORTANT SQL account_id + 2 SUGGESTION) + Codex REVISE (1 CRITICAL admin auth + 2 IMPORTANT envelope/track + 1 SUGGESTION AC22)
- [x] Step 0: Round 1 findings addressed — Phase 0 auth migration added (ADR-031), response envelope split, totalAvailable dropped, SQL no account_id, Panel A track flow corrected, Panel C webTotalQueries scalar added, edge cases updated, ACs expanded from 22 → 27, tier bumped Standard → Standard-grande
- [x] Step 0: Cross-model `/review-spec` round 2 — Gemini APPROVED (1 SUGGESTION middleware advisory) + Codex REVISE (3 IMPORTANT: account bootstrap, AC4 wrong route names, AC23 weak prose coverage)
- [x] Step 0: Round 2 findings addressed — requireAdminBearer auto-upserts on demand (AC5b + AC5c new) + AC4 routes corrected to real registered routes + AC23 expanded to include prose + 403 response blocks; Gemini middleware suggestion noted in AdminLayout section, deferred to frontend-planner. ACs 27 → 29.
- [x] Step 0: Cross-model `/review-spec` round 3 — Gemini APPROVED + Codex APPROVES content (R1+R2 findings all verified addressed); Codex 1 IMPORTANT = Merge Checklist row 4 stale, fixed inline; round 4 skipped (diminishing returns on single mechanical inconsistency)
- [x] Step 0: External audit round 3 (fx agent) — 3 IMPORTANT findings (IMP-1 rate-limit gap, IMP-2 auto-upsert ineffective + write-amplification, IMP-3 hijack regression risk via accountProvision.ts refactor) + 3 NITs (MCE row 8, Workflow dedup, PII queryText)
- [x] Step 0: Round 3 audit fixes applied — IMP-1 AC5d new (per-bearer rate limit); IMP-2 auto-upsert removed + AC5b rewritten + Phase 0 narrative + edge cases #3b/#3c/#3d updated; IMP-3 becomes N/A (no shared refactor); NIT PII note added to ADR-031 block; NIT MCE row 8 added; NIT Workflow dedup fixed. ACs 29 → 30.
- [x] Step 0: Cross-model `/review-spec` round 4 — Gemini APPROVED (3 SUGGESTIONs forward-looking, none blocking) + Codex REVISE (2 IMPORTANT mechanical: stale "upsert/read" prose + cache-contract ambiguity + 1 SUG stale AC22 reference)
- [x] Step 0: Round 4 mechanical inconsistencies fixed inline — api-spec.yaml 500 prose says "admin account tier lookup throws" (no upsert); cache contract narrowed to "tier string only at account:tier:<sub>"; edge case 5 AC reference corrected AC22 → AC27. Round 5 skipped (mechanical fixes; high cross-model confidence).
- [x] Step 0: Owner sign-off on revised spec (round 4 final verdict)
- [x] Step 1: Branch `feature/F-ADMIN-ANALYTICS-UI` created off develop @ `46fc0ba`, tracker updated, ADR-031 stub added to `decisions.md`
- [x] Step 2: `ui-ux-designer` executed (panel layout, visual hierarchy, component hierarchy finalized — per memory `feedback_uiux_designer_agent`)
- [x] Step 2: `frontend-planner` executed, Implementation Plan written
- [x] Step 2: `backend-planner` executed (auth migration + history-sample endpoint + schemas)
- [x] Step 2: Cross-model `/review-plan` round 1 — Gemini APPROVED + Codex REVISE (1 CRITICAL actorId leak in resultData + 3 IMPORTANT: isKeyAdminRoute method guard for /restaurants, negative-cache no-row coherence with /me, AuthProvider accountErrorCode for AdminGuard 3-variant 403 + 1 SUGGESTION Vitest→Jest)
- [x] Step 2: Round 1 plan-review fixes applied inline — AdminResultDataSchema (omit actorId) + AC20 strengthened; isKeyAdminRoute method-aware (preserves GET /restaurants public); negative cache REMOVED (no-row not cached, ~30 extra DB reads/min/sub capped by rate limit); AuthProvider.accountErrorCode + AdminGuard branch 3a notProvisioned variant; all Vitest patterns → Jest
- [x] Step 2: Cross-model `/review-plan` round 2 — Gemini APPROVED ("exceptionally thorough; no new gaps") + Codex REVISE (2 IMPORTANT prosa-stale `__none__` residuals, test bypass inconsistency + 1 SUG duplicate useT entry + AuthProvider missing from modify table)
- [x] Step 2: Round 2 plan-review fixes applied inline — all `__none__` references purged; test bypass policy unified ("gate stays active in test; only rate-limit skipped"; legacy tests use named `allowTestBypass` opt-out); duplicate useT test row removed; AuthProvider.tsx + useAuth.ts added to Files-to-Modify table with explicit accountErrorCode extension scope. Round 3 skipped — diminishing returns (Gemini APPROVED both rounds; Codex content addressed per own review body; remaining were prose consistency).
- [x] Step 3: Implementation (frontend-developer + backend-developer)
- [x] Step 4: Quality gates pass (lint + typecheck + build + all tests green)
- [x] Step 5: `code-review-specialist` executed, findings addressed
- [x] Step 5: `qa-engineer` executed, findings addressed
- [ ] Step 6: Completion Log filled, tracker updated, PR merged, branch deleted, operator smokes planned

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-06-10 | Step 0 — Spec drafted by spec-creator | All cited files verified: adminPrefixes.ts (ADMIN_PREFIXES includes `/analytics/`), ConversationIntentSchema (8 values confirmed), SearchHistoryEntrySchema (shape confirmed), HistoryPageSchema, analytics.ts (AnalyticsTimeRangeSchema `24h|7d|30d|all`), metrics.ts (NEXT_PUBLIC_METRICS_ENDPOINT gate confirmed), AuthContextValue (account: Account \| null confirmed with tier field). 22 ACs drafted. Initial "No ADR needed" assessment was WRONG — round 1 review surfaced auth blocker. |
| 2026-06-10 | Step 0 — Cross-model `/review-spec` round 1 | Gemini REVISE (1 CRITICAL totalAvailable inconsistency, 1 IMPORTANT SQL account_id, 2 SUGGESTION). Codex REVISE (1 CRITICAL admin auth = X-API-Key vs spec assumption bearer+tier, 2 IMPORTANT envelope + track endpoint contract, 1 SUGGESTION AC22 verifiability). Both verified empirically (Files read + Commands executed sections populated). |
| 2026-06-10 | Step 0 — Owner discussion of auth blocker | Owner chose Path D simplified: pure bearer-only on `/analytics/*`, NO X-API-Key fallback. Scope confirmed surgical (only `/analytics/*`, other admin prefixes unchanged). Per memory `feedback_pre_commit_arch_discussion`, paused before edits even though cross-model converged on a fix direction. |
| 2026-06-10 | Step 0 — Spec revised round 1 → round 2 candidate | Phase 0 auth migration added (5 new ACs + ADR-031 + auth.ts/adminPrefixes.ts split + requireAdminBearer preHandler). Response envelope split (`HistorySampleDataSchema` + `HistorySampleResponseSchema`). `totalAvailable` dropped (YAGNI for pre-beta). SQL guidance fixed (no account_id select). Panel A track flow corrected per `routes/missedQueries.ts:163` contract. Panel C webTotalQueries scalar added for AC22 verifiability. ResultBody adapter note added. Edge cases updated (auth 401/403, X-API-Key tooling 401). Tier bumped Standard → Standard-grande. ACs expanded 22 → 27. DoD expanded with auth migration tests + ADR-031 + key_facts.md note. |
| 2026-06-10 | Step 0 — Cross-model `/review-spec` round 2 | Gemini APPROVED (1 SUGGESTION: prefer Next.js Middleware over AdminGuard client — advisory, deferred to frontend-planner). Codex REVISE 3 IMPORTANT: (a) account bootstrap (bearer alone doesn't provision; current architecture requires `/me` first — fix: requireAdminBearer auto-upserts on demand), (b) AC4 cited non-existent route `POST /ingest/dishes` — fix: replace with real routes `GET /admin/waitlist` etc, (c) AC23 missed prose + 403 response block updates in api-spec.yaml — fix: expand AC23 scope. Round 1 6/7 findings confirmed addressed; only #1 (auth) was partially addressed. |
| 2026-06-10 | Step 0 — Spec revised round 2 → round 3 candidate | requireAdminBearer auto-upsert behavior specified (AC5b + AC5c new — shared helper `accountProvision.ts` factored from `/me` upsert). AC4 updated with real route citations (`/admin/waitlist`, `/quality/report`, `/embeddings/generate`, `/ingest/url`). AC23 expanded to cover 5 endpoints' 401 prose + 403 response blocks. Gemini middleware suggestion noted in AdminLayout section. Edge cases #3b + #3c added (bootstrap + DB error). ACs 27 → 29. |
| 2026-06-10 | Step 0 — Cross-model `/review-spec` round 3 | Gemini APPROVED (all 4 R2 findings verified addressed empirically — accountTier.ts confirmed `no row → free`, auth.ts confirmed `/me` ON CONFLICT pattern, api-spec.yaml confirmed 5 endpoints migrated with bearer 401 + 403 blocks). Codex REVISE 1 IMPORTANT — Merge Checklist row 4 stale ("No ADR needed" inconsistent with AC25 + workflow + spec ADR-031 requirement). All R1+R2 findings explicitly confirmed addressed by Codex itself. |
| 2026-06-10 | Step 0 — Merge checklist inline fix | Merge Checklist Evidence row 4 updated to require ADR-031 (matches AC25 + Workflow Step 1). |
| 2026-06-10 | Step 0 — Round 3 external audit (fx agent) | 3 IMPORTANT findings: IMP-1 rate-limit gap (requireAdminBearer reachable by non-admin bearers, no per-bearer limit since /analytics/* in ADMIN_PREFIXES exemption); IMP-2 auto-upsert ineffective for real admin scenarios (admin always has pre-existing row from /me; auto-upsert only creates silent 'free' rows for non-admins → 403 anyway + write-amplification surface); IMP-3 hijack regression risk if `accountProvision.ts` factored from /me's path (F107a-FU2 BUG-API-AUTH-ACTOR-HIJACK-001). 3 NITs: MCE row 8 missing (CI verify), Workflow dedup, PII queryText note in ADR-031. Owner approved all 5 fixes after pros/cons analysis. |
| 2026-06-10 | Step 0 — Round 3 audit fixes applied (→ round 4 candidate) | IMP-2 dropped auto-upsert (Phase 0 narrative + edge cases #3b/#3c + AC5b rewritten + AC5c simplified). IMP-1 added AC5d per-bearer rate limit + edge case #3d. IMP-3 becomes N/A (no `accountProvision.ts` refactor needed without auto-upsert). PII note added to ADR-031 block. Workflow dedup of "Owner sign-off" lines (was 2 ×, now 1). MCE row 8 added (CI verification). ACs 29 → 30. Net: SIMPLIFIED (no shared upsert path) + DEFENDED (rate limit). |
| 2026-06-10 | Step 0 — Cross-model `/review-spec` round 4 | Gemini APPROVED (3 forward-looking SUGGESTIONs: middleware, ResultBody extraction, i18n CONTRIBUTING note — all deferred to Step 2/follow-up). Codex REVISE 2 IMPORTANT (mechanical): (a) stale "account upsert/read throws" prose in api-spec.yaml 500 description carried over from pre-IMP-2 state; (b) cache contract ambiguity ("`request.account` populated and cached" reused `accountTier.ts` namespace which is tier-string-only). +1 SUG: stale AC22 reference in edge case 5 (now AC27). |
| 2026-06-10 | Step 0 — Round 4 inline fixes (final spec state) | api-spec.yaml 500 prose updated → "admin account tier lookup throws" (no upsert wording). Cache contract narrowed → "tier string only at `account:tier:<sub>`, NOT a richer payload — preserves `actorRateLimit.ts` reader compat". Edge case 5 AC22 → AC27. Round 5 skipped (3 mechanical fixes; Gemini APPROVED + Codex's REVISE was prose consistency, not architecture). |
| 2026-06-10 | Step 1 — Branch + commit `4549ae8` | feature/F-ADMIN-ANALYTICS-UI created off develop @ 46fc0ba. Step 1 audit by external fx agent APPROVE + 4 NITs (breakdown count, distinct NOT_PROVISIONED code, commit message round count, explicit paths) all applied. Pushed to origin. |
| 2026-06-11 | Step 2 — Plan drafted | ui-ux-designer agent (W27-W37 design notes, full admin.json key tree). backend-planner agent (10 steps, ~54 tests). frontend-planner agent (14 steps, ~51 tests). 3 UI/UX deferred decisions resolved by planner (ResultBody Path a extraction, webTotalQueries own section, phone defer to AC26). Committed as `bd57929`. |
| 2026-06-11 | Step 2 — `/review-plan` round 1 | Gemini APPROVED (23 files read, 3 commands; plan empirically sound). Codex REVISE 1 CRITICAL + 3 IMPORTANT + 1 SUGGESTION (45 files read, 30+ commands; rg + sed + nl heavy empirical verification). CRITICAL: actorId leak via ConversationMessageDataSchema reuse; IMP-1: isKeyAdminRoute method-blind regresses GET /restaurants; IMP-2: __none__ negative-cache incoherent with /me upsert; IMP-3: AuthProvider swallows getMe error code, AdminGuard can't render 3 distinct 403 W35 variants; SUG: Vitest patterns in Jest project. |
| 2026-06-11 | Step 2 — Round 1 plan-review fixes applied | AdminResultDataSchema (`ConversationMessageDataSchema.omit({ actorId: true })`) + route also strips actorId + AC20 hardened with seeded-actorId test. isKeyAdminRoute(url, method) method-aware; /restaurants POST encapsulated inside helper, GET /restaurants → false. Negative cache REMOVED — no-row case not cached (trade-off: extra DB reads capped by per-bearer rate limit). AuthProvider.accountErrorCode field + getMe().catch sets NOT_PROVISIONED vs NETWORK_ERROR; AdminGuard branches 3a (notProvisioned amber) vs 3b (verifyFailed slate) vs 4 (forbidden red) — all W35 variants reachable. All Vitest → Jest patterns. |
| 2026-06-11 | Step 2 — `/review-plan` round 2 | Gemini APPROVED ("exceptionally thorough; no new gaps"). Codex REVISE 2 IMPORTANT + 1 SUG: stale `__none__` references survived R1 edit (4 locations: 458, 515, 525, 593); requireAdminBearer test bypass inconsistency (line 657 says only rate-limit skipped; lines 925/929 say fully bypass); SUG duplicate useT test row (1050 + 1059) + AuthProvider missing from Files-to-Modify. All 3 confirmed empirically. |
| 2026-06-11 | Step 2 — Round 2 plan-review inline fixes | All `__none__` mentions purged (Files-to-Modify table + accountTier code-sample comment + verification-commands prose). Test bypass policy unified: "gate stays active in test; only Redis rate-limit branch skipped; legacy tests use explicit named `allowTestBypass: true` opt-out confined to non-auth-scope existing tests; new integration tests for AC1-AC5d MUST NOT use the opt-out". Duplicate useT row removed (kept canonical `lib/i18n/__tests__/`). AuthProvider.tsx + useAuth.ts added to Files-to-Modify table with explicit accountErrorCode extension scope. Round 3 skipped (3 prose-stale fixes; Gemini already APPROVED; Codex content confirmed addressed per its own review body). |
| 2026-06-11 | Step 3 — Backend implementation (TDD) | All 9 backend steps (B1-B9) complete. New files: `adminPrefixes.ts` (isAnalyticsRoute/isKeyAdminRoute), `requireAdminBearer.ts` (6-branch gate factory), `routes/admin/historySample.ts` (GET /analytics/history-sample). Modified: `accountTier.ts` (resolveAccountTierStrict), `errorHandler.ts` (NOT_PROVISIONED case), `plugins/auth.ts` (two-branch split), `analytics.ts`/`missedQueries.ts`/`webMetrics.ts` (gate wiring), `app.ts` (historySampleRoutes), shared `analytics.ts` (5 new schemas). Tests: 128 API tests all pass (8 new/modified files incl. unit + route tests for all new components + legacy bearer migration). 700 shared tests all pass (22 new schema tests). key_facts.md + api-spec.yaml updated. |
| 2026-06-11 | Step 3 — Frontend implementation (TDD) | All 14 frontend steps complete. New files: `lib/i18n/{locale,useT}.ts` + `messages/es/admin.json` (W34 verbatim key tree), `components/ResultBody.tsx` (extracted Path A from TranscriptEntry), `components/admin/{AdminGuard,AdminLayout,MissedQueriesPanel,ResponseReviewPanel,OverviewPanel}.tsx`, `app/admin/{layout,analytics/page}.tsx` (Server Components, noindex). Modified: `components/AuthProvider.tsx` (`accountErrorCode` extension), `hooks/useAuth.ts` (re-export), `lib/apiClient.ts` (adminFetch + 6 wrappers + ApiError code), `lib/metrics.ts` (4 admin events payload-only), `components/TranscriptEntry.tsx` (ResultBody reuse). 51 new tests TDD all green (876/876 total). Commit `b3afc07`. |
| 2026-06-11 | Step 3 — Backend test-migration fix | Backend developer initial report (4774 green) found 14 failing on local re-run (11 in f029.edge-cases + 3 in f113.webMetrics.get.*). Root cause: legacy tests hit `/analytics/*` without bearer expecting old behavior. Fix: `BuildAppOptions.adminBypass?: boolean` opt-out → `allowTestBypass` propagated to 3 route plugin options. 23 legacy `buildApp()` migrated to `buildApp({ adminBypass: true })` in f029.edge-cases. f113.webMetrics.get tests split — beforeAll uses bypass=true; 3 gate-assertion tests build per-test app with bypass=false. Commit `6ef5b2d`. Lesson: per memory `feedback_mock_boundary_integration_gap`, never trust agent test-count claim without re-running gates yourself. |
| 2026-06-11 | Step 4 — Quality gates | All gates green: api 4785/4785 (+11), shared 700/700 (no delta), web 876/876 (+51). Lint 0 / Typecheck 0 / Build clean. `/admin/analytics` bundle 8.09 kB / 137 kB First Load. Tracker synced (`23d002f`). |
| 2026-06-11 | Step 5 — code-review-specialist | REVISE verdict. 2 CRITICAL (C1 trackMissedQueries shape mismatch — frontend expects `data: [...]` backend returns `data: { tracked: [...] }`; C2 intent filter applied post-LIMIT in memory, under-delivers results) + 5 IMPORTANT (I1 trackEvent in render phase, I2 historySample missing allowTestBypass, I3 unsafe cache cast, I4 useT new function ref each render, I5 dead MenuDishList import) + 12 NITs. Both CRITs were uncaught due to mock-boundary integration gap (matches `feedback_mock_boundary_integration_gap`). |
| 2026-06-11 | Step 5 — qa-engineer | REVISE verdict. 1 CRITICAL confirmed empirically (BUG-1 historySample crashes 500 on `result_jsonb=NULL` + intent filter active; in-memory cast without null guard at line 106) + 2 IMPORTANT (BUG-2 same as C2 above + BUG-3 Redis EXPIRE failure → no TTL → permanent sub-lockout DoS surface) + 4 edge cases + 4 test gaps + 3 doc-drift items (ACs all `[ ]`, MCE empty, AC14 spec/impl mismatch). 16 new edge-case tests added (15 pass + 1 confirming BUG-1). |
| 2026-06-11 | Step 5 — fix-loop applied | Backend (ready for commit): historySample intent filter moved to SQL (`sql\`result_jsonb->>'intent' = ${intent}\``) fixing C2 AND BUG-1 (null `result_jsonb` excluded naturally by `->>` returning NULL); `redis.expire().catch()` fire-and-forget pattern fixing BUG-3 permanent-lockout; historySample register accepts `allowTestBypass` (I2); accountTier cache cast validated runtime guard (I3). +22 backend tests (4785→4807). Frontend: trackMissedQueries unwraps `.tracked` (C1); AdminGuard trackEvent moved render→useEffect via useMemo variant (I1); useT memoised with useMemo `[namespace]` (I4); ResultBody dead MenuDishList import removed (I5). +7 web tests (876→883). All gates re-verified green: api 4807/4807, shared 700/700, web 883/883, lint 0, typecheck 0, build clean (/admin/analytics bundle 8.11 kB / 137 kB unchanged). |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Ticket has all mandatory sections: Spec, Acceptance Criteria (30), Definition of Done, Workflow Checklist, Completion Log, Merge Checklist Evidence, Implementation Plan — Backend, Implementation Plan — Frontend. Status header set to `Ready for Merge`. ADR-031 cited in header. |
| 1. Mark all items | [x] | 30/30 ACs marked (AC1-AC25 + AC5b/c/d = 28 `[x]`; AC26 + AC27 left `[ ]` as Status: Pending — post-merge operator smokes per DoD line "All ACs above met except AC26 and AC27"). DoD 12/13 `[x]` (line "PR opened against develop with CI green" pending Step 6). Workflow 23/24 `[x]` (Step 6 pending merge). |
| 2. Verify product tracker | [x] | `docs/project_notes/product-tracker.md` Active Session shows F-ADMIN-ANALYTICS-UI step 5/6 (last sync commit `23d002f` Step 4); Features table row `in-progress` step 5/6. To be re-synced to step 5/6 post-Step 5 commit. |
| 3. Update key_facts.md | [x] | `docs/project_notes/key_facts.md` — Admin route `/admin/analytics` documented in Step 3 backend commit `19d130b` (added requireAdminBearer + history-sample endpoint to endpoints index + i18n-light infra note + auth migration note). |
| 4. Update decisions.md | [x] | ADR-031 "Bearer-only admin auth for `/analytics/*`" added — Context / Decision / Tradeoffs / Out of scope sections per Spec → ADR-031 Required block; matches AC25 + Workflow Step 1. Status: Proposed; will flip to Accepted upon merge. |
| 5. Commit documentation | [x] | 8 commits since develop @ `46fc0ba` (`4549ae8`, `bd57929`, `ca7108e`, `19d130b`, `c7caa28`, `6ef5b2d`, `b3afc07`, `23d002f`). Step 5 fix-loop pending one final commit (covers all backend + frontend findings fixes + ticket evidence). |
| 6. Verify clean working tree | [x] | Pre-Step 5 commit state: only `.claude/scheduled_tasks.lock` modified (session noise, never committed); revert of `bugs.md` qa-engineer transient edit applied (BUG-1 caught + fixed pre-merge, doesn't belong in production bugs.md). All Step 5 fix-loop edits will be in next commit. |
| 7. Verify branch up to date | [x] | `git merge-base --is-ancestor origin/develop HEAD && echo "UP TO DATE"` returns UP TO DATE. Branch `feature/F-ADMIN-ANALYTICS-UI` last synced with develop at fork point `46fc0ba` (created 2026-06-10); no upstream commits to develop since (verified via `git log origin/develop..HEAD` showing only forward commits). |
| 8. Verify CI green (`gh pr checks <N>`) | [ ] | Pending Step 6 PR creation. Local gates verified green: api 4807/4807, shared 700/700, web 883/883, lint 0, typecheck 0, build clean (`/admin/analytics` bundle 8.11 kB / 137 kB). |
| 9. Run `/audit-merge` | [ ] | Pending — runs after Step 5 fix-loop commit (12 structural + 16 drift checks). |

---

## Implementation Plan — Backend

### Existing Code to Reuse

| Symbol | File | Purpose |
|--------|------|---------|
| `ADMIN_PREFIXES` | `packages/api/src/plugins/adminPrefixes.ts:7` | Preserve as union; `rateLimit.ts:131` imports it for `allowList` — MUST remain intact |
| `isAdminRoute` | `packages/api/src/plugins/adminPrefixes.ts:9` | Keep exported for any future consumer; auth.ts currently only uses the new split helpers after B2 |
| `validateAdminKey` | `packages/api/src/plugins/adminAuth.ts` | Unchanged — still used for `isKeyAdminRoute` branch |
| `resolveAccountTier` | `packages/api/src/lib/accountTier.ts:22` | Back-compat wrapper kept; `actorRateLimit.ts:111` + `auth.ts:435` import it and must not break |
| `verifyBearerJwt` | `packages/api/src/plugins/authBearer.ts` | Already called by `actorResolver.ts` and `history.ts`; `requireAdminBearer` relies on `request.accountId` which `actorResolver` sets post-verification — no second JWT verify needed in the preHandler |
| `redis.incr` / `redis.expire` | `packages/api/src/plugins/actorRateLimit.ts:151-155` | Pattern for per-key rate limiting with TTL on first increment — reuse exact pattern in `requireAdminBearer` |
| `SearchHistoryKindSchema` | `packages/shared/src/schemas/history.ts:39` | Reuse for `SearchHistorySampleEntrySchema.kind` |
| `ConversationMessageDataSchema` | `packages/shared/src/schemas/conversation.ts:148` | **Use via `.omit({ actorId: true })`** for `SearchHistorySampleEntrySchema.resultData` (per /review-plan round 1 CRITICAL — actorId leak). Same safeParse-per-row drift pattern as `useSearchHistory`. Route strips actorId before serialisation. |
| `ConversationIntentSchema` | `packages/shared/src/schemas/conversation.ts:59` | Reuse for `HistorySampleParamsSchema.intent` |
| `AnalyticsDataSchema` / `AnalyticsResponseSchema` | `packages/shared/src/schemas/analytics.ts:76,93` | Structural mirror for the new data + response schema pair |
| `SearchHistory` Kysely type | `packages/api/src/generated/kysely-types.ts:250` | Columns: `id`, `account_id`, `kind`, `query_text`, `result_jsonb`, `created_at` — use for typed SELECT |
| Error-code throw pattern | `packages/api/src/routes/analytics.ts:194` | `throw Object.assign(new Error(...), { code: 'DB_UNAVAILABLE', statusCode: 500, cause: err })` — replicate for all new error codes |
| `fastifyPlugin` wrap pattern | `packages/api/src/routes/analytics.ts:269` | All route plugins use `fastifyPlugin(plugin)` — required so global error handler catches errors |
| `mapError` known codes | `packages/api/src/errors/errorHandler.ts` | `UNAUTHORIZED`→401, `FORBIDDEN`→403, `DB_UNAVAILABLE`→500, `RATE_LIMIT_EXCEEDED`→429 already handled. `NOT_PROVISIONED` is a new 403 code — must be added to `errorHandler.ts` |

---

### Files to Create

| File | Purpose |
|------|---------|
| `packages/api/src/plugins/requireAdminBearer.ts` | Fastify preHandler plugin — bearer presence check + per-sub rate limit (30/min) + strict tier resolution + 401/403(NOT_PROVISIONED)/403(FORBIDDEN)/500/429 branches |
| `packages/api/src/routes/admin/historySample.ts` | `GET /analytics/history-sample` route — bearer-gated via `requireAdminBearer`, Kysely query on `search_history` (no `account_id` in SELECT), safeParse each row, envelope response |
| `packages/api/src/__tests__/fAdminAnalytics.adminPrefixes.unit.test.ts` | Unit tests for new helper functions in `adminPrefixes.ts` |
| `packages/api/src/__tests__/fAdminAnalytics.requireAdminBearer.unit.test.ts` | Unit tests for all 6 branches of `requireAdminBearer` (mocked Redis + Prisma) |
| `packages/api/src/__tests__/fAdminAnalytics.requireAdminBearer.integration.test.ts` | Integration tests for `requireAdminBearer` via `buildApp().inject()` on `/analytics/queries` and the new history-sample route |
| `packages/api/src/__tests__/fAdminAnalytics.historySample.unit.test.ts` | Unit tests for the historySample route handler — envelope shape, intent filter, hours/limit params, privacy assertion, drift-row drop, empty result |
| `packages/api/src/__tests__/fAdminAnalytics.accountTierStrict.unit.test.ts` | Unit tests for the new `resolveAccountTierStrict` function — including null (no-row), sentinel caching, and DB-throw rethrow |

---

### Files to Modify

| File | Change |
|------|--------|
| `packages/api/src/plugins/adminPrefixes.ts` | Add `ANALYTICS_PREFIX`, `KEY_ADMIN_PREFIXES`, `isAnalyticsRoute()`, `isKeyAdminRoute()`. Preserve `ADMIN_PREFIXES` (still consumed by `rateLimit.ts`) and `isAdminRoute` |
| `packages/api/src/plugins/auth.ts` | Split the `if (isAdminRoute(...))` block into two sequential checks: `if (isAnalyticsRoute(...)) return` then `if (isKeyAdminRoute(...)) { validateAdminKey ... return }` |
| `packages/api/src/lib/accountTier.ts` | Add `resolveAccountTierStrict()` returning `'admin' \| 'pro' \| 'free' \| null`; **cache tier strings only** (no negative caching — `null` returned uncached per /review-plan round 1 IMPORTANT); keep `resolveAccountTier` as back-compat wrapper mapping `null→'free'` |
| `packages/api/src/errors/errorHandler.ts` | Add `NOT_PROVISIONED` → 403 case (parallel to the existing `FORBIDDEN` → 403 case, distinct code so the web AdminGuard can branch) |
| `packages/api/src/app.ts` | Import and register `historySampleRoutes` alongside the other analytics routes (after `webMetricsRoutes` registration, before `authRoutes`) |
| `packages/shared/src/schemas/analytics.ts` | Append `HistorySampleParamsSchema`, `SearchHistorySampleEntrySchema`, `HistorySampleDataSchema`, `HistorySampleResponseSchema` |
| `packages/shared/src/index.ts` | Already exports `./schemas/analytics` — no new export line needed; the 4 new schemas export from the same file |
| `docs/specs/api-spec.yaml` | Add `GET /analytics/history-sample` entry; migrate security of 5 existing `/analytics/*` endpoints from `AdminKeyAuth` to `BearerAuth`; update 401 prose + add 403 response blocks |
| `docs/project_notes/key_facts.md` | Add F-ADMIN-ANALYTICS-UI bullet (ADR-031 auth migration, new endpoint, new schemas) to the Auth middleware and Analytics route sections |

---

### Implementation Order

**Phase 0 — Auth migration (Steps B1 → B5)**

1. **B1 — `packages/api/src/plugins/adminPrefixes.ts`**

   Add to the existing file (after the existing exports):

   ```typescript
   export const ANALYTICS_PREFIX = '/analytics/' as const;
   export const KEY_ADMIN_PREFIXES = ['/ingest/', '/quality/', '/embeddings/', '/admin/'] as const;

   export function isAnalyticsRoute(url: string | undefined, method?: string): boolean {
     if (!url) return false;
     // POST /analytics/web-events is public (sendBeacon — cannot set auth headers)
     if (url === '/analytics/web-events' && method === 'POST') return false;
     return url.startsWith(ANALYTICS_PREFIX);
   }

   export function isKeyAdminRoute(url: string | undefined, method?: string): boolean {
     if (!url) return false;
     // POST /restaurants is admin via key; GET /restaurants is public catalog
     if (url === '/restaurants') return method === 'POST';
     return KEY_ADMIN_PREFIXES.some((prefix) => url.startsWith(prefix));
   }
   ```

   Keep `ADMIN_PREFIXES` and `isAdminRoute` intact — `rateLimit.ts` imports `ADMIN_PREFIXES` directly.

   **RED test:** `fAdminAnalytics.adminPrefixes.unit.test.ts`
   - `isAnalyticsRoute('/analytics/queries', 'GET')` → `true`
   - `isAnalyticsRoute('/analytics/web-events', 'POST')` → `false` (public exemption)
   - `isAnalyticsRoute('/analytics/web-events', 'GET')` → `true`
   - `isAnalyticsRoute('/ingest/url', 'POST')` → `false`
   - `isKeyAdminRoute('/ingest/url', 'POST')` → `true`
   - `isKeyAdminRoute('/quality/report', 'GET')` → `true`
   - `isKeyAdminRoute('/embeddings/generate', 'POST')` → `true`
   - `isKeyAdminRoute('/admin/waitlist', 'GET')` → `true`
   - `isKeyAdminRoute('/analytics/queries', 'GET')` → `false`
   - **`isKeyAdminRoute('/restaurants', 'POST')` → `true`** (catalog admin write)
   - **`isKeyAdminRoute('/restaurants', 'GET')` → `false`** (public catalog read — must NOT regress per `/review-plan` round 1 IMPORTANT)
   - **`isKeyAdminRoute('/restaurants', undefined)` → `false`** (no method = treat as non-admin to be safe)
   - `ADMIN_PREFIXES` still includes `/analytics/` (unchanged)
   - `isAdminRoute('/analytics/queries', 'GET')` still returns `true` (unchanged behavior)

2. **B4 — `packages/api/src/lib/accountTier.ts`** (must precede B3 which imports it)

   Add `resolveAccountTierStrict`:

   ```typescript
   type AccountTierOrNull = 'free' | 'pro' | 'admin' | null;

   /**
    * Strict variant — returns null when no accounts row exists for sub.
    * Does NOT fail-open: if DB throws, the error propagates to the caller.
    * Cache contract: stores tier string ('free'/'pro'/'admin') with 60s TTL.
    * NO negative caching for no-row case (per /review-plan round 1 IMPORTANT —
    * Codex): /me upserts the accounts row but has no cache invalidation hook,
    * so caching a no-row sentinel would block an admin for up to 60s after
    * their first /me call. Trade-off: each non-provisioned bearer hits DB
    * once per call to /analytics/* (no cache). Acceptable since (a)
    * /analytics/* is low-traffic admin-only, (b) the per-bearer rate limit in
    * requireAdminBearer (30/min) caps DB hits to 30/min per non-admin bearer.
    */
   export async function resolveAccountTierStrict(
     redis: Redis,
     prisma: PrismaClient,
     sub: string,
     logger: FastifyBaseLogger,
   ): Promise<AccountTierOrNull> { ... }
   ```

   On cache read: if value is `'admin'`, `'pro'`, or `'free'` → return it. On cache miss → query DB; if row exists, cache + return tier; if row missing, return `null` WITHOUT caching.

   Update `resolveAccountTier` to call `resolveAccountTierStrict` and map `null→'free'`. Existing fail-open behavior preserved (when strict throws, wrapper catches and returns `'free'`).

   **RED tests:** `fAdminAnalytics.accountTierStrict.unit.test.ts`
   - Cache hit with `'admin'` → returns `'admin'` (no DB hit)
   - Cache miss + DB returns row → returns tier + caches tier string with TTL 60
   - Cache miss + DB returns no row → returns `null` + **does NOT cache** (verified by asserting redis.set was NOT called)
   - Cache miss + DB throws → rethrows (does NOT return `'free'`)
   - Back-compat: `resolveAccountTier` with no-row → still returns `'free'`
   - **Provisioning coherence test:** call A → no-row → returns null (no cache); /me upsert simulates row creation; call B → cache miss → DB returns row → returns tier (admin not blocked by stale negative cache)
   - Back-compat: `resolveAccountTier` with DB error → still returns `'free'` (fail-open)

3. **B3 — `packages/api/src/plugins/requireAdminBearer.ts`** (new file; depends on B4)

   ```typescript
   import type { FastifyRequest, FastifyReply } from 'fastify';
   import type { Redis } from 'ioredis';
   import type { PrismaClient } from '@prisma/client';
   import { resolveAccountTierStrict } from '../lib/accountTier.js';

   export interface RequireAdminBearerOptions {
     redis: Redis;
     prisma: PrismaClient;
     rateLimitMax?: number;       // default 30
     rateLimitWindowSec?: number; // default 60
   }

   /**
    * Fastify preHandler: verifies bearer is present and resolves to an admin account.
    *
    * Behavior (per AC1/AC2/AC3/AC5b/AC5c/AC5d):
    *   1. request.accountId unset (no/invalid bearer) → throw 401 UNAUTHORIZED
    *   2. Per-sub Redis INCR rate limit (30/min default) → throw 429 RATE_LIMIT_EXCEEDED if exceeded
    *   3. resolveAccountTierStrict → null (no accounts row) → throw 403 NOT_PROVISIONED
    *   4. tier === 'admin' → continue (sets request.adminVerified = true)
    *   5. tier === 'free' | 'pro' (row exists, not admin) → throw 403 FORBIDDEN
    *   6. resolveAccountTierStrict throws (DB error) → throw 500 DB_UNAVAILABLE
    *
    * NOT a FastifyPluginAsync — exported as a plain async handler for use as a
    * route-level preHandler. Options are closed over via a factory function:
    *
    *   const gate = makeRequireAdminBearer({ redis, prisma });
    *   app.addHook('preHandler', gate);   // inside a route plugin scope
    */
   export function makeRequireAdminBearer(
     opts: RequireAdminBearerOptions,
   ): (request: FastifyRequest, reply: FastifyReply) => Promise<void> { ... }
   ```

   Rate limit key: `admin:bearer:ratelimit:<sub>`, INCR + EXPIRE on first increment (same pattern as `actorRateLimit.ts:151-155`). In `NODE_ENV === 'test'`, rate limit check is skipped (mirror `rateLimit.ts:107` pattern) — prevents test counter leakage.

   `request.adminVerified` augmentation: declare via module augmentation in this file (same pattern as `authBearer.ts:29-31` for `accountId`).

   **RED tests — unit (`fAdminAnalytics.requireAdminBearer.unit.test.ts`):**
   - No `accountId` on request → throws with `code: 'UNAUTHORIZED'`
   - Rate limit exceeded (`redis.incr` returns > 30) → throws with `code: 'RATE_LIMIT_EXCEEDED'`
   - `resolveAccountTierStrict` returns `null` → throws with `code: 'NOT_PROVISIONED'`, message includes "Call GET /me once"
   - `resolveAccountTierStrict` returns `'admin'` → does NOT throw; sets `request.adminVerified = true`
   - `resolveAccountTierStrict` returns `'free'` → throws with `code: 'FORBIDDEN'`
   - `resolveAccountTierStrict` returns `'pro'` → throws with `code: 'FORBIDDEN'`
   - `resolveAccountTierStrict` throws → throws with `code: 'DB_UNAVAILABLE'`

4. **B2 — `packages/api/src/plugins/auth.ts`** (depends on B1)

   Replace `if (isAdminRoute(url, request.method)) {` block with:

   ```typescript
   // Analytics routes — bearer-only (ADR-031). Skip key check; actorResolver
   // (registered after auth.ts) sets request.accountId; requireAdminBearer
   // preHandler attached at route level verifies accountId + tier.
   if (isAnalyticsRoute(url, request.method)) return;

   // Key-admin routes — X-API-Key gate (unchanged). `/restaurants POST` is
   // encapsulated inside isKeyAdminRoute (method-aware) so this caller stays clean.
   if (isKeyAdminRoute(url, request.method)) {
     // ... existing validateAdminKey logic unchanged ...
   }
   ```

   Import `isAnalyticsRoute` and `isKeyAdminRoute` from `./adminPrefixes.js` (remove `isAdminRoute` import if no longer used here; or keep for safety — it's still exported).

   **RED tests (in `fAdminAnalytics.requireAdminBearer.integration.test.ts`):**
   - `GET /analytics/queries` with `X-API-Key: ADMIN_KEY` and no bearer → `401` (AC1)
   - `GET /analytics/missed-queries` with valid admin bearer → `200` (AC3 — requires seeded admin account)
   - `GET /admin/waitlist` with valid `X-API-Key` and no bearer → still `200` (AC4 regression)
   - `POST /analytics/web-events` with no auth → `202` (AC5 public exemption preserved)

5. **B5 — Wire `requireAdminBearer` onto existing analytics routes**

   In each of `analytics.ts`, `missedQueries.ts`, `webMetrics.ts`: inside the plugin body, after `const { db, ... } = opts`, add:

   ```typescript
   const gate = makeRequireAdminBearer({ redis, prisma });
   app.addHook('preHandler', gate);
   ```

   This requires adding `redis: Redis` and `prisma: PrismaClient` to the plugin options interfaces (`AnalyticsPluginOptions`, `MissedQueriesPluginOptions`, `WebMetricsPluginOptions`) and passing them from `app.ts`.

   `POST /analytics/web-events` is registered in `webMetrics.ts` — the preHandler must NOT apply to it. Because `isAnalyticsRoute` exempts `POST /analytics/web-events` from the auth.ts branch, and because the preHandler is registered at the plugin level (not per-route), you must either:
   - Register the public POST and the gated GET in separate plugin scopes, OR
   - Apply the preHandler only to the GET route via `{ preHandler: [gate] }` in the route options, not via `app.addHook`.

   **Recommended pattern:** Use per-route `{ preHandler: [gate] }` on each gated route (same pattern as `historyRoutes` which calls `verifyBearerJwt` inline). This is more precise than a plugin-level `addHook` and avoids splitting `webMetrics.ts`. The gate function signature `(request, reply) => Promise<void>` fits directly as a Fastify preHandler.

   Plugin options update in `app.ts`: pass `redis: redisClient, prisma: prismaClient` to all 3 analytics route registrations (they currently receive only `db: getKysely()` — add the two new dependencies).

   **Existing test migration:** Tests in `f029.analytics.route.test.ts`, `f079.missed-queries.unit.test.ts`, `f113.webMetrics.*.test.ts` currently pass because `isAdminRoute` in `auth.ts` short-circuits the X-API-Key gate and the routes require no bearer. After B2, the auth hook skips analytics routes entirely (no key check). Tests that previously mocked the admin key context will need updating: remove X-API-Key header assertions and either (a) add a mock `request.accountId` in test setup OR (b) verify that the existing `NODE_ENV=test` guard in `requireAdminBearer` skips rate-limiting while integration tests seed an admin account. Document this migration step in test file headers.

6. **B-ERR — `packages/api/src/errors/errorHandler.ts`** (must precede integration tests)

   Add `NOT_PROVISIONED` case alongside `FORBIDDEN`:

   ```typescript
   // NOT_PROVISIONED — bearer valid but accounts row missing (requireAdminBearer, F-ADMIN-ANALYTICS-UI)
   if (asAny['code'] === 'NOT_PROVISIONED') {
     return {
       statusCode: 403,
       body: {
         success: false,
         error: {
           message: error.message,
           code: 'NOT_PROVISIONED',
         },
       },
     };
   }
   ```

   No new test file needed — the existing `mapError` unit test file can be extended with one case.

**Phase 1 — history-sample endpoint (Steps B6 → B7)**

7. **B6 — `packages/shared/src/schemas/analytics.ts`** (no dependencies, can be done in parallel with Phase 0)

   Append after `AnalyticsResponseSchema`:

   ```typescript
   // ---------------------------------------------------------------------------
   // HistorySampleParamsSchema — GET /analytics/history-sample query params
   // ---------------------------------------------------------------------------

   export const HistorySampleParamsSchema = z.object({
     intent:  ConversationIntentSchema.optional(),
     hours:   z.coerce.number().int().min(1).max(720).default(24),
     limit:   z.coerce.number().int().min(1).max(100).default(20),
   });
   export type HistorySampleParams = z.infer<typeof HistorySampleParamsSchema>;

   // ---------------------------------------------------------------------------
   // SearchHistorySampleEntrySchema — single item in history-sample response
   // (privacy subset: NO account_id or any account identifier)
   // ---------------------------------------------------------------------------

   export const SearchHistorySampleEntrySchema = z.object({
     id:         z.string().uuid(),
     kind:       SearchHistoryKindSchema,
     queryText:  z.string().min(1).max(2000),
     resultData: AdminResultDataSchema, // ConversationMessageDataSchema.omit({ actorId: true })
     createdAt:  z.string().datetime(),
   });
   export type SearchHistorySampleEntry = z.infer<typeof SearchHistorySampleEntrySchema>;

   // NEW redacted schema (per /review-plan round 1 CRITICAL — Codex):
   // ConversationMessageDataSchema declares actorId as required, so the admin
   // response uses an omitted variant to prevent leaking user identity through
   // the resultData field. The route must ALSO strip actorId from each row's
   // result_jsonb before serialising (omit() on the schema validates the SHAPE
   // but does not strip data — the runtime omission is a separate step).
   export const AdminResultDataSchema = ConversationMessageDataSchema.omit({ actorId: true });
   export type AdminResultData = z.infer<typeof AdminResultDataSchema>;

   // ---------------------------------------------------------------------------
   // HistorySampleDataSchema + HistorySampleResponseSchema — envelope
   // ---------------------------------------------------------------------------

   export const HistorySampleDataSchema = z.object({
     items:        z.array(SearchHistorySampleEntrySchema),
     hours:        z.number().int().min(1).max(720),
     limit:        z.number().int().min(1).max(100),
     intentFilter: ConversationIntentSchema.optional(),
   });
   export type HistorySampleData = z.infer<typeof HistorySampleDataSchema>;

   export const HistorySampleResponseSchema = z.object({
     success: z.literal(true),
     data:    HistorySampleDataSchema,
   });
   export type HistorySampleResponse = z.infer<typeof HistorySampleResponseSchema>;
   ```

   Import `SearchHistoryKindSchema` from `./history.js` and `ConversationIntentSchema` / `ConversationMessageDataSchema` from `./conversation.js` at the top of the file. `packages/shared/src/index.ts` already exports `./schemas/analytics` — no barrel change needed.

   **RED tests (`packages/shared/src/__tests__/schemas.test.ts` or a new file):**
   - `HistorySampleParamsSchema.parse({})` → `{ hours: 24, limit: 20 }` (defaults)
   - `HistorySampleParamsSchema.parse({ hours: '721' })` → throws (max 720)
   - `HistorySampleParamsSchema.parse({ limit: '0' })` → throws (min 1)
   - `HistorySampleParamsSchema.parse({ intent: 'invalid' })` → throws
   - `HistorySampleParamsSchema.parse({ intent: 'estimation', hours: '48', limit: '50' })` → correct coerce
   - `SearchHistorySampleEntrySchema` golden parse (all fields present, no `accountId` field in schema)
   - `HistorySampleResponseSchema` golden roundtrip

8. **B7 — `packages/api/src/routes/admin/historySample.ts`** (depends on B3, B6)

   Plugin options:
   ```typescript
   export interface HistorySamplePluginOptions {
     db:     Kysely<DB>;
     redis:  Redis;
     prisma: PrismaClient;
   }
   ```

   Route: `GET /analytics/history-sample`

   Handler steps:
   1. Apply `makeRequireAdminBearer({ redis, prisma })` gate via `{ preHandler: [gate] }` route option.
   2. Parse query params with `HistorySampleParamsSchema.parse(request.query)` — Fastify's Zod validator handles this if schema is attached; if using `request.query as ...` pattern (like `analytics.ts`), validate manually and throw `VALIDATION_ERROR`.
   3. Kysely query — `id`, `kind`, `query_text`, `result_jsonb`, `created_at` from `search_history`. NO `account_id`. Apply `created_at >= NOW() - INTERVAL '<hours> hours'`. If `intent` param present: `AND result_jsonb->>'intent' = <intent>`. `ORDER BY created_at DESC LIMIT <limit>`.
   4. Map rows: `ConversationMessageDataSchema.safeParse(row.result_jsonb)` — skip rows where `!result.success`. Log count of dropped rows at `debug` level (not `warn` — this is expected for old rows; no PII in the log).
   5. Return `{ success: true, data: { items, hours, limit, intentFilter: intent } }`. If `intent` was absent, omit `intentFilter` key (not `undefined` — use spread: `...(intent && { intentFilter: intent })`).

   Kysely SQL guidance: use `sql<string>` template for the INTERVAL to match `analytics.ts` pattern:
   ```typescript
   .where(sql<boolean>`created_at >= NOW() - INTERVAL ${sql.lit(`${hours} hours`)}`)
   ```
   For the intent filter on JSONB:
   ```typescript
   .where(sql<boolean>`result_jsonb->>'intent' = ${intent}`)
   ```

   Register in `app.ts`:
   ```typescript
   import { historySampleRoutes } from './routes/admin/historySample.js';
   // ...
   await app.register(historySampleRoutes, { db: getKysely(), redis: redisClient, prisma: prismaClient });
   ```
   Register immediately after `webMetricsRoutes` and before `authRoutes`.

   **RED tests (`fAdminAnalytics.historySample.unit.test.ts`):**
   - Default params → `hours: 24`, `limit: 20`, no intent filter
   - `intent` filter present → SQL where clause includes JSONB filter
   - Empty DB result → `{ success: true, data: { items: [], hours: 24, limit: 20 } }` (no `intentFilter`)
   - Drifted row (`result_jsonb` fails safeParse) → dropped from `items`, not returned
   - Mix of valid + drifted rows → only valid rows in `items`
   - Response shape: assert `accountId` key NOT present on any item (AC20 privacy)
   - DB throws → propagates as `DB_UNAVAILABLE` 500
   - Hours out of range → 400 `VALIDATION_ERROR`

**Phase 2 — api-spec.yaml (Step B8)**

9. **B8 — `docs/specs/api-spec.yaml`**

   - Add `GET /analytics/history-sample` path with full query params (`intent`, `hours`, `limit`), `401`/`400`/`403`/`500` responses, and `BearerAuth` security.
   - For 5 existing analytics endpoints (`GET /analytics/queries`, `GET /analytics/missed-queries`, `POST /analytics/missed-queries/track`, `POST /analytics/missed-queries/:id/status`, `GET /analytics/web-events`): change `security: [{AdminKeyAuth: []}]` → `security: [{BearerAuth: []}]`; update 401 prose from "Missing or invalid admin API key" → "Missing or invalid bearer token"; add 403 response block with `code: FORBIDDEN` example.
   - `POST /analytics/web-events` security: no change (public).

**Phase 3 — Documentation (Step B9)**

10. **B9 — `docs/project_notes/key_facts.md`**

    In the **Auth middleware** section (around line 192): update to reflect ADR-031 split (`isAnalyticsRoute` → bearer-only, `isKeyAdminRoute` → X-API-Key).

    In the **Analytics route** section (around line 183): add `requireAdminBearer` preHandler note, new endpoint `GET /analytics/history-sample`, and `HistorySample*` schemas.

    Add new entry: **F-ADMIN-ANALYTICS-UI** — Bearer-only admin auth for `/analytics/*` (ADR-031); new `GET /analytics/history-sample` endpoint; `resolveAccountTierStrict` in `accountTier.ts`; `NOT_PROVISIONED` error code in `errorHandler.ts`.

---

### Testing Strategy

**Test files to create:**

| File | Type | Count (est.) |
|------|------|-------------|
| `packages/api/src/__tests__/fAdminAnalytics.adminPrefixes.unit.test.ts` | Unit | ~10 |
| `packages/api/src/__tests__/fAdminAnalytics.accountTierStrict.unit.test.ts` | Unit | ~9 |
| `packages/api/src/__tests__/fAdminAnalytics.requireAdminBearer.unit.test.ts` | Unit | ~10 |
| `packages/api/src/__tests__/fAdminAnalytics.requireAdminBearer.integration.test.ts` | Integration | ~8 |
| `packages/api/src/__tests__/fAdminAnalytics.historySample.unit.test.ts` | Unit | ~10 |
| `packages/shared/src/__tests__/` (extend existing or new) | Unit | ~7 |

**Total new tests: ~54 (target 30-40 per spec was conservative; strict + integration coverage warrants more)**

**Key test scenarios:**

Phase 0 — auth split:
- `GET /analytics/queries` with `X-API-Key` only → 401 (AC1)
- `GET /analytics/queries` with valid non-admin bearer → 403 `FORBIDDEN` (AC2)
- `GET /analytics/queries` with valid admin bearer → 200 (AC3)
- `GET /admin/waitlist` with `X-API-Key` → still 200 (AC4 regression — X-API-Key unchanged)
- `GET /quality/report` with `X-API-Key` → still 200 (AC4)
- `POST /embeddings/generate` with `X-API-Key` → still 200 (AC4)
- `POST /ingest/url` with `X-API-Key` → still 200 (AC4)
- `POST /analytics/web-events` with no auth → 202 (AC5)
- Bearer present but no accounts row → 403 `NOT_PROVISIONED` with hint message (AC5b) + assert no row written to `accounts`
- DB throws during tier read → 500 `DB_UNAVAILABLE` (AC5c)
- 31st request within 60s window (same sub) → 429 `RATE_LIMIT_EXCEEDED` (AC5d — integration test, mocked Redis INCR)

Phase 1 — history-sample:
- Default params → envelope with correct defaults echoed (AC20)
- `?hours=721` → 400 (AC21)
- `?limit=0` → 400 (AC21)
- `?intent=invalid_value` → 400 (AC21)
- Seeded drifted row → not in `items` (AC21)
- Response item: no `accountId` / `actorHash` keys (AC20)
- `?intent=estimation` → SQL WHERE includes JSONB filter
- Empty result → `items: []`, no error

**Mocking strategy:**

- Unit tests: mock Redis (`get`, `set`, `incr`, `expire`), mock Prisma (`$queryRaw`), mock Kysely (reuse `kyselyContainer` pattern from `f029.analytics.route.test.ts:17-68`). No real DB or Redis.
- Integration tests: use `buildApp({ config: testConfig })` with real test DB (Supabase test instance) and real Redis (test Redis). Seed admin and non-admin accounts in `beforeAll`. Clean up in `afterAll`.
- `fAdminAnalytics.requireAdminBearer.integration.test.ts`: seed two accounts — one with `tier='admin'`, one with `tier='free'`. Use `buildApp().inject()` to fire requests with mocked bearer (set `request.accountId` by seeding `SUPABASE_JWKS_URL` to the test JWKS or by bypassing JWT verify in test env via `NODE_ENV=test` shortcut if one exists). Verify `accounts` row count UNCHANGED after NOT_PROVISIONED rejection.
- Rate limit integration: mock Redis INCR to return 31 directly (avoid real counter management in CI).

**Existing test migration — after B5 (revised per /review-plan round 2 IMPORTANT — Codex):**

`f029.analytics.route.test.ts` and `f113.webMetrics.*.test.ts` currently assume the global `auth.ts` hook handles admin auth. After B2, the hook skips analytics routes entirely — routes that were "protected by X-API-Key" now need `requireAdminBearer`.

**Test bypass policy (unified — fixes round 2 IMPORTANT-2 inconsistency):**

The B3 step skips ONLY the Redis rate-limit branch in `NODE_ENV=test` (mirrors `rateLimit.ts:107`). The gate itself (accountId + tier resolution + NOT_PROVISIONED/FORBIDDEN/DB_UNAVAILABLE branching) **stays ACTIVE in all environments including test** — this is what makes AC1/AC2/AC3/AC5b/AC5c integration tests meaningful. Fully bypassing the gate in test would weaken those ACs to no-ops.

For LEGACY tests that still rely on X-API-Key (`f029.analytics.route.test.ts`, `f113.webMetrics.*.test.ts`), the migration path is:
1. **Preferred:** Each test seeds an admin account row + sets `request.accountId` via a test helper that injects a bearer (or stubs `request.accountId` directly on `app.inject()` payload). Pattern mirrors `f-web-tier/fWebTier.usageEndpoint.integration.test.ts` lines 160-170 (admin account seed via `prisma.$executeRaw`).
2. **Explicit opt-out (for legacy non-auth-scope tests only):** `makeRequireAdminBearer({ ...opts, allowTestBypass: true })` where the factory honours an opt-in flag to skip the full gate. NEW integration tests (`fAdminAnalytics.requireAdminBearer.integration.test.ts`) MUST NOT use this flag — they exercise the real gate to validate AC1/AC2/AC3/AC5b/AC5c.

The `allowTestBypass` opt-out is a deliberate, named escape hatch confined to legacy tests, not a default-on test mode. Default behaviour in test: rate limit skipped, gate active.

---

### Key Patterns

- **`fastifyPlugin` wrap** (required): All route plugins use `fastifyPlugin(plugin)` — failure to wrap means Fastify's `setErrorHandler` scope won't catch errors from the plugin. Reference: `packages/api/src/routes/analytics.ts:269`.
- **Per-route `preHandler` array** (preferred over plugin `addHook`): Attaching `[gate]` directly in route options avoids scope side-effects on routes in the same plugin. Reference: `historyRoutes` in `packages/api/src/routes/history.ts` for inline bearer verification pattern.
- **Redis INCR rate limit pattern**: `const count = await redis.incr(key); if (count === 1) await redis.expire(key, windowSec); if (count > max) throw ...`. Fire-and-forget `expire` on first increment only. Reference: `packages/api/src/plugins/actorRateLimit.ts:151-155`.
- **Error throw shape**: `throw Object.assign(new Error('...'), { code: 'CODE', statusCode?: N })`. The `errorHandler` maps `code` to status — do NOT pass `statusCode` for standard codes already handled (UNAUTHORIZED/FORBIDDEN/DB_UNAVAILABLE), they map cleanly. For `NOT_PROVISIONED` (new code, 403), the handler addition in B-ERR handles it. For `RATE_LIMIT_EXCEEDED`, existing handler maps it (statusCode 429); the throw in `requireAdminBearer` should include `statusCode: 429` to ensure correct status even if the error handler path is bypassed.
- **Kysely INTERVAL pattern** (avoid SQL injection): Use `sql.lit(...)` for computed string values, NOT template interpolation. Reference: `packages/api/src/routes/analytics.ts:121` `sql<boolean>\`queried_at >= NOW() - INTERVAL ${sql.lit(interval)}\``.
- **safeParse + drop pattern** for JSONB drift: Mirror the approach documented in `packages/shared/src/schemas/history.ts:11-13`. Drop rows where `result.success === false`. Log at `debug` level only (no PII — log only counts, never query text).
- **`request.accountId` augmentation**: Already declared in `packages/api/src/plugins/authBearer.ts:31` as `accountId?: string`. `requireAdminBearer` reads this field — no new augmentation needed. `request.adminVerified` is a new optional boolean — declare via module augmentation in `requireAdminBearer.ts` itself.
- **`NODE_ENV=test` gate bypass**: `rateLimit.ts:107` pattern — `if (config.NODE_ENV === 'test') return`. Add `config?: { NODE_ENV?: string }` to `RequireAdminBearerOptions` for this. Pass `config: cfg` from route registrations in `app.ts`.

**Gotchas:**

- `rateLimit.ts:131` uses `ADMIN_PREFIXES` (the union including `/analytics/`) for the global IP limiter `allowList`. This means analytics routes remain exempt from the global IP limiter — which is correct (bearer requests are already counted under `account:<sub>` via `getRateLimitKeyGenerator`, not the IP bucket). Do NOT remove `/analytics/` from `ADMIN_PREFIXES` — this would break the global limiter's allowList and start IP-bucketing analytics requests.
- `actorResolver.ts` sets `request.accountId` during the `onRequest` phase. `requireAdminBearer` is a `preHandler` which runs AFTER all `onRequest` hooks. Hook order: `onRequest (auth.ts skip) → onRequest (actorResolver sets accountId) → [route matched] → preHandler (requireAdminBearer checks accountId)`. This ordering is correct and guaranteed by Fastify's lifecycle.
- The three existing analytics route plugins (`analyticsRoutes`, `missedQueriesRoutes`, `webMetricsRoutes`) currently receive only `db: Kysely<DB>` or `db + prisma` — they do NOT receive `redis`. Adding `redis` to their options types is a breaking change to the interface; update `app.ts` registrations accordingly.
- `SearchHistoryKind` in Prisma schema is a DB enum with values `text` and `voice` (mapped from `SearchHistoryKindSchema`). Kysely generated type: `SearchHistory.kind: SearchHistoryKind` (Kysely enum type). In the SELECT result, Kysely returns it as a string matching the enum values. No conversion needed — `SearchHistoryKindSchema.parse(row.kind)` will pass.
- `result_jsonb` in Kysely type is `unknown` — safeParse it via `ConversationMessageDataSchema.safeParse(row.result_jsonb)` directly.

---

### Verification commands run

- `grep -n "ADMIN_PREFIXES\|isAdminRoute" packages/api/src/plugins/rateLimit.ts packages/api/src/plugins/auth.ts` → `rateLimit.ts:60` imports `ADMIN_PREFIXES` (not `isAdminRoute`); `auth.ts:37` imports `isAdminRoute`, uses at line 80 → `ADMIN_PREFIXES` must remain in `adminPrefixes.ts` for rateLimit, and the new `isAnalyticsRoute`/`isKeyAdminRoute` helpers are additions, not replacements of the existing export

- `grep -rn "ADMIN_PREFIXES\|isAdminRoute" packages/api/src/ --include="*.ts" | grep -v __tests__` → 4 non-test consumers confirmed: `rateLimit.ts:60,131` (ADMIN_PREFIXES), `auth.ts:37,80` (isAdminRoute), route files use comments only → plan preserves both exports

- `Read: packages/api/src/plugins/auth.ts:80-92` → confirmed single `if (isAdminRoute(...))` block; replacement with two sequential checks (`isAnalyticsRoute` → return; `isKeyAdminRoute` → validateAdminKey) is the correct minimal diff

- `Read: packages/api/src/plugins/actorResolver.ts:73-113` → confirmed `request.accountId` is set during `onRequest` phase after bearer JWT verify → `requireAdminBearer` (preHandler) runs after `accountId` is available; no race condition

- `Read: packages/api/src/lib/accountTier.ts:1-65` → confirmed fail-open design (`rows.length === 0 → 'free'`; DB throws → return `'free'`); new `resolveAccountTierStrict` must NOT use fail-open — must rethrow DB errors and return null on no-row

- `grep -rn "resolveAccountTier" packages/api/src/ --include="*.ts" | grep -v __tests__` → 3 call sites: `actorRateLimit.ts:111`, `auth.ts:435`, `lib/accountTier.ts:22` (definition) → back-compat wrapper required so these callers are unaffected

- `grep -rn "account:tier" packages/api/src/ --include="*.ts"` → cache key `account:tier:<sub>` used in `accountTier.ts:28`, read by tests (2 integration test files use the key directly to seed cache). Round 1 plan-review IMPORTANT-2 eliminated negative caching — cache stores only valid tier strings (`'free'`/`'pro'`/`'admin'`); `null` (no row) returned uncached per round 1 fix.

- `Read: packages/api/src/plugins/rateLimit.ts:125-133` → confirmed `allowList` exempts all `ADMIN_PREFIXES` (including `/analytics/`) from global IP limiter; this exemption is CORRECT to keep — analytics bearer requests use `account:<sub>` bucket via `getRateLimitKeyGenerator`, not IP bucket; removing `/analytics/` from `ADMIN_PREFIXES` would re-route analytics requests to IP bucket (regression)

- `Read: packages/api/src/plugins/actorRateLimit.ts:151-155` → confirmed `redis.incr(key)` + `redis.expire(key, 86400)` on first increment pattern → reuse verbatim in `requireAdminBearer` with 60s window

- `Read: packages/api/prisma/schema.prisma:625-643` → `SearchHistory` model: `id String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid`, `kind SearchHistoryKind`, `query_text Text`, `result_jsonb Json`, `created_at Timestamptz`, `account_id Uuid` (FK) → Kysely type confirmed at generated-types line 250: `id: Generated<string>`, `kind: SearchHistoryKind`, `query_text: string`, `result_jsonb: unknown`, `created_at: Generated<Timestamp>`, `account_id: string` → route SELECT omits `account_id` at query level (privacy)

- `Read: packages/api/src/generated/kysely-types.ts:250-264` → `SearchHistory.result_jsonb: unknown` → safeParse via `ConversationMessageDataSchema.safeParse(row.result_jsonb)` is correct

- `grep -n "ConversationIntentSchema\|ConversationMessageDataSchema" packages/shared/src/schemas/conversation.ts` → confirmed `ConversationIntentSchema` at line 59 (8 values), `ConversationMessageDataSchema` at line 148 with top-level `intent` field → `result_jsonb->>'intent'` SQL filter is valid

- `Read: packages/shared/src/index.ts` → `export * from './schemas/analytics'` at line 23 already present → appending new schemas to `analytics.ts` auto-exports them; no barrel change needed

- `grep -n "UNAUTHORIZED\|FORBIDDEN\|DB_UNAVAILABLE\|RATE_LIMIT_EXCEEDED\|NOT_PROVISIONED" packages/api/src/errors/errorHandler.ts` → `UNAUTHORIZED`/`FORBIDDEN`/`DB_UNAVAILABLE`/`RATE_LIMIT_EXCEEDED` already handled → only `NOT_PROVISIONED` is new and must be added (Step B-ERR)

- `grep -n "app.get\|app.post" packages/api/src/routes/waitlist.ts packages/api/src/routes/quality.ts packages/api/src/routes/embeddings.ts packages/api/src/routes/ingest/url.ts` → confirmed routes for AC4: `GET /admin/waitlist` (waitlist.ts), `GET /quality/report` (quality.ts:31), `POST /embeddings/generate` (embeddings.ts:37), `POST /ingest/url` (ingest/url.ts:79) all exist

- `ls packages/api/src/__tests__/f-web-tier/` → `fWebTier.resolveAccountTier.unit.test.ts` exists — existing tests must stay green after `accountTier.ts` refactor; back-compat wrapper preserves all existing behavior

- `Read: packages/api/src/__tests__/f-web-tier/fWebTier.resolveAccountTier.unit.test.ts:42` → tests import `resolveAccountTier` directly via dynamic import; adding `resolveAccountTierStrict` alongside does not affect import path

- `Read: packages/api/src/app.ts:125-160` → hook registration order: `registerAuthMiddleware` (line 125) before `registerActorResolver` (line 126) confirmed → onRequest phase: auth.ts hook fires first, then actorResolver sets `accountId` → `requireAdminBearer` (preHandler phase) sees `accountId` correctly set

- `ls packages/api/src/routes/` → no `admin/` subdirectory yet → `packages/api/src/routes/admin/historySample.ts` is a new file in a new directory; `mkdir` will be needed (dev can create it)

---

## Implementation Plan — Frontend

### UI/UX Deferred Decisions (resolved here)

**Decision 1 — ResultBody extraction vs admin-only renderer**

Path (a): Extract `<ResultBody>` from `TranscriptEntry.tsx` to its own module `packages/web/src/components/ResultBody.tsx`. Rationale: the function already exists at `TranscriptEntry.tsx:42-240` with the full 8-intent switch. Its props tie it to `TranscriptEntryData` (the full history entry shape), but only `entry.result: ConversationMessageData` is needed for the admin view. The extraction is: (1) move the inner function to its own file, (2) widen its prop to accept `data: ConversationMessageData` directly (dropping the `entry.error` and `entry.isLoading` branches which belong to TranscriptEntry's outer shell), (3) update `TranscriptEntry.tsx` to import and call the extracted component. This is ~20 lines of diff and gives the admin expand-row the exact same visual fidelity as the /hablar view — single source of truth. Path (b) would require re-implementing 8 intent cases and would drift from the /hablar render over time.

**Decision 2 — `webTotalQueries` card position**

Own section row with `col-span-full` preceded by a `mt-6 pt-5 border-t border-slate-100` section separator and subheading "Métricas web". This makes the source distinction (engine vs web session) visually explicit. W33 recommends this as the primary option. Fallback (5th card in the same grid row) is available if the owner prefers visual density over semantic separation, but the separate row is cleaner for the AC27 smoke test (easier to read at a glance).

**Decision 3 — Phone expand-row card-stack**

Defer to operator smoke (AC26). Primary audience is desktop/tablet. The W36 phone spec (`Panel B expand-row: renders as card BELOW collapsed row`) is documented in the design guidelines but requires phone-specific conditional rendering. Scope exclusion for this ticket: the `td colspan` expand-row pattern is used for all breakpoints; if it reads too narrow on phone, a follow-up ticket adds the card-stack variant. This is consistent with the ticket's stated position ("phone is degraded-but-functional; no phone-specific ACs").

---

### Existing Code to Reuse

| Symbol | File | Purpose |
|--------|------|---------|
| `useAuth()` | `packages/web/src/hooks/useAuth.ts:11` | Provides `{ user, account, loading }` for AdminGuard tier check |
| `AuthContextValue` | `packages/web/src/components/AuthProvider.tsx:28` | Type for `{ user, account, loading }` — `account.tier` field confirmed at line 32 |
| `setAuthToken` / `authToken` (module singleton) | `packages/web/src/lib/apiClient.ts:41` | Bearer token already plumbed via module-level singleton; admin API calls use the same singleton — no new auth mechanism needed |
| `ApiError` class | `packages/web/src/lib/apiClient.ts:49` | Typed error with `.code`, `.status`; parse `error.code` to surface `NOT_PROVISIONED` vs `FORBIDDEN` |
| `getMe` pattern | `packages/web/src/lib/apiClient.ts:433` | Template for bearer-authenticated GET wrappers (parse JSON → safeParse schema → return envelope) |
| `trackEvent` | `packages/web/src/lib/metrics.ts:160` | Extend `MetricEvent` union; admin events are payload-only (no counter mutation) |
| `MetricEvent` / `MetricPayload` | `packages/web/src/lib/metrics.ts:13,49` | Add admin event names + payload fields to existing union/interface |
| `shimmer-element` CSS class | `packages/web/src/styles/globals.css:81` | `@keyframes shimmer` + `.shimmer-element` defined globally — use for table skeleton rows |
| `MissedQueryItem` / `MissedQueriesResponse` types | `packages/shared/src/schemas/missedQueries.ts:38,52` | Response shape for Panel A; `trackingId: string \| null`, `trackingStatus: MissedQueryStatus \| null` |
| `BatchTrackBody` | `packages/shared/src/schemas/missedQueries.ts:104` | Body shape for `POST /analytics/missed-queries/track`; field names: `queries: [{ queryText, hitCount }]` |
| `MissedQueryTracking` | `packages/shared/src/schemas/missedQueries.ts:78` | Response from POST /track — contains `id` to capture for subsequent status calls |
| `AnalyticsData` / `AnalyticsResponse` types | `packages/shared/src/schemas/analytics.ts:87,97` | Response shape for Panel C queries section; `byLevel`, `bySource`, `topQueries`, `totalQueries`, `cacheHitRate`, `avgResponseTimeMs` all present |
| `AnalyticsTimeRange` | `packages/shared/src/schemas/analytics.ts:13` | `'24h' \| '7d' \| '30d' \| 'all'` — use for Panel A + C `timeRange` filter state |
| `WebMetricsAggregate` | `packages/shared/src/schemas/webMetrics.ts:84` | Response shape for Panel C web-events section; `totalQueries` + `topIntents` fields confirmed |
| `HistorySampleResponse` / `SearchHistorySampleEntry` | `packages/shared/src/schemas/analytics.ts` (added by B6) | Response shape for Panel B — depends on backend Step B6 completing first |
| `ConversationIntent` | `packages/shared/src/schemas/conversation.ts:59` | 8-value enum for Panel B intent filter dropdown |
| `NutritionCard` | `packages/web/src/components/NutritionCard.tsx` | Rendered inside extracted `ResultBody` for estimation/comparison/etc — no change needed |
| `ContextConfirmation` | `packages/web/src/components/ContextConfirmation.tsx` | Rendered inside `ResultBody` for `context_set` intent — no change needed |
| `MenuDishList` | `packages/web/src/components/MenuDishList.tsx` | Rendered inside `ResultBody` for `menu_estimation` intent — no change needed |
| `useRouter` | `next/navigation` | `router.replace()` for anon redirect in AdminGuard (pattern confirmed in `LoginCta.tsx:17`) |
| `usePathname` | `next/navigation` | Capture current path for `?redirectTo=` in AdminGuard |
| Brand tokens | `tailwind.config.ts:13,19` + `globals.css:10-17` | `brand-green`, `brand-orange`, `mist` all confirmed in config; use `bg-mist`, `text-brand-green` as-is |

---

### Files to Create

| File | Purpose |
|------|---------|
| `packages/web/src/lib/i18n/locale.ts` | `LOCALE = 'es' as const` + `SupportedLocale` type |
| `packages/web/src/lib/i18n/messages/es/admin.json` | Full W34 key tree verbatim — all admin Spanish strings |
| `packages/web/src/lib/i18n/useT.ts` | `useT(namespace)` hook — dot-key resolver + fallback to key + NO built-in interpolation (caller uses `.replace('{x}', val)` per W34 note) |
| `packages/web/src/app/admin/layout.tsx` | Server Component shell with metadata (`noindex`) + `<AdminGuard>` + `<AdminLayout>` co-located |
| `packages/web/src/app/admin/analytics/page.tsx` | Server Component page — renders 3 panels stacked |
| `packages/web/src/components/admin/AdminGuard.tsx` | `'use client'` — auth/tier gate; 4 branches per W27/W35 |
| `packages/web/src/components/admin/AdminLayout.tsx` | `'use client'` — sidebar (desktop) + topbar (tablet/phone) per W27/W36 |
| `packages/web/src/components/admin/MissedQueriesPanel.tsx` | `'use client'` — Panel A: filter, table, per-row actions, optimistic updates |
| `packages/web/src/components/admin/ResponseReviewPanel.tsx` | `'use client'` — Panel B: filter, table, expand-row with ResultBody |
| `packages/web/src/components/admin/OverviewPanel.tsx` | `'use client'` — Panel C: parallel fetches, scalar cards, distributions |
| `packages/web/src/components/ResultBody.tsx` | Extracted from `TranscriptEntry.tsx`; prop: `{ data: ConversationMessageData }` |
| `packages/web/src/__tests__/lib/useT.test.ts` | (alias — same as above; place in `__tests__/lib/` to match existing pattern) |
| `packages/web/src/__tests__/components/AdminGuard.test.tsx` | 5 test cases for all guard branches |
| `packages/web/src/__tests__/components/AdminLayout.test.tsx` | 3 tests: sidebar nav, active link, tablet topbar |
| `packages/web/src/__tests__/components/MissedQueriesPanel.test.tsx` | ~10 tests: fetch, filters, optimistic actions, error/empty |
| `packages/web/src/__tests__/components/ResponseReviewPanel.test.tsx` | ~8 tests: fetch, filters, expand-row, NOT_PROVISIONED |
| `packages/web/src/__tests__/components/OverviewPanel.test.tsx` | ~6 tests: parallel fetch, independent errors, filter |
| `packages/web/src/__tests__/components/ResultBody.test.tsx` | ~4 tests: one per intent group + graceful null guard |
| `packages/web/src/__tests__/lib/apiClient.admin.test.ts` | ~6 tests for new admin API wrappers |
| `packages/web/src/__tests__/admin-analytics-route.integration.test.tsx` | ~3 tests: admin-tier mounts, non-admin 403, anon redirect |

---

### Files to Modify

| File | Change |
|------|--------|
| `packages/web/src/components/TranscriptEntry.tsx` | Remove internal `ResultBody` function; import `ResultBody` from `'@/components/ResultBody'` instead; all 8 intent cases + null guard move to `ResultBody.tsx`. The outer `TranscriptEntry` shell (entry.error / entry.isLoading / photo branches) stays in `TranscriptEntry.tsx`. |
| `packages/web/src/components/AuthProvider.tsx` | **NEW per /review-plan round 1 IMPORTANT-3 + round 2 SUG:** Extend `AuthContextValue` with `accountErrorCode: 'NOT_PROVISIONED' \| 'NETWORK_ERROR' \| null` field. In the existing `getMe().catch(err)` block (line ~78), set the code based on `err.code` (`NOT_PROVISIONED` if API returned that code, else `NETWORK_ERROR`). Default state `null`. Re-exported via `useAuth()` so `AdminGuard` can destructure it for the 3a/3b branch distinction. |
| `packages/web/src/hooks/useAuth.ts` | Re-export the extended `AuthContextValue` shape (no logic change — type-level only). |
| `packages/web/src/lib/apiClient.ts` | Add 6 new admin API wrappers: `getMissedQueries`, `trackMissedQueries`, `updateMissedQueryStatus`, `getQueriesAnalytics`, `getWebMetricsAnalytics`, `getHistorySample`. Each follows the `getMe`/`getUsage`/`getHistory` pattern: `authToken` guard → fetch with `Authorization: Bearer ${authToken}` → JSON parse → schema safeParse → return data. Parse `error.code` from non-2xx body to surface `NOT_PROVISIONED` / `FORBIDDEN` to callers via `ApiError`. |
| `packages/web/src/lib/metrics.ts` | Add admin `MetricEvent` values to the union: `'admin_panel_loaded'`, `'admin_tracking_action'`, `'admin_history_expand'`, `'admin_403_shown'`. Add payload fields to `MetricPayload`: `panel?: 'missed-queries' \| 'response-review' \| 'overview'`, `action?: 'investigating' \| 'resolved' \| 'ignored'`, `code403?: 'NOT_PROVISIONED' \| 'FORBIDDEN' \| 'VERIFY_FAILED'`. Add `case` branches in `trackEvent` switch — admin events do NOT increment `queryCount`/`successCount` (payload-only). |

---

### Implementation Order

**Phase F-A — i18n infrastructure (no dependencies)**

1. **F1 — `packages/web/src/lib/i18n/locale.ts`**

   ```typescript
   export const LOCALE = 'es' as const;
   export type SupportedLocale = typeof LOCALE;
   ```

2. **F2 — `packages/web/src/lib/i18n/messages/es/admin.json`**

   Paste the verbatim W34 JSON key tree. Namespace structure: `admin.layout.*`, `admin.common.*`, `admin.intent.*`, `admin.panel.missedQueries.*`, `admin.panel.responseReview.*`, `admin.panel.overview.*`. The file is a static module-level import — no async loading.

3. **F3 — `packages/web/src/lib/i18n/useT.ts`** (depends on F1, F2)

   ```typescript
   'use client';

   import adminMessages from './messages/es/admin.json';

   const NAMESPACES: Record<string, Record<string, unknown>> = {
     admin: adminMessages as Record<string, unknown>,
   };

   export function useT(namespace: string): (key: string) => string {
     const messages = NAMESPACES[namespace] ?? {};
     return function t(key: string): string {
       const parts = key.split('.');
       let current: unknown = messages;
       for (const part of parts) {
         if (typeof current !== 'object' || current === null) return key;
         current = (current as Record<string, unknown>)[part];
       }
       return typeof current === 'string' ? current : key;
     };
   }
   ```

   Key contract: returns the key string itself (never throws) when a key is missing or the resolved value is not a string. Interpolation is caller responsibility (`.replace('{count}', val)`).

   **RED tests — `packages/web/src/__tests__/lib/useT.test.ts`:**
   - `useT('admin')('layout.loading')` → `'Verificando acceso...'` (top-level namespace key)
   - `useT('admin')('panel.missedQueries.title')` → `'Búsquedas sin respuesta'` (deep nested key)
   - `useT('admin')('nonexistent.key')` → `'nonexistent.key'` (fallback to key string)
   - `useT('admin')('layout.403.forbidden.title')` → `'Acceso denegado'` (3-level nested key)
   - `useT('unknown-namespace')('any.key')` → `'any.key'` (unknown namespace fallback)
   - `useT('admin')('intent.estimation')` → `'Estimación'` (flat-within-namespace key)

**Phase F-B — ResultBody extraction (no dependencies except existing TranscriptEntry)**

4. **F4 — `packages/web/src/components/ResultBody.tsx`** (extracted from TranscriptEntry.tsx)

   ```typescript
   'use client';

   import type { ConversationMessageData } from '@foodxplorer/shared';
   import { NutritionCard } from './NutritionCard';
   import { ContextConfirmation } from './ContextConfirmation';
   import { MenuDishList } from './MenuDishList';

   export interface ResultBodyProps {
     data: ConversationMessageData;
     onDishSelect?: (dishName: string) => void;
   }

   export function ResultBody({ data, onDishSelect }: ResultBodyProps): React.ReactElement | null {
     switch (data.intent) {
       case 'estimation': { ... }
       case 'comparison': { ... }
       case 'menu_estimation': { ... }
       case 'context_set': { ... }
       case 'reverse_search': { ... }
       case 'follow_up_attribute': { ... }
       case 'follow_up_refinement': { ... }
       case 'text_too_long': { ... }
       default: return null;
     }
   }
   ```

   Note on `text_too_long`: the existing `TranscriptEntry.tsx` switch falls through to `default: return null` for `text_too_long`. Preserve this behavior. Do NOT fabricate a UI for `text_too_long` — add an explicit `case 'text_too_long': return null` for clarity.

   The outer `TranscriptEntry.tsx` `ResultBody` function currently also handles `entry.error`, `entry.isLoading`, and `entry.photoData` branches. These are NOT moved to `ResultBody.tsx` — they belong to the `TranscriptEntry` shell and stay in that file. Only the `entry.result` (ConversationMessageData) switch block moves.

   Update `TranscriptEntry.tsx`: remove the inner `ResultBody` function definition; import `{ ResultBody }` from `'@/components/ResultBody'`; call it as `<ResultBody data={results} onDishSelect={onDishSelect} />` (where `results = entry.result`).

   **RED tests — `packages/web/src/__tests__/components/ResultBody.test.tsx`:**
   - Renders without crash for each of 8 `ConversationIntent` values (mocked data fixtures per intent)
   - Returns null for `text_too_long` and unknown intents (graceful default)
   - `estimation` intent renders a `NutritionCard`
   - `comparison` intent renders two `NutritionCard` components
   - Existing `TranscriptEntry` tests must pass unchanged after refactor (no regression gate needed as a separate step — the existing test suite covers it)

**Phase F-C — apiClient admin wrappers (depends on F-A to import shared types; depends on B6 for HistorySample types)**

5. **F5 — `packages/web/src/lib/apiClient.ts`** — add 6 admin wrappers

   Each wrapper follows the existing `getMe`/`getUsage` pattern verbatim:
   1. Guard `authToken` (throw `ApiError('UNAUTHORIZED', 401)` if null)
   2. `fetch(${baseUrl}/analytics/..., { headers: { Authorization: \`Bearer ${authToken}\` } })`
   3. Parse JSON → throw `ApiError` on parse failure
   4. On non-2xx: extract `error.code` from body → `throw new ApiError(message, code, status)` — callers test `err.code === 'NOT_PROVISIONED'`
   5. Schema safeParse the `data` field → throw `ApiError('MALFORMED_RESPONSE')` on failure

   Signatures:

   ```typescript
   // Panel A
   export async function getMissedQueries(
     params: MissedQueriesParams
   ): Promise<MissedQueriesResponse['data']>

   export async function trackMissedQueries(
     queries: BatchTrackBody['queries']
   ): Promise<MissedQueryTracking[]>  // returns array of created tracking entries

   export async function updateMissedQueryStatus(
     id: string,
     body: UpdateMissedQueryStatusBody
   ): Promise<MissedQueryTracking>

   // Panel B
   export async function getHistorySample(
     params: HistorySampleParams
   ): Promise<HistorySampleData>  // HistorySampleData from B6 schema

   // Panel C
   export async function getQueriesAnalytics(
     params: AnalyticsQueryParams
   ): Promise<AnalyticsData>

   export async function getWebMetricsAnalytics(
     params: WebMetricsQueryParams
   ): Promise<WebMetricsAggregate>
   ```

   Import types from `@foodxplorer/shared`. The `trackMissedQueries` POST response body shape: the existing `POST /analytics/missed-queries/track` returns an array of created tracking entries (verify schema `BatchTrackBodySchema` in `missedQueries.ts:104` — response type is `MissedQueryTracking[]` based on the route's upsert-many behavior).

   **RED tests — `packages/web/src/__tests__/lib/apiClient.admin.test.ts`:**
   - `getMissedQueries` with default params → calls correct URL with bearer header
   - `getMissedQueries` with non-2xx and `code: 'NOT_PROVISIONED'` → throws `ApiError` with `.code === 'NOT_PROVISIONED'`
   - `trackMissedQueries` → POST with correct body shape `{ queries: [...] }`
   - `updateMissedQueryStatus` → POST to `/:id/status` with `{ status }`
   - `getHistorySample` with `intent` param → URL includes `?intent=estimation`
   - `getQueriesAnalytics` → calls `/analytics/queries` with bearer

**Phase F-D — metrics.ts extension (no dependencies)**

6. **F6 — `packages/web/src/lib/metrics.ts`** — extend

   Add to `MetricEvent` union:
   ```typescript
   | 'admin_panel_loaded'
   | 'admin_tracking_action'
   | 'admin_history_expand'
   | 'admin_403_shown'
   ```

   Add to `MetricPayload` interface:
   ```typescript
   panel?: 'missed-queries' | 'response-review' | 'overview';
   action?: 'investigating' | 'resolved' | 'ignored';
   code403?: 'NOT_PROVISIONED' | 'FORBIDDEN' | 'VERIFY_FAILED';
   ```

   Add `case` branches in `trackEvent` switch for each admin event — these are pure payload events (no `state.queryCount++` or `state.successCount++` — admin UI actions must not add to user query metrics).

**Phase F-E — Admin route shell + guard (depends on F-A for useT, F-B not required)**

7. **F7 — `packages/web/src/components/admin/AdminGuard.tsx`** (Client Component)

   ```typescript
   'use client';

   import { useAuth } from '@/hooks/useAuth';
   import { useRouter, usePathname } from 'next/navigation';
   import { useT } from '@/lib/i18n/useT';
   import { trackEvent } from '@/lib/metrics';

   export function AdminGuard({ children }: { children: React.ReactNode }) {
     const { user, account, loading } = useAuth();
     const router = useRouter();
     const pathname = usePathname();
     const t = useT('admin');

     // Branch 1: Auth checking
     if (loading) {
       return <LoadingPage t={t} />;
     }

     // Branch 2: Not authenticated
     if (!user) {
       router.replace('/login?redirectTo=' + encodeURIComponent(pathname ?? '/admin/analytics'));
       return null;
     }

     // Branch 3a: account null + code = NOT_PROVISIONED (per /review-plan round 1
     // IMPORTANT — Codex): bearer is valid but no accounts row yet. Render amber
     // recoverable variant with hint to call /me (web auto-handles via
     // AuthProvider.SIGNED_IN → getMe, so this branch normally never fires;
     // surfaces if /me itself returns NOT_PROVISIONED before any analytics call).
     if (!account && accountErrorCode === 'NOT_PROVISIONED') {
       trackEvent('admin_403_shown', { code403: 'NOT_PROVISIONED' });
       return <ForbiddenPage variant="notProvisioned" t={t} onAction={() => router.refresh()} />;
     }

     // Branch 3b: account null + network/other error → slate verifyFailed
     if (!account) {
       trackEvent('admin_403_shown', { code403: 'VERIFY_FAILED' });
       return <ForbiddenPage variant="verifyFailed" t={t} onAction={() => router.refresh()} />;
     }

     // Branch 4: authenticated but not admin
     if (account.tier !== 'admin') {
       trackEvent('admin_403_shown', { code403: 'FORBIDDEN' });
       return <ForbiddenPage variant="forbidden" t={t} onAction={() => router.back()} />;
     }

     // Branch 5: admin — render layout + children
     return <AdminLayout>{children}</AdminLayout>;
   }
   ```

   **Prerequisite — AuthProvider extension (NEW Step F4b, blocks F5):**

   Per `/review-plan` round 1 IMPORTANT (Codex), `AuthProvider.tsx` currently swallows `getMe()` failures and only sets `account = null`, losing the error code distinction. Extend `AuthContextValue`:

   ```typescript
   // packages/web/src/components/AuthProvider.tsx
   export interface AuthContextValue {
     user: User | null;
     account: Account | null;
     loading: boolean;
     accountErrorCode: 'NOT_PROVISIONED' | 'NETWORK_ERROR' | null;  // NEW
   }

   // In the getMe().catch(err) block:
   //   if (err.code === 'NOT_PROVISIONED') setAccountErrorCode('NOT_PROVISIONED');
   //   else                                setAccountErrorCode('NETWORK_ERROR');
   //   setAccount(null);
   ```

   `useAuth()` re-exports the new field. AdminGuard consumes it via destructuring: `const { user, account, loading, accountErrorCode } = useAuth();`

   **RED tests:** `AuthProvider.accountErrorCode.test.tsx` — mock `getMe` to throw with code 'NOT_PROVISIONED' / 'NETWORK_ERROR' / generic Error; assert context exposes the right code.

   `LoadingPage` (co-located sub-component): `fixed inset-0 bg-white flex items-center justify-center` per W27. Spinner: `w-8 h-8 rounded-full border-2 border-slate-200 border-t-brand-green animate-spin`. Text below: `text-sm text-slate-400 mt-3` with `t('layout.loading')`.

   `ForbiddenPage` (co-located sub-component): variant `'notProvisioned' | 'verifyFailed' | 'forbidden'` → renders W35 card. Card borders per W35: `border-amber-200` (notProvisioned recoverable), `border-slate-200` (verifyFailed transient network error), `border-red-200` (forbidden permission denied). Uses `t('layout.403.notProvisioned.*')` | `t('layout.403.verifyFailed.*')` | `t('layout.403.forbidden.*')` respectively. CTA per variant: notProvisioned → `router.refresh()` after calling `/me`; verifyFailed → `router.refresh()` retry; forbidden → `router.back()` (no retry possible).

   **NOT_PROVISIONED distinction (resolved per /review-plan round 1 IMPORTANT — Codex):** The W35 spec distinguishes `NOT_PROVISIONED` (account row missing — amber, recoverable) from `verifyFailed` (network/server error — slate, transient). The plan now extends `AuthContextValue` with `accountErrorCode: 'NOT_PROVISIONED' | 'NETWORK_ERROR' | null` set inside the `getMe().catch()` path in AuthProvider (Step F4b above). AdminGuard branches on the code to render the correct variant. All 3 W35 403 treatments are reachable end-to-end.

   **RED tests — `packages/web/src/__tests__/components/AdminGuard.test.tsx`:**
   - Mock `useAuth` → `{ loading: true }` → renders spinner with "Verificando acceso..."
   - Mock `useAuth` → `{ loading: false, user: null, account: null }` → calls `router.replace` with correct redirectTo
   - Mock `useAuth` → `{ loading: false, user: mockUser, account: null }` → renders amber 403 card (verifyFailed copy)
   - Mock `useAuth` → `{ loading: false, user: mockUser, account: { tier: 'free' } }` → renders red 403 card (forbidden copy)
   - Mock `useAuth` → `{ loading: false, user: mockUser, account: { tier: 'admin' } }` → renders children (dashboard)

8. **F8 — `packages/web/src/components/admin/AdminLayout.tsx`** (Client Component)

   ```typescript
   'use client';

   import Link from 'next/link';
   import { usePathname } from 'next/navigation';
   import { useT } from '@/lib/i18n/useT';

   export function AdminLayout({ children }: { children: React.ReactNode }) {
     const pathname = usePathname();
     const t = useT('admin');
     const isAnalyticsActive = pathname?.startsWith('/admin/analytics') ?? false;

     return (
       <div className="flex h-[100dvh]">
         {/* Sidebar — desktop only (hidden on <lg) */}
         <aside className="hidden lg:flex lg:flex-col w-56 flex-shrink-0 bg-white border-r border-slate-100">
           <div className="px-3 pb-5 pt-6 border-b border-slate-100">
             <span className="text-sm font-semibold text-slate-500 tracking-wide uppercase">
               {t('layout.brandName')} {t('layout.adminSuffix')}
             </span>
           </div>
           <nav className="pt-3 px-3" aria-label="Admin navigation">
             <Link
               href="/admin/analytics"
               className={isAnalyticsActive
                 ? 'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold bg-mist text-brand-green'
                 : 'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-800 transition-colors duration-150'
               }
               aria-current={isAnalyticsActive ? 'page' : undefined}
             >
               {/* 18px chart-bar SVG icon */}
               {t('layout.navAnalytics')}
             </Link>
           </nav>
         </aside>

         {/* Main content area */}
         <div className="flex-1 flex flex-col overflow-hidden">
           {/* TopBar — tablet and phone only (<lg) */}
           <header className="lg:hidden h-10 bg-white border-b border-slate-100 flex items-center justify-between px-4 flex-shrink-0">
             <span className="text-sm font-semibold text-slate-500">
               {t('layout.brandName')} {t('layout.adminSuffix')}
             </span>
             <span className="text-sm text-slate-600">{t('layout.navAnalytics')}</span>
           </header>
           <main className="flex-1 overflow-y-auto bg-slate-50">
             <div className="max-w-7xl mx-auto px-6 py-8 lg:px-6 md:px-4 md:py-6 px-3 py-4">
               {children}
             </div>
           </main>
         </div>
       </div>
     );
   }
   ```

   **RED tests — `packages/web/src/__tests__/components/AdminLayout.test.tsx`:**
   - Renders sidebar with "nutriXplorer admin" wordmark on desktop (mock viewport or check element exists)
   - Analytics nav link has `aria-current="page"` when pathname is `/admin/analytics`
   - TopBar renders the wordmark (for tablet/phone visibility)

9. **F9 — `packages/web/src/app/admin/layout.tsx`** (Server Component shell)

   ```typescript
   import type { Metadata } from 'next';
   import { AdminGuard } from '@/components/admin/AdminGuard';

   export const metadata: Metadata = {
     title: 'Admin · nutriXplorer',
     robots: { index: false, follow: false },
   };

   export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
     return <AdminGuard>{children}</AdminGuard>;
   }
   ```

   Server Component — no `'use client'` directive. Delegates all auth logic to `AdminGuard` (client). Metadata includes `robots: noindex` so admin pages are not indexed.

**Phase F-F — Panel A: MissedQueriesPanel (depends on F5, F6, F3)**

10. **F10 — `packages/web/src/components/admin/MissedQueriesPanel.tsx`** (Client Component)

    State shape:
    ```typescript
    interface RowUpdate {
      status: MissedQueryStatus | null;
      trackingId: string | null;
      isUpdating: boolean;
      error: string | null;
    }

    // rowUpdates keyed by queryText (stable key — untracked rows have no ID)
    const [rowUpdates, setRowUpdates] = useState<Map<string, RowUpdate>>(new Map());
    const [timeRange, setTimeRange] = useState<AnalyticsTimeRange>('7d');
    const [topN, setTopN] = useState(20);
    const [topNInput, setTopNInput] = useState('20');  // controlled input string
    const [minCount, setMinCount] = useState(1);
    const [minCountInput, setMinCountInput] = useState('1');
    const [data, setData] = useState<MissedQueriesResponse['data'] | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    ```

    Key implementation notes:
    - **Filter controls:** TimeRange — segmented button group (`role="group" aria-label="Período de tiempo"`, each button `aria-pressed`). Fires fetch on click. TopN / minCount — numeric `<input type="number">` with `onBlur` validation + re-fetch. During fetch: `opacity-50 pointer-events-none` on all filter controls.
    - **Table:** sticky `thead` per W30. queryText truncated at 80 chars with `title={row.queryText}` attribute.
    - **Row key:** `row.queryText` (stable; queryText is unique in the missed queries result set by definition — it groups by query term).
    - **Effective status:** resolve from `rowUpdates.get(row.queryText)?.status ?? row.trackingStatus` for display; same for `trackingId`: `rowUpdates.get(row.queryText)?.trackingId ?? row.trackingId`.
    - **Action handler:** `handleAction(row, nextStatus: MissedQueryStatus)`:
      1. Get effective `trackingId`.
      2. Optimistic update: `setRowUpdates` with `isUpdating: true`, `status: nextStatus`.
      3. If `trackingId === null`: call `trackMissedQueries([{ queryText: row.queryText, hitCount: row.count }])` → capture returned `id` → `setRowUpdates` updating `trackingId = id`.
      4. Call `updateMissedQueryStatus(effectiveId, { status: nextStatus })`.
      5. On success: `setRowUpdates` with `isUpdating: false`, clear error.
      6. On error: revert status to prior value; set `error` in rowUpdate. The "revert" must restore the last known status before the optimistic update (capture prior value before step 2).
    - **Row error display:** insert a `<tr><td colSpan={4}>` error row immediately below the affected row with the error message per W31.
    - **Loading skeleton:** 5 `<tr>` rows with `shimmer-element` cells per W30 spec.
    - **Empty state:** replace entire `<tbody>` with centered W30 empty state block (magnifier SVG + text).
    - **Error state:** banner per W30 with retry button that re-fires the fetch.
    - **trackEvent:** `trackEvent('admin_panel_loaded', { panel: 'missed-queries' })` on mount (after first successful fetch). `trackEvent('admin_tracking_action', { action: nextStatus === 'pending' ? 'investigating' : nextStatus })` on each action.

    **RED tests — `packages/web/src/__tests__/components/MissedQueriesPanel.test.tsx`:**
    - On mount fires `getMissedQueries` with default params `{ timeRange: '7d', topN: 20, minCount: 1 }`
    - Renders table rows with queryText (truncated), count, and badge on success
    - Changing timeRange segment fires re-fetch with new `timeRange`
    - TopN input blur with valid value fires re-fetch with new `topN`
    - "Investigando" on untracked row → calls `trackMissedQueries` then renders `pending` badge
    - "Investigando" on tracked row → calls `updateMissedQueryStatus(id, { status: 'pending' })`
    - "Resuelto" on untracked row → two-step: calls `trackMissedQueries` then `updateMissedQueryStatus`
    - API error on action → badge reverts to prior status + error message row appears
    - Empty `missedQueries: []` → empty state text rendered, no table rows
    - Error on initial fetch → error banner with retry button

**Phase F-G — Panel B: ResponseReviewPanel (depends on F4 ResultBody, F5, F3)**

11. **F11 — `packages/web/src/components/admin/ResponseReviewPanel.tsx`** (Client Component)

    State shape:
    ```typescript
    const [intent, setIntent] = useState<ConversationIntent | undefined>(undefined);
    const [hours, setHours] = useState(24);
    const [hoursInput, setHoursInput] = useState('24');
    const [limit, setLimit] = useState(20);
    const [limitInput, setLimitInput] = useState('20');
    const [data, setData] = useState<HistorySampleData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    ```

    Key implementation notes:
    - **Intent dropdown:** native `<select>` per W29 with `appearance-none` + custom chevron SVG. Options: "Todos" (value `''`) + 8 intent labels from `t('intent.*')`. On change: set intent (undefined if value `''`), re-fetch immediately.
    - **Hours / limit inputs:** fetch on blur after validation. Hours: min 1, max 720 (inline error: `t('panel.responseReview.filterHoursValidation')`). Limit: min 1, max 100.
    - **Summary row:** above the table, rendered as `t('panel.responseReview.summary').replace('{count}', String(data.items.length)).replace('{hours}', String(hours))` per W34 note.
    - **Expand-row animation:** CSS grid trick per W32 — `<tr>` with `<td colSpan={5}>` containing a `div` with `grid grid-rows-[0fr] overflow-hidden transition-[grid-template-rows] duration-250 ease-out` when collapsed, `grid-rows-[1fr]` when expanded. Inner div `min-h-0`.
    - **Expanded content:** `py-4 px-6 bg-slate-50/60 border-l-2 border-brand-green/30 ml-2` per W32. Intent badge header + `<ResultBody data={row.resultData} />`. Raw JSON toggle: hidden by default, click shows `<pre>` block.
    - **Row click:** clicking anywhere on `<tr>` toggles expand for that row's ID.
    - **Drift rows:** `HistorySampleResponse.data.items` are already validated by the backend (drifted rows dropped server-side). No additional safeParse needed client-side. If somehow `row.resultData` is malformed (edge case), `<ResultBody>` returns null gracefully.
    - **NOT_PROVISIONED error:** if `getMissedQueries` or `getHistorySample` throws `ApiError` with `code === 'NOT_PROVISIONED'`, show the amber W35 card inline WITHIN the panel body (not via AdminGuard — AdminGuard only handles this for initial load, but panels fetch after AdminGuard passes). Use a local `notProvisioned` state flag.
    - **trackEvent:** `admin_panel_loaded` + `admin_history_expand` on row expand toggle.

    **RED tests — `packages/web/src/__tests__/components/ResponseReviewPanel.test.tsx`:**
    - On mount fires `getHistorySample` with `{ hours: 24, limit: 20 }` (no intent param)
    - Selecting intent "Estimación" fires re-fetch with `{ intent: 'estimation', hours: 24, limit: 20 }`
    - Selecting "Todos" fires re-fetch without `intent` param
    - Hours input blur with `48` fires re-fetch with `{ hours: 48 }`
    - Clicking expand icon toggles row expansion (aria/class changes)
    - Expanded row renders `ResultBody` (present in DOM)
    - Empty state when `items: []`
    - Error state when fetch throws — error banner with retry button
    - `NOT_PROVISIONED` ApiError → amber 403 inline panel (not full-page)

**Phase F-H — Panel C: OverviewPanel (depends on F5, F3)**

12. **F12 — `packages/web/src/components/admin/OverviewPanel.tsx`** (Client Component)

    State shape:
    ```typescript
    const [timeRange, setTimeRange] = useState<AnalyticsTimeRange>('7d');
    const [queriesData, setQueriesData] = useState<AnalyticsData | null>(null);
    const [webEventsData, setWebEventsData] = useState<WebMetricsAggregate | null>(null);
    const [isLoadingQueries, setIsLoadingQueries] = useState(true);
    const [isLoadingWebEvents, setIsLoadingWebEvents] = useState(true);
    const [queriesError, setQueriesError] = useState<string | null>(null);
    const [webEventsError, setWebEventsError] = useState<string | null>(null);
    ```

    Key implementation notes:
    - **Parallel fetches:** `Promise.allSettled` (NOT `Promise.all`) on `[getQueriesAnalytics({ timeRange }), getWebMetricsAnalytics({ timeRange })]`. Process both settled results independently — one failure does not block the other.
    - **missRate computation:** `queriesData.byLevel.miss / queriesData.totalQueries * 100` formatted as `X.X%`. Guard against division by zero (`totalQueries === 0 → 0%`).
    - **cacheHitRate:** `queriesData.cacheHitRate * 100` (field is already `0–1` per schema).
    - **Scalar cards grid:** `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4`. Each card `bg-white rounded-2xl border border-slate-100 p-5`. Big number `text-[32px] font-extrabold leading-none text-slate-800`.
    - **webTotalQueries section:** separate from main 4-card grid; `mt-6 pt-5 border-t border-slate-100` separator + subheading `text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3` labelled `t('panel.overview.sections.web')`. Card: `border-brand-green/20 bg-mist/30`. Number: `text-brand-green`.
    - **byLevel bars:** pure CSS, no chart lib. Each level row: flex, label `w-8`, bar track `flex-1 bg-slate-100 rounded-full h-2`, fill `h-2 rounded-full transition-all duration-500` with inline `style={{ width: pct + '%' }}`. Colors per W33.
    - **bySource:** flex icon pairs per W33. Code-bracket SVG for api, chat-bubble SVG for bot.
    - **topQueries / topIntents mini-tables:** `grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6`. Each row `flex items-center justify-between py-2 border-b border-slate-50 last:border-0`.
    - **Independent error states:** if `queriesError` is set, show error banner in place of scalar cards + distributions (webTotalQueries card still renders from `webEventsData`). If `webEventsError` is set, webTotalQueries card shows inline error + topIntents shows error banner.
    - **trackEvent:** `admin_panel_loaded` with `{ panel: 'overview' }` on mount after first successful fetch of either source.

    **RED tests — `packages/web/src/__tests__/components/OverviewPanel.test.tsx`:**
    - On mount fires both `getQueriesAnalytics` and `getWebMetricsAnalytics` with `{ timeRange: '7d' }`
    - Scalar cards render `totalQueries`, `cacheHitRate` (formatted %), `missRate` (computed)
    - webTotalQueries card renders from web-events data (green-tinted)
    - `getQueriesAnalytics` failure → error banner for engine section; webTotalQueries still renders
    - `getWebMetricsAnalytics` failure → webTotalQueries shows inline error; engine scalars still render
    - timeRange segment change fires both fetches with new `timeRange`

**Phase F-I — Admin analytics page (depends on F10, F11, F12)**

13. **F13 — `packages/web/src/app/admin/analytics/page.tsx`** (Server Component)

    ```typescript
    import type { Metadata } from 'next';
    import { MissedQueriesPanel } from '@/components/admin/MissedQueriesPanel';
    import { ResponseReviewPanel } from '@/components/admin/ResponseReviewPanel';
    import { OverviewPanel } from '@/components/admin/OverviewPanel';

    export const metadata: Metadata = {
      title: 'Analytics · Admin · nutriXplorer',
    };

    export default function AdminAnalyticsPage() {
      return (
        <div className="space-y-8">
          <MissedQueriesPanel />
          <ResponseReviewPanel />
          <OverviewPanel />
        </div>
      );
    }
    ```

    Server Component — no `'use client'`. Each panel is a Client Component that manages its own state and fetching. No Suspense boundary needed here (panels render their own loading states). The `space-y-8` provides the `mb-8` gap between panel cards per W28.

**Phase F-J — Integration test (depends on F7, F8, F9, F13)**

14. **F14 — `packages/web/src/__tests__/admin-analytics-route.integration.test.tsx`**

    Uses React Testing Library to render the admin analytics route. Mock `useAuth` at module level.

    **RED tests:**
    - Admin tier mocked → AdminGuard passes → all 3 panel headings visible in DOM (after fetch mocks resolve)
    - Non-admin tier mocked → 403 page rendered → "Acceso denegado" heading present, panels NOT in DOM
    - Null user mocked → `router.replace` called with `/login?redirectTo=%2Fadmin%2Fanalytics`

---

### Testing Strategy

**Test files to create:**

| File | Type | Count (est.) |
|------|------|-------------|
| `packages/web/src/__tests__/lib/useT.test.ts` | Unit | ~6 |
| `packages/web/src/__tests__/components/ResultBody.test.tsx` | Unit | ~4 |
| `packages/web/src/__tests__/lib/apiClient.admin.test.ts` | Unit | ~6 |
| `packages/web/src/__tests__/components/AdminGuard.test.tsx` | Unit | ~5 |
| `packages/web/src/__tests__/components/AdminLayout.test.tsx` | Unit | ~3 |
| `packages/web/src/__tests__/components/MissedQueriesPanel.test.tsx` | Unit | ~10 |
| `packages/web/src/__tests__/components/ResponseReviewPanel.test.tsx` | Unit | ~8 |
| `packages/web/src/__tests__/components/OverviewPanel.test.tsx` | Unit | ~6 |
| `packages/web/src/__tests__/admin-analytics-route.integration.test.tsx` | Integration | ~3 |

**Total new frontend tests: ~51**

**Mocking strategy:**
- **Test runner: Jest** (`packages/web/jest.config.js`; `packages/web/package.json:5-12`). Per /review-plan round 1 SUGGESTION (Codex): use Jest patterns NOT Vitest. All examples below use `jest.mock` / `jest.fn` mirroring existing patterns at `packages/web/src/__tests__/auth/AuthProvider.fWebTier.test.tsx:14-36` and `__tests__/components/HablarShell.fWebTier.test.tsx:14-29`.
- `useAuth`: mock at module level via `jest.mock('../hooks/useAuth')` (relative path matching project convention) — return `{ user, account, loading, accountErrorCode }` as specified per test
- `apiClient` admin functions: mock via `jest.mock('../lib/apiClient')` — return fixture data or throw `ApiError`
- `useRouter` / `usePathname`: mock via `jest.mock('next/navigation')` — `useRouter` returns `{ replace: jest.fn(), back: jest.fn(), refresh: jest.fn() }`, `usePathname` returns `/admin/analytics`
- `ResultBody` (in ResponseReviewPanel tests): use real component (not mocked) to verify expand-row renders
- `trackEvent`: mock via `jest.mock('../lib/metrics')` where needed to assert telemetry calls

**Regression guard for TranscriptEntry refactor:**
The existing TranscriptEntry test suite (`HablarShell.test.tsx`, `HablarShell.fWebHistory.test.tsx`, etc.) renders entries — these will exercise the refactored `ResultBody` import path. No dedicated regression test file needed; the existing tests serve as the regression gate. Developer must confirm existing test suite stays green after F4.

---

### Key Patterns

- **`'use client'` directive:** Required on `AdminGuard`, `AdminLayout`, `MissedQueriesPanel`, `ResponseReviewPanel`, `OverviewPanel`, `ResultBody`, `useT`. Server Components: `admin/layout.tsx` (outer shell), `admin/analytics/page.tsx`. Pattern: same as `hablar/page.tsx` (Server) → `HablarShell` (`'use client'`).
- **Auth token singleton:** Admin API calls use the same `authToken` module-level singleton set by `AuthProvider` on `SIGNED_IN`/`INITIAL_SESSION`. No new auth mechanism. Pattern: `getMe()` in `apiClient.ts:433` — guard `if (!authToken) throw ApiError('UNAUTHORIZED')`.
- **ApiError.code surface:** All admin API errors bubble up as `ApiError` with `.code`. Panel components check `err instanceof ApiError && err.code === 'NOT_PROVISIONED'` for the amber inline 403 state. Pattern: existing `getMe` error handling in `AuthProvider.tsx:82-86`.
- **useT interpolation (IMPORTANT — no built-in interpolation):** The hook returns a plain string. Callers use `.replace('{count}', String(val))` for any key with `{placeholder}` syntax. Do NOT add interpolation to the hook. Reference: W34 note and W34 example snippet.
- **Optimistic update pattern for MissedQueriesPanel:** Capture prior status before optimistic write; on error restore prior status via `setRowUpdates`. Row key is `queryText` (not `trackingId`) because untracked rows have no ID.
- **Two-step track + status pattern:** For "Resuelto"/"Ignorar" on untracked rows: (1) `trackMissedQueries` → capture returned `id`, (2) `updateMissedQueryStatus(id, { status })`. If step 1 fails, revert immediately and skip step 2. If step 2 fails, revert and surface error. Both steps are optimistic — badge shows `resolved`/`ignored` immediately during both calls.
- **CSS grid expand animation (CRITICAL — NOT max-height):** W32 anti-pattern explicitly prohibits `max-height`. Use `grid-template-rows: 0fr → 1fr` trick. Inner div must have `min-h-0`. Transition: `transition-[grid-template-rows] duration-250 ease-out`.
- **Shimmer reuse:** `shimmer-element` CSS class defined in `globals.css:81`. Use on skeleton `<td>` inner divs per W30 spec. No new CSS needed.
- **`mist` token:** `bg-mist` resolves to `var(--color-mist, #EEF4EC)` — defined in `tailwind.config.ts:19`. Available in all Tailwind classes. Use `bg-mist/30` for semi-transparent variant (webTotalQueries card).
- **Admin panel cards pattern:** `bg-white rounded-2xl border border-slate-100` — no `shadow` (W37 anti-pattern). Panel header: `px-5 pt-5 pb-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3`.
- **Accessibility:** TimeRange segmented control: `role="group" aria-label={t('common.timeRange.label')}`, each button: `aria-pressed={isActive}`. Nav link: `aria-current="page"` when active. Table: `sticky top-0 z-10 bg-slate-50` on `thead` per W30. Expand row: `aria-label` from `t('panel.responseReview.expandAriaLabel')`.

**Gotchas:**
- `ResultBody` extraction: the existing `TranscriptEntry.tsx` inner function takes `entry: TranscriptEntryData` and checks `entry.error`, `entry.isLoading`, `entry.photoData` BEFORE reaching the `entry.result` switch. These outer branches stay in `TranscriptEntry.tsx`. The extracted `ResultBody` only receives `data: ConversationMessageData` — it NEVER gets the error/loading/photo branches.
- `HistorySampleData` type depends on backend Step B6 (`packages/shared/src/schemas/analytics.ts` additions). Frontend F5 (`apiClient.ts` wrappers) must be implemented AFTER B6 lands, or use placeholder types that are updated once B6 is merged.
- `WebMetricsAggregate` is exported from `packages/shared/src/schemas/webMetrics.ts:84` — confirmed. `topIntents` field is `{ intent: string; count: number }[]` — the intent strings from web events are free-form (sent by `trackEvent` in `metrics.ts`), NOT typed as `ConversationIntent`. Display them as-is with the badge style if the value matches an intent label, otherwise raw string.
- `minCount` default in the spec says `1` (Panel A filter), but the schema `MissedQueriesParamsSchema` defaults to `2` (`packages/shared/src/schemas/missedQueries.ts:24`). Use `1` as the UI default per ui-components.md:151 and the spec table, not the schema default — the UI sends its own explicit value.
- Segmented control active state: `bg-brand-green text-white` per W29. Use Tailwind JIT classes — no dynamic class names. Use conditional class string: `isActive ? 'bg-brand-green text-white' : 'bg-white text-slate-600 hover:bg-slate-50'`.
- `usePathname()` can return `null` during SSR in some Next.js versions — guard with `?? ''` or `?? '/admin/analytics'` in AdminGuard's redirectTo computation.
- `router.replace` in AdminGuard's anon branch: in test, mock `useRouter` to return `{ replace: jest.fn() }` — verify `replace` was called with the correct redirectTo, but do NOT assert `router.replace` causes navigation (jsdom doesn't implement navigation).

---

### Verification commands run

- `grep -n "<ResultBody>" packages/web/src/components/TranscriptEntry.tsx` → found at line 346: `<ResultBody entry={entry} onRetry={onRetry} onDishSelect={onDishSelect} />` — internal function defined at line 42 with props `{ entry: TranscriptEntryData; onRetry?; onDishSelect? }` → extraction requires prop widening to `{ data: ConversationMessageData; onDishSelect? }` and dropping `onRetry` (belongs to error state in outer shell, not the result body)

- `ls packages/web/src/components/ | grep -E "^Admin|Panel"` → no existing Admin* or *Panel components → all 5 admin components are new; no naming collision

- `grep -n "useAuth\|account\|loading\|user" packages/web/src/components/AuthProvider.tsx` → confirmed `AuthContextValue` at line 28 exports `{ user: User | null, account: Account | null, loading: boolean }` exactly — `account.tier` is the `tier` field on `Account` type from `@foodxplorer/shared`

- `ls packages/web/src/app/ | sort` → confirmed: `hablar/`, `login/`, `api/`, `layout.tsx`, `page.tsx` — no existing `admin/` directory; AdminGuard + AdminLayout are entirely new

- `grep -rn "export.*useAuth" packages/web/src/` → `packages/web/src/hooks/useAuth.ts:11` — confirmed import path is `@/hooks/useAuth`, NOT from AuthProvider directly

- `grep -n "mist\|#EEF4EC" packages/web/tailwind.config.ts` → `mist: 'var(--color-mist, #EEF4EC)'` at line 19 — `bg-mist` is a valid Tailwind utility; also `bg-mist/30` (Tailwind opacity modifier) is valid

- `grep -n "shimmer\|shimmer-element" packages/web/src/styles/globals.css` → `@keyframes shimmer` at line 72, `.shimmer-element` class at line 81 — confirmed available globally for skeleton table rows

- `grep -rn "getMissedQueries\|trackMissedQueries\|getQueriesAnalytics\|getWebMetrics\|getHistorySample" packages/web/src/` → empty — no existing admin API wrappers; all 6 are new additions to `apiClient.ts`

- `grep -rn "admin" packages/web/src/ | grep -v "__tests__\|node_modules\|\.css\|spec"` → only hit is `UsageMeter.tsx:109` which checks `tier === 'admin'` to hide the meter — no admin UI infrastructure exists yet

- `grep -n "missRate" packages/shared/src/schemas/analytics.ts` → not found — `missRate` is NOT a field in `AnalyticsDataSchema`; it is computed client-side as `byLevel.miss / totalQueries`; noted as key pattern for OverviewPanel

- `grep -n "MissedQueryItem\|trackingId\|trackingStatus" packages/shared/src/schemas/missedQueries.ts` → `MissedQueryItemSchema` at line 32: fields `queryText`, `count`, `trackingId: z.string().uuid().nullable()`, `trackingStatus: MissedQueryStatusSchema.nullable()` — confirmed `rowUpdates` keyed by `queryText` (stable) is correct because untracked rows have `trackingId: null`

- `grep -n "WebMetricsAggregate\|topIntents" packages/shared/src/schemas/webMetrics.ts` → `WebMetricsAggregateSchema` at line 72; `topIntents: z.array(z.object({ intent: z.string(), count: z.number() }))` at line 79 — `intent` is `string`, NOT typed as `ConversationIntent` (free-form from sendBeacon payloads); noted in Key Patterns gotcha

- `grep -n "AnalyticsTimeRangeSchema\|default('7d')" packages/shared/src/schemas/analytics.ts` → `AnalyticsQueryParamsSchema.timeRange` defaults to `'7d'`; `MissedQueriesParamsSchema.timeRange` at line 22 also defaults to `'7d'` — UI default of `'7d'` is consistent with schema defaults

- `grep -n "minCount" packages/shared/src/schemas/missedQueries.ts` → `minCount: z.coerce.number().int().min(1).default(2)` at line 24 — schema default is `2`, NOT `1`; ui-components.md:151 specifies `minCount: 1` as the UI default; confirmed: UI sends explicit `minCount=1` on mount, overriding schema default

- `grep -rn "aria-pressed\|aria-current" packages/web/src/components/` → no existing `aria-pressed` usage — will be first use; `aria-current` not found in existing components — both are new accessibility patterns in admin shell. Verified against W29 (`role="group" aria-label` + `aria-pressed`) and W27 (`aria-current="page"` on active nav link)

- `grep -n "BatchTrackBodySchema\|MissedQueryTracking\|UpdateMissedQueryStatusResponse" packages/shared/src/schemas/missedQueries.ts` → `BatchTrackBodySchema` at line 104: `{ queries: [{ queryText, hitCount }] }`; `MissedQueryTracking` at line 78: response shape from POST /track with `id` field for two-step capture; `UpdateMissedQueryStatusResponse` at line 94: `{ success: true, data: MissedQueryTracking }` — confirms `trackMissedQueries` returns an array of `MissedQueryTracking` (one per queued item)

- `grep -n "ConversationIntentSchema" packages/shared/src/schemas/conversation.ts` → line 59: `z.enum(['estimation', 'comparison', 'menu_estimation', 'reverse_search', 'context_set', 'text_too_long', 'follow_up_attribute', 'follow_up_refinement'])` — 8 values confirmed; `text_too_long` IS in the enum (no explicit case in TranscriptEntry switch — falls to `default: return null`); extracted `ResultBody` must include explicit `case 'text_too_long': return null` for clarity

- `grep -n "HistorySampleResponseSchema\|HistorySampleData" packages/shared/src/schemas/analytics.ts` → not found (B6 not yet implemented) — Frontend F5 wrappers for `getHistorySample` must use `HistorySampleData` type with awareness that it's added by backend Step B6; developer must implement F5 after B6 lands or stub the type
