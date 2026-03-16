# F011 — Chain Onboarding — PDF Chains

**Feature:** F011 | **Type:** Backend-Verification | **Priority:** High
**Status:** Pending | **Epic:** E002 — Data Ingestion Pipeline
**Created:** 2026-03-16 | **Dependencies:** F010 complete (CHAIN_PDF_REGISTRY, batch runner, seed data)

---

## 1. Purpose

F011 is the validation and tuning phase for the PDF-first pipeline established in F007b–F010. It downloads real PDFs from the four chains already registered in `CHAIN_PDF_REGISTRY` (Burger King Spain, KFC Spain, Telepizza Spain, Five Guys Spain), runs each through the existing `extractText → parseNutritionTable` pipeline, evaluates parsing quality, and creates representative text fixtures that permanently document how each chain's PDF looks to the parser.

If any chain's PDF produces unexpected output (wrong column mapping, 0 dishes, malformed names), this spec defines what parser changes are acceptable and what the acceptance threshold is before F011 is considered complete.

The strategic goal: after F011, `npm run ingest:batch -w @foodxplorer/api` runs on all four chains and produces real nutritional data in the database. F011 is the moment the PDF pipeline moves from "plumbed but untested with real data" to "verified with production sources."

---

## 2. Scope Boundaries

**In scope:**

- Manual investigation: download each chain's PDF, run it through `extractText` + `parseNutritionTable`, inspect output
- Text fixture creation: one `.txt` fixture file per chain in `packages/api/src/__tests__/fixtures/pdf/chains/`
- Parser tuning in `nutritionTableParser.ts` — only if a real PDF exposes a gap. Any change must not break the existing test suite (currently 819 API tests, all green)
- Five Guys investigation: determine whether `fiveguys.es` allergen PDF contains structured nutritional data (calories, macros) or only allergen/ingredient lists
- Chain-specific unit tests: `packages/api/src/__tests__/ingest/chains/` — one test file per chain, testing against the fixture
- Integration smoke-test: `npm run ingest:batch -w @foodxplorer/api -- --dry-run` runs end-to-end for all chains that have full nutritional data
- Documentation of any known parser limitations per chain in each chain's `notes` field in `CHAIN_PDF_REGISTRY`

**Out of scope:**

- Domino's Spain — JPEG images, not PDF (F012)
- New chains beyond the four already in the registry
- URL discovery automation (BK monthly URL must be verified manually)
- Cron/scheduled execution (Phase 2)
- Any frontend changes
- New API endpoints — F011 is fixtures + tests + optional parser tuning only
- `docs/specs/api-spec.yaml` — not modified

---

## 3. Architectural Decisions

### 3.1 Text fixtures only — no binary PDFs in the repository

**Decision:** The test fixtures for each chain are `.txt` files containing representative extracted text, NOT the binary PDF files themselves.

**Rationale:**

- Binary PDFs range from 200 KB to several MB. Large binary files bloat git history permanently and slow clone times.
- The pipeline under test is `parseNutritionTable(lines, ...)` — a pure function that takes `string[]`. The relevant test input is the text the parser actually receives, not the PDF bytes.
- `extractText` (pdf-parse wrapper) is already tested separately via its own unit tests and through the `POST /ingest/pdf` and `POST /ingest/pdf-url` route integration tests.
- A text fixture that captures the structure of a real chain's table is a stable, reviewable artifact. A binary PDF is not diffable in code review.

**Fixture creation process:** The implementer downloads each PDF manually, runs `extractText(buffer)`, captures the relevant page(s) as text, then hand-crafts a representative excerpt that preserves the actual column headers and a representative sample of product rows. The fixture does not need to be the full document — 10–30 rows that represent the column structure, header style, and any known edge cases (e.g. `< 1` values, bilingual headers, multi-section layout) are sufficient.

### 3.2 Parser changes are minimally invasive — keyword additions only where possible

**Decision:** If a chain's PDF uses a nutrient header term not currently in `KEYWORD_MAP`, the fix is to add that keyword to the existing map. Structural changes to `detectHeaderColumns` or `parseDataRow` algorithms require a separate documented rationale.

**Rationale:**

