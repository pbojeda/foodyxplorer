# F006: Seed Script — USDA/FEN Base Foods

**Feature:** F006 | **Type:** Backend-Feature | **Priority:** High
**Status:** Done | **Branch:** (deleted)
**Created:** 2026-03-12 | **Dependencies:** F001, F001b (schema must exist)

---

## Spec

### Overview

Extends the existing seed script (`packages/api/prisma/seed.ts`) with a second seeding phase that inserts at least 500 generic base foods and their corresponding `FoodNutrient` records (per 100g) into the database. The data originates from the USDA FoodData Central SR Legacy bulk download — a freely available, stable, offline-usable JSON dataset — curated and bundled directly in the repository as a static JSON file. Spanish names (`nameEs`) are sourced from a manually curated translation map, also bundled as a static JSON file.

The existing seed logic (cooking methods, dish categories, restaurants, dishes, the 3 base foods, and the 1 recipe) is not modified. The 500+ base foods are appended as a distinct, clearly labelled phase within the same script.

### Data Source Strategy

**Primary source: USDA FoodData Central — SR Legacy dataset**

- Dataset: `FoodData_Central_sr_legacy_food_json_2021-10-28.zip` (SR Legacy, ~12 MB compressed)
- Format: Official USDA JSON. Free, no API key required for bulk download.
- Legal status: Public domain (USDA is a US government agency).
- Reason for choosing SR Legacy: ~7,700 entries, stable (no frequent updates), complete macronutrient coverage for common foods, well-documented nutrient IDs.

**Secondary reference: FEN PDF (Spanish)**

- Use: Cross-reference for Spanish food names (`nameEs`) and portions typical in Spain. Not used for nutrient values.
- Not processed programmatically. Values extracted manually and stored in the curated translation map.

**DataSource record for USDA SR Legacy:**

| Field | Value |
|---|---|
| id | `00000000-0000-0000-0000-000000000002` |
| name | `USDA SR Legacy` |
| type | `official` |
| url | `https://fdc.nal.usda.gov/download-foods.html` |
| lastUpdated | `2021-10-28` |

The existing `DataSource` (`00000000-0000-0000-0000-000000000001`, `USDA FoodData Central`) is left unchanged.

### Seed Data Format

Two static JSON files bundled under `packages/api/prisma/seed-data/`:

**File 1: `usda-sr-legacy-foods.json`** — Curated subset of USDA SR Legacy (~550 records)

```jsonc
{
  "fdcId": 171077,
  "description": "Chicken breast, raw",
  "foodGroup": "Poultry Products",
  "nutrients": {
    "calories": 120.0,
    "proteins": 22.5,
    "carbohydrates": 0.0,
    "sugars": 0.0,
    "fats": 2.62,
    "saturatedFats": 0.68,
    "fiber": 0.0,
    "sodium": 0.065,
    "salt": 0.165,
    "transFats": 0.0,
    "cholesterol": 0.055,
    "potassium": 0.256,
    "monounsaturatedFats": 0.98,
    "polyunsaturatedFats": 0.57
  }
}
```

Unit normalisation (applied at extraction time): all values per 100g in grams. Salt = sodium × 2.54. Cholesterol converted from mg to g (÷ 1000).

**File 2: `name-es-map.json`** — FDC ID → Spanish name translation map

```jsonc
{
  "171077": "Pechuga de pollo, cruda",
  "168878": "Arroz blanco cocido"
}
```

Must cover all `fdcId` values in the foods file. Missing entries = blocking validation error.

### Script Design

- Execution: `npm run db:seed -w @foodxplorer/api` (existing command, unchanged)
- Phase 2 appended after existing seed content with clear comment delimiters
- Pre-write validation: check all fdcIds have Spanish names, check for duplicate fdcIds
- Upsert on `Food` via `externalId_sourceId` unique constraint
- Upsert on `FoodNutrient` via `foodId_sourceId` unique constraint
- Batch size: 50 foods per transaction
- Two transactions per batch: one for Foods, one for FoodNutrients
- Embeddings: zero-vector via `prisma.$executeRaw` (same as existing seed)
- Group-level `StandardPortion` rows (~14) for each unique foodGroup
- Partial failure: retry batch once, skip on second failure, exit code 1 at end

