# F038 — Multilingual Dish Name Resolution

**Feature:** F038
**Type:** Backend — Data Migration + Pipeline Fix
**Priority:** High
**Status:** Spec Draft
**Created:** 2026-03-25
**Decision Reference:** ADR-010 (docs/project_notes/decisions.md)

---

## 1. Problem Statement

### Quantified Impact

| Metric | Value |
|--------|-------|
| Dishes with `name_es = NULL` | 883 / 885 (99.8%) |
| Source language of stored `name` | Mostly English (chain PDF nutritional docs) |
| L1 FTS on Spanish query | Fails: `to_tsvector('spanish', COALESCE(name_es, name))` falls back to English `name`, mismatched stemmer |
| L3 embedding quality | Degraded: `buildDishText()` omits "Spanish name: ..." line for 99.8% of dishes |
| Practical failure example | "ensalada de pollo a la plancha" → no L1/L2 match; must fall to L3/L4 |

### Root Cause

PDF ingestion (`parseNutritionTable` + `normalizeDish`) extracts names verbatim from the source document. English-language chain PDFs produce English names. No translation step exists in the current pipeline.

The `normalizeDish()` function in `packages/scraper/src/utils/normalize.ts` passes `raw.nameEs` through unchanged. For PDF and URL ingest paths (`packages/api/src/ingest/`), `nameEs` is never set — `parseNutritionTable` does not populate it.

### What Is NOT Broken

- L1 exact-match strategy: works when user types the English brand name exactly (e.g., "Big Mac").
- L1 FTS English fallback: `to_tsvector('english', d.name) @@ plainto_tsquery('english', ...)` in `ftsDishMatch()` still fires for English queries.
- L4 ingredient decomposition: handles multilingual input natively via the `foods` table, which has 100% `name_es` coverage.
- Chain scrapers for Spanish-domain sites: already set `nameEs = name` when the source language is Spanish.

---

## 2. Scope

### In Scope

1. **Schema migration** — add `name_source_locale VARCHAR(5)` nullable column to `dishes`.
2. **Batch translation script** — one-time CLI script to populate `name_es` and `name_source_locale` for all existing dishes.
3. **Ingest pipeline fix** — ensure all future ingest routes populate `name_es` at write time.
4. **Embedding regeneration** — trigger the existing embedding pipeline (force mode) after translation.

### Out of Scope (YAGNI per ADR-010)

- Query-time language detection or translation service.
- Changes to the `name` field semantics (immutable per ADR-001).
- Introduction of a `dish_translations` table (deferred to Phase 2 / 3rd language).
- Any API endpoint changes (this is a data/pipeline feature, not an API feature).
- Frontend / bot changes.

---

## 3. Schema Changes

### 3.1 New Column — `dishes.name_source_locale`

**Prisma schema change** (`packages/api/prisma/schema.prisma`, `Dish` model):

```
nameSourceLocale  String?  @map("name_source_locale") @db.VarChar(5)
```

Placement: after the existing `nameEs` field.

**Migration SQL** (raw migration file — Prisma cannot express partial constraints):

```sql
ALTER TABLE dishes
  ADD COLUMN name_source_locale VARCHAR(5) NULL;

COMMENT ON COLUMN dishes.name_source_locale IS
  'Detected language of the original name field. Values: en, es, mixed, unknown. NULL = not yet classified.';
```

No default value. NULL means "not yet classified". The batch script populates this for all existing rows. Future ingest always sets it.

### 3.2 Allowed Values

| Value | Meaning |
|-------|---------|
| `'en'` | Source name is English (e.g., "Grilled Chicken Salad") |
| `'es'` | Source name is already Spanish (Spanish-domain chain PDFs) |
| `'mixed'` | Source name contains both languages or is ambiguous |
| `'unknown'` | Language could not be determined with confidence |

No DB-level enum — kept as `VARCHAR(5)` to avoid enum migration overhead for a rarely-queried metadata field.

### 3.3 Prisma `Dish` Type Impact

After migration, `Prisma.DishCreateInput` and `Prisma.DishUpdateInput` will include `nameSourceLocale?: string | null`. The Kysely-generated types (`packages/api/src/generated/kysely-types.ts`) will also reflect the new column after running `prisma generate`.

---

## 4. Batch Translation Script

### 4.1 Location

