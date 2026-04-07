# Context Recovery — nutriXplorer (foodXPlorer) — 2026-04-07 (Post-F081)

## Project State

- **Branch:** develop (clean working tree)
- **Last commit:** 9068e6b — docs: complete F081, update tracker to done
- **SDD DevFlow version:** 0.13.2
- **Autonomy Level:** L2 (Trusted) — Plan Approval + Merge Approval required
- **Branching:** gitflow — develop (integration) + main (production)
- **develop ahead of main** — F080 + F081 merged to develop, not yet synced to main

## What Was Just Completed (2026-04-07)

### F081 — "Health-Hacker" Chain Suggestions (Simple, PR #73)

Rule-based calorie-saving modification tips for chain dish estimation responses. When a user queries a chain dish (e.g., "Big Mac en mcdonalds-es"), the response includes up to 3 actionable tips like "Ensalada en lugar de patatas fritas: -200 kcal".

**What was built:**
1. `packages/api/src/estimation/healthHacker.ts` — Rules engine: 13 chain slugs → 5 categories (burger, pizza, chicken, sandwich, coffee) → curated tips with calorie savings. `getHealthHackerTips()` + `enrichWithTips()` DRY helper.
2. `packages/shared/src/schemas/estimate.ts` — `HealthHackerTipSchema` + `healthHackerTips` optional field on `EstimateDataSchema`. Backward compatible.
3. `packages/api/src/conversation/estimationOrchestrator.ts` — `...enrichWithTips(scaledResult)` after cascade hit. Threshold on scaled (post-portion-multiplier) calories.
4. `packages/api/src/routes/estimate.ts` — Same integration for direct API path.
5. `packages/bot/src/formatters/estimateFormatter.ts` — "💡 Health-Hacker Tips:" section with bullet points, MarkdownV2 escaped.
6. `docs/specs/api-spec.yaml` — `HealthHackerTip` schema + `healthHackerTips` field documented.

**Rules summary (5 categories):**
- **Burger** (mcdonalds-es, burger-king-es, five-guys-es): sin queso (-60), sin salsa (-80), ensalada vs patatas (-200), agua vs refresco (-140)
- **Pizza** (telepizza-es, dominos-es, pizza-hut-es, papa-johns-es): masa fina (-100), sin extra queso (-80), verduras vs embutidos (-60)
- **Chicken** (kfc-es, popeyes-es): plancha vs frito (-150), ensalada vs patatas (-180), sin salsa (-80)
- **Sandwich** (subway-es, pans-and-company-es): integral (-20), sin mayonesa (-90), más verduras (-50)
- **Coffee** (starbucks-es, tim-hortons-es): desnatada (-60), sin nata (-80), sin sirope (-70)

**Edge cases:** MIN_CALORIES=200 (threshold), MAX_TIPS=3, cocina-espanola excluded, unknown chains → empty array, null chainSlug → empty array.

**Review process:**
- Production-code-validator: APPROVED (1 HIGH fixed: API spec sync)
- Code-review-specialist: APPROVED WITH MINOR CHANGES — I1 DRY (enrichWithTips extracted), I2 threshold docs, S2 sort test, S4 shared type. All accepted.
- User audit: APROBADO — 0 blocking issues

### F080 — OFF Prepared Foods Ingestion (Standard, PR #72) — Previous session

OFF module fully built but **data import still pending** — OFF API returns 503 for `brands_tags` search endpoint. Last checked: 2026-04-07.

## Current Test Counts

| Package | Tests | Status |
|---------|-------|--------|
| API | ~2,896 | All passing |
| Bot | ~1,184 | All passing |
| Landing | 678 (+3 todo) | All passing |
| **Total** | **~4,758** | Build clean |

*Note: F081 added 41 tests (29 healthHacker + 4 orchestrator + 8 formatter)*

## Infrastructure

### Deployment
- **API Staging:** https://api-dev.nutrixplorer.com (Render, develop branch, auto-deploy)
- **API Production:** https://api.nutrixplorer.com (Render, main branch, auto-deploy)
- **Bot Staging:** Render worker (develop), **Bot Production:** Render worker (main)
- **Landing:** https://nutrixplorer.com (Vercel, main branch)
- **Swagger UI:** https://api-dev.nutrixplorer.com/docs (working)
- **DB:** Supabase PostgreSQL (pgvector + pg_trgm), port 6543 (PgBouncer)
- **Cache:** Upstash Redis
- **Dockerfile** runs `prisma migrate deploy` before server start

### Key Architecture
- **Monorepo:** npm workspaces — packages/api, packages/bot, packages/shared, packages/scraper, packages/landing
- **Dual ORM:** Prisma (migrations, CRUD) + Kysely (complex queries, pgvector)
- **Estimation Engine:** 4-level cascade (L1 exact → L2 ingredients → L3 pgvector → L4 LLM) + OFF branded pre-check + OFF Tier 3 fallback + Health-Hacker tips enrichment
- **15 nutrients** tracked including alcohol
- **14 chains + 1 virtual** (cocina-espanola with 250 dishes)
- **534 base foods** (USDA SR Legacy + BEDCA)
- **60 cooking profiles** with yield factors
- **OFF module:** `packages/api/src/ingest/off/` (types, validator, mapper, client) — data not yet imported (OFF API 503)
- **Health-Hacker module:** `packages/api/src/estimation/healthHacker.ts` — rule-based tips for 13 chains in 5 categories

## Epics Progress

