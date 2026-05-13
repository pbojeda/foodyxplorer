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

**12. P1 — PR body test count stale (v0.18.3 multi-workspace extension — C1).** The PR body's test ratios should all appear in ticket evidence (AC / DoD / Completion Log). Agents commonly open the PR at Step 4 and add tests during Step 5 review — the PR body numbers become stale. In monorepos with multiple workspaces (e.g. api, web, bot, scraper) the PR body may quote several `N/N` ratios; v0.18.3 walks them all instead of comparing only the first. Subset direction: PR ratios ⊆ ticket ratios (the ticket Completion Log is the more comprehensive record and accumulates intermediate per-step ratios that the PR body legitimately omits). Three fallback cases: (a) ≥ 1 ratio on each side → verify each PR ratio appears in ticket; (b) PR has ratios but ticket has none (or vice versa) → emit explicit `P1 N/A` note, no drift flag; (c) neither side has ratios → emit `P1 N/A` note.
```bash
TEST_KW_RE='(npm test|pnpm test|tests?[^|]*[0-9]|[*: ]tests?[*: ]+[0-9])'
PR_BODY=$(gh pr view --json body -q .body 2>/dev/null || true)
PR_RATIOS=$(echo "$PR_BODY" | grep -iE "$TEST_KW_RE" | grep -oE "[0-9]+/[0-9]+" | sort -u)
TICKET_RATIOS=$(grep -iE "$TEST_KW_RE" "$TICKET" | grep -oE "[0-9]+/[0-9]+" | sort -u)
if [ -z "$PR_RATIOS" ] || [ -z "$TICKET_RATIOS" ]; then
  echo "P1 N/A: no comparable test-count ratios extracted (PR=$(echo "$PR_RATIOS" | tr '\n' ',' ), ticket=$(echo "$TICKET_RATIOS" | tr '\n' ',' ))"
else
  while IFS= read -r r; do
    [ -z "$r" ] && continue
    echo "$TICKET_RATIOS" | grep -qFx "$r" \
      || flag "P1 drift: PR ratio $r not found in ticket evidence (ticket ratios: $(echo "$TICKET_RATIOS" | tr '\n' ' '))"
  done <<< "$PR_RATIOS"
fi
```

**13. P2 — Merge Checklist Evidence rows aspirational.** Rows marked `[x]` with future-tense Evidence ("will land", "to be created", "pending", "next commit", "TBD") — the row claims done but the work hasn't happened yet.
```bash
awk '/^## Merge Checklist Evidence/{flag=1; next} /^## /{flag=0} flag' "$TICKET" \
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
BRANCH=$(grep -oE '\*\*[Bb]ranch:\*\*[[:space:]]*[^[:space:]|()]+' "$TICKET" | head -1 | sed -E 's/^\*\*[Bb]ranch:\*\*[[:space:]]*//')
git fetch origin --prune --quiet
git ls-remote --heads origin "$BRANCH" 2>/dev/null | grep -q refs/heads && flag "P4 drift: remote branch $BRANCH still exists (run: git push origin --delete $BRANCH)"
```

**16. P5 — Frozen ticket Status post-merge.** Scan all tickets in `docs/tickets/`; flag any with Status ≠ Done whose ticket-ID appears in `git log --all --grep`. Multi-word Status values like "Ready for Merge" must be handled (use `sed -E` char class, not `\w+`).
```bash
FROZEN_COUNT=0
for t in docs/tickets/*.md; do
  status=$(grep -E "^\*\*Status:\*\*" "$t" | head -1 \
    | sed -E 's/^\*\*Status:\*\*[[:space:]]*\*?\*?//' \
    | sed -E 's/[[:space:]]*\*?\*?[[:space:]]*\|.*//' \
    | sed -E 's/[[:space:]]+(\(.*\)|—.*|–.*|-.*)$//' \
    | sed -E 's/\*\*[[:space:]]*$//' \
    | sed -E 's/[[:space:]]+$//')
  [ "$status" = "Done" ] && continue
  ticket_id=$(basename "$t" .md | sed -E 's/-[a-z].*//')
  git log --all --oneline --grep="$ticket_id" | grep -q . && FROZEN_COUNT=$((FROZEN_COUNT+1))
done
[ "$FROZEN_COUNT" -ge 2 ] && flag "P5 drift (SYSTEMIC): $FROZEN_COUNT frozen tickets — Status not updated post-merge"
[ "$FROZEN_COUNT" -eq 1 ] && flag "P5 drift: 1 frozen ticket"
```

