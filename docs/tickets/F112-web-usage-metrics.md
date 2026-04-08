# F112: Web Assistant Usage Metrics

**Feature:** F112 | **Type:** Frontend | **Priority:** Medium
**Status:** In Progress | **Branch:** feature/F112-web-usage-metrics
**Created:** 2026-04-08 | **Dependencies:** F090 (done)

---

## Spec

### Description

Add client-side usage metrics tracking to the web assistant (`/hablar`). Create a lightweight analytics module that captures conversation events (query count, intent distribution, response times, error rates) and persists session-level aggregates to `localStorage`. Expose metrics via a `useMetrics()` hook for future dashboard/export use.

The module sends batched events via `navigator.sendBeacon` to a configurable endpoint on page unload. The endpoint defaults to disabled (`NEXT_PUBLIC_METRICS_ENDPOINT` unset) until a backend receiver is built.

No external analytics dependencies. No third-party scripts (CSP compliant). Privacy-first: no PII, no query text stored — only aggregate counts and timings.

---

## Implementation Plan

N/A — Simple task.

---

## Acceptance Criteria

- [x] `packages/web/src/lib/metrics.ts` exports `trackEvent()`, `getMetrics()`, `resetMetrics()`, `flushMetrics()`
- [x] Events tracked: `query_sent`, `query_success` (with intent + responseTimeMs), `query_error` (with errorCode), `query_retry`
- [x] `useMetrics()` hook returns current session metrics (reactive via useSyncExternalStore)
- [x] HablarShell instrumented: tracks query_sent, query_success, query_error, query_retry
- [x] Session metrics persisted to `localStorage` under `fxp_metrics` key
- [x] `flushMetrics()` uses `navigator.sendBeacon` when endpoint configured
- [x] No PII stored (no query text, no actorId in metrics)
- [x] All new code has unit tests (17 new tests, 2 suites)
- [x] All existing tests pass (150 total, all green)
- [x] Build succeeds (108kB first load)

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing (17 new, 150 total)
- [x] No linting errors
- [x] Build succeeds

---

## Workflow Checklist

- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 3: Implementation complete
- [x] Step 4: Quality gates pass, committed
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-08 | Step 1: Setup | Branch + lite ticket created |
| 2026-04-08 | Step 3: Implement | metrics.ts (4 exports + subscribe), useMetrics hook (useSyncExternalStore), HablarShell instrumented. 17 new tests |
| 2026-04-08 | Step 4: Finalize | 150 tests pass, lint clean, build OK (108kB) |

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

*Ticket created: 2026-04-08*