The heuristic parser was designed to be keyword-extensible (the `KEYWORD_MAP` array). Adding new entries is a low-risk, additive change that cannot break existing keyword detection. Structural changes to the parsing algorithm (e.g. changing the minimum keyword threshold from 3, changing how tokens are mapped to columns, or changing the `< N` normalization rule) have a higher risk of breaking existing tests and require explicit justification.

**Acceptable parser changes for F011:**
- Adding new keyword entries to `KEYWORD_MAP` (e.g. `'kcal/100g'`, `'valor energético'`, `'v. energético'`)
- Extending the word-boundary regex if a new separator character appears in real PDFs (e.g. `|`, `·`)

**Changes requiring explicit ADR addition before implementation:**
- Changing the minimum keyword threshold (currently 3)
- Changing the `< N` normalization rule
- Adding multi-line row support
- Changing how the dish name is extracted (currently: text before first numeric token)

### 3.3 Five Guys investigation — allergen-only PDF triggers `enabled: false` or separate source

**Decision:** If the Five Guys Spain PDF (`FGES_ES_allergen-ingredients_print-SP_A4_20260303.pdf`) does not contain structured calorie/macro data (only allergen/ingredient lists), then:

1. The chain entry in `CHAIN_PDF_REGISTRY` has its `enabled` field set to `false`
2. The `notes` field is updated to explain the gap: `"PDF contains allergen/ingredient list only — no calorie or macro data. Re-enable when a nutritional PDF is found."`
3. F011 acceptance criteria for Five Guys is: "investigation complete, outcome documented, registry updated accordingly"

No parser changes are expected for an allergen-only PDF — the parser simply returns 0 dishes (no nutritional header detectable), and the batch runner records `NO_NUTRITIONAL_DATA_FOUND`. The spec does not require engineering a workaround for allergen data; that is a separate product decision.

### 3.4 One fixture file per chain — representative excerpt, not full document

**Decision:** Each fixture is a standalone `.txt` file in `packages/api/src/__tests__/fixtures/pdf/chains/`. The file contains enough rows to be representative but does not need to reproduce the full PDF text output.

**Minimum fixture content per chain:**
- The exact header line(s) as they appear in the extracted text
- At minimum 5 product rows covering: a standard row, a row with a comma decimal, a row with a `< N` value (if the chain uses this notation), and any row that exercises a chain-specific edge case
- If the PDF is multi-section, at least one header + rows from each section

**Fixture naming convention:**
```
packages/api/src/__tests__/fixtures/pdf/chains/
├── burger-king-es.txt
├── kfc-es.txt
├── telepizza-es.txt
└── five-guys-es.txt          # may be a short "no nutritional data" stub if allergen-only
```

### 3.5 Chain-specific tests are separate from the existing parser tests

**Decision:** New tests go in `packages/api/src/__tests__/ingest/chains/`, not in the existing `nutritionTableParser.test.ts` or `nutritionTableParser.edge-cases.test.ts`.

**Rationale:** The existing tests are generic parser validation tests that should remain stable regardless of which real-world chains are onboarded. Chain-specific tests (which depend on real chain fixture data) belong in a separate directory so that adding a new chain does not require modifying the core parser test files. This also makes it clear which tests are generic vs. chain-specific when reviewing CI output.

---

## 4. File Structure

```
packages/api/src/__tests__/
├── fixtures/
│   └── pdf/
│       └── chains/                            # NEW — real-chain text fixtures
│           ├── burger-king-es.txt             # NEW
│           ├── kfc-es.txt                     # NEW
│           ├── telepizza-es.txt               # NEW
│           └── five-guys-es.txt               # NEW (allergen stub if no macro data)
└── ingest/
    └── chains/                                # NEW — chain-specific parser tests
        ├── burger-king-es.parser.test.ts      # NEW
        ├── kfc-es.parser.test.ts              # NEW
        ├── telepizza-es.parser.test.ts        # NEW
        └── five-guys-es.parser.test.ts        # NEW (investigation-outcome test)

packages/api/src/
└── ingest/
    └── nutritionTableParser.ts                # POSSIBLY MODIFIED — keyword additions only

packages/api/src/config/chains/
└── chain-pdf-registry.ts                      # POSSIBLY MODIFIED — notes/enabled updates
```

