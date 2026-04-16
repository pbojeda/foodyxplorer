# BUG-PROD-005: Render excess build minutes (Option B — manual dashboard build filters)

**Feature:** BUG-PROD-005 | **Type:** Infra-Bugfix | **Priority:** Medium
**Status:** Done | **Branch:** bugfix/BUG-PROD-005-render-build-filters (deleted) + chore/tracker-sync-bug-prod-005-close (this PR)
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-04-16 | **Closed:** 2026-04-16 | **Dependencies:** None (Pipeline Issue 5 of the 9-issue production pipeline)

---

## Spec

### Description

Render was consuming more build minutes than expected on the free/paid plan. The four Render services (`nutrixplorer-api-dev` web/develop, `nutrixplorer-api-prod` web/main, `nutrixplorer-bot-dev` worker/develop, `nutrixplorer-bot-prod` worker/main) were rebuilding on every push to their tracked branch — including pushes that only touched unrelated paths (`docs/**`, other packages, Markdown, test files). The `render.yaml` Blueprint in the repo root already defines the correct `buildFilter` blocks per service, but those blocks only apply when a service is created via Blueprint. The user had created all four services manually via the Render dashboard (before `render.yaml` existed, or because the Blueprint flow was skipped), so the dashboard-side "Build Filters" field was empty and the Blueprint config was being ignored.

**Three options were evaluated** on 2026-04-16:

- **(a) Blueprint recreation** — delete all 4 services and recreate via `New Blueprint Instance`. Clean but invasive: env vars would need to be re-entered, the Render-managed Postgres / Redis / Upstash bindings would need to be reconnected, and the temporary downtime window is non-trivial for production.
- **(b) Manual dashboard config** — keep the existing services, fill in the "Build Filters" field on each service's Settings → Build & Deploy page with the exact paths from `render.yaml`. No downtime, no env var reconfiguration. Dashboard state diverges from Blueprint config (but `render.yaml` remains the canonical intent, documented as such).
- **(c) Accept-as-is** — no change. Rejected: cost was growing.

**User chose Option B** on 2026-04-16 and applied the config manually in the dashboard the same day. This ticket documents the full history, verifies empirically that the filter works, and updates project documentation.

### API Changes (if applicable)

N/A — infrastructure-only.

### Data Model Changes (if applicable)

N/A.

### UI Changes (if applicable)

N/A.

### Edge Cases & Error Handling

- **Dashboard state and `render.yaml` may drift.** `render.yaml` remains the canonical documentation of intent, but the live filter state is in the Render dashboard (per-service Settings → Build & Deploy → Build Filters). If the config is ever changed in one place, update the other. The `render.yaml` file was already correct pre-ticket — no edit needed.
- **Empirical verification only covers dev-branch services on this PR.** This PR merges to `develop`, so it can only test `nutrixplorer-api-dev` and `nutrixplorer-bot-dev` (both track `develop`). The `*-prod` filters track `main` and will only be exercised empirically on the next `develop → main` release merge. That release merge will include a wide file diff and is therefore expected to rebuild both prod services (correctly, because API + shared code will have changed).
- **Ignored-path coverage**: the Ignored Paths list includes `docs/**`, cross-package paths (`packages/bot/**` for API services, `packages/api/**` + `packages/scraper/**` for Bot services), `**/*.md`, and `**/*.test.ts`. A docs-only change exercises `docs/**` — the primary test vector.
- **`scraper/**` is included in API services but not in Bot services.** Rationale (empirically verified 2026-04-16): `packages/api/package.json` declares `"@foodxplorer/scraper": "^0.0.1"` as workspace dependency, and 6 files in `packages/api/src/` import from scraper (`routes/ingest/pdf.ts`, `routes/ingest/pdf-url.ts`, `routes/ingest/image.ts`, `routes/ingest/image-url.ts`, `routes/ingest/url.ts`, `ingest/nutritionTableParser.ts`). Scraper changes CAN affect the API Docker build → inclusion is justified, not defensive over-inclusion. If the API build ever becomes independent of scraper, this path can be removed.

---

## Implementation Plan

N/A — Simple task, Path A (Quick) per bug-workflow skill. No code changes. Two-PR pattern: (PR A) docs-only implementation PR (ticket + `bugs.md` + `key_facts.md` + `product-tracker.md`) that itself serves as the empirical test vector; (PR B) tracker-sync-close PR post-verification with Status → Done + all AC/DoD/Workflow checkboxes filled + Events tab evidence.

---

## Acceptance Criteria

