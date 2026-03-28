# F043: Dish Comparison via Bot

**Feature:** F043 | **Type:** Fullstack-Feature | **Priority:** Medium
**Status:** Done | **Branch:** merged to develop (squash)
**Created:** 2026-03-28 | **Dependencies:** F020–F024 ✅, F028 ✅, F042 ✅

---

## Spec

### Description

F043 adds a `/comparar` command and NL pattern recognition to the Telegram bot that lets users compare two dishes nutritionally. The bot resolves both dishes by making two parallel calls to the existing `GET /estimate` endpoint (`Promise.all`) and formats a side-by-side MarkdownV2 comparison card. No new API endpoint is created.

**Problem today:** Users asking "¿qué tiene más calorías, un big mac o un whopper?" receive a single-dish estimate for whatever fragment the NL handler extracts, rather than a comparison.

**Solution:** Two coordinated additions:

1. **`/comparar` command** — a new slash command in `packages/bot/src/commands/comparar.ts`. The user provides two dish expressions separated by a recognised separator token (`vs`, `o`, `versus`, `contra`). Each dish expression independently supports chain-scoping (`en <chain-slug>`) and portion modifiers (F042). The handler fires two `apiClient.estimate()` calls in parallel and passes both `EstimateData` results to the comparison formatter.

2. **NL comparison detection** — a new pure function `extractComparisonQuery(text)` in `packages/bot/src/lib/comparisonParser.ts`. This is called at the top of `handleNaturalLanguage` BEFORE the existing single-dish path. If a comparison pattern is detected the handler returns a comparison card; if not, execution falls through to the existing `extractFoodQuery` / single-dish path unchanged.

**No API changes.** The existing `GET /estimate` endpoint and all shared schemas remain unmodified.

---

### API Changes

None. F043 is bot-only. The existing `GET /estimate` endpoint is called twice in parallel using the existing `ApiClient.estimate()` method.

The `api-spec.yaml` version is NOT bumped — no API surface changed.

---

### Data Model Changes

None. No new tables, columns, migrations, or shared Zod schemas.

The `ComparisonData` type is bot-internal (not exported from `@foodxplorer/shared`) because no API endpoint exposes it.

**Bot-internal type** (defined in `packages/bot/src/lib/comparisonParser.ts`):

```
type NutrientFocusKey = 'calorías' | 'proteínas' | 'grasas' | 'carbohidratos' | 'fibra' | 'sodio' | 'sal';

interface ParsedComparison {
  dishA: string;                   // raw text for the first dish (pre-extraction)
  dishB: string;                   // raw text for the second dish (pre-extraction)
  nutrientFocus?: NutrientFocusKey; // closed union — only recognised nutrient tokens
}
```

---

### Bot Changes

#### 1. `packages/bot/src/lib/comparisonParser.ts` (new file)

**Purpose:** Pure parsing functions for comparison detection. No side effects, no I/O. Fully unit-testable in isolation.

**`COMPARISON_SEPARATORS`** — ordered array of case-insensitive separator tokens used by both the command parser and the NL pattern detector:

```
[ 'versus', 'contra', 'con', 'vs', 'o', 'y' ]
```

Separators are tried in order (longest first). Matching is performed on word boundaries (`\b`) in NL patterns and by last-index split in the command parser. For `'o'` and `'y'`, additionally require space-flanking (`/ o /i`, `/ y /i`) to avoid matching inside words. See Edge Cases.

**`parseDishExpression(text: string): { query: string; chainSlug?: string; portionMultiplier: number }`**

Parses a single dish half after the separator split. Applies the same two-step extraction used in `handleEstimar` / `handleNaturalLanguage`:

1. Call `parseCompararArgs(text)` — a local adaptation of `parseEstimarArgs` (replicates the `CHAIN_SLUG_REGEX` + last-`" en "` split logic) to extract `chainSlug`.
2. Call `extractPortionModifier(remainingQuery)` to extract `portionMultiplier` and `cleanQuery`.

Returns `{ query: cleanQuery, chainSlug?, portionMultiplier }`.

**`extractComparisonQuery(text: string): ParsedComparison | null`**

Detects NL comparison intent. Returns `ParsedComparison` if matched, `null` otherwise.

**Two-phase approach** (decoupled prefix + separator — addresses Gemini review finding):

**Phase 1 — Intent detection.** Match a prefix regex to identify comparison intent and optional `nutrientFocus`. The prefix regex captures the **remainder** after the prefix (everything after the comma or keyword). Prefix patterns (all case-insensitive, matched in order):

| Prefix regex | nutrientFocus extracted |
|---|---|
| `qué tiene más <nutrient>,? <remainder>` | `<nutrient>` |
| `qué tiene menos <nutrient>,? <remainder>` | `<nutrient>` |
| `qué engorda más,? <remainder>` | `"calorías"` |
| `qué es más sano,? <remainder>` | `null` |
| `compara[r]? <remainder>` | `null` |

**Phase 2 — Separator splitting.** Pass `<remainder>` to `splitByComparator(text)` which reuses the same `COMPARISON_SEPARATORS` array (`versus` → `contra` → `con` → `vs` → `o` → `y`). This ensures ALL separators work with ALL NL patterns (e.g., "compara big mac vs whopper" works, not just "compara big mac con whopper").

Recognised nutrient tokens for `<nutrient>` slot (maps to `nutrientFocus` string):

```
calorías → "calorías"
proteínas / proteinas → "proteínas"
grasas → "grasas"
hidratos / carbohidratos → "carbohidratos"
fibra → "fibra"
sodio → "sodio"
sal → "sal"
```

After separator splitting, `dishA` and `dishB` are trimmed. If either is empty, return `null` (not a valid comparison).

