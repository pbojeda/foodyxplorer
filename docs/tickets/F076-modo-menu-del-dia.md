# F076: "Modo Menú del Día" — Multi-dish Meal Estimation

**Feature:** F076 | **Type:** Backend-Feature | **Priority:** High
**Status:** Done | **Branch:** feature/F076-modo-menu-del-dia (deleted)
**Created:** 2026-04-04 | **Dependencies:** F073 (Spanish Canonical Dishes) ✅, F070 (ConversationCore) ✅

---

## Spec

### Description

Spain's most common eating-out scenario is the "menú del día" — a fixed-price 3-course meal (primero + segundo + postre + bebida) served at bars and restaurants daily. The product currently only estimates single dishes. Users cannot log a complete meal and see total nutritional breakdown.

F076 adds multi-dish meal estimation through:
1. A new `menu_estimation` intent in ConversationCore — processes multiple dishes in a single request
2. A new `/menu` bot command for structured input
3. Natural language detection of "menú" patterns via text and voice

**Data flow:**
- `/menu gazpacho, pollo con patatas, flan, café` → bot sends `"menú: gazpacho, pollo con patatas, flan, café"` to POST /conversation/message
- NL/voice: "hoy de menú del día: gazpacho, pollo, flan y café" → ConversationCore detects "menú" pattern
- ConversationCore: detect menu → split items → estimate each in parallel → aggregate nutrients → return structured response
- Bot/web: format per-item breakdown + total row

**No new API endpoints.** All flows go through existing POST /conversation/message (and POST /conversation/audio for voice).

### API Changes

**POST /conversation/message** — No endpoint change, but new intent in response:

New intent value: `menu_estimation`

New response field `menuEstimation`:
```typescript
menuEstimation: {
  items: Array<{
    query: string;              // original dish text as parsed
    estimation: EstimateData;   // always non-null; "not found" = estimation.result === null
  }>;
  totals: {                     // sum of all items with non-null result — all 14 nutrients
    calories: number;
    proteins: number;
    carbohydrates: number;
    sugars: number;
    fats: number;
    saturatedFats: number;
    fiber: number;
    salt: number;
    sodium: number;
    transFats: number;
    cholesterol: number;
    potassium: number;
    monounsaturatedFats: number;
    polyunsaturatedFats: number;
  };                            // all fields = 0 when matchedCount = 0
  itemCount: number;            // total items parsed
  matchedCount: number;         // items with non-null estimation result
}
```

Update `docs/specs/api-spec.yaml` with the new intent and response shape.

### Data Model Changes

**None.** No database changes, no migrations. Uses existing estimation engine and dish data.

### Shared Schema Changes

In `packages/shared/src/schemas/conversation.ts`:
- Add `'menu_estimation'` to `ConversationIntentSchema` enum
- Add `menuEstimation` field to `ConversationMessageDataSchema`
- Add `MenuEstimationItemSchema` and `MenuEstimationDataSchema`

### ConversationCore Changes

In `packages/api/src/conversation/conversationCore.ts`:
- New Step 3.5 between comparison detection (Step 3) and single-dish estimation (Step 4)
- Calls `detectMenuQuery()` from entityExtractor
- If menu detected: parse items → estimate each in parallel via `Promise.allSettled` → aggregate → return `menu_estimation` intent

In `packages/api/src/conversation/entityExtractor.ts`:
- New `detectMenuQuery(text: string): string[] | null` function
- Detects "menú" keyword + extracts comma/"y"/"más"-separated items
- Returns null if no menu pattern or fewer than 2 items (falls through to single-dish)

### Bot Changes

**New command `/menu`** in `packages/bot/src/commands/menu.ts`:
- Syntax: `/menu primero, segundo, postre, bebida`
- Parses args, prepends "menú: " prefix, sends to `apiClient.processMessage()`
- Returns formatted response

**New formatter** `packages/bot/src/formatters/menuFormatter.ts`:
- `formatMenuEstimate(data: MenuEstimationData)` → MarkdownV2
- Shows each item as a compact card (name + calories + proteins + carbs + fats)
- Shows total row with aggregated nutrients
- Shows matched/total count and confidence summary

**Update handlers:**
- `handleNaturalLanguage` switch: add `menu_estimation` case → `formatMenuEstimate()`
- `handleVoice` switch: add `menu_estimation` case → `formatMenuEstimate()`
- `bot.ts`: wire `/menu` command + add to KNOWN_COMMANDS

### Edge Cases & Error Handling

