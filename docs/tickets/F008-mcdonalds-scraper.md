# F008: McDonald's Spain Scraper

**Feature:** F008 | **Type:** Backend-Feature | **Priority:** High
**Status:** In Progress | **Branch:** feature/F008-mcdonalds-scraper
**Created:** 2026-03-13 | **Dependencies:** F007 complete (BaseScraper scaffold, normalization pipeline, registry stub)

---

## Spec

### Description

F008 implements the McDonald's Spain chain scraper (`mcdonalds-es`). It is the first concrete chain scraper, and it establishes the implementation pattern that F009–F017 will follow.

The scraper:
- Extends `BaseScraper` with `getMenuUrls(page)` (discovers all product URLs from the menu index) and `extractDishes(page)` (extracts nutritional data from individual product pages).
- Uses JSON-LD structured data (`NutritionInformation` schema) as the primary extraction source per product page, with HTML table fallback when JSON-LD is absent or incomplete.
- Overrides `persistDish()` with the **first real Prisma upsert implementation**, housed in a new shared utility `packages/scraper/src/utils/persist.ts` — reused by all F009–F017 chain scrapers.
- Registers `mcdonalds-es` in `src/registry.ts` with the updated registry type `{ config, ScraperClass }`.
- Updates `runner.ts` to instantiate and run the chain scraper class from the registry.
- Handles the McDonald's Spain SPA (React) via Playwright `waitForSelector` and cookie consent banner dismissal.

Full specification: `docs/specs/F008-mcdonalds-scraper-spec.md`

---

### Architecture Decisions

**JSON-LD first, HTML table fallback**

McDonald's product pages embed `NutritionInformation` JSON-LD structured data. This is more reliable than selector-based table parsing because it is semantically typed. The HTML table (`extractNutritionTable`) is retained as a fallback for pages where JSON-LD is absent or missing required fields. Both extraction paths produce a `Partial<RawDishData['nutrients']>` that is merged before normalization.

**`persist.ts` shared utility created in F008, reused by F009–F017**

The `persistDish()` override is not specific to McDonald's — all chain scrapers use the same upsert logic. Rather than reimplementing it in each subclass, F008 creates `packages/scraper/src/utils/persist.ts` with `persistDishUtil(prisma, dish)`. Chain scrapers call this from their `persistDish()` override. F009–F017 do not need to override `persistDish()` if they extend from a common base (see §8.4 of spec).

**Registry type breaking change**

The registry type is upgraded from `Record<string, ScraperConfig>` to `Record<string, { config: ScraperConfig; ScraperClass: typeof BaseScraper }>`. This is an anticipated change (commented in `runner.ts`) and does not affect any other existing code.

**`restaurantId` and `sourceId` via environment variables**

These UUIDs reference rows that must exist in the DB. They are not hardcoded — they are injected via `MCDONALDS_ES_RESTAURANT_ID` and `MCDONALDS_ES_SOURCE_ID` env vars. A seed script or manual SQL must create the `Restaurant` and `DataSource` rows before the scraper can run.

---

### File Structure

New files:

```
packages/scraper/src/
├── chains/
│   └── mcdonalds-es/
│       ├── McDonaldsEsScraper.ts        # Extends BaseScraper — getMenuUrls + extractDishes
│       ├── config.ts                    # MCDONALDS_ES_CONFIG static ScraperConfig
│       ├── jsonLdParser.ts              # parseJsonLd(raw) → Partial<nutrients> | null
│       └── tableExtractor.ts            # extractNutritionTable(page) → Partial<nutrients>
├── lib/
│   └── prisma.ts                        # PrismaClient singleton — getPrismaClient()
└── utils/
    └── persist.ts                       # persistDishUtil(prisma, dish) — shared upsert

packages/scraper/src/__tests__/
├── mcdonalds-es.test.ts                 # Chain scraper unit tests (fixture-based)
├── persist.test.ts                      # persist.ts unit tests (Prisma mocked)
└── fixtures/
    └── mcdonalds-es/
        ├── product-page.html            # Product page with JSON-LD
        ├── product-page-no-jsonld.html  # Product page — JSON-LD removed
        ├── menu-page.html               # Menu index with product card links
        └── product-blocked.html         # Blocked/captcha page
```

Modified files:

```
packages/scraper/src/
├── registry.ts          # Add 'mcdonalds-es' entry; update registry type
├── runner.ts            # Instantiate scraper class from registry entry
├── config.ts            # Add MCDONALDS_ES_RESTAURANT_ID, MCDONALDS_ES_SOURCE_ID env vars
└── index.ts             # Export persist.ts utilities
```

---

### Config Schema

`ScraperEnvSchema` additions in `packages/scraper/src/config.ts`:

```
MCDONALDS_ES_RESTAURANT_ID : z.string().uuid().optional()
MCDONALDS_ES_SOURCE_ID      : z.string().uuid().optional()
```

`ScraperConfig` for `mcdonalds-es`:

```
chainSlug     : 'mcdonalds-es'
baseUrl       : 'https://www.mcdonalds.com'
startUrls     : ['https://www.mcdonalds.com/es/es-es/menu.html']
rateLimit     : { requestsPerMinute: 8, concurrency: 1 }
retryPolicy   : { maxRetries: 3, backoffMs: 2000, backoffMultiplier: 2 }
locale        : 'es-ES'
selectors     : {
  productList:    '.cmp-product-list__item a',
  productName:    'h1.cmp-product-details-main__heading',
  description:    '.cmp-product-details-main__description',
  servingSize:    '.cmp-nutrition-summary__serving',
  price:          '.cmp-product-details-main__price',
  nutritionTable: '.cmp-nutrition-summary__table tr',
  cookieConsent:  '[data-testid="cookie-consent-accept"]',
  jsonLd:         'script[type="application/ld+json"]',
}
```

---

### Data Model Changes

No schema migration required. The existing `dishes` and `dish_nutrients` tables from F002 are sufficient. Two seed rows must be inserted before the scraper can run:

- `restaurants`: 1 row — McDonald's Spain (`chain_slug: 'mcdonalds-es'`, `country_code: 'ES'`)
- `data_sources`: 1 row — McDonald's Spain Website Scraper (`source_type: 'scraper'`)

These can be inserted via a new seed script `packages/api/prisma/seeds/restaurants.ts` or manually. The resulting UUIDs are set as env vars.

---

### Nutrient Field Mapping

McDonald's Spain discloses (from JSON-LD or HTML table, per serving):

| Page label | `RawDishData` field | Normalized to |
|---|---|---|
| Calorías / Valor energético | `calories` | kcal (direct) |
| Grasas totales | `fats` | g |
| Grasas saturadas | `saturatedFats` | g |
| Grasas trans | `transFats` | g |
| Hidratos de carbono | `carbohydrates` | g |
| Azúcares | `sugars` | g |
| Fibra alimentaria | `fiber` | g |
| Proteínas | `proteins` | g |
| Sodio | `sodium` | mg → `normalizeNutrients` derives `salt` |

Not disclosed (default to 0): `cholesterol`, `potassium`, `monounsaturatedFats`, `polyunsaturatedFats`.

---

### Error Handling

| Scenario | Behaviour |
|---|---|
| Product name heading not found | Throw `ScraperStructureError` — page recorded in `ScraperResult.errors` |
| JSON-LD absent | Fall back to HTML table with `warn` log |
| HTML table also absent | Return empty `RawDishData[]` — normalization skips the dish |
| `normalizeNutrients` returns null | BaseScraper increments `dishesSkipped`, logs warn |
| Prisma transaction fails | Re-throw from `persistDish` — BaseScraper increments `dishesSkipped`, logs error |
| HTTP 403 on any page | Crawlee `failedRequestHandler` records `SCRAPER_BLOCKED_ERROR` |
| `waitForSelector` timeout on menu page | Throw `ScraperStructureError('Product list selector not found')` |

---

### Persistence Strategy

Upsert algorithm in `utils/persist.ts` using `prisma.$transaction`:

1. `dish.findFirst` by `(restaurantId, externalId)` if `externalId` present, else by `(restaurantId, name)`.
2. `dish.create` (if not found) or `dish.update` (if found).
3. `dishNutrient.upsert` on unique constraint `(dishId, sourceId)` — always runs regardless of whether the dish was created or updated.

All three operations run in a single transaction. Last-write-wins for concurrent runs.

---

### Edge Cases

