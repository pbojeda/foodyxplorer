# F107a-FU3: Magic-link callback fails — switch to token_hash + verifyOtp

**Feature:** F107a-FU3 | **Type:** Frontend-Bugfix | **Priority:** High
**Status:** Done | **Branch:** feature/F107a-FU3-magic-link-verifyotp (merged + deleted)
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

### Existing Code to Reuse

- `packages/web/src/app/auth/callback/route.ts` — rewrite in place; the existing `try/catch` NEXT_REDIRECT re-throw pattern and `getSupabaseServerClient()` import are both kept as-is.
- `packages/web/src/lib/supabase/server.ts` — **no changes**. `getSupabaseServerClient()` already returns a `SupabaseClient` whose `auth` object exposes both `exchangeCodeForSession` and `verifyOtp`. The `setAll` cookie adapter writes session cookies on successful `verifyOtp` with no extra wiring.
- `packages/web/src/__tests__/auth/callback.test.ts` — extend in place. The existing mock structure (`mockExchangeCodeForSession`, `mockRedirect`, `mockCookieStore`, `makeRequest`) is fully reusable. Add `mockVerifyOtp` alongside `mockExchangeCodeForSession` in the same mock factory.
- `packages/web/src/components/LoginForm.tsx` — **no changes**. The `callback_failed` → Spanish error message mapping already covers all new failure paths.

### Files to Create

None. This ticket modifies two existing files only.

### Files to Modify

1. `packages/web/src/app/auth/callback/route.ts`
   - Add `token_hash` and `type` to `searchParams` reads.
   - Add `ALLOWED_OTP_TYPES` constant (`['email', 'magiclink'] as const`) and a narrowing helper that casts a raw query string value to `EmailOtpType` or returns `null` for disallowed values.
   - Import `EmailOtpType` from `@supabase/supabase-js` (re-exported from `@supabase/auth-js`).
   - Rewrite the dispatch body to the 4-priority order specified in the spec.
   - Preserve the existing `try/catch` NEXT_REDIRECT re-throw pattern; expand its scope to cover both verification branches.
   - Update the file-level comment block to reflect the new dispatch table.

2. `packages/web/src/__tests__/auth/callback.test.ts`
   - Add `mockVerifyOtp` jest.fn() alongside `mockExchangeCodeForSession`.
   - Update the `getSupabaseServerClient` mock factory to expose both `auth.exchangeCodeForSession` and `auth.verifyOtp`.
   - Update `beforeEach` default mock to also set `mockVerifyOtp` default return.
   - Add new `describe` block (or extend the existing one) with 9 new test cases (mapped to ACs below).
   - Verify the existing 9 tests remain green (no changes to their assertions needed; the mock factory change is additive).

3. `docs/specs/api-spec.yaml` — already updated in Step 0 by spec-creator (real-time spec sync). Step 3 must verify the final code matches the documented dual-dispatch contract; no further edits expected unless the code diverges.

4. `docs/specs/ui-components.md` — already updated in Step 0 by spec-creator (real-time spec sync). Step 3 must verify the AuthCallback entry accurately reflects the implemented dispatch table; no further edits expected unless the code diverges.

### Implementation Order

1. **Test file first (TDD)** — `packages/web/src/__tests__/auth/callback.test.ts`
   - Extend the mock factory to include `verifyOtp`.
   - Write all new test cases (AC1–AC5, AC10, AC11, AC18). They will fail until the handler is updated.
   - Confirm existing tests still compile (they will; the mock factory change is additive).

2. **Route handler** — `packages/web/src/app/auth/callback/route.ts`
   - Add `ALLOWED_OTP_TYPES` constant and type-narrowing helper.
   - Rewrite dispatch body.
   - All tests should now pass.

3. **TypeScript build check** — `npm run typecheck -w @foodxplorer/web` (AC15). Optionally also run `npm run build -w @foodxplorer/web` to confirm Next.js compilation.

4. **Lint check** — `npm run lint -w @foodxplorer/web` (AC16).

### Testing Strategy

**Test file:** `packages/web/src/__tests__/auth/callback.test.ts`

**Mock strategy:** The existing `jest.mock('../../lib/supabase/server', ...)` factory returns a mock `SupabaseClient`. Extend it to include `verifyOtp`:

```
getSupabaseServerClient: jest.fn().mockResolvedValue({
  auth: {
    exchangeCodeForSession: (...args) => mockExchangeCodeForSession(...args),
    verifyOtp: (...args) => mockVerifyOtp(...args),
  },
})
```

