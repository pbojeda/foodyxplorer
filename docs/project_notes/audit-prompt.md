# foodXPlorer — Full Project Audit Prompt

> **Purpose:** This document is a comprehensive prompt for external AI agents (Gemini, Codex, ChatGPT, etc.) to audit the entire foodXPlorer codebase. Your goal is to find bugs, security vulnerabilities, architectural flaws, data integrity issues, missing edge cases, and anything else that could cause problems in production. Be thorough and critical — do not praise, only report findings.

---

## 1. Project Overview

**foodXPlorer** is an open-source platform that provides nutritional information for any dish, at any restaurant, in any context. It targets the Spanish fast-food market initially (Phase 1), with international expansion planned for Phase 2.

### Core Value Proposition
A user (via Telegram bot or API) asks: "¿Cuántas calorías tiene un Big Mac?" and receives an accurate, traceable nutritional breakdown sourced from official chain data — not from an LLM hallucinating numbers.

### Key Architectural Principle (ADR-001)
**"The engine calculates, the LLM interprets."** The estimation engine is deterministic and auditable. Every nutritional value is traceable to a data source. The LLM is used ONLY for:
- Parsing natural language queries into structured queries (Level 4 identification)
- The LLM NEVER calculates nutritional values directly

### Phase 1 Targets
- 100 users, 10 chains, <3s response time, <0.05€/query
- 7 chains currently onboarded: McDonald's, Burger King, KFC, Telepizza, Domino's, Subway, Pans & Company (all Spain)

---

## 2. Technology Stack

| Component | Technology | Version/Notes |
|-----------|-----------|---------------|
| Runtime | Node.js + TypeScript (strict mode) | |
| API Framework | Fastify v5 | OpenAPI auto-generated, Zod validation |
| ORM / Migrations | Prisma | Migrations + simple CRUD |
| Query Builder | Kysely | Complex queries, pgvector, 3+ joins |
| Database | PostgreSQL 16 | + pgvector + pg_trgm + JSONB |
| Cache / Rate Limiting | Redis (ioredis) | Fail-open (app runs without Redis) |
| Bot | node-telegram-bot-api | Long polling |
| Validation | Zod | Schemas shared in packages/shared |
| Embeddings | OpenAI text-embedding-3-small | 1536 dimensions |
| LLM (L4 only) | OpenAI Chat API | Model configurable via OPENAI_CHAT_MODEL |
| OCR | Tesseract.js v5 | Spanish + English |
| Test Framework | Vitest | 2718 tests total |

### Monorepo Structure (npm workspaces)

```
packages/
├── shared/     — Zod schemas (single source of truth for types)
├── api/        — Fastify REST API (main backend)
├── bot/        — Telegram bot (standalone, consumes API via HTTP)
├── scraper/    — Web scraper framework (McDonald's only; most chains use PDF pipeline)
```

### Prisma vs Kysely Rule
- **Prisma**: All schema migrations, simple CRUD, relations with include
- **Kysely**: Nutritional calculations (aggregated sums), pgvector searches, 3+ joins, full-text search, any query needing precise SQL

---

## 3. Database Schema

**10 enums, 16 models.** Key entities:

### Core Data Model
```
DataSource (official/estimated/scraped/user)
  ├── Food (generic/branded/composite) — with pgvector embedding(1536)
  │     ├── FoodNutrient (15 nutrients, per_100g default)
  │     ├── StandardPortion (XOR: food_id OR food_group, CHECK constraint)
  │     ├── Recipe → RecipeIngredient (composite food modeling)
  │     └── DishIngredient (reverse: food used as ingredient)
  ├── Restaurant (chainSlug + countryCode unique)
  │     └── Dish — with pgvector embedding(1536)
  │           ├── DishNutrient (15 nutrients, per_serving default, max 9000 cal)
  │           ├── DishIngredient → Food
  │           ├── DishCookingMethod → CookingMethod
  │           └── DishDishCategory → DishCategory
  ├── ApiKey (SHA-256 hash, free/pro tier, expiration)
  └── QueryLog (audit, no FK intentionally — immutable records)
```

