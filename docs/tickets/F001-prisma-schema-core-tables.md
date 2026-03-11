# F001: Prisma Schema Migration — Core Tables

**Feature:** F001 | **Type:** Backend-Feature | **Priority:** High
**Status:** In Progress | **Branch:** feature/F001-prisma-schema-core-tables
**Created:** 2026-03-10 | **Dependencies:** Day 0 complete (Docker, monorepo)

---

## Spec

### Description

Create the foundational Prisma schema and migration for the 4 core tables of foodXPlorer: `data_sources`, `foods`, `food_nutrients`, and `standard_portions`. These tables are the base layer upon which the entire product is built — every other table (dishes, restaurants, cooking methods) references or depends on these.

The schema must be production-grade from day 1: proper constraints, enums, indexes, and audit fields. Values are always stored per 100g. Confidence levels and data sources are mandatory for every nutritional record.

**Key design decisions (from database-architect review):**
- 4 PostgreSQL enums: `DataSourceType`, `ConfidenceLevel`, `EstimationMethod`, `PortionContext`
- `confidence_level` on `foods`, `food_nutrients`, AND `standard_portions` (not just downstream `dish_nutrients`)
- `food_nutrients` is 1:N with `foods` (same food can have nutrients from multiple sources), with `UNIQUE(food_id, source_id)` to prevent duplicates
- `standard_portions` uses XOR constraint: exactly one of `food_id` or `food_group` must be set (raw SQL CHECK)
- `embedding` column on `foods` via raw SQL (`Unsupported("vector(1536)")` in Prisma)
- Full-text search indexes (Spanish + English) and GIN index on `aliases` via raw SQL in migration
- `created_at` / `updated_at` on all tables

### API Changes

None — F001 is schema-only. API endpoints come in F004/F025.

### Data Model Changes

**New enums:**
- `DataSourceType`: official, estimated, scraped, user
- `ConfidenceLevel`: high, medium, low
- `EstimationMethod`: official, ingredients, extrapolation, scraped
- `PortionContext`: main_course, side_dish, dessert, starter, snack

**New tables:**
1. `data_sources` — Origin/provenance of all data (official sites, USDA, FEN, scraped, user-contributed)
2. `foods` — Base food ingredients with name, aliases, food group, embedding, confidence
3. `food_nutrients` — Nutritional values per 100g per food per source (1:N with foods)
4. `standard_portions` — Standard portion sizes by food or food group + context

**Constraints (raw SQL in migration):**
- `standard_portions`: XOR CHECK on `(food_id, food_group)`
- `food_nutrients`: CHECK `calories >= 0 AND calories <= 900`, all nutrients >= 0
- `food_nutrients`: UNIQUE `(food_id, source_id)`
- `foods`: UNIQUE `(external_id, source_id)`

**Indexes (raw SQL in migration):**
- `foods`: FTS GIN on `name` (English) and `name_es` (Spanish), GIN on `aliases`
- `food_nutrients`: on `food_id`, `source_id`
- `standard_portions`: partial indexes on `food_id` and `food_group`, composite on `(food_group, context)`
- `data_sources`: on `type`

### Edge Cases & Error Handling

- Prisma does not support `vector` type natively → use `Unsupported("vector(1536)")` and raw SQL
- Prisma does not support CHECK constraints → add via raw SQL in migration file
- Prisma does not support GIN/FTS indexes → add via raw SQL in migration file
- Prisma does not support partial indexes → add via raw SQL in migration file
- The migration must be edited AFTER `prisma migrate dev --create-only` to add all raw SQL before running

---

## Implementation Plan

### Context Notes for Developer

This is the **first feature** of a greenfield project. There is no existing Prisma schema, no existing domain code, and no existing Zod schemas. Every file listed below is a new file. The monorepo uses:
- `packages/api/` — Fastify API, home of Prisma schema and migrations
- `packages/shared/` — shared Zod schemas, single source of truth for types
- Test runner: **Vitest** (not Jest — `api/package.json` declares `vitest`)
- Standards file (`backend-standards.mdc`) was written for Express/Jest but the actual stack is **Fastify/Vitest** — follow the same structural patterns but adapt to Vitest syntax

