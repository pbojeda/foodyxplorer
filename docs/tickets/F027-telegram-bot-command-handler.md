# F027: Telegram Bot — Command Handler

**Feature:** F027 | **Type:** Backend-Feature | **Priority:** High
**Status:** In Progress | **Branch:** feature/F027-telegram-bot-command-handler
**Created:** 2026-03-20 | **Dependencies:** F025 (catalog endpoints), F026 (API auth)

---

## Spec

### Description

F027 implements the `packages/bot` Telegram bot as a standalone Node.js process. The bot
responds to eight structured slash commands that map 1-to-1 onto existing API endpoints.
It is a pure HTTP consumer: it never touches the database directly. All data flows through
`packages/api` via `X-API-Key`-authenticated GET requests.

The bot runs in **polling mode** (not webhooks). This is Phase 1 only — simpler deployment,
no public URL required, adequate for a single-instance process. The API key used by the bot
is pre-created by the existing `seedApiKey.ts` script with `tier: 'free'` (100 req/15min).

All user-visible text is in **Spanish**. Telegram responses use **MarkdownV2** formatting
for rich display (bold dish names, code-formatted nutrient values). Error messages shown to
users are friendly and in Spanish; technical details are only in the bot process logs (Pino).

F027 scope is strictly slash commands — no natural language, no conversation state,
no inline queries. F028 will add the NLP layer on top.

### Architecture Decisions

1. **Bot is a separate process, never embedded in Fastify.** `packages/bot/src/index.ts`
   is the sole entry point. It starts polling independently. There is no shared HTTP port.
   The API server (`packages/api`) must be running for the bot to function.

2. **HTTP client: native `fetch` (Node.js 18+).** No extra library needed. All API calls
   use `fetch` with the `X-API-Key` header. A thin `apiClient.ts` module wraps fetch,
   attaches the key, handles non-2xx responses uniformly, and parses the `{ success, data }`
   envelope.

3. **Dependency injection for testability.** `buildBot(config, apiClient)` receives an
   `ApiClient` interface. Tests inject a mock implementation — no real HTTP in unit tests.
   This mirrors the `buildApp(config?)` pattern in `packages/api`.

4. **Config validation at startup with Zod, process exits on failure.** Same pattern as
   all other packages. New file: `packages/bot/src/config.ts`.

5. **MarkdownV2 escaping is mandatory.** A pure utility function `escapeMarkdown(text)`
   handles all reserved chars. Failure to escape causes Telegram to silently drop the message.

6. **Polling error handling with auto-restart.** `polling_error` events are logged at
   `warn` level. The bot does NOT crash on polling errors. Only exits on `SIGTERM`/`SIGINT`.

7. **Graceful shutdown.** On `SIGTERM`/`SIGINT`: `bot.stopPolling()`, flush logs, exit(0).

8. **Pagination: first page only in F027.** Paginated commands return `pageSize=10`.
   A text hint shows "Mostrando X de Y" when results are truncated. No `página N` parsing
   in F027 — deferred to F028.

9. **`/estimar` returns the full nutrient breakdown inline.** Compact table with kcal,
   protein, carbs, fat. Additional micronutrients shown if non-null. Confidence as footnote.

10. **No API endpoint changes.** `api-spec.yaml` is not modified by F027.

### File Structure

```
packages/bot/src/
├── index.ts                  # Entry point: wires config → apiClient → bot → starts polling
├── config.ts                 # Zod env schema + parseConfig() — exits on failure
├── bot.ts                    # buildBot(config, apiClient): TelegramBot — registers all handlers
├── apiClient.ts              # ApiClient interface + createApiClient(config) — wraps fetch
├── commands/
│   ├── start.ts              # /start + /help handler
│   ├── buscar.ts             # /buscar <dish>
│   ├── estimar.ts            # /estimar <dish>
│   ├── restaurantes.ts       # /restaurantes [chain]
│   ├── platos.ts             # /platos <restaurantId>
│   ├── cadenas.ts            # /cadenas
│   └── info.ts               # /info
├── formatters/
│   ├── estimateFormatter.ts  # EstimateData → MarkdownV2 string
│   ├── dishFormatter.ts      # DishListItem[] → MarkdownV2 string
│   ├── restaurantFormatter.ts# RestaurantListItem[] → MarkdownV2 string
│   ├── chainFormatter.ts     # ChainListItem[] → MarkdownV2 string
│   └── markdownUtils.ts      # escapeMarkdown(), truncate(), formatNutrient()
└── logger.ts                 # Pino instance
```

### Config Schema

```
BotEnvSchema (Zod)
  TELEGRAM_BOT_TOKEN: z.string().min(1)
  API_BASE_URL:       z.string().url().default('http://localhost:3001')
  BOT_API_KEY:        z.string().min(1)
  BOT_VERSION:        z.string().default('0.1.0')
  LOG_LEVEL:          z.enum(['trace','debug','info','warn','error']).default('info')
  NODE_ENV:           z.enum(['development','production','test']).default('development')
```

### API Endpoints Consumed

Bot sends all requests with `X-API-Key: <BOT_API_KEY>` header. Rate limit: free tier = 100 req/15min.

| Command | Endpoint | Key Params |
|---------|----------|------------|
| `/buscar <dish>` | `GET /dishes/search` | `q=<dish>`, `page=1`, `pageSize=10` |
| `/estimar <dish>` | `GET /estimate` | `query=<dish>` |
| `/estimar <dish> en <chain>` | `GET /estimate` | `query=<dish>`, `chainSlug=<slug>` |
| `/restaurantes [chain]` | `GET /restaurants` | `chainSlug=<slug>`, `page=1`, `pageSize=10` |
| `/platos <id>` | `GET /restaurants/:id/dishes` | `page=1`, `pageSize=10` |
| `/cadenas` | `GET /chains` | _(none)_ |
| `/info` | `GET /health` | _(optional live check)_ |

