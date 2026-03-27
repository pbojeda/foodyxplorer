# F041 — Bot Recipe Calculator (/receta)

| Field        | Value                                              |
|--------------|----------------------------------------------------|
| Feature      | F041                                               |
| Epic         | E005 — Advanced Analysis & UX                      |
| Type         | Fullstack (Bot-only — API already exists)          |
| Priority     | High                                               |
| Status       | Ready for Merge                                    |
| Branch       | feature/F041-bot-recipe-calculator                 |
| Created      | 2026-03-27                                         |
| Dependencies | F035 ✅ (POST /calculate/recipe endpoint)          |

---

## Spec

### Description

F041 adds the `/receta` Telegram bot command so users can calculate the aggregate nutritional content of a home recipe by typing its ingredients in plain Spanish text.

The command accepts a free-form ingredient list as its argument (e.g., `/receta 200g pollo, 100g arroz, 50g cebolla`) and calls the existing `POST /calculate/recipe` endpoint in **free-form mode**. The LLM parses the text into structured ingredients; the API engine resolves each ingredient against the food database and returns aggregate nutrients. The bot formats and sends the result as a MarkdownV2 message.

No new API endpoint is created. No database writes occur. All LLM calls happen inside the API, not the bot.

**User flow:**

1. User sends `/receta 200g pollo, 100g arroz, 50g cebolla`
2. Bot calls `POST /calculate/recipe` with `{ mode: "free-form", text: "200g pollo, 100g arroz, 50g cebolla" }`
3. API returns `RecipeCalculateData` (totalNutrients, ingredients array, unresolvedIngredients, confidenceLevel)
4. Bot formats and sends a MarkdownV2 message showing totals, per-ingredient breakdown, and any unresolved ingredients
5. If args are empty, the bot returns a usage hint

---

### API Changes

None. The endpoint `POST /calculate/recipe` (F035) is already implemented and deployed. The API spec (`docs/specs/api-spec.yaml`) requires no updates.

---

### Bot Changes

Six files are created or modified in `packages/bot/src/`.

#### 1. `apiClient.ts` — add `calculateRecipe()` method

**Interface addition** (in the `ApiClient` interface):

```
calculateRecipe(text: string): Promise<RecipeCalculateData>
```

- Uses `postJson<RecipeCalculateData>('/calculate/recipe', { mode: 'free-form', text })`
- Uses the default `BOT_API_KEY` (not admin key — this is a public endpoint)
- Uses a dedicated `RECIPE_TIMEOUT_MS` (30s) constant. The API-side timeout is also 30s; free-form recipe calculation involves LLM parsing (~2-5s) + multi-ingredient resolution including L3/L4 (~1-3s each, up to 10 budget), so the default 10s `REQUEST_TIMEOUT_MS` would cause frequent client-side timeouts. The `postJson` helper needs a `timeout` parameter override for this call.
- Import: `RecipeCalculateData` from `@foodxplorer/shared`

**Implementation addition** (in the `createApiClient` return object):

```
async calculateRecipe(text) {
  return postJson<RecipeCalculateData>('/calculate/recipe', { mode: 'free-form', text }, undefined, RECIPE_TIMEOUT_MS);
},
```

Note: `postJson` needs a new optional `timeout` parameter (4th arg, defaults to `REQUEST_TIMEOUT_MS`). This is a minimal, backward-compatible change — all existing callers continue using the default.

---

#### 2. `commands/receta.ts` — NEW command handler

**Signature:**

```
export async function handleReceta(args: string, apiClient: ApiClient): Promise<string>
```

**Behavior:**

- Trim `args`. If empty or whitespace, return the usage hint (pre-escaped MarkdownV2):
  ```
  Uso: /receta \<ingredientes\>
  Ejemplo: /receta 200g pollo, 100g arroz, 50g aceite de oliva
  ```
- **Input length guard:** If `trimmed.length > 2000`, return early with a friendly message: `'La receta es demasiado larga\\. El límite es de 2000 caracteres\\.'` — avoids sending to the API only to get a 400 validation error.
- Otherwise call `apiClient.calculateRecipe(trimmed)`.
- On success pass result to `formatRecipeResult(data)` and return the formatted string.
- On error call `handleRecipeError(err)` which maps recipe-specific error codes before falling through to `handleApiError`:
  - `RECIPE_UNRESOLVABLE` (422) → `'No se pudo resolver ningún ingrediente\\. Intenta con nombres más concretos\\.'`
  - `FREE_FORM_PARSE_FAILED` (422) → `'No entendí la lista de ingredientes\\. Intenta con el formato: 200g pollo, 100g arroz\\.'`
  - All other errors → delegate to `handleApiError(err)` from `errorMessages.ts`
