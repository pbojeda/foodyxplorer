# F042 — Portion-Aware NL Estimation

| Field        | Value                                                      |
|--------------|------------------------------------------------------------|
| Feature      | F042                                                       |
| Epic         | E005 — Advanced Analysis & UX                              |
| Type         | Standard fullstack (API + Bot)                             |
| Priority     | High                                                       |
| Status       | In Progress                                                |
| Branch       | feature/F042-portion-aware-nl-estimation                   |
| Created      | 2026-03-28                                                 |
| Dependencies | F020–F024 ✅ (estimation cascade), F028 ✅ (NL handler)   |

---

## Spec

### Description

F042 adds portion size modifier support to the Telegram bot's natural language handler and the `/estimar` command, and formalises how those modifiers flow through the estimation API.

**Problem today:** When a user types "big mac grande" the entire string — including "grande" — is sent to `GET /estimate?query=big mac grande`. L1–L3 perform literal string matching, so "big mac grande" fails to match "big mac". Only L4 (LLM) correctly interprets "grande" as a size signal, making every portion-qualified query fall through three cheap levels to the most expensive one.

**Solution:** Two coordinated changes:

1. **Bot-side extraction** — a new pure function `extractPortionModifier(text)` strips Spanish size modifiers from the query before it reaches the API, and returns a numeric multiplier. The clean query hits L1–L3 as intended; the multiplier is sent separately via a new query param.

2. **API-side application** — `GET /estimate` accepts a new optional `portionMultiplier` query param. After the cascade resolves the base dish/food at any level, the route handler multiplies every nutrient value and `portionGrams` by the supplied multiplier before caching and returning. The multiplier is also reflected in the `EstimateData` response so callers can display it to the user.

**ADR-001 compliance:** The LLM continues to identify dishes; the engine (route handler) applies the multiplier arithmetic. The multiplier is never computed by the LLM when supplied via query param.

**No L4 double-multiplication risk:** The bot strips size modifiers BEFORE sending the query to the API, so L4 Strategy B never sees modifier tokens in the query text. Therefore `portionMultiplier` is **always** applied by the route handler to the cascade result, regardless of `matchType`. There is no special L4 guard needed. If a direct API caller sends `query=big mac grande&portionMultiplier=1.5` (modifier NOT stripped), L4 may apply its own internal multiplier AND the route applies the external one — this is acceptable because the caller is responsible for stripping modifiers when using the `portionMultiplier` param.

---

### API Changes

#### 1. New query parameter: `portionMultiplier` on `GET /estimate`

| Property   | Value                                |
|------------|--------------------------------------|
| Name       | `portionMultiplier`                  |
| In         | query                                |
| Required   | false                                |
| Type       | number (float)                       |
| Minimum    | 0.1                                  |
| Maximum    | 5.0                                  |
| Default    | 1.0 (applied when absent)            |

Validation rule: if present, must be a finite number in [0.1, 5.0]. Values outside this range → `400 VALIDATION_ERROR`.

#### 2. `EstimateQuerySchema` change — `packages/shared/src/schemas/estimate.ts`

```
portionMultiplier: z.number().min(0.1).max(5.0).optional()
```

The field is optional; absence is treated as 1.0 by the route handler. Never default it inside the schema (keep the schema a pure validator — default logic belongs in the route).

#### 3. `EstimateDataSchema` change — add `portionMultiplier` to the response

Add a new field to `EstimateDataSchema`:

```
portionMultiplier: z.number().min(0.1).max(5.0)
```

- Always present in the response (not nullable).
- Echoes back the effective multiplier (1.0 when the param was absent, otherwise the supplied value).
- This allows the bot formatter to conditionally show the portion label without having to track it as separate state.

#### 4. Route handler changes — `packages/api/src/routes/estimate.ts`

**Cache key extension:**
The unified cache key must include the multiplier to prevent a cached 1.0 result from being returned for a 1.5 request.

Current key:
```
fxp:estimate:<normalizedQuery>:<chainSlug>:<restaurantId>
```

New key:
```
fxp:estimate:<normalizedQuery>:<chainSlug>:<restaurantId>:<portionMultiplier>
```

When `portionMultiplier` is absent, use `"1"` as the segment (not empty string) to keep keys unambiguous.

**Multiplier application logic (post-cascade):**

After `runEstimationCascade()` returns a non-null result, the route handler applies the multiplier as follows:

```
if portionMultiplier != 1.0:
  result.nutrients.*  = each nutrient * portionMultiplier   (round to 2 decimal places)
  result.portionGrams = portionGrams * portionMultiplier     (if non-null, round to 1 decimal)

if portionMultiplier == 1.0:
  // No transformation. nutrients and portionGrams unchanged.
```

The multiplier is applied uniformly to ALL matchTypes. No L4 special case — the bot strips modifiers before calling, so L4 never sees them.

When `portionMultiplier !== 1.0` is applied, `referenceBasis` must be **set to `per_serving`** regardless of its original value. If the base result had `per_100g` (common for food matches), the multiplied values no longer represent per-100g — they represent the scaled portion.

**Response shape:**
Add `portionMultiplier` to the data payload before cache write and reply. The `EstimateData` object that is cached must also include the multiplier, so a cache hit returns it correctly.

**Query log:** `portionMultiplier` is NOT added to the `query_logs` table in this feature. It is not needed for operational analytics and would require a schema migration. Log it at `debug` level in the route handler only.

#### 5. API spec example update

Add a new example to the `GET /estimate` responses section:

```yaml
portionModifierApplied:
  summary: Large Big Mac (portionMultiplier=1.5)
  value:
    success: true
    data:
      query: "Big Mac"
      chainSlug: "mcdonalds-es"
      portionMultiplier: 1.5
      level1Hit: true
      level2Hit: false
      level3Hit: false
      level4Hit: false
      matchType: "exact_dish"
      result:
        entityType: "dish"
        entityId: "uuid-of-dish"
        name: "Big Mac"
        nameEs: "Big Mac"
        restaurantId: "uuid-of-restaurant"
        chainSlug: "mcdonalds-es"
        portionGrams: 300
        nutrients:
          calories: 825
          proteins: 37.5
          carbohydrates: 69
          sugars: 13.5
          fats: 42
          saturatedFats: 16.5
          fiber: 0
          salt: 0
          sodium: 0
          transFats: 0
          cholesterol: 0
          potassium: 0
          monounsaturatedFats: 0
          polyunsaturatedFats: 0
          referenceBasis: "per_serving"
        confidenceLevel: "high"
        estimationMethod: "official"
        source:
          id: "uuid-of-source"
          name: "McDonald's Spain Official PDF"
          type: "official_pdf"
          url: null
        similarityDistance: null
      cachedAt: null
```

---

### Bot Changes

#### 1. New pure function `extractPortionModifier` — new file `packages/bot/src/lib/portionModifier.ts`

**Signature:**
```
function extractPortionModifier(text: string): { cleanQuery: string; portionMultiplier: number }
```

