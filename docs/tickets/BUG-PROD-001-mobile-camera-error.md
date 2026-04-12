# BUG-PROD-001: Mobile photo upload always errors

**Feature:** BUG-PROD-001 | **Type:** Fullstack-Bugfix | **Priority:** P0 (Critical)
**Status:** In Progress | **Branch:** bug/BUG-PROD-001-mobile-camera-error
**Created:** 2026-04-12 | **Dependencies:** None

---

## Spec

### Description

On mobile, the photo flow at `/hablar` is 100% broken. When a user taps the camera button, takes a photo, and submits, the request **always** fails with a generic error. Desktop is unverified by the user but passing in CI. This is a core feature completely non-functional for mobile users (the majority of traffic).

**Why this matters:** photo analysis is one of two primary intents in `/hablar` (text + photo). Losing 100% of mobile photo flow kills conversion on the feature.

### Root cause analysis

Three interacting defects identified by code inspection; the primary one is deterministic and matches the "always errors" symptom:

1. **[PRIMARY — infrastructure limit]** Vercel Serverless Function request bodies are capped at **≈4.5 MB** on the Node runtime (Hobby + Pro default). The `/api/analyze` route handler (`packages/web/src/app/api/analyze/route.ts`) streams the multipart body to the upstream Fastify API, but the platform limit is enforced **before** the handler executes. Modern mobile photos (iPhone/Android JPEG from native camera) are routinely 3–8 MB — so the mobile photo flow hits this ceiling almost every time while the test suite (mocking `fetch`) never exercises it. Frontend has `MAX_FILE_SIZE = 10 MB` (`HablarShell.tsx:16`) and backend has `fastifyMultipart { fileSize: 10 MB }` (`app.ts:116`), so the illusion of a 10 MB ceiling is preserved, but the Vercel layer silently short-circuits the request before either limit is reached.

2. **[SECONDARY — error envelope mismatch]** `route.ts:19` returns `{ error: 'CONFIG_ERROR' }` (string) when `API_KEY`/`NEXT_PUBLIC_API_URL` is missing, but `apiClient.ts:229-232` parses `error.code` / `error.message` from a nested object. Any failure inside the proxy surfaces to the client as a generic `API_ERROR` → generic "No se pudo analizar la foto". This isn't the primary cause but it hides the real error from telemetry and from the user, preventing self-diagnosis.

3. **[SECONDARY — missing upstream timeout]** The proxy `fetch()` in `route.ts:58` has **no `AbortSignal.timeout`**. If upstream Fastify hangs, the proxy hangs until the Vercel function timeout (10 s on Hobby, 60 s default Pro). On slower mobile networks, a partial upload that gets to the function but stalls in forwarding manifests as an opaque network error after ~10 s.

### Fix approach

**Client-side image downscaling + error envelope normalization + upstream timeout.** All changes are localized to `packages/web`; no backend changes required.

#### 1. Client-side image resize (primary fix)

Before calling `sendPhotoAnalysis`, pipe the `File` through a canvas-based downscaler that:
- Preserves EXIF orientation (mobile photos often come back rotated if orientation is ignored).
- Caps the longest edge at **1600 px** (plenty for Vision API to read plate content).
- Re-encodes to **JPEG quality 0.82**.
- Target output: typically 0.3–1.5 MB regardless of input size.
- Leaves small files (<1.5 MB) untouched to avoid re-compressing clean uploads.
- Fails gracefully: if downscaling throws (OffscreenCanvas unsupported, decode error), fall back to the original file.

This approach avoids any backend or infra changes and works uniformly across iOS/Android browsers. It also solves a large class of future "upload fails on phone" bugs.

#### 2. Error envelope normalization in `route.ts`

Change the two early-return branches in `route.ts`:
- `CONFIG_ERROR`: `{ error: { code: 'CONFIG_ERROR', message: 'API key or upstream URL not configured' } }`
- `UPSTREAM_UNAVAILABLE`: `{ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Upstream API unreachable' } }`
- Add `UPSTREAM_TIMEOUT` branch when `AbortError` is caught from `fetch()`.

Matches the shape that `apiClient.ts:229-232` expects → HablarShell gets a specific code → user sees an actionable message.