### Command Specifications

#### `/start` and `/help`
Static welcome message listing all commands. No API call.

#### `/buscar <dish>`
Searches dishes globally. Validation: at least one word after command. Shows dish cards with name, restaurant, chainSlug, ID. Pagination footer when totalItems > 10.

#### `/estimar <dish> [en <chainSlug>]`
Estimates nutritional info. Optional chain scoping via ` en ` suffix — split on LAST occurrence of ` en ` (avoids "pollo en salsa" misparse). Shows kcal, protein, carbs, fat + optional fiber/sugar/sodium. Confidence level as footnote.

#### `/restaurantes [chainSlug]`
Lists restaurants. Optional chainSlug filter. Shows name, chain, country, dish count, ID.

#### `/platos <restaurantId>`
Lists dishes for a specific restaurant. Validates UUID format. Shows compact dish list.

#### `/cadenas`
Lists all active chains. Shows name, slug, dish count, country.

#### `/info`
Shows bot version + live API health check (tolerates failure → shows "Sin conexion").

### ApiClient Interface

```typescript
interface ApiClient {
  searchDishes(params: { q: string; page?: number; pageSize?: number }): Promise<PaginatedResult<DishListItem>>
  estimate(params: { query: string; chainSlug?: string }): Promise<EstimateData>
  listRestaurants(params: { chainSlug?: string; page?: number; pageSize?: number }): Promise<PaginatedResult<RestaurantListItem>>
  listRestaurantDishes(restaurantId: string, params: { page?: number; pageSize?: number }): Promise<PaginatedResult<DishListItem>>
  listChains(): Promise<ChainListItem[]>
  healthCheck(): Promise<boolean>
}

interface PaginatedResult<T> {
  items: T[]
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number }
}
```

Types imported from `@foodxplorer/shared`. `createApiClient(config): ApiClient` wraps native `fetch`. Non-2xx throws typed `ApiError` with `.statusCode` and `.code`. 10s timeout via `AbortController`.

### Edge Cases & Error Handling

1. Missing command arguments → usage hint, no API call
2. `/platos <valid-uuid-not-in-db>` → 404 → "No se encontro ningun restaurante con ese ID"
3. `/estimar` all levels miss → 200 with all hits false → "No se encontraron datos nutricionales"
4. `/estimar big mac en mcdonalds-es` — split on LAST ` en ` to avoid "pollo en salsa" misparse
5. Unknown chainSlug → empty results → chain-specific "not found" message
6. 429 rate limit → "Demasiadas consultas. Espera un momento"
7. 401/403 → "Error de configuracion del bot" + CRITICAL log
8. 5xx → "El servicio no esta disponible"
9. Timeout (10s) → "La consulta tardo demasiado"
10. Network error → "No se puede conectar con el servidor"
11. MarkdownV2 reserved chars in dish names → `escapeMarkdown()` on all user-sourced strings
12. Response > 4096 chars → truncate at last complete card + "lista recortada" note
13. `polling_error` from Telegram → log warn, continue polling
14. Missing env vars → process exit non-zero with clear error naming the missing var
15. Unrecognized `/command` → "Comando no reconocido. Usa /help"

### Data Model Changes

None. No DB migrations, no new Prisma models, no new shared schemas.

### New Dependencies (to add to existing package.json)

| Package | Type | Purpose |
|---------|------|---------|
| `zod` | dependency | Config validation |
| `pino` | dependency | Structured logging |
| `pino-pretty` | devDependency | Human-readable dev logs |

---

## Implementation Plan

### Existing Code to Reuse

- **`packages/api/src/config.ts`** — reference implementation for the `BotEnvSchema` + `parseConfig()` pattern (Zod safeParse, process.exit(1) on failure, singleton export)
- **`packages/scraper/src/config.ts`** — secondary config reference showing the same pattern with a different schema name (`ScraperEnvSchema`)
- **`packages/shared`** — types imported directly by bot:
  - `DishListItem`, `DishListItemSchema` from `@foodxplorer/shared`
  - `RestaurantListItem`, `RestaurantListItemSchema` from `@foodxplorer/shared`
  - `ChainListItem`, `ChainListItemSchema` from `@foodxplorer/shared`
  - `EstimateData`, `EstimateDataSchema` from `@foodxplorer/shared`
  - `PaginationMeta` from `@foodxplorer/shared`
- **`packages/api/src/__tests__/config.test.ts`** — reference test structure for config unit tests (process.exit spy pattern, `beforeAll` dynamic import, `VALID_ENV` fixture)
- **`packages/api/vitest.config.ts`** — reference for writing the bot's `vitest.config.ts` (alias resolution, env overrides)

---

### Files to Create

