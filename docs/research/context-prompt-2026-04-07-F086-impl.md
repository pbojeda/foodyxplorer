# Context Recovery — nutriXplorer (foodXPlorer) — 2026-04-07 (F086 Implementation)

## Project State

- **Branch:** `feature/F086-reverse-search` (clean working tree)
- **Last commit:** 9f3f995 — docs: F086 spec + plan — reverse search by calorie/protein constraints
- **SDD DevFlow version:** 0.13.2
- **Autonomy Level:** L2 (Trusted) — Plan Approval + Merge Approval required
- **Branching:** gitflow — develop (integration) + main (production)
- **develop ahead of main** — F080-F085 merged to develop, not yet synced to main

## What Was Just Completed (2026-04-07, same session)

### F083 — Allergen Cross-Reference (Simple, PR #75, bf16e6e)
Rule-based allergen detection for 14 EU categories. `enrichWithAllergens()` DRY helper. 50 tests.

### F084 — Estimation with Uncertainty Ranges (Simple, PR #76, 4cd295a)
Calorie ranges ±5%-±30% based on confidence × estimation method. `enrichWithUncertainty()` DRY helper. 26 tests.

### F085 — Portion Sizing Matrix (Simple, PR #77, 2d859f3)
9 Spanish portion terms with word boundary matching. `enrichWithPortionSizing(query)` DRY helper. 30 tests.

## Active Feature — F086: Reverse Search

### What F086 is

**Standard complexity.** "¿Qué como con 600 kcal en BK?" — Filter chain dishes by calorie/protein constraints.

Two entry points:
1. **API endpoint:** `GET /reverse-search?chainSlug=burger-king&maxCalories=600&minProtein=30`
2. **Conversation intent:** `reverse_search` in ConversationCore

### Current Step: 3/6 (Implement) — READY TO START

Steps 0 (Spec) and 2 (Plan) are DONE — written in ticket, self-reviewed. **Spec + Plan are auto-approved (L2 autonomy).** Implementation can begin immediately.

The ticket at `docs/tickets/F086-reverse-search.md` contains the complete spec and 6-step implementation plan. **READ THE FULL TICKET FIRST.**

### Implementation Plan Summary (6 steps)

1. **Shared schemas** — `packages/shared/src/schemas/reverseSearch.ts`: `ReverseSearchQuerySchema`, `ReverseSearchResultSchema`, `ReverseSearchDataSchema`. Add `reverse_search` intent to `ConversationIntentSchema`. Add `reverseSearch` field to `ConversationMessageDataSchema`.

2. **Query module** — `packages/api/src/estimation/reverseSearch.ts`: `reverseSearchDishes(db, params)` Kysely query. CTE `ranked_dn` for dish_nutrients de-dup (same pattern as level1Lookup). JOIN dishes → restaurants → ranked_dn. Filter by chainSlug + calories ≤ maxCalories + proteins ≥ minProtein. Order by proteinDensity DESC. Return results + totalMatches.

3. **API route** — `packages/api/src/routes/reverseSearch.ts`: GET /reverse-search. Fastify plugin pattern (like estimate.ts). Validate with Zod. Handle CHAIN_NOT_FOUND. Register in routes/index.ts. Update api-spec.yaml.

4. **Entity extraction** — `packages/api/src/conversation/entityExtractor.ts`: `detectReverseSearch(text)` regex. Patterns: "qué como con X kcal", "me quedan X kcal", etc. Optional protein: "necesito Xg proteína". Returns `{ maxCalories, minProtein? } | null`.

5. **ConversationCore integration** — `packages/api/src/conversation/conversationCore.ts`: Add detectReverseSearch check AFTER context-set, BEFORE comparison. If detected + chain context → call reverseSearchDishes(). If no chain → error message.

6. **Bot formatter** — `packages/bot/src/formatters/reverseSearchFormatter.ts`: Format ReverseSearchData for Telegram MarkdownV2. Numbered dish list with macros. Handle empty results.

### Key Architecture References

| Component | File | Why |
|-----------|------|-----|
| Level 1 Lookup (CTE pattern) | `packages/api/src/estimation/level1Lookup.ts` | ranked_dn CTE + scope clause pattern |
| Catalog dishes search | `packages/api/src/routes/catalog.ts` | Kysely + trigram + chainSlug filtering |
| Estimate route (plugin pattern) | `packages/api/src/routes/estimate.ts` | Fastify plugin registration pattern |
| Entity extractor | `packages/api/src/conversation/entityExtractor.ts` | Regex extraction patterns |
| ConversationCore | `packages/api/src/conversation/conversationCore.ts` | Intent pipeline (context_set → comparison → menu → estimation) |
| Conversation schemas | `packages/shared/src/schemas/conversation.ts` | ConversationIntentSchema, ConversationMessageDataSchema |
| Route registration | `packages/api/src/routes/index.ts` | Where to add new route plugin |
| Estimate formatter (reference) | `packages/bot/src/formatters/estimateFormatter.ts` | MarkdownV2 formatting patterns |
| Prisma schema | `packages/api/prisma/schema.prisma` | dishes, dish_nutrients, restaurants models |
| Kysely types | `packages/api/src/generated/kysely-types.ts` | DB type definitions |

