# F007 — Scraper Base: Crawlee + Playwright Scaffold

**Feature:** F007 | **Type:** Backend-Feature | **Priority:** High
**Status:** Pending | **Epic:** E002 — Data Ingestion Pipeline
**Created:** 2026-03-12 | **Dependencies:** E001 complete (F001–F006)

---

## 1. Purpose

F007 creates the scraper infrastructure that all 10 chain-specific scrapers (F008–F017) will extend. It is a pure scaffold — no chain-specific logic, no data is fetched from real websites. The goal is to define the abstractions, utilities, and data-flow conventions that make the subsequent chain scrapers mechanical implementations of a well-defined contract.

The scaffold must also be forward-compatible with two sibling ingestion paths that share the same normalization and persistence pipeline:

- **F007b** — PDF Ingestion Endpoint: raw text extracted from a PDF is normalized through the same pipeline as scraped HTML.
- **F007c** — URL Ingestion Endpoint: a URL is requested ad-hoc (not as part of a scheduled chain scrape) and processed through the same pipeline.

---

## 2. Monorepo Placement

### Decision: New package `packages/scraper`

The scraper scaffold is placed in a new npm workspace package `packages/scraper` (name: `@foodxplorer/scraper`), NOT inside `packages/api`.

**Rationale:**

- Crawlee and Playwright have large dependency footprints (browser binaries). Keeping them out of `packages/api` prevents the API Docker image from carrying browser dependencies in production.
- Scrapers run as separate, long-lived processes (cron jobs / one-shot CLI commands). They do not need to be co-located with the HTTP server.
- The scraper package communicates with the API via HTTP (internal POST requests to the ingestion endpoints introduced by F007b/F007c) or directly via a shared persistence service. See §6 for data-flow details.
- `packages/shared` types and Zod schemas are consumed by `packages/scraper` just as they are by `packages/api` — no changes to the shared package rule.

### Package identity

```
packages/scraper/
├── package.json          # name: "@foodxplorer/scraper"
├── tsconfig.json         # extends ../../tsconfig.base.json
├── vitest.config.ts
└── src/
```

---

## 3. File Structure

```
packages/scraper/src/
│
├── config.ts                          # ScraperEnvSchema (Zod) + typed ScraperConfig
│
├── base/
│   ├── BaseScraper.ts                 # Abstract base class — all chain scrapers extend this
│   ├── types.ts                       # All shared interfaces and Zod schemas for this package
│   └── errors.ts                      # Scraper-specific error classes
│
├── utils/
│   ├── retry.ts                       # withRetry() — exponential back-off utility
│   ├── rateLimit.ts                   # RateLimiter class — token-bucket, per-domain
│   ├── normalize.ts                   # normalizeNutrients(), normalizeDish()
│   └── http.ts                        # Internal API client (POST to /ingest/* endpoints)
│
├── runner.ts                          # CLI entry point: runs a named scraper once
│
└── __tests__/
    ├── BaseScraper.test.ts
    ├── retry.test.ts
    ├── rateLimit.test.ts
    └── normalize.test.ts
```

---

## 4. Key Interfaces and Zod Schemas

All scraper-internal types are defined in `packages/scraper/src/base/types.ts` as Zod schemas; TypeScript types are derived with `z.infer`. They are NOT added to `packages/shared` because they are scraper implementation concerns, not shared domain types consumed by the API or bot.

### 4.1 `RawDishData` — output of a chain scraper's page extraction

```
RawDishDataSchema = z.object({
  // Identity
  externalId    : z.string().max(100).optional()  // chain's own ID for the dish
  name          : z.string().min(1).max(255)        // as shown on the website
  nameEs        : z.string().min(1).max(255).optional()
  description   : z.string().optional()
  category      : z.string().optional()             // raw category label from site
  aliases       : z.array(z.string()).default([])

  // Pricing and portioning
  portionGrams  : z.number().positive().optional()
  priceEur      : z.number().nonnegative().optional()

  // Raw nutrient values — all in the unit reported by the chain
  // All nutrient fields are optional; absent means not disclosed by the chain
  nutrients: z.object({
    calories            : z.number().nonneg().optional()
    proteins            : z.number().nonneg().optional()
    carbohydrates       : z.number().nonneg().optional()
    sugars              : z.number().nonneg().optional()
    fats                : z.number().nonneg().optional()
    saturatedFats       : z.number().nonneg().optional()
    fiber               : z.number().nonneg().optional()
    salt                : z.number().nonneg().optional()
    sodium              : z.number().nonneg().optional()
    transFats           : z.number().nonneg().optional()
    cholesterol         : z.number().nonneg().optional()
    potassium           : z.number().nonneg().optional()
    monounsaturatedFats : z.number().nonneg().optional()
    polyunsaturatedFats : z.number().nonneg().optional()
    extra               : z.record(z.string(), z.number()).optional()
  })

  // Scraper metadata
  sourceUrl     : z.string().url()
  scrapedAt     : z.string().datetime()             // ISO 8601
})
```