```
packages/bot/vitest.config.ts              — Vitest config: alias @foodxplorer/shared, env overrides for BotEnvSchema defaults
packages/bot/src/logger.ts                 — Pino logger instance (log level from config; pretty transport in dev/test)
packages/bot/src/config.ts                 — BotEnvSchema + parseConfig() + singleton config export
packages/bot/src/apiClient.ts              — ApiClient interface, PaginatedResult<T>, ApiError class, createApiClient()
packages/bot/src/formatters/markdownUtils.ts     — escapeMarkdown(), truncate(), formatNutrient()
packages/bot/src/formatters/dishFormatter.ts     — formatDishList(items, pagination) → MarkdownV2 string
packages/bot/src/formatters/restaurantFormatter.ts — formatRestaurantList(items, pagination) → MarkdownV2 string
packages/bot/src/formatters/chainFormatter.ts    — formatChainList(items) → MarkdownV2 string
packages/bot/src/formatters/estimateFormatter.ts — formatEstimate(data) → MarkdownV2 string
packages/bot/src/commands/start.ts         — handleStart() → static MarkdownV2 welcome string
packages/bot/src/commands/buscar.ts        — handleBuscar(args, apiClient) → Promise<string>
packages/bot/src/commands/estimar.ts       — handleEstimar(args, apiClient) → Promise<string>
packages/bot/src/commands/restaurantes.ts  — handleRestaurantes(args, apiClient) → Promise<string>
packages/bot/src/commands/platos.ts        — handlePlatos(args, apiClient) → Promise<string>
packages/bot/src/commands/cadenas.ts       — handleCadenas(apiClient) → Promise<string>
packages/bot/src/commands/info.ts          — handleInfo(config, apiClient) → Promise<string>
packages/bot/src/commands/errorMessages.ts — handleApiError(err) → string (shared error-to-Spanish mapping)
packages/bot/src/bot.ts                    — buildBot(config, apiClient): TelegramBot — wires all command handlers
packages/bot/src/__tests__/config.test.ts          — Unit tests for BotEnvSchema + parseConfig()
packages/bot/src/__tests__/markdownUtils.test.ts   — Unit tests for escapeMarkdown(), truncate(), formatNutrient()
packages/bot/src/__tests__/formatters.test.ts      — Unit tests for all four formatters
packages/bot/src/__tests__/commands.test.ts        — Unit tests for all command handlers (mock ApiClient)
packages/bot/src/__tests__/bot.test.ts             — Integration-style unit tests for buildBot() wiring
```

---

### Files to Modify

- **`packages/bot/package.json`** — add `zod` and `pino` to `dependencies`; add `pino-pretty` to `devDependencies`
- **`packages/bot/src/index.ts`** — replace placeholder with: `parseConfig` → `createLogger` → `createApiClient` → `buildBot` → `bot.startPolling()` → graceful shutdown handlers

---

### Implementation Order

Follow the dependency graph strictly. Each step begins with a failing test (Red), then minimal implementation (Green), then cleanup (Refactor).

#### Step 1 — Install missing dependencies

Modify `packages/bot/package.json` to add `zod`, `pino` (dependencies) and `pino-pretty` (devDependency). Run `npm install` from the workspace root. No test needed — verified implicitly when Step 2 imports `zod`.

#### Step 2 — `vitest.config.ts` + `logger.ts`

**Create `packages/bot/vitest.config.ts`.**
Mirror `packages/api/vitest.config.ts`. Set the `@foodxplorer/shared` alias to `../shared/src`. In `test.env` provide the six BotEnvSchema defaults so config.ts does not exit when imported during tests:
```
TELEGRAM_BOT_TOKEN=test-token
API_BASE_URL=http://localhost:3001
BOT_API_KEY=test-bot-api-key
NODE_ENV=test
LOG_LEVEL=info
BOT_VERSION=0.0.0
```

**Create `packages/bot/src/logger.ts`.**
Export a Pino instance. In `NODE_ENV === 'development'` or `'test'` use the `pino-pretty` transport (as a `transport` option). Bind `level` from the config singleton only at runtime (lazy) or accept level as a parameter — prefer exporting a factory `createLogger(level)` that tests can call directly without hitting the singleton. The singleton `logger` export calls `createLogger(config.LOG_LEVEL)`.

No dedicated test file for logger — it is exercised indirectly by downstream tests.

#### Step 3 — `config.ts`

**TDD cycle:**

*Red* — Create `packages/bot/src/__tests__/config.test.ts`. Follow `packages/api/src/__tests__/config.test.ts` exactly:
- Install `process.exit` spy before importing the module
- Load `parseConfig` via dynamic import inside `beforeAll`
- Define `VALID_BOT_ENV` constant with all six required fields

Test cases:
- Parses valid env, all fields correctly typed
- Defaults `API_BASE_URL` to `'http://localhost:3001'` when absent
- Defaults `BOT_VERSION` to `'0.1.0'` when absent
- Defaults `LOG_LEVEL` to `'info'` when absent
- Defaults `NODE_ENV` to `'development'` when absent
- Accepts all valid `LOG_LEVEL` values: `trace|debug|info|warn|error`
- Rejects invalid `LOG_LEVEL` → `process.exit(1)`
- Rejects missing `TELEGRAM_BOT_TOKEN` → `process.exit(1)`
- Rejects empty `TELEGRAM_BOT_TOKEN` (`min(1)`) → `process.exit(1)`
- Rejects missing `BOT_API_KEY` → `process.exit(1)`
- Rejects empty `BOT_API_KEY` (`min(1)`) → `process.exit(1)`
- Rejects invalid `API_BASE_URL` (non-URL string) → `process.exit(1)`
- Rejects invalid `NODE_ENV` value → `process.exit(1)`

