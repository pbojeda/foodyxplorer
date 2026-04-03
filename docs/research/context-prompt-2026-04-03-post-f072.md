# Context Recovery — nutriXplorer (foodXPlorer) — 2026-04-03 (F072 Complete)

## Project State

- **Branch:** develop (clean working tree)
- **Last commit:** 63947fa — docs: complete F072 — update tracker, clear active session
- **Previous commits:** 2960fb8 (F072 merged, PR #64), d3cceda (F071 cleanup), 7cd4fb9 (F071 merged, PR #63)
- **SDD DevFlow version:** 0.13.2
- **Autonomy Level:** L2 (Trusted) — Plan Approval + Merge Approval require user confirmation
- **Branching:** gitflow — develop (integration) + main (production) + feature/*
- **develop ahead of main by 4 commits** (F071 + F072 not yet in main)

## Workflow

- Follow SDD development workflow (`.claude/skills/development-workflow/SKILL.md`)
- Read CLAUDE.md section 2 for autonomy level
- Read `docs/project_notes/key_facts.md` for branching strategy

## Active Feature

**No active work.** F072 complete. Ready for **next feature in Phase A1** (F073-F079).

## CRITICAL: Product Evolution Analysis

**Before starting ANY feature F068-F109, you MUST read:**
`docs/research/product-evolution-analysis-2026-03-31.md`

This document (1500+ lines, 4 iterations, reviewed by Claude + Gemini + Codex) contains ALL approved decisions, architecture, data source strategy, voice architecture notes, and rationale for every planned feature. **Do NOT invent requirements — derive them from that document.**

## Session Summary — What Was Done Today (2026-04-03)

### CI Test Fixes (pre-feature work)
- Fixed 178 pre-existing test failures in test-api CI job
- Added `incr`/`expire` to Redis mocks in 28 route/edge-case test files (actorRateLimit F069)
- Fixed `priorityTier` assertions in 3 level lookup tests (F068)
- Separated DB-dependent integration tests to `vitest.integration.config.ts`
- Excluded `dist/` from vitest default run
- Merged develop → main (F068+F069+F070 now in production)

### F071 — BEDCA Food Database Import (DONE, PR #63, parallel session)
- BEDCA XML parser (`bedcaParser.ts`), nutrient mapper (`bedcaNutrientMapper.ts`)
- Seed script with 20 placeholder BEDCA foods (feature flag `BEDCA_IMPORT_ENABLED`)
- `fast-xml-parser` dependency added
- 74 new tests
- BUG-F071-01 found+fixed (Infinity in parseNutrientValue)

### F072 — Cooking Profiles + Yield Factors (DONE, PR #64)
- **New table:** `cooking_profiles` (60 seed entries, USDA retention factors)
  - `@@unique([foodGroup, foodName, cookingMethod])`, sentinel `'*'` for group defaults
  - Migration: `20260403140000_cooking_profiles_f072`
- **New service:** `cookingProfileService.ts` — `getCookingProfile()` with discriminated union return (`{ profile } | { error: 'invalid_yield_factor' } | null`)
- **New pure utils:** `yieldUtils.ts` — `normalizeFoodGroup()`, `getDefaultCookingMethod()`, `getDefaultCookingState()`, `isAlreadyCookedFood()`, `applyYieldFactor()`
- **New orchestrator:** `applyYield.ts` — `resolveAndApplyYield()` with 9 reason codes, 11 edge cases
- **API changes:**
  - `GET /estimate` gains `cookingState` + `cookingMethod` optional query params
  - `POST /calculate/recipe` gains per-ingredient `cookingState`/`cookingMethod`
  - Both responses include `yieldAdjustment` object
  - Cache key extended: `..:<cookingState>:<cookingMethod>`
- **Threading:** `food_group` added to `FoodQueryRow` and threaded through L1-L4 SQL queries → engine router
- **Shared schemas:** `packages/shared/src/schemas/cookingProfile.ts` — CookingState, YieldAdjustment, CookingProfile
- **Reviews:** Spec reviewed by Gemini+Codex (9 issues fixed). Plan reviewed by Gemini+Codex (8 issues fixed). Code review: 3 issues fixed (L4 rawFoodGroup, logger.error, cookingMethod min(1)). QA: BUG-F072-01 found+fixed (word-boundary regex). Production validator: 0 issues.
- **194 F072 tests** (shared 46, API 148). All pass.

## Phase A0 + A1 Progress

| Feature | Status | PR | Tests Added |
|---------|--------|-----|-------------|
| **F068** Provenance Graph | **done** | #60 | +36 |
| **F069** Anonymous Identity | **done** | #61 | +25 |
| **F070** Conversation Core | **done** | #62 | +129 |
| **F071** BEDCA Import | **done** | #63 | +74 |
| **F072** Cooking Profiles | **done** | #64 | +194 |

## Phase A1 Roadmap (Remaining)

| ID | Feature | Days | Depends On | Notes |
|----|---------|------|------------|-------|
| **F073** | Spanish Canonical Dishes (300) | 4-5 | F071 + F072 ✅ | ~300 dishes, BEDCA-first + LLM long tail, cocina-espanola virtual restaurant |
| **F074** | L4 Cooking State Extraction | 2-3 | F072 ✅ | Simple. LLM prompt enhancement to extract cooking state per ingredient |
| **F075** | Audio Input (Whisper → ConversationCore) | 3-4 | F070 ✅ | Telegram voice → Whisper → ConversationCore |
| **F076** | "Modo menú del día" | 2-3 | F073 | primero + segundo + postre + bebida |
| **F077** | Alcohol nutrient support | 2 | F071 ✅ | Add alcohol field (7 kcal/g). BEDCA has alcohol data |
| **F078** | Regional aliases + "Modo España Real" | 2 | F073 | caña=cerveza, pintxo=tapa, media ración=0.5x |
| **F079** | Demand-driven expansion pipeline | 2 | F073 | Monitor /estimate null queries, monthly batch add top 20 |

## Backend Architecture (Updated)

- **Stack:** Fastify + Prisma + Kysely + PostgreSQL 16 (pgvector, pg_trgm) + Redis
- **Deploy:** Render (staging: develop, prod: main) + Supabase + Upstash
- **Estimation cascade:** L1 (official, priority_tier ordered) → L2 (ingredients) → L3 (pgvector) → L4 (LLM)
- **Yield correction:** `resolveAndApplyYield()` after cascade — applies cooking profiles per food group/method
- **Identity:** actors table (anonymous_web / telegram / authenticated), X-Actor-Id header, per-actor rate limits
- **Provenance:** priority_tier on data_sources (0=brand, 1=national, 2=international, 3=estimated)
- **Conversation:** ConversationCore pipeline in packages/api/src/conversation/. POST /conversation/message. Bot = thin adapter.
- **BEDCA:** XML parser + nutrient mapper in packages/api/src/ingest/bedca/. Feature flag `BEDCA_IMPORT_ENABLED`.
- **Cooking profiles:** 60 entries in cooking_profiles table. Yield factors (grains 2.8x, meat 0.85x, etc.). Fat absorption for frying.
- **19 Prisma migrations** up to `cooking_profiles_f072`
- **ADRs:** 16 total (ADR-000 through ADR-016)
- **Chains:** 14 active (mcdonalds-es, burger-king-es, kfc-es, telepizza-es, etc.)

## Bot Architecture

- **Stack:** node-telegram-bot-api + ApiClient (HTTP) + Redis state
- **NL handler (F070):** Thin adapter → `apiClient.processMessage(text, chatId, legacyChainContext)` → switch on intent → format with existing MarkdownV2 formatters
- **Commands:** /estimar, /comparar, /receta, /restaurante, /contexto, /cadenas, /start, /ayuda
- **Features:** File upload (photo/document), menu analysis, portion-aware, conversational context

## Test Baseline (Updated)

| Package | Tests | Notes |
|---------|-------|-------|
| API | ~2413 passing (137 files) | Vitest. +194 from F072, +74 from F071 |
| Bot | 1103 | All pass |
| Shared | 412 | All pass. +46 from F072 |
| Scraper | 232 | All pass |
| Landing | 659 | Jest + RTL |
| API E2E | 10 | Real HTTP server (excluded from default run) |
| **Total** | **~4819** | |

## CI/CD Notes

- **Integration tests excluded** from default vitest run (migration.*, seed.*, routes/ingest/*, routes/quality) — run with `vitest.integration.config.ts`
- **dist/** excluded from vitest (CJS import errors)
- **test-api, test-bot, test-shared, test-scraper** all green in CI

## Known Technical Debt

1. **Code duplication (AD-F070-3):** Pure functions exist in both bot and API packages. Will self-resolve when bot commands migrate to ConversationCore.
2. **EstimationOrchestrator DI inconsistency:** Uses `cacheGet`/`cacheSet` singleton Redis instead of injected Redis.
3. **BEDCA placeholder IDs:** F071 uses 20 placeholder foods. Real BEDCA import (~431 foods) pending AESAN authorization.
4. **develop → main sync pending:** F071+F072 merged to develop but not yet in main.

## Key Files to Read First

| File | Purpose |
|------|---------|
| `docs/research/product-evolution-analysis-2026-03-31.md` | **READ FIRST** — All Phase 2 decisions |
| `docs/project_notes/product-tracker.md` | Active Session + feature tables |
| `docs/project_notes/key_facts.md` | Stack, data sources, modules, endpoints |
| `docs/project_notes/decisions.md` | ADR-000 through ADR-016 |
| `.claude/skills/development-workflow/SKILL.md` | SDD workflow steps |
| `CLAUDE.md` | Autonomy level, session recovery |
| `packages/api/src/estimation/yieldUtils.ts` | F072 — pure utility functions |
| `packages/api/src/estimation/applyYield.ts` | F072 — yield orchestrator (9 reasons) |
| `packages/api/src/estimation/cookingProfileService.ts` | F072 — DB lookup service |
| `packages/api/src/conversation/conversationCore.ts` | F070 — 5-step NL pipeline |
| `packages/api/src/routes/estimate.ts` | GET /estimate (cookingState/cookingMethod) |
| `packages/api/src/routes/recipeCalculate.ts` | POST /calculate/recipe |
| `docs/tickets/F072-cooking-profiles-yield-factors.md` | F072 ticket — full spec + plan + reviews |

## User Preferences

- Senior developer — pragmatic YAGNI, no over-engineering
- Communication in Spanish, all code/docs/commits in English
- After feature completion, wants /context-prompt
- Complete ALL ticket sections before requesting merge approval
- SDD workflow mandatory for all features
- Cross-model reviews with Gemini CLI (`gemini`) and Codex CLI (`codex exec -`)
- Likes detailed progress summaries at milestones — don't go silent during long agent work
- **Extended autonomy for Phase A1:** User authorized proceeding through Spec → Plan → Implement without stopping at intermediate checkpoints (only stop at Merge Approval which is mandatory in L2). Ask at the start of each feature if same autonomy applies.

## Pending Actions

1. **develop → main sync pending** — F071+F072 merged to develop but not yet in main. Deploy when ready.
2. **Start next Phase A1 feature** — F073 (Spanish Canonical Dishes) is the natural next step (depends on F071+F072, both done). Alternatively, F074 (L4 Cooking State Extraction, Simple) or F077 (Alcohol Nutrient Support, Simple) are smaller and could be done first.
3. **Ask user** which feature to start next.

## Workflow Recovery

- **Current step:** No active feature
- **Pending checkpoints:** None
- **Next action:** Ask user which Phase A1 feature to start next. Use `start task F0XX`.

---
Generated: 2026-04-03 after F072 complete. Phase A1 in progress (F071+F072 done, F073-F079 pending).