No new source files outside of test fixtures and test files. No new scripts. No new npm packages.

---

## 5. Investigation Protocol

The implementer must follow this protocol for each chain before writing any tests or making any parser changes.

### 5.1 Per-chain investigation steps

```
For each chain in CHAIN_PDF_REGISTRY (where enabled === true):

1. Verify PDF URL is reachable:
   curl -I "<pdfUrl>"
   Expected: HTTP 200, Content-Type: application/pdf or application/octet-stream

2. Download PDF to a local temp file (NOT committed to git):
   curl -L -o /tmp/<chain-slug>.pdf "<pdfUrl>"

3. Run extractText and capture output:
   # ad-hoc tsx script (not committed):
   import { extractText } from './packages/api/src/lib/pdfParser.js';
   const buf = fs.readFileSync('/tmp/<chain-slug>.pdf');
   const pages = await extractText(buf);
   fs.writeFileSync('/tmp/<chain-slug>-extracted.txt', pages.join('\n---PAGE BREAK---\n'));

4. Inspect extracted text:
   - Are column headers recognisable? (present as a single line?)
   - Are header keywords covered by KEYWORD_MAP?
   - Are product rows on individual lines? (or do they span multiple lines?)
   - Are numeric values space-separated on the same line as the dish name?
   - Are any "< N" patterns present?
   - Is the document multi-section? (multiple header lines?)
   - Are any Unicode characters in headers not covered by KEYWORD_MAP?

5. Run parseNutritionTable on the extracted lines:
   const lines = pages.join('\n').split('\n');
   const dishes = parseNutritionTable(lines, '<chain-url>', new Date().toISOString());
   console.log(`Parsed ${dishes.length} dishes`);
   console.log(dishes.slice(0, 3));   // inspect first 3

6. Evaluate result against acceptance thresholds (Section 6):
   - If dishes.length >= threshold → parser works, proceed to fixture creation
   - If dishes.length === 0 → diagnose root cause (Section 7)
   - If dishes.length > 0 but < threshold → partial parse, diagnose

7. Create the fixture file (Section 8).

8. Write the chain test file (Section 9).

9. If parser changes were needed, verify all 819 existing tests still pass:
   npm run test -w @foodxplorer/api
```

### 5.2 BK URL verification

Burger King Spain's PDF URL changes monthly (S3 path includes month + year). Before running step 1, verify the URL in the registry matches the current month:

- Current registry URL: `MANTEL+NUTRICIONAL+ESP+ING+FEB2026.pdf` (February 2026 pattern)
- Pattern: `/en-ES/YYYY/Nutritional+Information/MANTEL+NUTRICIONAL+ESP+ING+[MON][YYYY].pdf`
- If a 404 is returned, construct the current month's URL using the documented pattern, verify it resolves, and update `chain-pdf-registry.ts` accordingly before proceeding

---

## 6. Acceptance Thresholds

These thresholds define when parsing quality is sufficient. They are deliberately conservative (not maximums) to allow for section footers, page headers, and non-product rows that the parser may include or skip.

| Chain | Minimum dishes | Required nutrients | Notes |
|-------|---------------|-------------------|-------|
| Burger King Spain | 30 | calories, proteins, carbohydrates, fats | BK's PDF is large (full national menu). Expect 50+ products but 30 is the bar. |
| KFC Spain | 20 | calories, proteins, carbohydrates, fats | Smaller menu than BK. |
| Telepizza Spain | 15 | calories, proteins, carbohydrates, fats | Pizza-focused menu. Expect category rows to be skipped cleanly. |
| Five Guys Spain | N/A — allergen investigation | N/A | If allergen-only: 0 dishes expected + investigation documented. If nutritional data found: 10 dishes minimum. |

**Required nutrients definition:** For a dish to count toward the threshold, `nutrients.calories`, `nutrients.proteins`, `nutrients.carbohydrates`, and `nutrients.fats` must all be defined and non-zero (calories may be 0 for water-like items, but the field must be mapped from the header).

**Nutrient completeness:** If a chain's PDF includes `sugars`, `fiber`, or `salt` columns, those fields should appear on parsed dishes where the chain provides them. There is no minimum completeness threshold for optional nutrients — their presence is a bonus, not a requirement.

