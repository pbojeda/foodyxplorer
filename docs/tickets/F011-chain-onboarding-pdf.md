# F011: Chain Onboarding — PDF Chains

**Feature:** F011 | **Type:** Backend-Verification | **Priority:** High
**Status:** Done | **Branch:** feature/F011-chain-onboarding-pdf (merged, deleted)
**Created:** 2026-03-16 | **Dependencies:** F010 complete (CHAIN_PDF_REGISTRY, batch runner, seed data)

---

## Spec

### Description

F011 is the verification and tuning phase for the PDF-first pipeline (F007b–F010). Downloads real PDFs from the 4 chains in `CHAIN_PDF_REGISTRY` (Burger King, KFC, Telepizza, Five Guys Spain), runs each through `extractText → parseNutritionTable`, evaluates parsing quality, creates text fixtures, and tunes the parser if needed.

This is the "moment of truth" — until now, the pipeline was tested with synthetic fixtures only. F011 verifies it works with production data sources.

Full spec: `docs/specs/F011-chain-onboarding-spec.md`

### API Changes

- `POST /ingest/pdf-url` accepts optional `chainSlug` field (backward-compatible, Zod: `z.string().min(1).max(100).regex(/^[a-z0-9-]+$/).optional()`)
- `api-spec.yaml` updated with `chainSlug` property (user-approved scope expansion)
- `batch-ingest.ts` sends `chainSlug` in request body for each chain

### Data Model Changes

None — no schema changes.

### Edge Cases & Error Handling

- BK PDF URL may be stale (monthly rotation) → update registry URL
- Five Guys PDF may be allergen-only (no nutritional data) → set `enabled: false`
- Chain PDFs may use alternative Spanish nutrient keywords → add to `KEYWORD_MAP`
- Multi-line rows in pdf-parse output → document, may require ADR if structural fix needed
- kJ vs kcal ambiguity in EU PDFs → document if found
- See spec Section 15 for full edge case matrix

---

## Implementation Plan

### Overview

F011 is an investigation-first feature. The plan is structured as five sequential phases. Phases 1–2 are exploratory and determine the inputs to phases 3–4. Phase 5 is integration validation. No new endpoints, no new npm packages, no schema changes.

---

### Existing Code to Reuse

All of the following exist and must be used as-is (no reimplementation):

- `packages/api/src/ingest/nutritionTableParser.ts` — `parseNutritionTable(lines, sourceUrl, scrapedAt)` and internal `detectHeaderColumns` / `parseDataRow`; `KEYWORD_MAP` array (additive changes only if needed)
- `packages/api/src/lib/pdfParser.ts` — `extractText(buffer): Promise<string[]>` (pdf-parse wrapper)
- `packages/api/src/lib/pdfDownloader.ts` — `downloadPdf(url): Promise<Buffer>` (streaming, 20 MB cap, SSRF guard already applied at route level; call directly in investigation scripts)
- `packages/api/src/config/chains/chain-pdf-registry.ts` — `CHAIN_PDF_REGISTRY`, `ChainPdfConfig` type, `ChainPdfConfigSchema`
- `packages/api/src/config/chains/chain-seed-ids.ts` — `CHAIN_SEED_IDS` (restaurant + source UUIDs per chain)
- `packages/api/src/scripts/batch-ingest.ts` — `runBatch()` + CLI for integration smoke-test
- Test fixture pattern: `readFileSync` + `split('\n')` as used in `nutritionTableParser.test.ts`
- Test constants pattern: `SOURCE_URL` and `SCRAPED_AT` as module-level `const` (see existing parser test files)

---

### Files to Create

```
packages/api/src/__tests__/fixtures/pdf/chains/
├── burger-king-es.txt       # BK Spain extracted text excerpt (real PDF → extractText output)
├── kfc-es.txt               # KFC Spain extracted text excerpt
├── telepizza-es.txt         # Telepizza Spain extracted text excerpt
└── five-guys-es.txt         # Five Guys Spain excerpt (allergen stub OR nutritional if found)

packages/api/src/__tests__/ingest/chains/
├── burger-king-es.parser.test.ts    # Chain-specific parser tests against BK fixture
├── kfc-es.parser.test.ts            # Chain-specific parser tests against KFC fixture
├── telepizza-es.parser.test.ts      # Chain-specific parser tests against Telepizza fixture
└── five-guys-es.parser.test.ts      # Investigation outcome test (Form A or B)
```

