# Context Recovery — nutriXplorer (foodXPlorer) — 2026-04-08 (Phase C Start)

## Project State

- **Branch:** `develop` (clean working tree)
- **Last commit:** `b7aa1f9` — docs: complete Step 6 for BUG-AUDIT-C5 — all audit bugfixes done
- **Previous relevant:** `f747679` (PR #84), `3a8732f` (PR #83), `f994f83` (PR #82)
- **SDD DevFlow version:** 0.15.0
- **Autonomy Level:** L2 (Trusted) — Plan Approval + Merge Approval required
- **Branching:** gitflow — develop (integration) + main (production)
- **develop is ahead of main** — 3 bugfix PRs merged to develop since last sync

## What Was Completed Before This Session

### Phase B (E008, F080-F089) — ALL DONE

| ID | Feature | PR | Tests |
|----|---------|-----|-------|
| F080 | OFF Prepared Foods | #72 | 146 |
| F081 | Health-Hacker Tips | #73 | 41 |
| F082 | Nutritional Substitutions | #74 | 39 |
| F083 | Allergen Cross-Reference | #75 | 50 |
| F084 | Uncertainty Ranges | #76 | 26 |
| F085 | Portion Sizing Matrix | #77 | 30 |
| F086 | Reverse Search | #78 | 136 |
| F087 | El Tupper Meal Prep | #80 | 33 |
| F088 | Community Inline Corrections | — | **postponed** |
| F089 | Modo Tapeo | #81 | 22 |

### Post-Phase B Audit — COMPLETE

5-point audit with manual testing, cross-model review (Gemini + Codex), and exhaustive API testing. Found 7 issues total:

| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| C1 | HIGH | `/reverse-search` 404 wrong error envelope | **fixed** (PR #82) |
| C3 | HIGH | `/reverse-search` 400 raw Zod error | **fixed** (PR #82) |
| C2 | MEDIUM | Conversation context doesn't persist (pre-existing F069/F070) | **deferred** |
| C4 | MEDIUM | POST empty body → 500 instead of 400 | **fixed** (PR #83) |
| C5 | MEDIUM | Reverse search via conversation silent catch | **fixed** (PR #84) |
| C6 | LOW | Pizza data corruption (scraping issue) | **deferred** |
| A1 | LOW | Bot rate limit shared bucket for all users | **deferred** |

Full findings: `docs/project_notes/audit-phase-b-findings.md`

## Current Test Counts

| Package | Tests | Status |
|---------|-------|--------|
| Shared | 475 | All passing |
| API | 3,150 | All passing |
| Bot | 1,198 | All passing |
| Landing | 678 (+3 todo) | All passing |
| **Total** | **~5,501 vitest + 678 Jest** | **Build clean** |

## Phase C — What To Build

**Epic E008 continues.** Phase C = Conversational Web Assistant + Realtime Voice.

All Phase C features are **frontend** (packages/landing or new package). The API backend is stable — all endpoints needed by Phase C already exist.

| ID | Feature | Type | Complexity | Notes |
|----|---------|------|-----------|-------|
| **F090** | Web Assistant: Shell + Text Mode (/hablar) | frontend | Standard | Next.js route /hablar. ConversationCore integration. Text input → JSON response → NutritionCard UI |
| F091 | Web Assistant: Async Voice (STT → Core → TTS) | frontend | Standard | Whisper transcription → ConversationCore → TTS response. Push-to-talk UX |
| F092 | Web Assistant: Plate Photo Upload | frontend | Standard | Photo → /analyze/menu pipeline → results in UI |
| F093 | Web Assistant: Landing Integration + Analytics | frontend | Simple | CTA from landing → /hablar. Analytics events |
| F094 | Voice Spike: Evaluate Browser-Side STT/TTS vs Cloud | research | — | Compare Web Speech API, Whisper.cpp, Deepgram, OpenAI Realtime |
| F095 | Realtime Voice: Implement Chosen Architecture | frontend | Standard | Based on F094 results |
| F096 | Realtime Voice: Pause Detection + Barge-In | frontend | Standard | End-of-speech, interruption, filler audio |
| F097 | Realtime Voice: Frontend States + Mobile QA | frontend | Standard | Listening/Processing/Speaking/Results states |

### Recommended Order

1. **F090 first** — foundation for all other Phase C features
2. F091 — voice on top of F090
3. F092 — photo upload on top of F090
4. F093 — landing integration (can be done anytime after F090)
5. F094 → F095 → F096 → F097 — realtime voice (sequential)

### Critical Reference Document

Before creating ANY spec for F090-F097:
```
MUST READ: docs/research/product-evolution-analysis-2026-03-31.md
```
This document contains the approved strategy, architectural decisions, voice architecture notes, and cross-model reviewed rationale for every feature. Do NOT invent requirements — derive them from that document.

## API Endpoints Available for Phase C

The frontend will consume these existing endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/conversation/message` | POST | Text conversation (all 5 intents) |
| `/conversation/audio` | POST | Audio → Whisper → ConversationCore |
| `/estimate` | GET | Single-dish estimation |
| `/calculate/recipe` | POST | Recipe calculation |
| `/reverse-search` | GET | Find dishes by calorie/protein budget |
| `/analyze/menu` | POST | Photo/PDF → dish extraction + estimation |
| `/chains` | GET | List all chains |
| `/restaurants` | GET | List/search restaurants |
| `/dishes/search` | GET | Search dishes |
| `/health` | GET | Health check |

**API URLs:**
- Staging: `https://api-dev.nutrixplorer.com`
- Production: `https://api.nutrixplorer.com`

**Auth:** `x-api-key` header (optional for public endpoints, required for admin).

**Conversation intents:** `context_set`, `estimation`, `comparison`, `menu_estimation`, `reverse_search`

## Infrastructure

### Deployment
- **API Production:** https://api.nutrixplorer.com (Render, main branch)
- **API Staging:** https://api-dev.nutrixplorer.com (Render, develop branch)
- **Bot Staging/Prod:** Render workers (develop/main)
- **DB:** Supabase PostgreSQL (pgvector + pg_trgm), port 6543
- **Cache:** Upstash Redis
- **Landing:** packages/landing (Next.js 14 + Tailwind + Framer Motion)

### Key Architecture
- **Monorepo:** npm workspaces — packages/api, packages/bot, packages/shared, packages/landing, packages/scraper
- **Dual ORM:** Prisma (migrations, CRUD) + Kysely (complex queries, pgvector)
- **Estimation Engine:** 4-level cascade + OFF pre-check + enrichments
- **ConversationCore:** Intent pipeline: context_set → reverse_search → comparison → menu_estimation → estimation
- **14 chains + 1 virtual** (cocina-espanola with 250 dishes), 1135 total dishes
- **Landing:** Next.js 14, Tailwind CSS, Framer Motion, 3 A/B variants (A/C/F)

### Key Files

| Component | File |
|-----------|------|
| Product evolution analysis | `docs/research/product-evolution-analysis-2026-03-31.md` |
| Product tracker | `docs/project_notes/product-tracker.md` |
| Key facts | `docs/project_notes/key_facts.md` |
| Decisions | `docs/project_notes/decisions.md` |
| Audit findings | `docs/project_notes/audit-phase-b-findings.md` |
| Bot manual | `docs/user-manual-bot.md` |
| API manual | `docs/api-manual.md` |
| API spec | `docs/specs/api-spec.yaml` |
| ConversationCore | `packages/api/src/conversation/conversationCore.ts` |
| Conversation route | `packages/api/src/routes/conversation.ts` |
| Entity extractor | `packages/api/src/conversation/entityExtractor.ts` |
| Estimate route | `packages/api/src/routes/estimate.ts` |
| Landing app | `packages/landing/src/app/` |
| Landing components | `packages/landing/src/components/` |
| Design guidelines | `docs/specs/design-guidelines.md` (if exists) |

## Epics Progress

| Epic | Name | Status | Features |
|------|------|--------|----------|
| E001-E005 | Phase 1 (Infra→Bot) | done | F001-F037 |
| E006 | Structural Foundations | done | F068-F070 |
| E007 | Spanish Food Coverage | done | F071-F079 |
| **E008** | **Conv. Assistant & Voice** | **in-progress** | F080-F089 done (Phase B), **F090-F097 pending (Phase C)** |
| E009 | Personalization & Tracking | pending | F098-F099 |
| E010 | Scale & Monetization | pending | F100-F109 |

## Security Backlog

10 items from pre-Phase B QA audit. See product-tracker.md "Security & Robustness Backlog". To address before public launch.

## Deferred Items

- **F088** — Community Inline Corrections (postponed from Phase B)
- **F062** — Landing Assets & Hero Image Refresh (pending)
- **C2** — Conversation context persistence (pre-existing, medium)
- **C6** — Pizza data corruption (scraping, low)
- **A1** — Bot rate limit shared bucket (architectural, low)

## User Preferences

- Senior developer — pragmatic YAGNI, no over-engineering
- Communication in Spanish, all code/docs/commits in English
- Authorized autonomous progression for Simple features (merge approval still required at L2)
- For Standard features, autonomous if spec+plan look correct. Self-review + /review-spec + /review-plan
- After feature completion, generate context prompt via `/context-prompt`
- Show task progress summaries after completing steps
- Use `/audit-merge` (Action 9) before requesting merge approval
- F088 postponed — user decision to skip it in Phase B

## Workflow Recovery

- **No active feature.** Ready to start Phase C.
- **Next feature:** F090 — Web Assistant: Shell + Text Mode (/hablar)
- **Complexity:** Standard → Steps 0→1→2→3→4→5(+QA)→6
- **Step order reminder:** Spec → Setup → Plan → Implement → Finalize → Review → Complete
- **After commit+PR:** Run code-review-specialist and qa-engineer (Step 5), then execute merge-checklist actions. Do NOT request merge approval without completing the checklist.
- **Before requesting merge approval:** Read `references/merge-checklist.md` and execute ALL actions (0-9). Fill the `## Merge Checklist Evidence` table in the ticket with real evidence.

## Next Action

**Start F090 — Web Assistant: Shell + Text Mode (/hablar).**

1. Read `docs/research/product-evolution-analysis-2026-03-31.md` (MANDATORY before spec)
2. Classify complexity (Standard expected)
3. Run `start task F090` to begin the SDD workflow
4. Step 0: Spec — Use `spec-creator` agent, then self-review + `/review-spec`

F090 is the foundation for all Phase C features. It creates a new `/hablar` route in the landing package that integrates with the existing ConversationCore API via `POST /conversation/message`. The user types natural language, the API returns structured data, and the frontend renders it as nutrition cards.

**Note:** The user mentioned wanting to start Phase C in a separate session from the bugfix session. This prompt is designed for that new session. The API backend is stable and all bugfixes are merged to develop.

---
Generated: 2026-04-08. Purpose: Start Phase C in a new session.