- Menu category tabs may repeat product links — `getMenuUrls` deduplicates via `Set`.
- Price uses Spanish comma decimal ("5,49 €") — `coerceNutrient` strips non-numeric characters including the comma-decimal, leaving "549" which parses incorrectly. The scraper's price extractor must use `replace(',', '.')` before `parseFloat`, separately from `coerceNutrient`.
- Sodium is in mg; salt is derived by `normalizeNutrients` — the scraper must pass `sodium` (not `salt`) to avoid double-conversion.
- `externalId` comes from the URL slug — if McDonald's changes URL structure between runs, the slug changes and a duplicate dish may be created (name-based match prevents this if name is stable).
- `MCDONALDS_ES_RESTAURANT_ID` missing at runtime: `ScraperConfigSchema.parse` will throw at class definition time, causing `runner.ts` to exit 1 with a parse error.

---

### Acceptance Criteria

- [x] `McDonaldsEsScraper` extends `BaseScraper`; TypeScript strict mode, no `any` — verified by `tsc --noEmit`
- [x] `getMenuUrls` extracts and deduplicates absolute product URLs from fixture `menu-page.html` — mcdonalds-es.test.ts
- [x] `extractDishes` extracts correct nutrients from fixture `product-page.html` (JSON-LD path) — mcdonalds-es.test.ts
- [x] `extractDishes` falls back to table for fixture `product-page-no-jsonld.html` — mcdonalds-es.test.ts
- [x] Extracted nutrients pass through `normalizeNutrients` without returning `null` — mcdonalds-es.test.ts
- [x] `persistDishUtil` creates Dish + DishNutrient in single `$transaction` for new dish — persist.test.ts
- [x] `persistDishUtil` updates Dish + upserts DishNutrient for existing dish (same `externalId`) — persist.test.ts
- [x] `persistDishUtil` uses name-based match when `externalId` is absent — persist.test.ts
- [x] Registry updated to `{ config, ScraperClass }` shape; `runner.ts` instantiates and runs — registry.ts, runner.ts
- [x] `ScraperEnvSchema` updated with `MCDONALDS_ES_RESTAURANT_ID` and `MCDONALDS_ES_SOURCE_ID` — config.ts
- [x] `packages/scraper/src/lib/prisma.ts` created (singleton with `disconnectPrisma()`)
- [x] `packages/scraper/src/utils/persist.ts` created and exported from `src/index.ts`
- [x] All 4 fixture HTML files committed under `src/__tests__/fixtures/mcdonalds-es/`
- [x] `vitest run` passes — 232 tests, zero real network calls
- [x] `tsc --noEmit` passes in `packages/scraper`

---

## Implementation Plan

### Existing Code to Reuse

**From `packages/scraper/src/base/`**
- `BaseScraper` — extend directly; `extractDishes(page)` and `getMenuUrls(page)` are the two abstract methods to implement. `persistDish(_normalized)` is the protected override point (currently throws `NotImplementedError`). `createCrawler()` is the protected DI hook used for test mocking.
- `types.ts` — `RawDishData`, `NormalizedDishData`, `ScraperConfig` / `ScraperConfigSchema`, `RawDishDataSchema` all reused as-is.
- `errors.ts` — `ScraperStructureError` (throw when selector absent), `ScraperBlockedError` (HTTP 403 / CAPTCHA detection).

**From `packages/scraper/src/utils/`**
- `normalize.ts` — `normalizeNutrients` and `normalizeDish` are called by `BaseScraper.normalize()` automatically; the chain scraper does not call them directly, but understanding their contract is essential for building correct `RawDishData`.
- `retry.ts` and `rateLimit.ts` — already wired into `BaseScraper.run()`; no direct use needed in `McDonaldsEsScraper`.

**From `packages/scraper/src/config.ts`**
- `ScraperEnvSchema` — add two new optional fields here; existing `parseConfig` / `config` singleton unchanged.

**Test infrastructure pattern from `BaseScraper.test.ts` and `f007.edge-cases.test.ts`**
- The `TestScraper extends BaseScraper` + mock `createCrawler()` pattern is the established way to unit-test chain scrapers without Playwright. `McDonaldsEsScraper` tests follow exactly this shape.
- `vi.spyOn(scraper as unknown as { persistDish: () => Promise<void> }, 'persistDish')` is the pattern for intercepting persistence in test.

**Key schema facts from `schema.prisma`**
- `Dish` has no `@@unique([restaurantId, name])` — confirms `findFirst` + conditional create/update is required (native `upsert` impossible).
- `DishNutrient` has `@@unique([dishId, sourceId])` — Prisma compound key name is `dishId_sourceId`; native `upsert` works.
- `DataSource.type` is a Prisma enum `DataSourceType` (`scraper` value must be confirmed in schema enums section).
- `Restaurant` has `@@unique([chainSlug, countryCode])` — seed insert must use this constraint for idempotency.

