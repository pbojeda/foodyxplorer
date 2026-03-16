# F010 — Chain PDF Registry + Batch Runner

**Feature:** F010 | **Type:** Backend-Feature | **Priority:** High
**Status:** Pending | **Epic:** E002 — Data Ingestion Pipeline
**Created:** 2026-03-16 | **Dependencies:** F009 complete (POST /ingest/pdf-url)

---

## 1. Purpose

F010 adds a config-driven chain registry that maps each PDF-only Spanish fast-food chain to its nutrition PDF URL, and a CLI batch runner that iterates over enabled chains, calling the existing `POST /ingest/pdf-url` pipeline for each.

The strategic goal (ADR-006): adding a new chain should require only a config entry — no new code. The batch runner is the automation layer that operationalises the PDF-first ingestion strategy for BK Spain, KFC Spain, Telepizza, and Five Guys Spain.

F010 intentionally does NOT introduce any new API endpoints. The entire feature is a CLI tool + config files + seed data.

---

## 2. Scope Boundaries

**In scope:**
- `ChainPdfConfig` TypeScript type and Zod schema defining a single chain's PDF ingestion config
- Registry file `packages/api/src/config/chains/chain-pdf-registry.ts` — static array of `ChainPdfConfig` entries for BK, KFC, Telepizza, Five Guys
- CLI batch runner script `packages/api/src/scripts/batch-ingest.ts` — executable via `tsx`
- Seed data: `restaurant` + `dataSource` rows for BK, KFC, Telepizza, Five Guys Spain (appended to existing `seed.ts`)
- UUID constants file `packages/api/src/config/chains/chain-seed-ids.ts` — deterministic UUIDs for seed rows
- npm script `ingest:batch` in `packages/api/package.json`
- Unit tests for config schema validation
- Integration tests for the batch runner (mocked HTTP + DB)

**Out of scope:**
- Any new API endpoints — F010 is CLI-only
- F011 parser tuning per chain's real PDF (separate ticket)
- URL discovery/verification — PDF URLs are provided as constants (some may need manual verification before F011)
- Scheduled/cron execution (Phase 2)
- Domino's (JPEG images, not PDF — F012)
- McDonald's (web scraper pattern, F008)
- Subway Spain (no viable PDF source, F013)

---

## 3. Architectural Decisions

### 3.1 CLI uses HTTP to call the existing pipeline — no direct function import

**Decision:** The batch runner calls `POST /ingest/pdf-url` via HTTP using Node.js built-in `fetch`. It does NOT import or call pipeline functions (`downloadPdf`, `parseNutritionTable`, `normalizeNutrients`, `normalizeDish`, Prisma) directly.

**Rationale:**

The `POST /ingest/pdf-url` route already handles the complete pipeline with proper error handling, timeout management, and the Prisma transaction. Reimplementing that logic in the CLI would create a second code path to maintain. Calling the API via HTTP ensures:

1. Single implementation — the route is the canonical implementation
2. The CLI inherits all route-level safety guarantees (SSRF guard, 30s timeout, 20MB cap, Prisma transaction)
3. The CLI can be run against any environment (local dev, staging, prod) by changing the `API_BASE_URL` env var
4. Integration tests for the CLI can inject a mock HTTP server (same pattern as Vitest network mocking)

The tradeoff is that the API server must be running when the batch runner executes. This is acceptable: the runner is a maintenance CLI, not a hot-path operation. A README note documents this requirement.

### 3.2 Config as a static TypeScript array — not a JSON file or database table

**Decision:** Chain configs are defined in a TypeScript file (`chain-pdf-registry.ts`) as a typed array of objects, not stored in a database table or loaded from JSON at runtime.

**Rationale:**

- Adding a new chain requires the same change regardless of storage (one new entry, either code or JSON)
- TypeScript provides compile-time type safety on the config shape — a JSON file requires runtime validation and a manual schema sync
- A database `chain_configs` table would require a migration for each new chain, which is heavier than a code change
- The registry is infrastructure config (like environment variables), not operational data — it belongs in source control alongside the code that uses it
- Enabled/disabled control is a field on the config entry; no DB admin panel needed for Phase 1

