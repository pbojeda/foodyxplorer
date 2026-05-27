# Architectural Decisions

Track important technical decisions with context, so future sessions understand WHY things are the way they are.

## Format

```markdown
### ADR-XXX: Decision Title (YYYY-MM-DD)

**Context:** Why the decision was needed
**Decision:** What was chosen
**Alternatives Considered:** Options and why rejected
**Consequences:** Benefits and trade-offs
```

---

<!-- Add ADR entries below this line -->

### ADR-019: Canonical Disambiguation Aliases for Culturally-Common Spanish Short-Form Terms (2026-04-12)

**Context:** Ambiguous plain Spanish drink/food queries (`vino`, `cerveza`, …) were resolving to specialty variants instead of the culturally-common default serving. `level1Lookup.ftsDishMatch` in `packages/api/src/estimation/level1Lookup.ts` falls back to FTS (`to_tsvector('spanish', ...) @@ plainto_tsquery('spanish', ...)`) and orders by `priority_tier ASC, length(name_es) ASC LIMIT 1`. That tie-breaker (shortest name wins) is anti-correlated with cultural intent, because specialty items tend to have shorter names than the canonical defaults ("Manzanilla (vino)" wins over "Copa de vino tinto" by 1 char). See BUG-PROD-003 for the empirical trace.

**Decision:** For culturally-common Spanish short-form food/drink terms, add the bare singular form as an **alias** on the preferred canonical dish in `packages/api/prisma/seed-data/spanish-dishes.json`. Strategy 1 (`exactDishMatch`, GIN-indexed `d.aliases @> ARRAY[${query}]`) hits first, bypassing the FTS tie-break entirely.

Rules for picking the canonical target dish:
- Prefer dishes with `source: "bedca"` or another Tier 1 source so nutrients are backed by official data.
- Prefer servings that match what a Spanish user would actually be asking about ("vino" → Copa de vino tinto, "cerveza" → Cerveza lata in tercio semantics).
- When the user's own wording in the bug report provides a literal preference ("un tercio de cerveza"), honor it.
- **Scope of the "exactly one owner" invariant:** the rule that a term is claimed by exactly one dish applies **only to the disambiguation list** (the terms added under this ADR). It is NOT a universal codebase rule — the existing dataset already tolerates multi-owner aliases like `"manzanilla"` (Infusión de manzanilla + Copa de fino) and `"arroz con verduras"` (Paella de verduras + Arroz con verduras y huevo). Those are pre-existing data collisions logged as follow-up work in `bugs.md`, not invariants this ADR tries to enforce retroactively. The invariant test in `packages/api/src/__tests__/bug-prod-003.disambiguation.test.ts` only guards the terms this ADR added (`vino`, `cerveza`), so adding a new canonical disambiguation here requires adding its per-term uniqueness assertion to that file.

**Alternatives Considered:**
- **Ranking tweak (add `ts_rank()` to ORDER BY):** broad regression surface across all short queries. Not warranted for a handful of terms. Rejected.
- **Dedicated `canonical_aliases` table with priority field:** over-engineered for current volume (two terms). Reconsider if the backlog grows past ~20 canonical defaults. Follow-up work.
- **LLM pre-dispatch disambiguation:** L4 LLM already exists but only runs when L1/L2/L3 all miss. Adding a pre-L1 LLM step would bloat latency and cost for a deterministic data fix.
- **Telemetry-driven backfill script** (Codex suggestion): good idea, deferred as follow-up ticket. Would iterate every single-token Spanish noun and assert its top L1 match is not a specialty variant.

**Consequences:**
- **Pros:** Surgical, additive, zero-risk data change. Fully covered by existing GIN index. No schema migration. Rollback is to delete two JSON strings.
- **Cons:** Manual curation per term — doesn't scale beyond ~20 items without the tooling follow-up. New dishes that collide with an existing canonical alias will need explicit disambiguation.
- **Follow-up (captured in `bugs.md` BUG-PROD-003 entry):** audit the remaining ambiguous singletons flagged by Codex/Gemini — `pan`, `leche`, `manzana`, `arroz`, `cafe`, `chocolate`, `jamon`, `queso`, `tostada`, `pollo`, `pescado`, `marisco`, `refresco`, `zumo`, `cava`. Build a script that lists every single-token Spanish noun in the dataset lacking an alias path, then triage.

### ADR-000: Initial Stack and Architecture (2026-03-10)

**Context:** Selecting the technology stack for a nutritional information platform focused on Spanish restaurants. The product needs: relational data with complex joins, vector similarity search (pgvector), real-time API, Telegram bot, and future web/mobile apps. Single founder with 20+ years Node.js experience.