### Key Schema Facts
- `foods.embedding` and `dishes.embedding` are `Unsupported("vector(1536)")` in Prisma — all reads/writes via `$queryRaw`/`$executeRaw`
- `standard_portions` has a XOR CHECK constraint (food_id OR food_group, not both) — enforced at both DB and Zod level
- `restaurants` has `@@unique([chainSlug, countryCode])` — one row per chain per country
- `dish.food_id` is nullable with `ON DELETE SET NULL` — dish can exist before food composition is known
- `dish_nutrients.reference_basis` defaults to `per_serving` (not `per_100g`)
- `query_logs` has NO foreign keys (intentional — immutable audit records, no cascade risk)
- 8 migrations total, applied with `migrate deploy` (not `migrate dev` — shadow DB lacks pgvector)

### Nutrient Columns (15 per food/dish)
calories, proteins, carbohydrates, sugars, fats, saturatedFats, fiber, salt, sodium, transFats, cholesterol, potassium, monounsaturatedFats, polyunsaturatedFats + extra (JSONB)

---

## 4. API Endpoints

All responses follow the envelope pattern: `{ success: true, data: ... }` or `{ success: false, error: { message, code, details? } }`.

### Public Endpoints (API key optional — anonymous = lower rate limit)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | /health | Health check (?db=true, ?redis=true) | None |
| GET | /estimate | **Core endpoint** — 4-level nutritional estimation cascade | API key (optional) |
| GET | /restaurants | Paginated restaurant list | API key (optional) |
| GET | /restaurants/:id/dishes | Dishes for a restaurant (optional search via pg_trgm) | API key (optional) |
| GET | /dishes/search | Global dish search (pg_trgm trigram) | API key (optional) |
| GET | /chains | Aggregated chain list | API key (optional) |

### Admin Endpoints (require ADMIN_API_KEY via X-API-Key header)

| Method | Path | Description |
|--------|------|-------------|
| POST | /ingest/pdf | PDF file upload → parse → persist |
| POST | /ingest/url | URL scrape → parse → persist |
| POST | /ingest/pdf-url | Download PDF from URL → parse → persist |
| POST | /ingest/image-url | Download image → OCR → parse → persist |
| GET | /quality/report | Data quality audit (6 dimensions) |
| POST | /embeddings/generate | Trigger OpenAI embedding generation |
| GET | /analytics/queries | Query log aggregation metrics |

### Authentication Architecture
- **Public routes**: Optional API key via `X-API-Key` header. No key = anonymous (30 req/15min). Free key = 100/15min. Pro key = 1000/15min
- **Admin routes**: `ADMIN_API_KEY` env var compared via SHA-256 + `timingSafeEqual`
- **Bot**: Sends `X-API-Key` (deterministic via HMAC-SHA256 seed) + `X-FXP-Source: bot` header
- **Rate limiting**: `@fastify/rate-limit` with Redis store. Dynamic 3-tier. Fail-open (skipOnError). Admin + /health exempt
- **API key validation**: SHA-256 hash → Redis cache (60s TTL, fail-open) → DB lookup → fail-closed on DB error with key present

### Error Codes
VALIDATION_ERROR (400), UNAUTHORIZED (401), FORBIDDEN (403), NOT_FOUND (404), PROCESSING_TIMEOUT (408), PAYLOAD_TOO_LARGE (413), INVALID_PDF (422), UNSUPPORTED_PDF (422), INVALID_IMAGE (422), OCR_FAILED (422), NO_NUTRITIONAL_DATA_FOUND (422), INVALID_URL (422), FETCH_FAILED (422), EMBEDDING_PROVIDER_UNAVAILABLE (422), SCRAPER_BLOCKED (422), RATE_LIMIT_EXCEEDED (429), DB_UNAVAILABLE (500), REDIS_UNAVAILABLE (500), INTERNAL_ERROR (500)

---

## 5. The Estimation Engine (Core Business Logic)

### GET /estimate — The Main Flow

