#!/bin/bash
# =============================================================================
# reseed-all-envs.sh — NutriXplorer seed data re-application (dev / prod)
# =============================================================================
#
# Purpose
#   Re-run the three idempotent seed phases on one or both Supabase
#   environments after new dishes or standard portions are merged:
#     1. npm run db:seed                -w @foodxplorer/api  (Spanish dishes)
#     2. npm run seed:standard-portions -w @foodxplorer/api  (portion terms)
#     3. npm run embeddings:generate    -w @foodxplorer/api  -- --target dishes
#                                            --chain-slug cocina-espanola
#        (regenerates OpenAI embeddings for dishes where
#         embedding_updated_at IS NULL — the zero-vectors the seed just
#         placed. Needed so L3 semantic search works for new dishes.)
#
#   Replaces the manual flow of editing packages/api/.env between runs.
#
# Required environment
#   `DATABASE_URL_DEV`   Supabase pooler URL for the dev project (port 5432).
#   `DATABASE_URL_PROD`  Supabase pooler URL for the prod project. Required
#                        only when `--prod` is passed.
#   `OPENAI_API_KEY`     Required for Phase 3 (embeddings). Pass
#                        `--skip-embeddings` if you cannot provide one.
#   Common typo: `DATABASE_URL_PRO` (missing the final D) — the script will
#   report "DATABASE_URL_PROD is not set" and exit.
#
#   Put them in packages/api/.env (symlinked to repo-root .env). They are
#   consumed only by this script — the normal DATABASE_URL is still used by
#   every other tool.
#
# Usage
#   # Dev only, fast path (dish-only — skips OFF). Default behavior:
#   ./packages/api/scripts/reseed-all-envs.sh
#
#   # Dev first, then prod (interactive y/N prompt between), fast path:
#   ./packages/api/scripts/reseed-all-envs.sh --prod
#
#   # Full seed including OFF (~15 min/env). Needed on fresh Supabase projects
#   # or after a Tier 0 OFF data change. Combines with --prod if desired.
#   ./packages/api/scripts/reseed-all-envs.sh --full
#   ./packages/api/scripts/reseed-all-envs.sh --prod --full
#
#   # Skip Phase 3 (e.g., local dev without an OpenAI key). L3 semantic
#   # search will not work for new dishes until embeddings are generated
#   # separately.
#   ./packages/api/scripts/reseed-all-envs.sh --skip-embeddings
#
# Flags
#   --prod              Run against prod after dev (with interactive y/N).
#   --full              Include OFF (Open Food Facts) in Phase 1 (~15 min).
#                       Default: SEED_SKIP_OFF=1 is exported, OFF is skipped.
#   --skip-embeddings   Skip Phase 3. Use only when you cannot provide an
#                       OpenAI key; L3 semantic search degrades for new
#                       dishes until you run embeddings:generate separately.
#
# Dependencies
#   bash (>= 3.2), npm, node 20+, Prisma client generated in packages/api/.
#   Optional: psql (if present, post-seed counts are validated; otherwise
#   only the seed exit codes gate success).
#
# Exit codes
#   0  all requested environments seeded OK (or dev OK + user declined prod)
#   1  missing env var, seed failure, or validation failure
#
# Safety
#   --prod requires interactive y/N confirmation; there is no --yes flag.
#   If dev fails the script aborts BEFORE touching prod.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

EXPECTED_DISH_COUNT="${EXPECTED_DISH_COUNT:-279}"
MIN_PORTION_COUNT="${MIN_PORTION_COUNT:-220}"

RUN_PROD=0
# F-TOOL-RESEED-002: dish-only refreshes (the common case) skip the OFF phase
# (11k+ products, ~15 min). `--full` opts back in when you need OFF reseeded
# (fresh bring-up of a Supabase project, or after a Tier 0 data change).
INCLUDE_OFF=0
# F-TOOL-RESEED-003: embeddings:generate runs after the seeds so L3 semantic
# search works for the dishes the seed just added. --skip-embeddings opts out
# (only valid when OPENAI_API_KEY is unavailable).
SKIP_EMBEDDINGS=0
for arg in "$@"; do
  case "$arg" in
    --prod) RUN_PROD=1 ;;
    --full) INCLUDE_OFF=1 ;;
    --skip-embeddings) SKIP_EMBEDDINGS=1 ;;
    -h|--help)
      sed -n '3,69p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown flag: $arg" >&2
      echo "Usage: $0 [--prod] [--full] [--skip-embeddings]" >&2
      exit 1
      ;;
  esac
done

