# F008 — McDonald's Spain Scraper Spec

**Feature:** F008 | **Type:** Backend-Feature | **Epic:** E002 — Data Ingestion Pipeline
**Created:** 2026-03-13 | **Dependencies:** F007 complete (BaseScraper scaffold)

> This is the first chain scraper implementation. It establishes the pattern for F009–F017.
> Every design decision here becomes a template for the remaining nine chains.

---

## 1. Purpose

F008 implements the McDonald's Spain (`mcdonalds-es`) chain scraper. It:

1. Extends `BaseScraper` with `extractDishes(page)` and `getMenuUrls(page)` implementations.
2. Overrides `persistDish()` with real Prisma upsert logic — the first concrete persistence implementation in the scraper pipeline.
3. Registers `mcdonalds-es` in `packages/scraper/src/registry.ts`.
4. Updates `runner.ts` to instantiate the scraper class from the registry entry.
5. Establishes the fixture-based test pattern for all chain scrapers.

---

## 2. Target Website — McDonald's Spain

### 2.1 Base URL

```
https://www.mcdonalds.com/es/es-es.html
```

### 2.2 Menu Navigation Structure

McDonald's Spain publishes nutritional information at a dedicated section:

```
https://www.mcdonalds.com/es/es-es/product/<product-slug>.html
```

The main menu index page listing all products is at:

```
https://www.mcdonalds.com/es/es-es/menu.html
```

Menu categories (burgers, chicken, breakfast, desserts, drinks, sides, salads, McMenu combos, sauces) are rendered as tab-based navigation elements. Each category tab reveals product cards. The product cards link to individual product detail pages.

**Navigation strategy:**

1. `getMenuUrls(page)` visits `https://www.mcdonalds.com/es/es-es/menu.html` and collects all anchor `href` values matching the pattern `/es/es-es/product/<slug>.html`. This page is JavaScript-rendered (React SPA) — Playwright's `waitForSelector` must await the product card grid before harvesting links.
2. `extractDishes(page)` visits each product detail page and extracts nutritional data from the structured data and/or nutrient table.

### 2.3 Per-Product Page Structure

McDonald's product pages use two complementary data sources:

**Source A: JSON-LD structured data (`<script type="application/ld+json">`)**

Each product page includes a `NutritionInformation` schema object embedded in JSON-LD. This is the most reliable extraction target because it is structured and relatively stable.

Relevant fields in the JSON-LD:
```
{
  "@type": "NutritionInformation",
  "calories": "490 cal",          // always present
  "fatContent": "19 g",           // total fat
  "saturatedFatContent": "7 g",
  "transFatContent": "0.5 g",
  "carbohydrateContent": "58 g",
  "fiberContent": "3 g",
  "sugarContent": "12 g",
  "proteinContent": "27 g",
  "sodiumContent": "870 mg"
}
```

Values are strings like `"490 cal"`, `"19 g"`, `"870 mg"`. The `coerceNutrient` function in `normalizeNutrients` handles stripping the unit suffix automatically.

**Source B: HTML nutrient table (fallback)**

If JSON-LD is absent or incomplete, a `<table>` with class `.cmp-nutrition-summary__table` or similar selector is present on the page. Each `<tr>` contains a label and a value cell.

Extraction strategy: try JSON-LD first; fall back to HTML table. Log a `warn` if falling back.

### 2.4 Dish Identity Fields

Each product page also provides:

| HTML element | Content | Maps to |
|---|---|---|
| `h1.cmp-product-details-main__heading` | Product name (Spanish) | `name`, `nameEs` |
| `.cmp-product-details-main__description` | Description paragraph | `description` |
| `<meta name="pageId">` or URL slug | Unique product ID | `externalId` |
| `.cmp-nutrition-summary__serving` or similar | Serving size (e.g. "210 g") | `portionGrams` |
| `.cmp-product-details-main__price` | Price (e.g. "5,49 €") | `priceEur` |

Note: Price and portion weight may not always be present — they are optional fields in `RawDishData`.

### 2.5 Product Category

The menu category (e.g. "Hamburguesas", "Pollo", "Desayuno") is available in the page breadcrumb or URL path. Capture as `category` on `RawDishData` for logging; not persisted to DB in Phase 1.