---

### Files to Create

```
packages/scraper/src/lib/
  prisma.ts                          PrismaClient singleton (getPrismaClient())

packages/scraper/src/utils/
  persist.ts                         persistDishUtil(prisma, dish) — shared upsert utility

packages/scraper/src/chains/mcdonalds-es/
  config.ts                          MCDONALDS_ES_CONFIG static ScraperConfig object
  jsonLdParser.ts                    parseJsonLd(raw) + isComplete(nutrition) helpers
  tableExtractor.ts                  extractNutritionTable(page) — HTML table fallback
  McDonaldsEsScraper.ts              Extends BaseScraper; implements getMenuUrls + extractDishes + persistDish override

packages/scraper/src/__tests__/
  persist.test.ts                    Unit tests for persistDishUtil (Prisma fully mocked)
  mcdonalds-es.test.ts               Unit tests for McDonaldsEsScraper (fixture-based, no network)

packages/scraper/src/__tests__/fixtures/mcdonalds-es/
  product-page.html                  Full product page with JSON-LD NutritionInformation
  product-page-no-jsonld.html        Same product page with JSON-LD block removed
  menu-page.html                     Menu index page with 5+ product card links
  product-blocked.html               Minimal page with "captcha" body text
```

---

### Files to Modify

```
packages/scraper/src/config.ts
  Add MCDONALDS_ES_RESTAURANT_ID: z.string().uuid().optional() and
  MCDONALDS_ES_SOURCE_ID: z.string().uuid().optional() to ScraperEnvSchema.
  Also add both to vitest.config.ts env block so tests can load config.ts without crashing.

packages/scraper/vitest.config.ts
  Add MCDONALDS_ES_RESTAURANT_ID and MCDONALDS_ES_SOURCE_ID stub UUIDs to the
  test env block — required because config.ts parses process.env at module load
  time and ScraperConfigSchema.parse() in config.ts will throw if env vars are
  absent when ScraperConfigSchema requires UUIDs. The chain config uses optional()
  so this only matters if the test environment triggers module evaluation.

packages/scraper/src/registry.ts
  Replace ScraperRegistry type from Record<string, ScraperConfig> to
  Record<string, { config: ScraperConfig; ScraperClass: typeof BaseScraper }>.
  Add import of McDonaldsEsScraper and register 'mcdonalds-es' entry.
  Also import BaseScraper for the type reference.

packages/scraper/src/runner.ts
  Replace the placeholder stub logic with: look up entry.ScraperClass from
  registry, instantiate with entry.config, call .run(), print result, exit.

packages/scraper/src/index.ts
  Add export of persist.ts: export * from './utils/persist.js'
```

---

### Implementation Order

Follow strict TDD: write tests first, then implement. Within each phase, keep the DDD layer order.

**Phase 1 — Infrastructure**

1. `packages/scraper/src/lib/prisma.ts`
   Create the PrismaClient singleton. Follow the pattern in `packages/api/src/lib/prisma.ts` but use a lazy-init getter (`getPrismaClient()`) instead of a direct export. Use `process.env['NODE_ENV'] === 'test'` to select `DATABASE_URL_TEST` over `DATABASE_URL`, mirroring the api pattern.

2. `packages/scraper/src/config.ts` (modify)
   Add `MCDONALDS_ES_RESTAURANT_ID` and `MCDONALDS_ES_SOURCE_ID` to `ScraperEnvSchema` as `z.string().uuid().optional()`. No change to `parseConfig` or the singleton.

3. `packages/scraper/vitest.config.ts` (modify)
   Add placeholder UUIDs for `MCDONALDS_ES_RESTAURANT_ID` and `MCDONALDS_ES_SOURCE_ID` to the `env` block so the scraper module loads cleanly in tests (e.g. `'00000000-0000-4000-a000-000000000099'`).

4. `packages/scraper/src/__tests__/persist.test.ts` (test first)
   Write unit tests for `persistDishUtil` before implementing `persist.ts`. Mock `@prisma/client` entirely with `vi.mock`. Cover:
   - New dish path: `findFirst` returns `null` → `dish.create` called, then `dishNutrient.upsert` called.
   - Existing dish by `externalId`: `findFirst` returns `{ id }` → `dish.update` called.
   - Existing dish by name (no `externalId`): `findFirst` uses name predicate → `dish.update` called.
   - `dishNutrient.upsert` receives correct `dishId_sourceId` where clause.
   - Transaction wrapper: all calls happen inside `prisma.$transaction`.
   - Prisma transaction failure: `persistDishUtil` re-throws.

