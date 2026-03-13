# F009: Burger King Spain Scraper

**Feature:** F009 | **Type:** Backend-Feature | **Priority:** High
**Status:** Blocked | **Branch:** _(deleted — no code produced)_
**Created:** 2026-03-13 | **Dependencies:** F008 complete (persistDishUtil, PrismaClient singleton, `{ config, ScraperClass }` registry shape)
**Blocked Reason:** BK Spain does not publish per-product nutritional data on its website. See §Blocking Investigation below.

---

## Spec

### Description

F009 implements the Burger King Spain chain scraper (`burger-king-es`). It is the second concrete chain scraper and follows the pattern established by F008 — with no new shared infrastructure required.

The scraper:
- Extends `BaseScraper` with `getMenuUrls(page)` (discovers all product URLs from the BK Spain menu page) and `extractDishes(page)` (extracts nutritional data from individual product pages).
- Uses HTML-based extraction as the primary (and likely only) strategy — BK Spain is not expected to publish JSON-LD `NutritionInformation` structured data (must be verified at implementation time).
- Delegates `persistDish()` to the shared `persistDishUtil(getPrismaClient(), dish)` from `packages/scraper/src/utils/persist.ts` — created by F008, no reimplementation needed.
- Registers `burger-king-es` in `src/registry.ts` — no type changes to registry (shape already upgraded by F008).
- Introduces a more conservative rate limit (6 req/min) due to Akamai/Cloudflare bot protection risk on BK Spain.

Full specification: `docs/specs/F009-burger-king-scraper-spec.md`

> **Implementation note:** BK Spain selectors are unknown until the developer inspects the live site. All selectors in the spec and config are labelled PLACEHOLDER and must be replaced with real, verified selectors before committing the implementation. The spec is honest about this.

---

### Architecture Decisions

**HTML extraction only (no JSON-LD) — unless verified otherwise**

BK Spain does not appear to use JSON-LD `NutritionInformation` structured data. The extraction is based entirely on the HTML "Allergens and nutritional" section of each product page. The `nutritionExtractor.ts` helper scans the section for label/value pairs and maps Spanish labels to `RawDishData.nutrients` keys. If JSON-LD is found during implementation, it should be added as the primary path (following the F008 pattern) without retroactively changing this spec.

**`Sal` (salt in g) — not `Sodio` (sodium in mg)**

BK Spain discloses `Sal` (salt, already in grams) rather than `Sodio` (sodium in mg). The `RawDishData.nutrients.salt` field is set directly. `normalizeNutrients` derives `sodium` automatically from `salt` when only `salt` is provided.

**No new infrastructure — pure additive feature**

F009 adds only chain-specific files under `src/chains/burger-king-es/`. The registry, persist utility, Prisma singleton, and runner are all unchanged from F008.

**CAPTCHA detection on product page (not just menu page)**

BK Spain has more aggressive bot protection than McDonald's. The `extractDishes` method includes a body-text CAPTCHA check before attempting any extraction. This is in addition to BaseScraper's existing HTTP 403 handling.

---

### File Structure

New files:

```
packages/scraper/src/
└── chains/
    └── burger-king-es/
        ├── BurgerKingEsScraper.ts      # Extends BaseScraper — getMenuUrls + extractDishes
        ├── config.ts                   # BURGER_KING_ES_CONFIG static ScraperConfig
        └── nutritionExtractor.ts       # extractNutritionSection(page) → Partial<nutrients>

packages/scraper/src/__tests__/
├── burger-king-es.test.ts              # Chain scraper unit tests (fixture-based)
└── fixtures/
    └── burger-king-es/
        ├── product-page.html           # Product page with nutrition section
        ├── menu-page.html              # Menu index with product links
        └── product-blocked.html        # CAPTCHA / blocked response page
```

Modified files:

```
packages/scraper/src/
├── registry.ts     # Add 'burger-king-es' entry
└── config.ts       # Add BURGER_KING_ES_RESTAURANT_ID, BURGER_KING_ES_SOURCE_ID

packages/scraper/
└── vitest.config.ts  # Add placeholder UUIDs for BK env vars
```

---

### Config Schema

`ScraperEnvSchema` additions in `packages/scraper/src/config.ts`:

```
BURGER_KING_ES_RESTAURANT_ID : z.string().uuid().optional()
BURGER_KING_ES_SOURCE_ID      : z.string().uuid().optional()
```

`ScraperConfig` for `burger-king-es`:

```
chainSlug     : 'burger-king-es'
baseUrl       : 'https://www.burgerking.es'
startUrls     : ['https://www.burgerking.es/menu']
rateLimit     : { requestsPerMinute: 6, concurrency: 1 }
retryPolicy   : { maxRetries: 3, backoffMs: 3000, backoffMultiplier: 2 }
locale        : 'es-ES'
selectors     : {
  productList:      'a[href*="/menu/item-item_"]',         // PLACEHOLDER
  productName:      'h1',                                  // PLACEHOLDER
  nutritionSection: '[class*="nutrition"]',                // PLACEHOLDER
  nutritionRows:    '[class*="nutrition"] [class*="row"]', // PLACEHOLDER
  cookieConsent:    '#onetrust-accept-btn-handler',        // PLACEHOLDER
  price:            '[class*="price"]',                    // PLACEHOLDER
}
```