**17. P6 — AC count off-by-N.** Merge Checklist Evidence row 1 claim diverges from actual count. Two canonical forms: `all N marked` (N = total, implies all are `[x]`) and `AC: X/Y done` (X = marked, Y = total — supports deferred ACs where Y > X intentionally). For `AC: X/Y` form, compare Y to actual total AND X to actual marked. For `all N marked` form, compare N to actual total.
```bash
AC_BLOCK=$(awk '/^## Acceptance Criteria/,/^## Definition of Done/' "$TICKET")
ACTUAL_TOTAL=$(echo "$AC_BLOCK" | grep -cE "^- \[[x ]\]")
ACTUAL_MARKED=$(echo "$AC_BLOCK" | grep -cE "^- \[x\]")
CLAIM_LINE=$(grep -oE 'all [0-9]+ marked|AC: [0-9]+/[0-9]+' "$TICKET" | head -1)
if echo "$CLAIM_LINE" | grep -qE '^AC: [0-9]+/[0-9]+'; then
  CLAIMED_MARKED=$(echo "$CLAIM_LINE" | grep -oE '[0-9]+' | head -1)
  CLAIMED_TOTAL=$(echo "$CLAIM_LINE" | grep -oE '[0-9]+' | tail -1)
  [ -n "$CLAIMED_TOTAL" ] && [ "$CLAIMED_TOTAL" != "$ACTUAL_TOTAL" ] \
    && [ $((ACTUAL_TOTAL - CLAIMED_TOTAL)) -ge 2 -o $((CLAIMED_TOTAL - ACTUAL_TOTAL)) -ge 2 ] \
    && flag "P6 drift: claim AC total '$CLAIMED_TOTAL' vs actual total $ACTUAL_TOTAL"
  [ -n "$CLAIMED_MARKED" ] && [ "$CLAIMED_MARKED" != "$ACTUAL_MARKED" ] \
    && [ $((ACTUAL_MARKED - CLAIMED_MARKED)) -ge 2 -o $((CLAIMED_MARKED - ACTUAL_MARKED)) -ge 2 ] \
    && flag "P6 drift: claim AC marked '$CLAIMED_MARKED' vs actual marked $ACTUAL_MARKED"
elif [ -n "$CLAIM_LINE" ]; then
  CLAIMED=$(echo "$CLAIM_LINE" | grep -oE '[0-9]+' | head -1)
  [ -n "$CLAIMED" ] && [ "$CLAIMED" != "$ACTUAL_TOTAL" ] \
    && [ $((ACTUAL_TOTAL - CLAIMED)) -ge 2 -o $((CLAIMED - ACTUAL_TOTAL)) -ge 2 ] \
    && flag "P6 drift: 'all $CLAIMED marked' vs actual AC count $ACTUAL_TOTAL"
fi
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
  echo "$COMPLETION" | grep -qE "^\|[^|]*\|[[:space:]]*Step[[:space:]]+$step_num([^0-9]|$)" || flag "P8 drift: Step $step_num [x] but no dedicated Completion Log entry"
done <<< "$CHECKED_STEPS"
```

