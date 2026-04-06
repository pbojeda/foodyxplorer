# Context Recovery — nutriXplorer (foodXPlorer) — 2026-04-06 (Phase B Start)

## Project State

- **Branch:** develop (clean working tree)
- **Last commit:** e70a5cd — merge: sync develop → main — alcohol seed fix + seed upsert fix
- **SDD DevFlow version:** 0.13.2
- **Autonomy Level:** L2 (Trusted) — Plan Approval + Merge Approval required
- **Branching:** gitflow — develop (integration) + main (production)
- **develop and main are in sync** — no pending commits

## What Was Just Completed (2026-04-06 session)

This session was a **documentation stabilization + staging fix** session before Phase B:

### Documentation
1. **Bot manual audited** — 19 sections verified against source code. 5 critical errors fixed (voice duration 30s→120s, wrong error messages, missing rate limits, false NL example, /menu missing from /help). Cross-model reviewed by Gemini + Codex.
2. **API manual created** — `docs/api-manual.md` (English, 908 lines). 12 public endpoints, auth, rate limits, error codes, data coverage, estimation engine, caching. Cross-model reviewed.
3. **Swagger UI fixed** — was returning 500 due to Zod internal `_cached: null` metadata. Fix: `transform` function in swagger plugin cleans schemas.

### Staging Fixes (F1–F6)
4. **F1 DB_UNAVAILABLE** — Root cause: (a) missing `prisma migrate deploy` in Dockerfile → migrations not applied to staging DB; (b) Kysely pg.Pool needed SSL for Supabase (`ssl: { rejectUnauthorized: false }`). Both fixed.
5. **F2 cocina-espanola missing** — Seed not executed on staging. Now seeded.
6. **F3 countryCode=ES → 0** — Was rate limit during testing, not a real bug.
7. **F4 mcdonalds 2 dishes** — Seed data only, scrapers populate the rest.
8. **F5 cookingState as_served** — Manual documented only raw|cooked, code also accepts as_served. Fixed in manual.
9. **F6 CORS** — Added X-Actor-Id + X-FXP-Source to allowedHeaders. CORS_ORIGINS configured in Render for dev + prod.

### Data Fixes
10. **Alcohol values** — spanish-dishes.json had no alcohol field for any beverage. Added alcohol (g per serving) for 15 drinks. Also fixed seedPhaseSpanishDishes.ts upsert which omitted `alcohol` from both update and create clauses.

### QA Audit
11. **Cross-model QA** — Claude (live staging tests) + Gemini CLI + Codex CLI. Full report: `docs/project_notes/qa-api-audit-2026-04-06.md`
12. **Security backlog** (A1-A4, C1-C9) documented in product tracker → "Security & Robustness Backlog (Post-Phase B)". To be addressed before public launch, not before Phase B.

### Verification
13. **Staging verified:** 14/14 endpoints passing (health, estimate, conversation, recipe, chains, search, docs)
14. **Production verified:** 12/12 endpoints passing
15. **Alcohol verified:** cerveza=11.6g, vino tinto=12.6g, gin tonic=15g on both environments

## Current Test Counts

| Package | Tests | Status |
|---------|-------|--------|
| API | 2,710 | All passing |
| Bot | 1,143 | All passing |
| Landing | 678 (+3 todo) | All passing |
| **Total** | **~4,531** | Build clean |

## Infrastructure

### Deployment
- **API Staging:** https://api-dev.nutrixplorer.com (Render, develop branch, auto-deploy)
- **API Production:** https://api.nutrixplorer.com (Render, main branch, auto-deploy)
- **Bot Staging:** Render worker (develop), **Bot Production:** Render worker (main)
- **Landing:** https://nutrixplorer.com (Vercel, main branch)
- **Swagger UI:** https://api-dev.nutrixplorer.com/docs (working, 24 paths)
- **DB:** Supabase PostgreSQL (pgvector + pg_trgm), port 6543 (PgBouncer)
- **Cache:** Upstash Redis
- **Dockerfile** now runs `prisma migrate deploy` before server start (auto-applies pending migrations)

