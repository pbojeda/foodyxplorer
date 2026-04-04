# Context Recovery — nutriXplorer (foodXPlorer) — 2026-04-04 (F073 Complete)

## Project State

- **Branch:** develop (clean working tree)
- **Last commit:** e36f74a — docs: complete F073 — update tracker, clear active session
- **Previous commits:** eefaefd (F073 merged, PR #65), f83e57f (context prompt post-F072)
- **SDD DevFlow version:** 0.13.2
- **Autonomy Level:** L2 (Trusted) — Plan Approval + Merge Approval require user confirmation
- **Branching:** gitflow — develop (integration) + main (production) + feature/*
- **develop ahead of main by 6 commits** (F071 + F072 + F073 not yet in main)

## Workflow

- Follow SDD development workflow (`.claude/skills/development-workflow/SKILL.md`)
- Read CLAUDE.md section 2 for autonomy level
- Read `docs/project_notes/key_facts.md` for branching strategy

## Active Feature

**No active work.** F073 complete. Ready for **next feature in Phase A1** (F074-F079).

## CRITICAL: Product Evolution Analysis

**Before starting ANY feature F068-F109, you MUST read:**
`docs/research/product-evolution-analysis-2026-03-31.md`

This document (1500+ lines, 4 iterations, reviewed by Claude + Gemini + Codex) contains ALL approved decisions, architecture, data source strategy, voice architecture notes, and rationale for every planned feature. **Do NOT invent requirements — derive them from that document.**

## Session Summary — What Was Done Today (2026-04-04)

### F073 — Spanish Canonical Dishes (DONE, PR #65)
- **Virtual restaurant:** `cocina-espanola` (chainSlug='cocina-espanola', countryCode='ES')
- **250 Spanish dishes** in `packages/api/prisma/seed-data/spanish-dishes.json`
  - 46 BEDCA-sourced (confidenceLevel='high', estimationMethod='official', DishNutrient.sourceId=BEDCA Tier 1)
  - 204 recipe-estimated (confidenceLevel='medium', estimationMethod='ingredients', DishNutrient.sourceId=cocina-espanola-recipes Tier 3)
  - 10 categories: desayunos, tapas, primeros, segundos, arroces, bocadillos, postres, bebidas, combinados, guarniciones
- **Two DataSources for provenance:**
  - BEDCA (existing, `00000000-0000-0000-0000-000000000003`, Tier 1) — for BEDCA-sourced dish nutrients
  - `cocina-espanola-recipes` (new, `00000000-0000-e073-0000-000000000001`, Tier 3) — for recipe-estimated dish nutrients
- **Seed function:** `seedPhaseSpanishDishes.ts` — upserts DataSources, Restaurant, Dishes (batch 50), DishNutrients, zero-vector embeddings
- **Validation:** `validateSpanishDishes.ts` — ≥250 entries, uniqueness (externalId, dishId, nutrientId), UUID format, nutrient bounds, source/confidence consistency, name==nameEs, aliases array guard, null input guard
- **Types:** `spanishDishesTypes.ts` — SpanishDishEntry, SpanishDishNutrients, SpanishDishesFile
- **Deterministic UUIDs:** e073 namespace — dishes in `00000000-0000-e073-0007-*`, nutrients in `00000000-0000-e073-0008-*`
- **No API changes:** L1 cascade finds cocina-espanola dishes automatically via existing priority_tier ordering
- **No schema migration needed**
- **Reviews:** Spec reviewed by Gemini+Codex (8 issues fixed). Plan reviewed by Gemini+Codex (6 issues fixed). Production validator: 0 CRITICAL, 2 MEDIUM fixed. Code review: APPROVED. QA: 6 bugs found+fixed (BUG-F073-01 through 06).
- **69 F073 tests** (15 validation unit + 28 validation edge-cases + 21 seed edge-cases + 5 L1 lookup). All pass.

## Phase A0 + A1 Progress

| Feature | Status | PR | Tests Added |
|---------|--------|-----|-------------|
| **F068** Provenance Graph | **done** | #60 | +36 |
| **F069** Anonymous Identity | **done** | #61 | +25 |
| **F070** Conversation Core | **done** | #62 | +129 |
| **F071** BEDCA Import | **done** | #63 | +74 |
| **F072** Cooking Profiles | **done** | #64 | +194 |
| **F073** Spanish Canonical Dishes | **done** | #65 | +69 |

## Phase A1 Roadmap (Remaining)

| ID | Feature | Days | Depends On | Notes |
|----|---------|------|------------|-------|
| **F074** | L4 Cooking State Extraction | 2-3 | F072 ✅ | **Simple.** LLM prompt enhancement to extract cooking state per ingredient |
| **F075** | Audio Input (Whisper → ConversationCore) | 3-4 | F070 ✅ | Telegram voice → Whisper → ConversationCore |
| **F076** | "Modo menú del día" | 2-3 | F073 ✅ | primero + segundo + postre + bebida |
| **F077** | Alcohol nutrient support | 2 | F071 ✅ | Add alcohol field (7 kcal/g). BEDCA has alcohol data |
| **F078** | Regional aliases + "Modo España Real" | 2 | F073 ✅ | caña=cerveza, pintxo=tapa, media ración=0.5x |
| **F079** | Demand-driven expansion pipeline | 2 | F073 ✅ | Monitor /estimate null queries, monthly batch add top 20 |

## Backend Architecture (Updated)

- **Stack:** Fastify + Prisma + Kysely + PostgreSQL 16 (pgvector, pg_trgm) + Redis
- **Deploy:** Render (staging: develop, prod: main) + Supabase + Upstash
- **Estimation cascade:** L1 (official, priority_tier ordered) → L2 (ingredients) → L3 (pgvector) → L4 (LLM)
- **Yield correction:** `resolveAndApplyYield()` after cascade — applies cooking profiles per food group/method
- **Identity:** actors table (anonymous_web / telegram / authenticated), X-Actor-Id header, per-actor rate limits
- **Provenance:** priority_tier on data_sources (0=brand, 1=national, 2=international, 3=estimated)
- **Conversation:** ConversationCore pipeline in packages/api/src/conversation/. POST /conversation/message. Bot = thin adapter.
- **BEDCA:** XML parser + nutrient mapper in packages/api/src/ingest/bedca/. Feature flag `BEDCA_IMPORT_ENABLED`.
- **Cooking profiles:** 60 entries in cooking_profiles table. Yield factors. Fat absorption for frying.
- **Cocina Española:** 250 dishes in virtual restaurant `cocina-espanola`. BEDCA Tier 1 + recipe-estimated Tier 3. `seedPhaseSpanishDishes.ts`.
- **19 Prisma migrations** up to `cooking_profiles_f072` (no new migration for F073)
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
| API | 2482 passing (141 files) | Vitest. +69 from F073 |
| Bot | 1103 | All pass |
| Shared | 412 | All pass |
| Scraper | 232 | All pass |
| Landing | 659 | Jest + RTL |
| API E2E | 10 | Real HTTP server (excluded from default run) |
| **Total** | **~4888** | |

## CI/CD Notes

- **Integration tests excluded** from default vitest run (migration.*, seed.*, routes/ingest/*, routes/quality) — run with `vitest.integration.config.ts`
- **dist/** excluded from vitest (CJS import errors)
- **test-api, test-bot, test-shared, test-scraper** all green in CI
- **6 pre-existing TS errors** (from F071/F072: engineRouter, level4Lookup, recipeCalculate, seedPhaseBedca)

## Known Technical Debt

1. **Code duplication (AD-F070-3):** Pure functions exist in both bot and API packages. Will self-resolve when bot commands migrate to ConversationCore.
2. **EstimationOrchestrator DI inconsistency:** Uses `cacheGet`/`cacheSet` singleton Redis instead of injected Redis.
3. **BEDCA placeholder IDs:** F071 uses 20 placeholder foods. Real BEDCA import (~431 foods) pending AESAN authorization.
4. **develop → main sync pending:** F071+F072+F073 merged to develop but not yet in main.
5. **6 pre-existing TS errors:** From F071/F072. Not blocking tests or deployment.
6. **F073 category field:** `category` in JSON is metadata only — not persisted to DishDishCategory junction table. Deferred for future use.

## Key Files to Read First

| File | Purpose |
|------|---------|
| `docs/research/product-evolution-analysis-2026-03-31.md` | **READ FIRST** — All Phase 2 decisions |
| `docs/project_notes/product-tracker.md` | Active Session + feature tables |
| `docs/project_notes/key_facts.md` | Stack, data sources, modules, endpoints |
| `docs/project_notes/decisions.md` | ADR-000 through ADR-016 |
| `.claude/skills/development-workflow/SKILL.md` | SDD workflow steps |
| `CLAUDE.md` | Autonomy level, session recovery |
| `packages/api/src/scripts/seedPhaseSpanishDishes.ts` | F073 — seed function |
| `packages/api/src/scripts/validateSpanishDishes.ts` | F073 — seed validation |
| `packages/api/src/estimation/yieldUtils.ts` | F072 — pure utility functions |
| `packages/api/src/estimation/applyYield.ts` | F072 — yield orchestrator (9 reasons) |
| `packages/api/src/estimation/level4Lookup.ts` | L4 LLM lookup (F074 will modify this) |
| `packages/api/src/estimation/engineRouter.ts` | Engine cascade router |
| `packages/api/src/conversation/conversationCore.ts` | F070 — 5-step NL pipeline |
| `docs/tickets/F073-spanish-canonical-dishes.md` | F073 ticket — full spec + plan + reviews |

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

1. **develop → main sync pending** — F071+F072+F073 merged to develop but not yet in main. Deploy when ready.
2. **Start next Phase A1 feature** — F074 (L4 Cooking State Extraction, Simple) is the natural next step. Dependencies met (F072 done). Alternatively F076 (Menú del Día), F077 (Alcohol), or F078 (Regional Aliases) — all have dependencies met.
3. **Ask user** which feature to start next.

## Workflow Recovery

- **Current step:** No active feature
- **Pending checkpoints:** None
- **Next action:** Ask user which Phase A1 feature to start next. Use `start task F0XX`.

---
Generated: 2026-04-04 after F073 complete. Phase A1 in progress (F071+F072+F073 done, F074-F079 pending).
