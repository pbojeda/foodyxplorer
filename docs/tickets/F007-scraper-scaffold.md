# F007: Scraper Base — Crawlee + Playwright Scaffold

**Feature:** F007 | **Type:** Backend-Feature | **Priority:** High
**Status:** Done | **Branch:** feature/F007-scraper-scaffold (deleted)
**Created:** 2026-03-12 | **Dependencies:** E001 complete (F001–F006)

---

## Spec

### Description

F007 creates the scraper infrastructure that all 10 chain-specific scrapers (F008–F017) will extend. It is a pure scaffold — no chain scrapes real websites during this feature. The output is a new npm workspace package `packages/scraper` (`@foodxplorer/scraper`) containing:

- An abstract `BaseScraper` class that chain scrapers extend
- Zod schemas for the scraper data pipeline (`RawDishData`, `NormalizedDishData`, `ScraperConfig`, `ScraperResult`)
- Utility functions: retry with exponential back-off, rate limiter, data normalization
- Crawlee + Playwright integration wired into `BaseScraper.run()`
- A CLI runner for triggering a named scraper
- Unit tests for all utilities and the base class orchestration logic

The scaffold must be forward-compatible with F007b (PDF ingestion) and F007c (URL ingestion), which will reuse the same normalization utilities (`normalizeNutrients`, `normalizeDish`) from different ingestion paths.

Full specification: `docs/specs/F007-scraper-scaffold-spec.md`

---

### Architecture Decisions

**New workspace package, not a sub-directory of `packages/api`**

`packages/scraper` is a new npm workspace (`@foodxplorer/scraper`). Crawlee and Playwright carry large dependency footprints (browser binaries). Keeping them out of `packages/api` ensures the API Docker image remains lean. Scrapers run as separate, long-lived CLI processes, not as HTTP handlers.

**Direct Prisma writes (Phase 1)**

Chain scrapers write to Postgres directly via their own `PrismaClient` instance. An internal API endpoint (Option B) adds HTTP overhead with no benefit at Phase 1 scale. This decision is revisited before Phase 2 if the scraper is deployed in a separate container.

**`RawDishData` → `NormalizedDishData` as the core pipeline contract**

The separation between raw extraction (chain-specific, untrusted) and normalized data (schema-validated, DB-ready) is the architectural spine of the ingestion pipeline. F007b and F007c plug into the same normalization step.

**Crawlee autoscaling disabled**

Chain scrapers run with fixed, conservative concurrency (default: 1 concurrent request, 10 req/min). Predictability and anti-bot safety are more important than throughput.

---

### File Structure

```
packages/scraper/
├── package.json                       # name: "@foodxplorer/scraper"
├── tsconfig.json                      # extends ../../tsconfig.base.json
├── vitest.config.ts
└── src/
    ├── config.ts                      # ScraperEnvSchema (Zod) + ScraperConfig type
    ├── runner.ts                      # CLI entry point
    ├── registry.ts                    # chainSlug → ScraperConfig map (empty in F007)
    ├── base/
    │   ├── BaseScraper.ts             # Abstract class — run(), normalize(), persist() stub
    │   ├── types.ts                   # RawDishDataSchema, NormalizedDishDataSchema,
    │   │                              # ScraperConfigSchema, ScraperResultSchema
    │   └── errors.ts                  # ScraperError subclasses
    ├── utils/
    │   ├── retry.ts                   # withRetry() — exponential back-off
    │   ├── rateLimit.ts               # RateLimiter — token-bucket
    │   └── normalize.ts               # normalizeNutrients(), normalizeDish()
    └── __tests__/
        ├── BaseScraper.test.ts
        ├── retry.test.ts
        ├── rateLimit.test.ts
        └── normalize.test.ts
```

---

### Config Schema

Defined in `packages/scraper/src/config.ts` using Zod. Same `parseConfig` / startup-exit pattern as `packages/api`.

```
ScraperEnvSchema = z.object({
  NODE_ENV         : z.enum(["development", "test", "production"]).default("development")
  DATABASE_URL     : z.string().url()
  DATABASE_URL_TEST: z.string().url().optional()
  LOG_LEVEL        : z.enum(["fatal","error","warn","info","debug","trace"]).default("info")
  SCRAPER_HEADLESS : z.coerce.boolean().default(true)
  SCRAPER_CHAIN    : z.string().optional()
})
```

