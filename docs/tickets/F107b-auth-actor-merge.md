# F107b: Auth — anonymous → authenticated actor merge flow

**Feature:** F107b | **Type:** Fullstack-Feature | **Priority:** Deferred
**Status:** Closed - Not Needed | **Branch:** (never created)
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done | Closed - Not Needed -->
**Created:** 2026-05-18 | **Closed:** 2026-05-18 | **Dependencies:** F107a (done)

---

## Closure Note (2026-05-18)

This ticket was drafted but **closed without implementation** after empirical investigation of F107a's `/me` handler revealed the spec's central premise was wrong.

### Why the spec's premise didn't hold

The spec assumed a "merge actor_A (anonymous) into actor_B (authenticated)" problem. Empirical reading of `packages/api/src/routes/auth.ts:180-292` showed that F107a's `/me` actually **promotes the existing anonymous actor in place** via `UPDATE actors SET account_id = <bearer's accountId> WHERE id = <existing actor's id>`. There is no separate `actor_B` in the normal flow — the same actor row carries pre-auth and post-auth history seamlessly. No merge is needed.

The only scenarios that *would* leave orphan history (the original problem F107b claimed to solve) are:
1. Multi-device pre-auth (Device A anon + Device B authenticated). Out of scope — needs explicit cross-device history claiming UX.
2. Cookie clear between browse and login. Pre-auth history is unrecoverable by design.
3. `X-Actor-Id` missing on `/me` → fallback path creates `me-<sub>` actor, leaving the original anonymous actor orphaned. Rare (frontend bug).

None of these justify F107b's full scope. The pragmatic move is to close this ticket and revisit only if telemetry shows real pain.

### A real bug surfaced during the investigation

The empirical read also surfaced a separate, real F107a bug: silent actor hijacking when `X-Actor-Id` is shared across users (e.g., shared family browser, leaked cookie). The `IS DISTINCT FROM` condition in F107a's UPDATE has inverted hijack-prevention semantics. This is being fixed as `F107a-FU2-account-link-hijack-fix` (separate ticket).

### Re-evaluation Triggers

Reopen this ticket — or open a successor with scope reduced to scenario 3 above — if **any** of the following fires:

1. Sentry shows `actor_link_collision` events (from F107a-FU2's instrumentation) occurring at a rate > 10/week.
2. F099 (profiles) or F103 (weekly summary) surface per-account query history and user complaints arrive that history is missing after first login.
3. Customer support receives reports of "I lost my queries when I signed in" from at least 3 distinct users.
4. A new feature requires hard guarantees that all pre-auth history of a human is consolidated under one account (so far no feature requires this).

Until any of those triggers, F107b stays closed.

### What replaces this in pm-profiles Batch 3

The pm-profiles Batch 3 batch is recomposed:

- `F107a-FU2` — account-link hijack fix (Standard, hotfix). **REPLACES F107b in the batch.**
- `F099-lite` — User Profiles BMR + targets (Standard). Unchanged plan; depends on Auth being solid (F107a-FU2 must land before F099-lite).

The decision to pivot was made 2026-05-18 with user explicit approval after architectural discussion documented in this session's transcript.

---

## Spec (historical — frozen as drafted)

---

## Spec

### Description

When an anonymous user authenticates for the first time via the Supabase magic link, two
`actors` rows exist for the same human:

- `actor_A` — `type=anonymous_web`, `external_id=<X-Actor-Id UUID>`, `account_id=NULL`.
  Carries all pre-auth query history (`query_logs.actor_id = actor_A.id`).
- `actor_B` — provisioned (or reused) by `/me`'s upsert using the authenticated identity.
  Has `account_id = <new account>`. Has no history yet.

F107b introduces an explicit merge endpoint (`POST /auth/merge`) that the web app calls
immediately after login and the `/me` round-trip. The endpoint:

1. Looks up `actor_A` by the anonymous `externalId` sent from the web client.
2. Reassigns all dependent rows that reference `actor_A.id` to `actor_B.id` inside a
   single serializable transaction.
3. Deletes `actor_A` (hard delete — see § Audit / soft-delete decision below).
4. Returns the surviving `actor_B` summary.

The merge is idempotent: if `actor_A` no longer exists (merge already ran), the endpoint
returns 200 with a `{ merged: false, reason: "ALREADY_MERGED" }` payload. It is never an
error to call merge twice.

#### Why an explicit `POST /auth/merge` rather than implicit inside `/me`

`/me` is a GET endpoint with a narrow contract: return account + actor for the current
request. Embedding mutation of arbitrary historical rows inside a GET response creates
hidden side effects, violates HTTP semantics, and makes it impossible to observe the merge
as a discrete event in logs. An explicit `POST /auth/merge` is:

- Observable (logged as a discrete event with `merged: true/false`).
- Retryable by the client without re-triggering `/me` logic.
- Independently testable.
- Cancellable/deferrable (user can stay anonymous for the session if the merge fails — the
  app degrades gracefully to the bearer actor, history follows on next merge attempt).

The implicit `/me` approach was rejected because it conflates identity resolution with
data migration and makes partial-failure recovery ambiguous.

#### Anonymous identifier discovery — how does the server know which actor_A to merge?

The web client sends the anonymous `X-Actor-Id` value (UUID) in the request body field
`anonymousExternalId`. This is the same UUID the client has been sending as the
`X-Actor-Id` header on every anonymous request. The server looks up
`actors WHERE type = 'anonymous_web' AND external_id = <anonymousExternalId>`.

The server does NOT attempt to read this from a cookie; the web client is the authoritative
holder of its own anonymous identity (F069 architecture: client-driven UUID stored in
`localStorage` or similar). The client sends it explicitly in the merge body so the server
has a single, unambiguous, auditable input.

#### Audit / soft-delete vs. hard-delete decision

The F107b spec chooses **hard delete** of `actor_A` after successful row migration.

Rationale:
- `actor_A` rows are anonymous, carry no PII beyond a UUID, and hold no legal basis for
  retention under RGPD once the account is linked.
- Soft-delete adds a `deleted_at` column to `actors` — but that column would need to be
  propagated to every query that reads actors (actorResolver, /me, future RLS policies),
  adding permanent complexity for a debugging aid used only during the merge window.
- Pre-merge, a snapshot of `actor_A`'s metadata (id, externalId, createdAt, lastSeenAt,
  hitCount = count(query_logs)) is written to an `actor_merge_log` table (see Data Model
  Changes). This provides the audit trail without polluting the live `actors` table.
- A future GDPR Art. 17 deletion ticket will already need to consider `actor_merge_log` —
  that scope is explicitly deferred (see § Out of scope).

#### Race condition strategy

Two browser tabs calling `POST /auth/merge` concurrently for the same `(anonymousExternalId,
accountId)` pair must not cause data corruption. Strategy: **advisory lock + serializable
transaction**, specifically:

```sql
BEGIN ISOLATION LEVEL SERIALIZABLE;
SELECT pg_advisory_xact_lock(hashtext(<anonymousExternalId>));
-- Check actor_A existence
-- Reassign rows
-- Delete actor_A
COMMIT;
```

`pg_advisory_xact_lock` is released automatically on transaction commit or rollback. The
second concurrent call will block on the lock, then after the first commits, will find
`actor_A` no longer exists → return `{ merged: false, reason: "ALREADY_MERGED" }`.

A UNIQUE constraint catch on `actor_id` reassignment is NOT used because there is no
unique constraint on `query_logs.actor_id` or `missed_query_tracking.actor_id` (they are
soft FKs by design per F029/F079). A transaction with serializable isolation alone is also
not sufficient because two concurrent serializable transactions that both read "actor_A
exists" before either writes could both proceed — the advisory lock is the correct
serialisation point.

#### Partial-merge recovery

The entire merge (row reassignment + actor_A deletion + audit log write) runs inside a
single Postgres transaction. If any step fails, the whole transaction rolls back — no
partial state is committed. This means:

- If `query_logs` reassignment succeeds but `actor_A` deletion fails → rollback → no rows
  have changed → next merge attempt starts from a clean state.
- The `actor_merge_log` insert is also inside the same transaction, so it only appears if
  the merge fully succeeds.