### 4.2 `NormalizedDishData` — after normalization, ready for persistence

```
NormalizedDishDataSchema = z.object({
  // Dish fields matching CreateDishSchema from packages/shared
  name              : z.string().min(1).max(255)
  nameEs            : z.string().min(1).max(255).optional()
  description       : z.string().optional()
  externalId        : z.string().max(100).optional()
  availability      : DishAvailabilitySchema.default('available')
  portionGrams      : z.number().positive().optional()
  priceEur          : z.number().nonneg().optional()
  aliases           : z.array(z.string()).default([])

  // Nutrient fields matching CreateDishNutrientSchema from packages/shared
  // All values in grams (or kcal for calories); all non-negative
  // Required: calories, proteins, carbohydrates, fats — minimum viable nutrition data
  nutrients: z.object({
    calories            : z.number().nonneg()
    proteins            : z.number().nonneg()
    carbohydrates       : z.number().nonneg()
    sugars              : z.number().nonneg()
    fats                : z.number().nonneg()
    saturatedFats       : z.number().nonneg()
    fiber               : z.number().nonneg()
    salt                : z.number().nonneg()
    sodium              : z.number().nonneg()
    transFats           : z.number().nonneg().default(0)
    cholesterol         : z.number().nonneg().default(0)
    potassium           : z.number().nonneg().default(0)
    monounsaturatedFats : z.number().nonneg().default(0)
    polyunsaturatedFats : z.number().nonneg().default(0)
    referenceBasis      : NutrientReferenceBasisSchema.default('per_serving')
    extra               : z.record(z.string(), z.number()).optional()
  })

  // Persistence metadata
  confidenceLevel   : ConfidenceLevelSchema
  estimationMethod  : EstimationMethodSchema  // always 'scraped' for web scrapers
  sourceId          : z.string().uuid()        // DataSource row ID for this chain
  restaurantId      : z.string().uuid()        // Restaurant row ID for this chain
})
```

### 4.3 `ScraperConfig` — per-chain configuration

```
ScraperConfigSchema = z.object({
  chainSlug       : z.string().min(1).max(100)  // matches Restaurant.chainSlug
  restaurantId    : z.string().uuid()            // DB ID of the Restaurant row
  sourceId        : z.string().uuid()            // DB ID of the DataSource row
  baseUrl         : z.string().url()             // e.g. "https://www.mcdonalds.es"
  startUrls       : z.array(z.string().url()).min(1)  // entry points for the crawler
  rateLimit: z.object({
    requestsPerMinute : z.number().int().min(1).max(60).default(10)
    concurrency       : z.number().int().min(1).max(5).default(1)
  })
  retryPolicy: z.object({
    maxRetries        : z.number().int().min(0).max(5).default(3)
    backoffMs         : z.number().int().min(100).default(1000)   // initial back-off
    backoffMultiplier : z.number().min(1).max(5).default(2)
  })
  selectors       : z.record(z.string(), z.string())
    // Chain-specific CSS or ARIA selectors, keyed by semantic name
    // e.g. { "dishName": "h1.product-title", "calories": "[data-nutrient='energy']" }
  headless        : z.boolean().default(true)
  locale          : z.string().default('es-ES')
    // Browser locale to send — important for .es domains that may serve different
    // content to non-Spanish locales
})
```

### 4.4 `ScraperResult` — summary returned after a full scraper run

```
ScraperResultSchema = z.object({
  chainSlug       : z.string()
  startedAt       : z.string().datetime()
  finishedAt      : z.string().datetime()
  pagesVisited    : z.number().int().nonneg()
  dishesFound     : z.number().int().nonneg()
  dishesUpserted  : z.number().int().nonneg()
  dishesSkipped   : z.number().int().nonneg()   // failed normalization or validation
  errors          : z.array(z.object({
    url     : z.string(),
    message : z.string(),
    code    : z.string(),
  }))
  status          : z.enum(['success', 'partial', 'failed'])
    // 'success'  — all dishes processed
    // 'partial'  — some pages or dishes failed (dishesSkipped > 0 but dishesUpserted > 0)
    // 'failed'   — crawler could not extract any dishes (dishesUpserted === 0)
})
```

