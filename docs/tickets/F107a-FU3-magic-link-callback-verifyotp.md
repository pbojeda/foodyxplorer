# F107a-FU3: Magic-link callback fails — switch to token_hash + verifyOtp

**Feature:** F107a-FU3 | **Type:** Frontend-Bugfix | **Priority:** High
**Status:** Planning | **Branch:** feature/F107a-FU3-magic-link-verifyotp
**Created:** 2026-05-21 | **Dependencies:** F107a (auth core), F107a-FU2 (merged). Operator dependency: Supabase Magic Link email template change (dev + prod projects).

---

## Spec

### Description

**Production defect** discovered during the first real magic-link E2E test after F107a deployment. Clicking a valid magic link lands on `/login` with the error message "El enlace de acceso ha expirado o ha sido cancelado. Solicita uno nuevo." (`?error=callback_failed` rendered by `LoginForm.tsx:25`).

**Root cause (empirically confirmed — do not re-investigate):**

The API initiates the OTP server-side via the Supabase admin client (`packages/api/src/lib/supabaseAdmin.ts`). The admin client defaults to `flowType: 'implicit'`. The default Supabase email template (`{{ .ConfirmationURL }}`) generates a link that resolves to `https://<project>.supabase.co/auth/v1/verify?token=<otp>&type=magiclink&redirect_to=<web>/auth/callback`. After `/verify`, Supabase redirects to `<web>/auth/callback` with tokens in the **URL fragment** (`#access_token=…`). The fragment is inaccessible to server-side Route Handlers; no `?code=` query param is present. `packages/web/src/app/auth/callback/route.ts` calls `searchParams.get('code')` and then `exchangeCodeForSession(code)` — `code` is `null` → `redirect('/login?error=callback_failed')`. PKCE cannot bridge this because the PKCE `code_verifier` is never written to the user's browser cookie store when the OTP is initiated server-side by the API admin client.

**Approved fix: Supabase canonical SSR `token_hash` + `verifyOtp` pattern.**

Two changes are required:

1. **Operator change (out-of-repo):** Update the Supabase "Magic Link" email template in both the dev and prod Supabase projects to use `{{ .TokenHash }}` instead of `{{ .ConfirmationURL }}`. The new template link format is:
   ```
   <web_origin>/auth/callback?token_hash={{ .TokenHash }}&type=email
   ```
   The correct `EmailOtpType` value is **`email`** (not `magiclink`). The Supabase SSR documentation confirms that `signInWithOtp` (email) produces an OTP of type `email`, and `supabase.auth.verifyOtp({ token_hash, type: 'email' })` is the canonical server-side verification call for this flow. See `docs/operations/supabase-auth-setup.md` § Magic Link Email Template.

2. **Code change:** Rewrite `packages/web/src/app/auth/callback/route.ts` to implement the dispatch logic described in UI Changes below.

The API's `POST /auth/login` handler requires **no changes**: `signInWithOtp` with `emailRedirectTo` pointing at `<web>/auth/callback` remains correct. The `emailRedirectTo` value is used as the `redirect_to` parameter in the default template path, but with the new template it is irrelevant to the link — the template link is hardcoded to `<web>/auth/callback?token_hash=...&type=email`. Nevertheless the `redirectTo` field is kept in the request body (no schema change) for forward-compatibility with the future Google OAuth flow (F107a-FU1), which will supply a `redirectTo` for the PKCE authorize redirect.

---

### API Changes

**Runtime contract: no changes.** `POST /auth/login` runtime behaviour is unchanged:
- Request body: `{ provider: 'email', email: string, redirectTo: string }` — unchanged.
- Response: `{ success: true, data: { provider: 'email', success: true } }` — unchanged.
- `supabase.auth.signInWithOtp` call in `packages/api/src/routes/auth.ts` — unchanged.
- Rate limit (5/min/IP) — unchanged.

**Contract-doc update (api-spec.yaml):** `docs/specs/api-spec.yaml` IS updated (F107a-FU3):

