# BUG-PROD-004-FU1-REVERT: Restore deploy-landing.yml (revert BUG-PROD-004-FU1)

**Feature:** BUG-PROD-004-FU1-REVERT | **Type:** Infra-Hotfix | **Priority:** P1
**Status:** In Progress | **Branch:** bugfix/BUG-PROD-004-FU1-REVERT-restore-deploy-landing
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

- [ ] `.github/workflows/deploy-landing.yml` restored at HEAD, byte-identical to commit `0490dfc` (3313 bytes)
- [ ] `key_facts.md` Infrastructure + Hosting (Landing) sections accurately describe the workflow-based deploy mechanism and the fact that the `nutrixplorer` Vercel project is NOT Git-connected
- [ ] `bugs.md` post-mortem entry added describing the incident, root cause, solution, and prevention rules
- [ ] BUG-PROD-004-FU1 ticket marked `Reverted` with pointer to this ticket
- [ ] `product-tracker.md` reflects: BUG-PROD-004-FU1 reverted, BUG-PROD-004 Follow-up 1 reopened as blocked on Vercel GH App connection
- [ ] PR CI `ci-success` green post-revert
- [ ] Post-merge: `deploy-landing.yml` is visible at `.github/workflows/deploy-landing.yml` on `develop` and `main` (via next release merge)

---

## Definition of Done

- [ ] Workflow file restored
- [ ] `cmp` confirms byte-identity with `git show 0490dfc:.github/workflows/deploy-landing.yml`
- [ ] `key_facts.md` + `bugs.md` + tracker + both tickets updated
- [ ] `git status` clean after commit
- [ ] PR opened, squash-merged to `develop`, branch deleted local + remote
- [ ] Merge Checklist Evidence table filled

**Post-merge (Step 6) actions — tracked in Completion Log, not DoD:**

- squash-merge to `develop`
- delete branch local + remote
- tracker-sync PR for any residual doc-only updates
- Task 2 (BUG-PROD-004-FU2) continues as "user connects Vercel GH App to nutrixplorer"

---

## Workflow Checklist

<!-- Simple tier hotfix: only Steps 1, 3, 4, 5, 6 -->

- [ ] Step 1: Branch created, ticket generated, tracker updated
- [ ] Step 3: Workflow file restored + docs updated
- [ ] Step 4: Quality gates — no code affected; `cmp` verifies byte-identity; PR CI acts as oracle
- [ ] Step 5: PR opened, `code-review-specialist` skipped (hotfix revert, zero novel code)
- [ ] Step 6: Ticket updated with final state, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-15 | Ticket created | P1 hotfix revert of BUG-PROD-004-FU1 |
| 2026-04-15 | Branch created | `bugfix/BUG-PROD-004-FU1-REVERT-restore-deploy-landing` from `develop` at `894e135` |
| 2026-04-15 | File restored | `git show 0490dfc:.github/workflows/deploy-landing.yml > .github/workflows/deploy-landing.yml`; `cmp` → byte-identical (3313 bytes) |
| 2026-04-15 | Docs updated | `key_facts.md` Infrastructure + Hosting (Landing), `bugs.md` post-mortem, `product-tracker.md` Active Session, BUG-PROD-004-FU1 ticket marked Reverted |

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

*Ticket created: 2026-04-15*
