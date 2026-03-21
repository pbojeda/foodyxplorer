# F028: Telegram Bot — Natural Language Handler

**Feature:** F028 | **Type:** Backend-Feature | **Priority:** High
**Status:** Draft | **Branch:** — (pending Step 1)
**Created:** 2026-03-21 | **Dependencies:** F027 (Telegram Bot — Command Handler)

---

## Spec

### Description

F028 adds a **natural language (NL) handler** to the `packages/bot` Telegram bot so that users
can type conversational Spanish text — without a leading `/` — and receive a nutritional estimate
formatted identically to `/estimar`.

When the user types something like "calorías de un big mac" or "qué lleva un whopper", the bot
now parses the message, extracts a food query (and optional chain slug), calls
`apiClient.estimate()`, and responds with the standard `formatEstimate()` card. The command flow
is unchanged — all eight slash commands from F027 continue to work exactly as before.

This feature is **purely additive** with respect to F027. No existing behaviour is modified.
No new external dependencies are introduced. No API endpoints change. No shared Zod schemas
change. The parsing is **heuristic-only** (regex + word-stripping) — no external NLP or LLM
is involved.

### Architecture Decisions

1. **Single new file `packages/bot/src/handlers/naturalLanguage.ts`** — keeps the NL handler
   self-contained and separate from the slash-command convention in `commands/`. The `handlers/`
   subdirectory signals that this module responds to a Telegram message event rather than an
   `onText` command pattern.

2. **`bot.ts` updated — `'message'` event handler extended.** The existing `bot.on('message', ...)`
   handler already catches all non-slash messages and does nothing with them. F028 replaces the
   early-return path for non-command messages with a call to
   `handleNaturalLanguage(text, apiClient)`. The slash-command unknown-command branch is untouched.

3. **NL handler reuses all existing infrastructure.** `apiClient.estimate()`, `formatEstimate()`,
   `handleApiError()`, `escapeMarkdown()`, and `wrapHandler()` are imported and used without
   modification. No duplication.

4. **Stateless per message.** No session state, no conversation history. Each plain-text message
   is processed independently. This is consistent with F027's no-session design (Architecture
   Decision from F027).

5. **Message guard in `bot.ts`.** Before calling the NL handler, `bot.ts` guards:
   - message has `text` (skip media — photos, stickers, documents, voice, etc.)
   - text does not start with `/` (skip commands — handled by `onText` above)
   - text is not empty after trim (skip empty/whitespace messages)

   These guards live in `bot.ts`, not in the handler itself, keeping the handler pure and
   testable in isolation.

6. **Query extraction is a pure exported function `extractFoodQuery`.** It receives the raw text
   and returns `{ query: string; chainSlug?: string }`. Being pure makes it trivially unit-testable
   with zero dependencies. If the extractor cannot derive a meaningful query (e.g. text is only
   stopwords or too long), it returns `{ query: text.trim() }` as a safe fallback — the API
   decides whether data exists.

7. **Very long messages are rejected before extraction.** If the trimmed text exceeds 500 characters,
   the handler returns a prompt asking the user to be more specific. This prevents
   regex-catastrophic-backtracking scenarios already identified in F027's edge-case tests and
   avoids sending absurd queries to the API.

8. **No `onText` for NL.** Using `onText` with a catch-all regex alongside specific command
   patterns causes double-fire (two replies). The existing `bot.on('message', ...)` event pattern
   (chosen deliberately in F027 for the unknown-command case) is the correct hook for NL — one
   handler, one reply.

9. **Bot test count grows by ~25 tests.** The new `handlers/naturalLanguage.ts` module requires
   its own test file `__tests__/naturalLanguage.test.ts`. The `bot.test.ts` count grows by tests
   for the updated `'message'` event dispatch.

### File Structure Changes

```
packages/bot/src/
├── handlers/
│   └── naturalLanguage.ts        NEW — extractFoodQuery() + handleNaturalLanguage()
├── bot.ts                        MODIFIED — 'message' handler extended to call NL handler
└── __tests__/
    └── naturalLanguage.test.ts   NEW — unit tests for extractFoodQuery + handleNaturalLanguage
```

All other files in `packages/bot/src/` are **unchanged**.

### Natural Language Parsing Specification

The parsing is performed by `extractFoodQuery(text: string): { query: string; chainSlug?: string }`.

#### Step 1 — Chain slug extraction (identical to `estimar.ts`)

Reuse the exact same logic as `parseEstimarArgs` in `commands/estimar.ts`:
- Search for the LAST occurrence of ` en ` in the text
- If found, test the suffix against `CHAIN_SLUG_REGEX = /^[a-z0-9-]+-[a-z0-9-]+$/`
- If the suffix matches, split: `chainSlug = suffix`, `remainder = text before separator`
- If no match or no ` en `, the entire text is the remainder