---

### Existing Code to Reuse

- `scripts/init-db.sql` — already creates the `vector` extension in `foodxplorer_dev` and `foodxplorer_test`. No changes needed; the extension is available.
- `docker-compose.yml` — uses `pgvector/pgvector:pg16` image; no changes needed.
- `packages/api/src/server.ts` — existing Fastify server; do not touch in this ticket.
- `packages/shared/src/index.ts` — the barrel export for shared schemas; must be updated to export all new schemas.

Nothing domain-related exists yet. All code in this ticket is net-new.

---

### Files to Create

**Prisma (packages/api/prisma/)**

1. `packages/api/prisma/schema.prisma`
   - Datasource block: provider `postgresql`, `DATABASE_URL` env var
   - Generator block: `prisma-client-js`
   - 4 enums: `DataSourceType`, `ConfidenceLevel`, `EstimationMethod`, `PortionContext`
   - 4 models: `DataSource`, `Food`, `FoodNutrient`, `StandardPortion`
   - `embedding` field on `Food` typed as `Unsupported("vector(1536)")`; mark with `/// @db.Unsupported` doc comment so Kysely knows it is a raw column

2. `packages/api/prisma/migrations/<timestamp>_init_core_tables/migration.sql`
   - Created with `prisma migrate dev --create-only --name init_core_tables`, then edited
   - The generated SQL creates tables and enums
   - Developer must append raw SQL blocks (detailed below in Implementation Order)

3. `packages/api/prisma/seed.ts`
   - Inserts ≥1 DataSource, ≥3 Foods, ≥3 FoodNutrients, ≥3 StandardPortions
   - Uses `prisma.$executeRaw` for the embedding column (cannot assign via Prisma model insert because the column type is `Unsupported`)
   - Satisfies acceptance criteria: "Seed script inserts … without errors"

**Shared Zod schemas (packages/shared/src/schemas/)**

4. `packages/shared/src/schemas/enums.ts`
   - `DataSourceTypeSchema = z.enum(['official', 'estimated', 'scraped', 'user'])`
   - `ConfidenceLevelSchema = z.enum(['high', 'medium', 'low'])`
   - `EstimationMethodSchema = z.enum(['official', 'ingredients', 'extrapolation', 'scraped'])`
   - `PortionContextSchema = z.enum(['main_course', 'side_dish', 'dessert', 'starter', 'snack'])`
   - Export all four schemas and their inferred types (`DataSourceType`, `ConfidenceLevel`, `EstimationMethod`, `PortionContext`)

5. `packages/shared/src/schemas/dataSource.ts`
   - `DataSourceSchema` — shape matching the `data_sources` table row (id, name, type, url, lastUpdated, createdAt, updatedAt)
   - `CreateDataSourceSchema` — omit `id`, `createdAt`, `updatedAt`

6. `packages/shared/src/schemas/food.ts`
   - `FoodSchema` — all fields (id, name, nameEs, aliases array, foodGroup, sourceId, externalId, confidenceLevel, createdAt, updatedAt; **no embedding** — not representable in Zod/JSON)
   - `CreateFoodSchema` — omit `id`, `createdAt`, `updatedAt`

7. `packages/shared/src/schemas/foodNutrient.ts`
   - `FoodNutrientSchema` — all nutrient decimal fields plus id, foodId, sourceId, extra (z.record), confidenceLevel, createdAt, updatedAt
   - `CreateFoodNutrientSchema` — omit `id`, `createdAt`, `updatedAt`

