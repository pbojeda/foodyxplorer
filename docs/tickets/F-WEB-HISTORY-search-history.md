# F-WEB-HISTORY: Search history — session transcript + persisted history

**Feature:** F-WEB-HISTORY | **Type:** Fullstack-Feature | **Priority:** High
**Status:** In Progress | **Branch:** feature/F-WEB-HISTORY-search-history
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-05-27 | **Dependencies:** F-WEB-TIER (done — account identity + tier), F107a auth (done), BUG-PROD-013 (done — bearer actor resolution)

---

## Spec

### Description

**Problem (empirical, research §C/H1):** Today `/hablar` shows only the *last* result. `HablarShell` holds a single result in `useState` and **replaces** it on each new query — every search erases the previous one. Users (anonymous and logged-in alike) cannot review what they just looked up, and logged-in users get no durable value from registering.

**Goal (owner-approved scope 2026-05-27 = FULL persistence, not just the local Fase-1):**

1. **Session transcript (Fase 1 — UI architecture refactor).** Refactor `HablarShell`/`ResultsArea` from a *singleton intent-renderer* into an append-only **feed/transcript**: each text/photo/voice result is appended below the previous one within the session, newest-relevant visible, scrollable. Fixes "se borra" for **everyone** (including anonymous). This is the foundation and must land on a testable footing first.

2. **Persisted history (Fase 2-3 — logged-in only).** For authenticated accounts, persist each text/voice query + its result so the user can reload past searches across sessions/devices:
   - New table **`search_history`** (`id`, `account_id` FK → `accounts.id` CASCADE, `kind`, `query_text`, `result_jsonb`, `created_at`).
   - **`GET /history`** — cursor-paginated (preload most recent ~10, infinite scroll backwards).
   - Persistence write on successful text/voice query (bearer path).
   - **Delete**: per-entry delete + "borrar todo el historial" action.

**Design forks (research §D, recommended defaults — confirm at Spec checkpoint):**
- **D3 — Photo OUT of persisted history v1.** Session transcript shows photos; persistence covers **text + voice only** (photo `result_jsonb` is large/multi-dish; defer to a conditional Fase 4). Photos still appear in the live session feed.
- **D4 — Retention soft cap** ~500 entries / 12 months per account (prune oldest on write or via the read path; exact mechanism = Plan).
- **D5 — Privacy.** `search_history.account_id` FK is `ON DELETE CASCADE` (account deletion wipes history); user-facing "borrar historial" action; a privacy-policy note. **Not RGPD Art.9** (food queries are not special-category health data; consistent with the F099 deferral rationale which WAS Art.9).

**Identity model (reuse, do NOT reinvent):** history is scoped by **account** (not actor). `request.accountId` = JWT `sub` = `auth_user_id`; the `accounts` row PK (`accounts.id`) is the FK target — same distinction F-WEB-TIER/F107a established. Bearer-gated, read-only-for-other-accounts isolation. Reuse `resolveBearerActorId` / account resolution patterns from `lib/bearerActor.ts` + F-WEB-TIER `/me/usage`.

### API Changes

Three new bearer-only endpoints plus one persistence hook on existing routes. Full OpenAPI detail in `docs/specs/api-spec.yaml` (see `/history` and `/history/{id}` path blocks added 2026-05-27).

#### GET /history

Cursor-paginated search history for the authenticated account, newest-first.

- **Auth:** bearer required (401 if absent/invalid/expired — ADR-025 R3 §5 strict).
- **Query params:** `cursor` (opaque string, omit for first page) + `limit` (1–50, default 10).
- **Response 200:** `{ success: true, data: { entries: SearchHistoryEntry[], nextCursor: string|null } }`.
  - `entries` ordered newest-first; empty array for first-time account (never 404/500).
  - `nextCursor: null` means no older entries — sentinel should stop.
- **Response 400:** `INVALID_CURSOR` when cursor is malformed (preferred over silent empty page — exposes cursor bugs in integration tests). `VALIDATION_ERROR` when limit out of range.
- **Response 401:** `UNAUTHORIZED` (no bearer) / `TOKEN_EXPIRED` / `INVALID_TOKEN`.
- **Identity pattern (READ-ONLY — cross-model C1, applied 2026-05-27):** bearer→account resolution like `GET /me/usage`. JWT `sub` = `auth_user_id` → look up `accounts.id`. **No write on a GET:** if the account row does not exist yet, return `200 { entries: [], nextCursor: null }` WITHOUT creating it. Account provisioning/linking stays centralized in `GET /me` (Option A / ADR-027 — `AuthProvider` calls `/me` on session establish, so by the time the web calls `/history` the row exists). Reuses `verifyBearerJwt`; no new auth path; no `INSERT…ON CONFLICT` like `auth.ts:228`.
- **Not quota-consuming:** does not decrement any daily bucket.

#### DELETE /history/{id}

Deletes a single `search_history` row owned by the caller's account.

- **Auth:** bearer required (same as above).
- **Response 204:** entry deleted.
- **Response 400:** `VALIDATION_ERROR` when `id` is not a valid UUID.
- **Response 401:** bearer absent/invalid.
- **Response 404:** entry not found OR owned by a different account. **Both cases return 404, not 403** — prevents existence enumeration. Idempotent-ish (already-deleted entry → 404).

#### DELETE /history

Clears all history for the authenticated account ("borrar todo el historial").

- **Auth:** bearer required.
- **Response 204:** all entries deleted (or none existed — idempotent).
- **Response 401:** bearer absent/invalid.

#### Persistence hook (no new route)

Attached to the SUCCESS path of `POST /conversation/message` and `POST /conversation/audio` when a bearer is present (meaning `request.accountId` is resolvable):

- After `reply.send({ success: true, data })` (mirrors the existing `writeQueryLog` fire-and-forget pattern at `conversation.ts:108`), fire a second fire-and-forget that inserts into `search_history`.
- Insert: `(account_id, kind, query_text, result_jsonb)` — `kind` is `'text'` for `/message`, `'voice'` for `/audio`; `query_text` is `body.text` (or Whisper transcript); `result_jsonb` is the full `ConversationMessageData` response (`data` field).
- **Must NEVER block or delay the core query response.** Wrap in `void insertSearchHistory(...).catch((err) => request.log.error({ err }, 'F-WEB-HISTORY: search_history insert failed'))` and swallow.
- **Photo results are NOT persisted** (fork D3). `POST /analyze` (photo) has no persistence hook.
- **Anonymous (no bearer):** no-op. The hook resolves `accounts.id` from the bearer `sub` (`request.accountId`); if no account row exists yet OR resolution fails (DB degraded), skip the insert silently. The hook never CREATES an account row — provisioning stays in `/me` (cross-model C1 consistency).
- **Retention cap (fork D4):** after each insert, execute a best-effort prune-on-write: `DELETE FROM search_history WHERE account_id = $1 AND id NOT IN (SELECT id FROM search_history WHERE account_id = $1 ORDER BY created_at DESC, id DESC LIMIT 500)`. Also prune rows older than 12 months: `DELETE FROM search_history WHERE account_id = $1 AND created_at < NOW() - INTERVAL '12 months'`. Both deletes are fire-and-forget (wrapped in `.catch(log.error)`). The cap is a soft cap — up to one extra row may transiently exist between the insert and the prune under concurrent writes.

---

### Data Model Changes

#### New Prisma model: `SearchHistory`

Distinct from `QueryLog` (`query_logs`). `QueryLog` stores **metadata only** (no nutritional payload): `queryText`, `levelHit`, `cacheHit`, `responseTimeMs`, etc. — it is an operational audit log. `SearchHistory` stores the **full result payload** (`result_jsonb`) keyed by **account** (not actor) so users can view past results across sessions. Different tables, different purposes, different PKs and indexes.

```prisma
// ---------------------------------------------------------------------------
// F-WEB-HISTORY — Persisted search history (authenticated accounts)
// ---------------------------------------------------------------------------

enum SearchHistoryKind {
  text
  voice

  @@map("search_history_kind")
}

model SearchHistory {
  id          String            @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  accountId   String            @map("account_id") @db.Uuid
  kind        SearchHistoryKind
  queryText   String            @map("query_text") @db.Text
  resultJsonb Json              @map("result_jsonb")
  createdAt   DateTime          @default(now()) @map("created_at") @db.Timestamptz

  account Account @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([accountId, createdAt(sort: Desc), id(sort: Desc)], name: "search_history_account_cursor_idx")
  @@map("search_history")
}
```

**Conventions followed:**
- UUID PK via `dbgenerated("gen_random_uuid()")` — matches `Account` model (`schema.prisma:491`).
- `snake_case @map` on all fields — matches every other model in the file.
- `@db.Timestamptz` on `createdAt` — matches `Account.createdAt` (`schema.prisma:494`).
- `onDelete: Cascade` on the `account` relation — account deletion wipes history automatically (fork D5 privacy).
- Composite index `(account_id, created_at DESC, id DESC)` enables efficient cursor pagination without a full table scan.
- No `updatedAt` — history entries are immutable once created (no `@updatedAt`).
- `result_jsonb` is `Json` (Prisma type → PostgreSQL `jsonb`). No size constraint at the DB level; application-level guard: the persistence hook reads from `capturedData` which is a `ConversationMessageData` object (bounded in practice, typically < 10 KB; see edge cases for large-jsonb guidance).

**Migration:** `prisma migrate deploy` (never `prisma migrate dev` — pgvector shadow DB incompatibility, same rule as all prior migrations).

**`Account` model change:** add `searchHistory SearchHistory[]` relation field so Prisma generates the correct FK join.

#### New Zod schemas: `packages/shared/src/schemas/history.ts`

File created at `packages/shared/src/schemas/history.ts`. Exported from `packages/shared/src/index.ts`.

- `SearchHistoryKindSchema` — `z.enum(['text', 'voice'])`.
- `SearchHistoryEntrySchema` — `{ id, kind, queryText, resultData, createdAt }`.
  - `queryText` — `z.string().min(1).max(2000)` (**cross-model C3:** matches `/conversation/message` `text.max(2000)`; a 501–2000 char query is a successful `text_too_long` intent on the persistence path — a 500 cap would reject a valid row).
  - `resultData` — **`ConversationMessageDataSchema`** (the real response union, **cross-model C2** — was `z.record(unknown)`). `conversation.ts` does not import `history.ts`, so the import is one-way/non-circular (verified; shared typecheck + 659 tests green). Strict typing catches drift; the web safeParses each entry and SKIPS drifted-old payloads.
- `HistoryPageSchema` — `{ entries: SearchHistoryEntrySchema[], nextCursor: z.string().nullable() }`.

No `.optional()` fields: this is a new feature with a coordinated deploy (unlike `AccountSchema.tier` in F-WEB-TIER which was added to an existing API surface). If the API is rolled back, the web gracefully degrades to session-only mode (mount fetch wrapped in try/catch, errors swallowed).

---

### UI Changes

Full visual design in `docs/specs/design-guidelines.md` W15–W26. Component contracts in `docs/specs/ui-components.md` (F-WEB-HISTORY section). Summary of changes:

#### Fase 1 — Session transcript refactor (everyone, including anonymous)

`HablarShell` replaces its singleton `results: ConversationMessageData | null` state with an append-only `entries: TranscriptEntryData[]` array. `ResultsArea` is replaced by `TranscriptFeed`.

- Each query (text, voice, photo) appends a new `TranscriptEntry` immediately with `isLoading: true` (optimistic echo). The result body renders when the response settles.
- On error, the entry shows `ErrorState` inline. Retry adds a new entry (does not mutate the failed entry — W19).
- Oldest entries at top, newest at bottom (W16). Feed auto-scrolls to bottom unless the user has scrolled up.
- `TranscriptEntry` anatomy: query echo header (text, mic icon for voice, camera icon for photo), timestamp (HH:mm or DD MMM · HH:mm), delete button, result body cards (unchanged).
- `HistoryPersistenceNudge` appears above the first entry once `entries.length >= 2` and `user === null`. Suppressed when `RateLimitNudge` is visible (W20 nudge hierarchy).

#### Fase 2-3 — Persisted history (logged-in only)

On mount (authenticated), `HablarShell` fetches `GET /history?limit=10`. Entries are prepended to the feed with `isPersisted: true` (shows "Guardado" badge per W17). The sentinel `HistoryLoadMoreSentinel` (invisible `div` at the top of the feed) triggers `onLoadMore` when it enters the viewport, fetching the next cursor page.

- `ClearHistoryButton` ("Borrar todo el historial") appears at the top of the feed when `isAuthenticated && entries.some(e => e.isPersisted)`. Triggers a modal confirm dialog (W21). On confirm, calls `DELETE /history`, then empties the feed → `HistoryEmptyState`.
- `DeleteEntryButton` (trash icon) on each persisted entry. Inline confirm row (not modal). On confirm, calls `DELETE /history/{id}`. Removes entry from local state immediately (optimistic) — on 404 it was already gone.
- `HistoryEmptyState` renders when `isAuthenticated && entries.length === 0` (first-use or post-clear).
- Photo entries (`inputMode: 'photo'`) appear in the live session feed but never get the "Guardado" badge and do not survive a page refresh (fork D3 — never persisted, never fetched from API).

#### Component list (new)

