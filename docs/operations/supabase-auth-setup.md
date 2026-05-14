# Supabase Auth Setup — F107a Operator Runbook (AC24, AC26)

**Status:** Stub — to be completed with real Supabase project credentials.

---

## Supabase Project Configuration (AC24a)

1. Open Supabase Dashboard → Authentication → Providers.
2. Enable **Email** provider only. Disable Google OAuth (deferred to F107a-FU1).
3. Configure "Allowed Redirect URLs":
   - `https://app.nutrixplorer.com/auth/callback`
   - `https://app-dev.nutrixplorer.com/auth/callback`
   - `http://localhost:3002/auth/callback`
4. Confirm email templates are in Spanish (Settings → Auth → Email Templates).

---

## Environment Variables (AC24b, AC24c)

### Render — API service

| Variable | Source | Notes |
|----------|--------|-------|
| `SUPABASE_URL` | Supabase → Settings → API → Project URL | Used for Supabase Admin SDK calls |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → Service Role key | Used for `signOut` admin invalidation |
| `SUPABASE_JWKS_URL` | `{SUPABASE_URL}/auth/v1/.well-known/jwks.json` | Used by `jose` for RS256 JWT verification |
| `SUPABASE_JWT_SECRET` | Supabase → Settings → API → JWT Secret | Emergency operator tool only. NOT consumed by API code (no HS256 fallback path). |

### Vercel — Web app

| Variable | Source | Notes |
|----------|--------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Same as `SUPABASE_URL` | Public — safe for browser |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon (public) key | Public — safe for browser |

---

## Deployment Order (AC26)

**Deploy backend FIRST, then web.**

1. Deploy `packages/api` to Render with all `SUPABASE_*` env vars set.
2. Verify bearer routes respond before deploying web:
   - `GET /me` without bearer → expect `401 UNAUTHORIZED`
   - `GET /estimate?query=arroz` without bearer → expect `200` (anonymous flow unchanged)
   - `POST /auth/login` with `{ provider: 'email', email: 'test@test.com', redirectTo: '...' }` → expect `200 { success: true }`
3. Deploy `packages/web` to Vercel with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` set.

**Rollback order is reversed:** web first (removes bearer client), then API if needed.

---

## Render Cron — Free-tier inactivity mitigation (AC24d)

Render free-tier services sleep after 15 minutes of inactivity.
Set up a Render Cron Job to ping the API daily:

- **Schedule:** `0 8 * * *` (08:00 UTC daily)
- **URL:** `GET https://<api-render-domain>/health?db=true`
- This keeps the service warm and verifies DB connectivity.

---

## EU Region (AC24e)

Confirm Supabase project is in **EU West (Frankfurt)** region.
Verify: Supabase Dashboard → Settings → General → Region.

---

## Manual Smoke Checklist — Step 4 Finalize (AC19, AC21, AC22 manual coverage)

Run this against local dev (`npm run dev` on both api + web) with real Supabase keys in `.env.local`:

- [ ] `/login` page reachable; email input + "Entrar con email" button visible; NO Google button.
- [ ] Submit valid email → success state "Revisa tu correo — te hemos enviado un enlace de acceso" visible; form hidden.
- [ ] Open the magic-link email (check Supabase Dashboard → Authentication → Logs for dev project).
- [ ] Click/visit the magic link → redirect to `/hablar` → UserMenu avatar visible top-right.
- [ ] Click UserMenu avatar → dropdown shows user email + "Cerrar sesión" button.
- [ ] Click "Cerrar sesión" → redirect to `/` → UserMenu absent.
- [ ] Reload `/hablar` → no UserMenu (session cleared).
- [ ] Visit `/auth/callback?error=access_denied` → redirect to `/login` (no error param).
- [ ] Visit `/auth/callback?error=server_error` → redirect to `/login?error=callback_failed` → error message visible.
- [ ] `GET /me` from terminal without bearer → `401 UNAUTHORIZED`.
- [ ] `GET /me` from terminal with valid bearer → `200` with account+actor.
- [ ] `GET /estimate?query=arroz` without bearer → `200` anonymous (no regression — AC13).

---

## F107a-FU1 Placeholder — Google OAuth (AC24f)

When the GCP project is ready:

1. Create a GCP project and configure OAuth 2.0 client (web app type).
2. Authorize Supabase callback URI: `https://<supabase-project>.supabase.co/auth/v1/callback`.
3. In Supabase Dashboard → Authentication → Providers → Google → Enable.
4. Paste Client ID and Client Secret.
5. Add "Google" button to `src/app/login/page.tsx` where the `{/* F107a-FU1: Google OAuth button goes here */}` comment is.
6. Add Playwright E2E tests for the OAuth consent screen flow.