# -----------------------------------------------------------------------------
# Load env vars from packages/api/.env if present (falls back to pre-exported
# values in the caller's shell). Sourcing does NOT auto-export — the script
# reads the values directly and passes them explicitly to subshells.
# -----------------------------------------------------------------------------
ENV_FILE="$REPO_ROOT/packages/api/.env"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ENV_FILE"
fi

# Gemini review fix (least privilege): capture the OpenAI key into a local
# variable and unset it from the script's env. This way Phases 1 and 2 (which
# do not need it) run in subshells that don't inherit it. Only Phase 3
# receives it, via an explicit `VAR=val` prefix.
OPENAI_KEY_VALUE="${OPENAI_API_KEY:-}"
unset OPENAI_API_KEY

if [ -z "${DATABASE_URL_DEV:-}" ]; then
  echo "ERROR: DATABASE_URL_DEV not set (looked in $ENV_FILE and shell)." >&2
  echo "Add it to packages/api/.env. See .env.example for the expected shape." >&2
  exit 1
fi

if [ "$RUN_PROD" -eq 1 ] && [ -z "${DATABASE_URL_PROD:-}" ]; then
  echo "ERROR: --prod requested but DATABASE_URL_PROD is not set." >&2
  echo "Note: a common typo is DATABASE_URL_PRO — the script requires DATABASE_URL_PROD (with trailing D)." >&2
  exit 1
fi

if [ "$SKIP_EMBEDDINGS" -eq 0 ] && [ -z "$OPENAI_KEY_VALUE" ]; then
  echo "ERROR: OPENAI_API_KEY is required for Phase 3 (embeddings:generate)." >&2
  echo "Either set OPENAI_API_KEY in packages/api/.env or shell env," >&2
  echo "or re-run with --skip-embeddings if you can't provide a key." >&2
  echo "Skipping embeddings means L3 semantic search won't work for new dishes" >&2
  echo "until you run embeddings:generate separately." >&2
  exit 1
fi

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
log()  { printf '[reseed] %s\n' "$*"; }
warn() { printf '[reseed][WARN] %s\n' "$*" >&2; }
fail() { printf '[reseed][FAIL] %s\n' "$*" >&2; exit 1; }

# Mask a Supabase pooler URL for logging: keep the project-ref only.
mask_url() {
  local url="$1"
  printf '%s' "$url" | sed -E 's#://[^:]+:[^@]+@#://<user>:<pass>@#'
}