This handles inputs like:
- `"big mac en mcdonalds-es"` → `{ query: "big mac", chainSlug: "mcdonalds-es" }`
- `"big mac en burger king"` → `{ query: "big mac en burger king" }` (no hyphen in suffix)
- `"calorías de una big mac en mcdonalds-es"` → proceeds to Step 2 on remainder `"calorías de una big mac"`

#### Step 2 — Stopword stripping from the remainder

Strip recognised **Spanish interrogative and contextual prefixes/infixes** from the `remainder`
produced by Step 1. These are applied in sequence (order matters — longest match first to avoid
partial stripping).

**Prefix patterns** (strip from the start of the string, case-insensitive):

| Pattern (regex) | Example input | Remainder after strip |
|---|---|---|
| `^cuántas?\s+calorías?\s+tiene[n]?\s+` | "cuántas calorías tiene un" | "un" |
| `^cuántas?\s+calorías?\s+hay\s+en\s+` | "cuántas calorías hay en un" | "un" |
| `^cuántas?\s+calorías?\s+` | "cuántas calorías de una" | "de una" |
| `^qué\s+(?:lleva|contiene|tiene)\s+` | "qué lleva un whopper" | "un whopper" |
| `^(?:dame|dime)\s+(?:la[s]?\s+)?(?:información|info|calorías?)\s+(?:de[l]?\s+)` | "dame las calorías del big mac" | "big mac" |
| `^(?:información|info)\s+(?:de[l]?\s+)?(?:nutricional\s+)?(?:de[l]?\s+)?` | "información nutricional del big mac" | "big mac" |
| `^calorías?\s+de[l]?\s+(?:un[ao]?\s+)?` | "calorías de una big mac" | "big mac" |
| `^calorías?\s+` | "calorías big mac" | "big mac" |
| `^(?:busca[r]?\s+)?(?:la[s]?\s+)?calorías?\s+(?:de[l]?\s+)?(?:un[ao]?\s+)?` | "buscar las calorías de un big mac" | "big mac" |

**Article/determiner stripping** (strip leading articles after prefix stripping):

After all prefix patterns are tried, strip any leading Spanish article or determiner:
- Pattern: `^(?:un[ao]?|el|la[s]?|los|del|al)\s+` (case-insensitive, applied once)

**Result**: the stripped `remainder` becomes the `query`.

#### Step 3 — Fallback

If after all stripping the query is empty or whitespace, use the **original trimmed text**
(before any stripping) as the query. This prevents the pathological case of stripping producing
an empty string, which would be useless to send to the API.

#### Full Parsing Examples

| User input | `chainSlug` | `query` sent to API |
|---|---|---|
| `"big mac"` | — | `"big mac"` |
| `"Big Mac"` | — | `"Big Mac"` |
| `"calorías de un big mac"` | — | `"big mac"` |
| `"calorías de una hamburguesa"` | — | `"hamburguesa"` |
| `"cuántas calorías tiene una hamburguesa"` | — | `"hamburguesa"` |
| `"cuántas calorías hay en un big mac"` | — | `"big mac"` |
| `"qué lleva un whopper"` | — | `"whopper"` |
| `"qué contiene el mcpollo"` | — | `"mcpollo"` |
| `"información nutricional del big mac"` | — | `"big mac"` |
| `"dame las calorías del big mac"` | — | `"big mac"` |
| `"big mac en mcdonalds-es"` | `"mcdonalds-es"` | `"big mac"` |
| `"calorías de un big mac en mcdonalds-es"` | `"mcdonalds-es"` | `"big mac"` |
| `"pollo en salsa"` | — | `"pollo en salsa"` |
| `"pollo en salsa en mcdonalds-es"` | `"mcdonalds-es"` | `"pollo en salsa"` |
| `"hola"` (unrecognised text, no stripping) | — | `"hola"` |
| `"🍔"` | — | `"🍔"` |

#### What is NOT parsed

The handler makes **no attempt** to interpret:
- Questions without recognisable food names (e.g. "hola", "cómo estás") — passed as-is to API,
  which returns null result → "No se encontraron datos nutricionales…"
- Multi-dish queries ("big mac y nuggets") — passed as-is; API matches best single result
- Quantity modifiers ("2 big macs") — passed as-is; API ignores quantity
- Brand names without chain scope ("mcdonalds big mac" without ` en `) — passed as-is

### Handler Logic

```typescript
// packages/bot/src/handlers/naturalLanguage.ts

export const MAX_NL_TEXT_LENGTH = 500;

export function extractFoodQuery(text: string): { query: string; chainSlug?: string } { ... }

export async function handleNaturalLanguage(
  text: string,
  apiClient: ApiClient,
): Promise<string> { ... }
```

