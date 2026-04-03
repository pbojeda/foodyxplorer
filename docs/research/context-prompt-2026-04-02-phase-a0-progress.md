# Context Recovery — nutriXplorer (foodXPlorer) — 2026-04-02 (Phase A0 Progress)

## Project State

- **Branch:** develop (clean working tree)
- **Last commit:** 16a77b6 — docs: complete F069 — update tracker, clear active session
- **Previous commits:** 062189f (F069 merged, PR #61), 35ba448 (F068 merged, PR #60)
- **SDD DevFlow version:** 0.12.1
- **Autonomy Level:** L2 (Trusted) — Plan Approval + Merge Approval require user confirmation
- **Branching:** gitflow — develop (integration) + main (production) + feature/*
- **Both branches NOT synced:** develop is ahead of main (F068 + F069 not yet in main)

## Workflow

- Follow SDD development workflow (`.claude/skills/development-workflow/SKILL.md`)
- Read CLAUDE.md section 2 for autonomy level
- Read `docs/project_notes/key_facts.md` for branching strategy

## Active Feature

**No active work.** Ready to start **F070 — Conversation Core** (last foundation of Phase A0).

## CRITICAL: Product Evolution Analysis

**Before starting ANY feature F068-F109, you MUST read:**
`docs/research/product-evolution-analysis-2026-03-31.md`

This document (1500+ lines, 4 iterations, reviewed by Claude + Gemini + Codex) contains ALL approved decisions, architecture, data source strategy, voice architecture notes, and rationale for every planned feature. **Do NOT invent requirements — derive them from that document.**

## Session Summary — What Was Done Today

### F068 — Provenance Graph (DONE, PR #60)
- Added `priority_tier` INT column to `data_sources` table (Tier 0-3 hierarchy)
- Brand detection module (`brandDetector.ts`): detects supermarket brands + chain slugs
- L1 lookup: `ORDER BY ds.priority_tier ASC NULLS LAST` in all 4 strategies
- Branded queries: `has_explicit_brand=true` → Tier 0 filter first, fallback to normal cascade
- Response: `priorityTier` in source object (optional, backward compatible)
- **36 new tests**, no regressions

### F069 — Anonymous Identity (DONE, PR #61)
- `actors` table: `id` (UUID), `type` (enum: anonymous_web/telegram/authenticated), `external_id`, `locale`, `last_seen_at`
- Unique constraint on `(type, external_id)`
- Actor resolver middleware (`actorResolver.ts`): resolves X-Actor-Id header → upsert actor
  - Web: UUID v4 → `anonymous_web` type
  - Bot: `telegram:<chat_id>` prefix → `telegram` type
  - Missing/invalid → auto-create + return X-Actor-Id response header
- Per-actor rate limiting (`actorRateLimit.ts`): 50 queries/day, 10 photos/day via Redis
  - Fail-closed for anonymous actors, fail-open for API key auth (ADR-016)
  - L4 bucket (20/day) deferred — requires engine router integration
- `query_logs` table gained `actor_id` column (nullable, no FK)
- App registration order: auth → actorResolver → rateLimit → actorRateLimit → routes
- **25 new tests**, no regressions

## Phase A0 Progress

| Feature | Status | PR | Tests Added |
|---------|--------|-----|-------------|
| **F068** Provenance Graph | **done** | #60 | +36 |
| **F069** Anonymous Identity | **done** | #61 | +25 |
| **F070** Conversation Core | **next** | — | — |

## F070 — Conversation Core: What to Know

### ADR / Strategic Context
- Product evolution analysis Section 17, Foundation 3
- **Goal:** Extract bot NL handler into shared API service. Bot and web assistant are thin adapters over same core. Not two separate products.
- **Key principle:** "Backend calcula, frontend explica."
- **Effort:** 3 days (Standard complexity)

### Current Bot Architecture (Pre-F070)
- **NL handler:** `packages/bot/src/handlers/naturalLanguage.ts` — 4-step pipeline:
  1. Context-set detection ("estoy en mcdonalds") → `contextDetector.ts`
  2. Comparison detection ("X vs Y") → `comparisonParser.ts` + `comparisonRunner.ts`
  3. Single-dish estimation → `extractFoodQuery()` + `apiClient.estimate()`
  4. Error handling
- **Support libraries** (all in `packages/bot/src/lib/`):
  - `contextDetector.ts` — intent detection for chain context
  - `chainResolver.ts` — fuzzy match chain name → chainSlug
  - `portionModifier.ts` — extract "doble", "media ración", etc.
  - `comparisonParser.ts` — parse "X vs Y" pattern
  - `comparisonRunner.ts` — execute comparison logic
  - `conversationState.ts` — Redis BotState management (per chatId, 2h TTL)
- **Formatters** (`packages/bot/src/formatters/`): 8 Telegram-specific MarkdownV2 formatters
- **Commands:** 12 commands in `packages/bot/src/commands/`
- **ApiClient:** `packages/bot/src/apiClient.ts` — HTTP wrapper with X-API-Key + X-FXP-Source headers

### What F070 Should Extract
1. **Intent detection** (context-set, comparison, estimation) → shared service
2. **Entity extraction** (food query parsing, chain resolution, portion modifiers) → shared service
3. **Estimation orchestration** (calling engine via internal API, not HTTP) → shared service
4. **Context management** (chainContext, conversationState with actor_id) → shared service

### What Remains in Bot After F070
1. Command registration (`bot.ts`)
2. Telegram-specific formatters (MarkdownV2)
3. Callback query handling (inline keyboards)
4. File upload handling (photo/PDF)
5. Thin adapter calling Conversation Core service

### Conversational Assistant Documentation
External docs at `/Users/pb/Developer/FiveGuays/foodXPlorerResources/docs/conversational-assistent/`:
- `conversational-mode-briefing.md` — UX vision, states, principles
- `conversational-mode-prd.md` — Full PRD, flows, requirements
- `conversational-mode-development-plan.md` — Tech plan, 7 sprints

### Architecture Target

```
┌─────────────────────────────────────────────┐
│      Conversation Core (packages/api)        │
│ Intent → Entity → Orchestration → Response   │
└────┬──────────┬──────────────────────────┬──┘
     │          │                          │
┌────▼────┐ ┌──▼──────┐            ┌──────▼────┐
│Telegram │ │Web Text │            │Web Voice  │
│Adapter  │ │Adapter  │            │Adapter    │
│(bot pkg)│ │(Phase B)│            │(Phase C)  │
└─────────┘ └─────────┘            └───────────┘
```

## Backend Architecture (Updated)

- **Stack:** Fastify + Prisma + Kysely + PostgreSQL 16 (pgvector, pg_trgm) + Redis
- **Deploy:** Render (staging: develop, prod: main) + Supabase + Upstash
- **Estimation cascade:** L1 (official, priority_tier ordered) → L2 (ingredients) → L3 (pgvector) → L4 (LLM)
- **Identity:** actors table (anonymous_web / telegram / authenticated), X-Actor-Id header, per-actor rate limits
- **Provenance:** priority_tier on data_sources (0=brand, 1=national, 2=international, 3=estimated)
- **17 Prisma migrations** up to `anonymous_identity_f069`
- **ADRs:** 16 total (ADR-000 through ADR-016)
- **Chains:** 14 active (mcdonalds-es, burger-king-es, kfc-es, telepizza-es, etc.)

## Bot Architecture

- **Stack:** node-telegram-bot-api + ApiClient + Redis state
- **Commands:** /estimar, /comparar, /receta, /restaurante, /contexto, /cadenas, /start, /ayuda
- **Features:** NL handler, file upload (photo/document), menu analysis, portion-aware, conversational context
- **Test count:** 1109 (all pass)

## Test Baseline (Updated)

| Package | Tests | Notes |
|---------|-------|-------|
| API | ~2506 (148 pre-existing failures) | Vitest. +61 from F068+F069 |
| Bot | 1109 | All pass |
| Landing | 659 | Jest + RTL |
| Shared | ~339 | All pass |
| Scraper | 232 | |
| API E2E | 10 | Real HTTP server |

## Key Files to Read First

| File | Purpose |
|------|---------|
| `docs/research/product-evolution-analysis-2026-03-31.md` | **READ FIRST** — All Phase 2 decisions |
| `docs/project_notes/product-tracker.md` | Active Session + feature tables |
| `docs/project_notes/key_facts.md` | Stack, data sources, modules |
| `docs/project_notes/decisions.md` | ADR-000 through ADR-016 |
| `.claude/skills/development-workflow/SKILL.md` | SDD workflow steps |
| `CLAUDE.md` | Autonomy level, session recovery |
| `packages/bot/src/handlers/naturalLanguage.ts` | **F070 core scope** |
| `packages/bot/src/lib/` | Support libraries to extract |
| `packages/bot/src/formatters/` | Telegram adapters (stay in bot) |

## User Preferences

- Senior developer — pragmatic YAGNI, no over-engineering
- Communication in Spanish, all code/docs/commits in English
- After feature completion, wants /context-prompt
- Complete ALL ticket sections before requesting merge approval
- SDD workflow mandatory for all features
- Cross-model reviews with Gemini CLI (`gemini`) and Codex CLI (`codex exec -`)
- **Extended autonomy for Phase A0:** User authorized proceeding through Spec → Plan → Implement without stopping at intermediate checkpoints. Only stop at Merge Approval (mandatory in L2).

## Pending Actions

1. **Start F070 — Conversation Core**: Extract bot NL handler → shared service in packages/api. Standard complexity. Use `start task F070`.
2. Then Phase A1: F071 (BEDCA), F072 (Cooking profiles), F073 (300 canonical dishes), etc.

## Workflow Recovery

- **Current step:** No active feature
- **Pending checkpoints:** None
- **Next action:** Start F070 following SDD workflow. Read product-evolution-analysis Section 17 Foundation 3. Read bot NL handler source. Use `start task F070`.

---
Generated: 2026-04-02 after F068 + F069 complete. Phase A0 2/3 foundations done.