5. `packages/scraper/src/utils/persist.ts` (implement)
   Implement `persistDishUtil(prisma, dish)` following the algorithm in spec §8.2. Use `Prisma.Decimal` for all numeric nutrient fields. The `nutrientFields` helper should be a private function in the same file. Export only `persistDishUtil`.

**Phase 2 — McDonald's Scraper**

6. `packages/scraper/src/__tests__/fixtures/mcdonalds-es/` (create fixtures — before tests)
   Create the four HTML fixture files. These are the test data foundation — must be committed before tests reference them. Guidelines per fixture:
   - `product-page.html`: must contain a `<script type="application/ld+json">` tag with a JSON object that includes `"@type": "NutritionInformation"` (directly or nested in a `Product` or `@graph`), plus `h1.cmp-product-details-main__heading`, `.cmp-nutrition-summary__serving`, `.cmp-product-details-main__price`, and `.cmp-breadcrumb a`. Use McRoyal Deluxe as the product name; values must be internally consistent (e.g. calories match macros roughly).
   - `product-page-no-jsonld.html`: copy of `product-page.html` with the JSON-LD `<script>` tag removed; must retain the `.cmp-nutrition-summary__table` HTML table with Spanish labels.
   - `menu-page.html`: must include at least 5 `<a href="/es/es-es/product/<slug>.html">` links inside `.cmp-product-list__item` wrappers, with at least one URL duplicated across categories.
   - `product-blocked.html`: minimal HTML with the word "captcha" in the body text.

7. `packages/scraper/src/chains/mcdonalds-es/jsonLdParser.ts` (test first — inline in mcdonalds-es.test.ts)
   Export `parseJsonLd(raw: string): Partial<RawDishData['nutrients']> | null` and `isComplete(nutrition: Partial<RawDishData['nutrients']> | null): boolean`. Test against the JSON-LD content extracted directly from `product-page.html` fixture (no Playwright needed for these tests — pure string parsing).

8. `packages/scraper/src/chains/mcdonalds-es/tableExtractor.ts`
   Export `extractNutritionTable(page: Page): Promise<Partial<RawDishData['nutrients']>>`. This function uses `page.$$` — it will be tested via a mock Page object that drives `.cmp-nutrition-summary__table tr` selector. In tests, supply a mock `page` whose `$$` method returns a fake row list.

9. `packages/scraper/src/chains/mcdonalds-es/config.ts`
   Export `MCDONALDS_ES_CONFIG` using `ScraperConfigSchema.parse(...)`. Both `restaurantId` and `sourceId` read from `process.env['MCDONALDS_ES_RESTAURANT_ID']!` and `process.env['MCDONALDS_ES_SOURCE_ID']!`. This means the config is evaluated at import time — the vitest env stubs from step 3 must be in place before this module is imported in tests.

10. `packages/scraper/src/__tests__/mcdonalds-es.test.ts` (test first)
    Write all scraper unit tests before implementing `McDonaldsEsScraper`. The test file imports `McDonaldsEsScraper` and uses the established `TestMcDonaldsScraper extends McDonaldsEsScraper` pattern with mock `createCrawler`. Tests drive `page.setContent(fixture)` via a mock page. Cover:
    - `getMenuUrls`: extracts product URLs from `menu-page.html` fixture, deduplicates, prepends baseUrl to relative hrefs, throws `ScraperStructureError` when selector absent.
    - `extractDishes` JSON-LD path: name, nameEs, externalId, all nine nutrient fields from `product-page.html`.
    - `extractDishes` table fallback: correct fallback when JSON-LD absent using `product-page-no-jsonld.html`.
    - Optional field extraction: `portionGrams` (strip unit, handle "210g" and "210 g"), `priceEur` (comma decimal: "5,49 €" → 5.49).
    - Missing optional fields: no error thrown when `.cmp-product-details-main__price` or `.cmp-nutrition-summary__serving` absent.
    - Error on missing product name: `ScraperStructureError` thrown.
    - `persistDish` override: spy on `persistDishUtil` import to verify it is called with `getPrismaClient()` and the normalized dish.

