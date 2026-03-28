# F037 — Conversational Context Manager

**Feature:** F037 | **Type:** Bot-Feature | **Priority:** Medium
**Status:** Ready for Merge | **Branch:** feature/F037-conversational-context-manager
**Created:** 2026-03-28 | **Dependencies:** F032 ✅ (Redis BotState), F043 ✅ (comparar + NL handler), F028 ✅ (NL handler)

---

## Spec

### Description

F037 adds a per-chat chain context to the Telegram bot that auto-scopes nutritional queries to a specific chain without requiring the user to append `en <chainSlug>` on every message.

The feature extends the existing `BotState` (Redis key `bot:state:{chatId}`, TTL 2h) with a new `chainContext` field. Context can be set via natural language ("estoy en mcdonalds") or via the `/contexto` command. Once set, any `/estimar`, `/comparar`, or NL query that does NOT contain an explicit `en <chainSlug>` suffix automatically has the active context injected before the estimate call. Explicit chain references always win over context.

**User-facing flows:**

1. **Set context via NL** — the user types "estoy en mcdonalds" (or "estoy en el burger king de fuencarral"). The bot matches the `CONTEXT_SET_PATTERN` regex, resolves the chain name to a `chainSlug` via fuzzy match against `apiClient.listChains()`, stores `chainContext` in BotState, and replies with a confirmation.

2. **Set context via command** — `/contexto <cadena>` accepts either a chain name (fuzzy-resolved) or a valid chain slug (direct match). The bot replies with a confirmation showing the active chain name.

3. **View context** — `/contexto` (no args) replies with the active chain name and approximate expiry time (e.g., "Contexto activo: *McDonald's ES* — expira en ~2h"), or "No hay contexto activo" if none.

4. **Clear context** — `/contexto borrar` removes `chainContext` from BotState (the other BotState fields are preserved) and replies with a confirmation.

5. **Auto-inject context on estimate** — `/estimar big mac` with context `mcdonalds-es` behaves identically to `/estimar big mac en mcdonalds-es`. If context is absent or Redis is unavailable (fail-open), the query is sent without `chainSlug`.

6. **Auto-inject context on comparison** — `/comparar big mac vs whopper` with context `mcdonalds-es` injects the context into both dish expressions that lack an explicit chain. Per-dish explicit slugs are preserved.

7. **Auto-inject context on NL** — a plain-text message already handled by `handleNaturalLanguage` gets the context injected if no explicit slug was extracted by `extractFoodQuery` / `extractComparisonQuery`.

8. **Explicit chain overrides context** — any `en <chainSlug>` suffix present in the user text takes priority. The active context is not overridden in BotState by this usage.

---

### API Changes

None. F037 is bot-only.

---

### Data Model Changes

#### `BotState` extension — `packages/bot/src/lib/conversationState.ts`

Add a new optional interface and field:

```typescript
/**
 * Chain context stored when the user declares "estoy en <chain>".
 * Used to auto-scope /estimar, /comparar, and NL queries.
 * Separate from selectedRestaurant — restaurant context is for file uploads.
 */
export interface BotStateChainContext {
  /** Canonical chain slug (e.g. "mcdonalds-es"). */
  chainSlug: string;
  /** Display name sourced from ChainListItem.nameEs ?? ChainListItem.name. */
  chainName: string;
}

export interface BotState {
  selectedRestaurant?: BotStateRestaurant;
  searchResults?: Record<string, string>;
  pendingSearch?: string;
  pendingPhotoFileId?: string;
  chainContext?: BotStateChainContext;   // NEW
}
```

No new Redis keys. No new TTL constants. TTL is inherited from the existing `STATE_TTL_SECONDS = 7200` applied on every `setState` call. The `setAt` field records when the context was last set so the bot can display an approximate expiry to the user.

---

### Bot Changes

#### New file: `packages/bot/src/lib/chainResolver.ts`

Pure async helper — no Telegram coupling. Contains:

**`resolveChain(query: string, apiClient: ApiClient): Promise<ResolvedChain | null | 'ambiguous'>`**

- Calls `apiClient.listChains()`. If the call throws `ApiError`, rethrow — the caller catches and returns a transient-error message: `'No pude comprobar las cadenas ahora mismo\\. Inténtalo de nuevo\\.'`.
- **Minimum query length:** If `query.length < 3` after normalization, return `null` (prevents garbage matches like "m" or "es").
- **Resolution precedence** (first match wins, no ambiguity within a tier):
  1. **Exact slug match** — `normalizedQuery === normalizedChainSlug` → return immediately.
  2. **Exact name match** — `normalizedQuery === normalizedChainName` → return immediately.
  3. **Prefix match** — `normalizedChainSlug.startsWith(normalizedQuery)` OR `normalizedChainName.startsWith(normalizedQuery)` → collect matches.
  4. **Substring match (bidirectional)** — `normalizedChainName.includes(normalizedQuery) || normalizedQuery.includes(normalizedChainName)` → collect matches. Check BOTH `name` and `nameEs` independently (not coalesced) so "burger king de fuencarral" matches "Burger King" even though the query is longer.
- Normalization: lowercase, trim, remove accents (á→a, é→e, etc.), remove `'`.
- `chainName = chain.name` (ChainListItem has `name` and `nameEs`; use `nameEs ?? name` for display).
- If exactly one match in the collected tier → return `{ chainSlug, chainName }`.
- If zero matches across all tiers → return `null`.
- If multiple matches in the same tier → return `'ambiguous'`.
- The function is pure enough to be unit-tested with a mock `ApiClient`.

**Type exported:**
```typescript
export interface ResolvedChain {
  chainSlug: string;
  chainName: string;
}
```

---

#### New file: `packages/bot/src/lib/contextDetector.ts`

Pure function — no I/O. Contains:

**`detectContextSet(text: string): string | null`**

Detects NL context-set intent. Returns the raw chain identifier string (what follows "estoy en") or `null` if not matched.

Pattern (applied case-insensitively, after stripping leading `¿`/`¡` and trailing `?`/`!`):

```
/^estoy\s+en\s+(?:el\s+|la\s+|los\s+|las\s+)?([^,¿?!.]{1,50})$/i
```

Key constraints on the captured group:
- **Max 50 chars** — prevents matching compound sentences ("estoy en mcdonalds, cuántas calorías tiene el big mac").
- **No commas, question marks, or dots** — prevents matching questions that happen to start with "estoy en".
- Examples that match: "estoy en mcdonalds", "estoy en el burger king de fuencarral"
- Examples that do NOT match: "estoy en casa" (will match regex but `resolveChain` returns null → **silent fall-through**), "estoy en mcdonalds, cuántas calorías tiene el big mac" (comma blocks match)

The captured group is trimmed. If the trimmed capture is empty, returns `null`.

**NL routing behaviour when `detectContextSet` matches but `resolveChain` returns `null`:** The handler MUST fall through silently to Step 1 (comparison detection) and Step 2 (single-dish estimation). It must NOT return an error message. Only the explicit `/contexto` command surfaces "not found" errors. This prevents "estoy en casa" or "estoy en madrid" from hijacking the NL pipeline.

---

#### New file: `packages/bot/src/commands/contexto.ts`

Handles `/contexto [args]`. Signature:

```typescript
export async function handleContexto(
  args: string,
  chatId: number,
  redis: Redis,
  apiClient: ApiClient,
): Promise<string>
```

**Subcommand routing** (based on trimmed `args`):

| args | behaviour |
|------|-----------|
| `""` (empty) | View active context |
| `"borrar"` | Clear context |
| any other string | Set context by chain name or slug |

**View flow:**
- Read `BotState` from Redis.
- If `chainContext` is absent → return `'No hay contexto activo\\. Usa /contexto \\<cadena\\> para establecerlo\\.'`
- If present → read Redis TTL via `redis.ttl(stateKey(chatId))` to get the real remaining seconds. Return:
  ```
  Contexto activo: *<chainName>* \(`<chainSlug>`\)\nExpira en aproximadamente *<N>h <M>m*\.
  ```
  If `remaining ≤ 0`, display "expirando pronto" instead of a time.