| Epic | Name | Status | Features |
|------|------|--------|----------|
| E001 | Infrastructure & Schema | done | F001-F006 |
| E002 | Data Ingestion Pipeline | done | F007-F019 |
| E003 | Estimation Engine | done | F020-F024 |
| E004 | Telegram Bot + Public API | done | F025-F032 |
| E005 | Advanced Analysis & UX | done | F033-F037 |
| E006 | Structural Foundations (Phase A0) | done | F068-F070 |
| E007 | Spanish Food Coverage (Phase A1) | done | F071-F079 |
| **E008** | **Conversational Assistant & Voice (Phase B+C)** | **in-progress** | F080-F081 done, F082-F097 pending |

## Next Action — F082: Nutritional Substitutions

### What F082 is

Backend feature: "Si cambias patatas fritas por ensalada, ahorras 200 kcal". Compare alternatives for dish components.
- **Complexity:** Simple → Steps 1→3→4→5→6 (skip Spec + Plan)
- Related to F081 (Health-Hacker tips suggest modifications; F082 provides the substitution data)

### Phase B Features (F082–F089)

| ID | Feature | Type | Complexity | Notes |
|----|---------|------|------------|-------|
| ~~F080~~ | ~~OFF Prepared Foods Ingestion~~ | ~~backend~~ | ~~Standard~~ | **DONE** — PR #72 |
| ~~F081~~ | ~~Health-Hacker Chain Suggestions~~ | ~~bot~~ | ~~Simple~~ | **DONE** — PR #73 |
| **F082** | Nutritional Substitutions | backend | Simple | **NEXT** |
| F083 | Allergen Cross-Reference | backend | Simple | Ingredient-level allergen detection |
| F084 | Estimation with Uncertainty Ranges | backend | Simple | "320-420 kcal" instead of single number |
| F085 | Portion Sizing Matrix | backend | Simple | Standard Spanish portions |
| F086 | Reverse Search | backend | Standard | "¿Qué como con 600 kcal en BK?" |
| F087 | "El Tupper" Meal Prep | backend | Simple | Divide recipe by N portions |
| F088 | Community Inline Corrections | bot | Standard | User-proposed adjustments |
| F089 | "Modo Tapeo" | bot | Simple | Shared portions ÷ N people |

### How to start F082

1. Read the development workflow skill: `.claude/skills/development-workflow/SKILL.md`
2. Read the product evolution analysis: `docs/research/product-evolution-analysis-2026-03-31.md`
3. Start: `start task F082`
4. Complexity: **Simple** → Setup → Implement → Finalize → Review
5. Autonomy L2: Merge Approval required

### IMPORTANT: Before starting F082, try the OFF import again

OFF API has been returning 503 since 2026-04-06. Check if it's recovered:
```bash
curl -s -o /dev/null -w "%{http_code}" "https://world.openfoodfacts.org/cgi/search.pl?tagtype_0=brands&tag_contains_0=contains&tag_0=hacendado&page_size=1&json=1"
```
If 200, run the import:
```bash
# 1. Dry-run validation (50 products)
OFF_IMPORT_ENABLED=true npx tsx packages/api/src/scripts/off-import.ts --dry-run --limit 50

# 2. Full import (~2-3 hours)
OFF_IMPORT_ENABLED=true npx tsx packages/api/src/scripts/off-import.ts

# 3. Generate embeddings for new OFF foods
npm run embeddings:generate -w @foodxplorer/api
```

## Security Backlog (Post-Phase B)

11 items documented in product tracker and `docs/project_notes/qa-api-audit-2026-04-06.md`. Key ones:

| ID | Severity | Issue |
|----|----------|-------|
| A1 | CRITICAL | Actor impersonation — X-Actor-Id trusted blindly |
| A2 | HIGH | Audio DOS — server buffers audio before validating duration |
| C1 | HIGH | trustProxy: true unconditional — IP spoofable |
| C3 | HIGH | Actor table abuse — unbounded row creation |

User decision: address these after Phase B, before public launch.

## Key Files to Read First

| File | Why |
|------|-----|
| `docs/project_notes/product-tracker.md` | Active Session + Features tables |
| `.claude/skills/development-workflow/SKILL.md` | SDD workflow steps |
| `docs/research/product-evolution-analysis-2026-03-31.md` | OFF/feature strategy |
| `docs/project_notes/qa-api-audit-2026-04-06.md` | QA findings + security backlog |
| `packages/api/src/estimation/healthHacker.ts` | F081 module (if extending) |
| `docs/api-manual.md` | API reference (if modifying endpoints) |
| `docs/user-manual-bot.md` | Bot manual (if modifying bot) |

## User Preferences

- Senior developer — pragmatic YAGNI, no over-engineering
- Communication in Spanish, all code/docs/commits in English
- Cross-model reviews with Gemini CLI (`gemini`) and Codex CLI (`codex exec -`)
- After feature completion, generate context prompt via `/context-prompt`
- Show task progress summaries after completing steps
- After each phase: stabilize docs, audit, sync to main, verify staging + prod
- User plans to start testing the product for real users after Phase B
- User authorized autonomous progression through implementation for Simple features when context is sufficient — proceed without waiting for approval at each checkpoint, but still require Merge Approval (L2)

## Workflow Reminder

- **Current step:** No active feature — starting fresh
- **Pending checkpoints:** None (clean slate)
- **Pending operational:** OFF import (F080) when API recovers from 503
- **Step order:** Spec (0) → Setup (1) → Plan (2) → Implement (3) → Finalize (4) → Review (5) → Complete (6)
- After commit+PR, run `code-review-specialist` and `qa-engineer` (Step 5), then execute merge-checklist actions
- Before requesting merge approval, you MUST read `references/merge-checklist.md` and execute ALL actions (0-8). Fill the `## Merge Checklist Evidence` table in the ticket with real evidence for each action.

---
Generated: 2026-04-07. Purpose: Continue Phase B after F081 completion.
