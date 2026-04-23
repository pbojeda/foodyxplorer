#!/bin/bash
# =============================================================================
# reseed-all-envs.sh — NutriXplorer seed data re-application (dev / prod)
# =============================================================================
#
# Purpose
#   Re-run the two idempotent seed commands on one or both Supabase
#   environments after new dishes or standard portions are merged:
#     1. npm run db:seed           -w @foodxplorer/api  (includes the 279
#                                                        Spanish dishes phase)
#     2. npm run seed:standard-portions -w @foodxplorer/api
#
#   Replaces the manual flow of editing packages/api/.env between runs.
#
# Required environment
#   `DATABASE_URL_DEV`   Supabase pooler URL for the dev project (port 5432).
#   `DATABASE_URL_PROD`  Supabase pooler URL for the prod project. Required
#                        only when `--prod` is passed.
#   Common typo: `DATABASE_URL_PRO` (missing the final D) — the script will
#   report "DATABASE_URL_PROD is not set" and exit.
#
#   Put them in packages/api/.env (symlinked to repo-root .env). They are
#   consumed only by this script — the normal DATABASE_URL is still used by
#   every other tool.
#
# Usage
#   # Dev only (default, safe):
#   ./packages/api/scripts/reseed-all-envs.sh
#
#   # Dev first, then prod (interactive prompt between):
#   ./packages/api/scripts/reseed-all-envs.sh --prod
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
for arg in "$@"; do
  case "$arg" in
    --prod) RUN_PROD=1 ;;
    -h|--help)
      sed -n '3,45p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown flag: $arg" >&2
      echo "Usage: $0 [--prod]" >&2
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
  log "Phase 1/2: npm run db:seed"
  ( cd "$REPO_ROOT" && DATABASE_URL="$url" npm run db:seed -w @foodxplorer/api ) \
    || fail "db:seed failed on $label"

  log "Phase 2/2: npm run seed:standard-portions"
  ( cd "$REPO_ROOT" && DATABASE_URL="$url" npm run seed:standard-portions -w @foodxplorer/api ) \
    || fail "seed:standard-portions failed on $label"

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
log "Target: dev$([ "$RUN_PROD" -eq 1 ] && echo ' + prod' || echo '')"
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