`handleNaturalLanguage` flow:
1. Trim text. If length > `MAX_NL_TEXT_LENGTH` → return Spanish prompt to be more specific.
2. Call `extractFoodQuery(text)` → `{ query, chainSlug? }`
3. Call `apiClient.estimate({ query, chainSlug })`
4. Return `formatEstimate(data)`
5. On `ApiError` → return `handleApiError(err)` (with `logger.warn`)

### Updated `bot.ts` — `'message'` Event Handler

The existing `bot.on('message', ...)` block is extended:

```
Before F028:
  'message' event
    → if text starts with '/' and command is unknown → "Comando no reconocido"
    → else → do nothing (plain text silently ignored)

After F028:
  'message' event
    → if text starts with '/' and command is unknown → "Comando no reconocido"
    → else if text is non-empty and does not start with '/' → call wrapHandler(NL handler)
    → else (no text — media, sticker, etc.) → do nothing
```

Implementation inside `bot.on('message', ...)`:

```typescript
bot.on('message', (msg) => {
  const text = msg.text ?? '';
  const cmdMatch = /^\/(\w+)/.exec(text);

  if (cmdMatch) {
    // Unknown slash command
    const cmd = cmdMatch[1] ?? '';
    if (!KNOWN_COMMANDS.has(cmd)) {
      void send(msg.chat.id, escapeMarkdown('Comando no reconocido. Usa /help para ver los comandos disponibles.'));
    }
    return;
  }

  // Plain text (no slash prefix) — route to NL handler
  const trimmed = text.trim();
  if (trimmed) {
    void wrapHandler(() => handleNaturalLanguage(trimmed, apiClient))(msg);
  }
  // Empty text or media (no msg.text) → silently ignore
});
```

### API Changes

**None.** F028 reuses `GET /estimate` (via `apiClient.estimate()`) which was established in F020
and consumed by F027. The `api-spec.yaml` is not modified.

### Data Model Changes

**None.** No DB migrations, no new Prisma models, no new Zod schemas in `packages/shared`.

### New Dependencies

**None.** All parsing is done with native TypeScript string operations and `RegExp`. No new
npm packages are required.

### User-Facing Strings (Spanish, MarkdownV2-safe)

| Scenario | Message |
|---|---|
| Text > 500 chars | `'Por favor, sé más específico\. Escribe el nombre del plato directamente, por ejemplo: _big mac_'` |
| `result === null` (no data) | Delegated to `formatEstimate()` → `'No se encontraron datos nutricionales para esta consulta\.'` |
| API errors | Delegated to `handleApiError()` (existing Spanish messages) |
| Successful estimate | Delegated to `formatEstimate()` — standard nutrient card |

### Edge Cases & Error Handling

1. **Media messages (photos, stickers, voice, documents)** — `msg.text` is `undefined` for these.
   The guard `const text = msg.text ?? ''` produces an empty string; the `if (trimmed)` check
   prevents any action. No reply sent.

2. **Empty / whitespace-only text** — after `trim()`, the empty string fails the `if (trimmed)`
   guard. No reply sent. (Telegram rarely sends pure-whitespace messages but some clients can.)

3. **Text that is only stopwords** (e.g. `"qué"`, `"de un"`) — `extractFoodQuery` strips all
   recognised prefixes; if the result is empty it falls back to the original trimmed text. This
   avoids an empty-string API call. The API returns null → no-data message shown to user.

4. **Messages > 500 characters** — rejected before extraction. User receives guidance. API not
   called. Prevents catastrophic backtracking on long inputs (documented in F027 edge-case tests).

5. **Chain slug false-positives** (`"pollo en salsa"`, `"--"`, `"mcdonalds-"`) — inherited from
   F027's `parseEstimarArgs`. The CHAIN_SLUG_REGEX `^[a-z0-9-]+-[a-z0-9-]+$` has the known
   edge cases documented in F027's `edge-cases.test.ts` (trailing hyphen, all-hyphen slug). These
   are acceptable in Phase 1: the API will return null result and the user receives a no-data
   message instead of a crash.

6. **Text starting with `/` sent via forwarded messages or inline** — the leading-slash guard
   ensures `onText` handlers take priority. The `'message'` event still fires for commands, but
   the `cmdMatch` check routes known commands away and the NL handler is never called for them.

7. **Forwarded messages** — `msg.forward_from` may be set but `msg.text` still contains the
   forwarded text. The NL handler processes forwarded food-related text normally.

8. **Concurrent messages** — the bot is stateless; each message is handled independently. No
   mutex or queue needed.

9. **`apiClient.estimate()` timeout (10s)** — `handleApiError` returns the existing Spanish
   timeout message. Consistent with `/estimar` behaviour.

10. **`wrapHandler` around NL handler** — same safety net as all command handlers: if
    `handleNaturalLanguage` throws an unexpected error (non-ApiError), the user receives
    `'Lo siento, ha ocurrido un error inesperado.'` rather than silence or a crash.

