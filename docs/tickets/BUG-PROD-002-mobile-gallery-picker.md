# BUG-PROD-002: Mobile photo button forces camera, no gallery option

**Feature:** BUG-PROD-002 | **Type:** Frontend-Bugfix | **Priority:** P2 (UX)
**Status:** Ready for Merge | **Branch:** bug/BUG-PROD-002-mobile-gallery-picker
**Created:** 2026-04-12 | **Dependencies:** None

---

## Spec

### Description

On mobile, tapping the photo button at `/hablar` opens the native camera directly with no way to choose an existing photo from the gallery. Expected behavior per the user report:

> Al pulsar el botón de la cámara, en el móvil debería o de darme a elegir la opción para elegir entre imagen desde la cámara de fotos o imagen desde la galería; en otro caso, si al darle al botón de la cámara se abriera directamente la cámara de fotos, dentro de esa pantalla debería aparecer la opción nativa de ir a la galería.

### Root cause

`packages/web/src/components/PhotoButton.tsx:67` sets `capture="environment"` on the hidden `<input type="file">`. On iOS Safari and most Android browsers this attribute is a **hint that forces** the file input to open the native camera app directly, bypassing the "Take Photo / Photo Library / Browse" chooser that the browser would otherwise show. There is no in-camera "go to gallery" button on iOS — the only way out is to cancel.

### Fix

Remove the `capture="environment"` attribute entirely. With just `accept="image/jpeg,image/png,image/webp"` the browsers will:
- **iOS Safari:** show the native action sheet with "Tomar foto o vídeo / Foto de la fototeca / Seleccionar archivos"
- **Android Chrome:** show "Cámara / Galería / Archivos"
- **Desktop:** unchanged — continue to show the file picker (the `capture` attribute is already ignored on desktop)

This is a one-line code change plus a test update.

### Out of scope

- Changing `accept` — leave the current MIME whitelist untouched; HEIC support is a separate conversation.
- Adding a second button labelled "Galería" — native browser chooser is enough.
- `Permissions-Policy: camera=()` — flagged as BUG-QA-006 (P2, unverified). It does not affect `<input capture>` flows.

### Edge cases

- **Desktop regression check:** `capture` is already ignored on desktop per HTML spec. Removing it must not change desktop behavior.
- **Old Android WebViews:** some legacy WebViews honored `capture` more aggressively. Acceptable if they now show the chooser.
- **iOS Safari `image/webp`:** iOS 14+ supports WebP in `accept`. No change.

### Verification plan

- Unit test: assert the hidden `<input>` does NOT have a `capture` attribute.
- Regression: existing `HablarShell.photo.test.tsx` file-upload tests must still pass because they query the input by selector, not by its `capture` attribute.
- Manual post-merge: user opens `/hablar` on a phone, taps the photo button, confirms the chooser appears with both "Take Photo" and "Gallery" options.

---

## Implementation Plan

1. **Red:** flip the existing test in `PhotoButton.photo.test.tsx:65` to assert the input does NOT have `capture`. Confirm red.
2. **Green:** delete the `capture="environment"` line from `PhotoButton.tsx:67`.
3. **Quality gates:** `npm test -w @foodxplorer/web`, `npm run lint`, `npm run typecheck`, `npm run build`.
4. **Docs:** update `docs/user-manual-web.md` §6 to mention that the photo button on mobile now offers camera + gallery chooser.
5. **Commit, push, PR to develop, review, merge.**

---

## Acceptance Criteria

- [x] `PhotoButton.tsx` no longer sets `capture="environment"` on the hidden `<input type="file">`
- [x] Unit test asserts the input does NOT have a `capture` attribute
- [x] All existing `PhotoButton` / `HablarShell.photo` tests still pass
- [x] `accept` attribute unchanged (JPEG/PNG/WebP only)
- [x] `docs/user-manual-web.md` §6 updated to describe the new chooser behavior
- [x] Lint, typecheck, build all green for `@foodxplorer/web`

---

## Definition of Done

- [x] All acceptance criteria met
- [x] No linting errors
- [x] Build succeeds
- [x] Tracker updated
- [x] `bugs.md` updated with root cause + prevention
- [ ] Manual mobile verification scheduled post-merge (user action)

---

## Workflow Checklist

- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 3: Implementation with TDD (Simple — skip Steps 0/2)
- [x] Step 4: Quality gates pass
- [x] Step 5: code-review-specialist (Simple: qa-engineer skipped)
- [ ] Step 6: Ticket finalized, branch deleted, tracker updated (post-merge)

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-12 | Simple ticket created | One-line fix: remove `capture="environment"`. Test inversion. |

---

## Merge Checklist Evidence

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, AC, DoD, Workflow, Log, Evidence (Simple tier; no Plan needed) |
| 1. Mark all items | [x] | AC: 6/6, DoD: 5/6 (manual verification post-merge), Workflow: 1,3,4,5/6 |
| 2. Verify product tracker | [x] | Active Session: step 5/6 (Review), BUG-PROD-002 is active |
| 3. Update key_facts.md | [x] | N/A — no new models/endpoints/modules |
| 4. Update decisions.md | [x] | N/A |
| 5. Commit documentation | [x] | Same commit as code (Simple) |
| 6. Verify clean working tree | [x] | `git status`: clean (reported post-audit) |
| 7. Verify branch up to date | [x] | Branched from develop, no divergence |

---

*Ticket created: 2026-04-12*