*Green* — Create `packages/bot/src/config.ts`:
```typescript
export const BotEnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  API_BASE_URL:       z.string().url().default('http://localhost:3001'),
  BOT_API_KEY:        z.string().min(1),
  BOT_VERSION:        z.string().default('0.1.0'),
  LOG_LEVEL:          z.enum(['trace','debug','info','warn','error']).default('info'),
  NODE_ENV:           z.enum(['development','production','test']).default('development'),
});
export type BotConfig = z.infer<typeof BotEnvSchema>;
export function parseConfig(env: NodeJS.ProcessEnv): BotConfig { ... }
export const config: BotConfig = parseConfig(process.env);
```
Use `[bot:config]` prefix in the error message (mirrors scraper pattern).

#### Step 4 — `apiClient.ts`

**TDD cycle:**

*Red* — Create `packages/bot/src/__tests__/apiClient.test.ts` (can be merged into `commands.test.ts` if preferred, but keep isolated here for clarity).

The `ApiClient` interface and `ApiError` class are pure TypeScript — test `ApiError` construction and property access:
- `new ApiError(404, 'NOT_FOUND', 'not found')` exposes `.statusCode`, `.code`, `.message`
- `createApiClient(config)` returns an object that satisfies the `ApiClient` interface shape (type-level check)

For `createApiClient` runtime behavior: use `vi.stubGlobal('fetch', ...)` to mock the global `fetch`. Test:
- Happy path: fetch returns `{ success: true, data: [...] }` → method returns parsed data
- Non-2xx response (e.g. 404) → throws `ApiError` with correct `statusCode` and `code`
- 429 response → throws `ApiError` with `statusCode: 429`
- Timeout (simulate `AbortError`) → throws `ApiError` with code `'TIMEOUT'`
- Network error (fetch rejects) → throws `ApiError` with code `'NETWORK_ERROR'`
- `healthCheck()` on 200 → returns `true` (does NOT parse `{ success, data }` envelope — `/health` returns `{ status, timestamp }` directly)
- `healthCheck()` on non-2xx → returns `false` (does not throw)
- `healthCheck()` on network error → returns `false` (does not throw)
- `listChains()` always sends `?isActive=true` query param

*Green* — Create `packages/bot/src/apiClient.ts`:

```typescript
export interface PaginatedResult<T> {
  items: T[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
}

export interface ApiClient {
  searchDishes(params: { q: string; page?: number; pageSize?: number }): Promise<PaginatedResult<DishListItem>>;
  estimate(params: { query: string; chainSlug?: string }): Promise<EstimateData>;
  listRestaurants(params: { chainSlug?: string; page?: number; pageSize?: number }): Promise<PaginatedResult<RestaurantListItem>>;
  listRestaurantDishes(restaurantId: string, params: { page?: number; pageSize?: number }): Promise<PaginatedResult<DishListItem>>;
  listChains(): Promise<ChainListItem[]>;
  healthCheck(): Promise<boolean>;
}

export class ApiError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}
```

`createApiClient(config: BotConfig): ApiClient` — private `fetchJson<T>` helper:
1. Creates `AbortController`, sets 10s timeout via `setTimeout`
2. Calls `fetch(url, { headers: { 'X-API-Key': config.BOT_API_KEY }, signal })`
3. On `AbortError` → throws `new ApiError(408, 'TIMEOUT', '...')`
4. On network error (catch) → throws `new ApiError(0, 'NETWORK_ERROR', '...')`
5. On non-2xx status → reads body, throws `new ApiError(res.status, code, message)`
6. Parses JSON, returns `data` field from `{ success, data }` envelope

For `estimate()`: the API always returns 200 with the full `EstimateData` object (even when `result === null` and all hit flags false). The return type is `Promise<EstimateData>` (never null). The caller checks `data.result === null` to decide whether to show "no data". This keeps the client dumb. Document this in JSDoc.

For `healthCheck()`: `GET /health` does NOT use the standard `{ success, data }` envelope — it returns `{ status, timestamp, version, uptime }` directly. Do NOT route through the generic `fetchJson` parser. Instead, treat any 2xx as `true`, anything else as `false`. Wrap in try/catch — never throw.

For `listChains()`: always pass `?isActive=true` to `GET /chains` so the bot only shows active chains (spec: "Lists all active chains").

URL construction: use `new URL(path, config.API_BASE_URL)` and append query params via `url.searchParams.set(...)`.

#### Step 5 — `formatters/markdownUtils.ts`

**TDD cycle:**

*Red* — Create `packages/bot/src/__tests__/markdownUtils.test.ts`.

Test `escapeMarkdown(text: string): string`:
- Empty string → `''`
- Plain text with no special chars → returned unchanged
- Each MarkdownV2 reserved char individually: `_`, `*`, `[`, `]`, `(`, `)`, `~`, `` ` ``, `>`, `#`, `+`, `-`, `=`, `|`, `{`, `}`, `.`, `!` → each is prefixed with `\`
- String with multiple reserved chars → all escaped
- String with emoji (e.g. `"🍔"`) → returned unchanged (emoji are not reserved)
- String with digits → returned unchanged
- A dish name like `"Big Mac (McDonalds)"` → `"Big Mac \\(McDonalds\\)"`

Test `truncate(text: string, maxLen: number): string`:
- String shorter than `maxLen` → returned as-is
- String exactly `maxLen` chars → returned as-is
- String longer than `maxLen` → truncated; result ends with `\n\n_Lista recortada_`
- Truncation happens at last newline boundary before `maxLen` (not mid-word)

Test `formatNutrient(value: number, unit: string): string`:
- `formatNutrient(563, 'kcal')` → `'563 kcal'`
- `formatNutrient(26.5, 'g')` → `'26\.5 g'` (decimal point escaped for MarkdownV2)
- `formatNutrient(0, 'g')` → `'0 g'`