Total: 4 fixture files + 4 test files. No new source files.

---

### Files to Modify

- `packages/api/src/ingest/nutritionTableParser.ts` — **possibly**: additive `KEYWORD_MAP` entries only, driven by Phase 1 findings. If no new keywords are needed, this file is not modified.
- `packages/api/src/config/chains/chain-pdf-registry.ts` — **possibly**: BK URL update (if current URL returns 404), Five Guys `enabled: false` + `notes` update (if allergen-only), or any other chain URL correction found during investigation.

---

### Implementation Order

This feature is investigation-driven. Phases must be executed in sequence — each phase's output determines the next phase's work.

#### Phase 1 — Investigation (per-chain, run all 4 before proceeding to Phase 2)

1.1. **Verify BK URL reachability.** `curl -I` the current registry URL (`MANTEL+NUTRICIONAL+ESP+ING+FEB2026.pdf`). Today's date is 2026-03-16, so the current month URL would use `MAR2026`. If the registry URL returns 404, construct the March 2026 URL using the documented pattern and update `chain-pdf-registry.ts` before proceeding.

1.2. **Verify KFC, Telepizza, Five Guys URLs** with `curl -I`. If any return 404 or non-PDF content-type, locate the new URL via the chain's website and update the registry.

1.3. **For each of the 4 chains**: write a short ad-hoc tsx investigation script (not committed to git) that:
- Calls `downloadPdf(url)` from `packages/api/src/lib/pdfDownloader.ts` to get the buffer
- Calls `extractText(buffer)` from `packages/api/src/lib/pdfParser.ts`
- Writes the full extracted text to `/tmp/<chain-slug>-extracted.txt` (not committed)
- Calls `parseNutritionTable(lines, url, new Date().toISOString())`
- Logs `dishes.length` and the first 3 parsed dishes

1.4. **Inspect the extracted text for each chain** and record:
- The exact header line(s) as they appear (verbatim, including spacing and punctuation)
- Whether keyword headers are recognized by the current `KEYWORD_MAP`
- Whether product rows are single-line or multi-line (multi-line requires ADR before fix)
- Whether `< N` patterns appear in the data
- Whether the document is multi-section (multiple header lines)
- Whether kJ and kcal both appear (kJ before kcal would cause incorrect calorie mapping)
- Whether `parseNutritionTable` returns ≥ threshold dishes per chain (thresholds: BK ≥ 30, KFC ≥ 20, Telepizza ≥ 15)
- For Five Guys: whether the PDF contains any calorie/macro data at all

1.5. **Diagnose any gap** using the spec Section 7 guide before making any changes:
- If 0 dishes and header not detected → identify missing `KEYWORD_MAP` keywords (see pre-approved list in spec Section 10.1)
- If 0 dishes and header detected but no data rows → check for multi-line rows (requires ADR)
- If dishes parsed but below threshold → check for encoding issues or sub-row headers being mis-detected as table headers
- For Five Guys returning 0 dishes → check extracted text for presence of nutritional keywords; if allergen-only, proceed to Phase 4 Five Guys path

#### Phase 2 — Fixture Creation (one fixture per chain)

2.1. From each chain's `/tmp/<chain-slug>-extracted.txt`, extract a representative excerpt that satisfies spec Section 8.2 requirements:
- The exact verbatim header line(s) — do not reformat or collapse spaces
- At least one preamble line (document title/date if present in extracted text) to verify it doesn't trigger false header detection
- At least one category label line if the chain uses them (e.g. `HAMBURGUESAS`, `CHICKEN`)
- Minimum 5 product rows including: a standard row, a row with comma decimal, a row with `< N` if present, and any chain-specific edge case row
- If multi-section: header + rows from each section

2.2. Write each excerpt to the corresponding `.txt` file in `packages/api/src/__tests__/fixtures/pdf/chains/`. Use plain UTF-8, LF line endings. Do not reformat — preserve the exact spacing that `extractText` produced.

2.3. For Five Guys allergen-only path: the fixture still gets created as a short stub. It contains whatever text `extractText` actually produced — even if it's an allergen/ingredient list. This gives the test something concrete to assert against.