**Contract:**
- Pure function — no I/O, no side effects. Exported for unit testing.
- Returns the input text with the modifier token stripped, and the corresponding numeric multiplier.
- If no modifier is found, returns `{ cleanQuery: text, portionMultiplier: 1.0 }` (text unchanged).
- Matching is case-insensitive. The modifier token must appear as a standalone word (word boundary) — "grande" in "ensalada grande" matches; "grandelarge" does not.
- Only the **first** matched modifier is extracted. If a string somehow contains two modifier tokens, the first match wins and the remainder is preserved as-is.
- After stripping the modifier token, trim the resulting string. If it is empty, fall back to the original text (same safety behaviour as `extractFoodQuery`).

**Pattern table (matched in the order listed — longest/most-specific first):**

| Pattern tokens (case-insensitive)                          | Multiplier |
|------------------------------------------------------------|-----------|
| `extra grande`, `extra-grande`, `extra grandes`            | 1.5       |
| `ración doble`, `racion doble`, `raciones dobles`          | 2.0       |
| `media ración`, `media racion`, `medias raciones`          | 0.5       |
| `triple`, `triples`                                        | 3.0       |
| `doble`, `dobles`                                          | 2.0       |
| `grande`, `grandes`, `xl`                                  | 1.5       |
| `pequeño`, `pequeña`, `pequeños`, `pequeñas`, `peque`      | 0.7       |
| `mini`, `minis`                                            | 0.7       |
| `medio`, `media`, `medios`, `medias`, `half`               | 0.5       |
| _(no match)_                                               | 1.0       |

Matching approach: iterate the pattern list in order; for each pattern, check if the text contains the pattern as a whole-word (or whole-phrase) match using a case-insensitive regex with word boundaries. First match wins (longest patterns are listed first to prevent "grande" from matching inside "extra grande").

**Examples:**
```
"big mac grande"        → { cleanQuery: "big mac",        portionMultiplier: 1.5 }
"ensalada pequeña"      → { cleanQuery: "ensalada",       portionMultiplier: 0.7 }
"tortilla doble"        → { cleanQuery: "tortilla",       portionMultiplier: 2.0 }
"ración doble de arroz" → { cleanQuery: "de arroz",       portionMultiplier: 2.0 }
"media ración de pollo" → { cleanQuery: "de pollo",       portionMultiplier: 0.5 }
"pizza xl"              → { cleanQuery: "pizza",          portionMultiplier: 1.5 }
"big mac"               → { cleanQuery: "big mac",        portionMultiplier: 1.0 }
```

Note on "ración doble de arroz" → "de arroz": the phrase token is stripped wholesale. The leading `de ` article is NOT stripped by `extractPortionModifier` — it is handled downstream by the existing `extractFoodQuery` function (which already strips articles like "de", "del", "el", "la", etc.). Do not duplicate article stripping in the modifier function.

#### 2. `naturalLanguage.ts` — apply `extractPortionModifier` in `handleNaturalLanguage`

**Current pipeline:**
```
text → extractFoodQuery(text) → { query, chainSlug } → apiClient.estimate({ query, chainSlug })
```

**New pipeline:**
```
text
  → extractPortionModifier(text)  → { cleanQuery, portionMultiplier }
  → extractFoodQuery(cleanQuery)  → { query, chainSlug }
  → apiClient.estimate({ query, chainSlug, portionMultiplier? })
```

- Call `extractPortionModifier` on the trimmed text **before** `extractFoodQuery`.
- Pass `cleanQuery` (not the original `text`) to `extractFoodQuery`.
- Pass `portionMultiplier` to `apiClient.estimate()` **only when it is not 1.0**. When `portionMultiplier === 1.0`, omit it (do not send `portionMultiplier=1` in the query string — redundant and pollutes cache keys unnecessarily).

#### 3. `commands/estimar.ts` — apply `extractPortionModifier` in `handleEstimar`

Same transformation: after `parseEstimarArgs` extracts `{ query, chainSlug }`, call `extractPortionModifier(query)` to get `{ cleanQuery, portionMultiplier }`. Use `cleanQuery` as the final query sent to the API. Pass `portionMultiplier` to `apiClient.estimate()` only when it is not 1.0.

Note: `parseEstimarArgs` operates on the full args string (including the potential modifier). The modifier should be stripped **after** chain slug extraction to avoid disrupting the ` en <chainSlug>` split. The recommended sequence in `handleEstimar`:

```
1. parseEstimarArgs(trimmed)      → { query, chainSlug }
2. extractPortionModifier(query)  → { cleanQuery, portionMultiplier }
3. apiClient.estimate({ query: cleanQuery, chainSlug, portionMultiplier? })
```

#### 4. `apiClient.ts` — update `estimate()` signature

**Interface change:**

```
estimate(params: { query: string; chainSlug?: string; portionMultiplier?: number }): Promise<EstimateData>
```

**Implementation change** in `createApiClient`:

```
if (params.portionMultiplier !== undefined && params.portionMultiplier !== 1.0) {
  sp['portionMultiplier'] = String(params.portionMultiplier);
}
```

Only send the param when it differs from 1.0 — avoids polluting the cache key for all standard requests.

#### 5. `formatters/estimateFormatter.ts` — display portion modifier when applied

`formatEstimate` currently receives only `EstimateData`. `EstimateData` now includes `portionMultiplier`. When `portionMultiplier !== 1.0`, add a "Porción" line immediately after the dish name (before the nutrient block).

**Multiplier label map:**

| portionMultiplier | Spanish label       |
|-------------------|---------------------|
| 0.5               | media (x0.5)        |
| 0.7               | pequeña (x0.7)      |
| 1.5               | grande (x1.5)       |
| 2.0               | doble (x2.0)        |
| 3.0               | triple (x3.0)       |
| other             | ×{value}            |

The label is informational only — the displayed nutrients already reflect the multiplied values.

**Rendered example (portionMultiplier = 1.5, Big Mac):**
```
*Big Mac*
Porción: grande (x1\.5)

🔥 Calorías: 825 kcal
🥩 Proteínas: 37\.5 g
...
```

The multiplier value in the label must be escaped with `escapeMarkdown` for MarkdownV2 compliance.

---

### Data Model Changes

None. No schema migrations are required. The multiplier is a stateless calculation concern; it is never persisted to the database.

---

### Edge Cases & Error Handling