| Component | Type | File |
|---|---|---|
| `TranscriptFeed` | Feature / Client | `src/components/TranscriptFeed.tsx` |
| `TranscriptEntry` | Feature / Client | `src/components/TranscriptEntry.tsx` |
| `DeleteEntryButton` | Primitive / Client | `src/components/DeleteEntryButton.tsx` |
| `ClearHistoryButton` | Feature / Client | `src/components/ClearHistoryButton.tsx` |
| `HistoryPersistenceNudge` | Feature / Client | `src/components/HistoryPersistenceNudge.tsx` |
| `HistoryEmptyState` | Feature / Server | `src/components/HistoryEmptyState.tsx` |
| `HistoryLoadMoreSentinel` | Primitive / Client | `src/components/HistoryLoadMoreSentinel.tsx` |

#### New client hook

`useSearchHistory` — `src/hooks/useSearchHistory.ts`. Encapsulates `GET /history` fetch, cursor state, `hasMoreHistory`, `isLoadingMore`, and the `onLoadMore` callback. Returns `{ entries, hasMoreHistory, isLoadingMore, loadMore, deleteEntry, clearAll }`. `HablarShell` calls it when `user !== null`; the hook is a no-op (returns empty state) when called with `user === null`.

#### Telemetry (new events)

All via `trackEvent()` in `packages/web/src/lib/metrics.ts`. Events are client-local only (not persisted to `web_metrics_events`).

| Event | Trigger | Payload |
|---|---|---|
| `history_loaded` | Mount fetch resolves (authenticated) | `{ count: number }` |
| `history_load_more` | Sentinel fires `onLoadMore` | `{ page: number }` |
| `history_entry_deleted` | `DeleteEntryButton.onConfirm` | `{ entryId: string, inputMode: 'text' \| 'voice' }` |
| `history_cleared` | `ClearHistoryButton.onConfirm` | `{}` |
| `history_persistence_nudge_shown` | `HistoryPersistenceNudge` mount | `{}` |
| `history_persistence_nudge_cta` | "Crear cuenta gratis" clicked | `{}` |
| `history_persistence_nudge_dismissed` | Dismiss × clicked | `{}` |

---

### Edge Cases & Error Handling

| Scenario | Specified behavior |
|---|---|
| **Anonymous (no bearer)** | Session feed works normally (Fase 1). No API history calls. No persistence hook fires. `HistoryPersistenceNudge` shown after ≥2 entries. |
| **Bearer present but account row missing** | `GET /history` is **read-only**: resolves `accounts.id` from the bearer; if no row exists, returns 200 with `entries: [], nextCursor: null` WITHOUT creating it (cross-model C1 — no write-on-GET; provisioning stays in `/me`). Never 404 or 500. |
| **History entry fails shared validation (schema drift)** | The web safeParses each entry individually; an entry whose `resultData` no longer matches the current `ConversationMessageDataSchema` (a very old persisted payload) is SKIPPED, not fatal. The rest of the page renders. (cross-model C2 — strict typing + per-entry parse.) |
| **Invalid cursor** | Returns 400 `INVALID_CURSOR`. The web treats this as a terminal error for the infinite scroll (stops sentinel, logs warning). It does not retry with the bad cursor. |
| **`result_jsonb` very large** | Typical `ConversationMessageData` is < 10 KB. Menu estimation (many dishes) may reach 30–50 KB. No DB-level size cap is needed (Postgres `jsonb` handles this). The API serializes the entire `data` object. If a future `result_jsonb` grows beyond 512 KB, add an application-level size check before insert (log + skip, not error). For now, YAGNI — no size check in v1. |
| **Retention cap boundary** | Prune-on-write after each insert. Cap is 500 entries. A concurrent burst (two queries in the same millisecond) may transiently leave 501 rows; the next write corrects it. Acceptable. |
| **Delete non-owned entry** | DB query: `DELETE FROM search_history WHERE id = $1 AND account_id = $2`. If 0 rows affected → 404 (same response as "not found"). No information leakage. |
| **Redis/DB failure during persistence hook** | `catch` block logs `error` level via `request.log` and swallows. The core query response has already been sent (`reply.send` fired before the hook). The user sees their result normally; the history entry is silently lost for that query. Acceptable — history is non-critical. |
| **DB failure during `GET /history`** | Route handler lets the Fastify error handler return 500. The web catches and logs; the feed shows the session-only state (no prepopulation). Acceptable degradation — the current session feed is unaffected. |
| **Deploy skew (web ahead of API)** | If the web deploys before the API migration runs, `GET /history` returns 404 (route not registered) or 500 (table missing). The web's `useSearchHistory` hook wraps the fetch in try/catch and falls back to session-only mode. The `HistoryPageSchema` parse will also fail gracefully (Zod `safeParse`). No user-visible error — the feed simply has no pre-populated history until the API catches up. |
| **Photo entries in session feed** | Photo entries appear in the live session feed (shown by `TranscriptEntry` with `inputMode: 'photo'`). They do not get the "Guardado" badge. They are not persisted to `search_history`. They disappear on page refresh (same as anonymous session data). This is the fork D3 decision — explicit, documented, not a bug. |
| **`RateLimitNudge` and `HistoryPersistenceNudge` simultaneous** | `HistoryPersistenceNudge` is suppressed when `showRateLimitNudge === true` (W20 nudge hierarchy rule). `HablarShell` enforces this by passing `showPersistenceNudge={entries.length >= 2 && !user && !showRateLimitNudge}` to `TranscriptFeed`. |
| **Page refresh — session data loss** | Expected behavior. Session entries (including all photo entries and anonymous text/voice entries) are not persisted. On refresh, logged-in users see their last ~10 persisted entries (text/voice only). Anonymous users see an empty feed. |

---

## Implementation Plan

### Backend Plan

> Generated by `backend-planner` 2026-05-27. Frontend plan to follow.

---

#### Existing Code to Reuse

| Asset | Location | How it is reused |
|---|---|---|
| `verifyBearerJwt` | `packages/api/src/plugins/authBearer.ts` | Bearer gate in all three history routes (same call site as `GET /me/usage` at `auth.ts:423`) |
| `resolveBearerActorId` + `UUID_RE` | `packages/api/src/lib/bearerActor.ts` | Not used directly in history routes (no actor write), but `accountId` is already on `request` (set by `actorResolver.ts:91` when bearer is valid — no new resolution code needed in routes) |
| `request.accountId` | Set by `actorResolver.ts:91` (JWT `sub`) | History routes read this directly — `accountId` = `auth_user_id` which is NOT the `accounts.id` PK. The route must look up `accounts.id` via a separate `$queryRaw` on `auth_user_id` (same pattern as `resolveAccountTier` in `accountTier.ts:46–48`) |
| `resolveAccountTier` style | `packages/api/src/lib/accountTier.ts` | Pattern template for `searchHistory.ts` repo helpers: injected `prisma`, raw SQL, fail-open, structured logger |
| `reply.raw.once('finish', …)` + `capturedData` | `packages/api/src/routes/conversation.ts:108,130,454,519` | Persistence hook mirrors this EXACT pattern — `capturedData` set after `processMessage`, `'finish'` listener fires the insert |
| Error codes `UNAUTHORIZED`, `VALIDATION_ERROR`, `NOT_FOUND`, `TOKEN_EXPIRED`, `INVALID_TOKEN` | `packages/api/src/errors/errorHandler.ts` | All handled by the global error handler — throw `Object.assign(new Error(…), { code: '…' })` |
| `fastifyPlugin` wrap | `packages/api/src/routes/conversation.ts:711` | History route plugin must also be wrapped with `fastifyPlugin` so the root-level error handler applies |
| `ROUTE_BUCKET_MAP` | `packages/api/src/plugins/actorRateLimit.ts:48–54` | Do NOT add history routes here — they must stay off the map (AC16) |
| `SearchHistoryKindSchema`, `SearchHistoryEntrySchema`, `HistoryPageSchema` | `packages/shared/src/schemas/history.ts` (already created, exported from `packages/shared/src/index.ts:33`) | Import in route handler and tests |
| `ConversationMessageData` type | `packages/shared/src/schemas/conversation.ts` (exported via `@foodxplorer/shared`) | Type for `capturedData` in the persistence hook |
| Test infrastructure (JWT keypair, `buildApp`, PG 5433, Redis 6380) | `packages/api/src/__tests__/f-web-tier/fWebTier.usageEndpoint.integration.test.ts` | Copy fixture pattern, `vi.mock('../../plugins/authBearer.js')`, `mockVerifyBearerJwt`, same `testConfig` shape |

---

#### Files to Create

| File | Purpose |
|---|---|
| `packages/api/src/lib/searchHistory.ts` | Repository helper: `resolveAccountIdFromSub`, `insertSearchHistory`, `listHistory`, `deleteHistoryEntry`, `clearHistory`, `pruneHistory`. Injected `prisma`. All DB calls via `prisma.$queryRaw` / `prisma.$executeRaw`. |
| `packages/api/src/routes/history.ts` | Fastify plugin with `GET /history`, `DELETE /history/:id`, `DELETE /history`. Bearer-gated via manual `verifyBearerJwt` call (same as `GET /me/usage`). Wrapped with `fastifyPlugin`. |
| `packages/api/prisma/migrations/20260527140000_add_search_history/migration.sql` | Raw SQL: `CREATE TYPE search_history_kind`, `CREATE TABLE search_history`, index. Applied via `prisma migrate deploy`. |
| `packages/api/src/__tests__/f-web-history/fWebHistory.migration.integration.test.ts` | AC1–AC4: table structure, index existence, FK violation, CASCADE delete. Real PG :5433. |
| `packages/api/src/__tests__/f-web-history/fWebHistory.getHistory.integration.test.ts` | AC8–AC16: all `GET /history` scenarios including pagination, cursor decoding, no-account row, cross-account isolation, rate-limit non-consumption. |
| `packages/api/src/__tests__/f-web-history/fWebHistory.deleteHistory.integration.test.ts` | AC17–AC24: `DELETE /history/:id` and `DELETE /history` scenarios. |
| `packages/api/src/__tests__/f-web-history/fWebHistory.persistenceHook.integration.test.ts` | AC25–AC31, AC59, AC61: fire-and-forget insert on `/conversation/message` and `/conversation/audio` success, prune-on-write, CASCADE, round-trip intent validation, `text_too_long` persistence. |
| `packages/shared/src/__tests__/schemas.history.test.ts` | AC5–AC7: pure unit tests for `SearchHistoryKindSchema`, `SearchHistoryEntrySchema`, `HistoryPageSchema`. |

---

#### Files to Modify

| File | Change |
|---|---|
| `packages/api/prisma/schema.prisma` | Add `enum SearchHistoryKind { text; voice; @@map("search_history_kind") }`, add `model SearchHistory { … }` (exactly as documented in the ticket Spec), add `searchHistory SearchHistory[]` relation field to `model Account`. |
| `packages/api/src/app.ts` | Import `historyRoutes` from `./routes/history.js`; register after `authRoutes` with `await app.register(historyRoutes, { prisma: prismaClient })`. (No `db`/`redis` needed — history is not Redis-backed and uses raw SQL not Kysely.) |
| `packages/api/src/routes/conversation.ts` | Add the search-history persistence hook to the `'finish'` listener in both `POST /conversation/message` and `POST /conversation/audio`. Import `insertSearchHistory`, `pruneHistory` from `../lib/searchHistory.js`. |
| `packages/api/src/errors/errorHandler.ts` | Add an `INVALID_CURSOR` branch (same shape as `VALIDATION_ERROR` / `NOT_FOUND` branches) — 400 status code. |

---

#### Implementation Order

Each step is independently TDD-able: write the failing test first (RED), implement the minimum code to pass (GREEN), then refactor.

**Step 1 — Migration + Prisma model (AC1–AC4)**

1a. Create `packages/api/prisma/migrations/20260527140000_add_search_history/migration.sql` with:

```sql
-- Migration: Add search_history table + enum (F-WEB-HISTORY)
-- Rollback: DROP TABLE search_history; DROP TYPE search_history_kind;

CREATE TYPE search_history_kind AS ENUM ('text', 'voice');

CREATE TABLE search_history (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  account_id  uuid        NOT NULL,
  kind        search_history_kind NOT NULL,
  query_text  text        NOT NULL,
  result_jsonb jsonb      NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT search_history_pkey PRIMARY KEY (id),
  CONSTRAINT search_history_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX search_history_account_cursor_idx
  ON search_history (account_id, created_at DESC, id DESC);
```

1b. Apply locally: `prisma migrate deploy` (NOT `migrate dev` — pgvector shadow DB incompatibility).

1c. Add `SearchHistoryKind` enum and `SearchHistory` model to `schema.prisma` (copy verbatim from the Spec), add `searchHistory SearchHistory[]` to `model Account`.

1d. Regenerate Prisma client: `prisma generate`.

1e. Write `fWebHistory.migration.integration.test.ts` (RED then GREEN):
- AC1: query `information_schema.columns` for `search_history` and assert each column exists with correct type/nullable.
- AC2: query `pg_indexes WHERE tablename='search_history'` and assert `search_history_account_cursor_idx` exists.
- AC3: `prisma.$executeRaw` insert with a non-existent `account_id` → `.rejects.toThrow()` (FK violation).
- AC4: insert an account + search_history row, delete the account via `prisma.$executeRaw DELETE FROM accounts`, assert `SELECT COUNT(*)` from `search_history` returns 0.

---

**Step 2 — Cursor design (AC11, AC12, AC14)**