**20. P9 — Tracker header "Last Updated" stale.** The `**Last Updated:**` header and the `**Active Feature:**` detail should agree on step number (e.g., both say 5/6). Mismatch suggests the header wasn't refreshed after state transitions.
```bash
TRACKER=docs/project_notes/product-tracker.md
HEADER_STEP=$(grep '^\*\*Last Updated:\*\*' "$TRACKER" | grep -oE '(Step )?[0-9]+/6' | head -1 | sed -E 's/^Step //')
DETAIL_STEP=$(grep -A 1 '^\*\*Active Feature:\*\*' "$TRACKER" | grep -oE '(Step )?[0-9]+/6' | head -1 | sed -E 's/^Step //')
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
TICKET_STATUS=$(grep -E "^\*\*Status:\*\*" "$TICKET" | head -1 \
    | sed -E 's/^\*\*Status:\*\*[[:space:]]*\*?\*?//' \
    | sed -E 's/[[:space:]]*\*?\*?[[:space:]]*\|.*//' \
    | sed -E 's/[[:space:]]+(\(.*\)|—.*|–.*|-.*)$//' \
    | sed -E 's/\*\*[[:space:]]*$//' \
    | sed -E 's/[[:space:]]+$//')
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

**23. P12 — Tracker HEAD references stale (added v0.18.2).** The `**Last Updated:**` and `**Active Feature:**` lines may embed `HEAD <sha>` or `HEAD: <sha>` references that were correct when written but went stale as further commits landed (empirically observed in fx F-WEB-MENU-VISION-001 audit cycle 2026-05-06: tracker said `HEAD: fd752e4` while `git rev-parse HEAD` was `6fa801e` after the agent's own self-edit commit). Compare each extracted SHA against the active branch HEAD. Bidirectional prefix tolerance: a 7-char tracker SHA matches the full 40-char actual HEAD if it's a prefix; a full 40-char tracker SHA matches if its first 7 chars equal the actual short form. Scoped strictly to the two header lines so narrative SHAs in "Last Completed" prose never false-positive-fire.
```bash
TRACKER=docs/project_notes/product-tracker.md
if [ -f "$TRACKER" ]; then
  ACTUAL_HEAD=$(git rev-parse HEAD 2>/dev/null || true)
  if [ -n "$ACTUAL_HEAD" ]; then
    ACTUAL_SHORT=$(printf '%s' "$ACTUAL_HEAD" | cut -c1-7)
    TRACKER_HEADS=$(grep -E '^\*\*(Last Updated|Active Feature):\*\*' "$TRACKER" 2>/dev/null \
      | grep -oE 'HEAD[[:space:]:]+`?[a-f0-9]{7,40}`?' \
      | grep -oE '[a-f0-9]{7,40}' \
      | sort -u || true)
    for sha in $TRACKER_HEADS; do
      case "$ACTUAL_HEAD" in "$sha"*) continue ;; esac
      case "$sha" in "$ACTUAL_SHORT"*) continue ;; esac
      flag "P12 drift: tracker HEAD reference $sha does not match git rev-parse HEAD ($ACTUAL_HEAD); refresh tracker"
    done
  fi
fi
```

**24. P13 — key_facts delta vs ticket atom-count mismatch (added v0.18.3).** When the ticket's Completion Log or MCE quantifies a delta against `key_facts.md` (e.g. `+8 atoms`, `+5 aliases`, `+27 dishes`), the corresponding feature row in `key_facts.md` should record the same delta. Whitespace-safe iteration via `while IFS= read -r`; FEATURE_ID-anchored block scan avoids false-pass on identical deltas elsewhere in the file. English keyword set; Spanish (`átomos`, `platos`) deferred to v0.19.x.
```bash
KEY_FACTS=docs/project_notes/key_facts.md
if [ -f "$KEY_FACTS" ]; then
  FEATURE_ID=$(basename "$TICKET" .md | sed -E 's/-[a-z].*//')
  TICKET_DELTAS=$(grep -oE '\+[0-9]+ (atoms?|aliases?|dishes?|entries|rows)' "$TICKET" | sort -u)
  KEY_FACTS_BLOCK=$(grep -A 3 -F "$FEATURE_ID" "$KEY_FACTS" 2>/dev/null || true)
  while IFS= read -r claim; do
    [ -z "$claim" ] && continue
    if [ -z "$KEY_FACTS_BLOCK" ] || ! echo "$KEY_FACTS_BLOCK" | grep -qF "$claim"; then
      flag "P13 drift: ticket claims '$claim' but key_facts.md block for $FEATURE_ID lacks the same delta"
    fi
  done <<< "$TICKET_DELTAS"