| Scenario | Expected behaviour |
|---|---|
| `portionMultiplier=0` | Zod min(0.1) → 400 VALIDATION_ERROR |
| `portionMultiplier=10` | Zod max(5.0) → 400 VALIDATION_ERROR |
| `portionMultiplier=abc` | Zod type check fails → 400 VALIDATION_ERROR |
| `portionMultiplier=1.0` sent explicitly | Treated identically to absent — no multiplication, cache key segment is "1" |
| `result === null` (total miss) after cascade | multiplier is still echoed in `portionMultiplier` field of the response; no numeric transformation needed since there are no nutrients |
| `matchType == 'llm_ingredient_decomposition'` with `portionMultiplier=1.5` (bot caller) | Bot already stripped the modifier from query → L4 sees clean text, no internal multiplier. Route applies 1.5×. Correct. |
| `matchType == 'llm_ingredient_decomposition'` with no `portionMultiplier` (absent/1.0) | Normal L4 behaviour — the LLM-extracted `portion_multiplier` is the only multiplier applied (inside Level 4 itself). No change to existing behaviour. |
| Direct API caller sends `query=big mac grande&portionMultiplier=1.5` | L4 may extract its own multiplier from "grande" AND route applies 1.5× — double multiplication. This is the caller's responsibility: strip modifiers when using the param. Documented, not guarded. |
| Modifier stripped from query leaves empty string | `extractPortionModifier` returns original text as `cleanQuery` (safe fallback — same pattern as `extractFoodQuery` empty-result guard). |
| Text has modifier but no food name (e.g., just "grande") | `extractPortionModifier` returns `cleanQuery: "grande"` because stripping "grande" would yield empty, triggering the fallback. The clean query "grande" then reaches the API and likely returns a miss, which is correct behaviour. |
| Multiple modifier words in text (e.g., "pizza grande doble") | First match (longest/most-specific first) wins. "grande" matches before "doble" in the pattern table, so multiplier is 1.5 and cleanQuery is "pizza doble". This is acceptable Phase 1 behaviour — specifying two conflicting size modifiers is ambiguous input. |
| Cache populated with multiplier=1.5, then same query arrives with multiplier=1.0 | Cache keys differ (":1.5" vs ":1"), so both are cached independently. No cross-contamination. |
| Large multiplication result (portionGrams = 500, multiplier = 5.0 → 2500 g) | No cap on output — `portionGrams` is a display field only; nutritional values can be large for extreme multipliers. The API does not validate output ranges. |

---

### Acceptance Criteria

- [x] `GET /estimate?query=big+mac&portionMultiplier=1.5` returns all nutrients exactly 1.5× the base `GET /estimate?query=big+mac` values (L1 hit path). *(f020 route test: "L1 hit with portionMultiplier=1.5")*
- [x] `GET /estimate?query=big+mac` (no `portionMultiplier`) still returns the existing response shape plus `portionMultiplier: 1.0` in the data payload. *(f020 route test: "absent multiplier defaults to 1.0")*
- [x] `GET /estimate?query=big+mac&portionMultiplier=0` returns 400 with `code: "VALIDATION_ERROR"`. *(f020 route test + schema test)*
- [x] `GET /estimate?query=big+mac&portionMultiplier=6` returns 400 with `code: "VALIDATION_ERROR"`. *(f020 route test + schema test)*
- [x] Cache key for `portionMultiplier=1.5` is distinct from `portionMultiplier=1.0`; both can coexist in Redis. *(f020 route tests: cache key segment tests)*
- [x] `extractPortionModifier("big mac grande")` returns `{ cleanQuery: "big mac", portionMultiplier: 1.5 }`. *(portionModifier.test.ts)*
- [x] `extractPortionModifier("pizza xl en burger-king-es")` returns `{ cleanQuery: "pizza en burger-king-es", portionMultiplier: 1.5 }`. *(portionModifier.test.ts)*
- [x] `extractPortionModifier("tortilla")` returns `{ cleanQuery: "tortilla", portionMultiplier: 1.0 }`. *(portionModifier.test.ts — no modifier test)*
- [x] Bot NL message "big mac grande" sends `query=big+mac&portionMultiplier=1.5` to the API. *(naturalLanguage.test.ts)*
- [x] Bot `/estimar big mac grande` sends the same clean query and multiplier. *(commands.test.ts)*
- [x] Bot message formatting shows "Porción: grande (x1\.5)" when `portionMultiplier === 1.5`. *(formatters.test.ts)*
- [x] Bot message formatting shows NO "Porción" line when `portionMultiplier === 1.0`. *(formatters.test.ts)*
- [x] `portionMultiplier` is applied uniformly to ALL matchTypes including `llm_ingredient_decomposition` (no L4 special case). *(f020 route test: uniform application, no L4 guard in code)*
- [x] `EstimateQuerySchema` and `EstimateDataSchema` in `packages/shared` are updated and pass `tsc --noEmit` with no errors. *(tsc clean, 12 new schema tests)*

---

## Notes

- No L4 guard needed: the bot strips modifiers before sending, so L4 never sees them. The route always applies `portionMultiplier` uniformly to all matchTypes.
- The pattern table in `extractPortionModifier` lists "extra grande" before "grande" to prevent the shorter pattern from matching inside the longer one. The regex implementation must preserve this ordering.
- `portionGrams` rounding after multiplication: round to 1 decimal place to avoid "300.0000000003 g" display artifacts. Nutrients round to 2 decimal places to match the existing display precision used by `formatNutrient`.
- Zod coercion note: Fastify's querystring parsing delivers all params as strings. `EstimateQuerySchema` must use `z.coerce.number().min(0.1).max(5.0).optional()` (coerce for string→number conversion).
- Formatter: the existing "Porción: 200 g" line shows `portionGrams`. When `portionMultiplier !== 1.0`, show "Porción: grande (x1\.5) — 300 g" combining the label and the already-multiplied portionGrams on one line.

---

## Implementation Plan

### Existing Code to Reuse

- `packages/shared/src/schemas/estimate.ts` — `EstimateQuerySchema`, `EstimateDataSchema`, all related types. Modify in place; no new file needed.
- `packages/api/src/routes/estimate.ts` — existing route handler. Extend the cache key build and add the multiplier application block. No structural change.
- `packages/api/src/lib/cache.ts` — `buildKey` used as-is; cache key segment string constructed in the route.
- `packages/api/src/__tests__/f020.estimate.route.test.ts` — extend with new `portionMultiplier` test groups; do not duplicate the existing fixture `MOCK_LEVEL1_RESULT`.
- `packages/shared/src/__tests__/estimate.schemas.test.ts` — extend `EstimateQuerySchema` and `EstimateDataSchema` describe blocks; do not duplicate existing fixtures.
- `docs/specs/api-spec.yaml` — extend the existing `GET /estimate` parameter list and `EstimateData` component schema. The `portionMultiplier` parameter and `EstimateData.portionMultiplier` property are already drafted by the spec-creator; corrections and the missing example are needed.

### Files to Create

None. All changes are additions/edits to existing files.

### Files to Modify

1. `packages/shared/src/schemas/estimate.ts`
   - Add `portionMultiplier: z.coerce.number().min(0.1).max(5.0).optional()` to `EstimateQuerySchema`.
   - Add `portionMultiplier: z.number().min(0.1).max(5.0)` to `EstimateDataSchema` (not optional — always present in the response).