Cursor encoding is opaque base64 of `<created_at_iso>|<uuid>` (pipe separator, always two segments). This encodes the trailing position of the last entry on the current page so the next query can fetch rows strictly older than that position.

- **Encode:** `Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url')` (base64url — no padding characters to escape in query strings).
- **Decode + validate:** `Buffer.from(cursor, 'base64url').toString('utf8')` → split on `|` → expect exactly 2 segments → segment[0] must be a valid ISO date → segment[1] must match `UUID_RE`. Any failure → throw `Object.assign(new Error('Invalid cursor'), { code: 'INVALID_CURSOR' })`.
- **WHERE clause** for the next page (keyset, uses the composite index):

```sql
WHERE account_id = $1
  AND (created_at, id) < ($cursorTs::timestamptz, $cursorId::uuid)
ORDER BY created_at DESC, id DESC
LIMIT $limit + 1
```

Fetch `limit + 1` rows to detect whether a next page exists: if `rows.length > limit`, there are more — slice to `limit` and encode the last row of the slice as `nextCursor`. If `rows.length <= limit`, `nextCursor = null`.

The composite index `(account_id, created_at DESC, id DESC)` aligns exactly with this ORDER BY.

---

**Step 3 — `lib/searchHistory.ts` repository (supports Steps 4–6)**

Functions (all accept `prisma: PrismaClient`):

```
resolveAccountIdFromSub(prisma, sub: string, logger): Promise<string | null>
  SELECT id FROM accounts WHERE auth_user_id = $sub::uuid LIMIT 1
  Returns null ONLY when the SELECT returns 0 rows (account not yet provisioned by /me) — callers treat null as "no history" (GET → 200 []; DELETE → 404).
  On DB ERROR: **THROW** (let the route error handler return 500). Do NOT fail-open to null on errors — masking a DB outage as 200 [] / false 404 / false 204 is wrong for read/delete paths (cross-model X3). KEY difference from `accountTier.ts` (which fails open to `free` because tier is non-critical). Only the fire-and-forget persistence hook + prune swallow their own errors — never the request-serving routes.

insertSearchHistory(prisma, params: { accountId, kind, queryText, resultJsonb }): Promise<void>
  INSERT INTO search_history (account_id, kind, query_text, result_jsonb)
  VALUES ($1::uuid, $2::search_history_kind, $3, $4::jsonb)
  Returns void (fire-and-forget callers ignore the return).

listHistory(prisma, accountId: string, cursor: string | null, limit: number): Promise<{ rows: RawHistoryRow[], hasMore: boolean }>
  Implements the keyset WHERE described in Step 2.
  Returns { rows: RawHistoryRow[], hasMore: boolean }.

deleteHistoryEntry(prisma, accountId: string, id: string): Promise<boolean>
  DELETE FROM search_history WHERE id = $1::uuid AND account_id = $2::uuid
  Returns true if 1 row affected, false if 0 (route converts false → 404).

clearHistory(prisma, accountId: string): Promise<void>
  DELETE FROM search_history WHERE account_id = $1::uuid

pruneHistory(prisma, accountId: string): Promise<void>
  Two fire-and-forget DELETEs (500-row cap + 12-month age):
  DELETE ... WHERE account_id = $1 AND id NOT IN (SELECT id ... ORDER BY created_at DESC, id DESC LIMIT 500)
  DELETE ... WHERE account_id = $1 AND created_at < NOW() - INTERVAL '12 months'
  Errors logged and swallowed (callers wrap in void .catch(log.error)).
```

All DB calls use `prisma.$queryRaw` / `prisma.$executeRaw` (raw SQL) for the keyset query and bulk delete — Prisma model methods are not expressive enough for the cursor WHERE clause.

`RawHistoryRow` is a local interface: `{ id: string; kind: string; query_text: string; result_jsonb: unknown; created_at: Date }`.

---

**Step 4 — `GET /history` route (AC8–AC16)**

In `packages/api/src/routes/history.ts`:

Plugin options: `{ prisma: PrismaClient }`. No `db` (Kysely not needed). No `redis` (history is not Redis-backed).

Route handler pattern (mirrors `GET /me/usage` at `auth.ts:410–470`):

1. Read `Authorization` header. If absent → throw `{ code: 'UNAUTHORIZED' }`.
2. `verifyBearerJwt(authHeader, resolveJwksUrl(config))` — throws `TOKEN_EXPIRED` / `INVALID_TOKEN` on failure.
3. `sub = payload.sub` (= `auth_user_id`).
4. Validate query params: `limit` (default 10, clamp 1–50 — if outside range → throw `{ code: 'VALIDATION_ERROR' }`); `cursor` (optional string).
5. If `cursor` is present → decode + validate (Step 2). On failure → throw `{ code: 'INVALID_CURSOR' }`.
6. `accountId = await resolveAccountIdFromSub(prisma, sub, request.log)`. If `null` (no accounts row) → return `200 { success: true, data: { entries: [], nextCursor: null } }` immediately (cross-model C1 — no write-on-GET).
7. `{ rows, hasMore } = await listHistory(prisma, accountId, cursor, limit)`.
8. Map `rows` to `SearchHistoryEntry` objects: `{ id, kind, queryText: row.query_text, resultData: row.result_jsonb, createdAt: row.created_at.toISOString() }`.
9. `nextCursor = hasMore ? encodeCursor(rows[rows.length - 1]) : null`.
10. Return `200 { success: true, data: { entries, nextCursor } }`.

The route must NOT appear in `ROUTE_BUCKET_MAP` (AC16 — not quota-consuming). No rate-limit config block needed.

The `resolveJwksUrl` function can be extracted as a small module-level helper (copy pattern from `auth.ts:479–483`) — or `config` can be passed through the plugin options. Since `buildApp` does not pass `config` to every route, the cleaner approach is to add `config: Config` to `HistoryPluginOptions` and register as `await app.register(historyRoutes, { prisma: prismaClient, config: cfg })`.

Add `INVALID_CURSOR` to `errorHandler.ts` (same block structure as `NOT_FOUND` at line 230–238): HTTP 400, code `INVALID_CURSOR`.

---

**Step 5 — `DELETE /history/:id` and `DELETE /history` (AC17–AC24)**

Both routes in the same `history.ts` plugin. Bearer gate identical to `GET /history` (steps 1–3 above), then `resolveAccountIdFromSub`.

`DELETE /history/:id`:
- Validate `params.id` against `UUID_RE`. If invalid → throw `{ code: 'VALIDATION_ERROR' }`.
- If `accountId === null` → 404 (no account, no entry).
- `const deleted = await deleteHistoryEntry(prisma, accountId, params.id)`.
- If `!deleted` → throw `Object.assign(new Error('Not found'), { code: 'NOT_FOUND' })`.
- Reply `204` (no body).

`DELETE /history`:
- If `accountId === null` → 204 (no entries, idempotent).
- `await clearHistory(prisma, accountId)`.
- Reply `204`.

---

**Step 6 — Persistence hook in `conversation.ts` (AC25–AC31, AC59, AC61)**

In both route handlers (`POST /conversation/message` and `POST /conversation/audio`), inside the `reply.raw.once('finish', …)` listener, after the existing `writeQueryLog` call (so order is: `writeQueryLog` → `insertSearchHistoryHook`):

```typescript
// F-WEB-HISTORY: persist to search_history if bearer present
const accountSub = request.accountId;   // set by actorResolver when bearer valid
// cross-model G-CRIT: skip text_too_long — a degenerate >500-char query with no
// nutritional result; persisting it would make it reappear in history on reload
// while staying an inline error live (W19). Skipping keeps the two coherent.
if (accountSub && capturedData && capturedData.intent !== 'text_too_long') {
  void (async () => {
    try {
      const accountId = await resolveAccountIdFromSub(prisma, accountSub, request.log);
      if (!accountId) return; // no accounts row yet — provisioning stays in /me
      await insertSearchHistory(prisma, {
        accountId,
        kind: 'text',   // 'voice' in /audio handler
        queryText: body.text,  // transcribedText in /audio handler
        resultJsonb: capturedData as object,
      });
      void pruneHistory(prisma, accountId).catch((err: unknown) => {
        request.log.error({ err }, 'F-WEB-HISTORY: pruneHistory failed');
      });
    } catch (err) {
      request.log.error({ err }, 'F-WEB-HISTORY: search_history insert failed');
    }
  })();
}
```

Key points:
- The `capturedData` closure variable is already typed as `ConversationMessageData | null` and is set before `reply.send()` in both route handlers (confirmed at `conversation.ts:130` and `:519`).
- `body.text` is available in the `/message` closure; `transcribedText` is the Whisper output in the `/audio` closure (confirmed at `conversation.ts:491`, where `transcribedText = transcription`).
- `request.accountId` is set by `actorResolver.ts:91` when the bearer JWT is valid (anonymous requests have `accountId === undefined`). The `if (accountSub && capturedData)` guard is sufficient — no new auth call needed inside the hook.
- The entire block is fire-and-forget (`void (async () => { … })()`), all errors swallowed and logged at `error` level. It NEVER throws into the `'finish'` listener.
- `reply.raw.once('finish', …)` fires after `reply.send()` has flushed — the core response is already sent to the client before any history insert runs. This is the same guarantee `writeQueryLog` relies on (confirmed at `conversation.ts:108`).
- Photo (`/analyze`) has NO hook — fork D3 is maintained.
- **`text_too_long` is SKIPPED** (guard `capturedData.intent !== 'text_too_long'`, cross-model G-CRIT) — it has no useful nutritional result and stays an inline error on the live path; not persisting it keeps live + history coherent.
- **`resolveAccountIdFromSub` throws on DB error**, but here it runs INSIDE the hook's `try/catch` (fire-and-forget) so the throw is swallowed + logged — this is the ONE place fail-open is correct (the request-serving routes let it propagate to a 500; cross-model X3).
- **Voice transcript echo (cross-model G-IMP/X2):** add an optional `transcribedText: z.string().optional()` to `ConversationMessageDataSchema` (`packages/shared/src/schemas/conversation.ts`) and populate it in the `/audio` handler from the existing `transcribedText` variable BEFORE `reply.send` (i.e. set it on `capturedData`). This (a) lets the web feed header show the real voice query (consistent with the persisted `query_text`), and (b) is `.optional()` so text responses + deploy-skew are unaffected. The persisted `result_jsonb` then also carries it (harmless). RED test: `/audio` 200 response `data.transcribedText` equals the transcript.

---

**Step 7 — Register in `app.ts`**

```typescript
import { historyRoutes } from './routes/history.js';
// ...
await app.register(historyRoutes, { prisma: prismaClient, config: cfg });
```

Place after the `authRoutes` registration line (`app.ts:156`).

---

#### Testing Strategy

**Integration tests (real PG :5433, NO Redis needed for history)**

All integration tests follow the pattern in `fWebTier.usageEndpoint.integration.test.ts`:
- `vi.mock('../../plugins/authBearer.js', …)` with `mockVerifyBearerJwt`.
- `buildApp({ config: testConfig, prisma, redis })` — redis is passed for `buildApp` signature compatibility but history routes do not use it.
- `beforeAll`: generate RSA keypair, pre-clean fixture rows, create fixture accounts/actors.
- `afterAll`: teardown in reverse FK order (`search_history` → `actors` → `accounts`).
- Fixture UUID prefix: `f8h00000-` (unique to F-WEB-HISTORY — no collision with `f7f00000-` used by F-WEB-TIER).

**`fWebHistory.migration.integration.test.ts`** — AC1–AC4:
- Verify `search_history` table columns via `information_schema.columns`.
- Verify index via `pg_indexes`.
- FK violation via `prisma.$executeRaw` expecting `.rejects.toThrow()`.
- CASCADE via account delete + count assert.

**`fWebHistory.getHistory.integration.test.ts`** — AC8–AC16:
- AC8: no bearer → 401.
- AC9: expired token (`mockVerifyBearerJwt.mockRejectedValueOnce(Object.assign(new Error('…'), { code: 'TOKEN_EXPIRED' }))`) → 401.
- AC10: valid bearer but NO `accounts` row for that `auth_user_id` → 200 `{ entries: [], nextCursor: null }` + assert `SELECT COUNT(*) FROM accounts WHERE auth_user_id = $sub` still 0.
- AC11: insert 15 rows directly via `prisma.$executeRaw`, call `GET /history?limit=10` → 10 entries, `nextCursor` non-null, newest-first.
- AC12: call again with `cursor=<nextCursor from AC11>` → 5 entries, `nextCursor: null`.
- AC13: `GET /history?limit=51` → 400 `VALIDATION_ERROR`.
- AC14: `GET /history?cursor=not-valid-base64-lol` → 400 `INVALID_CURSOR`.
- AC15: two accounts, entries in both, assert each only sees its own.
- AC16: seed a Redis key for the `queries` bucket, call `GET /history` 100×, assert the Redis key value unchanged.

**`fWebHistory.deleteHistory.integration.test.ts`** — AC17–AC24.