# Run the two seeds + (optionally) validate counts for a single environment.
# $1 = human-readable label (dev/prod)
# $2 = DATABASE_URL for the target environment
reseed_one() {
  local label="$1"
  local url="$2"

  log "=== $label ==="
  log "URL: $(mask_url "$url")"
  local total_phases
  if [ "$SKIP_EMBEDDINGS" -eq 1 ]; then total_phases=2; else total_phases=3; fi

  # Phase 1 — seed. For --full we must truly UNSET SEED_SKIP_OFF (not set it
  # to empty string) in case a future .env ever ships with it pre-set. Codex
  # review fix.
  if [ "$INCLUDE_OFF" -eq 1 ]; then
    log "Phase 1/$total_phases: npm run db:seed (full — includes OFF, ~15 min)"
    ( cd "$REPO_ROOT" && env -u SEED_SKIP_OFF DATABASE_URL="$url" npm run db:seed -w @foodxplorer/api ) \
      || fail "db:seed failed on $label"
  else
    log "Phase 1/$total_phases: npm run db:seed (fast — SEED_SKIP_OFF=1)"
    ( cd "$REPO_ROOT" && DATABASE_URL="$url" SEED_SKIP_OFF=1 npm run db:seed -w @foodxplorer/api ) \
      || fail "db:seed failed on $label"
  fi

  log "Phase 2/$total_phases: npm run seed:standard-portions"
  ( cd "$REPO_ROOT" && DATABASE_URL="$url" npm run seed:standard-portions -w @foodxplorer/api ) \
    || fail "seed:standard-portions failed on $label"

  if [ "$SKIP_EMBEDDINGS" -eq 0 ]; then
    log "Phase 3/$total_phases: npm run embeddings:generate (dishes, cocina-espanola)"
    # Without --force, the pipeline only touches dishes where
    # embedding_updated_at IS NULL — exactly the zero-vector rows the seed
    # just placed for new dishes. Existing dishes with real embeddings are
    # skipped, so the cost is proportional to the new-dish count. Phase 3
    # is idempotent: a mid-run failure can be fixed by re-running the same
    # command — previously-embedded rows are skipped automatically.
    #
    # OPENAI_API_KEY is only passed into this subshell (least privilege —
    # Phases 1 and 2 do not need it).
    ( cd "$REPO_ROOT" && \
      DATABASE_URL="$url" \
      OPENAI_API_KEY="$OPENAI_KEY_VALUE" \
      npm run embeddings:generate -w @foodxplorer/api -- \
        --target dishes --chain-slug cocina-espanola ) \
      || fail "embeddings:generate failed on $label (safe to re-run — completed rows are skipped)"
  else
    warn "Phase 3 skipped (--skip-embeddings). L3 semantic search will be degraded for new dishes until you run:"
    warn "    DATABASE_URL=\"\$DATABASE_URL_$(echo "$label" | tr '[:lower:]' '[:upper:]')\" npm run embeddings:generate -w @foodxplorer/api -- --target dishes --chain-slug cocina-espanola"
  fi

  if command -v psql >/dev/null 2>&1; then
    # libpq rejects Prisma-only query parameters (`pgbouncer=true`,
    # `connection_limit=1`). Strip the entire query string before calling psql
    # — the seed ran with the full URL via Prisma, which DOES support them.
    local psql_url="${url%%\?*}"
    log "Validating post-seed counts..."
    local dish_count portion_count
    dish_count="$(PGOPTIONS='-c search_path=public' psql "$psql_url" -tAc \
      "SELECT COUNT(*) FROM dishes WHERE id LIKE '00000000-0000-e073-0007-%';" \
      2>/dev/null || echo "ERR")"
    portion_count="$(PGOPTIONS='-c search_path=public' psql "$psql_url" -tAc \
      "SELECT COUNT(*) FROM standard_portions;" \
      2>/dev/null || echo "ERR")"

    if [ "$dish_count" = "ERR" ] || [ "$portion_count" = "ERR" ]; then
      # Query failure after the seed already succeeded indicates an
      # environment problem (credentials, network, schema) worth surfacing.
      fail "psql validation query failed on $label — check DB credentials/network/schema"
    fi
    log "dishes(e073-0007-%): $dish_count (expected $EXPECTED_DISH_COUNT)"
    log "standard_portions:  $portion_count (min $MIN_PORTION_COUNT)"
    if [ "$dish_count" -lt "$EXPECTED_DISH_COUNT" ]; then
      fail "dish count $dish_count < expected $EXPECTED_DISH_COUNT on $label"
    fi
    if [ "$portion_count" -lt "$MIN_PORTION_COUNT" ]; then
      fail "standard_portions count $portion_count < min $MIN_PORTION_COUNT on $label"
    fi
  else
    warn "psql not found on PATH — skipping count validation on $label"
    warn "Install with: brew install libpq && brew link --force libpq"
  fi

  log "$label: DONE"
  echo
}

# -----------------------------------------------------------------------------
# Execute — dev first (always), prod only with --prod + interactive y/N.
# -----------------------------------------------------------------------------
log "Target:     dev$([ "$RUN_PROD" -eq 1 ] && echo ' + prod' || echo '')"
log "Seed mode:  $([ "$INCLUDE_OFF" -eq 1 ] && echo 'FULL (includes OFF — ~15 min/env)' || echo 'FAST (SEED_SKIP_OFF=1)')"
log "Embeddings: $([ "$SKIP_EMBEDDINGS" -eq 1 ] && echo 'SKIPPED (--skip-embeddings)' || echo 'ENABLED (Phase 3)')"
if [ "$INCLUDE_OFF" -eq 1 ] && [ "$SKIP_EMBEDDINGS" -eq 0 ]; then
  # Gemini review fix: --full re-imports OFF products but Phase 3 only
  # regenerates cocina-espanola dish embeddings, NOT OFF food embeddings.
  # Make that expectation explicit so the operator doesn't think L3 is
  # covered end-to-end.
  warn "Phase 3 regenerates embeddings for cocina-espanola DISHES only."
  warn "OFF product embeddings (foods) are NOT regenerated here. If you need"
  warn "those, run: npm run embeddings:generate -w @foodxplorer/api -- --target foods"
fi
echo

reseed_one "dev" "$DATABASE_URL_DEV"

if [ "$RUN_PROD" -eq 1 ]; then
  printf '[reseed] Dev OK. Continue to PROD? [y/N] '
  read -r reply
  if [ "$reply" != "y" ] && [ "$reply" != "Y" ]; then
    log "Prod skipped by operator."
    exit 0
  fi
  reseed_one "prod" "$DATABASE_URL_PROD"
fi

log "All requested environments seeded successfully."