Row counts: pre-beta, zero real users. Maximum `query_logs` rows per actor is bounded by
the 50-queries/day rate limit (F069). Even at 30 days of anonymous usage, that is ≤1,500
rows — well within a single transaction's capacity. If row counts ever grow beyond 10,000
(post-beta), the implementation ticket MAY batch reassignments in chunks inside a single
outer transaction with a savepoint per batch, but this is NOT required for F107b.

---

### API Changes

| Method | Path | Status | Description |
|--------|------|--------|-------------|
| POST | `/auth/merge` | **NEW** | Merge anonymous actor into authenticated actor. Requires `Authorization: Bearer`. Body: `{ anonymousExternalId }`. Returns merge result. |

Full OpenAPI definition in `docs/specs/api-spec.yaml` under path `/auth/merge`.

**New error codes introduced:**

| Code | HTTP | Meaning |
|------|------|---------|
| `MERGE_CONFLICT` | 409 | `actor_A.account_id` is already set to a DIFFERENT account than the bearer's account. Indicates cookie leak / shared device. Merge is refused. |
| `ACTOR_NOT_FOUND` | 404 | `anonymousExternalId` was provided but does not match any `anonymous_web` actor. Distinct from "already merged" (which is 200). This code is reserved for a syntactically valid UUID that never existed as an actor in the system — can only happen if client sends a fabricated UUID. |

Note: `ALREADY_MERGED` is NOT an error — it is a 200 response with `merged: false`.

---

### Data Model Changes

#### New table: `actor_merge_log`

Audit table recording completed merges. Written inside the same transaction as the merge.
No Prisma model needed in F107b (admin-only introspection; raw SQL or Kysely raw queries
are sufficient). A Prisma model may be added in a future audit/admin ticket.

```sql
CREATE TABLE public.actor_merge_log (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merged_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  account_id            UUID NOT NULL,          -- the account that triggered the merge
  source_actor_id       UUID NOT NULL,           -- actor_A.id (now deleted)
  source_external_id    VARCHAR(255) NOT NULL,   -- actor_A.external_id
  source_created_at     TIMESTAMPTZ NOT NULL,    -- actor_A.created_at (for retention analysis)
  source_last_seen_at   TIMESTAMPTZ NOT NULL,    -- actor_A.last_seen_at
  target_actor_id       UUID NOT NULL,           -- actor_B.id (the surviving actor)
  query_logs_migrated   INTEGER NOT NULL DEFAULT 0,
  initiator_ip          VARCHAR(45),             -- request IP, for abuse detection
  CONSTRAINT fk_account FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL
);

CREATE INDEX idx_actor_merge_log_account_id ON public.actor_merge_log (account_id);
CREATE INDEX idx_actor_merge_log_merged_at  ON public.actor_merge_log (merged_at DESC);
```

Notes:
- `source_actor_id` is a recording field, NOT an FK to `actors` (the source row is deleted
  by the time this record is written — within the same transaction, the delete happens
  before the insert, which is fine because FK checks happen at commit, but to avoid that
  complexity we simply do not declare the FK).
- `target_actor_id` is similarly not declared as a FK (actor_B could be deleted in the
  future by a GDPR erasure — the log must survive actor deletion).
- `ON DELETE SET NULL` on `account_id` is a precaution for future GDPR account deletion
  ticket; the merge log row is retained (NULL account_id), not cascaded.

#### No changes to existing tables

`actors`, `query_logs`, and `missed_query_tracking` require no DDL changes for F107b.
The merge only performs DML (`UPDATE ... SET actor_id = <actor_B.id>` and
`DELETE FROM actors WHERE id = <actor_A.id>`).

#### Dependent tables enumerated

All tables that reference `actor_id` and must be reassigned during merge:

| Table | Column | Type | Notes |
|-------|--------|------|-------|
| `query_logs` | `actor_id` | `UUID NULL` (soft FK, no DB constraint) | Reassign all rows WHERE actor_id = actor_A.id |
| `missed_query_tracking` | — | — | Does NOT reference actor_id. No action needed. |

Survey result: only `query_logs` holds an `actor_id` reference. `missed_query_tracking`
references `resolved_dish_id` (a Dish FK) — not actor-scoped. `web_metrics_events`,
`api_keys`, `waitlist_submissions` have no actor reference. Confirmed by reading
`schema.prisma` as of 2026-05-18.