### Food Selection & Coverage

- Min 500 foods, target ~550
- USDA food groups included: all except Baby Foods, Meals/Entrees/Side Dishes, Fast Foods, Restaurant Foods
- Completeness: must have all 9 core nutrients (excluding extended which default to 0)
- Raw-state preference for foods with multiple preparation states
- Distribution: no single group > 25% of total, min 10 per group
- `externalId` format: `USDA-SR-{fdcId}` (distinct from existing `USDA-{fdcId}`)
- `confidenceLevel`: `high` for all (official source)
- `foodType`: `generic` for all
- `aliases`: empty array `[]` for all

### Standard Portions

Only group-level portions seeded (~14 rows). Per-food portions deferred to later features.

| foodGroup | context | portionGrams | description |
|---|---|---|---|
| Vegetables | side_dish | 80 | Standard vegetable side portion (80g) |
| Fruits | snack | 120 | Standard fruit portion (120g) |
| Meat | main_course | 150 | Standard meat main course portion (150g) |
| Poultry | main_course | 150 | Standard poultry main course portion (150g) |
| Fish | main_course | 150 | Standard fish main course portion (150g) |
| Dairy | snack | 125 | Standard dairy portion (125g) |
| Eggs | main_course | 55 | Standard egg portion (55g, ~1 large egg) |
| Legumes | side_dish | 80 | Standard legume side portion (80g) |
| Cereals | side_dish | 75 | Standard cereal side portion (75g, dry) |
| Nuts | snack | 30 | Standard nut snack portion (30g) |
| Fats and oils | snack | 10 | Standard fat/oil portion (10g) |
| Sweets | dessert | 50 | Standard sweet dessert portion (50g) |
| Snacks | snack | 30 | Standard snack portion (30g) |
| Beverages | snack | 200 | Standard beverage portion (200ml) |

### Edge Cases & Error Handling

| Scenario | Behaviour |
|---|---|
| Re-run with unchanged data | Upserts update with identical values. No duplicates. |
| Re-run with corrected values | Update block overwrites. Corrections propagate. |
| Missing Spanish name | Seed exits code 1 before any DB write, logs missing IDs. |
| Duplicate fdcId in JSON | Pre-write validation exits code 1. |
| Calories > 900 per 100g | Log warning (likely data error). Prisma does not enforce Zod max. |
| Partial batch failure | Retry once, skip on second failure, exit code 1 at end. |
| externalId collision with existing foods | Impossible: different prefix (`USDA-SR-` vs `USDA-`) and different sourceId. |
| Database not running | PrismaClient error propagates to existing `main().catch()`. |

### API Changes

None. Seed script only.

### Config Changes

None. Uses existing `DATABASE_URL` from `process.env`.

### Out of Scope

- Extraction tooling (one-off script to produce `usda-sr-legacy-foods.json` from raw USDA ZIP)
- FEN nutrient data parsing (deferred to F007b)
- Per-food StandardPortion rows (deferred to later features)
- Embedding generation (deferred to F019)
- Branded or composite foods (deferred to E002 scrapers)
- Data quality cross-validation against FEN (deferred to F018)

---

## Implementation Plan

### Existing Code to Reuse

- `packages/api/prisma/seed.ts` — Phase 2 is appended after the existing content; no existing logic is modified
- `ZERO_VECTOR` constant already defined in seed.ts — reuse directly in Phase 2
- `prisma.$executeRaw` pattern for embedding writes — already used 4 times in seed.ts; repeat for SR Legacy foods
- `packages/shared/src/schemas/foodNutrient.ts` — `FoodNutrientSchema` (calorie max 900, all fields nonnegative) used in validation helper
- `packages/shared/src/schemas/food.ts` — `FoodSchema`/`CreateFoodSchema` for type reference
- Prisma `@@unique([externalId, sourceId])` on `Food` and `@@unique([foodId, sourceId])` on `FoodNutrient` — upsert targets
- `DATABASE_URL_TEST` env var and PrismaClient override pattern (from integration test files) — reused in seed integration test

