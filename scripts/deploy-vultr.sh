#!/usr/bin/env bash
# Deploys the whole iynk backend to the Vultr VM made by scripts/deploy-vultr-create.sh:
#   1. builds the SpacetimeDB module bundle here,
#   2. copies the repo to /opt/iynk on the VM and writes deploy/core/.env from .env.local,
#   3. `docker compose up -d --build` (SpacetimeDB, agent worker, web, Caddy),
#   4. publishes the module into the VM's SpacetimeDB from inside its container,
#   5. waits for https://<domain>.
# Safe to re-run: rsync skips unchanged files, compose recreates only what changed, and a publish
# migrates the database in place.
#
# Usage:  VULTR_HOST=203.0.113.7 scripts/deploy-vultr.sh [ssh-private-key]
#
#   VULTR_HOST   the VM's IPv4 or hostname (environment or .env.local)
#   SSH_KEY      private key for the VM (default ~/.ssh/id_ed25519)
#   DOMAIN       default <ip-with-dashes>.sslip.io for an IP, else VULTR_HOST
#   STDB_DB      database name (default iynk)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.local"
REMOTE_DIR="/opt/iynk"

die() {
  echo "deploy-vultr: $*" >&2
  exit 1
}

env_local() {
  [[ -f "$ENV_FILE" ]] || return 0
  sed -n "s/^[[:space:]]*$1=//p" "$ENV_FILE" | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

VULTR_HOST="${VULTR_HOST:-$(env_local VULTR_HOST)}"
[[ -n "$VULTR_HOST" ]] || die "set VULTR_HOST (the VM's IP or hostname) in the environment or .env.local."
[[ "$VULTR_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || die "VULTR_HOST must be an IPv4 address or a hostname."
SSH_KEY="${1:-${SSH_KEY:-$HOME/.ssh/id_ed25519}}"
[[ -f "$SSH_KEY" ]] || die "SSH key not found: $SSH_KEY"
STDB_DB="${STDB_DB:-$(env_local STDB_DB)}"
STDB_DB="${STDB_DB:-iynk}"

DOMAIN="${DOMAIN:-$(env_local DOMAIN)}"
if [[ -z "$DOMAIN" ]]; then
  if [[ "$VULTR_HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then DOMAIN="${VULTR_HOST//./-}.sslip.io"; else DOMAIN="$VULTR_HOST"; fi
fi
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || die "DOMAIN must be a bare hostname."

TARGET="root@$VULTR_HOST"
SSH_OPTS=(-i "$SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
remote() { ssh "${SSH_OPTS[@]}" "$TARGET" "$@"; }

echo "==> Building the SpacetimeDB module"
(cd "$ROOT/spacetime" && "${SPACETIME:-spacetime}" build >/dev/null)
BUNDLE="$(cd "$ROOT/spacetime" && find dist target -maxdepth 3 -name '*.js' -newer package.json 2>/dev/null | head -n 1 || true)"
[[ -n "$BUNDLE" ]] || die "spacetime build produced no .js bundle under spacetime/dist or spacetime/target."

echo "==> Preparing $TARGET (Docker, compose, firewall)"
remote "bash -s" <<'BOOTSTRAP'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1 || ! command -v rsync >/dev/null; then
  apt-get update -q
  apt-get install -y -q docker.io docker-compose-v2 rsync
fi
systemctl enable --now docker >/dev/null
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  for rule in 22/tcp 80/tcp 443/tcp 443/udp; do ufw allow "$rule" >/dev/null; done
fi
mkdir -p /opt/iynk
BOOTSTRAP

echo "==> Copying the repo"
RSH="ssh"
for opt in "${SSH_OPTS[@]}"; do RSH+=" '${opt//\'/}'"; done
rsync -az --delete -e "$RSH" \
  --exclude .git --exclude node_modules --exclude '.next*' --exclude '.env*' --exclude deploy/core/.env \
  --exclude '*.keypair.json' --exclude id.json --exclude solana/target --exclude spacetime/.data \
  --exclude test-results --exclude playwright-report --exclude coverage --exclude notes \
  "$ROOT/" "$TARGET:$REMOTE_DIR/" >/dev/null

# Server-side settings only; values are read from .env.local and never printed.
{
  printf 'DOMAIN=%s\nSTDB_DB=%s\n' "$DOMAIN" "$STDB_DB"
  for name in NVIDIA_API_KEY NEMOTRON_BASE_URL NEMOTRON_FAST_MODEL NEMOTRON_PLANNER_MODEL NEMOTRON_VISION_MODEL \
    SERPAPI_KEY WORKER_SECRET SOLANA_ISSUER_KEYPAIR SOLANA_RPC_URL NEXT_PUBLIC_SOLANA_PROGRAM_ID; do
    value="${!name:-$(env_local "$name")}"
    [[ -z "$value" ]] || printf '%s=%s\n' "$name" "$value"
  done
} | remote "umask 077 && cat > $REMOTE_DIR/deploy/core/.env"

echo "==> Starting SpacetimeDB, worker, web and Caddy for $DOMAIN"
remote "cd $REMOTE_DIR/deploy/core && docker compose up -d --build --remove-orphans spacetimedb"

echo "==> Publishing the module to the VM's SpacetimeDB"
remote "cd $REMOTE_DIR/deploy/core && docker compose exec -T spacetimedb \
  spacetime publish -s local --yes --js-path /module/$BUNDLE $STDB_DB"

remote "cd $REMOTE_DIR/deploy/core && docker compose up -d --build --remove-orphans"

echo "==> Waiting for https://$DOMAIN (the first certificate can take a minute)"
for _ in $(seq 1 60); do
  if curl -fsS --max-time 5 "https://$DOMAIN/v1/ping" >/dev/null 2>&1 && curl -fsS --max-time 10 "https://$DOMAIN/en" >/dev/null 2>&1; then
    echo "Up: https://$DOMAIN (SpacetimeDB at wss://$DOMAIN, database $STDB_DB)"
    exit 0
  fi
  sleep 5
done
die "https://$DOMAIN is not answering after 5 minutes; check: ssh $TARGET 'cd $REMOTE_DIR/deploy/core && docker compose logs --tail 80'"
