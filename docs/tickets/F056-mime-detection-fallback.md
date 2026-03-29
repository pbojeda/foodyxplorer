# F056: MIME Detection Fallback Safety

**Feature:** F056 | **Type:** Bug | **Priority:** Low
**Status:** Ready for Merge | **Branch:** `feature/F056-mime-detection-fallback`
**Created:** 2026-03-29 | **Dependencies:** None
**Audit Source:** `docs/research/comprehensive-audit-2026-03-29.md` — Finding S7

---

## Spec

### Description

In `callbackQuery.ts`, when `detectMimeType(fileBuffer)` returns null (magic byte detection fails for an unknown file format), the code silently defaults to `image/jpeg` with filename `photo.jpg`:

```typescript
const { mimeType, filename } = detected ?? { mimeType: 'image/jpeg', filename: 'photo.jpg' };
```

This means an unsupported file format would be sent to the API as JPEG, likely causing a downstream error with an unhelpful error message. The API validates the file server-side, but the error message won't help the user understand that the format is unsupported.

**Current `detectMimeType` supports**: JPEG (FF D8 FF), PNG (89 50 4E 47), WebP (RIFF...WEBP), PDF (%PDF).

### Files to Modify

| File | Change |
|------|--------|
| `packages/bot/src/handlers/callbackQuery.ts` | When `detectMimeType()` returns null in `upload_menu` and `upload_dish` handlers, return an error message to the user instead of defaulting to JPEG |

### Design Considerations

- The Telegram photo handler already pre-compresses to JPEG, so `handlePhoto` photos will virtually always match JPEG magic bytes. The null case is mainly theoretical for the photo path.
- For `handleDocument` (fileUpload.ts), MIME type comes from Telegram's own detection, not magic bytes — so this fallback doesn't apply there.
- The fix is simple: check if `detected` is null, send "Formato de imagen no soportado" and return.
- This is a defensive improvement, not a user-facing bug.

---

## Implementation Plan

N/A — Simple task.

---

## Acceptance Criteria

- [x] `upload_menu` handler: returns error message when `detectMimeType()` returns null
- [x] `upload_dish` handler: returns error message when `detectMimeType()` returns null
- [x] Error message is user-friendly in Spanish ("Formato de imagen no soportado. Envía una foto JPEG, PNG o WebP.")
- [x] Valid formats (JPEG, PNG, WebP, PDF) still work correctly
- [x] All existing tests pass (no regressions) — 1109 total (1106 + 3 new)
- [x] New tests: 3 in f056.mime-detection-fallback.test.ts

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds (`tsc --noEmit`)

---

## Workflow Checklist

- [x] Step 1: Branch created, ticket updated, tracker updated
- [x] Step 3: TDD implementation (3 tests, RED→GREEN)
- [x] Step 4: Quality gates pass (1109 tests, tsc clean)
- [x] Step 5: PR created, review
- [ ] Step 6: Ticket updated, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-29 | Ticket created | From comprehensive audit finding S7 (Claude, Gemini) |
| 2026-03-29 | Implementation | Replaced JPEG fallback with user-friendly error in upload_menu and upload_dish. 3 new tests, 1109 total passing |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Plan (N/A), AC, DoD, Workflow, Log, Evidence |
| 1. Mark all items | [x] | AC: 6/6, DoD: 5/5, Workflow: 4/5 (Step 6 pending) |
| 2. Verify product tracker | [x] | Active Session: step 5/6, Features table: 5/6 |
| 3. Update key_facts.md | [x] | N/A — no new endpoints or modules |
| 4. Update decisions.md | [x] | N/A — no ADR needed |
| 5. Commit documentation | [x] | Included in implementation commit |
| 6. Verify clean working tree | [x] | Clean after commit (untracked files are pre-existing) |

---

*Ticket created: 2026-03-29*