### 3.3 `restaurantId` and `sourceId` stored in config — not fetched at runtime

**Decision:** Each `ChainPdfConfig` entry holds the UUID `restaurantId` and `sourceId` directly. These UUIDs are deterministic constants defined in `chain-seed-ids.ts` and seeded by `seed.ts`.

**Rationale:**

The `POST /ingest/pdf-url` endpoint requires `restaurantId` and `sourceId` UUIDs. Two approaches: (a) embed them in config as constants, or (b) look them up by slug at runtime.

Approach (a) is chosen because:
- Runtime lookup adds an extra DB round-trip before every batch run
- Constants make the config self-contained and readable without querying the DB
- The seed script creates rows with deterministic IDs (same pattern as the existing USDA seed rows), so IDs are stable across environments
- If a restaurant row is accidentally deleted, the runner fails with a clear `404 NOT_FOUND` from the endpoint rather than silently using a wrong ID

### 3.4 Batch runner: continue on chain failure, collect results

**Decision:** When one chain fails (any error — network, parse, DB), the runner logs the error, records it in the batch result, and continues with the next chain. The process exits with code 1 if ANY chain failed.

**Rationale:**

BK's PDF URL changes monthly (it includes the month and year in the path). A stale URL on one chain must not block ingestion for other chains. The runner should be a "best-effort batch with full reporting" tool, not an all-or-nothing operation.

Exit code 1 on partial failure ensures CI/cron jobs can detect problems without the runner needing to surface errors via a separate channel.

### 3.5 Dry-run mode: passed through to the endpoint

**Decision:** The batch runner accepts a `--dry-run` flag that passes `dryRun: true` in each `POST /ingest/pdf-url` request body. No DB writes occur. The summary report shows what WOULD be ingested.

**Rationale:** Allows safe verification that PDF URLs are reachable and parseable without modifying the database. Particularly useful for verifying BK's URL after a monthly rotation.

### 3.6 `updateFrequency` field: informational only in Phase 1

**Decision:** `updateFrequency` (e.g. `'monthly'`, `'quarterly'`, `'static'`) is stored on the config entry for documentation and future scheduling. The batch runner in Phase 1 does NOT use it to filter which chains to run — it runs all enabled chains every time.

**Rationale:** Phase 1 has no cron scheduler. The runner is invoked manually. The field is forward-compatible with a Phase 2 cron integration without requiring a config schema change.

---

## 4. File Structure

```
packages/api/src/
├── config/
│   └── chains/
│       ├── chain-pdf-registry.ts       # NEW — ChainPdfConfig[] with BK, KFC, Telepizza, Five Guys
│       └── chain-seed-ids.ts           # NEW — deterministic UUID constants for seed rows
└── scripts/
    └── batch-ingest.ts                 # NEW — CLI entry point

packages/api/prisma/
└── seed.ts                             # MODIFIED — append restaurant + dataSource rows for 4 chains

packages/api/
└── package.json                        # MODIFIED — add "ingest:batch" script

packages/api/src/__tests__/
├── config/
│   └── chains/
│       └── chain-pdf-registry.test.ts  # Unit tests for config schema validation
└── scripts/
    └── batch-ingest.test.ts            # Integration tests (mocked fetch + DB)
```

---

## 5. `ChainPdfConfig` Schema

### 5.1 TypeScript type

```typescript
// packages/api/src/config/chains/chain-pdf-registry.ts

export interface ChainPdfConfig {
  /** Unique chain identifier — matches restaurants.chain_slug */
  chainSlug: string;

  /** Display name (English) */
  name: string;

  /** ISO 3166-1 alpha-2 country code */
  countryCode: string;

  /** Direct URL to the chain's nutrition PDF */
  pdfUrl: string;

  /** UUID of the restaurant row in the DB (created by seed.ts) */
  restaurantId: string;

  /** UUID of the data_source row in the DB (created by seed.ts) */
  sourceId: string;

  /** How often the PDF URL changes. Informational in Phase 1. */
  updateFrequency: 'static' | 'monthly' | 'quarterly' | 'yearly' | 'unknown';

  /** When false, the chain is skipped by the batch runner */
  enabled: boolean;

  /** Human-readable notes (URL stability, known quirks for F011, etc.) */
  notes?: string;
}
```