---

## 7. Parser Gap Diagnosis Guide

If `parseNutritionTable` returns 0 dishes or fewer than the threshold for a chain, the implementer should diagnose using this guide before making any changes.

### 7.1 Zero dishes — header not detected

**Symptom:** `parseNutritionTable` returns `[]`.

**Likely cause:** The extracted text places column headers on a line that does not contain ≥ 3 keywords from `KEYWORD_MAP`.

**Investigation:**
1. Find the header line in the extracted text (e.g. grep for "Calorías", "Energía", "Kcal")
2. Run `detectHeaderColumns` (extract the logic manually for inspection) on that exact line
3. If < 3 keywords match, identify which keywords are missing from `KEYWORD_MAP`

**Common gaps to expect from Spanish fast-food PDFs:**
- `'valor energético'` / `'v. energético'` — alternative for calories in Spanish regulatory PDFs
- `'energía (kcal)'` — common in EU-compliant nutrition tables
- `'h. de carbono'` / `'h.c.'` — abbreviated carbohydrates header
- `'de las cuales'` / `'del cual'` — subcategory row headers (sugars under carbs, saturates under fat) — these should NOT be added as primary field keywords; they typically appear as sub-rows, not main headers

**Fix:** Add missing keywords to `KEYWORD_MAP` in `nutritionTableParser.ts`. Each addition must have a corresponding test in the chain's test file that verifies the keyword is now detected.

### 7.2 Zero dishes — multi-line rows

**Symptom:** Header is detected correctly (verified by step 7.1), but no data rows are parsed.

**Likely cause:** Product rows span multiple lines in the extracted PDF text (a common pdf-parse artefact when columns are far apart or the PDF uses absolute-positioned text boxes).

**Example of multi-line row:**
```
Whopper
          550  28  48  26  8  2,5
```

**Diagnosis:** In the extracted text, check if product rows appear as two-line blocks instead of single lines.

**Proposed fix (if confirmed):** This is a structural parser change requiring a documented ADR addition before implementation. The approach: after detecting a header, if a data row has no text before the first numeric token (i.e. the line starts with a number), try to prepend the previous non-empty line as the dish name. This is a speculative fix — the exact algorithm must be designed based on what the real extracted text looks like.

### 7.3 Dishes parsed but count below threshold

**Symptom:** `dishes.length > 0` but below the chain's minimum.

**Likely cause A:** Section headers / category lines (e.g. "BURGERS", "CHICKEN", "SIDES") are being rejected by the parser (correct behavior — they have no numeric tokens).

**Likely cause B:** Some product rows have fewer than 4 numeric tokens (e.g. the chain omits fiber and salt for some items).

**Likely cause C:** Encoding issue — accented characters in dish names are being extracted as replacement characters (`?` or `□`), causing the name-length guard to fail.

**Investigation:** Print all rows that `parseDataRow` rejects. For each rejection, identify whether it's a legitimate skip (category header) or a real product being skipped (encoding issue, too few tokens).

**Fix for B:** The 4-token minimum is a guard against false positives (category rows, footnotes). It is not tunable per-chain. If a chain consistently provides only 3 nutrients per dish, this is a data quality issue, not a parser gap.

**Fix for C:** Verify the PDF was extracted with UTF-8. If pdf-parse is corrupting non-ASCII characters, check the pdf-parse version and the PDF encoding. This is an `extractText` issue, not a `parseNutritionTable` issue.

### 7.4 Five Guys — allergen-only PDF

**Symptom:** `parseNutritionTable` returns `[]` for Five Guys and the extracted text contains only allergen/ingredient data (allergen icons, "contains gluten", ingredient lists) with no calorie or macro numbers.

**Expected behavior:** This is NOT a parser failure. The parser correctly returns 0 dishes because there is no nutritional table. The correct action is to document this (Section 3.3 decision) and set `enabled: false` in the registry.

---

## 8. Fixture File Specification

Each fixture file must satisfy these requirements:

### 8.1 Format

