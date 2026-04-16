# BUG-PROD-004-FU1-RETRY: Delete deploy-landing.yml (retry, empirically verified)

**Feature:** BUG-PROD-004-FU1-RETRY | **Type:** Infra-Bugfix | **Priority:** Low
**Status:** Done | **Branch:** bugfix/BUG-PROD-004-FU1-RETRY-delete-deploy-landing (deleted)
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

- [x] `.github/workflows/deploy-landing.yml` removed from `develop` — verified: `git ls-tree origin/develop .github/workflows/` shows only `ci.yml` after merge `0a9f5b6`
- [x] `key_facts.md` Infrastructure section updated to remove the "pending cleanup retry PR" language and reflect final state — committed inline in PR #129 (`2ef4326`)
- [x] `product-tracker.md` Follow-up 1 marked DONE with final merge commit reference — committed inline in PR #129
- [x] `bugs.md` BUG-PROD-004-FU1-REVERT entry already captured the full cycle outcome in PR #128 (`4b2b0fc`, tracker-sync PR A) — no further update was needed in PR #129 because the post-mortem had already been finalized with "Follow-up 1 UNBLOCKED for retry" language which this PR #129 makes retroactively accurate
- [x] PR CI `ci-success` stayed green on PR #129 — 10/10 checks: `ci-success` pass (2s), `test-api` pass (3m59s), `test-bot` pass (1m26s), `test-landing` pass (1m20s), `test-scraper` pass (1m29s), `test-shared` pass (1m12s), `test-web` pass (1m45s), `changes` pass (6s), `Vercel Preview Comments` pass
- [x] `Vercel – nutrixplorer` and `Vercel – foodyassistance` checks posted on PR #129 — both pass, URLs: `https://vercel.com/pbojedas-projects/nutrixplorer/DXkv2g14J2kRah4vGuHrnWiP1pqA` and `https://vercel.com/pbojedas-projects/foodyassistance/HaiSrmpHLFg9whUkCMgYiaqg52BS`. This re-verified the GH App integration held across the delete operation.
- [x] Post-merge: No `Deploy Landing` workflow fires on develop anymore (workflow file absent). The next real landing change to `main` will be verified organically when the release merge develops → main lands (that release will also remove `deploy-landing.yml` and `deploy-web.yml` from main). No immediate action required.

---

## Definition of Done

- [x] File deleted
- [x] `key_facts.md` + tracker updated inline in PR #129; `bugs.md` already captured the cycle outcome in PR #128
- [x] `git status` clean after commit
- [x] PR #129 opened, CI 10/10 green
- [x] Merge Checklist Evidence filled (this tracker-sync PR — BUG-PROD-004-FU1-RETRY-FINALIZE)
- [x] Ticket Status → `Done` (set in this tracker-sync PR)

**Post-merge (Step 6) actions — completed via separate tracker-sync PR (this PR):**

- ✅ squash-merge to `develop` at `0a9f5b6`
- ✅ branch deleted local + remote (via `gh pr merge --delete-branch`)
- ✅ tracker-sync PR for Step 6 housekeeping (**this PR** — `chore/tracker-sync-bug-prod-004-fu1-retry-finalize`) — adds preventive note to `bugs.md` about split-cycle tickets each needing their own explicit Step 6

---

## Workflow Checklist

<!-- Simple tier: Steps 1, 3, 4, 5, 6 only -->

