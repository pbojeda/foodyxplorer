# F-WEB-HISTORY-FU5: Playwright e2e infrastructure for TranscriptFeed scroll ACs

**Feature:** F-WEB-HISTORY-FU5 | **Type:** Frontend-Infrastructure (test infra, no production code change) | **Priority:** Medium (defense-in-depth — operator ACs become CI-enforceable instead of one-time browser smokes)
**Status:** Spec | **Branch:** _(to-be-created post-FU4 merge)_ — proposed `feature/web-playwright-e2e-transcript-feed`
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-06-03 | **Dependencies:** F-WEB-HISTORY-FU4 done (commit `f1a94fe` on `bugfix/web-feed-scroll-state-machine`)
**Research:** `docs/research/transcript-feed-scroll-architecture-2026-06-03.md` §7.5 R5 + §9.1
**Methodology:** development-workflow Standard tier, MANDATORY full Path B (cross-model on the fixture strategy choice).

---

## Spec

### Description

F-WEB-HISTORY-FU4 deferred Playwright e2e to this FU5 because the original fixture strategy proposed in the FU4 Plan was empirically found unworkable by `/review-plan` Codex CRITICAL-2:

- Supabase auth uses storage key `sb-<project-ref>-auth-token` with chunked base64url-encoded session JSON, NOT a single `sb-access-token` cookie. `@supabase/ssr` controls this key.
- Auth on `/hablar` is client-side via `AuthProvider` Supabase session events; not server-gated by middleware. Cookie injection alone doesn't satisfy `session?.access_token` checks in `useSearchHistory` + `apiClient.ts`.
- The originally proposed API mocks did not match real schemas: `getMe()` returns `{ success: true, data: { account, actor } }`; `getUsage()` returns `tier/resetAt/buckets`; `getHistory()` uses `?limit=10` not `cursor=null`, returns UUID `id`/`kind`/`queryText`/`resultData`/`createdAt`; `sendMessage()` wraps in `{ success: true, data: ... }` with `actorId`. Mock payloads would parse-fail at runtime.

This FU5 designs the Playwright fixture properly with its own cross-model review.

### Goals

1. **Add Playwright e2e infrastructure** to `packages/web`:
   - `@playwright/test` dev dep + `playwright.config.ts` + npm scripts (`test:e2e`, `test:e2e:install`).
   - GitHub Actions `test-web-e2e` job in `.github/workflows/ci.yml` required for `ci-success`.
2. **Implement 2 e2e specs** matching FU4 AC20-A + AC21:
   - `e2e/transcript-feed.append-card-visible.spec.ts` — AC20-A (append card fully visible above input bar).
   - `e2e/transcript-feed.loadmore-anchor-preserved.spec.ts` — AC21 (loadMore prepend preserves anchor entry).
3. **Choose + implement a viable fixture strategy** after cross-model review. Candidates:
   - **(A) Test-harness route** (`/test-harness/transcript-feed` build-time-gated) rendering TranscriptFeed in isolation with test-controllable props — bypasses auth + API entirely.
   - **(B) Real-schema route interception** with correct Supabase cookie key (`sb-<project-ref>-auth-token` chunked format) + real response shapes via `page.route()`.
   - **(C) Programmatic session injection** via `page.evaluate` + `supabase.auth.setSession()` to bypass cookie complexity.
4. **Cover the AC25 Slow-3G scenario** via `page.route().continue({ delay: ... })` to deterministically reproduce the shimmer→card growth race.
5. **CI integration**: job runs after `test-web` (Jest unit tests), requires `next build` + `next start` web server (or `next dev` if simpler), Playwright Chromium install + screenshot artifacts on failure.

### Out of scope

- Production code changes to TranscriptFeed.tsx or any other component (FU4 already shipped the state machine).
- Visual regression / snapshot testing (functional scroll behavior only — pixel diffs are a separate ticket).
- Cross-browser coverage beyond Chromium for v1 (Firefox + Safari added later if needed).
- Mobile viewport testing (defer to FU6 if relevant).

### Cross-model focus areas (for `/review-spec`)

When this FU5 enters its own SDD cycle, the cross-model review MUST evaluate:

1. **Fixture strategy choice (A vs B vs C)** — each has trade-offs: maintenance cost, realism, time to write, brittleness to Supabase / API schema changes. Cross-model must pick one with empirical justification.
2. **next start vs next dev** for the Playwright webServer — `next start` requires pre-build (slower) but tests prod artifacts; `next dev` is faster but tests dev-only behavior.
3. **CI job design** — sequential vs parallel with `test-web`; required for `ci-success` or advisory; trigger on docs-only PRs or skip.
4. **Test harness route gating** (if choice A) — build-time env flag vs runtime query-param vs separate Next.js project; security implications of accidentally shipping the harness to prod.

---

## Acceptance Criteria

_(To be populated post-FU4 merge when this FU5 enters its own Step 0 Spec. Skeleton ACs based on research doc §9.1 scope item 6.)_

### A — Playwright infrastructure

- [ ] **AC1.** `@playwright/test` added to `packages/web/devDependencies`.
- [ ] **AC2.** `packages/web/playwright.config.ts` exists with Chromium project, baseURL, retries, screenshot-on-failure.
- [ ] **AC3.** `packages/web/package.json` scripts: `test:e2e` + `test:e2e:install`.
- [ ] **AC4.** Fixture strategy chosen post-cross-model review (A / B / C) + documented in Plan.

### B — E2e specs

- [ ] **AC5.** `e2e/transcript-feed.append-card-visible.spec.ts` exists + passes locally + in CI.
- [ ] **AC6.** `e2e/transcript-feed.loadmore-anchor-preserved.spec.ts` exists + passes locally + in CI.
- [ ] **AC7.** AC25 Slow-3G scenario covered (route delay + assertion that card is fully visible after settle).

### C — CI integration

- [ ] **AC8.** `.github/workflows/ci.yml` `test-web-e2e` job exists + runs after `test-web` + required for `ci-success`.
- [ ] **AC9.** Job uploads screenshots/videos on failure as artifacts.

### D — Documentation

- [ ] **AC10.** `key_facts.md` documents Playwright as new infrastructure (first e2e for this repo).
- [ ] **AC11.** `docs/specs/ui-components.md` TranscriptFeed entry references the e2e specs as the canonical behavior gate.

---

## Definition of Done

- [ ] All A/B/C/D ACs marked `[x]`.
- [ ] Cross-model `/review-spec` + `/review-plan` both APPROVED with all findings applied (no MAJOR deferrals).
- [ ] PR opened with full SDD trail; CI green including new `test-web-e2e` job.
- [ ] Operator confirms the new CI job catches a deliberately-broken FU4 regression (sanity check: revert one FU4 commit + see e2e fail).
- [ ] `feedback_jsdom_layout_ac_gap` memory updated to note that Playwright e2e closes the gap for this AC class.

---

## Workflow Checklist

_(Standard 6-step workflow. Populated when this ticket enters its own SDD cycle.)_

- [ ] Step 0 Spec — flesh out ACs (this stub is the seed).
- [ ] Step 1 Setup — branch off develop, baseline gates.
- [ ] Step 2 Plan — fixture strategy decision (A/B/C) + cross-model.
- [ ] Step 3 Implement — install Playwright + write 2 specs + CI job.
- [ ] Step 4 Finalize — green gates including new CI job.
- [ ] Step 5 Review — code-review + qa + audit-merge.
- [ ] Step 6 Merge + closeout.

---

## Implementation Plan

_(To be populated in Step 2 after `/review-spec` sign-off.)_

---

## Completion Log

| Date | Step | Notes |
|------|------|-------|
| 2026-06-03 | Step 0 (stub) | Ticket file created as a hard pre-merge gate for F-WEB-HISTORY-FU4 per its DoD (defer Playwright owner decision 2026-06-03 post /review-plan CRITICAL-2). This is a SKELETON — Step 0 Spec flesh-out happens when FU5 enters its own SDD cycle. Created on branch `bugfix/web-feed-scroll-state-machine` as part of the FU4 fix-loop. |

---

## Merge Checklist Evidence

_(Populated when FU5 enters Step 5.)_