```
packages/api/src/scripts/translate-dish-names.ts
```

This is a standalone CLI script. It is NOT part of the API server. It runs once post-migration, connects directly to the database via Prisma (same `getPrismaClient()` singleton pattern), and calls OpenAI gpt-4o-mini.

### 4.2 CLI Interface

```
npx tsx src/scripts/translate-dish-names.ts [options]

Options:
  --dry-run          Print what would be translated without writing to DB (default: false)
  --chain <slug>     Limit to dishes of a specific chain (optional)
  --batch-size <n>   Number of names per OpenAI request (default: 50)
  --concurrency <n>  Number of parallel OpenAI requests (default: 3)
```

Exit codes: `0` = success, `1` = partial failure (some dishes failed), `2` = fatal error (DB or API key unavailable).

### 4.3 Translation Decision Tree

For each dish, the script must classify the name and decide the translation action before calling the LLM. Classification is done locally (no API call):

```
Input: dish.name (string), dish.restaurant.chain_slug (string)

Step 1 — Brand name detection:
  - Apply brand name list derived from chain registry
    (e.g., "Whopper", "Big Mac", "McFlurry", "Croissan'wich")
  - If match: nameEs = name (copy as-is), nameSourceLocale = 'en', action = 'brand_copy'

Step 2 — Already-Spanish detection:
  - Heuristic: name contains high-frequency Spanish words
    (list: "con", "de", "del", "al", "sin", "pollo", "ternera", "jamón", "queso",
           "ensalada", "patatas", "salsa", "pechuga", "menú")
  - If 2+ Spanish indicator words found: nameEs = name, nameSourceLocale = 'es', action = 'es_copy'

Step 3 — Short / ambiguous detection:
  - If name.length <= 3 (single abbreviations, codes): nameEs = name,
    nameSourceLocale = 'unknown', action = 'short_copy'

Step 4 — LLM translation:
  - All remaining names (descriptive English): send to gpt-4o-mini
  - nameSourceLocale = 'en', action = 'translated'
```

### 4.4 OpenAI Request Format

Model: `gpt-4o-mini`
Mode: batch (up to 50 dish names per request to minimize API calls and cost)

System prompt:
```
You are a food translator. Translate the following restaurant dish names from English to Spanish.
Rules:
- Proper nouns and brand names (e.g., "Big Mac", "Whopper", "McFlurry") must be kept as-is.
- Translate descriptive terms accurately (e.g., "Grilled Chicken Salad" → "Ensalada de Pollo a la Plancha").
- Preserve capitalization style of the original.
- Return ONLY a JSON array of translated strings, in the same order as input.
- Do NOT add explanations.
```

User message: JSON array of English dish names.

Expected response: JSON array of Spanish strings (same length and order).

### 4.5 Error Handling in Script

- **OpenAI API unavailable or rate-limited**: retry up to 3 times with 2s exponential backoff. On final failure, record all dishes in the batch as errors and continue.
- **JSON parse failure on response**: log error, mark all dishes in batch as `action = 'error'`, continue.
- **Array length mismatch in response**: log error, skip entire batch (do not write partial results), continue.
- **DB write failure**: log per-dish error, continue with next dish.
- **Dry run**: print a table to stdout: `dishId | name | action | nameEs (proposed)`. Do not write.

### 4.6 DB Write per Dish

For each dish, a single `prisma.dish.update()`:

```
{
  where: { id: dish.id },
  data: {
    nameEs: <translated or copied string>,
    nameSourceLocale: <'en' | 'es' | 'mixed' | 'unknown'>
  }
}
```

`name` is NEVER modified (ADR-001: immutable). `updatedAt` is automatically bumped by Prisma `@updatedAt`.

### 4.7 Progress Output

The script must log progress to stdout in a format compatible with the existing `console.log`-based convention:

```
[translate-dish-names] Starting: 883 dishes to process
[translate-dish-names] Step 1: 12 brand names → copied as-is
[translate-dish-names] Step 2: 145 already-Spanish names → copied as-is
[translate-dish-names] Step 3: 2 short/ambiguous names → copied as-is
[translate-dish-names] Step 4: 724 names to translate via gpt-4o-mini
[translate-dish-names] Translating batch 1/15 (50 names)...
...
[translate-dish-names] Done: 881 succeeded, 2 failed
[translate-dish-names] Estimated cost: ~$0.20
```