```
User query: "big mac en mcdonalds-es"
  ↓
Zod validation (query: 1-255, chainSlug?: regex, restaurantId?: UUID)
  ↓
Redis cache check (key: fxp:estimate:<normalized>:<chainSlug>:<restaurantId>)
  ↓ (cache miss)
runEstimationCascade() — L1 → L2 → L3 → L4
  ↓
Cache write (TTL 300s, with cachedAt timestamp)
  ↓
HTTP 200 { success: true, data: EstimateData }
  ↓ (after response sent)
Fire-and-forget: writeQueryLog() via reply.raw.once('finish')
```

### 4-Level Cascade

**Level 1 — Official Data Lookup (F020)**
- 4-strategy cascade: exact_dish → fts_dish → exact_food → fts_food
- Kysely SQL with CTE de-duplication (ROW_NUMBER() OVER PARTITION BY)
- Scoped by chainSlug/restaurantId when provided
- Returns 15 nutrients + source traceability
- Confidence: high

**Level 2 — Ingredient-Based Estimation (F021)**
- 2-strategy cascade: ingredient_dish_exact → ingredient_dish_fts
- CTE aggregation: SUM(food_nutrient.X * dish_ingredient.gram_weight / 100)
- Only considers `per_100g` reference basis food_nutrients
- Confidence: medium (exact match) or low (FTS match)

**Level 3 — Similarity Extrapolation (F022)**
- 2-strategy cascade: similarity_dish (scoped to chain) → similarity_food (global)
- pgvector `<->` cosine distance, threshold 0.5
- Generates embedding at request time via OpenAI API
- Fail-graceful: skips if no OPENAI_API_KEY or OpenAI error
- Confidence: always low

**Level 4 — LLM Identification (F024)**
- Strategy A: pg_trgm trigram similarity → top-10 candidates → LLM selects best match → L1 lookup for nutrients
- Strategy B: LLM decomposes dish into ingredients → L1 resolution per ingredient → L2-style aggregation
- LLM NEVER sees nutrient values (ADR-001)
- Fail-graceful: `callChatCompletion` returns null on any OpenAI error
- Opt-in: requires `OPENAI_CHAT_MODEL` env var (no default)
- 2-attempt retry on 429/5xx
- Confidence: low

**Total Miss**
- HTTP 200 with all hit flags false (NOT a 404)
- `result: null, matchType: null`

### Match Types (EstimateMatchType enum)
exact_dish, fts_dish, exact_food, fts_food, ingredient_dish_exact, ingredient_dish_fts, similarity_dish, similarity_food, llm_food_match, llm_ingredient_decomposition

### Important: Query Normalization
- Cache key: `query.replace(/\s+/g, ' ').trim().toLowerCase()`
- Engine Router normalizes internally for DB lookups but echoes raw query in response
- `.trim()` applied at cache key level (fixed in code review)

---

## 6. Data Ingestion Pipeline

### PDF Pipeline (primary — 85% of chains use PDFs)
```
POST /ingest/pdf-url { url, restaurantId, sourceId, chainSlug? }
  ↓
assertNotSsrf(url)
  ↓
downloadPdf(url) — streaming, 20MB cap, 30s timeout
  ↓
magic bytes check (%PDF-)
  ↓
extractText(buffer) — pdf-parse library
  ↓
[optional] preprocessChainText(chainSlug, lines) — per-chain normalization
  ↓
parseNutritionTable(lines) — heuristic regex parser (ES/EN)
  ↓
normalizeNutrients + normalizeDish — shared pipeline from @foodxplorer/scraper
  ↓
Prisma $transaction — findFirst + create/update per dish
```

### Chain-Specific Preprocessors (ADR-007)
Each chain's official PDF has a unique layout. Generic parser assumes single-line headers. Preprocessors normalize BEFORE generic parsing:
- **BK**: strips weight + kJ columns, injects synthetic header
- **KFC**: keeps per-100g only (drops per-portion), cleans digits from names
- **Telepizza**: removes kJ from kJ/kcal pairs, injects header
- **Pans & Company**: pairs product names with per-100g rows positionally, strips kJ
- **Subway, Domino's**: passthrough

### Image/OCR Pipeline (Domino's)
Same as PDF but: downloadImage (10MB cap) → magic bytes (JPEG/PNG) → Tesseract.js OCR (spa+eng) → parseNutritionTable