1. **`/auth/callback` description** — updated from PKCE-only to dual-dispatch:
   - New `token_hash` and `type` query parameters documented.
   - `?token_hash` path: `supabase.auth.verifyOtp({ token_hash, type })` server-side; allowed `type` values: `'email'` (default) and `'magiclink'`.
   - `?code` path: `exchangeCodeForSession(code)` — retained for future OAuth (F107a-FU1).
   - `?error` handling and no-params fallback — documented explicitly.
   - `code` parameter description updated: OAuth/PKCE path only, not magic-link.

2. **`/auth/login` description** — magic-link note updated:
   - Documents that the emailed link resolves to `<web>/auth/callback?token_hash=…&type=email` (template uses `{{ .TokenHash }}`).
   - Notes that `verifyOtp` is the server-side verification call.
   - Clarifies `redirectTo`/`emailRedirectTo` is retained for OAuth forward-compat but does not govern the magic-link landing URL.

---

### Data Model Changes

None.

---

### UI Changes

**File:** `packages/web/src/app/auth/callback/route.ts`

The handler is extended to support two verification paths. The dispatch logic (in priority order) is:

| Priority | Condition | Action |
|----------|-----------|--------|
| 1 | `?error` param present | `access_denied` → `redirect('/login')` (silent); any other value → `redirect('/login?error=callback_failed')`. Unchanged from current behaviour. |
| 2 | `?token_hash` param present | Magic-link path (new). Read `type` param (default `'email'` if absent). Call `supabase.auth.verifyOtp({ token_hash, type })` with the SSR server client. On success → `redirect('/hablar')`. On error (expired, invalid, already used) → `redirect('/login?error=callback_failed')`. |
| 3 | `?code` param present (no `token_hash`) | OAuth PKCE path (forward-compat, F107a-FU1). Call `supabase.auth.exchangeCodeForSession(code)`. On success → `redirect('/hablar')`. On error → `redirect('/login?error=callback_failed')`. This branch is the current sole handler and MUST be preserved. |
| 4 | Neither `token_hash` nor `code` present | `redirect('/login?error=callback_failed')`. |

The server client used in both verification paths is `getSupabaseServerClient()` from `packages/web/src/lib/supabase/server.ts` (no changes to that file needed). The `setAll` cookie adapter in that client writes the session cookies on successful `verifyOtp`, exactly as it does for `exchangeCodeForSession`.

**`type` param validation:** The `type` value from the query string must be narrowed to a valid `EmailOtpType` before being passed to `verifyOtp`. The allowed values for this flow are `'email'` and `'magiclink'`. Any other value is treated the same as a missing `token_hash` → `redirect('/login?error=callback_failed')`. In practice the template always emits `type=email`, but the validation guard protects against manipulated URLs.

**No changes to `LoginForm.tsx`** — the `callback_failed` error message mapping is already correct and covers the `verifyOtp` failure case.

**Implementation note — `EmailOtpType` confirmation:** The exact `EmailOtpType` that Supabase's `signInWithOtp` email magic link requires for `verifyOtp` (`'email'` vs `'magiclink'`) must be confirmed against real Supabase during implementation. The Supabase SSR documentation and the template emission (`type=email`) indicate `'email'` is correct. AC17 (E2E smoke) is the empirical verification gate. If Supabase rejects `type=email` for the magic-link token, switch the template to emit `type=magiclink` and update the `type` default accordingly.

**See also:** `docs/specs/ui-components.md` — AuthCallback entry updated (see below).

---

### Edge Cases & Error Handling

