# BUG-PROD-004-FU1: Delete redundant deploy-landing.yml workflow

**Feature:** BUG-PROD-004-FU1 | **Type:** Infra-Bugfix | **Priority:** Low
**Status:** In Progress | **Branch:** bugfix/BUG-PROD-004-followup-1-delete-deploy-landing
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
- [ ] PR CI (`ci-success`) stays green post-deletion
- [ ] Vercel GitHub App `Vercel` / `Vercel Preview Comments` checks still post on the PR (empirical proof the native integration is handling landing)

---

## Definition of Done

- [x] File deleted
- [x] Grep for `deploy-landing` returns only expected references (bugs.md history, this ticket, tracker entries, context prompts)
- [ ] `git status` clean after commit
- [ ] PR opened, squash-merged to `develop`, branch deleted local + remote
- [ ] `bugs.md` BUG-PROD-004 entry updated: Follow-up 1 → DONE with PR link

---

## Workflow Checklist

<!-- Simple tier: only Steps 1, 3, 4, 5, 6 -->

- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 3: Workflow file deleted + `key_facts.md` stale reference updated inline
- [x] Step 4: Quality gates — no code affected (zero `.ts`/`.tsx`/`.js` diff); local `npm test/lint/build` skipped as non-informative for a pure workflow-file deletion; PR CI is the real oracle
- [ ] Step 5: PR opened, `code-review-specialist` skipped (Simple tier, infra-only, no code paths)
- [ ] Step 6: Ticket updated with final state, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-15 | Ticket created | Simple tier, BUG-PROD-004 follow-up 1 |
| 2026-04-15 | Branch created | `bugfix/BUG-PROD-004-followup-1-delete-deploy-landing` from `develop` |
| 2026-04-15 | File deleted | `git rm .github/workflows/deploy-landing.yml` |
| 2026-04-15 | key_facts.md updated | Infrastructure + Hosting (Landing) entries no longer reference the custom workflow |
| 2026-04-15 | tracker updated | Active Session → BUG-PROD-004-FU1 step `1/6` |

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
