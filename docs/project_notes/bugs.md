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

### 2026-03-28 — BUG-F043-01: Leading ¿ (inverted question mark) blocks NL comparison detection

- **Issue**: `extractComparisonQuery` uses `^` anchor in its prefix regexes. Spanish users who type `¿qué tiene más calorías, big mac o whopper?` (with the conventional Spanish opening `¿`) receive a single-dish estimate for the full garbled string instead of a comparison card. This is the exact motivating example from the ticket spec (F043, line 15). The NL handler calls `handleNaturalLanguage` on the trimmed text without stripping leading `¿` or `¡`.
- **Root Cause**: All five prefix patterns in `comparisonParser.ts` anchor at `^`. `¿` is a valid UTF-8 character that appears before `qué` in formal Spanish, so the `^qu[eé]...` pattern never matches.
- **Solution**: Strip leading `¿`/`¡` from text in `extractComparisonQuery` (or from `handleNaturalLanguage`) before applying prefix matching. One-liner: `const normalized = text.replace(/^[¿¡]+/, '').trim();` then pass `normalized` to `matchPrefix`. Trailing `?`/`!` can also be stripped before `splitByComparator` to prevent punctuation from ending up in the API query.
- **Prevention**: When implementing intent detection with `^`-anchored regexes for Spanish text, always normalize leading/trailing Spanish punctuation characters (`¿`, `¡`, `?`, `!`) before matching.
- **Tests**: `f043.qa-edge-cases.test.ts` — "F043 BUG-1" describe block (5 failing tests).
- **Feature**: F043 | **Found by**: qa-engineer | **Severity**: High

### 2026-03-28 — BUG-F043-02: Same-entity detection absent from formatComparison

- **Issue**: When both dish queries resolve to the same database entity (same `entityId`), `formatComparison` silently renders identical values in both columns with no indicator. The spec (F043, line 302-303) explicitly requires the note: `_Ambos platos corresponden al mismo resultado en la base de datos\._`
- **Root Cause**: `formatComparison` never compares `resultA.entityId` against `resultB.entityId`. The spec requirement was not implemented.
- **Solution**: In `formatComparison`, after confirming both results are non-null, check `resultA.entityId === resultB.entityId`. If true, append the required note outside the code block.
- **Prevention**: When a spec section lists edge case output requirements, add a corresponding test fixture where the edge case condition is satisfied, not just where results differ.
- **Tests**: `f043.qa-edge-cases.test.ts` — "F043 BUG-2" describe block (1 failing test).
- **Feature**: F043 | **Found by**: qa-engineer | **Severity**: Low

### 2026-03-28 — BUG-F043-03: "con" separator in NL path beats "o" for dish names containing "con"

- **Issue**: When a Spanish NL comparison query contains a dish whose name includes the word "con" (e.g., "pollo con verduras", "arroz con leche"), and the user separates the two dishes with "o" (e.g., `qué es más sano, pollo con verduras o hamburguesa`), the `splitByComparator` function splits on the first space-flanked ` con ` rather than the last space-flanked ` o `. This produces `dishA = "pollo"` / `dishB = "verduras o hamburguesa"` instead of `dishA = "pollo con verduras"` / `dishB = "hamburguesa"`.
- **Root Cause**: `COMPARISON_SEPARATORS` orders `'con'` before `'o'`. Both use space-flanked + last-occurrence strategy. When "con" appears in the dish name before the "o" separator, "con" wins because it is tried first. The last-occurrence strategy helps when the separator appears multiple times, but cannot help when "con" in the dish name appears before the "o" separator in text position.
- **Solution**: Separate the role of "con" in the command parser from the NL split. Option A: remove "con" from `COMPARISON_SEPARATORS` entirely and handle the `compara X con Y` NL pattern by using a dedicated regex that captures two named groups (everything before and after the last `con`). Option B: in `extractComparisonQuery`, when `con` wins but `o` or `y` also exists in the remainder, prefer the later-positioned `o`/`y` separator. Option C: only use `con` when it is the SOLE separator in the text (not when `o`/`y` also appears).
- **Prevention**: When adding conjunctions like "con" as separators, verify they don't conflict with the same word appearing legitimately inside dish names. Prefer dedicated NL prefix groups over generic separator lists for context-sensitive parsing.
- **Tests**: `f043.qa-edge-cases.test.ts` — "F043 BUG-3" describe block (2 failing NL tests). Note: `/comparar` command correctly handles "arroz con leche vs natillas" because `vs` has higher priority.
- **Feature**: F043 | **Found by**: qa-engineer | **Severity**: Medium

