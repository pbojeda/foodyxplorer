# `packages/api/scripts/`

Operational scripts for the `@foodxplorer/api` workspace. Unlike TypeScript
utilities under `packages/api/src/scripts/` (which are imported or invoked via
`npm run`), this directory holds standalone shell scripts used for QA,
benchmarks, and incident-response tooling that run against a deployed API.

## Scripts

### `qa-exhaustive.sh`

Exhaustive smoke-test battery for the `/conversation/message` endpoint plus
10 HTTP-status smoke checks on voice and envelope endpoints. Total: **650
runtime calls across 29 categories**.

Category groups:

- **1-13** — original 350-query battery (portions, drinks, diminutives, counts,
  size modifiers, accents, plurals, comparisons, menus, chain items,
  conversational wrappers, edge cases).
- **14** — endpoint / envelope smoke (10 HTTP-status assertions: `/health`,
  `/health/voice-budget` flat envelope, authentication checks, bad content
  types on `/conversation/audio`).
- **15-20** — gap-fill queries (90): NLP wrapper+count interactions, drink
  volume edges, plural/singular disagreement, casing/punctuation edges,
  user-perspective natural language, nutrient-specific questions.
- **21-24** — regional + international + bar talk + diets (100, authored by
  Gemini).
- **25-29** — adversarial, voice-STT-like, compound structures, measurement
  edges, temporal/context references (100, authored by Codex).

**Quick start**

```bash
# Against dev (admin key bypasses rate limits — F-TIER):
./packages/api/scripts/qa-exhaustive.sh | tee qa-dev-$(date +%Y%m%d).txt

# Against prod (override env vars):
API=https://api.nutrixplorer.com KEY=<prod-admin-key> \
  ./packages/api/scripts/qa-exhaustive.sh | tee qa-prod-$(date +%Y%m%d).txt
```

**Expected duration**: ~12-18 minutes (650 sequential HTTP requests, 10 s
timeout per request).

**Interpreting output**

| Prefix        | Meaning |
|---------------|---------|
| `OK`          | `/conversation/message` returned a full estimation with nutrients |
| `OK_SMOKE`    | Endpoint smoke check returned the expected HTTP status |
| `CMP`         | Comparison intent resolved both dishes |
| `MENU`        | Menu intent returned one estimation per detected item |
| `NULL`        | Query parsed but no estimation produced (often Category-D intent) |
| `ERR`         | HTTP error or response envelope was not `success: true` |
| `FAIL_SMOKE`  | Endpoint smoke check returned an unexpected HTTP status |

Final line prints totals. Reference baseline (post-QA Improvement Sprint,
original 350-query battery on dev, 2026-04-21):
`TOTAL: 350 | OK: 300 | NULL: 50 | FAIL: 0`.

**When to run**

- Before a release PR from `develop` to `main` (dev smoke-test)
- After a release merge to `main`, once deploys are green (prod smoke-test)
- When investigating regressions in conversation-pipeline tickets
- After migration + seed reruns to confirm data integrity

**Prerequisites**

- `curl` and `python3` (stdlib only) on `PATH`
- Admin-tier API key for the target environment (stored in password manager,
  not in this repo)
- Target API must be reachable and healthy

**Not in CI yet**. Treat as operator-run tooling. If you want a smaller,
CI-friendly subset (~50 queries, under a minute), extract the top-of-file
categories manually.

## Related

- `docs/research/qa-2026-04-21-exhaustive-results.md` — baseline category breakdown
- `docs/research/qa-improvement-sprint-report-2026-04-21.md` — sprint summary
- `packages/api/src/scripts/` — TypeScript operational scripts (seeds, backfills)