**`parseCompararArgs(args: string): { dishA: string; dishB: string } | null`**

Parses the raw args string from the `/comparar` command. Splits on the first occurrence of a recognised separator that appears as a word boundary. Returns `null` if no separator is found or if either side is empty after trimming.

Split strategy — iterate separators in descending length order (`versus` → `contra` → `vs` → `o`). For each separator, build a regex `new RegExp('\\b' + sep + '\\.?\\b', 'i')` (optional trailing dot to handle "vs.") and test the string. First separator that matches wins. The match position used is the first occurrence for `versus`/`contra`/`vs`, and the **last** occurrence for `o` (reduces false positives when "o" appears in dish names like "arroz con pollo o cerdo"). For `o`, additionally require it to be flanked by spaces (not just word boundaries) to avoid matching inside words.

---

#### 2. `packages/bot/src/lib/comparisonRunner.ts` (new file)

Shared async helper that both the `/comparar` command and the NL handler call. Eliminates logic duplication.

```
export async function runComparison(
  dishAText: string,
  dishBText: string,
  nutrientFocus: string | undefined,
  apiClient: ApiClient,
): Promise<string>
```

**Flow:**

1. Call `parseDishExpression(dishAText)` and `parseDishExpression(dishBText)`.
2. Issue two `apiClient.estimate()` calls via `Promise.allSettled()` — each call uses the existing internal 10s timeout already built into `ApiClient.estimate()` (no caller-supplied AbortController needed; the ApiClient contract is unchanged).
3. Map each settled result — **outcome matrix**:
   - `fulfilled` → use the `EstimateData` value directly, `errorNote = undefined`
   - `rejected` with `ApiError` where `code === 'TIMEOUT'` → build minimal `EstimateData` with `result: null`, `errorNote = 'timeout'`
   - `rejected` with `ApiError` (other) → build minimal `EstimateData` with `result: null`, `errorNote = 'error'`
   - `rejected` with unknown error (non-`ApiError`) → rethrow immediately
4. If **both** sides rejected with `ApiError` → return `handleApiError(errA)` (first error). Do NOT call `formatComparison`.
5. Otherwise call `formatComparison(dataA, dataB, nutrientFocus, { errorNoteA?, errorNoteB? })`.
6. Apply a length guard before return: if `result.length > 4000`, return a safe fallback message instead of truncating — naive `slice()` on MarkdownV2 can break open code blocks. In practice, comparison cards are ~600-1000 chars so this guard should never fire.

---

#### 3. `packages/bot/src/commands/comparar.ts` (new file)

Command handler. Signature mirrors `handleEstimar`:

```
export async function handleComparar(args: string, apiClient: ApiClient): Promise<string>
```

**Argument parsing flow:**

1. Trim args. If empty → return usage hint (see Edge Cases).
2. Call `parseCompararArgs(trimmed)`. If `null` → return "no separator found" error message.
3. Call `runComparison(dishA, dishB, undefined, apiClient)`.
4. Return the result string.

Error handling: `runComparison` handles `ApiError` internally. Unknown errors bubble up to `wrapHandler`.

---

#### 4. `packages/bot/src/handlers/naturalLanguage.ts` (modified)

Add comparison detection at the top of `handleNaturalLanguage`, after the length guard but before `extractPortionModifier`:

```
// Step 0 — Comparison detection (runs before single-dish path)
const comparison = extractComparisonQuery(trimmed);
if (comparison !== null) {
  return runComparison(comparison.dishA, comparison.dishB, comparison.nutrientFocus, apiClient);
}
// ... existing single-dish path unchanged ...
```

No local helper needed — `runComparison` from `comparisonRunner.ts` handles all comparison logic.

The MAX_NL_TEXT_LENGTH = 500 guard already fires before step 0, so no additional length check is needed.

---

#### 5. `packages/bot/src/formatters/comparisonFormatter.ts` (new file)

**Signature:**

```
export function formatComparison(
  dataA: EstimateData,
  dataB: EstimateData,
  nutrientFocus?: string,
): string
```

**Layout (MarkdownV2):**

```
*<nameA>* vs *<nameB>*

              <nameA_short>  <nameB_short>
🔥 Calorías   563 kcal ✅    672 kcal
🥩 Proteínas  26.5 g         25.0 g   ✅
🍞 Carbohidr  46.0 g         56.0 g
🧈 Grasas     26.0 g  ✅     35.0 g
[optional rows only if non-zero in either dish:]
🌾 Fibra       3.0 g  ✅      2.0 g
🫙 Grasas sat 10.0 g  ✅     14.0 g
🧂 Sodio      940 mg  ✅     860 mg

_Confianza: <confA> / <confB>_
```

Note: ✅ is placed **inside the winning column**, not at the end of the row. For calories/fats/saturatedFats/sodium/salt, lower wins. For proteins/fiber, higher wins.

**Formatting rules:**

- Column widths: fixed-width using monospace (wrap the nutrient table in a MarkdownV2 code block — triple backtick). This sidesteps MarkdownV2 special-char escaping inside code blocks and produces a clean table on all Telegram clients.
- Name row: `*<nameA>* vs *<nameB>*` above the code block using MarkdownV2 bold.
- Winner indicator: the `✅` emoji is placed after the column value of the **better** dish per nutrient row. "Better" rules: lower is better for calories/fats/saturatedFats/sodium/salt; higher is better for proteins/fiber. Carbohydrates and sugars have no winner indicator (nutritionally ambiguous) unless `nutrientFocus` targets them specifically — in that case, lower wins. If values are equal, no indicator is shown.
- `nutrientFocus`: when set, that nutrient row is rendered first and labelled `(foco)` — e.g. `🔥 Calorías (foco)`. The winner indicator is always shown for the focus nutrient even when values are equal (show `—` for a tie instead of `✅`).
- Column width for names: truncate each display name to 12 characters to maintain table alignment. Full name appears on the header bold row.
- Optional nutrient rows: shown only when the value is `> 0` in **either** dish result. If one dish has `fiber = 0` and the other has `fiber = 2.5`, the row is still shown (0 for the missing side).
- Confidence line: rendered outside the code block as italic MarkdownV2: `_Confianza: alta / media_`.
- Chain context: if both dishes have `result.chainSlug`, append below confidence: `_Cadena: <slugA> / <slugB>_`. If only one has a chain, append only that side.
- Portion multiplier: if either dish had `portionMultiplier !== 1.0`, append a line per dish showing the effective multiplier in the same format as `estimateFormatter.ts`.

