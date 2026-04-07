# Context Recovery — nutriXplorer (foodXPlorer) — 2026-04-07 (Post-F086, Ready for F087+)

## Project State

- **Branch:** `develop` (clean working tree)
- **Last commit:** `da18ec9` — fix(test): resolve 4 F029 analytics test failures in CI (#79)
- **Previous:** `e67164d` — feat(api,bot): F086 reverse search (#78)
- **SDD DevFlow version:** 0.13.2
- **Autonomy Level:** L2 (Trusted) — Plan Approval + Merge Approval required
- **Branching:** gitflow — develop (integration) + main (production)
- **develop ahead of main** — F080-F086 + CI fix merged to develop, not yet synced to main

## What Was Just Completed (2026-04-07)

### Session Summary — 7 items completed

1. **F083** — Allergen Cross-Reference (Simple, PR #75). 14 EU allergen categories, `enrichWithAllergens()`. 50 tests.
2. **F084** — Uncertainty Ranges (Simple, PR #76). ±5%-±30% matrix. `enrichWithUncertainty()`. 26 tests.
3. **F085** — Portion Sizing Matrix (Simple, PR #77). 9 Spanish terms. `enrichWithPortionSizing()`. 30 tests.
4. **F086** — Reverse Search (Standard, PR #78). `GET /reverse-search` + `reverse_search` conversation intent. 136 tests. Code review: APPROVED. QA: VERIFIED (0 bugs, 66 edge case tests). 4 NL patterns added post-QA.
5. **CI fix** — F029 analytics test mocks (PR #79). Root cause: phantom init entries in Kysely mock fixtures (getKysely resets callIndex per call). Fixed 4 pre-existing failures. 3119/3119 API tests now green.

### F086 Architecture (for reference in future features)

- **Endpoint:** `GET /reverse-search?chainSlug=burger-king&maxCalories=600&minProtein=30&limit=10`
- **Conversation:** `reverse_search` intent detected by `detectReverseSearch()` in entityExtractor.ts
- **Pipeline:** Step 2.5 in ConversationCore (after context-set, before comparison)
- **Query:** CTE de-dup pattern (same as level1Lookup), sorts by proteinDensity DESC
- **Schemas:** `packages/shared/src/schemas/reverseSearch.ts`
- **Route:** `packages/api/src/routes/reverseSearch.ts` (Fastify plugin, registered in app.ts)
- **Formatter:** `packages/bot/src/formatters/reverseSearchFormatter.ts`
- **Bounds clamping:** NL input clamped to 100-3000 kcal, 0-200g protein in conversationCore
- **Graceful degradation:** try/catch for DB failure, returns intent without data

## Active Feature — None

No active feature. Product tracker shows: **"No active work"**.

**Next pending features (Phase B remainder):**

| ID | Feature | Complexity | Type | Notes |
|----|---------|-----------|------|-------|
| F087 | "El Tupper" Meal Prep | Simple | backend | Divide recipe by N portions. `/receta 2kg lentejas... dividir en 5 tuppers` |
| F088 | Community Inline Corrections | Standard | bot | "Cálculo incorrecto" inline button. User proposes adjustment. Feeds demand pipeline |
| F089 | "Modo Tapeo" (shared portions) | Simple | bot | Multiple tapas → per-tapa + total ÷ N people |

**Phase C (Web Assistant + Voice):** F090-F097 pending. These are frontend features.

## Current Test Counts

| Package | Tests | Files | Status |
|---------|-------|-------|--------|
| API | 3,119 | 174 | All passing |
| Bot | ~1,192 | ~55 | All passing |
| Shared | ~456 | ~20 | All passing |
| Landing | 678 (+3 todo) | 55 | All passing |
| **Total** | **~5,445** | **~304** | **Build clean** |

## Infrastructure

### Deployment
- **API Staging:** https://api-dev.nutrixplorer.com (Render, develop branch)
- **API Production:** https://api.nutrixplorer.com (Render, main branch)
- **Bot Staging/Prod:** Render workers (develop/main)
- **DB:** Supabase PostgreSQL (pgvector + pg_trgm), port 6543
- **Cache:** Upstash Redis

### Key Architecture
- **Monorepo:** npm workspaces — packages/api, packages/bot, packages/shared, packages/scraper, packages/landing
- **Dual ORM:** Prisma (migrations, CRUD) + Kysely (complex queries, pgvector)
- **Estimation Engine:** 4-level cascade + OFF pre-check + enrichments (tips, substitutions, allergens, uncertainty, portion sizing)
- **ConversationCore:** Intent pipeline: context_set → **reverse_search (F086)** → comparison → menu_estimation → estimation
- **14 chains + 1 virtual** (cocina-espanola with 250 dishes)
- **DRY enrichment pattern:** `enrichWith*()` functions returning spread-ready objects `{ field?: T }` — used by F081-F085

### Key Files

| Component | File | Why |
|-----------|------|-----|
| Product tracker | `docs/project_notes/product-tracker.md` | Active Session + Features tables |
| Key facts | `docs/project_notes/key_facts.md` | Stack, components, endpoints |
| Decisions | `docs/project_notes/decisions.md` | ADRs |
| Workflow skill | `.claude/skills/development-workflow/SKILL.md` | 6-step workflow |
| Product evolution | `docs/research/product-evolution-analysis-2026-03-31.md` | Feature specs source (CRITICAL for spec creation) |
| Estimate route | `packages/api/src/routes/estimate.ts` | Fastify plugin pattern reference |
| ConversationCore | `packages/api/src/conversation/conversationCore.ts` | Intent pipeline |
| Entity extractor | `packages/api/src/conversation/entityExtractor.ts` | NL pattern detection |
| Estimate schemas | `packages/shared/src/schemas/estimate.ts` | Enrichment schemas (F081-F085) |
| Conversation schemas | `packages/shared/src/schemas/conversation.ts` | Intent + message data schemas |
| Prisma schema | `packages/api/prisma/schema.prisma` | DB models |
| Kysely types | `packages/api/src/generated/kysely-types.ts` | DB type definitions |

## Epics Progress

| Epic | Name | Status | Features |
|------|------|--------|----------|
| E001-E005 | Phase 1 (Infra→Bot) | done | F001-F037 |
| E006 | Structural Foundations | done | F068-F070 |
| E007 | Spanish Food Coverage | done | F071-F079 |
| **E008** | **Conv. Assistant & Voice** | **in-progress** | F080-F086 done, **F087-F089 pending (Phase B)**, F090-F097 pending (Phase C) |
| E009 | Personalization & Tracking | pending | F098-F099 |
| E010 | Scale & Monetization | pending | F100-F109 |

## Phase B Features (F080–F089) — Status

| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| ~~F080~~ | ~~OFF Prepared Foods~~ | **DONE** | PR #72. Import pending (separate session) |
| ~~F081~~ | ~~Health-Hacker Tips~~ | **DONE** | PR #73 |
| ~~F082~~ | ~~Nutritional Substitutions~~ | **DONE** | PR #74 |
| ~~F083~~ | ~~Allergen Cross-Reference~~ | **DONE** | PR #75 |
| ~~F084~~ | ~~Uncertainty Ranges~~ | **DONE** | PR #76 |
| ~~F085~~ | ~~Portion Sizing Matrix~~ | **DONE** | PR #77 |
| ~~F086~~ | ~~Reverse Search~~ | **DONE** | PR #78 |
| **F087** | **"El Tupper" Meal Prep** | pending | Simple |
| **F088** | **Community Inline Corrections** | pending | Standard |
| **F089** | **"Modo Tapeo"** | pending | Simple |

## Pending Operational

- **OFF import (F080):** Being executed in separate session. API v2 + auth fix applied. Pagination fix applied. Command: `OFF_IMPORT_ENABLED=true npx tsx packages/api/src/scripts/off-import.ts --brand hacendado`
- **develop → main sync:** F080-F086 on develop, not yet synced to main/production.
- **CI fix (F029):** Applied to develop (da18ec9). Pre-existing issue, not F086-related.
- **Security backlog:** 10 items from QA audit (see product-tracker.md "Security & Robustness Backlog"). To address before public launch.

## User Preferences

- Senior developer — pragmatic YAGNI, no over-engineering
- Communication in Spanish, all code/docs/commits in English
- User authorized autonomous progression through implementation for Simple features — proceed without waiting for approval at each checkpoint, but still require Merge Approval (L2)
- For Standard features, user has authorized autonomous progression if spec+plan look correct and context is sufficient. Do self-review + /review-spec + /review-plan.
- After feature completion, generate context prompt via `/context-prompt`
- Show task progress summaries after completing steps

## Workflow Reminder

- **Current step:** No active feature. Ready to start next feature.
- **Next action:** Ask user which feature to start next (F087, F088, F089, or other)
- **Spec creation rule:** ALWAYS read `docs/research/product-evolution-analysis-2026-03-31.md` before creating any spec for F068-F109
- **Step flow for Simple:** Steps 1→3→4→5→6
- **Step flow for Standard:** Steps 0→1→2→3→4→5(+QA)→6
- Before requesting merge approval, you MUST read `references/merge-checklist.md` and execute ALL actions (0-8). Fill the `## Merge Checklist Evidence` table in the ticket with real evidence for each action.
- After commit+PR, run `code-review-specialist` and `qa-engineer` (Step 5), then execute merge-checklist actions. Do NOT request merge approval without completing the checklist.

## CI/CD Note

The F029 analytics test mock issue was caused by phantom init entries in Kysely fixtures. Root cause: `getKysely()` mock resets `callIndex` to 0 on every call, so each route plugin gets its own fresh counter. If new route plugins with init selectFrom calls are added in the future, these tests should NOT be affected (each route gets a separate db instance). If similar test failures appear, check whether the fixture index offsets are correct.

---
Generated: 2026-04-07. Purpose: Continue development after /compact or new session.
