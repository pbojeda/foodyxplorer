# BUG-PROD-008-FU1 — OpenAI Vision errors logged as empty objects

**Status:** Ready for Merge
**Type:** Bug (follow-up to BUG-PROD-008)
**Severity:** High
**Path:** B (Standard)
**Branch:** `bugfix/vision-error-logging`
**Affects:** Production — photo upload on web `/hablar` + Telegram bot

---

## Triage

| Dimension | Assessment |
|-----------|-----------|
| Severity | High — photo identification completely broken in prod, no way to diagnose |
| Urgency | Same day — blocks diagnosis of the underlying vision failure |
| Scope | All users uploading photos via web and bot |
| Complexity | Low — fix is additive (new serializer helper + 6 call site updates) |

## Root Cause

OpenAI SDK throws `APIError` subclasses whose custom properties (`status`, `code`, `type`) are non-enumerable. Pino's JSON serializer outputs `{}` for these. The pattern `logger?.warn({ error }, ...)` at 6 catch sites in `openaiClient.ts` all suffered from this.

Production evidence: `{"level":40,"error":{},"msg":"OpenAI vision call failed"}` — 600ms response (immediate rejection, not a real 3-8s vision call).

## Acceptance Criteria

- [x] **AC1**: New `serializeOpenAIError(error)` helper extracts `message`, `name`, `status`, `code`, `type`
- [x] **AC2**: All 6 error logging sites in `openaiClient.ts` use the serializer
- [x] **AC3**: Unit test — OpenAI-style errors (non-enumerable properties)
- [x] **AC4**: Unit test — plain Error objects (fallback)
- [x] **AC5**: Unit test — non-Error values (string, null, undefined)
- [x] **AC6**: TypeScript compiles cleanly
- [x] **AC7**: No test regressions

## Definition of Done

- [x] All AC met
- [x] Tests pass (RED → GREEN confirmed)
- [x] TypeScript clean
- [x] `bugs.md` updated
- [x] PR created to develop
- [ ] PR synced to main

## Workflow Checklist

- [x] Step 1: Triage (High, Path B)
- [x] Step 2: Ticket created
- [x] Step 3: Branch + TDD (RED → GREEN)
- [x] Step 4: Validate (production-code-validator PASS)
- [x] Step 5: Document + commit + PR
- [ ] Step 6: Deploy + verify logs

## Completion Log

| Step | Date | Detail |
|------|------|--------|
| Triage | 2026-04-17 | High severity, Path B Standard |
| TDD RED | 2026-04-17 | 3 tests fail (function not exported) |
| TDD GREEN | 2026-04-17 | Helper implemented + 6 call sites. 3/3 PASS |
| Validate | 2026-04-17 | tsc clean, production-code-validator PASS |
| Document | 2026-04-17 | bugs.md + ticket updated |