- [x] AC1: Docs-only PR merged to `develop` **does NOT** trigger a rebuild of `nutrixplorer-api-dev` — **verified 2026-04-16**: PR #134 squash-merged at `2026-04-16T10:04:16Z` (merge commit `856f752`). Post-merge Render Events tab for `nutrixplorer-api-dev` showed latest event = `Deploy live for 7e7252c: docs: finalize BUG-PROD-007 ticket Step 6 post-merge (#133)` (Madrid time 10:39, corresponding to the PR #133 deploy earlier in the day). **NO new event for `856f752`** → filter suppressed build as designed, `docs/**` + `**/*.md` Ignored Paths evaluated correctly.
- [x] AC2: Docs-only PR merged to `develop` **does NOT** trigger a rebuild of `nutrixplorer-bot-dev` — **verified 2026-04-16**: same user inspection showed latest Events entry = `Deploy live for 7e7252c (PR #133)` (Madrid time 10:37). **NO new event for `856f752`** → filter suppressed build.
- [x] AC3: `render.yaml` `buildFilter` configuration matches the dashboard-applied filters — user copy-pasted the exact paths from `render.yaml` lines 22-32 (api-dev), 43-53 (api-prod), 64-74 (bot-dev), 85-95 (bot-prod) into each service's dashboard Settings → Build & Deploy → Build Filters field. No drift.
- [x] AC4: `key_facts.md` Infrastructure section documents the final Render configuration — rewritten in PR #134 (`1d7911e` → merged as `856f752`). Sections now include: 4-service map (`nutrixplorer-{api,bot}-{dev,pro}`), filter mapping per service type (Included + Ignored paths), "always use Blueprint flow for new services" operational rule.
- [x] AC5: `product-tracker.md` Pipeline Issue 5 marked DONE with merge commit reference — updated in this tracker-sync PR (B) with merge commit `856f752` citation and Events tab evidence.
- [x] AC6: `bugs.md` entry captures discovery → investigation → 3 options → choice → verification — added in PR #134 (`856f752`). Status line updated in this tracker-sync PR (B) to reflect resolved state with empirical verification.
- [x] AC7: Prod services (`*-prod`) filters remain untested on the dev-services PR — explicitly called out in ticket Edge Cases (line 39) as deferred verification, not a blocker. Will be empirically validated on next `develop → main` release merge. **Bonus confirmation collected 2026-04-16**: user inspected `nutrixplorer-pro` + `nutrixplorer-bot-pro` Events tabs — both still show last deploy = `bf2b9b5` (PR #127, 2026-04-15), confirming prod services are stable (no rogue deploys from the BUG-PROD-005 work).

---

## Definition of Done

- [x] Ticket file created (this file) — PR #134
- [x] `bugs.md` entry added — PR #134
- [x] `key_facts.md` Infrastructure section updated with Render configuration details — PR #134
- [x] `product-tracker.md` Active Session updated + Pipeline Issue 5 → DONE post-verification — PR #134 (Active Session to BUG-PROD-005 In Progress) + this tracker-sync PR (Active Session → None + Pipeline Issue 5 → DONE)
- [x] Branch `bugfix/BUG-PROD-005-render-build-filters` pushed, PR opened against `develop` — PR #134 opened, squash-merged at `856f752`, branch deleted local + remote
- [x] CI green on PR — PR #134 CI: `ci-success` SUCCESS, `test-shared/api/bot/scraper/landing/web` all SKIPPED (path-filter correct for docs-only), `Vercel – nutrixplorer` + `Vercel – foodyassistance` both SUCCESS
- [x] Post-merge: Render Events tab inspected for `api-dev` + `bot-dev` — user inspection 2026-04-16, no rebuild triggered for either dev service (latest Events entry = PR #133 `7e7252c`, NOT PR #134 `856f752`)
- [x] Ticket Status → `Done` (via tracker-sync PR after empirical verification) — this PR (B)

---

## Workflow Checklist

<!-- Simple tier: Steps 1, 3, 4, 5, 6 only -->

- [x] Step 1: Branch `bugfix/BUG-PROD-005-render-build-filters` created from develop at `7e7252c`, ticket generated, tracker Active Session updated in PR #134
- [x] Step 3: Docs updated in PR #134 (ticket + bugs.md + key_facts.md + tracker) — no code changes
- [x] Step 4: Quality gates — no code affected; CI `ci-success` acted as oracle. All test-* jobs correctly SKIPPED by path-filter (dorny/paths-filter), `ci-success` green.
- [x] Step 5: PR #134 opened, `code-review-specialist` skipped (docs-only, Simple tier, no production code). External user audit APPROVE. `/audit-merge` ran — FAIL-by-design on checks 1-5 (Status In Progress, checkboxes [ ]) because AC1/AC2 require post-merge verification. Explicit 2-PR plan documented in Implementation Plan and approved by user. Squash-merged at `856f752`.
- [x] Step 6: Post-verification tracker-sync PR (this PR) — ticket Status → Done + Completion Log finalized + Pipeline Issue 5 → DONE in tracker + Active Session → None. Branches cleaned up.

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-16 | Ticket created | Branch `bugfix/BUG-PROD-005-render-build-filters` from `develop` at `7e7252c` |
| 2026-04-16 | User applied Option B in Render dashboard | 4 services configured: `nutrixplorer-api-dev`, `nutrixplorer-api-prod` (displayed as `nutrixplorer-pro` in dashboard), `nutrixplorer-bot-dev`, `nutrixplorer-bot-prod` (displayed as `nutrixplorer-bot-pro`). Build Filters per service copy-pasted from `render.yaml` `buildFilter.paths` + `buildFilter.ignoredPaths` |
| 2026-04-16 | Docs PR #134 opened | Target `develop`. Branch `bugfix/BUG-PROD-005-render-build-filters`. Serves as empirical test (docs-only change). |
| 2026-04-16 | CI green | `ci-success` SUCCESS, all `test-*` SKIPPED (path-filter correct for docs-only), Vercel both SUCCESS |
| 2026-04-16 | External user audit | APPROVE with 3 non-blocker notes (NIT: mandatory follow-up PR + reminder; OBSERVATION: first audited use of bug-workflow skill; CLARIFICATION: verify scraper imports — empirically verified inclusion is justified, 6 API files import from scraper) |
| 2026-04-16 | `/audit-merge` ran | FAIL-by-design on checks 1-5 (Status In Progress, all checkboxes [ ]); PASS on 6-11. Explicit 2-PR plan endorsed by external auditor and documented in ticket. |
| 2026-04-16 | Squash-merged PR #134 | `856f752` on `develop` (fast-forward from `7e7252c`). Merged at `2026-04-16T10:04:16Z`. Branch deleted local + remote via `gh pr merge --delete-branch`. |
| 2026-04-16 | Empirical verification (user) | Render Events tab inspected for all 4 services. `nutrixplorer-api-dev`: last event `7e7252c` (PR #133) at 10:39 Madrid, NO event for `856f752`. `nutrixplorer-bot-dev`: last event `7e7252c` at 10:37 Madrid, NO event for `856f752`. `nutrixplorer-pro` + `nutrixplorer-bot-pro`: last event `bf2b9b5` yesterday (stable). **Option B CONFIRMED** on dev services. Prod services deferred to next release merge. |
| 2026-04-16 | Tracker-sync PR (this) | Branch `chore/tracker-sync-bug-prod-005-close` from `origin/develop` at `856f752`. Sets ticket Status → Done, marks all 7 AC / 8 DoD / 5 Workflow / 8 Merge Checklist rows with real evidence, updates `bugs.md` Status line, updates `product-tracker.md` Active Session → None + Pipeline Issue 5 → DONE. |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | All sections present: Spec, Implementation Plan (N/A Simple), Acceptance Criteria, Definition of Done, Workflow Checklist, Completion Log, Merge Checklist Evidence. SDD ticket template followed. |
| 1. Mark all items | [x] | AC: 7/7 with real evidence (Events tab citations + PR commit references). DoD: 8/8 with PR citations. Workflow: 5/5 (all Simple-tier steps complete). Merge Evidence: 8/8 (this row included). |
| 2. Verify product tracker | [x] | PR #134 set Active Session to BUG-PROD-005 In Progress. This tracker-sync PR sets Active Session → None + Pipeline Issue 5 → DONE with merge commit `856f752` and Events tab evidence. Both updates committed. |
| 3. Update key_facts.md | [x] | Infrastructure section rewritten in PR #134 (merged `856f752`) — 4-service map, filter mapping per service type, Blueprint flow operational rule. No further edit needed in this tracker-sync PR. |
| 4. Update decisions.md | [x] | N/A — Simple tier infra-only, no ADR required (Option B is operational choice, not architectural). Confirmed with bug-workflow skill Path A. |
| 5. Commit documentation | [x] | PR #134 (`856f752`) + this tracker-sync PR (`chore/tracker-sync-bug-prod-005-close`) |
| 6. Verify clean working tree | [x] | `git status` on `chore/tracker-sync-bug-prod-005-close` pre-commit: only the intended ticket + bugs.md + tracker changes staged. `.claude/scheduled_tasks.lock` pre-existing untracked (runtime artifact, per BUG-PROD-004-FU1-RETRY precedent). |
| 7. Verify branch up to date | [x] | Branched from `origin/develop` at `856f752` (current HEAD post PR #134 merge). `git merge-base --is-ancestor origin/develop HEAD` → UP TO DATE. |

---

*Ticket created: 2026-04-16. Closed: 2026-04-16.*
