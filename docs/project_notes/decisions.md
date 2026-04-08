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

**Full plan:** `docs/project_notes/strategic-plan-r1-r6.md`

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
