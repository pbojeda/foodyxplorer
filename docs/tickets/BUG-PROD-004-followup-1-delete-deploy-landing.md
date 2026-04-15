# BUG-PROD-004-FU1: Delete redundant deploy-landing.yml workflow

**Feature:** BUG-PROD-004-FU1 | **Type:** Infra-Bugfix | **Priority:** Low
**Status:** Done | **Branch:** bugfix/BUG-PROD-004-followup-1-delete-deploy-landing (deleted)
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-04-15 | **Dependencies:** BUG-PROD-004 (PR #111, merged)

---

## Spec

### Description

Delete `.github/workflows/deploy-landing.yml`. It is a custom Vercel deploy workflow (`vercel pull` / `vercel build` / `vercel deploy` on the GitHub Actions runner) that duplicates the Vercel GitHub App native integration already wired to the `packages/landing` project. Same structural issue fixed for the web package in BUG-PROD-004 (PR #111, `88952d9`): the custom workflow is redundant noise, the Vercel GitHub App handles preview-on-PR and production-on-push natively with build cache and PR comments.

Rationale: carrying two parallel deploy mechanisms is the exact anti-pattern called out in `bugs.md` BUG-PROD-004 prevention notes ("if the project is already connected to the Vercel GitHub App, do **not** add a parallel `vercel build` + `vercel deploy` step in GitHub Actions"). Removing it eliminates a potential source of future CI noise and aligns landing with web.

### API Changes (if applicable)

N/A.

### Data Model Changes (if applicable)

N/A.

### UI Changes (if applicable)

N/A.

### Edge Cases & Error Handling

- Vercel GitHub App must remain connected to the `landing` project — verified indirectly by the existence of Vercel preview comments on recent landing PRs and by the user's direct dashboard observation during BUG-PROD-004.
- The `nutrixplorer.com` production domain is currently served by Vercel; deletion of the workflow does not touch DNS or project settings.

---

## Implementation Plan

N/A — Simple task (single-file deletion, no code changes, no tests affected).

---

## Acceptance Criteria

- [x] `.github/workflows/deploy-landing.yml` removed from the repo
- [x] No references to `deploy-landing` workflow remain in other CI files, scripts, or live docs (`key_facts.md` updated inline; remaining references are historical in `bugs.md`, context prompts, and BUG-PROD-004 ticket — all correct)
- [x] PR CI (`ci-success`) stays green post-deletion — verified on PR #123 (see Merge Checklist Evidence row 9)
- [x] Vercel GitHub App `Vercel` / `Vercel Preview Comments` checks still post on the PR — empirically verified on PR #123: `Vercel Preview Comments` = `pass`, `Vercel` deploy firing (`Vercel is deploying your app`). The custom workflow is gone AND the GH App is still handling landing natively.

---

## Definition of Done

- [x] File deleted
- [x] Grep for `deploy-landing` returns only expected references (bugs.md history, this ticket, tracker entries, context prompts)
- [x] `key_facts.md` Infrastructure + Hosting (Landing) sections updated inline (no stale references)
- [x] `git status` clean after commit
- [x] PR opened (#123) targeting `develop`
- [x] Merge Checklist Evidence filled (8/8)

**Post-merge (Step 6) actions — tracked in Completion Log, not DoD:**

- squash-merge to `develop` (pending user approval)
- delete branch local + remote
- update `bugs.md` BUG-PROD-004 entry → Follow-up 1 DONE with PR link
- update tracker Active Session → step `6/6 Done` → clear

---

## Workflow Checklist

<!-- Simple tier: only Steps 1, 3, 4, 5, 6 -->

- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 3: Workflow file deleted + `key_facts.md` stale reference updated inline
- [x] Step 4: Quality gates — no code affected (zero `.ts`/`.tsx`/`.js` diff); local `npm test/lint/build` skipped as non-informative for a pure workflow-file deletion; PR CI is the real oracle
- [x] Step 5: PR #123 opened, `code-review-specialist` skipped (Simple tier, infra-only, no code paths)
- [x] Step 6: Ticket updated with final state, branch deleted (local + remote), `bugs.md` BUG-PROD-004 Follow-up 1 marked DONE with PR #123 + merge commit `2f021c1`, tracker Active Session cleared

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-15 | Ticket created | Simple tier, BUG-PROD-004 follow-up 1 |
| 2026-04-15 | Branch created | `bugfix/BUG-PROD-004-followup-1-delete-deploy-landing` from `develop` |
| 2026-04-15 | File deleted | `git rm .github/workflows/deploy-landing.yml` |
| 2026-04-15 | key_facts.md updated | Infrastructure + Hosting (Landing) entries no longer reference the custom workflow |
| 2026-04-15 | tracker updated | Active Session → BUG-PROD-004-FU1 step `1/6` |
| 2026-04-15 | Commit `1918b5a` | `chore(BUG-PROD-004-FU1): delete redundant deploy-landing.yml workflow` — 4 files changed, 107 insertions, 108 deletions |
| 2026-04-15 | Branch pushed | `origin/bugfix/BUG-PROD-004-followup-1-delete-deploy-landing` |
| 2026-04-15 | PR #123 opened | Target: `develop`. Vercel GH App checks firing on PR (pass + pending). |
| 2026-04-15 | Step 5 checklist | Actions 0-8 executed. Branch up-to-date with `origin/develop`. Ready for `/audit-merge`. |
| 2026-04-15 | Commit `e808459` | `docs(BUG-PROD-004-FU1): restructure DoD — move post-merge actions to Step 6 block` (audit-merge check #3 fix) |
| 2026-04-15 | Self-review | Verified `ci.yml` has zero `deploy-landing` references. Initial check against legacy branch protection (`gh api repos/.../branches/develop/protection`) returned 404, but that only queries the legacy API — `develop` is actually protected via GitHub **rulesets** (newer mechanism), confirmed empirically when a later direct push was rejected with `GH013: Required status check "ci-success" is expected. Changes must be made through a pull request.` User chose direct squash-merge on the feature PR without external audit (Simple tier, infra-only). |
| 2026-04-15 | `/audit-merge` | 11/11 PASS. All compliance checks clean. |
| 2026-04-15 | CI green | 10/10 checks: `ci-success` pass, `test-api` 4m9s, `test-bot` 1m26s, `test-landing` 1m17s, `test-scraper` 1m12s, `test-shared` 1m17s, `test-web` 1m47s, `Vercel` pass, `Vercel Preview Comments` pass, `changes` 7s. |
| 2026-04-15 | Squash-merged | PR #123 → `develop` at merge commit `2f021c1` (3 commits squashed into 1). Branch deleted local + remote via `--delete-branch`. |
| 2026-04-15 | Step 6 housekeeping | Ticket Status → `Done`, `bugs.md` BUG-PROD-004 Follow-up 1 → DONE, tracker Active Session cleared |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Implementation Plan (N/A Simple), Acceptance Criteria, Definition of Done, Workflow Checklist, Completion Log, Merge Checklist Evidence. |
| 1. Mark all items | [x] | AC: 4/4, DoD: 6/6 (post-merge actions moved out of DoD into a separate Step 6 block), Workflow: 4/5 (Step 6 post-merge). Status → `Ready for Merge`. |
| 2. Verify product tracker | [x] | Active Session updated to `5/6 (Review)` with PR #123 + commit `1918b5a`. No Features table row (Simple follow-up tracked in Active Session only). |
| 3. Update key_facts.md | [x] | Infrastructure section: removed `deploy-landing.yml` from CI/CD list, updated prose to note BOTH web AND landing are now handled by Vercel GH App. Hosting (Landing) section: removed "+ custom deploy-landing.yml workflow pending cleanup" clause. Committed inline in `1918b5a`. |
| 4. Update decisions.md | [x] | N/A — Simple tier, no ADR required. |
| 5. Commit documentation | [x] | Commit `1918b5a` (workflow deletion + key_facts.md + tracker + ticket creation). Subsequent ticket/tracker updates at step 5/6 will be in a second docs-only commit before requesting merge. |
| 6. Verify clean working tree | [x] | `git status` clean after commit `1918b5a`. Only untracked file: `.claude/scheduled_tasks.lock` (runtime artifact, intentionally not tracked — see `.gitignore` / pre-existing untracked pattern). |
| 7. Verify branch up to date | [x] | `git fetch origin develop --quiet && git merge-base --is-ancestor origin/develop HEAD` → exit 0 (UP_TO_DATE). No divergence from `develop` (HEAD of develop is `dae4968`, contained in this branch). |

---

*Ticket created: 2026-04-15*
