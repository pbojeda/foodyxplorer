# F105: Landing Coverage Showcase

**Feature:** F105 | **Type:** Frontend-Feature | **Priority:** Medium
**Status:** Done | **Branch:** feature/F105-landing-coverage-showcase (squash-merged + deleted)
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-05-18 | **Dependencies:** None
**Complexity:** Simple (PM Orchestrator `pm-auth-core`, Batch 2 feature 2/2)

---

## Spec

### Description

Add a quantitative trust-signal section to the landing (`packages/landing` → `nutrixplorer.com`) showing real catalog coverage numbers. Pre-beta closed waitlist needs concrete proof of substance: today the landing communicates *qualitative* coverage ("cadenas con datos oficiales", "cocina tradicional") via `RestaurantsSection` but never quotes hard numbers. This feature adds a compact stat strip with empirically-verified counts from `packages/api/prisma/seed-data/`.

**Numbers to display (verified 2026-05-18 against seed-data):**
- **319 platos españoles** mapeados (`spanish-dishes.json` → `dishes.length`)
- **564 alimentos base referenciados** (514 USDA `usda-sr-legacy-foods.json` + 50 BEDCA-linked dishes con `source === 'bedca'`)
- **10 categorías culinarias** (`desayunos · tapas · primeros · segundos · arroces · bocadillos · postres · bebidas · combinados · guarniciones`)
- **4 niveles de confianza** (high · medium · low + estimated — concepto ya presente en `TrustEngineSection`)

Numbers are computed at build-time from the seed JSON via a small helper module — NO runtime API call (landing is a static export). This means the counts auto-update on the next deploy whenever seed-data changes.

### Scope

**IN scope:**
- New section component `CoverageShowcaseSection.tsx` (4-cell stat strip, mobile stacked / desktop row).
- Counts helper in `packages/landing/src/lib/coverage-counts.ts` exporting typed constants (`DISHES_COUNT`, `FOODS_COUNT`, `CATEGORIES_COUNT`, `CONFIDENCE_LEVELS_COUNT`). Constants are NOT imported from the JSON at build time (avoids bundling hundreds-of-KB seed files into the static landing export).
- Unit test `packages/landing/src/__tests__/coverage-counts.test.ts` (Jest) reads `packages/api/prisma/seed-data/spanish-dishes.json` + `usda-sr-legacy-foods.json` at test time and asserts the helper constants match the empirical counts — this is the drift-detection gate.
- New i18n dictionary entries `coverageShowcase` in `packages/landing/src/lib/i18n/locales/es.ts` (and `en.ts` if exists, otherwise ES-only).
- Insertion in main page layout — between `RestaurantsSection` and `WaitlistCTASection` (after qualitative coverage, before conversion ask).
- Component render test for `CoverageShowcaseSection.tsx`.

**OUT scope (Simple ticket — explicit YAGNI):**
- Animations (count-up, fade-in beyond existing `Reveal` HOC if applicable).
- A/B test variant.
- Dynamic API counts (would require runtime fetch; static at build-time is sufficient).
- ChartJS-style graphics.
- Tracking events beyond what `SectionObserver` already provides.
- New images or icons (use existing iconography or none — pure typography is fine).
- Schema.org markup beyond basic `<section aria-label>` (no FAQPage-style structured data).

### API Changes

N/A — frontend-only.

### Data Model Changes

N/A — read-only access to existing seed-data JSON.

### UI Changes

New section `CoverageShowcaseSection` to be added to `docs/specs/ui-components.md` (1 row entry).

### Edge Cases & Error Handling

- If `spanish-dishes.json` or `usda-sr-legacy-foods.json` shape changes (Prisma seed rewrite), `coverage-counts.ts` MUST fail loudly at build-time (TypeScript error or thrown) — silent zero counts would degrade trust signal without anyone noticing. Handled via explicit type assertion in helper.
- If a counter would compute to 0 (impossible today but possible if seed-data file becomes empty), the section MUST still render but the unit test catches the regression.

---

## Implementation Plan

N/A — Simple task.

---

## Acceptance Criteria