### 4.8 npm Script

Add to `packages/api/package.json`:

```json
"translate:dish-names": "tsx src/scripts/translate-dish-names.ts",
"translate:dish-names:dry-run": "tsx src/scripts/translate-dish-names.ts --dry-run"
```

---

## 5. Ingest Pipeline Fix

### 5.1 Problem

`parseNutritionTable()` (`packages/api/src/ingest/nutritionTableParser.ts`) does not populate `nameEs` on `RawDishData`. It produces:

```typescript
{ name: "Grilled Chicken Salad", nutrients: {...}, sourceUrl, scrapedAt, aliases: [], ... }
// nameEs is absent → normalizeDish passes undefined → DB write leaves name_es = NULL
```

### 5.2 Fix: Language-Aware Name Population in Ingest Routes

The fix is applied at the ingest route level (PDF ingest, URL ingest, image ingest), NOT inside `parseNutritionTable`. This preserves the parser as a pure function and avoids adding LLM calls to the hot path.

**Rule for ingest routes:**

When persisting dishes from the ingest pipeline, the route handler must determine `nameEs` and `nameSourceLocale` before calling `persistDishUtil()`:

```
For each RawDishData item produced by parseNutritionTable:
  If chainSlug is known AND chain's source language is 'es':
    → nameEs = name, nameSourceLocale = 'es'
  Else (chain PDF is English-language):
    → nameEs = undefined (left NULL), nameSourceLocale = 'en'
    → emit a structured log warning: [ingest] nameEs not set for dish "${name}" — run translate-dish-names script
```

The rationale for not calling gpt-4o-mini at ingest time: PDF ingest is a synchronous HTTP request with a 30s timeout. Adding LLM calls to the ingest path violates the latency SLA and the "no external API in critical ingest path" principle (ADR-000, ADR-010).

### 5.3 Chain Source Locale Registry

A new exported constant in `packages/api/src/ingest/chainLocaleRegistry.ts` (or co-located with the PDF chain registry):

```typescript
// Maps chain_slug → primary source locale of their PDF nutritional documents.
// Used by ingest routes to decide whether to copy name → name_es.
export const CHAIN_SOURCE_LOCALE: Record<string, 'en' | 'es'> = {
  'mcdonalds-es':        'en',   // Scraper extracts English names
  'burger-king-es':      'en',   // PDFs are English
  'kfc-es':              'en',   // PDFs are English
  'telepizza-es':        'es',   // PDFs are Spanish
  'dominos-es':          'es',   // OCR output is Spanish
  'five-guys-es':        'en',   // PDFs are English (disabled — allergen only)
  'subway-es':           'en',   // PDFs are English (EU nutritional format)
  'pans-and-company-es': 'es',   // PDFs are Spanish/Portuguese (Ibersol)
};
```

If a chain slug is NOT in this registry, the ingest route defaults to `nameSourceLocale = 'unknown'` and leaves `nameEs` unset.

### 5.4 normalizeDish() — No Changes Required

`normalizeDish()` in `packages/scraper/src/utils/normalize.ts` already passes `nameEs` through from `raw.nameEs`. No changes to this function. The fix is upstream (ingest routes set `nameEs` on `RawDishData` before calling normalizers) or downstream (ingest routes set `nameEs` after normalization, before DB write).

The preferred approach is: mutate `raw.nameEs` on each `RawDishData` item (in the loop at Step 8 of the route handler, before calling `normalizeNutrients` + `normalizeDish`) so that `NormalizedDishData.nameEs` is populated when the dish is written to the DB. For the `nameSourceLocale` field, set it directly on the Prisma create/update payload since `NormalizedDishData` does not have a `nameSourceLocale` field (it is a DB metadata column not part of the normalized pipeline contract).

### 5.5 Chain Scrapers — No Changes Required for Spanish Chains

The existing chain scraper pattern already handles this:

```typescript
// From spec_patterns.md F008 note:
// Spanish-language chains (.es domains): nameEs = name (name IS already Spanish)
```

Scrapers for McDonald's ES, Burger King ES etc. must be verified to populate `nameEs` correctly. If they currently leave `nameEs = undefined` for English-language chains, this is acceptable — the batch translation script handles the backfill, and future scrapes will be handled by the ingest fix.

---

## 6. Embedding Regeneration