11. `packages/scraper/src/chains/mcdonalds-es/McDonaldsEsScraper.ts` (implement)
    Extend `BaseScraper`. Implement:
    - `static readonly CONFIG = MCDONALDS_ES_CONFIG` — static config on the class for registry use.
    - `constructor()` calls `super(McDonaldsEsScraper.CONFIG)`.
    - `getMenuUrls(page)` — await `waitForSelector`, collect hrefs, filter by product URL pattern, deduplicate with `Set`, prepend `this.config.baseUrl` to relative hrefs.
    - `extractDishes(page)` — cookie consent (try/catch), name extraction (throw on missing), externalId from URL slug, JSON-LD via `parseJsonLd`, fallback to `extractNutritionTable`, optional fields each in try/catch, compose `RawDishData`, return single-element array.
    - `protected override async persistDish(dish: NormalizedDishData): Promise<void>` calls `persistDishUtil(getPrismaClient(), dish)`.
    - No `any` types; strict TypeScript throughout.

**Phase 3 — Integration**

12. `packages/scraper/src/registry.ts` (modify)
    - Import `BaseScraper` type from `./base/BaseScraper.js`.
    - Replace `ScraperRegistry` type with `Record<string, { config: ScraperConfig; ScraperClass: typeof BaseScraper }>`.
    - Import `McDonaldsEsScraper` from `./chains/mcdonalds-es/McDonaldsEsScraper.js`.
    - Add `'mcdonalds-es': { config: McDonaldsEsScraper.CONFIG, ScraperClass: McDonaldsEsScraper }`.

13. `packages/scraper/src/runner.ts` (modify)
    Replace the F007 stub block with the real instantiation pattern:
    ```
    const entry = registry[chainSlug]
    const scraper = new entry.ScraperClass(entry.config)
    const result = await scraper.run()
    console.log(JSON.stringify(result, null, 2))
    process.exit(result.status === 'failed' ? 1 : 0)
    ```
    Keep the "no chain slug" list-and-exit logic unchanged.

14. `packages/scraper/src/index.ts` (modify)
    Add `export * from './utils/persist.js'` and `export * from './lib/prisma.js'` to the barrel.

15. Final check: `tsc --noEmit` in `packages/scraper`. Resolve any type errors before marking done.

---

### Testing Strategy

**Test files to create**

- `packages/scraper/src/__tests__/persist.test.ts` — pure unit test for `persistDishUtil`
- `packages/scraper/src/__tests__/mcdonalds-es.test.ts` — unit tests for `McDonaldsEsScraper`

**No integration tests in F008.** All persistence logic is tested with a fully mocked Prisma client. All extraction logic is tested against local HTML fixtures. Zero real network calls.

**persist.test.ts — key scenarios**

| Scenario | What to verify |
|---|---|
| New dish (no externalId match) | `findFirst` called with `{ restaurantId, name }` predicate; `dish.create` called once; `dishNutrient.upsert` called with `dishId_sourceId` |
| New dish by externalId | `findFirst` called with `{ restaurantId, externalId }` predicate |
| Existing dish (externalId match) | `findFirst` returns `{ id: 'existing-id' }` → `dish.update` called with `where: { id: 'existing-id' }` |
| All writes in one transaction | `prisma.$transaction` called once; `dish.*` and `dishNutrient.*` calls go through the `tx` proxy |
| Prisma error propagates | `tx.dish.create` rejects → `persistDishUtil` rejects with same error |

**Mocking strategy for persist.test.ts**

Use `vi.mock('@prisma/client')` at the top of the test file. Create a mock `$transaction` that calls the callback with a `tx` object containing mock implementations of `dish.findFirst`, `dish.create`, `dish.update`, and `dishNutrient.upsert`. Verify call arguments using `expect(mockFn).toHaveBeenCalledWith(...)`.

**mcdonalds-es.test.ts — key scenarios**

| Group | Scenario |
|---|---|
| `getMenuUrls` | Extracts 5+ URLs from fixture; deduplicates repeated slugs; prepends baseUrl; throws `ScraperStructureError` on missing selector |
| `extractDishes` JSON-LD | All 9 nutrient keys populated; `name === nameEs`; `externalId` matches URL slug |
| `extractDishes` table fallback | Called when JSON-LD absent; Spanish labels mapped correctly |
| Optional fields | `portionGrams` parses both "210 g" and "210g"; `priceEur` coerces "5,49 €" to 5.49 |
| Missing optional fields | Returns a dish without error when price/serving selectors absent |
| Missing name | Throws `ScraperStructureError` |
| Sodium-only nutrient | Passes `sodium` (not `salt`) so `normalizeNutrients` derives `salt` correctly |
| `persistDish` delegation | `persistDishUtil` is called with Prisma client and dish |