- [x] Step 1: Branch `bugfix/BUG-PROD-004-FU1-RETRY-delete-deploy-landing` created from develop at `4b2b0fc`, ticket generated, tracker Active Session updated to Step 5 in PR #129
- [x] Step 3: Workflow file deleted + `key_facts.md` + tracker inline updates (commit `2ef4326` on PR #129)
- [x] Step 4: Quality gates — no code affected; CI acted as oracle (10/10 green)
- [x] Step 5: PR #129 opened, `code-review-specialist` skipped (Simple infra-only + already empirically verified via 4-quadrant matrix in BUG-PROD-004-FU1-REVERT)
- [x] Step 6: Ticket → Done (this tracker-sync PR BUG-PROD-004-FU1-RETRY-FINALIZE), branch deleted during `gh pr merge --delete-branch`, doc follow-ups: preventive note added to `bugs.md` about split-cycle tickets requiring independent Step 6

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-15 | Ticket created | Retry of BUG-PROD-004-FU1, safe this time due to 4-quadrant verification in prior cycle |
| 2026-04-15 | Branch created | `bugfix/BUG-PROD-004-FU1-RETRY-delete-deploy-landing` from `develop` at `4b2b0fc` |
| 2026-04-15 | File deleted | `git rm .github/workflows/deploy-landing.yml` (104 lines) |
| 2026-04-15 | Docs updated inline | `key_facts.md` Infrastructure + Hosting (Landing) sections finalized; `product-tracker.md` Active Session → Step 5, Follow-up 1 → DONE with full cycle audit trail |
| 2026-04-15 | Commit `2ef4326` | `chore(BUG-PROD-004-FU1-RETRY): delete deploy-landing.yml (empirically safe retry)` — 4 files changed (+126/-109), workflow delete + 2 docs + 1 new ticket |
| 2026-04-15 | PR #129 opened | Target `develop`. Branch `bugfix/BUG-PROD-004-FU1-RETRY-delete-deploy-landing`. |
| 2026-04-15 | CI 10/10 green | `ci-success` pass (2s), `test-api` pass (3m59s), `test-bot` pass (1m26s), `test-landing` pass (1m20s), `test-scraper` pass (1m29s), `test-shared` pass (1m12s), `test-web` pass (1m45s), `changes` pass (6s), `Vercel – nutrixplorer` pass (URL `...DXkv2g14J2kRah4vGuHrnWiP1pqA`), `Vercel – foodyassistance` pass (URL `...HaiSrmpHLFg9whUkCMgYiaqg52BS`). Note: no `Deploy Landing` workflow fired on this PR — deletion took effect immediately on the feature branch. |
| 2026-04-15 | Squash-merged | PR #129 → `develop` at `0a9f5b6` (fast-forward from `4b2b0fc`). Branch deleted local + remote via `--delete-branch`. |
| 2026-04-15 | Post-merge verification | `git ls-tree origin/develop .github/workflows/` → only `ci.yml` present. `curl -sSL https://nutrixplorer.com` → HTTP 200 (landing still live via Vercel GH App). `curl -sSL https://app.nutrixplorer.com/hablar` → HTTP 200 (web assistant still live). |
| 2026-04-15 | External audit finding | An independent agent audited the cycle post-merge and identified this ticket's Step 6 as incomplete: Status still `In Progress`, AC/DoD/Workflow checkboxes all unchecked, Merge Checklist Evidence all placeholder, Completion Log missing post-merge entries. The finding was a traceability gap — the tracker had been marked DONE in PR #129 inline, but the ticket file itself was not finalized. Finding accepted. |
| 2026-04-15 | Tracker-sync PR (this) | Branch `chore/tracker-sync-bug-prod-004-fu1-retry-finalize`. Sets ticket Status → Done, marks all 7 AC / 6 DoD / 5 Workflow / 8 Merge Checklist Evidence rows with real evidence, extends this Completion Log. Also adds a preventive rule note to `bugs.md` about split-cycle tickets (REVERT + RETRY + tracker-sync-A) each requiring their own explicit Step 6 — the global tracker-sync PR A only synchronizes project-wide state, it does NOT close individual downstream tickets automatically. |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | All 7 sections present: Spec, Implementation Plan (N/A Simple), Acceptance Criteria, Definition of Done, Workflow Checklist, Completion Log, Merge Checklist Evidence. Ticket template followed. |
| 1. Mark all items | [x] | AC: 7/7, DoD: 6/6, Workflow: 5/5 (Simple tier hotfix steps 1/3/4/5/6 all complete). Status `In Progress` → `Done` (set in this tracker-sync PR after external audit finding). |
| 2. Verify product tracker | [x] | Tracker was updated inline in PR #129 (commit `2ef4326`): Active Session → BUG-PROD-004-FU1-RETRY Step `5/6 (Review)`, Follow-up 1 → DONE with full cycle audit trail. Post-merge state at `0a9f5b6` confirmed via `git log origin/develop`. |
| 3. Update key_facts.md | [x] | Infrastructure section rewritten to remove "pending cleanup retry PR" language. Hosting (Landing) section updated. Committed inline in PR #129 commit `2ef4326` at `4b2b0fc..0a9f5b6` diff. |
| 4. Update decisions.md | [x] | N/A — Simple tier infra-only, no ADR required. |
| 5. Commit documentation | [x] | Primary commit: `2ef4326` (merged as `0a9f5b6` via squash on develop). This tracker-sync PR is the Step 6 finalization commit for the ticket file itself. |
| 6. Verify clean working tree | [x] | `git status` on `chore/tracker-sync-bug-prod-004-fu1-retry-finalize`: clean except untracked `.claude/scheduled_tasks.lock` (pre-existing runtime artifact, intentionally not tracked). |
| 7. Verify branch up to date | [x] | `git fetch origin develop && git merge-base --is-ancestor origin/develop HEAD` — branched from `0a9f5b6` (current develop HEAD), no divergence. |

---

*Ticket created: 2026-04-15*