*Green* — Create `packages/bot/src/formatters/markdownUtils.ts`. Implement the three functions. The list of MarkdownV2 reserved chars to escape (per Telegram docs): `_ * [ ] ( ) ~ \` > # + - = | { } . !`. Use a single regex replace.

#### Step 6 — Formatters

**TDD cycle — one describe block per formatter in `packages/bot/src/__tests__/formatters.test.ts`:**

**`dishFormatter.ts`** — `formatDishList(items: DishListItem[], pagination: PaginationMeta): string`

Tests:
- Empty `items` array → returns `'No se encontraron platos\.'` (escaped period)
- Single item → contains escaped dish name, `restaurantName`, `chainSlug`, `id`
- Multiple items → each item is a separate card separated by a blank line
- `pagination.totalItems > pagination.pageSize` → footer contains `Mostrando 10 de N`
- `pagination.totalItems <= pagination.pageSize` → no footer
- `nameEs` preferred over `name` when non-null
- Result is passed through `truncate(..., 4096)`

**`restaurantFormatter.ts`** — `formatRestaurantList(items: RestaurantListItem[], pagination: PaginationMeta): string`

Tests:
- Empty array → `'No se encontraron restaurantes\.'`
- Single item → contains `name`, `chainSlug`, `countryCode`, `dishCount`, `id`
- Pagination footer when `totalItems > pageSize`
- `nameEs` preferred when non-null

**`chainFormatter.ts`** — `formatChainList(items: ChainListItem[]): string`

Tests:
- Empty array → `'No hay cadenas disponibles\.'`
- Single chain → contains `name`, `chainSlug`, `countryCode`, `dishCount`
- Multiple chains → each is a separate entry
- `nameEs` preferred when non-null

**`estimateFormatter.ts`** — `formatEstimate(data: EstimateData): string`

Tests:
- `data.result === null` → returns `'No se encontraron datos nutricionales para esta consulta\.'`
- Valid result → contains bold dish name (escaped), `kcal`, `proteins`, `carbohydrates`, `fats` values
- Non-zero optional nutrients (`fiber`, `sodium`, `salt`) → shown in output
- Zero optional nutrients → NOT shown (keep output compact)
- `confidenceLevel` shown as footnote (`alta` / `media` / `baja`)
- `chainSlug` in result → shown in output
- `portionGrams` non-null → shown as portion size

All formatters: apply `escapeMarkdown()` to every string that originates from user data or database (dish names, restaurant names, chain names). Do NOT escape pre-composed Markdown syntax chars (bold markers, etc.).

#### Step 7 — Command handlers

**TDD cycle — one file `packages/bot/src/__tests__/commands.test.ts`:**

Declare a typed `MockApiClient` that implements `ApiClient` with `vi.fn()` for each method. Reset mocks in `beforeEach`. Each command test receives the mock as `ApiClient`.

**`start.ts`** — `handleStart(): string`

Tests:
- Returns a non-empty string containing each command name (`/buscar`, `/estimar`, `/restaurantes`, `/platos`, `/cadenas`, `/info`, `/help`)
- Output is static (no API call)
- Contains at least one MarkdownV2 bold marker (`*`)

**`buscar.ts`** — `handleBuscar(args: string, apiClient: ApiClient): Promise<string>`

Tests:
- `args = ''` (empty) → returns usage hint string, no API call made
- `args = '  '` (whitespace only) → same as empty
- Happy path: `apiClient.searchDishes` resolves with items → returns formatted dish list
- Empty results from API → returns no-results message
- `ApiError` with `statusCode === 429` → returns rate-limit message in Spanish
- `ApiError` with `statusCode === 401` → returns config-error message
- `ApiError` with `statusCode >= 500` → returns service-unavailable message
- `ApiError` with `code === 'TIMEOUT'` → returns timeout message
- `ApiError` with `code === 'NETWORK_ERROR'` → returns network-error message
- `apiClient.searchDishes` called with `{ q: args.trim(), page: 1, pageSize: 10 }`

**`estimar.ts`** — `handleEstimar(args: string, apiClient: ApiClient): Promise<string>`

Tests:
- Empty args → usage hint
- `'big mac'` (no ` en `) → `apiClient.estimate` called with `{ query: 'big mac' }`, no `chainSlug`
- `'big mac en mcdonalds-es'` → called with `{ query: 'big mac', chainSlug: 'mcdonalds-es' }`
- `'pollo en salsa en mcdonalds-es'` → splits on LAST ` en `: `query='pollo en salsa'`, `chainSlug='mcdonalds-es'`
- `'pollo en salsa'` — the suffix `'salsa'` does NOT match the chainSlug format (`/^[a-z0-9-]+$/` with at least one hyphen, e.g. `mcdonalds-es`). So the split is rejected and the full string `'pollo en salsa'` is sent as `query` with no `chainSlug`. Test that `apiClient.estimate` is called with `{ query: 'pollo en salsa' }`.
- `'ensalada en mcdonalds-es'` — suffix `'mcdonalds-es'` matches chainSlug format → split succeeds. `{ query: 'ensalada', chainSlug: 'mcdonalds-es' }`.
- Result with `data.result !== null` → returns formatted nutrient card
- Result with `data.result === null` → returns no-data message
- API errors → same mapping as `buscar`

**`restaurantes.ts`** — `handleRestaurantes(args: string, apiClient: ApiClient): Promise<string>`

