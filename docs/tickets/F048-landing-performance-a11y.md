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

_Pending — to be generated by the planner agent in Step 2._

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