- Plain UTF-8 text, LF line endings
- Represents the actual text output of `extractText(buffer)` for the chain's PDF, not reformatted
- Column values separated by spaces (as pdf-parse typically outputs them)
- Dish names may contain spaces (dish name is everything before the first numeric token)

### 8.2 Content requirements

Each fixture must include:

| Requirement | Purpose |
|-------------|---------|
| At least one header line, verbatim as extracted from the PDF | Tests that the parser detects the chain's specific header vocabulary |
| Minimum 5 product rows | Tests that data rows are parsed correctly |
| At least 1 row with a comma decimal separator (`1,5` not `1.5`) | Verifies locale-aware parsing |
| At least 1 row with a `< N` value, if present in the chain's PDF | Verifies `< N` normalization |
| If multi-section: at least 2 section headers + rows from each section | Verifies column reset behavior |
| Preamble text (document title, date, chain name) if present | Tests that preamble doesn't falsely trigger header detection |
| At least 1 category label line if the chain uses category separators (e.g. "BURGERS") | Tests that category lines are correctly skipped |

### 8.3 Fixture file template

```
[chain name and document title as it appears in extracted text — verbatim]
[optional date / version line if present in PDF]

[category header if present — e.g. "HAMBURGUESAS" or "BURGERS"]
[header line — verbatim from extracted text, e.g. "Calorías  Proteínas  Hidratos  Grasas  Azúcares  Fibra  Sal"]
[product row 1]
[product row 2]
[product row 3]
...
[additional category + rows if multi-section]
```

### 8.4 Example structure (illustrative — actual content derived from real PDFs)

```
# burger-king-es.txt (illustrative structure only)
BURGER KING ESPAÑA — INFORMACIÓN NUTRICIONAL — FEBRERO 2026
Por ración / Per serving

HAMBURGUESAS / BURGERS
Calorías  Proteínas  Hidratos  Grasas  Azúcares  Fibra  Sal
Whopper               550  28,0  48,0  26,0  8,0  2,0  2,5
Whopper con queso     620  34,0  50,0  30,0  9,0  2,0  2,8
Double Whopper        750  45,0  49,0  38,0  8,5  2,0  3,1
...

POLLO / CHICKEN
Calorías  Proteínas  Hidratos  Grasas  Azúcares  Fibra  Sal
Chicken Royale        490  27,0  46,0  22,0  5,0  2,5  2,2
...
```

Note: the above is illustrative. The actual fixture content is determined by what `extractText` produces on the real PDF.

---

## 9. Chain-Specific Test Specification

### 9.1 Test file structure (per chain)

Each test file in `packages/api/src/__tests__/ingest/chains/` follows this structure:

```typescript
// <chain-slug>.parser.test.ts
// Parser integration test for <Chain Name> Spain fixture.
// Fixture: packages/api/src/__tests__/fixtures/pdf/chains/<chain-slug>.txt
// Real PDF source: <pdfUrl from registry>
// Fixture created: <YYYY-MM-DD>

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseNutritionTable } from '../../../ingest/nutritionTableParser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(
  join(__dirname, '../../fixtures/pdf/chains/<chain-slug>.txt'),
  'utf-8',
);
const lines = fixture.split('\n');
const SOURCE_URL = '<pdfUrl from registry>';
const SCRAPED_AT = '2026-03-16T12:00:00.000Z';

describe('<Chain Name> Spain — parser integration', () => {
  // ... tests defined below
});
```

### 9.2 Required tests per chain (non-Five-Guys chains)

Each chain test file must contain at minimum:

| Test | Expected |
|------|----------|
| `parseNutritionTable` returns at least N dishes (N = chain threshold) | `result.length >= N` |
| First dish has name, calories, proteins, carbohydrates, fats defined | All 4 fields non-undefined |
| No dish has `calories > 9000` | All dishes pass the `normalizeNutrients` calorie guard |
| No dish has a name shorter than 2 characters | `dish.name.length >= 2` for all |
| `sourceUrl` on every dish equals the registry URL | All match |
| At least one dish has `sugars` defined (if chain publishes sugars) | Conditional |
| At least one dish has `salt` or `sodium` defined (if chain publishes either) | Conditional |
| If chain uses `< N` notation: at least one dish has a nutrient value ≤ 0.5 | Conditional |
| If chain is multi-section: dishes from both sections are present | Check for known dish names from each section |

