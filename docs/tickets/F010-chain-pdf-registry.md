# F010 — Chain PDF Registry + Batch Runner

**Feature:** F010 | **Type:** Backend-Feature | **Priority:** High
**Status:** Done | **Step:** 6/6 (Complete)
**Branch:** feature/F010-chain-pdf-registry
**Created:** 2026-03-16
**Dependencies:** F009 complete (POST /ingest/pdf-url, pdfDownloader, ssrfGuard)

---

## Spec

### Description

F010 creates a config-driven registry mapping each PDF-only Spanish fast-food chain (BK, KFC, Telepizza, Five Guys) to its nutrition PDF URL, plus a CLI batch runner that iterates over enabled chains and calls the existing `POST /ingest/pdf-url` pipeline for each. No new API endpoints are introduced — this is entirely a CLI tool + config files + seed data.

The strategic driver is ADR-006 (PDF-first pivot): adding a new chain should require only a config entry, not new code. F010 is the "glue" layer that connects the PDF URL registry to the existing F009 ingestion pipeline.

Full spec: `docs/specs/F010-chain-pdf-registry-spec.md`

---

### Architecture Decisions

1. **CLI calls the API via HTTP** — the batch runner calls `POST /ingest/pdf-url` over HTTP (not by importing pipeline functions directly). The API server must be running. This preserves a single implementation and the runner inherits all route-level safety guarantees.

2. **Config as a static TypeScript array** — chain configs live in `packages/api/src/config/chains/chain-pdf-registry.ts` as a typed array. Not in a database table or JSON file. Compile-time type safety with no runtime overhead.

3. **Deterministic UUIDs in `chain-seed-ids.ts`** — each chain's `restaurantId` and `sourceId` are hardcoded constants, shared between `seed.ts` and the registry. Stable across environments. Follows existing seed.ts pattern (IDs starting at `...0010` to avoid collisions with existing `...0001`–`...0009` rows).

4. **Continue on chain failure** — a failed chain (stale BK URL, CDN down) does not abort the batch. All chains run; summary printed at the end. Exit code 1 if any chain failed.

5. **`runBatch()` exported function** — the CLI is a thin wrapper over an exported `runBatch(registry, options)` function. Enables deterministic unit testing with mock fetch and mock registry, without subprocess spawning.

---

### API Changes

None. `docs/specs/api-spec.yaml` is NOT modified.

---

### Data Model Changes

No schema migrations required. The `restaurants` and `data_sources` tables already exist. F010 only adds seed rows.

**New seed rows (appended to `packages/api/prisma/seed.ts`):**

| Type | Name | ID |
|------|------|----|
| DataSource | Burger King Spain — Nutritional PDF | `00000000-0000-0000-0000-000000000010` |
| Restaurant | Burger King Spain | `00000000-0000-0000-0006-000000000010` |
| DataSource | KFC Spain — Nutritional PDF | `00000000-0000-0000-0000-000000000011` |
| Restaurant | KFC Spain | `00000000-0000-0000-0006-000000000011` |
| DataSource | Telepizza Spain — Nutritional PDF | `00000000-0000-0000-0000-000000000012` |
| Restaurant | Telepizza Spain | `00000000-0000-0000-0006-000000000012` |
| DataSource | Five Guys Spain — Nutritional PDF | `00000000-0000-0000-0000-000000000013` |
| Restaurant | Five Guys Spain | `00000000-0000-0000-0006-000000000013` |

All upserts are idempotent.

---

### New Files

| Path | Purpose |
|------|---------|
| `packages/api/src/config/chains/chain-pdf-registry.ts` | `ChainPdfConfigSchema` (Zod), `ChainPdfConfig` type, `CHAIN_PDF_REGISTRY` array (4 entries) |
| `packages/api/src/config/chains/chain-seed-ids.ts` | `CHAIN_SEED_IDS` constant — deterministic UUID pairs per chain |
| `packages/api/src/scripts/batch-ingest.ts` | CLI entry point + exported `runBatch()` function |

