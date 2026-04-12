# BUG-PROD-004: `deploy-web` workflow fails — `VERCEL_PROJECT_ID` not resolved

**Feature:** BUG-PROD-004 | **Type:** CI/Infra-Bugfix | **Priority:** P1 (blocks preview deploys)
**Status:** In Progress | **Branch:** bug/BUG-PROD-004-deploy-web-vercel-project-id
**Created:** 2026-04-12 | **Dependencies:** None

---

## Spec

### Description

The `deploy-web` GitHub Actions workflow (`.github/workflows/deploy-web.yml`) has been failing the `deploy-preview` check on **every** PR since `packages/web` was wired for Vercel deploys. Net effect: no automated preview URLs on PRs that touch `packages/web/**` or `packages/shared/**`, which blocks fast manual verification of the features that have been merged (BUG-PROD-001/002/003 and F-UX-A).

The failure was reported as a recurring CI red on PRs #103, #105, #107, #109 but never fixed because none of those tasks were blocked by it — this bug captures the fix in isolation.

### Root cause

`.github/workflows/deploy-web.yml` lines 26–28 declare:

```yaml
env:
  VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
  VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID_WEB }}
```

Two problems:

1. **`secrets.VERCEL_PROJECT_ID_WEB` does not exist.** The user has instead configured `vars.VERCEL_PROJECT_ID` as an **environment-scoped variable** on both the `production-web` and `preview-web` GitHub environments (value `prj_9ReUv5OkVIMG7ZtgnQxMsJObB2Zv`, verified via `gh api repos/:owner/:repo/environments/{env}/variables` on 2026-04-12).
2. **Environment-scoped variables are NOT available in the workflow-level `env:` block.** They become resolvable only after the job declares `environment: { name: … }`. The current workflow-level `env:` is evaluated before any job's environment binding, so even if the reference were corrected to `vars.VERCEL_PROJECT_ID` at the workflow level it would still resolve to an empty string.

The Vercel CLI then runs with `VERCEL_PROJECT_ID=""` and fails to `vercel pull` / `vercel build` / `vercel deploy`.

### Fix

Move the `env:` block into **each job** so the environment-scoped variable is resolvable after the job's `environment:` is bound. Read the project id from `vars.VERCEL_PROJECT_ID` (not `secrets.VERCEL_PROJECT_ID_WEB`). Keep `VERCEL_ORG_ID` on `secrets` (it's a repository secret shared across both web and landing workflows and does not need to be environment-scoped).

Resulting shape (per job):

```yaml
deploy-preview:
  if: github.event_name == 'pull_request'
  runs-on: ubuntu-latest
  environment:
    name: preview-web
    url: ${{ steps.deploy.outputs.url }}
  env:
    VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
    VERCEL_PROJECT_ID: ${{ vars.VERCEL_PROJECT_ID }}
  steps:
    …
```

Same shape for `deploy-production` (with `environment: { name: production-web }`).

The workflow-level `env:` block is deleted.

### Out of scope

- Refactoring the deploy-landing workflow even if the same pattern would help — that workflow is currently green and untouched by this bug.
- Creating a repository-level `VERCEL_PROJECT_ID` secret as a fallback — we commit to the env-scoped approach per user's existing configuration.
- Changing `VERCEL_ORG_ID` scope — it remains a repository secret.
- Adding new jobs, steps, caching strategy, or concurrency groups.

### Edge cases

- **`deploy-production` path (push to `main`):** must also be fixed in the same commit so the prod deploy doesn't silently break the next time a `main` push happens. Same pattern, `vars.VERCEL_PROJECT_ID` resolves from the `production-web` environment.
- **Branch protection:** this PR is against `develop` per gitflow. The workflow only triggers on PR to `develop` or `main`, and on push to `main`. So the PR itself will exercise the `deploy-preview` job under the `preview-web` environment binding — that's the empirical proof.
- **Variable visibility on forks:** env-scoped vars are not exposed to PRs from forks (standard GitHub behavior). Acceptable — this repo has no fork PR flow.

### Verification plan

1. Apply the fix.
2. Push branch, open PR to `develop`.
3. Watch the PR's CI: the `deploy-preview` check should transition from historically red to green. The Vercel preview URL should be posted as a PR comment by the existing `actions/github-script@v7` step.
4. **Escape hatch:** if `deploy-preview` is still red after the fix, STOP — do not stack further speculative patches. Collect the full failing job log, snapshot the resolved env vars via a debug `printenv | grep VERCEL` step if necessary, and report findings before attempting another edit. The assumption that env-scoped vars are only resolvable after `environment:` binding is the load-bearing one; if empirics contradict it, we re-investigate.

---

## Implementation Plan

Simple tier — no separate Plan phase. See **Fix** in the spec above.

1. Edit `.github/workflows/deploy-web.yml`: remove the workflow-level `env:` block, add a job-level `env:` block to both `deploy-preview` and `deploy-production`, pointing `VERCEL_PROJECT_ID` to `vars.VERCEL_PROJECT_ID`.
2. Commit.
3. Push, open PR to `develop`.
4. Watch CI — `deploy-preview` must pass.
5. Code review + merge checklist + audit-merge.

No code tests are added — this is a CI config change. The CI run itself is the test.

---

## Acceptance Criteria

- [ ] `.github/workflows/deploy-web.yml` workflow-level `env:` block is removed
- [ ] `deploy-preview` job has its own `env:` block reading `VERCEL_PROJECT_ID` from `vars.VERCEL_PROJECT_ID`
- [ ] `deploy-production` job has its own `env:` block reading `VERCEL_PROJECT_ID` from `vars.VERCEL_PROJECT_ID`
- [ ] `VERCEL_ORG_ID` continues to read from `secrets.VERCEL_ORG_ID` (unchanged)
- [ ] No other workflow files are touched
- [ ] PR CI: `deploy-preview` check is **green** (previously red on every PR)
- [ ] Vercel preview URL is posted as a comment on the PR

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] `ci-success` rollup check green on the PR
- [ ] `deploy-preview` check green on the PR (empirical verification of the fix)
- [ ] Tracker updated (Active Session + Pipeline row for Issue 4)
- [ ] `bugs.md` updated with root cause + prevention (env-scoped vars only resolvable after job `environment:` binding)
- [ ] Manual post-merge verification: user opens the preview URL and confirms `/hablar` loads (user action, not a gate)

---

## Workflow Checklist

- [ ] Step 1: Branch created, ticket generated, tracker updated
- [ ] Step 3: Implementation (Simple — skip Steps 0/2)
- [ ] Step 4: Quality gates (CI run is the gate — no local tests apply)
- [ ] Step 5: code-review-specialist (Simple: qa-engineer optional, recommended for infra — will run)
- [ ] Step 6: Ticket finalized, branch deleted, tracker updated (post-merge)

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-12 | Simple ticket created | Root cause: workflow-level `env:` can't resolve env-scoped `vars.*`. Fix: move `env:` into each job. |

---

## Merge Checklist Evidence

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | (pending) |
| 1. Mark all items | [ ] | (pending) |
| 2. Verify product tracker | [ ] | (pending) |
| 3. Update key_facts.md | [ ] | (pending) |
| 4. Update decisions.md | [ ] | (pending) |
| 5. Commit documentation | [ ] | (pending) |
| 6. Verify clean working tree | [ ] | (pending) |
| 7. Verify branch up to date | [ ] | (pending) |

---

*Ticket created: 2026-04-12*
