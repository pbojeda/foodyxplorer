# F045: Landing — Critical Bug Fixes

**Feature:** F045 | **Type:** Frontend-Bugfix | **Priority:** High
**Status:** In Progress | **Branch:** feature/F045-landing-critical-fixes
**Created:** 2026-03-28 | **Dependencies:** None

---

## Spec

### Description

Fix all critical and important bugs discovered during the cross-model landing page audit (2026-03-28). These are blockers that must be resolved before driving any traffic to nutrixplorer.com.

**Bugs in scope** (from `docs/project_notes/bugs.md` and `docs/research/landing-audit-2026-03-28.md`):

| Bug ID | Issue | Severity |
|--------|-------|----------|
| BUG-LANDING-01 | Legal pages /privacidad, /cookies, /aviso-legal return 404 | Critical |
| BUG-LANDING-02 | og-image.jpg referenced in metadata but missing from public/ | Critical |
| BUG-LANDING-03 | #waitlist and #demo anchors don't exist in DOM | Important |
| BUG-LANDING-04 | Variant D hero empty — SearchSimulator not embedded | Critical |
| BUG-LANDING-05 | PostSimulatorCTA visible before user interaction | Important |
| BUG-LANDING-06 | animate-fadeIn vs animate-fade-in typo | Low |
| BUG-LANDING-07 | Missing suppressHydrationWarning on `<html>` | Important |
| BUG-LANDING-08 | JSON-LD SearchAction points to non-functional /?q= | Important |
| C4 (audit) | No canonical URL — 8 indexable duplicate URLs | Critical |

### API Changes

None — all fixes are in the landing package (packages/landing).

### Data Model Changes

None.

### UI Changes

#### BUG-LANDING-01: Legal pages (Critical)
Create three static pages:
- `src/app/privacidad/page.tsx` — Privacy Policy (GDPR/LOPD-GDD compliant)
- `src/app/cookies/page.tsx` — Cookie Policy (LSSI/GDPR compliant)
- `src/app/aviso-legal/page.tsx` — Legal Notice (LSSI compliant)

Each page: Server Component, shared layout with SiteHeader + minimal Footer, `<article>` semantic structure. Content in Spanish (user-facing). Must include: data controller identity, purpose, legal basis, retention period, rights (access/rectify/delete/portability), contact for exercising rights.

**Cookie Policy** specifics: list all cookies used (nx-cookie-consent in localStorage, nx-variant cookie, GA4 cookies if accepted), purpose of each, duration, how to revoke consent.

**Legal Notice** specifics: site owner identification (can use placeholder "[NOMBRE/RAZÓN SOCIAL]" for fields the user must fill), LSSI compliance statement.

