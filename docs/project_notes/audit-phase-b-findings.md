# Phase B Audit — Findings Log

> Collected during post-Phase B audit (2026-04-07 to 2026-04-08).
> To be resolved systematically via SDD workflow before Phase C.
>
> **Audit complete.** All 5 puntos done. 7 findings total (2 HIGH, 3 MEDIUM, 1 LOW, 1 architectural).

## Action Plan

| Priority | IDs | Action | SDD Feature ID | Status |
|----------|-----|--------|---------------|--------|
| 1 | C1 + C3 | Fix `/reverse-search` error envelope | BUG-AUDIT-C1C3 (Simple) | **done** (PR #82) |
| 2 | C4 | Fix POST empty body → 500 | BUG-AUDIT-C4 (Simple) | **done** (PR #83) |
| 3 | C5 | Fix reverse search via conversation | BUG-AUDIT-C5 (Simple) | **done** (PR #84) |
| — | C2 | Context persistence — deferred (pre-existing F069/F070) | — | deferred |
| — | C6 | Pizza data corruption — deferred (scraping issue) | — | deferred |
| — | A1 | Bot rate limit architecture — deferred (low priority) | — | deferred |

## Code Bugs

| ID | Severity | Finding | Source | Status |
|----|----------|---------|--------|--------|
| C1 | HIGH | `/reverse-search` 404 CHAIN_NOT_FOUND returns `{success, code, message}` instead of `{success, error: {code, message}}` — inconsistent with API error envelope | Punto 2 + Codex | **fixed** (PR #82) |
| C3 | HIGH | `/reverse-search` 400 validation error returns raw Zod `{formErrors, fieldErrors}` without `{success, error: {code: "VALIDATION_ERROR"}}` wrapper | Punto 2 + Codex | **fixed** (PR #82) |
| C2 | MEDIUM | Conversation context set via `POST /conversation/message` ("estoy en X") does not persist for subsequent requests with same X-Actor-Id — `activeContext: null` on next request. Pre-existing (F069/F070 actor system design). Works when chain is passed in request body. | Punto 2 | pending |

## Documentation Fixes (Applied)

| ID | Manual | Finding | Source | Status |
|----|--------|---------|--------|--------|
| D1 | API | `UncertaintyRange.marginPercent` → actual field is `percentage` | Punto 2 | fixed |
| D2 | API | `HealthHackerTip.category` — field doesn't exist | Punto 2 | fixed |
| D3 | API | `DetectedAllergen.category` + `confidence` → actual fields are `allergen` + `keyword` | Punto 2 | fixed |
| D4 | API | `PortionSizing` missing `description` field | Punto 2 | fixed |
| D5 | API | Conversation examples missing `activeContext` (required nullable) | Gemini + Codex | fixed |
| D6 | API | `referenceBasis` missing `per_package` | Codex | fixed |
| D7 | API | `EstimateSource` missing OFF attribution fields | Gemini + Codex | fixed |
| D8 | API | `yieldAdjustment` structure undocumented (7 fields) | Gemini | fixed |
| D9 | API | Health check note wrong (Kysely IS checked) | Codex | fixed |
| D10 | API | `Retry-After` values imprecise | Codex | fixed |
| D11 | API | `availability` enum missing `regional` | Codex | fixed |
| D12 | Bot | Reverse search output format wrong (header, emojis, footer) | Gemini + Codex | fixed |
| D13 | Bot | `/comparar` counts as 2 queries (not 1) in daily bucket | Codex | fixed |
| D14 | Bot | Portion sizing terms wrong (`cuenco` → `caña`, `ración para compartir`) | Codex | fixed |
| D15 | Bot | `/menu` error messages not documented | Gemini | fixed |
| D16 | Bot | `/receta` usage message is multiline | Gemini | fixed |
| D17 | Bot | Voice section missing reverse_search | Codex | fixed |

## Architectural Observations

| ID | Severity | Finding | Source | Status |
|----|----------|---------|--------|--------|
| A1 | LOW | Bot shares a single API key rate-limit bucket for all Telegram users. 1 user gets the full 100 req/15min (free tier), but 100 concurrent users only get ~1 req each. The bot's own daily query budget (per-user) mitigates abuse, but the API-level rate limit doesn't scale with bot user count. Consider: (a) upgrade bot key to `pro` tier, (b) exempt bot key from global rate limit and rely on bot-side per-user limits, or (c) add per-actor rate limiting at the API level. | Punto 4 | noted |

## Findings from Punto 4 (Exhaustive API Testing — 2026-04-08)

### New Code Bugs

| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| C4 | MEDIUM | POST endpoints (`/calculate/recipe`, `/conversation/message`) return 500 INTERNAL_ERROR when body is missing or invalid JSON. Should return 400 VALIDATION_ERROR. Fastify body parser throws before Zod validation runs. | **fixed** (PR #83) |
| C5 | MEDIUM | Reverse search via conversation (`POST /conversation/message` with reverse_search intent) always returns `dishes: []` even when the direct endpoint (`GET /reverse-search`) returns results. The `catch` block in `conversationCore.ts:161` silently swallows the DB error. Likely a Kysely instance issue or query parameter mismatch between the two code paths. | **fixed** (PR #84) |
| C6 | LOW | Comparison data quality: "Pizza" from Pizza Hut chain shows 4 calories (clearly wrong — likely column swap during scraping). Source field says "McDonald's Spain — Web Scrape" for a Pizza Hut dish. Data integrity issue, not API code bug. | noted |

### Verified Behaviors (Working as Expected)

| Area | Tests | Result |
|------|-------|--------|
| **Estimation** | Normal query, empty query, no param, long query, XSS, nonexistent chain, portionMultiplier (valid/invalid/decimal) | All correct — proper validation, fallback, and 400 errors |
| **Enrichments** | healthHackerTips (McDonald's), substitutions (patatas fritas), allergens (croquetas), portionSizing ("ración de..."), uncertaintyRange | All present and correct when conditions are met |
| **Recipe** | Free-form, structured, portions (El Tupper), portion edge cases (0, 51, 1) | All correct — perPortion divides accurately, validation rejects invalid |
| **Menu estimation** | With "menú:" trigger + diners ("para 3 personas") | Correct — 3 items, totals, perPerson divides properly |
| **Reverse search (direct)** | Valid query, minProtein filter, invalid chain (C1), missing params (C3) | Works. C1/C3 error format bugs confirmed. |
| **Catalog** | /chains (15), /restaurants (15), /dishes/search, /restaurants/:id/dishes | All paginated correctly, filters work |
| **Auth** | No key (anonymous OK), invalid key (401), admin routes (hidden as 404) | Correct behavior |
| **Cache** | cachedAt=null first request, timestamp on second | Working correctly |
| **Production** | estimate, reverse-search, chains | Matches staging behavior |

### Observations (Not Bugs)

- **Free-form recipe LLM parsing**: "200g de pollo, 100g de arroz, 50ml de aceite de oliva" → LLM only parsed 2/3 ingredients (missed "aceite de oliva"). Structured mode resolved all 3. LLM parsing is best-effort.
- **Menu detection requires "menú" keyword**: "he comido paella, ensalada y flan" → classified as `estimation`, not `menu_estimation`. By design — trigger word required.
- **Reverse search requires both chainSlug + chainName in body**: Passing only `chainSlug` without `chainName` → `effectiveContext` is null → no results. The `&&` guard in `conversationCore.ts:77` requires both fields.
- **McDonald's Spain: only 2 dishes** in database. Likely scraping limitation, not API issue.
- **4 chains with 0 dishes**: subway-es, mcdonalds-pt, dominos-es, pans-and-company-es.

### Summary

| Severity | From Punto 2+3 | New in Punto 4 | Total |
|----------|----------------|----------------|-------|
| HIGH | 2 (C1, C3) | 0 | 2 |
| MEDIUM | 1 (C2) | 2 (C4, C5) | 3 |
| LOW | 0 | 1 (C6) | 1 |
| Architectural | 0 | 1 (A1) | 1 |
| **Total** | **3** | **4** | **7** |