### 6.1 Why Regeneration Is Needed

`buildDishText()` in `packages/api/src/embeddings/textBuilder.ts` includes:

```typescript
if (dish.nameEs !== null) {
  line1 += ` Spanish name: ${dish.nameEs}.`;
}
```

Currently, 883 dishes have `nameEs = null`, so their embeddings omit the "Spanish name: ..." line. After populating `nameEs`, embeddings must be regenerated to include the bilingual text and improve L3 cross-lingual matching.

### 6.2 No Code Changes Required

`buildDishText()` already handles `nameEs` correctly. The pipeline already supports `force=true` mode to regenerate all embeddings regardless of `embedding_updated_at`.

### 6.3 Regeneration Command

After the batch translation script completes:

```bash
npm run embeddings:generate --target=dishes --force
```

This uses the existing `runEmbeddingPipeline()` with `force: true`, which clears and rewrites all dish embeddings. The `embedding_updated_at` timestamp is updated per dish after successful write.

### 6.4 Cost Estimate

~885 dish embeddings × avg ~60 tokens/embedding = ~53,100 tokens ≈ $0.003 at text-embedding-3-small pricing. Negligible.

---

## 7. Files Affected (No New API Endpoints)

### New Files

| File | Purpose |
|------|---------|
| `packages/api/src/scripts/translate-dish-names.ts` | Batch translation CLI script |
| `packages/api/src/ingest/chainLocaleRegistry.ts` | Chain slug → source locale map |
| `packages/api/prisma/migrations/<timestamp>_add_name_source_locale/migration.sql` | DB migration |

### Modified Files

| File | Change |
|------|--------|
| `packages/api/prisma/schema.prisma` | Add `nameSourceLocale String? @map("name_source_locale") @db.VarChar(5)` to `Dish` model |
| `packages/api/src/routes/ingest/pdf.ts` | Set `nameEs` and `nameSourceLocale` on each `raw` dish before `normalizeDish()` (Step 8) |
| `packages/api/src/routes/ingest/url.ts` | Same as above |
| `packages/api/src/routes/ingest/image-url.ts` | Same as above (chain locale lookup by chainSlug body param) |
| `packages/api/package.json` | Add `translate:dish-names` and `translate:dish-names:dry-run` npm scripts |

### No Changes

| File | Reason |
|------|--------|
| `packages/api/src/estimation/level1Lookup.ts` | Already uses `COALESCE(name_es, name)` — works correctly once `name_es` is populated |
| `packages/api/src/embeddings/textBuilder.ts` | Already handles `nameEs` nullable — works correctly once `name_es` is populated |
| `packages/api/src/embeddings/pipeline.ts` | `force=true` mode already exists |
| `packages/scraper/src/utils/normalize.ts` | `normalizeDish()` already passes `raw.nameEs` through |
| `packages/scraper/src/base/types.ts` | `RawDishData.nameEs` already defined as optional |
| `docs/specs/api-spec.yaml` | No API changes in this feature |

---

## 8. Acceptance Criteria

All criteria are verifiable by automated test or direct DB/stdout inspection.

| # | Criterion | How to Verify |
|---|-----------|---------------|
| AC-1 | Migration applies cleanly | `prisma migrate deploy` exits 0; `\d dishes` shows `name_source_locale VARCHAR(5)` column |
| AC-2 | `name` field is unchanged for all dishes | `SELECT COUNT(*) FROM dishes WHERE name IS NULL OR name = ''` = 0 before and after |
| AC-3 | After batch script: 0 dishes with `name_es = NULL` | `SELECT COUNT(*) FROM dishes WHERE name_es IS NULL` = 0 |
| AC-4 | After batch script: `name_source_locale` is set for all dishes | `SELECT COUNT(*) FROM dishes WHERE name_source_locale IS NULL` = 0 |
| AC-5 | Brand names preserved verbatim | `SELECT name, name_es FROM dishes WHERE name IN ('Whopper', 'Big Mac', 'McFlurry')` → `name = name_es` |
| AC-6 | Spanish-language names copied (not translated) | `SELECT name, name_es FROM dishes WHERE name_source_locale = 'es'` → `name = name_es` |
| AC-7 | Descriptive English names translated to Spanish | `SELECT name, name_es FROM dishes WHERE name_source_locale = 'en' AND name != name_es LIMIT 10` — manual review of 10 samples |
| AC-8 | Embedding regeneration completes | `SELECT COUNT(*) FROM dishes WHERE embedding_updated_at IS NULL` = 0 after `embeddings:generate --target=dishes --force` |
| AC-9 | L1 FTS Spanish query hits for a translated dish | Integration test: query "ensalada de pollo" with `chainSlug=mcdonalds-es` → `level1Hit: true` (was previously L3/L4) |
| AC-10 | Future PDF ingest populates `name_es` | Integration test: ingest a mock English PDF → all produced dishes have `nameEs` set OR have a structured warning log |
| AC-11 | Dry-run mode writes nothing | Run `translate:dish-names:dry-run` → `SELECT COUNT(*) FROM dishes WHERE name_es IS NOT NULL` unchanged |

