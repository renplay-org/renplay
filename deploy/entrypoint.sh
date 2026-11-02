#!/bin/bash
# Runs the renplay server and nginx; exits as soon as either one stops so the
# container is restarted instead of half-working.
set -euo pipefail

export GAMES_DIR="${GAMES_DIR:-/games}"
export DATA_DIR="${DATA_DIR:-/data}"
export RENPLAY_DIR="${RENPLAY_DIR:-$GAMES_DIR/_renplay}"
export RENPLAY_RUNTIME_PATH=/app/runtime/renplay-runtime.js
export HOME="${HOME:-/tmp/home}"

mkdir -p /tmp/nginx "$HOME" "$DATA_DIR" "$RENPLAY_DIR/engines"
envsubst '${GAMES_DIR} ${DATA_DIR} ${RENPLAY_DIR}' < /app/deploy/nginx.conf.template > /tmp/nginx/nginx.conf

node /app/server/dist/index.js &
server=$!

for _ in $(seq 1 80); do
  if ! kill -0 "$server" 2>/dev/null; then
    echo "renplay server exited during startup" >&2
    exit 1
  fi
  if curl -fsS -o /dev/null http://127.0.0.1:3000/api/health; then
    break
  fi
  sleep 0.25
done

nginx -c /tmp/nginx/nginx.conf -g 'daemon off;' &
proxy=$!

trap 'kill -TERM "$server" "$proxy" 2>/dev/null' TERM INT
wait -n "$server" "$proxy"
status=$?
kill -TERM "$server" "$proxy" 2>/dev/null || true
wait || true
exit "$status"
