# Context Recovery Prompt — foodXPlorer @ 2026-04-17 (Post-Release)

## A) Project state

- Repo: pbojeda/foodyxplorer (GitHub, public)
- Primary working dir: /Users/pb/Developer/FiveGuays/foodXPlorer
- **Branch**: `chore/post-release-fixes-2026-04-17` (PR #139, 2 commits ahead of develop, CI in progress)
- **develop HEAD**: `bf1fb49` (merge-back main→develop post-release, PR #138)
- **main HEAD**: `7e56827` (release merge PR #136, 2026-04-16T15:18:42Z, 35 commits, 121 files)
- Working tree: clean (only `.claude/scheduled_tasks.lock` + `packages/landing/.gitignore` untracked — runtime artifacts)
- SDD DevFlow version: 0.17.2
- **Supabase password ROTATED 2026-04-17** (old password was exposed in chat). All Render env vars updated with new password.

### PR #139 — pending merge to develop

Branch `chore/post-release-fixes-2026-04-17` contains post-release fixes not yet on develop:

| Commit | Content |
|---|---|
| `33b6e04` | Seed CLI runner + expanded priority list (48 dishes) + key_facts search_path rule + standard-portions.csv (160 rows) |
| `234e128` | Step 10 tracker update + release incidents documented in bugs.md (3 entries) |

**Action required**: merge PR #139 to develop (squash OK) when CI green. Then merge-back main→develop if needed (but main hasn't changed since last merge-back).

---

## B) Release merge #136 — completed 2026-04-16

The release `develop → main` landed as merge commit `7e56827` (PR #136, `--merge` strategy preserving 35-commit history). This was the first production deploy since `bf2b9b5` (2026-04-15).

### What was released

- **BUG-PROD-001** through **BUG-PROD-007** (7 production bugfixes)
- **F-UX-A** (size modifier display: PORCIÓN GRANDE pill + base kcal)
- **F-UX-B** (Spanish portion terms: 3-tier fallback, StandardPortion model, seed pipeline)
- **BUG-PROD-004 FU1 cycle** (deploy-landing.yml removal: 3 sub-tickets, 4-quadrant verification)
- **BUG-PROD-005** (Render build filters: Option B manual dashboard config)
- **SDD DevFlow** 0.16.9 → 0.17.0 → 0.17.2
- **Workflow removals**: `deploy-web.yml` + `deploy-landing.yml` deleted from main
- **F-UX-B migration**: `20260413180000_standard_portions_f-ux-b` (destructive DROP+CREATE of `standard_portions`)

### Pre-release preparation PRs

| PR | Purpose |
|---|---|
| #134 | BUG-PROD-005 docs + empirical test vector |
| #135 | BUG-PROD-005 tracker-sync close |
| #136 | Release merge develop→main (35 commits) |
| #137 | Pre-release sync main→develop (resolve touch-comment conflict in `packages/landing/next.config.mjs`) |
| #138 | Post-release merge-back main→develop (gitflow parity) |
| #139 | Post-release fixes (seed CLI, expanded portions, search_path rule, step 10 tracker) — **pending merge** |

---

## C) Three deployment incidents (all resolved)

### RELEASE-INCIDENT-001 (P1): Supabase `search_path` empty on transaction pooler

- **Symptom**: All `/conversation/message` and `/estimate` queries returned `DB_UNAVAILABLE` — `relation "dish_nutrients" does not exist`
- **Root cause**: Supabase transaction pooler (port 6543) executes `DISCARD ALL` between sessions, resetting `search_path` to empty. Prisma/Kysely emit unqualified table names → Postgres can't resolve them
- **Diagnosis path** (for future reference): `/health?db=true` passed (SELECT 1 doesn't need search_path) → `docker psql` against pooler URL showed `search_path: (empty)` → `SELECT COUNT(*) FROM public.dish_nutrients` worked (qualified) but `FROM dish_nutrients` failed (unqualified)
- **Attempted fixes that DID NOT work**: (1) `ALTER ROLE postgres SET search_path` → overridden by DISCARD ALL; (2) `?options=-c%20search_path%3Dpublic` in URL → silently ignored by Supavisor
- **Fix**: Changed `DATABASE_URL` on Render from port 6543 → **5432** (session pooler). Session pooler preserves search_path. Applied to `nutrixplorer-api-dev` + `nutrixplorer-api-prod`
- **CRITICAL rule** (documented in `key_facts.md`): ALL `DATABASE_URL` must use port 5432, NEVER 6543
- **Duration**: ~2h prod degradation (intermittent — Redis cache masked some failures)

### BUG-PROD-008 (P2): Photo upload `UNAUTHORIZED`

- **Symptom**: photo upload in `/hablar` returns "Error de configuración. Contacta con soporte."
- **Root cause**: Vercel web's `API_KEY` env var (`fxp_b825...`) was never seeded into prod `api_keys` table. `seedApiKey.ts` only seeds the Telegram Bot key
- **Fix**: Computed `sha256` hash of Vercel API_KEY, `INSERT INTO api_keys` via Supabase SQL Editor: `key_hash='e8b21075952b2f816e6cb6094e7e8b3665142315c2bc6f5135aaa2bd11703c31'`, `key_prefix='fxp_b825'`, `name='Web App'`
- **Post-fix state**: Auth works BUT vision analysis returns **"No he podido identificar el plato"** — this is **BUG-PROD-008-FU1**, investigation pending
- **Potential causes of vision failure**: (a) `OPENAI_API_KEY` not set on Render prod (config.ts has it as optional), (b) `OPENAI_CHAT_MODEL` not configured, (c) dish matching logic can't correlate photo analysis output to DB dishes, (d) photo quality/format issue

### Seed CLI runner (P3): silent no-op

- **Symptom**: `npm run seed:standard-portions` produced no output, seeded 0 rows
- **Root cause**: `seedStandardPortionCsv.ts` exported functions but had no CLI entrypoint (unlike `generateStandardPortionCsv.ts` which has `isDirectInvocation` guard)
- **Fix**: Added CLI entrypoint with dynamic `import('@prisma/client')`. In PR #139

---

## D) Standard portions — current state

- **CSV**: `packages/api/prisma/seed-data/standard-portions.csv` — 160 unique rows, 43 dishes × ~4 terms (pintxo/tapa/media_racion/racion)
- **Priority list**: 48 entries in `PRIORITY_DISH_NAMES` (31 original + 17 added post-release: lentejas, ensalada, cocido, fabada, huevos fritos, chuletón, merluza, fideuà, pisto, flamenquín, sopa de ajo, churros, crema catalana, tarta de queso, potaje, arroz [catch-all], bocadillo [catch-all])
- **Seeded**: 160 rows on both prod and dev (2026-04-17)
- **Micro-smoke**: `"ración grande de paella"` → `portionAssumption.source = "per_dish"` (Tier 1 active, not Tier 3 fallback) ✅
- **DATA QUALITY ISSUE**: grams values are TEMPLATES (50g for tapas, 200g for bowls/liquids). NOT real nutritional data. Need per-dish review
- **User's idea**: use Codex + Gemini web research to generate suggested grams/pieces per dish, user validates. Could run in background/worktree

### Priority list matching note

`matchesPriorityName()` uses `nameNorm.includes(priorityNorm)` — short-form names match broadly:
- `'merluza'` matches: Merluza a la plancha, Merluza en salsa verde, Merluza rebozada
- `'arroz'` matches: 12+ rice dishes (Arroz con pollo, Arroz negro, etc.)
- `'bocadillo'` matches: 10+ sandwiches

5 priority names have no DB match: pintxos, alitas de pollo, zamburiñas, berberechos, tostas.

---

## E) Active Session — No active feature

Release cycle complete. 9/9 pipeline issues DONE. PR #139 pending merge (step 10 tracker + post-release fixes).

**PM Session**: None active.

---

## F) Next actions (prioritized, user-confirmed 2026-04-17)

### Priority 1: Merge PR #139 (immediate, <5 min)

Squash-merge when CI green. Contains step 10 tracker + 3 incident docs + seed CLI fix + expanded portions + key_facts update.

### Priority 2: BUG-PROD-008-FU1 — Photo vision analysis (HIGH, separate session)

Auth works. Vision returns "No he podido identificar el plato." Investigation needed:

1. Check Render prod env vars: is `OPENAI_API_KEY` set? Is `OPENAI_CHAT_MODEL` set?
2. Read `packages/api/src/routes/analyze.ts` for the vision analysis flow
3. Check what OpenAI model the analysis uses (GPT-4 Vision? GPT-4o?)
4. Test with a known clear photo of a recognizable dish (e.g., paella)
5. Check API logs on Render for the analyze request (look for OpenAI errors)

**If `OPENAI_API_KEY` is not set on Render prod → that's the cause.** Config.ts has it as optional, so the server starts fine, but vision features silently fail.

### Priority 3: CSV data quality review (HIGH, can run in parallel)

Current `standard-portions.csv` has template values (50g/200g). Need real portion data for 43 dishes × 4 terms.

**User's plan**: spawn Codex + Gemini agents to web-search Spanish portion data (AESAN guidelines, restaurant portion surveys, nutrition databases). Each agent produces a suggested table. User validates and updates CSV. Then re-seed prod + dev.

Key reference: `packages/api/prisma/seed-data/standard-portions.csv` (current state, 160 rows).

### Priority 4: Exhaustive manual prod testing (separate worktree session)

3 surfaces to test systematically:
- **Web** (`app.nutrixplorer.com/hablar`): text queries (solo, comparison, menu), photo upload, portion modifiers, NutritionCard display
- **Telegram bot**: same query types, MarkdownV2 formatting, photo handling
- **Landing** (`nutrixplorer.com`): all variants (?variant=a|c|f), responsive, analytics

### Priority 5 (backlog): F116 CI + lint cleanup

Standard→Complex, 2-3 sessions. 109 lint errors in api + 27 in scraper. Not blocking CI (`|| true` on ci.yml:195). No urgency.

### Tech-debt (documented, no urgency)

- **DIRECT_URL**: should point to `db.<ref>.supabase.co:5432` (true direct), currently `pooler:5432` (session mode). Functional but not ideal.
- **Supabase scaling**: when session pooler limits (~20-50 concurrent) are exceeded, migrate to Prisma `multiSchema` or Supabase Team plan
- **BUG-F042-COMPOSE-SIZE-MODIFIERS**: "media ración grande" drops "grande". Accepted as correct by QA. Don't touch unless asked.

---

## G) Workflow + conventions (unchanged from previous prompt)

| Convention | Detail |
|---|---|
| SDD Workflow | 6 steps: Spec → Setup → Plan → Implement → Finalize → Review → Complete |
| Autonomy Level | L5 PM Autonomous (single-ticket) |
| Branching | gitflow. `bugfix/*` from develop; `hotfix/*` from main. `chore/tracker-sync-*` for doc-only |
| Commit format | `type(scope): description` + `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>` |
| TDD | Mandatory per ADR-021 for conversation pipeline features |
| Test command | `npx vitest run packages/api` (test DB: postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test) |
| Cross-model review | Codex = agentic bug-finder, Gemini = standards-compliance checker |
| External user audit | Before /audit-merge AND before squash-merge. Wait for explicit "procede con squash-merge" |
| Branch protection | develop + main protected via GitHub rulesets (GH013 on direct push). All changes via PR |
| Split-cycle rule | Each sub-ticket needs own Step 6 + tracker Active Session sync in same commit |
| Supabase pooler | **PORT 5432 ONLY** (session mode). Never 6543 (transaction mode resets search_path) |

---

## H) Tech stack — quick reference

| Component | Detail |
|---|---|
| Runtime | Node.js + TypeScript strict |
| API | Fastify 4 + Zod + OpenAPI. Port 3001. Factory `buildApp()` in `packages/api/src/app.ts` |
| ORM | Prisma (`packages/api/prisma/schema.prisma` — 10 enums, 16 models including StandardPortion) |
| Query Builder | Kysely (`packages/api/src/lib/kysely.ts` singleton) |
| DB | PostgreSQL 17.6 (Supabase prod) + pgvector + pg_trgm. Dev local port 5433, test DB `foodxplorer_test` |
| Cache | Redis via ioredis (`packages/api/src/lib/redis.ts`), fail-open |
| Bot | node-telegram-bot-api (`packages/bot`) |
| Web | Next.js 15 App Router + TS strict + Tailwind (`packages/web`, `/hablar`). Consumes POST `/conversation/message` |
| Landing | Next.js 14 (`packages/landing`). No workspace deps. Deploy Vercel GH App |
| CI/CD | GitHub Actions `ci.yml` only. Vercel GH App for web + landing. Render for API + bot |
| API Prod | Render `nutrixplorer-api-prod` (web, main) → `api.nutrixplorer.com`. DATABASE_URL port **5432** |
| API Dev | Render `nutrixplorer-api-dev` (web, develop) → `api-dev.nutrixplorer.com`. DATABASE_URL port **5432** |
| Bot Prod | Render `nutrixplorer-bot-prod` (worker, main) |
| Bot Dev | Render `nutrixplorer-bot-dev` (worker, develop) |
| Web Prod | Vercel `foodyassistance` → `app.nutrixplorer.com` |
| Landing Prod | Vercel `nutrixplorer` → `nutrixplorer.com` → `www.nutrixplorer.com` |

---

## I) Key modules (conversation pipeline)

| Module | Path | Notes |
|---|---|---|
| processMessage() | `packages/api/src/conversation/conversationCore.ts` | Entrypoint. 3 `estimate()` call sites: solo, comparison, menu. All 3 pass `prisma` + `originalQuery` (BUG-PROD-006/007) |
| estimate() | `packages/api/src/conversation/estimationOrchestrator.ts` | portionKeySuffix cache key + resolvePortionAssumption (F-UX-B) |
| resolvePortionAssumption | `packages/api/src/estimation/portionAssumption.ts` | 3-tier: Tier1 DB → Tier2 media_racion×0.5 → Tier3 F085 generic |
| generateStandardPortionCsv | `packages/api/src/scripts/generateStandardPortionCsv.ts` | 48 priority dishes, SIN_PIECES_NAMES, `includes()` matching |
| seedStandardPortionCsv | `packages/api/src/scripts/seedStandardPortionCsv.ts` | Review-gated CSV pipeline. CLI runner added 2026-04-17 (was missing) |
| auth middleware | `packages/api/src/plugins/auth.ts` | F026. sha256 hash lookup in api_keys. Anonymous allowed on public routes |
| /analyze/menu | `packages/api/src/routes/analyze.ts` | Photo upload. Requires `apiKeyContext` (API key auth). Uses OpenAI vision |
| Web proxy | `packages/web/src/app/api/analyze/route.ts` | Injects `API_KEY` from env. 65s timeout (BUG-PROD-001) |

---

## J) Test baseline

- Cross-workspace tests total: ~5461 (3286 api + 596 shared + 1221 bot + 358 web) estimated post-release
- Lint: 109 pre-existing errors in @foodxplorer/api + 27 in scraper (not blocking CI, `|| true` on ci.yml:195, pending F116)
- Typecheck: clean in all packages

---

## K) Pipeline — 9 issues final state (ALL DONE)

| # | Ticket | Status |
|---|---|---|
| 1 | BUG-PROD-001 mobile camera | DONE — PR #103, `a750f5e` |
| 2 | BUG-PROD-002 mobile gallery | DONE — PR #105, `24e6d23` |
| 3 | BUG-PROD-003 vino/vinagre | DONE — PR #107, `a23fd3f` |
| 4 | F-UX-A size modifier | DONE — PR #109, `ecb78c5` |
| 5 | BUG-PROD-004 deploy-web | DONE — PR #111, `88952d9` |
| 6 | F-UX-B spanish portions | DONE — PR #113, `d8167d0` |
| 7 | BUG-PROD-005 Render minutes | DONE — PR #134, `856f752` |
| 8 | BUG-PROD-006 conversation wiring | DONE — `6b117c9` |
| 9 | BUG-PROD-007 comparison+menu | DONE — PR #120, `aab85f0` |

All 9 deployed to production via release merge PR #136 (`7e56827`).

---

## L) Deployment infrastructure reference

| Environment | Host | Trigger | Branch | DATABASE_URL port |
|---|---|---|---|---|
| API staging | Render `api-dev.nutrixplorer.com` | push develop | develop | **5432** |
| API prod | Render `api.nutrixplorer.com` | push main | main | **5432** |
| Bot staging | Render worker | push develop | develop | N/A (no DB) |
| Bot prod | Render worker | push main | main | N/A (no DB) |
| Landing prod | Vercel `nutrixplorer` | push main | main | N/A |
| Landing preview | Vercel `nutrixplorer` | PR | per-PR | N/A |
| Web prod | Vercel `foodyassistance` | push main | main | N/A |
| Web preview | Vercel `foodyassistance` | PR | per-PR | N/A |

Render build filters: active on all 4 services (BUG-PROD-005 Option B, dashboard-configured 2026-04-16, empirically verified).

---

## M) User preferences (persistent)

- Language: Spanish communication. Code + docs in English.
- Developer profile: senior — skip fundamentals, question premises.
- i18n approach: YAGNI pragmatic. No over-engineering.
- UI/UX work: Run ui-ux-designer agent before frontend-planner.
- Task progress: Show task list summaries after each step.
- Merge discipline: Squash merge for feature/chore PRs. Merge commit (`--merge`) for release + merge-back PRs.
- External audit loop: User runs independent agent audit before /audit-merge AND before squash-merge.
- **NEW**: User wants detailed context prompts after feature completion. Use /context-prompt command.
- **NEW**: User interested in multi-model parallel research (Codex + Gemini for web data gathering, user validates).
- **NEW**: No Render CLI or API key configured in Claude's shell. Render Events/config inspection requires user dashboard access.

---

## N) Workflow Recovery Checklist (CRITICAL post /compact)

- Current workflow step: None — no active feature.
- Pending checkpoints: **PR #139 merge** (squash when CI green — post-release fixes).
- Merge checklist reminder: N/A (no active feature). When one starts:
  ▎ Before requesting merge approval, MUST read `references/merge-checklist.md` and execute ALL actions (0-8). Fill `## Merge Checklist Evidence` table with real evidence.
- Step order reminder: After commit+PR, run code-review-specialist and qa-engineer (Step 5), then execute merge-checklist actions. Do NOT request merge approval without completing the checklist.
- External user audit pattern: User runs independent agent audit BEFORE /audit-merge AND before squash-merge. Wait for explicit "procede con squash-merge" signal.
- Branch protection: both develop and main reject direct push via rulesets.
- Split-cycle preventive rule: when a cycle's terminal ticket changes, BOTH ticket file Status AND product-tracker.md Active Session must be synced in same commit.

---

## O) How the next session should start

1. Read this context prompt completely
2. Verify git state: `git status`, `git log --oneline -5`, `git branch`
3. Check if PR #139 was merged. If not, check CI status and merge (squash OK)
4. Read `docs/project_notes/product-tracker.md` → Active Session (should show release complete)
5. Ask user which priority to tackle:
   - **(a)** BUG-PROD-008-FU1 photo vision investigation
   - **(b)** CSV data quality review (multi-model web research)
   - **(c)** Exhaustive manual prod testing (separate worktree)
   - **(d)** F116 CI + lint (backlog)
6. For BUG-PROD-008-FU1: first check `OPENAI_API_KEY` and `OPENAI_CHAT_MODEL` in Render prod env vars (user must check dashboard — Claude has no Render access)
7. For CSV data quality: user wants to spawn Codex + Gemini in background/worktree to web-search Spanish portion data (AESAN guidelines, restaurant surveys), produce suggested grams table, user validates
8. Do NOT start any feature without user confirmation

---

## P) Files to read first

1. This context prompt (complete)
2. `docs/project_notes/product-tracker.md` → Active Session (lines 7-25)
3. `docs/project_notes/bugs.md` → latest 3 entries (RELEASE-INCIDENT-001 + BUG-PROD-008 + Seed CLI)
4. `docs/project_notes/key_facts.md` → Infrastructure section (search_path rule at line ~66)
5. `packages/api/prisma/seed-data/standard-portions.csv` → current 160-row state
6. `packages/api/src/scripts/generateStandardPortionCsv.ts` → PRIORITY_DISH_NAMES (48 entries)
7. CLAUDE.md (root) — project instructions
8. `.claude/skills/development-workflow/SKILL.md` — canonical workflow (when starting a new feature)

---

Context prompt generated: 2026-04-17. Last merge to main: PR #136 (`7e56827`). Last PR: #139 (pending merge to develop — post-release fixes). Next recommended action: merge #139, then tackle BUG-PROD-008-FU1 or CSV data quality review per user preference.
