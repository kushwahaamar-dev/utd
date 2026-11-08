#!/bin/sh
# Deploys iynk_passport to devnet (or upgrades it in place) with the iynk
# deployer key, then publishes or upgrades the on-chain IDL so Solana Explorer
# can decode its instructions. Keys stay in ~/.config/solana/iynk; this script
# prints public keys and signatures only.
set -eu
cd "$(dirname "$0")/.."

KEYS="$HOME/.config/solana/iynk"
DEPLOYER="$KEYS/deployer.json"
PROGRAM_KEYPAIR="$KEYS/iynk_passport-keypair.json"
# A named buffer lets a failed deploy resume, and stops the CLI from printing
# the seed phrase of the throwaway buffer key it would otherwise create.
BUFFER="$KEYS/deploy-buffer.json"
URL="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
SO=target/deploy/iynk_passport.so
IDL=target/idl/iynk_passport.json

for f in "$DEPLOYER" "$PROGRAM_KEYPAIR" "$SO" "$IDL"; do
  [ -f "$f" ] || { echo "Missing $f (build with: npm run build)" >&2; exit 1; }
done

if [ ! -f "$BUFFER" ]; then
  solana-keygen new --no-bip39-passphrase --silent --outfile "$BUFFER" >/dev/null
  chmod 600 "$BUFFER"
fi

PROGRAM_ID=$(solana-keygen pubkey "$PROGRAM_KEYPAIR")
DEPLOYER_ID=$(solana-keygen pubkey "$DEPLOYER")
SIZE=$(wc -c < "$SO" | tr -d ' ')

# A deploy or upgrade first writes the whole program into a buffer, so the
# deployer needs the buffer's rent up front plus fees, whatever it holds later.
RENT=$(solana rent "$((SIZE + 45))" --lamports --url "$URL" | awk '{print $3}')
NEED=$((RENT + 60000000))
HAVE=$(solana balance "$DEPLOYER_ID" --lamports --url "$URL" | awk '{print $1}')
echo "program $PROGRAM_ID, $SIZE bytes; deployer $DEPLOYER_ID holds $HAVE lamports, needs about $NEED"
if [ "$HAVE" -lt "$NEED" ]; then
  echo "Fund the deployer with at least $(( (NEED - HAVE) / 1000000 + 1 )) milli-SOL on devnet (https://faucet.solana.com), then rerun." >&2
  exit 2
fi

if solana program show "$PROGRAM_ID" --url "$URL" >/dev/null 2>&1; then
  echo "upgrading the existing program"
  # An upgrade cannot grow past the space the first deploy reserved. Extend by the shortfall.
  CURRENT=$(solana program show "$PROGRAM_ID" --url "$URL" | awk '/Data Length:/ {print $3}')
  if [ -n "$CURRENT" ] && [ "$SIZE" -gt "$CURRENT" ]; then
    echo "extending the program by $((SIZE - CURRENT)) bytes"
    solana program extend "$PROGRAM_ID" "$((SIZE - CURRENT))" --keypair "$DEPLOYER" --url "$URL"
  fi
  solana program deploy "$SO" --program-id "$PROGRAM_ID" --upgrade-authority "$DEPLOYER" \
    --buffer "$BUFFER" --keypair "$DEPLOYER" --url "$URL" --use-rpc --max-sign-attempts 50
else
  echo "first deploy (data account sized to the program; later upgrades extend it as needed)"
  solana program deploy "$SO" --program-id "$PROGRAM_KEYPAIR" --upgrade-authority "$DEPLOYER" \
    --buffer "$BUFFER" --keypair "$DEPLOYER" --url "$URL" --use-rpc --max-sign-attempts 50 --max-len "$SIZE"
fi

# A deployed program only becomes callable in a later slot.
SLOT=$(solana slot --url "$URL")
while [ "$(solana slot --url "$URL")" -lt $((SLOT + 2)) ]; do sleep 1; done

if anchor idl fetch "$PROGRAM_ID" --provider.cluster "$URL" >/dev/null 2>&1; then
  anchor idl upgrade --filepath "$IDL" --provider.cluster "$URL" --provider.wallet "$DEPLOYER" "$PROGRAM_ID"
else
  anchor idl init --filepath "$IDL" --provider.cluster "$URL" --provider.wallet "$DEPLOYER" "$PROGRAM_ID"
fi

solana program show "$PROGRAM_ID" --url "$URL"

# Initialize the config (or rotate its issuer to this machine's issuer key) and create a
# demo prize race. Neither airdrops anything. SKIP_SETUP=1 / SKIP_DEMO_RACE=1 skip a step;
# the race can be made later with node scripts/devnet-demo-race.ts (flags in solana/README.md).
if [ "${SKIP_SETUP:-0}" != "1" ]; then
  node scripts/devnet-setup.ts --set-issuer
fi
if [ "${SKIP_DEMO_RACE:-0}" != "1" ]; then
  node scripts/devnet-demo-race.ts
fi

echo "https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