- Log warn with `{ err, text: trimmed }` before returning the error message (mirrors `/estimar` pattern).

**Bot-level rate limiting (5 requests/hour per chatId):**

The handler receives `chatId` (new parameter) and checks a Redis counter `fxp:receta:hourly:<chatId>` before calling the API. This mirrors the F034 dual rate-limiting pattern (ADR-011):
- Bot-level: 5/hr per chatId (prevents a single user from exhausting the shared BOT_API_KEY quota)
- API-level: global rate limit per API key (existing F026 middleware)
- Fail-open on Redis error (log and continue)

The handler signature changes to:
```
export async function handleReceta(args: string, chatId: number, apiClient: ApiClient, redis: Redis): Promise<string>
```

This means `/receta` cannot use `wrapHandler` (which only supports `Promise<string>` with no extra args) — it must be wired directly in `bot.ts` like `/restaurante`.

---

#### 3. `formatters/recipeFormatter.ts` — NEW formatter

**Signature:**

```
export function formatRecipeResult(data: RecipeCalculateData): string
```

**Output structure** (MarkdownV2, all dynamic strings escaped via `escapeMarkdown()`):

```
*Resultado de la receta*

🔥 Calorías: <calories> kcal
🥩 Proteínas: <proteins> g
🍞 Carbohidratos: <carbohydrates> g
🧈 Grasas: <fats> g
[🌾 Fibra: <fiber> g]           ← only if non-null and > 0
[🧂 Sodio: <sodium> mg]         ← only if non-null and > 0
[🫙 Grasas saturadas: <sat> g]  ← only if non-null and > 0

*Ingredientes \(<resolvedCount>/<total>\):*
• <nameEs or name> — <grams>g → <calories_i> kcal, <proteins_i> g prot
[• ...]

[*No resueltos:* <item1>, <item2>]  ← only if unresolvedIngredients.length > 0

_Confianza: <alta|media|baja>_
```

**Detailed formatting rules:**

- **Header:** `*Resultado de la receta*` (literal, no escaping needed)
- **Total nutrients:** Use `formatNutrient(value, unit)` from `markdownUtils.ts` for each non-null nutrient. Always show calories, proteins, carbohydrates, fats (display `0` if value is `0`, omit only if `null`). Show fiber, sodium, saturatedFats only if `!= null && > 0`.
- **Ingredient count line:** `resolvedCount` / `(resolvedCount + unresolvedCount)` total. Both are plain integers — escape with `escapeMarkdown(String(...))`.
- **Per-ingredient list:** One bullet per entry in `data.ingredients` where `resolved === true`. Show the display name (prefer `resolvedAs.nameEs ?? resolvedAs.name ?? input.name ?? 'Ingrediente'`), `input.grams` with the `g` unit, and the ingredient's own `nutrients.calories` and `nutrients.proteins` if non-null. If `input.portionMultiplier !== 1.0`, append `(x<multiplier>)` after grams to avoid confusing the user (e.g., "medio pollo" → "1000g (x0.5)"). Format: `• <name> — <grams>g [x<mult>] → <cal> kcal, <prot> g prot`. Escape name via `escapeMarkdown()`. If `nutrients` is null for a resolved ingredient (edge case), show `• <name> — <grams>g → sin datos`.
- **Unresolved list:** Only rendered when `data.unresolvedIngredients.length > 0`. Label `*No resueltos:*` then comma-separated list of ingredient names, each escaped via `escapeMarkdown()`.
- **Confidence footer:** Map `confidenceLevel` to Spanish using the same `CONFIDENCE_MAP` from `estimateFormatter.ts` (`high → alta`, `medium → media`, `low → baja`). Format: `_Confianza: <label>_`.
- **Telegram message length limit:** Truncation applies **only to the per-ingredient section**, not the entire message. Build the header (totals), footer (unresolved + confidence), and ingredient list separately. If `header + ingredientList + footer > 4000`, truncate the ingredient list to fit, appending `\n\\.\\.\\. y X ingredientes más`. This ensures totals, unresolved items, and confidence are always visible.
- Import: `RecipeCalculateData` from `@foodxplorer/shared`; `escapeMarkdown`, `formatNutrient`, `truncate` from `./markdownUtils.js`.

---

#### 4. `bot.ts` — register `/receta`

Two changes:

**a) `KNOWN_COMMANDS` set** — add `'receta'`:

```typescript
const KNOWN_COMMANDS = new Set([
  'start', 'help', 'buscar', 'estimar', 'restaurantes', 'platos', 'cadenas', 'info', 'restaurante', 'receta',
]);
```

**b) Import and register the handler** — following the `/restaurante` pattern (direct wiring, not `wrapHandler`):

