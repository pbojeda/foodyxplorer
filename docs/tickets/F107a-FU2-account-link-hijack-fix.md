# F107a-FU2: Account-Link Hijack Fix

**Feature:** F107a-FU2 | **Type:** Backend-Bugfix | **Priority:** High
**Status:** In Progress | **Branch:** feature/F107a-FU2-account-link-hijack-fix
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-05-18 | **Dependencies:** F107a (done)

---

## Spec

### Description

#### Problem Statement

F107a's `/me` endpoint contains a confidentiality breach where the actor-to-account linking step can silently overwrite an actor's `account_id` with a different user's account (`BUG-API-AUTH-ACTOR-HIJACK-001`).

**Empirical reproduction** (`packages/api/src/routes/auth.ts:269-274`):

```sql
UPDATE actors
SET account_id = <bearer's accountId>
WHERE id = <actorId>
  AND account_id IS DISTINCT FROM <bearer's accountId>
```

`IS DISTINCT FROM` evaluates to `TRUE` whenever the left operand differs from the right, including when `account_id` is already set to a *third* account. Concretely:

1. User A signs in with `X-Actor-Id: <uuid>`. Actor gets `account_id = account_A`. Correct.
2. User B (on a shared family browser with the same stored actor UUID) signs in with the same `X-Actor-Id: <uuid>`. The UPDATE fires again because `account_A IS DISTINCT FROM account_B` → `TRUE`. Actor's `account_id` is overwritten to `account_B`. User A's query history (`query_logs.actor_id`) now resolves under User B's account.

**The inverted collision check** (lines 277-292) exacerbates the bug: the `if (updateResult === 0)` branch only fires when the UPDATE was a no-op. A genuine hijack produces `updateResult === 1` (one row changed), so the warn log is never emitted during a real attack. The collision detection is logically inverted and non-functional as written.

#### Threat Model

- **Who can exploit:** Any two Supabase-authenticated users who share a browser profile or a device where `localStorage` contains the same `X-Actor-Id` value. The Vercel Preview URL environment is public-facing; no prior coordination between users is required — a shared family computer or a public device where a prior user did not clear localStorage is sufficient.
- **What they gain:** User B's bearer, combined with User A's stored actor UUID, causes User A's actor row to be re-keyed to account_B. Any future endpoint that surfaces per-account query history (e.g., a history page) would show User A's query history to User B.
- **Blast radius:** Pre-beta only. Zero real production users at this time. However, Vercel Preview URLs are externally accessible, making this exploitable in the preview environment.
- **Severity:** P1 — confidentiality breach with zero friction to trigger.

#### Fix Design

##### SQL change

Replace the `IS DISTINCT FROM` guard with a two-clause safe-state check:

```sql
UPDATE actors
SET account_id = <bearer's accountId>
WHERE id = <actorId>
  AND (account_id IS NULL OR account_id = <bearer's accountId>)
```

This UPDATE only succeeds in two safe states:

- `account_id IS NULL` — actor is anonymous; promote to bearer's account. (Case a: intended behavior.)
- `account_id = bearer's accountId` — actor is already linked to this account; idempotent no-op producing `updateResult = 1` (Postgres UPDATE still counts the row even when the SET changes nothing, but the WHERE clause ensures only safe rows match; we treat both `0` and `1` as acceptable here — see collision logic below).

Any actor already linked to a *different* account produces `updateResult === 0` (no rows matched). This is the real collision.

> Note: when `account_id` already equals bearer's `accountId`, Postgres will UPDATE the row but no net change occurs. `updateResult` will be `1`. This is still safe — no hijack.

##### Collision behavior — graceful fallback (NOT 409)

When `updateResult === 0`:

1. **Confirm true collision** — fetch the actor's current `account_id`:
   - If actor does not exist (`currentActor === null`): something is wrong upstream; the actor was created moments before, so treat as transient and fall through to the `me-<sub>` fallback path.
   - If `currentActor.accountId === null`: actor is anonymous but the UPDATE missed — this should not happen given the WHERE clause; treat as transient, fall through to `me-<sub>` fallback.
   - If `currentActor.accountId === bearer's accountId`: race condition on concurrent calls from the *same* user — idempotent; use the existing actor.
   - If `currentActor.accountId !== null AND currentActor.accountId !== bearer's accountId`: **true collision confirmed.**

2. **On true collision:**
   a. Emit a structured **Pino warn log** (see Observability Spec below).
   b. Emit a **Sentry captureMessage** (see Observability Spec below).
   c. **Fall back to the deterministic `me-<sub.slice(0,8)>` actor** — the same upsert path at `auth.ts:223-230`. This creates/finds a stable fallback actor for the bearer. The fallback actor's `external_id` is namespaced (`me-` prefix) to avoid colliding with anonymous client UUIDs.
   d. **Re-run the safe link UPDATE on the fallback actor** with the same `(account_id IS NULL OR account_id = bearer)` predicate. This is essential — the `me-<sub>` upsert at lines 223-230 does NOT set `account_id`; without this second UPDATE the response would return an actor with `accountId = NULL`, leaving the bearer's session in an unlinked state and breaking future account-scoped queries (per Codex C-I1 R1).
   e. Fetch the final fallback actor state. Assert that `actor.account_id === bearer's accountId`. If not (e.g., another bearer somehow already claimed the `me-<sub>` actor — extremely unlikely given the `me-` prefix is sub-derived), throw a 500 with code `FALLBACK_LINK_FAILED` (this is a defense-in-depth check, not a normal path).
   f. Return **200** with the linked fallback actor. The bearer's session is functional and the response actor has `accountId === bearer's accountId`.

3. **The colliding actor's `account_id` is never changed.** User A's actor remains owned by account_A. The colliding actor row is untouched by step 2.

##### Namespace note (per Codex C-S1 R1)

The fallback `me-<sub.slice(0,8)>` external_id is inherited from F107a's existing logic. It provides ~32 bits of namespace (8 hex chars) — collision probability ≈ 1 in 4 billion for distinct Supabase Auth sub UUIDs. **Acceptable for pre-beta scale**. If user base grows past ~50k authenticated users, revisit (birthday-paradox bound on 32 bits is ~65k for 50%-collision). Not in scope for this hotfix.

##### Code locations to change

- **`packages/api/src/routes/auth.ts`** — the `/me` handler, specifically:
  - **Lines 204-231 STAY unchanged** — the actor upsert (existing X-Actor-Id-bound actor or `me-<sub>` fallback when header is absent). This is the existing F107a logic that resolves `actorId`; it produces a valid actor row in every case before the collision check runs.
  - **Lines 269-274 (the UPDATE clause) — REPLACED** with the new `(account_id IS NULL OR account_id = bearer)` predicate.
  - **Lines 277-292 (the inverted "Identity collision check" block) — REMOVED entirely.** Its `if (updateResult === 0)` branch is replaced by the new collision-detection + graceful-fallback logic described below (Collision behavior — graceful fallback).
- **`packages/api/src/lib/sentry.ts`** — **add a `captureMessage` wrapper** for consistency with the existing `captureException` pattern (init-aware no-op when Sentry was not initialized). Signature:

  ```typescript
  export function captureMessage(
    message: string,
    level: 'warning' | 'error' | 'info',
    context?: SentryContext,
    tags?: Record<string, string>,
  ): void;
  ```

  **Implementation pattern (per Gemini I1 R1)** — use `Sentry.withScope(...)` to apply tags and extras within a scoped block, then call `Sentry.captureMessage(message, level)`:

  ```typescript
  export function captureMessage(message, level, context, tags) {
    if (!initialized) return; // init-aware no-op
    Sentry.withScope((scope) => {
      if (context) scope.setExtras(context as Record<string, unknown>);
      if (tags) scope.setTags(tags);
      Sentry.captureMessage(message, level);
    });
  }
  ```

  **`SentryContext` allowlist extension (per Codex C-I2 R1)** — the existing `SentryContext` interface at `lib/sentry.ts:25-32` enforces a compile-time allowlist (`route`, `method`, `requestId`, `statusCode`, `internalCode`, `actorIdHash`) via the test at `sentry.test.ts:154` (`@ts-expect-error` on non-allowlisted fields). The collision handler needs to attach `collisionActorId`, `victimAccountId`, `hijackerAccountId`, `externalId`. To preserve the PII-scrubbing guarantee:
  - **Add 4 new hash-only fields to `SentryContext`**: `collisionActorIdHash`, `victimAccountIdHash`, `hijackerAccountIdHash`, `externalIdHash`. The handler hashes the raw IDs via the existing `hashActor()` helper (8 hex char deterministic hash) before placing them in the Sentry context. The Pino log keeps the raw UUIDs (server-only stream, not user-facing).
  - The `SentryContext` allowlist test at `sentry.test.ts:154` must be updated to assert the 4 new fields are accepted while non-allowlisted fields still produce `@ts-expect-error`.

  The handler does NOT import `@sentry/node` directly; it uses this wrapper exclusively.
- **`packages/api/src/plugins/actorResolver.ts`** — **no change required.** Reviewed in full (lines 1-188). The `actorResolver` plugin handles the anonymous flow only: it upserts actors by `externalId` via Prisma's upsert (which never sets `account_id`) and sets `request.actorId`. There is no `IS DISTINCT FROM` pattern and no `account_id`-touching UPDATE anywhere in `actorResolver.ts`. The scope of this fix is confined to `auth.ts` + `lib/sentry.ts` (wrapper addition).

##### Implementation note (suggestion for the planner)

The `me-<sub>` fallback path appears twice in the handler after this fix: (a) when `X-Actor-Id` is absent at lines 214-231, and (b) when a collision is detected. Consider extracting a private `provisionFallbackActor(prisma, sub): Promise<{ id: string }>` helper inside `auth.ts` (or a sibling file) to keep the upsert SQL DRY. Optional — the planner makes the call.

##### Out of scope (explicit)

- F107b's actor-merge functionality (closed separately).
- New audit-log DB table (`actor_link_event` or similar). Pino + Sentry is the entire audit surface for this fix.
- GDPR Art. 17 / account deletion handling.
- Multi-device pre-auth history claiming.
- Changes to `actorResolver.ts` or its anonymous-actor upsert path.
- Any change to the `/me` request schema or response schema (response shape is identical).

### API Changes

No change to the `/me` response shape. The endpoint continues to return:

```json
{
  "success": true,
  "data": {
    "account": { ... },
    "actor": {
      "id": "...",
      "type": "anonymous_web",
      "externalId": "...",
      "accountId": "..."
    }
  }
}
```

In the collision path, `actor` now reflects the fallback `me-<sub.slice(0,8)>` actor instead of the colliding actor. From the HTTP client's perspective: 200 with a valid actor. The `api-spec.yaml` `/me` response schema is **unchanged**. No api-spec.yaml update required for this ticket.

### Data Model Changes

No migrations required. No new tables. The fix is purely a runtime SQL predicate change within the existing `actors` table.

Schema reference for context:
- `actors.account_id UUID NULL FK → accounts(id) ON DELETE SET NULL` (Prisma: `Actor.accountId`)
- The `@@unique([type, externalId])` constraint ensures the `me-<sub>` fallback upsert is idempotent.

### UI Changes

None. Backend-only fix.

### Edge Cases & Error Handling

| Scenario | Behavior |
|---|---|
| Actor anonymous (`account_id IS NULL`) + bearer → link | UPDATE matches IS NULL clause → `updateResult ≥ 1` → normal path |
| Actor already linked to same account (idempotent re-call) | UPDATE matches `account_id = bearer's accountId` → `updateResult = 1` → normal path |
| Actor linked to different account (collision) | `updateResult = 0` → confirm → Pino warn + Sentry → fallback to `me-<sub>` actor → 200 |
| Actor does not exist (row deleted between upsert and UPDATE) | `updateResult = 0` → fetch returns null → fall through to `me-<sub>` fallback → 200 |
| `me-<sub>` upsert itself fails (DB unavailable) | Propagates as unhandled exception → 500, same as any DB unavailability today |
| Concurrent `/me` calls from same bearer, same `X-Actor-Id` | First call wins the UPDATE; second call hits the `account_id = bearer's accountId` clause → idempotent 200 |
| Concurrent `/me` calls from two different bearers, same `X-Actor-Id` | One bearer wins the UPDATE. The other gets `updateResult = 0`, detects collision, gets fallback actor. No hijack. |
| `X-Actor-Id` header absent (bearer-only call with no prior actor) | Falls into `me-<sub>` upsert at lines 214-231 — collision logic is never reached |

