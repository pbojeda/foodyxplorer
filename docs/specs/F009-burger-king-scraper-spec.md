# F009 — Burger King Spain Scraper Spec

**Feature:** F009 | **Type:** Backend-Feature | **Epic:** E002 — Data Ingestion Pipeline
**Created:** 2026-03-13 | **Dependencies:** F008 complete (persistDishUtil, PrismaClient singleton, registry with `{ config, ScraperClass }` shape)

> F009 is the second chain scraper. It follows the pattern established by F008. Unlike F008, it does NOT need to create any shared infrastructure — `persist.ts`, `lib/prisma.ts`, and the registry type are already in place. F009 is purely additive.

---

## 1. Purpose

F009 implements the Burger King Spain (`burger-king-es`) chain scraper. It:

1. Extends `BaseScraper` with `extractDishes(page)` and `getMenuUrls(page)` implementations adapted to Burger King Spain's website structure.
2. Does NOT override `persistDish()` — it inherits the default delegation to `persistDishUtil(getPrismaClient(), dish)` established by F008, OR overrides it identically. See §8.
3. Registers `burger-king-es` in `packages/scraper/src/registry.ts`.
4. Establishes the fixture-based test pattern for Burger King Spain.

---

## 2. Target Website — Burger King Spain

### 2.1 Base URL

```
https://www.burgerking.es
```

### 2.2 Menu Navigation Structure

Burger King Spain publishes its menu at:

```
https://www.burgerking.es/menu
```

Menu categories include: Full Menus, Chicken, Burgers, Sides, Desserts, Vegetable, Gluten-Free, Drinks, Salads, Sauces. These are rendered as navigation links or filter tabs. Each category links to product detail pages or reveals product cards.

Individual product pages follow the URL pattern:

```
https://www.burgerking.es/menu/item-item_XXXXX
```

Example: `https://www.burgerking.es/menu/item-item_11116` (LONG CHICKEN).

**Navigation strategy:**

1. `getMenuUrls(page)` visits `https://www.burgerking.es/menu` and collects all anchor `href` values matching the pattern `/menu/item-item_\d+`. The page may be JavaScript-rendered — Playwright's `waitForSelector` must await the product list before harvesting links.
2. `extractDishes(page)` visits each product detail page and extracts nutritional data from the page's "Allergens and nutritional" section.

> **Verification required during implementation:** The exact URL pattern and selector for the product list must be verified by loading `https://www.burgerking.es/menu` in a real browser. The selectors in this spec are placeholders based on the known URL pattern and common BK site structure — they must be confirmed and updated before committing the implementation.

### 2.3 Per-Product Page Structure