11. **Group chat messages** — in groups, users may send plain text unrelated to food. The bot
    will attempt extraction and call the API. The result will be "no data" for non-food input.
    In Phase 1 this is acceptable. Scope reduction (only respond when bot is @mentioned) is a
    Phase 2 consideration and is **out of scope for F028**.

### Testing Strategy

**New test file: `packages/bot/src/__tests__/naturalLanguage.test.ts`**

Test `extractFoodQuery` (pure function — no mocks needed):

| Test case | Input | Expected |
|---|---|---|
| Plain dish name | `"big mac"` | `{ query: "big mac" }` |
| "calorías de un X" | `"calorías de un big mac"` | `{ query: "big mac" }` |
| "calorías de una X" | `"calorías de una hamburguesa"` | `{ query: "hamburguesa" }` |
| "cuántas calorías tiene un X" | `"cuántas calorías tiene una hamburguesa"` | `{ query: "hamburguesa" }` |
| "cuántas calorías hay en un X" | `"cuántas calorías hay en un big mac"` | `{ query: "big mac" }` |
| "qué lleva un X" | `"qué lleva un whopper"` | `{ query: "whopper"` } |
| "qué contiene el X" | `"qué contiene el mcpollo"` | `{ query: "mcpollo" }` |
| "información nutricional del X" | `"información nutricional del big mac"` | `{ query: "big mac" }` |
| "dame las calorías del X" | `"dame las calorías del big mac"` | `{ query: "big mac" }` |
| Plain dish + chain | `"big mac en mcdonalds-es"` | `{ query: "big mac", chainSlug: "mcdonalds-es" }` |
| Prefix + chain | `"calorías de un big mac en mcdonalds-es"` | `{ query: "big mac", chainSlug: "mcdonalds-es" }` |
| "pollo en salsa" (no hyphen slug) | `"pollo en salsa"` | `{ query: "pollo en salsa" }` |
| "pollo en salsa en mcdonalds-es" | `"pollo en salsa en mcdonalds-es"` | `{ query: "pollo en salsa", chainSlug: "mcdonalds-es" }` |
| Uppercase input preserved | `"Big Mac"` | `{ query: "Big Mac" }` |
| Only-stopwords fallback | `"qué"` | `{ query: "qué" }` (original text, not empty) |
| Emoji pass-through | `"🍔"` | `{ query: "🍔" }` |
| Extra whitespace is trimmed | `"  big mac  "` | `{ query: "big mac" }` |
| Multiple hyphens in slug | `"pizza en subway-es-2"` | `{ query: "pizza", chainSlug: "subway-es-2" }` |

Test `handleNaturalLanguage` (mock ApiClient):

| Test case | Setup | Expected |
|---|---|---|
| Happy path | `estimate` resolves with non-null result | Returns formatted nutrient card (contains kcal) |
| `result === null` | `estimate` resolves with `result: null` | Returns no-data message |
| Text > 500 chars | — (no API call) | Returns "sé más específico" message |
| `ApiError` 429 | `estimate` throws `ApiError(429, ...)` | Returns rate-limit Spanish message |
| `ApiError` 5xx | `estimate` throws `ApiError(503, ...)` | Returns service-unavailable message |
| `ApiError` TIMEOUT | `estimate` throws `ApiError(408, 'TIMEOUT', ...)` | Returns timeout message |
| `ApiError` NETWORK_ERROR | `estimate` throws `ApiError(0, 'NETWORK_ERROR', ...)` | Returns network-error message |
| Extraction feeds API | `"calorías de un big mac"` + mock resolves | `estimate` called with `{ query: "big mac" }` |
| Chain extraction feeds API | `"big mac en mcdonalds-es"` + mock resolves | `estimate` called with `{ query: "big mac", chainSlug: "mcdonalds-es" }` |

Updated `bot.test.ts` — new cases for the `'message'` event handler:

| Test case | Input | Expected |
|---|---|---|
| Plain text routes to NL handler | `makeMessage('big mac')` | `mockClient.estimate` called; `sendMessage` called |
| Media message (no `msg.text`) | `{ chat: { id: 1 } }` (no text field) | `sendMessage` NOT called |
| Empty text | `makeMessage('')` | `sendMessage` NOT called |
| Whitespace-only text | `makeMessage('   ')` | `sendMessage` NOT called |
| Unknown slash command still works | `makeMessage('/badcmd')` | "no reconocido" message sent (unchanged F027 behaviour) |
| Known slash command via message event | `makeMessage('/buscar big mac')` | NL handler NOT called; unknown-command branch skipped (F027 unchanged) |

---

## Implementation Plan

### Existing Code to Reuse