8. `packages/shared/src/schemas/standardPortion.ts`
   - `StandardPortionSchema` — id, foodId (nullable), foodGroup (nullable), context, portionGrams, sourceId, notes, confidenceLevel, createdAt, updatedAt
   - `CreateStandardPortionSchema` — omit `id`, `createdAt`, `updatedAt`; add `.refine()` enforcing XOR: exactly one of `foodId` or `foodGroup` must be non-null

**Environment**

9. `packages/api/.env.example`
   - `DATABASE_URL="postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_dev?schema=public"`
   - `DATABASE_URL_TEST="postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test?schema=public"`

10. `packages/api/.env` (gitignored — developer creates locally from `.env.example`)

**Tests**

11. `packages/api/src/__tests__/migration.integration.test.ts`
    - Integration tests against the real DB (uses `foodxplorer_test`)
    - Tests all acceptance criteria that touch the database

12. `packages/shared/src/__tests__/schemas.test.ts`
    - Unit tests for all Zod schemas (pure, no DB needed)

---

### Files to Modify

1. `packages/shared/src/index.ts`
   - Add exports for all new schema files:
     ```
     export * from './schemas/enums';
     export * from './schemas/dataSource';
     export * from './schemas/food';
     export * from './schemas/foodNutrient';
     export * from './schemas/standardPortion';
     ```

2. `packages/api/package.json`
   - Add `"prisma": { "seed": "tsx prisma/seed.ts" }` top-level key so `npm run db:seed` works
   - Verify `@prisma/client` and `prisma` devDependency versions are aligned (both `^6.4.1` — already correct)

3. `packages/shared/package.json`
   - Add `"dependencies": { "zod": "^3.24.2" }` if not already present (currently no deps section — zod must be declared here since shared is its own workspace package)

4. `packages/api/tsconfig.json`
   - Add `"prisma/**/*"` to `include` array so TypeScript picks up `prisma/seed.ts`

5. `docs/project_notes/key_facts.md`
   - Under "Reusable Components > Shared", list the four enum schemas and four entity schemas as available
   - Under "Reusable Components > Backend (packages/api)", note Prisma client location once created

6. `docs/project_notes/decisions.md`
   - Add ADR-002 documenting schema design decisions (pgvector as Unsupported, XOR constraint via raw SQL, dual FTS indexes Spanish+English)

---

### Implementation Order

Follow this sequence so each step compiles before the next:

1. **Environment setup** — Create `packages/api/.env.example` and local `.env`. Confirm Docker is running and `psql -h localhost -p 5433 -U foodxplorer -d foodxplorer_dev` connects.

2. **Shared package: add zod dependency** — Edit `packages/shared/package.json` to add `"dependencies": { "zod": "^3.24.2" }`, then run `npm install` from repo root.

3. **Shared schemas: enums** (`packages/shared/src/schemas/enums.ts`) — Create enums first; all other schemas depend on them.

4. **Shared schemas: entity schemas** — Create in this order (each depends on enums):
   - `dataSource.ts`
   - `food.ts`
   - `foodNutrient.ts`
   - `standardPortion.ts` (includes XOR `.refine()`)

5. **Update shared barrel export** (`packages/shared/src/index.ts`) — Export all new schemas.

6. **Shared schema unit tests** (`packages/shared/src/__tests__/schemas.test.ts`) — Write and run before touching Prisma. Tests must pass with `npm run test -w @foodxplorer/shared`.

7. **Prisma schema** (`packages/api/prisma/schema.prisma`) — Define enums and models. The `embedding` field uses `Unsupported("vector(1536)")`. Enum values in Prisma must match the Zod enum strings exactly.

8. **Generate migration (create-only)** — From `packages/api/`:
   ```
   DATABASE_URL="..." npx prisma migrate dev --create-only --name init_core_tables
   ```
   This generates the SQL file without applying it.

