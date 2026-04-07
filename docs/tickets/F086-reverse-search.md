# F086: Reverse Search

**Feature:** F086 | **Type:** Backend-Feature | **Priority:** Medium
**Status:** In Progress | **Branch:** feature/F086-reverse-search
**Created:** 2026-04-07 | **Dependencies:** None (dishes + dish_nutrients populated, catalog routes exist)

---

## Spec

### Description

Reverse search: given a calorie budget (and optional protein minimum), return chain dishes that fit the constraints. "Estoy en BK, me quedan 600 kcal, necesito 30g proteína. ¿Qué pido?"

Two entry points:
1. **API endpoint:** `GET /reverse-search?chainSlug=burger-king&maxCalories=600&minProtein=30`
2. **Conversation intent:** "qué como con 600 kcal en BK" → new `reverse_search` intent in ConversationCore

Results are sorted by protein density (proteins/calories ratio) descending, showing the most nutritionally efficient options first.

Source: product-evolution-analysis Sec 9 Tier 2 — "Reverse search — Estoy en BK, me quedan 600 kcal, necesito 30g proteína. ¿Qué pido?"

### API Changes

#### New endpoint: `GET /reverse-search`

Query parameters:
- `chainSlug` (string, required) — chain to search within
- `maxCalories` (number, required, min 100, max 3000) — calorie budget
- `minProtein` (number, optional, min 0, max 200) — minimum protein requirement
- `limit` (number, optional, default 5, max 20) — max results

Response: `{ success: true, data: ReverseSearchData }`

```typescript
ReverseSearchData = {
  chainSlug: string;
  chainName: string;
  maxCalories: number;
  minProtein: number | null;
  results: ReverseSearchResult[];
  totalMatches: number;
}

ReverseSearchResult = {
  name: string;
  nameEs: string | null;
  calories: number;
  proteins: number;
  fats: number;
  carbohydrates: number;
  portionGrams: number | null;
  proteinDensity: number; // proteins / calories * 100
}
```

#### Conversation intent: `reverse_search`

- New intent added to `ConversationIntentSchema`
- Entity extraction: detect patterns like "qué como con X kcal", "me quedan X kcal", "X calorías qué pido"
- Response includes `reverseSearch: ReverseSearchData` in `ConversationMessageDataSchema`
- Requires chain context (active context or explicit in query). Without chain → error message.

### Edge Cases & Error Handling

- No chain context → 422 with message "Necesito saber en qué cadena estás. Usa 'estoy en <cadena>' primero."
- Unknown chainSlug → 404 CHAIN_NOT_FOUND
- No dishes match constraints → empty results array (not an error)
- maxCalories < 100 or > 3000 → Zod validation error
- Dishes with reference_basis = per_100g are excluded (only per_serving dishes are comparable)
- Only `available` dishes (not discontinued/seasonal) are returned
- Null nutrient values treated as 0 for comparison purposes

---

## Implementation Plan

### Step 1: Shared schemas (ReverseSearchData, ReverseSearchResult, query params)

Create schemas in `packages/shared/src/schemas/reverseSearch.ts`:
- `ReverseSearchQuerySchema` — Zod for query params (chainSlug required, maxCalories required, minProtein optional, limit optional with default 5)
- `ReverseSearchResultSchema` — single dish result with macros + proteinDensity
- `ReverseSearchDataSchema` — response payload (chainSlug, chainName, constraints, results array, totalMatches)
- Add `reverse_search` to `ConversationIntentSchema` in `conversation.ts`
- Add `reverseSearch: ReverseSearchDataSchema.optional()` to `ConversationMessageDataSchema`
- Export from `packages/shared/src/index.ts`

**Tests (TDD):** Schema validation tests — valid/invalid params, edge values.

### Step 2: Reverse search query module

Create `packages/api/src/estimation/reverseSearch.ts`:
- `reverseSearchDishes(db, params)` — Kysely query:
  1. CTE `ranked_dn` to de-duplicate dish_nutrients (most recent per dish, same pattern as level1Lookup)
  2. JOIN dishes → restaurants → ranked_dn
  3. WHERE `r.chain_slug = chainSlug` AND `dn.reference_basis = 'per_serving'` AND `d.availability = 'available'`
  4. AND `dn.calories <= maxCalories`
  5. AND (if minProtein) `dn.proteins >= minProtein`
  6. SELECT name, nameEs, calories, proteins, fats, carbohydrates, portionGrams
  7. Calculate `proteinDensity = proteins / calories * 100` (handle zero calories → 0)
  8. ORDER BY proteinDensity DESC, calories ASC
  9. LIMIT (default 5, max 20)
  10. Also return totalMatches (COUNT before LIMIT)