### 2026-03-28 — BUG-LANDING-01: Legal pages return 404 (/privacidad, /cookies, /aviso-legal)

- **Issue**: Footer and CookieBanner link to /privacidad, /cookies, /aviso-legal but no routes exist. All return 404.
- **Root Cause**: Pages were planned but never created during F039/F044 implementation.
- **Solution**: Fixed in F045 — created 3 Server Component pages with GDPR/LOPD/LSSI content, robots: { index: false }.
- **Prevention**: Any page that collects PII must have legal pages as a prerequisite (not a follow-up).
- **Feature**: F039/F044 | **Found by**: Cross-model audit (Claude+Gemini+Codex) | **Severity**: Critical (GDPR/LSSI non-compliance)

### 2026-03-28 — BUG-LANDING-02: og-image.jpg referenced in metadata but missing from public/

- **Issue**: layout.tsx metadata references /og-image.jpg for OpenGraph and Twitter cards. File does not exist in packages/landing/public/. All social sharing shows broken or fallback preview.
- **Root Cause**: Metadata was configured but the image asset was never created.
- **Solution**: Fixed in F045 — generated 1200x630 branded OG image (botanical green, 45KB) at public/og-image.jpg.
- **Prevention**: After configuring OG metadata, verify the referenced assets exist (automated check in production-code-validator).
- **Feature**: F039/F044 | **Found by**: Cross-model audit | **Severity**: Critical (blocks social sharing)

### 2026-03-28 — BUG-LANDING-03: Anchor links #waitlist and #demo point to non-existent IDs

- **Issue**: SiteHeader links to #waitlist and #demo. Neither ID exists in the DOM. Clicking does nothing.
- **Root Cause**: SiteHeader was built with placeholder anchors that were never wired to section IDs.
- **Solution**: Fixed in F045 — added id="waitlist" to WaitlistCTASection, id="demo" to product-demo section in all variant layouts.
- **Prevention**: Test anchor navigation as part of section integration.
- **Feature**: F044 | **Found by**: Cross-model audit | **Severity**: Important

### 2026-03-28 — BUG-LANDING-04: Variant D hero promises "Busca cualquier plato" but SearchSimulator is not in hero

- **Issue**: Variant D hero says "Busca cualquier plato. Mira qué sabes." but the SearchSimulator component is rendered in HowItWorksSection below the fold, not in the hero. A placeholder div exists but renders nothing.
- **Root Cause**: Implementation didn't embed SearchSimulator in the hero as designed.
- **Solution**: Fixed in F045 — Variant D fully removed per ADR-012 (types, routing, i18n, tests, API validation).
- **Prevention**: After implementing a variant, verify the user journey matches the hero promise.
- **Feature**: F044 | **Found by**: Cross-model audit | **Severity**: Critical (100% promise mismatch)

### 2026-03-28 — BUG-LANDING-05: PostSimulatorCTA visible before user interacts with SearchSimulator

- **Issue**: The "¿Te gusta lo que ves?" CTA with email form is visible from first render, before the user has used the SearchSimulator. It should only appear after a search interaction.
- **Root Cause**: SearchSimulatorWithCTA initializes hasInteracted=true or doesn't gate visibility.
- **Solution**: Fixed in F045 — changed useState(true) to useState(false) in SearchSimulatorWithCTA; CTA gated by onInteract callback.
- **Prevention**: Interactive CTAs that depend on prior engagement should be gated by interaction state.
- **Feature**: F044 | **Found by**: Codex audit | **Severity**: Important

### 2026-03-28 — BUG-LANDING-06: PostSimulatorCTA uses animate-fadeIn but Tailwind defines animate-fade-in

- **Issue**: CSS animation class mismatch — `animate-fadeIn` vs `animate-fade-in`. Animation doesn't play.
- **Root Cause**: Typo in class name.
- **Solution**: Fixed in F045 — changed class to `animate-fade-in` in PostSimulatorCTA.tsx.
- **Prevention**: Use Tailwind IntelliSense to catch invalid class names.
- **Feature**: F044 | **Found by**: Codex audit | **Severity**: Low

### 2026-03-28 — BUG-LANDING-07: Missing suppressHydrationWarning on html tag

- **Issue**: Palette script sets data-palette on `<html>` before hydration, causing React hydration mismatch warning.
- **Root Cause**: layout.tsx `<html>` tag doesn't have `suppressHydrationWarning`.
- **Solution**: Fixed in F045 — added suppressHydrationWarning to `<html>` tag in layout.tsx.
- **Prevention**: Any script that mutates DOM before hydration needs suppressHydrationWarning on the affected element.
- **Feature**: F044 | **Found by**: Gemini audit | **Severity**: Important

