# F058: Strategic Plan Archival & Rate-Limit Decision Documentation

**Feature:** F058 | **Type:** Docs | **Priority:** Low
**Status:** Ready for Merge | **Branch:** worktree-agent-a8a2c3b4
**Created:** 2026-03-29 | **Dependencies:** None
**Audit Source:** `docs/research/comprehensive-audit-2026-03-29.md` — Findings I8, I9, I10, S9

---

## Spec

### Description

The strategic plan (`docs/project_notes/strategic-plan-r1-r6.md`) served its purpose as the architectural design document for features F031-F037. All 6 requirements (R1-R6) are now implemented and merged. The plan is valuable as historical rationale but currently misleading as a reference — it presents roadmaps, risks, and verification checklists as if they're active work.

Four findings from the comprehensive audit:

**Finding I8 — Rate limit divergence undocumented**
- Plan recommended 10/hr for `/analyze/menu` (lines 135, 257, 305)
- Actual implementation: API-level 10/hr (exempts bot key) + bot-level 5/hr per Telegram user
- This dual-layer design is better than the plan's single-layer proposal, but the decision is nowhere documented
- **Fix**: Add an entry to `docs/project_notes/decisions.md` (ADR) documenting the dual rate-limit strategy

**Finding I9 — Verification checklist stale**
- Lines 410-421 contain 10 verification items in future tense ("Confirmar que...", "Verificar que...")
- All items have been verified through implementation — F031-F037 are shipped and tested
- **Fix**: Mark all items as verified with dates/SHAs, or archive the section

**Finding I10 — Plan not marked as historical document**
- Roadmap, risks table, external review prompt are obsolete
- Someone reading the plan today could mistake it for active work
- **Fix**: Add a prominent header at the top: "STATUS: COMPLETED — Historical Reference"

**Finding S9 — Split portion multiplier responsibility undocumented**
- Bot strips modifiers via `extractPortionModifier()` and passes `portionMultiplier` to API
- L4 prompt (Strategy B) also looks for modifiers in free-form text
- Currently safe because bot strips BEFORE API call, and `/receta` sends raw text (L4 handles modifiers)
- This split is intentional but nowhere documented — future developers could break the balance
- **Fix**: Add a note in `docs/project_notes/decisions.md` or `key_facts.md`

### Files to Modify

| File | Change |
|------|--------|
| `docs/project_notes/strategic-plan-r1-r6.md` | Add "COMPLETED — Historical Reference" header. Mark verification items as done. |
| `docs/project_notes/decisions.md` | Add ADR-013: Dual rate-limiting strategy (API 10/hr global + bot 5/hr per user). Add note about portion multiplier split responsibility. |

### Exact Changes

**strategic-plan-r1-r6.md — Add after line 1:**
```markdown
> **STATUS: COMPLETED — All features F031-F037 implemented and merged (2026-03-29).**
> This document is preserved as historical architectural reference. For current behavior, see the source code and user manual.
> Rate limits diverged from plan: API 10/hr (global) + Bot 5/hr (per user) — see ADR-013.
```

**strategic-plan-r1-r6.md — Verificación section (lines 410-421):**
Mark each item as verified or add a blanket note:
```markdown
> All 10 verification items confirmed through implementation and testing (F031-F037). See individual feature tickets for test evidence.
```

**decisions.md — New ADR-013:**
```markdown
### ADR-013: Dual Rate-Limiting for Menu Analysis

**Decision**: Two-layer rate limiting for `/analyze/menu`:
- API-level: 10 requests/hour per API key (protects OpenAI billing from external clients)
- Bot-level: 5 requests/hour per Telegram chatId (protects per-user fairness)
- Bot API key (`BOT_KEY_ID`) is exempt from the API-level limit

**Why**: The plan proposed 10/hr globally. During implementation (F034), we found that a single bot user could exhaust the global limit, leaving other API clients with zero capacity. The dual-layer design isolates bot users from each other and from external API consumers.

**Context**: F034 implementation, comprehensive audit 2026-03-29.
```

---

## Implementation Plan

N/A — Docs-only task. Direct edits.

---

## Acceptance Criteria

- [x] Strategic plan has "COMPLETED — Historical Reference" header
- [x] Verification checklist marked as done
- [x] ADR-013 added to decisions.md (dual rate-limit strategy)
- [x] Portion multiplier split responsibility documented (ADR-014 in decisions.md)
- [x] External review prompt section (lines 316-379) noted as historical
- [x] No factual errors introduced

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Documentation changes consistent with source code
- [x] Build clean (docs-only — no code changes)

---

## Workflow Checklist

- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 3: Implementation (docs edit)
- [x] Step 4: Docs-only — no build/test impact
- [x] Step 5: Merge checklist filled
- [ ] Step 6: Ticket updated, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-29 | Ticket created | From comprehensive audit findings I8, I9, I10 (Claude + Gemini + Codex), S9 (Gemini) |
| 2026-03-29 | Implementation | Plan marked historical, verification items confirmed, ADR-013 (dual rate-limit) + ADR-014 (portion multiplier split) added to decisions.md |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Plan (N/A), AC, DoD, Workflow, Log, Evidence |
| 1. Mark all items | [x] | AC: 6/6, DoD: 3/3, Workflow: 4/5 (Step 6 pending) |
| 2. Verify product tracker | [x] | F058 added to Features table + Completion Log |
| 3. Update key_facts.md | [x] | N/A — no new endpoints or modules |
| 4. Update decisions.md | [x] | Docs-only — no build/test impact |
| 5. Commit documentation | [x] | Worktree commit aa212bc |
| 6. Verify clean working tree | [x] | Worktree clean after commit |

---

*Ticket created: 2026-03-29*