### Observability Spec

#### Pino warn log (exact field names)

Emitted at `warn` level via `request.log.warn(fields, message)`. Pino is the server-only log stream; raw UUIDs are acceptable here (no PII surface):

```json
{
  "event": "actor_link_collision",
  "collisionActorId": "<UUID of the actor whose account_id was NOT overwritten>",
  "victimAccountId": "<UUID of the account that legitimately owns the colliding actor>",
  "hijackerAccountId": "<UUID of the bearer's account — the one that would have hijacked>",
  "externalId": "<the X-Actor-Id header value that triggered the collision>",
  "requestId": "<Fastify request id>"
}
```

Message string: `"F107a-FU2: actor_link_collision — actor already owned by different account; falling back to me-<sub> actor"`

**Note on field naming** (declined Gemini S1 R1): the alternative naming `existingAccountId`/`bearerAccountId` (matching the existing F107a log at `auth.ts:286`) is declined because (a) that existing log lives inside the inverted `if (updateResult === 0)` block that this hotfix REMOVES — there is no "consistency" target after the fix lands; (b) the `victim`/`hijacker` vocabulary makes the security-event semantics explicit at the log/Sentry layer, which is preferable for triaging actor-hijack incidents in production. This is a deliberate naming choice for security telemetry clarity.