**`fWebHistory.persistenceHook.integration.test.ts`** — AC25–AC31, AC59, AC61:
- AC25: mock `processMessage` to resolve with a known `estimation` `ConversationMessageData`; call `POST /conversation/message` with a valid bearer; poll (up to 200ms) for the `search_history` row; assert `kind='text'`, `query_text=body.text`, `result_jsonb` matches.
- AC26: same for `POST /conversation/audio` with a mocked Whisper transcript.
- AC27: `POST /conversation/message` without bearer → assert 0 rows inserted.
- AC28: insert succeeds normally even when `insertSearchHistory` rejects (mock DB failure after `reply.send` by temporarily monkey-patching) → response is 200, error is logged.
- AC29: insert 500 rows, then fire one more `/conversation/message` → assert row count still 500.
- AC30: insert a row with `created_at = NOW() - INTERVAL '13 months'` via direct `prisma.$executeRaw`; fire one `/conversation/message`; assert old row is gone.
- AC31: delete account row → assert history gone (same as AC4 migration test, but in full round-trip form).
- AC59: for each intent shape (`estimation`, `comparison`, `contextSet`, `text_too_long`), insert via hook, read back via `GET /history`, parse each `resultData` with `ConversationMessageDataSchema.safeParse` and assert `success: true`.
- AC61: `POST /conversation/message` with `body.text` of 1500 chars (successful `text_too_long` response mocked) → row inserted, `SearchHistoryEntrySchema.parse(row)` succeeds (queryText max 2000).

**Unit tests (pure, no PG)**

`packages/shared/src/__tests__/schemas.history.test.ts` — AC5–AC7:
- AC5: `SearchHistoryKindSchema.parse('text')` succeeds; `parse('photo')` throws.
- AC6: `SearchHistoryEntrySchema.parse(validEntry)` succeeds; `parse({ kind:'text', … }) ` (missing `id`) throws.
- AC7: `HistoryPageSchema.parse({ entries: [], nextCursor: null })` succeeds; `parse({ entries: [], nextCursor: 123 })` fails.

**Mocking strategy:**
- `verifyBearerJwt` is always mocked in integration tests (module mock hoisted before `buildApp` import).
- `processMessage` and `callWhisperTranscription` are mocked in hook tests to return controlled `ConversationMessageData` shapes without a real OpenAI call.
- The `search_history` table is the real test DB (no mock). `prisma.$executeRaw` / `prisma.$queryRaw` hit real Postgres :5433.
- Redis (:6380) is a real instance for AC16; for all other history tests the Redis client is passed but not exercised by history code.

---

#### Key Patterns

- **Bearer gate in route (not middleware):** `GET /me/usage` (`auth.ts:415–423`) is the exact template — manual `verifyBearerJwt` call, no preHandler hook. Mirror this.
- **`request.accountId` = JWT `sub` = `auth_user_id` NOT `accounts.id`:** Always resolve `accounts.id` via `SELECT id FROM accounts WHERE auth_user_id = $sub::uuid`. Confirmed: `actorResolver.ts:91` sets `request.accountId = payload.sub`.
- **`reply.raw.once('finish', …)` for fire-and-forget:** Both conversation route handlers register this listener BEFORE `processMessage` runs (confirmed `conversation.ts:108, 454`) so it always fires even if the handler throws early. The persistence hook must follow the same registration order.
- **`capturedData` set before `reply.send`, read inside `'finish'` listener:** Confirmed in both handlers (`conversation.ts:130, 132` and `:519, 539`). The `if (!capturedData) return` guard is already the pattern inside `logQueryAfterReply`.
- **`transcribedText` for voice `query_text`:** Confirmed variable at `conversation.ts:450, 491` — it's the raw Whisper output (not truncated, not sliced). Use `transcribedText` directly (max 2000 via Whisper — whisper transcripts are always well under this; the validation schema allows 2000).
- **`void (async () => { try { … } catch (err) { request.log.error(…) } })()`:** Pattern for fire-and-forget inside `'finish'` listener. The `void` prefix satisfies `@typescript-eslint/no-floating-promises`.
- **Migration format:** single `.sql` file, comment header, rollback instruction in the comment (mirrors `20260526130000_add_account_tier/migration.sql`). Never `prisma migrate dev`. Apply with `prisma migrate deploy`.
- **`fastifyPlugin` wrap:** All route plugins use `export const historyRoutes = fastifyPlugin(historyRoutesPlugin)` (mirrors `conversation.ts:711`) so errors route to the global error handler.

---

#### Risks and Assumptions for `/review-plan`

1. **`reply.raw.once('finish', …)` fires after streaming errors.** If Fastify internally aborts the response (e.g. a serialization error after `reply.send`), does the `'finish'` event still fire? Answer: yes — Node.js `http.ServerResponse` emits `'finish'` whenever the response stream is closed, including on abrupt close. But `capturedData` will be non-null only when `processMessage` succeeded AND `reply.send({ success: true, data })` was called — the `if (!capturedData)` guard prevents spurious inserts on error paths. Risk is LOW.

2. **`/audio` Whisper transcript as `query_text`:** `transcribedText` is set only after the hallucination guard passes (`conversation.ts:491`). If Whisper fails or returns empty, `transcribedText` remains `null` and the guard `if (accountSub && capturedData)` short-circuits (since `capturedData` is also null on error paths — `processMessage` is never reached). Risk is NONE.

3. **Concurrent insert + prune race (AC29 soft cap):** Two simultaneous requests may insert 501 rows transiently. The spec explicitly accepts this as a soft cap. The integration test for AC29 serializes the 501st insert — acceptable for test purposes. Confirmed by spec "soft cap" note.

4. **`accounts.id` resolution latency in `'finish'` hook:** `resolveAccountIdFromSub` does a `SELECT id FROM accounts WHERE auth_user_id = $sub::uuid`. This is an indexed unique lookup (confirmed: `@unique @map("auth_user_id")` at `schema.prisma:492`). Negligible. Risk is NONE.

5. **`INVALID_CURSOR` error code not yet in `errorHandler.ts`:** Confirmed by grep — the code does not exist in the handler. It MUST be added (Step 4) before the route can return a properly shaped 400. If missed, Fastify's default error handler returns a 500.

6. **`config` in `historyRoutes` plugin options:** `GET /me/usage` inline-calls `resolveJwksUrl(config)` where `config` is closed over from the outer `authRoutes` plugin scope. `historyRoutes` is a separate plugin file and does not close over `config`. Options must include `config: Config` (added to `HistoryPluginOptions`) and `buildApp` must pass `cfg`.

---

---

### Frontend Plan

> Generated by `frontend-planner` 2026-05-27. Covers Fase 1 (session transcript), Fase 2-3 (persisted history), and Fase C (telemetry). All steps are TDD: write failing tests first (RED), implement minimum code (GREEN), refactor.

---

#### Existing Code to Reuse

| Asset | Location | How it is reused |
|---|---|---|
| `HablarShell` | `packages/web/src/components/HablarShell.tsx` | Refactored in Phase A: singleton `results`/`photoResults`/`voiceError` state replaced with `entries: TranscriptEntryData[]`; `ResultsArea` replaced by `TranscriptFeed`; all existing behavior preserved |
| `ResultsArea` logic | `packages/web/src/components/ResultsArea.tsx` | Intent-switching logic (switch on `results.intent`) extracted and reused inside `TranscriptEntry`'s result-body slot unchanged; `ResultsArea` component itself removed from HablarShell but its logic survives |
| `NutritionCard` | `packages/web/src/components/NutritionCard.tsx` | Rendered unchanged inside each `TranscriptEntry` result body (estimation, comparison, follow_up, reverse_search) |
| `ContextConfirmation` | `packages/web/src/components/ContextConfirmation.tsx` | Rendered unchanged inside `TranscriptEntry` for `context_set` intent |
| `MenuDishList` / `MenuDishItem` | `packages/web/src/components/MenuDishList.tsx`, `MenuDishItem.tsx` | Rendered unchanged inside `TranscriptEntry` for multi-dish photo results (session-only) |
| `ErrorState` | `packages/web/src/components/ErrorState.tsx` | Reused inside each `TranscriptEntry`'s error state (per-entry inline error) |
| `EmptyState` | `packages/web/src/components/EmptyState.tsx` | Shown in `TranscriptFeed` when anonymous user has zero entries (unchanged — same component, same prompt) |
| `LoadingState` | `packages/web/src/components/LoadingState.tsx` | Used as shimmer inside `TranscriptEntry` while `isLoading: true` (text/voice). Photo shimmer uses `LoadingState` with `mode` prop already wired. |
| `RateLimitNudge` | `packages/web/src/components/RateLimitNudge.tsx` | Unchanged; `showRateLimitNudge` still controls it; nudge hierarchy (W20) is enforced by `HablarShell` passing `showPersistenceNudge` as `false` when this is true |
| `useAuth` | `packages/web/src/components/useAuth.ts` (re-exported) | `{ user, session }` — `user !== null` drives authenticated branch; `session?.access_token` is the bearer passed to `useSearchHistory` |
| `trackEvent` / `MetricEvent` | `packages/web/src/lib/metrics.ts` | All 7 new `history_*` events added to the union and wired in Phase C |
| `getMe` / `getUsage` pattern | `packages/web/src/lib/apiClient.ts:431–540` | Template for new `getHistory`, `deleteHistoryEntry`, `clearHistory` functions: same bearer attach + `safeParse` + `ApiError` throw pattern |
| `ApiError` | `packages/web/src/lib/apiClient.ts:47` | Used in `getHistory` / `deleteHistoryEntry` / `clearHistory` and in tests |
| `SearchHistoryEntrySchema`, `HistoryPageSchema` | `packages/shared/src/schemas/history.ts` (already exists, confirmed) | Used in `getHistory` to `safeParse` each entry (skip drifted payloads, cross-model C2) and to parse the page envelope |
| `ConversationMessageData` type | `packages/shared/src/schemas/conversation.ts` | Type for `result` field in `TranscriptEntryData`; already imported via `@foodxplorer/shared` |
| `jest.setup.ts` | `packages/web/jest.setup.ts` | `crypto.randomUUID` polyfill already present → used for session-entry `entryId` generation; no change needed |
| Existing `HablarShell.*.test.tsx` mock pattern | `packages/web/src/__tests__/components/HablarShell.*.test.tsx` | All new test files must follow the same module-mock-first pattern: `jest.mock('../../hooks/useAuth', …)`, `jest.mock('../../lib/apiClient', …)`, etc. New mocks for `useSearchHistory` and `TranscriptFeed` added in regression tests |

---

#### Files to Create

| File | Purpose |
|---|---|
| `packages/web/src/types/history.ts` | `TranscriptEntryData` interface (client-only, not a Zod schema). Central definition referenced by `HablarShell`, `TranscriptFeed`, `TranscriptEntry`, `useSearchHistory`. |
| `packages/web/src/components/TranscriptFeed.tsx` | `'use client'` — Feed container (`role="feed"`). Renders `HistoryLoadMoreSentinel`, `TranscriptEntry[]`, `HistoryPersistenceNudge`, `HistoryEmptyState`, `ClearHistoryButton`. Manages auto-scroll ref. |
| `packages/web/src/components/TranscriptEntry.tsx` | `'use client'` — Single query+result pair. Renders query echo header (timestamp, modality icon, "Guardado" badge, delete button) + result body (existing cards or shimmer or error). |
| `packages/web/src/components/DeleteEntryButton.tsx` | `'use client'` — Trash icon + inline confirm row (5s auto-revert via `setTimeout`). Escape key reverts to idle. |
| `packages/web/src/components/ClearHistoryButton.tsx` | `'use client'` — "Borrar todo el historial" text-link trigger + modal `alertdialog`. Focus trap (hand-rolled with `useRef` on first/last focusable; no external library). Initial focus on Cancel. |
| `packages/web/src/components/HistoryPersistenceNudge.tsx` | `'use client'` — Inline feed card nudging anonymous users to register (≥2 entries). Dismiss × button. Fires `history_persistence_nudge_shown` on mount, `history_persistence_nudge_cta` on CTA click, `history_persistence_nudge_dismissed` on dismiss. |
| `packages/web/src/components/HistoryEmptyState.tsx` | Server Component (no `'use client'`). Magnifier icon + "Aún no tienes historial" copy per W22. Shown only for logged-in users with 0 entries. |
| `packages/web/src/components/HistoryLoadMoreSentinel.tsx` | `'use client'` — Invisible `div` (`h-px w-full`) at the top of `TranscriptFeed`. Uses `IntersectionObserver` to fire `onLoadMore`. Shows keyboard-accessible "Cargar más historial" button (`sr-only focus-not-sr-only`). Unmounts observer when `hasMoreHistory: false`. |
| `packages/web/src/hooks/useSearchHistory.ts` | `'use client'` (hook) — Encapsulates `GET /history` mount fetch, cursor state, `loadMore`, `deleteEntry`, `clearAll`. Returns `{ persistedEntries, hasMoreHistory, isLoadingMore, loadMore, deleteEntry, clearAll }`. No-op when `authToken === null`. |
| `packages/web/src/__tests__/components/TranscriptFeed.test.tsx` | RTL tests: AC32, AC33, AC34, AC35, AC36, AC37, AC45, AC46, AC47, AC60. |
| `packages/web/src/__tests__/components/TranscriptEntry.test.tsx` | RTL tests: AC33, AC35, AC60 (per-intent re-render from `resultData`). |
| `packages/web/src/__tests__/components/DeleteEntryButton.test.tsx` | RTL tests: AC41, AC42, AC50. |
| `packages/web/src/__tests__/components/ClearHistoryButton.test.tsx` | RTL tests: AC43, AC44, AC51. |
| `packages/web/src/__tests__/components/HistoryPersistenceNudge.test.tsx` | RTL tests: AC37 (nudge conditions), AC52. |
| `packages/web/src/__tests__/hooks/useSearchHistory.test.ts` | RTL hook tests (via `renderHook`): AC38, AC39, AC40, AC48, AC49. |
| `packages/web/src/__tests__/components/HablarShell.fWebHistory.test.tsx` | RTL regression tests: validates that existing text/photo/voice flows continue working after the singleton→feed migration; also AC54 smoke. |