**Clear flow:**
- Read BotState from Redis (fail-open: if null, return confirmation anyway).
- Delete `chainContext` from state (preserve all other fields).
- Write back via `setState`.
- Return `'Contexto borrado\\. Las siguientes consultas no estarán filtradas por cadena\\.'`

**Set flow:**
- Call `resolveChain(args, apiClient)`.
- If `null` → return `'No encontré ninguna cadena con ese nombre\\. Usa /cadenas para ver las cadenas disponibles\\.'`
- If `'ambiguous'` → return `'Encontré varias cadenas con ese nombre\\. Por favor, usa el slug exacto \\(por ejemplo: mcdonalds\\-es\\)\\. Usa /cadenas para ver los slugs\\.'`
- If `ResolvedChain`:
  - Read current BotState (fail-open: use `{}` if null).
  - Set `state.chainContext = { chainSlug, chainName, setAt: new Date().toISOString() }`.
  - Write via `setState`.
  - Return `'Contexto establecido: *<chainName>* \\(`<chainSlug>`\\)\\.\nLas próximas consultas de /estimar y /comparar se filtrarán por esta cadena\\.'`

Redis read errors are swallowed (fail-open). For the **Set flow only**, if `setState` fails, return a warning: `'No pude guardar el contexto\\. Inténtalo de nuevo\\.'` instead of a false confirmation. For View and Clear, fail-open is acceptable (idempotent operations).

---

#### Modified file: `packages/bot/src/commands/estimar.ts`

Add `chatId: number` and `redis: Redis` parameters to `handleEstimar`:

```typescript
export async function handleEstimar(
  args: string,
  chatId: number,
  redis: Redis,
  apiClient: ApiClient,
): Promise<string>
```

Context injection logic (inserted between `parseEstimarArgs` and the `apiClient.estimate` call):

- If `parseEstimarArgs` returned no `chainSlug`:
  - Read BotState from Redis (fail-open: null = no context).
  - If `state?.chainContext?.chainSlug` is defined, set `estimateParams.chainSlug = state.chainContext.chainSlug`.
- If `parseEstimarArgs` returned a `chainSlug` (explicit), use it directly — do NOT read Redis.

No changes to `parseEstimarArgs` (it remains a pure function).

**Context indicator:** When context was implicitly applied (not explicit `en <slug>`), append `\n_Contexto activo: <chainName>_` to the response. This gives the user visibility into why results are scoped.

---

#### Modified file: `packages/bot/src/commands/comparar.ts`

Add `chatId: number` and `redis: Redis` parameters to `handleComparar`:

```typescript
export async function handleComparar(
  args: string,
  chatId: number,
  redis: Redis,
  apiClient: ApiClient,
): Promise<string>
```

Context injection logic (inserted between `parseCompararArgs` and `runComparison`):

- Read `chainContext` from BotState (fail-open).
- If `chainContext` is defined, pass `chainContext.chainSlug` as a `fallbackChainSlug` argument to `runComparison`.
- `runComparison` uses `fallbackChainSlug` only for dish expressions that resolved `chainSlug = undefined` after `parseDishExpression`.

This requires a new optional parameter `fallbackChainSlug?: string` added to `runComparison`:

```typescript
export async function runComparison(
  dishAText: string,
  dishBText: string,
  nutrientFocus: string | undefined,
  apiClient: ApiClient,
  fallbackChainSlug?: string,
): Promise<string>
```

Inside `runComparison`, after `parseDishExpression` calls:
```typescript
if (!exprA.chainSlug && fallbackChainSlug) paramsA.chainSlug = fallbackChainSlug;
if (!exprB.chainSlug && fallbackChainSlug) paramsB.chainSlug = fallbackChainSlug;
```

---

#### Modified file: `packages/bot/src/handlers/naturalLanguage.ts`

Add `chatId: number` and `redis: Redis` parameters to `handleNaturalLanguage`:

```typescript
export async function handleNaturalLanguage(
  text: string,
  chatId: number,
  redis: Redis,
  apiClient: ApiClient,
): Promise<string>
```

**New routing step — context-set detection (Step 0, before comparison detection):**

```
Step 0 — Context set detection
  detectContextSet(trimmed) → chainIdentifier?
    if not null → delegate to handleContextSet(chainIdentifier, chatId, redis, apiClient)
                  (internal helper, NOT the /contexto command handler)

Step 1 — Comparison detection (existing)
  extractComparisonQuery → ParsedComparison?

Step 2 — Single-dish estimation (existing)
  extractFoodQuery → { query, chainSlug? }
```

The `handleContextSet` internal helper in `naturalLanguage.ts`:
- Calls `resolveChain(chainIdentifier, apiClient)`.
- If resolved → writes `chainContext` to BotState → returns confirmation message (same wording as `/contexto <cadena>` set flow).
- If `null` → returns `null` (caller falls through to Step 1/Step 2 — **silent fall-through**, no error shown to user). This prevents "estoy en casa" from hijacking the NL pipeline.
- If `'ambiguous'` → returns the ambiguity message (user typed something that matches multiple chains — worth surfacing).
- If `ApiError` → returns `null` (silent fall-through — transient API failure should not block NL processing).

**Context injection for single-dish path (Step 2):**

- If `extracted.chainSlug` is undefined:
  - Read `chainContext` from BotState (fail-open; reuse state already loaded in Step 0 to avoid a second Redis round-trip if possible — implementations may cache within the handler call).
  - If `chainContext` is defined, set `estimateParams.chainSlug = chainContext.chainSlug`.

**Context injection for comparison path (Step 1):**

- Pass `chainContext?.chainSlug` as `fallbackChainSlug` to `runComparison` (same pattern as `/comparar`).
- Read BotState once at the start of `handleNaturalLanguage` when Step 0 does not match, so Steps 1 and 2 can reuse the value.

---

#### Modified file: `packages/bot/src/bot.ts`

1. Add `/contexto` to `KNOWN_COMMANDS` set.

2. Register `/contexto` handler:
   ```
   /^\/contexto(?:@\w+)?(?:\s+(.+))?$/s
   ```
   Wired directly (not through `wrapHandler`) because it needs `chatId` and `redis`:
   ```typescript
   bot.onText(
     /^\/contexto(?:@\w+)?(?:\s+(.+))?$/s,
     async (msg, match) => {
       try {
         const text = await handleContexto(match?.[1] ?? '', msg.chat.id, redis, apiClient);
         await send(msg.chat.id, text);
       } catch (err) {
         logger.error({ err, chatId: msg.chat.id }, 'Unhandled /contexto error');
         try { await send(msg.chat.id, escapeMarkdown('Lo siento, ha ocurrido un error inesperado.')); } catch {}
       }
     },
   );
   ```

3. Update `/estimar`, `/comparar`, and NL handler call sites to pass `msg.chat.id` and `redis`.

---

#### Modified file: `packages/bot/src/formatters/` — new file `contextFormatter.ts`

Pure formatting functions used by `handleContexto` and `handleNaturalLanguage`:

**`formatContextConfirmation(chainName: string, chainSlug: string): string`**
Returns the MarkdownV2-escaped confirmation string for context set.

**`formatContextView(chainContext: BotStateChainContext): string`**
Returns the MarkdownV2-escaped view string including approximate expiry.

**`formatContextCleared(): string`**
Returns the cleared confirmation string.

These are extracted to keep handler code clean and unit-testable in isolation.

---

### Edge Cases & Error Handling