| Path | Change |
|------|--------|
| `packages/api/prisma/seed.ts` | Append Phase 3 section — 8 new upserts (4 × restaurant + dataSource) |
| `packages/api/package.json` | Add `"ingest:batch": "tsx src/scripts/batch-ingest.ts"` npm script |

---

### `ChainPdfConfig` Schema

```
ChainPdfConfigSchema = z.object({
  chainSlug:       z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  name:            z.string().min(1).max(255),
  countryCode:     z.string().length(2).regex(/^[A-Z]{2}$/),
  pdfUrl:          z.string().url().max(2048),
  restaurantId:    z.string().uuid(),
  sourceId:        z.string().uuid(),
  updateFrequency: z.enum(['static', 'monthly', 'quarterly', 'yearly', 'unknown']),
  enabled:         z.boolean(),
  notes:           z.string().optional(),
})
```

---

### CLI Usage

```bash
# Run all enabled chains (dry-run)
npm run ingest:batch -w @foodxplorer/api -- --dry-run

# Run single chain
npm run ingest:batch -w @foodxplorer/api -- --chain kfc-es

# Run against staging
npm run ingest:batch -w @foodxplorer/api -- --api-url https://staging.foodxplorer.com
```

---

### Edge Cases

- **BK URL is monthly-rotating**: the URL in the registry is the last known URL (Feb 2026). The `notes` field documents the URL pattern. If the URL is stale, the runner records `FETCH_FAILED` for BK and continues. Manual update required.
- **API server not running**: all chains fail with `NETWORK_ERROR`. Clear message: "Connection refused — is the API server running?"
- **New chain added to registry but seed not run**: runner gets `404 NOT_FOUND` from endpoint — clear failure, no silent data corruption.
- **Seed run twice**: all upserts are idempotent — no errors, no duplicate rows.
- **PDF parser extracts 0 dishes**: endpoint returns `422 NO_NUTRITIONAL_DATA_FOUND`. F011 handles parser tuning.

---

## Notes