### 5.2 Zod schema

```typescript
// packages/api/src/config/chains/chain-pdf-registry.ts

import { z } from 'zod';

export const ChainPdfConfigSchema = z.object({
  chainSlug:       z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  name:            z.string().min(1).max(255),
  countryCode:     z.string().length(2).regex(/^[A-Z]{2}$/),
  pdfUrl:          z.string().url().max(2048),
  restaurantId:    z.string().uuid(),
  sourceId:        z.string().uuid(),
  updateFrequency: z.enum(['static', 'monthly', 'quarterly', 'yearly', 'unknown']),
  enabled:         z.boolean(),
  notes:           z.string().optional(),
});

export type ChainPdfConfig = z.infer<typeof ChainPdfConfigSchema>;
```

**Validation rule:** `chainSlug` must match `^[a-z0-9-]+$` (same pattern as `restaurants.chain_slug`). Validated at test time via `ChainPdfConfigSchema.parse()` — NOT at runtime startup to avoid adding latency.

---

## 6. Chain Registry — Initial Entries

```typescript
// packages/api/src/config/chains/chain-pdf-registry.ts

import { CHAIN_SEED_IDS } from './chain-seed-ids.js';

export const CHAIN_PDF_REGISTRY: ChainPdfConfig[] = [
  {
    chainSlug:       'burger-king-es',
    name:            'Burger King Spain',
    countryCode:     'ES',
    pdfUrl:          'https://eu-west-3-146514239214-prod-bk-fz.s3.eu-west-3.amazonaws.com/en-ES/2026/Nutritional+Information/MANTEL+NUTRICIONAL+ESP+ING+FEB2026.pdf',
    restaurantId:    CHAIN_SEED_IDS.BURGER_KING_ES.RESTAURANT_ID,
    sourceId:        CHAIN_SEED_IDS.BURGER_KING_ES.SOURCE_ID,
    updateFrequency: 'monthly',
    enabled:         true,
    notes:           'URL changes monthly. Pattern: /en-ES/YYYY/Nutritional+Information/MANTEL+NUTRICIONAL+ESP+ING+[MON][YYYY].pdf. Verify URL before each run.',
  },
  {
    chainSlug:       'kfc-es',
    name:            'KFC Spain',
    countryCode:     'ES',
    pdfUrl:          'https://static.kfc.es/pdf/contenido-nutricional.pdf',
    restaurantId:    CHAIN_SEED_IDS.KFC_ES.RESTAURANT_ID,
    sourceId:        CHAIN_SEED_IDS.KFC_ES.SOURCE_ID,
    updateFrequency: 'unknown',
    enabled:         true,
    notes:           'Static URL — stable across updates. KFC overwrites the same file path.',
  },
  {
    chainSlug:       'telepizza-es',
    name:            'Telepizza Spain',
    countryCode:     'ES',
    pdfUrl:          'https://statices.telepizza.com/static/on/demandware.static/-/Sites-TelepizzaES-Library/default/dw21878fcd/documents/nutricion.pdf',
    restaurantId:    CHAIN_SEED_IDS.TELEPIZZA_ES.RESTAURANT_ID,
    sourceId:        CHAIN_SEED_IDS.TELEPIZZA_ES.SOURCE_ID,
    updateFrequency: 'unknown',
    enabled:         true,
    notes:           'Salesforce CDN. URL may change on site rebuild. Verify if FETCH_FAILED occurs.',
  },
  {
    chainSlug:       'five-guys-es',
    name:            'Five Guys Spain',
    countryCode:     'ES',
    pdfUrl:          'https://fiveguys.es/app/uploads/sites/6/2026/02/FGES_ES_allergen-ingredients_print-SP_A4_20260303.pdf',
    restaurantId:    CHAIN_SEED_IDS.FIVE_GUYS_ES.RESTAURANT_ID,
    sourceId:        CHAIN_SEED_IDS.FIVE_GUYS_ES.SOURCE_ID,
    updateFrequency: 'unknown',
    enabled:         true,
    notes:           'URL includes upload date. May change when PDF is updated. Pattern: fiveguys.es/app/uploads/sites/6/YYYY/MM/...',
  },
];
```

