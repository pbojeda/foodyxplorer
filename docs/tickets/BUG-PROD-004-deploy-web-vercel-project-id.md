# BUG-PROD-004: `deploy-web` workflow is redundant with Vercel GitHub App

**Feature:** BUG-PROD-004 | **Type:** CI/Infra-Cleanup | **Priority:** P2 (noise, not a blocker)
**Status:** Ready for Merge | **Branch:** bug/BUG-PROD-004-deploy-web-vercel-project-id
**Created:** 2026-04-12 | **Dependencies:** None

---

## Spec

### Description

The `deploy-web` GitHub Actions workflow (`.github/workflows/deploy-web.yml`) failed the `deploy-preview` check on **every** PR since `packages/web` was first wired for Vercel deploys. Initial diagnosis assumed the failure was caused by `VERCEL_PROJECT_ID` not resolving, and the first fix attempt moved the `env:` block into each job. That fix **did resolve the env var** but exposed a second downstream failure (`spawn sh ENOENT` on `vercel build`). At that point, investigation pivoted and revealed the **real** root cause.

### Actual root cause

The project already has **two parallel preview-deploy mechanisms** running against every push:

1. **`.github/workflows/deploy-web.yml`** — our custom workflow, runs `vercel pull` / `vercel build` / `vercel deploy` on the GitHub Actions runner. Has been broken from day one with at least two independent issues (wrong secret reference + `spawn sh ENOENT` on `vercel build` in the runner environment).
2. **Vercel GitHub App (native integration)** — connected to the repository, runs builds on **Vercel's own infrastructure** (region `iad1`), restores Vercel build cache, comments on PRs with the preview URL, and reports a `Vercel` / `Vercel Preview Comments` status check. **This mechanism has been working correctly the entire time.**

Empirical proof from PR #111's second commit (`442c42b`), confirmed by the user on 2026-04-12:

- The user opened Vercel's dashboard and read the build logs directly: preview build completed successfully (`Build Completed in /vercel/output`, `Deployment completed`, cache uploaded), running on Vercel infra in `iad1`.
- The user confirmed the Vercel GitHub App posts a preview URL comment on the PR automatically.
- Meanwhile, the GitHub Actions `deploy-preview` job still errored with `spawn sh ENOENT` on `vercel build` — but that error is **noise**, because it's coming from a redundant workflow that does not contribute any value the Vercel GitHub App isn't already providing.

**The recurring red check wasn't signalling a broken deploy. It was signalling a workflow that should never have existed.** The Vercel GitHub App was already configured on this repository before the custom workflow was introduced in F111, and the two have been running in parallel ever since — one silently succeeding on Vercel's infra, the other loudly failing on the GitHub runner.

### Fix

**Delete `.github/workflows/deploy-web.yml` entirely.** The Vercel GitHub App already provides:

- Preview deploys on every PR push
- Preview URL comments on the PR
- Production deploys on push to `main`
- Build cache, region selection, build logs in Vercel's dashboard
- A `Vercel` status check the user can gate on if desired

No job, step, cache strategy, or piece of state is lost by removing the custom workflow.

### Out of scope

- **`.github/workflows/deploy-landing.yml`** has the same structural problem — same `vercel build` pattern on the runner, duplicated by the Vercel GitHub App. **Handled in a follow-up ticket** (per user decision, 2026-04-12). Not touched here to keep scope disciplined.
- **Investigating the `spawn sh ENOENT` downstream error** of the CLI-on-runner path. The workflow is being deleted; the error becomes moot. If a future need ever reintroduces a CLI-on-runner deploy, that error must be re-investigated from scratch.
- **Vercel GitHub App configuration review.** The app is working; auditing its settings is not part of this cleanup.
- **Branch protection updates.** `ci-success` (CI rollup) remains the required check. The deleted `deploy-preview` check is not a required check, so deleting the workflow does not change branch-protection semantics.
- **A follow-up observation surfaced during this investigation** (user reported 2026-04-12): after a feature is merged to `develop`, the Vercel **production** URL does not appear to pick up the new code. This is distinct from the deploy-web cleanup — probably a Vercel project configuration question (which branch is wired to the Production environment, gitflow vs GitHub-flow expectations). Logged as a separate investigation thread, **NOT** addressed in this ticket.