---

## 5. Base Scraper Class Contract

`BaseScraper` is an abstract class in `packages/scraper/src/base/BaseScraper.ts`. Chain scrapers extend it and implement two abstract methods. All shared logic (crawler lifecycle, retry, rate limiting, normalization, persistence) lives in the base class.

### Abstract methods (chain scrapers must implement)

```
abstract extractDishes(page: Page): Promise<RawDishData[]>
  // Receives a Playwright Page object already navigated to a menu/product URL.
  // Returns raw dish data as found on the page — no normalization yet.
  // Must NOT throw for individual dish failures; instead return what can be extracted.
  // May return an empty array if no dishes are found on this page.

abstract getMenuUrls(page: Page): Promise<string[]>
  // Receives a Playwright Page object navigated to one of the startUrls.
  // Returns the list of menu/product URLs to crawl.
  // Used by the base class crawler to build the URL queue.
```

### Concrete methods provided by BaseScraper

```
run(): Promise<ScraperResult>
  // Orchestrates the full scrape lifecycle:
  //   1. Launch Crawlee PlaywrightCrawler with config.rateLimit settings
  //   2. Navigate to each startUrl and call getMenuUrls()
  //   3. For each menu URL: navigate, call extractDishes(), normalize, validate, persist
  //   4. Collect errors, count results, return ScraperResult

protected normalize(raw: RawDishData): NormalizedDishData | null
  // Calls normalizeNutrients() and normalizeDish() from utils/normalize.ts
  // Returns null if the raw data cannot be normalized to a valid NormalizedDishData
  // (e.g. missing mandatory nutrient fields). Logs a warning with the dish name and reason.

protected persist(normalized: NormalizedDishData): Promise<void>
  // Calls the internal persistence layer (see §6).
  // On failure: logs the error, increments dishesSkipped counter — does NOT re-throw.
```

### Constructor signature

```
constructor(config: ScraperConfig)
```

The constructor receives the full `ScraperConfig` for the chain. Chain scrapers pass their own static config object to `super(config)`.

---

## 6. Data Flow: Scrape → Normalize → Validate → Persist

```
[Chain Scraper]
     │
     │  extractDishes(page) → RawDishData[]
     │
     ▼
[BaseScraper.normalize()]
     │
     │  RawDishData → NormalizedDishData (or null → skip)
     │  • Unit conversion (salt ↔ sodium: salt_g = sodium_mg / 1000 * 2.5)
     │  • Missing nutrient defaults (0 for optional nutrient columns)
     │  • referenceBasis defaults to 'per_serving'
     │  • confidenceLevel assignment (always 'medium' for scraped data)
     │  • estimationMethod set to 'scraped'
     │
     ▼
[Zod validation — NormalizedDishDataSchema.safeParse()]
     │
     │  Invalid → log warning + increment dishesSkipped
     │  Valid   → proceed
     │
     ▼
[Persistence Layer — utils/http.ts OR direct DB]
     │
     │  Option A (preferred for F007–F017):
     │  Direct Prisma upsert via shared persistence service
     │  — packages/scraper has its own PrismaClient instance
     │  — Upsert on (restaurantId, externalId) if externalId present,
     │    otherwise upsert on (restaurantId, name) normalized
     │
     │  Option B (for F007b / F007c endpoints):
     │  POST to internal API endpoint (when triggered via HTTP)
     │  — Used only when the ingest pipeline is invoked through the API
     │
     ▼
[PostgreSQL — dishes + dish_nutrients tables]
```

### Persistence strategy (Option A detail)

The scraper package accesses Prisma directly via its own `PrismaClient` instance (same as `packages/api` does in `packages/api/src/lib/prisma.ts`). The scraper is a separate process, so sharing a Prisma singleton across packages is not a concern.

The persistence logic is in `packages/scraper/src/utils/persist.ts` (NOT created in F007 — this utility is specified here for planning but implemented when the first chain scraper (F008) needs it to be real).

**Upsert logic (to be implemented by F008, specified here for context):**

