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

### 2026-03-29 — BUG-F047-01: Footer WaitlistForm violates S7 max 2 forms per variant

- **Issue**: Footer.tsx line 110 rendered a `<WaitlistForm source="footer" variant={variant} />`, making 3 WaitlistForm instances per variant page (hero + WaitlistCTASection + Footer). The audit requirement S7 specifies max 2 forms to avoid conversion fatigue.
- **Root Cause**: The Footer form was added during F044 overhaul and not removed during F047 "reduce forms to 2" implementation. The spec explicitly stated "The Footer component does NOT contain a WaitlistForm" but the developer did not audit Footer.tsx.
- **Solution**: Fixed in F047 — removed WaitlistForm import and the "Acceso anticipado" column from Footer.tsx. Updated Footer test to assert no form button.
- **Prevention**: When reducing form instances, audit ALL components that import WaitlistForm, not just variant layouts in page.tsx.
- **Feature**: F047 | **Found by**: qa-engineer | **Severity**: Medium

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

### 2026-03-29 — BUG-C1: Rate limit checked AFTER file download in upload_menu/upload_dish

- **Issue**: In `callbackQuery.ts`, the `upload_menu` and `upload_dish` handlers downloaded the full file from Telegram into a memory buffer BEFORE checking the per-user rate limit. A rate-limited user spamming the inline keyboard could force repeated downloads, wasting bandwidth and memory.
- **Root Cause**: Original F034 spec assumed download was cheap and ordered the checks as "download → rate limit → API call". In practice, download is the most expensive step.
- **Solution**: Moved `isRateLimited()` check BEFORE `downloadTelegramFile()` in both handlers. Rate-limited users now incur zero server cost.
- **Prevention**: Rate limit checks should always be the FIRST guard after auth/state validation — before any I/O operations.
- **Feature**: F034 (Menu Analysis) | **Found by**: Gemini CLI comprehensive audit | **Severity**: Critical (DDoS vector) | **Fixed in**: F051

### 2026-03-29 — BUG-I11: /receta rate limit counts failed API requests

- **Issue**: In `receta.ts`, the rate limit counter was incremented BEFORE the API call. If the API returned an error (500, timeout, network), the user lost a rate limit slot without getting a useful result.
- **Root Cause**: Rate limit increment was placed at the start of the function, before the try/catch block for the API call.
- **Solution**: Added `decrementRateLimit()` helper that calls `redis.decr()` on server/network errors (5xx, TIMEOUT, NETWORK_ERROR). 4xx errors (user input) and 429 (legitimate throttle) keep the counter. Decrement failures are silently swallowed (fail-open).
- **Prevention**: Consider the full lifecycle of rate-limit counters: increment early for abuse prevention, but refund on infrastructure failures.
- **Feature**: F041 (Bot Recipe Calculator) | **Found by**: Claude Opus 4.6 comprehensive audit | **Severity**: Important | **Fixed in**: F051

### 2026-04-03 — BUG-F071-01: parseNutrientValue passes Infinity through as a valid number