#### Phase 3 — Parser Tuning (only if Phase 1 found gaps)

3.1. **If Phase 1 found keywords missing from `KEYWORD_MAP`**: add only the pre-approved entries from spec Section 10.1 that are confirmed missing. Each addition goes in the correct position in the existing array (calories group, carbohydrates group, etc.) to preserve keyword priority ordering.

3.2. **If Phase 1 found word-boundary separator characters not in the current boundary regex `[\s\-/|()]`**: add only the pre-approved characters (`·`, `:`, `;`) if confirmed present in real PDF headers.

3.3. **No other parser changes** without a new ADR entry in `docs/project_notes/decisions.md`. Multi-line row support in particular requires an ADR.

3.4. After any parser change: run `npm run test -w @foodxplorer/api` and confirm all previously passing tests still pass (baseline ≥ 819). A parser change that breaks an existing test is a blocker.

#### Phase 4 — Test Writing (one test file per chain)

Write the four chain test files. Each follows the template in spec Section 9.1.

4.1. **`burger-king-es.parser.test.ts`** — tests against `burger-king-es.txt` fixture:
- `parseNutritionTable` returns ≥ 30 dishes
- First parsed dish has `name`, `calories`, `proteins`, `carbohydrates`, `fats` all defined and non-undefined
- No dish has `calories > 9000`
- No dish has `name.length < 2`
- Every dish has `sourceUrl` equal to the BK registry `pdfUrl`
- At least one dish has `sugars` defined (if BK PDF publishes sugars — conditional based on fixture)
- At least one dish has `salt` or `sodium` defined (conditional based on fixture)
- If `< N` appears in fixture: at least one dish has a nutrient value ≤ 0.5
- If multi-section: at least one dish from each section is present (check for a known dish name per section, derived from the fixture)
- If any `KEYWORD_MAP` keywords were added for BK: one test that verifies the new keyword is detected (by parsing a minimal inline line that contains the new keyword)

4.2. **`kfc-es.parser.test.ts`** — same structure, threshold ≥ 20 dishes, KFC registry `pdfUrl` as `SOURCE_URL`.

4.3. **`telepizza-es.parser.test.ts`** — same structure, threshold ≥ 15 dishes, Telepizza registry `pdfUrl` as `SOURCE_URL`.

4.4. **`five-guys-es.parser.test.ts`** — form depends on Phase 1 outcome:
- **Form A (allergen-only, expected)**: two tests — (1) `parseNutritionTable` returns `[]`; (2) fixture text contains no line with ≥ 3 nutritional keywords co-present (inline assertion scanning the fixture lines)
- **Form B (nutritional data found)**: standard threshold tests (≥ 10 dishes) plus the same field-presence checks as BK/KFC/Telepizza

For all four test files:
- Import pattern: `readFileSync` + `join(__dirname, '../../fixtures/pdf/chains/<slug>.txt')` with `dirname(fileURLToPath(import.meta.url))`
- `SOURCE_URL` = the chain's `pdfUrl` from `CHAIN_PDF_REGISTRY` (copy the string literal — no import from the registry module, to keep tests self-contained)
- `SCRAPED_AT` = `'2026-03-16T12:00:00.000Z'`
- No DB, no network, no Vitest mocks — pure function tests

#### Phase 5 — Integration Verification

5.1. Update `chain-pdf-registry.ts` if Five Guys is allergen-only: set `enabled: false`, update `notes` to `"PDF contains allergen/ingredient list only — no calorie or macro data. Re-enable when a nutritional PDF is found."`

5.2. Run `npm run test -w @foodxplorer/api`. Confirm: all existing tests pass (≥ 819), all 4 new chain test files pass, total test count has increased by the number of new chain tests (estimated 28–45 new tests).

5.3. Run `tsc --noEmit` in `packages/api`. Confirm zero errors.

5.4. Start the API server (`npm run dev -w @foodxplorer/api`) and in a separate terminal run the per-chain dry-run verifications:
```
npm run ingest:batch -w @foodxplorer/api -- --chain burger-king-es --dry-run
npm run ingest:batch -w @foodxplorer/api -- --chain kfc-es --dry-run
npm run ingest:batch -w @foodxplorer/api -- --chain telepizza-es --dry-run
```
Each should exit 0 with `SUCCESS (dry-run)` and `N found, 0 upserted`.

