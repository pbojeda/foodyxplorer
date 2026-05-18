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

### Existing Code to Reuse

- `packages/api/src/lib/sentry.ts` — `hashActor()`, `__resetForTests()`, `initialized` flag, `captureException()` implementation pattern, and `SentryContext` interface (all extended/called by this fix, never replaced).
- `packages/api/src/routes/auth.ts:204-231` — the existing actor upsert block (X-Actor-Id path at lines 201-212 and `me-<sub>` fallback at lines 214-231). This exact code becomes the template for the private `provisionFallbackActor` helper AND is reused by the collision branch.
- `packages/api/src/__tests__/f107a/f107a.authRoutes.integration.test.ts` — `makeValidJwt()`, `buildApp()`, `testConfig`, `prisma` fixture setup, and the `mockVerifyBearerJwt` pattern are all reused verbatim by the new AC12 integration test file.
- `packages/api/src/__tests__/lib/sentry.test.ts` — `vi.mock('@sentry/node', ...)` block, `mockedInit`, `__resetForTests()` import, and describe/it scaffolding reused for the `captureMessage` wrapper tests (AC8b).
- Fixture UUID prefix `f1070000-` for the existing integration test. The new AC12 integration test MUST use a distinct prefix (`f1072-` or similar — planner recommends `fua20000-` for FU2) to prevent cross-test fixture collisions.

---

### Files to Create

| File | Purpose |
|---|---|
| `packages/api/src/__tests__/f107a/f107aFU2.collision.integration.test.ts` | AC12, AC13 (regression), AC14 (concurrent) integration tests against real Postgres test container. Two-bearer hijack scenario. |
| `packages/api/src/__tests__/f107a/f107aFU2.collision.unit.test.ts` | AC11 unit test (mocked Prisma): `updateResult=0` + different `accountId` → collision branch fires. AC2, AC3 happy-path via mocks. |

---

### Files to Modify

| File | What changes |
|---|---|
| `packages/api/src/lib/sentry.ts` | (1) Extend `SentryContext` with 4 new hash fields. (2) Add `captureMessage` export using `Sentry.withScope`. (3) Add `withScope` to the `vi.mock` block in the test — but this is the test file, not here. |
| `packages/api/src/__tests__/lib/sentry.test.ts` | (1) Add `withScope` mock to `vi.mock('@sentry/node', ...)` block. (2) Add `captureMessage` to the import. (3) Extend test 9 (allowlist) to include 4 new hash fields. (4) Add 3 new tests for AC8b `captureMessage` wrapper (uninitialized no-op, initialized call, allowlist compile-time). |
| `packages/api/src/routes/auth.ts` | (1) Add `import { captureMessage, hashActor } from '../lib/sentry.js'`. (2) Optionally extract `provisionFallbackActor` private helper. (3) Replace lines 269-292: new predicate + collision detection + fallback logic. |
| `docs/operations/supabase-auth-setup.md` | Append `## Triage: actor_link_collision alert` section (AC16/runbook). |
| `docs/project_notes/bugs.md` | Update `BUG-API-AUTH-ACTOR-HIJACK-001` status line to "Fixed by F107a-FU2 — commit <hash>" (done in Step 3 closing commit). |

---

### Implementation Order

The developer agent MUST follow TDD: RED test first, then production code to make it GREEN. Each phase is a commit-ready unit.

**Total estimated effort (post R1 review): 4-5h** (originally 3.5h, calibrated up per Codex P-S2 R1 after strengthening AC1/AC10/PI4 work).

#### Phase 1 — Sentry wrapper (AC8b) — estimated 0.5h

**Step 1a (RED):** In `packages/api/src/__tests__/lib/sentry.test.ts`:
1. Add `withScope: vi.fn((cb) => cb(mockScope))` to the existing `vi.mock('@sentry/node', ...)` block (a `mockScope` object with `setExtras: vi.fn()` and `setTags: vi.fn()`). Also add `captureMessage: vi.fn()` to the mock.
2. Add `captureMessage` to the import from `../../lib/sentry.js`.
3. Add test 9-extended: update test "9. SentryContext rejects non-allowlisted fields at compile time" to also assert `collisionActorIdHash`, `victimAccountIdHash`, `hijackerAccountIdHash`, `externalIdHash` are accepted by `SentryContext` — and that a non-allowlisted field `foo` still produces `@ts-expect-error`.
4. Add three new tests (AC8b sub-cases):
   - "10. captureMessage is a no-op when not initialized": call `captureMessage('msg', 'warning')` without initializing → `Sentry.captureMessage` not called, `Sentry.withScope` not called.
   - "11. captureMessage calls withScope, setExtras, setTags, and Sentry.captureMessage when initialized": call `initSentry(dsn, 'production')`, then `captureMessage('msg', 'warning', ctx, tags)` → `withScope` called once; within scope: `mockScope.setExtras(ctx)` and `mockScope.setTags(tags)` called; `Sentry.captureMessage('msg', 'warning')` called once.
   - "12. captureMessage with no context/tags: withScope still called, setExtras and setTags skipped": assert conditional guards work when `context` and `tags` are undefined.
   These tests will FAIL because `captureMessage` does not exist yet.