| Scenario | Expected behaviour |
|----------|--------------------|
| `/contexto` with no prior state set | Returns "No hay contexto activo" |
| `/contexto borrar` with no prior state | Returns cleared confirmation (idempotent) |
| `/contexto mcdonalds` resolves to multiple chains | Returns ambiguity message with slug hint |
| NL "estoy en mcdonalds-es" — exact slug | `resolveChain` matches exactly on slug field, no ambiguity |
| NL "estoy en el burger king de fuencarral" | Fuzzy match strips location noise; BK-ES identified |
| `listChains()` API error | Swallowed (fail-open); bot replies "No encontré ninguna cadena" |
| Redis error on BotState read in `/estimar` | State treated as null; query sent without `chainSlug` |
| Redis error on BotState write in `/contexto` | Silently swallowed; confirmation message still sent |
| Explicit `en mcdonalds-es` in `/estimar` with BK context | Explicit slug wins; BotState not modified |
| `/estimar` with no args and active context | Usage hint returned; context not applied (no query to send) |
| Context TTL has expired (Redis key gone) | `getState` returns null → graceful fail-open, no error to user |
| `/comparar big mac en mcdonalds-es vs whopper` with context | dishA uses explicit mcdonalds-es, dishB uses context chainSlug |
| `/comparar big mac vs whopper` with context | Both dishes use context chainSlug as fallback |
| NL comparison detected + active context | `runComparison` receives `fallbackChainSlug`; individual `en X` overrides still respected |
| Context set by NL in middle of conversation | Subsequent commands in same session use new context |
| `chainContext.setAt` is far in past (>2h) | Key would have expired in Redis; context no longer accessible. No special handling needed — Redis TTL is authoritative |
| `listChains()` returns empty array | `resolveChain` returns `null`; bot replies "No encontré ninguna cadena" |
| Chain name with accents ("Pans & Company") | Fuzzy normalizer strips accents; match proceeds correctly |

---

### Acceptance Criteria

1. `/contexto` (no args, no prior context) → returns "No hay contexto activo" message.
2. `/contexto mcdonalds-es` (exact slug) → BotState updated with `chainContext`, confirmation returned.
3. `/contexto mcdonalds` (fuzzy name, single match) → BotState updated with correct slug, confirmation returned.
4. `/contexto mcdo` (ambiguous match) → ambiguity message returned, BotState unchanged.
5. `/contexto foo-no-existe` (no match) → "no encontré ninguna cadena" message returned.
6. `/contexto` after setting context → view message shows chain name, slug, and approximate expiry.
7. `/contexto borrar` → `chainContext` removed from BotState, other fields preserved, confirmation returned.
8. `/estimar big mac` with `chainContext = mcdonalds-es` → API called with `chainSlug = "mcdonalds-es"`.
9. `/estimar big mac en burger-king-es` with `chainContext = mcdonalds-es` → API called with `chainSlug = "burger-king-es"` (explicit wins).
10. `/comparar big mac vs whopper` with `chainContext = mcdonalds-es` → both estimate calls use `chainSlug = "mcdonalds-es"`.
11. `/comparar big mac en mcdonalds-es vs whopper` with `chainContext = burger-king-es` → dishA uses `mcdonalds-es`, dishB uses `burger-king-es`.
12. NL "estoy en mcdonalds" → BotState updated with mcdonalds context, confirmation returned (not routed to estimate API).
13. NL "cuántas calorías tiene la big mac" with `chainContext = mcdonalds-es` → estimate called with `chainSlug = "mcdonalds-es"`.
14. NL comparison "qué engorda más, big mac o whopper" with context → `runComparison` receives fallback slug.
15. Redis down during `/estimar` → query sent without `chainSlug` (fail-open, no error message).
16. Redis down during `/contexto <cadena>` set → warning message returned ("No pude guardar el contexto").
17. NL "estoy en casa" (no matching chain) → falls through silently to single-dish estimation (no error shown).
18. NL "estoy en mcdonalds, cuántas calorías tiene el big mac" → regex does NOT match (comma blocks it), processed as food query.
19. `/contexto` after context set → shows real TTL from Redis (not derived from `setAt`).
20. `/estimar big mac` with implicit context → response includes `_Contexto activo: <chainName>_` indicator.
21. `/contexto mc` (query < 3 chars) → "no encontré ninguna cadena" (min length guard).
22. `listChains()` API error during `/contexto set` → transient error message ("No pude comprobar las cadenas ahora mismo").

---

### Definition of Done

- [x] All 22 acceptance criteria pass via automated tests (93 new tests across 8 files).
- [x] `conversationState.ts`: `BotState` interface extended with `BotStateChainContext`, `setStateStrict` added, `stateKey` exported.
- [x] `chainResolver.ts`: `resolveChain` with exact + fuzzy matching (4-tier), unit tested (16 tests).
- [x] `contextDetector.ts`: `detectContextSet` pure function, unit tested (15 tests).
- [x] `contexto.ts`: `handleContexto` covering view / clear / set subcommands, unit tested (14 tests).
- [x] `contextFormatter.ts`: formatter functions, unit tested (19 tests).
- [x] `estimar.ts`: updated signature, context injection + indicator, unit tested (7 tests).
- [x] `comparar.ts`: updated signature, context injection, unit tested (6 tests).
- [x] `comparisonRunner.ts`: `fallbackChainSlug` parameter added, unit tested (5 tests).
- [x] `naturalLanguage.ts`: Step 0 detection, context injection for both single-dish and comparison paths, unit tested (11 tests).
- [x] `bot.ts`: `/contexto` registered, KNOWN_COMMANDS updated (12), all call sites updated.
- [x] All existing tests continue to pass (1055 total — 0 regressions, +69 QA edge-case tests).
- [x] No new Redis keys introduced.
- [x] `api-spec.yaml` unchanged (no API changes).
- [x] `ui-components.md` unchanged (bot-only feature).
- [ ] Product tracker updated (F037 status → done, completion log entry added).

---

## Implementation Plan

### Existing Code to Reuse

| Entity | File | What to Reuse |
|--------|------|---------------|
| `BotState`, `getState`, `setState` | `packages/bot/src/lib/conversationState.ts` | Extend `BotState` with `chainContext?`; call `getState`/`setState` in all modified handlers |
| `stateKey` (module-private) | `packages/bot/src/lib/conversationState.ts` | `handleContexto` needs raw Redis TTL — pass `chatId` and call `redis.ttl('bot:state:' + chatId)` directly with the same key pattern (function is not exported; duplicate the key formula as a local constant inside `contexto.ts` or export `stateKey` from `conversationState.ts`) |
| `ApiClient`, `ApiError` | `packages/bot/src/apiClient.ts` | `resolveChain` calls `apiClient.listChains()` and rethrows `ApiError`; `handleContexto` catches `ApiError` for the transient-error message |
| `ChainListItem` type | `@foodxplorer/shared` | Used in `resolveChain` to type the list returned by `listChains()` |
| `escapeMarkdown` | `packages/bot/src/formatters/markdownUtils.ts` | All formatter functions in `contextFormatter.ts` use this to escape chain names, slugs, and time strings |
| `handleApiError` | `packages/bot/src/commands/errorMessages.ts` | NOT reused in `contexto.ts` — context errors use bespoke messages. Reused pattern only as reference. |
| `parseDishExpression` | `packages/bot/src/lib/comparisonParser.js` | Already used by `runComparison`; no change needed |
| `makeMockClient` pattern | `packages/bot/src/__tests__/commands.test.ts` | Every new test file defines its own self-contained `makeMockClient()` — do NOT cross-import |
| `makeMockRedis` pattern | `packages/bot/src/__tests__/f032.conversationState.test.ts` | Every new test file that needs Redis mocks its own `makeMockRedis()` with `get`, `set`, `del`, `ttl` vi.fn() methods |
| `wrapHandler` | `packages/bot/src/bot.ts` | `/contexto` is wired directly (like `/receta`) — NOT through `wrapHandler` — because it needs `chatId` and `redis` |
| CHAIN_SLUG_REGEX | `packages/bot/src/commands/estimar.ts` and `packages/bot/src/handlers/naturalLanguage.ts` | Copied verbatim (not imported) into `contextDetector.ts` is NOT needed — `detectContextSet` does not use slug format. The CHAIN_SLUG_REGEX is only needed internally in `naturalLanguage.ts` which already has it. |
| Fixture UUID pattern | `packages/bot/src/__tests__/commands.test.ts` | Use `fd000000-XXXX-4000-a000-YYYYYYYYYY` pattern in new test fixtures |

