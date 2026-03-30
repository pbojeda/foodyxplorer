# F064: Accessibility & Code Cleanup Bundle

**Feature:** F064 | **Type:** Frontend-Bugfix | **Priority:** Low
**Status:** Ready for Merge | **Branch:** feature/F064-accessibility-code-cleanup
**Created:** 2026-03-30 | **Dependencies:** None
**Audit Source:** `docs/research/landing-audit-2026-03-28.md` — Findings S2, S9, S11 + post-audit review

---

## Spec

### Description

Bundle of 10 accessibility, security, and code cleanup fixes from the landing audit. Grouped into 4 categories.

**A. Accessibility (3 fixes)**

**A1: SearchSimulator `aria-selected` tied to wrong state**
`aria-selected` on listbox options uses `activeDish?.query === dish.query` (the last *selected* dish), not `activeIndex === index` (the keyboard-focused option). Per WAI-ARIA combobox spec, `aria-selected` must reflect the currently focused/highlighted option.

**Fix:** Change `aria-selected={activeDish?.query === dish.query}` to `aria-selected={activeIndex === index}` on line 204 of SearchSimulator.tsx.

**A2: Low-contrast text fails WCAG AA**
- `text-slate-400` on white background (SearchSimulator suggestion level text, line 211): contrast ratio ~3.0:1, below AA minimum 4.5:1.
- `text-white/45` on dark background (result card labels, lines 312, 320): contrast ratio ~2.8:1.

**Fix:** Replace `text-slate-400` with `text-slate-500` (4.6:1). Replace `text-white/45` with `text-white/70` (8.6:1).

**A3: MobileMenu accessibility improvements**
- Static `aria-label="Abrir menú"` doesn't change when menu is open (should say "Cerrar menú").
- No focus management: focus should return to the hamburger button when menu closes via Escape key.

**Fix:** Dynamic `aria-label={isOpen ? 'Cerrar menú' : 'Abrir menú'}`. Add `buttonRef` and call `buttonRef.current?.focus()` only when closing via Escape key. Do NOT move focus on outside click (user is moving to a new target) or on link click (navigation is happening).

**B. Security Hardening (2 fixes)**

**B1: Missing HSTS header**
Site is HTTPS-only (Vercel) but doesn't declare `Strict-Transport-Security`.

**Fix:** Add `{ key: 'Strict-Transport-Security', value: 'max-age=63072000' }` to next.config.mjs headers. No `includeSubDomains` (no subdomains exist) or `preload` (requires preload list submission — out of scope).

**B2: Missing CSP header**
No Content Security Policy. Start with report-only mode to avoid breaking anything.

**Fix:** Add `Content-Security-Policy-Report-Only` header with the following directives:
```
default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://www.google-analytics.com https://analytics.google.com; font-src 'self'; frame-src 'none'; object-src 'none'
```
Notes: `'unsafe-inline'` in script-src is needed for the palette injection script and JSON-LD blocks (both use `dangerouslySetInnerHTML`). `next/font/google` downloads fonts at build time, so `font-src 'self'` suffices. No `report-uri` (no Sentry or reporting endpoint configured yet — can be added later).

**C. Code Cleanup (3 fixes)**

**C1: Dead `ProductDemoSection` function in page.tsx**
Lines 38-52 define a standalone `ProductDemoSection` wrapper that is never called. Each variant layout has its own inline `<section>` wrapping `<ProductDemo />`.

**Fix:** Delete the unused function (lines 38-52).

**C2: Honeypot `readOnly` defeats anti-spam purpose**
WaitlistForm honeypot field has `value=""` + `readOnly`, making it impossible for bots to fill it. The JS fetch path also hardcodes `honeypot: ''`. The honeypot never catches anything.

**Fix:** Replace `value=""` + `readOnly` with `defaultValue=""` (uncontrolled). In the JS path, read the field value from the form instead of hardcoding.

**C3: Duplicate keyframes in globals.css**
`float` and `badge-pulse` are defined in both `globals.css` (raw @keyframes) and `tailwind.config.ts` (keyframes + animation). Tailwind config is the canonical source.

