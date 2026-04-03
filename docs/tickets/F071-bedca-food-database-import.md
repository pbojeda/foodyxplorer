# F071: BEDCA Food Database Import

**Feature:** F071 | **Type:** Backend-Feature | **Priority:** High
**Status:** In Progress | **Branch:** feature/F071-bedca-food-database-import
**Created:** 2026-04-03 | **Dependencies:** F068 (priority_tier on DataSource)

---

## Spec

### Description

Import the BEDCA (Base de Datos Española de Composición de Alimentos) food composition database into the nutriXplorer food catalog. BEDCA is Spain's official national food composition database managed by AESAN, containing ~431 foods with actual nutrient data (out of 969 total entries — BEDCA2 entries are mostly empty).

BEDCA provides:
- ~431 foods with actual nutrient data per 100g
- 55 nutrients (macros + 19 lipids + 13 vitamins + 11 minerals)
- Bilingual names (Spanish + English)
- API: XML POST at `https://www.bedca.net/bdpub/procquery.php`
- License: REQUIRES authorization from AESAN (email sent 2026-04-02, pending)

**Why this matters:** BEDCA is a Tier 1 (national reference) data source. Foods from BEDCA override USDA for Spanish foods when `has_explicit_brand=false`. Lab-measured values (including oil absorption for tortilla de patatas) are far more accurate than LLM estimation. This is the cornerstone of Phase A1.

**Scope decision (YAGNI):** F071 imports food-level ingredient data. Prepared dish handling (F073) and cooking profiles (F072) are separate features. F071 provides raw ingredient data that feeds everything else.

**License note:** Implementation proceeds with parsing and seed script infrastructure. Production use is deferred until AESAN authorization is received. A feature flag (`BEDCA_IMPORT_ENABLED`) controls activation in non-test environments.

**Reference:** `docs/research/product-evolution-analysis-2026-03-31.md` Section 4 (BEDCA) and Section 5 (Spanish Common Dishes Strategy).

### API Changes (if applicable)

No new endpoints. This is a seed/import script feature only.

New npm scripts:
```
npm run bedca:import -w @foodxplorer/api           # Import from static snapshot
npm run bedca:import:dry-run -w @foodxplorer/api   # Dry run (no DB writes)
npm run bedca:snapshot -w @foodxplorer/api         # Generate snapshot from live API (manual, post-authorization)
```

### Data Model Changes (if applicable)

No schema migration required. F068 already added `priority_tier` to `DataSource`.

New `DataSource` row created in seed:
- `id`: `00000000-0000-0000-0000-000000000003` (deterministic)
- `name`: `BEDCA — Base de Datos Española de Composición de Alimentos`
- `type`: `official`
- `priority_tier`: `1` (national reference, per ADR-015)
- `url`: `https://www.bedca.net/bdpub/`

Foods use existing `foods` and `food_nutrients` tables:
- `externalId`: `BEDCA-{bedcaId}` (e.g., `BEDCA-1`)
- `confidenceLevel`: `high`
- `foodType`: `generic`
- `name`: English name from BEDCA (nameEn)
- `nameEs`: Spanish name from BEDCA (nameEs)
- `nameSourceLocale`: `'es'` (BEDCA is the official Spanish source; English names are translations)

The `extra` JSONB field on `food_nutrients` stores extended BEDCA nutrients (alcohol, vitamins, minerals beyond the 14 standard columns).

### UI Changes (if applicable)

None. Backend-only feature.

### Edge Cases & Error Handling

