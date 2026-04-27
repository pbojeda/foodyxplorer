Run an automated compliance audit on the current feature before requesting merge approval.

## Prerequisites

- An active feature at Step 5 (Review) with Merge Checklist Evidence filled
- All quality gates passed (tests, lint, build)

## What to do

Read `docs/project_notes/product-tracker.md` → Active Session to identify the current feature, branch, and ticket path. Then run ALL checks below and report results in a table.

### Checks

**1. Ticket Status** — Read the ticket file. The `**Status:**` field in the header must be `Ready for Merge`. Flag if it shows any other value (In Progress, Spec, Planning, Review, Done).

**2. Acceptance Criteria** — Count `[x]` vs `[ ]` in the `## Acceptance Criteria` section. ALL must be `[x]`. Report ratio (e.g., "14/14").

**3. Definition of Done** — Count `[x]` vs `[ ]` in the `## Definition of Done` section. ALL must be `[x]`. Report ratio.

**4. Workflow Checklist** — Count `[x]` vs `[ ]` in the `## Workflow Checklist` section. All steps except Step 6 must be `[x]`. Step 6 should be `[ ]` (pending merge).

**5. Merge Checklist Evidence** — Verify the `## Merge Checklist Evidence` table has ALL rows marked `[x]` with real evidence (not placeholder text like "Sections verified: (list)").

**6. Completion Log** — Verify the `## Completion Log` table has at least one entry per executed workflow step. If bugs are mentioned in any entry, verify they are documented in `docs/project_notes/bugs.md`.

**7. Product Tracker Sync** — Read `docs/project_notes/product-tracker.md`:
  - Active Session must show step `5/6` with correct feature ID and branch
  - Features table must show the feature as `in-progress` at step `5/6`
  - Flag if stale or mismatched with ticket

**8. key_facts.md** — If the ticket's changes include new models, migrations, endpoints, modules, or shared utilities, verify they are documented in `docs/project_notes/key_facts.md`. If no new infrastructure, this is N/A.

**9. Merge Base** — Run these commands and report result:
```bash
TARGET_BRANCH="develop"  # or "main" — check key_facts.md branching-strategy
git fetch origin "$TARGET_BRANCH"
git merge-base --is-ancestor "origin/$TARGET_BRANCH" HEAD && echo "UP TO DATE" || echo "DIVERGED"
```
If DIVERGED, flag as FAIL with instruction to merge target branch first.

**10. Working Tree** — Run `git status`. Must show "nothing to commit, working tree clean".

**11. Data File Integrity** (if JSON/seed files are in the diff) — Check:
  - String arrays (aliases, tags): all values same casing convention
  - ID fields: no duplicates
  - Numeric fields: no negatives where unexpected
  - Object arrays: consistent shape (no missing keys)

Run only if `git diff origin/<target-branch>..HEAD --name-only` shows `.json` files in seed-data or fixtures directories.

### Drift Checks (added v0.18.0) — ADVISORY, not blocking

Eleven empirically-validated drift patterns. Failures are NOT blockers for the compliance verdict, but MUST be refreshed before requesting user authorization (the user will otherwise catch them during audit and send the PR back). Each check has a concrete shell recipe — use BSD-grep-compatible regex (no `\K`).

**12. P1 — PR body test count stale.** The PR body's "npm test" line should match the terminal test count in the ticket (AC / DoD / Completion Log last entry). Agents commonly open the PR at Step 4 and add tests during Step 5 review — the PR body number becomes stale.
```bash
PR_BODY=$(gh pr view --json body -q .body)
PR_TESTS=$(echo "$PR_BODY" | grep -iE "(npm test|tests?.*(pass|green))" | grep -oE "[0-9]+/[0-9]+" | head -1)
TICKET_TESTS=$(grep -iE "(npm test|tests?.*(pass|green))" "$TICKET" | grep -oE "[0-9]+/[0-9]+" | tail -1)
[ -n "$PR_TESTS" ] && [ -n "$TICKET_TESTS" ] && [ "$PR_TESTS" != "$TICKET_TESTS" ] && flag "P1 drift: PR body $PR_TESTS vs ticket $TICKET_TESTS"
```

**13. P2 — Merge Checklist Evidence rows aspirational.** Rows marked `[x]` with future-tense Evidence ("will land", "to be created", "pending", "next commit", "TBD") — the row claims done but the work hasn't happened yet.
```bash
awk '/^## Merge Checklist Evidence/,/^## /' "$TICKET" \
  | grep -E '^\|.*\[x\].*(to be |will |pending|TBD|Will be |to be created|next commit|aspirational)' \
  && flag "P2 drift: aspirational row(s) found"
```