Tests:
- No args → `apiClient.listRestaurants` called with `{ page: 1, pageSize: 10 }` (no `chainSlug`)
- `args = 'mcdonalds-es'` → called with `{ chainSlug: 'mcdonalds-es', page: 1, pageSize: 10 }`
- Empty results WITH chainSlug filter → chain-specific message: "No se encontraron restaurantes para la cadena «mcdonalds-es». Usa /cadenas para ver cadenas disponibles."
- Empty results WITHOUT filter → generic: "No hay restaurantes registrados todavia."
- API errors → standard error mapping

**`platos.ts`** — `handlePlatos(args: string, apiClient: ApiClient): Promise<string>`

Tests:
- Empty args → usage hint (UUID required)
- Invalid UUID (e.g. `'abc'`) → UUID-format-error message, no API call
- Valid UUID format but 404 from API (`ApiError` with `statusCode === 404`) → not-found message
- Happy path: valid UUID, API returns dishes → formatted dish list
- API errors → standard error mapping

UUID validation: use `z.string().uuid().safeParse(args.trim())` — reuse the Zod import already available.

**`cadenas.ts`** — `handleCadenas(apiClient: ApiClient): Promise<string>`

Tests:
- Happy path: API returns chains → formatted chain list
- Empty results → "No hay cadenas disponibles" message
- API errors → standard error mapping

**`info.ts`** — `handleInfo(config: BotConfig, apiClient: ApiClient): Promise<string>`

Tests:
- `apiClient.healthCheck()` resolves `true` → message contains bot version and "API: conectada" (or equivalent)
- `apiClient.healthCheck()` resolves `false` → message contains "Sin conexion" (or equivalent)
- `apiClient.healthCheck()` rejects (any error) → same as `false` (tolerates failure — no throw)

#### Step 8 — `bot.ts`

**TDD cycle:**

*Red* — Create `packages/bot/src/__tests__/bot.test.ts`.

Approach: use `vi.mock('node-telegram-bot-api')` to mock `TelegramBot`. The mocked constructor returns an object with `onText`, `sendMessage`, and `on` as `vi.fn()`. This tests the wiring without launching a real Telegram connection.

Tests:
- `buildBot(config, mockApiClient)` returns a `TelegramBot` instance
- `bot.onText` is called exactly 8 times (once per command: `/start`, `/help`, `/buscar`, `/estimar`, `/restaurantes`, `/platos`, `/cadenas`, `/info`)
- The regex passed to `onText` for `/buscar` matches both `/buscar big mac` AND `/buscar` alone (no args)
- `bot.on('message', ...)` is registered for the unknown-command catch-all (NOT `onText`)
- When the `/start` handler is triggered (call the registered callback manually), `bot.sendMessage` is called with the correct `chat.id` and `parse_mode: 'MarkdownV2'`
- When the `/buscar` handler is triggered with a message, `mockApiClient.searchDishes` is called and `bot.sendMessage` is called with the result
- When a command handler throws unexpectedly (mock throws), `bot.sendMessage` is called with a generic error message (not a crash)
- `bot.on('polling_error', ...)` is registered

*Green* — Create `packages/bot/src/bot.ts`:

```typescript
export function buildBot(config: BotConfig, apiClient: ApiClient): TelegramBot {
  const bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: false });

  const send = async (chatId: number, text: string) => {
    await bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
  };

  const wrapHandler = (handler: () => Promise<string>) => async (msg: Message) => {
    try {
      const text = await handler();
      await send(msg.chat.id, text);
    } catch (err) {
      logger.error({ err }, 'Unhandled command error');
      await send(msg.chat.id, escapeMarkdown('Lo siento, ha ocurrido un error inesperado.'));
    }
  };

  // Regex patterns: anchored with ^ and $, optional @botname suffix for group chats.
  // Commands with args use optional capture groups so the handler fires even without args.
  bot.onText(/^\/start(?:@\w+)?$/, wrapHandler(() => Promise.resolve(handleStart())));
  bot.onText(/^\/help(?:@\w+)?$/, wrapHandler(() => Promise.resolve(handleStart())));
  bot.onText(/^\/buscar(?:@\w+)?(?:\s+(.+))?$/, (msg, match) => wrapHandler(() => handleBuscar(match?.[1] ?? '', apiClient))(msg));
  bot.onText(/^\/estimar(?:@\w+)?(?:\s+(.+))?$/, (msg, match) => wrapHandler(() => handleEstimar(match?.[1] ?? '', apiClient))(msg));
  bot.onText(/^\/restaurantes(?:@\w+)?(?:\s+(.+))?$/, (msg, match) => wrapHandler(() => handleRestaurantes(match?.[1] ?? '', apiClient))(msg));
  bot.onText(/^\/platos(?:@\w+)?(?:\s+(.+))?$/, (msg, match) => wrapHandler(() => handlePlatos(match?.[1] ?? '', apiClient))(msg));
  bot.onText(/^\/cadenas(?:@\w+)?$/, wrapHandler(() => handleCadenas(apiClient)));
  bot.onText(/^\/info(?:@\w+)?$/, wrapHandler(() => handleInfo(config, apiClient)));

  bot.on('polling_error', (err) => logger.warn({ err }, 'Telegram polling error'));

  // Unknown commands: use bot.on('message') instead of onText catch-all.
  // node-telegram-bot-api fires ALL matching onText handlers, so a catch-all
  // /\/(\w+)/ would fire alongside the specific handler → double messages.
  // Instead, use 'message' event with a manual check:
  const KNOWN_COMMANDS = new Set(['start','help','buscar','estimar','restaurantes','platos','cadenas','info']);
  bot.on('message', (msg) => {
    const text = msg.text ?? '';
    const cmdMatch = /^\/(\w+)/.exec(text);
    if (cmdMatch && !KNOWN_COMMANDS.has(cmdMatch[1] ?? '')) {
      void send(msg.chat.id, escapeMarkdown('Comando no reconocido. Usa /help para ver los comandos disponibles.'));
    }
  });

  return bot;
}
```