1. **BEDCA API unavailable:** Static snapshot `bedca-snapshot-full.json` committed to repo for reproducible builds. Live API only called with `--source live` flag.
2. **Foods with no nutrient data:** ~538 BEDCA2 entries have no nutrient values — parsed but skipped with warning. Only entries where core nutrients (calories, proteins, carbohydrates, fats) are non-null are imported.
3. **Calorie cap:** Any entry > 900 kcal/100g flagged as warning (not error) — olive oil at ~884 kcal is legitimate.
4. **Duplicate handling:** `@@unique([externalId, sourceId])` on `foods` ensures idempotency via upsert.
5. **Missing English name:** If `nameEn` is empty, use `nameEs` for both `name` and `nameEs` fields.
6. **Sodium/potassium conversion:** BEDCA reports sodium and potassium in mg/100g. Schema stores in g/100g. Convert: `value_g = value_mg / 1000`. Salt is derived using EU Regulation 1169/2011 mandated multiplier: `salt_g = sodium_g * 2.5` (EU legal standard, NOT the chemical ratio 2.54).
7. **Extended nutrients:** Alcohol, vitamins, minerals stored in `extra` JSONB on `food_nutrients`. The actual BEDCA nutrient codes are verified from the API's `nutrient` table at snapshot time and stored in the nutrient mapper.
8. **Unmeasured nutrients:** `MappedNutrients` allows `number | null` for all nutrient fields. Null values are stored as `0` in required DB columns (DB schema requires non-null for core nutrients) but with a note in `extra.unmeasured` listing which fields were null in the source.
9. **Network timeout:** 30s timeout per request, 3 retries with exponential backoff (1s, 2s, 4s).
10. **Idempotency:** Upsert on `externalId_sourceId` — running twice produces no duplicates.
11. **Feature flag:** `BEDCA_IMPORT_ENABLED=true` required in non-test environments.
12. **BEDCA API format:** The API accepts `f=json` parameter but actually returns XML regardless. The parser must handle XML. The `f=json` parameter in the original research notes was incorrect — the API always returns XML from `procquery.php`.

---

## Implementation Plan

### Overview

Pure backend seeding feature. No new API routes. Follows the USDA seed pattern (F006) using a static XML snapshot with live API client for future refresh.

**Layer order (TDD throughout):**
1. Types (`ingest/bedca/types.ts`)
2. XML Parser (`ingest/bedca/bedcaParser.ts`)
3. Nutrient Mapper (`ingest/bedca/bedcaNutrientMapper.ts`)
4. API Client (`ingest/bedca/bedcaClient.ts`)
5. Static snapshot data (`prisma/seed-data/bedca/bedca-snapshot-full.json`)
6. Seed data validation (`prisma/seed-data/bedca/validateBedcaSeedData.ts`)
7. Seed script integration (`prisma/seed.ts` — add `seedPhase7`)
8. CLI import script (`scripts/bedca-import.ts`)
9. Snapshot generator script (`scripts/bedca-snapshot.ts`)
10. Integration tests

### BEDCA API Format

API endpoint: `POST https://www.bedca.net/bdpub/procquery.php`
Content-Type: `application/x-www-form-urlencoded`

**The API always returns XML regardless of any `f=json` parameter.** The correct approach is to send a plain SQL query and parse the XML response.

**Fetch all foods with nutrients (combined query):**
```
q=select+*+from+food_value+where+value+is+not+null+order+by+food_id
```

This fetches all food entries with their nutrient values in a single request (preferable to N+1 individual requests).

**Response XML structure:**
```xml
<food_database>
  <food>
    <food_id>1</food_id>
    <food_name>Aceite de oliva virgen extra</food_name>
    <food_name_e>Extra virgin olive oil</food_name_e>
    <food_group>Aceites y grasas</food_group>
    <food_group_e>Fats and oils</food_group_e>
    <values>
      <v>
        <nutrient_id>208</nutrient_id>  <!-- INFOODS code for Energy kcal -->
        <v>884.0</v>
      </v>
      ...
    </values>
  </food>
</food_database>
```

**BEDCA Nutrient ID mapping (actual INFOODS/BEDCA codes, verified against API):**

The nutrient IDs in BEDCA follow INFOODS tagname conventions. The actual codes must be verified from the API's `nutrient` reference table. The mapper is built with a lookup table keyed on actual BEDCA nutrient IDs discovered at snapshot time.

For the initial implementation, the snapshot includes nutrient ID metadata. The mapper is driven by the snapshot's nutrient index (not hardcoded sequential 1-14 integers):

