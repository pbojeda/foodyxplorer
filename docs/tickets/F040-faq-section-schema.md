# F040: Landing Page FAQ Section + Schema

**Feature:** F040 | **Type:** Frontend-Feature | **Priority:** Medium
**Status:** Ready for Merge | **Branch:** feature/F040-faq-section-schema
**Created:** 2026-03-29 | **Dependencies:** F045 done

---

## Spec

### Description

Add an FAQ accordion section to the nutriXplorer landing page with FAQPage structured data (JSON-LD) for SEO. The FAQ addresses common questions about the product, data reliability, privacy, and scope — reducing friction for waitlist conversion.

The section renders as a collapsible accordion (one item open at a time) using native HTML `<details>`/`<summary>` elements for zero-JS progressive enhancement. Content is dictionary-driven (i18n `es.ts`), following the same pattern as all other sections.

A `FAQPage` JSON-LD schema is rendered on the page as an `application/ld+json` script alongside the existing WebSite and SoftwareApplication schemas, enabling Google rich results (FAQ snippet). If the FAQ items array is empty, neither the section nor the JSON-LD schema are rendered.

### API Changes (if applicable)

None — frontend only.

### Data Model Changes (if applicable)

None.

### UI Changes (if applicable)

**New component:** `FAQSection` at `src/components/sections/FAQSection.tsx`

- Accordion with 6 FAQ items (question + answer)
- Dictionary data shape: `faq: { eyebrow: string; headline: string; items: Array<{ question: string; answer: string }> }` — plain strings, no HTML
- Native `<details>`/`<summary>` — no JS toggle state needed, works without JS
- One item open at a time via `name` attribute on `<details>` (HTML exclusive accordion). Browsers without `name` support gracefully degrade to allowing multiple items open — acceptable progressive enhancement fallback.
- Open transition: instant (native `<details>` behavior). No CSS animation — zero-JS simplicity over polish.
- Visual design: consistent with existing sections (section-shell, botanical palette, card-surface aesthetic)
- Responsive: single column, full width on mobile, max-width on desktop
- Placed before WaitlistCTASection in all 3 variants (A, C, F) — natural pre-conversion position

**New type:** `SectionId` union extended with `'faq'`

**New analytics:** `section_view` event for `faq` section via existing `SectionObserver`

**New JSON-LD:** `generateFAQPageSchema(items)` in `lib/seo.ts`

### Edge Cases & Error Handling

- **Empty FAQ items:** If dictionary returns empty array, render neither `FAQSection` nor `FAQPage` JSON-LD (both guarded)
- **Answer format:** Plain strings in dictionary. Rendered as single `<p>` per item. JSON-LD `acceptedAnswer.text` uses the same plain string — exact match guaranteed.
- **Accessibility:** `<details>`/`<summary>` are natively accessible (screen readers, keyboard). No ARIA overrides needed.
- **SEO:** FAQ structured data must match visible content exactly (Google requirement). Same source data feeds both component and JSON-LD.
- **Variant placement:** FAQ goes in the same position for all 3 variants — before WaitlistCTASection
- **Browser fallback:** Browsers without `<details name>` support allow multiple items open simultaneously — acceptable degradation.

### FAQ Content (6 items)

1. **¿Qué es nutriXplorer?** — Platform description, bot + estimation engine
2. **¿De dónde salen los datos nutricionales?** — 4-level estimation, confidence transparency
3. **¿Qué restaurantes están disponibles?** — 10 Spanish chains, expansion plans
4. **¿Es gratis?** — Free during beta, Telegram bot access
5. **¿Mis datos están seguros?** — No personal data stored, no tracking, GDPR
6. **¿Cómo puedo acceder?** — Waitlist, early access, Telegram bot

---

## Implementation Plan

### Existing Code to Reuse

- **`src/lib/i18n/locales/es.ts`** — add `faq` key; `Dictionary` type is auto-derived via `typeof es`, so no separate type file needed
- **`src/lib/i18n/locales/en.ts`** — mirror the same `faq` key in English; must satisfy `Dictionary` constraint
- **`src/lib/seo.ts`** — add `generateFAQPageSchema` alongside the two existing generators; same module, same pattern
- **`src/types/index.ts`** — extend `SectionId` union with `'faq'`; `SectionObserver` accepts `SectionId`, so this unlocks type-safe usage
- **`src/components/analytics/SectionObserver`** — wrap `FAQSection` exactly as every other section in `page.tsx`
- **`getDictionary` / `Dictionary`** — already exported from `src/lib/i18n/index.ts`; no changes needed there
- **`safeJsonLd`** — private helper already in `src/app/page.tsx`; call it for the new FAQ schema the same way
- **`section-shell`** Tailwind class — already defined globally; use it for the FAQ inner container
- **`src/__tests__/seo.test.ts`** — extend this file with `generateFAQPageSchema` test cases (do not create a new file)
- **`src/__tests__/page.test.tsx`** — extend this file with FAQ placement and JSON-LD count assertions (do not create a new file)