#### Sentry event

Called immediately after the Pino warn via the **project's `captureMessage` wrapper** in `packages/api/src/lib/sentry.ts` (added by this ticket — see Code locations to change). Do NOT import `@sentry/node` directly in the handler; the wrapper provides the init-aware no-op guarantee used everywhere else in the project.

- **Message:** `"actor_link_collision: actor already owned by different account"`
- **Level:** `"warning"`
- **Extra context (Sentry `extra` bag) via the `SentryContext` allowlist — HASHED IDs only** (the allowlist enforcement at `sentry.test.ts:154` is updated to include these 4 new fields):
  - `collisionActorIdHash`: `hashActor(collisionActorId)` — 8 hex chars
  - `victimAccountIdHash`: `hashActor(victimAccountId)` — 8 hex chars
  - `hijackerAccountIdHash`: `hashActor(hijackerAccountId)` — 8 hex chars
  - `externalIdHash`: `hashActor(externalId)` — 8 hex chars
- **PII scrubbing:** raw UUIDs are NOT sent to Sentry — only deterministic 8-hex-char hashes via the existing `hashActor()` helper. This preserves the compile-time `SentryContext` allowlist guarantee at `sentry.test.ts:154`. Correlation between Sentry events and Pino logs is preserved via the deterministic hash function (`hashActor(uuid)` is the same value on both sides).
- **Sentry tags (filterable in Sentry UI):** `{ feature: 'F107a-FU2', event_type: 'actor_link_collision' }`. Tags are NOT subject to the `SentryContext` allowlist (they live on the Sentry scope, separate from `extra`).