**14. P3 — Post-merge actions not logged** (only fires if PR is MERGED and ticket Status is Done). Items marked as post-merge operator actions (AC / DoD / Test plan unchecked with post-merge keywords) should have a Completion Log row documenting execution.
```bash
# Strip checkbox prefix before comparison; use grep -Fq fixed-string match.
grep -E "^- \[ \].*(post-merge|operator|prod rollout|pending verification)" "$TICKET" \
  | sed -E 's/^- \[ \] //' > /tmp/pm_items.txt
COMPLETION=$(awk '/^## Completion Log/,/^## Merge Checklist/' "$TICKET")
while IFS= read -r item; do
  [ -z "$item" ] && continue
  KEY=$(echo "$item" | cut -c1-40)
  echo "$COMPLETION" | grep -Fq "$KEY" || flag "P3 drift: post-merge '$item' not in Completion Log"
done < /tmp/pm_items.txt
```

**15. P4 — Remote branch orphan after "deleted".** Workflow Step 6 claims `[x] branch deleted` but origin still has the branch.
```bash
BRANCH=$(grep -E "^\*\*[Bb]ranch:\*\*" "$TICKET" | head -1 | sed -E 's/^\*\*[Bb]ranch:\*\*[[:space:]]*([^[:space:]|]+).*/\1/')
git fetch origin --prune --quiet
git ls-remote --heads origin "$BRANCH" 2>/dev/null | grep -q refs/heads && flag "P4 drift: remote branch $BRANCH still exists (run: git push origin --delete $BRANCH)"
```

**16. P5 — Frozen ticket Status post-merge.** Scan all tickets in `docs/tickets/`; flag any with Status ≠ Done whose ticket-ID appears in `git log --all --grep`. Multi-word Status values like "Ready for Merge" must be handled (use `sed -E` char class, not `\w+`).
```bash
FROZEN_COUNT=0
for t in docs/tickets/*.md; do
  status=$(grep -E "^\*\*Status:\*\*" "$t" | head -1 | sed -E 's/^\*\*Status:\*\*[[:space:]]*([A-Za-z ]+)[[:space:]]*\|.*/\1/' | sed -E 's/[[:space:]]+$//')
  [ "$status" = "Done" ] && continue
  ticket_id=$(basename "$t" .md | sed -E 's/-[a-z].*//')
  git log --all --oneline --grep="$ticket_id" | grep -q . && FROZEN_COUNT=$((FROZEN_COUNT+1))
done
[ "$FROZEN_COUNT" -ge 2 ] && flag "P5 drift (SYSTEMIC): $FROZEN_COUNT frozen tickets — Status not updated post-merge"
[ "$FROZEN_COUNT" -eq 1 ] && flag "P5 drift: 1 frozen ticket"
```

**17. P6 — AC count off-by-N.** Merge Checklist Evidence row 1 claim ("all N marked" / "AC: X/Y") diverges from actual count of `[x]` + `[ ]` in `## Acceptance Criteria`.
```bash
ACTUAL=$(awk '/^## Acceptance Criteria/,/^## Definition of Done/' "$TICKET" | grep -cE "^- \[[x ]\]")
CLAIMED=$(grep -oE 'all [0-9]+ marked|AC: [0-9]+/[0-9]+' "$TICKET" | head -1 | grep -oE "[0-9]+" | head -1)
[ -n "$CLAIMED" ] && [ "$CLAIMED" != "$ACTUAL" ] && [ $((ACTUAL - CLAIMED)) -ge 2 -o $((CLAIMED - ACTUAL)) -ge 2 ] \
  && flag "P6 drift: claim '$CLAIMED' vs actual AC count $ACTUAL"
```

**18. P7 — Test count drift within ticket (final-sections only).** Only flag AC / DoD / tracker Active-Session numbers diverging from Completion Log terminal. Intermediate rows are legitimate.
```bash
TERMINAL=$(awk '/^## Completion Log/,/^## Merge Checklist/' "$TICKET" | grep -iE "(test|pass|green)" | grep -oE "[0-9]+/[0-9]+" | tail -1)
AC=$(awk '/^## Acceptance Criteria/,/^## Definition of Done/' "$TICKET")
DOD=$(awk '/^## Definition of Done/,/^## Workflow Checklist/' "$TICKET")
FINAL_NUMS=$(printf '%s\n%s\n' "$AC" "$DOD" | grep -iE "(test|pass|green)" | grep -oE "[0-9]+/[0-9]+" | sort -u)
for n in $FINAL_NUMS; do
  [ -n "$TERMINAL" ] && [ "$n" != "$TERMINAL" ] && flag "P7 drift: final-section count $n vs terminal $TERMINAL"
done
```

