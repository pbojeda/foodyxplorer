Review the Implementation Plan in the current ticket using an external model for independent critique.

## Prerequisites

- An external AI CLI tool installed: [Codex CLI](https://github.com/openai/codex), [Gemini CLI](https://github.com/google-gemini/gemini-cli), or similar
- An active feature with a completed Implementation Plan (Step 2)

## What to do

1. **Find the current ticket** — Read `docs/project_notes/product-tracker.md` → Active Session → ticket path
2. **Extract the plan** — Read the ticket's `## Implementation Plan` section
3. **Send to external reviewer** — Run the external CLI in read-only mode with this prompt:

```
You are reviewing an Implementation Plan for a software feature. Your job is to find problems, not praise.

Review the plan below and report:
1. **Errors** — Wrong assumptions, impossible steps, missing dependencies
2. **Gaps** — Missing error handling, edge cases, rollback scenarios
3. **Vagueness** — Steps too ambiguous to implement with TDD (no clear input/output)
4. **Over-engineering** — Unnecessary abstractions, premature optimization
5. **Order issues** — Steps that depend on later steps

For each issue, state: [CRITICAL/IMPORTANT/SUGGESTION] — description — proposed fix.

End with: VERDICT: APPROVED | VERDICT: REVISE (if any CRITICAL or 2+ IMPORTANT issues)

---
PLAN:
<paste the Implementation Plan here>
```

Example with Codex CLI:
```bash
codex exec -m o4-mini --quiet "Review this Implementation Plan: $(cat docs/tickets/FXXX-*.md | sed -n '/## Implementation Plan/,/## Acceptance Criteria/p')"
```

Example with Gemini CLI:
```bash
gemini -m gemini-2.5-pro "Review this Implementation Plan: $(cat docs/tickets/FXXX-*.md | sed -n '/## Implementation Plan/,/## Acceptance Criteria/p')"
```

4. **Process the review** — If VERDICT: REVISE, update the plan addressing CRITICAL and IMPORTANT issues
5. **Optional second round** — Send the revised plan for a final audit if significant changes were made
6. **Log the review** — Add a note in the ticket's Completion Log: "Plan reviewed by [model] — N issues found, N addressed"

## Notes

- This command is **optional** — the workflow's built-in Plan Self-Review (Step 2.4) always runs automatically
- Most valuable for **Complex** features or plans with 8+ steps
- The external model runs read-only — it reviews text, not code
- If no external CLI is available, you can copy-paste the plan into a different AI chat for manual review