| BEDCA code | Nutrient | Schema field | Unit conversion |
|-----------|----------|--------------|-----------------|
| (from API) | Energy (kcal) | `calories` | none |
| (from API) | Protein (g) | `proteins` | none |
| (from API) | Carbohydrates (g) | `carbohydrates` | none |
| (from API) | Sugars (g) | `sugars` | none |
| (from API) | Total fat (g) | `fats` | none |
| (from API) | Saturated FA (g) | `saturatedFats` | none |
| (from API) | Dietary fiber (g) | `fiber` | none |
| (from API) | Sodium (mg) | `sodium` | ÷1000 → g |
| (from API) | Monounsaturated FA (g) | `monounsaturatedFats` | none |
| (from API) | Polyunsaturated FA (g) | `polyunsaturatedFats` | none |
| (from API) | Trans FA (g) | `transFats` | none |
| (from API) | Cholesterol (mg) | `cholesterol` | ÷1000 → g |
| (from API) | Potassium (mg) | `potassium` | ÷1000 → g |
| (from API) | Alcohol (g) | `extra.alcohol_g` | none |
| all others | Vitamins, minerals | `extra.nutrients[{id, name, value}]` | varies |

Salt is always derived: `salt_g = sodium_g * 2.5` (EU Regulation 1169/2011)

The nutrient index (`bedca-nutrient-index.json`) is generated at snapshot time and committed alongside the food snapshot. The mapper reads this index at import time.

### Step-by-Step Implementation

#### Step 1: Types (TDD)

File: `packages/api/src/ingest/bedca/types.ts`

```typescript
export interface BedcaFoodEntry {
  foodId: number;
  nameEs: string;
  nameEn: string;
  foodGroupEs: string;
  foodGroupEn: string;
}

export interface BedcaNutrientValue {
  nutrientId: number;
  value: number | null;
}

export interface BedcaFoodWithNutrients extends BedcaFoodEntry {
  nutrients: BedcaNutrientValue[];
}

export interface BedcaNutrientInfo {
  nutrientId: number;
  name: string;        // e.g. "Energy"
  tagname: string;     // INFOODS tagname e.g. "ENERC_KCAL"
  unit: string;        // e.g. "kcal", "g", "mg"
}

export interface MappedNutrients {
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
  extra: Record<string, unknown>;
}
```

No tests needed for types file — pure type declarations.

#### Step 2: XML Parser (TDD)

File: `packages/api/src/ingest/bedca/bedcaParser.ts`

Uses `fast-xml-parser` (lightweight, zero DOM deps).

Functions:
- `parseBedcaFoods(xml: string): BedcaFoodWithNutrients[]` — parses the full food+nutrient XML
- `parseBedcaNutrientIndex(xml: string): BedcaNutrientInfo[]` — parses nutrient reference table

Test: `packages/api/src/__tests__/f071.bedcaParser.unit.test.ts`
- Test nominal food+nutrient XML (2-3 foods with values)
- Test food with no `<values>` node (no nutrient data — should return empty nutrients array)
- Test missing `food_name_e` falls back gracefully
- Test single food vs multiple foods (array vs object edge case in XML parsers)
- Test malformed XML throws parse error
- Test null/empty nutrient values

#### Step 3: Nutrient Mapper (TDD)

File: `packages/api/src/ingest/bedca/bedcaNutrientMapper.ts`

Function:
```typescript
function mapBedcaNutrientsToSchema(
  nutrients: BedcaNutrientValue[],
  nutrientIndex: BedcaNutrientInfo[]
): MappedNutrients
```

Logic:
- Build lookup map from nutrientIndex: `tagname → nutrientId`
- Extract standard fields by INFOODS tagname
- Convert sodium (mg→g), potassium (mg→g), cholesterol (mg→g)
- Derive salt: `sodium_g * 2.5` (EU Regulation 1169/2011)
- Default missing standard nutrients to `0`
- Put all non-standard nutrients in `extra.nutrients[]`
- Put alcohol in `extra.alcohol_g`

Test: `packages/api/src/__tests__/f071.bedcaNutrientMapper.unit.test.ts`
- Test sodium mg→g conversion (e.g., 100mg → 0.1g)
- Test potassium mg→g conversion
- Test cholesterol mg→g conversion
- Test salt EU formula (sodium 0.1g → salt 0.25g)
- Test missing standard nutrient defaults to 0
- Test non-standard nutrients land in `extra.nutrients`
- Test alcohol lands in `extra.alcohol_g`
- Test empty nutrients array returns all-zeros MappedNutrients