### Key Architecture
- **Monorepo:** npm workspaces — packages/api, packages/bot, packages/shared, packages/scraper, packages/landing
- **Dual ORM:** Prisma (migrations, CRUD) + Kysely (complex queries, pgvector)
- **Kysely SSL:** Auto-detected for non-localhost URLs (`ssl: { rejectUnauthorized: false }`)
- **Estimation Engine:** 4-level cascade (L1 exact → L2 ingredients → L3 pgvector → L4 LLM)
- **15 nutrients** tracked including alcohol
- **14 chains + 1 virtual** (cocina-espanola with 250 dishes)
- **534 base foods** (USDA SR Legacy + BEDCA placeholder)
- **60 cooking profiles** with yield factors

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
| **E008** | **Conversational Assistant & Voice (Phase B+C)** | **next** | F080-F097 |

## Next Action — Phase B: F080 (OFF Prepared Foods Ingestion)

### What F080 is

Ingest **Open Food Facts** prepared foods data — specifically Hacendado/Mercadona products (~11K items). These become:
- **Tier 0** for branded products (highest priority — official packaging data)
- **Tier 3** fallback for generic queries (lower than BEDCA/chain data)
- **ODbL attribution** required (Open Database License)

See detailed rationale in `docs/research/product-evolution-analysis-2026-03-31.md` Section 4.

### Phase B Features (F080–F089)

| ID | Feature | Type | Complexity | Notes |
|----|---------|------|------------|-------|
| **F080** | OFF Prepared Foods Ingestion | backend | **Standard** | **NEXT** — ingest ~11K products |
| F081 | "Health-Hacker" Chain Suggestions | bot | Simple | "Pide sin queso: -120 kcal" |
| F082 | Nutritional Substitutions | backend | Simple | "Cambia patatas por ensalada: -200 kcal" |
| F083 | Allergen Cross-Reference | backend | Simple | Ingredient-level allergen detection |
| F084 | Estimation with Uncertainty Ranges | backend | Simple | "320-420 kcal" instead of single number |
| F085 | Portion Sizing Matrix | backend | Simple | Standard Spanish portions |
| F086 | Reverse Search | backend | Standard | "¿Qué como con 600 kcal en BK?" |
| F087 | "El Tupper" Meal Prep | backend | Simple | Divide recipe by N portions |
| F088 | Community Inline Corrections | bot | Standard | User-proposed adjustments |
| F089 | "Modo Tapeo" | bot | Simple | Shared portions ÷ N people |

### How to start F080

1. Read the development workflow skill: `.claude/skills/development-workflow/SKILL.md`
2. Read the product evolution analysis: `docs/research/product-evolution-analysis-2026-03-31.md` (Section 4 for OFF details)
3. Start: `start task F080`
4. Complexity: **Standard** → Spec → Setup → Plan → Implement → Finalize → Review
5. Autonomy L2: Plan Approval required, Merge Approval required

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
| `docs/research/product-evolution-analysis-2026-03-31.md` (Sec 4) | OFF integration strategy |
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

- **Current step:** No active feature — starting fresh with F080
- **Pending checkpoints:** None (clean slate)
- **Step order:** Spec (0) → Setup (1) → Plan (2) → Implement (3) → Finalize (4) → Review (5) → Complete (6)
- After commit+PR, run `code-review-specialist` and `qa-engineer` (Step 5), then execute merge-checklist actions. Do NOT request merge approval without completing the checklist.
- Before requesting merge approval, you MUST read `references/merge-checklist.md` and execute ALL actions (0-8). Fill the `## Merge Checklist Evidence` table in the ticket with real evidence for each action.

---
Generated: 2026-04-06. Purpose: Start Phase B (F080) in new session.