### Web Scraper (McDonald's only)
Dual extraction: JSON-LD NutritionInformation + HTML table fallback. CAPTCHA detection. All other chains use PDF/image pipelines.

### Batch Runner
`npm run ingest:batch -w @foodxplorer/api` — iterates CHAIN_PDF_REGISTRY, calls POST /ingest/pdf-url per enabled chain. Sequential. Continue-on-failure.

### SSRF Guard
String-level validation only: blocks private/loopback/link-local, IPv4-mapped IPv6, numeric IPs, non-http/https. **Does NOT prevent DNS rebinding.**

---

## 7. Telegram Bot

### Architecture
Standalone package (`packages/bot`). Consumes the API via HTTP (not direct DB access). Long polling. Sends `X-FXP-Source: bot` header on all API calls.

### Commands
| Command | Description |
|---------|-------------|
| /start, /help | Welcome + command list |
| /buscar `<texto>` | Global dish search (GET /dishes/search) |
| /estimar `<plato>` [en `<cadena>`] | Nutritional estimation (GET /estimate) |
| /restaurantes | List restaurants (GET /restaurants) |
| /platos `<restaurantId>` | Dishes for a restaurant |
| /cadenas | List chains (GET /chains) |
| /info | Bot version + API health check |

### Natural Language Handler
Plain text (no /) is routed to the NL handler:
1. `extractFoodQuery(text)` — pure parser with 8 Spanish prefix patterns
2. Chain slug extraction: splits on last ` en ` if suffix matches `^[a-z0-9-]+-[a-z0-9-]+$`
3. Article/determiner stripping
4. Calls `apiClient.estimate({ query, chainSlug? })`
5. Formats response as MarkdownV2

### Typical User Interactions (what users will ask)

**Direct commands:**
```
/estimar big mac en mcdonalds-es
/estimar whopper en burger-king-es
/buscar hamburguesa
/restaurantes
/platos 550e8400-e29b-41d4-a716-446655440000
/cadenas
```

**Natural language (routed to NL handler):**
```
cuántas calorías tiene un big mac
big mac
calorías del whopper
qué lleva el mcpollo
información nutricional del menú big mac
big mac en mcdonalds-es
dame las calorías del pollo frito en kfc-es
```

**Expected responses:**
- Hit: dish name, chain, match type (exact/FTS/similarity/LLM), 15 nutrients, confidence level, source
- Miss: "No he encontrado información nutricional para [query]"
- Error: Spanish error messages mapped from API error codes

---

## 8. Query Logging & Analytics (F029)

### Fire-and-Forget Logging
Every call to GET /estimate is logged asynchronously AFTER the HTTP response is sent:
```typescript
reply.raw.once('finish', () => {
  void writeQueryLog(prisma, { queryText, chainSlug, restaurantId, levelHit, cacheHit, responseTimeMs, apiKeyId, source }, request.log)
    .catch(() => {});
});
```
- Never affects response timing or status
- Errors swallowed silently (warn-logged via pino)
- `source` derived from `X-FXP-Source` header (bot/api)

### Analytics Endpoint (admin-only)
GET /analytics/queries — 5 concurrent Kysely queries via Promise.all:
1. Scalar: totalQueries, cacheHitRate (ROUND 4 decimals, clamped [0,1]), avgResponseTimeMs (NaN-guarded)
2. byLevel: zero-filled l1/l2/l3/l4/miss
3. byChain: grouped by chain_slug (nulls excluded)
4. bySource: zero-filled api/bot
5. topQueries: top N by frequency

---

## 9. Security Model

### Authentication
- Public API key auth: SHA-256 hash stored in DB. Redis cache 60s. Fail-closed on DB error WITH key. Anonymous allowed (no key = lower rate limit)
- Admin auth: `ADMIN_API_KEY` env var, timingSafeEqual comparison. Fail-closed in prod/dev, fail-open in test
- Bot auth: Deterministic API key via HMAC-SHA256 seed

### Rate Limiting
- Anonymous: 30 req/15min/IP
- Free tier: 100 req/15min/key
- Pro tier: 1000 req/15min/key
- Admin + /health exempt
- Redis-backed, fail-open (skipOnError: true)

