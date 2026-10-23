#!/bin/bash
# Runs tor, the site and the ZEC worker side by side. If any of them dies the
# container exits and the host restarts it: a half-alive relayer is worse
# than a restart.
set -euo pipefail

PORT="${PORT:-3000}"
# 0.0.0.0 serves the public URL too; set HOSTNAME=127.0.0.1 for onion-only.
HOSTNAME="${HOSTNAME:-0.0.0.0}"
HS=/tmp/tor/relay
mkdir -p /tmp/tor/data "$HS"
chmod 700 /tmp/tor /tmp/tor/data "$HS"
sed "s/__PORT__/$PORT/" /etc/tor/torrc.template > /tmp/tor/torrc

if [[ -n "${ONION_SECRET_KEY:-}" ]]; then
  printf '%s' "$ONION_SECRET_KEY" | base64 -d > "$HS/hs_ed25519_secret_key"
  chmod 600 "$HS/hs_ed25519_secret_key"
else
  echo "entrypoint: ONION_SECRET_KEY is not set; tor makes a throwaway address that changes every deploy" >&2
fi
# The key is on disk for tor now. Nothing else needs it.
unset ONION_SECRET_KEY

PIDS=()
tor -f /tmp/tor/torrc &
PIDS+=($!)
node node_modules/next/dist/bin/next start -p "$PORT" -H "$HOSTNAME" &
PIDS+=($!)
if [[ -n "${DATABASE_URL:-}" ]]; then
  node dist/worker.mjs &
  PIDS+=($!)
else
  echo "entrypoint: DATABASE_URL is not set; ZEC bidding is off" >&2
fi

( for _ in $(seq 120); do
    if [[ -s "$HS/hostname" ]]; then echo "entrypoint: onion at $(cat "$HS/hostname")"; break; fi
    sleep 1
  done ) &

# Only the long-running processes count; the announcer above exits by design.
set +e
wait -n "${PIDS[@]}"
echo "entrypoint: a process exited ($?); stopping" >&2
exit 1
