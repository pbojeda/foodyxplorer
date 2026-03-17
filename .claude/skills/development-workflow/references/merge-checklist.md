# Merge Approval Checklist

> Execute ALL actions below IN ORDER before requesting merge approval from the user.
> Do NOT skip any action. Do NOT request merge approval until every action is complete.

## Action 0: Validate ticket structure

Re-read the ticket file (`docs/tickets/<feature-id>.md`).

Verify it contains ALL required sections: **Acceptance Criteria**, **Definition of Done**, **Workflow Checklist**, **Completion Log**, **Merge Checklist Evidence**.

**If ANY section is missing**, add it from `references/ticket-template.md` before continuing.

**Simple (lite ticket):** Verify same sections exist. Spec and Implementation Plan may be minimal (one-liner / N/A).

## Action 1: Mark all items

In the ticket file, mark ALL items `[x]` in:

- **Workflow Checklist** — all steps that apply to this complexity tier (Simple: 1, 3, 4, 5. Standard: 0–5. Complex: 0–5)
- **Acceptance Criteria** — every item
- **Definition of Done** — every item

Add missing **Completion Log** entries: one row per step with date, action, and notes.

## Action 2: Verify product tracker

Re-read `docs/project_notes/product-tracker.md`.

- **Active Session** must show step `5/6 (Review)` with current context.
- **Features table** must show step `5/6` and status `in-progress`.

Fix if stale.

## Action 3: Update key_facts.md

If this feature added new models, schemas, migrations, endpoints, reusable components, error codes, or shared utilities → update `docs/project_notes/key_facts.md`.

## Action 4: Update decisions.md

If Definition of Done requires an ADR → add it to `docs/project_notes/decisions.md`.

## Action 5: Commit documentation

Commit ALL documentation updates from actions 0–4. Use commit message: `docs: update ticket, tracker, and project docs for <feature-id>`.

## Action 6: Verify clean working tree

Run `git status`. **No unstaged or untracked files allowed.** If any remain, stage and commit them.

## Action 7: Fill Merge Checklist Evidence

In the ticket, fill the `## Merge Checklist Evidence` table. For each action (0–6), mark `[x]` and write the actual evidence (not placeholders). Example:

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Plan, AC, DoD, Workflow, Log, Evidence |
| 1. Mark all items | [x] | AC: 12/12, DoD: 7/7, Workflow: 0-5/6 |

## Action 8: Request merge approval

Verify the Merge Checklist Evidence table is fully filled (all rows `[x]` with real evidence).

THEN — and only then — request merge approval from the user.