---

## 3. McDonald's Anti-Bot Considerations

McDonald's Spain (mcdonalds.com) is served via a standard CDN without aggressive bot-detection. However:

- The site is a **JavaScript SPA** (React). Playwright is required — static HTML fetchers would not work.
- **Cloudflare** is used as the CDN. The site does NOT appear to use Cloudflare's Bot Fight Mode or Turnstile challenges on the menu pages.
- Cookie consent banners must be handled: after navigation, the scraper must click "Aceptar todas las cookies" if the consent overlay is present, to expose the full page content. Use `page.locator('[data-testid="cookie-consent-accept"]').click()` or equivalent, wrapped in a `try/catch` (not all sessions trigger the banner).
- Respect rate limits: use the conservative defaults from `ScraperConfig` (10 req/min, 1 concurrency).
- Set a realistic user-agent. The `BaseScraper` already sets `Accept-Language: es-ES,es;q=0.9`. No additional fingerprinting required in Phase 1.

**Detection signals to watch for:**

| Signal | Detection | Response |
|---|---|---|
| HTTP 403 | Response status | Throw `ScraperBlockedError` — BaseScraper catches, records in errors |
| CAPTCHA page | Body text contains "captcha" or "robot" | Throw `ScraperBlockedError` |
| Empty product grid after waiting | `waitForSelector` times out | Throw `ScraperStructureError` |
| JSON-LD absent + table absent | No nutrition elements found | Return empty array from `extractDishes` (page logged as warn) |

---

## 4. Data Extraction Strategy

### 4.1 `getMenuUrls(page: Page): Promise<string[]>`

```
1. await page.waitForSelector('.cmp-product-list__item a', { timeout: 15_000 })
   — waits until the product card grid is rendered

2. Collect all hrefs:
   const hrefs = await page.$$eval(
     '.cmp-product-list__item a',
     (els) => els.map((el) => el.getAttribute('href')).filter(Boolean)
   )

3. Filter to product URLs only:
   hrefs that match /\/es\/es-es\/product\/[^/]+\.html$/

4. Deduplicate (Set) — category tabs may repeat the same product

5. Prepend baseUrl if hrefs are relative:
   href.startsWith('http') ? href : `${this.config.baseUrl}${href}`

6. Return the final URL array
```

**If `.cmp-product-list__item a` selector is not found within 15 seconds:** throw `ScraperStructureError('Product list selector not found on menu page — site structure may have changed')`.

### 4.2 `extractDishes(page: Page): Promise<RawDishData[]>`

```
1. Handle cookie consent banner (try/catch, non-fatal):
   try {
     await page.locator('[data-testid="cookie-consent-accept"]').click({ timeout: 3_000 })
   } catch { /* banner not present */ }

2. Extract product name:
   const name = await page.$eval('h1.cmp-product-details-main__heading', el => el.textContent?.trim())
   if (!name) throw ScraperStructureError('Product name not found')

3. Extract externalId from URL slug:
   const slugMatch = page.url().match(/\/product\/([^/]+)\.html$/)
   const externalId = slugMatch?.[1]   // undefined if not matched

4. Extract nutritional data — try JSON-LD first:
   const ldJson = await page.$eval(
     'script[type="application/ld+json"]',
     el => el.textContent
   ).catch(() => null)

   const nutrition = ldJson ? parseJsonLd(ldJson) : null

5. If JSON-LD absent or incomplete, fall back to HTML table:
   if (!nutrition || !isComplete(nutrition)) {
     const tableData = await extractNutritionTable(page)
     // merge: JSON-LD values take precedence
   }

6. Extract optional fields (each wrapped in try/catch):
   - description: page.$eval('.cmp-product-details-main__description', ...)
   - portionGrams: parse from '.cmp-nutrition-summary__serving' (e.g. "210 g" → 210)
   - priceEur: parse from '.cmp-product-details-main__price' (e.g. "5,49 €" → 5.49)
   - category: page.$eval('.cmp-breadcrumb a:nth-child(2)', ...)

7. Compose and return RawDishData:
   [{
     externalId,
     name,
     nameEs: name,          // McDonald's Spain publishes in Spanish — name IS nameEs
     description,
     category,
     portionGrams,
     priceEur,
     nutrients: { calories, proteins, carbohydrates, sugars, fats, saturatedFats,
                  transFats, fiber, salt, sodium },
     aliases: [],
     sourceUrl: page.url(),
     scrapedAt: new Date().toISOString(),
   }]
```

