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
- **Database**: PostgreSQL 16 + pgvector + JSONB
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
- **Migrations**: `packages/api/prisma/migrations/` — apply with `prisma migrate deploy` (not `migrate dev` due to pgvector shadow DB issue). 4 migrations: init_core_tables + schema_enhancements_f001b + dishes_restaurants_f002 + pgvector_indexes_f003
- **Seed script**: `packages/api/prisma/seed.ts` — run with `npm run db:seed -w @foodxplorer/api`. Phase 1: 5 demo foods, cooking methods, categories, restaurants, dishes. Phase 2: `seedPhase2(prisma)` — 514 real USDA SR Legacy foods with 14 nutrient cols per 100g, Spanish translations, 14 group-level standard portions, zero-vector embeddings. DataSource UUID `00000000-0000-0000-0000-000000000002`. Upserts on `externalId_sourceId` (idempotent). Batch size 50 with retry.
- **Seed data**: `packages/api/prisma/seed-data/` — `usda-sr-legacy-foods.json` (514 curated foods from USDA FDC SR Legacy), `name-es-map.json` (fdcId → Spanish name), `types.ts`, `validateSeedData.ts` (pre-write validation: duplicates, missing translations, negative nutrients, calorie warnings)
- **Fastify server**: `packages/api/src/app.ts` — `buildApp(opts?)` factory (async). `server.ts` is the entry point (listen + shutdown). Tests use `buildApp()` + `.inject()` without port binding
- **Config**: `packages/api/src/config.ts` — `EnvSchema` (Zod), `parseConfig(env)`, `config` singleton. Required: `DATABASE_URL`. Defaults: `PORT=3001`, `NODE_ENV=development`, `LOG_LEVEL=info`, `REDIS_URL=redis://localhost:6380`
- **Prisma singleton**: `packages/api/src/lib/prisma.ts` — auto-selects `DATABASE_URL_TEST` in test env. Do NOT import `config.ts` from here (circular dep)
- **Redis singleton**: `packages/api/src/lib/redis.ts` — ioredis with `lazyConnect: true`, `maxRetriesPerRequest: 0`. Reads `process.env['REDIS_URL']` directly (no config.ts import). `connectRedis()`/`disconnectRedis()` called from server.ts. Fail-open: app runs without Redis
- **Cache helper**: `packages/api/src/lib/cache.ts` — `buildKey(entity, id)` → `fxp:<entity>:<id>`, `cacheGet/cacheSet/cacheDel/cacheInvalidatePattern`. All fail-open (catch + warn log). Default TTL: 300s. SCAN-based invalidation
- **Error handler**: `packages/api/src/errors/errorHandler.ts` — `mapError(error)` pure function + `registerErrorHandler(app)`. Error envelope: `{ success: false, error: { message, code, details? } }`. Codes: `VALIDATION_ERROR`, `NOT_FOUND`, `DB_UNAVAILABLE`, `REDIS_UNAVAILABLE`, `RATE_LIMIT_EXCEEDED`, `INVALID_PDF` (422), `UNSUPPORTED_PDF` (422), `NO_NUTRITIONAL_DATA_FOUND` (422), `PROCESSING_TIMEOUT` (408), `INTERNAL_ERROR`
- **Health route**: `packages/api/src/routes/health.ts` — `GET /health` with optional `?db=true` and `?redis=true`. Prisma + Redis injectable via plugin options
- **PDF ingestion route**: `packages/api/src/routes/ingest/pdf.ts` — `POST /ingest/pdf` multipart upload. Dependencies: `pdf-parse` (text extraction), `@fastify/multipart` (file upload, 10MB limit). Pipeline: multipart parse → magic bytes check (`%PDF-`) → DB existence checks (restaurant + dataSource) → `extractText` (pdf-parse wrapper, `packages/api/src/lib/pdfParser.ts`) → `parseNutritionTable` (heuristic regex parser, `packages/api/src/ingest/nutritionTableParser.ts`, Spanish + English keywords) → `normalizeNutrients` + `normalizeDish` (from `@foodxplorer/scraper`) → Prisma `findFirst + create/update` in `$transaction` → response. 30s timeout via `Promise.race` + `clearTimeout`. Supports `dryRun=true` (no DB writes). Partial success: 200 with `dishesSkipped` + `skippedReasons`. `sourceUrl` format: `pdf://[sanitized_filename]`
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
- All schemas exported from `packages/shared/src/index.ts`

### Scraper (packages/scraper)
- **Package name**: `@foodxplorer/scraper`
- **Entry point**: `src/runner.ts` (CLI via `tsx src/runner.ts`)
- **Config**: `src/config.ts` — `ScraperEnvSchema` (Zod), `parseConfig(env)`, `config` singleton. Required: `DATABASE_URL`. Env vars: `NODE_ENV`, `DATABASE_URL`, `DATABASE_URL_TEST`, `LOG_LEVEL`, `SCRAPER_HEADLESS` (bool, default true), `SCRAPER_CHAIN` (optional string)
- **Base class**: `src/base/BaseScraper.ts` — abstract. Chain scrapers implement `extractDishes(page)` and `getMenuUrls(page)`. Public `run()` returns `ScraperResult`. Protected `normalize()` and `persist()` stub. Protected `createCrawler()` factory for testability.
- **Types**: `src/base/types.ts` — `RawDishDataSchema`, `NormalizedDishDataSchema`, `ScraperConfigSchema`, `ScraperResultSchema` (all with `z.infer` type exports). NOT in packages/shared.
- **Errors**: `src/base/errors.ts` — `ScraperError` → `ScraperNetworkError`, `ScraperBlockedError`, `ScraperStructureError`, `NormalizationError`, `NotImplementedError`. Each has `readonly code: string` (SCREAMING_SNAKE_CASE).
- **Utilities**: `src/utils/retry.ts` (`withRetry<T>(fn, policy, context)`), `src/utils/rateLimit.ts` (`RateLimiter` class, token-bucket + 3000-5000ms jitter), `src/utils/normalize.ts` (`normalizeNutrients`, `normalizeDish`)
- **Registry**: `src/registry.ts` — empty `registry: ScraperRegistry = {}`. F008–F017 add entries.
- **Zod version note**: Uses `.nonnegative()` not `.nonneg()` — the installed version of zod (^3.24.2) does not have `.nonneg()` shorthand.
- **persist() is a stub in F007**: calls `persistDish()` which throws `NotImplementedError`. F008 overrides `persistDish()` with real Prisma upsert.
- **Crawler dependency injection pattern**: `createCrawler(requestHandler, failedRequestHandler)` is protected. Tests override it to return a duck-typed mock (no real Playwright launched).

### Bot (packages/bot)
- _To be populated_
