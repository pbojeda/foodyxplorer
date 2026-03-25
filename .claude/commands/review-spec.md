Review the Spec in the current ticket using external models for independent critique before planning.

## Prerequisites

- An active feature with a completed Spec (Step 0)
- Ideally, one or more external AI CLIs installed: [Gemini CLI](https://github.com/google-gemini/gemini-cli), [Codex CLI](https://github.com/openai/codex), or similar

## What to do

1. **Find the current ticket** — Read `docs/project_notes/product-tracker.md` → Active Session → ticket path

2. **Detect available reviewers** — Check which external CLIs are installed:

```bash
command -v gemini >/dev/null 2>&1 && echo "gemini: available" || echo "gemini: not found"
command -v codex >/dev/null 2>&1 && echo "codex: available" || echo "codex: not found"
```

3. **Prepare the review input** — Extract the spec, acceptance criteria, and project context into a temp file. Use the feature ID from the Active Session (e.g., `F023`):

```bash
TICKET="$(echo docs/tickets/F023-*.md)"  # Use the feature ID from Step 1; verify exactly one match
REVIEW_DIR="/tmp/review-spec-$(basename "$PWD")"
mkdir -p "$REVIEW_DIR"

cat > "$REVIEW_DIR/input.txt" <<'CRITERIA'
You are reviewing a Feature Specification for a software feature. Your job is to find real problems in the REQUIREMENTS — not the implementation (there is no implementation yet). If the spec is solid, say APPROVED — do not manufacture issues.

Below you will find the Spec (what to build), the Acceptance Criteria, and project context (architecture, decisions). Review the spec and report:
1. Completeness — Are all user needs covered? Missing requirements?
2. Ambiguity — Are requirements clear enough to plan and implement with TDD?
3. Edge cases — Are failure modes, boundary conditions, and error responses specified?
4. API contract — Are endpoints, fields, types, status codes well-defined? (if applicable)
5. Scope — Is the spec doing too much or too little for one feature?
6. Consistency — Does the spec conflict with existing architecture, patterns, or decisions?
7. Testability — Can each acceptance criterion be verified with an automated test?

For each issue, state: [CRITICAL/IMPORTANT/SUGGESTION] — description — proposed fix.

End with: VERDICT: APPROVED | VERDICT: REVISE (if any CRITICAL or 2+ IMPORTANT issues)

---
SPEC AND ACCEPTANCE CRITERIA:
CRITERIA

sed -n '/^## Spec$/,/^## Definition of Done$/p' "$TICKET" >> "$REVIEW_DIR/input.txt"

echo -e "\n---\nPROJECT CONTEXT (architecture and decisions):\n" >> "$REVIEW_DIR/input.txt"
cat docs/project_notes/key_facts.md >> "$REVIEW_DIR/input.txt" 2>/dev/null
echo -e "\n---\n" >> "$REVIEW_DIR/input.txt"
cat docs/project_notes/decisions.md >> "$REVIEW_DIR/input.txt" 2>/dev/null
```

4. **Send for review** — Execute **only one** of the following paths based on Step 2 results:

### Path A: Both CLIs available (best — two independent perspectives)

```bash
cat "$REVIEW_DIR/input.txt" | gemini > "$REVIEW_DIR/gemini.txt" 2>&1 &
PID_GEMINI=$!
cat "$REVIEW_DIR/input.txt" | codex exec - > "$REVIEW_DIR/codex.txt" 2>&1 &
PID_CODEX=$!

wait $PID_GEMINI && echo "Gemini: OK" || echo "Gemini: FAILED (exit $?) — check $REVIEW_DIR/gemini.txt"
wait $PID_CODEX && echo "Codex: OK" || echo "Codex: FAILED (exit $?) — check $REVIEW_DIR/codex.txt"

echo "=== GEMINI REVIEW ===" && cat "$REVIEW_DIR/gemini.txt"
echo "=== CODEX REVIEW ===" && cat "$REVIEW_DIR/codex.txt"
```

Consolidate findings — issues flagged by both models independently carry higher weight. Deduplicate and prioritize. Ignore output from any reviewer that failed.

### Path B: One CLI available

```bash
# Gemini only
cat "$REVIEW_DIR/input.txt" | gemini

# Codex only
cat "$REVIEW_DIR/input.txt" | codex exec -
```

### Path C: No external CLI available (self-review fallback)

If no external CLI is installed, perform the review yourself. Re-read the full Spec from the ticket, then review it with this mindset:

> You are an experienced engineer who has NOT seen this spec before. Question every assumption. Look for what is missing, ambiguous, or inconsistent with the project's architecture. Do not be lenient — find problems.

Apply the same 7 criteria from the prompt above. For each issue, state severity, description, and proposed fix. End with VERDICT.

5. **Process the review** — If any VERDICT is REVISE, update the spec addressing CRITICAL and IMPORTANT issues
6. **Optional second round** — Send the revised spec for a final audit if significant changes were made
7. **Log the review** — Add a note in the ticket's Completion Log: "Spec reviewed by [model(s) or self-review] — N issues found, N addressed"

## Notes

- This command is **optional** — the workflow's built-in Spec Self-Review (Step 0.4) always runs automatically
- Most valuable for **Standard/Complex** features where a wrong spec leads to wasted planning and implementation effort
- External models receive project context (key_facts + decisions) to check architectural consistency
- Both CLIs use their latest default model when no `-m` flag is specified — no need to hardcode model names
- Path C (self-review) is a last resort — external review gives genuinely independent perspectives that self-review cannot