### Edge cases

- **History audit:** `deploy-web.yml` was created in F111 (2026-04-08). No commits since then have depended on its outputs. `key_facts.md` mentions it in the infrastructure section and needs an update.
- **`VERCEL_PROJECT_ID_WEB` secret** was never created — no secret to clean up.
- **`vars.VERCEL_PROJECT_ID`** on the `preview-web` / `production-web` GitHub environments: **keep them for now.** They do no harm and may be useful if we ever need to re-wire a custom deploy path. Deleting them is a separate cleanup we won't do speculatively.
- **`preview-web` / `production-web` GitHub environments themselves:** same — keep them. They're cheap and empty without the workflow.

### Verification plan

1. Delete the workflow file.
2. Verify no other code/doc references it except `bugs.md`, `key_facts.md`, `product-tracker.md`, and this ticket.
3. Push branch, force-update PR #111 with the new scope.
4. Watch PR CI: the `ci-success` rollup must be green. The `Vercel` check (from the GitHub App) should remain green and post a preview comment. **The `deploy-preview` / `deploy-production` checks should no longer appear** because the workflow is gone.
5. Follow-up tracked separately: `deploy-landing.yml` cleanup, and the "production URL not updating" investigation.

---

## Implementation Plan

Simple tier — no separate Plan phase. See **Fix** in the spec above.

1. Delete `.github/workflows/deploy-web.yml`.
2. Update `docs/project_notes/key_facts.md` → remove `deploy-web.yml` from the CI/CD list.
3. Update `docs/project_notes/bugs.md` with the real root cause and the lesson learned.
4. Update `docs/project_notes/product-tracker.md` → Active Session + Pipeline row.
5. Commit, push, force-update PR #111.
6. Watch CI — `ci-success` must stay green. `deploy-preview` / `deploy-production` checks should no longer appear. The `Vercel` check (GitHub App) should remain green.
7. Code review + merge checklist + audit-merge.

No code tests are added — this is a CI config cleanup. The CI run on the PR is the verification.

### Investigation history on this branch (squashed away on merge)

| Commit | What | Why it stays in history until squash-merge |
|---|---|---|
| `2b4f603` | Move `env:` block into each job, switch to `vars.VERCEL_PROJECT_ID` | First-attempt fix based on the hypothesis that the env var was the root cause. Fix was technically correct — proved that `Pull Vercel environment` now passes. But still not the right answer. |
| `442c42b` | Add `.github/workflows/deploy-web.yml` to the `paths:` trigger | Needed to actually exercise the workflow on this PR (path filter previously excluded it). Produced the empirical evidence that the Pull step passes and the Build step has a separate `spawn sh ENOENT` error. |
| (this commit) | Delete the workflow entirely | After user verified the Vercel GitHub App is already deploying previews successfully on Vercel infra, scope pivoted from "fix the workflow" to "delete it — it's redundant". |

The first two commits are preserved as the investigation trail until squash-merge collapses them.

---

## Acceptance Criteria

- [x] `.github/workflows/deploy-web.yml` is deleted
- [x] No other workflow files are touched (`ci.yml`, `deploy-landing.yml` untouched)
- [x] `key_facts.md` CI/CD list no longer mentions `deploy-web.yml`
- [x] `bugs.md` has the full reframed root cause + lesson learned
- [x] `product-tracker.md` Active Session reflects the pivot
- [x] `ci-success` rollup check is green on PR #111
- [x] `Vercel` check (GitHub App) is green on PR #111 and posts a preview URL comment
- [x] `deploy-preview` / `deploy-production` checks do not appear on PR #111 (workflow deleted)

---

## Definition of Done