All selectors are PLACEHOLDER — must be verified against the live site.

---

### Data Model Changes

No schema migration required. The existing `dishes` and `dish_nutrients` tables from F002 are sufficient. Two seed rows must be inserted before the scraper can run:

- `restaurants`: 1 row — Burger King Spain (`chain_slug: 'burger-king-es'`, `country_code: 'ES'`)
- `data_sources`: 1 row — Burger King Spain Website Scraper (`source_type: 'scraper'`)

See spec §8 for the seed SQL.

---

### Nutrient Field Mapping

Burger King Spain discloses (from HTML nutrition section, per serving):

| Page label | `RawDishData` field | Normalized to |
|---|---|---|
| Valor Energético / Calorías | `calories` | kcal (use kcal from combined row if both kJ and kcal present) |
| Grasas / Lípidos | `fats` | g |
| Grasas saturadas | `saturatedFats` | g |
| Hidratos de carbono / Carbohidratos | `carbohydrates` | g |
| Azúcares | `sugars` | g |
| Fibra | `fiber` | g |
| Proteínas | `proteins` | g |
| Sal | `salt` | g (direct — not derived from sodium) |
| Peso / Ración | `portionGrams` | g (dish field, not a nutrient) |

Not disclosed (default to 0): `transFats`, `cholesterol`, `potassium`, `monounsaturatedFats`, `polyunsaturatedFats`.

Key difference from F008: BK discloses `Sal` (salt in g), not `Sodio` (sodium in mg). Set `RawDishData.nutrients.salt`, not `sodium`.

---

### Error Handling

| Scenario | Behaviour |
|---|---|
| CAPTCHA detected in body text | Throw `ScraperBlockedError` — caught by BaseScraper, recorded in errors |
| Product name heading not found | Throw `ScraperStructureError` — caught by BaseScraper, recorded in errors |
| Product list selector timeout (15s) | Throw `ScraperStructureError('Product list selector not found')` |
| Nutrition section not found | Return empty `RawDishData[]` — normalization skips the dish with warn |
| Energy row has kJ only (no kcal) | `calories` absent → `normalizeNutrients` returns null → dish skipped with warn |
| `normalizeNutrients` returns null | BaseScraper increments `dishesSkipped`, logs warn |
| Prisma transaction fails | Re-throw from `persistDish` — BaseScraper increments `dishesSkipped`, logs error |
| HTTP 403 on any page | Crawlee `failedRequestHandler` records `SCRAPER_BLOCKED_ERROR` |

---

### Edge Cases

- Energy row may show both kJ and kcal ("2133 kJ / 510 kcal") — extract kcal value only via regex.
- BK may disclose `Sodio` (sodium in mg) instead of `Sal` on some products — `LABEL_MAP` includes both; normalization handles either.
- Price with thousand separator ("1.050,00 €") — use ES locale-aware parsing: strip `.` first, then replace `,` with `.`.
- Product URL may include `/en/` language prefix — filter regex must match with or without it.
- Akamai JS challenge page may not contain "captcha" text — nutrition section absent → empty array + warn (acceptable degradation in Phase 1).
- Cookie consent must be dismissed before `waitForSelector` can find the product list.
- `BURGER_KING_ES_RESTAURANT_ID` missing at runtime: `ScraperConfigSchema.parse` throws at class definition time → process exits with parse error message.

---

### Acceptance Criteria

- [ ] `BurgerKingEsScraper` extends `BaseScraper`; TypeScript strict mode, no `any` — verified by `tsc --noEmit`
- [ ] `getMenuUrls` extracts and deduplicates absolute product URLs from fixture `menu-page.html`
- [ ] `extractDishes` extracts `name`, `nameEs`, `externalId`, and all disclosed nutrients from `product-page.html`
- [ ] `externalId` extracted as `item_XXXXX` from URL pattern
- [ ] `salt` passed as `RawDishData.nutrients.salt` (not `sodium`) — BK discloses salt directly
- [ ] All nutrient values pass through `normalizeNutrients` without returning null for fixture data
- [ ] `portionGrams` extracted from nutrition section serving weight row
- [ ] `priceEur` coerces "5,49 €" to 5.49
- [ ] `ScraperBlockedError` thrown when CAPTCHA text detected in body
- [ ] `ScraperStructureError` thrown when product name not found
- [ ] Empty array returned (with warn log) when nutrition section not found
- [ ] Registry updated: `registry['burger-king-es']` resolves to `{ config, ScraperClass: BurgerKingEsScraper }`
- [ ] `ScraperEnvSchema` updated with `BURGER_KING_ES_RESTAURANT_ID` and `BURGER_KING_ES_SOURCE_ID`
- [ ] Vitest config updated with placeholder UUIDs for both BK env vars
- [ ] All placeholder selectors replaced with real verified selectors
- [ ] All 3 fixture HTML files committed to `src/__tests__/fixtures/burger-king-es/`
- [ ] All unit tests pass (`vitest run`) — no real network calls in tests
- [ ] `tsc --noEmit` passes in `packages/scraper`

