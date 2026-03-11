---
name: development-workflow
description: "Orchestrates the complete development workflow for each feature. Invoke with: 'start task F001', 'show progress', 'next task', or 'add feature'."
---

# Development Workflow Skill

## Quick Reference

0. **Spec** — `spec-creator` drafts/updates specs → SPEC APPROVAL (Std/Cplx)
1. **Setup** — Branch, ticket, product tracker → TICKET APPROVAL (Std/Cplx)
2. **Plan** — Planner agent writes implementation plan → PLAN APPROVAL (Std/Cplx)
3. **Implement** — Developer agent, TDD, real-time spec sync
4. **Finalize** — Tests/lint/build, `production-code-validator` → COMMIT APPROVAL
5. **Review** — PR, `code-review-specialist`, `qa-engineer` (Std/Cplx) → MERGE APPROVAL
6. **Complete** — Clean up, update tracker

**Step flow:** Simple: 1→3→4→5→6 | Standard: 0→1→2→3→4→5(+QA)→6 | Complex: 0→1(+ADR)→2→3→4→5(+QA)→6

## Commands

- `start task F001` — Begin working on a specific feature
- `next task` — Start the next pending feature from product tracker
- `show progress` — View feature completion status
- `add feature "description"` — Add a new feature to the product tracker

---

## On Skill Start

1. Read the product tracker (`docs/project_notes/product-tracker.md`) → **Active Session** section for context recovery
2. Read `CLAUDE.md` section 2 → **Autonomy Level**
3. Read `docs/project_notes/key_facts.md` → **Branching Strategy**
4. If resuming an active feature → continue from the step recorded in the tracker's Active Session

---

## Autonomy & Checkpoints

Read the **Autonomy Level** from `CLAUDE.md` section 2.

| Checkpoint | L1 Full Control | L2 Trusted | L3 Autopilot | L4 Full Auto |
|------------|:-:|:-:|:-:|:-:|
| Spec Approval (Step 0) | Required | Auto | Auto | Auto |
| Ticket Approval (Step 1) | Required | Auto | Auto | Auto |
| Plan Approval (Step 2) | Required | Required | Auto | Auto |
| Commit Approval (Step 4) | Required | Auto | Auto | Auto |
| Merge Approval (Step 5) | Required | Required | Required | Auto |

- **Auto** = proceed without asking; log in product tracker → "Auto-Approved Decisions" table
- **Required** = ask user explicitly; do NOT continue without approval
- **Quality gates always run** regardless of level (tests, lint, build, validators)

---

## Task Complexity

Ask user to classify complexity before starting. See `references/complexity-guide.md`.

| Tier | Spec | Ticket | Plan | QA |
|------|:----:|:------:|:----:|:--:|
| Simple | Skip | Skip | Skip | Skip |
| Standard | Yes | Yes | Yes | Yes |
| Complex | Yes | Yes + ADR | Yes | Yes |

---

## Step 0: Spec (Standard/Complex only)

1. Use Task tool with `spec-creator` agent
2. Agent updates global spec files (`api-spec.yaml`, `ui-components.md`) and validation schemas if applicable
3. Agent writes spec summary into the ticket's `## Spec` section

**→ CHECKPOINT: Spec Approval** — Update tracker (Active Session + Features table): step `0/6 (Spec)`

---

## Step 1: Setup

**Determine base branch** from `key_facts.md` → `branching-strategy`:
- **github-flow** → base from `main`
- **gitflow** → base from `develop`

See `references/branching-strategy.md` for details.

1. Verify product tracker exists, no active feature, dependencies met
2. Create feature branch: `feature/<feature-id>-<short-description>`
3. **Std/Cplx:** Generate ticket from `references/ticket-template.md` → fill `## Spec` section
4. **Complex:** Also review `decisions.md` for related ADRs
5. Update product tracker → Active Session: feature, step `1/6 (Setup)`, branch, complexity. Update Features table: status `in-progress`, step `1/6`

**→ CHECKPOINT: Ticket Approval** (Std/Cplx only — Simple skips to Step 3)

---

## Step 2: Plan (Standard/Complex only)

1. Use Task tool with planner agent (`backend-planner` for backend features, `frontend-planner` for frontend features)
2. **Fullstack features:** Run `backend-planner` first, then `frontend-planner`. Each writes its own section in the Implementation Plan
3. Agent writes Implementation Plan into ticket's `## Implementation Plan`
4. Update tracker: step `2/6 (Plan)` (Active Session + Features table)

**→ CHECKPOINT: Plan Approval**

---

## Step 3: Implement

**Simple:** Implement directly with TDD. **Std/Cplx:** Use developer agent (`backend-developer` / `frontend-developer`).

