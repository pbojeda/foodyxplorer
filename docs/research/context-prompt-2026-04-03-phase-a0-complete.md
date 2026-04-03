# Context Recovery — nutriXplorer (foodXPlorer) — 2026-04-03 (Phase A0 Complete)

## Project State

- **Branch:** develop (clean working tree)
- **Last commit:** 2f69ed5 — chore: upgrade SDD DevFlow to 0.13.2
- **Previous commits:** f331ce4 (F070 tracker cleanup), 4cd01a5 (F070 merged, PR #62)
- **SDD DevFlow version:** 0.13.2
- **Autonomy Level:** L2 (Trusted) — Plan Approval + Merge Approval require user confirmation
- **Branching:** gitflow — develop (integration) + main (production) + feature/*
- **Both branches NOT synced:** develop is ahead of main (F068 + F069 + F070 not yet in main)

## Workflow

- Follow SDD development workflow (`.claude/skills/development-workflow/SKILL.md`)
- Read CLAUDE.md section 2 for autonomy level
- Read `docs/project_notes/key_facts.md` for branching strategy

## Active Feature

**No active work.** Phase A0 complete. Ready to start **Phase A1** — next feature is **F071 (BEDCA Food Database Import)**.

## CRITICAL: Product Evolution Analysis

**Before starting ANY feature F068-F109, you MUST read:**
`docs/research/product-evolution-analysis-2026-03-31.md`

This document (1500+ lines, 4 iterations, reviewed by Claude + Gemini + Codex) contains ALL approved decisions, architecture, data source strategy, voice architecture notes, and rationale for every planned feature. **Do NOT invent requirements — derive them from that document.**

## Session Summary — What Was Done (F068-F070)

### F068 — Provenance Graph (DONE, PR #60)
- `priority_tier` INT column on `data_sources` table (Tier 0=brand, 1=national, 2=international, 3=estimated)
- Brand detection module (`brandDetector.ts`): detects supermarket brands + chain slugs
- L1 lookup: `ORDER BY ds.priority_tier ASC NULLS LAST` in all 4 strategies
- Branded queries: `has_explicit_brand=true` → Tier 0 filter first, fallback to normal cascade
- 36 new tests

### F069 — Anonymous Identity (DONE, PR #61)
- `actors` table: `id` (UUID), `type` (enum: anonymous_web/telegram/authenticated), `external_id`, `locale`, `last_seen_at`
- Actor resolver middleware (`actorResolver.ts`): resolves X-Actor-Id header → upsert actor
- Per-actor rate limiting (`actorRateLimit.ts`): 50 queries/day, 10 photos/day via Redis
- `query_logs` table gained `actor_id` column (nullable, no FK)
- 25 new tests

### F070 — Conversation Core (DONE, PR #62)
- **ConversationCore service** in `packages/api/src/conversation/` (6 files):
  - `conversationCore.ts` — 5-step pipeline: load context → length guard → context-set → comparison → estimation
  - `entityExtractor.ts` — 6 pure functions copied from bot (detectContextSet, extractFoodQuery, extractPortionModifier, extractComparisonQuery, splitByComparator, parseDishExpression)
  - `chainResolver.ts` — pure in-memory 4-tier matching (loaded at plugin init) + `loadChainData(db)`
  - `contextManager.ts` — Redis `conv:ctx:{actorId}` (7200s TTL, fail-open, raw redis not cacheGet/cacheSet)
  - `estimationOrchestrator.ts` — cache → brand detect → `runEstimationCascade()` → portion multiply → cache write
  - `types.ts` — ConversationRequest, ConversationContext, ChainRow, ResolvedChain
- **New endpoint:** `POST /conversation/message` (route in `packages/api/src/routes/conversation.ts`)
  - Body: `{ text, chainSlug?, chainName? }` (legacy context passthrough for `/contexto` compat)
  - Returns: `{ success: true, data: ConversationMessageData }` with intent enum
  - Intents: `context_set`, `comparison`, `estimation`, `text_too_long`
  - `usedContextFallback` flag for adapter context footer
  - Rate limit shares `queries` bucket with `GET /estimate` (50/day)
  - Query logging: estimation=1, comparison=2, context_set=1, text_too_long=1
- **Shared schemas:** `packages/shared/src/schemas/conversation.ts` — ConversationMessageBodySchema, ConversationIntentSchema, ConversationMessageDataSchema, ConversationMessageResponseSchema
- **`applyPortionMultiplier` extracted** to `packages/api/src/estimation/portionUtils.ts` (shared by estimate route + orchestrator)
- **Bot adapter refactored:** `handleNaturalLanguage()` → thin adapter calling `apiClient.processMessage()` → switch on intent → format with existing Telegram formatters
- **Architecture decisions:** AD-F070-1 (bot calls via HTTP), AD-F070-2 (context keyed by actor_id, per-channel), AD-F070-3 (pure functions copied not moved), AD-F070-4 (ChainResolver in-memory), AD-F070-5 (Redis-only context)
- **Reviews:** Spec reviewed by Gemini+Codex (11 issues fixed). Plan reviewed by Gemini+Codex (10 issues fixed). Code review: 2 Important fixed (usedContextFallback, dead redis param). Production validator: 0 issues. QA: verified + 19 edge cases.
- **129 F070 tests** (110 API + 19 QA edge cases), 27 shared schema tests, bot adapter tests. All pass.

## Phase A0 Progress (COMPLETE)

| Feature | Status | PR | Tests Added |
|---------|--------|-----|-------------|
| **F068** Provenance Graph | **done** | #60 | +36 |
| **F069** Anonymous Identity | **done** | #61 | +25 |
| **F070** Conversation Core | **done** | #62 | +129 |

## CI/CD Known Issue

**test-api job fails in CI** with 178 pre-existing test failures (NOT from F070). Root causes:
1. **~148 rate limit 429s:** Route integration tests (f020-f042) don't mock F069 actor rate limiter → get 429 instead of expected status codes
2. **~5 `priorityTier` in source:** F068 added `priorityTier` to source object, old tests use exact `toEqual()` without the new field
3. **~19 integration tests needing live DB:** seed/migration tests fail without DB fixtures

**All F070 tests pass.** test-bot (1103), test-shared (366), test-scraper (232) all green.

## Known Technical Debt

1. **Code duplication (AD-F070-3):** Pure functions exist in both bot and API packages. Bot copies are "dead code in waiting" — still used by `/estimar`, `/comparar`, `/contexto` commands directly. Will self-resolve when those commands migrate to ConversationCore.
2. **EstimationOrchestrator DI inconsistency:** Uses `cacheGet`/`cacheSet` singleton Redis instead of injected Redis. Works correctly but breaks DI principle of rest of conversation module.
3. **CI test failures:** Pre-existing from F068/F069, should be fixed before adding more features.

## Phase A1 Roadmap

| ID | Feature | Days | Depends On |
|----|---------|------|------------|
| **F071** | BEDCA Food Database Import | 3-4 | E006 ✅ |
| **F072** | Cooking Profiles + Yield Factors | 3-4 | F071 |
| **F073** | Spanish Canonical Dishes (300) | 4-5 | F071 + F072 |
| **F074** | L4 Cooking State Extraction | 2-3 | F072 |
| **F075** | Audio Input (Whisper → ConversationCore) | 3-4 | F070 ✅ |
| **F076** | "Modo menú del día" | 2-3 | F073 |
| **F077** | Alcohol nutrient support | 2 | F071 |
| **F078** | Regional aliases + "Modo España Real" | 2 | F073 |
| **F079** | Demand-driven expansion pipeline | 2 | F073 |

## Backend Architecture (Updated)

- **Stack:** Fastify + Prisma + Kysely + PostgreSQL 16 (pgvector, pg_trgm) + Redis
- **Deploy:** Render (staging: develop, prod: main) + Supabase + Upstash
- **Estimation cascade:** L1 (official, priority_tier ordered) → L2 (ingredients) → L3 (pgvector) → L4 (LLM)
- **Identity:** actors table (anonymous_web / telegram / authenticated), X-Actor-Id header, per-actor rate limits
- **Provenance:** priority_tier on data_sources (0=brand, 1=national, 2=international, 3=estimated)
- **Conversation:** ConversationCore pipeline in packages/api/src/conversation/. POST /conversation/message. Bot = thin adapter.
- **17 Prisma migrations** up to `anonymous_identity_f069`
- **ADRs:** 16 total (ADR-000 through ADR-016)
- **Chains:** 14 active (mcdonalds-es, burger-king-es, kfc-es, telepizza-es, etc.)

## Bot Architecture

- **Stack:** node-telegram-bot-api + ApiClient (HTTP) + Redis state
- **NL handler (F070):** Thin adapter → `apiClient.processMessage(text, chatId, legacyChainContext)` → switch on intent → format with existing MarkdownV2 formatters
- **Commands:** /estimar, /comparar, /receta, /restaurante, /contexto, /cadenas, /start, /ayuda (still call API directly, not via ConversationCore)
- **Features:** File upload (photo/document), menu analysis, portion-aware, conversational context

## Test Baseline (Updated)

| Package | Tests | Notes |
|---------|-------|-------|
| API | ~2153 passing (178 pre-existing failures) | Vitest. +129 from F070 |
| Bot | 1103 | All pass |
| Shared | 366 | All pass. +27 from F070 |
| Scraper | 232 | All pass |
| Landing | 659 | Jest + RTL |
| API E2E | 10 | Real HTTP server |

## Key Files to Read First

| File | Purpose |
|------|---------|
| `docs/research/product-evolution-analysis-2026-03-31.md` | **READ FIRST** — All Phase 2 decisions |
| `docs/project_notes/product-tracker.md` | Active Session + feature tables |
| `docs/project_notes/key_facts.md` | Stack, data sources, modules, endpoints |
| `docs/project_notes/decisions.md` | ADR-000 through ADR-016 |
| `.claude/skills/development-workflow/SKILL.md` | SDD workflow steps |
| `CLAUDE.md` | Autonomy level, session recovery |
| `packages/api/src/conversation/conversationCore.ts` | F070 core — 5-step pipeline |
| `packages/api/src/routes/conversation.ts` | POST /conversation/message route |
| `packages/api/src/conversation/types.ts` | ConversationRequest, ConversationContext types |
| `docs/tickets/F070-conversation-core.md` | F070 ticket — complete spec + plan + architecture decisions |

## User Preferences

- Senior developer — pragmatic YAGNI, no over-engineering
- Communication in Spanish, all code/docs/commits in English
- After feature completion, wants /context-prompt
- Complete ALL ticket sections before requesting merge approval
- SDD workflow mandatory for all features
- Cross-model reviews with Gemini CLI (`gemini`) and Codex CLI (`codex exec -`)
- Likes detailed progress summaries at milestones — don't go silent during long agent work
- **Extended autonomy for Phase A0:** User authorized proceeding through Spec → Plan → Implement without stopping at intermediate checkpoints. Only stop at Merge Approval (mandatory in L2). May grant same for Phase A1 — ask.

## Pending Actions

1. **OPTIONAL: Fix CI test failures** — 178 pre-existing failures in test-api (rate limit 429s + priorityTier + DB integration). Not from F070 but should be addressed before Phase A1.
2. **Start Phase A1 — F071 (BEDCA Food Database Import):** Scrape BEDCA XML API, ~431 foods with bilingual names, seed script. Standard complexity. Use `start task F071`.
3. **develop → main sync pending** — F068+F069+F070 merged to develop but not yet in main. Deploy when ready.

## Workflow Recovery

- **Current step:** No active feature
- **Pending checkpoints:** None
- **Next action:** Start F071 or fix CI failures first. Read product-evolution-analysis Section 5 for BEDCA strategy. Use `start task F071`.

---
Generated: 2026-04-03 after Phase A0 complete (F068+F069+F070). Phase A1 ready.
