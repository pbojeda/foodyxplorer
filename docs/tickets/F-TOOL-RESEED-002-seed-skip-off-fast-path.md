# F-TOOL-RESEED-002: Fast-path seed — skip OFF phase by default

**Feature:** F-TOOL-RESEED-002 | **Type:** Backend-Feature (tooling) | **Priority:** High
**Status:** Done | **Branch:** chore/seed-skip-off-F-TOOL-RESEED-002 (merged as PR #200, squash `2de94e9`)
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-04-23 | **Dependencies:** F-TOOL-RESEED-001 (landed as `332d263`)
**Complexity:** Simple

---

## Spec

### Description

F-TOOL-RESEED-001 shipped `reseed-all-envs.sh` but called `npm run db:seed`, which runs the entire seed pipeline end-to-end. The pipeline includes `seedPhaseOff` — an import of ~11 300 Open Food Facts products that takes roughly 15 minutes per environment.

For the common case (refreshing Spanish dishes + standard portions after a data merge), OFF does not need to be re-imported:

- OFF rows are upserted idempotently. Existing rows stay intact when the phase is skipped.
- F-H4, F-H4 round-2, and future dish-only rounds will touch `spanish-dishes.json` / `standard-portions.csv` only. OFF is untouched.

This ticket adds a `SEED_SKIP_OFF=1` env var gate in `packages/api/prisma/seed.ts` around the `seedPhaseOff` call. `reseed-all-envs.sh` sets it by default and exposes a new `--full` flag to opt back into OFF when it is actually needed (fresh Supabase bring-up or a Tier 0 OFF data change).

Estimated gain: dev + prod reseed drops from ~40 min to ~1–2 min for the common case.

### Edge Cases & Error Handling

- `SEED_SKIP_OFF` unset or set to anything other than `"1"` → OFF runs as before (backwards compatible).
- `--full` flag + `--prod` → full seed runs on dev, then on prod after the interactive confirmation.
- `--full` alone → full seed on dev only.
- No `--full`, default path → fast seed on dev (and prod if `--prod` is passed).

No data corruption possible: all seed phases use `upsert`, so any subset can be skipped without breaking referential integrity on an already-seeded database.

---

## Implementation Plan

N/A — Simple task.

Files to touch:
- `packages/api/prisma/seed.ts` — gate `seedPhaseOff` behind `process.env['SEED_SKIP_OFF'] === '1'`
- `packages/api/scripts/reseed-all-envs.sh` — add `INCLUDE_OFF` + `--full` flag; default sets `SEED_SKIP_OFF=1` when invoking `npm run db:seed`; log the mode
- `packages/api/scripts/README.md` — document fast vs full paths
- `docs/tickets/F-TOOL-RESEED-002-seed-skip-off-fast-path.md` — this ticket
- `docs/project_notes/product-tracker.md` — row under Quality & Documentation

---

## Acceptance Criteria

- [x] `seed.ts` skips `seedPhaseOff` when `SEED_SKIP_OFF=1` (logs the skip)
- [x] `reseed-all-envs.sh` default path exports `SEED_SKIP_OFF=1`
- [x] `reseed-all-envs.sh --full` path does NOT set `SEED_SKIP_OFF` (runs OFF)
- [x] Script header + README + `--help` document the new behavior
- [x] Mode is logged at start of the run (`FAST` vs `FULL`)
- [x] Backwards compatible: `npm run db:seed` invoked without env vars behaves as before (runs OFF)
- [x] Script validated offline: syntax, `--help`, error paths — live execution run by the operator

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Script manually re-validated (`bash -n` + smoke of error paths)
- [x] README reflects final behavior
- [x] Seed log clearly shows `Skipping OFF seed (SEED_SKIP_OFF=1).` when applicable

---

## Workflow Checklist

- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 3: Implementation
- [x] Step 4: Quality gates (bash syntax, self-review)
- [x] Step 5: Self code-review (Simple; cross-model review skipped — change surface is narrow and reviewed in F-TOOL-RESEED-001)
- [x] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-23 | Ticket created | F-TOOL-RESEED-002, Simple tier |
| 2026-04-23 | Script + seed.ts gate implemented + committed | `704cc7a` — 40 bash + 14 seed.ts gate + 23 README + 104 ticket + 3 tracker |
| 2026-04-23 | PR #200 squash-merged to develop | `2de94e9` — CI green (ci-success + test-api 4m16s) |
| 2026-04-23 | Post-merge live run — fast path validated | dev+prod reseed took ~6 min total (vs ~40 min previously). OFF correctly skipped (`Skipping OFF seed (SEED_SKIP_OFF=1).` logged). 279 dishes + 219 portions per env. |
| 2026-04-23 | Discovery post-merge: L3 gap | Zero-vector embeddings on 27 H4 dishes confirmed by audit. Triggered F-TOOL-RESEED-003 to automate `embeddings:generate` after the seed. |
| 2026-04-23 | Ticket housekeeping sync (post-merge) | Status → Done. Retroactive closing via chore/tracker-sync-reseed-tickets-close (this PR). |

---

## Merge Checklist Evidence

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | All 7 sections present (Spec, Implementation Plan, AC, DoD, Workflow Checklist, Completion Log, Merge Checklist Evidence) |
| 1. Mark all items | [x] | AC: 7/7, DoD: 4/4, Workflow: 5/5 |
| 2. Verify product tracker | [x] | F-TOOL-RESEED-002 row in Quality & Documentation — updated to `done 6/6` in this tracker-sync PR |
| 3. Update key_facts.md | [x] | N/A — tooling change, no product capability change |
| 4. Update decisions.md | [x] | N/A — Simple tier, no architectural decision |
| 5. Commit documentation | [x] | Pre-merge: `704cc7a` squashed as `2de94e9`. Post-merge housekeeping: this PR |
| 6. Verify clean working tree | [x] | Confirmed at merge time (PR #200 mergeStateStatus: CLEAN) |
| 7. Verify branch up to date | [x] | At merge: branched from `origin/develop`, CI green (test-api 4m16s) |

---

*Ticket created: 2026-04-23*