Note: `TelegramBot` is constructed with `{ polling: false }` in `buildBot`. Polling is started externally in `index.ts` via `bot.startPolling()`. This keeps `buildBot` side-effect-free for tests.

**IMPORTANT — regex pattern for commands with args:** Use `/\/cmd(?:\s+(.+))?$/` (optional non-capturing group) instead of `/\/cmd (.+)/` (required space + chars). The latter won't match `/cmd` alone (no args), so the handler never fires to show the usage hint. The `$` anchor prevents partial matches.

#### Step 9 — `index.ts` entry point

**No separate test file** — this is the process entry point. It is tested implicitly via manual smoke testing or an e2e run.

Replace `packages/bot/src/index.ts` with:
1. Import `parseConfig` — call it with `process.env`, assign to `config`
2. Import `createLogger` — create `logger` with `config.LOG_LEVEL`
3. Import `createApiClient` — create `apiClient`
4. Import `buildBot` — create `bot = buildBot(config, apiClient)`
5. Start polling: `bot.startPolling()`
6. Log startup: `logger.info({ version: config.BOT_VERSION }, 'Bot started')`
7. Register graceful shutdown:
   ```typescript
   const shutdown = async (signal: string) => {
     logger.info({ signal }, 'Shutting down');
     await bot.stopPolling();
     // Flush Pino transport buffers before exit to avoid lost log lines
     const destination = logger[Symbol.for('pino.serializers')] ? undefined : (logger as any)[Symbol.for('pino.stream')];
     if (destination?.flushSync) destination.flushSync();
     process.exit(0);
   };
   process.on('SIGTERM', () => shutdown('SIGTERM'));
   process.on('SIGINT',  () => shutdown('SIGINT'));
   ```

---

### Testing Strategy

**Test files to create:**

| File | Type | What it tests |
|------|------|---------------|
| `packages/bot/src/__tests__/config.test.ts` | Unit | `BotEnvSchema`, `parseConfig()`, all env var scenarios |
| `packages/bot/src/__tests__/apiClient.test.ts` | Unit | `ApiError`, `createApiClient()`, fetch mock |
| `packages/bot/src/__tests__/markdownUtils.test.ts` | Unit | `escapeMarkdown()`, `truncate()`, `formatNutrient()` |
| `packages/bot/src/__tests__/formatters.test.ts` | Unit | All four formatter functions with fixture data |
| `packages/bot/src/__tests__/commands.test.ts` | Unit | All 7 command handlers + `handleStart` + `handleApiError`; mock `ApiClient` |
| `packages/bot/src/__tests__/bot.test.ts` | Unit | `buildBot()` wiring; mock `TelegramBot` |

No integration tests (no DB, no real Telegram connection). The `ApiClient` is mocked in all tests. The real `createApiClient()` is tested only at the unit level with a mocked `fetch` global.

**Key test scenarios:**

- Happy path for every command
- Empty / whitespace args → usage hint (no API call)
- Every `ApiError` status code (429, 401/403, 5xx, TIMEOUT, NETWORK_ERROR) → correct Spanish message
- `/estimar` split on LAST ` en ` — three sub-cases
- `/platos` with invalid UUID format (no API call)
- `/platos` with valid UUID + 404 from API
- `/info` when healthCheck rejects (tolerates failure)
- `escapeMarkdown` against all 18 MarkdownV2 reserved chars
- `truncate` at exact boundary, mid-string
- `buildBot` unhandled exception in handler → sends generic error, does not crash
- `buildBot` polling_error handler registered

**Mocking strategy:**

- `ApiClient` — `vi.fn()` per method; typed as `MockApiClient` implementing the `ApiClient` interface; reset in `beforeEach`
- `TelegramBot` — `vi.mock('node-telegram-bot-api')` at top of `bot.test.ts`; mock constructor returns `{ onText: vi.fn(), sendMessage: vi.fn(), on: vi.fn(), startPolling: vi.fn(), stopPolling: vi.fn() }`
- `fetch` global — `vi.stubGlobal('fetch', vi.fn())` in `apiClient` tests; restore in `afterEach`
- `process.exit` — `vi.spyOn(process, 'exit').mockImplementation(...)` before dynamic import of `config.ts` (same pattern as `packages/api/src/__tests__/config.test.ts`)

---

### Key Patterns

1. **Config pattern** — follow `packages/api/src/config.ts` exactly. Schema name: `BotEnvSchema`. Export: `parseConfig(env)` + `config` singleton. Error prefix: `[bot:config]`.

2. **Command handler signature** — pure functions returning `Promise<string>`. They never call `bot.sendMessage` directly. `bot.ts` is the only place that calls `sendMessage`. This makes every command handler testable with zero Telegram dependencies.

3. **Error → user message mapping** — centralise in a shared helper `handleApiError(err: unknown): string` inside a new file `packages/bot/src/commands/errorMessages.ts` (or inline it at the bottom of `apiClient.ts` if simple enough). This prevents 7× duplication across command files. The mapping:
   - `ApiError.statusCode === 429` → `'Demasiadas consultas\\. Espera un momento\\.`
   - `ApiError.statusCode === 401 || 403` → `'Error de configuracion del bot\\.'` + `logger.fatal`
   - `ApiError.statusCode >= 500` → `'El servicio no esta disponible\\.'`
   - `ApiError.code === 'TIMEOUT'` → `'La consulta tardo demasiado\\.'`
   - `ApiError.code === 'NETWORK_ERROR'` → `'No se puede conectar con el servidor\\.'`
   - fallback → `'Ha ocurrido un error inesperado\\.'`