---

### I-1: Data Preparation — Curate `usda-sr-legacy-foods.json`

**Files:**
- `packages/api/prisma/seed-data/usda-sr-legacy-foods.json` (create)
- `packages/api/prisma/seed-data/name-es-map.json` (create)

**Description:**

This step is manual data work, not code. The developer downloads `FoodData_Central_sr_legacy_food_json_2021-10-28.zip` from `https://fdc.nal.usda.gov/download-foods.html`, processes it, and produces the two static JSON files.

**`usda-sr-legacy-foods.json`** — array of objects with exactly this shape:
```
{
  "fdcId": number,         // USDA FDC ID (integer, unique within this file)
  "description": string,   // USDA English food description
  "foodGroup": string,     // USDA food group (mapped to project foodGroup strings)
  "nutrients": {
    "calories": number,         // kcal per 100g
    "proteins": number,         // g per 100g
    "carbohydrates": number,    // g per 100g
    "sugars": number,           // g per 100g
    "fats": number,             // g per 100g
    "saturatedFats": number,    // g per 100g
    "fiber": number,            // g per 100g
    "sodium": number,           // g per 100g (converted from mg: ÷1000)
    "salt": number,             // g per 100g (= sodium × 2.54)
    "transFats": number,        // g per 100g (default 0 if absent)
    "cholesterol": number,      // g per 100g (converted from mg: ÷1000)
    "potassium": number,        // g per 100g (converted from mg: ÷1000)
    "monounsaturatedFats": number,  // g per 100g
    "polyunsaturatedFats": number   // g per 100g
  }
}
```

Selection rules (apply at extraction time):
- Include food groups: all except "Baby Foods", "Meals, Entrees, and Side Dishes", "Fast Foods", "Restaurant Foods"
- Must have all 9 core nutrients present (calories, proteins, carbohydrates, sugars, fats, saturatedFats, fiber, sodium, salt); extended nutrients default to 0 if absent
- Prefer raw/uncooked state when multiple preparations exist for the same food
- No single food group may exceed 25% of total; each included group must have at least 10 entries
- Target ~550 entries (minimum 500)

USDA nutrient IDs to extract (SR Legacy):
- 1008 → calories (kcal)
- 1003 → proteins (g)
- 1005 → carbohydrates (g)
- 2000 → sugars (g)
- 1004 → fats (g)
- 1258 → saturatedFats (g)
- 1079 → fiber (g)
- 1093 → sodium (mg → ÷1000 → g)
- 1257 → transFats (g)
- 1253 → cholesterol (mg → ÷1000 → g)
- 1092 → potassium (mg → ÷1000 → g)
- 1292 → monounsaturatedFats (g)
- 1293 → polyunsaturatedFats (g)
- salt = sodium × 2.54

**`name-es-map.json`** — flat object mapping every `fdcId` (as string key) to its Spanish name:
```
{ "171077": "Pechuga de pollo, cruda", ... }
```
- Must cover every `fdcId` present in `usda-sr-legacy-foods.json`
- Spanish names sourced manually from FEN PDF cross-reference and general translation
- File size: ~550 entries, all non-empty strings

**Tests:** None for this step — the data files are validated programmatically in I-3.

---

### I-2: Type Definitions for JSON Data

**Files:**
- `packages/api/prisma/seed-data/types.ts` (create)

**Description:**

Create a dedicated TypeScript types file (not a `.d.ts` — use a plain `.ts` importable by `tsx`) for the JSON structures consumed by the seed script. This avoids `any` and satisfies `noUncheckedIndexedAccess`.