| Asset | Location | How used |
|---|---|---|
| `CHAIN_SLUG_REGEX` | `commands/estimar.ts` (local constant) | Copy verbatim into `handlers/naturalLanguage.ts` — same regex, same chain-split logic |
| `parseEstimarArgs` logic | `commands/estimar.ts` | Replicate as Step 1 of `extractFoodQuery` (function is not exported; do not modify `estimar.ts`) |
| `ApiClient` interface | `apiClient.ts` | Import type for DI parameter |
| `ApiError` class | `apiClient.ts` | Used in `catch` branch of `handleNaturalLanguage` |
| `formatEstimate()` | `formatters/estimateFormatter.ts` | Called with the `EstimateData` returned by the API |
| `handleApiError()` | `commands/errorMessages.ts` | Called in the `catch` branch; returns already-escaped Spanish string |
| `logger` | `logger.ts` | `logger.warn(...)` before `handleApiError()`, consistent with `estimar.ts` |
| `wrapHandler` closure | `bot.ts` (local) | Wrap the NL handler call inside `bot.on('message', ...)` — no export needed |
| `escapeMarkdown()` | `formatters/markdownUtils.ts` (imported as `.js` in ESM) | **Not used for >500-char prompt** (would break `_italic_`); only used if other plain-text escaping is needed |
| `makeMessage()` helper | `__tests__/bot.test.ts` | Reuse pattern (copy into `naturalLanguage.test.ts` or import if exported) |
| `makeMockClient()` helper | `__tests__/commands.test.ts` | Copy pattern (not exported; duplicate into new test file) |
| `ESTIMATE_DATA_WITH_RESULT` / `ESTIMATE_DATA_NULL` | `__tests__/commands.test.ts` | Copy fixtures into `naturalLanguage.test.ts` |

---

### Files to Create

| File | Purpose |
|---|---|
| `packages/bot/src/handlers/naturalLanguage.ts` | Pure `extractFoodQuery()` + async `handleNaturalLanguage()`; exports `MAX_NL_TEXT_LENGTH` constant |
| `packages/bot/src/__tests__/naturalLanguage.test.ts` | Unit tests for `extractFoodQuery` (pure, no mocks) and `handleNaturalLanguage` (mock ApiClient); ~25 tests |

---

### Files to Modify

| File | What changes |
|---|---|
| `packages/bot/src/bot.ts` | Add import of `handleNaturalLanguage` from `./handlers/naturalLanguage.js`; extend `bot.on('message', ...)` to call `wrapHandler(() => handleNaturalLanguage(trimmed, apiClient))(msg)` for non-empty, non-slash plain text |
| `packages/bot/src/__tests__/bot.test.ts` | Replace the existing test `'does NOT send a reply for plain text messages (not commands)'` with the new NL-routing behaviour; add 5 new test cases for the updated `'message'` handler dispatch |

---

### Implementation Order

Follow strict TDD (red → green → refactor) within each layer.

**Step 1 — Write failing tests for `extractFoodQuery` (pure function)**

File: `packages/bot/src/__tests__/naturalLanguage.test.ts`

Write the full `describe('extractFoodQuery', ...)` block covering all cases from the spec's testing table (17 cases). Do NOT import the production module yet — the import will cause a compile error, making all tests red. Confirm all fail before proceeding.

Key test cases to cover (assert exact `{ query, chainSlug }` shape):
- Plain dish name passthrough (`"big mac"` → `{ query: "big mac" }`)
- All nine prefix-stripping patterns from the spec table, one test each
- Article stripping after prefix (`"qué contiene el mcpollo"` → `{ query: "mcpollo" }`)
- Chain slug extraction without prefix (`"big mac en mcdonalds-es"`)
- Chain slug extraction combined with prefix (`"calorías de un big mac en mcdonalds-es"`)
- No-false-split on `"pollo en salsa"` (no hyphen)
- Last-` en `-wins for `"pollo en salsa en mcdonalds-es"`
- Uppercase preservation (`"Big Mac"` → `{ query: "Big Mac" }`)
- Only-stopwords fallback (`"qué"` → `{ query: "qué" }`, not empty)
- Emoji passthrough (`"🍔"`)
- Leading/trailing whitespace trimmed (`"  big mac  "` → `{ query: "big mac" }`)
- Multi-hyphen slug (`"pizza en subway-es-2"` → `chainSlug: "subway-es-2"`)

**Step 2 — Implement `extractFoodQuery` in `handlers/naturalLanguage.ts`**

File: `packages/bot/src/handlers/naturalLanguage.ts`

Create the file with only `extractFoodQuery`. Do not yet export `handleNaturalLanguage`. Implementation structure:

1. Export constant `MAX_NL_TEXT_LENGTH = 500`
2. Copy `CHAIN_SLUG_REGEX` from `estimar.ts` as a module-level constant (do not import from `estimar.ts` — it is a private implementation detail of that file)
3. Implement chain-slug extraction (Step 1 of parsing spec): find last ` en `, test suffix against regex, split or return whole text as remainder
4. Define `PREFIX_PATTERNS`: an ordered `readonly` array of `RegExp` objects corresponding to the nine patterns in the spec table. Each regex must use the `i` flag (case-insensitive). Order longest/most-specific match first, exactly as listed in the spec
5. Apply prefix patterns in order — **single pass, first match wins**: iterate the array, test each regex against the remainder, on the first match strip the matched portion and stop (do not try remaining patterns). This is sufficient because the patterns are mutually exclusive (each targets a distinct Spanish phrase structure). No multi-pass needed
6. Apply article stripping pattern once after prefix step
7. If stripped result is empty/whitespace → return `{ query: originalTrimmed, chainSlug? }`
8. Otherwise return `{ query: stripped, chainSlug? }`

Run tests — all Step 1 tests should now pass (green).

**Step 3 — Write failing tests for `handleNaturalLanguage`**

File: `packages/bot/src/__tests__/naturalLanguage.test.ts` (extend same file)

Write the full `describe('handleNaturalLanguage', ...)` block. Mock ApiClient using `makeMockClient()` pattern from `commands.test.ts`. Test cases (9 total):

- Happy path: `estimate` resolves with non-null result → returned string contains `kcal` value (`"563"`)
- Null result: `estimate` resolves `result: null` → returned string contains `"No se encontraron datos nutricionales"`
- Text > 500 chars: `estimate` is NOT called; returned string contains `"sé más específico"`
- `ApiError` 429 → returned string contains `"Demasiadas consultas"`
- `ApiError` 503 → returned string contains `"no esta disponible"`
- `ApiError` 408 / `TIMEOUT` → returned string contains `"tardo demasiado"`
- `ApiError` 0 / `NETWORK_ERROR` → returned string contains `"conectar"`
- Extraction integration: input `"calorías de un big mac"` → `estimate` called with `{ query: "big mac" }` (chainSlug absent)
- Chain extraction integration: input `"big mac en mcdonalds-es"` → `estimate` called with `{ query: "big mac", chainSlug: "mcdonalds-es" }`
- Non-ApiError (e.g. `TypeError`) → function throws (does NOT catch) — verified with `expect(...).rejects.toThrow()`

All tests should be red (function not yet exported).

**Step 4 — Implement `handleNaturalLanguage` in `handlers/naturalLanguage.ts`**

Extend the same file to export the async handler:

```
import type { ApiClient } from '../apiClient.js';
import { ApiError } from '../apiClient.js';
import { formatEstimate } from '../formatters/estimateFormatter.js';
import { handleApiError } from '../commands/errorMessages.js';
import { logger } from '../logger.js';
import { escapeMarkdown } from '../formatters/markdownUtils.js';
```

Handler flow (matches spec §Handler Logic):
1. `const trimmed = text.trim()` — guard is already done in `bot.ts` but handler should be self-contained for testability
2. If `trimmed.length > MAX_NL_TEXT_LENGTH` → return a hardcoded pre-escaped MarkdownV2 string: `'Por favor, sé más específico\\. Escribe el nombre del plato directamente, por ejemplo: _big mac_'`. **Do NOT use `escapeMarkdown()` here** — it would escape the `_` delimiters, breaking the italic formatting. The string must be a raw constant.
3. Call `extractFoodQuery(trimmed)` → `{ query, chainSlug }`
4. `try { const data = await apiClient.estimate({ query, chainSlug }); return formatEstimate(data); }`
5. `catch (err) { if (err instanceof ApiError) { logger.warn({ err, query, chainSlug }, 'NL handler API error'); return handleApiError(err); } throw err; }` — **only catch `ApiError`**; rethrow unknown errors so `wrapHandler` in `bot.ts` handles them with the generic "error inesperado" message and `logger.error`

Run tests — all Step 3 tests should now pass (green).

**Step 5 — Write failing tests for the updated `bot.ts` message handler**

File: `packages/bot/src/__tests__/bot.test.ts`

Replace the existing test case `'does NOT send a reply for plain text messages (not commands)'` — this behaviour is being changed: plain text now routes to the NL handler. Add the following cases to the existing `describe('buildBot', ...)` block:

1. `'routes plain text to NL handler — calls estimate and sendMessage'`
   - Setup: `mockClient.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT)`; `mockBot.sendMessage.mockResolvedValue({})`
   - Fire message handler with `makeMessage('big mac')`
   - Assert: `mockClient.estimate` called once; `mockBot.sendMessage` called once

2. `'does NOT call estimate or sendMessage for media message (no msg.text)'`
   - Fire message handler with `{ chat: { id: 123 } }` (no `text` field)
   - Assert: `mockClient.estimate` not called; `mockBot.sendMessage` not called