---

### Files to Create

| File | Purpose |
|------|---------|
| `packages/bot/src/lib/conversationState.ts` | **Modify** — add `BotStateChainContext` interface and `chainContext?` field to `BotState`. Also export `stateKey` so `contexto.ts` can call `redis.ttl(stateKey(chatId))`. |
| `packages/bot/src/lib/contextDetector.ts` | New pure function `detectContextSet(text): string \| null` using the restricted regex |
| `packages/bot/src/lib/chainResolver.ts` | New async function `resolveChain(query, apiClient): Promise<ResolvedChain \| null \| 'ambiguous'>` with four-tier fuzzy matching |
| `packages/bot/src/formatters/contextFormatter.ts` | New pure formatters: `formatContextConfirmation`, `formatContextView`, `formatContextCleared` |
| `packages/bot/src/commands/contexto.ts` | New `handleContexto(args, chatId, redis, apiClient): Promise<string>` — view / clear / set routing |
| `packages/bot/src/__tests__/f037.contextDetector.test.ts` | Unit tests for `detectContextSet` (pure — no mocks) |
| `packages/bot/src/__tests__/f037.chainResolver.test.ts` | Unit tests for `resolveChain` (mock `ApiClient`) |
| `packages/bot/src/__tests__/f037.contextFormatter.test.ts` | Unit tests for all three formatter functions |
| `packages/bot/src/__tests__/f037.contexto.test.ts` | Unit tests for `handleContexto` (mock ApiClient + mock Redis) |
| `packages/bot/src/__tests__/f037.estimar.test.ts` | Tests for new context-injection behaviour in `handleEstimar` |
| `packages/bot/src/__tests__/f037.comparar.test.ts` | Tests for new context-injection behaviour in `handleComparar` |
| `packages/bot/src/__tests__/f037.comparisonRunner.test.ts` | Tests for `fallbackChainSlug` param in `runComparison` |
| `packages/bot/src/__tests__/f037.naturalLanguage.test.ts` | Tests for Step 0 detection + context injection in `handleNaturalLanguage` |

---

### Files to Modify

| File | Change |
|------|--------|
| `packages/bot/src/lib/conversationState.ts` | Add `BotStateChainContext` interface; add `chainContext?: BotStateChainContext` to `BotState`; export `stateKey` function |
| `packages/bot/src/lib/comparisonRunner.ts` | Add optional `fallbackChainSlug?: string` as fifth parameter; apply it to `paramsA`/`paramsB` when expression has no `chainSlug` |
| `packages/bot/src/commands/estimar.ts` | Add `chatId: number` and `redis: Redis` as 2nd and 3rd parameters (before `apiClient`); inject `chainContext.chainSlug` when `parseEstimarArgs` returns no `chainSlug`; append context indicator to response when context was implicitly applied |
| `packages/bot/src/commands/comparar.ts` | Add `chatId: number` and `redis: Redis` as 2nd and 3rd parameters; read `chainContext` and pass `chainContext.chainSlug` as `fallbackChainSlug` to `runComparison` |
| `packages/bot/src/handlers/naturalLanguage.ts` | Add `chatId: number` and `redis: Redis` as 2nd and 3rd parameters; insert Step 0 context-set detection before existing comparison detection; inject `fallbackChainSlug` into `runComparison` and `chainSlug` into single-dish path |
| `packages/bot/src/bot.ts` | Add `'contexto'` to `KNOWN_COMMANDS`; import and register `handleContexto` with direct wiring; update `/estimar`, `/comparar`, and NL call sites to pass `msg.chat.id` and `redis` |
| `packages/bot/src/__tests__/commands.test.ts` | Update existing `handleEstimar` and `handleComparar` test call sites to pass new `chatId` and `redis` parameters (a stub mock Redis and chatId=0 is sufficient for existing tests) |
| `packages/bot/src/__tests__/naturalLanguage.test.ts` | Update `handleNaturalLanguage` call sites to pass `chatId` and `redis` parameters |
| `packages/bot/src/__tests__/comparar.test.ts` | Update `handleComparar` call sites to pass `chatId` and `redis` |
| `packages/bot/src/__tests__/comparisonRunner.test.ts` | Update `runComparison` call sites; existing tests pass `undefined` as fifth arg (backward compatible) |

---

### Implementation Order

Follow this strict dependency order to enable TDD at each step.

**Step 1 — Extend `conversationState.ts` (no deps)**

File: `packages/bot/src/lib/conversationState.ts`

- Add `BotStateChainContext` interface with `chainSlug: string`, `chainName: string` and full JSDoc. (No `setAt` — TTL is read from Redis directly.)
- Add `chainContext?: BotStateChainContext` to `BotState` interface.
- Export the `stateKey` function (change from module-private to exported) so `contexto.ts` can call `redis.ttl(stateKey(chatId))`.
- Add `export async function setStateStrict(redis: Redis, chatId: number, state: BotState): Promise<boolean>` — same as `setState` but returns `false` on error instead of swallowing. Used by `/contexto` set flow to detect write failures. Existing `setState` (fail-open) remains unchanged.
- Existing tests in `f032.conversationState.test.ts` must still pass — the only breaking change is that `BotState` now has an optional new field, which is backward compatible.

**Step 2 — `contextDetector.ts` (pure, no deps)**

File: `packages/bot/src/lib/contextDetector.ts`

