# F-WEB-HISTORY: Search history — session transcript + persisted history

**Feature:** F-WEB-HISTORY | **Type:** Fullstack-Feature | **Priority:** High
**Status:** Planning | **Branch:** feature/F-WEB-HISTORY-search-history
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

_Pending — to be generated by the planner agent in Step 2 (backend-planner first, then frontend-planner)._

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

### Cross-model review additions (Step 0, 2026-05-27)

- [ ] **AC59** [BE] Persisted-result round-trip: for each persisted intent shape produced by `/conversation/message` (`estimation`, `comparison`, `contextSet`, `text_too_long`), the stored `result_jsonb` validates against `ConversationMessageDataSchema` when read back via `GET /history` (no intent shape is silently corrupted or dropped on the happy path). (cross-model C2)
- [ ] **AC60** [FE] `TranscriptEntry` re-renders a PERSISTED entry correctly from `resultData` for each intent shape (estimation card, comparison card, contextSet acknowledgement) — same rendering path as a live result. (cross-model C2)
- [ ] **AC61** [BE] A successful `text_too_long` query (501–2000 chars) is persisted without rejection: the `search_history` row is written and `SearchHistoryEntrySchema.parse` accepts its `query_text` (queryText max = 2000, not 500). (cross-model C3)

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
- [ ] Step 2: `backend-planner` + `frontend-planner` executed, plan approved
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