---

#### Files to Modify

| File | Change |
|---|---|
| `packages/web/src/components/HablarShell.tsx` | Replace singleton state (`results`, `photoResults`, `error`, `inlineError`, `lastQuery`, `isLoading`, `photoMode`, `voiceError`) with `entries: TranscriptEntryData[]` feed; add `useSearchHistory` call (authenticated branch); wire `TranscriptFeed` replacing `ResultsArea`; preserve `usageRefreshRef` / `UsageMeter` / `RateLimitNudge` / `VoiceOverlay` / `ConversationInput` unchanged; add nudge-hierarchy logic for `showPersistenceNudge` |
| `packages/web/src/lib/apiClient.ts` | Add `getHistory(cursor?, limit?)`, `deleteHistoryEntry(id)`, `clearHistory()` functions following the `getUsage` pattern (bearer from `authToken` singleton, `HistoryPageSchema.safeParse` per-entry in `getHistory`, throw `ApiError` on non-2xx) |
| `packages/web/src/lib/metrics.ts` | Add 7 new event names to `MetricEvent` union: `history_loaded`, `history_load_more`, `history_entry_deleted`, `history_cleared`, `history_persistence_nudge_shown`, `history_persistence_nudge_cta`, `history_persistence_nudge_dismissed`. Add corresponding payload fields to `MetricPayload` (`count: number`, `page: number`, `entryId: string`, `inputMode: 'text' \| 'voice'`). Add `case` branches in the `trackEvent` `switch` (payload-only telemetry, no counter mutation — same pattern as `auth_login_start`). |
| `packages/web/jest.setup.ts` | Add `IntersectionObserver` stub (class with `observe`, `unobserve`, `disconnect` as `jest.fn()`, `triggerEntry` test helper) — required for `HistoryLoadMoreSentinel` tests. Also add `ResizeObserver` stub if not present. |

---

#### Implementation Order

Follow TDD strictly: write the failing test, implement the minimum, confirm green, then proceed.

**Phase A — Session transcript refactor (no API calls; everyone including anonymous)**

1. **`packages/web/src/types/history.ts`** — Define `TranscriptEntryData` interface. Verify it imports `ConversationMessageData` from `@foodxplorer/shared`. (AC33, AC35 type-checks depend on this.)

2. **`packages/web/src/lib/metrics.ts`** — Add the 7 `history_*` event names + payload fields + `switch` cases. Run `tsc --noEmit` to verify union exhaustiveness. (AC48–AC52 tests will import these; add here early so the union is complete for all phases.)

3. **`packages/web/src/components/HistoryEmptyState.tsx`** — Trivial Server Component. No test file needed beyond a smoke snapshot (included in `TranscriptFeed.test.tsx`).

4. **`packages/web/src/components/DeleteEntryButton.tsx`** + **`DeleteEntryButton.test.tsx`** — Isolated primitive. Write tests (RED): idle→confirming toggle, Cancel reverts, Confirm calls `onConfirm(entryId)`, 5s auto-revert (`jest.useFakeTimers`), Escape key. Implement (GREEN). (AC41, AC42, AC50)

5. **`packages/web/src/components/TranscriptEntry.tsx`** + **`TranscriptEntry.test.tsx`** — Write tests (RED): `role="article"`, `aria-label`, shimmer when `isLoading`, result body for each intent from `resultData` (estimation/comparison/contextSet/text_too_long — AC60), "Guardado" badge only when `isPersisted`, modality icon, error inline. Implement (GREEN). Mock child card components as data-testid stubs in entry-level tests to keep them focused. (AC33, AC35, AC60)

6. **`packages/web/src/components/TranscriptFeed.tsx`** + **`TranscriptFeed.test.tsx`** — Write tests (RED): `role="feed"`, `aria-label`, renders entries in order, `EmptyState` when anonymous+empty, `HistoryEmptyState` when authenticated+empty, `HistoryPersistenceNudge` shown only when `showPersistenceNudge`, `ClearHistoryButton` shown when `isAuthenticated && has persisted entries`, auto-scroll ref behavior (stub `scrollTo` on container ref). Implement (GREEN). (AC32, AC34, AC37, AC45, AC46, AC47)

7. **`packages/web/src/components/HablarShell.tsx`** — **The central refactor.** Write `HablarShell.fWebHistory.test.tsx` first (RED): submit a text query, assert two entries appear; retry on error adds new entry; photo result appears in feed; voice result appears in feed; `usageRefreshRef` still fires on success; `RateLimitNudge` still appears on 429. Implement (GREEN):
   - Replace `results`, `photoResults`, `error`, `isLoading`, `photoMode`, `voiceError`, `lastQuery`, `inlineError` with `entries: TranscriptEntryData[]` and `nudgeDismissed: boolean`.
   - `executeQuery`: create a pending entry with `crypto.randomUUID()` + `isLoading: true`; on success, update entry by `entryId` with `result`; on error, set `error` on the entry. On retry (`handleRetry`): append a NEW entry (not mutate), same `queryText`.
   - `executePhotoAnalysis`: same entry-append pattern for photo (`inputMode: 'photo'`).
   - Voice: the `voiceSession` effect that previously called `setResults(data)` now appends a new entry.
   - Replace `<ResultsArea …/>` with `<TranscriptFeed entries={entries} … />`.
   - Preserve: `usageRefreshRef`, `usageRefreshRef.current?.()` calls, `showRateLimitNudge`, `VoiceOverlay`, `ConversationInput`, header auth slot — all unchanged.
   - `showPersistenceNudge = entries.length >= 2 && !user && !showRateLimitNudge && !nudgeDismissed`.
   - Add `useSearchHistory` call — **no-op at this phase** (will be implemented in Phase B): `const { persistedEntries } = useSearchHistory({ authToken: session?.access_token ?? null })`.
   - Prepend `persistedEntries` to feed state on mount when they arrive (Phase B wires this).

**Phase B — Persisted history (logged-in only)**

8. **`packages/web/src/lib/apiClient.ts`** — Add `getHistory`, `deleteHistoryEntry`, `clearHistory`. Unit-test these in the existing test pattern (mock `fetch` directly in the test file). (Tested implicitly via `useSearchHistory.test.ts` in step 9.)

9. **`packages/web/src/hooks/useSearchHistory.ts`** + **`useSearchHistory.test.ts`** — Write tests (RED) using `renderHook`:
   - `authToken === null` → returns empty state, no fetch.
   - `authToken` provided → fires `GET /history?limit=10` on mount; maps `SearchHistoryEntry` → `TranscriptEntryData` (set `isPersisted: true`, `entryId = entry.id`, `timestamp = new Date(entry.createdAt)`); reverses the API newest-first order to oldest-first before returning; returns `{ persistedEntries, hasMoreHistory, isLoadingMore, loadMore, deleteEntry, clearAll }`.
   - `loadMore`: fires `GET /history?cursor=<nextCursor>&limit=10`; prepends (older entries go before existing); stops when `nextCursor === null`.
   - `deleteEntry(id)`: calls `DELETE /history/{id}`; removes entry from local state optimistically.
   - `clearAll`: calls `DELETE /history`; clears `persistedEntries`.
   - Deploy-skew: any thrown `ApiError` from the initial fetch is caught and swallowed; `persistedEntries` remains `[]`.
   - Mock `fetch` (or mock `getHistory`/`deleteHistoryEntry`/`clearHistory` from `apiClient`) in the test.
   - Implement (GREEN). (AC38, AC39, AC40, AC48, AC49)

10. **`packages/web/src/components/HistoryLoadMoreSentinel.tsx`** + tests in `TranscriptFeed.test.tsx` — Uses `IntersectionObserver`. In tests, use the jest.setup.ts stub added in step 0-setup: trigger the stub's callback manually to simulate viewport entry. Keyboard fallback button (`sr-only` → `focus-not-sr-only`) also tested. (AC39, AC40)

11. **`packages/web/src/components/ClearHistoryButton.tsx`** + **`ClearHistoryButton.test.tsx`** — Focus trap: track first/last focusable ref; `Tab`/`Shift+Tab` cycle; Escape closes. Write tests (RED): dialog opens, Cancel closes without calling `onConfirm`, Confirm calls `onConfirm`, `role="alertdialog"`, `aria-modal`, focus on Cancel on open, Escape closes. Implement (GREEN). (AC43, AC44, AC51)

12. **`packages/web/src/components/HistoryPersistenceNudge.tsx`** + **`HistoryPersistenceNudge.test.tsx`** — Write tests (RED): renders when `showPersistenceNudge`, fires `history_persistence_nudge_shown` on mount, `history_persistence_nudge_cta` on CTA click, `history_persistence_nudge_dismissed` on dismiss, calls `onDismiss`. Implement (GREEN). (AC37, AC52)

13. **Wire `useSearchHistory` into `HablarShell.tsx`** — `persistedEntries` from the hook are merged into the `entries` state on initial resolve (prepended; they are already oldest-first). `onDeleteEntry` calls `useSearchHistory.deleteEntry` then removes the entry from `entries`. `onClearAll` calls `useSearchHistory.clearAll` then clears all entries with `isPersisted: true`. Update `HablarShell.fWebHistory.test.tsx` regression suite (add mock for `useSearchHistory`). (AC38, AC45)

**Phase C — Telemetry**

14. **Wire `history_*` events** — Already imported in each component. Verify each event fires in the correct component (already coded in steps 4–13):
    - `history_loaded` in `useSearchHistory` after initial fetch resolves (with `{ count: persistedEntries.length }`).
    - `history_load_more` in `useSearchHistory.loadMore` (with `{ page: currentPage }`; `currentPage` is an incrementing ref).
    - `history_entry_deleted` in `DeleteEntryButton.onConfirm` (with `{ entryId, inputMode }`).
    - `history_cleared` in `ClearHistoryButton.onConfirm`.
    - `history_persistence_nudge_shown` / `_cta` / `_dismissed` in `HistoryPersistenceNudge`.
    Telemetry is covered by tests in steps 4, 9, and 12; this step is a cross-check. (AC48–AC52)

**Phase D — Final checks**

15. Run full web test suite: `npm test --workspace=packages/web`. All new and pre-existing tests must pass. (AC54)
16. Run `tsc --noEmit` across all three packages. (AC53)

---

#### Testing Strategy

**Test files to create:**

| Test file | AC coverage |
|---|---|
| `packages/web/src/__tests__/components/TranscriptFeed.test.tsx` | AC32, AC34, AC37, AC45, AC46, AC47 |
| `packages/web/src/__tests__/components/TranscriptEntry.test.tsx` | AC33, AC35, AC60 |
| `packages/web/src/__tests__/components/DeleteEntryButton.test.tsx` | AC41, AC42, AC50 |
| `packages/web/src/__tests__/components/ClearHistoryButton.test.tsx` | AC43, AC44, AC51 |
| `packages/web/src/__tests__/components/HistoryPersistenceNudge.test.tsx` | AC37, AC52 |
| `packages/web/src/__tests__/hooks/useSearchHistory.test.ts` | AC38, AC39, AC40, AC48, AC49 |
| `packages/web/src/__tests__/components/HablarShell.fWebHistory.test.tsx` | AC36, AC47, AC54 (regression) |

**Key test scenarios:**

- **Phase A regression (HablarShell.fWebHistory):** Mock `useSearchHistory` to return empty/no-op state. Submit text query → assert two entries in feed (not one replacing the other). Submit photo → entry appears with camera icon. Voice success → entry appended (mock `useVoiceSession` done state). Error → error entry; retry → new entry below. `usageRefreshRef.current?.()` fires on success (AC-BUG-001 regression). `RateLimitNudge` appears on 429 for anonymous user.

- **AC36 — retry adds new entry:** Mock `sendMessage` to reject once; user submits query A → error entry appears. Retry → new entry with same query A below (total 2 entries); first entry remains in error state.

- **AC39/AC40 — sentinel IntersectionObserver:** After adding the IO stub to `jest.setup.ts`, render `TranscriptFeed` with `hasMoreHistory: true`. Manually trigger the IO callback → assert `onLoadMore` called. Set `hasMoreHistory: false` → assert IO observer disconnected.

- **AC60 — persisted entry re-renders correctly:** For each intent (`estimation`, `comparison`, `context_set`, `text_too_long`), construct a `TranscriptEntryData` with `isPersisted: true` and a complete `resultData` object. Render `TranscriptEntry` → assert the correct result card appears (NutritionCard for estimation, dual NutritionCards for comparison, ContextConfirmation for context_set, inline error copy for text_too_long via inlineError path in entry).

- **AC42 — 5s auto-revert:** Use `jest.useFakeTimers()`. Click trash icon → confirm row appears. Advance timer 5000ms → trash icon reappears.

- **AC44 — focus trap:** Render `ClearHistoryButton`. Open dialog. Assert focus is on Cancel. `Tab` → focus moves to Confirm. `Tab` → focus wraps to Cancel. `Shift+Tab` → focus moves to Confirm. `Escape` → dialog closes, focus returns to trigger.

