# F063: Navigation, A/B Cookie & Variant Fixes

**Feature:** F063 | **Type:** Frontend-Bugfix | **Priority:** Medium
**Status:** In Progress | **Branch:** feature/F063-nav-ab-cookie-fixes
**Created:** 2026-03-29 | **Dependencies:** None
**Audit Source:** `docs/research/landing-audit-2026-03-29.md` — Findings I2, I6, S3

---

## Spec

### Description

Three issues around navigation consistency and cookie handling.

**Bug 1 (I2 — IMPORTANT): Nav link "Para quién" broken on variants C and F**

SiteHeader NAV_LINKS includes "Para quién" → `#para-quien`, but ForWhoSection (which has that id) only exists in Variant A. Variants C and F don't render it.

**Fix (Option B):** Replace "Para quién" with "FAQ" → `#faq`. FAQSection exists in all 3 variants. Add `id="faq"` to FAQSection's `<section>` element.

**Bug 2 (I6 — IMPORTANT): nx-variant cookie only written on consent accept**

Cookie policy describes `nx-variant` as "técnica, estrictamente necesaria" but it's only set in `handleAccept()` (line 49). Users who reject cookies get no variant cookie → inconsistent experience.

**Fix:** Write `nx-variant` cookie in the initial `useEffect` of CookieBanner (on mount, before any consent choice). Since it's strictly necessary per ePrivacy Directive Art. 5(3), no consent required.

**Bug 3 (S3 — SUGGESTION): nx-variant cookie missing Secure flag**

Cookie set without `Secure` attribute on HTTPS-only site.

**Fix:** Add `; secure` to the cookie string in both the mount write and the existing handleAccept write.

### Files to Modify