#### Runbook

Document in **`docs/operations/supabase-auth-setup.md`** (an existing operations file — append a new section rather than creating a new file):

Section title: `## Triage: actor_link_collision alert`

Content must cover:
- What the alert means (two Supabase users shared a browser with the same `X-Actor-Id` in localStorage).
- How to find the event: Sentry project → filter by tag `event_type: actor_link_collision`. Pino logs: filter by `event = "actor_link_collision"` in the Render log stream.
- What to verify: the `victimAccountId`'s actor row was NOT hijacked (query `SELECT account_id FROM actors WHERE id = '<collisionActorId>'` — should still equal `victimAccountId`).
- Remediation: none required per incident. The system self-healed. The hijacking bearer got a functional `me-<sub>` fallback actor. If the alert fires repeatedly from the same `externalId`/`hijackerAccountId`, consider whether a malicious actor is probing actor IDs.
- Escalation threshold: > 5 events in 60 minutes from distinct `hijackerAccountId` values → investigate for systematic actor-ID enumeration.

---

## Implementation Plan

_Pending — to be generated by the planner agent in Step 2._

---

## Acceptance Criteria

### SQL Correctness
- [ ] **AC1:** The UPDATE predicate in `/me` uses `(account_id IS NULL OR account_id = <bearer's accountId>)` — the `IS DISTINCT FROM <bearer's accountId>` clause is removed entirely.
- [ ] **AC2:** When `account_id IS NULL`, the UPDATE succeeds (`updateResult ≥ 1`) and the actor gains `account_id = bearer's accountId`. Normal response path proceeds with the linked actor.
- [ ] **AC3:** When `account_id` already equals `bearer's accountId`, the UPDATE is idempotent — the actor row is unchanged and the response returns the same actor. (Concurrent same-user calls produce the same 200 response.)

### Collision Detection
- [ ] **AC4:** When `updateResult === 0`, the handler fetches `actor.accountId`. If it is non-NULL and not equal to the bearer's `accountId`, a true collision is confirmed.
- [ ] **AC5:** On true collision, the colliding actor's `account_id` is **never** changed. A subsequent `SELECT account_id FROM actors WHERE id = <collisionActorId>` returns the original `victimAccountId`.
- [ ] **AC6:** On true collision, the response HTTP status is **200** (not 409). The bearer's request succeeds.

### Observability
- [ ] **AC7:** On true collision, a Pino warn log is emitted with exactly the fields: `event`, `collisionActorId`, `victimAccountId`, `hijackerAccountId`, `externalId`, `requestId`.
- [ ] **AC8:** On true collision, the project's `captureMessage` wrapper (in `packages/api/src/lib/sentry.ts`) is called with level `"warning"`, the message `"actor_link_collision: actor already owned by different account"`, the extra context fields, and the Sentry tags `{ feature: 'F107a-FU2', event_type: 'actor_link_collision' }`. The handler does NOT import `@sentry/node` directly.
- [ ] **AC8b (Gemini I2 R1 + Codex C-I2 R1):** `packages/api/src/lib/sentry.ts` exports a new `captureMessage(message, level, context, tags)` function implemented via `Sentry.withScope` (sets extras + tags within scope, then calls `Sentry.captureMessage`). Init-aware no-op when Sentry is uninitialized. Unit tests for the wrapper MUST use the existing `__resetForTests()` helper and cover:
  - (a) Uninitialized state: `captureMessage(...)` is called → underlying `@sentry/node` `Sentry.captureMessage` is NOT invoked (mock asserts zero calls).
  - (b) Initialized state: `captureMessage(...)` is called → `Sentry.captureMessage(message, level)` IS invoked exactly once; `scope.setExtras(context)` and `scope.setTags(tags)` are both invoked with the provided values.
  - (c) Compile-time `SentryContext` allowlist: the `sentry.test.ts:154` `@ts-expect-error` test is updated to include the 4 new allowlisted fields (`collisionActorIdHash`, `victimAccountIdHash`, `hijackerAccountIdHash`, `externalIdHash`) AND assert that a non-allowlisted field still produces `@ts-expect-error`.

