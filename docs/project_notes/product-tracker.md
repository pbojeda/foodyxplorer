# Product Tracker

> Feature backlog and progress tracking. Each feature follows the SDD workflow (Steps 0-6).

---

## Active Session

> **Read this section first** when starting a new session or after context compaction. Provides instant context recovery.

**Last Updated:** 2026-03-17

**Active Feature:** F015 — Chain Onboarding — Pans & Company
**Complexity:** Simple | **Step:** 5/6 (Review)
**Branch:** feature/F015-pans-company-onboarding
**Context:** PR #15 created, code review done (0 Critical, 2 Important — both addressed). 182 dishes, 72 new tests. Awaiting merge approval.

---

## Epics — Phase 1

| Epic | Name | Status | Features | Dependencies |
|------|------|--------|----------|--------------|
| E001 | Infrastructure & Schema | done | F001-F006 | Day 0 complete |
| E002 | Data Ingestion Pipeline | in-progress | F007-F019 | E001 complete |
| E003 | Estimation Engine | pending | F020-F024 | E001 complete, E002 partial |
| E004 | Telegram Bot + Public API | pending | F025-F030 | E002 + E003 complete |

## Features — E001 Infrastructure & Schema

| ID | Feature | Type | Status | Step | Notes |
|----|---------|------|--------|------|-------|
| F001 | Prisma Schema Migration — Core tables | backend | done | 6/6 | data_sources, foods, food_nutrients, standard_portions |
| F001b | Schema Enhancements — Nutrition API Alignment | backend | done | 6/6 | FoodType, brandName, barcode, referenceBasis, portion desc/isDefault, Recipe+RecipeIngredient, 5 nutrient cols |
| F002 | Prisma Schema Migration — Dishes & Restaurants | backend | done | 6/6 | 1 enum, 8 models: cooking_methods, dish_categories, restaurants, dishes, dish_nutrients, dish_ingredients + 2 junction tables |
| F003 | pgvector Extension & Indexes | backend | done | 6/6 | IVFFlat on foods.embedding, dishes.embedding |
| F004 | Fastify API Scaffold | backend | done | 6/6 | /health, OpenAPI, Zod validation |
| F005 | Redis Connection & Cache Layer | backend | done | 6/6 | Cache helper, rate limiting middleware |
| F006 | Seed Script — USDA/FEN Base Foods | backend | done | 6/6 | 514 real USDA SR Legacy foods, 49 tests |

## Features — E002 Data Ingestion Pipeline

| ID | Feature | Type | Status | Step | Notes |
|----|---------|------|--------|------|-------|
| F007 | Scraper base: Crawlee + Playwright scaffold | backend | done | 6/6 | New packages/scraper workspace, BaseScraper, normalization pipeline, 141 tests |
| F007b | PDF Ingestion Endpoint (POST /ingest/pdf) | backend | done | 6/6 | Standard complexity, POST /ingest/pdf, pdf-parse + heuristic parser |
| F007c | URL Ingestion Endpoint (POST /ingest/url) | backend | done | 6/6 | Scrape URL for nutritional data, normalize to schema. Reuses F007 pipeline. |
| F008 | McDonald's Spain Scraper | backend | done | 6/6 | First chain scraper, establishes pattern for F009-F017. Dual extraction, shared persist, registry upgrade | First chain scraper, establishes pattern for F009-F017 |
| F009 | PDF Auto-Ingest Pipeline (POST /ingest/pdf-url) | backend | done | 6/6 | Download PDF from URL → reuse F007b pipeline. See ADR-006. 85 new tests |
| F010 | Chain PDF Registry + Batch Runner | backend | done | 6/6 | Config registry mapping chains to PDF URLs + CLI batch runner. Seed data for BK, KFC, Telepizza, Five Guys. See ADR-006 |
| F011 | Chain Onboarding — PDF Chains | backend | done | 6/6 | Chain text preprocessor (ADR-007). BK 166, KFC 169, Telepizza 64 dishes. Five Guys allergen-only (disabled). chainSlug added to API. 897 tests. PR #12 |
| F012 | Image/OCR Ingestion Pipeline | backend | done | 6/6 | Tesseract.js v5 OCR. POST /ingest/image-url, imageDownloader, imageOcrExtractor. Domino's Spain (JPEG). 105 tests. PR #13 |
| F013 | Subway Spain Data Research | research | done | — | subwayspain.com has PDF: MED_Nutritional_Information_C4_2025 (kcal, macros, per 100g). Quarterly updates. Compatible with PDF pipeline. Subway onboarding moves to F014 |
| F014 | Chain Onboarding — Subway Spain | backend | done | 6/6 | Simple. PDF pipeline. Source: subwayspain.com official PDF. PR #14. 47 new tests |
| F015 | Chain Onboarding — Pans & Company | backend | in-progress | 5/6 | Simple. PDF pipeline. Source: vivabem.pt (Ibersol). 182 dishes, custom preprocessor. PR #15 |
| F016-F017 | Chain Onboarding — VIPS, 100 Montaditos | backend | postponed | — | Allergen-only data (no calories/macros). Candidates for E003 estimation engine |
| F018 | Data Quality Monitor | backend | pending | — | |
| F019 | Embedding Generation Pipeline | backend | pending | — | |

