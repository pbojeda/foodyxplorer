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