9. **Edit migration SQL** — Open the generated `migration.sql` and append the following raw SQL blocks **after** the generated `CREATE TABLE` statements:

   a. **pgvector column** — Add `embedding` column to `foods`:
   ```sql
   ALTER TABLE "foods" ADD COLUMN "embedding" vector(1536);
   ```

   b. **CHECK constraints on food_nutrients**:
   ```sql
   ALTER TABLE "food_nutrients"
     ADD CONSTRAINT "food_nutrients_calories_check"
       CHECK (calories >= 0 AND calories <= 900),
     ADD CONSTRAINT "food_nutrients_nutrients_non_negative_check"
       CHECK (proteins >= 0 AND carbohydrates >= 0 AND sugars >= 0
              AND fats >= 0 AND saturated_fats >= 0
              AND fiber >= 0 AND salt >= 0 AND sodium >= 0);
   ```

   c. **XOR CHECK constraint on standard_portions**:
   ```sql
   ALTER TABLE "standard_portions"
     ADD CONSTRAINT "standard_portions_food_xor_group_check"
       CHECK (
         (food_id IS NOT NULL AND food_group IS NULL) OR
         (food_id IS NULL AND food_group IS NOT NULL)
       );
   ```

   d. **UNIQUE constraint on food_nutrients** (if not already created by Prisma `@@unique`):
   ```sql
   -- Only add this manually if not using @@unique in schema.prisma
   -- Prefer @@unique in schema for Prisma awareness
   ```

   e. **Full-text search indexes on foods**:
   ```sql
   CREATE INDEX "foods_name_en_fts_idx"
     ON "foods" USING GIN (to_tsvector('english', "name"));

   CREATE INDEX "foods_name_es_fts_idx"
     ON "foods" USING GIN (to_tsvector('spanish', "name_es"));
   ```

   f. **GIN index on aliases array**:
   ```sql
   CREATE INDEX "foods_aliases_gin_idx"
     ON "foods" USING GIN ("aliases");
   ```

   g. **Partial indexes on standard_portions**:
   ```sql
   CREATE INDEX "standard_portions_food_id_partial_idx"
     ON "standard_portions" ("food_id")
     WHERE "food_id" IS NOT NULL;

   CREATE INDEX "standard_portions_food_group_partial_idx"
     ON "standard_portions" ("food_group")
     WHERE "food_group" IS NOT NULL;

   CREATE INDEX "standard_portions_food_group_context_idx"
     ON "standard_portions" ("food_group", "context");
   ```

   h. **Indexes on food_nutrients**:
   ```sql
   CREATE INDEX "food_nutrients_food_id_idx" ON "food_nutrients" ("food_id");
   CREATE INDEX "food_nutrients_source_id_idx" ON "food_nutrients" ("source_id");
   ```

   i. **Index on data_sources type**:
   ```sql
   CREATE INDEX "data_sources_type_idx" ON "data_sources" ("type");
   ```

10. **Apply migration** — From `packages/api/`:
    ```
    DATABASE_URL="..." npx prisma migrate dev
    ```
    Confirm with `\d foods` in psql that `embedding vector(1536)` column exists and all constraints are present.

11. **Generate Prisma client** — `npx prisma generate` (or it runs automatically after migrate dev).

12. **Update packages/api/package.json** — Add `"prisma": { "seed": "tsx prisma/seed.ts" }`.

13. **Update packages/api/tsconfig.json** — Add prisma directory to `include`.

14. **Seed script** (`packages/api/prisma/seed.ts`) — Implement seed with at least 1 DataSource, 3 Foods, 3 FoodNutrients, 3 StandardPortions. For the `embedding` column, use `prisma.$executeRaw` with a fixed 1536-dimension zero vector or a real embedding array. Run: `npm run db:seed -w @foodxplorer/api`.

15. **Integration tests** (`packages/api/src/__tests__/migration.integration.test.ts`) — Write and run all DB-level acceptance criteria tests.

16. **Update documentation** — `key_facts.md` and `decisions.md` (ADR-002).

---

### Prisma Schema Design Details

