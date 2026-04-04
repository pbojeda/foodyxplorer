# Context Recovery — nutriXplorer (foodXPlorer) — 2026-04-04 (F078 Complete)

## Project State

- **Branch:** develop (clean working tree)
- **Last commit:** 857a9aa — docs: complete F078 — update tracker, clear active session
- **Previous commits:** 19728bf (F078 merged, PR #70), 479542f (context prompt post-F077)
- **SDD DevFlow version:** 0.13.2
- **Autonomy Level:** L2 (Trusted) — Plan Approval + Merge Approval require user confirmation
- **Branching:** gitflow — develop (integration) + main (production) + feature/*
- **develop ahead of main by 22 commits** (F071–F078 not yet in main)

## Workflow

- Follow SDD development workflow (`.claude/skills/development-workflow/SKILL.md`)
- Read CLAUDE.md section 2 for autonomy level
- Read `docs/project_notes/key_facts.md` for branching strategy

## Active Feature

**No active work.** F078 complete. Ready for **last feature in Phase A1** (F079).

## CRITICAL: Product Evolution Analysis

**Before starting ANY feature F068-F109, you MUST read:**
`docs/research/product-evolution-analysis-2026-03-31.md`

This document (1500+ lines, 4 iterations, reviewed by Claude + Gemini + Codex) contains ALL approved decisions, architecture, data source strategy, voice architecture notes, and rationale for every planned feature. **Do NOT invent requirements — derive them from that document.**

## Session Summary — What Was Done Today (2026-04-04)

### F077 — Alcohol Nutrient Support (DONE, PR #69)
- Promoted alcohol to first-class nutrient field (`Decimal(8,2) DEFAULT 0`) across entire pipeline
- 89 files changed, 19 new tests, 20th Prisma migration
- See `docs/tickets/F077-alcohol-nutrient-support.md` for full details

### F078 — Regional Aliases + "Modo España Real" (DONE, PR #70)
- **Problem solved:** 250+ dish aliases existed in DB (`aliases TEXT[]`, GIN-indexed) but were never queried in the estimation cascade. Users typing "bravas", "bocata de jamón", "tortilla española", "caña" etc. would miss exact matches and fall to FTS/similarity.
- **Solution:** Three changes:
  1. **SQL alias matching:** Added `d.aliases @> ARRAY[normalizedQuery]` to L1 Strategy 1 (exactDishMatch), L1 Strategy 3 (exactFoodMatch), and L2 Strategy 1 (exactIngredientDishMatch). Also added `d.name_es` exact matching to L1 S1 and L2 S1 (was English-only).
  2. **Serving-format prefix stripping:** New `SERVING_FORMAT_PATTERNS` constant in entityExtractor.ts — 5 patterns: `tapa(s) de`, `pincho(s) de`, `pintxo(s) de`, `ración/racion de`, `raciones de`. Applied in both `extractFoodQuery()` and `parseDishExpression()`.
  3. **Data fix:** Lowercased 2 aliases in spanish-dishes.json ("mollete de Antequera" → lowercase, "torrezno de Soria" → lowercase) — `@>` operator is case-sensitive.
- **Key changes:**
  - `level1Lookup.ts`: +name_es exact + aliases @> in Strategy 1 (exactDishMatch) and +aliases @> in Strategy 3 (exactFoodMatch)
  - `level2Lookup.ts`: +name_es exact + aliases @> in Strategy 1 (exactIngredientDishMatch)
  - `entityExtractor.ts`: +SERVING_FORMAT_PATTERNS (exported), applied in extractFoodQuery() and parseDishExpression()
  - `spanish-dishes.json`: 2 aliases lowercased
  - `f078.regional-aliases.unit.test.ts`: 22 new tests (prefix stripping + SQL structural verification + regression)
- **No new API endpoints, no schema changes, no migration** — purely query-resolution improvements
- **Reviews:** Production validator (READY, 0 issues), Code review (Approved, 1 important out of scope → tech debt #15)
- **22 F078 tests.** All pass.

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
| **F077** Alcohol Nutrient Support | **done** | #69 | +19 |
| **F078** Regional Aliases | **done** | #70 | +22 |

## Phase A1 Roadmap (Remaining)

| ID | Feature | Days | Depends On | Notes |
|----|---------|------|------------|-------|
| **F079** | Demand-driven expansion pipeline | 2 | F073 ✅ | Monitor /estimate null queries, monthly batch add top 20 |

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
- **Identity:** actors table (anonymous_web / telegram / authenticated), X-Actor-Id header, per-actor rate limits
- **Provenance:** priority_tier on data_sources (0=brand, 1=national, 2=international, 3=estimated)
- **Conversation:** ConversationCore pipeline in packages/api/src/conversation/. POST /conversation/message + POST /conversation/audio. Bot = thin adapter. 5 intents: context_set, comparison, menu_estimation, estimation, text_too_long.
- **BEDCA:** XML parser + nutrient mapper in packages/api/src/ingest/bedca/. Feature flag `BEDCA_IMPORT_ENABLED`. 14 standard tagnames mapped (including ALC → alcohol).
- **Cooking profiles:** 60 entries in cooking_profiles table. Yield factors. Fat absorption for frying.
- **Cocina Española:** 250 dishes in virtual restaurant `cocina-espanola`. BEDCA Tier 1 + recipe-estimated Tier 3. 250+ aliases all queryable (F078).
- **20 Prisma migrations** up to `alcohol_nutrient_f077`
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

## Entity Extraction Pipeline (Updated, F078)

**File:** `packages/api/src/conversation/entityExtractor.ts`

Flow for single-dish estimation (ConversationCore Step 4):
1. `extractPortionModifier(text)` → `{ cleanQuery, portionMultiplier }` — handles "media ración", "doble", "grande", etc.
2. `extractFoodQuery(cleanQuery)` → `{ query, chainSlug? }`:
   - Strip ¿¡ and ?!
   - Extract chain slug (last " en " + valid slug)
   - Strip PREFIX_PATTERNS (12 patterns: "cuántas calorías tiene", "qué lleva", etc.)
   - Strip ARTICLE_PATTERN (un/una/el/la/los/las/del/al)
   - **F078:** Strip SERVING_FORMAT_PATTERNS (5 patterns: tapa(s)/pincho(s)/pintxo(s)/ración(es) de)
3. Estimation cascade with resolved `query`

Flow for comparison (ConversationCore Step 3):
1. `extractComparisonQuery(text)` → `{ dishA, dishB, nutrientFocus? }`
2. For each side: `parseDishExpression(dish)` → `{ query, chainSlug?, portionMultiplier }`
   - Strip chain slug, articles, **F078: serving-format prefixes**, portion modifiers

## Test Baseline (Updated)

| Package | Tests | Notes |
|---------|-------|-------|
| API | 2634 passing (150 files) | Vitest. +22 from F078 |
| Bot | 1143 (56 files) | Unchanged |
| Shared | 434 | Unchanged |
| Scraper | 232 | All pass |
| Landing | 659 | Jest + RTL |
| API E2E | 10 | Real HTTP server (excluded from default run) |
| **Total** | **~5102** | +22 from F078 |

## CI/CD Notes

- **Integration tests excluded** from default vitest run (migration.*, seed.*, routes/ingest/*, routes/quality)
- **dist/** excluded from vitest (CJS import errors)
- **Pre-existing TS errors** in seedPhaseBedca.ts and recipeCalculate.ts (not F078-related)

## Known Technical Debt

1. **Code duplication (AD-F070-3):** Pure functions exist in both bot and API packages. Will self-resolve when bot commands migrate to ConversationCore.
2. **Response formatting duplication (F075):** voice.ts and naturalLanguage.ts share the same intent→format switch. Same deferred resolution as #1.
3. **Query logging duplication (F075):** `logAudioQueryAfterReply` is ~100 lines copy-pasted from `logQueryAfterReply`.
4. **EstimationOrchestrator DI inconsistency:** Uses `cacheGet`/`cacheSet` singleton Redis instead of injected Redis.
5. **BEDCA placeholder IDs:** F071 uses 20 placeholder foods. Real BEDCA import (~431 foods) pending AESAN authorization.
6. **develop → main sync pending:** F071-F078 merged to develop but not yet in main (22 commits ahead).
7. **F073 category field:** `category` in JSON is metadata only — not persisted to DishDishCategory junction table.
8. **F074 aggregation loop duplication:** Two paths (corrected vs raw) in Strategy B aggregation.
9. **F035 parseRecipeFreeForm.ts:** Uses similar LLM decomposition but lacks per-ingredient cooking state.
10. **Static hallucination list (F075):** 8 hardcoded strings. Acceptable for v1.
11. **parseDishExpression double call (F076):** Called once for estimation, once for usedContextFallback. Overhead minimal (pure function, max 8 items).
12. **Null-estimate factory duplication (F076):** Same shape in comparison step and menu step of conversationCore.ts.
13. **Comparison formatter missing alcohol (F077):** comparisonFormatter.ts NUTRIENT_ROWS and NUTRIENT_FOCUS_MAP don't include alcohol. Low priority.
14. **Recipe formatter missing alcohol (F077):** recipeFormatter.ts doesn't show alcohol in totals. Low priority.
15. **L4 resolveIngredientByName missing alias matching (F078):** `level4Lookup.ts` exact food match doesn't include `f.aliases @>`. Out of F078 scope (L4 uses LLM-generated names, not user input). Low priority.

## Key Files to Read First

| File | Purpose |
|------|---------|
| `docs/research/product-evolution-analysis-2026-03-31.md` | **READ FIRST** — All Phase 2 decisions |
| `docs/project_notes/product-tracker.md` | Active Session + feature tables |
| `docs/project_notes/key_facts.md` | Stack, data sources, modules, endpoints |
| `docs/project_notes/decisions.md` | ADR-000 through ADR-016 |
| `.claude/skills/development-workflow/SKILL.md` | SDD workflow steps |
| `CLAUDE.md` | Autonomy level, session recovery |
| `packages/api/src/conversation/entityExtractor.ts` | F078 — SERVING_FORMAT_PATTERNS + extraction pipeline |
| `packages/api/src/estimation/level1Lookup.ts` | F078 — Alias @> matching in exact strategies |
| `packages/api/src/estimation/level2Lookup.ts` | F078 — Alias @> matching in exact strategy |
| `packages/api/src/conversation/conversationCore.ts` | F070+F076 — 5-step NL pipeline + menu Step 3.5 |
| `packages/shared/src/schemas/estimate.ts` | F077 — EstimateNutrientsSchema (16 fields + referenceBasis) |
| `docs/tickets/F078-regional-aliases.md` | F078 ticket — full spec + reviews |

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

1. **develop → main sync pending** — F071-F078 merged to develop but not yet in main (22 commits). Deploy when ready.
2. **Start last Phase A1 feature** — F079 (Demand-Driven Expansion Pipeline, Simple). All dependencies met.
3. **Ask user** whether to start F079 or if Phase A1 is complete enough for deploy.

## Workflow Recovery

- **Current step:** No active feature
- **Pending checkpoints:** None
- **Next action:** Ask user whether to start F079 (last A1 feature) or proceed to develop → main sync + deploy.

---
Generated: 2026-04-04 after F078 complete. Phase A1 nearly done (F071-F078 done, F079 pending).