4. **MarkdownV2 discipline** — every string from the database, from user input, or from config must pass through `escapeMarkdown()` before inclusion in a Telegram message. Pre-composed Markdown syntax (`*bold*`, `_italic_`) must NOT be escaped — build the structure with literal backtick/star/underscore and escape only the data portions.

5. **Pagination footer** — the `"Mostrando X de Y"` footer is rendered only when `pagination.totalItems > pagination.pageSize`. The formatter receives both `items` and `pagination` so it can compute this. `X = items.length`, `Y = pagination.totalItems`.

6. **`TelegramBot` polling false in `buildBot`** — the constructor receives `{ polling: false }`. Only `index.ts` calls `startPolling()`. This is the key design decision that makes `bot.ts` unit-testable without side effects.

7. **Import paths** — TypeScript `module: Node16` requires `.js` extensions on relative imports at runtime. Use `.js` in all `import` statements within `packages/bot/src/`. Vitest resolves these correctly via its internal resolver.

8. **`noUncheckedIndexedAccess`** — the tsconfig base enables this. Use optional chaining or null checks when accessing array elements or `match` results from `onText` callbacks (e.g. `match?.[1] ?? ''`).

9. **`vi.mock` hoisting** — Vitest hoists `vi.mock(...)` calls to the top of the file. Place them before imports in test files that mock `node-telegram-bot-api`.

10. **`estimateFormatter` — show optional nutrients** — only show a nutrient row if its value is `> 0`. This keeps the message compact. Required nutrients always shown: `calories`, `proteins`, `carbohydrates`, `fats`. Optional (shown if > 0): `fiber`, `saturatedFats`, `sodium`, `salt`.

---

## Acceptance Criteria

- [x] All 8 commands (`/start`, `/help`, `/buscar`, `/estimar`, `/restaurantes`, `/platos`, `/cadenas`, `/info`) reply with non-empty Telegram messages
- [x] `/buscar "big mac"` returns dish cards when McDonald's data is seeded
- [x] `/estimar "big mac"` returns nutrient card with kcal, protein, carbs, fat
- [x] `/cadenas` lists all active chains
- [x] `/restaurantes mcdonalds-es` returns only McDonald's restaurants
- [x] `/platos <invalid-uuid>` returns UUID format error (no crash)
- [x] `/platos <valid-uuid-not-in-db>` returns not-found message (no crash)
- [x] `/estimar pollo` with no data at any level returns no-data message
- [x] All API error codes (429, 401, 5xx) produce Spanish user messages with no technical details
- [x] `escapeMarkdown()` handles: plain text, special chars (-, ., (, ), !), emoji, empty string
- [x] Config validation: missing `BOT_API_KEY` → non-zero exit naming the missing var
- [x] Bot starts and stops cleanly via SIGTERM (polling stops, no orphaned connections)
- [x] Unit tests pass: 227 tests across 7 files
- [x] All tests pass (`npm test -w @foodxplorer/bot`)
- [x] Build succeeds (TypeScript compiles clean, ESLint passes)

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing
- [x] Code follows project standards (TypeScript strict, no `any`)
- [x] No linting errors in F027 files
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
| 2026-03-20 | Step 0: Spec created | spec-creator agent. 8 commands, ApiClient DI, MarkdownV2 |
| 2026-03-20 | Step 1: Setup | Branch + ticket + tracker updated |
| 2026-03-20 | Step 2: Plan | backend-planner agent. 9 steps. Self-review: 3 issues fixed (estimate return type, catch-all double-fire, regex no-args). Codex GPT-5.4 review: 4I+3S found, all 7 addressed (healthCheck envelope, listChains isActive, estimar chainSlug validation, chain-specific not-found, regex anchoring, log flush, code-format nutrient values) |
| 2026-03-20 | Step 3: Implement | backend-developer agent. 174 tests across 6 files (config×15, apiClient×17, markdownUtils×32, formatters×40, commands×57, bot×13) |
| 2026-03-20 | Step 4: Finalize | Quality gates: 174 tests pass, 0 TS errors, 0 lint errors. production-code-validator: APPROVED — 0 critical, 0 high, 1 low (localhost default, intentional Phase 1) |
| 2026-03-21 | Step 5: Review | PR #24 created. code-review-specialist: 2H+3M+5L → 3 fixed (wrapHandler double-throw, encodeURIComponent, truncate suffix). qa-engineer: 1H+2M+3L → 5 fixed (backslash escape, minus escape, UUID lowercase, empty name fallback, info escaping). 53 edge-case tests added. Final: 227 tests, 0 TS errors, 0 lint errors |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Implementation Plan, AC, DoD, Workflow Checklist, Completion Log, Merge Checklist Evidence |
| 1. Mark all items | [x] | AC: 15/15, DoD: 6/6, Workflow: 0-5/6 |
| 2. Verify product tracker | [x] | Active Session: step 5/6, Features table: 5/6 |
| 3. Update key_facts.md | [x] | Updated: Bot (packages/bot) section — config, apiClient, commands, formatters, bot wiring, tests |
| 4. Update decisions.md | [x] | N/A — no new ADR required |
| 5. Commit documentation | [x] | Commit: af0b80a |
| 6. Verify clean working tree | [x] | `git status`: clean |

---

*Ticket created: 2026-03-20*