**When one result is null (partial data):**

- Render the available dish's full nutrient card (using existing `formatEstimate`) as the top section.
- Append a separator line and a note: `_No se encontraron datos para "<nameX>"\._`

**When both results are null:**

- Return the standard "no data" message: `No se encontraron datos nutricionales para ninguno de los platos\.`

---

#### 6. `packages/bot/src/bot.ts` (modified)

- Import `handleComparar` from `./commands/comparar.js`.
- Register the `/comparar` command using the standard `onText` + `wrapHandler` pattern:

```
bot.onText(
  /^\/comparar(?:@\w+)?(?:\s+(.+))?$/s,
  (msg, match) => wrapHandler(() => handleComparar(match?.[1] ?? '', apiClient))(msg),
);
```

Note the `s` (dotAll) flag — consistent with `/receta` pattern, allows Shift+Enter newlines within the args.

- Add `'comparar'` to `KNOWN_COMMANDS` set.

---

#### 7. `packages/bot/src/apiClient.ts` (no changes)

No new method on `ApiClient`. The handler calls `apiClient.estimate()` twice. The existing internal `REQUEST_TIMEOUT_MS` (10s) in `createApiClient` applies per call — each call has its own `AbortController` already built in. No caller-supplied signal needed. If one times out, the other can still succeed via `Promise.allSettled`.

---

### Edge Cases & Error Handling

#### Command `/comparar` with no args
```
Uso: /comparar <plato_a> vs <plato_b> [en <cadena>]
Ejemplo: /comparar big mac vs whopper
Ejemplo: /comparar big mac en mcdonalds\-es vs whopper en burger\-king\-es
```

#### No separator found in args
```
No encontré dos platos para comparar\. Usa "vs", "o", "versus" o "contra" para separar los platos\.
Ejemplo: /comparar big mac vs whopper
```

#### Both API results are null
Return: `No se encontraron datos nutricionales para ninguno de los platos\.`

#### One API result is null
Render the available dish's full card (via `formatEstimate`), then append:
```
_No se encontraron datos para "<escaped_name>"\._
```
Log a `warn` with both queries and which side returned null.

#### One or both API calls throw `ApiError`
- If a non-timeout `ApiError` is thrown on one side: treat that side's `EstimateData` as if `result === null` and use the partial-data path above.
- If a `TIMEOUT` error is thrown on one side: use the partial-data path and note: `_Tiempo de espera agotado para "<escaped_name>"\._`
- If both calls throw: return `handleApiError(errA)` (first error, consistent with existing command error handling).
- Unknown errors (non-`ApiError`) are rethrown so `wrapHandler` in `bot.ts` logs them and sends the generic crash message.

#### "o" separator ambiguity in dish names
E.g. `/comparar arroz con leche o natillas`. The word "o" appears once and separates correctly. E.g. `/comparar pollo o cerdo vs ternera` — "vs" is tried before "o" (longer separator first), so "vs" wins and split is `"pollo o cerdo"` vs `"ternera"`. This is the correct behaviour.

E.g. `/comparar hamburguesa de queso o hamburguesa de bacon` — only "o" separator found. The rightmost word-boundary "o" occurrence is used as the split point. Result: `"hamburguesa de queso"` vs `"hamburguesa de bacon"`. If this is ambiguous, the user should use "vs" instead — document in usage hint.

#### NL "o" false detection
The NL patterns require a specific prefix (`qué tiene más`, `compara`, etc.) before the dish names, so bare "o" appearing in plain nutrition questions (e.g. "cuántas calorías tiene un bollo o pan") is not caught by the NL comparison patterns. The existing NL single-dish path handles such queries.

#### Both dishes resolve to the same entity
Valid scenario — show the same values in both columns with a note: `_Ambos platos corresponden al mismo resultado en la base de datos\._`

#### Telegram 4096-char message limit
Apply a length guard (not truncation) before returning from `runComparison`. If result exceeds 4000 chars, return a safe fallback error message. Naive `string.slice()` would break open MarkdownV2 code blocks, causing Telegram 400 errors. In practice, comparison cards are ~600-1000 chars so the guard should never fire.

#### NL text > 500 chars
The existing `MAX_NL_TEXT_LENGTH` guard in `handleNaturalLanguage` fires before the comparison detection step. No additional guard needed in `extractComparisonQuery`.

---

## Implementation Plan

### Existing Code to Reuse