| Scenario | Expected behaviour |
|----------|--------------------|
| Valid `token_hash` + `type=email` — first click | `verifyOtp` succeeds → session cookies set → `redirect('/hablar')`. |
| Valid `token_hash` + `type` param absent | Default `type='email'` applied → same as above. |
| `token_hash` present, `type` value not in `['email', 'magiclink']` | Treat as invalid → `redirect('/login?error=callback_failed')`. |
| `token_hash` expired (> 1 hour) | `verifyOtp` returns error → `redirect('/login?error=callback_failed')`. User sees "El enlace de acceso ha expirado…". |
| `token_hash` already consumed (second click / email-scanner pre-fetch) | `verifyOtp` returns error (token single-use) → `redirect('/login?error=callback_failed')`. Acceptable UX — Supabase tokens are single-use by design; no mitigation required in this ticket. |
| `verifyOtp` throws (network error, Supabase unavailable) | Caught by try/catch; Next.js redirect errors re-thrown; all others → `redirect('/login?error=callback_failed')`. |
| `?code` present without `token_hash` (future OAuth PKCE, F107a-FU1) | `exchangeCodeForSession(code)` path taken — forward-compat preserved. |
| `?error=access_denied` | Silent `redirect('/login')` — unchanged (ADR-025 R3 §6). |
| `?error=<anything else>` | `redirect('/login?error=callback_failed')` — unchanged. |
| No params at all | `redirect('/login?error=callback_failed')` — unchanged. |
| Both `token_hash` AND `code` present (unexpected) | `token_hash` takes priority (higher precedence in dispatch table). |
| "Link already used" vs "expired" distinction | Intentionally **OUT OF SCOPE** for F107a-FU3. Both cases return the same generic `?error=callback_failed` message. A dedicated `?error=link_used` code for better UX is YAGNI here; revisit as a future follow-up only if user confusion is reported. |

---

## Implementation Plan

_Pending — to be generated by the planner agent in Step 2._

---

## Acceptance Criteria

### AC1 — token_hash happy path: verifyOtp called + redirect /hablar
GET `/auth/callback?token_hash=valid-hash&type=email` calls `supabase.auth.verifyOtp({ token_hash: 'valid-hash', type: 'email' })` with the SSR server client and redirects to `/hablar`. `exchangeCodeForSession` is NOT called.

### AC2 — token_hash + type absent: defaults to 'email'
GET `/auth/callback?token_hash=valid-hash` (no `type` param) behaves identically to AC1, defaulting `type` to `'email'`.

### AC3 — verifyOtp error: redirect /login?error=callback_failed
When `verifyOtp` returns `{ error: { message: '...' } }` (e.g. expired or already-used token), handler redirects to `/login?error=callback_failed`. No unhandled exception escapes.

### AC4 — verifyOtp throws: redirect /login?error=callback_failed
When `verifyOtp` throws a non-redirect Error (e.g. network failure), handler catches it and redirects to `/login?error=callback_failed`.

### AC5 — invalid type param: redirect /login?error=callback_failed
GET `/auth/callback?token_hash=x&type=phone` (type value not in `['email', 'magiclink']`) redirects to `/login?error=callback_failed` without calling `verifyOtp` or `exchangeCodeForSession`.

### AC6 — missing token_hash AND missing code: callback_failed (unchanged)
GET `/auth/callback` with no params redirects to `/login?error=callback_failed`. Unchanged from existing behaviour.

### AC7 — code present, no token_hash: exchangeCodeForSession (OAuth forward-compat)
GET `/auth/callback?code=valid-pkce-code` (no `token_hash`) calls `exchangeCodeForSession('valid-pkce-code')` and redirects to `/hablar`. `verifyOtp` is NOT called. Existing test cases for this branch continue to pass.

### AC8 — access_denied: silent redirect /login (unchanged)
GET `/auth/callback?error=access_denied` redirects to `/login` with no error param. Unchanged from existing behaviour.

### AC9 — other error param: callback_failed (unchanged)
GET `/auth/callback?error=server_error` (and other non-`access_denied` values) redirects to `/login?error=callback_failed`. Unchanged.

### AC10 — token_hash takes precedence over code
GET `/auth/callback?token_hash=x&code=y&type=email` uses the `token_hash` path (AC1 behaviour), not the `code` path.

### AC11 — error param takes precedence over token_hash
GET `/auth/callback?token_hash=x&error=access_denied` enters the error path (AC8/AC9 behaviour) before evaluating `token_hash`.

### AC12 — unit tests updated and passing
Existing tests (AC22 in `packages/web/src/__tests__/auth/callback.test.ts`) remain green. New test cases added for AC1–AC5, AC10, AC11. All pass via `vitest run` (or `jest run`).

