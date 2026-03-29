# F048: Landing — Performance & Accessibility

**Feature:** F048 | **Type:** Frontend | **Priority:** Medium
**Status:** In Progress | **Branch:** feature/F048-landing-performance-a11y
**Created:** 2026-03-29 | **Dependencies:** F047 (done)

---

## Spec

### Description

Final polish pass on the nutriXplorer landing page addressing all remaining Sprint 2 (P2) items from the cross-model audit (2026-03-28). Focuses on accessibility, performance, and content completeness.

**Items in scope** (from audit Sprint 2, excluding already-done items):

| # | Issue | Audit ref | Est. time |
|---|-------|-----------|-----------|
| 1 | SearchSimulator: keyboard navigation + ARIA combobox | I10 | 3-4h |
| 2 | Security response headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy); CSP and HSTS out of scope | S9 | 1h |
| 3 | Add ChatGPT as competitor in ComparisonSection | S5 | 30min |
| 4 | Improve "no match" UX in SearchSimulator | — | 1h |
| 5 | Add prefers-reduced-motion to Reveal and ProductDemo | — | 30min |
| 6 | localStorage try/catch for consent (S15) | S15 | 5min |

**Excluded from scope** (deferred):
- **Replace framer-motion with CSS animations (S14)** — 6h estimated, touches 10+ files and all tests. Deferred to a dedicated refactoring feature. The ~40KB saving is real but not a blocker for launch.

### API Changes

None.

### Data Model Changes

None.

### UI Changes

#### 1. SearchSimulator Keyboard Navigation + ARIA Combobox (I10)

Implement the WAI-ARIA combobox pattern for the SearchSimulator autocomplete:

- **Input role**: `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`
- **Listbox**: `role="listbox"` (already present), each `<li>` option with `role="option"` (already present), unique `id`
- **Arrow keys**: Up/Down navigate the suggestion list, highlight the active option
- **Enter**: Select the currently highlighted option. If no option is highlighted, run search using the existing `handleRun()` logic (first partial match from `suggestions` array — case-insensitive `includes` filter, same as current behavior)
- **Escape**: Close the dropdown, keep the input value
- **Home/End**: Jump to first/last suggestion (optional but recommended)
- **Visual highlight**: Active option gets a distinct background (e.g., `bg-mist` or `bg-botanical/10`)
- **Screen reader**: Active option announced via `aria-activedescendant` pointing to the option's `id`

Current state: The input already has `aria-label`, the dropdown has `role="listbox"`, and options have `role="option"`. Missing: `role="combobox"` on the input, keyboard handlers, `aria-expanded`, `aria-activedescendant`, option IDs.

#### 2. Security Headers (S9)

Add security headers via `next.config.mjs` `headers()` function:

```js
async headers() {
  return [{
    source: '/(.*)',
    headers: [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ],
  }];
}
```

**Note**: Do NOT add a strict CSP yet — it would break inline scripts (palette, JSON-LD), GA4, and Vercel Analytics. A CSP should be added in a dedicated security feature with proper nonce/hash support. HSTS is handled by Vercel/Cloudflare at the infrastructure level — don't duplicate.

#### 3. ChatGPT as Competitor (S5)

Add ChatGPT as a 4th comparison card in ComparisonSection. The audit noted ChatGPT is the most likely 2026 alternative for nutritional queries.

Card content (Spanish):
- **Title**: "ChatGPT / IAs generativas"
- **Versus**: "vs. nutriXplorer"
- **Description**: "Responde con datos genéricos de bases públicas. Sin verificar contra menús reales. Puede inventar valores (alucinaciones). No distingue entre datos de cadena y estimaciones."
- **Differentiator**: "nutriXplorer verifica cada dato contra la fuente original y muestra su nivel de confianza."

Add to the i18n dictionary (`es.ts` and `en.ts`).

English card content:
- **Title**: "ChatGPT / Generative AIs"
- **Versus**: "vs. nutriXplorer"
- **Description**: "Responds with generic data from public databases. Not verified against real menus. May hallucinate values. Doesn't distinguish between chain data and estimates."
- **Differentiator**: "nutriXplorer verifies every data point against the original source and shows its confidence level."

#### 4. Improved "No Match" UX in SearchSimulator

Currently shows: "No encontrado. Prueba con uno de los ejemplos."

**Trigger**: Show the no-match state when the input is non-empty, the filtered suggestions list is empty, AND the simulator state is `'idle'` (not loading/result). Same condition as the existing `noResult` variable. This is live filtering during typing — not after an explicit submit.

