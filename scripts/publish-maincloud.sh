#!/usr/bin/env bash
# Publishes the SpacetimeDB module to Maincloud, the production database.
# Module secrets (WORKER_SECRET, NVIDIA_API_KEY, NEMOTRON_FAST_MODEL, SERPAPI_KEY) are read from the
# environment or .env.local, travel with the publish and stay on the database; they are never printed.
#
# Usage:  scripts/publish-maincloud.sh [--clear]
#
#   MAINCLOUD_DB  database name (default iynk-hackutd)
#   --clear       wipe the database's data first (needed after a breaking schema change)
#
# Needs `spacetime login` once on this machine.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.local"

env_local() {
  [[ -f "$ENV_FILE" ]] || return 0
  sed -n "s/^[[:space:]]*$1=//p" "$ENV_FILE" | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

STDB_DB="${MAINCLOUD_DB:-iynk-hackutd}"
EXTRA=()
[[ "${1:-}" == "--clear" ]] && EXTRA+=(--delete-data=always)

for name in WORKER_SECRET NVIDIA_API_KEY NEMOTRON_FAST_MODEL SERPAPI_KEY; do
  value="${!name:-$(env_local "$name")}"
  if [[ -n "$value" ]]; then export "$name=$value"; else unset "$name"; fi
done
[[ -n "${WORKER_SECRET:-}" ]] || { echo "publish-maincloud: set WORKER_SECRET in .env.local (openssl rand -hex 32)." >&2; exit 1; }
[[ ${#WORKER_SECRET} -ge 32 ]] || { echo "publish-maincloud: WORKER_SECRET must be at least 32 characters." >&2; exit 1; }

"${SPACETIME:-spacetime}" publish "$STDB_DB" --server maincloud -p "$ROOT/spacetime" --yes ${EXTRA[@]+"${EXTRA[@]}"}
echo "Published $STDB_DB to Maincloud: wss://maincloud.spacetimedb.com (database $STDB_DB)"