---

### Files to Create

| File | Purpose |
|------|---------|
| `src/components/sections/FAQSection.tsx` | New server component — renders eyebrow, headline, and `<details>`/`<summary>` accordion; guards on empty items |
| `src/__tests__/sections/FAQSection.test.tsx` | Unit tests for FAQSection: rendering, accordion markup, empty-items guard |

---

### Files to Modify

| File | What changes |
|------|-------------|
| `src/lib/i18n/locales/es.ts` | Add `faq` key with eyebrow, headline, and 6 items (Spanish content from spec) |
| `src/lib/i18n/locales/en.ts` | Add `faq` key with eyebrow, headline, and 6 items (English translations) |
| `src/lib/seo.ts` | Add `generateFAQPageSchema(items: Array<{ question: string; answer: string }>)` function |
| `src/types/index.ts` | Add `'faq'` to `SectionId` union |
| `src/app/page.tsx` | Import `FAQSection` + `generateFAQPageSchema`; insert FAQ before `WaitlistCTASection` in all 3 variant layout functions; add the FAQ JSON-LD `<script>` alongside the existing two (guarded on items length) |
| `src/__tests__/seo.test.ts` | Add `describe('generateFAQPageSchema', ...)` block |
| `src/__tests__/page.test.tsx` | Add mock for `FAQSection`, assert it renders in all 3 variants, assert JSON-LD count increases to ≥ 3 |

---

### Implementation Order

**Step 1 — Types** (`src/types/index.ts`)
- Add `'faq'` to `SectionId`. No test needed — type errors in later steps would surface any regression.

**Step 2 — Dictionary content** (`es.ts`, `en.ts`)
- Add `faq: { eyebrow, headline, items: [...] }` to both files.
- Test first: verify `getDictionary('es').faq` has `.items` array of length 6 and each item has `question`/`answer` strings. Write this inline at the top of `FAQSection.test.tsx` (a pure data assertion, no render needed).

**Step 3 — Schema function** (`src/lib/seo.ts`)
- Test first (in `src/__tests__/seo.test.ts`): write `describe('generateFAQPageSchema')` before implementing.
  - `returns FAQPage schema with correct @type`
  - `maps items to mainEntity Question/Answer pairs`
  - `returns empty mainEntity array for empty input`
- Implement `generateFAQPageSchema(items)`:
  - Returns `{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: items.map(...) }`
  - Each entry: `{ '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.answer } }`

**Step 4 — FAQSection component** (`src/components/sections/FAQSection.tsx`)
- Test first (`src/__tests__/sections/FAQSection.test.tsx`):
  - `renders nothing when items array is empty` — expect container to be empty
  - `renders eyebrow and headline`
  - `renders all 6 items as summary/details elements`
  - `all details share the same name attribute` — query all `<details>`, assert every `name` attr equals a single consistent value (e.g. `"faq"`)
  - `renders each question as summary text`
  - `renders each answer as paragraph text`
  - `renders a level-2 heading`
- Implement `FAQSection`:
  - No `'use client'` directive — pure server component, no state
  - Props: `{ dict: Dictionary['faq'] }`
  - Guard: `if (!dict.items.length) return null;`
  - Outer `<section aria-labelledby="faq-heading" data-section="faq" className="bg-paper py-16 md:py-20">`
  - Inner `<div className="section-shell">`
  - Eyebrow `<p>` + `<h2 id="faq-heading">` using the same Tailwind classes as `ForWhoSection` (uppercase tracking-widest, etc.)
  - Accordion: `<div className="space-y-3">` wrapping `{dict.items.map(item => <details key={item.question} name="faq">...<summary>{item.question}</summary><p>{item.answer}</p></details>)}`
  - Plain `<div>` container — `<dl>` cannot contain `<details>` (invalid HTML). No extra semantics needed; `<details>`/`<summary>` provide sufficient structure.
  - **TypeScript note:** If `@types/react` does not include `name` on `DetailsHTMLAttributes`, add a module augmentation in `src/types/react-details.d.ts` or use a cast. Check before implementing.
  - Background alternates from neighbor sections — use `bg-ivory` or `bg-paper` to contrast with the sections immediately above/below (check neighbors in `page.tsx`; `RestaurantsSection` is immediately above in variant A, use `bg-paper`)