### 9.3 Five Guys Spain test

The Five Guys test documents the investigation outcome. One of two forms:

**Form A (if allergen-only — expected case):**
```typescript
describe('Five Guys Spain — allergen PDF investigation', () => {
  it('returns 0 dishes — PDF is allergen/ingredient list, not nutritional table', () => {
    const result = parseNutritionTable(lines, SOURCE_URL, SCRAPED_AT);
    expect(result).toHaveLength(0);
  });

  it('fixture confirms no nutritional header is present in extracted text', () => {
    // Verify that none of the core nutrient keywords appear on the same line as 3+ others
    const hasNutritionalHeader = lines.some((line) => {
      const lower = line.toLowerCase();
      const nutritionalKeywords = ['calorías', 'proteínas', 'grasas', 'hidratos', 'calories', 'protein', 'fat'];
      return nutritionalKeywords.filter((kw) => lower.includes(kw)).length >= 3;
    });
    expect(hasNutritionalHeader).toBe(false);
  });
});
```

**Form B (if nutritional data found — less likely):**
```typescript
describe('Five Guys Spain — nutritional PDF', () => {
  it('returns at least 10 dishes', () => {
    const result = parseNutritionTable(lines, SOURCE_URL, SCRAPED_AT);
    expect(result.length).toBeGreaterThanOrEqual(10);
  });
  // ... standard nutrient field tests
});
```

### 9.4 Naming and file placement

```
packages/api/src/__tests__/ingest/chains/
├── burger-king-es.parser.test.ts
├── kfc-es.parser.test.ts
├── telepizza-es.parser.test.ts
└── five-guys-es.parser.test.ts
```

Test IDs in Vitest output will appear as:
```
ingest/chains/burger-king-es.parser > Burger King Spain — parser integration > ...
```

---

## 10. Parser Changes Specification

### 10.1 KEYWORD_MAP additions (if needed)

If investigation reveals that a chain uses alternative header terms not currently in `KEYWORD_MAP`, the following additions are pre-approved (may be added without further spec changes):

| Keyword | Field | Reason |
|---------|-------|--------|
| `'valor energético'` | `calories` | EU-compliant nutrition tables often use "valor energético" for the energy column |
| `'v. energético'` | `calories` | Abbreviated form of the above |
| `'energía (kcal)'` | `calories` | Energy column with unit in parentheses |
| `'h. de carbono'` | `carbohydrates` | Abbreviated carbohydrates (common in space-constrained Spanish PDFs) |
| `'h.c.'` | `carbohydrates` | Ultra-abbreviated carbohydrates |
| `'de carbono'` | `carbohydrates` | Suffix of "hidratos de carbono" if extracted as two tokens and "hidratos" is not present |
| `'ac. grasos saturados'` | `saturatedFats` | Full Spanish regulatory label for saturated fatty acids |
| `'ag. saturados'` | `saturatedFats` | Abbreviated version |

Each addition must be validated against the word-boundary check: it must not match as a substring inside a longer word.

### 10.2 Word boundary character extension (if needed)

If real PDFs use separator characters not in the current boundary regex `[\s\-/|()]`, they may be added. Current regex:
```
/[\s\-/|()]/
```

Pre-approved additions if found in real PDFs: `·` (middle dot), `:`, `;`

### 10.3 Changes requiring explicit ADR before implementation

The following are NOT pre-approved and require a new ADR entry in `docs/project_notes/decisions.md` before implementation:

- Changing the minimum keyword threshold for header detection (currently 3)
- Adding multi-line row support (dish name on one line, nutrients on next)
- Changing the `< N` normalization formula
- Changing the numeric token count minimum (currently 4)
- Any change to how dish names are extracted from data rows

### 10.4 Impact assessment — existing tests

Any change to `nutritionTableParser.ts` must pass the full existing test suite before being merged:

```bash
npm run test -w @foodxplorer/api
```

The current baseline is 819 API tests, all passing. F011 must not reduce this count. The new chain-specific tests will add to this count.

---

## 11. Integration Verification

After all chain fixtures are created and all chain tests pass, the implementer must verify the full batch pipeline end-to-end:

### 11.1 Dry-run batch (mandatory)

```bash
# API server must be running
npm run dev -w @foodxplorer/api

# In a separate terminal:
npm run ingest:batch -w @foodxplorer/api -- --dry-run
```

**Expected output:**
```
========================================
Batch Ingest Summary  [dry-run: yes]
<timestamp>
========================================
  burger-king-es   SUCCESS (dry-run)   N found, 0 upserted, M skipped
  kfc-es           SUCCESS (dry-run)   N found, 0 upserted, M skipped
  telepizza-es     SUCCESS (dry-run)   N found, 0 upserted, M skipped
  five-guys-es     [SKIPPED if enabled:false, or SUCCESS if nutritional PDF found]
========================================
Total: N success, 0 failed
Exit code: 0
========================================
```

For chains where `enabled: false` (Five Guys if allergen-only): the batch runner skips them silently (existing behavior per F010 spec). The expected exit code is still 0 if all enabled chains succeed.

### 11.2 Single-chain dry-run (per chain)

Each chain should also be verified independently:

```bash
npm run ingest:batch -w @foodxplorer/api -- --chain burger-king-es --dry-run
npm run ingest:batch -w @foodxplorer/api -- --chain kfc-es --dry-run
npm run ingest:batch -w @foodxplorer/api -- --chain telepizza-es --dry-run
```

### 11.3 Live ingest (optional — local dev DB only)

After dry-run verification, a single live ingest run on the local dev database is recommended to confirm the full pipeline including DB writes:

```bash
npm run ingest:batch -w @foodxplorer/api -- --chain kfc-es
```

KFC is recommended for the first live run (static URL, most stable, smaller dataset than BK).

**Expected:** Exit code 0, dishes and dish_nutrients rows created in the local DB, verifiable via:
```bash
npm run db:studio -w @foodxplorer/api
# Or: psql -U postgres -d foodxplorer_dev -c "SELECT count(*) FROM dishes WHERE restaurant_id = '00000000-0000-0000-0006-000000000011';"
```

---

## 12. Testing Strategy

### 12.1 New tests added by F011

| File | Test type | Count (estimated) |
|------|-----------|-------------------|
| `ingest/chains/burger-king-es.parser.test.ts` | Unit (fixture-based) | 8–12 |
| `ingest/chains/kfc-es.parser.test.ts` | Unit (fixture-based) | 8–12 |
| `ingest/chains/telepizza-es.parser.test.ts` | Unit (fixture-based) | 8–12 |
| `ingest/chains/five-guys-es.parser.test.ts` | Unit (fixture-based, outcome doc) | 2–5 |
| If parser tuned: new keyword tests in chain test files | Unit | 2–4 per new keyword |

Estimated total new tests: **28–45**. Final count depends on how many chain-specific edge cases are found during investigation.

### 12.2 Existing tests must continue passing

No existing test may be modified to accommodate F011. The rule:

- `nutritionTableParser.test.ts` — must remain 100% unchanged
- `nutritionTableParser.edge-cases.test.ts` — must remain 100% unchanged
- All other existing test files — unchanged

The only permitted modifications to existing source files are additive changes to `KEYWORD_MAP` in `nutritionTableParser.ts` and `notes`/`enabled` updates in `chain-pdf-registry.ts`.

### 12.3 Test isolation

Chain-specific tests are pure unit tests (no DB, no network, no running API server). They load the fixture file from disk and call `parseNutritionTable` directly. No Vitest mocks required.

---

## 13. OpenAPI / API Spec Changes

None. F011 adds no new API endpoints. `docs/specs/api-spec.yaml` is not modified.

---

## 14. New Dependencies

None. F011 uses only:
- `parseNutritionTable` — already in `packages/api/src/ingest/nutritionTableParser.ts`
- `readFileSync` — Node.js built-in
- Vitest — already a dev dependency

No new npm packages.

---

## 15. Edge Cases