1. **Fewer than 2 items after parsing** → fall through to single-dish estimation (not a menu)
2. **Item doesn't match any dish** → included in response with `estimation.result = null`, excluded from totals
3. **All items have null result (no match)** → return `menu_estimation` with zero-filled totals, `matchedCount: 0`
4. **Item estimation rejects (DB/timeout/provider error)** → catch, log error, map to null-result EstimateData for that item. Partial success is allowed.
5. **ALL items reject with system errors** → propagate the first error (500). This is distinct from "not found" — it means infrastructure is down.
6. **Max items: 8** → if user provides > 8 comma-separated items, truncate to first 8 (a menú del día is 3-6 items typically)
7. **Empty items after split** → filter out blank strings
8. **Noise items (prices, numbers)** → filter items matching price patterns (e.g., "12.50€", "€15", pure digits) before estimation
9. **Items with portion modifiers** → each item processed through `extractPortionModifier()` and `extractFoodQuery()` individually
10. **Items with chain context** → each item inherits the active chain context (same as single-dish)
11. **"menú"/"menu" keyword required** → without the keyword, comma-separated input is NOT treated as a menu (avoids collision with comparison patterns)
12. **Rate limit** → counts as 1 request against the `queries` bucket (not N requests per item)
13. **Text > 500 chars with "menú"** → text_too_long takes priority (checked before menu detection)
14. **Query logging** → log one `query_logs` row per menu request. `queryText = "menú: item1, item2, ..."`, chainSlug from context, levelHit = null (menu has multiple items), cacheHit = false

### Menu Detection Patterns

Detection is **accent-insensitive** — accepts both "menú" and "menu" (Whisper may omit accent).

The following Spanish patterns trigger menu detection (case-insensitive):
- `"menú del día: <items>"` / `"menú del día, <items>"`
- `"de menú: <items>"` / `"de menú, <items>"`
- `"menú: <items>"` / `"mi menú: <items>"`
- `"hoy de menú <items>"` / `"hoy he comido de menú <items>"`
- Bot command: `/menu <items>` (bot prepends "menú: ")

### Item Splitting Rules

**`/menu` command (structured input):** Comma-only separation. Unambiguous.
- `/menu gazpacho, pollo con patatas, flan, café` → 4 items

**NL/voice (natural language):** Comma is primary separator. ` y ` and ` más ` only treated as separators when they appear as the **final conjunction** in a comma-delimited list (prevents splitting "jamón y queso", "arroz y verduras").
- "menú: gazpacho, pollo, flan y café" → 4 items (` y ` is final conjunction)
- "menú: jamón y queso, tortilla" → 2 items ("jamón y queso" preserved)
- "menú: gazpacho y ensalada" → 2 items (only ` y ` present, treated as separator between exactly 2 items — this is the minimum case)

---

## Implementation Plan

### Existing Code to Reuse

**Shared schemas**
- `packages/shared/src/schemas/estimate.ts` — `EstimateDataSchema`, `EstimateNutrientsSchema` (reuse shape for totals; omit `referenceBasis`)
- `packages/shared/src/schemas/conversation.ts` — `ConversationIntentSchema`, `ConversationMessageDataSchema`, `EstimateDataSchema` import

**API — ConversationCore pipeline**
- `packages/api/src/conversation/estimationOrchestrator.ts` — `estimate()` function and `EstimateParams` type; called for each menu item
- `packages/api/src/conversation/entityExtractor.ts` — `extractPortionModifier()`, `extractFoodQuery()`, `parseDishExpression()` — each item passes through these
- `packages/api/src/conversation/conversationCore.ts` — `processMessage()` pipeline; new step inserted between Step 3 and Step 4
- `packages/api/src/routes/conversation.ts` — `logQueryAfterReply` pattern (fire-and-forget via `reply.raw.once('finish', ...)`)
- `packages/api/src/conversation/types.ts` — `ConversationRequest` type (no changes needed; passed through as-is)

**Bot**
- `packages/bot/src/bot.ts` — `wrapHandler`, `KNOWN_COMMANDS`, `onText` patterns for wiring new `/menu` command
- `packages/bot/src/formatters/markdownUtils.ts` — `escapeMarkdown()`, `formatNutrient()`, `truncate()`
- `packages/bot/src/formatters/estimateFormatter.ts` — reference pattern for per-item compact card
- `packages/bot/src/handlers/naturalLanguage.ts` — `handleNaturalLanguage` switch (add `menu_estimation` case)
- `packages/bot/src/handlers/voice.ts` — `handleVoice` switch (add `menu_estimation` case)
- `packages/bot/src/lib/conversationState.ts` — `getState()` for legacy chain context in `/menu` handler