2. `packages/api/src/routes/estimate.ts`
   - Destructure `portionMultiplier` from `request.query as EstimateQuery`.
   - Replace the `buildKey` call to append `:<portionMultiplier ?? '1'>` as the fifth segment.
   - After `runEstimationCascade()` returns and before building `dataToCache`, apply the multiplier when `portionMultiplier` is defined and not 1.0: multiply every numeric nutrient field by `portionMultiplier` and round to 2 d.p.; multiply `portionGrams` (when non-null) and round to 1 d.p. Apply to `routerResult.data.result` only when `routerResult.data.result !== null`.
   - Add `portionMultiplier: portionMultiplier ?? 1` to the `EstimateData` object constructed for caching AND to the live response sent to the client (both `dataToCache` and the `reply.send` payload).
   - Add a `request.log.debug({ portionMultiplier }, 'portion multiplier applied')` log line after reading the param (fires even when 1.0 for traceability).

3. `packages/shared/src/__tests__/estimate.schemas.test.ts`
   - Extend the `EstimateQuerySchema` describe block with new tests (see Testing Strategy).
   - Extend the `EstimateDataSchema` describe block with new tests.
   - Update the `EstimateResponseSchema` round-trip fixtures to include `portionMultiplier: 1.0` in the `data` object (the schema now requires it).

4. `packages/api/src/__tests__/f020.estimate.route.test.ts`
   - Update `MOCK_LEVEL1_RESULT`-based fixtures to include `portionMultiplier: 1.0` where `EstimateData` is constructed directly (cache-hit test).
   - Add a new describe block `portionMultiplier behaviour` with tests (see Testing Strategy).

5. `docs/specs/api-spec.yaml`
   - Fix the `portionMultiplier` parameter description (lines 2033-2038): remove the stale L4 guard language ("when `matchType` is `llm_ingredient_decomposition`… does NOT re-apply"). Replace with: multiplier is applied uniformly to ALL matchTypes; callers are responsible for stripping modifiers from the query when using this param.
   - Fix the `EstimateData.portionMultiplier` property description (lines 6211-6213): same correction — remove L4 exception text.
   - Add `portionMultiplier: 1.0` to every existing response `data` example that currently lacks the field (all examples under `examples:` in the `GET /estimate` 200 responses block — `exactDishHit`, `ftsFoodHit`, `miss`, `level4FoodMatchHit`, `level4IngredientDecompositionHit`, and any others present).
   - Add a new `portionModifierApplied` example after `level4IngredientDecompositionHit` with the exact YAML from the Spec section of this ticket.
   - Add `portionMultiplier` to the 400 error description bullet list (after the `chainSlug` bullet): "- `portionMultiplier` is present but outside [0.1, 5.0] or not a number."

### Implementation Order

Follow a strict TDD red-green cycle:

1. **Schema update + schema unit tests** (`packages/shared/src/schemas/estimate.ts` + `estimate.schemas.test.ts`)
   - Write failing tests for `portionMultiplier` in `EstimateQuerySchema` (valid float, boundary 0.1, boundary 5.0, rejection at 0, rejection at 6, rejection for "abc" string — coerce must reject non-numeric strings, absence still parses, query without the field still parses).
   - Write failing tests for `portionMultiplier` in `EstimateDataSchema` (required field, rejects absence, rejects value below 0.1, rejects value above 5.0).
   - Update the `EstimateResponseSchema` round-trip fixtures to add `portionMultiplier: 1.0`.
   - Add the two fields to the schemas; run tests to green.
   - Verify `tsc --noEmit` passes in `packages/shared`.

2. **Route unit tests — new portionMultiplier group** (`packages/api/src/__tests__/f020.estimate.route.test.ts`)
   - Update the cache-hit fixture to include `portionMultiplier: 1.0` in the cached `data` object, so the existing cache-hit test continues to pass after the schema update.
   - Write failing tests for the new route behaviour:
     a. `portionMultiplier=1.5` on an L1 hit → nutrients multiplied × 1.5, rounded to 2 d.p.; `portionGrams` multiplied × 1.5, rounded to 1 d.p.; `data.portionMultiplier === 1.5`.
     b. `portionMultiplier=1.5` on a total miss → `data.portionMultiplier === 1.5`, `data.result === null` (no multiplication attempted).
     c. Absent `portionMultiplier` → `data.portionMultiplier === 1.0`, nutrients unchanged.
     d. `portionMultiplier=1.0` sent explicitly → nutrients unchanged (no transformation), `data.portionMultiplier === 1.0`.
     e. `portionMultiplier=0` → 400 VALIDATION_ERROR.
     f. `portionMultiplier=6` → 400 VALIDATION_ERROR.
     g. `portionMultiplier=abc` → 400 VALIDATION_ERROR.
     h. Cache key includes multiplier segment: when `portionMultiplier=1.5`, `mockRedisGet` is called with a key ending `:1.5`; when absent, key ends `:1`.
     i. Response with `portionMultiplier=1.5` validates against `EstimateResponseSchema`.

3. **Route handler implementation** (`packages/api/src/routes/estimate.ts`)
   - Implement the changes described in Files to Modify above.
   - Run the new tests to green; confirm all existing tests still pass.

4. **API spec corrections and additions** (`docs/specs/api-spec.yaml`)
   - Fix stale L4 guard language in the parameter description and `EstimateData` component.
   - Add `portionMultiplier: 1.0` to all existing 200-response examples.
   - Add the `portionModifierApplied` example.
   - Add the `portionMultiplier` out-of-range validation bullet to the 400 description.

### Testing Strategy

**Test file: `packages/shared/src/__tests__/estimate.schemas.test.ts`** (extend existing)

New tests in the `EstimateQuerySchema` describe block:
- `portionMultiplier: 1.5` parses successfully.
- `portionMultiplier: 0.1` (minimum boundary) parses successfully.
- `portionMultiplier: 5.0` (maximum boundary) parses successfully.
- `portionMultiplier: 0` rejected (below minimum).
- `portionMultiplier: 5.1` rejected (above maximum).
- `portionMultiplier: 'abc'` rejected (non-numeric string, coercion yields NaN which Zod rejects).
- `portionMultiplier` absent → parses successfully, `result.data.portionMultiplier` is `undefined`.
- `portionMultiplier: '1.5'` (string) → coerces to `1.5` (Fastify sends query params as strings).

New tests in the `EstimateDataSchema` describe block:
- `portionMultiplier: 1.0` in payload → parses successfully.
- `portionMultiplier` absent from payload → rejected (required field).
- `portionMultiplier: 0.05` → rejected (below 0.1).
- `portionMultiplier: 6.0` → rejected (above 5.0).

Update `EstimateResponseSchema` round-trip fixtures to include `portionMultiplier: 1.0` in `data`.

**Test file: `packages/api/src/__tests__/f020.estimate.route.test.ts`** (extend existing)

Mocking strategy: keep existing mocks (`mockLevel1Lookup`, `mockLevel2Lookup`, `mockRedisGet`, `mockRedisSet`). No new mocks needed. All tests use `buildApp().inject()` — no real DB or Redis calls.