- `packages/bot/src/apiClient.ts` — `ApiClient` interface (inject via DI, no changes), `ApiError` class (import for error classification in `comparisonRunner.ts`)
- `packages/bot/src/commands/errorMessages.ts` — `handleApiError(err)` (call from `comparisonRunner.ts` when both sides fail and from `comparar.ts` as the bubble-up fallback)
- `packages/bot/src/formatters/estimateFormatter.ts` — `formatEstimate(data)` (call from `comparisonFormatter.ts` for the partial-result path when one dish returns null)
- `packages/bot/src/lib/portionModifier.ts` — `extractPortionModifier(text)` (called inside `parseDishExpression` in `comparisonParser.ts`)
- `packages/bot/src/formatters/markdownUtils.ts` — `escapeMarkdown(text)` (used in `comparisonFormatter.ts` for the bold header line and error notes outside the code block; NOT used inside the code block)
- `packages/bot/src/logger.ts` — `logger` (warn-log in `comparisonRunner.ts` on partial-null result)
- `packages/bot/src/__tests__/commands.test.ts` — `makeMockClient()` and `ESTIMATE_DATA_WITH_RESULT`/`ESTIMATE_DATA_NULL` fixtures (copy pattern into new test files; do not import — test files are self-contained)

### Files to Create

| File | Purpose |
|---|---|
| `packages/bot/src/lib/comparisonParser.ts` | Pure parsing: exports `COMPARISON_SEPARATORS`, `parseDishExpression`, `extractComparisonQuery`, `parseCompararArgs`, `splitByComparator`. No I/O. Fully unit-testable. |
| `packages/bot/src/lib/comparisonRunner.ts` | Async helper: exports `runComparison`. Calls `parseDishExpression` on both halves, fires `Promise.allSettled`, maps results, delegates formatting to `formatComparison`, applies length guard. |
| `packages/bot/src/commands/comparar.ts` | `/comparar` command handler: exports `handleComparar(args, apiClient)`. Validates args, calls `parseCompararArgs`, delegates to `runComparison`. |
| `packages/bot/src/formatters/comparisonFormatter.ts` | Side-by-side MarkdownV2 card: exports `formatComparison(dataA, dataB, nutrientFocus?)`. Renders name bold header + code-block nutrient table + confidence/chain footer lines. |
| `packages/bot/src/__tests__/comparisonParser.test.ts` | Unit tests for all pure functions in `comparisonParser.ts` (~40 cases). |
| `packages/bot/src/__tests__/comparisonFormatter.test.ts` | Unit tests for `formatComparison` (~20 cases). |
| `packages/bot/src/__tests__/comparisonRunner.test.ts` | Unit tests for `runComparison` with mocked `apiClient` and mocked `formatComparison` (~15 cases). |
| `packages/bot/src/__tests__/comparar.test.ts` | Unit tests for `handleComparar` with mocked `apiClient` (~10 cases). |

### Files to Modify

| File | Changes |
|---|---|
| `packages/bot/src/handlers/naturalLanguage.ts` | Add comparison detection block immediately after the `MAX_NL_TEXT_LENGTH` guard and before `extractPortionModifier`. Import `extractComparisonQuery` from `../lib/comparisonParser.js` and `runComparison` from `../lib/comparisonRunner.js`. |
| `packages/bot/src/__tests__/naturalLanguage.test.ts` | Add a new `describe` block (~12 cases) testing NL comparison detection: patterns that trigger `extractComparisonQuery`, patterns that fall through to the single-dish path, and `estimate` call-count assertions. |
| `packages/bot/src/bot.ts` | Import `handleComparar` from `./commands/comparar.js`. Register `bot.onText(/^\/comparar(?:@\w+)?(?:\s+(.+))?$/s, ...)` using `wrapHandler` pattern. Add `'comparar'` to `KNOWN_COMMANDS`. |

### Implementation Order

Follow dependency order: parser (no deps) → formatter (depends on `EstimateData` type and `formatEstimate`) → runner (depends on parser + formatter) → command (depends on runner) → NL integration (depends on parser + runner) → bot registration (depends on command).

1. **Write failing tests for `comparisonParser.ts`** (`packages/bot/src/__tests__/comparisonParser.test.ts`)
   - `splitByComparator`: all six separator tokens, longest-match priority, returns `[dishA, dishB]` or `null` when no separator found
   - `parseCompararArgs`: `"big mac vs whopper"` → `{ dishA: "big mac", dishB: "whopper" }`; `"big mac"` (no sep) → `null`; `"hamburguesa de queso o hamburguesa de bacon"` uses last "o"; `"pollo o cerdo vs ternera"` uses "vs" (longer wins); `"vs."` with trailing dot; empty side after split → `null`; chain-slug args — `"big mac en mcdonalds-es vs whopper en burger-king-es"` splits on "vs" and leaves chain tokens in each half
   - `parseDishExpression`: plain dish name; dish + chain slug; dish + portion modifier; dish + chain + modifier; only-modifier (modifier stripped leaving nothing → `portionMultiplier: 1.0`, `query` = trimmed input); chain slug detection inherits `CHAIN_SLUG_REGEX` logic from `estimar.ts`
   - `extractComparisonQuery`: all five NL prefix patterns; each with all separator tokens (cross-product of 5 patterns × 6 separators = 30+ cases can be reduced by representative sampling — cover at least 2 separators per pattern); nutrientFocus correctly extracted for each nutrient token; empty dish side after split → `null`; no prefix match → `null`; NL text > 500 chars is not a concern here (guard fires earlier)