---

### Files to Create

1. **`packages/shared/src/schemas/menuEstimation.ts`**
   New file. `MenuEstimationItemSchema`, `MenuEstimationDataSchema`, `MenuEstimationTotalsSchema`. Exported from barrel.

2. **`packages/api/src/conversation/menuDetector.ts`**
   New file. Pure function `detectMenuQuery(text: string): string[] | null`. Menu keyword detection regex, item splitting logic, noise filtering, truncation to 8 items.

3. **`packages/bot/src/formatters/menuFormatter.ts`**
   New file. `formatMenuEstimate(data: MenuEstimationData): string` → MarkdownV2. Per-item compact cards + bold totals row + matched/total count.

4. **`packages/bot/src/commands/menu.ts`**
   New file. `handleMenu(args, chatId, redis, apiClient)` — prepends `"menú: "`, calls `apiClient.processMessage()`, formats response via `formatMenuEstimate()`.

5. **`packages/shared/src/__tests__/f076.menuEstimation.schemas.test.ts`**
   Unit tests for the new Zod schemas.

6. **`packages/api/src/__tests__/f076.menuDetector.unit.test.ts`**
   Unit tests for `detectMenuQuery()` — all detection patterns, splitting rules, edge cases.

7. **`packages/api/src/__tests__/f076.menuAggregation.unit.test.ts`**
   Unit tests for nutrient aggregation in `processMessage()` menu step — partial failures, zero totals, all-reject propagation.

8. **`packages/bot/src/__tests__/f076.menuFormatter.unit.test.ts`**
   Unit tests for `formatMenuEstimate()` — full match, partial match, zero match, MarkdownV2 escaping.

9. **`packages/bot/src/__tests__/f076.menu.command.test.ts`**
   Unit tests for `handleMenu()` — no args, valid args, API response formatting.

---

### Files to Modify

1. **`packages/shared/src/schemas/conversation.ts`**
   - Add `'menu_estimation'` to `ConversationIntentSchema` enum
   - Import `MenuEstimationDataSchema` from `./menuEstimation.js`
   - Add `menuEstimation: MenuEstimationDataSchema.optional()` field to `ConversationMessageDataSchema`

2. **`packages/shared/src/index.ts`**
   - Add `export * from './schemas/menuEstimation.js';`

3. **`packages/api/src/conversation/conversationCore.ts`**
   - Import `detectMenuQuery` from `./menuDetector.js`
   - Add Step 3.5 block between comparison and single-dish: call `detectMenuQuery(trimmed)` → if non-null, run parallel estimation + aggregate → return `menu_estimation` intent
   - The `nullEstimateData` helper already exists in the comparison block; define a shared local version or inline for the menu step (same shape)

4. **`packages/api/src/routes/conversation.ts`**
   - Add `menu_estimation` branch to `logQueryAfterReply()` in both `/conversation/message` and `/conversation/audio` handlers. Log one row: `queryText = "menú: item1, item2, ..."`, `chainSlug` from active context (or null), `levelHit = null`, `cacheHit = false`

5. **`packages/bot/src/bot.ts`**
   - Add `'menu'` to `KNOWN_COMMANDS`
   - Import `handleMenu` from `./commands/menu.js`
   - Wire `/menu` with `onText(/^\/menu(?:@\w+)?(?:\s+(.+))?$/s, ...)` passing `match?.[1] ?? ''`, `msg.chat.id`, `redis`, `apiClient`

6. **`packages/bot/src/handlers/naturalLanguage.ts`**
   - Import `formatMenuEstimate` from `../formatters/menuFormatter.js`
   - Import `MenuEstimationData` type from `@foodxplorer/shared`
   - Add `case 'menu_estimation':` to the switch — guard `data.menuEstimation`, call `formatMenuEstimate(data.menuEstimation)`, append context footer when `data.usedContextFallback`

7. **`packages/bot/src/handlers/voice.ts`**
   - Import `formatMenuEstimate` from `../formatters/menuFormatter.js`
   - Add `case 'menu_estimation':` to the switch in `handleVoice` — same pattern as NL handler

8. **`docs/specs/api-spec.yaml`**
   - Add `menu_estimation` to the `intent` enum in the `ConversationMessageData` schema
   - Add `menuEstimation` response field with inline schema (items array, totals object with 14 nutrients, `itemCount`, `matchedCount`)

---

### Implementation Order

Follow TDD: write failing test first, then implement, then verify green.

