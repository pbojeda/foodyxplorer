# BUG-PROD-004-FU1-REVERT: Restore deploy-landing.yml (revert BUG-PROD-004-FU1)

**Feature:** BUG-PROD-004-FU1-REVERT | **Type:** Infra-Hotfix | **Priority:** P1
**Status:** Done | **Branch:** bugfix/BUG-PROD-004-FU1-REVERT-restore-deploy-landing (deleted)
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-04-15 | **Dependencies:** BUG-PROD-004-FU1 (PR #123, merged at `2f021c1` — being reverted by this ticket)

---

## Spec

### Description

Restore `.github/workflows/deploy-landing.yml` byte-identically from commit `0490dfc` (parent of the BUG-PROD-004-FU1 deletion commit). The BUG-PROD-004-FU1 deletion (PR #123) was based on an incorrect pattern match with BUG-PROD-004's `deploy-web.yml` deletion. Unlike `foodyassistance` (the web Vercel project, which has the Vercel GitHub App connected and handles its own preview + production deploys natively), `nutrixplorer` (the landing Vercel project) is NOT connected to the Vercel GitHub App. The custom `deploy-landing.yml` workflow was the **sole** production deploy mechanism for `nutrixplorer.com`. Deleting it introduced a silent P1 deploy regression that would have manifested on the next push to `main` touching `packages/landing/**`.

The deletion does NOT become safe until the Vercel GitHub App is connected to the `pbojedas-projects/nutrixplorer` project (user action in Vercel dashboard). Until then, this workflow must remain in place.

Full post-mortem: `docs/project_notes/bugs.md` → `2026-04-15 — BUG-PROD-004-FU1-REVERT` entry.

### API Changes (if applicable)

N/A.

### Data Model Changes (if applicable)

N/A.

### UI Changes (if applicable)

N/A.

### Edge Cases & Error Handling

- **Revert must be byte-identical**: restoring a modified version of the workflow risks reintroducing the BUG-PROD-004-FU1 PR failures (`spawn sh ENOENT`). The exact content at `0490dfc` is the version that had been running successfully on push-to-main (last success: 2026-04-11). `cmp` verified 3313 bytes, byte-identical.
- **PR CI preview runs will fail** — the workflow's `deploy-preview` job has been broken since day one (same `spawn sh ENOENT` as BUG-PROD-004 deploy-web before cleanup). This is known tolerable noise; the `deploy-production` job on push-to-main is the load-bearing path and works correctly.
- **nutrixplorer.com remains live** during the revert window regardless, serving the 2026-04-11 build.

---

## Implementation Plan

N/A — Simple hotfix (single-file restore + docs updates).

---

## Acceptance Criteria

- [x] `.github/workflows/deploy-landing.yml` restored at HEAD, byte-identical to commit `0490dfc` (3313 bytes) — `cmp` verified
- [x] `key_facts.md` Infrastructure + Hosting (Landing) sections accurately describe the workflow-based deploy mechanism and the fact that the `nutrixplorer` Vercel project is NOT Git-connected (at time of revert) — committed in `10a131e`
- [x] `bugs.md` post-mortem entry added describing the incident, root cause, solution, and prevention rules — committed in `10a131e`
- [x] BUG-PROD-004-FU1 ticket marked `Reverted` with pointer to this ticket
- [x] `product-tracker.md` reflects: BUG-PROD-004-FU1 reverted, BUG-PROD-004 Follow-up 1 reopened as blocked on Vercel GH App connection
- [x] PR CI `ci-success` green post-revert — PR #125, all 6 test-* jobs pass, `Vercel – foodyassistance` pass, `changes` pass
- [x] Post-merge: `deploy-landing.yml` visible at `.github/workflows/deploy-landing.yml` on `develop` (verified via `git ls-tree origin/develop`). Main will receive it via next release merge.

---

## Definition of Done

- [x] Workflow file restored
- [x] `cmp` confirms byte-identity with `git show 0490dfc:.github/workflows/deploy-landing.yml`
- [x] `key_facts.md` + `bugs.md` + tracker + both tickets updated
- [x] `git status` clean after commit
- [x] PR #125 opened, squash-merged to `develop` at `30ea01f`, branch deleted local + remote
- [x] Merge Checklist Evidence table filled (this tracker-sync PR)

**Post-merge (Step 6) actions — tracked in Completion Log, not DoD:**

- squash-merge to `develop`
- delete branch local + remote
- tracker-sync PR for any residual doc-only updates
- Task 2 (BUG-PROD-004-FU2) continues as "user connects Vercel GH App to nutrixplorer"

---

## Workflow Checklist

<!-- Simple tier hotfix: only Steps 1, 3, 4, 5, 6 -->

- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 3: Workflow file restored + docs updated
- [x] Step 4: Quality gates — no code affected; `cmp` verifies byte-identity; PR CI acts as oracle (10/10 green on PR #125)
- [x] Step 5: PR #125 opened, `code-review-specialist` skipped (hotfix revert, zero novel code)
- [x] Step 6: Ticket updated with final state, branch deleted, BUG-PROD-004-FU2 verification completed (see Completion Log)

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-15 | Ticket created | P1 hotfix revert of BUG-PROD-004-FU1 |
| 2026-04-15 | Branch created | `bugfix/BUG-PROD-004-FU1-REVERT-restore-deploy-landing` from `develop` at `894e135` |
| 2026-04-15 | File restored | `git show 0490dfc:.github/workflows/deploy-landing.yml > .github/workflows/deploy-landing.yml`; `cmp` → byte-identical (3313 bytes) |
| 2026-04-15 | Docs updated | `key_facts.md` Infrastructure + Hosting (Landing), `bugs.md` post-mortem, `product-tracker.md` Active Session, BUG-PROD-004-FU1 ticket marked Reverted |
| 2026-04-15 | Commit `10a131e` | `fix(BUG-PROD-004-FU1-REVERT): restore deploy-landing.yml — P1 deploy regression` (6 files, +251/-8) |
| 2026-04-15 | PR #125 opened | Target `develop`. CI 10/10 green (ci-success pass, test-* all pass, Vercel – foodyassistance pass, changes pass). |
| 2026-04-15 | Squash-merged | PR #125 → `develop` at `30ea01f` (fast-forward). Branch deleted local + remote. |
| 2026-04-15 | Task 2 (FU2) executed | User connected Vercel GitHub App to `pbojedas-projects/nutrixplorer` via dashboard (Settings → Git → Connect Git Repository, Root Directory `packages/landing`, Production Branch auto-detected as `main`). |
| 2026-04-15 | Task 2 verification — preview path | PR #126 (branch `chore/verify-vercel-nutrixplorer-preview`) opened against `develop` with a one-line comment in `packages/landing/next.config.mjs`. Result: `Vercel – nutrixplorer` status check appeared with URL `https://vercel.com/pbojedas-projects/nutrixplorer/9Q2eKGmqU1ejJpUXKXRh4xB226KF` — **state: pass, "Deployment has completed"**. Preview path empirically validated. Squash-merged at `3418b5b`. |
| 2026-04-15 | Task 2 verification — production path | PR #127 (branch `chore/verify-vercel-nutrixplorer-prod`) opened against `main` with a one-line comment in `packages/landing/next.config.mjs`. Result on the pre-merge PR: `Vercel – nutrixplorer` pass. Result post-merge on main commit `bf2b9b5`: **`Vercel – nutrixplorer` = success + `Vercel – foodyassistance` = success** (combined commit status = success). Production path empirically validated for BOTH projects. Squash-merged at `bf2b9b5`. |
| 2026-04-15 | Side-effect discovery | The user's Vercel dashboard change to Root Directory (`packages/landing`) broke the custom `deploy-landing.yml` workflow. Push-to-main run on `bf2b9b5` failed in 20s with: `Error: ENOENT: no such file or directory, open '/home/runner/work/foodyxplorer/foodyxplorer/packages/landing/packages/landing/package.json'`. The double-path (`packages/landing/packages/landing/...`) is the result of `vercel pull` downloading the new project config with `rootDirectory=packages/landing`, combined with the workflow's own `working-directory: packages/landing` step navigation. **Not a production issue** because the Vercel GitHub App is handling both deploys independently — but the failing workflow is now noise that should be eliminated. |
| 2026-04-15 | 4-quadrant verification matrix | Preview × Production × (nutrixplorer, foodyassistance) = 4 green: PR #126/127 both showed `Vercel – nutrixplorer` + `Vercel – foodyassistance` pass; merge commit `bf2b9b5` on main showed both status contexts as success. Live domain checks: `nutrixplorer.com` 200 OK (landing), `www.nutrixplorer.com` 200 OK, `app.nutrixplorer.com` → `/hablar` 200 OK (web), `api.nutrixplorer.com/health` 200 OK (Render prod), `api-dev.nutrixplorer.com/health` 200 OK (Render staging). |
| 2026-04-15 | Tracker-sync PR | This PR — closes BUG-PROD-004-FU1-REVERT (Status → Done), unblocks BUG-PROD-004 Follow-up 1 retry, updates `key_facts.md` with final Vercel architecture, extends `bugs.md` post-mortem with the verification outcome. |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | All 7 sections present: Spec, Implementation Plan (N/A), Acceptance Criteria, Definition of Done, Workflow Checklist, Completion Log, Merge Checklist Evidence |
| 1. Mark all items | [x] | AC: 7/7, DoD: 6/6, Workflow: 5/5 (all Simple tier hotfix steps complete). Status `Ready for Merge` → `Done` (set during this tracker-sync PR). |
| 2. Verify product tracker | [x] | Active Session updated: BUG-PROD-004-FU1-REVERT → Last Completed. Follow-up 1 reopened as UNBLOCKED for retry. Follow-up 2 DONE. |
| 3. Update key_facts.md | [x] | Infrastructure + Hosting (Landing) sections updated twice: first in `10a131e` (post-revert state), then in this PR to reflect final 4-quadrant verified Vercel GitHub App architecture for both `foodyassistance` and `nutrixplorer` projects. |
| 4. Update decisions.md | [x] | N/A — Simple tier hotfix, no ADR required. |
| 5. Commit documentation | [x] | Revert landed in `10a131e` (PR #125 squashed to `30ea01f`). This tracker-sync PR is the doc finalization commit. |
| 6. Verify clean working tree | [x] | `git status` clean on `chore/tracker-sync-bug-prod-004-fu1-cycle` (except untracked `.claude/scheduled_tasks.lock` runtime artifact) |
| 7. Verify branch up to date | [x] | `git fetch origin develop && git merge-base --is-ancestor origin/develop HEAD` → exit 0 (synced to `3418b5b`, the latest develop post-PR #126 merge) |

---

*Ticket created: 2026-04-15*