Define the following types:
```typescript
// Shape of each entry in usda-sr-legacy-foods.json
export interface UsdaSrLegacyFoodEntry {
  fdcId: number;
  description: string;
  foodGroup: string;
  nutrients: {
    calories: number;
    proteins: number;
    carbohydrates: number;
    sugars: number;
    fats: number;
    saturatedFats: number;
    fiber: number;
    sodium: number;
    salt: number;
    transFats: number;
    cholesterol: number;
    potassium: number;
    monounsaturatedFats: number;
    polyunsaturatedFats: number;
  };
}

// Shape of name-es-map.json
export type NameEsMap = Record<string, string>;
```

Note: `resolveJsonModule: true` is set in `tsconfig.base.json`, so JSON files can be imported with `import foodsData from './usda-sr-legacy-foods.json' assert { type: 'json' }` in Node16 module resolution. However, since the seed script uses `tsx` (not compiled TS), prefer `fs.readFileSync` + `JSON.parse` with a cast to `UsdaSrLegacyFoodEntry[]` for clarity and to avoid Node.js import assertion compatibility concerns at runtime.

**Tests:** None — pure type definitions. Validated indirectly via TypeScript compilation.

---

### I-3: Validation Helper Module

**Files:**
- `packages/api/prisma/seed-data/validateSeedData.ts` (create)

**Description:**

Pure functions with no DB dependency — the primary target for unit tests. This module is imported by the seed script and called before any DB writes.

Implement and export:

**`validateSeedData(foods: UsdaSrLegacyFoodEntry[], nameEsMap: NameEsMap): ValidationResult`**

Where `ValidationResult` is:
```typescript
export interface ValidationResult {
  valid: boolean;
  errors: string[];   // human-readable error messages
}
```

The function checks:
1. **Duplicate fdcIds** — collect all `fdcId` values; if `Set.size < array.length`, report which IDs are duplicated
2. **Missing Spanish names** — for every entry, check `nameEsMap[String(entry.fdcId)]` is defined and non-empty; collect all missing IDs
3. **Minimum count** — report error if `foods.length < 500`
4. **Calorie range warning** — for each entry where `nutrients.calories > 900`, emit a warning string (not a blocking error) prefixed with `[WARN]`
5. **Required nutrient fields** — for each entry, verify all 9 core nutrient fields are present (not `undefined`) in `nutrients`; report missing per-entry

The function collects all errors into the `errors` array before returning — it does not throw. The seed script calls this and exits code 1 if `!result.valid`, logging all `result.errors`.

**`buildExternalId(fdcId: number): string`**
Returns `USDA-SR-${fdcId}`. Exported for use in seed script and tests.

**`computeSalt(sodiumGrams: number): number`**
Returns `sodium * 2.54`. Exported for use in tests. (In practice the curated JSON already has `salt` pre-computed; this is a utility for data preparation and verification.)

**Tests:** See I-5.

---

### I-4: Seed Script Extension — Phase 2

**Files:**
- `packages/api/prisma/seed.ts` (modify — append Phase 2 section only)

**Description:**

Append a clearly delimited Phase 2 block after the final `console.log('Seeding complete.')` line and before the `main().catch(...)` call. Restructure: move `main().catch(...)` to after the new content.

The Phase 2 section implements the following within `main()`:

**Step A — Load data files**
```
Read usda-sr-legacy-foods.json via fs.readFileSync (path relative to seed.ts using import.meta.url + path.dirname)
Read name-es-map.json the same way
Parse both as JSON; cast to UsdaSrLegacyFoodEntry[] and NameEsMap
```

Use `import.meta.url` with `new URL('../seed-data/usda-sr-legacy-foods.json', import.meta.url).pathname` to get an absolute path that works regardless of cwd. This is the correct approach with `module: "Node16"` and `tsx`.

**Step B — Pre-write validation**
```
Call validateSeedData(foods, nameEsMap)
If !result.valid: log each error, process.exit(1)
Log [WARN] lines for calories > 900
```

