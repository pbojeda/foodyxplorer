# BUG-PROD-012 — `/auth/login` 500 INTERNAL_ERROR: supabase-js createClient throws on Node 20 (no native WebSocket)

**Status:** In Progress
**Type:** Bug (production defect, found during F107a operator action)
**Severity:** High
**Path:** B (Standard)
**Branch:** `fix/api-auth-supabase-ws-node20`
**Affects:** API `/auth/login` + `/auth/logout` on Render (`nutrixplorer-api-dev`, and `-prod` once live). Blocks F107a magic-link login E2E, the operator-action smoke (Task #18 Step 6), and the `develop → main` release bundle.

---

## Triage

| Dimension | Assessment |
|-----------|-----------|
| Severity | High — email login is 100% broken on the deployed environment; every `/auth/login` returns 500. Pre-beta (no real users yet), but a hard release blocker. |
| Urgency | Same day — blocks operator action + release. |
| Scope | All login/logout attempts on Render (Node 20). Not reproducible on CI (Node 22) or in unit tests (createClient is mocked). |
| Complexity | Low — additive: one `realtime.transport` option + declare `ws`/`@types/ws` + a regression test. |

## Symptom

Web `/login` on the develop Vercel Preview → enter email → "Entrar con email" → UI shows **"Internal server error"** (the API error envelope `message`, surfaced verbatim by `AuthProvider.tsx:80-84`).

Live probe (`curl -i POST /auth/login`) returns `HTTP 500 {"success":false,"error":{"message":"Internal server error","code":"INTERNAL_ERROR"}}`. CORS headers present (`access-control-allow-origin: …vercel.app`) and `x-actor-id` assigned → the request reaches the handler; the failure is inside it.

## Root Cause

`@supabase/supabase-js` declared `^2.45.0` resolved (lockfile drift) to **2.105.4**. `createClient()` **eagerly** constructs a `RealtimeClient` whose constructor calls `getWebSocketConstructor()`. On **Node < 22 there is no global `WebSocket`**, so `@supabase/realtime-js` throws:

```
Node.js 20 detected without native WebSocket support.
  at getWebSocketConstructor (@supabase/realtime-js/.../websocket-factory.ts:178)
  at new RealtimeClient (...)
  at SupabaseClient._initRealtimeClient (...)
  at createClient (@supabase/supabase-js/src/index.ts:65)
  at getSupabaseAdmin (packages/api/src/lib/supabaseAdmin.ts:46)   ← thrown here
  at routes/auth.ts:86 (POST /auth/login handler)
```

The thrown error carries no recognized `code`, so `mapError()` falls through to the generic `500 INTERNAL_ERROR` branch (`errors/errorHandler.ts:674-683`). It is NOT the configured `503 AUTH_PROVIDER_UNAVAILABLE` path — Supabase env vars are present and correct (`SUPABASE_URL = https://ikardkyiqkpojfociucy.supabase.co`).

**Render runs Node 20; CI runs Node 22.** Node 20 reached EOL on 2026-04-30. We only ever use the auth API (`auth.signInWithOtp`, `auth.admin.signOut`) — never Realtime — but the client is built eagerly so the Realtime constructor runs regardless.

### Why it was never caught

1. **All f107a route tests mock `@supabase/supabase-js`** (`vi.mock(... createClient ...)`), so the real createClient — and the throwing Realtime constructor — never runs in any test.
2. **CI runs Node 22** (`.github/workflows/ci.yml`), which has a global `WebSocket`, so the throw cannot reproduce there even if createClient were real.
3. `supabaseAdmin.ts` had **no dedicated test** at all.

## Fix

Supply the `ws` transport to the eager Realtime client so its constructor is satisfied without a global WebSocket (the remedy named in the error message itself, and the supported way to run supabase-js on Node < 22):

```ts
// packages/api/src/lib/supabaseAdmin.ts
import ws from 'ws';
_instance = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws as unknown as typeof WebSocket },
});
```

`ws` (already a transitive dep, 8.19.0) promoted to a direct dependency; `@types/ws` added to devDependencies; lockfile resynced.

## Acceptance Criteria

- [x] **AC1**: `getSupabaseAdmin` passes `realtime: { transport: ws }` to `createClient`.
- [x] **AC2**: `ws` declared as a direct dependency, `@types/ws` as devDependency, `package-lock.json` in sync.
- [x] **AC3**: Anti-regression unit test simulates Node < 22 by deleting `globalThis.WebSocket` and asserts `getSupabaseAdmin` does NOT throw — deterministic regardless of the CI Node version. (RED without the fix, GREEN with it; the RED was empirically confirmed by reproducing the throw on local Node 20.)
- [x] **AC4**: Unit tests preserve the `AUTH_PROVIDER_UNAVAILABLE` guard for absent `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`.
- [x] **AC5**: Singleton behaviour preserved (same instance across calls).
- [x] **AC6**: TypeScript compiles cleanly (`tsc --noEmit`).
- [x] **AC7**: No test regressions — full api suite 4596/4596 (was 4592 + 4 new).
- [ ] **AC8**: Magic-link login E2E verified on the develop Vercel Preview after Render redeploys (operator step, post-merge).

## Definition of Done

- [x] All code AC met (AC8 pending operator deploy verification)
- [x] Tests pass (RED → GREEN confirmed)
- [x] TypeScript clean + lint clean
- [x] `bugs.md` updated
- [ ] PR created to develop + CI green
- [ ] Merged + Render redeploy + login E2E verified (closes AC8 → Task #18 Step 6)

## Workflow Checklist

- [x] Step 1: Triage (High, Path B)
- [x] Step 2: Ticket created
- [x] Step 3: Branch + TDD (RED proven via local Node 20 repro → GREEN)
- [x] Step 4: Validate (tsc clean, lint clean, full suite green)
- [ ] Step 5: Document + commit + PR + merge approval
- [ ] Step 6: Deploy (Render redeploy) + verify login E2E on dev preview

## Follow-up (decoupled — separate ticket)

Node 20 is EOL (2026-04-30); Render + local dev run it while CI already runs Node 22. The principled fix is to bump the runtime to Node 22 LTS, which provides a global `WebSocket` and makes this `ws` transport unnecessary (it can then be removed). Tracked separately so the runtime bump can be validated (full suites on Node 22 locally) before touching Render — not coupled to this urgent login fix. See task "File separate Node 22 bump maintenance ticket".

## Completion Log

| Step | Date | Detail |
|------|------|--------|
| Symptom observed | 2026-05-20 | Web `/login` "Internal server error" after CORS_ORIGINS fix landed. |
| Diagnosis | 2026-05-20 | Live curl → 500 INTERNAL_ERROR. Differential (503-vs-500) ruled out missing/wrong env. Render logs revealed `Node.js 20 detected without native WebSocket support` thrown at `createClient`. Reproduced locally on Node 20.20.1. |
| Triage | 2026-05-20 | High severity, Path B Standard. Fix A (ws transport) chosen over Node bump (user risk-averse to runtime change mid-release); Node bump decoupled. |
| TDD GREEN | 2026-05-20 | `realtime: { transport: ws }` + new `supabaseAdmin.test.ts` (4 tests). Targeted test 4/4 PASS. |
| Validate | 2026-05-20 | tsc clean, eslint clean, full api suite 4596/4596 PASS. |