## Features — E003 Estimation Engine

| ID | Feature | Type | Status | Step | Notes |
|----|---------|------|--------|------|-------|
| F020 | Level 1 — Official Data Lookup | backend | pending | — | |
| F021 | Level 2 — Ingredient-Based Estimation | backend | pending | — | |
| F022 | Level 3 — Similarity Extrapolation (pgvector) | backend | pending | — | |
| F023 | Engine Router & Confidence API | backend | pending | — | |
| F024 | LLM Integration Layer | backend | pending | — | |

## Features — E004 Telegram Bot + Public API

| ID | Feature | Type | Status | Step | Notes |
|----|---------|------|--------|------|-------|
| F025 | Fastify Routes — Core Endpoints | backend | pending | — | |
| F026 | API Rate Limiting + Auth (API Key) | backend | pending | — | |
| F027 | Telegram Bot — Command Handler | backend | pending | — | |
| F028 | Telegram Bot — Natural Language Handler | backend | pending | — | |
| F029 | Query Log & Analytics | backend | pending | — | |
| F030 | Monitoring & Alerting | backend | pending | — | |

---

## Completion Log

| Date | Feature | Commit/PR | Notes |
|------|---------|-----------|-------|
| 2026-03-10 | F001 — Prisma Schema Migration — Core Tables | 426e694 (squash merge to develop) | 4 models, 4 enums, pgvector, CHECK constraints, XOR, FTS indexes, Zod schemas, 83 tests |
| 2026-03-11 | F001b — Schema Enhancements — Nutrition API Alignment | 9f38639 (squash merge to develop) | 2 new enums, 2 new models, 6 new columns, 5 nutrient cols, 78 new tests (193 total), 1 bug fixed |
| 2026-03-11 | F002 — Prisma Schema Migration — Dishes & Restaurants | 6359ab2 (squash merge to develop) | 1 enum, 8 models (+ 2 junctions), 6 Zod schemas, 9 CHECK constraints, 19 indexes, 195 new tests (388 total), 0 bugs, ADR-004 |
| 2026-03-11 | F003 — pgvector Extension & Indexes | 9babeac (squash merge to develop, PR #2) | 2 IVFFlat indexes (cosine, lists=100), 9 new tests (397 total) |
| 2026-03-12 | F004 — Fastify API Scaffold | 4600c2e (squash merge to develop, PR #3) | Fastify v5 server, GET /health, OpenAPI/Swagger, Zod validation, error handler, CORS, graceful shutdown. 63 new tests (460 total), 1 QA bug fixed |
| 2026-03-12 | F005 — Redis Connection & Cache Layer | 9a9c080 (squash merge to develop, PR #4) | ioredis singleton (fail-open), cache helper (get/set/del/invalidatePattern), @fastify/rate-limit, GET /health?redis=true. 72 new tests (532 total), 1 review fix |
| 2026-03-12 | F006 — Seed Script — USDA/FEN Base Foods | c2f48c6 (squash merge to develop, PR #5) | 514 real USDA SR Legacy foods, 14 nutrient cols per 100g, Spanish translations, 14 group-level portions, validation helper, batch processing. 49 new tests (581 total), 2 QA bugs fixed |
| 2026-03-12 | F007 — Scraper base: Crawlee + Playwright scaffold | 582cbb1 (squash merge to develop, PR #6) | New packages/scraper workspace, BaseScraper abstract class, normalization pipeline (RawDishData→NormalizedDishData), withRetry, RateLimiter, anti-bot defaults. 141 new tests (722 total), 3 QA bugs fixed, 4 code review fixes |
| 2026-03-12 | F007b — PDF Ingestion Endpoint (POST /ingest/pdf) | 5cb6384 (squash merge to develop, PR #7) | POST /ingest/pdf, pdf-parse + heuristic parser (ES/EN), @fastify/multipart, $transaction upsert, 30s timeout, partial success. 105 new tests (827 total), 2 QA bugs fixed, 5 code review fixes |
| 2026-03-13 | F007c — URL Ingestion Endpoint (POST /ingest/url) | 595a546 (squash merge to develop, PR #8) | POST /ingest/url, PlaywrightCrawler + node-html-parser, SSRF guard (IPv4/IPv6/numeric/::ffff:), reuses parseNutritionTable. 88 new tests (915 total), 1 QA bug fixed, 4 code review fixes |
| 2026-03-13 | F008 — McDonald's Spain Scraper | c75e599 (squash merge to develop, PR #9) | First chain scraper. Dual extraction (JSON-LD + HTML table), shared persistDishUtil, PrismaClient singleton, registry upgrade, CAPTCHA detection. 91 new tests (232 scraper, ~1006 total), 5 QA bugs fixed, 7 review fixes |
| 2026-03-16 | F009 — PDF Auto-Ingest Pipeline | ee99310 (squash merge to develop, PR #10) | POST /ingest/pdf-url, ssrfGuard shared module, pdfDownloader (streaming 20MB cap), PAYLOAD_TOO_LARGE error. Lazy McDonald's config fix. ADR-006 (PDF-first pivot). 85 new tests (730 API, 962 total), 3 review fixes |
| 2026-03-16 | F010 — Chain PDF Registry + Batch Runner | babad7d (squash merge to develop, PR #11) | ChainPdfConfig Zod schema, CHAIN_PDF_REGISTRY (4 chains: BK, KFC, Telepizza, Five Guys), batch-ingest CLI (runBatch + HTTP), seedPhase3 (8 upserts). 80 new tests (819 API, 1051 total), 7 QA bugs fixed |
| 2026-03-16 | F011 — Chain Onboarding — PDF Chains | 38177d1 (squash merge to develop, PR #12) | chainTextPreprocessor (ADR-007): per-chain PDF normalization before generic parser. BK 166 dishes, KFC 169, Telepizza 64. Five Guys disabled (allergen-only). chainSlug optional param on POST /ingest/pdf-url. 78 new tests (897 API), 1 code review fix, 34 QA edge-case tests |
| 2026-03-16 | F012 — Image/OCR Ingestion Pipeline | fc4e9bc (squash merge to develop, PR #13) | POST /ingest/image-url, Tesseract.js v5 (spa+eng), imageDownloader (10MB cap), imageOcrExtractor (worker per-request). chain-image-registry (Domino's), batch-ingest-images CLI, seedPhase4. 105 new tests (44 unit + 61 QA edge-case), 4 code review fixes, 2 QA bugs fixed |
| 2026-03-16 | F013 — Subway Spain Data Research | — (research only) | subwayspain.com confirmed. PDF: MED_Nutritional_Information_C4_2025 (English/Spanish/Catalan). EU nutrients (kcal, fat, saturates, carbs, sugars, fiber, protein, salt) per serving + per 100g. Quarterly cycle. Compatible with existing PDF pipeline |
| 2026-03-16 | F014 — Chain Onboarding — Subway Spain | 67b1404 (squash merge to develop, PR #14) | SUBWAY_ES seed IDs, chain-pdf-registry (5 entries), seedPhase5, chainTextPreprocessor passthrough. 47 new tests (1008 total) |

---

## Notes

- Day 0 setup executed on 2026-03-10
- Phase 1 target: 6 weeks, 100 users, 10 chains, <3s response, <0.05€/query
- FEN PDF source for F006 seed: https://www.fen.org.es/storage/app/media/imgPublicaciones/2018/libro-la-alimentacion-espanola.pdf
