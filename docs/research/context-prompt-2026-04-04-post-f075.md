# Context Recovery — nutriXplorer (foodXPlorer) — 2026-04-04 (F075 Complete)

## Project State

- **Branch:** develop (clean working tree)
- **Last commit:** 60b31f7 — docs: complete F075 — update tracker, clear active session
- **Previous commits:** 6f29fc5 (F075 merged, PR #67), 585cef2 (context prompt post-F074)
- **SDD DevFlow version:** 0.13.2
- **Autonomy Level:** L2 (Trusted) — Plan Approval + Merge Approval require user confirmation
- **Branching:** gitflow — develop (integration) + main (production) + feature/*
- **develop ahead of main by 13 commits** (F071 + F072 + F073 + F074 + F075 not yet in main)

## Workflow

- Follow SDD development workflow (`.claude/skills/development-workflow/SKILL.md`)
- Read CLAUDE.md section 2 for autonomy level
- Read `docs/project_notes/key_facts.md` for branching strategy

## Active Feature

**No active work.** F075 complete. Ready for **next feature in Phase A1** (F076-F079).

## CRITICAL: Product Evolution Analysis

**Before starting ANY feature F068-F109, you MUST read:**
`docs/research/product-evolution-analysis-2026-03-31.md`

This document (1500+ lines, 4 iterations, reviewed by Claude + Gemini + Codex) contains ALL approved decisions, architecture, data source strategy, voice architecture notes, and rationale for every planned feature. **Do NOT invent requirements — derive them from that document.**

## Session Summary — What Was Done Today (2026-04-04)

### F075 — Audio Input (Whisper → ConversationCore) (DONE, PR #67)
- **Problem solved:** Telegram bot only accepted text input. Spain's voice-note culture meant users couldn't say "me he comido dos pinchos de tortilla y una caña" — they had to type it.
- **Solution:** New `POST /conversation/audio` API endpoint: multipart OGG upload → OpenAI Whisper transcription (`whisper-1`, `language: 'es'`, `temperature: 0`) → ConversationCore pipeline → same `ConversationMessageData` response as text.
- **Key changes:**
  - `openaiClient.ts`: `callWhisperTranscription` (2-attempt retry, returns null on failure), `isWhisperHallucination` (8 known strings, normalized: trim+lowercase+strip trailing punctuation), `WHISPER_HALLUCINATIONS` set
  - `conversation.ts`: `POST /conversation/audio` route — multipart parsing via `request.parts()`, MIME validation (ogg/mpeg/mp4/wav/webm), `duration` field validation (0-120s, API-side), hallucination filter, pipe to `processMessage()`, fire-and-forget query logging
  - `errorHandler.ts`: `EMPTY_TRANSCRIPTION` → 422, `TRANSCRIPTION_FAILED` → 502 (upstream failure semantics)
  - `actorRateLimit.ts`: `/conversation/audio` → `queries` bucket (shares 50/day with /estimate and /conversation/message)
  - `voice.ts` (bot, NEW): `handleVoice` — duration >120s and file_size >10MB guards (bot-side, before I/O), fail-open `sendChatAction('typing')`, `downloadTelegramFile`, `apiClient.sendAudio`, response formatting (same switch as naturalLanguage)
  - `apiClient.ts` (bot): `sendAudio` method — FormData multipart, `VOICE_TIMEOUT_MS = 30_000`, `X-Actor-Id: telegram:<chatId>`, `X-FXP-Source: bot`
  - `bot.ts`: `bot.on('voice', ...)` wired with catch + logger
  - `OpenAILogger` type: Added `error` method (was missing, caused TS errors)
- **No schema migration, no new API endpoints beyond /conversation/audio, no new tables**
- **Reviews:** Spec (Gemini+Codex, 10 issues fixed), Plan (Gemini+Codex, 10 issues fixed), Production validator (4 issues fixed), Code review (APPROVED, 3 findings fixed), QA (30 edge-case tests, 1 bug fixed)
- **Bugs fixed:** BUG-F075-01 (sendChatAction outside try/catch in handleVoice — propagated errors left user with no response; wrapped in fail-open try/catch)
- **71 F075 tests** (18 whisper unit + 12 route + 16 API edge cases + 11 voice handler + 14 voice edge cases). All pass.

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

## Phase A1 Roadmap (Remaining)

| ID | Feature | Days | Depends On | Notes |
|----|---------|------|------------|-------|
| **F076** | "Modo menú del día" | 2-3 | F073 ✅ | primero + segundo + postre + bebida |
| **F077** | Alcohol nutrient support | 2 | F071 ✅ | Add alcohol field (7 kcal/g). BEDCA has alcohol data |
| **F078** | Regional aliases + "Modo España Real" | 2 | F073 ✅ | caña=cerveza, pintxo=tapa, media ración=0.5x |
| **F079** | Demand-driven expansion pipeline | 2 | F073 ✅ | Monitor /estimate null queries, monthly batch add top 20 |

## Backend Architecture (Updated)

- **Stack:** Fastify + Prisma + Kysely + PostgreSQL 16 (pgvector, pg_trgm) + Redis
- **Deploy:** Render (staging: develop, prod: main) + Supabase + Upstash
- **Estimation cascade:** L1 (official, priority_tier ordered) → L2 (ingredients) → L3 (pgvector) → L4 (LLM)
- **L4 Strategy B (F074):** Extracts per-ingredient state+method from LLM. Applies yield per ingredient before aggregation. Precedence: explicit > llm_extracted > default.
- **Yield correction:** `resolveAndApplyYield()` after cascade (L1-L3, Strategy A) or per-ingredient inside Strategy B (F074)
- **Voice (F075):** `POST /conversation/audio` — multipart OGG → `callWhisperTranscription` (retry, hallucination filter) → `processMessage()`. Bot: `handleVoice` with duration/size guards, `VOICE_TIMEOUT_MS=30s`. Error codes: EMPTY_TRANSCRIPTION (422), TRANSCRIPTION_FAILED (502).
- **Identity:** actors table (anonymous_web / telegram / authenticated), X-Actor-Id header, per-actor rate limits
- **Provenance:** priority_tier on data_sources (0=brand, 1=national, 2=international, 3=estimated)
- **Conversation:** ConversationCore pipeline in packages/api/src/conversation/. POST /conversation/message + POST /conversation/audio. Bot = thin adapter.
- **BEDCA:** XML parser + nutrient mapper in packages/api/src/ingest/bedca/. Feature flag `BEDCA_IMPORT_ENABLED`.
- **Cooking profiles:** 60 entries in cooking_profiles table. Yield factors. Fat absorption for frying.
- **Cocina Española:** 250 dishes in virtual restaurant `cocina-espanola`. BEDCA Tier 1 + recipe-estimated Tier 3.
- **19 Prisma migrations** up to `cooking_profiles_f072` (no new migration for F073, F074, or F075)
- **ADRs:** 16 total (ADR-000 through ADR-016)
- **Chains:** 14 active + 1 virtual (cocina-espanola)

## Bot Architecture (Updated)

- **Stack:** node-telegram-bot-api + ApiClient (HTTP) + Redis state
- **NL handler (F070):** Thin adapter → `apiClient.processMessage(text, chatId, legacyChainContext)` → switch on intent → format with existing MarkdownV2 formatters
- **Voice handler (F075):** Thin adapter → guards → download → `apiClient.sendAudio(buffer, duration, chatId, legacyChainContext)` → same intent switch + formatters. Fail-open typing action. Specific error messages per code.
- **Commands:** /estimar, /comparar, /receta, /restaurante, /contexto, /cadenas, /start, /ayuda
- **Features:** File upload (photo/document), menu analysis, portion-aware, conversational context, voice input

## Test Baseline (Updated)

| Package | Tests | Notes |
|---------|-------|-------|
| API | 2557 passing (146 files) | Vitest. +46 from F074 baseline (18 whisper + 12 route + 16 edge) |
| Bot | 1128 (53 files) | +25 from F074 baseline (11 voice + 14 voice edge) |
| Shared | 413 | All pass |
| Scraper | 232 | All pass |
| Landing | 659 | Jest + RTL |
| API E2E | 10 | Real HTTP server (excluded from default run) |
| **Total** | **~4989** | +71 from F075 |

## CI/CD Notes

- **Integration tests excluded** from default vitest run (migration.*, seed.*, routes/ingest/*, routes/quality) — run with `vitest.integration.config.ts`
- **dist/** excluded from vitest (CJS import errors)
- **test-api, test-bot, test-shared, test-scraper** all green in CI

## Known Technical Debt

1. **Code duplication (AD-F070-3):** Pure functions exist in both bot and API packages. Will self-resolve when bot commands migrate to ConversationCore.
2. **Response formatting duplication (F075):** voice.ts and naturalLanguage.ts share the same intent→format switch. Same deferred resolution as #1.
3. **Query logging duplication (F075):** `logAudioQueryAfterReply` is ~100 lines copy-pasted from `logQueryAfterReply` in conversation.ts. Should extract shared helper.
4. **EstimationOrchestrator DI inconsistency:** Uses `cacheGet`/`cacheSet` singleton Redis instead of injected Redis.
5. **BEDCA placeholder IDs:** F071 uses 20 placeholder foods. Real BEDCA import (~431 foods) pending AESAN authorization.
6. **develop → main sync pending:** F071-F075 merged to develop but not yet in main (13 commits ahead).
7. **F073 category field:** `category` in JSON is metadata only — not persisted to DishDishCategory junction table.
8. **F074 aggregation loop duplication:** Two paths (corrected vs raw) in Strategy B aggregation. Accepted — avoids premature abstraction.
9. **F035 parseRecipeFreeForm.ts:** Uses similar LLM decomposition but lacks per-ingredient cooking state. Separate ticket needed to align with F074.
10. **Static hallucination list (F075):** 8 hardcoded strings. Acceptable for v1 — config would be over-engineering.

## Key Files to Read First

| File | Purpose |
|------|---------|
| `docs/research/product-evolution-analysis-2026-03-31.md` | **READ FIRST** — All Phase 2 decisions |
| `docs/project_notes/product-tracker.md` | Active Session + feature tables |
| `docs/project_notes/key_facts.md` | Stack, data sources, modules, endpoints |
| `docs/project_notes/decisions.md` | ADR-000 through ADR-016 |
| `.claude/skills/development-workflow/SKILL.md` | SDD workflow steps |
| `CLAUDE.md` | Autonomy level, session recovery |
| `packages/api/src/lib/openaiClient.ts` | F075 — Whisper transcription + hallucination filter |
| `packages/api/src/routes/conversation.ts` | F070+F075 — /conversation/message + /conversation/audio |
| `packages/bot/src/handlers/voice.ts` | F075 — Bot voice handler |
| `packages/bot/src/apiClient.ts` | F075 — sendAudio method |
| `packages/api/src/estimation/level4Lookup.ts` | F074 — L4 with per-ingredient yield |
| `packages/api/src/estimation/engineRouter.ts` | Engine cascade router (F074 bypass) |
| `packages/api/src/conversation/conversationCore.ts` | F070 — 5-step NL pipeline |
| `docs/tickets/F075-audio-input.md` | F075 ticket — full spec + plan + reviews |

## User Preferences

- Senior developer — pragmatic YAGNI, no over-engineering
- Communication in Spanish, all code/docs/commits in English
- After feature completion, wants /context-prompt
- Complete ALL ticket sections before requesting merge approval
- SDD workflow mandatory for all features
- Cross-model reviews with Gemini CLI (`gemini`) and Codex CLI (`codex exec -`)
- Likes detailed progress summaries at milestones — don't go silent during long agent work
- **Extended autonomy for Phase A1:** User authorized proceeding through Spec → Plan → Implement without stopping at intermediate checkpoints (only stop at Merge Approval which is mandatory in L2). Ask at the start of each feature if same autonomy applies.
- **Parallel features:** User authorized starting F076 in a worktree/background while waiting for F075 merge approval (this was done in-line instead since merge was fast).

## Pending Actions

1. **develop → main sync pending** — F071-F075 merged to develop but not yet in main (13 commits). Deploy when ready.
2. **Start next Phase A1 feature** — F076 (Menú del Día, Simple) through F079 (Demand-Driven, Simple). All dependencies met.
3. **Ask user** which feature to start next.

## Workflow Recovery

- **Current step:** No active feature
- **Pending checkpoints:** None
- **Next action:** Ask user which Phase A1 feature to start next. Use `start task F0XX`.

---
Generated: 2026-04-04 after F075 complete. Phase A1 in progress (F071-F075 done, F076-F079 pending).
