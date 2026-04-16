# BUG-PROD-005: Render excess build minutes (Option B — manual dashboard build filters)

**Feature:** BUG-PROD-005 | **Type:** Infra-Bugfix | **Priority:** Medium
**Status:** In Progress | **Branch:** bugfix/BUG-PROD-005-render-build-filters
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-04-16 | **Dependencies:** None (Pipeline Issue 5 of the 9-issue production pipeline)

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
- **`scraper/**` is included in API services but not in Bot services.** Rationale: the scraper shares TS types and utilities with the API build (see `render.yaml:25,44`). If at some point the API build becomes independent of scraper, this path can be removed. For now keep it to avoid build breaks.

---

## Implementation Plan

N/A — Simple task, Path A (Quick) per bug-workflow skill. No code changes. Single commit: ticket + `bugs.md` + `key_facts.md` + `product-tracker.md`.

---

## Acceptance Criteria

- [ ] AC1: Docs-only PR merged to `develop` **does NOT** trigger a rebuild of `nutrixplorer-api-dev` (verified post-merge in Render dashboard → Events tab)
- [ ] AC2: Docs-only PR merged to `develop` **does NOT** trigger a rebuild of `nutrixplorer-bot-dev` (same verification)
- [ ] AC3: `render.yaml` `buildFilter` configuration matches the dashboard-applied filters (verified by comparing `render.yaml` lines 21-32, 42-53, 63-74, 84-95 against dashboard Settings → Build & Deploy)
- [ ] AC4: `key_facts.md` Infrastructure section documents the final Render configuration (4 services, build filters applied manually, dashboard is authoritative, `render.yaml` is intent doc)
- [ ] AC5: `product-tracker.md` Pipeline Issue 5 marked DONE with merge commit reference
- [ ] AC6: `bugs.md` entry captures discovery → investigation → 3 options → choice → verification
- [ ] AC7: Prod services (`*-prod`) filters remain untested until next `develop → main` release merge — explicitly called out in ticket as deferred verification, not a blocker

---

## Definition of Done

- [ ] Ticket file created (this file)
- [ ] `bugs.md` entry added
- [ ] `key_facts.md` Infrastructure section updated with Render configuration details
- [ ] `product-tracker.md` Active Session updated + Pipeline Issue 5 → DONE post-verification
- [ ] Branch `bugfix/BUG-PROD-005-render-build-filters` pushed, PR opened against `develop`
- [ ] CI green on PR
- [ ] Post-merge: Render Events tab inspected for `api-dev` + `bot-dev` — no rebuild triggered
- [ ] Ticket Status → `Done` (via tracker-sync PR after empirical verification)

---

## Workflow Checklist

<!-- Simple tier: Steps 1, 3, 4, 5, 6 only -->

- [ ] Step 1: Branch `bugfix/BUG-PROD-005-render-build-filters` created from develop at `7e7252c`, ticket generated
- [ ] Step 3: Docs updated (this PR) — no code changes
- [ ] Step 4: Quality gates — no code affected; CI `ci-success` acts as oracle
- [ ] Step 5: PR opened; `code-review-specialist` skipped (docs-only, Simple tier, no production code)
- [ ] Step 6: Post-verification tracker-sync PR — ticket Status → Done + Completion Log finalized + Pipeline Issue 5 → DONE in tracker

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-16 | Ticket created | Branch `bugfix/BUG-PROD-005-render-build-filters` from `develop` at `7e7252c` |
| 2026-04-16 | User applied Option B in Render dashboard | 4 services configured: `nutrixplorer-api-dev`, `nutrixplorer-api-prod`, `nutrixplorer-bot-dev`, `nutrixplorer-bot-prod`. Build Filters per service copy-pasted from `render.yaml` `buildFilter.paths` + `buildFilter.ignoredPaths` |
| 2026-04-16 | Docs PR opened | This PR — serves as empirical test (docs-only change; `api-dev` + `bot-dev` should NOT rebuild) |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | Sections: Spec, Implementation Plan (N/A Simple), Acceptance Criteria, Definition of Done, Workflow Checklist, Completion Log, Merge Checklist Evidence |
| 1. Mark all items | [ ] | AC: 0/7, DoD: 0/8, Workflow: 0/5. Will be filled post-verification. |
| 2. Verify product tracker | [ ] | Active Session set to BUG-PROD-005 In Progress in this PR. Pipeline Issue 5 will be marked DONE in the follow-up tracker-sync PR after empirical verification. |
| 3. Update key_facts.md | [ ] | Infrastructure section updated in this PR |
| 4. Update decisions.md | [ ] | N/A — Simple tier infra-only, no ADR required (Option B is operational choice, not architectural) |
| 5. Commit documentation | [ ] | This PR |
| 6. Verify clean working tree | [ ] | Will verify with `git status` before commit |
| 7. Verify branch up to date | [ ] | Branched from `origin/develop` HEAD `7e7252c` on 2026-04-16 |

---

*Ticket created: 2026-04-16*