Improve to:
- Show a more helpful message: "No tenemos datos sobre '{query}' todavía. Prueba con uno de estos platos:"
- Below the message, show 3-4 quick-select suggestion pills (reuse existing pill pattern)
- Add a subtle animation (fade-in) for the no-match state

#### 5. prefers-reduced-motion for Reveal and ProductDemo

- **globals.css**: Add a global `@media (prefers-reduced-motion: reduce)` block that disables CSS custom keyframe animations: `animate-float`, `animate-fade-in`. Set `animation: none !important; transition: none !important;` for all animated elements.
- **Reveal.tsx**: Framer-motion's `useReducedMotion()` hook causes SSR hydration mismatches (returns `null` on server, `true/false` on client). Instead, use the CSS approach: framer-motion already respects `prefers-reduced-motion` at the framework level when `MotionConfig reducedMotion="user"` is set. The simplest approach for Reveal: keep framer-motion as-is (it already has `whileInView` which respects reduced motion by default in framer-motion v10+). The CSS media query handles our custom animations.
- **ProductDemo.tsx**: Uses `motion.div` for card entrance. Same approach — framer-motion handles it. Our CSS media query covers custom keyframes.
- **Scope**: Only landing-page custom keyframe animations (`animate-float`, `animate-fade-in`) plus any Tailwind `animate-*` utilities are covered. Framer-motion's own animations are handled by the library.

#### 6. localStorage try/catch for Consent (S15)

In `CookieBanner.tsx`, the `localStorage.getItem` and `localStorage.setItem` calls have no try/catch. In private browsing or when storage is full, these can throw.

Wrap both in try/catch:
```ts
function safeGetItem(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSetItem(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* silent fail */ }
}
```

### Edge Cases & Error Handling

- **Keyboard navigation**: When dropdown is closed, arrow keys should open it and highlight first item
- **Empty list**: If no suggestions, arrow keys should do nothing
- **Enter without highlight**: If no option is highlighted and query matches a dish, run the search
- **Security headers**: Verify they don't break Vercel preview deployments
- **ChatGPT card**: Must work with the existing 3-column grid (will become 4 columns on desktop, 2x2 on tablet)
- **No-match pills**: Show first 4 dishes from DISHES array as suggestions
- **Reduced motion**: Verify animations are actually disabled (not just reduced)
- **localStorage**: Safari private mode throws on setItem

---

## Implementation Plan

### Existing Code to Reuse

- **`src/components/SearchSimulator.tsx`** — primary file for items 1 and 4. Reuse `selectDish`, `handleRun`, `handleInputChange`, `suggestions` useMemo, quick-select pill pattern (`rounded-full border px-3 py-1.5` classes), and the `noResult` computed variable.
- **`src/components/analytics/CookieBanner.tsx`** — wrap the two existing bare `localStorage` calls with helper functions (item 6). No structural change needed.
- **`src/components/sections/ComparisonSection.tsx`** — already renders `dict.cards` as a mapped array; adding a 4th card to the i18n dictionary is the only change needed (item 3). The grid needs a class tweak for 4 columns.
- **`src/components/Reveal.tsx`** — framer-motion already respects `prefers-reduced-motion` in v10+ via `whileInView`. No code change required; the CSS approach in `globals.css` handles our custom keyframes (item 5).
- **`src/app/globals.css`** — already has a partial `@media (prefers-reduced-motion: reduce)` block (lines 44–52) that covers `animate-float`, `animate-badge-pulse`, `animate-fade-in` with `animation: none`. Needs `transition: none !important` added (item 5).
- **`src/lib/i18n/locales/es.ts`** and **`en.ts`** — `comparison.cards` array; append 4th card object following the existing shape (`title`, `versus`, `description`, `advantage`). Note: `en.ts` uses `type Dictionary` from `es.ts` so TypeScript enforces the same shape.
- **`next.config.mjs`** — add `async headers()` function alongside existing `reactStrictMode` and `images` config.
- **`src/lib/content.ts`** — `DISHES` array is already exported; used by the no-match UX to pull the first 4 dishes as suggestion pills.
- Framer-motion mock in test files (`jest.mock('framer-motion', ...)`) — already established in `SearchSimulator.test.tsx` and `edge-cases.f047.test.tsx`; reuse same mock pattern.

---

### Files to Create

