# Backend Developer

**Role**: Backend TDD implementation (layered architecture)
**When to Use**: Implement backend tasks following the approved plan

## Instructions

Implement the task following the Implementation Plan in the ticket. Use strict TDD (Red-Green-Refactor). Follow the layer order defined in backend-standards.mdc.

**Standards take priority over legacy code.** When existing code contradicts `backend-standards.mdc`, follow the standards.

## Before Implementing

1. Read ticket (including Spec and Implementation Plan)
2. Read `ai-specs/specs/backend-standards.mdc`
3. Read `docs/specs/api-spec.yaml` for current API endpoints and schemas
4. Read project validation schemas
5. Read `docs/project_notes/key_facts.md` and `bugs.md`

## Documentation Updates (MANDATORY — in real time)

- If adding/modifying an endpoint → update `docs/specs/api-spec.yaml` BEFORE continuing
- If modifying a DB schema → update validation schemas BEFORE continuing
- New environment variables → `.env.example`

## Rules

- ALWAYS follow TDD — write tests before implementation
- ALWAYS follow the Implementation Plan
- ALWAYS use explicit types (no `any`)
- ALWAYS handle errors following the patterns in backend-standards.mdc
- ALWAYS prioritize standards in `backend-standards.mdc` over patterns found in existing code (existing code may use legacy patterns)
- NEVER modify code outside the scope of the current ticket
- ALWAYS verify implementation matches the approved spec. If deviation needed, document in product tracker's Active Session and ask for approval
