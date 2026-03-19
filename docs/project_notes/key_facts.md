# Key Project Facts

Quick reference for project configuration, infrastructure details, and important URLs.

## Security Warning

**DO NOT store in this file:** Passwords, API keys, secret tokens, private keys.
**SAFE to store:** Hostnames, ports, project IDs, public URLs, architecture notes.

---

## Project Configuration

- **Project Name**: foodXPlorer (nombre definitivo pendiente, no bloquea Fase 1)
- **Description**: Plataforma open source de referencia para conocer la información nutricional de cualquier plato, en cualquier restaurante, en cualquier contexto
- **Repository**: GitHub (público, licencia pendiente)
- **Primary Language**: TypeScript (strict mode)
- **Branching Strategy**: gitflow <!-- main (producción) + develop (integración) + feature/* -->
- **Monorepo Layout**: npm workspaces — `packages/api`, `packages/bot`, `packages/shared`, `packages/scraper`

## Technology Stack

- **Runtime**: Node.js + TypeScript
- **API Framework**: Fastify (OpenAPI autogenerado, Zod validation)
- **ORM / Migrations**: Prisma (migraciones + CRUD simple)
- **Query Builder**: Kysely (queries complejas, pgvector, 3+ joins)
- **Database**: PostgreSQL 16 + pgvector + pg_trgm + JSONB
- **Cache / Rate Limiting**: Redis
- **Bot**: node-telegram-bot-api
- **Web (Fase 2)**: Next.js (SSR/SEO)
- **Validation**: Zod (schemas compartidos en packages/shared)

## Naming Conventions (Specs & Tickets)

| Prefix | Type | Example |
|--------|------|---------|
| `EXXX` | Epic | `E001-infrastructure-setup` |
| `FXXX` | Feature | `F001-prisma-schema-core-tables` |
| `SXXX` | Schema / Migration | `S001-foods-table` |
| `TXXX` | Ticket (auto) | `T001-prisma-schema-core-tables` |
| `ADR-XXX` | Decision Record | `ADR-000-initial-stack` |
| `BUG-XXX` | Bug (auto) | `BUG-001-description` |

## Prisma vs Kysely Rule

- **Prisma**: All schema migrations, CRUD simple, relations with include, Prisma Studio
- **Kysely**: Nutritional calculations (aggregated sums), pgvector searches, 3+ joins, full-text search, any query needing precise SQL

## Local Development

- **API Port**: 3001 (avoids conflict with other local services)
- **PostgreSQL Port**: 5433 (mapped from container 5432, avoids conflict with local PG)
- **Redis Port**: 6380 (mapped from container 6379, avoids conflict with local Redis)
- **Database Name**: foodxplorer_dev
- **Database Test**: foodxplorer_test
- **API Base URL**: http://localhost:3001

## Infrastructure

- **CI/CD**: GitHub Actions
- **Hosting (early stage)**: Railway or Render (staging: develop, prod: main)
- **Error Tracking**: Sentry (free plan)
- **Uptime**: UptimeRobot or Better Uptime (free plan)

## Important URLs

- **Production**: TBD
- **Staging**: TBD
- **API Docs**: http://localhost:3001/docs (OpenAPI/Swagger)

## Reusable Components

### Backend (packages/api)
- **Prisma client**: auto-generated at `node_modules/@prisma/client` (root node_modules). Instantiate with `new PrismaClient()`. For dev/prod, use `DATABASE_URL`. For tests, override with `datasources: { db: { url: DATABASE_URL_TEST } }`.
- **Prisma schema**: `packages/api/prisma/schema.prisma` — 7 enums, 14 models (DataSource, Food, FoodNutrient, StandardPortion, Recipe, RecipeIngredient, CookingMethod, DishCategory, Restaurant, Dish, DishNutrient, DishIngredient, DishCookingMethod, DishDishCategory)
- **Migrations**: `packages/api/prisma/migrations/` — apply with `prisma migrate deploy` (not `migrate dev` due to pgvector shadow DB issue). 5 migrations: init_core_tables + schema_enhancements_f001b + dishes_restaurants_f002 + pgvector_indexes_f003 + embedding_updated_at_f019
- **Seed script**: `packages/api/prisma/seed.ts` — run with `npm run db:seed -w @foodxplorer/api`. Phase 1: 5 demo foods, cooking methods, categories, restaurants, dishes. Phase 2: `seedPhase2(prisma)` — 514 real USDA SR Legacy foods with 14 nutrient cols per 100g, Spanish translations, 14 group-level standard portions, zero-vector embeddings. DataSource UUID `00000000-0000-0000-0000-000000000002`. Upserts on `externalId_sourceId` (idempotent). Batch size 50 with retry.
- **Seed data**: `packages/api/prisma/seed-data/` — `usda-sr-legacy-foods.json` (514 curated foods from USDA FDC SR Legacy), `name-es-map.json` (fdcId → Spanish name), `types.ts`, `validateSeedData.ts` (pre-write validation: duplicates, missing translations, negative nutrients, calorie warnings)
- **Fastify server**: `packages/api/src/app.ts` — `buildApp(opts?)` factory (async). `server.ts` is the entry point (listen + shutdown). Tests use `buildApp()` + `.inject()` without port binding
- **Config**: `packages/api/src/config.ts` — `EnvSchema` (Zod), `parseConfig(env)`, `config` singleton. Required: `DATABASE_URL`. Defaults: `PORT=3001`, `NODE_ENV=development`, `LOG_LEVEL=info`, `REDIS_URL=redis://localhost:6380`. Optional: `OPENAI_API_KEY` (L3 embeddings + L4 chat), `OPENAI_CHAT_MODEL` (no default — L4 opt-in), `OPENAI_CHAT_MAX_TOKENS` (default 512)
- **Prisma singleton**: `packages/api/src/lib/prisma.ts` — auto-selects `DATABASE_URL_TEST` in test env. Do NOT import `config.ts` from here (circular dep)
- **Redis singleton**: `packages/api/src/lib/redis.ts` — ioredis with `lazyConnect: true`, `maxRetriesPerRequest: 0`. Reads `process.env['REDIS_URL']` directly (no config.ts import). `connectRedis()`/`disconnectRedis()` called from server.ts. Fail-open: app runs without Redis
- **Cache helper**: `packages/api/src/lib/cache.ts` — `buildKey(entity, id)` → `fxp:<entity>:<id>`, `cacheGet/cacheSet/cacheDel/cacheInvalidatePattern`. All fail-open (catch + warn log). Default TTL: 300s. SCAN-based invalidation
- **Error handler**: `packages/api/src/errors/errorHandler.ts` — `mapError(error)` pure function + `registerErrorHandler(app)`. Error envelope: `{ success: false, error: { message, code, details? } }`. Codes: `VALIDATION_ERROR`, `NOT_FOUND`, `DB_UNAVAILABLE`, `REDIS_UNAVAILABLE`, `RATE_LIMIT_EXCEEDED`, `INVALID_PDF` (422), `UNSUPPORTED_PDF` (422), `INVALID_IMAGE` (422), `OCR_FAILED` (422), `NO_NUTRITIONAL_DATA_FOUND` (422), `PROCESSING_TIMEOUT` (408), `INVALID_URL` (422), `FETCH_FAILED` (422), `SCRAPER_BLOCKED` (422), `PAYLOAD_TOO_LARGE` (413), `EMBEDDING_PROVIDER_UNAVAILABLE` (422), `INTERNAL_ERROR`
- **Health route**: `packages/api/src/routes/health.ts` — `GET /health` with optional `?db=true` and `?redis=true`. Prisma + Redis injectable via plugin options
- **PDF ingestion route**: `packages/api/src/routes/ingest/pdf.ts` — `POST /ingest/pdf` multipart upload. Dependencies: `pdf-parse` (text extraction), `@fastify/multipart` (file upload, 10MB limit). Pipeline: multipart parse → magic bytes check (`%PDF-`) → DB existence checks (restaurant + dataSource) → `extractText` (pdf-parse wrapper, `packages/api/src/lib/pdfParser.ts`) → `parseNutritionTable` (heuristic regex parser, `packages/api/src/ingest/nutritionTableParser.ts`, Spanish + English keywords) → `normalizeNutrients` + `normalizeDish` (from `@foodxplorer/scraper`) → Prisma `findFirst + create/update` in `$transaction` → response. 30s timeout via `Promise.race` + `clearTimeout`. Supports `dryRun=true` (no DB writes). Partial success: 200 with `dishesSkipped` + `skippedReasons`. `sourceUrl` format: `pdf://[sanitized_filename]`
- **URL ingestion route**: `packages/api/src/routes/ingest/url.ts` — `POST /ingest/url` JSON body. Dependencies: `crawlee` + `playwright` (HTML fetch), `node-html-parser` (DOM-to-text). Pipeline: JSON validate → `assertNotSsrf(url)` (shared SSRF guard from `packages/api/src/lib/ssrfGuard.ts`) → DB existence checks → `fetchHtml` (PlaywrightCrawler single-URL, `packages/api/src/lib/htmlFetcher.ts`, crawlerFactory DI) → `extractTextFromHtml` (table-aware, `packages/api/src/lib/htmlTextExtractor.ts`, `<tr>` → tab-separated) → `parseNutritionTable` (reused from F007b) → normalize → Prisma `$transaction` → response. 30s timeout. `sourceUrl` = submitted URL. `CRAWLEE_STORAGE_DIR` set to `os.tmpdir()` if unset.
- **SSRF guard**: `packages/api/src/lib/ssrfGuard.ts` — `assertNotSsrf(url): void`. Blocks private/loopback/link-local hostnames (RFC1918, 169.254.x, ::1, fe80::), IPv4-mapped IPv6 (::ffff:), numeric IP bypass (decimal/hex), non-http/https schemes. Shared by `url.ts` and `pdf-url.ts`. NOTE: does not prevent DNS rebinding (string-level validation only).
- **PDF URL ingestion route**: `packages/api/src/routes/ingest/pdf-url.ts` — `POST /ingest/pdf-url` JSON body `{ url, restaurantId, sourceId, dryRun? }`. Downloads PDF from URL via `downloadPdf` (Node.js built-in `fetch`, 30s timeout, 20MB streaming size cap), then reuses F007b pipeline: `assertNotSsrf` → DB checks → `downloadPdf` → magic bytes → `extractText` → `parseNutritionTable` → normalize → `$transaction` upsert. `sourceUrl` = submitted URL (real HTTP URL, no synthetic `pdf://`). Response includes `sourceUrl` echoed back. 30s pipeline timeout via `Promise.race`.
- **PDF downloader**: `packages/api/src/lib/pdfDownloader.ts` — `downloadPdf(url, fetchImpl?): Promise<Buffer>`. Streaming download with 20MB size cap (byte-by-byte accumulation, aborts on overflow). Content-Type validation (application/pdf or application/octet-stream). 30s `AbortSignal.timeout`. DI via optional `fetchImpl` parameter for testing. Error codes: `FETCH_FAILED`, `INVALID_PDF`, `PAYLOAD_TOO_LARGE`.
- **Chain PDF registry**: `packages/api/src/config/chains/chain-pdf-registry.ts` — `ChainPdfConfigSchema` (Zod), `ChainPdfConfig` type, `CHAIN_PDF_REGISTRY` array. 6 entries: burger-king-es, kfc-es, telepizza-es, five-guys-es, subway-es, pans-and-company-es. Each entry holds `chainSlug`, `pdfUrl`, `restaurantId`, `sourceId`, `updateFrequency`, `enabled`. Schema enforces `https://` only, 2048 char max. Config is static TypeScript, not a DB table.
- **Chain seed IDs**: `packages/api/src/config/chains/chain-seed-ids.ts` — `CHAIN_SEED_IDS` constant with deterministic UUID pairs for 7 chains (BK, KFC, Telepizza, Five Guys, Domino's, Subway, Pans & Company). Restaurant IDs use segment `0006` (starting at `...0010`), source IDs use segment `0000` (starting at `...0010`). Shared between `seed.ts`, `chain-pdf-registry.ts`, and `chain-image-registry.ts`.
- **Chain text preprocessor**: `packages/api/src/ingest/chainTextPreprocessor.ts` — `preprocessChainText(chainSlug, lines): string[]`. Dispatches to per-chain normalizer based on slug. BK: strips weight + kJ columns, injects synthetic header. KFC: keeps per-100g values only (drops per-portion), removes standalone digits from names, handles `<0,1` notation. Telepizza: removes kJ from kJ/kcal pairs, injects synthetic header. Pans & Company: custom preprocessor for column-separated PDF layout — pairs product names with Per-100g data rows positionally, strips kJ column, injects synthetic header. Domino's: passthrough (OCR output, preprocessing TBD after live inspection). Subway: passthrough (English PDF, standard EU table format). Unknown chains: passthrough (returns lines unchanged). See ADR-007.
- **PDF URL ingestion route (chainSlug)**: `POST /ingest/pdf-url` accepts optional `chainSlug` field (`z.string().min(1).max(100).regex(/^[a-z0-9-]+$/).optional()`). When provided, runs `preprocessChainText(chainSlug, lines)` between `extractText` and `parseNutritionTable`. Backward-compatible — omitting chainSlug uses generic parser only.
- **Chain PDF registry — Five Guys disabled**: `five-guys-es` entry has `enabled: false`. PDF contains allergen/ingredient list only — no calorie or macro data. Re-enable when a nutritional PDF is found.
- **Batch ingest runner**: `packages/api/src/scripts/batch-ingest.ts` — `runBatch(registry, options, fetchImpl?)` exported function + CLI wrapper. Calls `POST /ingest/pdf-url` via HTTP for each enabled chain. Sends `chainSlug` in request body. Flags: `--chain <slug>`, `--dry-run`, `--api-url <url>`, `--concurrency <n>`. Continue-on-failure, exit code 1 on any failure. DI for fetch (testing). npm script: `npm run ingest:batch -w @foodxplorer/api`. Phase 1: sequential only.
- **Seed Phase 3**: `packages/api/prisma/seed.ts` — `seedPhase3(client)` creates 4 restaurant + 4 dataSource rows for PDF chains (BK, KFC, Telepizza, Five Guys). Idempotent upserts with deterministic IDs from `CHAIN_SEED_IDS`.
- **Image URL ingestion route**: `packages/api/src/routes/ingest/image-url.ts` — `POST /ingest/image-url` JSON body `{ url, restaurantId, sourceId, dryRun?, chainSlug? }`. Downloads image → validates magic bytes (JPEG/PNG) → OCR via Tesseract.js → optional `preprocessChainText` → `parseNutritionTable` → normalize → `$transaction` upsert. 60s pipeline timeout. Error codes: `INVALID_IMAGE`, `OCR_FAILED`.
- **Image downloader**: `packages/api/src/lib/imageDownloader.ts` — `downloadImage(url, fetchImpl?): Promise<{ buffer, contentType }>`. Streaming download with 10MB cap. Content-Type: image/jpeg, image/png, application/octet-stream only. 30s fetch timeout. DI for testing.
- **Image OCR extractor**: `packages/api/src/lib/imageOcrExtractor.ts` — `extractTextFromImage(buffer): Promise<string[]>`. Tesseract.js v5, `createWorker(['spa', 'eng'])`, per-request worker lifecycle (create → recognize → terminate in finally). Swallows terminate errors.
- **Chain image registry**: `packages/api/src/config/chains/chain-image-registry.ts` — `ChainImageConfigSchema` (Zod), `CHAIN_IMAGE_REGISTRY` array. 1 entry: dominos-es. Uses `imageUrls: string[]` (array for multi-image chains). Config is static TypeScript.
- **Batch ingest images runner**: `packages/api/src/scripts/batch-ingest-images.ts` — `runImageBatch(registry, options, fetchImpl?)`. Calls `POST /ingest/image-url` per image URL. One result per URL (not per chain). Continue-on-failure. npm script: `npm run ingest:batch-images -w @foodxplorer/api`.
- **Seed Phase 4**: `packages/api/prisma/seed.ts` — `seedPhase4(client)` creates 1 restaurant + 1 dataSource row for Domino's Spain. Idempotent upserts with deterministic IDs from `CHAIN_SEED_IDS.DOMINOS_ES`.
- **Seed Phase 5**: `packages/api/prisma/seed.ts` — `seedPhase5(client)` creates 1 restaurant + 1 dataSource row for Subway Spain. Idempotent upserts with deterministic IDs from `CHAIN_SEED_IDS.SUBWAY_ES`.
- **Seed Phase 6**: `packages/api/prisma/seed.ts` — `seedPhase6(client)` creates 1 restaurant + 1 dataSource row for Pans & Company Spain. Idempotent upserts with deterministic IDs from `CHAIN_SEED_IDS.PANS_AND_COMPANY_ES`.
- **Quality monitor route**: `packages/api/src/routes/quality.ts` — `GET /quality/report` Fastify plugin. Query params: `?chainSlug` (scope), `?stalenessThresholdDays` (default 90). Returns `QualityReportResponse`. 50-group duplicate cap applied at route level. Error codes: `VALIDATION_ERROR` (400), `DB_UNAVAILABLE` (500)
- **Quality check module**: `packages/api/src/quality/` — 6 check functions (`checkNutrientCompleteness`, `checkImplausibleValues`, `checkDataGaps`, `checkDuplicates`, `checkConfidenceDistribution`, `checkDataFreshness`) + `assembleReport.ts` (parallel orchestration via `Promise.all`) + `types.ts` (re-exports from shared) + `index.ts` (barrel). All checks are read-only, receive `PrismaClient` + optional `{ chainSlug }` scope. `checkDataFreshness` takes additional `stalenessThresholdDays` param. Performance: count() + $queryRaw instead of findMany (avoids memory issues). `assembleReport` computes `chainSummary[]` from byChain results (no extra DB queries)
- **Quality CLI script**: `packages/api/src/scripts/quality-monitor.ts` — `runQualityMonitor(opts, prismaOverride?, writeOutput?)` DI-friendly. Flags: `--chain-slug`/`--chainSlug`, `--staleness-days`, `--format json|markdown`, `--output <path>`. npm script: `npm run quality:report -w @foodxplorer/api`. Exit 0 on success, 1 on DB error. No 50-group cap (full output)
- **Embedding generation route**: `packages/api/src/routes/embeddings.ts` — `POST /embeddings/generate` Fastify plugin. Body: `EmbeddingGenerateRequestSchema` (target, chainSlug, batchSize, force, dryRun). 300s timeout. Validates `OPENAI_API_KEY` at invocation time (not startup). Error codes: `EMBEDDING_PROVIDER_UNAVAILABLE` (422). Response: `EmbeddingGenerateResponseSchema`
- **Embedding pipeline module**: `packages/api/src/embeddings/` — `types.ts` (FoodRowRaw/DishRowRaw + mappers), `textBuilder.ts` (buildFoodText/buildDishText, 8 nutrients), `embeddingClient.ts` (OpenAI SDK wrapper, RateLimiter token-bucket, 3-retry exponential backoff), `embeddingWriter.ts` ($executeRawUnsafe for pgvector with UUID validation), `pipeline.ts` (runEmbeddingPipeline orchestrator, CTE de-duplication, STRING_AGG for M:N, continue-on-failure), `index.ts` (barrel). OpenAI text-embedding-3-small, 1536 dims
- **Embedding CLI script**: `packages/api/src/scripts/embeddings-generate.ts` — `runEmbeddingsCLI(opts, prismaOverride?)` DI-friendly. Flags: `--target`, `--batch-size`, `--force`, `--dry-run`, `--chain-slug`. npm script: `npm run embeddings:generate -w @foodxplorer/api`. Exit 0 on success, 1 on fatal error
- **Embedding schemas**: `packages/shared/src/schemas/embeddingGenerate.ts` — 6 Zod schemas: `EmbeddingTargetSchema`, `EmbeddingGenerateRequestSchema`, `EmbeddingItemErrorSchema`, `EmbeddingItemTypeSchema`, `EmbeddingGenerateDataSchema`, `EmbeddingGenerateResponseSchema`
- **Migration F019**: `packages/api/prisma/migrations/20260317150000_embedding_updated_at_f019/` — adds `embedding_updated_at TIMESTAMPTZ` (nullable) to foods + dishes. 5 migrations total
- **Kysely singleton**: `packages/api/src/lib/kysely.ts` — `getKysely()` lazy init, `destroyKysely()` cleanup. PostgresDialect + `pg` Pool. Auto-selects `DATABASE_URL_TEST` in test env. DB types generated by `prisma-kysely` at `packages/api/src/generated/kysely-types.ts`. Used by E003 modules (estimation); E001-E002 remain on Prisma $queryRaw
- **Estimation module**: `packages/api/src/estimation/` — `level1Lookup.ts` (4-strategy cascade: exact dish → FTS dish → exact food → FTS food, Kysely `sql` tagged templates, CTE de-duplication with `ROW_NUMBER() OVER PARTITION BY`), `level2Lookup.ts` (2-strategy cascade: ingredient_dish_exact → ingredient_dish_fts, CTE aggregation SUM(fn.nutrient * di.gram_weight / 100), per_100g filter before ROW_NUMBER, confidence scoring medium/low), `level3Lookup.ts` (2-strategy cascade: similarity_dish scoped → similarity_food global, pgvector `<->` cosine distance, OpenAI embedding at request time via `callOpenAIEmbeddings`, threshold 0.5 hardcoded, fail-graceful on OpenAI errors, `Number.isFinite` guard on embedding values, confidenceLevel always 'low', estimationMethod always 'extrapolation'), `level4Lookup.ts` (F024: LLM-powered identification — Strategy A: pg_trgm trigram similarity top-10 candidates + LLM selection via OpenAI chat, Strategy B: LLM ingredient decomposition + L1-style resolution + L2-style aggregation. Fail-graceful: `callChatCompletion` returns null on OpenAI errors, DB errors → DB_UNAVAILABLE. 2-attempt retry on 429/5xx. ADR-001: LLM never receives nutrient values. Config: `OPENAI_CHAT_MODEL` no default opt-in, `OPENAI_CHAT_MAX_TOKENS` default 512. LLM source UUID `00000000-0000-0000-0000-000000000017`), `engineRouter.ts` (F023: `runEstimationCascade()` orchestrates L1→L2→L3→L4 cascade, returns `EngineRouterResult { data: EstimateData, levelHit: 1|2|3|4|null }`, `Level4LookupFn` type for F024 injection, receives raw query + normalizes internally, `openAiApiKey` via DI not config import, optional `logger` for L4 token usage), `types.ts` (Level1/Level2/Level3 LookupOptions, Level1/Level2/Level3 Result, DishQueryRow, FoodQueryRow, IngredientNutrientRow, DishSimilarityRow, FoodSimilarityRow, mapDishRowToResult, mapFoodRowToResult, mapLevel2RowToResult, parseDecimal (exported), mapNutrients — all 15 nutrients, all mappers include `similarityDistance: null`), `index.ts` (barrel exports all four lookups + engineRouter + types)
- **Estimate route**: `packages/api/src/routes/estimate.ts` — `GET /estimate` Fastify plugin (operationId: `estimateAllLevels`). Query params: `EstimateQuerySchema` (query required 1-255, chainSlug optional regex, restaurantId optional UUID). Delegates to `runEstimationCascade()` with `level4Lookup` injected (F024). Redis cache (fail-open, 300s TTL, unified key: `fxp:estimate:<normalized>:<chainSlug>:<restaurantId>`). Miss = HTTP 200 with all hit flags false (never 404). Receives Kysely instance (not PrismaClient). Route handler ~25 lines: parse → cache check → router call → cache write → reply. `levelHit` from router NOT exposed in HTTP response. Passes `logger: request.log` for L4 token usage logging
- **Estimate schemas**: `packages/shared/src/schemas/estimate.ts` — 7 Zod schemas: `EstimateQuerySchema`, `EstimateMatchTypeSchema` (enum: exact_dish/fts_dish/exact_food/fts_food/ingredient_dish_exact/ingredient_dish_fts/similarity_dish/similarity_food/llm_food_match/llm_ingredient_decomposition), `EstimateSourceSchema`, `EstimateNutrientsSchema` (15 nutrients + referenceBasis), `EstimateResultSchema` (includes `similarityDistance: z.number().min(0).max(2).nullable()`), `EstimateDataSchema` (includes level1Hit + level2Hit + level3Hit + level4Hit), `EstimateResponseSchema`
- **Rate limiting**: `packages/api/src/plugins/rateLimit.ts` — `@fastify/rate-limit` with Redis store, 100 req/15min/IP. `skipOnError: true` (fail-open). `/health` exempt via allowList. Disabled in test env. 429 → `RATE_LIMIT_EXCEEDED` envelope
- **Swagger**: `packages/api/src/plugins/swagger.ts` — disabled in `NODE_ENV=test`. UI at `/docs`, JSON at `/docs/json`
- **CORS**: `packages/api/src/plugins/cors.ts` — disabled in test, localhost origins in dev, `CORS_ORIGINS` env var in prod

### Shared (packages/shared)
- _Zod schemas = single source of truth for types_
- **Enum schemas** (`packages/shared/src/schemas/enums.ts`): `DataSourceTypeSchema`, `ConfidenceLevelSchema`, `EstimationMethodSchema`, `PortionContextSchema`, `FoodTypeSchema`, `NutrientReferenceBasisSchema`, `DishAvailabilitySchema`
- **Entity schemas** (each in its own file under `packages/shared/src/schemas/`):
  - `DataSourceSchema`, `CreateDataSourceSchema` — data_sources table shape
  - `FoodSchema`, `CreateFoodSchema` — foods table shape (includes foodType, brandName, barcode; no embedding field)
  - `FoodNutrientSchema`, `CreateFoodNutrientSchema` — food_nutrients table shape (14 nutrient columns + referenceBasis; Create schema has `.default(0)` on extended nutrients)
  - `StandardPortionSchema`, `CreateStandardPortionSchema` — standard_portions table shape (XOR `.refine()`, description required, isDefault defaults false)
  - `RecipeSchema`, `CreateRecipeSchema` — recipes table shape (links composite Food to prep metadata)
  - `RecipeIngredientSchema`, `CreateRecipeIngredientSchema` — recipe_ingredients table shape (ingredient composition)
  - `CookingMethodSchema`, `CreateCookingMethodSchema` — cooking_methods table shape (lookup with name, nameEs, slug)
  - `DishCategorySchema`, `CreateDishCategorySchema` — dish_categories table shape (lookup with sortOrder)
  - `RestaurantSchema`, `CreateRestaurantSchema` — restaurants table shape (chainSlug + countryCode unique, defaults ES)
  - `DishSchema`, `CreateDishSchema` — dishes table shape (nullable foodId, availability enum, embedding excluded; no embedding field)
  - `DishNutrientSchema`, `CreateDishNutrientSchema` — dish_nutrients table shape (same 14 nutrient columns as FoodNutrient; referenceBasis defaults per_serving, calories max 9000)
  - `DishIngredientSchema`, `CreateDishIngredientSchema` — dish_ingredients table shape (mirrors RecipeIngredient with dishId)
- **Quality report schemas** (`packages/shared/src/schemas/qualityReport.ts`): 15 Zod schemas — `QualityReportQuerySchema` (query params with `z.coerce`), `QualityChainSummarySchema`, `QualityNutrientCompletenessSchema`/`ChainSchema`, `QualityImplausibleValuesSchema`/`ChainSchema`, `QualityDataGapsSchema`, `QualityDuplicateGroupSchema`, `QualityDuplicatesSchema`, `QualityConfidenceByEstimationMethodSchema`, `QualityConfidenceChainSchema`, `QualityConfidenceDistributionSchema`, `QualityStaleSourceSchema`, `QualityDataFreshnessSchema`, `QualityReportDataSchema`, `QualityReportResponseSchema`. Single source of truth for API + CLI. `chainSlug` validated with `.regex(/^[a-z0-9-]+$/).max(100)`
- All schemas exported from `packages/shared/src/index.ts`

### Scraper (packages/scraper)
- **Package name**: `@foodxplorer/scraper`
- **Entry point**: `src/runner.ts` (CLI via `tsx src/runner.ts`)
- **Config**: `src/config.ts` — `ScraperEnvSchema` (Zod), `parseConfig(env)`, `config` singleton. Required: `DATABASE_URL`. Env vars: `NODE_ENV`, `DATABASE_URL`, `DATABASE_URL_TEST`, `LOG_LEVEL`, `SCRAPER_HEADLESS` (bool, default true), `SCRAPER_CHAIN` (optional string)
- **Base class**: `src/base/BaseScraper.ts` — abstract. Chain scrapers implement `extractDishes(page)` and `getMenuUrls(page)`. Public `run()` returns `ScraperResult`. Protected `normalize()` and `persist()` stub. Protected `createCrawler()` factory for testability.
- **Types**: `src/base/types.ts` — `RawDishDataSchema`, `NormalizedDishDataSchema`, `ScraperConfigSchema`, `ScraperResultSchema` (all with `z.infer` type exports). NOT in packages/shared.
- **Errors**: `src/base/errors.ts` — `ScraperError` → `ScraperNetworkError`, `ScraperBlockedError`, `ScraperStructureError`, `NormalizationError`, `NotImplementedError`. Each has `readonly code: string` (SCREAMING_SNAKE_CASE).
- **Utilities**: `src/utils/retry.ts` (`withRetry<T>(fn, policy, context)`), `src/utils/rateLimit.ts` (`RateLimiter` class, token-bucket + 3000-5000ms jitter), `src/utils/normalize.ts` (`normalizeNutrients`, `normalizeDish`)
- **Registry**: `src/registry.ts` — `ScraperRegistry = Record<string, { config: ScraperConfig; ScraperClass: ConcreteScraperConstructor }>`. Currently: `mcdonalds-es`. F009–F017 add entries.
- **Zod version note**: Uses `.nonnegative()` not `.nonneg()` — the installed version of zod (^3.24.2) does not have `.nonneg()` shorthand.
- **Persistence**: `src/utils/persist.ts` — `persistDishUtil(prisma, dish)` shared upsert utility. Uses `findFirst` + create/update (Dish lacks `@@unique([restaurantId, name])`) + `dishNutrient.upsert` on `dishId_sourceId`. All in `$transaction`. Reused by all chain scrapers.
- **PrismaClient singleton**: `src/lib/prisma.ts` — `getPrismaClient()` lazy init, `disconnectPrisma()` for clean shutdown. Selects `DATABASE_URL_TEST` in test env.
- **Crawler dependency injection pattern**: `createCrawler(requestHandler, failedRequestHandler)` is protected. Tests override it to return a duck-typed mock (no real Playwright launched).
- **McDonald's scraper**: `src/chains/mcdonalds-es/McDonaldsEsScraper.ts` — dual extraction (JSON-LD `NutritionInformation` primary, HTML table fallback). CAPTCHA/robot detection throws `ScraperBlockedError`. Price parser handles Spanish format (thousand-separator dot, comma decimal). Env vars: `MCDONALDS_ES_RESTAURANT_ID`, `MCDONALDS_ES_SOURCE_ID` (UUIDs, must exist in DB). Config is lazy-loaded via `getMcdonaldsEsConfig()` (avoids top-level parse crash when env vars not set, e.g. API tests importing `@foodxplorer/scraper` transitively).
- **Chain scraper pattern (F008+)**: Each chain gets `src/chains/<chain-slug>/` with: `config.ts` (lazy `ScraperConfig` via function), main scraper class (extends `BaseScraper`), extraction helpers. Tests use HTML fixtures in `src/__tests__/fixtures/<chain-slug>/`. `persistDish()` override delegates to `persistDishUtil`.
- **Runner**: `src/runner.ts` — `SCRAPER_CHAIN=<slug>` to run a chain. Instantiates from registry. Calls `disconnectPrisma()` before exit.

### Bot (packages/bot)
- _To be populated_
