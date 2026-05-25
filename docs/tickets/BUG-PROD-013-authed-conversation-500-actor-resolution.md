# BUG-PROD-013 — Authenticated `/conversation/*` returns 500 (`actorId` never set on bearer path)

**Status:** Ready for Merge
**Severity:** High (core broken when authenticated; low current blast radius — pre-beta, ~0 users)
**Type:** Bug (backend, auth) — bug-workflow **Path B (Standard)**
**Branch:** `bugfix/api-auth-actor-bearer-500` (base `develop`)
**Found by:** Post-auth strategic analysis + cross-model review (Gemini + Codex, 2 rondas), 2026-05-25 — `docs/research/post-auth-strategic-analysis-2026-05-25.md`

---

## Spec

### Issue
A logged-in web user submitting a text query (`POST /conversation/message`) or voice query (`POST /conversation/audio`) receives:
```json
{ "success": false, "error": { "code": "INTERNAL_ERROR", "message": "Actor resolution failed" } }
```
The core product does not work while authenticated. **Confirmed in deployed env by operator 2026-05-25** (login → `/hablar` → "paella" → HTTP 500 above).

### Root Cause
- `actorResolver.ts` bearer path (l.78-103): on a valid `Authorization` header it sets `request.accountId` + `request.authPayload` and **returns early WITHOUT setting `request.actorId`**. The sole setter of `request.actorId` is l.119 (anonymous path), which the early return skips.
- `conversation.ts` l.83-89 (`/conversation/message`) and l.430-436 (`/conversation/audio`): `const actorId = request.actorId; if (!actorId) return reply.code(500).send({code:'INTERNAL_ERROR', message:'Actor resolution failed'})`.
- `apiClient.ts` sends **both** `X-Actor-Id` (l.116) and `Authorization: Bearer` (l.118) on `/conversation/message`, and l.347/l.350 on `/conversation/audio`. ⇒ bearer present → bearer path → `actorId` undefined → 500.

### Collateral (out of scope — tracked for P0b)
The web **never calls `/me`**, so the F107a account↔actor link (the F107a-FU2 hijack-safe UPDATE inside `/me`) never fires from web. Account-linking + tier-by-account + photo identity are **P0b** (F-WEB-TIER), not this bug.

### Proposed Fix (minimal, reversible — bug-workflow hotfix rule)
1. Extract `/me`'s actor-resolution into a shared helper (new module `packages/api/src/lib/bearerActor.ts`):
   - `provisionFallbackActor(prisma, sub)` — moved verbatim from `auth.ts`.
   - `resolveBearerActorId(prisma, payload, request) → Promise<string>` — mirrors `/me` l.194-223: if `X-Actor-Id` header is a valid UUID → upsert `anonymous_web` actor by externalId; else → `provisionFallbackActor(payload.sub)`. Returns the actor id.
2. In `actorResolver.ts` bearer path: after setting `accountId`/`authPayload`, call `resolveBearerActorId(...)` and set `request.actorId` (instead of early-returning with it unset).
3. Refactor `/me` to import the shared helper (DRY); its account upsert + safe link UPDATE remain unchanged.

**Explicitly NOT in scope:** account upsert or account↔actor linking inside the resolver (avoids per-request account writes; that is P0b). The resolver only materializes a usable `actorId`.

### Invariants to preserve
- **ADR-025 R3 §5 strict bearer precedence:** valid bearer → identity from bearer (account); invalid bearer → throw (never silent downgrade). The fix only ADDS `actorId` resolution; it must not change accountId/authPayload behavior or swallow invalid-bearer throws.
- **F107a-FU2 anti-hijack:** no `account_id` linking happens in the resolver, so no hijack surface is added here.

---

## Acceptance Criteria

- [x] **AC1** — A bearer-authenticated `POST /conversation/message` with a valid `X-Actor-Id` resolves `request.actorId` to that actor and does NOT return 500 "Actor resolution failed". _(integration test, real PG)_
- [x] **AC2** — A bearer-authenticated `POST /conversation/audio` likewise resolves `request.actorId` and does NOT 500 on actor resolution. _(same resolver path; unit-covered)_
- [x] **AC3** — A bearer request WITHOUT `X-Actor-Id` (non-web client) resolves to the `me-<sub.slice(0,8)>` fallback actor (no anonymous ghost proliferation).
- [x] **AC4** — `request.accountId` and `request.authPayload` are still set from the bearer (precedence unchanged); an INVALID bearer still throws (no silent downgrade). _(unit test incl. DB-error case)_
- [x] **AC5** — Anonymous path (no Authorization header) behaviour is unchanged (still resolves/creates actor via `resolveActor`/`createAnonymousActor`).
- [x] **AC6** — `/me` still returns the same response shape and still performs the account upsert + safe link UPDATE (no regression); now reusing the shared helper.
- [x] **AC7** — `query_logs` rows for authenticated queries now carry a non-null `actor_id`. _(integration test asserts non-null actor_id)_
- [ ] **AC8 (operator)** — Post-deploy smoke: login → search "paella" → HTTP 200 (not 500) on dev API.