**Step 5 — Page integration** (`src/app/page.tsx`)
- Test first (extend `src/__tests__/page.test.tsx`):
  - Add `jest.mock` for `FAQSection` (return `<section aria-label="FAQ">FAQ Section</section>`)
  - `renders FAQSection before WaitlistCTASection in variant a` — assert FAQ mock text appears before Waitlist mock text in `document.body.innerHTML`
  - `renders FAQSection in variant c` — same positional assertion
  - `renders FAQSection in variant f` — same positional assertion
  - `includes FAQPage JSON-LD script` — parse all `script[type="application/ld+json"]` contents, assert at least one has `@type === 'FAQPage'`
  - `does not render FAQ section or FAQPage JSON-LD when items are empty` — mock `getDictionary` to return `faq: { eyebrow: '', headline: '', items: [] }`, assert no FAQ region and no FAQPage JSON-LD
- Implement page changes:
  1. Import `FAQSection` from `@/components/sections/FAQSection`
  2. Import `generateFAQPageSchema` from `@/lib/seo`
  3. In `LandingPage`, derive `const faqSchema = dict.faq.items.length > 0 ? generateFAQPageSchema(dict.faq.items) : null;` after existing schema calls
  4. Add third `<script type="application/ld+json">` conditionally: `{faqSchema && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(faqSchema) }} />}`
  5. In `VariantALayout`: conditionally insert `{hasFaqItems && <SectionObserver sectionId="faq" variant={variant}><FAQSection dict={dict.faq} /></SectionObserver>}` immediately before the `waitlist-cta` SectionObserver block. Pass `hasFaqItems` as a prop to each variant layout, or compute from `dict` inside the layout.
  6. Repeat step 5 for `VariantCLayout` and `VariantFLayout`
  - **Key:** The `SectionObserver` itself must be conditionally rendered (not just `FAQSection`) to avoid stale `section_view` analytics events for an empty section.

---

### Testing Strategy

**Test files to create:**
- `src/__tests__/sections/FAQSection.test.tsx` — new file, component unit tests

**Test files to extend:**
- `src/__tests__/seo.test.ts` — add `generateFAQPageSchema` describe block
- `src/__tests__/page.test.tsx` — add FAQSection mock + integration assertions

**Key test scenarios:**

_FAQSection.test.tsx_
- Dictionary data shape: `getDictionary('es').faq` has `eyebrow`, `headline`, `items` with length 6
- Empty guard: `render(<FAQSection dict={{ eyebrow: '', headline: '', items: [] }} />)` — expect `container.firstChild` to be null
- Full render: renders eyebrow, headline, all 6 questions, all 6 answers
- Accordion exclusivity: all rendered `<details>` elements share the same `name` attribute value
- Accessibility: `getByRole('heading', { level: 2 })` returns the headline

_seo.test.ts additions_
- `generateFAQPageSchema([])` — `mainEntity` is empty array
- `generateFAQPageSchema([{ question: 'Q1', answer: 'A1' }])` — `@type` is `'FAQPage'`, `mainEntity[0]['@type']` is `'Question'`, `mainEntity[0].name` is `'Q1'`, `mainEntity[0].acceptedAnswer.text` is `'A1'`
- Schema output does not contain `<` characters (XSS — note: `safeJsonLd` handles this at call site, not in the generator itself; test the generator output contains expected fields, not the escaped form)

_page.test.tsx additions_
- Mock: `jest.mock('@/components/sections/FAQSection', () => ({ FAQSection: () => <section aria-label="FAQ">FAQ Section</section> }))`
- Variants A, C, F: FAQ mock text appears before Waitlist mock text in DOM order
- JSON-LD: parse all `script[type="application/ld+json"]` and assert one has `@type === 'FAQPage'`
- Empty state: mock dictionary with empty FAQ items → no FAQ region, no FAQPage JSON-LD

**Mocking strategy:**
- `FAQSection` mock in `page.test.tsx`: same inline JSX pattern used by all other section mocks in that file
- No mocking needed in `FAQSection.test.tsx` or `seo.test.ts` — these test real implementations directly (no external dependencies)
- `getDictionary('es')` is called directly in tests (same pattern as `ComparisonSection.test.tsx` — no mock)

---

### Key Patterns

- **Server component, no `'use client'`** — all section components in this codebase are server components unless they need browser APIs. `FAQSection` has no state/effects. Compare: `ComparisonSection.tsx` (no directive). Contrast: `SectionObserver.tsx` (`'use client'` because it uses `useEffect`/`useRef`).

- **Props typed via `Dictionary['key']`** — every section receives `dict: Dictionary['sectionKey']`. `Dictionary` is inferred from `typeof es`, so adding `faq` to `es.ts` automatically types the prop. See `ComparisonSection.tsx` line 1–5 and `ForWhoSection.tsx` line 1–4.

- **`section-shell` layout class** — used by `ForWhoSection`, `TrustEngineSection`, etc. for the responsive inner container (`max-w + px auto`). Use it instead of repeating `max-w-[1200px] mx-auto px-5 ...`.