If future tickets add `actor_id` columns to other tables (e.g., F099 user preferences,
F098 subscription rows), those tickets MUST update this list and add the corresponding
reassignment step to the merge transaction.

#### Zod schemas

New schemas added to `packages/shared/src/schemas/auth.ts`:

- `MergeRequestSchema` — request body for `POST /auth/merge`.
- `MergeResponseSchema` — response data payload.

---

### UI Changes

Minimal. The web app (`packages/web/`) is responsible for:

1. **Triggering the merge** — after a successful magic link login and `/me` round-trip, the
   web calls `POST /auth/merge` with `{ anonymousExternalId: <stored anonymous UUID> }`.
   The stored UUID lives in `localStorage` under the key `nxi_actor_id` (verified
   empirically in `packages/web/src/lib/actorId.ts:LOCAL_STORAGE_KEY`). The web client
   sends this header today as `X-Actor-Id` on every anonymous request via
   `apiClient.ts`.

2. **Clearing the anonymous identity** — on a successful merge response (`merged: true`),
   the web clears the locally stored anonymous actor UUID. On subsequent requests the
   `X-Actor-Id` header is no longer sent (the bearer token is now the identity signal).

3. **Graceful degradation** — if the merge call fails (network error, 409 MERGE_CONFLICT,
   503), the user remains authenticated (bearer is valid). History is temporarily orphaned
   but the session is functional. The web MUST NOT show a blocking error to the user for a
   merge failure. Silent retry on next app load is acceptable.

4. **Already-merged case** — `{ merged: false, reason: "ALREADY_MERGED" }` is a 200. The
   web treats it identically to `{ merged: true }`: clear the local anonymous UUID.

No new UI components are required. The merge call is a background network request with no
user-visible interaction. UI components spec in `docs/specs/ui-components.md` requires no
updates for F107b.

---

### Edge Cases & Error Handling

#### EC-1: No anonymous actor exists (device never had anonymous session)
User logs in from a fresh browser / incognito / device where `X-Actor-Id` was never stored.
Client sends `anonymousExternalId` as `null` or omits the field.

**Behaviour:** If `anonymousExternalId` is absent or `null`, the endpoint skips merge and
returns `{ merged: false, reason: "NO_ANONYMOUS_ACTOR" }` (200). This is not an error.
The planner MUST add a Zod `.nullable()` branch to `MergeRequestSchema` for this case.

#### EC-2: `actor_A.account_id` already set to a DIFFERENT account (cookie leak)
`actor_A` exists but its `account_id` is already set to account X, and the current bearer
belongs to account Y (X ≠ Y). This indicates a shared device where a different user was
previously logged in and their anonymous cookie was not cleared.

**Behaviour:** Refuse merge. Return 409 `MERGE_CONFLICT`. The web client SHOULD log a
warning (not shown to user) and clear the local anonymous UUID to prevent repeated 409s on
subsequent logins from this device.

#### EC-3: Sign out then sign in as a different user on the same browser
After logout, the anonymous UUID in localStorage is the one from the previous authenticated
session's actor (actor_B, which has `account_id` set). The new anonymous session may not
have created a new actor yet (no queries run).

Two sub-cases:
- **New actor not yet created** (client still holds old UUID with account_id set): merge
  will encounter EC-2 if old actor's account ≠ new bearer's account → 409 → web clears
  UUID. Clean state.
- **New anonymous queries run** before login: a new `actor_A` with `account_id=NULL` was
  created via F069. Merge proceeds normally.

The web SHOULD clear the locally stored anonymous UUID on logout to prevent the EC-2 path.
This is a frontend responsibility — spec the logout handler to clear `nxi_actor_id` from
localStorage.

#### EC-4: Anonymous actor has zero query_log rows
Merge is valid. The transaction reassigns 0 rows (no-op UPDATE) and deletes `actor_A`.
`actor_merge_log.query_logs_migrated = 0`. Returns `{ merged: true }`.

#### EC-5: `anonymousExternalId` is syntactically valid UUID but never existed as an actor
Return 404 `ACTOR_NOT_FOUND`. This should only happen if the client sends a fabricated or
corrupted UUID. The web treats this like EC-1 (clear local UUID, no user-visible error).