```
For each NormalizedDishData:
  1. UPSERT dish on (restaurant_id, external_id) WHERE external_id IS NOT NULL
     OR on (restaurant_id, lower(name)) WHERE external_id IS NULL
  2. If dish created: INSERT dish_nutrients with sourceId + current values
  3. If dish updated AND nutrient values differ: UPDATE dish_nutrients
  4. All writes in a single Prisma transaction
```

**F007 only provides the scaffold** — `persist()` in the base class calls a stub `persistDish(normalized: NormalizedDishData): Promise<void>` that is declared but not implemented (throws `NotImplementedError`). F008 will implement it.

---

## 7. Normalization Rules

Defined in `packages/scraper/src/utils/normalize.ts`. These are pure functions — no I/O, no Prisma, fully unit-testable.

### 7.1 `normalizeNutrients(raw: RawDishData['nutrients']): NormalizedDishData['nutrients'] | null`

| Rule | Detail |
|---|---|
| Required fields | `calories`, `proteins`, `carbohydrates`, `fats` must be present and non-negative. If any is absent, return `null` (dish skipped). |
| `sugars` absent | Default to `0` with a warning log. |
| `fats` absent but `saturatedFats` present | Return `null` — cannot compute total fat. |
| `salt` / `sodium` mutual derivation | If only `sodium_mg` present: `salt_g = sodium_mg / 1000 * 2.5`. If only `salt_g` present: `sodium_mg = salt_g / 2.5 * 1000`. Both present: use as-is. Both absent: default both to `0`. |
| Optional nutrient columns | Default to `0` per `CreateDishNutrientSchema` pattern. |
| `referenceBasis` | Always `'per_serving'` for scraped restaurant data (per ADR-004). |
| Negative values | Clamp to `0` with a warning log. Never return negative nutrients. |
| Calorie sanity check | `calories > 9000` → log error, return `null` (per DB CHECK constraint). |
| `extra` passthrough | Any unrecognised nutrients from the chain are stored in `extra` as-is. |

### 7.2 `normalizeDish(raw: RawDishData, meta: { sourceId, restaurantId }): Partial<NormalizedDishData>`

| Rule | Detail |
|---|---|
| `name` | Trim whitespace. Collapse multiple spaces. |
| `nameEs` | If absent and `name` appears to be Spanish (heuristic: contains Spanish diacritics or is from a .es domain), set `nameEs = name`. |
| `externalId` | Trim, truncate to 100 chars. |
| `confidenceLevel` | Always `'medium'` for scraped data. |
| `estimationMethod` | Always `'scraped'`. |
| `aliases` | Deduplicate, trim each entry. |
| `availability` | Always `'available'` unless the chain's extractor explicitly signals otherwise. |

---

## 8. Retry Logic

Defined in `packages/scraper/src/utils/retry.ts`.

```
withRetry<T>(
  fn: () => Promise<T>,
  policy: { maxRetries: number; backoffMs: number; backoffMultiplier: number },
  context: string   // descriptive label for logging ("McDonald's: product page")
): Promise<T>
```

- Retries only on transient errors: network timeouts, HTTP 429, HTTP 503.
- Does NOT retry on: HTTP 404 (page gone — log and skip), HTTP 403 (likely blocked — log and abort chain), page navigation errors that suggest site structure change.
- Back-off is exponential: `backoffMs * (backoffMultiplier ^ attempt)`, capped at 30 000 ms.
- All retry attempts are logged at `warn` level with the attempt number, error message, and `context` label.
- After exhausting retries, throws `ScraperNetworkError` (see §9).

---

## 9. Error Classes

Defined in `packages/scraper/src/base/errors.ts`.

| Class | Extends | When thrown |
|---|---|---|
| `ScraperError` | `Error` | Base class — not thrown directly |
| `ScraperNetworkError` | `ScraperError` | Network failure after all retries exhausted |
| `ScraperBlockedError` | `ScraperError` | HTTP 403 / CAPTCHA detected |
| `ScraperStructureError` | `ScraperError` | Page structure has changed — expected selector not found |
| `NormalizationError` | `ScraperError` | Data cannot be normalized (missing required fields) |
| `NotImplementedError` | `ScraperError` | Abstract method called without implementation (stub guard) |

All error classes carry a `code: string` property matching the class name (e.g. `'SCRAPER_NETWORK_ERROR'`). This feeds into `ScraperResult.errors[].code`.

---

## 10. Rate Limiting

