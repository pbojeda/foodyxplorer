# Context Recovery — nutriXplorer (foodXPlorer) — 2026-04-04 (F074 Complete)

## Project State

- **Branch:** develop (clean working tree)
- **Last commit:** b927035 — docs: complete F074 — update tracker, clear active session
- **Previous commits:** e9f4f41 (F074 merged, PR #66), 7a16931 (context prompt post-F073)
- **SDD DevFlow version:** 0.13.2
- **Autonomy Level:** L2 (Trusted) — Plan Approval + Merge Approval require user confirmation
- **Branching:** gitflow — develop (integration) + main (production) + feature/*
- **develop ahead of main by 10 commits** (F071 + F072 + F073 + F074 not yet in main)

## Workflow

- Follow SDD development workflow (`.claude/skills/development-workflow/SKILL.md`)
- Read CLAUDE.md section 2 for autonomy level
- Read `docs/project_notes/key_facts.md` for branching strategy

## Active Feature

**No active work.** F074 complete. Ready for **next feature in Phase A1** (F075-F079).

## CRITICAL: Product Evolution Analysis

**Before starting ANY feature F068-F109, you MUST read:**
`docs/research/product-evolution-analysis-2026-03-31.md`

This document (1500+ lines, 4 iterations, reviewed by Claude + Gemini + Codex) contains ALL approved decisions, architecture, data source strategy, voice architecture notes, and rationale for every planned feature. **Do NOT invent requirements — derive them from that document.**

## Session Summary — What Was Done Today (2026-04-04)

### F074 — L4 Cooking State Extraction (DONE, PR #66)
- **Problem solved:** Strategy B (L4 ingredient decomposition) lost per-ingredient cooking state, and yield correction was never applied (per_serving referenceBasis skips Guard 2 in applyYield). This caused 2-3x caloric errors on grains/legumes.
- **Solution:** Modified Strategy B prompt to extract `state` and `cookingMethod` per ingredient. Applied yield correction per ingredient inside Strategy B (while nutrients are still per_100g) before aggregation into per_serving.
- **Key changes:**
  - `level4Lookup.ts`: Updated prompt (7 canonical methods: boiled, steamed, pressure_cooked, grilled, baked, fried, roasted), parsing with validation against `CANONICAL_COOKING_METHODS` and `VALID_COOKING_STATES` sets, per-ingredient yield block with precedence chain, aggregate yieldAdjustment computation
  - `engineRouter.ts`: Extended `Level4LookupFn` type (prisma, cookingState, cookingMethod in options; perIngredientYieldApplied + yieldAdjustment in return), bypass applyYield when perIngredientYieldApplied=true
  - `cookingProfile.ts` (shared): Added `llm_extracted` to CookingStateSourceSchema, `per_ingredient_yield_applied` to YieldAdjustmentReasonSchema
- **Precedence chain:** explicit API params > LLM-extracted > food group defaults
- **cookingStateSource computed externally** — resolveAndApplyYield always returns 'explicit' when we pass a state, so F074 computes the correct source outside and overrides it
- **Aggregate yieldAdjustment:** Dominant ingredient = highest raw calorie contribution (before yield). Determines cookingState, cookingMethod, yieldFactor. `applied` = OR across ingredients. `cookingStateSource` = highest precedence across ingredients.
- **No schema migration, no new API endpoints, no new tables**
- **Reviews:** Spec (Gemini+Codex, 9 issues fixed), Plan (Gemini+Codex, 8 issues fixed), Production validator (1 MEDIUM fixed), Code review (APPROVED, 3 findings fixed), QA (12 edge cases, 2 bugs fixed)
- **Bugs fixed:** BUG-F074-01 (logger error→warn adapter, fixed), BUG-F074-02 (runStrategyA return type missing rawFoodGroup, pre-existing from F072, fixed)
- **28 F074 tests** (16 unit + 12 QA edge cases) + 1 engine router test. All pass.

## Phase A0 + A1 Progress

| Feature | Status | PR | Tests Added |
|---------|--------|-----|-------------|
| **F068** Provenance Graph | **done** | #60 | +36 |
| **F069** Anonymous Identity | **done** | #61 | +25 |
| **F070** Conversation Core | **done** | #62 | +129 |
| **F071** BEDCA Import | **done** | #63 | +74 |
| **F072** Cooking Profiles | **done** | #64 | +194 |
| **F073** Spanish Canonical Dishes | **done** | #65 | +69 |
| **F074** L4 Cooking State Extraction | **done** | #66 | +29 |

## Phase A1 Roadmap (Remaining)

| ID | Feature | Days | Depends On | Notes |
|----|---------|------|------------|-------|
| **F075** | Audio Input (Whisper → ConversationCore) | 3-4 | F070 ✅ | Telegram voice → Whisper → ConversationCore |
| **F076** | "Modo menú del día" | 2-3 | F073 ✅ | primero + segundo + postre + bebida |
| **F077** | Alcohol nutrient support | 2 | F071 ✅ | Add alcohol field (7 kcal/g). BEDCA has alcohol data |
| **F078** | Regional aliases + "Modo España Real" | 2 | F073 ✅ | caña=cerveza, pintxo=tapa, media ración=0.5x |
| **F079** | Demand-driven expansion pipeline | 2 | F073 ✅ | Monitor /estimate null queries, monthly batch add top 20 |

## Backend Architecture (Updated)

- **Stack:** Fastify + Prisma + Kysely + PostgreSQL 16 (pgvector, pg_trgm) + Redis
- **Deploy:** Render (staging: develop, prod: main) + Supabase + Upstash
- **Estimation cascade:** L1 (official, priority_tier ordered) → L2 (ingredients) → L3 (pgvector) → L4 (LLM)
- **L4 Strategy B (F074):** Extracts per-ingredient state+method from LLM. Applies yield per ingredient before aggregation. Precedence: explicit > llm_extracted > default.
- **Yield correction:** `resolveAndApplyYield()` after cascade (L1-L3, Strategy A) or per-ingredient inside Strategy B (F074)
- **Identity:** actors table (anonymous_web / telegram / authenticated), X-Actor-Id header, per-actor rate limits
- **Provenance:** priority_tier on data_sources (0=brand, 1=national, 2=international, 3=estimated)
- **Conversation:** ConversationCore pipeline in packages/api/src/conversation/. POST /conversation/message. Bot = thin adapter.
- **BEDCA:** XML parser + nutrient mapper in packages/api/src/ingest/bedca/. Feature flag `BEDCA_IMPORT_ENABLED`.
- **Cooking profiles:** 60 entries in cooking_profiles table. Yield factors. Fat absorption for frying.
- **Cocina Española:** 250 dishes in virtual restaurant `cocina-espanola`. BEDCA Tier 1 + recipe-estimated Tier 3.
- **19 Prisma migrations** up to `cooking_profiles_f072` (no new migration for F073 or F074)
- **ADRs:** 16 total (ADR-000 through ADR-016)
- **Chains:** 14 active + 1 virtual (cocina-espanola)

## Bot Architecture

- **Stack:** node-telegram-bot-api + ApiClient (HTTP) + Redis state
- **NL handler (F070):** Thin adapter → `apiClient.processMessage(text, chatId, legacyChainContext)` → switch on intent → format with existing MarkdownV2 formatters
- **Commands:** /estimar, /comparar, /receta, /restaurante, /contexto, /cadenas, /start, /ayuda
- **Features:** File upload (photo/document), menu analysis, portion-aware, conversational context

## Test Baseline (Updated)

| Package | Tests | Notes |
|---------|-------|-------|
| API | 2511 passing (143 files) | Vitest. +29 from F074 (16 unit + 12 QA + 1 router) |
| Bot | 1103 | All pass |
| Shared | 413 | All pass |
| Scraper | 232 | All pass |
| Landing | 659 | Jest + RTL |
| API E2E | 10 | Real HTTP server (excluded from default run) |
| **Total** | **~4918** | |

## CI/CD Notes

- **Integration tests excluded** from default vitest run (migration.*, seed.*, routes/ingest/*, routes/quality) — run with `vitest.integration.config.ts`
- **dist/** excluded from vitest (CJS import errors)
- **test-api, test-bot, test-shared, test-scraper** all green in CI
- **6 pre-existing TS errors** (from F071/F072: engineRouter, level4Lookup, recipeCalculate, seedPhaseBedca) — BUG-F074-02 fixed runStrategyA return type

## Known Technical Debt

1. **Code duplication (AD-F070-3):** Pure functions exist in both bot and API packages. Will self-resolve when bot commands migrate to ConversationCore.
2. **EstimationOrchestrator DI inconsistency:** Uses `cacheGet`/`cacheSet` singleton Redis instead of injected Redis.
3. **BEDCA placeholder IDs:** F071 uses 20 placeholder foods. Real BEDCA import (~431 foods) pending AESAN authorization.
4. **develop → main sync pending:** F071+F072+F073+F074 merged to develop but not yet in main (10 commits ahead).
5. **Pre-existing TS errors:** From F071/F072. Fewer now after BUG-F074-02 fix.
6. **F073 category field:** `category` in JSON is metadata only — not persisted to DishDishCategory junction table. Deferred for future use.
7. **F074 aggregation loop duplication:** Two paths (corrected vs raw) in Strategy B aggregation. Accepted — avoids premature abstraction.
8. **F035 parseRecipeFreeForm.ts:** Uses similar LLM decomposition but lacks per-ingredient cooking state. Separate ticket needed to align with F074.

## Key Files to Read First

| File | Purpose |
|------|---------|
| `docs/research/product-evolution-analysis-2026-03-31.md` | **READ FIRST** — All Phase 2 decisions |
| `docs/project_notes/product-tracker.md` | Active Session + feature tables |
| `docs/project_notes/key_facts.md` | Stack, data sources, modules, endpoints |
| `docs/project_notes/decisions.md` | ADR-000 through ADR-016 |
| `.claude/skills/development-workflow/SKILL.md` | SDD workflow steps |
| `CLAUDE.md` | Autonomy level, session recovery |
| `packages/api/src/estimation/level4Lookup.ts` | F074 — L4 with per-ingredient yield |
| `packages/api/src/estimation/engineRouter.ts` | Engine cascade router (F074 bypass) |
| `packages/api/src/estimation/applyYield.ts` | F072 — yield orchestrator (9 reasons) |
| `packages/api/src/estimation/yieldUtils.ts` | F072 — pure utility functions |
| `packages/api/src/conversation/conversationCore.ts` | F070 — 5-step NL pipeline |
| `docs/tickets/F074-l4-cooking-state-extraction.md` | F074 ticket — full spec + plan + reviews |

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

1. **develop → main sync pending** — F071+F072+F073+F074 merged to develop but not yet in main (10 commits). Deploy when ready.
2. **Start next Phase A1 feature** — F075 (Audio Input, Standard) through F079 (Demand-Driven, Simple). All dependencies met.
3. **Ask user** which feature to start next.

## Workflow Recovery

- **Current step:** No active feature
- **Pending checkpoints:** None
- **Next action:** Ask user which Phase A1 feature to start next. Use `start task F0XX`.

---
Generated: 2026-04-04 after F074 complete. Phase A1 in progress (F071-F074 done, F075-F079 pending).
