# Context Recovery — nutriXplorer (foodXPlorer) — 2026-04-07 (Post-Phase B Audit, Ready for Punto 4)

## Project State

- **Branch:** `develop` (clean working tree)
- **Last commit:** `71c8dd0` — docs: create Phase B audit findings log
- **Previous:** `a167bfc` — docs: fix 15 issues found in cross-model manual review
- **SDD DevFlow version:** 0.15.0
- **Autonomy Level:** L2 (Trusted) — Plan Approval + Merge Approval required
- **Branching:** gitflow — develop (integration) + main (production)
- **develop and main are in sync** — Phase B complete, synced after F089

## What Was Completed This Session

### Session Summary

1. **F087** — "El Tupper" Meal Prep (Simple, PR #80). Optional `portions` param on `POST /calculate/recipe` (1-50). `perPortion` nutrients (total ÷ N). Bot detects "dividir en N tuppers" patterns. 33 tests. Code review: APPROVED WITH MINOR CHANGES (1 fix: OpenAPI $ref+nullable).

2. **F089** — "Modo Tapeo" (Simple, PR #81). `diners` + `perPerson` fields on `MenuEstimationDataSchema`. Bot detects "para N personas/comensales/gente" (4 patterns). Diners extracted BEFORE menu detection. Formatter shows per-person line. 22 tests. Code review: APPROVED.

3. **develop → main sync** — Phase B complete (F080-F089). 141 files changed, +14,159 lines.

4. **Manual updates (Punto 1)** — Bot manual: added §20-23 (enrichments, reverse search, El Tupper, Modo Tapeo). API manual: added §20-21 (reverse-search endpoint, estimation enrichments), updated recipe with portions, conversation with reverse_search intent and diners.

5. **Real API testing (Punto 2)** — Tested all Phase B features against production API. Found 3 code bugs (C1-C3) + 4 doc errors (D1-D4). Doc errors fixed immediately.

6. **Cross-model review (Punto 3)** — Gemini + Codex GPT-5.4 reviewed both manuals against source code. Found 13 additional doc issues (D5-D17). All 17 doc fixes applied. Verdicts: all 4 reviews said REVISE → all fixed.

### Phase B Features (all done)

| ID | Feature | PR | Tests | Status |
|----|---------|-----|-------|--------|
| F080 | OFF Prepared Foods | #72 | 146 | done |
| F081 | Health-Hacker Tips | #73 | 41 | done |
| F082 | Nutritional Substitutions | #74 | 39 | done |
| F083 | Allergen Cross-Reference | #75 | 50 | done |
| F084 | Uncertainty Ranges | #76 | 26 | done |
| F085 | Portion Sizing Matrix | #77 | 30 | done |
| F086 | Reverse Search | #78 | 136 | done |
| F087 | El Tupper Meal Prep | #80 | 33 | done |
| F088 | Community Inline Corrections | — | — | **postponed** |
| F089 | Modo Tapeo | #81 | 22 | done |

## Active Work — Post-Phase B Audit

**No active feature.** The user is executing a 5-point audit plan before starting Phase C:

### Audit Plan Progress

| # | Step | Status | Notes |
|---|------|--------|-------|
| 1 | Update manuals for Phase B | **DONE** | Bot §20-23, API §20-21 |
| 2 | Real API testing + manual audit | **DONE** | 3 code bugs + 4 doc errors found, doc errors fixed |
| 3 | Cross-model manual review | **DONE** | Gemini + Codex. 13 more doc issues found + fixed (17 total) |
| **4** | **Exhaustive real API testing** | **NEXT** | Edge cases, error handling, improvements |
| 5 | Confirm stability → start Phase C | pending | |

### Pending Code Bugs (from audit)

Full details in `docs/project_notes/audit-phase-b-findings.md`.

| ID | Severity | Finding |
|----|----------|---------|
| C1 | HIGH | `/reverse-search` 404 CHAIN_NOT_FOUND returns `{success, code, message}` instead of `{success, error: {code, message}}` — inconsistent error envelope |
| C3 | HIGH | `/reverse-search` 400 validation error returns raw Zod `{formErrors, fieldErrors}` without standard wrapper |
| C2 | MEDIUM | Conversation context doesn't persist between requests with same X-Actor-Id. Pre-existing (F069/F070). Works when chain is passed in request body. |

**User decision:** Fix these bugs AFTER the full audit (punto 4+5), using the SDD workflow, not ad-hoc. This allows planned, documented fixes.

## Current Test Counts

| Package | Tests | Status |
|---------|-------|--------|
| Shared | 475 | All passing |
| API | 3,137 | All passing |
| Bot | 1,198 | All passing |
| Landing | 678 (+3 todo) | All passing |
| **Total** | **~5,488 vitest + 678 Jest** | **Build clean** |

## Infrastructure

### Deployment
- **API Production:** https://api.nutrixplorer.com (Render, main branch) — **deployed with Phase B**
- **API Staging:** https://api-dev.nutrixplorer.com (Render, develop branch)
- **Bot Staging/Prod:** Render workers (develop/main)
- **DB:** Supabase PostgreSQL (pgvector + pg_trgm), port 6543
- **Cache:** Upstash Redis

### API Keys Available
- `$API_KEY` — for authenticated requests
- `$ADMIN_API_KEY` — for admin endpoints
- `$BOT_API_KEY` — bot-specific key

### Key Architecture
- **Monorepo:** npm workspaces — packages/api, packages/bot, packages/shared, packages/scraper, packages/landing
- **Dual ORM:** Prisma (migrations, CRUD) + Kysely (complex queries, pgvector)
- **Estimation Engine:** 4-level cascade + OFF pre-check + enrichments (tips, substitutions, allergens, uncertainty, portion sizing)
- **ConversationCore:** Intent pipeline: context_set → reverse_search → comparison → menu_estimation → estimation
- **14 chains + 1 virtual** (cocina-espanola with 250 dishes)

### Key Files

| Component | File |
|-----------|------|
| Audit findings | `docs/project_notes/audit-phase-b-findings.md` |
| Product tracker | `docs/project_notes/product-tracker.md` |
| Bot manual | `docs/user-manual-bot.md` |
| API manual | `docs/api-manual.md` |
| Key facts | `docs/project_notes/key_facts.md` |
| Reverse search route | `packages/api/src/routes/reverseSearch.ts` |
| ConversationCore | `packages/api/src/conversation/conversationCore.ts` |
| Entity extractor | `packages/api/src/conversation/entityExtractor.ts` |
| Diners extractor | `packages/api/src/conversation/dinersExtractor.ts` |
| Tupper extractor | `packages/bot/src/commands/tupperExtractor.ts` |
| Estimate route | `packages/api/src/routes/estimate.ts` |
| Recipe route | `packages/api/src/routes/recipeCalculate.ts` |
| Enrichments | `packages/api/src/estimation/healthHacker.ts`, `substitutions.ts`, `allergenDetector.ts`, `uncertaintyCalculator.ts`, `portionSizing.ts` |
| API spec | `docs/specs/api-spec.yaml` |

## Epics Progress

| Epic | Name | Status | Features |
|------|------|--------|----------|
| E001-E005 | Phase 1 (Infra→Bot) | done | F001-F037 |
| E006 | Structural Foundations | done | F068-F070 |
| E007 | Spanish Food Coverage | done | F071-F079 |
| **E008** | **Conv. Assistant & Voice** | **in-progress** | F080-F089 done (Phase B), F088 postponed, F090-F097 pending (Phase C) |
| E009 | Personalization & Tracking | pending | F098-F099 |
| E010 | Scale & Monetization | pending | F100-F109 |

## Security Backlog

10 items from pre-Phase B QA audit. See product-tracker.md "Security & Robustness Backlog". To address before public launch.

## User Preferences

- Senior developer — pragmatic YAGNI, no over-engineering
- Communication in Spanish, all code/docs/commits in English
- Authorized autonomous progression for Simple features (merge approval still required at L2)
- For Standard features, autonomous if spec+plan look correct. Self-review + /review-spec + /review-plan.
- After feature completion, generate context prompt via `/context-prompt`
- Show task progress summaries after completing steps
- Use `/audit-merge` (Action 9) before requesting merge approval (new in v0.15.0)
- F088 postponed — user decision to skip it in Phase B

## Next Action

**Punto 4 — Exhaustive real API testing against staging and production.**

Test systematically:
1. All estimation endpoints (GET /estimate) with various queries, chains, edge cases
2. Recipe calculation (POST /calculate/recipe) — structured + free-form + portions
3. Conversation intents — all 5 types (context_set, estimation, comparison, menu_estimation, reverse_search)
4. Reverse search (GET /reverse-search) — valid, invalid, edge cases
5. Catalog endpoints (chains, dishes, restaurants)
6. Error handling — 400, 401, 404, 422, 429 responses
7. Rate limiting behavior
8. Cache behavior (cachedAt field)

Record ALL findings in `docs/project_notes/audit-phase-b-findings.md` → "Pending from Punto 4" section.

After Punto 4, the user wants to fix all code bugs (C1-C3 + any new findings) using the SDD workflow, then confirm stability and start Phase C (F090-F097, frontend features).

---
Generated: 2026-04-07. Purpose: Continue audit after /compact or new session.
