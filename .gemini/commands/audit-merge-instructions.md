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

**12. CI State** (added v0.19.0) — Verify GitHub Actions / CI checks for the current PR show no FAILURE / ERROR / CANCELLED / TIMED_OUT conclusion. PENDING is acceptable (still running). Emits distinct `N/A` messages when `gh` is unavailable, `jq` is unavailable, or no PR is open for the current branch — these are not blockers. Empirical motivation: F107a (PR #279) shipped with `ci-success` BLOCKED on 3 real failures (test-api lint, test-web build, branch-protection gate); the agent claimed "CI: green" without verification. C3 makes the claim auditable structurally.
```bash
if ! command -v gh >/dev/null 2>&1; then
  echo "C3 N/A: gh CLI unavailable"
elif ! command -v jq >/dev/null 2>&1; then
  echo "C3 N/A: jq unavailable"
else
  # In GitHub Actions `pull_request` jobs, `actions/checkout` defaults to a
  # detached HEAD (no branch context), so `gh pr view` with no arg cannot
  # resolve "the PR for the current branch". Read the PR number from
  # GITHUB_REF (`refs/pull/<N>/merge`) when available so C3 still queries
  # the right PR. Local runs (no GITHUB_REF) keep the no-arg behavior.
  PR_NUM_FROM_CI=""
  if [ -n "${GITHUB_REF:-}" ]; then
    PR_NUM_FROM_CI=$(printf '%s' "$GITHUB_REF" | sed -n 's@^refs/pull/\([0-9]\{1,\}\)/.*@\1@p')
  fi
  if [ -n "$PR_NUM_FROM_CI" ]; then
    PR_JSON=$(gh pr view "$PR_NUM_FROM_CI" --json number,statusCheckRollup 2>/dev/null || true)
  else
    PR_JSON=$(gh pr view --json number,statusCheckRollup 2>/dev/null || true)
  fi
  if [ -z "$PR_JSON" ]; then
    echo "C3 N/A: no PR open for current branch"
  else
    PR_NUM=$(echo "$PR_JSON" | jq -r '.number // "unknown"')
    FAILURES=$(echo "$PR_JSON" | jq -r '
      .statusCheckRollup[]?
      | select((.conclusion // .status) as $s
        | $s == "FAILURE" or $s == "ERROR" or $s == "CANCELLED" or $s == "TIMED_OUT")
      | .name // .context
    ' | sort -u)
    if [ -n "$FAILURES" ]; then
      flag "C3 BLOCKER: PR #$PR_NUM has failing checks — $(echo "$FAILURES" | tr '\n' ',' | sed 's/,$//')"
    else
      echo "C3 PASS: PR #$PR_NUM — all checks pass or pending"
    fi
  fi
fi
```

### Drift Checks (added v0.18.0) — ADVISORY, not blocking

Sixteen empirically-validated drift patterns. Failures are NOT blockers for the compliance verdict, but MUST be refreshed before requesting user authorization. Use BSD-grep-compatible regex (no `\K`).

**13. P1 — PR body test count stale (v0.18.3 multi-workspace extension — C1).** All PR-body ratios must appear in ticket evidence. Subset direction: PR ⊆ ticket. Three fallback cases: (a) ratios on both sides → walk each PR ratio; (b)/(c) missing on either side → emit `P1 N/A`.
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

**14. P2 — Merge Checklist Evidence aspirational.** `[x]` rows with future-tense text.
```bash
awk '/^## Merge Checklist Evidence/{flag=1; next} /^## /{flag=0} flag' "$TICKET" \
  | grep -E '^\|.*\[x\].*(to be |will |pending|TBD|Will be |to be created|next commit|aspirational)' \
  && flag "P2 drift: aspirational row(s) found"
```

**15. P3 — Post-merge actions not logged** (post-merge only).
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

**16. P4 — Remote branch orphan.**
```bash
BRANCH=$(grep -oE '\*\*[Bb]ranch:\*\*[[:space:]]*[^[:space:]|()]+' "$TICKET" | head -1 | sed -E 's/^\*\*[Bb]ranch:\*\*[[:space:]]*//')
git fetch origin --prune --quiet
git ls-remote --heads origin "$BRANCH" 2>/dev/null | grep -q refs/heads && flag "P4 drift: remote branch $BRANCH still exists (run: git push origin --delete $BRANCH)"
```

**17. P5 — Frozen ticket Status post-merge.** Multi-word status via sed char class, not `\w+`.
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

**18. P6 — AC count off-by-N (header-form aware since v0.19.0).** Supports two AC forms: `[x]`/`[ ]` checkbox form and `### AC<N>` header form. Headers authoritative when present (≥ 1). A header is "deferred" when its body contains `**Status**: Deferred|Pending|Skipped|Blocked` before the next `### `. Two claim shapes: `all N marked` and `AC: X/Y done`. v0.19.0 drops the v0.18.3 `-ge 2` tolerance — exact-match (off-by-1 advisories surface).
```bash
AC_BLOCK=$(awk '/^## Acceptance Criteria/,/^## Definition of Done/' "$TICKET")
HEADER_ACS=$(echo "$AC_BLOCK" | grep -cE '^### AC[0-9]+')

if [ "$HEADER_ACS" -gt 0 ]; then
  ACTUAL_TOTAL=$HEADER_ACS
  # Per-AC pass: emit one line per AC ("marked" or "deferred"). Then count.
  PER_AC=$(echo "$AC_BLOCK" | awk '
    function flush() { if (have) { print (deferred ? "deferred" : "marked"); have=0; deferred=0 } }
    /^### AC[0-9]+/ { flush(); have=1; next }
    /^## / { flush(); next }
    have && /^\*\*Status\*\*:[[:space:]]*(Deferred|Pending|Skipped|Blocked)/ { deferred=1 }
    END { flush() }
  ')
  ACTUAL_MARKED=$(printf '%s\n' "$PER_AC" | grep -c '^marked$' || true)
else
  ACTUAL_TOTAL=$(echo "$AC_BLOCK" | grep -cE "^- \[[x ]\]")
  ACTUAL_MARKED=$(echo "$AC_BLOCK" | grep -cE "^- \[x\]")
fi

CLAIM_LINE=$(grep -oE 'all [0-9]+ marked|AC: [0-9]+/[0-9]+' "$TICKET" | head -1)
if echo "$CLAIM_LINE" | grep -qE '^AC: [0-9]+/[0-9]+'; then
  CLAIMED_MARKED=$(echo "$CLAIM_LINE" | grep -oE '[0-9]+' | head -1)
  CLAIMED_TOTAL=$(echo "$CLAIM_LINE" | grep -oE '[0-9]+' | tail -1)
  [ -n "$CLAIMED_TOTAL" ] && [ "$CLAIMED_TOTAL" != "$ACTUAL_TOTAL" ] \
    && flag "P6 drift: claim AC total '$CLAIMED_TOTAL' vs actual total $ACTUAL_TOTAL (form: $([ "$HEADER_ACS" -gt 0 ] && echo header || echo checkbox))"
  [ -n "$CLAIMED_MARKED" ] && [ "$CLAIMED_MARKED" != "$ACTUAL_MARKED" ] \
    && flag "P6 drift: claim AC marked '$CLAIMED_MARKED' vs actual marked $ACTUAL_MARKED (form: $([ "$HEADER_ACS" -gt 0 ] && echo header || echo checkbox))"
elif [ -n "$CLAIM_LINE" ]; then
  CLAIMED=$(echo "$CLAIM_LINE" | grep -oE '[0-9]+' | head -1)
  if [ -n "$CLAIMED" ]; then
    [ "$CLAIMED" != "$ACTUAL_TOTAL" ] \
      && flag "P6 drift: 'all $CLAIMED marked' vs actual AC total $ACTUAL_TOTAL (form: $([ "$HEADER_ACS" -gt 0 ] && echo header || echo checkbox))"
    # `all N marked` IMPLIES all ACs are marked; flag when actual marked < N
    # (e.g. some ACs deferred via `**Status**: Deferred` or unchecked `[ ]`).
    [ "$CLAIMED" != "$ACTUAL_MARKED" ] \
      && flag "P6 drift: 'all $CLAIMED marked' but only $ACTUAL_MARKED actually marked (form: $([ "$HEADER_ACS" -gt 0 ] && echo header || echo checkbox))"
  fi
fi
```

**19. P7 — Test count drift within ticket (final-sections only).**
```bash
TERMINAL=$(awk '/^## Completion Log/,/^## Merge Checklist/' "$TICKET" | grep -iE "(test|pass|green)" | grep -oE "[0-9]+/[0-9]+" | tail -1)
AC=$(awk '/^## Acceptance Criteria/,/^## Definition of Done/' "$TICKET")
DOD=$(awk '/^## Definition of Done/,/^## Workflow Checklist/' "$TICKET")
FINAL_NUMS=$(printf '%s\n%s\n' "$AC" "$DOD" | grep -iE "(test|pass|green)" | grep -oE "[0-9]+/[0-9]+" | sort -u)
for n in $FINAL_NUMS; do
  [ -n "$TERMINAL" ] && [ "$n" != "$TERMINAL" ] && flag "P7 drift: final-section count $n vs terminal $TERMINAL"
done
```

**20. P8 — Completion Log gap vs Workflow Checklist.**
```bash
WORKFLOW=$(awk '/^## Workflow Checklist/,/^## Completion Log/' "$TICKET")
COMPLETION=$(awk '/^## Completion Log/,/^## Merge Checklist/' "$TICKET")
CHECKED_STEPS=$(echo "$WORKFLOW" | grep -E "^- \[x\] Step [0-9]+:" | sed -E 's/^- \[x\] Step ([0-9]+):.*/\1/' | sort -u)
while read -r step_num; do
  [ -z "$step_num" ] && continue
  echo "$COMPLETION" | grep -qE "^\|[^|]*\|[[:space:]]*Step[[:space:]]+$step_num([^0-9]|$)" || flag "P8 drift: Step $step_num [x] but no dedicated Completion Log entry"
done <<< "$CHECKED_STEPS"
```

**21. P9 — Tracker header stale.**
```bash
TRACKER=docs/project_notes/product-tracker.md
HEADER_STEP=$(grep '^\*\*Last Updated:\*\*' "$TRACKER" | grep -oE '(Step )?[0-9]+/6' | head -1 | sed -E 's/^Step //')
DETAIL_STEP=$(grep -A 1 '^\*\*Active Feature:\*\*' "$TRACKER" | grep -oE '(Step )?[0-9]+/6' | head -1 | sed -E 's/^Step //')
[ -n "$HEADER_STEP" ] && [ -n "$DETAIL_STEP" ] && [ "$HEADER_STEP" != "$DETAIL_STEP" ] \
  && flag "P9 drift: tracker header says $HEADER_STEP, Active Feature says $DETAIL_STEP"
```

**22. P10 — Duplicate Completion Log rows.**
```bash
awk -F'|' '/^\| [0-9]{4}-[0-9]{2}-[0-9]{2}/ {
  key = $2 "|" $3 "|" substr($4, 1, 80)
  gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
  print key
}' "$TICKET" | sort | uniq -d \
  | while read -r dup; do flag "P10 drift: duplicate Completion Log row: $dup"; done
```

**23. P11 — Tracker Features table status vs ticket Status mismatch.**
```bash
TICKET_STATUS=$(grep -E "^\*\*Status:\*\*" "$TICKET" | head -1 \
    | sed -E 's/^\*\*Status:\*\*[[:space:]]*\*?\*?//' \
    | sed -E 's/[[:space:]]*\*?\*?[[:space:]]*\|.*//' \
    | sed -E 's/[[:space:]]+(\(.*\)|—.*|–.*|-.*)$//' \
    | sed -E 's/\*\*[[:space:]]*$//' \
    | sed -E 's/[[:space:]]+$//')
TICKET_BASENAME=$(basename "$TICKET" .md)
# v0.18.4 P11-B: sub-scope tickets (-lite / -FU / -FU[0-9]*) close a partial
# scope of a parent feature; the parent tracker row stays at its parent status
# (typically `pending` or `in-progress`) while the sub-scope ticket reaches
# `Done`. P11 must NOT enforce status mapping across this boundary. Pattern
# scope: empirically derived from fx convention (uppercase -FU + -lite). If
# future projects introduce -spike / -mini / -aux variants, expand here.
case "$TICKET_BASENAME" in
  *-lite|*-lite-*|*-FU|*-FU-*|*-FU[0-9]*)
    echo "P11 N/A: $TICKET_BASENAME is a sub-scope ticket — parent tracker row status independent" >&2
    ;;
  *)
    FEATURE_ID=$(echo "$TICKET_BASENAME" | sed -E 's/-[a-z].*//')
    # v0.18.4 P11-B drive-by hardening: anchor tracker lookup to pipe-table row
    # (FEATURE_ID as first cell). Mirrors v0.18.3 P16 idiom — prevents narrative
    # mentions earlier in the tracker from silencing or false-firing the check.
    TRACKER_STATUS=$(grep -E "^\|[[:space:]]*$FEATURE_ID[[:space:]]*\|" docs/project_notes/product-tracker.md \
        | grep -oE "\| (in-progress|done|pending|blocked) \|" | head -1 | sed -E 's/\| ([a-z-]+) \|/\1/')
    case "$TICKET_STATUS" in
      "Ready for Merge"|"Review"|"In Progress"|"Planning"|"Spec") EXPECTED="in-progress" ;;
      "Done") EXPECTED="done" ;;
      *) EXPECTED="" ;;
    esac
    [ -n "$EXPECTED" ] && [ -n "$TRACKER_STATUS" ] && [ "$TRACKER_STATUS" != "$EXPECTED" ] \
      && flag "P11 drift: ticket Status='$TICKET_STATUS' expects tracker='$EXPECTED' but tracker='$TRACKER_STATUS'"
    ;;
esac
```

**24. P12 — Tracker HEAD references stale (added v0.18.2).** The `**Last Updated:**` and `**Active Feature:**` lines may embed `HEAD <sha>` or `HEAD: <sha>` references that were correct when written but went stale as further commits landed (empirically observed in fx F-WEB-MENU-VISION-001 audit cycle 2026-05-06: tracker said `HEAD: fd752e4` while `git rev-parse HEAD` was `6fa801e` after the agent's own self-edit commit). Compare each extracted SHA against the active branch HEAD. Bidirectional prefix tolerance: a 7-char tracker SHA matches the full 40-char actual HEAD if it's a prefix; a full 40-char tracker SHA matches if its first 7 chars equal the actual short form. Scoped strictly to the two header lines so narrative SHAs in "Last Completed" prose never false-positive-fire.
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

**25. P13 — key_facts delta vs ticket atom-count mismatch (added v0.18.3).** Whitespace-safe iteration + FEATURE_ID anchoring.
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

**26. P14 — MCE Action 1 row stale post-merge (added v0.18.3).** Strict awk state machine terminates MCE block at NEXT `^## ` of any name (not `[^M]`). Strict signal `Step 6 [ ]` / `Step 6 [-]` only — standalone `(this merge)` omitted to prevent false positives on past-tense narrative. Reuses `TICKET_STATUS` from P11. NIT severity.
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

**27. P15 — AC with post-deploy keyword admitted without Completion Log evidence (added v0.18.3).** Line-safe iteration via `while IFS= read -r`.
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

**28. P16 — Feature missing from Features table (added v0.18.3).** Strict signal: feature ID must appear as first cell of a pipe-table row (`| FEATURE_ID |`) — narrative mentions / `**Active Feature:**` references must not silence the drift. NIT severity. Reuses `TICKET_STATUS` and `FEATURE_ID` from P11.
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

### Structural (1-12) — blocking merge gate

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
| 12 | CI State | PASS | PR #123 — all checks pass or pending |

**STRUCTURAL: READY FOR MERGE** (or **STRUCTURAL: NEEDS FIX — N blockers**)

### Drift (13-28) — advisory, refresh before user authorization

| # | Pattern | Status | Detail |
|---|---------|:------:|--------|
| 13 | P1 PR body test count stale | PASS | matches ticket terminal |
| 14 | P2 Aspirational Evidence rows | PASS | all past-tense |
| 15 | P3 Post-merge actions logged | PASS | N/A pre-merge |
| 16 | P4 Remote branch orphan | PASS | not checked pre-merge |
| 17 | P5 Frozen ticket Status | PASS | 0 frozen |
| 18 | P6 AC count off-by-N | PASS | claim matches actual (form: header) |
| 19 | P7 Intra-ticket test drift | PASS | final = terminal |
| 20 | P8 Completion Log gap | PASS | every [x] step has narrative |
| 21 | P9 Tracker header stale | PASS | header = detail |
| 22 | P10 Duplicate log rows | PASS | no duplicates |
| 23 | P11 Tracker status mismatch | PASS | status consistent |
| 24 | P12 Tracker HEAD reference | PASS | tracker HEAD = git HEAD |
| 25 | P13 key_facts delta mismatch | PASS | N/A — no quantified deltas |
| 26 | P14 MCE Action 1 stale post-merge | PASS | N/A pre-merge / row past-tense |
| 27 | P15 Post-deploy AC without evidence | PASS | no post-deploy keyword in ACs |
| 28 | P16 Feature missing from tracker | PASS | feature in Features table |

**DRIFT: CLEAN** (or **DRIFT: N advisories — refresh before merge**)

### Combined verdict

- Both PASS → **READY FOR MERGE** (compliance 12/12, drift clean)
- Structural fail → **NEEDS FIX — N blockers**
- Structural pass + drift advisories → **READY FOR MERGE PENDING DRIFT CLEANUP — N advisories**
```

**Recipe-output verbatim rule** (added v0.19.0): When filling Detail columns of either the structural or drift tables, use the **literal output of the corresponding recipe** — do not normalize, summarize, or smooth values. Specifically:
- Numeric ratios (`N/M`): preserve as emitted. `18/19` MUST NOT become `18/18` even when N < M.
- MCE row 1 claim text: when a check (e.g. P6) references it in its Detail message, quote it verbatim including parentheticals such as `(AC19 deploy-deferred)` or `(operator action pending)`. Do not strip qualifiers.
- "Form" annotations (e.g. P6 emits `(form: header)` or `(form: checkbox)`): preserve them so the reader can tell which AC form the ticket used.
- `N/A` reasons: quote the literal reason emitted by the recipe (`no PR open`, `gh CLI unavailable`, `jq unavailable`, `not checked pre-merge`).

This rule exists because an LLM auditor, given header-form tickets where checkbox count is 0, will hallucinate `18/18` to "agree" with the MCE row 1 claim. The recipe says `0` and the MCE says `18/19`; the audit Detail must reflect both honestly so the reader can spot the form mismatch.

### If issues are found

Fix them directly:
- Status wrong → update the ticket header
- AC/DoD unchecked → mark `[x]`
- Tracker stale → update Active Session and Features table
- Merge base diverged → `git merge origin/<target-branch>` and resolve conflicts
- Data file issues → fix the data
- CI failures (C3) → re-run failed jobs after addressing root cause; do NOT merge while `ci-success` is BLOCKED

**Drift advisories (13-28) fixes:**
- **P1** → edit PR body npm test line to match ticket terminal count
- **P2** → rewrite `[x]` rows with past-tense + commit SHA
- **P3** → add Completion Log row for each post-merge execution
- **P4** → `git push origin --delete <branch>` after merge
- **P5** → update ticket Status from "In Progress"/"Ready for Merge" to `Done`
- **P6** → recount ACs; use canonical `AC: <marked>/<total>` form (see `merge-checklist.md`) — `total` includes intentionally-deferred ACs
- **P7** → sync AC/DoD/tracker numbers to Completion Log terminal
- **P8** → add Completion Log row per missing Step with agent verdict + commit SHA
- **P9** → refresh `**Last Updated:**` step reference
- **P10** → remove duplicate rows
- **P11** → sync tracker Features row status to ticket header Status
- **P12 (Tracker HEAD reference stale)** → update `**Last Updated:**` and `**Active Feature:**` `HEAD: <sha>` tokens to match `git rev-parse HEAD`. Use `git rev-parse --short HEAD` for the 7-char form.
- **P13 (key_facts delta mismatch)** → reconcile ticket delta claim with key_facts.md feature row
- **P14 (MCE Action 1 stale post-merge)** → flip Step 6 checkbox to `[x]` and remove the `(this merge)` qualifier
- **P15 (Post-deploy AC without evidence)** → add a dated Completion Log row with empirical post-deploy results, OR re-mark the AC `[ ]` until verification lands
- **P16 (Feature missing from tracker)** → add a row to the relevant `## Features — *` table in `product-tracker.md`

After fixing, re-run the audit to confirm all checks pass.

## Notes

- This command automates the compliance portion of the merge review — it does NOT replace code review, QA, or human architectural review
- Run this AFTER completing Action 8 (Fill Merge Checklist Evidence) and BEFORE Action 9 (Request merge approval)
- The output should be included in the merge approval request message so the reviewer can skip compliance checks and focus on code quality