---

## 9. Edge Cases

| Case | Handling |
|------|---------|
| Brand name appears inside a descriptive name ("Big Mac Salad") | Brand detection is substring-based; entire name treated as brand copy if brand is dominant prefix. Open question: should "Big Mac Salad" be copied or translated to "Ensalada Big Mac"? Spec decision: send to LLM with brand-name preservation instruction — the system prompt already handles this. |
| Name in both languages ("Chicken / Pollo") | `name_source_locale = 'mixed'`; send to LLM; translated result keeps Spanish portion. |
| Very long name (>200 chars) | Truncation not applied. gpt-4o-mini context window is 128k — not a concern at dish name lengths. |
| Empty `name` | Should not exist (DB constraint: `name VARCHAR(255)` NOT NULL). Skip and log error if encountered. |
| Accented characters in English name ("Café Latte") | Treat as English (not Spanish) unless 2+ Spanish indicator words present. LLM handles correctly. |
| Dish name is a number or code ("1234", "X-5") | Short copy rule applies (length ≤ 3 for single chars). For longer codes, heuristic: all non-alpha tokens → `nameEs = name`, `nameSourceLocale = 'unknown'`. |
| Network failure mid-batch | Continue-on-failure: failed dishes are logged, script exits with code 1. Script is idempotent — re-running it skips dishes where `name_es IS NOT NULL` (add a `--skip-existing` default behavior). |
| Re-running script after partial failure | Script must check `WHERE name_es IS NULL` by default (skip already-translated dishes). `--force` flag overrides to retranslate all. |
| Chain slug not in `CHAIN_SOURCE_LOCALE` registry | Default: `nameSourceLocale = 'unknown'`, `nameEs` left unset at ingest time. Batch script still translates via LLM classification. |
| Dish already has a manually set `name_es` | Script respects existing `name_es` (skip by default). Only NULL rows are processed. |
| gpt-4o-mini translates a brand name incorrectly | System prompt instructs to preserve proper nouns. Post-run: brand names are pre-classified locally and never sent to LLM. So this risk is mitigated for known brands. Unknown brand names may be incorrectly translated — acceptable for MVP. |

---

## 10. Execution Order (One-Time Migration Runbook)

This runbook is for the operator running F038 in production. It is NOT part of the automated CI pipeline.

```
1. Deploy migration:       prisma migrate deploy
2. Verify column exists:   psql -c "\d dishes" | grep name_source_locale
3. Dry run translation:    npm run translate:dish-names:dry-run
4. Review dry run output:  spot-check 20 brand names, 20 Spanish names, 20 English translations
5. Run translation:        npm run translate:dish-names
6. Verify AC-3 and AC-4:  psql -c "SELECT COUNT(*) FROM dishes WHERE name_es IS NULL"
7. Regenerate embeddings:  npm run embeddings:generate -- --target=dishes --force
8. Verify AC-8:            psql -c "SELECT COUNT(*) FROM dishes WHERE embedding_updated_at IS NULL"
9. Smoke test L1:          curl "http://localhost:3001/estimate?query=ensalada+de+pollo&chainSlug=mcdonalds-es"
```

---

## 11. API Spec Changes

None. This feature adds no new endpoints and modifies no existing response schemas. `docs/specs/api-spec.yaml` is not modified.

The `nameSourceLocale` field is an internal metadata column. It is not exposed in any existing API response shape (dish endpoints return `name` and `nameEs` but not `nameSourceLocale`). If a future ticket adds it to an API response, a separate spec update is required.