| File | Purpose |
|------|---------|
| `src/__tests__/edge-cases.f048.test.tsx` | Edge-case tests: combobox ARIA attributes, keyboard navigation (arrows, Enter, Escape), no-match improved UX, localStorage try/catch resilience, ChatGPT card in i18n dict, security headers shape, reduced-motion CSS class presence |

No new component files are needed — all changes are in-place edits to existing files.

---

### Files to Modify

| File | Change |
|------|--------|
| `src/components/analytics/CookieBanner.tsx` | Add `safeGetItem` and `safeSetItem` helpers; replace bare `localStorage` calls |
| `src/app/globals.css` | Add `transition: none !important` to the existing reduced-motion block |
| `next.config.mjs` | Add `async headers()` returning the 4 security header objects |
| `src/lib/i18n/locales/es.ts` | Append ChatGPT card to `comparison.cards` array |
| `src/lib/i18n/locales/en.ts` | Append ChatGPT card to `comparison.cards` array |
| `src/components/sections/ComparisonSection.tsx` | Update grid class from `md:grid-cols-3` to `md:grid-cols-2 lg:grid-cols-4` for 4-card layout |
| `src/components/SearchSimulator.tsx` | (1) Add combobox ARIA attributes to input; (2) Add `activeIndex` state for keyboard highlight; (3) Add `onKeyDown` handler for Up/Down/Enter/Escape/Home/End; (4) Add `id` attributes to `<li>` options; (5) Improve no-match UX with query-interpolated message and suggestion pills |
| `src/__tests__/SearchSimulator.test.tsx` | Update existing `no encontrado` test to match the new message pattern |
| `src/__tests__/sections/ComparisonSection.test.tsx` | Update the "renders all 3 comparison cards" test to expect 4 cards |

---

### Implementation Order

1. **`CookieBanner.tsx`** — add `safeGetItem`/`safeSetItem` helpers (quick win, isolated, no test regressions)
2. **`globals.css`** — add `transition: none !important` to the existing reduced-motion block
3. **`next.config.mjs`** — add `headers()` with the 4 security headers
4. **`es.ts` + `en.ts`** — append ChatGPT card to `comparison.cards`
5. **`ComparisonSection.tsx`** — update grid class to accommodate 4 cards
6. **`SearchSimulator.tsx` (no-match UX)** — improve message and add suggestion pills (item 4)
7. **`SearchSimulator.tsx` (combobox ARIA + keyboard)** — add `activeIndex` state, `id` attrs on options, `role="combobox"` + `aria-expanded` + `aria-controls` + `aria-activedescendant` on input, `onKeyDown` handler (item 1)
8. **`src/__tests__/edge-cases.f048.test.tsx`** — write all new tests (TDD: write tests first for items 1, 4, then implement)
9. **`src/__tests__/SearchSimulator.test.tsx`** — update the existing no-match text assertion
10. **`src/__tests__/sections/ComparisonSection.test.tsx`** — update card count assertion to 4

---

### Testing Strategy

#### New test file: `src/__tests__/edge-cases.f048.test.tsx`

**Mocking strategy** (follow `edge-cases.f047.test.tsx` and `SearchSimulator.test.tsx` patterns):
- `jest.mock('framer-motion', ...)` — same mock as in `SearchSimulator.test.tsx` (motion.div, motion.button, AnimatePresence pass-through)
- `jest.useFakeTimers()` for the 850ms loading delay
- No mocks needed for `CookieBanner` localStorage tests — jsdom provides `localStorage`; test private-mode failure by replacing `window.localStorage` with a throwing implementation

**Test scenarios:**

_SearchSimulator — ARIA combobox (item 1):_
- Input has `role="combobox"` attribute
- Input has `aria-expanded="false"` when dropdown is closed, `"true"` when open
- Input has `aria-controls` pointing to the listbox's `id`
- Each suggestion `<li>` has a unique `id` attribute
- Input `aria-activedescendant` matches the highlighted option's `id` when navigating with arrow keys
- `aria-activedescendant` is empty/absent when no option is highlighted

_SearchSimulator — keyboard navigation (item 1):_
- Pressing ArrowDown when dropdown is closed opens it and highlights the first option (activeIndex = 0)
- Pressing ArrowDown when already at the last option does NOT wrap (stays at last)
- Pressing ArrowUp when at index 0 does NOT wrap (stays at 0 or deselects)
- Pressing ArrowDown then ArrowUp returns to first option
- Pressing Enter with a highlighted option calls `selectDish` with that dish (shows loading)
- Pressing Enter with no highlighted option but a matching query calls `handleRun` (shows loading)
- Pressing Enter with no highlighted option and no match does nothing
- Pressing Escape closes the dropdown, `aria-expanded` becomes false, input value unchanged
- Pressing Home jumps to first suggestion (activeIndex = 0)
- Pressing End jumps to last suggestion