**Enum mapping** — Prisma enum values should use lowercase snake_case to match PostgreSQL conventions. Map Prisma field names to DB column names with `@map` and model names to table names with `@@map`.

**Model: DataSource**
```
model DataSource {
  id          String         @id @default(uuid()) @db.Uuid
  name        String         @db.VarChar(255)
  type        DataSourceType
  url         String?        @db.Text
  lastUpdated DateTime?      @map("last_updated")
  createdAt   DateTime       @default(now()) @map("created_at")
  updatedAt   DateTime       @updatedAt @map("updated_at")

  foods            Food[]
  foodNutrients    FoodNutrient[]
  standardPortions StandardPortion[]

  @@map("data_sources")
}
```

**Model: Food**
```
model Food {
  id             String         @id @default(uuid()) @db.Uuid
  name           String         @db.VarChar(255)
  nameEs         String         @map("name_es") @db.VarChar(255)
  aliases        String[]
  foodGroup      String?        @map("food_group") @db.VarChar(100)
  sourceId       String         @map("source_id") @db.Uuid
  externalId     String?        @map("external_id") @db.VarChar(100)
  confidenceLevel ConfidenceLevel @map("confidence_level")
  // embedding column added via raw SQL — NOT declared here in Prisma schema
  // Use Unsupported if you need Prisma to be aware of it (optional):
  // embedding    Unsupported("vector(1536)")?
  createdAt      DateTime       @default(now()) @map("created_at")
  updatedAt      DateTime       @updatedAt @map("updated_at")

  source           DataSource       @relation(fields: [sourceId], references: [id])
  foodNutrients    FoodNutrient[]
  standardPortions StandardPortion[]

  @@unique([externalId, sourceId])
  @@map("foods")
}
```

**Model: FoodNutrient**
```
model FoodNutrient {
  id             String          @id @default(uuid()) @db.Uuid
  foodId         String          @map("food_id") @db.Uuid
  calories       Decimal         @db.Decimal(8, 2)
  proteins       Decimal         @db.Decimal(8, 2)
  carbohydrates  Decimal         @db.Decimal(8, 2)
  sugars         Decimal         @db.Decimal(8, 2)
  fats           Decimal         @db.Decimal(8, 2)
  saturatedFats  Decimal         @map("saturated_fats") @db.Decimal(8, 2)
  fiber          Decimal         @db.Decimal(8, 2)
  salt           Decimal         @db.Decimal(8, 2)
  sodium         Decimal         @db.Decimal(8, 2)
  extra          Json?
  sourceId       String          @map("source_id") @db.Uuid
  confidenceLevel ConfidenceLevel @map("confidence_level")
  createdAt      DateTime        @default(now()) @map("created_at")
  updatedAt      DateTime        @updatedAt @map("updated_at")

  food   Food       @relation(fields: [foodId], references: [id])
  source DataSource @relation(fields: [sourceId], references: [id])

  @@unique([foodId, sourceId])
  @@map("food_nutrients")
}
```

**Model: StandardPortion**
```
model StandardPortion {
  id             String         @id @default(uuid()) @db.Uuid
  foodId         String?        @map("food_id") @db.Uuid
  foodGroup      String?        @map("food_group") @db.VarChar(100)
  context        PortionContext
  portionGrams   Decimal        @map("portion_grams") @db.Decimal(8, 2)
  sourceId       String         @map("source_id") @db.Uuid
  notes          String?        @db.Text
  confidenceLevel ConfidenceLevel @map("confidence_level")
  createdAt      DateTime       @default(now()) @map("created_at")
  updatedAt      DateTime       @updatedAt @map("updated_at")

  food   Food?      @relation(fields: [foodId], references: [id])
  source DataSource @relation(fields: [sourceId], references: [id])

  // XOR constraint enforced via raw SQL CHECK in migration — not expressible in Prisma
  @@map("standard_portions")
}
```