**Decision:**
- **Runtime:** Node.js + TypeScript (strict mode)
- **API Framework:** Fastify (over Express, NestJS)
- **ORM Strategy:** Prisma (migrations + CRUD) + Kysely (complex queries, pgvector)
- **Database:** PostgreSQL 16 + pgvector extension + JSONB for flexible micronutrient data
- **Cache:** Redis (LLM response cache + API rate limiting)
- **Validation:** Zod schemas in shared workspace (single source of truth)
- **Monorepo:** npm workspaces (`packages/api`, `packages/bot`, `packages/shared`)
- **Branching:** gitflow (main + develop + feature/*)
- **Infra:** Docker Compose for local dev; Railway/Render for staging/prod (early stage)

**Alternatives Considered:**
- Python: Rejected — team expertise is Node.js (20+ years)
- MongoDB: Rejected — complex relational model (foods → nutrients → dishes → restaurants) requires SQL; flexibility covered by JSONB columns
- Express: Rejected — lower performance, no built-in OpenAPI generation
- NestJS: Rejected — excessive overhead for MVP
- Only Prisma: Rejected — limited pgvector support, poor control of complex aggregations
- Only Kysely: Rejected — less robust migration management
- SQL puro: Rejected — no managed migrations

**Consequences:**
- (+) Type safety end-to-end with Zod + Prisma + Kysely
- (+) pgvector integrated in PostgreSQL — no separate vector store needed
- (+) Fastify auto-generates OpenAPI docs
- (-) Two query layers (Prisma + Kysely) require clear usage rules (documented in key_facts.md)
- (-) npm workspaces less mature than Turborepo, but sufficient for 3 packages

### ADR-001: Estimation Engine — Motor Calculates, LLM Interprets (2026-03-10)

**Context:** The core product is a nutritional estimation engine. The temptation is to use the LLM to calculate nutritional values directly. This would be faster to build but unreliable and unauditable.

**Decision:** The estimation engine is deterministic and auditable. Three levels cascade: Level 1 (official data) → Level 2 (ingredient-based calculation) → Level 3 (pgvector similarity extrapolation). The LLM is used ONLY for: (a) parsing natural language queries into structured queries, (b) formatting responses. The LLM NEVER calculates nutritional values.

**Alternatives Considered:**
- LLM as calculation engine: Rejected — inconsistent results, not auditable, expensive at scale, hallucination risk on nutritional data
- Hybrid (LLM calculates + human validates): Rejected — doesn't scale, validation bottleneck

**Consequences:**
- (+) Every nutritional value is traceable to a source (data_sources table)
- (+) Confidence levels are deterministic and testable
- (+) Cost per query is predictable (Redis cache for LLM calls)
- (-) More implementation effort for Levels 2 and 3
- (-) Edge cases require fallback to LLM for ingredient parsing (documented, cached)

### ADR-002: Core Schema Design — pgvector, XOR Constraint, Dual FTS (2026-03-10)

**Context:** Designing the 4 foundational tables (`data_sources`, `foods`, `food_nutrients`, `standard_portions`) for a nutritional platform that requires vector similarity search, full-text search in two languages, and strict data integrity constraints that Prisma cannot express natively.

**Decision:**

1. **pgvector as `Unsupported` column in Prisma.** The `embedding vector(1536)` column on `foods` is declared as `Unsupported("vector(1536)")?` in `schema.prisma`. Prisma generates the `CREATE TABLE` statement including the column, so no `ALTER TABLE` is needed. All reads/writes to this column must use `prisma.$queryRaw` or `prisma.$executeRaw`. The column is NOT exposed in the shared Zod schemas (not representable as JSON).

2. **XOR constraint via raw SQL `CHECK`.** `standard_portions` must have exactly one of `food_id` or `food_group` set. Prisma cannot express CHECK constraints, so the constraint is added as raw SQL in the migration file (`ALTER TABLE ... ADD CONSTRAINT ... CHECK`). The constraint is also enforced at the Zod layer via `.refine()` on `CreateStandardPortionSchema` — both layers are required.

3. **Dual FTS indexes (Spanish + English).** `foods` has two GIN full-text search indexes: one for `name` (English, `to_tsvector('english', ...)`) and one for `name_es` (Spanish, `to_tsvector('spanish', ...)`). These cannot be expressed in Prisma schema and are added as raw SQL in the migration. The platform targets Spain, so Spanish FTS is primary, but English FTS is needed for international data sources (USDA).

4. **Migration applied with `migrate deploy` instead of `migrate dev`.** The `migrate dev` command uses a shadow database to validate the migration before applying it. The shadow database does not have the `pgvector` extension, causing validation to fail. `migrate deploy` applies migrations directly without a shadow database, which is the correct command for CI/CD and for migrations using extensions not present in the shadow DB.

**Alternatives Considered:**
- Omit embedding from Prisma schema (ALTER TABLE only): Rejected — `Unsupported` gives better Prisma Studio visibility and clearer intent in schema.
- Single FTS language: Rejected — data sources are primarily English (USDA); end-user queries are Spanish.
- Use `@@index` for FTS in Prisma: Rejected — Prisma does not support GIN or tsvector indexes; must be raw SQL.
- Express XOR only in application code: Rejected — DB constraints are the last defense against data corruption and must be independent of application code.

**Consequences:**
- (+) `embedding` column is visible in Prisma Studio and schema is self-documenting
- (+) XOR and CHECK constraints are enforced at both API and DB layers — defense in depth
- (+) Dual FTS supports multilingual search without additional infrastructure
- (-) Raw SQL in migration files requires manual maintenance if tables are altered
- (-) `migrate dev` cannot be used during development if the shadow DB lacks pgvector; use `migrate deploy` for applying existing migrations

### ADR-003: Schema Enhancements Based on Nutrition API Research (2026-03-11)

**Context:** Before building F002 (Dishes & Restaurants), a comparative analysis of 7 major nutrition APIs (USDA FoodData Central, Nutritionix, Edamam, Open Food Facts, Calorie Mama, FatSecret, Spoonacular) was conducted to validate our data model and identify gaps.

**Decision:**
1. **Add `FoodType` enum** (`generic`, `branded`, `composite`) to `Food`. Every API distinguishes branded products from generic foods from composite dishes/recipes. This is the primary discriminator for data import and composition modeling.
2. **Add `brandName` and `barcode`** to `Food`. Universal identifiers in the nutrition API ecosystem. `barcode` (UPC/EAN/GTIN) is distinct from `externalId` (source-specific ID).
3. **Add `NutrientReferenceBasis` enum** (`per_100g`, `per_serving`, `per_package`) to `FoodNutrient`. Every API is explicit about reference basis; ours was implicit. Default `per_100g` (industry standard).
4. **Add `description` and `isDefault`** to `StandardPortion`. Every API provides human-readable portion labels ("1 cup", "1 slice") and marks one as default. Our `notes` field is freeform and insufficient for this.
5. **Add typed columns for common nutrients** (`transFats`, `cholesterol`, `potassium`, `monounsaturatedFats`, `polyunsaturatedFats`) to `FoodNutrient`. Present in every API (17-160 nutrients). Too common to leave in `extra` JSONB.
6. **Add `Recipe` and `RecipeIngredient` tables** for composite food modeling. The recipe links to a `Food` where `foodType=composite`, with ingredients referencing other foods with amounts and gram weights.

**Alternatives Considered:**
- Keep schema as-is, add fields later: Rejected — easier to extend now before F002 builds on top of these tables.
- Store all nutrients in JSONB: Rejected — loses type safety and query performance for the most common nutrients.
- Use a generic `FoodAttribute` table: Rejected — EAV pattern is slow and hard to query for the 15 core nutrients every query needs.
- Multilingual names (FoodTranslation table): Deferred — `name` + `nameEs` is sufficient for Phase 1. Revisit before Phase 2.

**Consequences:**
- (+) Schema aligns with industry standards — easier data import from any external API
- (+) `foodType` enables clean polymorphism: generic foods, branded products, and composite dishes in one table
- (+) Recipe model enables F002's dish modeling with proper ingredient composition
- (+) Typed nutrient columns improve query performance and type safety for common nutrients
- (-) Migration adds 2 new tables + 1 new enum + several new columns — requires updating existing tests and seed data
- (-) `barcode` index adds storage overhead (acceptable for packaged food lookup speed)

### ADR-004: Dishes & Restaurants Schema Design (2026-03-11)

**Context:** Designing the restaurant/dish layer (F002) — 8 new tables to model restaurant chains, menu items, dish nutritional data, dish ingredients, cooking methods, and dish categories. Key design questions: tables vs enums for lookup data, FK behavior for decoupled dish/food models, nutrient reference basis for restaurant data, and many-to-many relationship modeling.

**Decision:**

1. **Tables over enums for `cooking_methods` and `dish_categories`.** Both need Spanish labels (`name_es`), flexible ordering (`sort_order` on categories), and extensibility via INSERT (new cooking methods like "air-fried" without schema migration). `DishAvailability` remains an enum — stable state machine with no i18n or ordering needs.

2. **`dish.food_id` nullable FK with `ON DELETE SET NULL`.** A dish can exist before its food composition is known. Restaurant data arrives faster than composition analysis. Deleting a food does not cascade-delete the dish — the dish retains its own `dish_nutrients` and can be re-linked later. This decouples the restaurant data pipeline from the food analysis pipeline.

3. **`dish_nutrients.reference_basis` defaults to `per_serving`** (not `per_100g` like `food_nutrients`). Restaurant nutritional disclosures (official PDFs, Nutritionix restaurant items) are always per-serving. The calories upper bound is 9000 (not 900) to accommodate combo meals and family platters.

4. **`restaurants(chain_slug, country_code)` unique constraint.** McDonald's Spain and McDonald's Portugal are different market entities with different menus and prices. One row per chain per country, no schema changes needed for international expansion. `country_code` validated via `CHECK (~ '^[A-Z]{2}$')`.

5. **`estimation_method` on both `dishes` and `dish_nutrients`.** How the dish was identified (scraped, manual, official PDF) is independent from how the nutrients were derived (official, ingredient-based calculation, extrapolation). Both facts are tracked separately for full auditability per ADR-001.

6. **Many-to-many via junction tables with composite PKs.** `dish_cooking_methods` and `dish_dish_categories` use `@@id([dishId, lookupId])` — no surrogate UUID PK needed. `ON DELETE CASCADE` from dish side (deleting a dish removes junction rows), `ON DELETE RESTRICT` from lookup side (cannot delete a cooking method or category that is still referenced).

**Alternatives Considered:**
- Enums for cooking_methods/dish_categories: Rejected — no i18n support, requires ALTER TYPE for new values, no sortOrder possible.
- `dish.food_id` NOT NULL: Rejected — forces creating a Food before adding a menu item, coupling two independent data pipelines.
- `per_100g` default on dish_nutrients: Rejected — restaurant data universally uses per-serving, would require constant overriding.
- Single `estimation_method` on dish only: Rejected — dish identification method and nutrient derivation method are independent facts.
- Junction tables with surrogate UUID PK: Rejected — unnecessary overhead, composite PK is the natural key.

**Consequences:**
- (+) Schema supports restaurant data import from any source without requiring food composition first
- (+) Cooking methods and categories are i18n-ready and admin-panel-editable without code changes
- (+) Full auditability: every dish and every nutrient value is traceable to a source and estimation method
- (+) International expansion requires only new rows, not schema changes
- (-) 8 new tables + 2 junction tables add schema complexity
- (-) Junction table queries require explicit joins (no Prisma implicit M:N since we use explicit models)

### ADR-005: Chain Scrapers Require Per-Product Nutrition on Website (2026-03-13)

**Context:** F009 (Burger King Spain Scraper) was spec'd and planned following the F008 (McDonald's) pattern — `BaseScraper` subclass that extracts nutritional data from individual product pages via HTML/JSON-LD. During implementation Step 3 (site inspection), we discovered that BK Spain does **not** publish per-product nutritional data on its website. Instead, all nutrition data is in a single centralized PDF on AWS S3, updated monthly.

**Investigation details:**
- BK Spain's product pages (e.g., `/es/menu/item-item_11116`) show product name and description but **no nutrition section** — only links to PDF downloads.
- The Sanity CMS GraphQL API (`czqk28jt.apicdn.sanity.io`) returns product metadata but `allFeatureNutrition: []` (empty).
- The menu page only links to category sections (`/es/menu/section-UUID`), not individual products.
- Nutrition PDF URL pattern: `https://eu-west-3-146514239214-prod-bk-fz.s3.eu-west-3.amazonaws.com/en-ES/[YEAR]/Nutritional+Information/MANTEL+NUTRICIONAL+ESP+ING+[MONTH][YEAR].pdf`

**Decision:** F009 is blocked. The `BaseScraper` pattern (per-product-page extraction) only applies to chains that publish nutritional data inline on their website. Before starting any chain scraper, a **site inspection step** must verify that per-product nutrition data is available on the website. Chains that only publish nutrition via PDFs require a different approach (PDF ingestion pipeline, not web scraper).

**Alternatives Considered:**
- Force-fit the scraper to download and parse the PDF: Rejected — fundamentally different pattern, breaks BaseScraper's per-page model, PDF parsing is a separate concern better handled by F007b or a dedicated PDF pipeline feature.
- Hybrid API + PDF: Deferred — viable but adds complexity; consider when more chains are found to be PDF-only.
- Scrape the Sanity API directly: Rejected — API has no nutrition data.

**Consequences:**
- (+) Clear architectural boundary: `BaseScraper` = per-product-page scraping only
- (+) Prevents wasted effort on chains with incompatible architectures
- (+) F007b (PDF ingestion) already handles the PDF use case — BK's PDF can be uploaded manually
- (-) BK Spain (2nd largest fast-food chain) cannot be automated with the current scraper pattern
- (-) Future PDF-pipeline feature needed to automate PDF-only chains
- **Action:** All future chain scrapers (F010-F017) must include site inspection as Step 1 in their implementation plan before writing any code

### ADR-006: E002 Pivot — PDF-First Ingestion Strategy (2026-03-13)

**Context:** After completing F008 (McDonald's scraper), we investigated 6 of the 9 remaining chains (BK, KFC, Telepizza, Domino's, Subway, Five Guys) using Playwright on their live websites. Finding: ~85% of Spanish fast-food chains publish nutritional data exclusively in PDFs (regulatory compliance documents), not as structured data on product pages. McDonald's is the exception, not the rule. The original E002 strategy assumed one web scraper per chain (F009-F017), which is fundamentally misaligned with market reality.

Meanwhile, F007b (POST /ingest/pdf) already provides a complete PDF ingestion pipeline: `extractText` (pdf-parse) → `parseNutritionTable` (heuristic regex parser, ES/EN) → `normalizeNutrients` + `normalizeDish` → Prisma `$transaction` upsert. The only missing piece is automated PDF download from known URLs.

**Investigation results:**

| Chain | Web nutrition data | Actual data source |
|-------|-------------------|--------------------|
| McDonald's (F008) | YES — JSON-LD + HTML | Web per-product (done) |
| Burger King | No | PDF on S3 AWS (monthly) |
| KFC | No | Static PDF: static.kfc.es/pdf/contenido-nutricional.pdf |
| Telepizza | No | PDF on Salesforce CDN |
| Five Guys | No | PDF on fiveguys.es/app/uploads/ |
| Domino's | No | JPEG images (not PDF): alergenos.dominospizza.es/img/ |
| Subway | No | No Spain-specific source; US PDFs only |

**Decision:** Restructure E002 features F009-F017 from "one web scraper per chain" to a PDF-first pipeline strategy:

1. **F009 → PDF Auto-Ingest Pipeline.** New endpoint `POST /ingest/pdf-url` that downloads a PDF from a URL and pipes it through the existing F007b pipeline (`extractText` → `parseNutritionTable` → normalize → persist). Reuses ~90% of existing code.

2. **F010 → Chain PDF Registry + Batch Runner.** Config-driven registry mapping each chain to its PDF URL, restaurantId, sourceId, and update frequency. CLI command to run all or individual chains. Includes seed data for creating restaurant + dataSource rows for BK, KFC, Telepizza, Five Guys.

3. **F011 → Chain Onboarding (PDF chains).** Verify `parseNutritionTable` works with each real PDF. Create test fixtures per chain. Adjust parser if any PDF has unexpected format. Covers: BK, KFC, Telepizza, Five Guys.

4. **F012 → Image/OCR Ingestion Pipeline.** Separate pipeline for Domino's (JPEG images, not PDF). Uses OCR (Tesseract.js or similar) to extract text from images, then feeds into `parseNutritionTable`. Domino's is explicitly excluded from the PDF pipeline.

5. **F013 → Subway Spain Data Research.** Investigation-only: find viable data source for Subway Spain (no .es website, no Spain-specific PDF). May use US data with manual mapping.

6. **F014-F017 → Reserved for additional chains** (VIPS, Pans & Company, 100 Montaditos, others). Each is config + verification, not new code.

7. **BaseScraper (F007/F008) is preserved** for chains that do publish structured web data. McDonald's remains on the web scraper pattern.

**Alternatives Considered:**
- Keep per-chain scraper strategy, adapt each to download PDF: Rejected — unnecessary code duplication; the pipeline is identical for all PDF chains, only the URL differs.
- Extend F007b to accept URL parameter: Rejected — mixing upload and download in one endpoint violates single responsibility; better as a separate route that internally calls the same pipeline.
- Skip Domino's entirely: Deferred — OCR pipeline has value beyond Domino's (scanned menus, photos of nutritional labels).
- Use LLM for PDF parsing instead of heuristic regex: Rejected — parseNutritionTable already works, is deterministic, free, and fast. LLM adds cost and non-determinism per ADR-001.

**Consequences:**
- (+) Dramatically reduces implementation effort: ~100 LOC for F009 vs ~500+ LOC per chain scraper
- (+) Each new chain is a config entry, not a feature — scales to 50+ chains with no new code
- (+) Reuses proven F007b infrastructure (parseNutritionTable, extractText, normalize, persist)
- (+) Domino's (JPEG) is explicitly separated, preventing a PDF pipeline from silently failing on images
- (+) BaseScraper pattern preserved for future chains with structured web data
- (-) Heuristic parser may need tuning per chain's PDF format (handled in F011)
- (-) OCR pipeline (F012) adds a new dependency (Tesseract.js) and is less reliable than text-based parsing
- (-) Subway Spain may have no viable automated data source

### ADR-007: Chain Text Preprocessor for Real-World PDF Layouts (2026-03-16)

**Context:** F011 (Chain Onboarding) investigation revealed that real-world PDF nutrition tables from BK, KFC, and Telepizza have layouts that the generic `parseNutritionTable` parser cannot handle directly:

1. **Multi-line headers (all 3 chains):** pdf-parse extracts each column header on a separate line. No single line has 3+ nutrient keywords → header detection fails → 0 dishes parsed.
2. **Paired 100g/portion columns (KFC):** Each data row has 14 values (7 nutrients × per-100g + per-portion interleaved). The parser maps all 14 to 7 columns → wrong values.
3. **Dual kJ/kcal energy columns (BK, Telepizza):** Extra numeric column (kJ) before kcal → column offset error.
4. **Non-nutrient columns (BK):** Weight (g) column has no keyword match → first data token misaligned.

These are inherent characteristics of EU-compliant nutrition PDFs, not parser bugs. The generic parser was designed for synthetic fixtures with single-line headers — a valid assumption that did not hold for production data.

**Decision:** Introduce a **chain-specific text preprocessor** (`packages/api/src/ingest/chainTextPreprocessor.ts`) that normalizes extracted text BEFORE passing it to `parseNutritionTable`:

- `preprocessChainText(chainSlug, lines): string[]` — dispatches to per-chain logic
- BK: strips weight + kJ columns, injects synthetic single-line header
- KFC: keeps only per-100g values (removes per-portion), cleans digits from names, injects header
- Telepizza: removes kJ value from kJ/kcal pairs, injects header
- Unknown chains: returns lines unchanged (no-op)

The preprocessor is invoked from `POST /ingest/pdf-url` when an optional `chainSlug` body parameter is provided. The batch runner (`batch-ingest.ts`) passes the chain slug from the registry.

**Alternatives Considered:**
- Modify `parseNutritionTable` to support multi-line headers: Rejected — structural change with high regression risk to the 819 existing tests. The multi-line header problem is chain-specific (each chain's PDF has a unique layout), not a generic parser gap.
- Hardcoded column mapping per chain inside the parser: Rejected — couples the generic parser to specific chains, violates single responsibility.
- Pre-process text outside the pipeline (manual fixtures only, no runtime preprocessing): Rejected — the batch runner needs to work with real PDFs at runtime, not just test fixtures.

**Consequences:**
- (+) Generic parser (`parseNutritionTable`) remains completely unchanged — zero risk of breaking existing tests
- (+) Each chain's preprocessing is isolated, testable, and easy to extend for new chains
- (+) The `POST /ingest/pdf-url` API gains an optional `chainSlug` parameter (backward-compatible, existing callers unaffected)
- (+) Batch runner automatically benefits — it already knows each chain's slug
- (-) Adding a new chain may require writing a new preprocessor function (if the PDF layout is unusual)
- (-) `chainSlug` must be known at call time — generic PDF uploads without a chain slug skip preprocessing

### ADR-008: Chain Data Availability — Onboard Only Official Nutritional Sources (2026-03-16)

**Context:** Before implementing F014-F017 (additional chain onboarding), a systematic investigation of 4 candidate chains was conducted to determine data source viability:

| Chain | Official nutritional data | Source type | Viable for PDF pipeline |
|-------|--------------------------|-------------|------------------------|
| Subway Spain | YES — full EU nutrients (kcal, fat, saturates, carbs, sugars, fiber, protein, salt) per serving + per 100g | PDF at subwayspain.com, quarterly cycle (MED_Nutritional_Information_CX_YYYY) | YES |
| Pans & Company | YES — full EU nutrients per 100g + per serving | PDF at vivabem.pt (Ibersol parent company nutritional transparency portal) | YES |
| VIPS | NO — allergen matrix only (14 EU allergens) | PDF/SPA at alergenos.grupovips.com | NO |
| 100 Montaditos | NO — allergen chart only; crowdsourced calories on Nutritionix/FatSecret (unverified, possibly US data) | Official: spain.100montaditos.com allergen PDF; Third-party: Nutritionix portal | NO |

**Decision:** Only onboard chains with official, complete nutritional data from the chain itself or its parent company:
1. **F014 — Subway Spain** (subwayspain.com PDF, official)
2. **F015 — Pans & Company** (vivabem.pt PDF, Ibersol parent company, official)
3. **F016-F017 — VIPS and 100 Montaditos postponed** — allergen-only data. These become natural candidates for E003 (Estimation Engine), which can estimate nutritional values from ingredient lists and similar dishes via pgvector.

**Alternatives Considered:**
- Use Nutritionix/FatSecret crowdsourced data for 100 Montaditos: Rejected — unverified, possibly US-specific menu, contradicts ADR-001 (auditable sources only)
- Use VIPS allergen data to estimate nutrients: Deferred to E003 — allergen charts don't contain enough information for nutrient estimation without the estimation engine
- Contact VIPS/100 Montaditos directly to request data: Deferred — manual outreach is out of scope for Phase 1 automation

**Consequences:**
- (+) All onboarded chains have verifiable, official nutritional data — maintains data quality and auditability
- (+) E002 scope is reduced (2 new chains instead of 4), allowing faster progression to F018/F019
- (+) VIPS and 100 Montaditos become compelling test cases for E003 (estimation from allergens + ingredients + similarity)
- (-) Phase 1 chain coverage is 7 chains (McDonald's, BK, KFC, Telepizza, Domino's, Subway, Pans) instead of 9
- (-) Pans & Company source is Portuguese (vivabem.pt) — product names may need minor adaptation for Spain market

### ADR-009: Field Testing Extension — Architecture Decisions from External Review (2026-03-23)

**Context:** Strategic plan for extending foodXPlorer with 6 new capabilities (R1-R6): Telegram file upload, restaurant name resolution + creation, menu photo analysis, recipe calculation, and conversational context. Plan was reviewed by Codex GPT-5.4 and Gemini 2.5 Pro independently. Both returned VERDICT: REVISE. 8 unique issues identified across both reviews, all resolved.

**Decisions:**

1. **File transport: Multipart upload, NOT URL pass-through.** Bot downloads file via `getFileLink()` to buffer, uploads as multipart to API. Telegram bot token never crosses the API boundary. New `POST /ingest/image` endpoint (multipart equivalent of existing `/ingest/image-url`). Existing `POST /ingest/pdf` (multipart) reused for PDFs.

2. **Restaurant model: Schema migration for independents.** `chainSlug` becomes nullable. New fields: `address`, `googleMapsUrl`, `latitude`, `longitude`. Slugging rule for independents: `independent-<name-slug>-<uuid-short>` to avoid collisions.

3. **Photo disambiguation: Inline keyboard.** When bot receives a photo without command context, it shows a Telegram Inline Keyboard with 3 buttons: "Subir al catálogo", "Analizar menú", "Identificar plato". Clear contract for TDD.

4. **Conversational state: Redis from day one.** Not in-memory Map. Key: `bot:state:{chatId}`, TTL 2h. Redis already available in the stack.

5. **Portion sizes: `portion_multiplier` pattern (ADR-001 compliance).** LLM extracts base ingredients + a `portion_multiplier` field (0.7/1.0/1.3). Node.js engine applies the math. LLM never does arithmetic.

6. **Menu analysis auth: API key required.** `POST /analyze/menu` is NOT public. Requires API key auth + rate limit (10 analyses/hour). Prevents abuse as OpenAI billing proxy.

7. **OCR vs Vision API: Tool-specific.** Tesseract/pdf-parse for PDFs (free, high accuracy on text). Vision API (gpt-4o-mini) for photos (OCR unviable on phone photos). Fallback: Vision fails → Tesseract → <3 lines → descriptive error.

8. **Google Maps: Deferred to Phase 2.** Short links (`maps.app.goo.gl/...`) require HTTP redirect following + HTML parsing. Too complex for Phase 1. Manual name entry only.

**Reviewed by:** Codex GPT-5.4 (8 findings: 1C + 3I + 4S), Gemini 2.5 Pro (7 findings: 2C + 4I + 1S)

**Consequences:**
- (+) No security vulnerabilities (bot token protected, analyze endpoint rate-limited)
- (+) Schema supports both chain and independent restaurants
- (+) ADR-001 compliance maintained (LLM interprets, engine calculates)
- (+) All UX flows defined for TDD implementation
- (-) `POST /ingest/image` is new code (not reusing URL-based endpoint)
- (-) Schema migration adds complexity to F032
- (-) Google Maps integration delayed to Phase 2

### ADR-011: Multi-Modal Menu Analysis Pipeline — OCR vs Vision API Routing (2026-03-26)

**Context:** F034 introduces `POST /analyze/menu`, a stateless endpoint that extracts dish names from restaurant menu photos/PDFs and returns per-dish nutritional estimates via `runEstimationCascade`. The endpoint must handle four distinct input scenarios: PDF menus, menu photos, single dish photos, and forced OCR mode. Each has different optimal extraction strategies, fallback behavior, and failure modes. Key architectural decisions were shaped by external review (Gemini 2.5 Pro: 3C+2I, Codex GPT-5.4: 2I+3S).

**Decisions:**

1. **Tool-specific extraction — no universal pipeline.** PDFs use `pdf-parse` (direct text extraction, free, high precision). Images use Vision API `gpt-4o-mini` (OCR on phone photos is unreliable). No PDF-to-image conversion — eliminates heavy system dependency (Ghostscript/GraphicsMagick). `vision`/`identify` modes reject PDFs with `INVALID_IMAGE`.

2. **Four processing modes with clear routing.** `auto` (default): MIME-based routing (PDF→OCR, image→Vision). `ocr`: force Tesseract on any file type. `vision`: force Vision API (images only). `identify`: Vision API with dish-identification prompt (images only, exactly 1 result).

3. **Asymmetric fallback policy.** `vision` mode: Vision API fails → Tesseract OCR fallback → if < 1 dish name → `MENU_ANALYSIS_FAILED`. `identify` mode: no OCR fallback (OCR on a food photo produces garbage). Rationale: fallback quality depends on input type.

4. **Vision API maxTokens override to 2048.** The project default is 512 tokens (`OPENAI_CHAT_MAX_TOKENS`). A menu with 30+ dishes generates ~600-1000 tokens of JSON. Override to 2048 for Vision API calls only to prevent truncation.

5. **Partial results on timeout.** If the 60-second timeout is reached mid-cascade, return HTTP 200 with `partial: true` and dishes processed so far. Rationale: discarding 40 processed dishes because the 41st timed out is destructive UX.

6. **Dual rate limiting strategy.** API-level: 10 analyses/hour per API key (Redis counter, fail-open). Bot key exempt (single shared key for all users). Bot-level: 5 analyses/hour per chatId (Redis counter in bot handler). Rationale: a single bot key shared across all Telegram users would throttle the entire bot at 10/hour.

7. **ADR-001 strict compliance.** Vision API is used exclusively for dish name identification (string extraction). All nutrient computation is delegated to `runEstimationCascade`. The LLM never receives, produces, or estimates nutritional values.

8. **Bot fileId retrieval from Redis BotState.** The inline keyboard callback query's message is the bot's own message (containing the keyboard), NOT the user's original photo. The `pendingPhotoFileId` is stored in Redis during `handlePhoto`/`handleDocument` (F031 pattern) and retrieved by the callback handler.

**Alternatives Considered:**
- PDF-to-image conversion for Vision mode: Rejected — requires Ghostscript or similar system dependency, adds DevOps complexity, and `pdf-parse` already provides high-quality text extraction for PDFs.
- Universal fallback (always OCR on Vision failure): Rejected — OCR on food photos (identify mode) produces garbage text, wasting compute and returning misleading results.
- Hard 408 on timeout: Rejected — discards completed work. Partial results preserve user value.
- Single rate limit for all keys including bot: Rejected — bot key is shared across all Telegram users, would throttle the entire bot to 10 analyses/hour.

**Reviewed by:** Gemini 2.5 Pro (3 CRITICAL + 2 IMPORTANT), Codex GPT-5.4 (2 IMPORTANT + 3 SUGGESTION)

**Consequences:**
- (+) No heavy system dependencies (no Ghostscript/pdf2pic)
- (+) ADR-001 compliance maintained — LLM identifies, engine calculates
- (+) Partial results preserve user value on large menus
- (+) Bot rate limiting is per-user, not per-key
- (-) `vision`/`identify` modes do not support PDFs (acceptable — PDFs have excellent text extraction via pdf-parse)
- (-) Two rate limiting layers (API + bot) add implementation complexity

### ADR-010: Multilingual Dish Names — Populate name_es, Defer Query-Time Translation (2026-03-25)

**Context:** 883/885 dishes have `name_es = NULL`. Names are stored in the PDF source language (mostly English from chain nutrition PDFs). Spanish-speaking users searching in Spanish experience L1 FTS failures (Spanish parser on English text) and L3 embedding degradation. L4 (LLM decomposition) compensates but is the most expensive level. ADR-003 noted: "Multilingual names: Deferred — name + nameEs is sufficient for Phase 1. Revisit before Phase 2."

Analysis of the real usage pattern revealed that the primary use case (generic dishes from local restaurants like "tortilla de patatas") already works via L4 Strategy B, which decomposes into ingredients resolved against the `foods` table (100% `name_es` coverage, NOT NULL). The i18n gap affects only ~200 descriptive chain dishes (e.g., "Grilled Chicken Salad" not findable as "ensalada de pollo") that fall to L4 instead of being caught by L1/L3.

Three approaches were evaluated in `docs/research/i18n-solution-proposal-2026-03-24.md`. External review by Codex GPT-5.4 (2 CRITICAL, 6 IMPORTANT) and Gemini 2.5 Pro (2 CRITICAL, 2 IMPORTANT) both returned VERDICT: REVISE on the initially proposed Enfoque B+ (Canonical English). Key issues: translation drift between ingest and query-time engines, loss of ADR-001 traceability when rewriting `name`, upsert identity breakage, and YAGNI for hypothetical future languages.

**Decision:**

1. **Enfoque A (Populate `name_es`)** — Populate `name_es` for all dishes via batch LLM translation. Fix ingest pipeline to always populate `name_es`. `name` remains the original PDF text (immutable, ADR-001 traceability preserved).

2. **New field `name_source_locale`** — `VARCHAR(5)`, nullable, default `NULL` (backfilled with detection). Values: `'en'`, `'es'`, `'mixed'`, `'unknown'`. Provides metadata about the language of the original PDF without altering `name`.

3. **No query-time translation** — L1 FTS already supports dual-language search via `COALESCE(name_es, name)` with Spanish parser + `name` with English parser. Once `name_es` is populated, L1 works for Spanish queries without any runtime translation service.

4. **Regenerate embeddings** — `buildDishText()` already includes `nameEs` when non-null. Populating `name_es` automatically makes embeddings bilingual, improving L3 for cross-lingual queries.

5. **Translation provider for batch: LLM (gpt-4o-mini)** — One-time batch translation of ~885 dish names. Cost: ~$0.20. No runtime translation service dependency.

6. **Evolution path** — When a 3rd language is needed: (a) add `name_XX` column for small N, or (b) introduce `dish_translations` table (industry standard pattern: MyFitnessPal, FatSecret, Open Food Facts). Migration from `{name, name_es}` to `{name, dish_translations}` is mechanical and low-risk. Query-time translation service introduced only when justified by actual demand.

**Alternatives Considered:**
- Enfoque B+ (Canonical English): Rejected — both external reviewers flagged critical issues: translation drift (two engines produce different strings → L1 exact match fails), `name` field rewrite breaks ADR-001 traceability, upsert identity breakage (`restaurantId + name` used for dedup), external API dependency in critical path. Overengineers for hypothetical future languages (YAGNI).
- Enfoque C (Hybrid): Rejected — combines complexity of A and B without clear benefit over A alone. Dual search strategy adds maintenance burden.
- Query-time language detection + translation: Deferred — unnecessary for ES+EN market. The `foods` table already has 100% `name_es` coverage, and L4 handles multilingual input natively.

**Reviewed by:** Codex GPT-5.4 (VERDICT: REVISE on B+), Gemini 2.5 Pro (VERDICT: REVISE on B+, recommended Enfoque A)

**Consequences:**
- (+) `name` preserved as original PDF text — ADR-001 traceability intact
- (+) Zero runtime dependencies — no external translation API in critical path
- (+) L1 FTS works for Spanish queries without code changes (existing indexes + COALESCE)
- (+) L3 embeddings become bilingual automatically via `buildDishText()`
- (+) Simple implementation (~1-2 days) vs B+ (~4-5 days)
- (+) Clean evolution path to N languages via `dish_translations` table when needed
- (-) Each new language requires a batch translation + schema change (acceptable tradeoff per YAGNI)
- (-) ~$0.20 one-time cost for batch LLM translation

### ADR-012: Landing Page Variant Strategy and Palette Selection (2026-03-28)

**Context:** The nutriXplorer landing page (F039/F044) was audited by three independent AI models (Claude Opus 4.6, Gemini 2.5, Codex GPT-5.4) across 8 combinations: 4 content variants (A=baseline, C=pain-first, D=demo-first, F=allergen-focused) × 2 color palettes (botanical=green, mediterranean=terracotta). The audit covered technical, SEO, UX, conversion, accessibility, and security dimensions. Full audit at `docs/research/landing-audit-2026-03-28.md`.

**Decision:**

1. **Default variant: A (Botanical)** — Solid baseline for broad organic traffic. Clear structure, SearchSimulator demo, balanced messaging.

2. **Recommended for targeted campaigns: F (Botanical)** — Highest cross-model score (32/40). Clearest niche (celíacos/alergias), strongest emotional hook ("Come fuera sin miedo"), most concrete value proposition. Best for: Google Ads targeting allergy-related searches, parent communities, celiac associations.

3. **Variant D: Disabled until fixed** — Hero promises "Busca cualquier plato" but SearchSimulator is not embedded in the hero. 100% promise-delivery mismatch. Do not send traffic to ?variant=d.

4. **Palette: Botanical as default** — Unanimous cross-model consensus. Green (#2D5A27) communicates health, trust, and verification — aligns with the product's core value of data transparency. Mediterranean palette reserved for lifestyle/restaurant-oriented campaigns where warmth matters more than clinical trust.

5. **A/B testing via URL params** — Keep current ?variant=a|c|d|f&palette=botanical|med approach. Simple, measurable, no server-side split needed. Each campaign URL can target a specific variant.

6. **Waitlist persistence: PostgreSQL** — New endpoint POST /waitlist in packages/api (Fastify), not in the landing's Next.js API route. Table `waitlist_submissions` in existing PostgreSQL. The landing form calls the API. Centralizes data with the rest of the backend.

**Alternatives Considered:**
- Server-side random A/B split with cookie: Rejected for now — URL param approach is simpler, more transparent, and sufficient for manual campaign testing. Random split can be added later when traffic justifies automated optimization.
- Mediterranean as default: Rejected — all 3 auditors agreed it dilutes the health/trust positioning. Terracotta communicates "restaurant" more than "data reliability".
- External waitlist service (Mailchimp, Resend): Rejected — we already have PostgreSQL + Fastify. No need for external dependency.

**Consequences:**
- (+) Clear guidance for marketing: which URL to use for which campaign
- (+) Variant D traffic blocked until BUG-LANDING-04 is resolved
- (+) Waitlist data co-located with product data (same DB, same API)
- (-) Requires new API endpoint + schema migration for waitlist table
- (-) Mediterranean palette investment may be underutilized (only for specific campaigns)

### ADR-015: Provenance Graph — Data Source Hierarchy & BEDCA-First Resolution (2026-04-02)

**Context:** The product needs to handle nutritional data from multiple sources: BEDCA (Spanish government lab data, ~431 foods with 55 nutrients), USDA (514 foods, already imported), Open Food Facts (11K+ Hacendado/Mercadona products), chain restaurant PDFs (14 chains, ~885 dishes), and engine-estimated data (L2 ingredient calculation, L4 LLM decomposition). When a user queries "tortilla de patatas", multiple sources may return results. Need a deterministic, no-ambiguity resolution strategy.

BEDCA evaluation (2026-04-02) revealed: only ~431 foods with actual data (of 969 entries), very few prepared dishes (~85 cooked items, mostly individual ingredients), commercial license pending (email sent to bedca.adm@gmail.com). OFF evaluation: 11K+ Hacendado products available immediately under ODbL license. Full analysis in `docs/research/product-evolution-analysis-2026-03-31.md`.

**Decision:**

1. **DataSource priority_tier field.** New integer column on `data_sources` table:
   - **Tier 0:** Brand/restaurant official data (chain PDFs, supermarket packaging via OFF)
   - **Tier 1:** National reference (BEDCA lab data)
   - **Tier 2:** International reference (USDA)
   - **Tier 3:** Estimated (engine L2-L4, LLM-bootstrapped recipes, community corrections)

2. **BEDCA-first resolution for generic queries.** When user asks "tortilla de patatas" without specifying a brand:
   - BEDCA result wins (Tier 1 > Tier 3 estimated). No user disambiguation. No asking "which one do you mean?"
   - If not in BEDCA → LLM-bootstrapped canonical recipe (Tier 3, calculated from ingredients)
   - If not in canonical recipes → OFF prepared food as fallback with clear attribution: "Valores de referencia: Tortilla de Patatas Hacendado (plato preparado industrial)"
   - If nothing → continue L1→L2→L3→L4 cascade as today

3. **Branded queries bypass BEDCA.** NLP must extract `has_explicit_brand: boolean`. If user says "tortilla hacendado", "de mercadona", or any explicit brand → route directly to Tier 0 branded data (OFF/chain). BEDCA is never returned for branded queries.

4. **BEDCA ≠ OFF for "same dish".** "Tortilla de patatas" in BEDCA (lab-measured average of generic preparation) and "Tortilla de Patatas Hacendado" (industrial product with specific formulation) are different entities. They must be stored as separate records with different `source_id` and `priority_tier` values. Never merge them.

5. **OFF ingestion in Phase B.** Ingest 11K+ Hacendado products early (F080) to maximize user value. Use as Tier 0 for branded queries and Tier 3 fallback for generic queries when BEDCA + canonical recipes don't match. ODbL attribution required in all responses.

**Reviewed by:** Claude Opus 4.6 (synthesis), Gemini 2.5 Pro (R1-R4), Codex GPT-5.4 (R1-R4)

**Consequences:**
- (+) Deterministic resolution — no user disambiguation needed, reduced conversation turns
- (+) BEDCA lab data prioritized for generic queries — highest accuracy for Spanish food
- (+) OFF provides immediate coverage for 11K+ branded products
- (+) Clear attribution prevents confusing industrial data with homemade/bar food
- (+) `priority_tier` field is simple, extensible (new sources just pick a tier)
- (-) BEDCA commercial license is a blocker for production — must work around until authorized
- (-) OFF data quality is heterogeneous (user-contributed) — needs validation for critical products

### ADR-016: Anonymous Identity — actor_id Pattern for Auth-Free Product (2026-04-02)

**Context:** The founder decided the product should be open without authentication barriers to maximize user adoption. However, features like favorites, tracking, meal logging, and analytics require stable user identity. The product has two channels: Telegram bot (identifies by chat_id) and web assistant /hablar (no login). Future auth (Google Identity Platform) planned for Phase D. Need a pattern that works without auth today but enables seamless migration to authenticated accounts later without data loss.

Analysis in `docs/research/product-evolution-analysis-2026-03-31.md` Section 17, Foundation 2. Cross-model reviewed (Codex R3: "The right decision is not 'no auth'. It's 'no visible friction, but internal identity from day 1'").

**Decision:**

1. **New `actors` table.** Stable identity from day 1:
   ```
   actors {
     id: UUID (PK)
     type: enum('anonymous_web', 'telegram', 'authenticated')
     external_id: String (deviceId for web, chat_id for Telegram, user_id for auth)
     locale: String? (detected from user input)
     created_at: DateTime
     last_seen_at: DateTime
   }
   ```

2. **Web identity:** Generate UUID v4 on first visit, store in `localStorage` + signed HTTP-only cookie. Send as `X-Actor-Id` header on all API requests. Server creates `actors` row on first seen. **F090 deviation (2026-04-08):** Initial `/hablar` implementation uses `localStorage` + header transport only. HTTP-only cookie deferred — requires complex cross-domain cookie setup between Next.js (nutrixplorer.com) and Fastify (api.nutrixplorer.com) that is not justified until SSR data fetching is needed. UUID format validation added to prevent header injection.

3. **Telegram identity:** Use `chat_id` as `external_id` with `type: 'telegram'`. Already persistent by Telegram's design.

4. **All user-linked data references actor_id**, not a hypothetical user_id. Tables: query_log (already has apiKeyId, add actor_id), favorites (new), meal_log (new), corrections (new).

5. **Auth migration flow (Phase D, F107):** When user authenticates via Google Identity Platform:
   - Create `users` row with Google profile data
   - Run `ATTACH actor → user`: update actor type to 'authenticated', link to user_id
   - All historical data (favorites, logs, tracking) preserved — they reference actor_id, not user_id
   - Multi-device: new device creates new actor_id, links to same user_id on auth

6. **Rate limiting per actor_id** for anonymous users. Mandatory from Phase A0:
   - 50 queries/day per actor (anonymous)
   - 20 L4 (LLM) calls/day per actor
   - 10 photo analyses/day per actor
   - Fail-closed on Redis failure for anonymous actors (deny if can't verify limit)

**Reviewed by:** Claude Opus 4.6, Codex GPT-5.4 (R3), Gemini 2.5 Pro (R3)

**Consequences:**
- (+) Zero friction for users — no sign-up required to use the product
- (+) Stable identity enables favorites, tracking, analytics from day 1
- (+) Seamless auth migration — no data loss when user upgrades to account
- (+) Bot and web share same identity model — enables cross-channel analytics
- (+) Rate limiting protects against abuse (denial-of-wallet attack on OpenAI APIs)
- (-) localStorage/cookie can be cleared → user loses identity (mitigated by auth upgrade)
- (-) Multi-device sync impossible without auth (acceptable tradeoff)
- (-) Slightly more complex middleware than no-identity approach

### ADR-017: OFF Multi-Brand Expansion — Expand Later (2026-04-07)

**Context:** During the first OFF ingestion attempt (F080), we discovered that Open Food Facts has significant coverage beyond Hacendado/Mercadona. A search for "tortilla de patatas" returns multiple variants (con cebolla, con chorizo) and multiple brands (Carrefour, Dia, Aldi, Eroski, Lidl). The `--brand` flag already supports arbitrary brands, so the code effort to expand is minimal. Cross-model review conducted with Claude Opus, Gemini CLI, and Codex CLI — all three reached the same conclusion.

**Decision: EXPAND LATER** — Do not broaden OFF ingestion beyond Hacendado/Mercadona in Phase B.

**Rationale:**

1. **Validate first.** Hacendado ingestion (~11K products) is the first real OFF data in production. Must validate: branded hit rate, correction rate, fallback usefulness, L3 pgvector behavior with branded items, and user confusion rate. Expanding before this validation introduces too many variables.

2. **Search relevance risk.** With 50K+ near-duplicate supermarket SKUs, L3 pgvector may return 15 different supermarket tortillas instead of falling through to the BEDCA/canonical baseline. The estimation engine needs stronger disambiguation and ranking before absorbing multi-brand catalogs.

3. **Hidden product effort.** The code change is trivial (`--brand carrefour`), but the product effort is not: brand-family aliasing, duplicate handling, variant disambiguation, quality scoring, and result ranking all need hardening. Without this, the conversational experience degrades.

4. **Product vision.** nutriXplorer is a conversational nutrition assistant, not a product catalog. Broad supermarket ingestion pulls the product toward "Spanish packaged-food catalog with chat UI" — misaligned with the core value proposition.

**When to revisit:**

- **Trigger:** After 1-2 weeks of real Hacendado usage in production, review F079 query logs (MissedQueryTracking) to identify which brands users actually request.
- **Approach:** Selective expansion by demand-heavy categories (prepared meals, protein yogurts, snacks) and 1-2 pilot brands, not all major chains at once.
- **Quality gates:** Non-Hacendado imports should require stricter validation: complete macros, ingredients text, recent modification date.
- **Phase:** C or D, once search ranking is stronger and barcode flows (F100-F101) justify deeper catalog breadth.

**Cross-model consensus:**

| Model | Verdict | Key insight |
|-------|---------|-------------|
| Claude Opus | Expand Later | Disambiguation logic needs work before scaling data |
| Gemini CLI | Expand Later | L3 pgvector pollution risk — validate baseline first |
| Codex CLI (GPT-5.4) | Expand Later | Hidden product effort far exceeds code effort |

**Consequences:**
- (+) Bounded complexity for Phase B — focus on validating OFF pipeline
- (+) Query logs (F079) will provide data-driven expansion decisions
- (+) Avoids L3 search noise before disambiguation is hardened
- (-) Users of Carrefour/Dia/Lidl won't find their specific branded products until expansion
- (-) Competitors (MyFitnessPal, FatSecret) already have multi-brand — gap remains temporarily

### ADR-018: Web Metrics — Client-Side Only, No GA4 (2026-04-08)

**Context:** F112 adds usage metrics for the `/hablar` web assistant. Three options were evaluated: (A) reuse landing's GA4/gtag pattern, (B) send events to the existing `GET /analytics/queries` backend, (C) client-side only with localStorage.

**Decision:** Option C — client-side localStorage + optional sendBeacon to a future dedicated endpoint.

**Rationale:**

1. **GA4 not suitable.** The web package has a restrictive CSP (`script-src 'self' 'unsafe-inline'`) that blocks Google Analytics scripts. Relaxing CSP for a product tool (vs marketing landing) is a security regression. GA4 is also overkill for aggregate session metrics.

2. **Existing analytics endpoint is different.** `GET /analytics/queries` (F029) aggregates server-side `query_logs` — it tracks backend performance (cache hit rate, response time, level distribution). F112 tracks client-side UX metrics (perceived response time, retry behavior, error rates) that the backend doesn't see.

3. **Privacy-first.** No PII, no query text, no actorId stored in metrics. Only aggregate counts and timings. No third-party scripts.

4. **Backend endpoint deferred to F113.** `NEXT_PUBLIC_METRICS_ENDPOINT` is the hook for a future `POST /analytics/web-events` endpoint that will receive sendBeacon payloads. Until then, metrics live in localStorage only.

**Consequences:**
- (+) No CSP changes, no external dependencies, no privacy concerns
- (+) Clean separation: client metrics (F112) vs server metrics (F029)
- (+) sendBeacon ready for F113 backend integration
- (-) Metrics only visible in browser localStorage until F113 ships

### ADR-020: Per-Dish Portion Assumptions with Graceful Degradation to F085 Generic Ranges (2026-04-13)

**Context:** F085's global gram ranges (`tapa=50–80g`) are dish-agnostic. The user asked for per-dish serving data so the bot and UI can show "~2 croquetas (≈50g)" for a tapa of croquetas vs "≈80ml" for a tapa of gazpacho. The existing `StandardPortion` table was present in the schema but unused and had an incompatible shape (foodId-based, not dish-based).

**Decision:** Replace the legacy `StandardPortion` table with a new per-dish shape (`dishId`, `term`, `grams`, `pieces?`, `pieceName?`, `confidence`). Seed it offline via an analyst-reviewed CSV pipeline (no runtime LLM cost). Wire `resolvePortionAssumption` into both `routes/estimate.ts` and `estimationOrchestrator.ts` for parity. Use a 3-tier fallback chain at query time: Tier 1 (DB lookup), Tier 2 (media_racion×0.5 arithmetic from ración row), Tier 3 (F085 global range).

**Cross-model review (Codex + Gemini + self-review) identified and resolved:**
- M1-1: `formatPortionTermLabel` helper needed for canonical key → Spanish label mapping
- M1-2: Shared schema cleanup (PortionContextSchema deletion) must be atomic with migration
- M1-3: CSV `dishId` column must be UUID string (not integer)
- M2-1: Pre-flight safety check before DROP TABLE (backup if rows present)
- M3-1/M3-2: npm script wiring + agent template compliance

**Tier 2 non-rule (spec §3.2):** Tier 2 does NOT apply to tapa/pintxo queries even when a ración row exists. Rationale: `tapa = ración × 0.25` would be false precision masquerading as data. Tapa and pintxo always degrade to Tier 3 generic.

**Low-multiplier fall-through:** When `basePieces × multiplier < 0.75`, pieces is set to null (not rounded to 1). Rationale: 0.6 of a croqueta is not a meaningful UI element. The 0.75 threshold was chosen as the smallest value that rounds to 1 without conveying false precision.

**Consequences:**
- (+) Per-dish data covers 30 priority Spanish tapas with pieces + pieceName
- (+) Zero runtime LLM cost — seed pipeline is fully offline
- (+) Transparent degradation: Tier 3 output is byte-identical to pre-F-UX-B F085 output
- (+) Bot 1205 tests remain green; generic path preserved by structural guard
- (-) Per-dish coverage limited to reviewed priority-30 dishes until analyst expands CSV
- (-) Cache key doesn't include portion-term dimension — stale cache after seeding requires deploy + cache flush (documented as deployment note)
- (-) `StandardPortion` shape from prior unused table is fully incompatible; data migration is a clean drop-and-recreate

**BUG-PROD-011 amendment (2026-04-20):** When `portionAssumption.source === 'per_dish'` and `portionAssumption.grams !== result.portionGrams`, the API now ALSO scales `result.nutrients` and `result.portionGrams` by the ratio `portionAssumption.grams / result.portionGrams`. The original label-only behavior was correct when all portions used `dish.portionGrams` as their reference, but became contradictory once `standard_portions` introduced term-specific gram values that differ from the dish default. Post-fix, `portionAssumption.grams` and `result.portionGrams` are always equal for `per_dish` sources. `baseNutrients` + `basePortionGrams` preserve the pre-scaling (cascade raw) values. Tier 3 generic remains label-only. The `EstimateDataSchema` superRefine was relaxed to allow `baseNutrients` when `portionMultiplier === 1.0` if a portionRatio was applied. `enrichWithUncertainty` was moved to execute AFTER portionAssumption scaling so calorie ranges reflect the actual served portion.

### ADR-021: Full-flow integration tests required for conversation pipeline features (2026-04-13)

**Context:** BUG-PROD-006 revealed that F085 (`portionSizing`) and F-UX-B (`portionAssumption`) were non-functional on the primary user path (`POST /conversation/message`) despite all unit and component tests passing. Root causes: (1) `prisma` not threaded through `ConversationRequest`; (2) F078-stripped query used for portion detection. Every existing test bypassed the full flow — they called `resolvePortionAssumption()` or `enrichWithPortionSizing()` directly with hardcoded inputs.

**Decision:** Any new feature that adds data to the conversation response payload MUST have at least one integration test that calls `processMessage()` end-to-end (real DB, mocked Redis/cache). The test must assert the new field is present in `result.estimation` (or wherever the field lives on the response). Unit tests on the lowest-level resolver function alone are insufficient — they cannot catch wiring regressions where the resolver is never called.

**Concretely:** `f-ux-b.conversationCore.integration.test.ts` and `f085.conversationCore.integration.test.ts` serve as the canonical examples. Both call `processMessage()` with real Prisma on the test DB, mock `runEstimationCascade` to control which dish is returned, and assert on `estimation.portionAssumption` / `estimation.portionSizing`.

**Cross-model review (Codex + Gemini):** Both models independently identified the structural test coverage gap during plan review. Codex flagged it as M1 (structural miss, not just a test quality issue). Gemini confirmed the "resolvePortionAssumption directly" pattern is insufficient.

---

### ADR-022: Explicit map over heuristic matcher for seed-time dish resolution (2026-04-17)

**Date:** 2026-04-17
**Status:** Accepted
**Context:** The `generateStandardPortionCsv.ts` generator used `matchesPriorityName` (substring `.includes()` + `Array.find` first-match) to resolve human-readable priority names to `dishId` values from `spanish-dishes.json`. This produced 6 wrong mappings in the generated CSV, 3 of which were confirmed wrong in production (PR #139). Short priority names like `jamón`, `tortilla`, `cocido` reliably resolved to the wrong dish because the first JSON-order match was a dish that contained the word as a substring rather than the dish that IS the concept.
**Decision:** Replace the heuristic with an explicit `PRIORITY_DISH_MAP: Record<string, string>` keyed by priority name, valued by the canonical `dishId`. Add fail-hard validation: duplicate dishIds in the map throw before any output; dishIds absent from `spanish-dishes.json` throw before any output. Priority names with no canonical dish are simply omitted from the map (they produce no CSV rows and fall through to Tier 3 at runtime). The heuristic helpers (`matchesPriorityName`, `normalizeName`) are removed entirely — not deprecated — per Codex M1 finding that dead code in the module invites reuse and future drift. A follow-up ticket (F114) will add the missing canonical dishes.
**Alternatives Considered:**
- **Option A — Stricter heuristic matcher**: keep matcher function; rank exact `nameEs` > exact alias > whole-token (word-boundary regex) > substring; add deny-list for generic head tokens. **Rejected**: still encodes business semantics in string heuristics; 3 missing canonical dishes (`chorizo`/`chuletón`/`arroz`) would still fail.
- **Option B — Manual CSV patch**: edit ~6 rows by hand, leave generator bug untouched. **Rejected**: fragile; next `npm run generate:standard-portions` reintroduces the bugs.
- **Option D — Explicit map + expand JSON in same ticket**: add missing canonical dishes + map + regenerate all at once. **Rejected** (deferred to F114): coupling data enhancement with bugfix delays the urgent data-integrity fix and adds risk surface.
- **Option E — Redesign feature**: rewrite the F-UX-B feature architecture. **Rejected**: overkill; the schema works, only the matcher is wrong.

Cross-model consensus: both Codex and Gemini independently recommended Option C ("explicit map over smart matcher") with the rationale that this is seed-time curation (determinism > cleverness), not runtime fuzzy matching.

**Consequences:**
- (+) Map is auditable row-by-row in code review.
- (+) Fail-hard validation catches future misconfiguration before any output.
- (+) Eliminates silent false-positive dishId mappings — the worst class of data bug.
- (-) Generator no longer auto-discovers new dishes when `spanish-dishes.json` is extended; a curator must explicitly add an entry to `PRIORITY_DISH_MAP`. This is desirable — the map is a curation artifact, not a search result.
- 9 priority names currently omitted: `chorizo`, `chuletón`, `arroz`, `bocadillo`, `pintxos`, `alitas de pollo`, `zamburiñas`, `berberechos`, `tostas`. Follow-up ticket **F114** will add `Chuletón de buey`, `Chorizo ibérico embutido`, and `Arroz blanco cocido` canonical entries.

---

### ADR-023: H7-P5 L1-Retry Seam Pattern in `engineRouter.ts` (2026-04-26)

**Date:** 2026-04-26
**Status:** Accepted
**Context:** F-H7 requires trailing modifier stripping (e.g. `con sésamo`, `a baja temperatura`, `bien caliente`) that operates post-wrapper, between L1 and L2 in the estimation cascade. Trailing modifiers are conversational context that users append to dish names (`tataki de atún con sésamo`, `gazpachuelo malagueño bien caliente`) — they cause L1 exact-match to miss even though the base dish name (`tataki de atún`, `gazpachuelo malagueño`) is in the catalog. Modifying `extractFoodQuery()` to strip these suffixes before calling the cascade would (a) require a two-pass architecture (strip → extract → cascade), (b) conflate pre-lookup wrapper stripping with post-lookup trailing modifier removal, and (c) produce a query field in the cascade that no longer echoes the user's original text.

**Decision:** Insert a retry seam between L1-null and L2 in `runEstimationCascade()` (in `packages/api/src/estimation/engineRouter.ts`). The seam applies pure-function trailing strip helpers from `packages/api/src/estimation/h7TrailingStrip.ts` (Cat A: conversational suffixes like "por favor", "bien caliente"; Cat B: cooking method suffixes like "a la plancha"; Cat C: trailing `con [tail]` with ≥2 pre-con token guard to prevent single-word landmine strips). If the stripped text differs from the original, L1 is retried once with the stripped text. If retry hits, the response uses `levelHit: 1` and echoes the raw (unstripped) `query` in `data.query`. If retry misses, falls through to L2 with the original `normalizedQuery` (conservative fallback principle).

**Alternatives Considered:**
- **Option A — Pre-lookup strip in `extractFoodQuery()`**: Strip trailing modifiers before the cascade is called. Rejected: conflates two distinct concerns; requires two-pass design; loses the invariant that `extractFoodQuery` output == user's unambiguous food reference; complicates the wrapper-then-strip composition.
- **Option B — Post-pipeline normalizer in `estimationOrchestrator.ts`**: Apply strip in the orchestrator before calling `runEstimationCascade`. Rejected: same architectural conflation as Option A; orchestrator doesn't have visibility into which L1-miss produced which result.
- **Option C — Expand L1 FTS query to handle modifiers via `tsquery`**: Teach the FTS engine to ignore appended modifiers. Rejected: complex query construction; would also match partial dish names incorrectly (e.g. `tataki de atún con gambas` should not hit `tataki de atún` via L1 — that conflation is the point of the retry seam's ≥2 token guard).

**Consequences:**
- (+) Clean separation of concerns: wrappers in `CONVERSATIONAL_WRAPPER_PATTERNS`, trailing modifiers in `h7TrailingStrip.ts`, cascade wiring in `engineRouter.ts`.
- (+) Conservative: any strip that produces no L1 hit forwards the original text to L2/L3/L4 — no regression risk.
- (+) Extensible: future strip categories can be added to `h7TrailingStrip.ts` without modifying the seam wiring.
- (+) Raw `query` field always echoes the user's original text — no downstream surprise for callers reading `data.query`.
- (-) One additional L1 DB query on every L1-miss. For queries that ultimately resolve via L2/L3/L4, this adds one extra round-trip. Acceptable for the target user population; L1 queries are indexed and fast.
- The Cat C ≥2 pre-con token guard is essential: it prevents `arroz con leche` (1 pre-con token: "arroz") from being stripped to `arroz`, and generally protects single-word-dish `con` compounds that are catalog entries.

---

### ADR-024: Lexical Token-Overlap Guard for L3 Similarity Extrapolation (2026-04-27)

**Date:** 2026-04-27
**Status:** Accepted
**Context:** L3 similarity extrapolation (pgvector cosine distance) produces false positives when two entity names share a high-weight token but refer to fundamentally different things. Canonical case Q649 (QA 2026-04-27): query `queso fresco con membrillo` matched `CROISSANT CON QUESO FRESC` (distance 0.18 < 0.5 threshold) because the embedding model assigns high proximity to the shared token "queso/fresc". See Spec section of ticket `F-H10-l3-threshold-tuning.md`.

**Decision:** Add a **post-retrieval lexical guard** to `level3Lookup.ts`. After `fetchDishNutrients()` / `fetchFoodNutrients()` returns, compute the word-level Jaccard overlap between the normalized query and the candidate name. If `jaccard < LEXICAL_GUARD_MIN_OVERLAP (0.25)`, the candidate is rejected. Strategy 1 (dish) rejection falls through to Strategy 2 (food); Strategy 2 rejection returns `null`. The guard is a pure deterministic function `computeTokenJaccard(a, b)` operating on lowercase, punctuation-stripped, Spanish-stop-word-removed token sets.

Threshold derivation: Q649 case produces Jaccard = 1/5 = 0.20 (single token "queso" shared across 5-token union). Setting threshold to 0.25 ensures this case is rejected (0.20 < 0.25) while 2-token overlaps on short queries (e.g. "tortilla" in "tortilla española" vs "tortilla de patatas", Jaccard ≈ 0.33) pass.

**Alternatives Considered:**
- **Strategy A (lower global cosine threshold):** Blind calibration without empirical distance distribution data. High regression risk on legitimate L3 hits.
- **Strategy C (threshold tightening when overlap is low):** Two interacting parameters. Higher complexity for same outcome.
- **Strategy D (chain-scoped guard):** Does not generalize to food strategy mismatches.

**Consequences:**
- (+) Additive and orthogonal to the cosine distance threshold — no existing behavior changed for legitimate hits.
- (+) Single constant `LEXICAL_GUARD_MIN_OVERLAP` is tunable.
- (+) Pure function with comprehensive unit tests; no DB interaction.
- (+) ADR-001 compliance verified: guard is lexical matching (deterministic), not LLM-based nutrient interpretation.
- (-) Spanish stop-word list is small and domain-specific; defined inline in `level3Lookup.ts`. Future features needing shared stop-word removal should refactor to a shared module.
- (-) Jaccard operates on exact token strings (no stemming). "fresco" ≠ "fresc" (Catalan apocope) — this is acceptable since the overlap threshold is already calibrated to handle partial matches.

#### ADR-024 Addendum: L1 FTS Extension (F-H10-FU, 2026-04-27)

**Date:** 2026-04-27
**Status:** Accepted — extends ADR-024

**Context:** F-H10 wired `applyLexicalGuard()` exclusively into `level3Lookup.ts`. Post-deploy QA battery run on 2026-04-27 16:54 confirmed that Q649 (`queso fresco con membrillo`) still produces a false positive: `CROISSANT CON QUESO FRESC` (Starbucks Spain, 343 kcal) is returned at L1 FTS via `ftsDishMatch()` (Strategy 2) before the cascade ever reaches L3. The L3 guard is correct but never executes for this query path.

Root cause: `ftsDishMatch()` uses a bilingual FTS query — `to_tsvector('spanish', COALESCE(d.name_es, d.name)) @@ plainto_tsquery(...)` OR `to_tsvector('english', d.name) @@ plainto_tsquery(...)`. Token overlap with "queso fresc" is sufficient for FTS to match CROISSANT at high confidence, even though the dishes are semantically unrelated (pastry vs cheese+quince plate).

**Decision 1 — Extend guard to L1 FTS Strategies 2 and 4:**
Wire the lexical guard into `runCascade()` in `level1Lookup.ts` immediately after each FTS strategy returns a hit (Strategies 2 and 4), before constructing and returning the `Level1Result`. Exact-match strategies (1 and 3) are exempt: an exact or alias match is inherently a lexical identity match and cannot be a false positive of this type. Guard-rejected hits fall through to the next strategy (S2 reject → S3; S4 reject → null).

**Decision 2 — Dual-name OR semantics via private `passesGuardEither` helper:**
L1 FTS is bilingual: a match may occur on the Spanish branch (COALESCE(name_es, name) with Spanish stemmer) OR the English branch (name with English stemmer). The matched branch is not exposed in the result row — only `name_es` and `name` columns are available. Comparing only against `name_es ?? name` (L3 pattern) would reject legitimate English-branch hits (example: query `bacon eggs` hits `Bacon and Eggs` via English FTS; `name_es = 'Beicon con huevos'`; guard against Spanish name alone would reject a valid match).

Solution: private helper `passesGuardEither(query, nameEs, name)` evaluates `applyLexicalGuard` against BOTH names and returns `true` if EITHER clears the threshold (OR semantics). Null/undefined `nameEs` skips the Spanish side. The helper is local to `level1Lookup.ts` (not exported from `level3Lookup.ts`) because the dual-name OR semantics are L1-specific — L3 candidates only have Spanish-side names from `fetchDishNutrients()`.

**Decision 3 — Retain threshold 0.25 for L1 FTS:**
The same `LEXICAL_GUARD_MIN_OVERLAP = 0.25` constant is reused. L1 FTS is a higher-confidence retrieval mechanism than L3 pgvector (FTS guarantees token presence via `plainto_tsquery`; pgvector only requires proximity). This raises a theoretical risk of over-rejection on legitimate single-token FTS matches, which is resolved by the following analysis:

Minimum safe Jaccard for a single-query-token match against an N-content-token candidate = 1/N (FTS guarantees the query token appears in the document, so intersection ≥ 1). Guard rejects only when N > 4 (1/N < 0.25), i.e., a 1-word query matching a 5+ meaningful-word candidate name where only 1 token overlaps. This is an extremely unlikely legitimate FTS hit for dish/food names in this domain. Empirical verification:
- `paella` → `Paella valenciana` (N=2): Jaccard = 0.50 ≥ 0.25 → PASS
- `tortilla` → `Tortilla de patatas` (N=2, after stop-word strip): Jaccard = 0.50 ≥ 0.25 → PASS
- `gazpacho` → `Gazpacho andaluz` (N=2): Jaccard = 0.50 ≥ 0.25 → PASS
- `queso fresco membrillo` → `CROISSANT CON QUESO FRESC` (N=3 content tokens, union=5): Jaccard = 0.20 < 0.25 → REJECT (correct)

Pre-flight distribution analysis artifact: `docs/project_notes/F-H10-FU-jaccard-preflight.md` (operator action pending — see AC4 in ticket).

**Guard injection points in `runCascade()`:**

Strategy 2 (was):
```typescript
if (ftsDishRow !== undefined) {
  return { matchType: 'fts_dish', result: mapDishRowToResult(ftsDishRow), rawFoodGroup: null };
}
```

Strategy 2 (after):
```typescript
if (ftsDishRow !== undefined) {
  if (passesGuardEither(normalizedQuery, ftsDishRow.dish_name_es, ftsDishRow.dish_name)) {
    return { matchType: 'fts_dish', result: mapDishRowToResult(ftsDishRow), rawFoodGroup: null };
  }
  // Guard rejected on both sides — fall through to Strategy 3
}
```

Same pattern for Strategy 4 with `ftsFoodRow.food_name_es` / `ftsFoodRow.food_name`.

**Consequences:**
- (+) Q649 false positive eliminated at source (L1 FTS layer, before cascade reaches L3).
- (+) Guard is additive; no existing passing FTS hits are rejected (confirmed by single-token Jaccard analysis and regression test suite).
- (+) H7-P5 retry seam interaction is safe: guard-induced null on a strippable query enables the desired unmask path (seam fires, retry with stripped form hits the legitimate dish). Guard-induced null on a non-strippable query propagates to L2 without seam firing. No infinite loop risk (seam fires at most once per request).
- (+) BUG-PROD-012 two-pass interaction is safe: guard runs inside `runCascade()`, applied independently on each pass. Q649 correctly returns null on both passes.
- (-) `passesGuardEither` is NOT exported — unit tests exercise it via cascade tests (Option A per plan). If direct unit testing of the helper is needed in future, it must be exported or tested via a different mechanism.
- (-) Pre-flight Jaccard distribution analysis (AC4) was deferred to operator action post-implementation. Risk is low (dual-name OR semantics are strictly more permissive than F-H10's single-name guard), but the artifact should be completed before marking AC4 done.

---

#### ADR-024 Addendum 2: L1 Required-Token Guard (F-H10-FU2, 2026-04-28)

**Date:** 2026-04-28
**Status:** Accepted — extends ADR-024 and ADR-024 Addendum 1 (F-H10-FU)

**Context:** Post-deploy operator verification on 2026-04-28 confirmed that Q649 (`queso fresco con membrillo` → `CROISSANT CON QUESO FRESCO`) is still accepted at L1 FTS under the Jaccard-only guard shipped in F-H10-FU (commit `73e1c97`). Root cause: the full `nameEs` is `CROISSANT CON QUESO FRESCO`; Jaccard against the full name is 2/4 = 0.50 ≥ 0.25 (threshold) → guard passes. The original spec incorrectly computed Jaccard against the truncated QA-display string `CROISSANT CON QUESO FRESC` (0.20 → reject). Additionally, 5 other false positives (Q178, Q312, Q345, Q378, Q580) were identified in the 2026-04-28 QA battery, 4 of which are rejected by F-H10-FU's Step 1 at the source level (reconciled in `F-H10-FU2-preflight-20260428.md` as a stale deploy artifact), with Q649 and Q378 passing Step 1.

**Failure mode: Jaccard insufficient for multi-token semantic mismatches.** Any threshold sufficient to reject Q649 (> 0.50) would also reject single-token legitimate queries like `paella` → `Paella valenciana` (Jaccard = 0.50). Threshold tuning alone cannot distinguish between:
- `queso fresco con membrillo` (queryHI={membrillo}) against `CROISSANT CON QUESO FRESCO` — semantic mismatch
- `paella` against `Paella valenciana` — semantic match

**Decision 4 — Required-token check as Step 2 of combined guard `passesGuardL1`:**

A query token is "high-information" (HI) if it has normalized length ≥ 4 AND is not in `FOOD_STOP_WORDS_EXTENDED`. The combined guard `passesGuardL1` wraps `passesGuardEither` as Step 1, then applies the required-token check as Step 2:

- Step 1: `passesGuardEither(query, nameEs, name)`. If false → REJECT immediately.
- Step 2: Extract `queryHI = getHighInformationTokens(query)`. If empty → fall through (Jaccard-only behavior, EC-1).
- Step 2a: If nameEs non-null → tokenize nameEs. If EVERY token in `queryHI` is present → ACCEPT.
- Step 2b: Tokenize name. If EVERY token in `queryHI` is present → ACCEPT.
- Otherwise → REJECT.

**Why `every` (not `some`).** Using `some` (accept if ANY HI token is absent) is too strict and would reject legitimate matches where only one HI token is missing. The correct semantics is `every` — accept if ALL HI tokens are present. Empirically verified: `some` would still accept Q178/Q312 because `cola` IS present in `Huevas cocidas de merluza de cola patagónia` (a false positive). `every` correctly rejects because `coca` is absent.

**Decision 5 — `FOOD_STOP_WORDS_EXTENDED` for HI token extraction.**

The HI token filter uses a superset of `SPANISH_STOP_WORDS`:
1. **Linguistic stop words** (14): `de, del, con, la, el, los, las, un, una, al, y, a, en, por`
2. **Food-domain modifiers** (12, spec starter): `queso, fresco, leche, agua, plato, racion, tapa, pintxo, media, caliente, frio, natural`
3. **Quantity/size modifiers** (expanded after Phase 0.2 simulation): `grande, normal, generosa, generoso, cuarto, triple, doble, algunos, algunas, tres, cuatro, cinco`
4. **Serving containers** (expanded): `copas, copa, pinchos, pincho, rebanadas, rebanada, vaso, vasito, botella, botellin`
5. **Preparation method modifiers** (expanded): `brasa, frito, frita, fritos, fritas, plancha, asado, asada`
6. **Conversational filler** (expanded): `favor, para`
7. **Food packaging/container** (expanded): `sobre, sopa, instantanea, instantaneo, lata`
8. **Serving format**: `canas, cana` (cañas/caña = beer glass; NFD: caña→cana), `molde, crema`
9. **Truncation artifact**: `verdu` (truncated "verduras" in QA capture)

**Criteria for inclusion:** token is semantically common across many dish types; its presence alone does not justify a match; removing it does not cause false negatives on known QA battery (136-row simulation, 2026-04-28). DO NOT add primary dish identifiers (pollo, jamon, vino, paella, tortilla, etc.).

**Phase 0.2 simulation result:** v1 starter list (26 tokens) yielded 26 false negatives. Expanded list (59 tokens) reduced to 5 FNs — all truncation artifacts from the QA capture's 40-char limit. Decision gate (≤ 5) passed.

**Decision 6 — `token.length >= 4` heuristic for HI qualification.**

3-character Spanish food words (`pan`, `ron`, `té`, `sal`) appear in many candidate names (`pan de cristal`, `ron caña`, `sal gorda`) and would cause systematic false negatives if treated as HI tokens. The length-4 cutoff is a practical heuristic balancing selectivity vs. coverage. Known limitation: very short food terms (< 4 chars) fall through to Jaccard-only, which may miss rare semantic mismatches. Acceptable for the current QA battery.

**Decision 7 — L1→L3 delegation pattern for over-rejection on elaborated queries.**

With `every` semantics, queries containing HI tokens NOT in the canonical catalog name are rejected at L1 even when semantically equivalent. Example: `tarta de queso casera` → `Tarta de queso` — queryHI = {tarta, casera}; `casera` absent from candidate → REJECT at L1. This is acceptable because the L3 embedding semantic check acts as a safety net. L1 stays strict to suppress noise; L3 catches semantic equivalents. If empirical QA confirms specific quality modifiers cause systematic L1 rejection of legitimate matches, extend `FOOD_STOP_WORDS_EXTENDED` in a follow-up ticket.

**Q378 scope note:** `una copa de oporto` → postStrip (via extractFoodQuery) → `oporto`. queryHI = {oporto}. Candidate `Paté fresco de vino de Oporto` contains `oporto` → step2 ACCEPTS. This is correct L1 behavior — the semantic mismatch (drink vs. pâté) is delegated to L3 embedding. The original spec assumed `copa` would survive extractFoodQuery stripping; empirically it does not.

**Call-site replacement:**

Strategy 2 and Strategy 4 in `runCascade()` now call `passesGuardL1` instead of `passesGuardEither` directly. `passesGuardL1` is private to `level1Lookup.ts`, not exported. Tested exclusively via cascade tests per ADR-024 addendum decision 4.

**Consequences:**
- (+) All 5 known FPs from Step 2's `every`-HI-token check now rejected at L1 (Q649 ✓, Q178 ✓, Q312 ✓, Q345 ✓, Q580 ✓). Q378 correctly passes L1 and is delegated to L3.
- (+) Single-token legitimate queries preserved (paella, gazpacho, tortilla, croquetas, etc.) — required-token check does not interfere.
- (+) NFD normalization handles accented queries (jamón→jamon, ibérico→iberico, caña→cana).
- (+) Bilingual OR semantics preserved — accept if all HI tokens in nameEs OR all HI tokens in name.
- (-) Elaborated queries (e.g., `tortilla de patatas` against canonical `tortilla española`) are rejected at L1 and must be caught by L3. Two F-H10-FU regression fixtures required update (`TORTILLA_DISH_ROW`, `GAZPACHO_FOOD_ROW`) to use full canonical names — documented in ticket Completion Log.
- (-) `FOOD_STOP_WORDS_EXTENDED` list requires ongoing curation. Aggressive extension causes false negatives; conservative extension leaves some FPs. QA battery re-run after each expansion is mandatory.

### ADR-025: Auth Provider Selection — Supabase Auth for F107 (2026-05-13)

**Status:** Accepted — R3 (incorporates Codex+Gemini R1 + R2 cross-model review; scope simplified after the parallel decision to pause the Telegram bot — see ADR-026).

**Context:**

F107 will add authentication to nutriXplorer, ending the auth-free posture established by ADR-016. The trigger is F099 (user profiles — BMR/targets), which requires per-user persistence of personal health data (weight/height/age/activity) — a RGPD Art. 9 category that is unsafe to attach to a localStorage-only `actor_id`. F098 (premium tier gates), F102 (B2B API), and F109 (Apple Health/Google Fit export) also depend on a stable user identity.

ADR-016 anticipated this transition. Its migration sketch (`docs/project_notes/decisions.md:517-521`) — "set `actor.type='authenticated'`, `external_id=<user_id>`; multi-device creates new `actor_id`, linked to same `user_id`" — is **internally inconsistent** with the `@@unique([type, externalId])` constraint on `actors` (`docs/tickets/F069-anonymous-identity.md:55-59`): once one actor row holds `(authenticated, <user_id>)`, a second device cannot flip to the same pair without violating uniqueness. This was caught by Codex in R1. **This ADR therefore supersedes ADR-016's migration contract**, replacing it with an account-keyed model (Decision §3 below) while keeping the rest of ADR-016 intact: anonymous-first posture, per-actor rate limiting (`packages/api/src/plugins/actorRateLimit.ts`), and the F069 `actors` table itself.

**R3 scope simplification (2026-05-13):** During R2 discussion, the user and reviewers agreed to **pause the Telegram bot pre-beta** (documented separately as **ADR-026**). This closes the pre-existing telegram actor spoofing CRITICAL (qa-api-audit 2026-04-06 A1), removes the bot/web merge complexity, and lets F107 focus on a single client surface. R3 therefore: (a) drops the bot link protocol that R2 introduced, (b) tightens the transport precedence rule per Gemini+Codex R2 feedback, (c) makes the F099 boundary explicit per Codex R2 SUGGESTION, (d) corrects Auth0 Professional-tier price.

Constraints (R3):

1. **Solo-dev operation** — no team, no CODEOWNERS, no shared on-call. Anything that adds operational surface (custom IdP, multi-region tuning, manual user CRUD UI) compounds against me.
2. **Active client surface — web only** (Next.js 15 App Router, `packages/web/`). Landing (Next.js 14) is marketing-only, no authenticated state. Telegram bot is paused pre-beta per **ADR-026** (code preserved but service offline, `telegram:` resolution removed from `actorResolver.ts`). Auth scope therefore covers web only; bot revival would re-introduce a multi-surface merge protocol as a separate ADR.
3. **Backend is Fastify, not Next.js API routes** — disqualifies provider patterns that assume the auth runtime lives inside Next.js.
4. **Cross-domain auth transport** — web at `app.nutrixplorer.com`, API at `api.nutrixplorer.com`. Cross-domain cookies were deferred in F090 (`docs/project_notes/decisions.md:511`). Auth transport must work across origins without re-opening that complexity.
5. **Supabase already in the stack** for PostgreSQL (pooler quirks at `docs/project_notes/key_facts.md:66`). Single-vendor simplification is a real lever.
6. **Pre-beta scale: <500 users** — effectively-free pricing required; growth ramp non-punitive through ≤50K MAU.
7. **F099 RGPD posture** — EU data residency + a clean session→consent→profile chain. Consent timestamps must live somewhere durable that is app-owned, not provider-owned.

**Decision: Supabase Auth, with a new app-owned `accounts` table and `actor.account_id` FK as the merge seam.**

1. **Provider.** Adopt **Supabase Auth** (GoTrue-backed; bundled with the Supabase project we already use for PostgreSQL). Day-1 providers for web: Email+Password and Google OAuth. Apple Sign-In and Magic Link evaluated as fast-follow.

2. **Backend verification.** Fastify verifies Supabase-issued JWTs via Supabase's JWKS endpoint using `jose`. No Supabase JS SDK on the API hot path; the SDK is web-only.

3. **Data model** (supersedes ADR-016's migration sketch):
   - **`auth.users`** (Supabase-managed) — source of truth for identity (email, OAuth providers, hashed credentials).
   - **`public.accounts`** (NEW, app-owned) — durable app-level **account** state. Columns: `id UUID PK`, `auth_user_id UUID UNIQUE` (logical reference to `auth.users.id`; no hard FK to a managed schema), `created_at`, `updated_at`, `deleted_at` (soft delete), `consent_health_data_at`, `consent_marketing_at` (RGPD timestamps), `billing_customer_id NULL` (Stripe etc, populated when F098 lands). **F099 split (made explicit post-R2):** body/health profile fields (weight, height, age, activity, BMR targets) do **NOT** live on `accounts` — they go on a separate `public.profiles` table keyed to `accounts.id`, designed in F099 spec time. Rationale: `accounts` is identity/consent/billing; `profiles` is RGPD Art. 9 health data with its own retention rules.
   - **`public.actors`** (existing F069 table, **extended**) — channel/device identity. New column: `account_id UUID NULL` (FK to `public.accounts.id`). The existing `ActorType` enum value `'telegram'` is retained for backwards compatibility but is **dormant** per ADR-026 (no new rows; existing rows untouched). New actors are created with `type='anonymous_web'` only. The `type='authenticated'` enum value is also retained but unused — the merge sets `account_id` instead of flipping `type`.

4. **Merge semantics** (F107b implementation contract, web-only):
   - **First-device login.** User signs in on web → API receives bearer JWT → upsert `accounts` row by `auth_user_id` → `UPDATE actors SET account_id=<accounts.id> WHERE id=<request.actorId>`. Idempotent.
   - **Second-device login.** New browser visits → fresh `(anonymous_web, <new_uuid>)` actor with `account_id=NULL` → user signs in → the same `accounts` row is found by `auth_user_id` → `UPDATE actors SET account_id=<existing accounts.id>`. **No uniqueness conflict**, because `actors.account_id` is non-unique by design — N devices → N actors → 1 account.

5. **Transport.** Web client sends `Authorization: Bearer <jwt>` on API requests (Supabase-issued access token, refreshed by the Supabase JS client). `X-Actor-Id` is still sent **alongside** for the anonymous fallback path. **`actorResolver` precedence (strict — addresses Gemini+Codex R2 IMPORTANT):**
   - `Authorization` **absent** → fall through to existing `X-Actor-Id` anonymous flow (current behavior preserved).
   - `Authorization` **present and JWT verification succeeds** → resolve `accounts` from JWT `sub` claim → resolve or attach the actor accordingly; `X-Actor-Id` is ignored for identity selection (still observed for the merge target).
   - `Authorization` **present and JWT verification fails** (expired, malformed, signature invalid) → **respond 401 immediately**. Do NOT silently fall back to anonymous resolution — a present-but-invalid token is a client error or attack, not a downgrade signal.
   - Cross-domain cookies remain deferred — bearer-header transport sidesteps the issue entirely.

6. **EU region.** Configure the Supabase project to **EU (Frankfurt)** to co-locate with Render (Frankfurt API) and the existing Sentry EU project (`docs/project_notes/key_facts.md:68`).

7. **Free-tier inactivity mitigation.** Add a Render cron job hitting `GET /health?db=true` on api-prod every 24h. The `?db=true` branch issues `SELECT 1` against Supabase (`packages/api/src/routes/health.ts`), which keeps the project warm. (The existing plain `/health` path does NOT touch the DB and so cannot keep the project warm; the cron is needed regardless of any other monitoring.)

8. **Defer RLS.** Row-Level Security policies deferred to F107b/F099 spec time. F107a continues to enforce authorization at the Fastify route layer.

9. **Anonymous flow preserved for first-visit web.** Anonymous actors remain the default for first-visit web traffic. ADR-016's anonymous-first posture stands; only its specific migration sketch is superseded.

**Why Supabase Auth over the alternatives** (full ranking in *Alternatives considered* below):

1. **Smallest footprint for solo-dev.** Already in the bill, no new dashboard, no new IAM admin. Marginal operational complexity vs zero-auth-today is the lowest of any option.
2. **`auth.users` lives inside our database.** `accounts.auth_user_id → auth.users.id` is a same-DB logical reference. The login-time merge is one DB round-trip with no third-party API call. Clerk/Auth0 would require an external API call on every link or identity-fetch.
3. **Free tier covers the next ≥18 months.** 50K MAU on Supabase Auth's free plan, included in the free DB plan we already use. No new bill.
4. **Bounded vendor lock-in via OSS engine** (narrowed post-R1 SUGGESTION). GoTrue is Apache-2.0 and self-hostable. If managed Supabase becomes uninvestable, we can stay on GoTrue self-hosted — at the cost of taking on TLS, backups, HA, monitoring, and security patching. This is "same-engine continuity", **not** "easy switch to a different provider"; the latter is a real data migration. See *Reversibility analysis* below.
5. **EU region available without surcharge.**
6. **JWT is standards-based** (RS256 via JWKS) — backend verification works with any JOSE library; no Supabase SDK on the hot path.

**Reviewed by:**
- **R1 (Codex GPT-5.4 + Gemini 2.5 Pro, parallel, 2026-05-13).** Codex: 1 CRITICAL + 5 IMPORTANT + 1 SUGGESTION. Gemini: 1 CRITICAL + 2 IMPORTANT + 2 SUGGESTION. All 9 distinct findings addressed in R2 — multi-device merge contract rewritten via `accounts` table, transport spec'd, bot link protocol added (later removed in R3), warm-keep mitigation corrected, Clerk/Auth0 pricing corrected, OSS escape hatch reframed, ADR-016 supersession explicit, bot magic-link fast-follow captured.
- **R2 (Codex GPT-5.4 + Gemini 2.5 Pro, parallel, 2026-05-13).** Gemini: 9/9 R1 FIXED + 1 IMPORTANT regression (bearer precedence on invalid token). Codex: 6/9 R1 FIXED + 3 PARTIAL + 1 CRITICAL (pre-existing telegram spoofing escalated by `accounts` exposure) + 3 IMPORTANT (atomicity of bot link redemption; bot-link rate-limit claim ficticio; bearer precedence) + 1 SUGGESTION (F099 split explicit).
- **R3 (this revision).** Resolves R2 findings by: (a) bearer precedence rule rewritten as strict 401-on-invalid (Decision §5); (b) bot link protocol + bot-link rate-limit claim + atomicity concern all REMOVED — moot under ADR-026 bot pause; (c) F099 body-profile split made explicit (Decision §3 — `profiles` table separate from `accounts`); (d) Auth0 Professional-tier price corrected to $240/mo at 500 MAU (was stated 1K). Codex's R2 CRITICAL on telegram spoofing is dispatched by ADR-026 + the actorResolver code change that removes the `telegram:` resolution path.

**Consequences:**

- (+) Single vendor for DB + Auth — one bill, one dashboard, one region setting, one outage to track.
- (+) **Multi-device safe by construction.** `actors.account_id` is non-unique; N devices → N actors → 1 account. No `@@unique` constraint conflict (the R1 CRITICAL).
- (+) **Telegram spoofing vector closed** as a side-effect of ADR-026: `actorResolver.ts` no longer accepts `X-Actor-Id: telegram:<chatId>`, so the pre-existing CRITICAL (qa-api-audit 2026-04-06 A1) is resolved in the same change set.
- (+) Historical data preserved on merge. Query logs / favorites / meal logs that reference `actor_id` keep referencing it after auth; the join to user-level data goes through `actors.account_id`.
- (+) `accounts` table is the durable home for RGPD consent timestamps, soft-delete state, billing customer ids. `profiles` (F099, separate) is the home for body/health data — clean separation of concerns at migration time.
- (+) Cross-domain auth via bearer header. No cross-domain cookie work; no CORS `credentials: 'include'` toggle; one fewer thing to break.
- (+) JWT verification offline-friendly. JWKS is cached; a Supabase Auth outage does NOT immediately invalidate active sessions — only blocks new logins and token refreshes. Active session bound by access-token TTL (default 1h).
- (+) **Strict bearer precedence** prevents silent auth downgrades — present-but-invalid tokens fail loud (401), not anonymous.
- (+) Free at our scale and the next 50× of it.
- (–) New `accounts` table = Prisma migration + Zod schema (`@foodxplorer/shared`) + KyselyDB type regen. Modest one-time cost in F107a.
- (–) New `profiles` table will be a separate F099 migration (not in F107a scope).
- (–) Retroactive backfill: every existing anonymous actor has `account_id=NULL`. Logged-in users get their actor linked at login time only. Acceptable.
- (–) Supabase outage now affects auth AND data simultaneously. Mitigation: bounded session windows (see (+) above). Sentry alerts (F030-lite) catch error spikes.
- (–) Hosted login UI is functional but not infinitely customizable. If branding demands custom flow, run the Supabase JS client against our own pages (supported by SDK).
- (–) Locking ourselves to GoTrue's account-linking semantics for cross-provider users (e.g., Email then Google). GoTrue v2 stores this in `auth.identities`; we inherit that model. Confirmatory query in F107a spec.
- (–) Supabase free-tier projects pause after 1 week of inactivity. Mitigated by the explicit Render cron in Decision §7.
- (–) If/when the Telegram bot is revived (ADR-026 re-evaluation triggers), a multi-surface link protocol must be designed as a separate ADR — not retrofitted here. The simple web-only model in this ADR does not generalize without an explicit bot identity proof (HMAC or bot-credential-gated `/link` endpoint).

**Reversibility analysis** (post-R1 narrowing of "OSS escape hatch"):

- **Stay on managed Supabase, switch to self-hosted GoTrue.** Feasible: GoTrue is OSS (Apache-2.0), schema is portable, JWTs interoperate. Shifts operational burden — TLS termination, backups, HA, monitoring, security patching — onto us. Reasonable fallback IF managed Supabase pricing degrades; **not** a casual switch.
- **Switch to a different provider entirely** (Clerk, Auth0, custom). Real migration: export users from `auth.users`, recreate them on the new provider (which assigns new ids), rewire `accounts.auth_user_id` to the new id space. Doable but non-trivial — expect 1-2 weeks of careful work plus a user-visible re-login event. **The OSS escape hatch is provider-stickiness mitigation, not full vendor reversibility.**

**Alternatives considered:**

1. **Google Identity Platform (GIP)** — `docs/project_notes/decisions.md:493`, `docs/research/product-evolution-analysis-2026-03-31.md:1441`. **Rejected.** Generous free tier (50K MAU) and battle-tested. In 2026 the entry point for new projects is Firebase Auth; "Identity Platform" is the paid multi-tenancy upgrade. Adopting GIP requires standing up a separate GCP project (we have zero GCP footprint today), configuring IAM, and managing two vendors (Supabase data + Google identity). The merge requires a Google JWT verification path with no same-DB join. Marginal operational cost > marginal feature value at our scale.

2. **NextAuth.js / Auth.js v5** — listed in the user's recovery prompt. **Rejected.** Designed for Next.js server runtimes (`/api/auth/[...nextauth]`); auth state lives inside the Next.js process and is exposed to other clients via JWT. Our backend is Fastify. We could emit JWTs from Next.js and verify them in Fastify, but NextAuth then collapses to a JWT-issuer wrapper around providers we'd configure ourselves — its main value (Next.js-side session helpers) we wouldn't use. Auth.js v5 is also still in `beta` as of 2026-05.

3. **Clerk** (corrected post-R1 — Codex IMPORTANT + Gemini CRITICAL). Verified at `clerk.com/pricing` on 2026-05-13: Free **Hobby tier offers 50,000 MRU per app and includes Custom Domain support** — better than the R1 draft's understated claim. EU data residency is also on the free tier (the R1 "EU only on paid" claim was wrong). **Still rejected (close second).** Reasons that remain valid: (a) user records live on Clerk's servers, not in our DB — the same-DB merge advantage of Supabase Auth is unavailable; F107b would require a Clerk Backend API round-trip per link/identity-fetch. (b) No OSS engine — 100% vendor lock-in, no equivalent of the GoTrue self-host fallback. (c) Paid tier kicks in past 50K MRU at $25/mo base + per-MAU, while Supabase Auth's free tier is more linearly priced past its 50K cap. The corrected facts make Clerk meaningfully more attractive than the R1 draft suggested, but (a) and (b) still tip toward Supabase Auth at our scale + RGPD posture.

4. **Auth0** (corrected post-R1+R2 — Codex IMPORTANT both rounds). Verified at `auth0.com/pricing` on 2026-05-13: Free tier is **25,000 MAU and includes Custom Domains** (R1 draft's "7K MAU / no custom domain" was stale); paid **Professional starts at $240/mo for 500 MAU** (R2 draft's "1K MAU" at that price was off by 2×). **Still rejected.** The corrected free tier is genuinely usable for beta. But: (a) paid tier escalation is steep ($35/mo for 500 MAU on Essentials, $240/mo for 500 MAU on Professional — faster than Clerk and Supabase Auth past free). (b) User records on Auth0; same same-DB-merge disadvantage as Clerk. (c) No OSS engine. (d) Universal capability matters less when our auth surface is "Email + Google OAuth + RGPD consent" — well within Supabase Auth's scope.

5. **Custom JWT + magic links (Resend/Postmark)** — listed in the user's recovery prompt. **Rejected.** Tempting: no vendor lock-in. But the burden is substantial: email deliverability (DKIM/SPF/DMARC, sender reputation), magic-link rate limiting, refresh-token rotation, MFA if ever needed, CVE patching on `jose`/`jsonwebtoken`/email library. Worst risk: a single auth bug exposes the entire user base. Solo-dev cannot afford this. Revisit only with full-time engineering staffing.

6. **Firebase Auth** — added during analysis. **Rejected.** Stripped-down GIP with a similarly generous free tier (no MAU cap on Spark plan for Email/Password and most social providers), but still requires standing up GCP, runs its own identity store separate from our DB, and Google has signaled (Sept 2025 blog) that Firebase Auth will be merged under "Firebase Authentication with Identity Platform" — medium-term roadmap unclear, a bad property for an auth provider.

**Re-evaluation triggers** (when this ADR should be revisited):
- **Scale:** crossing 25K MAU (50% of Supabase free tier) — re-evaluate pricing.
- **Outage incident:** if Supabase availability hurts auth uptime, evaluate adding an auth redundancy path.
- **Compliance change:** if RGPD posture demands EU sovereignty (not just region) or SOC 2 Type II, re-evaluate.
- **Product change:** if we add native iOS/Android apps (F108 PWA expanding into native), re-evaluate Sign in with Apple readiness — Supabase Auth supports it natively, so this is not a forced exit. If ADR-026 is reversed and the bot is revived, draft a separate ADR for the multi-surface link protocol (HMAC-signed bot identity proof, gated `/link` endpoint).
- **Team change:** when team grows to ≥2 contributors, custom JWT + magic links becomes operationally viable; re-evaluate cost.

### ADR-026: Pause Telegram Bot for Pre-Beta Focus (2026-05-13)

**Status:** Accepted.

**Context:**

The Telegram bot (`packages/bot/`) was a first-class channel in the original product vision (ADR-016, line 491+). It currently runs as two Render services (`nutrixplorer-bot-dev` + `nutrixplorer-bot-prod`), responds to Telegram via webhook, and is identified server-side via `X-Actor-Id: telegram:<chatId>` resolved by `packages/api/src/plugins/actorResolver.ts` lines 66-73.

Three facts converged during the **ADR-025** (auth provider) cross-model review on 2026-05-13:

1. **Zero realised value pre-beta.** No real users today; waitlist + closed beta will start via web (`app.nutrixplorer.com`). The bot serves no current traffic and has not been validated as an acquisition or retention channel.
2. **Real complexity cost on F107.** Cross-model review of ADR-025 R2 surfaced three IMPORTANT findings tied specifically to the bot/web merge: (a) non-atomic redemption races in a `/link` protocol, (b) absence of a `/link` rate-limit bucket in `actorRateLimit.ts`, (c) the bot/web identity bridge being under-specified. Each is solvable but each adds spec/test surface to a feature whose only consumer today is hypothetical.
3. **Pre-existing CRITICAL spoofing flaw.** `docs/archive/audits/qa-api-audit-2026-04-06.md` line 83 (`A1 — Actor impersonation`) flagged that `X-Actor-Id: telegram:<chatId>` is trusted at face value with no bot authenticity proof. The flaw is dormant while there are no telegram-linked accounts, but **becomes exploitable cross-surface impersonation the moment ADR-025's `accounts` table starts attaching to telegram actors**. Fixing the flaw inside an active bot service requires a non-trivial HMAC bot-identity protocol that has no other immediate justification.

The cost/benefit at pre-beta tilts strongly toward closing the surface: it simultaneously simplifies F107 (web-only auth), closes the A1 CRITICAL, and frees solo-dev attention for the features that actually drive beta launch.

**Decision: Pause the Telegram bot pre-beta. Preserve all code. Reversible.**

1. **Suspend Render services** (operator action — manual, dashboard). Suspend both `nutrixplorer-bot-dev` and `nutrixplorer-bot-prod`. Do NOT delete. `autoDeploy` was already OFF on both per `docs/project_notes/key_facts.md:63`, so suspension is the only step needed to stop request processing.
2. **Disable Telegram webhook** (operator action — manual, via BotFather). Clear the webhook URL so Telegram's servers stop attempting to deliver updates to the suspended Render service. The bot token itself remains valid for future reactivation; it is not revoked.
3. **Remove `telegram:` resolution path from `actorResolver.ts`** (code change). Lines 35 (`TELEGRAM_PREFIX` constant) and 66-73 (the `telegram:` branch) are deleted. The resolver now accepts only valid UUIDs (anonymous web actors) or generates a new one. Any inbound `X-Actor-Id: telegram:<chatId>` header is silently treated as "missing/invalid" and triggers anonymous actor creation. This closes the A1 spoofing CRITICAL by eliminating the trusted-header code path entirely.
4. **Preserve `packages/bot/` in the repo.** No file deletions in `packages/bot/`. The code remains a frozen reference for future revival. Its `package.json` stays in `npm workspaces`, its imports from `@foodxplorer/shared` continue to type-check on shared changes.
5. **Preserve CI `test-bot` job.** `.github/workflows/ci.yml` keeps the `test-bot` job and its place in the `ci-success` rollup. Rationale: bot tests act as a guard against silent type drift from `@foodxplorer/shared` changes that would otherwise rot `packages/bot/` and make future revival expensive. The job is path-filtered, so it only fires on actual bot/shared changes — negligible CI cost.
6. **`ActorType` enum value `'telegram'` retained in Prisma schema.** No migration needed. The enum value is dormant: no new rows are created with it, and existing rows (if any) remain valid. Re-introducing it later is an enum value usage, not a schema change.
7. **Backlog hygiene.** Features that were bot-anchored move to backlog with a re-evaluation note:
   - **F088 Community Inline Corrections (bot)** → backlog. Re-evaluate as web-only feature post-beta.
   - **F107c Bot magic-link auto-account** → cancelled (was a fast-follow consequence of the old bot link protocol, now moot).
   - Bot-targeted intents in F076 (`/menu` command) and F075 (audio) continue to ship as **API endpoints** (`/conversation/message`, `/conversation/audio`); both are already consumed by web and remain useful regardless of bot status. No code changes there.
8. **No changes to operational tooling.** Render build filters for the bot services stay configured (would be re-used on revival). Sentry bot SDK remains deferred (F030-FU). `render.yaml` bot service blocks remain documented intent.

**Reviewed by:** Inline discussion between user and Claude during ADR-025 R2 review, 2026-05-13. Not a multi-model review — the strategic decision (close the surface) was raised in conversation after technical review of ADR-025 R2 made the cost of keeping the bot visible. Cross-model review was not warranted: this is a product/scope decision with low technical surface (code change is 8 lines + tests).

**Consequences:**

- (+) **ADR-025 simplifies materially.** Bot link protocol, multi-surface merge complexity, and `/link` rate-limit considerations all drop from the auth design.
- (+) **A1 CRITICAL closed in the same change set** as a side-effect of removing the `telegram:` resolution path. No separate hardening work needed pre-beta.
- (+) **Reduced operational surface.** Two fewer Render services watching for issues. One fewer health monitoring concern.
- (+) **CI guard preserved.** `test-bot` ensures `packages/bot/` does not silently rot from shared schema changes — revival cost stays low.
- (+) **Code museum, not graveyard.** All bot code remains git-versioned and runnable locally. The user could `git checkout` any commit and run the bot against a fresh Telegram token in minutes.
- (+) **Solo-dev focus.** One less surface to maintain in the L5 PM-autonomous workflow. Every `@foodxplorer/shared` schema change still typechecks against bot, but no production deploys to verify.
- (–) **No Telegram acquisition channel pre-beta.** Theoretical loss of Telegram's organic discovery (search, groups, viral DMs). Not realised today (no users); becomes a real cost only if beta validates that "Telegram as second channel" was a key acquisition path.
- (–) **Bot work to date partially shelved.** `packages/bot/` (~30+ files: api client, voice handler, `/menu` intent, admin handlers, voice infra) remains in repo unused. Sunk cost in code-museum form — the **infrastructure** investments (api endpoints, audio duration parser, voice budget Lua, Whisper wrapper) remain in `packages/api/` and are still leveraged by web.
- (–) **F088 displaced.** Community inline corrections via bot is no longer a near-term feature. Either repackage as web feature or accept the gap. Decision deferred to post-beta.
- (–) **Re-enabling has a non-zero cost** — estimated ~1 week of work: rotate Telegram token in BotFather, redeploy Render services, verify `actorResolver.ts` restoration, re-test the bot end-to-end against current API surface, validate any shared schema changes that accumulated. Not catastrophic, but not free.
- (–) **The original ADR-016 channel vision is partially walked back.** The product is now "web-first with bot reactivatable on demand", not "bot+web parallel from day one". Worth being honest about: this is a product-direction shift, not just a tactical pause.

**Reversibility:**

- **Resume in days, not weeks.** The reversal path: (a) reactivate Render services (1 click each), (b) issue new Telegram webhook URL via BotFather, (c) restore the 8-line `telegram:` branch in `actorResolver.ts` (or replace with the HMAC-gated version per ADR-025 R3 note), (d) deploy + smoke-test. If shared schema has drifted in ways `test-bot` flagged, fix imports.
- **Token strategy.** Telegram bot tokens persist across Render service suspension. No rotation needed for revival unless the user proactively revokes via BotFather. Long-term inactivity does not invalidate tokens server-side at Telegram.

**Re-evaluation triggers** (when to consider reversing this ADR):

- **Beta feedback validates need for a second channel.** Real users explicitly ask for Telegram, or web-only proves to be a friction point for the target demographic.
- **Specific bot-only use case** emerges: push notifications, async meal logging, sharing in groups. Web cannot natively do any of these.
- **Bot infrastructure rewrite** would solve a different problem (e.g., adding RCS/WhatsApp Business support). The bot infrastructure could be retrofitted as the abstraction.
- **Available capacity expands** (team grows, dedicated engineering hire). The maintenance cost of keeping the bot warm becomes affordable.

**Cross-references:**
- ADR-016 (`decisions.md:491`) — the original "anonymous identity + bot+web parallel surfaces" vision this ADR partially walks back.
- ADR-025 (`decisions.md:831`) — the auth-provider ADR whose R2 review surfaced the cost/benefit case.
- `docs/archive/audits/qa-api-audit-2026-04-06.md:83` — A1 CRITICAL "Actor impersonation" — closed as a side-effect of Decision §3 above.
- `packages/api/src/plugins/actorResolver.ts:66-73` — the code lines being removed.
- `docs/project_notes/key_facts.md:63` — Render services + autoDeploy state.

### ADR-027: Account-Tier Wiring — `/me`-on-login Provisioning + Bearer-over-API-Key Precedence (F-WEB-TIER, 2026-05-26)

**Status:** Accepted — owner-decided during F-WEB-TIER (PM session pm-profiles). Reuses ADR-025 R3 §5; no new auth provider or transport. Cross-model reviewed (Spec 6 findings + Plan 3 findings) + code-review caught the photo-tier gap.

**Context.** F107a shipped auth but registering granted no tangible value: tier was resolved ONLY from `request.apiKeyContext` (API keys), so a logged-in web user fell through to `anonymous`. Two structural facts forced design decisions during F-WEB-TIER:

1. **`actors.account_id` is a FK to `accounts.id` (app PK), and the `accounts` row is created ONLY by `/me`'s upsert.** The web never calls `/me` (research §H0), so resolver-side actor↔account linking would never find an `accounts.id` → a silent no-op for exactly the web users we care about. BUG-PROD-013 also deliberately kept the `actorResolver` onRequest hook write-free.
2. **The photo path (`/analyze/menu`) always carries the shared web `X-API-Key`** (proxy gateway credential), and tier resolution was API-key-first → the shared key shadowed the bearer, so authed photos got the shared key's tier, not the account tier.

**Decision.**
1. **Provisioning + linking via `GET /me` on session establish (Option A).** `AuthProvider` calls `GET /me` on `SIGNED_IN`/`INITIAL_SESSION` (NOT `TOKEN_REFRESHED`); `/me` upserts the account + links the actor using the **unchanged** F107a-FU2 safe predicate. The `actorResolver` write-path stays clean (resolves `actorId` only). Multi-device is covered (each device calls `/me` at its own login). Rejected alternatives: resolver-side linking (no-op without the account row + adds account writes to the hot path); a gated resolver-side upsert (re-introduces writes BUG-PROD-013 removed).
2. **Bearer-over-API-key tier precedence.** When a valid bearer is present (`request.accountId` set), tier resolves from the account (`resolveAccountTier`) **even if `apiKeyContext` is also present**. The shared `X-API-Key` is an infrastructure/gateway credential, not a per-user tier grant — ADR-025 R3 §5 makes the bearer the authoritative identity channel. API-key-only clients (no bearer) are unaffected. Only `/analyze/menu` (bearer + shared key) changes: authed photos now get account limits (free = 20).
3. **Fail-open to `free` (never `anonymous`) for a verified bearer** with no `accounts` row yet or on DB error — every registered user is ≥ free. `AccountSchema.tier` is `.optional()` on parse for rolling-deploy skew (web auto-deploys on Vercel; api-dev is a manual deploy).

**Consequences.**
- (+) Registering delivers real value (free 100/20/30 incl. photos) without requiring resolver write-path changes; reuses F107a-FU2 verbatim (anti-hijack surface unchanged).
- (+) Read-only `GET /me/usage` powers the usage meter without consuming quota.
- (–) Linking depends on the frontend calling `/me` at session establish (one extra call per login). Acceptable: it's the canonical F107a provisioning point and was always intended.
- (–) Tier resolution adds a cached DB read on rate-limited authed requests (mitigated: Redis cache TTL 60s, mirrors API-key auth).

**Cross-references:**
- ADR-025 R3 §5 (`decisions.md:831`) — strict bearer precedence; this ADR applies it to tier resolution.
- BUG-PROD-013 (`docs/tickets/BUG-PROD-013-*.md`) — the bearer-actorId fix that kept the resolver write-free; F-WEB-TIER builds on it.
- `docs/tickets/F-WEB-TIER-registration-value.md` — full spec/plan/ACs + the cross-model + review trail.
- `packages/api/src/plugins/actorRateLimit.ts` — bearer-first tier precedence; `packages/api/src/lib/accountTier.ts` — `resolveAccountTier`.

### ADR-028: Search History — Account-Scoped `search_history` Table + Read-Only History API + Prune-on-Write Retention (F-WEB-HISTORY, 2026-05-27)

**Status:** Accepted — owner-approved at the F-WEB-HISTORY Spec checkpoint (PM session pm-profiles, 2026-05-27). Cross-model reviewed (`/review-spec`: Gemini APPROVED, Codex REVISE 3 IMPORTANT — all applied). Builds on ADR-025 R3 §5 (bearer precedence) + ADR-027 (account identity); no new auth provider or transport.

**Context.** Today `/hablar` shows only the *last* result — `HablarShell` holds one result in `useState` and replaces it each query, so every search erases the previous one (research §C/H1). Logged-in users get no durable value. Two structural facts shaped the design:

1. **`query_logs` is metadata-only** (`queryText`, `levelHit`, `cacheHit`, `responseTimeMs` — no nutritional payload; research §H2). Re-rendering a past result needs the *full* response, so a new table is required, not a column on `query_logs`.
2. **Identity is by account, not actor.** `request.accountId` = JWT `sub` = `auth_user_id`; the FK target is `accounts.id` (app PK), the same distinction ADR-027/F107a established. The `accounts` row is provisioned by `/me` (Option A).

**Decision.**
1. **New `search_history` table** (`id` uuid PK · `account_id` uuid FK→`accounts.id` **ON DELETE CASCADE** · `kind` enum `text|voice` · `query_text` · `result_jsonb` · `created_at` timestamptz). Composite index `(account_id, created_at DESC, id DESC)` for cursor pagination. Distinct from `query_logs` (different PK, purpose, payload). Migration via `prisma migrate deploy`.
2. **Read-only `GET /history` (cross-model C1).** Cursor-paginated, newest-first, bearer-only. Resolves `accounts.id` from the bearer and returns `[]` if no account row exists — **no write on a GET**; provisioning stays centralized in `/me`. `DELETE /history/{id}` (404 — not 403 — for non-owned/missing, no enumeration) + `DELETE /history` (clear all). Persistence hook is fire-and-forget on the SUCCESS path of `POST /conversation/message` + `/conversation/audio` when a bearer is present; it **never blocks/delays the core query** (mirrors the existing `writeQueryLog` pattern). Photos are NOT persisted (fork D3 — large multi-dish payload; deferred to a conditional Fase 4); they still appear in the live session feed.
3. **`result_jsonb` typed strictly (cross-model C2).** The shared `SearchHistoryEntrySchema.resultData` = `ConversationMessageDataSchema` (the real intent union), not an opaque record — so schema drift is caught at the boundary. The web safeParses each entry and SKIPS drifted-old payloads (graceful, never a fatal page). `queryText` max = 2000 to match `/conversation/message` body (a `text_too_long` is a successful, persisted result; cross-model C3). result_jsonb versioning deferred (YAGNI).
4. **Prune-on-write retention (fork D4, owner-confirmed 500/12m).** After each insert, best-effort prune to the newest 500 rows per account AND delete rows older than 12 months (both fire-and-forget). Soft cap (a transient 501th row under concurrent writes self-corrects). No cron infrastructure.
5. **Privacy — NOT RGPD Art.9.** Food/menu queries are not special-category health data, so persisting them does not trip the Art.9 gate that kept F099 (health profile) deferred. Account-deletion CASCADE wipes history; the user-facing "borrar historial" action + per-entry delete satisfy the deletion right. A privacy-policy note (storage + deletion of text/voice queries) is an **operator follow-up** (out-of-repo, tracked separately) — it does not block the code feature.
6. **UI: session-transcript feed refactor.** `HablarShell`/`ResultsArea` move from a singleton intent-renderer to an append-only feed (design notes W15–W26). This fixes "se borra" for EVERYONE (anonymous included) and is the foundation persistence builds on; implemented first for a testable footing.

**Consequences.**
- (+) Registering gains durable, cross-device value (your past searches persist); the feed fixes the "erases previous result" pain for all users.
- (+) Read-only history API + non-blocking persistence hook keep the core query path unaffected if history degrades (DB/Redis failure → history silently skipped, query still served).
- (+) Strict `result_jsonb` typing catches drift; CASCADE + delete actions give a clean privacy story without an Art.9 gate.
- (–) The HablarShell→feed refactor is a UI architecture change (research risk E2) — mitigated by phasing (feed first), TDD, and reusing existing result cards.
- (–) `result_jsonb` duplicates result payload already in `query_logs`-adjacent caches; accepted (different lifecycle + purpose). Prune-on-write adds two best-effort DELETEs per authed query (indexed; negligible at beta scale).

**Cross-references:**
- ADR-027 (`decisions.md:1007`) — account identity + `/me` provisioning this builds on.
- ADR-025 R3 §5 (`decisions.md:831`) — strict bearer precedence (history is bearer-only).
- `docs/tickets/F-WEB-HISTORY-search-history.md` — full spec/61 ACs + cross-model trail.
- `docs/research/post-auth-strategic-analysis-2026-05-25.md` §C/§D — empirical pain + phased plan + forks D3/D4/D5.
- `packages/shared/src/schemas/history.ts` — `SearchHistory*` Zod schemas.