### Fallback Actor
- [ ] **AC9:** On true collision, the response `data.actor` reflects the `me-<sub.slice(0,8)>` fallback actor (not the colliding actor). The fallback actor's `externalId` matches `me-${payload.sub.slice(0, 8)}`.
- [ ] **AC9b (Codex C-I1 R1):** On true collision, the response `data.actor.accountId === bearer's accountId`. The fallback actor is linked to the bearer's account via the safe UPDATE clause AFTER the me-<sub> upsert (the upsert alone does NOT set account_id; the spec mandates a second UPDATE call). A direct DB assertion `SELECT account_id FROM actors WHERE id = <fallback.id>` returns the bearer's accountId.
- [ ] **AC10:** The `me-<sub>` fallback upsert is idempotent: if called twice for the same bearer, the same actor row is returned both times (no `P2002` unique-constraint error).

### Tests
- [ ] **AC11:** Unit test (mocked Prisma): `updateResult = 0` + actor has different `accountId` → collision branch fires, Pino warn emitted, fallback actor returned. Uses `vi.fn()` mocks, no DB required.
- [ ] **AC12:** Integration test against the real Postgres test container (port 5433, `foodxplorer_test` DB): Two Supabase accounts (A and B), both call `GET /me` with the same `X-Actor-Id`. Account A calls first → actor linked to account_A. Account B calls second → `updateResult = 0` detected → fallback actor returned → **B's response actor satisfies: `externalId` starts with `me-`, `accountId === account_B.id`** (verified via SELECT) — AND original actor's `account_id` is still account_A.id (verified via SELECT) — confirms (1) no hijack, (2) B got a linked fallback (not unlinked).
- [ ] **AC13:** Regression: all existing F107a integration and unit tests continue to pass (no new failures beyond pre-existing BUG-API-HEALTH-PRISMA-MOCK-001 baseline).
- [ ] **AC14:** Concurrent `/me` test: two parallel calls from the same bearer + same `X-Actor-Id` → both return 200 with the same actor (idempotent). No `P2002` error thrown.

### Constraints
- [ ] **AC15:** No new database table is created. No migration file is added. The fix is runtime-only DML + a TypeScript-level Sentry wrapper addition.
- [ ] **AC16 (Runbook):** `docs/operations/supabase-auth-setup.md` includes a `## Triage: actor_link_collision alert` section covering Sentry/Pino query steps, verification query, remediation, and escalation threshold.

---

## Definition of Done

