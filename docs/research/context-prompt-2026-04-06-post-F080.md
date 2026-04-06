# Context Recovery — nutriXplorer (foodXPlorer) — 2026-04-06 (Post-F080)

## Project State

- **Branch:** develop (clean working tree)
- **Last commit:** 8b6a8f9 — docs: complete F080, update tracker to done
- **SDD DevFlow version:** 0.13.2
- **Autonomy Level:** L2 (Trusted) — Plan Approval + Merge Approval required
- **Branching:** gitflow — develop (integration) + main (production)
- **develop ahead of main** — F080 merged to develop, not yet synced to main

## What Was Just Completed (2026-04-06)

### F080 — OFF Prepared Foods Ingestion (Standard, PR #72)

Ingested Open Food Facts (OFF) Hacendado/Mercadona products module (~11K items expected). OFF data serves as:
- **Tier 0** for branded queries (e.g., "tortilla hacendado") — direct L1 lookup
- **Tier 3 fallback** for generic queries when BEDCA/chains/canonical have no match
- **ODbL attribution** enforced on all OFF-sourced API responses

**What was built:**
1. OFF ingestion module (`packages/api/src/ingest/off/`): types, validator, mapper, HTTP client
2. Seed script (`seedPhaseOff.ts`) with `--dry-run`, `--brand`, `--limit` flags + feature flag
3. L1 branded lookup (`offBrandedFoodMatch()`) — strips brand from FTS query, matches via brand_name column
4. OFF Tier 3 generic fallback in `engineRouter.ts` — after L3 pgvector, before L4 LLM
5. Brand alias support: `mercadona` → `["hacendado", "mercadona"]` in `brandDetector.ts`
6. ODbL attribution computed at response time in `mapSource()` — `attributionNote`, `license`, `sourceUrl`
7. `EstimateSourceSchema` extended with 3 nullable fields (backward compatible)
8. OFF DataSource seeded (UUID `00000000-0000-0000-0000-000000000004`, priorityTier 0)

**Review process:**
- Cross-model spec review (Gemini + Codex): 10 issues fixed
- Cross-model plan review (Gemini + Codex): 10 issues fixed
- Code review (code-review-specialist): APPROVED WITH NOTES — 5 fixes (dry-run count, brand-in-FTS, dead code, negative nutrients, brands_tags filter)
- QA review (qa-engineer): 3 bugs found + fixed (BUG-F080-01/02/03 — null handling from OFF API)
- Production-code-validator: APPROVED

**PENDING OPERATIONAL STEP:** OFF data import not yet executed — OFF API returned 503 during dry-run validation. Run when OFF is available:
```bash
# 1. Dry-run validation (50 products)
OFF_IMPORT_ENABLED=true npm run off:import -- --dry-run --limit 50 -w @foodxplorer/api

# 2. Full import (~2-3 hours)
OFF_IMPORT_ENABLED=true npm run off:import -w @foodxplorer/api

# 3. Generate embeddings for new OFF foods
npm run embeddings:generate -w @foodxplorer/api
```

## Current Test Counts

| Package | Tests | Status |
|---------|-------|--------|
| API | 2,855 | All passing (159 files) |
| Bot | 1,143 | All passing (56 files) |
| Landing | 678 (+3 todo) | All passing (55 files) |
| **Total** | **~4,676** | Build clean |

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
- **Estimation Engine:** 4-level cascade (L1 exact → L2 ingredients → L3 pgvector → L4 LLM) + OFF branded pre-check + OFF Tier 3 fallback
- **15 nutrients** tracked including alcohol
- **14 chains + 1 virtual** (cocina-espanola with 250 dishes)
- **534 base foods** (USDA SR Legacy + BEDCA)
- **60 cooking profiles** with yield factors
- **OFF module:** `packages/api/src/ingest/off/` (types, validator, mapper, client) — data not yet imported

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
| **E008** | **Conversational Assistant & Voice (Phase B+C)** | **in-progress** | F080 done, F081-F097 pending |

## Next Action — F081: "Health-Hacker" Chain Suggestions

### What F081 is

Bot feature that suggests calorie-saving modifications for chain dishes:
- "Pide sin queso ni salsa: -120 kcal"
- Modification-based suggestions for chain dishes
- **Complexity:** Simple → Steps 1→3→4→5→6 (skip Spec + Plan)

### Phase B Features (F081–F089)

| ID | Feature | Type | Complexity | Notes |
|----|---------|------|------------|-------|
| ~~F080~~ | ~~OFF Prepared Foods Ingestion~~ | ~~backend~~ | ~~Standard~~ | **DONE** — PR #72 |
| **F081** | "Health-Hacker" Chain Suggestions | bot | Simple | **NEXT** |
| F082 | Nutritional Substitutions | backend | Simple | "Cambia patatas por ensalada: -200 kcal" |
| F083 | Allergen Cross-Reference | backend | Simple | Ingredient-level allergen detection |
| F084 | Estimation with Uncertainty Ranges | backend | Simple | "320-420 kcal" instead of single number |
| F085 | Portion Sizing Matrix | backend | Simple | Standard Spanish portions |
| F086 | Reverse Search | backend | Standard | "¿Qué como con 600 kcal en BK?" |
| F087 | "El Tupper" Meal Prep | backend | Simple | Divide recipe by N portions |
| F088 | Community Inline Corrections | bot | Standard | User-proposed adjustments |
| F089 | "Modo Tapeo" | bot | Simple | Shared portions ÷ N people |

### How to start F081

1. Read the development workflow skill: `.claude/skills/development-workflow/SKILL.md`
2. Read the product evolution analysis: `docs/research/product-evolution-analysis-2026-03-31.md`
3. Start: `start task F081`
4. Complexity: **Simple** → Setup → Implement → Finalize → Review
5. Autonomy L2: Merge Approval required

### IMPORTANT: Before starting F081, consider running the OFF import

If OFF API is available, run the import first to have real data for testing:
```bash
OFF_IMPORT_ENABLED=true npm run off:import -- --dry-run --limit 50 -w @foodxplorer/api
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

## Workflow Reminder

- **Current step:** No active feature — starting fresh
- **Pending checkpoints:** None (clean slate)
- **Pending operational:** OFF import (F080) when API recovers from 503
- **Step order:** Spec (0) → Setup (1) → Plan (2) → Implement (3) → Finalize (4) → Review (5) → Complete (6)
- After commit+PR, run `code-review-specialist` and `qa-engineer` (Step 5), then execute merge-checklist actions
- Before requesting merge approval, you MUST read `references/merge-checklist.md` and execute ALL actions (0-8). Fill the `## Merge Checklist Evidence` table in the ticket with real evidence for each action.

---
Generated: 2026-04-06. Purpose: Continue Phase B after F080 completion.