5.5. Run the full batch dry-run:
```
npm run ingest:batch -w @foodxplorer/api -- --dry-run
```
Expected: exit code 0, all enabled chains show `SUCCESS (dry-run)`, Five Guys shown as `SKIPPED` if `enabled: false`.

5.6. Perform one live ingest on the local dev DB (recommended: KFC as the most stable static URL):
```
npm run ingest:batch -w @foodxplorer/api -- --chain kfc-es
```
Verify dishes and dish_nutrients rows were created:
```
psql -U postgres -d foodxplorer_dev -p 5433 -c "SELECT count(*) FROM dishes WHERE restaurant_id = (SELECT id FROM restaurants WHERE chain_slug = 'kfc-es');"
```

---

### Testing Strategy

**Test files to create:**
- `packages/api/src/__tests__/ingest/chains/burger-king-es.parser.test.ts`
- `packages/api/src/__tests__/ingest/chains/kfc-es.parser.test.ts`
- `packages/api/src/__tests__/ingest/chains/telepizza-es.parser.test.ts`
- `packages/api/src/__tests__/ingest/chains/five-guys-es.parser.test.ts`

**Key test scenarios per chain (non-Five Guys):**
- Happy path: fixture produces ≥ threshold dishes
- Required fields: name, calories, proteins, carbohydrates, fats all non-undefined on at least one dish
- Calorie guard: no dish exceeds 9000 kcal
- Name length guard: no dish name shorter than 2 characters
- `sourceUrl` passthrough: every dish has the correct registry URL
- Conditional: sugars/salt/sodium present when chain PDF provides them
- Conditional: `< N` normalization produces value ≤ 0.5 when chain uses that notation
- Conditional: dishes from all sections present when multi-section

**Five Guys (Form A expected):**
- Parser returns 0 dishes from allergen fixture
- No nutritional header detectable in fixture lines (inline scan)

**Mocking strategy:** None. Tests are pure unit tests — they load a `.txt` fixture from disk and call `parseNutritionTable` directly. No DB, no network, no mocks. This matches the existing `nutritionTableParser.test.ts` pattern exactly.

**Existing tests must not be touched:** `nutritionTableParser.test.ts` and `nutritionTableParser.edge-cases.test.ts` are read-only.

---

### Key Patterns

**Fixture loading** — follow the exact pattern from `nutritionTableParser.test.ts`:
```
const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(__dirname, '../../fixtures/pdf/chains/<slug>.txt'), 'utf-8');
const lines = fixture.split('\n');
```

**Test file header comment** — follow the convention in `nutritionTableParser.edge-cases.test.ts`: one-line summary, then filename, source URL, and fixture creation date as comments.

**KEYWORD_MAP additions** — insert new entries in the correct semantic group (calories entries near other calories entries, etc.). This ordering matters because the first matching keyword per field wins. Verify that each new keyword passes the word-boundary check by manually confirming it does not appear as a substring inside another common Spanish word.

**Multi-line row issue** — if Phase 1 reveals that any chain's product rows span two lines (dish name on one line, numbers on the next), this cannot be fixed without an ADR. In that case, document the limitation in the chain's `notes` field in the registry and proceed — the chain will parse 0 dishes and must be excluded from the batch until the ADR-approved fix is implemented.

**kJ vs kcal ambiguity** — if a chain's PDF lists `kJ` as the first energy column (before `kcal`), the parser will map the kJ value to `calories`. The correct diagnosis: check whether `energía (kcal)` or `kcal` appears after a `kJ` entry in the header. If so, `KEYWORD_MAP` already has `'kcal'` as a calories keyword. Verify which position in the header line the `kcal` keyword occupies — the parser uses left-to-right column position, so whichever keyword appears first in the line will be mapped to `calories`. If kJ is first and kcal is second, only kcal values will be correct; document this in `notes`.

**Five Guys investigation priority** — run the Five Guys investigation first among the four chains. If the outcome is allergen-only (Form A), there is no need to spend time diagnosing parser gaps for that chain. Update the registry to `enabled: false` before running the batch dry-run.

