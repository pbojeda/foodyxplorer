# `packages/api/scripts/`

Operational scripts for the `@foodxplorer/api` workspace. Unlike TypeScript
utilities under `packages/api/src/scripts/` (which are imported or invoked via
`npm run`), this directory holds standalone shell scripts used for QA,
benchmarks, and incident-response tooling that run against a deployed API.

## Scripts

### `reseed-all-envs.sh`

Re-runs the two idempotent seed commands (`db:seed` + `seed:standard-portions`)
against the dev Supabase project by default, and optionally against prod after
an interactive confirmation. Replaces the manual flow of editing `.env`
between runs.

**Required env vars** (add to `packages/api/.env` once):

```bash
DATABASE_URL_DEV="postgresql://...dev-pooler:5432/postgres"
DATABASE_URL_PROD="postgresql://...prod-pooler:5432/postgres"  # only if using --prod
```

**Quick start**

```bash
# Dev only (safe default):
./packages/api/scripts/reseed-all-envs.sh

# Dev first, then prod (interactive y/N prompt between):
./packages/api/scripts/reseed-all-envs.sh --prod
```

**Validation**: if `psql` is installed the script verifies that
`SELECT COUNT(*) FROM dishes WHERE id LIKE '00000000-0000-e073-0007-%' >= 279`
and `SELECT COUNT(*) FROM standard_portions >= 220` after each environment.
Override thresholds with `EXPECTED_DISH_COUNT` / `MIN_PORTION_COUNT`. Without
`psql` the script falls back to exit-code gating only.

**When to run**

- After merging any feature that adds/updates `spanish-dishes.json` or
  `standard-portions.csv`.
- When bringing up a fresh Supabase project.
- Before a release from `develop` to `main`, to keep dev current.

**Not in CI**. Treat as operator-run tooling — it connects directly to
Supabase and is gated by credentials in `.env`.

---

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