```typescript
import { handleReceta } from './commands/receta.js';

bot.onText(
  /^\/receta(?:@\w+)?(?:\s+(.+))?$/s,
  async (msg, match) => {
    try {
      const text = await handleReceta(match?.[1] ?? '', msg.chat.id, apiClient, redis);
      await send(msg.chat.id, text);
    } catch (err) {
      logger.error({ err, chatId: msg.chat.id }, 'Unhandled /receta error');
      try {
        await send(msg.chat.id, escapeMarkdown('Lo siento, ha ocurrido un error inesperado.'));
      } catch { /* ignore send failure */ }
    }
  },
);
```

Note the `s` flag (dotAll) on the regex so that multi-line ingredient lists typed in Telegram (using Shift+Enter) are captured in capture group 1. `/receta` is wired directly (not through `wrapHandler`) because it needs `chatId` and `redis` for rate limiting — same pattern as `/restaurante`.

---

#### 5. `commands/start.ts` — update help text

Add `/receta` to the list of available commands shown in `/start` and `/help`:

```
/receta <ingredientes> — Calcula la información nutricional de una receta
```

---

### Data Model Changes

None.

---

### Edge Cases & Error Handling

| Scenario | Expected behaviour |
|---|---|
| Empty args (`/receta` with no text) | Return usage hint with example |
| Args are whitespace only | Treated as empty — return usage hint |
| All ingredients unresolved | API returns 422 `RECIPE_UNRESOLVABLE` → user message: "No se pudo resolver ningún ingrediente. Intenta con nombres más concretos." |
| LLM cannot parse the free-form text | API returns 422 `FREE_FORM_PARSE_FAILED` → user message: "No entendí la lista de ingredientes. Intenta con el formato: 200g pollo, 100g arroz." |
| Some ingredients unresolved (partial) | API returns 200 with `confidenceLevel: "low"` → bot shows partial totals + `*No resueltos:*` list |
| Input text > 2000 characters | Pre-validated in bot → "La receta es demasiado larga. El límite es de 2000 caracteres." (no API call) |
| Bot-level rate limit exceeded (5/hr per chatId) | "Has alcanzado el límite de recetas por hora. Inténtalo más tarde." |
| API timeout (bot-side 30s AbortError) | `handleApiError` returns "La consulta tardó demasiado." |
| API returns 5xx | `handleApiError` returns "El servicio no está disponible." |
| Network error | `handleApiError` returns "No se puede conectar con el servidor." |
| Rate limit (429) | `handleApiError` returns "Demasiadas consultas. Espera un momento." |
| Result exceeds 4000 chars (very long recipe) | `truncate(result, 4000)` appends "Lista recortada" note |
| `totalNutrients` fields are null (all ingredients resolved but nutrient data missing) | Show `0` for mandatory fields if value is `0`; omit the row if value is `null` |
| Multi-line ingredient text (Shift+Enter in Telegram) | Regex `s` flag captures the newline-separated text into args; API free-form mode handles it |
| `parsedIngredients` field in response | Not displayed to the user — it is internal LLM debug data |
| `cachedAt` field in response | Not displayed to the user |

---

---

## Implementation Plan

### Existing Code to Reuse

- `packages/bot/src/apiClient.ts` — `postJson` helper (add `timeout` param), `ApiError`, `REQUEST_TIMEOUT_MS`, `UPLOAD_TIMEOUT_MS` (export pattern for `RECIPE_TIMEOUT_MS`)
- `packages/bot/src/commands/errorMessages.ts` — `handleApiError` (delegated to for all non-recipe-specific errors)
- `packages/bot/src/formatters/markdownUtils.ts` — `escapeMarkdown`, `formatNutrient`, `truncate`
- `packages/bot/src/formatters/estimateFormatter.ts` — `CONFIDENCE_MAP` (copy the same map into `recipeFormatter.ts`; do not re-export from `estimateFormatter`)
- `packages/bot/src/handlers/callbackQuery.ts` — `isRateLimited` pattern (Redis incr + expire + fail-open; the function itself is private, replicate the pattern in `receta.ts`)
- `packages/shared/src/schemas/recipeCalculate.ts` — `RecipeCalculateData` type (already exported from `@foodxplorer/shared`)
- `packages/bot/src/logger.ts` — `logger.warn` for error logging

---

### Files to Create