**Mocking strategy for mcdonalds-es.test.ts**

Extend `McDonaldsEsScraper` in the test file to override `createCrawler` using the same mock-crawler DI pattern established in `BaseScraper.test.ts`. The mock page object should implement `waitForSelector`, `$$eval`, `$eval`, `url()`, and `locator()` as `vi.fn()` stubs. Load fixture content by reading the HTML file with `fs.readFileSync` in `beforeAll` and set it on the mock page via a parsed DOM approach (use `{ window }` from `happy-dom` if available, or stub page methods to return pre-parsed values). Alternatively, use Playwright's `page.setContent()` with a real browser in a separate integration test (out of scope for F008 — keep unit tests fixture-only).

Mock `persistDishUtil` at the module level with `vi.mock('../utils/persist.js')` so `persistDish()` can be asserted without touching the DB.

---

### Key Patterns

**BaseScraper DI pattern (mock crawler in tests)**
Reference: `packages/scraper/src/__tests__/BaseScraper.test.ts` lines 78–125.
The mock crawler's `run(requests)` iterates the request array and calls `requestHandler` synchronously. `McDonaldsEsScraper` tests follow this exact shape — subclass inside the test file, override `createCrawler`.

**`persistDish` override point**
`BaseScraper.persistDish()` is `protected` — F008 overrides it. The override signature must match exactly: `protected override async persistDish(dish: NormalizedDishData): Promise<void>`. The `persist()` method (also protected) calls `persistDish()` — do not override `persist()`.

**Module-level config evaluation gotcha**
`MCDONALDS_ES_CONFIG` in `config.ts` calls `ScraperConfigSchema.parse(...)` at module import time. If `MCDONALDS_ES_RESTAURANT_ID` or `MCDONALDS_ES_SOURCE_ID` are absent from env, the parse will throw because `restaurantId` and `sourceId` are `z.string().uuid()` (non-optional in `ScraperConfigSchema`). The `!` assertion makes TypeScript happy but doesn't add runtime validation. The vitest env stubs in `vitest.config.ts` must provide valid-format UUIDs for these vars to prevent test suite crashes on import.

**Price coercion — do NOT use `coerceNutrient` for price**
`coerceNutrient` strips all non-numeric chars including `.`, which would correctly handle "5,49 €" only if the comma is stripped first. However, `coerceNutrient` is for nutrients (in `normalizeNutrients`). For `priceEur`, use `parseFloat(value.replace(',', '.').replace(/[^0-9.]/g, ''))` directly in `extractDishes` — keep price parsing separate from nutrient coercion.

**Sodium vs. salt**
Pass `sodium` (in mg, as found on the page) into `RawDishData.nutrients.sodium`. Do NOT set `salt` directly — `normalizeNutrients` derives `salt = (sodium / 1000) * 2.5` automatically when only sodium is present. Setting both would use the "both present" branch (both as-is), which is also correct if values are consistent, but cleaner to pass only sodium.

**`Prisma.Decimal` in `nutrientFields`**
The Prisma client generated for this project uses `Decimal` from `@prisma/client`. Import it as `import { Prisma } from '@prisma/client'` and use `new Prisma.Decimal(value)` for each nutrient column. All 14 nutrient columns in `DishNutrient` are `Decimal` type.

**`DataSource.type` enum**
The Prisma schema has `DataSourceType` enum for `data_sources.type`. When seeding the McDonald's DataSource row, the enum value must be `'scraper'` (check `packages/api/prisma/schema.prisma` enum section to confirm exact value). The scraper itself does not write to `data_sources` — it only reads the `sourceId` UUID from env.

**Registry type is a breaking change**
Changing `ScraperRegistry` from `Record<string, ScraperConfig>` to `Record<string, { config: ScraperConfig; ScraperClass: typeof BaseScraper }>` breaks any code that reads `registry[slug]` and expects a `ScraperConfig` directly. Currently only `runner.ts` reads the registry — update both files atomically in step 12/13.

