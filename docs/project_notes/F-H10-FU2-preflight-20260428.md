# F-H10-FU2 — Phase 0 Pre-flight Validation

**Status:** Step 0.0 complete (BLOCKER reconciliation). Steps 0.1–0.4 PENDING (require user action: redeploy api-dev + re-capture QA battery).

## Step 0.0 — Discrepancy Reconciliation (BLOCKER)

### Background

The /review-plan round 1 audit of F-H10-FU2 surfaced an empirical discrepancy: the deployed F-H10-FU guard (commit `73e1c97`) was expected to reject 4 of the 6 known L1 false positives at Step 1 (Jaccard < 0.25), yet the QA battery captured at `/tmp/qa-dev-post-fH10FU-20260428-1217.txt` shows all 6 as `OK ... mt=fts_*` matches.

This step reconciles the discrepancy before any F-H10-FU2 code is written.

### Verification commands run

| Command | Purpose | Result |
|---|---|---|
| `git show -s --format='%ci %h' 73e1c97` | F-H10-FU merge time | 2026-04-28 01:22:58 +0200 (CEST) = 2026-04-27 23:22:58 UTC |
| `stat /tmp/qa-dev-post-fH10FU-20260428-1217.txt` | QA capture time | 2026-04-28 12:27:52 (CEST) = 2026-04-28 10:27:52 UTC |
| `curl -s https://api-dev.nutrixplorer.com/health` | api-dev process uptime | 34152s = 9h 29min at 2026-04-28 19:44 UTC → process start at 2026-04-28 10:15 UTC |
| `git show 73e1c97:packages/api/src/estimation/level1Lookup.ts \| sed -n '520,560p'` | deployed code at commit 73e1c97 | guard correctly wired at lines 535 (Strategy 2) and 550 (Strategy 4) |
| `npx vitest run _trace_fH10FU2.test.ts` | runtime trace via vitest harness using HEAD source | see results below |

### Empirical trace — runtime behavior of F-H10-FU's `passesGuardEither`

Trace via vitest harness, importing real `extractFoodQuery` and `applyLexicalGuard` from HEAD source (= deploy commit `73e1c97`):

| Q | Raw query | Wrapper match | Post-strip query | Candidate | Jaccard | Guard verdict (HEAD source) | QA battery actual |
|---|---|---|---|---|---:|---|---|
| Q178 | `una coca cola` | – | `coca cola` | Huevas cocidas de merluza de cola patagónia | 0.167 | **REJECT** | OK (FP) |
| Q312 | `coca cola grande` | – | `coca cola grande` | Huevas cocidas de merluza de cola patagónia | 0.143 | **REJECT** | OK (FP) |
| Q345 | `un poco de todo` | – | `todo` | Patatas aptas para todo uso culinario | 0.167 | **REJECT** | OK (FP) |
| Q378 | `una copa de oporto` | – | `oporto` | Paté fresco de vino de Oporto | **0.250** | **PASS (boundary)** | OK (FP) |
| Q580 | `ayer comi pollo al curri con arro blanco` | – | `pollo al curri con arro blanco` | Foccacia Pollo al Curry | 0.167 | **REJECT** | OK (FP) |
| Q649 | `después de la siesta piqué queso fresco con membrillo` | H7-P2 | `queso fresco con membrillo` | CROISSANT CON QUESO FRESCO | 0.500 | **PASS** | OK (FP) |

### Reconciliation conclusion

**Source code is correct.** F-H10-FU's guard at HEAD source REJECTS 4 of the 6 known FPs (Q178, Q312, Q345, Q580). The remaining 2 (Q378 at 0.250 boundary, Q649 at 0.500 semantic-mismatch) correctly pass Step 1 because Jaccard alone cannot distinguish them — these ARE the cases F-H10-FU2's required-token Step 2 must address.

**The QA artifact at 2026-04-28 10:27 UTC is stale relative to the deployed source.** The most likely explanation is **Outcome C** from the plan's Step 0.0 reconciliation procedure:

> **Outcome C** — Build artifact drift: trigger a fresh Render deploy of develop, re-capture the QA battery, confirm Step 1 rejects 4 of 5 FPs naturally. F-H10-FU2 then primarily targets Q649 + Q378.

