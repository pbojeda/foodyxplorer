# BUG-PROD-004-FU1-RETRY: Delete deploy-landing.yml (retry, empirically verified)

**Feature:** BUG-PROD-004-FU1-RETRY | **Type:** Infra-Bugfix | **Priority:** Low
**Status:** In Progress | **Branch:** bugfix/BUG-PROD-004-FU1-RETRY-delete-deploy-landing
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-04-15 | **Dependencies:** BUG-PROD-004-FU1-REVERT (PR #125, merged at `30ea01f`), BUG-PROD-004-FU2 verification (PR #126 `3418b5b` + PR #127 `bf2b9b5`), tracker-sync PR A (PR #128, `4b2b0fc`)

---

## Spec

### Description

Re-delete `.github/workflows/deploy-landing.yml`. This is the retry of BUG-PROD-004-FU1 (which was reverted same-day after discovering the Vercel GitHub App was not connected to the `nutrixplorer` project, making the original workflow load-bearing).

**What has changed since the first attempt**:

1. **User connected the Vercel GitHub App to `pbojedas-projects/nutrixplorer`** on 2026-04-15 (Settings → Git → Connect Git Repository, Root Directory `packages/landing`, Production Branch auto-detected from GitHub default = `main`).
2. **4-quadrant verification matrix empirically validated**: PR #126 (landing touch against develop) showed `Vercel – nutrixplorer` preview check = pass; PR #127 (same touch against main, squash-merged at `bf2b9b5`) showed BOTH `Vercel – nutrixplorer` AND `Vercel – foodyassistance` combined status = success on main. Live domains all 200 OK.
3. **The custom workflow is now also broken**: the Root Directory change on the Vercel project caused a double-path `packages/landing/packages/landing/package.json` ENOENT error on the `bf2b9b5` push-to-main run. So the workflow is now both redundant AND failing on every landing-touching push to main — it's now noise that could confuse future sessions.

Deletion is safe and urgent.

### API Changes (if applicable)

N/A.

### Data Model Changes (if applicable)

N/A.

### UI Changes (if applicable)

N/A.

### Edge Cases & Error Handling

- **This retry must not repeat the pattern-match mistake.** Empirical anchors for why this is now safe:
  - `gh api repos/pbojeda/foodyxplorer/commits/bf2b9b5/status` → `Vercel – nutrixplorer` state=success
  - `curl -sSL https://nutrixplorer.com` → HTTP 200 via Vercel CDN
  - `gh run list --workflow=deploy-landing.yml --branch=main` → latest run on `bf2b9b5` = FAILURE (the workflow we're deleting is now broken anyway)
- **`deploy-web.yml` on main is a separate concern**: it's still on `main` (the BUG-PROD-004 deletion hasn't been release-merged from develop to main yet). Leave it alone — the next release merge to main will remove it automatically. Don't scope-creep this ticket.
- **On develop the retry is idempotent**: `deploy-landing.yml` is already absent on develop after this PR. Main still has it (pending next release merge).

---

## Implementation Plan

N/A — Simple task (single-file deletion, no code changes, no tests affected).

---

## Acceptance Criteria

- [ ] `.github/workflows/deploy-landing.yml` removed from `develop`
- [ ] `key_facts.md` Infrastructure section updated to remove the "pending cleanup retry PR" language and reflect final state
- [ ] `product-tracker.md` Follow-up 1 marked DONE with final merge commit reference
- [ ] `bugs.md` BUG-PROD-004-FU1-REVERT entry updated with final "retry landed" note
- [ ] PR CI `ci-success` stays green
- [ ] `Vercel – nutrixplorer` and `Vercel – foodyassistance` checks still post on this PR (re-verifies the GH App integration across the delete)
- [ ] Post-merge: the next landing change to `develop` or `main` must show a `Vercel – nutrixplorer` check from the GH App (handled by PR B follow-up verification in a future session, or organically when any real landing change lands)

---

## Definition of Done

- [ ] File deleted
- [ ] `key_facts.md` + `bugs.md` + tracker updated inline
- [ ] `git status` clean after commit
- [ ] PR opened (#TBD), CI green
- [ ] Merge Checklist Evidence filled
- [ ] Ticket Status → `Ready for Merge`

**Post-merge (Step 6) actions — tracked in Completion Log, not DoD:**

- squash-merge to `develop`
- delete branch local + remote
- tracker-sync PR if any residual doc updates (likely none — can inline Step 6 housekeeping in a later session)

---

## Workflow Checklist

<!-- Simple tier: Steps 1, 3, 4, 5, 6 only -->

- [ ] Step 1: Branch created, ticket generated, tracker unchanged (cycle already closed in PR A)
- [ ] Step 3: Workflow file deleted + `key_facts.md` + `bugs.md` + tracker inline updates
- [ ] Step 4: Quality gates — no code affected; CI acts as oracle
- [ ] Step 5: PR opened, `code-review-specialist` skipped (Simple infra-only + already empirically verified)
- [ ] Step 6: Ticket → Done, branch deleted, doc follow-ups

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-15 | Ticket created | Retry of BUG-PROD-004-FU1, safe this time due to 4-quadrant verification in prior cycle |
| 2026-04-15 | Branch created | `bugfix/BUG-PROD-004-FU1-RETRY-delete-deploy-landing` from `develop` at `4b2b0fc` |
| 2026-04-15 | File deleted | `git rm .github/workflows/deploy-landing.yml` |

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