- Resolve chainName from restaurants table

**Tests (TDD):** Unit tests with mocked db — valid query, no matches, zero calories handling, limit.

### Step 3: API route `GET /reverse-search`

Create route in `packages/api/src/routes/reverseSearch.ts`:
- Register as Fastify plugin (same pattern as estimate.ts)
- Validate query params with `ReverseSearchQuerySchema`
- Call `reverseSearchDishes(db, params)`
- Handle CHAIN_NOT_FOUND (no restaurant found for chainSlug)
- Return `{ success: true, data: ReverseSearchData }`
- Register in `packages/api/src/routes/index.ts`
- Update `docs/specs/api-spec.yaml` with endpoint + schemas

**Tests (TDD):** Route integration tests — valid request, missing chainSlug, invalid maxCalories, unknown chain, empty results.

### Step 4: Entity extraction for reverse search patterns

Add to `packages/api/src/conversation/entityExtractor.ts`:
- `detectReverseSearch(text)` — regex to detect patterns:
  - "qué como con X kcal" / "que como con X kcal"
  - "qué pido con X kcal" / "que pido con X kcal"
  - "me quedan X kcal" / "me quedan X calorías"
  - "X kcal qué pido" / "X calorías qué como"
  - Optional protein: "necesito Xg proteína" / "mínimo Xg proteínas"
- Returns `{ maxCalories: number, minProtein?: number } | null`

**Tests (TDD):** Entity extraction tests — all patterns, with/without protein, edge cases.

### Step 5: ConversationCore integration

Add reverse search intent to `packages/api/src/conversation/conversationCore.ts`:
- Add `detectReverseSearch` check AFTER context-set but BEFORE comparison
- If detected + chain context available → call `reverseSearchDishes()`
- If detected + no chain context → return error message asking for chain
- Populate `reverseSearch` field in response data

**Tests (TDD):** ConversationCore tests — reverse search with context, without context, with protein.

### Step 6: Bot formatter

Add to `packages/bot/src/formatters/`:
- New `reverseSearchFormatter.ts` — format ReverseSearchData for Telegram MarkdownV2
- Show chain name, constraints, then numbered list of dishes with macros
- Handle empty results gracefully

**Tests (TDD):** Formatter tests — with results, empty results, with protein constraint.

---

## Acceptance Criteria

- [ ] `GET /reverse-search` endpoint with chainSlug, maxCalories, minProtein, limit params
- [ ] Dishes filtered by calorie budget and optional protein minimum
- [ ] Results sorted by protein density descending
- [ ] totalMatches count returned alongside limited results
- [ ] Only `available` + `per_serving` dishes returned
- [ ] `reverse_search` intent added to ConversationIntentSchema
- [ ] Entity extraction detects "qué como con X kcal" and similar patterns
- [ ] ConversationCore handles reverse search with chain context
- [ ] Error message when no chain context set
- [ ] Bot formatter renders reverse search results
- [ ] API spec updated with endpoint and schemas
- [ ] Unit tests for query module, route, entity extraction, conversation, formatter
- [ ] All tests pass
- [ ] Build succeeds

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Unit tests written and passing
- [ ] Code follows project standards
- [ ] No linting errors
- [ ] Build succeeds
- [ ] API spec updated (new endpoint + schemas)
- [ ] Shared schemas exported and typed

---

## Workflow Checklist

- [ ] Step 0: Spec created, self-reviewed
- [ ] Step 1: Branch created, ticket generated, tracker updated
- [ ] Step 2: Implementation plan written, self-reviewed
- [ ] Step 3: Implementation with TDD
- [ ] Step 4: Quality gates pass, `production-code-validator` executed
- [ ] Step 5: `code-review-specialist` + `qa-engineer` executed
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-07 | Spec | Spec written with 6-step implementation plan |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | |
| 1. Mark all items | [ ] | |
| 2. Verify product tracker | [ ] | |
| 3. Update key_facts.md | [ ] | |
| 4. Update decisions.md | [ ] | |
| 5. Commit documentation | [ ] | |
| 6. Verify clean working tree | [ ] | |

---

*Ticket created: 2026-04-07*