---

### API Endpoints

No API endpoints are added by F007. The `Ingestion` tag is pre-registered in `api-spec.yaml` as a placeholder for F007b (`POST /ingest/pdf`) and F007c (`POST /ingest/url`).

---

### New Dependencies (`packages/scraper`)

| Package | Type | Reason |
|---|---|---|
| `crawlee` | runtime | PlaywrightCrawler, request queue, retry |
| `playwright` | runtime | Browser automation (Crawlee peer dep) |
| `@foodxplorer/shared` | runtime | Shared Zod schemas and types |
| `@prisma/client` | runtime | Direct DB writes |
| `zod` | runtime | Schema validation |
| `@types/node` | devDep | Node.js types |
| `tsx` | devDep | TypeScript CLI execution |
| `typescript` | devDep | Compiler |
| `vitest` | devDep | Tests |

---

### Zod Schemas (new, in `packages/scraper/src/base/types.ts`)

These schemas are scraper-internal — they are NOT added to `packages/shared`.

| Schema | Purpose |
|---|---|
| `RawDishDataSchema` | Output of `extractDishes()` — unvalidated, chain-specific shape |
| `NormalizedDishDataSchema` | After normalization — DB-ready, fully validated |
| `ScraperConfigSchema` | Per-chain crawler configuration |
| `ScraperResultSchema` | Summary of a completed scraper run |

See `docs/specs/F007-scraper-scaffold-spec.md` §4 for full field definitions.

---

### Key Interfaces

```typescript
// Chain scrapers implement these two abstract methods:

abstract extractDishes(page: Page): Promise<RawDishData[]>
// Navigate a product/menu page and return raw dish data.

abstract getMenuUrls(page: Page): Promise<string[]>
// Navigate a start URL and return menu/product URLs to crawl.
```

---

### Normalization Rules

| Rule | Detail |
|---|---|
| Required fields | `calories`, `proteins`, `carbohydrates`, `fats` must be present and ≥ 0 |
| Salt / sodium | Mutual derivation: `salt_g = sodium_mg / 1000 * 2.5` and vice versa |
| Negative values | Clamped to 0 with warning log |
| `calories > 9000` | Return `null` (skipped) — DB CHECK constraint ceiling |
| `referenceBasis` | Always `'per_serving'` for scraped restaurant data |
| `confidenceLevel` | Always `'medium'` for scraped data |
| `estimationMethod` | Always `'scraped'` |
| String nutrients | `"<1"` → `0.5`, `"tr"` → `0`, invalid → `0` with warning |

---

### Edge Cases

| Scenario | Expected behaviour |
|---|---|
| Site returns 403 | Throw `ScraperBlockedError`, abort run, status `'failed'` |
| CAPTCHA detected | Throw `ScraperBlockedError` |
| `extractDishes()` returns `[]` for a page | Log warn, continue to next URL |
| `extractDishes()` throws | Record in `ScraperResult.errors`, continue |
| 0 dishes extracted across all pages | `status: 'failed'` |
| Normalization returns `null` | Increment `dishesSkipped`, log warn |
| `DATABASE_URL` missing | Process exits at startup |
| Browser crash | Crawlee re-launches; after 3 failures records error |
| Page timeout >60s | Crawlee marks failed; retry policy applies |

---

### Acceptance Criteria