3. `'does NOT call estimate or sendMessage for empty text message'`
   - Fire handler with `makeMessage('')`
   - Assert: `mockClient.estimate` not called; `mockBot.sendMessage` not called

4. `'does NOT call estimate or sendMessage for whitespace-only text'`
   - Fire handler with `makeMessage('   ')`
   - Assert: `mockClient.estimate` not called; `mockBot.sendMessage` not called

5. `'unknown slash command still sends no-reconocido message (unchanged)'`
   - Already tested as `'sends unknown command message for unrecognized /command via message event'` — verify it still passes unchanged

6. `'known slash command via message event does NOT trigger NL handler'`
   - Already tested as `'does NOT send unknown command message for known commands via message event'` — verify it still passes unchanged; `estimate` must not be called

All new tests should be red (production code unchanged).

**Step 6 — Modify `bot.ts` to route plain text to the NL handler**

File: `packages/bot/src/bot.ts`

1. Add import at top of file:
   ```typescript
   import { handleNaturalLanguage } from './handlers/naturalLanguage.js';
   ```

2. Replace the `bot.on('message', ...)` block (lines 105–117) with the updated version from the spec §Updated `bot.ts`:
   ```typescript
   bot.on('message', (msg) => {
     const text = msg.text ?? '';
     const cmdMatch = /^\/(\w+)/.exec(text);

     if (cmdMatch) {
       const cmd = cmdMatch[1] ?? '';
       if (!KNOWN_COMMANDS.has(cmd)) {
         void send(
           msg.chat.id,
           escapeMarkdown('Comando no reconocido. Usa /help para ver los comandos disponibles.'),
         );
       }
       return;
     }

     const trimmed = text.trim();
     if (trimmed) {
       void wrapHandler(() => handleNaturalLanguage(trimmed, apiClient))(msg);
     }
   });
   ```

Note: `escapeMarkdown` is already imported in `bot.ts`. `wrapHandler` and `send` are already in scope as closures.

Run all tests — all Step 5 tests should now pass (green). All existing tests must continue to pass.

**Step 7 — Verify TypeScript strict compile and linting**

```bash
npm run typecheck -w @foodxplorer/bot
npm run lint -w @foodxplorer/bot
```

Fix any errors before declaring the step complete. No `any` types permitted. All imports must use `.js` extension.

---

### Testing Strategy

**New test file: `packages/bot/src/__tests__/naturalLanguage.test.ts`**

- `describe('extractFoodQuery', ...)` — 17 cases, zero mocks needed (pure function)
- `describe('handleNaturalLanguage', ...)` — 9 cases, mock `ApiClient` via `makeMockClient()` pattern

Mock pattern for `handleNaturalLanguage` tests:
```typescript
type MockApiClient = { [K in keyof ApiClient]: ReturnType<typeof vi.fn> };
function makeMockClient(): MockApiClient { ... }
```
Same shape used in `commands.test.ts` and `edge-cases.test.ts`. No real HTTP, no real Telegram.

**Updated test file: `packages/bot/src/__tests__/bot.test.ts`**

- Remove the `'does NOT send a reply for plain text messages (not commands)'` test (behaviour inverted by F028)
- Add 4 new message-dispatch tests (cases 1–4 above)
- Existing 2 slash-command tests for the message handler remain unchanged — they must still pass

**Fixture reuse**: Copy `ESTIMATE_DATA_WITH_RESULT` and `ESTIMATE_DATA_NULL` from `commands.test.ts` into `naturalLanguage.test.ts`. They are not exported so must be duplicated.

**Target test count**: ~26 new/changed tests across both files (17 extractFoodQuery + 9 handleNaturalLanguage + 4 new bot.test.ts + 1 removed = net +29 assertions).

---

### Key Patterns

1. **Handler file structure** — follow `commands/estimar.ts` exactly: module-level constants, named exports only, `logger.warn` before `handleApiError`, no default export.

2. **Import path extension** — all internal imports must end in `.js` (TypeScript resolves to `.ts` at compile time; Node ESM requires `.js`). Example: `import { handleNaturalLanguage } from './handlers/naturalLanguage.js'`.

3. **`wrapHandler` usage in `bot.ts`** — the closure captures `send`, `logger`, and `escapeMarkdown` from the outer `buildBot` scope. The NL call follows the identical pattern used by all eight command handlers: `void wrapHandler(() => handleNaturalLanguage(trimmed, apiClient))(msg)`.

4. **MarkdownV2 string escaping** — the >500-char prompt must be a **hardcoded pre-escaped constant**. Do NOT use `escapeMarkdown()` — it would escape the `_` delimiters and break italic formatting. Exact string: `'Por favor, sé más específico\\. Escribe el nombre del plato directamente, por ejemplo: _big mac_'`.

5. **Regex order in `PREFIX_PATTERNS`** — apply most-specific (longest) patterns before shorter ones. The spec table lists them in correct priority order. All patterns must use the `i` flag. Stop after first match (`break` or early return from `.find()`).