**Fix:** Delete the raw `@keyframes float` and `@keyframes badge-pulse` blocks from globals.css (lines 55-73).

**D. Minor UX (2 fixes)**

**D1: Missing `themeColor` in viewport metadata**
No theme-color meta tag, so mobile browser chrome uses default color.

**Fix:** Add `export const viewport: Viewport = { themeColor: '#2d5a27' }` to layout.tsx (Next.js 14 App Router requires a separate `viewport` export, not inside `metadata`). Import `Viewport` from `next`.

**D2: Unstable `lastModified` in sitemap.ts**
`lastModified: new Date()` generates a new timestamp on every request, causing unnecessary sitemap churn for crawlers.

**Fix:** Use a stable date constant: `const LAST_CONTENT_UPDATE = '2026-03-30'` with a comment `// Update when landing page content changes`. Use this in `lastModified: new Date(LAST_CONTENT_UPDATE)`.

### Files to Modify

| File | Change |
|------|--------|
| `packages/landing/src/components/SearchSimulator.tsx` | A1: aria-selected fix. A2: text-slate-400 → text-slate-500 |
| `packages/landing/src/components/MobileMenu.tsx` | A3: dynamic aria-label, focus management |
| `packages/landing/next.config.mjs` | B1: HSTS header. B2: CSP-Report-Only header |
| `packages/landing/src/app/page.tsx` | C1: delete dead ProductDemoSection |
| `packages/landing/src/components/features/WaitlistForm.tsx` | C2: fix honeypot to use defaultValue |
| `packages/landing/src/app/globals.css` | C3: delete duplicate keyframes |
| `packages/landing/src/app/layout.tsx` | D1: add themeColor |
| `packages/landing/src/app/sitemap.ts` | D2: stable lastModified date |

### Edge Cases & Error Handling

- **CSP-Report-Only**: Using report-only mode means nothing breaks even if the policy is too restrictive. Can be tightened in a future iteration.
- **HSTS**: 2-year max-age only (no `includeSubDomains` or `preload` — no subdomains exist, preload list submission is out of scope). Safe because Vercel is HTTPS-only.
- **Honeypot defaultValue**: Uncontrolled field with `defaultValue=""` allows bots to fill it. The server-side check (reject if non-empty) already exists.
- **Focus management**: `buttonRef.current?.focus()` only on Escape close (not outside click or link click). No-op if ref is null.
- **themeColor**: Only affects mobile browser chrome color. No functional impact.
- **Stable sitemap date**: Crawlers won't re-fetch content unnecessarily. Update the date when real content changes.

---

## Implementation Plan

### Existing Code to Reuse

**Components (modify in place — no new components needed):**
- `packages/landing/src/components/SearchSimulator.tsx` — Client Component (`'use client'`). Already has `activeIndex` and `activeDish` state. A1 fix is a one-liner on line 204. A2 requires two class replacements.
- `packages/landing/src/components/MobileMenu.tsx` — Client Component (`'use client'`). Already imports `useRef` from React. Already has `close` callback and `isOpen` state. A3 adds `buttonRef` to the existing `containerRef` pattern, and splits the Escape handler to call `buttonRef.current?.focus()` before `close()`.
- `packages/landing/src/components/features/WaitlistForm.tsx` — Client Component (`'use client'`). C2 replaces two attributes on the honeypot `<input>` and removes the hardcoded `honeypot: ''` from the fetch body.
- `packages/landing/src/app/layout.tsx` — Server Component. D1 adds a `viewport` export alongside the existing `metadata` export. Requires adding `Viewport` to the `next` import.
- `packages/landing/src/app/sitemap.ts` — Server Component. D2 replaces the `new Date()` inline call with a named constant.
- `packages/landing/src/app/page.tsx` — Server Component. C1 deletes lines 38-52 (the `ProductDemoSection` function).
- `packages/landing/src/app/globals.css` — C3 deletes lines 55-73 (raw `@keyframes float` and `@keyframes badge-pulse` blocks).
- `packages/landing/next.config.mjs` — B1 and B2 append two header objects to the existing headers array.