- The 4 known PDF URLs (from ADR-006) may be stale by implementation time. BK's URL in particular changes monthly. The planner must add a pre-implementation step to verify all 4 URLs are live before writing any code.
- F011 (parser tuning per chain's real PDF) is a separate ticket and must follow F010.
- The `--concurrency` flag is parsed but Phase 1 implementation is sequential only (concurrency=1).
- No retry logic in Phase 1 — stale URLs require a manual registry update.

---

## Implementation Plan

### Existing Code to Reuse

- `packages/api/src/config.ts` — pattern for Zod-validated config with exported types; the same `z.object()` + `z.infer<>` pattern applies to `ChainPdfConfigSchema`
- `packages/api/src/lib/pdfDownloader.ts` — DI pattern (`fetchImpl` parameter) is the reference model for injecting a mock `fetch` into `runBatch()`
- `packages/api/prisma/seed.ts` — `seedPhase2(client)` exported-function pattern; Phase 3 must follow the same `export async function seedPhase3(client: PrismaClient)` shape so integration tests can call it directly
- `packages/api/src/__tests__/lib/pdfDownloader.test.ts` — `vi.fn().mockResolvedValue(...)` mock-fetch pattern to use in batch-ingest tests
- `packages/api/src/__tests__/config.test.ts` — Vitest `describe/it/expect` structure without DB; use same file layout for `chain-pdf-registry.test.ts`
- `packages/api/src/__tests__/f006.seed.integration.test.ts` — `beforeAll` + `afterAll` in reverse-FK order, direct function import (no subprocess), `DATABASE_URL_TEST` env var; use same pattern for `seed.phase3.integration.test.ts`
- `packages/api/src/routes/ingest/pdf-url.ts` — documents the exact JSON request body shape (`{ url, restaurantId, sourceId, dryRun }`) and the success response shape (`{ success: true, data: { dishesFound, dishesUpserted, dishesSkipped, dryRun, sourceUrl, dishes, skippedReasons } }`) that `runBatch()` must parse

---

### Files to Create

| Path | Purpose |
|------|---------|
| `packages/api/src/config/chains/chain-seed-ids.ts` | `CHAIN_SEED_IDS` constant — deterministic UUID pairs for all 4 chains. Used by both `seed.ts` and `chain-pdf-registry.ts`. Created first because both other files depend on it. |
| `packages/api/src/config/chains/chain-pdf-registry.ts` | `ChainPdfConfigSchema` (Zod), `ChainPdfConfig` type (inferred), `CHAIN_PDF_REGISTRY` array with 4 entries (BK, KFC, Telepizza, Five Guys). Imports `CHAIN_SEED_IDS` from `chain-seed-ids.js`. |
| `packages/api/src/scripts/batch-ingest.ts` | Exported `runBatch(registry, options, fetchImpl)` function + thin `main()` CLI wrapper. `main()` is the only function that calls `process.argv`, `process.exit`, and `process.env`. |
| `packages/api/src/__tests__/config/chains/chain-pdf-registry.test.ts` | Pure in-memory unit tests — validates all 4 registry entries through `ChainPdfConfigSchema`, asserts no duplicate slugs/IDs, cross-references `CHAIN_SEED_IDS`. No DB, no network. |
| `packages/api/src/__tests__/scripts/batch-ingest.test.ts` | Integration tests for `runBatch()` — mock `fetch` via `vi.fn()`, no real API server, no DB. Tests all scenarios from spec §12.2. |
| `packages/api/src/__tests__/seed.phase3.integration.test.ts` | Integration test that calls `seedPhase3(prisma)` directly against `DATABASE_URL_TEST`, verifying the 8 rows are created with correct IDs and the upsert is idempotent. |

---

### Files to Modify

| Path | Change |
|------|--------|
| `packages/api/prisma/seed.ts` | Add `import { CHAIN_SEED_IDS } from '../src/config/chains/chain-seed-ids.js'`. Append `export async function seedPhase3(client: PrismaClient): Promise<void>` block with 8 upserts (4 × `dataSource` + 4 × `restaurant`). Call `await seedPhase3(prisma)` at the end of `main()` after the Phase 2 call. |
| `packages/api/package.json` | Add `"ingest:batch": "tsx src/scripts/batch-ingest.ts"` to the `scripts` section. |

---

### Implementation Order

Follow TDD: write the failing test first, then implement.

**Step 1 — Foundation: seed ID constants**
- Create `packages/api/src/config/chains/chain-seed-ids.ts` with the `CHAIN_SEED_IDS` constant exactly as specified in spec §7.
- No tests for this file directly — correctness is verified by cross-reference assertions in `chain-pdf-registry.test.ts`.

**Step 2 — Config registry (TDD)**
- Write `packages/api/src/__tests__/config/chains/chain-pdf-registry.test.ts` first (all tests will fail: file does not exist yet).
  - Test: each entry parses through `ChainPdfConfigSchema.parse()` without errors
  - Test: no duplicate `chainSlug` values
  - Test: no duplicate `restaurantId` values
  - Test: no duplicate `sourceId` values
  - Test: all `pdfUrl` values start with `https://`
  - Test: `chainSlug` matches `^[a-z0-9-]+$` for all entries
  - Test: all `restaurantId` values match `CHAIN_SEED_IDS[chain].RESTAURANT_ID`
  - Test: all `sourceId` values match `CHAIN_SEED_IDS[chain].SOURCE_ID`
  - Test: `countryCode` is `'ES'` for all 4 initial entries
- Implement `packages/api/src/config/chains/chain-pdf-registry.ts` with `ChainPdfConfigSchema`, `ChainPdfConfig` type, and `CHAIN_PDF_REGISTRY` array (4 entries from spec §6).
- Run tests — all must pass.

**Step 3 — Seed data (TDD)**
- Write `packages/api/src/__tests__/seed.phase3.integration.test.ts` first:
  - `beforeAll`: clean any existing rows matching Phase 3 IDs in reverse-FK order (dishes referencing these restaurants → restaurant rows → dataSource rows), then call `seedPhase3(prisma)`
  - `afterAll`: same cleanup + `prisma.$disconnect()`
  - Test: BK `dataSource` row exists with correct `id`, `name`, `type: 'scraped'`
  - Test: BK `restaurant` row exists with correct `id`, `chainSlug: 'burger-king-es'`, `countryCode: 'ES'`
  - Repeat existence checks for KFC, Telepizza, Five Guys
  - Test: second `seedPhase3(prisma)` call completes without error (idempotency)
  - Test: row count for Phase 3 IDs is exactly 4 `dataSource` + 4 `restaurant` rows after two calls
- Modify `packages/api/prisma/seed.ts`:
  - Add import for `CHAIN_SEED_IDS` at the top (use `.js` extension: `'../src/config/chains/chain-seed-ids.js'`)
  - Append `export async function seedPhase3(client: PrismaClient): Promise<void>` with 8 upserts (dataSource before restaurant for each chain, matching exactly spec §8.2)
  - Add `await seedPhase3(prisma)` call in `main()` after the Phase 2 call, with `console.log` before and after matching the existing Phase 2 pattern
- Run integration test — all must pass.

**Step 4 — Batch runner core function (TDD)**
- Write `packages/api/src/__tests__/scripts/batch-ingest.test.ts` first (import from `../../scripts/batch-ingest.js` — will fail until file exists):
  - Mock fetch via `vi.fn()` — return controlled `{ ok, status, json() }` objects (no `ReadableStream` needed, only `response.json()` is called by the runner)
  - Test (happy path): `runBatch(CHAIN_PDF_REGISTRY, { dryRun: false, apiBaseUrl: 'http://localhost:3001', concurrency: 1 }, mockFetch)` with all 4 chains returning `200` → returns array with 4 `status: 'success'` results
  - Test: one chain returns `{ ok: false, status: 404 }` with error body → that chain is `status: 'error'` with `errorCode: 'NOT_FOUND'`, others are `'success'`
  - Test: one chain mock throws a network error (`mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))`) → that chain is `status: 'error'` with `errorCode: 'NETWORK_ERROR'`
  - Test: `--chain kfc-es` — pass `{ chainSlug: 'kfc-es' }` option → exactly 1 fetch call; request body contains `CHAIN_SEED_IDS.KFC_ES.RESTAURANT_ID` and `CHAIN_SEED_IDS.KFC_ES.SOURCE_ID`
  - Test: `dryRun: true` → all request bodies have `dryRun: true`; mock verifies via `JSON.parse(capturedBody)`
  - Test: `apiBaseUrl: 'http://staging.example.com'` → all fetch calls use staging URL
  - Test: `chainSlug: 'nonexistent'` → function throws or returns an empty result that the CLI maps to exit(1)
  - Test: all chains have `enabled: false` (pass overridden mock registry) → returns empty results array, no fetch calls
  - Test: mock returns non-JSON body (`mockFetch` resolves but `response.json()` rejects) → chain recorded as `UNEXPECTED_RESPONSE` error
- Implement `packages/api/src/scripts/batch-ingest.ts`:
  - Define `ChainIngestResult` discriminated union type (spec §9.6) — internal to module, not exported
  - Define `RunBatchOptions` interface: `{ chainSlug?: string; dryRun: boolean; apiBaseUrl: string; concurrency: number }`
  - Export `runBatch(registry: ChainPdfConfig[], options: RunBatchOptions, fetchImpl?: typeof fetch): Promise<ChainIngestResult[]>` — Phase 1 implementation is fully sequential regardless of `concurrency` value; if `concurrency > 1`, log a warning `'[warn] concurrency > 1 not yet supported in Phase 1 — running sequentially'`
  - Chain selection logic: if `chainSlug` provided, find entry; if not found, throw `Error` with message `'Chain not found in registry: <slug>'`; if found but `enabled: false`, return `[]` immediately; otherwise filter `registry` by `enabled: true`
  - Per-chain fetch: `POST ${apiBaseUrl}/ingest/pdf-url` with JSON body `{ url, restaurantId, sourceId, dryRun }`; on `response.ok` parse `body.data` for `dishesFound/dishesUpserted/dishesSkipped`; on error parse `body.error.code` and `body.error.message`; catch network errors and JSON parse errors
  - Print per-chain status line to `process.stdout` (use `console.log` for simplicity)
  - Return the results array — do NOT call `process.exit()` inside `runBatch()`
  - Define unexported `parseCliArgs(argv: string[])` that parses `--chain`, `--dry-run`, `--api-url`, `--concurrency` flags; `apiBaseUrl` precedence: `--api-url` > `process.env['API_BASE_URL']` > `'http://localhost:3001'`
  - Define unexported `printSummary(results: ChainIngestResult[], dryRun: boolean)` that outputs the report format from spec §9.5
  - Define unexported `async function main(): Promise<void>` that: calls `parseCliArgs`, calls `runBatch` (using global `fetch`), calls `printSummary`, then `process.exit(results.some(r => r.status === 'error') ? 1 : 0)` — handle the `'Chain not found'` error from `runBatch` by printing the message and calling `process.exit(1)`
  - Bottom of file: `main().catch((err: unknown) => { console.error(err); process.exit(1); })`
- Run tests — all must pass.

**Step 5 — npm script**
- Modify `packages/api/package.json`: add `"ingest:batch": "tsx src/scripts/batch-ingest.ts"` to the `scripts` object, after the `db:studio` entry.

**Step 6 — TypeScript check**
- Run `npm run typecheck -w @foodxplorer/api` — must pass with zero errors.
- Confirm no `any` types and no `ts-ignore` comments were introduced.

---

### Testing Strategy

**Test files to create:**

1. `packages/api/src/__tests__/config/chains/chain-pdf-registry.test.ts` — pure unit test, no DB, no network
2. `packages/api/src/__tests__/scripts/batch-ingest.test.ts` — unit test with mock fetch, no DB, no network
3. `packages/api/src/__tests__/seed.phase3.integration.test.ts` — integration test against `DATABASE_URL_TEST`

**Key test scenarios:**

- Happy path: all 4 chains succeed → results array length 4, all `status: 'success'`, exit code 0
- One chain fails (4xx response) → 3 success + 1 error, continue-on-failure, exit code 1
- Network error on one chain → `NETWORK_ERROR` recorded, other chains continue
- Single-chain filter via `chainSlug` option → exactly 1 HTTP call, correct IDs in body
- `dryRun: true` → `dryRun: true` in every request body
- Custom `apiBaseUrl` → all fetch calls target the custom URL
- Unknown `chainSlug` → throws immediately, no fetch calls made
- All chains disabled → returns `[]`, no fetch calls, no error exit
- Malformed JSON response → `UNEXPECTED_RESPONSE` error code
- Seed idempotency: `seedPhase3` called twice → no errors, same 8 rows

**Mocking strategy:**

- `batch-ingest.test.ts`: inject `mockFetch = vi.fn()` as the third argument to `runBatch()`. Do NOT use `vi.stubGlobal('fetch', ...)` — prefer the DI pattern already established by `pdfDownloader.ts`. Each test configures `mockFetch` return values per-chain using `mockResolvedValueOnce` or implementation callbacks.
- `chain-pdf-registry.test.ts`: no mocks needed — pure Zod + in-memory assertions.
- `seed.phase3.integration.test.ts`: real PrismaClient against `DATABASE_URL_TEST`. No HTTP mocks.

---

### Key Patterns

**TypeScript imports with `.js` extension:** All imports between TypeScript files in this project use `.js` extensions (e.g. `import { CHAIN_SEED_IDS } from './chain-seed-ids.js'`). The `tsconfig.json` `module: Node16` setting requires this. Reference: any existing import in `packages/api/src/`.

**Seed file import path:** `seed.ts` lives in `packages/api/prisma/`, so importing from `src/config/chains/chain-seed-ids.ts` requires path `'../src/config/chains/chain-seed-ids.js'`.

**No `rootDir` constraint on prisma/:** `tsconfig.json` sets `rootDir: './src'` and `include: ['src/**/*']`. The `seed.ts` file is compiled by `tsx` at runtime (not by `tsc`), so adding the import there does not break `tsc --noEmit`. The test file that imports `seedPhase3` already follows this pattern (`f006.seed.integration.test.ts` line 9).

**Exported seed phase function:** `seedPhase3` must match the `seedPhase2` signature exactly — `export async function seedPhase3(client: PrismaClient): Promise<void>`. This enables integration tests to call it directly without a subprocess.

**`runBatch` return value vs exit code:** `runBatch()` returns the results array and never calls `process.exit()`. The exit code decision lives exclusively in `main()`. This separation is what makes `runBatch()` testable without subprocess spawning or mocking `process.exit`.

**Mock fetch response shape:** The batch runner only calls `response.ok`, `response.status`, and `response.json()` — not `response.body` or streaming. Mock responses in tests only need to implement those three properties (simpler than the `pdfDownloader` mock which needs a `ReadableStream`).

**`concurrency > 1` in Phase 1:** Implementation must accept the flag, log a warning, and run sequentially. Do not throw or exit — this ensures the flag can be introduced in Phase 2 without a breaking change to scripts that pass it.

**BK URL note:** The BK PDF URL in `CHAIN_PDF_REGISTRY` (`FEB2026`) may be stale by implementation time. The implementation must use it as-is (the spec documents the URL pattern in the `notes` field). No URL verification is part of F010 scope — F011 handles parser verification against real PDFs.

---

## Acceptance Criteria

- [x] `ChainPdfConfigSchema.parse()` succeeds for all 4 chain entries in `CHAIN_PDF_REGISTRY`
- [x] No duplicate `chainSlug` or `restaurantId` values in the registry (enforced by test)
- [x] `npm run db:seed -w @foodxplorer/api` creates restaurant + dataSource rows for BK, KFC, Telepizza, Five Guys with deterministic IDs
- [x] Seed is idempotent — re-running produces no errors and no duplicate rows
- [x] `runBatch()` exported function is unit-testable with mock fetch and mock registry
- [x] Batch runner continues past a chain failure (does not stop mid-batch)
- [x] Batch runner exits with code 1 if any chain failed, 0 if all succeed
- [x] `--chain <slug>` flag filters to a single chain
- [x] `--chain nonexistent` exits with code 1
- [x] `--dry-run` flag passes `dryRun: true` to all API requests
- [x] `--api-url` flag overrides the base URL
- [x] Summary report printed to stdout after every run
- [x] All tests pass — 819 API tests (38 files), 232 scraper tests (8 files) = 1051 total
- [x] `tsc --noEmit` passes with zero errors
- [x] TypeScript strict mode — no `any`, no `ts-ignore`
- [x] `docs/specs/api-spec.yaml` is NOT modified

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing (17 registry + 13 batch runner + 40 edge cases = 70 unit tests)
- [x] Integration tests written and passing (10 seed tests)
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds
- [x] Specs reflect final implementation
- [x] key_facts.md updated with new components

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` executed, plan approved
- [x] Step 3: `backend-developer` executed with TDD
- [x] Step 4: `production-code-validator` executed, quality gates pass
- [x] Step 5: `code-review-specialist` executed
- [x] Step 5: `qa-engineer` executed (Standard)
- [x] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-16 | Step 0: Spec created | `docs/specs/F010-chain-pdf-registry-spec.md` |
| 2026-03-16 | Step 1: Setup | Branch `feature/F010-chain-pdf-registry`, ticket created |
| 2026-03-16 | Step 2: Plan approved | 6-step implementation plan |
| 2026-03-16 | Step 3: Implementation | 5 commits: seed IDs, registry, seed Phase 3, batch runner, npm script |
| 2026-03-16 | Step 4: Finalize | production-code-validator: READY. 770 API + 232 scraper = 1002 tests |
| 2026-03-16 | Code review | Accepted: H1 (null-safety), H2 (unknown flags), M1 (export types), M2 (instanceof), M3 (concurrency warn). All fixed |
| 2026-03-16 | QA review | 40 edge-case tests added. Fixed: trailing-slash URL, null-safety (3 HIGH), https enforcement (MEDIUM), max(2048) order (LOW). Total: 819 API tests |

---

*Ticket created: 2026-03-16*