New describe block `portionMultiplier behaviour`:

- **Happy path — L1 hit with multiplier=1.5**: Mock `mockLevel1Lookup` returning `MOCK_LEVEL1_RESULT` (portionGrams: 215, calories: 550, proteins: 25). Inject `GET /estimate?query=Big+Mac&portionMultiplier=1.5`. Assert `data.portionMultiplier === 1.5`, `data.result.nutrients.calories === 825` (550 × 1.5, rounded to 2 d.p.), `data.result.nutrients.proteins === 37.5`, `data.result.portionGrams === 322.5` (215 × 1.5, rounded to 1 d.p.).
- **Happy path — absent multiplier defaults to 1.0**: Mock L1 hit. Inject without `portionMultiplier`. Assert `data.portionMultiplier === 1.0`, `data.result.nutrients.calories === 550` (unchanged).
- **Explicit multiplier=1.0 is a no-op**: Mock L1 hit. Inject `portionMultiplier=1.0`. Assert nutrients unchanged, `data.portionMultiplier === 1.0`.
- **Total miss with multiplier=1.5**: Mock L1 and L2 returning null. Inject `portionMultiplier=1.5`. Assert `data.portionMultiplier === 1.5`, `data.result === null`.
- **Validation — portionMultiplier=0**: Assert 400 VALIDATION_ERROR.
- **Validation — portionMultiplier=6**: Assert 400 VALIDATION_ERROR.
- **Validation — portionMultiplier=abc**: Assert 400 VALIDATION_ERROR.
- **Cache key includes multiplier**: Mock Redis get returning null (cache miss). Inject `portionMultiplier=1.5`. Assert `mockRedisGet` was called with a key string ending `:1.5`.
- **Cache key uses "1" when multiplier absent**: Inject without `portionMultiplier`. Assert `mockRedisGet` call ends `:1`.
- **Schema round-trip with multiplier**: After injecting with `portionMultiplier=1.5` and L1 hit, assert `EstimateResponseSchema.safeParse(body).success === true`.

**Rounding precision gotcha**: Use exact fixture values to avoid floating-point ambiguity in assertions. `550 × 1.5 = 825.0` and `215 × 1.5 = 322.5` are exact; no rounding noise. For salt: `2.2 × 1.5 = 3.3` (exact). For sodium: `880 × 1.5 = 1320` (exact). Avoid multipliers that produce repeating decimals in test assertions.

### Key Patterns

- **Zod coerce for query strings** — Fastify passes querystring values as strings. `z.coerce.number()` handles string-to-number conversion before `.min().max()` validate the range. Reference: the `portionMultiplier` in `EstimateQuerySchema` is the only field in this schema that needs coercion (other fields are strings). See existing `z.string().uuid()` pattern in the same file for how optional fields are structured.

- **Default logic belongs in the route, not the schema** — `EstimateQuerySchema.portionMultiplier` is `optional()` (absence is valid). The route handler reads `portionMultiplier ?? 1` when building the cache key segment and evaluating whether to multiply. Do not add `.default(1.0)` to the schema — the spec explicitly states the schema is a pure validator.

- **Nutrient multiplication helper** — The 14 numeric nutrient fields are: `calories`, `proteins`, `carbohydrates`, `sugars`, `fats`, `saturatedFats`, `fiber`, `salt`, `sodium`, `transFats`, `cholesterol`, `potassium`, `monounsaturatedFats`, `polyunsaturatedFats`. `referenceBasis` is a string and must NOT be multiplied. Use `Math.round(value * multiplier * 100) / 100` for 2 d.p. rounding; `Math.round(value * multiplier * 10) / 10` for `portionGrams`.

- **Cache key construction** — The current `buildKey` call is:
  ```
  buildKey('estimate', `${normalizedQuery}:${chainSlug ?? ''}:${restaurantId ?? ''}`)
  ```
  Replace the second argument with:
  ```
  `${normalizedQuery}:${chainSlug ?? ''}:${restaurantId ?? ''}:${portionMultiplier ?? 1}`
  ```
  Use `portionMultiplier ?? 1` (number `1`, not string `"1"`) — JavaScript's template literal coerces it to `"1"`. Do not compute a separate string variable.

- **Response payload — both cache write and live send** — `dataToCache` is a separate object from `routerResult.data`. The multiplier application mutates a copy of `routerResult.data.result.nutrients` (do not mutate `routerResult.data` directly — construct a new object). `portionMultiplier` must be added to both `dataToCache` (so cache hits return the field) and the live `reply.send` payload. The simplest pattern: build one `EstimateData` object with multiplier applied, use it for both the cache write and the response. This matches how `dataToCache` and `routerResult.data` are already handled: `dataToCache` differs from `routerResult.data` only in `cachedAt`.

- **Do not mutate `routerResult`** — `runEstimationCascade` returns a shared object. Construct the scaled nutrients as a new object using spread: `{ ...routerResult.data.result.nutrients, calories: ..., ... }`. Build a full new `EstimateData` object rather than mutating in place.