**Note on BK URL:** The URL encoded in the registry is the last known URL (February 2026, from ADR-005). The planner must document that this URL may be stale by implementation time and must be verified manually before the first real run. The `notes` field documents the URL pattern for future monthly updates.

---

## 7. Seed ID Constants

```typescript
// packages/api/src/config/chains/chain-seed-ids.ts

/**
 * Deterministic UUID constants for chain restaurant and dataSource rows.
 * These IDs are used in both seed.ts (to create the rows) and
 * chain-pdf-registry.ts (to reference them in config entries).
 *
 * ID allocation convention (consistent with existing seed.ts UUIDs):
 *   - restaurants: segment 6 (00000000-0000-0000-0006-xxxxxxxxxxxx)
 *   - data_sources: segment 0 (00000000-0000-0000-0000-xxxxxxxxxxxx)
 */
export const CHAIN_SEED_IDS = {
  BURGER_KING_ES: {
    RESTAURANT_ID: '00000000-0000-0000-0006-000000000010',
    SOURCE_ID:     '00000000-0000-0000-0000-000000000010',
  },
  KFC_ES: {
    RESTAURANT_ID: '00000000-0000-0000-0006-000000000011',
    SOURCE_ID:     '00000000-0000-0000-0000-000000000011',
  },
  TELEPIZZA_ES: {
    RESTAURANT_ID: '00000000-0000-0000-0006-000000000012',
    SOURCE_ID:     '00000000-0000-0000-0000-000000000012',
  },
  FIVE_GUYS_ES: {
    RESTAURANT_ID: '00000000-0000-0000-0006-000000000013',
    SOURCE_ID:     '00000000-0000-0000-0000-000000000013',
  },
} as const;
```

**Allocation note:** Existing seed.ts uses IDs in ranges `...0001` to `...0009` for segment 6 (restaurants) and `...0001` to `...0002` for segment 0 (data_sources). The new IDs start at `...0010` to avoid collisions.

---

## 8. Seed Data — New Rows

The following upsert blocks are appended to `packages/api/prisma/seed.ts` in a new section labelled `// Phase 3 — PDF Chain Restaurant + DataSource rows`.

### 8.1 Pattern

