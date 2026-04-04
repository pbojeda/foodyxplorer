# Context Recovery — nutriXplorer (foodXPlorer) — 2026-04-04 (F079 Complete)

## Project State

- **Branch:** develop (clean working tree)
- **Last commit:** 08a4f9f — docs: complete F079 — update tracker, clear active session
- **Previous commits:** d56551e (F079 merged, PR #71), 95ad1a1 (context prompt post-F078)
- **SDD DevFlow version:** 0.13.2
- **Autonomy Level:** L2 (Trusted) — Plan Approval + Merge Approval require user confirmation
- **Branching:** gitflow — develop (integration) + main (production) + feature/*
- **develop ahead of main by 25 commits** (F071–F079 not yet in main)

## Workflow

- Follow SDD development workflow (`.claude/skills/development-workflow/SKILL.md`)
- Read CLAUDE.md section 2 for autonomy level
- Read `docs/project_notes/key_facts.md` for branching strategy

## Active Feature

**No active work.** F079 complete. **Phase A0 + A1 fully complete.** Ready for Phase B (F080+).

## CRITICAL: Product Evolution Analysis

**Before starting ANY feature F068-F109, you MUST read:**
`docs/research/product-evolution-analysis-2026-03-31.md`

This document (1500+ lines, 4 iterations, reviewed by Claude + Gemini + Codex) contains ALL approved decisions, architecture, data source strategy, voice architecture notes, and rationale for every planned feature. **Do NOT invent requirements — derive them from that document.**

## Session Summary — What Was Done Today (2026-04-04)

### F077 — Alcohol Nutrient Support (DONE, PR #69)
- Promoted alcohol to first-class nutrient field across entire pipeline
- 89 files changed, 19 new tests, 20th Prisma migration

### F078 — Regional Aliases + "Modo España Real" (DONE, PR #70)
- Alias SQL matching (`d.aliases @> ARRAY[query]`) in L1/L2 exact strategies
- `name_es` exact matching added to L1 S1 and L2 S1
- Serving-format prefix stripping (tapa/pincho/pintxo/ración)
- 2 alias case fixes in seed data. 22 new tests.

### F079 — Demand-Driven Dish Expansion Pipeline (DONE, PR #71)
- **Problem solved:** No mechanism to track which queries users ask that we can't answer. Estimation cascade misses (level_hit IS NULL) were logged but not surfaced or actionable.
- **Solution:** Three components:
  1. **`missed_query_tracking` table** (21st Prisma migration) — Tracks disposition: `pending` (new gap), `resolved` (dish added), `ignored` (not food/spam). UNIQUE on query_text, FK to dishes, index on status.
  2. **`GET /analytics/missed-queries`** — Top N missed queries aggregated from query_logs WHERE level_hit IS NULL. LEFT JOIN tracking for status. Filters: LENGTH >= 3, HAVING count >= minCount, timeRange, topN. Parallel queries via Promise.all.
  3. **`POST /analytics/missed-queries/track`** — Batch upsert (max 100) tracking entries. Idempotent via Prisma upsert on queryText. Atomic via $transaction.
  4. **`POST /analytics/missed-queries/:id/status`** — Update status (resolve/ignore). findUnique outside try/catch (code review fix: 404 not swallowed as 500).
- **Key files:**
  - `packages/api/src/routes/missedQueries.ts` — 3 route handlers
  - `packages/shared/src/schemas/missedQueries.ts` — 8 Zod schemas (including BatchTrackBodySchema)
  - `packages/api/prisma/migrations/20260404200000_missed_query_tracking_f079/migration.sql`
  - `packages/api/src/__tests__/f079.missed-queries.unit.test.ts` — 76 tests
- **Reviews:** Production validator (2 HIGH + 5 MEDIUM → all fixed), Code review (1 critical + 2 important → all fixed)
- **76 F079 tests.** All pass.

## Phase A0 + A1 Progress — COMPLETE

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
| **F077** Alcohol Nutrient Support | **done** | #69 | +19 |
| **F078** Regional Aliases | **done** | #70 | +22 |
| **F079** Demand-Driven Expansion | **done** | #71 | +76 |

## Phase B Roadmap (Next)

> **Phase B: Value features that work WITHOUT auth**

| ID | Feature | Days | Depends On | Notes |
|----|---------|------|------------|-------|
| **F080** | OFF Prepared Foods Ingestion | 3-4 | F068 ✅ | Open Food Facts Hacendado/Mercadona (~11K). Tier 0 branded, Tier 3 fallback. ODbL attribution |
| **F081** | "Health-Hacker" Chain Suggestions | 2 | F073 ✅ | Modification-based suggestions for chain dishes |
| **F082** | Nutritional Substitutions | 2 | F073 ✅ | Compare alternatives for dish components |
| **F083** | Allergen Cross-Reference | 2 | F071 ✅ | Ingredient-level allergen detection |
| **F084** | Estimation with Uncertainty Ranges | 2 | — | Show ranges instead of single number |
| **F085** | Portion Sizing Matrix | 2 | F073 ✅ | Standard Spanish portions |
| **F086** | Reverse Search | 3 | F073 ✅ | "¿qué como con X kcal?" |
| **F087** | "El Tupper" Meal Prep | 2 | — | Divide recipe by N portions |
| **F088** | Community Inline Corrections | 3 | — | "Cálculo incorrecto" button |
| **F089** | "Modo Tapeo" | 2 | — | Shared portions ÷ N people |

## Backend Architecture (Updated)

- **Stack:** Fastify + Prisma + Kysely + PostgreSQL 16 (pgvector, pg_trgm) + Redis
- **Deploy:** Render (staging: develop, prod: main) + Supabase + Upstash
- **Estimation cascade:** L1 (official, priority_tier ordered) → L2 (ingredients) → L3 (pgvector) → L4 (LLM)
- **L1/L2 exact match (F078):** Matches on `d.name` + `d.name_es` + `d.aliases @> ARRAY[query]` (GIN-indexed). Serving-format prefixes stripped before cascade.
- **Nutrients:** 15 standard fields + referenceBasis: calories, proteins, carbohydrates, sugars, fats, saturatedFats, fiber, salt, sodium, transFats, cholesterol, potassium, monounsaturatedFats, polyunsaturatedFats, alcohol (F077)
- **L4 Strategy B (F074):** Extracts per-ingredient state+method from LLM. Applies yield per ingredient before aggregation.
- **Voice (F075):** `POST /conversation/audio` — multipart OGG → Whisper → ConversationCore. Bot `handleVoice` with guards.
- **Menú del Día (F076):** `menu_estimation` intent in ConversationCore (Step 3.5). Parallel estimation via `Promise.allSettled`, aggregated totals (15 nutrients).
- **Alcohol (F077):** `alcohol Decimal(8,2) DEFAULT 0` in food_nutrients + dish_nutrients. BEDCA ALC → standard field. Bot shows 🍺 when > 0.
- **Demand-Driven Expansion (F079):** `missed_query_tracking` table (pending/resolved/ignored). GET /analytics/missed-queries + POST track + POST :id/status. Admin-only.
- **Identity:** actors table (anonymous_web / telegram / authenticated), X-Actor-Id header, per-actor rate limits
- **Provenance:** priority_tier on data_sources (0=brand, 1=national, 2=international, 3=estimated)
- **Conversation:** ConversationCore pipeline in packages/api/src/conversation/. POST /conversation/message + POST /conversation/audio. Bot = thin adapter. 5 intents: context_set, comparison, menu_estimation, estimation, text_too_long.
- **BEDCA:** XML parser + nutrient mapper in packages/api/src/ingest/bedca/. Feature flag `BEDCA_IMPORT_ENABLED`. 14 standard tagnames mapped (including ALC → alcohol).
- **Cooking profiles:** 60 entries in cooking_profiles table. Yield factors. Fat absorption for frying.
- **Cocina Española:** 250 dishes in virtual restaurant `cocina-espanola`. BEDCA Tier 1 + recipe-estimated Tier 3. 250+ aliases all queryable (F078).
- **21 Prisma migrations** up to `missed_query_tracking_f079`
- **ADRs:** 16 total (ADR-000 through ADR-016)
- **Chains:** 14 active + 1 virtual (cocina-espanola)

## Bot Architecture (Updated)

- **Stack:** node-telegram-bot-api + ApiClient (HTTP) + Redis state
- **NL handler (F070):** Thin adapter → `apiClient.processMessage(text, chatId, legacyChainContext)` → switch on intent → format with existing MarkdownV2 formatters
- **Voice handler (F075):** Thin adapter → guards → download → `apiClient.sendAudio()` → same intent switch + formatters
- **Menu handler (F076):** `/menu` command → prepends "menú: " → `processMessage()` → `formatMenuEstimate()`. NL/voice also detect menu patterns via ConversationCore.
- **Estimate formatter (F077):** Shows 🍺 Alcohol when alcohol > 0 (conditional, like fiber/sodium/salt)
- **Commands:** /estimar, /comparar, /receta, /restaurante, /contexto, /cadenas, /menu, /start, /ayuda
- **Features:** File upload (photo/document), menu analysis, portion-aware, conversational context, voice input, multi-dish menu estimation, alcohol display

## Test Baseline (Updated)

| Package | Tests | Notes |
|---------|-------|-------|
| API | 2710 passing (151 files) | Vitest. +76 from F079 |
| Bot | 1143 (56 files) | Unchanged |
| Shared | 434 | Unchanged |
| Scraper | 232 | All pass |
| Landing | 659 | Jest + RTL |
| API E2E | 10 | Real HTTP server (excluded from default run) |
| **Total** | **~5188** | +76 from F079 |

## CI/CD Notes

- **Integration tests excluded** from default vitest run (migration.*, seed.*, routes/ingest/*, routes/quality)
- **dist/** excluded from vitest (CJS import errors)
- **Pre-existing TS errors** in seedPhaseBedca.ts and recipeCalculate.ts (not F079-related)

## Known Technical Debt

1. **Code duplication (AD-F070-3):** Pure functions exist in both bot and API packages. Will self-resolve when bot commands migrate to ConversationCore.
2. **Response formatting duplication (F075):** voice.ts and naturalLanguage.ts share the same intent→format switch. Same deferred resolution as #1.
3. **Query logging duplication (F075):** `logAudioQueryAfterReply` is ~100 lines copy-pasted from `logQueryAfterReply`.
4. **EstimationOrchestrator DI inconsistency:** Uses `cacheGet`/`cacheSet` singleton Redis instead of injected Redis.
5. **BEDCA placeholder IDs:** F071 uses 20 placeholder foods. Real BEDCA import (~431 foods) pending AESAN authorization.
6. **develop → main sync pending:** F071-F079 merged to develop but not yet in main (25 commits ahead).
7. **F073 category field:** `category` in JSON is metadata only — not persisted to DishDishCategory junction table.
8. **F074 aggregation loop duplication:** Two paths (corrected vs raw) in Strategy B aggregation.
9. **F035 parseRecipeFreeForm.ts:** Uses similar LLM decomposition but lacks per-ingredient cooking state.
10. **Static hallucination list (F075):** 8 hardcoded strings. Acceptable for v1.
11. **parseDishExpression double call (F076):** Called once for estimation, once for usedContextFallback. Overhead minimal (pure function, max 8 items).
12. **Null-estimate factory duplication (F076):** Same shape in comparison step and menu step of conversationCore.ts.
13. **Comparison formatter missing alcohol (F077):** comparisonFormatter.ts NUTRIENT_ROWS and NUTRIENT_FOCUS_MAP don't include alcohol. Low priority.
14. **Recipe formatter missing alcohol (F077):** recipeFormatter.ts doesn't show alcohol in totals. Low priority.
15. **L4 resolveIngredientByName missing alias matching (F078):** `level4Lookup.ts` exact food match doesn't include `f.aliases @>`. Out of F078 scope (L4 uses LLM-generated names, not user input). Low priority.
16. **timeRangeInterval duplication (F079):** Same function in analytics.ts and missedQueries.ts. Low priority.

## Key Files to Read First

| File | Purpose |
|------|---------|
| `docs/research/product-evolution-analysis-2026-03-31.md` | **READ FIRST** — All Phase 2 decisions |
| `docs/project_notes/product-tracker.md` | Active Session + feature tables |
| `docs/project_notes/key_facts.md` | Stack, data sources, modules, endpoints |
| `docs/project_notes/decisions.md` | ADR-000 through ADR-016 |
| `.claude/skills/development-workflow/SKILL.md` | SDD workflow steps |
| `CLAUDE.md` | Autonomy level, session recovery |
| `packages/api/src/routes/missedQueries.ts` | F079 — 3 expansion pipeline endpoints |
| `packages/shared/src/schemas/missedQueries.ts` | F079 — 8 Zod schemas |
| `packages/api/src/conversation/conversationCore.ts` | F070+F076 — 5-step NL pipeline + menu Step 3.5 |
| `packages/api/src/estimation/level1Lookup.ts` | F078 — Alias @> matching in exact strategies |
| `docs/tickets/F079-demand-driven-expansion.md` | F079 ticket — full spec + reviews |

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

1. **develop → main sync pending** — F071-F079 merged to develop but not yet in main (25 commits). Deploy when ready.
2. **Start Phase B** — F080 (OFF Prepared Foods Ingestion) is next. All dependencies met.
3. **Ask user** whether to start Phase B or proceed to develop → main sync + deploy first.

## Workflow Recovery

- **Current step:** No active feature
- **Pending checkpoints:** None
- **Next action:** Ask user whether to start Phase B (F080) or proceed to develop → main sync + deploy.

---
Generated: 2026-04-04 after F079 complete. Phase A0 + A1 fully done (F068-F079). Phase B ready.