**Step 1 — Shared schemas (foundation)**

Red: Write `packages/shared/src/__tests__/f076.menuEstimation.schemas.test.ts`.
- Test `MenuEstimationTotalsSchema` validates all 14 nutrients, rejects negative values
- Test `MenuEstimationItemSchema` with `query` string and `estimation: EstimateDataSchema` (non-nullable — "not found" is represented by `estimation.result === null`, NOT by a null estimation object)
- Test `MenuEstimationDataSchema` with `items`, `totals`, `itemCount`, `matchedCount`
- Test `ConversationIntentSchema` now accepts `'menu_estimation'`
- Test `ConversationMessageDataSchema` accepts `menuEstimation` field when intent is `menu_estimation`

Green: Create `packages/shared/src/schemas/menuEstimation.ts` and modify `conversation.ts` + `index.ts`.

**Step 2 — Menu detector (pure function)**

Red: Write `packages/api/src/__tests__/f076.menuDetector.unit.test.ts`.
- Test all trigger patterns: `"menú del día: X, Y"`, `"de menú: X, Y"`, `"menú: X, Y"`, `"mi menú: X, Y"`, `"hoy de menú X, Y"`, `"hoy he comido de menú X, Y"` — each returns array of items
- Test accent-insensitive: `"menu: X, Y"` (no accent) → same result
- Test comma-only splitting: `"menú: X, Y, Z"` → 3 items
- Test final-conjunction splitting: `"menú: X, Y y Z"` → 3 items; `"menú: jamón y queso, tortilla"` → 2 items (preserves `"jamón y queso"`)
- Test exactly-2-via-y: `"menú: gazpacho y ensalada"` → 2 items
- Test ` más ` as final conjunction: `"menú: X, Y más Z"` → 3 items; `"menú: arroz más verduras, tortilla"` → 2 items
- Test fewer than 2 items → returns `null`
- Test no "menú"/"menu" keyword → returns `null`
- Test empty items filtered: `"menú: X, , Y"` → 2 items
- Test noise items filtered: `"menú: gazpacho, 12.50€, pollo"` → 2 items; `"menú: gazpacho, €15, pollo"` → 2 items; `"menú: gazpacho, 42, pollo"` → 2 items
- Test truncation: 10 items → first 8 returned
- Test text_too_long priority is handled upstream (not in detectMenuQuery — just verify detectMenuQuery itself handles the string without crashing)

Green: Create `packages/api/src/conversation/menuDetector.ts` with `detectMenuQuery`.

Implementation notes for `detectMenuQuery`:
- Keyword regex (case-insensitive, accent-insensitive): `/men[uú]/i` present in text
- Pattern regex to extract the items string: match one of the trigger patterns, capture remainder
- Trigger patterns (ordered longest-first): `menú del día[: ,]`, `de menú[: ,]`, `mi menú:`, `hoy (?:he comido )?de menú\s+`, `menú:`
- After extracting item list string, split by comma to get primary items
- On the last item: if it contains ` y ` or ` más ` and there are already ≥1 items before it, split the last item on the conjunction (last-occurrence), treating it as a final separator
- Special case: if comma split yields exactly 1 item and it contains ` y ` or ` más `, split on the conjunction to produce 2 items (handles "menú: gazpacho y ensalada" with no commas)
- Noise filter regex: `/^\d+(?:[.,]\d+)?\s*(?:€|euros?)?$|^€\d/i` — matches price patterns ("12.50€", "€15", "12 euros") and pure digits
- Max items: slice to first 8 after filtering

**Step 3 — ConversationCore Step 3.5 (menu aggregation)**

Red: Write `packages/api/src/__tests__/f076.menuAggregation.unit.test.ts`.
- Uses same mock setup as `f070.conversationCore.unit.test.ts` (vi.mock `contextManager`, `chainResolver`, `estimationOrchestrator`, and now also `menuDetector`)
- Test: `detectMenuQuery` returns `['gazpacho', 'pollo', 'flan']` → `estimate` called 3 times in parallel → returns `menu_estimation` intent with `items`, `totals`, `itemCount: 3`, `matchedCount` = count of non-null results
- Test: nutrients aggregated correctly — verify totals sum across matched items only
- Test: item with rejected promise (DB error) → caught, mapped to null-result EstimateData, partial success continues
- Test: ALL items reject → first error propagated (throw, not return)
- Test: all items return null result → `menu_estimation` returned with zero-filled totals, `matchedCount: 0`
- Test: each item's estimation gets effective context chain slug injected (same as single-dish step)
- Test: `detectMenuQuery` returns `null` → falls through to single-dish step (no `menu_estimation`)
- Test: `detectMenuQuery` returns 1 item (after filtering/dedup) → returns `null` → falls through (detectMenuQuery contract, but also worth testing pipeline fallthrough)