| Scenario | Expected behaviour |
|----------|-------------------|
| BK PDF URL is stale (monthly rotation) | Investigation step 1 fails with HTTP 404. Implementer constructs current month URL using documented pattern and updates registry before proceeding. |
| KFC PDF redirects to a login or landing page (HTML response) | `extractText` throws `UNSUPPORTED_PDF` or the text contains no nutritional headers. Diagnose per Section 7. |
| Telepizza CDN URL returns 404 | Investigation step 1 fails. Implementer must find new URL via Telepizza's website and update registry. |
| Five Guys PDF contains ONLY allergen icons (image-based allergen markers) with text ingredient list but no calorie numbers | `parseNutritionTable` returns 0 dishes. Document as Form A (Section 9.3). |
| Five Guys PDF contains both allergen section AND a separate nutritional table | Parse returns dishes from the nutritional section. Use Form B test. |
| A chain's PDF uses two-level headers: a main header row + a sub-header row (e.g. "De las cuales" under "Grasas") | Sub-header row has ≥ 3 nutrient keywords → falsely detected as a section header, resetting column state. This is a known parser limitation. Document in the chain's `notes` field. |
| Parsed dish name includes the chain's brand name prefix (e.g. "BK Whopper" when column headers are on a separate line from category) | Dish name is used as-is; no stripping. Consistent with how McDonald's scraper handles it. |
| A product row contains a kJ value before kcal (EU PDFs sometimes list both) | kJ value is parsed as the first numeric token; if the kcal column is second, calorie value may be incorrect (kJ ≠ kcal). This is a potential gap — document if found and add to Section 7 diagnosis guide. |
| pdf-parse produces garbled Unicode for Spanish characters in a specific PDF | `extractText` returns text with `?` or `□` replacing `á`, `é`, `ñ`. Parser may still work if column headers survive. Document per-chain. If dish names are garbled, this is a data quality issue, not a parser issue. |
| Parser returns correct dishes but `normalizeNutrients` skips all of them (missing required fields) | `dishesFound > 0`, `dishesSkipped = dishesFound`, `dishesUpserted = 0`. Root cause: parser maps wrong columns. Investigate header detection. |

---

## 16. Acceptance Criteria

- [ ] All four chains have been manually investigated using the protocol in Section 5
- [ ] URL reachability verified for all four chains (or updated in registry if stale)
- [ ] Fixture file created for each chain at `packages/api/src/__tests__/fixtures/pdf/chains/<chain-slug>.txt`
- [ ] `burger-king-es.parser.test.ts` passes — `parseNutritionTable` returns ≥ 30 dishes from the BK fixture
- [ ] `kfc-es.parser.test.ts` passes — `parseNutritionTable` returns ≥ 20 dishes from the KFC fixture
- [ ] `telepizza-es.parser.test.ts` passes — `parseNutritionTable` returns ≥ 15 dishes from the Telepizza fixture
- [ ] `five-guys-es.parser.test.ts` passes — investigation outcome is documented (either Form A or Form B per Section 9.3)
- [ ] If Five Guys PDF is allergen-only: `CHAIN_PDF_REGISTRY` entry updated with `enabled: false` and explanatory `notes`
- [ ] If any keywords were added to `KEYWORD_MAP`, the chain test that exercises the new keyword is present and green
- [ ] All previously passing tests continue to pass — `npm run test -w @foodxplorer/api` shows ≥ 819 passing tests with 0 failures
- [ ] `tsc --noEmit` passes with zero errors
- [ ] `npm run ingest:batch -w @foodxplorer/api -- --dry-run` exits with code 0 for all enabled chains (API server running, DB seeded)
- [ ] Each enabled chain verified independently with `--chain <slug> --dry-run`
- [ ] Live ingest on local dev DB confirmed for at least one chain (recommended: KFC as most stable)
- [ ] TypeScript strict mode — no `any`, no `ts-ignore` in any new or modified file
- [ ] `docs/specs/api-spec.yaml` is NOT modified (no new endpoints)
- [ ] No binary PDF files committed to the repository

---

## 17. Out of Scope

- New API endpoints
- Domino's Spain (F012 — JPEG/OCR pipeline)
- Subway Spain (F013 — data source investigation)
- Additional chains beyond BK, KFC, Telepizza, Five Guys
- Cron / scheduled execution
- URL discovery automation
- Retry logic for transient failures
- Admin UI or chain management dashboard
- Embedding generation (F019)