`mockVerifyOtp` default in `beforeEach`: `mockVerifyOtp.mockResolvedValue({ data: {}, error: null })`.

**New test cases (map to ACs):**

| Test case description | AC |
|---|---|
| `?token_hash=valid-hash&type=email` → calls `verifyOtp({ token_hash, type: 'email' })`, NOT `exchangeCodeForSession`, redirects `/hablar` | AC1 |
| `?token_hash=valid-hash` (no `type`) → defaults `type='email'`, calls `verifyOtp({ token_hash, type: 'email' })`, redirects `/hablar` | AC2 |
| `?token_hash=valid-hash&type=email`, `verifyOtp` returns `{ error: { message: 'Token expired' } }` → redirects `/login?error=callback_failed` | AC3 |
| `?token_hash=valid-hash&type=email`, `verifyOtp` throws non-redirect Error → redirects `/login?error=callback_failed` | AC4 |
| `?token_hash=x&type=phone` (invalid type) → redirects `/login?error=callback_failed`, `verifyOtp` NOT called, `exchangeCodeForSession` NOT called | AC5 |
| `?code=valid-pkce-code` (no `token_hash`) → calls `exchangeCodeForSession`, `verifyOtp` NOT called, redirects `/hablar` (existing test stays green) | AC7 |
| `?token_hash=x&code=y&type=email` → `verifyOtp` called (token_hash path), `exchangeCodeForSession` NOT called, redirects `/hablar` | AC10 |
| `?token_hash=x&error=access_denied` → silent redirect `/login`, `verifyOtp` NOT called | AC11 |
| `?token_hash=valid-hash&type=magiclink` → calls `verifyOtp({ token_hash, type: 'magiclink' })`, redirects `/hablar` | AC18 |

**Existing tests to preserve (AC7 / current AC22):** All 9 existing cases pass without modification — the mock factory change is purely additive (new `verifyOtp` key alongside existing `exchangeCodeForSession`). The 9 existing tests cover: 1 `?code` success (maps to AC7), 7 `?error`/no-param cases (AC8, AC9, AC6, and variants), and 1 `exchangeCodeForSession` throw/error case.

**Key assertion pattern for each `verifyOtp` test:**
```
await expect(GET(makeRequest({ token_hash: '...', type: '...' }))).rejects.toThrow('NEXT_REDIRECT:/hablar');
expect(mockVerifyOtp).toHaveBeenCalledWith({ token_hash: '...', type: '...' });
expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
```

### Key Patterns

1. **NEXT_REDIRECT re-throw pattern** — `packages/web/src/app/auth/callback/route.ts:42-46`. Both new `verifyOtp` dispatch and existing `exchangeCodeForSession` dispatch must be wrapped in the same try/catch block that re-throws errors whose `.digest` starts with `NEXT_REDIRECT`. The simplest approach: expand the single existing try/catch to encompass both branches (priority 2 and priority 3 share the same try/catch boundary).

2. **`EmailOtpType` narrowing** — `EmailOtpType` in the installed `@supabase/auth-js` is `'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'email' | (string & {})`. The `(string & {})` escape-hatch means TypeScript will accept any string literal as `EmailOtpType` without error, but the runtime guard is still needed. Define:
   ```
   const ALLOWED_OTP_TYPES = ['email', 'magiclink'] as const;
   type AllowedOtpType = typeof ALLOWED_OTP_TYPES[number]; // 'email' | 'magiclink'
   ```
   The narrowing helper returns `AllowedOtpType | null`. Because `AllowedOtpType` is a subset of `EmailOtpType`, passing it to `verifyOtp({ token_hash, type })` satisfies the type checker with no cast needed.

3. **Mock factory shape** — existing mock returns `{ auth: { exchangeCodeForSession } }`. Extending to `{ auth: { exchangeCodeForSession, verifyOtp } }` is non-breaking because Jest mocks are objects and existing tests only assert on `mockExchangeCodeForSession`.

4. **No `'use client'`** — `route.ts` is a Route Handler (server-only); directives are not applicable.

5. **`type` default value** — when `searchParams.get('type')` returns `null`, apply the default `'email'` before the allowlist check. This ensures the "no type param" case (AC2) passes the guard and calls `verifyOtp` with `type: 'email'`.

### Verification Commands Run