## Test Plan (TDD)
- **RED:** test that a bearer + X-Actor-Id request currently leaves `request.actorId` unset → `/conversation/message` 500s "Actor resolution failed". (Prove the bug.)
- **GREEN:** after fix, `request.actorId` is set; conversation route no longer 500s on resolution.
- Unit tests for `resolveBearerActorId`: (a) valid X-Actor-Id → that actor; (b) no/invalid X-Actor-Id → fallback `me-<sub>` actor; (c) accountId/authPayload still set.
- `/me` regression: existing tests stay green (shared helper).
- Full `@foodxplorer/api` suite green (currently 4596).

## Definition of Done
- [ ] All AC met (AC1-7 ✓; AC8 = post-deploy operator smoke, pending manual api-dev deploy)
- [x] RED test added + now GREEN
- [x] `npm test -w @foodxplorer/api` green (4613), lint, typecheck, build clean
- [ ] `production-code-validator` pass _(not run — covered by code-review-specialist APPROVE + cross-model Gemini+Codex + clean gates; owner-noted as deferred)_
- [x] `code-review-specialist` pass (auth-sensitive) — APPROVE, 0 CRITICAL
- [x] Cross-model review of the diff (auth — owner preference) — Gemini + Codex REQUEST CHANGES → all addressed
- [x] bugs.md entry updated with final solution
- [ ] PR to `develop` (squash), branch deleted after merge

## Workflow Checklist
- [x] Step 1: Triage (HIGH → Path B, base develop)
- [x] Step 2: Branch (`bugfix/api-auth-actor-bearer-500`)
- [x] Step 3: Investigate (root cause confirmed code + operator repro)
- [x] Step 4: Fix (TDD)
- [x] Step 5: Validate + review
- [ ] Step 6: Document + PR + merge

## Completion Log
| Date | Step | Notes |
|------|------|-------|
| 2026-05-25 | 1-3 | Triage HIGH→Path B; branch created; root cause confirmed (actorResolver bearer early-return, sole actorId setter l.119; conversation 500 guards l.83/l.430; apiClient sends X-Actor-Id+bearer). Operator reproduced the 500 in deployed env. |
| 2026-05-25 | 4 | Fix (TDD): new `lib/bearerActor.ts` (`resolveBearerActorId` + `provisionFallbackActor`); actorResolver bearer path sets `request.actorId` (try/catch graceful degrade); `/me` reuses shared helper (DRY). api suite 4596→4609 green. |
| 2026-05-25 | 5 | Reviews: code-review-specialist **APPROVE** (0 CRITICAL); cross-model **Gemini + Codex** both REQUEST CHANGES → all addressed (R-MAJOR resilience try/catch; R-MAJOR integration test on `/conversation/message`; bugs.md wording; UUID_RE dedup; call-site comment). +4 tests → api suite **4613** green; lint/typecheck/build clean. |

## Merge Checklist Evidence
| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections present: Spec, Acceptance Criteria, Test Plan, Definition of Done, Workflow Checklist, Completion Log, Merge Checklist Evidence |
| 1. Mark items + Status | [x] | Status → Ready for Merge; AC: 7/8 (AC8 operator post-deploy deferred [ ]); Workflow Steps 1-5 [x], Step 6 [ ]; Completion Log filled |
| 2. Product tracker | [x] | Active Session → BUG-PROD-013, Step 5/6 (Review), in-progress |
| 3. key_facts.md | [x] | Auth bullet updated: BUG-PROD-013 fix (bearer path resolves actorId via lib/bearerActor.ts; linking still /me-only; try/catch resilience) |
| 4. decisions.md | [x] | N/A — no ADR (reuses existing F107a/FU2 patterns; no new architectural decision) |
| 5. Commit documentation | [x] | Fix + tests + docs committed `b360e91`; pushed; PR #292 → develop |
| 6. Clean working tree | [x] | `git status` → CLEAN after commit |
| 7. Branch up to date with develop | [x] | `git merge-base --is-ancestor origin/develop HEAD` → up to date (develop `cf04529` is ancestor of `b360e91`) |
| 8. Fill MCE | [x] | this table |
| 9. /audit-merge | [x] | run 2026-05-25 (see Completion Log) — CI `ci-success` SUCCESS, `test-api` SUCCESS, mergeState CLEAN |