---

## Notes

- Selectors in the spec and config are all PLACEHOLDER — the developer must inspect `https://www.burgerking.es/menu/item-item_11116` (LONG CHICKEN page) to verify real DOM structure before implementing.
- BK Spain's `Sal` field is in grams (not mg like McDonald's `Sodio`). The `nameEs = name` rule applies — BK Spain publishes in Spanish.
- The seed rows for `restaurants` and `data_sources` are required for live runs but NOT for `vitest run` (tests mock Prisma entirely).
- For local manual testing: `SCRAPER_CHAIN=burger-king-es BURGER_KING_ES_RESTAURANT_ID=<uuid> BURGER_KING_ES_SOURCE_ID=<uuid> npm run dev -w @foodxplorer/scraper`
- If BK Spain has a Nutrition PDF at `burgerking.es/content/nutrition-information-documents-area`, consider this as an alternative data source using the F007b PDF ingestion pipeline — outside scope of F009 but worth noting.

---

## Implementation Plan

### Existing Code to Reuse

- `packages/scraper/src/base/BaseScraper.ts` — extend with `getMenuUrls` + `extractDishes` + `persistDish` override
- `packages/scraper/src/base/types.ts` — `RawDishData`, `NormalizedDishData`, `ScraperConfig`, `ScraperConfigSchema`
- `packages/scraper/src/base/errors.ts` — `ScraperBlockedError`, `ScraperStructureError`, `NotImplementedError`
- `packages/scraper/src/utils/persist.ts` — `persistDishUtil` (created by F008, no changes needed)
- `packages/scraper/src/lib/prisma.ts` — `getPrismaClient()` singleton (created by F008, no changes needed)
- `packages/scraper/src/utils/normalize.ts` — `normalizeNutrients`, `normalizeDish` (used by BaseScraper internally)
- `packages/scraper/src/chains/mcdonalds-es/tableExtractor.ts` — reference implementation for the LABEL_MAP pattern and row-iteration pattern to adapt in `nutritionExtractor.ts`
- `packages/scraper/src/chains/mcdonalds-es/McDonaldsEsScraper.ts` — reference implementation for `getMenuUrls`, `extractDishes`, `persistDish`, static `CONFIG`, and `TestScraper` DI pattern
- `packages/scraper/src/__tests__/mcdonalds-es.test.ts` — reference for `makeMockPage`, `makeElementHandle`, `makeMockRow`, `TestScraper` subclass pattern, and `vi.mock` placement

### Files to Create

```
packages/scraper/src/chains/burger-king-es/
├── config.ts                   # BURGER_KING_ES_CONFIG — ScraperConfigSchema.parse(), reads env vars,
│                               # all selectors verified against live site (replace PLACEHOLDERs)
├── BurgerKingEsScraper.ts      # Extends BaseScraper — getMenuUrls, extractDishes, persistDish override
│                               # Static CONFIG property pointing to BURGER_KING_ES_CONFIG
└── nutritionExtractor.ts       # extractNutritionSection(page): Promise<{ nutrients: Partial<...>, portionGrams? }>
│                               # LABEL_MAP for Spanish labels; handles kJ/kcal combined rows;
│                               # portionGrams returned separately from nutrients object

packages/scraper/src/__tests__/
├── burger-king-es.test.ts      # Full unit test suite — fixture-based, no real network calls
└── fixtures/burger-king-es/
    ├── product-page.html       # Real HTML from a BK product page (e.g. LONG CHICKEN item_11116)
    │                           # Must include the actual nutrition section structure found on the live site
    ├── menu-page.html          # Real HTML from https://www.burgerking.es/menu
    │                           # Must include 5+ product links with /menu/item-item_XXXXX pattern,
    │                           # at least one duplicate (same product linked from two category tabs)
    └── product-blocked.html    # Minimal page with "captcha" in body text — triggers ScraperBlockedError
```

### Files to Modify

- `packages/scraper/src/config.ts` — add `BURGER_KING_ES_RESTAURANT_ID: z.string().uuid().optional()` and `BURGER_KING_ES_SOURCE_ID: z.string().uuid().optional()` to `ScraperEnvSchema`
- `packages/scraper/src/registry.ts` — add `'burger-king-es': { config: BurgerKingEsScraper.CONFIG, ScraperClass: BurgerKingEsScraper }` import and registry entry
- `packages/scraper/vitest.config.ts` — add `BURGER_KING_ES_RESTAURANT_ID: '00000000-0000-4000-a000-000000000009'` and `BURGER_KING_ES_SOURCE_ID: '00000000-0000-4000-a000-000000000010'` to the `env` block

### Implementation Order