#### EC-6: Concurrent merge calls (two browser tabs)
Handled by the advisory lock strategy (see § Race condition strategy). The second call
returns `{ merged: false, reason: "ALREADY_MERGED" }`.

#### EC-7: `actor_A` and `actor_B` are the same actor (externalId matches the authenticated actor)
This can happen if `/me` reused the existing anonymous actor row (same externalId). The
merge endpoint MUST detect `source_actor_id == target_actor_id` and return
`{ merged: false, reason: "SAME_ACTOR" }` without performing any DML.

#### EC-8: Bearer is valid but `accounts` row does not exist yet
The caller is authenticated but `/me` has never been called (no accounts row). Without an
accounts row there is no `actor_B` to merge into. Return 400 `ACCOUNT_NOT_PROVISIONED`.
The web MUST call `/me` before calling `POST /auth/merge`.

---

### Deliverables — Operator Docs

A runbook MUST be created at `docs/operations/F107b-actor-merge-runbook.md` covering:

1. **Verifying merge completed** — SQL to check `actor_merge_log` for a given email/account.
2. **Orphaned anonymous actors** — SQL to find `actors WHERE account_id IS NULL AND
   last_seen_at < now() - interval '30 days'` (not the same as failed merges, but useful
   for hygiene).
3. **Failed partial merge** — how to verify no partial state exists (because the transaction
   is all-or-nothing, partial state should not occur; runbook explains how to confirm this).
4. **MERGE_CONFLICT recovery** — manual steps if a legitimate user's anonymous actor got
   incorrectly linked to another account (unlikely; requires support investigation).
5. **Accidental cross-account merge** — if a bug causes actor rows to be reassigned to the
   wrong account: how to identify affected rows in `actor_merge_log`, how to reassign
   `query_logs.actor_id` back manually, and how to restore actor rows from backups.
6. **Manual merge trigger** — SQL command to run the merge manually for a given
   `(anonymous_external_id, account_id)` pair (for support edge cases).

The runbook is a documentation deliverable, not code. It MUST be reviewed as part of the
DoD before merge.

---

## Implementation Plan

_Pending — to be generated by the planner agent in Step 2._

---

## Acceptance Criteria

### API contract
- [ ] AC-01: `POST /auth/merge` exists and requires `Authorization: Bearer` (returns 401 without it).
- [ ] AC-02: `POST /auth/merge` accepts `{ anonymousExternalId: string | null }` in the request body.
- [ ] AC-03: Successful merge returns 200 `{ merged: true, actor: ActorSummary }` where `actor` is `actor_B`.
- [ ] AC-04: `anonymousExternalId` must be a UUID or null; a non-UUID string returns 400 `VALIDATION_ERROR`.

### Already-merged / no-op cases
- [ ] AC-05: If `anonymousExternalId` is `null` or absent, endpoint returns 200 `{ merged: false, reason: "NO_ANONYMOUS_ACTOR" }`.
- [ ] AC-06: If `actor_A` does not exist (already deleted by a prior merge), endpoint returns 200 `{ merged: false, reason: "ALREADY_MERGED" }`.
- [ ] AC-07: Calling `POST /auth/merge` twice with the same `anonymousExternalId` produces identical final DB state as calling it once (idempotency).
- [ ] AC-08: If `actor_A.id == actor_B.id` (same actor), endpoint returns 200 `{ merged: false, reason: "SAME_ACTOR" }` with no DML performed.

### Merge correctness
- [ ] AC-09: After a successful merge, ALL `query_logs` rows previously referencing `actor_A.id` reference `actor_B.id`.
- [ ] AC-10: After a successful merge, `actor_A` no longer exists in `public.actors`.
- [ ] AC-11: After a successful merge, `actor_merge_log` contains exactly one row with correct `source_actor_id`, `target_actor_id`, `account_id`, and `query_logs_migrated` count.
- [ ] AC-12: An anonymous actor with zero `query_logs` rows merges successfully (`query_logs_migrated = 0`).

