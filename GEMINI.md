<!-- See AGENTS.md for universal project instructions (structure, commands, memory, anti-patterns). -->
<!-- See ai-specs/specs/base-standards.mdc for methodology (constitution, workflow, agents, git). -->
<!-- Note: Gemini agent files (.gemini/agents/) are intentionally concise. Full methodology details live in ai-specs/specs/ and AGENTS.md. -->

## Gemini-Specific Configuration

<!-- CONFIG: Set your preferred autonomy level (1-5). See base-standards.mdc § Autonomy Levels for definitions. -->
**Autonomy Level: 5 (PM Autonomous)**

<!-- CONFIG: Set branching strategy in docs/project_notes/key_facts.md (github-flow or gitflow) -->

## Session Recovery (Gemini)

After context loss or new session — BEFORE continuing work:

1. Read product tracker (`docs/project_notes/product-tracker.md`) → **Active Session**
2. If active feature → read referenced ticket in `docs/tickets/`
3. Re-read the workflow skill (`.gemini/skills/development-workflow/SKILL.md`) to know what actions the current step requires
4. If at Step 5 or later → read `references/merge-checklist.md` and check if the ticket's `## Merge Checklist Evidence` table needs to be filled
5. Respect the autonomy level set above
6. If L5 (PM Autonomous) and `docs/project_notes/pm-session.md` exists → read it and run `continue pm` to resume the PM Orchestrator session