**Note on embedding column:** The `embedding` field can be declared in the Prisma schema using `Unsupported("vector(1536)")` OR omitted entirely and managed only via raw SQL. If declared with `Unsupported`, Prisma will include it in the `CREATE TABLE` statement. If omitted, it must be added via `ALTER TABLE` in the migration. **Recommended approach: declare it with `Unsupported("vector(1536)")?` so Prisma generates the column, then verify Prisma's generated SQL includes it. If not, add the `ALTER TABLE` raw SQL block.** Either way, verify the column exists before considering the migration done.

---

### Testing Strategy

**Test runner: Vitest** (not Jest). All test files use Vitest imports: `import { describe, it, expect, beforeAll, afterAll } from 'vitest'`.

**File 1: `packages/shared/src/__tests__/schemas.test.ts`**
- Pure unit tests, no DB, no mocking needed
- Key scenarios:
  - Each enum schema accepts all valid values and rejects invalid strings
  - `CreateDataSourceSchema`: valid input passes, missing required fields fail, extra fields stripped
  - `CreateFoodSchema`: valid input passes, empty name fails, aliases array validated
  - `CreateFoodNutrientSchema`: decimal fields validated, negative values fail (Zod `z.number().nonnegative()`), calories > 900 fails
  - `CreateStandardPortionSchema` XOR refine: `{foodId: 'uuid', foodGroup: null}` passes; `{foodId: null, foodGroup: 'Cereales'}` passes; `{foodId: null, foodGroup: null}` fails; `{foodId: 'uuid', foodGroup: 'Cereales'}` fails
  - Happy path: full valid object parses to correct shape with all required fields
  - Edge case: `extra` field on `FoodNutrientSchema` accepts arbitrary JSON object

**File 2: `packages/api/src/__tests__/migration.integration.test.ts`**
- Integration tests against real `foodxplorer_test` database
- Setup: `beforeAll` applies migrations to test DB (or relies on pre-migrated state via `prisma migrate deploy`)
- Teardown: `afterAll` truncates all tables in reverse dependency order: `standard_portions`, `food_nutrients`, `foods`, `data_sources`
- Uses `@prisma/client` with `DATABASE_URL` pointing to test DB

  **Happy path tests:**
  - Insert a `DataSource` → returns row with UUID and timestamps
  - Insert a `Food` with source relation → returns joined row
  - Insert a `FoodNutrient` with valid nutrient values → succeeds
  - Insert a `StandardPortion` with only `foodId` set → succeeds
  - Insert a `StandardPortion` with only `foodGroup` set → succeeds

  **Constraint enforcement tests (all expected to throw PrismaClientKnownRequestError or raw DB error):**
  - Inserting `FoodNutrient` with `calories = -1` → fails CHECK constraint
  - Inserting `FoodNutrient` with `calories = 901` → fails CHECK constraint
  - Inserting `FoodNutrient` with `proteins = -0.1` → fails CHECK constraint
  - Inserting duplicate `FoodNutrient` with same `(food_id, source_id)` → fails UNIQUE constraint
  - Inserting duplicate `Food` with same `(external_id, source_id)` → fails UNIQUE constraint
  - Inserting `StandardPortion` with both `foodId` and `foodGroup` set → fails XOR CHECK
  - Inserting `StandardPortion` with both `foodId` and `foodGroup` null → fails XOR CHECK

  **Index/search tests (use `prisma.$queryRaw`):**
  - FTS query `to_tsvector('spanish', name_es) @@ plainto_tsquery('spanish', ...)` returns expected row
  - FTS query `to_tsvector('english', name) @@ plainto_tsquery('english', ...)` returns expected row
  - Array containment `aliases @> ARRAY['alias']::text[]` returns expected row
  - Verify `embedding` column exists: `SELECT column_name FROM information_schema.columns WHERE table_name = 'foods' AND column_name = 'embedding'` returns one row

  **Timestamp tests:**
  - `createdAt` is auto-set on insert (not null, close to `now()`)
  - `updatedAt` changes after update