#### Step 4: BEDCA API Client (TDD)

File: `packages/api/src/ingest/bedca/bedcaClient.ts`

Functions:
- `fetchBedcaFoodsXml(fetchImpl?: typeof fetch): Promise<string>` — fetches food+nutrient XML
- `fetchBedcaNutrientIndexXml(fetchImpl?: typeof fetch): Promise<string>` — fetches nutrient reference table

Uses `AbortSignal.timeout(30_000)` and exponential backoff (3 retries: 1s, 2s, 4s).

DI pattern: optional `fetchImpl` parameter.

Test: `packages/api/src/__tests__/f071.bedcaClient.unit.test.ts`
- Test correct POST to BEDCA URL with form-encoded body
- Test 30s timeout propagation
- Test retry on 5xx (3 retries → success on 3rd)
- Test retry exhausted → throws error
- Test 4xx propagates without retry
- Test network error triggers retry

#### Step 5: Static Snapshot (~20 representative foods)

Files:
- `packages/api/prisma/seed-data/bedca/bedca-snapshot-full.json` — array of `BedcaFoodWithNutrients`
- `packages/api/prisma/seed-data/bedca/bedca-nutrient-index.json` — array of `BedcaNutrientInfo`

**Initial content:** ~20 foods covering key food groups:
- Fats/oils: Aceite de oliva virgen extra / Extra virgin olive oil
- Cereals: Arroz blanco / White rice, Pan de trigo / Wheat bread
- Meat: Pollo (pechuga) / Chicken breast, Ternera / Beef
- Fish: Merluza / Hake, Sardinas / Sardines
- Vegetables: Patata / Potato, Tomate / Tomato, Zanahoria / Carrot
- Legumes: Lentejas / Lentils, Garbanzos / Chickpeas
- Dairy: Leche entera / Whole milk, Queso manchego / Manchego cheese
- Fruits: Naranja / Orange, Manzana / Apple, Plátano / Banana
- Eggs: Huevo entero / Whole egg
- Nuts: Almendras / Almonds

Nutrient values are approximated from Spanish nutrition databases (not fabricated — sourced from BEDCA published values or USDA where BEDCA matches).

Note: Full 431-food dataset loaded after AESAN authorization.

#### Step 6: Seed Data Validation (TDD)

File: `packages/api/prisma/seed-data/bedca/validateBedcaSeedData.ts`

Function: `validateBedcaSeedData(entries: BedcaFoodWithNutrients[]): ValidationResult`

Checks:
- Minimum 1 entry (initial subset) — no 500-food minimum like USDA
- No duplicate `foodId` values
- No negative nutrient values (warn, not error for non-standard nutrients in extra)
- Calories > 900: warning (non-blocking) — pure fats can approach 900
- Required fields: `foodId`, `nameEs` (or `nameEn` as fallback), nutrients array present

Test: `packages/api/src/__tests__/f071.validateBedcaSeedData.unit.test.ts`
- Test duplicate foodId detection
- Test negative nutrient rejection
- Test calorie > 900 warning (not error)
- Test missing nameEs with nameEn fallback passes
- Test missing both names fails
- Test empty entries array fails

#### Step 7: Seed Script Integration (TDD)

Modify: `packages/api/prisma/seed.ts`

New function `seedPhase7(client: PrismaClient): Promise<void>`:
```typescript
// 1. Upsert BEDCA DataSource with priority_tier=1
// 2. Read + validate bedca-snapshot-full.json + bedca-nutrient-index.json
// 3. Build nutrient mapper from index
// 4. Batch upsert foods (batch size 50)
// 5. Batch upsert food_nutrients
// 6. Set zero-vector embeddings via $executeRaw
// Feature flag: skip in non-test if BEDCA_IMPORT_ENABLED !== 'true'
```

Called from `main()` after `seedPhase2` (USDA phase).

