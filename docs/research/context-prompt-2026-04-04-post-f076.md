# Context Recovery — nutriXplorer (foodXPlorer) — 2026-04-04 (F076 Complete)

## Project State

- **Branch:** develop (clean working tree)
- **Last commit:** cd18b8d — docs: complete F076 — update tracker, clear active session
- **Previous commits:** 1ad5f17 (F076 merged, PR #68), c738b5f (context prompt post-F075)
- **SDD DevFlow version:** 0.13.2
- **Autonomy Level:** L2 (Trusted) — Plan Approval + Merge Approval require user confirmation
- **Branching:** gitflow — develop (integration) + main (production) + feature/*
- **develop ahead of main by 16 commits** (F071 + F072 + F073 + F074 + F075 + F076 not yet in main)

## Workflow

- Follow SDD development workflow (`.claude/skills/development-workflow/SKILL.md`)
- Read CLAUDE.md section 2 for autonomy level
- Read `docs/project_notes/key_facts.md` for branching strategy

## Active Feature

**No active work.** F076 complete. Ready for **next feature in Phase A1** (F077-F079).

## CRITICAL: Product Evolution Analysis

**Before starting ANY feature F068-F109, you MUST read:**
`docs/research/product-evolution-analysis-2026-03-31.md`

This document (1500+ lines, 4 iterations, reviewed by Claude + Gemini + Codex) contains ALL approved decisions, architecture, data source strategy, voice architecture notes, and rationale for every planned feature. **Do NOT invent requirements — derive them from that document.**

## Session Summary — What Was Done Today (2026-04-04)

### F076 — "Modo Menú del Día" — Multi-dish Meal Estimation (DONE, PR #68)
- **Problem solved:** Spain's most common eating-out scenario (menú del día: primero + segundo + postre + bebida) couldn't be logged as a complete meal. Users had to estimate each dish individually.
- **Solution:** New `menu_estimation` intent in ConversationCore (Step 3.5 in the NL pipeline). Users input multiple dishes, each estimated independently in parallel, with aggregated nutritional totals.
- **Key changes:**
  - `menuDetector.ts` (NEW): Pure function `detectMenuQuery()` — 5 accent-insensitive regex patterns, comma-only splitting (` y `/` más ` only when no commas — BUG-F076-01 fix), noise filter (prices/€/digits — BUG-F076-02 fix), max 8 items, min 2 items
  - `conversationCore.ts`: Step 3.5 between comparison (Step 3) and single-dish (Step 4) — `detectMenuQuery()` → `parseDishExpression()` per item → `estimate()` via `Promise.allSettled` → `aggregateMenuTotals()` → `menu_estimation` intent. Includes `usedContextFallback` for context footer.
  - `menuEstimation.ts` (shared, NEW): `MenuEstimationTotalsSchema` (14 nutrients), `MenuEstimationItemSchema`, `MenuEstimationDataSchema`
  - `conversation.ts` (shared): Added `menu_estimation` to `ConversationIntentSchema`, `menuEstimation` field to `ConversationMessageDataSchema`
  - `conversation.ts` (route): `menu_estimation` query logging branch in both `/conversation/message` and `/conversation/audio`
  - `menuFormatter.ts` (bot, NEW): `formatMenuEstimate()` — per-item compact cards + bold totals row + match count + lowest confidence
  - `menu.ts` (bot command, NEW): `handleMenu()` — prepends "menú: " to args, delegates to `processMessage()`
  - `naturalLanguage.ts` + `voice.ts`: Added `menu_estimation` case to intent switch
  - `bot.ts`: Wired `/menu` command, added to `KNOWN_COMMANDS`
  - `api-spec.yaml`: +121 lines — `MenuEstimationItem`, `MenuEstimationTotals`, `MenuEstimationData` schemas, `menu_estimation` intent, `text_too_long` intent fix
- **No schema migration, no new API endpoints, no new tables**
- **Reviews:** Spec (Gemini+Codex, 10 issues fixed), Plan (Gemini, 6 issues fixed), Production validator (1 CRITICAL fixed), Code review (APPROVED, 1 fix), QA (2 bugs found and fixed)
- **Bugs fixed:** BUG-F076-01 (compound dish name split when commas present — "sopa, arroz y verduras" was incorrectly split into 3 items), BUG-F076-02 (bare "€" not filtered by noise regex)
- **72 F076 tests** (34 detector + 11 aggregation + 15 schema + 6 formatter + 6 command). All pass.

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
| **F075** Audio Input (Whisper) | **done** | #67 | +71 |
| **F076** Menú del Día | **done** | #68 | +72 |

## Phase A1 Roadmap (Remaining)

| ID | Feature | Days | Depends On | Notes |
|----|---------|------|------------|-------|
| **F077** | Alcohol nutrient support | 2 | F071 ✅ | Add alcohol field (7 kcal/g). BEDCA has alcohol data |
| **F078** | Regional aliases + "Modo España Real" | 2 | F073 ✅ | caña=cerveza, pintxo=tapa, media ración=0.5x |
| **F079** | Demand-driven expansion pipeline | 2 | F073 ✅ | Monitor /estimate null queries, monthly batch add top 20 |

## Backend Architecture (Updated)

- **Stack:** Fastify + Prisma + Kysely + PostgreSQL 16 (pgvector, pg_trgm) + Redis
- **Deploy:** Render (staging: develop, prod: main) + Supabase + Upstash
- **Estimation cascade:** L1 (official, priority_tier ordered) → L2 (ingredients) → L3 (pgvector) → L4 (LLM)
- **L4 Strategy B (F074):** Extracts per-ingredient state+method from LLM. Applies yield per ingredient before aggregation.
- **Voice (F075):** `POST /conversation/audio` — multipart OGG → Whisper → ConversationCore. Bot `handleVoice` with guards.
- **Menú del Día (F076):** `menu_estimation` intent in ConversationCore (Step 3.5). `detectMenuQuery()` in `menuDetector.ts` — accent-insensitive, comma-split, noise filter, max 8 items. Bot `/menu` command. Parallel estimation via `Promise.allSettled`, aggregated totals (14 nutrients). When commas are present, ` y `/` más ` inside items is preserved (not treated as separator).
- **Identity:** actors table (anonymous_web / telegram / authenticated), X-Actor-Id header, per-actor rate limits
- **Provenance:** priority_tier on data_sources (0=brand, 1=national, 2=international, 3=estimated)
- **Conversation:** ConversationCore pipeline in packages/api/src/conversation/. POST /conversation/message + POST /conversation/audio. Bot = thin adapter. 5 intents: context_set, comparison, menu_estimation, estimation, text_too_long.
- **BEDCA:** XML parser + nutrient mapper in packages/api/src/ingest/bedca/. Feature flag `BEDCA_IMPORT_ENABLED`.
- **Cooking profiles:** 60 entries in cooking_profiles table. Yield factors. Fat absorption for frying.
- **Cocina Española:** 250 dishes in virtual restaurant `cocina-espanola`. BEDCA Tier 1 + recipe-estimated Tier 3.
- **19 Prisma migrations** up to `cooking_profiles_f072` (no new migration for F073-F076)
- **ADRs:** 16 total (ADR-000 through ADR-016)
- **Chains:** 14 active + 1 virtual (cocina-espanola)

## Bot Architecture (Updated)

- **Stack:** node-telegram-bot-api + ApiClient (HTTP) + Redis state
- **NL handler (F070):** Thin adapter → `apiClient.processMessage(text, chatId, legacyChainContext)` → switch on intent → format with existing MarkdownV2 formatters
- **Voice handler (F075):** Thin adapter → guards → download → `apiClient.sendAudio()` → same intent switch + formatters
- **Menu handler (F076):** `/menu` command → prepends "menú: " → `processMessage()` → `formatMenuEstimate()`. NL/voice also detect menu patterns via ConversationCore.
- **Commands:** /estimar, /comparar, /receta, /restaurante, /contexto, /cadenas, /menu, /start, /ayuda
- **Features:** File upload (photo/document), menu analysis, portion-aware, conversational context, voice input, multi-dish menu estimation

## Test Baseline (Updated)

| Package | Tests | Notes |
|---------|-------|-------|
| API | 2602 passing (148 files) | Vitest. +45 from F075 baseline (34 detector + 11 aggregation) |
| Bot | 1140 (55 files) | +12 from F075 baseline (6 formatter + 6 command) |
| Shared | 428 | +15 from F075 baseline (15 schema) |
| Scraper | 232 | All pass |
| Landing | 659 | Jest + RTL |
| API E2E | 10 | Real HTTP server (excluded from default run) |
| **Total** | **~5061** | +72 from F076 |

## CI/CD Notes

- **Integration tests excluded** from default vitest run (migration.*, seed.*, routes/ingest/*, routes/quality)
- **dist/** excluded from vitest (CJS import errors)
- **Pre-existing TS errors** in seedPhaseBedca.ts and recipeCalculate.ts (not F076-related)

## Known Technical Debt

1. **Code duplication (AD-F070-3):** Pure functions exist in both bot and API packages. Will self-resolve when bot commands migrate to ConversationCore.
2. **Response formatting duplication (F075):** voice.ts and naturalLanguage.ts share the same intent→format switch. Same deferred resolution as #1.
3. **Query logging duplication (F075):** `logAudioQueryAfterReply` is ~100 lines copy-pasted from `logQueryAfterReply`.
4. **EstimationOrchestrator DI inconsistency:** Uses `cacheGet`/`cacheSet` singleton Redis instead of injected Redis.
5. **BEDCA placeholder IDs:** F071 uses 20 placeholder foods. Real BEDCA import (~431 foods) pending AESAN authorization.
6. **develop → main sync pending:** F071-F076 merged to develop but not yet in main (16 commits ahead).
7. **F073 category field:** `category` in JSON is metadata only — not persisted to DishDishCategory junction table.
8. **F074 aggregation loop duplication:** Two paths (corrected vs raw) in Strategy B aggregation.
9. **F035 parseRecipeFreeForm.ts:** Uses similar LLM decomposition but lacks per-ingredient cooking state.
10. **Static hallucination list (F075):** 8 hardcoded strings. Acceptable for v1.
11. **parseDishExpression double call (F076):** Called once for estimation, once for usedContextFallback. Overhead minimal (pure function, max 8 items).
12. **Null-estimate factory duplication (F076):** Same shape in comparison step and menu step of conversationCore.ts.

## Key Files to Read First

| File | Purpose |
|------|---------|
| `docs/research/product-evolution-analysis-2026-03-31.md` | **READ FIRST** — All Phase 2 decisions |
| `docs/project_notes/product-tracker.md` | Active Session + feature tables |
| `docs/project_notes/key_facts.md` | Stack, data sources, modules, endpoints |
| `docs/project_notes/decisions.md` | ADR-000 through ADR-016 |
| `.claude/skills/development-workflow/SKILL.md` | SDD workflow steps |
| `CLAUDE.md` | Autonomy level, session recovery |
| `packages/api/src/conversation/menuDetector.ts` | F076 — Menu detection + item splitting |
| `packages/api/src/conversation/conversationCore.ts` | F070+F076 — 5-step NL pipeline + menu Step 3.5 |
| `packages/shared/src/schemas/menuEstimation.ts` | F076 — Menu Zod schemas |
| `packages/bot/src/formatters/menuFormatter.ts` | F076 — Bot menu formatter |
| `packages/bot/src/commands/menu.ts` | F076 — /menu bot command |
| `packages/api/src/routes/conversation.ts` | F070+F075+F076 — conversation routes + logging |
| `docs/tickets/F076-modo-menu-del-dia.md` | F076 ticket — full spec + plan + reviews |

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

1. **develop → main sync pending** — F071-F076 merged to develop but not yet in main (16 commits). Deploy when ready.
2. **Start next Phase A1 feature** — F077 (Alcohol, Simple), F078 (Regional Aliases, Simple), or F079 (Demand-Driven, Simple). All dependencies met.
3. **Ask user** which feature to start next.

## Workflow Recovery

- **Current step:** No active feature
- **Pending checkpoints:** None
- **Next action:** Ask user which Phase A1 feature to start next. Use `start task F0XX`.

---
Generated: 2026-04-04 after F076 complete. Phase A1 in progress (F071-F076 done, F077-F079 pending).
