# AGENTS.md — Universal Project Instructions

> This file is read by all AI coding tools (Claude Code, Gemini, Cursor, Copilot, Windsurf, etc.).
> Tool-specific config goes in `CLAUDE.md` / `GEMINI.md`. Methodology goes in `ai-specs/specs/base-standards.mdc`.

## Project Structure

```
project/
├── ai-specs/   
├── docs/   
├── initialDoc/   
├── packages/   
├── scripts/   
└── docs/        ← Documentation
```

**Critical**: NEVER install dependencies in the root directory.

| Action | Correct | Wrong |
|--------|---------|-------|
| Install backend dep | `cd backend && npm install pkg` | `npm install pkg` |
| Run backend tests | `cd backend && npm test` | `npm test` |
| Install frontend dep | `cd frontend && npm install pkg` | `npm install pkg` |

## Project Memory

Institutional knowledge lives in `docs/project_notes/`:

- **product-tracker.md** — Feature backlog, **Active Session** (current feature, next actions, open questions), completion log
- **bugs.md** — Bug log with solutions and prevention notes
- **decisions.md** — Architectural Decision Records (ADRs)
- **key_facts.md** — Project configuration, ports, URLs, branching strategy

## Session Recovery

After context loss, new session, or context compaction — BEFORE continuing work:

1. **Read product tracker** (`docs/project_notes/product-tracker.md`) → **Active Session** section
2. If there is an active feature → read the referenced ticket in `docs/tickets/`
3. Respect the configured autonomy level — do NOT skip checkpoints

## Anti-Patterns (Avoid)

- Installing dependencies in root directory
- Skipping approvals at configured autonomy level
- Using `any` type without justification
- Creating files when existing ones can be extended
- Adding features not explicitly requested
- Committing without updating ticket acceptance criteria
- Forgetting to update product tracker's Active Session after step changes

## Automated Hooks (Claude Code)

The project includes pre-configured hooks in `.claude/settings.json`:

- **Quick Scan** (`SubagentStop`): After `backend-developer`, `frontend-developer`, or `ui-ux-designer` finishes, a fast grep-based scan (~2s, no additional API calls) checks for `console.log`, `debugger`, `TODO/FIXME`, hardcoded secrets, and localhost references. Critical issues block; warnings are non-blocking (full review happens in Step 5).
- **Compaction Recovery** (`SessionStart → compact`): After context compaction, injects a reminder to read the product tracker Active Session for context recovery.

Personal notification hooks (macOS/Linux) are in `.claude/settings.local.json` — see that file for examples.

## Available Skills

Skills orchestrate multi-step workflows. Invoke by telling the AI assistant what you want to do.

| Skill | Invocation | Description |
|-------|-----------|-------------|
| `development-workflow` | `start task F001` | Complete feature development (6-step workflow) |
| `bug-workflow` | `report bug`, `fix bug` | Bug triage, investigation, and resolution |
| `health-check` | `health check` | Quick project health scan (tests, build, lint, etc.) |
| `project-memory` | `set up project memory` | Initialize/maintain docs/project_notes/ |
| `pm-orchestrator` | `start pm`, `continue pm` | L5: Autonomous multi-feature sequential orchestration |

## Standards References

- [Base Standards](./ai-specs/specs/base-standards.mdc) — Constitution, methodology, workflow, agents
- [Backend Standards](./ai-specs/specs/backend-standards.mdc) — Backend patterns ()
- [Frontend Standards](./ai-specs/specs/frontend-standards.mdc) — Frontend patterns (Next.js)
- [Documentation Standards](./ai-specs/specs/documentation-standards.mdc) — Doc guidelines