**19. P8 — Completion Log gap vs Workflow Checklist.** Each `[x]` Step N in Workflow should have ≥1 Completion Log row mentioning "Step N". Use `while-read` on unique step numbers (not `for-in` which splits on whitespace).
```bash
WORKFLOW=$(awk '/^## Workflow Checklist/,/^## Completion Log/' "$TICKET")
COMPLETION=$(awk '/^## Completion Log/,/^## Merge Checklist/' "$TICKET")
CHECKED_STEPS=$(echo "$WORKFLOW" | grep -E "^- \[x\] Step [0-9]+:" | sed -E 's/^- \[x\] Step ([0-9]+):.*/\1/' | sort -u)
while read -r step_num; do
  [ -z "$step_num" ] && continue
  echo "$COMPLETION" | grep -qE "Step[[:space:]]+$step_num([^0-9]|$)" || flag "P8 drift: Step $step_num [x] but no Completion Log entry"
done <<< "$CHECKED_STEPS"
```

**20. P9 — Tracker header "Last Updated" stale.** The `**Last Updated:**` header and the `**Active Feature:**` detail should agree on step number (e.g., both say 5/6). Mismatch suggests the header wasn't refreshed after state transitions.
```bash
TRACKER=docs/project_notes/product-tracker.md
HEADER_STEP=$(grep -oE 'Step [0-9]+/6' "$TRACKER" | head -1)
DETAIL_STEP=$(grep -A 1 '^\*\*Active Feature:\*\*' "$TRACKER" | grep -oE 'Step [0-9]+/6' | head -1)
[ -n "$HEADER_STEP" ] && [ -n "$DETAIL_STEP" ] && [ "$HEADER_STEP" != "$DETAIL_STEP" ] \
  && flag "P9 drift: tracker header says $HEADER_STEP, Active Feature says $DETAIL_STEP"
```

**21. P10 — Duplicate Completion Log rows.** Hash `date | action | first-80-of-notes`. Duplicates suggest copy-paste error during editing.
```bash
awk -F'|' '/^\| [0-9]{4}-[0-9]{2}-[0-9]{2}/ {
  key = $2 "|" $3 "|" substr($4, 1, 80)
  gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
  print key
}' "$TICKET" | sort | uniq -d \
  | while read -r dup; do flag "P10 drift: duplicate Completion Log row: $dup"; done
```

**22. P11 — Tracker Features table status vs ticket Status mismatch.** Ticket Status=Ready for Merge / Review → tracker expects `in-progress`. Ticket Status=Done → tracker expects `done`. Mismatch means one side wasn't updated after the state change.
```bash
TICKET_STATUS=$(grep -E "^\*\*Status:\*\*" "$TICKET" | head -1 | sed -E 's/^\*\*Status:\*\*[[:space:]]*([A-Za-z ]+)[[:space:]]*\|.*/\1/' | sed -E 's/[[:space:]]+$//')
FEATURE_ID=$(basename "$TICKET" .md | sed -E 's/-[a-z].*//')
TRACKER_STATUS=$(grep -F "$FEATURE_ID" docs/project_notes/product-tracker.md | grep -oE "\| (in-progress|done|pending|blocked) \|" | head -1 | sed -E 's/\| ([a-z-]+) \|/\1/')
case "$TICKET_STATUS" in
  "Ready for Merge"|"Review"|"In Progress"|"Planning"|"Spec") EXPECTED="in-progress" ;;
  "Done") EXPECTED="done" ;;
  *) EXPECTED="" ;;
esac
[ -n "$EXPECTED" ] && [ -n "$TRACKER_STATUS" ] && [ "$TRACKER_STATUS" != "$EXPECTED" ] \
  && flag "P11 drift: ticket Status='$TICKET_STATUS' expects tracker='$EXPECTED' but tracker='$TRACKER_STATUS'"
```

### Output Format

Report two tables — one for **structural (blocking)** compliance, one for **drift (advisory)**. Emit two verdicts plus a combined summary line.

