#!/bin/sh
# The demo's start. Hosts set PORT for the public port, and Renplay reads PORT for its internal server, which nginx expects on 3000. nginx listens on 8080.
export PORT=3000
exec /app/deploy/entrypoint.sh "$@"