6. **No `onText` for NL** — do not add a catch-all `bot.onText(/.+/, ...)`. The spec explicitly prohibits this (Architecture Decision 8) because it causes double-fire with specific command handlers.

7. **Gotcha — existing `bot.test.ts` test to update** — the test `'does NOT send a reply for plain text messages (not commands)'` asserts `sendMessage` is NOT called for plain text. After F028 this will be false. Replace this test with the new NL-routing test (case 1 above) in the same describe block. Failing to remove it will cause a conflicting assertion.

8. **Gotcha — `wrapHandler` is not exported** — it is a local closure inside `buildBot`. The `handleNaturalLanguage` function is tested in isolation in `naturalLanguage.test.ts` without needing `wrapHandler`. `bot.test.ts` tests the dispatch indirectly by asserting `mockClient.estimate` and `mockBot.sendMessage` are called.

9. **Prefix pattern for "dame/dime"** — the spec pattern `^(?:dame|dime)\s+(?:la[s]?\s+)?(?:información|info|calorías?)\s+(?:de[l]?\s+)` has a trailing space in the regex but no trailing space before the food name in the example (`"dame las calorías del big mac"` → `"big mac"`). Ensure the pattern anchors correctly and the strip leaves no leading space before the article-stripping step.

10. **Only-stopwords fallback test** — input `"qué"` triggers the prefix pattern `^qué\s+(?:lleva|contiene|tiene)\s+` only if followed by those verbs. Without them, no pattern matches, so the full text `"qué"` is the result (no stripping). This is the correct fallback path — the function returns `{ query: "qué" }`, not an empty string. Write the test to assert exactly this.

---

## Acceptance Criteria

- [x] Plain text `"big mac"` sent to the bot returns a nutritional estimate card
- [x] Plain text `"calorías de un big mac"` returns the same card as `"big mac"`
- [x] Plain text `"big mac en mcdonalds-es"` returns card scoped to McDonald's Spain
- [x] Plain text `"pollo en salsa"` is NOT split (no chain slug) — full text sent to API
- [x] Media messages (photo, sticker) produce no reply
- [x] Whitespace-only or empty messages produce no reply
- [x] Text > 500 chars produces the "sé más específico" message without calling the API
- [x] All eight slash commands continue to work identically to F027
- [x] Unknown slash command (`/foo`) still produces "Comando no reconocido"
- [x] `extractFoodQuery` is a pure function with no side effects
- [x] All new unit tests pass (`npm test -w @foodxplorer/bot`) — 307 tests
- [x] TypeScript compiles clean (strict mode, no `any`)
- [x] ESLint passes with no errors

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing (80 new tests: 69 naturalLanguage.test.ts + 4 bot.test.ts + 7 removed/replaced = net +73)
- [x] Code follows project standards (TypeScript strict, no `any`, `.js` extensions on imports)
- [x] No linting errors in F028 files
- [x] Build succeeds
- [x] Specs reflect final implementation

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` executed, plan approved
- [x] Step 3: `backend-developer` executed with TDD
- [x] Step 4: `production-code-validator` executed, quality gates pass
- [x] Step 5: `code-review-specialist` executed
- [x] Step 5: `qa-engineer` executed (Standard)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-21 | Spec created | spec-creator agent, auto-approved (L2) |
| 2026-03-21 | Plan reviewed by Codex GPT-5.4 | 4 issues found (1C+2I+1S), 4 addressed: catch only ApiError (C), hardcode >500 prompt (I), clarify single-pass algorithm (I), fix .ts reference (S) |
| 2026-03-21 | Step 3 (Implement) completed | backend-developer agent, 7-step TDD. 32 new tests (28 naturalLanguage + 4 bot routing). 258 total tests |
| 2026-03-21 | Step 4 (Finalize) completed | production-code-validator: READY FOR PRODUCTION, 0 issues. Quality gates: 258 tests ✓, typecheck ✓, lint ✓ |
| 2026-03-21 | Step 5 (Review) completed | code-review-specialist: APPROVED (1 dead regex pattern removed, 5 tests added). qa-engineer: VERIFIED (49 edge-case tests, 1 spec deviation fixed). Final: 307 tests |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | Sections verified: (list) |
| 1. Mark all items | [ ] | AC: _/_, DoD: _/_, Workflow: _/_ |
| 2. Verify product tracker | [ ] | Active Session: step _/6, Features table: _/6 |
| 3. Update key_facts.md | [ ] | Updated: (list) / N/A |
| 4. Update decisions.md | [ ] | ADR-XXX added / N/A |
| 5. Commit documentation | [ ] | Commit: (hash) |
| 6. Verify clean working tree | [ ] | `git status`: clean |

---

*Ticket created: 2026-03-21*
