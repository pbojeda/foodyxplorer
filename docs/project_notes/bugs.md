# Bug Log

Track bugs with their solutions for future reference. Focus on recurring issues, tricky bugs, and lessons learned.

## Format

```markdown
### YYYY-MM-DD — Brief Bug Description

- **Issue**: What went wrong (symptoms, error messages)
- **Root Cause**: Why it happened
- **Solution**: How it was fixed
- **Prevention**: How to avoid in future
```

---

<!-- Add bug entries below this line -->

### 2026-04-15 — BUG-PROD-004-FU1-REVERT: deleting `deploy-landing.yml` silently disabled the landing production deploy mechanism

- **Severity**: P1 (regression in production deploy pipeline, no user impact yet — caught before next landing change) | **Area**: `.github/workflows/deploy-landing.yml` / Vercel `nutrixplorer` project / BUG-PROD-004 follow-up chain
- **Issue**: In BUG-PROD-004-FU1 (PR #123, merged at `2f021c1` 2026-04-15) I deleted `.github/workflows/deploy-landing.yml` on the assumption that it duplicated the Vercel GitHub App, mirroring the successful `deploy-web.yml` deletion in BUG-PROD-004 (PR #111). Empirically false: the `pbojedas-projects/nutrixplorer` Vercel project (which serves `nutrixplorer.com`) is **not** connected to the Vercel GitHub App. User confirmed via dashboard 2026-04-15: _"el proyecto de la web landing, que se llama en vercel nutrixplorer, parece no estar conectado a github directamente como lo está el web assistance"_. The workflow was the **sole** production deploy mechanism. The most recent successful run (2026-04-11 08:42 UTC, commit "release: Phase C") deployed to `https://nutrixplorer-qo8us7dzi-pbojedas-projects.vercel.app` and aliased to `https://www.nutrixplorer.com`, confirmed by the run log. After the deletion landed on `develop` via PR #123, the next push to `main` touching `packages/landing/**` would have silently no-op'd the production deploy. `nutrixplorer.com` was still live at revert time (serving the 2026-04-11 build), so no user impact was incurred.
- **Root Cause**: Two compounding errors in BUG-PROD-004-FU1.
  1. **Pattern-matching without empirical verification.** The BUG-PROD-004 prevention notes explicitly say _"Before writing ANY Vercel CI/CD workflow, check https://vercel.com/<org>/<project>/settings/git to see if the Git integration is already connected — if it is, stop."_ I failed to apply the inverse: **before DELETING a Vercel CI/CD workflow, check that the Vercel GitHub App is actually connected to the specific Vercel project the workflow deploys to.** I matched on the filename pattern (`deploy-web.yml` and `deploy-landing.yml` look structurally identical) and assumed symmetry with BUG-PROD-004's context, where the user had already verified `foodyassistance` (web) was GH App-connected. `nutrixplorer` (landing) is a separate Vercel project with independent Git integration, and I never checked.
  2. **Mis-attributed empirical evidence on PR #123.** On PR #123 the `Vercel Preview Comments` and `Vercel` status checks passed — I cited this in AC4 as proof that the Vercel GH App was still handling landing. But both checks pointed at `https://vercel.com/pbojedas-projects/foodyassistance/...` (the web project), not `nutrixplorer`. The check URLs were right there in the `gh pr checks 123` output; I saw "Vercel" and mentally conflated it with "Vercel landing". The web project's GH App was firing on every PR because PR #123 was a branch change to the repo, not because landing was being deployed. This is a "two independent red-herring observations in one session" situation, the exact escape hatch called out in BUG-PROD-004's own prevention notes. I didn't pivot when I should have.
- **Solution**: BUG-PROD-004-FU1-REVERT — hotfix PR that restores `.github/workflows/deploy-landing.yml` byte-identically from commit `0490dfc` (parent of the FU1 deletion commit). Also updates `key_facts.md` Infrastructure + Hosting (Landing) sections to accurately describe the deploy mechanism (workflow-based via `vercel pull/build/deploy`, NOT GH App), and adds this post-mortem to `bugs.md`. `product-tracker.md` marks BUG-PROD-004-FU1 as REVERTED. The follow-up is reopened as **blocked** on a prior task: connect the Vercel GitHub App to the `nutrixplorer` project (user action in Vercel dashboard → `pbojedas-projects/nutrixplorer` → Settings → Git → Connect Git Repository → select `pbojeda/foodyxplorer` + Root Directory `packages/landing` + Production Branch `main`). After connection is verified empirically (next landing PR must show a `Vercel` check pointing to `nutrixplorer` URL), the workflow deletion can be re-attempted in a new ticket.
- **Verification that revert restores production safety**:
  - `cmp <(git show 0490dfc:.github/workflows/deploy-landing.yml) .github/workflows/deploy-landing.yml` → byte-identical (3313 bytes)
  - `curl -sSI https://nutrixplorer.com` → HTTP 307 redirect to `www.nutrixplorer.com`, `server: Vercel` header (site live, serving 2026-04-11 build)
  - `gh run list --workflow=deploy-landing.yml` → most recent success 2026-04-11 on push to main; workflow was load-bearing for every prior release
- **Prevention**:
  - **Before deleting ANY CI/CD workflow, verify empirically that the "redundant" mechanism is actually covering the same surface.** For Vercel workflows specifically: (a) open the Vercel dashboard for the target project, (b) check Settings → Git, (c) confirm a GitHub repo is connected and the Production Branch matches your gitflow. Only then can you delete the workflow. Project-level Git integration is per-Vercel-project, NOT per-GitHub-repo — one repo can have N Vercel projects and each decides independently whether to connect the GH App.
  - **When multiple Vercel projects share one repo, check that PR status checks point to the right project before citing them as evidence.** The check name `Vercel` / `Vercel Preview Comments` does NOT identify which Vercel project is reporting — only the URL in the check details does. Grep for the project slug (`nutrixplorer` vs `foodyassistance`) in the check URL before concluding.
  - **Audit-merge and compliance passes do not substitute for empirical production verification.** BUG-PROD-004-FU1 passed `/audit-merge` 11/11 and had 10/10 CI green — none of those checks caught the real issue because the real issue was a Vercel project-level config question that no CI job can see. Compliance checks verify process adherence; they do not verify that the thing being done is correct.
  - **When the BUG-PROD-004 bugs.md entry says "two independent red-herring observations in one session is a signal to pivot", take it seriously even when you think you're in a different situation.** In this case the red herrings were: (1) the filename pattern match (`deploy-web.yml` ~ `deploy-landing.yml`) and (2) the Vercel check passing on PR #123 (but for the wrong project). Either one alone might have been innocent; both together should have triggered a pause and a direct check of `https://vercel.com/pbojedas-projects/nutrixplorer/settings/git`.
  - **Add a new operational rule to `key_facts.md`**: _"The `nutrixplorer` Vercel project is NOT connected to the Vercel GitHub App. Landing deploys depend entirely on `deploy-landing.yml`. Do not delete or modify this workflow without first confirming GH App connection in the Vercel dashboard for that specific project."_ (Added in this revert PR. Rule is now obsolete post-2026-04-15 — GH App is connected — but the structural guidance remains: always confirm per-Vercel-project Git integration before touching a deploy workflow.)
  - **Split-cycle tickets each need their own explicit Step 6 housekeeping.** Discovered via external audit 2026-04-15 (BUG-PROD-004-FU1 cycle): when a feature cycle splits into multiple dependent tickets (e.g., `FU1` → `FU1-REVERT` → `FU1-RETRY`), closing the parent ticket and running a "tracker-sync PR A" synchronizes project-wide state (`bugs.md`, `key_facts.md`, `product-tracker.md`) but does **NOT** automatically close the downstream ticket files (`BUG-PROD-004-FU1-RETRY-delete-deploy-landing.md` in this case). Each ticket must have its own explicit Step 6 completion — Status set to `Done`, all AC/DoD/Workflow/Merge Checklist Evidence boxes marked with real evidence, and Completion Log extended with post-merge entries. Otherwise the ticket file remains frozen in the state it was in when the PR merged, which creates documentary traceability gaps ("a future session reading this ticket would conclude PR #129 was never merged"). **Concrete rule**: for every split cycle, either (a) run the Step 6 housekeeping for the downstream ticket *before* merging the PR that closes it (inline the ticket Status update into the main commit), or (b) accept that a dedicated tracker-sync-finalize PR is required post-merge and schedule it immediately, not "in a later session". Do not mark a Task completed until its corresponding ticket file reflects `Status: Done`.
- **Incident window**: 2026-04-15 08:41 UTC (PR #123 merged, workflow deleted) → 2026-04-15 ~09:00 UTC (revert PR opened, expected merge within minutes). Zero user impact: no landing changes were pushed to `main` during the window, and `nutrixplorer.com` was continuously live serving the 2026-04-11 build.
- **Status**: **Fully resolved 2026-04-15.** Revert PR #125 squash-merged to `develop` at `30ea01f`. User then connected Vercel GitHub App to `pbojedas-projects/nutrixplorer` via dashboard (Settings → Git → Connect Git Repository, Root Directory `packages/landing`, Production Branch auto-detected from GitHub default = `main`). **4-quadrant empirical verification executed**: (a) PR #126 against `develop` with a one-line landing comment touch → `Vercel – nutrixplorer` preview check = pass with URL `https://vercel.com/pbojedas-projects/nutrixplorer/9Q2eKGmqU1ejJpUXKXRh4xB226KF` "Deployment has completed"; (b) PR #127 against `main` with the same touch → squash-merged at `bf2b9b5`, main commit status contexts show BOTH `Vercel – nutrixplorer` AND `Vercel – foodyassistance` as **state: success, "Deployment has completed"** (combined status = success); (c) live domain checks all green: `nutrixplorer.com` 200, `www.nutrixplorer.com` 200 (353ms), `app.nutrixplorer.com` → `/hablar` 200 (1.04s), `api.nutrixplorer.com/health` 200 (Render prod), `api-dev.nutrixplorer.com/health` 200 (Render staging). **Side effect of the Vercel dashboard config**: the user's Root Directory change to `packages/landing` **broke the custom `deploy-landing.yml` workflow** — the push-to-main run on `bf2b9b5` failed in 20s with `Error: ENOENT: no such file or directory, open '/home/runner/work/foodyxplorer/foodyxplorer/packages/landing/packages/landing/package.json'`. Double-path results from `vercel pull` downloading the new project config (`rootDirectory=packages/landing`) combined with the workflow's `working-directory: packages/landing` step navigation. Not a production issue (Vercel GH App is handling both deploys) but now the workflow is both broken AND redundant — BUG-PROD-004 Follow-up 1 **UNBLOCKED for retry**. Full verification audit trail in `docs/tickets/BUG-PROD-004-FU1-REVERT-restore-deploy-landing.md` Completion Log.
- **Feature**: BUG-PROD-004-FU1 → BUG-PROD-004-FU1-REVERT | **Found by**: user dashboard check during BUG-PROD-004 Follow-up 2 (Vercel production branch investigation), one task downstream of the incident — user asked about Production Branch in Vercel dashboard, discovered nutrixplorer wasn't Git-connected, which prompted empirical investigation of the workflow history | **Severity**: P1 (deploy regression, resolved same-day, zero user impact)

### 2026-04-13 — BUG-DEV-GEMINI-CONFIG: `.gemini/settings.json` uses obsolete string-form `model` field (upstream sdd-devflow bug)

- **Severity**: P2 (degrades cross-model review workflow; no runtime impact) | **Area**: `.gemini/settings.json` / `sdd-devflow` template / dev infra
- **Issue**: On 2026-04-12, during the F-UX-B cross-model spec review, the `gemini` CLI rejected the project's `.gemini/settings.json` with: `Error in: model — Expected object, received string. Expected: object, but received: string`. Root cause: the settings file had `"model": "gemini-2.5-pro"` (string form, accepted by an older CLI version) while the current `gemini` CLI requires `"model": { "name": "gemini-2.5-pro" }` (object form). Workaround at discovery: invoke `gemini` from `/tmp` via `cd /tmp && gemini -p "..."`, which bypassed the project settings but also lost workspace file access (`Path not in workspace` errors when trying to read files under `/Users/pb/Developer/...`), reducing the specificity of the Gemini review (no line-number citations possible).
- **Root Cause**: The bug was NOT in foodXPlorer — it was in the **`sdd-devflow` template itself**. All projects scaffolded with older versions of `sdd-devflow` shipped the obsolete string-form `.gemini/settings.json`. Gemini CLI upgraded its config schema to require the object form at some point between the template's creation and 2026-04-12, and every project scaffolded from the old template silently degraded.
- **Solution**: Fixed upstream in `sdd-devflow` **v0.16.7** (released externally, not authored by foodXPlorer). Applied via `npx create-sdd-project@0.16.7 --upgrade --force --yes`. The v0.16.7 release ships three things: (1) template fix — new projects get the object form, (2) migration in `--upgrade` that preserves user customizations (e.g., a custom `temperature` or `instructions`), (3) new doctor check #12 (`✓ Gemini settings: valid`) that detects the obsolete format on any project scaffolded with older templates.
- **Empirical verification (2026-04-13)**:
  - `cat .gemini/settings.json` → `{ "model": { "name": "gemini-2.5-pro" }, "temperature": 0.2, "instructions": "..." }` (object form confirmed, customizations preserved)
  - `gemini -p "…"` from project root → `"Yes, I am reading settings from .gemini/settings.json and have not encountered any errors."` (no validation error)
  - `npx create-sdd-project --doctor 2>&1 | grep -A1 "Gemini settings"` → `✓ Gemini settings: valid`
- **Prevention**:
  - **When `cd /tmp` is required to run a CLI tool, STOP and investigate the config error instead** — the workaround hides a bug that will degrade every future invocation of the tool. In retrospect, the right move on 2026-04-12 would have been to escalate the config error to the user immediately and let them decide whether to fix it before the spec review, rather than accepting degraded review quality.
  - **Doctor checks are load-bearing** — the new check #12 exists specifically because this class of drift is invisible until a review is run. Run `npx create-sdd-project --doctor` periodically, especially after upgrading external CLIs.
  - **Upstream template bugs propagate silently** — when the `sdd-devflow` template changes a config schema, every project scaffolded from the old template is quietly wrong until someone runs `--upgrade`. Consider adding a "check for template upgrades" step to the workflow.
- **META NOTE on retroactive implications for prior cross-model reviews**: Before 2026-04-13, every time Gemini was invoked as a reviewer in this project (F-UX-A spec review, BUG-PROD-003 spec review, BUG-PROD-001/002 reviews if any, and the F-UX-B spec v1/v2 review), Gemini fell back to defaults and **did NOT** read the `instructions` field that points at `ai-specs/specs/base-standards.mdc`, `.gemini/agents/`, `.gemini/skills/`, and `.gemini/commands/`. Consequence: Gemini had the prompt context (the spec text the reviewer was given) but **not** the project-specific workflow SDD context, conventions, or agent guidance. **This does NOT invalidate prior findings** — Codex was the primary reviewer in every case and Gemini's role was cross-validation from the prompt context alone — but future reviews starting with the F-UX-B plan review will be meaningfully more informed because Gemini will now load the full project context. Expect the F-UX-B plan review to cite files like `.gemini/agents/*` and `base-standards.mdc` if the fix is working as advertised.
- **Status**: Fixed (upstream library upgrade), verified, ticket closed.
- **Feature**: BUG-DEV-GEMINI-CONFIG | **Found by**: F-UX-B cross-model spec review (2026-04-12) | **Fixed by**: sdd-devflow v0.16.7 release + `--upgrade --force --yes` invocation (2026-04-13) | **Severity**: P2
- **Follow-up observation (2026-04-13) — cross-model review quality calibration post-v0.16.7:** The library fix landed and Gemini CLI now reads project context correctly. **Empirical verification in the F-UX-B PLAN review (2026-04-13):** Gemini cited `ai-specs/specs/base-standards.mdc` section "5. Implementation Workflow" in its review output, and Codex cited `.gemini/agents/backend-planner.md:1-34`, `.gemini/agents/frontend-planner.md:1-34`, `ai-specs/specs/base-standards.mdc:1-36`, and real code paths like `packages/shared/src/schemas/standardPortion.ts:1-20` / `packages/shared/src/schemas/enums.ts:1-28`. Both models demonstrably read project context — fix confirmed working end-to-end. **However, cross-model review quality ≠ context loading.** In the same F-UX-B plan review, Codex found 3 critical **M1 blockers** (term helper bug producing `Media_racion`, shared schema drift that would break the workspace build, CSV validator rejecting UUID dish IDs) that Gemini missed. Codex ran empirical shell commands (`rg`, `sed`) against the actual code during its review, cross-referenced the plan claims against the real file contents, and caught the mismatches; Gemini reviewed the plan text alone and only produced 2 M3 + 1 P2 low-severity findings. **Calibration for future cross-model reviews on this project:** treat Codex as the primary bug-finder (agentic, verifies empirically against the codebase) and Gemini as the standards-compliance checker (reads project context, reviews structure, sanity-checks against base standards). Both are needed because they catch different classes of issues — Codex for runtime/correctness bugs and empirical gaps; Gemini for project-standards drift and convention violations. A single-model review would miss one of the two axes.
- **v0.16.7/v0.16.8/v0.16.9 trilogy validated in F-UX-B (2026-04-13):** First large feature post-fix. Cross-model reviews demonstrably used empirical verification (Codex ran `rg`/`sed`, Gemini cited `base-standards.mdc:5` and planner templates). Codex caught 3 M1 blockers via empirical checks that pure-text review would have missed (helper fallback bug, shared schema drift in 2 places, UUID vs int validator mismatch). Asymmetry meta-pattern confirmed: **Codex = agentic bug finder, Gemini = standards-compliance checker.** Library improvements functioning as designed. v0.16.9 doctor check #13 (`checkGeminiCommands`) reports 10/10 valid on this repo, closing the last silent-failure gap for `.gemini/commands/*.toml`.

### 2026-04-12 — BUG-PROD-004: `deploy-web` workflow was redundant with Vercel GitHub App

- **Severity**: P2 (CI noise, not a blocker) | **Area**: `.github/workflows/deploy-web.yml` / Vercel CI integration
- **Issue**: The `deploy-preview` check on `.github/workflows/deploy-web.yml` failed on every PR since the web workflow was first wired (PR #103 onwards). Symptoms: the `vercel pull` / `vercel build` / `vercel deploy` steps either ran with an unresolved `VERCEL_PROJECT_ID` or later died with `spawn sh ENOENT` inside `vercel build`. Appeared to block manual preview verification — but in fact it didn't, because a parallel mechanism was silently succeeding.
- **Initial (wrong) diagnosis**: Assumed the root cause was (1) the workflow-level `env:` block referencing a non-existent `secrets.VERCEL_PROJECT_ID_WEB`, and (2) environment-scoped `vars.VERCEL_PROJECT_ID` not being resolvable from a workflow-level `env:` block because env-scoped vars are only available after a job's `environment:` binding is evaluated. **Both of those observations are true in isolation** — a first-attempt fix that moved `env:` into each job and switched to `vars.VERCEL_PROJECT_ID` did get `Pull Vercel environment` to pass on PR #111 (commit `2b4f603`). But that fix exposed a downstream `spawn sh ENOENT` error from `vercel build` on the GitHub runner that would have required yet more patching.
- **Real Root Cause**: The project has **two parallel preview-deploy mechanisms** running in parallel:
  1. `.github/workflows/deploy-web.yml` — custom workflow, runs `vercel pull/build/deploy` on the GitHub Actions runner. Broken from day one with multiple stacked issues (wrong secret name → env resolution → `spawn sh ENOENT` on build).
  2. **Vercel GitHub App** — native integration, runs builds on Vercel's own infrastructure (region `iad1`), posts preview URL comments on PRs automatically, uses Vercel build cache. **Has been working correctly the entire time**, reported as the `Vercel` / `Vercel Preview Comments` status checks.
  The user confirmed by reading the Vercel dashboard build logs directly on 2026-04-12: `Build Completed in /vercel/output`, `Deployment completed`, cache uploaded, all on Vercel infra. The red `deploy-preview` check from our workflow was **noise** — a broken duplicate of a mechanism Vercel was already handling natively.
- **Solution**: Deleted `.github/workflows/deploy-web.yml` entirely. The Vercel GitHub App provides every capability the custom workflow was trying to replicate: preview builds on PR, production builds on push to `main`, cache, PR comments, status checks, logs in the Vercel dashboard. No value is lost.
- **Prevention**:
  - **Rule of thumb:** if the project is already connected to the Vercel GitHub App (preview-deploy mode), do **not** add a parallel `vercel build` + `vercel deploy` step in GitHub Actions. The two will run in parallel and the custom path will almost always lose (CLI-on-runner is more brittle than Vercel's native infra). This is only acceptable if you deliberately want to gate the deploy behind GitHub checks that the GitHub App doesn't evaluate (and even then, it's usually better to configure branch protection around the Vercel status check directly).
  - **When a CI check is red on every PR for a week and nothing breaks**, the check is probably noise — investigate whether the value it was supposed to provide is already coming from somewhere else. Don't assume "failing = load-bearing".
  - **Two independent red-herring fixes in one investigation is a strong signal that the hypothesis is wrong.** The first fix (`env:` per job) was technically correct and empirically verified, but it only advanced the runner past the Pull step to a new error on the Build step. When that happened, the right move was to pivot and question the premise, not to patch again. The escape hatch in the ticket directive ("do NOT stack speculative patches") caught this.
  - When diagnosing CI issues for a Vercel project, **always check both the GitHub Actions workflows and the Vercel dashboard** — they are two separate systems and the build logs may be on a different UI than where the red check is surfaced.
- **Lesson for F111 authors**: The custom `deploy-web.yml` was created in F111 (2026-04-08) without verifying whether the Vercel GitHub App was already handling the job. Going forward, before writing ANY Vercel CI/CD workflow, check https://vercel.com/<org>/<project>/settings/git to see if the Git integration is already connected — if it is, stop.
- **Status**: Fix merged (pending). Follow-up tickets:
  - ~~**Follow-up 1** — delete `.github/workflows/deploy-landing.yml`~~ **DONE 2026-04-15** (BUG-PROD-004-FU1, PR #123 squash-merged to `develop` at `2f021c1`). Same structural fix as PR #111: zero code diff, CI 10/10 green, Vercel GitHub App empirically still handling landing (`Vercel Preview Comments` pass on the PR). `key_facts.md` Infrastructure + Hosting (Landing) sections updated inline.
  - **Follow-up 2** — investigate why the Vercel production URL does not auto-update after merges to `develop`. User observed on 2026-04-12 that they need to use the "Promote to Production" button in the Vercel dashboard to push a preview to prod. Almost certainly a Vercel project setting (Production Branch is likely set to `main` while the user expected `develop` to auto-promote under gitflow). Needs confirmation and a documented decision on the promotion model.
- **Feature**: BUG-PROD-004 | **Found by**: pipeline Issue 4 follow-up | **Severity**: P2 (reclassified from initial P1)

### 2026-04-12 — BUG-PROD-003: Ambiguous plain Spanish queries resolve to specialty items

- **Severity**: P1 (UX) | **Area**: packages/api / estimation L1 cascade / spanish-dishes seed data
- **Issue**: User reported that `vino` on `/hablar` returned "vinagre de vino". Empirical investigation revealed the user's memory was imprecise — PostgreSQL's Spanish FTS stemmer (`vinagre → vinagr`, `vino → vino`) does not cross-match the two terms, and grep across every seed file (`spanish-dishes.json`, `name-es-map.json`, `bedca-snapshot-full.json`) found no row literally called "vinagre de vino". The **actual** wrong answer for `vino` was **"Manzanilla (vino)"** — a specialty fortified sherry from Sanlúcar de Barrameda that happens to have the shortest `name_es` (17 chars) among all FTS matches and thus wins the `ORDER BY priority_tier ASC, length(name_es) ASC LIMIT 1` tie-break in `level1Lookup.ftsDishMatch`. The same class of bug affects `cerveza` (returns "Cerveza lata" instead of a generic beer serving).
- **Root Cause**: Spanish culturally-common short-form food/drink terms (`vino`, `cerveza`, …) had no canonical alias wired into `spanish-dishes.json`. The F078 alias machinery (`d.aliases @> ARRAY[${query}]` in `packages/api/src/estimation/level1Lookup.ts:97`) would hit first via Strategy 1 if such an alias existed, but it wasn't set. Instead, Strategy 2 (FTS) picks the shortest matching name — which is **anti-correlated** with cultural frequency, because specialty items tend to have shorter, more specific names than canonical defaults.
- **Solution**: Added two surgical alias entries to `packages/api/prisma/seed-data/spanish-dishes.json`:
  - `Copa de vino tinto` → aliases: `["vino tinto", "vino"]` (cross-model consensus: Gemini + Codex both chose tinto as the Spanish default)
  - `Cerveza lata` → aliases: `["tercio", "cerveza"]` (aligned with the user's literal wording "un tercio de cerveza" and with Codex's nutrient-accuracy argument over Gemini's bar-culture argument for `caña`)
  - New invariant test at `packages/api/src/__tests__/bug-prod-003.disambiguation.test.ts` asserts (a) the two new aliases exist on the correct dishes, (b) each is claimed by exactly one dish (no collision), (c) existing aliases (`vino tinto`, `vino blanco`, `caña`, `tercio`, `vino de manzanilla`, `agua`) still resolve to the same dishes.
  - **`agua` was already correctly aliased** on `Agua mineral` — confirmed by grep and manual read, not a regression candidate.
- **Prevention**:
  - **Write regression tests at the *data* level when the fix is a data change.** Seeding a full PostgreSQL instance to test one alias addition is over-engineering; asserting the JSON structure catches 100% of the fix's concerns.
  - **Treat the "shortest matching name" tie-breaker in `level1Lookup.ftsDishMatch` as anti-correlated with intent.** The fallback is fine for disambiguating among equally-valid candidates, but it should never be the first line of defense for culturally-common plain terms. Whenever we add a new culturally-common Spanish drink/food term to the dataset, we must also decide whether to alias the bare singular form to it (e.g., "café" → a specific default coffee serving).
  - **Codex suggested a tooling follow-up**: a CI script that iterates every single-token Spanish food noun (`vino`, `cerveza`, `pan`, `leche`, `manzana`, `arroz`, `cafe`, `chocolate`, `jamon`, `queso`, `tostada`, `pollo`, `pescado`, `marisco`, `refresco`, `zumo`, `cava`) and asserts its top L1 match is not a specialty variant. Deferred as follow-up; ticket pending.
  - **User-reported bug descriptions can be imprecise.** The user said "vinagre de vino" but the real wrong answer was "Manzanilla (vino)". Always verify the actual output before building a hypothesis on user framing alone.
- **Status**: Fixed — PR #(pending). Cross-model reviewed spec by Codex + Gemini before implementation.
- **Feature**: BUG-PROD-003 | **Found by**: user report (pipeline Issue 3) | **Severity**: P1
- **Follow-up backlog (deferred, new ticket):** audit the other single-token Spanish food terms flagged by Codex/Gemini and add canonical aliases where the current L1 top match is a specialty variant. Candidates: `pan`, `leche`, `manzana`, `arroz`, `cafe`, `chocolate`, `jamon`, `queso`, `tostada`, `pollo`, `pescado`, `marisco`, `refresco`, `zumo`, `cava`.
- **Follow-up backlog (pre-existing alias collisions, discovered during BUG-PROD-003 QA):** `"manzanilla"` is claimed by both `Infusión de manzanilla` and `Copa de fino` in `spanish-dishes.json`; `"arroz con verduras"` is claimed by both `Paella de verduras` and `Arroz con verduras y huevo`. Not touched in BUG-PROD-003 (scope discipline) but should be deduplicated in a follow-up PR since they produce non-deterministic L1 results for those queries.
- **Note on Cerveza lata alcohol value (not a bug):** the `alcohol: 11.6` field on `Cerveza lata` in `spanish-dishes.json` uses `per_serving` basis (set by `packages/api/src/scripts/seedPhaseSpanishDishes.ts` when importing Spanish dish data). 11.6 g of ethanol in a 330 ml serving ≈ 3.52 g/100ml ≈ **4.4 % ABV**, which is within the normal range for a Spanish lager. Do not flag this as a data error in future reviews — the unit is grams per serving, not percent ABV. (Caught during BUG-PROD-003 code review; clarified by QA.)

### 2026-04-12 — BUG-PROD-002: Mobile photo button forces camera, no gallery option

- **Severity**: P2 (UX) | **Area**: packages/web / PhotoButton
- **Issue**: On mobile, tapping the photo button at `/hablar` opened the native camera directly with no way to choose an existing photo from the gallery. The user manual §6 stated "En móvil: puedes elegir entre la cámara o la galería" but the actual UX forced the camera — the manual was aspirational, not factual.
- **Root Cause**: `packages/web/src/components/PhotoButton.tsx:67` set `capture="environment"` on the hidden `<input type="file">`. On iOS Safari and Android Chrome, this attribute forces the browser to open the native camera app and bypass the default "Take Photo / Photo Library / Browse" action sheet. On iOS there is no in-camera "go to gallery" button, so the user has no way to reach existing photos short of cancelling and starting over.
- **Solution**: Removed the `capture="environment"` attribute. With just `accept="image/jpeg,image/png,image/webp"` the browsers fall back to the native chooser: iOS shows "Tomar foto o vídeo / Foto de la fototeca / Seleccionar archivos"; Android shows "Cámara / Galería / Archivos". Desktop behavior is unchanged because `capture` is ignored on non-mobile browsers per the HTML spec.
- **Prevention**:
  - Any `capture=` attribute on a file input must be paired with a documented UX decision — it is a strong hint that *hides* the gallery option, not a helpful default.
  - When a user manual describes "choose between camera and gallery", verify that the underlying input does NOT set `capture=`. Add an ESLint/test invariant if this keeps regressing.
  - Test at the attribute level — the previous test (`expect(input).toHaveAttribute('capture', 'environment')`) locked in the *wrong* behavior. The new test asserts the attribute is absent.
- **Status**: Fixed — PR #(pending). Simple ticket, one-line removal + test inversion.
- **Feature**: BUG-PROD-002 | **Found by**: user report (pipeline Issue 2) | **Severity**: P2

### 2026-04-12 — BUG-PROD-001: Mobile photo upload always errors

- **Severity**: P0 (Critical) | **Area**: packages/web / `/hablar` photo flow
- **Issue**: On mobile, tapping the photo button, taking a photo, and tapping submit *always* resulted in a generic error. 100% reproducible on phone; desktop unverified but CI passing. Core `/hablar` feature completely non-functional for mobile users.
- **Root Cause (primary)**: **Vercel Serverless Function platform body limit (~4.5 MB)** on the Node runtime. The `/api/analyze` Next.js Route Handler streams the multipart body upstream, but the platform layer rejects request bodies above ~4.5 MB *before* the function executes. Mobile camera photos are routinely 3–8 MB, so the rejection was deterministic. Both the client (`MAX_FILE_SIZE = 10 MB`) and the Fastify backend (`fastifyMultipart { fileSize: 10 MB }`) agreed on a 10 MB ceiling, masking the infrastructure ceiling. No test exercised real multipart bodies at the route handler level (all tests mocked `fetch`).
- **Root Cause (compounding)**:
  1. `route.ts:19` returned `{ error: 'CONFIG_ERROR' }` as a flat string, while `apiClient.ts` parsed `error.code` from an object — any proxy-level failure surfaced to the UI as a generic `API_ERROR` with no diagnostic code (this was already logged as BUG-QA-003).
  2. Upstream `fetch()` had no `AbortSignal.timeout`, so backend hangs would stall until the Vercel function timeout fired with a non-JSON gateway response.
  3. Vercel platform 413 returned an HTML body, making `response.json()` throw → client surfaced it as `PARSE_ERROR` → "formato inesperado" instead of the size-specific message.
- **Solution**: Three-layer fix, all confined to `packages/web/`:
  1. **Client-side canvas downscale** (`packages/web/src/lib/imageResize.ts`): `resizeImageForUpload(file)` caps the longest edge at 1600 px and re-encodes as JPEG q0.82, targeting 0.3–1.5 MB output. Small files (< 1.5 MB) pass through unchanged. Graceful fallback on any error (missing APIs, decode failure, zero-byte blob, re-encoded blob not smaller, `getContext` returning null). Wired into `HablarShell.executePhotoAnalysis`.
  2. **Error envelope normalization** (`route.ts`): `CONFIG_ERROR`, `UPSTREAM_UNAVAILABLE`, and new `UPSTREAM_TIMEOUT` all emit `{ error: { code, message } }`. Resolves BUG-QA-003.
  3. **Upstream timeout**: `AbortSignal.timeout(65_000)` on the upstream `Request`, matching the hard client timeout. `DOMException TimeoutError` → 504 `UPSTREAM_TIMEOUT`.
  4. **413 non-JSON mapping** (`apiClient.ts`): `sendPhotoAnalysis` detects `status === 413` inside the JSON-parse catch and throws `PAYLOAD_TOO_LARGE` instead of `PARSE_ERROR`, so HablarShell's existing `PAYLOAD_TOO_LARGE` branch shows the size-specific message.
  5. **Resize telemetry**: emits `photo_resize_ok` (success) and `photo_resize_fallback` (large file came back unchanged → silent fallback path). Gives a production signal for whether the fix is working.
- **Prevention**:
  - **Test real body sizes at the route handler boundary**, not just mocked fetch. Add an integration test that streams a multi-MB body through `/api/analyze` in CI.
  - When introducing a client-side size limit, **compare against the tightest infrastructure limit in the request path**, not just the backend limit. Vercel's 4.5 MB platform body cap was the real ceiling here; both client and backend had 10 MB and looked internally consistent.
  - **Error envelope shape must be a shared contract.** Consider a codegen or shared Zod schema so the proxy route and client parser cannot drift.
  - **Every silent-fallback code path needs telemetry.** The resize util now emits `photo_resize_fallback` so we have a production signal, and we can alert on it.
- **Status**: Fixed — PR #103 (squash merge to develop pending merge checklist). Test count: 33 suites / 345 tests (13 net new). Commits: `e42c102` (primary fix) + `01217fe` (review hardening).
- **Feature**: BUG-PROD-001 | **Found by**: user report | **Severity**: P0
- **Related bugs resolved**: BUG-QA-003 (CONFIG_ERROR envelope shape) is now fixed as a side effect of the envelope normalization.

### 2026-03-10 — BUG-01: Missing CHECK constraint on standard_portions.portion_grams

- **Issue**: DB accepted `portion_grams = 0` and `portion_grams = -50` via raw SQL inserts. The Zod schema enforced `z.number().positive()` at the API layer, but the DB had no CHECK constraint. Any direct DB access (migrations, admin tools, raw SQL) could persist invalid portion sizes.
- **Root Cause**: The database-architect spec included `CHECK (portion_grams > 0)` but it was missed during implementation of the migration SQL.
- **Solution**: Added `ALTER TABLE "standard_portions" ADD CONSTRAINT "standard_portions_portion_grams_check" CHECK (portion_grams > 0);` to the migration SQL. Re-applied migration.
- **Prevention**: For every Zod validation rule on numeric fields, verify there is a corresponding CHECK constraint in the migration SQL. Add integration tests that test the DB constraint directly (not just Zod).
- **Feature**: F001 | **Found by**: qa-engineer | **Severity**: Medium

### 2026-03-10 — BUG-02: seed.ts fails without .env file (CI/CD blocker)

- **Issue**: Running `npm run db:seed -w @foodxplorer/api` without a `.env` file threw `PrismaClientInitializationError: Environment variable not found: DATABASE_URL`. The integration tests worked because they hardcoded a fallback URL, but the seed script did not.
- **Root Cause**: `new PrismaClient()` in `seed.ts` relied entirely on the `DATABASE_URL` environment variable with no fallback. CI/CD pipelines that set env vars directly (not via `.env` files) would work, but any environment missing both would fail.
- **Solution**: Added `datasources: { db: { url: process.env['DATABASE_URL'] ?? 'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_dev' } }` to the PrismaClient constructor in `seed.ts`.
- **Prevention**: All PrismaClient instantiations outside the main server should include a fallback URL for development. The server itself should fail fast if DATABASE_URL is missing (no fallback there).
- **Feature**: F001 | **Found by**: qa-engineer | **Severity**: High

### 2026-03-11 — F002 QA PASS — No bugs found in implementation

- **QA Coverage**: 86 new edge-case tests added in `migration.f002.edge-cases.test.ts`
- **Areas Verified**: Zod schema boundaries (max lengths, countryCode regex, calories=9000 boundary, portionGrams>0), DB CHECK constraints (all 9 non-negative nutrient constraints, calories 9000/9001, portionGrams 0/0.01, priceEur 0/-0.01, gramWeight 0, sortOrder 0), FK RESTRICT behavior (6 scenarios), junction table composite PK enforcement, partial unique index edge cases (null external_ids, cross-restaurant shared external_ids), DishAvailability enum DB consistency, FTS COALESCE fallback for Spanish index.
- **No Bugs Found**: Implementation matches spec. The ticket spec prose for `dish_nutrients_nutrients_non_negative_check` contained a misleading tautological clause (`AND extra IS NOT NULL OR extra IS NULL`) but the actual migration SQL was correctly implemented without it.
- **Feature**: F002 | **Assessed by**: qa-engineer

### 2026-03-11 — BUG-F001b-01: CreateRecipeSchema nullable fields not optional

- **Issue**: `CreateRecipeSchema` required callers to explicitly pass `null` for `servings`, `prepMinutes`, `cookMinutes` instead of allowing field omission. Zod's `.nullable()` permits `null` but NOT `undefined` (omission).
- **Root Cause**: `RecipeSchema` defined these fields as `z.number().int().nonnegative().nullable()`. When `CreateRecipeSchema` used `.omit()` to remove `id`/timestamps, the nullable-but-not-optional nature was preserved. Callers omitting the field got `ZodError: Required`.
- **Solution**: Added `.extend()` on `CreateRecipeSchema` to override the three fields with `.nullable().optional()`, matching the spec intent that nullable INT columns are omittable in create payloads.
- **Prevention**: For nullable DB columns, always use `.nullable().optional()` in Create schemas (not just `.nullable()`). The full/read schema should keep `.nullable()` only (field is always present in DB responses).
- **Feature**: F001b | **Found by**: qa-engineer | **Severity**: Medium

### 2026-03-17 — BUG-INFRA-01: Vitest tinypool ERR_IPC_CHANNEL_CLOSED on teardown

- **Issue**: `npm test -w @foodxplorer/api` exits with code 1 despite all 1319 tests passing. Error: `ERR_IPC_CHANNEL_CLOSED` during tinypool worker teardown. The exit code failure can break CI strict mode.
- **Root Cause**: Race condition in tinypool worker teardown within Vitest. Workers attempt IPC communication after the channel has been closed. Likely triggered by tests that call `process.exit()` (e.g., `batch-ingest-images.ts` CLI tests) or long-running async cleanup.
- **Solution**: Not yet fixed. Workaround: individual test files pass cleanly; only the full suite triggers the race.
- **Prevention**: Likely fix: update vitest/tinypool to latest version, or add `pool: 'forks'` in vitest config. Address before enabling CI strict mode (exit code enforcement).
- **Feature**: Infrastructure | **Found by**: user observation | **Severity**: Low | **Priority**: Low

### 2026-03-18 — BUG-F020-01: Query trim applied after min(1) validation

- **Issue**: `EstimateQuerySchema` defined `query: z.string().min(1).max(255).trim()`. A whitespace-only query like `"   "` passed `min(1)` (raw length 3), then Zod trimmed it to `""`. The empty string reached `level1Lookup` and returned a miss instead of a 400 validation error.
- **Root Cause**: Zod evaluates transforms in declaration order. `.min(1)` checked the raw (untrimmed) string, so whitespace-only inputs with length ≥ 1 bypassed the minimum length check.
- **Solution**: Reordered to `.trim().min(1).max(255)` so trim runs first, then `min(1)` rejects the empty result. Fixed in ce69f10.
- **Prevention**: For any Zod string schema with `.trim()`, always place `.trim()` BEFORE length validators (`.min()`, `.max()`). Zod processes transforms left-to-right.
- **Feature**: F020 | **Found by**: qa-engineer | **Severity**: Medium

### 2026-03-18 — BUG-F020-02: Echo returned lowercase query instead of original casing

- **Issue**: `GET /estimate?query=Big+Mac` returned `"query": "big mac"` in the response body. The spec sample shows `"query": "Big Mac"` — original casing should be preserved in the echo.
- **Root Cause**: The route applied `.toLowerCase()` for cache key normalization and reused the same lowercased variable for the response `data.query` field.
- **Solution**: Store original query (post-Zod-trim) for response echo. Use lowercased version only for cache key construction and DB lookup. Fixed in ce69f10.
- **Prevention**: When normalizing user input for internal use (cache keys, DB queries), keep the original value separate for echo/display purposes.
- **Feature**: F020 | **Found by**: qa-engineer | **Severity**: Low

### 2026-03-26 — BUG-F034-01: UNSUPPORTED_PDF not wrapped as MENU_ANALYSIS_FAILED in menuAnalyzer

- **Issue**: When `extractText` (pdf-parse wrapper) throws an `UNSUPPORTED_PDF` error (image-based PDF with no extractable text), the error propagates directly through `analyzeMenu` without being caught. The route's global error handler maps `UNSUPPORTED_PDF` to a 422 response with code `UNSUPPORTED_PDF`. However the F034 spec (Implementation Plan §PDF text extraction note) explicitly states: "If `extractText` throws `UNSUPPORTED_PDF`, catch and throw `MENU_ANALYSIS_FAILED` (422)". `UNSUPPORTED_PDF` is not listed in the F034 error code table — only `MENU_ANALYSIS_FAILED` is. Clients that only handle F034 error codes will encounter an undocumented code.
- **Root Cause**: `menuAnalyzer.ts` at lines 190–193 (OCR mode, PDF branch) and lines 251–255 (auto mode, PDF branch) calls `extractText(fileBuffer)` without a try/catch to intercept `UNSUPPORTED_PDF` and re-throw it as `MENU_ANALYSIS_FAILED`.
- **Solution**: Wrap each `extractText` call in a try/catch that catches errors with `code === 'UNSUPPORTED_PDF'` and re-throws a new error with `code: 'MENU_ANALYSIS_FAILED'` and `statusCode: 422`. Alternatively, catch all errors from `extractText` in the PDF branches and re-throw as `MENU_ANALYSIS_FAILED`.
- **Prevention**: When delegating to lower-level utilities that can throw domain-specific error codes, always audit whether those codes are part of the calling layer's API contract. If not, wrap and re-throw.
- **Feature**: F034 | **Found by**: qa-engineer | **Severity**: Low (functional — PDF still gets a 422; wrong code leaks through)
- **Test**: `f034.additional-edge-cases.test.ts` — "analyzeMenu — extractText throws UNSUPPORTED_PDF" (two tests marked `[BUG-CANDIDATE]`)

### 2026-03-26 — BUG-F034-02: partial:true with 0 dishes violates MenuAnalysisDataSchema.dishCount.min(1)

- **Issue**: If `analyzeMenu` returns `partial: true` after processing zero dishes (AbortSignal fires before the first cascade iteration), the route sends `dishCount: 0` and `dishes: []`. The `MenuAnalysisDataSchema` enforces `dishCount: z.number().int().min(1)` and `dishes: z.array(...).min(1)`, so the response body violates the documented schema. The route does not validate its own response against the schema before sending — this is a data consistency gap. Clients that validate the response against the spec will reject it.
- **Root Cause**: The route constructs the response directly from `result.dishes.length` (line 176 of `analyze.ts`) without checking whether the dishes array is empty in the partial case. The cooperative abort check in `analyzeMenu` (line 326) returns immediately with whatever has been processed, which can be an empty array.
- **Solution**: Either (a) validate that `result.dishes.length >= 1` before sending (returning a MENU_ANALYSIS_FAILED if empty), or (b) loosen the schema to allow `dishCount: 0` in the partial case (`z.number().int().min(0)` when `partial: true`), or (c) only return `partial: true` when at least 1 dish was processed.
- **Prevention**: Route handlers should validate their response shape against the documented schema before sending, especially for boundary cases created by timeout/abort paths.
- **Feature**: F034 | **Found by**: qa-engineer | **Severity**: Low (only affects a race condition where the timeout fires before a single cascade call completes)
- **Test**: `f034.additional-edge-cases.test.ts` — "analyzeMenu — AbortSignal pre-aborted" confirms the behavior.

### 2026-03-26 — BUG-F031-01: handlePhoto crashes with TypeError on empty msg.photo array

- **Issue**: `handlePhoto` in `packages/bot/src/handlers/fileUpload.ts` crashes with `TypeError: Cannot read properties of undefined (reading 'file_size')` when Telegram sends a message with an empty `msg.photo` array (`[]`). The outer `bot.on('photo', ...)` try/catch in `bot.ts` catches the error and logs it, but the user receives no response. Confirmed by QA test QA-B1 in `f031.qa-edge-cases.test.ts`.
- **Root Cause**: The guard `if (!msg.photo) return;` only protects against `undefined`/`null`. An empty array `[]` is truthy, so it passes the guard. Then `photos[photos.length - 1]` evaluates to `photos[-1]` which is `undefined`. The non-null assertion `!` on line 133 (`const photo = photos[photos.length - 1]!`) suppresses the TypeScript compiler but does not prevent the runtime error. When `photo` is `undefined`, the subsequent `photo.file_size` access throws.
- **Solution**: Add a length check after the `!msg.photo` guard: `if (!msg.photo || msg.photo.length === 0) return;`. This ensures `photos[photos.length - 1]` is always a defined `PhotoSize` object.
- **Prevention**: Non-null assertions (`!`) should be used only when the value is provably non-null by invariant. When the invariant relies on a separate guard, the guard must explicitly cover the empty-array case for array types. Consider replacing `const photo = photos[photos.length - 1]!` with `const photo = photos.at(-1); if (!photo) return;` for defensive access.
- **Feature**: F031 | **Found by**: qa-engineer | **Severity**: Medium (crashes silently — user gets no response, bot does not crash)

### 2026-03-28 — BUG-F042-01: PORTION_LABEL_MAP — spec labels corrected per code review

- **Issue**: Original spec had `0.5 → "pequeña"` and `0.7 → "mini"`, but semantically "media ración" (0.5 multiplier) should display "media" (half), not "pequeña" (small).
- **Root Cause**: Spec confusion between modifier tokens and display labels. "media ración" is the *input pattern* for 0.5, but the *display label* should match the concept: "media" = half portion.
- **Solution**: Corrected spec and implementation: `{ 0.5: 'media', 0.7: 'pequeña', 1.5: 'grande', 2.0: 'doble', 3.0: 'triple' }`. Approved by code-review-specialist.
- **Prevention**: Distinguish input patterns (what the user types) from display labels (what the bot shows). Review label maps for semantic accuracy, not just spec compliance.
- **Feature**: F042 | **Found by**: code-review-specialist | **Severity**: Low (spec correction, not runtime bug)

### 2026-03-28 — BUG-F043-01: Leading ¿ (inverted question mark) blocks NL comparison detection

- **Issue**: `extractComparisonQuery` uses `^` anchor in its prefix regexes. Spanish users who type `¿qué tiene más calorías, big mac o whopper?` (with the conventional Spanish opening `¿`) receive a single-dish estimate for the full garbled string instead of a comparison card. This is the exact motivating example from the ticket spec (F043, line 15). The NL handler calls `handleNaturalLanguage` on the trimmed text without stripping leading `¿` or `¡`.
- **Root Cause**: All five prefix patterns in `comparisonParser.ts` anchor at `^`. `¿` is a valid UTF-8 character that appears before `qué` in formal Spanish, so the `^qu[eé]...` pattern never matches.
- **Solution**: Strip leading `¿`/`¡` from text in `extractComparisonQuery` (or from `handleNaturalLanguage`) before applying prefix matching. One-liner: `const normalized = text.replace(/^[¿¡]+/, '').trim();` then pass `normalized` to `matchPrefix`. Trailing `?`/`!` can also be stripped before `splitByComparator` to prevent punctuation from ending up in the API query.
- **Prevention**: When implementing intent detection with `^`-anchored regexes for Spanish text, always normalize leading/trailing Spanish punctuation characters (`¿`, `¡`, `?`, `!`) before matching.
- **Tests**: `f043.qa-edge-cases.test.ts` — "F043 BUG-1" describe block (5 failing tests).
- **Feature**: F043 | **Found by**: qa-engineer | **Severity**: High

### 2026-03-28 — BUG-F043-02: Same-entity detection absent from formatComparison

- **Issue**: When both dish queries resolve to the same database entity (same `entityId`), `formatComparison` silently renders identical values in both columns with no indicator. The spec (F043, line 302-303) explicitly requires the note: `_Ambos platos corresponden al mismo resultado en la base de datos\._`
- **Root Cause**: `formatComparison` never compares `resultA.entityId` against `resultB.entityId`. The spec requirement was not implemented.
- **Solution**: In `formatComparison`, after confirming both results are non-null, check `resultA.entityId === resultB.entityId`. If true, append the required note outside the code block.
- **Prevention**: When a spec section lists edge case output requirements, add a corresponding test fixture where the edge case condition is satisfied, not just where results differ.
- **Tests**: `f043.qa-edge-cases.test.ts` — "F043 BUG-2" describe block (1 failing test).
- **Feature**: F043 | **Found by**: qa-engineer | **Severity**: Low

### 2026-03-28 — BUG-F043-03: "con" separator in NL path beats "o" for dish names containing "con"

- **Issue**: When a Spanish NL comparison query contains a dish whose name includes the word "con" (e.g., "pollo con verduras", "arroz con leche"), and the user separates the two dishes with "o" (e.g., `qué es más sano, pollo con verduras o hamburguesa`), the `splitByComparator` function splits on the first space-flanked ` con ` rather than the last space-flanked ` o `. This produces `dishA = "pollo"` / `dishB = "verduras o hamburguesa"` instead of `dishA = "pollo con verduras"` / `dishB = "hamburguesa"`.
- **Root Cause**: `COMPARISON_SEPARATORS` orders `'con'` before `'o'`. Both use space-flanked + last-occurrence strategy. When "con" appears in the dish name before the "o" separator, "con" wins because it is tried first. The last-occurrence strategy helps when the separator appears multiple times, but cannot help when "con" in the dish name appears before the "o" separator in text position.
- **Solution**: Separate the role of "con" in the command parser from the NL split. Option A: remove "con" from `COMPARISON_SEPARATORS` entirely and handle the `compara X con Y` NL pattern by using a dedicated regex that captures two named groups (everything before and after the last `con`). Option B: in `extractComparisonQuery`, when `con` wins but `o` or `y` also exists in the remainder, prefer the later-positioned `o`/`y` separator. Option C: only use `con` when it is the SOLE separator in the text (not when `o`/`y` also appears).
- **Prevention**: When adding conjunctions like "con" as separators, verify they don't conflict with the same word appearing legitimately inside dish names. Prefer dedicated NL prefix groups over generic separator lists for context-sensitive parsing.
- **Tests**: `f043.qa-edge-cases.test.ts` — "F043 BUG-3" describe block (2 failing NL tests). Note: `/comparar` command correctly handles "arroz con leche vs natillas" because `vs` has higher priority.
- **Feature**: F043 | **Found by**: qa-engineer | **Severity**: Medium

### 2026-03-28 — BUG-LANDING-01: Legal pages return 404 (/privacidad, /cookies, /aviso-legal)

- **Issue**: Footer and CookieBanner link to /privacidad, /cookies, /aviso-legal but no routes exist. All return 404.
- **Root Cause**: Pages were planned but never created during F039/F044 implementation.
- **Solution**: Fixed in F045 — created 3 Server Component pages with GDPR/LOPD/LSSI content, robots: { index: false }.
- **Prevention**: Any page that collects PII must have legal pages as a prerequisite (not a follow-up).
- **Feature**: F039/F044 | **Found by**: Cross-model audit (Claude+Gemini+Codex) | **Severity**: Critical (GDPR/LSSI non-compliance)

### 2026-03-28 — BUG-LANDING-02: og-image.jpg referenced in metadata but missing from public/

- **Issue**: layout.tsx metadata references /og-image.jpg for OpenGraph and Twitter cards. File does not exist in packages/landing/public/. All social sharing shows broken or fallback preview.
- **Root Cause**: Metadata was configured but the image asset was never created.
- **Solution**: Fixed in F045 — generated 1200x630 branded OG image (botanical green, 45KB) at public/og-image.jpg.
- **Prevention**: After configuring OG metadata, verify the referenced assets exist (automated check in production-code-validator).
- **Feature**: F039/F044 | **Found by**: Cross-model audit | **Severity**: Critical (blocks social sharing)

### 2026-03-28 — BUG-LANDING-03: Anchor links #waitlist and #demo point to non-existent IDs

- **Issue**: SiteHeader links to #waitlist and #demo. Neither ID exists in the DOM. Clicking does nothing.
- **Root Cause**: SiteHeader was built with placeholder anchors that were never wired to section IDs.
- **Solution**: Fixed in F045 — added id="waitlist" to WaitlistCTASection, id="demo" to product-demo section in all variant layouts.
- **Prevention**: Test anchor navigation as part of section integration.
- **Feature**: F044 | **Found by**: Cross-model audit | **Severity**: Important

### 2026-03-28 — BUG-LANDING-04: Variant D hero promises "Busca cualquier plato" but SearchSimulator is not in hero

- **Issue**: Variant D hero says "Busca cualquier plato. Mira qué sabes." but the SearchSimulator component is rendered in HowItWorksSection below the fold, not in the hero. A placeholder div exists but renders nothing.
- **Root Cause**: Implementation didn't embed SearchSimulator in the hero as designed.
- **Solution**: Fixed in F045 — Variant D fully removed per ADR-012 (types, routing, i18n, tests, API validation).
- **Prevention**: After implementing a variant, verify the user journey matches the hero promise.
- **Feature**: F044 | **Found by**: Cross-model audit | **Severity**: Critical (100% promise mismatch)

### 2026-03-28 — BUG-LANDING-05: PostSimulatorCTA visible before user interacts with SearchSimulator

- **Issue**: The "¿Te gusta lo que ves?" CTA with email form is visible from first render, before the user has used the SearchSimulator. It should only appear after a search interaction.
- **Root Cause**: SearchSimulatorWithCTA initializes hasInteracted=true or doesn't gate visibility.
- **Solution**: Fixed in F045 — changed useState(true) to useState(false) in SearchSimulatorWithCTA; CTA gated by onInteract callback.
- **Prevention**: Interactive CTAs that depend on prior engagement should be gated by interaction state.
- **Feature**: F044 | **Found by**: Codex audit | **Severity**: Important

### 2026-03-28 — BUG-LANDING-06: PostSimulatorCTA uses animate-fadeIn but Tailwind defines animate-fade-in

- **Issue**: CSS animation class mismatch — `animate-fadeIn` vs `animate-fade-in`. Animation doesn't play.
- **Root Cause**: Typo in class name.
- **Solution**: Fixed in F045 — changed class to `animate-fade-in` in PostSimulatorCTA.tsx.
- **Prevention**: Use Tailwind IntelliSense to catch invalid class names.
- **Feature**: F044 | **Found by**: Codex audit | **Severity**: Low

### 2026-03-28 — BUG-LANDING-07: Missing suppressHydrationWarning on html tag

- **Issue**: Palette script sets data-palette on `<html>` before hydration, causing React hydration mismatch warning.
- **Root Cause**: layout.tsx `<html>` tag doesn't have `suppressHydrationWarning`.
- **Solution**: Fixed in F045 — added suppressHydrationWarning to `<html>` tag in layout.tsx.
- **Prevention**: Any script that mutates DOM before hydration needs suppressHydrationWarning on the affected element.
- **Feature**: F044 | **Found by**: Gemini audit | **Severity**: Important

### 2026-03-28 — BUG-F037-01: `/contexto BORRAR` (uppercase) routes to Set flow instead of Clear flow

- **Issue**: Typing `/contexto BORRAR` (or any mixed-case variant: `Borrar`, `BORRAR`) is treated as a chain name to set, not as the clear subcommand. The user gets "No encontré ninguna cadena" instead of the expected clear confirmation. The existing chain context is NOT cleared.
- **Root Cause**: `handleContexto` in `packages/bot/src/commands/contexto.ts` uses a strict case-sensitive equality check: `if (trimmed === 'borrar')`. The Telegram bot regex for `/contexto` passes `match[1]` verbatim — any casing variation bypasses the clear branch.
- **Solution**: Change the equality check to a case-insensitive comparison: `if (trimmed.toLowerCase() === 'borrar')`. The spec does not require case-sensitivity on this subcommand, and Telegram users commonly send mixed-case inputs.
- **Prevention**: Subcommand routing on freeform text args should always normalize case before comparing. Add test coverage for uppercase/mixed-case subcommand variants.
- **Feature**: F037 | **Found by**: qa-engineer | **Severity**: Low (UX confusing but no data loss)

### 2026-03-29 — BUG-F047-01: Footer WaitlistForm violates S7 max 2 forms per variant

- **Issue**: Footer.tsx line 110 rendered a `<WaitlistForm source="footer" variant={variant} />`, making 3 WaitlistForm instances per variant page (hero + WaitlistCTASection + Footer). The audit requirement S7 specifies max 2 forms to avoid conversion fatigue.
- **Root Cause**: The Footer form was added during F044 overhaul and not removed during F047 "reduce forms to 2" implementation. The spec explicitly stated "The Footer component does NOT contain a WaitlistForm" but the developer did not audit Footer.tsx.
- **Solution**: Fixed in F047 — removed WaitlistForm import and the "Acceso anticipado" column from Footer.tsx. Updated Footer test to assert no form button.
- **Prevention**: When reducing form instances, audit ALL components that import WaitlistForm, not just variant layouts in page.tsx.
- **Feature**: F047 | **Found by**: qa-engineer | **Severity**: Medium

### 2026-03-28 — BUG-F037-02: `detectContextSet` captures embedded newlines in chain identifier

- **Issue**: Input `"estoy en\nmcdonalds"` (newline-separated, possible from copy-paste or multiline Telegram message via the `/s` regex in `bot.ts`) returns `"mcdonalds"` instead of null. The `\s+` in `CONTEXT_SET_REGEX` matches newlines, so the newline is consumed as part of the `\s+` between "en" and the capture. The capture group `[^,¿?!.]{1,50}` then captures everything after the newline.
- **Root Cause**: `CONTEXT_SET_REGEX` is not anchored against multiline in the whitespace position, and `\s+` matches `\n`. This can cause surprising context-set matches for multi-line messages delivered from `/contexto` (which uses the `/s` dotAll flag in its registration regex).
- **Solution**: In `detectContextSet`, reject captures that contain newlines: `if (/\n/.test(captured)) return null;`. Alternatively, change `\s+` to `[^\S\n]+` (horizontal whitespace only) in the regex.
- **Prevention**: When writing regexes for Telegram bot input, account for the dotAll (`/s`) flag in the bot registration regex that can deliver multiline text. Test with `\n`-embedded inputs.
- **Feature**: F037 | **Found by**: qa-engineer | **Severity**: Low (edge case, graceful downstream handling via resolveChain min-length guard in most scenarios)

### 2026-03-28 — BUG-LANDING-08: JSON-LD SearchAction points to /?q= which doesn't function

- **Issue**: seo.ts includes a SearchAction schema with urlTemplate `/?q={search_term_string}`. The page doesn't read or act on ?q= parameter.
- **Root Cause**: SearchAction was added aspirationally but the functionality doesn't exist.
- **Solution**: Fixed in F045 — removed potentialAction (SearchAction) from generateWebSiteSchema() in seo.ts.
- **Prevention**: Only include structured data for features that actually exist.
- **Feature**: F044 | **Found by**: Claude+Codex audit | **Severity**: Important

### 2026-03-28 — BUG-F046-01: WaitlistForm crashes on API errors — type contract mismatch between API error shape and component expectation

- **Issue**: `WaitlistForm.tsx` types the error response body as `{ error?: string }` (line 141), but the Fastify `errorHandler.ts` ALWAYS returns `{ success: false, error: { code: string, message: string } }`. When any non-ok HTTP response is received (400, 429, 500), `setErrorMessage(data?.error)` stores an object in state. React then throws "Objects are not valid as a React child" when rendering `{errorMessage}` inside the `<p>` error element, crashing the form entirely.
- **Root Cause**: Developer tests in `WaitlistForm.test.tsx` mock error responses with `error: 'Error del servidor'` (a plain string) — a format that the real API never produces. This hidden the type mismatch. The real API always returns `error` as a nested object.
- **Solution**: In `WaitlistForm.tsx` handleSubmit error branch, extract the message from the error object before calling setErrorMessage: `const errMsg = typeof data?.error === 'object' ? (data.error as { message?: string }).message ?? 'Ha ocurrido un error.' : data?.error ?? 'Ha ocurrido un error.'; setErrorMessage(errMsg);`. Also fix the type annotation from `{ error?: string }` to `{ error?: string | { code: string; message: string } }`.
- **Prevention**: Always mock API error responses with the exact shape the API actually returns. Integration-test the error path end-to-end (UI -> real fetch mock with real API response format). Use `satisfies` or typed API client responses to make mismatches compile-time errors.
- **Feature**: F046 | **Found by**: QA edge-case tests | **Severity**: Critical (production crash on any API error)

### 2026-03-28 — BUG-F046-02: POST /waitlist 409 response does not return existing record (spec deviation)

- **Issue**: The ticket spec states "return 409 with the existing record" and "this makes the endpoint idempotent" (lines 51, 59, 156). The implementation on P2002 throws `DUPLICATE_EMAIL` which maps to `{ success: false, error: { code: 'DUPLICATE_EMAIL' } }`. The existing record is never fetched (`prisma.waitlistSubmission.findUnique` is not called), and `data` is absent from the 409 body.
- **Root Cause**: The implementation plan in the same ticket (line 276) says "throw `DUPLICATE_EMAIL`" without referencing the spec requirement to return the existing record. The two sections of the ticket contradict each other and the developer followed the implementation plan rather than the spec description.
- **Solution**: On P2002, query the existing record with `findUnique({ where: { email } })` and return 409 with the existing record in `data`. The error handler approach should be replaced with a direct reply: `return reply.status(409).send({ success: false, error: { code: 'DUPLICATE_EMAIL' }, data: { id: existing.id, email: existing.email } })`. Alternatively, accept the current behavior as intentional (landing treats 409 as success regardless of body content) and update the spec to match.
- **Prevention**: When spec and implementation plan contradict each other, flag during implementation. QA should always compare the API response shape against the spec, not just the HTTP status code.
- **Feature**: F046 | **Found by**: QA edge-case tests | **Severity**: Medium (functional but spec non-compliant; landing handles 409 as success regardless)

### 2026-03-28 — BUG-F046-03: Email case sensitivity — same email with different casing bypasses duplicate detection

- **Issue**: `USER@EXAMPLE.COM` and `user@example.com` are accepted as distinct registrations. The Postgres `UNIQUE` constraint on `waitlist_submissions.email` is case-sensitive by default (uses `btree` index, no `lower()` function or `citext` type). A user could register twice with the same email address using different capitalization.
- **Root Cause**: The Zod schema and route handler store emails as-is without `toLowerCase()` normalization. The DB constraint enforces uniqueness but only exact-match. The email check constraint uses `~*` (case-insensitive regex), which validates format but not uniqueness.
- **Solution**: Normalize email to lowercase before persisting: `email: body.email.toLowerCase()` in the route handler. Alternatively, create a functional unique index: `CREATE UNIQUE INDEX ON waitlist_submissions (lower(email))` and change the constraint. Also add `.toLowerCase()` or `.transform(v => v.toLowerCase())` to the Zod schema.
- **Prevention**: Always normalize email addresses before persistence. Add an edge-case test for case-variant duplicates at both schema and DB levels.
- **Feature**: F046 | **Found by**: QA edge-case tests | **Severity**: Low (duplicate registrations with different casing; no data loss, but inflates subscriber count)

### 2026-03-29 — BUG-AUDIT-01: `¿` not stripped in NL single-dish path (extractFoodQuery)

- **Issue**: `¿cuántas calorías tiene un big mac?` is not parsed correctly. The prefix patterns in `extractFoodQuery` use `^` anchors but `¿` is not stripped before matching, so `¿cuántas...` doesn't match `^cu[aá]ntas...`. The text passes through unstripped and is sent literally to the API. Comparisons (`extractComparisonQuery`) and context detection (`detectContextSet`) DO strip `¿¡` correctly.
- **Root Cause**: `extractFoodQuery` in `naturalLanguage.ts` was implemented before the `¿` stripping pattern was established in F043 (`comparisonParser.ts:227`) and F037 (`contextDetector.ts:20`). The pattern was never backported.
- **Solution**: Add `¿¡` stripping at the top of `extractFoodQuery`, before prefix matching: `const cleaned = text.replace(/^[¿¡]+/, '').replace(/[?!]+$/, '').trim();`
- **Prevention**: When adding punctuation normalization to one NL path, check all NL paths for consistency.
- **Feature**: F028 (NL handler) | **Found by**: Gemini CLI manual audit | **Severity**: Medium (user input with `¿` silently degrades instead of failing)

### 2026-03-29 — BUG-C1: Rate limit checked AFTER file download in upload_menu/upload_dish

- **Issue**: In `callbackQuery.ts`, the `upload_menu` and `upload_dish` handlers downloaded the full file from Telegram into a memory buffer BEFORE checking the per-user rate limit. A rate-limited user spamming the inline keyboard could force repeated downloads, wasting bandwidth and memory.
- **Root Cause**: Original F034 spec assumed download was cheap and ordered the checks as "download → rate limit → API call". In practice, download is the most expensive step.
- **Solution**: Moved `isRateLimited()` check BEFORE `downloadTelegramFile()` in both handlers. Rate-limited users now incur zero server cost.
- **Prevention**: Rate limit checks should always be the FIRST guard after auth/state validation — before any I/O operations.
- **Feature**: F034 (Menu Analysis) | **Found by**: Gemini CLI comprehensive audit | **Severity**: Critical (DDoS vector) | **Fixed in**: F051

### 2026-03-29 — BUG-I11: /receta rate limit counts failed API requests

- **Issue**: In `receta.ts`, the rate limit counter was incremented BEFORE the API call. If the API returned an error (500, timeout, network), the user lost a rate limit slot without getting a useful result.
- **Root Cause**: Rate limit increment was placed at the start of the function, before the try/catch block for the API call.
- **Solution**: Added `decrementRateLimit()` helper that calls `redis.decr()` on server/network errors (5xx, TIMEOUT, NETWORK_ERROR). 4xx errors (user input) and 429 (legitimate throttle) keep the counter. Decrement failures are silently swallowed (fail-open).
- **Prevention**: Consider the full lifecycle of rate-limit counters: increment early for abuse prevention, but refund on infrastructure failures.
- **Feature**: F041 (Bot Recipe Calculator) | **Found by**: Claude Opus 4.6 comprehensive audit | **Severity**: Important | **Fixed in**: F051

### 2026-04-03 — BUG-F071-01: parseNutrientValue passes Infinity through as a valid number

- **Issue**: `parseBedcaFoods()` in `bedcaParser.ts` returns `Infinity` (JavaScript's positive infinity) as a valid nutrient value when the XML source contains the literal string `"Infinity"`. The value is then stored as-is in `BedcaNutrientValue.value` and passed downstream to the mapper and DB seed. `Infinity` is not a valid nutrition value and would likely fail PostgreSQL insertion (Prisma converts Infinity to a non-finite float, which violates DB numeric columns).
- **Root Cause**: The internal `parseNutrientValue()` function guards against non-numeric strings using `isNaN(num)`, but `isNaN(Infinity) === false` — JavaScript considers `Infinity` a valid number. The function does not check `Number.isFinite()`.
- **Solution**: In `parseNutrientValue()` in `packages/api/src/ingest/bedca/bedcaParser.ts`, change the guard from `isNaN(num) ? null : num` to `!Number.isFinite(num) ? null : num`. This converts both `NaN` and `Infinity`/`-Infinity` to null, which is the correct representation for unmeasured or invalid nutrient values.
- **Prevention**: When parsing user-supplied or API-supplied numeric strings into domain types, always validate with `Number.isFinite()` rather than `!isNaN()`. `isNaN()` allows Infinity, which is rarely a valid business value. Add `Number.isFinite()` assertions to all nutrient parsers.
- **Reproduction**: `parseBedcaFoods('<food_database><row><food_id>1</food_id>...<value>Infinity</value></row></food_database>')` — the returned food's nutrient has `value === Infinity`.
- **Feature**: F071 | **Found by**: QA agent | **Severity**: Medium | **Fixed in**: F071 (commit 21bc8d6)

### 2026-04-03 — F071 QA NOTES — Coverage gap (low priority)

- **Coverage Gap**: `seedPhaseBedca()` has no DI hook for the snapshot file path, making the "missing snapshot file" error path untestable without mocking `fs` at module level. The error produced is a bare Node.js ENOENT with no user-friendly message. Low priority — the file is committed to the repo.
- **Feature**: F071 | **Assessed by**: QA agent

### 2026-04-03 — BUG-F072-01: isAlreadyCookedFood false positives via substring matching

- **Issue**: `isAlreadyCookedFood` used plain substring matching (`includes()`) on cooking keywords. Names like `"uncooked rice"`, `"unbaked bread"` falsely triggered the guard.
- **Root Cause**: `lower.includes(keyword)` without word-boundary anchoring.
- **Solution**: Replaced with word-boundary regex `/\b<keyword>\b/i.test(foodName)`. 4 edge-case tests added.
- **Feature**: F072 | **Found by**: qa-engineer | **Severity**: Medium | **Fixed in**: F072 (commit 8f4c522)

---

### 2026-04-03 — BUG-F073-01: DishNutrient upsert update block missing estimationMethod, confidenceLevel, sourceId

- **Issue**: `seedPhaseSpanishDishes.ts` upserts DishNutrient records using `where: { id: entry.nutrientId }`. The `update` block contains only the 9 macro fields (calories, proteins, …, sodium). Fields `estimationMethod`, `confidenceLevel`, and `sourceId` are absent from `update`. On re-seed, if a dish's provenance is upgraded from `recipe` (Tier 3) to `bedca` (Tier 1), the DishNutrient row keeps the stale `estimationMethod='ingredients'`, `confidenceLevel='medium'`, and `sourceId` pointing to the recipes DataSource.
- **Root Cause**: Developer wrote the `create` block with all required fields but omitted the same provenance fields from the `update` block. The spec's "Gotcha — DishNutrient required fields" warned about `estimationMethod` and `confidenceLevel` in the create block but implicitly assumed update parity.
- **Solution**: Add `estimationMethod: entry.estimationMethod`, `confidenceLevel: entry.confidenceLevel`, and `sourceId` (computed from `entry.source`) to the `update` block of the `dishNutrient.upsert` call in `seedPhaseSpanishDishes.ts`.
- **Prevention**: When writing Prisma upserts with idempotency guarantees, always audit that `update` and `create` carry the same semantically-required fields. If a field must be correct after re-seed, it must appear in both blocks. Code review checklist should include "do update and create blocks cover all non-immutable fields?".
- **Feature**: F073 | **Found by**: qa-engineer | **Severity**: Major | **Exposed by**: `f073.seedPhaseSpanishDishes.edge-cases.test.ts` (5 tests)

### 2026-04-03 — BUG-F073-02: Dish upsert update block missing sourceId

- **Issue**: `seedPhaseSpanishDishes.ts` upserts Dish records. The `update` block contains `name`, `nameEs`, `aliases`, `portionGrams`, `confidenceLevel`, `estimationMethod` but not `sourceId`. If a dish's provenance source changes between seed versions (e.g., an LLM-estimated recipe dish gets BEDCA data), re-seeding leaves `Dish.sourceId` pointing to the old DataSource. This breaks the provenance chain at the Dish level while DishNutrient (once BUG-F073-01 is fixed) would be correct.
- **Root Cause**: `sourceId` was not included in the Dish `update` block. The create block correctly computes `sourceId` from `entry.source`, but the update path was not kept in sync.
- **Solution**: Add `sourceId` (computed from `entry.source` using the same `bedca ? BEDCA_SOURCE_UUID : COCINA_ESPANOLA_RECIPES_SOURCE_UUID` conditional) to the `update` block of the `dish.upsert` call.
- **Prevention**: Same as BUG-F073-01 — update/create parity audit.
- **Feature**: F073 | **Found by**: qa-engineer | **Severity**: Major | **Exposed by**: `f073.seedPhaseSpanishDishes.edge-cases.test.ts` (1 test)

### 2026-04-03 — BUG-F073-03: validateSpanishDishes does not validate dishId or nutrientId presence/format

- **Issue**: `validateSpanishDishes()` checks uniqueness of `dishId` and `nutrientId` via Set membership, but only after accessing `entry.dishId` and `entry.nutrientId` without a null/empty guard. A JSON entry with `dishId: null` or `dishId: ""` passes validation (`null` is added to the Set, treated as unique). When the seed then calls `prisma.dish.upsert({ where: { id: null } })`, Prisma throws a runtime FK/constraint error instead of a descriptive validation error.
- **Root Cause**: The uniqueness check loop assumes fields are non-null strings. No explicit guard for null, undefined, or empty-string dishId/nutrientId was added.
- **Solution**: Add checks in the per-entry loop: `if (!entry.dishId || entry.dishId.trim().length === 0)` → blocking error. Same for `nutrientId`. Optionally add UUID format regex validation.
- **Prevention**: When iterating over FK fields, always add a null/empty guard before the Set-membership check.
- **Feature**: F073 | **Found by**: qa-engineer | **Severity**: Major | **Exposed by**: `f073.validateSpanishDishes.edge-cases.test.ts` (4 tests)

### 2026-04-03 — BUG-F073-04: validateSpanishDishes does not cross-check source vs estimationMethod/confidenceLevel

- **Issue**: The spec mandates that `source='bedca'` implies `estimationMethod='official'` and `confidenceLevel='high'`, and `source='recipe'` implies `estimationMethod='ingredients'` and `confidenceLevel='medium'`. The validator checks each field independently but never cross-validates them. A JSON entry with `source='bedca'` and `estimationMethod='ingredients'` passes validation and seeds incorrect provenance metadata into the database.
- **Root Cause**: The validator was written as independent per-field checks. The cross-field invariant was documented in the spec but not translated into a validation rule.
- **Solution**: Add cross-check rules in the per-entry loop: if `entry.source === 'bedca'` and `entry.estimationMethod !== 'official'` → blocking error; if `entry.source === 'bedca'` and `entry.confidenceLevel !== 'high'` → blocking error; mirror for `'recipe'`.
- **Prevention**: Spec-derived cross-field invariants ("X implies Y") must be explicitly listed in the validator, not left implicit. During code review, audit whether all spec-stated implications are enforced.
- **Feature**: F073 | **Found by**: qa-engineer | **Severity**: Major | **Exposed by**: `f073.validateSpanishDishes.edge-cases.test.ts` (4 tests)

### 2026-04-03 — BUG-F073-05: validateSpanishDishes does not validate aliases is an array

- **Issue**: `validateSpanishDishes()` iterates over `entry.aliases` via the Set-membership path but never checks whether `aliases` is actually an array. A JSON entry with `aliases: "tortilla española"` (string) passes validation. At seed time, Prisma receives a string for a `String[]` column; behavior depends on the ORM/driver (may silently store it or throw a confusing error).
- **Root Cause**: The validator omits a `Array.isArray(entry.aliases)` guard. TypeScript types would catch this at compile time for authored code, but the JSON file is cast with `as SpanishDishesFile` and never validated at the type level at runtime.
- **Solution**: Add `if (!Array.isArray(entry.aliases))` check → blocking error in the per-entry validation loop.
- **Prevention**: Fields that are arrays in TypeScript but come from external JSON must always be validated with `Array.isArray()` at runtime, not trusted from the TypeScript cast.
- **Feature**: F073 | **Found by**: qa-engineer | **Severity**: Minor | **Exposed by**: `f073.validateSpanishDishes.edge-cases.test.ts` (2 tests)

### 2026-04-04 — BUG-F074-01: engineRouter.ts logger adapter calls logger.error() — method absent from Logger type

- **Issue**: The `applyYield` helper in `runEstimationCascade` builds a logger adapter for `resolveAndApplyYield`. The adapter at line 130 called `logger.error({}, msg)`, but `EngineRouterOptions.logger` was typed as `{ info, warn, debug }` — no `error` method. TypeScript reported `TS2339: Property 'error' does not exist`. At runtime, if `logger.error` was called (when `resolveAndApplyYield` hit an error code path), it would throw `TypeError: logger.error is not a function`.
- **Root Cause**: The `applyYield.ts` logger interface requires `{ warn, error }` but the `EngineRouterOptions.logger` type was not updated to include `error`. The adapter pattern tried to map the outer logger onto the inner interface but the outer type lacked the method.
- **Solution**: Added `error: (obj: Record<string, unknown>, msg?: string) => void` to the `EngineRouterOptions.logger` type and properly routed it in the adapter. Fixed in commit `f73c4f4`.
- **Prevention**: When building logger adapters between mismatched interfaces, verify at compile time that all required target methods exist on the source type. Add a `tsc --noEmit` step to CI to catch these type errors before tests.
- **Feature**: F074 | **Found by**: qa-engineer | **Severity**: High (runtime crash risk in error code path) | **TypeScript error**: `TS2339` | **Status**: Fixed in `f73c4f4`

### 2026-04-04 — BUG-F074-02: runStrategyA return type missing rawFoodGroup — TypeScript compile error

- **Issue**: `runStrategyA` returned `{ matchType, result, rawFoodGroup: nutrientRow.food_group }` but its declared return type was `{ matchType, result } | null` — no `rawFoodGroup`. TypeScript reported `TS2353: Object literal may only specify known properties, and 'rawFoodGroup' does not exist in type`. At runtime, the field WAS present in the JS object (JS does not strip extra properties), so the engine router's call to `applyYield(lookupResult4.result, lookupResult4.rawFoodGroup)` received the correct value. TypeScript-only error with no runtime impact.
- **Root Cause**: The `rawFoodGroup` field was added to the Strategy A return value (for yield correction threading, per F072) but was not added to the TypeScript return type declaration of `runStrategyA`.
- **Solution**: Add `rawFoodGroup?: string | null` to the `runStrategyA` declared return type. (Still open as of the QA session — remains in `tsc --noEmit` output.)
- **Prevention**: When adding fields to a function's return object, always update the TypeScript return type declaration in the same change. Enable `tsc --noEmit` in CI to catch these immediately.
- **Feature**: F074 | **Found by**: qa-engineer | **Severity**: Medium (TypeScript compile error; no runtime impact) | **TypeScript error**: `TS2353` | **Status**: Open — needs fix in `runStrategyA` return type

### 2026-04-04 — BUG-F075-01: handleVoice propagates sendChatAction failure — user gets no response

- **Issue**: In `packages/bot/src/handlers/voice.ts`, `await bot.sendChatAction(chatId, 'typing')` is called **outside** any try/catch block (lines 63-64). If Telegram's API returns an error (bot was blocked, chat ID invalid, network issue), the rejection propagates to the `bot.on('voice', ...)` wrapper in `bot.ts`, which only logs the error. The user receives **no response** — not even a generic error message. This is inconsistent with every other handler in the codebase where Telegram API calls are wrapped in try/catch.
- **Root Cause**: The typing chat action was placed between the bot-side guards (which have their own early-return sendMessage calls inside try blocks) and the file download try/catch, but outside both. No test covered a failing `sendChatAction`.
- **Solution**: Wrap `sendChatAction` in a fail-open try/catch: `try { await bot.sendChatAction(chatId, 'typing'); } catch { /* ignore — typing indicator is best-effort */ }`. The voice processing should continue regardless. The spec says (Key Patterns section): "Send `bot.sendChatAction(chatId, 'typing')` after the bot-side guards pass but BEFORE the file download and API call" — the fail-open behavior is implied by the design intent.
- **Prevention**: Bot-side Telegram API calls that are "best-effort" (chat actions, status updates) must always be wrapped in fail-open try/catch. Reserve propagation only for calls that are semantically required (e.g., the final `sendMessage` response — though even that should have a fallback log).
- **Feature**: F075 | **Found by**: qa-engineer | **Severity**: Medium (UX: silent failure on Telegram API blip) | **Exposed by**: `f075.voice.edge-cases.test.ts` — "BUG: sendChatAction rejects → error propagates" | **Status**: Open

### 2026-04-04 — BUG-F076-01: splitMenuItems splits compound dish names when last item contains " y "

- **Issue**: `detectMenuQuery('menú: sopa, arroz y verduras')` returns `['sopa', 'arroz', 'verduras']` instead of `['sopa', 'arroz y verduras']`. Any Spanish dish whose canonical name contains the conjunction " y " (e.g. "arroz y verduras", "macarrones y atún", "judías y patatas") is silently split into two separate queries when it appears as the last comma-separated item. Each fragment is then estimated independently, producing wrong nutritional totals — a dish estimated as "arroz" + "verduras" separately instead of "arroz y verduras".
- **Root Cause**: `splitMenuItems` applies `splitOnFinalConjunction` to the **last comma-split item** unconditionally. This heuristic is correct when there are NO commas (voice transcription like "gazpacho y café"), but incorrect when commas are present — in that case, all items are already separated and " y " inside the last item is part of the dish name, not a conjunction between list items.
- **Solution**: Apply `splitOnFinalConjunction` on the last item ONLY when there are no other commas in the input (i.e., `items.length === 1` path). When `items.length >= 2`, the comma already separated the items — skip conjunction splitting on the last element. The existing tests for the no-comma path (`"menú: gazpacho y ensalada"`) would remain correct; only the comma+conjunction path changes.
- **Prevention**: The conjunction-split heuristic must be guarded by whether commas were already used as separators. If commas are present, they are the authoritative separator and " y " within an item is part of the dish name. Add regression tests for compound dish names in last position: "arroz y verduras", "macarrones y atún", "bacalao y tomate".
- **Feature**: F076 | **Found by**: qa-engineer | **Severity**: High (wrong nutritional totals; silent data corruption) | **Exposed by**: `f076.menuDetector.edge-cases.test.ts` — 4 BUG-1 tests | **Status**: Fixed (bdbc698)

### 2026-04-06 — BUG-F080-01: offValidator crashes with TypeError on null code/id (JSON null from OFF API)

- **Issue**: Calling `validateOffProduct({ code: null, _id: 'abc' })` throws `TypeError: Cannot read properties of null (reading 'trim')`. The OFF API can return JSON `null` for optional string fields at runtime. When `product.code` is `null`, the identifier check evaluates `product.code !== undefined` as `true` (null is not undefined), then immediately calls `null.trim()` which crashes.
- **Root Cause**: The identifier check at `offValidator.ts:44` uses `product.code !== undefined && product.code.trim() !== ''`. The `!== undefined` guard does not protect against `null`; it only guards against missing fields. JSON deserialization produces `null` (not `undefined`) for explicitly null-valued fields in the OFF API response.
- **Solution**: Replace the `!== undefined` checks with null-safe optional chaining. Use `product.code?.trim()` (truthy check) instead of `product.code !== undefined && product.code.trim() !== ''`. Pattern: `(product.code != null && product.code.trim() !== '')`.
- **Prevention**: Any validator that receives external JSON data must guard against `null` separately from `undefined`. TypeScript's optional fields (`field?: string`) only prevent `undefined`, not `null`. Use `!= null` (double equals, covers both) or `?. ` optional chaining when calling methods on fields from external APIs.
- **Feature**: F080 | **Found by**: qa-engineer | **Severity**: High (crashes import for products with null code field) | **Exposed by**: `f080.edge-cases.unit.test.ts` — BUG-1 tests

### 2026-04-06 — BUG-F080-02: offValidator accepts null product_name as a valid name

- **Issue**: `validateOffProduct({ product_name: null, product_name_es: null, ... })` returns `{ valid: true }` instead of rejecting the product. The name check at `offValidator.ts:35-36` uses `product.product_name?.trim() !== ''` — optional chaining on `null` returns `undefined`, and `undefined !== ''` evaluates to `true`. The subsequent `product.product_name !== undefined` check also passes because `null !== undefined`. Both conditions are true, so `hasName = true` even though the product has no usable name.
- **Root Cause**: The name validation logic is logically inverted. It checks `value?.trim() !== ''` first (which is `true` for `null` due to optional chaining returning `undefined`) and then checks `value !== undefined` (which is `true` for `null`). The intent was to check "the field exists and is non-empty", but the implementation is backwards and `null` slips through.
- **Solution**: Replace the name check with null-safe equality: `(product.product_name != null && product.product_name.trim() !== '')`. Using `!= null` (loose inequality) covers both `null` and `undefined` in a single check.
- **Prevention**: When writing existence+non-empty checks for string fields, prefer `value != null && value.trim() !== ''` over optional chaining. The `?.` operator returns `undefined` for both `null` and `undefined` receivers, masking the null case.
- **Feature**: F080 | **Found by**: qa-engineer | **Severity**: Medium (products with null names pass validation and get imported with empty name strings) | **Exposed by**: `f080.edge-cases.unit.test.ts` — BUG-2 tests

### 2026-04-06 — BUG-F080-03: offMapper creates invalid externalId from whitespace barcode

- **Issue**: When `product.code = '   '` (whitespace only) and `product._id = 'abc123'`, the mapper's `computeExternalId` returns `'OFF-   '` (whitespace in the ID) instead of `'OFF-id-abc123'`. The barcode field is also set to `'   '` instead of `null`. The validator correctly rejects whitespace as a valid code identifier (using `.trim()` check), but if `_id` is present, the product passes validation. The mapper then uses `if (product.code)` (truthy check) — a whitespace string is truthy in JavaScript, so the mapper uses the whitespace code.
- **Root Cause**: `computeExternalId` in `offMapper.ts:29` uses `if (product.code)` (truthy) to check for a valid barcode. A non-empty whitespace string like `'   '` is truthy. The validator uses `product.code.trim() !== ''` (correct) but the mapper does not.
- **Solution**: Change `computeExternalId` to use `if (product.code?.trim())` to ensure the barcode is non-empty after trimming. Also change the barcode assignment `barcode: product.code ?? null` to `barcode: product.code?.trim() || null` to avoid storing whitespace barcodes.
- **Prevention**: When checking string values that come from external APIs, always apply `.trim()` before treating the string as non-empty. Use a helper `isNonEmpty(s: string | undefined | null)` that checks both null-safety and trim.
- **Feature**: F080 | **Found by**: qa-engineer | **Severity**: Medium (whitespace barcode stored in DB, wrong externalId created — products would not be idempotently upserted on re-run) | **Exposed by**: `f080.edge-cases.unit.test.ts` — BUG-3 tests

### 2026-04-04 — BUG-F076-02: NOISE_REGEX does not filter bare "€" symbol

- **Issue**: `detectMenuQuery('menú: gazpacho, €, pollo')` returns `['gazpacho', '€', 'pollo']` instead of `['gazpacho', 'pollo']`. A bare "€" symbol (without a digit before or after it) is not filtered by the noise regex and is passed to the estimation engine as a dish name query.
- **Root Cause**: `NOISE_REGEX` has two alternatives: `^\d+(?:[.,]\d+)?\s*(?:€|euros?)?$` (requires leading digit) and `^€\d` (requires digit after €). A lone "€" matches neither: it has no leading digit and no digit after it. This occurs in practice when users copy-paste menu OCR output containing a price written as "€" alone, or when Whisper transcribes a price separator as just the euro symbol.
- **Solution**: Extend `NOISE_REGEX` to also match `^€$` (exactly the euro symbol alone) or, more generally, `^€\d*$` to cover any standalone currency symbol variant. Alternatively, add `|^€$` to the existing regex: `/^\d+(?:[.,]\d+)?\s*(?:€|euros?)?$|^€\d|^€$/i`.
- **Prevention**: When defining noise filters for currency symbols, test all variants: with digit before, with digit after, and alone. Document the exact strings that should and should not be filtered in the regex definition comment.
- **Feature**: F076 | **Found by**: qa-engineer | **Severity**: Minor (bare "€" treated as dish name; estimation engine returns no result for it) | **Exposed by**: `f076.menuDetector.edge-cases.test.ts` — BUG-3 test | **Status**: Fixed (bdbc698)

### 2026-04-03 — BUG-F073-06: validateSpanishDishes throws TypeError on undefined/null input

- **Issue**: Calling `validateSpanishDishes(undefined)` or `validateSpanishDishes(null)` (which happens when `raw.dishes` is missing from the JSON) throws `TypeError: Cannot read properties of undefined (reading 'length')` instead of returning `{ valid: false, errors: [...] }`. The TypeError propagates as an unhandled exception from the seed function, bypassing the error-collection mechanism and producing a cryptic stack trace.
- **Root Cause**: The function opens with `if (dishes.length < 250)` with no null guard. The `seedPhaseSpanishDishes.ts` caller does `JSON.parse(readFileSync(...)) as SpanishDishesFile` and immediately accesses `raw.dishes` without checking the key exists, then passes it directly to `validateSpanishDishes`. If the JSON has no `dishes` key, `raw.dishes` is `undefined`.
- **Solution**: Add `if (!Array.isArray(dishes))` guard at the top of `validateSpanishDishes`: push a descriptive error and return `{ valid: false }` immediately. Alternatively, add a guard in `seedPhaseSpanishDishes.ts` before calling the validator.
- **Prevention**: Public validation functions accepting external data must guard against non-array input at the entry point before accessing any array method. Never trust a TypeScript cast on data loaded from disk.
- **Feature**: F073 | **Found by**: qa-engineer | **Severity**: Minor | **Exposed by**: `f073.validateSpanishDishes.edge-cases.test.ts` (2 tests)

### 2026-04-08 — BUG-AUDIT-C1C3: `/reverse-search` error envelope inconsistency

- **Issue**: (C1) 404 CHAIN_NOT_FOUND returns `{success: false, code: "CHAIN_NOT_FOUND", message: "..."}` — flat structure instead of nested `{success: false, error: {code, message}}`. (C3) 400 validation error returns raw Zod output `{success: false, error: {formErrors: [], fieldErrors: {...}}}` instead of the standard `{success: false, error: {code: "VALIDATION_ERROR", message: "..."}}` wrapper.
- **Root Cause**: The `/reverse-search` route handler in `reverseSearch.ts` constructs error responses manually instead of throwing typed errors for the global error handler to format. The Zod validation is done inline with `.safeParse()` and the error is returned directly without going through `mapError()`.
- **Solution**: Throw `CHAIN_NOT_FOUND` as a typed error (like other routes) so the global error handler wraps it. For Zod validation, use Fastify's built-in schema validation or throw a VALIDATION_ERROR with formatted message.
- **Prevention**: All routes must use the global error handler for error formatting. Never return error responses directly — always throw typed errors.
- **Feature**: F086 | **Found by**: Phase B Audit (Punto 2 + Codex review) | **Severity**: High | **Status**: Fixed (PR #82)

### 2026-04-08 — BUG-AUDIT-C4: POST endpoints return 500 on missing/invalid body

- **Issue**: POST to `/calculate/recipe` or `/conversation/message` without a body (or with invalid JSON) returns 500 INTERNAL_ERROR. Should return 400 VALIDATION_ERROR.
- **Root Cause**: Fastify's JSON body parser throws a `SyntaxError` (invalid JSON) or the route handler accesses `request.body` as null/undefined. The global error handler catches it as a generic error and returns 500.
- **Solution**: Add error handler case for `SyntaxError` / FST_ERR_CTP_EMPTY_JSON_BODY that maps to 400 VALIDATION_ERROR.
- **Prevention**: Test all POST endpoints with: no body, empty body `{}`, and invalid JSON as standard edge-case coverage.
- **Feature**: Global (all POST routes) | **Found by**: Phase B Audit (Punto 4) | **Severity**: Medium | **Status**: Fixed (PR #83)

### 2026-04-08 — BUG-AUDIT-C5: Reverse search via conversation returns empty results

- **Issue**: `POST /conversation/message` with reverse_search intent returns `intent: "reverse_search"` but no `reverseSearch` data. Direct `GET /reverse-search` works correctly for the same parameters.
- **Root Cause**: `conversationCore.ts:148` calls `reverseSearchDishes(db, {...})` wrapped in a `catch` block (line 161) that silently swallows the error. The actual DB error is unknown — possibly a Kysely instance mismatch between conversation and reverse-search routes.
- **Solution**: Add error logging in the catch block. Investigate whether the Kysely `db` instance is the same singleton. Fix the underlying query/instance issue.
- **Prevention**: Never use empty `catch` blocks — always log the error. Add integration tests exercising reverse_search via conversation endpoint.
- **Feature**: F086 | **Found by**: Phase B Audit (Punto 4) | **Severity**: Medium | **Status**: Fixed (PR #84)

### 2026-04-08 — BUG-F090-01: Network timeout shows "Sin conexión" instead of "La consulta tardó demasiado"

- **Issue**: When the 15-second `AbortSignal.timeout(15000)` fires, the browser throws a `DOMException` with `name === 'TimeoutError'` (NOT `'AbortError'`). `apiClient.ts` only guards for `AbortError` and re-throws it; all other `DOMException` types fall through to the generic network error wrapper: `new ApiError(err.message, 'NETWORK_ERROR')`. The timeout `err.message` is `'The operation was aborted.'`. In `HablarShell.tsx`, the `NETWORK_ERROR` branch checks `err.message.includes('Sin conexión')` — this is `false` for the timeout message — so the fallback `'Sin conexión. Comprueba tu red.'` is shown. The spec (§9) requires: `"La consulta tardó demasiado. Inténtalo de nuevo."`.
- **Root Cause**: The `apiClient.ts` catch block only treats `'AbortError'` as a passthrough. `TimeoutError` is a distinct error name in the Web API spec. The `HablarShell.tsx` error mapper has no code path for timeout vs. network failure — both arrive as `NETWORK_ERROR`.
- **Solution**: Either (a) also detect `err.name === 'TimeoutError'` in `apiClient.ts` and throw `new ApiError('La consulta tardó demasiado. Inténtalo de nuevo.', 'TIMEOUT_ERROR')`, then handle `TIMEOUT_ERROR` code in `HablarShell.tsx`; or (b) check `err.name === 'TimeoutError'` in the existing `apiClient.ts` catch block and wrap with a distinct message/code. Option (a) is preferred for clarity.
- **Prevention**: When using `AbortSignal.timeout()`, always check both `'AbortError'` and `'TimeoutError'` error names — they are different per the WHATWG spec. Add a test that passes a `DOMException('...', 'TimeoutError')` to the fetch mock and asserts the correct Spanish error copy is shown.
- **Feature**: F090 | **Found by**: QA (PR #85 review) | **Severity**: Medium | **Status**: Fixed (commit 365259c)
- **Exposed by**: `packages/web/src/__tests__/lib/apiClient.edge-cases.test.ts` — "BUG: TimeoutError from AbortSignal.timeout is wrapped as NETWORK_ERROR (not re-thrown)"; `packages/web/src/__tests__/components/HablarShell.edge-cases.test.tsx` — "BUG: shows timeout-specific error copy when request times out (15s)"

### 2026-04-08 — BUG-F093-01: edge-cases.f093.test.tsx passes pre-UTM-appended URL to WaitlistCTASection (test data inconsistency — double-appended href)

- **Issue**: `packages/landing/src/__tests__/edge-cases.f093.test.tsx` line 149 declares `bottomUrl = 'https://hablar.nutrixplorer.com/hablar?utm_source=landing&utm_medium=bottom_cta'` (already contains UTM params) and passes it as `hablarUrl` to `WaitlistCTASection`. The component appends its own UTM params unconditionally: `href={`${hablarUrl}?utm_source=landing&utm_medium=bottom_cta`}`. Result: the rendered `href` is `...bottom_cta?utm_source=landing&utm_medium=bottom_cta` (double-appended, malformed URL). The test only checks `toBeInTheDocument()` (not the href value), so it silently passes.
- **Root Cause**: Inconsistent test data. The architecture spec says `page.tsx` passes the BASE URL (`https://.../hablar` without UTM params) to each component, and each component appends its own UTMs. The WaitlistCTASection tests in `sections/WaitlistCTASection.test.tsx` correctly pass the base URL and assert the full UTM-appended href — but `edge-cases.f093.test.tsx` used the fully-appended URL in the WaitlistCTASection test group.
- **Solution**: In `edge-cases.f093.test.tsx`, change `bottomUrl` to `'https://hablar.nutrixplorer.com/hablar'` (base URL, no UTM params). The existing href assertion tests in `sections/WaitlistCTASection.test.tsx` already verify the correct behavior.
- **Prevention**: When writing integration edge-case tests that pass URLs to components, always pass the SAME value `page.tsx` passes (the base URL without UTMs). Document the prop contract: `hablarUrl` is the BASE URL; UTM appending is the component's responsibility.
- **Feature**: F093 | **Found by**: QA review (edge-cases.f093.qa.test.tsx) | **Severity**: Low (test data bug, no production impact — `page.tsx` always passes base URL) | **Status**: Fixed (2026-04-09)
- **Resolution**: `edge-cases.f093.test.tsx:149` already used the base URL (no UTMs) in the committed code — the originally reported state did not persist into the merged branch. The stale QA test at `edge-cases.f093.qa.test.tsx:312` that asserted the double-append behavior as "expected" has been removed. No production code change required.
- **Exposed by**: `packages/landing/src/__tests__/edge-cases.f093.qa.test.tsx` — "REGRESSION: edge-cases.f093.test.tsx passes pre-UTM URL — exposes double-append bug" (test deleted)

### 2026-04-09 — BUG-DEV-LINT-001: Lint bankruptcy on `develop` — 20 silent errors in `packages/bot` + 2 invalid ESLint directives in `packages/landing`

**Discovered during F094 Step 4 quality gates.** Running `npm run lint` at the repo root revealed that `develop` has been shipping lint errors silently for several feature merges. Blocks F094 Step 4 and will block any future feature that relies on lint as a gate.

**Issue (two parts):**

1. **`packages/landing` — 2 ESLint directives referencing a non-existent rule (`@typescript-eslint/no-require-imports`).** ESLint 8 + `eslint-config-next@14.2.29` (the version pinned in `packages/landing/package.json`) does not register this rule. When the file contains `// eslint-disable-next-line @typescript-eslint/no-require-imports`, ESLint raises: `Definition for rule '@typescript-eslint/no-require-imports' was not found.` Location: `packages/landing/src/__tests__/edge-cases.f093.qa.test.tsx:96` and `:121`.

2. **`packages/bot` — 20 `@typescript-eslint/no-non-null-assertion` errors across 7 files** (17 in tests across 5 files, 3 in production code across 2 files — 2 errors in `menuFormatter.ts` + 1 in `reverseSearchFormatter.ts`):

| File | Lines | Category |
|------|-------|----------|
| `packages/bot/src/__tests__/apiClient.test.ts` | 217, 237, 257 | Test |
| `packages/bot/src/__tests__/commands.test.ts` | 376 | Test |
| `packages/bot/src/__tests__/f042.apiClient.edge-cases.test.ts` | 70, 77, 84, 91, 98, 105, 112, 119, 129 | Test (F042 edge cases) |
| `packages/bot/src/__tests__/f042.formatter.edge-cases.test.ts` | 172, 179 | Test (F042 edge cases) |
| `packages/bot/src/__tests__/formatters.test.ts` | 420, 432 | Test |
| **`packages/bot/src/formatters/menuFormatter.ts`** | **59, 74** | **Production (F076 — Modo Menú del Día)** |
| **`packages/bot/src/formatters/reverseSearchFormatter.ts`** | **39** | **Production (F086 — reverse search filter)** |

**Root cause — TWO independent mechanisms:**

- **Why the rule is enforced:** Root `eslint.config.mjs` has used `...tseslint.configs.strict` since F001b (commit `9f38639`, 2026-03-10). The `strict` preset includes `@typescript-eslint/no-non-null-assertion` as an error by default. This has been the project rule since day 1 of TypeScript adoption — it is not new.
- **Why the errors accumulated silently:** `.github/workflows/ci.yml` lines 183 and 217 run lint with `|| true` for the `api` and `bot` workspaces:
  ```yaml
  run: npm run lint -w @foodxplorer/api || true
  run: npm run lint -w @foodxplorer/bot || true
  ```
  The `|| true` swallows any non-zero exit, so bot and api lint failures **never break CI**. Landing and web (lines 283, 321) do NOT have `|| true` — that is why the landing error surfaced as a blocker for F094 but the bot errors didn't.
- **When the production errors were introduced:**
  - `menuFormatter.ts:59,74` — SHA `1ad5f171` (2026-04-04, F076 — "Modo Menú del Día — multi-dish meal estimation"). The `!` assertions on `i.estimation.result!.confidenceLevel` and `levels[0]!` were authored by pbojeda and merged straight through the silent CI gate.
  - `reverseSearchFormatter.ts:39` — SHA `e67164d` (2026-04-06 range, F086 — "reverse search — filter dishes by calorie/protein constraints").
- **When the test errors were introduced:** F042 (2026-03-26 range — portion-aware NL estimation), plus accumulated across earlier test files.

**Part 1 resolution (landing) — already applied on branch `feature/F094-voice-architecture-spike`:**

The two invalid `// eslint-disable-next-line @typescript-eslint/no-require-imports` directives in `edge-cases.f093.qa.test.tsx` were removed. The underlying `require('@/lib/analytics')` calls inside `jest.isolateModules(() => { ... })` do not trigger any real lint error once the invalid disable comments are gone (verified locally: `packages/landing` now lints clean). This fix is SAFE because removing directives that reference a non-existent rule cannot change runtime behavior and the require() calls are inside test scaffolding only.

**Parts 1-4 status — FIXED and merged to develop via PR #91 as squash commit `2eda357` (2026-04-09).** Parts 5 (api lint, 100 errors) and 6 (scraper lint cleanup, 27 errors including 2 NEW `no-this-alias`) remain deferred to F116. The root cause (`|| true` on api lint step in `ci.yml:195`) is also deferred to F116 because removing it before the 100 api errors are cleaned up would make CI red on the merge day.

**Part 2 status (bot) — FIXED on branch `chore/F115-bot-lint-bankruptcy` (in Phase 1+2 of F115 execution).**

- Phase 1 (production, 3 errors): `menuFormatter.ts:59` → `flatMap` with ternary; `menuFormatter.ts:74` → nullable tracking + tighten type to `ReadonlyArray<ConfidenceLevel>`; `reverseSearchFormatter.ts:39` → `for...of` with `.entries()`. All 3 are false positives from the TS `noUncheckedIndexedAccess` + `.filter` narrowing gap family. Cross-model review (Gemini + Codex) caught a sparse-array risk that the engineer's initial analysis missed; type tightening resolved it by construction.
- Phase 2 (tests, 17 errors): Pattern A (13 × `mock.calls[0]![0]`) → new helper `packages/bot/src/__tests__/helpers/mocks.ts` with `firstCallArg<T>()` function. Pattern B (2 × `String.match()` + `not.toBeNull()` + `!.length`) → `toHaveLength(1)` matcher (collapses 3 expect lines to 1). Pattern C (2 × fixture spread with `!` on nullable field) → extract with invariant guard at top of describe block.
- All 161 tests across the 5 modified test files still pass. Bot lint: 0 errors after fixes.

**Part 3 status (shared) — FIXED on the same F115 branch.**

Shared had 5 silent lint errors (not via `|| true` bypass, but via missing `Lint shared` step in `test-shared` CI job):

- `f077.alcohol.schemas.test.ts:8` — unused import `FoodNutrientSchema` → removed.
- `webMetrics.schemas.test.ts:4` — 3 unused imports (`beforeEach`, `afterEach`, `vi`) → removed.
- `webMetrics.schemas.edge-cases.test.ts:188` — `new Date().toISOString().split('T')[0]!` — same family as the Phase 1 false-positives (`noUncheckedIndexedAccess` + known-length array). Fixed by replacing the entire `.split('T')[0]!` expression with `.slice(0, 10)`, which is the idiomatic JavaScript way to extract the date portion of an ISO 8601 string and eliminates both the split and the index access.

F115 also adds a `Lint shared` step to `test-shared` in `ci.yml`, closing this silent-accumulation path.

**Part 4 status (landing) — FIXED on the same F115 branch (cherry-picked from feature/F094-voice-architecture-spike).**

The 2 invalid `@typescript-eslint/no-require-imports` eslint-disable directives in `edge-cases.f093.qa.test.tsx:96,121` are removed. See the original Part 1 description above.

**Part 5 status (api) — DEFERRED to F116.**

During F115 Phase 3 (CI workflow bypass audit), running `npm run lint -w @foodxplorer/api` (with `|| true` bypass removed locally) revealed **100 pre-existing lint errors** in the api package. This is the same silent-accumulation bug that caused Parts 2-4, but at a scale significantly beyond F115's remit:

- **91 × `@typescript-eslint/no-non-null-assertion`** (same family as bot Part 2)
- **8 × `@typescript-eslint/no-unused-vars`** (same family as shared Part 3)
- **1 × `@typescript-eslint/no-dynamic-delete`** (new pattern — `plugins/swagger.ts:34`)
- Distributed across **33 files**: 21 test files + 12 production files

Affected production files include: `plugins/swagger.ts`, `plugins/actorRateLimit.ts`, `routes/estimate.ts`, `ingest/off/offValidator.ts`, `estimation/reverseSearch.ts`, `estimation/portionSizing.ts`, `conversation/menuDetector.ts`, `conversation/conversationCore.ts`, `scripts/batch-ingest-images.ts`, `scripts/batch-ingest.ts`, `scripts/translate-dish-names.ts`, `scripts/validateSpanishDishes.ts`.

Per the rules F115 was operating under (`>5 errors → STOP and defer to F116`), this api cleanup is documented as a separate ticket. **`ci.yml:195` retains its `|| true` bypass until F116 ships** — removing it now would break CI.

F116 also absorbs three residual CI hardening items discovered during F115 Phase 3: `defaults.run.shell: bash` workflow-level default (Codex Low), `test-landing` execution context consistency with `test-web` (Gemini observation), and a `package.json` scripts audit for embedded suppression patterns (`|| true`, `--passWithNoTests`, `--silent`, `--max-warnings`, etc.) invisible to CI-level grep.

**Part 6 status (scraper) — PARTIALLY ADDRESSED in F115 (script added), cleanup DEFERRED to F116.**

`packages/scraper` had no `lint` script at all in its `package.json` — another silent-accumulation path, even deeper than shared's (shared had a script but no CI step; scraper had neither). F115 adds the script with the same pattern as bot/shared/api: `"lint": "eslint src/"`. F115 does NOT add a `Lint scraper` step to `test-scraper` in `ci.yml` — that is F116's responsibility, because running the script reveals **27 pre-existing lint errors** that must be cleaned up before CI can gate on them.

Breakdown of the 27 scraper errors:
- **12 × `@typescript-eslint/no-non-null-assertion`** (same family as bot Phase 1 + api Part 5)
- **9 × `@typescript-eslint/no-unused-vars`** (same family as shared Part 3 + api Part 5)
- **4 × `prefer-const`** (trivial: `let` → `const` on never-reassigned variables in `src/utils/normalize.ts:130-133`)
- **2 × `@typescript-eslint/no-this-alias` — NEW PATTERN not seen in bot/shared/landing**. This rule catches `const self = this;` anti-patterns. It can be a trivial mechanical fix (rewrite the containing function to use arrow syntax so `this` propagates naturally) OR a genuine capture-semantics concern depending on context. **F116 must apply the Phase-1 cross-review discipline** (Gemini + Codex second opinion) before deciding how to fix each `no-this-alias`, because this is exactly the scenario where the user-facing F115 playbook says "new pattern → stop + cross-review".

Known affected files: `src/chains/mcdonalds-es/config.ts:17,18` (2 non-null assertions), `src/utils/normalize.ts:130-133` (4 prefer-const), `src/utils/retry.ts:15` (1 unused var), `src/__tests__/persist.test.ts:303` (1 unused import), and additional files containing the remaining 19 errors.

Net effect: F115 adds the `lint` script so developers can run `npm run lint -w @foodxplorer/scraper` locally to prevent **further** accumulation during the gap between F115 and F116. CI does not gate on scraper lint until F116 ships both the cleanup and the `Lint scraper` step.

**Part 7 status (api typecheck) — FIXED on the same F115 branch as a drive-by.**

During F115 Phase 5 CI investigation (`gh run view` on recent develop pushes) the engineer discovered `test-api` had been failing on every develop push since F113 was merged. Running `npx tsc --noEmit` on `packages/api` locally reproduced the failure:

```
src/routes/webMetrics.ts(196,10): error TS2322: Type 'ScalarAggRow[][]' is not assignable to type 'ScalarAggRow[]'.
  Type 'ScalarAggRow[]' is missing the following properties from type 'ScalarAggRow': event_count, total_queries, total_successes, total_errors, and 3 more.
src/routes/webMetrics.ts(196,22): error TS2322: Type 'IntentRow[][]' is not assignable to type 'IntentRow[]'.
src/routes/webMetrics.ts(196,34): error TS2322: Type 'ErrorRow[][]' is not assignable to type 'ErrorRow[]'.
```

**Tracked as BUG-F113-01.**

**Root cause:** F113 introduced `packages/api/src/routes/webMetrics.ts` with three uses of kysely's `sql<T>` tag template where the type parameter was passed with `[]` already attached:

```typescript
sql<ScalarAggRow[]>`SELECT ... FROM web_metrics_events ...`.execute(db).then((r) => r.rows)
sql<IntentRow[]>`SELECT ... FROM web_metrics_events ...`.execute(db).then((r) => r.rows)
sql<ErrorRow[]>`SELECT ... FROM web_metrics_events ...`.execute(db).then((r) => r.rows)
```

Kysely's `sql<T>` signature means "this query returns rows of type `T`", and `.execute(db)` returns `{ rows: T[] }`. Passing `sql<Row[]>` therefore makes `r.rows` of type `Row[][]` — kysely wraps the already-arrayed type in another array. The destination variables (`let scalarRows: ScalarAggRow[]`, etc., lines 191-193) expect `T[]`, and the destructuring of `Promise.all([p1, p2, p3])` expects `[T1[], T2[], T3[]]`, so TypeScript reports three errors (one per column of the destructured tuple).

Evidence that this is a copy-paste error in F113 and NOT an intentional kysely idiom: the rest of the api package uses the **correct** pattern `sql<Row>` (singular row type, no `[]`) in at least 10 locations: `src/calculation/resolveIngredient.ts:73,119,166`, `src/estimation/level1Lookup.ts:56,130,194,255`, `src/estimation/level4Lookup.ts:195,267,312`, etc. Only `webMetrics.ts` (3 occurrences, all in the same `Promise.all` block) used the wrong pattern.

**Fix (3 edits, 2 characters each):** remove the `[]` from the three `sql<...>` type parameters in `webMetrics.ts:198,214,229`. Zero runtime impact — the SQL is unchanged, the query behavior is unchanged. Only the compile-time type of `r.rows` changes from `Row[][]` to `Row[]`, making it assignable to the destination `let scalarRows: ScalarAggRow[]` variables.

**Verification:** `npm run typecheck -w @foodxplorer/api` exits 0 after the fix.

**Status:** FIXED and merged to develop via PR #91 squash commit `2eda357` (2026-04-09). Unblocks `test-api` CI typecheck step for the first time since F113 merged on 2026-04-08. **Api tests themselves were NOT verified locally by F115** because the tests require Postgres + Redis services (not part of F115's environment). If the api test suite has ALSO been silently broken by F113 or subsequent commits, that is a separate bug to be discovered when `test-api` CI starts running green on typecheck.

**Scope rationale for the drive-by:** F115's stated goal is to end lint/CI bankruptcy. The `|| true` on the api lint CI step is retained for F116, but without this typecheck fix the `test-api` job would remain red even after F116 removes `|| true`, defeating the purpose of the removal. The fix is 3 characters deleted, zero runtime risk, and unblocks real CI. The user explicitly approved the drive-by under F115's scope with the reasoning that the alternative (leaving develop's CI permanently red) contradicts F115's purpose.

**BUG-F093-02 — F063 test mock missing `drainEventQueue`/`clearEventQueue` (FIXED in F115 as drive-by, merged to develop via PR #91 squash commit `2eda357` on 2026-04-09):**

During F115 Phase 5 `npm test` verification, `packages/landing` reported 2 test failures in `src/__tests__/edge-cases.f063.qa.test.tsx` (lines 166 and 175) with the error `TypeError: (0 , _analytics.drainEventQueue) is not a function`. Investigation showed that F093 modified `packages/landing/src/components/analytics/CookieBanner.tsx:8` to import `drainEventQueue` and `clearEventQueue` from `@/lib/analytics` and call `drainEventQueue()` in the GA script's `onLoad` handler (line 80). The F093 PR merged without updating the corresponding mock at `edge-cases.f063.qa.test.tsx:226`, which only declared `trackEvent` and `getUtmParams`. The two failing tests exercise the full CookieBanner mount path (including the mocked `next/script` calling `onLoad` immediately), so they trigger the missing function.

**Fix:** add `drainEventQueue: jest.fn()` and `clearEventQueue: jest.fn()` to the mock object in `edge-cases.f063.qa.test.tsx:226`. The full `f063.qa` suite (14 tests) and the full landing suite (738 passing + 3 todo, 58 suites) then pass cleanly.

**How did F093 merge with this failure?** See BUG-DEV-CI-001 below. Short version: develop has no branch protection, and F093's PR #89 was explicitly merged 6 seconds before the `test-landing` CI check even started running. F093 PR run `24155755046` and the post-merge develop push run `24155765049` both show `test-landing: failure`. At least three subsequent pushes (F093 `cb1b0fc`, F092 `4c1553a`, and `f142b29`) left `test-landing` red on develop without anyone noticing.

**BUG-DEV-CI-001 — CI enforcement bankruptcy on develop (discovered during F115 Phase 5 investigation):**

**Issue:** `develop` has no branch protection rules configured (`gh api repos/pbojeda/foodyxplorer/branches/develop/protection` returns `404 Branch not protected`). As a consequence, pull requests can be merged regardless of CI status, and multiple PRs have done so in recent days, leaving develop's CI in a persistent red state that no one is enforced to notice or fix. This is the root cause that allowed BUG-DEV-LINT-001 (bot/shared/api lint bankruptcy), BUG-F093-02 (landing test mock), and BUG-F113-01 (api typecheck regression) to all accumulate silently on develop.

**Evidence from `gh run list` (2026-04-08/09):**

| SHA | Title | Event | Conclusion |
|-----|-------|-------|------------|
| `f142b29` (HEAD of develop) | test(landing): remove stale BUG-F093-01 test | push | **failure** |
| `4c1553a` (F092) | F092 plate photo | push | **failure** |
| `cb1b0fc` (F093) | F093 landing+web integration | push | **failure** |
| `865ff53` (F113) | F113 backend metrics endpoint | push | **failure** |

And from `gh pr view 89 --json statusCheckRollup` for F093 specifically:

- PR mergedAt: `2026-04-08T20:00:18Z`
- `test-landing` started: `20:00:24Z` (6 seconds AFTER the merge)
- `test-landing` conclusion: `FAILURE`
- `deploy-preview` (Landing): `FAILURE`
- `deploy-preview` (Web): `FAILURE`
- `test-api`, `test-bot`, `test-shared`, `test-scraper`: `SKIPPED` (path filters did not match F093's changes)

The PR was effectively merged without waiting for CI, and when CI did run, multiple jobs failed — but by then the PR was already on develop.

**Failing jobs on develop as of 2026-04-09:**

- `test-api`: failing since F113 (`865ff53`) due to `webMetrics.ts:196` typecheck regression — **fixed in F115 Part 7 (BUG-F113-01)**.
- `test-landing`: failing since F093 (`cb1b0fc`) due to missing mock exports in `edge-cases.f063.qa.test.tsx:226` — **fixed in F115 as drive-by (BUG-F093-02)**.

After F115 merges, `test-api` and `test-landing` should both return to green on develop, PROVIDED no further regressions have landed since.

**Recommended branch protection rules (NOT configured by F115 — engineer to apply via GitHub UI):**

F115 does not configure branch protection (that is an out-of-band repo-level config change, not a code change). The following rules are recommended for `develop`:

1. **Require status checks to pass before merging** with the following required checks:
   - `test-shared` (from CI workflow)
   - `test-api` (from CI workflow)
   - `test-bot` (from CI workflow)
   - `test-scraper` (from CI workflow)
   - `test-landing` (from CI workflow)
   - `test-web` (from CI workflow)
   - `changes` (from CI workflow) — the path-filter job itself
2. **Require branches to be up to date before merging** — forces rebase against the latest develop so the CI result reflects the actual merge state.
3. **Require at least 1 pull request review** from a code owner before merge (configure CODEOWNERS as appropriate, or require self-review).
4. **Dismiss stale pull request approvals when new commits are pushed** — prevents approving an old version and merging a later version without re-review.
5. **Do not allow bypassing the above settings** (unless strictly necessary for admin emergencies). If bypass is allowed, at least enable audit logging to make bypasses visible.
6. Consider also applying the same rules to `main` if it is not already protected.

These rules are tracked as sub-item 7 of F116 (CI workflow hardening) for the engineer to apply manually; F115 only documents them here.

**BUG-DEV-CI-001 status:** partially mitigated by F115 (PR #91 squash commit `2eda357`, merged 2026-04-09). The two specific CI red jobs (`test-api` via BUG-F113-01 and `test-landing` via BUG-F093-02) are fixed. The underlying absence of branch protection is tracked in F116 sub-item 7 and requires the engineer to configure it manually in the GitHub UI. As of the F115 merge, develop's CI should return to fully green on the next push (the first time in ~3 days).

**CI trigger path hardening (bonus fix in F115):**

During F115 Phase 3 cross-model review, both Gemini and Codex independently flagged that `.github/workflows/ci.yml` did not include `eslint.config.mjs` in its trigger paths (lines 15-20 push, 23-28 PR, 63-67 root filter). This meant edits to the root ESLint config would not trigger CI at all — jobs would be skipped and show green. F115 adds `eslint.config.mjs`, `**/.eslintrc*`, `.eslintignore`, and `tsconfig*.json` (replacing the specific `tsconfig.base.json` entry) to all three locations.

The user explicitly requires human review for the 2 production errors (`menuFormatter.ts:59,74` and `reverseSearchFormatter.ts:39`) because **a non-null assertion (`!`) on a value that can actually be null or undefined would mask a real latent bug**. Silencing them with `eslint-disable-next-line` without auditing the surrounding code could hide a real crash. The 18 test errors are lower-risk but should still be addressed with judgment (often the correct fix is either `as NonNullable<...>` with rationale or a proper assertion with `expect(x).toBeDefined()` before the `!`).

**Prevention:**

1. **Remove `|| true` from CI lint steps in `.github/workflows/ci.yml` lines 183 and 217** once the existing errors are cleaned up. This is the single most important change — it restores lint as an actual quality gate. Must be done as part of F115.
2. **Add a workflow-level step** that runs `npm run lint` at the repo root (not per-workspace) and fails CI on any lint error. This catches any new workspace that forgets to wire its own lint script.
3. **When introducing a new lint rule or upgrading a lint config**, run `npm run lint` at the root and resolve all errors in the same commit, not in a follow-up.
4. **When adding a `// eslint-disable-next-line` directive**, verify the rule name exists in the installed plugins. A typo or stale rule name produces the "Definition for rule not found" error we saw in landing.

- **Feature**: Discovered during F094 Step 4 (voice architecture spike). Blocks F094 commit. | **Found by**: PM Orchestrator (pm-vs1) during lint quality gate | **Severity**: High (blocks quality gates for all features touching lint; 2 production files have potentially-real null-assertion risks) | **Status**: Part 1 FIXED on F094 branch. Part 2 DEFERRED to F115.

---

### 2026-04-11 — QA-WEB-001: Exhaustive Testing — packages/web (13 bugs)

> Found during bounded QA pass over packages/web. Source: `docs/project_notes/qa-web-001-findings.md`

#### P1 — Significant

### 2026-04-11 — BUG-QA-001: CSP script-src missing GA4 domain (P1)

- **Issue**: `next.config.mjs` CSP header has `script-src 'self' 'unsafe-inline'` but GA4 loads scripts from `https://www.googletagmanager.com`. Currently Report-Only mode so not blocking, but will break GA4 when CSP is enforced.
- **Root Cause**: GA4 domains were not included when CSP was initially configured.
- **Solution**: Add `https://www.googletagmanager.com` to `script-src` directive in `next.config.mjs`.
- **Prevention**: When adding CSP, audit all third-party script origins.
- **Status**: Open | **Found by**: QA-WEB-001 | **Evidence**: `csp.qa-web-001.test.ts`

### 2026-04-11 — BUG-QA-002: CSP connect-src missing GA4 endpoint (P1)

- **Issue**: CSP `connect-src 'self' ${apiUrl}` missing `https://www.google-analytics.com` and `https://analytics.google.com`. GA4 beacon/XHR requests generate CSP violation reports.
- **Root Cause**: Same as BUG-QA-001 — GA4 endpoints not audited during CSP setup.
- **Solution**: Add `https://www.google-analytics.com https://analytics.google.com` to `connect-src` directive.
- **Prevention**: Same as BUG-QA-001.
- **Status**: Open | **Found by**: QA-WEB-001 | **Evidence**: `csp.qa-web-001.test.ts`

### 2026-04-11 — BUG-QA-003: Route handler error format mismatch (P1)

- **Issue**: `app/api/analyze/route.ts:19` returns `{ error: 'CONFIG_ERROR' }` (string) but `apiClient.ts:136` expects `{ error: { code, message } }` (object). Client falls back to generic `'API_ERROR'` code — ops team gets no signal that API_KEY is missing.
- **Root Cause**: Route handler error response shape was not aligned with apiClient error parser expectations.
- **Solution**: Change route handler to return `{ error: { code: 'CONFIG_ERROR', message: 'API_KEY or NEXT_PUBLIC_API_URL not configured' } }`. Same for `UPSTREAM_UNAVAILABLE`.
- **Prevention**: Define error response schema in shared types; validate at both ends.
- **Status**: Open | **Found by**: QA-WEB-001 | **Evidence**: `route.qa-web-001.test.ts`

#### P2 — Minor

### 2026-04-11 — BUG-QA-004: ConfidenceBadge crashes on unexpected level (P2)

- **Issue**: `BADGE_CONFIG[level]` returns undefined for values outside `high | medium | low`. Destructuring throws TypeError, crashing the card.
- **Root Cause**: No fallback for unknown confidence levels in the lookup map.
- **Solution**: Add `const config = BADGE_CONFIG[level] ?? BADGE_CONFIG['medium']`.
- **Prevention**: Add runtime fallback for enum-like lookups.
- **Status**: Open | **Found by**: QA-WEB-001 | **Evidence**: `edge-cases.qa-web-001.test.tsx`

### 2026-04-11 — BUG-QA-006: Permissions-Policy camera=() may conflict with capture=environment (P2)

- **Issue**: `Permissions-Policy: camera=()` blocks JS camera API. `<input capture="environment">` uses the OS file picker, typically unaffected, but may be blocked on some Android browsers.
- **Root Cause**: Permissions-Policy was set to deny all camera access without considering the file input capture attribute.
- **Solution**: Verify on real Android Chrome device. If confirmed, change to `camera=(self)`.
- **Prevention**: Test Permissions-Policy interactions with HTML attributes on mobile.
- **Status**: Open (unverified) | **Found by**: QA-WEB-001

### 2026-04-11 — BUG-QA-007: ErrorState missing role="alert" (P2)

- **Issue**: The `ErrorState` component's root div has no ARIA live region. Screen readers don't announce errors when they appear dynamically.
- **Root Cause**: `role="alert"` was not added to the error container.
- **Solution**: Add `role="alert"` to the root `<div>` in `ErrorState.tsx`.
- **Prevention**: Include ARIA live region in error component templates.
- **Status**: Open | **Found by**: QA-WEB-001 | **Evidence**: `a11y.qa-web-001.test.tsx`

### 2026-04-11 — BUG-QA-008: No photo retry mechanism (P2)

- **Issue**: `handleRetry()` re-sends `lastQuery` (text only). There's no `lastPhotoFile` state, so photo errors have no retry button.
- **Root Cause**: Photo retry was not implemented — `handleRetry` only handles text queries.
- **Solution**: Store `lastPhotoFile` in a ref and re-send on retry. Or show the photo button prominently after a photo error.
- **Prevention**: When adding new input modalities, verify retry flows work for each.
- **Status**: Open | **Found by**: QA-WEB-001 | **Evidence**: `gaps.qa-web-001.test.tsx`

### 2026-04-11 — BUG-QA-009: No client-side query length pre-validation (P2)

- **Issue**: Queries > 500 chars make a full 15s server round-trip before receiving `text_too_long` inline error. No client-side `maxLength` or pre-check.
- **Root Cause**: Length validation was only implemented server-side.
- **Solution**: Add `if (text.length > 500) { setInlineError(...); return; }` at the top of `executeQuery`.
- **Prevention**: Client-side validation for known server constraints.
- **Status**: Open | **Found by**: QA-WEB-001 | **Evidence**: `gaps.qa-web-001.test.tsx`

### 2026-04-11 — BUG-QA-010: Route handler has no upstream fetch timeout (P2)

- **Issue**: `fetch(upstreamRequest)` in `route.ts` has no timeout. If upstream hangs, the serverless function waits until Vercel's function timeout (10s Hobby, 60s Pro).
- **Root Cause**: No `AbortSignal.timeout()` added to the upstream fetch.
- **Solution**: Add `signal: AbortSignal.timeout(60000)` to the upstream fetch.
- **Prevention**: Always add timeouts to outbound fetches in serverless functions.
- **Status**: Open (code-inspection finding) | **Found by**: QA-WEB-001

### 2026-04-11 — BUG-QA-011: Actor ID persisted before response body validation (P2)

- **Issue**: `persistActorId()` is called after reading the response header but before validating the response body. If body is malformed, the actor ID is still overwritten.
- **Root Cause**: Header processing and body validation are sequential; persistence happens between them.
- **Solution**: Move `persistActorId` call after successful body validation.
- **Prevention**: Process response atomically — persist side effects only after full validation.
- **Status**: Open | **Found by**: QA-WEB-001 | **Evidence**: `apiClient.qa-web-001.test.ts`

### 2026-04-11 — BUG-QA-012: Misleading comment in ResultsArea (P2)

- **Issue**: Comment says "no 'use client' needed" but the component works client-side only because its parent (`HablarShell`) is a client component.
- **Root Cause**: Comment was written based on the absence of the directive, not the runtime behavior.
- **Solution**: Clarify comment: "Renders client-side via parent boundary — no standalone server rendering."
- **Prevention**: Review 'use client' comments for accuracy.
- **Status**: Open (code-inspection finding) | **Found by**: QA-WEB-001

### 2026-04-11 — BUG-QA-013: Response type guards pass for data: null (P2)

- **Issue**: `isConversationMessageResponse` and `isMenuAnalysisResponse` check `typeof data === 'object'` but `typeof null === 'object'` in JS. So `{ success: true, data: null }` passes both guards.
- **Root Cause**: JavaScript quirk — `typeof null === 'object'`.
- **Solution**: Add `&& (value as Record<string, unknown>)['data'] !== null` to both guards.
- **Prevention**: Always check `!== null` alongside `typeof === 'object'`.
- **Status**: Open | **Found by**: QA-WEB-001 qa-engineer | **Evidence**: `apiClient.qa-web-001.test.ts`

### 2026-04-14 — BUG-PROD-007: comparison + menu paths missing prisma + originalQuery (M2)

- **Severity**: M2 (degraded UX — portionSizing and portionAssumption absent for all comparison and menu queries)
- **Area**: Conversation pipeline wiring (conversationCore → estimationOrchestrator, comparison + menu call sites)
- **Issue**: `portionSizing` (F085) and `portionAssumption` (F-UX-B) were absent for every dish in comparison (`compara X vs Y`) and menu (`menú del día: X, Y`) responses, despite working correctly on solo-dish queries after BUG-PROD-006. Example: `compara tapa de croquetas vs tapa de tortilla` returned `portionSizing: undefined` and `portionAssumption: undefined` on both dishA and dishB.
- **Root Cause (Call Site 1 — comparison path)**: Both `estimate()` calls inside the `Promise.allSettled` block at `conversationCore.ts:197-217` lacked `prisma` and `originalQuery`. The `prisma: undefined` guard in the orchestrator always prevented `resolvePortionAssumption` from executing. `originalQuery` defaulted to the F078-stripped query (e.g., `'croquetas'` instead of `'tapa de croquetas'`), preventing `detectPortionTerm` from finding the portion term.
- **Root Cause (Call Site 2 — menu path)**: The `estimate()` call inside `menuItems.map(...)` at `conversationCore.ts:264-281` had the identical missing-param shape as Call Site 1.
- **Why BUG-PROD-006 missed these paths**: BUG-PROD-006 was scoped to the solo-dish path (Step 4). The comparison and menu paths share the same `ConversationRequest` threading infrastructure introduced by BUG-PROD-006 (`prisma` is now a field on `ConversationRequest`; the route already passes it) — the threading work was done; only the two call sites needed updating.
- **Solution**: (1) Add `prisma` and `originalQuery: dishAText` / `originalQuery: dishBText` to both `estimate()` calls in the comparison `Promise.allSettled` block. `dishAText`/`dishBText` are the pre-`parseDishExpression` raw slices already destructured at line 188 — they preserve F078 serving-format prefixes. (2) Add `prisma` and `originalQuery: itemText` to the `estimate()` call inside `menuItems.map(...)`. `itemText` is the map callback parameter (raw pre-F078 string from `detectMenuQuery`). (3) Downgrade `logger.warn` → `logger.debug` at line 353 — after this fix all three call sites pass `prisma`, so the warn can never fire from legitimate code.
- **Edge case (AC8 — nullEstimateData)**: When one side of a comparison throws (e.g., unknown dish forces a mock to throw), `Promise.allSettled` captures `rejected` status → `nullEstimateData` fallback is built → `portionSizing` and `portionAssumption` are absent on that side (schema is `.optional()`, not `.nullable()`). Tests must assert `toBeUndefined()`, never `toBeNull()`. A cascade returning `result: null` (fulfilled-miss) is a DIFFERENT path — `portionSizing` is still populated from `originalQuery` via `enrichWithPortionSizing`.
- **Prevention**: ADR-021 — integration tests for conversation pipeline features MUST call `processMessage()` end-to-end and cover comparison + menu intents, not just the solo-dish path. When a new `estimate()` call site is added to `conversationCore.ts`, it MUST include `prisma` and `originalQuery` (pre-F042/F078 raw text). Bare `'X vs Y'` does NOT trigger comparison intent — `extractComparisonQuery` requires one of `PREFIX_PATTERNS_COMP` (`compara[r]`, `qué tiene más/menos X`, etc.). Menu tests must use the `'menú del día: X, Y'` colon+comma form for clean `splitMenuItems` slices.
- **Tests**: `describe('BUG-PROD-007 — comparison path')` and `describe('BUG-PROD-007 — menu path')` in `f085.conversationCore.integration.test.ts` and `f-ux-b.conversationCore.integration.test.ts`. Scope ampliado: AC9/AC10/AC11 solo-path regression guards (pintxo/pincho canonical, media ración grande accepted behavior) + AC12 `cacheSet` spy for `portionKeySuffix` regression guard.
- **Status**: Fixed | **Branch**: bugfix/BUG-PROD-007-comparison-menu-wiring

### 2026-04-13 — BUG-PROD-006: F085 + F-UX-B not populated via /conversation/message (M1)

- **Severity**: M1 (production blocker — portionSizing and portionAssumption always null on primary user path)
- **Area**: Conversation pipeline wiring (conversationCore → estimationOrchestrator)
- **Issue**: `portionSizing` (F085) and `portionAssumption` (F-UX-B) were null for all canonical Spanish portion terms (tapa, pincho, pintxo, ración, media ración) when queried via `POST /conversation/message` → `/hablar` web and Telegram bot. F-UX-B was merged as done (PR #113) but was effectively non-functional.
- **Root Cause (Bug 1 — primary)**: `prisma` was never added to `ConversationRequest` and never passed from the conversation route to `processMessage()`. The orchestrator's `if (prisma !== undefined)` guard was always false → `resolvePortionAssumption` never executed.
- **Root Cause (Bug 2 — secondary)**: F085 (`enrichWithPortionSizing`) and F-UX-B (`detectPortionTerm`) were called with the F078-stripped query ('croquetas') instead of the original user text ('tapa de croquetas'). Portion terms were stripped BEFORE detection.
- **Solution**: (1) Add `prisma?: PrismaClient` to `ConversationRequest`; pass `prisma` from both `processMessage()` calls in `routes/conversation.ts`. (2) Add `originalQuery?: string` to `EstimateParams`; pass `originalQuery: trimmed` (pre-F042/F078) from `conversationCore.ts`; use `portionDetectionQuery = originalQuery ?? query` in orchestrator for F085/F-UX-B calls. (3) Update cache key to include `normalizedPortionQuery` when different from `normalizedQuery` to prevent cache collisions.
- **Prevention**: ADR-021 — integration tests for conversation pipeline features MUST call `processMessage()` end-to-end, not just the resolver functions directly. Tests: `f-ux-b.conversationCore.integration.test.ts`, `f085.conversationCore.integration.test.ts`.
- **Commit**: 2225818
- **Status**: Fixed | **Branch**: bug/BUG-PROD-006-f085-fux-b-conversation-wiring