### Error cases
- [ ] AC-13: If `actor_A.account_id` is already set to an account different from the bearer's account, endpoint returns 409 `MERGE_CONFLICT` and no rows are modified.
- [ ] AC-14: If bearer is valid but no `accounts` row exists for the bearer's `sub`, endpoint returns 400 `ACCOUNT_NOT_PROVISIONED`.
- [ ] AC-15: A syntactically valid UUID sent as `anonymousExternalId` that has no corresponding `anonymous_web` actor returns 404 `ACTOR_NOT_FOUND`.

### Race condition
- [ ] AC-16: Two concurrent `POST /auth/merge` calls with the same `anonymousExternalId` result in exactly one merge completing (`actor_A` deleted once) and the other returning `{ merged: false, reason: "ALREADY_MERGED" }`. No duplicate rows in `actor_merge_log`. Verified by an integration test with two concurrent requests.

### Partial-merge recovery
- [ ] AC-17: If the transaction is deliberately aborted after `UPDATE query_logs` but before `DELETE actors` (simulated by injecting a runtime error in the test), the DB state is unchanged (no `query_logs` rows have been reassigned, `actor_A` still exists).

### Frontend
- [ ] AC-18: After a 200 merge response (`merged: true` or `merged: false`), the web client clears the locally stored anonymous actor UUID from localStorage.
- [ ] AC-19: A merge failure (5xx or network error) does NOT block the user from using the authenticated session. The error is logged silently; the user is not shown a blocking error UI.
- [ ] AC-20: The web calls `POST /auth/merge` only AFTER a successful `/me` round-trip (bearer + accounts row confirmed to exist).

### Operator docs
- [ ] AC-21: `docs/operations/F107b-actor-merge-runbook.md` exists and covers all 6 scenarios listed in § Deliverables — Operator Docs.

### Test coverage
- [ ] AC-22: A backend integration test exercises the full merge against a real Postgres test container (not mocked): creates `actor_A` with N `query_logs`, authenticates, calls merge, asserts `actor_A` deleted, all `query_logs` reassigned, `actor_merge_log` row present.

---

## Definition of Done

- [ ] All 22 acceptance criteria met and checked
- [ ] `POST /auth/merge` route implemented in `packages/api/src/routes/auth/`
- [ ] `MergeRequestSchema` and `MergeResponseSchema` exported from `packages/shared/src/schemas/auth.ts`
- [ ] Prisma migration for `actor_merge_log` table applied and committed
- [ ] Kysely types regenerated (`prisma-kysely`)
- [ ] `docs/specs/api-spec.yaml` updated with `/auth/merge` endpoint and new schemas
- [ ] `docs/operations/F107b-actor-merge-runbook.md` written and reviewed
- [ ] Integration test covering AC-16 (concurrent merge race) and AC-22 (full merge) passes
- [ ] Unit tests for `MergeRequestSchema` / `MergeResponseSchema` Zod shapes
- [ ] Web client merge call implemented in `packages/web/` (post-login effect)
- [ ] Web logout handler clears anonymous UUID from localStorage (EC-3 hardening)
- [ ] No linting errors, build succeeds in both `packages/api` and `packages/web`
- [ ] `docs/project_notes/key_facts.md` updated if actor identity facts changed
- [ ] Product tracker updated to mark F107b Done

---

## Workflow Checklist

- [ ] Step 0: `spec-creator` executed, specs updated
- [ ] Step 1: Branch created, ticket generated, tracker updated
- [ ] Step 2: `backend-planner` executed, plan approved
- [ ] Step 3: `backend-developer` executed with TDD
- [ ] Step 4: `production-code-validator` executed, quality gates pass
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 5: `qa-engineer` executed (Standard/Complex)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-05-18 | Spec created | spec-creator agent, F107b |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | Sections verified: (list) |
| 1. Mark all items | [ ] | AC: _/22, DoD: _/14, Workflow: _/8 |
| 2. Verify product tracker | [ ] | Active Session: step _/6, Features table: _/6 |
| 3. Update key_facts.md | [ ] | Updated: (list) / N/A |
| 4. Update decisions.md | [ ] | ADR-XXX added / N/A |
| 5. Commit documentation | [ ] | Commit: (hash) |
| 6. Verify clean working tree | [ ] | `git status`: clean |
| 7. Verify branch up to date | [ ] | merge-base: up to date / merged origin/<branch> |

---

*Ticket created: 2026-05-18*