**Step 1 — Site Inspection (prerequisite for all other steps)**

Before writing any code, open a real browser and inspect the following pages:

1. `https://www.burgerking.es/menu` — inspect the menu page DOM:
   - Find the CSS selector that matches `<a>` elements linking to product pages (`/menu/item-item_\d+` pattern)
   - Find the cookie consent button selector (likely OneTrust — check for `#onetrust-accept-btn-handler`)
   - Note whether the page is JavaScript-rendered (if no links appear in `view-source:`, it is)

2. `https://www.burgerking.es/menu/item-item_11116` (LONG CHICKEN) — inspect the product page DOM:
   - Find the product name heading selector (probably `h1` or a class-specific variant)
   - Find the nutrition section wrapper selector
   - Identify the structure of nutrient rows (definition list `<dl>/<dt>/<dd>`, table `<tr>/<td>`, or div/span pairs)
   - Find the serving size / Peso row
   - Find the price element selector
   - Check `view-source:` for `<script type="application/ld+json">` — if NutritionInformation is found, note it (will add `jsonLdParser.ts` fallback path)
   - Verify the URL pattern for `externalId` extraction (`/item-(item_\d+)$/`)
   - Check for language prefix in URL (`/en/menu/...`)

3. Record all real selectors — they replace every PLACEHOLDER in `config.ts` and `nutritionExtractor.ts`.

4. Save an HTML snapshot of the product page and menu page to use as fixture content in Step 3.

---

**Step 2 — Environment wiring (no logic, enables tests to import config)**

Files: `packages/scraper/src/config.ts`, `packages/scraper/vitest.config.ts`

- Add `BURGER_KING_ES_RESTAURANT_ID` and `BURGER_KING_ES_SOURCE_ID` to `ScraperEnvSchema` (both `z.string().uuid().optional()`)
- Add stub UUIDs to `vitest.config.ts` env block:
  - `BURGER_KING_ES_RESTAURANT_ID: '00000000-0000-4000-a000-000000000009'`
  - `BURGER_KING_ES_SOURCE_ID: '00000000-0000-4000-a000-000000000010'`

This unblocks `config.ts` import in tests (ScraperConfigSchema.parse() runs at module load time).

No tests for this step — it is a prerequisite for Step 4.

---

**Step 3 — Fixtures (TDD: Red — tests will reference these before implementation exists)**

Files: `packages/scraper/src/__tests__/fixtures/burger-king-es/`

Create three fixture files based on the real HTML captured in Step 1:

- `product-page.html` — full product page HTML for one product. Must contain:
  - The real product name element (using the verified selector from Step 1)
  - The real nutrition section with all nutrient rows in the format found on the live site
  - The serving weight / Peso row
  - A price element
  - The URL `https://www.burgerking.es/menu/item-item_11116` referenced in tests as `page.url()`
  - If the combined kJ/kcal row format is used, include both values in the energy row

- `menu-page.html` — trimmed version of the real menu page. Must contain:
  - At least 5 `<a href="/menu/item-item_XXXXX">` links
  - At least one duplicated product link (same product in two category sections)
  - At least one non-product link to verify filtering

- `product-blocked.html` — minimal page with "captcha" text in body:
  ```html
  <!DOCTYPE html><html><body>
  <p>Por favor, complete el siguiente desafío captcha para continuar.</p>
  </body></html>
  ```

Follow the exact structure of the McDonalds fixtures at `packages/scraper/src/__tests__/fixtures/mcdonalds-es/` for guidance on fixture format and completeness.

---

**Step 4 — `config.ts` (chain-specific static config)**

File: `packages/scraper/src/chains/burger-king-es/config.ts`

Pattern: mirror `packages/scraper/src/chains/mcdonalds-es/config.ts` exactly.

Contents:
- Import `ScraperConfigSchema` from `../../base/types.js`
- Export `BURGER_KING_ES_CONFIG = ScraperConfigSchema.parse({ ... })` with:
  - `chainSlug: 'burger-king-es'`
  - `restaurantId: process.env['BURGER_KING_ES_RESTAURANT_ID']!`
  - `sourceId: process.env['BURGER_KING_ES_SOURCE_ID']!`
  - `baseUrl: 'https://www.burgerking.es'`
  - `startUrls: ['https://www.burgerking.es/menu']`
  - `rateLimit: { requestsPerMinute: 6, concurrency: 1 }`
  - `retryPolicy: { maxRetries: 3, backoffMs: 3000, backoffMultiplier: 2 }`
  - `selectors`: all six selectors filled with the **real** values verified in Step 1 (not PLACEHOLDERs)
  - `headless: true`
  - `locale: 'es-ES'`

TDD: write the `describe('static CONFIG', ...)` tests in `burger-king-es.test.ts` first:
- `it('has chainSlug "burger-king-es"')`
- `it('has restaurantId from env stub')` — expects `'00000000-0000-4000-a000-000000000009'`
- `it('has sourceId from env stub')` — expects `'00000000-0000-4000-a000-000000000010'`