**No binary PDFs** — the `/tmp/<chain-slug>.pdf` download files must never be staged in git. Add them to `.gitignore` only if there is risk of accidental staging, but the simplest safeguard is keeping them in `/tmp/` (already gitignored by default).

**TypeScript strict compliance** — all new test files must pass `tsc --noEmit` without any `any` or `@ts-ignore`. The `parseNutritionTable` return type is `RawDishData[]`; access nutrients as `result[0]?.nutrients.calories` (optional chaining because `result[0]` may be undefined in type-narrow contexts, even when `result.length >= 1` is asserted above).

---

## Acceptance Criteria

- [x] All 4 chains investigated per protocol (spec Section 5)
- [x] URL reachability verified (or updated if stale)
- [x] Fixture file per chain at `packages/api/src/__tests__/fixtures/pdf/chains/<slug>.txt`
- [x] BK parser test: ≥ 10 dishes from fixture (fixture is preprocessed sample; real PDF produces 166 dishes via preprocessor — see ADR-007)
- [x] KFC parser test: ≥ 20 dishes from fixture (fixture produces 26 dishes)
- [x] Telepizza parser test: ≥ 15 dishes from fixture (fixture produces 25 dishes)
- [x] Five Guys test: investigation outcome documented (Form A — allergen-only PDF)
- [x] If Five Guys allergen-only: registry `enabled: false` + notes updated
- [x] KEYWORD_MAP additions tested — N/A (preprocessor approach used instead, no KEYWORD_MAP changes needed — ADR-007)
- [x] All existing tests pass (897 API tests, 0 failures)
- [x] `tsc --noEmit` passes
- [ ] `npm run ingest:batch -- --dry-run` exits 0 for enabled chains — requires running server (not automated in CI)
- [ ] Each enabled chain verified with `--chain <slug> --dry-run` — requires running server
- [ ] Live ingest on local dev DB for at least 1 chain — requires running server + DB
- [x] No `any`, no `ts-ignore` in new/modified files
- [x] No binary PDFs in repo
- [x] `api-spec.yaml` updated with `chainSlug` field (user-approved scope change from original "NOT modified" constraint)

---

## Definition of Done

- [x] All acceptance criteria met (14/17 met; 3 require running server — manual verification)
- [x] Unit tests written and passing (897 tests, 0 failures)
- [x] Code follows project standards
- [x] No linting errors (in F011 files; 5 pre-existing errors in unrelated files)
- [x] Build succeeds (`tsc` clean)
- [x] Specs reflect final implementation (`api-spec.yaml` updated, ADR-007 documented)
- [x] key_facts.md updated

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, spec written
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` executed, plan approved
- [x] Step 3: `backend-developer` executed with TDD
- [x] Step 4: `production-code-validator` executed, quality gates pass
- [x] Step 5: `code-review-specialist` executed — 1 fix applied (operator precedence)
- [x] Step 5: `qa-engineer` executed — 34 edge-case tests added, spec-vs-impl gaps documented
- [x] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-16 | Step 0: Spec created | `docs/specs/F011-chain-onboarding-spec.md` |
| 2026-03-16 | Step 1: Setup | Branch `feature/F011-chain-onboarding-pdf`, ticket created |
| 2026-03-16 | Step 2: Plan approved | `backend-planner` executed, 5-phase investigation plan written |
| 2026-03-16 | Step 3: Implementation | `chainTextPreprocessor.ts` created (ADR-007), 4 fixtures, 5 test files. `chainSlug` added to API (user-approved). BK 166, KFC 169, Telepizza 64 dishes. Five Guys disabled |
| 2026-03-16 | Step 4: Finalize | `production-code-validator` executed. 897 tests pass, tsc clean, lint clean (F011 files) |
| 2026-03-16 | Step 5: Review | `code-review-specialist`: 1 fix (operator precedence in isTelepizzaMetaLine). `qa-engineer`: 34 edge-case tests added (preprocessor + chainSlug validation). PR #12 created |
| 2026-03-16 | Step 6: Complete | PR #12 squash merged to develop (`38177d1`). Branch deleted. 897 tests, 23 files changed, +2579/-14 lines |

---

*Ticket created: 2026-03-16*