- **Test fixture update** — The existing cache-hit test in `f020.estimate.route.test.ts` constructs `cachedData` manually without `portionMultiplier`. After the schema change, `EstimateDataSchema` will require it. Update that fixture to add `portionMultiplier: 1.0` and `level4Hit: false` (it's already missing `level4Hit` — check the fixture at line 238-246 and add both fields).

- **API spec L4 guard correction** — The spec parameter description (lines 2033–2038) and the `EstimateData` property description (lines 6211–6213) both contain stale L4 exception text that contradicts the final design decision (no L4 guard — multiplier applied uniformly). Both must be corrected before the feature is merged. The corrected parameter description should simply state that the multiplier is applied uniformly after the cascade resolves, regardless of matchType, and that callers are responsible for stripping modifiers from the query text when using this param.

---

### Bot-Side Plan

#### Existing Code to Reuse

- `packages/bot/src/handlers/naturalLanguage.ts` — `extractFoodQuery`, `handleNaturalLanguage`. Modify `handleNaturalLanguage` in place; keep `extractFoodQuery` unchanged.
- `packages/bot/src/commands/estimar.ts` — `parseEstimarArgs`, `handleEstimar`. Modify `handleEstimar` in place; keep `parseEstimarArgs` unchanged.
- `packages/bot/src/apiClient.ts` — `ApiClient` interface and `createApiClient` `estimate` method. Extend the interface and the implementation's `searchParams` builder.
- `packages/bot/src/formatters/estimateFormatter.ts` — `formatEstimate`. Extend in place with the portion label block. `escapeMarkdown` from `./markdownUtils.js` is already imported and available.
- `packages/bot/src/__tests__/commands.test.ts` — `makeMockClient`, `ESTIMATE_DATA_WITH_RESULT`, `ESTIMATE_DATA_NULL`. Add new test groups; update `ESTIMATE_DATA_*` fixtures with `portionMultiplier` once `EstimateData` schema requires it.
- `packages/bot/src/__tests__/naturalLanguage.test.ts` — `makeMockClient`, `ESTIMATE_DATA_*` fixtures. Add new test groups for `extractPortionModifier` and the updated `handleNaturalLanguage` pipeline.
- `packages/bot/src/__tests__/formatters.test.ts` — `ESTIMATE_DATA_WITH_RESULT`, `formatEstimate` describe block. Add portion-label tests; update fixture with `portionMultiplier`.
- `packages/bot/src/__tests__/bot.test.ts` — `ESTIMATE_DATA_WITH_RESULT` fixture used at line 32. Update to add `portionMultiplier: 1.0` after the schema change makes the field required.
- `packages/bot/src/__tests__/apiClient.test.ts` — existing `estimate` test at line 181. Add tests for the `portionMultiplier` query-param forwarding behaviour.

#### Files to Create

- `packages/bot/src/lib/portionModifier.ts` — pure function `extractPortionModifier(text)` with the full pattern table from the spec.
- `packages/bot/src/__tests__/portionModifier.test.ts` — unit tests for `extractPortionModifier` (pure function, no mocks needed).

#### Files to Modify

1. `packages/bot/src/lib/portionModifier.ts` (new file, see above)
2. `packages/bot/src/apiClient.ts` — add `portionMultiplier?: number` to the `estimate` params in the `ApiClient` interface; add the conditional `portionMultiplier` query-param append in `createApiClient`'s `estimate` implementation.
3. `packages/bot/src/handlers/naturalLanguage.ts` — import `extractPortionModifier`; insert it before `extractFoodQuery` in `handleNaturalLanguage`; pass `portionMultiplier` to `apiClient.estimate` only when `!== 1.0`.
4. `packages/bot/src/commands/estimar.ts` — import `extractPortionModifier`; apply it to `query` after `parseEstimarArgs`; pass `portionMultiplier` to `apiClient.estimate` only when `!== 1.0`.
5. `packages/bot/src/formatters/estimateFormatter.ts` — add `PORTION_LABEL_MAP`, add the conditional "Porción" line after the dish name using `escapeMarkdown`.
6. `packages/bot/src/__tests__/portionModifier.test.ts` (new file, see above)
7. `packages/bot/src/__tests__/commands.test.ts` — update `ESTIMATE_DATA_WITH_RESULT` and `ESTIMATE_DATA_NULL` to include `portionMultiplier: 1.0`; add new test groups for portion-modifier forwarding in `handleEstimar`.
8. `packages/bot/src/__tests__/naturalLanguage.test.ts` — update `ESTIMATE_DATA_*` fixtures; add new test groups for `extractPortionModifier` integration and the updated pipeline in `handleNaturalLanguage`.
9. `packages/bot/src/__tests__/formatters.test.ts` — update `ESTIMATE_DATA_WITH_RESULT` and `ESTIMATE_DATA_NULL_RESULT` fixtures; add `formatEstimate` portion-label tests.
10. `packages/bot/src/__tests__/bot.test.ts` — update `ESTIMATE_DATA_WITH_RESULT` fixture to add `portionMultiplier: 1.0`.
11. `packages/bot/src/__tests__/apiClient.test.ts` — add tests for `portionMultiplier` forwarding in `estimate`.

#### Implementation Order (Steps 5–10)

Follow the same TDD red-green cycle as the backend steps.

**Step 5 — `extractPortionModifier` pure function (TDD)**

Write `portionModifier.test.ts` first with failing tests, then create `portionModifier.ts`.

Test cases for `extractPortionModifier`:
- "big mac grande" → `{ cleanQuery: "big mac", portionMultiplier: 1.5 }`
- "ensalada pequeña" → `{ cleanQuery: "ensalada", portionMultiplier: 0.7 }`
- "tortilla doble" → `{ cleanQuery: "tortilla", portionMultiplier: 2.0 }`
- "pizza xl" → `{ cleanQuery: "pizza", portionMultiplier: 1.5 }`
- "sandwich triple" → `{ cleanQuery: "sandwich", portionMultiplier: 3.0 }`
- "media ración de pollo" → `{ cleanQuery: "de pollo", portionMultiplier: 0.5 }` (article kept — delegated to extractFoodQuery)
- "ración doble de arroz" → `{ cleanQuery: "de arroz", portionMultiplier: 2.0 }`
- "extra grande pizza" → `{ cleanQuery: "pizza", portionMultiplier: 1.5 }` (multi-word pattern)
- "big mac extra-grande" → `{ cleanQuery: "big mac", portionMultiplier: 1.5 }` (hyphenated form)
- "big mac" (no modifier) → `{ cleanQuery: "big mac", portionMultiplier: 1.0 }`
- "grande" (only modifier — would produce empty) → `{ cleanQuery: "grande", portionMultiplier: 1.0 }` (empty fallback: returns original text)
- "pizza grande doble" (two modifiers) → first match ("grande") wins → `{ cleanQuery: "pizza doble", portionMultiplier: 1.5 }`
- "BIG MAC GRANDE" (uppercase) → `{ cleanQuery: "BIG MAC", portionMultiplier: 1.5 }` (case-insensitive)
- "pizza XL en burger-king-es" → `{ cleanQuery: "pizza en burger-king-es", portionMultiplier: 1.5 }` (modifier stripped before chain extraction)
- "pizza minis" → `{ cleanQuery: "pizza", portionMultiplier: 0.7 }` (plural form)
- "hamburguesa pequeños" → `{ cleanQuery: "hamburguesa", portionMultiplier: 0.7 }` (plural masculine)
- "half burger" → `{ cleanQuery: "burger", portionMultiplier: 0.5 }`
- Matching is word-boundary: "grandelarge" does NOT match "grande"

Implementation notes for `portionModifier.ts`:
- Export only `extractPortionModifier`; keep the pattern table as a module-level `const` array of `{ tokens: string[]; multiplier: number }` entries in the order specified by the spec.
- For each entry, build a single `RegExp` that alternates the tokens with `\b` word boundaries and the `i` flag. Multi-word tokens like "extra grande" need `\s+` or `[\s-]` between words to handle both spaced and hyphenated variants.
- Iterate the pattern array in order; first match wins. When matched, strip the full matched token from the text and trim; if the resulting string is empty, return the original text (safe fallback).
- Use `String.prototype.replace` with the pattern regex, replacing with `''`, then trim the result.

**Step 6 — Update `apiClient.ts` interface and implementation**

Add `portionMultiplier?: number` to the `estimate` params type in the `ApiClient` interface. In `createApiClient`, extend the `estimate` method:

```
if (params.portionMultiplier !== undefined && params.portionMultiplier !== 1.0) {
  sp['portionMultiplier'] = String(params.portionMultiplier);
}
```

Add tests in `apiClient.test.ts`:
- When `portionMultiplier` is `1.5`, the fetch URL's querystring contains `portionMultiplier=1.5`.
- When `portionMultiplier` is absent, the querystring does NOT contain `portionMultiplier`.
- When `portionMultiplier` is `1.0`, the querystring does NOT contain `portionMultiplier` (1.0 is suppressed).

The existing `estimate` test at line 181 continues to work — the call `client.estimate({ query: 'big mac' })` without `portionMultiplier` is still valid because the param is optional.

**Step 7 — Update `EstimateData` fixture across all test files**

After the backend schema step adds `portionMultiplier` as a required field to `EstimateDataSchema`, every `EstimateData` literal object in the bot test files will cause TypeScript errors. Update the following fixtures — all get `portionMultiplier: 1.0` added:

- `packages/bot/src/__tests__/commands.test.ts` — `ESTIMATE_DATA_NULL` (line 97) and `ESTIMATE_DATA_WITH_RESULT` (line 109).
- `packages/bot/src/__tests__/naturalLanguage.test.ts` — `ESTIMATE_DATA_NULL` (line 15) and `ESTIMATE_DATA_WITH_RESULT` (line 27).
- `packages/bot/src/__tests__/formatters.test.ts` — `ESTIMATE_DATA_WITH_RESULT` (line 70) and `ESTIMATE_DATA_NULL_RESULT` (line 116).
- `packages/bot/src/__tests__/bot.test.ts` — `ESTIMATE_DATA_WITH_RESULT` (line 32).
- `packages/bot/src/__tests__/apiClient.test.ts` — `estimateData` literal inside the `estimate` test (around line 182).

Do this step as a single sweep across all files — it is a mechanical addition, no logic change.

**Step 8 — Update `naturalLanguage.ts` and add pipeline tests**

In `handleNaturalLanguage`:
1. Import `extractPortionModifier` from `'../lib/portionModifier.js'`.
2. After trimming the text, call `extractPortionModifier(trimmed)` to get `{ cleanQuery, portionMultiplier }`.
3. Pass `cleanQuery` (not `trimmed`) to `extractFoodQuery`.
4. Build the `estimate` params: include `portionMultiplier` only when `!== 1.0`.

Add test group `handleNaturalLanguage — portionModifier integration` in `naturalLanguage.test.ts`:
- "big mac grande" calls `estimate` with `{ query: 'big mac', portionMultiplier: 1.5 }`.
- "big mac" (no modifier) calls `estimate` with `{ query: 'big mac' }` and NO `portionMultiplier` key (use `Object.prototype.hasOwnProperty.call` check — same pattern as the existing "no slug" test at line 532).
- "calorías de un big mac grande" calls `estimate` with `{ query: 'big mac', portionMultiplier: 1.5 }` (modifier extracted first, then prefix stripped by `extractFoodQuery`).
- "big mac grande en mcdonalds-es" calls `estimate` with `{ query: 'big mac', chainSlug: 'mcdonalds-es', portionMultiplier: 1.5 }` (modifier stripped before chain slug extraction).
- When `portionMultiplier === 1.0`, property is absent from `estimate` call params.

**Step 9 — Update `estimar.ts` and add command tests**

In `handleEstimar`:
1. Import `extractPortionModifier` from `'../lib/portionModifier.js'`.
2. After `parseEstimarArgs` returns `{ query, chainSlug }`, call `extractPortionModifier(query)` to get `{ cleanQuery, portionMultiplier }`.
3. Call `apiClient.estimate({ query: cleanQuery, chainSlug, portionMultiplier? })` omitting `portionMultiplier` when `=== 1.0`.

Add test group `handleEstimar — portionModifier` in `commands.test.ts`:
- `/estimar big mac grande` calls `estimate` with `{ query: 'big mac', portionMultiplier: 1.5 }`.
- `/estimar big mac` (no modifier) calls `estimate` with `{ query: 'big mac' }` and NO `portionMultiplier` key.
- `/estimar big mac grande en mcdonalds-es` calls `estimate` with `{ query: 'big mac', chainSlug: 'mcdonalds-es', portionMultiplier: 1.5 }` (chain slug extraction runs first via `parseEstimarArgs`, then modifier extraction runs on the `query` portion only).
- `/estimar pizza xl` calls `estimate` with `{ query: 'pizza', portionMultiplier: 1.5 }`.

**Step 10 — Update `estimateFormatter.ts` and add formatter tests**

In `estimateFormatter.ts`:
1. Add a `PORTION_LABEL_MAP: Record<number, string>` with entries for `0.5`, `0.7`, `1.5`, `2.0`, `3.0`.
2. In `formatEstimate`, after the bold dish name line and before the blank separator line:
   - When `data.portionMultiplier !== 1.0`: compute the label (from `PORTION_LABEL_MAP` or fall back to `×${data.portionMultiplier}`), then push `Porción: ${escapeMarkdown(label)} — ${escapeMarkdown(String(result.portionGrams))} g` when `portionGrams !== null`, or `Porción: ${escapeMarkdown(label)}` when `portionGrams === null`.
   - When `portionGrams !== null`: replace the existing standalone "Porción: X g" line at the bottom of the card with the combined line above. When `portionMultiplier === 1.0` and `portionGrams !== null`, the existing standalone line format is kept unchanged.

The rendered layout when `portionMultiplier !== 1.0` and `portionGrams` present:
```
*Big Mac*
Porción: grande \(x1\.5\) — 300 g

🔥 Calorías: 825 kcal
...
_Confianza: alta_
```
(No second "Porción" line at the bottom — only one combined line near the top.)

The rendered layout when `portionMultiplier === 1.0` and `portionGrams` present (existing format, no change):
```
*Big Mac*

🔥 Calorías: 563 kcal
...
Porción: 200 g
_Confianza: alta_
```

Add test group `formatEstimate — portionMultiplier` in `formatters.test.ts`:
- `portionMultiplier: 1.5` → output contains "Porción: grande" and "x1" (multiplier label).
- `portionMultiplier: 2.0` → output contains "doble".
- `portionMultiplier: 3.0` → output contains "triple".
- `portionMultiplier: 0.5` → output contains "pequeña".
- `portionMultiplier: 0.7` → output contains "mini".
- `portionMultiplier: 1.0` → output does NOT contain the portion-label line (no "grande", "doble", etc.).
- When `portionMultiplier !== 1.0` and `portionGrams: 300` → single "Porción" line with both label and grams.
- When `portionMultiplier !== 1.0` and `portionGrams: null` → single "Porción" line with only the label (no "null" or "g").
- When `portionMultiplier === 1.0` and `portionGrams: 200` → existing format: "Porción: 200 g" at bottom (no modifier label).
- Unknown multiplier (e.g., `1.2`) falls back to `×1.2` label.
- Multiplier value in label is escaped for MarkdownV2 (e.g., `1\.5`, not `1.5` bare).

Update all existing `formatEstimate` tests in the file that use `ESTIMATE_DATA_WITH_RESULT` or `ESTIMATE_DATA_NULL_RESULT` to include `portionMultiplier: 1.0` in those fixtures (done already in Step 7).

#### Testing Strategy (Bot-Side)

**New file: `packages/bot/src/__tests__/portionModifier.test.ts`**
- Pure function — no mocks, no async. Import `extractPortionModifier` only.
- Cover every row in the pattern table: exact match, plural form, multi-word form, hyphenated form.
- Cover: no match returns `portionMultiplier: 1.0` and `cleanQuery` unchanged.
- Cover: empty-after-strip fallback returns original text.
- Cover: case-insensitive matching (uppercase input).
- Cover: word-boundary enforcement ("grandelarge" does not match).
- Cover: first-match wins when two modifiers present.
- Cover: modifier stripped before chain slug segment (spec AC: `extractPortionModifier("pizza xl en burger-king-es")` → `{ cleanQuery: "pizza en burger-king-es", portionMultiplier: 1.5 }`).

**Extend `commands.test.ts`**
- New describe block `handleEstimar — portionModifier` (Steps 9 above).
- No changes to existing describe blocks other than fixture updates (Step 7).

**Extend `naturalLanguage.test.ts`**
- New describe block `handleNaturalLanguage — portionModifier integration` (Step 8 above).
- No changes to existing describe blocks other than fixture updates (Step 7).

**Extend `formatters.test.ts`**
- New describe block `formatEstimate — portionMultiplier` (Step 10 above).
- No changes to existing `formatEstimate` describe block other than fixture updates (Step 7).

**Extend `apiClient.test.ts`**
- New tests for `portionMultiplier` query-param forwarding (Step 6 above).

**No new integration tests required** — the bot layer is fully testable with mock `ApiClient`. The end-to-end behavior (bot → API → DB) is covered by the existing API integration tests in `packages/api/src/__tests__/`.

#### Key Patterns (Bot-Side)

- **Pattern array ordered longest-first** — same principle as `PREFIX_PATTERNS` in `naturalLanguage.ts` (line 27). Declare the multi-word entries (`extra grande`, `ración doble`, `media ración`) before the single-word ones (`grande`, `doble`, `media`) so short patterns never shadow the long ones.

- **Regex word boundaries for whole-word matching** — use `\b` around the pattern tokens. Multi-word tokens need `\b` only at the outermost edges: `/\bextra[\s-]grande\b/i`. The `\b` at the hyphen position is a natural boundary since `-` is a non-word character.

- **Omit `portionMultiplier` when 1.0, never send 0** — consistent with the `chainSlug` omission pattern already used: `if (params.chainSlug) sp['chainSlug'] = params.chainSlug`. Mirror the same conditional style for `portionMultiplier`. Never send `portionMultiplier=1` to the API — it would generate a distinct (wasted) cache key entry.

- **Article stripping NOT in `extractPortionModifier`** — "ración doble de arroz" correctly leaves "de arroz" as `cleanQuery`; the leading "de" is stripped by `extractFoodQuery`'s `ARTICLE_PATTERN` or `PREFIX_PATTERNS` downstream. Do not replicate article logic in the modifier function.

- **Pipeline order in `handleNaturalLanguage`** — `extractPortionModifier` runs on the raw trimmed text (before any prefix/article stripping). `extractFoodQuery` runs on `cleanQuery` output. This ensures "calorías de un big mac grande" works: modifier stripped first → "calorías de un big mac" → prefix + article stripped → "big mac".

- **Pipeline order in `handleEstimar`** — `parseEstimarArgs` runs first (chain slug extraction from the FULL args string). Then `extractPortionModifier` runs on the `query` portion only. This ensures "big mac grande en mcdonalds-es" correctly isolates chain slug before modifier stripping: `parseEstimarArgs` → `{ query: 'big mac grande', chainSlug: 'mcdonalds-es' }` → `extractPortionModifier('big mac grande')` → `{ cleanQuery: 'big mac', portionMultiplier: 1.5 }`.

- **`formatEstimate` layout contract** — When `portionMultiplier !== 1.0`, insert the combined Porción line immediately after the dish name (line 1) and before the blank line separator. Remove the existing bottom `portionGrams` line in that case (one line only — not two). When `portionMultiplier === 1.0`, the existing layout is preserved unchanged. Use a single conditional that checks `portionMultiplier !== 1.0` to decide which branch to take.

- **`escapeMarkdown` for multiplier value in label** — the multiplier value (e.g., "1.5") contains a dot which MarkdownV2 requires to be escaped. Use `escapeMarkdown(String(portionMultiplier))` rather than string interpolation, consistent with how `result.chainSlug` and other values are escaped in the existing formatter.

- **Mock sweep** — `makeMockClient` in both `commands.test.ts` and `naturalLanguage.test.ts` uses `[K in keyof ApiClient]: ReturnType<typeof vi.fn>`. Since the `estimate` method signature change adds only an optional param, the mock shape does not change — `vi.fn()` covers any call signature. No changes to `makeMockClient` itself are needed. Only the `EstimateData` fixture objects need updating (Step 7).

---

## Definition of Done

- [x] All acceptance criteria met (14/14)
- [x] Unit tests written and passing (69 new tests)
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds
- [x] Specs reflect final implementation (`api-spec.yaml` + shared schemas)

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` + `frontend-planner` executed, plan approved
- [x] Step 3: Implementation with TDD (10 steps)
- [x] Step 4: `production-code-validator` executed (5 issues found, 3 fixed), quality gates pass
- [x] Step 5: `code-review-specialist` executed — 1 critical (edge-cases fixture), 1 suggestion (label map semantics), both fixed
- [x] Step 5: `qa-engineer` executed — 71 edge-case tests, BUG-F042-01 (label semantics, resolved per code review)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-28 | Spec drafted | spec-creator + self-review. Fixed: ticket structure, portionGrams/label formatter interaction, Zod coercion note |
| 2026-03-28 | Spec reviewed | Gemini 2.5 (Codex auth failed). 1C+2I+1S. Fixed: removed L4 guard (CRITICAL — bot strips modifiers so L4 never sees them), added plural forms, article stripping delegated to extractFoodQuery |
| 2026-03-28 | Plan written + reviewed | backend-planner (Steps 1-4 API) + backend-planner (Steps 5-10 bot). Reviewed by Gemini (1C+1I+1S). Fixed: referenceBasis must be SET to per_serving (not remain) when multiplying per_100g results |
| 2026-03-28 | Implemented (Step 3) | 10 TDD steps, 69 new tests. Commit a230bbe |
| 2026-03-28 | Finalized (Step 4) | production-code-validator: 1C (spec portionGrams example), 1H (estimar error logging), 3M. All fixed. Quality gates pass. |
| 2026-03-28 | Code review (Step 5) | code-review-specialist: 1C (edge-cases fixture tsc), 1S (PORTION_LABEL_MAP 0.5→media). Both fixed. |
| 2026-03-28 | QA review (Step 5) | qa-engineer: 71 edge-case tests across 6 files. BUG-F042-01 label semantics — resolved (spec corrected per code review). All 140 new tests green. |

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

*Ticket created: 2026-03-28*