_SearchSimulator — no-match UX (item 4):_
- When query matches nothing and state is `idle`, shows message containing the query text (e.g., `platillo marciano xyz123`)
- The message contains "todavía" (new i18n key check)
- Quick-select suggestion pills render (first 4 from DISHES) below the no-match message
- Clicking a suggestion pill triggers `selectDish` (shows loading state)

_CookieBanner — localStorage try/catch (item 6):_
- When `localStorage.getItem` throws (simulated private mode), the banner still renders without crashing (consent defaults to `null`)
- When `localStorage.setItem` throws on accept, the component does not throw and consent is still set in component state
- When `localStorage.setItem` throws on reject, the component does not throw

_i18n — ChatGPT card (item 3):_
- `getDictionary('es').comparison.cards` has length 4
- `getDictionary('en').comparison.cards` has length 4
- The 4th card in `es` has title `"ChatGPT / IAs generativas"`
- The 4th card in `en` has title `"ChatGPT / Generative AIs"`

_Security headers (item 2):_
- Test by importing the `headers()` export from `next.config.mjs` directly and asserting the returned array contains objects with `key: 'X-Frame-Options'`, `key: 'X-Content-Type-Options'`, `key: 'Referrer-Policy'`, `key: 'Permissions-Policy'`
- Assert values match the spec exactly

_Reduced motion (item 5):_
- Verify globals.css contains `transition: none !important` inside the `prefers-reduced-motion` block (string content assertion in a Node.js test, or confirm via a snapshot)

#### Modified existing tests

- **`SearchSimulator.test.tsx`** — the test at line 118 (`'shows "no encontrado" message'`) uses `/no encontrado/i`; update to match the new message pattern, e.g., `/todavía/i` or `/no tenemos datos/i`
- **`ComparisonSection.test.tsx`** — the test `'renders all 3 comparison cards'` will now iterate over 4 cards; update description to `'renders all 4 comparison cards'`

---

### Key Patterns

**Combobox pattern to implement in `SearchSimulator.tsx`:**
- Add `activeIndex` state: `const [activeIndex, setActiveIndex] = useState<number>(-1)` (-1 means no option highlighted)
- Reset `activeIndex` to -1 whenever `suggestions` changes (via `useEffect` or inline in `handleInputChange`)
- The listbox `<ul>` needs a stable `id`, e.g., `id="search-suggestions-listbox"`
- Each `<li>` option needs `id={`search-option-${dish.query.replace(/\s+/g, '-')}`}` (or index-based: `search-option-${index}`)
- Input attributes: `role="combobox"`, `aria-expanded={showDropdown && suggestions.length > 0}`, `aria-controls="search-suggestions-listbox"`, `aria-activedescendant={activeIndex >= 0 ? `search-option-${activeIndex}` : undefined}`
- Visual highlight on active option: add `bg-mist` class (already a CSS variable) to the active `<li>` button; reference existing active pill style: `border-botanical bg-mist text-botanical`
- The component already uses `onBlur` with a 150ms timeout to close the dropdown without race conditions — preserve this; `onKeyDown` on the input handles keyboard, not click/blur

**No-match UX pattern:**
- The `noResult` variable already exists and is correct; only the JSX output changes
- Suggestion pills for no-match: reuse the same `<button>` classes as the quick-select pills (`rounded-full border px-3 py-1.5 transition border-slate-200 bg-white text-slate-600 hover:border-slate-300`)
- Show only `DISHES.slice(0, 4)` — spec says 3-4 pills; 4 is the chosen count
- Add `animate-fade-in` class (already defined in `globals.css`) to the no-match container for the fade-in animation; the CSS reduced-motion block will suppress it automatically when the user prefers reduced motion

**i18n dictionary shape for ChatGPT card:**
- The `advantage` key in `es.ts`/`en.ts` is what `ComparisonSection` renders as `card.advantage` (the green differentiator text). The spec uses the key name `differentiator` in the description but the existing dictionary and component use `advantage` — use `advantage`.

**ComparisonSection grid change:**
- Current: `className="grid grid-cols-1 md:grid-cols-3 gap-6"`
- New: `className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"` — 2-column tablet (2×2), 4-column desktop. This matches the edge case note in the spec.