fi
```

**25. P14 — MCE Action 1 row stale post-merge (added v0.18.3).** When ticket Status normalizes to `Done` AND the MCE Action 1 row still has `Step 6 [ ]` / `Step 6 [-]`, the row was written pre-merge and not updated post-squash. **Strict scoping**: awk state machine terminates the MCE block at the NEXT `^## ` line of any name (NOT `[^M]` — that incorrectly absorbs subsequent `## M*` sections). **Strict signal**: only `Step 6 [ ]` / `Step 6 [-]` patterns flag; standalone `(this merge)` is omitted because it commonly appears in past-tense narrative ("merged at SHA (this merge)") and produces false positives. Reuses `TICKET_STATUS` defined in P11; do NOT use `$status` from the P5 loop. NIT severity.
```bash
if [ "$TICKET_STATUS" = "Done" ]; then
  MCE_BLOCK=$(awk '
    /^## Merge Checklist Evidence/ { in_mce=1; print; next }
    in_mce && /^## / { in_mce=0 }
    in_mce { print }
  ' "$TICKET")
  if echo "$MCE_BLOCK" | grep -qE 'Step 6 \[[ -]\]'; then
    flag "P14 drift (NIT): MCE Action 1 row contains 'Step 6 [ ]' / 'Step 6 [-]' after merge — flip to [x] and append squash + housekeeping SHAs"
  fi
fi
```

**26. P15 — AC with `post-deploy` keyword admitted without Completion Log evidence (added v0.18.3).** ACs containing production-parity keywords (`post-deploy`, `post-merge`, `production parity`, `prod verification`, `on dev API`, `on prod`) are explicit gates; marking them `[x]` without a dated Completion Log row defeats their purpose. Empirical origin: fx F-CATALOG-COV-001 AC-NEW-qa-battery silent-PASS until external audit caught it. Line-safe iteration via `while IFS= read -r`.
```bash
COMPLETION=$(awk '/^## Completion Log/,/^## Merge Checklist/' "$TICKET")
AC_LINES=$(grep -nE '^[[:space:]]*-[[:space:]]*\[[ x]\][[:space:]]+AC-[A-Za-z0-9_-]+' "$TICKET" \
  | grep -iE 'post-deploy|post-merge|production parity|prod verification|on dev API|on prod')
while IFS= read -r line; do
  [ -z "$line" ] && continue
  echo "$line" | grep -q '\[x\]' || continue
  ac_id=$(echo "$line" | grep -oE 'AC-[A-Za-z0-9_-]+' | head -1)
  [ -z "$ac_id" ] && continue
  if ! echo "$COMPLETION" | grep -E "^\|[[:space:]]*[0-9]{4}-[0-9]{2}-[0-9]{2}" | grep -qF "$ac_id"; then
    flag "P15 drift: $ac_id marked [x] with post-deploy semantics but no dated Completion Log entry anchoring this AC-ID"
  fi
done <<< "$AC_LINES"
```

**27. P16 — Feature missing from Features table (added v0.18.3).** Ticket Status `Ready for Merge` / `Done` should have a row in some `## Features — *` table in `product-tracker.md`. **Strict signal**: requires the feature ID to appear as the first cell of a pipe-table row (`| FEATURE_ID |` with optional whitespace), NOT just anywhere in the tracker — narrative mentions or `**Active Feature:**` references must not silence the drift. NIT severity. Reuses `TICKET_STATUS` and `FEATURE_ID` defined in P11.
```bash
TRACKER=docs/project_notes/product-tracker.md
case "$TICKET_STATUS" in
  "Ready for Merge"|"Done")
    if [ -f "$TRACKER" ]; then
      if ! grep -qE "^\|[[:space:]]*$FEATURE_ID[[:space:]]*\|" "$TRACKER"; then
        flag "P16 drift (NIT): $FEATURE_ID not in any Features table row (must appear as first cell in '| FEATURE_ID | ... |' form)"
      fi
    fi
    ;;
esac
```

### Execution discipline (added v0.18.1)

For each of the 16 drift checks (P1–P16), if you declare PASS, **include the literal command output** (or its absence — explicit "no rows matched", "extracted: feature/foo", "FROZEN_COUNT=0") as evidence in your report. A bare "PASS" without supporting output is treated as **NOT EXECUTED** by the auditor — re-run with output captured.