**Test suites to extend:**
- `packages/landing/src/__tests__/SearchSimulator.test.tsx` — extend for A1 (aria-selected) and A2 (contrast classes).
- `packages/landing/src/__tests__/MobileMenu.test.tsx` — extend for A3 (dynamic aria-label and focus-on-Escape).
- `packages/landing/src/__tests__/WaitlistForm.test.tsx` — extend for C2 (honeypot uncontrolled, fetch body reads form value).
- `packages/landing/src/__tests__/edge-cases.f048.test.tsx` — extend for B1/B2 security headers (following the pattern already in the `F048 — Security headers` describe block).

**Reference patterns:**
- `packages/landing/src/__tests__/edge-cases.f048.test.tsx` — shows how to dynamically import `next.config.mjs` and assert headers. Follow this pattern for B1/B2 tests.
- `packages/landing/src/__tests__/MobileMenu.test.tsx` — uses `userEvent.setup()` and `screen.getByRole('button', { name: /menú/i })`. The `buttonRef.focus()` assertion requires checking `document.activeElement`.

---

### Files to Create

None. All changes go into existing files.

---

### Files to Modify

| File | Changes |
|------|---------|
| `packages/landing/src/components/SearchSimulator.tsx` | A1: line 204 `aria-selected={activeDish?.query === dish.query}` → `aria-selected={activeIndex === index}`. A2: line 211 `text-slate-400` → `text-slate-500`. Lines 312 and 320 `text-white/45` → `text-white/70`. |
| `packages/landing/src/components/MobileMenu.tsx` | A3: add `buttonRef = useRef<HTMLButtonElement>(null)`. Change static `aria-label="Abrir menú"` to `aria-label={isOpen ? 'Cerrar menú' : 'Abrir menú'}`. Attach `ref={buttonRef}` to the hamburger `<button>`. In the Escape `useEffect`, guard on `isOpen` and call `buttonRef.current?.focus()` before `close()`. Do NOT add focus to outside-click or link-click handlers. |
| `packages/landing/next.config.mjs` | B1: append `{ key: 'Strict-Transport-Security', value: 'max-age=63072000' }`. B2: append `{ key: 'Content-Security-Policy-Report-Only', value: "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://www.google-analytics.com https://analytics.google.com; font-src 'self'; frame-src 'none'; object-src 'none'" }`. Both go inside the existing headers array for `source: '/(.*)'`. |
| `packages/landing/src/app/page.tsx` | C1: delete the `ProductDemoSection` function (lines 38-52, including the comment line above it). No import changes needed — `ProductDemo` is still used inline by the variant layout functions. |
| `packages/landing/src/components/features/WaitlistForm.tsx` | C2: on the honeypot `<input>`, remove `value=""` and `readOnly`, add `defaultValue=""`. In `handleSubmit`, replace `honeypot: ''` with `honeypot: (e.currentTarget.elements.namedItem('honeypot') as HTMLInputElement)?.value ?? ''`. |
| `packages/landing/src/app/globals.css` | C3: delete lines 55-73 — the `@keyframes float` block and the `@keyframes badge-pulse` block (both raw, outside any `@layer`). The keyframes remain available via `tailwind.config.ts`. |
| `packages/landing/src/app/layout.tsx` | D1: add `Viewport` to the existing `import type { Metadata } from 'next'` → `import type { Metadata, Viewport } from 'next'`. Add `export const viewport: Viewport = { themeColor: '#2d5a27' }` after the `metadata` export. |
| `packages/landing/src/app/sitemap.ts` | D2: add `const LAST_CONTENT_UPDATE = '2026-03-30'; // Update when landing page content changes` before the function. Replace `lastModified: new Date()` with `lastModified: new Date(LAST_CONTENT_UPDATE)`. |

---

### Implementation Order

Targeted TDD: write failing tests for behavior-changing fixes (A1, A2, A3, B1, B2, C2), then implement, then verify. Pure deletions (C1, C3) and metadata additions (D1, D2) are verified by existing tests + build — no dedicated RED phase needed for those.

**Phase 1 — RED (write all failing tests)**