#### BUG-LANDING-02: OG Image (Critical)
Generate a 1200x630 branded OG image at `public/og-image.jpg`. Must include:
- nutriXplorer logo/text
- Tagline: "Información nutricional de restaurantes en España"
- Botanical green palette (#2D5A27 primary)
- Clean, professional design suitable for social sharing

#### BUG-LANDING-03: Anchor IDs (Important)
- Add `id="waitlist"` to `WaitlistCTASection` root element
- Add `id="demo"` to `ProductDemo` section wrapper in page.tsx (all variant layouts)
- SiteHeader nav links (#demo, #como-funciona, #para-quien, #waitlist) must all resolve

#### BUG-LANDING-04: Variant D disabled (Critical)
Per ADR-012, Variant D is disabled until the hero is properly built (deferred to F048).
- Remove `'d'` from `VALID_VARIANTS` in `src/lib/ab-testing.ts`
- Remove `'d'` from the `Variant` type in `src/types/index.ts`
- Remove `VariantDLayout` from `page.tsx` and `case 'd'` from `getVariantLayout`
- Remove `HeroVariantD` from `HeroSection.tsx`
- Remove variant D dictionary entries from `src/lib/i18n/es.ts` (if any variant-specific copy exists)
- Update tests that reference variant `'d'`

#### BUG-LANDING-05: PostSimulatorCTA gating (Important)
In `SearchSimulatorWithCTA.tsx`, change `useState(true)` to `useState(false)` so PostSimulatorCTA only appears after user interacts with SearchSimulator.
- Wire `onSearch` or `onSelect` callback from SearchSimulator to set `hasInteracted(true)`

#### BUG-LANDING-06: Animation class typo (Low)
In `PostSimulatorCTA.tsx`, change `animate-fadeIn` to `animate-fade-in` (matching the keyframe defined in globals.css).

#### BUG-LANDING-07: Hydration warning (Important)
Add `suppressHydrationWarning` to the `<html>` tag in `src/app/layout.tsx`. The palette script sets `data-palette` before React hydrates, causing a mismatch.

#### BUG-LANDING-08: SearchAction removal (Important)
Remove the `potentialAction` (SearchAction) from `generateWebSiteSchema()` in `src/lib/seo.ts`. The /?q= parameter is not functional.

#### C4: Canonical URL (Critical)
Add `alternates.canonical` to the metadata export in `src/app/layout.tsx`:
```ts
alternates: {
  canonical: '/',
},
```
This tells Google that all variant/palette URL combinations should be treated as the same page.

### Edge Cases & Error Handling

- **Legal pages**: Must render correctly with and without JavaScript (Server Components, no client-side logic)
- **Variant D removal**: Any cookie with `nx-variant=d` should fall through to default variant `'a'` (already handled by `resolveVariant` since `'d'` won't be in VALID_VARIANTS)
- **OG image**: Verify the image is accessible at the production URL after deploy
- **PostSimulatorCTA**: Ensure the CTA appears on first search result display, not on typing in the input
- **Canonical URL**: Verify it works with metadataBase (should resolve to `https://nutrixplorer.com/`)

---

## Implementation Plan

### Existing Code to Reuse

- `SiteHeader` (`src/components/SiteHeader.tsx`) — import for legal page shared header
- `Footer` (`src/components/sections/Footer.tsx`) — import for legal page shared footer (needs `variant` prop; pass `'a'` as static default on legal pages)
- `getDictionary` (`src/lib/i18n/index.ts`) — used in legal pages to resolve footer dict
- `SearchSimulator` (`src/components/SearchSimulator.tsx`) — already has `onInteract?: () => void` callback wired at line 50; no changes needed
- `PostSimulatorCTA` (`src/components/features/PostSimulatorCTA.tsx`) — already accepts `show: boolean`; only the typo class needs fixing
- `resolveVariant` (`src/lib/ab-testing.ts`) — already falls back to `'a'` for unknown values; removing `'d'` from `VALID_VARIANTS` is the only change needed
- `generateWebSiteSchema` (`src/lib/seo.ts`) — just remove the `potentialAction` key
- `tailwind.config.ts` — `animate-fade-in` is the correct keyframe name; already defined in `globals.css` at line 48
- `metadata` export in `src/app/layout.tsx` — extend the existing `Metadata` object

---

### Files to Create

| Path | Purpose |
|------|---------|
| `src/app/privacidad/page.tsx` | Privacy Policy (Politica de privacidad) — Server Component, GDPR/LOPD-GDD content in Spanish |
| `src/app/cookies/page.tsx` | Cookie Policy (Politica de cookies) — Server Component, LSSI/GDPR content listing all cookies used |
| `src/app/aviso-legal/page.tsx` | Legal Notice (Aviso legal) — Server Component, LSSI site-owner identification |
| `public/og-image.jpg` | Static 1200x630 OG image asset in botanical green palette |
| `src/__tests__/legal-pages.test.tsx` | Tests for all three legal page routes — rendering, headings, key content |

---

### Files to Modify

| Path | Change |
|------|--------|
| `src/types/index.ts` | Remove `'d'` from `Variant` union type |
| `src/lib/ab-testing.ts` | Remove `'d'` from `VALID_VARIANTS` array |
| `src/lib/i18n/locales/es.ts` | Remove `d` entry from `variants` object |
| `src/lib/seo.ts` | Remove `potentialAction` key from `generateWebSiteSchema()` return value |
| `src/app/layout.tsx` | Add `suppressHydrationWarning` to `<html>`; add `alternates: { canonical: '/' }` to `metadata` |
| `src/app/page.tsx` | Remove `VariantDLayout` function; remove `case 'd'` from `getVariantLayout`; add `id="demo"` to every product-demo `<section>` wrapper in all variant layouts (A, C, D→deleted, F); add `id="waitlist"` to `WaitlistCTASection` wrapper in all variant layouts |
| `src/components/sections/WaitlistCTASection.tsx` | Add `id="waitlist"` to the root `<section>` element |
| `src/components/sections/HeroSection.tsx` | Remove `HeroVariantD` function and the `if (variant === 'd')` branch |
| `src/components/features/SearchSimulatorWithCTA.tsx` | Change `useState(true)` to `useState(false)` |
| `src/components/features/PostSimulatorCTA.tsx` | Change class `animate-fadeIn` to `animate-fade-in` |
| `src/__tests__/ab-testing.test.ts` | Remove test case `'returns "d" when searchParam is "d"'`; add test asserting `resolveVariant('d', undefined)` returns `'a'` |
| `src/__tests__/sections/HeroSection.test.tsx` | Remove test case `'renders variant D headline when variant="d"'` |
| `src/__tests__/page.test.tsx` | Remove test case `'renders HeroSection with variant d when searchParams.variant is "d"'`; add test asserting variant `d` resolves to `a` layout |
| `src/__tests__/SearchSimulatorWithCTA.test.tsx` | Update test `'initially shows PostSimulatorCTA'` — flip assertion: CTA must NOT be visible on initial render; add test asserting CTA appears after `onInteract` fires |

---

### Implementation Order

Each numbered step starts with the test (red), then the fix (green).

**Group 1 — One-liner quick wins (no new files)**

1. **BUG-LANDING-06 — Animation typo** (`PostSimulatorCTA.tsx`)
   - Test: In `src/__tests__/PostSimulatorCTA.test.tsx`, add a test that checks the container `div` has class `animate-fade-in` and does NOT have class `animate-fadeIn` when `show=true`. Use `container.firstChild` and `toHaveClass`.
   - Fix: In `PostSimulatorCTA.tsx`, change `animate-fadeIn` to `animate-fade-in` in the `className` string.

2. **BUG-LANDING-07 — suppressHydrationWarning** (`layout.tsx`)
   - No new test needed (attribute exists only in HTML output; existing build check suffices).
   - Fix: Add `suppressHydrationWarning` to the `<html>` tag in `src/app/layout.tsx`.

3. **C4 — Canonical URL** (`layout.tsx`)
   - No dedicated unit test needed; the `metadata` object is a static export verified at build time.
   - Fix: Add `alternates: { canonical: '/' }` inside the `metadata` export in `src/app/layout.tsx`.

4. **BUG-LANDING-08 — SearchAction removal** (`seo.ts`)
   - Test: In `src/__tests__/` (or inline with existing seo logic), add a unit test that calls `generateWebSiteSchema()` and asserts the returned object does NOT have a `potentialAction` key (use `not.toHaveProperty`).
   - Fix: Remove the `potentialAction` block from `generateWebSiteSchema()` in `src/lib/seo.ts`.

**Group 2 — Medium fixes (type + state changes)**

5. **BUG-LANDING-04 — Variant D removal (types + routing)**
   - Test (ab-testing): In `src/__tests__/ab-testing.test.ts`, change the existing `'returns "d" when searchParam is "d"'` test to assert `resolveVariant('d', undefined)` returns `'a'` (invalid variant falls back to default). Keep all other tests unchanged.
   - Fix types: In `src/types/index.ts`, remove `| 'd'` from `Variant` type.
   - Fix ab-testing: In `src/lib/ab-testing.ts`, remove `'d'` from `VALID_VARIANTS`.
   - Fix i18n: In `src/lib/i18n/locales/es.ts`, remove the `d: { hero: { ... } }` block from `variants`.
   - Fix HeroSection: In `src/components/sections/HeroSection.tsx`, remove the `if (variant === 'd')` branch and the `HeroVariantD` function and its types (`VariantDCopy`, `VariantDProps`).
   - Fix page.tsx: In `src/app/page.tsx`, remove `VariantDLayout` function and `case 'd':` from `getVariantLayout`.
   - Test (HeroSection): In `src/__tests__/sections/HeroSection.test.tsx`, delete the test `'renders variant D headline when variant="d"'`. TypeScript will flag passing `variant="d"` anyway after the type change.
   - Test (page): In `src/__tests__/page.test.tsx`, replace the `'renders HeroSection with variant d when searchParams.variant is "d"'` test with one that asserts: when `variant: 'd'` is passed as a searchParam, the rendered hero has `data-variant="a"` (fallback). Keep all other page tests.

6. **BUG-LANDING-05 — PostSimulatorCTA gating** (`SearchSimulatorWithCTA.tsx`)
   - Test: In `src/__tests__/SearchSimulatorWithCTA.test.tsx`, update `'initially shows PostSimulatorCTA'` to assert `screen.queryByText(/te gusta lo que ves/i)` is NOT in the document. Add a new test: simulate a dish select interaction using `userEvent` (click a dish chip or type + select) and then assert the CTA text IS in the document.
   - Fix: In `SearchSimulatorWithCTA.tsx`, change `useState(true)` to `useState(false)`. The `onInteract` prop is already passed to `SearchSimulator` and already calls `setHasInteracted(true)` — no further wiring needed.

**Group 3 — Anchor IDs**

7. **BUG-LANDING-03 — Anchor IDs** (`WaitlistCTASection.tsx`, `page.tsx`)
   - Test: In `src/__tests__/sections/WaitlistCTASection.test.tsx`, add a test asserting the root `<section>` has `id="waitlist"`. Use `container.querySelector('#waitlist')` and `not.toBeNull()`.
   - Fix WaitlistCTASection: Add `id="waitlist"` to the root `<section>` element (alongside the existing `aria-labelledby` and `data-section` attributes).
   - Fix page.tsx: In each variant layout function that renders the product-demo section (`VariantALayout`, `VariantCLayout`, `VariantFLayout` — D is already removed), add `id="demo"` to the `<section aria-label={dict.productDemo.headline}>` element. Do NOT add it to the `ProductDemoSection` shared helper to keep it explicit per layout.
   - Test (page): In `src/__tests__/page.test.tsx`, add a test that renders the page with variant `'a'` and asserts `container.querySelector('#demo')` and `container.querySelector('#waitlist')` are both present.

**Group 4 — OG Image**

8. **BUG-LANDING-02 — OG image** (static asset)
   - No test (binary asset; cannot be unit tested).
   - Fix: Create `public/og-image.jpg` as a static 1200x630 image. Approach: generate a simple SVG with nutriXplorer branding and tagline text, then export to JPG. The SVG must use: dark botanical green background (`#2D5A27`), white `nutriXplorer` wordmark in Inter Bold, tagline `"Información nutricional de restaurantes en España"` in white, and the brand orange accent (`#F97316`) for the `X` in the wordmark. Use an online tool, Figma export, or `sharp` CLI to convert SVG → JPG at 1200x630. Place the final file at `public/og-image.jpg`. Verify file size is under 300KB for fast social card loading.
   - Verification: After placing the file, check it renders correctly at `localhost:3000/og-image.jpg`.

**Group 5 — Legal pages (largest chunk)**

9. **BUG-LANDING-01 — Legal pages** (three new Server Component pages)
   - Test first: Create `src/__tests__/legal-pages.test.tsx`. For each of the three routes, write tests that:
     - Import the default export (Server Component, so `await LegalPage()` or render directly)
     - Assert the page renders a main heading (`<h1>`) with the expected Spanish title
     - Assert the presence of key legal sections by heading text (e.g., "Responsable del tratamiento", "Finalidad", "Derechos", "Cookies utilizadas")
     - Assert a back link to `/` is present (link with `href="/"`)
     - Assert `<article>` element is rendered
   - Fix: Create all three pages as pure Server Components (no `'use client'`):

   **`src/app/privacidad/page.tsx`** — Privacy Policy:
   - `export const metadata: Metadata` with `title: 'Política de privacidad | nutriXplorer'`, `robots: { index: false }` (legal pages should not rank)
   - `export default function PrivacidadPage()` — returns a minimal page layout: `<SiteHeader />`, `<main>`, `<article>` with semantic structure, `<MinimalFooter />` (or just a simple `<footer>` with a back link — see note below on shared layout)
   - Content sections (Spanish, `<h2>` headings): Responsable del tratamiento, Finalidad del tratamiento, Base jurídica, Plazos de conservación, Destinatarios, Derechos del interesado (acceso/rectificación/supresión/portabilidad/oposición), Cómo ejercer tus derechos (contact email: `privacidad@nutrixplorer.com` placeholder), Modificaciones de la política
   - Placeholder bracket text for fields the user must complete: `[NOMBRE COMPLETO]`, `[NIF/CIF]`, `[DIRECCIÓN]`

   **`src/app/cookies/page.tsx`** — Cookie Policy:
   - Same `metadata` pattern, `robots: { index: false }`
   - Content sections: Qué son las cookies, Cookies que utilizamos (table or list: `nx-cookie-consent` in localStorage — purpose: store consent, duration: 365 days, no expiry server-side; `nx-variant` cookie — purpose: A/B test assignment, duration: 7 days; if GA4 accepted: `_ga`, `_ga_*` — purpose: analytics, duration: 2 years / session), Cookies de terceros, Cómo gestionar tus cookies (instrucciones de revocación: click on cookie banner re-trigger link, or clear browser cookies), Más información

   **`src/app/aviso-legal/page.tsx`** — Legal Notice:
   - Same `metadata` pattern, `robots: { index: false }`
   - Content sections: Titular del sitio web (with `[NOMBRE/RAZÓN SOCIAL]`, `[NIF/CIF]`, `[DIRECCIÓN]` placeholders), Actividad, Propiedad intelectual e industrial, Exclusión de garantías y responsabilidad, Ley aplicable y jurisdicción

   **Shared layout note**: Do NOT create a new `src/app/(legal)/layout.tsx` — keep each page self-contained (import `SiteHeader` + a simple inline footer with a back link) to keep the scope small and avoid routing group complexity. The legal pages do not use the root layout's body scripts (palette, JSON-LD) so they are intentionally standalone.

---

### Testing Strategy

**Files to create:**
- `src/__tests__/legal-pages.test.tsx` — tests for all three legal routes

**Files to update:**
- `src/__tests__/ab-testing.test.ts` — update variant D test + add regression for `d` → `a` fallback
- `src/__tests__/sections/HeroSection.test.tsx` — remove variant D test
- `src/__tests__/page.test.tsx` — replace variant D test with fallback test; add anchor ID assertions
- `src/__tests__/SearchSimulatorWithCTA.test.tsx` — flip initial CTA assertion; add post-interaction test
- `src/__tests__/PostSimulatorCTA.test.tsx` — add class name assertion for `animate-fade-in`

**Key test scenarios:**

| Scenario | File | What to assert |
|----------|------|----------------|
| `resolveVariant('d', undefined)` returns `'a'` | `ab-testing.test.ts` | Removed from valid variants |
| `resolveVariant(undefined, 'd')` (cookie) returns `'a'` | `ab-testing.test.ts` | Cookie `d` also invalid |
| HeroSection does not accept `variant="d"` | TypeScript (compile-time) | TS error if attempted |
| Page with `?variant=d` renders variant A layout | `page.test.tsx` | `data-variant="a"` on hero |
| `#demo` anchor exists in page DOM | `page.test.tsx` | `container.querySelector('#demo')` not null |
| `#waitlist` anchor exists in page DOM | `page.test.tsx` | `container.querySelector('#waitlist')` not null |
| PostSimulatorCTA hidden on initial render | `SearchSimulatorWithCTA.test.tsx` | Text not in DOM |
| PostSimulatorCTA visible after `onInteract` | `SearchSimulatorWithCTA.test.tsx` | Text in DOM after interaction event |
| PostSimulatorCTA uses correct animation class | `PostSimulatorCTA.test.tsx` | `toHaveClass('animate-fade-in')` |
| `generateWebSiteSchema` has no potentialAction | new test in `seo.test.ts` or inline | `not.toHaveProperty('potentialAction')` |
| Legal page `/privacidad` renders `<h1>` | `legal-pages.test.tsx` | Heading content present |
| Legal page `/cookies` lists nx-cookie-consent | `legal-pages.test.tsx` | Text content check |
| Legal page `/aviso-legal` renders article | `legal-pages.test.tsx` | `<article>` in DOM |
| `WaitlistCTASection` root has `id="waitlist"` | `WaitlistCTASection.test.tsx` | `container.querySelector('#waitlist')` |

**Mocking strategy:**
- Legal page tests: mock `SiteHeader` and `Footer` (same pattern as `page.test.tsx`) to isolate content assertions
- Legal pages are Server Components — call `await PageComponent()` and then `render()` the result, same pattern used in `page.test.tsx`
- `SearchSimulatorWithCTA` interaction test: use `userEvent.setup()` + `userEvent.click()` on a dish chip to trigger `onInteract`; framer-motion is already mocked in that test file

---

### Key Patterns

- **Server Component pages**: No `'use client'` directive. Use `export const metadata: Metadata` at module level and `export default function Page()` returning JSX. Pattern reference: `src/app/page.tsx` (but simpler — no async, no cookies).
- **Anchor IDs**: Plain HTML `id` attributes on `<section>` elements, not `useId()` or refs. Pattern: `src/components/sections/ForWhoSection.tsx` (`id="para-quien"`) and `src/components/sections/HowItWorksSection.tsx` (`id="como-funciona"`).
- **Metadata extension**: Spread or extend the existing `metadata` object in `layout.tsx`. `alternates.canonical` resolves relative to `metadataBase`, so `'/'` → `https://nutrixplorer.com/`. Pattern: Next.js docs for `alternates`.
- **`suppressHydrationWarning`**: Prop on the JSX `<html>` element — not a string attribute. React will accept it as a boolean prop.
- **Variant type safety**: After removing `'d'` from `Variant`, TypeScript will surface any lingering references at compile time. Run `pnpm --filter landing build` (or `tsc --noEmit`) to catch them all before running tests.
- **OG image location**: Must be at `public/og-image.jpg` (not `public/images/`). The metadata `url: '/og-image.jpg'` resolves via `metadataBase` to the absolute URL.
- **Legal page footer**: Use `<Link href="/" className="...">← Volver al inicio</Link>` as a minimal footer. Avoid importing the full `Footer` component (it requires `variant` and `dict` props and renders a complex section with WaitlistForm).
- **`robots: { index: false }`** on legal pages: prevents search engines from indexing boilerplate legal text, per best practice.
- **Test environment**: Legal page tests should use `@jest-environment jsdom` (match the pattern in `page.test.tsx`). No Node-specific APIs needed.
- **Gotcha — `WaitlistCTASection` ID**: The section already has `id="waitlist-cta-heading"` on the inner `<h2>`. Add `id="waitlist"` to the outer `<section>` (not the heading). The SiteHeader links target `#waitlist`, not `#waitlist-cta-heading`.
- **Gotcha — `id="demo"` placement**: The `<section aria-label={dict.productDemo.headline}>` elements in `VariantALayout`, `VariantCLayout`, and `VariantFLayout` in `page.tsx` are the correct targets. The `ProductDemo` component itself is a child — do not add the ID to `ProductDemo.tsx` since it does not render a `<section>` root.
- **Gotcha — `SearchSimulatorWithCTA` test**: The existing test `'PostSimulatorCTA shows email-only form'` also implicitly assumes CTA is visible. After the fix, this test will also need to be updated to first trigger an interaction before asserting form presence.

---

## Acceptance Criteria

- [x] /privacidad, /cookies, /aviso-legal return 200 with GDPR-compliant content
- [x] og-image.jpg exists in public/ and is 1200x630
- [x] #waitlist scrolls to WaitlistCTASection, #demo scrolls to ProductDemo
- [x] Variant D is fully removed from code; `?variant=d` resolves to `'a'`
- [x] PostSimulatorCTA is hidden until user completes a search
- [x] `animate-fade-in` class is used (not `animate-fadeIn`)
- [x] `<html>` has `suppressHydrationWarning`
- [x] JSON-LD has no SearchAction
- [x] Canonical URL is set in metadata
- [x] All existing tests pass (updated for variant D removal) — 335 tests, 38 suites
- [x] New tests for legal page rendering — legal-pages.test.tsx + edge-cases.f045.test.tsx
- [x] Build succeeds with no TypeScript errors

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds
- [x] Specs reflect final implementation

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `frontend-planner` executed, plan approved
- [x] Step 3: `frontend-developer` executed with TDD
- [x] Step 4: `production-code-validator` executed, quality gates pass
- [x] Step 5: `code-review-specialist` executed
- [x] Step 5: `qa-engineer` executed (Standard)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-28 | Ticket created | 9 fixes: 4 Critical, 4 Important, 1 Low |
| 2026-03-28 | Spec self-reviewed | No gaps found |
| 2026-03-28 | Plan generated by frontend-planner | 9 steps in 5 groups |
| 2026-03-28 | Plan approved by user | — |
| 2026-03-28 | Implementation complete | 5 groups implemented with TDD |
| 2026-03-28 | Quality gates passed | 335 tests, 0 TS errors, ESLint clean, build OK |
| 2026-03-28 | Production validator | 1 critical found (variant D in API) — fixed |
| 2026-03-28 | Code review | Approve. 1 medium (accidental file deletion — restored). 0 critical |
| 2026-03-28 | QA | Verified. 22 edge-case tests added. 0 bugs. 1 pre-existing note (#para-quien) |
| 2026-03-28 | Review findings | Accepted: CR-M1 (restored file). Noted: CR-M2 (placeholders — intentional), CR-L1 (dead random param — pre-existing) |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Implementation Plan, AC, DoD, Workflow, Completion Log, Merge Checklist Evidence |
| 1. Mark all items | [x] | AC: 12/12, DoD: 6/6, Workflow: 7/8 (Step 6 pending) |
| 2. Verify product tracker | [x] | Active Session: step 5/6, Features table: 5/6 |
| 3. Update key_facts.md | [x] | N/A — no new endpoints, models, or schemas |
| 4. Update decisions.md | [x] | N/A — no new ADR (variant D removal already in ADR-012) |
| 5. Commit documentation | [x] | Commit: (see below) |
| 6. Verify clean working tree | [x] | `git status`: clean (after docs commit) |

---

*Ticket created: 2026-03-28*