Recommended pattern:

```
P1 PR body test count stale | PASS | PR_TESTS=4110/4110, TICKET_TESTS=4110/4110 (matched)
P2 Aspirational rows | PASS | awk … | grep … (no rows matched)
P5 Frozen ticket Status | PASS | FROZEN_COUNT=0
```

This prevents two failure modes empirically observed during the v0.18.1 origin audit (fx F-H9 + F-H10): (a) the agent abbreviates execution and reports CLEAN by inference from MEMORY/design knowledge; (b) buggy recipes return empty output silently and the agent treats empty as PASS without verifying the recipe ran. Both are caught when literal output is required.

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

### Drift (12-27) — advisory, refresh before user authorization

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
| 23 | P12 Tracker HEAD reference | PASS | tracker HEAD = git HEAD |
| 24 | P13 key_facts delta mismatch | PASS | N/A — no quantified deltas |
| 25 | P14 MCE Action 1 stale post-merge | PASS | N/A pre-merge / row past-tense |
| 26 | P15 Post-deploy AC without evidence | PASS | no post-deploy keyword in ACs |
| 27 | P16 Feature missing from tracker | PASS | feature in Features table |

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

**Drift advisories (12-27) fixes:**
- **P1 (PR body test count stale)** → edit PR body "Quality Gates" / "npm test" line to match ticket terminal count; add "(+N new tests)" delta note
- **P2 (Aspirational Evidence)** → rewrite `[x]` rows with past-tense text + commit SHA + concrete numbers
- **P3 (Post-merge action unlogged)** → add a Completion Log row documenting the post-merge execution with date + action + empirical result
- **P4 (Remote branch orphan)** → `git push origin --delete <branch>` after confirming merge succeeded
- **P5 (Frozen ticket Status)** → update each ticket's `**Status:**` field from "In Progress"/"Ready for Merge" to `Done`; this often belongs in a docs-only tracker-sync PR if the cycle is retroactive
- **P6 (AC count off-by-N)** → recount AC items; update the Merge Checklist Evidence row 1 claim. Use canonical `AC: <marked>/<total>` form (see `merge-checklist.md`) — `total` includes intentionally-deferred ACs
- **P7 (Intra-ticket test drift)** → refresh AC / DoD / tracker numbers to match the Completion Log terminal entry
- **P8 (Completion Log gap)** → add a Completion Log row per missing Step with agent verdict + commit SHA
- **P9 (Tracker header stale)** → update `**Last Updated:**` line step reference to match Active Feature detail
- **P10 (Duplicate log rows)** → remove duplicate rows
- **P11 (Tracker status mismatch)** → sync tracker Features row status to ticket header Status
- **P12 (Tracker HEAD reference stale)** → update `**Last Updated:**` and `**Active Feature:**` `HEAD: <sha>` tokens to match `git rev-parse HEAD`. Use `git rev-parse --short HEAD` for the 7-char form.
- **P13 (key_facts delta mismatch)** → reconcile: either correct the ticket's claimed delta (`+N atoms`/`+M aliases`) to match the actual key_facts.md row, or update key_facts.md to match the truthful delta
- **P14 (MCE Action 1 stale post-merge)** → flip Step 6 checkbox to `[x]` and remove the `(this merge)` qualifier; append squash SHA + housekeeping SHA to the Workflow evidence line
- **P15 (Post-deploy AC without evidence)** → add a dated Completion Log row anchoring the AC-ID with empirical results from the production verification (QA battery output, dev-API smoke result, telemetry confirmation); OR re-mark the AC `[ ]` until verification lands
- **P16 (Feature missing from tracker)** → add a row to the relevant `## Features — *` table in `product-tracker.md` (or document explicitly in the ticket why standalone is intentional with a tracker-side note)

After fixing, re-run the audit to confirm all checks pass.

## Notes

- This command automates the compliance portion of the merge review — it does NOT replace code review, QA, or human architectural review
- Run this AFTER completing Action 8 (Fill Merge Checklist Evidence) and BEFORE Action 9 (Request merge approval)
- The output should be included in the merge approval request message so the reviewer can skip compliance checks and focus on code quality