2. **Implement `comparisonParser.ts`** — make all tests pass.
   - Define `COMPARISON_SEPARATORS = ['versus', 'contra', 'con', 'vs', 'o', 'y']` (longest first, determines priority)
   - `splitByComparator(text)`: iterate `COMPARISON_SEPARATORS`. For `'o'` and `'y'`, build regex `/ o /i` or `/ y /i` (space-flanked to avoid matching inside words). For others, use `new RegExp('\\b' + sep + '\\.?\\b', 'i')`. First match (longest separator) wins. Split position: first match index for `versus/contra/con/vs`, last match for `'o'` and `'y'`. Return `[left.trim(), right.trim()]` or `null` if no match or either side empty.
   - `parseCompararArgs(args)`: delegate to `splitByComparator(args)`. If result is `null`, return `null`. Otherwise, return `{ dishA: result[0], dishB: result[1] }`. (DRY — no duplicated separator logic.)
   - `parseDishExpression(text)`: copy `CHAIN_SLUG_REGEX` verbatim. Apply last-`" en "` split logic (same as `naturalLanguage.ts` — do NOT import from `estimar.ts`, copy as documented in ticket Notes). Then call `extractPortionModifier(remainingQuery)`. Return `{ query: cleanQuery, chainSlug?, portionMultiplier }`.
   - `extractComparisonQuery(text)`: five prefix patterns in order. Each pattern captures the remainder after prefix as a named or indexed capture group. Pass remainder to `splitByComparator`. If result is null or either side empty, return `null`. Map nutrient token to `nutrientFocus` string using the mapping table in the spec. Return `{ dishA, dishB, nutrientFocus? }`.
   - Export the `ParsedComparison` interface.

3. **Write failing tests for `comparisonFormatter.ts`** (`packages/bot/src/__tests__/comparisonFormatter.test.ts`)
   - Both results non-null: output contains bold `*nameA* vs *nameB*` header; output contains triple-backtick code block; calories row visible in code block with raw numbers (no backslash escaping); ✅ on the winning side of calories (lower); ✅ on the winning side of proteins (higher); no ✅ when values equal; optional rows (fiber, saturatedFats, sodium, salt) shown only when `> 0` in either dish; confidence line as italic `_Confianza: X / Y_`; chain line when both results have `chainSlug`; chain line single-side when only one has chain
   - `nutrientFocus` set: focus nutrient row rendered first; `(foco)` label appended; tie shows `—` for focus nutrient
   - One result null: `formatEstimate` card present; `_No se encontraron datos para "..."._` note appended
   - Both results null: "no encontraron datos nutricionales para ninguno" message
   - MarkdownV2 correctness: verify no bare `.` or `-` or `(` outside the code block (must be escaped with backslash); verify numbers inside code block do NOT have backslash before `.` (i.e., `26.5` not `26\.5`)
   - Portion modifier line: `portionMultiplier !== 1.0` on either side → multiplier line appended per dish
   - Name truncation: names > 12 chars are truncated to 12 in the code block columns; full name still in bold header

4. **Implement `comparisonFormatter.ts`** — make all tests pass.
   - Import `EstimateData` from `@foodxplorer/shared`; import `formatEstimate` from `./estimateFormatter.js`; import `escapeMarkdown` from `./markdownUtils.js`
   - `CONFIDENCE_MAP` — copy from `estimateFormatter.ts`
   - `PORTION_LABEL_MAP` — copy from `estimateFormatter.ts`
   - Build the output in three parts: (1) bold header line — apply `escapeMarkdown` ONLY to the dynamic display name values, NOT to the MarkdownV2 formatting chars (`*`, `_`); (2) nutrient table as a triple-backtick code block using raw `toFixed(1)` for values, `String.padStart`/`padEnd` for column alignment (name col 14 chars, value col 12 chars including unit and `✅`/`  ` indicator); (3) footer lines (confidence, chain, portion multiplier) outside the code block — apply `escapeMarkdown` ONLY to dynamic values (chain slugs, display names), NOT to the formatting delimiters (`_..._` for italics)
   - **Nutrient focus mapping (ES→EN)**: define `NUTRIENT_FOCUS_MAP: Record<string, string> = { 'calorías': 'calories', 'proteínas': 'proteins', 'grasas': 'fats', 'carbohidratos': 'carbohydrates', 'fibra': 'fiber', 'sodio': 'sodium', 'sal': 'salt' }`. Use this to convert the Spanish `nutrientFocus` string to the English `EstimateNutrients` key before applying winner/reorder logic.
   - Winner logic: define `lowerIsBetter = new Set(['calories', 'fats', 'saturatedFats', 'sodium', 'salt'])` and `higherIsBetter = new Set(['proteins', 'fiber'])`. Carbohydrates/sugars: no winner unless `nutrientFocus` matches, in which case lower wins
   - Optional rows: iterate `['fiber', 'saturatedFats', 'sodium', 'salt']`, include row when `valA > 0 || valB > 0`
   - Partial-data (one null): call `formatEstimate(available)` and append the escaped note. Log a `warn`.
   - Both null: return the static error string (MarkdownV2 pre-escaped, same style as other error messages)
   - No length guard here — the guard lives in `comparisonRunner.ts` (single responsibility)

5. **Write failing tests for `comparisonRunner.ts`** (`packages/bot/src/__tests__/comparisonRunner.test.ts`)
   - Both estimates resolve: `estimate` called twice via `Promise.allSettled`; `formatComparison` called with both `EstimateData` and `nutrientFocus`; return value equals `formatComparison` output
   - One estimate rejects with `ApiError` (non-timeout): partial path — `formatComparison` still called; the null-result side is `EstimateData` with `result: null`
   - One estimate rejects with `ApiError` code `TIMEOUT`: same partial path; `formatComparison` still called
   - Both estimates reject: `handleApiError` called with the first error; return value is the error message string
   - Unknown error (non-`ApiError`) on one side: rethrown (not caught)
   - Length guard: when `formatComparison` returns a string > 4000 chars, `runComparison` returns the safe fallback message
   - `parseDishExpression` called on both dish text arguments: verify via spy or by checking the `estimate` calls receive the parsed query/chainSlug/portionMultiplier

