#!/bin/sh
# Deploys the collector: creates the D1 database if it is missing, applies schema.sql, and deploys the
# Worker. It needs CLOUDFLARE_API_TOKEN (Workers Scripts, D1 and the zone's Workers Routes and DNS
# edit permissions) and CLOUDFLARE_ACCOUNT_ID in the environment. Run it from anywhere:
#   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... sh telemetry/deploy.sh
# It can be run again: the database and the schema are only created when missing.
set -eu

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ACCOUNT_ID:?Set CLOUDFLARE_ACCOUNT_ID}"
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
export WRANGLER_SEND_METRICS=false

here=$(cd "$(dirname "$0")" && pwd)
cd "$here"
[ -d node_modules ] || npm ci

NAME=renplay-telemetry
CONFIG=wrangler.deploy.toml
wrangler() { "$here/node_modules/.bin/wrangler" "$@"; }

# The id of the database called $NAME, or nothing.
database_id() {
  wrangler d1 list --json | node -e '
    let text = ""
    process.stdin.on("data", (c) => (text += c)).on("end", () => {
      const found = JSON.parse(text).find((db) => db.name === process.argv[1])
      if (found) console.log(found.uuid)
    })' "$NAME"
}

id=$(database_id)
if [ -z "$id" ]; then
  echo "Creating the D1 database $NAME"
  # From an empty folder, so that wrangler has no config here to offer to change.
  empty=$(mktemp -d)
  (cd "$empty" && wrangler d1 create "$NAME")
  rmdir "$empty"
  id=$(database_id)
fi
case "$id" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-*-*-*-????????????) ;;
  *) echo "Could not find the id of the database $NAME" >&2; exit 1 ;;
esac

# The id goes into a copy of wrangler.toml (ignored by git), so the committed file stays as it is.
sed "s/^database_id = .*/database_id = \"$id\"/" wrangler.toml > "$CONFIG"

echo "Applying schema.sql"
wrangler d1 execute "$NAME" --remote --yes --config "$CONFIG" --file schema.sql

echo "Deploying the Worker"
wrangler deploy --config "$CONFIG"