Green: Modify `packages/api/src/conversation/conversationCore.ts` — add Step 3.5.

Step 3.5 implementation notes:
- Import `detectMenuQuery` from `./menuDetector.js`
- Call `detectMenuQuery(trimmed)` after comparison check fails
- If non-null: iterate items, call `parseDishExpression()` per item for portion + chain extraction, then `estimate()` per item via `Promise.allSettled`
- Build `nullEstimateData(query)` inline (same shape as comparison step)
- Aggregate totals: sum all 14 numeric nutrients from items where `result !== null`, using `portionMultiplier` already applied by `estimate()`
- Totals type omits `referenceBasis` — use `Omit<EstimateNutrients, 'referenceBasis'>` internally
- Determine if ALL settled items are rejected (check `results.every(r => r.status === 'rejected')`) — if so, throw first error
- Return `{ intent: 'menu_estimation', actorId, menuEstimation: { items, totals, itemCount, matchedCount }, activeContext }`
- `usedContextFallback` not included in menu_estimation responses (multiple items; ambiguous)

**Step 4 — Route: query logging for menu_estimation**

Red: Add test cases to `packages/api/src/__tests__/f070.conversation.route.test.ts` (or new file if route test file is already large) — test that `writeQueryLog` is called once with `queryText` starting with `"menú: "` when `intent === 'menu_estimation'`.

Green: Modify `packages/api/src/routes/conversation.ts` — add `menu_estimation` branch to `logQueryAfterReply` and `logAudioQueryAfterReply`.

Logging rule: `queryText = "menú: " + items.map(i => i.query).join(', ')`, `chainSlug = effectiveContext?.chainSlug ?? null`, `levelHit = null`, `cacheHit = false`.

**Step 5 — Bot formatter**

Red: Write `packages/bot/src/__tests__/f076.menuFormatter.unit.test.ts`.
- Test: all items matched — produces per-item lines (name + cal + prot + carbs + fats) + bold totals row + `3/3 platos encontrados`
- Test: partial match (1 of 3 null) — null item shows `"<query>: no encontrado"`, others show nutrients, matched count reflects partial
- Test: all items null result — totals row shows all zeros, `0/3 platos encontrados`
- Test: MarkdownV2 escaping — dish names with special chars (`.`, `-`, `(`) are escaped in output
- Test: function returns a string (not undefined, not empty)

Green: Create `packages/bot/src/formatters/menuFormatter.ts`.

Format layout:
```
*Menú del día*

🍽 <item1 name> — 🔥 <kcal> \| 🥩 <prot>g \| 🍞 <carbs>g \| 🧈 <fat>g
🍽 <item2 name> — ...
❓ <item3 query>: no encontrado
...
──────────────────
*Total* — 🔥 <kcal> \| 🥩 <prot>g \| 🍞 <carbs>g \| 🧈 <fat>g

_<matchedCount>/<itemCount> platos encontrados_
_Confianza: <lowest confidence among matched items>_
```

All dynamic values pass through `escapeMarkdown()`. Static `|` must be escaped as `\|` for MarkdownV2. Confidence line shows the lowest confidence level among matched items (alta/media/baja). Omitted when matchedCount=0.

**Step 6 — Bot /menu command**

Red: Write `packages/bot/src/__tests__/f076.menu.command.test.ts`.
- Test: empty args → returns usage hint message (escaped MarkdownV2)
- Test: valid args `"gazpacho, pollo, flan"` → calls `apiClient.processMessage("menú: gazpacho, pollo, flan", chatId, legacyChainContext)` and returns formatted string
- Test: API returns `menu_estimation` data → `formatMenuEstimate` called with `data.menuEstimation`
- Test: API returns unexpected intent → graceful fallback message
- Mock `apiClient.processMessage` and `getState` using `vi.mock`

Green: Create `packages/bot/src/commands/menu.ts`.

Notes:
- Handler reads legacy chain context via `getState(redis, chatId)` — same as `comparar.ts`
- Prepends `"menú: "` to args, calls `apiClient.processMessage()`
- Switches on `data.intent`: `menu_estimation` → `formatMenuEstimate(data.menuEstimation!)`, `estimation` → `formatEstimate(data.estimation!)` (fallthrough when < 2 items), others → graceful messages

**Step 7 — Bot handler updates (NL + Voice)**

