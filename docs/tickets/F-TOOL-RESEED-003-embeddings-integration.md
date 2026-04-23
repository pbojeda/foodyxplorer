# F-TOOL-RESEED-003: Integrate embeddings:generate into reseed-all-envs.sh

**Feature:** F-TOOL-RESEED-003 | **Type:** Backend-Feature (tooling) | **Priority:** High
**Status:** Done | **Branch:** chore/seed-embeddings-F-TOOL-RESEED-003 (merged as PR #201, squash `0dca029`)
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-04-23 | **Dependencies:** F-TOOL-RESEED-001 (`332d263`), F-TOOL-RESEED-002 (`2de94e9`)
**Complexity:** Simple

---

## Spec

### Description

`reseed-all-envs.sh` (F-TOOL-RESEED-001 + -002) re-applies `db:seed` and `seed:standard-portions` end-to-end. The seed places **zero-vector embeddings** for newly added dishes so pgvector queries don't error out, but those placeholders break **L3 semantic search** for the affected dishes until they are replaced with real OpenAI embeddings.

Empirical audit of dev and prod after F-H4 (2026-04-23): both environments have 279 cocina-espanola dishes; the 252 pre-H4 dishes have real embeddings, but the 27 H4 dishes (CE-253..CE-279) are zero-vectors with `embedding_updated_at IS NULL`. Users issuing queries that would hit L3 on regional dishes ("gofio con leche", "zarangollo con calabacín") will not resolve correctly until embeddings are generated.

Future dish-add rounds (H5, H6, ...) will repeat this pattern. The operator process should be a **single command** that produces a fully-functional catalog end-to-end, not two steps that are easy to forget half of.

### Behavior

Add Phase 3 to `reseed-all-envs.sh`:

```
Phase 1/3: npm run db:seed (fast — SEED_SKIP_OFF=1)
Phase 2/3: npm run seed:standard-portions
Phase 3/3: npm run embeddings:generate -- --target dishes --chain-slug cocina-espanola
```

- Phase 3 runs **without `--force`**. The pipeline's built-in `WHERE embedding_updated_at IS NULL` clause means the call only hits the rows the seed just placed — existing real embeddings are skipped, cost is proportional to new-dish count (~$0.00005 per 27 dishes at `text-embedding-3-small`).
- Requires `OPENAI_API_KEY`. Missing key → exit 1 with clear message **before Phase 1 runs**, unless `--skip-embeddings` is passed.
- New flag `--skip-embeddings` opts out entirely (for local dev without a key). Prints a warning that L3 will degrade for new dishes.
- Start-of-run banner shows `Embeddings: ENABLED (Phase 3)` or `SKIPPED (--skip-embeddings)`.
- `--help` range widened to cover the expanded Flags section.

### Edge cases & error handling

- `OPENAI_API_KEY` missing AND `--skip-embeddings` NOT passed → exit 1 immediately (before seeds run) so the operator doesn't wait for Phase 1 only to fail on Phase 3.
- `OPENAI_API_KEY` set + `--skip-embeddings` passed → warn that L3 will degrade and skip. The flag is strictly an opt-out; no silent skip when the key is present.
- Phase 3 fails mid-run → `fail` + exit 1 (same pattern as Phases 1/2). Seeds already committed are idempotent; re-running the script is safe.
- `--full` + Phase 3 coexist (orthogonal): `--full` controls OFF, `--skip-embeddings` controls L3.

---

## Implementation Plan

N/A — Simple task.

Files touched:
- `packages/api/scripts/reseed-all-envs.sh` — add `SKIP_EMBEDDINGS` flag, Phase 3 step, pre-flight OPENAI check, updated logging
- `packages/api/scripts/README.md` — document Phase 3 + `--skip-embeddings`
- `docs/tickets/F-TOOL-RESEED-003-embeddings-integration.md` — this ticket
- `docs/project_notes/product-tracker.md` — row under Quality & Documentation

---

## Acceptance Criteria

- [x] `reseed-all-envs.sh` exposes `--skip-embeddings` flag (documented in header + `--help` + usage)
- [x] Phase 3 runs `npm run embeddings:generate -- --target dishes --chain-slug cocina-espanola` in each environment after Phase 2 completes
- [x] Script validates `OPENAI_API_KEY` is set BEFORE Phase 1 when embeddings are enabled
- [x] Missing `OPENAI_API_KEY` + no `--skip-embeddings` → exit 1 with actionable message
- [x] `--skip-embeddings` bypasses the OPENAI check and skips Phase 3 with a visible warning
- [x] Start-of-run banner logs `Embeddings: ENABLED` vs `SKIPPED`
- [x] Phase labels updated to `1/3`, `2/3`, `3/3` (or `1/2`, `2/2` with `--skip-embeddings`)
- [x] README reflects the three-phase model + cost guidance
- [x] `bash -n` syntax pass + error-path smoke tests (unknown flag, OPENAI missing, bypass works, `--help`)

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Script validated offline (syntax, help, error paths)
- [x] README + ticket + tracker synced
- [x] Cross-model review (Gemini + Codex) addressed — see Completion Log
- [x] Live run deferred to operator: execute `./packages/api/scripts/reseed-all-envs.sh --prod` after merge and verify Phase 3 JSON output matches expected delta (27 dishes processed on both envs)

---

## Workflow Checklist

- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 3: Implementation
- [x] Step 4: Quality gates (bash syntax, self-review)
- [x] Step 5: Cross-model review — Gemini + Codex
- [x] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-23 | Ticket created | F-TOOL-RESEED-003, Simple tier |
| 2026-04-23 | Step 3 — implementation | Phase 3 added to `reseed-all-envs.sh`; `SKIP_EMBEDDINGS` flag + OPENAI pre-flight check; seed.ts unchanged (pipeline's built-in `WHERE embedding_updated_at IS NULL` suffices) |
| 2026-04-23 | Step 4 — offline smoke tests | `bash -n` syntax pass; `--help` prints all 69 header lines; unknown flag lists `[--prod] [--full] [--skip-embeddings]`; OPENAI_API_KEY truly unset (via temp rename of `.env`) → exit 1 with actionable message; `--skip-embeddings` bypass works; `--full` triggers OFF-embeddings warning banner; phase labels correctly show 1/3 vs 1/2 |
| 2026-04-23 | Step 5 — cross-model review (Gemini + Codex parallel) | Gemini CRITICAL: `--full` misleading re: OFF embeddings scope → banner warning added. Codex IMPORTANT: `SEED_SKIP_OFF=""` insufficient → switched to `env -u SEED_SKIP_OFF` for `--full`. Gemini IMPORTANT: least-privilege for OPENAI → captured + unset + re-passed only to Phase 3. Codex SUGGESTION: actionable `--skip-embeddings` handoff → printed exact `DATABASE_URL_<LABEL>` command. Codex SUGGESTION: "safe to re-run" → added to Phase 3 failure message. Skipped: sed-range brittleness (low value, adds complexity). |
| 2026-04-23 | PR #201 squash-merged to develop | `0dca029` — CI green (ci-success + test-api 4m29s) |
| 2026-04-23 | Step 6 — post-merge live run (dev + prod) | `processedDishes: 27` on both envs; `processedFoods: 0`. Phase 3 duration ~30 s per env. Cost ~$0.0001 total. |
| 2026-04-23 | Step 6 — post-merge verification | Inspection script shows **279 REAL / 0 ZERO / 0 NULL** cocina-espanola dishes on dev AND prod. L3 semantic search now fully functional for all 279 dishes including the 27 F-H4 regional ones. |
| 2026-04-23 | Ticket housekeeping sync (post-merge) | Status → Done. Retroactive closing via chore/tracker-sync-reseed-tickets-close (this PR). |

---

## Merge Checklist Evidence

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | All 7 sections present (Spec, Implementation Plan, AC, DoD, Workflow Checklist, Completion Log, Merge Checklist Evidence) |
| 1. Mark all items | [x] | AC: 9/9, DoD: 5/5, Workflow: 5/5 |
| 2. Verify product tracker | [x] | F-TOOL-RESEED-003 row in Quality & Documentation — updated to `done 6/6` in this tracker-sync PR with SHA `0dca029` and post-merge note (279 REAL / 0 ZERO / 0 NULL) |
| 3. Update key_facts.md | [x] | N/A — tooling change, no product capability change |
| 4. Update decisions.md | [x] | N/A — Simple tier, no architectural decision |
| 5. Commit documentation | [x] | Pre-merge: `ed05c74` squashed as `0dca029`. Post-merge housekeeping: this PR |
| 6. Verify clean working tree | [x] | Confirmed at merge time (PR #201 mergeStateStatus: CLEAN) |
| 7. Verify branch up to date | [x] | At merge: branched from `origin/develop`, CI green (ci-success + test-api 4m29s) |

---

*Ticket created: 2026-04-23*