- [ ] All 17 acceptance criteria met (16 numbered + AC8b wrapper coverage + AC9b fallback-link guarantee)
- [ ] Unit tests (AC11) and integration tests (AC12, AC13, AC14) written and passing
- [ ] `actorResolver.ts` confirmed clear (no `IS DISTINCT FROM` on `account_id`) — no change needed
- [ ] `lib/sentry.ts` exports `captureMessage` wrapper + unit test
- [ ] Inverted `if (updateResult === 0)` block at original `auth.ts:277-292` fully removed (not just disabled)
- [ ] Code follows project standards (Pino log format, Sentry PII policy)
- [ ] No linting or typecheck errors
- [ ] Build succeeds
- [ ] `docs/project_notes/bugs.md` entry `BUG-API-AUTH-ACTOR-HIJACK-001` status updated to "Fixed by F107a-FU2" with commit reference
- [ ] `docs/operations/supabase-auth-setup.md` runbook section added
- [ ] `api-spec.yaml` confirmed unchanged (response shape identical — no update needed)
- [ ] `docs/project_notes/key_facts.md` reviewed — no new entries required for this fix

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, R1 + R2 cross-model APPROVED (Codex + Gemini converged)
- [x] Step 1: Branch `feature/F107a-FU2-account-link-hijack-fix` created off develop@3bb9e8b; ticket Status → In Progress; tracker updated
- [ ] Step 2: `backend-planner` executed, plan approved
- [ ] Step 3: `backend-developer` executed with TDD
- [ ] Step 4: `production-code-validator` executed, quality gates pass
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 5: `qa-engineer` executed
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-05-18 | Step 0 Spec drafted | spec-creator agent. actorResolver.ts confirmed clear — no IS DISTINCT FROM on account_id. Scope confined to auth.ts only. |
| 2026-05-18 | Step 1 Setup | Branch `feature/F107a-FU2-account-link-hijack-fix` off develop@3bb9e8b. Ticket Status → In Progress. Tracker updated with step 1/6. Spec content committed to branch (next commit). |
| 2026-05-18 | Spec self-review | 3 IMPORTANT + 3 SUGGESTION findings all applied: (I1) explicit removal of inverted `if (updateResult === 0)` block at orig lines 277-292; (I2) explicit preservation of actor upsert at orig lines 204-231; (I3) `captureMessage` wrapper added to `lib/sentry.ts` instead of importing `@sentry/node` directly (consistent with project init-aware pattern); (S1) helper extraction suggestion `provisionFallbackActor` noted to planner; (S2) explicit `### Out of scope` section added; (S3) test harness reuses existing F107a JWT mock pattern. AC count 15 → 16 (AC8b wrapper coverage). |
| 2026-05-18 | Spec /review-spec R1 | Codex + Gemini parallel. Both VERDICT: REVISE. Codex 2 IMPORTANT + 1 SUGGESTION + Gemini 2 IMPORTANT + 1 SUGGESTION. Applied: F1 fallback actor must re-run safe UPDATE on me-<sub> to link to bearer (was unlinked → bug fix gap; AC9b added); F2 SentryContext allowlist requires extending with 4 new hash-only fields + `hashActor()` for IDs (preserves PII guarantee); F3 wrapper uses `Sentry.withScope` pattern; F4 AC8b explicit on `__resetForTests()` + 3 sub-cases (uninitialized no-op, initialized call, allowlist enforcement); F5 32-bit namespace limitation documented. Declined: F6 (renaming `victim/hijacker` → `existing/bearer` — legacy log being deleted, victim/hijacker is semantically clearer for security telemetry; decision recorded inline). AC count 16 → 17 (AC9b added). |
| 2026-05-18 | Spec /review-spec R2 | Codex + Gemini parallel. BOTH APPROVED. All 5 R1 findings verified closed: F1 step 2.d + AC9b pin the DB-linked guarantee; F2 hash split (Pino raw / Sentry hashed) preserves PII scrubbing per truncated-SHA256 `hashActor`; F3 `withScope` is correct Sentry v7+ pattern; F4 AC8b 3 sub-cases sufficient with `__resetForTests()`; F5 namespace note acknowledges 32-bit constraint as hotfix-acceptable. F6 decline confirmed defensible. No new MVCC/race/isolation/observability issues. Confidence > 85% per memory rule — spec LOCKED. |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | Sections verified: (list) |
| 1. Mark all items | [ ] | AC: _/17, DoD: _/12, Workflow: _/8 |
| 2. Verify product tracker | [ ] | Active Session: step _/6, Features table: _/6 |
| 3. Update key_facts.md | [ ] | N/A — no new architectural facts |
| 4. Update decisions.md | [ ] | N/A — no new ADR; fix is a bug correction within ADR-025 R3 bounds |
| 5. Commit documentation | [ ] | Commit: (hash) |
| 6. Verify clean working tree | [ ] | `git status`: clean |
| 7. Verify branch up to date | [ ] | merge-base: up to date / merged origin/<branch> |

---

*Ticket created: 2026-05-18*
