# AGENTS.md — Universal Project Instructions

> This file is read by all AI coding tools (Claude Code, Gemini, Cursor, Copilot, Windsurf, etc.).
> Tool-specific config goes in `CLAUDE.md` / `GEMINI.md`. Methodology goes in `ai-specs/specs/base-standards.mdc`.

## Project Structure

```
foodXPlorer/
├── packages/
│   ├── api/           ← Fastify API (Prisma + Kysely + PostgreSQL + pgvector)
│   │   └── src/
│   ├── bot/           ← Telegram bot (node-telegram-bot-api)
│   │   └── src/
│   └── shared/        ← Zod schemas = single source of truth for types
│       └── src/schemas/
├── scripts/           ← DB init, seed scripts, utilities
├── docs/
│   ├── specs/         ← Epics, features, schema specs
│   │   ├── epics/
│   │   ├── features/
│   │   └── schema/
│   ├── tickets/       ← Auto-generated tickets (SDD workflow)
│   └── project_notes/ ← Institutional memory
├── initialDoc/        ← PRD, Plan Maestro, DB diagram (reference only)
├── ai-specs/          ← SDD agent specs and standards
└── docker-compose.yml ← PostgreSQL 16 + pgvector + Redis
```

## Project Context — foodXPlorer

- **What**: Open source platform for nutritional information of restaurant dishes in Spain
- **Stack**: Node.js + TypeScript, Fastify, Prisma + Kysely, PostgreSQL 16 + pgvector, Redis, Zod
- **Phase**: Phase 1 — MVP (Bot + API + DB). 4 epics: E001 Infrastructure, E002 Data Ingestion, E003 Estimation Engine, E004 Telegram Bot + API
- **Monorepo**: npm workspaces (`packages/api`, `packages/bot`, `packages/shared`)
- **Key principle**: The DB is the product. The estimation engine calculates, the LLM only interprets/formats.

## Project Memory

Institutional knowledge lives in `docs/project_notes/`:

- **product-tracker.md** — Feature backlog, **Active Session** (current feature, next actions, open questions), completion log
- **bugs.md** — Bug log with solutions and prevention notes
- **decisions.md** — Architectural Decision Records (ADRs)
- **key_facts.md** — Project configuration, ports, URLs, branching strategy, naming conventions

## Session Recovery

After context loss, new session, or context compaction — BEFORE continuing work:

1. **Read product tracker** (`docs/project_notes/product-tracker.md`) → **Active Session** section
2. If there is an active feature → read the referenced ticket in `docs/tickets/`
3. Respect the configured autonomy level — do NOT skip checkpoints

## Anti-Patterns (Avoid)

- Installing dependencies in root directory (use workspaces: `-w @foodxplorer/api`)
- Skipping approvals at configured autonomy level
- Using `any` type without justification
- Creating files when existing ones can be extended
- Adding features not explicitly requested
- Committing without updating ticket acceptance criteria
- Forgetting to update product tracker's Active Session after step changes
- Using LLM for nutritional calculations (motor calculates, LLM interprets)

## Automated Hooks (Claude Code)

The project includes pre-configured hooks in `.claude/settings.json`:

- **Quick Scan** (`SubagentStop`): After `backend-developer` or `frontend-developer` finishes, a fast grep-based scan (~2s, no additional API calls) checks for `console.log`, `debugger`, `TODO/FIXME`, hardcoded secrets, and localhost references. Critical issues block; warnings are non-blocking (full review happens in Step 5).
- **Compaction Recovery** (`SessionStart → compact`): After context compaction, injects a reminder to read the product tracker Active Session for context recovery.

Personal notification hooks (macOS/Linux) are in `.claude/settings.local.json` — see that file for examples.

## Standards References

- [Base Standards](./ai-specs/specs/base-standards.mdc) — Constitution, methodology, workflow, agents
- [Backend Standards](./ai-specs/specs/backend-standards.mdc) — Backend patterns (Fastify, Prisma, Kysely)
- [Documentation Standards](./ai-specs/specs/documentation-standards.mdc) — Doc guidelines