---

### Key Patterns

**1. Prisma with Unsupported types**
The `vector(1536)` column is not natively supported. Two acceptable approaches:
- Declare `embedding Unsupported("vector(1536)")?` in schema — Prisma knows the column exists but cannot query it through the Prisma client. Use `prisma.$queryRaw` or `prisma.$executeRaw` for any read/write of this column.
- Omit from schema entirely and add via `ALTER TABLE` in migration SQL. This is simpler but Prisma Studio will not display the column.

Prefer declaring it with `Unsupported` for better tooling visibility.

**2. Editing migrations after `--create-only`**
The workflow is:
```
npx prisma migrate dev --create-only --name init_core_tables
# → Generates migration SQL file but does NOT apply it
# Edit the SQL file to add raw SQL blocks
npx prisma migrate dev
# → Applies the edited migration
```
If the migration is applied before editing, it must be rolled back (`prisma migrate reset` — destructive) or a new migration created with only the raw SQL additions.

**3. Zod Decimal handling**
Prisma returns `Decimal` objects (from the `decimal.js` library) for `Decimal` columns. In Zod schemas, represent these as `z.number()` (for API input) or `z.instanceof(Decimal)` (for DB output). For F001's Zod schemas, which define API input shapes, use `z.number().nonnegative()` for nutrient fields. Do not use `z.instanceof(Decimal)` in shared schemas — the `Decimal` class is a Prisma-specific runtime type and should not leak into the shared package.

**4. XOR constraint: double enforcement**
The XOR rule on `standard_portions` is enforced at two levels:
- **Database**: raw SQL `CHECK` constraint in migration (cannot be bypassed)
- **Zod**: `.refine()` on `CreateStandardPortionSchema` (catches it at API validation layer before DB call)
Both are required. The test must verify the DB-level constraint independently.

**5. Enum string casing**
PostgreSQL enums are case-sensitive. The Prisma enum values use lowercase (e.g., `official`, `high`). The DB stores exactly those strings. Zod schemas must use the same lowercase strings. Do not use UPPER_CASE for enum values in this project.

**6. `@@unique` vs raw SQL UNIQUE**
Prefer `@@unique` in the Prisma schema for constraints Prisma needs to be aware of (e.g., `@@unique([foodId, sourceId])` on `FoodNutrient`). This generates the constraint in the migration SQL automatically. Only use raw SQL for constraints Prisma cannot express (CHECK, partial indexes, GIN indexes).

**7. Testing framework: Vitest**
`packages/api/package.json` declares `"test": "vitest run"`. All test files must use Vitest, not Jest. Key difference: `vi.fn()` instead of `jest.fn()`, `vi.mock()` instead of `jest.mock()`. For integration tests that connect to a real DB, no mocking is needed — use the actual Prisma client against `foodxplorer_test`.

**8. DATABASE_URL for tests**
The test suite must use `foodxplorer_test` not `foodxplorer_dev`. Set `DATABASE_URL` in test setup via a `vitest.config.ts` environment override or by reading from a `.env.test` file using the `dotenv` package. The developer should decide which approach; both are acceptable. Document the chosen approach in the test file's top comment.

**9. Seed script inserts the embedding column**
Prisma's generated client cannot insert into an `Unsupported` column via the model's `create()` method. Use this pattern:
```typescript
// After creating the food record, update the embedding via raw SQL
await prisma.$executeRaw`
  UPDATE foods SET embedding = '[0,0,0,...,0]'::vector WHERE id = ${foodId}::uuid
`
```
Use a 1536-dimension zero vector for seed data. This is safe for development seeding.

**10. Prisma Client singleton**
Create `packages/api/src/infrastructure/prismaClient.ts` only if needed by other files in this ticket. For F001, the Prisma client is only used in `seed.ts` and the integration test. In `seed.ts`, instantiate it directly: `const prisma = new PrismaClient()`. The singleton pattern is for the server runtime — F004+ will establish it.

