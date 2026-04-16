# Cross-Model Review — Calibration Notes

Reference for interpreting cross-model review output during spec/plan review.

## Purpose

Cross-model review runs the same spec or plan through two independent AI models to surface issues a single model would miss. Different models have different failure modes — that's the value.

## Reviewer patterns observed in practice

Tendencies, not absolutes. Use them to calibrate expectations.

### Codex CLI
- Agentic: runs `rg`, `sed`, file reads during review
- Primary bug-finder: catches path mismatches, stale types, wrong primary key types, dangling shared-package references
- Weakness: verbose output that can bury high-severity findings

### Gemini CLI
- Text-aware but less agentic: reads spec/plan and standards, may not grep code
- Primary standards-compliance checker: catches contradictions with ADRs, existing patterns
- Reads project context via `instructions` field in `.gemini/settings.json`
- Weakness: can approve plans with mechanical bugs only visible empirically

### Claude CLI (when used as reviewer)
- Analytical: scope, ordering, edge cases, over-engineering
- Primary scope checker: catches feature creep, YAGNI violations
- Weakness: similar to Gemini, less empirical by default

## Interpreting reviews

**When reviews agree**: strong signal. Address first.

**When reviews disagree**: arbitrate from evidence, not authority. If one reviewer cites a specific file:line and the other didn't read it, the cited finding carries empirical weight. For scope/over-engineering disagreements, lean YAGNI.

**When reviews are asymmetric**: if one reviewer finds 3 M1 blockers and the other finds 0 M1, do NOT conclude half the findings are wrong. Conclude the light reviewer was text-only and missed empirical bugs. The `review-plan` command auto-detects asymmetry and re-prompts the light reviewer.

**When both reviews are light**: acceptable for trivial changes only. For Standard/Complex features, re-run both reviewers with the empirical verification checklist explicitly invoked.

## Historical calibration data

### F-UX-B Plan review (2026-04-13, foodXPlorer)

- Gemini: 48 lines, 2 M3 + 1 P2, verdict APPROVE WITH CHANGES. Cited base-standards.mdc section 5 — demonstrably read project context.
- Codex: 829 lines, 3 M1 + 1 M2 + 2 M3, verdict REJECT. Ran `rg`/`sed`, cited specific file:lines across 4+ files.
- Codex M1s were all real bugs verified empirically by the agent before applying fixes.

Takeaway: context loading (fixed in sdd-devflow v0.16.7) ≠ empirical verification. Both reviewers are complementary.

## Override when

- Light reviewer produces specific high-quality finding with cited evidence — don't dismiss
- Heavy reviewer produces verbose output with few actionable findings — don't over-weight length
- New model version changes behavior — update this file

The calibration is a tool, not a rule. Read both reviews carefully.

## Related files

- `.gemini/commands/review-spec-instructions.md`
- `.gemini/commands/review-plan-instructions.md`
- `.gemini/agents/backend-planner.md`
- `.gemini/agents/frontend-planner.md`