### Input Validation
- All inputs validated via Zod schemas (fastify-type-provider-zod)
- chainSlug: `/^[a-z0-9-]+$/`, max 100 chars
- restaurantId: UUID format
- query: 1-255 chars
- PDF upload: 10MB limit, magic bytes check
- Image: 10MB limit, JPEG/PNG magic bytes
- PDF URL download: 20MB streaming cap

### SSRF Protection
- `assertNotSsrf(url)` blocks private/loopback/link-local
- IPv4-mapped IPv6 detection
- Numeric IP bypass prevention
- **Known gap: no DNS rebinding protection (string-level only)**

### Secrets Management
- All secrets via env vars, never in code
- API keys stored as SHA-256 hashes (raw key never persisted)
- Bot key generated deterministically via HMAC-SHA256 (reproducible from seed)

---

## 10. Error Handling Patterns

### API Error Handler (Fastify global)
Pure `mapError(error)` function maps error codes to HTTP status codes. The error handler NEVER leaks internal details — 500 errors return generic "Internal server error".

### Error Throwing Pattern
```typescript
throw Object.assign(
  new Error('Human-readable message'),
  { code: 'ERROR_CODE', statusCode: 500, cause: originalError },
);
```
NOT plain objects. Always Error instances with code property.

### Fail Modes
| Component | Fail Mode | Consequence |
|-----------|-----------|-------------|
| Redis | Fail-open | App works without cache, higher DB load |
| DB (public route) | Fail-closed | 500 DB_UNAVAILABLE |
| DB (auth with key) | Fail-closed | 500 DB_UNAVAILABLE |
| OpenAI (L3 embedding) | Fail-graceful | L3 skipped, cascade continues to L4 |
| OpenAI (L4 chat) | Fail-graceful | L4 returns null, cascade returns total miss |
| Query logging | Fire-and-forget | Warn-logged, never affects response |
| Rate limiting | Fail-open | skipOnError, requests pass through |
| last_used_at update | Fire-and-forget | Debug-logged on failure |

---

## 11. Data Quality & Monitoring

### Quality Report (GET /quality/report)
6 dimensions checked:
1. **Nutrient Completeness** — % of dishes with all 15 nutrients populated
2. **Implausible Values** — calories > 5000, negative values, protein > calories, etc.
3. **Data Gaps** — chains/restaurants with zero dishes
4. **Duplicates** — dishes with identical name + restaurant (50-group cap at route level)
5. **Confidence Distribution** — breakdown by confidence level and estimation method
6. **Data Freshness** — data sources older than threshold (default 90 days)

### Seed Data
- 514 USDA SR Legacy foods with 14 nutrient columns, Spanish translations
- 7 chain restaurants with deterministic UUIDs from CHAIN_SEED_IDS
- Idempotent upserts, batch size 50

---

## 12. Known Issues & Technical Debt

1. **Pre-existing build errors**: `packages/api` ingest routes and `packages/scraper` have build errors related to `EstimationMethod` type including "llm" — NOT related to recent features
2. **SSRF guard**: String-level only, no DNS rebinding protection
3. **Five Guys Spain**: Disabled in registry — PDF has allergen-only data, no calorie/macro information
4. **VIPS and 100 Montaditos**: Postponed — allergen-only data, candidates for estimation engine
5. **Prisma shadow DB**: Cannot use `migrate dev` due to pgvector — must use `migrate deploy`
6. **pnpm not in PATH**: Must use `npx pnpm` in the development environment

---

## 13. Architectural Decisions (ADRs)

