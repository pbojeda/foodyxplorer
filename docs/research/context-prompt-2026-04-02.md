# Context Recovery — nutriXplorer (foodXPlorer) — 2026-04-02

## Project State

- **Branch:** develop (clean working tree)
- **Last commit:** 6b997c5 — docs: add ADR-015 (Provenance Graph) + ADR-016 (Anonymous Identity) + update key_facts
- **Previous commits:** f9850fc (product evolution analysis + Phase 2 roadmap), 201d474 (F067 complete)
- **SDD DevFlow version:** 0.12.1
- **Autonomy Level:** L2 (Trusted) — Plan Approval + Merge Approval require user confirmation
- **Branching:** gitflow — develop (integration) + main (production) + feature/*
- **Both branches synced:** develop and main are at same state (merged 2026-04-02)

## Workflow

- Follow SDD development workflow (`.claude/skills/development-workflow/SKILL.md`)
- Read CLAUDE.md section 2 for autonomy level
- Read `docs/project_notes/key_facts.md` for branching strategy

## Active Feature

**No active work.** Ready to start **F068 — Provenance Graph** (first feature of Phase 2).

## CRITICAL: Product Evolution Analysis

**Before starting ANY feature F068-F109, you MUST read:**
`docs/research/product-evolution-analysis-2026-03-31.md`

This document (1500+ lines, 4 iterations, reviewed by Claude + Gemini + Codex) contains ALL approved decisions, architecture, data source strategy, voice architecture notes, and rationale for every planned feature. **Do NOT invent requirements — derive them from that document.**

The product-tracker Active Session also contains this rule.

## Phase 2 Overview

The product completed Phase 1 (67 features, F001-F067). A comprehensive strategic analysis identified the core gap: the product is "too narrow in effective coverage" (only fast-food chains) while promising "any dish, any restaurant." Phase 2 closes that gap with 42 features across 5 phases.

### Phase Structure

| Phase | Weeks | Focus | Key Features |
|-------|-------|-------|-------------|
| **A0** | 1 | Structural foundations | F068 (Provenance Graph), F069 (Anonymous Identity), F070 (Conversation Core) |
| **A1** | 2-4 | Spanish food coverage | F071 (BEDCA), F072 (Cooking profiles), F073 (300 canonical dishes), F074-F079 |
| **B** | 5-10 | Differentiation (no auth needed) | F080 (OFF ingestion), F081-F089 (value features), F090-F093 (web assistant /hablar) |
| **C** | 11-14 | Realtime voice + personalization | F094-F097 (voice spike + realtime), F098 (premium), F099 (user profiles) |
| **D** | 15-20 | Scale & monetization | F100-F109 (barcodes, B2B, Maps, auth, PWA) |

### Key Architectural Decisions (Phase 2)

1. **Provenance Graph (ADR-015):** `priority_tier` on DataSource. BEDCA-first for generic queries (Tier 1). OFF/Hacendado for branded (Tier 0). No user disambiguation. NLP extracts `has_explicit_brand` flag.

2. **Anonymous Identity (ADR-016):** `actors` table from day 1. Web = UUID in cookie/localStorage. Telegram = chat_id. All user data references `actor_id`. Mergeable to authenticated user later (Google Identity Platform, Phase D). Rate limits per actor.

3. **Conversation Core (F070):** Extract bot NL handler into shared API service. Bot and web assistant are thin adapters over same core. Not two separate products.

4. **Voice architecture:** Async first (Whisper in bot, Phase A1). Web async voice (Phase B). Realtime voice (Phase C). **Browser-side STT/TTS (Web Speech API) under investigation as zero-cost alternative** — cloud options ($2,500-45,000/mo) are cost-prohibitive pre-revenue. Spike in F094 before committing.

5. **Data sources:** USDA (514 foods, imported) + BEDCA (~431 foods, 55 nutrients, license pending) + OFF (11K+ Hacendado, ODbL) + LLM-bootstrapped (300 canonical Spanish dishes) + chain PDFs (885 dishes).

6. **Phase order rationale:** Voice/conversational features (Phase B-C) BEFORE profiles/tracking (Phase C end). The differentiator is the conversational experience, not tracking (every calorie app does tracking). Features that work without auth come first to attract users. Tracking retains them later.

## Epics and Progress

### Phase 1 (Complete)

| Epic | Name | Status | Features |
|------|------|--------|----------|
| E001 | Infrastructure & Schema | done | F001-F006 |
| E002 | Data Ingestion Pipeline | done | F007-F019 |
| E003 | Estimation Engine | done | F020-F024 |
| E004 | Telegram Bot + Public API | done | F025-F032, F037-F038, F041-F043 |
| E005 | Advanced Analysis & UX | done | F033-F037 |
| Marketing & Growth | Landing + conversion | done | F039-F048 |
| Quality & Docs | Bot audit, docs | done | F049-F058 |
| Landing Audit | Cross-model fixes | done | F059-F064 (F062 deferred) |
| Validation | Slugs, E2E, cleanup | done | F065-F067 |

### Phase 2 (Pending)

| Epic | Name | Status | Features |
|------|------|--------|----------|
| E006 | Structural Foundations | **next** | F068-F070 |
| E007 | Spanish Food Coverage | pending | F071-F079 |
| E008 | Conversational + Voice | pending | F080-F097 |
| E009 | Personalization | pending | F098-F099 |
| E010 | Scale & Monetization | pending | F100-F109 |

## BEDCA Evaluation Results (2026-04-02)

- **969 entries, only ~431 with actual nutrient data** (BEDCA2 entries mostly empty)
- **55 nutrients** per food (more detailed than USDA)
- **Bilingual** (Spanish + English names)
- **Very few prepared dishes** (~85 cooked items = individual ingredients like "arroz hervido", NOT complex dishes)
- **Commercial license PENDING** — email sent to bedca.adm@gmail.com
- **API:** XML POST at `bedca.net/bdpub/procquery.php` (undocumented but functional)
- **Existing parser:** `statickidz/bedca-api` (PHP, MIT)
- **Conclusion:** BEDCA = excellent for ingredients, insufficient for prepared dishes. LLM bootstrapping still needed for canonical Spanish dishes.

## OFF Evaluation Results (2026-04-02)

- **11,150+ Hacendado/Mercadona products** in Open Food Facts
- Includes prepared dishes (tortillas, croquetas, lasañas) with official packaging data
- Free API, ODbL license
- **Elevated to Phase B** (F080) for early value delivery
- Use as Tier 0 for branded queries, Tier 3 fallback for generic with attribution

## Data Resolution Strategy

```
User query: "tortilla de patatas"
  1. BEDCA match? → Return (HIGH confidence, lab data)
  2. Canonical dish (LLM recipe)? → Return (MEDIUM confidence, estimated)
  3. OFF prepared food? → Return with attribution "Ref: Hacendado" (MEDIUM, industrial)
  4. L1→L2→L3→L4 cascade → normal flow

User query: "tortilla hacendado"
  → Direct OFF lookup (HIGH confidence, packaging data)
```

## Backend Architecture

- **Stack:** Fastify + Prisma + Kysely + PostgreSQL 16 (pgvector, pg_trgm) + Redis
- **Deploy:** Render (staging: develop, prod: main) + Supabase + Upstash
- **Estimation cascade:** L1 (official) → L2 (ingredients) → L3 (pgvector) → L4 (LLM)
- **Endpoints:** GET /estimate, POST /calculate/recipe, POST /analyze/menu, GET /quality/report, GET /analytics/queries, POST /waitlist, 4 catalog endpoints, 4 ingest endpoints
- **Chains:** 14 active (mcdonalds-es, burger-king-es, kfc-es, telepizza-es, etc.)
- **15 Prisma migrations** up to `data_quality_cleanup_f067`
- **ADRs:** 16 total (ADR-000 through ADR-016)

## Bot Architecture

- **Stack:** node-telegram-bot-api + ApiClient + Redis state
- **Commands:** /estimar, /comparar, /receta, /restaurante, /contexto, /cadenas, /start, /ayuda
- **Features:** NL handler, file upload (photo/document), menu analysis, portion-aware, conversational context

## Landing Architecture

- **Stack:** Next.js 14 (App Router), TypeScript strict, Tailwind CSS, Framer Motion
- **Deploy:** Vercel → nutrixplorer.com
- **Variants:** ?variant=a|c|f, ?palette=botanical|med

## Test Baseline

| Package | Tests | Notes |
|---------|-------|-------|
| API | ~2506 (148 pre-existing failures) | Vitest |
| Bot | 1109 | All pass |
| Landing | 659 | Jest + RTL |
| Shared | ~339 | |
| Scraper | 232 | |
| API E2E | 10 | Real HTTP server |

## Conversational Assistant (Future — Phase B-C)

Documentation exists at `/Users/pb/Developer/FiveGuays/foodXPlorerResources/docs/conversational-assistent/`:
- `conversational-mode-briefing.md` — UX vision, states, principles
- `conversational-mode-prd.md` — Full PRD, flows, requirements
- `conversational-mode-development-plan.md` — Tech plan, 7 sprints, components

**Key principle:** "Backend calcula, frontend explica." Voice pipeline is presentation layer. ADR-001 preserved.

## Key Files to Read First

| File | Purpose |
|------|---------|
| `docs/research/product-evolution-analysis-2026-03-31.md` | **READ FIRST** — All Phase 2 decisions, architecture, features |
| `docs/project_notes/product-tracker.md` | Active Session + feature tables + spec creation rule |
| `docs/project_notes/key_facts.md` | Stack, data sources, Phase 2 section |
| `docs/project_notes/decisions.md` | ADR-000 through ADR-016 |
| `.claude/skills/development-workflow/SKILL.md` | SDD workflow steps |
| `CLAUDE.md` | Autonomy level, session recovery |

## User Preferences

- Senior developer — pragmatic YAGNI, no over-engineering
- Communication in Spanish, all code/docs/commits in English
- After feature completion, wants /context-prompt
- Complete ALL ticket sections before requesting merge approval
- SDD workflow mandatory for all features
- Cross-model reviews with Gemini CLI (`gemini`) and Codex CLI (`codex exec -`)
- **Product vision:** "Como hablar con tu nutricionista, tu entrenador y tu asesor alimentario"
- **Short-term goal:** User mass through value + differentiation (voice, conversational), not registration/tracking

## Pending Actions

1. ~~Email BEDCA for commercial license~~ — Text drafted, user to send
2. **Start F068 — Provenance Graph** (ADR-015): Add `priority_tier` to `data_sources` table. Resolution rules in estimation engine. `has_explicit_brand` in NLP entity extraction.
3. Then F069 (actors table) → F070 (Conversation Core extraction) → F071+ (BEDCA, dishes, etc.)

## Workflow Recovery

- **Current step:** No active feature
- **Pending checkpoints:** None
- **Next action:** Start F068 following SDD workflow. Read product-evolution-analysis first. Use `start task F068` or equivalent.

---
Generated: 2026-04-02 after Phase 2 planning complete. 4-iteration product analysis done. ADR-015 + ADR-016 written. Both branches synced to main.