- `Read: packages/web/src/app/auth/callback/route.ts` → current handler uses only `?code`/`exchangeCodeForSession`; no `token_hash` branch exists → confirms full dispatch rewrite is needed, existing `try/catch` pattern is preserved as-is
- `Read: packages/web/src/__tests__/auth/callback.test.ts` → mock factory exposes only `exchangeCodeForSession`; `mockRedirect`, `makeRequest`, and `beforeEach` pattern are reusable → plan to extend mock factory additively with `mockVerifyOtp`
- `Read: packages/web/src/lib/supabase/server.ts` → `getSupabaseServerClient()` returns `SupabaseClient` (not a narrowed type); `verifyOtp` is available on `auth` with no additional setup → confirmed no change to `server.ts`
- `Read: packages/web/src/components/LoginForm.tsx:18-32` → `callback_failed` → Spanish message mapping exists and covers all new failure paths → confirmed no change to `LoginForm.tsx`
- `Grep: "EmailOtpType" in node_modules/@supabase/auth-js/dist/module/lib/types.d.ts` → `EmailOtpType = 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'email' | (string & {})` → both `'email'` and `'magiclink'` are named members of the union; `(string & {})` means any string is assignable but a runtime allowlist guard is still required; the plan's `ALLOWED_OTP_TYPES` constant produces a strict `'email' | 'magiclink'` subtype that satisfies `EmailOtpType` without casting
- `Grep: "VerifyTokenHashParams" in node_modules/@supabase/auth-js/dist/module/lib/types.d.ts` → `{ token_hash: string; type: EmailOtpType }` — no `options` field required → `verifyOtp({ token_hash, type })` call needs exactly these two fields
- `Grep: "verifyOtp" in node_modules/@supabase/auth-js/dist/module/GoTrueClient.d.ts` → `verifyOtp(params: VerifyOtpParams): Promise<AuthResponse>` — matches `{ data, error }` destructuring pattern used by `exchangeCodeForSession` → same `if (verifyError) redirect(...)` guard applies
- `Bash: ls packages/web/src/__tests__/auth/` → `callback.test.ts` confirmed at that path → correct import path in test file (`../../app/auth/callback/route`)
- `Bash: cat packages/web/jest.config.ts` → Jest (not Vitest); `testMatch` covers `**/__tests__/**/*.test.{ts,tsx}`; `@/` alias maps to `src/` → test runner command is `jest` (or `npm test` in `packages/web`)

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
Existing tests (AC22 in `packages/web/src/__tests__/auth/callback.test.ts`) remain green. New test cases added for AC1–AC5, AC10, AC11, AC18. All pass via `npm test -w @foodxplorer/web` (Jest).

### AC13 — ui-components.md AuthCallback entry updated
`docs/specs/ui-components.md` AuthCallback section reflects the `token_hash`/`verifyOtp` dispatch table. No reference to the old PKCE-only description remains without the forward-compat context.

### AC14 — supabase-auth-setup.md documents operator template change
`docs/operations/supabase-auth-setup.md` contains a dedicated subsection describing the exact template link string, the `EmailOtpType` value (`email`), and the steps to update both dev and prod Supabase projects.

### AC15 — TypeScript build succeeds
`npm run typecheck -w @foodxplorer/web` completes with no type errors. `npm run build -w @foodxplorer/web` (Next.js compile) also passes.

### AC16 — no lint errors
`npm run lint -w @foodxplorer/web` passes with no errors.

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