- **useSearchHistory — skip drifted entry (cross-model C2):** Mock `GET /history` to return one valid entry and one whose `resultData` does not match `ConversationMessageDataSchema` (e.g. `resultData: { intent: 'unknown_future_intent' }`). Assert hook returns only the 1 valid entry (drifted one is silently skipped).

**Mocking strategy:**

- `jest.mock('../../hooks/useAuth', …)` — override `user` to `null` (anonymous) or a mock User object (authenticated) per test.
- `jest.mock('../../lib/apiClient', …)` — stub `getHistory`, `deleteHistoryEntry`, `clearHistory`, `sendMessage`, `setAuthToken`. Each test controls return values via `mockResolvedValueOnce`.
- `jest.mock('../../hooks/useSearchHistory', …)` in HablarShell tests — returns `{ persistedEntries: [], hasMoreHistory: false, isLoadingMore: false, loadMore: jest.fn(), deleteEntry: jest.fn(), clearAll: jest.fn() }` by default.
- `IntersectionObserver` — global stub in `jest.setup.ts`: class with `jest.fn()` methods + a module-level reference to the last instance so tests can call `mockObserver.trigger(mockEntry)`. Pattern: store instance in `globalThis._lastIntersectionObserver = this` inside constructor.
- `jest.useFakeTimers()` — in `DeleteEntryButton.test.tsx` for the 5s auto-revert AC42.
- Scroll testing: `Object.defineProperty(container, 'scrollTop', ...)` + spy on `container.scrollTo` for auto-scroll assertions (jsdom does not implement real scroll geometry; assert `scrollTo` was called with `{ top: container.scrollHeight, behavior: 'smooth' }`).

---

#### Key Patterns

- **Singleton→feed migration (the core risk):** `results: ConversationMessageData | null` → `entries: TranscriptEntryData[]`. The migration must be done in one atomic HablarShell edit (not incrementally) to avoid a half-refactored state. The new `executeQuery` appends an entry with `entryId = crypto.randomUUID()` and `isLoading: true`, then updates that entry by `entryId` on settle. The update pattern is: `setEntries(prev => prev.map(e => e.entryId === id ? { ...e, isLoading: false, result: data } : e))`.