6. **Implement `comparisonRunner.ts`** — make all tests pass.
   - Import `parseDishExpression` from `./comparisonParser.js`; `formatComparison` from `../formatters/comparisonFormatter.js`; `handleApiError` from `../commands/errorMessages.js`; `ApiError` from `../apiClient.js`; `logger` from `../logger.js`; `ApiClient`, `EstimateData` types
   - `runComparison(dishAText, dishBText, nutrientFocus, apiClient)`:
     1. Call `parseDishExpression` on each text
     2. Build `estimateParams` for each (include `chainSlug` and `portionMultiplier` only when non-default)
     3. `Promise.allSettled([apiClient.estimate(paramsA), apiClient.estimate(paramsB)])`
     4. Map each settled result: `fulfilled` → its `value`; `rejected` with `ApiError` → `{ ...minimalEstimateData, result: null }` (construct a minimal `EstimateData` object with `result: null`, using the query string from `parseDishExpression` as `query`, `portionMultiplier: 1.0`, all hit flags `false`, `matchType: null`, `chainSlug: null`, `cachedAt: null`); `rejected` with unknown error → rethrow
     5. If both mapped results ended up as `ApiError` rejections: call `handleApiError(errA)` and return the error string
     6. Call `formatComparison(dataA, dataB, nutrientFocus)`
     7. Apply length guard: if `result.length > 4000` return safe fallback message

7. **Write failing tests for `handleComparar`** (`packages/bot/src/__tests__/comparar.test.ts`)
   - Empty args → usage hint string, `runComparison` not called
   - Whitespace-only args → usage hint string, `runComparison` not called
   - Args with no recognised separator → "no encontré dos platos" error string, `runComparison` not called
   - Happy path `"big mac vs whopper"` → `runComparison` called with `("big mac", "whopper", undefined, apiClient)`; return value propagated
   - `runComparison` returning an error string → string propagated unchanged
   - Unknown error from `runComparison` → rethrown (wrapHandler in `bot.ts` handles it)

8. **Implement `comparar.ts`** — make all tests pass.
   - Import `parseCompararArgs` from `../lib/comparisonParser.js` and `runComparison` from `../lib/comparisonRunner.js`
   - `handleComparar(args, apiClient)`:
     1. Trim. If empty → return usage hint (exact strings from the Edge Cases section, pre-escaped for MarkdownV2)
     2. Call `parseCompararArgs(trimmed)`. If `null` → return "no separator found" error message (pre-escaped)
     3. Return `runComparison(dishA, dishB, undefined, apiClient)` — `nutrientFocus` is always `undefined` for the slash command (only the NL handler provides it)

9. **Write failing tests for NL comparison detection** (add a new `describe` block in `packages/bot/src/__tests__/naturalLanguage.test.ts`)
   - `"¿qué tiene más calorías, un big mac o un whopper?"` → `estimate` called twice (not once); result contains output from comparison (check for presence of both dish names or a comparison-specific string)
   - `"compara big mac con whopper"` → comparison detected; `estimate` called twice
   - `"qué engorda más, una pizza o una hamburguesa"` → comparison detected with `nutrientFocus: "calorías"`; `estimate` called twice
   - `"compara big mac vs whopper"` → comparison detected (separator `vs` also works in NL)
   - `"¿qué tiene menos grasas, una pizza o una hamburguesa?"` → `nutrientFocus: "grasas"`
   - `"big mac vs whopper"` (no prefix) → falls through to single-dish path; `estimate` called once
   - `"qué es más sano, una ensalada o un bollo"` → comparison detected, no `nutrientFocus`
   - Comparison detected: `estimate` NOT called via the single-dish path (total call count = 2, not 3)
   - One estimate returns null result: result contains the partial-data text (no crash)
   - Comparison detection runs before `extractPortionModifier`: NL comparison is triggered even when portionModifier words appear in the text (e.g. `"qué tiene más calorías, una big mac grande o un whopper"`)
   - `MAX_NL_TEXT_LENGTH` guard still fires before comparison detection (text > 500 → `estimate` not called even for comparison text)

10. **Modify `naturalLanguage.ts`** — add comparison detection step.
    - Add imports at the top: `import { extractComparisonQuery } from '../lib/comparisonParser.js'` and `import { runComparison } from '../lib/comparisonRunner.js'`
    - After the `if (trimmed.length > MAX_NL_TEXT_LENGTH)` guard and before `extractPortionModifier`, insert:
      ```
      const comparison = extractComparisonQuery(trimmed);
      if (comparison !== null) {
        return runComparison(comparison.dishA, comparison.dishB, comparison.nutrientFocus, apiClient);
      }
      ```
    - The rest of the function is unchanged.

11. **Register `/comparar` in `bot.ts`**
    - Add import: `import { handleComparar } from './commands/comparar.js'`
    - Add `'comparar'` to the `KNOWN_COMMANDS` set
    - Register handler after the `/receta` registration:
      ```
      bot.onText(
        /^\/comparar(?:@\w+)?(?:\s+(.+))?$/s,
        (msg, match) => wrapHandler(() => handleComparar(match?.[1] ?? '', apiClient))(msg),
      );
      ```
      Note: use the `s` (dotAll) flag to allow Shift+Enter newlines in args, consistent with `/receta`.

12. **Run full test suite and build**
    - `npm run -w @foodxplorer/bot test` — all tests must pass
    - `npm run -w @foodxplorer/bot build` — TypeScript compilation must succeed with no errors
    - `npm run -w @foodxplorer/bot lint` — no linting errors

### Testing Strategy

**Test files to create:**

- `packages/bot/src/__tests__/comparisonParser.test.ts` (~40 test cases)
- `packages/bot/src/__tests__/comparisonFormatter.test.ts` (~20 test cases)
- `packages/bot/src/__tests__/comparisonRunner.test.ts` (~15 test cases)
- `packages/bot/src/__tests__/comparar.test.ts` (~10 test cases)

**Test files to modify:**