Defined in `packages/scraper/src/utils/rateLimit.ts`.

`RateLimiter` is a simple token-bucket implementation operating at the `BaseScraper` level. It is injected into the Crawlee crawler via the `maxRequestsPerMinute` and `maxConcurrency` options from `ScraperConfig.rateLimit`.

Crawlee's built-in autoscaling is DISABLED for all chain scrapers (set `autoscaledPoolOptions.isFinishedFunction` explicitly). Scrapers run with predictable, conservative concurrency to avoid triggering anti-bot measures.

**Default limits (overridable per chain in `ScraperConfig`):**

| Setting | Default | Rationale |
|---|---|---|
| `requestsPerMinute` | 10 | Conservative — prevents rate-ban from chain sites |
| `concurrency` | 1 | Sequential by default — easier to debug, lower risk |
| Min delay between requests | 3 000 ms | Jitter: `baseDelay + Math.random() * 2000` |

---

## 11. Configuration

### 11.1 Environment variables — `packages/scraper/src/config.ts`

```
ScraperEnvSchema = z.object({
  NODE_ENV         : z.enum(["development", "test", "production"]).default("development")
  DATABASE_URL     : z.string().url()
  DATABASE_URL_TEST: z.string().url().optional()
  LOG_LEVEL        : z.enum(["fatal","error","warn","info","debug","trace"]).default("info")
  SCRAPER_HEADLESS : z.coerce.boolean().default(true)
    // Override to false for local debugging (shows browser window)
  SCRAPER_CHAIN    : z.string().optional()
    // When set, runner.ts only runs the named chain scraper
})
```

Parsed at startup with the same `parseConfig` pattern as `packages/api/src/config.ts`.

### 11.2 Chain registry

`packages/scraper/src/registry.ts` exports a static map from `chainSlug` to the chain-specific `ScraperConfig` object. F007 ships the registry file with a placeholder entry (empty map or a single commented-out example). F008–F017 each add their entry.

```
// Type of the registry
type ScraperRegistry = Record<string, ScraperConfig>
```

---

## 12. Crawlee + Playwright Integration

### Library choices

| Library | Version constraint | Reason |
|---|---|---|
| `crawlee` | `^3.x` | Provides `PlaywrightCrawler` with built-in request queue, retry, anti-bot utilities |
| `playwright` | Crawlee peer dep (auto-installed) | Browser automation |

`crawlee` is installed as a runtime dependency of `packages/scraper`. It is NOT added to `packages/api`.

### PlaywrightCrawler configuration in BaseScraper

```
PlaywrightCrawler({
  launchContext: {
    launchOptions: {
      headless: config.headless,
      locale  : config.locale,
    }
  },
  maxRequestsPerMinute: config.rateLimit.requestsPerMinute,
  maxConcurrency      : config.rateLimit.concurrency,
  requestHandlerTimeoutSecs: 60,
  // Disable autoscaling — predictable rate is more important than throughput
  autoscaledPoolOptions: {
    minConcurrency: config.rateLimit.concurrency,
    maxConcurrency: config.rateLimit.concurrency,
  },
  requestHandler: async ({ page, request }) => {
    // BaseScraper internal handler:
    // 1. Determine if this is a start URL (call getMenuUrls) or a menu URL (call extractDishes)
    // 2. Apply withRetry wrapper around extractDishes
    // 3. Call normalize() and persist() for each dish
  },
  failedRequestHandler: async ({ request, error }) => {
    // Record error in ScraperResult.errors
  },
})
```

### Anti-bot considerations (scaffold-level)

The scaffold sets these Playwright defaults — chain scrapers can override via `ScraperConfig.selectors` and constructor options:

- `userAgent`: A realistic desktop Chrome user-agent string (not Playwright default).
- `viewport`: `{ width: 1280, height: 800 }`.
- `locale`: From `config.locale` (default `'es-ES'`).
- `extraHTTPHeaders`: `{ 'Accept-Language': 'es-ES,es;q=0.9' }`.

No fingerprint randomization or proxy rotation in F007 — these are V2 concerns.

---

## 13. Testing Strategy

Scrapers must be testable without hitting real websites. The test boundary is clear: tests operate on the `extractDishes()` and `getMenuUrls()` methods in isolation, with pre-recorded page content.

### 13.1 What F007 tests

F007 tests only the scaffold abstractions — not any real website interaction.

