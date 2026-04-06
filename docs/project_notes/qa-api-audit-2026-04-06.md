# QA Audit — API foodXPlorer (2026-04-06)

> Cross-model QA audit: Claude (live staging tests) + Gemini CLI + Codex CLI.
> Staging: api-dev.nutrixplorer.com | Branch: develop

---

## Staging Issues (Config/Data)

| ID | Severity | Issue | Status |
|----|----------|-------|--------|
| F1 | CRITICAL | DB_UNAVAILABLE on all Kysely-based endpoints (/estimate, /conversation/*, /calculate/recipe). Health check passes (Prisma only). | **Fixed** — PgBouncer compatibility in kysely.ts |
| F2 | CRITICAL | cocina-espanola not returned by GET /chains — 250 dishes invisible to API clients | Root cause identified |
| F3 | CRITICAL | GET /chains?countryCode=ES returns 0 — filter broken (case-sensitivity or empty data) | Root cause identified |
| F4 | IMPORTANT | mcdonalds-es shows only 2 dishes in /chains — data seeding issue on staging | Root cause identified |
| F5 | IMPORTANT | cookingState accepts 'as_served' but manual only documented 'raw'\|'cooked' | Fixed (D1) |
| F6 | IMPORTANT | OPTIONS /estimate returns 404 — CORS not configured on staging | **Fixed** (code) — added X-Actor-Id + X-FXP-Source to CORS allowedHeaders. CORS_ORIGINS still needs to be set in Render |

## Root Cause Analysis & Solutions

### F1: DB_UNAVAILABLE on Kysely endpoints

**Root cause:** `getKysely()` in `packages/api/src/lib/kysely.ts` creates a `pg.Pool` reading `DATABASE_URL` directly from `process.env`. In Docker (Render), the pool connects but may fail under load or due to connection limit exhaustion — Prisma and Kysely maintain **separate** connection pools against the same database. Supabase free tier has a 60-connection limit; both pools competing can starve Kysely.

**Solution:**
1. **Immediate:** Check Render environment variables — ensure `DATABASE_URL` is correctly set and accessible from the Docker container. Add `?connection_limit=10` to the Prisma connection string and `max: 10` to the pg.Pool config to prevent exhaustion.
2. **Short-term:** Add Kysely health check to `/health?db=true` — execute `db.selectFrom(sql'1').execute()` alongside the Prisma check.
3. **Medium-term:** Consider `prisma-extension-kysely` to share a single connection pool.

### F2: cocina-espanola not in /chains

**Root cause:** `GET /chains` queries `prisma.restaurant.findMany()` and groups by `chainSlug`. The virtual chain `cocina-espanola` requires at least one restaurant row with `chainSlug: 'cocina-espanola'` in the `restaurants` table. If the staging seed script didn't create this placeholder restaurant, the chain is invisible.

**Solution:** Ensure the seed script creates a placeholder restaurant for cocina-espanola:
```sql
INSERT INTO restaurants (id, name, name_es, chain_slug, country_code, is_active)
VALUES (gen_random_uuid(), 'Cocina Española', 'Cocina Española', 'cocina-espanola', 'ES', true)
ON CONFLICT (chain_slug, country_code) DO NOTHING;
```

### F3: countryCode=ES returns 0

**Root cause:** The `countryCode` filter in `/chains` uses Prisma's exact match (`{ countryCode }`), which is case-sensitive in PostgreSQL. If data was seeded with lowercase `es` (or empty), `countryCode=ES` returns no matches. The Zod schema validates `^[A-Z]{2}$` so users must send uppercase, but the data must also be uppercase.

**Solution:**
1. Verify and fix data: `UPDATE restaurants SET country_code = UPPER(country_code) WHERE country_code != UPPER(country_code);`
2. Optionally: normalize in the route handler with `.toUpperCase()` before querying, or use Prisma's `mode: 'insensitive'`.

### F4: mcdonalds-es 2 dishes

**Root cause:** The `/chains` endpoint counts dishes per restaurant via `_count: { select: { dishes: true } }`, then accumulates by chainSlug. If the staging database only has 2 dishes linked to mcdonalds-es restaurants (incomplete seeding), the count is correct per the data — it's a data issue, not a code bug.

**Solution:** Re-run the scraper/seeder for mcdonalds-es on staging: `SCRAPER_CHAIN=mcdonalds-es npm run scrape` or re-seed from the production dataset.

### F6: OPTIONS returns 404 (CORS)

**Root cause:** On Render staging, `NODE_ENV=production` and `CORS_ORIGINS` is not set in environment variables. This results in `origin: false` in the CORS config, which disables CORS entirely — no preflight handling, no `Access-Control-*` headers.

**Solution:** Set `CORS_ORIGINS` in Render dashboard for the staging service:
```
CORS_ORIGINS=https://nutrixplorer.com,https://staging.nutrixplorer.com
```
Also add `X-Actor-Id` and `X-FXP-Source` to the CORS `allowedHeaders` list in `cors.ts` for future browser client support.

## Documentation Fixes Applied

| ID | Section | Fix |
|----|---------|-----|
| D1 | 5, 18 | Added `as_served` to cookingState documentation |
| D2 | 7 | Fixed /analyze/menu: added mode `identify`, corrected response schema |
| D3 | 14 | Clarified /health only checks Prisma, not Kysely |
| D4 | 8 | Clarified text_too_long is 200 OK, not an error |
| D5 | 4 | Rate limit headers: clarified only present on global limiter responses |
| D6 | 2, 8 | Clarified X-Actor-Id (header) vs data.actorId (internal DB UUID) |
| D7 | 4 | Documented that failed requests also consume daily quota |

## Security & Robustness Backlog (Post-Phase B)

These issues are acknowledged but deferred to after Phase B. The API is not yet public-facing at scale.

| ID | Severity | Issue | Source | Action |
|----|----------|-------|--------|--------|
| A1 | CRITICAL | Actor impersonation — X-Actor-Id trusted blindly, attacker can spoof telegram:12345 | Gemini | Add HMAC signature from bot, validate in API |
| A2 | HIGH | Audio DOS / billing — server buffers entire audio before validating duration | Gemini | Enforce multipart file size limit for audio route |
| A3 | MEDIUM | Free-form recipe grams unbounded — LLM can return grams: 99999999 | Gemini | Add .max(5000) to ParsedIngredientSchema |
| A4 | MEDIUM | Free-form recipes silently ignore cookingState | Gemini | Document limitation or parse cooking state from text |
| C1 | HIGH | trustProxy: true unconditional — IP rate limiting spoofable via X-Forwarded-For | Codex | Configure explicit trusted proxy for Render |
| C2 | HIGH | CORS missing X-Actor-Id and X-FXP-Source in allowedHeaders | Codex | Add to CORS config when browser clients are supported |
| C3 | HIGH | Actor table abuse — unbounded row creation per request without X-Actor-Id | Codex | Create actors only on routes that need them, or after validation |
| C4 | HIGH | /analyze/menu manual has wrong response schema | Codex | Fixed (D2) |
| C5 | MEDIUM | Retry-After hardcoded 3600s but message says "tomorrow" | Codex | Fix Retry-After to 86400 or calculate remaining seconds |
| C6 | MEDIUM | Health check doesn't cover Kysely — false positive possible | Codex | Fixed (D3) + add Kysely health probe |
| C7 | MEDIUM | /chains derived from restaurants — no canonical chain table, unstable order | Codex | Refactor to chain table or stable ordering |
| C8 | MEDIUM | Actor ID confusion — data.actorId is DB UUID, not X-Actor-Id header | Codex | Fixed (D6) |
| C9 | LOW | Failed requests consume daily quota (rate limit incremented before validation) | Codex | Fixed (D7) + consider moving rate limit after validation |

---

Generated: 2026-04-06. Reviewers: Claude Opus 4.6, Gemini CLI, Codex CLI (gpt-5.4).
