# F116-lite: CI Hardening Minimal — remove api lint suppression + wire scraper lint + document branch protection

**Feature:** F116-lite | **Type:** Backend-Refactor | **Priority:** High
**Status:** Spec | **Branch:** feature/F116-lite-ci-hardening
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-05-11 | **Dependencies:** F115 (done, PR #91 `2eda357`)

---

## Spec

### Description

Reduced-scope follow-up to F115 (lint bankruptcy cleanup) addressing three concrete CI hygiene gaps that block reliable beta-period merges. F116 in the tracker originally enumerates 7 sub-items; this lite ticket ships only sub-items (a), (b), and (g)/(7). The other 4 sub-items are explicitly DEFERRED to a future F116 follow-up.

**Why now:** the PM session `pm-hardening` (Batch 1 of the post-2026-05-08 roadmap) requires `develop` to enforce CI before opening beta to real users. Without branch protection an out-of-tree merge could silently land a broken commit — the exact failure pattern that produced BUG-DEV-LINT-001 / BUG-F093-02 / BUG-F113-01 in April. With api lint already passing locally (empirical baseline 2026-05-11, `npm run lint -w @foodxplorer/api` exits 0), the `|| true` suppression on `ci.yml:182` is now historical residue and removing it carries no extra cost; the scraper lint script also exists already (`packages/scraper/package.json` line 10) but is not invoked by any CI job. Closing these two gaps and documenting the branch protection rules so the user can apply them in the GitHub UI is high ROI and zero risk.

### API Changes

None.

### Data Model Changes

None.

### UI Changes

None.

### CI Changes (workflow)

- `.github/workflows/ci.yml` line 182: change `run: npm run lint -w @foodxplorer/api || true` → `run: npm run lint -w @foodxplorer/api`.
- `.github/workflows/ci.yml` `test-scraper` job: add a `Lint scraper` step between `Typecheck scraper` and `Test scraper`, running `npm run lint -w @foodxplorer/scraper`. Path filters already cover scraper changes (`needs.changes.outputs.scraper`); no filter edits needed.

### Documentation Changes

- New file `docs/operations/branch-protection-checklist.md`: audit + tightening guide for the EXISTING GitHub configuration on `develop` and `main`. Important distinction (per empirical discovery during BUG-PROD-004-FU1, `product-tracker.md:119`): this repo uses **GitHub Repository Rulesets** (Settings → Rules → Rulesets), NOT legacy Branch Protection (Settings → Branches). The legacy API returns 404 for `develop` but rulesets already enforce `ci-success` required check + PR-only (GH013 on direct push). The doc must explicitly cover:
   1. **Inventory step**: how to view existing rulesets via UI (Settings → Rules → Rulesets) and via CLI (`gh api repos/{owner}/{repo}/rulesets`).
   2. **Mandatory configuration (current state, verify):**
      - Required status check: **only** `ci-success` (NOT individual `test-*` jobs). Rationale: `ci-success` is the rollup that handles pass-or-skipped semantics across path-filtered jobs (see `.github/workflows/ci.yml:329` comment "the ONLY required check in branch protection"). Requiring `test-shared`/`test-api`/etc. directly would block merges of docs-only PRs because path filters skip those jobs.
      - Restrict pushes (PR-only).
      - Block force pushes.
   3. **Recommended tightening (optional but encouraged for beta period, document each with rationale):**
      - Require ≥1 pull request review.
      - Dismiss stale reviews on new commits.
      - Require linear history (squash policy alignment).
      - Block bypass for repository admins (or enable audit log if bypass kept).
      - Apply same rules to `main`.
   4. **Why NOT to add individual `test-*` jobs as required checks** — explicit warning with citation to `ci.yml:329` comment, so a future engineer doesn't "fix" the doc by enumerating them.
   5. **Operator action checklist**: numbered steps for the user to apply (a) inventory current state, (b) confirm the mandatory items are set, (c) decide on recommended items, (d) apply, (e) record the resulting ruleset ID/name in `key_facts.md` for future reference.
- `docs/project_notes/bugs.md` → BUG-DEV-CI-001: append a `**Status update 2026-05-11 (F116-lite):**` paragraph noting (a) the audit-and-tighten doc deliverable shipped (correcting the prior misconception that protection didn't exist), (b) state transition `partially mitigated` → `mitigated (docs + audit)`, (c) operator action pending for any tightening decisions the user adopts.
- `docs/project_notes/product-tracker.md` → F116 row: mark sub-items (1)/(a) [api lint — verified already clean, suppression removed], (2-half)/(b-scraper-CI-step) [scraper lint CI step], and (7)/(g) [branch protection **audit + doc**, scope already reinterpreted in `product-tracker.md:119`] as DONE. Sub-items (2-full)/(b)/(no-this-alias-cleanup), (3), (4), (5), (6) DEFERRED with brief rationale next to each. Tracker still tracks F116 as `pending` overall (rolling) because the deferred sub-items remain open.

### Edge Cases & Error Handling

- **Scraper lint produces unexpected warnings on first CI run.** Mitigation: a local `npm run lint -w @foodxplorer/scraper` baseline check during implementation (Step 3) before the PR; if non-zero exit, abort and reclassify F116-lite (this can happen if scraper has lint warnings that haven't been surfaced because the script was never wired). Empirical baseline 2026-05-11 from `npm run lint` root (which iterates workspaces) exited 0 including scraper — so risk is low.
- **CI path filters cause `Lint scraper` to be skipped on PRs that only touch shared.** Acceptable: scraper depends on shared but the lint step already runs on shared changes via the `scraper == 'true' || shared == 'true'` job-level conditional (verified `ci.yml:225-231`). No filter edits needed.
- **Branch protection blocks the F116-lite PR itself.** Not yet — protection is documentation only in this ticket. User applies it post-merge.
- **Branch protection enabled mid-Batch 1.** If the user applies protection between F116-lite merge and F030-lite PR, the F030-lite PR will require the new status checks. Documented in the checklist as expected behavior. No code change needed.
- **GitHub UI changes the status-check names.** The checklist lists the literal job names from `ci.yml`; if a job is renamed later, the checklist must be updated. Acceptable maintenance cost.

### Out of scope (explicit DEFERRED, will be addressed in a future F116 follow-up ticket)

1. **Scraper `no-this-alias` cleanup** — 2 errors flagged in F116 tracker entry; requires cross-model review per F115 discipline to distinguish trivial arrow-function fix from capture-semantics concern. **NOT in F116-lite.** Will be addressed in F116-FU1 once volume of CI noise warrants it. Baseline 2026-05-11 confirms scraper lint exits 0 locally, so these errors are either already fixed or were suppressed by the historical `eslint-disable`.
2. **`defaults.run.shell: bash` workflow-level hardening** — non-blocking, deferred.
3. **`test-landing` execution context refactor** (use `npm ci` + `-w` root instead of `cd packages/landing && npm ci`) — non-blocking, empirically works, deferred.
4. **`package.json` scripts suppression audit** (`|| true`, `--passWithNoTests`, etc.) — wide-scope grep + manual review; deferred.
5. **API tests local verification post-F115** — empirical baseline 2026-05-11 already confirms `npm test` exits 0 across monorepo (8,228 tests passing per pm-conv-polish merge artifacts), so this sub-item is implicitly satisfied; if a future regression is found, a dedicated bug ticket handles it.

---

## Implementation Plan

> Plan authored inline (CI-only + docs, no production code to plan with a planner agent). Self-review notes + cross-model review tracked in Completion Log.

### Phase 0 — Pre-flight verification (no commits yet)

P0.1. **Confirm baseline lint clean** (already done in pm-session.md baseline, re-verify on feature branch):
- `npm run lint -w @foodxplorer/api` → expect exit 0.
- `npm run lint -w @foodxplorer/scraper` → expect exit 0.
- `npm run lint` (root) → expect exit 0.

P0.2. **Confirm empirical state of GitHub protection** via `gh api`:
- `gh api repos/pbojeda/foodyxplorer/rulesets` → record the response (ID + name + target branches).
- For each ruleset, `gh api repos/pbojeda/foodyxplorer/rulesets/{id}` → record rules (status check requirement, restrictions).
- Verified at spec-review time 2026-05-11: develop ruleset id `14883955` exists active; main has NO ruleset.

P0.3. **Locate exact ci.yml lines** (line numbers may shift if file is edited elsewhere first):
- Find `npm run lint -w @foodxplorer/api || true` in `.github/workflows/ci.yml` (currently line 182).
- Find `Typecheck scraper` and `Test scraper` blocks in `test-scraper` job (currently lines 249 and 252-253).

### Phase 1 — CI yaml edits

P1.1. **Edit `.github/workflows/ci.yml`**:
- (a) Remove `|| true` from the api Lint step. After edit, the step is exactly: `run: npm run lint -w @foodxplorer/api`.
- (b) Insert a new step in `test-scraper` job between `Typecheck scraper` and `Test scraper`:
  ```yaml
        - name: Lint scraper
          run: npm run lint -w @foodxplorer/scraper
  ```
  Indentation matches surrounding steps (6 spaces for `-`, 8 for `run`).

P1.2. **Local validation**: run `npm run lint -w @foodxplorer/api` and `npm run lint -w @foodxplorer/scraper` both exit 0 after the edit (no test command runs — CI yaml itself does).

P1.3. _Removed (Codex review R1 SUGGESTION): generic `python yaml.safe_load` does not validate GitHub Actions semantics. The yaml will be exercised on the first CI run after PR push — that is the authoritative validation._

### Phase 2 — Docs deliverable

P2.1. **Create `docs/operations/branch-protection-checklist.md`** (creates the parent directory if it does not exist as a side-effect of `Write`; no separate mkdir step). The doc MUST include in this order:

- Title + one-line summary + last-updated date.
- (a) Intro + history (BUG-DEV-CI-001 + reference to `product-tracker.md:119` + the rulesets-vs-branch-protection distinction).
- (b) Inventory step (UI path Settings → Rules → Rulesets + `gh api repos/{owner}/{repo}/rulesets` CLI snippet).
- (c) **Mandatory configuration — verbatim required**: "the ONLY required status check is **`ci-success`** (NOT individual `test-*` jobs). Source: `.github/workflows/ci.yml:329` (`ci-success` rollup job comment: 'the ONLY required check in branch protection'). Rationale: `ci-success` passes when all jobs pass OR were skipped (docs-only PRs), so requiring individual `test-*` jobs would block legitimate docs-only PRs that path-filter-skip those jobs." Also state: restrict pushes (PR-only), block force pushes.
- (d) Recommended tightening (each marked "optional, encouraged for beta period", with a one-line rationale): require ≥1 review, dismiss stale reviews on new commits, require linear history, block admin bypass, apply same rules to `main`.
- (e) Operator action checklist (numbered steps: inventory → confirm mandatory → decide recommended → apply → record resulting ruleset ID in `key_facts.md` if helpful).
- Empirical state footer @ 2026-05-11: "develop has ruleset id `14883955` active; main has no ruleset (gap — must create equivalent ruleset on main as part of operator action)".

P2.2. **Self-review the doc**: re-read with a "future engineer who hasn't seen this" lens. Confirm UI path matches current GitHub UI (Settings → Rules → Rulesets → New ruleset / Edit existing). Confirm the warning against listing individual `test-*` jobs is unmissable (bolded callout near top of mandatory section).

P2.3. **Self-review the doc**: re-read with a "future engineer who hasn't seen this" lens. Confirm UI paths match current GitHub UI (Settings → Rules → Rulesets → New ruleset / Edit existing). Confirm the warning against listing individual `test-*` jobs is unmissable.

### Phase 3 — Cross-cutting docs updates

P3.1. **Update `docs/project_notes/bugs.md` → BUG-DEV-CI-001** entry:
- Append a `**Status update 2026-05-11 (F116-lite):**` paragraph (3-5 sentences) noting (a) audit-and-tighten doc shipped at `docs/operations/branch-protection-checklist.md`, (b) empirical verification: develop ruleset 14883955 active, main unprotected (gap), (c) state transition `partially mitigated` → `mitigated (docs + audit)`, (d) operator action pending for any tightening the user adopts and for main ruleset creation.

P3.2. **Update `docs/project_notes/product-tracker.md` → F116 row Notes column**:
- Add a `**F116-lite (2026-05-11)**: ` section listing 3 DONE sub-items with PR reference (TBD until PR open).
- For each of the 5 remaining sub-items (2 no-this-alias, 3 shell hardening, 4 test-landing refactor, 5 scripts audit, 6 api tests verification), add a one-line `DEFERRED: <rationale>`.
- Leave overall F116 status as `pending` (rolling) since deferred items remain.

P3.3. _Removed (Codex review R1 IMPORTANT): updating `key_facts.md` is outside locked ticket scope. The rulesets-vs-branch-protection distinction lives in the new doc itself; cross-linking from key_facts.md can be a separate follow-up if the user finds it valuable._

### Phase 4 — Quality gates + commit

P4.1. **Run quality gates** in targeted order (Codex R1 SUGGESTION — narrow first, broader only if needed):
- (a) Targeted: `npm run lint -w @foodxplorer/api` and `npm run lint -w @foodxplorer/scraper` → both exit 0. This proves AC1+AC2 yaml edits did not break the affected workspaces.
- (b) Project standard: `npm run lint` (root, full workspaces) → exit 0. Required by project workflow Step 4 for all features.
- (c) `npm run build` → exit 0. No source changes, expected fast.
- (d) `npm test` → exit 0 (~8.228 tests, all green per baseline). If any unrelated test starts failing on the side, STOP and treat as pre-existing baseline break (file a separate bug, do not bundle into F116-lite).

P4.2. **Run `production-code-validator` agent** via Task tool. Note: this ticket has no production code; the validator's role is to confirm no production code changed and the docs accurately reflect the CI yaml.

P4.3. **Commit** with messages following project convention. Suggested single commit (small ticket, no need to split):
- Subject: `chore(ci): remove api lint suppression + wire scraper lint + document branch protection (F116-lite)`
- Body: short bullet list of the 3 in-scope items + reference to deferred items.

### Phase 5 — Review (PR + agents)

P5.1. **Open PR** against `develop` with `gh pr create` using project template (`references/pr-template.md`). Title: `chore(ci): F116-lite — minimal CI hardening`. Body: link to ticket, 3 in-scope items, deferred list, manual operator action checklist (apply protection rules per the doc).

P5.2. **Run `code-review-specialist` agent** via Task tool. Address findings inline before merge.

P5.3. **Run `qa-engineer` agent** via Task tool. For a CI-only ticket the QA scope is "verify the doc is accurate" + "verify yaml is valid" + "verify no acceptance criterion is dropped".

P5.4. **Fix loop**: re-run `npm run lint` / `npm test` / `npm run build` after any fix. Repeat until clean.

P5.5. **Merge checklist evidence**: fill the Merge Checklist Evidence table in the ticket per `references/merge-checklist.md`.

P5.6. **CI must be green** on the PR. The new `Lint scraper` step running for the first time is a small risk — if it fails, the empirical baseline assumption (`npm run lint -w @foodxplorer/scraper` exits 0 locally) is wrong on CI runner; mitigation is to investigate the diff between local and CI (Node version, eslint plugins) before merging.

P5.7. **Squash merge** to develop. Delete feature branch local + remote.

### Phase 6 — Housekeeping

P6.1. Update ticket Status to `Done`, fill all checkboxes, record commit SHA + PR URL.
P6.2. Update tracker Active Session to mark F116-lite DONE, move to F030-lite (next feature in pm-hardening batch).
P6.3. Update `pm-session.md` Completed Features table.
P6.4. Return control to PM Orchestrator → start F030-lite.

### Files touched (final list)

- `.github/workflows/ci.yml` (2 edits: line ~182 remove suppression; test-scraper add Lint step)
- `docs/operations/branch-protection-checklist.md` (new file)
- `docs/project_notes/bugs.md` (append status update to BUG-DEV-CI-001)
- `docs/project_notes/product-tracker.md` (F116 row Notes update + Active Session sync)
- `docs/tickets/F116-lite-ci-hardening.md` (this ticket — final state)

> Note: `key_facts.md` is NOT in this list (removed in plan revision R1 — out of locked scope).

### Risk and rollback

- **Risk:** new `Lint scraper` step fails on CI runner despite passing locally. **Mitigation:** if CI fails on first PR push, fix the scraper lint config (likely env-specific, e.g., Node version mismatch) before merge. The change is purely additive — if rollback needed, revert the scraper step.
- **Risk:** removing `|| true` exposes a latent lint error that didn't show in local baseline. **Mitigation:** if so, fix the underlying error (sub-item 1 of F116 from the original tracker — this is the original intent of the cleanup).
- **Rollback path:** single commit revert via `git revert <sha>` on develop, then re-open the ticket. No data loss; no infra change.

---

## Acceptance Criteria

- [ ] **AC1**: `.github/workflows/ci.yml` line 182 contains `run: npm run lint -w @foodxplorer/api` (no `|| true`).
- [ ] **AC2**: `test-scraper` job in `.github/workflows/ci.yml` contains a `Lint scraper` step running `npm run lint -w @foodxplorer/scraper`, placed between `Typecheck scraper` and `Test scraper`.
- [ ] **AC3**: New file `docs/operations/branch-protection-checklist.md` exists with (sections listed in spec):
  - (a) Intro explaining BUG-DEV-CI-001 history AND the rulesets-vs-classic-branch-protection distinction (citing `product-tracker.md:119` empirical evidence).
  - (b) Inventory step (UI path Settings → Rules → Rulesets, plus `gh api repos/{owner}/{repo}/rulesets` CLI snippet).
  - (c) **Mandatory configuration**: required status check = **only** `ci-success` (citing `.github/workflows/ci.yml:329` rationale), restrict pushes (PR-only), block force pushes. With explicit warning against listing individual `test-*` jobs.
  - (d) **Recommended tightening** (clearly marked optional, each with one-line rationale): ≥1 review, dismiss stale, linear history, block admin bypass, apply same rules to `main`.
  - (e) Operator action checklist with numbered steps (inventory → confirm mandatory → decide recommended → apply → record ruleset ID in `key_facts.md`).
- [ ] **AC4**: CI on the feature PR runs `test-api` (now without `|| true`) and `test-scraper` (now with Lint scraper step) and both report success.
- [ ] **AC5**: `docs/project_notes/bugs.md` BUG-DEV-CI-001 entry has a `**Status update 2026-05-11 (F116-lite):**` paragraph appended noting that the documentation deliverable shipped and the manual UI configuration remains pending the engineer.
- [ ] **AC6**: `docs/project_notes/product-tracker.md` F116 row has its Notes column updated to: (a) list 3 sub-items DONE with their F116-lite reference, (b) list remaining sub-items DEFERRED with one-line rationale per item, (c) overall status remains `pending` until a future F116-FU ticket closes the deferred items.
- [ ] Lint passes on all workspaces after edits (`npm run lint` exits 0).
- [ ] Build passes (`npm run build` exits 0).
- [ ] Existing test suite passes (`npm test` exits 0, no regression vs baseline 8,228 tests).
- [ ] Specs updated: no api-spec / ui-components / Zod changes (this ticket is CI-only).

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] No new tests required (no production code changed)
- [ ] Existing tests still green
- [ ] Code follows project standards (CI yaml indentation matches surrounding style)
- [ ] No linting errors anywhere
- [ ] Build succeeds
- [ ] Docs reflect final implementation
- [ ] Cross-model review (`/review-spec` ≥ 1 round, `/review-plan` ≥ 1 round) APPROVED

---

## Workflow Checklist

- [ ] Step 0: Spec authored + cross-model review APPROVED
- [ ] Step 1: Branch created, ticket generated, tracker updated
- [ ] Step 2: Plan authored + cross-model review APPROVED
- [ ] Step 3: Implementation complete (CI yaml edits + new doc + bugs.md / tracker updates)
- [ ] Step 4: Quality gates pass (`npm test`, `npm run lint`, `npm run build`), `production-code-validator` executed
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 5: `qa-engineer` executed
- [ ] Step 6: Ticket updated with final metrics, branch deleted, tracker housekeeping done

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-05-11 | Ticket created | F116-lite scope: 3 of 7 F116 sub-items (api `\|\| true` removal, scraper Lint CI step, branch-protection doc) |
| 2026-05-11 | Spec review R1 | Gemini APPROVED (1 IMPORTANT — invalid, lint already wired for shared/bot/landing/web at ci.yml:90/216/282/320; scraper is the only gap). Codex REVISE (2 IMPORTANT + 1 SUGGESTION — all valid, addressed inline): (i) AC3 required-checks list contradicted `ci.yml:329` rationale that `ci-success` is the ONLY required check; (ii) doc framing assumed no existing protection — project memory at `product-tracker.md:119` shows rulesets already enforce `ci-success` + PR-only, so deliverable reframed as **audit + tighten**; (iii) mandatory-vs-optional distinction now explicit in spec. |
| 2026-05-11 | Plan review R1 | Gemini APPROVED. Codex REVISE (2 IMPORTANT + 3 SUGGESTION — all addressed inline): (i) P2.2 vague on `ci-success` citation → P2.1 now spells out verbatim required text + cites `ci.yml:329`; (ii) P3.3 key_facts.md update is scope creep → removed; (iii) P4.1 broad gates risk false-positive failures → reordered to targeted-first; (iv) P1.3 generic yaml check no value → removed; (v) P2.1 mkdir is noise → folded into Write step. |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | Sections verified: (list) |
| 1. Mark all items | [ ] | AC: _/_, DoD: _/_, Workflow: _/_ |
| 2. Verify product tracker | [ ] | Active Session: step _/6, Features table: _/6 |
| 3. Update key_facts.md | [ ] | Updated: (list) / N/A |
| 4. Update decisions.md | [ ] | ADR-XXX added / N/A |
| 5. Commit documentation | [ ] | Commit: (hash) |
| 6. Verify clean working tree | [ ] | `git status`: clean |
| 7. Verify branch up to date | [ ] | merge-base: up to date / merged origin/<branch> |

---

*Ticket created: 2026-05-11*