**`typeof BaseScraper` vs. instantiating**
The registry stores the constructor reference as `ScraperClass: typeof BaseScraper`. The runner does `new entry.ScraperClass(entry.config)`. TypeScript will require the constructor parameter type to match `ScraperConfig` — this is satisfied because `McDonaldsEsScraper`'s constructor calls `super(config)` with the same type.

**`static readonly CONFIG` on `McDonaldsEsScraper`**
The registry references `McDonaldsEsScraper.CONFIG` (static access without instantiation). This requires `static readonly CONFIG = MCDONALDS_ES_CONFIG` on the class. The `typeof BaseScraper` type does not declare `CONFIG` — the registry entry uses `McDonaldsEsScraper.CONFIG` directly at registration time (not via the type), so no type augmentation is needed.

**Seed rows are out of scope for test execution**
The seed rows for `restaurants` and `data_sources` are required for the scraper to run live but are NOT needed for `vitest run`. Tests mock Prisma entirely. The seed approach (new seed script at `packages/api/prisma/seeds/restaurants.ts`) is mentioned in the spec as an out-of-scope concern for F008 — the developer should note this but does not need to implement it as part of F008.

**`isActive` column on Restaurant**
`Restaurant.isActive` defaults to `true` — no explicit value needed when inserting via seed. `Dish.availability` defaults to `available` in `normalizeDish` (already handled in `normalizeDish` from `normalize.ts`).

**`coerceNutrient` strips non-numeric chars including comma**
JSON-LD values like `"870 mg"` and `"19 g"` are passed as the `sodium` and `fats` strings into `RawDishData.nutrients`. `normalizeNutrients` calls `coerceNutrient` on each field, stripping everything except digits and `.`. This correctly produces `870` and `19`. No additional transformation needed in `jsonLdParser.ts` — return the raw strings as-is from JSON-LD.

---

## Definition of Done

- [x] All acceptance criteria met (15/15)
- [x] Unit tests written and passing (232 total in scraper package)
- [x] Code follows project standards
- [x] No linting errors (no lint script in scraper — tsc strict passes)
- [x] Build succeeds
- [x] Specs reflect final implementation

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` executed, plan approved
- [x] Step 3: `backend-developer` executed with TDD
- [x] Step 4: `production-code-validator` executed, quality gates pass
- [x] Step 5: `code-review-specialist` executed
- [x] Step 5: `qa-engineer` executed (Standard)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-13 | Step 0: Spec created | F008-mcdonalds-scraper-spec.md — dual extraction (JSON-LD + table), persist utility, registry pattern |
| 2026-03-13 | Step 1: Setup | Branch feature/F008-mcdonalds-scraper, ticket created, tracker updated |
| 2026-03-13 | Step 2: Plan approved | 15-step implementation plan across 3 phases |
| 2026-03-13 | Step 3: Implementation | 180 tests (39 F008 + 141 base/utils), TDD, commit f01a456 |
| 2026-03-13 | Step 4: Finalize | production-code-validator: READY, 0 issues |
| 2026-03-13 | Step 5: Review | code-review: 0C, 3H, 5M. QA: 5 bugs, 52 edge-case tests. All fixed in c95e0e2 |
| 2026-03-13 | Review findings | Accepted: H2 (sourceId update), H3 (extra conditional), M1 (URL strip), M3 (disconnectPrisma), M5 (CAPTCHA), B2/B3 (isComplete null/empty), B4 (price thousand-sep). Deferred: H1 (race condition, single-process today) |

---

## Notes

- Selectors in §11 of the spec are based on the current McDonald's Spain SPA (React-based, `cmp-` class prefix from Adobe Experience Manager). If the site migrates CMS, all `.cmp-*` selectors will need updating — this is the most likely breakage vector.
- McDonald's Spain does NOT publish cholesterol or potassium — these will always be 0 in the DB. This is expected and correct.
- The `nameEs = name` decision is sound because McDonald's Spain publishes their site entirely in Spanish. The product name on the page IS already the Spanish name.
- The seed rows for `restaurants` and `data_sources` should be added to a reusable seed script (not hardcoded SQL) so they can be reproduced in CI and staging environments.
- For local manual testing, run: `SCRAPER_CHAIN=mcdonalds-es MCDONALDS_ES_RESTAURANT_ID=<uuid> MCDONALDS_ES_SOURCE_ID=<uuid> npm run dev -w @foodxplorer/scraper`