Test: `packages/api/src/__tests__/f071.seedPhase7.unit.test.ts`
- Mock PrismaClient
- Test DataSource upsert with correct UUID and priority_tier=1
- Test food upsert called for each snapshot entry
- Test food_nutrient upsert called for each food
- Test batch size (50 items per batch)
- Test feature flag: env=development + flag absent → skip + log warning
- Test feature flag: env=test → proceeds regardless (for test isolation)
- Test env=production + flag absent → skip + log warning

#### Step 8: CLI Import Script

File: `packages/api/src/scripts/bedca-import.ts`

Function: `runBedcaImport(opts, prismaOverride?, fetchImpl?): Promise<void>`

Flags:
- `--dry-run` — report what would be imported, no DB writes
- `--source snapshot|live` (default: snapshot)
- `--batch-size <n>` (default 50)

Output:
- Dry run: "Would import N foods from BEDCA (snapshot)"
- Live: "Fetching from BEDCA API..." then same as snapshot
- Summary: foods inserted, foods skipped (no nutrients), foods updated

npm scripts added to `package.json`:
```json
"bedca:import": "tsx src/scripts/bedca-import.ts",
"bedca:import:dry-run": "tsx src/scripts/bedca-import.ts --dry-run",
"bedca:snapshot": "tsx src/scripts/bedca-snapshot.ts"
```

#### Step 9: Snapshot Generator (post-authorization use)

File: `packages/api/src/scripts/bedca-snapshot.ts`

Fetches all 969 food entries + nutrient index from live BEDCA API.
Filters to entries with actual nutrient data (non-null calories/proteins/fats).
Writes `bedca-snapshot-full.json` and `bedca-nutrient-index.json`.

Not tested directly (integration with live API). Usage instructions in script header comment.

#### Step 10: Integration Tests

File: `packages/api/src/__tests__/f071.seedPhase7.integration.test.ts`

Uses real test DB (same pattern as existing integration tests).
Skips if test DB not available (`DATABASE_URL_TEST` absent).

Verifies:
- DataSource row created with `priority_tier=1` and `type='official'`
- Foods created with `externalId='BEDCA-{id}'`, `nameSourceLocale='es'`
- FoodNutrients created with `confidenceLevel='high'`, `referenceBasis='per_100g'`
- Extended nutrients in `extra` JSONB (alcohol, etc.)
- Idempotency: run twice → same food count, no errors
- USDA foods NOT affected (different sourceId)

### Deterministic UUIDs

| Entity | UUID |
|--------|------|
| BEDCA DataSource | `00000000-0000-0000-0000-000000000003` |

### Files Created

```
packages/api/src/ingest/bedca/types.ts
packages/api/src/ingest/bedca/bedcaParser.ts
packages/api/src/ingest/bedca/bedcaNutrientMapper.ts
packages/api/src/ingest/bedca/bedcaClient.ts
packages/api/src/ingest/bedca/index.ts
packages/api/prisma/seed-data/bedca/validateBedcaSeedData.ts
packages/api/prisma/seed-data/bedca/bedca-snapshot-full.json
packages/api/prisma/seed-data/bedca/bedca-nutrient-index.json
packages/api/src/scripts/bedca-import.ts
packages/api/src/scripts/bedca-snapshot.ts
packages/api/src/__tests__/f071.bedcaParser.unit.test.ts
packages/api/src/__tests__/f071.bedcaNutrientMapper.unit.test.ts
packages/api/src/__tests__/f071.bedcaClient.unit.test.ts
packages/api/src/__tests__/f071.validateBedcaSeedData.unit.test.ts
packages/api/src/__tests__/f071.seedPhase7.unit.test.ts
packages/api/src/__tests__/f071.seedPhase7.integration.test.ts
```

### Files Modified

```
packages/api/prisma/seed.ts          # Add seedPhase7 + call from main()
packages/api/package.json            # Add bedca:import, bedca:snapshot scripts
.env.example                         # Add BEDCA_IMPORT_ENABLED
docs/project_notes/key_facts.md      # BEDCA DataSource UUID, seed Phase 7 details
```

---

## Acceptance Criteria