### 2026-03-28 — BUG-F037-01: `/contexto BORRAR` (uppercase) routes to Set flow instead of Clear flow

- **Issue**: Typing `/contexto BORRAR` (or any mixed-case variant: `Borrar`, `BORRAR`) is treated as a chain name to set, not as the clear subcommand. The user gets "No encontré ninguna cadena" instead of the expected clear confirmation. The existing chain context is NOT cleared.
- **Root Cause**: `handleContexto` in `packages/bot/src/commands/contexto.ts` uses a strict case-sensitive equality check: `if (trimmed === 'borrar')`. The Telegram bot regex for `/contexto` passes `match[1]` verbatim — any casing variation bypasses the clear branch.
- **Solution**: Change the equality check to a case-insensitive comparison: `if (trimmed.toLowerCase() === 'borrar')`. The spec does not require case-sensitivity on this subcommand, and Telegram users commonly send mixed-case inputs.
- **Prevention**: Subcommand routing on freeform text args should always normalize case before comparing. Add test coverage for uppercase/mixed-case subcommand variants.
- **Feature**: F037 | **Found by**: qa-engineer | **Severity**: Low (UX confusing but no data loss)

### 2026-03-28 — BUG-F037-02: `detectContextSet` captures embedded newlines in chain identifier

- **Issue**: Input `"estoy en\nmcdonalds"` (newline-separated, possible from copy-paste or multiline Telegram message via the `/s` regex in `bot.ts`) returns `"mcdonalds"` instead of null. The `\s+` in `CONTEXT_SET_REGEX` matches newlines, so the newline is consumed as part of the `\s+` between "en" and the capture. The capture group `[^,¿?!.]{1,50}` then captures everything after the newline.
- **Root Cause**: `CONTEXT_SET_REGEX` is not anchored against multiline in the whitespace position, and `\s+` matches `\n`. This can cause surprising context-set matches for multi-line messages delivered from `/contexto` (which uses the `/s` dotAll flag in its registration regex).
- **Solution**: In `detectContextSet`, reject captures that contain newlines: `if (/\n/.test(captured)) return null;`. Alternatively, change `\s+` to `[^\S\n]+` (horizontal whitespace only) in the regex.
- **Prevention**: When writing regexes for Telegram bot input, account for the dotAll (`/s`) flag in the bot registration regex that can deliver multiline text. Test with `\n`-embedded inputs.
- **Feature**: F037 | **Found by**: qa-engineer | **Severity**: Low (edge case, graceful downstream handling via resolveChain min-length guard in most scenarios)

### 2026-03-28 — BUG-LANDING-08: JSON-LD SearchAction points to /?q= which doesn't function

- **Issue**: seo.ts includes a SearchAction schema with urlTemplate `/?q={search_term_string}`. The page doesn't read or act on ?q= parameter.
- **Root Cause**: SearchAction was added aspirationally but the functionality doesn't exist.
- **Solution**: Fixed in F045 — removed potentialAction (SearchAction) from generateWebSiteSchema() in seo.ts.
- **Prevention**: Only include structured data for features that actually exist.
- **Feature**: F044 | **Found by**: Claude+Codex audit | **Severity**: Important

### 2026-03-28 — BUG-F046-01: WaitlistForm crashes on API errors — type contract mismatch between API error shape and component expectation

- **Issue**: `WaitlistForm.tsx` types the error response body as `{ error?: string }` (line 141), but the Fastify `errorHandler.ts` ALWAYS returns `{ success: false, error: { code: string, message: string } }`. When any non-ok HTTP response is received (400, 429, 500), `setErrorMessage(data?.error)` stores an object in state. React then throws "Objects are not valid as a React child" when rendering `{errorMessage}` inside the `<p>` error element, crashing the form entirely.
- **Root Cause**: Developer tests in `WaitlistForm.test.tsx` mock error responses with `error: 'Error del servidor'` (a plain string) — a format that the real API never produces. This hidden the type mismatch. The real API always returns `error` as a nested object.
- **Solution**: In `WaitlistForm.tsx` handleSubmit error branch, extract the message from the error object before calling setErrorMessage: `const errMsg = typeof data?.error === 'object' ? (data.error as { message?: string }).message ?? 'Ha ocurrido un error.' : data?.error ?? 'Ha ocurrido un error.'; setErrorMessage(errMsg);`. Also fix the type annotation from `{ error?: string }` to `{ error?: string | { code: string; message: string } }`.
- **Prevention**: Always mock API error responses with the exact shape the API actually returns. Integration-test the error path end-to-end (UI -> real fetch mock with real API response format). Use `satisfies` or typed API client responses to make mismatches compile-time errors.
- **Feature**: F046 | **Found by**: QA edge-case tests | **Severity**: Critical (production crash on any API error)