| File | Change |
|------|--------|
| `packages/landing/src/components/SiteHeader.tsx` | Replace "Para quién" (#para-quien) → "FAQ" (#faq) in NAV_LINKS |
| `packages/landing/src/components/sections/FAQSection.tsx` | Add `id="faq"` to section element |
| `packages/landing/src/components/analytics/CookieBanner.tsx` | Write nx-variant cookie on mount (useEffect), add `; secure` to all cookie writes |

### Edge Cases & Error Handling

- **No-JS**: Nav links are standard `<a>` anchors — work without JS.
- **Cookie on mount timing**: The `useEffect` runs client-side after hydration. The variant is already resolved server-side, so the first render is correct. The cookie just persists for next visit.
- **Secure flag on localhost**: `Secure` cookies are not sent over HTTP (localhost). For local dev, this means the variant cookie won't persist between page loads. This is acceptable — local dev uses `?variant=` URL params anyway.
- **Existing handleAccept cookie write**: Must also get `; secure` flag to stay consistent.

---

## Implementation Plan

### Files to Modify

| File | Changes |
|------|---------|
| `packages/landing/src/components/SiteHeader.tsx` | Change NAV_LINKS: "Para quién"→"FAQ", `#para-quien`→`#faq` |
| `packages/landing/src/components/sections/FAQSection.tsx` | Add `id="faq"` to `<section>` element |
| `packages/landing/src/components/analytics/CookieBanner.tsx` | Write nx-variant cookie on mount in useEffect, add `; secure` to all cookie writes |
| `packages/landing/src/__tests__/MobileMenu.test.tsx` | Update fixture NAV_LINKS to use FAQ/#faq |

### Test files to extend (no new test file — tests go in home suites)

| File | Changes |
|------|---------|
| `packages/landing/src/__tests__/SiteHeader.test.tsx` | Add: renders "FAQ" link with href="#faq", does NOT render "Para quién" |
| `packages/landing/src/__tests__/MobileMenu.test.tsx` | Update fixture NAV_LINKS to use "FAQ"/"#faq" instead of "Para quién"/"#para-quien" |
| `packages/landing/src/__tests__/sections/FAQSection.test.tsx` | Add: section element has id="faq" |
| `packages/landing/src/__tests__/CookieBanner.test.tsx` | Add: cookie set on mount (before consent), cookie includes "secure" |

### Implementation Order (TDD)

**Phase 1 — Tests first (RED)**

1. **Extend existing test files** with failing assertions:
   - `SiteHeader.test.tsx`: renders "FAQ" link with href="#faq", does NOT render "Para quién"
   - `MobileMenu.test.tsx`: update fixture NAV_LINKS to use "FAQ"/"#faq"
   - `FAQSection.test.tsx`: section element has `id="faq"`
   - `CookieBanner.test.tsx`: on mount, `document.cookie` is set with `nx-variant` + `secure`; handleAccept cookie includes `secure`

**Phase 2 — Implementation (GREEN)**

3. **`SiteHeader.tsx`** — Change NAV_LINKS entry: `{ label: 'FAQ', href: '#faq' }`

4. **`FAQSection.tsx`** — Add `id="faq"` to the `<section>` element (alongside existing `aria-labelledby` and `data-section` attributes)

5. **`CookieBanner.tsx`** — Two changes:
   a. In `useEffect` (mount), after reading stored consent, write variant cookie: `document.cookie = \`${VARIANT_COOKIE_NAME}=${variant}; max-age=${VARIANT_COOKIE_MAX_AGE}; path=/; samesite=lax; secure\``
   b. In `handleAccept`, add `; secure` to existing cookie write

**Phase 3 — Quality gates**

6. Full test suite → all 605+ pass
7. Lint → clean
8. Build → success

### Key Patterns

- **Cookie on mount**: Place cookie write INSIDE the existing `useEffect(() => { ... }, [])` after the consent check. Only write if the cookie doesn't already exist (`!document.cookie.includes(VARIANT_COOKIE_NAME)`). The variant prop is available (passed from page.tsx).
- **Secure flag**: Add `; secure` to both the mount write and the `handleAccept` write. This means the cookie won't persist on localhost HTTP, which is fine (URL params work for dev).
- **SiteHeader stays Server Component**: Only changing the static NAV_LINKS array — no `'use client'` needed.
- **MobileMenu**: Receives navLinks from SiteHeader as props — the change propagates automatically.

---

## Acceptance Criteria

- [ ] Desktop and mobile nav show "FAQ" instead of "Para quién"
- [ ] SiteHeader NAV_LINKS href is "#faq" (not "#para-quien")
- [ ] FAQSection has `id="faq"` attribute
- [ ] Clicking "FAQ" scrolls to FAQ section in all 3 variants
- [ ] `nx-variant` cookie is set on first page load (CookieBanner mount), before consent
- [ ] `nx-variant` cookie includes `; secure` flag in all writes
- [ ] All existing 605+ tests pass
- [ ] New tests verify:
  - [ ] SiteHeader renders "FAQ" link with href="#faq"
  - [ ] SiteHeader does NOT render "Para quién"
  - [ ] FAQSection section element has id="faq"
  - [ ] CookieBanner sets nx-variant cookie on mount
  - [ ] Cookie string includes "secure"
- [ ] Build succeeds
- [ ] Lint clean

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Unit tests written and passing
- [ ] Code follows project standards (TypeScript strict, no `any`)
- [ ] No linting errors
- [ ] Build succeeds
- [ ] Specs reflect final implementation

---

## Workflow Checklist

- [x] Step 0: Spec reviewed (self-review + cross-model)
- [x] Step 1: Branch created, ticket generated, tracker updated
- [ ] Step 2: Plan created, reviewed, approved
- [ ] Step 3: `frontend-developer` executed with TDD
- [ ] Step 4: `production-code-validator` executed, quality gates pass
- [ ] Step 5: `code-review-specialist` + `qa-engineer` executed
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-29 | Spec created | From landing audit findings I2, I6, S3 |
| 2026-03-30 | Worktree created | `../foodXPlorer-F063` from develop (SHA ef81906, includes F059-F061) |
| 2026-03-30 | Spec self-review | Verified CookieBanner current state post-F059/F060, edge cases added |
| 2026-03-30 | Plan created | 3 phases, 8 steps, 4 files modified |
| 2026-03-30 | Spec+plan reviewed by Gemini + Codex | 2I+2S. Fixed: MobileMenu test, dropped duplicate edge-cases file, conditional cookie write |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.**

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