- **Issue**: `parseBedcaFoods()` in `bedcaParser.ts` returns `Infinity` (JavaScript's positive infinity) as a valid nutrient value when the XML source contains the literal string `"Infinity"`. The value is then stored as-is in `BedcaNutrientValue.value` and passed downstream to the mapper and DB seed. `Infinity` is not a valid nutrition value and would likely fail PostgreSQL insertion (Prisma converts Infinity to a non-finite float, which violates DB numeric columns).
- **Root Cause**: The internal `parseNutrientValue()` function guards against non-numeric strings using `isNaN(num)`, but `isNaN(Infinity) === false` — JavaScript considers `Infinity` a valid number. The function does not check `Number.isFinite()`.
- **Solution**: In `parseNutrientValue()` in `packages/api/src/ingest/bedca/bedcaParser.ts`, change the guard from `isNaN(num) ? null : num` to `!Number.isFinite(num) ? null : num`. This converts both `NaN` and `Infinity`/`-Infinity` to null, which is the correct representation for unmeasured or invalid nutrient values.
- **Prevention**: When parsing user-supplied or API-supplied numeric strings into domain types, always validate with `Number.isFinite()` rather than `!isNaN()`. `isNaN()` allows Infinity, which is rarely a valid business value. Add `Number.isFinite()` assertions to all nutrient parsers.
- **Reproduction**: `parseBedcaFoods('<food_database><row><food_id>1</food_id>...<value>Infinity</value></row></food_database>')` — the returned food's nutrient has `value === Infinity`.
- **Feature**: F071 | **Found by**: QA agent | **Severity**: Medium | **Fixed in**: F071 (commit 21bc8d6)

### 2026-04-03 — F071 QA NOTES — Coverage gap (low priority)

- **Coverage Gap**: `seedPhaseBedca()` has no DI hook for the snapshot file path, making the "missing snapshot file" error path untestable without mocking `fs` at module level. The error produced is a bare Node.js ENOENT with no user-friendly message. Low priority — the file is committed to the repo.
- **Feature**: F071 | **Assessed by**: QA agent

### 2026-04-03 — BUG-F072-01: isAlreadyCookedFood false positives via substring matching

- **Issue**: `isAlreadyCookedFood` used plain substring matching (`includes()`) on cooking keywords. Names like `"uncooked rice"`, `"unbaked bread"` falsely triggered the guard.
- **Root Cause**: `lower.includes(keyword)` without word-boundary anchoring.
- **Solution**: Replaced with word-boundary regex `/\b<keyword>\b/i.test(foodName)`. 4 edge-case tests added.
- **Feature**: F072 | **Found by**: qa-engineer | **Severity**: Medium | **Fixed in**: F072 (commit 8f4c522)

---

### 2026-04-03 — BUG-F073-01: DishNutrient upsert update block missing estimationMethod, confidenceLevel, sourceId

- **Issue**: `seedPhaseSpanishDishes.ts` upserts DishNutrient records using `where: { id: entry.nutrientId }`. The `update` block contains only the 9 macro fields (calories, proteins, …, sodium). Fields `estimationMethod`, `confidenceLevel`, and `sourceId` are absent from `update`. On re-seed, if a dish's provenance is upgraded from `recipe` (Tier 3) to `bedca` (Tier 1), the DishNutrient row keeps the stale `estimationMethod='ingredients'`, `confidenceLevel='medium'`, and `sourceId` pointing to the recipes DataSource.
- **Root Cause**: Developer wrote the `create` block with all required fields but omitted the same provenance fields from the `update` block. The spec's "Gotcha — DishNutrient required fields" warned about `estimationMethod` and `confidenceLevel` in the create block but implicitly assumed update parity.
- **Solution**: Add `estimationMethod: entry.estimationMethod`, `confidenceLevel: entry.confidenceLevel`, and `sourceId` (computed from `entry.source`) to the `update` block of the `dishNutrient.upsert` call in `seedPhaseSpanishDishes.ts`.
- **Prevention**: When writing Prisma upserts with idempotency guarantees, always audit that `update` and `create` carry the same semantically-required fields. If a field must be correct after re-seed, it must appear in both blocks. Code review checklist should include "do update and create blocks cover all non-immutable fields?".
- **Feature**: F073 | **Found by**: qa-engineer | **Severity**: Major | **Exposed by**: `f073.seedPhaseSpanishDishes.edge-cases.test.ts` (5 tests)

### 2026-04-03 — BUG-F073-02: Dish upsert update block missing sourceId

- **Issue**: `seedPhaseSpanishDishes.ts` upserts Dish records. The `update` block contains `name`, `nameEs`, `aliases`, `portionGrams`, `confidenceLevel`, `estimationMethod` but not `sourceId`. If a dish's provenance source changes between seed versions (e.g., an LLM-estimated recipe dish gets BEDCA data), re-seeding leaves `Dish.sourceId` pointing to the old DataSource. This breaks the provenance chain at the Dish level while DishNutrient (once BUG-F073-01 is fixed) would be correct.
- **Root Cause**: `sourceId` was not included in the Dish `update` block. The create block correctly computes `sourceId` from `entry.source`, but the update path was not kept in sync.
- **Solution**: Add `sourceId` (computed from `entry.source` using the same `bedca ? BEDCA_SOURCE_UUID : COCINA_ESPANOLA_RECIPES_SOURCE_UUID` conditional) to the `update` block of the `dish.upsert` call.
- **Prevention**: Same as BUG-F073-01 — update/create parity audit.
- **Feature**: F073 | **Found by**: qa-engineer | **Severity**: Major | **Exposed by**: `f073.seedPhaseSpanishDishes.edge-cases.test.ts` (1 test)

### 2026-04-03 — BUG-F073-03: validateSpanishDishes does not validate dishId or nutrientId presence/format

- **Issue**: `validateSpanishDishes()` checks uniqueness of `dishId` and `nutrientId` via Set membership, but only after accessing `entry.dishId` and `entry.nutrientId` without a null/empty guard. A JSON entry with `dishId: null` or `dishId: ""` passes validation (`null` is added to the Set, treated as unique). When the seed then calls `prisma.dish.upsert({ where: { id: null } })`, Prisma throws a runtime FK/constraint error instead of a descriptive validation error.
- **Root Cause**: The uniqueness check loop assumes fields are non-null strings. No explicit guard for null, undefined, or empty-string dishId/nutrientId was added.
- **Solution**: Add checks in the per-entry loop: `if (!entry.dishId || entry.dishId.trim().length === 0)` → blocking error. Same for `nutrientId`. Optionally add UUID format regex validation.
- **Prevention**: When iterating over FK fields, always add a null/empty guard before the Set-membership check.
- **Feature**: F073 | **Found by**: qa-engineer | **Severity**: Major | **Exposed by**: `f073.validateSpanishDishes.edge-cases.test.ts` (4 tests)

### 2026-04-03 — BUG-F073-04: validateSpanishDishes does not cross-check source vs estimationMethod/confidenceLevel

- **Issue**: The spec mandates that `source='bedca'` implies `estimationMethod='official'` and `confidenceLevel='high'`, and `source='recipe'` implies `estimationMethod='ingredients'` and `confidenceLevel='medium'`. The validator checks each field independently but never cross-validates them. A JSON entry with `source='bedca'` and `estimationMethod='ingredients'` passes validation and seeds incorrect provenance metadata into the database.
- **Root Cause**: The validator was written as independent per-field checks. The cross-field invariant was documented in the spec but not translated into a validation rule.
- **Solution**: Add cross-check rules in the per-entry loop: if `entry.source === 'bedca'` and `entry.estimationMethod !== 'official'` → blocking error; if `entry.source === 'bedca'` and `entry.confidenceLevel !== 'high'` → blocking error; mirror for `'recipe'`.
- **Prevention**: Spec-derived cross-field invariants ("X implies Y") must be explicitly listed in the validator, not left implicit. During code review, audit whether all spec-stated implications are enforced.
- **Feature**: F073 | **Found by**: qa-engineer | **Severity**: Major | **Exposed by**: `f073.validateSpanishDishes.edge-cases.test.ts` (4 tests)

### 2026-04-03 — BUG-F073-05: validateSpanishDishes does not validate aliases is an array

- **Issue**: `validateSpanishDishes()` iterates over `entry.aliases` via the Set-membership path but never checks whether `aliases` is actually an array. A JSON entry with `aliases: "tortilla española"` (string) passes validation. At seed time, Prisma receives a string for a `String[]` column; behavior depends on the ORM/driver (may silently store it or throw a confusing error).
- **Root Cause**: The validator omits a `Array.isArray(entry.aliases)` guard. TypeScript types would catch this at compile time for authored code, but the JSON file is cast with `as SpanishDishesFile` and never validated at the type level at runtime.
- **Solution**: Add `if (!Array.isArray(entry.aliases))` check → blocking error in the per-entry validation loop.
- **Prevention**: Fields that are arrays in TypeScript but come from external JSON must always be validated with `Array.isArray()` at runtime, not trusted from the TypeScript cast.
- **Feature**: F073 | **Found by**: qa-engineer | **Severity**: Minor | **Exposed by**: `f073.validateSpanishDishes.edge-cases.test.ts` (2 tests)

### 2026-04-04 — BUG-F074-01: engineRouter.ts logger adapter calls logger.error() — method absent from Logger type

- **Issue**: The `applyYield` helper in `runEstimationCascade` builds a logger adapter for `resolveAndApplyYield`. The adapter at line 130 called `logger.error({}, msg)`, but `EngineRouterOptions.logger` was typed as `{ info, warn, debug }` — no `error` method. TypeScript reported `TS2339: Property 'error' does not exist`. At runtime, if `logger.error` was called (when `resolveAndApplyYield` hit an error code path), it would throw `TypeError: logger.error is not a function`.
- **Root Cause**: The `applyYield.ts` logger interface requires `{ warn, error }` but the `EngineRouterOptions.logger` type was not updated to include `error`. The adapter pattern tried to map the outer logger onto the inner interface but the outer type lacked the method.
- **Solution**: Added `error: (obj: Record<string, unknown>, msg?: string) => void` to the `EngineRouterOptions.logger` type and properly routed it in the adapter. Fixed in commit `f73c4f4`.
- **Prevention**: When building logger adapters between mismatched interfaces, verify at compile time that all required target methods exist on the source type. Add a `tsc --noEmit` step to CI to catch these type errors before tests.
- **Feature**: F074 | **Found by**: qa-engineer | **Severity**: High (runtime crash risk in error code path) | **TypeScript error**: `TS2339` | **Status**: Fixed in `f73c4f4`

### 2026-04-04 — BUG-F074-02: runStrategyA return type missing rawFoodGroup — TypeScript compile error

- **Issue**: `runStrategyA` returned `{ matchType, result, rawFoodGroup: nutrientRow.food_group }` but its declared return type was `{ matchType, result } | null` — no `rawFoodGroup`. TypeScript reported `TS2353: Object literal may only specify known properties, and 'rawFoodGroup' does not exist in type`. At runtime, the field WAS present in the JS object (JS does not strip extra properties), so the engine router's call to `applyYield(lookupResult4.result, lookupResult4.rawFoodGroup)` received the correct value. TypeScript-only error with no runtime impact.
- **Root Cause**: The `rawFoodGroup` field was added to the Strategy A return value (for yield correction threading, per F072) but was not added to the TypeScript return type declaration of `runStrategyA`.
- **Solution**: Add `rawFoodGroup?: string | null` to the `runStrategyA` declared return type. (Still open as of the QA session — remains in `tsc --noEmit` output.)
- **Prevention**: When adding fields to a function's return object, always update the TypeScript return type declaration in the same change. Enable `tsc --noEmit` in CI to catch these immediately.
- **Feature**: F074 | **Found by**: qa-engineer | **Severity**: Medium (TypeScript compile error; no runtime impact) | **TypeScript error**: `TS2353` | **Status**: Open — needs fix in `runStrategyA` return type

### 2026-04-04 — BUG-F075-01: handleVoice propagates sendChatAction failure — user gets no response

- **Issue**: In `packages/bot/src/handlers/voice.ts`, `await bot.sendChatAction(chatId, 'typing')` is called **outside** any try/catch block (lines 63-64). If Telegram's API returns an error (bot was blocked, chat ID invalid, network issue), the rejection propagates to the `bot.on('voice', ...)` wrapper in `bot.ts`, which only logs the error. The user receives **no response** — not even a generic error message. This is inconsistent with every other handler in the codebase where Telegram API calls are wrapped in try/catch.
- **Root Cause**: The typing chat action was placed between the bot-side guards (which have their own early-return sendMessage calls inside try blocks) and the file download try/catch, but outside both. No test covered a failing `sendChatAction`.
- **Solution**: Wrap `sendChatAction` in a fail-open try/catch: `try { await bot.sendChatAction(chatId, 'typing'); } catch { /* ignore — typing indicator is best-effort */ }`. The voice processing should continue regardless. The spec says (Key Patterns section): "Send `bot.sendChatAction(chatId, 'typing')` after the bot-side guards pass but BEFORE the file download and API call" — the fail-open behavior is implied by the design intent.
- **Prevention**: Bot-side Telegram API calls that are "best-effort" (chat actions, status updates) must always be wrapped in fail-open try/catch. Reserve propagation only for calls that are semantically required (e.g., the final `sendMessage` response — though even that should have a fallback log).
- **Feature**: F075 | **Found by**: qa-engineer | **Severity**: Medium (UX: silent failure on Telegram API blip) | **Exposed by**: `f075.voice.edge-cases.test.ts` — "BUG: sendChatAction rejects → error propagates" | **Status**: Open

### 2026-04-04 — BUG-F076-01: splitMenuItems splits compound dish names when last item contains " y "

- **Issue**: `detectMenuQuery('menú: sopa, arroz y verduras')` returns `['sopa', 'arroz', 'verduras']` instead of `['sopa', 'arroz y verduras']`. Any Spanish dish whose canonical name contains the conjunction " y " (e.g. "arroz y verduras", "macarrones y atún", "judías y patatas") is silently split into two separate queries when it appears as the last comma-separated item. Each fragment is then estimated independently, producing wrong nutritional totals — a dish estimated as "arroz" + "verduras" separately instead of "arroz y verduras".
- **Root Cause**: `splitMenuItems` applies `splitOnFinalConjunction` to the **last comma-split item** unconditionally. This heuristic is correct when there are NO commas (voice transcription like "gazpacho y café"), but incorrect when commas are present — in that case, all items are already separated and " y " inside the last item is part of the dish name, not a conjunction between list items.
- **Solution**: Apply `splitOnFinalConjunction` on the last item ONLY when there are no other commas in the input (i.e., `items.length === 1` path). When `items.length >= 2`, the comma already separated the items — skip conjunction splitting on the last element. The existing tests for the no-comma path (`"menú: gazpacho y ensalada"`) would remain correct; only the comma+conjunction path changes.
- **Prevention**: The conjunction-split heuristic must be guarded by whether commas were already used as separators. If commas are present, they are the authoritative separator and " y " within an item is part of the dish name. Add regression tests for compound dish names in last position: "arroz y verduras", "macarrones y atún", "bacalao y tomate".
- **Feature**: F076 | **Found by**: qa-engineer | **Severity**: High (wrong nutritional totals; silent data corruption) | **Exposed by**: `f076.menuDetector.edge-cases.test.ts` — 4 BUG-1 tests | **Status**: Fixed (bdbc698)

### 2026-04-06 — BUG-F080-01: offValidator crashes with TypeError on null code/id (JSON null from OFF API)

- **Issue**: Calling `validateOffProduct({ code: null, _id: 'abc' })` throws `TypeError: Cannot read properties of null (reading 'trim')`. The OFF API can return JSON `null` for optional string fields at runtime. When `product.code` is `null`, the identifier check evaluates `product.code !== undefined` as `true` (null is not undefined), then immediately calls `null.trim()` which crashes.
- **Root Cause**: The identifier check at `offValidator.ts:44` uses `product.code !== undefined && product.code.trim() !== ''`. The `!== undefined` guard does not protect against `null`; it only guards against missing fields. JSON deserialization produces `null` (not `undefined`) for explicitly null-valued fields in the OFF API response.
- **Solution**: Replace the `!== undefined` checks with null-safe optional chaining. Use `product.code?.trim()` (truthy check) instead of `product.code !== undefined && product.code.trim() !== ''`. Pattern: `(product.code != null && product.code.trim() !== '')`.
- **Prevention**: Any validator that receives external JSON data must guard against `null` separately from `undefined`. TypeScript's optional fields (`field?: string`) only prevent `undefined`, not `null`. Use `!= null` (double equals, covers both) or `?. ` optional chaining when calling methods on fields from external APIs.
- **Feature**: F080 | **Found by**: qa-engineer | **Severity**: High (crashes import for products with null code field) | **Exposed by**: `f080.edge-cases.unit.test.ts` — BUG-1 tests

### 2026-04-06 — BUG-F080-02: offValidator accepts null product_name as a valid name

- **Issue**: `validateOffProduct({ product_name: null, product_name_es: null, ... })` returns `{ valid: true }` instead of rejecting the product. The name check at `offValidator.ts:35-36` uses `product.product_name?.trim() !== ''` — optional chaining on `null` returns `undefined`, and `undefined !== ''` evaluates to `true`. The subsequent `product.product_name !== undefined` check also passes because `null !== undefined`. Both conditions are true, so `hasName = true` even though the product has no usable name.
- **Root Cause**: The name validation logic is logically inverted. It checks `value?.trim() !== ''` first (which is `true` for `null` due to optional chaining returning `undefined`) and then checks `value !== undefined` (which is `true` for `null`). The intent was to check "the field exists and is non-empty", but the implementation is backwards and `null` slips through.
- **Solution**: Replace the name check with null-safe equality: `(product.product_name != null && product.product_name.trim() !== '')`. Using `!= null` (loose inequality) covers both `null` and `undefined` in a single check.
- **Prevention**: When writing existence+non-empty checks for string fields, prefer `value != null && value.trim() !== ''` over optional chaining. The `?.` operator returns `undefined` for both `null` and `undefined` receivers, masking the null case.
- **Feature**: F080 | **Found by**: qa-engineer | **Severity**: Medium (products with null names pass validation and get imported with empty name strings) | **Exposed by**: `f080.edge-cases.unit.test.ts` — BUG-2 tests

### 2026-04-06 — BUG-F080-03: offMapper creates invalid externalId from whitespace barcode

- **Issue**: When `product.code = '   '` (whitespace only) and `product._id = 'abc123'`, the mapper's `computeExternalId` returns `'OFF-   '` (whitespace in the ID) instead of `'OFF-id-abc123'`. The barcode field is also set to `'   '` instead of `null`. The validator correctly rejects whitespace as a valid code identifier (using `.trim()` check), but if `_id` is present, the product passes validation. The mapper then uses `if (product.code)` (truthy check) — a whitespace string is truthy in JavaScript, so the mapper uses the whitespace code.
- **Root Cause**: `computeExternalId` in `offMapper.ts:29` uses `if (product.code)` (truthy) to check for a valid barcode. A non-empty whitespace string like `'   '` is truthy. The validator uses `product.code.trim() !== ''` (correct) but the mapper does not.
- **Solution**: Change `computeExternalId` to use `if (product.code?.trim())` to ensure the barcode is non-empty after trimming. Also change the barcode assignment `barcode: product.code ?? null` to `barcode: product.code?.trim() || null` to avoid storing whitespace barcodes.
- **Prevention**: When checking string values that come from external APIs, always apply `.trim()` before treating the string as non-empty. Use a helper `isNonEmpty(s: string | undefined | null)` that checks both null-safety and trim.
- **Feature**: F080 | **Found by**: qa-engineer | **Severity**: Medium (whitespace barcode stored in DB, wrong externalId created — products would not be idempotently upserted on re-run) | **Exposed by**: `f080.edge-cases.unit.test.ts` — BUG-3 tests

### 2026-04-04 — BUG-F076-02: NOISE_REGEX does not filter bare "€" symbol

- **Issue**: `detectMenuQuery('menú: gazpacho, €, pollo')` returns `['gazpacho', '€', 'pollo']` instead of `['gazpacho', 'pollo']`. A bare "€" symbol (without a digit before or after it) is not filtered by the noise regex and is passed to the estimation engine as a dish name query.
- **Root Cause**: `NOISE_REGEX` has two alternatives: `^\d+(?:[.,]\d+)?\s*(?:€|euros?)?$` (requires leading digit) and `^€\d` (requires digit after €). A lone "€" matches neither: it has no leading digit and no digit after it. This occurs in practice when users copy-paste menu OCR output containing a price written as "€" alone, or when Whisper transcribes a price separator as just the euro symbol.
- **Solution**: Extend `NOISE_REGEX` to also match `^€$` (exactly the euro symbol alone) or, more generally, `^€\d*$` to cover any standalone currency symbol variant. Alternatively, add `|^€$` to the existing regex: `/^\d+(?:[.,]\d+)?\s*(?:€|euros?)?$|^€\d|^€$/i`.
- **Prevention**: When defining noise filters for currency symbols, test all variants: with digit before, with digit after, and alone. Document the exact strings that should and should not be filtered in the regex definition comment.
- **Feature**: F076 | **Found by**: qa-engineer | **Severity**: Minor (bare "€" treated as dish name; estimation engine returns no result for it) | **Exposed by**: `f076.menuDetector.edge-cases.test.ts` — BUG-3 test | **Status**: Fixed (bdbc698)

### 2026-04-03 — BUG-F073-06: validateSpanishDishes throws TypeError on undefined/null input

- **Issue**: Calling `validateSpanishDishes(undefined)` or `validateSpanishDishes(null)` (which happens when `raw.dishes` is missing from the JSON) throws `TypeError: Cannot read properties of undefined (reading 'length')` instead of returning `{ valid: false, errors: [...] }`. The TypeError propagates as an unhandled exception from the seed function, bypassing the error-collection mechanism and producing a cryptic stack trace.
- **Root Cause**: The function opens with `if (dishes.length < 250)` with no null guard. The `seedPhaseSpanishDishes.ts` caller does `JSON.parse(readFileSync(...)) as SpanishDishesFile` and immediately accesses `raw.dishes` without checking the key exists, then passes it directly to `validateSpanishDishes`. If the JSON has no `dishes` key, `raw.dishes` is `undefined`.
- **Solution**: Add `if (!Array.isArray(dishes))` guard at the top of `validateSpanishDishes`: push a descriptive error and return `{ valid: false }` immediately. Alternatively, add a guard in `seedPhaseSpanishDishes.ts` before calling the validator.
- **Prevention**: Public validation functions accepting external data must guard against non-array input at the entry point before accessing any array method. Never trust a TypeScript cast on data loaded from disk.
- **Feature**: F073 | **Found by**: qa-engineer | **Severity**: Minor | **Exposed by**: `f073.validateSpanishDishes.edge-cases.test.ts` (2 tests)

### 2026-04-08 — BUG-AUDIT-C1C3: `/reverse-search` error envelope inconsistency

- **Issue**: (C1) 404 CHAIN_NOT_FOUND returns `{success: false, code: "CHAIN_NOT_FOUND", message: "..."}` — flat structure instead of nested `{success: false, error: {code, message}}`. (C3) 400 validation error returns raw Zod output `{success: false, error: {formErrors: [], fieldErrors: {...}}}` instead of the standard `{success: false, error: {code: "VALIDATION_ERROR", message: "..."}}` wrapper.
- **Root Cause**: The `/reverse-search` route handler in `reverseSearch.ts` constructs error responses manually instead of throwing typed errors for the global error handler to format. The Zod validation is done inline with `.safeParse()` and the error is returned directly without going through `mapError()`.
- **Solution**: Throw `CHAIN_NOT_FOUND` as a typed error (like other routes) so the global error handler wraps it. For Zod validation, use Fastify's built-in schema validation or throw a VALIDATION_ERROR with formatted message.
- **Prevention**: All routes must use the global error handler for error formatting. Never return error responses directly — always throw typed errors.
- **Feature**: F086 | **Found by**: Phase B Audit (Punto 2 + Codex review) | **Severity**: High | **Status**: Fixed (PR #82)

### 2026-04-08 — BUG-AUDIT-C4: POST endpoints return 500 on missing/invalid body

- **Issue**: POST to `/calculate/recipe` or `/conversation/message` without a body (or with invalid JSON) returns 500 INTERNAL_ERROR. Should return 400 VALIDATION_ERROR.
- **Root Cause**: Fastify's JSON body parser throws a `SyntaxError` (invalid JSON) or the route handler accesses `request.body` as null/undefined. The global error handler catches it as a generic error and returns 500.
- **Solution**: Add error handler case for `SyntaxError` / FST_ERR_CTP_EMPTY_JSON_BODY that maps to 400 VALIDATION_ERROR.
- **Prevention**: Test all POST endpoints with: no body, empty body `{}`, and invalid JSON as standard edge-case coverage.
- **Feature**: Global (all POST routes) | **Found by**: Phase B Audit (Punto 4) | **Severity**: Medium | **Status**: Fixed (PR #83)

### 2026-04-08 — BUG-AUDIT-C5: Reverse search via conversation returns empty results

- **Issue**: `POST /conversation/message` with reverse_search intent returns `intent: "reverse_search"` but no `reverseSearch` data. Direct `GET /reverse-search` works correctly for the same parameters.
- **Root Cause**: `conversationCore.ts:148` calls `reverseSearchDishes(db, {...})` wrapped in a `catch` block (line 161) that silently swallows the error. The actual DB error is unknown — possibly a Kysely instance mismatch between conversation and reverse-search routes.
- **Solution**: Add error logging in the catch block. Investigate whether the Kysely `db` instance is the same singleton. Fix the underlying query/instance issue.
- **Prevention**: Never use empty `catch` blocks — always log the error. Add integration tests exercising reverse_search via conversation endpoint.
- **Feature**: F086 | **Found by**: Phase B Audit (Punto 4) | **Severity**: Medium | **Status**: Fixed (PR #84)