| ADR | Decision | Key Consequence |
|-----|----------|-----------------|
| ADR-000 | Node.js + Fastify + Prisma/Kysely + PostgreSQL | Two query layers require clear usage rules |
| ADR-001 | Engine calculates, LLM interprets only | LLM never sees/produces nutrient values |
| ADR-002 | pgvector as Unsupported, XOR CHECK, dual FTS | Raw SQL in migrations, no migrate dev |
| ADR-003 | Schema enhancements from 7-API research | 15 typed nutrients + FoodType + Recipe model |
| ADR-004 | Dishes/Restaurants: tables over enums, nullable food_id | Decoupled ingestion from composition |
| ADR-005 | Chain scrapers need per-product web data | Site inspection mandatory before scraper |
| ADR-006 | PDF-first ingestion pivot | Config-driven, not per-chain code |
| ADR-007 | Chain text preprocessor before generic parser | Generic parser unchanged, per-chain isolation |
| ADR-008 | Only onboard chains with official nutritional data | Quality over coverage |

---

## 14. Possible Future Features (Phase 2+)

- **Next.js web frontend** (SSR/SEO) for browser access
- **Multi-language support** (beyond ES/EN)
- **International expansion** (chains outside Spain — schema supports it via countryCode)
- **User accounts** with favorites, dietary preferences, allergen alerts
- **Recipe builder** — compose meals and calculate total nutrition
- **Barcode scanner** (mobile) — scan packaged food barcode → nutritional lookup
- **Allergen cross-referencing** — combine allergen charts with nutritional data
- **Crowdsourced data validation** — users confirm/dispute values
- **CI/CD pipeline** (GitHub Actions, staging on Railway/Render)
- **F030 — Monitoring & Alerting** — health checks, error rate alerts, chain data staleness monitoring
- **VIPS / 100 Montaditos** — estimate nutrition from allergen/ingredient lists via E003

---

## 15. Audit Instructions

You are auditing the complete foodXPlorer codebase. Please examine the following areas systematically and report ALL findings, no matter how minor:

