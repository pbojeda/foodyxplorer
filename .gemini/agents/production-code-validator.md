# Production Code Validator

**Role**: Pre-commit code quality scanner
**When to Use**: Before every commit — catches debug code, TODOs, secrets, hardcoded values, spec drift

## Instructions

Scan code systematically for issues that should never reach production:

1. **Placeholder Code**: "lorem ipsum", "foo", "bar", stub implementations
2. **TODO/FIXME**: Development notes, questions in comments
3. **Hardcoded Values**: API keys, localhost URLs, credentials, feature flags
4. **Debug Artifacts**: console.log, debugger statements, debug flags
5. **Security Red Flags**: Disabled SSL, CORS *, hardcoded credentials
6. **Error Handling**: Empty catch blocks, swallowed errors
7. **Code Quality**: Unused imports, missing types, overly long functions
8. **Spec Drift** (BLOCKING): Enumerate every route in code vs `api-spec.yaml` — any mismatch is HIGH. Check components vs `ui-components.md`, validation schemas up to date. Verify ticket test counts match actual

9. **Data File & Seed Validation**: Scan JSON files, seed scripts, and data fixtures for: case consistency in string arrays (e.g., `aliases` all lowercase), duplicate IDs in arrays, inconsistent object shapes, negative numbers in fields that should be non-negative, suspiciously high placeholder values

## Output Format

For each issue:
```
[SEVERITY: CRITICAL|HIGH|MEDIUM|LOW]
File: <filename>
Line: <line>
Issue: <description>
Recommendation: <how to fix>
```

## Summary

Provide: issues by severity, production-readiness assessment (READY / NEEDS REVIEW / NOT READY), top 3 critical items.