**Step C — Upsert SR Legacy DataSource**
```
prisma.dataSource.upsert({
  where: { id: '00000000-0000-0000-0000-000000000002' },
  update: {},
  create: {
    id: '00000000-0000-0000-0000-000000000002',
    name: 'USDA SR Legacy',
    type: 'official',
    url: 'https://fdc.nal.usda.gov/download-foods.html',
    lastUpdated: new Date('2021-10-28'),
  },
})
```

**Step D — Upsert group-level StandardPortions (14 rows)**

Use `prisma.standardPortion.upsert` with `where: { id: <fixed-uuid> }` for each of the 14 food-group portions defined in the spec. Assign fixed UUIDs using namespace `0009`:
- `00000000-0000-0000-0009-000000000001` through `00000000-0000-0000-0009-000000000014`

Each row: `foodId: null`, `foodGroup: <group>`, `context: <context>`, `portionGrams: <grams>`, `sourceId: srLegacySourceId`, `confidenceLevel: 'high'`, `description: <description from spec>`, `isDefault: false`.

**Step E — Batch processing loop (50 foods per batch)**

```
Split foods array into chunks of 50
For each chunk:
  Try:
    Transaction 1 — Foods:
      For each food in chunk: prisma.food.upsert({
        where: { externalId_sourceId: { externalId: buildExternalId(fdcId), sourceId: srLegacySourceId } },
        update: { name, nameEs, foodGroup, aliases: [] },
        create: {
          name: food.description,
          nameEs: nameEsMap[String(food.fdcId)],
          aliases: [],
          foodGroup: food.foodGroup,
          sourceId: srLegacySourceId,
          externalId: buildExternalId(food.fdcId),
          confidenceLevel: 'high',
          foodType: 'generic',
        }
      })
      Collect returned food records (id → fdcId mapping)

    For each inserted/upserted food: prisma.$executeRaw for zero-vector embedding

    Transaction 2 — FoodNutrients:
      For each food in chunk: prisma.foodNutrient.upsert({
        where: { foodId_sourceId: { foodId: food.id, sourceId: srLegacySourceId } },
        update: { calories, proteins, ... (all 14 nutrient fields) },
        create: { foodId, calories, proteins, ..., sourceId, confidenceLevel: 'high' }
      })

  Catch on first attempt:
    Log warning "Batch N failed (attempt 1): <error>. Retrying..."
    Retry once (identical logic)
    If retry also fails:
      Log error "Batch N failed permanently: <error>. Skipping."
      Mark hasBatchFailure = true
      Continue to next chunk

After loop:
  if hasBatchFailure: process.exit(1)
```

Note on transaction approach: `prisma.$transaction([...])` with an array of operations is suitable here. However, since `$executeRaw` (for embeddings) cannot be included in a `$transaction` array, the embedding writes happen between the two transactions, outside the transaction boundary. This matches the existing seed pattern.

Note on `noUncheckedIndexedAccess`: When accessing `nameEsMap[String(food.fdcId)]`, TypeScript returns `string | undefined`. The validation step guarantees presence, but the type system does not know that. Use a non-null assertion with a comment: `nameEsMap[String(food.fdcId)]!` or add a local cast after validation.

**Step F — Progress logging**
```
console.log(`Phase 2: Processing ${foods.length} SR Legacy foods in ${chunks.length} batches...`)
After each batch: console.log(`Batch ${i+1}/${chunks.length} complete`)
console.log('Phase 2 complete.')
```

**Tests:** See I-6 (integration) and I-5 (unit).

---

### I-5: Unit Tests — Validation Helper

**Files:**
- `packages/api/src/__tests__/f006.unit.test.ts` (create)

**Description:**

Pure unit tests — no DB, no file system reads. Import directly from `../../prisma/seed-data/validateSeedData.ts`. Since these tests have no DB dependency, they run with Vitest in the normal test suite (no special env needed).

**Test scenarios:**