- [x] All acceptance criteria met (AC1–AC18 at code-merge; AC19 at deploy)
- [x] Unit tests written and passing
- [x] E2E tests updated (if applicable)
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds
- [x] Specs reflect final implementation (api-spec.yaml + ui-components.md updated)
- [~] Operator E2E smoke (AC19) — dev template updated by operator 2026-05-25 (uses `app-dev.nutrixplorer.com`); pending user dev login re-test to confirm empirically. Prod template + prod smoke coordinated with the develop→main release bundle.

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated (cross-model: Codex REVISE 2 IMPORTANT addressed + Gemini APPROVED)
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `frontend-planner` executed, plan approved (cross-model: Codex REVISE 2 IMPORTANT addressed + Gemini APPROVED)
- [x] Step 3: `frontend-developer` executed with TDD
- [x] Step 4: `production-code-validator` executed, quality gates pass (APPROVE 0 BLOCKERs; web 576/576, typecheck/lint/build clean)
- [x] Step 5: `code-review-specialist` executed (APPROVE; 2 MINOR + 2 NIT — rethrowIfRedirect helper extraction + redundant cast removal applied)
- [x] Step 5: `qa-engineer` executed (QA VERIFIED; +16 edge-case tests, AC1–AC18 covered, AC19 deploy-deferred)
- [x] Step 6: Ticket updated with final metrics, branch deleted (merged at `816799e` squash via PR #288; feature branch deleted local + remote)

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-05-21 | Triage | Production defect found during F107a operator action. Root cause confirmed empirically (admin client implicit flow + server callback expecting PKCE ?code). Standard tier, cross-model review on spec + plan. |
| 2026-05-21 | Spec revision | Cross-model review (Codex REVISE: 2 IMPORTANT + 1 SUGGESTION; Gemini APPROVED: 1 SUGGESTION) — all addressed: api-spec.yaml `/auth/callback` + `/auth/login` updated to reflect token_hash/verifyOtp magic-link path and retained `?code` OAuth path (Finding 1); deploy-time operator-verification AC19 added (Finding 2); type=magiclink AC18 + implementation note added (Finding 3); link_used UX distinction deferred as YAGNI in Edge Cases (Finding 4). Final AC count: AC1–AC19 (AC19 deploy-time). |
| 2026-05-21 | Plan cross-model review | Codex REVISE: 2 IMPORTANT [doc-files-in-scope, turbo→npm/jest] + 1 SUGGESTION [test count 8→9]; Gemini APPROVED — all addressed: api-spec.yaml + ui-components.md added to Files to Modify tagged Step-0 (Finding 1); all turbo/bare npm commands replaced with npm-workspace forms (`npm test/typecheck/build/lint -w @foodxplorer/web`), AC12 updated to Jest, AC15 updated to typecheck+build (Finding 2); existing test count corrected to 9 throughout (Finding 3). |
| 2026-05-21 | Implementation (Step 3) | TDD: Red (8 new tests written, failing) → Green (handler rewritten to 4-priority dispatch) → all 17 tests pass (9 existing + 8 new). Quality gates: typecheck clean, lint clean, build clean (560/560 tests). AC1–AC18 satisfied; AC19 deferred to Step 6 (deploy-time operator action). |
| 2026-05-21 | Finalize (Step 4) | `production-code-validator` APPROVE (0 BLOCKERs/MAJORs). Quality gates re-verified independently: `npm test -w @foodxplorer/web` 560/560, typecheck clean, lint clean, build OK (`/auth/callback` dynamic route handler). |
| 2026-05-21 | Review (Step 5) | `code-review-specialist` APPROVE (0 BLOCKER/MAJOR; 2 MINOR + 2 NIT). `qa-engineer` QA VERIFIED (+16 edge-case tests in `callback.edge-cases.test.ts`; AC1–AC18 covered, 1 informational empty-`?error=` note, no fix needed). Polish applied: extracted `rethrowIfRedirect()` shared helper, dropped redundant `as EmailOtpType` cast + unused import. Web suite 576/576 post-polish. |
| 2026-05-25 | Merge (Step 5→6) | PR #288 CI green (`ci-success` SUCCESS, `test-web` SUCCESS, others path-skipped; UNSTABLE = Vercel preview only). `/audit-merge` structural 11/11 + drift CLEAN. User merge-approved. Squash-merged to develop at `816799e`; feature branch deleted local + remote. |
| 2026-05-25 | Step 6 housekeeping | Status → Done; tracker + pm-session synced. Operator updated the Supabase **dev** Magic Link template to `app-dev.nutrixplorer.com/auth/callback?token_hash={{ .TokenHash }}&type=email`. **AC19 dev smoke pending user re-test.** Prod template + prod smoke deferred to the develop→main release bundle (coordinated deploy + template change). |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | All 7 sections present: Spec, Implementation Plan, Acceptance Criteria, Definition of Done, Workflow Checklist, Completion Log, Merge Checklist Evidence |
| 1. Mark all items | [x] | AC: 18/19 (AC19 deploy-deferred), DoD: 7/8 (operator smoke deploy-deferred), Workflow: 0–5/6 marked (Step 6 post-merge) |
| 2. Verify product tracker | [x] | Active Session: step 5/6 (Review); pm-session Features table: F107a-FU3 in-progress |
| 3. Update key_facts.md | [x] | Auth section (line 113): added F107a-FU3 note — web magic-link callback now token_hash + verifyOtp dual-dispatch |
| 4. Update decisions.md | [x] | N/A — no new ADR (canonical Supabase SSR pattern, not a project-specific architecture decision; documented in ticket + api-spec + runbook) |
| 5. Commit documentation | [x] | Commit: docs(F107a-FU3) Step 4+5 merge-prep (this commit) |
| 6. Verify clean working tree | [x] | `git status` clean after docs commit |
| 7. Verify branch up to date | [x] | `git merge-base --is-ancestor origin/develop HEAD` → 0 (develop@632ae62 is ancestor; no merge needed) |

---

*Ticket created: 2026-05-21*