| Test file | Type | What it covers |
|---|---|---|
| `BaseScraper.test.ts` | Unit | `run()` orchestration logic with mock `extractDishes` / `getMenuUrls`, result counting, error accumulation |
| `retry.test.ts` | Unit | `withRetry` — success on first try, retry on transient errors, exhaust retries, no retry on 404/403 |
| `rateLimit.test.ts` | Unit | `RateLimiter` — token issuance, request throttling, jitter |
| `normalize.test.ts` | Unit | `normalizeNutrients` — all rules from §7; `normalizeDish` — trimming, clamping, defaults |

### 13.2 Testing pattern for chain scrapers (F008–F017)

Specified here so F008–F017 follow a consistent pattern — NOT implemented by F007.

Each chain scraper test (`packages/scraper/src/__tests__/<chain>.test.ts`) should:

1. Load a **fixture HTML file** (stored in `packages/scraper/src/__tests__/fixtures/<chain>/`) recorded from the real site at a point in time.
2. Use Playwright's `page.setContent(fixture)` to inject the HTML into a browser page without making a network request.
3. Call `extractDishes(page)` directly on the chain scraper instance.
4. Assert the returned `RawDishData[]` matches a fixture snapshot.

This means:
- No network calls in tests.
- Fixtures are committed to the repo.
- When a site changes layout, the fixture is updated and tests fail loudly (`ScraperStructureError`), alerting the team.

### 13.3 Mocking strategy for BaseScraper tests

- Do NOT mock Crawlee internals. Instead, create a `TestScraper extends BaseScraper` concrete class in the test file that implements `extractDishes` and `getMenuUrls` with controlled outputs.
- Mock `persist()` method (the stub anyway) to avoid needing a database in unit tests.
- Use `vi.useFakeTimers()` for retry back-off tests to avoid real `setTimeout` delays.

---

## 14. npm Scripts

New scripts in `packages/scraper/package.json`:

| Script | Command | Notes |
|---|---|---|
| `dev` | `tsx src/runner.ts` | Run the scraper CLI once |
| `typecheck` | `tsc --noEmit` | TypeScript validation |
| `test` | `vitest run` | Run unit tests |
| `test:watch` | `vitest` | Watch mode for TDD |

Root-level convenience scripts to add to root `package.json`:

| Script | Command |
|---|---|
| `scraper:run` | `npm run dev -w @foodxplorer/scraper` |

---

## 15. New Dependencies

### `packages/scraper/package.json`

| Package | Type | Version | Reason |
|---|---|---|---|
| `crawlee` | runtime | `^3.x` | PlaywrightCrawler, request queue, retry internals |
| `playwright` | runtime | peer of crawlee | Browser automation |
| `@foodxplorer/shared` | runtime | `*` | Shared Zod schemas and TypeScript types |
| `@prisma/client` | runtime | `^6.4.1` | Direct DB writes (same version as api package) |
| `zod` | runtime | `^3.24.2` | Schema validation |
| `@types/node` | devDep | `^22.x` | Node.js types |
| `tsx` | devDep | `^4.x` | TypeScript execution for dev/CLI |
| `typescript` | devDep | `^5.7.3` | Compiler |
| `vitest` | devDep | `^3.x` | Tests |

**Playwright browsers** are installed separately via `npx playwright install chromium`. Only Chromium is required (not Firefox/WebKit) to minimize CI image size.

---

## 16. Edge Cases

| Scenario | Expected behaviour |
|---|---|
| Chain website returns 403 on first request | Throw `ScraperBlockedError`, abort the run, status `'failed'`, log at `error` level |
| Chain website returns CAPTCHA page (HTML contains "captcha") | Detect via response body heuristic, throw `ScraperBlockedError` |
| `extractDishes()` returns empty array for a menu page | Log at `warn` level with URL, increment `pagesVisited`, continue to next URL |
| `extractDishes()` throws an exception for one page | Catch, record in `ScraperResult.errors`, continue to next page |
| All pages scraped but 0 dishes extracted | `status: 'failed'`, log at `error` level |
| Normalization returns `null` for a dish | Increment `dishesSkipped`, log at `warn` with dish name and failure reason |
| Nutrient value is a string (e.g. `"<1"`) | Normalization coerces: strip non-numeric characters, parse as float. `"<1"` → `0.5`. `"tr"` (trace) → `0`. Invalid → `0` with `warn` log. |
| `externalId` is not present on the chain's page | Upsert falls back to normalized `name` match — scraper still functions |
| Two dishes have the same name on the same chain | Both are upserted. Second write updates the first (last-write-wins). This is acceptable for Phase 1. |
| `DATABASE_URL` missing from scraper env | Process exits at startup with descriptive message (same pattern as `packages/api`) |
| Playwright browser crashes mid-run | Crawlee re-launches browser automatically. If it fails three times, `failedRequestHandler` records the error. |
| Site takes >60s to respond | `requestHandlerTimeoutSecs: 60` causes Crawlee to mark the request as failed. Retry policy applies. |
| `ScraperConfig.startUrls` is empty | Validation catches this at startup (Zod `min(1)`) — process exits with validation message |

