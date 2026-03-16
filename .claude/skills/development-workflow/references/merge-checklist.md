# Merge Approval Checklist

> Execute ALL actions below IN ORDER before requesting merge approval from the user.
> Do NOT skip any action. Do NOT request merge approval until every action is complete.

## Action 0: Validate ticket structure (Std/Cplx)

Re-read the ticket file (`docs/tickets/<feature-id>.md`).

Verify it contains ALL required sections: **Acceptance Criteria**, **Definition of Done**, **Workflow Checklist**, **Completion Log**.

**If ANY section is missing**, add it from `references/ticket-template.md` before continuing.

## Action 1: Mark all items (Std/Cplx)

In the ticket file, mark ALL items `[x]` in:

- **Workflow Checklist** — Steps 0 through 5 (all that apply to this complexity tier)
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

## Action 7: Request merge approval

THEN — and only then — request merge approval from the user.