`extractDishes` returns a single-element array per product page (one page = one product on McDonald's Spain). If name extraction fails, throw `ScraperStructureError`. All other failures return an empty array with a `warn` log.

---

## 5. Nutrient Field Mapping

McDonald's Spain discloses these nutrients per serving (portion as stated on packaging):

| McDonald's label | `RawDishData.nutrients` field | Unit on page | Notes |
|---|---|---|---|
| Calorías / Valor energético | `calories` | kcal | JSON-LD uses `"calories"` key |
| Grasas totales / Lípidos | `fats` | g | JSON-LD: `fatContent` |
| Grasas saturadas | `saturatedFats` | g | JSON-LD: `saturatedFatContent` |
| Grasas trans | `transFats` | g | JSON-LD: `transFatContent` |
| Hidratos de carbono | `carbohydrates` | g | JSON-LD: `carbohydrateContent` |
| Azúcares | `sugars` | g | JSON-LD: `sugarContent` |
| Fibra alimentaria | `fiber` | g | JSON-LD: `fiberContent` |
| Proteínas | `proteins` | g | JSON-LD: `proteinContent` |
| Sal / Sodio | `sodium` | mg | JSON-LD: `sodiumContent`. `normalizeNutrients` derives `salt` from sodium. |

**Fields not disclosed by McDonald's Spain:**
- `cholesterol` — not published in Spanish regulation context (defaults to 0)
- `potassium` — not published
- `monounsaturatedFats` / `polyunsaturatedFats` — not published

All undisclosed fields will be absent from `RawDishData.nutrients` and will default to `0` in `normalizeNutrients`.

**Unit coercion:**
- Values from JSON-LD are strings like `"490 cal"`, `"19 g"`, `"870 mg"` — `coerceNutrient` strips units via `replace(/[^0-9.]/g, '')`.
- Sodium is in mg on the page. `normalizeNutrients` derives `salt_g = sodium_mg / 1000 * 2.5`. No conversion needed in the scraper.
- Calories: JSON-LD uses "cal" (which McDonald's uses as kcal). No conversion — values map directly.

---

## 6. JSON-LD Parsing

Helper function `parseJsonLd(raw: string): Partial<RawDishData['nutrients']> | null`

Located in `packages/scraper/src/chains/mcdonalds-es/jsonLdParser.ts`.

```
1. JSON.parse(raw) — return null on SyntaxError
2. Look for @graph array or top-level @type === "NutritionInformation"
3. Extract the NutritionInformation node if nested in a Product @type
4. Map JSON-LD keys to RawDishData nutrient keys (see table in §5)
5. Return partial nutrients object — keys present only if found in JSON-LD
6. Return null if no NutritionInformation node found
```

`isComplete(nutrition)` checks that at minimum `calories`, `proteins`, `carbohydrates`, and `fats` are non-null. If any required field is missing from JSON-LD, fall back to the HTML table.

---

## 7. HTML Table Fallback Extraction

Helper function `extractNutritionTable(page: Page): Promise<Partial<RawDishData['nutrients']>>`

Located in `packages/scraper/src/chains/mcdonalds-es/tableExtractor.ts`.

```
1. Locate the nutrition summary table:
   const rows = await page.$$('.cmp-nutrition-summary__table tr')

2. For each row:
   - col[0]: label text (Spanish)
   - col[1]: value text (e.g. "490 kcal", "19 g")

3. Map Spanish labels to nutrient keys:
   LABEL_MAP = {
     'valor energético': 'calories',
     'calorías': 'calories',
     'grasas': 'fats',
     'grasas saturadas': 'saturatedFats',
     'grasas trans': 'transFats',
     'hidratos de carbono': 'carbohydrates',
     'azúcares': 'sugars',
     'fibra': 'fiber',
     'fibra alimentaria': 'fiber',
     'proteínas': 'proteins',
     'sal': 'salt',
     'sodio': 'sodium',
   }
   Labels are normalized: lowercase, trim, collapse spaces.

4. Return partial nutrients object
```

If no rows are found and JSON-LD also failed: return an empty nutrients object. `normalizeNutrients` will return `null` (missing required fields), and `BaseScraper` will skip the dish with a `warn` log.

---

## 8. Persistence Strategy — `persistDish()` Override

F008 provides the **first real implementation** of `persistDish()`. All chain scrapers F009–F017 will reuse the same implementation from a shared utility — they do NOT need to override `persistDish()` themselves.

### 8.1 New file: `packages/scraper/src/utils/persist.ts`

This utility is created by F008 and exported from the scraper package for reuse by all subsequent chain scrapers.

```typescript
// packages/scraper/src/utils/persist.ts

import { PrismaClient } from '@prisma/client'
import type { NormalizedDishData } from '../base/types.js'

/**
 * Upserts a normalized dish and its nutrients into the database.
 *
 * Upsert logic:
 *   1. Find existing dish: (restaurantId, externalId) if externalId present,
 *      else (restaurantId, lower(name)) match via findFirst.
 *   2. Create or update the Dish row.
 *   3. Upsert DishNutrient row on (dishId, sourceId) — guaranteed unique by
 *      the @@unique([dishId, sourceId]) constraint on dish_nutrients.
 *   4. All writes in a single Prisma $transaction.
 *
 * Note: Dish model lacks @@unique([restaurantId, name]) — so we use findFirst
 * + conditional create/update instead of a native Prisma upsert.
 */
export async function persistDish(
  prisma: PrismaClient,
  dish: NormalizedDishData,
): Promise<void>
```

### 8.2 Upsert Algorithm (detailed)

```
INPUTS:
  dish.restaurantId   — UUID
  dish.sourceId       — UUID
  dish.externalId     — string | undefined
  dish.name           — string (trimmed, normalized)
  dish.nutrients.*    — all numeric

ALGORITHM:

await prisma.$transaction(async (tx) => {

  // Step 1: Look up existing dish
  const existing = await tx.dish.findFirst({
    where: dish.externalId
      ? { restaurantId: dish.restaurantId, externalId: dish.externalId }
      : { restaurantId: dish.restaurantId, name: dish.name },
    select: { id: true },
  })

  // Step 2: Create or update Dish row
  let dishId: string
  if (existing) {
    await tx.dish.update({
      where: { id: existing.id },
      data: {
        name:             dish.name,
        nameEs:           dish.nameEs ?? null,
        description:      dish.description ?? null,
        externalId:       dish.externalId ?? null,
        availability:     dish.availability,
        portionGrams:     dish.portionGrams ?? null,
        priceEur:         dish.priceEur ?? null,
        aliases:          dish.aliases,
        confidenceLevel:  dish.confidenceLevel,
        estimationMethod: dish.estimationMethod,
      },
    })
    dishId = existing.id
  } else {
    const created = await tx.dish.create({
      data: {
        restaurantId:     dish.restaurantId,
        sourceId:         dish.sourceId,
        name:             dish.name,
        nameEs:           dish.nameEs ?? null,
        description:      dish.description ?? null,
        externalId:       dish.externalId ?? null,
        availability:     dish.availability,
        portionGrams:     dish.portionGrams ?? null,
        priceEur:         dish.priceEur ?? null,
        aliases:          dish.aliases,
        confidenceLevel:  dish.confidenceLevel,
        estimationMethod: dish.estimationMethod,
      },
      select: { id: true },
    })
    dishId = created.id
  }

  // Step 3: Upsert DishNutrient — unique on (dishId, sourceId)
  await tx.dishNutrient.upsert({
    where:  { dishId_sourceId: { dishId, sourceId: dish.sourceId } },
    create: { dishId, sourceId: dish.sourceId, ...nutrientFields(dish) },
    update: { ...nutrientFields(dish) },
  })
})
```

Where `nutrientFields(dish)` extracts and converts the nutrients object:
```
{
  calories:            new Prisma.Decimal(dish.nutrients.calories),
  proteins:            new Prisma.Decimal(dish.nutrients.proteins),
  carbohydrates:       new Prisma.Decimal(dish.nutrients.carbohydrates),
  sugars:              new Prisma.Decimal(dish.nutrients.sugars),
  fats:                new Prisma.Decimal(dish.nutrients.fats),
  saturatedFats:       new Prisma.Decimal(dish.nutrients.saturatedFats),
  fiber:               new Prisma.Decimal(dish.nutrients.fiber),
  salt:                new Prisma.Decimal(dish.nutrients.salt),
  sodium:              new Prisma.Decimal(dish.nutrients.sodium),
  transFats:           new Prisma.Decimal(dish.nutrients.transFats),
  cholesterol:         new Prisma.Decimal(dish.nutrients.cholesterol),
  potassium:           new Prisma.Decimal(dish.nutrients.potassium),
  monounsaturatedFats: new Prisma.Decimal(dish.nutrients.monounsaturatedFats),
  polyunsaturatedFats: new Prisma.Decimal(dish.nutrients.polyunsaturatedFats),
  referenceBasis:      dish.nutrients.referenceBasis,
  estimationMethod:    dish.estimationMethod,
  confidenceLevel:     dish.confidenceLevel,
  extra:               dish.nutrients.extra ?? null,
}
```

### 8.3 PrismaClient Singleton

`packages/scraper/src/lib/prisma.ts` — new file, same singleton pattern as `packages/api/src/lib/prisma.ts`.

```typescript
import { PrismaClient } from '@prisma/client'

let prisma: PrismaClient | undefined

export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient()
  }
  return prisma
}
```

### 8.4 `persistDish()` Override in `McDonaldsEsScraper`

```typescript
protected override async persistDish(dish: NormalizedDishData): Promise<void> {
  await persistDishUtil(getPrismaClient(), dish)
}
```

`persistDishUtil` is the function from `utils/persist.ts` above (renamed to avoid collision with the method name).

---

## 9. Registry Integration

### 9.1 Updated `registry.ts`

```typescript
// packages/scraper/src/registry.ts

import type { ScraperConfig } from './base/types.js'
import { McDonaldsEsScraper } from './chains/mcdonalds-es/McDonaldsEsScraper.js'

export type ScraperRegistry = Record<string, {
  config: ScraperConfig
  ScraperClass: typeof BaseScraper
}>

export const registry: ScraperRegistry = {
  'mcdonalds-es': {
    config: McDonaldsEsScraper.CONFIG,
    ScraperClass: McDonaldsEsScraper,
  },
}
```

Note: The registry type must be updated from `Record<string, ScraperConfig>` to include the `ScraperClass` constructor reference. This is a **breaking change to the registry type** — intentional and anticipated by the comment in `runner.ts`:
```
// F008+ will store the scraper constructor in the registry.
```

### 9.2 Updated `runner.ts`

```typescript
const entry = registry[chainSlug]
if (!entry) { /* error + exit 1 */ }

const scraper = new entry.ScraperClass(entry.config)
const result = await scraper.run()

console.log(JSON.stringify(result, null, 2))
process.exit(result.status === 'failed' ? 1 : 0)
```

---

## 10. File Structure

```
packages/scraper/src/
├── chains/
│   └── mcdonalds-es/
│       ├── McDonaldsEsScraper.ts        # Extends BaseScraper
│       ├── config.ts                    # Static ScraperConfig for mcdonalds-es
│       ├── jsonLdParser.ts              # parseJsonLd() helper
│       └── tableExtractor.ts            # extractNutritionTable() helper
├── lib/
│   └── prisma.ts                        # PrismaClient singleton (NEW — F008)
└── utils/
    └── persist.ts                       # persistDishUtil() (NEW — F008)

packages/scraper/src/__tests__/
├── mcdonalds-es.test.ts                 # Chain scraper unit tests
└── fixtures/
    └── mcdonalds-es/
        ├── product-page.html            # Fixture: single product page (with JSON-LD)
        ├── product-page-no-jsonld.html  # Fixture: product page with table only (no JSON-LD)
        ├── menu-page.html               # Fixture: menu index page with product cards
        └── product-blocked.html         # Fixture: 403/blocked response page
```

---

## 11. `McDonaldsEsScraper` Static Config

```typescript
// packages/scraper/src/chains/mcdonalds-es/config.ts

import { ScraperConfigSchema } from '../../base/types.js'

export const MCDONALDS_ES_CONFIG = ScraperConfigSchema.parse({
  chainSlug:    'mcdonalds-es',
  restaurantId: process.env['MCDONALDS_ES_RESTAURANT_ID']!,  // UUID — seeded or known
  sourceId:     process.env['MCDONALDS_ES_SOURCE_ID']!,       // UUID — DataSource row
  baseUrl:      'https://www.mcdonalds.com',
  startUrls:    ['https://www.mcdonalds.com/es/es-es/menu.html'],
  rateLimit: {
    requestsPerMinute: 8,   // Conservative — below default of 10 to be safe
    concurrency: 1,
  },
  retryPolicy: {
    maxRetries: 3,
    backoffMs: 2000,         // 2s initial back-off (longer than default for a real site)
    backoffMultiplier: 2,
  },
  selectors: {
    productList:   '.cmp-product-list__item a',
    productName:   'h1.cmp-product-details-main__heading',
    description:   '.cmp-product-details-main__description',
    servingSize:   '.cmp-nutrition-summary__serving',
    price:         '.cmp-product-details-main__price',
    nutritionTable:'.cmp-nutrition-summary__table tr',
    cookieConsent: '[data-testid="cookie-consent-accept"]',
    jsonLd:        'script[type="application/ld+json"]',
  },
  headless: true,
  locale:   'es-ES',
})
```

**Important**: `restaurantId` and `sourceId` are UUIDs of rows that must already exist in the DB. These are provided via environment variables at run time, NOT hardcoded. The seed script or a migration must create the corresponding `Restaurant` and `DataSource` rows before F008 runs.

### DB Seed Rows Required

A new seed/migration must insert:

**Restaurant row:**
```sql
INSERT INTO restaurants (id, name, name_es, chain_slug, website, country_code, is_active)
VALUES (
  gen_random_uuid(),
  'McDonald''s Spain',
  'McDonald''s España',
  'mcdonalds-es',
  'https://www.mcdonalds.com/es/es-es.html',
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
  'McDonald''s Spain Website Scraper',
  'scraper',
  'https://www.mcdonalds.com/es/es-es/menu.html',
  true
)
ON CONFLICT DO NOTHING;
```

The generated UUIDs from these rows must be set as `MCDONALDS_ES_RESTAURANT_ID` and `MCDONALDS_ES_SOURCE_ID` in the scraper's environment.

---

## 12. Error Handling Strategy

| Scenario | Where caught | Action |
|---|---|---|
| Cookie consent click fails | `extractDishes` try/catch | Silently continue — banner may not be present |
| Product name not found | `extractDishes` | Throw `ScraperStructureError` — caught by BaseScraper, logged in errors |
| JSON-LD parse error | `parseJsonLd` | Return `null`, fall back to table extractor |
| HTML table selector not found | `extractNutritionTable` | Return empty nutrients object — normalization will return null, dish skipped with warn |
| `normalizeNutrients` returns null | `BaseScraper.normalize()` | Increment `dishesSkipped`, log warn — BaseScraper handles this |
| Prisma transaction failure | `persistDish` | Rethrow — BaseScraper catches, increments `dishesSkipped`, logs error |
| Product list selector not found | `getMenuUrls` | Throw `ScraperStructureError` — caught by BaseScraper, aborts the run |
| HTTP 403 on any page | Crawlee `failedRequestHandler` | Recorded as `SCRAPER_BLOCKED_ERROR` in ScraperResult.errors |
| Page navigation timeout (>60s) | Crawlee timeout | Recorded in ScraperResult.errors, retry policy applies |

---

## 13. New Environment Variables

Add to `packages/scraper/src/config.ts`:

```typescript
export const ScraperEnvSchema = z.object({
  // ... existing fields ...
  MCDONALDS_ES_RESTAURANT_ID: z.string().uuid().optional(),
  MCDONALDS_ES_SOURCE_ID:     z.string().uuid().optional(),
})
```

These are `optional()` at the env schema level — validation that they are present happens at scraper startup inside `McDonaldsEsScraper.CONFIG` construction (the `!` non-null assertion throws at parse time if missing).

---

## 14. Testing Strategy

### 14.1 Test File: `packages/scraper/src/__tests__/mcdonalds-es.test.ts`

Test suite structure:

```
describe('McDonaldsEsScraper', () => {
  describe('getMenuUrls(page)', () => {
    it('extracts product URLs from the product list grid')
    it('deduplicates repeated URLs across category tabs')
    it('prepends baseUrl to relative hrefs')
    it('throws ScraperStructureError if product list selector not found')
  })

  describe('extractDishes(page) — JSON-LD path', () => {
    it('extracts all nutrient fields from JSON-LD NutritionInformation')
    it('sets name and nameEs from the product heading')
    it('extracts externalId from the URL slug')
    it('extracts optional portionGrams when serving size is present')
    it('extracts optional priceEur when price is present')
    it('returns empty array when product name is not found and catches the error')
  })

  describe('extractDishes(page) — table fallback path', () => {
    it('falls back to HTML table when JSON-LD is absent')
    it('maps Spanish label to correct nutrient key')
    it('handles missing optional nutrients gracefully')
  })

  describe('persistDish() — integration guard', () => {
    it('calls prisma.$transaction when given valid NormalizedDishData')
    it('uses findFirst + update path when dish with same externalId exists')
    it('uses findFirst + create path when dish does not exist')
    it('upserts DishNutrient on (dishId, sourceId)')
  })
})
```

### 14.2 Fixture Files

Fixtures are real HTML pages recorded from `mcdonalds.com/es/es-es/` at a point in time and committed to the repo. They are sanitized to remove session tokens and tracking scripts.

| Fixture | Content | Used by |
|---|---|---|
| `product-page.html` | Full product page for "McRoyal Deluxe" with JSON-LD | `extractDishes` JSON-LD path tests |
| `product-page-no-jsonld.html` | Product page with `<script type="application/ld+json">` tag removed | `extractDishes` table fallback tests |
| `menu-page.html` | Menu index with 30+ product card links in `.cmp-product-list__item` | `getMenuUrls` tests |
| `product-blocked.html` | A minimal page with "captcha" in body text | Blocked detection tests |

### 14.3 Mocking Strategy

- `persistDish()` is mocked in unit tests — tests do NOT hit a real database.
- `createCrawler()` is overridden using the DI pattern established in F007: `TestMcDonaldsScraper extends McDonaldsEsScraper` with `createCrawler` returning a duck-typed mock that drives the page handler with `page.setContent(fixture)`.
- `PrismaClient` in `persist.ts` tests is mocked with `vi.mock('@prisma/client')`.

### 14.4 Test for `persistDish` / `persist.ts`

Separate test file: `packages/scraper/src/__tests__/persist.test.ts`

This is a unit test, not an integration test. Uses `vi.mock('@prisma/client')` to mock `$transaction`, `dish.findFirst`, `dish.create`, `dish.update`, `dishNutrient.upsert`.

---

## 15. Acceptance Criteria

- [ ] `McDonaldsEsScraper` extends `BaseScraper` with `extractDishes` and `getMenuUrls` implemented
- [ ] `getMenuUrls` returns an array of absolute product URLs from the menu page fixture
- [ ] `extractDishes` extracts `name`, `nameEs`, `externalId`, and all disclosed nutrients from the JSON-LD fixture
- [ ] `extractDishes` falls back to HTML table when JSON-LD is absent
- [ ] All nutrient values pass through `normalizeNutrients` without error for the fixture data
- [ ] `persistDish` creates Dish + DishNutrient in a single `$transaction` when the dish is new
- [ ] `persistDish` updates Dish + upserts DishNutrient when a dish with the same `externalId` already exists
- [ ] `persistDish` falls back to name-based match when `externalId` is absent
- [ ] Registry updated: `registry['mcdonalds-es']` resolves to `{ config, ScraperClass: McDonaldsEsScraper }`
- [ ] `runner.ts` updated: instantiates and runs the chain scraper using the registry entry
- [ ] `ScraperEnvSchema` updated with `MCDONALDS_ES_RESTAURANT_ID` and `MCDONALDS_ES_SOURCE_ID`
- [ ] `packages/scraper/src/lib/prisma.ts` created with singleton `getPrismaClient()`
- [ ] `packages/scraper/src/utils/persist.ts` created and exported from `packages/scraper/src/index.ts`
- [ ] All 4 fixture HTML files committed to `src/__tests__/fixtures/mcdonalds-es/`
- [ ] All unit tests pass (`vitest run`) — no real network calls in tests
- [ ] `tsc --noEmit` passes in `packages/scraper`
- [ ] TypeScript strict mode — no `any`, no `ts-ignore`

---

## 16. Edge Cases

| Scenario | Expected Behaviour |
|---|---|
| Menu page has zero product links | `getMenuUrls` returns `[]`, `run()` returns `status: 'success'` with 0 dishes (empty is valid) |
| Product page has JSON-LD but calories is missing | Fall back to HTML table for calories only; merge partial results |
| Price format uses comma decimal ("5,49 €") | Coerce: `replace(',', '.')` before `parseFloat` — `coerceNutrient` handles this via strip non-numeric |
| Serving size is in format "210g" (no space) | `portionGrams` parsing must handle both "210 g" and "210g" |
| Sodium is provided in g not mg | Value would be coerced to ~0 salt; must ensure scraper always reads mg from McDonald's pages; warn log if value < 0.1 (suspiciously low) |
| Cookie consent banner blocks page content | Cookie consent click resolves before selector waits; 3-second timeout prevents hang |
| Same product URL appears in multiple category tabs | Set deduplication in `getMenuUrls` prevents double extraction |
| `externalId` (URL slug) differs between scraper runs due to URL change | Falls back to name-based match on second run — dish is updated, not duplicated |
| Dish with same name but different `restaurantId` | `findFirst` scopes by `restaurantId` — no cross-chain collision |
| DB connection lost mid-transaction | Prisma `$transaction` rolls back; `persistDish` re-throws; BaseScraper logs error and increments `dishesSkipped` |
| `MCDONALDS_ES_RESTAURANT_ID` not set | `ScraperConfigSchema.parse` throws at config instantiation time — process exits with descriptive message |

---

## 17. Patterns Established for F009–F017

F008 establishes these patterns that all subsequent chain scrapers must follow:

| Pattern | Where defined | Reuse by F009–F017 |
|---|---|---|
| File layout under `src/chains/<chain-slug>/` | §10 | Each chain gets its own directory |
| `static CONFIG` on the scraper class | §11 | Pass to registry, allows type-safe access without instantiation |
| JSON-LD first, HTML table fallback | §4.2 | Adapt as needed per chain — not all chains have JSON-LD |
| `nameEs = name` for Spanish-language chains | §4.2 | McDonald's Spain publishes in Spanish — same for BK, KFC .es chains |
| `persistDish` delegates to `persistDishUtil(getPrismaClient(), dish)` | §8.4 | All chain scrapers import and reuse `persist.ts` — no override needed |
| Registry shape: `{ config, ScraperClass }` | §9.1 | Same registry entry shape for all chains |
| Fixture files in `src/__tests__/fixtures/<chain>/` | §14.2 | Mandatory for every chain — no real network in tests |
| `MCDONALDS_ES_RESTAURANT_ID` env var pattern | §13 | Each chain adds its own `<CHAIN>_RESTAURANT_ID` and `<CHAIN>_SOURCE_ID` |

---

## 18. Out of Scope for F008

- Scraping images or logos
- Category-to-`DishCategory` FK mapping (Phase 2 — `DishCategory` junction table is not populated in Phase 1)
- Proxy rotation or fingerprint randomization
- Scheduling or cron orchestration
- Monitoring or alerting on scraper run results (F018)
- Embedding generation (F019)
- Any other chain scraper (F009–F017)
