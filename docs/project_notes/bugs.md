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

### 2026-03-26 — BUG-F034-01: UNSUPPORTED_PDF not wrapped as MENU_ANALYSIS_FAILED in menuAnalyzer

- **Issue**: When `extractText` (pdf-parse wrapper) throws an `UNSUPPORTED_PDF` error (image-based PDF with no extractable text), the error propagates directly through `analyzeMenu` without being caught. The route's global error handler maps `UNSUPPORTED_PDF` to a 422 response with code `UNSUPPORTED_PDF`. However the F034 spec (Implementation Plan §PDF text extraction note) explicitly states: "If `extractText` throws `UNSUPPORTED_PDF`, catch and throw `MENU_ANALYSIS_FAILED` (422)". `UNSUPPORTED_PDF` is not listed in the F034 error code table — only `MENU_ANALYSIS_FAILED` is. Clients that only handle F034 error codes will encounter an undocumented code.
- **Root Cause**: `menuAnalyzer.ts` at lines 190–193 (OCR mode, PDF branch) and lines 251–255 (auto mode, PDF branch) calls `extractText(fileBuffer)` without a try/catch to intercept `UNSUPPORTED_PDF` and re-throw it as `MENU_ANALYSIS_FAILED`.
- **Solution**: Wrap each `extractText` call in a try/catch that catches errors with `code === 'UNSUPPORTED_PDF'` and re-throws a new error with `code: 'MENU_ANALYSIS_FAILED'` and `statusCode: 422`. Alternatively, catch all errors from `extractText` in the PDF branches and re-throw as `MENU_ANALYSIS_FAILED`.
- **Prevention**: When delegating to lower-level utilities that can throw domain-specific error codes, always audit whether those codes are part of the calling layer's API contract. If not, wrap and re-throw.
- **Feature**: F034 | **Found by**: qa-engineer | **Severity**: Low (functional — PDF still gets a 422; wrong code leaks through)
- **Test**: `f034.additional-edge-cases.test.ts` — "analyzeMenu — extractText throws UNSUPPORTED_PDF" (two tests marked `[BUG-CANDIDATE]`)

### 2026-03-26 — BUG-F034-02: partial:true with 0 dishes violates MenuAnalysisDataSchema.dishCount.min(1)

- **Issue**: If `analyzeMenu` returns `partial: true` after processing zero dishes (AbortSignal fires before the first cascade iteration), the route sends `dishCount: 0` and `dishes: []`. The `MenuAnalysisDataSchema` enforces `dishCount: z.number().int().min(1)` and `dishes: z.array(...).min(1)`, so the response body violates the documented schema. The route does not validate its own response against the schema before sending — this is a data consistency gap. Clients that validate the response against the spec will reject it.
- **Root Cause**: The route constructs the response directly from `result.dishes.length` (line 176 of `analyze.ts`) without checking whether the dishes array is empty in the partial case. The cooperative abort check in `analyzeMenu` (line 326) returns immediately with whatever has been processed, which can be an empty array.
- **Solution**: Either (a) validate that `result.dishes.length >= 1` before sending (returning a MENU_ANALYSIS_FAILED if empty), or (b) loosen the schema to allow `dishCount: 0` in the partial case (`z.number().int().min(0)` when `partial: true`), or (c) only return `partial: true` when at least 1 dish was processed.
- **Prevention**: Route handlers should validate their response shape against the documented schema before sending, especially for boundary cases created by timeout/abort paths.
- **Feature**: F034 | **Found by**: qa-engineer | **Severity**: Low (only affects a race condition where the timeout fires before a single cascade call completes)
- **Test**: `f034.additional-edge-cases.test.ts` — "analyzeMenu — AbortSignal pre-aborted" confirms the behavior.

### 2026-03-26 — BUG-F031-01: handlePhoto crashes with TypeError on empty msg.photo array

- **Issue**: `handlePhoto` in `packages/bot/src/handlers/fileUpload.ts` crashes with `TypeError: Cannot read properties of undefined (reading 'file_size')` when Telegram sends a message with an empty `msg.photo` array (`[]`). The outer `bot.on('photo', ...)` try/catch in `bot.ts` catches the error and logs it, but the user receives no response. Confirmed by QA test QA-B1 in `f031.qa-edge-cases.test.ts`.
- **Root Cause**: The guard `if (!msg.photo) return;` only protects against `undefined`/`null`. An empty array `[]` is truthy, so it passes the guard. Then `photos[photos.length - 1]` evaluates to `photos[-1]` which is `undefined`. The non-null assertion `!` on line 133 (`const photo = photos[photos.length - 1]!`) suppresses the TypeScript compiler but does not prevent the runtime error. When `photo` is `undefined`, the subsequent `photo.file_size` access throws.
- **Solution**: Add a length check after the `!msg.photo` guard: `if (!msg.photo || msg.photo.length === 0) return;`. This ensures `photos[photos.length - 1]` is always a defined `PhotoSize` object.
- **Prevention**: Non-null assertions (`!`) should be used only when the value is provably non-null by invariant. When the invariant relies on a separate guard, the guard must explicitly cover the empty-array case for array types. Consider replacing `const photo = photos[photos.length - 1]!` with `const photo = photos.at(-1); if (!photo) return;` for defensive access.
- **Feature**: F031 | **Found by**: qa-engineer | **Severity**: Medium (crashes silently — user gets no response, bot does not crash)

### 2026-03-28 — BUG-F042-01: PORTION_LABEL_MAP — spec labels corrected per code review

- **Issue**: Original spec had `0.5 → "pequeña"` and `0.7 → "mini"`, but semantically "media ración" (0.5 multiplier) should display "media" (half), not "pequeña" (small).
- **Root Cause**: Spec confusion between modifier tokens and display labels. "media ración" is the *input pattern* for 0.5, but the *display label* should match the concept: "media" = half portion.
- **Solution**: Corrected spec and implementation: `{ 0.5: 'media', 0.7: 'pequeña', 1.5: 'grande', 2.0: 'doble', 3.0: 'triple' }`. Approved by code-review-specialist.
- **Prevention**: Distinguish input patterns (what the user types) from display labels (what the bot shows). Review label maps for semantic accuracy, not just spec compliance.
- **Feature**: F042 | **Found by**: code-review-specialist | **Severity**: Low (spec correction, not runtime bug)