---

## 17. Forward Compatibility with F007b and F007c

F007b (PDF ingestion) and F007c (URL ingestion) will expose Fastify endpoints in `packages/api`. These endpoints receive external data, extract raw dish/nutrient information via different means (PDF parser, ad-hoc Playwright), and then need to normalize and persist it.

The scaffold anticipates this by keeping the normalization utilities (`normalize.ts`) as pure functions that take `RawDishData` as input. F007b and F007c will:

1. Extract data into `RawDishData` shape (from their respective sources).
2. Call the same `normalizeNutrients()` and `normalizeDish()` functions.
3. Call the same persistence logic.

**No API endpoints are defined in F007.** F007b and F007c will each have their own spec and ticket. F007 only ensures the normalization contract is in place for them to reuse.

The `RawDishDataSchema` and `NormalizedDishDataSchema` defined in §4 are the integration contract between F007 and F007b/F007c. If these schemas need to move to `packages/shared` when F007b is built (because the API handler in `packages/api` needs them), that migration should be decided in the F007b spec.

---

## 18. Out of Scope for F007

- Individual chain extractors (`extractDishes` implementations) → F008–F017
- `persist()` implementation → F008 (when first chain scraper needs real writes)
- PDF text extraction → F007b
- Ad-hoc URL ingestion endpoint → F007c
- Proxy rotation or fingerprint randomization → future
- Scheduling / cron orchestration → future
- Admin UI for scraper status → future
- Data Quality Monitor → F018
- Embedding generation → F019

---

## 19. Acceptance Criteria for F007

- [ ] `packages/scraper` package created with valid `package.json`, `tsconfig.json`, `vitest.config.ts`
- [ ] `BaseScraper` abstract class compiles with TypeScript strict mode
- [ ] `BaseScraper.run()` returns a valid `ScraperResult` when `extractDishes` returns empty arrays (stub test)
- [ ] `withRetry` retries on transient errors and does not retry on 403/404
- [ ] `normalizeNutrients` correctly applies all rules in §7.1 (unit tests cover all branches)
- [ ] `normalizeDish` correctly trims, defaults, and assigns `confidenceLevel`/`estimationMethod`
- [ ] `RateLimiter` enforces the `requestsPerMinute` ceiling
- [ ] All Zod schemas parse valid inputs and reject invalid inputs (unit tests)
- [ ] `tsc --noEmit` passes with zero errors in `packages/scraper`
- [ ] `vitest run` passes — all unit tests green
- [ ] `packages/api` and `packages/shared` builds are unaffected (no cross-package regressions)
- [ ] TypeScript strict mode — no `any`, no `ts-ignore`
- [ ] `BaseScraper` is documented with JSDoc comments on all public and abstract methods

---

## 20. Open Questions for Review

1. **Persistence path**: Should chain scrapers (F008–F017) write directly to Postgres via Prisma, or should they POST to an internal `packages/api` endpoint? Direct Prisma is simpler for F007–F017 but couples the scraper to DB credentials. An internal API endpoint adds HTTP overhead but is a cleaner service boundary. **Recommendation: direct Prisma for Phase 1** (as specified in §6 Option A). Revisit if the scraper is deployed separately from the API.

2. **`packages/scraper` location**: Is a new workspace package the right call, or should scraper code live under `packages/api/src/scraper/`? The spec recommends a new package (§2). If the team prefers to avoid workspace proliferation at this stage, the alternative is a `packages/api/src/scraper/` sub-directory with a clear no-import rule from HTTP route handlers.

3. **Crawlee storage**: By default, Crawlee persists the request queue and key-value store to the local filesystem (`./storage/`). For a scheduled cron job, this is fine. For a container deployment, the storage directory should be ephemeral or a named volume. The spec does not address deployment — this should be decided before F018.
