# F051: Bot Rate-Limit Ordering & Failed-Request Handling

**Feature:** F051 | **Type:** Bug | **Priority:** High
**Status:** In Progress | **Branch:** feature/F051-bot-rate-limit-ordering
**Created:** 2026-03-29 | **Dependencies:** None
**Audit Source:** `docs/research/comprehensive-audit-2026-03-29.md` — Findings C1, I11

---

## Spec

### Description

Two rate-limiting issues found in the comprehensive cross-model audit:

**Bug 1 (C1 — CRITICAL): Rate limit check AFTER file download enables memory/bandwidth exhaustion**

In `callbackQuery.ts`, the `upload_menu` and `upload_dish` callback handlers download the full file from Telegram into a memory buffer BEFORE checking the per-user rate limit. An authorized user spamming the inline keyboard can force repeated file downloads without hitting the rate limit wall, potentially exhausting memory and bandwidth.

```
// Current flow (WRONG):
fileBuffer = await downloadTelegramFile(bot, ...);  // ← expensive, downloads file
const limited = await isRateLimited(redis, chatId);  // ← checked AFTER download
```

The comment in code explicitly notes: `// Per-user rate limit check (AFTER download, BEFORE API call per spec)`. The original spec assumed download was cheap, but in practice it's the most expensive step.

**Bug 2 (I11 — IMPORTANT): `/receta` rate limit counts failed API requests**

In `receta.ts`, the rate limit counter (`fxp:receta:hourly:{chatId}`) is incremented BEFORE the API call to `POST /calculate/recipe`. If the API returns an error (500, timeout, network error), the user loses a rate limit slot without getting a useful result. A user hitting intermittent API errors could exhaust their 5/hr limit without any successful results.

### Files to Modify

| File | Change |
|------|--------|
| `packages/bot/src/handlers/callbackQuery.ts` | Move `isRateLimited()` call BEFORE `downloadTelegramFile()` for both `upload_menu` and `upload_dish` handlers |
| `packages/bot/src/commands/receta.ts` | Decrement rate limit counter on API failure (or increment only on success) |

### Design Considerations

- **C1 fix**: Simple reorder. Move `isRateLimited()` check to immediately after `pendingPhotoFileId` validation, before any download. Rate-limited users should incur zero server cost.
- **I11 fix**: Two approaches:
  - *Option A (simpler)*: Increment counter only AFTER successful API response. Risk: a user with a script could fire many concurrent requests before any counter increments.
  - *Option B (safer)*: Keep increment before API call, but decrement on failure (`redis.decr`). Risk: decrement on network error could race with counter expiry.
  - **Recommended**: Option A — for a personal bot with ALLOWED_CHAT_IDS, the concurrent-request risk is negligible.

---

## Implementation Plan

N/A — Simple task.

---

## Acceptance Criteria

- [x] `upload_menu` callback: `isRateLimited()` is called BEFORE `downloadTelegramFile()`
- [x] `upload_dish` callback: `isRateLimited()` is called BEFORE `downloadTelegramFile()`
- [x] Rate-limited user triggers zero file downloads (verify via test that mock download is NOT called)
- [x] `/receta` does NOT consume a rate limit slot when the API call fails (500, timeout, network error)
- [x] `/receta` DOES consume a rate limit slot when the API call succeeds
- [x] All existing tests pass (no regressions) — 1078 total (1066 + 12 new)
- [x] New tests for each fixed behavior (12 tests in f051.rate-limit-ordering.test.ts)

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds (`tsc --noEmit`)

---

## Workflow Checklist

- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 3: TDD implementation (12 tests, RED→GREEN)
- [x] Step 4: Quality gates pass (1078 tests, tsc clean)
- [ ] Step 5: PR created, review
- [ ] Step 6: Ticket updated, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-29 | Ticket created | From comprehensive audit findings C1 (Gemini), I11 (Claude) |
| 2026-03-29 | Implementation | TDD: 12 tests (4 C1 + 8 I11). C1: reordered rate limit before download. I11: decrement counter on server/network errors. 1078 total passing |
| 2026-03-29 | Spec deviation | I11: Implemented Option B (decrement on failure) instead of recommended Option A (increment only on success). Option B avoids counter-going-negative race conditions on concurrent requests and is safer for fail-open Redis pattern |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | |
| 1. Mark all items | [ ] | |
| 2. Verify product tracker | [ ] | |
| 3. Update key_facts.md | [ ] | |
| 4. Update decisions.md | [ ] | |
| 5. Commit documentation | [ ] | |
| 6. Verify clean working tree | [ ] | |

---

*Ticket created: 2026-03-29*