Burger King Spain product pages are **unlikely to contain JSON-LD `NutritionInformation` structured data** (BK Spain does not follow the same Adobe Experience Manager CMS pattern as McDonald's). The primary — and expected only — extraction source is the HTML nutrition section.

Each product page contains an "Allergens and nutritional" section displaying per-serving nutritional values. The section is expected to use a definition list, table, or labeled row structure.

**Expected page elements (placeholders — verify at implementation time):**

| Element | Expected selector (placeholder) | Content |
|---|---|---|
| Product name | `h1` or `.product-title` or `[class*="product-name"]` | Product name in Spanish |
| Nutrition section wrapper | `[class*="nutrition"]` or `[class*="allergen"]` or `#nutrition` | Container for all nutrient rows |
| Nutrient rows | rows or items inside the nutrition wrapper | One per nutrient: label + value |
| Serving size | within nutrition section, label matching "Peso" or "Ración" | e.g. "215 g" |
| Price | `.price` or `[class*="price"]` or a data attribute | e.g. "5,49 €" |

> The product page at `https://www.burgerking.es/menu/item-item_11116` is a good starting point for inspecting the real DOM structure. All placeholder selectors must be replaced with real ones before finalizing implementation.

### 2.4 Dish Identity Fields

| Source | Content | Maps to |
|---|---|---|
| `h1` / product name element | Product name in Spanish | `name`, `nameEs` |
| URL path segment | `item_XXXXX` extracted from URL | `externalId` |
| Nutrition section weight row | Serving weight in grams | `portionGrams` |
| Price element | Price in EUR (comma-decimal format) | `priceEur` |

**`externalId` extraction:**

```
const match = page.url().match(/item-(item_\d+)$/)
const externalId = match?.[1]   // e.g. "item_11116"
```

Note: Price and portionGrams are optional — if their selectors are not found, the fields are omitted from `RawDishData` without error.

### 2.5 Product Category

Category is readable from the URL path or a breadcrumb element on the product page. Capture as `category` on `RawDishData` for logging. Not persisted to DB in Phase 1.

---

## 3. Anti-Bot Considerations

Burger King Spain may use **Akamai Bot Manager** or **Cloudflare** for bot protection, which is more aggressive than McDonald's Spain's configuration.

| Risk | Likelihood | Mitigation |
|---|---|---|
| Akamai / Cloudflare challenge page | Medium | Detect via body text; throw `ScraperBlockedError` |
| IP-based rate limiting or temporary suspension | Medium | Conservative rate limit (6 req/min); exponential back-off |
| CAPTCHA interstitial | Low-Medium | Detect via body text check ("captcha", "robot"); throw `ScraperBlockedError` |
| Cookie consent overlay blocking content | High | Click consent button on first page load (try/catch, non-fatal) |
| JavaScript-rendered menu page | High | Playwright required; `waitForSelector` before harvesting links |

**Detection signals:**

| Signal | Detection | Response |
|---|---|---|
| HTTP 403 | Response status | Throw `ScraperBlockedError` — BaseScraper records in errors |
| CAPTCHA / robot page | Body text contains "captcha" or "robot" or "estás siendo verificado" | Throw `ScraperBlockedError` |
| Empty product list after wait | `waitForSelector` timeout | Throw `ScraperStructureError` |
| No nutrition elements found | Nutrition section selector absent | Return empty array from `extractDishes` with `warn` log |

**Rate limit setting:** 6 requests/minute (more conservative than McDonald's) with concurrency 1. Adjust based on real-world observation during implementation.

---

## 4. Data Extraction Strategy

### 4.1 `getMenuUrls(page: Page): Promise<string[]>`

```
1. Navigate to https://www.burgerking.es/menu
   (BaseScraper calls this via its internal crawl loop)

2. Handle cookie consent (try/catch, non-fatal):
   try {
     await page.locator('[id*="cookie"], [class*="cookie"] button, #onetrust-accept-btn-handler').click({ timeout: 3_000 })
   } catch { /* not present */ }

3. await page.waitForSelector('<PLACEHOLDER_PRODUCT_LIST_SELECTOR>', { timeout: 15_000 })
   — waits until product links are rendered
   PLACEHOLDER: selector must be verified at implementation time
   Candidate: 'a[href*="/menu/item-item_"]'

4. Collect all hrefs:
   const hrefs = await page.$$eval(
     'a[href*="/menu/item-item_"]',
     (els) => els.map((el) => el.getAttribute('href')).filter(Boolean)
   )

5. Filter to product URLs only:
   hrefs matching /\/menu\/item-item_\d+/

6. Deduplicate (Set) — category filters may repeat the same product

7. Prepend baseUrl if hrefs are relative:
   href.startsWith('http') ? href : `${this.config.baseUrl}${href}`

8. Return the final URL array
```

**If the product list selector is not found within 15 seconds:** throw `ScraperStructureError('Product list selector not found on BK menu page — site structure may have changed')`.

### 4.2 `extractDishes(page: Page): Promise<RawDishData[]>`

```
1. Check for block signals (CAPTCHA detection):
   const bodyText = await page.evaluate(() => document.body.innerText)
   if (bodyText.match(/captcha|robot|estás siendo verificado/i)) {
     throw new ScraperBlockedError('CAPTCHA detected on BK product page')
   }

2. Handle cookie consent banner (try/catch, non-fatal) — same as §4.1 step 2

3. Extract product name:
   const name = await page.$eval('<PLACEHOLDER_NAME_SELECTOR>', el => el.textContent?.trim())
   PLACEHOLDER: verify selector at implementation time
   Candidate: 'h1'
   if (!name) throw new ScraperStructureError('Product name not found on BK page')

4. Extract externalId from URL:
   const match = page.url().match(/item-(item_\d+)$/)
   const externalId = match?.[1]   // e.g. "item_11116"

5. Extract nutrition data from HTML section:
   const nutrients = await extractNutritionSection(page)
   — See §7 for the extraction helper specification

6. Extract optional fields (each wrapped in try/catch):
   - portionGrams: extract serving weight from nutrition section "Peso" / "Ración" row
                   parse: '215 g' → 215  (strip unit)
   - priceEur:     page.$eval('<PLACEHOLDER_PRICE_SELECTOR>', ...)
                   parse: '5,49 €' → 5.49 (replace(',', '.') then parseFloat)
   - category:     extract from breadcrumb or URL path segment before item-item_

7. Compose and return RawDishData:
   [{
     externalId,
     name,
     nameEs: name,          // BK Spain publishes in Spanish — name IS nameEs
     description: undefined,  // BK product pages may not have a description paragraph
     category,
     portionGrams,
     priceEur,
     nutrients: { calories, proteins, carbohydrates, sugars, fats, saturatedFats,
                  fiber, salt, sodium },
     aliases: [],
     sourceUrl: page.url(),
     scrapedAt: new Date().toISOString(),
   }]
```

`extractDishes` returns a single-element array per product page. If name extraction fails, throw `ScraperStructureError`. All other failures return an empty array with a `warn` log.

---

## 5. Nutrient Field Mapping

Burger King Spain discloses these nutrients per serving (per portion as displayed on the product page):

| BK Spain label | `RawDishData.nutrients` field | Unit on page | Notes |
|---|---|---|---|
| Valor Energético (kcal) | `calories` | kcal | The kcal value; a kJ value may also be present — use kcal only |
| Grasas / Lípidos | `fats` | g | Total fat |
| Grasas saturadas | `saturatedFats` | g | |
| Hidratos de carbono / Carbohidratos | `carbohydrates` | g | |
| Azúcares | `sugars` | g | |
| Fibra | `fiber` | g | |
| Proteínas | `proteins` | g | |
| Sal | `salt` | g | BK Spain discloses `Sal` directly (not sodium); pass as `salt` field |
| Peso / Ración | portionGrams only | g | Serving weight — maps to `portionGrams`, not a nutrient field |

**Important — salt vs. sodium:**

Burger King Spain publishes `Sal` (salt in grams) directly, unlike McDonald's which publishes `Sodio` (sodium in mg). Pass the extracted value as `RawDishData.nutrients.salt` (in grams). Do NOT set `sodium` unless BK also discloses it separately. `normalizeNutrients` handles both fields independently — if only `salt` is set, `sodium` is derived as `salt / 2.5 * 1000`.

**Fields not disclosed by BK Spain:**
- `transFats` — not published (defaults to 0)
- `cholesterol` — not published (defaults to 0)
- `potassium` — not published (defaults to 0)
- `monounsaturatedFats` / `polyunsaturatedFats` — not published (default to 0)

All undisclosed fields will be absent from `RawDishData.nutrients` and will default to `0` in `normalizeNutrients`.

**Unit coercion:**
- Nutrient values from HTML are strings like `"215 g"`, `"510 kcal"` — `coerceNutrient` in `normalizeNutrients` handles stripping units via `replace(/[^0-9.]/g, '')`.
- Energia kJ value (if present alongside kcal): ignore — use kcal only.
- `portionGrams`: strip the " g" unit suffix manually in `extractDishes` before passing to `RawDishData`.
- `priceEur`: use `parseFloat(value.replace(',', '.').replace(/[^0-9.]/g, ''))` — do NOT use `coerceNutrient` for price (same rule as F008).

---

## 6. JSON-LD Parsing

**Burger King Spain is not expected to use JSON-LD `NutritionInformation` structured data.**

During implementation, the developer must verify this by inspecting the page source for `<script type="application/ld+json">` tags. If JSON-LD with `NutritionInformation` is found, add a `parseJsonLd` helper following the same pattern as `packages/scraper/src/chains/mcdonalds-es/jsonLdParser.ts` and use it as the primary extraction path (HTML section as fallback).

If JSON-LD is absent (expected case), the sole extraction path is the HTML nutrition section described in §7.

No `jsonLdParser.ts` file is created unless JSON-LD is confirmed present during implementation.

---

## 7. HTML Nutrition Section Extraction

Helper function `extractNutritionSection(page: Page): Promise<Partial<RawDishData['nutrients']>>`

Located in `packages/scraper/src/chains/burger-king-es/nutritionExtractor.ts`.

> **All selectors in this section are placeholders.** They must be verified by inspecting the real product page DOM (e.g. `https://www.burgerking.es/menu/item-item_11116`) before implementation. The algorithm and label mapping are correct — only the CSS selectors need runtime verification.

```
Algorithm:

1. Locate the nutrition section:
   await page.waitForSelector('<PLACEHOLDER_NUTRITION_SECTION_SELECTOR>', { timeout: 5_000 })
   Candidate selectors:
     '[class*="nutrition"]'
     '[class*="allergen"]'
     '#nutrition-info'
   If not found: return {} (empty nutrients — normalization will skip the dish with warn log)

2. Extract all nutrient rows from inside the section.
   BK Spain likely uses one of these structures:
     a) Definition list: <dl><dt>label</dt><dd>value</dd>...</dl>
     b) Table rows: <tr><td>label</td><td>value</td></tr>
     c) Div/span pairs: <div class="row"><span class="label">...</span><span class="value">...</span></div>

   Placeholder approach (adapt per actual DOM):
     const rows = await page.$$('[PLACEHOLDER_NUTRITION_ROW_SELECTOR]')
     For each row: extract label text and value text

3. Normalize label text: lowercase, trim, collapse multiple spaces

4. Map Spanish labels to nutrient keys:
   LABEL_MAP = {
     'valor energético':          'calories',    // use kcal value only
     'energía':                   'calories',
     'calorías':                  'calories',
     'grasas':                    'fats',
     'lípidos':                   'fats',
     'grasas saturadas':          'saturatedFats',
     'hidratos de carbono':       'carbohydrates',
     'carbohidratos':             'carbohydrates',
     'azúcares':                  'sugars',
     'fibra':                     'fiber',
     'fibra alimentaria':         'fiber',
     'proteínas':                 'proteins',
     'proteina':                  'proteins',
     'sal':                       'salt',
     'sodio':                     'sodium',      // fallback if BK discloses sodio instead
     'peso':                      '__portionGrams',  // signals portionGrams extraction
     'ración':                    '__portionGrams',
   }
   Keys prefixed with '__' are extracted separately and returned outside the nutrients object.

5. For energy rows: BK may display two values (kJ and kcal) in one row or two separate rows.
   When two energy rows exist, select the kcal row (label containing "kcal" or matching "calorías").
   When one energy row shows both values (e.g. "2133 kJ / 510 kcal"), extract only the kcal part:
     const kcalMatch = valueText.match(/(\d[\d,.]*)[\s]*kcal/i)
     use kcalMatch[1] as the calories value

6. Return:
   {
     nutrients: {
       calories,
       fats,
       saturatedFats,
       carbohydrates,
       sugars,
       fiber,
       proteins,
       salt,        // or sodium — whichever BK discloses
     },
     portionGrams,  // separate from nutrients (maps to Dish.portionGrams)
   }
```

If no rows are found and the section was also absent: return an empty nutrients object. `normalizeNutrients` will return `null` (missing required fields), and `BaseScraper` will skip the dish with a `warn` log.

---

## 8. Persistence Strategy

F009 does NOT need to implement `persistDish()`. The shared `persistDishUtil` from `packages/scraper/src/utils/persist.ts` (created by F008) handles the upsert.

**Two valid approaches — choose one at implementation time:**

**Option A — Inherit without override (preferred if BaseScraper supports it):**
If `BaseScraper` has been updated (in or after F008) to call `persistDishUtil(getPrismaClient(), dish)` by default in its `persistDish()` method, then `BurgerKingEsScraper` does not need to override `persistDish()` at all.

**Option B — Override with identical delegation (safe default):**
```typescript
protected override async persistDish(dish: NormalizedDishData): Promise<void> {
  await persistDishUtil(getPrismaClient(), dish)
}
```

This is exactly what `McDonaldsEsScraper` does. Use this if there is any ambiguity about the base class behavior.

Either way, the upsert algorithm is identical to F008 §8.2 — no new persistence logic is introduced in F009.

### DB Seed Rows Required

A seed script or manual SQL must insert these rows before the scraper can run:

**Restaurant row:**
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
```

**DataSource row:**
```sql
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

The generated UUIDs from these rows must be set as `BURGER_KING_ES_RESTAURANT_ID` and `BURGER_KING_ES_SOURCE_ID` in the scraper's environment.

---

## 9. Registry Integration

Add the `burger-king-es` entry to `packages/scraper/src/registry.ts`:

```typescript
import { BurgerKingEsScraper } from './chains/burger-king-es/BurgerKingEsScraper.js'

export const registry: ScraperRegistry = {
  'mcdonalds-es': {
    config: McDonaldsEsScraper.CONFIG,
    ScraperClass: McDonaldsEsScraper,
  },
  'burger-king-es': {
    config: BurgerKingEsScraper.CONFIG,
    ScraperClass: BurgerKingEsScraper,
  },
}
```

No type changes to the registry — the `{ config, ScraperClass }` shape is already in place from F008. No changes to `runner.ts` — it already uses `new entry.ScraperClass(entry.config)`.

---

## 10. File Structure

```
packages/scraper/src/
└── chains/
    └── burger-king-es/
        ├── BurgerKingEsScraper.ts      # Extends BaseScraper
        ├── config.ts                   # Static ScraperConfig for burger-king-es
        └── nutritionExtractor.ts       # extractNutritionSection(page) helper

packages/scraper/src/__tests__/
├── burger-king-es.test.ts              # Chain scraper unit tests
└── fixtures/
    └── burger-king-es/
        ├── product-page.html           # Fixture: single product page with nutrition section
        ├── menu-page.html              # Fixture: menu index with product links
        └── product-blocked.html        # Fixture: CAPTCHA / blocked response page
```

**Modified files:**

```
packages/scraper/src/
├── registry.ts     # Add 'burger-king-es' entry
└── config.ts       # Add BURGER_KING_ES_RESTAURANT_ID, BURGER_KING_ES_SOURCE_ID env vars
```

**No new shared infrastructure files** — `lib/prisma.ts`, `utils/persist.ts`, `index.ts` barrel are all unchanged from F008.

> Note: F008 had 4 fixture files (including `product-page-no-jsonld.html`). F009 has 3 fixture files because BK Spain is not expected to have JSON-LD — there is no "with JSON-LD" vs "without JSON-LD" split. If JSON-LD is confirmed present during implementation, add a fourth fixture.

---

## 11. Static Config

```typescript
// packages/scraper/src/chains/burger-king-es/config.ts

import { ScraperConfigSchema } from '../../base/types.js'

export const BURGER_KING_ES_CONFIG = ScraperConfigSchema.parse({
  chainSlug:    'burger-king-es',
  restaurantId: process.env['BURGER_KING_ES_RESTAURANT_ID']!,
  sourceId:     process.env['BURGER_KING_ES_SOURCE_ID']!,
  baseUrl:      'https://www.burgerking.es',
  startUrls:    ['https://www.burgerking.es/menu'],
  rateLimit: {
    requestsPerMinute: 6,     // More conservative than McDonald's due to Akamai/Cloudflare risk
    concurrency: 1,
  },
  retryPolicy: {
    maxRetries: 3,
    backoffMs: 3000,          // 3s initial back-off (longer than McDonald's)
    backoffMultiplier: 2,
  },
  selectors: {
    productList:      'a[href*="/menu/item-item_"]',       // PLACEHOLDER — verify at implementation
    productName:      'h1',                                // PLACEHOLDER — verify at implementation
    nutritionSection: '[class*="nutrition"]',              // PLACEHOLDER — verify at implementation
    nutritionRows:    '[class*="nutrition"] [class*="row"]', // PLACEHOLDER — verify at implementation
    cookieConsent:    '#onetrust-accept-btn-handler',      // PLACEHOLDER — verify at implementation
    price:            '[class*="price"]',                  // PLACEHOLDER — verify at implementation
  },
  headless: true,
  locale:   'es-ES',
})
```

**Important:** All `selectors` values marked as PLACEHOLDER must be replaced with real selectors confirmed by inspecting the live site before the implementation is complete. The spec author cannot verify these without browser access to burgerking.es.

**`restaurantId` and `sourceId`** are UUIDs of rows that must already exist in the DB. See §8 for seed SQL. The seed script or manual SQL must run before `BurgerKingEsScraper` can execute.

---

## 12. Error Handling Strategy

| Scenario | Where caught | Action |
|---|---|---|
| CAPTCHA / block page detected | `extractDishes` body text check | Throw `ScraperBlockedError` |
| Cookie consent click fails | `getMenuUrls` / `extractDishes` try/catch | Silently continue |
| Product list selector not found within 15s | `getMenuUrls` `waitForSelector` timeout | Throw `ScraperStructureError('Product list selector not found')` |
| Product name not found | `extractDishes` | Throw `ScraperStructureError` — caught by BaseScraper, logged in errors |
| Nutrition section selector not found | `extractNutritionSection` | Return empty nutrients object — normalization returns null, dish skipped with warn |
| No nutrient rows found in section | `extractNutritionSection` | Return empty nutrients object — same as above |
| Energy row has kJ only (no kcal) | `extractNutritionSection` | `calories` absent → `normalizeNutrients` returns null → dish skipped with warn |
| `normalizeNutrients` returns null | `BaseScraper.normalize()` | Increment `dishesSkipped`, log warn — BaseScraper handles this |
| Prisma transaction failure | `persistDish` | Rethrow — BaseScraper catches, increments `dishesSkipped`, logs error |
| HTTP 403 on any page | Crawlee `failedRequestHandler` | Recorded as `SCRAPER_BLOCKED_ERROR` in `ScraperResult.errors` |
| Page navigation timeout | Crawlee timeout | Recorded in `ScraperResult.errors`, retry policy applies |

---

## 13. New Environment Variables

Add to `packages/scraper/src/config.ts`:

```typescript
export const ScraperEnvSchema = z.object({
  // ... existing fields including MCDONALDS_ES_* ...
  BURGER_KING_ES_RESTAURANT_ID: z.string().uuid().optional(),
  BURGER_KING_ES_SOURCE_ID:     z.string().uuid().optional(),
})
```

These are `optional()` at the env schema level — validation that they are present happens at scraper startup inside `BurgerKingEsScraper.CONFIG` construction (the `!` non-null assertion throws at parse time if missing).

Also add placeholder UUID stubs to `packages/scraper/vitest.config.ts` env block:

```typescript
// vitest.config.ts env block additions
BURGER_KING_ES_RESTAURANT_ID: '00000000-0000-4000-a000-000000000009',
BURGER_KING_ES_SOURCE_ID:     '00000000-0000-4000-a000-000000000010',
```

---

## 14. Testing Strategy

### 14.1 Test File: `packages/scraper/src/__tests__/burger-king-es.test.ts`

Test suite structure:

```
describe('BurgerKingEsScraper', () => {
  describe('getMenuUrls(page)', () => {
    it('extracts product URLs matching /menu/item-item_\\d+ from the menu page')
    it('deduplicates repeated product URLs')
    it('prepends baseUrl to relative hrefs')
    it('throws ScraperStructureError if product list selector not found')
  })

  describe('extractDishes(page)', () => {
    it('extracts product name from the product heading')
    it('sets nameEs equal to name (Spanish-language site)')
    it('extracts externalId from the URL pattern item_(\\d+)')
    it('extracts all nutrient fields from the HTML nutrition section')
    it('handles combined kJ / kcal energy row — uses kcal value only')
    it('extracts portionGrams from the serving weight row')
    it('extracts priceEur — comma-decimal "5,49 €" parses to 5.49')
    it('returns a dish without error when price selector is absent')
    it('returns a dish without error when serving size row is absent')
    it('throws ScraperBlockedError when body contains "captcha"')
    it('throws ScraperStructureError when product name is not found')
    it('returns empty array when nutrition section is not found (warn logged)')
  })

  describe('extractNutritionSection(page)', () => {
    it('maps "sal" label to salt nutrient key')
    it('maps "hidratos de carbono" label to carbohydrates')
    it('maps "proteínas" to proteins')
    it('maps "fibra" to fiber')
    it('returns empty object when nutrition section selector not found')
    it('handles label text with extra whitespace or mixed case')
  })

  describe('persistDish() delegation', () => {
    it('calls persistDishUtil with getPrismaClient() and normalized dish data')
  })
})
```

### 14.2 Fixture Files

Fixtures are authored HTML files that reproduce the BK Spain page structure. They must be committed before tests reference them. Because the real site structure is not yet verified, fixtures will be created during implementation after inspecting the live site.

| Fixture | Content | Used by |
|---|---|---|
| `product-page.html` | Full product page for one BK product (e.g. LONG CHICKEN) with nutrition section | All `extractDishes` tests |
| `menu-page.html` | Menu index with 5+ `<a href="/menu/item-item_XXXXX">` links, at least one duplicated | `getMenuUrls` tests |
| `product-blocked.html` | Minimal page with "captcha" in body text | CAPTCHA detection test |

> If JSON-LD `NutritionInformation` is found on BK pages during implementation, add a fourth fixture: `product-page-with-jsonld.html`.

### 14.3 Mocking Strategy

- `persistDish()` is mocked in unit tests — tests do NOT hit a real database.
- `createCrawler()` is overridden using the DI pattern from F008: `TestBurgerKingScraper extends BurgerKingEsScraper` with `createCrawler` returning a mock that drives the page handler.
- `PrismaClient` interactions are bypassed by mocking `persistDishUtil` at the module level: `vi.mock('../utils/persist.js')`.
- The mock `page` object must implement: `evaluate()`, `locator()`, `waitForSelector()`, `$$eval()`, `$eval()`, `$$()`, `url()`.

### 14.4 No New `persist.test.ts`

F009 does not add persistence tests — the shared `persistDishUtil` is fully tested in `persist.test.ts` created by F008. Any F009-specific persistence behavior (there is none) would be tested in `burger-king-es.test.ts` via spy/mock.

---

## 15. Acceptance Criteria

- [ ] `BurgerKingEsScraper` extends `BaseScraper`; TypeScript strict mode, no `any` — verified by `tsc --noEmit`
- [ ] `getMenuUrls` extracts and deduplicates absolute product URLs from fixture `menu-page.html`
- [ ] `extractDishes` extracts `name`, `nameEs`, `externalId`, and all disclosed nutrients from `product-page.html`
- [ ] `externalId` is correctly extracted as `item_XXXXX` from the URL
- [ ] `salt` is passed as `RawDishData.nutrients.salt` (not `sodium`) — BK Spain discloses salt directly
- [ ] All nutrient values pass through `normalizeNutrients` without returning null for the fixture data
- [ ] `portionGrams` extracted correctly from the nutrition section serving weight row
- [ ] `priceEur` coerces Spanish comma-decimal format correctly ("5,49 €" → 5.49)
- [ ] `ScraperBlockedError` thrown when CAPTCHA detected in body text
- [ ] `ScraperStructureError` thrown when product name selector not found
- [ ] Empty array returned (with warn log) when nutrition section not found — dish skipped
- [ ] Registry updated: `registry['burger-king-es']` resolves to `{ config, ScraperClass: BurgerKingEsScraper }`
- [ ] `ScraperEnvSchema` updated with `BURGER_KING_ES_RESTAURANT_ID` and `BURGER_KING_ES_SOURCE_ID`
- [ ] Vitest config updated with placeholder UUIDs for both BK env vars
- [ ] All 3 fixture HTML files committed to `src/__tests__/fixtures/burger-king-es/`
- [ ] All placeholder selectors in `config.ts` replaced with real verified selectors
- [ ] All unit tests pass (`vitest run`) — no real network calls in tests
- [ ] `tsc --noEmit` passes in `packages/scraper`
- [ ] TypeScript strict mode — no `any`, no `ts-ignore`

---

## 16. Edge Cases

| Scenario | Expected Behaviour |
|---|---|
| Menu page has zero product links | `getMenuUrls` returns `[]`; `run()` returns `status: 'success'` with 0 dishes (empty is valid) |
| Energy row shows both kJ and kcal ("2133 kJ / 510 kcal") | Extract kcal value only via regex `(\d[\d,.]*)\s*kcal`; ignore kJ |
| Energy row shows only kJ (no kcal) | `calories` will be absent from nutrients; `normalizeNutrients` returns null; dish skipped with warn |
| `Sal` is disclosed in mg instead of g | Value would be orders-of-magnitude too high after normalizeNutrients coercion; add a warn log if `salt > 100` (suspiciously high — likely mg instead of g) |
| `Sodio` (sodium in mg) disclosed instead of `Sal` | Map to `sodium` field instead of `salt`; `normalizeNutrients` derives salt from sodium automatically |
| Both `Sal` and `Sodio` disclosed | Pass both; `normalizeNutrients` uses the "both present" branch (treats both as-is) |
| Price format uses thousand separator ("1.050,00 €") | `parseFloat(value.replace(',', '.').replace(/[^0-9.]/g, ''))` would produce incorrect result; use `value.replace(/\./g, '').replace(',', '.')` for ES locale prices with thousand separators |
| Product URL contains language prefix ("/en/menu/item-item_XXXXX") | Filter regex must match with or without `/en` prefix; adjust filter pattern if BK serves bilingual URLs |
| Serving size in format "215g" (no space) | `portionGrams` parsing must handle both "215 g" and "215g" |
| Cookie consent modal blocks product list rendering | Cookie consent click runs before `waitForSelector`; 3-second timeout prevents hang |
| Same product appears in multiple category tabs | Set deduplication in `getMenuUrls` prevents double extraction |
| `externalId` URL pattern changes between scraper runs | Falls back to name-based match — dish is updated, not duplicated |
| Dish with same name but different `restaurantId` | `findFirst` scopes by `restaurantId` — no cross-chain collision |
| `BURGER_KING_ES_RESTAURANT_ID` not set | `ScraperConfigSchema.parse` throws at config instantiation time — process exits with descriptive message |
| Akamai challenge page (JavaScript challenge, not CAPTCHA text) | Body text check may not detect Akamai's JS challenge; HTML will render as a page without nutrition content; nutrition section selector absent → empty array + warn log (acceptable degradation in Phase 1) |

---

## 17. Out of Scope

- Scraping images or logos
- Category-to-`DishCategory` FK mapping (Phase 2)
- Proxy rotation or fingerprint randomization
- PDF nutritional documents (available at burgerking.es/content/nutrition-information-documents-area — separate ingestion via F007b)
- Scheduling or cron orchestration
- Monitoring or alerting on scraper run results (F018)
- Embedding generation (F019)
- Any chain scraper other than `burger-king-es`
- Bilingual URL support (`/en/menu/item-item_XXXXX`) — Spanish URL pattern only in Phase 1
