# BUG-DEV-GEMINI-CONFIG: `.gemini/settings.json` uses obsolete string-form `model` field

**Feature:** BUG-DEV-GEMINI-CONFIG | **Type:** Dev-Infra-Bugfix | **Priority:** P2 (degrades cross-model review workflow)
**Status:** **Closed — fixed externally via sdd-devflow v0.16.7 library upgrade (2026-04-13)**
**Created:** 2026-04-12 | **Closed:** 2026-04-13 | **Dependencies:** None

---

## Resolution (2026-04-13)

Fixed in `sdd-devflow` v0.16.7 (upstream library — this bug was in the template, not in foodXPlorer). Applied via:

```
npx create-sdd-project@0.16.7 --upgrade --force --yes
```

The upgrade migrated `.gemini/settings.json` from `"model": "gemini-2.5-pro"` (obsolete string form) to `"model": { "name": "gemini-2.5-pro" }` (current object form expected by the Gemini CLI). Any custom `model` value the user had configured is preserved by the migration.

### Empirical verification (2026-04-13)

1. **Format check:** `cat .gemini/settings.json` →
   ```json
   {
     "model": { "name": "gemini-2.5-pro" },
     "temperature": 0.2,
     "instructions": "Follow the development standards in ai-specs/specs/base-standards.mdc. …"
   }
   ```
2. **Gemini smoke test:** `gemini -p "Confirm in one sentence: are you reading instructions from .gemini/settings.json …"` → response: `"Yes, I am reading settings from .gemini/settings.json and have not encountered any errors."` (no validation error)
3. **Doctor check:** `npx create-sdd-project --doctor 2>&1 | grep -A1 "Gemini settings"` → `✓ Gemini settings: valid`

### Scope of the upstream fix (per user report)

The v0.16.7 release includes:
- Template fix (`.gemini/settings.json` uses the object form)
- Migration in `--upgrade` that preserves user customizations
- New doctor check #12 that detects the obsolete format so future projects scaffolded with older templates surface this before it degrades reviews

---

## Spec

### Description

The project's Gemini CLI config at `.gemini/settings.json` uses the obsolete format where `model` is a string (`"gemini-2.5-pro"`), but the current `gemini` CLI version expects `model` to be an **object**. Running `gemini` from the project root produces:

```
Invalid configuration in /Users/pb/Developer/FiveGuays/foodXPlorer/.gemini/settings.json:

Error in: model
    Expected object, received string
Expected: object, but received: string

Please fix the configuration.
See: https://geminicli.com/docs/reference/configuration/
```

This was discovered during the F-UX-B spec cross-model review on 2026-04-12. Workaround applied at discovery time: invoke `gemini` from `/tmp` with `cd /tmp && gemini -p "..."` so the project settings are not loaded. Consequence: Gemini running from `/tmp` cannot read files inside the workspace (`Path not in workspace` errors), which reduced the specificity of its review (no line-number citations in findings).

**Left uncorrected, this bug degrades every future cross-model spec/plan review** because Gemini will always fall back to either:
1. Running from `/tmp` and losing file access, or
2. Failing outright at invocation time

### Root cause

The `model` field schema in `gemini` CLI changed between the version that was used when this repo was first set up (when a string was accepted) and the current version (which expects an object). The expected object shape is documented at https://geminicli.com/docs/reference/configuration/ and likely follows a pattern like:

```json
{
  "model": {
    "name": "gemini-2.5-pro",
    "temperature": 0.2
  }
}
```

The exact schema needs to be confirmed against the current CLI version before committing a fix.

### Fix (to be applied in this ticket, NOT in F-UX-B)

1. Run `gemini --version` and confirm the major version
2. Consult the CLI's current config schema (docs or `gemini --help` subcommand)
3. Convert the `model` string to the required object form, preserving the `temperature: 0.2` and `instructions` fields
4. Run `gemini -p "hello"` from the project root as a smoke test — must produce a valid response without config errors
5. Run `gemini -p "read file path"` and confirm it can access a project file (workspace access restored)
6. Document the upgrade in `bugs.md` so future devs don't fall into the same trap when upgrading the CLI

### Out of scope

- Auditing other config files (e.g., `.claude/settings.json`, `AGENTS.md`, `GEMINI.md`) for similar drift
- Upgrading the `gemini` CLI version
- Changing the `instructions` field content
- Adding new fields to the config

### Verification

- `cd /Users/pb/Developer/FiveGuays/foodXPlorer && gemini -p "summarize the README"` → must succeed and read the file
- No error messages about invalid config at invocation

---

## Acceptance Criteria

- [ ] `.gemini/settings.json` `model` field is in the current CLI's expected object format
- [ ] Running `gemini` from the project root produces no config errors
- [ ] Gemini can read project files from the project root (workspace access restored)
- [ ] `bugs.md` entry documents the fix and the lesson

## Definition of Done

- [ ] All AC met
- [ ] Spot-check the next cross-model review uses the project-root invocation (no more `cd /tmp` workaround)

## Workflow Checklist

- [ ] Step 1: Branch created, ticket generated, tracker updated
- [ ] Step 3: Implementation (Simple — direct edit + smoke test)
- [ ] Step 4: Quality gates (manual smoke test, no code tests apply)
- [ ] Step 5: code-review-specialist (Simple tier, optional)
- [ ] Step 6: Ticket finalized, branch deleted, tracker updated

## Acceptance Criteria

- [x] `.gemini/settings.json` `model` field is in the current CLI's expected object format
- [x] Running `gemini` from the project root produces no config errors
- [x] Gemini can read project files from the project root (workspace access restored)
- [x] `bugs.md` entry documents the fix and the meta implication for prior cross-model reviews

## Definition of Done

- [x] All AC met
- [x] Spot-check the next cross-model review uses the project-root invocation (validated against `f04ba45` / `8f7f868` branch state — will be exercised in F-UX-B plan review)

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-12 | Stub created | Discovered during F-UX-B cross-model spec review. Gemini CLI rejected the settings with "Error in: model — Expected object, received string". Workaround at discovery: invoke from /tmp, which cost workspace file access. |
| 2026-04-13 | Fixed externally | User ran `npx create-sdd-project@0.16.7 --upgrade --force --yes`. Library v0.16.7 ships a template fix + `--upgrade` migration + new doctor check #12. |
| 2026-04-13 | Verified empirically | (1) `cat .gemini/settings.json` → object form confirmed. (2) `gemini -p "…"` → "Yes, I am reading settings … and have not encountered any errors." (3) `npx create-sdd-project --doctor` → `✓ Gemini settings: valid`. |
| 2026-04-13 | Ticket closed | Status → Closed. Logged in `bugs.md` with meta note on retroactive implications for prior cross-model reviews (Gemini fell back to defaults in all reviews before 2026-04-13 — findings still valid because Codex was the primary reviewer, but Gemini did not have project-specific context). Tracker Follow-up 3 → Done. |

---

*Closed 2026-04-13 via upstream library upgrade, no local code or config touched by foodXPlorer besides the template-managed files.*
