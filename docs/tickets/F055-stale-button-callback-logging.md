# F055: Inline Keyboard Stale-Button Mitigation + Callback Logging

**Feature:** F055 | **Type:** Bug | **Priority:** Low
**Status:** Done | **Branch:** (merged to develop, deleted)
**Created:** 2026-03-29 | **Dependencies:** None
**Audit Source:** `docs/research/comprehensive-audit-2026-03-29.md` — Findings I7, S6

---

## Spec

### Description

Two related inline-keyboard issues:

**Bug 1 (I7 — IMPORTANT): Stale-button race condition**

The bot stores only one `pendingPhotoFileId` and one `pendingSearch` per chat, while callback data is generic (`upload_menu`, `upload_dish`, `create_rest`). If the user sends multiple photos or multiple `/restaurante` searches before pressing a button, old keyboards act on the newest state — not the state they were created for.

**Example scenario:**
1. User sends Photo A → bot stores `pendingPhotoFileId: fileA`, shows keyboard
2. User sends Photo B → bot stores `pendingPhotoFileId: fileB`, shows keyboard
3. User presses "Analizar menú" on Photo A's keyboard → bot downloads Photo B (wrong photo)

**Bug 2 (S6 — SUGGESTION): Unknown callback_data silently swallowed**

Unknown callback payloads only dismiss the Telegram spinner (`safeAnswerCallback`). No logging occurs. This hides stale-keyboard bugs, malformed callback data, and future regressions.

### Files to Modify

| File | Change |
|------|--------|
| `packages/bot/src/handlers/fileUpload.ts` | Encode `file_id` or a nonce in callback data (e.g., `upload_menu:{nonce}`) |
| `packages/bot/src/handlers/callbackQuery.ts` | Parse nonce from callback data, validate against stored state. Add `logger.warn` for unknown callback_data |
| `packages/bot/src/commands/restaurante.ts` | Consider encoding a search nonce in `sel:{uuid}:{nonce}` or `create_rest:{nonce}` |

### Design Considerations

**I7 — Stale-button mitigation:**

- **Option A (nonce in callback data)**: Generate a random nonce when storing pending state, include it in callback data (e.g., `upload_menu:{nonce}`). On callback, verify nonce matches stored state. If not, answer with "Esta acción ya no es válida. Envía la foto de nuevo." Telegram callback data limit is 64 bytes — `upload_menu:abc123def` fits easily.
- **Option B (encode file_id in callback data)**: Include the actual `file_id` (or its first N chars) in callback data. Avoids needing a separate nonce. But file_ids can be long (up to ~100 chars) and may exceed the 64-byte limit.
- **Option C (accept and document)**: Note the limitation in the manual. Low priority for 1:1 bot usage.
- **Recommended**: Option A — small change, robust, fits within Telegram limits.

**S6 — Callback logging:**

- Simple `logger.warn({ chatId, data: query.data }, 'Unknown callback_data received')` in the default branch.

---

## Implementation Plan

N/A — Simple task.

---

## Acceptance Criteria

### I7 — Stale-button mitigation
- [x] Photo keyboard callback data includes a nonce (e.g., `upload_menu:{nonce}`)
- [x] Callback handler validates nonce against stored state
- [x] Stale button press (wrong nonce) shows user-friendly message and does NOT process the action
- [x] Fresh button press (matching nonce) works as before
- [x] Restaurant search keyboard: accepted risk (documented — low impact for 1:1 bot)

### S6 — Callback logging
- [x] Unknown callback_data values are logged at `warn` level with `chatId` and payload
- [x] Valid callbacks are NOT logged at warn (no noise)
- [x] All existing tests pass (no regressions) — 1106 total (1097 + 9 new)
- [x] New tests: 9 in f055.stale-button-callback-logging.test.ts + 6 existing tests updated

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
- [x] Step 3: TDD implementation (9 tests, RED→GREEN, 6 existing updated)
- [x] Step 4: Quality gates pass (1106 tests, tsc clean)
- [x] Step 5: PR created (#51), review
- [x] Step 6: Ticket updated, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-29 | Ticket created | From comprehensive audit findings I7 (Codex) + S6 (Claude, Codex) |
| 2026-03-29 | Implementation | I7: nonce (8 hex chars) in callback_data, validated in callbackQuery handler. Stale buttons → "Esta acción ya no es válida". Restaurant search: accepted risk. S6: logger.warn for unknown callback_data. 9 new tests, 6 updated, 1106 total |
| 2026-03-29 | Squash merged to develop | SHA c086e6e, PR #51. Branch deleted |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Plan (N/A), AC, DoD, Workflow, Log, Evidence |
| 1. Mark all items | [x] | AC: 9/9 (I7: 5/5, S6: 4/4), DoD: 5/5, Workflow: 4/5 (Step 6 pending) |
| 2. Verify product tracker | [x] | Active Session: step 5/6, Features table: 5/6 |
| 3. Update key_facts.md | [x] | N/A — no new endpoints or modules |
| 4. Update decisions.md | [x] | N/A — no ADR needed |
| 5. Commit documentation | [x] | Included in docs commit |
| 6. Verify clean working tree | [x] | Clean after commit (untracked files are pre-existing tickets) |

---

*Ticket created: 2026-03-29*