```
## Merge Compliance Audit — [FEATURE-ID]

### Structural (1-11) — blocking merge gate

| # | Check | Status | Detail |
|---|-------|:------:|--------|
| 1 | Ticket Status | PASS | "Ready for Merge" |
| 2 | Acceptance Criteria | PASS | 14/14 |
| 3 | Definition of Done | PASS | 7/7 |
| 4 | Workflow Checklist | PASS | 7/8 (Step 6 pending) |
| 5 | Merge Checklist Evidence | PASS | 8/8 with evidence |
| 6 | Completion Log | PASS | 5 entries, bugs documented |
| 7 | Tracker Sync | PASS | Active Session + Features table correct |
| 8 | key_facts.md | PASS | N/A — no new infrastructure |
| 9 | Merge Base | PASS | Up to date with develop |
| 10 | Working Tree | PASS | Clean |
| 11 | Data Files | PASS | N/A — no JSON seed files |

**STRUCTURAL: READY FOR MERGE** (or **STRUCTURAL: NEEDS FIX — N blockers**)

### Drift (12-22) — advisory, refresh before user authorization

| # | Pattern | Status | Detail |
|---|---------|:------:|--------|
| 12 | P1 PR body test count stale | PASS | matches ticket terminal |
| 13 | P2 Aspirational Evidence rows | PASS | all rows past-tense |
| 14 | P3 Post-merge actions logged | PASS | N/A pre-merge |
| 15 | P4 Remote branch orphan | PASS | not checked pre-merge |
| 16 | P5 Frozen ticket Status | PASS | 0 frozen |
| 17 | P6 AC count off-by-N | PASS | claim matches actual |
| 18 | P7 Intra-ticket test drift | PASS | final sections = terminal |
| 19 | P8 Completion Log gap | PASS | every [x] step has narrative |
| 20 | P9 Tracker header stale | PASS | header = detail |
| 21 | P10 Duplicate log rows | PASS | no duplicates |
| 22 | P11 Tracker status mismatch | PASS | in-progress for Ready for Merge |

**DRIFT: CLEAN** (or **DRIFT: N advisories — refresh before merge**)

### Combined verdict

- Both PASS → **READY FOR MERGE** (compliance 11/11, drift clean)
- Structural fail → **NEEDS FIX — N structural blockers** (any drift noted separately)
- Structural pass + drift advisories → **READY FOR MERGE PENDING DRIFT CLEANUP — N advisories**
```

### If issues are found

Fix them directly:
- Status wrong → update the ticket header
- AC/DoD unchecked → mark `[x]`
- Tracker stale → update Active Session and Features table
- Merge base diverged → `git merge origin/<target-branch>` and resolve conflicts
- Data file issues → fix the data

**Drift advisories (12-22) fixes:**
- **P1 (PR body test count stale)** → edit PR body "Quality Gates" / "npm test" line to match ticket terminal count; add "(+N new tests)" delta note
- **P2 (Aspirational Evidence)** → rewrite `[x]` rows with past-tense text + commit SHA + concrete numbers
- **P3 (Post-merge action unlogged)** → add a Completion Log row documenting the post-merge execution with date + action + empirical result
- **P4 (Remote branch orphan)** → `git push origin --delete <branch>` after confirming merge succeeded
- **P5 (Frozen ticket Status)** → update each ticket's `**Status:**` field from "In Progress"/"Ready for Merge" to `Done`; this often belongs in a docs-only tracker-sync PR if the cycle is retroactive
- **P6 (AC count off-by-N)** → recount AC items; update the Merge Checklist Evidence row 1 claim to match actual
- **P7 (Intra-ticket test drift)** → refresh AC / DoD / tracker numbers to match the Completion Log terminal entry
- **P8 (Completion Log gap)** → add a Completion Log row per missing Step with agent verdict + commit SHA
- **P9 (Tracker header stale)** → update `**Last Updated:**` line step reference to match Active Feature detail
- **P10 (Duplicate log rows)** → remove duplicate rows
- **P11 (Tracker status mismatch)** → sync tracker Features row status to ticket header Status

After fixing, re-run the audit to confirm all checks pass.

## Notes

- This command automates the compliance portion of the merge review — it does NOT replace code review, QA, or human architectural review
- Run this AFTER completing Action 8 (Fill Merge Checklist Evidence) and BEFORE Action 9 (Request merge approval)
- The output should be included in the merge approval request message so the reviewer can skip compliance checks and focus on code quality