- [ ] BEDCA DataSource row created with UUID `00000000-0000-0000-0000-000000000003`, `priority_tier=1`, `type='official'`
- [ ] `bedcaParser.ts` correctly parses BEDCA XML food list and nutrient values
- [ ] `bedcaNutrientMapper.ts` maps BEDCA codes → schema columns with correct unit conversions: sodium/potassium/cholesterol mg→g, salt = sodium * 2.5 (EU Regulation 1169/2011)
- [ ] Foods seeded with `externalId='BEDCA-{id}'`, bilingual names (name=English, nameEs=Spanish), `nameSourceLocale='es'`, correct foodGroup
- [ ] FoodNutrients seeded with `confidenceLevel='high'`, `referenceBasis='per_100g'`, extended nutrients in `extra` JSONB
- [ ] Zero-vector embeddings set for all seeded BEDCA foods
- [ ] Seed is idempotent: running twice produces no duplicates, no errors
- [ ] BEDCA foods do NOT overwrite existing USDA foods (different sourceId)
- [ ] Feature flag `BEDCA_IMPORT_ENABLED` prevents production use before AESAN authorization (skips seed in non-test environments when flag absent)
- [ ] `npm run bedca:import:dry-run` reports what would be imported without writing to DB
- [ ] All unit tests pass (parser, mapper, client, validation, seed function)
- [ ] Integration test verifies DataSource + foods + nutrients in test DB
- [ ] `npm test -w @foodxplorer/api` passes
- [ ] `npm run build -w @foodxplorer/api` succeeds
- [ ] `docs/project_notes/key_facts.md` updated with BEDCA DataSource UUID and seed Phase 7 details
- [ ] `.env.example` updated with `BEDCA_IMPORT_ENABLED`

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Unit tests written and passing (TDD — test before implementation)
- [ ] Integration tests passing with real test DB
- [ ] Code follows project standards (TypeScript strict, no `any`)
- [ ] No linting errors
- [ ] Build succeeds
- [ ] Specs reflect final implementation

---

## Workflow Checklist

- [x] Step 0: Spec written (self-reviewed + Gemini cross-model review: 3 issues fixed)
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: Implementation plan written (self-reviewed)
- [ ] Step 3: Implementation with TDD
- [ ] Step 4: Quality gates pass
- [ ] Step 5: Code review
- [ ] Step 5: QA review
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-03 | Ticket created | Standard complexity, branch feature/F071-bedca-food-database-import |
| 2026-04-03 | Spec + Plan self-review | Verified edge cases, feature flag, snapshot approach, nutrient mappings |
| 2026-04-03 | Gemini spec review | 1 CRITICAL + 2 IMPORTANT + 2 SUGGESTIONs. Fixed: salt multiplier 2.54→2.5 (EU law), MappedNutrients null handling, nameSourceLocale='es', API format clarified (always XML), nutrient IDs use actual BEDCA codes not sequential 1-14 |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | Sections verified: (list) |
| 1. Mark all items | [ ] | AC: _/_, DoD: _/_, Workflow: _/_ |
| 2. Verify product tracker | [ ] | Active Session: step _/6, Features table: _/6 |
| 3. Update key_facts.md | [ ] | Updated: (list) / N/A |
| 4. Update decisions.md | [ ] | ADR-XXX added / N/A |
| 5. Commit documentation | [ ] | Commit: (hash) |
| 6. Verify clean working tree | [ ] | `git status`: clean |

---

*Ticket created: 2026-04-03*

<!-- Plan review addendum 2026-04-03 -->
<!-- REVISE items addressed in implementation:
  CRITICAL-1: BEDCA API returns flat rows from food_value JOIN food. Parser groups rows by food_id in memory after JOIN query.
  IMPORTANT-2: bedcaNutrientMapper tracks unmeasured standard fields in extra.unmeasured[].
  IMPORTANT-3: validateBedcaSeedData checks core nutrients (calories, proteins, carbs, fats) are non-null.
  IMPORTANT-4: bedca-import.ts CLI script also checks BEDCA_IMPORT_ENABLED feature flag.
  SUGGESTION-5: fast-xml-parser configured with isArray for 'food' and 'v' nodes.
-->
