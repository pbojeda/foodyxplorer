# Context Recovery — nutriXplorer (foodXPlorer) — 2026-04-04 (Phase A0+A1 Complete, Docs Updated, Main Synced)

## Project State

- **Branch:** develop (clean working tree)
- **Last commit:** ee6dbb2 — docs: update README, user manual, and .env for Phase A0+A1 completion
- **Previous commits:** 7ade676 (context prompt F079), 08a4f9f (tracker cleared), d56551e (F079 merged PR #71)
- **SDD DevFlow version:** 0.13.2
- **Autonomy Level:** L2 (Trusted) — Plan Approval + Merge Approval require user confirmation
- **Branching:** gitflow — develop (integration) + main (production) + feature/*
- **develop ahead of main by 1 commit** (documentation update only — main was synced at c8e2f0b with all 26 F071-F079 commits)

## Workflow

- Follow SDD development workflow (`.claude/skills/development-workflow/SKILL.md`)
- Read CLAUDE.md section 2 for autonomy level
- Read `docs/project_notes/key_facts.md` for branching strategy

## Active Feature

**No active work.** Phase A0 (E006) + Phase A1 (E007) fully complete. All 12 features done (F068-F079). Main synced. Docs updated. Ready for **Phase B** (E008 — F080+).

## CRITICAL: Product Evolution Analysis

**Before starting ANY feature F068-F109, you MUST read:**
`docs/research/product-evolution-analysis-2026-03-31.md`

This document (1500+ lines, 4 iterations, reviewed by Claude + Gemini + Codex) contains ALL approved decisions, architecture, data source strategy, voice architecture notes, and rationale for every planned feature. **Do NOT invent requirements — derive them from that document.**

## Session Summary — What Was Done (2026-04-04)

### Features Completed Today
- **F077** — Alcohol Nutrient Support (PR #69, +19 tests)
- **F078** — Regional Aliases + "Modo Espana Real" (PR #70, +22 tests)
- **F079** — Demand-Driven Dish Expansion Pipeline (PR #71, +76 tests)

### Infrastructure Actions
- **develop → main sync** — 26 commits (F071-F079) merged to main at c8e2f0b. Pushed to origin/main for production deploy.
- **Documentation audit** — README.md, user-manual-bot.md, .env.example all updated for Phase A0+A1 completion. Verified with internal audit + Gemini CLI cross-review.

### Documentation Updated
- **README.md** — Complete rewrite: added F068-F079 features, voice/menu/cocina-espanola/alcohol sections, updated test count (~5188), migration count (21), chain count (14+1 virtual), Phase roadmap (A0/A1/B/C/D)
- **docs/user-manual-bot.md** — Added 4 new sections: voice input (F075), menu del dia (F076), cocina espanola + aliases (F073/F078), alcohol support (F077). Added /menu to command reference.
- **.env.example** — Added F075 voice documentation note

## Phase A0 + A1 Progress — ALL COMPLETE

| Feature | Status | PR | Tests |
|---------|--------|-----|-------|
| **F068** Provenance Graph | done | #60 | +36 |
| **F069** Anonymous Identity | done | #61 | +25 |
| **F070** Conversation Core | done | #62 | +129 |
| **F071** BEDCA Import | done | #63 | +74 |
| **F072** Cooking Profiles | done | #64 | +194 |
| **F073** Spanish Canonical Dishes | done | #65 | +69 |
| **F074** L4 Cooking State Extraction | done | #66 | +29 |
| **F075** Audio Input (Whisper) | done | #67 | +71 |
| **F076** Menu del Dia | done | #68 | +72 |
| **F077** Alcohol Nutrient Support | done | #69 | +19 |
| **F078** Regional Aliases | done | #70 | +22 |
| **F079** Demand-Driven Expansion | done | #71 | +76 |

## Phase B Roadmap (Next)

> **Phase B: Value features that work WITHOUT auth**

| ID | Feature | Days | Depends On | Type | Notes |
|----|---------|------|------------|------|-------|
| **F080** | OFF Prepared Foods Ingestion | 3-4 | F068 ✅ | Standard | Open Food Facts Hacendado/Mercadona (~11K). Tier 0 branded, Tier 3 fallback. ODbL attribution |
| **F081** | "Health-Hacker" Chain Suggestions | 2 | F073 ✅ | Simple | Modification-based suggestions for chain dishes |
| **F082** | Nutritional Substitutions | 2 | F073 ✅ | Simple | Compare alternatives for dish components |
| **F083** | Allergen Cross-Reference | 2 | F071 ✅ | Simple | Ingredient-level allergen detection |
| **F084** | Estimation with Uncertainty Ranges | 2 | — | Simple | Show ranges instead of single number |
| **F085** | Portion Sizing Matrix | 2 | F073 ✅ | Simple | Standard Spanish portions |
| **F086** | Reverse Search | 3 | F073 ✅ | Standard | "Que como con X kcal?" |
| **F087** | "El Tupper" Meal Prep | 2 | — | Simple | Divide recipe by N portions |
| **F088** | Community Inline Corrections | 3 | — | Standard | "Calculo incorrecto" button |
| **F089** | "Modo Tapeo" | 2 | — | Simple | Shared portions / N people |

## Epics Overview

| Epic | Name | Status | Features |
|------|------|--------|----------|
| E001 | Infrastructure & Schema | done | F001-F006 |
| E002 | Data Ingestion Pipeline | done | F007-F019 |
| E003 | Estimation Engine | done | F020-F024 |
| E004 | Telegram Bot + Public API | done (partial — F030 pending) | F025-F032 |
| E005 | Advanced Analysis & UX | done | F033-F037 |
| **E006** | **Structural Foundations (Phase A0)** | **done** | **F068-F070** |
| **E007** | **Spanish Food Coverage (Phase A1)** | **done** | **F071-F079** |
| E008 | Conversational Assistant & Voice (Phase B+C) | pending | F080-F097 |
| E009 | Personalization & Tracking | pending | F098-F099 |
| E010 | Scale & Monetization (Phase D) | pending | F100-F109 |

## Backend Architecture

- **Stack:** Fastify + Prisma + Kysely + PostgreSQL 16 (pgvector, pg_trgm) + Redis
- **Deploy:** Render (staging: develop, prod: main) + Supabase + Upstash
- **Estimation cascade:** L1 (official, priority_tier ordered) → L2 (ingredients) → L3 (pgvector) → L4 (LLM)
- **L1/L2 exact match (F078):** Matches on `d.name` + `d.name_es` + `d.aliases @> ARRAY[query]` (GIN-indexed). Serving-format prefixes stripped before cascade.
- **Nutrients:** 15 standard fields + referenceBasis: calories, proteins, carbohydrates, sugars, fats, saturatedFats, fiber, salt, sodium, transFats, cholesterol, potassium, monounsaturatedFats, polyunsaturatedFats, alcohol
- **L4 Strategy B (F074):** Extracts per-ingredient state+method from LLM. Applies yield per ingredient before aggregation.
- **Voice (F075):** `POST /conversation/audio` — multipart OGG → Whisper → ConversationCore. Bot `handleVoice` with guards.
- **Menu del Dia (F076):** `menu_estimation` intent in ConversationCore (Step 3.5). Parallel estimation via `Promise.allSettled`, aggregated totals.
- **Alcohol (F077):** `alcohol Decimal(8,2) DEFAULT 0` in food_nutrients + dish_nutrients. BEDCA ALC → standard field.
- **Demand-Driven Expansion (F079):** `missed_query_tracking` table. GET /analytics/missed-queries + POST track + POST :id/status.
- **Identity:** actors table (anonymous_web / telegram / authenticated), X-Actor-Id header, per-actor rate limits
- **Provenance:** priority_tier on data_sources (0=brand, 1=national, 2=international, 3=estimated)
- **Conversation:** ConversationCore in packages/api/src/conversation/. POST /conversation/message + POST /conversation/audio. Bot = thin adapter. 5 intents: context_set, comparison, menu_estimation, estimation, text_too_long.
- **BEDCA:** XML parser + nutrient mapper in packages/api/src/ingest/bedca/. Feature flag `BEDCA_IMPORT_ENABLED`.
- **Cooking profiles:** 60 entries in cooking_profiles table. Yield factors. Fat absorption for frying.
- **Cocina Espanola:** 250 dishes in virtual restaurant `cocina-espanola`. BEDCA Tier 1 + recipe-estimated Tier 3. 250+ aliases all queryable.
- **21 Prisma migrations** up to `missed_query_tracking_f079`
- **ADRs:** 16 total (ADR-000 through ADR-016)
- **Chains:** 14 active + 1 virtual (cocina-espanola)

## API Endpoints (Complete)

### Public
| Method | Path | Feature | Description |
|--------|------|---------|-------------|
| GET | /health | F004 | Health check (?db=true, ?redis=true) |
| GET | /estimate | F020 | Estimation cascade (L1→L4) with caching |
| GET | /dishes | F025 | List dishes (filter by chain/restaurant) |
| GET | /chains | F025 | List chains with dish counts |
| GET | /restaurants | F025 | List restaurants |
| GET | /foods | F025 | List foods |
| POST | /calculate/recipe | F035 | Recipe calculation (structured + free-form) |
| POST | /conversation/message | F070 | NL conversation (5 intents) |
| POST | /conversation/audio | F075 | Voice → Whisper → conversation |
| POST | /restaurants | F032 | Create restaurant (trigram search) |
| POST | /waitlist | F046 | Waitlist signup |
| GET | /waitlist/count | F047 | Waitlist count |

### Admin (require ADMIN_API_KEY)
| Method | Path | Feature | Description |
|--------|------|---------|-------------|
| POST | /ingest/pdf | F007b | PDF upload ingestion |
| POST | /ingest/url | F007c | URL scrape ingestion |
| POST | /ingest/pdf-url | F009 | PDF download + ingest |
| POST | /ingest/image-url | F012 | Image OCR ingestion |
| POST | /ingest/image | F031 | Image upload ingestion |
| POST | /analyze/menu | F034 | Menu photo/PDF analysis |
| GET | /quality/report | F018 | Data quality report |
| POST | /embeddings/generate | F019 | Embedding generation |
| GET | /analytics/queries | F029 | Query log analytics |
| GET | /analytics/missed-queries | F079 | Top missed queries |
| POST | /analytics/missed-queries/track | F079 | Batch track missed queries |
| POST | /analytics/missed-queries/:id/status | F079 | Update tracking status |
| GET | /admin/waitlist | F046 | Admin waitlist view |

## Bot Commands
| Command | Feature | Description |
|---------|---------|-------------|
| /estimar | F027 | Estimate dish nutrients |
| /comparar | F043 | Compare two dishes |
| /receta | F041 | Calculate recipe nutrients |
| /menu | F076 | Multi-dish meal estimation |
| /restaurante | F032 | Search/create restaurant |
| /restaurantes | F025 | List restaurants |
| /cadenas | F025 | List chains |
| /platos | F025 | List dishes |
| /buscar | F025 | Search dishes |
| /contexto | F037 | Chain context (set/view/clear) |
| /info | F027 | System status |
| /start /help | F027 | Help |
| [voice message] | F075 | Whisper transcription → any intent |
| [photo/document] | F031/F034 | Menu analysis / data upload |

## Test Baseline

| Package | Tests | Files | Notes |
|---------|-------|-------|-------|
| API | 2710 | 151 | Vitest. +76 from F079 |
| Bot | 1143 | 56 | Unchanged |
| Shared | 434 | 13 | Unchanged |
| Scraper | 232 | — | All pass |
| Landing | 659 | — | Jest + RTL |
| API E2E | 10 | 1 | Real HTTP server (excluded from default run) |
| **Total** | **~5188** | — | All passing |

## CI/CD Notes

- **Integration tests excluded** from default vitest run (migration.*, seed.*, routes/ingest/*, routes/quality)
- **dist/** excluded from vitest (CJS import errors)
- **Pre-existing TS errors** in seedPhaseBedca.ts and recipeCalculate.ts (not F079-related)
- **Render auto-deploy:** staging from develop, production from main

## Known Technical Debt (16 items)

1. Code duplication (AD-F070-3) — pure functions in bot + API
2. Response formatting duplication (F075) — voice.ts and naturalLanguage.ts
3. Query logging duplication (F075) — logAudioQueryAfterReply copy-paste
4. EstimationOrchestrator DI inconsistency — singleton Redis
5. BEDCA placeholder IDs (F071) — 20 placeholder foods, real import pending AESAN auth
6. ~~develop → main sync pending~~ — **RESOLVED** (synced 2026-04-04)
7. F073 category field — metadata only, not persisted to junction table
8. F074 aggregation loop duplication — two paths in Strategy B
9. F035 parseRecipeFreeForm.ts — lacks per-ingredient cooking state
10. Static hallucination list (F075) — 8 hardcoded strings
11. parseDishExpression double call (F076)
12. Null-estimate factory duplication (F076)
13. Comparison formatter missing alcohol (F077)
14. Recipe formatter missing alcohol (F077)
15. L4 resolveIngredientByName missing alias matching (F078)
16. timeRangeInterval duplication (F079) — analytics.ts and missedQueries.ts

## Key Files to Read First

| File | Purpose |
|------|---------|
| `docs/research/product-evolution-analysis-2026-03-31.md` | **READ FIRST** — All Phase 2 decisions |
| `docs/project_notes/product-tracker.md` | Active Session + feature tables |
| `docs/project_notes/key_facts.md` | Stack, data sources, modules, endpoints |
| `docs/project_notes/decisions.md` | ADR-000 through ADR-016 |
| `.claude/skills/development-workflow/SKILL.md` | SDD workflow steps |
| `CLAUDE.md` | Autonomy level, session recovery |
| `README.md` | Updated project overview (Phase A0+A1) |
| `docs/user-manual-bot.md` | Updated bot manual (voice, menu, cocina espanola) |
| `packages/api/src/routes/missedQueries.ts` | F079 — expansion pipeline endpoints |
| `packages/api/src/conversation/conversationCore.ts` | F070+F076 — 5-step NL pipeline |
| `packages/api/src/estimation/level1Lookup.ts` | F078 — Alias matching |

## User Preferences

- Senior developer — pragmatic YAGNI, no over-engineering
- Communication in Spanish, all code/docs/commits in English
- After feature completion, wants /context-prompt
- Complete ALL ticket sections before requesting merge approval
- SDD workflow mandatory for all features
- Cross-model reviews with Gemini CLI (`gemini`) and Codex CLI (`codex exec -`)
- Likes detailed progress summaries at milestones
- **Extended autonomy for Phase A1:** User authorized proceeding through Spec → Plan → Implement without stopping at intermediate checkpoints (only stop at Merge Approval which is mandatory in L2). Ask at the start of each feature if same autonomy applies.

## Pending Actions

1. **Start Phase B** — F080 (OFF Prepared Foods Ingestion) is the next feature. All dependencies met.
2. **Documentation gap: CONTRIBUTING.md** — Developer onboarding guide doesn't exist. Not blocking but recommended before Phase B.
3. **Documentation gap: Package READMEs** — No per-workspace READMEs. Low priority.
4. **Epics status in tracker** — E006 and E007 still show "in-progress"/"pending" in Phase 2 Epics table. Should be updated to "done".

## Workflow Recovery

- **Current step:** No active feature
- **Pending checkpoints:** None
- **Next action:** Ask user which Phase B feature to start (F080 recommended) or if there are other priorities.

---
Generated: 2026-04-04 after Phase A0+A1 complete, main synced, docs updated. Phase B ready.
