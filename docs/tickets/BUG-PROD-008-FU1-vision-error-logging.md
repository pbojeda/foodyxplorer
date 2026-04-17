# BUG-PROD-008-FU1 — OpenAI Vision errors logged as empty objects

**Status:** In Progress
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

## Context

BUG-PROD-008 was fixed (API key seeded into `api_keys` table). Auth now works, but the OpenAI Vision call itself fails. The user sees "No he podido identificar el plato" but **production logs show `"error":{}`** — making root cause diagnosis impossible.

This is a **logging visibility bug**, not a feature bug. The underlying Vision failure is a separate issue that can only be diagnosed once this logging fix is deployed.

## Investigation

### Symptoms

1. Photo upload in `/hablar` → "No he podido identificar el plato. Intenta con otra foto."
2. Render logs show: `{"level":40,"error":{},"msg":"OpenAI vision call failed"}`
3. Response time ~600ms (real Vision calls take 3-8s → immediate rejection by OpenAI)
4. `OPENAI_API_KEY` IS set on Render prod (user confirmed)

### Root Cause

**Pino cannot serialize OpenAI SDK Error subclasses.** The OpenAI SDK throws `APIError` instances whose custom properties (`status`, `code`, `type`) are non-enumerable. When pino runs `JSON.stringify()` on them, it produces `{}`.

**Code path** (`packages/api/src/lib/openaiClient.ts`):

```typescript
// Line 204-206 — catch block in callVisionCompletion
} catch (error) {
  if (!isRetryableError(error)) {
    logger?.warn({ error }, 'OpenAI vision call failed');  // ← error serialized as {}
    return null;
  }
}
```

This pattern repeats in 6 catch blocks: `callVisionCompletion` (2), `callChatCompletion` (2), `callWhisperTranscription` (2).

### Why this wasn't caught earlier

- Vision/Whisper features were added post-BUG-PROD-001 but never tested end-to-end in prod with a failing OpenAI key
- The `{ error }` pattern works fine for plain objects and standard Errors, but not for SDK Error subclasses
- No unit tests exercised the error logging path with realistic OpenAI error objects

## Acceptance Criteria

- [x] **AC1**: New `serializeOpenAIError(error)` helper extracts `message`, `name`, `status`, `code`, `type` from OpenAI SDK errors into a plain object
- [x] **AC2**: All 6 error logging sites in `openaiClient.ts` use the serializer instead of raw `{ error }`
- [x] **AC3**: Unit test proves serialization works for OpenAI-style errors (non-enumerable properties)
- [x] **AC4**: Unit test proves serialization works for plain Error objects (fallback)
- [x] **AC5**: Unit test proves serialization works for non-Error values (string, null, undefined)
- [x] **AC6**: TypeScript compiles cleanly (`npx tsc --noEmit`)
- [x] **AC7**: No test regressions

## Implementation Plan

### File changes

| File | Change |
|------|--------|
| `packages/api/src/lib/openaiClient.ts` | Add `serializeOpenAIError()` export + update 6 catch blocks |
| `packages/api/src/lib/__tests__/openaiErrorSerializer.test.ts` | New test file: 3+ test cases for the serializer |
| `docs/project_notes/bugs.md` | Add BUG-PROD-008-FU1 entry |

### TDD plan

1. **RED**: Write tests for `serializeOpenAIError()` — OpenAI-style error (non-enumerable props), plain Error, non-Error value
2. **GREEN**: Implement `serializeOpenAIError()` + apply to 6 call sites
3. **REFACTOR**: None expected (minimal change)

### Constraints

- Minimal change — do NOT refactor retry logic, error handling flow, or anything else
- The helper must handle any `unknown` input safely (prod error logging must never throw)
- Do NOT change the behavior of `callVisionCompletion` / `callChatCompletion` / `callWhisperTranscription` — only the logging output

## Definition of Done

- [x] All AC met
- [x] Tests pass (RED → GREEN confirmed)
- [x] TypeScript clean
- [x] `bugs.md` updated
- [ ] PR created to develop
- [ ] PR synced to main

## Workflow Checklist

- [x] Step 1: Triage (High, Path B)
- [x] Step 2: Ticket created (this file)
- [x] Step 3: Branch + TDD (RED → GREEN)
- [x] Step 4: Validate (production-code-validator PASS)
- [ ] Step 5: Document + commit + PR
- [ ] Step 6: Deploy + verify logs

## Completion Log

| Step | Date | Detail |
|------|------|--------|
| Triage | 2026-04-17 | High severity, Path B Standard. Investigation complete from prior session |
| Ticket | 2026-04-17 | Full spec with AC, plan, TDD strategy |
| TDD RED | 2026-04-17 | 3 tests written, all FAIL (serializeOpenAIError not exported yet) |
| TDD GREEN | 2026-04-17 | Helper implemented + 6 call sites updated. 3/3 tests PASS |
| Validate | 2026-04-17 | tsc clean, production-code-validator PASS (no security/debug issues) |
| Document | 2026-04-17 | bugs.md entry added, ticket updated |
