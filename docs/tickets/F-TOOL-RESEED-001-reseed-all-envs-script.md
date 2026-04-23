# F-TOOL-RESEED-001: Reseed-all-envs operator script

**Feature:** F-TOOL-RESEED-001 | **Type:** Backend-Feature (tooling) | **Priority:** Medium
**Status:** In Progress | **Branch:** chore/tooling-reseed-script
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-04-22 | **Dependencies:** None
**Complexity:** Simple

---

## Spec

### Description

Every time we add dishes (F073, F114, F-H4, future rounds) we must re-run `db:seed` + `seed:standard-portions` on both dev and prod. Today the flow is manual: edit `packages/api/.env` → run seed for dev → edit `.env` again → run seed for prod. This is error-prone and easy to forget half.

This ticket adds a single operator script `packages/api/scripts/reseed-all-envs.sh` that:

1. Reads two env vars `DATABASE_URL_DEV` and `DATABASE_URL_PROD` (one-time setup in `.env`).
2. Runs `npm run db:seed -w @foodxplorer/api` + `npm run seed:standard-portions -w @foodxplorer/api` against dev by default.
3. When invoked with `--prod`, prompts for explicit confirmation and then runs the same two commands against prod.
4. After each environment: prints seed counts (dishes, standard_portions rows) and reports pass/fail.
5. Restores the original `DATABASE_URL` on exit (original `.env` left untouched — script only sets DATABASE_URL in its own process environment).

### Edge Cases & Error Handling

- Missing `DATABASE_URL_DEV` → exit 1 with clear message.
- `--prod` requested but `DATABASE_URL_PROD` not set → exit 1.
- Seed command fails → exit 1, do NOT continue to prod.
- Post-seed count validation fails → exit 1, print diagnostic.
- User declines prod confirmation prompt → exit 0 (dev was successful), print "prod skipped".

---

## Implementation Plan

N/A — Simple task.

Files to touch:
- `packages/api/scripts/reseed-all-envs.sh` (new)
- `packages/api/scripts/README.md` (add section)
- `.env.example` (document new `DATABASE_URL_DEV` / `DATABASE_URL_PROD`)

---

## Acceptance Criteria

- [x] `reseed-all-envs.sh` exists at `packages/api/scripts/` with executable permissions
- [x] Runs `db:seed` + `seed:standard-portions` against dev using `DATABASE_URL_DEV`
- [x] `--prod` flag adds a prod run after interactive confirmation
- [x] Validates 279 dishes + ≥220 standard_portions rows post-seed per environment
- [x] Exits non-zero if any seed command or validation fails
- [x] Does NOT continue to prod if dev failed
- [x] README.md updated with usage + dependencies
- [x] `.env.example` documents the two new optional env vars
- [x] Script validated via `bash -n` syntax check + error-path smoke tests (unknown flag, missing env vars, --help). Live DB seed executed by operator post-merge — not by the agent.

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Script validated offline: syntax, error paths, --help output. Live dev/prod seeding is run by the operator after merge (out of scope for the agent).
- [x] Code follows project shell-script conventions (set -e, shellcheck-clean where possible)
- [x] No linting errors on staged code (bash not in npm lint — manual shellcheck pass if available)
- [x] README + .env.example updated
- [x] Docs reflect final command names

---

## Workflow Checklist

- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 3: TDD / manual smoke test
- [x] Step 4: Quality gates (manual verify + shellcheck if available)
- [x] Step 5: `code-review-specialist` executed (self-review; Simple)
- [x] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-22 | Ticket created | F-TOOL-RESEED-001, Simple tier |
| 2026-04-22 | Script + docs committed | `cbda4b4` — 169 bash + 42 README + 7 .env.example + 104 ticket + 1 tracker |
| 2026-04-22 | PR #198 opened | base `develop`, squash merge planned |
| 2026-04-23 | Cross-model review (Gemini + Codex) | 3 IMPORTANT + 3 SUGGESTION. Fixes: (1) strip `?pgbouncer=true` before psql call, (2) explicit error message for `DATABASE_URL_PRO` typo, (3) promote psql validation failures from warn to fail, (4) drop redundant `set -a` around `.env` sourcing, (5) backticks on env var names in header. Skipped: `while/case/shift` rewrite (style-only). |

---

## Merge Checklist Evidence

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | — |
| 1. Mark all items | [ ] | — |
| 2. Verify product tracker | [ ] | — |
| 3. Update key_facts.md | [ ] | — |
| 4. Update decisions.md | [ ] | — |
| 5. Commit documentation | [ ] | — |
| 6. Verify clean working tree | [ ] | — |
| 7. Verify branch up to date | [ ] | — |

---

*Ticket created: 2026-04-22*