| File | Purpose |
|------|---------|
| `packages/bot/src/commands/receta.ts` | `/receta` command handler: input validation, rate limiting, API call, error mapping |
| `packages/bot/src/formatters/recipeFormatter.ts` | `formatRecipeResult(data)` — MarkdownV2 card with totals, per-ingredient breakdown, unresolved list, confidence |
| `packages/bot/src/__tests__/f041.receta.test.ts` | Unit tests for `handleReceta` (all scenarios) |
| `packages/bot/src/__tests__/f041.recipeFormatter.test.ts` | Unit tests for `formatRecipeResult` (formatting, truncation, edge cases) |
| `packages/bot/src/__tests__/f041.apiClient.test.ts` | Unit tests for `calculateRecipe` in `apiClient.ts` and the `timeout` param on `postJson` |

---

### Files to Modify

| File | Changes |
|------|---------|
| `packages/bot/src/apiClient.ts` | (1) Add optional `timeout` param (4th arg, default `REQUEST_TIMEOUT_MS`) to `postJson`. (2) Export `RECIPE_TIMEOUT_MS = 30_000` constant. (3) Add `calculateRecipe(text: string): Promise<RecipeCalculateData>` to the `ApiClient` interface. (4) Implement `calculateRecipe` in the `createApiClient` return object. (5) Add `RecipeCalculateData` to the shared-types import. |
| `packages/bot/src/bot.ts` | (1) Add `'receta'` to `KNOWN_COMMANDS`. (2) Import `handleReceta`. (3) Wire `/receta` directly (not via `wrapHandler`) using the same pattern as `/restaurante` — async handler with `try/catch` and `send` on error. Regex: `/^\/receta(?:@\w+)?(?:\s+(.+))?$/s` (note `s` dotAll flag). |
| `packages/bot/src/commands/start.ts` | Add `/receta \<ingredientes\> — Calcula la informacion nutricional de una receta` to the command list. |
| `packages/bot/src/__tests__/commands.test.ts` | Add `calculateRecipe: vi.fn()` to `makeMockClient()`. Add `/receta` presence assertion inside `handleStart` describe block. |
| `packages/bot/src/__tests__/bot.test.ts` | Add `calculateRecipe: vi.fn()` to `makeMockClient()`. Add test verifying `'receta'` is in `KNOWN_COMMANDS`. |
| `packages/bot/src/__tests__/f032.restaurante.test.ts` | Add `calculateRecipe: vi.fn()` to `makeMockClient()`. |
| `packages/bot/src/__tests__/f034.callbackQuery.test.ts` | Add `calculateRecipe: vi.fn()` to `makeMockClient()`. |
| `packages/bot/src/__tests__/f034.apiClient.test.ts` | Add `calculateRecipe: vi.fn()` to `makeMockClient()` if present. |
| `packages/bot/src/__tests__/f031.fileUpload.test.ts` | Add `calculateRecipe: vi.fn()` to `makeMockClient()`. |
| `packages/bot/src/__tests__/f032.callbackQuery.test.ts` | Add `calculateRecipe: vi.fn()` to `makeMockClient()`. |
| `packages/bot/src/__tests__/edge-cases.test.ts` | Add `calculateRecipe: vi.fn()` to `makeMockClient()`. |
| `packages/bot/src/__tests__/naturalLanguage.test.ts` | Add `calculateRecipe: vi.fn()` to `makeMockClient()`. |
| `packages/bot/src/__tests__/f031.qa-edge-cases.test.ts` | Add `calculateRecipe: vi.fn()` to `makeMockClient()`. |
| `packages/bot/src/__tests__/f032.qa-edge-cases.test.ts` | Add `calculateRecipe: vi.fn()` to `makeMockClient()`. |
| `packages/bot/src/__tests__/f031.callbackQuery.test.ts` | Add `calculateRecipe: vi.fn()` to `makeMockClient()`. |

> **IMPORTANT**: Run `grep -rl 'makeMockClient\|MockApiClient' packages/bot/src/__tests__/` to find ALL files needing the `calculateRecipe` mock. Also update the `onText` call count assertion in `bot.test.ts` from 9 to 10.

---

### Implementation Order

Follow bot-layer order: shared types are already done (F035), so proceed from infrastructure to handler to formatter to registration.

**Step 1 — Write failing tests for `apiClient.ts` changes** (`f041.apiClient.test.ts`)

Write tests (all failing at this point) that verify:
- `calculateRecipe` calls `POST /calculate/recipe` URL
- Uses POST method with JSON body `{ mode: 'free-form', text }`
- Uses `X-API-Key: BOT_API_KEY` (not admin key)
- Uses `X-FXP-Source: bot` header
- Uses a timeout longer than `REQUEST_TIMEOUT_MS` (assert `AbortController` is set with ≥ 30000 ms — see the timeout mock pattern from `f034.apiClient.test.ts`)
- Returns parsed `RecipeCalculateData` on 200
- Throws `ApiError(422, 'RECIPE_UNRESOLVABLE')` on 422 with that code
- Throws `ApiError(422, 'FREE_FORM_PARSE_FAILED')` on 422 with that code
- Throws `ApiError(0, 'NETWORK_ERROR')` on fetch rejection
- The `postJson` `timeout` param: existing callers still work with default (no regression)