**Step 1b (GREEN):** In `packages/api/src/lib/sentry.ts`:
1. Extend `SentryContext` interface with 4 fields: `collisionActorIdHash?: string`, `victimAccountIdHash?: string`, `hijackerAccountIdHash?: string`, `externalIdHash?: string`.
2. Add `captureMessage` export after `captureException`:
   ```
   export function captureMessage(
     message: string,
     level: 'warning' | 'error' | 'info',
     context?: SentryContext,
     tags?: Record<string, string>,
   ): void {
     if (!initialized) return;
     Sentry.withScope((scope) => {
       if (context) scope.setExtras(context as Record<string, unknown>);
       if (tags) scope.setTags(tags);
       Sentry.captureMessage(message, level);
     });
   }
   ```
3. Run sentry tests → all GREEN.

**Commit:** "feat(sentry): add captureMessage wrapper + extend SentryContext allowlist (F107a-FU2 AC8b)"

---

#### Phase 2 — Unit tests for auth.ts collision branch (AC11, AC2, AC3) — estimated 1h

**Step 2a (RED):** Create `packages/api/src/__tests__/f107a/f107aFU2.collision.unit.test.ts`.

This file mocks Prisma client (via `vi.fn()`) and `mockVerifyBearerJwt` + `buildApp`. It does NOT use the real DB.

Mock strategy: inject a mock `prisma` that allows the developer to control the return values of `$executeRaw` (for both the accounts upsert and the actors UPDATE) and `actor.findUnique` / `actor.upsert` / `actor.findUniqueOrThrow`.

Key test cases — TDD veracity calibrated per Codex P-I2 R1 + R2-PI1: **labels honestly distinguish three test kinds**:

- `[PURE RED]` — cannot pass against buggy F107a code under any mock arrangement (the new captureMessage import/call, fallback path, or specific error code don't exist in old code).
- `[SQL-SHAPE]` — inspects the `$executeRaw` tagged template strings array literally (only way to assert predicate text from a mock-only test).
- `[HAPPY-REGRESSION]` — happy-path regression test; both old and new code produce the same external behavior here, so the test is a non-regression guard rather than a bug-detection signal.

Test cases:

- **AC1 [SQL-SHAPE]:** Capture the first `$executeRaw` call. The tagged template strings array (`call.args[0]`) must contain `(account_id IS NULL OR account_id =` literally and must NOT contain `IS DISTINCT FROM`. Vitest assertion pattern: `expect(executeRawSpy.mock.calls[0][0].join('')).toContain('(account_id IS NULL OR account_id =')` AND `.not.toContain('IS DISTINCT FROM')`.
- **AC2 [HAPPY-REGRESSION]:** `$executeRaw` returns `1` for the UPDATE (anonymous actor newly linked) → normal path → `actor.findUniqueOrThrow` called with the ORIGINAL `actorId` (not reassigned) → 200 with `actor.accountId === bearerAccountId`. **Old and new code both pass this test** — included as regression guard for the happy path.
- **AC3 [HAPPY-REGRESSION]:** `$executeRaw` returns `1` (already linked, idempotent) → same 200 path, `prisma.actor.upsert` NOT called for fallback. Old and new code both pass.
- **AC11 collision [PURE RED]:** `$executeRaw` (UPDATE) returns `0` → `actor.findUnique` returns actor with `accountId !== bearerAccountId` → assert: (a) `request.log.warn` called once with the exact 6-field object; (b) `captureMessage` mock called once with the exact spec signature; (c) `prisma.actor.upsert` called for `me-${sub.slice(0,8)}`; (d) second `$executeRaw` targets fallback actor's id; (e) link-check `findUnique` called with fallback.id; (f) final `findUniqueOrThrow` called with FALLBACK id (not original); (g) 200 with `actor.id === fallback.id` and `actor.accountId === bearerAccountId`. **Old buggy code lacks captureMessage call entirely** — pure red.
- **AC5 [PURE RED via integration].** Mock-only AC5 ("collision actor untouched") cannot be made pure-red because the old code's `$executeRaw` runs the same SET (the difference is the WHERE predicate matching 0 rows). DB-level verification belongs to AC12 integration test (which asserts `SELECT account_id FROM actors WHERE id = collisionActorId` returns `victimAccountId`, not `hijackerAccountId`). Mark AC5 as **integration-level** — not unit-test territory.
- **AC7 (Pino fields) — embedded in AC11 [PURE RED]:** explicit assertion on every field name and value.
- **AC8 (captureMessage args) — embedded in AC11 [PURE RED]:** explicit assertion on hashed-context fields + tags.
- **AC10 fallback idempotency [PURE RED]:** Two sequential calls to `/me` with same bearer + same colliding `X-Actor-Id`. Mock `prisma.actor.upsert` to return the SAME `{ id }` both times (mirrors real Prisma `@@unique([type, externalId])` behavior). Assert: both calls succeed, both return same `actor.id`, no `P2002`. Old buggy code never enters the fallback path → cannot satisfy these assertions.
- **updateResult=0 + same accountId race [HAPPY-REGRESSION]:** `actor.findUnique` returns `accountId === bearerAccountId` → `isSameAccountRace = true` → fallback SKIPPED → 200. Old code reaches the same outcome through a different (also benign) path; the assertion `prisma.actor.upsert NOT called` passes against both. Regression guard.
- **updateResult=0 + null actor [PURE RED]:** `actor.findUnique` returns `null` → COMMON fallback path without telemetry → 200 with fallback actor (reassigned `actorId`). **Old code throws** in this case because its `findUniqueOrThrow` at the bottom is called with the original deleted `actorId` → 500. Pure red.
- **updateResult=0 + null accountId [PURE RED]:** `actor.findUnique` returns `accountId: null` → COMMON fallback path without telemetry → 200 with fallback. Old code returns 200 but with `actor.accountId === null` (unlinked). **Asserting `response.json().data.actor.accountId === bearerAccountId` fails against old code** (it returns null) → pure red.
- **FALLBACK_LINK_FAILED defense [PURE RED]:** Mock the link-check `findUnique` to return `accountId !== bearerAccountId` → handler throws Error with `code: 'FALLBACK_LINK_FAILED'` → 500. Old code has no such error code or check → pure red.

Summary of label distribution: **8 [PURE RED]**, **1 [SQL-SHAPE]**, **3 [HAPPY-REGRESSION]**, **1 integration-only**. The TDD claim now stands honestly per R2-PI1.

**Step 2b (GREEN):** Modify `packages/api/src/routes/auth.ts`:
1. Add import at top: `import { captureMessage, hashActor } from '../lib/sentry.js';`
2. **RECOMMENDED — extract `provisionFallbackActor` helper** (private module-level async function). Takes `(prisma, sub)` and returns `Promise<{ id: string }>`. Contains the exact upsert code from lines 223-230. Reused in 2 places after the fix (original `!actorId` path + collision/transient branch). See § `provisionFallbackActor` helper decision below for the exact code.
3. Replace lines 269-292 (the `IS DISTINCT FROM` UPDATE + the inverted `if (updateResult === 0)` block) with the structure below.

**Restructured to fix Gemini+Codex CRITICAL (R1 plan review)**: the original snippet had `currentActor === null` and `currentActor.accountId === null` "fall through" to the existing `findUniqueOrThrow`, which would throw (null actor) or return an unlinked actor (null accountId). The fix is to route ALL three non-idempotent sub-paths (null actor, null accountId, true collision) into a COMMON fallback-provisioning block, with the warn-log + Sentry emission gated on `isTrueCollision`. Only `isSameAccountRace` keeps the original `actorId` and falls through to the existing final fetch. This eliminates the early return entirely — no need to hoist `accountForResponse` or `toIso`; the existing final fetch and response construction code handles all cases via the reassigned `actorId`.

   ```typescript
   // Safe link UPDATE: only matches actor rows in two safe states:
   //   (a) account_id IS NULL — anonymous actor, promote to bearer's account
   //   (b) account_id = accountId — already linked to same account, idempotent
   const updateResult = await prisma.$executeRaw`
     UPDATE actors
     SET account_id = ${accountId}::uuid
     WHERE id = ${actorId}::uuid
       AND (account_id IS NULL OR account_id = ${accountId}::uuid)
   `;

   if (updateResult === 0) {
     // Fetch to determine which sub-path we're in.
     const currentActor = await prisma.actor.findUnique({
       where: { id: actorId },
       select: { accountId: true, externalId: true },
     });

     const isSameAccountRace =
       currentActor !== null && currentActor.accountId === accountId;
     const isTrueCollision =
       currentActor !== null &&
       currentActor.accountId !== null &&
       currentActor.accountId !== accountId;

     if (!isSameAccountRace) {
       // Three sub-paths converge here:
       //   1. currentActor === null              (actor row deleted — transient)
       //   2. currentActor.accountId === null    (UPDATE missed — MVCC artifact)
       //   3. isTrueCollision                    (actor owned by different account)
       // All three need a working linked fallback actor for the bearer.
       // Only sub-path 3 emits the security telemetry.

       if (isTrueCollision && currentActor) {
         request.log.warn(
           {
             event: 'actor_link_collision',
             collisionActorId: actorId,
             victimAccountId: currentActor.accountId,
             hijackerAccountId: accountId,
             externalId: currentActor.externalId,
             requestId: request.id,
           },
           'F107a-FU2: actor_link_collision — actor already owned by different account; falling back to me-<sub> actor',
         );

         captureMessage(
           'actor_link_collision: actor already owned by different account',
           'warning',
           {
             collisionActorIdHash: hashActor(actorId),
             victimAccountIdHash: hashActor(currentActor.accountId),
             hijackerAccountIdHash: hashActor(accountId),
             externalIdHash: hashActor(currentActor.externalId),
           },
           { feature: 'F107a-FU2', event_type: 'actor_link_collision' },
         );
       }

       // Common fallback path (all 3 sub-paths).
       const fallbackActor = await provisionFallbackActor(prisma, payload.sub);

       // Re-run the safe link UPDATE on the fallback actor.
       // The upsert does NOT set account_id; this UPDATE links it.
       await prisma.$executeRaw`
         UPDATE actors
         SET account_id = ${accountId}::uuid
         WHERE id = ${fallbackActor.id}::uuid
           AND (account_id IS NULL OR account_id = ${accountId}::uuid)
       `;

       // Defense-in-depth: confirm the fallback is linked.
       const linkCheck = await prisma.actor.findUnique({
         where: { id: fallbackActor.id },
         select: { accountId: true },
       });
       if (linkCheck?.accountId !== accountId) {
         throw Object.assign(
           new Error('Fallback actor could not be linked to bearer account'),
           { code: 'FALLBACK_LINK_FAILED' },
         );
       }

       // Re-target `actorId` so the existing final fetch + response
       // construction (lines 297+ in the original file) operates on the
       // fallback. NO early return; NO hoisting of accountForResponse needed.
       actorId = fallbackActor.id;
     }
     // isSameAccountRace: actorId unchanged → existing final fetch is idempotent.
   }
   ```

4. **No hoisting required** — the refactor above eliminates the early `return reply...` inside the collision branch by re-targeting `actorId` and letting the existing final fetch + `accountForResponse` construction at lines 297-339 of the original file proceed unchanged. The `toIso` helper and `accountForResponse` keep their original positions.

Run unit tests → GREEN.

**Commit:** "fix(auth): replace IS DISTINCT FROM with safe predicate + collision fallback (F107a-FU2 AC1-AC11)"

---

#### Phase 3 — Integration verification (AC9, AC9b, AC12, AC13, AC14) — estimated 1.5-2h

**Honest TDD labeling (per Codex P-I3 R1):** Phase 3 tests are **post-GREEN integration verification**, NOT strict TDD RED-before-GREEN. They run against the live HTTP handler + real Postgres to confirm the unit-test mocks weren't lying. Phase 2's unit tests are the strict RED-GREEN drivers; Phase 3 is the empirical safety net.

**Step 3a:** Create `packages/api/src/__tests__/f107a/f107aFU2.collision.integration.test.ts`.

**Mock pattern** (identical to existing F107a integration test):
- `vi.mock('@supabase/supabase-js', ...)` — mock `createClient`
- `vi.mock('../../plugins/authBearer.js', ...)` — mock `verifyBearerJwt` as `mockVerifyBearerJwt`
- Dynamic `await import('../../app.js')` after mocks

**Two distinct Supabase user IDs (fixture UUIDs — distinct first-8-hex per Codex P-I4 R1):**

The fallback actor key is `me-${sub.slice(0, 8)}`. If both fixture subs share the first 8 hex chars, they collide on the same fallback actor row (defeating the test isolation). The fixtures MUST therefore differ in the first 8 chars:

```typescript
const AUTH_USER_A_ID = 'fua20001-0000-4000-a000-000000000001'; // sub for User A → fallback me-fua20001
const AUTH_USER_B_ID = 'fua20002-0000-4000-a000-000000000002'; // sub for User B → fallback me-fua20002
const AUTH_USER_C_ID = 'fua20003-0000-4000-a000-000000000003'; // sub for User C (AC14 idempotency) → fallback me-fua20003
const SHARED_ACTOR_EXT_ID = 'fua20000-e001-4000-a000-000000000001'; // AC12: shared X-Actor-Id (anonymous actor)
const IDEMPOTENT_ACTOR_EXT_ID = 'fua20000-e002-4000-a000-000000000002'; // AC14: separate fixture, anonymous, used by both parallel calls
const FALLBACK_A_EXT_ID = 'me-fua20001';
const FALLBACK_B_EXT_ID = 'me-fua20002';
const FALLBACK_C_EXT_ID = 'me-fua20003';
```

**`beforeAll` (pre-cleanup must include ALL fixtures per Codex P-I4 R1 + R2-PI2):**

```sql
-- Reverse FK order: actors first (they reference accounts).
DELETE FROM actors WHERE external_id IN (
  'fua20000-e001-4000-a000-000000000001',  -- SHARED_ACTOR_EXT_ID (AC12)
  'fua20000-e002-4000-a000-000000000002',  -- IDEMPOTENT_ACTOR_EXT_ID (AC14)
  'me-fua20001',                            -- FALLBACK_A
  'me-fua20002',                            -- FALLBACK_B
  'me-fua20003'                             -- FALLBACK_C (AC14 — if hijack path triggers; harmless if not)
);
DELETE FROM accounts WHERE auth_user_id IN (
  'fua20001-0000-4000-a000-000000000001'::uuid,
  'fua20002-0000-4000-a000-000000000002'::uuid,
  'fua20003-0000-4000-a000-000000000003'::uuid
);
```

Then create the two anonymous actor rows: `SHARED_ACTOR_EXT_ID` (for AC12) and `IDEMPOTENT_ACTOR_EXT_ID` (for AC14), both with `type='anonymous_web'`, `account_id = NULL`.

**`afterAll`:** identical DELETE statements as `beforeAll` (cleanup all shared actors, all `me-<sub>` fallbacks, all accounts).

**`beforeEach` for AC10 (between the two `/me` calls of the idempotency test):** no additional cleanup — the test relies on the SAME state surviving between calls.

**`makeJwtForUser(sub, email)`:** Same pattern as existing `makeValidJwt` — signs with the local `privateKey` from `generateKeyPair('RS256')`. `mockVerifyBearerJwt` is configured per-test to return the desired payload.

**AC12 test ("two-bearer hijack prevention"):**
```
// Arrange: User A calls /me with shared actor — actor gets linked to account_A.
mockVerifyBearerJwt.mockResolvedValueOnce({ sub: AUTH_USER_A_ID, email: 'a@example.com', ... });
const res1 = await app.inject({ method: 'GET', url: '/me', headers: { authorization: bearerA, 'x-actor-id': SHARED_ACTOR_EXT_ID } });
expect(res1.statusCode).toBe(200);
expect(res1.json().data.actor.accountId).toBeDefined();

// Act: User B calls /me with the SAME shared actor.
mockVerifyBearerJwt.mockResolvedValueOnce({ sub: AUTH_USER_B_ID, email: 'b@example.com', ... });
const res2 = await app.inject({ method: 'GET', url: '/me', headers: { authorization: bearerB, 'x-actor-id': SHARED_ACTOR_EXT_ID } });
expect(res2.statusCode).toBe(200);  // AC6: 200, not 409

// Assert (B): fallback actor returned (AC9)
const actorB = res2.json().data.actor;
expect(actorB.externalId).toMatch(/^me-/);  // AC9: externalId starts with "me-"
expect(actorB.id).not.toBe(res1.json().data.actor.id);  // R2-S1 Gemini: explicit different-actor assertion at response level

// DB assertion (AC9b): fallback actor is linked to account_B
const accountBRow = await prisma.$queryRaw`SELECT id FROM accounts WHERE auth_user_id = ${AUTH_USER_B_ID}::uuid`;
const accountBId = accountBRow[0].id;
const fallbackRow = await prisma.$queryRaw`SELECT account_id FROM actors WHERE id = ${actorB.id}::uuid`;
expect(fallbackRow[0].account_id).toBe(accountBId);  // AC9b: linked

// DB assertion (AC5): original actor's account_id is still account_A's id
const accountARow = await prisma.$queryRaw`SELECT id FROM accounts WHERE auth_user_id = ${AUTH_USER_A_ID}::uuid`;
const accountAId = accountARow[0].id;
const originalRow = await prisma.$queryRaw`SELECT account_id::text FROM actors WHERE external_id = ${SHARED_ACTOR_EXT_ID}`;
expect(originalRow[0].account_id).toBe(accountAId);  // AC5: no hijack
```

**AC14 test ("concurrent same-bearer same-actor → idempotent"):**
```typescript
// Arrange: two parallel /me calls, same sub (User C), same x-actor-id
mockVerifyBearerJwt.mockResolvedValue({ sub: AUTH_USER_C_ID, email: 'c@example.com', ... });
const [r1, r2] = await Promise.all([
  app.inject({ method: 'GET', url: '/me', headers: { authorization: bearerC, 'x-actor-id': IDEMPOTENT_ACTOR_EXT_ID } }),
  app.inject({ method: 'GET', url: '/me', headers: { authorization: bearerC, 'x-actor-id': IDEMPOTENT_ACTOR_EXT_ID } }),
]);
expect(r1.statusCode).toBe(200);
expect(r2.statusCode).toBe(200);
// Both return same actor id (idempotent — first call linked it, second call's safe UPDATE matches the `account_id = bearer` clause)
expect(r1.json().data.actor.id).toBe(r2.json().data.actor.id);
expect(r1.json().data.actor.accountId).toBeDefined();
```

These tests are GREEN as soon as Phase 2 commits — they are NOT strict TDD RED-before-GREEN per Codex P-I3 R1 honest labeling. They serve as the empirical verification that the mock-driven unit tests in Phase 2 weren't lying about real Prisma + Postgres behavior. AC13 (no regressions) is satisfied by re-running the existing F107a test suite as part of this phase.

**Step 3b:** Run the full existing F107a integration test file (`f107a.authRoutes.integration.test.ts`) to confirm AC13 (no regressions). Identify any test that asserted the old hijack behavior (i.e., a test that expected the actor's `account_id` to be overwritten). Based on reading the existing file, no such test exists — all existing `/me` tests use a single bearer or reset state before each test. Developer must verify by running and confirm no failures.

**Commit:** "test(f107a-fu2): add collision integration + regression tests (AC12-AC14)"

---

#### Phase 4 — Documentation (AC16, DoD) — estimated 0.5h

**Step 4a:** Append to `docs/operations/supabase-auth-setup.md` (after the "F107a-FU1 Placeholder" section at the end):

```markdown
## Triage: actor_link_collision alert

### What the alert means

Two Supabase-authenticated users shared a browser/device where the same anonymous actor UUID was stored in `localStorage` under `X-Actor-Id`. User A linked the actor to their account first. User B presented the same actor UUID with a different bearer; the safe UPDATE predicate (`account_id IS NULL OR account_id = bearer`) returned 0 rows, confirming User A still owns the actor. The system self-healed: User B received a new `me-<sub>` fallback actor linked to their account. No confidentiality breach occurred.

### How to find the event

- **Sentry:** Open the project → Issues → filter by tag `event_type: actor_link_collision`. Each event includes hashed IDs for correlation.
- **Pino (Render log stream):** Filter log stream by `event = "actor_link_collision"`. Raw UUIDs are present in the Pino log for DB-level verification.

### Verification query

Confirm the victim actor was NOT hijacked:

```sql
SELECT account_id FROM actors WHERE id = '<collisionActorId from Pino log>';
-- Should still equal victimAccountId from the same log entry.
```

### Remediation

None required per incident. The system self-healed; the hijacking bearer received a functional `me-<sub>` fallback actor linked to their account.

If the same `hijackerAccountId` or `externalId` appears repeatedly (> 5 events within 60 minutes from distinct `hijackerAccountId` values), consider whether a malicious actor is probing actor IDs systematically.

### Escalation threshold

> 5 `actor_link_collision` events in 60 minutes from **distinct** `hijackerAccountId` values → investigate for systematic actor-ID enumeration. Review Sentry by tag `feature: F107a-FU2`.
```

**Step 4b (closing commit in Step 3):** Update `docs/project_notes/bugs.md` line 20 to change `[P1 OPEN — fix in progress F107a-FU2]` to `[P1 FIXED — F107a-FU2 commit <hash>]`. The developer agent fills in the actual commit hash after the implementation commit.

**Commit:** "docs: add actor_link_collision runbook + close BUG-API-AUTH-ACTOR-HIJACK-001 (F107a-FU2 AC16)"

---

### TDD Order by AC

| AC | Test file | Phase | Test written before / after prod change |
|---|---|---|---|
| AC8b (a) uninitialized no-op | `sentry.test.ts` | 1 | Before `captureMessage` added to `sentry.ts` |
| AC8b (b) initialized call | `sentry.test.ts` | 1 | Before `captureMessage` added to `sentry.ts` |
| AC8b (c) allowlist compile-time | `sentry.test.ts` | 1 | Before 4 fields added to `SentryContext` |
| AC1, AC2, AC3 (SQL predicate) | `fU2.collision.unit.test.ts` | 2 | Before auth.ts change |
| AC4, AC5, AC11 (collision branch + Pino + Sentry) | `fU2.collision.unit.test.ts` | 2 | Before auth.ts change |
| AC6 (200 on collision) | `fU2.collision.unit.test.ts` | 2 | Before auth.ts change |
| AC7 (Pino warn fields) | `fU2.collision.unit.test.ts` | 2 | Before auth.ts change |
| AC8 (captureMessage called correctly) | `fU2.collision.unit.test.ts` | 2 | Before auth.ts change |
| AC9, AC9b (fallback actor + DB link) | `fU2.collision.integration.test.ts` | 3 | After auth.ts change (integration verify) |
| AC10 (idempotent me-sub upsert) | `fU2.collision.unit.test.ts` | 2 | Before auth.ts change |
| AC12 (two-bearer DB scenario) | `fU2.collision.integration.test.ts` | 3 | After auth.ts change |
| AC13 (existing tests pass) | Existing F107a test files | 3 | Run existing suite to confirm no regression |
| AC14 (concurrent idempotent) | `fU2.collision.integration.test.ts` | 3 | After auth.ts change |
| AC15 (no migration) | N/A — structural check | — | Verified in PR diff: no `/prisma/migrations/` change |
| AC16 (runbook) | N/A | 4 | Doc addition |

---

### Implementation order

Linear order:

1. **Phase 1** — `sentry.ts` + `sentry.test.ts` (captureMessage wrapper + allowlist extension). Entirely self-contained. No DB required.
2. **Phase 2** — `fU2.collision.unit.test.ts` (RED) then `auth.ts` (GREEN). The unit test mocks Prisma and `sentry.ts`; no DB or test container needed.
3. **Phase 3** — `fU2.collision.integration.test.ts` (requires real Postgres test container on port 5433). Run AFTER Phase 2 is committed so the production code is in place.
4. **Phase 4** — Documentation (`supabase-auth-setup.md` + `bugs.md`). Can be done in parallel with Phase 3 but must be committed last so the commit hash is known before updating `bugs.md`.

**Parallelizable within phases:**
- Within Phase 1: the 3 AC8b unit test sub-cases can be written in one go; the `sentry.ts` changes (interface + function) are also one unit.
- Phases 3 and 4 docs can be authored simultaneously.

**Sequencing constraint:** Phase 3 integration test MUST run after Phase 2 because it exercises the live HTTP handler against a real DB — running it against the old buggy handler would produce false red results (hijack would succeed) and the AC12 assertions would fail.

**Do NOT** run `prisma migrate dev` — use `prisma migrate deploy` only if ever needed. No migration is required for this ticket.

---

### `provisionFallbackActor` helper decision — RECOMMENDED (not optional)

After the fix, the `me-<sub>` upsert appears in TWO places: (a) the original `if (!actorId)` block at lines 214-231, and (b) the new collision fallback. Per self-review S1, the planner escalates this from "optional" (spec wording) to **RECOMMENDED** to enforce DRY and reduce copy-paste drift risk. The helper should be a module-level async function inside `auth.ts`:

```typescript
async function provisionFallbackActor(
  prisma: PrismaClient,
  sub: string,
): Promise<{ id: string }> {
  const externalId = `me-${sub.slice(0, 8)}`;
  return prisma.actor.upsert({
    where: { type_externalId: { type: 'anonymous_web', externalId } },
    create: { type: 'anonymous_web', externalId, lastSeenAt: new Date() },
    update: { lastSeenAt: new Date() },
    select: { id: true },
  });
}
```

This helper is private to the module and does NOT need its own test file — it is covered by the unit test's mock assertions on `prisma.actor.upsert` and the integration test's DB assertions.

---

### `accountForResponse` ordering constraint — NO LONGER REQUIRED

(Previous version of the plan required hoisting `accountForResponse` because the collision branch had an early `return reply.status(200).send(...)`. The R1 plan review CRITICAL fix restructured the collision branch to re-target `actorId = fallbackActor.id` instead of early-returning, so the existing final fetch + `accountForResponse` + `reply.send(...)` at lines 297-339 handles all paths uniformly. No hoisting needed; the `toIso` helper also keeps its original position.)

---

### Edge cases the planner identified during planning

1. **`externalId` value in the collision Pino log**: The collision branch logs `externalId` as the `X-Actor-Id` header value that triggered the collision. However, in the `!actorId` branch (lines 195-232), the variable `actorHeaderValue` is scoped inside the `if (!actorId)` block. If the actor was originally resolved via `actorResolver` (not the bearer path), `actorHeaderValue` may not be in scope at the collision-check point. The developer must ensure `externalId` is always available at the collision branch — safest approach: read it from the actor's `externalId` field via the `currentActor` fetch (which already has `accountId` — add `externalId: true` to the select). This avoids any scoping issue. **Spec says log `externalId` = "the X-Actor-Id header value that triggered the collision"** — fetching it from the actor row is equivalent and more reliable.

2. **`actorHeaderValue` scope**: `actorHeaderValue` is declared inside `if (!actorId)` at line 199. In the collision branch, which executes after both the `if (!actorId)` block and the accounts upsert, `actorHeaderValue` is out of scope. The developer should either: (a) hoist the declaration before the `if (!actorId)` block, or (b) use the actor's `externalId` from the `currentActor` fetch (preferred per point 1 above — add `externalId: true` to the `findUnique` select).

3. **`actorId` variable may have been set from `request.actorId` (the actorResolver path)**: In that case, `actorHeaderValue` was never declared. The Pino log's `externalId` field must still be populated. Using `currentActor.externalId` (fetched from DB) handles this uniformly regardless of which path set `actorId`. Add `externalId: true` to the `findUnique` select in the collision confirmation fetch.

4. **Existing test `f107a.edge-cases.test.ts` FINDING-1 and FINDING-7**: These tests are marked "FAIL EXPECTED" and characterize known spec deviations (FINDING-1: `UNAUTHORIZED` vs `INVALID_TOKEN`; FINDING-7: missing `sub` claim). The F107a-FU2 implementation does NOT touch these code paths. The developer must confirm these continue to fail with the SAME failure (not a new failure introduced by this PR). AC13 requires no new failures beyond pre-existing `BUG-API-HEALTH-PRISMA-MOCK-001` baseline.

5. **The `me-<sub>` fallback actor's second UPDATE race**: If two concurrent collision calls for the same bearer both try to upsert + UPDATE the `me-<sub>` fallback, the second UPDATE returns `1` (idempotent via `account_id = accountId` clause). No `P2002` error is possible because the upsert is idempotent and the UPDATE uses the same safe predicate. No additional handling needed.

---

### Verification commands run

- `Read: packages/api/src/lib/sentry.ts:1-127` → confirmed `captureMessage` does NOT exist; `hashActor`, `__resetForTests`, `initialized` flag, and `captureException` pattern all verified. `SentryContext` at lines 25-32 has 6 fields — 4 new hash fields are additions. `withScope` is NOT in the mock at `sentry.test.ts`. → Plan correctly adds `captureMessage` + `withScope` mock + 4 new fields.
- `Read: packages/api/src/__tests__/lib/sentry.test.ts:1-181` → confirmed `vi.mock('@sentry/node', ...)` block at lines 12-16 mocks `init`, `captureException`, `close` but NOT `withScope` or `captureMessage`. The `@ts-expect-error` test is at line 154-163 (test "9"). Import at line 19-25 imports `captureException` but NOT `captureMessage`. → Plan adds `withScope`, `captureMessage` to mock and import.
- `Read: packages/api/src/routes/auth.ts:195-292` → confirmed `IS DISTINCT FROM` at line 273; inverted `if (updateResult === 0)` block at lines 277-292; actor upsert preserved at lines 204-231. No `sentry` import currently in this file. → Plan adds the import and replaces lines 269-292.
- `Read: packages/api/src/routes/auth.ts:295-354` → confirmed `accountForResponse` is constructed at lines 315-325 AFTER the UPDATE block. Developer must hoist it before the UPDATE to enable the collision branch's early `return`. Edge case documented above.
- `Bash: grep -rn "captureMessage" packages/api/src/` → 0 hits outside of this plan. Confirms `captureMessage` is a net-new export.
- `Bash: grep -rn "from.*lib/sentry" packages/api/src/` → only `server.ts` and `errorHandler.ts` import from `lib/sentry.ts`. `auth.ts` does NOT currently import it. → Plan adds the import.
- `Bash: ls packages/api/src/__tests__/f107a/` → 7 existing files confirmed. New test files use distinct prefix `fua20000-` to avoid fixture collisions.
- `Read: packages/api/src/__tests__/f107a/f107a.authRoutes.integration.test.ts:1-519` → confirmed `mockVerifyBearerJwt` pattern, `testConfig` shape, `makeValidJwt()` helper, fixture UUID prefix `f1070000`. No test asserts that hijack succeeds (no test will break due to this fix). → AC13 regression risk: low.
- `Read: packages/api/src/__tests__/f107a/f107a.edge-cases.test.ts:1-294` → confirmed FINDING-1 and FINDING-7 tests are intentionally failing (marked "FAIL EXPECTED"). F107a-FU2 does not touch `UNAUTHORIZED` code or missing `sub` handling. → These remain pre-existing failures within AC13 baseline.
- `Bash: grep -n "BUG-API-AUTH-ACTOR-HIJACK-001" docs/project_notes/bugs.md` → line 20 confirms the open bug entry exists and is marked `P1 OPEN`. → Plan's closing commit flips status to `FIXED`.
- `Bash: tail -30 docs/operations/supabase-auth-setup.md` → confirmed file ends with `F107a-FU1 Placeholder` section (Google OAuth steps). Runbook appended after this section. No existing `actor_link_collision` section present.
- `Read: packages/api/src/routes/auth.ts:140-193` → confirmed `/me` handler structure: auth header check at 168, `verifyBearerJwt` at 175, `actorHeaderValue` scoped inside `if (!actorId)` block. Scope issue confirmed (edge case 2 above).
- `Bash: grep -n "withScope" packages/api/src/lib/sentry.ts` → 0 hits → `withScope` is not yet used anywhere; new `captureMessage` will be first usage. The `vi.mock` in `sentry.test.ts` must add it.

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
- [x] Step 2: `backend-planner` executed; self-review (1 I + 1 S applied); /review-plan R1 (1 CRITICAL + 3 IMPORTANT + 2 SUGGESTION applied) + R2 (2 editorial IMPORTANT + 1 SUGGESTION applied); plan LOCKED at 4-5h estimate
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
| 2026-05-18 | Step 2 Plan | backend-planner agent. 4-phase TDD plan with explicit RED→GREEN ordering. 3.5h initial estimate (calibrated up to 4-5h post review). Self-review found 1 IMPORTANT + 1 SUGGESTION fixed inline: (I1) GREEN code snippet for collision Pino log used out-of-scope `actorHeaderValue` — replaced with `currentActor.externalId` from DB (adds `externalId` to the `findUnique` select); (S1) `provisionFallbackActor` helper escalated from optional → RECOMMENDED per DRY (upsert appears in 2 places post-fix). |
| 2026-05-18 | Plan /review-plan R1 | Codex + Gemini parallel. Both VERDICT: REVISE with strong convergence on a CRITICAL bug. Applied: **P-C1 (CRITICAL — both flagged)** missing fallback path for `currentActor === null` and `currentActor.accountId === null` sub-paths → restructured collision branch around `isSameAccountRace` / `isTrueCollision` predicates with COMMON fallback block (telemetry gated on `isTrueCollision`), `actorId` reassignment instead of early return → eliminates need to hoist `accountForResponse`/`toIso`. **P-I2 (Codex)** AC1 needs SQL-shape assertion on `$executeRaw` template strings + AC10 needs explicit fallback-twice idempotency test → both added with `[PURE RED]` / `[SQL-SHAPE]` markers calibrating the TDD veracity claim per case. **P-I3 (Codex)** Phase 3 tests relabeled honestly as post-GREEN integration verification (not strict RED-before-GREEN). **P-I4 (Codex)** Phase 3 cleanup extended to DELETE `me-<sub>` fallback actors; fixture UUIDs differentiated in first-8-hex (User A=`fua20001-`, User B=`fua20002-`) to avoid shared fallback row. **P-S1** N/A after C1 refactor (no hoisting needed). **P-S2** estimate bumped 3.5h → 4-5h. |
| 2026-05-18 | Plan /review-plan R2 | Codex + Gemini parallel. Gemini APPROVED + 1 SUGGESTION. Codex REVISE on 2 EDITORIAL IMPORTANTs (no CRITICALs, P-C1/P-I3/P-S1 confirmed correctly addressed). Applied: **R2-PI1** `[PURE RED]` label overstated on AC2/AC3/race/AC5 — downgraded to `[HAPPY-REGRESSION]` for happy paths where old+new code share external behavior; AC5 reclassified as integration-only (DB-level guarantee, not mockable). Final distribution: 8 [PURE RED] + 1 [SQL-SHAPE] + 3 [HAPPY-REGRESSION] + 1 integration. **R2-PI2** AC14 fixture `SHARED_ACTOR_EXT_ID_2` (placeholder, not in cleanup) → replaced with explicit `IDEMPOTENT_ACTOR_EXT_ID` + new User C fixture (`fua20003-`); pre/post cleanup extended to include all 5 actor externalIds. **R2-S1 (Gemini)** AC12 integration test gains `expect(actorB.id).not.toBe(actorA.id)` response-level assertion. Convergence > 85% per memory rule — plan LOCKED. |
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