- `packages/bot/src/__tests__/naturalLanguage.test.ts` — add 1 new `describe` block with ~12 cases

**Mocking strategy:**

- `comparisonParser.test.ts` — no mocks (pure functions only)
- `comparisonFormatter.test.ts` — no mocks; use `ESTIMATE_DATA_WITH_RESULT` and `ESTIMATE_DATA_NULL` fixtures copied from `formatters.test.ts` and `commands.test.ts`. Test against the actual `formatComparison` output string.
- `comparisonRunner.test.ts` — mock `apiClient` via `makeMockClient()` (same pattern as `commands.test.ts`). Optionally spy on `formatComparison` to isolate runner logic from formatter output, or assert on the string by checking for known substrings.
- `comparar.test.ts` — mock `apiClient` + mock `runComparison` via `vi.mock('../lib/comparisonRunner.js')` to isolate the command handler. Alternatively, mock `apiClient` and let `runComparison` run with real parser but mock `apiClient.estimate`.
- `naturalLanguage.test.ts` additions — mock `apiClient` (same `makeMockClient` already in file). Mock `apiClient.estimate` to return `ESTIMATE_DATA_WITH_RESULT` for two calls.

**Key test scenarios by file:**

`comparisonParser.test.ts`:
- Separator priority: `"pollo o cerdo vs ternera"` → split on "vs" (longer wins), yielding `"pollo o cerdo"` and `"ternera"`
- Last-"o" strategy: `"hamburguesa de queso o hamburguesa de bacon"` → `dishA = "hamburguesa de queso"`, `dishB = "hamburguesa de bacon"`
- `parseCompararArgs` returns `null` for no separator
- `parseDishExpression` correctly propagates `chainSlug` and `portionMultiplier` from text like `"big mac grande en mcdonalds-es"`
- `extractComparisonQuery`: all five NL prefixes each with at least two separator variants; `nutrientFocus` mapping for each supported token; returns `null` for bare "big mac o whopper" (no prefix); returns `null` when only one dish side after split

`comparisonFormatter.test.ts`:
- Numbers inside code block are NOT escaped: `26.5` not `26\.5`
- Bold header outside code block IS escaped: dots and hyphens in names become `\.` and `\-`
- ✅ on the correct column (lower calories wins, higher proteins wins)
- Optional rows (fiber, saturatedFats, sodium, salt): present when either dish has `> 0`, absent when both are `0`
- Partial-data path: single dish card + note line
- Both-null path: static error message

`comparisonRunner.test.ts`:
- `Promise.allSettled` semantics: one rejection does not prevent the other call from completing
- Timeout `ApiError` on one side → partial path (not a full crash)
- Unknown error (non-`ApiError`) rethrown

### Key Patterns

1. **`CHAIN_SLUG_REGEX` duplication (intentional)** — Copy the regex verbatim into `comparisonParser.ts` rather than importing from `estimar.ts` or `naturalLanguage.ts`. This is the established F028 pattern: private implementation detail, not a public API. See the ticket Notes section and the comment at line 24 of `naturalLanguage.ts`.

2. **No MarkdownV2 escaping inside code blocks** — The comparison formatter renders its nutrient table inside triple backticks. Values inside code blocks must use raw numbers: `String(value)` or `value.toFixed(1)`. Do NOT call `formatNutrient()` or `escapeMarkdown()` on values that go inside the code block. See ticket Notes. This is different from `estimateFormatter.ts` which renders outside code blocks and uses `formatNutrient()`.

3. **`Promise.allSettled` instead of `Promise.all`** — Use `allSettled` so one API failure does not cancel the other call. Map each settled result before deciding the final output.

4. **`wrapHandler` usage for `/comparar`** — Unlike `/restaurante` and `/receta`, the `/comparar` command does not need `chatId`, `bot`, or `redis`. Use the standard `wrapHandler(() => handleComparar(...))` pattern identical to `/estimar` (see `bot.ts` line 76–79).

5. **Dotall flag `s` on `/comparar` regex** — The regex must include the `s` flag to allow multi-line input via Shift+Enter. Consistent with `/receta` (bot.ts line 117). The `/estimar` and `/buscar` patterns do NOT use `s` — do not use them as the reference.

6. **Test fixture self-containment** — Each test file defines its own `makeMockClient()` and `EstimateData` fixtures. Do not cross-import from other test files. The existing test files follow this pattern without exception.

7. **Pre-escaped static strings** — Usage hints and error messages returned by `handleComparar` must be pre-escaped for MarkdownV2 (backslash before `<`, `>`, `-`, `(`, `)`, `.`, etc.). See the exact strings in the Edge Cases section of the spec. Use the same style as the usage hint in `handleEstimar` (line 51 of `estimar.ts`).

8. **`portionMultiplier` omitted when `1.0`** — When building the `estimate` params inside `runComparison`, only include `portionMultiplier` in the params object when `parseDishExpression` returns a value `!== 1.0`. This mirrors the pattern in `handleEstimar` (line 59) and `handleNaturalLanguage` (line 125). Tests in `comparar.test.ts` should verify this with `Object.prototype.hasOwnProperty.call(args, 'portionMultiplier')`.

9. **Logger import** — Use `import { logger } from '../logger.js'` in `comparisonRunner.ts`. The warn call on partial-null: `logger.warn({ dishAText, dishBText, nullSide: 'A' | 'B' | 'both' }, 'comparison partial result')`.

10. **`ApiError` handling — distinguish timeouts** — When an `ApiError` is caught, map the result to a minimal `EstimateData` with `result: null`. Pass an optional `errorNote` to the formatter: for `TIMEOUT` errors, use `_Tiempo de espera agotado para "..."._`; for other `ApiError`, use `_No se encontraron datos para "..."._`. The runner passes error notes as an optional second argument to `formatComparison`: `formatComparison(dataA, dataB, nutrientFocus, { errorNoteA?, errorNoteB? })`.