1. `SearchSimulator.test.tsx` — add describe block `'F064 — A1/A2 aria-selected and contrast classes'`:
   - Test: keyboard ArrowDown highlights first option → `aria-selected={true}` on that `<li>`, `aria-selected={false}` on others.
   - Test: the highlighted option has `aria-selected="true"` even when it is not the last-selected dish (`activeDish`).
   - Test: suggestion level `<span>` has class `text-slate-500` (not `text-slate-400`).
   - Test: result card macro label has class `text-white/70` (not `text-white/45`). Use `document.querySelector` since classes are not ARIA attributes.

2. `MobileMenu.test.tsx` — add describe block `'F064 — A3 dynamic aria-label and focus management'`:
   - Test: hamburger button label is `'Abrir menú'` when menu is closed.
   - Test: hamburger button label changes to `'Cerrar menú'` after opening.
   - Test: hamburger button label reverts to `'Abrir menú'` after closing via Escape.
   - Test: pressing Escape returns focus to the hamburger button (`document.activeElement` equals the button).
   - Test: pressing Escape when menu is already closed does NOT move focus to the hamburger button.
   - Test: clicking outside the menu does NOT return focus to the hamburger button (assert focus is NOT on hamburger, not that it's on body — jsdom focus behavior varies).
   - Test: clicking a nav link does NOT return focus to the hamburger button.

3. `edge-cases.f048.test.tsx` — add describe block `'F064 — B1/B2 HSTS and CSP-Report-Only headers'` (after the existing `F048 — Security headers` block, reusing its `configHeaders` import pattern with a separate `beforeAll`):
   - Test: headers include `{ key: 'Strict-Transport-Security', value: 'max-age=63072000' }`.
   - Test: HSTS value does NOT contain `includeSubDomains`.
   - Test: HSTS value does NOT contain `preload`.
   - Test: headers include a `Content-Security-Policy-Report-Only` key.
   - Test: CSP-Report-Only value contains `default-src 'self'`.
   - Test: CSP-Report-Only value contains `https://www.googletagmanager.com`.
   - Test: CSP-Report-Only value contains `frame-src 'none'`.

4. `WaitlistForm.test.tsx` — add describe block `'F064 — C2 honeypot uncontrolled'`:
   - Test: honeypot input does NOT have `readOnly` attribute.
   - Test: honeypot input can be changed (type into it with userEvent, verify value changes — proves uncontrolled).
   - Test: when honeypot is filled with a non-empty value before submit, the POST body contains that non-empty value (proves JS path reads from form, not hardcoded).
   - Test: POST body honeypot value is `''` when submitted normally (honeypot untouched).
   - Note: the existing test `'includes honeypot field with empty string in POST body'` may need updating to match the new form reading pattern.

**Phase 2 — GREEN (implement)**

5. `SearchSimulator.tsx` — apply A1 fix (line 204), A2 fixes (lines 211, 312, 320).
6. `MobileMenu.tsx` — apply A3 fix (add `buttonRef`, dynamic `aria-label`, focus-on-Escape).
7. `next.config.mjs` — add HSTS and CSP-Report-Only headers (B1, B2).
8. `WaitlistForm.tsx` — fix honeypot: `defaultValue=""`, read from `e.currentTarget` in submit handler (C2).
9. `page.tsx` — delete dead `ProductDemoSection` function (C1).
10. `globals.css` — delete duplicate `@keyframes` blocks (C3).
11. `layout.tsx` — add `viewport` export with `themeColor` (D1).
12. `sitemap.ts` — add `LAST_CONTENT_UPDATE` constant, use it in `lastModified` (D2).

**Phase 3 — Quality gates**

13. Run `pnpm test` in `packages/landing` — all tests pass.
14. Run `pnpm lint` — no errors.
15. Run `pnpm build` — build succeeds.

---

### Testing Strategy

**Test files to extend (no new files):**

- `SearchSimulator.test.tsx` — add one new `describe` block after existing tests. Uses existing fake-timer setup and framer-motion mock. No new mocks needed.

- `MobileMenu.test.tsx` — add one new `describe` block. For the focus tests, assert `document.activeElement === screen.getByRole('button', { name: /cerrar/i })` after Escape. For the negative cases (outside click, link click), assert `document.activeElement !== screen.getByRole('button', { ... })`.

- `WaitlistForm.test.tsx` — add one new `describe` block. For the `readOnly` removal test, query the honeypot via `document.querySelector('input[name="honeypot"]')` and assert `.not.toHaveAttribute('readOnly')`. For the uncontrolled nature, assert the honeypot does not have a `value` attribute (it will have `defaultValue` in the DOM as the initial value but no `value` prop binding).

- `edge-cases.f048.test.tsx` — add a new `describe` block for B1/B2. The `beforeAll` pattern for importing `next.config.mjs` is already established in this file — replicate it with a separate module-scoped `configHeaders` variable for the new describe block to avoid coupling with the F048 block's `beforeAll`.

**Key test scenarios:**

- A1: `aria-selected` reflects keyboard focus (not last-selected dish). Verify at index 0, index 1, and after ArrowUp back to -1.
- A2: Class assertions on rendered DOM nodes via `document.querySelector`. Specifically target the `<span>` with level text and the macro label `<div>` elements.
- A3: Dynamic aria-label transitions: closed → `'Abrir menú'`, open → `'Cerrar menú'`, Escape close → `'Abrir menú'`. Focus assertion: after Escape, `document.activeElement` is the hamburger button. After outside click, focus is NOT on the hamburger button.
- B1/B2: Assert exact header objects in the config headers array.
- C2: Negative assertion that `readOnly` is absent. Positive assertion that POST body `honeypot` is `''` on clean submission.

**Mocking strategy:**

- No new mocks required. `SearchSimulator` tests: reuse existing framer-motion mock. `MobileMenu` tests: reuse existing `next/link` mock. `WaitlistForm` tests: reuse existing `fetch` mock and analytics mock.
- `edge-cases.f048.test.tsx` for B1/B2: dynamic `import()` of `next.config.mjs` (same as the existing F048 security headers block in that file).

---

### Key Patterns

**aria-selected fix (A1)** — `activeIndex === index` is the correct WAI-ARIA pattern for a combobox listbox. `activeDish?.query === dish.query` reflects the last *selected* item, which is wrong. After the fix, unselected options get `aria-selected={false}` and the keyboard-focused option gets `aria-selected={true}`. The existing tests in `edge-cases.f048.test.tsx` test `aria-activedescendant` but not `aria-selected` — the new tests close this gap.

**MobileMenu focus management (A3)** — The Escape `useEffect` currently calls `close()` directly. The fix must guard on `isOpen`: `if (event.key === 'Escape' && isOpen) { buttonRef.current?.focus(); close(); }`. This prevents Escape from moving focus when the menu is already closed. The order matters: focus the button before closing, so the browser doesn't need to guess where to restore focus. The outside-click `useEffect` must NOT be changed — clicking outside means the user moved elsewhere intentionally.

**Honeypot uncontrolled pattern (C2)** — Removing `value=""` + `readOnly` and using `defaultValue=""` makes the field uncontrolled. React will not reset it on re-render. The fetch body must read the live DOM value via `e.currentTarget.elements.namedItem('honeypot')` instead of hardcoding `''`. The critical test is the behavioral one: fill the honeypot with a non-empty value, submit, and verify the POST body contains that value. This directly proves the JS path reads from the form instead of hardcoding.

**themeColor as separate `viewport` export (D1)** — Next.js 14 App Router deprecated putting `themeColor` inside `metadata`. It must be a separate named `viewport` export of type `Viewport` from `'next'`. Putting it inside `metadata` generates a build warning. The existing `metadata` object is unchanged.

**CSP string quoting (B2)** — The exact CSP directive string from the spec must be used as-is. Note the single quotes around `'self'`, `'unsafe-inline'`, and `'none'` are required by the CSP spec and must appear as literal single quotes inside the JavaScript string value (use double quotes for the outer JS string).

**`'use client'` requirements** — `SearchSimulator.tsx` and `MobileMenu.tsx` already have `'use client'` at the top. `WaitlistForm.tsx` already has `'use client'`. No directive changes needed. `layout.tsx`, `sitemap.ts`, `page.tsx`, and `globals.css` are all server-side or static files — no directive needed.

**Test file structure** — New `describe` blocks must be appended after existing ones, not interleaved. Use the file-specific setup conventions already in each test file (fake timers in SearchSimulator, `userEvent.setup()` in MobileMenu, `mockFetch` in WaitlistForm).

**C3 globals.css cleanup** — After deleting lines 55-73, verify that `animate-float` and `animate-badge-pulse` CSS classes still work by confirming they are defined via Tailwind config (`packages/landing/tailwind.config.ts`). The `@layer utilities` reduced-motion block that references `.animate-float` and `.animate-badge-pulse` (lines 45-52) stays in place — it references the Tailwind-generated class names, not the raw keyframes.

---

## Acceptance Criteria

- [x] SearchSimulator `aria-selected` uses `activeIndex === index`
- [x] `text-slate-400` replaced with `text-slate-500` in SearchSimulator suggestions
- [x] `text-white/45` replaced with `text-white/70` in SearchSimulator result card
- [x] MobileMenu has dynamic `aria-label` (Abrir/Cerrar)
- [x] MobileMenu returns focus to hamburger on Escape key close
- [x] HSTS header present in next.config.mjs
- [x] CSP-Report-Only header present in next.config.mjs
- [x] Dead `ProductDemoSection` removed from page.tsx
- [x] Honeypot uses `defaultValue` instead of `value` + `readOnly`
- [x] Duplicate keyframes removed from globals.css
- [x] `themeColor` set via `viewport` export in layout.tsx
- [x] Sitemap uses stable `lastModified` date
- [x] All 659 tests pass (25 new F064 + 10 QA)
- [x] New tests verify key changes
- [x] Build succeeds
- [x] Lint clean

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing
- [x] Code follows project standards (TypeScript strict, no `any`)
- [x] No linting errors
- [x] Build succeeds
- [x] Specs reflect final implementation

---

## Workflow Checklist

- [x] Step 0: Spec reviewed (self-review + cross-model)
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `frontend-planner` executed, plan approved
- [x] Step 3: `frontend-developer` executed with TDD
- [x] Step 4: `production-code-validator` executed, quality gates pass
- [x] Step 5: `code-review-specialist` + `qa-engineer` executed
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-30 | Spec created | 10 findings from landing audit, 4 categories, 8 files |
| 2026-03-30 | Spec reviewed by Gemini + Codex | 2I+2S (Gemini) + 3I+2S (Codex). Fixed: CSP directives specified, HSTS simplified, themeColor via viewport export, focus only on Escape, sitemap constant |
| 2026-03-30 | Plan created | 3 phases, 15 steps, 8 files modified, 4 test suites extended |
| 2026-03-30 | Plan reviewed by Codex | 3I+2S. Fixed: Escape guard on isOpen, honeypot behavioral test (fill→submit→verify), targeted TDD scope, outside-click assertion standardized |
| 2026-03-30 | Implementation complete | TDD: 16 new tests RED then GREEN. 8 files modified. 53 test suites pass (649 tests). Lint clean. Build ok. |
| 2026-03-30 | Production validator | READY — 0 issues |
| 2026-03-30 | Code review | APPROVED — 1 fix (I1: extract honeypot before async). S1-S3 noted |
| 2026-03-30 | QA | VERIFIED — 10 edge-case tests, 0 bugs. 2 contrast debt items documented (out of scope) |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Plan, AC, DoD, Workflow, Log, Evidence |
| 1. Mark all items | [x] | AC: 16/16, DoD: 6/6, Workflow: 6/7 (Step 6 pending) |
| 2. Verify product tracker | [x] | Active Session: step 5/6, Features table: 5/6 |
| 3. Update key_facts.md | [x] | N/A — no new models, endpoints, or shared utilities |
| 4. Update decisions.md | [x] | N/A — no ADRs required |
| 5. Commit documentation | [x] | Commit: (this commit) |
| 6. Verify clean working tree | [x] | `git status`: clean after commit |

---

*Ticket created: 2026-03-30*
