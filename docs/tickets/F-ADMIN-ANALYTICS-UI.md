# F-ADMIN-ANALYTICS-UI: Admin Analytics UI for Telemetry-Driven Beta Readiness

**Feature:** F-ADMIN-ANALYTICS-UI | **Type:** Fullstack (Frontend + Backend + Shared Schemas) | **Priority:** High (beta readiness gate)
**Status:** Planning | **Branch:** `feature/F-ADMIN-ANALYTICS-UI` (off develop @ `46fc0ba`, created 2026-06-10) | **Merged:** —
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

1. **`packages/api/src/plugins/adminPrefixes.ts`** — split the prefix list into two groups: `ANALYTICS_PREFIX = '/analytics/'` (bearer-only path) vs `KEY_ADMIN_PREFIXES = ['/ingest/', '/quality/', '/embeddings/', '/admin/']` (X-API-Key path). Existing `ADMIN_PREFIXES` constant preserved as the union for any consumer that still needs the full set. Add helpers `isAnalyticsRoute(url, method)` and `isKeyAdminRoute(url)` mirroring the existing `isAdminRoute` shape (keep the `POST /analytics/web-events` public exemption).

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
  kind: SearchHistoryKind,       // 'text' | 'voice'
  queryText: string,             // max 2000 chars
  resultData: ConversationMessageDataSchema,
  createdAt: string (ISO 8601)
}
```

**Privacy decision:** NO account identifier is exposed in the response — neither raw `accountId` nor any derivative (hash/HMAC). The use case is auditing **responses** for correctness, not user behaviour patterns. Owner explicitly chose YAGNI here: no hash, no env var, no RGPD surface. If a future use case needs same-user correlation (e.g. "this account hits the same wrong-flagged response 5 times"), an `actorHash` can be added in a follow-up ticket without breaking changes (additive optional field).

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

`account_id` is NEVER fetched — privacy enforced at the query level, not just at response construction. No second COUNT query (no `totalAvailable`). Rows whose `result_jsonb` fails `ConversationMessageDataSchema.safeParse` are dropped during response mapping; not returned, not counted, not logged with row content.

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
- [ ] `GET /analytics/queries` with header `X-API-Key: $ADMIN_API_KEY` and NO `Authorization` header returns `401` (code `UNAUTHORIZED`). Same for `/analytics/missed-queries`, `/analytics/missed-queries/track`, `/analytics/missed-queries/:id/status`, `/analytics/web-events` GET, and the new `/analytics/history-sample`. Verified by integration test.

### AC2 — Phase 0: `/analytics/*` rejects non-admin bearer
- [ ] `GET /analytics/queries` with `Authorization: Bearer <jwt>` for an account with `tier !== 'admin'` (e.g. free or pro) returns `403` (code `FORBIDDEN`). Same for all `/analytics/*` endpoints listed above. Verified by integration test using a seeded non-admin account.

### AC3 — Phase 0: `/analytics/*` accepts admin bearer
- [ ] `GET /analytics/queries` with `Authorization: Bearer <jwt>` for an account with `tier === 'admin'` returns `200` with the expected envelope. Same for all `/analytics/*` endpoints. Verified by integration test using a seeded admin account.

### AC4 — Phase 0: Other admin prefixes unchanged (X-API-Key still works)
- [ ] Regression test confirms at least one route on each of the other 4 admin prefixes still accepts `X-API-Key: $ADMIN_API_KEY` (no bearer) and rejects requests without the key with 401. Concrete routes (per round 2 review — all verified to exist): `GET /admin/waitlist`, `GET /quality/report`, `POST /embeddings/generate`, AND one ingest route (e.g., `POST /ingest/url` or `POST /ingest/pdf-url`). If any prefix has no consumer-grade route the planner can call, explicit "no consumer to test for prefix X" note suffices for that one prefix (justified in the test file).

### AC5 — Phase 0: `POST /analytics/web-events` public exemption preserved
- [ ] `POST /analytics/web-events` (sendBeacon ingest) with NO auth headers still returns `202` (existing behavior). The bearer-only migration does NOT regress the public exemption hardcoded in `isAdminRoute(url, method)` (`adminPrefixes.ts:12`). Verified by integration test.

### AC5b — Phase 0: requireAdminBearer rejects missing-row with distinct NOT_PROVISIONED code (round 3 external audit IMP-2 + step 1 NIT)
- [ ] A bearer JWT for a user whose `auth_user_id` does NOT have an `accounts` row (fresh login, has not yet called `/me`) calls `GET /analytics/queries` with `Authorization: Bearer <jwt>`. `requireAdminBearer` returns 403 with **error code `NOT_PROVISIONED`** (distinct from `FORBIDDEN`) and message "Account not provisioned. Call GET /me once to provision, then retry." NO auto-upsert occurs (verified by integration test asserting `accounts` row count UNCHANGED before/after the rejected call). Web flow: AC8 (admin sees dashboard) confirms `AuthProvider.SIGNED_IN` calls `getMe()` automatically, so the web admin never sees this 403 in normal flow. Tests assert BOTH the HTTP status (403) AND the error code (`NOT_PROVISIONED` vs `FORBIDDEN`) — the code is the programmatic distinguisher, not the message.

### AC5c — Phase 0: requireAdminBearer DB error distinguishable from non-admin
- [ ] If the tier read throws (DB unavailable), `requireAdminBearer` returns 500 `DB_UNAVAILABLE` — NOT 403. The 403 `FORBIDDEN` only fires when (a) the account row is missing (with provisioning hint message) or (b) the account row exists with `tier !== 'admin'` (without hint). Distinct so the web AdminGuard can show "error temporal, reintenta" vs "no tienes permisos". Verified by integration test that mocks the DB to throw.

### AC5d — Phase 0: requireAdminBearer per-bearer rate limit (round 3 external audit IMP-1)
- [ ] `requireAdminBearer` enforces a per-`sub` rate limit of 30 req/min, mirroring `/me`'s protection. Bypassing the limit returns 429 `RATE_LIMIT_EXCEEDED`. Verified by integration test: (a) hit `/analytics/queries` 30 times with the same bearer → all 200/403 (per tier); (b) the 31st within the window → 429. Counter resets at the window boundary. The limit applies BEFORE the tier check (so even non-admin bearers cannot DDoS the DB read).

### AC6 — Anonymous redirects to login
- [ ] An unauthenticated user visiting `/admin/analytics` is redirected to `/login?redirectTo=%2Fadmin%2Fanalytics` (client-side redirect via `AdminGuard`). The page content is NOT rendered before the redirect fires.

### AC7 — Authenticated non-admin gets 403
- [ ] An authenticated user with `account.tier !== 'admin'` (e.g. `free` or `pro`) visiting `/admin/analytics` sees a 403 error page with the message "Acceso denegado — se requiere nivel administrador." No dashboard panels are rendered.

### AC8 — Admin sees the dashboard
- [ ] An authenticated user with `account.tier === 'admin'` visiting `/admin/analytics` sees all three panels (Missed Queries, Respuestas para revisar, Vista general) with data loaded or loading states visible.

### AC9 — Logout removes access
- [ ] After signing out from the admin dashboard, navigating back to `/admin/analytics` redirects to `/login?redirectTo=...` (session is cleared; `AdminGuard` falls into the unauthenticated branch).

### AC10 — Panel A loads via GET /analytics/missed-queries
- [ ] `MissedQueriesPanel` mounts and fires `GET /analytics/missed-queries?timeRange=7d&topN=20&minCount=1` (default params) with bearer auth. On success, the table renders rows with queryText, count, and tracking status badge (or no badge if untracked).

### AC11 — Panel A filters apply
- [ ] Changing the `timeRange` preset re-fetches with the new `timeRange`. Changing `topN` or `minCount` re-fetches with updated params. All three filters work independently and in combination.

### AC12 — Panel A per-row tracking actions (correct contract per `routes/missedQueries.ts:163` + `schemas/missedQueries.ts:104`)
- [ ] "Investigando" on an UNTRACKED row (`trackingId === null`): calls `POST /analytics/missed-queries/track` with body `{ queries: [{ queryText: row.queryText, hitCount: row.count }] }`. Backend upserts with `status: 'pending'`. Response returns the created row with `id`; UI captures and stores it. Optimistic badge update to `pending`.
- [ ] "Investigando" on a TRACKED row (`trackingId !== null`): calls `POST /analytics/missed-queries/:trackingId/status` with body `{ status: 'pending' }`.
- [ ] "Resuelto" on TRACKED row: `POST /analytics/missed-queries/:trackingId/status` body `{ status: 'resolved' }`. On UNTRACKED row: two-step (POST /track first to get id, then POST /:id/status); rollback both on error.
- [ ] "Ignorar" same two-step pattern with `{ status: 'ignored' }`.
- [ ] On API error: badge reverts to prior state; inline error message appears below the row.

### AC13 — Panel A empty state
- [ ] When `GET /analytics/missed-queries` returns `missedQueries: []` (no misses in period), the panel shows "No hay búsquedas sin respuesta en este período." instead of an empty table.

### AC14 — Panel B loads via GET /analytics/history-sample
- [ ] `ResponseReviewPanel` mounts and fires `GET /analytics/history-sample?hours=24&limit=20` (default params, no intent filter) with bearer auth. On success, the table renders rows with queryText (truncated 100 chars), intent badge, kind badge, createdAt relative time, and an expand icon. Header shows "Últimas N entradas en las últimas 24 horas" (NO `X de Y` — `totalAvailable` was intentionally dropped per round 1 rationale).

### AC15 — Panel B intent filter
- [ ] Selecting a specific intent from the dropdown re-fetches with `?intent=<value>`. Selecting "Todos" removes the intent filter parameter. The table updates accordingly.

### AC16 — Panel B hours and limit filters
- [ ] Changing the `hours` input (valid range 1–720) re-fetches with the new `hours`. Changing `limit` (valid range 1–100) re-fetches. Out-of-range values are clamped or rejected with inline validation before fetch.

### AC17 — Panel B expand row shows full resultData
- [ ] Clicking the expand icon on a table row reveals the full `resultData` payload rendered in a readable format. The implementation either (a) reuses an extracted `<ResultBody>` from `TranscriptEntry` or (b) provides an admin-only renderer covering the 8 `ConversationIntent` shapes — decision finalized in Step 2 plan. Clicking again collapses it.

### AC18 — Panel C loads scalars from GET /analytics/queries + webTotalQueries from /analytics/web-events
- [ ] `OverviewPanel` fetches `GET /analytics/queries?timeRange=7d` AND `GET /analytics/web-events?timeRange=7d` in parallel on mount. Scalar cards render: `totalQueries` (from queries), `cacheHitRate` (X%), `avgResponseTimeMs` (Xms), `missRate` (X%), AND `webTotalQueries` ("Sesiones web · queries totales", from web-events `totalQueries`). The `byLevel`, `bySource`, `topQueries`, and `topIntents` distributions also render.

### AC19 — Panel C independent error states + filter parity
- [ ] If `/analytics/web-events` fetch fails independently, an inline error appears below the web-events section but the queries section continues to render. Changing the `timeRange` preset re-fetches both endpoints with the new `timeRange`; both sections show their own loading state during re-fetch.

### AC20 — history-sample endpoint envelope + privacy
- [ ] `GET /analytics/history-sample` with a valid admin bearer returns `200` with envelope shape `{ success: true, data: { items, hours, limit, intentFilter? } }` per `HistorySampleResponseSchema`. NO `totalAvailable` field. Each item contains EXACTLY `id`, `kind`, `queryText`, `resultData`, `createdAt` — test asserts `accountId`, `actorHash`, and any other account-identifying field are NOT present (privacy by exclusion).

### AC21 — history-sample schema validation
- [ ] `GET /analytics/history-sample?hours=721` returns `400` (hours exceeds max 720). `?limit=0` returns `400` (limit below min 1). `?intent=invalid_value` returns `400` (not a valid `ConversationIntent`). Valid requests with all defaults return the correct shape. Rows whose `result_jsonb` fails `ConversationMessageDataSchema.safeParse` are dropped from `items` (verified by integration test that seeds a drifted row + asserts it does NOT appear in the response).

### AC22 — i18n useT hook
- [ ] `useT('admin')` returns a translation function that resolves `'panel.missedQueries.title'` to the Spanish string in `messages/es/admin.json`. Calling the function with a key that does not exist in the JSON returns the key string itself (fallback). Nested dot-separated keys resolve correctly. The `LOCALE` constant equals `'es'`. Verified by unit tests in `useT.test.ts`.

### AC23 — api-spec.yaml fully updated (security + prose + response codes)
- [ ] `docs/specs/api-spec.yaml` contains:
  - (a) `GET /analytics/history-sample` entry with full query param schema, envelope response (items, hours, limit, intentFilter optional), 400/401/403/500 responses
  - (b) Security scheme changed from `AdminKeyAuth` to `BearerAuth` on the 5 existing analytics endpoints: `GET /analytics/queries`, `GET /analytics/missed-queries`, `POST /analytics/missed-queries/track`, `POST /analytics/missed-queries/:id/status`, `GET /analytics/web-events`
  - (c) For those same 5 endpoints: 401 response prose updated from "Missing or invalid admin API key" → "Missing or invalid bearer token". 403 response block ADDED (was absent for some): "Authenticated bearer does not have `admin` tier" with example `code: FORBIDDEN`
  - (d) `POST /analytics/web-events` security unchanged (public sendBeacon)
  - Verified by round 3 review (each line cited in the round 1 Codex IMPORTANT #3 finding has been updated)

### AC24 — ui-components.md updated
- [ ] `docs/specs/ui-components.md` documents `AdminLayout`, `AdminGuard`, `MissedQueriesPanel`, `ResponseReviewPanel`, and `OverviewPanel` with props, state, interactions, and loading/error/empty states.

### AC25 — ADR-031 written
- [ ] `docs/project_notes/decisions.md` contains ADR-031 "Bearer-only admin auth for `/analytics/*`" with sections Context / Decision / Tradeoffs / Out of scope as drafted in the Spec → ADR-031 Required block above.

### AC26 — Operator smoke: dashboard loads on app-dev (Status: Pending — post-merge)
- [ ] After merging and deploying to `app-dev.nutrixplorer.com`: log in as the admin account, navigate to `/admin/analytics`, verify all three panels load with real data (or show the correct empty state for Panel A if there are no recent misses).

### AC27 — Operator smoke: NEXT_PUBLIC_METRICS_ENDPOINT set + Panel C webTotalQueries ticks (Status: Pending — post-merge)
- [ ] `NEXT_PUBLIC_METRICS_ENDPOINT` is set to `https://api-dev.nutrixplorer.com/analytics/web-events` in Vercel dev env vars (and `https://api.nutrixplorer.com/...` for prod when releasing). After setting the var, opening `/hablar` and submitting at least one query: the Panel C scalar `webTotalQueries` (or `web_metrics_events` row count in Supabase) increments. Verified via Panel C re-fetch button or page reload showing the new count.

---

## Definition of Done

- [ ] All ACs above met except AC26 and AC27 (operator-pending post-merge)
- [ ] `packages/web` suite: green (net +N: useT hook + AdminGuard + 3 panel components + admin route)
- [ ] `packages/api` suite: green (net +N: Phase 0 auth migration tests — bearer-only on /analytics/*, X-API-Key still works on other admin prefixes, web-events public exemption preserved, requireAdminBearer preHandler tests covering: no bearer→401, bearer+no-row→403-with-hint (no upsert side effect), bearer+wrong-tier→403, bearer+admin→pass, DB error→500, rate-limit 30/min per sub→429. PLUS history-sample route — admin gate, intent filter, hours filter, limit cap, empty case, defaults, accountId NOT in response, drifted result_jsonb dropped, envelope shape)
- [ ] `packages/shared` suite: green (new Zod schemas: HistorySampleParamsSchema, SearchHistorySampleEntrySchema, HistorySampleDataSchema, HistorySampleResponseSchema)
- [ ] `npm run lint`, `npm run typecheck`, `npm run build` all clean for all 3 workspaces
- [ ] `docs/specs/api-spec.yaml` — history-sample entry added + 5 security scheme migrations (AdminKeyAuth → BearerAuth) (AC23)
- [ ] `docs/specs/ui-components.md` — Admin components documented (AC24)
- [ ] `docs/project_notes/decisions.md` — ADR-031 added (AC25)
- [ ] `docs/project_notes/key_facts.md` — Admin route `/admin/analytics` + i18n-light infra + auth migration note added to relevant sections
- [ ] Ticket `## Spec` section written (this section — done at Step 0)
- [ ] PR opened against `develop` with CI green
- [ ] Operator smokes AC26 and AC27 planned for `app-dev` post-merge
- [ ] Breaking-change communication: ADR-031 + tracker entry documents that any X-API-Key consumer of `/analytics/*` MUST migrate to bearer post-merge (owner confirmed acceptable — only consumer is Pablo)

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
- [ ] Step 0: Owner sign-off on revised spec (round 4 final verdict)
- [x] Step 1: Branch `feature/F-ADMIN-ANALYTICS-UI` created off develop @ `46fc0ba`, tracker updated, ADR-031 stub added to `decisions.md`
- [ ] Step 2: `ui-ux-designer` executed (panel layout, visual hierarchy, component hierarchy finalized — per memory `feedback_uiux_designer_agent`)
- [ ] Step 2: `frontend-planner` executed, Implementation Plan written
- [ ] Step 2: `backend-planner` executed (auth migration + history-sample endpoint + schemas)
- [ ] Step 2: Cross-model `/review-plan` APPROVED
- [ ] Step 3: Implementation (frontend-developer + backend-developer)
- [ ] Step 4: Quality gates pass (lint + typecheck + build + all tests green)
- [ ] Step 5: `code-review-specialist` executed, findings addressed
- [ ] Step 5: `qa-engineer` executed, findings addressed
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

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | — |
| 1. Mark all items | [ ] | — |
| 2. Verify product tracker | [ ] | — |
| 3. Update key_facts.md | [ ] | — |
| 4. Update decisions.md | [ ] | ADR-031 "Bearer-only admin auth for `/analytics/*`" added — Context / Decision / Tradeoffs / Out of scope sections per Spec → ADR-031 Required block; matches AC25 + Workflow Step 1. |
| 5. Commit documentation | [ ] | — |
| 6. Verify clean working tree | [ ] | — |
| 7. Verify branch up to date | [ ] | — |
| 8. Verify CI green (`gh pr checks <N>`) | [ ] | — |
| 9. Run `/audit-merge` | [ ] | — |
