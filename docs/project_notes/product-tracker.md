# Product Tracker

> Feature backlog and progress tracking. Each feature follows the SDD workflow (Steps 0-6).

---

## Active Session

> **Read this section first** when starting a new session or after context compaction. Provides instant context recovery.

**Last Updated:** 2026-03-11

| Field | Value |
|-------|-------|
| **Current Feature** | F002 — Prisma Schema Migration — Dishes & Restaurants |
| **Step** | 5/6 (Review) |
| **Branch** | feature/F002-dishes-restaurants |
| **Complexity** | Standard |
| **Ticket** | docs/tickets/F002-dishes-restaurants.md |

**Context:** Implementation complete. 388 tests passing (121 unit + 267 integration). Lint clean, build succeeds. Code review (0 critical, 2 important fixed) + QA (0 bugs, 86 edge-case tests) done. Production-code-validator: 0 issues.

**Next Actions:**
1. Squash merge to develop (user approved)
2. Step 6: delete branch, update tracker, finalize

**Open Questions:** _None._

**Auto-Approved Decisions (this session):**

| Step | Decision | Rationale |
|------|----------|-----------|
| 0 | Spec auto-approved | L2 autonomy; database-architect reviewed, follows F001/F001b patterns |
| 1 | Ticket auto-approved | L2 autonomy; standard complexity |

---

## Epics — Phase 1

| Epic | Name | Status | Features | Dependencies |
|------|------|--------|----------|--------------|
| E001 | Infrastructure & Schema | in-progress | F001-F006 | Day 0 complete |
| E002 | Data Ingestion Pipeline | pending | F007-F019 | E001 complete |
| E003 | Estimation Engine | pending | F020-F024 | E001 complete, E002 partial |
| E004 | Telegram Bot + Public API | pending | F025-F030 | E002 + E003 complete |

## Features — E001 Infrastructure & Schema

| ID | Feature | Type | Status | Step | Notes |
|----|---------|------|--------|------|-------|
| F001 | Prisma Schema Migration — Core tables | backend | done | 6/6 | data_sources, foods, food_nutrients, standard_portions |
| F001b | Schema Enhancements — Nutrition API Alignment | backend | done | 6/6 | FoodType, brandName, barcode, referenceBasis, portion desc/isDefault, Recipe+RecipeIngredient, 5 nutrient cols |
| F002 | Prisma Schema Migration — Dishes & Restaurants | backend | in-progress | 5/6 | 1 enum, 8 models: cooking_methods, dish_categories, restaurants, dishes, dish_nutrients, dish_ingredients + 2 junction tables |
| F003 | pgvector Extension & Indexes | backend | pending | — | IVFFlat on foods.embedding, dishes.embedding |
| F004 | Fastify API Scaffold | backend | pending | — | /health, OpenAPI, Zod validation |
| F005 | Redis Connection & Cache Layer | backend | pending | — | Cache helper, rate limiting middleware |
| F006 | Seed Script — USDA/FEN Base Foods | backend | pending | — | Min 500 base foods with nutrients per 100g |

## Features — E002 Data Ingestion Pipeline

| ID | Feature | Type | Status | Step | Notes |
|----|---------|------|--------|------|-------|
| F007 | Scraper base: Crawlee + Playwright scaffold | backend | pending | — | |
| F007b | PDF Ingestion Endpoint (POST /ingest/pdf) | backend | pending | — | Upload PDF, extract nutritional data, normalize to schema. Reuses F007 pipeline. |
| F007c | URL Ingestion Endpoint (POST /ingest/url) | backend | pending | — | Scrape URL for nutritional data, normalize to schema. Reuses F007 pipeline. |
| F008-F017 | Scraper per chain (10 features) | backend | pending | — | McDonald's, BK, KFC, Telepizza, Domino's, Subway, Five Guys, VIPS, Pans, 100 Montaditos |
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

---

## Notes

- Day 0 setup executed on 2026-03-10
- Phase 1 target: 6 weeks, 100 users, 10 chains, <3s response, <0.05€/query
- FEN PDF source for F006 seed: https://www.fen.org.es/storage/app/media/imgPublicaciones/2018/libro-la-alimentacion-espanola.pdf
