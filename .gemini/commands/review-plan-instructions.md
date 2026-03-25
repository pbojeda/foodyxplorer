## Review Plan — Instructions

Review the Implementation Plan in the current ticket using external models for independent critique.

### Prerequisites

- An active feature with a completed Implementation Plan (Step 2)
- Ideally, one or more external AI CLIs installed: Codex CLI, Claude Code, or similar

### Steps

1. **Find the current ticket** — Read `docs/project_notes/product-tracker.md` → Active Session → ticket path

2. **Detect available reviewers** — Check which external CLIs are installed:

```bash
command -v claude >/dev/null 2>&1 && echo "claude: available" || echo "claude: not found"
command -v codex >/dev/null 2>&1 && echo "codex: available" || echo "codex: not found"
```

3. **Prepare the review input** — Extract the spec and plan into a temp file with the review prompt. Use the feature ID from the Active Session (e.g., `F023`):

```bash
TICKET="$(echo docs/tickets/F023-*.md)"  # Use the feature ID from Step 1; verify exactly one match
REVIEW_DIR="/tmp/review-plan-$(basename "$PWD")"
mkdir -p "$REVIEW_DIR"

cat > "$REVIEW_DIR/input.txt" <<'CRITERIA'
You are reviewing an Implementation Plan for a software feature. Your job is to find real problems, not praise. But if the plan is solid, say APPROVED — do not manufacture issues that are not there.

Below you will find the Spec (what to build) and the Implementation Plan (how to build it). Review the plan and report:
1. Errors — Wrong assumptions, impossible steps, missing dependencies, plan contradicts the spec
2. Gaps — Missing error handling, edge cases, rollback scenarios
3. Vagueness — Steps too ambiguous to implement with TDD (no clear input/output)
4. Over-engineering — Unnecessary abstractions, premature optimization
5. Order issues — Steps that depend on later steps

For each issue, state: [CRITICAL/IMPORTANT/SUGGESTION] — description — proposed fix.

End with: VERDICT: APPROVED | VERDICT: REVISE (if any CRITICAL or 2+ IMPORTANT issues)

---
SPEC AND PLAN:
CRITERIA

sed -n '/^## Spec$/,/^## Acceptance Criteria$/p' "$TICKET" >> "$REVIEW_DIR/input.txt"
```

4. **Send for review** — Execute **only one** of the following paths based on Step 2 results:

#### Path A: Both CLIs available (best — two independent perspectives)

```bash
cat "$REVIEW_DIR/input.txt" | claude --print > "$REVIEW_DIR/claude.txt" 2>&1 &
PID_CLAUDE=$!
cat "$REVIEW_DIR/input.txt" | codex exec - > "$REVIEW_DIR/codex.txt" 2>&1 &
PID_CODEX=$!

wait $PID_CLAUDE && echo "Claude: OK" || echo "Claude: FAILED (exit $?) — check $REVIEW_DIR/claude.txt"
wait $PID_CODEX && echo "Codex: OK" || echo "Codex: FAILED (exit $?) — check $REVIEW_DIR/codex.txt"

echo "=== CLAUDE REVIEW ===" && cat "$REVIEW_DIR/claude.txt"
echo "=== CODEX REVIEW ===" && cat "$REVIEW_DIR/codex.txt"
```

Consolidate findings — issues flagged by both models independently carry higher weight. Deduplicate and prioritize. Ignore output from any reviewer that failed.

#### Path B: One CLI available

```bash
# Claude only
cat "$REVIEW_DIR/input.txt" | claude --print

# Codex only
cat "$REVIEW_DIR/input.txt" | codex exec -
```

#### Path C: No external CLI available (self-review fallback)

If no external CLI is installed, perform the review yourself. Re-read the full Implementation Plan from the ticket, then review it with this mindset:

> Review the plan one more time trying to find any flaw, anything we might have forgotten, or any improvement that is missing. This is a very important part of the project and it is worth doing well. Do your best effort.

Apply the same 5 criteria from the prompt above. For each issue, state severity, description, and proposed fix. End with VERDICT.

5. **Process the review** — If any VERDICT is REVISE, update the plan addressing CRITICAL and IMPORTANT issues
6. **Optional second round** — Send the revised plan for a final audit if significant changes were made
7. **Log the review** — Add a note in the ticket's Completion Log: "Plan reviewed by [model(s) or self-review] — N issues found, N addressed"

### Notes

- This command is **optional** — the workflow's built-in Plan Self-Review (Step 2.4) always runs automatically
- Most valuable for Complex features or plans with 8+ steps
- External models run read-only — they review text, not code
- Both CLIs use their latest default model when no `-m` flag is specified — no need to hardcode model names
- Path C (self-review) is a last resort — external review gives genuinely independent perspectives that self-review cannot