#### 3. Upstream `AbortSignal.timeout` in `route.ts`

Add `signal: AbortSignal.timeout(65_000)` (matches client's 65 s hard timeout) to the upstream `fetch()`. Catch `TimeoutError` and return the new `UPSTREAM_TIMEOUT` envelope.

### Out of scope

- **Issue 2 (gallery picker / `capture="environment"`)** — handled in its own ticket per user's instruction. This ticket must not change `PhotoButton.tsx`'s `capture` attribute.
- **Removing `Permissions-Policy: camera=()`** — flagged in BUG-QA-006 as unverified. Current evidence suggests it's not the root cause of Issue 1 (the user can take a photo; the error is on send, not on camera access). Leave untouched.
- **HEIC support** — not causal when `capture="environment"` is present (Safari converts to JPEG on photo capture). Will be revisited under Issue 2.
- **Backend Fastify multipart limits** — already 10 MB; changing them doesn't help when the Vercel layer rejects first.

### Edge cases & error handling

- Small image (< 1.5 MB): skip resize, pass through.
- Non-standard mime (e.g. `image/*` empty type): resize may fail to decode → fall back to original file.
- `OffscreenCanvas` unavailable (older Safari): fall back to `HTMLCanvasElement`.
- Both canvas paths fail: fall back to original file (don't block the user).
- Downscaled blob still > 4.5 MB (extremely high-res panorama): second pass at 1200 px long edge.
- `AbortSignal.timeout` not available (< Node 18 / < Safari 16): the web flow only runs in modern browsers, but add feature detection: if unavailable, skip the upstream timeout and log a warning.

### Verification plan

Because I cannot reproduce on a physical mobile device from this session, the fix must be verified by:
1. A new unit test suite for the resize utility (jest-canvas-mock) covering: small file passthrough, large file downscale, unsupported file fallback, aborted promise.
2. Updated test for `route.ts` covering: `CONFIG_ERROR` envelope shape, `UPSTREAM_UNAVAILABLE` envelope shape, `UPSTREAM_TIMEOUT` envelope shape.
3. Updated test for `apiClient.photo.test.ts` asserting that `CONFIG_ERROR` and `UPSTREAM_TIMEOUT` are now parseable.
4. Updated test in `HablarShell.photo.test.tsx` asserting the resize utility is invoked before `sendPhotoAnalysis`.
5. **Manual post-merge verification** on a real mobile device by the user — the ticket Completion Log must record that step, and if it fails the ticket is reopened.

---

## Implementation Plan

### Files to modify

| # | File | Change |
|---|------|--------|
| 1 | `packages/web/src/lib/imageResize.ts` | **NEW** — `resizeImageForUpload(file): Promise<File>` |
| 2 | `packages/web/src/__tests__/lib/imageResize.test.ts` | **NEW** — unit tests for #1 |
| 3 | `packages/web/src/components/HablarShell.tsx` | Call `resizeImageForUpload` between validation and `sendPhotoAnalysis` |
| 4 | `packages/web/src/__tests__/components/HablarShell.photo.test.tsx` | Add test asserting resize is called |
| 5 | `packages/web/src/app/api/analyze/route.ts` | Error envelope normalization + `AbortSignal.timeout` |
| 6 | `packages/web/src/__tests__/app/api/analyze/route.test.ts` or equivalent | Add / update tests for envelope shape + timeout |
| 7 | `packages/web/src/lib/apiClient.ts` | No logic change (parser already expects nested shape); just verify tests |
| 8 | `docs/user-manual-web.md` §6 | Note that photos are auto-resized before upload (≤1600 px long edge, JPEG q82) |

### Execution steps

1. **Red — resize util:** write `imageResize.test.ts` with the 4 scenarios above. Confirm red.
2. **Green — resize util:** implement `imageResize.ts` using OffscreenCanvas first, HTMLCanvasElement fallback, with feature detection.
3. **Red — HablarShell:** add test asserting `sendPhotoAnalysis` receives the resized file for large inputs and the original for small inputs. Confirm red.
4. **Green — HablarShell:** wire `resizeImageForUpload` call between the existing client-side validation block (`HablarShell.tsx:136`) and the `sendPhotoAnalysis` call.
5. **Red — route.ts envelope:** update / add route handler test for `CONFIG_ERROR`, `UPSTREAM_UNAVAILABLE`, `UPSTREAM_TIMEOUT`. Confirm red on envelope shape assertions.
6. **Green — route.ts:** change `JSON.stringify` bodies + add `AbortSignal.timeout(65_000)` with `TimeoutError` catch branch.
7. **Verify apiClient parser:** run existing `apiClient.photo.test.ts`; if any test mocked the old string shape, update the mock.
8. **Quality gates:** `npm test -w @foodxplorer/web`, `npm run lint -w @foodxplorer/web`, `npm run typecheck -w @foodxplorer/web`, `npm run build -w @foodxplorer/web`.
9. **Docs:** update user manual §6 with resize note.
10. **Commit, push, PR.**

### Notes

- The canvas-based downscaler must be lazy-imported (`import('…')`) so that SSR doesn't break (no DOM on the server).
- EXIF orientation: modern browsers auto-apply orientation to `<img>` / `createImageBitmap`, so we don't need to parse EXIF manually as long as we use `createImageBitmap` (which respects orientation by default in Chromium/Safari 17+).
- For broader Safari 15 compatibility we pass `{ imageOrientation: 'from-image' }` to `createImageBitmap`.

---

## Acceptance Criteria

- [ ] New `imageResize.ts` utility exists with `resizeImageForUpload(file)` function
- [ ] Small images (< 1.5 MB) are returned unchanged
- [ ] Large images are resized so the longest edge is ≤ 1600 px and re-encoded as JPEG q≈0.82
- [ ] All resize error paths fall back to the original file (never block the user)
- [ ] `HablarShell.executePhotoAnalysis` calls `resizeImageForUpload` before `sendPhotoAnalysis`
- [ ] `route.ts` `CONFIG_ERROR`, `UPSTREAM_UNAVAILABLE`, and new `UPSTREAM_TIMEOUT` responses all use `{ error: { code, message } }` envelope
- [ ] `route.ts` upstream `fetch()` has a 65 s `AbortSignal.timeout`
- [ ] New unit tests cover the resize utility (≥ 4 tests)
- [ ] New route tests cover the 3 error envelopes (≥ 3 tests)
- [ ] Updated `HablarShell.photo.test.tsx` asserts resize call
- [ ] All existing tests still pass
- [ ] Lint, typecheck, build all green for `@foodxplorer/web`
- [ ] `docs/user-manual-web.md` §6 updated with resize note

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Unit tests written and passing
- [ ] Code follows project standards (TypeScript strict, no `any`)
- [ ] No linting errors
- [ ] Build succeeds
- [ ] `bugs.md` updated with root cause, fix, and prevention
- [ ] Tracker updated (Active Session + Features table)
- [ ] PR reviewed by `code-review-specialist` and `qa-engineer`
- [ ] Manual mobile verification scheduled post-merge (user action)

---

## Workflow Checklist

- [ ] Step 0: Spec written (self, with deep investigation)
- [ ] Step 1: Branch created, ticket generated, tracker updated
- [ ] Step 2: Implementation plan written (self, above)
- [ ] Step 3: Implementation with TDD
- [ ] Step 4: Quality gates pass, production-code-validator
- [ ] Step 5: code-review-specialist + qa-engineer
- [ ] Step 6: Ticket finalized, branch deleted, tracker updated

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-12 | Spec + plan written | Deep investigation via Explore agent + direct file reads. Primary root cause: Vercel 4.5 MB body limit. |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.**

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | Sections verified: (pending) |
| 1. Mark all items | [ ] | AC: _/_, DoD: _/_, Workflow: _/_ |
| 2. Verify product tracker | [ ] | Active Session: step _/6, Features table: _/6 |
| 3. Update key_facts.md | [ ] | N/A (no new models/endpoints) |
| 4. Update decisions.md | [ ] | N/A |
| 5. Commit documentation | [ ] | Commit: (pending) |
| 6. Verify clean working tree | [ ] | `git status`: (pending) |
| 7. Verify branch up to date | [ ] | (pending) |

---

*Ticket created: 2026-04-12*