- [x] `packages/scraper` package compiles with `tsc --noEmit` (strict mode, zero errors)
- [x] `BaseScraper` abstract class: `run()`, `normalize()`, `persist()` stub all present
- [x] `run()` returns valid `ScraperResult` when `extractDishes` returns `[]`
- [x] `withRetry` retries on transient errors, does NOT retry on 403/404
- [x] `normalizeNutrients` passes all unit tests (salt/sodium derivation, clamping, skipping on missing required fields, calorie ceiling)
- [x] `normalizeDish` passes all unit tests (trimming, defaults, field assignments)
- [x] `RateLimiter` enforces `requestsPerMinute` ceiling
- [x] All Zod schemas validate and reject inputs correctly
- [x] `vitest run` — 141 tests green
- [x] `packages/api` and `packages/shared` builds unaffected
- [x] No `any` types, no `ts-ignore`
- [x] All public and abstract methods have JSDoc comments

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing (141 tests)
- [x] TypeScript strict mode — no `any`, no `ts-ignore`
- [x] No linting errors
- [x] Build (`tsc`) succeeds
- [x] `docs/specs/F007-scraper-scaffold-spec.md` reflects final implementation
- [x] `docs/project_notes/key_facts.md` updated with scraper package facts

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated (F007-scraper-scaffold-spec.md + api-spec.yaml tag + ticket spec)
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` executed, plan approved
- [x] Step 3: `backend-developer` executed with TDD
- [x] Step 4: `production-code-validator` executed, quality gates pass
- [x] Step 5: `code-review-specialist` executed
- [x] Step 5: `qa-engineer` executed
- [x] Step 6: Ticket updated with final metrics, branch deleted

---

## Implementation Plan

### Existing Code to Reuse

- `packages/api/src/config.ts` — `parseConfig(env)` pattern: replicate exactly (Zod schema + `safeParse` + `process.exit(1)` on failure). Do not import from `packages/api`; copy the pattern into `packages/scraper/src/config.ts`.
- `packages/shared/src/schemas/enums.ts` — import `ConfidenceLevelSchema`, `EstimationMethodSchema`, `DishAvailabilitySchema`, `NutrientReferenceBasisSchema` directly from `@foodxplorer/shared`. These are the only shared schemas consumed by `packages/scraper`.
- `packages/api/tsconfig.json` — use as the model for `packages/scraper/tsconfig.json` (same `extends`, `paths`, `references` pattern; adapt `rootDir` / `outDir`).
- `packages/api/vitest.config.ts` — use as the model for `packages/scraper/vitest.config.ts` (`fileParallelism: false`, `env` block with `NODE_ENV: 'test'` and `DATABASE_URL`).
- `tsconfig.base.json` — `packages/scraper/tsconfig.json` extends `../../tsconfig.base.json` (same as `packages/api` and `packages/shared`).

No existing scraper infrastructure exists. All `packages/scraper` source files are new.

---

### Files to Create

```
packages/scraper/
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── config.ts
    ├── registry.ts
    ├── runner.ts
    ├── base/
    │   ├── types.ts
    │   ├── errors.ts
    │   └── BaseScraper.ts
    ├── utils/
    │   ├── retry.ts
    │   ├── rateLimit.ts
    │   └── normalize.ts
    └── __tests__/
        ├── retry.test.ts
        ├── rateLimit.test.ts
        ├── normalize.test.ts
        └── BaseScraper.test.ts
