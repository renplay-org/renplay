#!/bin/bash
# Runs the renplay server and nginx; exits as soon as either one stops so the
# container is restarted instead of half-working.
set -euo pipefail

# Never run Node or nginx as root. Volume ownership belongs to the operator:
# recursively chowning a downloads share would be both slow and surprising.
if [ "$(id -u)" = 0 ]; then
  uid="${PUID:-1000}"
  gid="${PGID:-1000}"
  if ! [[ "$uid" =~ ^[0-9]+$ && "$gid" =~ ^[0-9]+$ ]] || [ "$uid" -eq 0 ]; then
    echo "PUID must be a positive numeric user ID and PGID a numeric group ID" >&2
    exit 1
  fi
  # nginx reopens /dev/stdout and /dev/stderr; Docker created their pipes as
  # root, so the dropped user needs ownership (also works with a read-only /).
  chown "$uid:$gid" /proc/self/fd/1 /proc/self/fd/2
  exec setpriv --reuid="$uid" --regid="$gid" --clear-groups --no-new-privs "$0" "$@"
fi

export GAMES_DIR="${GAMES_DIR:-/games}"
export DATA_DIR="${DATA_DIR:-/data}"
export RENPLAY_DIR="${RENPLAY_DIR:-$GAMES_DIR/_renplay}"
# The server's port inside the container, which nginx forwards to.
export PORT="${PORT:-3000}"
export HOME="${HOME:-/tmp/home}"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"

# RENPLAY_LOG_LEVEL also decides which requests nginx logs (the server reads it for its own lines,
# trimmed and in any case, as here). The rules match "<path is worth logging>:<the request's level>".
log_level=$(printf '%s' "${RENPLAY_LOG_LEVEL:-info}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | tr '[:upper:]' '[:lower:]')
case "$log_level" in
  debug) log_rules='"~^1:" 1;' nginx_errors=warn ;;
  warn) log_rules='"~^1:(warn|error)" 1;' nginx_errors=warn ;;
  error) log_rules='"~^1:error" 1;' nginx_errors=error ;;
  *) log_rules='"~^1:(info|warn|error)" 1;' nginx_errors=warn ;;
esac
export RENPLAY_LOG_RULES="$log_rules" RENPLAY_NGINX_ERRORS="$nginx_errors"

mkdir -p /tmp/nginx "$HOME" "$DATA_DIR" "$RENPLAY_DIR/engines"
envsubst '${PORT} ${GAMES_DIR} ${DATA_DIR} ${RENPLAY_DIR} ${RENPLAY_LOG_RULES} ${RENPLAY_NGINX_ERRORS}' < /app/deploy/nginx.conf.template > /tmp/nginx/nginx.conf

node /app/server/dist/index.js &
server=$!

for _ in $(seq 1 80); do
  if ! kill -0 "$server" 2>/dev/null; then
    echo "renplay server exited during startup" >&2
    exit 1
  fi
  # Quiet: the server is expected to refuse connections until it is listening.
  if curl -fs -o /dev/null "http://127.0.0.1:$PORT/api/health"; then
    break
  fi
  sleep 0.25
done

# nginx's own messages ("2026/11/07 12:01:14 [warn] 25#25: *3 …") in the server's columns.
nginx_lines() {
  awk '{
    if ($0 ~ /^[0-9][0-9][0-9][0-9]\/[0-9][0-9]\/[0-9][0-9] [0-9:]+ \[[a-z]+\] [0-9]+#[0-9]+: /) {
      day = substr($0, 1, 10); gsub("/", "-", day)
      level = $3; gsub(/[][]/, "", level)
      if (level == "crit" || level == "alert" || level == "emerg") level = "error"
      if (level == "notice") level = "info"
      text = $0; sub(/^[^:]+:[^:]+:[^:]+: /, "", text); sub(/^\*[0-9]+ /, "", text)
      text = toupper(substr(text, 1, 1)) substr(text, 2)
      printf "%s %s  %-5s  %-10s %s\n", day, $2, level, "[nginx]", text
    } else print
    fflush()
  }'
}

nginx -c /tmp/nginx/nginx.conf -g 'daemon off;' 2> >(nginx_lines >&2) &
proxy=$!

trap 'kill -TERM "$server" "$proxy" 2>/dev/null' TERM INT
wait -n "$server" "$proxy"
status=$?
kill -TERM "$server" "$proxy" 2>/dev/null || true
wait || true
exit "$status"