- **Voice path + transcript echo (cross-model G-IMP/X2):** the voice success effect (HablarShell.tsx:138–160) currently calls `setResults(data)`. The current `ConversationMessageData` does NOT echo the query text, so the feed header had no real text for voice. **Resolution: add an optional `transcribedText` field to `ConversationMessageDataSchema` (shared) and have `/conversation/audio` populate it** (the backend already has the `transcribedText` variable — see Backend Plan; it's the same value used for the persisted `query_text`, so live feed and persisted history are consistent). After migration: while the voice query is in-flight, the optimistic entry uses placeholder `queryText: 'Consulta por voz…'`; on settle, `appendEntry`/update sets `queryText: data.transcribedText ?? 'Consulta por voz'`, `inputMode: 'voice'`, `result: data`. For text queries the client still echoes `body.text` directly. (No reliance on `useVoiceSession` internals.)

- **Photo results:** `executePhotoAnalysis` previously set `setPhotoResults(data)` (a `MenuAnalysisData`). After migration it appends a `TranscriptEntry` with `inputMode: 'photo'` and `result: null` (photo results use a different data type — `MenuAnalysisData` not `ConversationMessageData`). The `TranscriptEntry` result body for photo entries renders `MenuDishList` or single-`NutritionCard` using the `photoData` field on `TranscriptEntryData` (not `result`). Add `photoData?: MenuAnalysisData` to `TranscriptEntryData`.

- **`text_too_long` intent (cross-model G-CRIT resolution):** stays as `inlineError` on the live path (W19: "Inline error (text_too_long, photo validation): these remain in `ConversationInput` as before") — the guard `if (data.intent === 'text_too_long') { setInlineError(…); return; }` is UNCHANGED, no `TranscriptEntry` is created. **To keep this coherent with persistence, the BACKEND persistence hook SKIPS `text_too_long`** (a degenerate >500-char query with no nutritional result — not worth revisiting; see Backend Plan). So `text_too_long` never becomes a `TranscriptEntry` — neither live nor reloaded from history — eliminating the "disappears live, reappears on reload" inconsistency Gemini flagged. `TranscriptEntry` therefore does NOT need a `text_too_long` render branch (AC60 covers `estimation`/`comparison`/`contextSet` only).

- **`useId()` for dialog IDs:** `ClearHistoryButton` uses `useId()` for `aria-labelledby` on the dialog — same pattern as `NutritionCard.tsx:28`. Do not hardcode `"clear-history-dialog-title"`.

- **Auto-scroll logic:** Keep a `feedRef = useRef<HTMLDivElement>(null)` on the `TranscriptFeed` container. After each entry is added (via `useEffect` on `entries.length`): check `feedRef.current.scrollTop + feedRef.current.clientHeight >= feedRef.current.scrollHeight - 100`. If yes, call `scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' })`. On initial mount with persisted entries, scroll to bottom instantly (`behavior: 'instant'`).

- **Scroll position preservation on load-more:** Before prepending older entries to the feed, record `feedRef.current.scrollTop`. After the DOM updates (in a `useEffect`), restore: `feedRef.current.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight)`. This prevents the feed from jumping when entries are prepended above the user's position.

- **`getHistory` return contract (cross-model X1 — per-entry parse, NOT whole-page):** parsing `data` with `HistoryPageSchema.safeParse` would reject the WHOLE page if a single `entries[]` item has a drifted `resultData` (the schema requires every item valid) — defeating the per-entry skip. Instead: first parse a LOOSE envelope `z.object({ entries: z.array(z.unknown()), nextCursor: z.string().nullable() })`. On envelope failure → throw `ApiError('MALFORMED_RESPONSE')` (→ `useSearchHistory` falls back to session-only). Then `SearchHistoryEntrySchema.safeParse(entry)` for EACH entry, skipping failures (cross-model C2 drift tolerance). Returns `{ entries: TranscriptEntryData[], nextCursor }` from the valid entries only. (Do NOT use `HistoryPageSchema` for the page parse — it remains the canonical full-page TYPE/contract, but the web opts into lenient per-entry parsing.)

- **No proxy for `/history`:** `GET /history`, `DELETE /history`, `DELETE /history/{id}` call `NEXT_PUBLIC_API_URL` directly (same as `sendMessage`, `getUsage`, not via Next.js route handler like `sendPhotoAnalysis`). Confirmed: photo analysis uses `/api/analyze` proxy; history does not need a proxy (no private API key, bearer-only auth like `getUsage`).

- **`entryId` for session-only entries:** Use `crypto.randomUUID()` (polyfilled in `jest.setup.ts:184`). For persisted entries from the API, `entryId = entry.id` (the `search_history` UUID).

- **`isPersisted` and delete affordance:** Only entries with `isPersisted: true` render `DeleteEntryButton` and participate in `DELETE /history/{id}`. Session-only entries (including all photo entries) have no server-side ID and cannot be deleted via the API. The `×` dismiss on session-only entries can optionally remove the entry from local state only (YAGNI — not in AC scope; do not implement unless trivial).

---

#### Ordered Step List with AC IDs

| Step | Files | ACs |
|---|---|---|
| 1 | `src/types/history.ts` | Type-only (prerequisite for all) |
| 2 | `src/lib/metrics.ts` | Prerequisite for AC48–AC52 |
| 3 | `src/components/HistoryEmptyState.tsx` | AC45, AC46 (rendered by TranscriptFeed) |
| 4 | `src/components/DeleteEntryButton.tsx` + test | AC41, AC42, AC50 |
| 5 | `src/components/TranscriptEntry.tsx` + test | AC33, AC35, AC60 |
| 6 | `src/components/TranscriptFeed.tsx` + test | AC32, AC34, AC37, AC45, AC46, AC47 |
| 7 | `src/components/HablarShell.tsx` refactor + regression test | AC32–AC37, AC47, AC54 |
| 8 | `src/lib/apiClient.ts` (add 3 functions) | Prerequisite for step 9 |
| 9 | `src/hooks/useSearchHistory.ts` + test | AC38, AC39, AC40, AC48, AC49 |
| 10 | `src/components/HistoryLoadMoreSentinel.tsx` (+ jest.setup IO stub) | AC39, AC40 |
| 11 | `src/components/ClearHistoryButton.tsx` + test | AC43, AC44, AC51 |
| 12 | `src/components/HistoryPersistenceNudge.tsx` + test | AC37, AC52 |
| 13 | Wire `useSearchHistory` into `HablarShell.tsx` | AC38, AC45 |
| 14 | Telemetry cross-check (verify AC48–AC52 pass) | AC48–AC52 |
| 15 | Full test suite + `tsc --noEmit` | AC53, AC54 |

---

### Verification commands run

- `Read: packages/web/src/components/HablarShell.tsx:33–50` → confirmed singleton state: `results: ConversationMessageData | null`, `error: string | null`, `inlineError: string | null`, `lastQuery: string`, `isLoading: boolean`, `photoMode: 'idle' | 'analyzing'`, `photoResults: MenuAnalysisData | null`, `voiceError: VoiceErrorCode | null` — ALL 8 of these are replaced by `entries: TranscriptEntryData[]` in the migration; `inlineError` moves to `ConversationInput` prop (already wired that way).
- `Read: packages/web/src/components/HablarShell.tsx:138–160` → confirmed voice success effect calls `setResults(data)` + `setPhotoResults(null)` + `setError(null)` + `setInlineError(null)` → migration must convert this to an `appendEntry` call with `inputMode: 'voice'`.
- `Read: packages/web/src/components/HablarShell.tsx:506–607` → confirmed `<ResultsArea …/>` is the target for replacement with `<TranscriptFeed …/>`; `<RateLimitNudge>` is a sibling BELOW `ResultsArea` (not inside it) → must remain a sibling below `TranscriptFeed`; `<ConversationInput>` and `<VoiceOverlay>` are unchanged siblings.
- `Read: packages/web/src/components/HablarShell.tsx:79` → confirmed `usageRefreshRef = useRef<(() => void) | null>(null)` and `usageRefreshRef.current?.()` called after text success (line 272), photo success (line 393), voice success (line 149) → migration must preserve all three call sites.
- `Read: packages/web/src/components/ResultsArea.tsx:1–326` → confirmed `ResultsArea` is pure presentational (no `'use client'`, no hooks), renders all intent cases via switch; the intent-switch logic is extracted verbatim into `TranscriptEntry`'s result-body rendering; the `CardGrid` layout helper (`flex-1 overflow-y-auto px-4 pb-24 pt-4`) is adapted (remove `pb-24`, add `pt-3`) per W16 entry spacing.
- `Read: packages/web/src/lib/apiClient.ts:431–540` → confirmed `getMe`/`getUsage` pattern: bearer via `authToken` singleton, JSON parse, `safeParse` with schema, throw `ApiError` on failure; `getHistory`/`deleteHistoryEntry`/`clearHistory` follow exact same pattern.
- `Read: packages/web/src/lib/apiClient.ts:32` → confirmed `authToken` module-level singleton; `getHistory` reads it directly (same as `getMe`/`getUsage`) — no need to pass bearer explicitly from `useSearchHistory`.
- `Read: packages/web/src/lib/metrics.ts:13–39` → confirmed `MetricEvent` union currently has 19 event names; 7 new `history_*` events must be added; the `switch` in `trackEvent` has no exhaustiveness check but the union type will catch typos at compile time.
- `Grep: "history_loaded|history_load_more|history_entry_deleted|history_cleared|history_persistence_nudge" in packages/web/src/lib/metrics.ts` → no output → none of the 7 new events exist yet → must add all 7 in Step 2.
- `Read: packages/shared/src/schemas/history.ts:59–109` → confirmed `SearchHistoryEntrySchema` fields: `id`, `kind`, `queryText`, `resultData` (typed as `ConversationMessageDataSchema`), `createdAt` (ISO string); `HistoryPageSchema` has `entries` array + `nextCursor: string | null`; per-entry `safeParse` skip pattern for cross-model C2 confirmed in schema comments.
- `Grep: "getHistory|deleteHistoryEntry|clearHistory|HistoryPageSchema" in packages/web/src/` → no output → none of the 3 apiClient functions exist yet → must create all 3 in Step 8.
- `Grep: "useSearchHistory|TranscriptFeed|TranscriptEntry|TranscriptEntryData|HistoryPersistenceNudge" in packages/web/src/components/HablarShell.tsx` → no output → Phase A/B wiring not yet in HablarShell → Steps 7 and 13 add it.
- `Read: packages/web/src/components/AuthProvider.tsx:29–35` → confirmed `AuthContextValue` shape: `{ user: User | null, session: Session | null, account: Account | null, loading: boolean, ... }`; `useAuth()` returns this; `session?.access_token` is the bearer for `useSearchHistory({ authToken: session?.access_token ?? null })`.
- `Read: packages/web/jest.setup.ts:182–190` → confirmed `crypto.randomUUID` polyfill present for jsdom (via `webcrypto`); confirmed `IntersectionObserver` is NOT stubbed → must add stub in Step 10 (before `HistoryLoadMoreSentinel` tests).
- `Grep: "IntersectionObserver|ResizeObserver" in packages/web/jest.setup.ts` → no output → neither stubbed → `IntersectionObserver` stub required for sentinel tests.
- `Read: packages/web/src/__tests__/components/HablarShell.fWebTier.test.tsx:1–110` → confirmed module-mock pattern: `jest.mock('../../hooks/useAuth', …)` with overridable `mockUseAuth`, `jest.mock('../../lib/apiClient', …)` with inline `ApiError` class replica, `jest.mock('../../lib/metrics', …)` → all new test files must follow this exact pattern.
- `Read: packages/web/jest.config.js` → confirmed `testEnvironment: 'jsdom'`, `setupFilesAfterEnv: ['<rootDir>/jest.setup.ts']`, moduleNameMapper strips `.js` and resolves `@foodxplorer/shared` → no config changes needed.
- `Grep: "useId" in packages/web/src/components/NutritionCard.tsx:28` → confirmed `useId()` pattern for `aria-labelledby`; `ClearHistoryButton` must use same pattern for dialog title ID.
- `Bash: ls packages/web/src/components/` → confirmed no `TranscriptFeed.tsx`, `TranscriptEntry.tsx`, `DeleteEntryButton.tsx`, `ClearHistoryButton.tsx`, `HistoryPersistenceNudge.tsx`, `HistoryEmptyState.tsx`, `HistoryLoadMoreSentinel.tsx` exist → all are new files.
- `Bash: ls packages/web/src/hooks/` → confirmed no `useSearchHistory.ts` exists → new file.
- `Bash: ls packages/web/src/types/` → confirmed no `history.ts` exists → new file; directory exists at `packages/web/src/components/global.d.ts` and `packages/web/src/components/voice.ts` suggest types can live in `src/types/` (check if directory exists).

---

#### Risks and Assumptions for `/review-plan`

1. **Singleton→feed migration complexity (High risk).** The central `HablarShell` refactor touches 8 state variables and 3 async flows (text, photo, voice). The voice path is the trickiest: the `voiceSession` effect currently both sets results AND triggers TTS. After migration the effect must create a new `TranscriptEntryData` entry; TTS continues from the same effect. The `lastQuery` ref (used for retry) must be moved to per-entry: `handleRetry` re-submits the last entry's `queryText`. Risk mitigation: write the regression test suite BEFORE the refactor (TDD), so a passing test suite before and after validates the migration.

2. **`voiceSession.lastResponse.data.queryText`:** The voice session response is `ConversationMessageResponse` which has `data: ConversationMessageData`. The `ConversationMessageData` type does NOT include the original query text (it is a response, not a request echo). There is no Whisper transcript on the client after the overlay closes — the transcript lives only in the API's response. For v1, use `"Consulta por voz"` as `queryText` for the voice entry's echo header, OR store the transcript in `voiceSession` if `lastResponse.transcript` is available. **Must verify `useVoiceSession` return shape** before implementing step 7 — if `lastResponse` has no transcript, use placeholder. This is a known gap the developer must resolve empirically.

3. **IntersectionObserver in jsdom (Medium risk).** jsdom does not implement IO. The stub added in `jest.setup.ts` must manually trigger callbacks to simulate scroll-to-top. The stub stores the last `IntersectionObserverCallback` and a `triggerEntry(isIntersecting: boolean)` method on the mock instance. Tests must use `act()` around the trigger to flush React state updates. If the IO stub is too coarse, tests may be brittle. Mitigation: test `HistoryLoadMoreSentinel` in isolation first (not via `TranscriptFeed` integration) so the stub's boundary is narrow.

4. **Scroll position restoration on load-more (Medium risk).** Recording `scrollTop` before a state update and restoring it after the next `useEffect` relies on `useLayoutEffect` for reliable DOM timing. In SSR/jsdom environments `useLayoutEffect` fires synchronously, so it is testable. However, jsdom does not implement real scroll geometry (`scrollHeight` is always 0). The test assertion must be limited to "scrollTo was called with the computed offset" (spy on `scrollTo`), not on the actual pixel position.

5. **`/history` is direct-to-API, not proxied (Confirmed).** `getHistory` calls `${NEXT_PUBLIC_API_URL}/history` directly, same as `sendMessage` and `getUsage`. No Next.js route handler proxy is needed. Assumption: `NEXT_PUBLIC_API_URL` is already set in the web's environment; no new env var required.

6. **Deploy-skew fallback (Confirmed).** `useSearchHistory` wraps the initial `getHistory` in `try/catch` and falls back to `persistedEntries: []` on any error. The hook is a no-op when `authToken === null` (anonymous users). Both cases tested in `useSearchHistory.test.ts`.

7. **Photo entry `photoData` field.** `TranscriptEntryData` needs a `photoData?: MenuAnalysisData` field to carry the photo result (which is `MenuAnalysisData`, not `ConversationMessageData`). The `result` field (`ConversationMessageData | null`) stays null for photo entries. This dual-field shape is slightly awkward; a union type would be cleaner but adds refactor scope. YAGNI for v1 — `photoData` optional field is sufficient and DOES NOT require a Zod schema (client-only type).

8. **`src/types/` directory.** Not confirmed to exist as a directory (only `global.d.ts` and `voice.ts` were found in `src/components/`). The developer must check if `packages/web/src/types/` exists; if not, create it, or co-locate `TranscriptEntryData` in `HablarShell.tsx` and export it.

---

### Verification commands run

- `Read: packages/api/src/routes/conversation.ts:108` → confirmed `reply.raw.once('finish', …)` fires for `writeQueryLog`; `capturedData` is set at line 130 (message) and 519 (audio) before `reply.send` at lines 132 and 539 → persistence hook follows identical closure pattern.
- `Read: packages/api/src/routes/conversation.ts:449–491` → confirmed `transcribedText` variable exists in `/audio` handler, set to `transcription` after hallucination guard passes at line 491 → use `transcribedText` (not `body.text`) as `query_text` for voice entries.
- `Read: packages/api/src/routes/auth.ts:410–470` → confirmed `GET /me/usage` pattern: manual `verifyBearerJwt`, `resolveBearerActorId`, no preHandler hook → mirror exactly in `historyRoutes`.
- `Read: packages/api/src/lib/bearerActor.ts` → confirmed `UUID_RE` export; `resolveBearerActorId` does NOT resolve `accounts.id` — it only resolves actor → cannot be reused for account lookup, must write `resolveAccountIdFromSub`.
- `Read: packages/api/src/plugins/actorResolver.ts:91` → confirmed `request.accountId = payload.sub` where `sub` = JWT `sub` = Supabase `auth_user_id` (UUID string) → NOT `accounts.id`; history routes must do their own lookup.
- `Read: packages/api/src/lib/accountTier.ts:46–48` → confirmed pattern: `prisma.$queryRaw<{ tier: string }[]>\`SELECT tier FROM accounts WHERE auth_user_id = ${sub}::uuid\`` → `resolveAccountIdFromSub` uses same pattern with `SELECT id`.
- `Read: packages/api/prisma/schema.prisma:490–506` → confirmed `Account` model: PK is `String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid`; `authUserId` is `@unique @map("auth_user_id") @db.Uuid` → FK from `search_history.account_id` targets `accounts.id` (uuid PK), not `auth_user_id`.
- `Read: packages/api/prisma/schema.prisma:490–506` → confirmed `Account` model has no `searchHistory` relation field yet → must add `searchHistory SearchHistory[]` as specified.
- `Read: packages/api/prisma/migrations/20260526130000_add_account_tier/migration.sql` → confirmed format: single SQL file, no `BEGIN/COMMIT`, comment header + rollback hint → new migration follows same format.
- `Bash: ls packages/api/prisma/migrations/` → last migration is `20260526130000_add_account_tier` → new migration timestamp `20260527140000` is correctly sequenced after it.
- `Read: packages/api/src/app.ts:45–157` → confirmed route registration pattern: all routes registered with `await app.register(…, { prisma: prismaClient, config?: cfg })` → `historyRoutes` must include `config` in options; register after `authRoutes` at line 156.
- `Read: packages/api/src/errors/errorHandler.ts` (grep for `INVALID_CURSOR`) → confirmed: `INVALID_CURSOR` code does NOT exist in the error handler → must add new branch returning HTTP 400.
- `Read: packages/api/src/plugins/actorRateLimit.ts:48–54` → confirmed `ROUTE_BUCKET_MAP` contains only `estimate`, `conversation/message`, `conversation/audio`, `analyze/menu` → `/history` routes absent → AC16 satisfied by omission (no entry needed).
- `Read: packages/shared/src/schemas/history.ts` → confirmed all three schemas already exist (`SearchHistoryKindSchema`, `SearchHistoryEntrySchema`, `HistoryPageSchema`) and are already exported from `packages/shared/src/index.ts:33` → no schema creation work needed.
- `Read: packages/api/src/__tests__/f-web-tier/fWebTier.usageEndpoint.integration.test.ts:1–140` → confirmed test harness pattern: `vi.mock('../../plugins/authBearer.js')`, hoisted mock before `buildApp` dynamic import, fixture UUID prefix strategy, `beforeAll` pre-cleanup, `afterAll` teardown → copy this structure for F-WEB-HISTORY integration tests.
- `Bash: grep -n "SearchHistory" packages/api/prisma/schema.prisma` → no output → `SearchHistory` model not yet in schema → must add in Step 1c.
- `Bash: grep -n "historyRoutes\|history" packages/api/src/app.ts` → no output → `historyRoutes` not yet registered → must add in Step 7.

---

## Acceptance Criteria

<!-- Legend: [BE] = backend integration test (real PG), [FE] = RTL component test, [Unit] = pure unit test -->

### Data model

- [ ] **AC1** [BE] Migration creates the `search_history` table with columns `id uuid PK`, `account_id uuid NOT NULL FK→accounts.id ON DELETE CASCADE`, `kind search_history_kind NOT NULL`, `query_text text NOT NULL`, `result_jsonb jsonb NOT NULL`, `created_at timestamptz DEFAULT now()`.
- [ ] **AC2** [BE] The composite index `search_history_account_cursor_idx` on `(account_id, created_at DESC, id DESC)` exists after migration.
- [ ] **AC3** [BE] Inserting a `search_history` row with a non-existent `account_id` raises a foreign key violation.
- [ ] **AC4** [BE] Deleting an `accounts` row cascades and deletes all associated `search_history` rows (ON DELETE CASCADE).
- [ ] **AC5** [Unit] `SearchHistoryKindSchema.parse('text')` succeeds; `SearchHistoryKindSchema.parse('photo')` throws.
- [ ] **AC6** [Unit] `SearchHistoryEntrySchema.parse(validEntry)` succeeds with all required fields; parse fails with a missing `id` field.
- [ ] **AC7** [Unit] `HistoryPageSchema.parse({ entries: [], nextCursor: null })` succeeds; `HistoryPageSchema.parse({ entries: [], nextCursor: 123 })` fails (nextCursor must be string or null).

### GET /history

- [ ] **AC8** [BE] `GET /history` without `Authorization` header → 401 `UNAUTHORIZED`.
- [ ] **AC9** [BE] `GET /history` with an expired bearer → 401 `TOKEN_EXPIRED`.
- [ ] **AC10** [BE] `GET /history` with a valid bearer whose `accounts` row does not yet exist → 200 with `entries: []`, `nextCursor: null`, and **no `accounts` row is created** by the call (read-only GET — cross-model C1; assert row count unchanged). Provisioning stays in `GET /me`.
- [ ] **AC11** [BE] `GET /history` with a valid bearer and 15 persisted entries, `limit=10` → 200 with exactly 10 entries, `nextCursor` non-null; entries ordered newest-first.
- [ ] **AC12** [BE] Passing the `nextCursor` from AC11 as `cursor=` → 200 with remaining 5 entries, `nextCursor: null`.
- [ ] **AC13** [BE] `GET /history?limit=51` → 400 `VALIDATION_ERROR`.
- [ ] **AC14** [BE] `GET /history?cursor=not-valid-base64-lol` → 400 `INVALID_CURSOR`.
- [ ] **AC15** [BE] `GET /history` only returns entries for the authenticated account; entries for a different account are not visible.
- [ ] **AC16** [BE] `GET /history` does NOT decrement any Redis rate-limit bucket (calling it 100× does not affect query/photo/voice remaining counts).

### DELETE /history/{id}

- [ ] **AC17** [BE] `DELETE /history/{id}` without bearer → 401 `UNAUTHORIZED`.
- [ ] **AC18** [BE] `DELETE /history/{id}` with a valid bearer for the entry's owner → 204; the row is no longer in the DB.
- [ ] **AC19** [BE] `DELETE /history/{id}` for an entry owned by a different account → 404 `NOT_FOUND` (no 403, no information leakage).
- [ ] **AC20** [BE] `DELETE /history/{id}` for a non-existent UUID → 404 `NOT_FOUND` (same response shape as AC19).
- [ ] **AC21** [BE] `DELETE /history/not-a-uuid` → 400 `VALIDATION_ERROR`.

### DELETE /history

- [ ] **AC22** [BE] `DELETE /history` without bearer → 401 `UNAUTHORIZED`.
- [ ] **AC23** [BE] `DELETE /history` with a valid bearer → 204; all `search_history` rows for that account are deleted.
- [ ] **AC24** [BE] `DELETE /history` when the account has no entries → 204 (idempotent, no error).

### Persistence hook

- [ ] **AC25** [BE] `POST /conversation/message` with a valid bearer and successful response → a `search_history` row is inserted with `kind='text'`, `query_text=body.text`, `result_jsonb` matching the response `data` object, `account_id` resolved from the bearer.
- [ ] **AC26** [BE] `POST /conversation/audio` with a valid bearer and successful response → a `search_history` row is inserted with `kind='voice'`, `query_text` = Whisper transcript.
- [ ] **AC27** [BE] `POST /conversation/message` without a bearer (anonymous) → no `search_history` row is inserted; the response is unaffected.
- [ ] **AC28** [BE] If the `search_history` insert fails (e.g. DB connection dropped after `reply.send`) → the `POST /conversation/message` response is still 200 with correct data; the error is logged at `error` level; no exception propagates to the client.
- [ ] **AC29** [BE] After the 501st insert for a single account, the oldest row beyond the 500-row cap is pruned; the account has at most 500 rows.
- [ ] **AC30** [BE] After inserting a row with `created_at < now() - interval '12 months'` (via direct DB insert in the test), a subsequent persistence hook write triggers the age-prune and removes that stale row.

### Retention / privacy

- [ ] **AC31** [BE] Deleting an `accounts` row (simulated via direct Prisma call) removes all associated `search_history` rows (CASCADE verified by AC4 above; include a named integration test for the full user-deletion flow).

### Frontend — session transcript (Fase 1)

- [ ] **AC32** [FE] Anonymous user submits two text queries; both results appear in the feed stacked oldest-at-top, newest-at-bottom; the second query does not replace the first.
- [ ] **AC33** [FE] `TranscriptEntry` renders with `role="article"` and `aria-label` containing the truncated query text.
- [ ] **AC34** [FE] `TranscriptFeed` renders with `role="feed"` and `aria-label="Historial de consultas"`.
- [ ] **AC35** [FE] When a new query is in-flight, the entry shows a shimmer card (`isLoading: true`); when the result arrives, the shimmer is replaced by the result card.
- [ ] **AC36** [FE] A failed query adds an `ErrorState` entry; retrying adds a NEW entry below (does not mutate the failed entry).
- [ ] **AC37** [FE] `HistoryPersistenceNudge` renders only after the 2nd entry for an anonymous user; it does not render for a logged-in user; it does not render if `showRateLimitNudge` is true.

### Frontend — persisted history (Fase 2-3)

- [ ] **AC38** [FE] On mount with an authenticated user, `useSearchHistory` calls `GET /history?limit=10`; the returned entries are prepended to the feed with `isPersisted: true` and "Guardado" badge.
- [ ] **AC39** [FE] When `hasMoreHistory: true` and the sentinel enters the viewport, `loadMore` is called and a subsequent `GET /history?cursor=<next>` is issued.
- [ ] **AC40** [FE] When `nextCursor` is null, the sentinel stops; no further `loadMore` calls are made.
- [ ] **AC41** [FE] `DeleteEntryButton`: clicking the trash icon shows the inline confirm row; clicking Cancel reverts to idle; clicking Confirm fires `onConfirm(entryId)`.
- [ ] **AC42** [FE] `DeleteEntryButton` auto-reverts to idle after 5000ms of inactivity (setTimeout).
- [ ] **AC43** [FE] `ClearHistoryButton` opens a modal dialog on click; clicking Cancel closes it without calling `onConfirm`; clicking "Borrar todo" calls `onConfirm`.
- [ ] **AC44** [FE] `ClearHistoryButton` dialog has `role="alertdialog"`, `aria-modal="true"`, and focus is trapped inside the dialog while open.
- [ ] **AC45** [FE] After `onClearAll` resolves, the feed shows `HistoryEmptyState` (logged-in user, no entries).
- [ ] **AC46** [FE] `HistoryEmptyState` is not shown for anonymous users; the anonymous empty state (`EmptyState`) is shown instead.
- [ ] **AC47** [FE] Photo entries (`inputMode: 'photo'`) display in the session feed but do NOT show the "Guardado" badge and are NOT sent to `DELETE /history/:id` (they have no `entryId` from the server).

### Telemetry

- [ ] **AC48** [FE] `history_loaded` is fired on mount with `{ count: N }` when the initial fetch resolves successfully.
- [ ] **AC49** [FE] `history_load_more` is fired with `{ page: N }` each time the sentinel triggers `loadMore`.
- [ ] **AC50** [FE] `history_entry_deleted` is fired with `{ entryId, inputMode }` when `DeleteEntryButton.onConfirm` fires.
- [ ] **AC51** [FE] `history_cleared` is fired when `ClearHistoryButton.onConfirm` fires.
- [ ] **AC52** [FE] `history_persistence_nudge_shown` is fired on `HistoryPersistenceNudge` mount.

### Build / CI

- [ ] **AC53** TypeScript build (`tsc --noEmit`) passes with no new type errors in `packages/api`, `packages/shared`, and `packages/web`.
- [ ] **AC54** All existing tests continue to pass (no regressions from the feed refactor or schema additions).
- [ ] **AC55** `packages/shared` exports `SearchHistoryKindSchema`, `SearchHistoryEntrySchema`, `HistoryPageSchema`, and their inferred types from `index.ts`.

### Operator / post-deploy smokes

- [ ] **AC56** [Smoke] `GET /history` with a real production bearer returns 200 with the correct envelope shape (run via `curl` or Postman against the deployed API).
- [ ] **AC57** [Smoke] Submitting a text query while logged in, then reloading `/hablar`, shows the query in the feed with the "Guardado" badge (confirms the persistence hook + GET /history round-trip end-to-end).
- [ ] **AC58** [Smoke] Privacy: operator confirms that the `search_history` table is covered by the account-deletion cascade in the production Supabase SQL editor (`SELECT COUNT(*) FROM search_history WHERE account_id = '<deleted_account_id>'` returns 0 after account delete).

### Cross-model review additions (Step 0 /review-spec, 2026-05-27)

- [ ] **AC59** [BE] Persisted-result round-trip: for each PERSISTED intent shape produced by `/conversation/message` (`estimation`, `comparison`, `contextSet`), the stored `result_jsonb` validates against `ConversationMessageDataSchema` when read back via `GET /history`. (cross-model C2; `text_too_long` excluded — not persisted, see AC62.)
- [ ] **AC60** [FE] `TranscriptEntry` re-renders a PERSISTED entry correctly from `resultData` for each persisted intent shape (estimation card, comparison card, contextSet acknowledgement) — same rendering path as a live result. (cross-model C2)
- [ ] **AC61** [BE] A query of 501–2000 chars (`queryText` boundary): `SearchHistoryEntrySchema.parse` accepts a `query_text` up to 2000 chars (max = 2000, not 500). (cross-model C3 — guards the schema cap even though `text_too_long` itself is not persisted per AC62.)

### Cross-model review additions (Step 2 /review-plan, 2026-05-27)

- [ ] **AC62** [BE] `text_too_long` is NOT persisted: a bearer `POST /conversation/message` whose response intent is `text_too_long` writes **no** `search_history` row (hook skips it). (cross-model G-CRIT — keeps live inline-error coherent with history.)
- [ ] **AC63** [FE] Drift tolerance: a `GET /history` page containing one entry whose `resultData` fails `SearchHistoryEntrySchema` still renders the OTHER valid entries (per-entry `safeParse` skip, loose-envelope parse — NOT whole-page reject). (cross-model X1)
- [ ] **AC64a** [BE] `POST /conversation/audio` 200 response includes `data.transcribedText` equal to the Whisper transcript. **AC64b** [FE] a voice `TranscriptEntry` header shows `data.transcribedText` (placeholder `"Consulta por voz…"` only while in-flight). (cross-model G-IMP/X2)
- [ ] **AC65** [BE] `GET /history` / `DELETE /history/:id` / `DELETE /history` surface a **500** (not false 200 []/404/204) when the account-id resolution query errors — DB outage is not masked. (cross-model X3)

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

- [x] Step 0: `spec-creator` executed, specs updated (+ `ui-ux-designer` W15–W26 + `/review-spec` cross-model)
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` + `frontend-planner` executed, plan approved (+ `/review-plan` cross-model, 5 findings applied)
- [ ] Step 3: `backend-developer` + `frontend-developer` executed with TDD
- [ ] Step 4: `production-code-validator` executed, quality gates pass
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 5: `qa-engineer` executed (Standard/Complex)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-05-27 | Step 1 (Setup) | Branch `feature/F-WEB-HISTORY-search-history` off develop@ecd4e60. Ticket skeleton created (all 7 sections). **Complexity: Complex** (new DB table + migration + new endpoints + UI architecture refactor + RGPD-light privacy model). Reclassified from Standard (was scoped as faseado; owner chose full persistence 2026-05-27). Resumed via PM orchestrator `continue pm` (session pm-profiles, feature 2/2 → `/compact` after). |
| 2026-05-27 | Step 0 (Design) | `ui-ux-designer` executed. Added **W15–W26** to `design-guidelines.md` (transcript feed layout, TranscriptEntry anatomy, persisted-history load/scroll, in-feed loading/error, anonymous persistence nudge + nudge hierarchy, delete UX, empty state, a11y `role=feed`/`article`, responsive, animations, 12 anti-patterns) + component catalog in `ui-components.md` (`TranscriptFeed`/`TranscriptEntry`/`DeleteEntryButton`/`ClearHistoryButton`/`HistoryPersistenceNudge`/`HistoryEmptyState`/`HistoryLoadMoreSentinel` + `useSearchHistory` hook + telemetry). Raised 5 minor UI forks (badge wording, nudge threshold ≥2, clear-all in v1, photo disappear-on-reload, auto-scroll 100px) — all with recommendations. |
| 2026-05-27 | Step 0 (Spec) | `spec-creator` executed. Wrote full Spec (API/Data/UI/Edge) + **58 ACs** into ticket; added `GET /history` + `DELETE /history` + `DELETE /history/{id}` to `api-spec.yaml`; created `packages/shared/src/schemas/history.ts` (+ `index.ts` export); `SearchHistory` Prisma model documented (migration deploy). `schema.prisma` untouched (correct for Step 0). shared typecheck + 659 tests green. |
| 2026-05-27 | Step 0 (Spec review) | `/review-spec` cross-model: **Gemini APPROVED** (1 IMPORTANT: version result_jsonb — deferred YAGNI), **Codex REVISE** (3 IMPORTANT, all empirical w/ file:line, all applied): **C1** `GET /history` write-on-GET → made read-only (no account upsert on a GET; provisioning stays in `/me`; AC10 + edge + identity-pattern updated); **C2** `resultData` untyped `record<unknown>` → typed strictly as `ConversationMessageDataSchema` (verified non-circular: conversation.ts doesn't import history.ts; covers all intent shapes; web safeParses+skips drift; +AC59/AC60); **C3** `queryText` cap 500 vs `/conversation/message` `.max(2000)` (`text_too_long` is success on persist path) → aligned to 2000 (+AC61). Re-verified: shared typecheck + 659 green; api-spec.yaml my blocks parse clean (2 PRE-EXISTING YAML issues noted, out of scope: `/calculate/recipe` dup-key + `Fixed keys:` colon-in-scalar in F-WEB-TIER `UsageData`). Fixed my own YAML bug (backtick-leading scalar at `api-spec.yaml:6632`). 3 ACs added → **61 ACs**. **PAUSE at Spec checkpoint (owner) — architecture-sensitive: new table + RGPD + UI refactor.** |
| 2026-05-27 | Step 0→2 (Spec APPROVED) | **Owner approved Spec at checkpoint → proceed to Step 2 (Plan).** All 9 recommended fork defaults accepted; **retention confirmed 500 entries / 12 months** (fork D4). Owner also granted: continue autonomously via PM orchestrator. **ADR-028** written (search-history storage + read-only history API + prune-on-write retention + privacy/no-Art.9). Status → Planning. Next: `backend-planner` → `frontend-planner` → `/review-plan` → Step 3. |
| 2026-05-27 | Step 2 (Plan) | `backend-planner` (7 steps: migration + cursor + `lib/searchHistory.ts` repo + read-only `GET /history` + DELETE×2 + persistence hook + register) + `frontend-planner` (phased A: feed refactor / B: persisted history hook+UI / C: telemetry). Empirical findings: `request.accountId`=sub (need `resolveAccountIdFromSub`); `INVALID_CURSOR` absent from errorHandler (add); voice `query_text`=`transcribedText` (`conversation.ts:491`); `historyRoutes` needs `config` in opts; shared schemas already exist. |
| 2026-05-27 | Step 2 (Plan review) | `/review-plan` cross-model: **both REVISE** — 1 CRITICAL + 4 IMPORTANT (deduped), all applied: **G-CRIT** `text_too_long` live-vs-persist incoherence → hook SKIPS `text_too_long` (degenerate; stays inline-error live; never in history) + AC62; **X1** whole-page `HistoryPageSchema.safeParse` defeats per-entry skip → web parses loose envelope then `safeParse` each entry + AC63; **X3** `resolveAccountIdFromSub` must THROW on DB error (null only for no-row) so reads/deletes don't mask outages as 200[]/404/204 — only the fire-and-forget hook swallows + AC65; **G-IMP/X2** voice transcript not in `ConversationMessageData` → add optional `transcribedText` to the schema + `/audio` populates it (live feed + persisted consistent) + AC64. ACs 62–65 added → **65 ACs**. Plan edits applied inline. **Plan auto-approved (L5 + owner autonomous grant) → Step 3 Implement.** |

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

*Ticket created: 2026-05-27*