### A. Security Audit
- [ ] SQL injection risks (especially in Kysely `sql` tagged templates and `$queryRaw`/$executeRaw`)
- [ ] SSRF vulnerabilities beyond the known DNS rebinding gap
- [ ] Authentication bypass scenarios (admin auth, API key auth, anonymous access)
- [ ] Rate limiting bypass scenarios
- [ ] Timing attacks on key comparison (is timingSafeEqual used consistently?)
- [ ] Information leakage in error responses
- [ ] Input validation gaps (query, chainSlug, restaurantId, file uploads)
- [ ] Prototype pollution risks
- [ ] ReDoS in regex patterns (prefix patterns, chainSlug validation, etc.)
- [ ] Header injection via X-FXP-Source or X-API-Key
- [ ] Cache poisoning scenarios (Redis keys, TTLs)

### B. Data Integrity Audit
- [ ] Nutritional value accuracy: can the pipeline produce incorrect values?
- [ ] Normalization consistency: does the same dish always produce the same nutrient values?
- [ ] Race conditions in upsert operations ($transaction, findFirst + create/update)
- [ ] Embedding consistency: can embeddings get out of sync with dish/food data?
- [ ] Cache staleness: can stale cached values cause incorrect results?
- [ ] Query log accuracy: can logged values differ from actual response?
- [ ] Decimal precision: Prisma Decimal(8,2) → JS number conversion accuracy

### C. Reliability & Error Handling
- [ ] Unhandled promise rejections (especially fire-and-forget patterns)
- [ ] Memory leaks (Tesseract workers, Playwright instances, Prisma connections)
- [ ] Connection pool exhaustion (Prisma, Kysely pg pool, Redis)
- [ ] Timeout handling: are all external calls (OpenAI, PDF download, OCR) properly time-bounded?
- [ ] Graceful degradation: what happens when Redis is down, OpenAI is down, DB is slow?
- [ ] Error propagation: do all error paths produce the correct HTTP status code?

### D. Performance Audit
- [ ] N+1 queries in any route
- [ ] Unbounded result sets (missing LIMIT)
- [ ] Missing database indexes for common query patterns
- [ ] Unnecessary sequential operations that could be parallelized
- [ ] Memory usage in batch operations (PDF parsing, embedding generation)
- [ ] Cache effectiveness: TTLs, key design, invalidation strategy

### E. API Design Audit
- [ ] REST conventions: are HTTP methods and status codes used correctly?
- [ ] Response envelope consistency across all endpoints
- [ ] Pagination correctness (off-by-one, cursor vs offset)
- [ ] Query parameter validation vs body parameter validation
- [ ] Content-Type handling (multipart, JSON, responses)
- [ ] CORS configuration security

### F. Type Safety & Schema Consistency
- [ ] Zod schema ↔ Prisma schema ↔ Kysely types alignment
- [ ] Any use of `any`, `as never`, `as unknown as` that could hide bugs
- [ ] Zod `.default()` values matching Prisma defaults
- [ ] Enum values synchronized across Prisma, Zod, and TypeScript

### G. Bot-Specific Audit
- [ ] MarkdownV2 escaping: can user input break Telegram formatting?
- [ ] Command injection via user messages
- [ ] Message length limits (Telegram 4096 char limit)
- [ ] Error message leakage to users
- [ ] Polling error recovery
- [ ] Natural language parser edge cases (false positives/negatives in prefix matching)

### H. Testing Gaps
- [ ] Are there untested code paths in critical flows?
- [ ] Are edge cases adequately covered (empty inputs, max-length inputs, unicode, etc.)?
- [ ] Do tests actually test the right thing (no vacuous assertions)?
- [ ] Are mocks realistic enough to catch real bugs?
- [ ] Integration test coverage for the full estimation cascade

### Severity Classification
For each finding, classify as:
- **CRITICAL** — Security vulnerability, data corruption risk, or production crash
- **HIGH** — Significant bug or reliability issue that will affect users
- **MEDIUM** — Design flaw, performance issue, or missing edge case
- **LOW** — Code quality, naming, minor inconsistency
- **INFO** — Observation, suggestion, or question

### Output Format
For each finding:
```
[SEVERITY] Area: Title
File: path/to/file.ts:lineNumber
Description: What is wrong and why it matters
Evidence: Code snippet or proof
Recommendation: How to fix it
```

---

## 16. Complete File Inventory (Production Source Files)

### packages/api/src/
```
app.ts                          — Fastify app factory (buildApp)
server.ts                       — Entry point (listen + shutdown)
config.ts                       — Env schema + config singleton

routes/
  health.ts                     — GET /health
  estimate.ts                   — GET /estimate (core endpoint)
  catalog.ts                    — GET /restaurants, /dishes/search, /chains
  analytics.ts                  — GET /analytics/queries
  quality.ts                    — GET /quality/report
  embeddings.ts                 — POST /embeddings/generate
  ingest/pdf.ts                 — POST /ingest/pdf
  ingest/url.ts                 — POST /ingest/url
  ingest/pdf-url.ts             — POST /ingest/pdf-url
  ingest/image-url.ts           — POST /ingest/image-url

estimation/
  engineRouter.ts               — L1→L2→L3→L4 cascade orchestrator
  level1Lookup.ts               — Exact + FTS dish/food lookup
  level2Lookup.ts               — Ingredient-based aggregation
  level3Lookup.ts               — pgvector similarity
  level4Lookup.ts               — LLM identification (pg_trgm + chat)
  types.ts                      — Shared types + mappers
  index.ts                      — Barrel exports

embeddings/
  pipeline.ts                   — Embedding generation orchestrator
  embeddingClient.ts            — OpenAI SDK wrapper with rate limiting
  embeddingWriter.ts            — pgvector write via $executeRawUnsafe
  textBuilder.ts                — Food/dish → text for embedding
  types.ts                      — Raw row types + mappers
  index.ts                      — Barrel exports

quality/
  assembleReport.ts             — Parallel orchestration of 6 checks
  checkNutrientCompleteness.ts
  checkImplausibleValues.ts
  checkDataGaps.ts
  checkDuplicates.ts
  checkConfidenceDistribution.ts
  checkDataFreshness.ts
  types.ts, index.ts

ingest/
  nutritionTableParser.ts       — Heuristic regex parser (ES/EN)
  chainTextPreprocessor.ts      — Per-chain PDF text normalization

plugins/
  auth.ts                       — Global onRequest hook (API key + admin)
  adminAuth.ts                  — Admin key validation (timingSafeEqual)
  adminPrefixes.ts              — URL prefix list for admin routes
  rateLimit.ts                  — @fastify/rate-limit config
  swagger.ts                    — OpenAPI/Swagger
  cors.ts                       — CORS config

lib/
  prisma.ts                     — Prisma singleton
  redis.ts                      — ioredis singleton (fail-open)
  kysely.ts                     — Kysely singleton
  cache.ts                      — Redis cache helper (buildKey, get/set/del)
  pdfParser.ts                  — pdf-parse wrapper
  pdfDownloader.ts              — Streaming PDF download (20MB cap)
  htmlFetcher.ts                — Playwright HTML fetch
  htmlTextExtractor.ts          — HTML → text (table-aware)
  imageDownloader.ts            — Image download (10MB cap)
  imageOcrExtractor.ts          — Tesseract.js wrapper
  ssrfGuard.ts                  — SSRF URL validation
  queryLogger.ts                — Fire-and-forget query log writer

errors/
  errorHandler.ts               — Global error handler + mapError()

config/chains/
  chain-pdf-registry.ts         — 6 chain PDF URL configs
  chain-image-registry.ts       — 1 chain image config (Domino's)
  chain-seed-ids.ts             — Deterministic UUIDs for 7 chains

scripts/
  batch-ingest.ts               — CLI batch PDF ingest
  batch-ingest-images.ts        — CLI batch image ingest
  embeddings-generate.ts        — CLI embedding generation
  quality-monitor.ts            — CLI quality report
  seedApiKey.ts                 — API key seed script
```

### packages/bot/src/
```
index.ts                        — Entry point (wire + start polling)
bot.ts                          — buildBot factory (command registration)
config.ts                       — Env schema
logger.ts                       — Pino logger
apiClient.ts                    — HTTP client for API (DI interface)

commands/
  start.ts, buscar.ts, estimar.ts, restaurantes.ts
  platos.ts, cadenas.ts, info.ts
  errorMessages.ts              — ApiError → Spanish message mapper

formatters/
  markdownUtils.ts              — escapeMarkdown (19 reserved chars)
  dishFormatter.ts, restaurantFormatter.ts
  chainFormatter.ts, estimateFormatter.ts

handlers/
  naturalLanguage.ts            — Plain text → estimate pipeline
```

### packages/scraper/src/
```
runner.ts                       — CLI entry point
config.ts                       — Env schema
registry.ts                     — Chain scraper registry
index.ts                        — Barrel exports
base/BaseScraper.ts             — Abstract base class
base/types.ts                   — RawDishData, NormalizedDishData schemas
base/errors.ts                  — ScraperError hierarchy
utils/normalize.ts              — normalizeNutrients, normalizeDish
utils/persist.ts                — persistDishUtil (Prisma $transaction)
utils/rateLimit.ts              — Token-bucket rate limiter
utils/retry.ts                  — withRetry<T> utility
lib/prisma.ts                   — PrismaClient singleton
chains/mcdonalds-es/            — McDonald's Spain scraper
```

### packages/shared/src/
```
index.ts                        — Barrel exports for all schemas
schemas/
  enums.ts                      — 7 enum schemas
  dataSource.ts, food.ts, foodNutrient.ts, standardPortion.ts
  recipe.ts, recipeIngredient.ts
  cookingMethod.ts, dishCategory.ts, restaurant.ts
  dish.ts, dishNutrient.ts, dishIngredient.ts
  estimate.ts                   — 7 estimation schemas
  catalog.ts                    — 11 catalog schemas
  qualityReport.ts              — 15 quality schemas
  embeddingGenerate.ts          — 6 embedding schemas
  apiKey.ts                     — 4 API key schemas
  analytics.ts                  — 8 analytics schemas
```

---

## 17. Test Coverage Summary

| Package | Tests | Files |
|---------|-------|-------|
| API | 1950 | ~40+ |
| Shared | 223 | ~10 |
| Bot | 313 | 8 |
| Scraper | 232 | ~15 |
| **Total** | **2718** | |

All tests use Vitest. Mocking pattern: `vi.hoisted()` + `vi.mock()`. API tests use `buildApp()` + Fastify `.inject()` (no port binding).

---

**END OF AUDIT PROMPT. Begin your audit now. Report ALL findings.**