These tests will be Red until `config.ts` and `BurgerKingEsScraper.ts` exist.

---

**Step 5 — `nutritionExtractor.ts` (HTML extraction helper)**

File: `packages/scraper/src/chains/burger-king-es/nutritionExtractor.ts`

Pattern: adapt from `packages/scraper/src/chains/mcdonalds-es/tableExtractor.ts`, with these key differences:
- Returns `{ nutrients: Partial<RawDishData['nutrients']>, portionGrams?: number }` (two values, not one)
- Handles the actual DOM structure found in Step 1 (may be dl/dt/dd, table, or div/span — not necessarily `<tr>/<td>`)
- Handles combined kJ/kcal energy row via regex `(\d[\d,.]*)\s*kcal` to extract kcal value only
- Maps `__portionGrams` labels (`'peso'`, `'ración'`) separately from nutrient keys — these are returned as `portionGrams`, not in the nutrients object
- Warns if `salt > 100` (salt in mg vs g detection)

`LABEL_MAP` (adapt to real labels found on live site — the spec's LABEL_MAP is the authoritative starting point):
```
'valor energético' → 'calories'
'energía'          → 'calories'
'calorías'         → 'calories'
'grasas'           → 'fats'
'lípidos'          → 'fats'
'grasas saturadas' → 'saturatedFats'
'hidratos de carbono' → 'carbohydrates'
'carbohidratos'    → 'carbohydrates'
'azúcares'         → 'sugars'
'fibra'            → 'fiber'
'fibra alimentaria' → 'fiber'
'proteínas'        → 'proteins'
'proteina'         → 'proteins'
'sal'              → 'salt'
'sodio'            → 'sodium'
'peso'             → '__portionGrams'
'ración'           → '__portionGrams'
```

If nutrition section selector not found within 5s timeout: return `{ nutrients: {}, portionGrams: undefined }`.

TDD: write `describe('extractNutritionSection(page)', ...)` tests first:
- `it('maps "sal" label to salt nutrient key')`
- `it('maps "hidratos de carbono" label to carbohydrates')`
- `it('maps "proteínas" to proteins')`
- `it('maps "fibra" to fiber')`
- `it('returns empty object when nutrition section selector not found')`
- `it('handles label text with extra whitespace or mixed case')`
- `it('handles combined kJ / kcal energy row — uses kcal value only')`
- `it('returns portionGrams separately from nutrients')`

These tests drive mock page setups using `makeMockPage` + mock row helpers adapted from the McDonalds test pattern.

---

**Step 6 — `BurgerKingEsScraper.ts` (main scraper class)**

File: `packages/scraper/src/chains/burger-king-es/BurgerKingEsScraper.ts`

Pattern: mirror `packages/scraper/src/chains/mcdonalds-es/McDonaldsEsScraper.ts`. Key differences:
- No `jsonLdParser` import (unless JSON-LD was found in Step 1)
- Imports `extractNutritionSection` from `./nutritionExtractor.js`
- Uses `this.config.selectors['cookieConsent']` for the consent click selector
- CAPTCHA check uses `page.evaluate(() => document.body.innerText)` (not `page.textContent`) per spec §4.2
- `getMenuUrls` checks for blocked page before `waitForSelector`
- `externalId` regex is `/item-(item_\d+)$/` not `/\/product\/([^/]+)\.html$/`
- `portionGrams` comes from `extractNutritionSection` return value (not a separate `$eval`)
- Price parsing uses ES-locale-aware logic: strip `.` (thousand separator) first, then replace `,` with `.` — same logic as `McDonaldsEsScraper` (already handles this correctly)
- `nameEs: name` (BK Spain publishes in Spanish — name IS nameEs)
- `description` is omitted (BK product pages may not have a description paragraph — do not throw if absent)

`getMenuUrls` implementation:
1. Try cookie consent click (try/catch, non-fatal, 3s timeout)
2. `await page.waitForSelector(this.config.selectors['productList'], { timeout: 15_000 })` — throw `ScraperStructureError` if it times out
3. `page.$$eval(this.config.selectors['productList'], els => els.map(el => el.getAttribute('href')).filter(Boolean))`
4. Filter hrefs to `/\/menu\/item-item_\d+/` pattern (handles with or without language prefix)
5. Deduplicate via `Set`
6. Prepend `this.config.baseUrl` if href is relative

`extractDishes` implementation:
1. CAPTCHA check via `page.evaluate(() => document.body.innerText)` → throw `ScraperBlockedError` if matches `/captcha|robot|estás siendo verificado/i`
2. Cookie consent click (try/catch, non-fatal)
3. Extract name from verified product name selector → throw `ScraperStructureError` if not found
4. Extract `externalId` via `page.url().match(/item-(item_\d+)$/)?.[1]`
5. Call `extractNutritionSection(page)` → destructure `{ nutrients, portionGrams }`
6. If nutrients is empty, return `[]` (warn log handled by BaseScraper when empty array is returned from `extractDishes`)
7. Extract `priceEur` (try/catch, optional)
8. Extract `category` from breadcrumb or URL path (try/catch, optional)
9. Return `[rawDish]`

`persistDish` override — use Option B (safe default, identical to McDonalds):
```typescript
protected override async persistDish(dish: NormalizedDishData): Promise<void> {
  await persistDishUtil(getPrismaClient(), dish)
}
```

TDD: write `describe('getMenuUrls(page)', ...)` and `describe('extractDishes(page)', ...)` tests before implementing, following the McDonalds test patterns with these BK-specific scenarios:
- `it('extracts product URLs matching /menu/item-item_\\d+ from the menu page')`
- `it('deduplicates repeated product URLs')`
- `it('prepends baseUrl to relative hrefs')`
- `it('throws ScraperStructureError if product list selector not found')`
- `it('extracts product name from the product heading')`
- `it('sets nameEs equal to name')`
- `it('extracts externalId from the URL pattern item_(\\d+)')`
- `it('extracts all nutrient fields from the HTML nutrition section')`
- `it('extracts portionGrams from the serving weight row')`
- `it('extracts priceEur — comma-decimal "5,49 €" parses to 5.49')`
- `it('returns a dish without error when price selector is absent')`
- `it('returns a dish without error when serving size row is absent')`
- `it('throws ScraperBlockedError when body contains "captcha"')`
- `it('throws ScraperStructureError when product name is not found')`
- `it('returns empty array when nutrition section is not found')`

`TestBurgerKingScraper` helper class — same DI pattern as `TestMcDonaldsScraper` in the McDonalds test file: override `createCrawler()` to return a mock crawler that calls `requestHandler` directly without real Playwright.

---

**Step 7 — Registry update**

File: `packages/scraper/src/registry.ts`

Add to imports:
```typescript
import { BurgerKingEsScraper } from './chains/burger-king-es/BurgerKingEsScraper.js'
```

Add to registry object:
```typescript
'burger-king-es': {
  config: BurgerKingEsScraper.CONFIG,
  ScraperClass: BurgerKingEsScraper,
},
```

No type changes — the `{ config, ScraperClass }` shape is already defined.

TDD: No dedicated test file for the registry — the static CONFIG test in `burger-king-es.test.ts` (Step 4) verifies the config object is correctly formed. An additional registry integration check can be added as a smoke test:
- `it('registry["burger-king-es"] resolves to { config, ScraperClass: BurgerKingEsScraper }')` — import `registry` and assert `registry['burger-king-es']?.ScraperClass === BurgerKingEsScraper`

---

**Step 8 — Green phase and TypeScript validation**

Run:
1. `vitest run --reporter=verbose -t "BurgerKingEsScraper"` — all tests must pass
2. `tsc --noEmit -p packages/scraper/tsconfig.json` — zero errors, no `any`, no `ts-ignore`

Fix any issues before proceeding.

---

**Step 9 — DB seed rows (for live runs only, not needed for tests)**

Run this SQL against the development or staging DB (not part of a migration — seed data only):

```sql
INSERT INTO restaurants (id, name, name_es, chain_slug, website, country_code, is_active)
VALUES (
  gen_random_uuid(),
  'Burger King Spain',
  'Burger King España',
  'burger-king-es',
  'https://www.burgerking.es',
  'ES',
  true
)
ON CONFLICT (chain_slug, country_code) DO NOTHING;

INSERT INTO data_sources (id, name, source_type, url, is_active)
VALUES (
  gen_random_uuid(),
  'Burger King Spain Website Scraper',
  'scraper',
  'https://www.burgerking.es/menu',
  true
)
ON CONFLICT DO NOTHING;
```

Copy the generated UUIDs from these rows into `.env.local` as:
```
BURGER_KING_ES_RESTAURANT_ID=<uuid from restaurants row>
BURGER_KING_ES_SOURCE_ID=<uuid from data_sources row>
```

These env vars are only needed for `npm run dev -w @foodxplorer/scraper` live runs — not for `vitest run`.

---

### Testing Strategy

**Test file:** `packages/scraper/src/__tests__/burger-king-es.test.ts`

**Mocking strategy:**
- `vi.mock('../utils/persist.js', () => ({ persistDishUtil: vi.fn().mockResolvedValue(undefined) }))` — placed before scraper import, same as McDonalds test
- `vi.mock('../lib/prisma.js', () => ({ getPrismaClient: vi.fn().mockReturnValue({ _isMockPrisma: true }) }))` — prevents Prisma client instantiation
- `TestBurgerKingScraper extends BurgerKingEsScraper` overrides `createCrawler()` to bypass real Playwright — same DI pattern as `TestMcDonaldsScraper` in the McDonalds test file
- Mock `page` object built with `makeMockPage(overrides)` factory returning duck-typed `vi.fn()` stubs for: `evaluate`, `locator`, `waitForSelector`, `$$eval`, `$eval`, `$$`, `url`
- `makeElementHandle(text)` helper for mock row cells
- `makeMockRow(label, value)` helper for nutrition rows

**Key test scenarios:**

`getMenuUrls`:
- Happy path: returns 5+ deduplicated absolute URLs from `$$eval` mock returning relative hrefs
- Deduplication: same href appearing twice yields only one URL in output
- Relative href prefixing: `/menu/item-item_11116` → `https://www.burgerking.es/menu/item-item_11116`
- Non-product URL filtering: hrefs not matching `/\/menu\/item-item_\d+/` are excluded
- Selector timeout: `waitForSelector` rejects → `ScraperStructureError` thrown

`extractDishes`:
- Happy path: all nutrient fields extracted, `nameEs === name`, `externalId === 'item_11116'`
- CAPTCHA detection: `page.evaluate` returns text containing "captcha" → `ScraperBlockedError`
- Missing product name: `$eval` on name selector rejects → `ScraperStructureError`
- Missing nutrition section: `extractNutritionSection` returns `{}` → `[]` returned from `extractDishes`
- Optional fields absent: price and portionGrams selectors fail → dish returned without those fields
- Combined kJ/kcal row: energy row with "2133 kJ / 510 kcal" → `calories` is `510`, not `2133`
- Price coercion: "5,49 €" → `5.49`; "1.050,00 €" → `1050.00`
- Salt field: `nutrients.salt` is set, `nutrients.sodium` is not set by scraper

`extractNutritionSection`:
- Label normalization: "  Proteínas  " → maps to `proteins`
- `sal` → `salt` key
- `__portionGrams` labels returned outside nutrients object
- Empty section: timeout on waitForSelector → returns `{ nutrients: {}, portionGrams: undefined }`

`persistDish`:
- `persistDishUtil` called once with `getPrismaClient()` result and normalized dish

**No integration tests** — Prisma is fully mocked. `persist.test.ts` from F008 covers `persistDishUtil` exhaustively.

### Key Patterns

1. **Static CONFIG pattern** — `static readonly CONFIG: ScraperConfig = BURGER_KING_ES_CONFIG` on the class, referenced by the registry. See `packages/scraper/src/chains/mcdonalds-es/McDonaldsEsScraper.ts` line 32.

2. **Mock hoisting** — `vi.mock()` calls must appear before `import` statements for the scraper. Vitest hoists them automatically. Retrieve typed mock via `vi.mocked(persistDishUtil)` after imports. See `packages/scraper/src/__tests__/mcdonalds-es.test.ts` lines 23–38.

3. **TestScraper DI pattern** — override `createCrawler()` in a test subclass to return a mock crawler that calls `requestHandler` synchronously. The mock crawler's `run(requests)` iterates requests and calls the handler directly. See `packages/scraper/src/__tests__/mcdonalds-es.test.ts` lines 121–148.

4. **Protected method testing** — call `getMenuUrls`, `extractDishes`, and `persistDish` via `(scraper as unknown as { methodName: ... }).methodName(...)` cast. See `packages/scraper/src/__tests__/mcdonalds-es.test.ts` line 265.

5. **`nutritionExtractor.ts` return shape** — returns `{ nutrients: Partial<RawDishData['nutrients']>, portionGrams?: number }`, not just `Partial<...>`. This differs from `tableExtractor.ts` which returns only `Partial<RawDishData['nutrients']>`. The `portionGrams` field must be extracted here because it is co-located with the nutrition rows on the BK page.

6. **Combined kJ/kcal parsing** — when the energy row value is `"2133 kJ / 510 kcal"`, use `const kcalMatch = valueText.match(/(\d[\d,.]*)\s*kcal/i)` and take `kcalMatch[1]`. If no kcal match, omit `calories` (will cause `normalizeNutrients` to return null and dish is skipped).

7. **Salt vs sodium** — BK Spain `Sal` → `RawDishData.nutrients.salt` (in grams). Do NOT set `sodium`. `normalizeNutrients` derives sodium automatically from salt.

8. **`externalId` regex** — `/item-(item_\d+)$/` on `page.url()`. Captures the `item_XXXXX` segment including the prefix, e.g. `"item_11116"`.

9. **Cookie consent** — wrapped in `try/catch` with 3s timeout. A failed click is non-fatal. Run before `waitForSelector` in `getMenuUrls` and before name extraction in `extractDishes`.

10. **Gotcha — `page.evaluate` vs `page.textContent`** — the spec requires CAPTCHA detection via `page.evaluate(() => document.body.innerText)` (not `page.textContent('body')`). This is intentional to ensure the full rendered text is obtained post-JS-execution. Mock this in tests as `page.evaluate: vi.fn().mockResolvedValue(bodyText)`.

11. **Gotcha — JSON-LD check** — if during Step 1 site inspection you find `<script type="application/ld+json">` with `NutritionInformation`, add a `jsonLdParser.ts` (same pattern as McDonald's) and use JSON-LD as primary extraction with HTML as fallback. If absent (expected), skip this entirely. Do not add dead code for a path you could not verify.

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Unit tests written and passing
- [ ] Code follows project standards
- [ ] No linting errors
- [ ] Build succeeds
- [ ] Specs reflect final implementation

---

## Blocking Investigation (2026-03-13)

Site inspection via Playwright on the live BK Spain website revealed that the original spec assumptions are **all invalid**:

### Findings

| Assumption (spec) | Reality (verified) |
|---|---|
| Product pages have nutrition section in HTML | **No nutrition data on product pages.** Only a link to a centralized PDF |
| JSON-LD NutritionInformation possible | **No JSON-LD structured data** on any page |
| Menu page has direct product links (`/menu/item-item_XXXXX`) | Menu page only has **section links** (`/es/menu/section-UUID`). No product links on the menu index. |
| Nutrition data accessible per product | **All nutrition data is in a single PDF** hosted on S3 |
| HTML table or definition list with nutrient rows | **No HTML nutrition elements exist** — only PDF download links |

### Technical Details

1. **BK Spain SPA architecture:** React app with styled-components. Full JS rendering required (Playwright mandatory). CMS: Sanity (sanity.io) with GraphQL API at `czqk28jt.apicdn.sanity.io`.

2. **Sanity GraphQL API:**
   - `operationName=GetItem` returns product name, description, image, vendor configs — but **no nutritional data**.
   - `allFeatureNutrition: []` — the Nutrition feature collection is **empty**.
   - `hideCalories: null` — flag exists but no calorie values stored.

3. **Nutrition data source:** Single PDF document on S3:
   - URL: `https://eu-west-3-146514239214-prod-bk-fz.s3.eu-west-3.amazonaws.com/en-ES/2026/Nutritional+Information/MANTEL+NUTRICIONAL+ESP+ING+FEB2026.pdf`
   - Updated monthly (filename pattern: `MANTEL+NUTRICIONAL+ESP+ING+[MONTH][YEAR].pdf`)
   - Contains ALL products' nutritional data in a single tabular document
   - Linked from the product page under "Alérgenos y Nutricionales" → "Nutricionales" (link text: "Valores Nutricionales")

4. **Product page structure (item-item_11116, LONG CHICKEN):**
   - H1: `LONG CHICKEN®` (class: `sc-1a0eu59-3`)
   - Description: visible in page text
   - Nutrition section: **does not exist** — only "Alérgenos y Nutricionales" label with two PDF links
   - Price: **not visible** on product page
   - Cookie consent: `#onetrust-accept-btn-handler` (OneTrust)

5. **Menu page structure:**
   - URL: `https://www.burgerking.es/es/menu`
   - 19 category sections (BABY BURGERS, NOVEDADES, HAMBURGUESAS, etc.)
   - Links go to `/es/menu/section-UUID` — NOT to individual products
   - Product cards within sections are loaded dynamically but contain no `item-item_` links in the rendered DOM

### Decision

**F009 blocked.** The BaseScraper pattern (HTML extraction from per-product pages) is not applicable to BK Spain. The nutrition data can only be obtained by parsing the centralized PDF document.

### Future Unblocking Options

1. **PDF-based approach:** Download the MANTEL NUTRICIONAL PDF from S3 (URL discoverable from the "Valores Nutricionales" link on any product page), parse it with pdf-parse. This is conceptually similar to F007b but requires a BK-specific table parser for the nutritional grid layout.

2. **Sanity API + PDF hybrid:** Query the Sanity GraphQL API to get product list (`operationName=GetItem` for each item, or bulk query), then parse the PDF for nutritional data and match by product name.

3. **Manual PDF upload:** Use the existing `POST /ingest/pdf` endpoint (F007b) to manually upload the BK nutritional PDF. Lowest effort but not automated.

The spec and implementation plan in this ticket remain valid as reference for the **assumed** architecture. If BK Spain later adds per-product nutrition data to their website, this ticket can be unblocked and the plan followed as-is (with verified selectors).

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` executed, plan approved
- [ ] ~~Step 3: `backend-developer` executed with TDD~~ — BLOCKED
- [ ] ~~Step 4: `production-code-validator` executed, quality gates pass~~ — BLOCKED
- [ ] ~~Step 5: `code-review-specialist` executed~~ — BLOCKED
- [ ] ~~Step 5: `qa-engineer` executed (Standard)~~ — BLOCKED
- [ ] ~~Step 6: Ticket updated with final metrics, branch deleted~~ — BLOCKED

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-13 | Step 0: Spec created | F009-burger-king-scraper-spec.md — HTML-only extraction, placeholder selectors |
| 2026-03-13 | Step 1: Setup | Branch feature/F009-burger-king-scraper, ticket created, tracker updated |
| 2026-03-13 | Step 2: Plan approved | 9-step implementation plan |
| 2026-03-13 | Step 3: Site inspection | **BLOCKED.** BK Spain has no per-product nutrition data on website. All nutrition in centralized PDF on S3. Sanity GraphQL API has empty `allFeatureNutrition`. See §Blocking Investigation |
| 2026-03-13 | Feature blocked | Branch deleted, tracker updated. Spec and plan retained as reference |