**`use client` directive:**
- `SearchSimulator.tsx` — already has `'use client'` (line 1), no change needed
- `CookieBanner.tsx` — already has `'use client'` (line 1), no change needed
- `ComparisonSection.tsx` — Server Component (no directive), no change needed
- `next.config.mjs` — not a React component, no directive needed

**Test file placement:**
- All test files live in `src/__tests__/` (flat or in `sections/` sub-directory). New edge-case file follows the `edge-cases.f047.test.tsx` naming convention.
- Use `@jest-environment jsdom` jsdoc comment for the new test file (required for `localStorage` and DOM assertions)

**Gotcha — `aria-expanded` type:**
- In React, `aria-expanded` accepts `boolean | 'true' | 'false'`. Pass the boolean directly: `aria-expanded={showDropdown && suggestions.length > 0}` — React serializes it correctly.

**Gotcha — `next.config.mjs` test:**
- `next.config.mjs` uses ESM `export default`. To test it in Jest (CommonJS environment), use a dynamic `import()` in the test or test via a separate exported helper function. The simplest approach: export a named `getSecurityHeaders` function from `next.config.mjs` and call it in the test. Alternatively, inline-assert the returned headers array in the test by importing the default export with `require`/`import` in a `beforeAll`.

**Gotcha — existing `SearchSimulator.test.tsx` framer-motion mock:**
- The existing mock at line 9–23 does NOT spread `...rest` (only forwards `children` and `className` for `motion.div`). The `motion.button` mock also only forwards `children`, `className`, and `onClick`. When adding `onKeyDown` to the input (which is a `<label><input>` not a `motion.*` element), this is fine. But verify the button mock does not break if `disabled` prop is checked in tests.

**Gotcha — `aria-activedescendant` with empty string vs `undefined`:**
- Pass `undefined` (not empty string) when no option is active. In React, `aria-activedescendant={undefined}` omits the attribute from the DOM, which is correct per ARIA spec (attribute absent = no active descendant).

---

## Acceptance Criteria

- [ ] SearchSimulator input has `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`
- [ ] Suggestion options have unique `id` attributes
- [ ] Arrow keys navigate suggestions with visual highlight, Enter selects, Escape closes dropdown
- [ ] Home/End keys jump to first/last suggestion (out of scope — optional)
- [ ] Security headers present in all responses (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)
- [ ] ChatGPT comparison card added (4th card in ComparisonSection)
- [ ] "No match" UX shows query text and suggestion pills
- [ ] prefers-reduced-motion disables all custom animations
- [ ] localStorage calls wrapped in try/catch
- [ ] All existing tests pass
- [ ] New tests for: keyboard navigation, security headers, no-match UX, reduced motion
- [ ] Build succeeds with no TypeScript errors

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Unit tests written and passing
- [ ] Code follows project standards
- [ ] No linting errors
- [ ] Build succeeds
- [ ] Specs reflect final implementation

---

## Workflow Checklist

- [ ] Step 0: `spec-creator` executed, specs updated
- [ ] Step 1: Branch created, ticket generated, tracker updated
- [ ] Step 2: `frontend-planner` executed, plan approved
- [ ] Step 3: `frontend-developer` executed with TDD
- [ ] Step 4: `production-code-validator` executed, quality gates pass
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 5: `qa-engineer` executed (Standard)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-29 | Ticket created | 6 P2 items from audit Sprint 2 (framer-motion replacement deferred) |
| 2026-03-29 | Spec reviewed by Gemini+Codex | Gemini: 1C+2I+2S, Codex: 4I+3S. Both REVISE. Fixed: scope table, EN copy, Enter match rule, no-match trigger, reduced-motion approach (avoid SSR hydration), AC expanded |
| 2026-03-29 | Plan reviewed by Gemini+Codex | Gemini: 3I+1S, Codex: 2C+3I. Both REVISE. Key fixes to incorporate: e.preventDefault in keyboard handler, aria-expanded for no-match, no next.config export, MotionConfig reducedMotion="user", hide pills during noResult, TDD order |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | Sections verified: (list) |
| 1. Mark all items | [ ] | AC: _/_, DoD: _/_, Workflow: _/_ |
| 2. Verify product tracker | [ ] | Active Session: step _/6, Features table: _/6 |
| 3. Update key_facts.md | [ ] | Updated: (list) / N/A |
| 4. Update decisions.md | [ ] | ADR-XXX added / N/A |
| 5. Commit documentation | [ ] | Commit: (hash) |
| 6. Verify clean working tree | [ ] | `git status`: clean |

---

*Ticket created: 2026-03-29*
