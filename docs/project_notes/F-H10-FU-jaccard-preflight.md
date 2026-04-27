# F-H10-FU — Jaccard Pre-flight Distribution Analysis

**Status: OPERATOR ACTION PENDING**

This artifact documents the pre-flight Jaccard distribution analysis required by AC4 of
ticket `F-H10-FU-l1-lexical-guard.md`. It must be completed by an operator with access
to the deployed api-dev environment BEFORE the lexical guard (Phase 5) ships to production.

The guard was implemented and unit-tested at threshold 0.25. The threshold was empirically
validated in F-H10 against 18 adversarial edge-cases and the theoretical analysis in the
ticket spec confirms it is safe for L1 FTS characteristics (minimum safe Jaccard for a
1-token query against an N-meaningful-token candidate = 1/N; guard rejects only when
N > 4). The dual-name OR semantics are strictly more permissive than F-H10's single-name
guard, reducing false-negative risk.

If the operator pre-flight uncovers a legitimate FTS hit failing the OR-semantics gate
(max(jaccard_es, jaccard_en) < 0.25), halt and file a follow-up bug before merging.

---

## Results Table

| q | matchType | name_es | name | jaccard_es | jaccard_en | max | gate_pass | reviewer_judgment |
|---|-----------|---------|------|-----------|-----------|-----|-----------|-------------------|
| _(pending operator run)_ | | | | | | | | |

---

## Pre-flight Execution Checklist

Run these steps against api-dev (post-F-H9+F-H10 baseline, F-H10-FU not yet deployed):

### Step 1 — Run extended QA script and capture output

```bash
# Requires api-dev access and API key configured in qa-exhaustive.sh
cd /path/to/foodXPlorer
bash packages/api/scripts/qa-exhaustive.sh > /tmp/qa-dev-preflight-$(date +%s).txt 2>&1
PREFLIGHT_LOG=/tmp/qa-dev-preflight-<timestamp>.txt
```

### Step 2 — Extract FTS hit lines

```bash
grep 'mt=fts_dish\|mt=fts_food' "$PREFLIGHT_LOG"
```

### Step 3 — Compute Jaccard scores for each FTS hit

Create a file `/tmp/compute-jaccard.ts` with content:

```typescript
// Run with: npx tsx /tmp/compute-jaccard.ts <preflight-log-file>
import { readFileSync } from 'fs';
import { computeTokenJaccard } from './packages/api/src/estimation/level3Lookup.js';

const log = readFileSync(process.argv[2] ?? '', 'utf8');
const lines = log.split('\n').filter(l => /mt=fts_(dish|food)/.test(l));

for (const line of lines) {
  const qMatch = line.match(/^\s*\d+\.\s+(.+?)\s+OK /);
  const mtMatch = line.match(/mt=(fts_\w+)/);
  const esMatch = line.match(/nameEs="([^"]+)"/);
  const enMatch = line.match(/nameEn="([^"]+)"/);

  const q = qMatch?.[1] ?? '?';
  const mt = mtMatch?.[1] ?? '?';
  const nameEs = esMatch?.[1] ?? '-';
  const nameEn = enMatch?.[1] ?? '-';

  const jaccardEs = nameEs !== '-' ? computeTokenJaccard(q, nameEs) : null;
  const jaccardEn = computeTokenJaccard(q, nameEn);
  const maxJ = Math.max(jaccardEs ?? 0, jaccardEn);
  const gatePass = maxJ >= 0.25 ? 'YES' : 'NO';

  console.log(`| ${q.slice(0, 30)} | ${mt} | ${nameEs.slice(0, 25)} | ${nameEn.slice(0, 25)} | ${jaccardEs?.toFixed(3) ?? 'n/a'} | ${jaccardEn.toFixed(3)} | ${maxJ.toFixed(3)} | ${gatePass} | LEGIT/FP |`);
}
```

```bash
npx tsx /tmp/compute-jaccard.ts "$PREFLIGHT_LOG"
```

### Step 4 — Gate check

For each row in the output:
- `reviewer_judgment` = **LEGIT** if this is a correct match (human review)
- `reviewer_judgment` = **FP** if this is a false positive (would be rejected by guard — expected)

Gate pass criterion:
- Every **LEGIT** hit must have `gate_pass = YES` (i.e., `max >= 0.25`)
- **FP** hits with `gate_pass = NO` are the intended rejections — confirm these match known false positives like Q649

If any LEGIT hit has `gate_pass = NO`, halt and revise threshold before shipping.

### Step 5 — Update this file

Fill in the Results Table above with the computed rows and commit the update.

Mark AC4 `[x]` in the ticket and add a Completion Log entry.