- **Eyebrow + heading pattern** — copy the eyebrow `<p>` and `<h2>` classes from `ForWhoSection.tsx` (uppercase tracking-widest for eyebrow; `text-3xl md:text-[44px] font-bold tracking-tight` for headline). Both use `id` on the heading and `aria-labelledby` on the section.

- **`data-section` attribute** — every section has `data-section="<section-id>"` on its root element. For FAQ: `data-section="faq"`.

- **SectionObserver wrapping in page.tsx** — the observer is always applied in `page.tsx`, never inside the component itself. `FAQSection` is a pure display component; `SectionObserver` wraps it at the page level. This is consistent across all sections.

- **JSON-LD rendering pattern in page.tsx** — `generateX()` is called in `LandingPage` body, result passed to `safeJsonLd()`, rendered as `<script type="application/ld+json" dangerouslySetInnerHTML={...} />`. The FAQ schema must follow exactly this pattern. The guard (`faqSchema && ...`) keeps the empty-items contract clean.

- **`en.ts` must satisfy `Dictionary`** — `en.ts` uses `export const en: Dictionary = { ... }`. TypeScript will error at compile time if the new `faq` key is present in `es.ts` but missing or structurally wrong in `en.ts`. Always update both files in the same step.

- **Test file location** — section component tests live in `src/__tests__/sections/`, matching the naming convention of all existing section test files (`ComparisonSection.test.tsx`, `ForWhoSection.test.tsx`, etc.).

---

## Acceptance Criteria

- [x] FAQSection component renders all FAQ items from dictionary as `<details>`/`<summary>` accordion (6 items in es.ts)
- [x] All `<details>` elements share the same `name` attribute (enables exclusive accordion in supporting browsers)
- [x] FAQ content driven by i18n dictionary (`es.ts`)
- [x] FAQPage JSON-LD schema rendered alongside existing WebSite/SoftwareApplication schemas
- [x] JSON-LD content matches visible FAQ content exactly (same dictionary source)
- [x] Empty FAQ array: neither section nor JSON-LD rendered
- [x] Section placed before WaitlistCTASection in all 3 variants (A, C, F)
- [x] SectionObserver wraps FAQ for `section_view` analytics
- [x] `SectionId` type includes `'faq'`
- [x] Empty items guard (renders nothing if no FAQ items)
- [x] Unit tests for FAQSection component (10 tests)
- [x] Unit tests for `generateFAQPageSchema` (3 tests)
- [x] All tests pass (347 total)
- [x] Build succeeds
- [x] Specs updated (`ui-components.md`)

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing
- [x] E2E tests updated (if applicable)
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
- [x] Step 5: `qa-engineer` executed (Standard/Complex)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-29 | Ticket created | Standard complexity, frontend-only |
| 2026-03-29 | Spec reviewed by Gemini + Codex GPT-5.4 | 5 IMPORTANT + 2 SUGGESTION. All addressed: answer data shape defined (plain string), CSS animation dropped (instant native), item count fixed to 6, empty-state JSON-LD guard added, exclusivity test changed to name attribute, wording fixed, browser fallback documented |
| 2026-03-29 | Plan reviewed by Gemini + Codex GPT-5.4 | 1 CRITICAL + 4 IMPORTANT + 2 SUGGESTION. All addressed: `<dl>` replaced with `<div>` (invalid HTML), `<details name>` TS augmentation noted, SectionObserver guard at page level, stronger page tests (order + JSON-LD type + empty state), redundant Step 6 removed |
| 2026-03-29 | Implementation complete (TDD) | 17 new tests (10 component + 3 seo + 4 page integration). 347 total passing. tsc clean, lint clean |
| 2026-03-29 | Production validator | 1 CRITICAL fixed: FAQSection added to ui-components.md |
| 2026-03-29 | Code review | APPROVED. 1 IMPORTANT fixed (empty-state integration test). 3 suggestions noted |
| 2026-03-29 | QA edge-case tests | 26 tests added (2 files), all passing. 374 total |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Plan, AC, DoD, Workflow, Log, Evidence |
| 1. Mark all items | [x] | AC: 15/15, DoD: 7/7, Workflow: 6/8 (Steps 0-5 done, Step 6 pending) |
| 2. Verify product tracker | [x] | Active Session: step 5/6, Features table: 5/6 |
| 3. Update key_facts.md | [x] | N/A — no new endpoints, models, or shared utilities |
| 4. Update decisions.md | [x] | N/A — no ADR needed |
| 5. Commit documentation | [x] | Commit: c525b43 |
| 6. Verify clean working tree | [x] | `git status`: clean |

---

*Ticket created: 2026-03-29*