Each chain gets exactly:
1. One `dataSource` row (`type: 'scraped'`, `url` = the chain's PDF URL as known at seed time, `lastUpdated`: date of ADR-006 investigation)
2. One `restaurant` row (`chainSlug` + `countryCode: 'ES'`)

No dishes or dish nutrients are seeded here — those are produced by running the batch runner.

### 8.2 Seed entries (4 chains)

**Burger King Spain:**

```typescript
await prisma.dataSource.upsert({
  where: { id: CHAIN_SEED_IDS.BURGER_KING_ES.SOURCE_ID },
  update: {},
  create: {
    id:          CHAIN_SEED_IDS.BURGER_KING_ES.SOURCE_ID,
    name:        'Burger King Spain — Nutritional PDF',
    type:        'scraped',
    url:         'https://eu-west-3-146514239214-prod-bk-fz.s3.eu-west-3.amazonaws.com/en-ES/2026/Nutritional+Information/MANTEL+NUTRICIONAL+ESP+ING+FEB2026.pdf',
    lastUpdated: new Date('2026-03-13'),
  },
});

await prisma.restaurant.upsert({
  where: { chainSlug_countryCode: { chainSlug: 'burger-king-es', countryCode: 'ES' } },
  update: {},
  create: {
    id:          CHAIN_SEED_IDS.BURGER_KING_ES.RESTAURANT_ID,
    name:        'Burger King Spain',
    nameEs:      'Burger King España',
    chainSlug:   'burger-king-es',
    countryCode: 'ES',
    website:     'https://www.burgerking.es',
    isActive:    true,
  },
});
```

**KFC Spain:**

```typescript
await prisma.dataSource.upsert({
  where: { id: CHAIN_SEED_IDS.KFC_ES.SOURCE_ID },
  update: {},
  create: {
    id:          CHAIN_SEED_IDS.KFC_ES.SOURCE_ID,
    name:        'KFC Spain — Nutritional PDF',
    type:        'scraped',
    url:         'https://static.kfc.es/pdf/contenido-nutricional.pdf',
    lastUpdated: new Date('2026-03-13'),
  },
});

await prisma.restaurant.upsert({
  where: { chainSlug_countryCode: { chainSlug: 'kfc-es', countryCode: 'ES' } },
  update: {},
  create: {
    id:          CHAIN_SEED_IDS.KFC_ES.RESTAURANT_ID,
    name:        'KFC Spain',
    nameEs:      'KFC España',
    chainSlug:   'kfc-es',
    countryCode: 'ES',
    website:     'https://www.kfc.es',
    isActive:    true,
  },
});
```

**Telepizza Spain:**

```typescript
await prisma.dataSource.upsert({
  where: { id: CHAIN_SEED_IDS.TELEPIZZA_ES.SOURCE_ID },
  update: {},
  create: {
    id:          CHAIN_SEED_IDS.TELEPIZZA_ES.SOURCE_ID,
    name:        'Telepizza Spain — Nutritional PDF',
    type:        'scraped',
    url:         'https://statices.telepizza.com/static/on/demandware.static/-/Sites-TelepizzaES-Library/default/dw21878fcd/documents/nutricion.pdf',
    lastUpdated: new Date('2026-03-13'),
  },
});

await prisma.restaurant.upsert({
  where: { chainSlug_countryCode: { chainSlug: 'telepizza-es', countryCode: 'ES' } },
  update: {},
  create: {
    id:          CHAIN_SEED_IDS.TELEPIZZA_ES.RESTAURANT_ID,
    name:        'Telepizza Spain',
    nameEs:      'Telepizza España',
    chainSlug:   'telepizza-es',
    countryCode: 'ES',
    website:     'https://www.telepizza.es',
    isActive:    true,
  },
});
```

**Five Guys Spain:**

```typescript
await prisma.dataSource.upsert({
  where: { id: CHAIN_SEED_IDS.FIVE_GUYS_ES.SOURCE_ID },
  update: {},
  create: {
    id:          CHAIN_SEED_IDS.FIVE_GUYS_ES.SOURCE_ID,
    name:        'Five Guys Spain — Nutritional PDF',
    type:        'scraped',
    url:         'https://fiveguys.es/app/uploads/sites/6/2026/02/FGES_ES_allergen-ingredients_print-SP_A4_20260303.pdf',
    lastUpdated: new Date('2026-03-13'),
  },
});

await prisma.restaurant.upsert({
  where: { chainSlug_countryCode: { chainSlug: 'five-guys-es', countryCode: 'ES' } },
  update: {},
  create: {
    id:          CHAIN_SEED_IDS.FIVE_GUYS_ES.RESTAURANT_ID,
    name:        'Five Guys Spain',
    nameEs:      'Five Guys España',
    chainSlug:   'five-guys-es',
    countryCode: 'ES',
    website:     'https://www.fiveguys.es',
    isActive:    true,
  },
});
```

---

## 9. Batch Runner CLI Specification

### 9.1 Entry point

```
packages/api/src/scripts/batch-ingest.ts
```

Executable via:
```bash
tsx packages/api/src/scripts/batch-ingest.ts [options]
```

Or via the npm script:
```bash
npm run ingest:batch -w @foodxplorer/api [-- --chain kfc-es --dry-run]
```

### 9.2 CLI flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--chain <slug>` | string | _(none)_ | Run a single chain by its `chainSlug`. If omitted, all enabled chains are run. |
| `--dry-run` | boolean flag | `false` | Pass `dryRun: true` to the API endpoint. No DB writes. |
| `--api-url <url>` | string | `http://localhost:3001` | Base URL of the running API server. Overrides `API_BASE_URL` env var. |
| `--concurrency <n>` | integer | `1` | Number of chains to process in parallel. Default 1 (sequential) for Phase 1. |

**Precedence:** `--api-url` flag > `API_BASE_URL` env var > `http://localhost:3001` default.

### 9.3 Environment variables

| Variable | Description |
|----------|-------------|
| `API_BASE_URL` | Base URL of the API server (e.g. `http://localhost:3001`). Overridden by `--api-url`. |
| `DATABASE_URL` | Not used by the runner itself (it calls the API, not Prisma directly). Present only for the seed script. |

### 9.4 Algorithm

```
parseCliArgs(process.argv)
  → { chainSlug?, dryRun, apiBaseUrl, concurrency }

select chains:
  if chainSlug provided:
    entry = CHAIN_PDF_REGISTRY.find(c => c.chainSlug === chainSlug)
    if not found → print error, exit(1)
    if not enabled → print warning, exit(0)
    chains = [entry]
  else:
    chains = CHAIN_PDF_REGISTRY.filter(c => c.enabled)

if chains.length === 0 → print "No enabled chains found", exit(0)

print summary header:
  "Starting batch ingest for N chain(s) [dry-run: yes/no]"

results: ChainIngestResult[] = []

for each chain (sequential if concurrency=1, else Promise.allSettled batches):
  print "  [chain] Ingesting <name> (<pdfUrl>)..."
  try:
    response = await fetch(`${apiBaseUrl}/ingest/pdf-url`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
                 url:          chain.pdfUrl,
                 restaurantId: chain.restaurantId,
                 sourceId:     chain.sourceId,
                 dryRun:       dryRun,
               }),
    })
    body = await response.json()
    if response.ok:
      results.push({ chain, status: 'success', data: body.data })
      print "  [chain] OK — found: N, upserted: N, skipped: N"
    else:
      results.push({ chain, status: 'error', errorCode: body.error.code, errorMessage: body.error.message })
      print "  [chain] FAILED — <code>: <message>"
  catch (networkError):
    results.push({ chain, status: 'error', errorCode: 'NETWORK_ERROR', errorMessage: error.message })
    print "  [chain] FAILED — NETWORK_ERROR: <message>"

print summary footer (see section 9.5)

if any result.status === 'error': exit(1)
else: exit(0)
```

### 9.5 Summary report (stdout)

```
========================================
Batch Ingest Summary  [dry-run: no]
2026-03-16T12:34:56.789Z
========================================
  burger-king-es   SUCCESS   52 found, 50 upserted, 2 skipped
  kfc-es           SUCCESS   38 found, 38 upserted, 0 skipped
  telepizza-es     FAILED    FETCH_FAILED: Failed to download PDF: HTTP 404
  five-guys-es     SUCCESS   29 found, 29 upserted, 0 skipped
========================================
Total: 3 success, 1 failed
Exit code: 1
========================================
```

For dry-run mode, add `[DRY RUN — no DB writes]` to the header and label each SUCCESS line with `(dry-run)`.

### 9.6 `ChainIngestResult` type (internal to script)

```typescript
type ChainIngestResultSuccess = {
  chain:         ChainPdfConfig;
  status:        'success';
  dishesFound:   number;
  dishesUpserted: number;
  dishesSkipped: number;
  dryRun:        boolean;
};

type ChainIngestResultError = {
  chain:        ChainPdfConfig;
  status:       'error';
  errorCode:    string;
  errorMessage: string;
};

type ChainIngestResult = ChainIngestResultSuccess | ChainIngestResultError;
```

### 9.7 Concurrency (Phase 1: sequential only)

`--concurrency` defaults to 1. Phase 1 implementation only supports `concurrency=1`. The flag is parsed and validated (must be a positive integer) but any value > 1 in Phase 1 may either be accepted silently (processing sequentially) or logged as a warning. The parameter is forward-compatible with Phase 2 parallel execution via `Promise.allSettled` batching.

---

## 10. npm Script

```json
// packages/api/package.json — scripts section (addition)
"ingest:batch": "tsx src/scripts/batch-ingest.ts"
```

Usage from repo root:
```bash
npm run ingest:batch -w @foodxplorer/api
npm run ingest:batch -w @foodxplorer/api -- --dry-run
npm run ingest:batch -w @foodxplorer/api -- --chain kfc-es
npm run ingest:batch -w @foodxplorer/api -- --chain burger-king-es --dry-run
```

---

## 11. Error Handling

### 11.1 Per-chain error handling

| Scenario | Runner behaviour |
|----------|-----------------|
| API server not reachable | `NETWORK_ERROR` recorded; continue with next chain |
| `POST /ingest/pdf-url` returns 4xx | Error code + message recorded; continue with next chain |
| `POST /ingest/pdf-url` returns 5xx | Error code + message recorded; continue with next chain |
| `--chain <slug>` not found in registry | Print error + exit(1) immediately (no chains processed) |
| `--chain <slug>` found but `enabled: false` | Print warning + exit(0) immediately |
| All chains disabled | Print "No enabled chains found" + exit(0) |
| JSON parse error on API response body | Treat as `UNEXPECTED_RESPONSE` error; continue with next chain |

### 11.2 Exit codes

| Exit code | Meaning |
|-----------|---------|
| 0 | All processed chains succeeded (or no chains were run) |
| 1 | One or more chains failed |

### 11.3 No retry in Phase 1

The runner does NOT retry failed chains. BK's monthly URL rotation is the most likely failure cause — a stale URL requires a manual config update, not a retry. Retries are a Phase 2 concern.

---

## 12. Testing Strategy

### 12.1 Unit tests — `chain-pdf-registry.test.ts`

| Scenario | Expected |
|----------|----------|
| Each entry parses through `ChainPdfConfigSchema.parse()` | No Zod errors |
| No duplicate `chainSlug` values in the registry | Assertion passes |
| All `restaurantId` and `sourceId` values are valid UUIDs | `z.string().uuid()` passes |
| All `pdfUrl` values start with `https://` | Assertion passes |
| All enabled chains have non-empty `pdfUrl` | Assertion passes |
| `chainSlug` matches `^[a-z0-9-]+$` for all entries | Regex test passes |
| `CHAIN_SEED_IDS` constants match the `restaurantId`/`sourceId` in registry entries | Cross-reference assertion |

These tests run without any DB connection or network access — pure in-memory validation.

### 12.2 Integration tests — `batch-ingest.test.ts`

Uses Vitest `vi.stubGlobal('fetch', mockFetch)` to intercept HTTP calls. Does NOT start a real API server. The mock `fetch` validates the request structure and returns controlled responses.

| Scenario | Expected |
|----------|----------|
| All chains enabled + mock returns 200 for each | Exit code 0, all results `status: 'success'` |
| One chain returns 404 `NOT_FOUND` from mock | That chain `status: 'error'`, others succeed, exit code 1 |
| One chain throws network error (mock throws) | That chain `status: 'error'` with `NETWORK_ERROR`, others succeed, exit code 1 |
| `--chain kfc-es` flag → only KFC called | Exactly 1 fetch call to the API; correct `restaurantId` and `sourceId` in body |
| `--chain nonexistent` flag | No fetch calls, exit code 1 |
| `--dry-run` flag → `dryRun: true` in all request bodies | Mock verifies `dryRun === true` in parsed body |
| `--api-url http://staging.example.com` | fetch called with staging URL |
| All chains disabled (mock registry override) | exit code 0, "No enabled chains found" printed |
| Mock returns non-JSON body (malformed response) | Chain recorded as `UNEXPECTED_RESPONSE` error, exit code 1 |

**Mocking note:** The batch runner must export a `runBatch(config, options)` function that the test can call directly (passing a mock registry and mock fetch), rather than only exposing a CLI entry point. The `batch-ingest.ts` file's `main()` function is the thin CLI wrapper that calls `runBatch()`. This enables deterministic unit testing without spawning a subprocess.

### 12.3 Seed data tests

The existing seed integration test suite (if present) should verify that the 4 new restaurant + dataSource rows are created by `seed.ts` and that `chainSlug_countryCode` unique constraints are satisfied.

---

## 13. New Dependencies

No new npm packages. The batch runner uses:
- Node.js built-in `fetch` (available in Node.js 18+, already used in the project)
- Node.js built-in `process.argv`, `process.exit`, `process.env`
- `tsx` — already a dev dependency in `packages/api`
- `zod` — already a direct dependency
- `CHAIN_PDF_REGISTRY` from the new config file — same package, no new workspace deps

---

## 14. OpenAPI / API Spec Changes

None. F010 does not add any new API endpoints. `docs/specs/api-spec.yaml` is not modified.

---

## 15. Edge Cases

| Scenario | Expected behaviour |
|----------|-------------------|
| BK's PDF URL is stale (monthly rotation) | Runner records `FETCH_FAILED` for BK, continues with other chains. Manual URL update in registry required. |
| KFC URL returns 200 with `text/html` (redirect to login) | Endpoint returns `422 INVALID_PDF`. Runner records error. |
| Five Guys URL changes (new upload date in path) | Runner records `FETCH_FAILED`. URL must be updated manually in registry. `notes` field documents the URL pattern. |
| Telepizza CDN is down | Runner records `FETCH_FAILED`. No impact on other chains. |
| Two chains share the same `restaurantId` by mistake | `ChainPdfConfigSchema` validation passes (no cross-entry uniqueness rule). DB write would succeed (same restaurant, different dishes). Test in `chain-pdf-registry.test.ts` asserts no duplicate `restaurantId` values. |
| DB write fails for one dish in the transaction | Endpoint returns `500 DB_UNAVAILABLE`. Runner records full chain as failed. No partial dish writes (transaction semantics). |
| PDF parser extracts 0 dishes (parser gap for new format) | Endpoint returns `422 NO_NUTRITIONAL_DATA_FOUND`. Runner records error. F011 handles parser tuning. |
| `--concurrency 2` requested in Phase 1 | Implementation detail: either log a warning and run sequentially, or reject with usage error. Must be documented. |
| `ingest:batch` run without API server running | `NETWORK_ERROR` for every chain. Clear error message: "Connection refused — is the API server running?" |
| Seed run twice (re-seed dev DB) | All upserts are idempotent. No duplicate rows. |
| New chain added to registry but seed not run | `POST /ingest/pdf-url` returns `404 NOT_FOUND` for that chain's `restaurantId`. Runner records error. Clear failure mode — no silent data corruption. |

---

## 16. Acceptance Criteria

- [ ] `ChainPdfConfigSchema.parse()` succeeds for all 4 chain entries in `CHAIN_PDF_REGISTRY`
- [ ] No duplicate `chainSlug` or `restaurantId` values in the registry (enforced by test)
- [ ] `npm run db:seed -w @foodxplorer/api` creates restaurant + dataSource rows for BK, KFC, Telepizza, Five Guys with deterministic IDs
- [ ] Seed is idempotent — re-running produces no errors and no duplicate rows
- [ ] `npm run ingest:batch -w @foodxplorer/api -- --dry-run` runs successfully when API server is running (exit 0 if all chains reachable, exit 1 if any fail)
- [ ] `npm run ingest:batch -w @foodxplorer/api -- --chain kfc-es --dry-run` runs only KFC, not all chains
- [ ] `npm run ingest:batch -w @foodxplorer/api -- --chain nonexistent` exits with code 1 and prints an error
- [ ] Batch runner continues past a chain failure (does not stop mid-batch)
- [ ] Batch runner exits with code 1 if any chain failed
- [ ] Summary report printed to stdout after every run
- [ ] `--api-url` flag correctly overrides the base URL for all requests
- [ ] `runBatch()` exported function is unit-testable with mock fetch and mock registry
- [ ] All tests in `chain-pdf-registry.test.ts` and `batch-ingest.test.ts` pass
- [ ] `tsc --noEmit` passes with zero errors
- [ ] `vitest run` passes — all tests green
- [ ] TypeScript strict mode — no `any`, no `ts-ignore`
- [ ] `docs/specs/api-spec.yaml` is NOT modified (no new endpoints)

---

## 17. Out of Scope

- New API endpoints
- F011 parser verification per chain's real PDF
- URL discovery automation (e.g. scraping BK's site to find the current monthly PDF URL)
- Scheduled/cron execution
- Database `chain_configs` table
- Admin UI for chain management
- Domino's (F012), Subway Spain (F013), McDonald's (F008)
- Retry logic on transient failures
- Authentication headers for PDF downloads (all known PDFs are publicly accessible)