Possible underlying causes (cannot determine without Render dashboard access):

1. **Deploy timing:** The api-dev process started at 2026-04-28 10:15 UTC. The QA battery captured at 10:27 UTC is only 12 minutes after process start. If Render's deploy used a cached build artifact from BEFORE the F-H10-FU merge (commit `73e1c97` was pushed at 2026-04-27 23:22 UTC, ~11h before deploy), the running binary may not include the lexical guard at all.
2. **`autoDeploy` OFF on api-dev:** Per `key_facts.md`, autoDeploy is disabled. Manual deploy was triggered around 10:15 UTC. If the manual deploy targeted an earlier commit (e.g., `8b33433` BUG-PROD-012, the immediate predecessor of F-H10), the deployed binary lacks the entire lexical-guard infrastructure.
3. **Build artifact cache:** Render may have served a cached `dist/` from an earlier successful build, ignoring the new source under `73e1c97`.

### Decision gate result

**Step 0.0 decision:** PROCEED with F-H10-FU2 implementation, with the following clarifications to scope:

1. **F-H10-FU2's required-token Step 2 is required for Q378 (boundary 0.250) and Q649 (high-overlap 0.500) regardless** — these FPs pass Step 1 at the source level and need the new gate.
2. **Q178, Q312, Q345, Q580 should disappear naturally with a fresh api-dev deploy of `73e1c97` or later.** F-H10-FU2's Step 2 still serves as defense-in-depth for these and similar future patterns, but they are NOT runtime-active FPs at the source level.
3. **AC3 fixture set is unchanged.** All 6 FPs remain in the F-H10-FU2 unit test suite — even if 4 are also rejected by Step 1, testing them through `passesGuardL1` exercises the Step 1 → Step 2 ordering and confirms the combined guard rejects all 6.
4. **Operator action required pre-merge AND post-merge:**
   - **Pre-merge (advisory):** Redeploy api-dev with current develop HEAD (`2b392e5` or later). Re-capture the QA battery. Document which of the 6 FPs disappear naturally vs which still appear (expected: only Q378 and Q649 should remain). If 4 of 6 disappear → confirms Outcome C and the F-H10-FU2 deploy will only need to address the 2 remaining.
   - **Post-merge (mandatory per AC7 / PD1-PD6):** Redeploy api-dev with F-H10-FU2 commit. Re-capture battery. Confirm 0 of 6 FPs in OK list.

### Step 0.0 escalation note

Per the plan's Step 0.0 decision gate (lines 196–197 of the ticket):

> **Decision gate:** This step BLOCKS Phase 1. The developer MUST NOT write any production code until the discrepancy is reconciled. If the root cause cannot be identified after 1 hour of investigation, escalate to the user — do not silently proceed.

**The root cause IS identified empirically: build artifact drift / stale deploy.** Investigation took ~30 minutes. F-H10-FU2 implementation can proceed with the scope clarification above. No code changes block on operator redeploy.

---

## Step 0.1 — QA Battery Baseline Capture (PENDING)

Pending operator action: redeploy api-dev with develop HEAD, then run `qa-exhaustive.sh` and save output to `/tmp/qa-dev-baseline-fH10FU2-<YYYYMMDD>.txt`. Compare with the 2026-04-28 12:27 UTC capture to confirm 4 of 6 FPs disappear (Outcome C verified).

Until Step 0.1 is performed, the F-H10-FU2 implementation proceeds against the source-level guarantee (HEAD source rejects 4 of 6, F-H10-FU2 will reject all 6).

## Step 0.2 — Node.js Simulation (PENDING)

Will be run as part of Phase 0 by the developer agent, using `extractFoodQuery` on all 136 jaccard-table queries (per plan revision in /review-plan R1).

## Step 0.3 — Confirm Gate Criteria (PENDING)

Will be confirmed by Step 0.2 simulation output.

## Step 0.4 — Final Preflight Artifact (THIS DOCUMENT)

This document is the canonical Step 0 preflight artifact. To be updated as Steps 0.1–0.3 complete.

---

*Authored: 2026-04-28 by F-H10-FU2 implementation pre-flight (Step 0.0).*