```
describe('validateSeedData')
  it('returns valid:true when all fdcIds have Spanish names and count >= 500')
  it('returns valid:false and lists duplicate fdcIds')
  it('returns valid:false and lists missing Spanish name fdcIds')
  it('returns valid:false when foods array length < 500')
  it('includes [WARN] entries for foods with calories > 900 (not a blocking error)')
  it('returns valid:false when a required nutrient field is missing (undefined)')
  it('collects multiple errors in a single pass (does not short-circuit)')

describe('buildExternalId')
  it('formats fdcId as USDA-SR-{fdcId}')
  it('handles fdcId=0 correctly')

describe('computeSalt')
  it('returns sodium * 2.54')
  it('returns 0 for sodium=0')
  it('rounds correctly for floating-point sodium values')
```

For the `validateSeedData` happy-path test, generate a minimal fixture array of 500 entries programmatically (loop). For negative-path tests use arrays of 2–5 entries to keep tests fast.

**Mocking strategy:** None — pure functions, no mocks needed.

---

### I-6: Integration Test — Seed Script Against Test DB

**Files:**
- `packages/api/src/__tests__/f006.seed.integration.test.ts` (create)

**Description:**

Runs the seed script against `foodxplorer_test` and verifies the resulting DB state. This test is the acceptance-criteria verification layer.

**Setup requirements:**
- The test DB must have all migrations applied (`prisma migrate deploy`)
- The test uses `DATABASE_URL_TEST` (same as all other integration tests)
- `fileParallelism: false` is already set in `vitest.config.ts` — no change needed

**Important: do NOT run `main()` from seed.ts directly in the test.** Instead, use `child_process.execSync` or `spawnSync` to invoke `prisma db seed` (or `tsx prisma/seed.ts`) as a subprocess with `DATABASE_URL` pointing to the test DB. This tests the real entry point. Alternatively, extract the Phase 2 logic into a testable `seedPhase2(prisma: PrismaClient): Promise<void>` function exported from seed.ts and import that directly — this approach is simpler and avoids subprocess complexity.

**Recommended approach: export `seedPhase2` from seed.ts**

Add `export async function seedPhase2(prisma: PrismaClient): Promise<void>` containing all Phase 2 logic. The `main()` function calls `seedPhase2(prisma)`. The integration test imports and calls `seedPhase2(testPrisma)` directly.

**Test scenarios:**

```
describe('F006 — Seed Phase 2 integration')

  beforeAll:
    // Clean SR Legacy data only (leave Phase 1 data intact)
    deleteMany foods where sourceId = '00000000-0000-0000-0000-000000000002'
    deleteMany dataSource where id = '00000000-0000-0000-0000-000000000002'
    deleteMany standardPortions where sourceId = '00000000-0000-0000-0000-000000000002'
    // Run seed
    await seedPhase2(testPrisma)

  afterAll:
    deleteMany foods where sourceId = '00000000-0000-0000-0000-000000000002'
    deleteMany dataSource where id = '00000000-0000-0000-0000-000000000002'
    deleteMany standardPortions where sourceId = '00000000-0000-0000-0000-000000000002'
    await testPrisma.$disconnect()

  it('creates the SR Legacy DataSource record')

  it('inserts at least 500 generic foods with foodType=generic and sourceId=SR-Legacy')

  it('inserts exactly one FoodNutrient per SR Legacy food')

  it('every SR Legacy food has a non-null, non-empty nameEs')

  it('every SR Legacy food has externalId prefixed with USDA-SR-')

  it('inserts 14 group-level StandardPortions for SR Legacy source')

  it('embedding is set (non-null) for every SR Legacy food via raw SQL check')
  //   SELECT COUNT(*) FROM foods WHERE source_id = $1 AND embedding IS NULL → 0

  it('is idempotent — running seedPhase2 twice produces no duplicates')
  //   call seedPhase2(testPrisma) a second time
  //   count foods with SR Legacy sourceId — must equal count from first run
  //   count foodNutrients — must also be unchanged

  it('does not modify Phase 1 foods (count remains 5)')
  //   count foods where sourceId = '00000000-0000-0000-0000-000000000001' → 5
```

