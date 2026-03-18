# Bug Log

Track bugs with their solutions for future reference. Focus on recurring issues, tricky bugs, and lessons learned.

## Format

```markdown
### YYYY-MM-DD — Brief Bug Description

- **Issue**: What went wrong (symptoms, error messages)
- **Root Cause**: Why it happened
- **Solution**: How it was fixed
- **Prevention**: How to avoid in future
```

---

<!-- Add bug entries below this line -->

### 2026-03-10 — BUG-01: Missing CHECK constraint on standard_portions.portion_grams

- **Issue**: DB accepted `portion_grams = 0` and `portion_grams = -50` via raw SQL inserts. The Zod schema enforced `z.number().positive()` at the API layer, but the DB had no CHECK constraint. Any direct DB access (migrations, admin tools, raw SQL) could persist invalid portion sizes.
- **Root Cause**: The database-architect spec included `CHECK (portion_grams > 0)` but it was missed during implementation of the migration SQL.
- **Solution**: Added `ALTER TABLE "standard_portions" ADD CONSTRAINT "standard_portions_portion_grams_check" CHECK (portion_grams > 0);` to the migration SQL. Re-applied migration.
- **Prevention**: For every Zod validation rule on numeric fields, verify there is a corresponding CHECK constraint in the migration SQL. Add integration tests that test the DB constraint directly (not just Zod).
- **Feature**: F001 | **Found by**: qa-engineer | **Severity**: Medium

### 2026-03-10 — BUG-02: seed.ts fails without .env file (CI/CD blocker)

- **Issue**: Running `npm run db:seed -w @foodxplorer/api` without a `.env` file threw `PrismaClientInitializationError: Environment variable not found: DATABASE_URL`. The integration tests worked because they hardcoded a fallback URL, but the seed script did not.
- **Root Cause**: `new PrismaClient()` in `seed.ts` relied entirely on the `DATABASE_URL` environment variable with no fallback. CI/CD pipelines that set env vars directly (not via `.env` files) would work, but any environment missing both would fail.
- **Solution**: Added `datasources: { db: { url: process.env['DATABASE_URL'] ?? 'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_dev' } }` to the PrismaClient constructor in `seed.ts`.
- **Prevention**: All PrismaClient instantiations outside the main server should include a fallback URL for development. The server itself should fail fast if DATABASE_URL is missing (no fallback there).
- **Feature**: F001 | **Found by**: qa-engineer | **Severity**: High

### 2026-03-11 — F002 QA PASS — No bugs found in implementation

- **QA Coverage**: 86 new edge-case tests added in `migration.f002.edge-cases.test.ts`
- **Areas Verified**: Zod schema boundaries (max lengths, countryCode regex, calories=9000 boundary, portionGrams>0), DB CHECK constraints (all 9 non-negative nutrient constraints, calories 9000/9001, portionGrams 0/0.01, priceEur 0/-0.01, gramWeight 0, sortOrder 0), FK RESTRICT behavior (6 scenarios), junction table composite PK enforcement, partial unique index edge cases (null external_ids, cross-restaurant shared external_ids), DishAvailability enum DB consistency, FTS COALESCE fallback for Spanish index.
- **No Bugs Found**: Implementation matches spec. The ticket spec prose for `dish_nutrients_nutrients_non_negative_check` contained a misleading tautological clause (`AND extra IS NOT NULL OR extra IS NULL`) but the actual migration SQL was correctly implemented without it.
- **Feature**: F002 | **Assessed by**: qa-engineer

### 2026-03-11 — BUG-F001b-01: CreateRecipeSchema nullable fields not optional

- **Issue**: `CreateRecipeSchema` required callers to explicitly pass `null` for `servings`, `prepMinutes`, `cookMinutes` instead of allowing field omission. Zod's `.nullable()` permits `null` but NOT `undefined` (omission).
- **Root Cause**: `RecipeSchema` defined these fields as `z.number().int().nonnegative().nullable()`. When `CreateRecipeSchema` used `.omit()` to remove `id`/timestamps, the nullable-but-not-optional nature was preserved. Callers omitting the field got `ZodError: Required`.
- **Solution**: Added `.extend()` on `CreateRecipeSchema` to override the three fields with `.nullable().optional()`, matching the spec intent that nullable INT columns are omittable in create payloads.
- **Prevention**: For nullable DB columns, always use `.nullable().optional()` in Create schemas (not just `.nullable()`). The full/read schema should keep `.nullable()` only (field is always present in DB responses).
- **Feature**: F001b | **Found by**: qa-engineer | **Severity**: Medium

### 2026-03-17 — BUG-INFRA-01: Vitest tinypool ERR_IPC_CHANNEL_CLOSED on teardown

- **Issue**: `npm test -w @foodxplorer/api` exits with code 1 despite all 1319 tests passing. Error: `ERR_IPC_CHANNEL_CLOSED` during tinypool worker teardown. The exit code failure can break CI strict mode.
- **Root Cause**: Race condition in tinypool worker teardown within Vitest. Workers attempt IPC communication after the channel has been closed. Likely triggered by tests that call `process.exit()` (e.g., `batch-ingest-images.ts` CLI tests) or long-running async cleanup.
- **Solution**: Not yet fixed. Workaround: individual test files pass cleanly; only the full suite triggers the race.
- **Prevention**: Likely fix: update vitest/tinypool to latest version, or add `pool: 'forks'` in vitest config. Address before enabling CI strict mode (exit code enforcement).
- **Feature**: Infrastructure | **Found by**: user observation | **Severity**: Low | **Priority**: Low

### 2026-03-18 — BUG-F020-01: Query trim applied after min(1) validation

- **Issue**: `EstimateQuerySchema` defined `query: z.string().min(1).max(255).trim()`. A whitespace-only query like `"   "` passed `min(1)` (raw length 3), then Zod trimmed it to `""`. The empty string reached `level1Lookup` and returned a miss instead of a 400 validation error.
- **Root Cause**: Zod evaluates transforms in declaration order. `.min(1)` checked the raw (untrimmed) string, so whitespace-only inputs with length ≥ 1 bypassed the minimum length check.
- **Solution**: Reordered to `.trim().min(1).max(255)` so trim runs first, then `min(1)` rejects the empty result. Fixed in ce69f10.
- **Prevention**: For any Zod string schema with `.trim()`, always place `.trim()` BEFORE length validators (`.min()`, `.max()`). Zod processes transforms left-to-right.
- **Feature**: F020 | **Found by**: qa-engineer | **Severity**: Medium

### 2026-03-18 — BUG-F020-02: Echo returned lowercase query instead of original casing

- **Issue**: `GET /estimate?query=Big+Mac` returned `"query": "big mac"` in the response body. The spec sample shows `"query": "Big Mac"` — original casing should be preserved in the echo.
- **Root Cause**: The route applied `.toLowerCase()` for cache key normalization and reused the same lowercased variable for the response `data.query` field.
- **Solution**: Store original query (post-Zod-trim) for response echo. Use lowercased version only for cache key construction and DB lookup. Fixed in ce69f10.
- **Prevention**: When normalizing user input for internal use (cache keys, DB queries), keep the original value separate for echo/display purposes.
- **Feature**: F020 | **Found by**: qa-engineer | **Severity**: Low