---

## Acceptance Criteria

- [ ] Prisma schema defines all 4 enums and 4 models with correct types and relations
- [ ] Migration runs successfully against PostgreSQL 16 + pgvector
- [ ] All CHECK constraints are enforced (test: inserting negative calories fails)
- [ ] XOR constraint on standard_portions works (test: NULL/NULL and dual-set both fail)
- [ ] UNIQUE constraints prevent duplicate insertion (test: duplicate food_id+source_id in food_nutrients fails)
- [ ] FTS index works (test: `to_tsvector('spanish', name_es)` query returns results)
- [ ] GIN index on aliases works (test: array containment query returns results)
- [ ] `embedding` column exists as `vector(1536)` type
- [ ] `created_at` defaults to NOW(), `updated_at` auto-updates via Prisma
- [ ] Seed script inserts at least 1 data_source + 3 foods + 3 food_nutrients + 3 standard_portions without errors
- [ ] All tests pass
- [ ] Build succeeds

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Unit/integration tests written and passing
- [ ] Code follows project standards
- [ ] No linting errors
- [ ] Build succeeds
- [ ] ADR-002 registered for schema design decisions

---

## Workflow Checklist

- [x] Step 0: Spec created (database-architect review + spec drafted)
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` executed, plan approved
- [x] Step 3: `backend-developer` executed with TDD (55 tests passing)
- [x] Step 4: `production-code-validator` executed, quality gates pass (0 issues)
- [x] Step 5: `code-review-specialist` executed (3 important findings, all fixed)
- [x] Step 5: `qa-engineer` executed (2 bugs + 1 infra issue found, all fixed, 28 edge-case tests added)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-10 | Spec created | Database-architect reviewed schema, added constraints/indexes/enums |
| 2026-03-10 | Branch created | feature/F001-prisma-schema-core-tables from develop |
| 2026-03-10 | Plan approved | Implementation plan written by backend-planner, approved by user |
| 2026-03-10 | Implementation complete | 55 tests (37 unit + 18 integration), all passing |
| 2026-03-10 | Validation complete | production-code-validator: 0 issues, ready for production |
| 2026-03-10 | Code review | 3 important: extra nullable, redundant index, tsconfig. All fixed. |
| 2026-03-10 | QA | BUG-01 portion_grams CHECK, BUG-02 seed fallback, INFRA-01 test parallelism. All fixed. 28 edge-case tests added. |
| 2026-03-10 | Final test count | 83 tests (37 shared unit + 18 integration + 28 edge-cases), all passing |

---

---

## Appendix: Nutrition API Research (2026-03-11)

Comparative analysis of 7 nutrition APIs (USDA FoodData Central, Nutritionix, Edamam, Open Food Facts, Calorie Mama, FatSecret, Spoonacular) identified the following gaps in the F001 schema. These are addressed in F001b.

**Gaps identified (high priority):**
1. No `foodType` discriminator (branded/generic/composite) — present in ALL APIs
2. No `brandName` field — present in USDA, Nutritionix, FatSecret, Open Food Facts
3. No `barcode` (UPC/EAN) field — present in USDA, Nutritionix, Open Food Facts
4. No `referenceBasis` on nutrients (per 100g vs per serving) — present in ALL APIs
5. `StandardPortion` missing `description` ("1 cup") and `isDefault` flag — present in ALL APIs
6. No recipe/ingredient composition model — present in USDA, Spoonacular, Edamam
7. Missing common typed nutrient columns (transFats, cholesterol, potassium, mono/polyunsaturatedFats) — present in ALL APIs (17-160 nutrients)

**What was validated as correct:** externalId+sourceId pattern, DataSource model, confidenceLevel, pgvector embedding, aliases[], StandardPortion.context enum, extra JSONB.

*Ticket created: 2026-03-10*