Follow `f034.apiClient.test.ts` pattern: `vi.stubGlobal('fetch', fetchMock)`, `beforeAll` async import, `makeResponse` helper.

**Step 2 — Implement `apiClient.ts` changes** (make Step 1 tests pass)

- Add optional `timeout?: number` as 4th parameter to `postJson` (default `REQUEST_TIMEOUT_MS`). Pass it to `setTimeout(() => controller.abort(), timeout)`.
- Export `export const RECIPE_TIMEOUT_MS = 30_000;` alongside `UPLOAD_TIMEOUT_MS`.
- Add `RecipeCalculateData` to the import from `@foodxplorer/shared`.
- Add `calculateRecipe(text: string): Promise<RecipeCalculateData>` to the `ApiClient` interface with JSDoc.
- Implement in `createApiClient`: `return postJson<RecipeCalculateData>('/calculate/recipe', { mode: 'free-form', text }, undefined, RECIPE_TIMEOUT_MS);`
- Update all `makeMockClient()` helper functions across test files to include `calculateRecipe: vi.fn()`.

**Step 3 — Write failing tests for `recipeFormatter.ts`** (`f041.recipeFormatter.test.ts`)

Write tests (all failing) that verify:
- Happy path: full resolve, all 4 mandatory nutrients present in output
- Header is `*Resultado de la receta*`
- `formatNutrient` used for calories (escaped decimal point check)
- Optional nutrients (fiber, sodium, saturatedFats) shown only when `!= null && > 0`
- `portionMultiplier !== 1.0` shows `(x<mult>)` after grams in ingredient line
- `portionMultiplier === 1.0` does NOT show `(x1)` suffix
- Unresolved section rendered when `unresolvedIngredients.length > 0`
- Unresolved section absent when `unresolvedIngredients` is empty
- Confidence footer: `medium → media`, `low → baja`, `high → alta`
- `resolved === false` ingredients are NOT in the bullet list
- Display name resolution order: `resolvedAs.nameEs` → `resolvedAs.name` → `input.name` → `'Ingrediente'`
- Null `nutrients` for a resolved ingredient shows `→ sin datos`
- Individual null nutrient fields (e.g., `calories: null` but `nutrients` object exists) show `?` as placeholder (e.g., `? kcal`)
- Output length ≤ 4000 chars when ingredient list is very long (truncation test: build a data fixture with 50 ingredients, assert `result.length <= 4000`)
- Truncated output contains `\.\.\. y X ingredientes más` note (NOT `_Lista recortada_` — custom truncation)
- Totals section and confidence are always present even when truncation occurs

