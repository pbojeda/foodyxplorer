# Sentry Observability Checklist (api)

> **Operator setup guide** for the api Sentry integration shipped in F030-lite.
> **Last updated:** 2026-05-11.

The api code has been wired to forward 5xx errors and uncaught startup failures to Sentry, with PII scrubbing enabled by default. This document is the checklist for **enabling** that capture in production. Until step 2 is done, Sentry is fully inert — `initSentry` no-ops without `SENTRY_DSN` set.

---

## TL;DR

1. Create the Sentry project → copy DSN.
2. Set `SENTRY_DSN` env var on Render `nutrixplorer-api-prod` (and optionally `-dev`).
3. Configure 2 minimal email alert rules in Sentry.
4. (Optional) Add UptimeRobot HTTP monitors.
5. Smoke-test by triggering one organic 500 and confirming it appears in Sentry.

Everything is reversible — unset the env var to disable.

---

## Step 1 — Create the Sentry project

1. Go to <https://sentry.io> → sign up or log in (free plan supports ~5K errors/month, sufficient for closed beta).
2. **Create Organization** if you don't have one (e.g., `nutrixplorer`).
3. **Create Project** → platform `Node.js` → project name `nutrixplorer-api`.
4. After creation, Sentry shows a quickstart with a DSN URL like `https://<key>@o<orgId>.ingest.sentry.io/<projectId>`.
5. Copy the DSN. (Settings → Projects → nutrixplorer-api → Client Keys (DSN) at any time.)

---

## Step 2 — Set `SENTRY_DSN` in Render

### nutrixplorer-api-prod (production)

1. Render dashboard → service `nutrixplorer-api-prod` → **Environment** tab.
2. Add env var:
   - Key: `SENTRY_DSN`
   - Value: the DSN from Step 1.
   - Mark as **secret** (toggle).
3. **Save**, then **Manual Deploy** (or push to `main` if a release is imminent).
4. After redeploy, the api logs should contain a line: `[sentry] initialized (env=production)`. (Logs visible in Render → Logs tab.)

### nutrixplorer-api-dev (optional — staging coverage)

Same as above but for the dev service. Use a separate Sentry project (e.g., `nutrixplorer-api-dev`) so dev noise doesn't pollute prod metrics.

### What does NOT change

- `NODE_ENV` stays `production` on the prod service (already configured).
- No code change is needed — `initSentry` reads `config.SENTRY_DSN` and `config.NODE_ENV`.
- If `SENTRY_DSN` is set but `NODE_ENV !== 'production'`, the SDK still no-ops (belt-and-suspenders guard).

---

## Step 3 — Configure 2 email alert rules

Sentry's Issues page lists every unique exception. Without alert rules you have to refresh it manually. Two minimal rules cover the closed-beta phase:

### Rule A — "New issue, level:error"

1. Sentry → **Alerts** → **Create Alert** → **Issues** template.
2. **When**: an event is captured.
3. **If** (conditions, ALL): `The issue is created` AND `level equals error`.
4. **Then**: send email to your operator address.
5. **Name**: `New error issue → email`.
6. Save.

### Rule B — "Spike: > 10 events in 5 minutes"

1. **Alerts** → **Create Alert** → **Issues**.
2. **When**: an issue is updated.
3. **If**: `The issue is seen more than 10 times in 5m`.
4. **Then**: send email to your operator address.
5. **Name**: `Error spike → email`.
6. Save.

You can refine these later (Slack webhook, paging) but these two cover the basic "I should know about it" + "production is on fire" cases.

---

## Step 4 — UptimeRobot HTTP monitors (optional)

Sentry tells you when the api errors. UptimeRobot tells you when the api is unreachable (DNS, Render outage, certificate expiry). Complementary.

1. <https://uptimerobot.com> → free plan supports 50 monitors at 5-min interval.
2. **Add New Monitor** → **HTTP(s)**.
   - URL: `https://api.nutrixplorer.com/health`
   - Friendly name: `API prod health`
   - Monitoring interval: 5 minutes.
   - Alert contacts: your email.