### 2026-03-28 — BUG-F046-02: POST /waitlist 409 response does not return existing record (spec deviation)

- **Issue**: The ticket spec states "return 409 with the existing record" and "this makes the endpoint idempotent" (lines 51, 59, 156). The implementation on P2002 throws `DUPLICATE_EMAIL` which maps to `{ success: false, error: { code: 'DUPLICATE_EMAIL' } }`. The existing record is never fetched (`prisma.waitlistSubmission.findUnique` is not called), and `data` is absent from the 409 body.
- **Root Cause**: The implementation plan in the same ticket (line 276) says "throw `DUPLICATE_EMAIL`" without referencing the spec requirement to return the existing record. The two sections of the ticket contradict each other and the developer followed the implementation plan rather than the spec description.
- **Solution**: On P2002, query the existing record with `findUnique({ where: { email } })` and return 409 with the existing record in `data`. The error handler approach should be replaced with a direct reply: `return reply.status(409).send({ success: false, error: { code: 'DUPLICATE_EMAIL' }, data: { id: existing.id, email: existing.email } })`. Alternatively, accept the current behavior as intentional (landing treats 409 as success regardless of body content) and update the spec to match.
- **Prevention**: When spec and implementation plan contradict each other, flag during implementation. QA should always compare the API response shape against the spec, not just the HTTP status code.
- **Feature**: F046 | **Found by**: QA edge-case tests | **Severity**: Medium (functional but spec non-compliant; landing handles 409 as success regardless)

### 2026-03-28 — BUG-F046-03: Email case sensitivity — same email with different casing bypasses duplicate detection

- **Issue**: `USER@EXAMPLE.COM` and `user@example.com` are accepted as distinct registrations. The Postgres `UNIQUE` constraint on `waitlist_submissions.email` is case-sensitive by default (uses `btree` index, no `lower()` function or `citext` type). A user could register twice with the same email address using different capitalization.
- **Root Cause**: The Zod schema and route handler store emails as-is without `toLowerCase()` normalization. The DB constraint enforces uniqueness but only exact-match. The email check constraint uses `~*` (case-insensitive regex), which validates format but not uniqueness.
- **Solution**: Normalize email to lowercase before persisting: `email: body.email.toLowerCase()` in the route handler. Alternatively, create a functional unique index: `CREATE UNIQUE INDEX ON waitlist_submissions (lower(email))` and change the constraint. Also add `.toLowerCase()` or `.transform(v => v.toLowerCase())` to the Zod schema.
- **Prevention**: Always normalize email addresses before persistence. Add an edge-case test for case-variant duplicates at both schema and DB levels.
- **Feature**: F046 | **Found by**: QA edge-case tests | **Severity**: Low (duplicate registrations with different casing; no data loss, but inflates subscriber count)

### 2026-03-29 — BUG-AUDIT-01: `¿` not stripped in NL single-dish path (extractFoodQuery)

- **Issue**: `¿cuántas calorías tiene un big mac?` is not parsed correctly. The prefix patterns in `extractFoodQuery` use `^` anchors but `¿` is not stripped before matching, so `¿cuántas...` doesn't match `^cu[aá]ntas...`. The text passes through unstripped and is sent literally to the API. Comparisons (`extractComparisonQuery`) and context detection (`detectContextSet`) DO strip `¿¡` correctly.
- **Root Cause**: `extractFoodQuery` in `naturalLanguage.ts` was implemented before the `¿` stripping pattern was established in F043 (`comparisonParser.ts:227`) and F037 (`contextDetector.ts:20`). The pattern was never backported.
- **Solution**: Add `¿¡` stripping at the top of `extractFoodQuery`, before prefix matching: `const cleaned = text.replace(/^[¿¡]+/, '').replace(/[?!]+$/, '').trim();`
- **Prevention**: When adding punctuation normalization to one NL path, check all NL paths for consistency.
- **Feature**: F028 (NL handler) | **Found by**: Gemini CLI manual audit | **Severity**: Medium (user input with `¿` silently degrades instead of failing)