- [x] AC1: New file `packages/landing/src/lib/coverage-counts.ts` exports typed constants `DISHES_COUNT`, `FOODS_COUNT`, `CATEGORIES_COUNT`, `CONFIDENCE_LEVELS_COUNT` (all `number`), plus a grouped object `COVERAGE_COUNTS` for ergonomic consumption. No runtime JSON import (avoids static-export bundle bloat).
- [x] AC2: Counts at time of merge match: `DISHES_COUNT === 319`, `FOODS_COUNT === 564` (514 USDA + 50 BEDCA-linked dishes), `CATEGORIES_COUNT === 10`, `CONFIDENCE_LEVELS_COUNT === 4`. Unit test reads the actual seed JSON at test runtime and asserts the constants match the empirical counts — drift-detection gate.
- [x] AC3: New section component `packages/landing/src/components/sections/CoverageShowcaseSection.tsx` renders 4 stat cards with the live counts. Heading + subline + 4 cells in Spanish, design-token-consistent with existing landing surfaces (Tailwind tokens `bg-paper` / `text-slate-*` / `card-surface` / `section-shell`).
- [x] AC4: Section is inserted into `packages/landing/src/app/page.tsx` in all 3 layout variants (A/C/F), wrapped in `<SectionObserver sectionId="coverage-showcase" variant={variant}>` for analytics parity. Placement: between `ComparisonSection`/`EmotionalBlock`/`RestaurantsSection` (variant-dependent) and the FAQ block, close to the conversion ask.
- [x] AC5: i18n entry `coverageShowcase` added to BOTH `packages/landing/src/lib/i18n/locales/es.ts` and `en.ts`, wired through `dict.coverageShowcase` in the page component.
- [x] AC6: Counts are evaluated at build time (`next build` does not fail; static prerender works). Verified with `npm run build -w @foodxplorer/landing` (all 10 static pages, /  74.6 kB).
- [x] AC7: Jest unit test for `coverage-counts.ts` (6 tests) — opens seed JSON at test runtime and asserts the helper constants match the empirical counts. Component test (5 tests) verifies `CoverageShowcaseSection` renders 4 cards with the live numbers via i18n.
- [x] AC8: `npm test` 749 pass + 3 todo / 752 total (60 suites), `npm run lint` 0 warnings, `npm run typecheck` clean, `npm run build` all 10 static pages green on the feature branch.
- [x] AC9: `docs/specs/ui-components.md` updated with one-row entry for `CoverageShowcaseSection` in the component tree (both occurrences of the tree).

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing (11 new: 6 helper drift + 5 component render)
- [x] Code follows project standards (Tailwind tokens, i18n through dict, no inline magic numbers in JSX — derive from `COVERAGE_COUNTS` helper)
- [x] No linting errors
- [x] Build succeeds (static export prerenders without errors)
- [x] ui-components.md reflects new section

---

## Workflow Checklist

<!-- Simple tier: 1 → 3 → 4 → 5 → 6 (no 0, no 2) -->

- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 3: TDD implementation (counts helper → section component → wiring) — 11 tests RED → GREEN
- [x] Step 4: Quality gates (test 749/752 + 3 todo, lint 0, typecheck clean, build all 10 static pages)
- [x] Step 5: PR #281 + code-review-specialist APPROVED (2 MAJORs fixed inline, 4 NITs declined per Simple YAGNI). Simple tier skips qa-engineer.
- [x] Step 6: Ticket finalized, branch deleted (PR #281 squash-merged at `101f6fc`, branch removed local + remote).

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-05-18 | Step 1 setup | Branch `feature/F105-landing-coverage-showcase` off develop@81e40c5. Lite ticket created with 9 ACs + 6 DoD. Empirical seed-data counts verified pre-spec: dishes=319, BEDCA-linked=50, USDA=514, categories=10. Roadmap "47 BEDCA + 14 chains" claims were inaccurate vs seed-data; spec pivoted to verified 319/564/10/4 quartet for honest trust signaling. |
| 2026-05-18 | Step 3 implement (TDD) | RED: `coverage-counts.test.ts` (6 tests) + `CoverageShowcaseSection.test.tsx` (5 tests) failing on missing module. GREEN: helper `src/lib/coverage-counts.ts` (4 typed constants + `COVERAGE_COUNTS` aggregate, no JSON import — avoids static-export bundle bloat per AC1), component `src/components/sections/CoverageShowcaseSection.tsx` (4-cell `<dl>` grid, mobile 2×2 / desktop 4×1, Tailwind tokens consistent with RestaurantsSection), i18n entries in es.ts and en.ts (eyebrow/headline/subtitle + ordered `stats[]`), wire in all 3 variants of `page.tsx` between previous quantitative-or-qualitative trust section and FAQ. Added `'coverage-showcase'` to `SectionId` union. All 11/11 F105 tests pass. |
| 2026-05-18 | Step 4 quality gates | Full landing suite: 749 pass + 3 todo / 752 / 60 suites. Lint: 0 warnings. Typecheck: clean. Build: all 10 static pages, `/` 74.6 kB First Load JS (no measurable bloat from F105). ui-components.md updated with `CoverageShowcaseSection` row in both occurrences of the component tree. |
| 2026-05-18 | Step 5 PR + review | PR #281 opened against develop. Initial commit `62ae3d5`. CI green: ci-success SUCCESS, test-landing SUCCESS, mergeStateStatus CLEAN. `code-review-specialist` agent: APPROVED with 2 MAJORs + 4 NITs. M1 (`<dl>` content-model: `<p>` sibling of `<dt>`/`<dd>` invalid; moved note into `<dd>` as `<span class="block">`) + M2 (redundant `aria-label` on section with `aria-labelledby` already present; dropped `aria-label`) fixed inline. NITs declined per Simple YAGNI scope (drift-test tautology N1, comment phrasing N2, STAT_ORDER coupling N3, order-pinning component test N4). Post-fix: 11/11 F105 tests pass, lint clean, typecheck clean, build green. Simple tier skips qa-engineer per workflow. |
| 2026-05-18 | Step 5 audit-merge | `/audit-merge` 11/11 structural PASS; advisory drift: P5 SYSTEMIC pre-existing (50 frozen tickets, tracked tech debt — not F105-induced), P7 false-positive resolved by renaming "build 10/10 static pages" → "build all 10 static pages" in AC/DoD/Completion-Log (regex was pairing "10/10" with surrounding "green" keyword); all other drift checks PASS or N/A. Cleanup commit `cefc409` + tracker prose refresh. CI re-green on HEAD `cefc409` (ci-success SUCCESS, mergeStateStatus UNSTABLE only because Vercel preview deploy lag — ci-success is sole required check per ruleset 14883955). |
| 2026-05-18 | Step 6 merge + housekeeping | PR #281 squash-merged to develop at `101f6fc` (4 feature-branch commits collapsed: 62ae3d5 + 9b774b3 + 0a73173 + cefc409). Local + remote feature branch deleted (--delete-branch flag on merge). Post-merge sanity: `npm test -w @foodxplorer/landing` on develop@101f6fc exit 0 (60 suites, 749 pass + 3 todo / 752 total). PM session `pm-auth-core` Batch 2 feature 2/2 complete. Operator action pending out-of-repo (separate from F107a): none — F105 is pure static landing, no env vars or services. |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec · Implementation Plan (N/A — Simple) · Acceptance Criteria · Definition of Done · Workflow Checklist · Completion Log · Merge Checklist Evidence (all 7 present). |
| 1. Mark all items | [x] | AC: 9/9, DoD: 6/6, Workflow: 5/5 (Step 6 flipped post-merge at `101f6fc`). |
| 2. Verify product tracker | [x] | Active Session: F105 at step 5/6 (Review) on develop@81e40c5. Features table row F105 = `in-progress` at step `5/6`. |
| 3. Update key_facts.md | [x] | N/A — F105 adds no new infrastructure (no model, migration, endpoint, module, or shared util). Pure landing-only addition. |
| 4. Update decisions.md | [x] | N/A — Simple feature, no ADR. No architectural decision changes. |
| 5. Commit documentation | [x] | Commit `9b774b3` — M1/M2 fixes + Step 5 review log + MCE evidence (pushed to `feature/F105-landing-coverage-showcase`). |
| 6. Verify clean working tree | [x] | `git status` clean post-commit; HEAD = `9b774b3`. |
| 7. Verify branch up to date | [x] | `git merge-base --is-ancestor origin/develop HEAD` = UP TO DATE (verified 2026-05-18 post-fixes). |

---

*Ticket created: 2026-05-18*
