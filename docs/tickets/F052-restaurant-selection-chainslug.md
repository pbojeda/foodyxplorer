# F052: Restaurant Selection chainSlug Propagation

**Feature:** F052 | **Type:** Bug | **Priority:** High
**Status:** Ready for Merge | **Branch:** feature/F052-restaurant-chainslug-fix
**Created:** 2026-03-29 | **Dependencies:** None
**Audit Source:** `docs/research/comprehensive-audit-2026-03-29.md` — Finding I1

---

## Spec

### Description

When a user selects a restaurant via inline keyboard (`sel:{uuid}` callback), the bot stores `selectedRestaurant: { id: uuid, name }` — **without `chainSlug`**. However, upload handlers (`fileUpload.ts:242`, `callbackQuery.ts:372`) destructure `chainSlug` from `selectedRestaurant` and pass it to the API.

**Root cause**: The `searchResults` map in `restaurante.ts:92-96` only stores `{ [uuid]: name }`, discarding all other fields from the API search response (which includes `chainSlug`, `countryCode`, etc.). When the `sel:{uuid}` callback fires (`callbackQuery.ts:244`), it can only recover `name` from `searchResults`.

**Impact**: Chain-specific upload metadata is lost for chain restaurants selected via search. The API receives `chainSlug: undefined` instead of the actual slug. Independent restaurants are unaffected (they have no chainSlug anyway).

**Similarly for `create_rest`**: When creating a restaurant (`callbackQuery.ts:285`), the response includes `chainSlug` but it's not stored in `selectedRestaurant` either (line ~290 stores only `{ id, name }`).

### Files to Modify

| File | Change |
|------|--------|
| `packages/bot/src/commands/restaurante.ts` | Store `chainSlug` alongside `name` in `searchResults` map. Change from `Record<string, string>` to `Record<string, { name: string; chainSlug?: string }>` or store as parallel map |
| `packages/bot/src/handlers/callbackQuery.ts` | `sel:{uuid}` handler: read chainSlug from enriched searchResults and include in selectedRestaurant. `create_rest` handler: include chainSlug from API response in selectedRestaurant |
| `packages/bot/src/lib/conversationState.ts` | Verify `BotState.searchResults` type supports the new shape (may need type update) |

### Design Considerations

- **Option A (minimal)**: Change `searchResults` to `Record<string, { name: string; chainSlug?: string }>`. Requires updating the `sel:` callback to read the enriched object.
- **Option B (cleaner)**: Store the full `RestaurantListItem` subset `{ name, chainSlug }` in searchResults. More future-proof.
- **Recommended**: Option B — small extra data, prevents future similar issues if more fields are needed.
- **Backward compatibility**: Redis may contain old-format searchResults (`Record<string, string>`). The `sel:` callback should handle both shapes gracefully during the transition (state has 2h TTL, so old data will expire naturally).

---

## Implementation Plan

N/A — Simple task.

---

## Acceptance Criteria

- [x] `searchResults` stores `chainSlug` alongside `name` for each restaurant
- [x] `sel:{uuid}` callback includes `chainSlug` in `selectedRestaurant` when available
- [x] `create_rest` callback includes `chainSlug` from API response in `selectedRestaurant`
- [x] Upload handlers (`uploadImage`, `uploadPdf`) receive correct `chainSlug` for chain restaurants
- [x] Independent restaurants (no chainSlug) still work correctly (undefined chainSlug)
- [x] Backward compatibility: old-format searchResults in Redis are handled gracefully
- [x] All existing tests pass (no regressions) — 1085 total (1079 + 6 new)
- [x] New regression tests: 6 tests in f052.chainslug-propagation.test.ts

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds (`tsc --noEmit`)

---

## Workflow Checklist

- [x] Step 1: Branch created, ticket updated, tracker updated
- [x] Step 3: TDD implementation (6 tests, RED→GREEN)
- [x] Step 4: Quality gates pass (1085 tests, tsc clean)
- [x] Step 5: PR created, merge checklist filled
- [ ] Step 6: Ticket updated, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-29 | Ticket created | From comprehensive audit finding I1 (Codex), verified in code |
| 2026-03-29 | Implementation | TDD: 6 tests. searchResults enriched with chainSlug, sel: + create_rest propagate, backward compat for old string format. 1 existing test updated. 1085 total passing |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Plan (N/A), AC, DoD, Workflow, Log, Evidence |
| 1. Mark all items | [x] | AC: 8/8, DoD: 5/5, Workflow: 4/5 (Step 6 pending) |
| 2. Verify product tracker | [x] | Active Session: step 5/6, Features table: 5/6 |
| 3. Update key_facts.md | [x] | N/A — no new endpoints or modules |
| 4. Update decisions.md | [x] | N/A — no ADR needed |
| 5. Commit documentation | [x] | Included in implementation commit |
| 6. Verify clean working tree | [x] | Clean after commit |

---

*Ticket created: 2026-03-29*
