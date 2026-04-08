# Product Tracker

> Feature backlog and progress tracking. Each feature follows the SDD workflow (Steps 0-6).

---

## Active Session

> **Read this section first** when starting a new session or after context compaction. Provides instant context recovery.

**Last Updated:** 2026-04-08

**Active Feature:** BUG-AUDIT-C4 — Fix POST empty body → 500 (Simple, Step 5/6 Review)
**Branch:** `feature/bug-audit-c4-post-empty-body-500`
**Ticket:** `docs/tickets/BUG-AUDIT-C4-post-empty-body-500.md`
**Last Bugfix Completed:** BUG-AUDIT-C1C3 — Fixed (PR #82, squash merged)
**Last Completed:** Phase B Audit (Puntos 1-5) — all 5 audit steps done

**Phase B Audit Summary (2026-04-07 to 2026-04-08):**
- Punto 1: Manuals updated (bot §20-23, API §20-21) ✓
- Punto 2: Real API testing — found 3 code bugs (C1-C3) + 4 doc errors (D1-D4, fixed) ✓
- Punto 3: Cross-model review (Gemini + Codex) — found 13 more doc issues (D5-D17, all fixed) ✓
- Punto 4: Exhaustive API testing — found 3 new bugs (C4-C6) + 1 architectural observation (A1) ✓
- Punto 5: Stability confirmed — core features working, bugfix plan agreed ✓

**Bugfix plan (before Phase C):**
1. BUG-AUDIT-C1C3 — Fix `/reverse-search` error envelope (C1+C3). Simple SDD.
2. BUG-AUDIT-C4 — Fix POST empty body → 500 (C4). Simple SDD.
3. BUG-AUDIT-C5 — Fix reverse search via conversation returns empty (C5). Simple SDD.
4. Deferred: C2 (context persistence), C6 (data quality), A1 (bot rate limit architecture)

Full findings: `docs/project_notes/audit-phase-b-findings.md`

**Pending operational step (F080):** OFF data import in progress — API v2 auth fix applied (ecdc186). Pagination fix applied (count-based). Ingestion being executed in a separate session.
```
OFF_IMPORT_ENABLED=true npx tsx packages/api/src/scripts/off-import.ts --brand hacendado
```
After import: `npm run embeddings:generate -w @foodxplorer/api`.

> **CRITICAL: Spec Creation Rule**
> Before creating ANY spec for F068-F109, the spec-creator agent MUST read `docs/research/product-evolution-analysis-2026-03-31.md` first. That document contains the approved strategy, architectural decisions, data source hierarchy, voice architecture notes, and cross-model reviewed rationale for every feature. Do NOT invent requirements — derive them from that document.

---

## Epics — Phase 1

| Epic | Name | Status | Features | Dependencies |
|------|------|--------|----------|--------------|
| E001 | Infrastructure & Schema | done | F001-F006 | Day 0 complete |
| E002 | Data Ingestion Pipeline | done | F007-F019 | E001 complete |
| E003 | Estimation Engine | done | F020-F024 | E001 complete, E002 partial |
| E004 | Telegram Bot + Public API | in-progress | F025-F032 | E002 + E003 complete |
| E005 | Advanced Analysis & UX | done | F033-F037 | E004 partial |

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
| F015 | Chain Onboarding — Pans & Company | backend | done | 6/6 | Simple. PDF pipeline. Source: vivabem.pt (Ibersol). 182 dishes, custom preprocessor. PR #15 |
| F016-F017 | Chain Onboarding — VIPS, 100 Montaditos | backend | postponed | — | Allergen-only data (no calories/macros). Candidates for E003 estimation engine |
| F018 | Data Quality Monitor | backend | done | 6/6 | Standard. GET /quality/report, 6 check dimensions, CLI script. 105 tests. PR #16 |
| F019 | Embedding Generation Pipeline | backend | done | 6/6 | Standard. OpenAI text-embedding-3-small, CLI + POST /embeddings/generate, embeddingUpdatedAt migration. 108 tests. PR #17 |

## Features — E003 Estimation Engine

| ID | Feature | Type | Status | Step | Notes |
|----|---------|------|--------|------|-------|
| F020 | Level 1 — Official Data Lookup | backend | done | 6/6 | GET /estimate, 4-strategy cascade, Kysely bootstrap, CTE de-dup, Redis cache. 108 tests. PR #18 |
| F021 | Level 2 — Ingredient-Based Estimation | backend | done | 6/6 | Standard. level2Lookup, nutrient aggregation from dish_ingredients, 2 strategies, confidence scoring. 80 new tests. PR #19 |
| F022 | Level 3 — Similarity Extrapolation (pgvector) | backend | done | 6/6 | Standard. pgvector cosine similarity, OpenAI embedding at request time, fail-graceful |
| F023 | Engine Router & Confidence API | backend | done | 6/6 | Standard. Extract cascade to engineRouter module, F024 extension seam |
| F024 | LLM Integration Layer | backend | done | 6/6 | Standard. L4 estimation: Strategy A (pg_trgm + LLM selection), Strategy B (LLM decomposition + aggregation). 58 tests. PR #22 |

## Features — E004 Telegram Bot + Public API

| ID | Feature | Type | Status | Step | Notes |
|----|---------|------|--------|------|-------|
| F025 | Fastify Routes — Core Endpoints | backend | done | 6/6 | Standard. 4 catalog endpoints. 67 tests. Review: 1 fix (chains grouping), 33 QA edge-case tests |
| F026 | API Rate Limiting + Auth (API Key) | backend | done | 6/6 | Standard. 122 tests. PR #23. Squash merged cc51626 |
| F027 | Telegram Bot — Command Handler | backend | done | 6/6 | Standard. 227 tests, PR #24, SHA 3461f10 |
| F028 | Telegram Bot — Natural Language Handler | backend | done | 6/6 | Standard. 307 tests, PR #25, SHA 0ddc21a |
| F029 | Query Log & Analytics | backend | done | 6/6 | Standard. query_logs table, fire-and-forget logging, GET /analytics/queries |
| F030 | Monitoring & Alerting | backend | pending | — | |

## Features — E005 Advanced Analysis & UX

| ID | Feature | Type | Status | Step | Notes |
|----|---------|------|--------|------|-------|
| F032 | Restaurant Resolution + Creation (schema migration) | fullstack | done | 6/6 | Standard. Schema migration (address fields). Trigram search. POST /restaurants. Bot /restaurante + Redis state. PR #29, SHA d71cf09 |
| F033 | L4 Prompt Enhancement (explicit amounts + portion_multiplier) | backend | done | 6/6 | Simple. PR #28, SHA e8aece8. 10 tests. portion_multiplier pattern (ADR-009) |
| F035 | Recipe Calculation Endpoint (structured + free-form) | backend | done | 6/6 | Standard. POST /calculate/recipe. PR #31, SHA a263c79. 116 tests. 4 review rounds |
| F038 | Multilingual Dish Name Resolution | backend | done | 6/6 | Standard. Populate name_es for all dishes, fix ingest pipeline, new name_source_locale field, regenerate embeddings. ADR-010 |
| F031 | Bot File Upload (multipart, inline keyboard) | fullstack | done | 6/6 | Standard. PR #32, SHA 01d8b1f. 137 tests (8 files). POST /ingest/image + bot handlers. BUG-F031-01 fixed |
| F034 | Menu Analysis (PDF OCR + Vision API) | fullstack | done | 6/6 | Complex. POST /analyze/menu (auth required). parseDishNames for PDFs, Vision for photos. ADR-011. PR #34, SHA a4fde9a. 168 tests (10 files). 37 files changed |
| F041 | Bot Recipe Calculator (/receta) | fullstack | done | 6/6 | Standard. Bot /receta command → POST /calculate/recipe (free-form). PR #35, SHA c1db312. 100 tests (4 files). 23 files changed |
| F042 | Portion-Aware NL Estimation | fullstack | done | 6/6 | Standard. PR #36, SHA 67fc5c0. 140 tests (69 impl + 71 QA). BUG-F042-01 resolved |
| F043 | Dish Comparison via Bot | fullstack | done | 6/6 | Standard. /comparar + NL patterns → 2× /estimate → comparison card. PR #37 merged |
| F037 | Conversational Context Manager | bot | done | 6/6 | Standard. Chain context per chatId, auto-inject in /estimar /comparar NL. PR #39, SHA d6d32df. 162 F037 tests, 1055 total |

## Features — Marketing & Growth

| ID | Feature | Type | Status | Step | Notes |
|----|---------|------|--------|------|-------|
| F039 | Landing Page — nutriXplorer | frontend | done | 6/6 | Standard. packages/landing/ standalone. Next.js 14 + Tailwind + Framer Motion. 9 sections, A/B hero, SEO, GDPR, analytics. 153 tests. SHA 64280e4 |
| F044 | Landing Page Overhaul — v5 design, 4 A/B variants, SearchSimulator | frontend | done | 6/6 | Standard. Glass-card aesthetic, 8 images, 4 variants (A/C/D/F), Mediterranean palette, PostSimulatorCTA. 286 tests. SHA 013935d |
| F045 | Landing — Critical Bug Fixes | frontend | done | 6/6 | Standard. 9 fixes from audit: legal pages, og-image, canonical, anchors, variant D removed, CTA gating, animation typo, hydration warning, SearchAction. PR #38, 335 tests |
| F046 | Landing — Waitlist Persistence + Anti-Spam | fullstack | done | 6/6 | Standard. POST /waitlist + GET /admin/waitlist, Prisma migration, honeypot + rate limiting, landing form → Fastify API. PR #40, SHA e0c83e8 |
| F047 | Landing — Conversion Optimization | fullstack | done | 6/6 | Standard. 8 items: GA4 init, mobile menu, phone +34, success banner, forms reduced, social proof counter, CTA copy, contrast. GET /waitlist/count. PR #42, SHA a52546d |
| F040 | Landing Page FAQ Section + Schema | frontend | done | 6/6 | Standard. FAQ accordion with structured data (FAQPage schema). Deferred from F039. Depends on F045 |
| F048 | Landing — Performance & Accessibility | frontend | done | 6/6 | Standard. ARIA combobox, security headers, ChatGPT card, no-match UX, reduced-motion, localStorage. PR #45 |

## Features — Quality & Documentation

| ID | Feature | Type | Status | Step | Notes |
|----|---------|------|--------|------|-------|
| F049 | Bot User Manual Overhaul | docs | done | 6/6 | Standard. Fix 2 critical doc errors (context fallback lie, TTL refresh lie), 8 important gaps (undocumented features, incorrect claims), 6 suggestions. From cross-model audit (Claude + Gemini + Codex) |
| F050 | Bot NL Punctuation Fix + Help Update | bot | done | 6/6 | Simple. BUG-AUDIT-01 fix (¿ stripping in extractFoodQuery) + /start help update. PR #43, SHA d243c1e. 11 tests, 1066 total |
| F051 | Bot Rate-Limit Ordering & Failed-Request Handling | bot | done | 6/6 | Bug. C1: move isRateLimited() before downloadTelegramFile(). I11: don't count failed API requests against /receta rate limit. From audit C1 (Gemini), I11 (Claude) |
| F052 | Restaurant Selection chainSlug Propagation | bot | done | 6/6 | Bug. chainSlug lost when selecting restaurant via inline keyboard — searchResults only stores name. From audit I1 (Codex) |
| F053 | Decouple Menu Analysis from Restaurant Selection | bot | done | 6/6 | Bug. handlePhoto() blocks all photo flows behind selectedRestaurant; analyze/identify don't need it. Plan says F034 independent. From audit I2 (Codex) |
| F054 | Context State Isolation & NL Footer Consistency | bot | done | 6/6 | Bug. I3: shared Redis key TTL refreshed by unrelated writes. I4: NL handler missing "Contexto activo" footer. From audit I3+I4 (Codex) |
| F055 | Inline Keyboard Stale-Button Mitigation + Callback Logging | bot | done | 6/6 | Bug (low). Stale-button race with multiple photos/searches + unknown callback_data not logged. From audit I7+S6 (Codex, Claude) |
| F056 | MIME Detection Fallback Safety | bot | done | 6/6 | Bug (low). Unknown magic bytes default to image/jpeg instead of showing error. From audit S7 (Claude, Gemini) |
| F057 | Manual Corrections Batch | docs | done | 5/5 | Simple. 5 corrections to user-manual-bot.md: /cadenas truncation (I5), error table sync (I6), plurals (S1), half verified (S2), NL error (S3). Section 10/8 deferred to F053/F054. SHA aa212bc |
| F058 | Strategic Plan Archival & Rate-Limit Decision Documentation | docs | done | 5/5 | Simple. Plan marked historical, verification items confirmed, ADR-013 + ADR-014 added. SHA aa212bc |

## Features — Landing Pre-Launch Audit

| ID | Feature | Type | Status | Step | Notes |
|----|---------|------|--------|------|-------|
| F059 | Legal/GDPR Compliance Bundle | frontend | done | 6/6 | Standard. Legal placeholders, cookie consent withdrawal, FAQ disclosure fix, privacy link in form. PR #50, SHA 4f9617f. 552 tests (41 new). Code review: APPROVED. QA: VERIFIED |
| F060 | GA4 Analytics Integration Fix | frontend | done | 6/6 | Standard. dataLayer.push→gtag, queue+replay+consent gate. GA ID: G-X46WMF1NM5. PR #53, SHA 1d635fd. 592 tests (40 new). Code review: APPROVED WITH NOTES. QA: VERIFIED |
| F061 | Landing Copy Accuracy | frontend | done | 6/6 | Standard. FAQ enabled chains only, testimonial, urgency, A/B comment. PR #54, SHA ef81906. 605 tests (13 new). Code review: APPROVED. QA: VERIFIED |
| F062 | Landing Assets & Hero Image Refresh | frontend | pending | — | Medium. Delete 9 unused images, review/replace hero image. From landing audit I5 |
| F063 | Nav, A/B Cookie & Variant Fixes | frontend | done | 6/6 | Standard. Nav FAQ link, variant cookie on mount, Secure flag. PR #55, SHA dcb04b9. 625 tests (20 new). Code review: APPROVED. QA: VERIFIED |
| F064 | Accessibility & Code Cleanup | frontend | done | 6/6 | Standard. 10 fixes: aria-selected, contrast, MobileMenu a11y, HSTS, CSP, dead code, honeypot, keyframes, themeColor, sitemap. PR #58, SHA ff25635. 659 tests (35 new). Code review: APPROVED. QA: VERIFIED |

## Features — Validation & Data Quality

| ID | Feature | Type | Status | Step | Notes |
|----|---------|------|--------|------|-------|
| F065 | McDonald's Chain Slug Migration | backend | done | 6/6 | Simple. Rename `mcdonalds` → `mcdonalds-es` / `mcdonalds-pt`. PR #56, SHA 380a982. Applied to dev+prod |
| F066 | E2E Smoke Tests | backend | done | 6/6 | Standard. 10 E2E smoke tests, real HTTP server. PR #57, SHA d0e63f3. Code review + QA approved |
| F067 | Data Quality Cleanup | backend | done | 6/6 | Simple. BK leading slashes, FTS ranking tuning. PR #59, SHA 6513e09. Applied to dev+prod |

## Epics — Phase 2 (Product Evolution)

| Epic | Name | Status | Features | Dependencies |
|------|------|--------|----------|--------------|
| E006 | Structural Foundations | in-progress | F068-F070 | Phase 1 complete |
| E007 | Spanish Food Coverage | pending | F071-F079 | E006 complete |
| E008 | Conversational Assistant & Voice | in-progress | F080-F089, F090-F097 | E006 + E007 partial |
| E009 | Personalization & Tracking | pending | F098-F099, user profiles | E008 partial |
| E010 | Scale & Monetization | pending | F100-F109 | E008 complete |

## Features — E006 Structural Foundations (Phase A0)

| ID | Feature | Type | Status | Step | Notes |
|----|---------|------|--------|------|-------|
| F068 | Provenance Graph: DataSource priority_tier + BEDCA-first resolution | backend | done | 6/6 | Standard. Add priority_tier to DataSource. Resolution: BEDCA > supermarket > USDA > estimated. `has_explicit_brand` flag. See product-evolution-analysis Sec 17 Foundation 1 |
| F069 | Anonymous Identity: actor table + middleware | backend | done | 6/6 | Standard. Actor table (anonymous_web / telegram / authenticated). Middleware for X-Actor-Id header. Cookie/UUID for web, chat_id for Telegram. Mergeable on future auth. See product-evolution-analysis Sec 17 Foundation 2 |
| F070 | Conversation Core: extract bot NL logic → shared API service | backend | done | 6/6 | Standard. PR #62. 129 tests. ConversationCore pipeline, POST /conversation/message, bot thin adapter. Phase A0 complete. |

## Features — E007 Spanish Food Coverage (Phase A1)

| ID | Feature | Type | Status | Step | Notes |
|----|---------|------|--------|------|-------|
| F071 | BEDCA Food Database Import | backend | done | 6/6 | PR #63. 74 tests. BEDCA Tier 1, 20 foods (placeholder IDs), feature flag BEDCA_IMPORT_ENABLED |
| F072 | Cooking Profiles + Yield Factors | backend | done | 6/6 | Standard. PR #64. CookingProfile table (60 entries). Yield factors + applyYield orchestrator. GET /estimate + POST /calculate/recipe integration. 194 new tests. BUG-F072-01 found+fixed |
| F073 | Spanish Canonical Dishes (BEDCA-first + LLM long tail) | backend | done | 6/6 | Standard. 250 dishes. Virtual restaurant `cocina-espanola`. PR #65. 69 tests. QA: 6 bugs fixed. |
| F074 | L4 Cooking State Extraction | backend | done | 6/6 | Standard. Per-ingredient cooking state extraction + yield correction in L4 Strategy B. 28 tests. PR #66 |
| F075 | Audio Input (Whisper → ConversationCore, bot) | backend+bot | done | 6/6 | Standard. Telegram voice → Whisper → ConversationCore. PR #67. 71 new tests. BUG-F075-01 fixed. |
| F076 | "Modo Menú del Día" (/menu command) | backend | done | 6/6 | Standard. Multi-dish meal estimation. New menu_estimation intent + /menu bot command + NL detection. PR #68. 72 new tests. BUG-F076-01 + BUG-F076-02 fixed. |
| F077 | Alcohol Nutrient Support | backend | done | 6/6 | Simple. Add alcohol field to calculation pipeline. 7 kcal/g. PR #69. +19 tests |
| F078 | Regional Aliases + "Modo España Real" | backend | done | 6/6 | Simple. Alias SQL matching + name_es exact + serving-format prefix stripping. PR #70. +22 tests |
| F079 | Demand-Driven Dish Expansion Pipeline | backend | done | 6/6 | Simple. missed_query_tracking table + 3 admin endpoints. PR #71. +76 tests |

## Features — E008 Conversational Assistant & Voice (Phase B + C)

> **Phase B: Value features that work WITHOUT auth**

| ID | Feature | Type | Status | Step | Notes |
|----|---------|------|--------|------|-------|
| F080 | OFF Prepared Foods Ingestion | backend | done | 6/6 | Standard. PR #72. 146 tests (8 files). OFF client+mapper+validator+seed. L1 branded+Tier 3 fallback. ODbL attribution. Brand aliases. 3 QA bugs fixed. Data import pending (OFF API 503) |
| F081 | "Health-Hacker" Chain Suggestions | bot | done | 6/6 | Simple. PR #73. 41 tests (3 files). enrichWithTips() helper, 13 chains → 5 categories, HealthHackerTipSchema. Code review: APPROVED |
| F082 | Nutritional Substitutions | backend | done | 6/6 | Simple. PR #74. 39 tests (3 files). enrichWithSubstitutions() helper, 8 categories, NutritionalSubstitutionSchema. Code review: APPROVED |
| F083 | Allergen Cross-Reference | backend | done | 6/6 | Simple. PR #75. 50 tests (2 files). enrichWithAllergens() helper, 14 EU allergens, DetectedAllergenSchema. Code review: APPROVED |
| F084 | Estimation with Uncertainty Ranges | backend | done | 6/6 | Simple. PR #76. 26 tests (2 files). enrichWithUncertainty() helper, ±5%-±30% matrix. Code review: APPROVED |
| F085 | Portion Sizing Matrix (Spanish portions) | backend | done | 6/6 | Simple. PR #77. 30 tests (2 files). enrichWithPortionSizing() helper, 9 terms, word boundary matching. Code review: APPROVED |
| F086 | Reverse Search ("¿qué como con X kcal?") | backend | done | 6/6 | Standard. GET /reverse-search endpoint + conversation intent. 136 tests. PR #78, e67164d |
| F087 | "El Tupper" Meal Prep | backend | done | 6/6 | Simple. PR #80, 1ae778c. 33 tests. Optional `portions` param, `perPortion` nutrients, bot tupper detection |
| F088 | Community Inline Corrections | bot | postponed | — | Standard. "Cálculo incorrecto" inline button. User proposes adjustment. Stored for review. Feeds demand pipeline |
| F089 | "Modo Tapeo" (shared portions) | bot | done | 6/6 | Simple. PR #81, ef5dbe6. 22 tests. Diners extraction + perPerson in menu estimation |

> **Phase B Audit Bugfixes (before Phase C)**

| ID | Feature | Type | Status | Step | Notes |
|----|---------|------|--------|------|-------|
| BUG-AUDIT-C1C3 | Fix `/reverse-search` error envelope | backend | done | 6/6 | Simple. PR #82. 6 new tests. Standardized 404+400 to project error envelope |
| BUG-AUDIT-C4 | Fix POST empty body → 500 | backend | in-progress | 5/6 | Simple. POST `/calculate/recipe` and `/conversation/message` return 500 when body is null/invalid JSON. Fastify body parser throws before Zod. Add onError hook or content-type-parser guard |
| BUG-AUDIT-C5 | Fix reverse search via conversation | backend | pending | — | Simple. `reverseSearchDishes()` called from `conversationCore.ts` always returns empty results. Direct endpoint works. Silent `catch` block masks DB error. Investigate Kysely instance or query mismatch |

> **Phase C: Conversational Web Assistant + Realtime Voice**

| ID | Feature | Type | Status | Step | Notes |
|----|---------|------|--------|------|-------|
| F090 | Web Assistant: Shell + Text Mode (/hablar) | frontend | pending | — | Standard. Next.js route /hablar. ConversationCore integration. Text input → JSON response → NutritionCard UI. See conversational-mode-briefing.md + development-plan.md in foodXPlorerResources |
| F091 | Web Assistant: Async Voice (STT → Core → TTS) | frontend | pending | — | Standard. Whisper transcription → ConversationCore → TTS response. Push-to-talk UX. Async, not realtime |
| F092 | Web Assistant: Plate Photo Upload | frontend | pending | — | Standard. Photo → existing /analyze/menu pipeline → results in UI. Reuses existing Vision API infrastructure |
| F093 | Web Assistant: Landing Integration + Analytics | frontend | pending | — | Simple. CTA from landing → /hablar. Analytics events. Visual coherence with landing design system |
| F094 | Voice Spike: Evaluate Browser-Side STT/TTS vs Cloud | research | pending | — | Research. Compare: Web Speech API (free), Whisper.cpp/Transformers.js (browser), Deepgram (cloud), OpenAI Realtime (cloud). Decide architecture for F095-F097. See product-evolution-analysis "OPEN INVESTIGATION" section |
| F095 | Realtime Voice: Implement Chosen Architecture | frontend | pending | — | Standard. Based on F094 spike results. WebSocket/WebRTC server if needed. STT streaming + VAD |
| F096 | Realtime Voice: Pause Detection + Barge-In + Filler | frontend | pending | — | Standard. End-of-speech detection, interruption handling, filler audio for L4 delays ("Déjame calcular...") |
| F097 | Realtime Voice: Frontend States + Mobile QA | frontend | pending | — | Standard. Listening/Processing/Speaking/Results states. Mobile-first QA. Accessibility fallbacks |

## Features — E009 Personalization & Tracking (Phase C continued)

| ID | Feature | Type | Status | Step | Notes |
|----|---------|------|--------|------|-------|
| F098 | Premium Tier (Feature Gates) | fullstack | pending | — | Standard. Rate limits for free tier (50 queries/day). Premium features: unlimited, photo analysis, voice, tracking |
| F099 | User Profiles: Goals, BMR, Daily Targets | fullstack | pending | — | Standard. Requires auth (actor_id upgrade). Weight, height, age, activity level → BMR. Goal: lose/maintain/gain. Daily calorie/protein targets |

## Features — E010 Scale & Monetization (Phase D)

| ID | Feature | Type | Status | Step | Notes |
|----|---------|------|--------|------|-------|
| F100 | Open Food Facts Full Integration (Barcodes) | fullstack | pending | — | Standard. Barcode photo → extraction → OFF query. For packaged products tracking |
| F110 | OFF Multi-Brand Expansion | backend | pending | — | Simple. Expand OFF ingestion beyond Hacendado to Carrefour, Dia, Lidl, Aldi, Eroski. ADR-017: expand later. **Prerequisites:** (1) Review F079 query logs for brand demand data, (2) Harden L1/L3 disambiguation for duplicate branded products, (3) Add quality scoring for non-Hacendado imports. Code already supports `--brand` flag. See ADR-017 for rationale |
| F101 | Barcode Extraction from Photos | backend | pending | — | Simple. Photo → barcode reading library → OFF lookup |
| F102 | API B2B Tiers + Documentation | backend | pending | — | Standard. Free (100/mo) → Starter (€49, 5K/mo) → Business (€199, 50K/mo). OpenAPI docs |
| F103 | Weekly Summary + Charts | frontend | pending | — | Standard. In-bot + web. Calorie/macro trends. Requires tracking (F099) |
| F104 | "Índice Saciedad vs Precio" Viral Content | frontend | pending | — | Simple. Data journalism: "Los 10 platos que dan más proteína por euro". Landing page content |
| F105 | Landing Coverage Showcase | frontend | pending | — | Simple. Show actual coverage numbers on landing. Chains + dishes + common Spanish foods |
| F106 | Google Maps Restaurant Discovery | fullstack | pending | — | Complex. Premium. Legal review required (ToS). See product-evolution-analysis Sec 7 |
| F107 | Auth Upgrade: Google Identity Platform | fullstack | pending | — | Standard. Actor merge flow. Multi-provider. See product-evolution-analysis Appendix B |
| F108 | PWA Shell | frontend | pending | — | Standard. If /hablar validates, create installable PWA. Offline basic tracking |
| F109 | Apple Health / Google Fit Export | fullstack | pending | — | Standard. Export daily totals to health apps. Requires tracking (F099) |

## Features — Marketing & Growth

| ID | Feature | Type | Status | Step | Notes |
|----|---------|------|--------|------|-------|
| F039 | Landing Page — nutriXplorer | frontend | done | 6/6 | Standard. packages/landing/ standalone. Next.js 14 + Tailwind + Framer Motion. 9 sections, A/B hero, SEO, GDPR, analytics. 153 tests. SHA 64280e4 |
| F040 | Landing Page FAQ Section | frontend | pending | — | Simple. FAQ accordion for landing page. Deferred from F039 |

## Security & Robustness Backlog (Post-Phase B)

> Identified during cross-model QA audit (2026-04-06). To be addressed before public launch.
> Full details: `docs/project_notes/qa-api-audit-2026-04-06.md`

| ID | Severity | Issue | Category |
|----|----------|-------|----------|
| A1 | CRITICAL | Actor impersonation — X-Actor-Id trusted blindly, attacker can spoof telegram IDs | Auth |
| A2 | HIGH | Audio DOS / billing — server buffers entire audio before validating duration | Input validation |
| A3 | MEDIUM | Free-form recipe grams unbounded — LLM can return grams > 5000 | Input validation |
| A4 | MEDIUM | Free-form recipes silently ignore cookingState | Documentation |
| C1 | HIGH | trustProxy: true unconditional — IP rate limiting spoofable via X-Forwarded-For | Infrastructure |
| C3 | HIGH | Actor table abuse — unbounded row creation per request without X-Actor-Id | Rate limiting |
| C5 | MEDIUM | Retry-After hardcoded 3600s but daily limit message says "tomorrow" | Rate limiting |
| C6 | MEDIUM | Health check doesn't cover Kysely — false positive for estimation endpoints | Monitoring |
| C7 | MEDIUM | /chains derived from restaurants — no canonical table, unstable order | Data model |
| C8 | MEDIUM | Actor ID confusion — data.actorId (DB UUID) vs X-Actor-Id (header) | API design |
| C9 | LOW | Failed requests consume daily quota (rate limit before validation) | Rate limiting |

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
| 2026-03-17 | F015 — Chain Onboarding — Pans & Company | 8f8d60f (squash merge to develop, PR #15) | PANS_AND_COMPANY_ES seed IDs, chain-pdf-registry (6 entries), custom preprocessor (column-separated PDF layout), seedPhase6. 72 new tests (1080 total) |
| 2026-03-17 | F018 — Data Quality Monitor | 6b1f79e (squash merge to develop, PR #16) | GET /quality/report (6 dimensions), 15 Zod schemas, CLI script, assembleReport orchestrator. 105 new tests (10 files). Refactored: count()+$queryRaw (no memory issues). Code review: 1 Critical + 4 Important fixed. QA: 37 edge-case tests |
| 2026-03-17 | F019 — Embedding Generation Pipeline | ed61a56 (squash merge to develop, PR #17) | POST /embeddings/generate, CLI script, OpenAI text-embedding-3-small (1536 dims), embeddingUpdatedAt migration. 6 modules (types, textBuilder, embeddingClient, embeddingWriter, pipeline, barrel). 108 new tests (6 files). Code review: 1C+4I fixed. QA: 37 edge-case tests. E002 complete |
| 2026-03-18 | F020 — Level 1 Official Data Lookup | f9af429 (squash merge to develop, PR #18) | GET /estimate, 4-strategy cascade (exact dish → FTS dish → exact food → FTS food), Kysely bootstrap (prisma-kysely + pg + singleton), CTE de-dup (ROW_NUMBER), 15 nutrients, Redis cache (fail-open, 300s). 7 Zod schemas. Code review: 1 Important fixed (cache key lowercase). QA: 2 bugs fixed (BUG-F020-01 trim order, BUG-F020-02 echo casing), 80 edge-case tests. 108 F020 tests (4 files). First E003 feature |
| 2026-03-18 | F021 — Level 2 Ingredient-Based Estimation | 52f7212 (squash merge to develop, PR #19) | level2Lookup: 2-strategy cascade (exact dish → FTS dish), CTE aggregation SQL (4 tables), per_100g filter, confidence scoring (medium/low). Unified cache key (replaces estimate:l1). Route L2 fallback, level2Hit field, 2 new match types. Plan reviewed 2 rounds (9 fixes: 2C+4I+3S). Code review: APPROVED (0 issues). QA: 52 edge-case tests, 8 findings (0 bugs). 80 F021 tests (4 files, 1904 total) |
| 2026-03-19 | F022 — Level 3 Similarity Extrapolation | 18a20f8 (squash merge to develop, PR #20) | level3Lookup: 2-strategy cascade (similarity_dish scoped → similarity_food global), pgvector `<->` cosine distance, OpenAI embedding at request time, fail-graceful. Plan reviewed 2 rounds (8 fixes). Code review: 1 CRITICAL fixed (similarityDistance propagation into result object), 1 IMPORTANT fixed (barrel exports). QA: 37 edge-case tests, NaN/Infinity guard added. 76 F022 tests (5 files, ~2018 total) |
| 2026-03-19 | F023 — Engine Router & Confidence API | 93e563d (squash merge to develop, PR #21) | runEstimationCascade() extracts L1→L2→L3 cascade from route into engineRouter.ts. Level4LookupFn extension seam for F024. Route handler ~25 lines. Code review: APPROVED (1 IMPORTANT fixed: .trim() cache key). QA: 35 edge-case tests, 0 bugs. 57 F023 tests (4 files, 95 total with backward compat) |
| 2026-03-19 | F024 — LLM Integration Layer | 7d0e875 (squash merge to develop, PR #22) | level4Lookup: Strategy A (pg_trgm trigram + LLM selection) + Strategy B (LLM decomposition + L1 resolution + L2 aggregation). ADR-001 compliant. Fail-graceful (callChatCompletion returns null). pg_trgm extension. Spec reviewed 2x (18 issues). Plan reviewed by Codex gpt-5.4 + Gemini 2.5 Pro (8 issues resolved). Code review: APPROVED (1I fixed: spread vs mutation). QA: 29 edge-case tests, 0 bugs. 58 F024 tests (3 files, 2078 total). **E003 complete** |
| 2026-03-19 | F025 — Fastify Routes — Core Endpoints | 85d7c6d (squash merge to develop, PR #25) | 4 catalog endpoints (restaurants, dishes, chains, search). 11 Zod schemas, GIN trigram indexes, dual Prisma/Kysely mappers, 60s cache. Spec reviewed 3x (7 issues). Plan reviewed 3x (9 issues + Gemini 2.5 Pro). Code review: 1 IMPORTANT fixed (chains grouping key). QA: 33 edge-case tests. 67 F025 tests (2 files). **First E004 feature** |
| 2026-03-20 | F026 — API Rate Limiting + Auth (API Key) | cc51626 (squash merge to develop, PR #23) | API key auth (SHA-256 hash, Redis 60s cache, fail-closed), 3-tier rate limiting (30/100/1000), admin auth (ADMIN_API_KEY env var, timingSafeEqual). Global onRequest hook (URL-based routing). Seed script (HMAC-SHA256 deterministic). Spec reviewed 2x (13 issues). Plan reviewed 2x + Codex GPT-5.4 (10 issues). Code review: 2 IMPORTANT fixed (prefix dedup, comment). QA: 73 edge-case tests. 122 F026 tests (6 files) |
| 2026-03-21 | F027 — Telegram Bot — Command Handler | 3461f10 (squash merge to develop, PR #24) | Standalone Telegram bot (packages/bot), 8 slash commands, ApiClient DI pattern, MarkdownV2 formatting, Zod config, Pino logging, graceful shutdown. Plan reviewed: self-review 3 fixes + Codex GPT-5.4 7 issues. Code review: 2H+3M+5L (3 fixed). QA: 1H+2M+3L (5 fixed, 53 edge-case tests). 227 tests (7 files) |
| 2026-03-21 | F028 — Telegram Bot — Natural Language Handler | 0ddc21a (squash merge to develop, PR #25) | NL handler for plain text → estimate API. extractFoodQuery (8 prefix patterns, chain slug, article stripping). Plan reviewed by Codex GPT-5.4 (4 issues fixed). Code review: APPROVED (1 dead regex removed). QA: 49 edge-case tests, 1 spec deviation fixed. 80 new tests (307 total, 8 files) |
| 2026-03-22 | F029 — Query Log & Analytics | c8c230d (squash merge to develop, PR #26) | query_logs table (2 enums, 4 indexes, no FK), writeQueryLog fire-and-forget, GET /analytics/queries (5 Kysely queries), estimate route logging via reply.raw.once('finish'). Plan reviewed by Codex GPT-5.4 (8 fixes). Code review: APPROVED (2I fixed: DRY fire-and-forget, $if mock). QA: 2 bugs fixed (cacheHitRate clamp, NaN guard), 49 edge-case tests. 107 new F029 tests (2718 total) |
| 2026-03-23 | F033 — L4 Prompt Enhancement | e8aece8 (squash merge to develop, PR #28) | Strategy B prompt: explicit gram amounts + portion_multiplier (ADR-001/ADR-009). Dual format parsing (object + legacy array). Hallucination guard (max 5.0). Code review: 1 IMPORTANT fixed. 10 new tests (2728 total) |
| 2026-03-24 | F032 — Restaurant Resolution + Creation | d71cf09 (squash merge to develop, PR #29) | Fullstack (API + Bot). Schema migration (4 location fields). GET /restaurants?q= trigram search (Kysely, pg_trgm). POST /restaurants admin endpoint (auto-slug independent-*-uuid8). Bot /restaurante command + inline keyboards + Redis conversation state (TTL 2h). Seed Phase 8 (Telegram Upload DataSource). Plan reviewed by Gemini + Codex (7 fixes). Production validator: 1 critical (auth header). Code review: 4 important fixed (slug 8-hex, URL validation, chainSlug regex, safeAnswerCallback). QA: 51 edge-case tests. 158 new F032 tests (97 API + 61 bot). 43 files changed |
| 2026-03-25 | F038 — Multilingual Dish Name Resolution | 45e9231 (squash merge to develop, PR #30) | Populate name_es for all dishes, fix ingest pipeline, name_source_locale field, regenerate embeddings. ADR-010. 91 tests, 21 files, +3631 lines |
| 2026-03-26 | F039 — Landing Page (nutriXplorer) | 64280e4 (squash merge to develop) | Standalone packages/landing/ (Next.js 14 + Tailwind + Framer Motion). 9 sections, A/B hero variants, SEO (JSON-LD, sitemap, robots), GDPR CookieBanner, GA4 analytics, i18n (ES+EN stubs), progressive enhancement. Spec reviewed by Gemini 2.5 + Codex GPT-5.4 (25 issues). Plan reviewed by Gemini + Codex (13 issues). Production validator: 7 issues fixed. Code review: APPROVED. QA: VERIFIED. 153 tests (23 suites), 98 files changed |
| 2026-03-26 | F035 — Recipe Calculation Endpoint | a263c79 (squash merge to develop, PR #31) | POST /calculate/recipe: structured + free-form modes. Food-only cascade (direct_id → exact_food → fts_food → similarity_food → llm_food_match). Two-phase resolution (L1 parallel, L3/L4 sequential, budget 10). 14 nutrients, null-all→null, AbortController 30s. openaiClient.ts shared utility. Spec reviewed 4x (Gemini + Codex, ~25 issues). Plan reviewed 2x (Gemini + Codex). Production validator: 1C+2H+3M fixed. Code review: APPROVED (2 important fixed). QA: VERIFIED (16 edge-case tests). 116 F035 tests (6 files). 18 files changed |
| 2026-03-26 | F031 — Bot File Upload | 01d8b1f (squash merge to develop, PR #32) | Fullstack (API + Bot). POST /ingest/image multipart endpoint + bot photo/document handlers + inline keyboard + ALLOWED_CHAT_IDS guard + apiClient multipart (90s timeout). FST_REQ_FILE_TOO_LARGE error mapping fix. Spec reviewed by Gemini+Codex (8 issues). Plan reviewed by Codex (5 issues). Production validator: 1C fixed. Code review: APPROVED (2H fixed: DRY download, shared constant). QA: 1 bug fixed (BUG-F031-01 empty photo array), 29 edge-case tests. 137 F031 tests (8 files). 32 files changed |
| 2026-03-27 | F034 — Menu Analysis (OCR + Vision API) | a4fde9a (squash merge to develop, PR #34) | Complex fullstack (API + Bot). POST /analyze/menu: 4 modes (auto/ocr/vision/identify), callVisionCompletion (multimodal base64), parseDishNames, per-dish runEstimationCascade, cooperative timeout (partial results), dual rate limiting (API 10/hr + bot 5/hr per chatId). Bot upload_menu + upload_dish callbacks. ADR-011. Spec reviewed by Gemini+Codex (7 issues). Plan reviewed by Gemini+Codex (7 issues). Production validator: 1C fixed (spec drift 408→200+partial). Code review: APPROVED (3M: 2 fixed). QA: 2 bugs fixed (BUG-F034-01 UNSUPPORTED_PDF wrapping, BUG-F034-02 0-dish timeout guard), 27 edge-case tests. 168 F034 tests (10 files). 37 files changed |
| 2026-03-27 | F041 — Bot Recipe Calculator (/receta) | c1db312 (squash merge to develop, PR #35) | Standard fullstack (bot-only — API exists). Bot /receta command → POST /calculate/recipe (free-form). Rate limit 5/hr per chatId (Redis, fail-open). Input guard 2000 chars. Smart truncation (ingredient list only). RECIPE_TIMEOUT_MS 30s. postJson optional timeout param. Spec reviewed by Gemini+Codex (6 issues). Plan reviewed by Gemini+Codex (6 issues). Production validator: READY (0 issues). Code review: APPROVED (2M fixed: dead variable, non-null assertion). QA: VERIFIED (0 bugs), 26 edge-case tests. 100 F041 tests (4 files). 23 files changed |
| 2026-03-28 | F042 — Portion-Aware NL Estimation | 67fc5c0 (squash merge to develop, PR #36) | Standard fullstack (API + Bot). API: portionMultiplier param on GET /estimate (0.1-5.0), post-cascade nutrient scaling (2dp), portionGrams (1dp), referenceBasis→per_serving, extended cache key. Bot: extractPortionModifier pure function (15 regex patterns, Spanish size modifiers + plurals), integrated in NL handler + /estimar, formatter PORTION_LABEL_MAP. Spec reviewed by Gemini (1C+2I+1S). Plan reviewed by Gemini (1C+1I+1S). Production validator: 5 issues (3 fixed). Code review: 1C+1S fixed (edge-cases fixture, label semantics). QA: BUG-F042-01 resolved (label map spec correction), 71 edge-case tests. 140 F042 tests (12 files). 31 files changed |
| 2026-03-28 | F043 — Dish Comparison via Bot | squash merge to develop, PR #37 | Standard bot-only. /comparar command + NL comparison detection (5 prefix patterns × 6 separators). Side-by-side MarkdownV2 code-block table with per-nutrient ✅ winner. Promise.allSettled, outcome matrix (timeout/error/unknown), length guard, same-entity note. Spec reviewed by Gemini+Codex (4C+6I+4S). Plan reviewed by Gemini+Codex (2C+5I+5S). Production validator: READY (0 issues). Code review: 1I fixed (con separator priority). QA: 3 bugs fixed (BUG-F043-01 leading ¿, BUG-F043-02 same-entity, BUG-F043-03 con in NL), 80 edge-case tests. 176 F043 tests (5 files). 11 files changed |
| 2026-03-28 | F045 — Landing Critical Bug Fixes | squash merge to develop, PR #38 | Standard frontend. 9 fixes from cross-model audit: 3 legal pages (GDPR/LSSI), og-image (1200x630), canonical URL, anchor IDs (#waitlist, #demo), variant D removed (ADR-012), PostSimulatorCTA gated by interaction, animation typo, suppressHydrationWarning, SearchAction removed. Production validator: 1C fixed (variant D in API). Code review: APPROVED (1M: accidental file deletion restored). QA: VERIFIED (22 edge-case tests, 0 bugs). 335 tests (38 suites). 30 files changed |
| 2026-03-28 | F037 — Conversational Context Manager | d6d32df (squash merge to develop, PR #39) | Standard bot-only. /contexto command (view/clear/set) + NL detection ("estoy en mcdonalds") + auto-inject chainSlug in /estimar, /comparar, NL handler. 4-tier fuzzy chain resolution (exact slug > exact name > prefix > bidirectional substring). BotStateChainContext in Redis, setStateStrict, real Redis TTL. Spec reviewed by Gemini+Codex (10 issues). Plan reviewed by Gemini+Codex (9 issues). Production validator: READY (0 issues). Code review: APPROVED (3I fixed). QA: 2 bugs fixed (BUG-F037-01 BORRAR case, BUG-F037-02 newline detector), 69 edge-case tests. 162 F037 tests (9 files). 30 files changed |
| 2026-03-29 | F040 — Landing Page FAQ Section + Schema | a93faba (squash merge to develop, PR #41) | Standard frontend. FAQ accordion with native `<details>`/`<summary>`, FAQPage JSON-LD, 6 items es/en, placed before WaitlistCTA in all 3 variants. Spec reviewed by Gemini+Codex (5I+2S). Plan reviewed by Gemini+Codex (1C+4I+2S). Production validator: 1C fixed (ui-components.md). Code review: APPROVED (1I fixed). QA: VERIFIED (26 edge-case tests, 0 bugs). 374 tests (40 suites). 14 files changed |
| 2026-03-29 | F048 — Landing Performance & Accessibility | b4a9d1a (squash merge to develop, PR #45) | Standard frontend. 6 P2 items: WAI-ARIA combobox (keyboard nav, aria-expanded/controls/activedescendant), security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy), ChatGPT 4th comparison card (es+en), no-match UX (query interpolation + suggestion pills), prefers-reduced-motion (CSS + MotionConfig), localStorage try/catch. Spec reviewed by Gemini+Codex (1C+6I). Plan reviewed by Gemini+Codex (5I). Code review: APPROVED (3 ARIA fixes). QA: VERIFIED (26 edge-case tests). 511 tests (47 suites). 15 files changed. **All Marketing & Growth features complete (F039-F048)** |
| 2026-03-29 | F049 — Bot User Manual Overhaul | aaebacf (squash merge to develop, PR #44) | Standard docs-only. 16 findings from cross-model audit (Claude+Gemini+Codex): 2 critical factual errors, 8 important gaps, 6 suggestions. Verified by Gemini+Codex (16/16 FIXED + 3 new issues fixed). 3 files changed |
| 2026-03-29 | F050 — Bot NL Punctuation Fix + Help Update | d243c1e (squash merge to develop, PR #43) | Simple bugfix. BUG-AUDIT-01: strip ¿¡?! in extractFoodQuery. /start help updated with /comparar, /contexto, /restaurante. 11 new tests, 1066 total. 6 files changed |
| 2026-03-29 | F047 — Landing Conversion Optimization | a52546d (squash merge to develop, PR #42) | Standard fullstack (API + landing). 8 conversion items: GA4 init (dataLayer bootstrap), MobileMenu Client Component (hamburger, ARIA, Escape/outside click), phone auto-prepend +34, WaitlistSuccessBanner (useSearchParams + Suspense), forms reduced to 2 per variant, social proof counter (GET /waitlist/count, 5min cache), benefit-oriented CTA copy (Spanish), WCAG AA contrast fix. Spec reviewed by Gemini+Codex (2C+8I). Plan reviewed by Gemini+Codex (7I). Code review: APPROVED (3I noted). QA: 1 bug fixed (BUG-F047-01 Footer form), 29 edge-case tests. 446 landing tests (45 suites) + 4 API. 34 files changed |
| 2026-03-28 | F046 — Waitlist Persistence + Anti-Spam | e0c83e8 (squash merge to develop, PR #40) | Standard fullstack (API + landing + shared). POST /waitlist (public, honeypot, 5/15min rate limit, email lowercase, P2002→409 idempotent, form-urlencoded 303). GET /admin/waitlist (admin auth, paginated, sort). Prisma migration waitlist_submissions. Landing form → Fastify API, honeypot field, UTM params, 409-as-success. Deleted Next.js route. Zod schemas in shared. Production validator: READY. Code review: APPROVED (3I fixed: max-length, phone validation, source input). QA: 3 bugs (BUG-F046-01 critical fixed, BUG-F046-03 low fixed, BUG-F046-02 medium noted), 94 edge-case tests. API 2449, Landing 332, Shared 339. 31 files changed |

| 2026-03-29 | F051 — Bot Rate-Limit Ordering & Failed-Request Handling | 714efb6 (squash merge to develop, PR #46) | Simple bug. C1: isRateLimited() moved before downloadTelegramFile(). I11: decrement /receta counter on server/network errors, exists guard for TTL expiry. 13 new tests, 1079 total. 6 files changed |
| 2026-03-29 | F057 — Manual Corrections Batch | aa212bc (worktree commit) | Simple docs. 5 corrections to user-manual-bot.md: /cadenas truncation (I5), error table sync (I6), plurals (S1), half verified (S2), NL error (S3). Section 10/8 deferred to F053/F054 |
| 2026-03-29 | F058 — Strategic Plan Archival & Rate-Limit Decision Documentation | aa212bc (worktree commit) | Simple docs. Plan marked historical, verification confirmed, ADR-013 (dual rate-limit) + ADR-014 (portion multiplier split) added to decisions.md |
| 2026-03-29 | F052 — Restaurant Selection chainSlug Propagation | a317aa0 (squash merge to develop, PR #47) | Simple bug. searchResults enriched with chainSlug, sel: + create_rest propagate, backward compat. 6 new tests, 1085 total. 7 files changed |
| 2026-03-29 | F053 — Decouple Menu Analysis from Restaurant Selection | 700dbc5 (squash merge to develop, PR #48) | Simple bug. Removed selectedRestaurant guard from handlePhoto(). Adaptive keyboard (Option B). 8 new tests, 3 updated, 1093 total. 6 files changed |
| 2026-03-29 | F054 — Context State Isolation & NL Footer Consistency | fb9d63b (squash merge to develop, PR #49) | Simple bug. I3: manual TTL description fix (Option B). I4: NL handler "Contexto activo" footer. 4 new tests, 1097 total. 3 files changed |
| 2026-03-29 | F055 — Inline Keyboard Stale-Button Mitigation + Callback Logging | c086e6e (squash merge to develop, PR #51) | Simple bug. Nonce in callback_data, stale-button rejection, unknown callback logging. 9 new tests, 6 updated, 1106 total. 9 files changed |
| 2026-03-30 | F056 — MIME Detection Fallback Safety | fd5a793 (squash merge to develop, PR #52) | Simple bug. Reject unknown MIME instead of JPEG fallback. 3 new tests, 1109 total. 4 files changed |
| 2026-03-30 | F063 — Nav, A/B Cookie & Variant Fixes | dcb04b9 (squash merge to develop, PR #55) | Standard frontend. Nav FAQ link (#para-quien→#faq), variant cookie on mount (ePrivacy Art.5.3), Secure flag on all cookie writes. 625 tests (20 new). Code review: APPROVED. QA: VERIFIED |
| 2026-03-30 | F065 — McDonald's Chain Slug Migration | 380a982 (squash merge to develop, PR #56) | Simple data fix. Rename `mcdonalds` → `mcdonalds-es`/`mcdonalds-pt`. Prisma migration + seed update. Applied to dev+prod Supabase |
| 2026-03-30 | F064 — Accessibility & Code Cleanup | ff25635 (squash merge to develop, PR #58) | Standard frontend. 10 fixes: aria-selected, contrast (WCAG AA), MobileMenu a11y, HSTS, CSP-Report-Only, dead code, honeypot, keyframes, themeColor, sitemap. 659 tests (35 new). Code review: APPROVED (1 fix). QA: VERIFIED (10 edge-case tests, 0 bugs) |
| 2026-03-30 | F066 — E2E Smoke Tests | d0e63f3 (squash merge to develop, PR #57) | Standard. 10 E2E smoke tests with real HTTP server (port 0). vitest.config.e2e.ts, NODE_ENV=development. Code review + QA approved |
| 2026-03-31 | F067 — Data Quality Cleanup | 6513e09 (squash merge to develop, PR #59) | Simple. Clean BK leading slashes (regexp_replace), FTS/similarity length tiebreaker in catalog + level1Lookup. Applied to dev+prod |
| 2026-04-06 | F080 — OFF Prepared Foods Ingestion | 4ce08a0 (squash merge to develop, PR #72) | Standard. OFF ingestion module (types, validator, mapper, client). L1 branded + Tier 3 fallback. ODbL attribution. Brand aliases. 146 tests (8 files). Data import pending (OFF API 503) |
| 2026-04-07 | F081 — Health-Hacker Chain Suggestions | a884e57 (squash merge to develop, PR #73) | Simple. Rule-based calorie-saving tips for chain dishes. 13 chains → 5 categories. enrichWithTips() DRY helper. HealthHackerTipSchema. 41 tests (3 files). Code review: APPROVED |
| 2026-04-07 | F087 — "El Tupper" Meal Prep | 1ae778c (squash merge to develop, PR #80) | Simple. Optional `portions` param on POST /calculate/recipe (1-50). `perPortion` nutrients. Bot tupper extraction (3 regex patterns). 33 tests. Code review: APPROVED |
| 2026-04-07 | F089 — "Modo Tapeo" (shared portions) | ef5dbe6 (squash merge to develop, PR #81) | Simple. Diners extraction (4 regex patterns, cap 20). `diners` + `perPerson` in MenuEstimationData. Per-person formatter line. 22 tests. Code review: APPROVED |
| 2026-04-08 | BUG-AUDIT-C1C3 — Fix `/reverse-search` error envelope | f994f83 (squash merge to develop, PR #82) | Simple bugfix. Standardized 404 CHAIN_NOT_FOUND + 400 validation to project error envelope. 6 new tests. Code review: APPROVED |

---

## Notes

- Day 0 setup executed on 2026-03-10
- Phase 1 target: 6 weeks, 100 users, 10 chains, <3s response, <0.05€/query
- FEN PDF source for F006 seed: https://www.fen.org.es/storage/app/media/imgPublicaciones/2018/libro-la-alimentacion-espanola.pdf
