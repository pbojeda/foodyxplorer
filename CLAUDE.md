<!-- See AGENTS.md for universal project instructions (structure, commands, memory, anti-patterns). -->
<!-- See ai-specs/specs/base-standards.mdc for methodology (constitution, workflow, agents, git). -->

## Claude-Specific Configuration

<!-- CONFIG: Set your preferred autonomy level (1-4). See base-standards.mdc § Autonomy Levels for definitions. -->
**Autonomy Level: 2 (Trusted)**

<!-- CONFIG: Set branching strategy in docs/project_notes/key_facts.md (github-flow or gitflow) -->

## Session Recovery (Claude Code)

After context compaction or new session — BEFORE continuing work:

1. Read product tracker (`docs/project_notes/product-tracker.md`) → **Active Session**
2. If active feature → read referenced ticket in `docs/tickets/`
3. Read the active skill file (`.claude/skills/*/SKILL.md`)
4. Do NOT proceed past any checkpoint without user confirmation (respect autonomy level)
5. If Active Session shows a pending checkpoint, ask before continuing