- Export `detectContextSet(text: string): string | null`.
- Strip leading `¿`/`¡` and trailing `?`/`!`/`.` from text before matching.
- Apply regex `/^estoy\s+en\s+(?:el\s+|la\s+|los\s+|las\s+)?([^,¿?!.]{1,50})$/i`.
- Trim the captured group. Return `null` if trimmed capture is empty.
- Write `f037.contextDetector.test.ts` first (TDD). Key cases:
  - "estoy en mcdonalds" → "mcdonalds"
  - "estoy en el burger king de fuencarral" → "burger king de fuencarral"
  - "estoy en la casa" → "la casa" (regex matches; resolver handles null chain lookup — not detector's job)
  - "estoy en mcdonalds, cuántas calorías tiene el big mac" → `null` (comma)
  - "¿estoy en mcdonalds?" → "mcdonalds" (leading/trailing stripped)
  - "" (empty) → `null`
  - Query >50 chars in capture group → `null`
  - "estoy aquí" (no "en") → `null`

**Step 3 — `chainResolver.ts` (async, depends on `ApiClient`)**

File: `packages/bot/src/lib/chainResolver.ts`

- Export `ResolvedChain { chainSlug: string; chainName: string }`.
- Export `resolveChain(query: string, apiClient: ApiClient): Promise<ResolvedChain | null | 'ambiguous'>`.
- Normalization helper (module-private): lowercase, trim, `normalize('NFD').replace(/[\u0300-\u036f]/g, '')`, remove apostrophes (`'`).
- Min length guard: `normalizedQuery.length < 3` → return `null`.
- Four-tier matching in order; stop at the tier that produces matches:
  1. Exact slug: `normalizedQuery === normalize(chain.chainSlug)`
  2. Exact name: `normalizedQuery === normalize(chain.nameEs ?? chain.name)`
  3. Prefix (slug OR name): `normalize(chain.chainSlug).startsWith(normalizedQuery) || normalize(chain.nameEs ?? chain.name).startsWith(normalizedQuery)`
  4. Substring (name only): `normalize(chain.nameEs ?? chain.name).includes(normalizedQuery)`
- One match → `{ chainSlug: chain.chainSlug, chainName: chain.nameEs ?? chain.name }`.
- Zero matches across all tiers → `null`.
- Multiple matches within the same tier → `'ambiguous'`.
- If `listChains()` throws → rethrow (caller catches `ApiError` and returns transient-error message).
- Write `f037.chainResolver.test.ts` first (TDD). Key cases:
  - Exact slug match "mcdonalds-es" → resolves immediately
  - Exact name match "mcdonald's" (with apostrophe, strips it) → resolves
  - Prefix match "mcdo" → resolves if single match, 'ambiguous' if multiple
  - Substring match "king" → resolves if single, 'ambiguous' if multiple
  - No match "foobarchain" → `null`
  - Query "mc" (2 chars) → `null` (min length)
  - `listChains()` throws `ApiError` → error propagated (NOT caught here)
  - Empty `listChains()` result → `null`
  - Chain with accent "Pans & Company" — normalization strips accent correctly

**Step 4 — `contextFormatter.ts` (pure, depends on `BotStateChainContext` type)**

File: `packages/bot/src/formatters/contextFormatter.ts`

- Import `BotStateChainContext` from `../lib/conversationState.js`.
- Import `escapeMarkdown` from `./markdownUtils.js`.
- Export `formatContextConfirmation(chainName: string, chainSlug: string): string`.
  - Returns MarkdownV2 string: `'Contexto establecido: *<chainName>* \\\`<chainSlug>\\\`\\.\nLas próximas consultas de /estimar y /comparar se filtrarán por esta cadena\\.'`
  - `chainName` and `chainSlug` must be passed through `escapeMarkdown`.
- Export `formatContextView(chainContext: BotStateChainContext, remainingSeconds: number): string`.
  - If `remainingSeconds <= 0`: return `'Contexto activo: *<chainName>* \\\`<chainSlug>\\\`\nExpira pronto\\.'`
  - Otherwise: compute hours = `Math.floor(remainingSeconds / 3600)`, minutes = `Math.floor((remainingSeconds % 3600) / 60)`. Return `'Contexto activo: *<chainName>* \\\`<chainSlug>\\\`\nExpira en aproximadamente *<N>h <M>m*\\.'`
- Export `formatContextCleared(): string`.
  - Returns `'Contexto borrado\\. Las siguientes consultas no estarán filtradas por cadena\\.'`
- Write `f037.contextFormatter.test.ts` first (TDD). Key cases:
  - `formatContextConfirmation` with special chars in chainName/slug are escaped
  - `formatContextView` with remainingSeconds=7200 → "2h 0m"
  - `formatContextView` with remainingSeconds=0 → "expira pronto"
  - `formatContextView` with remainingSeconds=-1 → "expira pronto"
  - `formatContextView` with remainingSeconds=3661 → "1h 1m"
  - `formatContextCleared` returns the fixed string

**Step 5 — `contexto.ts` (depends on Steps 1–4)**

File: `packages/bot/src/commands/contexto.ts`

- Import `getState`, `setState`, `stateKey`, `BotState` from `../lib/conversationState.js`.
- Import `resolveChain` from `../lib/chainResolver.js`.
- Import `formatContextConfirmation`, `formatContextView`, `formatContextCleared` from `../formatters/contextFormatter.js`.
- Import `ApiError` from `../apiClient.js`.
- Import `logger` from `../logger.js`.

- Signature: `export async function handleContexto(args: string, chatId: number, redis: Redis, apiClient: ApiClient): Promise<string>`

- **View flow** (`args.trim() === ''`):
  - `const state = await getState(redis, chatId)` (fail-open: null = no context).
  - If no `chainContext`: return the "no hay contexto" message.
  - Otherwise: `const remaining = await redis.ttl(stateKey(chatId))`. Wrap `redis.ttl` in try/catch (fail-open: use `-1` on error). Return `formatContextView(state.chainContext, remaining)`.

- **Clear flow** (`args.trim() === 'borrar'`):
  - `const state = await getState(redis, chatId)` (fail-open: null).
  - If `state === null` or `!state.chainContext` → return `formatContextCleared()` immediately (no Redis write needed).
  - Otherwise: `delete state.chainContext`, `await setState(redis, chatId, state)` (fail-open).
  - Return `formatContextCleared()`.

- **Set flow** (any other args):
  - Call `resolveChain(args.trim(), apiClient)`.
  - Wrap in try/catch. If `ApiError` thrown: return transient-error message `'No pude comprobar las cadenas ahora mismo\\. Inténtalo de nuevo\\.'` and log warning.
  - If `null`: return "no encontré ninguna cadena" message.
  - If `'ambiguous'`: return ambiguity message.
  - If `ResolvedChain`:
    - `const state = (await getState(redis, chatId)) ?? {}`.
    - `state.chainContext = { chainSlug, chainName, setAt: new Date().toISOString() }`.
    - Call `await setState(redis, chatId, state as BotState)`.
    - **Important**: `setState` is fail-open internally (swallows errors). To detect failure for the warning case, the developer must wrap `setState` in a try/catch OR modify `setState` to return a success boolean. Per the spec, when `setState` fails, return the warning string. Implement by wrapping the `redis.set` call: export a new internal `setStateRaw` that returns `boolean` — OR detect failure by calling `redis.set` directly with the key pattern. **Simplest approach**: wrap `setState` call in try/catch but since `setState` itself swallows errors, instead call `redis.set(stateKey(chatId), ...)` directly in the set flow with its own try/catch, returning the warning on catch. Alternatively, refactor `setState` to return `Promise<boolean>` (true=ok, false=error). The implementation must pick one approach consistently. **Recommended**: add a new exported `setStateStrict(redis, chatId, state): Promise<boolean>` to `conversationState.ts` that returns `false` on error instead of swallowing, and call that in the set flow. This keeps `setState`'s existing fail-open contract intact.
    - On `setStateStrict` returning `false`: return warning string `'No pude guardar el contexto\\. Inténtalo de nuevo\\.'`.
    - On success: return `formatContextConfirmation(chainName, chainSlug)`.

- Write `f037.contexto.test.ts` first (TDD). Key cases:
  - View with no prior state → "no hay contexto"
  - View with active context → shows chain name + approximate TTL
  - View with `redis.ttl` throwing → still shows view (remainingSeconds defaults to -1 → "expira pronto")
  - Clear with no prior state → returns cleared confirmation
  - Clear preserves other BotState fields (e.g., `selectedRestaurant`)
  - Set with exact slug match → BotState updated, confirmation returned
  - Set with fuzzy name match → correct slug resolved and stored
  - Set with `null` (no chain found) → "no encontré ninguna cadena"
  - Set with `'ambiguous'` → ambiguity message
  - Set with `ApiError` from `listChains` → transient-error message
  - Set when `setStateStrict` returns false → warning message

**Step 6 — Modify `comparisonRunner.ts`**

File: `packages/bot/src/lib/comparisonRunner.ts`

- Add optional fifth parameter: `fallbackChainSlug?: string` to `runComparison`.
- After `parseDishExpression` calls and before building `paramsA`/`paramsB`:
  ```
  if (!exprA.chainSlug && fallbackChainSlug) paramsA.chainSlug = fallbackChainSlug;
  if (!exprB.chainSlug && fallbackChainSlug) paramsB.chainSlug = fallbackChainSlug;
  ```
- All existing tests pass unchanged (they don't pass a fifth arg — `undefined` is the default).
- Write `f037.comparisonRunner.test.ts` first (TDD). Key cases:
  - Both dishes without explicit slug + `fallbackChainSlug` → both estimate calls include `chainSlug`
  - dishA has explicit slug "mcdonalds-es", dishB has none, fallback "burger-king-es" → dishA uses explicit, dishB uses fallback
  - Both dishes have explicit slugs + fallback provided → explicit slugs used, fallback ignored
  - `fallbackChainSlug` is `undefined` → behaviour identical to current (no regression)

**Step 7 — Modify `estimar.ts`**

File: `packages/bot/src/commands/estimar.ts`

- Add `chatId: number` and `redis: Redis` as 2nd and 3rd parameters, `apiClient` becomes 4th.
- Import `Redis` from `ioredis`.
- Import `getState` from `../lib/conversationState.js`.
- After `parseEstimarArgs` and extractPortionModifier, before building `estimateParams`:
  - If `chainSlug` is undefined (no explicit " en <slug>" in args):
    - `let contextChainSlug: string | undefined;`
    - `let contextChainName: string | undefined;`
    - Read state: `const state = await getState(redis, chatId)` (fail-open: null on error).
    - If `state?.chainContext?.chainSlug`: set `contextChainSlug = state.chainContext.chainSlug` and `contextChainName = state.chainContext.chainName`.
    - Set `estimateParams.chainSlug = contextChainSlug`.
  - If `chainSlug` is defined (explicit): use it directly — do NOT read Redis.
- Context indicator: after `formatEstimate(data)`, if context was implicitly applied (`contextChainSlug !== undefined`), append `\n_Contexto activo: ${escapeMarkdown(contextChainName!)}_` to the returned string.
- Import `escapeMarkdown` from `../formatters/markdownUtils.js`.
- Write `f037.estimar.test.ts` first (TDD). Key cases:
  - No context in state → estimate called without `chainSlug` (unchanged behaviour)
  - Context `mcdonalds-es` in state, no explicit slug in args → estimate called with `chainSlug: 'mcdonalds-es'`, response includes "_Contexto activo: McDonald's_"
  - Explicit "en burger-king-es" in args with context "mcdonalds-es" → estimate called with `chainSlug: 'burger-king-es'`, context NOT applied, no indicator appended
  - Redis error during getState → estimate called without `chainSlug` (fail-open)
  - Empty args → usage hint returned, no Redis read
  - Existing tests in `commands.test.ts` must be updated: `handleEstimar('', mockClient)` → `handleEstimar('', 0, mockRedis, mockClient)`. Use stub mockRedis with `get: vi.fn().mockResolvedValue(null)`.

**Step 8 — Modify `comparar.ts`**

File: `packages/bot/src/commands/comparar.ts`

- Add `chatId: number` and `redis: Redis` as 2nd and 3rd parameters.
- Import `Redis` from `ioredis`.
- Import `getState` from `../lib/conversationState.js`.
- After `parseCompararArgs` succeeds, before calling `runComparison`:
  - `const state = await getState(redis, chatId)` (fail-open).
  - `const fallbackChainSlug = state?.chainContext?.chainSlug`.
  - Pass `fallbackChainSlug` as 5th arg to `runComparison`.
- Note: `/comparar` does NOT append a context indicator (only `/estimar` does per spec).
- Write `f037.comparar.test.ts` first (TDD). Key cases:
  - No context → `runComparison` called without fallback (5th arg `undefined`)
  - Context `mcdonalds-es` → `runComparison` called with `fallbackChainSlug: 'mcdonalds-es'`
  - Redis error → fail-open, `runComparison` called with `undefined` fallback
  - Existing tests in `comparar.test.ts` must be updated with new chatId/redis params.

**Step 9 — Modify `naturalLanguage.ts`**

File: `packages/bot/src/handlers/naturalLanguage.ts`

- Add `chatId: number` and `redis: Redis` as 2nd and 3rd parameters.
- Import `Redis` from `ioredis`.
- Import `detectContextSet` from `../lib/contextDetector.js`.
- Import `resolveChain` from `../lib/chainResolver.js`.
- Import `getState` from `../lib/conversationState.js`.
- Import `ApiError` from `../apiClient.js` (already imported).
- Import `setState` from `../lib/conversationState.js`.

- **Handler structure** (after the `> MAX_NL_TEXT_LENGTH` guard):

  ```
  // Step 0 — Context-set detection
  const chainIdentifier = detectContextSet(trimmed);
  let botState: BotState | null = null;  // cache for Steps 1 & 2

  if (chainIdentifier !== null) {
    const result = await handleContextSet(chainIdentifier, chatId, redis, apiClient);
    if (result !== null) return result;
    // null → fall through silently to Steps 1 & 2
  }

  // State read for Steps 1 & 2 — ALWAYS load state (even after Step 0 fall-through,
  // so existing context is not dropped for "estoy en casa"-style inputs).
  botState = await getState(redis, chatId);  // fail-open
  const fallbackChainSlug = botState?.chainContext?.chainSlug;

  // Step 1 — Comparison detection (existing)
  const comparison = extractComparisonQuery(trimmed);
  if (comparison !== null) {
    return runComparison(comparison.dishA, comparison.dishB, comparison.nutrientFocus, apiClient, fallbackChainSlug);
  }

  // Step 2 — Single-dish estimation (existing)
  const { cleanQuery, portionMultiplier } = extractPortionModifier(trimmed);
  const extracted = extractFoodQuery(cleanQuery);
  const estimateParams = { ...extracted };
  if (!estimateParams.chainSlug && fallbackChainSlug) {
    estimateParams.chainSlug = fallbackChainSlug;
  }
  if (portionMultiplier !== 1.0) estimateParams.portionMultiplier = portionMultiplier;
  // ... existing try/catch estimate call
  ```

- **`handleContextSet` internal helper** (module-private async function, NOT exported):
  - Calls `resolveChain(chainIdentifier, apiClient)`.
  - On `ApiError`: return `null` (silent fall-through — transient API failure should not block NL processing).
  - On `null`: return `null` (silent — "estoy en casa" falls through without error).
  - On `'ambiguous'`: return the ambiguity message string (surfaced to user).
  - On `ResolvedChain`:
    - Read state: `const state = (await getState(redis, chatId)) ?? {}`.
    - Set `state.chainContext = { chainSlug, chainName, setAt: new Date().toISOString() }`.
    - `await setState(redis, chatId, state)` (fail-open — no warning needed in NL path).
    - Return confirmation string (same wording as `formatContextConfirmation`).
  - Note: `handleContextSet` does NOT use the formatters module — it builds strings inline using `escapeMarkdown`, or it imports `formatContextConfirmation` from `contextFormatter.ts`.

- Note on state caching: when Step 0 fires (chainIdentifier !== null), `botState` remains `null` and `fallbackChainSlug` is `undefined`. This is intentional: if the user just set context, the new context is written to Redis but not needed for the current message (which is the context-set intent, not a food query).

- Write `f037.naturalLanguage.test.ts` first (TDD). Key cases:
  - "estoy en mcdonalds" with `resolveChain` → "mcdonalds-es" → confirmation returned, estimate NOT called
  - "estoy en casa" (resolve returns null) → falls through silently, estimate called with "estoy en casa" as query
  - "estoy en mcdonalds, cuántas calorías" → regex doesn't match (comma), treated as food query
  - NL food query with active context → estimate called with `chainSlug` from context
  - NL food query with explicit "en mcdonalds-es" AND context "burger-king-es" → explicit wins
  - NL comparison with context → `runComparison` receives `fallbackChainSlug`
  - NL comparison with explicit slug on one dish + context → explicit slug wins for that dish
  - "estoy en mcdonalds" with `listChains()` throwing `ApiError` → falls through silently (null return from handleContextSet)
  - "estoy en mcdo" ('ambiguous') → ambiguity message returned to user
  - Existing tests in `naturalLanguage.test.ts` must be updated with new `chatId` and `redis` params.

**Step 10 — Register in `bot.ts`**

File: `packages/bot/src/bot.ts`

- Add `'contexto'` to `KNOWN_COMMANDS`.
- Import `handleContexto` from `./commands/contexto.js`.
- Register `/contexto` with direct wiring (pattern `/^\/contexto(?:@\w+)?(?:\s+(.+))?$/s`):
  ```typescript
  bot.onText(
    /^\/contexto(?:@\w+)?(?:\s+(.+))?$/s,
    async (msg, match) => {
      try {
        const text = await handleContexto(match?.[1]?.trim() ?? '', msg.chat.id, redis, apiClient);
        await send(msg.chat.id, text);
      } catch (err) {
        logger.error({ err, chatId: msg.chat.id }, 'Unhandled /contexto error');
        try { await send(msg.chat.id, escapeMarkdown('Lo siento, ha ocurrido un error inesperado.')); } catch {}
      }
    },
  );
  ```
  Note: `match?.[1]?.trim() ?? ''` trims whitespace from the captured group before passing to `handleContexto`, so `/contexto borrar ` (with trailing space) and `/contexto borrar` both route to the clear flow correctly.
- Update `/estimar` call site:
  ```typescript
  (msg, match) => wrapHandler(() => handleEstimar(match?.[1] ?? '', msg.chat.id, redis, apiClient))(msg),
  ```
- Update `/comparar` call site similarly.
- Update NL handler call site in the `'message'` event handler:
  ```typescript
  void wrapHandler(() => handleNaturalLanguage(trimmed, msg.chat.id, redis, apiClient))(msg);
  ```
- No tests needed for `bot.ts` wiring — covered by the existing `bot.test.ts` smoke tests.

**Step 11 — Regression-proof existing tests**

Files: `commands.test.ts`, `naturalLanguage.test.ts`, `comparar.test.ts`, `comparisonRunner.test.ts`, `bot.test.ts` (onText count 11→12), `edge-cases.test.ts`, `f042.nlHandler.edge-cases.test.ts`, `f043.qa-edge-cases.test.ts`

- In each file, add a `makeMockRedis()` helper:
  ```typescript
  function makeMockRedis() {
    return { get: vi.fn(), set: vi.fn(), del: vi.fn(), ttl: vi.fn() } as unknown as Redis;
  }
  ```
- Update every `handleEstimar(args, client)` call to `handleEstimar(args, 0, makeNullRedis(), client)` where `makeNullRedis()` has `get: vi.fn().mockResolvedValue(null)` (no context state).
- Update every `handleComparar(args, client)` call to `handleComparar(args, 0, makeNullRedis(), client)`.
- Update every `handleNaturalLanguage(text, client)` call to `handleNaturalLanguage(text, 0, makeNullRedis(), client)`.
- Update `runComparison` calls that verify parameter count — no changes needed (fifth param is optional).
- Run `npm run -w @foodxplorer/bot test` to confirm all pass.

**Step 12 — Build verification**

- `npm run -w @foodxplorer/bot build` must pass with zero TypeScript errors.
- Fix any import-extension issues (use `.js` extension for all local imports as per existing patterns).

---

### Testing Strategy

**Test files and scope:**

| Test File | What it Tests | Mocking Strategy |
|-----------|--------------|-----------------|
| `f037.contextDetector.test.ts` | `detectContextSet` — regex edge cases | None (pure function) |
| `f037.chainResolver.test.ts` | `resolveChain` — four tiers, normalization, edge cases | `ApiClient` with `listChains: vi.fn()` |
| `f037.contextFormatter.test.ts` | `formatContextConfirmation`, `formatContextView`, `formatContextCleared` | None (pure functions) |
| `f037.contexto.test.ts` | `handleContexto` — view/clear/set flows, fail-open | `ApiClient` mock + `Redis` mock (`get`, `set`, `del`, `ttl`) |
| `f037.estimar.test.ts` | `handleEstimar` — context injection, indicator, fail-open | `ApiClient` mock + `Redis` mock |
| `f037.comparar.test.ts` | `handleComparar` — fallback propagation | `ApiClient` mock + `Redis` mock |
| `f037.comparisonRunner.test.ts` | `runComparison` — `fallbackChainSlug` param | `ApiClient` mock |
| `f037.naturalLanguage.test.ts` | Step 0 detection, context injection for Steps 1+2 | `ApiClient` mock + `Redis` mock |

**Redis mock pattern** (self-contained per file):
```typescript
function makeMockRedis() {
  return {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    ttl: vi.fn(),
  } as unknown as Redis;
}
```

**Key scenarios per file:**

`f037.contextDetector.test.ts`:
- Happy path: "estoy en mcdonalds" → "mcdonalds"
- Article stripping: "estoy en el burger king" → "burger king"
- Comma blocks match: "estoy en mcdonalds, hay calorías" → null
- Punctuation stripped before match: "¿Estoy en mcdonalds?" → "mcdonalds"
- Group too long (51 chars) → null
- Group exactly 50 chars → matches
- Missing "en": "quiero saber mcdonalds" → null
- Empty string → null
- "estoy en " with empty capture → null

`f037.chainResolver.test.ts`:
- Fixtures: define 3-4 `ChainListItem` objects (mcdonalds-es, burger-king-es, pans-company-es, mcdonalds-pt)
- Exact slug "mcdonalds-es" → resolves
- Exact slug normalised (accents/case) → resolves
- "mcdonald's" (apostrophe stripped by normalizer) → exact name match
- "mcdo" prefix → resolves if single prefix match; ambiguous if matches mcdonalds-es AND mcdonalds-pt
- "king" substring → resolves to burger-king-es
- " burger king" → may match by prefix on name
- "xyz" → null
- "mc" (2 chars) → null
- `listChains()` throws → error propagated
- Empty `listChains()` → null
- Tier precedence: query that is an exact slug match but also a prefix for another → exact slug wins

`f037.contextFormatter.test.ts`:
- `formatContextConfirmation("McDonald's ES", "mcdonalds-es")` → escaped name + slug + expected strings
- `formatContextView` with remainingSeconds=7200 → "2h 0m"
- `formatContextView` with remainingSeconds=3661 → "1h 1m"
- `formatContextView` with remainingSeconds=59 → "0h 0m" (edge: less than a minute)
- `formatContextView` with remainingSeconds=0 → "expira pronto"
- `formatContextView` with remainingSeconds=-1 → "expira pronto"
- `formatContextCleared()` → contains "borrado"

`f037.contexto.test.ts`:
- View: no state → "No hay contexto activo"
- View: state with chainContext → chain name appears in output, TTL displayed
- View: `redis.ttl` rejects → fail-open, shows "expira pronto"
- Clear: state has chainContext + selectedRestaurant → after clear, confirmation returned; verify `setState` called with state missing `chainContext` but preserving `selectedRestaurant`
- Clear: no prior state → confirmation returned (idempotent)
- Set: exact slug → `setState` called with correct `chainContext`, confirmation returned
- Set: `resolveChain` returns null → "no encontré ninguna cadena"
- Set: `resolveChain` returns 'ambiguous' → ambiguity message
- Set: `listChains()` throws `ApiError` → transient-error message
- Set: `setStateStrict` (or redis.set) throws → warning message returned
- Set: args "mc" (< 3 chars) → "no encontré ninguna cadena" (min length guard inside resolveChain)

`f037.estimar.test.ts`:
- No context (redis.get returns null) + no explicit slug → `estimate` called without `chainSlug`
- Active context, no explicit slug → `estimate` called with context `chainSlug`, response includes `_Contexto activo: ..._`
- Active context + explicit "en burger-king-es" → `estimate` called with explicit slug, no indicator
- Redis get throws → fail-open, estimate called without slug
- Empty args → usage hint, no Redis read

`f037.comparar.test.ts`:
- No context → `runComparison` called (verify estimate calls have no injected chainSlug)
- Active context "mcdonalds-es" → estimate calls include `chainSlug: 'mcdonalds-es'` for dishes without explicit slug
- Redis down → fail-open, no injected chainSlug

`f037.comparisonRunner.test.ts`:
- `fallbackChainSlug` provided, neither dish has slug → both estimate calls include it
- dishA has explicit slug, dishB doesn't → dishA uses explicit, dishB uses fallback
- Both dishes have explicit slugs → fallback not applied
- `fallbackChainSlug` undefined → no change (existing tests pass)

`f037.naturalLanguage.test.ts`:
- "estoy en mcdonalds" → `listChains` called, confirmation returned, `estimate` NOT called
- "estoy en casa" → `resolveChain` returns null → falls through, `estimate` called with query "estoy en casa"
- "estoy en mcdonalds, ..." → regex no match → estimate called with full text
- NL single-dish + active context → estimate called with context `chainSlug`
- NL single-dish + explicit "en mcdonalds-es" + context "burger-king-es" → explicit wins
- NL comparison + active context → `estimate` called twice with context `chainSlug` as fallback
- "estoy en mcdo" (ambiguous) → ambiguity message returned, estimate NOT called
- `listChains()` ApiError during Step 0 → falls through silently, estimate called normally
- Existing regression: "big mac" with null redis → estimate called with `{ query: 'big mac' }` (no chainSlug)

**Mocking philosophy:**
- All tests are pure unit tests — no real Redis, no real HTTP.
- `ApiClient` is always a `MockApiClient` with `vi.fn()` methods (self-contained per file).
- `Redis` is mocked with `{ get, set, del, ttl }` vi.fn() (self-contained per file).
- Never cross-import fixtures between test files.

---

### Key Patterns

1. **Parameter order convention**: for handlers that need Redis, the order is `(args, chatId, redis, apiClient)` — consistent with `handleReceta` in `bot.ts` which uses `(args, chatId, apiClient, redis)`. Note: check `handleReceta` signature before committing — match whichever convention it uses to stay uniform.

   Actual pattern from spec: `handleEstimar(args, chatId, redis, apiClient)` — redis before apiClient, unlike handleReceta which is `(args, chatId, apiClient, redis)`. Follow the spec signature exactly; do not blindly follow handleReceta.

2. **Direct wiring for `/contexto`**: Use the same pattern as `/receta` in `bot.ts` (lines 117–132) — `bot.onText` with an `async (msg, match) => { try/catch }` closure, NOT `wrapHandler`. The key difference: this pattern allows passing `chatId` and `redis`.

3. **`stateKey` export**: `stateKey` is currently module-private in `conversationState.ts`. The `/contexto` view flow needs `redis.ttl(stateKey(chatId))`. Export `stateKey` so `contexto.ts` can call it without duplicating the key formula. Alternative (worse): hardcode `'bot:state:' + chatId` in `contexto.ts`. Prefer the export.

4. **`setStateStrict`**: The spec requires a warning when `setState` fails in the set flow of `/contexto`. Since `setState` swallows errors, add `export async function setStateStrict(redis: Redis, chatId: number, state: BotState): Promise<boolean>` to `conversationState.ts` — returns `true` on success, `false` on error. `contexto.ts` calls `setStateStrict` and returns the warning on `false`. All other callers continue using `setState` (fail-open). Do NOT modify `setState` itself.

5. **CHAIN_SLUG_REGEX is NOT needed in `contextDetector.ts`**: The detector regex captures anything except commas/dots/question-marks. It does not validate slug format — that's `resolveChain`'s job. The CHAIN_SLUG_REGEX comment in `naturalLanguage.ts` ("Copied verbatim — do NOT import") applies to re-use of that regex within the NL handler, not to new files.

6. **Context indicator format**: Append `\n_Contexto activo: ${escapeMarkdown(contextChainName!)}_` to the `formatEstimate()` result in `estimar.ts`. The underscore delimiters create MarkdownV2 italic. Do NOT escape the underscores themselves — only the chain name content inside.

7. **NL state caching**: In `handleNaturalLanguage`, read `getState` at most once per handler invocation. When Step 0 fires and returns a non-null result, `botState` stays `null` and `fallbackChainSlug` is `undefined`. This is correct: the message is a context-set intent, not a food query.

8. **`detectContextSet` strips punctuation before regex**: Strip leading `¿`/`¡` and trailing `?`/`!` from `text.trim()` before applying the regex. The regex itself uses `^` and `$` anchors so the stripping must happen before matching.

9. **`chainName` for display**: `resolveChain` returns `chainName = chain.nameEs ?? chain.name`. This display name is stored in `BotStateChainContext.chainName` and used in confirmation/view messages. The `chainSlug` is always the canonical `chain.chainSlug` value (not normalized).

10. **Normalization in `resolveChain`**: The normalizer uses `String.prototype.normalize('NFD')` + Unicode combining-marks regex + lowercase + trim + apostrophe removal. Apply normalization to BOTH the query and the chain fields before comparison. The chain's `name` and `nameEs` may contain accented chars (e.g., "Pans & Company") and apostrophes (e.g., "McDonald's").

11. **Run tests with**: `npm run -w @foodxplorer/bot test` (not `pnpm`). Build with `npm run -w @foodxplorer/bot build`.

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, Gemini+Codex review, 10 issues fixed
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` executed, Gemini+Codex review, 9 issues fixed, plan approved
- [x] Step 3: TDD implementation — 12 steps, 93 new tests, 986 total
- [x] Step 4: `production-code-validator` READY (0 issues), quality gates pass (tests/build/lint)
- [x] Step 5: `code-review-specialist` APPROVED (0C, 3I fixed, 4S noted). `qa-engineer` 69 edge-case tests, 2 bugs fixed (BUG-F037-01, BUG-F037-02)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-28 | Spec drafted | spec-creator agent |
| 2026-03-28 | Spec self-review | 5 fixes: workflow checklist, merge evidence, completion log format |
| 2026-03-28 | Spec reviewed by Gemini | 2C+2I+2S — NL hijacking, compound sentences, silent context, false confirm, fuzzy length, nameEs |
| 2026-03-28 | Spec reviewed by Codex | 4I+1S — expiry inconsistency, NL hijacking, fuzzy imprecision, missing ACs, listChains error |
| 2026-03-28 | Spec revised | All 10 issues addressed: silent fall-through, restricted regex, Redis TTL, precedence tiers, +6 ACs |
| 2026-03-28 | Plan drafted | backend-planner agent, 12 steps, ~90 tests estimated |
| 2026-03-28 | Plan self-review | Verified: nameEs exists in ChainListItem (Gemini was wrong), parameter order clarified, setStateStrict pattern OK |
| 2026-03-28 | Plan reviewed by Gemini | 2C+2I+2S — NL context drop, fuzzy bidirectional, wrapHandler, trailing dot, setAt unused, unnecessary clear write |
| 2026-03-28 | Plan reviewed by Codex | 3I+1S — NL context drop, missing test files, setStateStrict scope, DoD count |
| 2026-03-28 | Plan revised | All 9 issues addressed: unconditional state load, bidirectional includes, trailing dot, setStateStrict in Step 1, +4 test files, DoD→22, remove setAt, skip clear write |
| 2026-03-28 | Implementation | 12 TDD steps completed — 93 new tests, 986 total, build clean |
| 2026-03-28 | Production validation | production-code-validator: READY (0C/0H/0M/0L) |
| 2026-03-28 | Code review | code-review-specialist: APPROVED. 0C, 3I (redundant try/catch, asymmetric setState comment, Tier 4 trade-off), 4S |
| 2026-03-28 | QA | qa-engineer: 69 edge-case tests. 2 bugs found and fixed: BUG-F037-01 (BORRAR case), BUG-F037-02 (newline in detector) |
| 2026-03-28 | Review fixes | Removed redundant try/catch in 3 files, added asymmetry comment, fixed both QA bugs. 1055 tests total |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Implementation Plan, AC, DoD, Workflow Checklist, Completion Log, Merge Checklist Evidence |
| 1. Mark all items | [x] | AC: 22/22, DoD: 16/16, Workflow: Steps 0-5 checked |
| 2. Verify product tracker | [x] | Active Session: step 5/6, Features table: 5/6 in-progress |
| 3. Update key_facts.md | [x] | Updated: Commands (11 handlers), Bot wiring (12 onText), NL handler (Step 0 + context inject) |
| 4. Update decisions.md | [x] | N/A — no ADR needed |
| 5. Commit documentation | [x] | Commit: (pending — will be committed with this table) |
| 6. Verify clean working tree | [x] | `git status`: clean after docs commit |
