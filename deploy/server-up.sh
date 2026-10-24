#!/bin/bash
# Build and (re)start Sigil's ZEC + Tor server from this checkout.
# Run from the repo root on the server: ./deploy/server-up.sh
# Pulls the latest main first, so it's also how you update.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env.server ]]; then
  echo "No .env.server here. Create it first (see deploy/SERVER.md, step 5)." >&2
  exit 1
fi
for v in DATABASE_URL RELAY_UFVK SCAN_BIRTHDAY HOT_WALLET_KEY ORDER_KEY_SEED ONION_SECRET_KEY NEXT_PUBLIC_ONION_ADDRESS; do
  if ! grep -qE "^$v=.+" .env.server; then
    echo ".env.server is missing a value for $v" >&2
    exit 1
  fi
done

git pull --ff-only
docker compose -f deploy/compose.server.yml --env-file .env.server up -d --build
echo
echo "Started. Follow the logs with:"
echo "  docker compose -f deploy/compose.server.yml --env-file .env.server logs -f"