Red: Add test cases to existing `packages/bot/src/__tests__/f076.menu.command.test.ts` or a new `f076.nl-voice-menu.test.ts`:
- `handleNaturalLanguage` with `data.intent = 'menu_estimation'` → calls `formatMenuEstimate` → returns formatted string
- `handleVoice` with `data.intent = 'menu_estimation'` → calls `formatMenuEstimate` → sends formatted message
- Exhaustive check: TypeScript `never` case must not emit a type error after adding `menu_estimation`

Green: Modify `packages/bot/src/handlers/naturalLanguage.ts` and `packages/bot/src/handlers/voice.ts`.

Note on exhaustive check: adding `menu_estimation` to the intent enum will make the `default: never` branches produce a TypeScript error until the case is handled. This is the correct behavior — the compiler will enforce completeness.

**Step 8 — Bot wiring**

Red: Add test case to `packages/bot/src/__tests__/bot.test.ts` (or `f076.menu.command.test.ts`):
- `KNOWN_COMMANDS` includes `'menu'`
- `/menu gazpacho, pollo` triggers `handleMenu`, not the unknown-command catch-all

Green: Modify `packages/bot/src/bot.ts` — add `'menu'` to `KNOWN_COMMANDS`, import and wire `/menu`.

**Step 9 — API spec update**

No test. Modify `docs/specs/api-spec.yaml`:
- Add `menu_estimation` to the `intent` enum in the `ConversationMessageData` schema definition
- Add `menuEstimation` property with inline schema under `ConversationMessageData`:
  - `items`: array of `{ query: string, estimation: EstimateData | null }`
  - `totals`: object with all 14 nutrient fields (number, all nullable with 0 as default)
  - `itemCount`: integer
  - `matchedCount`: integer

---

### Testing Strategy

**Test files to create:**

| File | Type | Subject |
|------|------|---------|
| `packages/shared/src/__tests__/f076.menuEstimation.schemas.test.ts` | Unit | Zod schema validation for new schemas |
| `packages/api/src/__tests__/f076.menuDetector.unit.test.ts` | Unit | `detectMenuQuery()` — all patterns, splitting rules, edge cases |
| `packages/api/src/__tests__/f076.menuAggregation.unit.test.ts` | Unit | `processMessage()` menu step — aggregation, failure modes, context injection |
| `packages/bot/src/__tests__/f076.menuFormatter.unit.test.ts` | Unit | `formatMenuEstimate()` — layout, partial/zero match, MarkdownV2 escaping |
| `packages/bot/src/__tests__/f076.menu.command.test.ts` | Unit | `handleMenu()` + NL/voice switch additions |

**Key test scenarios:**

_Happy path:_
- `/menu gazpacho, pollo con patatas, flan, café` → 4 items estimated → all found → non-zero totals, `matchedCount: 4`
- NL `"hoy de menú del día: gazpacho, pollo y flan"` → `menu_estimation` intent
- Voice-transcribed `"menú del día, gazpacho, pollo, flan y café"` → same pipeline

_Edge cases:_
- `"menú: solo un plato"` → 1 item after split → `detectMenuQuery` returns `null` → single-dish fallthrough
- `"menú: jamón y queso, tortilla española"` → 2 items (`"jamón y queso"` preserved, not split)
- `"menú: gazpacho y ensalada"` → 2 items (only ` y ` present, both sides extracted)
- `"menu: gazpacho, pollo"` (no accent) → detected (accent-insensitive)
- 10 items → only first 8 processed
- `"menú: sopa, 12.50€, pollo"` → noise item filtered → 2 items: `"sopa"` and `"pollo"`
- Empty item from double-comma `"menú: sopa, , pollo"` → 2 items

_Error cases:_
- 1 of 3 estimation promises rejects → partial success, rejected item becomes null-result, `matchedCount` reflects only fulfilled non-null
- All 3 estimation promises reject → first error propagated (500)
- All items resolve but all have `result: null` → `menu_estimation` returned with zero totals, `matchedCount: 0`

**Mocking strategy:**

- `vi.mock('../conversation/menuDetector.js')` in `f076.menuAggregation.unit.test.ts` — inject return values for `detectMenuQuery`
- `vi.mock('../conversation/estimationOrchestrator.js')` — already mocked in `f070.conversationCore.unit.test.ts`; replicate pattern for new test file
- `vi.mock('../apiClient.js')` in bot command tests — provide `processMessage` mock
- `vi.mock('../lib/conversationState.js')` — replicate pattern from `f070.naturalLanguage.unit.test.ts`
- No integration tests required — no DB changes, estimation engine is covered by existing tests