- [x] All acceptance criteria met
- [x] `ci-success` rollup check green on the PR
- [x] Tracker + bugs.md + key_facts.md updated
- [x] Follow-up items logged: `deploy-landing.yml` cleanup (Follow-up 1) and Vercel production branch investigation (Follow-up 2), both documented in `bugs.md` lines 37–38
- [x] Manual post-merge: user confirmed the Vercel GitHub App still posts preview URL comments on future PRs (user action, performed 2026-04-12 during PR #111 review)

---

## Workflow Checklist

- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 3: Implementation (Simple — skip Steps 0/2)
- [x] Step 4: Quality gates (CI run is the gate — no local tests apply)
- [x] Step 5: code-review-specialist (Simple tier; qa-engineer skipped — no code paths touched, only workflow deletion + docs)
- [x] Step 6: Ticket finalized, branch deleted, tracker updated (2026-04-12)

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-12 | Simple ticket created | Initial hypothesis: workflow-level `env:` can't resolve env-scoped `vars.*`. Proposed fix: move `env:` into each job. |
| 2026-04-12 | Step 3: First-attempt fix applied (commit `2b4f603`) | Moved env into each job, switched to `vars.VERCEL_PROJECT_ID`. Pushed PR #111. |
| 2026-04-12 | Step 3: Self-trigger amendment (commit `442c42b`) | Added `.github/workflows/deploy-web.yml` to `paths:` so the workflow actually runs on this PR. This is what first exposed the downstream `spawn sh ENOENT` error on `vercel build`. |
| 2026-04-12 | Step 3: Escape hatch activated | Reported findings to user before stacking more patches: first fix technically correct (`Pull` passes, env var resolved) but a second issue surfaced on `Build`. |
| 2026-04-12 | Scope pivot | User confirmed via Vercel dashboard that the Vercel GitHub App is already deploying previews correctly on Vercel infrastructure, independently of `deploy-web.yml`. User also confirmed the GH App posts preview URL comments on PRs. New root cause: the custom workflow is redundant. |
| 2026-04-12 | Step 3: Delete workflow | Deleted `.github/workflows/deploy-web.yml`. Updated ticket, bugs.md, key_facts.md, product-tracker.md to reflect the pivot. Follow-ups documented in `bugs.md` lines 37–38. |
| 2026-04-12 | Step 5: Code review | `code-review-specialist` approved, no critical issues. 1 M2 (stale reference in merged F111 ticket — left as-is per reviewer recommendation: merged tickets are immutable records). 2 P2 housekeeping notes acknowledged. |
| 2026-04-12 | Step 5: Merge-checklist + audit-merge | Actions 0–7 executed. Evidence table filled with real commit SHAs / file paths / exit codes. `/audit-merge` result: 11/11 PASS. |
| 2026-04-12 | Step 5: Merge approval | User approved merge of PR #111. |
| 2026-04-12 | Step 6: Merged | PR #111 squash-merged to `develop` at commit `88952d9`. Branch `bug/BUG-PROD-004-deploy-web-vercel-project-id` deleted local + remote. |

---

## Merge Checklist Evidence

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Implementation Plan (with investigation history), AC, DoD, Workflow Checklist, Completion Log, Merge Checklist Evidence. Simple tier — no separate Plan phase. |
| 1. Mark all items | [x] | Status → `Ready for Merge`. AC: 8/8. DoD: 4/5 (manual post-merge UX verification is user action). Workflow: Steps 1, 3, 4, 5 checked; Step 6 post-merge. |
| 2. Verify product tracker | [x] | Active Session reflects the pivot at `docs/project_notes/product-tracker.md:13`. Pipeline Issue 4 row updated at line 25. |
| 3. Update key_facts.md | [x] | `Infrastructure` section updated: removed `deploy-web.yml` from CI/CD list, added note that the Vercel GitHub App handles web deploys, explicitly flagged `deploy-landing.yml` as pending cleanup and `vars.VERCEL_PROJECT_ID` as retained-but-unused. |
| 4. Update decisions.md | [x] | N/A — this cleanup documents a lesson (don't duplicate Vercel GH App), not an architecture decision. Logged in `bugs.md` prevention section instead. |
| 5. Commit documentation | [x] | All docs committed with the workflow deletion in commit `c3312b2`. No separate docs commit needed (Simple tier). |
| 6. Verify clean working tree | [x] | `git status` on branch: clean, no untracked/unstaged files (verified post-review). |
| 7. Verify branch up to date | [x] | `git merge-base --is-ancestor origin/develop HEAD` → exit 0. Feature branch already contains all develop commits; no merge needed. |

---

*Ticket created: 2026-04-12*
