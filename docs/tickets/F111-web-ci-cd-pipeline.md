# F111: Web Package CI/CD Pipeline

**Feature:** F111 | **Type:** Infra | **Priority:** High
**Status:** Done | **Branch:** feature/F111-web-ci-cd-pipeline
**Created:** 2026-04-08 | **Dependencies:** F090 (done)

---

## Spec

### Description

Add CI/CD pipeline support for the new `packages/web` workspace. This includes adding path filters and a `test-web` job to the existing CI workflow, and creating a separate Vercel deployment workflow for the web package. The web package (Next.js 15, Jest) does not need DB/Redis services — same pattern as `test-landing`. It does import from `@foodxplorer/shared`, so shared changes must also trigger the web CI job.

**Manual prerequisite:** The Vercel project for `packages/web` must be created by the user. This ticket creates the workflow file and documents the required secret (`VERCEL_PROJECT_ID_WEB`).

---

## Implementation Plan

N/A — Simple task.

---

## Acceptance Criteria

- [x] `ci.yml` has `web` output in the `changes` job
- [x] `ci.yml` has `web` filter: `packages/web/**`
- [x] `ci.yml` has `test-web` job triggered by web, shared, or root changes
- [x] `test-web` runs: `npm ci` → typecheck → lint → test → build (in `packages/web`)
- [x] `deploy-web.yml` exists with preview (PR) and production (push to main) jobs
- [x] `deploy-web.yml` uses `VERCEL_PROJECT_ID_WEB` secret (separate from landing)
- [x] `deploy-web.yml` working directory is `packages/web`
- [x] `key_facts.md` updated with CI/CD information for web package
- [x] All existing tests pass (133 web, all green)
- [x] Build succeeds (107kB first load)

---

## Definition of Done

- [x] All acceptance criteria met
- [x] No linting errors
- [x] Build succeeds
- [x] YAML syntax valid

---

## Workflow Checklist

- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 3: Implementation complete
- [x] Step 4: Quality gates pass, committed
- [x] Step 5: `code-review-specialist` executed
- [x] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-08 | Step 1: Setup | Branch + lite ticket created |
| 2026-04-08 | Step 3: Implement | ci.yml: web filter + test-web job. deploy-web.yml created. key_facts.md updated |
| 2026-04-08 | Step 4: Finalize | YAML valid, 133 tests pass, lint clean, build OK |
| 2026-04-08 | Step 5: Review | PR #86. Code review: Accepted H1 (shared path trigger), H2 (env names). Rejected: none |
| 2026-04-08 | Step 6: Complete | Squash-merged to develop (9b30f8c). Branch deleted. 133 tests pass post-merge |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Implementation Plan, AC, DoD, Workflow, Completion Log, Merge Checklist Evidence |
| 1. Mark all items | [x] | AC: 10/10, DoD: 4/4, Workflow: 4/5 (Step 6 pending) |
| 2. Verify product tracker | [x] | Active Session: step 5/6 (Review), Features table: 5/6 |
| 3. Update key_facts.md | [x] | Updated: CI/CD line, CI jobs list, Hosting (Web) line |
| 4. Update decisions.md | [x] | N/A — no architectural decisions |
| 5. Commit documentation | [x] | Commit: df81bcb |
| 6. Verify clean working tree | [x] | `git status`: clean |
| 7. Verify branch up to date | [x] | merge-base: origin/develop is ancestor of HEAD |

---

*Ticket created: 2026-04-08*