### Key Schema Facts

- `dishes` table: `name`, `name_es`, `restaurant_id`, `portion_grams`, `availability` (enum: available, seasonal, discontinued, regional)
- `dish_nutrients` table: `dish_id`, `calories`, `proteins`, `fats`, `carbohydrates`, `reference_basis` (enum: per_100g, per_serving, per_package), `confidence_level`, `source_id`
- `restaurants` table: `chain_slug` (indexed), `name`, `country_code`
- Nutrient values in dish_nutrients are stored as Decimal (text from pg driver, need Number() conversion)
- CTE de-dup pattern: `ROW_NUMBER() OVER (PARTITION BY dish_id ORDER BY created_at DESC) AS rn` → `WHERE rn = 1`

### Edge Cases from Spec

- No chain context → 422 error message
- Unknown chainSlug → 404 CHAIN_NOT_FOUND
- No dishes match → empty results (not error)
- Only `available` + `per_serving` dishes
- Zero calories → proteinDensity = 0
- Null nutrient values → treat as 0

## Current Test Counts

| Package | Tests | Status |
|---------|-------|--------|
| API | ~2,935 + 106 new (F083-F085) | All passing |
| Bot | ~1,192 + 46 new (F083-F085) | All passing |
| Landing | 678 (+3 todo) | All passing |
| **Total** | **~4,957** | Build clean |

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
- **ConversationCore:** Intent pipeline: context_set → comparison → menu_estimation → estimation. F086 adds reverse_search between context_set and comparison.
- **14 chains + 1 virtual** (cocina-espanola with 250 dishes)

## Epics Progress

| Epic | Name | Status | Features |
|------|------|--------|----------|
| E001-E005 | Phase 1 (Infra→Bot) | done | F001-F037 |
| E006 | Structural Foundations | done | F068-F070 |
| E007 | Spanish Food Coverage | done | F071-F079 |
| **E008** | **Conv. Assistant & Voice** | **in-progress** | F080-F085 done, **F086 active**, F087-F097 pending |

## Phase B Features (F080–F089)

| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| ~~F080~~ | ~~OFF Prepared Foods~~ | **DONE** | PR #72 |
| ~~F081~~ | ~~Health-Hacker Tips~~ | **DONE** | PR #73 |
| ~~F082~~ | ~~Nutritional Substitutions~~ | **DONE** | PR #74 |
| ~~F083~~ | ~~Allergen Cross-Reference~~ | **DONE** | PR #75 |
| ~~F084~~ | ~~Uncertainty Ranges~~ | **DONE** | PR #76 |
| ~~F085~~ | ~~Portion Sizing Matrix~~ | **DONE** | PR #77 |
| **F086** | **Reverse Search** | **ACTIVE — Step 3** | Spec + Plan done. Implement next. |
| F087 | "El Tupper" Meal Prep | pending | Simple |
| F088 | Community Inline Corrections | pending | Standard |
| F089 | "Modo Tapeo" | pending | Simple |

## Next Action — IMPLEMENT F086

1. **Read the full ticket:** `docs/tickets/F086-reverse-search.md` (contains spec + 6-step plan)
2. **Read the development workflow:** `.claude/skills/development-workflow/SKILL.md`
3. **Start implementing Step 1** of the plan (shared schemas)
4. Follow TDD: failing test → minimum code → refactor → repeat
5. After implementation → Step 4 (Finalize): tests + lint + build + production-code-validator
6. Then Step 5 (Review): PR + code-review-specialist + qa-engineer + merge checklist

## User Preferences

- Senior developer — pragmatic YAGNI, no over-engineering
- Communication in Spanish, all code/docs/commits in English
- User authorized autonomous progression through implementation for this feature — proceed without waiting for approval at each checkpoint, but still require Merge Approval (L2)
- After feature completion, generate context prompt via `/context-prompt`
- Show task progress summaries after completing steps

## Workflow Reminder

- **Current step:** 3/6 (Implement) — READY TO START
- **Pending checkpoints:** Commit Approval (auto at L2), Merge Approval (required)
- **Spec + Plan:** Auto-approved (L2). Already written and committed.
- **Step order:** After implementation → tests/lint/build + production-code-validator (Step 4) → PR + code-review-specialist + qa-engineer (Step 5) → merge-checklist → Merge Approval
- Before requesting merge approval, you MUST read `references/merge-checklist.md` and execute ALL actions (0-8). Fill the `## Merge Checklist Evidence` table in the ticket with real evidence for each action.
- After commit+PR, run `code-review-specialist` and `qa-engineer` (Step 5), then execute merge-checklist actions. Do NOT request merge approval without completing the checklist.

## Pending Operational

- **OFF import (F080):** API still returning 503 (checked 2026-04-07). Run import when available.
- **develop → main sync:** F080-F085 on develop, not yet synced to main.

---
Generated: 2026-04-07. Purpose: Continue F086 implementation after /compact.