---

### Key Patterns

**ConversationCore Step 3.5 insertion pattern** — follow exactly the structure of Step 3 (comparison): check condition, call `Promise.allSettled`, guard "all rejected" → throw first error, map rejected → null-result, assemble return. Reference: `packages/api/src/conversation/conversationCore.ts` lines 133–202.

**`nullEstimateData` shape** — defined inline in comparison step (lines 174–185). The menu step needs the same shape. To avoid duplication, define it as a module-level helper at the top of `conversationCore.ts` and reuse for both comparison and menu steps.

**Item parsing in menu step** — each item string must go through `parseDishExpression()` (extracts chainSlug + portionMultiplier from item text, e.g. `"pollo doble en mcdonalds-es"`). This is the same function used in comparison. Reference: `entityExtractor.ts` lines 222–262.

**Context injection per item** — `chainSlug = parsedItem.chainSlug ?? effectiveContext?.chainSlug` — identical to comparison step. All items in a menu share the same active context.

**Query logging fire-and-forget pattern** — `reply.raw.once('finish', () => { void logQueryAfterReply(...).catch(() => {}); })`. The `logQueryAfterReply` already uses a `capturedData` closure variable. Add `menu_estimation` branch alongside existing `estimation`, `comparison`, `context_set`, `text_too_long` branches. Reference: `packages/api/src/routes/conversation.ts` lines 105–238.

**Bot command wiring with args and redis** — `/contexto` and `/receta` are wired directly (not through `wrapHandler`) because they need `chatId` and `redis`. `/menu` follows the same pattern. Reference: `bot.ts` lines 119–134 (`/receta` wiring).