**Mocking strategy:** No mocks. Real test DB via `DATABASE_URL_TEST`.

---

### Implementation Order

1. **I-1** — Create `packages/api/prisma/seed-data/usda-sr-legacy-foods.json` and `name-es-map.json` (manual data preparation)
2. **I-2** — Create `packages/api/prisma/seed-data/types.ts` (type definitions needed by validation and seed)
3. **I-3** — Create `packages/api/prisma/seed-data/validateSeedData.ts` (pure validation functions)
4. **I-5** — Write `packages/api/src/__tests__/f006.unit.test.ts` (unit tests — run these first, they will fail until I-3 is complete)
5. **I-4** — Modify `packages/api/prisma/seed.ts` to append Phase 2 with `seedPhase2` export
6. **I-6** — Write `packages/api/src/__tests__/f006.seed.integration.test.ts` (integration tests — require test DB and real data files)

---

### Testing Strategy

**Unit tests (`f006.unit.test.ts`)**
- No DB, no file I/O, fast
- Cover all validation logic branches: duplicates, missing translations, count < 500, calorie warnings, missing nutrient fields
- Cover `buildExternalId` and `computeSalt` utilities
- Use programmatically generated fixture data (loop to create 500-entry arrays where needed)
- Run as part of `npm run test -w @foodxplorer/api` — included automatically by Vitest's glob

**Integration tests (`f006.seed.integration.test.ts`)**
- Require `foodxplorer_test` DB with all migrations applied
- Import `seedPhase2` directly (no subprocess)
- Pre-cleanup in `beforeAll` scoped to SR Legacy `sourceId` only — do not delete Phase 1 data
- `afterAll` teardown in reverse FK order: `foodNutrient` → `food` → `standardPortion` → `dataSource`
- Idempotency test calls `seedPhase2` twice in sequence within the same test
- Use `prisma.$queryRaw` for the embedding NULL check (cannot read `embedding` via Prisma client)

**What NOT to test here:**
- The USDA extraction/transformation logic (one-off tooling, out of scope)
- Prisma schema constraints (already tested in `migration.integration.test.ts`)
- Phase 1 seed data correctness (already tested implicitly)

---

### Key Patterns

**File loading in seed.ts (Node16 ESM with tsx):**
Use `new URL('../seed-data/usda-sr-legacy-foods.json', import.meta.url).pathname` to resolve absolute paths. `import.meta.url` is available with `module: "Node16"` and tsx at runtime. `fs.readFileSync` + `JSON.parse` is preferred over static JSON imports to avoid ESM assertion syntax concerns.

**Upsert target for foods:**
`where: { externalId_sourceId: { externalId: 'USDA-SR-171077', sourceId: '00000000-0000-0000-0000-000000000002' } }` — uses the existing `@@unique([externalId, sourceId])` constraint on the `Food` model.

**Upsert target for foodNutrients:**
`where: { foodId_sourceId: { foodId: food.id, sourceId: srLegacySourceId } }` — uses `@@unique([foodId, sourceId])` on `FoodNutrient`.

**Embedding writes (cannot use Prisma client for vector columns):**
```typescript
await prisma.$executeRaw`UPDATE foods SET embedding = ${ZERO_VECTOR}::vector WHERE id = ${foodId}::uuid`
```
Loop individually per food (same pattern as Phase 1). For 550 foods this is 550 raw SQL calls — acceptable given the 3-minute completion budget and sequential execution.

**`noUncheckedIndexedAccess` guard:**
When accessing `nameEsMap[String(food.fdcId)]`, the type is `string | undefined`. After `validateSeedData` confirms all keys are present, use a local non-null assertion `nameEsMap[String(food.fdcId)]!` with a comment: `// validated above — all fdcIds have Spanish names`.

**Batch chunking:**
```typescript
function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
```
Inline in seed.ts (no external dependency).

**Retry pattern:**
```typescript
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`${label} failed (attempt 1):`, err, 'Retrying...');
    return fn(); // second attempt — throws on failure, caught by caller
  }
}
```
Inline helper in seed.ts.