### AC13 — ui-components.md AuthCallback entry updated
`docs/specs/ui-components.md` AuthCallback section reflects the `token_hash`/`verifyOtp` dispatch table. No reference to the old PKCE-only description remains without the forward-compat context.

### AC14 — supabase-auth-setup.md documents operator template change
`docs/operations/supabase-auth-setup.md` contains a dedicated subsection describing the exact template link string, the `EmailOtpType` value (`email`), and the steps to update both dev and prod Supabase projects.

### AC15 — TypeScript build succeeds
`npm run build` (or `turbo build --filter=web`) completes with no type errors in `packages/web`.

### AC16 — no lint errors
`npm run lint` passes for `packages/web`.

### AC17 — api-spec.yaml updated (contract-doc)
`docs/specs/api-spec.yaml` `/auth/callback` entry documents the dual-dispatch (`token_hash`/`verifyOtp` magic-link path + `code`/`exchangeCodeForSession` OAuth path), with `token_hash`, `type`, and `code` query parameters all described. `/auth/login` description includes the magic-link template URL format (`?token_hash=…&type=email`) and the retained `redirectTo` forward-compat note. No reference to `exchangeCodeForSession` remains as the sole magic-link handler.

### AC18 — type=magiclink accepted
`GET /auth/callback?token_hash=valid-hash&type=magiclink` is accepted (type in allowed set), calls `verifyOtp({ token_hash: 'valid-hash', type: 'magiclink' })`, and on success redirects to `/hablar`. Unit test added for this branch.

### AC19 — operator E2E smoke (verified at deploy, Step 6)
**Deploy-time AC — not required for code merge.** Operator confirms:
  (a) The Supabase "Magic Link" email template has been updated in BOTH the dev AND prod Supabase projects to use `{{ .TokenHash }}` with the link format `<web_origin>/auth/callback?token_hash={{ .TokenHash }}&type=email`.
  (b) A real received magic-link email contains `?token_hash=…&type=email` in the link.
  (c) Clicking the link completes login end-to-end and lands on `/hablar` (manual E2E smoke).
This criterion must be checked off at Step 6 (deploy), not at code-merge.

---

## Definition of Done

- [ ] All acceptance criteria met (AC1–AC18 at code-merge; AC19 at deploy)
- [ ] Unit tests written and passing
- [ ] E2E tests updated (if applicable)
- [ ] Code follows project standards
- [ ] No linting errors
- [ ] Build succeeds
- [ ] Specs reflect final implementation (api-spec.yaml + ui-components.md updated)
- [ ] Operator E2E smoke (AC19) completed and confirmed in both dev + prod Supabase at Step 6

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated (cross-model: Codex REVISE 2 IMPORTANT addressed + Gemini APPROVED)
- [x] Step 1: Branch created, ticket generated, tracker updated
- [ ] Step 2: `frontend-planner` executed, plan approved
- [ ] Step 3: `frontend-developer` executed with TDD
- [ ] Step 4: `production-code-validator` executed, quality gates pass
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 5: `qa-engineer` executed (Standard/Complex)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-05-21 | Triage | Production defect found during F107a operator action. Root cause confirmed empirically (admin client implicit flow + server callback expecting PKCE ?code). Standard tier, cross-model review on spec + plan. |
| 2026-05-21 | Spec revision | Cross-model review (Codex REVISE: 2 IMPORTANT + 1 SUGGESTION; Gemini APPROVED: 1 SUGGESTION) — all addressed: api-spec.yaml `/auth/callback` + `/auth/login` updated to reflect token_hash/verifyOtp magic-link path and retained `?code` OAuth path (Finding 1); deploy-time operator-verification AC19 added (Finding 2); type=magiclink AC18 + implementation note added (Finding 3); link_used UX distinction deferred as YAGNI in Edge Cases (Finding 4). Final AC count: AC1–AC19 (AC19 deploy-time). |

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

*Ticket created: 2026-05-21*