**Fullstack features:** Implement backend first (APIs must exist before the frontend consumes them), then frontend. Use the corresponding developer agent for each.

**TDD Cycle:** Failing test → Minimum code to pass → Refactor → Repeat

**Update specs IN REAL TIME (do not wait until Finalize):**
- API endpoints → `docs/specs/api-spec.yaml` (MANDATORY)
- DB schema → validation schemas (MANDATORY)
- UI components → `docs/specs/ui-components.md` (MANDATORY)
- Env variables → `.env.example` | ADRs → `decisions.md`

**Spec deviation** → document in product tracker Active Session and ask for approval.

**Commits:** Commit freely during implementation (one per logical unit is fine). Final history cleanup happens via squash merge in Step 5.

Update tracker (Active Session + Features table): step `3/6 (Implement)`, context summary. Mark ticket Workflow Checklist `[x]` for Step 3.

---

## Step 4: Finalize

1. Run quality gates: `npm test` → `npm run lint` → `npm run build`
2. **Std/Cplx:** Run `production-code-validator` via Task tool — **do NOT skip**
3. Update ticket: mark acceptance criteria `[x]`, Definition of Done `[x]`
4. Provide change summary: files created/modified, key review points

**→ CHECKPOINT: Commit Approval**

**Commit format:** `<type>(<scope>): <description>` + `Co-Authored-By: Claude <noreply@anthropic.com>`

Update tracker (Active Session + Features table): step `4/6 (Finalize)`. Mark ticket Workflow Checklist `[x]` for Step 4.

---

## Step 5: Review

**Target branch** from `key_facts.md` → same as base branch (Step 1).

1. Push branch, create PR (use `references/pr-template.md`)
2. **Std/Cplx:** Run `code-review-specialist` via Task tool — **do NOT skip**
3. **Std/Cplx:** Also run `qa-engineer` via Task tool
4. **Fix loop:** If review or QA finds issues → fix them → commit fixes → re-run quality gates (`npm test` / lint / build). Repeat until clean.
5. **Merge strategy:** Features/bugfixes → **squash merge** (clean single commit on target branch); Releases/hotfixes → merge commit

**→ CHECKPOINT: Merge Approval**

Before requesting merge approval, verify and complete this checklist:
- [ ] Ticket: Workflow Checklist — all completed steps marked `[x]` (through Step 5)
- [ ] Ticket: Completion Log — entry for each completed step (dates, actions, test counts)
- [ ] Ticket: Acceptance Criteria — mark `[x]` where met
- [ ] Tracker: Active Session — reflects step `5/6 (Review)`, current context, next actions
- [ ] Tracker: Features table — status and step updated to match Active Session
- [ ] `key_facts.md` — updated if new models, schemas, migrations, or reusable components were added
- [ ] `decisions.md` — ADR created if Definition of Done requires it
- [ ] All fixes committed — no unstaged files remaining from review/QA fixes

---

## Step 6: Complete

1. **Update ticket with final state:** correct test count in acceptance criteria, mark all checkboxes, update Completion Log with all commits and key events
2. Delete feature branch (local + remote)
3. Update product tracker: Features table status → `done`, add to Completion Log, clear Active Session → "No active work"
4. Record any bugs found during the feature in `bugs.md`, decisions in `decisions.md`

---

## Agents

| Agent | Step | Scope |
|-------|------|-------|
| `spec-creator` | 0 | Draft/update specs |
| `backend-planner` / `frontend-planner` | 2 | Implementation plan |
| `backend-developer` / `frontend-developer` | 3 | TDD implementation |
| `production-code-validator` | 4 | Pre-commit validation |
| `code-review-specialist` | 5 | Pre-merge review |
| `qa-engineer` | 5 | Edge cases, spec verification (Std/Cplx) |
| `database-architect` | Any | Schema, migrations, queries |

## References

- `references/ticket-template.md` — Ticket format
- `references/pr-template.md` — PR template
- `references/branching-strategy.md` — Branching guide
- `references/add-feature-template.md` — Add feature to tracker
- `references/complexity-guide.md` — Complexity classification
- `references/workflow-example.md` — Full worked example
- `references/failure-handling.md` — Recovery & rollbacks

## Constraints

- **One feature at a time** — never start a new feature before completing current
- **TDD mandatory** — all code needs tests
- **Type safety** — fully typed, no `any`
- **English only** — all technical artifacts
- **Memory first** — check `project_notes/` before changes
- **Product tracker** — keep Active Session AND Features table updated at every step
- **Correct agents** — Backend → `backend-planner` + `backend-developer`, Frontend → `frontend-planner` + `frontend-developer`
- **Correct base branch** — check `key_facts.md` before creating branches