**StandardPortion upsert — XOR constraint:**
Phase 2 portions are group-level only (`foodId: null`, `foodGroup: <string>`). The DB CHECK constraint enforces XOR — passing `foodId: null` and a non-null `foodGroup` satisfies the constraint.

**Gotcha — Prisma Decimal vs number:**
`FoodNutrient` fields are `@db.Decimal(8,2)`. Prisma accepts plain JS numbers on write (upsert create/update). No conversion needed at write time. On read (e.g. in the integration test assertions), wrap with `Number()`: `expect(Number(fn.calories)).toBe(120)`.

**Gotcha — calories CHECK constraint on food_nutrients:**
The migration enforces `calories <= 900`. Foods with `calories > 900` will fail the DB CHECK constraint. The validation step emits a `[WARN]` for these, but they are NOT excluded from the seed — the developer must decide whether to clamp or exclude these entries from the curated JSON during I-1. The spec says "Log warning (likely data error)". Since Prisma does not enforce the Zod max of 900 but the DB does enforce `<= 900` via CHECK, any entry with `calories > 900` in the JSON will cause a batch failure. The safest approach: during I-1, exclude foods where any nutrient value would violate DB constraints. Document this in the curated JSON selection notes.

**Gotcha — `module: "Node16"` requires explicit `.js` extensions on relative imports:**
`seed.ts` uses `tsx` at runtime (not compiled), so extensions are optional for tsx. But `seed-data/types.ts` and `seed-data/validateSeedData.ts` are imported from `seed.ts` — use `.js` extension in import statements for Node16 compliance: `import { validateSeedData } from './seed-data/validateSeedData.js'`. tsx resolves `.js` → `.ts` at runtime.

---

## Acceptance Criteria

- [x] `npm run db:seed -w @foodxplorer/api` completes without error on a fresh dev database
- [x] After seeding, foods table contains >= 500 rows with `food_type = 'generic'` and `source_id = '00000000-0000-0000-0000-000000000002'`
- [x] After seeding, food_nutrients count matches foods count for SR Legacy source
- [x] Re-running seed produces no errors and no duplicate rows
- [x] Every seeded food has a non-null, non-empty `name_es` value
- [x] Every seeded food has `embedding` set to zero vector (not NULL)
- [x] Existing seed data (3 foods, 1 recipe, 2 dishes, cooking methods, categories, restaurants) unchanged after re-seeding
- [x] Seed completes within 3 minutes on local dev
- [x] All tests pass (49 new: 12 unit + 9 integration + 28 edge-case; 553 total)
- [x] Build succeeds
- [x] Lint passes

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Tests written and passing
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, spec written (Auto-Approved L2)
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
| 2026-03-12 | Spec created (Step 0) | Auto-Approved (L2). USDA SR Legacy as primary source, ~550 foods, bundled JSON + translation map |
| 2026-03-12 | Setup (Step 1) | Branch `feature/F006-seed-script-usda-fen-base-foods`, ticket created |
| 2026-03-12 | Plan approved (Step 2) | 6 implementation steps (I-1 to I-6). Plan approved by user |
| 2026-03-12 | Implementation (Step 3) | backend-developer: 503 foods, validation helper, batch processing, 21 tests (12 unit + 9 integration) |
| 2026-03-12 | Finalize (Step 4) | production-code-validator: READY. 0 critical. Quality gates pass (tests/lint/build) |
| 2026-03-12 | Review (Step 5) | code-review: 1 critical fix (process.exit → throw). qa-engineer: 2 bugs fixed (negative nutrients, whitespace names), 28 edge-case tests added. PR #5 created |
| 2026-03-12 | Data replacement | Replaced synthetic data with real USDA SR Legacy extraction (514 foods). Spanish translations by LLM |
| 2026-03-12 | Complete (Step 6) | Squash merged to develop as c2f48c6. 514 real USDA foods, 49 new tests (553 total), branch deleted |

---

*Ticket created: 2026-03-12*