3. Add a second monitor for the web app: `https://app.nutrixplorer.com/`.
4. (Optional) Third monitor for the landing: `https://nutrixplorer.com/`.
5. UptimeRobot starts pinging — first event appears in the dashboard within 5 min.

---

## Step 5 — Smoke test

After Step 2 redeploys, verify capture works:

1. Wait for an organic error, OR force one:
   - Temporarily push a commit that adds a `/_smoke-500` route that throws — wait, see Sentry → revert. Better: pick a known 5xx-producing edge case in an existing endpoint and trigger it via curl.
   - Quickest: hit a route with a known internal contract error (e.g., a POST to `/estimate` with a malformed body that bypasses Zod and reaches a runtime guard).
2. Within ~30 seconds, the Sentry **Issues** page should show a new issue with:
   - Title: the error message.
   - **Tags**: `environment=production`, `level=error`.
   - **Additional Data (extra)**: `route`, `method`, `requestId`, `statusCode`, `internalCode`, `actorIdHash`.
   - **Request**: headers shown with `authorization`, `cookie`, `x-api-key` redacted; body shown as `[Filtered]`; query string as `[Filtered]`.
3. If you see PII (raw request body, real Authorization header, raw actorId) in the issue, **STOP and investigate** — the `beforeSend` scrubber didn't fire. Open a P0 bug.
4. Once verified, delete the test issue (or leave as a baseline reference).

---

## Operational notes

### What gets captured

- **5xx errors** from the Fastify error handler (`packages/api/src/errors/errorHandler.ts`).
- **Uncaught startup failures** in `server.ts` (`main().catch`) — buildApp/connectRedis/listen rejection.
- **NOT 4xx** — those are user-facing validation/auth/rate-limit errors, not bugs.
- **NOT 404** — `setNotFoundHandler` is not wired to Sentry.

### PII redaction

Layered:
1. SDK-level `sendDefaultPii: false` (Sentry's built-in scrubber).
2. Custom `beforeSend` hook in `packages/api/src/lib/sentry.ts` strips: `Authorization`/`Cookie`/`X-Api-Key` headers, request body, query string, ip address, and any `extra` field whose key matches `password|secret|token|api[_-]?key|cookie|authorization` (case-insensitive).
3. `SentryContext` TypeScript interface restricts what production code can attach to `extra` at compile time.

### Cost ceiling

The free plan covers ~5K events/month. The current closed-beta volume is well under that. If usage grows, options: (a) sample (lower `tracesSampleRate` is already 0; consider `Sentry.captureException` rate limiting at the wrapper level), (b) upgrade plan, (c) self-host Sentry.

### Disabling

To disable entirely: unset `SENTRY_DSN` in Render → redeploy. `initSentry` no-ops, `captureException` no-ops. No code change needed.

### What is NOT shipped in F030-lite

These items will land in a future F030-FU follow-up, tracked in `product-tracker.md` → F030 row:
- Bot SDK install (`packages/bot`).
- Web SDK install (`packages/web` via `@sentry/nextjs`).
- Landing SDK install (`packages/landing` via `@sentry/nextjs`).
- Source map upload to Sentry releases (Sentry CLI in CI).
- Performance tracing / profiling.
- Custom metrics (counters, histograms).
- Formal SLOs + runbooks.
- Slack / PagerDuty routing.

---

## References

- `packages/api/src/lib/sentry.ts` — the wrapper (initSentry + captureException + beforeSend scrubber + hashActor).
- `packages/api/src/server.ts` — `initSentry(...)` call site at the top of `main()` + startup-failure capture in `main().catch`.
- `packages/api/src/errors/errorHandler.ts` — 5xx → Sentry forwarding (`statusCode >= 500` branch).
- `docs/tickets/F030-lite-sentry-api.md` — the ticket that produced this guide.
- `docs/operations/branch-protection-checklist.md` — sister operator doc for branch protection (F116-lite).
- Sentry docs: [Node.js SDK](https://docs.sentry.io/platforms/javascript/guides/node/), [Issue alerts](https://docs.sentry.io/product/alerts/issue-alerts/).
