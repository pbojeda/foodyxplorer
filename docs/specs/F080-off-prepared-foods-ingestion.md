# F080 — OFF Prepared Foods Ingestion

**Feature:** F080 | **Type:** Backend | **Priority:** High
**Status:** Ready for Implementation | **Epic:** E008 (Phase B)
**Created:** 2026-04-06 | **Dependencies:** F068 (DataSource.priorityTier), F071 (BEDCA ingest pattern)

---

## Spec

### Description

Ingest Open Food Facts (OFF) prepared food products — specifically Hacendado/Mercadona products (~11,150 items) — into the nutriXplorer food catalog. OFF data serves two roles (ADR-015):

- **Tier 0:** For branded queries (`hasExplicitBrand=true`, e.g., "tortilla hacendado") → direct L1 lookup returns OFF data as the authoritative source.
- **Tier 3 fallback:** For generic queries when BEDCA and canonical recipes produce no match → return OFF data with mandatory attribution note: _"Valores de referencia: [Product Name] (plato preparado industrial)"_.

OFF is ingested as a batch import (CLI script), following the same structural pattern as BEDCA (F071). No new database migrations are required. ODbL attribution is required in all API responses that include OFF-sourced data. Barcode scanning (Phase D, F100–F101) is explicitly out of scope.

**Reference:** `docs/research/product-evolution-analysis-2026-03-31.md` Section 4, ADR-015.

---

### Requirements

#### R1 — OFF HTTP Client

A new module `packages/api/src/ingest/off/offClient.ts` must provide:

1. **`fetchProductsByBrand(brand, options)`** — Queries the OFF Search API v2 (`/api/v2/search`) to retrieve all products for a given brand keyword (e.g., `"hacendado"`). Must paginate automatically through all result pages using `page` and `page_size=100` parameters. Returns an array of raw OFF product objects. The `--brand` flag accepts any brand (default: `"hacendado"`); when `"mercadona"` is specified, the client must also query `"hacendado"` (Mercadona's house brand) and merge results.
2. **`fetchProductByBarcode(barcode, options)`** — Queries the OFF Product API (`/api/v2/product/{barcode}.json`) to retrieve a single product. Returns a raw OFF product object or `null` if not found (404).
3. **Retry policy:** 3 retries with exponential backoff (1 s, 2 s, 4 s). 4xx responses are not retried. 5xx responses and network errors are retried. Timeout: 30 s per request.
4. **User-Agent header:** Must include the project identifier and contact per OFF API policy: `nutriXplorer/1.0 (nutrixplorer@example.com)`.
5. **Authentication required.** OFF API v2 requires session cookies for search queries (discovered 2026-04-07). Without authentication, the API returns HTML "Page temporarily unavailable" instead of JSON. Session cookie is read from the `OFF_SESSION_COOKIE` environment variable. See `.env.example` for setup instructions.

#### R2 — OFF Parser / Mapper

A new module `packages/api/src/ingest/off/offMapper.ts` must provide:

1. **`mapOffProductToFood(product)`** — Transforms a raw OFF product JSON object to the nutriXplorer `Food` + `FoodNutrient` models, ready for DB upsert. See Data Model section for field mappings.
2. **`validateOffProduct(product)`** — Returns `{ valid: boolean; reasons: string[] }`. A product is valid if:
   - `product_name` (or `product_name_es`) is present and non-empty.
   - The `nutriments` block exists and is non-empty.
   - At minimum `calories` (or energy in kJ), `proteins`, `carbohydrates`, and `fats` are present with non-null numeric values.
   - `calories` ≤ 900 kcal/100g (pure fat = 900 kcal/100g is the physical maximum; values above indicate corrupt data and must be skipped).
   Products failing any condition are skipped with logged reason(s).

#### R3 — OFF Ingestion Script

A new script `packages/api/src/scripts/seedPhaseOff.ts` must:

1. Be callable from the root npm workspace: `npm run off:import -w @foodxplorer/api`.
2. Support a `--dry-run` flag that runs all parsing and validation but performs no DB writes.
3. Support a `--brand` flag (default: `"hacendado"`) to specify which brand to import.
4. Support a `--limit` flag (optional) to cap the number of products ingested (useful for testing and incremental rollout).
5. Upsert Foods using `@@unique([externalId, sourceId])` — running twice must produce no duplicates.
6. Report final counts: `productsFound`, `productsImported`, `productsSkipped`, `skipReasons[]`.
7. Respect the `OFF_IMPORT_ENABLED` environment variable — abort in non-test environments when not set to `"true"`.

#### R4 — DataSource Record

A new `DataSource` record for OFF must be seeded in `packages/api/prisma/seed.ts`:

- `id`: `00000000-0000-0000-0000-000000000004` (deterministic)
- `name`: `Open Food Facts`
- `type`: `official`
- `priorityTier`: `0` (Tier 0 — brand/supermarket official data per ADR-015)
- `url`: `https://world.openfoodfacts.org/`

> **Note:** `priorityTier: 0` is correct. OFF products are official packaging data — the highest-confidence source for branded queries. The same DataSource record covers both Tier 0 branded use and Tier 3 fallback use; the routing tier is determined at query time by the estimation engine based on `hasExplicitBrand`, not by the DataSource record.

#### R5 — Estimation Engine Integration

The estimation engine must handle OFF data at two distinct tiers depending on query context:

**Branded query path** (`hasExplicitBrand=true`, detected brand is a supermarket):
1. L1 lookup queries `foods` table filtered by `sourceId = OFF_SOURCE_UUID AND foodType = 'branded'` using FTS/trigram on the food name.
2. This runs **before** chain dish lookup — OFF branded data is Tier 0 (highest priority).
3. If found → return result immediately with HIGH confidence.

**Generic query fallback path** (`hasExplicitBrand=false`):
1. The standard cascade runs in full: L1 (BEDCA/chains) → L2 (ingredients) → L3 (pgvector similarity).
2. **Only if ALL levels return no result**, query OFF foods as a last-resort fallback (effective Tier 3).
3. OFF foods are **never** returned for generic queries when BEDCA or canonical data exists — BEDCA always wins.

**ODbL attribution fields** — computed at response time in the estimation result mapper (not stored in DB):
- `attributionNote: "Valores de referencia: {food.nameEs} (plato preparado industrial)"` — mandatory for all OFF-sourced results. The mapper checks `sourceId === OFF_SOURCE_UUID` and interpolates `food.nameEs`.
- `license: "ODbL 1.0"` — hardcoded when source is OFF.
- `sourceUrl: "https://world.openfoodfacts.org/product/{food.barcode}"` — when `food.barcode` is non-null; null otherwise.
- All three fields are `null` for non-OFF sources — backwards compatible.

**Brand alias handling:** When `detectedBrand` is `"mercadona"`, the L1 branded lookup must also match foods with `brandName = "hacendado"` (Mercadona's house brand). The `SUPERMARKET_BRAND_ALIASES` map: `{ mercadona: ["hacendado", "mercadona"], ... }` is added to `brandDetector.ts`.

#### R6 — Feature Flag

A new environment variable `OFF_IMPORT_ENABLED` guards the ingestion script (same pattern as `BEDCA_IMPORT_ENABLED` in F071). When `OFF_IMPORT_ENABLED !== "true"` in non-test environments, the script logs a warning and exits with code 0.

---

### Data Model Changes

**No new Prisma schema migrations required.** All OFF data maps to existing tables.

#### New DataSource record (seed data)

```
id:           00000000-0000-0000-0000-000000000004
name:         "Open Food Facts"
type:         official
priorityTier: 0
url:          "https://world.openfoodfacts.org/"
```

#### OFF Product → `foods` table mapping

| OFF Field | `foods` column | Notes |
|---|---|---|
| `code` (EAN barcode) | `barcode` | VarChar(50). May be absent for some products. |
| `code` + `_id` | `externalId` | Format: `OFF-{code}` (e.g., `OFF-8480000123456`). Falls back to `OFF-id-{_id}` using OFF's internal `_id` field if no barcode. If neither exists, skip product. |
| `product_name` | `name` | English product name. Falls back to `product_name_es` if absent. |
| `product_name_es` | `nameEs` | Spanish product name. Falls back to `product_name` if absent. |
| `brands` | `brandName` | First brand in comma-separated list (normalised to lowercase). |
| `categories_tags` | `foodGroup` | First `en:` category tag, stripped of prefix. Max 100 chars. |
| `OFF_SOURCE_UUID` | `sourceId` | Deterministic UUID for OFF DataSource. |
| `"branded"` | `foodType` | Always `branded` for supermarket products. |
| `"high"` | `confidenceLevel` | Official packaging data — high confidence. |
| `[]` | `aliases` | Empty on import; populated by F078 regional alias pipeline if needed. |

#### OFF `nutriments` → `food_nutrients` table mapping

All values are per 100g. Reference basis: `per_100g`.

| OFF `nutriments` key | `food_nutrients` column | Conversion |
|---|---|---|
| `energy-kcal_100g` | `calories` | Direct (kcal) |
| `proteins_100g` | `proteins` | Direct (g) |
| `carbohydrates_100g` | `carbohydrates` | Direct (g) |
| `sugars_100g` | `sugars` | Direct (g) |
| `fat_100g` | `fats` | Direct (g) |
| `saturated-fat_100g` | `saturatedFats` | Direct (g) |
| `fiber_100g` | `fiber` | Direct (g); default 0 if absent |
| `salt_100g` | `salt` | Direct (g) |
| `sodium_100g` | `sodium` | Direct (g); if absent derive from `salt / 2.5` |
| `trans-fat_100g` | `transFats` | Direct (g); default 0 if absent |
| `cholesterol_100g` | `cholesterol` | mg → g (÷1000); default 0 if absent |
| `potassium_100g` | `potassium` | mg → g (÷1000); default 0 if absent |
| `monounsaturated-fat_100g` | `monounsaturatedFats` | Direct (g); default 0 if absent |
| `polyunsaturated-fat_100g` | `polyunsaturatedFats` | Direct (g); default 0 if absent |
| `alcohol_100g` | `alcohol` | Direct (g); default 0 if absent |

Additional OFF fields stored in `food_nutrients.extra` JSONB:

```json
{
  "offMeta": {
    "nutriscoreGrade": "b",
    "novaGroup": 4,
    "allergensText": "Contiene: gluten, leche",
    "ingredientsText": "Patata 65%, huevo 20%, aceite de girasol 14%...",
    "servingSize": "200g",
    "imageUrl": "https://images.openfoodfacts.org/...",
    "lastModified": "2025-11-14T10:22:00Z"
  }
}
```

The `extra.offMeta` sub-object is always present for OFF foods. Fields within `offMeta` are individually optional — set to `null` when absent in the source product.

---

### API Contract

**No new API endpoints are introduced by F080.** OFF data flows exclusively through the existing `GET /estimate` endpoint.

#### Changes to `GET /estimate` response

When the estimation result originates from an OFF food record, the provenance object in the response must be extended with three additional nullable fields:

**Schema addition to `EstimateSource`** (existing schema in `api-spec.yaml`):

```yaml
ProvenanceInfo:
  # ... existing fields (sourceName, sourceId, priorityTier, confidenceLevel) ...
  attributionNote:
    type: string
    nullable: true
    description: |
      ODbL-required attribution note. Present when the result originates from
      Open Food Facts data. Format: "Valores de referencia: {product_name_es}
      (plato preparado industrial)". Null for non-OFF sources.
    example: "Valores de referencia: Tortilla de Patatas Hacendado (plato preparado industrial)"
  license:
    type: string
    nullable: true
    description: |
      Data license identifier. "ODbL 1.0" for OFF-sourced results. Null otherwise.
    example: "ODbL 1.0"
  sourceUrl:
    type: string
    nullable: true
    format: uri
    description: |
      Direct URL to the original product page on the source. For OFF products
      with a barcode: "https://world.openfoodfacts.org/product/{barcode}".
      Null when barcode is unavailable or source is not OFF.
    example: "https://world.openfoodfacts.org/product/8480000123456"
```

These fields are already nullable for all non-OFF sources — existing API consumers are unaffected.

#### New admin script endpoints (none)

The ingestion is CLI-only. No HTTP endpoint is needed to trigger OFF import. The existing admin pattern (CLI scripts + seed) is followed.

---

### Acceptance Criteria

1. **Import script (mocked):** Unit/integration tests with mocked OFF API responses verify that `seedPhaseOff` correctly parses, validates, and upserts products. Live API import is a manual smoke test.
2. **Idempotency:** Running the script twice against mocked data produces no duplicate records (`@@unique([externalId, sourceId])` constraint satisfied).
3. **Dry run:** `--dry-run` flag runs all parsing and validation but performs zero DB writes and prints the same summary counts.
4. **Branded lookup:** Integration test: seed a mock OFF food with `brandName: "hacendado"`, assert that `GET /estimate?query=tortilla+hacendado` returns it with `sourceId = OFF_SOURCE_UUID`, `confidenceLevel: "high"`, and non-null `attributionNote`.
5. **BEDCA priority:** Integration test: seed both a BEDCA food and an OFF food for "tortilla de patatas". Assert `GET /estimate?query=tortilla+de+patatas` returns the BEDCA result, not OFF.
6. **OFF fallback:** Integration test: seed an OFF food for a query with no BEDCA/chain/canonical match. Assert the generic cascade returns the OFF food as Tier 3 fallback.
7. **ODbL attribution:** Any OFF-sourced result includes non-null `attributionNote`, `license: "ODbL 1.0"`, and `sourceUrl` (when barcode is available). All three are null for non-OFF sources.
8. **Validation:** Products with missing required nutrients, empty nutriments, calories >900, or missing product_name are skipped and logged to `skipReasons[]`.
9. **Feature flag:** `OFF_IMPORT_ENABLED` gate prevents accidental production runs.
10. **Unit tests:** `offMapper` field mapping, nutrient conversions (cholesterol/potassium mg→g, kJ→kcal), missing field defaults, skip conditions, calorie >900 rejection, brand alias resolution.
11. **Brand alias:** Query "tortilla mercadona" matches OFF foods with `brandName: "hacendado"`.
12. **Post-import:** After import, run embeddings generation (`npm run embeddings:generate`) for new OFF foods to enable L3 pgvector similarity search.

---

### Edge Cases

1. **Missing `product_name`:** Skip product. Log: `"OFF-{code}: product_name absent — skipped"`.
2. **Missing barcode (`code` field):** Allow import if OFF internal `_id` is available. `barcode` column stays null. `externalId` uses `OFF-id-{_id}` (collision-safe, since `_id` is unique in OFF). If neither `code` nor `_id` exists, skip product. `sourceUrl` in provenance is null.
3. **`energy-kcal_100g` absent, only `energy_100g` (kJ) present:** Convert kJ to kcal using factor 4.184. Log conversion applied.
4. **`sodium_100g` absent but `salt_100g` present:** Derive sodium: `sodium = salt / 2.5`.
5. **Both `sodium_100g` and `salt_100g` absent:** Both default to 0. Log as unmeasured in `extra.offMeta`.
6. **Calorie value > 900 kcal/100g:** Hard skip. Pure fat = 900 kcal/100g is the physical maximum energy density (9 kcal/g × 100g). Values above this indicate corrupt or mislabeled data. Log: `"OFF-{code}: calories {value} > 900 kcal/100g — skipped (corrupt data)"`.
7. **Product with `product_name` but no or empty `nutriments` block:** Skip. A `nutriments` block that exists but contains no core nutrient keys (energy, proteins, carbohydrates, fat) is treated the same as absent.
8. **Duplicate `product_name_es` across brands:** No issue — dedup key is `externalId + sourceId`, not name. Multiple products with the same name are valid if they have different barcodes.
9. **OFF API rate limiting:** OFF recommends not exceeding 1 req/s for bulk operations. The client must apply a **1000 ms (1 second)** delay between paginated requests to comply with this recommendation.
10. **`--limit` flag:** When provided, the script must stop fetching new pages once the limit is reached, not after importing. Do not fetch page 5 when page 4 already satisfied the limit.
11. **Partial page on last page:** OFF `page_size=100` may return fewer products on the final page. This is normal — the loop terminates when the returned page is empty or has fewer items than `page_size`.
12. **OFF product `brands` field contains multiple brands:** Use only the first entry after splitting on `,`. Trim and lowercase.
13. **Non-food products:** The brand query may return non-food items (cosmetics, cleaning products, pet food) that are incorrectly tagged in OFF. These should be excluded. However, filtering by OFF `categories_tags` is unreliable (inconsistent tagging), so the primary quality gate is the nutrient validator (R2): products without valid macronutrients are automatically skipped. Products with valid nutrients are imported regardless of category — the `foodType: "branded"` flag and brand detection handle routing correctly.
14. **Missing both `code` (barcode) and `_id`:** Skip product — no stable external identifier available.

---

### Non-Functional Requirements

1. **Performance:** The ingestion script must handle 11,150+ products. With batched upserts (batch size 50, matching BEDCA pattern) and 1000 ms inter-request delay, estimated total runtime is ~2–3 hours. This is acceptable for a one-time background import.
2. **Idempotency:** All upserts must be idempotent. Re-running the script updates existing records without creating duplicates.
3. **ODbL Compliance:** Every response that surfaces OFF data must include attribution. The `attributionNote` and `license` fields in `ProvenanceInfo` are not optional for OFF-sourced results — the estimation engine must enforce their presence.
4. **Observability:** The script must log progress every 100 products (e.g., `"[OFF] Progress: 400/11150 products processed"`).
5. **Data quality:** Nutriscore grade and NOVA group (stored in `extra.offMeta`) are informational only — they do not affect confidence level or estimation routing in this feature.

---

### Module Structure

New files to create:

```
packages/api/src/ingest/off/
  offClient.ts       — HTTP client (search by brand, get by barcode)
  offMapper.ts       — OFF product JSON → Food + FoodNutrient objects
  offValidator.ts    — validateOffProduct(), isImportable()
  types.ts           — OffProduct, OffNutriments, MappedOffFood interfaces

packages/api/src/scripts/
  seedPhaseOff.ts    — CLI ingestion script

packages/api/prisma/seed-data/off/
  (directory, initially empty — snapshot files added during implementation if needed)
```

Updated files:

```
packages/api/prisma/seed.ts              — add OFF DataSource record + call seedPhaseOff
packages/api/src/estimation/level1Lookup.ts — add OFF lookup paths (branded + fallback)
docs/specs/api-spec.yaml                — extend ProvenanceInfo schema
```

---

### Out of Scope

- Barcode scanning / barcode extraction from photos (Phase D, F100–F101)
- Any frontend/UI changes
- New HTTP endpoints for triggering OFF import
- Importing brands other than Hacendado/Mercadona in this iteration (multi-brand expansion planned as a future task — see product-evolution-analysis Section 4)
- FatSecret, Edamam, or other external API integrations
- Real-time OFF synchronisation (scheduled jobs, webhooks) — batch import only

---

### Known Issues & Discoveries (2026-04-07)

1. **OFF API v2 requires authentication.** The old endpoint (`/cgi/search.pl`) returns 503 without auth. The new endpoint (`/api/v2/search`) returns HTML "Page temporarily unavailable" without session cookies. Solution: user creates an OFF account, logs in, copies session cookie to `OFF_SESSION_COOKIE` env var. This was discovered during the first ingestion attempt.

2. **OFF data is broader than expected.** A query for "tortilla de patatas" in OFF returns multiple variants (con cebolla, con chorizo) and multiple brands (Hacendado, Carrefour, Dia, Aldi). This opens the door to multi-brand ingestion in future iterations.

3. **Data quality criteria (mandatory for import):**
   - Product must have at least: calories + proteins + fats + carbohydrates (enforced by validator)
   - Calories must be ≤ 900 kcal/100g (enforced by validator)
   - No negative nutrient values (enforced by validator)
   - Product must have at least one name (product_name or product_name_es)
   - Product must have a stable identifier (code or _id)

4. **Multi-brand expansion strategy (future):** When expanding beyond Hacendado, the same `--brand` flag can be used with different brand names. Quality filtering is already in place. The main consideration is disambiguation when multiple brands offer the same product — the estimation engine currently returns the first L1 match, which may need refinement for multi-brand scenarios.