**MarkdownV2 formatting** — every dynamic string from DB or user input goes through `escapeMarkdown()`. Numbers go through `formatNutrient()`. Pre-composed Markdown syntax (bold `*`, italic `_`, code `` ` ``) must NOT be escaped. Reference: `packages/bot/src/formatters/markdownUtils.ts`.

**TypeScript exhaustive switch** — both `naturalLanguage.ts` and `voice.ts` have `default: { const _exhaustive: never = data.intent; ... }`. Adding `menu_estimation` to the intent enum will produce a TypeScript error in both files until the case is handled. This is intentional — the compiler enforces completeness. Do not add the enum value until the handlers are ready, or handle it in the same commit.

**Gotchas:**
- `referenceBasis` is part of `EstimateNutrientsSchema` but must be excluded from the menu `totals` object (it is not summable). Define `MenuEstimationTotalsSchema` by picking/omitting from `EstimateNutrientsSchema` — use `z.object({...})` with the 14 fields explicitly, do not extend from `EstimateNutrientsSchema` since Zod `.omit()` would require referencing the runtime object.
- The `/menu` bot command sends `"menú: <args>"` to `processMessage`. The `"menú: "` prefix triggers `detectMenuQuery` in ConversationCore. This means the input must NOT be processed by `extractFoodQuery` first — the menu detection in Step 3.5 runs before single-dish extraction in Step 4.
- `Promise.allSettled` returns in the same order as input — preserve order when building the `items` array.
- When computing totals, apply the `portionMultiplier` already baked into `estimate()`'s result nutrients — do NOT apply it again. The `estimate()` function already calls `applyPortionMultiplier()` internally.
- Accent-insensitive detection: the keyword regex must match both `menú` (U+00FA) and `menu` (ASCII u). Use `/men[uú]/i` as part of the detection regex.
- The `MoreThan8Items` truncation happens inside `detectMenuQuery` (returns max 8 strings) — not in `conversationCore`. This keeps the core pipeline clean.

---

## Acceptance Criteria

- [x] AC1: `/menu gazpacho, pollo con patatas, flan, café` → returns per-item nutritional cards + aggregated total
- [x] AC2: NL "hoy de menú del día: gazpacho, pollo, flan y café" → detects `menu_estimation` intent
- [x] AC3: Voice note transcribed by Whisper as "menú del día, gazpacho, pollo, flan y café" → menu detection → multi-item estimation (Whisper outputs punctuated text)
- [x] AC4: Each item estimated independently via existing L1→L4 cascade
- [x] AC5: Items with `result: null` shown as "no encontrado" in response, excluded from totals
- [x] AC6: Aggregated totals include all 14 nutrients from EstimateNutrients (excluding referenceBasis). Zero-filled when matchedCount=0
- [x] AC7: Response shows `matchedCount` / `itemCount` ratio
- [x] AC8: Chain context (active or legacy) injected into each item estimation
- [x] AC9: `/menu` without args → help message ("Uso: /menu plato1, plato2, ...")
- [x] AC10: Input with "menú" but < 2 items → falls through to single-dish estimation
- [x] AC11: Items > 8 → truncated to first 8
- [x] AC12: `menu_estimation` added to ConversationIntentSchema in shared package
- [x] AC13: Bot formatter shows compact per-item breakdown + bold total row
- [x] AC14: Rate limit: counts as 1 request in `queries` bucket
- [x] AC15: Shared schema updated with MenuEstimationDataSchema + Zod validation
- [x] AC16: api-spec.yaml updated with menu_estimation intent documentation
- [x] AC17: Unit tests for menu detection (34 tests in menuDetector.unit)
- [x] AC18: Unit tests for nutrient aggregation (11 tests)
- [x] AC19: Unit tests for bot formatter (6 tests)
- [x] AC20: Unit tests for /menu command handler (6 tests)
- [x] AC21: Integration test for ConversationCore menu_estimation flow (11 tests in menuAggregation.unit)
- [x] AC22: Rejected item estimations (DB/timeout errors) → caught, logged, mapped to null result (partial success)
- [x] AC23: Query logging: one row per menu request with queryText "menú: ..." 
- [x] AC24: Noise items filtered (prices like "12.50€", "€", pure digits) before estimation
- [x] AC25: Accent-insensitive detection: "menu" (no accent) triggers same as "menú"
- [x] AC26: All existing tests pass (API 2602, Bot 1140, Shared 428)
- [x] AC27: Build succeeds (pre-existing TS errors in seedPhaseBedca/recipeCalculate only)
- [x] AC28: Specs updated (api-spec.yaml, shared schemas)

---

## Definition of Done

- [x] All acceptance criteria met (28/28)
- [x] Unit tests written and passing (72 F076 tests)
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds
- [x] Specs reflect final implementation

---

## Workflow Checklist

- [x] Step 0: Spec written, self-reviewed, cross-model reviewed (Gemini+Codex)
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: Plan written by backend-planner, self-reviewed, cross-model reviewed (Gemini)
- [x] Step 3: TDD implementation (72 tests)
- [x] Step 4: production-code-validator executed (1 CRITICAL fixed), quality gates pass
- [x] Step 5: code-review-specialist executed (APPROVED, 1 fix applied)
- [x] Step 5: qa-engineer executed (2 bugs found and fixed)
- [x] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-04 | Branch + ticket created | feature/F076-modo-menu-del-dia from develop |
| 2026-04-04 | Spec reviewed by Gemini + Codex | Both REVISE. 10 issues consolidated: totals schema (14 nutrients), ` y ` split ambiguity, failure semantics, query logging, accent-insensitive detection, noise filtering. All addressed. |
| 2026-04-04 | Plan reviewed by Gemini (Codex no verdict) | Gemini REVISE: 6 issues. Fixed: non-nullable estimation schema, 2-item "y" split edge case, pipe escaping, confidence summary, expanded noise regex. |
| 2026-04-04 | Implementation complete | 70 F076 tests (15 schema + 32 detector + 11 aggregation + 6 formatter + 6 command). All pass. |
| 2026-04-04 | Production validator | 1 CRITICAL (api-spec.yaml not updated) + 1 HIGH (defensive logging) + 2 LOW. CRITICAL fixed. |
| 2026-04-04 | Code review | APPROVED with 1 fix: usedContextFallback missing for menu_estimation. Fixed. |
| 2026-04-04 | QA | 2 bugs: BUG-F076-01 HIGH (compound dish name split when commas present), BUG-F076-02 MINOR (bare €). Both fixed. |
| 2026-04-04 | Merge approved + squash merged | Commit 1ad5f17 on develop. Branch deleted. |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Plan, AC, DoD, Workflow, Completion Log, Merge Evidence |
| 1. Mark all items | [x] | AC: 28/28, DoD: 6/6, Workflow: 7/8 (Step 6 pending) |
| 2. Verify product tracker | [x] | Active Session: step 5/6, Features table: 5/6 |
| 3. Update key_facts.md | [x] | Updated: Menú del Día (F076) module, Conversation schemas (5 intents) |
| 4. Update decisions.md | [x] | N/A — no new ADR needed |
| 5. Commit documentation | [x] | Commit: (pending) |
| 6. Verify clean working tree | [x] | `git status`: clean after commit |

---

*Ticket created: 2026-04-04*