Use plain object fixtures for `RecipeCalculateData` (no class instantiation needed — it's a Zod-inferred type).

**Step 4 — Implement `recipeFormatter.ts`** (make Step 3 tests pass)

File: `packages/bot/src/formatters/recipeFormatter.ts`

- Import `RecipeCalculateData` from `@foodxplorer/shared`.
- Import `escapeMarkdown`, `formatNutrient`, `truncate` from `./markdownUtils.js`.
- Define local `CONFIDENCE_MAP: Record<string, string> = { high: 'alta', medium: 'media', low: 'baja' }`.
- Implement `formatRecipeResult(data: RecipeCalculateData): string`:
  1. Build `headerLines[]`: `*Resultado de la receta*`, blank line, then the 4 mandatory nutrient rows using `formatNutrient`. Handle `null` values for mandatory fields by showing `0` only if the value is `0`, omitting the row if the value is `null`. Then append optional rows for fiber, sodium, saturatedFats when `!= null && > 0`.
  2. Build `footerLines[]`: unresolved block (if any) + blank line + confidence line.
  3. Build `ingredientLines[]`: one `•` line per `data.ingredients` entry where `resolved === true`. For each: resolve display name, format grams and optional `(x<mult>)`, then nutrients or `sin datos`. Escape all dynamic strings.
  4. Assemble: `header + '\n' + ingredientSection + '\n' + footer`. If total length > 4000, truncate only the `ingredientSection` portion: reduce ingredient lines until `header + truncatedIngredients + '\\n\\.\\.\\. y X ingredientes más' + '\n' + footer <= 4000`.
  5. Return assembled string. Do NOT call `truncate()` on the whole message — only on the ingredient list.

> Implementation note on truncation: build a helper `buildIngredientSection(lines: string[], extraCount: number): string` that accepts the remaining lines and the count of dropped ones. Binary-search or linear-scan from the end is acceptable given max 50 ingredients.

**Step 5 — Write failing tests for `handleReceta`** (`f041.receta.test.ts`)

Write tests (all failing) that verify:

*Input guards (no API call):*
- Empty args → returns string containing `/receta` usage hint, `calculateRecipe` not called
- Whitespace-only args → same as empty
- Args length > 2000 chars → returns message containing `2000`, `calculateRecipe` not called

*Rate limiting (mock Redis):*
- First request: `redis.incr` called with key `fxp:receta:hourly:<chatId>`, returns `1` → proceeds normally
- Sixth request within window: `redis.incr` returns `6` → returns message containing `límite`
- Redis `incr` throws → fails open (proceeds to API call), no error returned to user

*Happy path:*
- Returns output of `formatRecipeResult` (check for `*Resultado de la receta*`)
- `calculateRecipe` called with trimmed args

*Error mapping:*
- `ApiError(422, 'RECIPE_UNRESOLVABLE')` → message contains `ningún ingrediente`
- `ApiError(422, 'FREE_FORM_PARSE_FAILED')` → message contains `200g pollo`
- `ApiError(429, 'RATE_LIMIT')` → delegates to `handleApiError`, message contains `Demasiadas consultas`
- `ApiError(408, 'TIMEOUT')` → message contains `tardo demasiado`
- `ApiError(500, 'SERVER_ERROR')` → message contains `no esta disponible`
- `ApiError(0, 'NETWORK_ERROR')` → message contains `conectar`

Use `makeMockRedis()` pattern from `f032.restaurante.test.ts`:
```
function makeMockRedis() {
  return { incr: vi.fn(), expire: vi.fn() } as unknown as Redis;
}
```
Mock `calculateRecipe` on a `MockApiClient` object (same structure as `commands.test.ts`).

**Step 6 — Implement `commands/receta.ts`** (make Step 5 tests pass)

File: `packages/bot/src/commands/receta.ts`

```typescript
// /receta <ingredientes> command handler (F041).
import type { Redis } from 'ioredis';
import type { ApiClient } from '../apiClient.js';
import { ApiError } from '../apiClient.js';
import { handleApiError } from './errorMessages.js';
import { formatRecipeResult } from '../formatters/recipeFormatter.js';
import { logger } from '../logger.js';
```

- Constants: `RATE_LIMIT_MAX = 5`, `RATE_LIMIT_TTL_SECONDS = 3600`, `RATE_LIMIT_KEY_PREFIX = 'fxp:receta:hourly:'`.
- Private `isRateLimited(redis: Redis, chatId: number): Promise<boolean>` — exact same logic as `callbackQuery.ts`: incr key, set expire on count === 1, return `count > RATE_LIMIT_MAX`. Fail-open (catch → return `false`).
- Private `handleRecipeError(err: unknown): string` — checks `err instanceof ApiError` and maps `RECIPE_UNRESOLVABLE` and `FREE_FORM_PARSE_FAILED` codes before delegating to `handleApiError(err)`.
- `export async function handleReceta(args: string, chatId: number, apiClient: ApiClient, redis: Redis): Promise<string>`:
  1. `const trimmed = args.trim(); if (!trimmed) return usageHint;`
  2. `if (trimmed.length > 2000) return lengthErrorMessage;`
  3. `const limited = await isRateLimited(redis, chatId); if (limited) return rateLimitMessage;`
  4. `try { const data = await apiClient.calculateRecipe(trimmed); return formatRecipeResult(data); } catch (err) { logger.warn({ err, text: trimmed }, '/receta API error'); return handleRecipeError(err); }`

All user-facing string literals must be pre-escaped MarkdownV2 (backslash-escape all reserved chars). Prefer writing them as template literals with `\\.` etc.

**Step 7 — Update `start.ts` and verify test** (update `commands.test.ts` for `handleStart`)

In `packages/bot/src/commands/start.ts`, insert the `/receta` entry into the command list. Suggested position: after `/estimar` line, before `/restaurantes`:
```
'/receta \\<ingredientes\\> — Calcula la informacion nutricional de una receta',
```

In `packages/bot/src/__tests__/commands.test.ts`, add a new assertion inside the `handleStart` describe block:
```typescript
it('contains /receta', () => {
  expect(handleStart()).toContain('/receta');
});
```

**Step 8 — Register `/receta` in `bot.ts`** and update `bot.test.ts`

In `packages/bot/src/bot.ts`:
1. Import: `import { handleReceta } from './commands/receta.js';`
2. Add `'receta'` to `KNOWN_COMMANDS`.
3. Wire the handler directly (after the `/restaurante` block, before the callback_query handler):

```typescript
// /receta is wired directly (not through wrapHandler) because it needs
// chatId and redis for per-user rate limiting — same pattern as /restaurante.
bot.onText(
  /^\/receta(?:@\w+)?(?:\s+(.+))?$/s,
  async (msg, match) => {
    try {
      const text = await handleReceta(match?.[1] ?? '', msg.chat.id, apiClient, redis);
      await send(msg.chat.id, text);
    } catch (err) {
      logger.error({ err, chatId: msg.chat.id }, 'Unhandled /receta error');
      try {
        await send(msg.chat.id, escapeMarkdown('Lo siento, ha ocurrido un error inesperado.'));
      } catch {
        // ignore send failure
      }
    }
  },
);
```

In `packages/bot/src/__tests__/bot.test.ts`, add `calculateRecipe: vi.fn()` to `makeMockClient()`, update the `onText` call count assertion from 9 to 10, and add tests: (1) verifying `'receta'` is in `KNOWN_COMMANDS`, (2) verifying the `/receta` regex matches multiline input like `"/receta 200g pollo\n100g arroz"` (validates the `s` dotAll flag).

---

### Testing Strategy

**Test files to create:**

| File | Tests |
|------|-------|
| `packages/bot/src/__tests__/f041.apiClient.test.ts` | `calculateRecipe` happy path, error propagation, timeout param, URL/method/headers assertions |
| `packages/bot/src/__tests__/f041.recipeFormatter.test.ts` | Formatting correctness, optional nutrient visibility, truncation, name resolution, portionMultiplier display, confidence mapping, unresolved list |
| `packages/bot/src/__tests__/f041.receta.test.ts` | Input guards, rate limit (pass/block/fail-open), happy path, all recipe-specific error codes, delegation to `handleApiError` |

**Mocking strategy:**
- `apiClient.ts` tests: `vi.stubGlobal('fetch', fetchMock)` — no real HTTP. Pattern: `f034.apiClient.test.ts`.
- `recipeFormatter.ts` tests: no mocks needed — pure function, pass plain object fixtures. Pattern: `formatters.test.ts`.
- `receta.ts` tests: inject `MockApiClient` object + `makeMockRedis()` object. No module-level mocks needed. Pattern: `f032.restaurante.test.ts`.

**Key test scenarios:**

- Formatter: 50-ingredient fixture with very long names → output ≤ 4000 chars and `_Lista recortada_` present; header and confidence always visible.
- Formatter: `portionMultiplier = 0.5` → `(x0\.5)` in output; `portionMultiplier = 1.0` → no suffix.
- Formatter: all `totalNutrients` fields null → mandatory rows (calories, proteins, carbs, fats) absent; no null-dereference crash.
- Handler: `redis.incr` returns exactly 5 → request proceeds (not limited); returns 6 → limited.
- Handler: `redis.incr` rejects → `calculateRecipe` is still called (fail-open verified via mock assertion).
- Handler: `ApiError(422, 'RECIPE_UNRESOLVABLE')` → does NOT delegate to generic "error inesperado"; checks specific message.

---

### Key Patterns

- **Direct wiring (not `wrapHandler`):** `handleReceta` needs `chatId` + `redis`. Follow the exact `/restaurante` wiring block in `bot.ts` (lines 97–111 in current file). The handler returns `Promise<string>` (not void), so `send()` is called in `bot.ts`.
- **Rate limit key naming:** `fxp:receta:hourly:<chatId>` — consistent with `fxp:analyze:bot:<chatId>` in `callbackQuery.ts`. Include `hourly` in the key to make it self-documenting.
- **`postJson` timeout override:** The 4th arg is added to `postJson` only. `postFormData` keeps its hard-coded `UPLOAD_TIMEOUT_MS`. All existing callers (`createRestaurant`, `estimate` internal note: `estimate` uses `fetchJson` not `postJson`) pass no 4th arg and get the default — fully backward-compatible.
- **MarkdownV2 escaping:** Rate limit message, length error message, and usage hint are pre-composed string literals with manual escaping (backslash before `.`, `<`, `>`). Dynamic values (ingredient names, nutrient values) go through `escapeMarkdown()` or `formatNutrient()`.
- **`s` (dotAll) regex flag on `/receta`:** Required so that Shift+Enter newlines inside the ingredient list are captured into match group 1. No other command uses this. Verify by checking that `\n` inside group 1 is not stripped by the regex.
- **Truncation — ingredient section only:** Do NOT call `truncate(fullMessage, 4000)`. Build header, ingredientSection, and footer separately. Reduce ingredientSection until `header + reducedSection + footer` fits in 4000. Append `\n\\.\\.\\. y X ingredientes más` where X is the number of dropped ingredient lines.
- **`CONFIDENCE_MAP` duplication:** The map is intentionally copied into `recipeFormatter.ts` rather than imported from `estimateFormatter.ts`. This avoids a dependency between two peer formatter files and keeps each formatter self-contained.
- **Nullable nutrients in `RecipeNutrients`:** Unlike `EstimateNutrients` (all non-null), `RecipeNutrients` has all fields nullable. Always null-check before calling `formatNutrient`; never pass `null` to it.

---

## Acceptance Criteria

- [x] `/receta` with no args returns a usage hint containing the format example
- [x] `/receta 200g pollo, 100g arroz` returns a formatted MarkdownV2 card with total calories, proteins, carbs, fats
- [x] Per-ingredient breakdown lists each resolved ingredient with its own calories and proteins
- [x] Unresolved ingredients are listed under `*No resueltos:*` when present
- [x] Confidence level shown as `media` or `baja` in Spanish (F035 only returns `medium`/`low`; `alta` mapped but not expected)
- [x] `RECIPE_UNRESOLVABLE` error yields a clear Spanish user message
- [x] `FREE_FORM_PARSE_FAILED` error yields a clear Spanish user message
- [x] Input > 2000 chars rejected with friendly message before API call
- [x] Bot-level rate limit (5/hr per chatId) prevents abuse; fail-open on Redis error
- [x] `receta` is present in `KNOWN_COMMANDS` (unknown-command catch-all does not fire for `/receta`)
- [x] `/start` and `/help` text updated to include `/receta` command
- [x] Multi-line ingredient text (newline-separated) is captured correctly by the regex
- [x] Output never exceeds 4096 Telegram characters (truncation in ingredient list only, totals/confidence always shown)
- [x] `portionMultiplier` shown when not 1.0 to avoid misleading grams display
- [x] All user-facing strings are in Spanish
- [x] All dynamic strings are escaped via `escapeMarkdown()`
- [x] Unit tests cover: empty args, successful result formatting, partial resolution, all error codes, input length, rate limit (100 tests across 4 files (74 implementation + 26 QA))

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing (621 total bot tests)
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds
- [x] Specs reflect final implementation (no API changes needed)

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` executed, plan approved
- [x] Step 3: `backend-developer` executed with TDD
- [x] Step 4: `production-code-validator` executed, quality gates pass
- [x] Step 5: `code-review-specialist` executed — APPROVED (2M fixed: dead variable, non-null assertion)
- [x] Step 5: `qa-engineer` executed — VERIFIED (0 bugs, 26 edge-case tests)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-27 | Spec drafted | spec-creator + self-review. Fixed: timeout 10s→30s, nullable nutrients handling, typo "Italian"→"Spanish" |
| 2026-03-27 | Spec reviewed | Gemini 2.5 + Codex GPT-5.4. 1C+2I+1S (Gemini) + 3I+2S (Codex). 6 issues addressed: bot rate limit (5/hr per chatId), input length guard (2000 chars), portionMultiplier display, smart truncation (ingredient list only), timeout consistency (30s), /help text update |
| 2026-03-27 | Plan written + reviewed | backend-planner agent. Reviewed by Gemini (2I+1S) + Codex (3I+1S). 6 issues fixed: truncation suffix standardized, wrapHandler→direct wiring, onText count 9→10, mock sweep (all test files), null nutrient field placeholder, multiline regex test |
| 2026-03-27 | Implementation | backend-developer agent. 74 tests (3 files). TDD 8 steps. |
| 2026-03-27 | Finalize | Tests 621 pass, lint clean, build OK. Production validator: READY (0 issues) |
| 2026-03-27 | Code review | code-review-specialist: APPROVED. 2M fixed (dead variable, non-null assertion). 0C 0H found |
| 2026-03-27 | QA | qa-engineer: VERIFIED. 0 bugs. 26 edge-case tests added (f041.qa-edge-cases.test.ts). 621 total |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Implementation Plan, AC, DoD, Workflow, Completion Log, Merge Checklist Evidence |
| 1. Mark all items | [x] | AC: 17/17, DoD: 6/6, Workflow: 7/8 (Step 6 pending) |
| 2. Verify product tracker | [x] | Active Session: step 5/6, Features table: 5/6 |
| 3. Update key_facts.md | [x] | Updated: bot wiring (10 handlers), recipe command section, test count (621) |
| 4. Update decisions.md | [x] | N/A — no ADR needed (Standard feature) |
| 5. Commit documentation | [x] | Commit: 7ead0ec |
| 6. Verify clean working tree | [x] | `git status`: clean |

---

*Ticket created: 2026-03-27*