```

| File | Purpose |
|------|---------|
| `packages/scraper/package.json` | Package manifest: name `@foodxplorer/scraper`, runtime deps (`crawlee`, `playwright`, `@foodxplorer/shared`, `@prisma/client`, `zod`), devDeps (`tsx`, `typescript`, `vitest`, `@types/node`), scripts (`dev`, `typecheck`, `test`, `test:watch`) |
| `packages/scraper/tsconfig.json` | Extends `../../tsconfig.base.json`; sets `outDir: ./dist`, `rootDir: ./src`; `paths` alias for `@foodxplorer/shared`; `references` to `../shared`; excludes test files from compilation |
| `packages/scraper/vitest.config.ts` | `defineConfig` with `fileParallelism: false`; `env` block: `NODE_ENV: 'test'`, `DATABASE_URL`, `DATABASE_URL_TEST`, `LOG_LEVEL: 'info'`, `SCRAPER_HEADLESS: 'true'` |
| `packages/scraper/src/config.ts` | `ScraperEnvSchema` (Zod), `ScraperConfig` type alias from `ScraperConfigSchema`, `parseConfig(env)` function, `config` singleton |
| `packages/scraper/src/registry.ts` | `ScraperRegistry` type (`Record<string, ScraperConfig>`), empty `registry` export; F008–F017 add entries here |
| `packages/scraper/src/runner.ts` | CLI entry point: reads `config.SCRAPER_CHAIN`, looks up registry, instantiates chain scraper, calls `run()`, logs `ScraperResult` |
| `packages/scraper/src/base/types.ts` | `RawDishDataSchema`, `RawDishData`; `NormalizedDishDataSchema`, `NormalizedDishData`; `ScraperConfigSchema`, `ScraperConfig`; `ScraperResultSchema`, `ScraperResult` — all as Zod schemas with `z.infer` type exports |
| `packages/scraper/src/base/errors.ts` | `ScraperError`, `ScraperNetworkError`, `ScraperBlockedError`, `ScraperStructureError`, `NormalizationError`, `NotImplementedError` — each with `code: string` property |
| `packages/scraper/src/base/BaseScraper.ts` | Abstract class with constructor, abstract `extractDishes`, abstract `getMenuUrls`, concrete `run()`, `normalize()`, `persist()` stub |
| `packages/scraper/src/utils/retry.ts` | `withRetry<T>()` generic function |
| `packages/scraper/src/utils/rateLimit.ts` | `RateLimiter` class (token-bucket) |
| `packages/scraper/src/utils/normalize.ts` | `normalizeNutrients()`, `normalizeDish()` pure functions |
| `packages/scraper/src/__tests__/retry.test.ts` | Unit tests for `withRetry` |
| `packages/scraper/src/__tests__/rateLimit.test.ts` | Unit tests for `RateLimiter` |
| `packages/scraper/src/__tests__/normalize.test.ts` | Unit tests for `normalizeNutrients` and `normalizeDish` |
| `packages/scraper/src/__tests__/BaseScraper.test.ts` | Unit tests for `BaseScraper.run()` orchestration |

---

### Files to Modify

| File | Change |
|------|--------|
| `package.json` (root) | Add `"packages/scraper"` to `workspaces` array; add `"scraper:run": "npm run dev -w @foodxplorer/scraper"` script |

No changes to `packages/api`, `packages/shared`, or any Prisma schema.

---

### Implementation Order

Follow TDD: write the failing test first, then write the minimum implementation to make it pass.

**I-1 — Package scaffolding** (`package.json`, `tsconfig.json`, `vitest.config.ts`, root `package.json`)

Create the three config files for `packages/scraper`. Register the workspace in the root `package.json`. Verify `npm install` resolves the new workspace and `tsc --noEmit` reports no errors on an empty `src/` directory. No tests yet.

Key details:
- `package.json`: `"type": "module"` is NOT needed — the project uses `module: Node16` which handles ESM/CJS via file extensions. Match the pattern of `packages/api/package.json`.
- `tsconfig.json`: set `"composite": false` (scraper is not referenced by other packages); include `paths` alias `"@foodxplorer/shared": ["../shared/src"]` and `"@foodxplorer/shared/*": ["../shared/src/*"]`; add `"references": [{ "path": "../shared" }]`; exclude test and spec files.
- `vitest.config.ts`: set `env.DATABASE_URL` to `postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test` and `env.DATABASE_URL_TEST` to the same value — unit tests do not hit the DB, but `config.ts` parses `DATABASE_URL` at module load time so the test runner needs a valid-format URL in env.

**I-2 — Error classes** (`src/base/errors.ts`)

No test file needed (error class behaviour is trivially verified via `instanceof` checks in higher-level tests). Write implementation directly.

Each class:
- Extends the class above it in the hierarchy (e.g. `ScraperNetworkError extends ScraperError`).
- Sets `this.name` to the class name in the constructor.
- Carries a `readonly code: string` property whose value is the SCREAMING_SNAKE_CASE version of the class name (e.g. `SCRAPER_NETWORK_ERROR`). The `code` matches the string used in `ScraperResult.errors[].code`.
- Calls `super(message)` and uses `Object.setPrototypeOf(this, new.target.prototype)` to restore the prototype chain (standard TypeScript error subclassing pattern).

**I-3 — Zod schemas / types** (`src/base/types.ts`)

Write the four schemas exactly as specified in `docs/specs/F007-scraper-scaffold-spec.md` §4. Export both the schema and the inferred TypeScript type for each. Import shared enum schemas from `@foodxplorer/shared`.

Critical field details:
- `RawDishDataSchema.nutrients` — all 14 nutrient sub-fields are optional; `extra` is `z.record(z.string(), z.number()).optional()`.
- `NormalizedDishDataSchema.nutrients` — the four required nutrients (`calories`, `proteins`, `carbohydrates`, `fats`) are `z.number().nonneg()` (NOT optional); remaining fields use `.default(0)` except `extra` which stays optional.
- `ScraperConfigSchema.rateLimit` and `.retryPolicy` use `.default(...)` on the nested object fields (not on the object itself) so that partial overrides work.
- `ScraperResultSchema.status` uses `z.enum(['success', 'partial', 'failed'])`.

After writing the schemas, verify with `tsc --noEmit` before proceeding.

**I-4 — Config** (`src/config.ts`)

Copy the `parseConfig` pattern from `packages/api/src/config.ts`. The exported names are `ScraperEnvSchema`, `parseConfig`, and `config`. The singleton `config` is parsed from `process.env` at module load time.

Note: `config.ts` exports the parsed environment as `Config` (the inferred type of `ScraperEnvSchema`). It does NOT export `ScraperConfig` (which is the per-chain configuration from `types.ts`). These are two different things — `ScraperEnvSchema` governs the process environment; `ScraperConfigSchema` governs per-chain crawler settings.

**I-5 — `withRetry` utility** (`src/utils/retry.ts` + `src/__tests__/retry.test.ts`)

Write the test file first (TDD).

Test cases to cover in `retry.test.ts`:
- Returns the resolved value when the function succeeds on the first attempt.
- Retries on a `ScraperNetworkError` (transient) and succeeds on the second attempt.
- Retries up to `maxRetries` times on transient errors, then throws `ScraperNetworkError` on exhaustion.
- Does NOT retry when the function throws `ScraperBlockedError` (HTTP 403) — re-throws immediately.
- Does NOT retry on a generic `Error` with HTTP status 404 in the message — re-throws immediately.
- Back-off delay between attempts is `backoffMs * (backoffMultiplier ^ attempt)`, capped at 30 000 ms. Use `vi.useFakeTimers()` to avoid real delays; assert `vi.advanceTimersByTimeAsync()` is called with the expected delay.
- Logs a `warn` for each retry attempt (mock `console.warn` or a logger dependency).

Implementation notes:
- The function signature: `withRetry<T>(fn: () => Promise<T>, policy: RetryPolicy, context: string): Promise<T>` where `RetryPolicy` is derived from `ScraperConfigSchema.shape.retryPolicy`.
- Transient errors that trigger retry: instances of `ScraperNetworkError`, or errors whose message contains `'429'` or `'503'`.
- Non-retryable errors: instances of `ScraperBlockedError`, or errors whose message contains `'403'` or `'404'`.
- All other errors: retry up to `maxRetries`.
- Back-off cap: `Math.min(backoffMs * Math.pow(backoffMultiplier, attempt), 30_000)`.
- Use `setTimeout` wrapped in a `Promise` for the delay (compatible with `vi.useFakeTimers()`).

**I-6 — `RateLimiter` utility** (`src/utils/rateLimit.ts` + `src/__tests__/rateLimit.test.ts`)

Write the test file first (TDD).

Test cases to cover in `rateLimit.test.ts`:
- `acquire()` resolves immediately when tokens are available.
- `acquire()` delays when the token bucket is empty, waiting until the next refill interval.
- Multiple sequential `acquire()` calls do not exceed `requestsPerMinute` over a 60-second window. Use `vi.useFakeTimers()`.
- `RateLimiter` constructed with `requestsPerMinute: 60` allows 60 requests in one minute without blocking.
- `RateLimiter` constructed with `requestsPerMinute: 1` forces a ~60 000 ms wait before the second token is available.

Implementation notes:
- Constructor: `constructor(requestsPerMinute: number)`.
- Public method: `acquire(): Promise<void>`.
- Token-bucket: initialize with `requestsPerMinute` tokens. Refill one token every `60_000 / requestsPerMinute` ms. Never exceed `requestsPerMinute` tokens.
- The minimum delay between requests is `3_000 + Math.random() * 2_000` ms (jitter), applied in addition to the token-bucket delay. This jitter is the mechanism behind the spec's "Min delay between requests: 3 000 ms" requirement.
- Note: Crawlee's own `maxRequestsPerMinute` option handles rate limiting at the crawler level. The `RateLimiter` class here is an additional guard used inside `BaseScraper` for any manual request orchestration outside the Crawlee queue (e.g. pre-flight checks). Both mechanisms apply.

**I-7 — Normalization utilities** (`src/utils/normalize.ts` + `src/__tests__/normalize.test.ts`)

Write the test file first (TDD). This is the most test-dense step — cover every rule in spec §7.

Test cases for `normalizeNutrients`:
- Returns valid `NormalizedDishData['nutrients']` when all four required fields are present.
- Returns `null` when `calories` is absent.
- Returns `null` when `proteins` is absent.
- Returns `null` when `carbohydrates` is absent.
- Returns `null` when `fats` is absent.
- Returns `null` when `fats` is absent even if `saturatedFats` is present.
- Derives `salt` from `sodium` when only `sodium` is present: `salt = sodium_mg / 1000 * 2.5`.
- Derives `sodium` from `salt` when only `salt` is present: `sodium = salt_g / 2.5 * 1000`.
- Uses both as-is when both `salt` and `sodium` are present.
- Defaults both `salt` and `sodium` to `0` when both are absent.
- Clamps a negative `calories` value to `0` (warn log).
- Clamps a negative `proteins` value to `0` (warn log).
- Returns `null` when `calories` exceeds `9000` (log error).
- Defaults `sugars` to `0` with a warn log when absent.
- Sets `referenceBasis` to `'per_serving'` unconditionally.
- Sets missing optional nutrients (`fiber`, `transFats`, etc.) to `0`.
- Passes `extra` through unchanged.
- Coerces string `"<1"` to `0.5` for any nutrient field.
- Coerces string `"tr"` (trace) to `0`.
- Coerces an invalid string (e.g. `"abc"`) to `0` with a warn log.

Test cases for `normalizeDish`:
- Trims leading/trailing whitespace from `name`.
- Collapses multiple internal spaces in `name` to single spaces.
- Truncates `externalId` to 100 characters.
- Trims `externalId`.
- Deduplicates `aliases`.
- Trims each entry in `aliases`.
- Sets `confidenceLevel` to `'medium'`.
- Sets `estimationMethod` to `'scraped'`.
- Sets `availability` to `'available'`.
- Attaches `sourceId` and `restaurantId` from the `meta` argument.

Implementation notes:
- `normalizeNutrients` accepts `RawDishData['nutrients']` — where nutrient fields may be `number | string | undefined`. The function must handle string coercion before applying numeric rules. The Zod schema in `types.ts` declares nutrients as `z.number().nonneg().optional()`, so string coercion is a pre-validation step inside `normalizeNutrients`, not in the Zod schema.
- `normalizeDish` returns `Partial<NormalizedDishData>` (without the `nutrients` sub-object — callers merge the two). The caller in `BaseScraper.normalize()` combines the output of `normalizeDish` and `normalizeNutrients`, then runs `NormalizedDishDataSchema.safeParse()` on the merged object.
- String coercion helper (private, unexported): `coerceNutrient(value: unknown): number` — strips non-numeric characters except `.`, handles `"<"` prefix (return half of numeric part), handles `"tr"` (return 0), parses float, returns 0 on failure.
- Use a Pino logger or `console.warn`/`console.error` for log calls. The spec does not require a specific logger in utilities — use `console` in F007 (Pino can be wired in a follow-up).

**I-8 — `BaseScraper` abstract class** (`src/base/BaseScraper.ts` + `src/__tests__/BaseScraper.test.ts`)

Write the test file first (TDD), using a `TestScraper extends BaseScraper` concrete class defined inside the test file.

Test cases for `BaseScraper.test.ts`:
- `run()` returns a `ScraperResult` with `status: 'success'`, `dishesFound: 0`, `dishesUpserted: 0`, `pagesVisited: 1`, `errors: []` when `getMenuUrls` returns one URL and `extractDishes` returns `[]`.
- `run()` increments `dishesFound` for each item returned by `extractDishes`.
- `run()` increments `dishesUpserted` for each dish that normalizes and persists successfully (mock `persist()` to resolve).
- `run()` increments `dishesSkipped` when `normalize()` returns `null`.
- `run()` records an error in `ScraperResult.errors` and continues when `extractDishes` throws for one page.
- `run()` sets `status: 'partial'` when `dishesSkipped > 0` and `dishesUpserted > 0`.
- `run()` sets `status: 'failed'` when `dishesUpserted === 0` after all pages.
- `run()` sets `startedAt` and `finishedAt` as valid ISO datetime strings with `finishedAt >= startedAt`.
- `normalize()` calls `normalizeNutrients` and `normalizeDish`, merges results, and runs `NormalizedDishDataSchema.safeParse()`.
- `normalize()` returns `null` when `normalizeNutrients` returns `null`.
- `persist()` throws `NotImplementedError` (the F007 stub behaviour).

Implementation notes for `BaseScraper.ts`:
- Constructor stores `config: ScraperConfig` as a `protected readonly` field.
- `run()` method orchestrates the Crawlee `PlaywrightCrawler`. For F007 (no real chains), the crawler must be wired but the unit tests mock it. Use dependency injection for the Crawlee crawler instance OR structure `run()` so the crawler creation is in a protected factory method `createCrawler()` that tests can override. The latter is simpler.
- `run()` tracks counters as local variables, builds `ScraperResult` at the end, and returns it (does not throw even on full failure).
- Use `new Date().toISOString()` for `startedAt` / `finishedAt`.
- `BaseScraper` unit tests must NOT instantiate a real Crawlee crawler. Achieve this by having `TestScraper` override `createCrawler()` to return a mock that immediately calls `requestHandler` with test page data, or by having `run()` accept an optional crawler parameter (preferred: the mock pattern via protected override).
- JSDoc comments are required on all public and abstract methods.

**I-9 — Config and registry** (`src/config.ts` is done in I-4; `src/registry.ts` here)

`registry.ts` is small. Export:
```
export type ScraperRegistry = Record<string, ScraperConfig>;
export const registry: ScraperRegistry = {};
```
No tests for the empty registry. F008 will add the first entry and its corresponding test.

**I-10 — CLI runner** (`src/runner.ts`)

No unit test for the runner itself (it is a thin orchestration script). Test coverage comes from the unit tests of the components it calls.

Implementation notes:
- Import `config` from `./config.js` (`.js` extension required under `module: Node16`).
- Import `registry` from `./registry.js`.
- If `config.SCRAPER_CHAIN` is undefined, log all available chain slugs and exit with code 0.
- If `config.SCRAPER_CHAIN` is set but not found in the registry, log an error and exit with code 1.
- Instantiate the chain scraper class from the registry entry (F008 will register constructors — in F007, the registry is empty so this path cannot be exercised, but the code must be structurally correct).
- Call `await scraper.run()`, log the `ScraperResult`, exit with code 0 on `success`/`partial`, code 1 on `failed`.

**I-11 — Final validation**

- Run `tsc --noEmit` in `packages/scraper` — zero errors required.
- Run `vitest run` in `packages/scraper` — all tests green.
- Run `tsc --noEmit` in `packages/api` and `packages/shared` to confirm no cross-package regressions.
- Confirm `npm run build --workspaces` succeeds from the root.

---

### Testing Strategy

**Test files to create:**

| File | Type | What it tests |
|------|------|---------------|
| `src/__tests__/retry.test.ts` | Unit | `withRetry` — all retry/no-retry/back-off branches |
| `src/__tests__/rateLimit.test.ts` | Unit | `RateLimiter` — token issuance, throttling, jitter |
| `src/__tests__/normalize.test.ts` | Unit | `normalizeNutrients` (all §7.1 rules) + `normalizeDish` (all §7.2 rules) |
| `src/__tests__/BaseScraper.test.ts` | Unit | `run()` orchestration logic, `normalize()`, `persist()` stub |

**No integration tests** — F007 contains no database writes (persist is a stub). Integration tests begin in F008.

**Key happy-path scenarios:**
- `withRetry` succeeds on first attempt.
- `normalizeNutrients` returns valid nutrients with all required fields present and salt/sodium derived correctly.
- `normalizeDish` trims and defaults all fields.
- `BaseScraper.run()` returns `{ status: 'success', dishesFound: 0, dishesUpserted: 0 }` for empty extraction.

**Key edge-case and error scenarios:**
- `withRetry` exhausts retries and throws `ScraperNetworkError`.
- `withRetry` does not retry on `ScraperBlockedError`.
- `normalizeNutrients` returns `null` for missing required fields, `calories > 9000`, and `fats` absent with `saturatedFats` present.
- `normalizeNutrients` clamps negative values and logs a warning.
- `normalizeNutrients` coerces `"<1"` → `0.5`, `"tr"` → `0`, invalid string → `0`.
- `BaseScraper.run()` records errors and continues when `extractDishes` throws.
- `BaseScraper.run()` sets `status: 'failed'` when no dishes are upserted.

**Mocking strategy:**
- `vi.useFakeTimers()` in `retry.test.ts` and `rateLimit.test.ts` to control `setTimeout` without real delays.
- `vi.spyOn(console, 'warn')` and `vi.spyOn(console, 'error')` in `normalize.test.ts` to assert warning logs without noise.
- `BaseScraper.test.ts` defines a `TestScraper extends BaseScraper` inside the test file. `extractDishes` and `getMenuUrls` are implemented with controlled outputs. `persist()` is overridden as `vi.fn().mockResolvedValue(undefined)`. The Crawlee `PlaywrightCrawler` is never instantiated — instead, `BaseScraper.run()` is structured to call a protected `createCrawler()` factory, and `TestScraper` overrides `createCrawler()` to return a minimal mock that simulates the crawler lifecycle synchronously.
- `beforeEach(() => vi.clearAllMocks())` in all test files.

---

### Key Patterns

**`parseConfig` pattern** — follow `packages/api/src/config.ts` exactly:
1. Define `ScraperEnvSchema` as a named Zod export.
2. Export `parseConfig(env: NodeJS.ProcessEnv): Config` — calls `safeParse`, exits on failure.
3. Export `config: Config = parseConfig(process.env)` as the singleton.

**TypeScript module extensions** — all imports between files within `packages/scraper` must use `.js` extensions (e.g. `import { withRetry } from './retry.js'`). This is required by `module: Node16` in `tsconfig.base.json`. The same rule applies to `@foodxplorer/shared` imports, which resolve via the `paths` alias.

**Zod schema exports** — follow the pattern in `packages/shared/src/schemas/`: export both the schema constant (`RawDishDataSchema`) and the inferred type (`type RawDishData = z.infer<typeof RawDishDataSchema>`). This avoids consumers having to call `z.infer` themselves.

**Error subclassing** — always call `Object.setPrototypeOf(this, new.target.prototype)` inside the constructor after `super()`. Without this, `instanceof` checks fail after TypeScript compiles to ES5/ES2015. See spec §9.

**TDD discipline** — every utility and the base class follow strict TDD: test file written first (all tests failing), then implementation. Do not write any implementation until the corresponding test file exists and `vitest run` shows the expected failures.

**`crawlee` import** — import `PlaywrightCrawler` from `'crawlee'` (not from a sub-path). The `crawlee` package re-exports everything. Do not import directly from `@crawlee/playwright`.

**`persist()` stub** — the `persist()` method in `BaseScraper` must call `persistDish(normalized)` where `persistDish` is a protected method that throws `new NotImplementedError('persistDish is not implemented — awaiting F008')`. This gives F008 a clean override point without modifying the public API of `BaseScraper`.

**Crawlee crawler mock pattern** — the recommended approach for `BaseScraper.test.ts` is:
```
protected createCrawler(requestHandler, failedRequestHandler): PlaywrightCrawler {
  return new PlaywrightCrawler({ ... });
}
```
`TestScraper` overrides `createCrawler` to return a duck-typed mock with a `run()` method that calls `requestHandler` directly with a synthetic `{ page, request }` object. This avoids importing Playwright types into the test file.

**No `any` types** — if a Crawlee or Playwright type is not easily importable, use the specific type from `crawlee` or `playwright` packages (e.g. `Page` from `playwright`, `PlaywrightCrawler` from `crawlee`). If a duck-typed mock is needed in tests, use `as unknown as PlaywrightCrawler` with a comment explaining the cast.

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-12 | Step 0: Spec created | spec-creator agent, F007-scraper-scaffold-spec.md written, api-spec.yaml tag added |
| 2026-03-12 | Step 1: Setup | Branch feature/F007-scraper-scaffold created from develop, ticket generated, tracker updated |
| 2026-03-12 | Step 2: Plan | backend-planner agent, 11-step implementation plan written into ticket |
| 2026-03-12 | Step 3: Implement | backend-developer agent, 60 tests, 13 source files, 4 test files |
| 2026-03-12 | Step 4: Finalize | production-code-validator: PRODUCTION-READY, 0 issues, 60/60 tests, tsc clean |
| 2026-03-12 | Step 5: Review | code-review: 4H, 4M, 4L findings. QA: 3 bugs (NaN/Infinity), 1 spec gap, 81 edge-case tests. All fixed. Accepted: H1-H4, M3-M4, QA BUG-1/2/3, spec gap. Deferred: M1 (http.ts to F007b), M2 (RateLimiter usage to F008) |
| 2026-03-12 | Step 6: Complete | Squash merged to develop as 582cbb1 (PR #6). Branch deleted. 141 tests total. |