---

## Acceptance Criteria

- [x] `/comparar big mac vs whopper` returns a comparison card with nutrients for both dishes
- [x] `/comparar big mac en mcdonalds-es vs whopper en burger-king-es` scopes each estimate to the correct chain
- [x] `/comparar big mac grande vs whopper` applies `portionMultiplier: 1.5` to the big mac side only
- [x] "¿qué tiene más calorías, un big mac o un whopper?" (NL) triggers comparison with `nutrientFocus: "calorías"`
- [x] "compara un big mac con un whopper" (NL) triggers comparison with no nutrient focus
- [x] "¿qué engorda más, una pizza o una hamburguesa?" (NL) triggers comparison with `nutrientFocus: "calorías"`
- [x] `/comparar big mac` (no separator) returns usage error message
- [x] `/comparar` (no args) returns usage hint
- [x] When one dish returns null, available dish card shown + "no data" note
- [x] When both dishes return null, standard no-data message shown
- [x] Nutrient table rendered inside code block for alignment (header/footer outside)
- [x] Winner ✅ indicator shown on better column per nutrient
- [x] `'comparar'` in `KNOWN_COMMANDS`
- [x] Pure parser/formatter functions have unit tests (no mocks needed) — 43 parser + 23 formatter
- [x] `runComparison` and command handler have unit tests with mocked `apiClient` — 10 runner + 7 command
- [x] All tests pass — 811/811
- [x] Build succeeds — 0 TS errors
- [x] No linting errors — 0 new errors

---

## Definition of Done

- [x] All acceptance criteria met — 18/18
- [x] Unit tests written and passing — 176 tests (96 dev + 80 QA), 893 total
- [x] Code follows project standards
- [x] No linting errors — 0 new
- [x] Build succeeds — clean

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` executed, plan approved
- [x] Step 3: TDD implementation — 12 steps, 94 new tests
- [x] Step 4: `production-code-validator` executed — READY FOR PRODUCTION
- [x] Step 5: `code-review-specialist` executed — APPROVE, 1 fix applied
- [x] Step 5: `qa-engineer` executed — 80 edge-case tests, 3 bugs found and fixed
- [x] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-28 | Spec drafted | spec-creator agent |
| 2026-03-28 | Spec self-review | 5 fixes: typo, winner rules, shared runner, truncation, separators |
| 2026-03-28 | Spec reviewed by Gemini | 1C+3I+1S, all addressed |
| 2026-03-28 | Spec reviewed by Codex GPT-5.4 | 3I+3S, all covered by Gemini fixes + additional refinements |
| 2026-03-28 | Setup | Branch + ticket + tracker |
| 2026-03-28 | Plan drafted | backend-planner agent, 12 steps, ~95 tests |
| 2026-03-28 | Plan self-review | 3 fixes: npm vs pnpm, timeout simplification, DRY check |
| 2026-03-28 | Plan reviewed by Gemini | 2C+2I+2S, all addressed |
| 2026-03-28 | Plan reviewed by Codex GPT-5.4 | 3I+3S (spec+plan combined). 1 new fix (outcome matrix), 2 already addressed (truncation, nutrient mapping), 1 fix (AbortController clarification). ACs refined |
| 2026-03-28 | Implementation | 12 TDD steps completed: 8 files created, 3 modified. 94 new tests (811 total). Build + lint clean |
| 2026-03-28 | production-code-validator | READY FOR PRODUCTION — 0 issues |
| 2026-03-28 | code-review-specialist | APPROVE with 1 fix: "con" separator priority. 2 suggestions (CHAIN_SLUG_REGEX DRY, length guard test). Fix applied |
| 2026-03-28 | qa-engineer | 80 edge-case tests, 16 initially failing → 3 bugs found (leading ¿, same-entity note, con in NL). All fixed, 893 tests passing |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Plan, AC, DoD, Workflow, Log, Evidence |
| 1. Mark all items | [x] | AC: 18/18, DoD: 5/5, Workflow: 0-5/6 |
| 2. Verify product tracker | [x] | Active Session: step 5/6, Features table: 5/6 |
| 3. Update key_facts.md | [x] | N/A — bot-only, no new endpoints/schemas |
| 4. Update decisions.md | [x] | N/A — no ADR required |
| 5. Commit documentation | [x] | Commit: ffeae5e |
| 6. Verify clean working tree | [x] | `git status`: clean (only untracked landing audit file) |

---

## Notes

- `CHAIN_SLUG_REGEX` is copied verbatim into `comparisonParser.ts` (not imported from `estimar.ts`) — consistent with the pattern established in `naturalLanguage.ts` (F028 decision).
- The comparison formatter renders its nutrient table inside a triple-backtick code block. **CRITICAL: MarkdownV2 escaping (backslash-dot, backslash-hyphen, etc.) MUST NOT be applied to values inside the code block** — backslashes render literally inside code blocks, producing "26\.5" instead of "26.5". Use raw `String(value)` / `toFixed(1)` inside the code block, NOT `formatNutrient` or `escapeMarkdown` from `markdownUtils.ts`.
- For alignment inside the code block, pad all numeric columns to a fixed width using `String.padStart` / `String.padEnd`. Column widths: name column 14 chars, value column 12 chars.
- `parseDishExpression` is in `comparisonParser.ts`, NOT in `estimar.ts`, to avoid circular imports between command handlers.
- Phase 1 scope: the "all-nutrient" comparison (no `nutrientFocus`) always shows the winner per every displayed nutrient row. A future phase could add an LLM-generated "overall healthier" verdict — explicitly out of scope for F043.

